// node tools/build-splash-glb.mjs <model.glb> [parts] [segments]
//
// Bakes the model drawn on the splash screen (index.html, "Start-up") from a plain GLB: its meshes are gathered into
// about 48 groups of parts that sit near each other (so they can fly in from where an exploded view would put them), each
// reduced to its sharp edges (the same kind of edges the CAD view draws), and the longest of them kept up to a budget so the
// splash stays small. Writes assets/splash-model.json (the parts) and assets/splash-model.bin (Int16 line-segment ends,
// 6 numbers per segment, parts one after the other), the same files tools/build-splash-model.mjs wrote for the derailleur.
//
// Z is up on the splash. This engine's file is already Z-up (its V opens towards +Z, the crankshaft runs along Y), so it is only
// centred, set on z = 0 and scaled to about 150 units across.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from '../app/vendor/three/build/three.core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) { console.error('usage: node tools/build-splash-glb.mjs <model.glb> [parts] [segments]'); process.exit(1); }
const K = +process.argv[3] || 48, BUDGET = +process.argv[4] || 22000;
const ANGLE = 30;
const SKIP = new RegExp(process.env.SKIP || 'chain', 'i');      // nodes (and what hangs under them) whose name matches are left out: the chain links glow far too much, small and crowded as they are                                       // degrees between faces for an edge

// ---- read the GLB (no extensions: plain buffers) ----
const raw = fs.readFileSync(file);
const jl = raw.readUInt32LE(12);
const gltf = JSON.parse(raw.toString('utf8', 20, 20 + jl));
const binStart = 20 + jl + 8;
const bin = raw.buffer.slice(raw.byteOffset + binStart, raw.byteOffset + raw.length);
if (gltf.extensionsRequired && gltf.extensionsRequired.length) throw new Error('needs extensions: ' + gltf.extensionsRequired);
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const read = (ai) => {
  const a = gltf.accessors[ai], bv = gltf.bufferViews[a.bufferView], n = NC[a.type], T = CT[a.componentType];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const out = new T(a.count * n);
  if (stride === n * T.BYTES_PER_ELEMENT) out.set(new T(bin, off, a.count * n));
  else { const dv = new DataView(bin); for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = new T(bin.slice(off + i * stride + k * T.BYTES_PER_ELEMENT, off + i * stride + (k + 1) * T.BYTES_PER_ELEMENT))[0]; }
  return out;
};

// ---- walk the nodes, one world matrix each ----
const meshes = [];                                      // { pos: Float32Array (world), idx }
const walk = (ni, parent, hidden = false) => {
  const n = gltf.nodes[ni], m = new THREE.Matrix4();
  hidden = hidden || SKIP.test(n.name || '');
  if (n.matrix) m.fromArray(n.matrix);
  else m.compose(new THREE.Vector3(...(n.translation || [0, 0, 0])), new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(n.scale || [1, 1, 1])));
  const w = parent.clone().multiply(m);
  if (n.mesh != null && !hidden) for (const p of gltf.meshes[n.mesh].primitives) {
    if ((p.mode ?? 4) !== 4 || p.attributes.POSITION == null) continue;
    const pos = read(p.attributes.POSITION), idx = p.indices != null ? read(p.indices) : null;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 3) { v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(w); pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z; }
    meshes.push({ pos, idx });
  }
  for (const c of n.children || []) walk(c, w, hidden);
};
const scene = gltf.scenes[gltf.scene ?? 0];
for (const r of scene.nodes) walk(r, new THREE.Matrix4());
console.log(meshes.length + ' meshes');

// ---- stand it up, centre it, scale to about 150 across ----
const box = new THREE.Box3();
for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) {
  const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2];
  m.pos[i] = x; m.pos[i + 1] = y; m.pos[i + 2] = z;
  box.expandByPoint(new THREE.Vector3(m.pos[i], m.pos[i + 1], m.pos[i + 2]));
}
const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), S = 150 / Math.max(size.x, size.y, size.z);
for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) {
  m.pos[i] = (m.pos[i] - ctr.x) * S; m.pos[i + 1] = (m.pos[i + 1] - ctr.y) * S; m.pos[i + 2] = (m.pos[i + 2] - box.min.z) * S;
}
// (the floor is z = 0; the model is centred over the origin in x and y)
const cm = meshes.map(m => { const b = new THREE.Box3(); for (let i = 0; i < m.pos.length; i += 3) b.expandByPoint(new THREE.Vector3(m.pos[i], m.pos[i + 1], m.pos[i + 2])); return b.getCenter(new THREE.Vector3()); });

