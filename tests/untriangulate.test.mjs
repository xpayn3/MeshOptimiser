// node tests/untriangulate.test.mjs — checks wirelines.js and untriangulate.js on shapes built here,
// with THREE.ShapeUtils (the triangulator the app passes in).
import { ShapeUtils, Vector2 } from '../vendor/three/build/three.core.js';
import { analysePolygons, polygonEdges, wireIndex } from '../wirelines.js';
import { untriangulate } from '../untriangulate.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const triangulate = (contour, holes) => ShapeUtils.triangulateShape(contour.map(p => new Vector2(p[0], p[1])), holes.map(h => h.map(p => new Vector2(p[0], p[1]))));
const run = (pos, idx, o = {}) => untriangulate(new Float32Array(pos), idx ? new Uint32Array(idx) : null, { triangulate, ...o });

// ── builders ─────────────────────────────────────────────────────────────
// a flat n × n grid of unit squares in the plane spanned by u and v from o (shared vertices), two triangles a square;
// `skip(i, j)` leaves a square out (a hole)
function plate(n, { o = [0, 0, 0], u = [1, 0, 0], v = [0, 1, 0], skip = () => false } = {}) {
  const pos = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(o[0] + u[0] * i + v[0] * j, o[1] + u[1] * i + v[1] * j, o[2] + u[2] * i + v[2] * j);
  const at = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (skip(i, j)) continue;
    idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  }
  return { pos, idx };
}
// every triangle with vertices of its own (what a lot of CAD exports look like)
function split({ pos, idx }) {
  const p2 = [], i2 = [];
  for (const v of idx) { i2.push(p2.length / 3); p2.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
  return { pos: p2, idx: i2 };
}
function area(pos, idx) {
  let s = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return s;
}
const faceNormals = (pos, idx) => {
  const out = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    out.push([nx / l, ny / l, nz / l]);
  }
  return out;
};

