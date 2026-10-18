// node tests/smooth.test.mjs — checks smooth.js (Smooth surface) on a noisy cube and a faceted cylinder built here.
import { smoothSurface } from '../app/js/smooth.js';
import { remeshEvenly } from '../app/js/remesh.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
// a steady random (the test gives the same numbers every time)
let seed = 12345; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// a cube 10 × 10 × 10, remeshed evenly (edge 0.5), then every point pushed in or out by up to 0.08 along its face's normal
const P = [], I = [];
const quad = (a, b, c, d) => { const n = P.length / 3; P.push(...a, ...b, ...c, ...d); I.push(n, n + 1, n + 2, n, n + 2, n + 3); };
quad([0, 0, 0], [0, 10, 0], [10, 10, 0], [10, 0, 0]); quad([0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]);
quad([0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]); quad([0, 10, 0], [0, 10, 10], [10, 10, 10], [10, 10, 0]);
quad([0, 0, 0], [0, 0, 10], [0, 10, 10], [0, 10, 0]); quad([10, 0, 0], [10, 10, 0], [10, 10, 10], [10, 0, 10]);
const cube = remeshEvenly(new Float32Array(P), new Uint32Array(I), { length: 0.5 });
const noisy = cube.positions.slice();
const onFace = (p) => { for (let ax = 0; ax < 3; ax++) for (const v of [0, 10]) if (Math.abs(p[ax] - v) < 1e-6) return ax; return -1; };
for (let i = 0; i < noisy.length; i += 3) {
  const p = [noisy[i], noisy[i + 1], noisy[i + 2]], inner = p.filter(x => x > 1e-6 && x < 10 - 1e-6).length;
  if (inner === 2) { const ax = onFace(p); noisy[i + ax] += (rnd() - 0.5) * 0.16; }      // (points on edges and corners stay: the noise is on the faces)
}
const offCube = (pos) => { let w = 0, s = 0, n = 0; for (let i = 0; i < pos.length; i += 3) { const p = [pos[i], pos[i + 1], pos[i + 2]]; const d = Math.min(...p.map(x => Math.min(Math.abs(x), Math.abs(x - 10)))); w = Math.max(w, d); s += d; n++; } return { worst: w, mean: s / n }; };
{
  const before = offCube(noisy), r = smoothSurface(noisy, cube.index);
  const after = offCube(r.positions);
  ok(r.ok, 'it runs');
  ok(after.mean < before.mean / 4, 'the noise on the faces is taken out: off the cube on average ' + before.mean.toFixed(4) + ' → ' + after.mean.toFixed(4));
  // the edges stay sharp: points within 0.1 of an edge are still within 0.1 of it, and the cube is still 10 wide
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < r.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], r.positions[i + k]); hi[k] = Math.max(hi[k], r.positions[i + k]); }
  ok(hi.every((x, k) => Math.abs(x - lo[k] - 10) < 0.05), 'the edges are not rounded: the cube is still 10 wide (' + hi.map((x, k) => (x - lo[k]).toFixed(3)).join(' × ') + ')');
  let corner = 0;
  for (let i = 0; i < r.positions.length; i += 3) { const p = [r.positions[i], r.positions[i + 1], r.positions[i + 2]]; if (p.every(x => Math.abs(x) < 0.02 || Math.abs(x - 10) < 0.02)) corner++; }
  ok(corner >= 8, 'and its corners are sharp (' + corner + ' points still on a corner)');
}
{
  // a plain smoothing would shrink a cylinder; this one keeps its radius
  const P2 = [], I2 = [], N = 24, H = 20, R = 5;
  for (let j = 0; j <= 10; j++) for (let i = 0; i < N; i++) { const a = 2 * Math.PI * i / N; P2.push(R * Math.cos(a), R * Math.sin(a), H * j / 10); }
  for (let j = 0; j < 10; j++) for (let i = 0; i < N; i++) { const v = (ii, jj) => jj * N + (ii % N); I2.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1)); }
  const r = smoothSurface(new Float32Array(P2), new Uint32Array(I2), { strength: 6 });
  let worst = 0; for (let i = 0; i < r.positions.length; i += 3) worst = Math.max(worst, Math.abs(Math.hypot(r.positions[i], r.positions[i + 1]) - R));
  ok(worst < 0.1, 'a cylinder keeps its radius (' + worst.toFixed(3) + ' at most off)');
}

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
