// node tests/splines.test.mjs — checks splines.js on shapes whose answer is known.
import { sampleSpline, polylineLength, pathFrames, profileTo2D, triangulatePolygon, sweep, extrude, lathe, loft,
  meshVolume, circle, rectangle, helix, bezierPieces, area2D,
  toBezier, insertPoint, removePoint, reverseSpline, smoothHandles, sharpPoint, isSharp, circleSpline, rectangleSpline,
  polygonSpline, arcSpline, simplifyPolyline, sampleDetailed, roundedRectSpline, starSpline, filletCorners, mirrorSpline, INTERPOLATIONS } from '../splines.js';
const V_sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log('FAIL  ' + what); } };
const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

// every edge of a closed solid is shared by exactly two triangles, once in each direction
function manifold(m) {
  const key = (a, b) => a + '_' + b;
  // weld by position first: the mesh may hold a vertex twice (hard corners, caps)
  const pos = m.positions, weld = new Map(), id = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const k = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]].map(x => Math.round(x * 1e4)).join(',');
    if (!weld.has(k)) weld.set(k, weld.size);
    id.push(weld.get(k));
  }
  const dir = new Map();
  for (let t = 0; t < m.index.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = id[m.index[t + e]], b = id[m.index[t + (e + 1) % 3]];
    if (a === b) continue;                                   // a triangle collapsed to a line (the tip of a cone)
    dir.set(key(a, b), (dir.get(key(a, b)) || 0) + 1);
  }
  let bad = 0;
  for (const [k, n] of dir) {
    const [a, b] = k.split('_');
    if (n !== 1 || dir.get(key(b, a)) !== 1) bad++;
  }
  return bad;
}

// ── sampling ────────────────────────────────────────────────────────────────
{
  const sq = { type: 'linear', closed: true, points: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]].map(p => ({ p })) };
  const s = sampleSpline(sq);
  ok(s.points.length === 4 && s.closed, 'a linear closed square keeps its 4 points');
  near(polylineLength(s.points, true), 8, 1e-9, 'square perimeter');

  // a cubic through 3 points on a circle is close to the circle
  const pts = [0, 1, 2, 3, 4, 5, 6, 7].map(i => { const a = i / 8 * Math.PI * 2; return { p: [Math.cos(a), Math.sin(a), 0] }; });
  const c = sampleSpline({ type: 'cubic', closed: true, points: pts }, { steps: 16 });
  const worst = Math.max(...c.points.map(p => Math.abs(Math.hypot(p[0], p[1]) - 1)));
  ok(worst < 0.01, `cubic through 8 points on a circle stays within 1% (worst ${worst.toFixed(4)})`);
  near(polylineLength(c.points, true), 2 * Math.PI, 0.03, 'cubic circle length');

  // clamped open B-spline starts and ends on its end points
  const b = sampleSpline({ type: 'bspline', closed: false, points: [[0, 0, 0], [1, 2, 0], [3, 2, 0], [4, 0, 0]].map(p => ({ p })) }, { steps: 10 });
  ok(Math.hypot(...b.points[0]) < 1e-9 && Math.hypot(b.points.at(-1)[0] - 4, b.points.at(-1)[1], b.points.at(-1)[2]) < 1e-9, 'open B-spline is clamped to its end points');

  // bezier with handles: a quarter-circle-ish arc; midpoint matches the known value
  const bz = sampleSpline({ type: 'bezier', closed: false, points: [{ p: [1, 0, 0], tOut: [0, 0.5523, 0] }, { p: [0, 1, 0], tIn: [0.5523, 0, 0] }] }, { steps: 8 });
  near(Math.hypot(bz.points[4][0], bz.points[4][1]), 1, 0.001, 'bezier quarter circle midpoint is on the circle');
  ok(bezierPieces({ type: 'linear', closed: false, points: [{ p: [0, 0, 0] }] }).length === 0, 'one point makes no piece');
}

