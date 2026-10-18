// meshfix.js — mending CAD meshes: close cracks, remove slivers, patch holes in curved surfaces.
//
// All three work on the mesh joined by position (CAD gives every face its own vertices) and give back an indexed mesh, joined.
//
//   closeCracks: where two faces of a CAD model were tessellated apart, their edges do not quite meet: a hairline gap, or a
//     vertex of one face lying on the middle of an edge of the other (a T-junction). Open edges are found; their ends that lie
//     within the tolerance of each other become one point, and an open edge with another face's open-edge vertex lying on it is
//     split there, so the two sides share their points and the surface is closed. Nothing is moved further than the tolerance.
//   removeSlivers: needle triangles (one edge far shorter than the others) have their short edge collapsed, and caps (one angle
//     near 180°) have their long edge flipped, as long as no triangle round them turns over or folds. The shape stays.
//   patchHoles: each opening (a loop of open edges) up to a size is closed with a patch: triangulated from its own corners,
//     refined to the length of the edges round it, and faired (its curvature made to run on from the surface round it, by
//     minimising the bending of the patch with the ring of faces round the hole held), so a hole in a curved face is closed
//     with the curve, not flat.
//
// Nothing here touches three.js or the page.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

function sizeOf(P) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
}

// Join vertices closer than tol (a grid of cells tol wide; neighbours looked at). Returns { V: [[x,y,z]...], F: [[a,b,c]...] }
// without triangles that have become a line or a point.
export function weld(positions, index, tol) {
  const P = positions, I = index || Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
  const cell = tol > 0 ? tol : 1e-9, grid = new Map(), V = [], map = new Int32Array(P.length / 3);
  for (let v = 0; v < P.length / 3; v++) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2], gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
      for (const id of grid.get((gx + dx) + ',' + (gy + dy) + ',' + (gz + dz)) || []) { const q = V[id]; if (Math.abs(q[0] - x) <= tol && Math.abs(q[1] - y) <= tol && Math.abs(q[2] - z) <= tol) { found = id; break; } }
    }
    if (found < 0) { found = V.length; V.push([x, y, z]); const k = gx + ',' + gy + ',' + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(found); }
    map[v] = found;
  }
  const F = [], T = [];                     // (T: the original triangle each one of F was, for a tool that knows them by number)
  for (let t = 0; t < I.length; t += 3) { const a = map[I[t]], b = map[I[t + 1]], c = map[I[t + 2]]; if (a !== b && b !== c && a !== c) { F.push([a, b, c]); T.push(t / 3); } }
  return { V, F, T };
}
// The mesh back as typed arrays, without unused vertices and without a triangle stored twice.
export function pack(V, F) {
  const used = new Int32Array(V.length).fill(-1), pos = [], idx = [], seen = new Set();
  for (const f of F) {
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) continue;
    const k = [f[0], f[1], f[2]].sort((a, b) => a - b).join(','); if (seen.has(k)) continue; seen.add(k);
    for (const v of f) { if (used[v] < 0) { used[v] = pos.length / 3; pos.push(V[v][0], V[v][1], V[v][2]); } idx.push(used[v]); }
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}
const ekey = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
function edgeMap(F) {
  const m = new Map();
  F.forEach((f, t) => { for (let k = 0; k < 3; k++) { const key = ekey(f[k], f[(k + 1) % 3]); let l = m.get(key); if (!l) m.set(key, l = []); l.push(t); } });
  return m;
}
// Open edges, each as [a, b] in the direction of its one triangle.
function openEdges(F, em) {
  const out = [];
  F.forEach((f, t) => { for (let k = 0; k < 3; k++) { const a = f[k], b = f[(k + 1) % 3]; if ((em.get(ekey(a, b)) || []).length === 1) out.push([a, b, t]); } });
  return out;
}
const distToSeg = (p, a, b) => { const ab = sub(b, a), l2 = dot(ab, ab) || 1e-30, t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)); return { d: len(sub(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]])), t }; };

