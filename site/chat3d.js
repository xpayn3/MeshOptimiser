// ========== MESHOPTIMISER SITE: THE PART NEXT TO THE CHAT ==========
// A Scania V8 engine in the example session on claude.html, as a real mesh: the app's own export (1,295 parts, Draco, about 100,000
// triangles so the page stays light) beside the conversation. As each message of the chat appears the part does what
// Claude just asked the app to do: find_fasteners lights the 376 bolts, nuts and washers, nuts and washers, hide_parts takes them away, fit_to_budget
// flashes the triangles and counts the scene down from 3,682,816 to 298,957. It draws only while something moves (a step, a resize),
// never in a loop. Loaded by site.js on a desktop screen with motion allowed; anything that goes wrong leaves the chat on its own.
// (the import map in the page head says where 'three' and the add-ons come from)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { productStudio } from './axle-look.js?v=6';


// Claude's own colours: the coral of its mark and a warm sand, on some parts of the model, and the coral for what a tool is working on
const CORAL = new THREE.Color(0xd97757), SAND = new THREE.Color(0xe9dcc6);
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 100; };
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function start(root, base) {
  const data = JSON.parse(root.querySelector('[data-cx3d-data]').textContent);
  const fastener = new Set(data.fasteners);
  const canvas = root.querySelector('canvas');
  const hudTris = root.querySelector('[data-hud-tris]'), hudNote = null, hudTool = root.querySelector('[data-hud-tool]');
  const hudPct = root.querySelector('[data-hud-pct]'), hudBar = root.querySelector('[data-hud-bar]'), hudParts = root.querySelector('[data-hud-parts]'), hudHidden = root.querySelector('[data-hud-hidden]');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  // a product-photography studio and lights (axle-look.js)
  renderer.toneMapping = THREE.NeutralToneMapping || THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  scene.environment = productStudio(renderer);
  scene.environmentIntensity = 1.05;
  const head = new THREE.DirectionalLight(0xffffff, 0.35);
  const keyL = new THREE.DirectionalLight(0xfff4e8, 0.8); keyL.position.set(90, 120, 70);       // a warm key from above and the front
  const fill = new THREE.DirectionalLight(0xb0c4ff, 0.22); fill.position.set(-90, 50, 50);       // a cool fill from the other side
  const rim = new THREE.DirectionalLight(0xcfe0ff, 1.0); rim.position.set(-30, 70, -120);        // a rim from behind, so the edges of the dark parts show
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303642, 0.4), keyL, fill, rim, head, head.target);

  const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync(base + data.glb + '?v=3');
  draco.dispose();
  const model = gltf.scene;
  scene.add(model);

  // every part gets a material of its own (to tint, fade or hide it) and a wireframe twin that shares its geometry
  const parts = [];
  const wireMat = new THREE.MeshBasicMaterial({ color: 0xf3c4ad, wireframe: true, transparent: true, opacity: 0, depthWrite: false });
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });          // (collected first: a twin added while walking would be walked too)
  const isFast = (o) => { for (let q = o; q && q !== model; q = q.parent) if (fastener.has(q.name)) return true; return false; };      // (a name sits on the mesh or on the node it hangs from)
  for (const o of meshes) {
    o.material = o.material.clone();
    o.material.envMapIntensity = 1;
    const twin = new THREE.Mesh(o.geometry, wireMat);
    twin.matrixAutoUpdate = false; twin.visible = false;
    o.add(twin);
    parts.push({ mesh: o, twin, isFastener: isFast(o), base: o.material.color.clone() });
  }
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const radius = size.length() / 2;
  // the stand it is photographed on: a soft pool of light on the floor and the contact shadow of the engine on it
  const pool = (stops, w, h, y, blend) => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    stops.forEach(([at, col]) => gr.addColorStop(at, col));
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: blend, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(ctr.x, y, ctr.z); m.scale.set(w, h, 1); m.renderOrder = -1;
    scene.add(m); return m;
  };
  pool([[0, 'rgba(255,255,255,0.055)'], [0.35, 'rgba(255,255,255,0.02)'], [0.7, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)']], size.x * 2.2, size.z * 2.2, box.min.y - radius * 0.02, THREE.AdditiveBlending);
  pool([[0, 'rgba(0,0,0,0.7)'], [0.45, 'rgba(0,0,0,0.38)'], [1, 'rgba(0,0,0,0)']], size.x * 1.45, size.z * 1.45, box.min.y - radius * 0.012, THREE.NormalBlending);

  const camera = new THREE.PerspectiveCamera(32, 1, radius * 0.05, radius * 20);
  const view = { yaw: 2.25, pitch: 0.36 };
  const accent = CORAL;

  // ---- the state, and a tween between two states ----
  const cur = { hl: 0, hide: 0, wire: 0, count: data.tris[0], yaw: 0 };
  let w = 0, h = 0, queued = false;
  const place = () => {
    const yaw = view.yaw + cur.yaw, d = radius * 3.4;
    camera.position.set(ctr.x + Math.cos(yaw) * Math.cos(view.pitch) * d, ctr.y + Math.sin(view.pitch) * d, ctr.z + Math.sin(yaw) * Math.cos(view.pitch) * d);
    camera.up.set(0, 1, 0);
    camera.lookAt(ctr);
    head.position.copy(camera.position); head.target.position.copy(ctr);
  };
  const paint = () => {
    queued = false;
    const b = root.getBoundingClientRect();
    if (Math.round(b.width) !== w || Math.round(b.height) !== h) {
      w = Math.round(b.width); h = Math.round(b.height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.setViewOffset(w, h, 0, -Math.round(h * 0.12), w, h); camera.updateProjectionMatrix();   // (the model sits a little lower, clear of the readout)
    }
    for (const p of parts) {
      const m = p.mesh.material;
      const gone = p.isFastener && cur.hide >= 0.995;
      p.mesh.visible = !gone;
      p.twin.visible = !gone && cur.wire > 0.01;
      if (gone) continue;
      const fade = p.isFastener ? 1 - cur.hide : 1;
      const dim = !p.isFastener ? 1 - 0.78 * cur.hl : 1;
      m.transparent = fade < 1 || dim < 1;
      m.opacity = Math.min(fade, dim);
      m.depthWrite = !m.transparent || m.opacity > 0.6;
      if (m.emissive) { if (p.isFastener) m.emissive.copy(accent).multiplyScalar(0.9 * cur.hl); }
      if (p.isFastener) m.color.copy(p.base).lerp(accent, 0.55 * cur.hl);
    }
    wireMat.opacity = 0.55 * cur.wire;
    place();
    renderer.render(scene, camera);
    if (hudTris) hudTris.textContent = fmt(cur.count);
    const gone = Math.round(fastener.size * cur.hide), saved = 1 - cur.count / data.tris[0];
    if (hudPct) { hudPct.textContent = (saved > 0.0005 ? '−' : '') + (saved * 100).toFixed(1) + '%'; hudPct.classList.toggle('is-down', saved > 0.0005); }
    if (hudBar) hudBar.style.width = (cur.count / data.tris[0] * 100).toFixed(2) + '%';
    if (hudParts) hudParts.textContent = String(data.parts - gone);
    if (hudHidden) hudHidden.textContent = String(gone);
  };
  const draw = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };

  let raf = 0;
  const tween = (to, ms) => new Promise((resolve) => {
    cancelAnimationFrame(raf);
    const from = { ...cur }, t0 = performance.now();
    if (!ms) { Object.assign(cur, to); paint(); resolve(); return; }
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = ease(k);
      for (const key of Object.keys(to)) cur[key] = from[key] + (to[key] - from[key]) * e;
      paint();
      if (k < 1) raf = requestAnimationFrame(step); else resolve();
    };
    raf = requestAnimationFrame(step);
  });

  // ---- what each message of the chat does to the part: [pause before, the tool shown, where the state goes, how long it takes] ----
  const T = data.tris;
  const END = [
    { hl: 0, hide: 0, wire: 0, count: T[0], yaw: 0 },
    { hl: 0, hide: 1, wire: 0, count: T[0], yaw: 0 },
    { hl: 0, hide: 1, wire: 0, count: T[1], yaw: 0.35 },
    { hl: 0, hide: 1, wire: 0, count: T[1], yaw: 0.9 },
  ];
  const NOTE = [`${data.parts} parts`, `${data.parts - fastener.size} parts`, `${data.parts - fastener.size} parts`, `${data.parts - fastener.size} parts`];
  const say = (tool, note) => { if (hudTool) { hudTool.textContent = tool; hudTool.hidden = !tool; } if (hudNote && note) hudNote.textContent = note; };
  const TIMELINES = [
    [],
    [[0, 'scene_summary', {}, 500], [500, 'find_fasteners', { hl: 1 }, 800], [1000, 'hide_parts', { hl: 0, hide: 1 }, 900]],
    [[0, 'fit_to_budget', { wire: 1 }, 600], [500, 'fit_to_budget', { count: T[1], wire: 0, yaw: 0.35 }, 1500]],
    [[0, '', { yaw: 0.9 }, 1400]],
  ];
  let stage = 0, token = 0;
  const go = async (next) => {
    if (next === stage) return;
    const mine = ++token, forward = next > stage;
    stage = next;
    if (!forward) { say('', NOTE[next]); await tween(END[next], 600); return; }
    // the earlier steps are already done: set them, then play this message
    const before = END[next - 1];
    await tween(before, 0);
    for (const [pause, tool, to, ms] of TIMELINES[next]) {
      if (pause) await new Promise((r) => setTimeout(r, pause));
      if (mine !== token) return;
      say(tool, null);
      await tween(to, ms);
      if (mine !== token) return;
    }
    say('', NOTE[next]);
  };

  // ---- the example session drives it: site.js plays the chat message by message and says which step it is on ----
  const grid = root.closest('[data-cx-grid]');
  if (grid) grid.addEventListener('cx:stage', (e) => go(+e.detail || 0));
  if (grid && +grid.dataset.stage) go(+grid.dataset.stage);          // (the chat may have got ahead while the model was loading)
  window.addEventListener('resize', draw, { passive: true });
  say('', NOTE[0]);
  root.hidden = false;
  root.closest('[data-cx-grid]')?.classList.add('has-3d');
  paint();
  return { go };
}
