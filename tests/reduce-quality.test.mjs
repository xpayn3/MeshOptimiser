// node tests/reduce-quality.test.mjs — how far the reducer moves a real CAD surface (about half a minute).
//
// The three heaviest parts of the Scania V8 (site/chat-scania.glb, Draco) are reduced to 10 % the way the app does it since 2026-10-17:
// welded by position first (what _weldForReduction does), then reduceIndex with the sharp-edge lock. The worst distance between the
// old surface and the new one (triangle centres of each against the other) must stay under a limit set a little above what was
// measured when this was fixed (1.05, 10.3 and 4.5 mm on parts about 1.2 m across; before the fix 9.1, 73 and 24.5 mm, and the
// second part's borders tore: 98 border edges became 11). The borders must still be there.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from '../app/vendor/three/build/three.core.js';
import { MeshoptSimplifier as S } from '../app/vendor/meshoptimizer/meshopt_simplifier.module.js';
import { reduceIndex } from '../app/js/simplify-core.js';
await S.ready; S.useExperimentalFeatures = true;
const draco = await createRequire(import.meta.url)('./draco-node.cjs')();

let failed = 0;
const ok = (c, msg) => { if (!c) { failed++; console.log('  FAIL ' + msg); } else console.log('  ok   ' + msg); };

