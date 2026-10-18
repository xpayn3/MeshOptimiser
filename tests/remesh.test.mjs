// node tests/remesh.test.mjs — checks remesh.js (Remesh evenly) on a CAD-style cube and a sphere built here.
import { remeshEvenly } from '../app/js/remesh.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const badEdges = (g) => {
  const e = new Map();
  for (let t = 0; t < g.index.length; t += 3) for (let j = 0; j < 3; j++) { const a = g.index[t + j], b = g.index[t + (j + 1) % 3]; const k = a + '>' + b; e.set(k, (e.get(k) || 0) + 1); }
  let bad = 0; for (const [k, n] of e) { const [a, b] = k.split('>'); if (n !== 1 || e.get(b + '>' + a) !== 1) bad++; }
  return bad;
};
const stats = (g) => {
  const lens = [], ang = [];
  for (let t = 0; t < g.index.length; t += 3) {
    const p = [0, 1, 2].map(k => [g.positions[3 * g.index[t + k]], g.positions[3 * g.index[t + k] + 1], g.positions[3 * g.index[t + k] + 2]]);
    for (let k = 0; k < 3; k++) {
      const a = p[k], b = p[(k + 1) % 3], c = p[(k + 2) % 3];
      lens.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      ang.push(Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w))))) * 180 / Math.PI);
    }
  }
  ang.sort((a, b) => a - b); lens.sort((a, b) => a - b);
  return { minAng: ang[Math.floor(ang.length * 0.02)], medLen: lens[lens.length >> 1], p95: lens[Math.floor(lens.length * 0.95)], p5: lens[Math.floor(lens.length * 0.05)] };
};

{
  // a cube 10 × 10 × 10 in twelve long triangles, each face its own vertices
  const P = [], I = [];
  const quad = (a, b, c, d) => { const n = P.length / 3; P.push(...a, ...b, ...c, ...d); I.push(n, n + 1, n + 2, n, n + 2, n + 3); };
  quad([0, 0, 0], [0, 10, 0], [10, 10, 0], [10, 0, 0]); quad([0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]);
  quad([0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]); quad([0, 10, 0], [0, 10, 10], [10, 10, 10], [10, 10, 0]);
  quad([0, 0, 0], [0, 0, 10], [0, 10, 10], [0, 10, 0]); quad([10, 0, 0], [10, 10, 0], [10, 10, 10], [10, 0, 10]);
  const r = remeshEvenly(new Float32Array(P), new Uint32Array(I), { length: 1 });
  ok(r.ok && r.triangles > 400, 'the cube is remeshed into even triangles (' + r.triangles + ', edge ' + r.length + ')');
  ok(badEdges(r) === 0, 'it is closed and every triangle faces out the same way round');
  let off = 0, corners = 0;
  for (let i = 0; i < r.positions.length; i += 3) {
    const p = [r.positions[i], r.positions[i + 1], r.positions[i + 2]];
    off = Math.max(off, Math.min(...p.map(x => Math.min(Math.abs(x), Math.abs(x - 10)))));             // on a face: one coordinate is 0 or 10
    if (p.every(x => Math.abs(x) < 1e-4 || Math.abs(x - 10) < 1e-4)) corners++;
  }
  ok(off < 1e-4, 'every point is on the cube (at most ' + off.toExponential(1) + ' off)');
  ok(corners === 8, 'the eight corners are still there (' + corners + ')');
  // the edges stay sharp: no triangle crosses one (each lies in one face)
  let crossing = 0;
  for (let t = 0; t < r.index.length; t += 3) {
    const p = [0, 1, 2].map(k => [r.positions[3 * r.index[t + k]], r.positions[3 * r.index[t + k] + 1], r.positions[3 * r.index[t + k] + 2]]);
    const flat = [0, 1, 2].some(ax => [0, 10].some(v => p.every(q => Math.abs(q[ax] - v) < 1e-4)));
    if (!flat) crossing++;
  }
  ok(crossing === 0, 'no triangle bends round an edge: the edges stay sharp (' + crossing + ')');
  const s = stats(r);
  ok(s.minAng > 25 && s.p95 < 1.6 && s.p5 > 0.5, 'the triangles are even: angles over ' + s.minAng.toFixed(1) + '° (all but 2 %), edges ' + s.p5.toFixed(2) + ' to ' + s.p95.toFixed(2) + ' (target 1)');
}
{
  // a sphere of radius 10 in long thin bands (8 × 64): remeshed, it keeps its shape
  const P = [], I = [], R = 10, NU = 64, NV = 8;
  for (let j = 0; j <= NV; j++) for (let i = 0; i < NU; i++) { const th = Math.PI * j / NV, ph = 2 * Math.PI * i / NU; P.push(R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph), R * Math.cos(th)); }
  const v = (i, j) => j * NU + (i % NU);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) I.push(v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i + 1, j));
  const r = remeshEvenly(new Float32Array(P), new Uint32Array(I), { length: 1.5 });
  let off = 0; for (let i = 0; i < r.positions.length; i += 3) off = Math.max(off, Math.abs(Math.hypot(r.positions[i], r.positions[i + 1], r.positions[i + 2]) - R));
  ok(r.ok && off < 0.25, 'the sphere stays on its own surface (at most ' + off.toFixed(3) + ' from the true sphere; its flat bands are up to 0.24 inside it)');
  const s = stats(r);
  ok(s.minAng > 20, 'with even triangles (angles over ' + s.minAng.toFixed(1) + '°)');
  ok(badEdges(r) === 0, 'and closed');
}

