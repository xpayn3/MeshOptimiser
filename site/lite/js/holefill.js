// holefill.js — close holes in the flat faces of a triangle mesh.
//
// Works on the mesh as it is (no remeshing, no decimation): it finds the flat
// faces, finds the closed loops cut into them, and for each loop decides
// whether it is really a hole before touching anything.
//
//   1. Weld vertices by position (CAD tessellation gives every face its own
//      vertices) and build triangle adjacency.
//   2. Grow planar regions: connected triangles that share one plane. (From a STEP opened with its CAD faces, opts.cadPoly names the
//      plane face of every triangle, and such a face is one region exactly, whatever its triangles' normals say; the rest grows as usual.)
//   3. Each region's boundary splits into loops. The loop that runs
//      counter-clockwise around the face normal is its outline; clockwise
//      loops are openings in the face — candidates.
//   4. From a candidate loop, flood through the triangles on the far side
//      (the hole's wall, floor, countersink …) without crossing any candidate
//      loop. What comes back is the hole's interior surface.
//   5. It is a hole only if that surface
//        · is fully enclosed by candidate loops (it never leaks out into the
//          rest of the part — that would be an opening into a cavity),
//        · stays small (no bigger than the size limit allows), and
//        · lies BELOW every face it opens into. A boss or a pin standing on
//          a face produces the same kind of loop but rises above it; those
//          are left alone.
//      An opening that is what the part IS — the bore of a washer, a nut or
//      a bushing, a frame — is not a hole either. It is recognised by being
//      wide both for the face it sits in (over 40 % of the face's outline)
//      and for the part as a whole (over 8 % of its size). The second half
//      matters: the bore of a threaded insert or a collar sits in a small
//      ring-shaped face too, but next to the part it belongs to it is tiny,
//      and it is a hole like any other.
//      Candidates are handled largest first, so a pocket with a hole in its
//      floor goes as one feature when the limit allows, and otherwise only
//      the part of it that is within the limit is filled.
//   6. A hole is removed by deleting its interior surface and triangulating
//      each of its loops flush with the face it sits in, reusing that face's
//      own vertices — so normals, UVs and colours carry over and the mesh
//      stays watertight.
//
// Through holes, blind holes, counterbores, countersinks, hex and slotted
// holes are all the same case here. An opening with nothing behind it (a hole
// in a single-sheet surface) is simply capped.
//
// Raised details (opts.raised). Lettering and logos are modelled both ways on
// the same part: some engraved, which is a shallow pocket and filled like any
// other, and some standing a fraction of a millimetre proud of the face. The
// proud ones are found by the very same steps (the loop round a raised letter
// looks exactly like the loop round a hole; what lies behind it rises instead
// of sinking) and, when asked for, are removed the same way: the letter's
// walls and top go and its footprint is closed flush with the face. Only a
// LOW feature qualifies (opts.raisedMax, its height above the face), standing
// on a single face: that is what tells embossed type from a boss, a pin or a
// rib, which are part of what the part is and stay.
// Whatever other geometry was hidden inside the detail's volume (the inner skin
// of a stamped collar, a floor it was pressed from) goes with it: left there, it
// would stand out of the flattened face.
//
// Pure function, no dependencies: the app calls it per part, the tests call
// it from Node.

// The most triangles a mesh may have. The adjacency is a typed table (three half-edges per triangle, twice as many slots), so
// what limits it is memory in the worker, not the 2^24 entries of a Map.
const MAX_TRIS = 12000000;

export function fillFlatHoles(positions, index, opts = {}) {
  // Flat faces first, exactly as they have always been handled. With opts.curved, a second look follows that is allowed to close
  // only what the first did not touch and only where the surface is curved: so switching it on can add holes, never lose one.
  const r1 = fillFlatHolesPass(positions, index, { ...opts, curved: false });
  if (opts.curved !== true || r1.skipped.tooBig) return r1;
  const r2 = fillFlatHolesPass(positions, index, { ...opts, curved: true, onlyCurved: true, avoid: r1.removed || null,
    floating: false, rimVertices: false, cleanup: false, enclosed: false, seal: false, rings: false, debug: false });
  if (!r2.holes) return r1;
  const T = r2.removed.length, removed = new Uint8Array(T);
  for (let t = 0; t < T; t++) removed[t] = (r1.removed && r1.removed[t]) || r2.removed[t] ? 1 : 0;
  const cat = (a, b) => { const o = new Uint32Array((a ? a.length : 0) + b.length); if (a) o.set(a); o.set(b, a ? a.length : 0); return o; };
  const res = { ...r1, removed, caps: cat(r1.caps, r2.caps), capOwner: cat(r1.capOwner, r2.capOwner) };
  for (const k of ['holes', 'through', 'blind', 'open', 'flattened', 'loops', 'removedTris', 'addedTris']) res[k] = (r1[k] || 0) + (r2[k] || 0);
  res.curvedHoles = r2.holes;
  if (r2.newPositions) for (const k of ['newPositions', 'newSrc', 'newW', 'newNormals', 'fixIds', 'fixNormals']) res[k] = r2[k];
  return res;
}

