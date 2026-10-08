// Renders the cover clip (assets/help/cover.webm and cover-poster.webp): the wide banner at the top of the help.
//
// A knot turns slowly. It starts as a smooth, finely meshed surface and is reduced in steps, each coarser than
// the last, with the triangles drawn in the accent blue, down to a handful of facets; then it is rebuilt back
// up to the smooth one. This is the one clip that shows the mesh on purpose: reducing triangles is its subject.
//
//   node tools/render-cover-clip.mjs               renders the clip and the poster
//   node tools/render-cover-clip.mjs --still=0.5   one frame at t = 0.5 as tools/still.png (to look at)
//
// ffmpeg must be on the PATH, or named in FFMPEG. The drawing is in clip-kit.mjs.
import { T, prepare, smooth, size, run } from './clip-kit.mjs';

size(1290, 360, 7);
// (tubular segments, radial segments, crease angle): the facets only show where the mesh is coarse
const LEVELS = [
  { geo: new T.TorusKnotGeometry(30, 9, 300, 48, 2, 3), crease: 70, wire: 0 },
  { geo: new T.TorusKnotGeometry(30, 9, 80, 14, 2, 3), crease: 30, wire: 1 },
  { geo: new T.TorusKnotGeometry(30, 9, 34, 7, 2, 3), crease: 18, wire: 1 },
  { geo: new T.TorusKnotGeometry(30, 9, 15, 4, 2, 3), crease: 12, wire: 1 },
];
// when each level is on screen: [from, to) (the steps hand over with a cut: the new lines coming in are the point)
const SHOWN = [[[0, 0.12], [0.90, 1.01]], [[0.12, 0.30], [0.76, 0.90]], [[0.30, 0.50], [0.62, 0.76]], [[0.50, 0.62]]];
const shown = (k, t) => SHOWN[k].some(([a, b]) => t >= a && t < b);
const GONE = new T.Matrix4().makeScale(1e-4, 1e-4, 1e-4);
const scene = {
  fov: 22,
  parts: LEVELS.map(({ geo, crease, wire }, k) => ({
    mesh: prepare(geo, crease),
    at: (t) => {
      if (!shown(k, t)) return { m: GONE, sel: 0, alpha: 1, wire: 0 };
      const turn = new T.Matrix4().makeRotationZ(t * Math.PI * 2).multiply(new T.Matrix4().makeRotationX(0.5));
      return { m: turn, sel: 0, alpha: 1, wire };
    },
  })),
  camera: () => ({ pos: new T.Vector3(0, -525 * Math.cos(0.3), 525 * Math.sin(0.3)), tgt: new T.Vector3(0, 0, 0) }),
};
run(scene, 'cover');
