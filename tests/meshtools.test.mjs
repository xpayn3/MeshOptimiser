// node tests/meshtools.test.mjs — meshtools.js: Planarize, Straighten, Weld, Fill (what each works out, on shapes built here).
import { ShapeUtils, Vector2 } from '../app/vendor/three/build/three.core.js';
import { buildTopology, buildPolygons, pairQuads } from '../app/js/meshedit.js';
import { planarize, straighten, weldPoints, collapseEdges, applyWeld, fillLoops } from '../app/js/meshtools.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const triangulate = (contour, holes) => ShapeUtils.triangulateShape(contour.map(p => new Vector2(p[0], p[1])), holes.map(h => h.map(p => new Vector2(p[0], p[1]))));

// a flat n × n grid of unit squares with shared vertices (an index), two triangles a square; `skip(i, j)` leaves a square out
function plate(n, { skip = () => false, z = () => 0 } = {}) {
  const pos = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(i, j, z(i, j));
  const at = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (skip(i, j)) continue;
    idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), at };
}
const read = (m, one = false) => {
  const topo = buildTopology(m.pos, m.idx);
  const nT = topo.nTri, polyOf = one ? new Int32Array(nT) : null;
  const q = one ? { polyOf, count: 1 } : pairQuads(topo);
  return { topo, pg: buildPolygons(topo, q.polyOf, q.count) };
};
const pointAt = (topo, x, y) => { for (let w = 0; w < topo.nVert; w++) { const r = topo.rep[w] * 3; if (Math.abs(topo.positions[r] - x) < 1e-6 && Math.abs(topo.positions[r + 1] - y) < 1e-6) return w; } return -1; };
const edgeBetween = (topo, a, b) => { for (let e = 0; e < topo.nEdge; e++) if ((topo.edgeV[e * 2] === a && topo.edgeV[e * 2 + 1] === b) || (topo.edgeV[e * 2] === b && topo.edgeV[e * 2 + 1] === a)) return e; return -1; };

