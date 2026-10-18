"""gridmesh.py: curved CAD faces meshed along the surface's own directions, in even strips (step2glb.py --grid).

OpenCascade fills the inside of a curved face with points of its own choosing and joins them by Delaunay, so a fillet comes
out as a scatter of triangles of every shape. Cinema 4D meshes it along the surface instead: rows that follow the
surface's two directions (u and v), so a fillet is a set of even strips, each a row of quads cut in two.

This rebuilds the triangles of such a face after OpenCascade has meshed it. It takes a free-form face (B-spline, Bezier,
swept: OpenCascade already meshes planes, cylinders, cones, spheres and tori on a regular grid of its own) whose outline
is one loop with four sides that each run one way (what a fillet, a blend or a panel between four edges is), and it keeps
every point on the outline exactly as the mesher put it there (the same nodes, at the same place in the node list), so
the neighbouring faces still meet it point for point and the CAD edges that refer to those nodes stay right. Inside:
  - a grid laid between the four sides (a Coons patch in (u, v), so it follows a side that is trimmed at an angle), with
    lines where the surface needs them: no piece turns more than the angle or sags more than the deflection, and none is
    longer than the spacing of the points on the sides that run the same way (a direction that needs none gets two
    lines near its ends);
  - except where the face is straight one way and the two ends of that way have as many points as each other (a
    straight fillet): then each strip runs straight from a point on one end to its partner on the other, with nothing
    inside, as in Cinema 4D;
  - each cell of the grid a quad cut in two, all the same way;
  - the ring between the grid's edge and the outline zipped together, both walked once round.
The new mesh is used only when it covers the face's (u, v) area exactly, every triangle faces the same way, and no
sampled triangle strays from the surface further than 1.5 x the deflection or than the mesher's own triangles do (it tries
again with lines 4 and 16 times closer first); any other face keeps the mesher's triangles. The triangulation is changed
in place, so the CAD edges' polygons on it stay valid.

Before that, split_edges() adds points along long edges between two wide faces (the mesher leaves a straight edge with
its two ends only, and the triangles along it fan out from them in a star): see the section above it.
"""
import math
import numpy as np

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_SurfaceType as _T
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.TopTools import TopTools_IndexedMapOfShape
from OCP.Poly import Poly_Triangle
from OCP.gp import gp_Pnt, gp_Pnt2d

_FREEFORM = (_T.GeomAbs_BSplineSurface, _T.GeomAbs_BezierSurface, _T.GeomAbs_SurfaceOfRevolution,
             _T.GeomAbs_SurfaceOfExtrusion, _T.GeomAbs_OffsetSurface, _T.GeomAbs_OtherSurface)
SAMPLES = 33            # points along each sampled line
ROWS = 5                # lines sampled across the face to decide the points along the rows
MAX_POINTS = 60000      # new points per face
SIDE_TOL = 1.0          # how far a side may stray from its edge of the (u, v) rectangle (share of its size): any, if it runs one way
SLACK = 1.5             # a new triangle may stray this many times the deflection from the surface (sampled), no more
DEBUG = False
TRIES = 3               # a face tries with points along its rows as the deflection asks, then 4x and 16x closer


def _placements(P: np.ndarray, sag: float, theta: float, hmax: float = 0.0) -> np.ndarray:
    """P: (rows, SAMPLES, 3), points along `rows` lines of one direction at SAMPLES evenly spaced parameters.
    Returns where points go along that direction (as fractions 0..1, ends left out) so that each piece turns no more than
    `theta` and sags no more than `sag`. On an arc of curvature k a piece of length L turns k L and sags k L^2 / 8, so a
    stretch that turns d(theta) over a length ds needs max(d(theta) / theta, sqrt(d(theta) ds / (8 sag))) pieces. With
    `hmax` no piece is longer than that either (ds / hmax pieces)."""
    d = np.diff(P, axis=1)
    ln = np.linalg.norm(d, axis=2)
    u = d / np.maximum(ln, 1e-300)[..., None]
    cosv = np.clip(np.einsum('rij,rij->ri', u[:, :-1], u[:, 1:]), -1.0, 1.0)
    turn_v = np.arccos(cosv)
    turn = np.zeros_like(ln)
    turn[:, :-1] += turn_v / 2; turn[:, 1:] += turn_v / 2
    turn[ln < 1e-12] = 0.0
    need = np.maximum(turn / theta, np.sqrt(turn * ln / (8.0 * sag)))
    if hmax > 0: need = np.maximum(need, ln / hmax)
    need = need.max(axis=0)
    cum = np.concatenate([[0.0], np.cumsum(need)])
    total = cum[-1]
    n = int(math.ceil(total - 1e-9))
    if n <= 1: return np.zeros(0)
    targets = total * np.arange(1, n) / n
    return np.interp(targets, cum, np.linspace(0.0, 1.0, P.shape[1]))


