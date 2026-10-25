// meshtools.js — the work of Edit mesh's Planarize, Straighten, Weld, Fill and Extract, as functions on a read mesh (meshedit.js: a
// topology `topo` with its polygons `pg`). They work out what should change and leave the doing to the app (which writes positions,
// takes triangles out, puts new ones in and makes the undo step), so they run in Node for the tests.
//
// A "point" here is a welded point of topo (corners at one place are one point); topo.positions has the raw vertices, topo.rep[w] one
// raw vertex that stands on point w, topo.weld[raw] the point a raw vertex stands on.

import { reduceCollinear, restoreDropped } from './dissolve.js?v=4';

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

// ── Close open edges ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Every rim where the surface stops (a run of open edges that closes on itself) is capped, as Fill does for a picked rim: the
// missing faces of a part that should be watertight (open bores, a side that was never exported). The open edges are walked the
// way a cap runs, back along the triangle that owns each, so every rim is found once and its cap faces the way that closes the
// surface. Where rims meet at a point (two caps would share a corner) the edges at that point are left alone and counted in
// `branching`: such a rim is picked and filled by hand, or the point is welded first. A rim that folds over or crosses itself
// cannot be capped by one flat polygon and is counted in `skipped`. opts.maxSize (model units): a rim wider than this is left
// (`tooLarge`); 0 or none caps every rim.
// Returns { loops (as fillLoops gives them, one a rim), rims (the closed rims found), skipped, tooLarge, branching (open edges
// at a point where rims meet), open (the open edges of the mesh) }.
export function fillOpen(topo, triangulate, opts = {}) {
  const maxSize = opts.maxSize > 0 ? opts.maxSize : 0;
  const nextOf = new Map(), inN = new Map(), bad = new Set();
  let open = 0;
  for (let e = 0; e < topo.nEdge; e++) {
    if (topo.edgeN[e] !== 1) continue;
    open++;
    const t = topo.edgeT[e * 2], a = topo.edgeV[e * 2], b = topo.edgeV[e * 2 + 1];
    for (let k = 0; k < 3; k++) {
      const wa = topo.tri[t * 3 + k], wb = topo.tri[t * 3 + (k + 1) % 3];
      if (!((wa === a && wb === b) || (wa === b && wb === a))) continue;
      if (nextOf.has(wb)) bad.add(wb); else nextOf.set(wb, { to: wa, e });
      inN.set(wa, (inN.get(wa) || 0) + 1);
      if (inN.get(wa) > 1) bad.add(wa);
      break;
    }
  }
  const out = { loops: [], rims: 0, skipped: 0, tooLarge: 0, branching: 0, open };
  if (!open) return out;
  const used = new Set();
  const P = [0, 0, 0];
  let rimEdges = 0;
  for (const s of nextOf.keys()) {
    if (used.has(s) || bad.has(s)) continue;
    const edges = new Set(); let v = s, ok = true, guard = 0;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    while (true) {
      if (bad.has(v) || (used.has(v) && v !== s)) { ok = false; break; }
      used.add(v);
      at(topo, v, P);
      if (P[0] < mnx) mnx = P[0]; if (P[0] > mxx) mxx = P[0]; if (P[1] < mny) mny = P[1]; if (P[1] > mxy) mxy = P[1]; if (P[2] < mnz) mnz = P[2]; if (P[2] > mxz) mxz = P[2];
      const n = nextOf.get(v); if (!n) { ok = false; break; }
      edges.add(n.e); v = n.to;
      if (v === s) break;
      if (++guard > nextOf.size + 1) { ok = false; break; }
    }
    if (!ok || edges.size < 3) continue;
    out.rims++; rimEdges += edges.size;
    if (maxSize && Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) > maxSize) { out.tooLarge++; continue; }
    const r = fillLoops(topo, edges, triangulate);
    if (r.loops.length === 1) out.loops.push(r.loops[0]); else out.skipped++;
  }
  out.branching = open - rimEdges;                     // (the open edges that are not on a rim of their own: they meet others at a point)
  return out;
}

