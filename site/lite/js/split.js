// split.js — take a mesh apart: which triangles belong together, and the geometries that make.
//
//   partition(positions, index, opts)  → { labels, count, sizes }   (labels: one number per triangle)
//   buildChildGeometries(THREE, geom, labels, count)                 → one BufferGeometry per label
//
// Pure functions on typed arrays: the app calls them for the preview (count only) and for the split itself, and the tests call
// them from Node. They run in time linear in the triangles, with no string keys, so a mesh of a million triangles is a matter of
// a second or two, and a scene of thousands of parts is thousands of small calls.
//
// Methods (opts.method):
//   bodies   a body is a closed surface: triangles that share a whole edge belong together, and where more than two triangles
//            meet at an edge (two solids touching along a face or an edge, welded together by the exporter) they are paired into
//            wedges of material, so each solid keeps its own. Solids that touch at a point, an edge or a face come apart. A
//            T-junction (one face finer than its neighbour along their common edge) does not cut a solid. The default.
//   vertex   triangles that share a corner are one piece (corners are welded within opts.epsAbs first). Anything that touches
//            stays together.
//   edge     triangles are one piece only if they share a whole edge: solids that meet at a point or a knife edge stay apart.
//   spatial  triangles whose boxes share a cell of a 3D grid (opts.cellSize) are one piece. Does not read the index at all.
//   hybrid   vertex first; when one piece holds over half the triangles, that piece is cut up by proximity.
//   faces    triangles are one face if they share a whole edge and the angle between them is within opts.faceAngle (degrees):
//            a flat face, or a smooth curved one, comes out as one piece, and every crease starts another.
//
// opts.epsAbs         welding distance in the mesh's units. 0 on an indexed mesh: the index is trusted exactly.
// opts.minTriangles   pieces with fewer triangles than this are not parts of their own: together they make one more part
//                     (the largest piece is never one of them). 0: every piece is a part.

// ── welding ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Each vertex gets the number of the place it is at. With an index and no tolerance the index is the truth (every vertex is its
// own place); without an index and no tolerance, vertices with the same bits share a place; with a tolerance, every two vertices
// within epsAbs of each other share a place (and so do the ones they chain to), wherever they fall on the grid underneath.
export function weld(positions, vCount, epsAbs, indexed) {
  const canon = new Int32Array(vCount);
  if (indexed && !(epsAbs > 0)) { for (let i = 0; i < vCount; i++) canon[i] = i; return { canon, N: vCount }; }
  if (!(epsAbs > 0)) return weldExact(positions, vCount, canon);
  // A grid of cells 2·eps wide. Every vertex looks into the 8 cells nearest to it (its own and the ones on the side it leans to),
  // which hold every vertex within eps of it, and joins those: a pair that straddles a cell border is never missed, which the old
  // rounding to a grid did (about 2 % of the duplicates that are one float step apart, each one a loose face).
  const eps = epsAbs, inv = 0.5 / eps, eps2 = eps * eps;
  let cap = 1; while (cap < vCount * 2) cap <<= 1;
  const head = new Int32Array(cap).fill(-1), next = new Int32Array(vCount);                       // vertices in a hash slot, as a chain
  const cx = new Float64Array(vCount), cy = new Float64Array(vCount), cz = new Float64Array(vCount);   // the cell of each vertex
  const parent = new Int32Array(vCount);
  for (let i = 0; i < vCount; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const hash = (x, y, z) => (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791) ^ Math.imul((x / 4294967296) | 0, 2654435761)) & (cap - 1);
  for (let v = 0; v < vCount; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const fx = px * inv, fy = py * inv, fz = pz * inv;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const sx = fx - ix < 0.5 ? -1 : 1, sy = fy - iy < 0.5 ? -1 : 1, sz = fz - iz < 0.5 ? -1 : 1;
    let rv = -1;
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
      const jx = ix + dx * sx, jy = iy + dy * sy, jz = iz + dz * sz;
      let n = 0;
      for (let u = head[hash(jx, jy, jz)]; u >= 0 && n < 512; u = next[u], n++) {
        if (cx[u] !== jx || cy[u] !== jy || cz[u] !== jz) continue;
        const ex = positions[u * 3] - px, ey = positions[u * 3 + 1] - py, ez = positions[u * 3 + 2] - pz;
        if (ex * ex + ey * ey + ez * ez > eps2) continue;
        const ru = find(u);
        if (rv < 0) rv = find(v);
        if (ru !== rv) { parent[ru] = rv; }
      }
    }
    cx[v] = ix; cy[v] = iy; cz[v] = iz;
    const h = hash(ix, iy, iz); next[v] = head[h]; head[h] = v;
  }
  // places numbered in the order of their first vertex
  const number = new Int32Array(vCount).fill(-1);
  let N = 0;
  for (let v = 0; v < vCount; v++) { const r = find(v); if (number[r] < 0) number[r] = N++; canon[v] = number[r]; }
  return { canon, N };
}

