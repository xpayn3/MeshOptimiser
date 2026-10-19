// defeature.js — take the fillets and chamfers off a part that still knows its CAD faces, and make its edges sharp again.
//
// A fillet is a narrow rounded face (a cylinder, a torus, a sphere at a corner) that meets its two neighbours tangent; a chamfer is
// a narrow flat face between two neighbours it meets at an angle. Both are "blends": what the designer put between two faces to
// soften the edge where they would meet. Taken off, the two neighbours are extended until they meet, and the sharp edge is back.
// A mesh-only tool cannot tell a fillet from a small cylinder with any confidence; here the CAD faces say what each face is (its
// kind and radii) and the CAD edges say which faces meet tangent, so the question is settled before anything moves.
//
// What happens, per group of blends (blends that meet each other tangent go together: the three fillets of a box corner and the
// patch between them are one group, and so is a fillet that runs along an edge made of several faces):
//   1. Every edge blend runs between two faces, its supports; a corner patch runs between blends only. Each support is fitted as
//      the surface the CAD says it is: a plane from its triangles, a cylinder from their normals (the axis) and its radius. Only
//      planes and cylinders are supports here; a blend on a cone, a sphere, a torus or a free-form face is left alone (and counted).
//   2. The group's triangles are taken out. Every point of the rim that is left is moved to where the supports it sits between
//      meet: a point on the rim of one blend goes to the curve of its two supports (the line of two planes, or the point found by
//      projecting back and forth between a plane and a cylinder); a point where blends meet at a corner goes to the point where
//      three supports meet.
//   3. For each pair of supports the two rims lie on one curve now but have different points; each gets the other's points cut
//      into its edges, so the rims match point for point and the surface is closed again without a sliver between them. A
//      triangle that gets points on two of its edges (the corner of a face) is fanned from its middle. The small end arcs of a
//      blend (where it ran out against a face that is not one of its supports) fold onto the ends of the rims.
//   4. Degenerate triangles that this leaves (the folded end arcs) are dropped.
// The triangles that the splits make are part of the mesh from then on: the next group reads them like any other, so two groups
// that share a face (a fillet at each end of the same wall) do not tear it between them.
// A group whose rims do not come out as one run per support for each pair, whose supports cannot be fitted, whose rim would have
// to move further than a few times the blends' own size, or where four or more supports meet at one point, is left as it is and
// counted under `skipped`.
//
//   positions, index   the mesh (Float32Array xyz; a triangle index)
//   opts.cad           { faces: [[kind, firstTri, triCount, area, ...radii]...], rows: [[firstPt, ptCount, tangent, faceA, faceB]...],
//                        pts: Float32Array (edge points, xyz) }  — what step2glb.py --brep writes, as the app keeps it (_Brep)
//   opts.maxRadius     the largest fillet radius to take off, in the mesh's units (0: no fillets)
//   opts.maxChamfer    the widest chamfer to take off, in the mesh's units (0: no chamfers)
//   opts.debug         also return groupLog, one entry per group; opts.onlyGroups (a Set of cluster numbers) does only those, and
//                      opts.maxDone stops after so many groups were taken off (both for finding a fault, not for the app)
// Returns { ok, positions, index, fillets, chamfers, faces (blend faces taken out), skipped: { ... }, before, after } or { ok: false, why }.
//
// Pure function, no dependencies: the worker and the page call it the same way; the tests call it from Node.

const KIND = { plane: 0, cylinder: 1, cone: 2, sphere: 3, torus: 4 };

