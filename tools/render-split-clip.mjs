// Renders the clip at the top of the Split card (assets/help/split.webm and split-poster.webp).
//
// The bracket stays where it is, in the middle of the picture, and the pin, the retaining ring, the
// bolts and the washers fly out of it. The parts flash the accent blue (--ac) for an instant as they break away.
//
//   node tools/render-split-clip.mjs                  renders the clip and the poster
//   node tools/render-split-clip.mjs --still=0.4      one frame at t = 0.4 as tools/still.png (to look at)
//
// ffmpeg must be on the PATH, or named in FFMPEG. The drawing is in clip-kit.mjs.
import { T, BEV, rrect, hole, slot, ext, inYZ, inXZ, lathe, alongX, alongZ, merge, prepare, smooth, run } from './clip-kit.mjs';

// ── model ────────────────────────────────────────────────────────────────────────────────────────
// Millimetres, z up. The base plate lies on x 0..100, y 0..60, z 0..10; the upright stands at its
// back edge (x 0..8); the pin runs along x through the upright; the bolts go down through the plate.
function buildBracket() {
  const g = [];
  // base plate: rounded corners, two bolt holes, two empty mounting holes, a slot
  const base = rrect(0, 0, 100, 60, [0, 7, 7, 0]);
  hole(base, 62, 16, 5.3); hole(base, 62, 44, 5.3); hole(base, 88, 14, 4.4); hole(base, 88, 46, 4.4); slot(base, 22, 40, 30, 3.6);
  g.push(ext(base, 10 - 1.4).translate(0, 0, 0.7));
  // upright plate: rounded top corners, the pin's bore, two lightening holes
  const up = rrect(0, 0, 60, 56, [0, 0, 7, 7]);
  hole(up, 30, 36, 9.5); hole(up, 9, 46, 3.6); hole(up, 51, 46, 3.6);
  g.push(inYZ(ext(up, 8 - 1.4).translate(0, 0, 0.7), 0));
  // the inner corner: a quarter-round fillet along the whole width
  const fil = new T.Shape(); fil.moveTo(8, 10); fil.lineTo(19, 10); fil.absarc(19, 21, 11, -Math.PI / 2, -Math.PI, true); fil.lineTo(8, 10);
  g.push(inXZ(ext(fil, 60, { depth: 60, bevelEnabled: false, curveSegments: 20 }), 0));
  // two gussets: a triangle with a cut tip and a small bore
  for (const y0 of [9, 43]) {
    const s = new T.Shape(); s.moveTo(8, 10); s.lineTo(44, 10); s.lineTo(44, 14); s.lineTo(12, 42); s.lineTo(8, 42); s.lineTo(8, 10);
    hole(s, 20, 20, 2.6);
    g.push(inXZ(ext(s, 8 - 1, { ...BEV, bevelThickness: 0.5, bevelSize: 0.5 }).translate(0, 0, 0.5), y0));
  }
  return merge(g);
}
function buildPin() {                        // Ø16, along x from -9 to 46 (the upright's face is at x = 8)
  const R = 8;
  const pts = [[0, -9], [R - 1.4, -9], [R, -7.6], [R, -4.6], [R - 1.2, -4.6], [R - 1.2, -2.6], [R, -2.6], [R, 14], [R - 0.7, 14.4], [R - 0.7, 20], [R, 20.4], [R, 30], [R - 1.2, 30], [R - 1.2, 33], [R, 33], [R, 44.6], [R - 1.5, 46], [3.4, 46], [3.4, 44.4], [0, 43.4]];
  return alongX(lathe(pts, 64), 0, 30, 36);
}
function buildRing() {                       // a C-shaped retaining ring in the pin's back groove
  const s = new T.Shape(); const a0 = 0.45, a1 = Math.PI * 2 - 0.45, ro = 10.3, ri = 6.7;
  s.absarc(0, 0, ro, a0, a1, false); s.lineTo(ri * Math.cos(a1), ri * Math.sin(a1)); s.absarc(0, 0, ri, a1, a0, true); s.closePath();
  return inYZ(ext(s, 1.4, { depth: 1.4, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.2, bevelSegments: 2, curveSegments: 40 }), -4.6).translate(0, 30, 36);
}
function buildWasher(x, y) {
  const s = new T.Shape(); s.absarc(0, 0, 8.8, 0, Math.PI * 2, false); hole(s, 0, 0, 5.0);
  return ext(s, 1.6 - 0.5, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 2, curveSegments: 48 }).translate(x, y, 10 + 0.25);
}
function buildBolts() {                       // M8: a hex head with a chamfered top and a washer face, a threaded shank; the head sits on a washer at z = 11.6
  const out = [];
  for (const [x, y] of [[62, 16], [62, 44]]) {
    const head = new T.CylinderGeometry(7.5, 7.5, 5.4, 6, 1);
    const hexG = alongZ(head.translate(0, 2.7, 0), x, y, 11.6);
    const rest = [];
    rest.push(alongZ(lathe([[0, 5.4], [5.0, 5.4], [6.7, 4.5], [7.3, 3.4], [0, 3.4]], 48), x, y, 11.6));
    rest.push(alongZ(lathe([[0, 0.1], [6.1, 0.1], [6.1, -0.4], [0, -0.4]], 48), x, y, 11.6));
    const th = [[0, -0.4], [4.0, -0.4]]; let a = -0.4;
    for (let i = 0; i < 7; i++) { th.push([3.3, a - 0.95], [4.0, a - 1.8]); a -= 2.0; }
    th.push([4.0, -15.6], [3.1, -16.8], [0, -16.8]);
    rest.push(alongZ(lathe(th, 44), x, y, 11.6));
    out.push(merge([hexG, ...rest]));
  }
  return out;
}


