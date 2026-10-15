// meshcheck.js — what is wrong with a triangle mesh, found from the numbers alone.
//
// checkMesh(positions, index) reads a mesh once and says, in counts:
//   degenerate           triangles with no area (two corners in one place, or all three on a line)
//   slivers              triangles that have an area but are needles (a thousandth as high as they are long)
//   duplicate            a triangle that another triangle already is (same three corners, either way round)
//   openEdges, holes     edges that only one triangle has, and how many separate loops (or chains) they form
//   nonManifoldEdges     edges shared by three or more triangles
//   nonManifoldVertices  corners where the triangles round a point do not form one fan (a bow-tie, a pinch)
//   inconsistent         edges where the two triangles run the same way along it: one of them is turned the wrong way
//   pieces               separate connected pieces; closedPieces those with no open edge at all
//   insideOut            closed pieces whose faces all point inward (negative volume, faces consistent)
//   cavities             closed inward-pointing pieces that lie inside another piece (a hollow: correct, not a fault)
//   mixedPieces          closed pieces whose faces disagree with each other
//   volume               the volume of the closed pieces that point outward
//
// How it knows (the parts that make it dependable on CAD output):
//  - Corners are joined by distance, not by index. A CAD mesh is cut along every face, so one corner of a part is several vertices;
//    they are welded when they are within 2e-6 of the part's size of each other (or a few float steps, if the part is far from the origin). The search looks into the neighbouring cells of a
//    grid, so two points a hair apart are joined however the grid happens to fall between them.
//  - Every edge remembers which way each triangle runs along it. On a clean surface the two triangles of an edge run opposite ways;
//    the same way means one is flipped. That finds a single flipped face, which the volume alone would never show.
//  - The volume of a piece is the sum of signed tetrahedra; only a closed piece with consistent faces can be called inside out.
//    One that is negative and lies inside another piece (a ray from it crosses the other an odd number of times) is a cavity.
//  - Triangles that are degenerate or doubled are left out of the topology, so they do not make a false open edge or a false
//    non-manifold edge on the surface they sit on.
//
// Pure numbers in, numbers out (typed arrays, no three.js): the page and the node tests use the same code.

export const DEFAULTS = { weldTol: 2e-6, sliver: 1e-3, flat: 2e-7 };

