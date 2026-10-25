// meshrepair.js: the arithmetic behind Repair mesh and Remove hidden faces. No three.js in here: plain typed arrays in and out,
// so it can be tested on its own (tests/meshrepair.test.mjs). app.js loads it when a tool first runs.

import { weldByDistance, flatness, DEFAULTS as CHECK } from './meshcheck.js?v=4';

const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };
const UVQ = 1e5;                                     // uv coordinates closer than 1e-5 count as the same

// Which vertices are one: those whose position (and uv, if given) fall in the same cell of size `tol`.
// ids[i] numbers the welded vertex of vertex i, in order of first appearance.
export function weldIds(position, tol, uv) {
  const n = (position.length / 3) | 0;
  const ids = new Uint32Array(n);
  if (!(tol > 0)) { for (let i = 0; i < n; i++) ids[i] = i; return { ids, count: n, rep: Uint32Array.from(ids) }; }
  const size = nextPow2(Math.max(16, n * 2)), mask = size - 1, inv = 1 / tol;
  const table = new Int32Array(size).fill(-1);
  const rep = new Uint32Array(n);                    // welded id → its first vertex
  let count = 0;
  // Counted from the lowest corner of the box: a mesh far from the origin would otherwise run past what `|0` can hold, and two
  // different cells would wrap to the same number.
  const lo3 = [Infinity, Infinity, Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = position[i * 3 + k]; if (v < lo3[k]) lo3[k] = v; }
  const cell = (i, k) => Math.round((position[i * 3 + k] - lo3[k]) * inv);
  for (let i = 0; i < n; i++) {
    const a = cell(i, 0), b = cell(i, 1), c = cell(i, 2);
    const u = uv ? Math.round(uv[i * 2] * UVQ) : 0, v = uv ? Math.round(uv[i * 2 + 1] * UVQ) : 0;
    let slot = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791) ^ Math.imul(u | 0, 668265263) ^ Math.imul(v | 0, 374761393)) & mask;
    let found = -1;
    while (table[slot] !== -1) {
      const w = table[slot], r = rep[w];
      if (cell(r, 0) === a && cell(r, 1) === b && cell(r, 2) === c && (!uv || (Math.round(uv[r * 2] * UVQ) === u && Math.round(uv[r * 2 + 1] * UVQ) === v))) { found = w; break; }
      slot = (slot + 1) & mask;
    }
    if (found < 0) { found = count++; table[slot] = found; rep[found] = i; }
    ids[i] = found;
  }
  return { ids, count, rep: rep.subarray(0, count) };
}

