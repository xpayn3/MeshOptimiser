// node tests/meshfix.test.mjs — checks meshfix.js (Close cracks, Remove slivers, Patch holes) on shapes built here.
import { closeCracks, removeSlivers, patchHoles } from '../app/js/meshfix.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const openEdges = (g) => {
  const key = i => [0, 1, 2].map(k => Math.round(g.positions[3 * i + k] * 1e6)).join(',');
  const ids = new Map(), id = i => { const k = key(i); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const e = new Map();
  for (let t = 0; t < g.index.length; t += 3) for (let j = 0; j < 3; j++) { const a = id(g.index[t + j]), b = id(g.index[t + (j + 1) % 3]); if (a === b) continue; const k = a < b ? a + ',' + b : b + ',' + a; e.set(k, (e.get(k) || 0) + 1); }
  let open = 0; for (const n of e.values()) if (n !== 2) open++;
  return open;
};
const area = (g) => { let s = 0; const P = g.positions, I = g.index; for (let t = 0; t < I.length; t += 3) { const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2]; const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]; s += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; } return s; };
function soup() { const P = [], I = []; return { P, I, tri(a, b, c) { const n = P.length / 3; P.push(...a, ...b, ...c); I.push(n, n + 1, n + 2); }, done() { return { positions: new Float32Array(P), index: new Uint32Array(I) }; } }; }