export function removeBlends(positions, index, opts = {}) {
  const cad = opts.cad;
  if (!cad || !cad.faces || !cad.faces.length || !cad.rows || !cad.pts) return { ok: false, why: 'the part has no CAD faces (open the STEP with them)' };
  const T0 = (index.length / 3) | 0;
  const maxR = +opts.maxRadius > 0 ? +opts.maxRadius : 0, maxC = +opts.maxChamfer > 0 ? +opts.maxChamfer : 0;
  if (!maxR && !maxC) return { ok: false, why: 'nothing to take off: both limits are 0' };
  const faces = cad.faces, nF = faces.length, rows = cad.rows, pts = cad.pts;
  const result = { ok: true, fillets: 0, chamfers: 0, faces: 0, before: T0, after: T0, maxRadius: maxR, maxChamfer: maxC,
                   skipped: { supports: 0, fit: 0, topology: 0, moved: 0, corner: 0, touches: 0 } };
  const unchanged = (why) => ({ ...result, positions: Float32Array.from(positions), index: index.slice ? index.slice() : Uint32Array.from(index), why });

  // ── the live mesh: positions (double), triangles, the face of each, canonical vertices; all of them grow with the splits ───────
  const P = Array.from(positions);                        // xyz per vertex
  const tri = Array.from(index);                          // 3 vertex numbers per triangle
  const fOf = new Array(T0).fill(-1);                     // triangle → CAD face (-1: none; new triangles take their parent's)
  for (let f = 0; f < nF; f++) { const [, s, c] = faces[f]; for (let t = s; t < s + c && t < T0; t++) fOf[t] = f; }
  const rem = new Array(T0).fill(0);                      // 1 = taken out
  let nT = T0, nV = (P.length / 3) | 0;
  const iv = (t, k) => tri[t * 3 + k];
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (!(diag > 0)) return { ok: false, why: 'the part has no size' };
  const weldEps = diag * 1e-6, inv = 1 / weldEps;
  const canon = [], members = [], table = new Map();     // vertex → canonical id; canonical id → [vertex...]; position key → canonical id
  const keyAt = (x, y, z) => Math.round((x - x0) * inv) + ',' + Math.round((y - y0) * inv) + ',' + Math.round((z - z0) * inv);
  const enrol = (v) => { const key = keyAt(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); let c = table.get(key); if (c === undefined) { c = members.length; table.set(key, c); members.push([]); } canon[v] = c; members[c].push(v); return c; };
  for (let v = 0; v < nV; v++) enrol(v);
  const pos = (c) => { const v = members[c][0]; return [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; };
  const setPos = (c, q) => { for (const v of members[c]) { P[v * 3] = q[0]; P[v * 3 + 1] = q[1]; P[v * 3 + 2] = q[2]; } };
  const addVertex = (q) => { const v = nV++; P.push(q[0], q[1], q[2]); enrol(v); return v; };
  const ekey = (a, b) => a < b ? a + ',' + b : b + ',' + a;
  const edgeTris = new Map();                             // canonical edge → [triangle...] (live)
  const noteTri = (t) => { for (let k = 0; k < 3; k++) { const a = canon[iv(t, k)], b = canon[iv(t, (k + 1) % 3)]; if (a === b) continue; const key = ekey(a, b); let l = edgeTris.get(key); if (!l) edgeTris.set(key, l = []); l.push(t); } };
  for (let t = 0; t < nT; t++) noteTri(t);
  const addTri = (a, b, c, face) => { const t = nT++; tri.push(a, b, c); fOf.push(face); rem.push(0); noteTri(t); return t; };

  // ── triangle normals and areas of the original mesh (for the fits and the face normals) ─────────────────────────────────────
  const tn = new Float64Array(T0 * 3), ta = new Float64Array(T0);
  for (let t = 0; t < T0; t++) {
    const a = iv(t, 0) * 3, b = iv(t, 1) * 3, c = iv(t, 2) * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    ta[t] = l / 2;
    if (l > 0) { tn[t * 3] = nx / l; tn[t * 3 + 1] = ny / l; tn[t * 3 + 2] = nz / l; }
  }

  // ── the CAD edges per face: which other face, tangent or not, how long ───────────────────────────────────────────────────────
  const edgesOf = Array.from({ length: nF }, () => []);
  const rowLen = (r) => { let L = 0; const s = r[0] * 3; for (let k = 0; k < r[1] - 1; k++) { const a = s + k * 3; L += Math.hypot(pts[a + 3] - pts[a], pts[a + 4] - pts[a + 1], pts[a + 5] - pts[a + 2]); } return L; };
  rows.forEach((r, ri) => {
    const fa = r[3], fb = r[4];
    if (fa < 0 || fb < 0 || fa === fb || fa >= nF || fb >= nF) return;
    const len = rowLen(r);
    edgesOf[fa].push({ other: fb, tangent: !!r[2], len, row: ri });
    edgesOf[fb].push({ other: fa, tangent: !!r[2], len, row: ri });
  });

  // ── which faces are blends ───────────────────────────────────────────────────────────────────────────────────────────────────
  // a fillet: a cylinder, torus or sphere of small radius that meets at least two different faces tangent
  // a chamfer: a plane strip, narrow against its two long edges, whose two long neighbours meet at a real angle
  const blendKind = new Int8Array(nF);                    // 0 none, 1 fillet, 2 chamfer
  const blendWidth = new Float64Array(nF);
  const faceNormal = (f) => { let nx = 0, ny = 0, nz = 0; const [, s, c] = faces[f]; for (let t = s; t < s + c && t < T0; t++) { nx += tn[t * 3] * ta[t]; ny += tn[t * 3 + 1] * ta[t]; nz += tn[t * 3 + 2] * ta[t]; } const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };
  for (let f = 0; f < nF; f++) {
    const [kind, , cnt, area, ...nums] = faces[f];
    if (!cnt) continue;
    const E = edgesOf[f];
    if (maxR && (kind === KIND.cylinder || kind === KIND.torus || kind === KIND.sphere)) {
      const r = kind === KIND.torus ? nums[1] : nums[0];
      if (!(r > 0) || r > maxR) continue;
      const tangentTo = new Set(E.filter(e => e.tangent).map(e => e.other));
      if (tangentTo.size < 2) continue;
      blendKind[f] = 1; blendWidth[f] = r; continue;
    }
    if (maxC && kind === KIND.plane && E.length >= 2) {
      const sorted = E.slice().sort((a, b) => b.len - a.len);
      const e1 = sorted[0], e2 = sorted.find(e => e.other !== e1.other);
      if (!e2 || e1.tangent || e2.tangent) continue;
      const w = area / ((e1.len + e2.len) / 2);
      if (!(w > 0) || w > maxC || e2.len < 2 * w) continue;
      const na = faceNormal(e1.other), nb = faceNormal(e2.other), n = faceNormal(f);
      const cosAB = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
      if (cosAB < -0.5) continue;                                        // (the two sides of a thin rib: not a chamfer)
      const bis = [na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]], bl = Math.hypot(...bis) || 1;
      if ((n[0] * bis[0] + n[1] * bis[1] + n[2] * bis[2]) / bl < 0.7) continue;
      blendKind[f] = 2; blendWidth[f] = w;
    }
  }
  if (!blendKind.some(k => k)) return unchanged('no fillet or chamfer found');

  // ── chains and clusters ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // A chain: blends that meet each other tangent (or share a long edge): a fillet that runs along an edge made of several faces,
  // the three fillets of a corner and the patch between them. A cluster: chains that touch at a point (two fillets that meet at a
  // sharp corner of a face): the point they share must go to the one place where all their supports meet, which only a joint
  // group can work out. A cluster is taken off whole when it can be; otherwise chain by chain, and a chain that would move a
  // point an earlier chain already settled is left alone (it would tear what that chain closed).
  const parent = Int32Array.from({ length: nF }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let f = 0; f < nF; f++) if (blendKind[f]) for (const e of edgesOf[f]) if (blendKind[e.other] && (e.tangent || blendKind[f] === 2)) unite(f, e.other);
  const chains = new Map();
  for (let f = 0; f < nF; f++) if (blendKind[f]) { const g = find(f); if (!chains.has(g)) chains.set(g, []); chains.get(g).push(f); }
  const cparent = new Map([...chains.keys()].map(k => [k, k]));
  const cfind = (a) => { while (cparent.get(a) !== a) { cparent.set(a, cparent.get(cparent.get(a))); a = cparent.get(a); } return a; };
  {
    const at = new Map();                                 // canonical vertex → the chain first seen there
    for (let f = 0; f < nF; f++) {
      if (!blendKind[f]) continue;
      const g = find(f), [, s, c] = faces[f];
      for (let t = s; t < s + c && t < T0; t++) for (let k = 0; k < 3; k++) { const v = canon[iv(t, k)], h = at.get(v); if (h === undefined) at.set(v, g); else if (h !== g) { const a = cfind(g), b = cfind(h); if (a !== b) cparent.set(a, b); } }
    }
  }
  const clusters = new Map();                             // cluster root → [chain root...]
  for (const k of chains.keys()) { const r = cfind(k); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(k); }

  // ── support surfaces (fitted from the original triangles of the face) ────────────────────────────────────────────────────────
  const fitCache = new Map();
  function fitSupport(f) {
    if (fitCache.has(f)) return fitCache.get(f);
    const [kind, s, c, , ...nums] = faces[f];
    let out = null;
    if (kind === KIND.plane) {
      const n = faceNormal(f); let cx = 0, cy = 0, cz = 0, w = 0;
      for (let t = s; t < s + c && t < T0; t++) { const a = iv(t, 0), b = iv(t, 1), d = iv(t, 2); const k = ta[t]; cx += k * (P[a * 3] + P[b * 3] + P[d * 3]) / 3; cy += k * (P[a * 3 + 1] + P[b * 3 + 1] + P[d * 3 + 1]) / 3; cz += k * (P[a * 3 + 2] + P[b * 3 + 2] + P[d * 3 + 2]) / 3; w += k; }
      if (w > 0) { cx /= w; cy /= w; cz /= w; }
      out = { kind: 'plane', n, d: n[0] * cx + n[1] * cy + n[2] * cz, project: (q) => { const e = n[0] * q[0] + n[1] * q[1] + n[2] * q[2] - out.d; return [q[0] - n[0] * e, q[1] - n[1] * e, q[2] - n[2] * e]; } };
    } else if (kind === KIND.cylinder && nums[0] > 0) {
      const r = nums[0];
      const M = [0, 0, 0, 0, 0, 0]; let W = 0;
      for (let t = s; t < s + c && t < T0; t++) { const k = ta[t], nx = tn[t * 3], ny = tn[t * 3 + 1], nz = tn[t * 3 + 2]; M[0] += k * nx * nx; M[1] += k * nx * ny; M[2] += k * nx * nz; M[3] += k * ny * ny; M[4] += k * ny * nz; M[5] += k * nz * nz; W += k; }
      if (!(W > 0)) { fitCache.set(f, null); return null; }
      const axis = smallestEigenvector(M);
      if (!axis) { fitCache.set(f, null); return null; }
      const [u, v] = frameOf(axis);
      let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, S1 = 0, Sxb = 0, Syb = 0, Sb = 0;
      const seen = new Set();
      for (let t = s; t < s + c && t < T0; t++) for (let k = 0; k < 3; k++) {
        const vv = canon[iv(t, k)]; if (seen.has(vv)) continue; seen.add(vv);
        const q = pos(vv), x = q[0] * u[0] + q[1] * u[1] + q[2] * u[2], y = q[0] * v[0] + q[1] * v[1] + q[2] * v[2], b = x * x + y * y - r * r;
        Sxx += 4 * x * x; Sxy += 4 * x * y; Syy += 4 * y * y; Sx += 2 * x; Sy += 2 * y; S1 += 1; Sxb += 2 * x * b; Syb += 2 * y * b; Sb += b;
      }
      const sol = solve3([[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, S1]], [Sxb, Syb, Sb]);
      if (!sol) { fitCache.set(f, null); return null; }
      const [cx, cy] = sol;
      const o = [u[0] * cx + v[0] * cy, u[1] * cx + v[1] * cy, u[2] * cx + v[2] * cy];
      let worst = 0;
      for (const vv of seen) { const q = pos(vv); const d = Math.abs(radial(q, o, axis) - r); if (d > worst) worst = d; }
      if (worst > Math.max(r * 0.05, diag * 1e-4)) { fitCache.set(f, null); return null; }
      out = { kind: 'cylinder', axis, o, r, project: (q) => { const dx = q[0] - o[0], dy = q[1] - o[1], dz = q[2] - o[2]; const h = dx * axis[0] + dy * axis[1] + dz * axis[2]; let rx = dx - h * axis[0], ry = dy - h * axis[1], rz = dz - h * axis[2]; const l = Math.hypot(rx, ry, rz); if (l < 1e-12) { rx = u[0]; ry = u[1]; rz = u[2]; } else { rx /= l; ry /= l; rz /= l; } return [o[0] + h * axis[0] + rx * r, o[1] + h * axis[1] + ry * r, o[2] + h * axis[2] + rz * r]; } };
    }
    fitCache.set(f, out);
    return out;
  }
  // the point nearest to q where two supports meet, or where three meet; null when they do not
  function meet(S, q) {
    if (S.every(s => s.kind === 'plane')) {
      if (S.length === 3) return solve3(S.map(s => s.n), S.map(s => s.d));
      const [A, B] = S, d = cross(A.n, B.n), dl = Math.hypot(...d);
      if (dl < 1e-6) return null;                                          // parallel: they never meet
      return solve3([A.n, B.n, d], [A.d, B.d, d[0] * q[0] + d[1] * q[1] + d[2] * q[2]]);
    }
    let x = q.slice();
    for (let it = 0; it < 600; it++) {
      let y = x; for (const s of S) y = s.project(y);
      const m = Math.hypot(y[0] - x[0], y[1] - x[1], y[2] - x[2]);
      x = y;
      if (m < diag * 1e-9) break;
    }
    for (const s of S) { const p = s.project(x); if (Math.hypot(p[0] - x[0], p[1] - x[1], p[2] - x[2]) > diag * 1e-6) return null; }
    return x;
  }

  // ── take each group off ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const groupLog = opts.debug ? [] : null;
  const settled = new Set();                              // canonical vertices an earlier group has moved
  let gi = -1;
  // One attempt on a list of blend faces. Returns true when they came off. `count` says whether a failure goes into the skipped
  // tally (a cluster tried whole is not counted: its chains get their own turn).
  let doneCount = 0;
  function attempt(list, count, cluster = list) {
    if (opts.maxDone !== undefined && doneCount >= opts.maxDone) return false;     // (debug: stop after so many groups taken off)
    const log = (what) => { if (groupLog) groupLog.push({ group: gi, faces: list.slice(), kinds: list.map(f => faces[f][0]), widths: list.map(f => +blendWidth[f].toFixed(3)), ...what }); };
    const skip = (reason, extra) => { if (count) result.skipped[reason] += list.length; log({ skip: reason, ...extra }); return false; };
    const inGroup = new Uint8Array(nF); for (const f of list) inGroup[f] = 1;
    const isFillet = list.some(f => blendKind[f] === 1);
    // the supports of each blend: the two faces it runs between (none for a patch that lies between blends only)
    const pairOf = new Map(), supports = new Set(); let tooMany = false;
    for (const f of list) {
      let s;
      if (blendKind[f] === 1) s = [...new Set(edgesOf[f].filter(e => e.tangent && !inGroup[e.other]).map(e => e.other))];
      else { s = []; for (const e of edgesOf[f].filter(e => !inGroup[e.other]).sort((a, b) => b.len - a.len)) { if (!s.includes(e.other)) s.push(e.other); if (s.length === 2) break; } }
      if (s.length === 2) { pairOf.set(f, s); supports.add(s[0]); supports.add(s[1]); }
      else if (s.length > 2) { tooMany = true; break; }
      else pairOf.set(f, null);
    }
    if (tooMany || supports.size < 2) return skip('supports', { supports: [...supports] });
    const fit = new Map();
    for (const f of supports) { const s = fitSupport(f); if (!s) return skip('fit', { supports: [...supports].map(f => faces[f][0]) }); fit.set(f, s); }
    const pairKey = (f) => { const p = pairOf.get(f); return p ? (p[0] < p[1] ? p[0] + '/' + p[1] : p[1] + '/' + p[0]) : null; };
    const inCluster = new Uint8Array(nF); for (const f of cluster) inCluster[f] = 1;
    const clusterPair = new Map();                       // blend face of the cluster → its two supports, or null
    for (const f of cluster) {
      if (inGroup[f]) { clusterPair.set(f, pairOf.get(f)); continue; }
      let s;
      if (blendKind[f] === 1) s = [...new Set(edgesOf[f].filter(e => e.tangent && !inCluster[e.other]).map(e => e.other))];
      else { s = []; for (const e of edgesOf[f].filter(e => !inCluster[e.other]).sort((a, b) => b.len - a.len)) { if (!s.includes(e.other)) s.push(e.other); if (s.length === 2) break; } }
      clusterPair.set(f, s.length === 2 ? s : null);
    }
    // the group's triangles (blend faces are never split, so they are original triangles) and the blend faces at every vertex
    const gTris = [];
    for (const f of list) { const [, s, c] = faces[f]; for (let t = s; t < s + c && t < T0; t++) if (!rem[t]) gTris.push(t); }
    const inG = new Set(gTris);
    const blendsAt = new Map();                           // canonical → Set(blend face), over the whole cluster
    for (const f of cluster) { const [, s, c] = faces[f]; for (let t = s; t < s + c && t < T0; t++) for (let k = 0; k < 3; k++) { const v = canon[iv(t, k)]; let b = blendsAt.get(v); if (!b) blendsAt.set(v, b = new Set()); b.add(f); } }
    // the rim: boundary edges of the group, directed as its triangles go round, each with the blend it belongs to and the kept face across
    const edgeCount = new Map();
    for (const t of gTris) for (let k = 0; k < 3; k++) { const a = canon[iv(t, k)], b = canon[iv(t, (k + 1) % 3)]; if (a === b) continue; const key = ekey(a, b); edgeCount.set(key, (edgeCount.get(key) || 0) + 1); }
    const dir = new Map(); let pinched = false;           // canonical a → { b, blend, side }
    for (const t of gTris) for (let k = 0; k < 3; k++) {
      const a = canon[iv(t, k)], b = canon[iv(t, (k + 1) % 3)];
      if (a === b || edgeCount.get(ekey(a, b)) !== 1) continue;
      const across = (edgeTris.get(ekey(a, b)) || []).find(u => u !== t && !inG.has(u) && !rem[u]);
      if (dir.has(a)) pinched = true;
      dir.set(a, { b, blend: fOf[t], side: across === undefined ? -1 : fOf[across] });
    }
    if (pinched || !dir.size) return skip('topology', { pinched });
    // the loops
    const loops = []; const used = new Set();
    for (const start of dir.keys()) {
      if (used.has(start)) continue;
      const loop = []; let c = start, guard = 0;
      while (c !== undefined && !used.has(c) && guard++ <= dir.size) { used.add(c); loop.push(c); c = dir.get(c)?.b; }
      if (c === start && loop.length >= 3) loops.push(loop); else return skip('topology', { broken: true });
    }
    // where every rim vertex goes: to where the supports of the blends it lies on meet (two: their curve; three: the corner point)
    const target = new Map();
    const budget = Math.max(...list.map(f => blendWidth[f])) * 4 + diag * 1e-4;
    for (const c of dir.keys()) {
      const sup = new Set();
      for (const f of blendsAt.get(c) || []) { const p = clusterPair.get(f); if (p) { sup.add(p[0]); sup.add(p[1]); } }
      if (sup.size < 2) return skip('topology', { lonely: c });
      if (sup.size > 3) return skip('corner');
      const S = []; for (const f of sup) { const s = fit.get(f) || fitSupport(f); if (!s) return skip('fit', { at: c }); S.push(s); }
      const q = pos(c), m = meet(S, q);
      if (!m) return skip('moved', { noMeet: c });
      if (settled.has(c)) { if (Math.hypot(m[0] - q[0], m[1] - q[1], m[2] - q[2]) > diag * 1e-7) return skip('touches'); target.set(c, q); continue; }
      if (Math.hypot(m[0] - q[0], m[1] - q[1], m[2] - q[2]) > budget) return skip('moved', { far: c });
      target.set(c, m);
    }
    // runs: consecutive rim edges of one blend pair on one side; the ends of a blend against another face are its end runs
    const runs = new Map();                               // key → [{ verts, closed }]
    const keyOfEdge = (e) => { const pk = pairKey(e.blend); if (!pk) return null; const p = pairOf.get(e.blend); return p.includes(e.side) ? 'P' + pk + '|' + e.side : 'E' + pk; };
    for (const loop of loops) {
      const n = loop.length, keys = loop.map(c => keyOfEdge(dir.get(c)));       // the key of the edge leaving each vertex
      if (keys.some(k => k === null)) return skip('topology', { odd: 'edge without a pair' });
      if (keys.every(k => k === keys[0])) { push(runs, keys[0], { verts: loop.slice(), closed: true }); continue; }
      let s0 = 0; while (keys[s0] === keys[(s0 + n - 1) % n]) s0++;
      let i = s0, done = 0;
      while (done < n) {
        const k = keys[i], verts = [loop[i]];
        while (done < n && keys[i] === k) { i = (i + 1) % n; done++; verts.push(loop[i]); }
        push(runs, k, { verts, closed: false });
      }
    }
    const pairs = new Set(); for (const f of list) { const pk = pairKey(f); if (pk) pairs.add(pk); }
    const plan = [];                                      // per pair: its two rims and its end runs
    for (const pk of pairs) {
      const [fa, fb] = pk.split('/').map(Number);
      const ra = runs.get('P' + pk + '|' + fa) || [], rb = runs.get('P' + pk + '|' + fb) || [];
      if (ra.length !== 1 || rb.length !== 1 || ra[0].closed !== rb[0].closed) return skip('topology', { odd: 'runs per pair', runs: [...runs.entries()].map(([k, l]) => k + ':' + l.map(r => r.verts.length + (r.closed ? 'c' : '')).join('+')) });
      plan.push({ fa, fb, RA: ra[0], RB: rb[0], ends: runs.get('E' + pk) || [] });
    }
    // the end arcs fold onto the nearer end of the A run; the B run's ends go with them
    // (a point an earlier chain settled stays where it is: the other end folds onto it, and two settled points that would have to
    // be one leave the chain alone)
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    for (const { RA, RB, ends } of plan) {
      if (RA.closed) continue;
      const aEnds = [RA.verts[0], RA.verts[RA.verts.length - 1]];
      for (const b of [RB.verts[0], RB.verts[RB.verts.length - 1]]) {
        const a = dist(target.get(b), target.get(aEnds[0])) <= dist(target.get(b), target.get(aEnds[1])) ? aEnds[0] : aEnds[1];
        const ta = target.get(a), tb = target.get(b);
        if (dist(ta, tb) < diag * 1e-7) continue;
        if (settled.has(a) && settled.has(b)) return skip('touches', { ends: [a, b] });
        if (settled.has(b)) target.set(a, tb); else target.set(b, ta);
      }
      const anchors = aEnds.map(c => target.get(c));
      for (const run of ends) for (const c of run.verts) {
        const x = target.get(c), p = dist(x, anchors[0]) <= dist(x, anchors[1]) ? anchors[0] : anchors[1];
        if (settled.has(c)) { if (dist(x, p) > diag * 1e-7) return skip('touches', { end: c }); continue; }
        target.set(c, p);
      }
    }
    // take the group out
    for (const t of gTris) rem[t] = 1;
    doneCount++;
    result.faces += list.length;
    if (isFillet) result.fillets++; else result.chamfers++;
    // the rims point for point: each takes the other's points, cut into the edge they fall on (a guest point that lands on one of
    // the host's own points is snapped to it exactly instead); the moves are applied once the plan is made
    const triOfEdge = new Map();                          // "a,b" (canonical, either way) → the live triangle of a support that has it
    for (let t = 0; t < nT; t++) { if (rem[t] || !supports.has(fOf[t])) continue; for (let k = 0; k < 3; k++) triOfEdge.set(canon[iv(t, k)] + ',' + canon[iv(t, (k + 1) % 3)], t); }
    const splitPlan = new Map();                          // triangle → [{ a, b, inserts: [position...] }]
    const dbg = { inserted: 0, noTri: 0, splits: 0, multi: 0, notCorner: 0 };
    const insertInto = (host, guest) => {
      const hv = host.verts, nH = hv.length, hp = hv.map(c => target.get(c));
      const segs = host.closed ? nH : nH - 1, tol = diag * 1e-7;
      const byEdge = new Map();
      for (const g of guest.verts) {
        const q = target.get(g);
        let best = -1, bestD = Infinity, bestS = 0;
        for (let i = 0; i < segs; i++) {
          const p0 = hp[i], p1 = hp[(i + 1) % nH];
          const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], l2 = dx * dx + dy * dy + dz * dz;
          let s = l2 > 0 ? ((q[0] - p0[0]) * dx + (q[1] - p0[1]) * dy + (q[2] - p0[2]) * dz) / l2 : 0; s = Math.max(0, Math.min(1, s));
          const d = Math.hypot(q[0] - (p0[0] + dx * s), q[1] - (p0[1] + dy * s), q[2] - (p0[2] + dz * s));
          if (d < bestD) { bestD = d; best = i; bestS = s; }
        }
        if (best < 0) continue;
        const p0 = hp[best], p1 = hp[(best + 1) % nH];
        if (Math.hypot(q[0] - p0[0], q[1] - p0[1], q[2] - p0[2]) < tol) { target.set(g, p0); continue; }
        if (Math.hypot(q[0] - p1[0], q[1] - p1[1], q[2] - p1[2]) < tol) { target.set(g, p1); continue; }
        if (bestS <= 0 || bestS >= 1) continue;
        let l = byEdge.get(best); if (!l) byEdge.set(best, l = []); l.push({ s: bestS, p: q });
      }
      for (const [i, l] of byEdge) {
        l.sort((a, b) => a.s - b.s);
        const a = hv[i], b = hv[(i + 1) % nH];
        const t = triOfEdge.get(a + ',' + b) ?? triOfEdge.get(b + ',' + a);
        if (t === undefined) { dbg.noTri += l.length; continue; }
        dbg.inserted += l.length;
        let edges = splitPlan.get(t); if (!edges) splitPlan.set(t, edges = []);
        edges.push({ a, b, inserts: l.map(x => x.p) });
      }
    };
    for (const { RA, RB } of plan) { insertInto(RA, RB); insertInto(RB, RA); }
    for (const [c, m] of target) { setPos(c, m); settled.add(c); }     // (now: the splits below read the moved corners, and new vertices weld to moved ones)
    for (const [t, edges] of splitPlan) {
      const corners = [iv(t, 0), iv(t, 1), iv(t, 2)];
      const onEdge = [[], [], []];                        // the points to cut into each of the triangle's three edges, in the edge's own order
      let fine = true;
      for (const { a, b, inserts } of edges) {
        const ia = corners.findIndex(v => canon[v] === a), ib = corners.findIndex(v => canon[v] === b);
        if (ia < 0 || ib < 0) { fine = false; break; }
        if (ib === (ia + 1) % 3) onEdge[ia].push(...inserts); else onEdge[ib].push(...inserts.slice().reverse());
      }
      if (!fine) { dbg.notCorner++; continue; }
      rem[t] = 1; dbg.splits++; if (edges.length > 1) dbg.multi++;
      const face = fOf[t];
      if (edges.length === 1) {                           // one edge: a fan from the opposite corner
        const k = onEdge.findIndex(l => l.length), chain = [corners[k], ...onEdge[k].map(addVertex), corners[(k + 1) % 3]], vc = corners[(k + 2) % 3];
        for (let i = 0; i + 1 < chain.length; i++) addTri(chain[i], chain[i + 1], vc, face);
      } else {                                            // two or three edges: a fan from the triangle's middle
        const mid = [0, 1, 2].map(j => (P[corners[0] * 3 + j] + P[corners[1] * 3 + j] + P[corners[2] * 3 + j]) / 3), vm = addVertex(mid);
        const loop = []; for (let k = 0; k < 3; k++) { loop.push(corners[k]); for (const p of onEdge[k]) loop.push(addVertex(p)); }
        for (let i = 0; i < loop.length; i++) addTri(vm, loop[i], loop[(i + 1) % loop.length], face);
      }
    }
    log({ done: true, pairs: plan.map(p => ({ pair: p.fa + '/' + p.fb, kinds: [faces[p.fa][0], faces[p.fb][0]], a: p.RA.verts.length, b: p.RB.verts.length, closed: p.RA.closed, ends: p.ends.length })), ...dbg,
          moves: opts.onlyGroups ? [...target.entries()].map(([c, m]) => ({ c, to: m.map(x => +x.toFixed(3)), blends: [...(blendsAt.get(c) || [])], side: dir.get(c)?.side })) : undefined });
    return true;
  }
  for (const [, chainRoots] of clusters) {
    gi++;
    if (opts.onlyGroups && !opts.onlyGroups.has(gi)) continue;
    const whole = chainRoots.flatMap(k => chains.get(k));
    if (chainRoots.length === 1) { attempt(whole, true); continue; }
    if (attempt(whole, false)) continue;
    for (const k of chainRoots) attempt(chains.get(k), true, whole);
  }
  if (groupLog) result.groupLog = groupLog;
  if (!result.faces) return unchanged('the fillets and chamfers found could not be taken off');

  // ── the mesh that is left: live triangles not taken out, degenerate ones dropped ──────────────────────────────────────────────
  const outPos = Float32Array.from(P);
  const outIdx = [];
  const degenerate = (a, b, c) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < diag * diag * 1e-14;
  };
  for (let t = 0; t < nT; t++) { if (rem[t]) continue; const a = iv(t, 0), b = iv(t, 1), c = iv(t, 2); if (degenerate(a, b, c)) continue; outIdx.push(a, b, c); }
  result.after = outIdx.length / 3;
  return { ...result, positions: outPos, index: Uint32Array.from(outIdx) };
}