function bboxDiag(position) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < position.length; i += 3) {
    const x = position[i], y = position[i + 1], z = position[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return isFinite(x0) ? Math.hypot(x1 - x0, y1 - y0, z1 - z0) : 0;
}

// Turn the triangles so that neighbours agree on a direction and, where a piece is closed, so that it faces outward.
// A, B, C are the triangles' corners (welded vertex numbers); flipped ones get B and C swapped. Returns how many were turned.
function orientTriangles(W, A, B, C, keep, m, outward = true, report = null) {
  const triN = A.length;
  const e1 = new Map(), e2 = new Map();             // an edge (either direction) → its first and second triangle, +1; second -1: more than two
  const key = (u, v) => (u < v ? u * m + v : v * m + u);
  const add = (u, v, t) => { const k = key(u, v); if (!e1.has(k)) e1.set(k, t + 1); else if (!e2.has(k)) e2.set(k, t + 1); else e2.set(k, -1); };
  for (let t = 0; t < triN; t++) if (keep[t]) { add(A[t], B[t], t); add(B[t], C[t], t); add(C[t], A[t], t); }
  const seen = new Uint8Array(triN), flip = new Uint8Array(triN), stack = new Int32Array(triN);
  const dir = (t, u, v) => (A[t] === u && B[t] === v) || (B[t] === u && C[t] === v) || (C[t] === u && A[t] === v);
  const pieces = [];
  for (let s = 0; s < triN; s++) {
    if (!keep[s] || seen[s]) continue;
    let sp = 0; stack[sp++] = s; seen[s] = 1;
    const comp = []; let closed = true, nonManifold = false;
    while (sp) {
      const t = stack[--sp]; comp.push(t);
      const a = A[t], b = flip[t] ? C[t] : B[t], c = flip[t] ? B[t] : C[t];
      const e = [a, b, b, c, c, a];
      for (let k = 0; k < 3; k++) {
        const u = e[2 * k], v = e[2 * k + 1], kk = key(u, v), f = e1.get(kk), g = e2.get(kk);
        if (g === undefined || g === -1) { closed = false; if (g === -1) nonManifold = true; continue; }          // a border, or more than two triangles on the edge
        const nt = (f - 1 === t) ? g - 1 : f - 1;
        if (nt < 0 || seen[nt]) continue;
        flip[nt] = dir(nt, u, v) ? 1 : 0;                                       // it must run the other way along the shared edge
        seen[nt] = 1; stack[sp++] = nt;
      }
    }
    let k = 0; for (const t of comp) k += flip[t];
    // The faces now agree with the triangle the walk started from. When that one sat in a small patch turned the other way, the
    // walk would turn the rest of the piece to match the patch: so the side that most of the surface (by area) already had wins,
    // and only the smaller side is turned. (A closed piece is then turned outward below whichever side won here.)
    let aFlip = 0, aAll = 0;
    for (const t of comp) {
      const a = A[t], b = B[t], c = C[t];
      const ux = W[b * 3] - W[a * 3], uy = W[b * 3 + 1] - W[a * 3 + 1], uz = W[b * 3 + 2] - W[a * 3 + 2];
      const vx = W[c * 3] - W[a * 3], vy = W[c * 3 + 1] - W[a * 3 + 1], vz = W[c * 3 + 2] - W[a * 3 + 2];
      const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      aAll += ar; if (flip[t]) aFlip += ar;
    }
    if (aFlip > aAll - aFlip) { for (const t of comp) flip[t] ^= 1; k = comp.length - k; }
    const p = { comp, closed, nonManifold, split: Math.min(k, comp.length - k), vol: 0, abs: 0, depth: 0 };
    // The signed volume the piece encloses, counted from its own middle (with the faces already agreeing).
    let mx = 0, my = 0, mz = 0;
    for (const t of comp) for (const v of [A[t], B[t], C[t]]) { mx += W[v * 3]; my += W[v * 3 + 1]; mz += W[v * 3 + 2]; }
    const kk3 = 1 / (comp.length * 3); mx *= kk3; my *= kk3; mz *= kk3;
    for (const t of comp) {
      const a = A[t], b = flip[t] ? C[t] : B[t], c = flip[t] ? B[t] : C[t];
      const ax = W[a * 3] - mx, ay = W[a * 3 + 1] - my, az = W[a * 3 + 2] - mz, bx = W[b * 3] - mx, by = W[b * 3 + 1] - my, bz = W[b * 3 + 2] - mz, cx = W[c * 3] - mx, cy = W[c * 3 + 1] - my, cz = W[c * 3 + 2] - mz;
      const d = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      p.vol += d; p.abs += Math.abs(d);
    }
    pieces.push(p);
  }
  if (outward) {
    // Which side is out: a closed piece is certain; a piece with a gap or two (common in CAD meshes) is judged the same way when
    // most of its faces agree (|sum| / sum of sizes). A closed piece inside another closed piece is a cavity: its faces look in.
    nestDepths(W, A, B, C, flip, pieces);
    for (const p of pieces) {
      const sure = p.closed || Math.abs(p.vol) > 0.3 * p.abs;
      const wantOut = p.depth % 2 === 0;
      if (wantOut ? (p.vol < 0 && sure) : (p.vol > 0 && p.closed)) for (const t of p.comp) flip[t] ^= 1;
    }
  }
  if (report) for (const p of pieces) { let wrong = 0; for (const t of p.comp) wrong += flip[t]; report.push({ tris: p.comp.length, closed: p.closed, nonManifold: p.nonManifold, split: p.split, wrong, conf: p.abs > 0 ? Math.abs(p.vol) / p.abs : 0, depth: p.depth }); }
  let flipped = 0;
  for (let t = 0; t < triN; t++) if (flip[t]) { const x = B[t]; B[t] = C[t]; C[t] = x; flipped++; }
  return flipped;
}

// How many closed pieces each piece sits inside (p.depth): a ray from one of its points is counted against the other closed pieces'
// triangles, an odd number of crossings means inside. Only when there are a few pieces of a manageable size; otherwise depth stays 0.
function nestDepths(W, A, B, C, flip, pieces) {
  const closed = pieces.filter(p => p.closed);
  if (pieces.length < 2 || closed.length < 1 || pieces.length > 400) return;
  let total = 0; for (const p of closed) total += p.comp.length;
  if (total > 600000) return;
  for (const p of closed) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const t of p.comp) for (const v of [A[t], B[t], C[t]]) {
      const x = W[v * 3], y = W[v * 3 + 1], z = W[v * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    p.box = [x0, y0, z0, x1, y1, z1];
  }
  const dx = 1, dy = 0.0137, dz = 0.0071;           // a ray that is unlikely to run along an edge or a face
  for (const p of pieces) {
    const t0 = p.comp[0], v0 = A[t0];
    const px = W[v0 * 3], py = W[v0 * 3 + 1], pz = W[v0 * 3 + 2];
    for (const q of closed) {
      if (q === p) continue;
      const bx = q.box;
      if (px < bx[0] || px > bx[3] || py < bx[1] || py > bx[4] || pz < bx[2] || pz > bx[5]) continue;
      let hits = 0;
      for (const t of q.comp) {
        const a = A[t], b = B[t], c = C[t];
        const e1x = W[b * 3] - W[a * 3], e1y = W[b * 3 + 1] - W[a * 3 + 1], e1z = W[b * 3 + 2] - W[a * 3 + 2];
        const e2x = W[c * 3] - W[a * 3], e2y = W[c * 3 + 1] - W[a * 3 + 1], e2z = W[c * 3 + 2] - W[a * 3 + 2];
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-20) continue;
        const inv = 1 / det, sx = px - W[a * 3], sy = py - W[a * 3 + 1], sz = pz - W[a * 3 + 2];
        const u = inv * (sx * hx + sy * hy + sz * hz); if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = inv * (dx * qx + dy * qy + dz * qz); if (v < 0 || u + v > 1) continue;
        if (inv * (e2x * qx + e2y * qy + e2z * qz) > 1e-9) hits++;
      }
      if (hits % 2 === 1) p.depth++;
    }
  }
}

