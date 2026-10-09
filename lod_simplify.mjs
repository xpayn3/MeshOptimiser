// lod_simplify.mjs - the mesh simplifier of step2glb.py --lod, when gltfpack is not installed.
//
// It runs meshoptimizer's simplifier from the app's own bundled copy
// (vendor/meshoptimizer/meshopt_simplifier.module.js, the file the browser
// app uses for Decimate), so a LOD made here is simplified by the same code
// the app uses. Node.js is the only thing it needs.
//
//   node lod_simplify.mjs <in.bin> <out.bin> <target-error>
//
// in.bin  (little endian): u32 meshCount, then per mesh
//           u32 vertexCount, u32 indexCount, u32 targetIndexCount,
//           f32 positions[vertexCount * 3], u32 indices[indexCount]
// out.bin (little endian): per mesh  u32 indexCount, u32 indices[indexCount]
//
// The meshes arrive welded. Borders are locked first so the outline of an open
// surface does not creep; when that stops the reduction well short of the
// target, it runs again without the lock and the smaller result is kept
// (the same two steps as mesh-worker.js).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [, , inPath, outPath, errArg] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node lod_simplify.mjs <in.bin> <out.bin> <target-error>');
  process.exit(2);
}
const targetError = Number.isFinite(parseFloat(errArg)) ? parseFloat(errArg) : 0.01;

// The module is an ES module in a .js file next to no package.json: older Node
// versions refuse that, so its source is run directly (it defines one global).
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'vendor', 'meshoptimizer', 'meshopt_simplifier.module.js'), 'utf8')
  .replace(/export\s*\{\s*MeshoptSimplifier\s*\}\s*;?\s*$/, '');
const S = new Function(src + '\n;return MeshoptSimplifier;')();
await S.ready;
if (!S.supported) { console.error('WebAssembly is not available in this Node.js'); process.exit(3); }

const buf = readFileSync(inPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);   // 4-byte aligned copy
const dv = new DataView(ab);
let off = 0;
const count = dv.getUint32(off, true); off += 4;
const out = [];
let total = 4 * count;
for (let m = 0; m < count; m++) {
  const nv = dv.getUint32(off, true), ni = dv.getUint32(off + 4, true), target = dv.getUint32(off + 8, true);
  off += 12;
  const pos = new Float32Array(ab, off, nv * 3); off += nv * 12;
  const idx = new Uint32Array(ab, off, ni); off += ni * 4;
  let res = idx;
  if (target < ni) {
    res = S.simplify(idx, pos, 3, target, targetError, ['LockBorder'])[0];
    if (res.length > target * 1.25) {
      const free = S.simplify(idx, pos, 3, target, targetError)[0];
      if (free.length < res.length) res = free;
    }
  }
  out.push(res);
  total += res.length * 4;
}
const outBuf = Buffer.alloc(total);
let o = 0;
for (const r of out) {
  outBuf.writeUInt32LE(r.length, o); o += 4;
  const bytes = new Uint8Array(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength));
  outBuf.set(bytes, o); o += bytes.length;
}
writeFileSync(outPath, outBuf);
