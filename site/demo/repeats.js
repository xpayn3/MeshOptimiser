// repeats.js — find parts that are the same shape in a different place.
//
// A STEP file says which parts are copies; a GLB, FBX or OBJ from another tool
// usually does not. Every copy of a bolt arrives as a mesh of its own, often
// with its vertices already turned and moved into the assembly. This module
// finds those copies from the numbers alone, so that the app can keep one
// geometry and a list of placements.
//
// What counts as a copy: the same number of vertices and triangles, the same
// triangle connectivity (index buffer), and every vertex of one equal to the
// matching vertex of the other after ONE rigid movement (a rotation and a
// shift, no mirror, no scale). Vertices are matched by position in the buffer,
// which is what an exporter produces when it writes the same part twice. A
// part that was tessellated again, or mirrored, is not a copy here: nothing is
// merged unless it fits within the tolerance, so a wrong match cannot happen
// for lack of care.
//
//   findRepeats(items, { tol }) → { groups, stats }
//     items   [{ positions: Float32Array|number[], index?: Uint32Array|…|null,
//                normals?: Float32Array|null }]
//     groups  [{ ref, members: [{ i, m }] }]   m: 16 numbers, column-major
//             (three.js Matrix4.elements), such that item i = m × item ref
//     tol     fit tolerance as a share of the part's diagonal (default 2e-4)
//
// The movement is found with Horn's closed form (the best rotation is the top
// eigenvector of a 4×4 symmetric matrix built from the two point sets) and then
// every vertex is checked against it, so a bad fit is rejected, never trusted.

const MAX_REFS_PER_CLUSTER = 24;      // how many different shapes of one size we are willing to try a part against

function prepare(it) {
  const p = it.positions, n = (p.length / 3) | 0;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let rg = 0, minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity, big = 0;
  for (let i = 0; i < n; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const dx = x - cx, dy = y - cy, dz = z - cz;
    rg += dx * dx + dy * dy + dz * dz;
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
    const a = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)); if (a > big) big = a;
  }
  return {
    n, c: [cx, cy, cz], rg: Math.sqrt(rg / n),
    diag: Math.hypot(maxx - minx, maxy - miny, maxz - minz), big,
    ni: it.index ? it.index.length : 0,
  };
}

