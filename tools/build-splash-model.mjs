// node tools/build-splash-model.mjs [dir with hero-mesh.json + hero-mesh.bin]
//
// Bakes the model drawn on the splash screen (index.html, "Start-up"): the rear derailleur of the site's opening
// picture, 43 parts and about 68,000 triangles, reduced to its sharp edges (the same 30 degree edges the CAD view draws),
// so the splash can draw it as 3D lines. Writes assets/splash-model.json (the parts) and assets/splash-model.bin
// (Int16 line-segment ends, 6 numbers per segment, parts one after the other).
//
// The source is the site repo's apps/meshoptimiser/hero-mesh.{json,bin}; pass its folder as the argument, or set SRC.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from '../vendor/three/build/three.core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || process.env.SRC || 'C:/Users/Luka/Downloads/Luka_site_v2/apps/meshoptimiser';
const meta = JSON.parse(fs.readFileSync(path.join(src, 'hero-mesh.json'), 'utf8'));
const bin = fs.readFileSync(path.join(src, 'hero-mesh.bin'));
const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const { min, span } = meta;
const ANGLE = 24, MIN_LEN = 0.3;                       // degrees between faces; segments shorter than this (model units) are left out

const parts = [], chunks = [];
let total = 0;
const all = new THREE.Box3();
for (const p of meta.parts) {
  const q = new Int16Array(buf, p.op, p.v * 3);
  const pos = new Float32Array(p.v * 3);
  for (let i = 0; i < p.v; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = min[k] + ((q[i * 3 + k] + 32768) / 65535) * span[k];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(p.big ? new Uint32Array(buf, p.oi, p.i) : new Uint16Array(buf, p.oi, p.i), 1));
  const e = new THREE.EdgesGeometry(geo, ANGLE).attributes.position.array;
  const keep = [];
  for (let i = 0; i < e.length; i += 6) {
    const dx = e[i] - e[i + 3], dy = e[i + 1] - e[i + 4], dz = e[i + 2] - e[i + 5];
    if (dx * dx + dy * dy + dz * dz < MIN_LEN * MIN_LEN) continue;
    for (let k = 0; k < 6; k++) keep.push(e[i + k]);
    all.expandByPoint(new THREE.Vector3(e[i], e[i + 1], e[i + 2]));
  }
  parts.push({ start: total, count: keep.length / 6, off: p.off, c: p.c });
  chunks.push(keep);
  total += keep.length / 6;
}
// the segment ends, quantised over the model's own box (about 0.002 units a step)
const lo = all.min.toArray(), sz = all.getSize(new THREE.Vector3()).toArray();
const out = new Int16Array(total * 6);
let w = 0;
for (const keep of chunks) for (let i = 0; i < keep.length; i++) out[w++] = Math.round(((keep[i] - lo[i % 3]) / sz[i % 3]) * 65535 - 32768);
const dir = path.join(here, '..', 'assets');
fs.writeFileSync(path.join(dir, 'splash-model.bin'), Buffer.from(out.buffer));
fs.writeFileSync(path.join(dir, 'splash-model.json'), JSON.stringify({ min: lo.map(n => +n.toFixed(3)), span: sz.map(n => +n.toFixed(3)), segments: total, parts }));
console.log(meta.parts.length + ' parts, ' + total + ' segments, ' + (out.byteLength / 1024).toFixed(0) + ' KB');
