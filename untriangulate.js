// untriangulate.js — join flat triangles into polygons and rebuild each polygon with the fewest triangles.
//
// A flat plate cut into a grid of triangles has vertices in its middle that say nothing about the shape: the
// plate is the same without them. This finds each plate (analysePolygons: triangles that lie in one plane and
// touch along an edge), takes the vertices that touch only that plate away, and triangulates its outline again.
// The surface does not move at all. What is gone is the triangles and vertices that were only there to cut the
// plate up. (Cinema 4D calls it Untriangulate; the polygon is an n-gon there, and here it stays a set of
// triangles that remember which polygon they belong to, because that is what the graphics card draws.)
//
// Safe by construction. A polygon is only rebuilt when
//   - its outline is a simple loop with holes (no vertex where the outline touches itself),
//   - every vertex of it lies on the plane (within 2e-5 of the part's size), so nothing moves when the middle goes,
//   - its vertex normals (if there are any) agree with the plane, so shading does not change,
//   - the new triangles use every vertex of the outline (no new T-junction against a neighbour) and are as many as
//     a triangulation of that outline must have, and
//   - their area adds up to the old area.
// Anything else is left exactly as it was, and counted.
//
//   positions   Float32Array, xyz per vertex
//   index       triangle index array (a mesh without one: pass null)
//   opts.angleDeg      how far a triangle may turn from the polygon's first triangle (default 1)
//   opts.normals       Float32Array, xyz per vertex, or null
//   opts.normalTol     degrees a vertex normal may differ from the plane's normal (default 5)
//   opts.triangulate   (contour, holes) → [[i, j, k], …]: indices into contour then holes, each a list of [x, y]
//                      (THREE.ShapeUtils does this; it is passed in so this file needs no library)
// Returns { index, poly, stats } or null: `index` the new triangle list (the mesh's own vertex numbers, so the
// caller drops the vertices nothing uses any more), `poly` the polygon of every new triangle.

import { analysePolygons } from './wirelines.js?v=2';