// ── polygons and their outlines ──────────────────────────────────────────
{
  const m = plate(10);
  const a = analysePolygons(new Float32Array(m.pos), new Uint32Array(m.idx), 1);
  ok(a.polys === 1 && a.T === 200, 'a flat 10×10 plate is one polygon');
  const e = polygonEdges(a, m.pos.length / 3);
  ok(e.lines.length / 2 === 40, 'its outline is the 40 sides of the border (no triangle lines)');
  ok(wireIndex(new Uint32Array(m.idx), m.pos.length / 3).lines.length / 2 === 600, 'every triangle edge would be 600 lines');
  const s = split(m), as = analysePolygons(new Float32Array(s.pos), new Uint32Array(s.idx), 1);
  ok(as.polys === 1 && polygonEdges(as, s.pos.length / 3).lines.length / 2 === 40, 'the same when every triangle has vertices of its own');
}
{
  // two halves folded 3° against each other: one polygon only if the angle allows it
  const n = 4, h = Math.tan(3 * Math.PI / 180);
  const m = plate(n);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) if (i > n / 2) m.pos[(j * (n + 1) + i) * 3 + 2] = (i - n / 2) * h;
  const f = (deg) => analysePolygons(new Float32Array(m.pos), new Uint32Array(m.idx), deg).polys;
  ok(f(1) === 2 && f(5) === 1, 'a 3° fold: two polygons at 1°, one at 5°');
}
{
  // a surface that bends 0.6° a step does not drift into one polygon
  const steps = 30, pos = [], idx = [];
  let x = 0, z = 0, ang = 0;
  for (let i = 0; i <= steps; i++) { pos.push(x, 0, z, x, 1, z); x += Math.cos(ang); z += Math.sin(ang); ang += 0.6 * Math.PI / 180; }
  for (let i = 0; i < steps; i++) { const a = i * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
  const polys = analysePolygons(new Float32Array(pos), new Uint32Array(idx), 1).polys;
  ok(polys >= 8 && polys <= 16, `a gently bent strip breaks into polygons instead of drifting into one (${polys})`);
}

// ── untriangulate ────────────────────────────────────────────────────────
{
  const m = plate(10), before = area(m.pos, m.idx);
  const r = run(m.pos, m.idx);
  ok(r.stats.rebuilt === 1 && r.stats.trisAfter === 38 && r.index.length === 38 * 3, `a 10×10 plate: 200 → ${r.stats.trisAfter} triangles (4n − 2)`);
  ok(r.stats.vertsRemoved === 81, `81 vertices in its middle gone (${r.stats.vertsRemoved})`);
  ok(Math.abs(area(m.pos, r.index) - before) < 1e-6, 'the area is the same');
  ok(faceNormals(m.pos, r.index).every(n => n[2] > 0.999), 'every new triangle faces the way the old ones did');
  ok(new Set(r.poly).size === 1, 'all of them remember they are one polygon');
  // every vertex of the border is still used: nothing was lost on the sides
  const used = new Set(r.index);
  let border = 0, usedBorder = 0;
  for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) if (i === 0 || j === 0 || i === 10 || j === 10) { border++; if (used.has(j * 11 + i)) usedBorder++; }
  ok(border === usedBorder, 'every vertex on the border is still there');
}
{
  const m = plate(10, { skip: (i, j) => i >= 4 && i < 6 && j >= 4 && j < 6 }), before = area(m.pos, m.idx);
  const r = run(m.pos, m.idx);
  ok(r.stats.rebuilt === 1 && r.stats.trisAfter === 48, `a plate with a 2×2 hole: ${m.idx.length / 3} → ${r.stats.trisAfter} triangles (40 + 8 + 2 − 2)`);
  ok(Math.abs(area(m.pos, r.index) - before) < 1e-6, 'the hole is still a hole (same area)');
}
{
  // a box, six 6×6 plates with vertices of their own: closed before, closed after
  const n = 6, faces = [
    plate(n, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] }), plate(n, { o: [0, 0, n], u: [0, 1, 0], v: [1, 0, 0] }),
    plate(n, { o: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }), plate(n, { o: [n, 0, 0], u: [0, 0, 1], v: [0, 1, 0] }),
    plate(n, { o: [0, 0, 0], u: [0, 0, 1], v: [1, 0, 0] }), plate(n, { o: [0, n, 0], u: [1, 0, 0], v: [0, 0, 1] }),
  ];
  const pos = [], idx = [];
  for (const f of faces) { const s = split(f), base = pos.length / 3; pos.push(...s.pos); for (const v of s.idx) idx.push(v + base); }
  const before = area(pos, idx);
  const open0 = analysePolygons(new Float32Array(pos), new Uint32Array(idx), 1);
  const r = run(pos, idx);
  ok(r.stats.polygons === 6 && r.stats.rebuilt === 6, `a box of six plates: ${r.stats.rebuilt} of ${r.stats.polygons} rebuilt`);
  ok(r.stats.trisBefore === 432 && r.stats.trisAfter === 6 * (4 * n - 2), `${r.stats.trisBefore} → ${r.stats.trisAfter} triangles`);
  ok(Math.abs(area(pos, r.index) - before) < 1e-4, 'the same surface area');
  const after = analysePolygons(new Float32Array(pos), r.index, 1);
  ok(open0.adj.every(x => x >= 0) && after.adj.every(x => x >= 0), 'closed before and closed after: no edge is left open, no crack between plates');
  ok(after.polys === 6, 'and it is still six polygons');
  ok(polygonEdges(analysePolygons(new Float32Array(pos), r.index, 1, r.poly), pos.length / 3).lines.length / 2 === 12 * n, 'whose outlines are the 12 edges of the box, 6 sides each');
}
{
  // a plate the shading of which is not flat is left alone
  const m = plate(6), nor = [];
  for (let i = 0; i < m.pos.length / 3; i++) nor.push(0.5, 0, Math.sqrt(0.75));         // 30° off the plane's normal
  const r = run(m.pos, m.idx, { normals: new Float32Array(nor) });
  ok(r.stats.rebuilt === 0 && r.stats.kept.shading === 1 && r.stats.trisAfter === r.stats.trisBefore, 'vertex normals that are not the plane\'s: left as it was');
  const flat = []; for (let i = 0; i < m.pos.length / 3; i++) flat.push(0, 0, 1);
  ok(run(m.pos, m.idx, { normals: new Float32Array(flat) }).stats.rebuilt === 1, 'vertex normals along the plane: rebuilt');
}
{
  // not flat: a bump in the middle of a plate within the angle is not flattened
  const m = plate(8);
  m.pos[(4 * 9 + 4) * 3 + 2] = 0.01;                                                  // one vertex 0.01 off a plate 8 across (about 1.2e-3 of its size)
  const r = run(m.pos, m.idx, { angleDeg: 5 });
  ok(r.stats.rebuilt === 0 && r.stats.kept.curved >= 1, 'a vertex off the plane: nothing moves, the plate is kept');
}
{
  // curved surface: the side of a cylinder has no vertex in the middle of any plate: left alone
  const seg = 24, pos = [], idx = [];
  for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2; pos.push(Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 1); }
  for (let i = 0; i < seg; i++) { const a = i * 2, b = ((i + 1) % seg) * 2; idx.push(a, b, b + 1, a, b + 1, a + 1); }
  const r = run(pos, idx);
  ok(r.stats.rebuilt === 0 && r.stats.trisAfter === 2 * seg && r.stats.polygons === seg, `a cylinder's side: ${seg} plates of two triangles, nothing to remove`);
}
{
  // the same box turned some odd way in space and held in 32 bits: no edge is exactly straight any more
  const n = 8, faces = [
    plate(n, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] }), plate(n, { o: [0, 0, n], u: [0, 1, 0], v: [1, 0, 0] }),
    plate(n, { o: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }), plate(n, { o: [n, 0, 0], u: [0, 0, 1], v: [0, 1, 0] }),
    plate(n, { o: [0, 0, 0], u: [0, 0, 1], v: [1, 0, 0] }), plate(n, { o: [0, n, 0], u: [1, 0, 0], v: [0, 0, 1] }),
  ];
  const pos = [], idx = [];
  for (const f of faces) { const s = split(f), base = pos.length / 3; pos.push(...s.pos); for (const v of s.idx) idx.push(v + base); }
  // rotate about an arbitrary axis by 0.7 rad, scale to a few hundred units, move away from the origin
  const ax = [0.3, -0.5, 0.8], al = Math.hypot(...ax), k = ax.map(x => x / al), c = Math.cos(0.7), sn = Math.sin(0.7);
  const rotated = [];
  for (let i = 0; i < pos.length; i += 3) {
    const p = [pos[i], pos[i + 1], pos[i + 2]], d = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
    const cr = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]];
    for (let j = 0; j < 3; j++) rotated.push((p[j] * c + cr[j] * sn + k[j] * d * (1 - c)) * 37.3 + 1234.5 + j * 77);
  }
  const f32 = new Float32Array(rotated), before = area(f32, idx);
  const r = untriangulate(f32, new Uint32Array(idx), { triangulate });
  ok(r.stats.rebuilt === 6 && r.stats.trisAfter === 6 * (4 * n - 2), `turned and in 32 bits: ${r.stats.rebuilt} of 6 plates rebuilt, ${r.stats.trisBefore} → ${r.stats.trisAfter} triangles`);
  ok(Math.abs(area(f32, r.index) - before) < before * 1e-5, 'the same surface area');
  ok(analysePolygons(f32, r.index, 1).adj.every(x => x >= 0), 'still closed: no cracks between the plates');
}
{
  // no index
  const m = split(plate(5)), r = run(m.pos, null);
  ok(r.stats.rebuilt === 1 && r.stats.trisAfter === 18, 'a mesh without an index works the same');
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
