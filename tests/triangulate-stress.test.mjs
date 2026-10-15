// node tests/triangulate-stress.test.mjs — stress test of Fill holes, Untriangulate and Triangulate (even triangles) on solid
// plates with random square through-holes, built here: welded or with a vertex of its own for every face, smooth or flat normals.
// After each step the solid must still be closed (every edge shared by two triangles), have the same volume (the shape does
// not move), keep its winding, and, for Untriangulate, have fewer triangles; Triangulate must keep the count.
import { ShapeUtils, Vector2 } from '../app/vendor/three/build/three.core.js';
import { fillFlatHoles, applyHoleFill, flattenRimNormals } from '../app/js/holefill.js';
import { untriangulate, evenTriangles } from '../app/js/untriangulate.js';
import { findFloating } from '../app/js/floating.js';

let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.log('FAIL', msg); } };
const triangulate = (c, h) => ShapeUtils.triangulateShape(c.map(p => new Vector2(p[0], p[1])), h.map(x => x.map(p => new Vector2(p[0], p[1]))));
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// ── builder: W x H cells of size 1, thickness T, holes = [{i, j, s}] (s x s cells, through) ─────────────────────────────
function plate(W, H, holes, { split = false, smooth = false, T = 1 } = {}) {
  const inHole = (i, j) => holes.some(h => i >= h.i && i < h.i + h.s && j >= h.j && j < h.j + h.s);
  const quads = [];                                   // each: 4 corner positions, counter-clockwise seen from outside
  const add = (a, b, c, d) => quads.push([a, b, c, d]);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (inHole(i, j)) continue;
    add([i, j, T], [i + 1, j, T], [i + 1, j + 1, T], [i, j + 1, T]);                 // top
    add([i, j + 1, 0], [i + 1, j + 1, 0], [i + 1, j, 0], [i, j, 0]);                 // bottom
  }
  for (let i = 0; i < W; i++) { add([i, 0, 0], [i + 1, 0, 0], [i + 1, 0, T], [i, 0, T]); add([i + 1, H, 0], [i, H, 0], [i, H, T], [i + 1, H, T]); }
  for (let j = 0; j < H; j++) { add([W, j, 0], [W, j + 1, 0], [W, j + 1, T], [W, j, T]); add([0, j + 1, 0], [0, j, 0], [0, j, T], [0, j + 1, T]); }
  for (const h of holes) for (let k = 0; k < h.s; k++) {
    add([h.i + k + 1, h.j, 0], [h.i + k, h.j, 0], [h.i + k, h.j, T], [h.i + k + 1, h.j, T]);
    add([h.i + k, h.j + h.s, 0], [h.i + k + 1, h.j + h.s, 0], [h.i + k + 1, h.j + h.s, T], [h.i + k, h.j + h.s, T]);
    add([h.i, h.j + k, 0], [h.i, h.j + k + 1, 0], [h.i, h.j + k + 1, T], [h.i, h.j + k, T]);
    add([h.i + h.s, h.j + k + 1, 0], [h.i + h.s, h.j + k, 0], [h.i + h.s, h.j + k, T], [h.i + h.s, h.j + k + 1, T]);
  }
  const pos = [], idx = [], map = new Map();
  const vert = (p) => { if (split) { pos.push(...p); return pos.length / 3 - 1; } const k = p.join(','); let v = map.get(k); if (v === undefined) { v = pos.length / 3; map.set(k, v); pos.push(...p); } return v; };
  for (const q of quads) { const v = q.map(vert); idx.push(v[0], v[1], v[2], v[0], v[2], v[3]); }
  const P = new Float32Array(pos), I = new Uint32Array(idx), N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const u = [0, 1, 2].map(k => P[b * 3 + k] - P[a * 3 + k]), w = [0, 1, 2].map(k => P[c * 3 + k] - P[a * 3 + k]);
    let x = u[1] * w[2] - u[2] * w[1], y = u[2] * w[0] - u[0] * w[2], z = u[0] * w[1] - u[1] * w[0];
    const l = Math.hypot(x, y, z) || 1; if (!smooth) { x /= l; y /= l; z /= l; }
    for (const q of [a, b, c]) { N[q * 3] += x; N[q * 3 + 1] += y; N[q * 3 + 2] += z; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  return { P, I, N };
}
// ── checks ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const key = (P, v) => P[v * 3].toFixed(4) + ',' + P[v * 3 + 1].toFixed(4) + ',' + P[v * 3 + 2].toFixed(4);
function volume(P, I) {
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return v;
}
function openEdges(P, I) {                          // edges (by position) that do not have exactly one triangle each way
  const e = new Map(); let bad = 0;
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = key(P, I[t + k]), b = key(P, I[t + (k + 1) % 3]);
    if (a === b) continue;
    e.set(a + '>' + b, (e.get(a + '>' + b) || 0) + 1);
  }
  for (const [k, n] of e) { const [a, b] = k.split('>'); if (n !== 1 || e.get(b + '>' + a) !== 1) bad++; }
  return bad;
}
function degenerate(P, I) {
  let n = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-9) n++;
  }
  return n;
}
function randomHoles(W, H, count) {
  const holes = [];
  for (let tries = 0; holes.length < count && tries < 400; tries++) {
    const s = 1 + Math.floor(rnd() * 3), i = 2 + Math.floor(rnd() * (W - s - 4)), j = 2 + Math.floor(rnd() * (H - s - 4));
    if (holes.some(h => i < h.i + h.s + 2 && i + s + 2 > h.i && j < h.j + h.s + 2 && j + s + 2 > h.j)) continue;
    holes.push({ i, j, s });
  }
  return holes;
}

