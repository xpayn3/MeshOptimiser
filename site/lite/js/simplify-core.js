// simplify-core.js — the one place that decides how a mesh is reduced.
//
// Shared by the page (app.js) and the background workers (mesh-worker.js),
// so Decimate, Fit to budget and the worker path give the same result and
// report the same number. Nothing here touches three.js beyond reading
// BufferAttributes, and nothing touches the page.

// How much each attribute counts against position when two vertices are
// merged. Positions are measured against the size of the mesh, normals are
// unit vectors, so these are small numbers. Halved from 0.5 / 0.2 / 0.2 after
// measuring against Blender's Decimate (tests/blender/compare-tools.mjs and the
// variants beside it): on three NIST CAD parts the surface moved 2 to 9 % less
// and the shading normals turned less as well; on an organic mesh the surface
// moved 16 % less and the UVs 19 % less, for 0.3 degrees more on the normals.
// Lower still (a fifth, or none) the normals of smooth parts turned 2 to 3 times as far.
export const ATTR_WEIGHT = { normal: 0.25, uv: 0.1, color: 0.1 };

// Normals, the first UV set and vertex colours of `geom`, side by side in one
// Float32Array (what simplifyWithAttributes wants). null when the mesh has
// none of them, or when they do not line up with the positions.
export function packAttributes(geom) {
  const pos = geom && geom.attributes && geom.attributes.position;
  if (!pos) return null;
  const n = pos.count;
  const cols = [];
  for (const [name, size, w] of [['normal', 3, ATTR_WEIGHT.normal], ['uv', 2, ATTR_WEIGHT.uv], ['color', 3, ATTR_WEIGHT.color]]) {
    const a = geom.attributes[name];
    if (!(a && a.count === n && a.itemSize >= size)) continue;
    // UVs count by how far they span: the weight is for a texture laid once over the 0..1 square, so UVs that tile it ten times
    // (or are in millimetres) count ten times less per unit, and UVs that do not change at all (all zero) do not count
    if (name === 'uv') {
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let v = 0; v < n; v++) { const x = a.getComponent ? a.getComponent(v, 0) : a.array[v * a.itemSize], y = a.getComponent ? a.getComponent(v, 1) : a.array[v * a.itemSize + 1]; if (x < u0) u0 = x; if (x > u1) u1 = x; if (y < v0) v0 = y; if (y > v1) v1 = y; }
      const span = Math.max(u1 - u0, v1 - v0);
      if (span > 1e-9) cols.push({ a, size, w: w / span });
      continue;
    }
    cols.push({ a, size, w });
  }
  if (!cols.length) return null;
  const stride = cols.reduce((s, c) => s + c.size, 0);
  const data = new Float32Array(n * stride);
  const weights = [], layout = [];
  let off = 0;
  for (const { a, size, w } of cols) {
    const direct = !a.isInterleavedBufferAttribute && a.array instanceof Float32Array && a.itemSize === size;
    for (let v = 0; v < n; v++) {
      if (direct) for (let c = 0; c < size; c++) data[v * stride + off + c] = a.array[v * size + c];
      else for (let c = 0; c < size; c++) data[v * stride + off + c] = a.getComponent(v, c);
    }
    for (let c = 0; c < size; c++) weights.push(w);
    layout.push({ name: Object.keys(geom.attributes).find(k => geom.attributes[k] === a), size, off });
    off += size;
  }
  return { data, stride, weights, layout };
}

// meshoptimizer 1.x's simplifyWithUpdate: the vertices that stay are moved to where the removed ones are best stood in for, and
// their normals, UVs and colours with them, instead of being kept where they were. Measured against the plain run on the
// Gearbox Assy's three heaviest parts (node, both sides of the surface measured): the largest distance moved 30 to 35 % less at
// 50 / 25 / 10 %, the mean distance half as far at 10 %, in a third of the time; on parts it cannot take to the target (attribute
// seams) it gets no further than the plain run, which then takes over. It writes into the arrays it is given, so it is handed
// copies: `positions` and `attrs.data` come back moved, in `upd`. Only for one index range over the vertices (one material):
// with several, a vertex two ranges share would be moved twice.
function reduceUpdate(S, sub, positions, target, attrs, lockFlags, flags, error) {
  const P = positions.slice(), A = attrs ? attrs.data.slice() : new Float32Array(positions.length / 3);
  const idx = sub.slice();
  const [count, rel] = S.simplifyWithUpdate(idx, P, 3, A, attrs ? attrs.stride : 1, attrs ? attrs.weights : [0], lockFlags || null, target, error, flags);
  return { idx: idx.slice(0, count), rel, upd: { positions: P, attrs: attrs ? A : null } };
}

