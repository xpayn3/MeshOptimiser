// node tests/meshedit.test.mjs — the points, edges and faces of a mesh (meshedit.js) on shapes built here:
// a flat grid as a triangle soup, a cube, a grid with a square hole, a tube. Checks the welding, what a click picks,
// the three kinds of loop, the face of a triangle, and which triangles go on a delete.
import { buildTopology, pickElement, edgeLoop, pointLoop, edgeAtPoint, faceRegion, removalMask, pointPosition, counts, buildPolygons, pairQuads, outlineLines, pickPolygonElement, polygonLoop, nearestOutlineEdge, outlinePoints } from '../meshedit.js';

let failed = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) { failed++; console.log('  FAIL  ' + name + (got !== undefined ? '   got: ' + JSON.stringify(got) : '')); } };

// a soup: every triangle has its own three vertices, as most CAD exports have at sharp edges
const soup = (tris) => { const p = []; for (const t of tris) for (const v of t) p.push(...v); return new Float32Array(p); };
const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
const grid = (N, hole) => { const t = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { if (hole && hole(x, y)) continue; t.push(...quad([x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0])); } return soup(t); };
const edgeBetween = (topo, a, b) => { for (let e = 0; e < topo.nEdge; e++) { const p = pointPosition(topo, topo.edgeV[e * 2]), q = pointPosition(topo, topo.edgeV[e * 2 + 1]); const same = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) < 1e-6; if ((same(p, a) && same(q, b)) || (same(p, b) && same(q, a))) return e; } return -1; };
const triAt = (topo, c) => { for (let t = 0; t < topo.nTri; t++) { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const p = pointPosition(topo, topo.tri[t * 3 + k]); x += p[0] / 3; y += p[1] / 3; z += p[2] / 3; } if (Math.hypot(x - c[0], y - c[1], z - c[2]) < 0.34) return t; } return -1; };

// ── a 4 × 4 grid ──────────────────────────────────────────────────────────
{
  const g = buildTopology(grid(4), null);
  check('grid: 96 corners are 25 points', g.nVert === 25 && g.nRaw === 96, [g.nRaw, g.nVert]);
  check('grid: 32 triangles, 56 edges', g.nTri === 32 && g.nEdge === 56, counts(g));
  let open = 0, sharp = 0; for (let e = 0; e < g.nEdge; e++) { if (g.kind[e] === 2) open++; if (g.kind[e] === 1) sharp++; }
  check('grid: 16 open edges round it, none sharp', open === 16 && sharp === 0, [open, sharp]);
  check('grid: one face', g.nRegion === 1, g.nRegion);

  // a click near a corner, near a side, inside
  const t = triAt(g, [1 + 2 / 3, 1 + 1 / 3, 0]);                    // the triangle (1,1) (2,1) (2,2)
  const p = pickElement(g, t, [1.05, 1.02, 0], 'points');
  check('pick: the point nearest the click', p && pointPosition(g, p.id).join() === '1,1,0', p && pointPosition(g, p.id));
  const e = pickElement(g, t, [1.5, 1.03, 0], 'edges');
  check('pick: the edge nearest the click', e && e.id === edgeBetween(g, [1, 1, 0], [2, 1, 0]), e);
  const f = pickElement(g, t, [1.6, 1.3, 0], 'faces');
  check('pick: the triangle itself', f && f.id === t && f.mode === 'faces', f);
  check('pick: nothing for a triangle that is not there', pickElement(g, 999, [0, 0, 0], 'edges') === null);

  // a loop inside the surface: the whole row, and it stops at the rim
  const row = edgeLoop(g, edgeBetween(g, [1, 2, 0], [2, 2, 0]));
  const rowOk = row.length === 4 && [...row].every(x => pointPosition(g, g.edgeV[x * 2])[1] === 2 && pointPosition(g, g.edgeV[x * 2 + 1])[1] === 2);
  check('loop: an edge inside a grid gives its row, end to end', rowOk, [...row].map(x => [pointPosition(g, g.edgeV[x * 2]), pointPosition(g, g.edgeV[x * 2 + 1])]));
  const col = edgeLoop(g, edgeBetween(g, [3, 0, 0], [3, 1, 0]));
  check('loop: an upright edge gives its column', col.length === 4 && [...col].every(x => pointPosition(g, g.edgeV[x * 2])[0] === 3 && pointPosition(g, g.edgeV[x * 2 + 1])[0] === 3), col.length);
  const diag = edgeLoop(g, edgeBetween(g, [1, 1, 0], [2, 2, 0]));
  check('loop: a diagonal runs corner to corner', diag.length === 4, diag.length);
  // the open rim: all of it, round the corners
  const rim = edgeLoop(g, edgeBetween(g, [0, 0, 0], [1, 0, 0]));
  check('loop: an open edge gives the whole rim', rim.length === 16 && [...rim].every(x => g.kind[x] === 2), rim.length);
  const pts = pointLoop(g, edgeBetween(g, [1, 2, 0], [2, 2, 0]));
  check('loop of points: the five points of the row', pts.length === 5 && [...pts].every(v => pointPosition(g, v)[1] === 2), pts.length);
  const ea = edgeAtPoint(g, t, p.id, [1.4, 1.02, 0]);
  check('loop of points: the edge at the point that the click is nearest to', ea === edgeBetween(g, [1, 1, 0], [2, 1, 0]), ea);

  // delete
  const one = removalMask(g, { faces: [t] });
  check('delete a face: that triangle alone', one.count === 1 && one.removed[t] === 1, one.count);
  const byEdge = removalMask(g, { edges: [edgeBetween(g, [1, 1, 0], [2, 1, 0])] });
  check('delete an inner edge: the two triangles that share it', byEdge.count === 2, byEdge.count);
  const byRim = removalMask(g, { edges: [edgeBetween(g, [0, 0, 0], [1, 0, 0])] });
  check('delete an open edge: its one triangle', byRim.count === 1, byRim.count);
  const byPoint = removalMask(g, { points: [p.id] });
  check('delete an inner point: the six triangles round it', byPoint.count === 6, byPoint.count);
  const corner = removalMask(g, { points: [g.weld[0]] });
  check('delete a corner point of the grid: one or two triangles', corner.count >= 1 && corner.count <= 2, corner.count);
  const all = removalMask(g, { points: new Set([p.id]), faces: new Set([t]), edges: [] });
  check('delete: kinds add up without counting a triangle twice', all.count === 6, all.count);
  check('delete: numbers out of range are ignored', removalMask(g, { faces: [-1, 4000], points: [99999], edges: [99999] }).count === 0);
}