function fillFlatHolesPass(positions, index, opts = {}) {
  const P = positions;
  const vCount = (P.length / 3) | 0;
  let I = index;
  if (!I) { I = new Uint32Array(vCount); for (let i = 0; i < vCount; i++) I[i] = i; }
  const T = (I.length / 3) | 0;
  const maxSize = +opts.maxSize;                       // widest point of a hole, in the mesh's own units
  const depthFactor = opts.depthFactor || 10;          // interior surface may reach this many sizes deep
  const cosTol = opts.cosTol || 0.99995;               // ~0.57° between normals of one flat face
  const maxComponentTris = opts.maxComponentTris || 60000;
  const bigFactor = opts.bigFactor || 5;               // an opening of a hole may be this many times the size limit (a countersink)
  const maxFaceRatio = opts.maxFaceRatio || 0.4;       // opening / outline of its face …
  const maxPartRatio = opts.maxPartRatio || 0.08;      // … and opening / size of the whole part
  const minSize = +opts.minSize > 0 ? +opts.minSize : 0;   // a feature narrower than this is left alone
  // Curved surfaces (opts.curved): a smooth patch (a cylinder, a fillet, a dome) is one region too, its triangles joined where the
  // normal turns by less than curvedAngle degrees from one to the next. Each opening in it is judged against the surface's own
  // direction at that opening (a normal and a basis kept per loop), not against one plane.
  const curvedOn = opts.curved === true;
  const curvedCos = Math.cos((+opts.curvedAngle > 0 ? +opts.curvedAngle : 12) * Math.PI / 180);
  const pseudoMax = curvedOn ? Math.min(T, 300000) + 1 : 0;
  const maxDepth = +opts.maxDepth > 0 ? +opts.maxDepth : 0; // a blind feature reaching deeper than this below its face is left alone (0: no limit)
  // which kinds to fill (all three unless switched off)
  const want = { through: opts.through !== false, blind: opts.blind !== false, open: opts.open !== false };
  // raised details: off unless asked for, and then only up to this height above their face
  const wantRaised = opts.raised === true && +opts.raisedMax > 0;
  const raisedMax = wantRaised ? +opts.raisedMax : 0;
  // `holes` counts everything that was closed; `flattened` is how many of those were raised details
  const result = { holes: 0, through: 0, blind: 0, open: 0, flattened: 0, loops: 0, removedTris: 0, addedTris: 0,
                   removed: null, caps: null, capOwner: null,
                   skipped: { raised: 0, raisedTall: 0, leaking: 0, tooDeep: 0, tooLarge: 0, partOfShape: 0, tooSmall: 0, kind: 0, uncappable: 0, tooBig: 0 } };
  if (!(maxSize > 0) || T < 4) return result;
  // A mesh larger than MAX_TRIS is left as it is, and says so in skipped.tooBig (1 = this mesh was not looked at).
  if (T > MAX_TRIS) { result.skipped.tooBig = 1; return result; }

  // ── bounding box, tolerances ─────────────────────────────────────────────
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (!(diag > 0)) return result;
  const weldEps = diag * 1e-6;
  const distTol = diag * 2e-5;

  // ── 1. weld by position (open-addressing hash on quantised coordinates) ──
  const inv = 1 / weldEps;
  const wid = new Int32Array(vCount);
  let cap = 1; while (cap < vCount * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1);
  const qx = new Int32Array(vCount), qy = new Int32Array(vCount), qz = new Int32Array(vCount);
  const rep = new Int32Array(vCount);                   // welded id → one original vertex
  let W = 0;
  for (let v = 0; v < vCount; v++) {
    const ix = Math.round((P[v * 3] - x0) * inv), iy = Math.round((P[v * 3 + 1] - y0) * inv), iz = Math.round((P[v * 3 + 2] - z0) * inv);
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (cap - 1);
    for (;;) {
      const w = table[h];
      if (w < 0) { table[h] = W; qx[W] = ix; qy[W] = iy; qz[W] = iz; rep[W] = v; wid[v] = W++; break; }
      if (qx[w] === ix && qy[w] === iy && qz[w] === iz) { wid[v] = w; break; }
      h = (h + 1) & (cap - 1);
    }
  }

  // ── 2. triangles: welded corners, normal, validity ───────────────────────
  const tw = new Int32Array(T * 3);
  // (slots from T on hold the local normals of the openings in curved regions: seedOf(loop) is an index into these arrays)
  const nx = new Float32Array(T + pseudoMax), ny = new Float32Array(T + pseudoMax), nz = new Float32Array(T + pseudoMax);
  let pseudoN = 0;
  const ok = new Uint8Array(T);
  const minArea2 = (diag * 1e-7) * (diag * 1e-7);
  for (let t = 0; t < T; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const wa = wid[a], wb = wid[b], wc = wid[c];
    tw[t * 3] = wa; tw[t * 3 + 1] = wb; tw[t * 3 + 2] = wc;
    if (wa === wb || wb === wc || wa === wc) continue;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const l2 = cx * cx + cy * cy + cz * cz;
    if (!(l2 > minArea2 * minArea2)) continue;
    const l = Math.sqrt(l2);
    nx[t] = cx / l; ny[t] = cy / l; nz[t] = cz / l;
    ok[t] = 1;
  }

  // ── 3. adjacency over welded, directed edges ─────────────────────────────
  // key(a→b) = a * W + b. A second triangle on the same directed edge means
  // the surface is not a clean manifold there; such edges get no neighbour.
  // An open-addressing table of half-edges (a number per slot, no Map): heFind(a, b) is the first half-edge running a→b, or -1.
  // badHe[h] marks the half-edges whose directed edge is used by a second triangle.
  let heCap = 16; while (heCap < T * 6) heCap <<= 1;
  const heMask = heCap - 1;
  const heTab = new Int32Array(heCap).fill(-1);
  const badHe = new Uint8Array(T * 3);
  let badCount = 0;
  const heSlot = (a, b) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & heMask;
  const heFind = (a, b) => {
    for (let s = heSlot(a, b); ; s = (s + 1) & heMask) {
      const h = heTab[s];
      if (h < 0) return -1;
      const t = (h / 3) | 0, e = h - t * 3;
      if (tw[t * 3 + e] === a && tw[t * 3 + (e + 1) % 3] === b) return h;
    }
  };
  const heHas = (a, b) => heFind(a, b) >= 0;
  const heIsBad = (a, b) => { const h = heFind(a, b); return h >= 0 && badHe[h] === 1; };
  for (let t = 0; t < T; t++) {
    if (!ok[t]) continue;
    for (let e = 0; e < 3; e++) {
      const a = tw[t * 3 + e], b = tw[t * 3 + (e + 1) % 3], h = t * 3 + e;
      let s = heSlot(a, b), dup = -1;
      for (; heTab[s] >= 0; s = (s + 1) & heMask) {
        const g = heTab[s], gt = (g / 3) | 0, ge = g - gt * 3;
        if (tw[gt * 3 + ge] === a && tw[gt * 3 + (ge + 1) % 3] === b) { dup = g; break; }
      }
      if (dup >= 0) { if (!badHe[dup]) { badHe[dup] = 1; badCount++; } badHe[h] = 1; } else heTab[s] = h;
    }
  }
  const nb = new Int32Array(T * 3).fill(-1);            // half-edge → twin half-edge
  for (let t = 0; t < T; t++) {
    if (!ok[t]) continue;
    for (let e = 0; e < 3; e++) {
      const a = tw[t * 3 + e], b = tw[t * 3 + (e + 1) % 3];
      if (heIsBad(a, b) || heIsBad(b, a)) continue;
      const o = heFind(b, a);
      if (o >= 0) nb[t * 3 + e] = o;
    }
  }

  // Where a directed edge is used twice (a wall wound the wrong way round, a doubled face) the pair is no neighbour above, so the hole's
  // wall would never be found. These edges keep their triangles in a list of their own, and `twins` hands them out as neighbours.
  const badTris = new Map();                            // undirected edge → half-edges on it
  if (badCount) {
    for (let t = 0; t < T; t++) {
      if (!ok[t]) continue;
      for (let e = 0; e < 3; e++) {
        const a = tw[t * 3 + e], b = tw[t * 3 + (e + 1) % 3];
        if (!(heIsBad(a, b) || heIsBad(b, a))) continue;
        const k = a < b ? a * W + b : b * W + a;
        const l = badTris.get(k); if (l) l.push(t * 3 + e); else badTris.set(k, [t * 3 + e]);
      }
    }
  }
  const NONE = [];
  const twins = (h) => {
    const o = nb[h];
    if (o >= 0) return [o];
    if (!badTris.size) return NONE;
    const t = (h / 3) | 0, e = h % 3, a = tw[t * 3 + e], b = tw[t * 3 + (e + 1) % 3];
    const l = badTris.get(a < b ? a * W + b : b * W + a);
    return l ? l.filter(x => ((x / 3) | 0) !== t) : NONE;
  };

  // ── 4. planar regions ────────────────────────────────────────────────────
  const region = new Int32Array(T).fill(-1);
  const order = new Int32Array(T);                      // triangles grouped by region
  const rStart = [], rEnd = [], rSeed = [], rCurved = [];
  const seedOf = (lp) => lp.s !== undefined ? lp.s : rSeed[lp.r];
  // a point on the surface at the opening, to measure from: on a curved patch no one rim vertex stands for the whole opening
  const rimPt = (lp) => {
    if (!lp.curved) { const v = I[lp.hes[0]]; return [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; }
    let x = 0, y = 0, z = 0;
    for (const h of lp.hes) { const w = I[h]; x += P[w * 3]; y += P[w * 3 + 1]; z += P[w * 3 + 2]; }
    const n = lp.hes.length; return [x / n, y / n, z / n];
  };
  let filled = 0;
  // The CAD plane faces first (opts.cadPoly: the face number per triangle, -1 where there is none): each is a region as it is. The
  // tessellation of a plane can carry normals a hair apart and vertices a hair off the plane; the face says it is flat, so it is.
  const cadPoly = opts.cadPoly && opts.cadPoly.length === T ? opts.cadPoly : null;
  if (cadPoly) {
    const byFace = new Map();
    for (let t = 0; t < T; t++) { const f = cadPoly[t]; if (f < 0 || !ok[t]) continue; let l = byFace.get(f); if (!l) byFace.set(f, l = []); l.push(t); }
    for (const list of byFace.values()) {
      const r = rStart.length, from = filled;
      for (const t of list) { region[t] = r; order[filled++] = t; }
      rStart.push(from); rEnd.push(filled); rSeed.push(list[0]); rCurved.push(false);
    }
  }
  for (let s = 0; s < T; s++) {
    if (!ok[s] || region[s] >= 0) continue;
    const r = rStart.length;
    const snx = nx[s], sny = ny[s], snz = nz[s];
    const sv = I[s * 3];
    const sd = snx * P[sv * 3] + sny * P[sv * 3 + 1] + snz * P[sv * 3 + 2];
    const from = filled;
    region[s] = r; order[filled++] = s;
    let curvedR = false;
    for (let q = from; q < filled; q++) {
      const t = order[q];
      for (let e = 0; e < 3; e++) {
        const o = nb[t * 3 + e];
        if (o < 0) continue;
        const u = (o / 3) | 0;
        if (region[u] >= 0) continue;
        let flat = nx[u] * snx + ny[u] * sny + nz[u] * snz >= cosTol;
        for (let c = 0; c < 3 && flat; c++) {
          const v = I[u * 3 + c];
          if (Math.abs(snx * P[v * 3] + sny * P[v * 3 + 1] + snz * P[v * 3 + 2] - sd) > distTol) flat = false;
        }
        if (!flat) {
          // not in the seed's plane: it still belongs when the surface turns smoothly into it (curved surfaces)
          if (!curvedOn || nx[u] * nx[t] + ny[u] * ny[t] + nz[u] * nz[t] < curvedCos) continue;
          curvedR = true;
        }
        region[u] = r; order[filled++] = u;
      }
    }
    rStart.push(from); rEnd.push(filled); rSeed.push(s); rCurved.push(curvedR);
  }
  const R = rStart.length;

  // ── 5. boundary loops of each region; clockwise ones are openings ────────
  const loops = [];                                     // { r, hes:[half-edge…], size }
  const bigLoops = [];                                  // openings over the size limit (kept for a floating wall that sits in one: step 9)
  const loopOfHe = new Int32Array(T * 3).fill(-1);      // owner-side half-edge → loop
  const outlines = [];                                  // the outline of each region: { r, f: { hes, size, area2 }, nBoundary }
  const ringPending = [];                               // openings over the size limit that might be a ring groove (see below)
  const rimHes = [];
  const onRim = new Uint8Array(T * 3);                  // 1 = boundary half-edge of the region in hand, 2 = already walked
  for (let r = 0; r < R; r++) {
    if (rEnd[r] - rStart[r] < 2) continue;              // one triangle cannot enclose a hole
    rimHes.length = 0;
    for (let q = rStart[r]; q < rEnd[r]; q++) {
      const t = order[q];
      for (let e = 0; e < 3; e++) {
        const o = nb[t * 3 + e];
        if (o >= 0 && region[(o / 3) | 0] === r) continue;
        rimHes.push(t * 3 + e); onRim[t * 3 + e] = 1;
      }
    }
    const nBoundary = rimHes.length;
    if (nBoundary < 6) { for (const h of rimHes) onRim[h] = 0; continue; }      // an outline plus at least a triangular hole
    // The boundary is walked round the triangles, not from vertex to vertex: at the end of a boundary edge the next one is found by
    // turning about that vertex through the face's own triangles. So where two openings meet at one point (or an opening meets the
    // outline: broken meshes are full of this) each walk stays on its own side, and what comes back is split into simple loops below.
    const walks = [];
    for (const h0 of rimHes) {
      if (onRim[h0] !== 1) continue;
      const walk = [];
      let h = h0, whole = false;
      for (let guard = 0; guard <= nBoundary; guard++) {
        onRim[h] = 2; walk.push(h);
        let t = (h / 3) | 0, e = h % 3, nxt = -1;
        for (let turn = 0; turn <= rEnd[r] - rStart[r]; turn++) {
          const h2 = t * 3 + (e + 1) % 3;               // leaves the vertex that h runs into
          if (onRim[h2]) { nxt = h2; break; }
          const o = nb[h2];
          if (o < 0) break;
          t = (o / 3) | 0; e = o % 3;
        }
        if (nxt === h0) { whole = true; break; }
        if (nxt < 0 || onRim[nxt] !== 1) break;
        h = nxt;
      }
      if (whole) walks.push(walk);
    }
    for (const h of rimHes) onRim[h] = 0;
    // a walk that passes one vertex twice is two loops that touch there
    const cycles = [];
    const at = new Map();
    for (const walk of walks) {
      at.clear();
      const st = [];
      for (const h of walk) {
        const a = tw[h], p = at.get(a);
        if (p !== undefined) {
          const cyc = st.splice(p);
          for (const x of cyc) at.delete(tw[x]);
          cycles.push(cyc);
        }
        at.set(a, st.length); st.push(h);
      }
      if (st.length) cycles.push(st);
    }
    // plane basis
    const s = rSeed[r];
    const n0 = nx[s], n1 = ny[s], n2 = nz[s];
    let ux, uy, uz;
    if (Math.abs(n0) < 0.9) { ux = 0; uy = -n2; uz = n1; } else { ux = n2; uy = 0; uz = -n0; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = n1 * uz - n2 * uy, vy = n2 * ux - n0 * uz, vz = n0 * uy - n1 * ux;
    const found = [];                                   // { hes, size, area2, basis, s }
    const planeBasis = [ux, uy, uz, vx, vy, vz];
    for (const hes of cycles) {
      if (hes.length < 3) continue;                     // (there and back along one edge: a crack, not a loop)
      let cb = planeBasis, fs = s, bent = false, minDot = 1;
      if (rCurved[r]) {
        // a curved region: the opening's own direction is the mean of the normals of the triangles it cuts into. One that is not
        // nearly flat as a whole (the end of a tube, a loop right round a dome) has no such direction and is not an opening.
        let mx = 0, my = 0, mz = 0;
        for (const h of hes) { const t = (h / 3) | 0; mx += nx[t]; my += ny[t]; mz += nz[t]; }
        const ml = Math.hypot(mx, my, mz);
        if (!(ml >= hes.length * 0.8) || pseudoN >= pseudoMax) continue;
        mx /= ml; my /= ml; mz /= ml;
        // a stretch of the surface that is flat all the same (a flat face that runs on into a fillet) is judged as a flat one
        for (const h of hes) { const t = (h / 3) | 0; const d = nx[t] * mx + ny[t] * my + nz[t] * mz; if (d < minDot) minDot = d; }
        bent = minDot < cosTol;
        let bu0, bu1, bu2;
        if (Math.abs(mx) < 0.9) { bu0 = 0; bu1 = -mz; bu2 = my; } else { bu0 = mz; bu1 = 0; bu2 = -mx; }
        const bl = Math.hypot(bu0, bu1, bu2); bu0 /= bl; bu1 /= bl; bu2 /= bl;
        cb = [bu0, bu1, bu2, my * bu2 - mz * bu1, mz * bu0 - mx * bu2, mx * bu1 - my * bu0];
        fs = T + pseudoN++; nx[fs] = mx; ny[fs] = my; nz[fs] = mz;
      }
      // signed area about the face normal, and the widest point
      let area2 = 0;
      const xs = new Float64Array(hes.length), ys = new Float64Array(hes.length);
      for (let i = 0; i < hes.length; i++) {
        const v = I[hes[i]];
        const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
        xs[i] = px * cb[0] + py * cb[1] + pz * cb[2]; ys[i] = px * cb[3] + py * cb[4] + pz * cb[5];
      }
      for (let i = 0, j = hes.length - 1; i < hes.length; j = i++) area2 += xs[j] * ys[i] - xs[i] * ys[j];
      let size2 = 0;
      const step = hes.length > 240 ? Math.ceil(hes.length / 240) : 1;
      for (let i = 0; i < hes.length; i += step) for (let j = i + 1; j < hes.length; j += step) {
        const dx = xs[i] - xs[j], dy = ys[i] - ys[j]; const d2 = dx * dx + dy * dy;
        if (d2 > size2) size2 = d2;
      }
      found.push({ hes, size: Math.sqrt(size2), area2, basis: cb, s: fs, curved: bent, bend: minDot });
    }
    // counter-clockwise about the normal: the face's own outline (the largest
    // one, should a face ever report two)
    let outline = 0, outlineF = null;
    if (rCurved[r]) {
      // (no outline to measure on a curved patch: the size of the patch stands for it, and ring grooves are not looked for)
      let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
      for (let q = rStart[r]; q < rEnd[r]; q++) for (let c = 0; c < 3; c++) {
        const v = I[order[q] * 3 + c], x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        if (x < lx) lx = x; if (x > hx) hx = x; if (y < ly) ly = y; if (y > hy) hy = y; if (z < lz) lz = z; if (z > hz) hz = z;
      }
      outline = Math.hypot(hx - lx, hy - ly, hz - lz);
    } else {
      for (const f of found) if (f.area2 > 0 && f.size > outline) { outline = f.size; outlineF = f; }
      if (!(outline > 0)) continue;
      outlines.push({ r, f: outlineF, nBoundary });
    }
    for (const f of found) {
      if (!(f.area2 < 0)) continue;                     // clockwise loops are the openings
      const wide = f.size > outline * maxFaceRatio && f.size > diag * maxPartRatio;
      // (a hair of tolerance: a Ø10 hole measures 10.000000000000002 from its single-precision corners, and "holes up to 10" means it)
      if (f.size > maxSize * (1 + 1e-6)) {
        result.skipped.tooLarge++;
        if (opts.floating === true) bigLoops.push({ r, hes: f.hes, size: f.size, basis: f.basis, s: f.s, curved: f.curved, bend: f.bend });
        // The far end of a countersink or a flared hole is wider than the limit, though the hole is not: such an opening is kept as a
        // boundary (and is closed with the hole when the hole is taken), never as the start of one.
        let bigId = -1;
        if (f.size <= maxSize * bigFactor && !wide) {
          const id = bigId = loops.length;
          loops.push({ r, hes: f.hes, size: f.size, basis: f.basis, s: f.s, curved: f.curved, bend: f.bend, state: 0, big: true });
          for (const hh of f.hes) loopOfHe[hh] = id;
        }
        // a ring groove round a flush island may still be a narrow feature: judged by its width after all the regions are known
        if (!wide && opts.rings !== false && !rCurved[r]) ringPending.push({ r, hes: f.hes, size: f.size, area2: f.area2, basis: f.basis, s: f.s, curved: f.curved, bend: f.bend, bigId });
        continue;
      }
      if (wide) { result.skipped.partOfShape++; continue; }
      const id = loops.length;
      loops.push({ r, hes: f.hes, size: f.size, basis: f.basis, s: f.s, curved: f.curved, bend: f.bend, state: 0 });
      for (const hh of f.hes) loopOfHe[hh] = id;
    }
  }
  // A ring groove (an O-ring seat, an engraved circle, a recessed ring) round an island that is flush with the face: its outer loop is
  // wide, but the feature is not, it is as wide as the groove. When the opening encloses exactly one island, a region in the same
  // plane, and the groove's mean width is within the limit, it is a candidate like any hole and goes with its island in one piece (the
  // island's triangles are taken out with it and the cap covers it). What the island carries is checked by the flood below.
  if (ringPending.length && ringPending.length * outlines.length <= 4e7) {          // (a bound on the work: openings x outlines)
    const perimeter = (hes) => {
      let sum = 0;
      for (let i = 0; i < hes.length; i++) {
        const a = I[hes[i]], b = I[hes[(i + 1) % hes.length]];
        sum += Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
      }
      return sum;
    };
    // box of each outline, to throw out most of the pairs cheaply
    for (const o of outlines) {
      let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
      for (const h of o.f.hes) {
        const v = I[h], x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        if (x < lx) lx = x; if (x > hx) hx = x; if (y < ly) ly = y; if (y > hy) hy = y; if (z < lz) lz = z; if (z > hz) hz = z;
      }
      o.box = [lx, ly, lz, hx, hy, hz];
    }
    const eps = distTol * 4;
    for (const rp of ringPending) {
      const [ux, uy, uz, vx, vy, vz] = rp.basis;
      let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
      const n = rp.hes.length, xs = new Float64Array(n), ys = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const v = I[rp.hes[i]], x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        if (x < lx) lx = x; if (x > hx) hx = x; if (y < ly) ly = y; if (y > hy) hy = y; if (z < lz) lz = z; if (z > hz) hz = z;
        xs[i] = x * ux + y * uy + z * uz; ys[i] = x * vx + y * vy + z * vz;
      }
      const inside = (px, py) => {
        let c = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          if ((ys[i] > py) !== (ys[j] > py) && px < (xs[j] - xs[i]) * (py - ys[i]) / (ys[j] - ys[i]) + xs[i]) c = !c;
        }
        return c;
      };
      const s0 = rSeed[rp.r], v0 = I[rp.hes[0]];
      const d0 = nx[s0] * P[v0 * 3] + ny[s0] * P[v0 * 3 + 1] + nz[s0] * P[v0 * 3 + 2];
      let island = null, count = 0;
      for (const o of outlines) {
        if (o.r === rp.r || o.f.area2 >= -rp.area2 * 0.999) continue;                // (it is the face itself, or larger than the opening)
        const b = o.box;
        if (b[0] < lx - eps || b[1] < ly - eps || b[2] < lz - eps || b[3] > hx + eps || b[4] > hy + eps || b[5] > hz + eps) continue;
        const s1 = rSeed[o.r];
        if (nx[s1] * nx[s0] + ny[s1] * ny[s0] + nz[s1] * nz[s0] < cosTol) continue;   // (same way up and the same plane)
        const w = I[o.f.hes[0]];
        if (Math.abs(nx[s0] * P[w * 3] + ny[s0] * P[w * 3 + 1] + nz[s0] * P[w * 3 + 2] - d0) > eps) continue;
        const m = I[o.f.hes[o.f.hes.length >> 1]];
        if (!inside(P[w * 3] * ux + P[w * 3 + 1] * uy + P[w * 3 + 2] * uz, P[w * 3] * vx + P[w * 3 + 1] * vy + P[w * 3 + 2] * vz)) continue;
        if (!inside(P[m * 3] * ux + P[m * 3 + 1] * uy + P[m * 3 + 2] * uz, P[m * 3] * vx + P[m * 3 + 1] * vy + P[m * 3 + 2] * vz)) continue;
        count++; island = o;
        if (count > 1) break;
      }
      if (count !== 1) continue;
      const per = (perimeter(rp.hes) + perimeter(island.f.hes)) / 2;
      const width = per > 0 ? (-rp.area2 - island.f.area2) / 2 / per : Infinity;       // mean width of the groove
      if (!(width > 0) || width > maxSize) continue;
      result.skipped.tooLarge--;
      if (rp.bigId >= 0) { const L = loops[rp.bigId]; L.big = false; L.sortSize = L.size; L.size = Math.max(width, 0); L.island = island.r; continue; }
      const id = loops.length;
      loops.push({ r: rp.r, hes: rp.hes, size: width, sortSize: rp.size, basis: rp.basis, state: 0, island: island.r });
      for (const hh of rp.hes) loopOfHe[hh] = id;
    }
  }
  const removed = new Uint8Array(T);
  const holeOf = new Int32Array(T).fill(-1);            // triangle → the hole whose surface took it out
  const metBy = new Map();                              // loop → the loops left alone whose surface ran up to it (see "the same hole" below)
  const caps = [], capOwner = [];
  // New vertices of curved caps (opts.newVertices): positions, the three rim vertices each takes its other attributes from (and their
  // weights), its normal, and the rim vertices whose normal is turned to the surface's. Their numbers start after the mesh's own.
  const newVerts = opts.newVertices === true && curvedOn;
  const nvPos = [], nvSrc = [], nvW = [], nvNormal = [], fixIds = [], fixNormals = [];
  if (!loops.length && !(opts.floating === true && bigLoops.length)) {
    // nothing to close: with opts.cleanup, still take out what an earlier fill left behind
    if (opts.cleanup === true && opts.rimVertices === true) {
      try { removeRimVertices(); } catch (_) { /* nothing is changed */ }
      if (opts.floating === true) { try { removeFloatingTubes(); } catch (_) { /* nothing is changed */ } }
      if (opts.enclosed === true) { try { removeEnclosedPieces(); } catch (_) { /* nothing is changed */ } }
      if (result.rimVertices || result.floating || result.enclosed) { result.removed = removed; result.caps = Uint32Array.from(caps); result.capOwner = Uint32Array.from(capOwner); }
    }
    return result;
  }

  // ── 6. the surface behind each loop ──────────────────────────────────────
  const stamp = new Int32Array(T);                      // 0 = unvisited, else visit id
  const limit = maxSize * depthFactor;
  let visit = 0;
  const bySize = loops.map((_, i) => i).filter(i => !loops[i].big).sort((a, b) => (loops[b].sortSize || loops[b].size) - (loops[a].sortSize || loops[a].size));
  for (const L of bySize) {
    if (loops[L].state) continue;
    visit++;
    const S = [];
    const bounding = new Set([L]);                      // loops that close this surface off
    const absorbed = new Set();                         // loops whose own face is part of it
    let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
    let reason = '';
    const seed = (loopId) => {
      for (const h of loops[loopId].hes) {
        for (const o of twins(h)) {
          const u = (o / 3) | 0;
          if (stamp[u] !== visit) { stamp[u] = visit; S.push(u); }
        }
      }
    };
    seed(L);
    // a ring groove goes with its island: the island's triangles are part of what the cap covers, and what lies behind its own openings
    // is followed from there
    if (loops[L].island !== undefined) {
      const ir = loops[L].island;
      for (let k = rStart[ir]; k < rEnd[ir]; k++) { const u = order[k]; if (stamp[u] !== visit) { stamp[u] = visit; S.push(u); } }
    }
    let q = 0;
    const pending = [];
    let metHole = false;                                // the surface ran into one a hole already took out
    for (;;) {
      for (; q < S.length && !reason; q++) {
        const t = S[q];
        if (removed[t]) {
          if (holeOf[t] < 0) { reason = 'leaking'; break; }
          metHole = true; continue;                     // (the cap of that hole closes the surface there)
        }
        for (let c = 0; c < 3; c++) {
          const v = I[t * 3 + c];
          const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
          if (y < by0) by0 = y; if (y > by1) by1 = y;
          if (z < bz0) bz0 = z; if (z > bz1) bz1 = z;
        }
        if (S.length > maxComponentTris) { reason = 'leaking'; break; }
        if (Math.hypot(bx1 - bx0, by1 - by0, bz1 - bz0) > limit) { reason = 'tooDeep'; break; }
        for (let e = 0; e < 3; e++) {
          const h = t * 3 + e;
          const own = loopOfHe[h];
          if (own >= 0) {                               // t's face owns a loop here: that loop is inside the surface
            if (!absorbed.has(own)) { absorbed.add(own); pending.push(own); }
            continue;
          }
          for (const o of twins(h)) {
            const far = loopOfHe[o];
            if (far >= 0) { bounding.add(far); continue; } // the edge of a face this surface opens into
            const u = (o / 3) | 0;
            if (stamp[u] !== visit) { stamp[u] = visit; S.push(u); }
          }
        }
      }
      if (reason || !pending.length) break;
      seed(pending.pop());                              // carry on behind a loop that was swallowed
    }
    // The same hole, seen from its other side. A plunged or flow-drilled hole is a cone into a bore whose collar stands under the
    // sheet: from the top face it is a hole and is closed (the cone and the bore go, the collar's end is capped), and the loop round
    // the collar's root on the underside then leads into what that fill took out. Nothing is left open there (the collar is a closed
    // stub now), so the loop is settled with its hole and not counted as left alone.
    if (!reason && metHole) { loops[L].state = 1; continue; }
    // A loop whose own face AND far side are both in the surface is interior
    // to the hole (the step of a counterbore): no cap there. If that happens
    // to the loop we started from, the surface has wrapped round onto the
    // face it opens into — it is not enclosed.
    if (!reason && absorbed.has(L)) reason = 'leaking';
    const capLoops = [];
    for (const id of bounding) if (!absorbed.has(id)) capLoops.push(id);
    if (!reason && !capLoops.length) reason = 'leaking';

    // which side of each face does the surface lie on?
    let isRaised = false;
    if (!reason && S.length) {
      let cx = 0, cy = 0, cz = 0, wsum = 0;
      for (const t of S) {
        const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
        const e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2];
        const e2x = P[c * 3] - P[a * 3], e2y = P[c * 3 + 1] - P[a * 3 + 1], e2z = P[c * 3 + 2] - P[a * 3 + 2];
        const w = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
        cx += w * (P[a * 3] + P[b * 3] + P[c * 3]) / 3;
        cy += w * (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
        cz += w * (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
        wsum += w;
      }
      if (wsum > 0) { cx /= wsum; cy /= wsum; cz /= wsum; }
      for (const id of capLoops) {
        const lp = loops[id];
        const s = seedOf(lp);
        const v = I[lp.hes[0]];
        const rp = rimPt(lp);
        const side = nx[s] * (cx - rp[0]) + ny[s] * (cy - rp[1]) + nz[s] * (cz - rp[2]);
        if (!(side < -distTol * 4)) {
          // The middle of a shallow groove with flush parts in it (a fillet, a ring left standing at the face's level) lies on the
          // face's plane, so the middle says nothing. What decides then is the reach: nothing rises above the plane, and it sinks below.
          let dLo = 0, dHi = 0;
          for (const t of S) {
            for (let c = 0; c < 3; c++) {
              const w = I[t * 3 + c];
              const d = nx[s] * (P[w * 3] - P[v * 3]) + ny[s] * (P[w * 3 + 1] - P[v * 3 + 1]) + nz[s] * (P[w * 3 + 2] - P[v * 3 + 2]);
              if (d < dLo) dLo = d; if (d > dHi) dHi = d;
            }
          }
          if (!(dHi <= distTol * 8 && dLo < -distTol * 8)) { reason = 'raised'; break; }
        }
      }
      // A sheet with one face wound the wrong way round: the wall of a hole through it lies below one face and "above" the other, but it
      // lies between the two parallel faces all the same, and that is a hole.
      if (reason === 'raised' && capLoops.length === 2) {
        const a0 = loops[capLoops[0]], a1 = loops[capLoops[1]];
        const sa = seedOf(a0), sb = seedOf(a1);
        if (Math.abs(nx[sa] * nx[sb] + ny[sa] * ny[sb] + nz[sa] * nz[sb]) > 0.9995) {
          const va = I[a0.hes[0]], vb = I[a1.hes[0]];
          const da = nx[sa] * P[va * 3] + ny[sa] * P[va * 3 + 1] + nz[sa] * P[va * 3 + 2];
          const db = nx[sa] * P[vb * 3] + ny[sa] * P[vb * 3 + 1] + nz[sa] * P[vb * 3 + 2];
          const lo = Math.min(da, db) - distTol * 4, hi = Math.max(da, db) + distTol * 4;
          let between = true;
          for (const t of S) {
            for (let c = 0; c < 3 && between; c++) {
              const v = I[t * 3 + c], d = nx[sa] * P[v * 3] + ny[sa] * P[v * 3 + 1] + nz[sa] * P[v * 3 + 2];
              if (d < lo || d > hi) between = false;
            }
            if (!between) break;
          }
          if (between && Math.abs(da - db) > distTol * 8) reason = '';
        }
      }
      // It stands on its face instead of going into it. Left alone, unless
      // raised details were asked for and this is one: on a single face,
      // nowhere below it, and no higher than the limit.
      if (reason === 'raised' && wantRaised && capLoops.length === 1) {
        const lp = loops[capLoops[0]];
        const s = seedOf(lp), v0 = I[lp.hes[0]];
        const fx = P[v0 * 3], fy = P[v0 * 3 + 1], fz = P[v0 * 3 + 2];
        let lo = 0, hi = 0;
        for (const t of S) {
          for (let c = 0; c < 3; c++) {
            const v = I[t * 3 + c];
            const d = nx[s] * (P[v * 3] - fx) + ny[s] * (P[v * 3 + 1] - fy) + nz[s] * (P[v * 3 + 2] - fz);
            if (d < lo) lo = d; if (d > hi) hi = d;
          }
        }
        if (lo >= -distTol * 4) {
          if (hi <= raisedMax) { reason = ''; isRaised = true; }
          else reason = 'raisedTall';
        }
      }
    }

    // The cut must be clean. Taking S out leaves an edge bare wherever a
    // triangle of S meets one that stays; the caps cover exactly the edges of
    // the cap loops. So: every such edge has to lie on a cap loop, and every
    // edge of a cap loop has to have S behind it. Anything else would leave
    // a crack or a doubled wall, and the feature is left as it is.
    if (!reason) {
      const capSet = new Set(capLoops);
      outer:
      for (const t of S) {
        for (let e = 0; e < 3; e++) {
          for (const o of twins(t * 3 + e)) {
            if (stamp[(o / 3) | 0] === visit) continue;
            if (!capSet.has(loopOfHe[o])) { reason = 'leaking'; break outer; }
          }
        }
      }
      if (!reason) {
        outer2:
        for (const id of capLoops) {
          for (const h of loops[id].hes) {
            const o = nb[h];
            if (o < 0 && badTris.size && twins(h).length) {
              // a doubled edge: fine if everything on it is part of the surface being taken out
              for (const x of twins(h)) if (stamp[(x / 3) | 0] !== visit) { reason = 'leaking'; break outer2; }
              continue;
            }
            if (o < 0) {
              // No neighbour. If no triangle runs the other way on this edge at all, the wall was tessellated differently from the
              // face (CAD meshes: a 22-point rim on the face, a 16-point ring on the wall) and the two are not stitched here: the
              // wall comes out with the rest of S, the cap follows the face's own rim, nothing is left hanging. If one does run the
              // other way (a doubled or non-manifold edge) it is not clean.
              const t = (h / 3) | 0, e = h % 3;
              if (heHas(tw[t * 3 + (e + 1) % 3], tw[t * 3 + e])) { reason = 'leaking'; break outer2; }
              continue;
            }
            if (stamp[(o / 3) | 0] !== visit) { reason = 'leaking'; break outer2; }
          }
        }
      }
    }
    // An enclosed feature: is it one the caller asked for? Its size is that
    // of the loop we started from — the widest of the feature, since loops
    // are taken largest first.
    if (!reason) {
      const kind = !S.length ? 'open' : capLoops.length >= 2 ? 'through' : 'blind';
      if (loops[L].size < minSize) reason = 'tooSmall';
      // On a curved surface only an opening that goes through (or has nothing behind it) is a hole: the pockets, ribs and lettering
      // that stand in a smooth body are what it is, and a smooth shape has far too many of them to tell from a drilled blind hole
      else if ((isRaised || kind === 'blind') && capLoops.some(id => loops[id].curved)) reason = 'kind';
      else if (opts.onlyCurved === true && !capLoops.some(id => loops[id].curved)) reason = 'kind';
      else if (opts.avoid && S.some(t => opts.avoid[t])) reason = 'kind';
      else if (!isRaised && !want[kind]) reason = 'kind';
      // a depth limit in the mesh's own units (opts.maxDepth): engraved lettering is a shallow pocket, a bore is not
      else if (!isRaised && kind === 'blind' && maxDepth > 0) {
        const lp = loops[capLoops[0]], s = seedOf(lp), v0 = I[lp.hes[0]];
        let deep = 0;
        for (const t of S) for (let c = 0; c < 3; c++) {
          const v = I[t * 3 + c], d = nx[s] * (P[v * 3] - P[v0 * 3]) + ny[s] * (P[v * 3 + 1] - P[v0 * 3 + 1]) + nz[s] * (P[v * 3 + 2] - P[v0 * 3 + 2]);
          if (-d > deep) deep = -d;
        }
        if (deep > maxDepth) reason = 'tooDeep';
      }
    }
    const all = [...bounding, ...absorbed];
    if (reason) {
      // Only the loop we started from is settled. The other loops this
      // surface touched get their own turn: a plunged or flow-drilled hole
      // is a collar standing on one face (raised, seen from there) and a
      // plain hole on the other, and it must not be written off because the
      // collar's side happened to come first.
      if ((reason === 'leaking' || reason === 'tooDeep') && opts.seal === true && !loops[L].big && loops[L].island === undefined && !loops[L].curved && trySeal(L)) continue;
      loops[L].state = 2;
      result.skipped[reason] = (result.skipped[reason] || 0) + 1;
      if (reason !== 'tooSmall' && reason !== 'kind') {
        loops[L].skip = reason; loops[L].absorbed = absorbed;
        for (const id of bounding) if (id !== L) { const l = metBy.get(id); if (l) l.push(L); else metBy.set(id, [L]); }
      }
      if (opts.debug) (result.skippedList = result.skippedList || []).push({ reason, size: loops[L].size, tris: S.length, caps: capLoops.length, bend: Math.min(...capLoops.map(id => loops[id].bend === undefined ? 1 : loops[id].bend)), ext: [bx1 - bx0, by1 - by0, bz1 - bz0] });
      continue;
    }
    // Accepted — provided every opening can be closed completely. A cap of
    // an n-point outline has n − 2 triangles; one that comes back short would
    // leave a crack, so then nothing is removed and the hole stays as it is.
    const capMark = caps.length, ownerMark = capOwner.length, addedMark = result.addedTris;
    const nvMark = nvSrc.length / 3, fixMark = fixIds.length;
    let nCaps = 0, whole = true;
    for (const id of capLoops) {
      if (capLoop(loops[id]) !== loops[id].hes.length - 2) { whole = false; break; }
      nCaps++;
    }
    if (!whole) {
      caps.length = capMark; capOwner.length = ownerMark; result.addedTris = addedMark;
      nvPos.length = nvSrc.length = nvW.length = nvNormal.length = nvMark * 3; fixIds.length = fixMark; fixNormals.length = fixMark * 3;
      loops[L].state = 2;
      result.skipped.uncappable++;
      continue;
    }
    for (const t of S) { removed[t] = 1; holeOf[t] = L; }
    for (const id of all) loops[id].state = 1;
    // The same hole met from the other side first (the collar side of a flow-drilled hole, which stands on its face and was left
    // alone as raised): that loop's surface ran through this hole, up to one of its caps and across another. It is closed now.
    for (const id of capLoops) {
      for (const k of metBy.get(id) || NONE) {
        const lk = loops[k];
        if (lk.state !== 2 || !lk.skip || !capLoops.some(c => c !== id && lk.absorbed.has(c))) continue;
        result.skipped[lk.skip]--; lk.skip = null; lk.state = 1;
      }
    }
    if (opts.debug) (result.acceptedList = result.acceptedList || []).push({ size: loops[L].size, tris: S.length, caps: capLoops.length, curved: capLoops.some(id => loops[id].curved), raised: isRaised, bend: Math.min(...capLoops.map(id => loops[id].bend === undefined ? 1 : loops[id].bend)) });
    result.holes++;
    result.loops += nCaps;
    result.removedTris += S.length;
    if (isRaised) result.flattened++; else if (!S.length) result.open++; else if (nCaps >= 2) result.through++; else result.blind++;
    // A raised detail can have other geometry inside its volume: a stamped collar has an inner skin and the floor it was pressed
    // from under its dome, a hollow boss has its inside. Once the detail is flattened, that geometry is no longer hidden: it stands
    // out of the new face, as a dark dimple or a disc hanging in the air. It goes with the detail: every triangle that lies inside the
    // closed surface made of S and its cap is taken out too.
    if (isRaised && S.length) result.removedTris += removeInsideRaised(S, capLoops[0], [bx0, by0, bz0, bx1, by1, bz1]);
  }

  // The triangles that stand inside a flattened raised detail: above its face, within its box, and inside S by the parity of a ray
  // along the face normal (S with its cap is a closed surface, so a point is inside it when a ray out of it leaves S an odd number
  // of times). Loops on the triangles taken out are settled, so nothing starts from them later. Returns how many were taken out.
  function removeInsideRaised(S, capId, box) {
    const lp = loops[capId], s0 = seedOf(lp);
    const fx = nx[s0], fy = ny[s0], fz = nz[s0];
    const v0 = I[lp.hes[0]], d0 = fx * P[v0 * 3] + fy * P[v0 * 3 + 1] + fz * P[v0 * 3 + 2];
    let hi = 0;
    for (const t of S) for (let c = 0; c < 3; c++) { const v = I[t * 3 + c]; const d = fx * P[v * 3] + fy * P[v * 3 + 1] + fz * P[v * 3 + 2] - d0; if (d > hi) hi = d; }
    if (!(hi > distTol * 8)) return 0;
    const [x0, y0, z0, x1, y1, z1] = box, eps = distTol * 4;
    const inS = new Uint8Array(T); for (const t of S) inS[t] = 1;
    const hits = (ox, oy, oz) => {               // triangles of S a ray from (o) along the face normal passes through (Moeller-Trumbore)
      let n = 0;
      for (const t of S) {
        const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
        const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
        const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
        const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
        const px = fy * e2z - fz * e2y, py = fz * e2x - fx * e2z, pz = fx * e2y - fy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const w = (fx * qx + fy * qy + fz * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        if ((e2x * qx + e2y * qy + e2z * qz) * inv > 1e-9) n++;
      }
      return n;
    };
    let gone = 0;
    for (let t = 0; t < T; t++) {
      if (removed[t] || inS[t] || !ok[t]) continue;
      const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
      const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1 || cz < z0 || cz > z1) continue;
      const d = fx * cx + fy * cy + fz * cz - d0;
      if (d <= eps || d > hi) continue;
      if ((hits(cx, cy, cz) & 1) === 0) continue;
      removed[t] = 1; gone++;
      for (let e = 0; e < 3; e++) { const id = loopOfHe[t * 3 + e]; if (id >= 0) loops[id].state = 1; }
    }
    return gone;
  }

  // An opening into a hollow space (or into anything the hole's wall runs on into) cannot be taken out whole: what lies behind it is
  // not a hole but the rest of the part. The opening is sealed from outside instead: the wall of the hole, as far as it lies in the
  // column under the opening (inside its outline, no deeper than the depth limit), is taken out and the opening is closed flush with the
  // face. What lies behind stays as it was, out of sight.
  function trySeal(L) {
    const lp = loops[L];
    const s0 = seedOf(lp), fx = nx[s0], fy = ny[s0], fz = nz[s0];
    const v0 = I[lp.hes[0]], pd = fx * P[v0 * 3] + fy * P[v0 * 3 + 1] + fz * P[v0 * 3 + 2];
    const [ux, uy, uz, vx, vy, vz] = lp.basis;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const h of lp.hes) {
      const v = I[h], x = P[v * 3] * ux + P[v * 3 + 1] * uy + P[v * 3 + 2] * uz, y = P[v * 3] * vx + P[v * 3 + 1] * vy + P[v * 3 + 2] * vz;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const pad = lp.size * 0.3, deep = maxSize * depthFactor, tol = distTol * 4;
    const inColumn = (v) => {
      const x = P[v * 3] * ux + P[v * 3 + 1] * uy + P[v * 3 + 2] * uz, y = P[v * 3] * vx + P[v * 3 + 1] * vy + P[v * 3 + 2] * vz;
      const d = fx * P[v * 3] + fy * P[v * 3 + 1] + fz * P[v * 3 + 2] - pd;
      return x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad && d <= tol && d >= -deep;
    };
    // A triangle that faces away from the opening is not the hole's wall but the far side of the part (the column ran through a
    // thin plate): taking it out would open the part where it can be seen. Then the opening is not sealed at all.
    const away = (t) => ok[t] && nx[t] * fx + ny[t] * fy + nz[t] * fz < -0.5;
    const seen = new Set(), S2 = [];
    let back = false;
    const take = (t) => {
      if (seen.has(t) || removed[t]) return;
      seen.add(t);
      if (away(t)) { back = true; return; }
      let below = false;
      for (let c = 0; c < 3; c++) {
        const v = I[t * 3 + c];
        if (!inColumn(v)) return;
        if (fx * P[v * 3] + fy * P[v * 3 + 1] + fz * P[v * 3 + 2] - pd < -tol * 2) below = true;
      }
      if (below) S2.push(t);                            // (a triangle lying in the face's own plane belongs to the face)
    };
    for (const h of lp.hes) for (const o of twins(h)) take((o / 3) | 0);
    for (let q = 0; q < S2.length; q++) {
      if (S2.length > maxComponentTris || back) return false;
      const t = S2[q];
      for (let e = 0; e < 3; e++) {
        const h = t * 3 + e;
        if (loopOfHe[h] >= 0) continue;
        for (const o of twins(h)) if (loopOfHe[o] < 0) take((o / 3) | 0);
      }
    }
    if (back || !S2.length) return false;
    // What stays bare once S2 is out (an edge of S2 whose other side stays) is hidden behind the cap only while it does not border
    // a surface that faces away: there the far side of the part would be left open.
    const inS2 = new Set(S2), onLoop = new Set(lp.hes);
    for (const t of S2) for (let e = 0; e < 3; e++) {
      const h = t * 3 + e;
      if (onLoop.has(h)) continue;
      for (const o of twins(h)) { const u = (o / 3) | 0; if (!inS2.has(u) && !removed[u] && away(u)) return false; }
    }
    const capMark = caps.length, ownerMark = capOwner.length, addedMark = result.addedTris;
    if (capLoop(lp) !== lp.hes.length - 2) { caps.length = capMark; capOwner.length = ownerMark; result.addedTris = addedMark; return false; }
    for (const t of S2) removed[t] = 1;
    lp.state = 1;
    result.holes++; result.blind++; result.sealed = (result.sealed || 0) + 1; result.loops++;
    result.removedTris += S2.length;
    return true;
  }

  // A cap over an opening in a curved surface. A flat cap runs straight across and leaves a dent; this one follows the surface. The
  // rim is triangulated as it is (ear clipping: no rim edge moves, so the cap meets the face edge to edge), and then the triangles
  // that are too big are cut: the longest inside edge of a triangle is split at its middle, and edges are flipped to keep the
  // triangles well shaped. Each new point is put on the surface through the rim: a thin plate spline through the rim and the
  // vertices just outside it (it carries the slope in from the sides, so a top that turns into a rounded edge goes on turning), or
  // a quadric through the rim where that does not do. Returns what capLoop returns (the rim's size less two: "done"), or 0 when it
  // cannot be done well (the flat cap is made instead).
  function capCurvedLoop(lp) {
    const n = lp.hes.length;
    if (n < 6 || n > 2000) return 0;
    const [ux, uy, uz, vx, vy, vz] = lp.basis, s = seedOf(lp), fx = nx[s], fy = ny[s], fz = nz[s];
    const vid = new Int32Array(n), xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
    let ox = 0, oy = 0, oz = 0;
    for (let i = 0; i < n; i++) { const v = I[lp.hes[n - 1 - i]]; vid[i] = v; ox += P[v * 3]; oy += P[v * 3 + 1]; oz += P[v * 3 + 2]; }
    ox /= n; oy /= n; oz /= n;
    for (let i = 0; i < n; i++) {
      const v = vid[i], dx = P[v * 3] - ox, dy = P[v * 3 + 1] - oy, dz = P[v * 3 + 2] - oz;
      xs[i] = dx * ux + dy * uy + dz * uz; ys[i] = dx * vx + dy * vy + dz * vz; zs[i] = dx * fx + dy * fy + dz * fz;
    }
    let area2 = 0, per = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) { area2 += xs[j] * ys[i] - xs[i] * ys[j]; per += Math.hypot(xs[i] - xs[j], ys[i] - ys[j]); }
    if (!(area2 > 0)) return 0;
    const rimSet = new Set(vid);
    const dxs = Array.from(xs), dys = Array.from(ys), dzs = Array.from(zs), near = new Set();
    for (const h of lp.hes) {
      const t = (h / 3) | 0, w = I[t * 3 + (h % 3 + 2) % 3];
      if (rimSet.has(w) || near.has(w)) continue;
      const ex = P[w * 3] - ox, ey = P[w * 3 + 1] - oy, ez = P[w * 3 + 2] - oz;
      const x = ex * ux + ey * uy + ez * uz, y = ex * vx + ey * vy + ez * vz;
      if (Math.hypot(x, y) > lp.size * 1.5) continue;           // (a long strip's far end says nothing about the opening)
      near.add(w); dxs.push(x); dys.push(y); dzs.push(ex * fx + ey * fy + ez * fz);
    }
    let q = dxs.length <= 600 && opts.fit !== 'quadric' ? fitSpline(dxs, dys, dzs) : null, spline = !!q;
    const quadric = () => {
      const f = fitQuadric(xs, ys, zs);
      if (!f) return null;
      let worst = 0;
      for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(zs[i] - f.h(xs[i], ys[i])));
      return worst > Math.max(distTol * 20, lp.size * 0.02) ? null : f;
    };
    if (!q) { q = quadric(); if (!q) return 0; }

    // the rim's own triangulation, then cut down to the size of the rim's edges
    const base0 = earClip(xs, ys);
    if (base0.length / 3 !== n - 2) return 0;
    const px = Array.from(xs), py = Array.from(ys);
    const ta = [], tb = [], tc = [], alive = [], emap = new Map();
    const K = 1 << 16, key = (a, b) => a * K + b;
    const addTri = (a, b, c) => { const t = ta.length; ta.push(a); tb.push(b); tc.push(c); alive.push(1); emap.set(key(a, b), t); emap.set(key(b, c), t); emap.set(key(c, a), t); };
    const killTri = (t) => { alive[t] = 0; emap.delete(key(ta[t], tb[t])); emap.delete(key(tb[t], tc[t])); emap.delete(key(tc[t], ta[t])); };
    const third = (t, a, b) => (ta[t] !== a && ta[t] !== b) ? ta[t] : (tb[t] !== a && tb[t] !== b) ? tb[t] : tc[t];
    const cross = (a, b, c) => (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]);
    for (let i = 0; i < base0.length; i += 3) {
      let a = base0[i], b = base0[i + 1], c = base0[i + 2];
      if (cross(a, b, c) < 0) { const t = b; b = c; c = t; }
      addTri(a, b, c);
    }
    const inCircle = (a, b, c, d) => {                          // > 0: d is inside the circle through a, b, c (counter-clockwise)
      const adx = px[a] - px[d], ady = py[a] - py[d], bdx = px[b] - px[d], bdy = py[b] - py[d], cdx = px[c] - px[d], cdy = py[c] - py[d];
      return (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy) - (bdx * bdx + bdy * bdy) * (adx * cdy - cdx * ady) + (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady);
    };
    const legalize = (stack) => {
      for (let guard = 0; stack.length && guard < 200000; guard++) {
        const e = stack.pop(), a = e[0], b = e[1];
        const t = emap.get(key(a, b)), u = emap.get(key(b, a));
        if (t === undefined || u === undefined) continue;       // a rim edge has one side only: it stays
        const c = third(t, a, b), d = third(u, b, a);
        if (!(inCircle(a, b, c, d) > 1e-12 * (1 + Math.abs(px[a]) + Math.abs(py[a])))) continue;
        if (!(cross(a, d, c) > 0 && cross(d, b, c) > 0)) continue;
        killTri(t); killTri(u); addTri(a, d, c); addTri(d, b, c);
        stack.push([a, d], [d, b], [b, c], [c, a]);
      }
    };
    { const all = []; for (const k of emap.keys()) all.push([Math.floor(k / K), k % K]); legalize(all); }
    // (a triangle on a rim edge has a side of at least half its length, so asking for less than that would never end)
    let longest = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) longest = Math.max(longest, Math.hypot(xs[i] - xs[j], ys[i] - ys[j]));
    // How fine the patch is cut follows how much the surface bends: points far enough apart that the chord between two of them sinks
    // no more than the surface may move (opts.surfaceTol; Remove holes' "Surface may move"), and never finer than needed.
    const qc = fitQuadric(xs, ys, zs), kappa = qc ? qc.curv : 0;
    const tol = +opts.surfaceTol > 0 ? +opts.surfaceTol : lp.size * 0.005;
    const byCurve = kappa > 1e-12 ? Math.sqrt(8 * tol / kappa) : Infinity;
    const target = Math.max(Math.min(byCurve, lp.size / 3), longest * 0.75);
    for (let added = 0; added < 1500; added++) {
      let best = -1, ba = 0, bb = 0, bl = target;
      for (let t = 0; t < ta.length; t++) {
        if (!alive[t]) continue;
        for (let e = 0; e < 3; e++) {
          const a = e === 0 ? ta[t] : e === 1 ? tb[t] : tc[t], b = e === 0 ? tb[t] : e === 1 ? tc[t] : ta[t];
          if (!emap.has(key(b, a))) continue;                   // (a rim edge cannot be split)
          const l = Math.hypot(px[a] - px[b], py[a] - py[b]);
          if (l > bl) { bl = l; best = t; ba = a; bb = b; }
        }
      }
      if (best < 0) break;
      const t = best, u = emap.get(key(bb, ba)), c = third(t, ba, bb), d = third(u, bb, ba), p = px.length;
      px.push((px[ba] + px[bb]) / 2); py.push((py[ba] + py[bb]) / 2);
      killTri(t); killTri(u);
      addTri(ba, p, c); addTri(p, bb, c); addTri(bb, p, d); addTri(p, ba, d);
      legalize([[ba, c], [c, bb], [bb, d], [d, ba]]);
    }
    const N = px.length, m = N - n;
    if (spline && m > 0) {
      // a spline can swing out between its points: the patch must stay within a little of the heights round it
      let zlo = Infinity, zhi = -Infinity;
      for (let i = 0; i < dzs.length; i++) { if (dzs[i] < zlo) zlo = dzs[i]; if (dzs[i] > zhi) zhi = dzs[i]; }
      const slack = lp.size * 0.1;
      let swing = false;
      for (let i = n; i < N && !swing; i++) { const z = q.h(px[i], py[i]); if (!(z >= zlo - slack && z <= zhi + slack)) swing = true; }
      if (swing) { q = quadric(); if (!q) return 0; }
    }
    const live = [];
    for (let t = 0; t < ta.length; t++) if (alive[t]) live.push(t);
    if (live.length !== n + 2 * m - 2) return 0;
    const normalAt = (x, y) => {
      const gx = q.hx(x, y), gy = q.hy(x, y);
      const a = -gx, b = -gy, l = Math.hypot(a, b, 1);
      return [(a * ux + b * vx + fx) / l, (a * uy + b * vy + fy) / l, (a * uz + b * vz + fz) / l];
    };
    const base = vCount + nvPos.length / 3;
    for (let k = 0; k < m; k++) {
      const x = px[n + k], y = py[n + k], z = q.h(x, y);
      nvPos.push(ox + x * ux + y * vx + z * fx, oy + x * uy + y * vy + z * fy, oz + x * uz + y * vz + z * fz);
      nvNormal.push(...normalAt(x, y));
      let i0 = -1, i1 = -1, i2 = -1, d0 = Infinity, d1 = Infinity, d2 = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (xs[i] - x) * (xs[i] - x) + (ys[i] - y) * (ys[i] - y);
        if (d < d0) { d2 = d1; i2 = i1; d1 = d0; i1 = i0; d0 = d; i0 = i; }
        else if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = i; }
        else if (d < d2) { d2 = d; i2 = i; }
      }
      const w0 = 1 / (d0 + 1e-12), w1 = 1 / (d1 + 1e-12), w2 = i2 >= 0 ? 1 / (d2 + 1e-12) : 0, ws = w0 + w1 + w2;
      nvSrc.push(vid[i0], vid[i1], vid[i2 >= 0 ? i2 : i1]);
      nvW.push(w0 / ws, w1 / ws, w2 / ws);
    }
    for (let i = 0; i < n; i++) { fixIds.push(vid[i]); fixNormals.push(...normalAt(xs[i], ys[i])); }
    const idOf = (i) => i < n ? vid[i] : base + (i - n);
    const ownerTri = (lp.hes[0] / 3) | 0;
    for (const t of live) { caps.push(idOf(ta[t]), idOf(tb[t]), idOf(tc[t])); capOwner.push(ownerTri); }
    result.addedTris += live.length;
    return n - 2;
  }

  // Triangulate one loop flush with its face, using the face's own vertices.
  function capLoop(lp) {
    if (newVerts && lp.curved) { const done = capCurvedLoop(lp); if (done) return done; }
    const n = lp.hes.length;
    const [ux, uy, uz, vx, vy, vz] = lp.basis;
    const vid = new Int32Array(n), xs = new Float64Array(n), ys = new Float64Array(n);
    // the loop runs clockwise about the normal; reversed it is the cap's outline
    for (let i = 0; i < n; i++) {
      const h = lp.hes[n - 1 - i];
      const v = I[h];
      vid[i] = v;
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      xs[i] = px * ux + py * uy + pz * uz; ys[i] = px * vx + py * vy + pz * vz;
    }
    const tris = earClip(xs, ys);
    const ownerTri = (lp.hes[0] / 3) | 0;
    for (let i = 0; i < tris.length; i += 3) {
      caps.push(vid[tris[i]], vid[tris[i + 1]], vid[tris[i + 2]]);
      capOwner.push(ownerTri);
    }
    result.addedTris += tris.length / 3;
    return tris.length / 3;
  }

  // ── 7. slivers left behind ───────────────────────────────────────────────
  // CAD meshes carry zero-area triangles (three points on a line) that stitch
  // a T-junction. They belong to no face, so the steps above never see them.
  // When everything such a sliver was stitched to has just been removed, it
  // would be left hanging in mid-air: take it out too.
  if (result.holes) {
    let slivers = 0;
    for (let t = 0; t < T; t++) if (!ok[t] && !removed[t] && tw[t * 3] !== tw[t * 3 + 1] && tw[t * 3 + 1] !== tw[t * 3 + 2] && tw[t * 3] !== tw[t * 3 + 2]) slivers++;
    if (slivers) {
      const ekey = (a, b) => a < b ? a * W + b : b * W + a;
      const live = new Set();                           // edges of what stays: faces and caps
      for (let t = 0; t < T; t++) {
        if (!ok[t] || removed[t]) continue;
        const a = tw[t * 3], b = tw[t * 3 + 1], c = tw[t * 3 + 2];
        live.add(ekey(a, b)); live.add(ekey(b, c)); live.add(ekey(c, a));
      }
      for (let i = 0; i < caps.length; i += 3) {
        const a = wid[caps[i]] ?? -1, b = wid[caps[i + 1]] ?? -1, c = wid[caps[i + 2]] ?? -1;
        live.add(ekey(a, b)); live.add(ekey(b, c)); live.add(ekey(c, a));
      }
      for (let t = 0; t < T; t++) {
        if (ok[t] || removed[t]) continue;
        const a = tw[t * 3], b = tw[t * 3 + 1], c = tw[t * 3 + 2];
        if (a === b || b === c || a === c) continue;
        if (live.has(ekey(a, b)) || live.has(ekey(b, c)) || live.has(ekey(c, a))) continue;
        removed[t] = 1;
        result.removedTris++;
      }
    }
  }

  // ── 8. the rim left behind ───────────────────────────────────────────────
  // A cap is triangulated from the face's own rim vertices, and those vertices stay: a ring of points in the middle of a flat face,
  // with a fan of long triangles running out from each to the face's far corners. Where such a vertex has nothing but flat triangles
  // round it (a closed fan, one plane), it says nothing about the shape: the triangles round it are replaced by a triangulation of
  // the ring they make, which uses every ring vertex (so no crack) and covers the same area. Anything that does not check out
  // is left exactly as it was.
  if (opts.floating === true) {
    try { removeFloatingTubes(); } catch (_) { /* the fill itself stands */ }
  }
  if ((result.holes && caps.length || opts.cleanup === true) && opts.rimVertices === true) {
    try { removeRimVertices(); } catch (_) { /* the fill itself stands */ }
  }
  if (opts.enclosed === true && (result.holes || opts.cleanup === true)) {
    try { removeEnclosedPieces(); } catch (_) { /* the fill itself stands */ }
  }
  // ── 10. pieces sealed inside ─────────────────────────────────────────────
  // A part's mesh can hold separate closed pieces inside its body: the balls of a check valve in a pump, a pin in a bore, the wall
  // of a cavity. They were seen through the holes; with the holes closed they are sealed inside and never visible again, but still
  // drawn, and in the viewport's edge overlay they show through as stray lines and points. With opts.enclosed every piece that lies
  // entirely inside the closed shell goes. The shell is the largest piece (by triangles) of what remains, caps included, and it must
  // be closed (no edge with a single triangle), or nothing is judged. A piece is inside when rays from the middles of three of its
  // triangles each cross the shell an odd number of times.
  function removeEnclosedPieces() {
    const nCaps = caps.length / 3, total = T + nCaps;
    const cornerV = (ref, k) => ref < T ? I[ref * 3 + k] : caps[(ref - T) * 3 + k];         // vertex number
    const cornerW = (ref, k) => ref < T ? tw[ref * 3 + k] : wid[caps[(ref - T) * 3 + k]];  // welded id
    const live = (ref) => ref < T ? !removed[ref] : true;
    const uf = new Int32Array(W); for (let i = 0; i < W; i++) uf[i] = i;
    const find = (a) => { while (uf[a] !== a) { uf[a] = uf[uf[a]]; a = uf[a]; } return a; };
    const unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) uf[rb] = ra; };
    for (let ref = 0; ref < total; ref++) { if (!live(ref)) continue; unite(cornerW(ref, 0), cornerW(ref, 1)); unite(cornerW(ref, 0), cornerW(ref, 2)); }
    const count = new Map(); let shellRoot = -1, shellN = 0;
    for (let ref = 0; ref < total; ref++) { if (!live(ref)) continue; const r = find(cornerW(ref, 0)); const n = (count.get(r) || 0) + 1; count.set(r, n); if (n > shellN) { shellN = n; shellRoot = r; } }
    if (count.size < 2) return;
    // the shell must be closed
    const ekey = (a, b) => a < b ? a * W + b : b * W + a;
    const ec = new Map(), shellRefs = [];
    for (let ref = 0; ref < total; ref++) {
      if (!live(ref) || find(cornerW(ref, 0)) !== shellRoot) continue;
      shellRefs.push(ref);
      const a = cornerW(ref, 0), b = cornerW(ref, 1), c = cornerW(ref, 2);
      if (a === b || b === c || a === c) continue;
      for (const k of [ekey(a, b), ekey(b, c), ekey(c, a)]) ec.set(k, (ec.get(k) || 0) + 1);
    }
    for (const n of ec.values()) if (n === 1) return;           // open somewhere: inside and outside cannot be told apart
    // rays along +x against the shell: its triangles filed by the cells of a y-z grid
    let ly = Infinity, lz = Infinity, hy = -Infinity, hz = -Infinity;
    for (const ref of shellRefs) for (let k = 0; k < 3; k++) { const v = cornerV(ref, k) * 3, y = P[v + 1], z = P[v + 2]; if (y < ly) ly = y; if (y > hy) hy = y; if (z < lz) lz = z; if (z > hz) hz = z; }
    const G = 64, cy = (hy - ly) / G || 1, cz = (hz - lz) / G || 1;
    const cellOf = (y, z) => Math.max(0, Math.min(G, Math.floor((y - ly) / cy))) * (G + 1) + Math.max(0, Math.min(G, Math.floor((z - lz) / cz)));
    const cells = new Map();
    for (const ref of shellRefs) {
      let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) { const v = cornerV(ref, k) * 3, y = P[v + 1], z = P[v + 2]; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const ja = Math.floor((y0 - ly) / cy), jb = Math.floor((y1 - ly) / cy), ka = Math.floor((z0 - lz) / cz), kb = Math.floor((z1 - lz) / cz);
      for (let jj = ja; jj <= jb; jj++) for (let kk = ka; kk <= kb; kk++) { const key = jj * (G + 1) + kk; const l = cells.get(key); if (l) l.push(ref); else cells.set(key, [ref]); }
    }
    const crossings = (x, y, z) => {
      const l = cells.get(cellOf(y, z)); if (!l) return 0;
      let hits = 0;
      for (const ref of l) {
        const a = cornerV(ref, 0) * 3, b = cornerV(ref, 1) * 3, c = cornerV(ref, 2) * 3;
        const ay = P[a + 1] - y, by = P[b + 1] - y, cyy = P[c + 1] - y, az = P[a + 2] - z, bz = P[b + 2] - z, czz = P[c + 2] - z;
        const d1 = ay * bz - az * by, d2 = by * czz - bz * cyy, d3 = cyy * az - czz * ay;
        if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;       // the ray misses this triangle's y-z shadow
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        if (Math.abs(nx) < 1e-20) continue;                                                // (a triangle seen edge-on along x)
        if (P[a] - (ny * (y - P[a + 1]) + nz * (z - P[a + 2])) / nx > x) hits++;
      }
      return hits;
    };
    // every other piece: the middles of three of its triangles, all inside, and the piece goes
    const byRoot = new Map();
    for (let ref = 0; ref < total; ref++) { if (!live(ref)) continue; const r = find(cornerW(ref, 0)); if (r === shellRoot) continue; let l = byRoot.get(r); if (!l) byRoot.set(r, l = []); l.push(ref); }
    let gone = 0, goneTris = 0; const dropCaps = new Set();
    for (const refs of byRoot.values()) {
      let inside = 0;
      for (const q of [0, Math.floor(refs.length / 2), refs.length - 1]) {
        const ref = refs[q], a = cornerV(ref, 0) * 3, b = cornerV(ref, 1) * 3, c = cornerV(ref, 2) * 3;
        if (crossings((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3) % 2 === 1) inside++;
      }
      if (inside !== 3) continue;
      for (const ref of refs) { if (ref < T) { removed[ref] = 1; goneTris++; } else dropCaps.add(ref - T); }
      gone++;
    }
    if (!gone) return;
    if (dropCaps.size) {
      const nc = [], no = [];
      for (let k = 0; k < nCaps; k++) if (!dropCaps.has(k)) { nc.push(caps[k * 3], caps[k * 3 + 1], caps[k * 3 + 2]); no.push(capOwner[k]); }
      caps.length = 0; capOwner.length = 0;
      for (const v of nc) caps.push(v);
      for (const v of no) capOwner.push(v);
      result.addedTris -= dropCaps.size;
    }
    result.removedTris += goneTris;
    result.enclosed = (result.enclosed || 0) + gone;
  }
  // ── 9. walls left floating ───────────────────────────────────────────────
  // A hole in a broken mesh can come with its wall cut loose: a thin open tube (a ring of facets, no ends) that touches nothing, sitting
  // where the hole was, with the face around it open or already closed. It is not part of any solid. Such a tube is taken out when it is
  // small (within the size limit) and really a tube or a cup (every facet runs along one axis or across it, which is what a hole's wall
  // and floor look like). One that sits in an opening of the face, a little wider than itself, closes that opening as well.
  function removeFloatingTubes() {
    const uf = new Int32Array(W); for (let w = 0; w < W; w++) uf[w] = w;
    const find = (a) => { while (uf[a] !== a) { uf[a] = uf[uf[a]]; a = uf[a]; } return a; };
    for (let t = 0; t < T; t++) {
      if (removed[t]) continue;
      const a = tw[t * 3], b = tw[t * 3 + 1], c = tw[t * 3 + 2];
      if (a === b || b === c || a === c) continue;
      const ra = find(a), rb = find(b), rc = find(c);
      if (rb !== ra) uf[rb] = ra;
      if (find(rc) !== find(ra)) uf[find(rc)] = find(ra);
    }
    // The caps are part of the mesh by now. A piece that carries one has just had a hole closed (or its face tidied): without its caps
    // it looks open, like a loose wall, but it is not one, and it stays.
    for (let i = 0; i < caps.length; i += 3) {
      const ra = find(wid[caps[i]]), rb = find(wid[caps[i + 1]]);
      if (rb !== ra) uf[rb] = ra;
      const rc = find(wid[caps[i + 2]]);
      if (rc !== find(ra)) uf[rc] = find(ra);
    }
    const capped = new Set();
    for (let i = 0; i < caps.length; i += 3) capped.add(find(wid[caps[i]]));
    const comps = new Map();                            // root → { tris: [], edges: Map }
    for (let t = 0; t < T; t++) {
      if (removed[t] || !ok[t]) continue;
      const r = find(tw[t * 3]);
      let c = comps.get(r); if (!c) comps.set(r, c = { tris: [], big: false });
      c.tris.push(t);
      if (c.tris.length > 4000) c.big = true;
    }
    // A loose wall is small next to what it was cut from. A piece that is a good part of the mesh is the mesh (a part that is itself an
    // open cup or sleeve), however high the size limit is set: it stays, and so does more than a third of the mesh going at all.
    const lim = Math.min(maxSize * 1.5, diag * 0.25);
    let aliveTris = 0; for (let t = 0; t < T; t++) if (!removed[t]) aliveTris++;
    const tubes = [];
    for (const [root, c] of comps) {
      if (c.big || c.tris.length < 6 || c.tris.length > aliveTris * 0.25 || capped.has(root)) continue;
      // size
      let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
      for (const t of c.tris) for (let k = 0; k < 3; k++) {
        const v = I[t * 3 + k];
        if (P[v * 3] < lx) lx = P[v * 3]; if (P[v * 3] > hx) hx = P[v * 3];
        if (P[v * 3 + 1] < ly) ly = P[v * 3 + 1]; if (P[v * 3 + 1] > hy) hy = P[v * 3 + 1];
        if (P[v * 3 + 2] < lz) lz = P[v * 3 + 2]; if (P[v * 3 + 2] > hz) hz = P[v * 3 + 2];
      }
      if (Math.hypot(hx - lx, hy - ly, hz - lz) > lim) continue;
      // open: some edge is used by one triangle only
      const ec = new Map();
      for (const t of c.tris) for (let e = 0; e < 3; e++) {
        const a = tw[t * 3 + e], b = tw[t * 3 + (e + 1) % 3], k = a < b ? a * W + b : b * W + a;
        ec.set(k, (ec.get(k) || 0) + 1);
      }
      let open = 0, multi = false;
      for (const n of ec.values()) { if (n === 1) open++; else if (n > 2) multi = true; }
      if (!open || multi) continue;
      // a tube: one axis that every facet runs along
      // the axis is where the walls' normals cross (a tube), or the normal of the floor (a cup: a blind hole's wall and floor, cut loose)
      const cands = [];
      const bins = new Map();
      for (const t of c.tris) { const k = Math.round(nx[t] * 50) + ',' + Math.round(ny[t] * 50) + ',' + Math.round(nz[t] * 50); const l = bins.get(k); if (l) l.push(t); else bins.set(k, [t]); }
      let modal = null; for (const l of bins.values()) if (l.length >= 4 && (!modal || l.length > modal.length)) modal = l;
      if (modal) cands.push([nx[modal[0]], ny[modal[0]], nz[modal[0]]]);
      for (let q = 0; q < Math.min(c.tris.length, 8); q++) {
        const bi = c.tris[q];
        let bj = bi, bd = 2;
        for (const t of c.tris) { const d = Math.abs(nx[t] * nx[bi] + ny[t] * ny[bi] + nz[t] * nz[bi]); if (d < bd) { bd = d; bj = t; } }
        const cx = ny[bi] * nz[bj] - nz[bi] * ny[bj], cy = nz[bi] * nx[bj] - nx[bi] * nz[bj], cz = nx[bi] * ny[bj] - ny[bi] * nx[bj];
        const cl = Math.hypot(cx, cy, cz);
        if (cl > 0.2) cands.push([cx / cl, cy / cl, cz / cl]);
      }
      let ax = 0, ay = 0, az = 0, along = false;
      for (const cd of cands) {
        ax = cd[0]; ay = cd[1]; az = cd[2];
        along = true;
        for (const t of c.tris) {
          const d = Math.abs(nx[t] * ax + ny[t] * ay + nz[t] * az);
          if (d > 0.15 && d < 0.99) { along = false; break; }       // a facet that is neither wall nor floor
        }
        if (along) break;
      }
      if (!along) continue;
      let d0 = Infinity, d1 = -Infinity;
      for (const t of c.tris) for (let k = 0; k < 3; k++) {
        const v = I[t * 3 + k], d = P[v * 3] * ax + P[v * 3 + 1] * ay + P[v * 3 + 2] * az;
        if (d < d0) d0 = d; if (d > d1) d1 = d;
      }
      tubes.push({ c, ax, ay, az, d0, d1, size: Math.hypot(hx - lx, hy - ly, hz - lz), cx: (lx + hx) / 2, cy: (ly + hy) / 2, cz: (lz + hz) / 2 });
    }
    if (!tubes.length || tubes.length > 20000) return;
    // the flat faces that could hold one end of a tube: grid of triangle centres
    const cell = lim * 2, grid = new Map();
    const inTube = new Set(); for (const tb of tubes) for (const t of tb.c.tris) inTube.add(t);
    const gkey = (x, y, z) => Math.floor(x / cell) + ',' + Math.floor(y / cell) + ',' + Math.floor(z / cell);
    for (let t = 0; t < T; t++) {
      if (removed[t] || !ok[t] || inTube.has(t)) continue;
      // (filed under each of its corners: a face round a hole is a few big triangles, whose centres are far from it)
      for (let m = 0; m < 3; m++) {
        const v = I[t * 3 + m], k = gkey(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        const l = grid.get(k); if (l) { if (l[l.length - 1] !== t) l.push(t); } else grid.set(k, [t]);
      }
    }
    let gone = 0, goneTris = 0;
    for (const tb of tubes) {
      if (goneTris + tb.c.tris.length > aliveTris * 0.34) continue;
      const { ax, ay, az } = tb;
      let hold = false;
      // the wall sits in an opening of the face that is over the limit (the opening is only a little wider than the wall: it is
      // the same hole): the opening is closed and the wall goes
      for (const lp of bigLoops) {
        if ((lp.state && lp.state !== 3) || lp.size > Math.min(tb.size * 4, maxSize * 8)) continue;
        const s0 = seedOf(lp), fnx = nx[s0], fny = ny[s0], fnz = nz[s0];
        if (Math.abs(fnx * ax + fny * ay + fnz * az) < 0.995) continue;
        const v0 = I[lp.hes[0]], pd = fnx * P[v0 * 3] + fny * P[v0 * 3 + 1] + fnz * P[v0 * 3 + 2];
        const td = fnx * tb.cx + fny * tb.cy + fnz * tb.cz, half = Math.abs(tb.d1 - tb.d0) / 2 + distTol * 4 + 1e-12;
        if (Math.abs(td - pd) > half + 1e-9 && Math.abs(td - pd) > tb.size * 1.6) continue;
        // is the wall's centre inside the opening's outline?
        const [ux, uy, uz, vx, vy, vz] = lp.basis;
        const qx = tb.cx * ux + tb.cy * uy + tb.cz * uz, qy = tb.cx * vx + tb.cy * vy + tb.cz * vz;
        let inside = false;
        for (let i = 0, j = lp.hes.length - 1; i < lp.hes.length; j = i++) {
          const a = I[lp.hes[i]], b = I[lp.hes[j]];
          const ax2 = P[a * 3] * ux + P[a * 3 + 1] * uy + P[a * 3 + 2] * uz, ay2 = P[a * 3] * vx + P[a * 3 + 1] * vy + P[a * 3 + 2] * vz;
          const bx2 = P[b * 3] * ux + P[b * 3 + 1] * uy + P[b * 3 + 2] * uz, by2 = P[b * 3] * vx + P[b * 3 + 1] * vy + P[b * 3 + 2] * vz;
          if ((ay2 > qy) !== (by2 > qy) && qx < (bx2 - ax2) * (qy - ay2) / (by2 - ay2) + ax2) inside = !inside;
        }
        if (!inside) continue;
        if (lp.state === 3) { hold = true; break; }               // another wall of this opening: the opening is closed already
        const capMark = caps.length, ownerMark = capOwner.length, addedMark = result.addedTris;
        if (capLoop(lp) !== lp.hes.length - 2) { caps.length = capMark; capOwner.length = ownerMark; result.addedTris = addedMark; lp.state = 2; continue; }
        lp.state = 3; hold = true;
        result.holes++; result.open++; result.loops++;
        break;
      }
      const gx = Math.floor(tb.cx / cell), gy = Math.floor(tb.cy / cell), gz = Math.floor(tb.cz / cell);
      for (let i = -1; i <= 1 && !hold; i++) for (let j = -1; j <= 1 && !hold; j++) for (let k = -1; k <= 1 && !hold; k++) {
        const l = grid.get((gx + i) + ',' + (gy + j) + ',' + (gz + k)); if (!l) continue;
        for (const t of l) {
          // the tube's own axis is only as good as its facets: the face beside it gives the true one
          const dn = nx[t] * ax + ny[t] * ay + nz[t] * az;
          if (Math.abs(dn) < 0.995) continue;
          if (!tb.verts) { tb.verts = new Set(); for (const q of tb.c.tris) for (let m = 0; m < 3; m++) tb.verts.add(I[q * 3 + m]); }
          const sg = dn > 0 ? 1 : -1, bx = nx[t] * sg, by = ny[t] * sg, bz = nz[t] * sg;
          let e0 = Infinity, e1 = -Infinity;
          for (const v of tb.verts) { const d = P[v * 3] * bx + P[v * 3 + 1] * by + P[v * 3 + 2] * bz; if (d < e0) e0 = d; if (d > e1) e1 = d; }
          const v = I[t * 3], dt = P[v * 3] * bx + P[v * 3 + 1] * by + P[v * 3 + 2] * bz;
          if (Math.abs(dt - e0) <= distTol * 4 || Math.abs(dt - e1) <= distTol * 4) { hold = true; break; }
        }
      }
      // (a wall that is not beside any face is no solid either: open, small, shaped like the inside of a hole. It goes too)
      for (const t of tb.c.tris) { removed[t] = 1; result.removedTris++; }
      gone++; goneTris += tb.c.tris.length;
    }
    if (gone) result.floating = (result.floating || 0) + gone;
  }
  function removeRimVertices() {
    const nCaps = caps.length / 3;
    const capAlive = new Uint8Array(nCaps).fill(1);
    const cand = new Map();                             // welded rim vertex → refs of the live triangles round it (< T: the mesh's own, else T + cap)
    for (let i = 0; i < caps.length; i++) cand.set(wid[caps[i]], null);
    if (opts.cleanup === true) {
      // every vertex whose triangles all lie in one plane (a closed fan is checked below)
      const cnt = new Int32Array(W), fx = new Float32Array(W), fy = new Float32Array(W), fz = new Float32Array(W), flatV = new Uint8Array(W).fill(1);
      const see = (t, a, b, c) => {
        if (!ok[t]) { flatV[a] = flatV[b] = flatV[c] = 0; return; }
        for (const w of [a, b, c]) {
          if (!cnt[w]++) { fx[w] = nx[t]; fy[w] = ny[t]; fz[w] = nz[t]; }
          else if (fx[w] * nx[t] + fy[w] * ny[t] + fz[w] * nz[t] < cosTol) flatV[w] = 0;
        }
      };
      for (let t = 0; t < T; t++) if (!removed[t]) see(t, tw[t * 3], tw[t * 3 + 1], tw[t * 3 + 2]);
      for (let w = 0; w < W; w++) if (flatV[w] && cnt[w] >= 3 && !cand.has(w)) cand.set(w, null);
    }
    for (const w of cand.keys()) cand.set(w, []);
    const addRefs = (ref, a, b, c) => { for (const w of [a, b, c]) { const l = cand.get(w); if (l) l.push(ref); } };
    for (let t = 0; t < T; t++) {
      if (removed[t]) continue;
      addRefs(t, tw[t * 3], tw[t * 3 + 1], tw[t * 3 + 2]);
    }
    for (let k = 0; k < nCaps; k++) addRefs(T + k, wid[caps[k * 3]], wid[caps[k * 3 + 1]], wid[caps[k * 3 + 2]]);
    const corner = (ref, c) => ref < T ? I[ref * 3 + c] : caps[(ref - T) * 3 + c];
    const alive = (ref) => ref < T ? !removed[ref] : !!capAlive[ref - T];
    const extra = [], extraOwner = [];                  // triangles that replace stars (their refs continue after the caps)
    const refTri = (ref) => ref < T + nCaps ? [corner(ref, 0), corner(ref, 1), corner(ref, 2)] : extra[ref - T - nCaps];
    const refOwner = (ref) => ref < T ? ref : ref < T + nCaps ? capOwner[ref - T] : extraOwner[ref - T - nCaps];
    const refAlive = new Map();                         // refs past the caps: alive or not
    const live = (ref) => ref < T + nCaps ? alive(ref) : refAlive.get(ref) === true;
    const kill = (ref) => { if (ref < T) { removed[ref] = 1; result.removedTris++; } else if (ref < T + nCaps) { capAlive[ref - T] = 0; result.addedTris--; } else refAlive.set(ref, false); };
    const wOf = (v) => wid[v];
    let any = true, total = 0;
    for (let pass = 0; pass < 4 && any; pass++) {
      any = false;
      const order = [...cand.keys()].sort((a, b) => cand.get(a).length - cand.get(b).length);
      for (const w of order) {
        const refs = cand.get(w).filter(live);
        cand.set(w, refs);
        if (refs.length < 3) continue;
        // the plane, from the first triangle
        const tr0 = refTri(refs[0]);
        const v0 = tr0.find(v => wOf(v) === w); if (v0 === undefined) continue;
        const px = P[v0 * 3], py = P[v0 * 3 + 1], pz = P[v0 * 3 + 2];
        let N = null;
        const ring = new Map();                         // welded start → { v: its vertex number, to: welded end }
        let good = true, oldArea = 0, sx = 0, sy = 0, sz = 0;
        const orig = new Map();                         // welded ring vertex → the one vertex number it must keep
        for (const ref of refs) {
          const tr = refTri(ref), k = tr.findIndex(v => wOf(v) === w);
          if (k < 0) { good = false; break; }
          const va = tr[(k + 1) % 3], vb = tr[(k + 2) % 3], wa = wOf(va), wb = wOf(vb);
          if (wa === w || wb === w || wa === wb || ring.has(wa)) { good = false; break; }
          // (a CAD face repeats its rim vertices, one copy per triangle fan: the same place, the same shading: any copy will do)
          if (!orig.has(wa)) orig.set(wa, va);
          if (!orig.has(wb)) orig.set(wb, vb);
          ring.set(wa, { v: orig.get(wa), to: wb });
          const ax = P[va * 3] - px, ay = P[va * 3 + 1] - py, az = P[va * 3 + 2] - pz;
          const bx = P[vb * 3] - px, by = P[vb * 3 + 1] - py, bz = P[vb * 3 + 2] - pz;
          const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
          const l = Math.hypot(cx, cy, cz);
          if (!(l > 0)) { good = false; break; }
          const n = [cx / l, cy / l, cz / l];
          if (!N) N = n; else if (N[0] * n[0] + N[1] * n[1] + N[2] * n[2] < cosTol) { good = false; break; }
          sx += cx; sy += cy; sz += cz;
          oldArea += l / 2;
        }
        if (!good || !N) continue;
        { const l = Math.hypot(sx, sy, sz); if (!(l > 0)) continue; N = [sx / l, sy / l, sz / l]; }     // the area-weighted normal: the steadiest
        // one closed loop through every ring vertex
        const loop = [];
        let cur = ring.keys().next().value; const first = cur;
        for (let g = 0; g <= refs.length; g++) { const e = ring.get(cur); if (!e) { good = false; break; } loop.push(e.v); cur = e.to; if (cur === first) break; }
        if (!good || cur !== first || loop.length !== refs.length) continue;
        // flat: every ring vertex on the plane through this one
        for (const v of loop) if (Math.abs(N[0] * (P[v * 3] - px) + N[1] * (P[v * 3 + 1] - py) + N[2] * (P[v * 3 + 2] - pz)) > distTol) { good = false; break; }
        if (!good) continue;
        let ux, uy, uz;
        if (Math.abs(N[0]) < 0.9) { ux = 0; uy = -N[2]; uz = N[1]; } else { ux = N[2]; uy = 0; uz = -N[0]; }
        const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
        const vx = N[1] * uz - N[2] * uy, vy = N[2] * ux - N[0] * uz, vz = N[0] * uy - N[1] * ux;
        const xs = new Float64Array(loop.length), ys = new Float64Array(loop.length);
        for (let i = 0; i < loop.length; i++) {
          const v = loop[i];
          xs[i] = P[v * 3] * ux + P[v * 3 + 1] * uy + P[v * 3 + 2] * uz; ys[i] = P[v * 3] * vx + P[v * 3 + 1] * vy + P[v * 3 + 2] * vz;
        }
        const tris = earClip(xs, ys);
        if (tris.length / 3 !== loop.length - 2) continue;
        const usedR = new Uint8Array(loop.length);
        let newArea = 0, fine = true;
        for (let i = 0; i < tris.length; i += 3) {
          const a = tris[i], b = tris[i + 1], c = tris[i + 2];
          usedR[a] = usedR[b] = usedR[c] = 1;
          const s = ((xs[b] - xs[a]) * (ys[c] - ys[a]) - (xs[c] - xs[a]) * (ys[b] - ys[a])) / 2;
          if (!(s > 0)) { fine = false; break; }
          newArea += s;
        }
        if (!fine || usedR.some(u => !u) || Math.abs(newArea - oldArea) > oldArea * 1e-4) continue;
        // commit
        const owner = refOwner(refs[0]);
        for (const ref of refs) kill(ref);
        for (let i = 0; i < tris.length; i += 3) {
          const tri = [loop[tris[i]], loop[tris[i + 1]], loop[tris[i + 2]]];
          const ref = T + nCaps + extra.length;
          extra.push(tri); extraOwner.push(owner); refAlive.set(ref, true);
          addRefs(ref, wOf(tri[0]), wOf(tri[1]), wOf(tri[2]));
          result.addedTris++;
        }
        cand.set(w, []);
        total++; any = true;
      }
    }
    if (!total) return;
    const nc = [], no = [];
    for (let k = 0; k < nCaps; k++) if (capAlive[k]) { nc.push(caps[k * 3], caps[k * 3 + 1], caps[k * 3 + 2]); no.push(capOwner[k]); }
    for (let k = 0; k < extra.length; k++) if (refAlive.get(T + nCaps + k)) { nc.push(extra[k][0], extra[k][1], extra[k][2]); no.push(extraOwner[k]); }
    caps.length = 0; capOwner.length = 0;
    for (let i = 0; i < nc.length; i++) caps.push(nc[i]);
    for (let i = 0; i < no.length; i++) capOwner.push(no[i]);
    result.rimVertices = total;
  }

  for (const lp of loops) if (lp.big && lp.state === 1) result.skipped.tooLarge--;      // (closed along with its hole)
  result.removed = removed;
  result.caps = Uint32Array.from(caps);
  result.capOwner = Uint32Array.from(capOwner);
  if (nvSrc.length) {
    result.newPositions = Float32Array.from(nvPos); result.newSrc = Uint32Array.from(nvSrc); result.newW = Float32Array.from(nvW);
    result.newNormals = Float32Array.from(nvNormal); result.fixIds = Uint32Array.from(fixIds); result.fixNormals = Float32Array.from(fixNormals);
  }
  return result;
}