// Edges shared by three or more triangles, and pinched corners (the faces round a point make more than one fan): two solids that
// touch along an edge or at a corner, a fin standing on a surface, a wall inside a solid. Round such an edge the faces are paired as
// the solids they close: sorted by their angle round the edge, two neighbours are a pair when the wedge between them is behind both
// (inside the same solid). A face left over (a fin, an inner wall) lets go of the edge. Then every point gets one corner per fan of
// faces still joined round it: the largest fan keeps the corner, each other fan gets its own copy, moved into its own faces by four
// times the distance under which the Model inspector (meshcheck.js) counts two points as one, so the surfaces no longer meet there.
// That is about 1e-5 of the part's size (a hundredth of a millimetre on a part a metre long). Nothing else moves, no face is removed.
// mesh: { position, uv?, normal?, index } (index required). Returns the same shape plus { edges, corners } (how many edges were
// taken apart, at how many points), or null when every edge and point is already clean.
export function splitNonManifold(mesh) {
  const pos = mesh.position, idx = mesh.index, n = (pos.length / 3) | 0, T = (idx.length / 3) | 0;
  if (!T || !n) return null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1;
  const mag = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1), Math.abs(z0), Math.abs(z1));
  const eps = 4 * Math.max(diag * 2e-6, mag * 1.2e-7 * 8);         // meshcheck.js joins points closer than a quarter of this
  const w = weldByDistance(pos), m = w.count, P = new Int32Array(T * 3);
  for (let i = 0; i < T * 3; i++) P[i] = w.ids[idx[i]];
  const X = (p, k) => pos[w.rep[p] * 3 + k];                       // where welded point p is
  // a triangle the check leaves out (its corners at one point, or on one line) is left out here too
  const flatT = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const a = P[t * 3], b = P[t * 3 + 1], c = P[t * 3 + 2];
    if (a === b || b === c || a === c) { flatT[t] = 1; continue; }
    const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
    if (flatness(pos[i1] - pos[i0], pos[i1 + 1] - pos[i0 + 1], pos[i1 + 2] - pos[i0 + 2], pos[i2] - pos[i0], pos[i2 + 1] - pos[i0 + 1], pos[i2 + 2] - pos[i0 + 2]) <= CHECK.flat) flatT[t] = 1;
  }
  const flat = (t) => flatT[t] === 1;

  // the edges: first and second triangle, and every triangle of an edge that has more than two
  const key = (u, v) => (u < v ? u * m + v : v * m + u);
  const e1 = new Map(), e2 = new Map(), many = new Map();
  for (let t = 0; t < T; t++) {
    if (flat(t)) continue;
    const a = P[t * 3], b = P[t * 3 + 1], c = P[t * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = key(u, v);
      if (!e1.has(k)) e1.set(k, t);
      else if (!e2.has(k)) e2.set(k, t);
      else { let l = many.get(k); if (!l) { l = [e1.get(k), e2.get(k)]; many.set(k, l); } l.push(t); }
    }
  }
  // fans: the corners joined across the edges that stay joined (union-find over the 3T corners)
  const par = new Int32Array(T * 3); for (let i = 0; i < par.length; i++) par[i] = i;
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) par[b] = a; else par[a] = b; } };
  const cornerAt = (t, p) => (P[t * 3] === p ? t * 3 : P[t * 3 + 1] === p ? t * 3 + 1 : t * 3 + 2);
  const link = (t1, t2, u, v) => { union(cornerAt(t1, u), cornerAt(t2, u)); union(cornerAt(t1, v), cornerAt(t2, v)); };
  for (const [k, t2] of e2) { if (many.has(k)) continue; const u = Math.floor(k / m), v = k - u * m; link(e1.get(k), t2, u, v); }
  let edges = 0;
  for (const [k, list] of many) {
    edges++;
    const u = Math.floor(k / m), v = k - u * m;
    let ex = X(v, 0) - X(u, 0), ey = X(v, 1) - X(u, 1), ez = X(v, 2) - X(u, 2);
    const el = Math.hypot(ex, ey, ez); if (!(el > 0)) continue;
    ex /= el; ey /= el; ez /= el;
    // a basis across the edge: b = e × (a direction not along it), c = e × b
    let bx, by, bz;
    if (Math.abs(ex) < 0.9) { bx = 0; by = ez; bz = -ey; } else { bx = -ez; by = 0; bz = ex; }
    const bl = Math.hypot(bx, by, bz); bx /= bl; by /= bl; bz /= bl;
    const cx = ey * bz - ez * by, cy = ez * bx - ex * bz, cz = ex * by - ey * bx;
    const items = [];
    for (const t of list) {
      const o3 = P[t * 3] !== u && P[t * 3] !== v ? 0 : P[t * 3 + 1] !== u && P[t * 3 + 1] !== v ? 1 : 2, q = P[t * 3 + o3];
      let dx = X(q, 0) - X(u, 0), dy = X(q, 1) - X(u, 1), dz = X(q, 2) - X(u, 2);
      const de = dx * ex + dy * ey + dz * ez; dx -= de * ex; dy -= de * ey; dz -= de * ez;
      const th = Math.atan2(dx * cx + dy * cy + dz * cz, dx * bx + dy * by + dz * bz);
      // the face's normal from its own winding, and whether its front looks towards a larger angle round the edge
      const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
      const ux = pos[i1 * 3] - pos[i0 * 3], uy = pos[i1 * 3 + 1] - pos[i0 * 3 + 1], uz = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
      const vx = pos[i2 * 3] - pos[i0 * 3], vy = pos[i2 * 3 + 1] - pos[i0 * 3 + 1], vz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const wx = ey * dz - ez * dy, wy = ez * dx - ex * dz, wz = ex * dy - ey * dx;     // e × d: towards a larger angle
      const fw = (P[t * 3] === u && P[t * 3 + 1] === v) || (P[t * 3 + 1] === u && P[t * 3 + 2] === v) || (P[t * 3 + 2] === u && P[t * 3] === v);
      items.push({ t, th, s: nx * wx + ny * wy + nz * wz, fw, ru: find(cornerAt(t, u)), rv: find(cornerAt(t, v)) });
    }
    items.sort((a, b) => a.th - b.th);
    const paired = new Uint8Array(items.length);
    // First the faces that are already one surface round both ends (joined there through clean edges) and run opposite ways along
    // this edge: a sheet that comes round and meets itself here, or a wall that another surface touches. Pairing them keeps the
    // surface whole; pairing them across instead would join every fan at the ends into one, and nothing could be taken apart.
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length && !paired[i]; j++) {
      const a = items[i], b = items[j];
      if (paired[j] || a.fw === b.fw || a.ru !== b.ru || a.rv !== b.rv) continue;
      paired[i] = paired[j] = 1; link(a.t, b.t, u, v);
    }
    for (let i = 0; i < items.length; i++) {
      const j = (i + 1) % items.length, a = items[i], b = items[j];
      if (i === j || paired[i] || paired[j]) continue;
      if (a.s < 0 && b.s > 0) { paired[i] = paired[j] = 1; link(a.t, b.t, u, v); }   // the wedge from a to b is behind both
    }
  }
  // how many fans meet at each point, and the largest
  const root = new Int32Array(T * 3), size = new Int32Array(T * 3);
  for (let i = 0; i < T * 3; i++) { root[i] = find(i); size[root[i]]++; }
  const fans = new Int32Array(m), best = new Int32Array(m).fill(-1);
  for (let i = 0; i < T * 3; i++) {
    if (flat((i / 3) | 0)) continue;
    const p = P[i], r = root[i];
    if (r === i) fans[p]++;
    if (best[p] < 0 || size[r] > size[best[p]]) best[p] = r;
  }
  let corners = 0; for (let p = 0; p < m; p++) if (fans[p] > 1) corners++;
  if (!corners) return null;
  const moves = (i) => { const p = P[i]; return fans[p] > 1 && root[i] !== best[p] && !flat((i / 3) | 0); };
  // which way each fan that moves goes: into its own faces (towards the middles of its triangles)
  const dir = new Map();
  for (let i = 0; i < T * 3; i++) {
    if (!moves(i)) continue;
    const p = P[i], r = root[i], t = (i / 3) | 0;
    let d = dir.get(r); if (!d) { d = [0, 0, 0]; dir.set(r, d); }
    for (let k = 0; k < 3; k++) d[k] += (X(P[t * 3], k) + X(P[t * 3 + 1], k) + X(P[t * 3 + 2], k)) / 3 - X(p, k);
  }
  for (const d of dir.values()) { const L = Math.hypot(d[0], d[1], d[2]); if (L > 0) { d[0] *= eps / L; d[1] *= eps / L; d[2] *= eps / L; } }
  // a copy of the vertex for each corner of a fan that moves (one per vertex and fan, so uv seams inside the fan stay)
  const index = Uint32Array.from(idx), copies = new Map(), from = [], by = [];
  for (let i = 0; i < T * 3; i++) {
    if (!moves(i)) continue;
    const r = root[i], vtx = idx[i], kk = vtx * T * 3 + r;
    let nv = copies.get(kk);
    if (nv === undefined) { nv = n + from.length; copies.set(kk, nv); from.push(vtx); by.push(dir.get(r)); }
    index[i] = nv;
  }
  const N = n + from.length;
  const grow = (a, k) => {
    if (!a) return null;
    const out = new Float32Array(N * k); out.set(a.subarray(0, n * k));
    for (let j = 0; j < from.length; j++) for (let c = 0; c < k; c++) out[(n + j) * k + c] = a[from[j] * k + c];
    return out;
  };
  const position = grow(pos, 3);
  for (let j = 0; j < from.length; j++) for (let c = 0; c < 3; c++) position[(n + j) * 3 + c] += by[j][c];
  return { position, uv: grow(mesh.uv, 2), normal: grow(mesh.normal, 3), index, edges, corners };
}

