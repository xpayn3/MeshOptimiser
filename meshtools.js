// meshtools.js — the work of Edit mesh's Planarize, Straighten, Weld, Fill and Extract, as functions on a read mesh (meshedit.js: a
// topology `topo` with its polygons `pg`). They work out what should change and leave the doing to the app (which writes positions,
// takes triangles out, puts new ones in and makes the undo step), so they run in Node for the tests.
//
// A "point" here is a welded point of topo (corners at one place are one point); topo.positions has the raw vertices, topo.rep[w] one
// raw vertex that stands on point w, topo.weld[raw] the point a raw vertex stands on.

import { reduceCollinear, restoreDropped } from './dissolve.js?v=3';

const at = (topo, w, out = [0, 0, 0]) => { const r = topo.rep[w] * 3, p = topo.positions; out[0] = p[r]; out[1] = p[r + 1]; out[2] = p[r + 2]; return out; };
const cornerOf = (topo, t, k) => (topo.index ? topo.index[t * 3 + k] : t * 3 + k);          // the raw vertex at corner k of triangle t

function sizeOf(topo) {
  const p = topo.positions; let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < p.length; i += 3) { if (p[i] < mnx) mnx = p[i]; if (p[i] > mxx) mxx = p[i]; if (p[i + 1] < mny) mny = p[i + 1]; if (p[i + 1] > mxy) mxy = p[i + 1]; if (p[i + 2] < mnz) mnz = p[i + 2]; if (p[i + 2] > mxz) mxz = p[i + 2]; }
  return p.length ? Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) : 0;
}

