// node tests/split.test.mjs — split.js on shapes built here: pieces, edges, faces, small pieces, material groups, and speed.
import * as THREE from '../app/vendor/three/build/three.core.js';
import { partition, buildChildGeometries } from '../app/js/split.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// geometry helpers: boxes moved about, merged into one indexed geometry (vertices of each box are its own)
function merge(geoms) {
  const pos = [], idx = [], uv = [], nrm = [];
  for (const g of geoms) {
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(base + i);
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  m.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  m.setIndex(idx);
  return m;
}
const box = (x, y, z, s = 1) => { const g = new THREE.BoxGeometry(s, s, s); g.translate(x, y, z); return g; };
const run = (g, o) => partition(g.attributes.position.array, g.index ? g.index.array : null, o);

// ── pieces ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const two = merge([box(0, 0, 0), box(5, 0, 0)]);
  ok(run(two, { method: 'vertex', epsAbs: 1e-9 }).count === 2, 'two boxes apart: 2 pieces (welded)');
  ok(run(two, { method: 'vertex', epsAbs: 0 }).count === 12, 'two boxes, index trusted: every face of every box is a piece (their vertices are their own)');
  const touch = merge([box(0, 0, 0), box(1, 1, 1)]);                                      // meet at one corner
  ok(run(touch, { method: 'vertex', epsAbs: 1e-9 }).count === 1, 'boxes that meet at a corner: one piece by vertices');
  ok(run(touch, { method: 'edge', epsAbs: 1e-9 }).count === 2, 'the same boxes by edges: two pieces');
  const near = merge([box(0, 0, 0), box(1.0005, 0, 0)]);                                  // 0.0005 apart
  ok(run(near, { method: 'vertex', epsAbs: 1e-9 }).count === 2, 'boxes 0.0005 apart: two pieces when the weld is tight');
  ok(run(near, { method: 'vertex', epsAbs: 0.01 }).count === 1, 'and one when the weld is 0.01');
  const apart = merge([box(0, 0, 0), box(5, 0, 0), box(10, 0, 0)]);
  ok(run(apart, { method: 'spatial', cellSize: 0.5 }).count === 3, 'spatial: three boxes apart, three pieces');
  ok(run(merge([box(0, 0, 0), box(0.5, 0, 0)]), { method: 'spatial', cellSize: 0.5 }).count === 1, 'spatial: overlapping boxes are one piece');
  ok(run(apart, { method: 'hybrid', epsAbs: 1e-9 }).count === 3, 'hybrid: three boxes apart, three pieces');
}

// ── faces ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const b = new THREE.BoxGeometry(1, 1, 1);
  ok(run(b, { method: 'faces', epsAbs: 1e-9, faceAngle: 20 }).count === 6, 'faces: a box is six faces');
  ok(run(b, { method: 'faces', epsAbs: 1e-9, faceAngle: 100 }).count === 1, 'faces: with 100 degrees the corners no longer count as creases');
  ok(run(b, { method: 'faces', epsAbs: 1e-9, faceAngle: 0 }).count === 6, 'faces: 0 degrees, still six (each face is flat)');
  const c = new THREE.CylinderGeometry(1, 1, 2, 24);
  ok(run(c, { method: 'faces', epsAbs: 1e-9, faceAngle: 20 }).count === 3, 'faces: a cylinder is its side and two caps');
  ok(run(c, { method: 'faces', epsAbs: 1e-9, faceAngle: 5 }).count === 26, 'faces: tighter than the facets of the side, every strip is a face (24 + 2 caps)');
  const two = merge([box(0, 0, 0), box(5, 0, 0)]);
  ok(run(two, { method: 'faces', epsAbs: 1e-9, faceAngle: 20 }).count === 12, 'faces: two boxes are twelve faces');
}

// ── small pieces ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const list = [box(0, 0, 0, 10)];
  for (let i = 0; i < 40; i++) list.push(box(20 + i * 2, 0, 0, 0.5));
  const g = merge(list);
  const all = run(g, { method: 'vertex', epsAbs: 1e-9 });
  ok(all.count === 41, 'one big box and forty small ones: 41 pieces');
  const few = run(g, { method: 'vertex', epsAbs: 1e-9, minTriangles: 13 });
  ok(few.count === 2 && few.sizes[1] === 40 * 12, 'pieces under 13 triangles make one part together: 2 parts');
  ok(run(g, { method: 'vertex', epsAbs: 1e-9, minTriangles: 12 }).count === 41, 'a piece of exactly 12 triangles is not small at 12');
  const onlySmall = merge([box(0, 0, 0), box(5, 0, 0), box(10, 0, 0)]);
  ok(run(onlySmall, { method: 'vertex', epsAbs: 1e-9, minTriangles: 100 }).count === 2, 'all pieces small: the largest still stays alone, the others join');
}

