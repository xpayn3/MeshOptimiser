// node tests/revolve.test.mjs — checks revolve.js (Fill grooves on round parts) on shapes built here.
import { fillRoundGrooves, fillGrooves, revolveLoops, simplifyLoop, outlineRevolve, sweepBelt, sweepLoops } from '../app/js/revolve.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// Spin a profile into a CAD-like mesh (each band its own vertices), around Z, with N segments.
function spin(profile, N = 48, axis = 'z') {
  const g = revolveLoops([profile], [0, 0, 0], axis === 'z' ? [0, 0, 1] : [0, 1, 0], N, 0, 1e-6, 0);
  return { positions: g.positions, index: g.index };
}
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

// A spool with a bore: lips at both ends (r 20), a body (r 15) with five V ridges up to r 17, bore r 5.
// Profile in (h, r), material on the left (counter-clockwise).
function spoolProfile() {
  const top = [];
  // walking with material on the left along the outside means going from +h to −h
  top.push([40, 20], [36, 20], [36, 15]);
  for (let i = 0; i < 5; i++) { const h = 33 - i * 6; top.push([h + 1.5, 15], [h, 17], [h - 1.5, 15]); }
  top.push([4, 15], [4, 20], [0, 20], [0, 5], [40, 5]);
  return top;
}

{
  const prof = spoolProfile();
  const f = fillGrooves([prof], 7, 1e-6);
  ok(f.grooves >= 4, 'the valleys between the ridges are filled (' + f.grooves + ' fills)');
  const L = f.loops[0];
  const at17 = L.filter(p => Math.abs(p[1] - 17) < 1e-6).length;
  ok(at17 === 2, 'the filled band is one flat line at the ridge tops');
  ok(L.some(p => p[0] === 36 && p[1] === 20) && L.some(p => p[0] === 4 && p[1] === 20), 'the lips keep their sharp corners');
  ok(L.filter(p => Math.abs(p[1] - 5) < 1e-6).length === 2, 'the bore is untouched');
  const wide = fillGrooves([prof], 2, 1e-6);
  ok(wide.grooves === 0 || wide.loops[0].length >= prof.length - 2, 'a width below the ridge spacing leaves the ridges');
}

{
  const g = spin(spoolProfile(), 48);
  const r = fillRoundGrooves(g.positions, g.index, { width: 7 });
  ok(r.ok, 'the spool is found to be round' + (r.why ? ' (' + r.why + ')' : ''));
  ok(r.ok && Math.abs(Math.abs(r.axis[2]) - 1) < 1e-6, 'its axis is Z');
  ok(r.ok && r.segments === 48, 'it keeps its 48 segments (' + r.segments + ')');
  ok(r.ok && r.after.triangles < r.before.triangles, 'fewer triangles: ' + r.before.triangles + ' → ' + (r.after && r.after.triangles));
  const out = { positions: r.positions, index: r.index };
  ok(r.ok && closed(out), 'the rebuilt part is closed');
  ok(r.ok && volume(out) > volume(g), 'it has more volume than before (the grooves are solid now)');
  const dry = fillRoundGrooves(g.positions, g.index, { width: 7, dryRun: true });
  ok(dry.ok && !dry.positions && dry.grooves === r.grooves, 'a dry run measures without building');
}