def _zip(a: list, ta: np.ndarray, b: list, tb: np.ndarray) -> list:
    """Triangles between two chains of nodes that run the same way (a below, b above), by their positions ta, tb (both
    from 0 to 1): each step takes the next node of whichever chain comes first, so no triangle crosses another."""
    out = []; i = j = 0
    while i < len(a) - 1 or j < len(b) - 1:
        if j == len(b) - 1 or (i < len(a) - 1 and ta[i + 1] <= tb[j + 1]):
            out.append((a[i], a[i + 1], b[j])); i += 1
        else:
            out.append((a[i], b[j + 1], b[j])); j += 1
    return out


def _area2(UV: np.ndarray, T: np.ndarray) -> np.ndarray:
    a = UV[T]
    return (a[:, 1, 0] - a[:, 0, 0]) * (a[:, 2, 1] - a[:, 0, 1]) - (a[:, 2, 0] - a[:, 0, 0]) * (a[:, 1, 1] - a[:, 0, 1])


def _rebuild(face, tri, angle: float, sag) -> str:
    """Rebuild one face's triangles as strips. Returns what happened: "grid", or why not."""
    n = tri.NbNodes(); m = tri.NbTriangles()
    if not tri.HasUVNodes() or m == 0: return "no mesh"
    uv = np.array([(p.X(), p.Y()) for p in (tri.UVNode(i) for i in range(1, n + 1))], dtype=np.float64)
    xyz = np.array([(p.X(), p.Y(), p.Z()) for p in (tri.Node(i) for i in range(1, n + 1))], dtype=np.float64)
    t = np.array([tri.Triangle(j).Get() for j in range(1, m + 1)], dtype=np.int64) - 1
    e = np.sort(np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]), axis=1)
    uk, cnt = np.unique(e[:, 0] * n + e[:, 1], return_counts=True)
    if cnt.max(initial=0) > 2: return "odd mesh"
    be = np.stack([uk[cnt == 1] // n, uk[cnt == 1] % n], axis=1)                    # the outline's edges
    ob = np.unique(be)
    if len(ob) < 4: return "odd mesh"
    # the outline as one loop (a face with a hole in it is not a four-sided patch)
    nb: dict = {}
    for a, b in be:
        nb.setdefault(int(a), []).append(int(b)); nb.setdefault(int(b), []).append(int(a))
    if any(len(x) != 2 for x in nb.values()): return "odd outline"
    loop = [int(ob[0])]; prev = None
    while True:
        a, b = nb[loop[-1]]
        nx = a if a != prev else b
        if nx == loop[0]: break
        prev = loop[-1]; loop.append(nx)
        if len(loop) > len(ob): return "odd outline"
    if len(loop) != len(ob): return "holes"
    q = uv[loop]
    u0, v0 = q.min(axis=0); u1, v1 = q.max(axis=0)
    if not (u1 > u0 and v1 > v0): return "odd mesh"
    w = (q - (u0, v0)) / (u1 - u0, v1 - v0)                # 0..1 in both
    # the four corners: the outline nodes nearest the rectangle's corners, in the loop's order
    cpos = []
    for cu, cv in ((0, 0), (1, 0), (1, 1), (0, 1)):
        cpos.append(int(np.argmin((w[:, 0] - cu) ** 2 + (w[:, 1] - cv) ** 2)))
    if len(set(cpos)) < 4: return "corners"
    L = len(loop)
    def piece(i0, i1):           # loop positions from i0 to i1 (both in), going forward
        out = [i0]
        while out[-1] != i1: out.append((out[-1] + 1) % L)
        return out
    order = sorted(range(4), key=lambda k: cpos[k])
    # the loop must meet the corners in turn, one way round or the other
    seq = [cpos[k] for k in order]
    names = [order[k] for k in range(4)]
    ok = any(names == [(s0 + d * k) % 4 for k in range(4)] for s0 in range(4) for d in (1, -1))
    if not ok: return "corners"
    sides = {}
    for k in range(4):
        c0, c1 = names[k], names[(k + 1) % 4]
        pos = piece(seq[k], seq[(k + 1) % 4])
        pair = {c0, c1}
        name = {frozenset({0, 1}): "b", frozenset({3, 2}): "t", frozenset({0, 3}): "l", frozenset({1, 2}): "r"}.get(frozenset(pair))
        if name is None: return "corners"
        idx = np.array([loop[p] for p in pos])
        ww = w[pos]
        fixed, run = (1, 0) if name in "bt" else (0, 1)          # which coordinate stays put, which runs
        edge = 0.0 if name in "bl" else 1.0
        if np.abs(ww[:, fixed] - edge).max() > SIDE_TOL: return "trimmed"
        if ww[0, run] > ww[-1, run]: idx = idx[::-1]; ww = ww[::-1]
        if np.any(np.diff(ww[:, run]) <= 0): return "trimmed"
        sides[name] = idx
    # a side that is one point in space (the tip of a cone, the pole of a sphere) is left to the mesher
    for s in sides.values():
        if np.ptp(xyz[s], axis=0).max() < 1e-9: return "pole"
    if not sag:                    # (relative deflection: no one distance; what the mesher measured stands in)
        sag = tri.Deflection()
        if not sag > 0: return "no deflection"
    surf = BRep_Tool.Surface_s(face)
    if surf is None: return "no surface"
    def val(u, v):
        p = surf.Value(float(u), float(v)); return (p.X(), p.Y(), p.Z())
    # how far the mesher's own triangles stray, sampled at triangle middles: the strips may stray as far, or SLACK x sag
    def stray(UVs, Xs, TT):
        c = UVs[TT].mean(axis=1)
        pick = np.unique(np.linspace(0, len(TT) - 1, min(len(TT), 400)).astype(int))
        S = np.array([val(*c[k]) for k in pick])
        return np.linalg.norm(S - Xs[TT[pick]].mean(axis=1), axis=1).max()
    allowed = max(SLACK * sag, stray(uv, xyz, t))
    old = _area2(uv, t); sign = 1.0 if old.sum() >= 0 else -1.0

    # The face as a patch between its four sides (a Coons patch in (u, v)): b and t run along u, l and r along v, each
    # read as a polyline by how far along it a point is (0..1). A point (s, t) of the patch lies between them.
    def chain(side, run):
        c = uv[side]; f = (c[:, run] - c[0, run]) / (c[-1, run] - c[0, run])
        return f, c
    fb, cb = chain(sides["b"], 0); ft, ct = chain(sides["t"], 0)
    fl, cl = chain(sides["l"], 1); fr_, cr = chain(sides["r"], 1)
    C00, C10, C01, C11 = uv[sides["b"][0]], uv[sides["b"][-1]], uv[sides["t"][0]], uv[sides["t"][-1]]
    def at(f, c, x):
        return np.stack([np.interp(x, f, c[:, 0]), np.interp(x, f, c[:, 1])], axis=-1)
    def coons(S, Tt):
        S = np.asarray(S, float)[:, None]; Tt = np.asarray(Tt, float)[None, :]
        B = at(fb, cb, S[:, 0])[:, None, :]; Tp = at(ft, ct, S[:, 0])[:, None, :]
        Lp = at(fl, cl, Tt[0])[None, :, :]; Rp = at(fr_, cr, Tt[0])[None, :, :]
        s3 = S[..., None]; t3 = Tt[..., None]
        return ((1 - t3) * B + t3 * Tp + (1 - s3) * Lp + s3 * Rp
                - ((1 - s3) * (1 - t3) * C00 + s3 * (1 - t3) * C10 + (1 - s3) * t3 * C01 + s3 * t3 * C11))
    smp = np.linspace(0.0, 1.0, SAMPLES); fr = (np.arange(ROWS) + 0.5) / ROWS
    G = coons(smp, fr)                                        # (SAMPLES, ROWS, 2)
    Pu = np.array([[val(*G[k, r]) for k in range(SAMPLES)] for r in range(ROWS)])        # along s, at ROWS values of t
    G = coons(fr, smp)
    Pv = np.array([[val(*G[r, k]) for k in range(SAMPLES)] for r in range(ROWS)])        # along t
    if not (np.all(np.isfinite(Pu)) and np.all(np.isfinite(Pv))): return "surface"
    Lu = np.linalg.norm(np.diff(Pu, axis=1), axis=2).sum(axis=1).mean()
    Lv = np.linalg.norm(np.diff(Pv, axis=1), axis=2).sum(axis=1).mean()
    if not (Lu > 0 and Lv > 0): return "odd mesh"
    def spacing(side):           # how far apart the points along one side are (3D), on average
        seg = np.linalg.norm(np.diff(xyz[side], axis=0), axis=1).sum()
        return seg / max(len(side) - 1, 1)
    # lines along a direction no further apart than the points on the two sides that run that way (the sparser of them:
    # one tightly curved edge does not fill the whole face): a flat panel then gets a grid like its edges; a straight
    # fillet, with no points along its long sides, keeps one strip from end to end
    hu = max(spacing(sides["b"]), spacing(sides["t"])); hv = max(spacing(sides["l"]), spacing(sides["r"]))

    def lines(P, sg, other_len, other_n, hmax):
        """Where the grid's lines go in one direction (fractions): where the surface needs them, and at least two (a
        direction that needs none, a straight one, gets two near its ends: the strips then run from end to end)."""
        x = _placements(P, sg, angle, hmax)
        if len(x) >= 2: return x
        f = float(np.clip((other_len / (other_n + 1)) / max(P_len(P), 1e-12), 0.02, 0.25))
        return np.unique(np.concatenate([x, [f, 1.0 - f]]))
    def P_len(P): return np.linalg.norm(np.diff(P, axis=1), axis=2).sum(axis=1).mean()

    def build(sg: float):
        """The grid and its ring for deflection `sg`. Returns (T, UV, X, new nodes, spare nodes) or why not."""
        U0 = _placements(Pu, sg, angle, hu); V0 = _placements(Pv, sg, angle, hv)
        if len(U0) == 0 and len(V0) == 0: return "flat"
        # straight one way, and the two ends of that way have as many points as each other: strips straight from each
        # point of one end to its partner on the other, nothing inside (the cleanest there is: a straight fillet)
        straight = 0 if (len(U0) == 0 and len(sides["l"]) == len(sides["r"])) else                    1 if (len(V0) == 0 and len(sides["b"]) == len(sides["t"])) else None
        if straight is not None:
            if straight == 0: lo, hi, ea, eb, plo, phi = sides["b"], sides["t"], sides["l"], sides["r"], fb, ft
            else: lo, hi, ea, eb, plo, phi = sides["l"], sides["r"], sides["b"], sides["t"], fl, fr_
            chain = [[int(k) for k in lo]] + [[int(ea[r]), int(eb[r])] for r in range(1, len(ea) - 1)] + [[int(k) for k in hi]]
            tpos = [plo] + [np.array([0.0, 1.0])] * (len(ea) - 2) + [phi]
            T, ring, new_k, new_uv, nxt = [], [], [], [], [n]
            for r in range(len(chain) - 1):
                ring += _zip(chain[r], tpos[r], chain[r + 1], tpos[r + 1])
        else:
            U = lines(Pu, sg, Lv, len(V0), hu); V = lines(Pv, sg, Lu, len(U), hv)
            if len(U) * len(V) > MAX_POINTS: return "too many"
            gUV = coons(U, V)                                     # (len U, len V, 2)
            free = list(np.setdiff1d(np.arange(n), ob)); nxt = [n]
            new_k, new_uv = [], []
            gid = np.zeros((len(U), len(V)), dtype=np.int64)
            for a in range(len(U)):
                for b in range(len(V)):
                    if free: k = int(free.pop(0))
                    else: k = nxt[0]; nxt[0] += 1
                    gid[a, b] = k; new_k.append(k); new_uv.append(gUV[a, b])
            T = []
            for a in range(len(U) - 1):                           # the grid: each cell a quad, cut the same way
                for b in range(len(V) - 1):
                    T.append((gid[a, b], gid[a + 1, b], gid[a + 1, b + 1])); T.append((gid[a, b], gid[a + 1, b + 1], gid[a, b + 1]))
            # the ring between the grid's edge and the outline, both walked once round from the (0, 0) corner, positions 0..4
            nu, nv = len(U), len(V)
            g_loop = ([gid[a, 0] for a in range(nu)] + [gid[nu - 1, b] for b in range(1, nv)]
                      + [gid[a, nv - 1] for a in range(nu - 2, -1, -1)] + [gid[0, b] for b in range(nv - 2, 0, -1)])
            g_pos = list(U) + [1 + y for y in V[1:]] + [2 + (1 - x) for x in U[-2::-1]] + [3 + (1 - y) for y in V[-2:0:-1]]
            o_loop = list(sides["b"]) + list(sides["r"][1:]) + list(sides["t"][-2::-1]) + list(sides["l"][-2:0:-1])
            o_pos = list(fb) + [1 + y for y in fr_[1:]] + [2 + (1 - x) for x in ft[-2::-1]] + [3 + (1 - y) for y in fl[-2:0:-1]]
            A = [int(k) for k in g_loop] + [int(g_loop[0])]; pa = np.array(g_pos + [g_pos[0] + 4.0])
            Bl = [int(k) for k in o_loop] + [int(o_loop[0])]; pb = np.array(o_pos + [4.0])
            if np.any(np.diff(pa) <= 0) or np.any(np.diff(pb) < 0): return "odd outline"
            ring = _zip(A, pa, Bl, pb)
        N = nxt[0]
        UV = np.zeros((N, 2)); UV[:n] = uv
        X = np.zeros((N, 3)); X[:n] = xyz
        if new_k:
            UV[new_k] = new_uv
            X[new_k] = [val(u, v) for u, v in new_uv]
            if not np.all(np.isfinite(X[new_k])): return "surface"
        # each part laid out its own way round: turned to the mesher's winding, then every triangle must agree
        parts = []
        for part in (np.array(T, dtype=np.int64).reshape(-1, 3), np.array(ring, dtype=np.int64).reshape(-1, 3)):
            if not len(part): continue
            ar = _area2(UV, part)
            if ar.sum() * sign < 0: part = part[:, [0, 2, 1]]
            parts.append(part)
        T = np.vstack(parts)
        new = _area2(UV, T)
        if np.any(new * sign <= 0): return "winding"
        if abs(new.sum() - old.sum()) > 1e-6 * abs(old.sum()) + 1e-15: return "area"
        used = np.zeros(N, dtype=bool); used[T.ravel()] = True
        spare = np.nonzero(~used)[0]
        UV[spare] = UV[ob[0]]; X[spare] = X[ob[0]]          # (old inside nodes no longer needed: no triangle uses them)
        return T, UV, X, new_k, spare

    why = "strays"; got = None
    for attempt in range(TRIES):         # a face whose grid strays too far tries again with lines closer together
        r = build(sag * 0.25 ** attempt)
        if isinstance(r, str): why = r; break
        dev = stray(r[1], r[2], r[0])
        if dev <= allowed: got = r; break
        why = "strays %.1f" % (dev / allowed) if DEBUG else "strays"
    if got is None: return why
    T, UV, X, new_k, spare = got
    N = len(UV)
    # in place: the edges' polygons on this triangulation keep pointing at the same outline nodes
    if N > n: tri.ResizeNodes(N, True)
    for k in list(new_k) + [int(s) for s in spare]:
        tri.SetNode(k + 1, gp_Pnt(*X[k])); tri.SetUVNode(k + 1, gp_Pnt2d(*UV[k]))
    if tri.HasNormals(): tri.RemoveNormals()
    tri.ResizeTriangles(len(T), False)
    for j, (a, b, cc) in enumerate(T, start=1):
        tri.SetTriangle(j, Poly_Triangle(int(a) + 1, int(b) + 1, int(cc) + 1))
    return "grid"


# ── Points along long straight edges ───────────────────────────────────────────────────────────────────────────────────
# The mesher puts no points along a straight CAD edge, or one that bends less than the sag: it needs none. Between two
# wide faces (a flat panel and the blend above it) every triangle along such an edge then has to start from one of its
# two ends, and the panel shows a star of long triangles meeting in one point, where Cinema 4D has an even grid.
# split_edges() adds points along those edges, taken off the CAD curve, in both faces' meshes at once (the same
# positions, each face's own (u, v)) and in the edge's polygon on each, so the faces still meet point for point and the
# CAD line still runs through them. Only between two wide faces: the long side of a long thin fillet keeps its two
# points, so it stays one row of strips from end to end.

EDGE_WIDE = 8.0         # both faces beside an edge must be at least its length / EDGE_WIDE deep: a long thin face
                        # (a fillet along a 2 m edge) is not; a short fillet is, and its sides get points (then it
                        # is an even grid of quads rather than long strips). 3.0 left the Scania cab's roof blends
                        # to the mesher's own scatter.
EDGE_STEP = 1.5         # the pieces of the edge: about the narrower face's depth / EDGE_STEP long (on the Scania cab 1.5
                        # left a mild fan where the star was, with 70,168 triangles to Cinema 4D's 52,590; 1.0 left
                        # more of the star with 62,359; 2.0 made 77,410 and a blend fell back to the mesher's own)
EDGE_MIN_SAGS = 20.0    # and never shorter than this many times the deflection: small parts keep the mesher's points
EDGE_MAX_NEW = 400      # new points on one edge, at most


def _arrays(tri):
    n = tri.NbNodes(); m = tri.NbTriangles()
    P = np.array([(p.X(), p.Y(), p.Z()) for p in (tri.Node(i) for i in range(1, n + 1))], dtype=np.float64)
    UV = np.array([(p.X(), p.Y()) for p in (tri.UVNode(i) for i in range(1, n + 1))], dtype=np.float64)
    T = np.array([tri.Triangle(j).Get() for j in range(1, m + 1)], dtype=np.int64).reshape(-1, 3) - 1
    return P, UV, T


def _depth(tri) -> float:
    """How deep a face is: twice its area over its outline (a strip w wide and of any length: about w)."""
    P, _, T = _arrays(tri)
    if not len(T): return 0.0
    area = 0.5 * np.linalg.norm(np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]), axis=1).sum()
    e = np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), axis=1)
    uk, inv, cnt = np.unique(e, axis=0, return_inverse=True, return_counts=True)
    b = uk[cnt == 1]
    perim = np.linalg.norm(P[b[:, 0]] - P[b[:, 1]], axis=1).sum()
    return float(2.0 * area / perim) if perim > 0 else 0.0


