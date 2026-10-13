// ========== MESHOPTIMISER SITE: THE AXLE IN THE HERO ==========
// A truck front axle (Mercedes-Benz Arocs 8x8, 295 parts) as the optimised GLB MeshOptimiser itself exported for the web: axle-web.glb,
// 250,075 triangles, 1.3 MB (it was 11.4 MB), meshopt-compressed. axle-offsets.json holds the offset the app's exploded view gives each part
// at 100 % (by part name, in metres, Y up as in the GLB). The model sits on the page's own dark background in polished metal, and the scroll
// pulls it apart up to the app's 165 % (site.js feeds the scroll through setP). It draws only when asked to (a scroll or a resize), never
// in a loop. Loaded by site.js where WebGL works and motion is allowed; anything that goes wrong leaves the poster picture in place.
// (the import map in the page head says where 'three' and the add-ons come from)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { studioEnvironment, kindOfMesh, settleKinds } from './axle-look.js?v=4';

const MAX_EXPLODE = 1.65;                                 // the app's exploded view at 165 %; the offsets in the file are for 100 %

export async function start(pop, base) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [gltf, table] = await Promise.all([
    loader.loadAsync(base + 'axle-web.glb?v=1'),
    fetch(base + 'axle-offsets.json?v=1').then(r => r.json()),
  ]);
  const pin = pop.querySelector('.pop-pin');
  const canvas = document.createElement('canvas');
  canvas.className = 'pop-3d';
  canvas.setAttribute('aria-hidden', 'true');
  pin.appendChild(canvas);

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, alpha: true, powerPreference: 'low-power' });   // (no edge smoothing on a phone: it costs battery, and the pixels are small)
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping || THREE.ACESFilmicToneMapping;   // as the app draws
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  // The app's lighting (a soft sky, a key light, a cool fill and a headlight that travels with the camera) on the app's Steel metal, but in a
  // studio with some contrast (axle-look.js): grey walls with a few bright strips and soft boxes, so the metal has something to catch.
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = 1.3;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x303642, 0.3);
  const keyL = new THREE.DirectionalLight(0xffffff, 1.1); keyL.position.set(80, 100, -60);
  const fill = new THREE.DirectionalLight(0xb0c4ff, 0.18); fill.position.set(-80, 60, 40);
  const head = new THREE.DirectionalLight(0xffffff, 0.3);
  scene.add(hemi, keyL, fill, head, head.target);

  // the app's outlines: the edges where the surface turns sharply, thin and dark (one set per shape: repeated parts share it)
  const lineMat = new THREE.LineBasicMaterial({ color: 0x0b0c0e, transparent: true, opacity: 0.55 });
  const edgesOf = new Map();

  // the parts: each mesh of the file is taken out of the file's tree and put under one group, where it keeps the place it had
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const corner = new THREE.Vector3();
  const parts = meshes.map((mesh) => {
    const rest = mesh.matrixWorld.clone();
    const kind = kindOfMesh(mesh);
    const part = new THREE.Mesh(mesh.geometry, mesh.material);
    part.matrixAutoUpdate = false;
    if (!edgesOf.has(mesh.geometry)) edgesOf.set(mesh.geometry, new THREE.EdgesGeometry(mesh.geometry, 38));
    part.add(new THREE.LineSegments(edgesOf.get(mesh.geometry), lineMat));          // (a child: it moves with the part)
    root.add(part);
    const o = table.offsets[mesh.name] || [0, 0, 0];
    // the eight corners of the part's box where it rests: for the camera, which has to know how big the whole thing is
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox, pts = [];
    for (let k = 0; k < 8; k++) { corner.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(rest); pts.push(corner.clone()); }
    return { part, rest, off: new THREE.Vector3(...o), pts, kind };
  });
  settleKinds(parts);                                          // (which material each part gets: by its name, see axle-look.js)
  for (const entry of parts) entry.part.material = entry.material;
  gltf.scene.clear();                                          // (the file's own tree is not drawn)

  // ---- the camera: Y up, a three-quarter view that turns a little as the model comes apart ----
  const FOV = 30;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 60);
  camera.up.set(0, 1, 0);
  const mix = (a, b, t) => a + (b - a) * t;
  const dir = new THREE.Vector3(), tgt = new THREE.Vector3(), box = new THREE.Box3(), pt = new THREE.Vector3(), shift = new THREE.Matrix4();

  let p = 0, queued = false, ready = false, cw = 0, ch = 0;
  const draw = () => {
    queued = false;
    if (document.hidden) return;                               // (nothing is drawn for a tab nobody is looking at)
    const b = canvas.getBoundingClientRect();                  // (on a phone the canvas is a band of the pinned screen, set in the CSS)
    const w = Math.round(b.width), h = Math.round(b.height);
    if (!w || !h) return;
    if (w !== cw || h !== ch) { cw = w; ch = h; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2)); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    const e = MAX_EXPLODE * p;
    box.makeEmpty();
    for (const { part, rest, off, pts } of parts) {
      shift.makeTranslation(off.x * e, off.y * e, off.z * e);
      part.matrix.multiplyMatrices(shift, rest); part.matrixWorldNeedsUpdate = true;
      for (const q of pts) box.expandByPoint(pt.copy(q).addScaledVector(off, e));
    }
    // where the model is now, and how far back the camera has to stand to have all of it in the picture
    box.getCenter(tgt);
    const radius = box.min.distanceTo(box.max) / 2;
    const vf = THREE.MathUtils.degToRad(FOV) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
    const narrow = camera.aspect < 0.85;
    const dist = (radius * (narrow ? 0.62 : 0.66)) / Math.sin(narrow ? hf : Math.min(vf, hf));        // (on a phone it is wider than the screen on purpose)
    const az = THREE.MathUtils.degToRad(mix(52, 70, p)), el = THREE.MathUtils.degToRad(mix(24, 20, p));
    dir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    camera.position.copy(tgt).addScaledVector(dir, dist);
    camera.near = dist / 100; camera.far = dist * 40;
    camera.lookAt(tgt);
    camera.setViewOffset(w, h, 0, narrow ? h * 0.05 : h * 0.07, w, h);
    camera.updateMatrixWorld(true);
    // the headlight: just above and beside the eye, looking where the camera looks
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    head.position.copy(camera.position).addScaledVector(right, -0.035 * dist).addScaledVector(up, 0.05 * dist);
    head.target.position.copy(camera.position).addScaledVector(dir, -dist);
    renderer.render(scene, camera);
    if (!ready) { ready = true; pop.classList.add('is-3d'); }
  };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  window.addEventListener('resize', ask);
  draw();
  return {
    setP(v) { if (Math.abs(v - p) > 0.0004) { p = v; ask(); } },
    redraw: ask,
    // the picture as it is at `v` (0 to 1), drawn now: used to make the poster that stands in on a phone
    snapshot(v) { p = v; draw(); return canvas.toDataURL('image/png'); },
  };
}