{
  // many flips at once: the faceted sphere at four edge lengths; no edge may end up with more than two triangles (two flips in one
  // pass once made the same new edge twice)
  const P = [], I = [], R = 10, NU = 64, NV = 8;
  for (let j = 0; j <= NV; j++) for (let i = 0; i < NU; i++) { const th = Math.PI * j / NV, ph = 2 * Math.PI * i / NU; P.push(R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph), R * Math.cos(th)); }
  const v = (i, j) => j * NU + (i % NU);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) I.push(v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i + 1, j));
  const bad = [];
  for (const L of [0.7, 1.1, 2.3, 3.1]) {
    const r = remeshEvenly(new Float32Array(P), new Uint32Array(I), { length: L, rounds: 7 });
    const e = new Map();
    for (let t = 0; t < r.index.length; t += 3) for (let j = 0; j < 3; j++) { const a = r.index[t + j], b = r.index[t + (j + 1) % 3], k = a < b ? a + ',' + b : b + ',' + a; e.set(k, (e.get(k) || 0) + 1); }
    let over = 0; for (const n of e.values()) if (n !== 2) over++;
    if (over) bad.push(L + ': ' + over);
  }
  ok(!bad.length, 'four edge lengths, every edge on exactly two triangles' + (bad.length ? ' (not: ' + bad.join(', ') + ')' : ''));
}

{
  // a very short edge on a big part is held to the triangle cap: the edge is raised, and the result says so
  const P = [], I = [];
  const quad = (a, b, c, d) => { const n = P.length / 3; P.push(...a, ...b, ...c, ...d); I.push(n, n + 1, n + 2, n, n + 2, n + 3); };
  quad([0, 0, 0], [0, 10, 0], [10, 10, 0], [10, 0, 0]); quad([0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]);
  quad([0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]); quad([0, 10, 0], [0, 10, 10], [10, 10, 10], [10, 10, 0]);
  quad([0, 0, 0], [0, 0, 10], [0, 10, 10], [0, 10, 0]); quad([10, 0, 0], [10, 10, 0], [10, 10, 10], [10, 0, 10]);
  const t0 = Date.now(), r = remeshEvenly(new Float32Array(P), new Uint32Array(I), { length: 0.01, maxTriangles: 5000 });
  ok(r.capped && r.triangles < 5000 * 1.4, 'an edge of 0.01 on a 10 cube (about 13 million triangles) is held to the cap: ' + r.triangles + ' triangles, edge ' + r.length.toFixed(3) + ', ' + (Date.now() - t0) + ' ms');
}

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
