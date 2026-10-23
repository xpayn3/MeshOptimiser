// roundfaces.js — fewer facets on the round faces of a part that still knows its CAD faces.
//
// A CAD mesher cuts every cylinder, cone, sphere and torus into facets fine enough for the file's own tolerance, and that is where
// most of a CAD mesh's triangles are: the fillets, the bores, the shafts. For a picture on the web they can be far coarser. This
// takes points out of the round faces until the facets are as coarse as a deviation allows, with the face's neighbours following:
// a point on the rim between a wall and its cap goes from both at once, so the cap loses the point too and no crack opens.
//
// A point goes by an edge collapse: it is pulled onto a neighbouring point and the triangles between the two vanish. The
// neighbour must lie on every CAD face the point lies on (a rim point goes along its rim, a point inside a face goes anywhere in
// it, a corner where three faces meet never goes), so every face keeps its own vertices and shading. A collapse is allowed when
//   · no triangle round the point turns over or flattens to nothing,
//   · the point ends up within the deviation of the surface that replaces it (the sag of the new chord), and
//   · on a round face the facets that meet along the new edges turn from each other by no more than 360° / segments.
// The cheapest collapses go first, over as many passes as it takes. Nothing is moved and nothing new is triangulated, so there is
// nothing to fold. Only points that touch a face that is not a plane are tried: the planes are left to Untriangulate.
//
// The CAD record comes out the other side: the triangles are returned grouped by face, with each face's new range and area, and
// the edge polylines without the points that went, so the tools that read the record (Remove fillets and chamfers, the exact
// planar faces of Remove holes and Untriangulate, the CAD edge lines) still can.
//
//   positions, index   the mesh (Float32Array xyz; a triangle index)
//   opts.cad           { faces: [[kind, firstTri, triCount, area, ...radii]...], rows: [[firstPt, ptCount, tangent, faceA, faceB]...],
//                        pts: Float32Array }  — what the app keeps for a part from a STEP (_Brep)
//   opts.tolerance     how far the surface may move from the true face, in the mesh's units (default a thousandth of the size)
//   opts.segments      a full turn keeps at least this many facets (default 12)
// Returns { ok, positions, index, cad, collapsed, rings, lines, before, after } or { ok: false, why }.
//
// Pipes first (pipegrid.js): the round faces that are clean grids (the straight runs and the bends of a pipe, a hose, a bent rod)
// lose whole rings and whole lines, so the quads stay quads in line with each other; the point by point pass below then only works
// on what that could not read as a grid, and leaves the places it rebuilt alone.

import { rebuildPipeGrids } from './pipegrid.js?v=1';

export function simplifyRoundFaces(positions, index, opts = {}) {
  const pre = rebuildPipeGrids(positions, index, opts);
  // (no point is moved, by either pass: every point keeps its own normal, see keepNormals in meshops.js)
  if (!pre.changed) return { ...collapseRoundFaces(positions, index, opts), rings: 0, lines: 0, keepNormals: true };
  const r = collapseRoundFaces(positions, pre.index, { ...opts, cad: pre.cad, locked: pre.lockedKeys });
  if (r.ok === false) return r;
  return { ...r, before: (index.length / 3) | 0, rings: pre.rings, lines: pre.lines, why: undefined, keepNormals: true };
}

