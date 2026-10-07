// node tests/holefill.test.mjs — checks holefill.js on shapes built here.
import { fillFlatHoles, applyHoleFill } from '../holefill.js';

// ── tiny mesh builder: every face gets its own vertices, like CAD output ──
function mesh() {
  const pos = [], idx = [];
  const tri = (a, b, c) => { const n = pos.length / 3; pos.push(...a, ...b, ...c); idx.push(n, n + 1, n + 2); };
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  return { pos, idx, tri, quad, done: () => ({ positions: new Float32Array(pos), index: new Uint32Array(idx) }) };
}
const ring = (n, r, z, cx = 0, cy = 0, phase = 0) => Array.from({ length: n }, (_, i) => {
  const a = phase + (i / n) * Math.PI * 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
});
// square outline with n points (n divisible by 4), same angular order as ring()
const square = (n, half, z) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), k = half / Math.max(Math.abs(c), Math.abs(s));
  return [c * k, s * k, z];
});
// annulus between two loops with the same point count; up = normal +z
function band(m, outer, inner, up) {
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (up) m.quad(outer[i], outer[j], inner[j], inner[i]); else m.quad(outer[j], outer[i], inner[i], inner[j]);
  }
}
function disc(m, loop, up) {
  for (let i = 1; i + 1 < loop.length; i++) up ? m.tri(loop[0], loop[i], loop[i + 1]) : m.tri(loop[0], loop[i + 1], loop[i]);
}
// wall between a top loop and a bottom loop; outward = normals away from the axis
function wall(m, top, bot, outward) {
  const n = top.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (outward) m.quad(bot[i], bot[j], top[j], top[i]); else m.quad(bot[j], bot[i], top[i], top[j]);
  }
}

// every directed edge has exactly one opposite → closed, consistently oriented
function watertight(positions, index) {
  const key = v => [0, 1, 2].map(c => Math.round(positions[v * 3 + c] * 1e4)).join(',');
  const he = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const k = [key(index[t]), key(index[t + 1]), key(index[t + 2])];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;      // zero-area filler
    for (let e = 0; e < 3; e++) { const d = k[e] + '>' + k[(e + 1) % 3]; he.set(d, (he.get(d) || 0) + 1); }
  }
  let open = 0;
  for (const [d, n] of he) { const [a, b] = d.split('>'); if (n !== 1 || he.get(b + '>' + a) !== 1) open++; }
  return open;
}
function volume(positions, index) {
  let v = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    v += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
       - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
       + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return v / 6;
}
const brief = (res) => JSON.stringify({ ...res, removed: undefined, caps: undefined, capOwner: undefined });
const volumePrism = (r, h) => 0.5 * N * r * r * Math.sin(2 * Math.PI / N) * h;   // N-gon prism
const run = (g, maxSize, extra = {}) => {
  const res = fillFlatHoles(g.positions, g.index, { maxSize, ...extra });
  const parts = res.holes ? applyHoleFill(g.index, res) : [{ idx: g.index }];
  const out = parts.length ? parts[0].idx : new Uint32Array(0);
  return { res, out, open: watertight(g.positions, out), vol: volume(g.positions, out) };
};

// is the empty cell (x, y) of a character grid cut off from the grid's border?
function enclosed(rows, x, y) {
  const seen = new Set([x + ',' + y]); const todo = [[x, y]];
  while (todo.length) {
    const [cx, cy] = todo.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (ny < 0 || ny >= rows.length || nx < 0 || nx >= rows[0].length) return false;
      if (rows[ny][nx] === '#' || seen.has(nx + ',' + ny)) continue;
      seen.add(nx + ',' + ny); todo.push([nx, ny]);
    }
  }
  return true;
}

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : '  ' + extra)); if (!cond) failed++; };

const N = 16, HALF = 50, TH = 4;      // plate 100 × 100 × 4

