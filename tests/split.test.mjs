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

// ── welding within a tolerance ──────────────────────────────────────────────────────────────────────────────────────────
{
  // two boxes 5 apart, every corner doubled with a drift of one float step on the duplicate: with the old rounding to a grid about
  // 2 % of the doubled corners fell on both sides of a cell border and their faces came loose
  const base = merge([box(0, 0, 0), box(5, 0, 0)]);
  const p = base.attributes.position.array, idx = base.index.array;
  const pos2 = new Float32Array(p.length * 2); pos2.set(p);
  for (let i = 0; i < p.length; i++) { const v = p[i]; const up = v + Math.abs(v) * 6e-8 + 1e-9; pos2[p.length + i] = up; }
  const idx2 = new Uint32Array(idx.length);
  const nv = p.length / 3;
  for (let t = 0; t < idx.length / 3; t++) for (let k = 0; k < 3; k++) idx2[t * 3 + k] = idx[t * 3 + k] + ((t * 7 + k) % 3 === 0 ? nv : 0);   // a third of the corners use the drifted copy
  let loose = 0;
  for (let trial = 0; trial < 40; trial++) {
    const shift = trial * 0.0137;                                          // the mesh at many places on the grid
    const pp = pos2.map((v, i) => v + shift);
    const r = partition(pp, idx2, { method: 'vertex', epsAbs: 1e-5 });
    if (r.count !== 2) loose++;
  }
  ok(loose === 0, 'drifted duplicates weld at every place on the grid (' + loose + ' of 40 positions came loose)');
  const two = merge([box(0, 0, 0), box(5, 0, 0)]);
  ok(partition(two.attributes.position.array, two.index.array, { method: 'vertex', epsAbs: 1e-5 }).count === 2, 'the tolerance joins nothing 5 apart');
  const near = merge([box(0, 0, 0), box(1.00001, 0, 0)]);
  ok(partition(near.attributes.position.array, near.index.array, { method: 'vertex', epsAbs: 1.2e-5 }).count === 1, 'and joins boxes 0.00001 apart at a tolerance of 0.000012');
  ok(partition(near.attributes.position.array, near.index.array, { method: 'vertex', epsAbs: 2e-6 }).count === 2, 'but not at a tolerance of 0.000002');
}

// ── bodies ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const touchCorner = merge([box(0, 0, 0), box(1, 1, 1)]);
  ok(run(touchCorner, { method: 'bodies', epsAbs: 1e-9 }).count === 2, 'bodies: two boxes that meet at a corner are two');
  const touchEdge = merge([box(0, 0, 0), box(1, 1, 0)]);                                  // share the edge x=0.5,y=0.5
  ok(run(touchEdge, { method: 'bodies', epsAbs: 1e-9 }).count === 2, 'bodies: two boxes that share an edge are two (vertex: ' + run(touchEdge, { method: 'vertex', epsAbs: 1e-9 }).count + ', edge: ' + run(touchEdge, { method: 'edge', epsAbs: 1e-9 }).count + ')');
  ok(run(touchEdge, { method: 'edge', epsAbs: 1e-9 }).count === 1, '(edge connectivity joins them, as it always did)');
  const stacked = merge([box(0, 0, 0), box(0, 1, 0)]);                                    // share the whole face y=0.5
  const st = run(stacked, { method: 'bodies', epsAbs: 1e-9 });
  ok(st.count === 2 && st.sizes[0] === 12 && st.sizes[1] === 12, 'bodies: two boxes stacked face to face are two, each with its 12 triangles');
  const row = merge([box(0, 0, 0), box(1, 0, 0), box(2, 0, 0), box(1, 1, 0)]);           // a row of three and one on top of the middle
  ok(run(row, { method: 'bodies', epsAbs: 1e-9 }).count === 4, 'bodies: four boxes in contact are four');
  // a solid with a T-junction: a box whose top face is cut in two with a shared edge the other faces do not have points on
  {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const p = Array.from(g.attributes.position.array), tris = [];
    for (let t = 0; t < p.length / 9; t++) tris.push([p.slice(t * 9, t * 9 + 3), p.slice(t * 9 + 3, t * 9 + 6), p.slice(t * 9 + 6, t * 9 + 9)]);
    const top = tris.filter(tr => tr.every(v => v[1] > 0.49)), rest = tris.filter(tr => !tr.every(v => v[1] > 0.49));
    // the top as four triangles round its centre: their edges to the corners are T-junctions against the side faces' edges? no:
    // the sides keep the corner-to-corner edge, the top has corner-to-centre edges plus the same outer edges, so this is a fine
    // top on a coarse side only if the outer edges are split: split each outer edge at its middle
    const c = [0, 0.5, 0], corners = [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]];
    const fine = [];
    for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4], m = [(a[0] + b[0]) / 2, 0.5, (a[2] + b[2]) / 2]; fine.push([a, m, c], [m, b, c]); }
    const all = rest.concat(fine);
    const pos = new Float32Array(all.flat(2));
    const r = partition(pos, null, { method: 'bodies', epsAbs: 1e-9 });
    ok(r.count === 1, 'bodies: a box whose top is finer than its sides (T-junctions along the top edges) stays one body (' + r.count + ')');
    const r2 = partition(pos, null, { method: 'edge', epsAbs: 1e-9 });
    ok(r2.count === 2, '(edge connectivity cuts the top off: ' + r2.count + ')');
  }
  // a sliver (two corners at one place) at a seam does not become a part of its own
  {
    const g = merge([box(0, 0, 0), box(0, 1, 0)]);
    const p = Array.from(g.attributes.position.array), idx = Array.from(g.index.array);
    const n = p.length / 3;
    p.push(-0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5);                                // a zero-area triangle along a seam edge
    idx.push(n, n + 1, n + 2);
    const r = partition(new Float32Array(p), new Uint32Array(idx), { method: 'bodies', epsAbs: 1e-9 });
    ok(r.count === 2, 'bodies: a zero-area triangle on the seam goes with a neighbour (' + r.count + ' pieces)');
  }
  // a single stray triangle at a seam is a crumb, not a part
  {
    const g = merge([box(0, 0, 0), box(0, 1, 0)]);
    const p = Array.from(g.attributes.position.array), idx = Array.from(g.index.array);
    const n = p.length / 3;
    p.push(-0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0, 0.9, -0.9);                                   // a flap off the seam edge, wound the wrong way round
    idx.push(n + 1, n, n + 2);
    const r = partition(new Float32Array(p), new Uint32Array(idx), { method: 'bodies', epsAbs: 1e-9 });
    ok(r.count === 2, 'bodies: a flap of one triangle on the seam goes with a neighbour (' + r.count + ' pieces)');
  }
  const closed = new THREE.CylinderGeometry(1, 1, 2, 24);
  ok(run(closed, { method: 'bodies', epsAbs: 1e-9 }).count === 1, 'bodies: a cylinder is one body');
  const plane = new THREE.PlaneGeometry(1, 1, 10, 10);
  ok(run(plane, { method: 'bodies', epsAbs: 1e-9 }).count === 1, 'bodies: an open sheet is one body');
  ok(partition(new Float32Array(0), null, { method: 'bodies' }).count === 0, 'bodies: nothing in, nothing out');
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
