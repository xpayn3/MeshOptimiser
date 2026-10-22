// node tests/profile.test.mjs — checks profile.js (Clean profile: a straight extrusion made solid) on shapes built here.
import { cleanProfile, fillNotches, extrudeLoops, sweepOpen } from '../app/js/profile.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

const area2 = l => { let s = 0; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
// Every edge used by exactly two triangles, once each way (welded by position).
function closed(g) {
  const key = i => [0, 1, 2].map(k => Math.round(g.positions[3 * i + k] * 1e4)).join(',');
  const ids = new Map(), id = i => { const k = key(i); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const e = new Map();
  for (let t = 0; t < g.index.length; t += 3) for (let j = 0; j < 3; j++) {
    const a = id(g.index[t + j]), b = id(g.index[t + (j + 1) % 3]);
    if (a === b) continue;
    const k = a + '>' + b; e.set(k, (e.get(k) || 0) + 1);
  }
  for (const [k, n] of e) { const [a, b] = k.split('>'); if (n !== 1 || e.get(b + '>' + a) !== 1) return false; }
  return true;
}
function volume(g) {
  let v = 0; const P = g.positions, I = g.index;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

// An L profile (mm), material on the left: legs 20 thick, 100 wide and 80 high. On the inside face of the upright, five teeth
// (notches 2 wide, 3 deep); in the underside a slot 3 wide and 10 deep; on top of the foot a channel 30 wide (it must stay);
// a chamber in each leg (clockwise loops).
function lProfile() {
  const outer = [[0, 0], [38.5, 0], [38.5, 10], [41.5, 10], [41.5, 0], [100, 0], [100, 80], [80, 80]];
  for (const y of [70, 60, 50, 40, 30]) outer.push([80, y], [83, y], [83, y - 2], [80, y - 2]);
  outer.push([80, 20], [60, 20], [60, 15], [30, 15], [30, 20], [0, 20]);
  const holes = [[[5, 5], [5, 12], [25, 12], [25, 5]], [[88, 30], [88, 75], [95, 75], [95, 30]]];
  return { outer, holes };
}
// The profile's side walls along Z from 0 to len, CAD-like (no caps: the cut and the axis need only the sides), optionally turned
// so the axis is X (x, y, z) → (z, x, y).
function sides(loops, len, turn = false) {
  const pos = [], idx = [];
  for (const L of loops) {
    const n = L.length, b = pos.length / 3;
    for (const p of L) pos.push(p[0], p[1], 0);
    for (const p of L) pos.push(p[0], p[1], len);
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; idx.push(b + k, b + k1, b + n + k1, b + k, b + n + k1, b + n + k); }
  }
  if (turn) for (let i = 0; i < pos.length; i += 3) { const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]]; pos[i] = z; pos[i + 1] = x; pos[i + 2] = y; }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

{
  const { outer } = lProfile();
  ok(area2(outer) > 0, 'the test outline runs counter-clockwise');
  const f = fillNotches(outer, 5, 1e-6);
  ok(f.notches === 6, 'the five teeth and the slot are filled (' + f.notches + ')');
  ok(Math.abs(area2(f.loop) - 3050) < 1e-6, 'the outline is the plain L with its channel (area ' + area2(f.loop) + ', 3050 expected)');
  ok(f.loop.length === 10, 'ten corners are left: six of the L, four of the channel (' + f.loop.length + ')');
  ok(f.loop.some(p => p[0] === 80 && p[1] === 20), 'the inside corner of the L stays sharp');
  const narrow = fillNotches(outer, 1.5, 1e-6);
  ok(narrow.notches === 0, 'a width under the notches leaves them');
}

{
  const { outer, holes } = lProfile();
  for (const turn of [false, true]) {
    const g = sides([outer, ...holes], 200, turn);
    const r = cleanProfile(g.positions, g.index, { widthAbs: 5 });
    const tag = turn ? ' (along X)' : ' (along Z)';
    ok(r.ok, 'the part is taken for a profile' + tag + (r.why ? ': ' + r.why : ''));
    if (!r.ok) continue;
    ok(Math.abs(Math.abs(r.axis[turn ? 0 : 2]) - 1) < 1e-9 && Math.abs(r.length - 200) < 1e-3, 'its axis and length are found' + tag);
    ok(r.chambers === 2 && r.notches === 6, 'two chambers dropped, six notches filled' + tag + ' (' + r.chambers + ', ' + r.notches + ')');
    ok(closed(r), 'the new part is closed' + tag);
    ok(Math.abs(volume(r) - 3050 * 200) < 3050 * 200 * 1e-4, 'its volume is the solid L with its channel' + tag + ' (' + volume(r).toFixed(1) + ')');
    ok(r.after.triangles < r.before.triangles, 'it has fewer triangles' + tag + ' (' + r.before.triangles + ' → ' + r.after.triangles + ')');
  }
  // the chambers kept: the outline is cleaned, the caps have the chambers as holes, the part is closed
  const kc = cleanProfile(sides([outer, ...holes], 200).positions, sides([outer, ...holes], 200).index, { widthAbs: 5, keepChambers: true });
  ok(kc.ok && kc.chambers === 0 && kc.chambersFound === 2 && kc.notches === 6, 'Keep chambers: two found, none filled, six notches closed');
  ok(kc.ok && closed(kc), 'Keep chambers: the new part is closed (caps with holes)');
  ok(kc.ok && Math.abs(volume(kc) - (3050 - 140 - 315) * 200) < 1, 'Keep chambers: its volume leaves the chambers out (' + (kc.ok ? volume(kc).toFixed(1) : '-') + ')');
  ok(kc.ok && kc.profileAfter.length === 3 && kc.axisName === 'Z', 'Keep chambers: the new section is the outline and two chambers, along Z');
  const st = cleanProfile(sides([outer, ...holes], 200).positions, sides([outer, ...holes], 200).index, { widthAbs: 0, keepChambers: true, simplifyAbs: 0 });
  ok(st.ok && st.notches === 0 && st.profileAfter[0].length === outer.length, 'nothing to do: width 0, chambers kept, no straightening leaves the outline as it was');
  const only = cleanProfile(sides([outer, ...holes], 200).positions, sides([outer, ...holes], 200).index, { widthAbs: 0 });
  ok(only.ok && only.chambers === 2 && only.notches === 0, 'width 0 drops the chambers only');
}

{
  // the rebuilt part goes through again unchanged: caps at the ends count as caps
  const { outer } = lProfile();
  const g = extrudeLoops([outer], [0, 0, 1], [1, 0, 0], [0, 1, 0], -50, 150);
  ok(closed(g) && volume(g) > 0, 'extrudeLoops makes a closed part, faces out');
  const r = cleanProfile(g.positions, g.index, { widthAbs: 0 });
  ok(r.ok && r.chambers === 0 && Math.abs(r.length - 200) < 1e-3, 'a capped profile is found along its axis');
}

{
  // ends cut at an angle (a mitred frame member): 45° at one end, 26.6° at the other, chambers inside; the new part keeps both cuts
  const { outer, holes } = lProfile();
  const H0 = p => -p[0], H1 = p => 300 + 0.5 * p[1];
  const g = extrudeLoops([{ outer, holes }], [0, 0, 1], [1, 0, 0], [0, 1, 0], H0, H1);
  ok(closed(g), 'the mitred test part is closed');
  const r = cleanProfile(g.positions, g.index, { widthAbs: 5 });
  ok(r.ok, 'a mitred profile is taken' + (r.why ? ': ' + r.why : ''));
  if (r.ok) {
    ok(r.mitred && Math.abs(r.endAngles[0] - 45) < 0.1 && Math.abs(r.endAngles[1] - 26.6) < 0.1, 'both cuts are found (' + r.endAngles.join('°, ') + '°)');
    ok(r.chambers === 2 && r.notches === 6, 'its chambers are filled and its notches closed');
    ok(closed(r), 'the new mitred part is closed');
    // a prism cut by two planes: its volume is its area times its length at the centroid of the section
    const L = fillNotches(outer, 5, 1e-6).loop; let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length], c = p[0] * q[1] - q[0] * p[1]; A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
    A /= 2; cx /= 6 * A; cy /= 6 * A;
    const want = A * (H1([cx, cy]) - H0([cx, cy]));
    ok(Math.abs(volume(r) - want) < want * 1e-4, 'its volume follows both cuts (' + volume(r).toFixed(0) + ', ' + want.toFixed(0) + ' expected)');
    const pts = []; for (let i = 0; i < r.positions.length; i += 3) pts.push([r.positions[i], r.positions[i + 1], r.positions[i + 2]]);
    ok(pts.every(p => Math.abs(p[2] - H0(p)) < 1e-3 || Math.abs(p[2] - H1(p)) < 1e-3), 'every point of it lies on one of the two cuts');
  }
  const steep = extrudeLoops([outer], [0, 0, 1], [1, 0, 0], [0, 1, 0], p => -6 * p[0], 1200);
  const s = cleanProfile(steep.positions, steep.index);
  ok(!s.ok && /75°/.test(s.why || ''), 'a cut steeper than 75° is refused (' + (s.why || 'taken') + ')');
}