export function untriangulate(positions, index, opts = {}) {
  const { angleDeg = 1, normals = null, normalTol = 5, triangulate } = opts;
  if (typeof triangulate !== 'function') throw new Error('untriangulate needs a triangulate function');
  const a = analysePolygons(positions, index, angleDeg);
  if (!a) return null;
  const { T, tv, canon, diag, nrm, adj, poly, polys } = a;
  const planeTol = diag * 2e-5, lineTol = diag * 5e-6;     // how far off the plane / off a straight run still counts as on it
  const stats = { trisBefore: T, trisAfter: 0, polygons: polys, joined: 0, rebuilt: 0, vertsRemoved: 0, kept: { touching: 0, curved: 0, shading: 0, other: 0 } };

  // the triangles of each polygon, in order
  const start = new Int32Array(polys + 1);
  for (let t = 0; t < T; t++) start[poly[t] + 1]++;
  for (let p = 0; p < polys; p++) start[p + 1] += start[p];
  const fill = start.slice(0, polys), order = new Int32Array(T);
  for (let t = 0; t < T; t++) order[fill[poly[t]]++] = t;

  const cosN = Math.cos(normalTol * Math.PI / 180);
  const rebuilt = new Map();                       // polygon → Uint32Array of its new triangles (vertex numbers)
  const P = (v, c) => positions[v * 3 + c];

  for (let p = 0; p < polys; p++) {
    const from = start[p], to = start[p + 1], n = to - from;
    if (n < 2) continue;
    stats.joined++;
    const seed = order[from];
    if (!a.ok[seed]) { stats.kept.other++; continue; }
    const N = [nrm[seed * 3], nrm[seed * 3 + 1], nrm[seed * 3 + 2]];

    // the outline: edges whose other side is not this polygon
    const next = new Map();                        // place → { to place, vertex number at this place }
    const here = new Set();                        // every place a triangle of this polygon touches
    let pinch = false;
    for (let i = from; i < to && !pinch; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        const va = tv(t, k), vb = tv(t, (k + 1) % 3), ca = canon[va], cb = canon[vb];
        here.add(ca);
        if (ca === cb) continue;
        const m = adj[t * 3 + k];
        if (m >= 0 && poly[m] === p) continue;
        if (next.has(ca)) { pinch = true; break; } // the outline touches itself here
        next.set(ca, { to: cb, v: va });
      }
    }
    if (pinch) { stats.kept.touching++; continue; }
    let inner = 0;
    for (const c of here) if (!next.has(c)) inner++;
    if (!inner) continue;                          // already as few triangles as its outline needs
    if (!next.size) { stats.kept.other++; continue; }

    // flat: every vertex on the plane of the first triangle
    {
      const d0 = N[0] * P(tv(seed, 0), 0) + N[1] * P(tv(seed, 0), 1) + N[2] * P(tv(seed, 0), 2);
      let off = false;
      for (let i = from; i < to && !off; i++) {
        const t = order[i];
        for (let k = 0; k < 3; k++) { const v = tv(t, k); if (Math.abs(N[0] * P(v, 0) + N[1] * P(v, 1) + N[2] * P(v, 2) - d0) > planeTol) { off = true; break; } }
      }
      if (off) { stats.kept.curved++; continue; }
    }

    // shading: the vertices' own normals must lie along the plane's
    if (normals) {
      let bad = false;
      for (let i = from; i < to && !bad; i++) {
        const t = order[i];
        for (let k = 0; k < 3; k++) { const v = tv(t, k); if (normals[v * 3] * N[0] + normals[v * 3 + 1] * N[1] + normals[v * 3 + 2] * N[2] < cosN) { bad = true; break; } }
      }
      if (bad) { stats.kept.shading++; continue; }
    }

    // follow the outline round into loops
    const loops = [];
    const used = new Set();
    let broken = false;
    for (const [c0, e0] of next) {
      if (used.has(c0)) continue;
      const loop = [];
      let c = c0, e = e0;
      while (true) {
        if (used.has(c)) { broken = true; break; }
        used.add(c); loop.push(e.v);
        const nx = next.get(e.to);
        if (e.to === c0) break;
        if (!nx) { broken = true; break; }
        c = e.to; e = nx;
      }
      if (broken) break;
      loops.push(loop);
    }
    if (broken || used.size !== next.size) { stats.kept.other++; continue; }

    // flatten onto the plane
    const helper = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ux = N[1] * helper[2] - N[2] * helper[1], uy = N[2] * helper[0] - N[0] * helper[2], uz = N[0] * helper[1] - N[1] * helper[0];
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = N[1] * uz - N[2] * uy, vy = N[2] * ux - N[0] * uz, vz = N[0] * uy - N[1] * ux;
    const flat = (v) => [P(v, 0) * ux + P(v, 1) * uy + P(v, 2) * uz, P(v, 0) * vx + P(v, 1) * vy + P(v, 2) * vz];
    const shapes = loops.map(loop => {
      const pts = loop.map(flat);
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; area += pts[i][0] * q[1] - q[0] * pts[i][1]; }
      return { loop, pts, area: area / 2 };
    });
    const outers = shapes.filter(s => s.area > 0), holes = shapes.filter(s => s.area < 0);
    if (outers.length !== 1 || outers.length + holes.length !== shapes.length) { stats.kept.other++; continue; }
    const outer = outers[0];
    const ids = outer.loop.concat(...holes.map(h => h.loop));
    const pts = outer.pts.concat(...holes.map(h => h.pts));
    // The triangulator is given the outline without the vertices that only run on in a straight line (it would
    // drop some of them and keep others). They are put back below: cutting the triangle that has that stretch as a
    // side, so the neighbouring polygon, which still has them, does not end up with a crack (a T-junction) along
    // the shared edge.
    const redToFull = [], redLoops = [];
    let base = 0, tooFew = false;
    for (const s of [outer, ...holes]) {
      const keep = reduceCollinear(s.pts, lineTol);
      if (keep.length < 3) tooFew = true;
      redLoops.push(keep.map(i => s.pts[i].slice()));
      for (const i of keep) redToFull.push(base + i);
      base += s.pts.length;
    }
    if (tooFew) { stats.kept.other++; continue; }
    let tris;
    try { tris = triangulate(redLoops[0], redLoops.slice(1)); }
    catch (_) { stats.kept.other++; continue; }
    if (!tris || !tris.length) { stats.kept.other++; continue; }
    tris = tris.map(q => [redToFull[q[0]], redToFull[q[1]], redToFull[q[2]]]);
    const has = new Uint8Array(ids.length);
    for (const q of tris) has[q[0]] = has[q[1]] = has[q[2]] = 1;
    const missing = [];
    for (let i = 0; i < ids.length; i++) if (!has[i]) missing.push(i);
    if (missing.length && (missing.length * tris.length > 5e7 || !restoreDropped(tris, pts, missing, lineTol))) { stats.kept.other++; continue; }

    // checks: as many triangles as the outline needs, the outline and nothing else is open, the right way round, the same area
    const sizes = [outer.loop.length, ...holes.map(h => h.loop.length)];
    if (tris.length !== ids.length + 2 * holes.length - 2 || !outlineIsOnlyOpenEdge(tris, sizes)) { stats.kept.other++; continue; }
    const out = new Uint32Array(tris.length * 3);
    let newArea = 0, bad = false;
    for (let i = 0; i < tris.length; i++) {
      let [x, y, z] = tris[i];
      const s = (pts[y][0] - pts[x][0]) * (pts[z][1] - pts[x][1]) - (pts[z][0] - pts[x][0]) * (pts[y][1] - pts[x][1]);
      if (s < 0) { const w = y; y = z; z = w; }
      out[i * 3] = ids[x]; out[i * 3 + 1] = ids[y]; out[i * 3 + 2] = ids[z];
      newArea += Math.abs(s) / 2;
      // a triangle with no width (its three corners on one line) is a defect, not a triangle
      const l01 = (pts[y][0] - pts[x][0]) ** 2 + (pts[y][1] - pts[x][1]) ** 2, l12 = (pts[z][0] - pts[y][0]) ** 2 + (pts[z][1] - pts[y][1]) ** 2, l20 = (pts[x][0] - pts[z][0]) ** 2 + (pts[x][1] - pts[z][1]) ** 2;
      if (Math.abs(s) < 1e-5 * Math.max(l01, l12, l20)) bad = true;
    }
    let oldArea = 0;
    for (let i = from; i < to; i++) {
      const t = order[i], v0 = tv(t, 0), v1 = tv(t, 1), v2 = tv(t, 2);
      const ex = P(v1, 0) - P(v0, 0), ey = P(v1, 1) - P(v0, 1), ez = P(v1, 2) - P(v0, 2), fx = P(v2, 0) - P(v0, 0), fy = P(v2, 1) - P(v0, 1), fz = P(v2, 2) - P(v0, 2);
      oldArea += Math.hypot(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx) / 2;
    }
    if (bad || Math.abs(newArea - oldArea) > oldArea * 1e-3) { stats.kept.other++; continue; }

    rebuilt.set(p, out);
    stats.rebuilt++;
    stats.vertsRemoved += inner;
  }

  // the new triangle list: every polygon that was not rebuilt keeps its triangles, in place
  let total = 0;
  const outIdx = new Uint32Array(T * 3), outPoly = new Int32Array(T);
  const done = new Set();
  for (let t = 0; t < T; t++) {
    const p = poly[t], r = rebuilt.get(p);
    if (!r) {
      outIdx[total * 3] = tv(t, 0); outIdx[total * 3 + 1] = tv(t, 1); outIdx[total * 3 + 2] = tv(t, 2);
      outPoly[total++] = p;
    } else if (!done.has(p)) {
      done.add(p);
      outIdx.set(r, total * 3);
      for (let i = 0; i < r.length / 3; i++) outPoly[total + i] = p;
      total += r.length / 3;
    }
  }
  stats.trisAfter = total;
  return { index: outIdx.slice(0, total * 3), poly: outPoly.slice(0, total), stats };
}

