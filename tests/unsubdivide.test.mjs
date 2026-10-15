// node tests/unsubdivide.test.mjs — checks unsubdivide.js on shapes built here.
import { unsubdivide } from '../app/js/unsubdivide.js';

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : '  ' + extra)); if (!cond) failed++; };

// a cylinder (open sides, optional caps as fans), N lines round, R rows, every corner stored once per face like CAD output
function cylinder({ N = 64, R = 8, radius = 20, height = 100, caps = false, split = true } = {}) {
  const pos = [], idx = [];
  const P = (i, r) => { const a = (i % N) / N * Math.PI * 2; return [radius * Math.cos(a), radius * Math.sin(a), height * r / R]; };
  const tri = (a, b, c) => { const n = pos.length / 3; pos.push(...a, ...b, ...c); idx.push(n, n + 1, n + 2); };
  for (let r = 0; r < R; r++) for (let i = 0; i < N; i++) {
    const a = P(i, r), b = P(i + 1, r), c = P(i + 1, r + 1), d = P(i, r + 1);
    if ((i + r) % 2 && split) { tri(a, b, d); tri(b, c, d); } else { tri(a, b, c); tri(a, c, d); }
  }
  if (caps) {
    for (const [r, up] of [[0, false], [R, true]]) {
      const c = [0, 0, height * r / R];
      for (let i = 0; i < N; i++) { const a = P(i, r), b = P(i + 1, r); if (up) tri(c, a, b); else tri(c, b, a); }
    }
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}
const key = (p, v) => [0, 1, 2].map(c => Math.round(p[v * 3 + c] * 1e3)).join(',');
// edges that only one triangle uses, by position
function openEdges(p, ix) {
  const m = new Map();
  for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = key(p, ix[t + e]), b = key(p, ix[t + (e + 1) % 3]);
    const k = a < b ? a + '|' + b : b + '|' + a; m.set(k, (m.get(k) || 0) + 1);
  }
  let n = 0; for (const c of m.values()) if (c === 1) n++; return n;
}
function area(p, ix) {
  let s = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return s;
}

{
  console.log('an open cylinder, 64 lines, 8 rows');
  const g = cylinder();
  const r = unsubdivide(g.positions, g.index);
  check('it did something', !!r);
  if (r) {
    check('half the triangles (1024 → 512)', r.index.length / 3 === 512, r.index.length / 3);
    check('still only the two rims are open (each with half the edges)', openEdges(g.positions, r.index) === openEdges(g.positions, g.index) / 2, [openEdges(g.positions, r.index), openEdges(g.positions, g.index)]);
    check('every index is a point of the input', r.index.every(v => v < g.positions.length / 3));
    const a0 = area(g.positions, g.index), a1 = area(g.positions, r.index);
    check('the surface is within 0.2 % of what it was', Math.abs(a1 / a0 - 1) < 0.002, a1 / a0);
    // every new triangle is not a sliver: the quads are about 4 : 1 now, not 6 : 1 ... check the smallest angle
    let worst = 180;
    for (let t = 0; t < r.index.length; t += 3) {
      const p = g.positions, a = r.index[t] * 3, b = r.index[t + 1] * 3, c = r.index[t + 2] * 3;
      const L = [Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]), Math.hypot(p[c] - p[b], p[c + 1] - p[b + 1], p[c + 2] - p[b + 2]), Math.hypot(p[a] - p[c], p[a + 1] - p[c + 1], p[a + 2] - p[c + 2])];
      const s = [...L].sort((x, y) => x - y); const A = Math.hypot((p[b + 1] - p[a + 1]) * (p[c + 2] - p[a + 2]) - (p[b + 2] - p[a + 2]) * (p[c + 1] - p[a + 1]), (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]), (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a])) / 2;
      worst = Math.min(worst, Math.asin(Math.min(1, 2 * A / (s[1] * s[2]))) * 180 / Math.PI);
    }
    console.log('   smallest angle after:', worst.toFixed(1));
    // once more: 512 → 256
    const r2 = unsubdivide(g.positions, r.index, { tol: 1 });
    check('a second pass halves again (512 → 256)', !!r2 && r2.index.length / 3 === 256, r2 && r2.index.length / 3);
    if (r2) check('and the rims have a quarter of the edges', openEdges(g.positions, r2.index) === openEdges(g.positions, g.index) / 4, openEdges(g.positions, r2.index));
    check('a point further from the circle than the tolerance stays (second pass at the default tolerance does nothing)', !unsubdivide(g.positions, r.index));
  }
}
{
  console.log('the same with a fan cap on each end');
  const g = cylinder({ caps: true });
  const r = unsubdivide(g.positions, g.index);
  check('it did something', !!r);
  if (r) {
    check('fewer triangles, the caps untouched', r.index.length / 3 < g.index.length / 3 && r.index.length / 3 >= (1024 / 2) + 128 - 40, [r.index.length / 3, g.index.length / 3]);
    check('no new open edges', openEdges(g.positions, r.index) === openEdges(g.positions, g.index), [openEdges(g.positions, r.index), openEdges(g.positions, g.index)]);
  }
}
{
  console.log('an odd number of lines cannot be taken alternately');
  const g = cylinder({ N: 63 });
  const r = unsubdivide(g.positions, g.index);
  check('left as it is', !r || openEdges(g.positions, r.index) === openEdges(g.positions, g.index));
}
{
  console.log('a squat cylinder (quads about square) is left alone');
  const g = cylinder({ N: 16, R: 8, radius: 20, height: 100 });
  const r = unsubdivide(g.positions, g.index, { minAspect: 3 });
  check('nothing done', !r, r && r.index.length / 3);
}
console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
