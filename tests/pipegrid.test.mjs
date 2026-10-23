// node tests/pipegrid.test.mjs
//
// pipegrid.js (Simplify round faces, first pass): a pipe with a quarter bend, as a CAD mesher cuts it: a straight run, a torus of
// 6 steps, a straight run, 16 lines round, every face a clean grid of quads (two triangles each). With a deviation of 2 on a tube of
// radius 5 bent at 30 and at least 12 segments a turn, the bend keeps 3 steps (whole rings go) and the tube 12 lines (whole lines go,
// the same ones in every face). Checked: the counts; every face is still a grid of quads (its edges are exactly the grid's: rings,
// lines and one diagonal a quad); the pipe stays closed but for its two ends; no point is new or moved; the CAD record stays sound;
// and a face that is not a clean grid (one ring a point short) is left to the point by point pass, the tube's lines then staying.
import { rebuildPipeGrids } from '../app/js/pipegrid.js';
import { simplifyRoundFaces } from '../app/js/roundfaces.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

const R = 30, r = 5, N = 16, STEPS = 6, LEN = 40;
const c = (th) => [R * Math.sin(th), R - R * Math.cos(th), 0];                        // the bend's centre line, in the XY plane
const ringAt = (ctr, n1, n2, n = N) => Array.from({ length: n }, (_, j) => { const a = 2 * Math.PI * j / n; return [ctr[0] + r * (Math.cos(a) * n1[0] + Math.sin(a) * n2[0]), ctr[1] + r * (Math.cos(a) * n1[1] + Math.sin(a) * n2[1]), ctr[2] + r * (Math.cos(a) * n1[2] + Math.sin(a) * n2[2])]; });
const bendRing = (th, n = N) => ringAt(c(th), [-Math.sin(th), Math.cos(th), 0], [0, 0, 1], n);
function pipe({ shortRing = false } = {}) {
  const pos = [], idx = [], faces = [], rows = [], pts = [];
  const face = (kind, nums, tris) => {
    const first = idx.length / 3; let area = 0;
    for (const [p, q, s] of tris) { const b = pos.length / 3; pos.push(...p, ...q, ...s); idx.push(b, b + 1, b + 2); const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [s[0] - p[0], s[1] - p[1], s[2] - p[2]]; area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2; }
    faces.push([kind, first, tris.length, area, ...nums]);
  };
  const band = (A, B) => { const out = []; for (let j = 0; j < A.length; j++) { const j2 = (j + 1) % A.length; out.push([A[j], A[j2], B[j2]], [A[j], B[j2], B[j]]); } return out; };
  const startA = ringAt([-LEN, 0, 0], [0, 1, 0], [0, 0, 1]), r0 = bendRing(0);
  face(1, [r], band(startA, r0));
  const rings = Array.from({ length: STEPS + 1 }, (_, k) => bendRing(Math.PI / 2 * k / STEPS));
  const tor = []; for (let k = 0; k < STEPS; k++) tor.push(...band(rings[k], rings[k + 1]));
  face(4, [R, r], tor);
  const r1 = rings[STEPS], endB = ringAt([R, R + LEN, 0], [-1, 0, 0], [0, 0, 1]);
  if (!shortRing) face(1, [r], band(r1, endB));
  else {                                                                              // (the far end a point short: not a clean grid)
    const e15 = ringAt([R, R + LEN, 0], [-1, 0, 0], [0, 0, 1], N - 1), tris = [];
    let i = 0, j = 0; while (i < N || j < N - 1) { const ai = (i + 1) / N, bj = (j + 1) / (N - 1); if (ai <= bj) { tris.push([r1[i % N], r1[(i + 1) % N], e15[j % (N - 1)]]); i++; } else { tris.push([e15[j % (N - 1)], r1[i % N], e15[(j + 1) % (N - 1)]]); j++; } }
    face(1, [r], tris);
  }
  for (const ring of [r0, r1]) { const first = pts.length / 3; for (const p of ring) pts.push(...p); pts.push(...ring[0]); rows.push([first, ring.length + 1, 1, 0, 1]); }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx), cad: { faces, rows, pts: new Float32Array(pts) } };
}
const key = (P, v) => P[v * 3].toFixed(4) + ',' + P[v * 3 + 1].toFixed(4) + ',' + P[v * 3 + 2].toFixed(4);
function edges(P, I, from = 0, to = I.length / 3) {
  const ids = new Map(), id = (v) => { const k = key(P, v); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const e = new Map(); for (let t = from; t < to; t++) for (let k = 0; k < 3; k++) { const a = id(I[t * 3 + k]), b = id(I[t * 3 + (k + 1) % 3]); const kk = a < b ? a + ':' + b : b + ':' + a; e.set(kk, (e.get(kk) || 0) + 1); }
  return { e, points: ids.size };
}

{
  console.log('a pipe with a quarter bend, 16 lines round, the bend 6 steps');
  const g = pipe();
  const res = simplifyRoundFaces(g.positions, g.index, { cad: g.cad, tolerance: 2, segments: 12 });
  ok(res.ok && res.rings === 3 && res.lines === 4, 'whole rings and whole lines went: 3 rings of the bend, 4 lines round (' + JSON.stringify({ rings: res.rings, lines: res.lines, collapsed: res.collapsed }) + ')');
  ok(res.ok && res.collapsed === 0, 'no point went on its own');
  const F = res.cad.faces;
  ok(F[0][2] === 2 * 12 && F[1][2] === 2 * 12 * 3 && F[2][2] === 2 * 12, 'the faces are grids of 12 round: the runs 1 band, the bend 3 (' + F.map(f => f[2]).join('/') + ' triangles)');
  // a grid of m lines round and t steps has m (t + 1) ring edges, m t line edges and m t diagonals, each inside edge in two triangles
  const bend = edges(res.positions, res.index, F[1][1], F[1][1] + F[1][2]);
  ok(bend.e.size === 12 * 4 + 12 * 3 + 12 * 3 && bend.points === 12 * 4, 'the bend is a grid of quads: ' + bend.points + ' points, ' + bend.e.size + ' edges (12 × 4 points, 120 edges)');
  const all = edges(res.positions, res.index); let open = 0, over = 0; for (const n of all.e.values()) { if (n === 1) open++; if (n > 2) over++; }
  ok(open === 2 * 12 && over === 0, 'closed but for its two ends (' + open + ' open edges, ' + over + ' in more than two triangles)');
  const before = new Set(); for (let v = 0; v < g.positions.length / 3; v++) before.add(key(g.positions, v));
  let fresh = 0; for (let i = 0; i < res.index.length; i++) if (!before.has(key(res.positions, res.index[i]))) fresh++;
  ok(fresh === 0, 'every point is a point of the input: nothing moved, nothing new');
  let sound = true, at = 0; for (const f of F) { if (f[1] !== at) sound = false; at += f[2]; } if (at !== res.index.length / 3) sound = false;
  ok(sound && res.cad.rows.every(rw => rw[1] === 13), 'the CAD record is sound: faces in order, the seam rings 12 points (and their closing one)');
  const tight = rebuildPipeGrids(g.positions, g.index, { cad: g.cad, tolerance: 0.001, segments: 12 });
  ok(!tight.changed, 'a deviation under the mesh\'s own sag changes nothing');
}
{
  console.log('the same pipe with its far end a point short');
  const g = pipe({ shortRing: true });
  const res = rebuildPipeGrids(g.positions, g.index, { cad: g.cad, tolerance: 2, segments: 12 });
  ok(res.changed && res.rings === 3, 'the bend still loses its rings (' + JSON.stringify({ rings: res.rings, lines: res.lines }) + ')');
  ok(res.changed && res.lines === 4, 'the tube still loses its lines: the uneven run is joined up again round what is left');
  // (the pass moves nothing: the edges are counted on the input's points)
  const all = edges(g.positions, res.index); let over = 0, open = 0; for (const n of all.e.values()) { if (n > 2) over++; if (n === 1) open++; }
  ok(over === 0 && open === 12 + 15, 'still closed but for its ends (' + open + ' open edges: 12 at the first, 15 at the far one)');
}
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exitCode = fails ? 1 : 0;
