// node tests/stacked-copies.test.mjs — the Stacked copies finder (_findStackedCopies, sliced out of app.js) on built parts, with a stub of the state it reads.
// What counts as a copy: the same place and the same shape, whatever the vertex welding or (near mode) the tessellation; a nudge within the tolerance; instances in one place. Not a copy: a different shape with equal counts, another size, a hidden original.
import * as THREE from '../app/vendor/three/build/three.core.js';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../app/js/app.js', import.meta.url), 'utf8');
const a = src.indexOf('function _stkMeanWorld(p) {'), b = src.indexOf('function _wireStacked() {');
if (a < 0 || b < a) { console.error('anchors not found'); process.exit(1); }
const code = src.slice(a, b);
const state = { parts: [], geomByHash: new Map() };
const _resolvePartWorldMatrix = (p) => p.world.clone();
const { _findStackedCopies } = new Function('THREE', 'state', '_resolvePartWorldMatrix', code + '\nreturn { _findStackedCopies };')(THREE, state, _resolvePartWorldMatrix);

// geometry makers (positions as flat arrays)
const box = (w, h, d, seg = 1) => new THREE.BoxGeometry(w, h, d, seg, seg, seg).toNonIndexed();
const cyl = (r, h, n) => new THREE.CylinderGeometry(r, r, h, n).toNonIndexed();
let nextId = 1, hashN = 0;
function part(geom, world = new THREE.Matrix4(), opts = {}) {
  const hash = opts.hash || ('h' + (hashN++));
  if (!state.geomByHash.has(hash)) { geom.computeBoundingBox(); state.geomByHash.set(hash, geom); }
  const g = state.geomByHash.get(hash);
  const bbox = g.boundingBox.clone().applyMatrix4(world);
  const p = { partId: nextId++, hash, world, bbox, deleted: false, visible: opts.visible !== false, triCount: (g.index ? g.index.count : g.attributes.position.count) / 3, vertCount: g.attributes.position.count, name: opts.name || ('part ' + nextId) };
  state.parts.push(p);
  return p;
}
const T = (x = 0, y = 0, z = 0) => new THREE.Matrix4().makeTranslation(x, y, z);
const reset = () => { state.parts.length = 0; state.geomByHash.clear(); nextId = 1; };
const run = (tol = 0.5, near = false) => { const r = _findStackedCopies(tol, near); return { extra: r.extra, groups: r.groups }; };
let diffs = 0;
const say = (name, r, expect) => { if (JSON.stringify(r.extra) !== JSON.stringify(expect)) diffs++; console.log((JSON.stringify(r.extra) === JSON.stringify(expect) ? '  ok   ' : '  DIFF ') + name + '  → extra ' + JSON.stringify(r.extra) + (JSON.stringify(r.extra) === JSON.stringify(expect) ? '' : '  (expected ' + JSON.stringify(expect) + ')')); };

// A. an exact duplicate: same geometry, same place
reset(); const g1 = box(20, 10, 5); part(g1); part(g1.clone()); part(box(20, 10, 5), T(100, 0, 0));
say('A exact duplicate (and a third one elsewhere)', run(), [2]);

// B. the same part exported twice, one with its vertices welded (8 vertices) and one not (24): same triangles, same place
reset(); part(new THREE.BoxGeometry(20, 10, 5)); part(new THREE.BoxGeometry(20, 10, 5).toNonIndexed());
console.log('     counts: ' + state.parts.map(p => p.triCount + 't/' + p.vertCount + 'v').join(' vs '));
say('B welded vs unwelded twin, exact mode', run(), [2]);
say('B welded vs unwelded twin, near mode', run(0.5, true), [2]);

// C. a re-tessellated twin: the same cylinder with 16 and 20 segments (triangles within 25%), same place
reset(); part(cyl(5, 20, 16)); part(cyl(5, 20, 20));
console.log('     counts: ' + state.parts.map(p => p.triCount + 't/' + p.vertCount + 'v').join(' vs '));
say('C re-tessellated symmetric twin, near mode', run(0.5, true), [2]);
say('C …exact mode (should not: the counts differ)', run(), []);