{
  // A unit cube, CAD style (each face its own vertices). The top face has a vertex in the middle of its +x edge (a T-junction with
  // the +x face, which has none there), and the +x face sits 0.00002 out (a hairline crack).
  const m = soup(), g = 0.00002;
  const quad = (a, b, c, d) => { m.tri(a, b, c); m.tri(a, c, d); };
  quad([0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]);                                    // bottom
  m.tri([0, 0, 1], [1, 0, 1], [1, 0.5, 1]); m.tri([0, 0, 1], [1, 0.5, 1], [0, 1, 1]); m.tri([0, 1, 1], [1, 0.5, 1], [1, 1, 1]);   // top, with the extra vertex
  quad([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]);                                    // front
  quad([0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]);                                    // back
  quad([0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]);                                    // left
  quad([1 + g, 0, 0], [1 + g, 1, 0], [1 + g, 1, 1], [1 + g, 0, 1]);                    // right, a hair out
  const src = m.done(), r = closeCracks(src.positions, src.index, { tol: 0.001 });
  ok(r.openBefore > 0, 'the cube has open edges to begin with (' + r.openBefore + ')');
  ok(r.openAfter === 0 && openEdges(r) === 0, 'after Close cracks it is closed (' + r.joined + ' points joined, ' + r.split + ' edges split)');
  ok(Math.abs(area(r) - 6) < 0.001, 'nothing moved further than the crack: area ' + area(r).toFixed(5));
}
{
  // A flat sheet 1 × 1 cut into four, with a needle (a vertex 0.001 from a corner) and a cap (a vertex 0.0005 off a long edge).
  const m = soup();
  const A = [0, 0, 0], B = [1, 0, 0], C = [1, 1, 0], D = [0, 1, 0], N = [0.001, 0.0005, 0], E = [0.5, 0.0005, 0];
  m.tri(A, N, D); m.tri(N, E, D); m.tri(N, A, E); m.tri(A, B, E); m.tri(E, B, C); m.tri(E, C, D);
  const src = m.done(), r = removeSlivers(src.positions, src.index);
  ok(r.collapsed + r.flipped >= 1, 'needles and caps are cleaned (' + r.collapsed + ' collapsed, ' + r.flipped + ' flipped)');
  ok(Math.abs(area(r) - 1) < 1e-3, 'the sheet keeps its area: ' + area(r).toFixed(5));
  let worst = 1;
  for (let t = 0; t < r.index.length; t += 3) {
    const p = [0, 1, 2].map(k => [r.positions[3 * r.index[t + k]], r.positions[3 * r.index[t + k] + 1]]);
    const e = [0, 1, 2].map(k => Math.hypot(p[(k + 1) % 3][0] - p[k][0], p[(k + 1) % 3][1] - p[k][1]));
    const z = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    if (z <= 0) worst = -1; else worst = Math.min(worst, Math.min(...e) / Math.max(...e));
  }
  ok(worst > 0.04, 'no needle is left and nothing turned over (shortest edge ' + (worst * 100).toFixed(1) + ' % of the longest)');
}
{
  // A strip of 12 unit squares, each with a cap: a point 0.002 off the middle of its diagonal makes the triangle (a, m, c) nearly
  // flat (its angle at m is about 179.5°). All twelve must be flipped away, not only the first few.
  const m = soup();
  for (let i = 0; i < 12; i++) {
    const a = [i, 0, 0], b = [i + 1, 0, 0], c = [i + 1, 1, 0], d = [i, 1, 0], mid = [i + 0.5 + 0.0014, 0.5 - 0.0014, 0];
    m.tri(a, b, mid); m.tri(b, c, mid); m.tri(a, mid, c); m.tri(a, c, d);
  }
  const src = m.done(), r = removeSlivers(src.positions, src.index);
  let worst = 0;
  for (let t = 0; t < r.index.length; t += 3) {
    const p = [0, 1, 2].map(k => [r.positions[3 * r.index[t + k]], r.positions[3 * r.index[t + k] + 1]]);
    for (let k = 0; k < 3; k++) { const o = p[k], u = [p[(k + 1) % 3][0] - o[0], p[(k + 1) % 3][1] - o[1]], w = [p[(k + 2) % 3][0] - o[0], p[(k + 2) % 3][1] - o[1]]; worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w))))) * 180 / Math.PI); }
  }
  ok(r.flipped >= 12 && worst < 170, 'twelve caps in a strip are all flipped (' + r.flipped + ' flipped; the widest angle left is ' + worst.toFixed(1) + '°)');
  ok(Math.abs(area(r) - 12) < 1e-6, 'and the strip keeps its area: ' + area(r).toFixed(6));
}
{
  // A sphere (radius 10, 32 × 16) with the triangles round its top pole taken out: a hole in a curved surface.
  const P = [], I = [], R = 10, NU = 32, NV = 16;
  for (let j = 0; j <= NV; j++) for (let i = 0; i < NU; i++) { const th = Math.PI * j / NV, ph = 2 * Math.PI * i / NU; P.push(R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph), R * Math.cos(th)); }
  const v = (i, j) => j * NU + (i % NU);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { if (j < 3) continue; I.push(v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i + 1, j)); }
  const src = { positions: new Float32Array(P), index: new Uint32Array(I) };
  ok(openEdges(src) > 0, 'the sphere has a hole');
  const r = patchHoles(src.positions, src.index, { maxSize: 15 });
  ok(r.patched === 1 && openEdges(r) === 0, 'Patch holes closes it (' + r.patched + ' of ' + r.holes + ')');
  // the new points lie near the sphere (the patch carries the curve), not on the flat disc across the hole
  let off = 0, n = 0;
  for (let i = 0; i < r.positions.length; i += 3) { const z = r.positions[i + 2]; if (z > R * Math.cos(3 * Math.PI / NV) + 0.01) { off = Math.max(off, Math.abs(Math.hypot(r.positions[i], r.positions[i + 1], z) - R)); n++; } }
  const flatGap = R - R * Math.cos(3 * Math.PI / NV);
  ok(n > 3 && off < 0.35 * flatGap, 'the patch follows the sphere: ' + n + ' new points, at most ' + off.toFixed(3) + ' off it (a flat cap would be ' + flatGap.toFixed(3) + ' off)');
  const big = patchHoles(src.positions, src.index, { maxSize: 2 });
  ok(big.patched === 0 && big.skipped === 1, 'a hole bigger than the limit is left open');
}

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
