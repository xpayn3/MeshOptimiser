// node tests/simplify-core.test.mjs — checks simplify-core.js against the vendored meshoptimizer.
// The reported error is an estimate; the test measures the real distance on a sphere and
// requires the estimate to be in the right range (not far below what was measured).
import { MeshoptSimplifier as S } from '../vendor/meshoptimizer/meshopt_simplifier.module.js';
import { packAttributes, reduceIndex } from '../simplify-core.js';

await S.ready;
S.useExperimentalFeatures = true;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// A UV sphere of radius R with a UV seam (duplicated vertices) and normals.
function sphere(R, nu, nv) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const th = (i / nu) * Math.PI * 2, ph = (j / nv) * Math.PI;
    const x = Math.sin(ph) * Math.cos(th), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(th);
    pos.push(x * R, y * R, z * R); nor.push(x, y, z); uv.push(i / nu, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const positions = new Float32Array(pos);
  return {
    positions, index: new Uint32Array(idx),
    geom: { attributes: {
      position: { count: positions.length / 3, itemSize: 3, array: positions },
      normal: { count: nor.length / 3, itemSize: 3, array: new Float32Array(nor) },
      uv: { count: uv.length / 2, itemSize: 2, array: new Float32Array(uv) },
    } },
  };
}

// largest distance from an original vertex to the surface of the reduced mesh
function maxDeviation(positions, idx, refPositions) {
  const P = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function distPT(p, a, b, c) {                       // point to triangle (Ericson)
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return Math.hypot(...sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v])); }
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return Math.hypot(...sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w])); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); const bc = sub(c, b); return Math.hypot(...sub(p, [b[0] + bc[0] * w, b[1] + bc[1] * w, b[2] + bc[2] * w])); }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return Math.hypot(...sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
  }
  let worst = 0;
  for (let i = 0; i < refPositions.length; i += 3 * 7) {   // every 7th vertex is plenty
    const p = [refPositions[i], refPositions[i + 1], refPositions[i + 2]];
    let best = Infinity;
    for (let t = 0; t < idx.length; t += 3) { const d = distPT(p, P(idx[t]), P(idx[t + 1]), P(idx[t + 2])); if (d < best) best = d; }   // (NaN from a degenerate triangle never wins)
    worst = Math.max(worst, best);
  }
  return worst;
}

const R = 40;                                           // "mm"
const s = sphere(R, 96, 64);                            // about 12k triangles
const tris = s.index.length / 3;
const target = Math.floor(tris * 0.1) * 3;

const attrs = packAttributes(s.geom);
ok(attrs && attrs.stride === 5 && attrs.weights.length === 5, 'packAttributes joins normal (3) and uv (2)');
ok(packAttributes({ attributes: { position: s.geom.attributes.position } }) === null, 'no attributes: null');

// spy: the attribute-aware call must really be the one that ran
let attrCalls = 0;
const realAttr = S.simplifyWithAttributes.bind(S);
S.simplifyWithAttributes = (...a) => { attrCalls++; return realAttr(...a); };
const plain = reduceIndex(S, s.index, s.positions, target, null);
ok(attrCalls === 0, 'no attributes: the plain simplifier is used');
const withAttr = reduceIndex(S, s.index, s.positions, target, attrs);
ok(attrCalls === 1, 'with attributes: simplifyWithAttributes ran once and its result was used');
for (const [name, r] of [['positions only', plain], ['with attributes', withAttr]]) {
  const real = maxDeviation(s.positions, r.idx, s.positions);
  ok(r.idx.length <= target * 1.25 && r.idx.length >= 3, `${name}: ${tris} → ${r.idx.length / 3} triangles`);
  ok(r.err > 0 && isFinite(r.err), `${name}: error estimate ${r.err.toFixed(4)} (measured ${real.toFixed(4)})`);
  // the estimate is in the same units as the positions and is not wildly under the real distance
  ok(r.err >= real * 0.25 && r.err <= real * 8 + 1e-6, `${name}: estimate within a sensible range of the measured distance`);
}

// a mesh that needs no reduction keeps a zero error
const small = reduceIndex(S, s.index.subarray(0, 30), s.positions, 30, null);
ok(small.idx.length === 30, 'at the target already: nothing removed');

// the error scales with the model: the same sphere ten times larger reports ten times the error
const big = sphere(R * 10, 96, 64);
const bigR = reduceIndex(S, big.index, big.positions, target, packAttributes(big.geom));
ok(Math.abs(bigR.err / withAttr.err - 10) < 0.5, `error scales with size (×${(bigR.err / withAttr.err).toFixed(2)})`);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