// ── Close between two rims (bridge) ──────────────────────────────────────────────────────────────────────────────────────
// The picked open edges are sorted into rims, walked the way a cap runs (as fillLoops does). With one rim the answer is fillLoops's.
// With two, the gap between them is closed with a strip of triangles from one to the other: the ring floor between the two rims of
// a counterbore, the wall between its floor and its mouth, the missing length of a tube. The points of the two rims are matched by
// their angle round the axis between the rims (the first rim in cap order, the second against it, so every new triangle runs each
// rim's edge the way that closes the surface), and the strip is stitched with the shorter of the two diagonals at each step.
// Returns { loops: [{ points, raw, tris, normal, normals (one a point), owner }], rims, skipped (open edges not on a closed rim),
// why ('none' | 'branching' | 'tooMany' | 'folded') }, in the shape fillLoops gives, so the app writes it the same way.
const triNormal = (Q, [a, b, c]) => { const p = Q[a], q = Q[b], r = Q[c]; const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]; return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; };
export function closeBetween(topo, edges, triangulate) {
  const next = new Map(), rawOf = new Map();
  let open = 0, branching = false;
  for (const e of edges) {
    if (topo.edgeN[e] !== 1) continue;
    open++;
    const t = topo.edgeT[e * 2], a = topo.edgeV[e * 2], b = topo.edgeV[e * 2 + 1];
    for (let k = 0; k < 3; k++) {
      const wa = topo.tri[t * 3 + k], wb = topo.tri[t * 3 + (k + 1) % 3];
      if (!((wa === a && wb === b) || (wa === b && wb === a))) continue;
      if (next.has(wb)) branching = true; else { next.set(wb, { to: wa, tri: t }); rawOf.set(wb, cornerOf(topo, t, (k + 1) % 3)); }
      break;
    }
  }
  const none = (why) => ({ loops: [], rims: 0, skipped: open, open, why });
  if (!open) return none('none');
  if (branching) return none('branching');
  const rims = [], used = new Set();
  for (const s of next.keys()) {
    if (used.has(s)) continue;
    const pts = [], rawv = []; let v = s, ok = true, guard = 0;
    while (true) {
      if (used.has(v) && v !== s) { ok = false; break; }
      pts.push(v); rawv.push(rawOf.get(v)); used.add(v);
      const n = next.get(v); if (!n) { ok = false; break; }
      v = n.to; if (v === s) break;
      if (++guard > next.size + 1) { ok = false; break; }
    }
    if (ok && pts.length >= 3) rims.push({ pts, rawv, owner: next.get(pts[0]).tri });
  }
  if (!rims.length) return none('none');
  if (rims.length === 1) { const r = fillLoops(topo, edges, triangulate); return { loops: r.loops, rims: 1, skipped: r.skipped, open, why: r.loops.length ? '' : 'folded' }; }
  if (rims.length > 2) return { loops: [], rims: rims.length, skipped: open, open, why: 'tooMany' };
  const P = (w) => at(topo, w);
  const geo = (R) => {
    const Q = R.pts.map(P), n = Q.length, c = [0, 0, 0];
    for (const p of Q) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; }
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) { const p = Q[i], q = Q[(i + 1) % n]; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); }
    const l = Math.hypot(nx, ny, nz) || 1;
    return { Q, c, nrm: [nx / l, ny / l, nz / l] };
  };
  const A = geo(rims[0]), B = geo(rims[1]);
  // the axis the strip runs round: the two cap normals point apart (out of each rim), so their difference is it; failing that, the line between the rims
  let ax = A.nrm[0] - B.nrm[0], ay = A.nrm[1] - B.nrm[1], az = A.nrm[2] - B.nrm[2], al = Math.hypot(ax, ay, az);
  if (al < 0.5) { ax = B.c[0] - A.c[0]; ay = B.c[1] - A.c[1]; az = B.c[2] - A.c[2]; al = Math.hypot(ax, ay, az); }
  if (al < 1e-12) { ax = A.nrm[0]; ay = A.nrm[1]; az = A.nrm[2]; al = Math.hypot(ax, ay, az) || 1; }
  ax /= al; ay /= al; az /= al;
  const hx = Math.abs(ax) < 0.9 ? 1 : 0, hy = hx ? 0 : 1;
  let ux = -az * hy, uy = az * hx, uz = ax * hy - ay * hx; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
  const angle = (p, c) => Math.atan2((p[0] - c[0]) * vx + (p[1] - c[1]) * vy + (p[2] - c[2]) * vz, (p[0] - c[0]) * ux + (p[1] - c[1]) * uy + (p[2] - c[2]) * uz);
  // the second rim against its cap order, so its angle runs the same way as the first's
  const Bp = rims[1].pts.slice().reverse(), Braw = rims[1].rawv.slice().reverse(), BQ = B.Q.slice().reverse();
  const n = A.Q.length, m = BQ.length;
  const aAng = A.Q.map(p => angle(p, A.c)), bAng = BQ.map(p => angle(p, B.c));
  // does the first rim run with the angle? (it does when its cap faces along the axis; against it, the strip would twist: walk it the other way)
  let turnA = 0; for (let i = 0; i < n; i++) { let d = aAng[(i + 1) % n] - aAng[i]; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; turnA += d; }
  let turnB = 0; for (let j = 0; j < m; j++) { let d = bAng[(j + 1) % m] - bAng[j]; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; turnB += d; }
  if (!(Math.abs(turnA) > Math.PI) || !(Math.abs(turnB) > Math.PI) || Math.sign(turnA) !== Math.sign(turnB)) return { loops: [], rims: 2, skipped: open, open, why: 'folded' };
  // start the second rim at the point nearest in angle to the first's first point
  const dAng = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
  let j0 = 0; for (let j = 1; j < m; j++) if (dAng(bAng[j], aAng[0]) < dAng(bAng[j0], aAng[0])) j0 = j;
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const tris = []; let i = 0, j = 0;
  while (i < n || j < m) {
    const ai = A.Q[i % n], an = A.Q[(i + 1) % n], bj = BQ[(j0 + j) % m], bn = BQ[(j0 + j + 1) % m];
    const stepA = i < n && (j >= m || dist(an, bj) <= dist(ai, bn));
    if (stepA) { tris.push([i % n, (i + 1) % n, n + (j0 + j) % m]); i++; }
    else { tris.push([i % n, n + (j0 + j + 1) % m, n + (j0 + j) % m]); j++; }
  }
  // the shading of the strip: each point takes the area-weighted normal of the strip triangles round it
  const Q = A.Q.concat(BQ), normals = Q.map(() => [0, 0, 0]);
  for (const [a, b, c] of tris) {
    const nn = triNormal(Q, [a, b, c]);
    for (const k of [a, b, c]) { normals[k][0] += nn[0]; normals[k][1] += nn[1]; normals[k][2] += nn[2]; }
  }
  for (const nv of normals) { const l = Math.hypot(nv[0], nv[1], nv[2]); if (l > 0) { nv[0] /= l; nv[1] /= l; nv[2] /= l; } else { nv[0] = ax; nv[1] = ay; nv[2] = az; } }
  // the polygons of the strip, for the wire view and Edit mesh: two triangles in a row that share their diagonal and lie nearly in one
  // plane (within 10°) are one four-sided cell, as the quads of a modelling program; the rest are triangles of their own
  const polys = new Int32Array(tris.length).fill(-1);
  const tn = tris.map(t => { const nn = triNormal(Q, t); const l = Math.hypot(nn[0], nn[1], nn[2]) || 1; return [nn[0] / l, nn[1] / l, nn[2] / l]; });
  let nPoly = 0; const cosQuad = Math.cos(10 * Math.PI / 180);
  for (let k = 0; k < tris.length; k++) {
    if (polys[k] >= 0) continue;
    polys[k] = nPoly;
    const nx = (k + 1) % tris.length;
    if (nx !== k && polys[nx] < 0) {
      const shared = tris[k].filter(x => tris[nx].includes(x)).length;
      if (shared === 2 && tn[k][0] * tn[nx][0] + tn[k][1] * tn[nx][1] + tn[k][2] * tn[nx][2] >= cosQuad) polys[nx] = nPoly;
    }
    nPoly++;
  }
  return { loops: [{ points: rims[0].pts.concat(Bp), raw: rims[0].rawv.concat(Braw), tris, normal: [ax, ay, az], normals, polys, nPolys: nPoly, owner: rims[0].owner }], rims: 2, skipped: 0, open, why: '' };
}
