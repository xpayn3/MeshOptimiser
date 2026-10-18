// emboss.js — lettering and logos that are their own parts.
//
// CAD text is usually an extruded solid laid over the part it marks, not cut into it: the letters sit a few tenths of a millimetre
// proud of the face, with most of their body sunk inside the part (the oil pump cap of a Scania V8: the lettering is a body of its
// own, 3 mm into the cap and 0.5 mm above it). To a mesh tool that looks at one part at a time such a body is a perfectly good
// part. This finds them by what they are: a small part that lies mostly INSIDE another, closed, part and stands out of it by no
// more than a height.
//
//   findEmbossedBodies(parts, opts)
//     parts  [{ id, positions: Float32Array (xyz, in one common space), index: Uint32Array | null }]
//     opts   { rise, sink = max(4, 5 * rise), insideShare = 0.3, maxSizeShare = 0.6, maxDiag = 0, samples = 400 }
//              rise          how far a part may stand out of its host and still count, in the units of the positions
//              sink          how deep inside the host a part may reach: lettering is a thin body sunk a few millimetres into the
//                            face, not a wheel or a shaft that happens to lie inside a housing's closed shell
//              insideShare   the share of a part's vertices that must lie inside the host
//              maxSizeShare  a part whose box diagonal is more than this share of the host's is not judged (it is not a detail)
//              maxDiag       a part whose box diagonal is more than this is not judged at all (0: no limit); it can still be a host
//              candidates    a Set of ids: only these are judged (the selection); every part can still be a host
//     →      [{ id, host, inside (share of vertices inside), proud (the furthest any vertex stands out), sunk (the deepest any vertex
//              lies inside), hidden (true: nothing stands out) }]
//
// A host is judged only when it is closed (no edge used by a single triangle, vertices welded by position): inside and outside
// cannot be told apart on an open shell. Inside is decided by casting a ray along +x and counting the host's triangles it crosses
// (odd: inside); how far a vertex stands out is its distance to the nearest point of the host's surface. Pure function, no
// dependencies: the app calls it with the parts in world space, the tests call it from Node.

export function findEmbossedBodies(parts, opts = {}) {
  const rise = +opts.rise > 0 ? +opts.rise : 0;
  const sink = +opts.sink > 0 ? +opts.sink : Math.max(4, 5 * rise);
  const insideShare = +opts.insideShare > 0 ? +opts.insideShare : 0.3;
  const maxSizeShare = +opts.maxSizeShare > 0 ? +opts.maxSizeShare : 0.6;
  const maxDiag = +opts.maxDiag > 0 ? +opts.maxDiag : 0;
  const candidates = opts.candidates instanceof Set ? opts.candidates : null;
  const samples = +opts.samples > 0 ? +opts.samples : 400;
  const items = parts.map((p) => {
    const P = p.positions, n = P.length / 3;
    let I = p.index;
    if (!I) { I = new Uint32Array(n); for (let i = 0; i < n; i++) I[i] = i; }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) { const x = P[v * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
    return { id: p.id, P, I, n, tris: I.length / 3, lo, hi, diag: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), host: undefined };
  });
  const out = [];
  for (const a of items) {
    if (!(a.n >= 3) || (maxDiag > 0 && a.diag > maxDiag) || (candidates && !candidates.has(a.id))) continue;
    let best = null;
    for (const h of items) {
      if (h === a || !(h.diag > 0) || a.diag > h.diag * maxSizeShare) continue;
      // the candidate's box must lie within the host's, allowing the rise
      let fits = true;
      for (let k = 0; k < 3 && fits; k++) if (a.lo[k] < h.lo[k] - rise || a.hi[k] > h.hi[k] + rise) fits = false;
      if (!fits) continue;
      if (h.host === undefined) h.host = prepareHost(h);
      if (!h.host) { if (opts.debug) opts.debug.push({ id: a.id, host: h.id, open: true }); continue; }   // open: cannot judge
      const r = judge(a, h.host, rise, sink, samples);
      if (opts.debug) opts.debug.push({ id: a.id, host: h.id, inside: r.inside, proud: r.proud, sunk: r.sunk });
      if (r.inside < insideShare || r.proud > rise || r.sunk > sink) continue;
      if (!best || r.inside > best.inside) best = { id: a.id, host: h.id, inside: r.inside, proud: r.proud, sunk: r.sunk, hidden: r.proud <= 0 };
    }
    if (best) out.push(best);
  }
  return out;
}