// vertices with exactly the same bits share a place (a mesh without an index, no tolerance)
function weldExact(positions, vCount, canon) {
  const bits = new Int32Array(positions.buffer, positions.byteOffset, positions.length);
  let cap = 1; while (cap < vCount * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1);
  const first = new Int32Array(vCount);                                                          // place → a vertex there
  let N = 0;
  for (let v = 0; v < vCount; v++) {
    let h = (Math.imul(bits[v * 3], 73856093) ^ Math.imul(bits[v * 3 + 1], 19349663) ^ Math.imul(bits[v * 3 + 2], 83492791)) & (cap - 1);
    for (;;) {
      const c = table[h];
      if (c < 0) { table[h] = N; first[N] = v; canon[v] = N++; break; }
      const f = first[c] * 3;
      if (bits[f] === bits[v * 3] && bits[f + 1] === bits[v * 3 + 1] && bits[f + 2] === bits[v * 3 + 2]) { canon[v] = c; break; }
      h = (h + 1) & (cap - 1);
    }
  }
  return { canon, N };
}

function unionFind(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  return { find, uni };
}

// ── the methods: each gives a union-find over the triangles ──────────────────────────────────────────────────────────────
function byVertex(T, tv, canon, N) {
  const uf = unionFind(N);
  for (let t = 0; t < T; t++) { const a = canon[tv(t, 0)], b = canon[tv(t, 1)], c = canon[tv(t, 2)]; uf.uni(a, b); uf.uni(b, c); }
  return (t) => uf.find(canon[tv(t, 0)]);
}

// every edge (by place numbers) seen so far → the triangle that had it first; `join(t, other, a, b)` decides whether to union
function byEdges(T, tv, canon, N, join) {
  const uf = unionFind(T);
  const seen = new Map();
  const big = N > 9e7;                                                       // (a key lo * N + hi stays exact in a double up to here)
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const a = canon[tv(t, k)], b = canon[tv(t, (k + 1) % 3)];
      if (a === b) continue;
      const lo = a < b ? a : b, hi = a < b ? b : a;
      const key = big ? lo + ',' + hi : lo * N + hi;
      const o = seen.get(key);
      if (o === undefined) seen.set(key, t);
      else if (join(t, o)) uf.uni(o, t);
    }
  }
  return uf.find;
}

