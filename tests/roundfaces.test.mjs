// node tests/roundfaces.test.mjs — checks roundfaces.js (fewer facets on the round faces of a part with CAD faces) on parts built
// here with the records the converter would give them: a capped cylinder and a sphere. The triangulator is passed as the app
// would, though the collapse-based tool no longer needs it.
import { ShapeUtils, Vector2 } from '../app/vendor/three/build/three.core.js';
import { simplifyRoundFaces } from '../app/js/roundfaces.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const triangulate = (contour, holes) => ShapeUtils.triangulateShape(contour.map(p => new Vector2(p[0], p[1])), holes.map(h => h.map(p => new Vector2(p[0], p[1]))));

function builder() {
  const pos = [], idx = [], faces = [], rows = [], pts = [];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    face(kind, nums, tris, outward) {
      const first = idx.length / 3; let area = 0, n = 0;
      for (let [p, q, r] of tris) {
        const nn = cross(sub(q, p), sub(r, p)), l = Math.hypot(...nn); if (l < 1e-12) continue;
        if (dot(nn, outward([(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3])) < 0) [q, r] = [r, q];
        area += l / 2; n++;
        const b = pos.length / 3; pos.push(...p, ...q, ...r); idx.push(b, b + 1, b + 2);
      }
      faces.push([kind, first, n, area, ...nums]); return faces.length - 1;
    },
    edge(fa, fb, tangent, points) { rows.push([pts.length / 3, points.length, tangent ? 1 : 0, fa, fb]); for (const p of points) pts.push(...p); },
    done() { return { positions: new Float32Array(pos), index: new Uint32Array(idx), cad: { faces, rows, pts: new Float32Array(pts) } }; },
  };
}
const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
const fan = (loop) => { const out = []; for (let i = 1; i + 1 < loop.length; i++) out.push([loop[0], loop[i], loop[i + 1]]); return out; };
const strip = (lower, upper) => { const out = []; for (let i = 0; i + 1 < lower.length; i++) out.push(...quad(lower[i], lower[i + 1], upper[i + 1], upper[i])); return out; };
function volume(P, I) { let v = 0; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; } return v; }
function openEdges(P, I) {
  const r5 = (x) => Math.round(x * 1e5) / 1e5 + 0;
  const key = new Map(), id = (v) => { const k = r5(P[v * 3]) + ',' + r5(P[v * 3 + 1]) + ',' + r5(P[v * 3 + 2]); let c = key.get(k); if (c === undefined) { c = key.size; key.set(k, c); } return c; };
  const edges = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = id(I[t + k]), b = id(I[t + (k + 1) % 3]); if (a === b) continue; const e = a < b ? a + ',' + b : b + ',' + a; edges.set(e, (edges.get(e) || 0) + (a < b ? 1 : -1)); }
  let open = 0; for (const v of edges.values()) if (v !== 0) open++;
  return open;
}
const placesUsed = (P, I) => { const s = new Set(); for (const v of I) s.add(P[v * 3].toFixed(4) + ',' + P[v * 3 + 1].toFixed(4) + ',' + P[v * 3 + 2].toFixed(4)); return s.size; };
// the record is sound: ranges contiguous, in order, covering every triangle once
const recordSound = (r) => { let at = 0; for (const f of r.cad.faces) { if (f[2] === 0) continue; if (f[1] !== at) return false; at += f[2]; } return at === r.index.length / 3; };