// The host's shell, ready for rays and distances. null when the shell is open.
function prepareHost(h) {
  const { P, I, n } = h;
  // welded by position (a CAD mesh repeats its vertices per face)
  const lo = h.lo, cell = Math.max(1e-12, Math.hypot(h.hi[0] - lo[0], h.hi[1] - lo[1], h.hi[2] - lo[2]) * 1e-6);
  let cap = 16; while (cap < n * 2) cap <<= 1;
  const mask = cap - 1, slots = new Int32Array(cap).fill(-1), qx = new Int32Array(n), qy = new Int32Array(n), qz = new Int32Array(n), wid = new Int32Array(n);
  let W = 0;
  for (let v = 0; v < n; v++) {
    const ix = Math.round((P[v * 3] - lo[0]) / cell), iy = Math.round((P[v * 3 + 1] - lo[1]) / cell), iz = Math.round((P[v * 3 + 2] - lo[2]) / cell);
    let s = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
    for (;;) { const w = slots[s]; if (w < 0) { slots[s] = W; qx[W] = ix; qy[W] = iy; qz[W] = iz; wid[v] = W++; break; } if (qx[w] === ix && qy[w] === iy && qz[w] === iz) { wid[v] = w; break; } s = (s + 1) & mask; }
  }
  // closed: every edge used twice
  const ec = new Map(), T = I.length / 3;
  for (let t = 0; t < T; t++) {
    const a = wid[I[t * 3]], b = wid[I[t * 3 + 1]], c = wid[I[t * 3 + 2]];
    if (a === b || b === c || a === c) continue;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) { const k = x < y ? x * W + y : y * W + x; ec.set(k, (ec.get(k) || 0) + 1); }
  }
  for (const c of ec.values()) if (c === 1) return null;
  // rays along +x: triangles by the cells of a y-z grid; distances: triangles by the cells of an x-y-z grid
  const G = 48, ly = h.lo[1], lz = h.lo[2], cy = (h.hi[1] - ly) / G || 1, cz = (h.hi[2] - lz) / G || 1;
  const yz = new Map();
  const d3 = Math.max(h.hi[0] - h.lo[0], h.hi[1] - h.lo[1], h.hi[2] - h.lo[2]) / 32 || 1;
  const xyz = new Map();
  const kx = (x) => Math.floor((x - h.lo[0]) / d3), ky = (y) => Math.floor((y - h.lo[1]) / d3), kz = (z) => Math.floor((z - h.lo[2]) / d3);
  for (let t = 0; t < T; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const y0 = Math.min(P[a + 1], P[b + 1], P[c + 1]), y1 = Math.max(P[a + 1], P[b + 1], P[c + 1]), z0 = Math.min(P[a + 2], P[b + 2], P[c + 2]), z1 = Math.max(P[a + 2], P[b + 2], P[c + 2]);
    for (let j = Math.floor((y0 - ly) / cy); j <= Math.floor((y1 - ly) / cy); j++) for (let k = Math.floor((z0 - lz) / cz); k <= Math.floor((z1 - lz) / cz); k++) { const key = j * (G + 1) + k; const l = yz.get(key); if (l) l.push(t); else yz.set(key, [t]); }
    const x0 = Math.min(P[a], P[b], P[c]), x1 = Math.max(P[a], P[b], P[c]);
    for (let i = kx(x0); i <= kx(x1); i++) for (let j = ky(y0); j <= ky(y1); j++) for (let k = kz(z0); k <= kz(z1); k++) { const key = i + ',' + j + ',' + k; const l = xyz.get(key); if (l) l.push(t); else xyz.set(key, [t]); }
  }
  return { P, I, yz, G, ly, lz, cy, cz, xyz, d3, kx, ky, kz };
}