// As far as no point moves more than `tol` (in the units of `positions`), borders free and attributes not weighed (see the worker's
// note on why). With `update` (one material) the vertices are moved as in reduceUpdate: measured on the Gearbox Assy brought in as
// millimetres, the plain run could not be fitted to 0.5 to 2 mm on its largest part (a few collapses its estimate puts at nothing
// move a curved face by about 0.9 mm), the moved one fitted at 0.5 mm. Returns { idx, err, upd? }.
export function reduceWithin(S, sub, positions, tol, update) {
  const scale = S.getScale(positions, 3) || 1, e = Math.min(1, tol / scale);
  if (update && S.simplifyWithUpdate) {
    try { const r = reduceUpdate(S, sub, positions, 0, null, null, [], e); return { idx: r.idx, err: r.rel * scale, upd: r.upd }; }
    catch (_) { /* an older build: the plain run below */ }
  }
  const [idx, rel] = S.simplify(sub, positions, 3, 0, e);
  return { idx, err: rel * scale };
}

// Sharp edges, for the simplifier's vertex lock. A CAD part is smooth faces meeting at hard edges; the quadric error alone
// will happily round a hard edge off when it has to remove a lot. This finds the edges where two neighbouring faces turn
// by more than `deg` degrees (a rim, a step, a corner, not the 5 to 30 degrees between the facets of a tessellated cylinder)
// and marks the vertices on them, so the simplifier leaves those vertices where they are. Vertices at the same place count
// as one (a hard edge is usually two vertices, one for each face). Border edges are the simplifier's LockBorder business.
export function analyseCreases(sub, positions) {
  const n = positions.length / 3, canon = new Int32Array(n).fill(-1);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < sub.length; i++) { const v = sub[i]; for (let k = 0; k < 3; k++) { const x = positions[v * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; } }
  const cell = Math.max(1e-12, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1e-6);
  // vertices at the same place: a table of cell numbers (open addressing), not a string per vertex
  let cap = 16; while (cap < n * 2) cap <<= 1;
  const mask = cap - 1, slots = new Int32Array(cap).fill(-1);
  const qx = new Int32Array(n), qy = new Int32Array(n), qz = new Int32Array(n);
  let next = 0;
  const idOf = (v) => {
    let c = canon[v]; if (c >= 0) return c;
    const ix = Math.round((positions[v * 3] - lo[0]) / cell), iy = Math.round((positions[v * 3 + 1] - lo[1]) / cell), iz = Math.round((positions[v * 3 + 2] - lo[2]) / cell);
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
    for (;;) {
      const w = slots[h];
      if (w < 0) { c = next++; slots[h] = c; qx[c] = ix; qy[c] = iy; qz[c] = iz; break; }
      if (qx[w] === ix && qy[w] === iy && qz[w] === iz) { c = w; break; }
      h = (h + 1) & mask;
    }
    canon[v] = c; return c;
  };
  const tris = sub.length / 3, nx = new Float32Array(tris), ny = new Float32Array(tris), nz = new Float32Array(tris);
  const first = new Map(), a = [], b = [], cosv = [];
  for (let t = 0; t < tris; t++) {
    const i0 = sub[t * 3], i1 = sub[t * 3 + 1], i2 = sub[t * 3 + 2];
    const ux = positions[i1 * 3] - positions[i0 * 3], uy = positions[i1 * 3 + 1] - positions[i0 * 3 + 1], uz = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
    const vx = positions[i2 * 3] - positions[i0 * 3], vy = positions[i2 * 3 + 1] - positions[i0 * 3 + 1], vz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const m = Math.hypot(x, y, z);
    if (m > 0) { x /= m; y /= m; z /= m; } else { x = y = z = NaN; }      // (a triangle with no area has no direction: it takes no part in a crease)
    nx[t] = x; ny[t] = y; nz[t] = z;
    const c0 = idOf(i0), c1 = idOf(i1), c2 = idOf(i2);
    for (let side = 0; side < 3; side++) {
      const p = side === 0 ? c0 : side === 1 ? c1 : c2, q = side === 0 ? c1 : side === 1 ? c2 : c0;
      if (p === q) continue;
      const key = p < q ? p * 67108864 + q : q * 67108864 + p, f = first.get(key);
      if (f === undefined) first.set(key, t);
      else if (f >= 0) {                               // the second face on this edge (a third one, a non-manifold edge, is left alone)
        a.push(p < q ? p : q); b.push(p < q ? q : p); cosv.push(nx[f] * x + ny[f] * y + nz[f] * z);
        first.set(key, -1);
      }
    }
  }
  return { canon, count: next, a: Int32Array.from(a), b: Int32Array.from(b), cos: Float32Array.from(cosv), n };
}

// vertex_lock flags (Uint8Array, one per vertex) for the edges sharper than `deg`; `count` is how many vertices are locked.
export function lockSharp(an, deg) {
  const lim = Math.cos(deg * Math.PI / 180), hot = new Uint8Array(an.count);
  for (let e = 0; e < an.cos.length; e++) if (an.cos[e] < lim) { hot[an.a[e]] = 1; hot[an.b[e]] = 1; }
  const flags = new Uint8Array(an.n); let count = 0;
  for (let v = 0; v < an.n; v++) { const c = an.canon[v]; if (c >= 0 && hot[c]) { flags[v] = 1; count++; } }
  return { flags, count };
}

