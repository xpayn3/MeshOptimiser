// Renders the clip at the top of the Select hidden card (assets/help/select-hidden.webm and select-hidden-poster.webp).
//
// A closed gearbox: a housing with a lid, four lid screws and an output collar are all you can see.
// Then the housing turns to glass and the parts nobody can see from outside (the motor, three
// meshing gears, four bearings, a circuit board with its chips, two screws, a spring, a retaining
// ring) turn the accent blue, and the clip lets go again. The gears turn the whole time, so it
// loops: each one advances a whole number of teeth that is a multiple of its lightening-hole pattern.
//
//   node tools/render-select-hidden-clip.mjs               renders the clip and the poster
//   node tools/render-select-hidden-clip.mjs --still=0.5   one frame at t = 0.5 as tools/still.png (to look at)
//
// ffmpeg must be on the PATH, or named in FFMPEG. The drawing is in clip-kit.mjs.
import { T, rrect, hole, ext, lathe, alongZ, merge, prepare, smooth, gearGeometry, run } from './clip-kit.mjs';

// Millimetres, z up. The housing stands on x 0..140, y 0..96, z 0..56 with a 4 mm lid on top.
const SOFT = { bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelOffset: 0, bevelSegments: 2, curveSegments: 40 };
const FLAT = { bevelEnabled: false, curveSegments: 40 };
const at = (g, x, y, z) => g.translate(x, y, z);

// ── the shell ─────────────────────────────────────────────────────────────────────────────────────
function buildHousing() {                              // walls (a rounded frame), a floor and four corner posts
  const walls = rrect(0, 0, 140, 96, 8); walls.holes.push(rrect(3, 3, 134, 90, 5));
  const floor = rrect(0, 0, 140, 96, 8);
  const g = [ext(walls, 56 - 1, { ...SOFT, bevelThickness: 0.8, bevelSize: 0.8 }), ext(floor, 3 - 1, SOFT)];
  for (const [x, y] of [[9, 9], [131, 9], [9, 87], [131, 87]]) g.push(at(new T.CylinderGeometry(6, 6, 53, 40).rotateX(Math.PI / 2), x, y, 3 + 26.5));
  return merge(g);
}
const OUT = { x: 108, y: 70 };                         // the output shaft (see the gears below)
function buildLid() {                                  // the lid: four screw holes, the bore for the output collar, a vent slot
  const s = rrect(0, 0, 140, 96, 8);
  for (const [x, y] of [[9, 9], [131, 9], [9, 87], [131, 87]]) hole(s, x, y, 2.9);
  hole(s, OUT.x, OUT.y, 7.2);
  const slotP = new T.Path(); const sx = 30, sy = 20; slotP.moveTo(sx, sy - 2); slotP.lineTo(sx + 36, sy - 2); slotP.absarc(sx + 36, sy, 2, -Math.PI / 2, Math.PI / 2, false); slotP.lineTo(sx, sy + 2); slotP.absarc(sx, sy, 2, Math.PI / 2, Math.PI * 1.5, false); s.holes.push(slotP);
  return merge([ext(s, 4 - 1, { ...SOFT, bevelThickness: 0.8, bevelSize: 0.8 }).translate(0, 0, 56.8)]);
}
function buildLidScrew(x, y) {                         // M6 cap screw: hex head, washer, a short thread under the lid
  const head = alongZ(new T.CylinderGeometry(5.2, 5.2, 4, 6, 1).translate(0, 2, 0), x, y, 60.4);
  const dome = alongZ(lathe([[0, 4], [3.4, 4], [4.4, 3.2], [4.8, 2.4], [0, 2.4]], 40), x, y, 60.4);
  const wash = alongZ(lathe([[2.8, 0], [7, 0], [7, 0.8], [2.8, 0.8]], 48), x, y, 60);
  return merge([head, dome, wash]);
}
function buildCollar() {                               // the output collar sticking out of the lid: a stepped hub with a keyway and a set screw
  const pts = [[0, 0], [7, 0], [7, 4], [6, 4.8], [6, 16], [5.4, 17], [0, 17]];
  const g = alongZ(lathe(pts, 64), OUT.x, OUT.y, 57);
  const key = new T.BoxGeometry(2.4, 2.4, 11).translate(OUT.x + 5.7, OUT.y, 57 + 12.5);
  const flange = alongZ(lathe([[0, 0], [9.6, 0], [9.6, 2], [0, 2]], 64), OUT.x, OUT.y, 60.4 + 0.1);
  return merge([g, key, flange]);
}

// ── the parts inside ──────────────────────────────────────────────────────────────────────────────
const GEAR_Z = 34, GEAR_W = 8;
const buildGear = (n, m, bore, holes, holeR, holeRing, hubR) => gearGeometry(n, m, bore, holes, holeR, holeRing, hubR, GEAR_W);
const GP = { x: 30, y: 48 }, GI = { x: 70, y: 48 };
const NP = 12, NI = 28, NO = 16, MOD = 2;
const phi = Math.atan2(OUT.y - GI.y, OUT.x - GI.x);     // from the idler toward the output gear