// Repair one mesh. `src`: { position, uv?, normal?, index?, groups? } (typed arrays; groups as in three.js).
// opts: weld, degenerate (empty and doubled triangles), orient, outward (false: closed pieces keep the side they had), tol (0: a millionth of the size), maxOrient (triangles; bigger meshes skip it).
// manifold: take apart edges shared by three or more triangles and pinched corners (splitNonManifold).
// normals: true when the caller rebuilds the normals afterwards (the weld then joins corners whatever their normal); false keeps each corner's normal.
// Returns { position, uv, normal, index, groups, stats, changed }.
export function repairMesh(src, opts = {}) {
  let r = repairPass(src, opts);
  // Taking surfaces apart frees faces that could not be turned before (the direction across an edge of three or more triangles
  // cannot be told) and can leave a point that is pinched only once its neighbours are apart: a second and a third pass mend those.
  // Stops as soon as a pass takes nothing apart.
  for (let k = 0; k < 2 && opts.manifold && r.stats.splitCorners > 0; k++) {
    const r2 = repairPass({ position: r.position, uv: r.uv, normal: r.normal, index: r.index, groups: r.groups.length ? r.groups : null }, opts);
    if (!r2.changed) break;
    const a = r.stats, b = r2.stats, st = { ...b };
    for (const key of ['welded', 'degenerate', 'duplicate', 'flipped', 'splitEdges', 'splitCorners']) st[key] = (a[key] || 0) + (b[key] || 0);
    st.vertsBefore = a.vertsBefore; st.trisBefore = a.trisBefore; st.vertsRemoved = a.vertsBefore - b.vertsAfter; st.orientSkipped = a.orientSkipped || b.orientSkipped;
    r = { ...r2, stats: st, changed: true };
    if (!b.splitCorners) break;
  }
  return r;
}

