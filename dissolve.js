// dissolve.js — take points out of a triangle mesh and close the surface over them.
//
// Dissolve is what Cinema 4D and Blender call removing a point without making a hole: the triangles round it go and the ring they
// made is triangulated again without it. It is used twice:
//   - Edit mesh › Dissolve: the picked points, or (for picked edges and polygons) the points that are left inside a polygon or on a
//     straight run of its outline once the edge between two polygons has gone.
//   - Untriangulate: the points that only sit on a straight run of an outline (a long edge cut up by points that say nothing about
//     the shape).
//
// A point can go in three ways, each only when it is allowed to:
//   interior   no outline passes through it: the polygon round it is one, the ring of its triangles is closed.
//   straight   exactly two outline edges meet at it, in a straight line. Every polygon that touches it (one at the rim of a mesh,
//              two where it is on the edge between two polygons) is rebuilt without it, all at once, so there is no crack
//              (T-junction) where a neighbour still has the point.
//   merge      any other point (only for a point the user picked): every polygon round it becomes one, and the ring is triangulated.
//
// Nothing is moved. New triangles are made of vertices that were already there, taken from the triangles they replace, so each
// side of a hard edge keeps its own shading. With `strict` (the default) a point goes only when the ring and the point lie in one
// plane (within 2e-5 of the mesh's size), their normals (if given) agree with it, and the area is the same afterwards: nothing
// changes in how the surface looks.
//
//   positions   Float32Array, xyz per vertex
//   index       Uint32Array, the triangles (null is not accepted: give 0, 1, 2, ...)
//   lab         Int32Array, the polygon of each triangle
//   weld        Uint32Array, per vertex the number of the place it stands on (corners at one place have one number)
//   points      the places (weld numbers) to try
//   opts        triangulate (contour, holes) → [[i, j, k], …]   required (THREE.ShapeUtils, passed in)
//               normals, normalTol (5°), strict (true), allowInterior (true), allowStraight (true), allowMerge (false)
//               planeTol, lineTol   in mesh units; the default is from the size of the mesh
//               limitDeg (0 = off), limitTol (mesh units; 0.1% of the size), limitMerge   limited dissolve, for faces that are nearly flat:
//                 a point goes when the triangles round it turn by no more than limitDeg and the surface moves by less than limitTol;
//                 with limitMerge the polygons round a point that is inside the mesh become one
// Returns { removed (Uint8Array over the triangles: 1 = gone), caps (Uint32Array, the new triangles' vertices), capOwner (Int32Array: an
//           old triangle each new one stands in for, for its material group), capPoly (Int32Array), polyOld (Int32Array: the polygon
//           of every old triangle after the merges, -1 for a removed one; the numbers are 0, 1, 2, ... and shared with capPoly),
//           dissolved (how many places), left (how many could not) }