function push(map, key, item) { let l = map.get(key); if (!l) map.set(key, l = []); l.push(item); }

// ── small linear algebra ───────────────────────────────────────────────────────────────────────────────────────────────────────
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function radial(q, o, axis) { const dx = q[0] - o[0], dy = q[1] - o[1], dz = q[2] - o[2]; const h = dx * axis[0] + dy * axis[1] + dz * axis[2]; return Math.hypot(dx - h * axis[0], dy - h * axis[1], dz - h * axis[2]); }
function frameOf(n) { const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; let u = cross(n, a); const l = Math.hypot(...u); u = [u[0] / l, u[1] / l, u[2] / l]; return [u, cross(n, u)]; }
// Gaussian elimination with pivoting for a 3×3 system; null when singular
function solve3(M, b) {
  const A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-14) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 3; r++) { if (r === c) continue; const k = A[r][c] / A[c][c]; for (let j = c; j < 4; j++) A[r][j] -= k * A[c][j]; }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}
// the unit eigenvector of the smallest eigenvalue of a symmetric 3×3 matrix given as [xx, xy, xz, yy, yz, zz] (Jacobi rotations)
function smallestEigenvector(S) {
  const a = [[S[0], S[1], S[2]], [S[1], S[3], S[4]], [S[2], S[4], S[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] * a[i][j];
    if (off < 1e-24) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  let m = 0; for (let i = 1; i < 3; i++) if (a[i][i] < a[m][m]) m = i;
  const e = [v[0][m], v[1][m], v[2][m]], l = Math.hypot(...e);
  return l > 0 ? [e[0] / l, e[1] / l, e[2] / l] : null;
}