def _flips(tri, active: set, limit: int = 20) -> int:
    """Lawson flips round the triangles in `active` (the fans split_edges made): an inside edge of one of them whose two
    opposite angles add up to more than 180 degrees is turned to the other diagonal, when both new triangles keep the
    face's winding in (u, v); the edges of a turned pair are looked at next. The rest of the face stays as the mesher
    made it. Works from a queue, so a big plate costs no more than the triangles round its new points. At most `limit`
    turns per triangle there was to start with. Returns how many edges were turned."""
    P, UV, T = _arrays(tri)
    if len(T) < 2 or not active: return 0
    a2 = lambda t: (UV[t[1], 0] - UV[t[0], 0]) * (UV[t[2], 1] - UV[t[0], 1]) - (UV[t[2], 0] - UV[t[0], 0]) * (UV[t[1], 1] - UV[t[0], 1])
    sign = 1.0 if float(_area2(UV, T).sum()) >= 0 else -1.0
    def ang(c, a, b):
        u = P[a] - P[c]; v = P[b] - P[c]
        nu, nv = math.sqrt(float(u @ u)), math.sqrt(float(v @ v))
        if nu == 0 or nv == 0: return 0.0
        return math.acos(max(-1.0, min(1.0, float(u @ v) / (nu * nv))))
    T = [list(map(int, t)) for t in T]
    owners: dict = {}                       # edge -> the triangles that have it
    def key(a, b): return (a, b) if a < b else (b, a)
    for k, t in enumerate(T):
        for q in range(3): owners.setdefault(key(t[q], t[(q + 1) % 3]), set()).add(k)
    queue = [key(T[k][q], T[k][(q + 1) % 3]) for k in active for q in range(3)]
    flips = 0; budget = limit * len(active)
    while queue and flips < budget:
        e = queue.pop()
        ks = owners.get(e)
        if not ks or len(ks) != 2: continue
        k1, k2 = ks
        t1, t2 = T[k1], T[k2]
        i1 = next(q for q in range(3) if key(t1[q], t1[(q + 1) % 3]) == e)
        a, b, c = t1[i1], t1[(i1 + 1) % 3], t1[(i1 + 2) % 3]
        i2 = next(q for q in range(3) if key(t2[q], t2[(q + 1) % 3]) == e)
        if not (t2[i2] == b and t2[(i2 + 1) % 3] == a): continue        # (the two disagree on the winding: leave it)
        d = t2[(i2 + 2) % 3]
        if ang(c, a, b) + ang(d, a, b) <= math.pi + 1e-9: continue
        n1, n2 = [c, a, d], [d, b, c]
        if a2(n1) * sign <= 0 or a2(n2) * sign <= 0: continue
        for t, k in ((t1, k1), (t2, k2)):
            for q in range(3): owners[key(t[q], t[(q + 1) % 3])].discard(k)
        T[k1], T[k2] = n1, n2
        for t, k in ((n1, k1), (n2, k2)):
            for q in range(3): owners.setdefault(key(t[q], t[(q + 1) % 3]), set()).add(k)
        queue += [key(a, c), key(c, b), key(b, d), key(d, a)]
        flips += 1
    if flips:
        for j, t in enumerate(T, start=1): tri.SetTriangle(j, Poly_Triangle(t[0] + 1, t[1] + 1, t[2] + 1))
    return flips