// ── Planarize ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Each picked polygon is made flat: its points move onto the best-fit plane of its triangles. A point that belongs to several picked
// polygons goes to the average of where each wants it, and the round is repeated a few times, so polygons that share edges settle
// together. A polygon whose points would have to move further than `maxMove` (default 5% of the part's size: it is curved, not noisy)
// is left as it is and counted. Returns { targets: Map point → [x, y, z], polygons, skipped, maxMove (how far the furthest point goes) }.
export function planarize(topo, pg, faces, opts = {}) {
  const iterations = opts.iterations > 0 ? opts.iterations : 4, limit = opts.maxMove > 0 ? opts.maxMove : sizeOf(topo) * 0.05;
  const groupCos = Math.cos((opts.groupAngle > 0 ? opts.groupAngle : 10) * Math.PI / 180);
  const cur = new Map(), orig = new Map();
  // Picked polygons that touch and face nearly the same way (a panel cut into cells) are one flat piece and go onto one plane; a polygon
  // on its own, or one that turns away from its neighbours (the side of a box), gets a plane of its own.
  const normalOf = (q) => {
    let nx = 0, ny = 0, nz = 0;
    for (let i = pg.pStart[q]; i < pg.pStart[q + 1]; i++) {
      const t = pg.pTris[i], a = at(topo, topo.tri[t * 3]), b = at(topo, topo.tri[t * 3 + 1]), c = at(topo, topo.tri[t * 3 + 2]);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx;
    }
    const l = Math.hypot(nx, ny, nz); return l > 0 ? [nx / l, ny / l, nz / l] : null;
  };
  const pick = new Set(faces), nrm = new Map(), uf = new Map();
  for (const q of pick) { nrm.set(q, normalOf(q)); uf.set(q, q); }
  const find = (x) => { while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x))); x = uf.get(x); } return x; };
  for (const q of pick) {
    const nq = nrm.get(q); if (!nq) continue;
    for (let i = pg.pStart[q]; i < pg.pStart[q + 1]; i++) {
      const t = pg.pTris[i];
      for (let k = 0; k < 3; k++) {
        const e = topo.triE[t * 3 + k], o = topo.edgeT[e * 2] === t ? topo.edgeT[e * 2 + 1] : topo.edgeT[e * 2];
        if (o < 0) continue;
        const r = pg.polyOf[o]; if (r === q || !pick.has(r)) continue;
        const nr = nrm.get(r); if (!nr) continue;
        if (nq[0] * nr[0] + nq[1] * nr[1] + nq[2] * nr[2] >= groupCos) { const a = find(q), b = find(r); if (a !== b) uf.set(a, b); }
      }
    }
  }
  const byRoot = new Map();
  for (const q of pick) { const r = find(q); let g = byRoot.get(r); if (!g) byRoot.set(r, g = []); g.push(q); }
  const polys = [];                                                  // (each one a flat piece: { qs: its polygons, pts: its points })
  for (const qs of byRoot.values()) {
    const pts = new Set();
    for (const q of qs) for (let i = pg.pStart[q]; i < pg.pStart[q + 1]; i++) { const t = pg.pTris[i]; for (let k = 0; k < 3; k++) pts.add(topo.tri[t * 3 + k]); }
    if (pts.size < 4) continue;                                     // (a triangle is flat already)
    polys.push({ q: qs[0], qs, pts: [...pts] });
    for (const w of pts) if (!cur.has(w)) { cur.set(w, at(topo, w)); orig.set(w, at(topo, w)); }
  }
  const fit = (poly) => {                                           // the plane of a piece at the moment: its centre and unit normal
    let nx = 0, ny = 0, nz = 0;
    for (const q of poly.qs) for (let i = pg.pStart[q]; i < pg.pStart[q + 1]; i++) {
      const t = pg.pTris[i], a = cur.get(topo.tri[t * 3]) || at(topo, topo.tri[t * 3]), b = cur.get(topo.tri[t * 3 + 1]) || at(topo, topo.tri[t * 3 + 1]), c = cur.get(topo.tri[t * 3 + 2]) || at(topo, topo.tri[t * 3 + 2]);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx;
    }
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 0)) return null;
    let cx = 0, cy = 0, cz = 0;
    for (const w of poly.pts) { const p = cur.get(w); cx += p[0]; cy += p[1]; cz += p[2]; }
    const n = poly.pts.length;
    return { c: [cx / n, cy / n, cz / n], n: [nx / l, ny / l, nz / l] };
  };
  // a polygon that would have to be bent too far is left out of every round
  // a piece that would have to bend too far is split into its polygons, and each of those that still would is left as it is
  const fitsWithin = (poly) => {
    const f = fit(poly); if (!f) return false;
    for (const w of poly.pts) { const p = cur.get(w), d = (p[0] - f.c[0]) * f.n[0] + (p[1] - f.c[1]) * f.n[1] + (p[2] - f.c[2]) * f.n[2]; if (Math.abs(d) > limit) return false; }
    return true;
  };
  let skippedPolys = 0;
  const live = [];
  for (const poly of polys) {
    if (fitsWithin(poly)) { live.push(poly); continue; }
    if (poly.qs.length === 1) { skippedPolys++; continue; }
    for (const q of poly.qs) {
      const pts = new Set();
      for (let i = pg.pStart[q]; i < pg.pStart[q + 1]; i++) { const t = pg.pTris[i]; for (let k = 0; k < 3; k++) pts.add(topo.tri[t * 3 + k]); }
      const sub = { q, qs: [q], pts: [...pts] };
      if (sub.pts.length >= 4 && fitsWithin(sub)) live.push(sub); else if (sub.pts.length >= 4) skippedPolys++;
    }
  }
  for (let it = 0; it < iterations && live.length; it++) {
    const sum = new Map();
    for (const poly of live) {
      const f = fit(poly); if (!f) continue;
      for (const w of poly.pts) {
        const p = cur.get(w), d = (p[0] - f.c[0]) * f.n[0] + (p[1] - f.c[1]) * f.n[1] + (p[2] - f.c[2]) * f.n[2];
        let s = sum.get(w); if (!s) sum.set(w, s = [0, 0, 0, 0]);
        s[0] += p[0] - d * f.n[0]; s[1] += p[1] - d * f.n[1]; s[2] += p[2] - d * f.n[2]; s[3]++;
      }
    }
    for (const [w, s] of sum) cur.set(w, [s[0] / s[3], s[1] / s[3], s[2] / s[3]]);
  }
  const targets = new Map(); let maxMove = 0;
  const inLive = new Set(); for (const poly of live) for (const w of poly.pts) inLive.add(w);
  for (const w of inLive) {
    const a = orig.get(w), b = cur.get(w), d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (d > maxMove) maxMove = d;
    if (d > 1e-12) targets.set(w, b);
  }
  return { targets, polygons: live.reduce((s, p) => s + p.qs.length, 0), skipped: skippedPolys, maxMove };
}

