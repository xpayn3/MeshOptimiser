// holefill.js — close holes in the flat faces of a triangle mesh.
//
// Works on the mesh as it is (no remeshing, no decimation): it finds the flat
// faces, finds the closed loops cut into them, and for each loop decides
// whether it is really a hole before touching anything.
//
//   1. Weld vertices by position (CAD tessellation gives every face its own
//      vertices) and build triangle adjacency.
//   2. Grow planar regions: connected triangles that share one plane.
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
//
// Pure function, no dependencies: the app calls it per part, the tests call
// it from Node.

// The most triangles a mesh may have. The adjacency is a typed table (three half-edges per triangle, twice as many slots), so
// what limits it is memory in the worker, not the 2^24 entries of a Map.
const MAX_TRIS = 12000000;

export function fillFlatHoles(positions, index, opts = {}) {
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
  const nx = new Float32Array(T), ny = new Float32Array(T), nz = new Float32Array(T);
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
  const rStart = [], rEnd = [], rSeed = [];
  let filled = 0;
  for (let s = 0; s < T; s++) {
    if (!ok[s] || region[s] >= 0) continue;
    const r = rStart.length;
    const snx = nx[s], sny = ny[s], snz = nz[s];
    const sv = I[s * 3];
    const sd = snx * P[sv * 3] + sny * P[sv * 3 + 1] + snz * P[sv * 3 + 2];
    const from = filled;
    region[s] = r; order[filled++] = s;
    for (let q = from; q < filled; q++) {
      const t = order[q];
      for (let e = 0; e < 3; e++) {
        const o = nb[t * 3 + e];
        if (o < 0) continue;
        const u = (o / 3) | 0;
        if (region[u] >= 0) continue;
        if (nx[u] * snx + ny[u] * sny + nz[u] * snz < cosTol) continue;
        let flat = true;
        for (let c = 0; c < 3 && flat; c++) {
          const v = I[u * 3 + c];
          if (Math.abs(snx * P[v * 3] + sny * P[v * 3 + 1] + snz * P[v * 3 + 2] - sd) > distTol) flat = false;
        }
        if (!flat) continue;
        region[u] = r; order[filled++] = u;
      }
    }
    rStart.push(from); rEnd.push(filled); rSeed.push(s);
  }
  const R = rStart.length;

  // ── 5. boundary loops of each region; clockwise ones are openings ────────
  const loops = [];                                     // { r, hes:[half-edge…], size }
  const bigLoops = [];                                  // openings over the size limit (kept for a floating wall that sits in one: step 9)
  const loopOfHe = new Int32Array(T * 3).fill(-1);      // owner-side half-edge → loop
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
    const found = [];                                   // { hes, size, area2 }
    for (const hes of cycles) {
      if (hes.length < 3) continue;                     // (there and back along one edge: a crack, not a loop)
      // signed area about the face normal, and the widest point
      let area2 = 0;
      const xs = new Float64Array(hes.length), ys = new Float64Array(hes.length);
      for (let i = 0; i < hes.length; i++) {
        const v = I[hes[i]];
        const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
        xs[i] = px * ux + py * uy + pz * uz; ys[i] = px * vx + py * vy + pz * vz;
      }
      for (let i = 0, j = hes.length - 1; i < hes.length; j = i++) area2 += xs[j] * ys[i] - xs[i] * ys[j];
      let size2 = 0;
      const step = hes.length > 240 ? Math.ceil(hes.length / 240) : 1;
      for (let i = 0; i < hes.length; i += step) for (let j = i + 1; j < hes.length; j += step) {
        const dx = xs[i] - xs[j], dy = ys[i] - ys[j]; const d2 = dx * dx + dy * dy;
        if (d2 > size2) size2 = d2;
      }
      found.push({ hes, size: Math.sqrt(size2), area2 });
    }
    // counter-clockwise about the normal: the face's own outline (the largest
    // one, should a face ever report two)
    let outline = 0;
    for (const f of found) if (f.area2 > 0 && f.size > outline) outline = f.size;
    if (!(outline > 0)) continue;
    for (const f of found) {
      if (!(f.area2 < 0)) continue;                     // clockwise loops are the openings
      const wide = f.size > outline * maxFaceRatio && f.size > diag * maxPartRatio;
      if (f.size > maxSize) {
        result.skipped.tooLarge++;
        if (opts.floating === true) bigLoops.push({ r, hes: f.hes, size: f.size, basis: [ux, uy, uz, vx, vy, vz] });
        // The far end of a countersink or a flared hole is wider than the limit, though the hole is not: such an opening is kept as a
        // boundary (and is closed with the hole when the hole is taken), never as the start of one.
        if (f.size <= maxSize * bigFactor && !wide) {
          const id = loops.length;
          loops.push({ r, hes: f.hes, size: f.size, basis: [ux, uy, uz, vx, vy, vz], state: 0, big: true });
          for (const hh of f.hes) loopOfHe[hh] = id;
        }
        continue;
      }
      if (wide) { result.skipped.partOfShape++; continue; }
      const id = loops.length;
      loops.push({ r, hes: f.hes, size: f.size, basis: [ux, uy, uz, vx, vy, vz], state: 0 });
      for (const hh of f.hes) loopOfHe[hh] = id;
    }
  }
  const removed = new Uint8Array(T);
  const caps = [], capOwner = [];
  if (!loops.length && !(opts.floating === true && bigLoops.length)) {
    // nothing to close: with opts.cleanup, still take out what an earlier fill left behind
    if (opts.cleanup === true && opts.rimVertices === true) {
      try { removeRimVertices(); } catch (_) { /* nothing is changed */ }
      if (opts.floating === true) { try { removeFloatingTubes(); } catch (_) { /* nothing is changed */ } }
      if (result.rimVertices || result.floating) { result.removed = removed; result.caps = Uint32Array.from(caps); result.capOwner = Uint32Array.from(capOwner); }
    }
    return result;
  }

  // ── 6. the surface behind each loop ──────────────────────────────────────
  const stamp = new Int32Array(T);                      // 0 = unvisited, else visit id
  const limit = maxSize * depthFactor;
  let visit = 0;
  const bySize = loops.map((_, i) => i).filter(i => !loops[i].big).sort((a, b) => loops[b].size - loops[a].size);
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
    let q = 0;
    const pending = [];
    for (;;) {
      for (; q < S.length && !reason; q++) {
        const t = S[q];
        if (removed[t]) { reason = 'leaking'; break; }
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
        const s = rSeed[lp.r];
        const v = I[lp.hes[0]];
        const side = nx[s] * (cx - P[v * 3]) + ny[s] * (cy - P[v * 3 + 1]) + nz[s] * (cz - P[v * 3 + 2]);
        if (!(side < -distTol * 4)) { reason = 'raised'; break; }
      }
      // A sheet with one face wound the wrong way round: the wall of a hole through it lies below one face and "above" the other, but it
      // lies between the two parallel faces all the same, and that is a hole.
      if (reason === 'raised' && capLoops.length === 2) {
        const a0 = loops[capLoops[0]], a1 = loops[capLoops[1]];
        const sa = rSeed[a0.r], sb = rSeed[a1.r];
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
        const s = rSeed[lp.r], v0 = I[lp.hes[0]];
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
      else if (!isRaised && !want[kind]) reason = 'kind';
    }
    const all = [...bounding, ...absorbed];
    if (reason) {
      // Only the loop we started from is settled. The other loops this
      // surface touched get their own turn: a plunged or flow-drilled hole
      // is a collar standing on one face (raised, seen from there) and a
      // plain hole on the other, and it must not be written off because the
      // collar's side happened to come first.
      if ((reason === 'leaking' || reason === 'tooDeep') && opts.seal === true && !loops[L].big && trySeal(L)) continue;
      loops[L].state = 2;
      result.skipped[reason] = (result.skipped[reason] || 0) + 1;
      if (opts.debug) (result.skippedList = result.skippedList || []).push({ reason, size: loops[L].size, tris: S.length, caps: capLoops.length, ext: [bx1 - bx0, by1 - by0, bz1 - bz0] });
      continue;
    }
    // Accepted — provided every opening can be closed completely. A cap of
    // an n-point outline has n − 2 triangles; one that comes back short would
    // leave a crack, so then nothing is removed and the hole stays as it is.
    const capMark = caps.length, ownerMark = capOwner.length, addedMark = result.addedTris;
    let nCaps = 0, whole = true;
    for (const id of capLoops) {
      if (capLoop(loops[id]) !== loops[id].hes.length - 2) { whole = false; break; }
      nCaps++;
    }
    if (!whole) {
      caps.length = capMark; capOwner.length = ownerMark; result.addedTris = addedMark;
      loops[L].state = 2;
      result.skipped.uncappable++;
      continue;
    }
    for (const t of S) removed[t] = 1;
    for (const id of all) loops[id].state = 1;
    result.holes++;
    result.loops += nCaps;
    result.removedTris += S.length;
    if (isRaised) result.flattened++; else if (!S.length) result.open++; else if (nCaps >= 2) result.through++; else result.blind++;
  }

  // An opening into a hollow space (or into anything the hole's wall runs on into) cannot be taken out whole: what lies behind it is
  // not a hole but the rest of the part. The opening is sealed from outside instead: the wall of the hole, as far as it lies in the
  // column under the opening (inside its outline, no deeper than the depth limit), is taken out and the opening is closed flush with the
  // face. What lies behind stays as it was, out of sight.
  function trySeal(L) {
    const lp = loops[L];
    const s0 = rSeed[lp.r], fx = nx[s0], fy = ny[s0], fz = nz[s0];
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
    const seen = new Set(), S2 = [];
    const take = (t) => {
      if (seen.has(t) || removed[t]) return;
      seen.add(t);
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
      if (S2.length > maxComponentTris) return false;
      const t = S2[q];
      for (let e = 0; e < 3; e++) {
        const h = t * 3 + e;
        if (loopOfHe[h] >= 0) continue;
        for (const o of twins(h)) if (loopOfHe[o] < 0) take((o / 3) | 0);
      }
    }
    if (!S2.length) return false;
    const capMark = caps.length, ownerMark = capOwner.length, addedMark = result.addedTris;
    if (capLoop(lp) !== lp.hes.length - 2) { caps.length = capMark; capOwner.length = ownerMark; result.addedTris = addedMark; return false; }
    for (const t of S2) removed[t] = 1;
    lp.state = 1;
    result.holes++; result.blind++; result.sealed = (result.sealed || 0) + 1; result.loops++;
    result.removedTris += S2.length;
    return true;
  }

  // Triangulate one loop flush with its face, using the face's own vertices.
  function capLoop(lp) {
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
        const a = wid[caps[i]], b = wid[caps[i + 1]], c = wid[caps[i + 2]];
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
        const s0 = rSeed[lp.r], fnx = nx[s0], fny = ny[s0], fnz = nz[s0];
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
  return result;
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
  const tris = [];
  const blocked = (a, bb, c) => {
    for (const p of ring) {
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