// ---- group the meshes that sit near each other (k-means on their centres) ----
let cent = cm.filter((_, i) => i % Math.max(1, Math.floor(cm.length / K)) === 0).slice(0, K).map(c => c.clone());
const k = cent.length, group = new Int32Array(cm.length);
for (let it = 0; it < 12; it++) {
  cm.forEach((c, i) => { let b = 0, bd = 1e30; cent.forEach((q, j) => { const d = c.distanceToSquared(q); if (d < bd) { bd = d; b = j; } }); group[i] = b; });
  const sum = cent.map(() => new THREE.Vector3()), cnt = new Int32Array(k);
  cm.forEach((c, i) => { sum[group[i]].add(c); cnt[group[i]]++; });
  cent = cent.map((q, j) => cnt[j] ? sum[j].multiplyScalar(1 / cnt[j]) : q);
}

// ---- the sharp edges of each group ----
const segs = [];                                         // { g, len2, a: [6] }
for (let gi = 0; gi < k; gi++) {
  for (let mi = 0; mi < meshes.length; mi++) {
    if (group[mi] !== gi) continue;
    const { pos, idx } = meshes[mi];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (idx) geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const e = new THREE.EdgesGeometry(geo, ANGLE).attributes.position.array;
    for (let i = 0; i < e.length; i += 6) {
      const dx = e[i] - e[i + 3], dy = e[i + 1] - e[i + 4], dz = e[i + 2] - e[i + 5];
      segs.push({ g: gi, len2: dx * dx + dy * dy + dz * dz, a: [e[i], e[i + 1], e[i + 2], e[i + 3], e[i + 4], e[i + 5]] });
    }
    geo.dispose();
  }
}
console.log(segs.length + ' edges before the budget');
// the longest edges carry the shape: keep them up to the budget
segs.sort((p, q) => q.len2 - p.len2);
const kept = segs.slice(0, BUDGET);

const byGroup = Array.from({ length: k }, () => []);
for (const s of kept) byGroup[s.g].push(s.a);
const parts = [], chunks = [], all = new THREE.Box3();
let total = 0;
const mid = new THREE.Vector3(0, 0, 75);
byGroup.forEach((list, gi) => {
  if (!list.length) return;
  const c = cent[gi], d = c.clone().sub(mid);
  parts.push({ start: total, count: list.length, off: [+(d.x * 0.3).toFixed(3), +(d.y * 0.3).toFixed(3), +(d.z * 0.3).toFixed(3)], c: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)] });
  const flat = new Float32Array(list.length * 6);
  list.forEach((a, i) => { flat.set(a, i * 6); all.expandByPoint(new THREE.Vector3(a[0], a[1], a[2])); all.expandByPoint(new THREE.Vector3(a[3], a[4], a[5])); });
  chunks.push(flat); total += list.length;
});
const lo = all.min.toArray(), sz = all.getSize(new THREE.Vector3()).toArray();
const out = new Int16Array(total * 6);
let w = 0;
for (const keep of chunks) for (let i = 0; i < keep.length; i++) out[w++] = Math.round(((keep[i] - lo[i % 3]) / sz[i % 3]) * 65535 - 32768);
const dir = path.join(here, '..', 'app', 'assets');
fs.writeFileSync(path.join(dir, 'splash-model.bin'), Buffer.from(out.buffer));
fs.writeFileSync(path.join(dir, 'splash-model.json'), JSON.stringify({ min: lo.map(n => +n.toFixed(3)), span: sz.map(n => +n.toFixed(3)), segments: total, meshes: meshes.length, parts }));
console.log(parts.length + ' parts, ' + total + ' segments, ' + (out.byteLength / 1024).toFixed(0) + ' KB, box ' + sz.map(n => n.toFixed(0)).join(' x '));
