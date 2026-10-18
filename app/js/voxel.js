// voxel.js — Voxel remesh: a part rebuilt on a voxel grid as one clean, closed, even surface (Blender's Voxel remesh, ZBrush's
// DynaMesh), with an optional closing that fills gaps narrower than a width.
//
// Done on a grid (cells along the part's longest side: the detail):
//   1. The true distance. Every cell near the surface gets its distance to the nearest triangle; inside or out comes from a flood
//      of the outside in from the grid's border, and next to the surface from the way the nearest triangle faces. Bodies that
//      overlap become one; hollows shut inside the part are filled (nothing hidden is kept).
//   2. Close gaps (when a width is given): a ball of half the width is rolled over the outside and what it cannot reach into is
//      filled (a morphological closing, with an exact Euclidean distance transform one axis at a time). Grown from the cells
//      inside the part and those the surface passes through (so a wall thinner than a cell still counts), shrunk back by half the
//      width and a cell more. Inside corners round to about half the width.
//   3. The field: the larger of the true distance and the closing. Where nothing was filled the part's own surface decides.
//   4. The surface: dual contouring. One point per cell the surface crosses, where the planes of its crossings meet (the
//      original faces' own normals where the part decides), so sharp edges and corners stay sharp; the points of a fill are
//      relaxed towards their neighbours, so a filled gap is a smooth sheet.
//   5. Reduced with meshoptimizer's simplifier to within the adaptivity (in cells; 0 keeps every face of the grid), and shaded
//      smooth up to an angle.
//
// Everything is in the part's own coordinates. Nothing here touches three.js or the page.

// Exact squared Euclidean distance transform of a 1-D row (Felzenszwalb & Huttenlocher). f: input, d: output.
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (f[v[k]] === Infinity) { v[k] = q; continue; }
    let s;
    for (;;) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      if (s <= z[k] && k > 0) { k--; continue; }
      break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  if (f[v[0]] === Infinity) { for (let q = 0; q < n; q++) d[q] = Infinity; return; }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
}
// Squared distance (in cells) from every cell to the nearest cell where site[] is true.
function edt3(site, NX, NY, NZ) {
  const N = NX * NY * NZ, g = new Float32Array(N);
  for (let i = 0; i < N; i++) g[i] = site[i] ? 0 : Infinity;
  const m = Math.max(NX, NY, NZ), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  // along x
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) {
    const o = (k * NY + j) * NX;
    for (let i = 0; i < NX; i++) f[i] = g[o + i];
    edt1(f, NX, d, v, z);
    for (let i = 0; i < NX; i++) g[o + i] = d[i];
  }
  // along y
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
    const o = k * NY * NX + i;
    for (let j = 0; j < NY; j++) f[j] = g[o + j * NX];
    edt1(f, NY, d, v, z);
    for (let j = 0; j < NY; j++) g[o + j * NX] = d[j];
  }
  // along z
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const o = j * NX + i, st = NX * NY;
    for (let k = 0; k < NZ; k++) f[k] = g[o + k * st];
    edt1(f, NZ, d, v, z);
    for (let k = 0; k < NZ; k++) g[o + k * st] = d[k];
  }
  return g;
}
// Flood from the grid's border through cells where open[] is true (6 neighbours). Returns the reached cells.
function floodBorder(open, NX, NY, NZ) {
  const N = NX * NY * NZ, out = new Uint8Array(N), st = [];
  const seed = (i) => { if (open[i] && !out[i]) { out[i] = 1; st.push(i); } };
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
    if (i === 0 || j === 0 || k === 0 || i === NX - 1 || j === NY - 1 || k === NZ - 1) seed((k * NY + j) * NX + i);
  const sl = NX * NY;
  while (st.length) {
    const c = st.pop(), i = c % NX, j = ((c - i) / NX) % NY, k = (c - i - j * NX) / sl;
    if (i > 0) seed(c - 1); if (i < NX - 1) seed(c + 1);
    if (j > 0) seed(c - NX); if (j < NY - 1) seed(c + NX);
    if (k > 0) seed(c - sl); if (k < NZ - 1) seed(c + sl);
  }
  return out;
}

// Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). Returns [x, y, z].
function closestOnTri(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dt = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const d1 = dt(ab, ap), d2 = dt(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dt(ab, bp), d4 = dt(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); return [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]; }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dt(ab, cp), d6 = dt(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); return [a[0] + t * ac[0], a[1] + t * ac[1], a[2] + t * ac[2]]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [b[0] + t * (c[0] - b[0]), b[1] + t * (c[1] - b[1]), b[2] + t * (c[2] - b[2])]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

// Normals smooth up to `deg` between faces, hard beyond: corners whose faces turn more than that get vertices of their own.
export function creasedNormals(positions, index, deg = 30) {
  const nv = positions.length / 3, nt = index.length / 3, cosA = Math.cos(deg * Math.PI / 180);
  const fn = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = index[3 * t] * 3, b = index[3 * t + 1] * 3, c = index[3 * t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    fn[3 * t] = uy * wz - uz * wy; fn[3 * t + 1] = uz * wx - ux * wz; fn[3 * t + 2] = ux * wy - uy * wx;      // (area weighted)
  }
  const unit = (t) => { const l = Math.hypot(fn[3 * t], fn[3 * t + 1], fn[3 * t + 2]) || 1; return [fn[3 * t] / l, fn[3 * t + 1] / l, fn[3 * t + 2] / l]; };
  const around = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) around[index[3 * t + k]].push(t);
  const pos = [], nor = [], idx = new Uint32Array(index.length), made = new Map();
  for (let t = 0; t < nt; t++) {
    const ft = unit(t);
    for (let k = 0; k < 3; k++) {
      const v = index[3 * t + k];
      let x = 0, y = 0, z = 0;
      const group = [];
      for (const s of around[v]) { const fs = unit(s); if (fs[0] * ft[0] + fs[1] * ft[1] + fs[2] * ft[2] >= cosA) { x += fn[3 * s]; y += fn[3 * s + 1]; z += fn[3 * s + 2]; group.push(s); } }
      const l = Math.hypot(x, y, z) || 1;
      const key = v + ':' + group.sort((p, q) => p - q).join(',');
      let id = made.get(key);
      if (id === undefined) { id = pos.length / 3; made.set(key, id); pos.push(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]); nor.push(x / l, y / l, z / l); }
      idx[3 * t + k] = id;
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), index: idx };
}

