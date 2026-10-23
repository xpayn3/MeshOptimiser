// booleans.js — exact booleans with Manifold (app/vendor/manifold, Apache-2.0): Merge bodies, Subtract, Intersect.
//
// Manifold works on closed solids. A part's mesh is split into its bodies (pieces joined by their triangles); each closed one goes
// in as a solid, and the boolean is exact: no grid, no detail lost, the faces it does not touch are the part's own. A body that is
// not closed (a sheet, a surface with a crack) cannot be a solid; it is left as it was and counted in `notClosed` (Close cracks may
// close it first).
//
//   mergeBodies: every closed body of a part becomes one: overlapping bodies are joined, the faces where they met and any body
//     wholly inside another go.
//   booleanOf(op, a, b, opts): a and b (each { positions, index }, in the same space; b may be a list) as solids; op 'union' |
//     'subtract' (a less b) | 'intersect' | 'without' (a less b, the cut left open) | 'split' (a less b, and a's part inside b).
//
// Nothing here touches three.js or the page.

import { weld } from './meshfix.js?v=4';

let W = null;
// Manifold, loaded on first use. url: where manifold.js is (default: next to this file, under ../vendor/manifold/).
export async function manifoldReady(url) {
  if (W) return W;
  const mod = await import(url || new URL('../vendor/manifold/manifold.js', import.meta.url).href);
  W = await mod.default();
  W.setup();
  return W;
}

// The bodies of a mesh: its triangles grouped by the points they share (after joining points by position).
export function bodiesOf(positions, index, tol) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], positions[i + k]); hi[k] = Math.max(hi[k], positions[i + k]); }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const { V, F } = weld(positions, index, tol ?? size * 1e-7);
  const par = V.map((_, i) => i), find = (x) => (par[x] === x ? x : (par[x] = find(par[x])));
  for (const f of F) { const a = find(f[0]); par[find(f[1])] = a; par[find(f[2])] = a; }
  const groups = new Map();
  for (const f of F) { const r = find(f[0]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(f); }
  return [...groups.values()].map(tris => {
    const map = new Map(), pos = [], idx = [];
    for (const f of tris) for (const v of f) { if (!map.has(v)) { map.set(v, pos.length / 3); pos.push(V[v][0], V[v][1], V[v][2]); } idx.push(map.get(v)); }
    return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
  });
}

function solid(Wm, g) {
  const mesh = new Wm.Mesh({ numProp: 3, vertProperties: Float32Array.from(g.positions), triVerts: Uint32Array.from(g.index) });
  mesh.merge();
  const m = new Wm.Manifold(mesh);                                // (throws when the body is not a closed solid)
  const o = m.asOriginal();                                       // (an id of its own: the faces of the result say which solid they came from)
  m.delete();
  return o;
}
// The mesh of a solid: its points and triangles. drop: the ids of the solids (originalID) whose faces are left out; the points no
// kept triangle uses go too.
function out(m, drop) {
  const mesh = m.getMesh();
  const n = mesh.numProp;
  let tv = mesh.triVerts;
  if (drop && drop.size) {
    const keep = [], ri = mesh.runIndex, ro = mesh.runOriginalID;
    for (let k = 0; k < ro.length; k++) if (!drop.has(ro[k])) for (let t = ri[k]; t < ri[k + 1]; t++) keep.push(tv[t]);
    tv = Uint32Array.from(keep);
  }
  const map = new Int32Array(mesh.vertProperties.length / n).fill(-1), I = new Uint32Array(tv.length);
  let c = 0;
  for (let i = 0; i < tv.length; i++) { let v = map[tv[i]]; if (v < 0) v = map[tv[i]] = c++; I[i] = v; }
  const P = new Float32Array(c * 3);
  for (let v = 0; v < map.length; v++) { const w = map[v]; if (w < 0) continue; P[3 * w] = mesh.vertProperties[v * n]; P[3 * w + 1] = mesh.vertProperties[v * n + 1]; P[3 * w + 2] = mesh.vertProperties[v * n + 2]; }
  return { positions: P, index: I };
}
const joinMeshes = (list) => {
  let nP = 0, nI = 0; for (const g of list) { nP += g.positions.length; nI += g.index.length; }
  const P = new Float32Array(nP), I = new Uint32Array(nI); let o = 0, oi = 0;
  for (const g of list) { P.set(g.positions, o); for (let i = 0; i < g.index.length; i++) I[oi + i] = g.index[i] + o / 3; o += g.positions.length; oi += g.index.length; }
  return { positions: P, index: I };
};