// ── close cracks ────────────────────────────────────────────────────────────
// opts.tol: how far apart two sides of a crack may be (default a ten-thousandth of the part's size). Returns positions, index and
// { joined, split, openBefore, openAfter }.
export function closeCracks(positions, index, opts = {}) {
  const size = sizeOf(positions), tol = opts.tol > 0 ? opts.tol : size * 1e-4;
  const { V, F } = weld(positions, index, size * 1e-7);
  let em = edgeMap(F);
  const openBefore = openEdges(F, em).length;
  let joined = 0, split = 0;
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    // 1. open-edge ends within tol of each other become one (the nearer to the middle of the two kept)
    const open = openEdges(F, em), bv = [...new Set(open.flatMap(e => [e[0], e[1]]))];
    const grid = new Map(), cell = tol * 2, keyOf = (p) => Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell) + ',' + Math.floor(p[2] / cell);
    for (const v of bv) { const k = keyOf(V[v]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v); }
    const to = new Map();
    const root = (v) => { while (to.has(v)) v = to.get(v); return v; };
    for (const v of bv) {
      const p = V[v], gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell), gz = Math.floor(p[2] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const u of grid.get((gx + dx) + ',' + (gy + dy) + ',' + (gz + dz)) || []) {
        if (u <= v) continue;
        const a = root(v), b = root(u); if (a === b) continue;
        if (len(sub(V[a], V[b])) <= tol && !(em.get(ekey(a, b)))) { to.set(b, a); V[a] = [(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2]; joined++; changed = true; }
      }
    }
    if (to.size) { for (const f of F) for (let k = 0; k < 3; k++) f[k] = root(f[k]); for (let t = F.length - 1; t >= 0; t--) { const f = F[t]; if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) F.splice(t, 1); } em = edgeMap(F); }
    // 2. an open edge with another open edge's end lying on it is split there (a T-junction)
    const open2 = openEdges(F, em), ends = [...new Set(open2.flatMap(e => [e[0], e[1]]))];
    const g2 = new Map(), c2 = Math.max(tol * 4, size * 1e-3);
    for (const v of ends) { const p = V[v], k = Math.floor(p[0] / c2) + ',' + Math.floor(p[1] / c2) + ',' + Math.floor(p[2] / c2); if (!g2.has(k)) g2.set(k, []); g2.get(k).push(v); }
    const splits = new Map();                                     // triangle → [{ a, b, v, t }]
    for (const [a, b, t] of open2) {
      const A = V[a], B = V[b], lo = [Math.min(A[0], B[0]) - tol, Math.min(A[1], B[1]) - tol, Math.min(A[2], B[2]) - tol], hi = [Math.max(A[0], B[0]) + tol, Math.max(A[1], B[1]) + tol, Math.max(A[2], B[2]) + tol];
      const cand = [];
      for (let x = Math.floor(lo[0] / c2); x <= Math.floor(hi[0] / c2); x++) for (let y = Math.floor(lo[1] / c2); y <= Math.floor(hi[1] / c2); y++) for (let z = Math.floor(lo[2] / c2); z <= Math.floor(hi[2] / c2); z++) for (const v of g2.get(x + ',' + y + ',' + z) || []) {
        if (v === a || v === b) continue;
        const r = distToSeg(V[v], A, B); if (r.d <= tol && r.t > 1e-3 && r.t < 1 - 1e-3) cand.push({ v, t: r.t });
      }
      if (cand.length) { cand.sort((p, q) => p.t - q.t); splits.set(t, (splits.get(t) || []).concat([{ a, b, list: cand }])); }
    }
    if (splits.size) {
      for (const [t, list] of splits) {
        // split the triangle along each of its open edges that has points on it: a fan from the corner across
        let tris = [F[t].slice()];
        for (const { a, b, list: pts } of list) {
          const next = [];
          for (const f of tris) {
            const k = [0, 1, 2].find(i => f[i] === a && f[(i + 1) % 3] === b);
            if (k === undefined) { next.push(f); continue; }
            const c = f[(k + 2) % 3], chain = [a, ...pts.map(p => p.v), b];
            for (let i = 0; i + 1 < chain.length; i++) next.push([chain[i], chain[i + 1], c]);
            split += pts.length;
          }
          tris = next;
        }
        F[t] = tris[0]; for (let i = 1; i < tris.length; i++) F.push(tris[i]);
      }
      em = edgeMap(F); changed = true;
    }
    if (!changed) break;
  }
  const openAfter = openEdges(F, em).length;
  return { ...pack(V, F), joined, split, openBefore, openAfter, tol };
}