// ── the geometries ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const g = merge([box(0, 0, 0), box(5, 0, 0), box(10, 0, 0)]);
  const p = run(g, { method: 'vertex', epsAbs: 1e-9 });
  const kids = buildChildGeometries(THREE, g, p.labels, p.count);
  ok(kids.length === 3 && kids.every(k => k.index.count === 36 && k.attributes.position.count === 24), 'three boxes: three geometries of 12 triangles and 24 vertices');
  ok(kids.every(k => k.attributes.uv && k.attributes.normal && k.attributes.uv.count === 24), 'uv and normal are carried over');
  ok(kids[1].boundingBox.min.x > 4 && kids[1].boundingBox.max.x < 6, 'the second geometry is the box at x = 5');
  // two materials
  const m = merge([box(0, 0, 0), box(5, 0, 0)]);
  m.addGroup(0, 36, 0); m.addGroup(36, 36, 1);
  const q = run(m, { method: 'vertex', epsAbs: 1e-9 });
  const mk = buildChildGeometries(THREE, m, q.labels, q.count);
  ok(mk[0].groups.length === 1 && mk[0].groups[0].materialIndex === 0 && mk[1].groups.length === 1 && mk[1].groups[0].materialIndex === 1, 'material groups follow their triangles');
  // one piece with two materials: the groups stay in runs
  const w = new THREE.BoxGeometry(1, 1, 1);
  w.clearGroups(); w.addGroup(0, 18, 1); w.addGroup(18, 18, 0);
  const wl = new Int32Array(12);
  const wk = buildChildGeometries(THREE, w, wl, 1);
  ok(wk[0].groups.length === 2 && wk[0].groups[0].count + wk[0].groups[1].count === 36, 'a piece with two materials keeps both groups');
  // a mesh without an index
  const flat = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const f = merge([new THREE.BoxGeometry(1, 1, 1), box(5, 0, 0)]).toNonIndexed();
  const fp = partition(f.attributes.position.array, null, { method: 'vertex', epsAbs: 0 });
  ok(fp.count === 2, 'a mesh without an index: exact welding finds the two boxes');
  const fk = buildChildGeometries(THREE, f, fp.labels, fp.count);
  ok(fk.length === 2 && fk[0].index.count === 36, 'and its children are indexed');
}

// ── scale ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const list = [];
  for (let i = 0; i < 3000; i++) list.push(box((i % 20) * 3, Math.floor(i / 20 % 20) * 3, Math.floor(i / 400) * 3));
  const g = merge(list);
  let t0 = performance.now();
  const p = run(g, { method: 'vertex', epsAbs: 1e-9 });
  const tp = performance.now() - t0;
  t0 = performance.now();
  const kids = buildChildGeometries(THREE, g, p.labels, p.count);
  const tb = performance.now() - t0;
  ok(p.count === 3000 && kids.length === 3000, `3000 boxes (36000 triangles): 3000 parts (${tp.toFixed(0)} ms to find, ${tb.toFixed(0)} ms to build)`);
  ok(tp + tb < 4000, 'and quickly');
  // a big surface, one piece
  const big = new THREE.PlaneGeometry(1, 1, 700, 700);                                     // about a million triangles
  t0 = performance.now();
  const bp = run(big, { method: 'vertex', epsAbs: 1e-9 });
  const tb1 = performance.now() - t0;
  t0 = performance.now();
  const bf = run(big, { method: 'faces', epsAbs: 1e-9, faceAngle: 20 });
  const tb2 = performance.now() - t0;
  ok(bp.count === 1 && bf.count === 1, `a flat grid of ${big.index.count / 3} triangles is one piece and one face (${tb1.toFixed(0)} ms by vertices, ${tb2.toFixed(0)} ms by faces)`);
  ok(tb1 < 8000 && tb2 < 8000, 'and in a few seconds at most');
}

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
