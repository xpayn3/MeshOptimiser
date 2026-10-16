// tools/site/bake-wipe.mjs - the data of the before/after wipe on the features page (site/wipe/).
//
//   node tools/site/bake-wipe.mjs [model.glb] [app folder] [name]
//
// With name `axle` (the truck axle, site/axle-web.glb, meshopt-compressed and quantised) it writes wipe/axle-lod.json and
// axle-lod.bin and does not copy the model: the page uses the file the Fasteners demo already loads.
//
// The model is the Gearbox Assy from Khronos's glTF-Sample-Models (default <app folder>/inbox/GearboxAssy.glb), copied as it is: that is the
// "before". The "after" is not a second model: it is the same vertices with a smaller index buffer, made by the app's own simplifier (the
// copy of meshoptimizer in <app folder>/vendor, the file the app's Decimate uses, with the borders locked first and then free, as in
// lod_simplify.mjs). One index set per level (half, a quarter, a tenth of the triangles), all in one file, so the page downloads the model
// once and swaps indices. gearbox-lod.json says, per level, where each primitive's new indices are in gearbox-lod.bin.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = process.argv[3] || join(here, '..', '..');
const NAME = process.argv[4] || 'gearbox';
const SRC = process.argv[2] || (NAME === 'axle' ? join(here, '..', '..', 'site', 'axle-web.glb') : join(APP, 'inbox', 'GearboxAssy.glb'));
const OUT = join(here, '..', '..', 'site', 'wipe');
// (the axle is made of many small parts that stop short of the target at the gearbox's limits, so it is let go further)
const LOOSE = NAME === 'axle' ? Number(process.env.LOOSE || 6) : 1;
const LEVELS = [
  { id: 'half', label: 'Half', ratio: 0.5, error: 0.02 * LOOSE },
  { id: 'quarter', label: 'A quarter', ratio: 0.25, error: 0.05 * LOOSE },
  { id: 'tenth', label: 'A tenth', ratio: 0.1, error: 0.1 * LOOSE },
];

const simSrc = readFileSync(join(APP, 'vendor', 'meshoptimizer', 'meshopt_simplifier.module.js'), 'utf8')
  .replace(/export\s*\{\s*MeshoptSimplifier\s*\}\s*;?\s*$/, '');
const S = new Function(simSrc + '\n;return MeshoptSimplifier;')();
await S.ready;
if (!S.supported) throw new Error('WebAssembly is not available in this Node.js');

const glb = readFileSync(SRC);
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = glb.subarray(binStart);
// EXT_meshopt_compression: a view that carries it is decoded into a buffer of its own
const { MeshoptDecoder } = await import(pathToFileURL(join(APP, 'vendor', 'three', 'examples', 'jsm', 'libs', 'meshopt_decoder.module.js')).href);
await MeshoptDecoder.ready;
const decoded = new Map();
function viewBytes(vi) {
  const v = json.bufferViews[vi], ext = v.extensions && v.extensions.EXT_meshopt_compression;
  if (!ext) return null;
  if (!decoded.has(vi)) {
    const out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, new Uint8Array(bin.buffer, bin.byteOffset + 0, bin.byteLength).subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter || 'NONE');
    decoded.set(vi, out);
  }
  return decoded.get(vi);
}

