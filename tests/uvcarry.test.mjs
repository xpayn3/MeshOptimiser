// node tests/uvcarry.test.mjs
// carryUvs: the UVs of a part come back after a tool rebuilt its mesh.
//   1. the tool only moved points (same triangles): the UVs are copied as they are;
//   2. a plane with UV = (x, y), triangulated again finer: every new vertex reads UV = its own (x, y);
//   3. a cube whose six faces are six UV islands, welded into eight shared corners by a tool: each face gets its own UVs back and the
//      corners are split again at the seams (no triangle takes one corner from another face's island);
//   4. a second UV set is carried at the same points.
import { carryUvs } from '../app/js/uvcarry.js';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;

// 1. same triangles
{
  const P = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), I = new Uint32Array([0, 1, 2]), uv = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  const r = carryUvs({ srcP: P, srcI: I, sets: { uv }, outP: new Float32Array([0, 0, 0.1, 1, 0, 0.1, 0, 1, 0.1]), outN: null, outI: I.slice() });
  check('moved points keep their UVs', r && r.sets.uv.every((v, i) => v === uv[i]));
}

// a grid on z = 0 from (0,0) to (1,1) with n x n cells
const grid = (n, uvOf) => {
  const P = [], U = [], I = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { P.push(i / n, j / n, 0); U.push(...uvOf(i / n, j / n)); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 2, d = a + n + 1; I.push(a, b, c, a, c, d); }
  return { P: new Float32Array(P), U: new Float32Array(U), I: new Uint32Array(I) };
};

// 2. finer triangulation of a plane
{
  const src = grid(3, (x, y) => [x, y]), out = grid(7, () => [0, 0]);
  const r = carryUvs({ srcP: src.P, srcI: src.I, sets: { uv: src.U }, outP: out.P, outN: null, outI: out.I });
  let worst = 0;
  for (let v = 0; v < r.positions.length / 3; v++) worst = Math.max(worst, Math.abs(r.sets.uv[v * 2] - r.positions[v * 3]), Math.abs(r.sets.uv[v * 2 + 1] - r.positions[v * 3 + 1]));
  check('a plane triangulated again reads UV = (x, y) at every vertex', worst < 1e-5, worst);
  check('no vertex was split on a plane without seams', r.positions.length === out.P.length, [r.positions.length / 3, out.P.length / 3]);
}

// 3 and 4. a cube: six faces, each its own island (its own four corners, UV 0..1 on the face, a second set offset by the face number)
{
  const faces = [   // [axis, sign]: the face's two in-plane axes are the other two
    [0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];
  const P = [], U = [], U1 = [], I = [];
  faces.forEach(([ax, s], f) => {
    const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3, base = P.length / 3;
    for (const [p, q] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const v = [0, 0, 0]; v[ax] = s > 0 ? 1 : 0; v[a1] = p; v[a2] = q; P.push(...v); U.push(p, q); U1.push(p + f, q); }
    if (s > 0) I.push(base, base + 1, base + 2, base, base + 2, base + 3); else I.push(base, base + 2, base + 1, base, base + 3, base + 2);
  });
  // the tool's result: the same 12 triangles on 8 shared corners
  const key = (i) => P[i * 3] + ',' + P[i * 3 + 1] + ',' + P[i * 3 + 2], ids = new Map(), OP = [], OI = [];
  for (const i of I) { const k = key(i); if (!ids.has(k)) { ids.set(k, OP.length / 3); OP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); } OI.push(ids.get(k)); }
  const r = carryUvs({ srcP: new Float32Array(P), srcI: new Uint32Array(I), sets: { uv: new Float32Array(U), uv1: new Float32Array(U1) }, outP: new Float32Array(OP), outN: new Float32Array(OP.length), outI: new Uint32Array(OI) });
  check('the welded cube is split back into 24 corners (four per face)', r.positions.length / 3 === 24, r.positions.length / 3);
  let bad = 0, bad1 = 0;
  for (let t = 0; t < r.index.length / 3; t++) {
    // the face of this triangle: the axis on which its three corners agree
    const c = [0, 1, 2].map((k) => r.index[t * 3 + k]);
    const ax = [0, 1, 2].find((a) => c.every((v) => r.positions[v * 3 + a] === r.positions[c[0] * 3 + a]));
    const s = r.positions[c[0] * 3 + ax] > 0.5 ? 1 : -1, f = faces.findIndex(([a, ss]) => a === ax && ss === s), a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
    for (const v of c) {
      if (!near(r.sets.uv[v * 2], r.positions[v * 3 + a1]) || !near(r.sets.uv[v * 2 + 1], r.positions[v * 3 + a2])) bad++;
      if (!near(r.sets.uv1[v * 2], r.positions[v * 3 + a1] + f) || !near(r.sets.uv1[v * 2 + 1], r.positions[v * 3 + a2])) bad1++;
    }
  }
  check('every corner of the welded cube reads its own face\'s UV', bad === 0, bad);
  check('the second UV set is carried at the same points', bad1 === 0, bad1);
}

// no UVs: nothing to do
check('a part without UVs gives null', carryUvs({ srcP: new Float32Array(9), srcI: new Uint32Array([0, 1, 2]), sets: {}, outP: new Float32Array(9), outN: null, outI: new Uint32Array([0, 1, 2]) }) === null);

console.log(fail ? `${fail} failed, ${pass} passed` : `ok: ${pass} passed`);
process.exit(fail ? 1 : 0);