const buf = fs.readFileSync(new URL('../site/chat-scania.glb', import.meta.url));
const jl = buf.readUInt32LE(12), j = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
const bl = buf.readUInt32LE(20 + jl), bin = buf.subarray(28 + jl, 28 + jl + bl);
const nameOfMesh = new Map(); for (const n of j.nodes || []) if (n.mesh !== undefined && !nameOfMesh.has(n.mesh)) nameOfMesh.set(n.mesh, (n.extras && n.extras.soName) || n.name || '?');
function decodePrimitive(p) {
  const ext = p.extensions && p.extensions.KHR_draco_mesh_compression;
  const bv = j.bufferViews[ext.bufferView], bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const decoder = new draco.Decoder(), dbuf = new draco.DecoderBuffer(); dbuf.Init(bytes, bytes.length);
  const mesh = new draco.Mesh(); const st = decoder.DecodeBufferToMesh(dbuf, mesh); if (!st.ok()) throw new Error('draco: ' + st.error_msg());
  const n = mesh.num_points(), f = mesh.num_faces();
  const a = decoder.GetAttributeByUniqueId(mesh, ext.attributes.POSITION), out = new draco.DracoFloat32Array(); decoder.GetAttributeFloatForAllPoints(mesh, a, out);
  const positions = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) positions[i] = out.GetValue(i); draco.destroy(out);
  const index = new Uint32Array(f * 3), ia = new draco.DracoInt32Array();
  for (let i = 0; i < f; i++) { decoder.GetFaceFromMesh(mesh, i, ia); index[i * 3] = ia.GetValue(0); index[i * 3 + 1] = ia.GetValue(1); index[i * 3 + 2] = ia.GetValue(2); }
  draco.destroy(ia); draco.destroy(mesh); draco.destroy(dbuf); draco.destroy(decoder);
  return { positions, index };
}
function weldByPosition(P, I) {
  const map = new Map(), out = [], remap = new Int32Array(P.length / 3);
  for (let v = 0; v < P.length / 3; v++) { const k = P[v * 3].toFixed(4) + ',' + P[v * 3 + 1].toFixed(4) + ',' + P[v * 3 + 2].toFixed(4); let w = map.get(k); if (w === undefined) { w = out.length / 3; map.set(k, w); out.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); } remap[v] = w; }
  return { positions: new Float32Array(out), index: Uint32Array.from(I, (v) => remap[v]) };
}
function openEdges(P, I) {
  const key = (v) => P[v * 3].toFixed(4) + ',' + P[v * 3 + 1].toFixed(4) + ',' + P[v * 3 + 2].toFixed(4), cnt = new Map();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = key(I[t + e]), b = key(I[t + (e + 1) % 3]); if (a === b) continue; const k = a < b ? a + '|' + b : b + '|' + a; cnt.set(k, (cnt.get(k) || 0) + 1); }
  let open = 0; for (const n of cnt.values()) if (n === 1) open++; return open;
}
function grid(P, I, cell) {
  const g = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const xs = [P[I[t] * 3], P[I[t + 1] * 3], P[I[t + 2] * 3]], ys = [P[I[t] * 3 + 1], P[I[t + 1] * 3 + 1], P[I[t + 2] * 3 + 1]], zs = [P[I[t] * 3 + 2], P[I[t + 1] * 3 + 2], P[I[t + 2] * 3 + 2]];
    for (let x = Math.floor(Math.min(...xs) / cell); x <= Math.floor(Math.max(...xs) / cell); x++) for (let y = Math.floor(Math.min(...ys) / cell); y <= Math.floor(Math.max(...ys) / cell); y++) for (let z = Math.floor(Math.min(...zs) / cell); z <= Math.floor(Math.max(...zs) / cell); z++) { const kk = x + ',' + y + ',' + z; const l = g.get(kk); if (l) l.push(t); else g.set(kk, [t]); }
  }
  return { g, cell };
}
const a3 = new THREE.Vector3(), b3 = new THREE.Vector3(), c3 = new THREE.Vector3(), p3 = new THREE.Vector3(), q3 = new THREE.Vector3(), tri = new THREE.Triangle();
function closest(P, I, G, x, y, z, cap) {
  let best = cap; const cx = Math.floor(x / G.cell), cy = Math.floor(y / G.cell), cz = Math.floor(z / G.cell);
  for (let r = 0; r <= 3; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
      const l = G.g.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz)); if (!l) continue;
      for (const t of l) { a3.fromArray(P, I[t] * 3); b3.fromArray(P, I[t + 1] * 3); c3.fromArray(P, I[t + 2] * 3); tri.set(a3, b3, c3); tri.closestPointToPoint(p3.set(x, y, z), q3); const d = q3.distanceTo(p3); if (d < best) best = d; }
    }
    if (best <= r * G.cell) break;
  }
  return best;
}
function worstDeviation(P0, I0, P1, I1, diag) {
  const cell = diag / 40, G0 = grid(P0, I0, cell), G1 = grid(P1, I1, cell);
  const pick = (P, I, cap) => { const out = []; const step = Math.max(1, Math.floor(I.length / 3 / cap)); for (let t = 0; t < I.length; t += 3 * step) out.push([(P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3, (P[I[t] * 3 + 1] + P[I[t + 1] * 3 + 1] + P[I[t + 2] * 3 + 1]) / 3, (P[I[t] * 3 + 2] + P[I[t + 1] * 3 + 2] + P[I[t + 2] * 3 + 2]) / 3]); return out; };
  let worst = 0;
  for (const s of pick(P0, I0, 3000)) worst = Math.max(worst, closest(P1, I1, G1, s[0], s[1], s[2], cell * 4));
  for (const s of pick(P1, I1, 3000)) worst = Math.max(worst, closest(P0, I0, G0, s[0], s[1], s[2], cell * 4));
  return worst;
}

const limits = { 'Engine_V8-XT-72A_1_001277__geom': 2.0, 'Engine_V8-XT-01_1_000002__geom': 14, 'Engine_V8-XT-06A_1_000011__geom': 7 };
const rows = (j.meshes || []).map((m, mi) => ({ mi, tris: m.primitives.reduce((s, p) => s + (p.indices !== undefined ? j.accessors[p.indices].count / 3 : 0), 0) })).sort((a, b) => b.tris - a.tris).slice(0, 3);
for (const { mi } of rows) {
  const name = nameOfMesh.get(mi), part = decodePrimitive(j.meshes[mi].primitives[0]);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < part.positions.length; v += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], part.positions[v + k]); hi[k] = Math.max(hi[k], part.positions[v + k]); }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const w = weldByPosition(part.positions, part.index);
  const tris0 = part.index.length / 3, target = Math.max(3, Math.floor(tris0 * 0.1) * 3);
  const r = reduceIndex(S, w.index, w.positions, target, null, { sharp: 40 });
  const worst = worstDeviation(part.positions, part.index, w.positions, r.idx, diag);
  const open0 = openEdges(part.positions, part.index), open1 = openEdges(w.positions, r.idx);
  const lim = limits[name] || 14;
  ok(r.idx.length <= target * 1.25, name + ': 10 % reached (' + r.idx.length / 3 + ' of ' + target / 3 + ')');
  ok(worst <= lim, name + ': the surface moved at most ' + worst.toFixed(2) + ' (limit ' + lim + ', size ' + diag.toFixed(0) + ')');
  ok(open1 === open0, name + ': the borders are as they were (' + open1 + ' of ' + open0 + ' border edges)');
}
if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('reduce-quality: all checks passed');