// ── a cube ────────────────────────────────────────────────────────────────
{
  const c = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const f = (a, b, d, e) => quad(c[a], c[b], c[d], c[e]);
  const cube = buildTopology(soup([...f(0, 3, 2, 1), ...f(4, 5, 6, 7), ...f(0, 1, 5, 4), ...f(2, 3, 7, 6), ...f(1, 2, 6, 5), ...f(3, 0, 4, 7)]), null);
  check('cube: 8 points, 12 triangles, 18 edges', cube.nVert === 8 && cube.nTri === 12 && cube.nEdge === 18, counts(cube));
  let sharp = 0, smooth = 0; for (let e = 0; e < cube.nEdge; e++) { if (cube.kind[e] === 1) sharp++; if (cube.kind[e] === 0) smooth++; }
  check('cube: 12 sharp edges, 6 diagonals inside the faces', sharp === 12 && smooth === 6, [sharp, smooth]);
  check('cube: six faces', cube.nRegion === 6, cube.nRegion);
  const top = triAt(cube, [2 / 3, 1 / 3, 1]);
  const face = faceRegion(cube, top);
  check('face: the two triangles of the top', face.length === 2 && [...face].every(t => cube.normal[t * 3 + 2] > 0.99), [...face]);
  const e = edgeBetween(cube, [0, 0, 1], [1, 0, 1]);
  const outline = edgeLoop(cube, e, { tri: top });
  const zs = [...outline].map(x => [pointPosition(cube, cube.edgeV[x * 2])[2], pointPosition(cube, cube.edgeV[x * 2 + 1])[2]]);
  check('loop: a sharp edge clicked from the top gives the four sides of the top', outline.length === 4 && zs.every(([a, b]) => a === 1 && b === 1), zs);
  const front = triAt(cube, [2 / 3, 0, 1 / 3]) >= 0 ? triAt(cube, [2 / 3, 0, 1 / 3]) : triAt(cube, [1 / 3, 0, 2 / 3]);
  const outline2 = edgeLoop(cube, e, { tri: front });
  const ys = [...outline2].map(x => [pointPosition(cube, cube.edgeV[x * 2])[1], pointPosition(cube, cube.edgeV[x * 2 + 1])[1]]);
  check('loop: the same edge clicked from the front gives the four sides of the front', outline2.length === 4 && ys.every(([a, b]) => a === 0 && b === 0), ys);
  check('loop: without a triangle it still gives one face\'s outline', edgeLoop(cube, e).length === 4);
  const del = removalMask(cube, { faces: face });
  check('delete the top face: two triangles', del.count === 2, del.count);
  const pt = removalMask(cube, { points: [cube.weld[0]] });
  check('delete a corner of the cube: every triangle that reaches it, on three faces', pt.count >= 3 && pt.count <= 6, pt.count);
}

