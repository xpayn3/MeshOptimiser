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
//   opts.tolerance     how far the surface may move (mesh units) where a vertex that is not quite in the plane of its polygon
//                      is taken away; 0 (the default) is a hair: 2e-5 of the part's size, so nothing visibly moves
//   opts.straight      also dissolve the points that only sit on a straight run of an outline, from every polygon at once (dissolve.js);
//                      off by default: the plate keeps every vertex of its outline
//   opts.limitDeg      also a limited dissolve of what is left on faces that are nearly flat: a point goes when the triangles round it
//                      turn from each other by no more than this (degrees) and the surface moves by less than opts.limitTol (mesh units;
//                      default a thousandth of the part's size). 0 (the default) is off.
//   opts.poly          Int32Array, a polygon number per triangle where it is already known (the CAD plane faces of a STEP: exact,
//                      whatever the tessellation's normals say), -1 elsewhere; those grow by angle as usual
//   opts.triangulate   (contour, holes) ý [[i, j, k], &]: indices into contour then holes, each a list of [x, y]
//                      (THREE.ShapeUtils does this; it is passed in so this file needs no library)
// Returns { index, poly, stats } or null: `index` the new triangle list (the mesh's own vertex numbers, so the
// caller drops the vertices nothing uses any more), `poly` the polygon of every new triangle.

import { analysePolygons } from './wirelines.js?v=3';
import { dissolvePoints, applyDissolve, reduceCollinear, restoreDropped } from './dissolve.js?v=4';