// Put back the outline vertices `missing` (local numbers into `pts`) that lie on a side of one of `tris`.
function restoreDropped(tris, pts, missing, tol) {
  for (const d of missing) {
    const dx = pts[d][0], dy = pts[d][1];
    let found = false;
    for (let i = 0; i < tris.length && !found; i++) {
      const q = tris[i];
      for (let k = 0; k < 3; k++) {
        const p0 = q[k], p1 = q[(k + 1) % 3], p2 = q[(k + 2) % 3];
        const ex = pts[p1][0] - pts[p0][0], ey = pts[p1][1] - pts[p0][1], fx = dx - pts[p0][0], fy = dy - pts[p0][1];
        const len2 = ex * ex + ey * ey;
        if (!len2) continue;
        const dot = ex * fx + ey * fy;
        if (Math.abs(ex * fy - ey * fx) <= tol * Math.sqrt(len2) && dot > 0 && dot < len2) {
          tris[i] = [p0, d, p2]; tris.push([d, p1, p2]);
          found = true; break;
        }
      }
    }
    if (!found) return false;
  }
  return true;
}

// The sides left open by `tris` must be exactly the outline (the loops of the given sizes, numbered one after the
// other), and no side may have more than two triangles.
function outlineIsOnlyOpenEdge(tris, sizes) {
  const K = 1 << 26, count = new Map();
  const key = (p, q) => (p < q ? p * K + q : q * K + p);
  for (const q of tris) for (let k = 0; k < 3; k++) { const e = key(q[k], q[(k + 1) % 3]); count.set(e, (count.get(e) || 0) + 1); }
  let open = 0;
  for (const c of count.values()) { if (c > 2) return false; if (c === 1) open++; }
  let want = 0, base = 0;
  for (const n of sizes) {
    for (let i = 0; i < n; i++) { if (count.get(key(base + i, base + (i + 1) % n)) !== 1) return false; want++; }
    base += n;
  }
  return open === want;
}

