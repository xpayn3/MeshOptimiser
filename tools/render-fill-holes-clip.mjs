// Renders the clip at the top of the Fill holes card (assets/help/fill-holes.webm and fill-holes-poster.webp).
//
// A machined enclosure cover seen from above: a rounded plate with a raised rim, four mounting holes, a
// round cut-out with a boss, and a grid of vent holes. Each hole is closed by a patch that grows from its
// middle in the accent blue and settles into the surface, left to right; then they open again.
//
//   node tools/render-fill-holes-clip.mjs               renders the clip and the poster
//   node tools/render-fill-holes-clip.mjs --still=0.5   one frame at t = 0.5 as tools/still.png (to look at)
//
// ffmpeg must be on the PATH, or named in FFMPEG. The drawing is in clip-kit.mjs.
import { T, rrect, ext, merge, prepare, smooth, hole, run } from './clip-kit.mjs';

// Millimetres, z up. A plate 152 x 100 mm; a solid lower layer and an upper layer with the holes.
const X0 = -76, Y0 = -50, PW = 152, PH = 100, CORNER = 12;
const HOLES = [
  [-62, -36, 5.2], [62, -36, 5.2], [-62, 36, 5.2], [62, 36, 5.2],                        // mounting holes
  [8, 0, 12],                                                                           // the round cut-out
  ...[-44, -33, -22].flatMap((x) => [-14, 0, 14].map((y) => [x, y, 2.6])),              // a grid of vent holes
  [32, 20, 4.2], [48, 20, 4.2], [32, -20, 4.2], [48, -20, 4.2], [40, 0, 3],              // a few larger ones
];
const LOW = 7, HIGH = 10, TOP = LOW + HIGH + 4;
const BODY_BEV = { bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelOffset: -2, bevelSegments: 10, curveSegments: 24 };
const plate = () => rrect(X0, Y0, PW, PH, CORNER);
function buildBody() {
  const up = plate(); for (const [x, y, r] of HOLES) hole(up, x, y, r);
  const lowShape = plate();
  const rim = plate(); rim.holes.push(rrect(X0 + 5, Y0 + 5, PW - 10, PH - 10, CORNER - 4));       // a raised rim round the edge
  return merge([
    ext(lowShape, LOW, { ...BODY_BEV, bevelThickness: 2.5, bevelSize: 2.5, bevelOffset: -2.5 }).translate(0, 0, 2.5),
    ext(up, HIGH, BODY_BEV).translate(0, 0, LOW + 2),
    ext(rim, 1.8, { bevelEnabled: false, curveSegments: 24 }).translate(0, 0, TOP - 0.3),
    boss(8, 0, 19),
  ]);
}
function boss(x, y, r) {                                    // a thin raised ring round the cut-out
  const s = new T.Shape(); s.absarc(x, y, r, 0, Math.PI * 2, false); hole(s, x, y, r - 2);
  return ext(s, 1.2, { bevelEnabled: false, curveSegments: 64 }).translate(0, 0, TOP - 0.3);
}
const patch = ([x, y, r]) => new T.CylinderGeometry(r + 2.1, r + 2.1, TOP + 0.15 - 3, 40).rotateX(Math.PI / 2).translate(x, y, 3 + (TOP + 0.15 - 3) / 2);
const timeline = (t) => ({
  grow: smooth(0.16, 0.46, t) * (1 - smooth(0.70, 0.92, t)),
  sel: smooth(0.14, 0.22, t) * (1 - smooth(0.46, 0.60, t)) + smooth(0.66, 0.72, t) * (1 - smooth(0.90, 0.97, t)),
});
const still = new T.Matrix4();
const CENTER = new T.Vector3(0, 0, 10);
const scene = {
  fov: 22,
  parts: [
    { mesh: prepare(buildBody(), 30), at: () => ({ m: still, sel: 0, alpha: 1 }) },
    ...HOLES.map((h) => ({
      mesh: prepare(patch(h), 40), group: 0,
      at: (t) => {                                          // a sweep from left to right, so they do not all close at once
        const { grow, sel } = timeline(t), d = (h[0] - X0) / PW * 0.3;
        const s = Math.max(0.0001, Math.min(1, (grow - d) / (1 - 0.3)));
        const m = new T.Matrix4().makeTranslation(h[0], h[1], 0).multiply(new T.Matrix4().makeScale(s, s, 1)).multiply(new T.Matrix4().makeTranslation(-h[0], -h[1], 0));
        return { m, sel: Math.min(1, sel), alpha: 1 };
      },
    })),
  ],
  camera: (t) => {
    const az = 0.30 + 0.05 * Math.sin(t * Math.PI * 2), el = 0.62, dist = 385;
    return { pos: new T.Vector3(CENTER.x + dist * Math.cos(el) * Math.sin(az), CENTER.y - dist * Math.cos(el) * Math.cos(az), CENTER.z + dist * Math.sin(el)), tgt: CENTER };
  },
  shadow: () => ({ x: 0, y: 0, z: 0, rx: 98, ry: 64 }),
};
run(scene, 'fill-holes');