export function untriangulate(positions, index, opts = {}) {
  const { angleDeg = 1, normals = null, normalTol = 5, triangulate, flip = true, tolerance = 0 } = opts;
  if (typeof triangulate !== 'function') throw new Error('untriangulate needs a triangulate function');
  const a = analysePolygons(positions, index, angleDeg, opts.poly && opts.poly.length === (index ? index.length / 3 : positions.length / 9) ? opts.poly : null);
  if (!a) return null;
  const { T, tv, canon, diag, nrm, adj, poly, polys } = a;
  const planeTol = Math.max(diag * 2e-5, +tolerance || 0), lineTol = diag * 5e-6;     // how far off the plane / off a straight run still counts as on it
  const stats = { trisBefore: T, trisAfter: 0, polygons: polys, joined: 0, rebuilt: 0, vertsRemoved: 0, kept: { touching: 0, curved: 0, shading: 0, other: 0 } };

  // the triangles of each polygon, in order
  const start = new Int32Array(polys + 1);
  for (let t = 0; t < T; t++) start[poly[t] + 1]++;
  for (let p = 0; p < polys; p++) start[p + 1] += start[p];
  const fill = start.slice(0, polys), order = new Int32Array(T);
  for (let t = 0; t < T; t++) order[fill[poly[t]]++] = t;

  const cosN = Math.cos(normalTol * Math.PI / 180);
  const rebuilt = new Map();                       // polygon ý Uint32Array of its new triangles (vertex numbers)
  const P = (v, c) => positions[v * 3 + c];

  // A polygon the whole-outline rebuild cannot take (its outline touches itself, or is too odd for the triangulator) still has
  // vertices that only its own triangles use. Those go one at a time: the triangles round such a vertex are replaced by a
  // triangulation of the ring they make (every ring vertex used, so no crack), then the edges inside the polygon are flipped to
  // even the triangles out. The outline of the polygon is not touched, so neighbours are not affected. Returns the polygon's new
  // triangles (vertex numbers) and how many vertices went, or null.
  function salvage(p, from, to, N) {
    const n = to - from;
    if (n < 3) return null;
    const tri = [];
    for (let i = from; i < to; i++) { const t = order[i]; if (!a.ok[t]) return null; tri.push([tv(t, 0), tv(t, 1), tv(t, 2)]); }
    // A polygon that is flat all over, and shaded flat all over, may be rebuilt freely. One that is only nearly flat (a big panel with
    // a gentle bend: its triangles are each within the angle of the first, but together they wander off the plane) or whose
    // vertices shade round a corner is not: there a vertex goes only if it and the ring round it are flat and flat-shaded, and the
    // edges are not turned afterwards. The surface does not move more than the flatness tolerance in either case.
    const d0 = N[0] * P(tri[0][0], 0) + N[1] * P(tri[0][0], 1) + N[2] * P(tri[0][0], 2);
    let polyFlat = true, polyShade = true;
    for (const q of tri) for (const v of q) {
      if (Math.abs(N[0] * P(v, 0) + N[1] * P(v, 1) + N[2] * P(v, 2) - d0) > planeTol) polyFlat = false;
      if (normals && normals[v * 3] * N[0] + normals[v * 3 + 1] * N[1] + normals[v * 3 + 2] * N[2] < cosN) polyShade = false;
    }
    const dist = (v) => N[0] * P(v, 0) + N[1] * P(v, 1) + N[2] * P(v, 2);
    const shadesFlat = (v) => !normals || normals[v * 3] * N[0] + normals[v * 3 + 1] * N[1] + normals[v * 3 + 2] * N[2] >= cosN;
    const outline = new Set();
    for (let i = from; i < to; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) { const m = adj[t * 3 + k]; if (m >= 0 && poly[m] === p) continue; outline.add(canon[tv(t, k)]); outline.add(canon[tv(t, (k + 1) % 3)]); }
    }
    const helperV = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ux = N[1] * helperV[2] - N[2] * helperV[1], uy = N[2] * helperV[0] - N[0] * helperV[2], uz = N[0] * helperV[1] - N[1] * helperV[0];
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = N[1] * uz - N[2] * uy, vy = N[2] * ux - N[0] * uz, vz = N[0] * uy - N[1] * ux;
    const xy = (v) => [P(v, 0) * ux + P(v, 1) * uy + P(v, 2) * uz, P(v, 0) * vx + P(v, 1) * vy + P(v, 2) * vz];
    const area2 = (q) => { const A = xy(q[0]), B = xy(q[1]), C = xy(q[2]); return (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]); };
    let before = 0; for (const q of tri) before += Math.abs(area2(q));
    const alive = new Array(tri.length).fill(1);                // (grows: the triangles that replace a vertex's are added at the end)
    const inc = new Map();                          // canon -> triangle numbers
    const link = (i) => { for (const v of tri[i]) { const c = canon[v]; let s = inc.get(c); if (!s) inc.set(c, s = new Set()); s.add(i); } };
    const unlink = (i) => { for (const v of tri[i]) inc.get(canon[v]).delete(i); };
    for (let i = 0; i < tri.length; i++) link(i);
    const todo = [...inc.keys()].filter(c => !outline.has(c)).sort((x, y) => inc.get(x).size - inc.get(y).size);
    let gone = 0;
    for (const c of todo) {
      const ts = [...(inc.get(c) || [])];
      if (ts.length < 3) continue;
      const ring = new Map();                       // canon of the ring's start -> { v: its vertex number, to: canon of its end }
      let ok = true;
      for (const i of ts) {
        const q = tri[i], k = q.findIndex(v => canon[v] === c);
        const va = q[(k + 1) % 3], vb = q[(k + 2) % 3], ca = canon[va], cb = canon[vb];
        if (ring.has(ca)) { ok = false; break; }
        ring.set(ca, { v: va, to: cb });
      }
      if (!ok) continue;
      const loop = [];
      let cur = ring.keys().next().value; const first = cur;
      for (let g = 0; g <= ts.length; g++) { const e = ring.get(cur); if (!e) { ok = false; break; } loop.push(e.v); cur = e.to; if (cur === first) break; }
      if (!ok || cur !== first || loop.length !== ts.length) continue;
      if (!polyFlat || !polyShade) {
        const centre = tri[ts[0]].find(v => canon[v] === c), dc = dist(centre);
        if (!polyFlat && (loop.some(v => Math.abs(dist(v) - dc) > planeTol))) continue;
        if (!polyShade && (!shadesFlat(centre) || loop.some(v => !shadesFlat(v)))) continue;
      }
      const pts = loop.map(xy);
      let tr; try { tr = triangulate(pts, []); } catch (_) { continue; }
      if (!tr || tr.length !== loop.length - 2) continue;
      const usedR = new Set(); for (const q of tr) for (const x of q) usedR.add(x);
      if (usedR.size !== loop.length) continue;
      const fresh = tr.map(q => [loop[q[0]], loop[q[1]], loop[q[2]]]);
      let good = true;
      for (const q of fresh) { if (area2(q) < 0) { const w = q[1]; q[1] = q[2]; q[2] = w; } if (!(area2(q) > 1e-12 * diag * diag)) { good = false; break; } }
      if (!good) continue;
      for (const i of ts) { unlink(i); alive[i] = 0; }
      for (const q of fresh) { tri.push(q); alive[tri.length - 1] = 1; link(tri.length - 1); }
      gone++;
    }
    if (!gone) return null;
    let kept = tri.filter((q, i) => alive[i]);
    // even the triangles out inside the polygon
    if (flip && polyFlat && kept.length > 1 && kept.length < 20000) {
      const local = new Map(), pts2 = [], rep2 = [];
      const li = (v) => { const c = canon[v]; let x = local.get(c); if (x === undefined) { x = pts2.length; local.set(c, x); pts2.push(xy(v)); rep2.push(v); } return x; };
      const work = kept.map(q => [li(q[0]), li(q[1]), li(q[2])]);
      flipToDelaunay(work, pts2, lineTol);
      kept = work.map(q => [rep2[q[0]], rep2[q[1]], rep2[q[2]]]);
    }
    let after = 0; for (const q of kept) { const s2 = area2(q); if (s2 < 0) { const w = q[1]; q[1] = q[2]; q[2] = w; } after += Math.abs(s2); }
    if (Math.abs(after - before) > before * 1e-3) return null;
    const out = new Uint32Array(kept.length * 3);
    kept.forEach((q, i) => { out[i * 3] = q[0]; out[i * 3 + 1] = q[1]; out[i * 3 + 2] = q[2]; });
    return { out, gone };
  }
  // the whole-outline rebuild failed for this polygon (why says how): try the vertex-by-vertex way before giving up
  const trySalvage = (p, from, to, N, why) => {
    let r = null;
    try { r = salvage(p, from, to, N); } catch (_) { r = null; }
    if (r) { rebuilt.set(p, r.out); stats.rebuilt++; stats.vertsRemoved += r.gone; return true; }
    stats.kept[why]++;
    return false;
  };

  for (let p = 0; p < polys; p++) {
    const from = start[p], to = start[p + 1], n = to - from;
    if (n < 2) continue;
    stats.joined++;
    const seed = order[from];
    if (!a.ok[seed]) { stats.kept.other++; continue; }
    const N = [nrm[seed * 3], nrm[seed * 3 + 1], nrm[seed * 3 + 2]];

    // the outline: edges whose other side is not this polygon
    const next = new Map();                        // place ý { to place, vertex number at this place }
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
    if (pinch) { trySalvage(p, from, to, N, 'touching'); continue; }
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
      if (off) { trySalvage(p, from, to, N, 'curved'); continue; }
    }

    // shading: the vertices' own normals must lie along the plane's
    if (normals) {
      let bad = false;
      for (let i = from; i < to && !bad; i++) {
        const t = order[i];
        for (let k = 0; k < 3; k++) { const v = tv(t, k); if (normals[v * 3] * N[0] + normals[v * 3 + 1] * N[1] + normals[v * 3 + 2] * N[2] < cosN) { bad = true; break; } }
      }
      if (bad) { trySalvage(p, from, to, N, 'shading'); continue; }
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
    if (broken || used.size !== next.size) { trySalvage(p, from, to, N, 'other'); continue; }

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
    if (outers.length !== 1 || outers.length + holes.length !== shapes.length) { trySalvage(p, from, to, N, 'other'); continue; }
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
    if (tooFew) { trySalvage(p, from, to, N, 'other'); continue; }
    let tris;
    try { tris = triangulate(redLoops[0], redLoops.slice(1)); }
    catch (_) { trySalvage(p, from, to, N, 'other'); continue; }
    if (!tris || !tris.length) { trySalvage(p, from, to, N, 'other'); continue; }
    tris = tris.map(q => [redToFull[q[0]], redToFull[q[1]], redToFull[q[2]]]);
    const has = new Uint8Array(ids.length);
    for (const q of tris) has[q[0]] = has[q[1]] = has[q[2]] = 1;
    const missing = [];
    for (let i = 0; i < ids.length; i++) if (!has[i]) missing.push(i);
    if (missing.length && (missing.length * tris.length > 5e7 || !restoreDropped(tris, pts, missing, lineTol))) { trySalvage(p, from, to, N, 'other'); continue; }

    // the ear-clipping triangulator leaves long thin triangles in a long narrow face (a rail, an L-profile): flip edges
    // until no triangle's circle holds another corner. The count, the corners and the outline stay as they are.
    if (flip) flipToDelaunay(tris, pts, lineTol);

    // checks: as many triangles as the outline needs, the outline and nothing else is open, the right way round, the same area
    const sizes = [outer.loop.length, ...holes.map(h => h.loop.length)];
    if (tris.length !== ids.length + 2 * holes.length - 2 || !outlineIsOnlyOpenEdge(tris, sizes)) { trySalvage(p, from, to, N, 'other'); continue; }
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
    if (bad || Math.abs(newArea - oldArea) > oldArea * 1e-3) { trySalvage(p, from, to, N, 'other'); continue; }

    rebuilt.set(p, out);
    stats.rebuilt++;
    stats.vertsRemoved += inner;
  }

  // the new triangle list: every polygon that was not rebuilt keeps its triangles, in place
  let total = 0;
  const outIdx = new Uint32Array(T * 3), outPoly = new Int32Array(T);
  // opts.faceOf (a number per old triangle, the CAD face it is on): the face of every new triangle. The new list follows the old order, a
  // rebuilt polygon standing where its first triangle was, and a polygon never crosses a CAD face (they are the CAD's own), so a face
  // that was one run of triangles is one run of them still.
  const faceOf = opts.faceOf && opts.faceOf.length === T ? opts.faceOf : null;
  const outFace = faceOf ? new Int32Array(T) : null;
  const done = new Set();
  for (let t = 0; t < T; t++) {
    const p = poly[t], r = rebuilt.get(p);
    if (!r) {
      outIdx[total * 3] = tv(t, 0); outIdx[total * 3 + 1] = tv(t, 1); outIdx[total * 3 + 2] = tv(t, 2);
      if (outFace) outFace[total] = faceOf[t];
      outPoly[total++] = p;
    } else if (!done.has(p)) {
      done.add(p);
      outIdx.set(r, total * 3);
      for (let i = 0; i < r.length / 3; i++) { outPoly[total + i] = p; if (outFace) outFace[total + i] = faceOf[t]; }
      total += r.length / 3;
    }
  }
  stats.trisAfter = total;
  let resIndex = outIdx.slice(0, total * 3), resPoly = outPoly.slice(0, total), resFace = outFace ? outFace.slice(0, total) : null;
  // Points that only sit on a straight run of an outline (a long edge cut up into pieces) are kept above, so that a neighbour that
  // still has them does not get a crack. Here they go from every polygon that touches them at once, which is safe.
  // And what is left on faces that are only nearly flat (opts.limitDeg > 0): a limited dissolve. A point goes when the triangles round
  // it turn from each other by no more than limitDeg and the surface moves by less than limitTol where it was; the polygons round it
  // become one.
  const limitDeg = +opts.limitDeg > 0 ? +opts.limitDeg : 0;
  if (opts.straight || limitDeg) {
    const places = new Set();
    for (let i = 0; i < resIndex.length; i++) places.add(canon[resIndex[i]]);
    const d = dissolvePoints(positions, resIndex, resPoly, canon, places, {
      triangulate, normals, normalTol, strict: true, allowInterior: !!limitDeg, allowStraight: !!opts.straight, allowMerge: false, planeTol, lineTol,
      limitDeg, limitTol: opts.limitTol > 0 ? opts.limitTol : diag * 1e-3, limitMerge: !!limitDeg,
    });
    if (d.dissolved) {
      const ap = applyDissolve(resIndex, d, faceOf ? resFace : null);
      resIndex = ap.index; resPoly = ap.poly; resFace = faceOf ? ap.face : null;      // (the new triangles take the face of the one they stand in for)
      stats.straight = d.dissolved; stats.vertsRemoved += d.dissolved; stats.trisAfter = resIndex.length / 3;
    }
  }
  return { index: resIndex, poly: resPoly, face: resFace, stats };
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

