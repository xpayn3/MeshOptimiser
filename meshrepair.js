// meshrepair.js: the arithmetic behind Repair mesh and Remove hidden faces. No three.js in here: plain typed arrays in and out,
// so it can be tested on its own (tests/meshrepair.test.mjs). app-v2.js loads it when a tool first runs.

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

// Repair one mesh. `src`: { position, uv?, normal?, index?, groups? } (typed arrays; groups as in three.js).
// opts: weld, degenerate (empty and doubled triangles), orient, outward (false: closed pieces keep the side they had), tol (0: a millionth of the size), maxOrient (triangles; bigger meshes skip it).
// Returns { position, uv, normal, index, groups, stats, changed }.
export function repairMesh(src, opts = {}) {
  const o = { weld: true, degenerate: true, orient: true, tol: 0, maxOrient: 2000000, ...opts };
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
  const stats = { vertsBefore: n, trisBefore: triN, welded: n - m, degenerate: 0, duplicate: 0, flipped: 0, orientSkipped: false };

  // 2. empty and doubled triangles
  if (o.degenerate) {
    const areaMin = tol * tol;
    // Doubled triangles (the same three corners in any order): an open-addressing table of triangle numbers, compared by their
    // sorted corners. A string per triangle used to cost a few hundred bytes each on a large mesh.
    const tsize = nextPow2(Math.max(16, triN * 2)), tmask = tsize - 1;
    const tri = new Int32Array(tsize).fill(-1);
    const sorted = (t) => {
      let a = A[t], b = B[t], c = C[t], x;
      if (a > b) { x = a; a = b; b = x; } if (b > c) { x = b; b = c; c = x; } if (a > b) { x = a; a = b; b = x; }
      return [a, b, c];
    };
    for (let t = 0; t < triN; t++) {
      const a = A[t], b = B[t], c = C[t];
      if (a === b || b === c || a === c) { keep[t] = 0; stats.degenerate++; continue; }
      const ux = W[b * 3] - W[a * 3], uy = W[b * 3 + 1] - W[a * 3 + 1], uz = W[b * 3 + 2] - W[a * 3 + 2];
      const vx = W[c * 3] - W[a * 3], vy = W[c * 3 + 1] - W[a * 3 + 1], vz = W[c * 3 + 2] - W[a * 3 + 2];
      const cl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      if (cl < areaMin) { keep[t] = 0; stats.degenerate++; continue; }
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

  // 3. one direction for the faces
  if (o.orient) {
    let kept = 0; for (let t = 0; t < triN; t++) kept += keep[t];
    if (kept <= o.maxOrient) stats.flipped = orientTriangles(W, A, B, C, keep, m, o.outward !== false); else stats.orientSkipped = true;
  }

  // 4. what is left, with the vertices nobody uses any more taken out
  const remap = new Int32Array(m).fill(-1);
  let used = 0, keptTris = 0;
  for (let t = 0; t < triN; t++) if (keep[t]) { keptTris++; const a = A[t], b = B[t], c = C[t]; if (remap[a] < 0) remap[a] = used++; if (remap[b] < 0) remap[b] = used++; if (remap[c] < 0) remap[c] = used++; }
  const position = new Float32Array(used * 3), uv = Wuv ? new Float32Array(used * 2) : null, normal = Wn ? new Float32Array(used * 3) : null;
  for (let j = 0; j < m; j++) {
    const r = remap[j]; if (r < 0) continue;
    position[r * 3] = W[j * 3]; position[r * 3 + 1] = W[j * 3 + 1]; position[r * 3 + 2] = W[j * 3 + 2];
    if (uv) { uv[r * 2] = Wuv[j * 2]; uv[r * 2 + 1] = Wuv[j * 2 + 1]; }
    if (normal) { normal[r * 3] = Wn[j * 3]; normal[r * 3 + 1] = Wn[j * 3 + 1]; normal[r * 3 + 2] = Wn[j * 3 + 2]; }
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
    index[w2++] = remap[A[t]]; index[w2++] = remap[B[t]]; index[w2++] = remap[C[t]];
    at[g] = w2;
  }
  if (groups) for (let g = 0; g < nGroups; g++) if (at[g] > starts[g]) outGroups.push({ start: starts[g], count: at[g] - starts[g], materialIndex: groups[g].materialIndex || 0 });
  stats.vertsAfter = used; stats.trisAfter = keptTris;
  const changed = stats.welded > 0 || stats.degenerate > 0 || stats.duplicate > 0 || stats.flipped > 0;
  return { position, uv, normal, index, groups: outGroups, stats, changed };
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
