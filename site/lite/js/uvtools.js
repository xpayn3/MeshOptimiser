// uvtools.js — what a mesh's texture coordinates (UVs) look like, found from the numbers alone.
//
// analyseUV(positions, uv, index) reads the UVs once and says, in counts:
//   islands      pieces of the UV map that are joined along edges whose two corners have the same place on the model AND the same UV
//   outside      triangles with a corner outside the 0–1 square (a texture tile that is not the first one, or a stray island)
//   collapsed    triangles with no area in UV space (all three corners on a line or on one point): the texture shows a smear there
//   flipped      triangles whose UV winding is opposite to the most common one (mirrored islands show the texture back to front)
//   used         the share of the 0–1 square that the islands cover (0 to 1)
//   overlap      the share of the covered space that more than one island sits on (0 to 1); islands that lie on each other share texels
//   density      how many texels per unit of model a triangle gets, as the median and the 5th / 95th percentile, and `uneven`, the
//                share of triangles whose density is more than twice or less than half the median (a stretched or squeezed area)
// and hands back what is needed to draw the map: `cover` (res × res cells, 0 empty, 1 covered, 2 covered by several islands),
// `border` (the UV edges that are an island's rim: u0, v0, u1, v1 in turn) and `islandOf` (the island of each triangle).
//
// Pure numbers in, numbers out (typed arrays, no three.js): the page and the node tests use the same code.

const MAX_BORDER = 400000;       // segments kept for drawing; the rest of a very busy map is not drawn

export function hasUsableUV(uv, count) {
  if (!uv || uv.length < count * 2 || count < 3) return false;
  for (let i = 0; i < count * 2; i++) if (uv[i] !== 0) return true;      // all zero: the attribute exists but carries nothing
  return false;
}

// Corners at the same place with the same UV become one point (an indexed mesh splits a corner for its normal, not for its UV).
function weldCorners(positions, uv, n) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1, sp = 1 / (diag * 1e-6), su = 1e5;
  let size = 16; while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1), keys = new Float64Array(n * 5), id = new Int32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.round((positions[i * 3] - x0) * sp), b = Math.round((positions[i * 3 + 1] - y0) * sp), c = Math.round((positions[i * 3 + 2] - z0) * sp);
    const d = Math.round(uv[i * 2] * su), e = Math.round(uv[i * 2 + 1] * su);
    let h = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791) ^ Math.imul(d | 0, 1013904223) ^ Math.imul(e | 0, 2654435761)) >>> 0;
    h &= size - 1;
    for (;;) {
      const s = table[h];
      if (s === -1) { table[h] = count; keys[count * 5] = a; keys[count * 5 + 1] = b; keys[count * 5 + 2] = c; keys[count * 5 + 3] = d; keys[count * 5 + 4] = e; id[i] = count++; break; }
      const k = s * 5;
      if (keys[k] === a && keys[k + 1] === b && keys[k + 2] === c && keys[k + 3] === d && keys[k + 4] === e) { id[i] = s; break; }
      h = (h + 1) & (size - 1);
    }
  }
  return { id, count };
}