// ── remove slivers ──────────────────────────────────────────────────────────
// opts.ratio: a triangle whose shortest edge is under this share of its longest is a needle (default 0.04); opts.capDeg: one
// angle over this is a cap (default 170). Returns positions, index and { collapsed, flipped }.
export function removeSlivers(positions, index, opts = {}) {
  const size = sizeOf(positions), ratio = opts.ratio ?? 0.04, capCos = Math.cos((opts.capDeg ?? 170) * Math.PI / 180);
  const { V, F } = weld(positions, index, size * 1e-7);
  const alive = F.map(() => true);
  let collapsed = 0, flipped = 0;
  const nrm = (f) => cross(sub(V[f[1]], V[f[0]]), sub(V[f[2]], V[f[0]]));
  // The edge map and the triangles round each point are made once a pass. A triangle changed in a pass is touched: the rest of that
  // pass leaves alone anything that would read the map round it (the map is stale there), and the next pass takes it up again.
  for (let pass = 0; pass < (opts.passes ?? 20); pass++) {
    const em = edgeMap(F), vt = V.map(() => []), touched = new Uint8Array(F.length);
    const near = (...vs) => vs.some(v => vt[v].some(s => touched[s]));
    F.forEach((f, t) => { if (alive[t]) for (const v of f) vt[v].push(t); });
    // open edges and the vertices on them are not moved (an outline stays where it is)
    const onOpen = new Uint8Array(V.length);
    for (const [k, l] of em) if (l.filter(t => alive[t]).length === 1) { const [a, b] = k.split(',').map(Number); onOpen[a] = onOpen[b] = 1; }
    let changed = false;
    for (let t = 0; t < F.length; t++) {
      if (!alive[t]) continue;
      const f = F[t], e = [0, 1, 2].map(k => len(sub(V[f[(k + 1) % 3]], V[f[k]])));
      const mn = Math.min(...e), mx = Math.max(...e);
      if (!(mx > 0)) continue;
      if (mn < ratio * mx) {
        // a needle: collapse its short edge onto one end (the one on an outline, if one is), if nothing turns over
        const k = e.indexOf(mn), a = f[k], b = f[(k + 1) % 3];
        if (onOpen[a] && onOpen[b]) continue;
        if (touched[t] || near(a, b)) continue;
        const keep = onOpen[b] ? b : a, drop = keep === a ? b : a;
        const target = V[keep];
        let okc = true;
        for (const s of vt[drop]) {
          if (!alive[s] || F[s].includes(keep)) continue;
          const before = nrm(F[s]), g = F[s].map(v => (v === drop ? keep : v));
          const after = cross(sub(V[g[1]], V[g[0]]), sub(V[g[2]], V[g[0]]));
          if (dot(before, after) <= 0.2 * len(before) * len(after)) { okc = false; break; }
        }
        // (the two ends may share no other neighbour than the triangles on the edge: otherwise the surface would pinch)
        const nA = new Set(vt[drop].flatMap(s => alive[s] ? F[s] : [])), nB = new Set(vt[keep].flatMap(s => alive[s] ? F[s] : []));
        const shared = [...nA].filter(v => nB.has(v) && v !== drop && v !== keep).length;
        const onEdge = (em.get(ekey(a, b)) || []).filter(s => alive[s]).length;
        if (!okc || shared > onEdge) continue;
        for (const s of [...vt[drop], ...vt[keep]]) touched[s] = 1;
        for (const s of vt[drop]) { if (!alive[s]) continue; if (F[s].includes(keep)) { alive[s] = false; continue; } F[s] = F[s].map(v => (v === drop ? keep : v)); vt[keep].push(s); }
        vt[drop] = []; V[keep] = target; collapsed++; changed = true;
        continue;
      }
      // a cap: the corner across the long edge is (nearly) on it; the long edge is flipped
      const k = e.indexOf(mx), a = f[k], b = f[(k + 1) % 3], c = f[(k + 2) % 3];
      const ca = sub(V[a], V[c]), cb = sub(V[b], V[c]);
      if (dot(ca, cb) / (len(ca) * len(cb) || 1) > capCos) continue;
      const l = (em.get(ekey(a, b)) || []).filter(s => alive[s] && s !== t);
      if (l.length !== 1) continue;
      const u = l[0], d = F[u].find(v => v !== a && v !== b);
      if (touched[t] || touched[u] || d === undefined || near(a, b, c, d)) continue;
      if ((em.get(ekey(c, d)) || []).some(s => alive[s])) continue;
      const n1 = [c, a, d], n2 = [c, d, b], before = nrm(f);
      if (dot(nrm(n1), before) <= 0 || dot(nrm(n2), before) <= 0) continue;
      F[t] = n1; F[u] = n2; flipped++; changed = true;
      touched[t] = touched[u] = 1;
    }
    if (!changed) break;
  }
  const live = F.filter((_, t) => alive[t]);
  return { ...pack(V, live), collapsed, flipped };
}