function repairPass(src, opts) {
  const o = { weld: true, degenerate: true, orient: true, tol: 0, maxOrient: 2000000, normals: false, manifold: false, ...opts };
  const pos = src.position, n = (pos.length / 3) | 0;
  const idxIn = src.index || null;
  const triN = idxIn ? (idxIn.length / 3) | 0 : (n / 3) | 0;
  const diag = bboxDiag(pos);
  const tol = o.tol > 0 ? o.tol : Math.max(diag * 1e-6, 1e-12);

  // 1. weld
  const w = o.weld ? weldIds(pos, tol, src.uv || null) : weldIds(pos, 0);
  const m = w.count;
  const W = new Float32Array(m * 3), Wuv = src.uv ? new Float32Array(m * 2) : null, Wn = src.normal ? new Float32Array(m * 3) : null;
  for (let j = 0; j < m; j++) {
    const r = w.rep[j];
    W[j * 3] = pos[r * 3]; W[j * 3 + 1] = pos[r * 3 + 1]; W[j * 3 + 2] = pos[r * 3 + 2];
    if (Wuv) { Wuv[j * 2] = src.uv[r * 2]; Wuv[j * 2 + 1] = src.uv[r * 2 + 1]; }
    if (Wn) { Wn[j * 3] = src.normal[r * 3]; Wn[j * 3 + 1] = src.normal[r * 3 + 1]; Wn[j * 3 + 2] = src.normal[r * 3 + 2]; }
  }
  const A = new Int32Array(triN), B = new Int32Array(triN), C = new Int32Array(triN);
  for (let t = 0; t < triN; t++) {
    const i0 = idxIn ? idxIn[t * 3] : t * 3, i1 = idxIn ? idxIn[t * 3 + 1] : t * 3 + 1, i2 = idxIn ? idxIn[t * 3 + 2] : t * 3 + 2;
    A[t] = w.ids[i0]; B[t] = w.ids[i1]; C[t] = w.ids[i2];
  }
  // which material each triangle has
  const grp = new Int32Array(triN);
  const groups = src.groups && src.groups.length ? src.groups : null;
  if (groups) for (let g = 0; g < groups.length; g++) { const s0 = (groups[g].start / 3) | 0, s1 = Math.min(triN, s0 + ((groups[g].count / 3) | 0)); for (let t = s0; t < s1; t++) grp[t] = g; }

  const keep = new Uint8Array(triN).fill(1);
  const stats = { vertsBefore: n, trisBefore: triN, welded: n - m, degenerate: 0, duplicate: 0, flipped: 0, orientSkipped: false, splitEdges: 0, splitCorners: 0 };

  // The corners by position only. The weld above keeps corners with different uvs apart, so the output keeps its seams; for what a
  // triangle is (empty, the same as another) and which faces are neighbours that is wrong: across every seam the faces would not
  // meet, a triangle stored twice with other uvs would not be seen as doubled, and a face turned the wrong way next to a seam would
  // never be compared with its neighbour. Without uvs the two welds are the same one.
  // The weld by position is the Model inspector's own (meshcheck.js), so that what is mended here is what it counts.
  let pW = W, pA = A, pB = B, pC = C, pm = m;
  if (o.weld) {
    const wp = weldByDistance(pos); pm = wp.count; pW = new Float32Array(pm * 3);
    for (let j = 0; j < pm; j++) { const r = wp.rep[j]; pW[j * 3] = pos[r * 3]; pW[j * 3 + 1] = pos[r * 3 + 1]; pW[j * 3 + 2] = pos[r * 3 + 2]; }
    pA = new Int32Array(triN); pB = new Int32Array(triN); pC = new Int32Array(triN);
    for (let t = 0; t < triN; t++) {
      const i0 = idxIn ? idxIn[t * 3] : t * 3, i1 = idxIn ? idxIn[t * 3 + 1] : t * 3 + 1, i2 = idxIn ? idxIn[t * 3 + 2] : t * 3 + 2;
      pA[t] = wp.ids[i0]; pB[t] = wp.ids[i1]; pC[t] = wp.ids[i2];
    }
  }

  // 2. empty and doubled triangles
  if (o.degenerate) {
    const areaMin = tol * tol;
    // Doubled triangles (the same three corners in any order): an open-addressing table of triangle numbers, compared by their
    // sorted corners. A string per triangle used to cost a few hundred bytes each on a large mesh.
    const tsize = nextPow2(Math.max(16, triN * 2)), tmask = tsize - 1;
    const tri = new Int32Array(tsize).fill(-1);
    const sorted = (t) => {
      let a = pA[t], b = pB[t], c = pC[t], x;
      if (a > b) { x = a; a = b; b = x; } if (b > c) { x = b; b = c; c = x; } if (a > b) { x = a; a = b; b = x; }
      return [a, b, c];
    };
    for (let t = 0; t < triN; t++) {
      const a = pA[t], b = pB[t], c = pC[t];
      if (a === b || b === c || a === c) { keep[t] = 0; stats.degenerate++; continue; }
      const ux = pW[b * 3] - pW[a * 3], uy = pW[b * 3 + 1] - pW[a * 3 + 1], uz = pW[b * 3 + 2] - pW[a * 3 + 2];
      const vx = pW[c * 3] - pW[a * 3], vy = pW[c * 3 + 1] - pW[a * 3 + 1], vz = pW[c * 3 + 2] - pW[a * 3 + 2];
      const cl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      if (cl < areaMin || flatness(ux, uy, uz, vx, vy, vz) <= CHECK.flat) { keep[t] = 0; stats.degenerate++; continue; }   // (the check's own test for "no area")
      let lo = a, mid = b, hi = c, x;
      if (lo > mid) { x = lo; lo = mid; mid = x; } if (mid > hi) { x = mid; mid = hi; hi = x; } if (lo > mid) { x = lo; lo = mid; mid = x; }
      let slot = (Math.imul(lo, 73856093) ^ Math.imul(mid, 19349663) ^ Math.imul(hi, 83492791)) & tmask, dup = false;
      while (tri[slot] !== -1) {
        const s2 = sorted(tri[slot]);       // the corners of the triangle already in this slot
        if (s2[0] === lo && s2[1] === mid && s2[2] === hi) { dup = true; break; }
        slot = (slot + 1) & tmask;
      }
      if (dup) { keep[t] = 0; stats.duplicate++; } else tri[slot] = t;
    }
  }

  // 3. one direction for the faces: turned on the weld by position, and the turns copied onto the triangles. turned[t] says which
  // were turned (their second and third corners swapped places), so step 4 takes each corner's own vertex from the right place.
  const turned = new Uint8Array(triN);
  if (o.orient) {
    let kept = 0; for (let t = 0; t < triN; t++) kept += keep[t];
    if (kept > o.maxOrient) stats.orientSkipped = true;
    else if (pA === A) {                                            // (not welded: every vertex is its own point)
      const b0 = B.slice();
      stats.flipped = orientTriangles(W, A, B, C, keep, m, o.outward !== false);
      for (let t = 0; t < triN; t++) if (keep[t] && B[t] !== b0[t]) turned[t] = 1;
    }
    else {
      const pk = keep.slice();
      for (let t = 0; t < triN; t++) if (pA[t] === pB[t] || pB[t] === pC[t] || pA[t] === pC[t]) pk[t] = 0;   // no area by position
      const b0 = pB.slice();
      orientTriangles(pW, pA, pB, pC, pk, pm, o.outward !== false);
      let fl = 0;
      for (let t = 0; t < triN; t++) if (pk[t] && pB[t] !== b0[t]) { const x = B[t]; B[t] = C[t]; C[t] = x; turned[t] = 1; fl++; }
      stats.flipped = fl;
    }
  }

  // 4. what is left, with the vertices nobody uses any more taken out. A corner keeps its own normal: two vertices at one place
  // with different normals (a hard edge of a CAD part) are one vertex for the topology above, so faces still join across the edge,
  // but they stay two vertices in the output. (The weld used to keep the first corner's normal for all of them, which smoothed every
  // hard edge of a sound part and counted it as a repair. A mesh whose normals are rebuilt afterwards, opts.normals, is welded across them.)
  const split = !!(Wn && !o.normals);
  const NQ = 64;                                            // normals that agree to about a degree count as one
  // The original corner at place k of triangle t. On a turned triangle places 1 and 2 swapped (B and C above), and the corner must
  // swap with them: reading the old place gave a corner the vertex of its neighbour, which tore turned faces apart into empty and
  // doubled triangles on every part with normals.
  const cornerOf = (t, k) => { const kk = turned[t] && k ? 3 - k : k; return idxIn ? idxIn[t * 3 + kk] : t * 3 + kk; };
  const remap = new Int32Array(m).fill(-1);                 // welded id -> output vertex (normals not split)
  const outOf = split ? new Int32Array(n).fill(-1) : null;  // original corner -> output vertex
  const byKey = split ? new Map() : null;                   // "welded id|quantised normal" -> output vertex
  const srcOf = [];                                         // output vertex -> an original corner (for its normal)
  let used = 0, keptTris = 0;
  const outIndexOf = (t, k, j) => {
    if (!split) { if (remap[j] < 0) remap[j] = used++; return remap[j]; }
    const i = cornerOf(t, k);
    if (outOf[i] >= 0) return outOf[i];
    const key = j + '|' + Math.round(src.normal[i * 3] * NQ) + '|' + Math.round(src.normal[i * 3 + 1] * NQ) + '|' + Math.round(src.normal[i * 3 + 2] * NQ);
    let r = byKey.get(key);
    if (r === undefined) { r = used++; byKey.set(key, r); srcOf.push(i); }
    outOf[i] = r;
    return r;
  };
  const cornerOut = new Int32Array(triN * 3);
  for (let t = 0; t < triN; t++) {
    if (!keep[t]) continue;
    keptTris++;
    cornerOut[t * 3] = outIndexOf(t, 0, A[t]); cornerOut[t * 3 + 1] = outIndexOf(t, 1, B[t]); cornerOut[t * 3 + 2] = outIndexOf(t, 2, C[t]);
  }
  const position = new Float32Array(used * 3), uv = Wuv ? new Float32Array(used * 2) : null, normal = Wn ? new Float32Array(used * 3) : null;
  if (split) {
    for (let t = 0; t < triN; t++) {
      if (!keep[t]) continue;
      for (let k = 0; k < 3; k++) {
        const r = cornerOut[t * 3 + k], j = k === 0 ? A[t] : k === 1 ? B[t] : C[t], i = srcOf[r];
        position[r * 3] = W[j * 3]; position[r * 3 + 1] = W[j * 3 + 1]; position[r * 3 + 2] = W[j * 3 + 2];
        if (uv) { uv[r * 2] = Wuv[j * 2]; uv[r * 2 + 1] = Wuv[j * 2 + 1]; }
        normal[r * 3] = src.normal[i * 3]; normal[r * 3 + 1] = src.normal[i * 3 + 1]; normal[r * 3 + 2] = src.normal[i * 3 + 2];
      }
    }
  } else {
    for (let j = 0; j < m; j++) {
      const r = remap[j]; if (r < 0) continue;
      position[r * 3] = W[j * 3]; position[r * 3 + 1] = W[j * 3 + 1]; position[r * 3 + 2] = W[j * 3 + 2];
      if (uv) { uv[r * 2] = Wuv[j * 2]; uv[r * 2 + 1] = Wuv[j * 2 + 1]; }
      if (normal) { normal[r * 3] = Wn[j * 3]; normal[r * 3 + 1] = Wn[j * 3 + 1]; normal[r * 3 + 2] = Wn[j * 3 + 2]; }
    }
  }
  const index = new Uint32Array(keptTris * 3);
  const outGroups = [];
  const nGroups = groups ? groups.length : 1;
  // where each group's triangles start in the output (counted once), then one pass over the triangles
  const fill = new Int32Array(nGroups + 1);
  for (let t = 0; t < triN; t++) if (keep[t]) fill[(groups ? grp[t] : 0) + 1] += 3;
  for (let g = 0; g < nGroups; g++) fill[g + 1] += fill[g];
  const starts = fill.slice(0, nGroups);
  const at = fill.slice(0, nGroups);
  for (let t = 0; t < triN; t++) {
    if (!keep[t]) continue;
    const g = groups ? grp[t] : 0;
    let w2 = at[g];
    index[w2++] = cornerOut[t * 3]; index[w2++] = cornerOut[t * 3 + 1]; index[w2++] = cornerOut[t * 3 + 2];
    at[g] = w2;
  }
  if (groups) for (let g = 0; g < nGroups; g++) if (at[g] > starts[g]) outGroups.push({ start: starts[g], count: at[g] - starts[g], materialIndex: groups[g].materialIndex || 0 });
  // 5. edges shared by three or more triangles, and pinched corners: the surfaces that only touch there are taken apart
  let res = { position, uv, normal, index };
  if (o.manifold && keptTris) {
    const sp = splitNonManifold(res);
    if (sp) { res = sp; stats.splitEdges = sp.edges; stats.splitCorners = sp.corners; }
  }
  const usedOut = (res.position.length / 3) | 0;
  stats.vertsAfter = usedOut; stats.trisAfter = keptTris;
  stats.vertsRemoved = n - usedOut;                         // (stats.welded counts the joins the topology made; this is what left the output)
  // changed: the output is not the input. A sound part whose corners all kept their place and their normal is left as it is.
  const changed = usedOut !== n || keptTris !== triN || stats.flipped > 0 || stats.splitCorners > 0;
  return { position: res.position, uv: res.uv, normal: res.normal, index: res.index, groups: outGroups, stats, changed };
}