// 1. plate with a through hole, diameter 10
function plateThrough(r = 5, n = N) {
  const m = mesh();
  const to = square(n, HALF, TH), bo = square(n, HALF, 0), ti = ring(n, r, TH), bi = ring(n, r, 0);
  band(m, to, ti, true); band(m, bo, bi, false); wall(m, to, bo, true); wall(m, ti, bi, false);
  return m.done();
}
{
  const g = plateThrough();
  console.log('through hole Ø10 in a 4 mm plate');
  check('input is watertight', watertight(g.positions, g.index) === 0);
  const a = run(g, 12);
  check('one hole found', a.res.holes === 1, brief(a.res));
  check('counted as a through hole', a.res.through === 1);
  check('wall removed (32 triangles)', a.res.removedTris === 32, 'removed ' + a.res.removedTris);
  check('two caps of 14 triangles', a.res.addedTris === 28, 'added ' + a.res.addedTris);
  check('result is watertight', a.open === 0, a.open + ' open edges');
  check('volume is the solid plate', Math.abs(a.vol - 100 * 100 * TH) < 1, 'vol ' + a.vol);
  const b = run(g, 8);
  check('left alone when the limit is 8', b.res.holes === 0);
}

// 2. blind hole
{
  const m = mesh();
  const to = square(N, HALF, TH), bo = square(N, HALF, 0), ti = ring(N, 5, TH), fl = ring(N, 5, 1);
  band(m, to, ti, true); disc(m, bo, false); wall(m, to, bo, true); wall(m, ti, fl, false); disc(m, fl, true);
  const g = m.done();
  console.log('blind hole Ø10, 3 mm deep');
  check('input is watertight', watertight(g.positions, g.index) === 0);
  const a = run(g, 12);
  check('one blind hole', a.res.holes === 1 && a.res.blind === 1, brief(a.res));
  check('result is watertight', a.open === 0, a.open + ' open edges');
  check('volume is the solid plate', Math.abs(a.vol - 100 * 100 * TH) < 1, 'vol ' + a.vol);
}

// 3. boss standing on the plate: same loop, but it rises above the face
{
  const m = mesh();
  const to = square(N, HALF, TH), bo = square(N, HALF, 0), ti = ring(N, 5, TH), tp = ring(N, 5, TH + 6);
  band(m, to, ti, true); disc(m, bo, false); wall(m, to, bo, true); wall(m, tp, ti, true); disc(m, tp, true);
  const g = m.done();
  console.log('boss Ø10 standing on the plate');
  check('input is watertight', watertight(g.positions, g.index) === 0);
  const a = run(g, 12);
  check('not treated as a hole', a.res.holes === 0 && a.res.skipped.raised === 1, brief(a.res));
  check('mesh untouched', a.out.length === g.index.length);
}

// 4. counterbored through hole: Ø16 × 2 deep, then Ø8 through
{
  const m = mesh();
  const to = square(N, HALF, TH), bo = square(N, HALF, 0);
  const t1 = ring(N, 8, TH), s1 = ring(N, 8, 2), s2 = ring(N, 4, 2), b2 = ring(N, 4, 0);
  band(m, to, t1, true); wall(m, t1, s1, false); band(m, s1, s2, true); wall(m, s2, b2, false);
  band(m, bo, b2, false); wall(m, to, bo, true);
  const g = m.done();
  console.log('counterbored hole Ø16 / Ø8');
  check('input is watertight', watertight(g.positions, g.index) === 0);
  const a = run(g, 20);
  check('one hole, counterbore and bore together', a.res.holes === 1, brief(a.res));
  check('result is watertight', a.open === 0, a.open + ' open edges');
  check('volume is the solid plate', Math.abs(a.vol - 100 * 100 * TH) < 1, 'vol ' + a.vol);
  const b = run(g, 10);
  check('limit 10: only the Ø8 bore is filled, the Ø16 counterbore stays as a recess', b.res.holes === 1 && b.open === 0, brief(b.res));
  check('…and exactly the counterbore volume is still missing', Math.abs((100 * 100 * TH - b.vol) - volumePrism(8, 2)) < 1, 'vol ' + b.vol);
}

