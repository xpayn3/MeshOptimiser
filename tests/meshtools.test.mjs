// node tests/meshtools.test.mjs — meshtools.js: Planarize, Straighten, Weld, Fill (what each works out, on shapes built here).
import { ShapeUtils, Vector2 } from '../app/vendor/three/build/three.core.js';
import { buildTopology, buildPolygons, pairQuads } from '../app/js/meshedit.js';
import { planarize, straighten, weldPoints, collapseEdges, applyWeld, fillLoops, fillOpen, closeBetween } from '../app/js/meshtools.js';

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

// ── Close open edges (fillOpen) ──────────────────────────────────────────
{
  // a plate with a square hole: two rims, the hole (8 edges) and the plate's own outline (24); both are capped, without a pick
  const m = plate(6, { skip: (i, j) => i >= 2 && i < 4 && j >= 2 && j < 4 }), { topo } = read(m);
  const r = fillOpen(topo, triangulate);
  ok(r.open === 32 && r.rims === 2 && r.loops.length === 2 && r.skipped === 0 && r.branching === 0, `32 open edges make 2 rims and both are capped (${r.open}, ${r.rims}, ${r.loops.length})`);
  const hole = r.loops.find(L => L.points.length === 8), rim = r.loops.find(L => L.points.length === 24);
  ok(hole && hole.tris.length === 6 && rim && rim.tris.length === 22, 'the hole closes with 6 triangles, the outline with 22');
  // the hole's cap faces up like the plate; the outline's cap faces down (it closes the sheet from below)
  ok(hole.normal[2] > 0.999 && rim.normal[2] < -0.999, 'each cap faces the way that closes the surface');
  // a size limit leaves the big rim alone
  const r2 = fillOpen(topo, triangulate, { maxSize: 4 });
  ok(r2.loops.length === 1 && r2.tooLarge === 1 && r2.loops[0].points.length === 8, 'with a size limit only the hole is capped and the outline is counted as too large');
  // a closed surface has nothing to do
  const cube = { pos: new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]), idx: new Uint32Array([0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7]) };
  const r3 = fillOpen(read(cube).topo, triangulate);
  ok(r3.open === 0 && r3.loops.length === 0, 'a closed cube has no open edges and nothing is capped');
}
{
  // two square holes that touch at a corner: their rims meet at that point, so neither is a rim of its own; the outline still closes
  const m = plate(6, { skip: (i, j) => (i === 2 && j === 2) || (i === 3 && j === 3) }), { topo } = read(m);
  const r = fillOpen(topo, triangulate);
  ok(r.rims === 1 && r.loops.length === 1 && r.loops[0].points.length === 24 && r.branching === 8, `rims that meet at a point are left (branching ${r.branching}) and the outline is capped`);
}