// The points of a closed loop that are not just on a straight run between their neighbours (local numbers).
// A point is dropped when it lies on the line through the one before and the one after and between them.
function reduceCollinear(pts, tol) {
  const n = pts.length;
  if (n < 4) return pts.map((_, i) => i);
  // q is on the straight run from p to r: within `tol` of the line through them, and between them
  const straight = (p, q, r) => {
    const ex = r[0] - p[0], ey = r[1] - p[1], fx = q[0] - p[0], fy = q[1] - p[1], len2 = ex * ex + ey * ey;
    if (!len2) return false;
    const dot = ex * fx + ey * fy;
    return Math.abs(ex * fy - ey * fx) <= tol * Math.sqrt(len2) && dot > 0 && dot < len2;
  };
  const keep = [];
  for (let i = 0; i < n; i++) {
    keep.push(i);
    while (keep.length >= 3 && straight(pts[keep[keep.length - 3]], pts[keep[keep.length - 2]], pts[keep[keep.length - 1]])) keep.splice(keep.length - 2, 1);
  }
  // the seam where the loop closes
  let again = true;
  while (again && keep.length > 3) {
    again = false;
    const m = keep.length;
    if (straight(pts[keep[m - 1]], pts[keep[0]], pts[keep[1]])) { keep.shift(); again = true; }
    else if (straight(pts[keep[m - 2]], pts[keep[m - 1]], pts[keep[0]])) { keep.pop(); again = true; }
  }
  return keep;
}