// 4d. threaded insert in the wall of a long profile: a hole Ø5.4 through a
//     2 mm wall, a flanged sleeve standing in it (flange Ø10 outside, body
//     Ø5.4, Ø3 bore right through). The bore is a hole; the insert is not.
{
  const m = mesh();
  const L = 400, W = 30, t = 2;                       // wall: 400 × 30 × 2, z from 0 to 2
  const rect = (z) => { const o = square(N, 1, z); return o.map(p => [p[0] * L / 2, p[1] * W / 2, z]); };
  const to = rect(t), bo = rect(0);
  const hT = ring(N, 2.7, t), hB = ring(N, 2.7, 0);                 // the Ø5.4 openings in the wall faces
  band(m, to, hT, true); band(m, bo, hB, false); wall(m, to, bo, true);
  // insert: flange Ø10 from z = 2 to 3, body Ø5.4 from z = 0 down to -4, bore Ø3 all the way
  const fB = ring(N, 5, t), fT = ring(N, 5, t + 1), boreT = ring(N, 1.5, t + 1), boreB = ring(N, 1.5, -4), bodyB = ring(N, 2.7, -4);
  band(m, fB, hT, false);                    // underside of the flange, facing down onto the wall … coplanar with the top face but facing the other way
  wall(m, fT, fB, true);                     // flange rim
  band(m, fT, boreT, true);                  // flange top (ring Ø10 with the Ø3 bore in it)
  wall(m, boreT, boreB, false);              // bore
  band(m, bodyB, boreB, false);              // body end (ring Ø5.4 / Ø3), facing down
  wall(m, hB, bodyB, true);                  // body below the wall
  const g = m.done();
  console.log('threaded insert in a profile wall');
  const a = run(g, 12);
  check('the bore is filled', a.res.holes === 1 && a.res.through === 1, brief(a.res));
  check('the insert itself is left standing', a.res.removedTris === 2 * N, 'removed ' + a.res.removedTris + ' triangles');
}

// 4b. pocket Ø30 with a small Ø5 through hole in its floor
{
  const m = mesh();
  const to = square(N, HALF, TH), bo = square(N, HALF, 0);
  const t1 = ring(N, 15, TH), s1 = ring(N, 15, 2), s2 = ring(N, 2.5, 2), b2 = ring(N, 2.5, 0);
  band(m, to, t1, true); wall(m, t1, s1, false); band(m, s1, s2, true); wall(m, s2, b2, false);
  band(m, bo, b2, false); wall(m, to, bo, true);
  const g = m.done();
  console.log('pocket Ø30 with a Ø5 hole in its floor');
  const a = run(g, 40);
  check('limit 40: pocket and hole go as one feature', a.res.holes === 1 && a.open === 0 && Math.abs(a.vol - 100 * 100 * TH) < 1, brief(a.res));
  const b = run(g, 8);
  check('limit 8: only the small hole is filled, the pocket stays', b.res.holes === 1 && b.res.through === 1 && b.open === 0, brief(b.res));
  check('…and the pocket volume is still missing', Math.abs((100 * 100 * TH - b.vol) - volumePrism(15, 2)) < 2, 'vol ' + b.vol);
}

// 4c. washer: the bore is what the part is
{
  const m = mesh();
  const to = ring(N, 6, 1.5), bo = ring(N, 6, 0), ti = ring(N, 3.2, 1.5), bi = ring(N, 3.2, 0);
  band(m, to, ti, true); band(m, bo, bi, false); wall(m, to, bo, true); wall(m, ti, bi, false);
  const g = m.done();
  console.log('washer 12 × 6.4');
  const a = run(g, 12);
  check('bore left open', a.res.holes === 0 && a.res.skipped.partOfShape === 2 && a.out.length === g.index.length, brief(a.res));
}

