// node tests/convex.test.mjs — checks convex.js (Convex hull, Convex pieces) on an L-shaped part built here.
import { convexHull, convexPieces, hullOf } from '../app/js/convex.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
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

// an L: a bar 40 × 10 × 10 and an upright 10 × 10 × 30 on its end (volume 4,000 + 2,000 = 6,000 where they do not overlap)
const L = boxes([[0, 0, 0, 40, 10, 10], [0, 0, 10, 10, 10, 40]]);
{
  const r = convexHull(L.positions, L.index);
  ok(r.ok, 'the hull is made (' + r.points + ' points)');
  // every point of the part is inside it (or on it)
  const faces = [];
  for (let t = 0; t < r.index.length; t += 3) {
    const p = [0, 1, 2].map(k => [r.positions[3 * r.index[t + k]], r.positions[3 * r.index[t + k] + 1], r.positions[3 * r.index[t + k] + 2]]);
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n);
    faces.push({ n: n.map(x => x / l), o: (n[0] * p[0][0] + n[1] * p[0][1] + n[2] * p[0][2]) / l });
  }
  let outside = 0;
  for (let i = 0; i < L.positions.length; i += 3) { const p = [L.positions[i], L.positions[i + 1], L.positions[i + 2]]; if (faces.some(f => f.n[0] * p[0] + f.n[1] * p[1] + f.n[2] * p[2] - f.o > 1e-6)) outside++; }
  ok(outside === 0, 'every point of the part is inside it');
  const hv = volume(r);
  ok(Math.abs(hv - 11500) < 1, 'it is the hull of the L: ' + hv.toFixed(1) + ' (its outline from the side is 1,150, 10 deep: 11,500)');
  const small = hullOf([...Array(500)].map((_, i) => [Math.cos(i * 0.7) * 10, Math.sin(i * 1.3) * 10, Math.sin(i * 0.37) * 10]), 32);
  ok(small && small.points.length <= 32, 'a points limit is kept (' + (small && small.points.length) + ' of at most 32)');
}
{
  const r = convexPieces(L.positions, L.index, { maxPieces: 4, cells: 48 });
  ok(r.ok && r.pieces >= 2 && r.pieces <= 4, 'the L becomes ' + r.pieces + ' convex pieces');
  const v = volume(r);
  ok(Math.abs(v - 6000) < 0.15 * 6000, 'together they follow the L, not its hull: ' + Math.round(v) + ' (the L is 6,000, its hull 11,500)');
}

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