// Edge flips (Lawson) over a triangulation of a flat polygon: an inside edge is turned when the corner opposite it lies
// inside the circle of the triangle on the other side and the four corners make a strictly convex quad. Outline edges
// have one triangle and never move. Triangles are given as index triples into pts ([x, y]); they are changed in place.
function flipToDelaunay(tris, pts, tol) {
  const n = tris.length;
  if (n < 2 || n > 20000) return;
  const cross = (a, b, c) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1]);
  for (const t of tris) if (cross(t[0], t[1], t[2]) < 0) { const w = t[1]; t[1] = t[2]; t[2] = w; }      // all counter-clockwise
  const key = (a, b) => a < b ? a + ',' + b : b + ',' + a;
  const edge = new Map();                          // edge ý [triangle, triangle]
  const add = (a, b, t) => { const k = key(a, b), e = edge.get(k); if (e) e[1] = t; else edge.set(k, [t, -1]); };
  const drop = (a, b, t) => { const k = key(a, b), e = edge.get(k); if (!e) return; if (e[0] === t) { e[0] = e[1]; } e[1] = -1; if (e[0] < 0) edge.delete(k); };
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) add(tris[t][k], tris[t][(k + 1) % 3], t);
  // An edge that three or more triangles share (stacked duplicate faces), or that belongs to a triangle with a repeated corner, is
  // never turned, and no flip may use it as a side of the quad: the bookkeeping below holds two triangles to an edge.
  const mult = new Map(), frozen = new Set();
  for (let t = 0; t < n; t++) {
    const q = tris[t], flat = q[0] === q[1] || q[1] === q[2] || q[0] === q[2];
    for (let k = 0; k < 3; k++) { const kk = key(q[k], q[(k + 1) % 3]); mult.set(kk, (mult.get(kk) || 0) + 1); if (flat) frozen.add(kk); }
  }
  for (const [kk, m] of mult) if (m > 2) frozen.add(kk);
  const inCircle = (a, b, c, d) => {               // d inside the circle of the counter-clockwise a, b, c
    const ax = pts[a][0] - pts[d][0], ay = pts[a][1] - pts[d][1], bx = pts[b][0] - pts[d][0], by = pts[b][1] - pts[d][1], cx = pts[c][0] - pts[d][0], cy = pts[c][1] - pts[d][1];
    return (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
  };
  const eps = tol * tol;
  const queue = [...edge.keys()];
  let guard = n * 40 + 1000;
  while (queue.length && guard-- > 0) {
    const k = queue.pop(), e = edge.get(k);
    if (!e || e[1] < 0) continue;
    const t1 = tris[e[0]], t2 = tris[e[1]];
    const [a, b] = k.split(',').map(Number);
    const c = t1.find(v => v !== a && v !== b), d = t2.find(v => v !== a && v !== b);
    if (c === undefined || d === undefined || c === d) continue;
    if (frozen.has(k) || frozen.has(key(a, c)) || frozen.has(key(b, c)) || frozen.has(key(a, d)) || frozen.has(key(b, d))) continue;
    // the new diagonal c-d must lie inside the quad: both new triangles need real width
    const ca = cross(c, a, d), cb = cross(c, d, b);
    if (!(Math.abs(ca) > eps && Math.abs(cb) > eps && (ca > 0) === (cb > 0))) continue;
    const ccw = cross(c, a, b) > 0 ? [c, a, b] : [c, b, a];
    if (!(inCircle(ccw[0], ccw[1], ccw[2], d) > 0)) continue;
    const i1 = e[0], i2 = e[1];
    for (const [x, y, t] of [[a, b, i1], [b, c, i1], [c, a, i1], [a, b, i2], [b, d, i2], [d, a, i2]]) drop(x, y, t);
    const n1 = cross(c, d, b) > 0 ? [c, d, b] : [c, b, d], n2 = cross(c, a, d) > 0 ? [c, a, d] : [c, d, a];
    tris[i1] = n1; tris[i2] = n2;
    for (const [x, y, t] of [[n1[0], n1[1], i1], [n1[1], n1[2], i1], [n1[2], n1[0], i1], [n2[0], n2[1], i2], [n2[1], n2[2], i2], [n2[2], n2[0], i2]]) add(x, y, t);
    for (const [x, y] of [[a, c], [c, b], [b, d], [d, a]]) queue.push(key(x, y));
  }
}