// ── a grid with a square hole: the rim of the hole is a loop of its own ───
{
  const g = buildTopology(grid(5, (x, y) => x === 2 && y === 2), null);
  check('hole: 48 triangles', g.nTri === 48, g.nTri);
  const inner = edgeLoop(g, edgeBetween(g, [2, 2, 0], [3, 2, 0]));
  check('loop: the rim of the hole, four edges', inner.length === 4, inner.length);
  const outer = edgeLoop(g, edgeBetween(g, [0, 0, 0], [1, 0, 0]));
  check('loop: the outer rim, twenty edges, without the hole', outer.length === 20 && ![...outer].some(x => inner.includes(x)), outer.length);
  const pts = pointLoop(g, edgeBetween(g, [2, 2, 0], [3, 2, 0]));
  check('loop of points: the four corners of the hole', pts.length === 4, pts.length);
}

// ── a tube: smooth round, open at both ends ───────────────────────────────
{
  const N = 24, H = 4, t = [];
  const at = (i, h) => [Math.cos((i / N) * 2 * Math.PI), Math.sin((i / N) * 2 * Math.PI), h];
  for (let h = 0; h < H; h++) for (let i = 0; i < N; i++) t.push(...quad(at(i, h), at(i + 1, h), at(i + 1, h + 1), at(i, h + 1)));
  const tube = buildTopology(soup(t), null);
  check('tube: one smooth face, ' + N * (H + 1) + ' points', tube.nRegion === 1 && tube.nVert === N * (H + 1), [tube.nRegion, tube.nVert]);
  const ring = edgeLoop(tube, edgeBetween(tube, at(0, 2), at(1, 2)));
  check('loop: an edge round a tube closes into its ring', ring.length === N && [...ring].every(x => Math.abs(pointPosition(tube, tube.edgeV[x * 2])[2] - 2) < 1e-6), ring.length);
  const along = edgeLoop(tube, edgeBetween(tube, at(5, 1), at(5, 2)));
  check('loop: an edge along a tube runs from end to end', along.length === H, along.length);
  const end = edgeLoop(tube, edgeBetween(tube, at(0, 0), at(1, 0)));
  check('loop: an open end of the tube, all the way round', end.length === N && [...end].every(x => tube.kind[x] === 2), end.length);
  check('face: the whole tube from one triangle', faceRegion(tube, 0).length === tube.nTri);
  const cut = removalMask(tube, { edges: ring });
  check('delete a ring of edges: the triangle on each side of every edge', cut.count === N * 2, cut.count);
}

// ── an indexed mesh, and odd input ────────────────────────────────────────
{
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const q = buildTopology(pos, idx);
  check('indexed: 4 points, 2 triangles, 5 edges', q.nVert === 4 && q.nTri === 2 && q.nEdge === 5, counts(q));
  const z = buildTopology(new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0]), null);                    // a triangle squeezed to a line
  check('a triangle of no area does not break anything', z.nTri === 1 && removalMask(z, { faces: [0] }).count === 1 && edgeLoop(z, 0).length >= 1);
  const none = buildTopology(new Float32Array(0), null);
  check('an empty mesh', none.nTri === 0 && none.nVert === 0 && faceRegion(none, 0).length === 0 && edgeLoop(none, 0).length === 0);
  // big enough to notice a quadratic step: 200 × 200 quads
  const t0 = Date.now(), big = buildTopology(grid(200), null), ms = Date.now() - t0;
  check('80,000 triangles in well under a second', big.nTri === 80000 && big.nVert === 201 * 201 && ms < 1500, ms + ' ms');
  const t1 = Date.now(), loop = edgeLoop(big, 0), rimAll = [...Array(big.nEdge).keys()].filter(e => big.kind[e] === 2).length;
  check('its loops are quick too', loop.length > 0 && Date.now() - t1 < 500 && rimAll === 800, [loop.length, rimAll]);
}