export function checkMesh(positions, index, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const vc = Math.floor(positions.length / 3);
  const T0 = index ? Math.floor(index.length / 3) : Math.floor(vc / 3);
  const out = { tris: T0, vertices: vc, welded: 0, degenerate: 0, slivers: 0, duplicate: 0, openEdges: 0, holes: 0, nonManifoldEdges: 0,
    nonManifoldVertices: 0, inconsistent: 0, pieces: 0, closedPieces: 0, insideOut: 0, cavities: 0, mixedPieces: 0, volume: 0, diag: 0 };
  if (!T0 || !vc) return out;

  // ── 1. the size of the part, and the vertices that are one ─────────────────────────────────────────────────────────────
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < vc; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1;
  out.diag = diag;
  // How close is "the same place": a few millionths of the part's size, but never closer than a few steps of the float32 numbers the
  // positions are kept in at the place the part is (a small part far from the origin cannot hold its corners any finer than that).
  const mag = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1), Math.abs(z0), Math.abs(z1));
  const tol = Math.max(diag * o.weldTol, mag * 1.2e-7 * 8), tol2 = tol * tol, cell = tol * 50, inv = 1 / cell, tf = tol / cell;
  const ids = new Int32Array(vc), repOf = [], nextRep = [], head = new Map();
  const ck = (a, b, c) => ((a + 2) * 65536 + (b + 2)) * 65536 + (c + 2);
  let N = 0;
  for (let i = 0; i < vc; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    const fx = (px - x0) * inv, fy = (py - y0) * inv, fz = (pz - z0) * inv;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz), ax = fx - ix, ay = fy - iy, az = fz - iz;
    const lx = ax < tf ? -1 : ax > 1 - tf ? 1 : 0, ly = ay < tf ? -1 : ay > 1 - tf ? 1 : 0, lz = az < tf ? -1 : az > 1 - tf ? 1 : 0;
    let found = -1;
    search:
    for (let a = 0; a <= (lx ? 1 : 0); a++) for (let b = 0; b <= (ly ? 1 : 0); b++) for (let c = 0; c <= (lz ? 1 : 0); c++) {
      let r = head.get(ck(ix + (a ? lx : 0), iy + (b ? ly : 0), iz + (c ? lz : 0)));
      while (r !== undefined && r !== -1) {
        const o3 = repOf[r] * 3, dx = positions[o3] - px, dy = positions[o3 + 1] - py, dz = positions[o3 + 2] - pz;
        if (dx * dx + dy * dy + dz * dz <= tol2) { found = r; break search; }
        r = nextRep[r];
      }
    }
    if (found < 0) {
      found = N++; repOf.push(i);
      const k = ck(ix, iy, iz), h = head.get(k);
      nextRep.push(h === undefined ? -1 : h); head.set(k, found);
    }
    ids[i] = found;
  }
  head.clear();
  out.welded = N;
  const P = (id) => repOf[id] * 3;           // where a welded vertex is (its first vertex)

  // ── 2. the triangles: empty ones and doubled ones are counted and left out; the rest give the edges ─────────────────────
  let cap = 1024; while (cap < T0 * 3) cap <<= 1;
  const mask = cap - 1, ekey = new Float64Array(cap).fill(-1), eslot = new Int32Array(cap);
  const E3 = T0 * 3;
  const ec = new Uint8Array(E3), et1 = new Int32Array(E3), et2 = new Int32Array(E3), ed1 = new Uint8Array(E3), ed2 = new Uint8Array(E3), ea = new Int32Array(E3), eb = new Int32Array(E3);
  let E = 0;
  const tv = new Int32Array(T0 * 3);
  let T = 0;
  const dHead = new Map(), dNext = new Int32Array(T0), sl = new Int32Array(T0), sm = new Int32Array(T0), sh = new Int32Array(T0);
  const sizeBase = N + 1;
  function edge(u, v, t) {
    const lo = u < v ? u : v, hi = u < v ? v : u, dir = u < v ? 0 : 1, key = lo * sizeBase + hi;
    let h = Math.imul(lo, 0x9E3779B1) ^ Math.imul(hi, 0x85EBCA6B); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 13;
    let s = h & mask;
    for (;;) {
      const k = ekey[s];
      if (k === -1) { ekey[s] = key; eslot[s] = E; ec[E] = 1; et1[E] = t; ed1[E] = dir; ea[E] = lo; eb[E] = hi; E++; return; }
      if (k === key) { const e = eslot[s]; if (ec[e] === 1) { et2[e] = t; ed2[e] = dir; } if (ec[e] < 255) ec[e]++; return; }
      s = (s + 1) & mask;
    }
  }
  for (let t0 = 0; t0 < T0; t0++) {
    const i0 = index ? index[t0 * 3] : t0 * 3, i1 = index ? index[t0 * 3 + 1] : t0 * 3 + 1, i2 = index ? index[t0 * 3 + 2] : t0 * 3 + 2;
    const a = ids[i0], b = ids[i1], c = ids[i2];
    if (a === b || b === c || a === c) { out.degenerate++; continue; }
    const ux = positions[i1 * 3] - positions[i0 * 3], uy = positions[i1 * 3 + 1] - positions[i0 * 3 + 1], uz = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
    const vx = positions[i2 * 3] - positions[i0 * 3], vy = positions[i2 * 3 + 1] - positions[i0 * 3 + 1], vz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
    const wx = vx - ux, wy = vy - uy, wz = vz - uz;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, cr = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const L2 = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz);
    if (cr <= o.flat * L2) { out.degenerate++; continue; }
    if (cr < o.sliver * L2) out.slivers++;
    // the same triangle again (either way round)?
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
    const dh = Math.imul(lo, 73856093) ^ Math.imul(mid, 19349663) ^ Math.imul(hi, 83492791);
    let dup = false, q = dHead.get(dh);
    while (q !== undefined && q !== -1) { if (sl[q] === lo && sm[q] === mid && sh[q] === hi) { dup = true; break; } q = dNext[q]; }
    if (dup) { out.duplicate++; continue; }
    const t = T++;
    tv[t * 3] = a; tv[t * 3 + 1] = b; tv[t * 3 + 2] = c;
    sl[t] = lo; sm[t] = mid; sh[t] = hi; const hd = dHead.get(dh); dNext[t] = hd === undefined ? -1 : hd; dHead.set(dh, t);
    edge(a, b, t); edge(b, c, t); edge(c, a, t);
  }
  dHead.clear();
  if (!T) return out;

  // ── 3. the edges: open, shared too often, run the same way; the fans round every corner; the loops of open edges ───────
  const cp = new Int32Array(T * 3); for (let i = 0; i < cp.length; i++) cp[i] = i;           // the corners of the triangles
  const cfind = (a) => { while (cp[a] !== a) { cp[a] = cp[cp[a]]; a = cp[a]; } return a; };
  const cor = (t, v) => { const o3 = t * 3; return tv[o3] === v ? o3 : tv[o3 + 1] === v ? o3 + 1 : o3 + 2; };
  const bp = new Int32Array(N); for (let i = 0; i < N; i++) bp[i] = i;                      // the open edges' corners
  const bfind = (a) => { while (bp[a] !== a) { bp[a] = bp[bp[a]]; a = bp[a]; } return a; };
  const bUsed = new Uint8Array(N);
  const incEdge = new Uint8Array(E), nonEdge = new Uint8Array(E), openEdge = new Uint8Array(E);
  for (let e = 0; e < E; e++) {
    const c = ec[e];
    if (c === 1) { out.openEdges++; openEdge[e] = 1; const ra = bfind(ea[e]), rb = bfind(eb[e]); if (ra !== rb) bp[ra] = rb; bUsed[ea[e]] = bUsed[eb[e]] = 1; }
    else if (c > 2) { out.nonManifoldEdges++; nonEdge[e] = 1; }
    else {
      if (ed1[e] === ed2[e]) { out.inconsistent++; incEdge[e] = 1; }
      for (const v of [ea[e], eb[e]]) { const r1 = cfind(cor(et1[e], v)), r2 = cfind(cor(et2[e], v)); if (r1 !== r2) cp[r1] = r2; }
    }
  }
  { const roots = new Set(); for (let v = 0; v < N; v++) if (bUsed[v]) roots.add(bfind(v)); out.holes = roots.size; }
  { // a corner whose triangles are not one fan
    const first = new Int32Array(N).fill(-1);
    const bad = new Uint8Array(N);
    for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) {
      const v = tv[t * 3 + k], r = cfind(t * 3 + k);
      if (first[v] === -1) first[v] = r; else if (first[v] !== r) bad[v] = 1;
    }
    let n = 0; for (let v = 0; v < N; v++) n += bad[v]; out.nonManifoldVertices = n;
  }

  // ── 4. the pieces: how many, which are closed, which point inward ──────────────────────────────────────────────────────────
  const vp = new Int32Array(N); for (let i = 0; i < N; i++) vp[i] = i;
  const vfind = (a) => { while (vp[a] !== a) { vp[a] = vp[vp[a]]; a = vp[a]; } return a; };
  for (let t = 0; t < T; t++) {
    const ra = vfind(tv[t * 3]), rb = vfind(tv[t * 3 + 1]), rc = vfind(tv[t * 3 + 2]);
    if (ra !== rb) vp[ra] = rb;
    const rb2 = vfind(tv[t * 3 + 1]); if (rc !== rb2) vp[rc] = rb2;
  }
  const cTris = new Int32Array(N), cOpen = new Int32Array(N), cNon = new Int32Array(N), cInc = new Int32Array(N), cVol = new Float64Array(N);
  for (let t = 0; t < T; t++) {
    const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2], r = vfind(a), pa = P(a), pb = P(b), pc = P(c);
    cTris[r]++;
    const ax = positions[pa], ay = positions[pa + 1], az = positions[pa + 2];
    cVol[r] += (ax * (positions[pb + 1] * positions[pc + 2] - positions[pb + 2] * positions[pc + 1])
              - ay * (positions[pb] * positions[pc + 2] - positions[pb + 2] * positions[pc])
              + az * (positions[pb] * positions[pc + 1] - positions[pb + 1] * positions[pc])) / 6;
  }
  for (let e = 0; e < E; e++) { const r = vfind(ea[e]); if (openEdge[e]) cOpen[r]++; if (nonEdge[e]) cNon[r]++; if (incEdge[e]) cInc[r]++; }
  const roots = [];
  for (let v = 0; v < N; v++) if (cTris[v] > 0) roots.push(v);
  out.pieces = roots.length;
  const volEps = diag * diag * diag * 1e-12;
  const negative = [], outward = new Set();
  for (const r of roots) {
    const closed = cOpen[r] === 0 && cNon[r] === 0;
    if (!closed) continue;
    out.closedPieces++;
    if (cInc[r] > 0) { out.mixedPieces++; continue; }
    if (cVol[r] > volEps) { out.volume += cVol[r]; outward.add(r); }
    else if (cVol[r] < -volEps) negative.push(r);
  }
  // a piece that points inward and lies inside another is a hollow; any other is turned inside out
  if (negative.length) {
    const dirx = 0.9999, diry = 0.0113, dirz = 0.0071;
    for (const r of negative) {
      let v0 = -1; for (let t = 0; t < T && v0 < 0; t++) if (vfind(tv[t * 3]) === r) v0 = tv[t * 3];
      const p = P(v0), ox = positions[p], oy = positions[p + 1], oz = positions[p + 2];
      let hits = 0;
      for (let t = 0; t < T; t++) {
        const a = tv[t * 3], rt = vfind(a);
        if (rt === r || !outward.has(rt)) continue;
        const pa = P(a), pb = P(tv[t * 3 + 1]), pc = P(tv[t * 3 + 2]);
        const e1x = positions[pb] - positions[pa], e1y = positions[pb + 1] - positions[pa + 1], e1z = positions[pb + 2] - positions[pa + 2];
        const e2x = positions[pc] - positions[pa], e2y = positions[pc + 1] - positions[pa + 1], e2z = positions[pc + 2] - positions[pa + 2];
        const hx = diry * e2z - dirz * e2y, hy = dirz * e2x - dirx * e2z, hz = dirx * e2y - diry * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-18) continue;
        const f = 1 / det, sx = ox - positions[pa], sy = oy - positions[pa + 1], sz = oz - positions[pa + 2];
        const u = f * (sx * hx + sy * hy + sz * hz); if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const w = f * (dirx * qx + diry * qy + dirz * qz); if (w < 0 || u + w > 1) continue;
        if (f * (e2x * qx + e2y * qy + e2z * qz) > diag * 1e-9) hits++;
      }
      if (hits & 1) out.cavities++; else out.insideOut++;
    }
  }
  return out;
}