// The grid, the part's true signed distance S, the closing Fc and their union G (all + inside, in the part's units).
function closingField(positions, index, opts) {
  const P = positions, I = index || Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
  const nv = P.length / 3, nt = I.length / 3;
  if (!nv || !nt) return { ok: false, why: 'the part has no surface' };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], L = Math.max(...ext);
  if (!(L > 0)) return { ok: false, why: 'the part has no size' };
  const W = opts.width > 0 ? opts.width : 0, rho = W / 2;
  const maxVoxels = opts.maxVoxels || 24e6;
  let cells = Math.round(opts.cells) || (W > 0 ? Math.max(128, Math.min(360, Math.ceil(L / (W / 8)))) : 160);
  let h, pad, NX, NY, NZ;
  for (;;) {
    h = L / cells; pad = Math.ceil(rho / h) + 3;
    NX = Math.ceil(ext[0] / h) + 2 * pad + 1; NY = Math.ceil(ext[1] / h) + 2 * pad + 1; NZ = Math.ceil(ext[2] / h) + 2 * pad + 1;
    if (NX * NY * NZ <= maxVoxels || cells <= 48) break;
    cells = Math.floor(cells * 0.85);
  }
  const N = NX * NY * NZ, sl = NX * NY;
  const gx = lo[0] - pad * h, gy = lo[1] - pad * h, gz = lo[2] - pad * h;
  const cx = (i) => gx + (i + 0.5) * h, cy = (j) => gy + (j + 0.5) * h, cz = (k) => gz + (k + 0.5) * h;
  const vtx = (v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
  // face normals (unit)
  const FN = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = vtx(I[3 * t]), b = vtx(I[3 * t + 1]), c = vtx(I[3 * t + 2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const x = uy * wz - uz * wy, y = uz * wx - ux * wz, z = ux * wy - uy * wx, l = Math.hypot(x, y, z) || 1;
    FN[3 * t] = x / l; FN[3 * t + 1] = y / l; FN[3 * t + 2] = z / l;
  }
  // 1. the true distance near the surface: every cell within two cells of a triangle gets its distance to the nearest one
  const band = 2 * h, D = new Float32Array(N).fill(Infinity), T = new Int32Array(N).fill(-1);
  for (let t = 0; t < nt; t++) {
    const a = vtx(I[3 * t]), b = vtx(I[3 * t + 1]), c = vtx(I[3 * t + 2]);
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - band - gx) / h)), i1 = Math.min(NX - 1, Math.floor((Math.max(a[0], b[0], c[0]) + band - gx) / h));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - band - gy) / h)), j1 = Math.min(NY - 1, Math.floor((Math.max(a[1], b[1], c[1]) + band - gy) / h));
    const k0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - band - gz) / h)), k1 = Math.min(NZ - 1, Math.floor((Math.max(a[2], b[2], c[2]) + band - gz) / h));
    // (a big flat triangle: only the cells near its plane)
    const n = [FN[3 * t], FN[3 * t + 1], FN[3 * t + 2]], off = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const p = [cx(i), cy(j), cz(k)];
      if (Math.abs(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - off) > band) continue;
      const q = closestOnTri(p, a, b, c), d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      const id = (k * NY + j) * NX + i;
      if (d < D[id]) { D[id] = d; T[id] = t; }
    }
  }
  // inside or out: flood the outside from the border through every cell the surface does not pass through (closer than
  // half a diagonal); a cell next to it is outside when the nearest triangle faces it, unless it is shut in (overlapping bodies)
  const nearS = new Uint8Array(N); for (let i = 0; i < N; i++) nearS[i] = D[i] < h * 0.87 ? 1 : 0;
  const open0 = new Uint8Array(N); for (let i = 0; i < N; i++) open0[i] = nearS[i] ? 0 : 1;
  const out0 = floodBorder(open0, NX, NY, NZ);
  const S = new Float32Array(N);                                  // signed distance to the part, + inside (big away from it)
  const nbOut = (id) => { const i = id % NX, j = ((id - i) / NX) % NY, k = (id - i - j * NX) / sl; return (i > 0 && out0[id - 1]) || (i < NX - 1 && out0[id + 1]) || (j > 0 && out0[id - NX]) || (j < NY - 1 && out0[id + NX]) || (k > 0 && out0[id - sl]) || (k < NZ - 1 && out0[id + sl]); };
  for (let id = 0; id < N; id++) {
    const far = D[id] === Infinity ? 4 * h + rho : D[id];
    if (out0[id]) { S[id] = -far; continue; }
    if (!nearS[id]) { S[id] = far; continue; }
    if (!nbOut(id)) { S[id] = far; continue; }
    const t = T[id], i = id % NX, j = ((id - i) / NX) % NY, k = (id - i - j * NX) / sl;
    const a = vtx(I[3 * t]), q = closestOnTri([cx(i), cy(j), cz(k)], a, vtx(I[3 * t + 1]), vtx(I[3 * t + 2]));
    const side = (cx(i) - q[0]) * FN[3 * t] + (cy(j) - q[1]) * FN[3 * t + 1] + (cz(k) - q[2]) * FN[3 * t + 2];
    S[id] = side > 0 ? -D[id] : D[id];
  }
  // 2. the closing, grown from the cells inside the part and the cells the surface passes through (so a wall thinner than a cell
  //    still counts); that makes it about a cell too fat, which the shrink below takes back
  const site = new Uint8Array(N); let solidN = 0;
  for (let i = 0; i < N; i++) if (S[i] >= 0 || nearS[i]) { site[i] = 1; solidN++; }
  const r2 = (rho / h) ** 2;
  const dIn = edt3(site, NX, NY, NZ);
  const open1 = new Uint8Array(N); for (let i = 0; i < N; i++) open1[i] = dIn[i] > r2 ? 1 : 0;
  const out1 = floodBorder(open1, NX, NY, NZ);                   // (a cavity shut in by the growing is filled: not reached)
  const dOut = edt3(out1, NX, NY, NZ);
  // 3. the field: the part where it was not filled, the fill where it was (the larger of the two, + inside)
  const G = new Float32Array(N), Fc = new Float32Array(N); let added = 0;
  const shrink = opts.shrinkCells ?? (W > 0 ? 1.0 : 2.0);       // (no gaps to close: the closing only fills hollows shut inside, the surface is the part's own)
  for (let i = 0; i < N; i++) {
    const fc = (Math.sqrt(dOut[i]) - rho / h - shrink) * h;
    Fc[i] = fc; G[i] = Math.max(S[i], fc);
    if (G[i] > 0 && S[i] <= 0) added++;
  }
  return { ok: true, P, I, nv, nt, L, W, rho, h, NX, NY, NZ, N, sl, gx, gy, gz, cx, cy, cz, vtx, FN, T, S, Fc, G, added };
}