// Bodies. Every edge (by place numbers) lists the triangles at it. Two triangles at an edge are one body. More than two is a
// seam where solids were welded together: the triangles are sorted by their angle round the edge and paired into wedges of
// material, a triangle that runs the edge b→a with the next one in the turning direction that runs it a→b (for a surface wound
// outward, the inside of the solid lies on that side), so each solid keeps its own two and the seam does not join them. A
// zero-area triangle (two corners at one place, or the third corner on the edge) is pinned to a neighbour and takes no part in
// the pairing. An open edge (one triangle) joins nothing, except across a T-junction: two open edges that leave one place in the
// same direction lie on one line, so their triangles are one body.
function byBodies(positions, T, tv, canon, N) {
  const uf = unionFind(T);
  const big = N > 9e7;
  const ids = new Map();
  const edgeOf = new Int32Array(T * 3);
  const degenerate = new Uint8Array(T);
  let E = 0;
  for (let t = 0; t < T; t++) {
    const a = canon[tv(t, 0)], b = canon[tv(t, 1)], c = canon[tv(t, 2)];
    if (a === b || b === c || a === c) degenerate[t] = 1;
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c, q = k === 0 ? b : k === 1 ? c : a;
      if (p === q) { edgeOf[t * 3 + k] = -1; continue; }
      const lo = p < q ? p : q, hi = p < q ? q : p;
      const key = big ? lo + ',' + hi : lo * N + hi;
      let id = ids.get(key);
      if (id === undefined) { id = E++; ids.set(key, id); }
      edgeOf[t * 3 + k] = id;
    }
  }
  // the corners (triangle * 3 + k) at each edge, a counting sort
  const start = new Int32Array(E + 1);
  for (let i = 0; i < T * 3; i++) if (edgeOf[i] >= 0) start[edgeOf[i] + 1]++;
  for (let e = 0; e < E; e++) start[e + 1] += start[e];
  const fill = start.slice(0, E), slot = new Int32Array(start[E]);
  for (let i = 0; i < T * 3; i++) if (edgeOf[i] >= 0) slot[fill[edgeOf[i]]++] = i;
  const open = [];                                                 // corners whose edge has one real triangle
  const items = [];                                                // the real triangles at a seam: { t, ang, fwd }
  for (let e = 0; e < E; e++) {
    const s0 = start[e], s1 = start[e + 1];
    // real triangles first; the zero-area ones are pinned to the first real one (or to each other)
    let firstReal = -1, n = 0;
    for (let s = s0; s < s1; s++) { const t = slot[s] / 3 | 0; if (!degenerate[t]) { n++; if (firstReal < 0) firstReal = slot[s]; } }
    for (let s = s0; s < s1; s++) { const t = slot[s] / 3 | 0; if (degenerate[t]) uf.uni(firstReal >= 0 ? firstReal / 3 | 0 : slot[s0] / 3 | 0, t); }
    if (n === 0) continue;
    if (n === 1) { open.push(firstReal); continue; }
    if (n === 2) { let p = -1; for (let s = s0; s < s1; s++) { const t = slot[s] / 3 | 0; if (degenerate[t]) continue; if (p < 0) p = t; else uf.uni(p, t); } continue; }
    // a seam: angles round the edge, in the frame of the first real triangle
    const t0 = firstReal / 3 | 0, k0 = firstReal % 3;
    const A = tv(t0, k0), B = tv(t0, (k0 + 1) % 3);
    const ax = positions[A * 3], ay = positions[A * 3 + 1], az = positions[A * 3 + 2];
    let ex = positions[B * 3] - ax, ey = positions[B * 3 + 1] - ay, ez = positions[B * 3 + 2] - az;
    const el = Math.hypot(ex, ey, ez);
    if (!(el > 0)) continue;
    ex /= el; ey /= el; ez /= el;
    const ca = canon[A];
    items.length = 0;
    let ux = 0, uy = 0, uz = 0, vx = 0, vy = 0, vz = 0, flat = -1;
    for (let s = s0; s < s1; s++) {
      const i = slot[s], t = i / 3 | 0, k = i % 3;
      if (degenerate[t]) continue;
      const C = tv(t, (k + 2) % 3);
      let dx = positions[C * 3] - ax, dy = positions[C * 3 + 1] - ay, dz = positions[C * 3 + 2] - az;
      const d = dx * ex + dy * ey + dz * ez;
      dx -= d * ex; dy -= d * ey; dz -= d * ez;
      const dl = Math.hypot(dx, dy, dz);
      if (!(dl > el * 1e-7)) { if (flat < 0) flat = t; else uf.uni(flat, t); continue; }   // (third corner on the edge: zero area)
      dx /= dl; dy /= dl; dz /= dl;
      if (items.length === 0) { ux = dx; uy = dy; uz = dz; vx = ey * uz - ez * uy; vy = ez * ux - ex * uz; vz = ex * uy - ey * ux; }
      let ang = Math.atan2(dx * vx + dy * vy + dz * vz, dx * ux + dy * uy + dz * uz);
      if (ang < 0) ang += Math.PI * 2;
      items.push({ t, ang, fwd: canon[tv(t, k)] === ca });
    }
    if (flat >= 0 && items.length) uf.uni(items[0].t, flat);
    if (items.length === 2) { uf.uni(items[0].t, items[1].t); continue; }
    if (items.length < 2) continue;
    // each b→a triangle takes the a→b triangle that comes next in the turning direction (never one at its own angle: a doubled
    // face is a wedge of nothing); what is left over joins nothing here
    const m = items.length, used = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
      if (used[i] || items[i].fwd) continue;
      let best = -1, bestD = Infinity;
      for (let q = 0; q < m; q++) {
        if (used[q] || !items[q].fwd) continue;
        let d = items[q].ang - items[i].ang; if (d <= 1e-9) d += Math.PI * 2;
        if (d < bestD && d < Math.PI * 2 - 1e-9) { bestD = d; best = q; }
      }
      if (best < 0) continue;
      used[i] = used[best] = 1;
      uf.uni(items[i].t, items[best].t);
    }
  }
  // T-junctions: open edges that leave one place in the same direction
  if (open.length > 1) {
    const at = new Map();                                            // place → corners of open edges starting there (either end)
    const add = (p, i) => { const l = at.get(p); if (l) { if (l.length < 16) l.push(i); } else at.set(p, [i]); };
    for (const i of open) { const t = i / 3 | 0, k = i % 3; add(canon[tv(t, k)], i); add(canon[tv(t, (k + 1) % 3)], ~i); }
    const dir = (i, out) => {
      const from = i >= 0 ? i : ~i, t = from / 3 | 0, k = from % 3;
      const P = i >= 0 ? tv(t, k) : tv(t, (k + 1) % 3), Q = i >= 0 ? tv(t, (k + 1) % 3) : tv(t, k);
      let x = positions[Q * 3] - positions[P * 3], y = positions[Q * 3 + 1] - positions[P * 3 + 1], z = positions[Q * 3 + 2] - positions[P * 3 + 2];
      const l = Math.hypot(x, y, z); if (l > 0) { x /= l; y /= l; z /= l; }
      out[0] = x; out[1] = y; out[2] = z; return t;
    };
    const da = [0, 0, 0], db = [0, 0, 0];
    for (const l of at.values()) {
      if (l.length < 2) continue;
      for (let i = 0; i < l.length; i++) {
        const ta = dir(l[i], da);
        for (let j = i + 1; j < l.length; j++) {
          const tb = dir(l[j], db);
          if (ta === tb) continue;
          if (da[0] * db[0] + da[1] * db[1] + da[2] * db[2] > 0.99999) uf.uni(ta, tb);
        }
      }
    }
  }
  // crumbs: a piece of one or two triangles left at a seam goes with a neighbour it shares an edge with
  const size = new Map();
  for (let t = 0; t < T; t++) { const r = uf.find(t); size.set(r, (size.get(r) || 0) + 1); }
  for (let e = 0; e < E; e++) {
    const s0 = start[e], s1 = start[e + 1];
    if (s1 - s0 < 2) continue;
    let keep = -1;
    for (let s = s0; s < s1; s++) { const t = slot[s] / 3 | 0; if (size.get(uf.find(t)) > 2) { keep = t; break; } }
    if (keep < 0) continue;
    for (let s = s0; s < s1; s++) { const t = slot[s] / 3 | 0; if (size.get(uf.find(t)) <= 2) uf.uni(keep, t); }
  }
  return uf.find;
}