// ── triangulation and profile planes ───────────────────────────────────────
{
  const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];                    // an L shape (concave)
  const tris = triangulatePolygon(L);
  const sum = tris.reduce((a, [i, j, k]) => a + Math.abs(area2D([L[i], L[j], L[k]])), 0);
  near(sum, 7, 1e-9, 'ear clipping fills an L shape exactly (area 7)');
  ok(tris.length === 4, 'an L shape of 6 corners makes 4 triangles');
  const cw = [...L].reverse();
  near(triangulatePolygon(cw).reduce((a, [i, j, k]) => a + Math.abs(area2D([cw[i], cw[j], cw[k]])), 0), 7, 1e-9, 'a clockwise outline works too');
  const p = profileTo2D([[0, 0, 5], [2, 0, 5], [2, 2, 5], [0, 2, 5]], true);
  near(Math.abs(p.normal[2]), 1, 1e-9, 'profile plane normal of a flat square at z=5 is z');
  near(Math.abs(area2D(p.pts)), 4, 1e-9, 'profile area 4');
}

// ── sweep ──────────────────────────────────────────────────────────────────
{
  // a 1 x 2 rectangle swept 10 along a straight line: a box of volume 20
  const line = { points: [[0, 0, 0], [0, 0, 5], [0, 0, 10]], closed: false };
  const box = sweep(rectangle(1, 2), line, { crease: 30 });
  near(meshVolume(box), 20, 1e-6, 'rectangle swept along a line is a box of volume 20');
  ok(manifold(box) === 0, 'the box is a closed manifold (' + manifold(box) + ' bad edges)');

  // the same without caps is an open tube: no volume claim, but no cap triangles
  const open = sweep(rectangle(1, 2), line, { caps: false });
  ok(open.index.length === box.index.length - 2 * 2 * 3, 'without caps the two end faces (2 triangles each) are gone');

  // scale 1 -> 0.5 on a square swept 6: a frustum, V = h/3 (A1 + sqrt(A1 A2) + A2)
  const fr = sweep(rectangle(2, 2), { points: [[0, 0, 0], [0, 0, 6]], closed: false }, { scale: [1, 0.5] });
  near(meshVolume(fr), 6 / 3 * (4 + Math.sqrt(4 * 1) + 1), 1e-6, 'scaled sweep is a frustum');

  // a circle swept round a circle: a torus, V = 2 pi^2 R r^2
  const R = 5, r = 1, N = 96;
  const ring = { points: Array.from({ length: N }, (_, i) => { const a = i / N * Math.PI * 2; return [R * Math.cos(a), R * Math.sin(a), 0]; }), closed: true };
  const torus = sweep(circle(r, 48), ring, { up: [0, 0, 1] });
  near(meshVolume(torus) / (2 * Math.PI ** 2 * R * r * r), 1, 0.01, 'torus volume within 1%');
  ok(manifold(torus) === 0, 'the torus is closed with no seam gap (' + manifold(torus) + ' bad edges)');

  // twist of 360 on a straight sweep leaves the volume alone
  // twist needs stations to turn between; the faces between two stations are skew, so the volume approaches 8 from below as they get closer
  const bar = (n) => meshVolume(sweep(rectangle(1, 1), { points: Array.from({ length: n }, (_, i) => [0, 0, i / (n - 1) * 8]), closed: false }, { twist: 360 }));
  near(bar(129), 8, 0.15, 'a twisted bar keeps about its volume');
  ok(bar(257) > bar(129) && bar(129) > bar(65), 'a twisted bar gets closer to its true volume with more stations');

  // only part of the path
  const part = sweep(rectangle(1, 1), { points: [[0, 0, 0], [0, 0, 5], [0, 0, 10]], closed: false }, { range: [0.25, 0.75] });
  near(meshVolume(part), 5, 1e-6, 'range [0.25, 0.75] of a 10 long path is a bar of length 5');

  // hard corners: a square keeps its 4 edges hard, a circle is smooth (its vertices are not doubled)
  const sqm = sweep(rectangle(1, 1), line, { caps: false });
  const cim = sweep(circle(1, 24), line, { caps: false });
  ok(sqm.positions.length / 3 === 3 * (4 * 2), 'square: each corner holds two vertices per ring (3 rings x 8)');
  ok(cim.positions.length / 3 === 3 * 24, 'circle: one vertex per point per ring');
}

