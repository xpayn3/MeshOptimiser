// node tests/fasteners.test.mjs — checks fasteners.js on shapes built here.
import { classifyFastener, fastenerLabel, fastenerThread, scaleFastener } from '../fasteners.js';

// ── shape builder ──────────────────────────────────────────────────────────
// A shape is a closed outline in (z, radius), swept round the axis. Each
// corner of the outline is a loop of N points; `kind` says what the loop is:
// a circle, a hexagon or a square of that radius (hex and square by their
// width across flats / 2), `off` shifts it sideways (a modelled thread).
// Every face gets its own vertices, like CAD output.
const N = 48;
function loop(z, r, kind = 'c', off = null) {
  return Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    let k = r;
    if (kind === 'h') { const t = ((a % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6; k = r / Math.cos(t); }
    if (kind === 's') k = r / Math.max(Math.abs(c), Math.abs(s));
    return [c * k + (off ? off[0] : 0), s * k + (off ? off[1] : 0), z];
  });
}
function sweep(outline, closed = false) {
  const pos = [], idx = [];
  const tri = (a, b, c) => { const n = pos.length / 3; pos.push(...a, ...b, ...c); idx.push(n, n + 1, n + 2); };
  const loops = outline.map(o => loop(o[0], o[1], o[2], o[3]));
  const last = closed ? loops.length : loops.length - 1;
  for (let l = 0; l < last; l++) {
    const A = loops[l], B = loops[(l + 1) % loops.length];
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; tri(A[i], A[j], B[j]); tri(A[i], B[j], B[i]); }
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}
// turn and move a mesh, so nothing depends on the part lying along an axis
function placed(m, seed = 1, scale = 1) {
  const a = seed * 0.9, b = seed * 1.7, c = seed * 0.4;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const R = [cb * cc, sa * sb * cc - ca * sc, ca * sb * cc + sa * sc, cb * sc, sa * sb * sc + ca * cc, ca * sb * sc - sa * cc, -sb, sa * cb, ca * cb];
  const p = m.positions, o = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] * scale, y = p[i + 1] * scale, z = p[i + 2] * scale;
    o[i] = R[0] * x + R[1] * y + R[2] * z + 37 * seed; o[i + 1] = R[3] * x + R[4] * y + R[5] * z - 12; o[i + 2] = R[6] * x + R[7] * y + R[8] * z + 5;
  }
  return { positions: o, index: m.index };
}

