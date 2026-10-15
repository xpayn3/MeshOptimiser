// node tests/meshcheck.test.mjs — checks meshcheck.js on meshes whose faults are known exactly.
import { checkMesh } from '../app/js/meshcheck.js';

let pass = 0, fail = 0;
const fails = [];
function expect(name, got, want, keys) {
  const bad = [];
  for (const k of keys || Object.keys(want)) {
    const g = got[k], w = want[k];
    const ok = (k === 'volume' || (typeof w === 'number' && !Number.isInteger(w))) ? Math.abs(g - w) <= Math.max(1e-9, Math.abs(w) * 1e-9) : g === w;
    if (!ok) bad.push(`${k}: got ${g}, wanted ${w}`);
  }
  if (bad.length) { fail++; fails.push(name + '\n    ' + bad.join('\n    ')); console.log('  FAIL', name, '\n    ' + bad.join('\n    ')); }
  else { pass++; console.log('  ok  ', name); }
}

// ── meshes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// a mesh is { pos: number[], idx: number[] }; faces are quads (a,b,c,d) of corner numbers, outward and counter-clockwise
const CUBE_V = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const CUBE_F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];    // bottom, top, front, back, left, right
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
// shared: one vertex per corner. split: every face has its own four (what a CAD tessellation looks like)
function cube({ split = false, noise = 0, size = 1, at = [0, 0, 0], skipTris = [], flipTris = [], dropFaces = [], inward = false } = {}) {
  const pos = [], idx = [];
  const put = (v) => { pos.push(at[0] + v[0] * size + (noise ? (rnd() * 2 - 1) * noise : 0), at[1] + v[1] * size + (noise ? (rnd() * 2 - 1) * noise : 0), at[2] + v[2] * size + (noise ? (rnd() * 2 - 1) * noise : 0)); return pos.length / 3 - 1; };
  const shared = split ? null : CUBE_V.map(put);
  let tri = 0;
  CUBE_F.forEach((f, fi) => {
    if (dropFaces.includes(fi)) return;
    const q = split ? f.map(c => put(CUBE_V[c])) : f.map(c => shared[c]);
    for (const t of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
      const k = tri++;
      if (skipTris.includes(k)) continue;
      let u = t; if (inward !== flipTris.includes(k)) u = [t[0], t[2], t[1]];
      idx.push(...u);
    }
  });
  return { pos, idx };
}
function merge(...ms) { const pos = [], idx = []; for (const m of ms) { const o = pos.length / 3; pos.push(...m.pos); for (const i of m.idx) idx.push(i + o); } return { pos, idx }; }
function signedVolume(m) { let v = 0; for (let t = 0; t < m.idx.length; t += 3) { const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3, p = m.pos; v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6; } return v; }
const outward = (m) => { if (signedVolume(m) < 0) for (let t = 0; t < m.idx.length; t += 3) { const x = m.idx[t + 1]; m.idx[t + 1] = m.idx[t + 2]; m.idx[t + 2] = x; } return m; };
function sphere(lat, lon, r = 1, at = [0, 0, 0]) {
  const pos = [at[0], at[1] + r, at[2]], idx = [];
  for (let i = 1; i < lat; i++) { const th = Math.PI * i / lat; for (let j = 0; j < lon; j++) { const ph = 2 * Math.PI * j / lon; pos.push(at[0] + r * Math.sin(th) * Math.cos(ph), at[1] + r * Math.cos(th), at[2] + r * Math.sin(th) * Math.sin(ph)); } }
  pos.push(at[0], at[1] - r, at[2]);
  const south = pos.length / 3 - 1, ring = (i, j) => 1 + (i - 1) * lon + (j % lon);
  for (let j = 0; j < lon; j++) idx.push(0, ring(1, j), ring(1, j + 1));
  for (let i = 1; i < lat - 1; i++) for (let j = 0; j < lon; j++) { idx.push(ring(i, j), ring(i + 1, j), ring(i + 1, j + 1)); idx.push(ring(i, j), ring(i + 1, j + 1), ring(i, j + 1)); }
  for (let j = 0; j < lon; j++) idx.push(south, ring(lat - 1, j + 1), ring(lat - 1, j));
  return outward({ pos, idx });
}
function torus(n, m, R = 2, r = 0.7) {
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const u = 2 * Math.PI * i / n, v = 2 * Math.PI * j / m; pos.push((R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)); }
  const id = (i, j) => (i % n) * m + (j % m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1)); idx.push(id(i, j), id(i + 1, j + 1), id(i, j + 1)); }
  return outward({ pos, idx });
}
const run = (m, o) => checkMesh(new Float32Array(m.pos), new Uint32Array(m.idx), o);
const CLEAN = { degenerate: 0, slivers: 0, duplicate: 0, openEdges: 0, holes: 0, nonManifoldEdges: 0, nonManifoldVertices: 0, inconsistent: 0, insideOut: 0, cavities: 0, mixedPieces: 0 };

