// node tests/make-uv-glb.mjs — writes tests/fixtures/uv-test.glb: one part with texture coordinates that shows every state of the UV
// layout card. Three flat squares side by side; A and B overlap in the map (B sits half over A), C is outside the 0–1 square.
import { writeFileSync, mkdirSync } from 'node:fs';
const quads = [
  { x: 0, uv: [0.0, 0.0, 0.5, 0.5] },
  { x: 2, uv: [0.25, 0.25, 0.75, 0.75] },
  { x: 4, uv: [1.2, 0.0, 1.8, 0.6] },
];
const P = [], U = [], I = [];
quads.forEach((q, i) => {
  const b = i * 4, [u0, v0, u1, v1] = q.uv;
  P.push(q.x, 0, 0, q.x + 1, 0, 0, q.x + 1, 1, 0, q.x, 1, 0);
  U.push(u0, v0, u1, v0, u1, v1, u0, v1);
  I.push(b, b + 1, b + 2, b, b + 2, b + 3);
});
const pos = Buffer.from(new Float32Array(P).buffer), uv = Buffer.from(new Float32Array(U).buffer), idx = Buffer.from(new Uint16Array(I).buffer);
const bin = Buffer.concat([pos, uv, idx]);
const json = {
  asset: { version: '2.0', generator: 'make-uv-glb' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'UV test' }],
  meshes: [{ name: 'UV test', primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2 }] }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: uv.length }, { buffer: 0, byteOffset: pos.length + uv.length, byteLength: idx.length }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 12, type: 'VEC3', min: [0, 0, 0], max: [5, 1, 0] },
    { bufferView: 1, componentType: 5126, count: 12, type: 'VEC2' },
    { bufferView: 2, componentType: 5123, count: 18, type: 'SCALAR' },
  ],
};
let j = Buffer.from(JSON.stringify(json)); while (j.length % 4) j = Buffer.concat([j, Buffer.from(' ')]);
const total = 12 + 8 + j.length + 8 + bin.length;
const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.write('JSON', 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4);
mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('./fixtures/uv-test.glb', import.meta.url), Buffer.concat([head, jh, j, bh, bin]));
console.log('tests/fixtures/uv-test.glb written, ' + total + ' bytes');