// ── frames on a helix do not flip ──────────────────────────────────────────
{
  const h = helix(2, 1.5, 6, 32);
  const f = pathFrames(h.points, false, { up: [0, 0, 1] });
  let worst = 1;
  for (let i = 1; i < f.N.length; i++) worst = Math.min(worst, f.N[i][0] * f.N[i - 1][0] + f.N[i][1] * f.N[i - 1][1] + f.N[i][2] * f.N[i - 1][2]);
  ok(worst > 0.98, `frame normals turn smoothly along a helix (worst step ${worst.toFixed(4)})`);
  // a path that starts straight along `up` still gets a frame
  const g = pathFrames([[0, 0, 0], [0, 0, 1], [0, 0, 2]], false, { up: [0, 0, 1] });
  ok(Number.isFinite(g.N[0][0]) && Math.hypot(...g.N[0]) > 0.99, 'a path along `up` still has a normal');
  // a coil swept: a circle along a helix keeps a sound solid
  const coil = sweep(circle(0.2, 16), h, {});
  ok(meshVolume(coil) > 0 && manifold(coil) === 0, 'a coil is a positive closed solid (' + manifold(coil) + ' bad edges)');
}

// ── extrude, lathe, loft ───────────────────────────────────────────────────
{
  const p = profileTo2D([[0, 0, 0], [3, 0, 0], [3, 2, 0], [0, 2, 0]], true, [0, 0, 1]);
  const e = extrude(p, { length: 5 });
  near(Math.abs(meshVolume(e)), 30, 1e-6, 'extrude 3 x 2 by 5 is 30');
  ok(manifold(e) === 0, 'extrude is closed');
  // lathe of a rectangle [1..2] x [0..3] about the axis: a pipe, V = pi (4 - 1) * 3
  const pipe = lathe({ pts: [[1, 0], [2, 0], [2, 3], [1, 3]], closed: true }, { segments: 128 });
  near(meshVolume(pipe) / (Math.PI * 3 * 3), 1, 0.01, 'lathe makes a pipe of the right volume');
  ok(manifold(pipe) === 0, 'the lathe pipe is closed');
  // loft from a square to a smaller square 4 higher: a frustum
  const sq = (s, z) => [[-s, -s, z], [s, -s, z], [s, s, z], [-s, s, z]];
  const lf = loft([sq(1, 0), sq(0.5, 4)], { closed: true });
  near(meshVolume(lf), 4 / 3 * (4 + Math.sqrt(4 * 1) + 1), 1e-6, 'loft between two squares is a frustum');
  // loft between outlines with different counts
  const lf2 = loft([sq(1, 0), circle(1, 20).pts.map(([x, y]) => [x, y, 3])], { closed: true, points: 20 });
  ok(lf2.index.length > 0 && meshVolume(lf2) > 0, 'loft resamples outlines of different sizes');
}