// an accessor's numbers as a typed array (positions as Float32, indices as Uint32); honours a view's byte stride
function read(accIndex) {
  const a = json.accessors[accIndex], v = json.bufferViews[a.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const size = { 5126: 4, 5125: 4, 5123: 2, 5122: 2, 5121: 1 }[a.componentType];
  const dec = viewBytes(a.bufferView);
  // (a compressed view is read from its decoded copy; the buffer 1 of such a file is only a placeholder)
  const base = dec ? (a.byteOffset || 0) : (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || comps * size;
  const src = dec || bin;
  const out = (a.componentType === 5126 || a.componentType === 5122) ? new Float32Array(a.count * comps) : new Uint32Array(a.count * comps);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
    const at = base + i * stride + c * size;
    out[i * comps + c] = a.componentType === 5126 ? dv.getFloat32(at, true) : a.componentType === 5122 ? Math.max(-1, dv.getInt16(at, true) / 32767) : a.componentType === 5125 ? dv.getUint32(at, true) : a.componentType === 5123 ? dv.getUint16(at, true) : dv.getUint8(at);
  }
  return out;
}

// how many nodes use each mesh (the assembly repeats its bolts and gears: 409,264 stored triangles are 646,064 on screen)
const uses = new Map();
for (const n of json.nodes) if (n.mesh !== undefined) uses.set(n.mesh, (uses.get(n.mesh) || 0) + 1);

const prims = [];
json.meshes.forEach((mesh, mi) => mesh.primitives.forEach((p, pi) => {
  if (p.indices === undefined || (p.mode !== undefined && p.mode !== 4)) return;
  prims.push({ mi, pi, pos: read(p.attributes.POSITION), idx: read(p.indices), n: uses.get(mi) || 0 });
}));
// The axle's vertices are split wherever the normal changes, which leaves every face a patch with an open edge the simplifier will not move.
// Its indices are pointed at the first vertex that sits at the same place (the vertex buffer is not touched), so the surface is one piece again.
if (NAME === 'axle') for (const p of prims) {
  const first = new Map(), canon = new Uint32Array(p.pos.length / 3);
  for (let i = 0; i < canon.length; i++) { const k = p.pos[i * 3] + ',' + p.pos[i * 3 + 1] + ',' + p.pos[i * 3 + 2]; if (!first.has(k)) first.set(k, i); canon[i] = first.get(k); }
  p.orig = p.idx; p.idx = Uint32Array.from(p.idx, (i) => canon[i]);
}
const triTotal = (get) => prims.reduce((s, p) => s + (get(p).length / 3) * p.n, 0);
const before = triTotal(p => p.idx);

// each primitive's indices are stored as 16-bit where its vertices allow it (4-byte aligned), 32-bit otherwise: [mesh, primitive, byte offset, count, width]
const chunks = [], levels = [];
let at = 0;
for (const L of LEVELS) {
  const entries = [];
  for (const p of prims) {
    let res = p.idx;
    const target = Math.max(12, Math.round((p.idx.length * L.ratio) / 3) * 3);
    if (target < p.idx.length) {
      res = S.simplify(p.idx, p.pos, 3, target, L.error, ['LockBorder'])[0];
      if (res.length > target * 1.25) {
        const free = S.simplify(p.idx, p.pos, 3, target, L.error)[0];
        if (free.length < res.length) res = free;
      }
      // (a part of the axle that still has far too many: let the error go, up to the size of the part)
      if (NAME === 'axle' && res.length > target * 1.25) {
        const wild = S.simplify(p.idx, p.pos, 3, target, 1, ['Sparse'])[0];
        if (wild.length < res.length) res = wild;
      }
    }
    p.last = res;
    const wide = p.pos.length / 3 > 65535, bytes = wide ? Uint32Array.from(res) : Uint16Array.from(res);
    const raw = new Uint8Array(bytes.buffer), pad = (4 - (raw.length % 4)) % 4;
    entries.push([p.mi, p.pi, at, res.length, wide ? 4 : 2]);
    chunks.push(raw, new Uint8Array(pad)); at += raw.length + pad;
  }
  levels.push({ id: L.id, label: L.label, ratio: L.ratio, tris: triTotal(p => p.last), prims: entries });
}
const lod = Buffer.alloc(at);
let o = 0;
for (const c of chunks) { lod.set(c, o); o += c.byteLength; }

mkdirSync(OUT, { recursive: true });
if (NAME === 'gearbox') copyFileSync(SRC, join(OUT, 'gearbox.glb'));
writeFileSync(join(OUT, NAME + '-lod.bin'), lod);
writeFileSync(join(OUT, NAME + '-lod.json'), JSON.stringify({ before, levels }));
console.log('before', before, 'triangles;', levels.map(l => `${l.id} ${l.tris} (${(l.tris / before * 100).toFixed(1)}%)`).join(', '), '; lod.bin', (lod.length / 1e6).toFixed(2), 'MB');
if (process.env.BAKE_DEBUG) { const r = prims.map((p) => [p.idx.length / 3, p.last.length / 3, p.pos.length / 3]).sort((a, b) => b[0] - a[0]).slice(0, 8); console.log(r.map((x) => x.join('→')).join(' | ')); }