function collapseRoundFaces(positions, index, opts = {}) {
  const cad = opts.cad;
  if (!cad || !cad.faces || !cad.faces.length) return { ok: false, why: 'the part has no CAD faces (open the STEP with them)' };
  const T0 = (index.length / 3) | 0, V = (positions.length / 3) | 0;
  const faces = cad.faces, nF = faces.length;
  const segments = +opts.segments > 2 ? +opts.segments : 12;
  const cosCap = Math.cos(2 * Math.PI / segments);
  const P = positions;
  // the face of every triangle (a triangle outside every face belongs to a face of its own, past the record's)
  const fOf = new Int32Array(T0).fill(-1);
  for (let f = 0; f < nF; f++) { const [, s, c] = faces[f]; for (let t = s; t < s + c && t < T0; t++) fOf[t] = f; }
  let extraF = nF; for (let t = 0; t < T0; t++) if (fOf[t] < 0) fOf[t] = extraF++;
  const isRound = (f) => f < nF && faces[f][0] !== 0;
  // the size, and the places: vertices joined by position
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (!(diag > 0)) return { ok: false, why: 'the part has no size' };
  const inv = 1 / (diag * 1e-6);
  const keyAt = (x, y, z) => Math.round((x - x0) * inv) + ',' + Math.round((y - y0) * inv) + ',' + Math.round((z - z0) * inv);
  const place = new Int32Array(V), table = new Map(), rep = [];        // vertex → place; place → one vertex (for its position)
  for (let v = 0; v < V; v++) { const k = keyAt(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); let c = table.get(k); if (c === undefined) { c = rep.length; table.set(k, c); rep.push(v); } place[v] = c; }
  const nP = rep.length;
  const px = (c) => P[rep[c] * 3], py = (c) => P[rep[c] * 3 + 1], pz = (c) => P[rep[c] * 3 + 2];
  const tol = +opts.tolerance > 0 ? +opts.tolerance : diag * 1e-3;

  // the live mesh: triangles (vertex numbers), their face, alive flags; per place the triangles round it; per (face, place) a vertex
  const tri = Array.from(index), alive = new Uint8Array(T0).fill(1);
  const around = Array.from({ length: nP }, () => new Set());
  for (let t = 0; t < T0; t++) for (let k = 0; k < 3; k++) around[place[tri[t * 3 + k]]].add(t);
  const vertAt = new Map();                                            // face * nP + place → vertex of that face at that place
  const facesAt = Array.from({ length: nP }, () => new Set());
  for (let t = 0; t < T0; t++) for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k], c = place[v], f = fOf[t]; facesAt[c].add(f); const key = f * nP + c; if (!vertAt.has(key)) vertAt.set(key, v); }

  const normalOf = (a, b, c) => {                                      // of three places, area-weighted
    const ux = px(b) - px(a), uy = py(b) - py(a), uz = pz(b) - pz(a), vx = px(c) - px(a), vy = py(c) - py(a), vz = pz(c) - pz(a);
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const corners = (t) => [place[tri[t * 3]], place[tri[t * 3 + 1]], place[tri[t * 3 + 2]]];
  // distance from place q to the triangle of places a, b, c
  const distToTri = (q, a, b, c) => {
    const qx = px(q), qy = py(q), qz = pz(q);
    const ax = px(a), ay = py(a), az = pz(a), bx = px(b), by = py(b), bz = pz(b), cx = px(c), cy = py(c), cz = pz(c);
    const ab = [bx - ax, by - ay, bz - az], ac = [cx - ax, cy - ay, cz - az], aq = [qx - ax, qy - ay, qz - az];
    const d1 = dot(ab, aq), d2 = dot(ac, aq);
    if (d1 <= 0 && d2 <= 0) return Math.hypot(...aq);
    const bq = [qx - bx, qy - by, qz - bz], d3 = dot(ab, bq), d4 = dot(ac, bq);
    if (d3 >= 0 && d4 <= d3) return Math.hypot(...bq);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return Math.hypot(aq[0] - v * ab[0], aq[1] - v * ab[1], aq[2] - v * ab[2]); }
    const cq = [qx - cx, qy - cy, qz - cz], d5 = dot(ab, cq), d6 = dot(ac, cq);
    if (d6 >= 0 && d5 <= d6) return Math.hypot(...cq);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return Math.hypot(aq[0] - w * ac[0], aq[1] - w * ac[1], aq[2] - w * ac[2]); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return Math.hypot(bq[0] - w * (cx - bx), bq[1] - w * (cy - by), bq[2] - w * (cz - bz)); }
    const n = normalOf(a, b, c), nl = Math.hypot(...n) || 1;
    return Math.abs(dot(n, aq)) / nl;
  };
  // the other triangle of face f along the edge (p, q), if there is exactly one besides `not`
  const acrossOf = (p, q, f, not) => { let found = -1; for (const t of around[p]) { if (t === not || !alive[t] || fOf[t] !== f) continue; const c = corners(t); if (c.includes(q)) { if (found >= 0) return -2; found = t; } } return found; };

  // what a collapse of place a onto place b would cost, or -1 when it is not allowed
  const tryCollapse = (a, b) => {
    for (const f of facesAt[a]) if (!facesAt[b].has(f)) return -1;        // (b must lie on every face a lies on)
    let worst = 0;
    const fresh = [];                                                     // the triangles round a as they would be: [face, places, normal]
    for (const t of around[a]) {
      if (!alive[t]) continue;
      const c = corners(t);
      if (c.includes(b)) continue;                                        // (vanishes)
      const nc = c.map(x => x === a ? b : x);
      const n0 = normalOf(c[0], c[1], c[2]), n1 = normalOf(nc[0], nc[1], nc[2]);
      const l0 = Math.hypot(...n0), l1 = Math.hypot(...n1);
      if (!(l1 > l0 * 1e-4)) return -1;                                   // (flattened to nothing)
      if (dot(n0, n1) <= 0) return -1;                                    // (turned over)
      const d = distToTri(a, nc[0], nc[1], nc[2]);
      if (d < worst) {} else worst = Math.max(worst, 0);                  // (placeholder: the sag is the least distance below)
      fresh.push({ f: fOf[t], c: nc, n: [n1[0] / l1, n1[1] / l1, n1[2] / l1], t });
    }
    if (!fresh.length) return -1;
    // the sag: how far a is from the surface that replaces it
    let sag = Infinity;
    for (const x of fresh) { const d = distToTri(a, x.c[0], x.c[1], x.c[2]); if (d < sag) sag = d; }
    if (!(sag <= tol)) return -1;
    // the facets per turn: a point on an edge between faces goes along that edge, and the turn the edge makes at b afterwards (between
    // the chord from a's other neighbour and the chord on to b's next) may not pass 360° / segments; a point inside a face is judged
    // by the dihedral of the new triangles against their neighbours in the face
    const rim = outlineOf(a);
    if (rim.length > 2) return -1;                                        // (a corner: three or more faces meet)
    if (rim.length === 2) {
      if (!rim.includes(b)) return -1;
      const prev = rim[0] === b ? rim[1] : rim[0];
      const rimB = outlineOf(b), nextB = rimB.find(x => x !== a);
      if (nextB !== undefined) {
        const ux = px(b) - px(prev), uy = py(b) - py(prev), uz = pz(b) - pz(prev), vx = px(nextB) - px(b), vy = py(nextB) - py(b), vz = pz(nextB) - pz(b);
        const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
        if (lu > 0 && lv > 0 && (ux * vx + uy * vy + uz * vz) / (lu * lv) < cosCap) return -1;
      }
    } else if (rim.length === 0) {
      for (const x of fresh) {
        if (!isRound(x.f)) continue;
        for (let k = 0; k < 3; k++) {
          const p = x.c[k], q = x.c[(k + 1) % 3];
          let nb = null;
          for (const y of fresh) if (y !== x && y.c.includes(p) && y.c.includes(q)) { nb = y.n; break; }
          if (!nb) { const t2 = acrossOf(p, q, x.f, x.t); if (t2 >= 0 && !corners(t2).includes(a)) { const c2 = corners(t2), n2 = normalOf(c2[0], c2[1], c2[2]), l2 = Math.hypot(...n2) || 1; nb = [n2[0] / l2, n2[1] / l2, n2[2] / l2]; } }
          if (nb && dot(x.n, nb) < cosCap) return -1;
        }
      }
    } else return -1;                                                     // (one outline edge only: the end of an open rim)
    return sag;
  };
  // the places next to `a` along an outline: an edge (a, p) with triangles of two different faces on it, or with only one triangle
  function outlineOf(a) {
    const facesOn = new Map();                                            // neighbour place → Set(face)
    for (const t of around[a]) { if (!alive[t]) continue; const c = corners(t); for (const p of c) { if (p === a) continue; let s = facesOn.get(p); if (!s) facesOn.set(p, s = new Set()); s.add(fOf[t]); } }
    const out = [];
    for (const [p, s] of facesOn) { if (s.size > 1) { out.push(p); continue; } let n = 0; for (const t of around[a]) if (alive[t] && corners(t).includes(p)) n++; if (n === 1) out.push(p); }
    return out;
  }
  const doCollapse = (a, b) => {
    for (const t of [...around[a]]) {
      if (!alive[t]) { around[a].delete(t); continue; }
      const c = corners(t);
      if (c.includes(b)) { alive[t] = 0; for (const x of c) around[x].delete(t); continue; }
      for (let k = 0; k < 3; k++) if (place[tri[t * 3 + k]] === a) { const v = vertAt.get(fOf[t] * nP + b); tri[t * 3 + k] = v; }
      around[a].delete(t); around[b].add(t);
    }
  };

  // the points to try, cheapest collapse first, pass after pass
  const candidate = new Uint8Array(nP);
  for (let t = 0; t < T0; t++) if (isRound(fOf[t])) for (let k = 0; k < 3; k++) candidate[place[tri[t * 3 + k]]] = 1;
  if (opts.locked && opts.locked.size) for (let c = 0; c < nP; c++) if (candidate[c] && opts.locked.has(keyAt(px(c), py(c), pz(c)))) candidate[c] = 0;      // (rebuilt by pipegrid.js: left as it is)
  let collapsed = 0, dirty = []; for (let c = 0; c < nP; c++) if (candidate[c]) dirty.push(c);
  const neighboursOf = (a) => { const s = new Set(); for (const t of around[a]) if (alive[t]) for (const x of corners(t)) if (x !== a) s.add(x); return s; };
  for (let pass = 0; pass < 64 && dirty.length; pass++) {
    const scored = [];
    for (const a of dirty) {
      if (!around[a].size) continue;
      let best = -1, bestCost = Infinity;
      for (const b of neighboursOf(a)) { const cost = tryCollapse(a, b); if (cost >= 0 && cost < bestCost) { bestCost = cost; best = b; } }
      if (best >= 0) scored.push({ a, b: best, cost: bestCost });
    }
    if (!scored.length) break;
    scored.sort((p, q) => p.cost - q.cost);
    const touched = new Set(), next = new Set();
    for (const { a, b } of scored) {
      if (touched.has(a) || touched.has(b)) { next.add(a); continue; }     // (one move per neighbourhood per pass; judged afresh next time)
      if (tryCollapse(a, b) < 0) { next.add(a); continue; }
      doCollapse(a, b); collapsed++;
      touched.add(a); touched.add(b);
      for (const x of neighboursOf(b)) { touched.add(x); if (candidate[x]) next.add(x); }
      if (candidate[b]) next.add(b);
    }
    dirty = [...next];
  }
  if (!collapsed) return { ok: true, positions, index, cad, collapsed: 0, before: T0, after: T0, why: 'nothing to take away within the deviation' };

  // the triangles that are left, grouped by face, so the record's ranges hold
  const keep = []; for (let t = 0; t < T0; t++) if (alive[t]) keep.push(t);
  keep.sort((p, q) => (fOf[p] - fOf[q]) || (p - q));
  const newIndex = new Uint32Array(keep.length * 3);
  keep.forEach((t, i) => { newIndex[i * 3] = tri[t * 3]; newIndex[i * 3 + 1] = tri[t * 3 + 1]; newIndex[i * 3 + 2] = tri[t * 3 + 2]; });
  const area = (i) => { const a = newIndex[i * 3] * 3, b = newIndex[i * 3 + 1] * 3, c = newIndex[i * 3 + 2] * 3; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]; return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; };
  const newFaces = faces.map((f) => [f[0], 0, 0, 0, ...f.slice(4)]);
  keep.forEach((t, i) => { const f = fOf[t]; if (f >= nF) return; const nf = newFaces[f]; if (!nf[2]) nf[1] = i; nf[2]++; nf[3] += area(i); });
  for (const nf of newFaces) nf[3] = +nf[3].toFixed(6);
  // the edge polylines without the points that went (the ends of an edge always stay)
  const used = new Uint8Array(nP);
  for (let i = 0; i < newIndex.length; i++) used[place[newIndex[i]]] = 1;
  const pts = cad.pts || new Float32Array(0), rows = cad.rows || [];
  const keptPts = [], newRows = [];
  for (const r of rows) {
    const first = keptPts.length / 3; let m = 0;
    const at = (k) => { const o = (r[0] + k) * 3; return [pts[o], pts[o + 1], pts[o + 2]]; };
    const closed = r[1] > 2 && keyAt(...at(0)) === keyAt(...at(r[1] - 1));           // (a ring: its last point is its first again)
    const last = closed ? r[1] - 1 : r[1];
    for (let k = 0; k < last; k++) {
      const [x, y, z] = at(k), c = table.get(keyAt(x, y, z));
      if (c !== undefined && !used[c] && (closed || (k !== 0 && k !== r[1] - 1))) continue;
      keptPts.push(x, y, z); m++;
    }
    if (closed && m >= 3) { keptPts.push(keptPts[first * 3], keptPts[first * 3 + 1], keptPts[first * 3 + 2]); m++; }
    if (m >= 2) newRows.push([first, m, r[2], r[3], r[4]]); else keptPts.length = first * 3;
  }
  return { ok: true, positions, index: newIndex, cad: { faces: newFaces, rows: newRows, pts: Float32Array.from(keptPts) },
           collapsed, before: T0, after: keep.length, tolerance: tol, segments };
}
