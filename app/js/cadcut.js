// cadcut.js — take whole CAD faces out of a part (a hole's wall, a boss, a fillet, a pocket) and close the surface again, cleanly.
//
// The part knows its CAD faces (step2glb.py --brep; the app keeps them in _Brep): the CAD face of every triangle, and the CAD edges
// between them. Here:
//   1. The triangles of the faces to remove are taken out (the mesh is joined by position first: CAD gives every face its own points).
//   2. The cut is found: the edges of the triangles that stay whose other side was removed. They run in loops (the rim of a hole's
//      wall at the top and at the bottom of a plate, the foot of a boss). A cut that runs into an edge that was already open does not
//      close and is left open (counted).
//   3. Each loop is closed with the smooth patch of meshfix.js (patchLoops): triangulated, refined to the length of the edges round
//      it and faired, so the patch carries on the surface round it: curved on a curved face. A rim that lies in a plane is closed
//      flat (unless it lies in one curved face): faired, the patch over a box's missing side would bulge.
//   4. The triangles are made even. scope 'local' (the default): only the patches and the triangles that touch them; their outer
//      edge does not move, so the rest of the part is exactly as it was. scope 'whole': the whole part (remesh.js), with the CAD
//      edges kept as sharp edges.
//   5. The CAD faces go on: a patch whose rim lies in one face (a hole through a plate) becomes part of that face; one whose rim runs
//      over several faces is a new face of its own (kind: opts.otherKind). The triangles are put in face order, as the record needs,
//      the areas are measured again, and a removed face is kept with no triangles, so the edges keep their face numbers. A CAD edge
//      of a removed face goes, unless it borders a new patch face (then it is that face's edge now).
//
//   positions, index   the mesh (Float32Array xyz; a triangle index)
//   opts.cad           { faces: [[kind, firstTri, triCount, area, ...nums]...], rows: [[firstPt, ptCount, tangent, faceA, faceB]...], pts }
//   opts.remove        the numbers of the CAD faces to take out
//   opts.close         'smooth' (default), 'flat' (every patch flat) or 'open' (the gaps are left open: nothing is patched)
//   opts.scope         'local' (default), 'whole' (opts.whole: 1 is the same) or 'none' (no remesh)
//   opts.rings         'local': how many rings of triangles round the patches are remeshed with them (default 1)
//   opts.rounds        the remesh's rounds (remesh.js, default 5): more, more even
//   opts.length        the edge length of the remesh (default: the patches' own, for 'local'; remesh.js's own, for 'whole')
//   opts.otherKind     the kind number for a new face (default 10, 'other' in the converter's list)
//   opts.planeKind     the kind number of a plane (default 0)
// Returns { ok, positions, index, cad: { faces, rows, pts }, faces (removed), loops, patched, open, joined, newFaces, removedTris,
// before, after, scope, length, remeshed } or { ok: false, why }.
//
// Pure function, no dependencies on the page: the worker and the page call it the same way; the tests call it from Node.

import { weld, patchLoops } from './meshfix.js?v=4';
import { remeshEvenly } from './remesh.js?v=4';

const ekey = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
function sizeOf(P) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
}
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
// triangles F of points V as flat arrays (only the points they use)
function flat(V, F) {
  const used = new Int32Array(V.length).fill(-1), pos = [], idx = new Uint32Array(F.length * 3);
  F.forEach((f, t) => { for (let k = 0; k < 3; k++) { const v = f[k]; if (used[v] < 0) { used[v] = pos.length / 3; pos.push(V[v][0], V[v][1], V[v][2]); } idx[t * 3 + k] = used[v]; } });
  return { positions: new Float32Array(pos), index: idx };
}