// z = h(x, y) as a thin plate spline through the points (it passes through each), with its slopes; null when the system is singular.
function fitSpline(xs, ys, zs) {
  const n = xs.length;
  if (n < 4) return null;
  let L = 0;
  for (let i = 0; i < n; i++) L = Math.max(L, Math.abs(xs[i]), Math.abs(ys[i]));
  if (!(L > 0)) return null;
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  for (let i = 0; i < n; i++) { px[i] = xs[i] / L; py[i] = ys[i] / L; pz[i] = zs[i] / L; }
  const phi = (r2) => r2 > 1e-300 ? 0.5 * r2 * Math.log(r2) : 0;       // r^2 ln r
  const M = n + 3, A = new Float64Array(M * (M + 1));
  const W = M + 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) { const dx = px[i] - px[j], dy = py[i] - py[j]; A[i * W + j] = phi(dx * dx + dy * dy); }
    A[i * W + i] += 1e-10;
    A[i * W + n] = 1; A[i * W + n + 1] = px[i]; A[i * W + n + 2] = py[i];
    A[n * W + i] = 1; A[(n + 1) * W + i] = px[i]; A[(n + 2) * W + i] = py[i];
    A[i * W + M] = pz[i];
  }
  for (let col = 0; col < M; col++) {
    let p = col;
    for (let r = col + 1; r < M; r++) if (Math.abs(A[r * W + col]) > Math.abs(A[p * W + col])) p = r;
    if (!(Math.abs(A[p * W + col]) > 1e-12)) return null;
    if (p !== col) for (let c = 0; c < W; c++) { const t = A[col * W + c]; A[col * W + c] = A[p * W + c]; A[p * W + c] = t; }
    const d = A[col * W + col];
    for (let c = col; c < W; c++) A[col * W + c] /= d;
    for (let r = 0; r < M; r++) {
      if (r === col) continue;
      const k = A[r * W + col];
      if (k) for (let c = col; c < W; c++) A[r * W + c] -= k * A[col * W + c];
    }
  }
  const wgt = new Float64Array(M);
  for (let i = 0; i < M; i++) { wgt[i] = A[i * W + M]; if (!Number.isFinite(wgt[i])) return null; }
  return {
    h: (x, y) => {
      const X = x / L, Y = y / L;
      let s = wgt[n] + wgt[n + 1] * X + wgt[n + 2] * Y;
      for (let i = 0; i < n; i++) { const dx = X - px[i], dy = Y - py[i]; s += wgt[i] * phi(dx * dx + dy * dy); }
      return s * L;
    },
    hx: (x, y) => {
      const X = x / L, Y = y / L;
      let s = wgt[n + 1];
      for (let i = 0; i < n; i++) { const dx = X - px[i], dy = Y - py[i], r2 = dx * dx + dy * dy; if (r2 > 1e-300) s += wgt[i] * dx * (Math.log(r2) + 1); }
      return s;
    },
    hy: (x, y) => {
      const X = x / L, Y = y / L;
      let s = wgt[n + 2];
      for (let i = 0; i < n; i++) { const dx = X - px[i], dy = Y - py[i], r2 = dx * dx + dy * dy; if (r2 > 1e-300) s += wgt[i] * dy * (Math.log(r2) + 1); }
      return s;
    },
  };
}

