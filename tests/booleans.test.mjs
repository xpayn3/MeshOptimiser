// node tests/booleans.test.mjs — checks booleans.js (Merge bodies, Subtract, Intersect with Manifold) on boxes built here.
import { manifoldReady, mergeBodies, booleanOf, bodiesOf } from '../app/js/booleans.js';

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

const W = await manifoldReady();
ok(!!W && !!W.Manifold, 'Manifold loads');
{
  // two boxes 10 × 10 × 10 overlapping by half, and a small box wholly inside the first, all in one part
  const g = boxes([[0, 0, 0, 10, 10, 10], [5, 0, 0, 15, 10, 10], [2, 2, 2, 4, 4, 4]]);
  ok(bodiesOf(g.positions, g.index).length === 3, 'the part has three bodies');
  const r = mergeBodies(W, g.positions, g.index);
  ok(r.ok && r.merged === 3 && r.notClosed === 0, 'all three are merged');
  ok(Math.abs(volume(r) - 1500) < 1e-3 && Math.abs(r.volume - 1500) < 1e-3, 'into one solid 15 × 10 × 10: ' + volume(r).toFixed(3));
  ok(bodiesOf(r.positions, r.index).length === 1, 'one body now (the one inside is gone, the faces where they met are gone)');
}
{
  const a = boxes([[0, 0, 0, 10, 10, 10]]), b = boxes([[5, 5, 5, 15, 15, 15]]);
  const s = booleanOf(W, 'subtract', a, b), i = booleanOf(W, 'intersect', a, b), u = booleanOf(W, 'union', a, b);
  ok(Math.abs(volume(s) - (1000 - 125)) < 1e-3, 'subtract: 1,000 less the 125 they share = ' + volume(s).toFixed(3));
  ok(Math.abs(volume(i) - 125) < 1e-3, 'intersect: the 125 they share = ' + volume(i).toFixed(3));
  ok(Math.abs(volume(u) - (2000 - 125)) < 1e-3, 'union: 1,875 = ' + volume(u).toFixed(3));
  const far = booleanOf(W, 'intersect', a, boxes([[50, 50, 50, 60, 60, 60]]));
  ok(far.ok && far.empty, 'two parts that do not touch intersect in nothing');
}
{
  // the Boolean card's other styles: A without B, Split, intersect with several B, Optimise points
  const a = boxes([[0, 0, 0, 10, 10, 10]]), b = boxes([[5, 5, 5, 15, 15, 15]]);
  const w = booleanOf(W, 'without', a, b);
  const area = (g) => { let s = 0; const P = g.positions, I = g.index; for (let t = 0; t < I.length; t += 3) { const p = 3 * I[t], q = 3 * I[t + 1], r = 3 * I[t + 2]; const ux = P[q] - P[p], uy = P[q + 1] - P[p + 1], uz = P[q + 2] - P[p + 2], vx = P[r] - P[p], vy = P[r + 1] - P[p + 1], vz = P[r + 2] - P[p + 2]; s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; } return s; };
  ok(w.ok && Math.abs(area(w) - (600 - 75)) < 1e-3, 'without: A\'s own faces less the 3 × 25 inside B, no faces close the cut: area ' + area(w).toFixed(3));
  const edges = new Map(); for (let t = 0; t < w.index.length; t += 3) for (let k = 0; k < 3; k++) { const x = w.index[t + k], y = w.index[t + (k + 1) % 3], key = Math.min(x, y) + ',' + Math.max(x, y); edges.set(key, (edges.get(key) || 0) + 1); }
  ok([...edges.values()].some(n => n === 1), 'without: the cut is left open (it has open edges)');
  const sp = booleanOf(W, 'split', a, b);
  ok(sp.ok && Math.abs(volume(sp) - 875) < 1e-3 && sp.second && Math.abs(volume(sp.second) - 125) < 1e-3, 'split: 875 outside B and 125 inside, as two meshes: ' + volume(sp).toFixed(3) + ' + ' + (sp.second ? volume(sp.second).toFixed(3) : '-'));
  ok(booleanOf(W, 'split', a, boxes([[50, 50, 50, 60, 60, 60]])).empty, 'split: a B that does not reach A splits nothing');
  const b2 = boxes([[0, 5, 0, 10, 15, 10]]);
  const every = booleanOf(W, 'intersect', a, [b, b2]), any = booleanOf(W, 'intersect', a, [b, b2], { all: false });
  ok(Math.abs(volume(every) - 125) < 1e-3, 'intersect with two B: what A shares with every one = ' + volume(every).toFixed(3));
  ok(Math.abs(volume(any) - 500) < 1e-3, 'intersect with two B, all false: what A shares with any of them = ' + volume(any).toFixed(3));
  const u = booleanOf(W, 'union', a, [b, b2]), t = booleanOf(W, 'union', a, [b, b2], { tol: 0.01 });
  ok(t.ok && Math.abs(volume(t) - volume(u)) < 1e-3 && t.index.length <= u.index.length, 'Optimise points keeps the shape: ' + u.index.length / 3 + ' → ' + t.index.length / 3 + ' triangles');
}
{
  // a box with one face missing is not closed: left as it was
  const g = boxes([[0, 0, 0, 10, 10, 10], [20, 0, 0, 30, 10, 10]]);
  const open = { positions: g.positions, index: g.index.slice(0, g.index.length - 6) };
  const r = mergeBodies(W, open.positions, open.index);
  ok(r.ok && r.merged === 1 && r.notClosed === 1, 'a body that is not closed is left as it was (' + r.notClosed + '), the closed one goes through');
}

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
