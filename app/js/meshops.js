// meshops.js — one way in to the mesh tools, shared by the background workers (mesh-worker.js) and the page (when there are no
// workers): run one of them on a part's positions and index, and shade the result (smooth up to an angle, hard beyond).
//
//   runMeshOp(name, positions, index, opts)  name: closeCracks | removeSlivers | patchHoles | remeshEvenly | smoothSurface |
//                                              convexHull | convexPieces | mergeBodies | removeBlends (fillets and chamfers off: defeature.js) |
//                                              roundFaces (fewer facets on the round faces: roundfaces.js) |
//                                              removeCadFaces (whole CAD faces out, the gap patched and remeshed: cadcut.js) |
//                                              remeshCadFaces (CAD faces remeshed, nothing taken out: cadcut.js) |
//                                              cleanProfile (a straight profile made solid, its narrow gaps filled: profile.js)
//   runBoolean(kind, a, b, opts)              kind: union | subtract | intersect | without | split; a, b: { positions, index } in the same
//                                             space (b may be a list); split hands back the part inside B as `second`
// Both resolve with { ok, why?, positions, normals, index, ...the tool's own numbers }.
// opts.uv: the part's UV sets ({ uv: Float32Array, uv1: ... }, one pair per vertex of `positions`; for a boolean, of a.positions): the
// result then has them too, as `uvs`, carried from the part as it was (uvcarry.js); its vertices may be split where a UV seam runs.

import { closeCracks, removeSlivers, patchHoles } from './meshfix.js?v=4';
import { remeshEvenly } from './remesh.js?v=4';
import { removeCadFaces, remeshCadFaces } from './cadcut.js?v=2';
import { smoothSurface } from './smooth.js?v=3';
import { convexHull, convexPieces } from './convex.js?v=2';
import { removeBlends } from './defeature.js?v=4';
import { simplifyRoundFaces } from './roundfaces.js?v=1';
import { cleanProfile } from './profile.js?v=5';
import { manifoldReady, mergeBodies, booleanOf } from './booleans.js?v=3';
import { creasedNormals } from './voxel.js?v=2';
import { carryUvs } from './uvcarry.js?v=2';

const TOOLS = { closeCracks, removeSlivers, patchHoles, remeshEvenly, smoothSurface, convexHull, convexPieces, removeBlends, roundFaces: simplifyRoundFaces, removeCadFaces, remeshCadFaces, cleanProfile };

function shade(r, deg) {
  if (!r || r.ok === false) return r || { ok: false, why: 'nothing came back' };
  if (!r.index || !r.index.length) return { ...r, ok: false, why: r.why || 'nothing is left of it' };
  const g = creasedNormals(r.positions, r.index, deg ?? 30);
  return { ...r, ok: true, positions: g.positions, normals: g.normals, index: g.index };
}

// the UVs of the part as it was, carried onto the result (its positions, normals and index are replaced by the ones carryUvs gives)
function withUvs(r, srcP, srcI, sets) {
  if (!r || r.ok === false || !sets || !srcP || !r.positions) return r;
  const c = carryUvs({ srcP, srcI, sets, outP: r.positions, outN: r.normals, outI: r.index });
  return c ? { ...r, positions: c.positions, normals: c.normals, index: c.index, uvs: c.sets } : r;
}

export async function runMeshOp(name, positions, index, opts = {}) {
  const uv = opts.uv || null, srcP = uv ? positions.slice() : null, srcI = uv ? index.slice() : null;      // (copies: a tool may work in place)
  if (name === 'mergeBodies') return withUvs(shade(mergeBodies(await manifoldReady(), positions, index), opts.smoothDeg), srcP, srcI, uv);
  const fn = TOOLS[name];
  if (!fn) return { ok: false, why: 'no tool called ' + name };
  return withUvs(shade(fn(positions, index, opts), opts.smoothDeg), srcP, srcI, uv);
}

export async function runBoolean(kind, a, b, opts = {}) {
  const uv = opts.uv || null, srcP = uv ? a.positions.slice() : null, srcI = uv ? a.index.slice() : null;
  const r = booleanOf(await manifoldReady(), kind, a, b, opts);
  if (r.ok && r.empty) return { ok: false, why: kind === 'intersect' ? 'the parts do not overlap: nothing is left' : kind === 'split' ? 'B does not cut through A: A is wholly outside or inside it, so there is nothing to split' : 'nothing is left of it' };
  const main = withUvs(shade(r, opts.smoothDeg), srcP, srcI, uv);
  if (main && main.ok !== false && r.second) {                    // (split: the part inside B, shaded and with its UVs the same way)
    const s = withUvs(shade(r.second, opts.smoothDeg), srcP, srcI, uv);
    if (s && s.ok !== false) main.second = s; else delete main.second;
  }
  return main;
}
export { withUvs };
