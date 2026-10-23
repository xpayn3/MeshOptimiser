// node tests/thickness.test.mjs
//
// Remove thickness (thickness.js) on parts built here: a hollow pipe (the outside stays, the inside and the end rings go, open at
// both ends), a sheet 1 thick (one face stays, the other and the strip round its edge go; with inset 0.5 it is the plane through the
// middle), an L bent from 1 thick sheet (the two outer faces stay together, as one surface), and a solid block (nothing is thin:
// nothing changes). Also: the CAD record keeps its faces (the ones that went with no triangles) and no wall thicker than the limit
// is touched. Through the app's tool runner (meshops.js), the part's own normals come out unchanged (they used to be worked out
// again from the triangles, which bent the shading of flat faces next to round ones).
import { removeThickness } from '../app/js/thickness.js';
import { runMeshOp } from '../app/js/meshops.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// a mesh builder: quads and faces (CAD records) with outward-facing triangles
function builder() {
  const pos = [], idx = [], faces = [];
  return {
    face(kind, quads, out, nums = []) {
      const first = idx.length / 3;
      for (const [a, b, c, d] of quads) for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
        const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const m = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3], o = out(m);
        const flip = n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < 0;
        const base = pos.length / 3; pos.push(...p, ...(flip ? r : q), ...(flip ? q : r)); idx.push(base, base + 1, base + 2);
      }
      faces.push([kind, first, idx.length / 3 - first, 0, ...nums]);
    },
    done() { return { positions: new Float32Array(pos), index: new Uint32Array(idx), cad: { faces, rows: [], pts: new Float32Array(0) } }; },
  };
}
const grid = (corner, du, dv, nu, nv) => { const q = []; for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const at = (a, b) => [corner[0] + du[0] * a + dv[0] * b, corner[1] + du[1] * a + dv[1] * b, corner[2] + du[2] * a + dv[2] * b]; q.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]); } return q; };
// a box from (x0, y0, z0) to (x1, y1, z1) as six faces, n divisions a side
function box(b, [x0, y0, z0], [x1, y1, z1], n = 4) {
  const dx = (x1 - x0) / n, dy = (y1 - y0) / n, dz = (z1 - z0) / n;
  b.face(0, grid([x0, y0, z0], [dx, 0, 0], [0, dy, 0], n, n), () => [0, 0, -1]);
  b.face(0, grid([x0, y0, z1], [dx, 0, 0], [0, dy, 0], n, n), () => [0, 0, 1]);
  b.face(0, grid([x0, y0, z0], [dx, 0, 0], [0, 0, dz], n, n), () => [0, -1, 0]);
  b.face(0, grid([x0, y1, z0], [dx, 0, 0], [0, 0, dz], n, n), () => [0, 1, 0]);
  b.face(0, grid([x0, y0, z0], [0, dy, 0], [0, 0, dz], n, n), () => [-1, 0, 0]);
  b.face(0, grid([x1, y0, z0], [0, dy, 0], [0, 0, dz], n, n), () => [1, 0, 0]);
}
function openEdges(P, I) {
  const key = (v) => P[v * 3].toFixed(4) + ',' + P[v * 3 + 1].toFixed(4) + ',' + P[v * 3 + 2].toFixed(4);
  const ids = new Map(), id = (v) => { const k = key(v); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const e = new Map(); for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = id(I[t + k]), b = id(I[t + (k + 1) % 3]); const kk = a < b ? a + ':' + b : b + ':' + a; e.set(kk, (e.get(kk) || 0) + 1); }
  let one = 0, over = 0; for (const n of e.values()) { if (n === 1) one++; if (n > 2) over++; } return { one, over };
}
const zs = (r) => { const s = new Set(); for (let i = 0; i < r.index.length; i++) s.add(+r.positions[r.index[i] * 3 + 2].toFixed(4)); return [...s].sort((a, b) => a - b); };