// 5. hollow box (sheet-metal enclosure) with a bolt hole through its lid
{
  const m = mesh();
  const H = 40, t = 2;
  const to = square(N, HALF, H), bo = square(N, HALF, 0), ti = ring(N, 3, H);
  const ci = ring(N, 3, H - t), co = square(N, HALF - t, H - t), cb = square(N, HALF - t, t);
  band(m, to, ti, true); wall(m, to, bo, true); disc(m, bo, false);          // outside
  wall(m, ti, ci, false);                                                    // hole through the lid
  band(m, co, ci, false); wall(m, co, cb, false); disc(m, cb, true);         // cavity
  const g = m.done();
  console.log('hollow box, Ø6 hole through the 2 mm lid');
  check('input is watertight', watertight(g.positions, g.index) === 0);
  const v0 = volume(g.positions, g.index);
  const a = run(g, 8);
  check('one through hole (outside face and cavity ceiling)', a.res.holes === 1 && a.res.through === 1, brief(a.res));
  check('result is watertight', a.open === 0, a.open + ' open edges');
  check('only the hole volume was added', Math.abs((a.vol - v0) - Math.PI * 9 * t) < 3, 'delta ' + (a.vol - v0));
}

// 6. a window too big to be a hole, and a part with several holes
{
  const m = mesh();
  const to = square(N, HALF, TH), bo = square(N, HALF, 0);
  // three holes in a row need a face triangulated around all of them: build
  // the top as three strips, each a square with one hole
  const strip = (cx, r) => {
    const o = square(N, 10, TH).map(p => [p[0] + cx, p[1], p[2]]), ob = square(N, 10, 0).map(p => [p[0] + cx, p[1], p[2]]);
    const i = ring(N, r, TH, cx), ib = ring(N, r, 0, cx);
    band(m, o, i, true); band(m, ob, ib, false); wall(m, i, ib, false);
    return { o, ob };
  };
  const a1 = strip(-20, 2), a2 = strip(0, 3), a3 = strip(20, 9);
  // outer walls of the 60 × 20 bar: strips touch along x = ±10, so a wall is
  // only emitted where no neighbouring strip shares the edge
  const onX = (p, q, X) => Math.abs(p[0] - X) < 1e-6 && Math.abs(q[0] - X) < 1e-6;
  const wallIf = (s, shared) => { for (let i = 0; i < N; i++) { const j = (i + 1) % N; if (!shared.some(X => onX(s.o[i], s.o[j], X))) m.quad(s.ob[i], s.ob[j], s.o[j], s.o[i]); } };
  wallIf(a1, [-10]); wallIf(a2, [-10, 10]); wallIf(a3, [10]);
  const g = m.done();
  console.log('bar with holes Ø4, Ø6 and Ø18');
  check('input is watertight', watertight(g.positions, g.index) === 0, watertight(g.positions, g.index) + ' open');
  const a = run(g, 8);
  check('the two small holes are filled, the Ø18 one is kept', a.res.holes === 2, brief(a.res));
  check('result is watertight', a.open === 0, a.open + ' open edges');
  const b = run(g, 20);
  check('limit 20 fills all three', b.res.holes === 3 && b.open === 0, brief(b.res));
  check('volume is the solid bar', Math.abs(b.vol - 60 * 20 * TH) < 1, 'vol ' + b.vol);
}

// 7. hex hole (flat wall faces) and an indexed mesh with shared vertices
{
  const g = plateThrough(4, 12);
  const a = run(g, 10);
  console.log('12-sided hole, coarse');
  check('filled and watertight', a.res.holes === 1 && a.open === 0, brief(a.res));
}

// 8. single-sheet surface with a hole (nothing behind the loop)
{
  const m = mesh();
  band(m, square(N, HALF, 0), ring(N, 5, 0), true);
  const g = m.done();
  const a = run(g, 12);
  console.log('open sheet with a hole');
  check('capped', a.res.holes === 1 && a.res.open === 1 && a.res.addedTris === 14, brief(a.res));
}

