// node tests/voxel.test.mjs — checks voxel.js (Voxel remesh) on shapes built here.
import { voxelRemesh } from '../app/js/voxel.js';
import { MeshoptSimplifier } from '../app/vendor/meshoptimizer/meshopt_simplifier.module.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// boxes, each its own closed shell (as CAD bodies often are)
function boxes(list) {
  const P = [], I = [];
  for (const [x0, y0, z0, x1, y1, z1] of list) {
    const b = P.length / 3;
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) P.push(x, y, z);
    for (const f of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) I.push(...f.map(k => b + k));
  }
  return { positions: new Float32Array(P), index: new Uint32Array(I) };
}
const volume = (g) => { let v = 0; const P = g.positions, I = g.index; for (let t = 0; t < I.length; t += 3) { const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2]; v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); } return v / 6; };
function badEdges(g) {
  const key = i => [0, 1, 2].map(k => Math.round(g.positions[3 * i + k] * 1e4)).join(',');
  const ids = new Map(), id = i => { const k = key(i); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const e = new Map();
  for (let t = 0; t < g.index.length; t += 3) for (let j = 0; j < 3; j++) { const a = id(g.index[t + j]), b = id(g.index[t + (j + 1) % 3]); if (a !== b) e.set(a + '>' + b, (e.get(a + '>' + b) || 0) + 1); }
  let bad = 0; for (const [k, n] of e) { const [a, b] = k.split('>'); if (n !== 1 || e.get(b + '>' + a) !== 1) bad++; }
  return bad;
}
const bbox = (g) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < g.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], g.positions[i + k]); hi[k] = Math.max(hi[k], g.positions[i + k]); } return [lo, hi]; };
const mesh = (r) => ({ positions: r.positions, index: r.index });

await MeshoptSimplifier.ready;
// A block 40 × 20 × 10 with six fins 4 wide and 8 tall on top, 3 apart (the last one 5 wide), each fin its own box.
const fins = [[0, 4], [7, 11], [14, 18], [21, 25], [28, 32], [35, 40]];
const part = boxes([[0, 0, 0, 40, 20, 10], ...fins.map(([a, b]) => [a, 0, 10, b, 20, 18])]);
const v0 = 8000 + fins.reduce((s, [a, b]) => s + (b - a) * 20 * 8, 0);

{
  const r = voxelRemesh(part.positions, part.index, { simplifier: MeshoptSimplifier });
  ok(r.ok, 'a plain remesh runs' + (r.why ? ' (' + r.why + ')' : ''));
  const g = mesh(r), v = volume(g), [lo, hi] = bbox(g);
  ok(Math.abs(v - v0) < 0.03 * v0, 'it keeps the shape, fins and gaps: ' + Math.round(v) + ' against ' + v0);
  ok(Math.abs(lo[0]) < 0.4 && Math.abs(hi[0] - 40) < 0.4 && Math.abs(hi[2] - 18) < 0.4, 'and its size (' + lo.map(x => x.toFixed(2)) + ' / ' + hi.map(x => x.toFixed(2)) + ')');
  ok(badEdges(g) === 0, 'seven overlapping boxes come out as one closed surface');
  ok(r.grid[0] >= 160, 'the detail defaults to 160 cells along the longest side (' + r.grid + ')');
}
{
  const a = voxelRemesh(part.positions, part.index, { simplifier: MeshoptSimplifier, adaptivity: 0 });
  const b = voxelRemesh(part.positions, part.index, { simplifier: MeshoptSimplifier, adaptivity: 0.5 });
  ok(a.after.triangles > b.after.triangles * 3, 'adaptivity 0 keeps every face of the grid, 0.5 reduces: ' + a.after.triangles + ' against ' + b.after.triangles);
  const lo = voxelRemesh(part.positions, part.index, { simplifier: MeshoptSimplifier, adaptivity: 0, cells: 64 });
  ok(lo.after.triangles < a.after.triangles, 'less detail, fewer faces: 64 cells ' + lo.after.triangles + ', 160 cells ' + a.after.triangles);
}
{
  const r = voxelRemesh(part.positions, part.index, { width: 5, simplifier: MeshoptSimplifier });
  const v = volume(mesh(r));
  ok(Math.abs(v - 40 * 20 * 18) < 0.05 * 40 * 20 * 18, 'Close gaps 5: the 3 wide gaps between the fins are filled: ' + Math.round(v) + ' (a solid 40 × 20 × 18 is 14,400)');
  ok(badEdges(mesh(r)) === 0, 'and it is closed');
  const r2 = voxelRemesh(part.positions, part.index, { width: 2, simplifier: MeshoptSimplifier });
  ok(Math.abs(volume(mesh(r2)) - v0) < 0.06 * v0, 'Close gaps 2 (under the gaps): nothing is filled');
}
{
  // a hollow box (an inner shell facing in): the hollow is filled, nothing hidden is kept
  const P = [], I = [];
  const add = (x0, y0, z0, x1, y1, z1, inward) => {
    const b = P.length / 3;
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) P.push(x, y, z);
    for (const f of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) I.push(...(inward ? [f[0], f[2], f[1]] : f).map(k => b + k));
  };
  add(0, 0, 0, 20, 20, 20, false); add(2, 2, 2, 18, 18, 18, true);
  const r = voxelRemesh(new Float32Array(P), new Uint32Array(I), { simplifier: MeshoptSimplifier });
  ok(Math.abs(volume(mesh(r)) - 8000) < 0.03 * 8000 && badEdges(mesh(r)) === 0, 'a hollow box comes out solid, one closed surface: ' + Math.round(volume(mesh(r))));
}
{
  const r = voxelRemesh(part.positions, part.index, { dryRun: true });
  ok(r.ok && !r.positions && r.cell > 0, 'a dry run measures without building (cell ' + r.cell.toFixed(3) + ')');
}

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