// z = h(x, y) as a quadric through the points (least squares), with its slopes; null when the points do not pin one down.
function fitQuadric(xs, ys, zs) {
  const n = xs.length;
  let L = 0;
  for (let i = 0; i < n; i++) L = Math.max(L, Math.abs(xs[i]), Math.abs(ys[i]));
  if (!(L > 0)) return null;
  const A = []; for (let r = 0; r < 6; r++) A.push(new Float64Array(7));
  for (let i = 0; i < n; i++) {
    const x = xs[i] / L, y = ys[i] / L, z = zs[i] / L, f = [x * x, x * y, y * y, x, y, 1];
    for (let r = 0; r < 6; r++) { for (let c = 0; c < 6; c++) A[r][c] += f[r] * f[c]; A[r][6] += f[r] * z; }
  }
  for (let col = 0; col < 6; col++) {
    let p = col;
    for (let r = col + 1; r < 6; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    if (!(Math.abs(A[p][col]) > 1e-9)) return null;
    const t = A[col]; A[col] = A[p]; A[p] = t;
    const d = A[col][col];
    for (let c = col; c < 7; c++) A[col][c] /= d;
    for (let r = 0; r < 6; r++) if (r !== col) { const k = A[r][col]; if (k) for (let c = col; c < 7; c++) A[r][c] -= k * A[col][c]; }
  }
  const k = A.map(r => r[6]);
  if (k.some(v => !Number.isFinite(v))) return null;
  return {
    h: (x, y) => { const X = x / L, Y = y / L; return (k[0] * X * X + k[1] * X * Y + k[2] * Y * Y + k[3] * X + k[4] * Y + k[5]) * L; },
    curv: 2 * Math.max(Math.abs(k[0]), Math.abs(k[1]), Math.abs(k[2])) / L,       // the largest second slope
    hx: (x, y) => 2 * k[0] * (x / L) + k[1] * (y / L) + k[3],
    hy: (x, y) => k[1] * (x / L) + 2 * k[2] * (y / L) + k[4],
  };
}


// Triangulate a simple polygon given counter-clockwise; returns index triples.
//
// Outlines of slots, keyways and engraved letters have long straight runs
// with several points on them. Clipping ears straight off such an outline
// goes wrong (an ear's diagonal runs through the points on the line), so the
// work is split in two:
//   1. drop the points that sit on a straight line and ear-clip the corners
//      that remain — a corner is an ear only if no other corner lies in or on
//      its triangle;
//   2. put the dropped points back: the one triangle that owns a straight
//      edge is split into a fan over the points along it.
// Every outline point ends up as a triangle corner, so the cap shares all of
// its edges with the face around it (no T-junctions, no cracks).
function earClip(xs, ys) {
  const n = xs.length;
  if (n < 3) return [];
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(xs[i]), Math.abs(ys[i]));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i]; if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i]; }
  const ext = Math.max(x1 - x0, y1 - y0) || 1;
  const eps = ext * ext * 1e-9;                      // area tolerance, relative to the outline's own size
  const cross = (a, b, c) => (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]);
  const same = (p, q) => Math.abs(xs[p] - xs[q]) + Math.abs(ys[p] - ys[q]) < ext * 1e-9;

  // 1. corners only
  let ring = [];
  for (let i = 0; i < n; i++) ring.push(i);
  for (let changed = true; changed && ring.length > 3;) {
    changed = false;
    for (let i = 0; i < ring.length && ring.length > 3; i++) {
      const m = ring.length;
      const a = ring[(i + m - 1) % m], bb = ring[i], c = ring[(i + 1) % m];
      const dot = (xs[bb] - xs[a]) * (xs[c] - xs[bb]) + (ys[bb] - ys[a]) * (ys[c] - ys[bb]);
      if (Math.abs(cross(a, bb, c)) <= eps && dot > 0) { ring.splice(i, 1); i--; changed = true; }   // on a straight run (not a spike)
    }
  }
  const corners = ring.slice();

  // 2. ear clipping on the corners
  // Only a corner that turns the wrong way (reflex, or straight) can lie inside an ear of a simple outline, so the test for a blocked
  // ear looks at those alone. They are few on a round hole or a slot: the test used to run over every point of the ring, which made the
  // whole thing cubic (a 3000-point outline took minutes; it takes well under a second now).
  const tris = [];
  const reflex = new Set();
  const turnOf = (i) => { const m = ring.length; return cross(ring[(i + m - 1) % m], ring[i], ring[(i + 1) % m]); };
  for (let i = 0; i < ring.length; i++) if (!(turnOf(i) > eps)) reflex.add(ring[i]);
  const blocked = (a, bb, c) => {
    for (const p of reflex) {
      if (p === a || p === bb || p === c || same(p, a) || same(p, bb) || same(p, c)) continue;
      if (cross(a, bb, p) >= -eps && cross(bb, c, p) >= -eps && cross(c, a, p) >= -eps) return true;   // in or on the triangle
    }
    return false;
  };
  let guard = ring.length * ring.length + 16;
  while (ring.length > 3 && guard-- > 0) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const m = ring.length;
      const a = ring[(i + m - 1) % m], bb = ring[i], c = ring[(i + 1) % m];
      const cr = cross(a, bb, c);
      if (!(cr > eps) || blocked(a, bb, c)) continue;
      // prefer the ear with the best-shaped triangle: fewer slivers
      const l = (xs[c] - xs[a]) ** 2 + (ys[c] - ys[a]) ** 2 + (xs[bb] - xs[a]) ** 2 + (ys[bb] - ys[a]) ** 2 + (xs[c] - xs[bb]) ** 2 + (ys[c] - ys[bb]) ** 2;
      const score = cr / l;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    const m = ring.length;
    tris.push([ring[(best + m - 1) % m], ring[best], ring[(best + 1) % m]]);
    ring.splice(best, 1);
    // the two corners beside the clipped one may have straightened out (a corner never turns the other way by losing a neighbour)
    if (ring.length > 2) {
      const m2 = ring.length;
      for (const j of [(best + m2 - 1) % m2, best % m2]) { if (turnOf(j) > eps) reflex.delete(ring[j]); else reflex.add(ring[j]); }
    }
  }
  if (ring.length === 3) tris.push([ring[0], ring[1], ring[2]]);
  else if (ring.length > 3) {
    // no clean ear left (an outline that touches itself): a fan is the best that can be done
    for (let i = 1; i + 1 < ring.length; i++) tris.push([ring[0], ring[i], ring[i + 1]]);
  }

  // 3. the points along straight edges go back in
  const cornerPos = new Map();                        // corner → position in `corners`
  corners.forEach((c, i) => cornerPos.set(c, i));
  const out = [];
  if (corners.length === n) { for (const t of tris) out.push(t[0], t[1], t[2]); return out; }
  // points between consecutive corners u → v, in outline order
  const between = new Map();                          // "u>v" → [p1, p2, …]
  for (let i = 0; i < corners.length; i++) {
    const u = corners[i], v = corners[(i + 1) % corners.length];
    const list = [];
    for (let p = (u + 1) % n; p !== v; p = (p + 1) % n) list.push(p);
    if (list.length) between.set(u + '>' + v, list);
  }
  for (const t of tris) {
    // A triangle can own up to three outline edges with points on them. Split
    // one edge at a time: fan from the corner opposite that edge.
    let pieces = [t];
    for (let e = 0; e < 3; e++) {
      const u = t[e], v = t[(e + 1) % 3];
      const list = between.get(u + '>' + v);
      if (!list) continue;
      between.delete(u + '>' + v);
      const next = [];
      for (const piece of pieces) {
        const k = piece.indexOf(u);
        if (k < 0 || piece[(k + 1) % 3] !== v) { next.push(piece); continue; }
        const w = piece[(k + 2) % 3];
        const chain = [u, ...list, v];
        for (let i = 0; i + 1 < chain.length; i++) next.push([chain[i], chain[i + 1], w]);
      }
      pieces = next;
    }
    for (const p of pieces) out.push(p[0], p[1], p[2]);
  }
  return out;
}