console.log('clean surfaces');
expect('cube, one vertex per corner', run(cube()), { ...CLEAN, pieces: 1, closedPieces: 1, volume: 1, welded: 8 });
expect('cube, every face cut apart (CAD style)', run(cube({ split: true })), { ...CLEAN, pieces: 1, closedPieces: 1, volume: 1, welded: 8 });
expect('cube without an index (triangle soup)', checkMesh(new Float32Array(cube({ split: true }).idx.flatMap(i => cube({ split: true }).pos.slice(i * 3, i * 3 + 3))), null), { ...CLEAN, pieces: 1, closedPieces: 1, volume: 1 });
expect('sphere 40 x 60', run(sphere(40, 60)), { ...CLEAN, pieces: 1, closedPieces: 1 });
{ const s = sphere(40, 60), r = run(s); expect('sphere volume equals the volume worked out apart (to float precision) and is just under 4/3 pi', { same: Math.abs(r.volume - signedVolume(s)) < 1e-6, under: r.volume < 4 / 3 * Math.PI && r.volume > 4 / 3 * Math.PI * 0.99 }, { same: true, under: true }); }
expect('torus 40 x 24', run(torus(40, 24)), { ...CLEAN, pieces: 1, closedPieces: 1 });

console.log('welding');
{
  let bad = 0, openTotal = 0;
  for (let k = 0; k < 300; k++) {                // 300 random places and sizes: a seam must never open just because of where the grid falls
    const size = Math.pow(10, rnd() * 4 - 2), at = [(rnd() - .5) * 2000, (rnd() - .5) * 2000, (rnd() - .5) * 2000];
    const diag = size * Math.sqrt(3), tol = diag * 2e-6;
    const r = run(cube({ split: true, noise: tol * 0.25, size, at }));
    if (r.openEdges || r.holes || r.closedPieces !== 1 || r.pieces !== 1) { bad++; openTotal += r.openEdges; }
  }
  expect('300 random cubes with noise under the weld distance stay closed', { bad, openTotal }, { bad: 0, openTotal: 0 });
}
expect('a real gap (1e-3 of the size) is reported as cracks', run(cube({ split: true, noise: 1e-3 })), { closedPieces: 0 }, ['closedPieces']);
{ const r = run(cube({ split: true, noise: 1e-3 })); expect('...with open edges', { n: r.openEdges > 0 }, { n: true }); }

console.log('holes');
expect('one triangle missing', run(cube({ skipTris: [3] })), { openEdges: 3, holes: 1, closedPieces: 0, nonManifoldEdges: 0, pieces: 1 });
expect('a whole face missing', run(cube({ dropFaces: [1] })), { openEdges: 4, holes: 1, closedPieces: 0 });
expect('two opposite faces missing', run(cube({ dropFaces: [0, 1] })), { openEdges: 8, holes: 2, closedPieces: 0, pieces: 1 });
{
  const s = sphere(30, 40), v = 1 + 10 * 40 + 7;                   // an inner vertex of the sphere
  const keep = []; let removed = 0;
  for (let t = 0; t < s.idx.length; t += 3) { if (s.idx[t] === v || s.idx[t + 1] === v || s.idx[t + 2] === v) { removed++; continue; } keep.push(s.idx[t], s.idx[t + 1], s.idx[t + 2]); }
  expect('sphere with the triangles round one vertex taken out', run({ pos: s.pos, idx: keep }), { openEdges: removed, holes: 1, closedPieces: 0, nonManifoldVertices: 0 });
}

console.log('direction of the faces');
expect('every face turned (inside out)', run(cube({ inward: true })), { ...CLEAN, insideOut: 1, closedPieces: 1, volume: 0 }, [...Object.keys(CLEAN), 'closedPieces', 'volume']);
expect('one triangle turned the wrong way', run(cube({ flipTris: [4] })), { inconsistent: 3, mixedPieces: 1, insideOut: 0, closedPieces: 1 }, ['inconsistent', 'mixedPieces', 'insideOut', 'closedPieces']);
expect('two neighbouring triangles turned', run(cube({ flipTris: [4, 5] })), { inconsistent: 4, mixedPieces: 1 }, ['inconsistent', 'mixedPieces']);
expect('a sphere turned inside out', run((() => { const s = sphere(20, 30); for (let t = 0; t < s.idx.length; t += 3) { const x = s.idx[t + 1]; s.idx[t + 1] = s.idx[t + 2]; s.idx[t + 2] = x; } return s; })()), { insideOut: 1, inconsistent: 0 }, ['insideOut', 'inconsistent']);

