// remesh.js — Remesh evenly: an isotropic remesh that stays on the part's own surface and keeps its sharp edges.
//
// The usual way (Botsch & Kobbelt, "A remeshing approach to multiresolution modeling"), a few rounds of:
//   1. split every edge longer than 4/3 of the target length at its middle;
//   2. collapse every edge shorter than 4/5 of it, unless that makes an edge too long, turns a triangle over or pinches the surface;
//   3. flip edges so that as many points as can have six neighbours (four on an outline);
//   4. move each point towards the middle of its neighbours, within its surface (along its tangent plane);
//   5. put each point back on the original surface (the nearest point of the original triangles).
// Sharp edges (faces meeting at more than featureDeg) and open edges are kept: their points only slide along them and are put
// back onto the original edges, corners (where three or more of them meet, or an edge ends) do not move, and no edge is flipped
// across or collapsed off them. Works on open meshes too. A part that knows its CAD faces (opts.cad) keeps the CAD edges instead:
// an edge between two CAD faces is sharp whatever its angle, unless the faces meet tangent (a fillet and what it rounds off), and
// the seams inside one face (the facets of a cylinder) never are.
//
// Nothing here touches three.js or the page.

import { weld, pack } from './meshfix.js?v=4';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const ekey = (a, b) => (a < b ? a + ',' + b : b + ',' + a);

function closestOnTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, mul(ab, d1 / (d1 - d3)));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, mul(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, mul(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const den = 1 / (va + vb + vc);
  return add(a, add(mul(ab, vb * den), mul(ac, vc * den)));
}
const closestOnSeg = (p, a, b) => { const ab = sub(b, a), l2 = dot(ab, ab) || 1e-30, t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)); return add(a, mul(ab, t)); };

// A grid of cells over items (triangles or segments), to find the nearest one to a point.
function spatialIndex(items, boxOf, cell) {
  const grid = new Map();
  items.forEach((it, i) => {
    const [lo, hi] = boxOf(it);
    for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++) for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++) for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) {
      const k = x + ',' + y + ',' + z; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i);
    }
  });
  // the nearest by a widening search (rings of cells), up to maxRing
  return (p, closest, maxRing = 6) => {
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    let best = null, bd = Infinity;
    for (let r = 0; r <= maxRing; r++) {
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== r) continue;
        for (const i of grid.get(x + ',' + y + ',' + z) || []) { const q = closest(p, items[i]), d = len(sub(q, p)); if (d < bd) { bd = d; best = q; } }
      }
      if (best && bd <= r * cell) break;
    }
    return best;
  };
}