{
  // a long member (15 m) with a hairline slot and a chamber wall 0.2 mm thin: the tolerances go by the size across, not the length
  // (they went by the whole size: points 0.15 mm apart were one point and the cut through the part did not close)
  const g = 0.2, o = [[0, 0], [100, 0], [100, 60], [60 + g, 60], [60 + g, 40], [60, 40], [60, 60], [0, 60]];
  const m = extrudeLoops([{ outer: o, holes: [[[g, 10], [g, 50], [20, 50], [20, 10]]] }], [0, 0, 1], [1, 0, 0], [0, 1, 0], p => 0.5 * p[0], p => 15000 - 0.3 * p[1]);
  for (const keepChambers of [false, true]) {
    const r = cleanProfile(m.positions, m.index, { widthAbs: 0, keepChambers });
    ok(r.ok && closed(r) && volume(r) > 0, 'a 15 m member with 0.2 mm details is taken and comes out closed, faces out' + (keepChambers ? ' (chambers kept)' : '') + (r.why ? ': ' + r.why : ''));
  }
}

{
  // Fill holes and cuts across: the L (chambers, teeth, slot, channel) 300 long with a slot sawn through its foot and a hole drilled
  // through its upright (Manifold, as the app's booleans); a mitred bar with a notch in one end; a block that is mostly a pocket
  const { runBoolean } = await import('../app/js/meshops.js');
  const { outer, holes } = lProfile();
  const bar = extrudeLoops([{ outer, holes }], [0, 0, 1], [1, 0, 0], [0, 1, 0], 0, 300);
  const slot = extrudeLoops([[[45, -5], [50, -5], [50, 25], [45, 25]]], [0, 0, 1], [1, 0, 0], [0, 1, 0], 100, 108);
  const circle = Array.from({ length: 24 }, (_, k) => [50 + 3 * Math.cos(k / 24 * 2 * Math.PI), 200 + 3 * Math.sin(k / 24 * 2 * Math.PI)]);
  const drill = extrudeLoops([circle], [1, 0, 0], [0, 1, 0], [0, 0, 1], 70, 110);
  const cut1 = await runBoolean('subtract', bar, slot), cut = await runBoolean('subtract', { positions: cut1.positions, index: cut1.index }, drill);
  ok(cut.ok, 'the machined test bar is made');
  const strict = cleanProfile(cut.positions, cut.index, { widthAbs: 5 });
  ok(!strict.ok, 'without Fill holes and cuts across it is refused (' + (strict.why || 'taken') + ')');
  const r = cleanProfile(cut.positions, cut.index, { widthAbs: 5, fillMachining: true });
  ok(r.ok && r.machined, 'with it, it is taken, and said to have machining' + (r.why ? ': ' + r.why : ''));
  if (r.ok) {
    ok(Math.abs(r.length - 300) < 1e-3 && r.chambers === 2 && r.notches === 6, 'the bar is found whole: 300 long, two chambers, six notches (' + r.length + ', ' + r.chambers + ', ' + r.notches + ')');
    ok(closed(r) && Math.abs(volume(r) - 3050 * 300) < 3050 * 300 * 1e-4, 'the slot and the hole are gone: closed, the volume of the clean L (' + volume(r).toFixed(0) + ')');
  }
  // a mitred bar (45°) with a notch sawn into the mitred end: the end is still the big cut
  const mit = extrudeLoops([[[0, 0], [40, 0], [40, 20], [0, 20]]], [0, 0, 1], [1, 0, 0], [0, 1, 0], p => p[0], 400);
  const notch = extrudeLoops([[[15, -5], [25, -5], [25, 8], [15, 8]]], [0, 0, 1], [1, 0, 0], [0, 1, 0], -10, 30);
  const mn = await runBoolean('subtract', mit, notch);
  const rm = cleanProfile(mn.positions, mn.index, { widthAbs: 0, fillMachining: true });
  ok(rm.ok && Math.abs(rm.endAngles[0] - 45) < 0.5 && rm.endAngles[1] === 0, 'a notch in a mitred end: the 45° cut is kept (' + (rm.ok ? rm.endAngles.join('°, ') + '°' : rm.why) + ')');
  ok(rm.ok && closed(rm) && Math.abs(volume(rm) - 800 * (400 - 20)) < 800 * 380 * 1e-3, 'and the notch is filled (volume ' + (rm.ok ? volume(rm).toFixed(0) : '-') + ', ' + 800 * 380 + ' expected)');
  // a block with a pocket along most of it is not a profile with a few cuts
  const blk = extrudeLoops([[[0, 0], [60, 0], [60, 40], [0, 40]]], [0, 0, 1], [1, 0, 0], [0, 1, 0], 0, 100);
  const pocket = extrudeLoops([[[10, 10], [50, 10], [50, 50], [10, 50]]], [0, 0, 1], [1, 0, 0], [0, 1, 0], 15, 85);
  const pk = await runBoolean('subtract', blk, pocket);
  const rp = cleanProfile(pk.positions, pk.index, { fillMachining: true });
  ok(!rp.ok, 'a block that is mostly a pocket is refused (' + (rp.why || 'taken') + ')');
}

