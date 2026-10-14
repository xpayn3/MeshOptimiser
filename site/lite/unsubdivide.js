// unsubdivide.js — Blender's Un-Subdivide for the rings of a revolved surface.
//
// A cylinder, a cone, a bellows or a bearing seat from a CAD file is a regular grid of long, thin quads (each cut into two triangles):
// a hundred or more lines run along it, close together, and rings cross them far apart. A general simplifier reduces such a surface
// by collapsing edges wherever its error is lowest, which leaves fans and slivers. The way a person would do it is to take away every
// second one of the close lines: the quads become twice as wide, nearly square, nothing is cut into a fan, and the outline moves by
// the little that a polygon with half the sides is off the circle.
//
// What it does, on the triangles it is given:
//   1. Points at the same place are one (a CAD mesh stores every corner once per face).
//   2. Two triangles that share their longest edge and make a flat, convex, rectangular quad are paired.
//   3. Each quad has two directions. Where the quads are clearly longer one way than the other (opts.minAspect), the long sides run
//      along lines of such quads; two neighbouring lines are never both taken: the lines are coloured alternately and one colour goes.
//      A ring with an odd number of lines cannot be coloured alternately and is left as it is.
//   4. A line goes only where there is a quad on both sides of every edge of it. A point on it goes too when four quads meet there
//      and it lies within opts.tol of the straight line between its two neighbours along the ring.
//   5. The quads that are joined are cut again into the fewest triangles (the shorter diagonal of a four-sided face).
// Nothing is moved and no point is made: the result uses points of the input, so normals, colours and UVs carry over, and the
// surface stays closed where it was (every point that goes goes from every face that has it).
//
// Pure function on typed arrays, linear in the triangles, no dependencies: the worker calls it, the tests call it from Node.
//
//   positions   Float32Array, xyz per vertex
//   index       Uint32Array (or any index array), three per triangle
//   opts.minAspect   how much longer the quads are one way than the other for it to count (default 1.6)
//   opts.tol         how far a point that goes may be from the line between its neighbours, in the mesh's units (default 0.3 % of its size)
//   opts.maxBend     the angle, in degrees, the two triangles of a quad may be turned from each other (default 25)
// Returns null when nothing could be done, else { index, stats: { quads, lines, removed, trisBefore, trisAfter } }.

const POW2 = (n) => { let s = 16; while (s < n) s <<= 1; return s; };

