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

// The most triangles a mesh may have: three half-edges each have to fit in
// one Map (2^24 entries).
const MAX_TRIS = Math.floor(16777216 / 3);

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
  // The adjacency below keeps one Map entry per triangle edge, and a Map
  // holds 2^24 entries at most: past that, set() throws. A mesh that large
  // (about 5.6 million triangles) is left as it is, and says so in
  // skipped.tooBig (1 = this mesh was not looked at).
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
  const he = new Map();
  const bad = new Set();
  for (let t = 0; t < T; t++) {
    if (!ok[t]) continue;
    for (let e = 0; e < 3; e++) {
      const k = tw[t * 3 + e] * W + tw[t * 3 + (e + 1) % 3];
      if (he.has(k)) bad.add(k); else he.set(k, t * 3 + e);
    }
  }
  const nb = new Int32Array(T * 3).fill(-1);            // half-edge → twin half-edge
  for (let t = 0; t < T; t++) {
    if (!ok[t]) continue;
    for (let e = 0; e < 3; e++) {
      const a = tw[t * 3 + e], b = tw[t * 3 + (e + 1) % 3];
      const k = a * W + b, kt = b * W + a;
      if (bad.has(k) || bad.has(kt)) continue;
      const o = he.get(kt);
      if (o !== undefined) nb[t * 3 + e] = o;
    }
  }

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
  const loopOfHe = new Int32Array(T * 3).fill(-1);      // owner-side half-edge → loop
  const startMap = new Map();
  for (let r = 0; r < R; r++) {
    if (rEnd[r] - rStart[r] < 2) continue;              // one triangle cannot enclose a hole
    startMap.clear();
    let nBoundary = 0, ambiguous = false;
    for (let q = rStart[r]; q < rEnd[r]; q++) {
      const t = order[q];
      for (let e = 0; e < 3; e++) {
        const o = nb[t * 3 + e];
        if (o >= 0 && region[(o / 3) | 0] === r) continue;
        const a = tw[t * 3 + e];
        if (startMap.has(a)) ambiguous = true;          // two loops touch at one vertex
        else startMap.set(a, t * 3 + e);
        nBoundary++;
      }
    }
    if (nBoundary < 6 || ambiguous) continue;           // an outline plus at least a triangular hole
    // plane basis
    const s = rSeed[r];
    const n0 = nx[s], n1 = ny[s], n2 = nz[s];
    let ux, uy, uz;
    if (Math.abs(n0) < 0.9) { ux = 0; uy = -n2; uz = n1; } else { ux = n2; uy = 0; uz = -n0; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = n1 * uz - n2 * uy, vy = n2 * ux - n0 * uz, vz = n0 * uy - n1 * ux;
    const used = new Set();
    const found = [];                                   // { hes, size, area2 }
    for (const [a0, h0] of startMap) {
      if (used.has(h0)) continue;
      const hes = [];
      let h = h0, closed = false;
      for (let guard = 0; guard <= nBoundary; guard++) {
        if (used.has(h)) break;
        used.add(h); hes.push(h);
        const t = (h / 3) | 0, e = h % 3;
        const end = tw[t * 3 + (e + 1) % 3];
        if (end === a0) { closed = true; break; }
        const nxt = startMap.get(end);
        if (nxt === undefined) break;
        h = nxt;
      }
      if (!closed || hes.length < 3) continue;
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
      if (f.size > maxSize) { result.skipped.tooLarge++; continue; }
      if (f.size > outline * maxFaceRatio && f.size > diag * maxPartRatio) { result.skipped.partOfShape++; continue; }
      const id = loops.length;
      loops.push({ r, hes: f.hes, size: f.size, basis: [ux, uy, uz, vx, vy, vz], state: 0 });
      for (const hh of f.hes) loopOfHe[hh] = id;
    }
  }
  if (!loops.length) return result;

  // ── 6. the surface behind each loop ──────────────────────────────────────
  const stamp = new Int32Array(T);                      // 0 = unvisited, else visit id
  const removed = new Uint8Array(T);
  const caps = [], capOwner = [];
  const limit = maxSize * depthFactor;
  let visit = 0;
  const bySize = loops.map((_, i) => i).sort((a, b) => loops[b].size - loops[a].size);
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
        const o = nb[h];
        if (o < 0) continue;
        const u = (o / 3) | 0;
        if (stamp[u] !== visit) { stamp[u] = visit; S.push(u); }
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
          const o = nb[h];
          if (o < 0) continue;
          const far = loopOfHe[o];
          if (far >= 0) { bounding.add(far); continue; } // the edge of a face this surface opens into
          const u = (o / 3) | 0;
          if (stamp[u] !== visit) { stamp[u] = visit; S.push(u); }
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
    if (!reason && S.length) {
      const capSet = new Set(capLoops);
      outer:
      for (const t of S) {
        for (let e = 0; e < 3; e++) {
          const o = nb[t * 3 + e];
          if (o < 0 || stamp[(o / 3) | 0] === visit) continue;
          if (!capSet.has(loopOfHe[o])) { reason = 'leaking'; break outer; }
        }
      }
      if (!reason) {
        outer2:
        for (const id of capLoops) {
          for (const h of loops[id].hes) {
            const o = nb[h];
            if (o < 0 || stamp[(o / 3) | 0] !== visit) { reason = 'leaking'; break outer2; }
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
      loops[L].state = 2;
      result.skipped[reason] = (result.skipped[reason] || 0) + 1;
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