// ── the scene ──────────────────────────────────────────────────────────────────────────────────────
const CENTER = new T.Vector3(50, 30, 22);
const part = (geom, crease, off) => ({ mesh: prepare(geom, crease), off });
const SRC = [
  part(buildBracket(), 36, () => [0, 0, 0]),
  part(buildPin(), 40, (e) => [74 * e, 0, 2 * e]),
  part(buildRing(), 40, (e) => [-34 * e, 0, 6 * e]),
  ...buildBolts().map((b) => part(b, 40, (e) => [22 * e, 0, 74 * e])),
  ...[[62, 16], [62, 44]].map(([x, y]) => part(buildWasher(x, y), 40, (e) => [22 * e, 0, 42 * e])),
];
function timeline(t) {                        // t in 0..1, a loop that ends where it began
  const e = smooth(0.30, 0.52, t) * (1 - smooth(0.70, 0.92, t));
  const m = smooth(0.265, 0.305, t) * (1 - smooth(0.305, 0.42, t));       // a flash: up as the parts break away, gone before they have flown far
  return { e, m };
}
const scene = {
  fov: 22,
  parts: SRC.map(({ mesh, off }) => ({ mesh, at: (t) => { const { e, m } = timeline(t); const o = off(e); return { m: new T.Matrix4().makeTranslation(o[0], o[1], o[2]), sel: m, alpha: 1 }; } })),
  camera: (t) => {
    const az = 0.40 + 0.06 * Math.sin(t * Math.PI * 2), el = 0.46, dist = 345;
    return { pos: new T.Vector3(CENTER.x + dist * Math.cos(el) * Math.sin(az), CENTER.y - dist * Math.cos(el) * Math.cos(az), CENTER.z + dist * Math.sin(el)), tgt: CENTER };   // the camera stays put
  },
  shadow: (t) => { const { e } = timeline(t); return { x: 54 + 10 * e, y: 30, z: -6, rx: 78 + 26 * e, ry: 40 + 6 * e }; },
};
run(scene, 'split');
