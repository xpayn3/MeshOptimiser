// Renders the clip at the top of the Smart fit card (assets/help/smart-fit.webm and smart-fit-poster.webp).
//
// Three parts in an evenly spaced row across the middle of the picture: a gear, a pillow block and a bolt. One
// after another each turns the accent blue and is swapped for the plain shape that fits it (a disc, a box, a
// cylinder), and then they are swapped back.
//
//   node tools/render-smart-fit-clip.mjs               renders the clip and the poster
//   node tools/render-smart-fit-clip.mjs --still=0.5   one frame at t = 0.5 as tools/still.png (to look at)
//
// ffmpeg must be on the PATH, or named in FFMPEG. The drawing is in clip-kit.mjs.
import { T, rrect, hole, ext, inXZ, lathe, alongX, merge, prepare, smooth, gearGeometry, hexBolt, BEV, run } from './clip-kit.mjs';

// Millimetres, z up, every part's axis along x and its middle at the origin of its own spot in the row.
// The row runs across the picture: the spots are along the camera's right-hand direction.
const AZ = 0.5, EL = 0.3, DIST = 520, TARGET = new T.Vector3(0, 0, 28);
const RIGHT = new T.Vector3(Math.cos(AZ), Math.sin(AZ), 0);
const SPOT = { gear: -96, block: -4, bolt: 88 };                            // mm along the row
const place = (g, s, z = 0) => g.translate(TARGET.x + RIGHT.x * s, TARGET.y + RIGHT.y * s, z);
const rotY = (g) => g.applyMatrix4(new T.Matrix4().makeRotationY(Math.PI / 2));          // local +z -> +x

const GEAR_Z = 32, BLOCK_K = 1.2;
const gear = () => place(rotY(gearGeometry(30, 2.1, 5, 6, 4.4, 18, 10, 9)), SPOT.gear, GEAR_Z);
function pillowBlock() {                                // a flange with two screw holes under an arch with a bore
  const base = rrect(-34, -14, 68, 28, 3); hole(base, -26, 0, 2.7); hole(base, 26, 0, 2.7);
  const arch = new T.Shape(); arch.moveTo(-20, 8); arch.lineTo(20, 8); arch.lineTo(20, 24); arch.absarc(0, 24, 20, 0, Math.PI, false); arch.lineTo(-20, 8); hole(arch, 0, 24, 9);
  const g = merge([ext(base, 8 - 1.2, { ...BEV, bevelThickness: 0.6, bevelSize: 0.6 }).translate(0, 0, 0.6), inXZ(ext(arch, 24 - 1.2, { ...BEV, bevelThickness: 0.6, bevelSize: 0.6 }).translate(0, 0, 0.6), -12)]);
  return g.scale(BLOCK_K, BLOCK_K, BLOCK_K);
}
const block = () => place(pillowBlock(), SPOT.block);
// the bolt: head at the left, shank to the right, its middle at the origin
const bolt = () => place(rotY(hexBolt({ headR: 19, headH: 13, shankR: 8.5, len: 54, pitch: 0 }).applyMatrix4(new T.Matrix4().makeRotationY(Math.PI))).translate(-30, 0, 0), SPOT.bolt, 19);

// the plain shapes that fit each part
const fitDisc = () => place(alongX(lathe([[0, -4.5], [32, -4.5], [32, 4.5], [0, 4.5]], 72), 0, 0, 0), SPOT.gear, GEAR_Z);
const fitBox = () => place(new T.BoxGeometry(68 * BLOCK_K, 28 * BLOCK_K, 44 * BLOCK_K).translate(0, 0, 22 * BLOCK_K), SPOT.block);
const fitCyl = () => place(alongX(lathe([[0, -34], [18, -34], [18, 34], [0, 34]], 56), 0, 0, 0), SPOT.bolt, 19);

const ITEMS = [
  { whole: gear(), fit: fitDisc() },
  { whole: block(), fit: fitBox() },
  { whole: bolt(), fit: fitCyl() },
];
const pulse = (t, a, b) => smooth(a, a + 0.05, t) * (1 - smooth(b, b + 0.07, t));
const state = (i, t) => {                               // which shape is showing, and how blue
  const tin = 0.06 + 0.15 * i, tout = 0.62 + 0.10 * i;
  return { fitted: t >= tin + 0.08 && t < tout + 0.08, sel: Math.min(1, pulse(t, tin, tin + 0.08) + pulse(t, tout, tout + 0.08)) };
};
const GONE = new T.Matrix4().makeScale(1e-4, 1e-4, 1e-4), HERE = new T.Matrix4();
const scene = {
  fov: 22,
  parts: ITEMS.flatMap(({ whole, fit }, i) => [
    { mesh: prepare(whole, 40), at: (t) => { const s = state(i, t); return { m: s.fitted ? GONE : HERE, sel: s.sel, alpha: 1 }; } },
    { mesh: prepare(fit, 40), at: (t) => { const s = state(i, t); return { m: s.fitted ? HERE : GONE, sel: s.sel, alpha: 1 }; } },
  ]),
  camera: () => ({ pos: new T.Vector3(TARGET.x + DIST * Math.cos(EL) * Math.sin(AZ), TARGET.y - DIST * Math.cos(EL) * Math.cos(AZ), TARGET.z + DIST * Math.sin(EL)), tgt: TARGET }),
  shadow: () => ({ x: TARGET.x, y: TARGET.y, z: 0, rx: 150, ry: 40 }),
};
run(scene, 'smart-fit');
