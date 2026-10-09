// node tests/repeats.test.mjs — checks repeats.js on shapes built here.
import { findRepeats } from '../repeats.js';

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, extra); } };

// ── shapes ───────────────────────────────────────────────────────────────
// a cylinder with a flat key cut in it (so it is not symmetric about its axis), open at both ends
function keyedCylinder(n = 48, r = 5, h = 20) {
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = (i === 0 || i === 1) ? r * 0.7 : r;
    pos.push(rr * Math.cos(a), rr * Math.sin(a), 0, rr * Math.cos(a), rr * Math.sin(a), h);
  }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(2 * i, 2 * j, 2 * i + 1, 2 * j, 2 * j + 1, 2 * i + 1); }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}
// a plain cylinder: turning it about its own axis changes nothing, the hard case for a pose from axes
function cylinder(n = 64, r = 3, h = 30) {
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pos.push(r * Math.cos(a), r * Math.sin(a), 0, r * Math.cos(a), r * Math.sin(a), h); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(2 * i, 2 * j, 2 * i + 1, 2 * j, 2 * j + 1, 2 * i + 1); }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}
function box(x, y, z) {
  const P = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]];
  const I = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7];
  return { positions: new Float32Array(P.flat()), index: new Uint32Array(I) };
}

// ── movement ─────────────────────────────────────────────────────────────
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function randomRotation() {
  const u = rnd(), v = rnd(), w = rnd();
  const x = Math.sqrt(1 - u) * Math.sin(2 * Math.PI * v), y = Math.sqrt(1 - u) * Math.cos(2 * Math.PI * v);
  const z = Math.sqrt(u) * Math.sin(2 * Math.PI * w), q = Math.sqrt(u) * Math.cos(2 * Math.PI * w);
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * q), 2 * (x * z + y * q)], [2 * (x * y + z * q), 1 - 2 * (x * x + z * z), 2 * (y * z - x * q)], [2 * (x * z - y * q), 2 * (y * z + x * q), 1 - 2 * (x * x + y * y)]];
}
function move(s, R, t, mirror = false) {
  const p = s.positions, out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = mirror ? -p[i] : p[i], y = p[i + 1], z = p[i + 2];
    out[i] = R[0][0] * x + R[0][1] * y + R[0][2] * z + t[0];
    out[i + 1] = R[1][0] * x + R[1][1] * y + R[1][2] * z + t[1];
    out[i + 2] = R[2][0] * x + R[2][1] * y + R[2][2] * z + t[2];
  }
  let index = s.index;
  if (mirror) { index = s.index.slice(); for (let i = 0; i < index.length; i += 3) { const t2 = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t2; } }
  return { positions: out, index };
}
const apply = (m, p, i) => [m[0] * p[i] + m[4] * p[i + 1] + m[8] * p[i + 2] + m[12], m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13], m[2] * p[i] + m[6] * p[i + 1] + m[10] * p[i + 2] + m[14]];
function maxError(refItem, item, m) {
  let e = 0;
  for (let i = 0; i < refItem.positions.length; i += 3) {
    const q = apply(m, refItem.positions, i);
    e = Math.max(e, Math.hypot(q[0] - item.positions[i], q[1] - item.positions[i + 1], q[2] - item.positions[i + 2]));
  }
  return e;
}
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// 1. copies placed anywhere, any turn, far from the origin
{
  const base = keyedCylinder();
  const items = [base];
  for (let k = 0; k < 9; k++) items.push(move(base, randomRotation(), [rnd() * 4000 - 2000, rnd() * 4000 - 2000, rnd() * 4000 - 2000]));
  const r = findRepeats(items);
  ok(r.groups.length === 1, 'one group of ten', JSON.stringify(r.groups.map(g => g.members.length)));
  const g = r.groups[0];
  ok(g && g.members.length === 9, 'nine members');
  let worst = 0; for (const m of g.members) worst = Math.max(worst, maxError(items[g.ref], items[m.i], m.m));
  ok(worst < 2e-3, 'recovered placement is within 2 µm on a 4 m spread', String(worst));
}