// Apply a result to an index buffer: the triangles that survive, then the caps.
// `groups` (optional, three.js style {start,count,materialIndex}) are kept:
// each cap joins the group of the face it closes.
export function applyHoleFill(index, res, groups) {
  const T = (index.length / 3) | 0;
  const gs = (groups && groups.length > 1)
    ? groups.map(g => ({ start: g.start, count: Math.min(g.count, index.length - g.start), materialIndex: g.materialIndex }))
    : [{ start: 0, count: index.length, materialIndex: groups && groups[0] ? groups[0].materialIndex : 0 }];
  const groupOfTri = new Int32Array(T).fill(-1);
  gs.forEach((g, gi) => { for (let t = (g.start / 3) | 0, end = ((g.start + g.count) / 3) | 0; t < end && t < T; t++) groupOfTri[t] = gi; });
  const parts = gs.map(g => ({ idx: [], materialIndex: g.materialIndex }));
  for (let t = 0; t < T; t++) {
    if (res.removed[t]) continue;
    const gi = groupOfTri[t] < 0 ? 0 : groupOfTri[t];
    parts[gi].idx.push(index[t * 3], index[t * 3 + 1], index[t * 3 + 2]);
  }
  for (let i = 0; i < res.capOwner.length; i++) {
    const gi = groupOfTri[res.capOwner[i]] < 0 ? 0 : groupOfTri[res.capOwner[i]];
    parts[gi].idx.push(res.caps[i * 3], res.caps[i * 3 + 1], res.caps[i * 3 + 2]);
  }
  return parts.filter(p => p.idx.length).map(p => ({ idx: Uint32Array.from(p.idx), materialIndex: p.materialIndex }));
}