def split_edges(shape, sag=None) -> dict:
    """Add points along the long pieces of CAD edges between two wide faces of `shape` (meshed). `sag` (model units;
    None with relative deflection) sets the shortest piece. Returns counts."""
    from OCP.BRep import BRep_Builder
    from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Curve2d
    from OCP.GeomAbs import GeomAbs_CurveType
    from OCP.Poly import Poly_PolygonOnTriangulation
    from OCP.TColStd import TColStd_Array1OfInteger, TColStd_Array1OfReal
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_MapOfShape
    stats = {"edges": 0, "points": 0, "flips": 0}
    emap = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(shape, TopAbs_EDGE, TopAbs_FACE, emap)
    done = TopTools_MapOfShape(); depth: dict = {}; fids = TopTools_IndexedMapOfShape()
    touched: dict = {}
    bld = BRep_Builder()
    for i in range(1, emap.Extent() + 1):
        e = TopoDS.Edge_s(emap.FindKey(i))
        if BRep_Tool.Degenerated_s(e): continue
        bare = e.Located(TopLoc_Location())
        if done.Contains(bare): continue        # (an edge of a part placed several times: its meshes are shared)
        done.Add(bare)
        owners = emap.FindFromIndex(i)          # (iterating this list from Python is slow: 52 s on a truck; its ends are not)
        if owners.Size() != 2: continue
        faces = [TopoDS.Face_s(owners.First()), TopoDS.Face_s(owners.Last())]
        if faces[0].IsSame(faces[1]): continue
        try:
            if any(BRep_Tool.IsClosed_s(e, f) for f in faces): continue
            on = []
            for f in faces:
                floc = TopLoc_Location(); tri = BRep_Tool.Triangulation_s(f, floc)
                if tri is None or not tri.HasUVNodes(): break
                poly = BRep_Tool.PolygonOnTriangulation_s(e, tri, floc)
                if poly is None or not poly.HasParameters(): break
                on.append((f, tri, floc, poly))
            if len(on) != 2: continue
            f0, tri0, _, poly0 = on[0]
            nd = poly0.Nodes(); idx0 = [nd.Value(k) for k in range(nd.Lower(), nd.Upper() + 1)]
            P0 = np.array([(lambda p: (p.X(), p.Y(), p.Z()))(tri0.Node(k)) for k in idx0])
            seg = np.linalg.norm(np.diff(P0, axis=0), axis=1); Le = float(seg.sum())
            # (most edges are shorter than the shortest piece there can be: no need to look at their faces)
            if sag and seg.max(initial=0.0) <= 1.5 * EDGE_MIN_SAGS * sag: continue
            ds = []
            for f, tri, _, _ in on:
                k = fids.Add(f.Located(TopLoc_Location()))
                if k not in depth: depth[k] = _depth(tri)
                ds.append(depth[k])
            d = min(ds)
            if not (d > 0 and d >= Le / EDGE_WIDE): continue
            step = max(d / EDGE_STEP, EDGE_MIN_SAGS * sag if sag else 0.0)
            pieces = [int(math.ceil(L / step)) if L > 1.5 * step else 1 for L in seg]
            if sum(pieces) - len(pieces) <= 0 or sum(pieces) - len(pieces) > EDGE_MAX_NEW: continue
            c3 = BRepAdaptor_Curve(e)                 # (where the edge is in the shape: new points are taken off it)
            plans = []               # both faces worked out first; written only when both are fine
            for f, tri, floc, poly in on:
                nd = poly.Nodes(); pr = poly.Parameters()
                idx = [nd.Value(k) for k in range(nd.Lower(), nd.Upper() + 1)]
                prm = [pr.Value(k) for k in range(pr.Lower(), pr.Upper() + 1)]
                if len(idx) != len(seg) + 1: raise ValueError("the edge has a different number of points on its two faces")
                c2d = BRepAdaptor_Curve2d(e, f)
                back = floc.Transformation().Inverted()
                n = tri.NbNodes(); m = tri.NbTriangles()
                P, UV, T = _arrays(tri)
                add_xyz, add_uv = [], []
                new_idx, new_prm, fans = [idx[0]], [prm[0]], []
                for s in range(len(seg)):
                    a, b = idx[s], idx[s + 1]; pa, pb = prm[s], prm[s + 1]
                    chain = [a]
                    for q in range(1, pieces[s]):
                        w = q / pieces[s]; t = pa + w * (pb - pa)
                        pw = c3.Value(t).Transformed(back)          # on the CAD curve, in this face's mesh's frame
                        add_xyz.append(np.array([pw.X(), pw.Y(), pw.Z()]))
                        uvp = c2d.Value(t); add_uv.append((uvp.X(), uvp.Y()))
                        k = n + len(add_xyz); chain.append(k); new_idx.append(k); new_prm.append(t)
                    chain.append(b); new_idx.append(b); new_prm.append(pb)
                    if len(chain) > 2: fans.append(chain)
                # the one triangle along each split piece becomes a fan from its third corner, the same way round
                newT = []; fan_rows = set()
                Tl = [list(map(int, t + 1)) for t in T]
                Ta = T + 1               # (the triangles as the mesher left them, 1-based: each piece has its own one)
                for chain in fans:
                    a, b = chain[0], chain[-1]
                    hit = [int(k) for k in np.nonzero((Ta == a).any(axis=1) & (Ta == b).any(axis=1))[0]]
                    if len(hit) != 1: raise ValueError("no single triangle along a piece of the edge")
                    t = Tl[hit[0]]; i0 = t.index(a)
                    c = t[(i0 + 2) % 3] if t[(i0 + 1) % 3] == b else t[(i0 + 1) % 3]
                    forward = t[(i0 + 1) % 3] == b                 # (a, b, c) round the triangle's own way
                    ch = chain if forward else chain[::-1]
                    tris = [[ch[q], ch[q + 1], c] for q in range(len(ch) - 1)]
                    fan_rows.add(hit[0]); fan_rows.update(range(len(T) + len(newT), len(T) + len(newT) + len(tris) - 1))
                    Tl[hit[0]] = tris[0]; newT += tris[1:]
                plans.append((f, tri, floc, n, add_xyz, add_uv, Tl + newT, new_idx, new_prm, fan_rows))
            for f, tri, floc, n, add_xyz, add_uv, allT, new_idx, new_prm, fan_rows in plans:
                tri.ResizeNodes(n + len(add_xyz), True)
                for k, (x, uvp) in enumerate(zip(add_xyz, add_uv), start=n + 1):
                    tri.SetNode(k, gp_Pnt(*map(float, x))); tri.SetUVNode(k, gp_Pnt2d(float(uvp[0]), float(uvp[1])))
                if tri.HasNormals(): tri.RemoveNormals()
                tri.ResizeTriangles(len(allT), True)
                for j, t in enumerate(allT, start=1): tri.SetTriangle(j, Poly_Triangle(*t))
                ai = TColStd_Array1OfInteger(1, len(new_idx)); ar = TColStd_Array1OfReal(1, len(new_idx))
                for k, (q, t) in enumerate(zip(new_idx, new_prm), start=1): ai.SetValue(k, int(q)); ar.SetValue(k, float(t))
                bld.UpdateEdge(e, Poly_PolygonOnTriangulation(ai, ar), tri, floc)
                # flips only on a plane: on a curved face an angle in 3D can turn a diagonal across the curve (the free-form
                # faces are rebuilt by apply() anyway, and a fan on a cylinder is as close to it as the triangle it was)
                if BRepAdaptor_Surface(f, False).GetType() == _T.GeomAbs_Plane:
                    kf = fids.Add(f.Located(TopLoc_Location()))
                    touched.setdefault(kf, [tri, set()])[1].update(fan_rows)
            stats["edges"] += 1; stats["points"] += sum(pieces) - len(pieces)
        except Exception:
            stats["skipped"] = stats.get("skipped", 0) + 1
    for tri, rows in touched.values():
        stats["flips"] += _flips(tri, rows)
    return stats


def apply(shape, angle: float, sag) -> dict:
    """Mesh every curved face of `shape` that is a whole four-sided patch as even strips (its mesh must be there).
    `angle` in radians, `sag` in model units (None with relative deflection). Returns how many faces went which way."""
    stats: dict = {}
    fm = TopTools_IndexedMapOfShape()
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        fm.Add(exp.Current().Located(TopLoc_Location())); exp.Next()
    for i in range(1, fm.Extent() + 1):
        f = TopoDS.Face_s(fm.FindKey(i))
        try:
            # Only free-form faces: OpenCascade already meshes a plane, cylinder, cone, sphere or torus on a regular grid of
            # its own (the even strips are there), and skipping them is most of the time saved.
            if BRepAdaptor_Surface(f, False).GetType() not in _FREEFORM: continue
            tri = BRep_Tool.Triangulation_s(f, TopLoc_Location())
            r = "no mesh" if tri is None else _rebuild(f, tri, angle, sag)
        except Exception:
            r = "error"
        stats[r] = stats.get(r, 0) + 1
    return stats