{
  console.log('a hollow pipe: outside r 10, inside r 9, 60 long, 24 round');
  const b = builder(), N = 24, L = 60, ro = 10, ri = 9, S = 6;
  const ring = (r, z) => Array.from({ length: N }, (_, j) => [r * Math.cos(2 * Math.PI * j / N), r * Math.sin(2 * Math.PI * j / N), z]);
  const tube = (r) => { const q = []; for (let k = 0; k < S; k++) { const A = ring(r, L * k / S), B = ring(r, L * (k + 1) / S); for (let j = 0; j < N; j++) q.push([A[j], A[(j + 1) % N], B[(j + 1) % N], B[j]]); } return q; };
  b.face(1, tube(ro), (m) => [m[0], m[1], 0], [ro]);
  b.face(1, tube(ri), (m) => [-m[0], -m[1], 0], [ri]);
  const cap = (z, s) => { const A = ring(ri, z), B = ring(ro, z), q = []; for (let j = 0; j < N; j++) q.push([A[j], A[(j + 1) % N], B[(j + 1) % N], B[j]]); return q; };
  b.face(0, cap(0, -1), () => [0, 0, -1]); b.face(0, cap(L, 1), () => [0, 0, 1]);
  const g = b.done();
  const r = removeThickness(g.positions, g.index, { cad: g.cad, maxThickness: 2 });
  ok(r.ok && r.cad.faces[0][2] === 2 * N * S && r.cad.faces[1][2] === 0 && r.cad.faces[2][2] === 0 && r.cad.faces[3][2] === 0, 'the outside stays whole; the inside and both end rings go (' + (r.ok ? r.cad.faces.map(f => f[2]).join('/') : r.why) + ')');
  ok(r.ok && Math.abs(r.thickness - 1) < 0.05, 'the wall is found 1 thick (' + (r.ok && r.thickness) + ')');
  const o = r.ok && openEdges(r.positions, r.index);
  ok(o && o.one === 2 * N && o.over === 0, 'open only at its two ends (' + JSON.stringify(o) + ')');
  const thin = removeThickness(g.positions, g.index, { cad: g.cad, maxThickness: 0.5 });
  ok(!thin.ok, 'a limit under the wall\'s thickness takes nothing (' + thin.why + ')');
}
{
  console.log('a sheet 40 × 20, 1 thick');
  const b = builder(); box(b, [0, 0, 0], [40, 20, 1], 8);
  const g = b.done();
  const r = removeThickness(g.positions, g.index, { cad: g.cad, maxThickness: 2 });
  const kept = r.ok && r.cad.faces.map((f, i) => f[2] ? i : -1).filter(i => i >= 0);
  ok(r.ok && kept.length === 1 && (kept[0] === 0 || kept[0] === 1), 'one face stays, the other and the strip round the edge go (faces left: ' + kept + ')');
  const o = r.ok && openEdges(r.positions, r.index);
  ok(o && o.one === 4 * 8 && o.over === 0, 'a single sheet, open all round its edge (' + JSON.stringify(o) + ')');
  const m = removeThickness(g.positions, g.index, { cad: g.cad, maxThickness: 2, inset: 0.5 });
  ok(m.ok && zs(m).length === 1 && Math.abs(zs(m)[0] - 0.5) < 1e-4, 'with inset 0.5 it is the plane through the middle (z ' + (m.ok && zs(m).join(',')) + ')');
  // the part's own normals, a little off the faces' (as a CAD mesher's are near a rounded edge): they must come out as they went in
  const Nin = new Float32Array(g.positions.length);
  for (let t = 0; t < g.index.length; t += 3) { const [a, b, c] = [g.index[t], g.index[t + 1], g.index[t + 2]].map(v => [g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]]); const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n); for (let k = 0; k < 3; k++) { const v = g.index[t + k]; Nin[v * 3] = n[0] / l + 0.01 * k; Nin[v * 3 + 1] = n[1] / l; Nin[v * 3 + 2] = n[2] / l; } }
  const viaApp = await runMeshOp('removeThickness', g.positions, g.index, { cad: g.cad, maxThickness: 2, normals: Nin });
  let same = viaApp.ok; if (same) for (let i = 0; i < viaApp.index.length; i++) { const v = viaApp.index[i]; for (let k = 0; k < 3; k++) if (Math.abs(viaApp.normals[v * 3 + k] - Nin[v * 3 + k]) > 1e-6) same = false; }
  ok(same, 'through the app tool runner every point keeps its own normal (no shading change on the face that stays)');
}
{
  console.log('an L bent from sheet 1 thick: a 30 × 20 foot and a 30 × 20 leg');
  // the outline of the L in X–Z, swept 20 along Y: outer corner (0, 0), inner corner (1, 1)
  const b = builder(), W = 20, n = 6;
  const quadsAlong = (p0, p1) => grid([p0[0], 0, p0[1]], [(p1[0] - p0[0]) / n, 0, (p1[1] - p0[1]) / n], [0, W / 4, 0], n, 4);
  const pts = [[0, 0], [30, 0], [30, 1], [1, 1], [1, 30], [0, 30]];       // round the outline
  const mid = [8, 8];
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
    const nx = p1[1] - p0[1], nz = -(p1[0] - p0[0]);                       // (the outline goes round anticlockwise seen from -Y: this is outward)
    b.face(0, quadsAlong(p0, p1), () => [nx, 0, nz]);
  }
  // the two ends of the extrusion (y 0 and y 20): the L outline as two rectangles each
  b.face(0, [[[0, 0, 0], [30, 0, 0], [30, 0, 1], [0, 0, 1]], [[0, 0, 1], [1, 0, 1], [1, 0, 30], [0, 0, 30]]], () => [0, -1, 0]);
  b.face(0, [[[0, W, 0], [30, W, 0], [30, W, 1], [0, W, 1]], [[0, W, 1], [1, W, 1], [1, W, 30], [0, W, 30]]], () => [0, 1, 0]);
  const g = b.done();
  const r = removeThickness(g.positions, g.index, { cad: g.cad, maxThickness: 2 });
  const kept = r.ok && r.cad.faces.map((f, i) => f[2] ? i : -1).filter(i => i >= 0);
  // faces: 0 bottom (outer), 1 end of the foot, 2 top of the foot (inner), 3 inner side of the leg, 4 end of the leg, 5 outer side of the leg
  ok(r.ok && kept.length === 2 && kept.includes(0) && kept.includes(5), 'the two outer faces stay, as one surface (faces left: ' + kept + ')');
}
{
  console.log('a solid block 20 × 20 × 20');
  const b = builder(); box(b, [0, 0, 0], [20, 20, 20], 4);
  const g = b.done();
  const r = removeThickness(g.positions, g.index, { cad: g.cad, maxThickness: 2 });
  ok(!r.ok, 'nothing is thin: nothing changes (' + r.why + ')');
}
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exitCode = fails ? 1 : 0;
