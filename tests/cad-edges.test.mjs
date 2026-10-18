// node tests/cad-edges.test.mjs — Remesh evenly and Smooth surface keep the CAD edges of a part that knows its CAD faces (opts.cad,
// from a STEP opened with its B-rep), not the edges found by angle: a shallow crease between two CAD faces stays, the same crease
// between faces that meet tangent does not, and the seams between the facets of a coarse cylinder (one CAD face) are not kept.
import { remeshEvenly } from '../app/js/remesh.js';
import { smoothSurface } from '../app/js/smooth.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
let seed = 777; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// a plate bent 10° along x = 0: face 0 is flat (x ≤ 0), face 1 rises (x ≥ 0). A grid of 2 × 10 × 10 triangles a half, face 0's first.
const BEND = 10 * Math.PI / 180, TAN = Math.tan(BEND);
const zOf = (x) => (x > 0 ? x * TAN : 0);
function bentPlate() {
  const P = [], I = [], N = 10, id = new Map();
  const vert = (x, y) => { const k = x + ',' + y; if (!id.has(k)) { id.set(k, P.length / 3); P.push(x, y, zOf(x)); } return id.get(k); };
  for (const half of [0, 1]) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = half ? i : i - N, x1 = x0 + 1, y0 = j, y1 = j + 1;
    const a = vert(x0, y0), b = vert(x1, y0), c = vert(x1, y1), d = vert(x0, y1);
    I.push(a, b, c, a, c, d);
  }
  const faceOf = new Int32Array(I.length / 3); faceOf.fill(1, N * N * 2);
  return { P: new Float32Array(P), I: new Uint32Array(I), faceOf };
}
// how far a point is off the bent plate
const offPlate = (pos) => { let w = 0; for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2]; w = Math.max(w, x <= 0 ? Math.abs(z) : Math.abs(z - x * TAN) * Math.cos(BEND)); } return w; };
// triangles that bend round the crease (one corner on each side of it, off the crease line)
const crossing = (r) => {
  let n = 0;
  for (let t = 0; t < r.index.length; t += 3) {
    const xs = [0, 1, 2].map(k => r.positions[3 * r.index[t + k]]);
    if (xs.some(x => x < -1e-4) && xs.some(x => x > 1e-4)) n++;
  }
  return n;
};

{
  const { P, I, faceOf } = bentPlate();
  const byAngle = remeshEvenly(P, I, { length: 0.7 });
  const byCad = remeshEvenly(P, I, { length: 0.7, cad: { faceOf, smooth: [] } });
  ok(byAngle.ok && byCad.ok && byCad.fromCad && !byAngle.fromCad, 'both run, and the CAD one says so');
  ok(crossing(byAngle) > 0, 'by angle alone the 10° crease is not an edge: ' + crossing(byAngle) + ' triangles bend round it');
  ok(crossing(byCad) === 0, 'with the CAD faces it is kept: no triangle bends round it (' + crossing(byCad) + ')');
  ok(offPlate(byCad.positions) < 1e-4, 'and every point stays on the plate (at most ' + offPlate(byCad.positions).toExponential(1) + ' off)');
  const tangent = remeshEvenly(P, I, { length: 0.7, cad: { faceOf, smooth: [[1, 0]] } });
  ok(crossing(tangent) > 0, 'the same crease between faces that meet tangent is not kept (' + crossing(tangent) + ' triangles across it)');
}