function buildMotor() {                                 // the can, an end cap with terminals, the shaft
  const can = alongZ(lathe([[0, 0], [14, 0], [14, 25], [13, 26.5], [11, 26.5], [11, 27.5], [4.5, 27.5], [4.5, 29], [0, 29]], 72), GP.x, GP.y, 3);
  const shaft = alongZ(lathe([[0, 29], [2.5, 29], [2.5, 43], [0, 43]], 40), GP.x, GP.y, 3);
  const t1 = new T.BoxGeometry(1.2, 3.4, 5).translate(GP.x - 5, GP.y, 3 - 2.5), t2 = new T.BoxGeometry(1.2, 3.4, 5).translate(GP.x + 5, GP.y, 3 - 2.5);
  return merge([can, shaft, t1, t2]);
}
function buildShaft(x, y, z0, z1, r) {
  return alongZ(lathe([[0, 0], [r - 0.4, 0], [r, 0.4], [r, z1 - z0 - 0.4], [r - 0.4, z1 - z0], [0, z1 - z0]], 40), x, y, z0);
}
function buildBearing(x, y, z0) {                       // outer ring, inner ring and a ring of balls between them
  const w = 7, ro = 9, ri = 5.2, g = [];
  g.push(alongZ(lathe([[7.4, 0], [ro - 0.5, 0], [ro, 0.5], [ro, w - 0.5], [ro - 0.5, w], [7.4, w], [7.4, w - 1.2], [7.9, 2.6], [7.9, 1.2], [7.4, 1.2]], 64), x, y, z0));
  g.push(alongZ(lathe([[4, 0.2], [ri + 1.6, 0.2], [ri + 1.9, 1.2], [ri + 1.9, w - 1.2], [ri + 1.6, w - 0.2], [4, w - 0.2]], 64), x, y, z0));
  for (let k = 0; k < 9; k++) { const a = k * Math.PI * 2 / 9; g.push(new T.SphereGeometry(1.45, 16, 12).translate(x + 6.65 * Math.cos(a), y + 6.65 * Math.sin(a), z0 + w / 2)); }
  return merge(g);
}
function buildPcb() {                                   // the board, with mounting holes and a connector
  const s = rrect(55, 8, 72, 20, 2.5); hole(s, 58, 11, 1.7); hole(s, 124, 25, 1.7); hole(s, 58, 25, 1.7); hole(s, 124, 11, 1.7);
  return merge([ext(s, 1.6 - 0.4, { ...SOFT, bevelThickness: 0.2, bevelSize: 0.2 }).translate(0, 0, 8.2), new T.BoxGeometry(12, 5, 5).translate(121, 21, 10 + 2.5 - 0.0)]);
}
const chip = (x, y, w, d, h, z = 10) => { const g = [new T.BoxGeometry(w, d, h).translate(x, y, z + h / 2)]; for (let k = 0; k < 8; k++) { const f = (k % 4 - 1.5) * (w / 4), side = k < 4 ? 1 : -1; g.push(new T.BoxGeometry(0.7, 1.4, 0.4).translate(x + f, y + side * (d / 2 + 0.5), z + 0.4)); } return merge(g); };
function buildPcbScrew(x, y) {                          // a pan-head screw with a washer on the board
  const wash = alongZ(lathe([[1.9, 0], [3.4, 0], [3.4, 0.7], [1.9, 0.7]], 32), x, y, 9.8);
  const head = alongZ(lathe([[0, 10.5], [3.1, 10.5], [3.1, 12.1], [2.4, 12.9], [0, 12.9]], 40), x, y, 0);
  const slotCut = new T.BoxGeometry(5.4, 0.9, 0.5).translate(x, y, 12.85);
  const shank = alongZ(lathe([[0, 3], [1.5, 3], [1.5, 10.6], [0, 10.6]], 24), x, y, 0);
  return merge([wash, head, slotCut, shank]);
}
function buildSpring(x, y, z0, z1) {                    // a compression spring (a tube along a helix) between two flat caps
  const turns = 8, R = 6, pts = [], steps = turns * 28;
  for (let i = 0; i <= steps; i++) { const a = i / 28 * Math.PI * 2, z = z0 + 1.2 + (z1 - z0 - 2.4) * i / steps; pts.push(new T.Vector3(x + R * Math.cos(a), y + R * Math.sin(a), z)); }
  const tube = new T.TubeGeometry(new T.CatmullRomCurve3(pts), steps * 2, 1.15, 10, false);
  const cap = (z) => alongZ(lathe([[0, 0], [8, 0], [8, 1.2], [0, 1.2]], 40), x, y, z);
  return merge([tube, cap(z0), cap(z1 - 1.2)]);
}
function buildRing(x, y, z) {                           // a C-shaped retaining ring in a groove of the output shaft
  const s = new T.Shape(), a0 = 0.5, a1 = Math.PI * 2 - 0.5, ro = 7.4, ri = 4.6;
  s.absarc(0, 0, ro, a0, a1, false); s.lineTo(ri * Math.cos(a1), ri * Math.sin(a1)); s.absarc(0, 0, ri, a1, a0, true); s.closePath();
  return ext(s, 1.2 - 0.2, { bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 1, curveSegments: 32 }).translate(x, y, z);
}

