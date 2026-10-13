// fasteners.js — tell bolts, nuts and washers from everything else, by shape.
//
// Names cannot be trusted (an exported assembly calls its screws
// "=>0_1_1_9_000009"), so a part is recognised from its mesh alone:
//
//   1. Axis. A fastener is the same all the way round its axis: turned (a
//      shank, a washer) or six-sided (a hex head, a nut). For such a shape the
//      spread of its surface and the spread of its face directions both have
//      two equal principal values and one odd one, and the odd one's
//      direction is the axis. A part without that is rejected here, before
//      any real work.
//   2. Slices. The mesh is cut by planes across the axis, at every height
//      where its outline can change (between the levels its vertices sit on).
//      In each cut, rays are cast outwards from the axis. How many times a ray
//      meets the surface says whether the cut is solid or has a hole on the
//      axis; where it meets says how wide, and whether the outline is a
//      circle, a hexagon or neither.
//   3. Grammar. The slices in order are read as a profile:
//        washer  a flat ring: a round hole right through, wall of one
//                thickness, thinner than its wall is wide
//        nut     six-sided (or square) outside, a round hole right through
//                (or closed by a dome: a cap nut), about as tall as wide
//        bolt    a round solid shank from one end, and at the other end a
//                head that is wider, and no taller than a head is
//        pin     a plain round bar (a stud, a dowel, a threaded rod): only
//                when asked for, because many other things are round bars
//      Proportions are taken from the ISO/DIN tables, with room for the
//      simplified shapes CAD libraries use (a screw as two cylinders).
//
// Everything is measured in the mesh's own units; the caller scales the
// result and decides which sizes it wants (see fastenerLabel / matchFastener).
// Pure module: no three.js, no DOM. Runs in a worker or in node.

const K = 72;                              // rays per slice
const RAY0 = 0.37;                         // rays start off the round angles CAD puts its vertices on
const DT = Math.PI * 2 / K;
const COS = new Float64Array(K), SIN = new Float64Array(K);
for (let k = 0; k < K; k++) { COS[k] = Math.cos((k + RAY0) * DT); SIN[k] = Math.sin((k + RAY0) * DT); }
const MAXHIT = 8;                          // crossings kept per ray
const HARM = 12;                           // harmonics looked at in an outline
const HC = [], HS = [];
for (let m = 1; m <= HARM; m++) {
  const c = new Float64Array(K), s = new Float64Array(K);
  for (let k = 0; k < K; k++) { c[k] = Math.cos(m * (k + RAY0) * DT); s[k] = Math.sin(m * (k + RAY0) * DT); }
  HC.push(c); HS.push(s);
}

// ── small linear algebra ────────────────────────────────────────────────────
// Eigenvalues (ascending) and eigenvectors of a symmetric 3×3, by Jacobi.
function eigSym3(m) {
  const a = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 40; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    const diag = Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]);
    if (off <= 1e-15 * diag || off === 0) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (a[p][q] === 0) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { w: order.map(i => a[i][i]), v: order.map(i => [v[0][i], v[1][i], v[2][i]]) };
}

// The direction that stands apart from two equal ones, or null when the three
// are all different (not a turned or six-sided shape) — `iso` when all three
// are the same, which says nothing either way.
function oddAxis(m) {
  const { w, v } = eigSym3(m);
  const top = Math.max(Math.abs(w[0]), Math.abs(w[2]), 1e-300);
  const lo = w[1] - w[0], hi = w[2] - w[1];
  if (w[2] - w[0] < 0.02 * top) return { iso: true, vecs: v };
  const small = Math.min(lo, hi), big = Math.max(lo, hi);
  if (small > 0.22 * big || small > 0.07 * top) return null;
  return { axis: lo < hi ? v[2] : v[0], skew: small / big };
}