// Triangulate: the same polygons untriangulate finds, but their triangles are only turned, never taken away. Every vertex, every
// outline edge and the number of triangles stay as they are; inside each flat polygon the edges are flipped until no triangle's
// circle holds another corner (the most even triangles those points allow). Returns { index, poly, stats } like untriangulate,
// or null; `rebuilt` counts the polygons whose triangles changed.
//   opts.angleDeg   how far a triangle may turn from the polygon's first triangle (default 1)
export function evenTriangles(positions, index, opts = {}) {
  const { angleDeg = 1 } = opts;
  const a = analysePolygons(positions, index, angleDeg);
  if (!a) return null;
  const { T, tv, canon, diag, nrm, poly, polys } = a;
  const tol = diag * 5e-6;
  const stats = { trisBefore: T, trisAfter: T, polygons: polys, joined: 0, rebuilt: 0, vertsRemoved: 0, kept: { touching: 0, curved: 0, shading: 0, other: 0 } };
  const out = new Uint32Array(T * 3);
  for (let t = 0; t < T; t++) { out[t * 3] = tv(t, 0); out[t * 3 + 1] = tv(t, 1); out[t * 3 + 2] = tv(t, 2); }
  const start = new Int32Array(polys + 1);
  for (let t = 0; t < T; t++) start[poly[t] + 1]++;
  for (let p = 0; p < polys; p++) start[p + 1] += start[p];
  const fill = start.slice(0, polys), order = new Int32Array(T);
  for (let t = 0; t < T; t++) order[fill[poly[t]]++] = t;
  const P = (v, c) => positions[v * 3 + c];
  for (let p = 0; p < polys; p++) {
    const from = start[p], to = start[p + 1], n = to - from;
    if (n < 2) continue;
    stats.joined++;
    const seed = order[from];
    if (!a.ok[seed]) { stats.kept.other++; continue; }
    const N = [nrm[seed * 3], nrm[seed * 3 + 1], nrm[seed * 3 + 2]];
    const helper = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ux = N[1] * helper[2] - N[2] * helper[1], uy = N[2] * helper[0] - N[0] * helper[2], uz = N[0] * helper[1] - N[1] * helper[0];
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = N[1] * uz - N[2] * uy, vy = N[2] * ux - N[0] * uz, vz = N[0] * uy - N[1] * ux;
    const local = new Map(), pts = [], rep = [];
    const tris = [], orig = new Map();
    let bad = false;
    for (let i = from; i < to; i++) {
      const t = order[i];
      if (!a.ok[t]) { bad = true; break; }
      const q = [];
      for (let k = 0; k < 3; k++) {
        const v = tv(t, k), c = canon[v];
        let li = local.get(c);
        if (li === undefined) { li = pts.length; local.set(c, li); pts.push([P(v, 0) * ux + P(v, 1) * uy + P(v, 2) * uz, P(v, 0) * vx + P(v, 1) * vy + P(v, 2) * vz]); rep.push(v); }
        q.push(li);
      }
      tris.push(q);
      orig.set(q.slice().sort((x, y) => x - y).join(','), [tv(t, 0), tv(t, 1), tv(t, 2)]);
    }
    if (bad) { stats.kept.other++; continue; }
    const before = new Set(orig.keys());
    const work = tris.map(q => q.slice());
    flipToDelaunay(work, pts, tol);
    let changed = 0;
    for (const q of work) if (!before.has(q.slice().sort((x, y) => x - y).join(','))) changed++;
    if (!changed) continue;
    work.forEach((q, i) => {
      const o = orig.get(q.slice().sort((x, y) => x - y).join(','));
      const t = order[from + i];
      if (o) { out[t * 3] = o[0]; out[t * 3 + 1] = o[1]; out[t * 3 + 2] = o[2]; }
      else { out[t * 3] = rep[q[0]]; out[t * 3 + 1] = rep[q[1]]; out[t * 3 + 2] = rep[q[2]]; }
    });
    stats.rebuilt++;
  }
  return { index: out, poly: Int32Array.from(poly), stats };
}