// Remove hidden faces: which triangles stay. `seen[t]` is 1 for a triangle that was seen from outside. A triangle that was not
// seen still stays if one of its corners is also a corner of a seen one (a face too small to land on a pixel, or the
// rim where the inside meets the outside), so the visible surface keeps no holes.
// Returns { keep: Uint8Array, kept, seenCount }.
export function keepNearSeen(position, index, seen, tol, margin = true) {
  const n = (position.length / 3) | 0;
  const triN = index ? (index.length / 3) | 0 : (n / 3) | 0;
  const w = margin ? weldIds(position, tol > 0 ? tol : Math.max(bboxDiag(position) * 1e-6, 1e-12)) : null;
  const vid = (i) => (w ? w.ids[i] : i);
  const touched = margin ? new Uint8Array(w.count) : null;
  const at = (t, k) => (index ? index[t * 3 + k] : t * 3 + k);
  let seenCount = 0;
  for (let t = 0; t < triN; t++) {
    if (!seen[t]) continue;
    seenCount++;
    if (margin) { touched[vid(at(t, 0))] = 1; touched[vid(at(t, 1))] = 1; touched[vid(at(t, 2))] = 1; }
  }
  const keep = new Uint8Array(triN);
  let kept = 0;
  for (let t = 0; t < triN; t++) {
    const k = seen[t] || (margin && (touched[vid(at(t, 0))] || touched[vid(at(t, 1))] || touched[vid(at(t, 2))]));
    if (k) { keep[t] = 1; kept++; }
  }
  return { keep, kept, seenCount };
}