{
  // A solid shaft (no bore) with three grooves, whose flat ends are fanned from a point on the rim, not from the centre (as a CAD
  // tessellation often does): the cut through it crosses the axis on both ends. It must be taken, not refused for gaps.
  const prof = [[0, 0], [0, 6]];
  for (let i = 0; i < 3; i++) { const h = 4 + i * 6; prof.push([h, 6], [h, 4.5], [h + 2, 4.5], [h + 2, 6]); }
  prof.push([24, 6], [24, 0]);
  const N = 32, side = spin(prof.map(([h, r]) => [h, r]).reverse(), N);
  // drop the triangles that touch the axis (the fans revolveLoops made round the centre) and close each end with a fan from the rim
  const P = Array.from(side.positions), I = [];
  for (let t = 0; t < side.index.length; t += 3) { const v = [side.index[t], side.index[t + 1], side.index[t + 2]]; if (v.some(i => Math.hypot(P[3 * i], P[3 * i + 1]) < 1e-6)) continue; I.push(...v); }
  for (const [z, up] of [[0, false], [24, true]]) {
    const ring = []; for (let s = 0; s < N; s++) { const a = s * 2 * Math.PI / N; ring.push(P.length / 3); P.push(6 * Math.cos(a), 6 * Math.sin(a), z); }
    for (let s = 1; s + 1 < N; s++) I.push(...(up ? [ring[0], ring[s], ring[s + 1]] : [ring[0], ring[s + 1], ring[s]]));
  }
  const r = fillRoundGrooves(new Float32Array(P), new Uint32Array(I), { width: 3 });
  ok(r.ok, 'a solid shaft whose ends are fanned from the rim is taken' + (r.why ? ' (' + r.why + ')' : ''));
  ok(r.ok && r.grooves === 3 && closed({ positions: r.positions, index: r.index }), 'its three grooves are filled and it comes out closed (' + (r.grooves | 0) + ')');
}

{
  // A box is round around no axis.
  const P = [], I = [];
  const v = [[0, 0, 0], [30, 0, 0], [30, 10, 0], [0, 10, 0], [0, 0, 5], [30, 0, 5], [30, 10, 5], [0, 10, 5]];
  for (const p of v) P.push(...p);
  for (const f of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) I.push(...f);
  const r = fillRoundGrooves(new Float32Array(P), new Uint32Array(I));
  ok(!r.ok && /round/.test(r.why || ''), 'a box is refused: ' + r.why);
}

{
  // A spool with one bolt hole drilled through a lip is not round: refused, nothing built.
  const g = spin(spoolProfile(), 48);
  // Push the vertices of one segment column inwards on the lip, as a stand-in for a feature off the axis.
  const P = g.positions.slice();
  for (let i = 0; i < P.length; i += 3) {
    const a = Math.atan2(P[i + 1], P[i]), r = Math.hypot(P[i], P[i + 1]);
    if (Math.abs(a - Math.PI / 4) < 0.2 && r > 19) { P[i] *= 0.8; P[i + 1] *= 0.8; }
  }
  const r = fillRoundGrooves(P, g.index, { width: 7 });
  ok(!r.ok, 'a part with a dent off the axis is refused' + (r.why ? ': ' + r.why : ''));
}

{
  // Loops that do nothing: a hair-thin step, a wall a few hundredths proud, a chamfer cut in two. A real chamfer and a step stay.
  const L = [[40, 20], [36, 20], [36, 15], [20, 15], [19.99, 15.002], [10, 15.002], [4, 15], [4, 20], [1, 20], [0.5, 19.52], [0, 19], [0, 5], [15, 5], [25, 5.03], [40, 5]];
  const s = simplifyLoop(L, 0.05);
  ok(s.length === 9, 'the step, the proud points and the split chamfer go (' + L.length + ' → ' + s.length + ' points)');
  ok(s.some(p => p[0] === 36 && p[1] === 15) && s.some(p => p[0] === 1 && p[1] === 20) && s.some(p => p[0] === 0 && p[1] === 19), 'the corners and the real chamfer stay');
  // a fine arc of many points may not creep away: every point stays within tol of the result
  const arc = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI / 2; arc.push([10 * Math.cos(a), 10 * Math.sin(a)]); }
  arc.push([0, 0]);
  const sa = simplifyLoop(arc, 0.05);
  let worst = 0;
  for (const q of arc) { let d = Infinity; for (let k = 0; k < sa.length; k++) { const a = sa[k], b = sa[(k + 1) % sa.length], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2)); d = Math.min(d, Math.hypot(a[0] + t * ex - q[0], a[1] + t * ey - q[1])); } worst = Math.max(worst, d); }
  ok(worst <= 0.05 + 1e-9 && sa.length < arc.length && sa.length > 5, 'an arc keeps within the tolerance (' + arc.length + ' → ' + sa.length + ' points, off by ' + worst.toFixed(3) + ')');
}