function triNormals(positions, T, tv) {
  const n = new Float32Array(T * 3);
  for (let t = 0; t < T; t++) {
    const a = tv(t, 0) * 3, b = tv(t, 1) * 3, c = tv(t, 2) * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z);
    if (l > 0) { n[t * 3] = x / l; n[t * 3 + 1] = y / l; n[t * 3 + 2] = z / l; }
  }
  return n;
}

// triangles whose boxes share a grid cell. `only` (optional, a Uint8Array over the triangles) leaves the others out.
const MAX_CELLS = 128, MAX_SPAN = 24;
function bySpace(positions, T, tv, cellSize, only) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const side = Math.max(x1 - x0, y1 - y0, z1 - z0);
  // the grid is never finer than 1/MAX_CELLS of the mesh's longest side, and one triangle enters at most MAX_SPAN cells an axis
  let cell = cellSize > 0 ? cellSize : side / 1000;
  if (Number.isFinite(side) && side > 0) cell = Math.max(cell, side / MAX_CELLS);
  if (!(cell > 0)) cell = 1;
  const inv = 1 / cell, nx = Math.floor((x1 - x0) * inv) + 2, ny = Math.floor((y1 - y0) * inv) + 2, nz = Math.floor((z1 - z0) * inv) + 2;
  const uf = unionFind(T);
  const owner = new Map();
  for (let t = 0; t < T; t++) {
    if (only && !only[t]) continue;
    const a = tv(t, 0) * 3, b = tv(t, 1) * 3, c = tv(t, 2) * 3;
    const lx = Math.floor((Math.min(positions[a], positions[b], positions[c]) - x0) * inv), hx = Math.floor((Math.max(positions[a], positions[b], positions[c]) - x0) * inv);
    const ly = Math.floor((Math.min(positions[a + 1], positions[b + 1], positions[c + 1]) - y0) * inv), hy = Math.floor((Math.max(positions[a + 1], positions[b + 1], positions[c + 1]) - y0) * inv);
    const lz = Math.floor((Math.min(positions[a + 2], positions[b + 2], positions[c + 2]) - z0) * inv), hz = Math.floor((Math.max(positions[a + 2], positions[b + 2], positions[c + 2]) - z0) * inv);
    const sx = Math.max(1, Math.ceil((hx - lx + 1) / MAX_SPAN)), sy = Math.max(1, Math.ceil((hy - ly + 1) / MAX_SPAN)), sz = Math.max(1, Math.ceil((hz - lz + 1) / MAX_SPAN));
    for (let xi = lx; xi <= hx; xi += sx) for (let yi = ly; yi <= hy; yi += sy) for (let zi = lz; zi <= hz; zi += sz) {
      const key = (xi * ny + yi) * nz + zi;
      const o = owner.get(key);
      if (o === undefined) owner.set(key, t); else uf.uni(o, t);
    }
  }
  return uf.find;
}