// Surface area, centroid, and the two spreads (of position and of face direction).
function surfaceMoments(pos, idx, nTri) {
  let area = 0, cx = 0, cy = 0, cz = 0;
  const M = [0, 0, 0, 0, 0, 0], N = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < nTri; t++) {
    const i0 = idx ? idx[t * 3] * 3 : t * 9, i1 = idx ? idx[t * 3 + 1] * 3 : t * 9 + 3, i2 = idx ? idx[t * 3 + 2] * 3 : t * 9 + 6;
    const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
    const bx = pos[i1], by = pos[i1 + 1], bz = pos[i1 + 2];
    const gx = pos[i2], gy = pos[i2 + 1], gz = pos[i2 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = gx - ax, vy = gy - ay, vz = gz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const n2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(n2 > 0)) continue;
    const A = n2 / 2, sx = ax + bx + gx, sy = ay + by + gy, sz = az + bz + gz;
    area += A; cx += A * sx / 3; cy += A * sy / 3; cz += A * sz / 3;
    const k = A / 12;                    // ∫ x xᵀ over a triangle = A/12 (aaᵀ + bbᵀ + ccᵀ + ssᵀ)
    M[0] += k * (ax * ax + bx * bx + gx * gx + sx * sx);
    M[1] += k * (ax * ay + bx * by + gx * gy + sx * sy);
    M[2] += k * (ax * az + bx * bz + gx * gz + sx * sz);
    M[3] += k * (ay * ay + by * by + gy * gy + sy * sy);
    M[4] += k * (ay * az + by * bz + gy * gz + sy * sz);
    M[5] += k * (az * az + bz * bz + gz * gz + sz * sz);
    const w = A / (n2 * n2);
    N[0] += w * nx * nx; N[1] += w * nx * ny; N[2] += w * nx * nz; N[3] += w * ny * ny; N[4] += w * ny * nz; N[5] += w * nz * nz;
  }
  if (!(area > 0)) return null;
  const c = [cx / area, cy / area, cz / area];
  const C = [M[0] / area - c[0] * c[0], M[1] / area - c[0] * c[1], M[2] / area - c[0] * c[2], M[3] / area - c[1] * c[1], M[4] / area - c[1] * c[2], M[5] / area - c[2] * c[2]];
  return { area, c, C, N: N.map(x => x / area) };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ── slicing ────────────────────────────────────────────────────────────────
// What the outline r(θ) of one cut is: a circle, a hexagon, a square, or
// neither. `r` holds one radius per ray (0 where the ray met nothing).
function outlineType(r) {
  let n = 0, sum = 0, mn = Infinity, mx = 0;
  for (let k = 0; k < K; k++) { const x = r[k]; if (x > 0) { n++; sum += x; if (x < mn) mn = x; if (x > mx) mx = x; } }
  if (n < K * 0.5) return { type: 'none', mean: n ? sum / n : 0, min: n ? mn : 0, max: mx, m: 0 };
  const mean = sum / n, range = (mx - mn) / mx;
  if (range < 0.035) return { type: 'circle', mean, min: mn, max: mx, m: 0 };
  let best = 0, bm = 0;
  const amp = new Float64Array(HARM + 1);
  for (let m = 1; m <= HARM; m++) {
    let c = 0, s = 0;
    const hc = HC[m - 1], hs = HS[m - 1];
    for (let k = 0; k < K; k++) { const x = (r[k] > 0 ? r[k] : mean) - mean; c += x * hc[k]; s += x * hs[k]; }
    amp[m] = Math.sqrt(c * c + s * s) * 2 / K / mean;
    if (amp[m] > best) { best = amp[m]; bm = m; }
  }
  let type = 'other';
  if (bm === 6 && range >= 0.08 && range <= 0.36) type = 'hex';             // a hexagon is 0.134; rounded corners less, six lobes more
  else if (bm === 4 && range >= 0.18 && range <= 0.34) type = 'square';
  else if (bm >= 8 && range < 0.10) type = 'circle';                        // a circle drawn with 8 to 12 sides
  else if (bm === 12 && range < 0.16) type = 'hex';                         // twelve-point head
  else if (bm <= 2 && range < 0.22) type = 'circle';                        // a modelled thread: round, a little off-centre
  else if (range < 0.06) type = 'circle';
  return { type, mean, min: mn, max: mx, m: bm };
}