// opts: length (target edge length; default: about as many triangles as the original, evenly), featureDeg (default 30),
// rounds (default 5), maxTriangles (default 1,000,000: the edge is made longer when the result would have more),
// cad ({ faceOf: the CAD face of each triangle of the input, -1 for none; smooth: the pairs of faces [a, b] that meet tangent }),
// tags (a number per input triangle, carried to the triangles made from it: the result has `tags`, one per output triangle, and no
// edge between two tags is flipped), fixOpen (the open edges stay exactly as they are: not split, their points not moved, so the
// result can be joined back into the mesh it was cut from).
// Returns positions, index and { length, triangles, sharpEdges, fromCad }.
// pack() with a tag per triangle: the tags of the triangles that are kept, in the same order
function packTagged(V, F, G) {
  const used = new Int32Array(V.length).fill(-1), pos = [], idx = [], tags = [], seen = new Set();
  F.forEach((f, t) => {
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) return;
    const k = [f[0], f[1], f[2]].sort((a, b) => a - b).join(','); if (seen.has(k)) return; seen.add(k);
    for (const v of f) { if (used[v] < 0) { used[v] = pos.length / 3; pos.push(V[v][0], V[v][1], V[v][2]); } idx.push(used[v]); }
    tags.push(G[t]);
  });
  return { positions: new Float32Array(pos), index: new Uint32Array(idx), tags: Int32Array.from(tags) };
}
export function remeshEvenly(positions, index, opts = {}) {
  const P = positions;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const { V, F: F0, T: T0 } = weld(positions, index, size * 1e-7);
  if (!F0.length) return { ok: false, why: 'the part has no surface' };
  let F = F0.map(f => f.slice());
  const tagIn = opts.tags || null, fixOpen = !!opts.fixOpen;
  let G = tagIn ? T0.map(t => tagIn[t]) : null;            // (the tag of each triangle of F, kept in step with it)
  const fn = (f) => cross(sub(V[f[1]], V[f[0]]), sub(V[f[2]], V[f[0]]));
  let area = 0; for (const f of F) area += len(fn(f)) / 2;
  // (an even triangle of edge L covers about 0.433 L²: the edge is raised when the result would pass maxTriangles, so a short edge
  // on a big part cannot run for minutes and run out of memory)
  const maxT = opts.maxTriangles ?? 1e6, Lmin = Math.sqrt(area / (maxT * 0.433));
  const asked = opts.length > 0 ? opts.length : Math.sqrt(area / (F.length * 0.433)), L = Math.max(asked, Lmin), capped = L > asked;
  const hiL = (4 / 3) * L, loL = (4 / 5) * L, cosF = Math.cos((opts.featureDeg ?? 30) * Math.PI / 180);
  // the original surface and its sharp and open edges, to project onto
  const orig = F.map(f => [V[f[0]].slice(), V[f[1]].slice(), V[f[2]].slice()]);
  const edgeFaces = (FF) => { const m = new Map(); FF.forEach((f, t) => { if (!f) return; for (let k = 0; k < 3; k++) { const key = ekey(f[k], f[(k + 1) % 3]); let l = m.get(key); if (!l) m.set(key, l = []); l.push(t); } }); return m; };
  let em = edgeFaces(F);
  const feat = new Set();
  const cad = opts.cad && opts.cad.faceOf ? opts.cad : null, smoothPair = new Set(((cad && cad.smooth) || []).map(([a, b]) => ekey(a, b)));
  // by the CAD faces when both triangles have one (true / false), else null: the angle decides
  const sharpByCad = (l) => { const fa = cad.faceOf[T0[l[0]]], fb = cad.faceOf[T0[l[1]]]; if (!(fa >= 0 && fb >= 0)) return null; return fa !== fb && !smoothPair.has(ekey(fa, fb)); };
  for (const [key, l] of em) {
    if (l.length !== 2) { feat.add(key); continue; }
    const byCad = cad ? sharpByCad(l) : null;
    if (byCad !== null) { if (byCad) feat.add(key); continue; }
    const a = norm(fn(F[l[0]])), b = norm(fn(F[l[1]]));
    if (dot(a, b) < cosF) feat.add(key);
  }
  const openV = new Uint8Array(V.length);                 // (fixOpen: the points of the open edges, which never move)
  if (fixOpen) for (const [key, l] of em) if (l.length === 1) { const [a, b] = key.split(',').map(Number); openV[a] = 1; openV[b] = 1; }
  const origSegs = [...feat].map(k => { const [a, b] = k.split(',').map(Number); return [V[a].slice(), V[b].slice()]; });
  const cell = Math.max(L * 2, size * 1e-3);
  const box3 = (pts) => { const l = [Infinity, Infinity, Infinity], h = [-Infinity, -Infinity, -Infinity]; for (const p of pts) for (let k = 0; k < 3; k++) { l[k] = Math.min(l[k], p[k]); h[k] = Math.max(h[k], p[k]); } return [l, h]; };
  const nearSurf = spatialIndex(orig, box3, cell), nearEdge = origSegs.length ? spatialIndex(origSegs, box3, cell) : null;
  // the kind of each point: 0 free, 1 on a sharp or open edge, 2 a corner
  const kind = () => {
    const c = new Uint8Array(V.length);
    for (const key of feat) { const [a, b] = key.split(',').map(Number); c[a]++; c[b]++; }
    return c.map((n, v) => (v < openV.length && openV[v] ? 2 : n === 0 ? 0 : n === 2 ? 1 : 2));
  };
  const rounds = opts.rounds ?? 5;
  for (let round = 0; round < rounds; round++) {
    // 1. split long edges
    for (let pass = 0; pass < 3; pass++) {
      em = edgeFaces(F);
      const long = [...em.keys()].map(k => { const [a, b] = k.split(',').map(Number); return { a, b, d: len(sub(V[a], V[b])) }; }).filter(e => e.d > hiL).sort((x, y) => y.d - x.d);
      if (!long.length) break;
      const touched = new Set();
      for (const { a, b } of long) {
        const l = em.get(ekey(a, b)); if (!l || l.some(t => touched.has(t))) continue;
        if (fixOpen && l.length < 2) continue;
        const m = V.length; V.push(mul(add(V[a], V[b]), 0.5));
        const wasFeat = feat.delete(ekey(a, b));
        if (wasFeat) { feat.add(ekey(a, m)); feat.add(ekey(m, b)); }
        for (const t of l) {
          const f = F[t], k = [0, 1, 2].find(i => (f[i] === a && f[(i + 1) % 3] === b) || (f[i] === b && f[(i + 1) % 3] === a));
          const x = f[k], y = f[(k + 1) % 3], z = f[(k + 2) % 3];
          F[t] = [x, m, z]; F.push([m, y, z]); touched.add(t); touched.add(F.length - 1);
          if (G) G.push(G[t]);
        }
      }
    }
    // 2. collapse short edges
    {
      const K = kind();
      em = edgeFaces(F);
      const vf = V.map(() => []); F.forEach((f, t) => { if (f) for (const v of f) vf[v].push(t); });
      const nbs = (v) => { const s = new Set(); for (const t of vf[v]) if (F[t]) for (const u of F[t]) if (u !== v) s.add(u); return s; };
      const short = [...em.keys()].map(k => { const [a, b] = k.split(',').map(Number); return { a, b, d: len(sub(V[a], V[b])) }; }).filter(e => e.d < loL).sort((x, y) => x.d - y.d);
      const dead = new Uint8Array(V.length);
      for (const { a, b } of short) {
        if (dead[a] || dead[b]) continue;
        const l = (em.get(ekey(a, b)) || []).filter(t => F[t]);
        if (!l.length) continue;
        // which end goes: the one of lower kind; an end on an edge may only slide along it, a corner never moves
        let v = a, u = b;
        if (K[a] > K[b]) { v = b; u = a; }
        if (K[v] === 2) continue;
        if (K[v] === 1 && !feat.has(ekey(a, b))) continue;
        if (K[v] === K[u] && K[v] === 1 && !feat.has(ekey(a, b))) continue;
        const nv = nbs(v), nu = nbs(u);
        // pinching: the two ends may share only the corners of the triangles on the edge
        let shared = 0; for (const x of nv) if (nu.has(x)) shared++;
        if (shared !== l.length) continue;
        // no edge too long afterwards, no triangle turned over
        let ok = true;
        for (const x of nv) if (x !== u && len(sub(V[x], V[u])) > hiL) { ok = false; break; }
        if (ok) for (const t of vf[v]) {
          const f = F[t]; if (!f || f.includes(u)) continue;
          const g = f.map(x => (x === v ? u : x)), n0 = fn(f), n1 = cross(sub(V[g[1]], V[g[0]]), sub(V[g[2]], V[g[0]]));
          if (dot(n0, n1) <= 0.1 * len(n0) * len(n1)) { ok = false; break; }
        }
        if (!ok) continue;
        for (const t of vf[v]) {
          const f = F[t]; if (!f) continue;
          if (f.includes(u)) { F[t] = null; continue; }
          F[t] = f.map(x => (x === v ? u : x)); vf[u].push(t);
        }
        // the sharp edges of v become u's
        for (const x of nv) { const k = ekey(v, x); if (feat.delete(k) && x !== u) feat.add(ekey(u, x)); }
        dead[v] = 1; dead[u] = 1;                                 // (one change round each point a pass)
      }
      if (G) G = G.filter((_, t) => F[t]);
      F = F.filter(Boolean);
    }
    // 3. flip edges towards six neighbours (four on an outline)
    {
      const K = kind();
      for (let pass = 0; pass < 2; pass++) {
        em = edgeFaces(F);
        const val = new Int32Array(V.length), onOpen = new Uint8Array(V.length);
        for (const [key, l] of em) { const [a, b] = key.split(',').map(Number); val[a]++; val[b]++; if (l.length === 1) { onOpen[a] = 1; onOpen[b] = 1; } }
        const target = (v) => (onOpen[v] ? 4 : 6);
        // the edges as they are now (a flip earlier in this pass may have made c–d already: two flips must not make it twice)
        const live = new Set(em.keys());
        const busy = new Set();
        for (const [key, l] of em) {
          if (l.length !== 2 || feat.has(key) || busy.has(l[0]) || busy.has(l[1])) continue;
          if (G && G[l[0]] !== G[l[1]]) continue;
          const [a, b] = key.split(',').map(Number), f0 = F[l[0]], f1 = F[l[1]];
          const c = f0.find(x => x !== a && x !== b), d = f1.find(x => x !== a && x !== b);
          if (c === undefined || d === undefined || c === d || live.has(ekey(c, d))) continue;
          const dev = (x, dv) => Math.abs(val[x] + dv - target(x));
          const before = dev(a, 0) + dev(b, 0) + dev(c, 0) + dev(d, 0), after = dev(a, -1) + dev(b, -1) + dev(c, 1) + dev(d, 1);
          if (after >= before) continue;
          // the new triangles, the way round of the old ones (f0 runs a→b or b→a)
          const k0 = f0.indexOf(a), aToB = f0[(k0 + 1) % 3] === b;
          const t0 = aToB ? [c, a, d] : [c, d, a], t1 = aToB ? [c, d, b] : [c, b, d];
          const n0 = fn(f0), m0 = fn(t0), m1 = fn(t1);
          if (dot(n0, m0) <= 0 || dot(n0, m1) <= 0 || dot(norm(m0), norm(m1)) < cosF) continue;
          F[l[0]] = t0; F[l[1]] = t1; busy.add(l[0]); busy.add(l[1]);
          live.delete(key); live.add(ekey(c, d));
          val[a]--; val[b]--; val[c]++; val[d]++;
        }
      }
      // 4. relax within the surface, and 5. back onto the original
      const vf = V.map(() => []); F.forEach((f, t) => { for (const v of f) vf[v].push(t); });
      const nb = V.map(() => new Set()); for (const f of F) for (let k = 0; k < 3; k++) { nb[f[k]].add(f[(k + 1) % 3]); nb[f[k]].add(f[(k + 2) % 3]); }
      const featNb = V.map(() => []); for (const key of feat) { const [a, b] = key.split(',').map(Number); featNb[a].push(b); featNb[b].push(a); }
      const next = V.map(p => p.slice());
      for (let v = 0; v < V.length; v++) {
        if (!vf[v].length || K[v] === 2) continue;
        if (K[v] === 1) {
          if (featNb[v].length !== 2) continue;
          const [x, y] = featNb[v], m = mul(add(V[x], V[y]), 0.5), dir = norm(sub(V[y], V[x]));
          next[v] = add(V[v], mul(dir, dot(sub(m, V[v]), dir)));
          continue;
        }
        let n = [0, 0, 0], c = [0, 0, 0], w = 0;
        for (const t of vf[v]) { const fv = fn(F[t]); n = add(n, fv); }
        for (const u of nb[v]) { c = add(c, V[u]); w++; }
        if (!w) continue;
        c = mul(c, 1 / w); n = norm(n);
        const d = sub(c, V[v]);
        next[v] = add(V[v], sub(d, mul(n, dot(d, n))));
      }
      for (let v = 0; v < V.length; v++) {
        if (!vf[v].length || K[v] === 2) continue;
        const q = K[v] === 1 && nearEdge ? nearEdge(next[v], (p, sg) => closestOnSeg(p, sg[0], sg[1])) : nearSurf(next[v], (p, t) => closestOnTri(p, t[0], t[1], t[2]));
        V[v] = q || next[v];
      }
    }
  }
  const out = G ? packTagged(V, F, G) : pack(V, F);
  return { ok: true, ...out, length: L, capped, maxTriangles: maxT, triangles: out.index.length / 3, sharpEdges: feat.size, fromCad: !!cad };
}