// ── drawing: building and editing ──────────────────────────────────────────
{
  const radiusError = (pts, c, r) => Math.max(...pts.map(p => Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r))) / r;

  // a circle of four Bezier points is a circle within 0.03%
  const circ = circleSpline([5, 5, 0], [1, 0, 0], [0, 1, 0], 10);
  const cs = sampleSpline(circ, { steps: 32 });
  ok(radiusError(cs.points, [5, 5, 0], 10) < 3e-4, 'Bezier circle stays within 0.03% of its radius');
  near(polylineLength(cs.points, true), 2 * Math.PI * 10, 0.05, 'Bezier circle circumference');
  // an ellipse
  const el = sampleSpline(circleSpline([0, 0, 0], [1, 0, 0], [0, 1, 0], 10, 4), { steps: 32 });
  const xs = el.points.map(p => p[0]), ys = el.points.map(p => p[1]);
  near(Math.max(...xs) - Math.min(...xs), 20, 1e-6, 'ellipse width');
  near(Math.max(...ys) - Math.min(...ys), 8, 1e-6, 'ellipse height');

  // an arc through three points of a circle lies on that circle, and passes the middle point
  const R = 7, C = [1, 2, 3];
  const on = (a) => [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a), C[2]];
  for (const [a0, a1, a2] of [[0, 1, 2], [0, 2.5, 4.5], [2, 1, 0], [0.3, 3.5, 5.5]]) {
    const arc = arcSpline(on(a0), on(a1), on(a2));
    const pts = sampleSpline(arc, { steps: 24 }).points;
    ok(radiusError(pts, C, R) < 3e-4, `arc ${a0}->${a2} through ${a1} stays on its circle`);
    ok(Math.min(...pts.map(p => Math.hypot(p[0] - on(a1)[0], p[1] - on(a1)[1], p[2] - on(a1)[2]))) < R * 0.05, `arc ${a0}->${a2} passes the middle point`);
    near(Math.hypot(...V_sub(pts[0], on(a0))), 0, 1e-9, `arc ${a0}->${a2} starts at a`);
    near(Math.hypot(...V_sub(pts.at(-1), on(a2))), 0, 1e-9, `arc ${a0}->${a2} ends at c`);
  }
  const lineArc = arcSpline([0, 0, 0], [1, 0, 0], [2, 0, 0]);
  ok(lineArc.type === 'linear' && lineArc.points.length === 2, 'three points in a line give a straight piece');

  // converting to Bezier keeps the curve
  const cub = { type: 'cubic', closed: false, points: [[0, 0, 0], [3, 4, 0], [6, 0, 0], [9, 4, 0]].map(p => ({ p })) };
  const a = sampleSpline(cub, { steps: 10 }).points, b = sampleSpline(toBezier(cub), { steps: 10 }).points;
  ok(a.length === b.length && Math.max(...a.map((p, i) => Math.hypot(...V_sub(p, b[i])))) < 1e-9, 'a cubic converted to Bezier is the same curve');
  const bs = { type: 'bspline', closed: true, points: [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]].map(p => ({ p })) };
  const c1 = sampleSpline(bs, { steps: 10 }).points, c2 = sampleSpline(toBezier(bs), { steps: 10 }).points;
  ok(Math.max(...c1.map((p, i) => Math.hypot(...V_sub(p, c2[i])))) < 1e-9, 'a closed B-spline converted to Bezier is the same curve');

  // inserting a point into a Bezier spline does not change its shape
  const bz = toBezier(cub);
  const ins = insertPoint(bz, 1, 0.4);
  ok(ins.points.length === bz.points.length + 1, 'insert makes one more point');
  const before = sampleSpline(bz, { steps: 40 }).points, after = sampleSpline(ins, { steps: 40 }).points;
  // every point of the new curve lies on the old one (within the sampling of the old)
  const distToPoly = (p, poly) => Math.min(...poly.slice(0, -1).map((q, i) => { const r = poly[i + 1], d = V_sub(r, q), l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2; const t = l2 ? Math.max(0, Math.min(1, ((p[0] - q[0]) * d[0] + (p[1] - q[1]) * d[1] + (p[2] - q[2]) * d[2]) / l2)) : 0; return Math.hypot(p[0] - q[0] - d[0] * t, p[1] - q[1] - d[1] * t, p[2] - q[2] - d[2] * t); }));
  ok(Math.max(...after.map(p => distToPoly(p, before))) < 0.02, 'a point inserted into a Bezier spline leaves its shape alone');
  const insL = insertPoint({ type: 'linear', closed: false, points: [[0, 0, 0], [10, 0, 0]].map(p => ({ p })) }, 0, 0.3);
  near(insL.points[1].p[0], 3, 1e-9, 'a point inserted into a line sits at t along it');

  // removing, reversing
  ok(removePoint(bz, 1).points.length === bz.points.length - 1, 'remove drops a point');
  ok(removePoint({ type: 'linear', closed: true, points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]].map(p => ({ p })) }, 0).points.length === 3, 'a closed spline keeps three points');
  const rev = reverseSpline(bz);
  const f = sampleSpline(bz, { steps: 10 }).points, g = sampleSpline(rev, { steps: 10 }).points.reverse();
  ok(Math.max(...f.map((p, i) => Math.hypot(...V_sub(p, g[i])))) < 1e-9, 'reversing keeps the curve');

  // smooth and sharp points
  const sm = smoothHandles({ type: 'bezier', closed: false, points: [[0, 0, 0], [5, 5, 0], [10, 0, 0]].map(p => ({ p, tIn: [0, 0, 0], tOut: [0, 0, 0] })) }, 1);
  ok(!isSharp(sm.points[1]) && isSharp(sharpPoint(sm, 1).points[1]), 'a point can be made smooth and sharp again');
  near(sm.points[1].tOut[1], 0, 1e-9, 'a smooth point at a peak has level handles');

  // other shapes
  const rc = rectangleSpline([0, 0, 0], [1, 0, 0], [0, 1, 0], 6, 4);
  near(Math.abs(area2D(rc.points.map(q => [q.p[0], q.p[1]]))), 24, 1e-9, 'rectangle area');
  const pg = polygonSpline([0, 0, 0], [1, 0, 0], [0, 1, 0], 5, 6);
  ok(pg.points.length === 6 && Math.abs(Math.hypot(...pg.points[0].p) - 5) < 1e-9, 'hexagon has 6 points on its radius');

  // freehand: a noisy straight stroke collapses; a corner stays
  const stroke = Array.from({ length: 50 }, (_, i) => [i, Math.sin(i * 7) * 0.05, 0]);
  ok(simplifyPolyline(stroke, 0.2).length === 2, 'a nearly straight stroke becomes two points');
  const L = [...Array.from({ length: 20 }, (_, i) => [i, 0, 0]), ...Array.from({ length: 20 }, (_, i) => [19, i + 1, 0])];
  const sl = simplifyPolyline(L, 0.1);
  ok(sl.length === 3, 'an L-shaped stroke keeps its corner (' + sl.length + ' points)');

  // detailed sampling says where each sample sits
  const det = sampleDetailed(bz, 8);
  ok(det.points.length === det.seg.length && det.seg.length === det.t.length && Math.max(...det.seg) === bz.points.length - 2, 'sampleDetailed knows the piece of each sample');
}