// 8b. engraved shapes on a grid: outlines with concave corners and several
//     points along every straight edge, and (for O and B) an island inside
{
  const shapes = {
    plus: ['.....', '..#..', '.###.', '..#..', '.....'],
    E:    ['......', '.####.', '.#....', '.###..', '.#....', '.####.', '......'],
    L:    ['.....', '.#...', '.#...', '.#...', '.###.', '.....'],
    O:    ['.......', '.#####.', '.#...#.', '.#...#.', '.#####.', '.......'],
    B:    ['......', '.####.', '.#..#.', '.####.', '.#..#.', '.####.', '......'],
    T:    ['.......', '.#####.', '...#...', '...#...', '...#...', '.......'],
  };
  for (const [name, rows] of Object.entries(shapes)) {
    const PAD = 6, D = 1.5;
    const H = rows.length + PAD * 2, Wd = rows[0].length + PAD * 2;
    const pit = (x, y) => { const r = rows[y - PAD]; return !!r && r[x - PAD] === '#'; };
    const m = mesh();
    let pocketCells = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < Wd; x++) {
      const z = pit(x, y) ? TH - D : TH;
      if (pit(x, y)) pocketCells++;
      m.quad([x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]);              // top or floor, normal +z
      // walls: where a pocket cell meets a higher cell, facing into the pocket
      if (pit(x, y)) {
        if (!pit(x + 1, y)) m.quad([x + 1, y, TH - D], [x + 1, y, TH], [x + 1, y + 1, TH], [x + 1, y + 1, TH - D]);
        if (!pit(x - 1, y)) m.quad([x, y + 1, TH - D], [x, y + 1, TH], [x, y, TH], [x, y, TH - D]);
        if (!pit(x, y + 1)) m.quad([x + 1, y + 1, TH - D], [x + 1, y + 1, TH], [x, y + 1, TH], [x, y + 1, TH - D]);
        if (!pit(x, y - 1)) m.quad([x, y, TH - D], [x, y, TH], [x + 1, y, TH], [x + 1, y, TH - D]);
      }
    }
    const g = m.done();
    const before = watertight(g.positions, g.index);
    const res = fillFlatHoles(g.positions, g.index, { maxSize: 12 });
    const parts = res.holes ? applyHoleFill(g.index, res) : [];
    const out = parts.length ? parts[0].idx : g.index;
    console.log('engraved ' + name);
    check('input is open only along the board edge', before === 2 * (H + Wd), before + ' open edges');
    check('filled as one recess', res.holes === 1, brief(res));
    let capArea = 0, flipped = 0;
    for (let i = 0; res.caps && i < res.caps.length; i += 3) {
      const [p, q, r] = [res.caps[i], res.caps[i + 1], res.caps[i + 2]].map(v => [g.positions[v * 3], g.positions[v * 3 + 1]]);
      const ar = ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
      if (ar < -1e-9) flipped++;
      capArea += ar;
    }
    // the cap covers the recess and any island standing in it (the island goes too)
    const outline = (() => { let inside = pocketCells; for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) if (rows[y][x] === '.' && enclosed(rows, x, y)) inside++; return inside; })();
    check('no flipped triangles in the cap', flipped === 0, flipped + ' flipped');
    check('cap area equals the recess outline', Math.abs(capArea - outline) < 1e-6, 'cap ' + capArea + ' vs ' + outline);
    check('result is a flat, closed top (open only along the board edge)', watertight(g.positions, out) === 2 * (H + Wd), watertight(g.positions, out) + ' open edges');
    let zMin = Infinity;
    for (let i = 0; i < out.length; i++) zMin = Math.min(zMin, g.positions[out[i] * 3 + 2]);
    check('nothing is left below the surface', zMin === TH, 'lowest z ' + zMin);
  }
}

// 9. material groups survive
{
  const g = plateThrough();
  const half = (g.index.length / 3 / 2 | 0) * 3;
  const groups = [{ start: 0, count: half, materialIndex: 0 }, { start: half, count: g.index.length - half, materialIndex: 1 }];
  const res = fillFlatHoles(g.positions, g.index, { maxSize: 12 });
  const parts = applyHoleFill(g.index, res, groups);
  console.log('two material groups');
  check('both groups kept', parts.length === 2 && parts[0].materialIndex === 0 && parts[1].materialIndex === 1, JSON.stringify(parts.map(p => p.idx.length)));
  const total = parts.reduce((s, p) => s + p.idx.length, 0) / 3;
  check('triangle total adds up', total === g.index.length / 3 - res.removedTris + res.addedTris);
}

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