// ── Close between two rims (closeBetween) ────────────────────────────────
// an open tube wall round the z axis: n segments from z0 to z1; `out` true = faces away from the axis (a pipe), false = faces it (a bore)
function tube(cx, cy, r, z0, z1, n, out) {
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; pos.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z0, cx + r * Math.cos(a), cy + r * Math.sin(a), z1); }
  for (let i = 0; i < n; i++) {
    const a0 = i * 2, a1 = ((i + 1) % n) * 2;        // bottom points; +1 = top
    if (out) idx.push(a0, a1, a1 + 1, a0, a1 + 1, a0 + 1); else idx.push(a0, a1 + 1, a1, a0, a0 + 1, a1 + 1);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
const join = (A, B) => { const off = A.pos.length / 3; return { pos: new Float32Array([...A.pos, ...B.pos]), idx: new Uint32Array([...A.idx, ...Array.from(B.idx, i => i + off)]) }; };
const openEdgesNear = (topo, test) => { const out = new Set(); for (let e = 0; e < topo.nEdge; e++) { if (topo.edgeN[e] !== 1) continue; const p = at3(topo, topo.edgeV[e * 2]), q = at3(topo, topo.edgeV[e * 2 + 1]); if (test(p) && test(q)) out.add(e); } return out; };
const at3 = (topo, w) => { const r = topo.rep[w] * 3; return [topo.positions[r], topo.positions[r + 1], topo.positions[r + 2]]; };
const triNormal = (P, [a, b, c]) => { const p = P[a], q = P[b], r = P[c]; const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]; return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; };
{
  // a pipe with its middle missing: the top rim of the lower piece and the bottom rim of the upper piece, 12 and 16 segments
  const m = join(tube(0, 0, 1, 0, 1, 12, true), tube(0, 0, 1, 2, 3, 16, true)), { topo } = read(m);
  const rims = openEdgesNear(topo, p => p[2] > 0.5 && p[2] < 2.5);
  ok(rims.size === 28, `the two rims in the middle are 28 open edges (${rims.size})`);
  const r = closeBetween(topo, rims, triangulate);
  ok(r.rims === 2 && r.loops.length === 1 && r.loops[0].tris.length === 28, `two rims are stitched with 28 triangles (${r.rims}, ${r.loops.length && r.loops[0].tris.length})`);
  const L = r.loops[0], P = L.points.map(w => at3(topo, w));
  let outward = true, flat = 0;
  for (const t of L.tris) { const nn = triNormal(P, t), c = [0, 1, 2].map(k => (P[t[0]][k] + P[t[1]][k] + P[t[2]][k]) / 3); if (nn[0] * c[0] + nn[1] * c[1] + nn[2] * c[2] <= 0) outward = false; if (Math.hypot(...nn) < 1e-9) flat++; }
  ok(outward && !flat, 'every strip triangle faces away from the axis like the pipe, none is flat');
  ok(L.normals && L.normals.length === 28 && Math.abs(L.normals[0][2]) < 0.3, 'the strip points have radial normals of their own');
  ok(L.polys && L.polys.length === 28 && L.nPolys < 28 && L.nPolys >= 14, `the strip is drawn as its own quads and triangles, not one polygon (${L.nPolys} polygons)`);
  // the picked rims of one piece only: one rim, capped as Fill does
  const one = openEdgesNear(topo, p => p[2] > 0.5 && p[2] < 1.5);
  const r1 = closeBetween(topo, one, triangulate);
  ok(r1.rims === 1 && r1.loops.length === 1 && r1.loops[0].tris.length === 10, 'one rim picked is capped (12 points, 10 triangles)');
  // three rims: too many to close between
  const three = openEdgesNear(topo, p => p[2] < 2.5);
  ok(closeBetween(topo, three, triangulate).why === 'tooMany', 'three rims picked: too many, nothing is made');
}
{
  // a counterbore floor: a plate with a square hole (its rim on top), and a bore wall of a smaller radius under it, facing the axis
  const plate6 = plate(6, { skip: (i, j) => i >= 2 && i < 4 && j >= 2 && j < 4 });
  const wall = tube(3, 3, 0.5, -1, 0, 10, false);
  const m = join(plate6, wall), { topo } = read(m);
  const rims = openEdgesNear(topo, p => p[2] > -0.5 && p[0] > 1.5 && p[0] < 4.5 && p[1] > 1.5 && p[1] < 4.5);
  ok(rims.size === 18, `the hole's rim and the wall's top rim are 18 open edges (${rims.size})`);
  const r = closeBetween(topo, rims, triangulate);
  ok(r.loops.length === 1 && r.loops[0].tris.length === 18, `the ring between them is 18 triangles (${r.loops.length && r.loops[0].tris.length})`);
  const L = r.loops[0], P = L.points.map(w => at3(topo, w));
  let up = true; for (const t of L.tris) if (triNormal(P, t)[2] <= 1e-9) up = false;
  ok(up, 'every triangle of the ring faces up, like the plate');
  ok(L.normals.every(nv => nv[2] > 0.999), 'its points shade straight up');
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