// The triangles a rule list can read: a few facts about a part, kept in one place so the tests can check them.
export function parseCount(text) {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*([kKmM]?)\s*$/.exec(String(text).replace(',', '.'));
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1);
}
// "*" for any text, "?" for any one letter; the rest matches as written, ignoring case.
export function wildcardTest(pattern, text) {
  const re = new RegExp('^' + String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  return re.test(String(text));
}

// Look for faces that point the wrong way, without changing anything. `src`: { position, normal?, index? }.
// A piece is a set of triangles joined along edges. Per piece: closed or open, non-manifold (an edge shared by more than two
// triangles), `split` (faces that disagree with their neighbours' majority), `wrong` (faces Align would turn) and `conf`, how
// sure the outward test is (1: certain). Returns totals plus `bad`: whether Align or Reverse has anything to do.
export function analyseNormals(src, opts = {}) {
  const o = { weld: true, maxTris: 3000000, ...opts };
  const pos = src.position, n = (pos.length / 3) | 0, idx = src.index || null;
  const triN = idx ? (idx.length / 3) | 0 : (n / 3) | 0;
  const res = { tris: triN, pieces: 0, closed: 0, open: 0, nonManifold: 0, mixed: 0, mixedFaces: 0, insideOut: 0, insideOutFaces: 0, wrongFaces: 0, shadingFlipped: 0, skipped: false, bad: false };
  if (!triN) return res;
  if (triN > o.maxTris) { res.skipped = true; return res; }
  const tol = Math.max(bboxDiag(pos) * 1e-6, 1e-12);
  const w = weldIds(pos, o.weld ? tol : 0);
  const m = w.count, W = new Float32Array(m * 3);
  for (let j = 0; j < m; j++) { const r = w.rep[j]; W[j * 3] = pos[r * 3]; W[j * 3 + 1] = pos[r * 3 + 1]; W[j * 3 + 2] = pos[r * 3 + 2]; }
  const A = new Int32Array(triN), B = new Int32Array(triN), C = new Int32Array(triN), keep = new Uint8Array(triN).fill(1);
  const areaMin = tol * tol;
  for (let t = 0; t < triN; t++) {
    const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const a = w.ids[i0], b = w.ids[i1], c = w.ids[i2];
    A[t] = a; B[t] = b; C[t] = c;
    if (a === b || b === c || a === c) { keep[t] = 0; continue; }
    const ux = W[b * 3] - W[a * 3], uy = W[b * 3 + 1] - W[a * 3 + 1], uz = W[b * 3 + 2] - W[a * 3 + 2];
    const vx = W[c * 3] - W[a * 3], vy = W[c * 3 + 1] - W[a * 3 + 1], vz = W[c * 3 + 2] - W[a * 3 + 2];
    if (!(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) >= areaMin)) keep[t] = 0;   // empty (or NaN): no direction to judge
  }
  const report = [];
  orientTriangles(W, A, B, C, keep, m, true, report);
  for (const r of report) {
    res.pieces++;
    if (r.closed) res.closed++; else res.open++;
    if (r.nonManifold) res.nonManifold++;
    if (r.split > 0) { res.mixed++; res.mixedFaces += r.split; }
    if (r.wrong > r.tris / 2) { res.insideOut++; res.insideOutFaces += r.tris; }
    res.wrongFaces += r.wrong;
  }
  // shading: the stored normals of a face against the way its corners run
  const nr = src.normal;
  if (nr && nr.length >= n * 3) {
    for (let t = 0; t < triN; t++) {
      if (!keep[t]) continue;
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ux = pos[i1 * 3] - pos[i0 * 3], uy = pos[i1 * 3 + 1] - pos[i0 * 3 + 1], uz = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
      const vx = pos[i2 * 3] - pos[i0 * 3], vy = pos[i2 * 3 + 1] - pos[i0 * 3 + 1], vz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const d = fx * (nr[i0 * 3] + nr[i1 * 3] + nr[i2 * 3]) + fy * (nr[i0 * 3 + 1] + nr[i1 * 3 + 1] + nr[i2 * 3 + 1]) + fz * (nr[i0 * 3 + 2] + nr[i1 * 3 + 2] + nr[i2 * 3 + 2]);
      if (d < 0) res.shadingFlipped++;
    }
  }
  res.bad = res.wrongFaces > 0 || res.shadingFlipped > res.tris * 0.5;
  return res;
}