export function dissolvePoints(positions, index, lab, weld, points, opts = {}) {
  const { triangulate, normals = null, normalTol = 5, strict = true, allowInterior = true, allowStraight = true, allowMerge = false } = opts;
  if (typeof triangulate !== 'function') throw new Error('dissolvePoints needs a triangulate function');
  // Limited dissolve (limitDeg > 0): for faces that are nearly flat, not exactly. A point goes when the triangles round it turn from
  // the ring's normal by no more than limitDeg, the ring and the point lie within limitTol of one plane, and (if normals are given)
  // the shading turns by no more than limitDeg + normalTol. Where it was, the surface closes over it and moves by less than limitTol.
  const limitDeg = opts.limitDeg > 0 ? opts.limitDeg : 0, tolerant = limitDeg > 0;
  const cosLimit = Math.cos(limitDeg * Math.PI / 180), cosLimitN = Math.cos((limitDeg + normalTol) * Math.PI / 180);
  const nTri = (index.length / 3) | 0;
  const P = (v, c) => positions[v * 3 + c];

  // the size of the mesh: what counts as "in the plane" and "on the line"
  let diag = 0;
  {
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < index.length; i++) {
      const v = index[i], x = P(v, 0), y = P(v, 1), z = P(v, 2);
      if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    }
    diag = index.length ? Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) : 0;
  }
  const planeTol = opts.planeTol > 0 ? opts.planeTol : diag * 2e-5, lineTol = opts.lineTol > 0 ? opts.lineTol : diag * 5e-6;
  const limitTol = opts.limitTol > 0 ? opts.limitTol : diag * 1e-3;
  const cosN = Math.cos(normalTol * Math.PI / 180);

  // the triangles: the old ones, then the ones that replace them (room is made as needed)
  let cap = nTri + 1024;
  let C = new Uint32Array(cap * 3); C.set(index);
  let LB = new Int32Array(cap); LB.set(lab);
  let OW = new Int32Array(cap); for (let t = 0; t < nTri; t++) OW[t] = t;
  let alive = new Uint8Array(cap); alive.fill(1, 0, nTri);
  let nAll = nTri;
  const grow = () => {
    cap *= 2;
    const C2 = new Uint32Array(cap * 3); C2.set(C); C = C2;
    const L2 = new Int32Array(cap); L2.set(LB); LB = L2;
    const O2 = new Int32Array(cap); O2.set(OW); OW = O2;
    const A2 = new Uint8Array(cap); A2.set(alive); alive = A2;
  };

  // the triangles at each place: the old ones from a table, the new ones in a map
  let nW = 0;
  for (let i = 0; i < weld.length; i++) if (weld[i] + 1 > nW) nW = weld[i] + 1;
  const start = new Uint32Array(nW + 1);
  for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) start[weld[index[t * 3 + k]] + 1]++;
  for (let w = 0; w < nW; w++) start[w + 1] += start[w];
  const fill = start.slice(0, nW), around = new Uint32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) around[fill[weld[index[t * 3 + k]]]++] = t;
  const extra = new Map();
  const incident = (c) => {
    const out = [];
    if (c < nW) for (let i = start[c]; i < start[c + 1]; i++) { const t = around[i]; if (alive[t] && out[out.length - 1] !== t) out.push(t); }
    const ex = extra.get(c);
    if (ex) for (const t of ex) if (alive[t]) out.push(t);
    return out;
  };
  const addTri = (a, b, c, label, owner) => {
    if (nAll >= cap) grow();
    const t = nAll++;
    C[t * 3] = a; C[t * 3 + 1] = b; C[t * 3 + 2] = c; LB[t] = label; OW[t] = owner; alive[t] = 1;
    for (const v of [a, b, c]) { const w = weld[v]; let l = extra.get(w); if (!l) extra.set(w, l = []); l.push(t); }
    return t;
  };

  // the polygons that have become one
  let maxLab = 0; for (let t = 0; t < nTri; t++) if (lab[t] > maxLab) maxLab = lab[t];
  const uf = new Int32Array(maxLab + 1); for (let i = 0; i <= maxLab; i++) uf[i] = i;
  const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) uf[b] = a; else uf[a] = b; } };

  // the ring of triangles round a point, as a chain of vertices. Each entry: { t, va, vb, wa, wb } (the triangle's other two corners
  // in its own order, so the fan runs a → b round the point). Open when the fan has a start and an end (the point is at a rim).
  const chainOf = (G) => {
    const next = new Map(), ends = new Set();
    for (const f of G) { if (next.has(f.wa)) return null; next.set(f.wa, f); ends.add(f.wb); }
    let first = null;
    for (const w of next.keys()) if (!ends.has(w)) { if (first !== null) return null; first = w; }
    const verts = [];
    if (first === null) {
      const w0 = next.keys().next().value;
      let w = w0, guard = 0;
      do { const f = next.get(w); if (!f) return null; verts.push(f.va); w = f.wb; if (++guard > G.length + 1) return null; } while (w !== w0);
      if (verts.length !== G.length) return null;
      return { verts, closed: true };
    }
    let w = first; verts.push(next.get(w).va);
    while (next.has(w)) { const f = next.get(w); verts.push(f.vb); w = f.wb; if (verts.length > G.length + 2) return null; }
    if (verts.length !== G.length + 1) return null;
    return { verts, closed: false, startW: first, endW: w };
  };

  function tryDissolve(c) {
    const I = incident(c);
    if (!I.length) return false;
    const info = [];
    for (const t of I) {
      let k = -1;
      for (let j = 0; j < 3; j++) if (weld[C[t * 3 + j]] === c) { if (k >= 0) return false; k = j; }
      if (k < 0) return false;
      const vc = C[t * 3 + k], va = C[t * 3 + (k + 1) % 3], vb = C[t * 3 + (k + 2) % 3], wa = weld[va], wb = weld[vb];
      if (wa === c || wb === c || wa === wb) return false;
      info.push({ t, vc, va, vb, wa, wb });
    }
    // the neighbours, and which edges to them are on an outline (open, or another polygon on the other side)
    const nb = new Map(), rawOf = new Map();
    for (const f of info) {
      for (const [w, v] of [[f.wa, f.va], [f.wb, f.vb]]) { let a = nb.get(w); if (!a) nb.set(w, a = []); a.push(f.t); if (!rawOf.has(w)) rawOf.set(w, v); }
    }
    const real = [];
    for (const [w, a] of nb) {
      if (a.length > 2) return false;                                              // (an edge of three triangles: not a surface)
      if (a.length === 1 || find(LB[a[0]]) !== find(LB[a[1]])) real.push(w);
    }
    const vc0 = info[0].vc;
    const labels = new Set(info.map(f => find(LB[f.t])));
    let plan = null;
    if (!real.length) {
      if (!allowInterior) return false;
      const ch = chainOf(info);
      if (!ch || !ch.closed) return false;
      plan = [{ G: info, ch, label: [...labels][0] }];
    } else {
      // is the point on a straight run between these two neighbours (within the tolerance, and turning by no more than the limit)?
      const straightPair = (w1, w2) => {
        const p1 = rawOf.get(w1), p2 = rawOf.get(w2);
        const ex = P(p2, 0) - P(p1, 0), ey = P(p2, 1) - P(p1, 1), ez = P(p2, 2) - P(p1, 2), fx = P(vc0, 0) - P(p1, 0), fy = P(vc0, 1) - P(p1, 1), fz = P(vc0, 2) - P(p1, 2);
        const len2 = ex * ex + ey * ey + ez * ez, dot = ex * fx + ey * fy + ez * fz;
        const cx = ey * fz - ez * fy, cy = ez * fx - ex * fz, cz = ex * fy - ey * fx;
        const lt = tolerant ? limitTol : lineTol;
        let s = len2 > 0 && Math.hypot(cx, cy, cz) <= lt * Math.sqrt(len2) && dot > 0 && dot < len2;
        if (s && tolerant) {
          const gx = P(p2, 0) - P(vc0, 0), gy = P(p2, 1) - P(vc0, 1), gz = P(p2, 2) - P(vc0, 2);
          const l1 = Math.hypot(fx, fy, fz), l2 = Math.hypot(gx, gy, gz);
          s = l1 > 0 && l2 > 0 && (fx * gx + fy * gy + fz * gz) / (l1 * l2) >= cosLimit;
        }
        return s;
      };
      const isStraight = real.length === 2 && straightPair(real[0], real[1]);
      // a point on the rim of the mesh, on a straight run of the rim, with polygons meeting at it: the polygons can become one with
      // the outline staying where it is (limited dissolve)
      const open = []; for (const [w, a] of nb) if (a.length === 1) open.push(w);
      const rimStraight = tolerant && opts.limitMerge && open.length === 2 && straightPair(open[0], open[1]);
      if (isStraight && allowStraight) {
        plan = [];
        const byLabel = new Map();
        for (const f of info) { const l = find(LB[f.t]); let a = byLabel.get(l); if (!a) byLabel.set(l, a = []); a.push(f); }
        for (const [label, G] of byLabel) {
          const ch = chainOf(G);
          if (!ch || ch.closed) return false;
          if (!((ch.startW === real[0] && ch.endW === real[1]) || (ch.startW === real[1] && ch.endW === real[0]))) return false;
          plan.push({ G, ch, label });
        }
      } else if (allowMerge || (tolerant && opts.limitMerge)) {
        const ch = chainOf(info);
        if (!ch) return false;
        if (!allowMerge && !ch.closed && !rimStraight) return false;       // (limited dissolve: at the rim of a mesh only a point on a straight run goes, so the outline stays)
        plan = [{ G: info, ch, label: Math.min(...labels) }];
      } else return false;
    }

    // each ring is triangulated without the point
    const made = [];
    for (const pl of plan) {
      const verts = pl.ch.verts, n = verts.length;
      if (n < 3) return false;
      let nx = 0, ny = 0, nz = 0;                                                  // (Newell: the normal of the ring, the way the fan goes round)
      for (let i = 0; i < n; i++) {
        const p = verts[i], q = verts[(i + 1) % n];
        nx += (P(p, 1) - P(q, 1)) * (P(p, 2) + P(q, 2)); ny += (P(p, 2) - P(q, 2)) * (P(p, 0) + P(q, 0)); nz += (P(p, 0) - P(q, 0)) * (P(p, 1) + P(q, 1));
      }
      const nl = Math.hypot(nx, ny, nz);
      if (!(nl > 0)) return false;
      nx /= nl; ny /= nl; nz /= nl;
      if (strict) {
        const tol = tolerant ? limitTol : planeTol;
        if (!tolerant) {
          for (const v of verts) if (Math.abs(nx * (P(v, 0) - P(vc0, 0)) + ny * (P(v, 1) - P(vc0, 1)) + nz * (P(v, 2) - P(vc0, 2))) > tol) return false;
        } else {
          // the ring and the point lie within the tolerance of one plane through the middle of the ring (a plane through the point
          // would tilt with the noise, and a long ring would be far off it at its ends)
          let mx0 = 0, my0 = 0, mz0 = 0;
          for (const v of verts) { mx0 += P(v, 0); my0 += P(v, 1); mz0 += P(v, 2); }
          mx0 /= n; my0 /= n; mz0 /= n;
          // (half the tolerance: each point is judged against the surface as it is by then, so steps next to each other add up, and
          // with a whole region going the surface ends up within about the tolerance of where it was)
          for (const v of [vc0, ...verts]) if (Math.abs(nx * (P(v, 0) - mx0) + ny * (P(v, 1) - my0) + nz * (P(v, 2) - mz0)) > tol * 0.5) return false;
        }
        if (tolerant) {
          // every triangle that goes turns from the ring's normal by no more than the limit
          for (const f of pl.G) {
            const ex = P(f.va, 0) - P(f.vc, 0), ey = P(f.va, 1) - P(f.vc, 1), ez = P(f.va, 2) - P(f.vc, 2), gx = P(f.vb, 0) - P(f.vc, 0), gy = P(f.vb, 1) - P(f.vc, 1), gz = P(f.vb, 2) - P(f.vc, 2);
            const mx = ey * gz - ez * gy, my = ez * gx - ex * gz, mz = ex * gy - ey * gx, ml = Math.hypot(mx, my, mz);
            // A thin triangle is judged by the distances above: all its corners are within the tolerance of one plane, so it can only tilt
            // more than the limit across a width smaller than 2 × tolerance / tan(limit), and there the tilt is noise (a normal of a sliver
            // jumps with the last digit of its corners).
            const longest = Math.max(Math.hypot(ex, ey, ez), Math.hypot(gx, gy, gz), Math.hypot(gx - ex, gy - ey, gz - ez));
            if (ml > 0 && ml / longest >= 2 * limitTol / Math.tan(limitDeg * Math.PI / 180) && (mx * nx + my * ny + mz * nz) / ml < cosLimit) return false;
          }
          if (normals) for (const v of [vc0, ...verts]) if (normals[v * 3] * nx + normals[v * 3 + 1] * ny + normals[v * 3 + 2] * nz < cosLimitN) return false;
        } else if (normals) for (const v of [vc0, ...verts]) if (normals[v * 3] * nx + normals[v * 3 + 1] * ny + normals[v * 3 + 2] * nz < cosN) return false;
      }
      const hx = Math.abs(nx) < 0.9 ? 1 : 0, hy = hx ? 0 : 1;
      let ux = ny * 0 - nz * hy, uy = nz * hx - nx * 0, uz = nx * hy - ny * hx;
      const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      const pts = verts.map(v => [P(v, 0) * ux + P(v, 1) * uy + P(v, 2) * uz, P(v, 0) * vx + P(v, 1) * vy + P(v, 2) * vz]);
      // The ring can run along a straight line for several points (the far side of a plate that is cut into a fan): the triangulator
      // would make a triangle of no width there. It is given the ring without those points, and they are put back afterwards by
      // cutting the triangle that has that stretch as a side, so every point of the ring is still used and no crack opens.
      const ct = tolerant ? limitTol : lineTol;                                    // (nearly straight is straight enough when the tolerance says so)
      const keep = reduceCollinear(pts, ct);
      if (keep.length < 3) return false;
      let tr;
      try { tr = triangulate(keep.map(i => pts[i]), []); } catch (_) { return false; }
      if (!tr || tr.length !== keep.length - 2) return false;
      tr = tr.map(q => [keep[q[0]], keep[q[1]], keep[q[2]]]);
      const has = new Uint8Array(n); for (const q of tr) for (const x of q) has[x] = 1;
      const missing = []; for (let i = 0; i < n; i++) if (!has[i]) missing.push(i);
      if (missing.length && !restoreDropped(tr, pts, missing, ct)) return false;
      let area = 0;
      const fresh = [];
      for (const q of tr) {
        let [x, y, z] = q;
        const s = (pts[y][0] - pts[x][0]) * (pts[z][1] - pts[x][1]) - (pts[z][0] - pts[x][0]) * (pts[y][1] - pts[x][1]);
        if (s < 0) { const w = y; y = z; z = w; }
        const l01 = (pts[y][0] - pts[x][0]) ** 2 + (pts[y][1] - pts[x][1]) ** 2, l12 = (pts[z][0] - pts[y][0]) ** 2 + (pts[z][1] - pts[y][1]) ** 2, l20 = (pts[x][0] - pts[z][0]) ** 2 + (pts[x][1] - pts[z][1]) ** 2;
        if (Math.abs(s) < (tolerant ? 1e-9 : 1e-5) * Math.max(l01, l12, l20)) return false;           // (a triangle with no width is a defect)
        area += Math.abs(s) / 2;
        fresh.push([verts[x], verts[y], verts[z]]);
      }
      if (strict) {
        let was = 0;
        for (const f of pl.G) {
          const ex = P(f.va, 0) - P(f.vc, 0), ey = P(f.va, 1) - P(f.vc, 1), ez = P(f.va, 2) - P(f.vc, 2), gx = P(f.vb, 0) - P(f.vc, 0), gy = P(f.vb, 1) - P(f.vc, 1), gz = P(f.vb, 2) - P(f.vc, 2);
          was += Math.hypot(ey * gz - ez * gy, ez * gx - ex * gz, ex * gy - ey * gx) / 2;
        }
        if (Math.abs(area - was) > was * (tolerant ? 2e-2 : 1e-3)) return false;
      }
      made.push({ pl, fresh });
    }

    // all of it worked: the old triangles go, the new ones come
    for (const f of info) alive[f.t] = 0;
    for (const { pl, fresh } of made) for (const q of fresh) addTri(q[0], q[1], q[2], pl.label, OW[pl.G[0].t]);
    if (plan.length === 1 && labels.size > 1) { const l0 = plan[0].label; for (const l of labels) union(l0, l); }
    return true;
  }

  let todo = [...points], dissolved = 0;
  const done = new Set();
  for (let sweep = 0; sweep < 3 && todo.length; sweep++) {
    const next = [];
    for (const c of todo) {
      if (done.has(c)) continue;
      if (tryDissolve(c)) { dissolved++; done.add(c); } else next.push(c);
    }
    if (next.length === todo.length) { todo = next; break; }                        // (nothing more is possible)
    todo = next;
  }

  // the answer
  const removed = new Uint8Array(nTri);
  let gone = 0;
  for (let t = 0; t < nTri; t++) if (!alive[t]) { removed[t] = 1; gone++; }
  const ids = new Map(); let k = 0;
  const num = (t) => { const r = find(LB[t]); let m = ids.get(r); if (m === undefined) ids.set(r, m = k++); return m; };
  const polyOld = new Int32Array(nTri);
  for (let t = 0; t < nTri; t++) polyOld[t] = alive[t] ? num(t) : -1;
  const newT = [];
  for (let t = nTri; t < nAll; t++) if (alive[t]) newT.push(t);
  const caps = new Uint32Array(newT.length * 3), capOwner = new Int32Array(newT.length), capPoly = new Int32Array(newT.length);
  newT.forEach((t, i) => { caps[i * 3] = C[t * 3]; caps[i * 3 + 1] = C[t * 3 + 1]; caps[i * 3 + 2] = C[t * 3 + 2]; capOwner[i] = OW[t]; capPoly[i] = num(t); });
  return { removed, caps, capOwner, capPoly, polyOld, dissolved, left: todo.length, trisRemoved: gone, trisAdded: newT.length };
}

