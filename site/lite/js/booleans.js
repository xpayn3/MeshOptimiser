// booleans.js — exact booleans with Manifold (app/vendor/manifold, Apache-2.0): Merge bodies, Subtract, Intersect.
//
// Manifold works on closed solids. A part's mesh is split into its bodies (pieces joined by their triangles); each closed one goes
// in as a solid, and the boolean is exact: no grid, no detail lost, the faces it does not touch are the part's own. A body that is
// not closed (a sheet, a surface with a crack) cannot be a solid; it is left as it was and counted in `notClosed` (Close cracks may
// close it first).
//
//   mergeBodies: every closed body of a part becomes one: overlapping bodies are joined, the faces where they met and any body
//     wholly inside another go.
//   booleanOf(op, a, b): a and b (each { positions, index }, in the same space) as solids; op 'union' | 'subtract' (a less b) |
//     'intersect'.
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
  return new Wm.Manifold(mesh);                                   // (throws when the body is not a closed solid)
}
function out(m) {
  const mesh = m.getMesh();
  const n = mesh.numProp, P = new Float32Array(mesh.vertProperties.length / n * 3);
  for (let v = 0; v < P.length / 3; v++) { P[3 * v] = mesh.vertProperties[v * n]; P[3 * v + 1] = mesh.vertProperties[v * n + 1]; P[3 * v + 2] = mesh.vertProperties[v * n + 2]; }
  return { positions: P, index: Uint32Array.from(mesh.triVerts) };
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

// A boolean between two meshes (each may hold several bodies; the closed ones count). op: 'union' | 'subtract' | 'intersect'.
export function booleanOf(Wm, op, a, b) {
  const asSolid = (g) => { const list = []; let open = 0; for (const body of bodiesOf(g.positions, g.index)) { try { list.push(solid(Wm, body)); } catch (_) { open++; } } return { s: list.length ? (list.length === 1 ? list[0] : Wm.Manifold.union(list)) : null, open, list }; };
  const A = asSolid(a), B = asSolid(b);
  if (!A.s) return { ok: false, why: 'the first has no closed body' };
  if (!B.s) return { ok: false, why: 'the second has no closed body' };
  const r = op === 'subtract' ? A.s.subtract(B.s) : op === 'intersect' ? A.s.intersect(B.s) : A.s.add(B.s);
  const res = out(r), volume = r.volume();
  for (const x of [...A.list, ...B.list, A.s, B.s, r]) try { x.delete(); } catch (_) {}
  return { ok: true, ...res, volume, notClosed: A.open + B.open, empty: res.index.length === 0 };
}