// Merge bodies. Returns positions, index and { bodies, merged, notClosed, volume }.
export function mergeBodies(Wm, positions, index) {
  const bodies = bodiesOf(positions, index), solids = [], loose = [];
  for (const b of bodies) { try { solids.push(solid(Wm, b)); } catch (_) { loose.push(b); } }
  if (!solids.length) return { ok: false, why: 'none of its ' + bodies.length + ' bodies is closed (Close cracks may close them)', bodies: bodies.length, notClosed: loose.length };
  const u = solids.length === 1 ? solids[0] : Wm.Manifold.union(solids);
  const res = out(u), volume = u.volume();
  for (const s of solids) try { s.delete(); } catch (_) {}
  if (u !== solids[0]) try { u.delete(); } catch (_) {}
  const all = loose.length ? joinMeshes([res, ...loose]) : res;
  return { ok: true, ...all, bodies: bodies.length, merged: solids.length, notClosed: loose.length, volume };
}

// A boolean between A and B, each { positions, index } in the same space (the closed bodies count). B may also be a list of such
// meshes, one for each cutter. op:
//   union | subtract (A less B) | intersect (what A shares with B; with several cutters, opts.all false: with any of them, else with
//     every one)
//   without: A less B with the cut left open: only A's own faces stay, none of B's close the cut (Cinema 4D's "A without B")
//   split: A less B, and A's part inside B as `second`
// opts.tol: afterwards, points closer than this are merged and the faces they leave flat are simplified (Manifold's simplify; Cinema
// 4D's "Optimize points").
export function booleanOf(Wm, op, a, b, opts = {}) {
  const asSolid = (g) => { const list = []; let open = 0; for (const body of bodiesOf(g.positions, g.index)) { try { list.push(solid(Wm, body)); } catch (_) { open++; } } return { s: list.length ? (list.length === 1 ? list[0] : Wm.Manifold.union(list)) : null, open, list }; };
  const many = Array.isArray(b);
  const A = asSolid(a), all = (many ? b : [b]).map(asSolid), Bs = all.filter(x => x.s);
  const open = A.open + all.reduce((t, x) => t + x.open, 0);
  const free = (list) => { for (const x of new Set(list)) if (x) try { x.delete(); } catch (_) {} };
  if (!A.s) { free([...A.list, ...all.flatMap(x => x.list), ...all.map(x => x.s)]); return { ok: false, why: 'the first has no closed body' }; }
  if (!Bs.length) { free([...A.list, A.s]); return { ok: false, why: many && all.length > 1 ? 'none of the others has a closed body' : 'the second has no closed body' }; }
  const B = Bs.length === 1 ? Bs[0].s : Wm.Manifold.union(Bs.map(x => x.s));
  const made = [];
  let r, second = null;
  if (op === 'intersect' && opts.all !== false && Bs.length > 1) { r = A.s; for (const x of Bs) { const nx = r.intersect(x.s); if (r !== A.s) made.push(r); r = nx; } }
  else if (op === 'intersect') r = A.s.intersect(B);
  else if (op === 'union') r = A.s.add(B);
  else { r = A.s.subtract(B); if (op === 'split') second = A.s.intersect(B); }
  if (opts.tol > 0) { made.push(r); r = r.simplify(opts.tol); if (second) { made.push(second); second = second.simplify(opts.tol); } }
  const bIds = new Set(); for (const x of Bs) for (const s of x.list) bIds.add(s.originalID());
  const res = op === 'without' ? out(r, bIds) : out(r), volume = r.volume();
  const sec = second ? out(second) : null, volumeInside = second ? second.volume() : 0;
  free([...A.list, ...Bs.flatMap(x => x.list), A.s, ...Bs.map(x => x.s), B, r, second, ...made]);
  const empty = res.index.length === 0 || (!!sec && sec.index.length === 0);
  return { ok: true, ...res, volume, notClosed: open, empty, ...(sec ? { second: sec, volumeInside } : {}) };
}