export function removeCadFaces(positions, index, opts = {}) {
  const cad = opts.cad;
  if (!cad || !cad.faces || !cad.faces.length) return { ok: false, why: 'the part has no CAD faces (open the STEP with them)' };
  const T = (index.length / 3) | 0, nF = cad.faces.length, rows = cad.rows || [];
  const gone = new Uint8Array(nF); let nGone = 0;
  for (const f of opts.remove || []) if (f >= 0 && f < nF && !gone[f]) { gone[f] = 1; nGone++; }
  if (!nGone) return { ok: false, why: 'no CAD face is picked' };
  if (nGone === nF) return { ok: false, why: 'those are all the faces of the part: nothing would be left' };
  const faceOf = new Int32Array(T).fill(-1);
  cad.faces.forEach((fc, i) => { for (let t = fc[1]; t < fc[1] + fc[2] && t < T; t++) faceOf[t] = i; });
  const size = sizeOf(positions), tol = size * 1e-7;

  // 1. joined by position; the removed faces' triangles out
  const { V, F: F0, T: T0 } = weld(positions, index, tol);
  const had = new Map();
  for (const f of F0) for (let k = 0; k < 3; k++) { const key = ekey(f[k], f[(k + 1) % 3]); had.set(key, (had.get(key) || 0) + 1); }
  const F = [], G = [];
  for (let i = 0; i < F0.length; i++) { const f = faceOf[T0[i]]; if (f >= 0 && gone[f]) continue; F.push(F0[i]); G.push(f); }
  const removedTris = F0.length - F.length;
  if (!removedTris) return { ok: false, why: 'the picked faces have no triangles' };

  // 2. the cut, in loops in the direction of the triangles that stay
  const kept = new Map();
  for (const f of F) for (let k = 0; k < 3; k++) { const key = ekey(f[k], f[(k + 1) % 3]); kept.set(key, (kept.get(key) || 0) + 1); }
  const next = new Map(), side = new Map();
  F.forEach((f, t) => {
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3], key = ekey(a, b);
      if (kept.get(key) !== 1 || !(had.get(key) >= 2)) continue;
      if (!next.has(a)) next.set(a, []);
      next.get(a).push(b); side.set(a + '>' + b, G[t]);
    }
  });
  const loops = []; let open = 0;
  for (const [a0] of next) while (next.get(a0) && next.get(a0).length) {
    const loop = [a0]; let a = a0, guard = 0, closed = false;
    for (;;) {
      const l = next.get(a); if (!l || !l.length) break;
      const b = l.pop(); if (b === a0) { closed = true; break; }
      loop.push(b); a = b; if (++guard > 1e6) break;
    }
    if (closed && loop.length >= 3) loops.push(loop); else open++;
  }
  // the face each loop lies in: one face for the whole rim, or none (-1: a new face)
  const loopFace = loops.map(loop => {
    const fs = new Set();
    for (let i = 0; i < loop.length; i++) fs.add(side.get(loop[i] + '>' + loop[(i + 1) % loop.length]));
    return fs.size === 1 && [...fs][0] >= 0 ? [...fs][0] : -1;
  });
  const sideFaces = loops.map(loop => { const fs = new Set(); for (let i = 0; i < loop.length; i++) { const f = side.get(loop[i] + '>' + loop[(i + 1) % loop.length]); if (f >= 0) fs.add(f); } return fs; });

  // 3. the patches
  let rimLen = 0, rimN = 0;
  for (const loop of loops) for (let i = 0; i < loop.length; i++) { rimLen += dist(V[loop[i]], V[loop[(i + 1) % loop.length]]); rimN++; }
  // A rim that lies in a plane is closed flat, unless it lies in one curved face (a hole in a dome): the faired patch carries on the
  // faces round it, and where those stand at an angle to the rim (the side of a box) it would bulge out.
  const planeKind = Number.isFinite(opts.planeKind) ? opts.planeKind : 0;
  const flatRim = (loop) => {
    const pts = loop.map(v => V[v]), n = pts.length;
    let c = [0, 0, 0], nn = [0, 0, 0];
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; for (let k = 0; k < 3; k++) c[k] += p[k] / n; nn = [nn[0] + (p[1] - q[1]) * (p[2] + q[2]), nn[1] + (p[2] - q[2]) * (p[0] + q[0]), nn[2] + (p[0] - q[0]) * (p[1] + q[1])]; }
    const l = Math.hypot(...nn); if (!(l > 0)) return false;
    let span = 0, off = 0;
    for (const p of pts) { span = Math.max(span, dist(p, c)); off = Math.max(off, Math.abs(((p[0] - c[0]) * nn[0] + (p[1] - c[1]) * nn[1] + (p[2] - c[2]) * nn[2]) / l)); }
    return off <= Math.max(span * 1e-3, tol * 10);
  };
  const close = opts.close === 'open' ? 'open' : opts.close === 'flat' || opts.fair === false ? 'flat' : 'smooth';
  const pr = { patched: 0, skipped: 0, made: [] };
  if (close !== 'open') loops.forEach((loop, li) => {
    const f = loopFace[li], curved = f >= 0 && cad.faces[f][0] !== planeKind;
    const fair = close === 'smooth' && (curved || !flatRim(loop));
    const r = patchLoops(V, F, [loop], { fair });
    pr.patched += r.patched; pr.skipped += r.skipped;
    for (const m of r.made) pr.made.push({ loop: li, from: m.from, to: m.to });
  });
  const otherKind = Number.isFinite(opts.otherKind) ? opts.otherKind : 10;
  const newFace = [];                                         // per loop: the number of its new face, or -1
  let nNew = 0, joined = 0;
  for (let li = 0; li < loops.length; li++) newFace.push(-1);
  for (const m of pr.made) {
    let tag = loopFace[m.loop];
    if (tag >= 0) joined++; else { tag = nF + nNew++; newFace[m.loop] = tag; }
    for (let t = m.from; t < m.to; t++) G[t] = tag;
  }
  while (G.length < F.length) G.push(-1);                    // (none: every patch triangle is in a range)

  // the CAD edges: those of a removed face go, unless they border a new patch face
  const outRows = [];
  for (const r of rows) {
    const fa = r[3], fb = r[4], ga = fa >= 0 && gone[fa], gb = fb >= 0 && gone[fb];
    if (!ga && !gb) { outRows.push(r.slice()); continue; }
    if (ga && gb) continue;
    const k = ga ? fb : fa;
    const li = loops.findIndex((_, i) => newFace[i] >= 0 && sideFaces[i].has(k));
    if (li < 0) continue;
    const n = r.slice(); if (ga) n[3] = newFace[li]; else n[4] = newFace[li];
    outRows.push(n);
  }
  const smooth = []; for (const r of outRows) if (r[2] && r[3] >= 0 && r[4] >= 0 && r[3] !== r[4]) smooth.push([r[3], r[4]]);

  // 4. the remesh
  const scope = opts.scope === 'none' ? 'none' : opts.scope === 'whole' || opts.whole > 0 ? 'whole' : 'local';
  const rimL = rimN ? rimLen / rimN : 0;
  let m = { V, F, G, remeshed: false, length: 0, why: '' };
  if (scope === 'whole') m = remeshTagged(V, F, G, smooth, null, { ...opts, tol });
  else if (scope === 'local' && pr.made.length) {
    const inPatch = new Uint8Array(F.length);
    for (const x of pr.made) for (let t = x.from; t < x.to; t++) inPatch[t] = 1;
    m = remeshTagged(V, F, G, smooth, grow(V, F, inPatch, opts.rings), { ...opts, tol, length: opts.length > 0 ? opts.length : rimL });
  }

  // 5. in face order, with the record
  const out = withRecord(m.V, m.F, m.G, cad.faces, nF + nNew, otherKind);
  return {
    ok: true, positions: out.positions, index: out.index,
    cad: { faces: out.faces, rows: outRows, pts: cad.pts },
    faces: nGone, removedTris, loops: loops.length, patched: pr.patched, open, joined, newFaces: nNew, close,
    before: T, after: out.index.length / 3, scope, length: m.length, remeshed: m.remeshed, ...(m.why ? { why: m.why } : {}),
  };
}

