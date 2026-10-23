// pipegrid.js — fewer rings and fewer lines on the round faces of a CAD part that are clean grids: pipes, hoses, bent rods.
//
// A CAD mesher cuts a cylinder or a torus (the bend of a pipe) into a grid: rings across it, lines along it, a quad between each two
// (two triangles). Taking points out of such a grid one by one (roundfaces.js) pulls the rings out of line and leaves long slivers and
// crumpled bends. A person would take out whole rings and whole lines: the grid stays a grid, every quad stays a quad. This does that,
// before roundfaces.js runs, on every face where it can be sure of the grid:
//
//   Rings. A face with two outlines (a ring at each end) is read layer by layer from one end: every layer must be a closed ring of the
//   same number of points, the last one the other end, and every point joined to the one before it. Its two end rings stay (the
//   neighbouring faces share them), and of the rings between as many stay as the bend needs: enough that the facets along the bend
//   are no further than the deviation from the true torus, and at least `segments` for a whole turn (a quarter bend at 12 keeps 3).
//   A straight face (a cylinder or a cone) keeps its two ends only.
//   Lines. The grid faces that share rings are one tube. Its lines run on through every face (joined where the faces meet); as many of
//   them stay as the deviation and `segments` ask for, evenly round, and every face of the tube loses the same ones, so the rings
//   still match where the faces meet. The flat faces at the ends of a tube (a disc, or the ring between the inner and the outer wall)
//   are joined up again round the points that are left. When anything round a tube is not a grid or a plain end, its lines stay.
//
// Nothing is moved: every point that is left is a point of the input, with its own normal, so the shading is as before. Faces that
// are not clean grids are left exactly as they were for roundfaces.js. Returns the new triangles grouped by face, the CAD record with
// the new ranges and the edge polylines without the points that went, and the places (point positions) it rebuilt, which
// roundfaces.js must leave alone.
//
//   positions   Float32Array xyz;  index   the triangles
//   opts.cad    { faces: [[kind, firstTri, triCount, area, ...radii]], rows, pts }  (kind 0 plane, 1 cylinder, 2 cone, 4 torus)
//   opts.tolerance, opts.segments  as roundfaces.js
// Returns { changed: false } or { changed: true, index, cad, lockedKeys: Set, rings, lines, before, after }.