// The index and polygons after a dissolve, as one list: the triangles that stay in their order, then the new ones.
export function applyDissolve(index, res) {
  const nTri = (index.length / 3) | 0, keep = nTri - res.trisRemoved, total = keep + res.trisAdded;
  const out = new Uint32Array(total * 3), poly = new Int32Array(total);
  let w = 0;
  for (let t = 0; t < nTri; t++) if (!res.removed[t]) { out[w * 3] = index[t * 3]; out[w * 3 + 1] = index[t * 3 + 1]; out[w * 3 + 2] = index[t * 3 + 2]; poly[w++] = res.polyOld[t]; }
  for (let i = 0; i < res.trisAdded; i++) { out[w * 3] = res.caps[i * 3]; out[w * 3 + 1] = res.caps[i * 3 + 1]; out[w * 3 + 2] = res.caps[i * 3 + 2]; poly[w++] = res.capPoly[i]; }
  return { index: out, poly };
}

// ── helpers shared with untriangulate.js ─────────────────────────────────────────────────────────────────────────
// Put back the outline vertices `missing` (local numbers into `pts`) that lie on a side of one of `tris`.
export function restoreDropped(tris, pts, missing, tol) {
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


// The points of a closed loop that are not just on a straight run between their neighbours (local numbers).
// A point is dropped when it lies on the line through the one before and the one after and between them.
export function reduceCollinear(pts, tol) {
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