// ── a plate joined into one polygon (what Untriangulate leaves): its inside points are not points ──
{
  const g = buildTopology(grid(4), null), one = new Int32Array(g.nTri).fill(0), pg = buildPolygons(g, one, 1);
  const on = outlinePoints(g, pg); let n = 0; for (let v = 0; v < g.nVert; v++) n += on[v];
  check('points: a 4 × 4 plate that is one polygon has 16 points on its outline, the 9 inside are not points', g.nVert === 25 && n === 16, [g.nVert, n]);
  const t = triAt(g, [1.9, 2.1, 0]);
  const pk = pickPolygonElement(g, pg, t, [1.9, 2.1, 0], 'points');
  check('points: a click beside an inside point takes a corner of the outline', pk && on[pk.id] === 1, pk);
  const cells = pairQuads(g), pg2 = buildPolygons(g, cells.polyOf, cells.count), on2 = outlinePoints(g, pg2);
  check('points: when every cell is its own polygon every point is a point', [...on2].every(x => x === 1));
}
// ── polygons: four-sided pairs of triangles, not whole plates ─────────────
{
  const g = buildTopology(grid(4), null), q = pairQuads(g), pg = buildPolygons(g, q.polyOf, q.count);
  check('quads: a 4 × 4 grid is 16 four-sided polygons, not one plate', q.count === 16 && q.quads === 16, [q.count, q.quads]);
  check('quads: each has two triangles and four sides', [...Array(16).keys()].every(p => pg.pStart[p + 1] - pg.pStart[p] === 2 && pg.oStart[p + 1] - pg.oStart[p] === 4));
  let real = 0; for (let e = 0; e < g.nEdge; e++) real += pg.real[e];
  check('quads: the 16 diagonals are not edges (40 of 56 are)', real === 40, real);
  check('quads: the lines are those 40 edges', outlineLines(g, pg).length === 80);
  const t = triAt(g, [1 + 2 / 3, 1 + 1 / 3, 0]);
  const f = pickPolygonElement(g, pg, t, [1.6, 1.3, 0], 'faces');
  check('pick: a polygon is the cell under the click', f && pg.pStart[f.id + 1] - pg.pStart[f.id] === 2 && [...pg.pTris.slice(pg.pStart[f.id], pg.pStart[f.id + 1])].includes(t), f);
  const ed = pickPolygonElement(g, pg, t, [1.55, 1.5, 0], 'edges');
  check('pick: an edge is never the diagonal, however near the click', ed && pg.real[ed.id] === 1, ed);
  const loop = polygonLoop(g, pg, f.id, nearestOutlineEdge(g, pg, f.id, [1.95, 1.5, 0]));
  check('loop: polygons across a side run along the row', loop.length === 4, loop.length);
  const up = polygonLoop(g, pg, f.id, nearestOutlineEdge(g, pg, f.id, [1.5, 1.95, 0]));
  check('loop: across the other side they run along the column', up.length === 4 && [...up].filter(x => loop.includes(x)).length === 1, up.length);
  const rowEdges = edgeLoop(g, edgeBetween(g, [1, 2, 0], [2, 2, 0]), { real: pg.real });
  check('loop: an edge of a row of polygons gives the row, diagonals left out', rowEdges.length === 4, rowEdges.length);
}
{
  const c = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const f = (a, b, d, e) => quad(c[a], c[b], c[d], c[e]);
  const cube = buildTopology(soup([...f(0, 3, 2, 1), ...f(4, 5, 6, 7), ...f(0, 1, 5, 4), ...f(2, 3, 7, 6), ...f(1, 2, 6, 5), ...f(3, 0, 4, 7)]), null), q = pairQuads(cube);
  check('quads: a cube is six of them', q.count === 6 && q.quads === 6, [q.count, q.quads]);
  // a fan of 12 triangles round a point: no two of them make anything like a square
  const fan = []; for (let i = 0; i < 12; i++) { const a = (i / 12) * 2 * Math.PI, b = ((i + 1) / 12) * 2 * Math.PI; fan.push([[0, 0, 0], [Math.cos(a), Math.sin(a), 0], [Math.cos(b), Math.sin(b), 0]]); }
  const disc = buildTopology(soup(fan), null), qd = pairQuads(disc);
  check('quads: a fan round a point stays triangles', qd.quads === 0 && qd.count === 12, [qd.count, qd.quads]);
  // a tube: every wall cell, all the way round
  const N = 24, H = 3, tt = [], at = (i, h) => [Math.cos((i / N) * 2 * Math.PI), Math.sin((i / N) * 2 * Math.PI), h * 0.3];
  for (let h = 0; h < H; h++) for (let i = 0; i < N; i++) tt.push(...quad(at(i, h), at(i + 1, h), at(i + 1, h + 1), at(i, h + 1)));
  const tube = buildTopology(soup(tt), null), qt = pairQuads(tube), pgt = buildPolygons(tube, qt.polyOf, qt.count);
  check('quads: a tube of ' + N * H + ' cells', qt.count === N * H && qt.quads === N * H, [qt.count, qt.quads]);
  const p0 = qt.polyOf[0], ring = polygonLoop(tube, pgt, p0, nearestOutlineEdge(tube, pgt, p0, at(0, 0.5)));
  check('loop: polygons round a tube close into a ring', ring.length === N, ring.length);
  const t0 = Date.now(), big = buildTopology(grid(200), null), qb = pairQuads(big);
  check('quads: 80,000 triangles paired in well under a second', qb.count === 40000 && Date.now() - t0 < 2500, (Date.now() - t0) + ' ms');
}

console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed`);
process.exit(failed ? 1 : 0);