// ── Straighten ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Picked edges that make a path (two ends, nothing branching): the points between the ends move onto the straight line between
// them, each to the nearest place on it. A loop or a branch has no ends and is left alone (counted). Returns { targets, paths,
// skipped, maxMove }.
export function straighten(topo, edges) {
  const adj = new Map();
  const link = (a, b) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(b); };
  for (const e of edges) { const a = topo.edgeV[e * 2], b = topo.edgeV[e * 2 + 1]; if (a === b) continue; link(a, b); link(b, a); }
  const seen = new Set(), targets = new Map();
  let paths = 0, skipped = 0, maxMove = 0;
  for (const s of adj.keys()) {
    if (seen.has(s)) continue;
    const comp = [], stack = [s]; seen.add(s);
    while (stack.length) { const v = stack.pop(); comp.push(v); for (const n of adj.get(v)) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
    const ends = comp.filter(v => adj.get(v).length === 1);
    if (ends.length !== 2 || comp.some(v => adj.get(v).length > 2)) { skipped++; continue; }
    const path = [ends[0]]; let prev = -1, v = ends[0];
    while (true) { const next = adj.get(v).find(n => n !== prev); if (next === undefined) break; path.push(next); prev = v; v = next; if (v === ends[1]) break; if (path.length > comp.length) break; }
    if (path.length !== comp.length || path.length < 3) { skipped++; continue; }
    const A = at(topo, path[0]), B = at(topo, path[path.length - 1]);
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], len2 = dx * dx + dy * dy + dz * dz;
    if (!(len2 > 0)) { skipped++; continue; }
    paths++;
    for (let i = 1; i < path.length - 1; i++) {
      const P = at(topo, path[i]), t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy + (P[2] - A[2]) * dz) / len2;
      const Q = [A[0] + t * dx, A[1] + t * dy, A[2] + t * dz], d = Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]);
      if (d > maxMove) maxMove = d;
      if (d > 1e-12) targets.set(path[i], Q);
    }
  }
  return { targets, paths, skipped, maxMove };
}

// ── Weld ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Which points become one, and where: `clusters` is a list of { ids: [point, …], target: [x, y, z] } (the middle of the group).
//   weldPoints   the picked points: all of them in one cluster, or, with dist > 0, each group of picked points that are no further
//                apart than dist (chains count: a to b, b to c) in a cluster of its own
//   collapseEdges  each connected group of picked edges: all its points in one cluster (an edge shrinks to a point)
export function weldPoints(topo, points, dist = 0) {
  const ids = [...points];
  if (ids.length < 2) return [];
  const mid = (list) => { const c = [0, 0, 0], p = [0, 0, 0]; for (const w of list) { at(topo, w, p); c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return [c[0] / list.length, c[1] / list.length, c[2] / list.length]; };
  if (!(dist > 0)) return [{ ids, target: mid(ids) }];
  const uf = new Map(ids.map(w => [w, w]));
  const find = (x) => { while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x))); x = uf.get(x); } return x; };
  const grid = new Map(), cell = dist, key = (i, j, k) => i + ',' + j + ',' + k, P = new Map(ids.map(w => [w, at(topo, w)]));
  for (const w of ids) {
    const p = P.get(w), ci = Math.floor(p[0] / cell), cj = Math.floor(p[1] / cell), ck = Math.floor(p[2] / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = grid.get(key(ci + a, cj + b, ck + c)); if (!l) continue;
      for (const o of l) { const q = P.get(o); if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= dist) { const ra = find(w), rb = find(o); if (ra !== rb) uf.set(ra, rb); } }
    }
    const k = key(ci, cj, ck); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(w);
  }
  const groups = new Map();
  for (const w of ids) { const r = find(w); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(w); }
  return [...groups.values()].filter(g => g.length > 1).map(g => ({ ids: g, target: mid(g) }));
}
export function collapseEdges(topo, edges) {
  const uf = new Map();
  const find = (x) => { if (!uf.has(x)) uf.set(x, x); while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x))); x = uf.get(x); } return x; };
  for (const e of edges) { const a = find(topo.edgeV[e * 2]), b = find(topo.edgeV[e * 2 + 1]); if (a !== b) uf.set(a, b); }
  const groups = new Map();
  for (const w of [...uf.keys()]) { const r = find(w); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(w); }
  return [...groups.values()].filter(g => g.length > 1).map(g => {
    const c = [0, 0, 0], p = [0, 0, 0];
    for (const w of g) { at(topo, w, p); c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    return { ids: g, target: [c[0] / g.length, c[1] / g.length, c[2] / g.length] };
  });
}
// What the clusters do to the mesh: every raw vertex that stands on a clustered point goes to the cluster's target, and the triangles
// that now have two corners at one place are taken out. Returns { positions (a copy of topo.positions), moved (the targets, for the
// shading), removed (Uint8Array over the triangles), merged (points that went into others) }.
export function applyWeld(topo, clusters) {
  const into = new Map(); let merged = 0;
  clusters.forEach((c, i) => { for (const w of c.ids) into.set(w, i); merged += c.ids.length - 1; });
  const positions = Float32Array.from(topo.positions);
  for (let r = 0; r < topo.nRaw; r++) { const c = into.get(topo.weld[r]); if (c === undefined) continue; const t = clusters[c].target; positions[r * 3] = t[0]; positions[r * 3 + 1] = t[1]; positions[r * 3 + 2] = t[2]; }
  const removed = new Uint8Array(topo.nTri);
  const place = (w) => { const c = into.get(w); return c === undefined ? 'p' + w : 'c' + c; };
  for (let t = 0; t < topo.nTri; t++) {
    const a = place(topo.tri[t * 3]), b = place(topo.tri[t * 3 + 1]), c = place(topo.tri[t * 3 + 2]);
    if (a === b || b === c || a === c) removed[t] = 1;
  }
  return { positions, moved: clusters.map(c => c.target), removed, merged };
}