// ── the parts ───────────────────────────────────────────────────────────────
// (z runs from the head; sizes in mm, from the ISO tables)
const hexBolt = (d, L, af, k) => sweep([[0, 0], [0, af / 2, 'h'], [k, af / 2, 'h'], [k, d / 2], [k + L - d * 0.1, d / 2], [k + L, d * 0.4], [k + L, 0]]);
const socketScrew = (d, L, dk, k, s) => sweep([[k * 0.55, 0], [k * 0.55, s / 2, 'h'], [0, s / 2, 'h'], [0, dk / 2], [k, dk / 2], [k, d / 2], [k + L, d / 2], [k + L, 0]]);
const plainScrew = (d, L, dk, k) => sweep([[0, 0], [0, dk / 2], [k, dk / 2], [k, d / 2], [k + L, d / 2], [k + L, 0]]);
const countersunk = (d, L, dk) => sweep([[0, 0], [0, dk / 2], [(dk - d) / 2, d / 2], [L, d / 2], [L, 0]]);
const buttonHead = (d, L, dk, k) => sweep([[0, 0], [0, dk * 0.25], [k * 0.3, dk * 0.42], [k * 0.7, dk * 0.49], [k, dk / 2], [k, d / 2], [k + L, d / 2], [k + L, 0]]);
const setScrew = (d, L, s) => sweep([[d * 0.5, 0], [d * 0.5, s / 2, 'h'], [0, s / 2, 'h'], [0, d / 2], [L, d / 2], [L, 0]]);
const hexNut = (d, af, m) => sweep([[0, d / 2], [0, af / 2, 'h'], [m, af / 2, 'h'], [m, d / 2]], true);
const squareNut = (d, s, m) => sweep([[0, d / 2], [0, s / 2, 's'], [m, s / 2, 's'], [m, d / 2]], true);
const flangeNut = (d, af, m, dc) => sweep([[0, d / 2], [0, dc / 2], [m * 0.2, dc / 2], [m * 0.2, af / 2, 'h'], [m, af / 2, 'h'], [m, d / 2]], true);
const capNut = (d, af, m) => sweep([[0, d / 2], [0, af / 2, 'h'], [m, af / 2, 'h'], [m, af * 0.45], [m * 1.5, af * 0.3], [m * 1.7, 0], [m * 1.3, 0], [m * 1.3, d / 2]], true);
const washer = (di, od, t) => sweep([[0, di / 2], [0, od / 2], [t, od / 2], [t, di / 2]], true);
const ringOf = (di, od, t) => washer(di, od, t);
const bar = (d, L) => sweep([[0, 0], [0, d / 2], [L, d / 2], [L, 0]]);
// a bolt whose shank is a modelled thread: a round section, a little off the
// axis, going round as it goes along
function threadedBolt(d, L, af, k) {
  const o = [[0, 0], [0, af / 2, 'h'], [k, af / 2, 'h'], [k, d / 2]];
  const turns = L / (d * 0.15), steps = 120;
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * turns * Math.PI * 2; o.push([k + (i / steps) * L, d * 0.46, 'c', [Math.cos(a) * d * 0.035, Math.sin(a) * d * 0.035]]); }
  o.push([k + L, 0]);
  return sweep(o);
}
function torus(R, r) {
  const o = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; o.push([r * Math.sin(a), R + r * Math.cos(a)]); }
  return sweep(o, true);
}
function box(x, y, z) {
  const p = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]];
  const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const pos = [], idx = [];
  for (const q of f) { const n = pos.length / 3; for (const i of q) pos.push(...p[i]); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

// ── checks ──────────────────────────────────────────────────────────────────
let failed = 0, seed = 0;
const check = (name, ok, info = '') => { console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '   ' + info)); if (!ok) failed++; };
const brief = (r) => r ? `${r.kind}/${r.sub} ${r.score.toFixed(2)} d ${r.d.toFixed(2)} len ${r.length.toFixed(1)} → ${fastenerLabel(r)}` : 'not recognised';
const run = (m, scale = 1) => { const q = placed(m, ++seed, scale); return scaleFastener(classifyFastener(q.positions, q.index), 1 / scale); };
// recognised as `kind` (and `sub`), with a firm score and the right thread
function is(name, m, kind, sub, thread, len) {
  const r = run(m);
  const ok = !!r && r.kind === kind && (!sub || r.sub === sub) && r.score >= 0.6 && (!thread || fastenerThread(r) === thread) && (!len || Math.abs(r.length - len) <= Math.max(0.6, len * 0.04));
  check(name, ok, brief(r));
  return r;
}
// not a bolt, a nut or a washer (a plain bar may be called a pin: that kind is opt-in)
function isNot(name, m) {
  const r = run(m);
  check(name, !r || r.kind === 'pin' || r.score < 0.6, brief(r));
}

console.log('bolts and screws');
is('M8 × 30 hex bolt', hexBolt(8, 30, 13, 5.3), 'bolt', 'hex', 8, 30);
is('M4 × 8 hex bolt (short)', hexBolt(4, 8, 7, 2.8), 'bolt', 'hex', 4, 8);
is('M12 × 160 hex bolt (long)', hexBolt(12, 160, 18, 7.5), 'bolt', 'hex', 12, 160);
is('M24 × 80 hex bolt', hexBolt(24, 80, 36, 15), 'bolt', 'hex', 24, 80);
is('M6 × 20 socket head cap screw', socketScrew(6, 20, 10, 6, 5), 'bolt', 'socket', 6, 20);
is('M3 × 10 socket head cap screw', socketScrew(3, 10, 5.5, 3, 2.5), 'bolt', 'socket', 3, 10);
is('M5 × 16 screw as two cylinders (a CAD library part)', plainScrew(5, 16, 8.5, 5), 'bolt', null, 5, 16);
is('M6 × 25 countersunk screw', countersunk(6, 25, 12), 'bolt', 'countersunk', 6, 25);
is('M6 × 16 button head screw', buttonHead(6, 16, 10.5, 3.3), 'bolt', null, 6, 16);
is('M10 × 40 flange bolt (wide head)', plainScrew(10, 40, 21, 9), 'bolt', null, 10, 40);
is('M8 × 30 hex bolt with a modelled thread', threadedBolt(8, 30, 13, 5.3), 'bolt', 'hex', 8);
is('M8 × 16 set screw (hex socket, no head)', setScrew(8, 16, 4), 'bolt', 'set', 8, 16);

console.log('nuts');
is('M8 hex nut', hexNut(6.8, 13, 6.8), 'nut', 'hex', 8);
is('M8 hex nut, bore at full size', hexNut(8, 13, 6.5), 'nut', 'hex', 8);
is('M16 thin nut', hexNut(14, 24, 8), 'nut', 'hex', 16);
is('M10 coupling nut (30 long)', hexNut(8.5, 17, 30), 'nut', 'coupling', 10);
is('M10 flange nut', flangeNut(8.5, 15, 10, 21.8), 'nut', null, 10);
is('M6 square nut', squareNut(5, 10, 5), 'nut', 'square', 6);
is('M10 cap nut', capNut(8.5, 17, 8), 'nut', 'cap', 10);

