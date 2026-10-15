// node tests/dissolve.test.mjs — dissolve.js (a point taken out, the surface closed over it) on shapes built here, with
// THREE.ShapeUtils as the triangulator, as the app passes it in.
import { ShapeUtils, Vector2 } from '../app/vendor/three/build/three.core.js';
import { buildTopology } from '../app/js/meshedit.js';
import { analysePolygons } from '../app/js/wirelines.js';
import { dissolvePoints, applyDissolve } from '../app/js/dissolve.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const triangulate = (contour, holes) => ShapeUtils.triangulateShape(contour.map(p => new Vector2(p[0], p[1])), holes.map(h => h.map(p => new Vector2(p[0], p[1]))));

// a flat n × n grid of unit squares (shared vertices), two triangles a square
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
const split = ({ pos, idx }) => { const p2 = [], i2 = []; for (const v of idx) { i2.push(p2.length / 3); p2.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); } return { pos: p2, idx: i2 }; };
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
const prep = (m) => {
  const pos = new Float32Array(m.pos), idx = new Uint32Array(m.idx), topo = buildTopology(pos, idx);
  return { pos, idx, weld: topo.weld, topo };
};
const every = (topo) => { const s = new Set(); for (let v = 0; v < topo.nVert; v++) s.add(v); return s; };