{
  // a section edited by hand: built as given, along the bar and between its cuts
  const { outer } = lProfile();
  const g = extrudeLoops([outer], [0, 0, 1], [1, 0, 0], [0, 1, 0], p => -0.5 * p[0], 200);
  const tri = { outer: [[0, 0], [100, 0], [0, 80]], holes: [[[10, 10], [10, 20], [20, 10]]] };
  const r = cleanProfile(g.positions, g.index, { shapes: [tri] });
  ok(r.ok && r.edited && r.profileAfter.length === 2, 'a given section is taken as it is');
  if (r.ok) {
    // (the section's own x runs along world Y and its y along world −X, so the near cut, h = −0.5·X, is h = 0.5·y there)
    const A = 100 * 80 / 2 - 50, cy = (100 * 80 / 2 * (80 / 3) - 50 * (40 / 3)) / A;
    ok(closed(r) && Math.abs(volume(r) - A * (200 - 0.5 * cy)) < A * 200 * 1e-4, 'and built closed between the bar\'s two cuts (' + volume(r).toFixed(0) + ')');
  }
  const back = cleanProfile(g.positions, g.index, { shapes: [{ outer: tri.outer.slice().reverse(), holes: [tri.holes[0].slice().reverse()] }] });
  ok(back.ok && closed(back) && volume(back) > 0, 'a given section the other way round is turned the right way');
}