// ── patch holes ─────────────────────────────────────────────────────────────
// opts.maxSize: the largest hole (across its loop) to close (default a tenth of the part's size); opts.fair: false closes them flat
// (no fairing). Returns positions, index and { patched, skipped }.
export function patchHoles(positions, index, opts = {}) {
  const size = sizeOf(positions), maxSize = opts.maxSize > 0 ? opts.maxSize : size * 0.1;
  const { V, F } = weld(positions, index, size * 1e-7);
  const em = edgeMap(F);
  const open = openEdges(F, em);
  // loops: open edges run the way of their triangle; the patch runs the other way
  const next = new Map(); for (const [a, b] of open) { if (!next.has(a)) next.set(a, []); next.get(a).push(b); }
  const loops = [];
  for (const [a0] of next) while (next.get(a0) && next.get(a0).length) {
    const loop = [a0]; let a = a0, guard = 0;
    for (;;) { const l = next.get(a); if (!l || !l.length) { loop.length = 0; break; } const b = l.pop(); if (b === a0) break; loop.push(b); a = b; if (++guard > 1e6) { loop.length = 0; break; } }
    if (loop.length >= 3) loops.push(loop);
  }
  const r = patchLoops(V, F, loops, { ...opts, maxSize });
  return { ...pack(V, F), patched: r.patched, skipped: r.skipped, holes: loops.length };
}
// Close the given loops of the joined mesh V, F (each a list of points, in the direction of the triangles round it, as patchHoles
// finds them) with patches, in place: the patches' triangles are added to F and their inner points to V. opts.maxSize (default:
// any size) and opts.fair as for patchHoles. Returns { patched, skipped, made: [{ loop, from, to }] }: the range of F each patch took.
export function patchLoops(V, F, loops, opts = {}) {
  const maxSize = opts.maxSize > 0 ? opts.maxSize : Infinity;
  let patched = 0, skipped = 0;
  const free = [], made = [];
  for (let li = 0; li < loops.length; li++) {
    const loop0 = loops[li], from = F.length;
    const loop = loop0.slice().reverse(), n = loop.length, pts = loop.map(v => V[v]);
    let span = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) span = Math.max(span, len(sub(pts[i], pts[j])));
    if (span > maxSize) { skipped++; continue; }
    // the loop's plane (Newell) and its corners in it
    let c = [0, 0, 0], nn = [0, 0, 0];
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; c = [c[0] + p[0] / n, c[1] + p[1] / n, c[2] + p[2] / n]; nn = [nn[0] + (p[1] - q[1]) * (p[2] + q[2]), nn[1] + (p[2] - q[2]) * (p[0] + q[0]), nn[2] + (p[0] - q[0]) * (p[1] + q[1])]; }
    const nl = len(nn);
    let tris = null, star = false;
    if (nl > 0) {
      const N = [nn[0] / nl, nn[1] / nl, nn[2] / nl], t1 = Math.abs(N[0]) < 0.9 ? [0, -N[2], N[1]] : [N[2], 0, -N[0]], e1 = t1.map(x => x / len(t1)), e2 = cross(N, e1);
      const uv = pts.map(p => [dot(sub(p, c), e1), dot(sub(p, c), e2)]);
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      star = uv.every((p, i) => cr([0, 0], p, uv[(i + 1) % n]) > 0);       // (every corner seen from the middle, in turn)
      const idx = [...Array(n).keys()]; tris = []; let guard = 0;
      while (idx.length > 3 && guard++ < n * n) {
        let cut = false;
        for (let k = 0; k < idx.length; k++) {
          const ia = idx[(k - 1 + idx.length) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
          if (cr(uv[ia], uv[ib], uv[ic]) <= 1e-14) continue;
          if (idx.some(m => m !== ia && m !== ib && m !== ic && cr(uv[ia], uv[ib], uv[m]) >= 0 && cr(uv[ib], uv[ic], uv[m]) >= 0 && cr(uv[ic], uv[ia], uv[m]) >= 0)) continue;
          tris.push([ia, ib, ic]); idx.splice(k, 1); cut = true; break;
        }
        if (!cut) { tris = null; break; }
      }
      if (tris && idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
    }
    let avg = 0; for (let i = 0; i < n; i++) avg += len(sub(pts[i], pts[(i + 1) % n])); avg /= n;
    // A hole that is star-shaped round its middle (most are) is closed with rings: copies of the rim shrunk towards the middle, about an
    // edge apart, zipped together, and a fan in the middle. That is an even mesh like the surface round it, which the fairing needs.
    if (star && opts.fair !== false) {
      let rmean = 0; for (const p of pts) rmean += len(sub(p, c)) / n;
      const K = Math.max(1, Math.min(40, Math.round(rmean / avg)));
      // the rim at even steps along it, as positions (for the inner rings)
      const per = []; let tot = 0; for (let i = 0; i < n; i++) { per.push(tot); tot += len(sub(pts[(i + 1) % n], pts[i])); }
      const at = (u) => { u = ((u % tot) + tot) % tot; let i = 0; while (i + 1 < n && per[i + 1] <= u) i++; const a = pts[i], b = pts[(i + 1) % n], l = len(sub(b, a)) || 1, t = (u - per[i]) / l; return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]; };
      const rings = [loop.slice()];
      for (let k = 1; k < K; k++) {
        const sc = 1 - k / K, m = Math.max(3, Math.round(n * sc)), ring = [];
        for (let i = 0; i < m; i++) { const p = at(tot * i / m); ring.push(V.length); V.push([c[0] + (p[0] - c[0]) * sc, c[1] + (p[1] - c[1]) * sc, c[2] + (p[2] - c[2]) * sc]); free.push(V.length - 1); }
        rings.push(ring);
      }
      const P = [];
      const zip = (A, B) => {                                     // A outside, B inside, both the cap's way round
        let j = 0, bd = Infinity; B.forEach((b, i) => { const d = len(sub(V[b], V[A[0]])); if (d < bd) { bd = d; j = i; } });
        let i = 0, si = 0, sj = 0;
        while (si < A.length || sj < B.length) {
          const a0 = A[i % A.length], a1 = A[(i + 1) % A.length], b0 = B[j % B.length], b1 = B[(j + 1) % B.length];
          const advA = sj >= B.length || (si < A.length && len(sub(V[a1], V[b0])) <= len(sub(V[a0], V[b1])));
          if (advA) { P.push([a0, a1, b0]); i++; si++; } else { P.push([a0, b1, b0]); j++; sj++; }
        }
      };
      for (let k = 1; k < rings.length; k++) zip(rings[k - 1], rings[k]);
      const mid = V.length; V.push(c.slice()); free.push(mid);
      const last = rings[rings.length - 1];
      for (let i = 0; i < last.length; i++) P.push([last[i], last[(i + 1) % last.length], mid]);
      for (const t of P) F.push(t);
      patched++; made.push({ loop: li, from, to: F.length });
      continue;
    }
    let base = loop.slice();
    if (!tris) {                                                  // (no plane to cut it in: a fan from its middle)
      const m = V.length; V.push(c.slice()); base.push(m);
      tris = loop.map((_, i) => [n, i, (i + 1) % n]);
    }
    // the patch as mesh triangles, its inner edges split until they are about as long as the edges round the hole
    let P = tris.map(t => t.map(i => base[i]));
    const rim = new Set(); for (let i = 0; i < n; i++) rim.add(ekey(loop[i], loop[(i + 1) % n]));
    for (let it = 0; it < 6 && opts.fair !== false; it++) {
      const pe = new Map(); P.forEach((f, t) => { for (let k = 0; k < 3; k++) { const key = ekey(f[k], f[(k + 1) % 3]); if (!rim.has(key)) { let l = pe.get(key); if (!l) pe.set(key, l = []); l.push(t); } } });
      let longest = null, ll = 1.4 * avg;
      for (const [key, l] of pe) { if (l.length !== 2) continue; const [a, b] = key.split(',').map(Number), d = len(sub(V[a], V[b])); if (d > ll) { ll = d; longest = { a, b, l }; } }
      if (!longest) break;
      // split every inner edge longer than 1.4× the rim's, the longest first (a pass at a time)
      const done = new Set(), list = [...pe].filter(([, l]) => l.length === 2).map(([key, l]) => { const [a, b] = key.split(',').map(Number); return { a, b, l, d: len(sub(V[a], V[b])) }; }).filter(e => e.d > 1.4 * avg).sort((x, y) => y.d - x.d);
      for (const e of list) {
        if (done.has(e.l[0]) || done.has(e.l[1])) continue;
        const m = V.length; V.push([(V[e.a][0] + V[e.b][0]) / 2, (V[e.a][1] + V[e.b][1]) / 2, (V[e.a][2] + V[e.b][2]) / 2]);
        for (const t of e.l) {
          const f = P[t], k = [0, 1, 2].find(i => (f[i] === e.a && f[(i + 1) % 3] === e.b) || (f[i] === e.b && f[(i + 1) % 3] === e.a));
          const x = f[k], y = f[(k + 1) % 3], z = f[(k + 2) % 3];
          P[t] = [x, m, z]; P.push([m, y, z]); done.add(t); done.add(P.length - 1);
        }
      }
    }
    for (const f of P) { F.push(f); for (const v of f) if (!loop.includes(v)) { free.push(v); } }
    patched++; made.push({ loop: li, from, to: F.length });
  }
  // fairing: the points inside the patches are placed where the bending of the surface (the sum of the squared Laplacians, over the
  // patch and the ring round it) is least, with the rim and the faces round the hole held where they are, so the curvature of the
  // surface runs on into the patch. A sparse least-squares problem, solved with conjugate gradients, x, y and z apart.
  if (opts.fair !== false && free.length) {
    const list = [...new Set(free)], col = new Int32Array(V.length).fill(-1); list.forEach((v, i) => { col[v] = i; });
    const nb = V.map(() => new Set()); for (const f of F) for (let k = 0; k < 3; k++) { nb[f[k]].add(f[(k + 1) % 3]); nb[f[k]].add(f[(k + 2) % 3]); }
    const rows = new Set(list); for (const v of list) for (const u of nb[v]) rows.add(u);
    const R = [...rows];
    // (Lx)_r = the neighbours' mean, each weighted by one over its distance (so the spacing counts), less x_r
    const W = new Map();
    for (const r of R) { const w = []; let sum = 0; for (const u of nb[r]) { const d = 1 / (len(sub(V[u], V[r])) || 1e-9); w.push([u, d]); sum += d; } W.set(r, w.map(([u, d]) => [u, d / sum])); }
    const Lrow = (r, get) => { let s = 0; for (const [u, w] of W.get(r)) s += w * get(u); return s - get(r); };
    const LtL = (get) => {                                        // Lᵀ(L·) on the free coordinates
      const out = new Float64Array(list.length);
      for (const r of R) {
        const lr = Lrow(r, get);
        if (col[r] >= 0) out[col[r]] -= lr;
        for (const [u, w] of W.get(r)) if (col[u] >= 0) out[col[u]] += lr * w;
      }
      return out;
    };
    for (let k = 0; k < 3; k++) {
      const held = (u) => (col[u] >= 0 ? 0 : V[u][k]);
      const b = LtL(held).map(x => -x);                           // A y = b, A = LᵀL on the free ones
      let y = Float64Array.from(list, v => V[v][k]);
      const Ay = (yy) => LtL((u) => (col[u] >= 0 ? yy[col[u]] : 0));
      let r = Ay(y).map((x, i) => b[i] - x), p = r.slice(), rr = r.reduce((s, x) => s + x * x, 0);
      for (let it = 0; it < 4 * list.length + 50 && rr > 1e-20; it++) {
        const Ap = Ay(p), pAp = p.reduce((s, x, i) => s + x * Ap[i], 0);
        if (!(Math.abs(pAp) > 1e-30)) break;
        const al = rr / pAp;
        for (let i = 0; i < y.length; i++) { y[i] += al * p[i]; r[i] -= al * Ap[i]; }
        const rr2 = r.reduce((s, x) => s + x * x, 0);
        const be = rr2 / rr; rr = rr2;
        for (let i = 0; i < p.length; i++) p[i] = r[i] + be * p[i];
      }
      list.forEach((v, i) => { V[v][k] = y[i]; });
    }
  }
  return { patched, skipped, made };
}