export function analyseUV(positions, uv, index, opts = {}) {
  const n = Math.floor(positions.length / 3);
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(n / 3);
  const corner = (t, k) => (index ? index[t * 3 + k] : t * 3 + k);
  const out = {
    triCount, islands: 0, islandOf: new Int32Array(triCount), bounds: null, outside: 0, collapsed: 0, flipped: 0,
    used: 0, overlap: 0, density: { median: 0, p5: 0, p95: 0, uneven: 0 }, res: 0, cover: new Uint8Array(0), border: new Float32Array(0),
  };
  if (!triCount) return out;

  // bounds, collapsed, outside, winding
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, pos = 0, neg = 0;
  const uvArea = new Float32Array(triCount), sign = new Int8Array(triCount);
  const EPS = 1e-4;
  for (let t = 0; t < triCount; t++) {
    const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2);
    const au = uv[a * 2], av = uv[a * 2 + 1], bu = uv[b * 2], bv = uv[b * 2 + 1], cu = uv[c * 2], cv = uv[c * 2 + 1];
    for (const u of [au, bu, cu]) { if (u < minU) minU = u; if (u > maxU) maxU = u; }
    for (const v of [av, bv, cv]) { if (v < minV) minV = v; if (v > maxV) maxV = v; }
    if (au < -EPS || au > 1 + EPS || bu < -EPS || bu > 1 + EPS || cu < -EPS || cu > 1 + EPS || av < -EPS || av > 1 + EPS || bv < -EPS || bv > 1 + EPS || cv < -EPS || cv > 1 + EPS) out.outside++;
    const s2 = (bu - au) * (cv - av) - (cu - au) * (bv - av);
    uvArea[t] = Math.abs(s2) / 2;
    if (Math.abs(s2) < 1e-12) { out.collapsed++; sign[t] = 0; } else if (s2 > 0) { sign[t] = 1; pos++; } else { sign[t] = -1; neg++; }
  }
  out.bounds = { minU, maxU, minV, maxV };
  const majority = pos >= neg ? 1 : -1;
  out.flipped = majority === 1 ? neg : pos;

  // islands: triangles joined across an edge whose corners agree in place and UV
  const W = weldCorners(positions, uv, n), parent = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) parent[t] = t;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const nW = W.count + 1, edgeTri = new Map(), edgeCount = new Map();
  const edgeSeg = [];                                                                // per edge key: first segment, for the border
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const ia = corner(t, k), ib = corner(t, (k + 1) % 3), a = W.id[ia], b = W.id[ib];
      if (a === b) continue;
      const key = a < b ? a * nW + b : b * nW + a;
      const seen = edgeTri.get(key);
      if (seen === undefined) { edgeTri.set(key, t); edgeCount.set(key, 1); edgeSeg.push(ia, ib); }
      else { edgeCount.set(key, edgeCount.get(key) + 1); const ra = find(seen), rb = find(t); if (ra !== rb) parent[rb] = ra; }
    }
  }
  const islandIndex = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    let i = islandIndex.get(r);
    if (i === undefined) { i = islandIndex.size; islandIndex.set(r, i); }
    out.islandOf[t] = i;
  }
  out.islands = islandIndex.size;

  // the rim of every island: edges that only one triangle has (or more than two)
  {
    const segs = [];
    let e = 0;
    for (const [key, cnt] of edgeCount) {
      if (cnt !== 2 && segs.length < MAX_BORDER * 4) { const ia = edgeSeg[e * 2], ib = edgeSeg[e * 2 + 1]; segs.push(uv[ia * 2], uv[ia * 2 + 1], uv[ib * 2], uv[ib * 2 + 1]); }
      e++;
    }
    out.border = Float32Array.from(segs);
  }

  // the 0–1 square as a grid: which cells an island covers, and which several islands cover
  let res = opts.res || 512;
  if (!opts.res) {
    let work = 0;
    for (let t = 0; t < triCount; t++) {
      const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2);
      const w = Math.max(0, Math.min(1, Math.max(uv[a * 2], uv[b * 2], uv[c * 2])) - Math.max(0, Math.min(uv[a * 2], uv[b * 2], uv[c * 2])));
      const h = Math.max(0, Math.min(1, Math.max(uv[a * 2 + 1], uv[b * 2 + 1], uv[c * 2 + 1])) - Math.max(0, Math.min(uv[a * 2 + 1], uv[b * 2 + 1], uv[c * 2 + 1])));
      work += w * h;
    }
    while (res > 64 && work * res * res > 4e7) res >>= 1;       // a map piled with big overlapping triangles is drawn coarser
  }
  const cover = new Uint8Array(res * res), owner = new Int32Array(res * res);
  const mark = (cell, isl) => {
    if (owner[cell] === 0) { owner[cell] = isl + 1; cover[cell] = 1; }
    else if (owner[cell] !== isl + 1) cover[cell] = 2;
  };
  for (let t = 0; t < triCount; t++) {
    if (sign[t] === 0 && uvArea[t] === 0) continue;
    const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2), isl = out.islandOf[t];
    const ax = uv[a * 2] * res, ay = uv[a * 2 + 1] * res, bx = uv[b * 2] * res, by = uv[b * 2 + 1] * res, cx = uv[c * 2] * res, cy = uv[c * 2 + 1] * res;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(res - 1, Math.ceil(Math.max(ax, bx, cx))), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(res - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x1 < 0 || y1 < 0 || x0 > res - 1 || y0 > res - 1) continue;
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    let hit = false;
    if (d !== 0) {
      const inv = 1 / d;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w1 = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) * inv, w2 = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) * inv;
        if (w1 >= 0 && w2 >= 0 && w1 + w2 <= 1) { mark(y * res + x, isl); hit = true; }
      }
    }
    if (!hit) {                                                          // a triangle smaller than a cell still shows
      const mx = Math.floor((ax + bx + cx) / 3), my = Math.floor((ay + by + cy) / 3);
      if (mx >= 0 && my >= 0 && mx < res && my < res) mark(my * res + mx, isl);
    }
  }
  let filled = 0, shared = 0;
  for (let i = 0; i < cover.length; i++) { if (cover[i]) filled++; if (cover[i] === 2) shared++; }
  out.res = res; out.cover = cover;
  out.used = filled / (res * res);
  out.overlap = filled ? shared / filled : 0;

  // texel density: sqrt(UV area / model area) per triangle, so a bigger number means more texels per unit of model
  const dens = [];
  for (let t = 0; t < triCount; t++) {
    if (!(uvArea[t] > 0)) continue;
    const a = corner(t, 0) * 3, b = corner(t, 1) * 3, c = corner(t, 2) * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const area3 = Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    if (area3 > 0) dens.push(Math.sqrt(uvArea[t] / area3));
  }
  if (dens.length) {
    const s = Float64Array.from(dens).sort(), q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    const median = q(0.5);
    let uneven = 0;
    if (median > 0) for (const v of dens) if (v > median * 2 || v < median / 2) uneven++;
    out.density = { median, p5: q(0.05), p95: q(0.95), uneven: uneven / dens.length };
  }
  return out;
}
