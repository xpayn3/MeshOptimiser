// node tests/make-repeats-glb.mjs <out.glb> [copies=400]
// Writes a GLB the way a tool that knows nothing about instancing would: three
// shapes, every copy its own mesh with its own buffers, half of them with the
// turn and shift already applied to the vertices (nodes at the identity), half
// with identical vertices and the placement on the node. Used to try repeats.js
// in the app (see tests/selftest.js, "repeats: …").
import fs from 'node:fs';

const [, , out = 'repeats.glb', copiesArg = '400'] = process.argv;
const COPIES = parseInt(copiesArg, 10);

function lathe(profile, n) {                       // [r, z] pairs turned about z; open ends
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; for (const [r, z] of profile) pos.push(r * Math.cos(a), r * Math.sin(a), z); }
  const m = profile.length;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; for (let k = 0; k + 1 < m; k++) { const a = i * m + k, b = j * m + k, c = j * m + k + 1, d = i * m + k + 1; idx.push(a, b, d, b, c, d); } }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}
const bolt = lathe([[0, 0], [4, 0], [4, 25], [6.5, 25], [6.5, 30], [0, 30]], 24);
const washer = lathe([[8, 0], [14, 0], [14, 1.6], [8, 1.6]], 32);
const bracket = (() => {                           // an L section with one corner cut: not round about any axis
  const P = [[0, 0], [60, 0], [60, 10], [10, 10], [10, 40], [0, 40]]; const h = 25;
  const pos = [], idx = [];
  for (const [x, y] of P) pos.push(x, y, 0, x, y, h);
  for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; idx.push(2 * i, 2 * j, 2 * i + 1, 2 * j, 2 * j + 1, 2 * i + 1); }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
})();

let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function quat() { const u = rnd(), v = rnd(), w = rnd(); return [Math.sqrt(1 - u) * Math.sin(2 * Math.PI * v), Math.sqrt(1 - u) * Math.cos(2 * Math.PI * v), Math.sqrt(u) * Math.sin(2 * Math.PI * w), Math.sqrt(u) * Math.cos(2 * Math.PI * w)]; }
function rotate(q, p) {                            // q = x,y,z,w
  const [x, y, z, w] = q;
  const tx = 2 * (y * p[2] - z * p[1]), ty = 2 * (z * p[0] - x * p[2]), tz = 2 * (x * p[1] - y * p[0]);
  return [p[0] + w * tx + (y * tz - z * ty), p[1] + w * ty + (z * tx - x * tz), p[2] + w * tz + (x * ty - y * tx)];
}
function normals(s) {
  const p = s.positions, n = new Float32Array(p.length);
  for (let i = 0; i < s.index.length; i += 3) {
    const [a, b, c] = [s.index[i] * 3, s.index[i + 1] * 3, s.index[i + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const k of [a, b, c]) { n[k] += f[0]; n[k + 1] += f[1]; n[k + 2] += f[2]; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

const buffers = [], views = [], accessors = [], meshes = [], nodes = [], materials = [], children = [];
let byteLen = 0;
const view = (arr, target) => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (b.length % 4)) % 4; buffers.push(b, Buffer.alloc(pad)); views.push({ buffer: 0, byteOffset: byteLen, byteLength: b.length, target }); byteLen += b.length + pad; return views.length - 1; };
const acc = (arr, type, ct, count, target, minmax) => { const a = { bufferView: view(arr, target), componentType: ct, count, type }; if (minmax) Object.assign(a, minmax); accessors.push(a); return accessors.length - 1; };
const colours = [[0.55, 0.55, 0.58, 1], [0.8, 0.62, 0.2, 1], [0.3, 0.4, 0.7, 1]];
colours.forEach(c => materials.push({ pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: 0.2, roughnessFactor: 0.6 } }));

function addMesh(name, shape, material, positions, node) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], positions[i + k]); hi[k] = Math.max(hi[k], positions[i + k]); }
  const tmp = { positions, index: shape.index };
  const pa = acc(positions, 'VEC3', 5126, positions.length / 3, 34962, { min: lo, max: hi });
  const na = acc(normals(tmp), 'VEC3', 5126, positions.length / 3, 34962);
  const ia = acc(shape.index, 'SCALAR', 5125, shape.index.length, 34963);
  meshes.push({ name, primitives: [{ attributes: { POSITION: pa, NORMAL: na }, indices: ia, material }] });
  nodes.push({ name, mesh: meshes.length - 1, ...node });
  children.push(nodes.length - 1);
}

const shapes = [bolt, washer, bracket];
for (let k = 0; k < COPIES; k++) {
  const si = k % 3, s = shapes[si], q = quat();
  const t = [rnd() * 2000 - 1000, rnd() * 2000 - 1000, rnd() * 2000 - 1000];
  const name = ['Bolt', 'Washer', 'Bracket'][si] + '_' + k;
  if (k % 2 === 0) {                               // placement baked into the vertices
    const p = new Float32Array(s.positions.length);
    for (let i = 0; i < p.length; i += 3) { const r = rotate(q, [s.positions[i], s.positions[i + 1], s.positions[i + 2]]); p[i] = r[0] + t[0]; p[i + 1] = r[1] + t[1]; p[i + 2] = r[2] + t[2]; }
    addMesh(name, s, si, p, {});
  } else {                                         // same numbers, placement on the node
    addMesh(name, s, si, new Float32Array(s.positions), { rotation: q, translation: t });
  }
}
nodes.push({ name: 'Assembly', children });
const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [nodes.length - 1] }], nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength: byteLen }] };
let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(buffers);
const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.write('JSON', 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4);
fs.writeFileSync(out, Buffer.concat([head, jh, js, bh, bin]));
const tris = shapes.map(s => s.index.length / 3);
console.log(`${out}: ${COPIES} meshes, ${(fs.statSync(out).size / 1048576).toFixed(2)} MB, triangles ${tris.map((t, i) => Math.ceil((COPIES - i) / 3) * t).reduce((a, b) => a + b, 0)}`);