// ── 1. a capped cylinder, r 10, h 20, 72 facets ──
function cylinder(N = 72, R = 10, H = 20) {
  const b = builder();
  const ring = (z) => Array.from({ length: N + 1 }, (_, i) => { const a = (i / N) * Math.PI * 2; return [R * Math.cos(a), R * Math.sin(a), z]; });
  const bottom = b.face(0, [], fan(ring(0).slice(0, N)), () => [0, 0, -1]);
  const wall = b.face(1, [R], strip(ring(0), ring(H)), (c) => [c[0], c[1], 0]);
  const top = b.face(0, [], fan(ring(H).slice(0, N)), () => [0, 0, 1]);
  b.edge(bottom, wall, false, ring(0)); b.edge(wall, top, false, ring(H));
  return b.done();
}
{
  console.log('a capped cylinder of 72 facets');
  const rimPts = (res, z) => { const s = new Set(); for (let t = 0; t < res.index.length; t++) { const v = res.index[t]; if (Math.abs(res.positions[v * 3 + 2] - z) < 1e-6) s.add(res.positions[v * 3].toFixed(4) + ',' + res.positions[v * 3 + 1].toFixed(4)); } return s.size; };
  const g = cylinder();
  ok(openEdges(g.positions, g.index) === 0, 'the input is closed');
  const v0 = volume(g.positions, g.index);
  // a deviation of 0.3 on r 10: the mesh's own sag is 0.038 a facet, so plenty of points may go
  const r = simplifyRoundFaces(g.positions, g.index, { cad: g.cad, tolerance: 0.3, segments: 12, triangulate });
  ok(r.ok && r.collapsed > 0, 'points were collapsed (' + JSON.stringify({ ok: r.ok, why: r.why, collapsed: r.collapsed, left: r.left, before: r.before, after: r.after }) + ')');
  const wallTris = r.ok && r.cad.faces[1][2];
  ok(r.ok && wallTris <= 2 * 50 && wallTris >= 2 * 12, 'the wall has far fewer facets round (' + wallTris / 2 + ' triangles-worth, from 72)');
  ok(r.ok && openEdges(r.positions, r.index) === 0, 'the result is closed: the caps followed the rims (' + (r.ok && openEdges(r.positions, r.index)) + ' open edges)');
  ok(r.ok && Math.abs(volume(r.positions, r.index) - v0) < v0 * 0.03, 'the volume is within 3 % (' + (r.ok && ((volume(r.positions, r.index) / v0 - 1) * 100).toFixed(2)) + ' %)');
  ok(r.ok && recordSound(r), 'the CAD record is sound: faces in contiguous ranges that cover the mesh');
  // (a rim is a ring: its polyline ends where it starts, so it has one point more than the rim has places)
  ok(r.ok && r.cad.rows.length === 2 && r.cad.rows[0][1] === rimPts(r, 0) + 1 && r.cad.rows[1][1] === rimPts(r, 20) + 1, 'the rim polylines lost the points that went and match the rims (' + (r.ok && r.cad.rows.map(x => x[1]).join('/')) + ' for ' + (r.ok && rimPts(r, 0) + '/' + rimPts(r, 20)) + ' places)');
  // a least segment count caps the coarsest facet whatever the deviation
  const coarse = simplifyRoundFaces(g.positions, g.index, { cad: g.cad, tolerance: 5, segments: 24, triangulate });
  ok(coarse.ok && rimPts(coarse, 0) >= 24 && rimPts(coarse, 0) <= 48 && rimPts(coarse, 20) >= 24 && rimPts(coarse, 20) <= 48 && openEdges(coarse.positions, coarse.index) === 0, 'with a loose deviation the least-segments cap holds on both rims (' + (coarse.ok && rimPts(coarse, 0) + '/' + rimPts(coarse, 20)) + ' points, closed)');
  // too tight a deviation changes nothing
  const tight = simplifyRoundFaces(g.positions, g.index, { cad: g.cad, tolerance: 0.001, segments: 12, triangulate });
  ok(tight.ok && tight.collapsed === 0 && tight.after === tight.before, 'a deviation under the mesh\'s own sag changes nothing');
}

// ── 2. a sphere, 36 × 18 ──
function sphere(N = 36, M = 18, R = 10) {
  const b = builder();
  const sp = (j, i) => { const th = (j / M) * Math.PI, ph = (i / N) * Math.PI * 2; return [R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph), R * Math.cos(th)]; };
  const tris = [];
  for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
    if (j === 0) tris.push([sp(0, 0), sp(1, i), sp(1, i + 1)]);
    else if (j === M - 1) tris.push([sp(j, i), sp(M, 0), sp(j, i + 1)]);
    else tris.push(...quad(sp(j, i), sp(j + 1, i), sp(j + 1, i + 1), sp(j, i + 1)));
  }
  b.face(3, [R], tris, (c) => c);
  return b.done();
}
{
  console.log('a sphere of 36 × 18');
  const g = sphere();
  ok(openEdges(g.positions, g.index) === 0, 'the input is closed');
  const v0 = volume(g.positions, g.index), n0 = placesUsed(g.positions, g.index);
  const r = simplifyRoundFaces(g.positions, g.index, { cad: g.cad, tolerance: 0.6, segments: 12, triangulate });
  ok(r.ok && r.collapsed > 0 && r.after < r.before * 0.6, 'a good share of the triangles went (' + JSON.stringify({ collapsed: r.collapsed, before: r.before, after: r.after }) + ')');
  const tighter = simplifyRoundFaces(g.positions, g.index, { cad: g.cad, tolerance: 0.3, segments: 12, triangulate });
  ok(tighter.ok && tighter.after > r.after && tighter.after < tighter.before, 'a tighter deviation keeps more (' + (tighter.ok && tighter.after) + ' between ' + r.after + ' and ' + r.before + ')');
  ok(r.ok && openEdges(r.positions, r.index) === 0, 'closed');
  // a deviation of 0.6 is 6 % of the radius: the volume may drop by about three times that at the most
  ok(r.ok && Math.abs(volume(r.positions, r.index) - v0) < v0 * 0.15, 'volume within what a 6 % deviation allows (' + (r.ok && ((volume(r.positions, r.index) / v0 - 1) * 100).toFixed(2)) + ' %)');
  const fine = simplifyRoundFaces(g.positions, g.index, { cad: g.cad, tolerance: 0.15, segments: 12, triangulate });
  ok(fine.ok && Math.abs(volume(fine.positions, fine.index) - v0) < v0 * 0.03 && openEdges(fine.positions, fine.index) === 0, 'at 1.5 % of the radius the volume stays within 3 % (' + (fine.ok && ((volume(fine.positions, fine.index) / v0 - 1) * 100).toFixed(2)) + ' %, ' + (fine.ok && fine.after) + ' triangles)');
  ok(r.ok && placesUsed(r.positions, r.index) < n0, 'fewer points (' + n0 + ' → ' + (r.ok && placesUsed(r.positions, r.index)) + ')');
}

console.log(fails ? '\n' + fails + ' check(s) failed' : '\nall checks passed');
process.exit(fails ? 1 : 0);