// Reduce the triangles in `sub` (an index range) towards `target` indices.
// `attrs` is what packAttributes returned, or null.
//
// Tried in order, the first that gets within 25% of the target wins:
//   0. sharp edges locked (opts.sharp), when that still reaches the target: kept only when its own error estimate is not clearly
//      worse than the plain run's (measured on a real part: the locked vertices can make the rest of the surface drift five times
//      further, 25 mm against 4.5 mm at 10 %), so the plain rungs below are always run as well and the two are compared;
//   1. attribute-aware, borders locked   (keeps creases, UV seams and colours)
//   2. positions only, borders locked    (outlines don't creep)
//   3. positions only, borders free      (a mesh that is mostly border)
// If none gets there, the smallest result is kept.
// With opts.update (one material only, see reduceUpdate) a moved run is tried before all of them, its sharp edges locked as in 0.
// when the part allows it; it wins when it gets within 25 % of the target, and its moved arrays come back as `upd`.
//
// Returns { idx, err, upd? }. `err` is the simplifier's own estimate of how far the
// new surface moved, in the units of `positions` (the library reports it
// relative to the size of the mesh; it is scaled back here). It is an
// estimate of the largest collapse error, not a measured distance.
export function reduceIndex(S, sub, positions, target, attrs, opts) {
  const scale = S.getScale(positions, 3) || 1;
  const near = (r) => r.idx.length <= target * 1.25;
  let best = null, sharpR = null;
  const keep = (idx, rel) => { const r = { idx, err: rel * scale }; if (!best || r.idx.length < best.idx.length) best = r; return r; };
  // the sharp-edge result against a plain one that also reached the target: the lock wins unless it costs clearly more elsewhere
  const pick = (r) => (sharpR && sharpR.err <= r.err * 1.5) ? sharpR : r;

  if (opts && opts.update && S.simplifyWithUpdate) {
    try {
      let lock = null, held = 0;
      if (opts.sharp > 0) {
        const l = lockSharp(analyseCreases(sub, positions), opts.sharp);
        if (l.count && l.count <= (opts.maxShare > 0 ? opts.maxShare : 0.08) * (positions.length / 3)) { lock = l.flags; held = l.count; }
      }
      const u = reduceUpdate(S, sub, positions, target, attrs, lock, ['LockBorder'], 1.0);
      if (u.idx.length <= target * 1.25) return { idx: u.idx, err: u.rel * scale, upd: u.upd, sharpKept: held };
    } catch (_) { /* an older build, or the data did not fit: the usual paths */ }
  }

  // 0. sharp edges first, when asked for (opts.sharp is an angle in degrees): the vertices on them are locked. It only counts if
  //    the target is still reached with them locked, so a part made of nothing but hard edges falls through to the paths below
  //    (a gear cannot be both). A harder angle is tried second: only the sharpest edges are kept then.
  if (opts && opts.sharp > 0 && S.simplifyWithAttributes && S.useExperimentalFeatures) {
    try {
      const an = analyseCreases(sub, positions), a = attrs || { data: new Float32Array(positions.length / 3), stride: 1, weights: [0] };
      for (const deg of [opts.sharp, Math.min(85, opts.sharp * 1.7)]) {
        const lock = lockSharp(an, deg);
        if (!lock.count) break;                            // nothing is that sharp: the paths below do the work
        // A part whose vertices are mostly on hard edges (a gear, a knurled knob) would spend its whole budget on them and then
        // pay for it everywhere else: measured on a real assembly, locking more than about a twelfth of the vertices made the
        // surface drift further than leaving the edges to the quadric. Those parts are left to the usual paths.
        if (lock.count > (opts.maxShare > 0 ? opts.maxShare : 0.08) * (positions.length / 3)) continue;
        const [idx, rel] = S.simplifyWithAttributes(sub, positions, 3, a.data, a.stride, a.weights, lock.flags, target, 1.0, ['LockBorder']);
        const r = keep(idx, rel);
        if (near(r)) { r.sharpKept = lock.count; sharpR = r; break; }
      }
    } catch (_) { /* fall through to the usual paths */ }
  }
  if (attrs && S.simplifyWithAttributes && S.useExperimentalFeatures) {
    try {
      const [idx, rel] = S.simplifyWithAttributes(sub, positions, 3, attrs.data, attrs.stride, attrs.weights, null, target, 1.0, ['LockBorder']);
      const r = keep(idx, rel);
      if (near(r)) return pick(r);
    } catch (_) { /* an older build, or the data did not fit: fall through to the plain path */ }
  }
  {
    const [idx, rel] = S.simplify(sub, positions, 3, target, 1.0, ['LockBorder']);
    const r = keep(idx, rel);
    if (near(r)) return pick(r);
  }
  {
    const [idx, rel] = S.simplify(sub, positions, 3, target, 1.0);
    const r = keep(idx, rel);
    if (near(r)) return pick(r);
  }
  return sharpR || best;
}
