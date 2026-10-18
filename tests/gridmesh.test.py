#!/usr/bin/env python3
"""
Test of app/gridmesh.py (step2glb.py --grid): curved CAD faces meshed again in even strips.

It builds a box with rounded edges and turns it into B-spline faces (BRepBuilderAPI_NurbsConvert: the fillets become
free-form patches, the kind gridmesh rebuilds), meshes it with OpenCascade, runs gridmesh.apply, and checks:

  - faces were rebuilt (the fillets), and a rebuilt fillet is rows of quads (two triangles each), not a scatter (the box
    is short, so its fillets count as wide and split_edges gives their sides points first);
  - no new gaps: welded by position, no more edges with only one triangle than the mesher left (the outline points
    were kept);
  - every CAD edge's points on every face are where they were before (the edges' polygons still point at them);
  - the meshed area is the CAD area (0.5 %), and no triangle middle is further from its surface than allowed;
  - running it twice changes nothing more than the first time (a face already in strips stays valid);
  - on a cube made of B-spline faces split_edges splits every
    edge with both faces still meeting point for point, the same area, and the faces rebuilt on the new points closed.

Run it with the app's Python:

    app/.venv/Scripts/python.exe tests/gridmesh.test.py
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
import gridmesh                                                    # noqa: E402

from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox                    # noqa: E402
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet             # noqa: E402
from OCP.BRepBuilderAPI import BRepBuilderAPI_NurbsConvert         # noqa: E402
from OCP.BRepMesh import BRepMesh_IncrementalMesh                  # noqa: E402
from OCP.BRep import BRep_Tool                                     # noqa: E402
from OCP.BRepAdaptor import BRepAdaptor_Surface                    # noqa: E402
from OCP.BRepGProp import BRepGProp                                # noqa: E402
from OCP.GProp import GProp_GProps                                 # noqa: E402
from OCP.TopExp import TopExp_Explorer                             # noqa: E402
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE                    # noqa: E402
from OCP.TopLoc import TopLoc_Location                             # noqa: E402
from OCP.TopoDS import TopoDS                                      # noqa: E402

SAG, ANGLE = 0.5, 0.5
fails = []


def check(ok, what):
    print(("  ok    " if ok else "  FAIL  ") + what)
    if not ok: fails.append(what)


def model():
    box = BRepPrimAPI_MakeBox(120.0, 80.0, 50.0).Shape()
    mf = BRepFilletAPI_MakeFillet(box)
    ex = TopExp_Explorer(box, TopAbs_EDGE)
    while ex.More(): mf.Add(9.0, TopoDS.Edge_s(ex.Current())); ex.Next()
    return BRepBuilderAPI_NurbsConvert(mf.Shape(), True).Shape()


def faces(shape):
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        yield TopoDS.Face_s(ex.Current()); ex.Next()


def mesh_of(face):
    tri = BRep_Tool.Triangulation_s(face, TopLoc_Location())
    P = np.array([(p.X(), p.Y(), p.Z()) for p in (tri.Node(i) for i in range(1, tri.NbNodes() + 1))])
    T = np.array([tri.Triangle(j).Get() for j in range(1, tri.NbTriangles() + 1)]) - 1
    return tri, P, T


def edge_points(shape):
    """Per (face number, edge number): the 3D points of the edge's polygon on that face's mesh."""
    out = {}
    for fi, f in enumerate(faces(shape)):
        tri = BRep_Tool.Triangulation_s(f, TopLoc_Location())
        _, P, _ = mesh_of(f)
        ex = TopExp_Explorer(f, TopAbs_EDGE); ei = 0
        while ex.More():
            poly = BRep_Tool.PolygonOnTriangulation_s(TopoDS.Edge_s(ex.Current()), tri, TopLoc_Location())
            if poly is not None:
                nd = poly.Nodes()
                out[(fi, ei)] = P[[nd.Value(k) - 1 for k in range(nd.Lower(), nd.Upper() + 1)]]
            ei += 1; ex.Next()
    return out


def open_edges(shape):
    """Edges with one triangle only, after welding every face's points by position."""
    key, tris = {}, []
    for f in faces(shape):
        _, P, T = mesh_of(f)
        ids = np.array([key.setdefault(tuple(np.round(p, 6)), len(key)) for p in P])
        tris.append(ids[T])
    T = np.vstack(tris)
    e = np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), axis=1)
    _, cnt = np.unique(e, axis=0, return_counts=True)
    return int((cnt == 1).sum())


def mesh_area(shape):
    a = 0.0
    for f in faces(shape):
        _, P, T = mesh_of(f)
        a += 0.5 * np.linalg.norm(np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]), axis=1).sum()
    return a


def worst_stray(shape):
    w = 0.0
    for f in faces(shape):
        tri, P, T = mesh_of(f)
        ad = BRepAdaptor_Surface(f, False)
        UV = np.array([(q.X(), q.Y()) for q in (tri.UVNode(i) for i in range(1, tri.NbNodes() + 1))])
        for t in T:
            c = UV[t].mean(axis=0); s = ad.Value(c[0], c[1])
            w = max(w, float(np.linalg.norm(P[t].mean(axis=0) - np.array([s.X(), s.Y(), s.Z()]))))
    return w


