// simplify-core.js — the one place that decides how a mesh is reduced.
//
// Shared by the page (app-v2.js) and the background workers (mesh-worker.js),
// so Decimate, Fit to budget and the worker path give the same result and
// report the same number. Nothing here touches three.js beyond reading
// BufferAttributes, and nothing touches the page.

// How much each attribute counts against position when two vertices are
// merged. Positions are measured against the size of the mesh, normals are
// unit vectors, so these are small numbers.
export const ATTR_WEIGHT = { normal: 0.5, uv: 0.2, color: 0.2 };

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
    if (a && a.count === n && a.itemSize >= size) cols.push({ a, size, w });
  }
  if (!cols.length) return null;
  const stride = cols.reduce((s, c) => s + c.size, 0);
  const data = new Float32Array(n * stride);
  const weights = [];
  let off = 0;
  for (const { a, size, w } of cols) {
    const direct = !a.isInterleavedBufferAttribute && a.array instanceof Float32Array && a.itemSize === size;
    for (let v = 0; v < n; v++) {
      if (direct) for (let c = 0; c < size; c++) data[v * stride + off + c] = a.array[v * size + c];
      else for (let c = 0; c < size; c++) data[v * stride + off + c] = a.getComponent(v, c);
    }
    for (let c = 0; c < size; c++) weights.push(w);
    off += size;
  }
  return { data, stride, weights };
}

// Reduce the triangles in `sub` (an index range) towards `target` indices.
// `attrs` is what packAttributes returned, or null.
//
// Tried in order, the first that gets within 25% of the target wins:
//   1. attribute-aware, borders locked   (keeps creases, UV seams and colours)
//   2. positions only, borders locked    (outlines don't creep)
//   3. positions only, borders free      (a mesh that is mostly border)
// If none gets there, the smallest result is kept.
//
// Returns { idx, err }. `err` is the simplifier's own estimate of how far the
// new surface moved, in the units of `positions` (the library reports it
// relative to the size of the mesh; it is scaled back here). It is an
// estimate of the largest collapse error, not a measured distance.
export function reduceIndex(S, sub, positions, target, attrs) {
  const scale = S.getScale(positions, 3) || 1;
  const near = (r) => r.idx.length <= target * 1.25;
  let best = null;
  const keep = (idx, rel) => { const r = { idx, err: rel * scale }; if (!best || r.idx.length < best.idx.length) best = r; return r; };

  if (attrs && S.simplifyWithAttributes && S.useExperimentalFeatures) {
    try {
      const [idx, rel] = S.simplifyWithAttributes(sub, positions, 3, attrs.data, attrs.stride, attrs.weights, null, target, 1.0, ['LockBorder']);
      if (near(keep(idx, rel))) return best;
    } catch (_) { /* an older build, or the data did not fit: fall through to the plain path */ }
  }
  {
    const [idx, rel] = S.simplify(sub, positions, 3, target, 1.0, ['LockBorder']);
    if (near(keep(idx, rel))) return best;
  }
  {
    const [idx, rel] = S.simplify(sub, positions, 3, target, 1.0);
    keep(idx, rel);
  }
  return best;
}
