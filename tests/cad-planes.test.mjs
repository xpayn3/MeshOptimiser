// node tests/cad-planes.test.mjs — the CAD plane faces of a STEP as exact flat regions: analysePolygons with a partial polygon map,
// Untriangulate with opts.poly, and Remove holes with opts.cadPoly. A face that the CAD file calls a plane is one region however its
// tessellation's normals wander; neighbouring plane faces are never joined, however flat they lie to each other.
import { ShapeUtils, Vector2 } from '../app/vendor/three/build/three.core.js';
import { analysePolygons } from '../app/js/wirelines.js';
import { untriangulate } from '../app/js/untriangulate.js';
import { fillFlatHoles } from '../app/js/holefill.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const triangulate = (contour, holes) => ShapeUtils.triangulateShape(contour.map(p => new Vector2(p[0], p[1])), holes.map(h => h.map(p => new Vector2(p[0], p[1]))));

// a flat n × n grid of unit squares from o along u and v (shared vertices); skip(i, j) leaves a square out; lift(i, j) raises a vertex
function plate(n, { o = [0, 0, 0], u = [1, 0, 0], v = [0, 1, 0], w = [0, 0, 1], skip = () => false, lift = () => 0 } = {}) {
  const pos = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const h = lift(i, j); pos.push(o[0] + u[0] * i + v[0] * j + w[0] * h, o[1] + u[1] * i + v[1] * j + w[1] * h, o[2] + u[2] * i + v[2] * j + w[2] * h); }
  const at = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (skip(i, j)) continue;
    idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  }
  return { pos, idx };
}
const join = (a, b) => ({ pos: [...a.pos, ...b.pos], idx: [...a.idx, ...b.idx.map(i => i + a.pos.length / 3)] });

// ── 1. two plates that meet at half a degree: by angle (1°) they are one polygon, by CAD they are two planes ──
{
  console.log('two plane faces at 0.5° (Untriangulate)');
  const n = 6, a = plate(n), ang = 0.5 * Math.PI / 180;
  const b = plate(n, { o: [n, 0, 0], u: [Math.cos(ang), 0, Math.sin(ang)] });     // hinged on the shared edge x = n
  const g = join(a, b);
  const P = new Float32Array(g.pos), I = new Uint32Array(g.idx), T = I.length / 3;
  const byAngle = analysePolygons(P, I, 1);
  ok(byAngle.polys === 1, 'by angle alone the two plates are one polygon (' + byAngle.polys + ')');
  const poly = new Int32Array(T); for (let t = 0; t < T; t++) poly[t] = t < T / 2 ? 0 : 1;
  const byCad = analysePolygons(P, I, 1, poly);
  ok(byCad.polys === 2, 'with the CAD faces they are two (' + byCad.polys + ')');
  // what one plate comes to on its own (its outline keeps every vertex: 24 points, 22 triangles)
  const one = untriangulate(new Float32Array(a.pos), new Uint32Array(a.idx), { triangulate, angleDeg: 1 });
  const u0 = untriangulate(P, I, { triangulate, angleDeg: 1 });
  const u1 = untriangulate(P, I, { triangulate, angleDeg: 1, poly });
  ok(one && u1 && u1.stats.rebuilt === 2 && u1.index.length === 2 * one.index.length, 'with the CAD faces each plate is rebuilt as if alone (' + (u1 && u1.index.length / 3) + ' = 2 × ' + (one && one.index.length / 3) + ')');
  ok(u0 && u0.index.length > u1.index.length, 'by angle the bent pair cannot be rebuilt whole, and more triangles stay (' + (u0 && u0.index.length / 3) + ')');
  // a partial map with sparse face numbers: one plate known, the other grown by angle, never into the known one; numbers compacted
  const part = new Int32Array(T).fill(-1); for (let t = 0; t < T / 2; t++) part[t] = 7;
  const mixed = analysePolygons(P, I, 1, part);
  ok(mixed.polys === 2 && mixed.poly[0] === 0 && mixed.poly[T - 1] === 1, 'a partial map: the known plate stays whole, the other grows on its own (' + mixed.polys + ')');
  const u2 = untriangulate(P, I, { triangulate, angleDeg: 1, poly: part });
  ok(u2 && u2.index.length === u1.index.length, 'and Untriangulate comes to the same with it (' + (u2 && u2.index.length / 3) + ')');
}