{
  // a cylinder of 8 facets (45° each, over the 30° of the angle rule) with its two caps: three CAD faces
  const P = [], I = [], N = 8, H = 10, R = 5;
  for (const z of [0, H]) for (let i = 0; i < N; i++) { const a = 2 * Math.PI * i / N; P.push(R * Math.cos(a), R * Math.sin(a), z); }
  const v = (i, k) => k * N + (i % N);
  for (let i = 0; i < N; i++) I.push(v(i, 0), v(i + 1, 0), v(i + 1, 1), v(i, 0), v(i + 1, 1), v(i, 1));
  const c0 = P.length / 3; P.push(0, 0, 0); const c1 = P.length / 3; P.push(0, 0, H);
  for (let i = 0; i < N; i++) I.push(c0, v(i + 1, 0), v(i, 0));
  for (let i = 0; i < N; i++) I.push(c1, v(i, 1), v(i + 1, 1));
  const faceOf = new Int32Array(I.length / 3); faceOf.fill(1, 2 * N, 3 * N); faceOf.fill(2, 3 * N);
  const byAngle = remeshEvenly(new Float32Array(P), new Uint32Array(I), { length: 1 });
  const byCad = remeshEvenly(new Float32Array(P), new Uint32Array(I), { length: 1, cad: { faceOf, smooth: [] } });
  ok(byCad.sharpEdges < byAngle.sharpEdges, 'the seams between the facets are not kept: ' + byAngle.sharpEdges + ' sharp edge pieces by angle, ' + byCad.sharpEdges + ' by the CAD faces');
  // the rims are kept: no triangle has a corner on a cap and one on the side away from the rim
  let bent = 0;
  for (let t = 0; t < byCad.index.length; t += 3) {
    const q = [0, 1, 2].map(k => [byCad.positions[3 * byCad.index[t + k]], byCad.positions[3 * byCad.index[t + k] + 1], byCad.positions[3 * byCad.index[t + k] + 2]]);
    const inCap = q.some(p => (Math.abs(p[2]) < 1e-4 || Math.abs(p[2] - H) < 1e-4) && Math.hypot(p[0], p[1]) < R * Math.cos(Math.PI / N) - 1e-3);
    const onSide = q.some(p => p[2] > 1e-4 && p[2] < H - 1e-4);
    if (inCap && onSide) bent++;
  }
  ok(bent === 0, 'the two rims are kept: no triangle bends from a cap round onto the side (' + bent + ')');
}

{
  // Smooth surface on the bent plate with noise on it: by angle the shallow crease is rounded, with the CAD faces it stays
  const { P, I, faceOf } = bentPlate();
  const even = remeshEvenly(P, I, { length: 0.5, cad: { faceOf, smooth: [] } });
  // the faces of the remeshed plate: by which side of the crease each triangle lies (none crosses it, see above)
  const f2 = new Int32Array(even.index.length / 3);
  for (let t = 0; t < f2.length; t++) { let sx = 0; for (let k = 0; k < 3; k++) sx += even.positions[3 * even.index[3 * t + k]]; f2[t] = sx > 0 ? 1 : 0; }
  const noisy = even.positions.slice();
  for (let i = 0; i < noisy.length; i += 3) if (Math.abs(noisy[i]) > 1e-4 && Math.abs(noisy[i + 1]) > 1e-4 && Math.abs(noisy[i + 1] - 10) > 1e-4 && Math.abs(Math.abs(noisy[i]) - 10) > 1e-4) noisy[i + 2] += (rnd() - 0.5) * 0.04;
  const creaseOff = (pos) => { let w = 0; for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i]) < 1e-4) w = Math.max(w, Math.abs(pos[i + 2])); return w; };
  const nearCrease = (pos) => { let w = 0; for (let i = 0; i < pos.length; i += 3) { const x = pos[i]; if (x > 0.2 && x < 1.5) w = Math.max(w, Math.abs(pos[i + 2] - x * TAN)); } return w; };
  const byAngle = smoothSurface(noisy, even.index, { strength: 10 });
  const byCad = smoothSurface(noisy, even.index, { strength: 10, cad: { faceOf: f2, smooth: [] } });
  ok(byCad.ok && byCad.fromCad, 'Smooth surface runs with the CAD faces, and says so');
  ok(nearCrease(byCad.positions) < nearCrease(byAngle.positions), 'near the crease the CAD one keeps closer to the true faces: ' + nearCrease(byAngle.positions).toFixed(4) + ' by angle, ' + nearCrease(byCad.positions).toFixed(4) + ' with the CAD faces');
  ok(offPlate(byCad.positions) < 0.03, 'and the noise is gone from the whole plate (at most ' + offPlate(byCad.positions).toFixed(4) + ' off, noise was up to 0.02)');
  void creaseOff;
}

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