// The triangles flagged in `mark`, and `rings` rings of triangles round them (a ring: every triangle that shares a point with the
// ones already in), as a flag per triangle.
function grow(V, F, mark, rings) {
  const n = Math.max(0, Math.min(20, Number.isFinite(+rings) ? Math.round(+rings) : 1));
  let cur = Uint8Array.from(mark);
  for (let k = 0; k < n; k++) {
    const touch = new Uint8Array(V.length);
    for (let t = 0; t < F.length; t++) if (cur[t]) for (const v of F[t]) touch[v] = 1;
    const nx = Uint8Array.from(cur);
    for (let t = 0; t < F.length; t++) if (!nx[t] && (touch[F[t][0]] || touch[F[t][1]] || touch[F[t][2]])) nx[t] = 1;
    cur = nx;
  }
  return cur;
}
// Remesh the triangles F (points V, a CAD face per triangle in G) evenly, with the CAD edges kept: all of them (region null), or only
// those flagged in `region`, whose outer edge stays exactly where it is so the rest of the part is joined back unchanged.
// opts: length (0: remesh.js's own), rounds, tol. Returns { V, F, G, remeshed, length, why }.
function remeshTagged(V, F, G, smooth, region, opts) {
  const tol = opts.tol, list = [], rest = [];
  for (let t = 0; t < F.length; t++) (!region || region[t] ? list : rest).push(t);
  if (!list.length) return { V, F, G, remeshed: false, length: 0, why: 'nothing to remesh' };
  const fl = flat(V, list.map(t => F[t])), tags = Int32Array.from(list, t => G[t]);
  const ro = { cad: { faceOf: tags, smooth }, tags, length: opts.length > 0 ? opts.length : 0 };
  if (region) ro.fixOpen = true;
  if (opts.rounds > 0) ro.rounds = Math.min(20, Math.round(opts.rounds));
  const r = remeshEvenly(fl.positions, fl.index, ro);
  if (!r || !r.ok || !r.tags) return { V, F, G, remeshed: false, length: 0, why: (r && r.why) || 'the remesh did not work' };
  // the rest as it was, the remeshed triangles joined to it by the points of their outer edge (which did not move)
  const rf = flat(V, rest.map(t => F[t])), nP = rf.positions.length / 3;
  const P = new Float32Array(rf.positions.length + r.positions.length); P.set(rf.positions); P.set(r.positions, rf.positions.length);
  const I = new Uint32Array(rf.index.length + r.index.length); I.set(rf.index); for (let i = 0; i < r.index.length; i++) I[rf.index.length + i] = r.index[i] + nP;
  const all = new Int32Array(rest.length + r.tags.length); rest.forEach((t, i) => { all[i] = G[t]; }); all.set(r.tags, rest.length);
  const w = weld(P, I, tol);
  return { V: w.V, F: w.F, G: w.T.map(t => all[t]), remeshed: true, length: r.length, why: '' };
}
// The triangles put in face order (a face is one run, as the record needs), the areas measured again; a face with no triangles left
// starts where the next one does. faces: the record's faces (the first ones; the others are new, of kind otherKind).
function withRecord(V, F, G, faces0, nAll, otherKind) {
  const order = F.map((_, t) => t), key = (t) => (G[t] >= 0 ? G[t] : Infinity);
  order.sort((a, b) => key(a) - key(b) || a - b);
  const fl = flat(V, order.map(t => F[t]));
  const start = new Int32Array(nAll).fill(-1), count = new Int32Array(nAll), area = new Float64Array(nAll);
  const P = fl.positions, I = fl.index;
  order.forEach((t, i) => {
    const f = G[t]; if (!(f >= 0)) return;
    if (start[f] < 0) start[f] = i; count[f]++;
    const a = I[i * 3] * 3, b = I[i * 3 + 1] * 3, c = I[i * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    area[f] += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  });
  for (let f = nAll - 1, nx = order.length; f >= 0; f--) { if (start[f] < 0) start[f] = nx; else nx = start[f]; }
  const faces = [];
  for (let f = 0; f < nAll; f++) {
    const n = f < faces0.length ? faces0[f].slice() : [otherKind, 0, 0, 0];
    n[1] = start[f]; n[2] = count[f]; if (n.length > 3) n[3] = area[f];
    faces.push(n);
  }
  return { positions: fl.positions, index: fl.index, faces };
}

// Remesh CAD faces of a part without taking anything out: the faces in opts.faces (their outline stays where it is, so the faces
// round them do not change), or the whole part when none are given. The CAD faces and edges go on as they were.
//   opts.cad, opts.faces (CAD face numbers, or none: the whole part), opts.length (0: the faces' own: about as many triangles as they
//   had), opts.rounds. Returns { ok, positions, index, cad, faces, before, after, length, remeshed } or { ok: false, why }.
export function remeshCadFaces(positions, index, opts = {}) {
  const cad = opts.cad;
  if (!cad || !cad.faces || !cad.faces.length) return { ok: false, why: 'the part has no CAD faces (open the STEP with them)' };
  const T = (index.length / 3) | 0, nF = cad.faces.length, rows = cad.rows || [];
  const faceOf = new Int32Array(T).fill(-1);
  cad.faces.forEach((fc, i) => { for (let t = fc[1]; t < fc[1] + fc[2] && t < T; t++) faceOf[t] = i; });
  const tol = sizeOf(positions) * 1e-7;
  const { V, F, T: T0 } = weld(positions, index, tol);
  const G = T0.map(t => faceOf[t]);
  const want = new Uint8Array(nF); let n = 0;
  for (const f of opts.faces || []) if (f >= 0 && f < nF && !want[f]) { want[f] = 1; n++; }
  const region = n ? Uint8Array.from(G, f => (f >= 0 && want[f] ? 1 : 0)) : null;
  if (region && !region.some(x => x)) return { ok: false, why: 'the picked faces have no triangles' };
  const smooth = []; for (const r of rows) if (r[2] && r[3] >= 0 && r[4] >= 0 && r[3] !== r[4]) smooth.push([r[3], r[4]]);
  const m = remeshTagged(V, F, G, smooth, region, { ...opts, tol });
  if (!m.remeshed) return { ok: false, why: m.why };
  const out = withRecord(m.V, m.F, m.G, cad.faces, nF, 10);
  return { ok: true, positions: out.positions, index: out.index, cad: { faces: out.faces, rows: rows.map(r => r.slice()), pts: cad.pts },
    faces: n, before: T, after: out.index.length / 3, length: m.length, remeshed: true, scope: n ? 'faces' : 'whole' };
}