{
  // bent profiles: a section (an outline 40 x 20 with a notch 2 wide and a chamber) swept round half a circle of radius 300 in 96
  // steps, and a round tube (radius 15, wall 2) bent a quarter turn at radius 120; both found, cleaned and swept again
  const arc = (R, th, n, sec) => {
    const path = [], frames = [];
    for (let i = 0; i <= n; i++) { const a = th * i / n, t = [-Math.sin(a), Math.cos(a), 0], f1 = [0, 0, 1], f2 = [t[1] * f1[2] - t[2] * f1[1], t[2] * f1[0] - t[0] * f1[2], t[0] * f1[1] - t[1] * f1[0]]; path.push([R * Math.cos(a), R * Math.sin(a), 0]); frames.push([f1, f2]); }
    return sweepOpen(sec, path, frames);
  };
  const out = [[-20, -10], [20, -10], [20, 10], [1, 10], [1, 4], [-1, 4], [-1, 10], [-20, 10]], ch = [[-15, -5], [-15, 5], [-5, 5], [-5, -5]];
  const g = arc(300, Math.PI, 96, [{ outer: out, holes: [ch] }]);
  ok(closed(g) && volume(g) > 0, 'the bent test part is closed');
  const r = cleanProfile(g.positions, g.index, { widthAbs: 3 });
  ok(r.ok && r.curved, 'a profile bent round half a circle is found' + (r.why ? ': ' + r.why : ''));
  if (r.ok) {
    ok(r.chambers === 1 && r.notches === 1 && Math.abs(r.turnDeg - 180) < 3, 'its chamber and notch are filled, and it turns 180° (' + r.chambers + ', ' + r.notches + ', ' + r.turnDeg + '°)');
    // Pappus: the solid 40 x 20 section (its middle on the arc) swept 180° at radius 300; the polyline of the walk is a little inside
    const want = 800 * Math.PI * 300;
    ok(closed(r) && Math.abs(volume(r) - want) < want * 0.01, 'swept again: closed, and the volume of the clean section round the arc (' + volume(r).toFixed(0) + ', ' + want.toFixed(0) + ')');
    ok(r.after.triangles < g.index.length / 3, 'with fewer triangles (' + g.index.length / 3 + ' → ' + r.after.triangles + ')');
  }
  const ring = (rad, n) => Array.from({ length: n }, (_, k) => [rad * Math.cos(k / n * 2 * Math.PI), rad * Math.sin(k / n * 2 * Math.PI)]);
  const tube = arc(120, Math.PI / 2, 48, [{ outer: ring(15, 32), holes: [ring(13, 32).reverse()] }]);
  const rt = cleanProfile(tube.positions, tube.index, { widthAbs: 0, keepChambers: true });
  ok(rt.ok && rt.curved && rt.chambersFound === 1 && closed(rt) && volume(rt) > 0, 'a bent tube is found, its bore kept, and swept again closed' + (rt.why ? ': ' + rt.why : ''));
  // still refused: a pyramid, and a straight bar with a step in it
  const pyr = { positions: new Float32Array([0, 0, 0, 40, 0, 0, 40, 40, 0, 0, 40, 0, 20, 20, 50]), index: new Uint32Array([0, 3, 2, 0, 2, 1, 0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]) };
  ok(!cleanProfile(pyr.positions, pyr.index).ok, 'a pyramid is not a profile, straight or bent');
}

{
  // an end with a step in it: not one profile
  const { outer } = lProfile();
  const g = extrudeLoops([outer], [0, 0, 1], [1, 0, 0], [0, 1, 0], 0, 200);
  for (let i = 0; i < g.positions.length; i += 3) if (g.positions[i + 2] > 100 && g.positions[i] > 50) g.positions[i + 2] += 30;
  const r = cleanProfile(g.positions, g.index);
  ok(!r.ok && /not a profile/.test(r.why || ''), 'a part with a stepped end is refused (' + (r.why || 'taken') + ')');
}

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