{
  // Outline mode: a solid hub (r 10, h 0..10) with 12 loose fins (r 10.3..30, h 2..8, 1 thick) that do not touch it.
  const P = [], I = [];
  const hub = spin([[10, 0], [10, 10], [0, 10], [0, 0]].map(([r, h]) => [h, r]).reverse(), 48);
  // (spin wants (h, r) counter-clockwise; the hub as written above is h along Z)
  P.push(...hub.positions); I.push(...hub.index);
  const box = (cx, cy, ang, r0, r1, z0, z1, t) => {
    const ca = Math.cos(ang), sa = Math.sin(ang), base = P.length / 3;
    const pt = (r, s, z) => [cx + r * ca - s * sa, cy + r * sa + s * ca, z];
    for (const [r, s, z] of [[r0, -t, z0], [r1, -t, z0], [r1, t, z0], [r0, t, z0], [r0, -t, z1], [r1, -t, z1], [r1, t, z1], [r0, t, z1]]) P.push(...pt(r, s, z));
    for (const f of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) I.push(...f.map(k => base + k));
  };
  for (let k = 0; k < 12; k++) box(0, 0, k * Math.PI / 6, 10.3, 30, 2, 8, 0.5);
  const g = { positions: new Float32Array(P), index: new Uint32Array(I) };
  const exact = fillRoundGrooves(g.positions, g.index);
  ok(!exact.ok, 'the exact mode refuses the finned part');
  const r = outlineRevolve(g.positions, g.index, { width: 0 });
  ok(r.ok, 'outline mode takes it' + (r.why ? ' (' + r.why + ')' : ''));
  if (r.ok) {
    const out = { positions: r.positions, index: r.index };
    ok(closed(out), 'the result is closed');
    let rMax = 0, zLo = Infinity, zHi = -Infinity;
    for (let i = 0; i < out.positions.length; i += 3) { const rr = Math.hypot(out.positions[i], out.positions[i + 1]); if (rr > rMax) rMax = rr; }
    for (let i = 0; i < out.positions.length; i += 3) if (Math.hypot(out.positions[i], out.positions[i + 1]) > 20) { zLo = Math.min(zLo, out.positions[i + 2]); zHi = Math.max(zHi, out.positions[i + 2]); }
    ok(Math.abs(rMax - 30) < 0.3, 'the fins become a solid ring out to their tips (r ' + rMax.toFixed(2) + ')');
    ok(Math.abs(zLo - 2) < 0.3 && Math.abs(zHi - 8) < 0.3, 'as wide as the fins (' + zLo.toFixed(2) + ' to ' + zHi.toFixed(2) + ')');
    ok(volume(out) > 0, 'it faces outwards');
  }
}