// ── shape options: rounded and bevelled corners, stars, fillets, mirror ────
{
  const area = (sp, steps = 64) => Math.abs(area2D(sampleSpline(sp, { steps }).points.map(p => [p[0], p[1]])));
  const O = [0, 0, 0], X = [1, 0, 0], Y = [0, 1, 0];
  // rounded rectangle: area = w h - (4 - pi) r^2, and true arcs
  const rr = roundedRectSpline(O, X, Y, 20, 10, 3, 'round');
  near(area(rr), 200 - (4 - Math.PI) * 9, 0.05, 'rounded rectangle area');
  ok(rr.points.length === 8 && rr.closed, 'a rounded rectangle has 8 Bezier points');
  // a rounded corner of 0 is the plain rectangle; of more than half the side, a pill / circle
  ok(roundedRectSpline(O, X, Y, 20, 10, 0).points.length === 4, 'corner 0 gives the plain rectangle');
  near(area(roundedRectSpline(O, X, Y, 10, 10, 99, 'round')), Math.PI * 25, 0.1, 'a square with the corner held to half the side is a circle');
  near(area(roundedRectSpline(O, X, Y, 20, 10, 99, 'round')), 200 - (4 - Math.PI) * 25, 0.1, 'the corner is held to half the shorter side (a pill)');
  // bevel: w h - 2 c^2
  const bv = roundedRectSpline(O, X, Y, 20, 10, 3, 'bevel');
  near(area(bv), 200 - 2 * 9, 1e-9, 'bevelled rectangle area');
  ok(bv.points.length === 8, 'a bevelled rectangle has 8 corners');
  // the arcs are tangent to the edges: the curve's first sample after the straight edge leaves at a tangent
  const rs = sampleSpline(rr, { steps: 24 }).points;
  ok(rs.every(p => p[0] >= -1e-9 && p[0] <= 20 + 1e-9 && p[1] >= -1e-9 && p[1] <= 10 + 1e-9), 'a rounded rectangle never leaves its box');
  // star
  const st = starSpline(O, X, Y, 10, 5, 0.4);
  ok(st.points.length === 10 && st.closed, 'a five-point star has 10 points');
  near(area(st), 5 * 10 * 4 * Math.sin(Math.PI / 5), 1e-9, 'star area');
  near(Math.hypot(...st.points[0].p), 10, 1e-9, 'star outer radius');
  near(Math.hypot(...st.points[1].p), 4, 1e-9, 'star inner radius');
  // fillet / chamfer a square corner
  const sq = { type: 'linear', closed: true, points: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]].map(p => ({ p })) };
  const f1 = filletCorners(sq, 2, 'round', [1]);
  ok(f1.points.length === 5, 'one filleted corner turns one point into two');
  near(area(f1), 100 - (4 - Math.PI) * 4 / 4, 0.02, 'one filleted corner takes (1 - pi/4) r^2 off the area');
  const fa = filletCorners(sq, 2, 'round');
  near(area(fa), 100 - (4 - Math.PI) * 4, 0.05, 'all four corners filleted');
  near(area(filletCorners(sq, 2, 'bevel')), 100 - 4 * 2, 1e-9, 'all four corners chamfered');
  // asked for more than the edges allow, it is held to half an edge
  near(area(filletCorners(sq, 999, 'round')), Math.PI * 25, 0.1, 'a fillet larger than the edges is held to half of them (a circle on a square)');
  // an open line keeps its ends
  const ln = { type: 'linear', closed: false, points: [[0, 0, 0], [10, 0, 0], [10, 10, 0]].map(p => ({ p })) };
  const fl = filletCorners(ln, 3, 'round');
  ok(fl.points.length === 4 && fl.points[0].p[0] === 0 && fl.points.at(-1).p[1] === 10, 'a filleted open line keeps its end points');
  // mirror
  const tri = { type: 'linear', closed: true, points: [[1, 1, 0], [4, 1, 0], [1, 3, 0]].map(p => ({ p })) };
  const mi = mirrorSpline(tri, [0, 0, 0], [1, 0, 0]);
  ok(mi.points.every(q => q.p[0] <= 0) && Math.abs(area(mi) - area(tri)) < 1e-9, 'mirror across the YZ plane puts it at negative x with the same area');
  const mb = mirrorSpline(toBezier(circleSpline([5, 0, 0], X, Y, 2)), [0, 0, 0], [1, 0, 0]);
  near(sampleSpline(mb, { steps: 16 }).points.reduce((a, p) => a + p[0], 0) / sampleSpline(mb, { steps: 16 }).points.length, -5, 0.01, 'a mirrored Bezier circle is centred at -5');
}

