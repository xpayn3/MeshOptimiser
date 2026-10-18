// node tests/make-layers-glb.mjs — writes tests/fixtures/layers-test.glb: three parts the way the converter (step2glb.py) lays
// them out, a product node with the CAD metadata in its extras and the mesh in a `__geom` child under it. Bolt-1 and Bolt-2 are
// on the layer FASTENERS, Plate-1 is on none. For tests/e2e-mcp-tools.mjs (list_parts, select_by_layer, the Properties badge,
// save and reopen).
import { writeFileSync, mkdirSync } from 'node:fs';
const parts = [
  { name: 'Bolt-1', x: 0, extras: { layers: ['FASTENERS'], partNumber: 'BLT-0042' } },
  { name: 'Bolt-2', x: 2, extras: { layers: ['FASTENERS'], partNumber: 'BLT-0042' } },
  { name: 'Plate-1', x: 4, extras: { partNumber: 'PLT-0001' } },
];
const P = [], I = [];
parts.forEach((q, i) => {
  const x = q.x;
  // a small box: 8 corners, 12 triangles
  P.push(x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0, x, 0, 1, x + 1, 0, 1, x + 1, 1, 1, x, 1, 1);
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  for (const t of f) I.push(t[0], t[1], t[2]);      // (local to the part: each part has its own vertex accessor)
});
const pos = Buffer.from(new Float32Array(P).buffer), idx = Buffer.from(new Uint16Array(I).buffer);
const bin = Buffer.concat([pos, idx]);
const nodes = [], meshes = [], accessors = [], views = [];
parts.forEach((q, i) => {
  views.push({ buffer: 0, byteOffset: i * 8 * 12, byteLength: 8 * 12 }, { buffer: 0, byteOffset: pos.length + i * 36 * 2, byteLength: 36 * 2 });
  accessors.push({ bufferView: i * 2, componentType: 5126, count: 8, type: 'VEC3', min: [q.x, 0, 0], max: [q.x + 1, 1, 1] },
                 { bufferView: i * 2 + 1, componentType: 5123, count: 36, type: 'SCALAR' });
  meshes.push({ name: q.name, primitives: [{ attributes: { POSITION: i * 2 }, indices: i * 2 + 1 }] });
  nodes.push({ name: q.name, extras: q.extras, children: [parts.length + i] });
});
parts.forEach((q, i) => { nodes.push({ name: q.name + '__geom', mesh: i }); });
const json = {
  asset: { version: '2.0', generator: 'make-layers-glb' },
  scene: 0, scenes: [{ nodes: parts.map((_, i) => i), extras: { source_format: 'step', hierarchical: true } }],
  nodes, meshes, buffers: [{ byteLength: bin.length }], bufferViews: views, accessors,
};
let j = Buffer.from(JSON.stringify(json)); while (j.length % 4) j = Buffer.concat([j, Buffer.from(' ')]);
const total = 12 + 8 + j.length + 8 + bin.length;
const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.write('JSON', 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4);
mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('./fixtures/layers-test.glb', import.meta.url), Buffer.concat([head, jh, j, bh, bin]));
console.log('tests/fixtures/layers-test.glb written, ' + total + ' bytes');
