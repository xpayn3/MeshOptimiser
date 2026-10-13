// ========== MESHOPTIMISER SITE: THE PART IN THE HERO ==========
// The rear derailleur of the opening picture as a real mesh: 43 parts, about
// 68,000 triangles, read from hero-mesh.json + hero-mesh.bin (baked from the
// app itself, so every part is where the app had it and carries the offset the
// app's exploded view gave it). The camera is the app's camera for that
// picture, so at rest, together, this lands on the cut-out it replaces; site.js
// then feeds it the scroll (setP) and it comes forward, turns and pulls itself
// apart (up to the app's 60 % exploded view). It draws only when asked to (a scroll or a resize), never in a loop.
// Loaded by site.js on a desktop screen with motion allowed; anything that
// goes wrong leaves the cut-out in place.
// (the import map in the page head says where 'three' and the add-ons come from)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export async function start(pop, base) {
  const [meta, bin] = await Promise.all([
    fetch(base + 'hero-mesh.json?v=4').then(r => r.json()),
    fetch(base + 'hero-mesh.bin?v=4').then(r => r.arrayBuffer()),
  ]);
  const pin = pop.querySelector('.pop-pin'), art = pop.querySelector('.pop-art');
  const canvas = document.createElement('canvas');
  canvas.className = 'pop-3d';
  canvas.setAttribute('aria-hidden', 'true');
  pin.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  // ---- the parts ----
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  // a little metal, lit by the same studio room the app uses
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;
  const material = new THREE.MeshStandardMaterial({ color: 0xc4c7cc, roughness: 0.34, metalness: 0.72, side: THREE.DoubleSide });
  const { min, span } = meta;
  const parts = meta.parts.map((p) => {
    const q = new Int16Array(bin, p.op, p.v * 3), n = new Int8Array(bin, p.on, p.v * 3);
    const pos = new Float32Array(p.v * 3), nor = new Float32Array(p.v * 3);
    for (let i = 0; i < p.v; i++) for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = min[k] + ((q[i * 3 + k] + 32768) / 65535) * span[k];
      nor[i * 3 + k] = n[i * 3 + k] / 127;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(p.big ? new Uint32Array(bin, p.oi, p.i) : new Uint16Array(bin, p.oi, p.i), 1));
    const mesh = new THREE.Mesh(geo, material);
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    return { mesh, off: new THREE.Vector3(...p.off) };
  });

  // ---- light: a soft sky and a headlight that follows the camera, like the app's Clay ----
  const sky = new THREE.HemisphereLight(0xffffff, 0x3a3a40, 0.35);
  const head = new THREE.DirectionalLight(0xffffff, 0.9);
  scene.add(sky, head, head.target);

  // ---- the camera of the picture ----
  const W0 = 1200, H0 = 1051;                 // the app's viewport in the picture (css px), inside a 1728 x 1117 window
  const camera = new THREE.PerspectiveCamera(meta.fov, W0 / H0, 1, 5000);
  camera.up.set(0, 0, 1);
  const tgt0 = new THREE.Vector3(...meta.camState.tgt);
  const pos0 = new THREE.Vector3(...meta.camState.pos);
  const arm = pos0.clone().sub(tgt0);
  const spin = new THREE.Vector3(0, 0, 1);

  let p = 0, queued = false, ready = false, cw = 0, ch = 0;
  const draw = () => {
    queued = false;
    const a = art.getBoundingClientRect(), b = pin.getBoundingClientRect();
    const w = Math.round(b.width), h = Math.round(b.height);
    if (w !== cw || h !== ch) { cw = w; ch = h; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, h, false); }
    const k = a.width / 1728;                                  // css px per px of the picture
    const vx = a.left - b.left + 248 * k, vy = a.top - b.top + 44 * k;
    // the model comes forward, turns a little and drifts up and to the left
    const forward = 1 - 0.2 * p, yaw = -0.5 * p;
    const e = 2 * p;                                           // the offsets in the file are the app's 30 % explode: it starts together and ends at 60 %
    parts.forEach(({ mesh, off }) => { mesh.matrix.makeTranslation(off.x * e, off.y * e, off.z * e); mesh.matrixWorldNeedsUpdate = true; });
    const arm2 = arm.clone().multiplyScalar(forward).applyAxisAngle(spin, yaw);
    camera.position.copy(tgt0).add(arm2);
    camera.lookAt(tgt0);
    camera.setViewOffset(W0, H0, -(vx - 0.06 * a.width * p) / k, -(vy + 0.02 * a.width * p) / k, w / k, h / k);
    head.position.copy(camera.position).add(new THREE.Vector3(-60, 40, 80));
    head.target.position.copy(tgt0);
    renderer.render(scene, camera);
    if (!ready) { ready = true; pop.classList.add('is-3d'); }
  };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  window.addEventListener('resize', ask);
  draw();
  return { setP(v) { if (Math.abs(v - p) > 0.0004) { p = v; ask(); } }, redraw: ask };
}