// ── Planarize ────────────────────────────────────────────────────────────
{
  const n = 6, m = plate(n, { z: (i, j) => 0.05 * Math.sin(i * 1.7 + j * 0.9) });
  const { topo, pg } = read(m, true);
  const r = planarize(topo, pg, new Set([0]));
  ok(r.polygons === 1 && r.skipped === 0 && r.targets.size > 40, `a noisy plate that is one polygon: its points move onto a plane (${r.targets.size} of ${topo.nVert})`);
  // after the move the points lie on one plane
  const pts = []; for (let w = 0; w < topo.nVert; w++) pts.push(r.targets.get(w) || [topo.positions[topo.rep[w] * 3], topo.positions[topo.rep[w] * 3 + 1], topo.positions[topo.rep[w] * 3 + 2]]);
  const z0 = pts[0][2]; const spread = Math.max(...pts.map(p => Math.abs(p[2] - z0)));
  ok(spread < 0.01, `and they are flat now (spread ${spread.toExponential(1)}, was about 0.1)`);
  ok(r.maxMove < 0.1, `by a small move (${r.maxMove.toFixed(3)})`);
}
{
  // a panel cut into cells (each cell a polygon of its own): picked together they go onto one plane
  const n = 6, m = plate(n, { z: (i, j) => 0.05 * Math.sin(i * 1.7 + j * 0.9) });
  const { topo, pg } = read(m, false);
  const all = new Set(); for (let q = 0; q < pg.count; q++) all.add(q);
  const r = planarize(topo, pg, all);
  const pts = []; for (let w = 0; w < topo.nVert; w++) pts.push(r.targets.get(w) || [topo.positions[topo.rep[w] * 3], topo.positions[topo.rep[w] * 3 + 1], topo.positions[topo.rep[w] * 3 + 2]]);
  const spread = Math.max(...pts.map(p => p[2])) - Math.min(...pts.map(p => p[2]));
  ok(r.polygons === pg.count && spread < 0.01, `a panel of ${pg.count} cells: one plane for all (spread ${spread.toExponential(1)}, was about 0.1)`);
}
{
  // two sides of a box (a right angle between them) stay two planes
  const n = 4, pos = [], idx = [];
  const add = (f) => { const base = pos.length / 3; for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(...f(i, j)); const at = (i, j) => base + j * (n + 1) + i; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1)); };
  add((i, j) => [i, j, 0.01 * Math.sin(i + j)]); add((i, j) => [n, j, i]);       // the floor and a wall at x = n
  const m = { pos: new Float32Array(pos), idx: new Uint32Array(idx) }, { topo, pg } = read(m, false);
  const all = new Set(); for (let q = 0; q < pg.count; q++) all.add(q);
  const r = planarize(topo, pg, all);
  let wall = 0; for (let w = 0; w < topo.nVert; w++) { const p = r.targets.get(w) || [topo.positions[topo.rep[w] * 3], 0, 0]; if (Math.abs(topo.positions[topo.rep[w] * 3] - n) < 1e-6 && topo.positions[topo.rep[w] * 3 + 1] >= 0 && p[0] !== undefined) wall = Math.max(wall, Math.abs(p[0] - n)); }
  ok(r.skipped === 0 && wall < 0.2, 'a floor and a wall are not pulled into one plane');
}
{
  // a bent plate (one polygon over a 40° fold) is too much to flatten: left as it is
  const n = 6, h = Math.tan(40 * Math.PI / 180), m = plate(n, { z: (i) => (i > 3 ? (i - 3) * h : 0) });
  const { topo, pg } = read(m, true);
  const r = planarize(topo, pg, new Set([0]), { maxMove: 0.2 });
  ok(r.skipped === 1 && r.targets.size === 0, 'a polygon that would have to bend a long way is left alone and counted');
}
// ── Straighten ───────────────────────────────────────────────────────────
{
  const n = 6, m = plate(n), { topo } = read(m);
  m.pos[m.at(2, 0) * 3 + 1] = 0.2; m.pos[m.at(4, 0) * 3 + 1] = -0.15;               // two points off the line along the bottom side
  const t2 = buildTopology(m.pos, m.idx);
  const path = []; for (let i = 0; i < n; i++) path.push(edgeBetween(t2, pointAt(t2, i, i === 2 ? 0.2 : i === 4 ? -0.15 : 0) >= 0 ? pointAt(t2, i, i === 2 ? 0.2 : i === 4 ? -0.15 : 0) : -1, pointAt(t2, i + 1, i + 1 === 2 ? 0.2 : i + 1 === 4 ? -0.15 : 0)));
  ok(path.every(e => e >= 0), 'the six edges along the side are found');
  const r = straighten(t2, new Set(path));
  ok(r.paths === 1 && r.skipped === 0 && r.targets.size === 2, `a path of six edges: the two points off the line move (${r.targets.size})`);
  const ys = [...r.targets.values()].map(p => p[1]);
  ok(ys.every(y => Math.abs(y) < 1e-6), 'onto the straight line between its ends');
  ok(Math.abs(r.maxMove - 0.2) < 1e-6, `the furthest moves 0.2 (${r.maxMove})`);
}
{
  // a loop has no ends: left alone
  const m = plate(2), { topo } = read(m);
  const ring = [[0, 0, 1, 0], [1, 0, 2, 0], [2, 0, 2, 1], [2, 1, 2, 2], [2, 2, 1, 2], [1, 2, 0, 2], [0, 2, 0, 1], [0, 1, 0, 0]].map(([a, b, c, d]) => edgeBetween(topo, pointAt(topo, a, b), pointAt(topo, c, d)));
  const r = straighten(topo, new Set(ring));
  ok(r.paths === 0 && r.skipped === 1, 'a closed loop of edges has no ends: not straightened');
}
// ── Weld ─────────────────────────────────────────────────────────────────
{
  const m = plate(4), { topo } = read(m);
  const a = pointAt(topo, 1, 1), b = pointAt(topo, 2, 1);
  const cl = weldPoints(topo, new Set([a, b]));
  ok(cl.length === 1 && Math.abs(cl[0].target[0] - 1.5) < 1e-6 && Math.abs(cl[0].target[1] - 1) < 1e-6, 'two picked points are welded at their middle');
  const w = applyWeld(topo, cl);
  let gone = 0; for (const x of w.removed) gone += x;
  ok(gone === 2 && w.merged === 1, `an edge between two inside points: 2 triangles collapse with it (${gone})`);
  ok(w.positions[topo.rep[a] * 3] === 1.5 && w.positions[topo.rep[b] * 3] === 1.5, 'both stand at the middle now');
}
{
  const m = plate(4), { topo } = read(m);
  const picked = new Set([pointAt(topo, 0, 0), pointAt(topo, 0.0, 1), pointAt(topo, 3, 3), pointAt(topo, 4, 3)]);
  ok(weldPoints(topo, picked, 1.2).length === 2, 'with a distance, points that are close are welded in groups (two groups of two)');
  ok(weldPoints(topo, picked, 0).length === 1, 'without one, all of them go to one place');
}
{
  const m = plate(4), { topo } = read(m);
  const e = edgeBetween(topo, pointAt(topo, 2, 2), pointAt(topo, 3, 3));
  const cl = collapseEdges(topo, new Set([e]));
  const w = applyWeld(topo, cl);
  let gone = 0; for (const x of w.removed) gone += x;
  ok(cl.length === 1 && gone === 2, `a picked edge collapses to a point, the two triangles on it go (${gone})`);
}
// ── Fill ─────────────────────────────────────────────────────────────────
{
  const m = plate(6, { skip: (i, j) => i >= 2 && i < 4 && j >= 2 && j < 4 }), { topo } = read(m);
  const open = new Set(); for (let e = 0; e < topo.nEdge; e++) if (topo.edgeN[e] === 1) open.add(e);
  const rim = new Set([...open].filter(e => { const a = topo.edgeV[e * 2], b = topo.edgeV[e * 2 + 1]; const p = at2(a), q = at2(b); return p[0] >= 2 && p[0] <= 4 && p[1] >= 2 && p[1] <= 4 && q[0] >= 2 && q[0] <= 4 && q[1] >= 2 && q[1] <= 4; }));
  function at2(w) { const r = topo.rep[w] * 3; return [topo.positions[r], topo.positions[r + 1]]; }
  ok(rim.size === 8, `the hole's rim is 8 open edges (${rim.size})`);
  const r = fillLoops(topo, rim, triangulate);
  ok(r.loops.length === 1 && r.skipped === 0, 'one closed loop, none left over');
  const L = r.loops[0];
  ok(L.points.length === 8 && L.tris.length === 6, `8 rim points close with 6 triangles (${L.points.length}, ${L.tris.length})`);
  // the cap faces up like the plate, and has the hole's area
  let area = 0, up = true;
  for (const [i, j, k] of L.tris) {
    const A = at2(L.points[i]), B = at2(L.points[j]), C = at2(L.points[k]);
    const s = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    area += s / 2; if (s <= 0) up = false;
  }
  ok(up && Math.abs(area - 4) < 1e-6, `every cap triangle faces up and they cover the hole (area ${area})`);
  ok(L.normal[2] > 0.999, 'the cap normal is the plate\'s');
  // the rim picked only in part is not a loop
  const partial = new Set([...rim].slice(0, 5));
  ok(fillLoops(topo, partial, triangulate).loops.length === 0, 'a part of the rim is not a loop: nothing is filled');
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