// ── the runs ────────────────────────────────────────────────────────────────────────────────────────────────────────────
let runs = 0;
const t0 = Date.now();
for (const split of [false, true]) for (const smooth of [false, true]) for (let n = 0; n < 6; n++) {
  const W = 14 + Math.floor(rnd() * 14), H = 14 + Math.floor(rnd() * 14), holes = randomHoles(W, H, 1 + Math.floor(rnd() * 5));
  const { P, I, N } = plate(W, H, holes, { split, smooth });
  const tag = `${W}x${H} ${holes.length} holes ${split ? 'split' : 'welded'} ${smooth ? 'smooth' : 'flat'}`;
  const solid = W * H * 1, withHoles = solid - holes.reduce((s, h) => s + h.s * h.s, 0);
  ok(Math.abs(volume(P, I) - withHoles) < 1e-3, tag + ': the test plate has the volume it should');
  ok(openEdges(P, I) === 0, tag + ': the test plate is closed');
  // Fill holes
  const res = fillFlatHoles(P, I, { maxSize: 6 });
  ok(res.holes === holes.length, `${tag}: every hole found (${res.holes} of ${holes.length})`);
  const I2 = applyHoleFill(I, res, null)[0].idx;
  ok(Math.abs(volume(P, I2) - solid) < 1e-3, tag + ': filled: volume is the whole plate');
  ok(openEdges(P, I2) === 0, tag + ': filled: still closed');
  ok(degenerate(P, I2) === 0, tag + ': filled: no triangle without area');
  // rim normals
  const N2 = N.slice(); const keys = new Set(); for (const v of res.caps) keys.add(P[v * 3] + ',' + P[v * 3 + 1] + ',' + P[v * 3 + 2]);
  flattenRimNormals(P, I2, N2, keys);
  // Untriangulate. A welded mesh shades its hard edges as averaged (tilted) normals: the default tolerance leaves such faces
  // alone, on purpose (joining them would change the shading), and 90 degrees joins them.
  const tol = split ? 5 : 90;
  const u = untriangulate(P, I2, { triangulate, normals: N2, normalTol: tol });
  ok(!!u, tag + ': untriangulate answered');
  if (u) {
    ok(u.index.length < I2.length, `${tag}: untriangulate: fewer triangles (${I2.length / 3} -> ${u.index.length / 3})`);
    ok(Math.abs(volume(P, u.index) - solid) < 1e-3, tag + ': untriangulate: same volume');
    ok(openEdges(P, u.index) === 0, tag + ': untriangulate: still closed');
    ok(degenerate(P, u.index) === 0, tag + ': untriangulate: no triangle without area');
    ok(u.poly.length === u.index.length / 3, tag + ': untriangulate: one polygon id per triangle');
    // Triangulate: even triangles, from the polygons' own triangles
    const e = evenTriangles(P, u.index);
    ok(!!e && e.index.length === u.index.length, tag + ': triangulate: same number of triangles');
    if (e) {
      ok(Math.abs(volume(P, e.index) - solid) < 1e-3, tag + ': triangulate: same volume');
      ok(openEdges(P, e.index) === 0, tag + ': triangulate: still closed');
      ok(degenerate(P, e.index) === 0, tag + ': triangulate: no triangle without area');
    }
    // Untriangulate again: nothing breaks, nothing is lost
    const u2 = untriangulate(P, u.index, { triangulate, normals: N2, normalTol: tol });
    ok(!u2 || (u2.index.length <= u.index.length && Math.abs(volume(P, u2.index) - solid) < 1e-3 && openEdges(P, u2.index) === 0), tag + ': untriangulate twice: still the same solid');
  }
  if (!split) { const d = untriangulate(P, I2, { triangulate, normals: N2 }); ok(!d || d.index.length === I2.length || d.index.length <= I2.length, tag + ': default tolerance never grows the mesh'); }
  // Untriangulate the plate as it came (holes still in): joins faces around the holes, the solid is the same
  const w = untriangulate(P, I, { triangulate, normals: N, normalTol: tol });
  ok(!w || (Math.abs(volume(P, w.index) - withHoles) < 1e-3 && openEdges(P, w.index) === 0), tag + ': untriangulate with the holes in: same solid');
  runs++;
}
// Triangulate on a plain plate (no vertex in the middle of a face): must keep it
{
  const { P, I } = plate(10, 10, [], {});
  const e = evenTriangles(P, I);
  ok(!e || (e.index.length === I.length && openEdges(P, e.index) === 0), 'triangulate on a plain plate keeps it');
}
// A flat plate whose outline touches itself (two holes that meet at one corner): the whole-outline rebuild cannot take it, the
// vertex-by-vertex way must still clear the vertices in the middle, with the same area and the same open edges.
{
  const n = 12, pos = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(i, j, 0);
  const at = (i, j) => j * (n + 1) + i, gone = (i, j) => (i === 4 && j === 4) || (i === 5 && j === 5);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { if (gone(i, j)) continue; idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1)); }
  const P = new Float32Array(pos), I = new Uint32Array(idx);
  const area = (ix) => { let A = 0; for (let t = 0; t < ix.length; t += 3) { const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3; A += Math.abs((P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[c] - P[a]) * (P[b + 1] - P[a + 1])) / 2; } return A; };
  const u = untriangulate(P, I, { triangulate });
  ok(!!u && u.stats.kept.touching === 0 && u.stats.rebuilt >= 1, 'pinched outline: rebuilt one vertex at a time (' + JSON.stringify(u && u.stats.kept) + ')');
  ok(u && u.index.length < I.length && Math.abs(area(u.index) - (n * n - 2)) < 1e-6, 'pinched outline: fewer triangles, same area');
  ok(u && degenerate(P, u.index) === 0, 'pinched outline: no triangle without area');
}
// Floating pieces: a plate with two loose specks (one a bit bigger) next to it; the plate is never removed
{
  const { P: P0, I: I0 } = plate(10, 10, [], {});
  const pos = Array.from(P0), idx = Array.from(I0);
  const speck = (x, s) => { const b = pos.length / 3; pos.push(x, 20, 0, x + s, 20, 0, x, 20 + s, 0, x, 20, s); idx.push(b, b + 2, b + 1, b, b + 1, b + 3, b, b + 3, b + 2, b + 1, b + 2, b + 3); };
  speck(0, 0.2); speck(5, 0.8);
  const P = new Float32Array(pos), I = new Uint32Array(idx);
  const a = findFloating(P, I, { maxSize: 0.5 }), b = findFloating(P, I, { maxSize: 1 }), c = findFloating(P, I, { maxSize: 100 });
  ok(a.removedPieces === 1 && a.removedTris === 4, 'floating: the small speck goes, the bigger one stays');
  ok(b.removedPieces === 2 && b.kept === I0.length / 3, 'floating: both specks go, the whole plate is left');
  ok(c.removedPieces === 2 && c.kept === I0.length / 3, 'floating: the biggest piece is never removed, however big the limit');
  ok(findFloating(P0, I0, { maxSize: 100 }).removedPieces === 0, 'floating: a part in one piece loses nothing');
}
// Degenerate input
ok(untriangulate(new Float32Array(0), new Uint32Array(0), { triangulate }) === null, 'empty mesh: untriangulate answers null');
ok(evenTriangles(new Float32Array(0), new Uint32Array(0)) === null, 'empty mesh: triangulate answers null');
{
  const P = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), I = new Uint32Array([0, 1, 2]);
  const u = untriangulate(P, I, { triangulate }); ok(!u || u.index.length === 3, 'one triangle stays one triangle');
}
// Big one: speed and no blow-up
{
  const W = 220, H = 220, holes = randomHoles(W, H, 60);
  const t1 = Date.now();
  const { P, I, N } = plate(W, H, holes, {});
  const res = fillFlatHoles(P, I, { maxSize: 6 });
  const I2 = applyHoleFill(I, res, null)[0].idx;
  const u = untriangulate(P, I2, { triangulate, normals: N });
  const e = evenTriangles(P, u.index);
  const ms = Date.now() - t1;
  ok(res.holes === holes.length, `big: ${res.holes} of ${holes.length} holes`);
  ok(u && e && openEdges(P, e.index) === 0 && Math.abs(volume(P, e.index) - W * H) < 1e-2, `big: ${I.length / 3} -> ${I2.length / 3} -> ${u.index.length / 3} triangles, closed, same volume (${ms} ms)`);
  ok(ms < 60000, `big: fast enough (${ms} ms)`);
}
console.log(`${runs} plates, ${checks} checks, ${fails} failed, ${Date.now() - t0} ms`);
process.exit(fails ? 1 : 0);