// ── Fill ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Picked edges that are open (one triangle on them) and make a closed loop are closed with a cap. Each cap point is a copy of the
// rim point (its own vertex, so the cap has its own shading); the triangles go the way that closes the surface.
// Returns { loops: [{ points: [point, …] (the cap's points in order), raw: [raw vertex each copies], tris: [[i, j, k], …] (indices into
// points), normal: [x, y, z], owner (a triangle next to the loop) }], skipped (the picked edges that are not a closed loop) }.
export function fillLoops(topo, edges, triangulate) {
  const next = new Map(), rawOf = new Map();
  let open = 0;
  for (const e of edges) {
    if (topo.edgeN[e] !== 1) continue;
    open++;
    const t = topo.edgeT[e * 2], a = topo.edgeV[e * 2], b = topo.edgeV[e * 2 + 1];
    for (let k = 0; k < 3; k++) {
      const wa = topo.tri[t * 3 + k], wb = topo.tri[t * 3 + (k + 1) % 3];
      if (!((wa === a && wb === b) || (wa === b && wb === a))) continue;
      // the triangle runs wa → wb; the cap runs back, wb → wa
      if (next.has(wb)) return { loops: [], skipped: edges.size, why: 'branching' };      // (two rims meet at a point)
      next.set(wb, { to: wa, tri: t });
      rawOf.set(wb, cornerOf(topo, t, (k + 1) % 3));
      break;
    }
  }
  const loops = [], used = new Set();
  let closedEdges = 0;
  for (const s of next.keys()) {
    if (used.has(s)) continue;
    const pts = [], rawv = []; let v = s, ok = true, guard = 0;
    while (true) {
      if (used.has(v) && v !== s) { ok = false; break; }
      pts.push(v); rawv.push(rawOf.get(v)); used.add(v);
      const n = next.get(v); if (!n) { ok = false; break; }
      v = n.to;
      if (v === s) break;
      if (++guard > next.size + 1) { ok = false; break; }
    }
    if (!ok || pts.length < 3) continue;
    // the polygon: its normal (Newell, in cap order) and a frame in its plane
    const P = pts.map(w => at(topo, w));
    let nx = 0, ny = 0, nz = 0; const n = P.length;
    for (let i = 0; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); }
    const nl = Math.hypot(nx, ny, nz); if (!(nl > 0)) continue;
    nx /= nl; ny /= nl; nz /= nl;
    const hx = Math.abs(nx) < 0.9 ? 1 : 0, hy = hx ? 0 : 1;
    let ux = -nz * hy, uy = nz * hx, uz = nx * hy - ny * hx; const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const xy = P.map(p => [p[0] * ux + p[1] * uy + p[2] * uz, p[0] * vx + p[1] * vy + p[2] * vz]);
    let poly = 0; for (let i = 0; i < n; i++) { const p = xy[i], q = xy[(i + 1) % n]; poly += p[0] * q[1] - q[0] * p[1]; }
    poly = Math.abs(poly) / 2;
    const diag = sizeOf(topo), lt = diag * 1e-6;
    const keep = reduceCollinear(xy, lt);
    if (keep.length < 3) continue;
    let tr; try { tr = triangulate(keep.map(i => xy[i]), []); } catch (_) { continue; }
    if (!tr || tr.length !== keep.length - 2) continue;
    tr = tr.map(q => [keep[q[0]], keep[q[1]], keep[q[2]]]);
    const has = new Uint8Array(n); for (const q of tr) for (const x of q) has[x] = 1;
    const missing = []; for (let i = 0; i < n; i++) if (!has[i]) missing.push(i);
    if (missing.length && !restoreDropped(tr, xy, missing, lt)) continue;
    let area = 0, bad = false;
    const fixed = tr.map(([x, y, z]) => {
      const s = (xy[y][0] - xy[x][0]) * (xy[z][1] - xy[x][1]) - (xy[z][0] - xy[x][0]) * (xy[y][1] - xy[x][1]);
      area += Math.abs(s) / 2;
      if (Math.abs(s) < 1e-12 * Math.max(1, poly)) bad = true;
      return s < 0 ? [x, z, y] : [x, y, z];
    });
    if (bad || Math.abs(area - poly) > poly * 1e-3) continue;            // (a loop that crosses itself, or folds over: not closed by this)
    loops.push({ points: pts, raw: rawv, tris: fixed, normal: [nx, ny, nz], owner: next.get(pts[0]).tri });
    closedEdges += pts.length;
  }
  return { loops, skipped: Math.max(0, open - closedEdges), open };
}