// 2. a part that is round about its axis (any turn about the axis fits)
{
  const base = cylinder();
  const items = [base]; for (let k = 0; k < 5; k++) items.push(move(base, randomRotation(), [rnd() * 100, rnd() * 100, rnd() * 100]));
  const r = findRepeats(items);
  ok(r.groups.length === 1 && r.groups[0].members.length === 5, 'round part found', JSON.stringify(r.groups.map(g => g.members.length)));
  let worst = 0; for (const m of r.groups[0].members) worst = Math.max(worst, maxError(items[r.groups[0].ref], items[m.i], m.m));
  ok(worst < 1e-3, 'round part placement', String(worst));
}

// 3. things that must NOT be merged
{
  const base = keyedCylinder();
  const mirrored = move(base, I3, [50, 0, 0], true);
  const bent = move(base, I3, [0, 0, 0]); bent.positions[3 * 7 + 1] += 0.5;           // one vertex 0.5 mm off
  const taller = keyedCylinder(48, 5, 20.1);                                            // 0.5 % taller
  const fewer = keyedCylinder(40);
  const reordered = (() => { const s = move(base, I3, [10, 10, 10]); const idx = s.index.slice(); const t = idx[0]; idx[0] = idx[1]; idx[1] = t; return { positions: s.positions, index: idx }; })();
  const r = findRepeats([base, mirrored, bent, taller, fewer, reordered]);
  ok(r.groups.length === 0, 'mirrored, bent, taller, other tessellation and other connectivity are all left alone', JSON.stringify(r.groups));
}

// 4. exact copies in the same numbers (a file that wrote the part twice) and distinct shapes side by side
{
  const a = box(10, 20, 30), b = box(10, 20, 31), c = box(30, 20, 10);
  const items = [a, move(a, I3, [5, 5, 5]), b, move(b, randomRotation(), [1, 2, 3]), c, move(c, randomRotation(), [9, 9, 9]), move(c, randomRotation(), [8, 8, 8])];
  const r = findRepeats(items);
  const sizes = r.groups.map(g => g.members.length + 1).sort();
  ok(JSON.stringify(sizes) === '[2,2,3]', 'three shapes of the same kind but different size stay separate', JSON.stringify(sizes));
}

// 5. normals: same position fit, different shading is not a copy
{
  const base = box(10, 10, 10);
  const nrm = new Float32Array(24); for (let i = 0; i < 8; i++) nrm[i * 3 + 2] = 1;
  const nrm2 = new Float32Array(24); for (let i = 0; i < 8; i++) nrm2[i * 3 + 2] = -1;
  const moved = move(base, I3, [3, 0, 0]);
  const r1 = findRepeats([{ ...base, normals: nrm }, { ...moved, normals: nrm }]);
  ok(r1.groups.length === 1, 'same normals, same shading');
  const r2 = findRepeats([{ ...base, normals: nrm }, { ...moved, normals: nrm2 }]);
  ok(r2.groups.length === 0, 'opposite normals are not a copy');
}

// 6. a lot of work: 1,500 copies of a 3,000 vertex part, plus 300 loners
{
  const base = keyedCylinder(1500);
  const items = []; for (let k = 0; k < 1500; k++) items.push(move(base, randomRotation(), [rnd() * 1000, rnd() * 1000, rnd() * 1000]));
  for (let k = 0; k < 300; k++) items.push(keyedCylinder(40 + (k % 7), 3 + k * 0.01, 10));
  const t = performance.now();
  const r = findRepeats(items);
  const ms = performance.now() - t;
  const big = r.groups.find(g => g.members.length >= 1000);
  ok(big && big.members.length === 1499, '1,500 copies grouped', JSON.stringify(r.groups.map(g => g.members.length)));
  ok(ms < 4000, 'speed', ms.toFixed(0) + ' ms');
  console.log(`  ${items.length} parts, ${r.groups.length} groups, ${ms.toFixed(0)} ms`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