{
  // The Phong angle round the axis: 8 segments meet at 45°, over the 30° default, so each face is lit flat (all three corners of
  // a triangle share its face's own normal); 48 segments meet at 7.5°, so the shading is smooth round the part.
  const prof = [[10, 5], [0, 5], [0, 4], [10, 4]].map(([h, r]) => [h, r]);      // a ring: r 4..5, h 0..10
  const faceAgree = (g) => {
    let flat = 0, smooth = 0;
    for (let t = 0; t < g.index.length; t += 3) {
      const v = [0, 1, 2].map(k => g.index[t + k]);
      const P = v.map(i => [g.positions[3 * i], g.positions[3 * i + 1], g.positions[3 * i + 2]]);
      const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], w = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const fn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...fn);
      const ok = v.every(i => (g.normals[3 * i] * fn[0] + g.normals[3 * i + 1] * fn[1] + g.normals[3 * i + 2] * fn[2]) / l > 0.9999);
      ok ? flat++ : smooth++;
    }
    return { flat, smooth };
  };
  const g8 = revolveLoops([prof], [0, 0, 0], [0, 0, 1], 8, 0, 1e-6, 30);
  const g48 = revolveLoops([prof], [0, 0, 0], [0, 0, 1], 48, 0, 1e-6, 30);
  const a8 = faceAgree(g8), a48 = faceAgree(g48);
  ok(a8.smooth === 0, '8 segments (45° apart): every face lit flat (' + a8.flat + ' flat, ' + a8.smooth + ' not)');
  ok(a48.smooth > 0, '48 segments (7.5° apart): the round faces are shaded smooth (' + a48.smooth + ' smooth)');
  const g16 = revolveLoops([prof], [0, 0, 0], [0, 0, 1], 16, 0, 1e-6, 20);
  ok(faceAgree(g16).smooth === 0, 'Smooth up to 20°: 16 segments (22.5° apart) are flat');
  ok(closed(g8) && closed(g16), 'flat or smooth, the part stays closed');
}

{
  // Belt mode: a band 20 wide (z) and 3 thick with four V-ribs 2 deep (z 2 to 18) on its inside, swept along a stadium (two pulleys of
  // radius 60, 200 apart), as a CAD file would have it. The ribs are filled flush with their tips; the band stays closed.
  const prof = [[0, 0], [0, 3]];
  prof.push([2, 3]);
  for (let i = 0; i < 4; i++) { const z = 2 + i * 4; prof.push([z + 2, 5], [z + 4, 3]); }      // (rib after rib: each ends where the next begins)
  prof.push([20, 3], [20, 0]);
  // (z, d) with material on the left: walk the back from z 20 to 0, then the ribs from z 0 to 20
  const loop = prof.slice().reverse();
  const path = [];
  for (let i = 0; i <= 24; i++) { const a = -Math.PI / 2 + i / 24 * Math.PI; path.push([100 + 60 * Math.cos(a), 60 * Math.sin(a)]); }
  for (let i = 0; i <= 24; i++) { const a = Math.PI / 2 + i / 24 * Math.PI; path.push([-100 + 60 * Math.cos(a), 60 * Math.sin(a)]); }
  const g = sweepLoops([loop], { path, c: [0, 0, 0], e1: [1, 0, 0], e2: [0, 1, 0], Z: [0, 0, 1] }, 30);
  ok(closed(g), 'the made-up ribbed belt is closed');
  const r = sweepBelt(g.positions, g.index, {});
  ok(r.ok, 'belt mode takes it' + (r.why ? ' (' + r.why + ')' : ''));
  if (r.ok) {
    ok(r.grooves === 3, 'the room between the four ribs is filled: three gaps (' + r.grooves + ')');
    const L = r.profileAfter[0], ds = L.map(p => p[1]), zs = L.map(p => p[0]);
    ok(Math.max(...ds) > 4.7 && Math.max(...ds) < 5.3 && Math.abs(Math.max(...zs) - Math.min(...zs) - 20) < 0.5, 'the cross-section is the band out to the rib tips (' + (Math.max(...ds) - Math.min(...ds)).toFixed(2) + ' deep, ' + (Math.max(...zs) - Math.min(...zs)).toFixed(2) + ' wide)');
    ok(L.length === 8 && L.filter(p => Math.abs(p[1] - Math.max(...ds)) < 0.2).length === 2, 'one flat line across the rib tips; the outer flanks of the first and last rib stay (' + L.length + ' points)');
    const out = { positions: r.positions, index: r.index };
    ok(closed(out), 'the rebuilt belt is closed');
    ok(r.after.triangles < g.index.length / 3, 'fewer triangles: ' + g.index.length / 3 + ' → ' + r.after.triangles);
  }
  // a round part is not a belt: no opening in its shadow
  const spool = spin(spoolProfile(), 48);
  ok(!sweepBelt(spool.positions, spool.index).ok, 'a spool is not taken for a belt');
}

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
