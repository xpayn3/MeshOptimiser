// Texture coordinates carried from a part as it was to the same part after a tool has rebuilt its mesh (Close cracks, Remesh evenly,
// Smooth surface, a boolean, Voxel remesh, ...). The tools themselves work on positions and triangles only; this puts the UVs back.
//
// When the tool kept the vertices and the triangles as they were (it only moved points: smoothing), the UVs are copied as they are.
// Otherwise each corner of each new triangle takes the UV of the closest point on the old surface, read from the old triangle there by its
// barycentric weights. Two things keep that right at a UV seam (where the old mesh has the same point twice, with two UVs):
//   - a UV island is the set of old triangles joined through corners that share both position and UV; each new triangle picks one island
//     (the one under its middle, among old triangles that face the same way) and all three of its corners read from that island only, so a
//     new triangle never takes one corner from each side of a seam;
//   - a new vertex that ends up with two UVs (its triangles read from two islands) is split in two, as the old mesh was at its seams.
// Every UV set the old part had (uv, uv1, uv2, ...) is carried, read at the same point.
//
// carryUvs({ srcP, srcI, sets: { uv: Float32Array, ... }, outP, outN, outI }) -> { positions, normals, index, sets } or null (no UVs)

export function carryUvs({ srcP, srcI, sets, outP, outN, outI }) {
  const nS = srcP.length / 3;
  const names = Object.keys(sets || {}).filter((k) => sets[k] && sets[k].length === nS * 2);
  if (!names.length || !srcI || !srcI.length || !outI || !outI.length) return null;
  const nO = outP.length / 3;

  // The tool only moved points: same vertices, same triangles. The UVs stay with their vertices.
  if (nO === nS && outI.length === srcI.length) {
    let same = true;
    for (let i = 0; i < outI.length; i++) if (outI[i] !== srcI[i]) { same = false; break; }
    if (same) {
      const out = {};
      for (const k of names) out[k] = Float32Array.from(sets[k]);
      return { positions: outP, normals: outN, index: outI, sets: out };
    }
  }

  const tS = srcI.length / 3, U0 = sets[names[0]];
  // UVs that are all the same (a CAD part's, often: the converter writes 0, 0) carry nothing: the result is left without, which is what it
  // had in effect (and a part drawn with a normal map then gets plain ones from the app's guard). Skipping saves the whole search.
  {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < U0.length; i += 2) { const u = U0[i], v = U0[i + 1]; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    if (!(Math.max(u1 - u0, v1 - v0) > 1e-9)) return null;
  }

  // UV islands of the old mesh: corners that share position and UV are one corner (union of their triangles).
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < srcP.length; i += 3) for (let k = 0; k < 3; k++) { const v = srcP[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1, q = 1e-6 * diag;
  const parent = new Int32Array(tS); for (let t = 0; t < tS; t++) parent[t] = t;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  // (joined through edges, not single corners: two faces of a box can meet at a corner with the same UV there and still be two islands)
  const cornerId = new Map(), cid = new Int32Array(tS * 3);
  for (let t = 0; t < tS; t++) for (let c = 0; c < 3; c++) {
    const v = srcI[t * 3 + c];
    const key = Math.round(srcP[v * 3] / q) + ',' + Math.round(srcP[v * 3 + 1] / q) + ',' + Math.round(srcP[v * 3 + 2] / q) + ',' + U0[v * 2] + ',' + U0[v * 2 + 1];
    let id = cornerId.get(key); if (id === undefined) { id = cornerId.size; cornerId.set(key, id); }
    cid[t * 3 + c] = id;
  }
  const edgeTri = new Map(), nC = cornerId.size;
  for (let t = 0; t < tS; t++) for (let c = 0; c < 3; c++) {
    const x = cid[t * 3 + c], y = cid[t * 3 + (c + 1) % 3]; if (x === y) continue;
    const k = x < y ? x * nC + y : y * nC + x;
    const f = edgeTri.get(k);
    if (f === undefined) edgeTri.set(k, t);
    else { const p = find(f), r = find(t); if (p !== r) parent[p] = r; }
  }
  const island = new Int32Array(tS); for (let t = 0; t < tS; t++) island[t] = find(t);

  // old triangles' normals (unit, or zero for a degenerate one)
  const fN = new Float64Array(tS * 3);
  for (let t = 0; t < tS; t++) {
    const a = srcI[t * 3] * 3, b = srcI[t * 3 + 1] * 3, c = srcI[t * 3 + 2] * 3;
    const ux = srcP[b] - srcP[a], uy = srcP[b + 1] - srcP[a + 1], uz = srcP[b + 2] - srcP[a + 2];
    const vx = srcP[c] - srcP[a], vy = srcP[c + 1] - srcP[a + 1], vz = srcP[c + 2] - srcP[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
    if (l > 0) { fN[t * 3] = nx / l; fN[t * 3 + 1] = ny / l; fN[t * 3 + 2] = nz / l; }
  }

  const bvh = buildBvh(srcP, srcI);
  const hit = { t: -1, d2: Infinity, u: 0, v: 0, w: 0 };
  const near = (x, y, z, ok) => closest(bvh, srcP, srcI, x, y, z, ok, hit);

  const tO = outI.length / 3, cornerUv = names.map(() => new Float32Array(tO * 6));
  for (let t = 0; t < tO; t++) {
    const a = outI[t * 3] * 3, b = outI[t * 3 + 1] * 3, c = outI[t * 3 + 2] * 3;
    const cx = (outP[a] + outP[b] + outP[c]) / 3, cy = (outP[a + 1] + outP[b + 1] + outP[c + 1]) / 3, cz = (outP[a + 2] + outP[b + 2] + outP[c + 2]) / 3;
    const ux = outP[b] - outP[a], uy = outP[b + 1] - outP[a + 1], uz = outP[b + 2] - outP[a + 2];
    const vx = outP[c] - outP[a], vy = outP[c + 1] - outP[a + 1], vz = outP[c + 2] - outP[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // the island under the triangle's middle, among old triangles that face its way (a thin plate's two sides are two islands)
    near(cx, cy, cz, (s) => fN[s * 3] * nx + fN[s * 3 + 1] * ny + fN[s * 3 + 2] * nz > 0.2);
    if (hit.t < 0) near(cx, cy, cz, null);
    if (hit.t < 0) continue;
    const isl = island[hit.t];
    for (let k = 0; k < 3; k++) {
      const o = outI[t * 3 + k] * 3;
      near(outP[o], outP[o + 1], outP[o + 2], (s) => island[s] === isl);
      if (hit.t < 0) continue;
      const i0 = srcI[hit.t * 3], i1 = srcI[hit.t * 3 + 1], i2 = srcI[hit.t * 3 + 2];
      for (let n = 0; n < names.length; n++) {
        const S = sets[names[n]], D = cornerUv[n];
        D[t * 6 + k * 2] = hit.u * S[i0 * 2] + hit.v * S[i1 * 2] + hit.w * S[i2 * 2];
        D[t * 6 + k * 2 + 1] = hit.u * S[i0 * 2 + 1] + hit.v * S[i1 * 2 + 1] + hit.w * S[i2 * 2 + 1];
      }
    }
  }

  // one vertex per (old vertex, UV): a vertex whose triangles read two different UVs is split in two
  const map = new Map(), remap = [], index = new Uint32Array(outI.length), f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const bits = (x) => { f32[0] = x; return u32[0]; };
  for (let t = 0; t < tO; t++) for (let k = 0; k < 3; k++) {
    const o = outI[t * 3 + k];
    let key = String(o);
    for (let n = 0; n < names.length; n++) key += ':' + bits(cornerUv[n][t * 6 + k * 2]) + ':' + bits(cornerUv[n][t * 6 + k * 2 + 1]);
    let id = map.get(key);
    if (id === undefined) { id = remap.length; map.set(key, id); remap.push(t * 3 + k); }
    index[t * 3 + k] = id;
  }
  const nV = remap.length, positions = new Float32Array(nV * 3), normals = outN ? new Float32Array(nV * 3) : null, out = {};
  for (const k of names) out[k] = new Float32Array(nV * 2);
  for (let i = 0; i < nV; i++) {
    const corner = remap[i], o = outI[corner];
    positions[i * 3] = outP[o * 3]; positions[i * 3 + 1] = outP[o * 3 + 1]; positions[i * 3 + 2] = outP[o * 3 + 2];
    if (normals) { normals[i * 3] = outN[o * 3]; normals[i * 3 + 1] = outN[o * 3 + 1]; normals[i * 3 + 2] = outN[o * 3 + 2]; }
    const t = (corner / 3) | 0, k = corner % 3;
    names.forEach((nm, n) => { out[nm][i * 2] = cornerUv[n][t * 6 + k * 2]; out[nm][i * 2 + 1] = cornerUv[n][t * 6 + k * 2 + 1]; });
  }
  return { positions, normals, index, sets: out };
}

// A bounding volume tree over the old triangles (median split, eight triangles to a leaf).
function buildBvh(P, I) {
  const n = I.length / 3, tris = new Int32Array(n), cen = new Float64Array(n * 3), box = new Float64Array(n * 6);
  for (let t = 0; t < n; t++) {
    tris[t] = t;
    let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
    for (let c = 0; c < 3; c++) { const v = I[t * 3 + c] * 3, x = P[v], y = P[v + 1], z = P[v + 2]; if (x < lx) lx = x; if (x > hx) hx = x; if (y < ly) ly = y; if (y > hy) hy = y; if (z < lz) lz = z; if (z > hz) hz = z; }
    box.set([lx, ly, lz, hx, hy, hz], t * 6);
    cen[t * 3] = (lx + hx) / 2; cen[t * 3 + 1] = (ly + hy) / 2; cen[t * 3 + 2] = (lz + hz) / 2;
  }
  const nodes = [];      // { b: [6], l, r } or { b, s, e } (a range of tris)
  const make = (s, e) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) { const o = tris[i] * 6; for (let k = 0; k < 3; k++) { if (box[o + k] < b[k]) b[k] = box[o + k]; if (box[o + 3 + k] > b[3 + k]) b[3 + k] = box[o + 3 + k]; } }
    const id = nodes.length; nodes.push({ b, s, e, l: -1, r: -1 });
    if (e - s <= 8) return id;
    const ax = (b[3] - b[0] >= b[4] - b[1] && b[3] - b[0] >= b[5] - b[2]) ? 0 : (b[4] - b[1] >= b[5] - b[2] ? 1 : 2);
    const sub = Array.from(tris.subarray(s, e)).sort((x, y) => cen[x * 3 + ax] - cen[y * 3 + ax]);
    tris.set(sub, s);
    const m = (s + e) >> 1;
    const l = make(s, m), r = make(m, e);
    nodes[id].l = l; nodes[id].r = r;
    return id;
  };
  make(0, n);
  return { nodes, tris };
}

const boxD2 = (b, x, y, z) => {
  const dx = x < b[0] ? b[0] - x : x > b[3] ? x - b[3] : 0, dy = y < b[1] ? b[1] - y : y > b[4] ? y - b[4] : 0, dz = z < b[2] ? b[2] - z : z > b[5] ? z - b[5] : 0;
  return dx * dx + dy * dy + dz * dz;
};

// the closest point on an old triangle that passes `ok` (any when ok is null): its triangle, squared distance and barycentric weights
function closest(bvh, P, I, x, y, z, ok, hit) {
  hit.t = -1; hit.d2 = Infinity;
  const { nodes, tris } = bvh, stack = [0];
  while (stack.length) {
    const nd = nodes[stack.pop()];
    if (boxD2(nd.b, x, y, z) >= hit.d2) continue;
    if (nd.l < 0) {
      for (let i = nd.s; i < nd.e; i++) {
        const t = tris[i];
        if (ok && !ok(t)) continue;
        triPoint(P, I, t, x, y, z, hit);
      }
      continue;
    }
    const L = nodes[nd.l], R = nodes[nd.r], dl = boxD2(L.b, x, y, z), dr = boxD2(R.b, x, y, z);
    if (dl < dr) { stack.push(nd.r, nd.l); } else { stack.push(nd.l, nd.r); }
  }
}

// closest point on triangle t to (x, y, z) (Ericson, Real-Time Collision Detection 5.1.5); keeps it in `hit` when nearer
function triPoint(P, I, t, px, py, pz, hit) {
  const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
  const ax = P[a], ay = P[a + 1], az = P[a + 2];
  const abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az, acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u, v, w;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
  else {
    const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const s = d1 / (d1 - d3); u = 1 - s; v = s; w = 0; }
      else {
        const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2];
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const s = d2 / (d2 - d6); u = 1 - s; v = 0; w = s; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const s = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - s; w = s; }
            else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; }
          }
        }
      }
    }
  }
  if (!Number.isFinite(u + v + w)) { u = 1; v = 0; w = 0; }       // (a degenerate triangle: its first corner)
  const qx = u * ax + v * P[b] + w * P[c], qy = u * ay + v * P[b + 1] + w * P[c + 1], qz = u * az + v * P[b + 2] + w * P[c + 2];
  const d = (qx - px) * (qx - px) + (qy - py) * (qy - py) + (qz - pz) * (qz - pz);
  if (d < hit.d2) { hit.d2 = d; hit.t = t; hit.u = u; hit.v = v; hit.w = w; }
}