// ── the scene ──────────────────────────────────────────────────────────────────────────────────────
const SHELL = [buildHousing(), buildLid()];
const SEEN = [[9, 9], [131, 9], [9, 87], [131, 87]].map(([x, y]) => buildLidScrew(x, y)).concat([buildCollar()]);
const HIDDEN = [
  { g: buildMotor(), turn: null },
  { g: buildGear(NP, MOD, 2.5, 0, 0, 0, 4.6), turn: { c: GP, ratio: 1, phase: 0 } },
  { g: buildGear(NI, MOD, 4, 7, 3.4, 18, 8), turn: { c: GI, ratio: -NP / NI, phase: Math.PI + Math.PI / NI } },
  { g: buildGear(NO, MOD, 5, 4, 2.7, 10, 7.4), turn: { c: OUT, ratio: NP / NO, phase: 0 /* set below */ } },
  { g: buildShaft(GI.x, GI.y, 3, 53, 4), turn: null },
  { g: buildShaft(OUT.x, OUT.y, 3, 55, 5), turn: null },
  { g: buildBearing(GI.x, GI.y, 3), turn: null }, { g: buildBearing(GI.x, GI.y, 46), turn: null },
  { g: buildBearing(OUT.x, OUT.y, 3), turn: null }, { g: buildBearing(OUT.x, OUT.y, 46), turn: null },
  { g: buildPcb(), turn: null },
  { g: chip(70, 19, 11, 8, 2.6), turn: null }, { g: chip(92, 17, 7, 7, 2.2), turn: null }, { g: chip(106, 17, 9, 6, 3), turn: null },
  { g: buildPcbScrew(58, 11), turn: null }, { g: buildPcbScrew(124, 11), turn: null },
  { g: buildSpring(15, 82, 3, 44), turn: null },
  { g: buildRing(OUT.x, OUT.y, 53.4), turn: null },
];
// the output gear's phase: the idler has a tooth or a gap at the contact, and the output gear takes the other
{
  const pI = Math.PI * 2 / NI, pO = Math.PI * 2 / NO, RI = NI * MOD / 2, RO = NO * MOD / 2, thI = Math.PI + Math.PI / NI;
  const u = ((phi - thI) / pI) % 1, frac = ((u % 1) + 1) % 1, sI = (((frac + 0.5) % 1) - 0.5) * Math.PI * MOD;   // arc of the idler's nearest tooth centre from the contact point (+ ccw)
  const sO = -(sI + 0.5 * Math.PI * MOD) / 1;                                                                    // the output gear's tooth centre must sit half a pitch further, on the other tangent
  HIDDEN[3].turn.phase = phi + Math.PI + sO / RO;
}
// gears turn: P by 8 teeth over the clip, the others as the train says (no start or end jump)
const TURN = 8 * (Math.PI * 2 / NP);
const gearAt = (turn, t) => {
  const m = new T.Matrix4().makeTranslation(turn.c.x, turn.c.y, GEAR_Z);
  return m.multiply(new T.Matrix4().makeRotationZ(turn.phase + turn.ratio * TURN * t));
};
const still = new T.Matrix4();
const prep = (g, c = 40) => prepare(g, c);
const timeline = (t) => ({
  glass: smooth(0.14, 0.30, t) * (1 - smooth(0.84, 0.96, t)),
  sel: smooth(0.34, 0.46, t) * (1 - smooth(0.70, 0.82, t)),
});
const scene = {
  fov: 22,
  parts: [
    ...SHELL.map(g => ({ mesh: prep(g, 14), at: (t) => ({ m: still, sel: 0, alpha: 1 - 0.78 * timeline(t).glass }) })),
    ...SEEN.map(g => ({ mesh: prep(g, 40), at: () => ({ m: still, sel: 0, alpha: 1 }) })),
    ...HIDDEN.map(({ g, turn }) => ({
      mesh: prep(turn ? g : g, 40),
      at: (t) => ({ m: turn ? gearAt(turn, t) : still, sel: timeline(t).sel, alpha: 1 }),
    })),
  ],
  camera: (t) => {
    const C = new T.Vector3(70, 48, 30), az = 0.62 + 0.10 * Math.sin(t * Math.PI * 2), el = 0.52, dist = 560;
    return { pos: new T.Vector3(C.x + dist * Math.cos(el) * Math.sin(az), C.y - dist * Math.cos(el) * Math.cos(az), C.z + dist * Math.sin(el)), tgt: C };
  },
  shadow: () => ({ x: 70, y: 48, z: 0, rx: 100, ry: 66 }),
};
run(scene, 'select-hidden');