// ── the partition ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function partition(positions, index, opts = {}) {
  const vCount = (positions.length / 3) | 0;
  const T = index ? (index.length / 3) | 0 : (vCount / 3) | 0;
  const result = { labels: new Int32Array(T), count: T ? 1 : 0, sizes: [T] };
  if (T < 2) return result;
  const tv = index ? (t, k) => index[t * 3 + k] : (t, k) => t * 3 + k;
  const method = opts.method || 'bodies';
  const epsAbs = +opts.epsAbs > 0 ? +opts.epsAbs : 0;
  let root;                                                   // triangle → a number that is the same for triangles of one piece
  if (method === 'material') {
    const tm = opts.triMat;                                   // the material of each triangle (facemat.js): one piece for each
    root = (t) => (tm ? tm[t] : 0);
  } else if (method === 'spatial') {
    root = bySpace(positions, T, tv, +opts.cellSize, null);
  } else {
    const { canon, N } = weld(positions, vCount, epsAbs, !!index);
    if (method === 'bodies') root = byBodies(positions, T, tv, canon, N);
    else if (method === 'edge') root = byEdges(T, tv, canon, N, () => true);
    else if (method === 'faces') {
      const nrm = triNormals(positions, T, tv);
      const cos = Math.cos(Math.max(0, +opts.faceAngle >= 0 ? +opts.faceAngle : 20) * Math.PI / 180);
      root = byEdges(T, tv, canon, N, (t, o) => nrm[t * 3] * nrm[o * 3] + nrm[t * 3 + 1] * nrm[o * 3 + 1] + nrm[t * 3 + 2] * nrm[o * 3 + 2] >= cos - 1e-9);
    } else {
      root = byVertex(T, tv, canon, N);
      if (method === 'hybrid') {
        // when one piece holds over half the triangles, cut that one up by proximity
        const size = new Map();
        for (let t = 0; t < T; t++) { const r = root(t); size.set(r, (size.get(r) || 0) + 1); }
        let big = -1, bigN = 0;
        for (const [r, n] of size) if (n > bigN) { big = r; bigN = n; }
        const vertexRoot = root;
        if (size.size <= 1 || bigN > T * 0.5) {
          const only = new Uint8Array(T);
          if (size.size <= 1) only.fill(1); else for (let t = 0; t < T; t++) if (vertexRoot(t) === big) only[t] = 1;
          const spatial = bySpace(positions, T, tv, +opts.cellSize, only);
          root = (t) => (only[t] ? 'S' + spatial(t) : vertexRoot(t));
        }
      }
    }
  }
  // consecutive numbers, in the order the pieces first appear
  const number = new Map();
  const labels = result.labels;
  const sizes = [];
  for (let t = 0; t < T; t++) {
    const r = root(t);
    let id = number.get(r);
    if (id === undefined) { id = sizes.length; number.set(r, id); sizes.push(0); }
    labels[t] = id; sizes[id]++;
  }
  let count = sizes.length;
  if (method === 'material') result.matOf = [...number.keys()];        // (the material each piece wears, in the order of the pieces)
  // pieces under minTriangles together make one more part (the largest piece is never one of them)
  const minT = Math.floor(+opts.minTriangles) || 0;
  if (minT > 1 && count > 1 && method !== 'material') {
    let largest = 0;
    for (let i = 1; i < count; i++) if (sizes[i] > sizes[largest]) largest = i;
    const small = sizes.map((n, i) => i !== largest && n < minT);
    if (small.some(Boolean)) {
      const to = new Int32Array(count).fill(-1);
      let next = 0, rest = -1;
      for (let i = 0; i < count; i++) {
        if (small[i]) { if (rest < 0) rest = next++; to[i] = rest; } else to[i] = next++;
      }
      const ns = new Array(next).fill(0);
      for (let t = 0; t < T; t++) { labels[t] = to[labels[t]]; ns[labels[t]]++; }
      count = next; result.sizes = ns; result.count = count;
      return result;
    }
  }
  result.count = count; result.sizes = sizes;
  return result;
}