// ── 2. a hole in a plate whose tessellation wobbles: by normals it is not one face, by CAD it is a plane ──
{
  console.log('a square hole in a wobbling plane (Remove holes)');
  const n = 10;
  const wob = (i, j) => ((i * 7 + j * 13) % 5 - 2) * 0.012;           // ±0.024 units on unit squares: 1.4° to 2.7° between neighbours
  const g = plate(n, { skip: (i, j) => i === 4 && j === 5, lift: wob });
  const P = new Float32Array(g.pos), I = new Uint32Array(g.idx), T = I.length / 3;
  const opts = { maxSize: 3, through: true, blind: true, open: true, raised: false, maxFaceRatio: 0.4, maxPartRatio: 0.08 };
  const flat = fillFlatHoles(P, I, opts);
  ok(flat.holes === 0, 'by normals the plate falls apart into facets and the hole is not found (' + flat.holes + ')');
  const cadPoly = new Int32Array(T).fill(0);
  const cad = fillFlatHoles(P, I, { ...opts, cadPoly });
  ok(cad.holes === 1 && cad.open === 1 && cad.addedTris === 2, 'with the CAD face the hole is found and capped with two triangles (' + JSON.stringify({ holes: cad.holes, open: cad.open, added: cad.addedTris }) + ')');
  // a map of the wrong length is ignored, not trusted
  const bad = fillFlatHoles(P, I, { ...opts, cadPoly: new Int32Array(T - 1).fill(0) });
  ok(bad.holes === 0, 'a map of the wrong length is ignored');
}

// ── 4. the CAD face of every new triangle (opts.faceOf): the faces go on to what Untriangulate builds ──
{
  console.log('the CAD face of each new triangle');
  const n = 6;
  const g = join(plate(n), plate(n, { o: [n, 0, 0] }));          // two plane faces side by side: x 0 to 6 is face 0, x 6 to 12 is face 1
  const P = new Float32Array(g.pos), I = new Uint32Array(g.idx), T = I.length / 3;
  const poly = new Int32Array(T), faceOf = new Int32Array(T);
  for (let t = 0; t < T; t++) { poly[t] = t < T / 2 ? 0 : 1; faceOf[t] = poly[t]; }
  const faceAtCentre = (idx, t) => { const x = (P[idx[t * 3] * 3] + P[idx[t * 3 + 1] * 3] + P[idx[t * 3 + 2] * 3]) / 3; return x < n ? 0 : 1; };
  const check = (label, r) => {
    ok(r && r.face && r.face.length === r.index.length / 3, label + ': a face for every new triangle');
    let right = true; for (let t = 0; t < r.face.length; t++) if (r.face[t] !== faceAtCentre(r.index, t)) right = false;
    ok(right, label + ': every new triangle is on the face it lies in');
    let runs = 1; for (let t = 1; t < r.face.length; t++) if (r.face[t] !== r.face[t - 1]) runs++;
    ok(runs === 2, label + ': each face is one run of triangles (' + runs + ' runs)');
  };
  check('Untriangulate', untriangulate(P, I, { triangulate, angleDeg: 1, poly, faceOf }));
  const none = untriangulate(P, I, { triangulate, angleDeg: 1, poly });
  ok(none && none.face === null, 'no faceOf given: no faces are returned');
  // with points dissolved too (straight runs, nearly flat faces) the new triangles come at the end of the list: the faces still follow
  const dis = untriangulate(P, I, { triangulate, angleDeg: 1, poly, faceOf, straight: true, limitDeg: 3 });
  ok(dis && dis.face && dis.face.length === dis.index.length / 3, 'with points dissolved: a face for every new triangle');
  let right = true; for (let t = 0; t < dis.face.length; t++) if (dis.face[t] !== faceAtCentre(dis.index, t)) right = false;
  ok(right, 'with points dissolved: every new triangle is on the face it lies in');
}

console.log(fails ? '\n' + fails + ' check(s) failed' : '\nall checks passed');
process.exit(fails ? 1 : 0);
