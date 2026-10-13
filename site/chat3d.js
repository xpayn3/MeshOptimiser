// ========== MESHOPTIMISER SITE: THE PART NEXT TO THE CHAT ==========
// The Gearbox Assy of the example session on claude.html, as a real mesh: the app's own export (95 parts, Draco, about 90,000
// triangles so the page stays light) beside the conversation. As each message of the chat comes into view the part does what
// Claude just asked the app to do: find_fasteners lights the 48 bolts, nuts and washers, hide_parts takes them away, fit_to_budget
// flashes the triangles and counts the scene down from 646,064 to 299,984. It draws only while something moves (a step, a resize),
// never in a loop. Loaded by site.js on a desktop screen with motion allowed; anything that goes wrong leaves the chat on its own.
// (the import map in the page head says where 'three' and the add-ons come from)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function start(root, base) {
  const data = JSON.parse(root.querySelector('[data-cx3d-data]').textContent);
  const fastener = new Set(data.fasteners);
  const canvas = root.querySelector('canvas');
  const hudTris = root.querySelector('[data-hud-tris]'), hudNote = root.querySelector('[data-hud-note]'), hudTool = root.querySelector('[data-hud-tool]');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;
  const head = new THREE.DirectionalLight(0xffffff, 0.8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a40, 0.35), head, head.target);

  const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync(base + data.glb + '?v=1');
  draco.dispose();
  const model = gltf.scene;
  scene.add(model);

  // every part gets a material of its own (to tint, fade or hide it) and a wireframe twin that shares its geometry
  const parts = [];
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x9fd6ff, wireframe: true, transparent: true, opacity: 0, depthWrite: false });
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });          // (collected first: a twin added while walking would be walked too)
  for (const o of meshes) {
    o.material = o.material.clone();
    o.material.envMapIntensity = 1;
    const twin = new THREE.Mesh(o.geometry, wireMat);
    twin.matrixAutoUpdate = false; twin.visible = false;
    o.add(twin);
    parts.push({ mesh: o, twin, isFastener: fastener.has(o.name), base: o.material.color.clone() });
  }
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const radius = size.length() / 2;

  const camera = new THREE.PerspectiveCamera(32, 1, radius * 0.05, radius * 20);
  const view = { yaw: 0.65, pitch: 0.42 };
  const accent = new THREE.Color(0x0d99ff);

  // ---- the state, and a tween between two states ----
  const cur = { hl: 0, hide: 0, wire: 0, count: data.tris[0], yaw: 0 };
  let w = 0, h = 0, queued = false;
  const place = () => {
    const yaw = view.yaw + cur.yaw, d = radius * 3.7;
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
      camera.aspect = w / h; camera.updateProjectionMatrix();
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

  // ---- the chat drives it: the last message whose top has risen past the reading line is the one that counts ----
  const msgs = [...document.querySelectorAll('[data-stage]')];
  let waiting = false;
  const read = () => {
    waiting = false;
    const line = window.innerHeight * 0.62;
    let now = 0;
    for (const m of msgs) if (m.getBoundingClientRect().top < line) now = Math.max(now, +m.dataset.stage);
    go(now);
  };
  const onScroll = () => { if (!waiting) { waiting = true; requestAnimationFrame(read); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  read();

  window.addEventListener('resize', draw, { passive: true });
  say('', NOTE[0]);
  root.hidden = false;
  root.closest('[data-cx-grid]')?.classList.add('has-3d');
  paint();
  return { go };
}