// Cut the mesh across `axis` through `c` and describe each cut.
function sliceProfile(pos, idx, nTri, c, axis) {
  const a = axis;
  let u = Math.abs(a[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  let ux = a[1] * u[2] - a[2] * u[1], uy = a[2] * u[0] - a[0] * u[2], uz = a[0] * u[1] - a[1] * u[0];
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = a[1] * uz - a[2] * uy, vy = a[2] * ux - a[0] * uz, vz = a[0] * uy - a[1] * ux;
  const nV = pos.length / 3;
  const X = new Float64Array(nV), Y = new Float64Array(nV), Z = new Float64Array(nV);
  let zmin = Infinity, zmax = -Infinity, rmax = 0;
  for (let i = 0; i < nV; i++) {
    const px = pos[i * 3] - c[0], py = pos[i * 3 + 1] - c[1], pz = pos[i * 3 + 2] - c[2];
    const z = px * a[0] + py * a[1] + pz * a[2], x = px * ux + py * uy + pz * uz, y = px * vx + py * vy + pz * vz;
    X[i] = x; Y[i] = y; Z[i] = z;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
    const r = x * x + y * y; if (r > rmax) rmax = r;
  }
  rmax = Math.sqrt(rmax);
  const L = zmax - zmin;
  if (!(L > 0) || !(rmax > 0)) return null;

  // heights where the outline can change: the levels the vertices sit on
  const tol = L * 0.004;
  const zs = Float64Array.from(Z).sort();
  const levels = [zs[0]];
  for (let i = 1; i < nV; i++) if (zs[i] - levels[levels.length - 1] > tol) levels.push(zs[i]);
  if (levels[levels.length - 1] < zmax - tol * 0.5) levels.push(zmax);
  let cuts = [];
  if (levels.length >= 2 && levels.length <= 64) {
    for (let i = 0; i + 1 < levels.length; i++) cuts.push([levels[i], levels[i + 1]]);
  } else {                                    // a curved or threaded profile: even slabs
    const n = 48;
    for (let i = 0; i < n; i++) cuts.push([zmin + L * i / n, zmin + L * (i + 1) / n]);
  }

  // triangles by their span along the axis, so a cut only looks at its own
  const t0 = new Float64Array(nTri), t1 = new Float64Array(nTri);
  const vi = (t, k) => idx ? idx[t * 3 + k] : t * 3 + k;
  for (let t = 0; t < nTri; t++) {
    const z0 = Z[vi(t, 0)], z1 = Z[vi(t, 1)], z2 = Z[vi(t, 2)];
    t0[t] = Math.min(z0, z1, z2); t1[t] = Math.max(z0, z1, z2);
  }

  // the widest vertex of each slab, its two ends included: the cut through the
  // middle of a cone is narrower than the cone's wide end
  const order = new Uint32Array(nV);
  for (let i = 0; i < nV; i++) order[i] = i;
  order.sort((p, q) => Z[p] - Z[q]);
  const widest = (za, zb) => {
    let lo = 0, hi = nV;
    while (lo < hi) { const m = (lo + hi) >> 1; if (Z[order[m]] < za - tol) lo = m + 1; else hi = m; }
    let w = 0;
    for (let i = lo; i < nV && Z[order[i]] <= zb + tol; i++) { const v = order[i], r = X[v] * X[v] + Y[v] * Y[v]; if (r > w) w = r; }
    return Math.sqrt(w);
  };

  const hits = new Float64Array(K * MAXHIT), nh = new Uint8Array(K);
  const rOut = new Float64Array(K), rIn = new Float64Array(K);
  const eps = rmax * 2e-4;
  const slices = [];
  for (const [za, zb] of cuts) {
    const zc = (za + zb) / 2;
    nh.fill(0);
    for (let t = 0; t < nTri; t++) {
      if (t0[t] > zc || t1[t] <= zc) continue;
      const i0 = vi(t, 0), i1 = vi(t, 1), i2 = vi(t, 2);
      const d0 = Z[i0] - zc, d1 = Z[i1] - zc, d2 = Z[i2] - zc;
      // the two points where the triangle's edges go through the plane
      let px = 0, py = 0, qx = 0, qy = 0, n = 0;
      const edge = (ia, ib, da, db) => {
        if ((da > 0) === (db > 0)) return;
        const f = da / (da - db), x = X[ia] + (X[ib] - X[ia]) * f, y = Y[ia] + (Y[ib] - Y[ia]) * f;
        if (n === 0) { px = x; py = y; } else { qx = x; qy = y; }
        n++;
      };
      edge(i0, i1, d0, d1); edge(i1, i2, d1, d2); edge(i2, i0, d2, d0);
      if (n !== 2) continue;
      const cr = px * qy - py * qx;
      if (Math.abs(cr) < 1e-18) continue;                    // the segment points at the axis
      let lo = Math.atan2(py, px), hi = Math.atan2(qy, qx);
      if (cr < 0) { const s = lo; lo = hi; hi = s; }
      if (hi < lo) hi += Math.PI * 2;
      const ex = qx - px, ey = qy - py;
      const k0 = Math.ceil(lo / DT - RAY0), k1 = Math.ceil(hi / DT - RAY0);   // rays with lo ≤ θ < hi
      for (let kk = k0; kk < k1; kk++) {
        const k = ((kk % K) + K) % K;
        const den = COS[k] * ey - SIN[k] * ex;
        if (Math.abs(den) < 1e-18) continue;
        const r = cr / den;
        if (!(r > 0) || nh[k] >= MAXHIT) continue;
        hits[k * MAXHIT + nh[k]++] = r;
      }
    }
    let empty = 0, hollow = 0, solid = 0, wall = 0, wallN = 0;
    for (let k = 0; k < K; k++) {
      const n = nh[k], o = k * MAXHIT;
      if (!n) { rOut[k] = 0; rIn[k] = 0; empty++; continue; }
      // sort the few crossings and drop doubles (two faces meeting on the ray)
      for (let i = 1; i < n; i++) { const x = hits[o + i]; let j = i - 1; while (j >= 0 && hits[o + j] > x) { hits[o + j + 1] = hits[o + j]; j--; } hits[o + j + 1] = x; }
      let m = 1, first = hits[o], last = hits[o];
      for (let i = 1; i < n; i++) { if (hits[o + i] - last > eps) { m++; } last = hits[o + i]; }
      rOut[k] = last;
      if (m % 2 === 0) { hollow++; rIn[k] = first; wall += last - first; wallN++; } else { solid++; rIn[k] = 0; }
    }
    const o = outlineType(rOut), inn = hollow > K * 0.5 ? outlineType(rIn) : null;
    const state = empty > K * 0.5 ? 'empty' : hollow >= (K - empty) * 0.8 ? 'hollow' : solid >= (K - empty) * 0.8 ? 'solid' : 'mixed';
    slices.push({
      za, zb, len: zb - za, state, gap: empty / K, wide: widest(za, zb),
      ro: o.mean, roMin: o.min, roMax: o.max, oType: o.type,
      ri: inn ? inn.mean : 0, riMin: inn ? inn.min : 0, riMax: inn ? inn.max : 0, iType: inn ? inn.type : 'none',
      wall: wallN ? wall / wallN : 0,
    });
  }
  return { slices, L, R: rmax };
}

// ── reading a profile ───────────────────────────────────────────────────────
const lenOf = (S, f) => { let s = 0; for (const x of S) if (f(x)) s += x.len; return s; };
// The value most of the length sits at.
function wMedian(S, f, val) {
  const a = [];
  let tot = 0;
  for (const s of S) if (f(s)) { a.push([val(s), s.len]); tot += s.len; }
  if (!a.length) return 0;
  a.sort((x, y) => x[0] - y[0]);
  let acc = 0;
  for (const [v, w] of a) { acc += w; if (acc >= tot / 2) return v; }
  return a[a.length - 1][0];
}
const roundish = (t) => t === 'circle';
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// 1 inside [a,b], falling to 0 at the outer limits [lo,hi]
const fit = (x, lo, a, b, hi) => x < lo || x > hi ? 0 : x < a ? (x - lo) / (a - lo) : x > b ? (hi - x) / (hi - b) : 1;

function asWasher(S, L) {
  const hol = lenOf(S, s => s.state === 'hollow');
  if (hol < 0.93 * L) return null;
  const isRing = (s) => s.state === 'hollow' && roundish(s.oType) && roundish(s.iType) && s.gap < 0.12;
  if (lenOf(S, isRing) < 0.8 * L) return null;
  const ro = wMedian(S, isRing, s => s.ro), ri = wMedian(S, isRing, s => s.ri);
  let wallMax = 0;
  for (const s of S) if (isRing(s)) wallMax = Math.max(wallMax, s.ro - s.ri);
  if (!(wallMax > 0) || !(ri > 0)) return null;
  const D = 2 * ro, ratio = ri / ro, flat = L / D, sect = L / wallMax;
  if (ratio < 0.18 || ratio > 0.84 || flat > 0.36 || sect > 0.95) return null;
  // a washer's wall is one thickness from face to face; an O-ring's swells
  // and thins. A cup or finishing washer is pressed into a dish, so its wall
  // is whole over less of its height — but it is far flatter than a round
  // section, which an O-ring is not.
  const whole = lenOf(S, s => isRing(s) && s.ro - s.ri >= 0.86 * wallMax) / L;
  const dished = whole < 0.7;
  if (dished && (whole < 0.35 || sect > 0.65)) return null;
  const score = 0.62 + 0.2 * fit(ratio, 0.18, 0.3, 0.72, 0.84) + 0.18 * fit(sect, 0, 0.05, 0.7, 0.95) - (dished ? 0.12 : 0);
  return { kind: 'washer', sub: dished ? 'cup' : 'plain', score: clamp01(score), d: 2 * ri, od: D, length: L };
}

function asNut(S, L) {
  const hol = lenOf(S, s => s.state === 'hollow');
  const mixed = lenOf(S, s => s.state === 'mixed');
  const through = hol + mixed >= 0.93 * L && hol >= 0.6 * L;
  let cap = false;
  if (!through) {
    // a cap nut: open at one end, closed by a dome at the other
    if (hol < 0.4 * L) return null;
    const first = S.findIndex(s => s.state === 'hollow'), last = S.length - 1 - [...S].reverse().findIndex(s => s.state === 'hollow');
    if (first !== 0 && last !== S.length - 1) return null;
    const rest = first === 0 ? S.slice(last + 1) : S.slice(0, first);
    if (!rest.length || rest.some(s => s.state !== 'solid')) return null;
    for (let i = first; i <= last; i++) if (S[i].state !== 'hollow') return null;
    cap = true;
  }
  const flats = (s) => s.oType === 'hex' || s.oType === 'square';
  const hexLen = lenOf(S, s => s.oType === 'hex'), sqLen = lenOf(S, s => s.oType === 'square');
  const sided = Math.max(hexLen, sqLen);
  if (sided < 0.38 * L) return null;
  const want = hexLen >= sqLen ? 'hex' : 'square';
  const af = 2 * wMedian(S, s => s.oType === want, s => s.roMin);            // across flats
  const bore = (s) => s.state === 'hollow' && s.iType === 'circle';
  const rb = wMedian(S, bore, s => s.ri);
  if (!(rb > 0) || !(af > 0)) return null;
  if (lenOf(S, s => bore(s) && Math.abs(s.ri - rb) <= 0.16 * rb) < 0.55 * hol) return null;
  let rmaxOut = 0;
  for (const s of S) rmaxOut = Math.max(rmaxOut, s.roMax);
  // a dome nut with a hole in its crown (a cable gland's cap nut): the bore
  // closes in at one end
  if (!cap) {
    const e0 = S[0], e1 = S[S.length - 1];
    if (Math.min(e0.ri || rb, e1.ri || rb) <= 0.72 * rb && sided < 0.8 * L) cap = true;
  }
  const b = 2 * rb / af, h = L / af;
  // (a cap nut is often a thin shell; an open hex with so thin a wall is a pipe fitting)
  if (b < 0.36 || b > (cap ? 0.93 : 0.86) || h < 0.2 || h > 2.4 || rmaxOut > 1.02 * af) return null;
  // a long nut is six-sided from end to end; a cable gland, a hose fitting or
  // a standoff with collars has a hexagon somewhere along it
  if (h > 1.2 && !cap && sided < 0.8 * L) return null;
  let score = (want === 'hex' ? 0.72 : 0.56) + 0.14 * fit(b, 0.36, 0.46, 0.76, 0.86) + 0.14 * fit(h, 0.2, 0.3, 1.25, 2.3);
  if (cap) score -= 0.06;
  const sub = cap ? 'cap' : want === 'square' ? 'square' : h > 1.4 ? 'coupling' : rmaxOut > 0.66 * af ? 'flange' : 'hex';
  return { kind: 'nut', sub, score: clamp01(score), d: 2 * rb, af, length: L };
}

// A shank from one end and a head at the other. `T` runs from the tip.
function boltFromTip(T, L) {
  let R = 0;
  for (const s of T) R = Math.max(R, s.roMax);
  const shankish = (s) => s.state === 'solid' && roundish(s.oType);
  // the radius most of the solid round length sits at, and is not the widest
  const cl = [];
  for (const s of T) {
    if (!shankish(s) || s.ro > 0.84 * R) continue;
    let c = cl.find(c => Math.abs(c.r - s.ro) <= 0.045 * c.r);
    if (!c) cl.push(c = { r: s.ro, len: 0 });
    c.r = (c.r * c.len + s.ro * s.len) / (c.len + s.len); c.len += s.len;
  }
  if (!cl.length) return null;
  cl.sort((a, b) => b.len - a.len);
  const r1 = cl[0].r;
  // walk in from the tip while it is still shank (a thread is a little thinner than the plain part)
  let i = 0, run = 0;
  for (; i < T.length; i++) {
    const s = T[i];
    if (s.state !== 'solid' || s.roMax > 1.27 * r1) break;
    if (run > 0 && !roundish(s.oType) && s.ro > 0.7 * r1) break;
    run += s.len;
  }
  if (i === 0 || i >= T.length) return null;
  // the shank's radius: the widest that a real stretch of it has (not a burr, not one thin slab)
  const rr = T.slice(0, i).filter(s => roundish(s.oType)).sort((a, b) => b.ro - a.ro);
  let rs = 0, acc = 0;
  for (const s of rr) { acc += s.len; if (acc >= 0.04 * run) { rs = s.ro; break; } }
  if (!(rs > 0)) return null;
  const d = 2 * rs;
  const atD = lenOf(T.slice(0, i), s => roundish(s.oType) && s.ro >= 0.78 * rs);
  if (run < 0.55 * d || run > 45 * d || atD < 0.6 * run) return null;
  const head = T.slice(i);
  const k = lenOf(head, () => true);
  let Rh = 0;
  for (const s of head) Rh = Math.max(Rh, s.roMax, s.wide);
  if (head.some(s => s.state === 'empty')) return null;
  if (lenOf(head, s => s.ro >= 0.9 * rs) < 0.85 * k) return null;
  const hd = Rh / rs, hk = k / d;
  if (hd < 1.28 || hd > 3.1 || hk < 0.16 || hk > 1.75) return null;
  // what the head is
  const hexLen = lenOf(head, s => s.oType === 'hex'), recess = lenOf(head, s => s.state === 'hollow' || s.state === 'mixed');
  const odd = lenOf(head, s => s.oType === 'other' || s.oType === 'none');
  // a countersunk head is a cone: nowhere as wide as its top, and widest at the very end
  const top = head[head.length - 1];
  const flatLen = lenOf(head, s => s.ro >= 0.88 * Rh);
  let sub = 'round';
  if (hexLen >= 0.4 * k) sub = 'hex';
  else if (flatLen < 0.3 * k && Math.max(top.roMax, top.wide) >= 0.97 * Rh) sub = 'countersunk';
  else if (recess >= 0.15 * k) sub = 'socket';
  let score = 0.5
    + (sub === 'hex' || sub === 'socket' ? 0.2 : 0)
    + 0.16 * Math.min(fit(hd, 1.28, 1.42, 2.4, 3.1), fit(hk, 0.16, 0.38, 1.15, 1.75))
    + 0.1 * clamp01((run / d - 0.55) / 1.2)
    + 0.06 * clamp01(atD / run * 2 - 1);
  if (odd > 0.5 * k && sub === 'round') score -= 0.2;
  return { kind: 'bolt', sub, score: clamp01(score), d, length: sub === 'countersunk' ? L : run, headD: 2 * Rh, headH: k };
}

function asBolt(S, L) {
  const a = boltFromTip(S, L), b = boltFromTip([...S].reverse(), L);
  return !a ? b : !b ? a : a.score >= b.score ? a : b;
}

// A headless screw: a round bar with a key socket in one end.
function asSetScrew(S, L) {
  const round = lenOf(S, s => roundish(s.oType) && s.state !== 'empty');
  if (round < 0.9 * L) return null;
  const r = wMedian(S, s => roundish(s.oType), s => s.ro);
  if (lenOf(S, s => Math.abs(s.ro - r) <= 0.06 * r) < 0.75 * L) return null;
  const hol = lenOf(S, s => s.state === 'hollow'), sol = lenOf(S, s => s.state === 'solid');
  if (hol < 0.12 * L || hol > 0.8 * L || sol < 0.15 * L) return null;
  const first = S.findIndex(s => s.state === 'hollow'), last = S.length - 1 - [...S].reverse().findIndex(s => s.state === 'hollow');
  if (first !== 0 && last !== S.length - 1) return null;
  for (let i = first; i <= last; i++) if (S[i].state !== 'hollow') return null;
  const sock = S.slice(first, last + 1);
  const hexSock = lenOf(sock, s => s.iType === 'hex') >= 0.5 * hol;
  if (!hexSock) return null;                                   // a round blind hole is a bushing, a cap, a roller
  const ri = wMedian(sock, () => true, s => s.ri), a = L / (2 * r);
  if (ri / r < 0.3 || ri / r > 0.8 || a < 0.4 || a > 8) return null;
  return { kind: 'bolt', sub: 'set', score: 0.78, d: 2 * r, length: L, headD: 2 * r, headH: 0 };
}

// A plain round bar: a stud, a dowel pin, a threaded rod.
function asPin(S, L) {
  const ok = (s) => s.state === 'solid' && roundish(s.oType);
  if (lenOf(S, ok) < 0.96 * L) return null;
  const r = wMedian(S, ok, s => s.ro);
  if (lenOf(S, s => ok(s) && Math.abs(s.ro - r) <= 0.05 * r) < 0.82 * L) return null;
  for (const s of S) if (s.roMax > 1.12 * r) return null;
  const a = L / (2 * r);
  if (a < 1.5 || a > 60) return null;
  return { kind: 'pin', sub: 'plain', score: 0.5 + 0.1 * fit(a, 1.5, 2.5, 20, 60), d: 2 * r, length: L };
}

// Candidate axes: the odd direction of each spread (usually the same one).
function candidateAxes(mo) {
  const cands = [];
  const add = (v) => { if (v && !cands.some(c => Math.abs(dot(c, v)) > 0.9986)) cands.push(v); };
  const a = oddAxis(mo.C), b = oddAxis(mo.N);
  if (a && a.axis) add(a.axis);
  if (b && b.axis) add(b.axis);
  if (!cands.length) for (const s of [a, b]) if (s && s.iso) for (const v of s.vecs) add(v);
  return cands;
}

// For tests and for looking into a part that was not recognised: the slices themselves.
export function _profile(positions, index) {
  const nTri = index ? (index.length / 3) | 0 : (positions.length / 9) | 0;
  const mo = surfaceMoments(positions, index, nTri);
  if (!mo) return { note: 'no surface', cands: [] };
  const e1 = eigSym3(mo.C), e2 = eigSym3(mo.N);
  const note = `spread ${e1.w.map(x => x.toPrecision(3))} · directions ${e2.w.map(x => x.toPrecision(3))}`;
  return { note, cands: candidateAxes(mo).map(axis => ({ axis, ...sliceProfile(positions, index, nTri, mo.c, axis) })) };
}

/**
 * What kind of fastener a mesh is, if it is one.
 * @param positions  Float32Array, xyz per vertex
 * @param index      Uint16/32Array of triangles, or null for a plain triangle list
 * @returns null, or { kind:'bolt'|'nut'|'washer'|'pin', sub, score 0..1, d, length, … , axis:[x,y,z] }
 *          — sizes in the mesh's units. `d` is the shank diameter of a bolt
 *          or pin, and the hole of a nut or washer.
 */
export function classifyFastener(positions, index, opts = {}) {
  const nTri = index ? (index.length / 3) | 0 : (positions.length / 9) | 0;
  if (nTri < 8 || nTri > (opts.maxTriangles || 400000)) return null;
  const mo = surfaceMoments(positions, index, nTri);
  if (!mo) return null;
  const cands = candidateAxes(mo);
  if (!cands.length) return null;                                // neither turned nor six-sided
  let best = null;
  for (const axis of cands.slice(0, 3)) {
    const pr = sliceProfile(positions, index, nTri, mo.c, axis);
    if (!pr) continue;
    const { slices: S, L, R } = pr;
    // empty slabs at the ends (a stray vertex) are not part of the shape
    while (S.length && S[0].state === 'empty') S.shift();
    while (S.length && S[S.length - 1].state === 'empty') S.pop();
    if (!S.length) continue;
    const len = lenOf(S, () => true);
    for (const f of [asWasher, asNut, asBolt, asSetScrew, asPin]) {
      const r = f(S, len, R);
      if (r && (!best || r.score > best.score)) { best = r; best.axis = axis; best.size = Math.max(len, 2 * R); }
    }
    if (best && best.score >= 0.6) break;
  }
  return best;
}

// ── sizes and names ────────────────────────────────────────────────────────
const METRIC = [1, 1.2, 1.4, 1.6, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 42, 48, 56, 64];
// The width across flats of a hex nut, per thread size (ISO 4032, with the DIN 934 sizes that differ).
const NUT_AF = { 1.6: [3.2], 2: [4], 2.5: [5], 3: [5.5], 4: [7], 5: [8], 6: [10], 8: [13], 10: [16, 17], 12: [18, 19], 14: [21, 22], 16: [24], 18: [27], 20: [30], 22: [34, 32], 24: [36], 27: [41], 30: [46], 36: [55], 42: [65], 48: [75] };

/** The thread size a recognised fastener belongs to, in mm (0 when it fits none). `r` scaled to mm. */
export function fastenerThread(r) {
  if (!r) return 0;
  if (r.kind === 'bolt' || r.kind === 'pin') {
    // a modelled thread is cut a little under size, a plain shank is on size
    let best = 0, err = Infinity;
    for (const m of METRIC) { const e = Math.abs(r.d - m) / m; if (e < err) { err = e; best = m; } }
    if (err <= 0.045) return best;
    for (const m of METRIC) if (r.d < m && r.d >= m * 0.8) return m;
    return 0;
  }
  if (r.kind === 'nut') {
    for (const m of METRIC) {
      const afs = NUT_AF[m];
      if (afs && afs.some(a => Math.abs(r.af - a) <= a * 0.035) && r.d <= m * 1.03 && r.d >= m * 0.74) return m;
    }
    for (const m of METRIC) if (r.d <= m * 1.02 && r.d >= m * 0.78) return m;
    return 0;
  }
  // a washer's hole is a little over the thread it goes on
  let best = 0;
  for (const m of METRIC) if (r.d >= m * 1.0 && r.d <= m * 1.16 + 0.25) best = m;
  return best;
}

const SUB = {
  bolt: { hex: 'hex bolt', socket: 'socket screw', countersunk: 'countersunk screw', round: 'screw', set: 'set screw' },
  nut: { hex: 'hex nut', flange: 'flange nut', cap: 'cap nut', square: 'square nut', coupling: 'coupling nut' },
  washer: { plain: 'washer', cup: 'cup washer' },
  pin: { plain: 'pin' },
};
const mm = (x) => { const v = Math.round(x * 10) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };

/** "M8 × 30 hex bolt", "M8 hex nut", "M8 washer", "⌀6 × 40 pin". `r` scaled to mm. */
export function fastenerLabel(r) {
  if (!r) return '';
  const t = fastenerThread(r), what = (SUB[r.kind] && SUB[r.kind][r.sub]) || r.kind;
  const size = t && r.kind !== 'pin' ? 'M' + mm(t) : '⌀' + mm(r.d);       // (a plain bar is called by its diameter)
  if (r.kind === 'bolt' || r.kind === 'pin') return `${size} × ${Math.round(r.length)} ${what}`;
  return `${size} ${what}`;
}

/** The result with its sizes multiplied by `s` (mesh units → mm, or a part's own scale). */
export function scaleFastener(r, s) {
  if (!r || s === 1) return r;
  const o = { ...r };
  for (const k of ['d', 'od', 'af', 'length', 'headD', 'headH', 'size']) if (o[k] != null) o[k] *= s;
  return o;
}