function inside(H, x, y, z) {
  const { P, I } = H;
  const j = Math.max(0, Math.min(H.G, Math.floor((y - H.ly) / H.cy))), k = Math.max(0, Math.min(H.G, Math.floor((z - H.lz) / H.cz)));
  const l = H.yz.get(j * (H.G + 1) + k); if (!l) return false;
  let hits = 0;
  for (const t of l) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ay = P[a + 1] - y, by = P[b + 1] - y, cy = P[c + 1] - y, az = P[a + 2] - z, bz = P[b + 2] - z, cz = P[c + 2] - z;
    const d1 = ay * bz - az * by, d2 = by * cz - bz * cy, d3 = cy * az - cz * ay;
    if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (Math.abs(nx) < 1e-20) continue;
    if (P[a] - (ny * (y - P[a + 1]) + nz * (z - P[a + 2])) / nx > x) hits++;
  }
  return hits % 2 === 1;
}

// distance from a point to the nearest point of the host's surface, looking no further than `limit` (Infinity past it)
function distanceTo(H, x, y, z, limit) {
  const { P, I } = H;
  const r = Math.ceil(limit / H.d3) + 1;
  const cx = H.kx(x), cy = H.ky(y), cz = H.kz(z);
  let best = Infinity;
  for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) for (let k = cz - r; k <= cz + r; k++) {
    const l = H.xyz.get(i + ',' + j + ',' + k); if (!l) continue;
    for (const t of l) {
      const d = pointTriangle(x, y, z, P, I[t * 3] * 3, I[t * 3 + 1] * 3, I[t * 3 + 2] * 3);
      if (d < best) best = d;
    }
  }
  return best;
}