export function unsubdivide(positions, index, opts = {}) {
  const P = positions, I = index;
  const nRaw = (P.length / 3) | 0, T = (I.length / 3) | 0;
  if (T < 8) return null;
  const minAspect = opts.minAspect > 1 ? opts.minAspect : 1.6;
  const cosBend = Math.cos((opts.maxBend > 0 ? opts.maxBend : 25) * Math.PI / 180);

  // ── 1. points at one place are one ──────────────────────────────────────────
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < nRaw; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (!(diag > 0)) return null;
  const tol = opts.tol > 0 ? opts.tol : diag * 0.003;
  const inv = 1 / (diag * 1e-6);
  const wid = new Int32Array(nRaw);
  let W = 0;
  {
    const cap = POW2(nRaw * 2), mask = cap - 1, table = new Int32Array(cap).fill(-1);
    const qx = new Int32Array(nRaw), qy = new Int32Array(nRaw), qz = new Int32Array(nRaw);
    for (let v = 0; v < nRaw; v++) {
      const ix = Math.round((P[v * 3] - x0) * inv), iy = Math.round((P[v * 3 + 1] - y0) * inv), iz = Math.round((P[v * 3 + 2] - z0) * inv);
      let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
      for (;;) {
        const w = table[h];
        if (w < 0) { table[h] = W; qx[W] = ix; qy[W] = iy; qz[W] = iz; wid[v] = W++; break; }
        if (qx[w] === ix && qy[w] === iy && qz[w] === iz) { wid[v] = w; break; }
        h = (h + 1) & mask;
      }
    }
  }
  const tw = new Int32Array(T * 3), live = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const a = wid[I[t * 3]], b = wid[I[t * 3 + 1]], c = wid[I[t * 3 + 2]];
    tw[t * 3] = a; tw[t * 3 + 1] = b; tw[t * 3 + 2] = c;
    live[t] = (a !== b && b !== c && a !== c) ? 1 : 0;
  }
  const wx = (w) => P[firstOf[w] * 3], wy = (w) => P[firstOf[w] * 3 + 1], wz = (w) => P[firstOf[w] * 3 + 2];
  const firstOf = new Int32Array(W).fill(-1);
  for (let v = 0; v < nRaw; v++) if (firstOf[wid[v]] < 0) firstOf[wid[v]] = v;
  const dist = (a, b) => Math.hypot(wx(a) - wx(b), wy(a) - wy(b), wz(a) - wz(b));

  // ── edges: every pair of points a triangle joins, with its (one or two) triangles ──
  const eCap = POW2(T * 6), eMask = eCap - 1, eTab = new Int32Array(eCap).fill(-1);
  const eA = new Int32Array(T * 3), eB = new Int32Array(T * 3), eT0 = new Int32Array(T * 3).fill(-1), eT1 = new Int32Array(T * 3).fill(-1);
  const eBad = new Uint8Array(T * 3), eDir0 = new Int32Array(T * 3);
  let nE = 0;
  const triEdge = new Int32Array(T * 3).fill(-1);
  const edgeFind = (a, b, create) => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    let s = (Math.imul(lo, 73856093) ^ Math.imul(hi, 19349663)) & eMask;
    for (;;) {
      const e = eTab[s];
      if (e < 0) { if (!create) return -1; eTab[s] = nE; eA[nE] = lo; eB[nE] = hi; return nE++; }
      if (eA[e] === lo && eB[e] === hi) return e;
      s = (s + 1) & eMask;
    }
  };
  for (let t = 0; t < T; t++) {
    if (!live[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = tw[t * 3 + k], b = tw[t * 3 + (k + 1) % 3];
      const e = edgeFind(a, b, true);
      triEdge[t * 3 + k] = e;
      if (eT0[e] < 0) { eT0[e] = t; eDir0[e] = a; }
      else if (eT1[e] < 0) { eT1[e] = t; if (eDir0[e] === a) eBad[e] = 1; }      // (both run the same way: one of them is wound the wrong way)
      else eBad[e] = 1;
    }
  }
  const interior = (e) => eT1[e] >= 0 && !eBad[e];
  const otherTri = (e, t) => (eT0[e] === t ? eT1[e] : eT0[e]);

  // ── 2. quads: two triangles that share the longest edge of both ─────────────
  const best = new Int32Array(T).fill(-1);
  for (let t = 0; t < T; t++) {
    if (!live[t]) continue;
    let bl = -1, be = -1;
    for (let k = 0; k < 3; k++) {
      const e = triEdge[t * 3 + k];
      if (!interior(e)) continue;
      const l = dist(eA[e], eB[e]);
      if (l > bl) { bl = l; be = e; }
    }
    best[t] = be;
  }
  const quadOf = new Int32Array(T).fill(-1);
  const qv = [], qo = [], qt = [];                       // welded cycle (4), original ids (4), the two triangles (2) per quad
  const triNormal = (t, out) => {
    const a = tw[t * 3], b = tw[t * 3 + 1], c = tw[t * 3 + 2];
    const ux = wx(b) - wx(a), uy = wy(b) - wy(a), uz = wz(b) - wz(a), vx = wx(c) - wx(a), vy = wy(c) - wy(a), vz = wz(c) - wz(a);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
  };
  const n0 = [0, 0, 0], n1 = [0, 0, 0];
  for (let t = 0; t < T; t++) {
    const e = best[t];
    if (e < 0 || quadOf[t] >= 0) continue;
    const u = otherTri(e, t);
    if (u < 0 || quadOf[u] >= 0 || best[u] !== e) continue;
    // t runs a→b along the shared edge (in t's winding), c is its third point; u has d
    let k = 0;
    while (triEdge[t * 3 + k] !== e) k++;
    const a = tw[t * 3 + k], b = tw[t * 3 + (k + 1) % 3], c = tw[t * 3 + (k + 2) % 3];
    let d = -1, dOrig = -1;
    for (let j = 0; j < 3; j++) { const w = tw[u * 3 + j]; if (w !== a && w !== b) { d = w; dOrig = I[u * 3 + j]; } }
    if (d < 0 || d === c) continue;
    triNormal(t, n0); triNormal(u, n1);
    if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < cosBend) continue;      // (the two halves of a quad lie nearly in one plane)
    // the quad runs a → d → b → c; every corner must be a convex, nearly right angle
    const cyc = [a, d, b, c];
    let ok = true;
    for (let j = 0; j < 4 && ok; j++) {
      const p = cyc[(j + 3) % 4], q = cyc[j], r = cyc[(j + 1) % 4];
      const ax = wx(p) - wx(q), ay = wy(p) - wy(q), az = wz(p) - wz(q), bx = wx(r) - wx(q), by = wy(r) - wy(q), bz = wz(r) - wz(q);
      const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
      if (!(la > 0 && lb > 0)) { ok = false; break; }
      const cs = (ax * bx + ay * by + az * bz) / (la * lb);
      if (Math.abs(cs) > 0.42) ok = false;                // 65 to 115 degrees
    }
    if (!ok) continue;
    const q = qt.length / 2;
    quadOf[t] = q; quadOf[u] = q;
    qv.push(a, d, b, c);
    // original ids of the corners, from the triangles themselves
    const oa = I[t * 3 + k], ob = I[t * 3 + (k + 1) % 3], oc = I[t * 3 + (k + 2) % 3];
    qo.push(oa, dOrig, ob, oc);
    qt.push(t, u);
  }
  const nQ = qt.length / 2;
  if (nQ < 4) return null;

  // ── 3. which way each quad is long, and the lines of long sides ────────────
  const side = (q, k) => edgeFind(qv[q * 4 + k], qv[q * 4 + (k + 1) % 4], false);
  const qPair = new Int8Array(nQ).fill(-1);
  for (let q = 0; q < nQ; q++) {
    const l0 = dist(qv[q * 4], qv[q * 4 + 1]), l1 = dist(qv[q * 4 + 1], qv[q * 4 + 2]), l2 = dist(qv[q * 4 + 2], qv[q * 4 + 3]), l3 = dist(qv[q * 4 + 3], qv[q * 4]);
    const A = l0 + l2, B = l1 + l3, long = Math.max(A, B), short = Math.min(A, B);
    if (short > 0 && long / short >= minAspect) qPair[q] = A >= B ? 0 : 1;
  }
  const quadAcross = (q, k) => {
    const e = side(q, k);
    if (e < 0 || !interior(e)) return -1;
    const t = eT0[e] === qt[q * 2] || eT0[e] === qt[q * 2 + 1] ? eT1[e] : eT0[e];
    return t >= 0 ? quadOf[t] : -1;
  };
  // the side of quad q (index) that runs along a long line and touches point w
  const longAt = (q, w) => {
    const p = qPair[q];
    for (const k of [p, p + 2]) if (qv[q * 4 + k] === w || qv[q * 4 + (k + 1) % 4] === w) return k;
    return -1;
  };
  // union-find over edges with the parity of the colour
  const par = new Int32Array(nE), pty = new Uint8Array(nE), bad = new Uint8Array(nE);
  for (let e = 0; e < nE; e++) par[e] = e;
  const find = (x) => {
    let p = 0, r = x;
    while (par[r] !== r) { p ^= pty[r]; r = par[r]; }
    // (compress)
    let cur = x, cp = p;
    while (par[cur] !== r && cur !== r) { const nx = par[cur], np = cp ^ pty[cur]; par[cur] = r; const old = pty[cur]; pty[cur] = cp; cp = np; cur = nx; void old; }
    return [r, p];
  };
  const union = (x, y, d) => {
    const [rx, px] = find(x), [ry, py] = find(y);
    if (rx === ry) { if (((px ^ py) & 1) !== d) bad[rx] = 1; return; }
    par[rx] = ry; pty[rx] = px ^ py ^ d; if (bad[rx]) bad[ry] = 1;
  };
  const longCount = new Uint8Array(nE);
  for (let q = 0; q < nQ; q++) {
    const p = qPair[q];
    if (p < 0) continue;
    const s0 = side(q, p), s2 = side(q, p + 2);
    longCount[s0]++; longCount[s2]++;
    union(s0, s2, 1);                                    // neighbouring lines: the other colour
    for (const k of [(p + 1) % 4, (p + 3) % 4]) {        // across a short side the lines go on, in the same colour
      const q2 = quadAcross(q, k);
      if (q2 < 0 || qPair[q2] < 0) continue;
      const ka = qv[q * 4 + k], kb = qv[q * 4 + (k + 1) % 4];
      // the short side must be a short side of the other quad too
      const e = side(q, k), f = [(qPair[q2] + 1) % 4, (qPair[q2] + 3) % 4].some((j) => side(q2, j) === e);
      if (!f) continue;
      for (const w of [ka, kb]) { const l1 = longAt(q, w), l2 = longAt(q2, w); if (l1 >= 0 && l2 >= 0) union(side(q, l1), side(q2, l2), 0); }
    }
  }

  // ── 4. the lines that go, and the points on them ────────────────────────────
  const dissolved = new Uint8Array(nE);
  let nDis = 0;
  for (let e = 0; e < nE; e++) {
    if (longCount[e] !== 2 || !interior(e)) continue;
    const [r, p] = find(e);
    if (bad[r] || p !== 0) continue;
    dissolved[e] = 1; nDis++;
  }
  if (!nDis) return null;
  // quads and triangles at each point
  const vq = new Map();                                  // point → quads that have it
  for (let q = 0; q < nQ; q++) for (let j = 0; j < 4; j++) { const w = qv[q * 4 + j]; const l = vq.get(w); if (l) l.push(q); else vq.set(w, [q]); }
  const tcount = new Int32Array(W);
  for (let t = 0; t < T; t++) if (live[t]) for (let k = 0; k < 3; k++) tcount[tw[t * 3 + k]]++;
  const removedPt = new Uint8Array(W);
  let nRemoved = 0;
  const triHas = (t, w) => tw[t * 3] === w || tw[t * 3 + 1] === w || tw[t * 3 + 2] === w;
  for (const [w, qs] of vq) {
    // every triangle at the point belongs to one of its quads
    let inQuads = 0;
    for (const q of qs) inQuads += (triHas(qt[q * 2], w) ? 1 : 0) + (triHas(qt[q * 2 + 1], w) ? 1 : 0);
    if (inQuads !== tcount[w]) continue;
    // its edges (the sides of its quads): the dissolved ones and the others
    const es = new Set();
    for (const q of qs) for (let j = 0; j < 4; j++) { if (qv[q * 4 + j] === w || qv[q * 4 + (j + 1) % 4] === w) es.add(side(q, j)); }
    const dis = [], keep = [];
    for (const e of es) (dissolved[e] ? dis : keep).push(e);
    // inside the surface: four quads, two long edges dissolved, two ring edges left. On a rim that is an open edge: two quads, one long
    // edge dissolved, and the two edges along the rim (each used by one triangle only) left.
    const inner = qs.length === 4 && es.size === 4 && dis.length === 2 && keep.length === 2;
    const rim = qs.length === 2 && es.size === 3 && dis.length === 1 && keep.length === 2 && keep.every((e) => eT1[e] < 0 && !eBad[e]);
    if (!inner && !rim) continue;
    const other = (e) => (eA[e] === w ? eB[e] : eA[e]);
    const p = other(keep[0]), r = other(keep[1]);
    // w lies on the straight run between its two neighbours along the ring, within the tolerance
    const abx = wx(r) - wx(p), aby = wy(r) - wy(p), abz = wz(r) - wz(p), apx = wx(w) - wx(p), apy = wy(w) - wy(p), apz = wz(w) - wz(p);
    const l2 = abx * abx + aby * aby + abz * abz;
    if (!(l2 > 0)) continue;
    let s = (apx * abx + apy * aby + apz * abz) / l2; s = s < 0 ? 0 : s > 1 ? 1 : s;
    const dx = apx - s * abx, dy = apy - s * aby, dz = apz - s * abz;
    if (Math.hypot(dx, dy, dz) > tol) continue;
    removedPt[w] = 1; nRemoved++;
  }

  // ── 5. the faces that were joined, cut again ────────────────────────────────
  const qp = new Int32Array(nQ);
  for (let q = 0; q < nQ; q++) qp[q] = q;
  const qf = (x) => { while (qp[x] !== x) { qp[x] = qp[qp[x]]; x = qp[x]; } return x; };
  for (let q = 0; q < nQ; q++) for (let k = 0; k < 4; k++) {
    const e = side(q, k);
    if (e < 0 || !dissolved[e]) continue;
    const q2 = quadAcross(q, k);
    if (q2 >= 0) qp[qf(q)] = qf(q2);
  }
  const groups = new Map();
  for (let q = 0; q < nQ; q++) { const g = qf(q); const l = groups.get(g); if (l) l.push(q); else groups.set(g, [q]); }
  const drop = new Uint8Array(T);                        // triangles that are replaced
  const out = [];
  const cut = (loop, rep) => {
    const n = loop.length;
    if (n === 3) { out.push(rep.get(loop[0]), rep.get(loop[1]), rep.get(loop[2])); return true; }
    if (n === 4) {
      const d02 = dist(loop[0], loop[2]), d13 = dist(loop[1], loop[3]);
      const o = d02 <= d13 ? [0, 1, 2, 0, 2, 3] : [1, 2, 3, 1, 3, 0];
      for (const j of o) out.push(rep.get(loop[j]));
      return true;
    }
    return earClip(loop, rep);
  };
  const earClip = (loop, rep) => {
    // project on the plane of the loop (Newell's normal) and cut ears
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      nx += (wy(a) - wy(b)) * (wz(a) + wz(b)); ny += (wz(a) - wz(b)) * (wx(a) + wx(b)); nz += (wx(a) - wx(b)) * (wy(a) + wy(b));
    }
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 0)) return false;
    nx /= nl; ny /= nl; nz /= nl;
    let ux, uy, uz;
    if (Math.abs(nx) < 0.9) { ux = 0; uy = -nz; uz = ny; } else { ux = nz; uy = 0; uz = -nx; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const X = loop.map((w) => wx(w) * ux + wy(w) * uy + wz(w) * uz), Y = loop.map((w) => wx(w) * vx + wy(w) * vy + wz(w) * vz);
    const idx = loop.map((_, i) => i);
    const cross = (a, b, c) => (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]);
    const tris = [];
    let guard = loop.length * loop.length;
    while (idx.length > 3 && guard-- > 0) {
      let cutAt = -1;
      for (let i = 0; i < idx.length && cutAt < 0; i++) {
        const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
        if (cross(a, b, c) <= 0) continue;
        let inside = false;
        for (const p of idx) {
          if (p === a || p === b || p === c) continue;
          if (cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0) { inside = true; break; }
        }
        if (!inside) cutAt = i;
      }
      if (cutAt < 0) return false;
      const a = idx[(cutAt + idx.length - 1) % idx.length], b = idx[cutAt], c = idx[(cutAt + 1) % idx.length];
      tris.push(a, b, c); idx.splice(cutAt, 1);
    }
    if (idx.length !== 3) return false;
    tris.push(idx[0], idx[1], idx[2]);
    for (const i of tris) out.push(rep.get(loop[i]));
    return true;
  };
  let trisJoined = 0, groupsDone = 0;
  for (const [, qs] of groups) {
    if (qs.length < 2) continue;
    // the outline of the joined quads, following their windings
    const next = new Map(), rep = new Map();
    let okG = true;
    const inGroup = new Set(qs);
    for (const q of qs) {
      for (let j = 0; j < 4; j++) {
        const w = qv[q * 4 + j];
        if (!rep.has(w)) rep.set(w, qo[q * 4 + j]);
        const k = j, e = side(q, k);
        if (e >= 0 && dissolved[e]) { const q2 = quadAcross(q, k); if (q2 >= 0 && inGroup.has(q2)) continue; }
        const from = qv[q * 4 + j], to = qv[q * 4 + (j + 1) % 4];
        if (next.has(from)) { okG = false; break; }
        next.set(from, to);
      }
      if (!okG) break;
    }
    if (!okG || !next.size) continue;
    const start = next.keys().next().value;
    const loop = [];
    let cur = start, steps = 0;
    do { loop.push(cur); cur = next.get(cur); steps++; if (cur === undefined || steps > next.size + 1) { okG = false; break; } } while (cur !== start);
    if (!okG || loop.length !== next.size) continue;       // (more than one outline, or a pinch: left alone)
    const kept = loop.filter((w) => !removedPt[w]);
    if (kept.length < 3) continue;
    const before = out.length;
    if (!cut(kept, rep)) { out.length = before; continue; }
    for (const q of qs) { drop[qt[q * 2]] = 1; drop[qt[q * 2 + 1]] = 1; }
    trisJoined += qs.length * 2;
    groupsDone++;
  }
  if (!groupsDone) return null;
  const res = new Uint32Array((T - trisJoined) * 3 + out.length);
  let o = 0;
  for (let t = 0; t < T; t++) { if (drop[t]) continue; res[o++] = I[t * 3]; res[o++] = I[t * 3 + 1]; res[o++] = I[t * 3 + 2]; }
  for (let i = 0; i < out.length; i++) res[o++] = out[i];
  if (res.length >= I.length) return null;
  return { index: res, stats: { quads: nQ, lines: nDis, removed: nRemoved, groups: groupsDone, trisBefore: T, trisAfter: res.length / 3 } };
}