shape = model()
BRepMesh_IncrementalMesh(shape, SAG, False, ANGLE, True)
sp = gridmesh.split_edges(shape)
print("split_edges:", sp)
before_edges = edge_points(shape)
before_open = open_edges(shape)
before_stray = worst_stray(shape)
g = GProp_GProps(); BRepGProp.SurfaceProperties_s(shape, g); cad_area = g.Mass()
print(f"mesher: open edges {before_open}, worst stray {before_stray:.3f} mm, area {mesh_area(shape):.1f} of {cad_area:.1f}")

stats = gridmesh.apply(shape, ANGLE, SAG)
print("gridmesh:", stats)
check(stats.get("grid", 0) >= 12, f"the twelve rounded edges are rebuilt ({stats.get('grid', 0)} faces in strips)")
check(open_edges(shape) <= before_open, f"no new open edges after welding by position ({open_edges(shape)}; the mesher left {before_open} at the corners)")
after_edges = edge_points(shape)
moved = max(float(np.abs(after_edges[k] - before_edges[k]).max()) for k in before_edges)
check(after_edges.keys() == before_edges.keys() and moved == 0.0, f"every CAD edge keeps its points on every face (moved {moved})")
area = mesh_area(shape)
check(abs(area - cad_area) < 0.005 * cad_area, f"meshed area {area:.1f} is the CAD area {cad_area:.1f}")
stray = worst_stray(shape)
check(stray <= max(gridmesh.SLACK * SAG, before_stray) + 1e-9, f"no triangle strays further than allowed ({stray:.3f} mm)")

# a rebuilt fillet is rows of quads: most of its triangles pair up with a neighbour into a four-sided cell whose
# opposite sides are about the same length
quads = 0; tris = 0
for f in faces(shape):
    if BRepAdaptor_Surface(f, False).GetType() != gridmesh._T.GeomAbs_BSplineSurface: continue
    _, P, T = mesh_of(f)
    ext = np.sort(np.ptp(P, axis=0))
    if not (ext[1] < 20 and ext[2] > 40): continue        # a long straight fillet (9 mm round, the box's edge long)
    tris += len(T)
    # each triangle's longest edge; a quad cut in two is two triangles whose longest edge is the same (its diagonal)
    longest = {}
    for t in T:
        ed = [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])]
        a, b = max(ed, key=lambda e: np.linalg.norm(P[e[0]] - P[e[1]]))
        longest[(min(a, b), max(a, b))] = longest.get((min(a, b), max(a, b)), 0) + 1
    quads += 2 * sum(1 for v in longest.values() if v == 2)
check(tris > 0 and quads >= tris * 0.6, f"the straight fillets are rows of quads ({quads} of {tris} triangles pair up on a diagonal)")

again = gridmesh.apply(shape, ANGLE, SAG)
check(open_edges(shape) <= before_open and abs(mesh_area(shape) - cad_area) < 0.005 * cad_area, f"a second run keeps it valid ({again})")

# points along long edges between wide faces: a 200 mm cube made of B-spline faces. Every edge is 200 mm long with
# its two ends only (it is straight), and both faces beside it are wide, so it is split; the two faces must still meet
# point for point, through the same CAD edge
print("\nedges between wide faces:")
box = BRepBuilderAPI_NurbsConvert(BRepPrimAPI_MakeBox(200.0, 200.0, 200.0).Shape(), True).Shape()
BRepMesh_IncrementalMesh(box, SAG, False, ANGLE, True)
open0 = open_edges(box); g = GProp_GProps(); BRepGProp.SurfaceProperties_s(box, g); box_area = g.Mass()
sp = gridmesh.split_edges(box)
print("split_edges:", sp)
check(sp["edges"] == 12 and sp["points"] > 12, f"all twelve edges get points along them ({sp})")
check(open_edges(box) <= open0, f"no new open edges ({open_edges(box)}, before {open0})")
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape   # noqa: E402
from OCP.TopExp import TopExp                                        # noqa: E402
emap = TopTools_IndexedDataMapOfShapeListOfShape(); TopExp.MapShapesAndAncestors_s(box, TopAbs_EDGE, TopAbs_FACE, emap)
worst = 0.0
for i in range(1, emap.Extent() + 1):
    e = TopoDS.Edge_s(emap.FindKey(i)); on = []
    for f in emap.FindFromIndex(i):
        f = TopoDS.Face_s(f); tri = BRep_Tool.Triangulation_s(f, TopLoc_Location())
        poly = BRep_Tool.PolygonOnTriangulation_s(e, tri, TopLoc_Location())
        nd = poly.Nodes(); _, P, _ = mesh_of(f)
        on.append(P[[nd.Value(k) - 1 for k in range(nd.Lower(), nd.Upper() + 1)]])
    a, b = on
    worst = max(worst, float(np.abs(a - b).max()) if len(a) == len(b) else float("inf"))
check(worst < 1e-9, f"each edge has the same points on both its faces (worst {worst:.2e} mm)")
check(abs(mesh_area(box) - box_area) < 1e-6 * box_area, f"area unchanged ({mesh_area(box):.3f} of {box_area:.3f})")
st2 = gridmesh.apply(box, ANGLE, SAG)
check(open_edges(box) <= open0 and abs(mesh_area(box) - box_area) < 1e-6 * box_area,
      f"the faces then rebuilt on the new points stay closed ({st2})")

print(f"\n{'all passed' if not fails else str(len(fails)) + ' failed'}")
sys.exit(1 if fails else 0)