// the closest point of a triangle to a point (Ericson, Real-Time Collision Detection 5.1.5), as a distance
function pointTriangle(px, py, pz, P, a, b, c) {
  const ax = P[a], ay = P[a + 1], az = P[a + 2];
  const abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az, acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const dist = (qx, qy, qz) => Math.hypot(px - qx, py - qy, pz - qz);
  if (d1 <= 0 && d2 <= 0) return dist(ax, ay, az);
  const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return dist(P[b], P[b + 1], P[b + 2]);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return dist(ax + v * abx, ay + v * aby, az + v * abz); }
  const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return dist(P[c], P[c + 1], P[c + 2]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return dist(ax + w * acx, ay + w * acy, az + w * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return dist(P[b] + w * (P[c] - P[b]), P[b + 1] + w * (P[c + 1] - P[b + 1]), P[b + 2] + w * (P[c + 2] - P[b + 2])); }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  return dist(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}

// a candidate against a prepared host: the share of its vertices inside, how far the rest stand out, and how deep the inside ones lie
function judge(a, H, rise, sink, samples) {
  const step = Math.max(1, Math.floor(a.n / samples));
  let tested = 0, inN = 0, proud = 0, sunk = 0;
  const limit = rise > 0 ? rise * 1.001 : 1e-9, deep = sink * 1.001;
  for (let v = 0; v < a.n; v += step) {
    const x = a.P[v * 3], y = a.P[v * 3 + 1], z = a.P[v * 3 + 2];
    tested++;
    if (inside(H, x, y, z)) {
      inN++;
      const s = distanceTo(H, x, y, z, deep);                 // (Infinity past the limit: deep inside, not lettering)
      if (s > sunk) sunk = s;
      if (sunk > sink) break;
      continue;
    }
    const d = distanceTo(H, x, y, z, limit);
    if (d > proud) proud = d;
    if (proud > rise) break;                                   // (stands out too far: no need to look further)
  }
  return { inside: tested ? inN / tested : 0, proud, sunk };
}

// ── Marks cut into the part's own mesh, on any surface ───────────────────────────────────────────────────────────────────────────
//
// Raised or engraved text that is part of the mesh itself (the compressor housing of a Scania V8 turbo: "GARRETT" standing 0.5 to
// 0.8 mm out of a curved casting). The hole filler finds such marks only on a flat face, by the loop round them; on a curved face
// there is no plane to measure against, and a letter stitched into the face has no floor under it that a ray could meet. This
// finds them by shape instead: the mesh is cut into smooth patches at its sharp edges (dihedral angle over `angle`); a mark is a
// group of small patches (its top, its walls, the island of face inside an O) that borders exactly one big patch, the face it sits
// on, and stands out of that face by no more than the rise, or sinks into it by no more than the depth. How far a vertex stands
// out is measured along the face's own normal at the nearest point of the mark's rim, so the face may curve. The mark's triangles
// go and its footprint is capped flush with the face, with the face's own vertices, so there is no seam.
//
//   findSurfaceMarks(positions, index, opts)
//     positions  Float32Array xyz;  index  Uint32Array | null (a soup is indexed as it stands)
//     opts       { maxSize = 40, raisedMax = 0, maxDepth = 0, angle = 35 }
//                  maxSize    the widest a mark may be (its box's longest side), in the units of the positions
//                  raisedMax  the most a raised mark may stand out of its face; 0: raised marks are left alone
//                  maxDepth   the most an engraved mark may sink into its face; 0: engraved marks are left alone
//                  angle      the dihedral angle, in degrees, that separates two smooth patches
//     →  the shape the hole filler returns, so applyHoleFill takes it as it is:
//        { removed: Uint8Array per triangle, caps: Uint32Array, capOwner: Int32Array (a face triangle per cap), holes, flattened
//          (the raised ones), removedTris, addedTris, rimVertices: 0, floating: 0, enclosed: 0, sealed: 0,
//          skipped: { raisedTall, tooDeep, tooLarge, partOfShape, uncappable, kind }, marks: [{ raised, height, size, tris }],
//          tallest and lowestTall (the range of the raised marks left for standing above raisedMax), deepest and shallowestDeep
//          (the same for engraved) }
//
// A patch counts as a piece of a mark when its area is under maxSize² / 2 (so the limit also says what counts as a face: on a small
// cap, whose top is under that, lower it); a face must have three times the area of the mark that sits on it. A group that reaches an open edge of the mesh, borders two big patches (a chamfer between two faces, a letter over
// an edge) or has no relief at all is not a mark. Pure function, no dependencies.

export function findSurfaceMarks(positions, index, opts = {}) {
  const maxSize = +opts.maxSize > 0 ? +opts.maxSize : 40;
  const raisedMax = +opts.raisedMax > 0 ? +opts.raisedMax : 0;
  const maxDepth = +opts.maxDepth > 0 ? +opts.maxDepth : 0;
  const angle = +opts.angle > 0 ? +opts.angle : 35;
  const P = positions;
  let I = index;
  if (!I) { I = new Uint32Array(P.length / 3); for (let i = 0; i < I.length; i++) I[i] = i; }
  const T = (I.length / 3) | 0;
  const res = { removed: new Uint8Array(T), caps: new Uint32Array(0), capOwner: new Int32Array(0), holes: 0, flattened: 0, removedTris: 0, addedTris: 0,
                rimVertices: 0, floating: 0, enclosed: 0, sealed: 0, skipped: { raisedTall: 0, tooDeep: 0, tooLarge: 0, partOfShape: 0, uncappable: 0, kind: 0 }, marks: [], tallest: 0, deepest: 0, lowestTall: 0, shallowestDeep: 0 };
  if (T < 4 || (!raisedMax && !maxDepth)) return res;
  // vertices welded by position (a CAD export splits a vertex at every crease; a patch must not stop there)
  const n = (P.length / 3) | 0, wid = new Int32Array(n), wmap = new Map();
  for (let v = 0; v < n; v++) { const k = P[v * 3] + ',' + P[v * 3 + 1] + ',' + P[v * 3 + 2]; let w = wmap.get(k); if (w === undefined) { w = wmap.size; wmap.set(k, w); } wid[v] = w; }
  const W = wmap.size;
  // triangle normals, areas
  const nx = new Float32Array(T), ny = new Float32Array(T), nz = new Float32Array(T), area = new Float32Array(T);
  for (let t = 0; t < T; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const l = Math.hypot(x, y, z);
    area[t] = l / 2; if (l > 0) { x /= l; y /= l; z /= l; }
    nx[t] = x; ny[t] = y; nz[t] = z;
  }
  // the triangle across each half-edge (-1: an open edge; a third triangle on an edge is left unpaired)
  const opp = new Int32Array(T * 3).fill(-1), first = new Map();
  for (let h = 0; h < T * 3; h++) {
    const t = (h / 3) | 0, e = h - t * 3, a = wid[I[t * 3 + e]], b = wid[I[t * 3 + (e + 1) % 3]];
    if (a === b) continue;
    const k = a < b ? a * W + b : b * W + a, o = first.get(k);
    if (o === undefined) first.set(k, h); else { opp[h] = (o / 3) | 0; opp[o] = t; first.delete(k); }
  }
  // smooth patches
  const cosLim = Math.cos(angle * Math.PI / 180), patch = new Int32Array(T).fill(-1);
  let np = 0; const pArea = [];
  for (let s = 0; s < T; s++) {
    if (patch[s] >= 0 || !(area[s] > 0)) continue;
    const id = np++; patch[s] = id; let sum = 0; const stack = [s];
    while (stack.length) {
      const t = stack.pop(); sum += area[t];
      for (let e = 0; e < 3; e++) { const u = opp[t * 3 + e]; if (u < 0 || patch[u] >= 0 || nx[t] * nx[u] + ny[t] * ny[u] + nz[t] * nz[u] < cosLim) continue; patch[u] = id; stack.push(u); }
    }
    pArea.push(sum);
  }
  const pieceMax = maxSize * maxSize / 2;
  const piece = new Uint8Array(np); for (let p = 0; p < np; p++) if (pArea[p] < pieceMax) piece[p] = 1;
  // groups: pieces joined across any shared edge
  const root = new Int32Array(np); for (let p = 0; p < np; p++) root[p] = p;
  const find = (a) => { while (root[a] !== a) { root[a] = root[root[a]]; a = root[a]; } return a; };
  for (let t = 0; t < T; t++) { const p = patch[t]; if (p < 0 || !piece[p]) continue; for (let e = 0; e < 3; e++) { const u = opp[t * 3 + e]; if (u < 0) continue; const q = patch[u]; if (q < 0 || !piece[q] || q === p) continue; const a = find(p), b = find(q); if (a !== b) root[b] = a; } }
  const groups = new Map();         // root → { tris, area, bigs: Set of big patches bordered, open }
  for (let t = 0; t < T; t++) {
    const p = patch[t]; if (p < 0 || !piece[p]) continue;
    const r = find(p); let g = groups.get(r); if (!g) { g = { tris: [], area: 0, bigs: new Set(), open: false }; groups.set(r, g); }
    g.tris.push(t); g.area += area[t];
    for (let e = 0; e < 3; e++) { const u = opp[t * 3 + e]; if (u < 0) g.open = true; else if (!piece[patch[u]]) g.bigs.add(patch[u]); }
  }
  const caps = [], owners = [];
  const tol = maxSize * 1e-4 + 1e-6;
  for (const g of groups.values()) {
    if (g.open || g.bigs.size !== 1) { res.skipped.partOfShape++; continue; }
    const host = g.bigs.values().next().value;
    if (pArea[host] < g.area * 3) { res.skipped.partOfShape++; continue; }
    // the mark's box
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const t of g.tris) for (let k = 0; k < 3; k++) { const v = I[t * 3 + k] * 3; for (let d = 0; d < 3; d++) { const x = P[v + d]; if (x < lo[d]) lo[d] = x; if (x > hi[d]) hi[d] = x; } }
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    if (size > maxSize) { res.skipped.tooLarge++; continue; }
    // the rim: the host's half-edges that face the mark, with the host's normal summed at each rim vertex
    const rimN = new Map();           // welded id → [x, y, z, nx, ny, nz, the host's own index for it]
    const rimEdges = [];              // [from, to, host triangle] in welded ids, directed so the cap winds like the host
    for (const t of g.tris) for (let e = 0; e < 3; e++) {
      const u = opp[t * 3 + e]; if (u < 0 || patch[u] !== host) continue;
      const a = wid[I[t * 3 + e]], b = wid[I[t * 3 + (e + 1) % 3]];
      let ha = -1, hb = -1;           // the host's own vertices for this edge (it runs it the other way round, b→a)
      for (let f = 0; f < 3; f++) { const x = I[u * 3 + f], y = I[u * 3 + (f + 1) % 3]; if (wid[x] === b && wid[y] === a) { ha = y; hb = x; break; } }
      if (ha < 0) continue;
      // the hole the mark leaves is walked a→b, against the host's edge, so the cap winds like the host
      rimEdges.push([a, b, u]);
      for (const [w, oi] of [[a, ha], [b, hb]]) { let r = rimN.get(w); if (!r) { r = [P[oi * 3], P[oi * 3 + 1], P[oi * 3 + 2], 0, 0, 0, oi]; rimN.set(w, r); } r[3] += nx[u]; r[4] += ny[u]; r[5] += nz[u]; }
    }
    for (const r of rimN.values()) { const l = Math.hypot(r[3], r[4], r[5]) || 1; r[3] /= l; r[4] /= l; r[5] /= l; }
    const rim = [...rimN.values()];
    if (rim.length < 3) { res.skipped.uncappable++; continue; }
    // relief: every vertex of the mark against the face's normal at the nearest rim vertex
    let up = 0, down = 0; const seen = new Set();
    for (const t of g.tris) for (let k = 0; k < 3; k++) {
      const w = wid[I[t * 3 + k]]; if (seen.has(w) || rimN.has(w)) continue; seen.add(w);
      const v = I[t * 3 + k] * 3, x = P[v], y = P[v + 1], z = P[v + 2];
      let best = Infinity, br = null;
      for (const r of rim) { const dx = x - r[0], dy = y - r[1], dz = z - r[2], d = dx * dx + dy * dy + dz * dz; if (d < best) { best = d; br = r; } }
      const off = (x - br[0]) * br[3] + (y - br[1]) * br[4] + (z - br[2]) * br[5];
      if (off > up) up = off; if (off < down) down = off;
    }
    if (opts.debug) opts.debug.push({ up, down, size, tris: g.tris.length, rim: rim.length, host: pArea[host].toFixed(0) });
    if (up <= tol && -down <= tol) { res.skipped.kind++; continue; }
    // a raised mark may dip a little under the face as well (and an engraved one rise a little): on a coarsely meshed curved face
    // the normal at the rim is a few degrees off the true one, which reads as a twentieth of the mark's width at its far side
    const raised = up >= -down, slack = tol + Math.max(raised ? maxDepth : raisedMax, size * 0.05);
    if (raised) { if (!raisedMax) { res.skipped.kind++; continue; } if (up > raisedMax * (1 + 1e-6) + tol || -down > slack) { res.skipped.raisedTall++; if (up > res.tallest) res.tallest = up; if (!res.lowestTall || up < res.lowestTall) res.lowestTall = up; continue; } }
    else { if (!maxDepth) { res.skipped.kind++; continue; } if (-down > maxDepth * (1 + 1e-6) + tol || up > slack) { res.skipped.tooDeep++; if (-down > res.deepest) res.deepest = -down; if (!res.shallowestDeep || -down < res.shallowestDeep) res.shallowestDeep = -down; continue; } }
    // one closed loop round the mark, walked along the host's edges
    const next = new Map(); let pinched = false;
    for (const [a, b] of rimEdges) { if (next.has(a)) pinched = true; next.set(a, b); }
    const loop = [];
    if (!pinched && rimEdges.length >= 3) {
      const start = rimEdges[0][0]; let w = start;
      do { loop.push(w); w = next.get(w); } while (w !== undefined && w !== start && loop.length <= rimEdges.length);
      if (w !== start || loop.length !== rimEdges.length) loop.length = 0;        // more than one loop, or a broken one
    }
    if (loop.length < 3) { res.skipped.uncappable++; continue; }
    // the cap: the loop in the plane of the face's mean normal, ear-clipped
    let mx = 0, my = 0, mz = 0; for (const w of loop) { const r = rimN.get(w); mx += r[3]; my += r[4]; mz += r[5]; }
    const ml = Math.hypot(mx, my, mz) || 1; mx /= ml; my /= ml; mz /= ml;
    let ax = 1, ay = 0, az = 0; if (Math.abs(mx) > 0.9) { ax = 0; ay = 1; }
    let ux = ay * mz - az * my, uy = az * mx - ax * mz, uz = ax * my - ay * mx; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const vx = my * uz - mz * uy, vy = mz * ux - mx * uz, vz = mx * uy - my * ux;
    const pts = loop.map(w => { const r = rimN.get(w); return [r[0] * ux + r[1] * uy + r[2] * uz, r[0] * vx + r[1] * vy + r[2] * vz, r[6]]; });
    let signed = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) signed += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    if (signed < 0) pts.reverse();
    const tris = earClip2D(pts);
    if (!tris) { res.skipped.uncappable++; continue; }
    const owner = rimEdges[0][2];
    for (const t of g.tris) res.removed[t] = 1;
    for (const [a, b, c] of tris) { caps.push(pts[a][2], pts[b][2], pts[c][2]); owners.push(owner); }
    res.holes++; if (raised) res.flattened++;
    res.removedTris += g.tris.length; res.addedTris += tris.length;
    res.marks.push({ raised, height: raised ? up : -down, size, tris: g.tris.length });
  }
  res.caps = Uint32Array.from(caps); res.capOwner = Int32Array.from(owners);
  return res;
}

