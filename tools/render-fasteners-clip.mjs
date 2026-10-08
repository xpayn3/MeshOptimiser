// Renders the clip at the top of the Fasteners card (assets/help/fasteners.webm and fasteners-poster.webp).
//
// An angle bracket held together with six hex bolts (four through the base, two through the upright, each
// with a washer). The bolts turn the accent blue, lift out and fade, leaving the bracket with its empty
// holes, and then they come back. The bracket stays where it is.
//
//   node tools/render-fasteners-clip.mjs               renders the clip and the poster
//   node tools/render-fasteners-clip.mjs --still=0.5   one frame at t = 0.5 as tools/still.png (to look at)
//
// ffmpeg must be on the PATH, or named in FFMPEG. The drawing is in clip-kit.mjs.
import { T, rrect, hole, ext, inXZ, merge, prepare, smooth, hexBolt, BEV, run } from './clip-kit.mjs';

// Millimetres, z up. The base plate lies on x 0..110, y 0..76, z 0..6; the upright stands at its back edge (y 70..76).
const BASE_HOLES = [[28, 20], [82, 20], [28, 50], [82, 50]], WALL_HOLES = [[20, 40], [90, 40]], BORE = [55, 34];
function buildBracket() {
  const base = rrect(0, 0, 110, 76, [4, 4, 0, 0]);
  for (const [x, y] of BASE_HOLES) hole(base, x, y, 4.3);
  const up = rrect(0, 0, 110, 58, [0, 0, 5, 5]);
  for (const [x, z] of WALL_HOLES) hole(up, x, z, 4.3);
  hole(up, BORE[0], BORE[1], 11);
  const boss = new T.Shape(); boss.absarc(BORE[0], BORE[1], 17, 0, Math.PI * 2, false); hole(boss, BORE[0], BORE[1], 11);
  const ring = new T.Shape(); ring.absarc(BORE[0], BORE[1], 9.5, 0, Math.PI * 2, false); hole(ring, BORE[0], BORE[1], 6.5);
  return merge([
    ext(base, 6 - 1.2, { ...BEV, bevelThickness: 0.6, bevelSize: 0.6 }).translate(0, 0, 0.6),
    inXZ(ext(up, 6 - 1.2, { ...BEV, bevelThickness: 0.6, bevelSize: 0.6 }).translate(0, 0, 0.6), 70),
    inXZ(ext(boss, 3, { ...BEV, bevelThickness: 0.5, bevelSize: 0.5 }), 67),
    inXZ(ext(ring, 6, { ...BEV, bevelThickness: 0.4, bevelSize: 0.4 }), 69),
  ]);
}
const bolt = () => hexBolt({ headR: 6.6, headH: 5, shankR: 3.9, len: 14, washerR: 8.2, pitch: 2 });
const onBase = ([x, y]) => ({ g: bolt().applyMatrix4(new T.Matrix4().makeTranslation(x, y, 6)), lift: [0, 0, 34] });          // head up
const onWall = ([x, z]) => ({ g: bolt().applyMatrix4(new T.Matrix4().makeRotationX(Math.PI / 2)).translate(x, 70, z), lift: [0, -34, 0] });   // head toward the viewer (+z turned to -y)

const timeline = (t) => ({
  sel: smooth(0.14, 0.26, t) * (1 - smooth(0.82, 0.94, t)),
  gone: smooth(0.30, 0.50, t) * (1 - smooth(0.62, 0.80, t)),
});
const still = new T.Matrix4();
const BOLTS = [...BASE_HOLES.map(onBase), ...WALL_HOLES.map(onWall)];
const CENTER = new T.Vector3(55, 38, 24);
const scene = {
  fov: 22,
  parts: [
    { mesh: prepare(buildBracket(), 14), at: () => ({ m: still, sel: 0, alpha: 1 }) },
    ...BOLTS.map(({ g, lift }) => ({
      mesh: prepare(g, 40),
      at: (t) => { const { sel, gone } = timeline(t); return { m: new T.Matrix4().makeTranslation(lift[0] * gone, lift[1] * gone, lift[2] * gone), sel, alpha: 1 - gone }; },
    })),
  ],
  camera: () => {
    const az = 0.42, el = 0.46, dist = 385;
    return { pos: new T.Vector3(CENTER.x + dist * Math.cos(el) * Math.sin(az), CENTER.y - dist * Math.cos(el) * Math.cos(az), CENTER.z + dist * Math.sin(el)), tgt: CENTER };
  },
  shadow: () => ({ x: 55, y: 38, z: 0, rx: 70, ry: 52 }),
};
run(scene, 'fasteners');