console.log('washers');
is('M8 washer (ISO 7089: 8.4 × 16 × 1.6)', washer(8.4, 16, 1.6), 'washer', null, 8);
is('M5 large washer (5.3 × 15 × 1.2)', washer(5.3, 15, 1.2), 'washer', null, 5);
is('M20 washer (21 × 37 × 3)', washer(21, 37, 3), 'washer', null, 20);
is('M4 fender washer (4.3 × 20 × 1)', washer(4.3, 20, 1), 'washer', null, 4);
is('M12 thick washer (13 × 24 × 2.5)', washer(13, 24, 2.5), 'washer', null, 12);
// a cup (finishing) washer: a rim on one side, a hub on the other, 1.6 mm in all
is('M3.5 cup washer (pressed into a dish)', sweep([[0, 3.8], [0, 4.5], [1.15, 4.5], [1.6, 2.6], [1.6, 1.9], [0.48, 1.9], [0.24, 3.8]], true), 'washer', 'cup', 3.5);

console.log('whatever the size and unit');
{
  const a = run(hexBolt(8, 30, 13, 5.3), 0.001), b = run(hexBolt(8, 30, 13, 5.3), 25.4);
  check('a bolt in metres and one 25× too big are both the M8 × 30 bolt', !!a && !!b && fastenerLabel(a) === 'M8 × 30 hex bolt' && fastenerLabel(b) === 'M8 × 30 hex bolt', brief(a) + ' | ' + brief(b));
  const m = hexBolt(8, 30, 13, 5.3);
  const soup = new Float32Array(m.index.length * 3);
  for (let i = 0; i < m.index.length; i++) soup.set(m.positions.subarray(m.index[i] * 3, m.index[i] * 3 + 3), i * 3);
  const r = classifyFastener(soup, null);
  check('a mesh with no index (a plain triangle list)', !!r && r.kind === 'bolt', brief(r));
}

console.log('look-alikes that must be left alone');
isNot('a bushing (10 × 16 × 20 sleeve)', ringOf(10, 16, 20));
isNot('a spacer ring as tall as its wall is wide (8 × 14 × 4)', ringOf(8, 14, 4));
isNot('a ball bearing as one ring (20 × 47 × 14)', ringOf(20, 47, 14));
isNot('an O-ring (20 × 3)', torus(11.5, 1.5));
isNot('a flat gasket (50 × 56 × 1)', ringOf(50, 56, 1));
isNot('a solid hex bar (no hole)', sweep([[0, 0], [0, 6.5, 'h'], [20, 6.5, 'h'], [20, 0]]));
isNot('a hex pipe fitting (thin wall)', hexNut(22, 24, 18));
isNot('a cable gland (a hexagon between round collars, 42 long)', sweep([[0, 5], [0, 8], [10, 8], [10, 9.5, 'h'], [22, 9.5, 'h'], [22, 11], [26, 11], [26, 7.5], [42, 7.5], [42, 5]], true));
isNot('a rubber grommet (two lips and a groove)', sweep([[0, 3.5], [0, 7.4], [2.6, 7.4], [2.6, 4.5], [4.2, 4.5], [4.2, 7.4], [6.8, 7.4], [6.8, 3.5]], true));
isNot('a plain roller (20 × 20)', bar(20, 20));
isNot('a plain shaft (10 × 120)', bar(10, 120));
isNot('a disc (40 × 3)', bar(40, 3));
isNot('a levelling foot (M8 stud on a 40 mm pad)', plainScrew(8, 40, 40, 8));
isNot('a knob on a pin (head four times the pin)', plainScrew(6, 20, 26, 14));
isNot('a stepped shaft with a long collar', plainScrew(10, 30, 16, 40));
isNot('a cone', sweep([[0, 0], [0, 10], [30, 0.5], [30, 0]]));
isNot('a box', box(10, 14, 30));
isNot('a square bar', sweep([[0, 0], [0, 5, 's'], [40, 5, 's'], [40, 0]]));
isNot('a tube closed at one end (a cap, a cup)', sweep([[12, 0], [12, 4], [0, 4], [0, 5], [14, 5], [14, 0]]));
{
  const r = run(bar(8, 40));
  check('a plain round bar is only ever a pin, and says so', !!r && r.kind === 'pin' && fastenerLabel(r) === '⌀8 × 40 pin', brief(r));
}

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