// Ear clipping of a simple polygon (counter-clockwise [x, y, …] points): the triangles as index triples, or null when it cannot be
// done (a self-crossing outline). Each step clips the best-shaped ear (the one with the largest smallest angle), not the first
// one found: the first-found order leaves a thin stroke full of slivers, and a sliver on a curved face takes any normal it likes
// (dark triangles and false feature edges where the letters were). A corner with no area (a point on a straight run of the
// outline) is never a triangle: it is clipped away only when no proper ear is left, which keeps the outline as it was.
function earClip2D(pts) {
  const n = pts.length; if (n < 3) return null;
  const idx = []; for (let i = 0; i < n; i++) idx.push(i);
  const out = [];
  const cross = (a, b, c) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const inside = (a, b, c, p) => {
    const x = pts[p][0], y = pts[p][1];
    const d1 = (pts[b][0] - pts[a][0]) * (y - pts[a][1]) - (pts[b][1] - pts[a][1]) * (x - pts[a][0]);
    const d2 = (pts[c][0] - pts[b][0]) * (y - pts[b][1]) - (pts[c][1] - pts[b][1]) * (x - pts[b][0]);
    const d3 = (pts[a][0] - pts[c][0]) * (y - pts[c][1]) - (pts[a][1] - pts[c][1]) * (x - pts[c][0]);
    return d1 >= 0 && d2 >= 0 && d3 >= 0;
  };
  const len = (a, b) => Math.hypot(pts[b][0] - pts[a][0], pts[b][1] - pts[a][1]);
  const smallest = (a, b, c) => {                 // the smallest angle of the triangle, in radians (0 for one with no area)
    const la = len(b, c), lb = len(a, c), lc = len(a, b);
    if (!(la > 0 && lb > 0 && lc > 0)) return 0;
    const ang = (x, y, z) => Math.acos(Math.max(-1, Math.min(1, (y * y + z * z - x * x) / (2 * y * z))));
    return Math.min(ang(la, lb, lc), ang(lb, la, lc), ang(lc, la, lb));
  };
  const area = (a, b, c) => Math.abs(cross(a, b, c)) / 2;
  let scale = 0; for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(pts[i][0]), Math.abs(pts[i][1]));
  const tiny = Math.max(1e-12, scale * scale * 1e-10);          // a triangle smaller than this has no area
  let guard = 0;
  while (idx.length > 3) {
    if (++guard > n * n + 10) return null;
    let cut = -1, best = -1;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= tiny) continue;                       // reflex, or no area
      let ear = true;
      for (const p of idx) { if (p === a || p === b || p === c) continue; if (inside(a, b, c, p)) { ear = false; break; } }
      if (!ear) continue;
      const q = smallest(a, b, c);
      if (q > best) { best = q; cut = i; }
    }
    if (cut < 0) {
      // no proper ear: a corner on a straight run (no area either way) is dropped without a triangle
      let flat = -1;
      for (let i = 0; i < idx.length && flat < 0; i++) { const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length]; if (area(a, b, c) <= tiny) flat = i; }
      if (flat < 0) return null;
      idx.splice(flat, 1); continue;
    }
    out.push([idx[(cut + idx.length - 1) % idx.length], idx[cut], idx[(cut + 1) % idx.length]]);
    idx.splice(cut, 1);
  }
  if (cross(idx[0], idx[1], idx[2]) > tiny) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