// ── the geometries ───────────────────────────────────────────────────────────────────────────────────────────────────────
// One geometry per label, in label order, with every attribute of the original carried over (position, normal, uv, uv1, colour,
// tangent, …) and the material groups kept: a triangle stays with its material. `THREE` is passed in so this file needs no import.
export function buildChildGeometries(THREE, geom, labels, count) {
  const posAttr = geom.attributes.position;
  const vCount = posAttr.count;
  const index = geom.index ? geom.index.array : null;
  const T = labels.length;
  const tv = index ? (t, k) => index[t * 3 + k] : (t, k) => t * 3 + k;
  // triangles by label, in their original order (a counting sort)
  const start = new Int32Array(count + 1);
  for (let t = 0; t < T; t++) start[labels[t] + 1]++;
  for (let i = 0; i < count; i++) start[i + 1] += start[i];
  const fill = start.slice(0, count), order = new Int32Array(T);
  for (let t = 0; t < T; t++) order[fill[labels[t]]++] = t;
  // which material group each triangle is in (when there are several)
  const groups = geom.groups && geom.groups.length > 1 ? geom.groups : null;
  let groupOf = null;
  if (groups) {
    groupOf = new Int16Array(T).fill(-1);
    groups.forEach((g, gi) => { for (let t = (g.start / 3) | 0, e = Math.min(T, ((g.start + g.count) / 3) | 0); t < e; t++) groupOf[t] = gi; });
  }
  const names = Object.keys(geom.attributes).filter(n => geom.attributes[n] && geom.attributes[n].count === vCount);
  const src = names.map(n => {
    const a = geom.attributes[n];
    const direct = !a.isInterleavedBufferAttribute && a.array;
    return { name: n, a, size: a.itemSize, Type: direct ? a.array.constructor : Float32Array, direct, norm: !!a.normalized };
  });
  const remap = new Int32Array(vCount).fill(-1);
  const out = [];
  for (let L = 0; L < count; L++) {
    const from = start[L], to = start[L + 1];
    const tris = to - from;
    let list = order.subarray(from, to);
    if (groups) {                                      // the group of a triangle first, so each group is one run of the index
      const sorted = Array.from(list).sort((x, y) => (groupOf[x] - groupOf[y]) || (x - y));
      list = Int32Array.from(sorted);
    }
    const old = new Int32Array(Math.min(vCount, tris * 3));
    let nv = 0;
    const idx = new Uint32Array(tris * 3);
    for (let i = 0; i < tris; i++) {
      const t = list[i];
      for (let k = 0; k < 3; k++) {
        const v = tv(t, k);
        let n = remap[v];
        if (n < 0) { n = nv; remap[v] = n; old[nv++] = v; }
        idx[i * 3 + k] = n;
      }
    }
    const g = new THREE.BufferGeometry();
    for (const s of src) {
      const arr = new s.Type(nv * s.size);
      if (s.direct) { const sa = s.a.array; for (let i = 0; i < nv; i++) { const o = old[i] * s.size; for (let c = 0; c < s.size; c++) arr[i * s.size + c] = sa[o + c]; } }
      else for (let i = 0; i < nv; i++) for (let c = 0; c < s.size; c++) arr[i * s.size + c] = s.a.getComponent(old[i], c);
      g.setAttribute(s.name, new THREE.BufferAttribute(arr, s.size, s.norm));
    }
    for (let i = 0; i < nv; i++) remap[old[i]] = -1;   // (only what this piece touched is put back)
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? idx : Uint16Array.from(idx), 1));
    if (groups) {
      let run = 0;
      while (run < tris) {
        const gi = groupOf[list[run]]; let e = run;
        while (e < tris && groupOf[list[e]] === gi) e++;
        if (gi >= 0) g.addGroup(run * 3, (e - run) * 3, groups[gi].materialIndex);
        run = e;
      }
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}