// ── a point in the middle of a flat polygon ──────────────────────────────
{
  const m = prep(plate(4)), lab = new Int32Array(m.idx.length / 3);          // one polygon
  const c = m.weld[2 * 5 + 2];
  const r = dissolvePoints(m.pos, m.idx, lab, m.weld, [c], { triangulate });
  ok(r.dissolved === 1 && r.trisRemoved === 6 && r.trisAdded === 4, `the point in the middle of a plate: 6 triangles round it become 4 (${r.trisRemoved} → ${r.trisAdded})`);
  const out = applyDissolve(m.idx, r);
  ok(Math.abs(area(m.pos, out.index) - 16) < 1e-6, 'the area is the same');
  ok(!out.index.includes(2 * 5 + 2), 'nothing uses the point any more');
  ok(faceNormals(m.pos, out.index).every(n => n[2] > 0.999), 'every triangle faces the way it did');
  ok([...Array(out.index.length / 3).keys()].every(t => new Set([out.index[t * 3], out.index[t * 3 + 1], out.index[t * 3 + 2]]).size === 3), 'no triangle has a corner twice');
  ok(new Set(out.poly).size === 1, 'still one polygon');
}
// ── every point inside a plate (what Select all + Dissolve does) ─────────
{
  const m = prep(plate(10)), lab = new Int32Array(m.idx.length / 3);
  const r = dissolvePoints(m.pos, m.idx, lab, m.weld, every(m.topo), { triangulate, allowStraight: false });
  const out = applyDissolve(m.idx, r);
  ok(r.dissolved === 81, `the 81 points inside a 10 × 10 plate go (${r.dissolved})`);
  ok(out.index.length / 3 === 38 && Math.abs(area(m.pos, out.index) - 100) < 1e-5, `200 → ${out.index.length / 3} triangles, same area`);
}
// ── points on straight runs ──────────────────────────────────────────────
{
  const m = prep(plate(10)), lab = new Int32Array(m.idx.length / 3);
  const r = dissolvePoints(m.pos, m.idx, lab, m.weld, every(m.topo), { triangulate });
  const out = applyDissolve(m.idx, r);
  const used = new Set(out.index);
  ok(out.index.length / 3 === 2 && used.size === 4, `a plate with its inside and its straight sides taken out is two triangles on four corners (${out.index.length / 3}, ${used.size})`);
  ok(Math.abs(area(m.pos, out.index) - 100) < 1e-5, 'the same area');
}
{
  // a hole in a plate: the sides of the hole and of the plate are straight runs, the corners stay
  const m = prep(plate(10, { skip: (i, j) => i >= 4 && i < 6 && j >= 4 && j < 6 })), lab = new Int32Array(m.idx.length / 3), before = area(m.pos, m.idx);
  const r = dissolvePoints(m.pos, m.idx, lab, m.weld, every(m.topo), { triangulate });
  const out = applyDissolve(m.idx, r);
  ok(Math.abs(area(m.pos, out.index) - before) < 1e-5, 'a plate with a hole: the same area, the hole is still a hole');
  ok(new Set(out.index).size === 8 && out.index.length / 3 === 8, `eight corners are left, and 8 triangles (${new Set(out.index).size}, ${out.index.length / 3})`);
}
// ── a box of six plates: closed before, closed after ─────────────────────
{
  const n = 6, faces = [
    plate(n, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] }), plate(n, { o: [0, 0, n], u: [0, 1, 0], v: [1, 0, 0] }),
    plate(n, { o: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }), plate(n, { o: [n, 0, 0], u: [0, 0, 1], v: [0, 1, 0] }),
    plate(n, { o: [0, 0, 0], u: [0, 0, 1], v: [1, 0, 0] }), plate(n, { o: [0, n, 0], u: [1, 0, 0], v: [0, 0, 1] }),
  ];
  const pos = [], idx = [], lab = [];
  faces.forEach((f, fi) => { const s = split(f), base = pos.length / 3; pos.push(...s.pos); for (const v of s.idx) idx.push(v + base); for (let t = 0; t < s.idx.length / 3; t++) lab.push(fi); });
  const m = prep({ pos, idx }), before = area(m.pos, m.idx);
  const r = dissolvePoints(m.pos, m.idx, Int32Array.from(lab), m.weld, every(m.topo), { triangulate });
  const out = applyDissolve(m.idx, r);
  ok(out.index.length / 3 === 12, `the box is 6 plates of two triangles (${out.index.length / 3})`);
  ok(Math.abs(area(m.pos, out.index) - before) < 1e-4, 'the same surface area');
  const open = analysePolygons(m.pos, out.index, 1);
  ok(open.adj.every(x => x >= 0), 'closed after: no edge is left open, no crack where two plates meet');
  ok(new Set(out.poly).size === 6, 'and it is still six polygons');
}
// ── a plate that is not flat is left alone (strict), and gives way when the user picks the point ──
{
  const m = prep(plate(4)); m.pos[(2 * 5 + 2) * 3 + 2] = 0.3;                  // the middle point pulled up
  const lab = new Int32Array(m.idx.length / 3), c = m.weld[2 * 5 + 2];
  const strict = dissolvePoints(m.pos, m.idx, lab, m.weld, [c], { triangulate });
  ok(strict.dissolved === 0 && strict.left === 1, 'a point off the plane stays when the surface must not change');
  const loose = dissolvePoints(m.pos, m.idx, lab, m.weld, [c], { triangulate, strict: false });
  const out = applyDissolve(m.idx, loose);
  ok(loose.dissolved === 1 && !out.index.includes(2 * 5 + 2), 'a picked point goes anyway (the surface closes over where it was)');
}
// ── merging: a point where four polygons meet ────────────────────────────
{
  const m = prep(plate(2)), lab = new Int32Array(8);                           // four squares, each its own polygon
  for (let t = 0; t < 8; t++) lab[t] = [0, 0, 1, 1, 2, 2, 3, 3][t];
  // plate(2) lists squares row by row: (0,0) (1,0) (0,1) (1,1), two triangles each
  const c = m.weld[1 * 3 + 1];
  const no = dissolvePoints(m.pos, m.idx, lab, m.weld, [c], { triangulate });
  ok(no.dissolved === 0, 'a point where four polygons meet is not taken out unless it is the user\'s pick');
  const yes = dissolvePoints(m.pos, m.idx, lab, m.weld, [c], { triangulate, allowMerge: true });
  const out = applyDissolve(m.idx, yes);
  ok(yes.dissolved === 1 && new Set(out.poly).size === 1, 'picked: the four polygons become one');
  ok(Math.abs(area(m.pos, out.index) - 4) < 1e-6, 'the same area');
}
// ── a corner of a plate: only when picked ────────────────────────────────
{
  const m = prep(plate(3)), lab = new Int32Array(m.idx.length / 3), c = m.weld[0];
  ok(dissolvePoints(m.pos, m.idx, lab, m.weld, [c], { triangulate }).dissolved === 0, 'a corner is not a point on a straight run: it stays');
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