console.log('doubled and empty triangles');
{
  const c = cube(); const dup = { pos: c.pos, idx: [...c.idx, c.idx[0], c.idx[1], c.idx[2]] };
  expect('a triangle there twice', run(dup), { ...CLEAN, duplicate: 1, closedPieces: 1, pieces: 1 }, [...Object.keys(CLEAN), 'closedPieces', 'pieces']);
  const rev = { pos: c.pos, idx: [...c.idx, c.idx[0], c.idx[2], c.idx[1]] };
  expect('a triangle there twice, the second turned round', run(rev), { duplicate: 1, nonManifoldEdges: 0, openEdges: 0, closedPieces: 1 }, ['duplicate', 'nonManifoldEdges', 'openEdges', 'closedPieces']);
}
{
  const c = cube(); const n = c.pos.length / 3;
  const m = { pos: [...c.pos, 3, 3, 3, 4, 3, 3, 5, 3, 3], idx: [...c.idx, 0, 0, 1, 2, 2, 2, n, n + 1, n + 2] };    // two collapsed ones and three on a line
  expect('collapsed triangles and one on a line are counted and do not spoil the surface', run(m), { degenerate: 3, openEdges: 0, closedPieces: 1, pieces: 1, holes: 0 });
}
{
  const c = cube(); const n = c.pos.length / 3;
  const m = { pos: [...c.pos, 3, 3, 3, 4, 3, 3, 3.5, 3.0003, 3], idx: [...c.idx, n, n + 1, n + 2] };
  expect('a needle is a sliver, not empty', run(m), { slivers: 1, degenerate: 0 }, ['slivers', 'degenerate']);
}

console.log('pieces');
expect('two cubes apart', run(merge(cube(), cube({ at: [5, 0, 0] }))), { ...CLEAN, pieces: 2, closedPieces: 2, volume: 2 });
{
  const c = cube(), n = c.pos.length / 3;
  const m = { pos: [...c.pos, 5, 5, 5, 6, 5, 5, 5, 6, 5], idx: [...c.idx, n, n + 1, n + 2] };
  expect('a loose triangle by a cube', run(m), { pieces: 2, closedPieces: 1, openEdges: 3, holes: 1 });
}
expect('a cube with a hollow in it (inner faces point inward)', run(merge(cube(), cube({ size: .3, at: [.35, .35, .35], inward: true }))), { pieces: 2, closedPieces: 2, cavities: 1, insideOut: 0, volume: 1 });
expect('an inward cube that is not inside anything is inside out', run(merge(cube(), cube({ size: .3, at: [3, 0, 0], inward: true }))), { cavities: 0, insideOut: 1, closedPieces: 2 }, ['cavities', 'insideOut', 'closedPieces']);

console.log('not a clean surface');
{
  const c = cube(), n = c.pos.length / 3;
  const m = { pos: [...c.pos, 0.5, -1, 0.5], idx: [...c.idx, 0, 1, n] };       // a fin on the edge between the front and the bottom face
  expect('a third triangle on an edge', run(m), { nonManifoldEdges: 1, openEdges: 2, closedPieces: 0 });
}
{
  const m = { pos: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, -1, 0, 0].map((x, i) => x), idx: [0, 1, 2, 0 + 3, 4, 5] };
  // two triangles that meet at one point only: their corner 0 and corner 3 are in the same place
  expect('two triangles touching at one point (a bow-tie)', run(m), { nonManifoldVertices: 1, pieces: 1, openEdges: 6 });
}

console.log('everything at once');
{
  const c = cube({ split: true, skipTris: [2], flipTris: [8] });          // one triangle missing, one turned
  const n = c.pos.length / 3;
  const m = { pos: [...c.pos, 9, 9, 9, 9, 9, 9, 9, 9, 9], idx: [...c.idx, c.idx[0], c.idx[1], c.idx[2], n, n + 1, n + 2] };
  expect('missing + flipped + doubled + empty', run(m), { openEdges: 3, holes: 1, duplicate: 1, degenerate: 1, closedPieces: 0 }, ['openEdges', 'holes', 'duplicate', 'degenerate', 'closedPieces']);
}

console.log('speed');
{
  const s = sphere(500, 1000), t0 = performance.now(), r = run(s), ms = performance.now() - t0;
  console.log(`      ${(s.idx.length / 3).toLocaleString()} triangles in ${ms.toFixed(0)} ms`);
  expect('a sphere of a million triangles is checked and is clean', r, { ...CLEAN, pieces: 1, closedPieces: 1 });
  expect('...in under 6 seconds', { ok: ms < 6000 }, { ok: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