// After a hole is closed, the vertices on its rim touch only the flat face and the cap, which lie in one plane. On a mesh with
// smooth normals those vertices still carry the normal they had with the hole's wall (tilted between face and wall), so the
// cap would shade differently from the face around it, and Untriangulate would not join the two (it refuses a face whose
// vertex normals are not flat). This turns the normal of each such vertex to the plane's.
//   positions, index, normals   the new mesh (Float32Array xyz, triangle index, Float32Array xyz)
//   capKey                      a Set of "x,y,z" strings (the positions of the vertices the caps use); null: every vertex
// Returns how many vertices were changed.
export function flattenRimNormals(positions, index, normals, capKey) {
  const V = (positions.length / 3) | 0, T = (index.length / 3) | 0;
  const nx = new Float32Array(V), ny = new Float32Array(V), nz = new Float32Array(V), seen = new Uint8Array(V), mixed = new Uint8Array(V);
  for (let t = 0; t < T; t++) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z);
    if (!(l > 0)) continue;                       // a triangle with no area says nothing
    x /= l; y /= l; z /= l;
    for (const v of [a, b, c]) {
      if (!seen[v]) { seen[v] = 1; nx[v] = x; ny[v] = y; nz[v] = z; }
      else if (nx[v] * x + ny[v] * y + nz[v] * z < 0.9999) mixed[v] = 1;
    }
  }
  let n = 0;
  for (let v = 0; v < V; v++) {
    if (!seen[v] || mixed[v]) continue;
    if (capKey && !capKey.has(positions[v * 3] + ',' + positions[v * 3 + 1] + ',' + positions[v * 3 + 2])) continue;
    if (normals[v * 3] * nx[v] + normals[v * 3 + 1] * ny[v] + normals[v * 3 + 2] * nz[v] > 0.99999) continue;
    normals[v * 3] = nx[v]; normals[v * 3 + 1] = ny[v]; normals[v * 3 + 2] = nz[v];
    n++;
  }
  return n;
}