// After the marks are gone, the vertices on a cap's rim still carry the normal they had with the letter's wall (tilted between the
// face and the wall), so the face would shade with a dark ring round every cap. This gives each such vertex the area-weighted mean
// of the normals of the triangles that use it now (the face's and the cap's), shared across the vertices at the same position. The
// counterpart of the hole filler's flattenRimNormals, which turns the normal to one plane and so suits a flat face only.
//   positions, index, normals   the new mesh (Float32Array xyz, triangle index, Float32Array xyz)
//   capKey                      a Set of "x,y,z" strings (the positions of the vertices the caps use); null: every vertex
// Returns how many vertices were changed.
export function smoothRimNormals(positions, index, normals, capKey) {
  const V = (positions.length / 3) | 0, T = (index.length / 3) | 0;
  const key = (v) => positions[v * 3] + ',' + positions[v * 3 + 1] + ',' + positions[v * 3 + 2];
  const want = new Uint8Array(V); let any = 0;
  for (let v = 0; v < V; v++) if (!capKey || capKey.has(key(v))) { want[v] = 1; any++; }
  if (!any) return 0;
  const sum = new Map();                                        // position → [x, y, z], the face normals scaled by area
  const add = (v, x, y, z) => { const k = key(v); const s = sum.get(k); if (s) { s[0] += x; s[1] += y; s[2] += z; } else sum.set(k, [x, y, z]); };
  for (let t = 0; t < T; t++) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    if (!want[a] && !want[b] && !want[c]) continue;
    const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;         // (twice the area, along the normal)
    if (want[a]) add(a, x, y, z); if (want[b]) add(b, x, y, z); if (want[c]) add(c, x, y, z);
  }
  let n = 0;
  for (let v = 0; v < V; v++) {
    if (!want[v]) continue;
    const s = sum.get(key(v)); if (!s) continue;
    const l = Math.hypot(s[0], s[1], s[2]); if (!(l > 0)) continue;
    const x = s[0] / l, y = s[1] / l, z = s[2] / l;
    if (normals[v * 3] * x + normals[v * 3 + 1] * y + normals[v * 3 + 2] * z > 0.99999) continue;
    normals[v * 3] = x; normals[v * 3 + 1] = y; normals[v * 3 + 2] = z; n++;
  }
  return n;
}