// Pair into quads (Blender's Face › Triangles to Quads, bmesh join_triangles): two triangles that share an edge become one four-sided
// polygon when they are folded apart by no more than opts.faceDeg (default 40) and every corner of the four-sided shape they make is
// within opts.shapeDeg of square (default 40). The pairs are taken best first (the least fold plus the least out of square), each
// triangle in one pair at most, so a triangulated quad mesh gets its quads back on curved surfaces too, where the flat join above
// finds nothing. No point moves and no triangle is added or taken away: only the polygon each triangle belongs to changes (the OBJ
// and FBX writers then write the quads). Never paired across
//   - an edge where a mesh does not fold cleanly (three triangles on it, or two that run it the same way, one of them turned over),
//   - a CAD face boundary (opts.face: the CAD face of each triangle, from _Brep; -1 where unknown),
//   - a UV seam (opts.uvs: xy per vertex; the two triangles' corners on the shared edge must have the same UVs),
//   - a four-sided shape that is not convex (its other diagonal would leave it).
// Returns { index (the same triangles), poly, stats } like untriangulate, or null.
export function pairIntoQuads(positions, index, opts = {}) {
  const faceDeg = opts.faceDeg > 0 ? +opts.faceDeg : 40, shapeDeg = opts.shapeDeg > 0 ? +opts.shapeDeg : 40;
  const face = opts.face || null, uvs = opts.uvs || null;
  const vc = Math.floor(positions.length / 3), T = index ? Math.floor(index.length / 3) : Math.floor(vc / 3);
  if (!T) return null;
  const tv = index ? (t, k) => index[t * 3 + k] : (t, k) => t * 3 + k;
  const P = (v, c) => positions[v * 3 + c];
  // corners at one place are one point (the split points of a seam or a shading crease)
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < vc; i++) {
    const x = P(i, 0), y = P(i, 1), z = P(i, 2);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1, cell = diag * 1e-6;
  const canon = new Int32Array(vc), seen = new Map();
  let nC = 0;
  for (let i = 0; i < vc; i++) {
    const key = Math.round((P(i, 0) - x0) / cell) + ',' + Math.round((P(i, 1) - y0) / cell) + ',' + Math.round((P(i, 2) - z0) / cell);
    let id = seen.get(key); if (id === undefined) { id = nC++; seen.set(key, id); } canon[i] = id;
  }
  seen.clear();
  const nrm = new Float64Array(T * 3), ok = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const a = tv(t, 0), b = tv(t, 1), c = tv(t, 2);
    if (canon[a] === canon[b] || canon[b] === canon[c] || canon[a] === canon[c]) continue;
    const ux = P(b, 0) - P(a, 0), uy = P(b, 1) - P(a, 1), uz = P(b, 2) - P(a, 2), vx = P(c, 0) - P(a, 0), vy = P(c, 1) - P(a, 1), vz = P(c, 2) - P(a, 2);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (!(l > diag * diag * 1e-14)) continue;
    nrm[t * 3] = nx / l; nrm[t * 3 + 1] = ny / l; nrm[t * 3 + 2] = nz / l; ok[t] = 1;
  }
  // each edge with the triangle slots (t * 3 + k, the side from corner k to k + 1) that have it
  const edges = new Map();
  for (let t = 0; t < T; t++) {
    if (!ok[t]) continue;
    for (let k = 0; k < 3; k++) {
      const p = canon[tv(t, k)], q = canon[tv(t, (k + 1) % 3)], key = p < q ? p * nC + q : q * nC + p;
      const e = edges.get(key); if (e) e.push(t * 3 + k); else edges.set(key, [t * 3 + k]);
    }
  }
  const limF = faceDeg * Math.PI / 180, limS = shapeDeg * Math.PI / 180;
  const corner = (p, q, r) => {                    // how far the corner at p, between the sides to q and r, is from square
    const ux = P(q, 0) - P(p, 0), uy = P(q, 1) - P(p, 1), uz = P(q, 2) - P(p, 2), vx = P(r, 0) - P(p, 0), vy = P(r, 1) - P(p, 1), vz = P(r, 2) - P(p, 2);
    const l = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
    if (!(l > 0)) return Infinity;
    let c = (ux * vx + uy * vy + uz * vz) / l; c = c < -1 ? -1 : c > 1 ? 1 : c;
    return Math.abs(Math.acos(c) - Math.PI / 2);
  };
  const sameUv = (i, j) => !uvs || (Math.abs(uvs[i * 2] - uvs[j * 2]) <= 1e-6 && Math.abs(uvs[i * 2 + 1] - uvs[j * 2 + 1]) <= 1e-6);
  const stats = { trisBefore: T, trisAfter: T, polygons: T, quads: 0, seams: 0, faces: 0, rebuilt: 0, vertsRemoved: 0, kept: { touching: 0, curved: 0, shading: 0, other: 0 } };
  const cand = [];
  for (const slots of edges.values()) {
    if (slots.length !== 2) continue;
    const s1 = slots[0], s2 = slots[1], t1 = (s1 / 3) | 0, t2 = (s2 / 3) | 0, k1 = s1 % 3, k2 = s2 % 3;
    if (t1 === t2) continue;
    // t1 runs the edge a → b, t2 must run it b → a (both facing the same way)
    const a1 = tv(t1, k1), b1 = tv(t1, (k1 + 1) % 3), c = tv(t1, (k1 + 2) % 3);
    const b2 = tv(t2, k2), a2 = tv(t2, (k2 + 1) % 3), d = tv(t2, (k2 + 2) % 3);
    if (canon[b2] !== canon[b1] || canon[a2] !== canon[a1] || canon[c] === canon[d]) continue;
    if (face && face[t1] !== face[t2] && (face[t1] >= 0 || face[t2] >= 0)) { stats.faces++; continue; }
    if (!sameUv(a1, a2) || !sameUv(b1, b2)) { stats.seams++; continue; }
    let cf = nrm[t1 * 3] * nrm[t2 * 3] + nrm[t1 * 3 + 1] * nrm[t2 * 3 + 1] + nrm[t1 * 3 + 2] * nrm[t2 * 3 + 2]; cf = cf < -1 ? -1 : cf > 1 ? 1 : cf;
    const fold = Math.acos(cf);
    if (fold > limF) continue;
    // the four-sided shape a, d, b, c: its corners at a and b lie between c and d, those at c and d between a and b
    const sq = [corner(a1, c, d), corner(b1, c, d), corner(c, a1, b1), corner(d, a1, b1)];
    const worst = Math.max(...sq);
    if (!(worst <= limS)) continue;
    // convex: a and b on either side of the other diagonal c-d, seen along the two triangles' mean normal
    const nx = nrm[t1 * 3] + nrm[t2 * 3], ny = nrm[t1 * 3 + 1] + nrm[t2 * 3 + 1], nz = nrm[t1 * 3 + 2] + nrm[t2 * 3 + 2];
    const side = (v) => {
      const ex = P(d, 0) - P(c, 0), ey = P(d, 1) - P(c, 1), ez = P(d, 2) - P(c, 2), fx = P(v, 0) - P(c, 0), fy = P(v, 1) - P(c, 1), fz = P(v, 2) - P(c, 2);
      return (ey * fz - ez * fy) * nx + (ez * fx - ex * fz) * ny + (ex * fy - ey * fx) * nz;
    };
    const sa = side(a1), sb = side(b1);
    if (!(sa * sb < 0)) continue;
    cand.push([fold / limF + (sq[0] + sq[1] + sq[2] + sq[3]) / (4 * limS), t1, t2]);
  }
  cand.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const mate = new Int32Array(T).fill(-1);
  for (const [, t1, t2] of cand) if (mate[t1] < 0 && mate[t2] < 0) { mate[t1] = t2; mate[t2] = t1; stats.quads++; }
  const poly = new Int32Array(T).fill(-1);
  let count = 0;
  for (let t = 0; t < T; t++) { if (poly[t] >= 0) continue; poly[t] = count; if (mate[t] >= 0) poly[mate[t]] = count; count++; }
  stats.polygons = count;
  const out = new Uint32Array(T * 3);
  for (let t = 0; t < T; t++) { out[t * 3] = tv(t, 0); out[t * 3 + 1] = tv(t, 1); out[t * 3 + 2] = tv(t, 2); }
  return { index: out, poly, stats };
}