// The remesh. opts: cells (the detail: grid cells along the longest side; default 160, or with a width enough for a cell of an
// eighth of it; never over maxVoxels in all), width (close gaps narrower than this; default 0: none), adaptivity (how far the
// simplifier may move the surface, in cells; default 0.25, 0 = keep every face), simplifier (meshoptimizer's MeshoptSimplifier),
// smoothDeg (default 30), dryRun.
export function voxelRemesh(positions, index, opts = {}) {
  const F = closingField(positions, index, opts);
  if (!F.ok) return F;
  const { P, I, nt, W, h, NX, NY, NZ, N, gx, gy, gz, cx, cy, cz, vtx, FN, T, S, G, added } = F;
  const result = { ok: true, width: W, cell: h, grid: [NX, NY, NZ], filledVolume: added * h * h * h, before: { triangles: nt } };
  if (opts.dryRun) return result;
  // 4. dual contouring: one point per cell the surface crosses, where the planes of its crossings meet (sharp edges stay sharp)
  const Gat = (i, j, k) => G[(k * NY + j) * NX + i];
  const grad = (x, y, z) => {                                    // the field's gradient at a point (from the cells round it)
    const fi = Math.min(NX - 2, Math.max(1, Math.round((x - gx) / h - 0.5))), fj = Math.min(NY - 2, Math.max(1, Math.round((y - gy) / h - 0.5))), fk = Math.min(NZ - 2, Math.max(1, Math.round((z - gz) / h - 0.5)));
    const g = [Gat(fi + 1, fj, fk) - Gat(fi - 1, fj, fk), Gat(fi, fj + 1, fk) - Gat(fi, fj - 1, fk), Gat(fi, fj, fk + 1) - Gat(fi, fj, fk - 1)], l = Math.hypot(...g) || 1;
    return [-g[0] / l, -g[1] / l, -g[2] / l];                    // (outward: the field falls going out)
  };
  const vid = new Int32Array(N).fill(-1), vp = [], fixedV = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float64Array(8), ids = new Int32Array(8);
  for (let k = 0; k < NZ - 1; k++) for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    let inside = 0;
    for (let c = 0; c < 8; c++) { ids[c] = ((k + corner[c][2]) * NY + j + corner[c][1]) * NX + i + corner[c][0]; val[c] = G[ids[c]]; if (val[c] > 0) inside++; }
    if (inside === 0 || inside === 8) continue;
    // the crossings and their normals
    const A = [0, 0, 0, 0, 0, 0], bq = [0, 0, 0]; let mx = 0, my = 0, mz = 0, n = 0, fromFill = 0;
    for (const [a, b] of edges) {
      if ((val[a] > 0) === (val[b] > 0)) continue;
      const t = val[a] / (val[a] - val[b]);
      const p = [cx(i + corner[a][0]) + t * (corner[b][0] - corner[a][0]) * h, cy(j + corner[a][1]) + t * (corner[b][1] - corner[a][1]) * h, cz(k + corner[a][2]) + t * (corner[b][2] - corner[a][2]) * h];
      // the normal: the original face's when the part decides here (no fill at either end), else the field's
      let nn = null;
      const ia = ids[a], ib = ids[b];
      if (G[ia] === S[ia] && G[ib] === S[ib]) {
        let bt = -1, bd = Infinity;
        for (const tt of [T[ia], T[ib]]) { if (tt < 0) continue; const q = closestOnTri(p, vtx(I[3 * tt]), vtx(I[3 * tt + 1]), vtx(I[3 * tt + 2])), d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2; if (d < bd) { bd = d; bt = tt; } }
        if (bt >= 0) { nn = [FN[3 * bt], FN[3 * bt + 1], FN[3 * bt + 2]]; const og = grad(p[0], p[1], p[2]); if (nn[0] * og[0] + nn[1] * og[1] + nn[2] * og[2] < 0) nn = [-nn[0], -nn[1], -nn[2]]; }
      }
      if (!nn) { nn = grad(p[0], p[1], p[2]); fromFill++; }
      const d = nn[0] * p[0] + nn[1] * p[1] + nn[2] * p[2];
      A[0] += nn[0] * nn[0]; A[1] += nn[0] * nn[1]; A[2] += nn[0] * nn[2]; A[3] += nn[1] * nn[1]; A[4] += nn[1] * nn[2]; A[5] += nn[2] * nn[2];
      bq[0] += nn[0] * d; bq[1] += nn[1] * d; bq[2] += nn[2] * d;
      mx += p[0]; my += p[1]; mz += p[2]; n++;
    }
    mx /= n; my /= n; mz /= n;
    // minimise the distance to the crossing planes, pulled a little towards the middle of the crossings (where they say nothing)
    const lam = 0.05 * n;
    const a00 = A[0] + lam, a01 = A[1], a02 = A[2], a11 = A[3] + lam, a12 = A[4], a22 = A[5] + lam;
    const r0 = bq[0] + lam * mx, r1 = bq[1] + lam * my, r2_ = bq[2] + lam * mz;
    const det = a00 * (a11 * a22 - a12 * a12) - a01 * (a01 * a22 - a12 * a02) + a02 * (a01 * a12 - a11 * a02);
    let x = mx, y = my, z = mz;
    if (Math.abs(det) > 1e-12) {
      x = (r0 * (a11 * a22 - a12 * a12) - a01 * (r1 * a22 - a12 * r2_) + a02 * (r1 * a12 - a11 * r2_)) / det;
      y = (a00 * (r1 * a22 - a12 * r2_) - r0 * (a01 * a22 - a12 * a02) + a02 * (a01 * r2_ - r1 * a02)) / det;
      z = (a00 * (a11 * r2_ - r1 * a12) - a01 * (a01 * r2_ - r1 * a02) + r0 * (a01 * a12 - a11 * a02)) / det;
    }
    // it stays within the cell (a little beyond), or falls back to the middle of the crossings
    const x0 = cx(i) - 0.25 * h, x1 = cx(i + 1) + 0.25 * h, y0 = cy(j) - 0.25 * h, y1 = cy(j + 1) + 0.25 * h, z0 = cz(k) - 0.25 * h, z1 = cz(k + 1) + 0.25 * h;
    if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1)) { x = mx; y = my; z = mz; }
    vid[(k * NY + j) * NX + i] = vp.length / 3;
    vp.push(x, y, z); fixedV.push(fromFill ? 0 : 1);         // (a point of the original surface stays where it is)
  }
  const ix = [];
  const cellId = (i, j, k) => vid[(k * NY + j) * NX + i];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) ix.push(a, c, b, a, d, c); else ix.push(a, b, c, a, c, d); };
  for (let k = 1; k < NZ - 1; k++) for (let j = 1; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {        // x edges
    const a = Gat(i, j, k) > 0, b = Gat(i + 1, j, k) > 0; if (a === b) continue;
    quad(cellId(i, j - 1, k - 1), cellId(i, j, k - 1), cellId(i, j, k), cellId(i, j - 1, k), !a);
  }
  for (let k = 1; k < NZ - 1; k++) for (let j = 0; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {        // y edges
    const a = Gat(i, j, k) > 0, b = Gat(i, j + 1, k) > 0; if (a === b) continue;
    quad(cellId(i - 1, j, k - 1), cellId(i - 1, j, k), cellId(i, j, k), cellId(i, j, k - 1), !a);
  }
  for (let k = 0; k < NZ - 1; k++) for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {        // z edges
    const a = Gat(i, j, k) > 0, b = Gat(i, j, k + 1) > 0; if (a === b) continue;
    quad(cellId(i - 1, j - 1, k), cellId(i, j - 1, k), cellId(i, j, k), cellId(i - 1, j, k), !a);
  }
  let pos = new Float32Array(vp), idx = new Uint32Array(ix);
  // the fill is relaxed: each of its points moves towards the middle of its neighbours a few times (the points of the original
  // surface do not move), so a filled slot is a smooth sheet that meets the surface round it, not shards
  {
    const nV = pos.length / 3, nb = Array.from({ length: nV }, () => new Set());
    for (let t = 0; t < idx.length; t += 3) for (let q = 0; q < 3; q++) { const a = idx[t + q], b = idx[t + (q + 1) % 3]; nb[a].add(b); nb[b].add(a); }
    // (and the ring of surface points next to a fill: the seam where the two meet settles too)
    const free = new Uint8Array(nV); for (let v = 0; v < nV; v++) if (!fixedV[v]) { free[v] = 1; for (const u of nb[v]) free[u] = 1; }
    const tmp = new Float32Array(pos.length);
    for (let it = 0; it < (opts.relax ?? 15); it++) {
      tmp.set(pos);
      for (let v = 0; v < nV; v++) {
        if (!free[v] || !nb[v].size) continue;
        let x = 0, y = 0, z = 0; for (const u of nb[v]) { x += pos[3 * u]; y += pos[3 * u + 1]; z += pos[3 * u + 2]; }
        const m = nb[v].size;
        tmp[3 * v] = 0.5 * pos[3 * v] + 0.5 * x / m; tmp[3 * v + 1] = 0.5 * pos[3 * v + 1] + 0.5 * y / m; tmp[3 * v + 2] = 0.5 * pos[3 * v + 2] + 0.5 * z / m;
      }
      pos.set(tmp);
    }
  }
  const raw = idx.length / 3;
  // 5. reduce, and shade
  const adapt = opts.adaptivity ?? 0.25;
  if (opts.simplifier && adapt > 0) {
    try {
      const Sm = opts.simplifier, scale = Sm.getScale(pos, 3) || 1;
      const [ri] = Sm.simplify(idx, pos, 3, 3, (h * adapt) / scale);
      if (ri && ri.length >= 12) idx = new Uint32Array(ri);
    } catch (_) { /* keep it as it is */ }
    const used = new Int32Array(pos.length / 3).fill(-1), np = [];
    for (let i = 0; i < idx.length; i++) { const v = idx[i]; if (used[v] < 0) { used[v] = np.length / 3; np.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); } idx[i] = used[v]; }
    pos = new Float32Array(np);
  }
  const g = creasedNormals(pos, idx, opts.smoothDeg ?? 30);
  let vol = 0;
  for (let t = 0; t < g.index.length; t += 3) {
    const a = g.index[t] * 3, b = g.index[t + 1] * 3, c = g.index[t + 2] * 3, Q = g.positions;
    vol += Q[a] * (Q[b + 1] * Q[c + 2] - Q[b + 2] * Q[c + 1]) - Q[a + 1] * (Q[b] * Q[c + 2] - Q[b + 2] * Q[c]) + Q[a + 2] * (Q[b] * Q[c + 1] - Q[b + 1] * Q[c]);
  }
  if (vol < 0) { for (let t = 0; t < g.index.length; t += 3) { const x = g.index[t + 1]; g.index[t + 1] = g.index[t + 2]; g.index[t + 2] = x; } for (let i = 0; i < g.normals.length; i++) g.normals[i] = -g.normals[i]; }
  return { ...result, rawTriangles: raw, after: { triangles: g.index.length / 3 }, positions: g.positions, normals: g.normals, index: g.index };
}

// The part as solid cells (for Convex pieces): the same grid and inside-or-out as the remesh, hollows shut inside filled.
// Returns { ok, NX, NY, NZ, h, gx, gy, gz, inside (Uint8Array, 1 = solid) }.
export function voxelSolid(positions, index, opts = {}) {
  const F = closingField(positions, index, { cells: opts.cells || 96, width: 0, maxVoxels: opts.maxVoxels });
  if (!F.ok) return F;
  const inside = new Uint8Array(F.N); for (let i = 0; i < F.N; i++) inside[i] = F.G[i] > 0 ? 1 : 0;
  return { ok: true, NX: F.NX, NY: F.NY, NZ: F.NZ, h: F.h, gx: F.gx, gy: F.gy, gz: F.gz, inside };
}