// ── interpolation: none, natural, uniform, adaptive, subdivided ────────────
{
  const O = [0, 0, 0], X = [1, 0, 0], Y = [0, 1, 0];
  const ring = circleSpline(O, X, Y, 10);                       // 4 Bezier pieces
  const radiusErr = (pts) => Math.max(...pts.map(p => Math.abs(Math.hypot(p[0], p[1]) - 10))) / 10;
  const none = sampleSpline(ring, { mode: 'none' });
  ok(none.points.length === 4, 'none: only the 4 points of the circle');
  const nat = sampleSpline(ring, { mode: 'natural', points: 8 });
  ok(nat.points.length === 32, 'natural: 8 points on each of 4 pieces (' + nat.points.length + ')');
  const uni = sampleSpline(ring, { mode: 'uniform', points: 8 });
  ok(uni.points.length === 32, 'uniform: 8 points on each piece');
  // uniform: the gaps along an arc are equal
  const gaps = uni.points.slice(0, 8).map((p, i, a) => i ? Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0).slice(1);
  ok(Math.max(...gaps) / Math.min(...gaps) < 1.02, 'uniform: points are evenly spaced along the curve (ratio ' + (Math.max(...gaps) / Math.min(...gaps)).toFixed(3) + ')');
  // adaptive: every step turns by at most the angle (5 degrees), and it follows the circle
  const ad = sampleSpline(ring, { mode: 'adaptive', angle: 5 });
  const turns = ad.points.map((p, i, a) => { const b = a[(i + 1) % a.length], c = a[(i + 2) % a.length]; const d1 = [b[0] - p[0], b[1] - p[1], 0], d2 = [c[0] - b[0], c[1] - b[1], 0]; return Math.acos(Math.max(-1, Math.min(1, (d1[0] * d2[0] + d1[1] * d2[1]) / (Math.hypot(...d1) * Math.hypot(...d2))))) * 180 / Math.PI; });
  ok(Math.max(...turns) <= 5.6, 'adaptive 5: no corner of the polyline turns by more than about 5 degrees (' + Math.max(...turns).toFixed(2) + ')');
  ok(ad.points.length >= 64 && ad.points.length <= 90, 'adaptive 5 on a circle takes about 72 points (' + ad.points.length + ')');
  ok(radiusErr(ad.points) < 0.0006, 'adaptive stays on the circle');
  // a coarser angle takes fewer points, a finer one more
  const ad20 = sampleSpline(ring, { mode: 'adaptive', angle: 20 }), ad1 = sampleSpline(ring, { mode: 'adaptive', angle: 1 });
  ok(ad20.points.length < ad.points.length && ad1.points.length > ad.points.length, 'adaptive: a coarser angle gives fewer points, a finer one more');
  // a straight line gets no points between its ends in any mode
  const ln = { type: 'linear', closed: false, points: [[0, 0, 0], [10, 0, 0], [10, 10, 0]].map(p => ({ p })) };
  for (const mode of INTERPOLATIONS) ok(sampleSpline(ln, { mode, points: 8, angle: 5, maxLength: 1 }).points.length === 3, 'a straight spline stays 3 points in ' + mode);
  // subdivided: no step longer than the maximum
  const sub = sampleSpline(ring, { mode: 'subdivided', angle: 30, maxLength: 3 });
  const longest = Math.max(...sub.points.map((p, i, a) => { const b = a[(i + 1) % a.length]; return Math.hypot(p[0] - b[0], p[1] - b[1]); }));
  ok(longest <= 3.0001, 'subdivided: no step longer than the maximum length (' + longest.toFixed(3) + ')');
  // an S-curve whose ends point the same way still gets cut in the middle
  const S = { type: 'bezier', closed: false, points: [{ p: [0, 0, 0], tOut: [4, 6, 0] }, { p: [10, 0, 0], tIn: [-4, 6, 0] }] };
  ok(sampleSpline(S, { mode: 'adaptive', angle: 5 }).points.length > 6, 'adaptive does not take a bulging curve for straight');
  // the old way of calling still works
  ok(sampleSpline(ring, { steps: 6 }).points.length === 24, 'steps: 6 is natural with 6 points');
}

console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
