// node tests/simplify-core.test.mjs — checks simplify-core.js against the vendored meshoptimizer.
// The reported error is an estimate; the test measures the real distance on a sphere and
// requires the estimate to be in the right range (not far below what was measured).
import { MeshoptSimplifier as S } from '../app/vendor/meshoptimizer/meshopt_simplifier.module.js';
import { packAttributes, reduceIndex, reduceWithin, analyseCreases, lockSharp } from '../app/js/simplify-core.js';

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


// — sharp edges —
// A flat-topped cylinder: smooth sides (6 degrees between facets), hard rims (90 degrees).
function cylinder(r, h, nSeg, nRing) {
  const pos = [], idx = [];
  for (let j = 0; j <= nRing; j++) for (let i = 0; i < nSeg; i++) { const a = (i / nSeg) * Math.PI * 2; pos.push(Math.cos(a) * r, (j / nRing - 0.5) * h, Math.sin(a) * r); }
  const ring = (j, i) => j * nSeg + (i % nSeg);
  for (let j = 0; j < nRing; j++) for (let i = 0; i < nSeg; i++) { idx.push(ring(j, i), ring(j + 1, i), ring(j, i + 1), ring(j, i + 1), ring(j + 1, i), ring(j + 1, i + 1)); }
  for (const [j, up] of [[0, false], [nRing, true]]) {                       // caps: duplicated vertices, as a CAD export has
    const c = pos.length / 3; pos.push(0, (j / nRing - 0.5) * h, 0);
    const base = pos.length / 3; for (let i = 0; i < nSeg; i++) pos.push(pos[ring(j, i) * 3], pos[ring(j, i) * 3 + 1], pos[ring(j, i) * 3 + 2]);
    for (let i = 0; i < nSeg; i++) { const a = base + i, b = base + ((i + 1) % nSeg); if (up) idx.push(c, b, a); else idx.push(c, a, b); }
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}
const cyl = cylinder(10, 40, 64, 100);
const an = analyseCreases(cyl.index, cyl.positions);
const l40 = lockSharp(an, 40), l3 = lockSharp(an, 3);
console.log('locked at 40:', l40.count, ' at 3:', l3.count, ' vertices:', cyl.positions.length / 3);
ok(l40.count > 0 && l40.count <= 64 * 2 * 2 + 2, `40 degrees locks the rims only (${l40.count} vertices)`);
ok(l3.count > l40.count * 5, `3 degrees would lock every facet edge (${l3.count} vertices): the angle matters`);
const cylTarget = Math.floor(cyl.index.length / 3 * 0.09) * 3;
const rimsOf = (idx) => { const used = new Set(idx); let n = 0; for (const v of used) { const y = cyl.positions[v * 3 + 1]; if (Math.abs(Math.abs(y) - 20) < 1e-4) n++; } return n; };
const free = reduceIndex(S, cyl.index, cyl.positions, cylTarget, null);
const held = reduceIndex(S, cyl.index, cyl.positions, cylTarget, null, { sharp: 40 });
console.log('triangles: original', cyl.index.length / 3, 'free', free.idx.length / 3, 'held', held.idx.length / 3, 'rim vertices free/held', rimsOf(free.idx), rimsOf(held.idx), 'sharpKept', held.sharpKept);
ok(held.sharpKept > 0, 'the sharp-edge path was the one that got there');
ok(held.idx.length <= cylTarget * 1.25, `...and it reached the target (${held.idx.length / 3} triangles of ${cyl.index.length / 3})`);
ok(rimsOf(held.idx) >= 128, `all the rim vertices are still there with the edges kept (${rimsOf(held.idx)})`);
ok(rimsOf(free.idx) <= rimsOf(held.idx), `without it the rims keep the same or fewer (${rimsOf(free.idx)})`);
const tiny = Math.floor(cyl.index.length / 3 * 0.012) * 3;
const hard = reduceIndex(S, cyl.index, cyl.positions, tiny, null, { sharp: 40 });
ok(hard.idx.length <= tiny * 1.25 && !hard.sharpKept, `a goal the rims cannot keep to falls back and is reached (${hard.idx.length / 3} triangles)`);
const sph = reduceIndex(S, s.index, s.positions, target, packAttributes(s.geom), { sharp: 40 });
ok(!sph.sharpKept && sph.idx.length === withAttr.idx.length, 'a smooth sphere is reduced exactly as before');

// — the moved run (opts.update, meshoptimizer 1.x's simplifyWithUpdate) —
const posBefore = s.positions.slice(), attrBefore = attrs.data.slice();
const moved = reduceIndex(S, s.index, s.positions, target, attrs, { sharp: 40, update: true });
ok(moved.upd && moved.upd.positions.length === s.positions.length && moved.upd.attrs.length === attrs.data.length, 'update: the moved positions and attributes come back as upd');
ok(moved.idx.length <= target * 1.25, `update: reaches the target (${moved.idx.length / 3} triangles)`);
ok(s.positions.every((x, i) => x === posBefore[i]) && attrs.data.every((x, i) => x === attrBefore[i]), "update: the caller's arrays are not touched");
const offSphere = (P, idx) => { let w = 0; for (const v of new Set(idx)) w = Math.max(w, Math.abs(Math.hypot(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]) - R)); return w; };
const devMoved = maxDeviation(moved.upd.positions, moved.idx, s.positions), devPlain = maxDeviation(s.positions, withAttr.idx, s.positions);
console.log('sphere at 10 %: largest distance plain', devPlain.toFixed(4), 'moved', devMoved.toFixed(4), '; moved vertices off the sphere by at most', offSphere(moved.upd.positions, moved.idx).toFixed(4));
ok(devMoved <= devPlain * 1.05, 'update: the surface lands no further from the original than the plain run');
ok(offSphere(moved.upd.positions, moved.idx) <= devPlain, 'update: the moved vertices stay close to the sphere');
ok(moved.err > 0 && moved.err >= devMoved * 0.25 && moved.err <= devMoved * 8 + 1e-6, `update: estimate ${moved.err.toFixed(4)} in a sensible range of the measured ${devMoved.toFixed(4)}`);
const noUpd = reduceIndex(S, s.index, s.positions, target, attrs, { sharp: 40 });
ok(!noUpd.upd && noUpd.idx.length === withAttr.idx.length, 'without update: as before, nothing moved');
const S0 = Object.create(S); S0.simplifyWithUpdate = undefined;
ok(!reduceIndex(S0, s.index, s.positions, target, attrs, { update: true }).upd, 'a simplifier without simplifyWithUpdate: the usual paths');

// — within a distance —
const lim = 0.05 * R;
const wPlain = reduceWithin(S, s.index, s.positions, lim, false), wMoved = reduceWithin(S, s.index, s.positions, lim, true);
const dP = maxDeviation(s.positions, wPlain.idx, s.positions), dM = maxDeviation(wMoved.upd.positions, wMoved.idx, s.positions);
console.log(`within ${lim}: plain ${wPlain.idx.length / 3} triangles (measured ${dP.toFixed(3)}), moved ${wMoved.idx.length / 3} (measured ${dM.toFixed(3)})`);
ok(!wPlain.upd && wMoved.upd, 'within: only the moved run hands back moved arrays');
ok(wPlain.idx.length < s.index.length && wMoved.idx.length < s.index.length, 'within: both reduce');
ok(dM <= lim * 1.25, `within: the moved run keeps to about the distance asked for (${dM.toFixed(3)} of ${lim})`);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