// D. a re-tessellated twin whose extra triangles sit on one side (a fillet meshed finer): the vertex mean moves, the surface does not
reset();
{
  const g = box(20, 10, 5).clone();                              // plain
  part(g);
  // the twin: the same box, but one face (x = +10) split into a 6x6 grid: 72 triangles instead of 2 (+70 of 12 → within 25%? no: 82 vs 12)
  // keep it within 25%: a box with 2x2x2 segments (48 tris) vs 1x1x1 with one face 4x4 (12 - 2 + 32 = 42 tris)
  const base = new THREE.BoxGeometry(20, 10, 5, 2, 2, 2).toNonIndexed();
  const twin = new THREE.BoxGeometry(20, 10, 5, 1, 1, 1).toNonIndexed();
  const pos = Array.from(twin.attributes.position.array);
  // drop the +x face (the first 6 values x 3... BoxGeometry order: px, nx, py, ny, pz, nz; each face 2 tris = 18 floats)
  pos.splice(0, 18);
  // add the +x face as a 4x4 grid
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const y0 = -5 + i * 2.5, y1 = y0 + 2.5, z0 = -2.5 + j * 1.25, z1 = z0 + 1.25;
    pos.push(10, y0, z1, 10, y0, z0, 10, y1, z1, 10, y0, z0, 10, y1, z0, 10, y1, z1);
  }
  const t2 = new THREE.BufferGeometry(); t2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  reset(); part(base); part(t2);
  console.log('     counts: ' + state.parts.map(p => p.triCount + 't/' + p.vertCount + 'v').join(' vs '));
  say('D re-tessellated twin, denser on one side, near mode', run(0.5, true), [2]);
  say('D …near mode, 2 % tolerance', run(2, true), [2]);
}

// E. nudged copies: the same part 0.3 % and 2 % of its diagonal away
reset(); { const g = box(20, 10, 5); const d = Math.hypot(20, 10, 5); part(g); part(g.clone(), T(d * 0.003, 0, 0)); part(g.clone(), T(0, d * 0.02, 0)); }
say('E nudged 0.3 % found at 0.5 %, the 2 % one not', run(0.5), [2]);
say('E …at 3 % both', run(3), [2, 3]);

// F. instances: one geometry, two instance matrices in the same place, a third elsewhere
reset(); { const g = cyl(3, 12, 16); part(g, T(0, 0, 0), { hash: 'bolt' }); part(g, T(0, 0, 0), { hash: 'bolt' }); part(g, T(50, 0, 0), { hash: 'bolt' }); }
say('F two instances in one place, one elsewhere', run(), [2]);

// G. a mirrored twin (scale -1 about x): same box, same counts, same mean
reset(); { const g = box(20, 10, 5); part(g); part(g.clone(), new THREE.Matrix4().makeScale(-1, 1, 1)); }
say('G mirrored twin in the same place (counted as a copy)', run(), [2]);

// H. a different part in the same place with the same counts: a 20x10x5 box and a 20x10x5 box turned 90° about z (box differs)
reset(); { part(box(20, 10, 5)); part(box(10, 20, 5)); }
say('H a different part with equal counts in the same place: not a copy', run(), []);

// I. three copies, lowest id kept; the kept one hidden → nothing is found
reset(); { const g = box(20, 10, 5); part(g); part(g.clone()); part(g.clone()); }
say('I three copies: two extra', run(), [2, 3]);
reset(); { const g = box(20, 10, 5); part(g, T(), { visible: false }); part(g.clone()); }
say('I the original hidden: the visible copy is not reported', run(), []);

// J. a copy scaled by 2 in the same place: not a copy
reset(); { const g = box(20, 10, 5); part(g); part(g.clone(), new THREE.Matrix4().makeScale(2, 2, 2)); }
say('J a copy twice the size: not a copy', run(), []);

if (diffs) { console.error(diffs + ' case(s) differ'); process.exit(1); }
console.log('stacked-copies: all cases as expected');