// Jacobi eigen-decomposition of a symmetric 4×4 matrix (row-major array of 16).
// Returns the eigenvector of the largest eigenvalue.
function topEigenvector4(N) {
  const A = N.slice(), V = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += A[i * 4 + j] * A[i * 4 + j];
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) {
      const apq = A[p * 4 + q];
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (A[q * 4 + q] - A[p * 4 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) {
        const akp = A[k * 4 + p], akq = A[k * 4 + q];
        A[k * 4 + p] = c * akp - s * akq; A[k * 4 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 4; k++) {
        const apk = A[p * 4 + k], aqk = A[q * 4 + k];
        A[p * 4 + k] = c * apk - s * aqk; A[q * 4 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 4; k++) {
        const vkp = V[k * 4 + p], vkq = V[k * 4 + q];
        V[k * 4 + p] = c * vkp - s * vkq; V[k * 4 + q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (A[i * 4 + i] > A[best * 4 + best]) best = i;
  return [V[best], V[4 + best], V[8 + best], V[12 + best]];
}

function sameIndex(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// The movement that takes `ref` onto `it`, or null. Rotation as a 3×3 (row-major)
// plus translation, returned as a column-major 4×4.
function fit(ref, it, pr, pi, tolAbs, useNormals) {
  const a = ref.positions, b = it.positions, n = pr.n;
  const [acx, acy, acz] = pr.c, [bcx, bcy, bcz] = pi.c;
  // cross-covariance of the centred sets
  let sxx = 0, sxy = 0, sxz = 0, syx = 0, syy = 0, syz = 0, szx = 0, szy = 0, szz = 0;
  for (let i = 0; i < n; i++) {
    const ax = a[i * 3] - acx, ay = a[i * 3 + 1] - acy, az = a[i * 3 + 2] - acz;
    const bx = b[i * 3] - bcx, by = b[i * 3 + 1] - bcy, bz = b[i * 3 + 2] - bcz;
    sxx += ax * bx; sxy += ax * by; sxz += ax * bz;
    syx += ay * bx; syy += ay * by; syz += ay * bz;
    szx += az * bx; szy += az * by; szz += az * bz;
  }
  const N = [
    sxx + syy + szz, syz - szy,        szx - sxz,        sxy - syx,
    syz - szy,       sxx - syy - szz,  sxy + syx,        szx + sxz,
    szx - sxz,       sxy + syx,       -sxx + syy - szz,  syz + szy,
    sxy - syx,       szx + sxz,        syz + szy,       -sxx - syy + szz,
  ];
  let [w, x, y, z] = topEigenvector4(N);
  const qn = Math.hypot(w, x, y, z); if (!qn) return null;
  w /= qn; x /= qn; y /= qn; z /= qn;
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
  // every vertex has to land on its partner
  const tol2 = tolAbs * tolAbs;
  for (let i = 0; i < n; i++) {
    const ax = a[i * 3] - acx, ay = a[i * 3 + 1] - acy, az = a[i * 3 + 2] - acz;
    const ex = r00 * ax + r01 * ay + r02 * az + bcx - b[i * 3];
    const ey = r10 * ax + r11 * ay + r12 * az + bcy - b[i * 3 + 1];
    const ez = r20 * ax + r21 * ay + r22 * az + bcz - b[i * 3 + 2];
    if (ex * ex + ey * ey + ez * ez > tol2) return null;
  }
  if (useNormals) {
    const na = ref.normals, nb = it.normals;
    for (let i = 0; i < n; i++) {
      const ax = na[i * 3], ay = na[i * 3 + 1], az = na[i * 3 + 2];
      const dot = (r00 * ax + r01 * ay + r02 * az) * nb[i * 3] + (r10 * ax + r11 * ay + r12 * az) * nb[i * 3 + 1] + (r20 * ax + r21 * ay + r22 * az) * nb[i * 3 + 2];
      if (dot < 0.999) return null;
    }
  }
  const tx = bcx - (r00 * acx + r01 * acy + r02 * acz);
  const ty = bcy - (r10 * acx + r11 * acy + r12 * acz);
  const tz = bcz - (r20 * acx + r21 * acy + r22 * acz);
  return [r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, tx, ty, tz, 1];
}

export function findRepeats(items, opts = {}) {
  const tol = opts.tol == null ? 2e-4 : opts.tol;
  const prep = items.map(it => (it && it.positions && it.positions.length >= 9) ? prepare(it) : null);
  // 1. cheap buckets: same vertex count, same index length
  const buckets = new Map();
  prep.forEach((p, i) => {
    if (!p) return;
    const k = p.n + '|' + p.ni;
    (buckets.get(k) || buckets.set(k, []).get(k)).push(i);
  });
  const groups = [];
  let tried = 0, matched = 0, fitMs = 0;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue;
    // 2. within a bucket, sort by radius of gyration (does not change when a part is turned)
    ids.sort((a, b) => prep[a].rg - prep[b].rg);
    let cluster = [];
    const flush = () => {
      if (cluster.length < 2) { cluster = []; return; }
      const refs = [];                         // { i, members: [] }
      for (const i of cluster) {
        let done = false;
        for (let r = 0; r < refs.length && !done; r++) {
          const ref = refs[r];
          if (!sameIndex(items[ref.i].index, items[i].index)) continue;
          const useN = !!(items[ref.i].normals && items[i].normals);
          const tolAbs = tol * Math.max(prep[ref.i].diag, 1e-9) + 4e-7 * Math.max(prep[ref.i].big, prep[i].big);
          tried++;
          const m = fit(items[ref.i], items[i], prep[ref.i], prep[i], tolAbs, useN);
          if (m) { ref.members.push({ i, m }); matched++; done = true; }
        }
        if (!done && refs.length < MAX_REFS_PER_CLUSTER) refs.push({ i, members: [] });
      }
      for (const r of refs) if (r.members.length) groups.push({ ref: r.i, members: r.members });
      cluster = [];
    };
    for (const i of ids) {
      if (cluster.length && prep[i].rg - prep[cluster[0]].rg > 1e-3 * Math.max(prep[cluster[0]].rg, 1e-12)) flush();
      cluster.push(i);
    }
    flush();
  }
  if (t0) fitMs = performance.now() - t0;
  return { groups, stats: { items: items.length, tried, matched, ms: Math.round(fitMs) } };
}