export function rebuildPipeGrids(positions, index, opts = {}) {
  const cad = opts.cad;
  if (!cad || !cad.faces || !cad.faces.length) return { changed: false };
  const P = positions, T0 = (index.length / 3) | 0, V = (P.length / 3) | 0;
  const faces = cad.faces, nF = faces.length;
  const segments = +opts.segments > 2 ? +opts.segments : 12;

  // places: vertices joined by position (a CAD mesh keeps every point once per face)
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (!(diag > 0)) return { changed: false };
  const tol = +opts.tolerance > 0 ? +opts.tolerance : diag * 1e-3;
  const inv = 1 / (diag * 1e-6);
  const keyAt = (x, y, z) => Math.round((x - x0) * inv) + ',' + Math.round((y - y0) * inv) + ',' + Math.round((z - z0) * inv);
  const place = new Int32Array(V), table = new Map(), rep = [];
  for (let v = 0; v < V; v++) { const k = keyAt(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); let c = table.get(k); if (c === undefined) { c = rep.length; table.set(k, c); rep.push(v); } place[v] = c; }
  const nP = rep.length;
  const pos = (c) => [P[rep[c] * 3], P[rep[c] * 3 + 1], P[rep[c] * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const dist = (a, b) => len(sub(pos(a), pos(b)));

  // the triangles of each face (a triangle outside every face is left as it is)
  const fOf = new Int32Array(T0).fill(-1);
  for (let f = 0; f < nF; f++) { const [, s, c] = faces[f]; for (let t = s; t < s + c && t < T0; t++) fOf[t] = f; }
  const trisOf = Array.from({ length: nF }, () => []);
  for (let t = 0; t < T0; t++) if (fOf[t] >= 0) trisOf[fOf[t]].push(t);
  const vertAt = new Map();                                       // face * nP + place → the face's own vertex there
  for (let t = 0; t < T0; t++) { const f = fOf[t]; if (f < 0) continue; for (let k = 0; k < 3; k++) { const v = index[t * 3 + k], key = f * nP + place[v]; if (!vertAt.has(key)) vertAt.set(key, v); } }
  const cornersOf = (t) => [place[index[t * 3]], place[index[t * 3 + 1]], place[index[t * 3 + 2]]];

  // the edges of a face: adjacency, and the outline (edges with one triangle)
  const edgesOf = (f) => {
    const cnt = new Map(), adj = new Map();
    const add = (a, b) => { let s = adj.get(a); if (!s) adj.set(a, s = new Set()); s.add(b); };
    for (const t of trisOf[f]) {
      const c = cornersOf(t);
      if (c[0] === c[1] || c[1] === c[2] || c[0] === c[2]) return null;      // (a triangle with two corners at one place: not a clean grid)
      for (let k = 0; k < 3; k++) { const a = c[k], b = c[(k + 1) % 3], key = a < b ? a * nP + b : b * nP + a; cnt.set(key, (cnt.get(key) || 0) + 1); add(a, b); add(b, a); }
    }
    const outline = new Map();
    for (const [key, n] of cnt) {
      if (n > 2) return null;
      if (n === 1) { const a = Math.floor(key / nP), b = key % nP; let s = outline.get(a); if (!s) outline.set(a, s = []); s.push(b); s = outline.get(b); if (!s) outline.set(b, s = []); s.push(a); }
    }
    return { adj, outline };
  };
  // closed loops of an outline (every point on it with two outline neighbours)
  const loopsOf = (outline) => {
    for (const [, s] of outline) if (s.length !== 2) return null;
    const seen = new Set(), loops = [];
    for (const [start] of outline) {
      if (seen.has(start)) continue;
      const loop = [start]; seen.add(start);
      let prev = start, cur = outline.get(start)[0];
      while (cur !== start) { if (seen.has(cur)) return null; loop.push(cur); seen.add(cur); const nx = outline.get(cur); const next = nx[0] === prev ? nx[1] : nx[0]; prev = cur; cur = next; }
      loops.push(loop);
    }
    return loops;
  };

  // ── the grid of a round face: rings[k][j] (places), or null ─────────────────────────────────────────────────────────
  const gridOf = (f) => {
    const e = edgesOf(f); if (!e) return null;
    const loops = loopsOf(e.outline); if (!loops || loops.length !== 2 || loops[0].length !== loops[1].length) return null;
    const n = loops[0].length; if (n < 3) return null;
    const depth = new Map(); for (const p of loops[0]) depth.set(p, 0);
    let front = loops[0], d = 0;
    const layers = [loops[0].slice()];
    while (front.length) {
      const next = [];
      for (const p of front) for (const q of e.adj.get(p) || []) if (!depth.has(q)) { depth.set(q, d + 1); next.push(q); }
      if (!next.length) break;
      d++; layers.push(next); front = next;
    }
    if (depth.size !== e.adj.size) return null;
    const L = layers.length - 1;
    if (L < 1 || layers.some(l => l.length !== n)) return null;
    const endSet = new Set(loops[1]); if (!layers[L].every(p => endSet.has(p))) return null;
    // each layer a closed ring, walked in the same direction as the one before
    const ring = (layer) => { const S = new Set(layer), nb = new Map(); for (const p of layer) { const s = [...(e.adj.get(p) || [])].filter(q => S.has(q)); if (s.length !== 2) return null; nb.set(p, s); } return nb; };
    const rings = [loops[0]];
    for (let k = 1; k <= L; k++) {
      const nb = ring(layers[k]); if (!nb) return null;
      const prev = rings[k - 1];
      const near = (p) => { let best = -1, bd = Infinity; for (const q of e.adj.get(p) || []) if (depth.get(q) === k) { const dd = dist(p, q); if (dd < bd) { bd = dd; best = q; } } return best; };
      const s0 = near(prev[0]), s1 = near(prev[1]); if (s0 < 0 || s1 < 0) return null;
      const [a, b] = nb.get(s0);
      const dir = a === s1 ? a : b === s1 ? b : (dist(a, s1) < dist(b, s1) ? a : b);
      const out = [s0]; let pr = s0, cur = dir;
      while (cur !== s0) { if (out.length > n) return null; out.push(cur); const nx = nb.get(cur); const nxt = nx[0] === pr ? nx[1] : nx[0]; pr = cur; cur = nxt; }
      if (out.length !== n) return null;
      rings.push(out);
    }
    for (let k = 0; k < L; k++) for (let j = 0; j < n; j++) if (!e.adj.get(rings[k][j]).has(rings[k + 1][j])) return null;      // (a grid: each point joined to the one across)
    if (trisOf[f].length !== 2 * n * L) return null;                                                                          // (and nothing else in the face)
    // which way round the face's triangles go: the one on the edge rings[0][0] → rings[0][1]
    let sign = 0;
    for (const t of trisOf[f]) { const c = cornersOf(t); const i = c.indexOf(rings[0][0]), jj = c.indexOf(rings[0][1]); if (i < 0 || jj < 0) continue; sign = (i + 1) % 3 === jj ? 1 : -1; break; }
    if (!sign) return null;
    return { f, n, L, rings, sign };
  };

  const grids = new Map();
  for (let f = 0; f < nF; f++) { const k = faces[f][0]; if (k === 1 || k === 2 || k === 4) { const g = gridOf(f); if (g) grids.set(f, g); } }
  if (!grids.size) return { changed: false };

  // ── rings: how many each face keeps ──────────────────────────────────────────────────────────────────────────────────
  const ringNormal = (r) => { let nx = 0, ny = 0, nz = 0; const m = r.length; for (let i = 0; i < m; i++) { const a = pos(r[i]), b = pos(r[(i + 1) % m]); nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); } const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };
  let ringsOut = 0;
  for (const g of grids.values()) {
    const kind = faces[g.f][0];
    let t = 1;
    if (kind === 4) {
      const n0 = ringNormal(g.rings[0]), n1 = ringNormal(g.rings[g.L]);
      const phi = Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(n0, n1)))));          // the angle of the bend
      const R = +faces[g.f][4] || 0, r = +faces[g.f][5] || 0, outer = R + r;
      const step = outer > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / outer)) : Math.PI;
      t = Math.max(1, Math.ceil(segments * phi / (2 * Math.PI) - 1e-9), Math.ceil(phi / step - 1e-9));
    }
    t = Math.min(t, g.L);
    const keep = []; for (let i = 0; i <= t; i++) keep.push(Math.round(i * g.L / t));
    g.keepRings = [...new Set(keep)];
    ringsOut += g.L + 1 - g.keepRings.length;
  }

  // ── lines: the tubes (grid faces joined by a ring), their lines, and how many stay ──────────────────────────────────
  const parent = new Int32Array(nP).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (const g of grids.values()) for (let j = 0; j < g.n; j++) for (let k = 1; k <= g.L; k++) unite(g.rings[0][j], g.rings[k][j]);
  const ringKey = (r) => [...r].sort((a, b) => a - b).join(',');
  const byRing = new Map();
  const fParent = new Map(); for (const f of grids.keys()) fParent.set(f, f);
  const ffind = (a) => { while (fParent.get(a) !== a) a = fParent.get(a); return a; };
  for (const g of grids.values()) for (const r of [g.rings[0], g.rings[g.L]]) { const k = ringKey(r); const o = byRing.get(k); if (o === undefined) byRing.set(k, g.f); else { const a = ffind(o), b = ffind(g.f); if (a !== b) fParent.set(a, b); } }
  const tubes = new Map();
  for (const f of grids.keys()) { const r = ffind(f); let l = tubes.get(r); if (!l) tubes.set(r, l = []); l.push(f); }
  const keptPlace = new Map();                                   // place on a tube's rings → kept or not
  const ringPlaces = new Set(); for (const g of grids.values()) for (const r of g.rings) for (const p of r) ringPlaces.add(p);
  let linesOut = 0;
  const planeOf = new Map(); for (let f = 0; f < nF; f++) if (faces[f][0] === 0) for (const t of trisOf[f]) for (const c of cornersOf(t)) { let s = planeOf.get(c); if (!s) planeOf.set(c, s = new Set()); s.add(f); }
  const capsToRedo = new Set();
  for (const fl of tubes.values()) {
    const gs = fl.map(f => grids.get(f)), n = gs[0].n;
    if (gs.some(g => g.n !== n)) continue;
    const ref = gs[0].rings[0], cls = ref.map(p => find(p));
    const clsSet = new Set(cls); if (clsSet.size !== n) continue;
    if (gs.some(g => g.rings.some(r => r.some(p => !clsSet.has(find(p)))))) continue;      // (every ring of the tube on the same n lines)
    let rMax = 0; for (const g of gs) rMax = Math.max(rMax, faces[g.f][0] === 4 ? +faces[g.f][5] || 0 : +faces[g.f][4] || 0);
    const need = rMax > tol ? Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tol / rMax)) - 1e-9) : 3;
    const m = Math.min(n, Math.max(segments, need, 3));
    if (m >= n) continue;
    const keepCls = new Set(); for (let i = 0; i < m; i++) keepCls.add(cls[Math.round(i * n / m) % n]);
    // the faces round the tube that are not part of it must be plain ends (planes whose outline is made of tube rings only)
    const tubePlaces = new Set(); for (const g of gs) for (const r of g.rings) for (const p of r) tubePlaces.add(p);
    const touching = new Set(); let ok = true;
    for (let f = 0; f < nF && ok; f++) {
      if (fl.includes(f)) continue;
      let hit = false; for (const t of trisOf[f]) { if (cornersOf(t).some(c => tubePlaces.has(c))) { hit = true; break; } }
      if (!hit) continue;
      // a plain end (a plane: a disc, or the ring between the inner and the outer wall) or a band (a cylinder or a cone that is not a
      // clean grid, often one ring a point short of the other): one or two outlines and no point inside, joined up again round what is left
      const kf = faces[f][0];
      if (kf !== 0 && kf !== 1 && kf !== 2) { ok = false; break; }
      const e = edgesOf(f); const loops = e && loopsOf(e.outline);
      if (!loops || loops.length > 2 || (kf !== 0 && loops.length !== 2)) { ok = false; break; }
      if (kf === 0 && loops.some(l => l.some(p => !ringPlaces.has(p)))) { ok = false; break; }
      if (trisOf[f].some(t => cornersOf(t).some(c => !e.outline.has(c)))) { ok = false; break; }   // (no points inside: only its outlines)
      touching.add(f);
    }
    if (!ok) continue;
    for (const p of tubePlaces) keptPlace.set(p, keepCls.has(find(p)));
    for (const f of touching) capsToRedo.add(f);
    for (const g of gs) g.keepCols = g.rings[0].map((p, j) => keepCls.has(find(p)) ? j : -1).filter(j => j >= 0);
    linesOut += n - m;
  }
  if (!ringsOut && !linesOut) return { changed: false };

  // ── the new triangles ──────────────────────────────────────────────────────────────────────────────────────────────
  const out = Array.from({ length: nF }, () => []);              // per face: [v, v, v] vertex triples
  const lockedPlaces = new Set();
  for (let f = 0; f < nF; f++) {
    const g = grids.get(f);
    if (g) {
      const cols = g.keepCols || g.rings[0].map((_, j) => j), rk = g.keepRings;
      const V3 = (p) => vertAt.get(f * nP + p);
      for (let a = 0; a + 1 < rk.length; a++) {
        const r0 = g.rings[rk[a]], r1 = g.rings[rk[a + 1]];
        for (let i = 0; i < cols.length; i++) {
          const j = cols[i], j2 = cols[(i + 1) % cols.length];
          const A = V3(r0[j]), B = V3(r0[j2]), C = V3(r1[j2]), D = V3(r1[j]);
          if (g.sign > 0) out[f].push([A, B, C], [A, C, D]); else out[f].push([A, C, B], [A, D, C]);
        }
      }
      for (const r of g.rings) for (const p of r) lockedPlaces.add(p);
      continue;
    }
    if (capsToRedo.has(f)) {
      const e = edgesOf(f), loops = loopsOf(e.outline).map(l => l.filter(p => keptPlace.get(p) !== false));
      const V3 = (p) => vertAt.get(f * nP + p);
      const centroid = (l) => { const c = [0, 0, 0]; for (const p of l) { const q = pos(p); c[0] += q[0] / l.length; c[1] += q[1] / l.length; c[2] += q[2] / l.length; } return c; };
      const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
      const isPlane = faces[f][0] === 0;
      // the axis the loops go round: the plane's normal (the summed normal of its triangles), or, for a band, the line between the
      // middles of its two rings; and which way the triangles face (for a band: out from the axis or in, as the face's own do)
      let N = [0, 0, 0]; for (const t of trisOf[f]) { const c = cornersOf(t); const nn = cross(sub(pos(c[1]), pos(c[0])), sub(pos(c[2]), pos(c[0]))); N = [N[0] + nn[0], N[1] + nn[1], N[2] + nn[2]]; }
      const c0 = centroid(loops[0]), c1 = loops.length > 1 ? centroid(loops[1]) : c0;
      const axis = isPlane || len(sub(c1, c0)) < 1e-9 ? unit(N) : unit(sub(c1, c0));
      const radial = (q) => { const d = sub(q, c0), a = dot(d, axis); return [d[0] - a * axis[0], d[1] - a * axis[1], d[2] - a * axis[2]]; };
      let side = 1;
      if (!isPlane) { const t = trisOf[f][0], c = cornersOf(t), m = centroid(c); side = dot(cross(sub(pos(c[1]), pos(c[0])), sub(pos(c[2]), pos(c[0]))), radial(m)) >= 0 ? 1 : -1; }
      const faceOk = (a, b, c) => { const nn = cross(sub(pos(b), pos(a)), sub(pos(c), pos(a))); return isPlane ? dot(nn, N) >= 0 : dot(nn, radial(centroid([a, b, c]))) * side >= 0; };
      const tri = (a, b, c) => out[f].push(faceOk(a, b, c) ? [V3(a), V3(b), V3(c)] : [V3(a), V3(c), V3(b)]);
      if (loops.length === 1) { const l = loops[0]; for (let i = 1; i + 1 < l.length; i++) tri(l[0], l[i], l[i + 1]); }
      else {
        // two loops: both sorted by angle round the axis (each round its own middle, for a band), then zipped
        let u = cross(axis, [1, 0, 0]); if (len(u) < 0.1) u = cross(axis, [0, 1, 0]); u = unit(u); const w = cross(axis, u);
        const ctrOf = (l) => isPlane ? centroid(loops[0].concat(loops[1])) : centroid(l);
        const [A, B] = loops.map(l => { const ctr = ctrOf(l); return l.map(p => { const d = sub(pos(p), ctr); return { p, a: Math.atan2(dot(d, w), dot(d, u)) }; }).sort((x, y) => x.a - y.a); });
        // start both at the smallest angle; walk once round, always moving the loop whose next point comes first
        let i = 0, j = 0;
        const nA = A.length, nB = B.length;
        while (i < nA || j < nB) {
          const aNext = i < nA ? (i + 1 < nA ? A[i + 1].a : A[0].a + 2 * Math.PI) : Infinity;
          const bNext = j < nB ? (j + 1 < nB ? B[j + 1].a : B[0].a + 2 * Math.PI) : Infinity;
          if (aNext <= bNext) { tri(A[i % nA].p, A[(i + 1) % nA].p, B[j % nB].p); i++; }
          else { tri(B[j % nB].p, B[(j + 1) % nB].p, A[i % nA].p); j++; }
        }
      }
      for (const l of loops) for (const p of l) lockedPlaces.add(p);
      continue;
    }
    for (const t of trisOf[f]) out[f].push([index[t * 3], index[t * 3 + 1], index[t * 3 + 2]]);
  }
  // triangles outside every face, after the faces
  const loose = []; for (let t = 0; t < T0; t++) if (fOf[t] < 0) loose.push([index[t * 3], index[t * 3 + 1], index[t * 3 + 2]]);

  const total = out.reduce((s, l) => s + l.length, 0) + loose.length;
  const newIndex = new Uint32Array(total * 3);
  const newFaces = faces.map((f) => [f[0], 0, 0, 0, ...f.slice(4)]);
  let at = 0;
  const areaOf = (tr) => { const a = tr[0] * 3, b = tr[1] * 3, c = tr[2] * 3; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]; return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; };
  for (let f = 0; f < nF; f++) {
    newFaces[f][1] = at; newFaces[f][2] = out[f].length;
    let ar = 0; for (const tr of out[f]) { newIndex.set(tr, at * 3); at++; ar += areaOf(tr); }
    newFaces[f][3] = +ar.toFixed(6);
  }
  for (const tr of loose) { newIndex.set(tr, at * 3); at++; }
  // the edge polylines without the points that went (a ring's polyline loses the same points as the ring)
  const used = new Uint8Array(nP); for (let i = 0; i < newIndex.length; i++) used[place[newIndex[i]]] = 1;
  const pts = cad.pts || new Float32Array(0), rows = cad.rows || [];
  const keptPts = [], newRows = [];
  for (const r of rows) {
    const first = keptPts.length / 3; let m = 0;
    const atPt = (k) => { const o = (r[0] + k) * 3; return [pts[o], pts[o + 1], pts[o + 2]]; };
    const closed = r[1] > 2 && keyAt(...atPt(0)) === keyAt(...atPt(r[1] - 1));
    const last = closed ? r[1] - 1 : r[1];
    for (let k = 0; k < last; k++) {
      const [x, y, z] = atPt(k), c = table.get(keyAt(x, y, z));
      if (c !== undefined && !used[c] && (closed || (k !== 0 && k !== r[1] - 1))) continue;
      keptPts.push(x, y, z); m++;
    }
    if (closed && m >= 3) { keptPts.push(keptPts[first * 3], keptPts[first * 3 + 1], keptPts[first * 3 + 2]); m++; }
    if (m >= 2) newRows.push([first, m, r[2], r[3], r[4]]); else keptPts.length = first * 3;
  }
  const lockedKeys = new Set(); for (const p of lockedPlaces) if (used[p]) { const [x, y, z] = pos(p); lockedKeys.add(keyAt(x, y, z)); }
  return { changed: true, index: newIndex, cad: { faces: newFaces, rows: newRows, pts: Float32Array.from(keptPts) }, lockedKeys,
           rings: ringsOut, lines: linesOut, before: T0, after: total };
}
