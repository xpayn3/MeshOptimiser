// ========== MESHOPTIMISER SITE: THE TWO LIVE MODELS ON THE FEATURES PAGE ==========
// 1. Before and after (data-live="wipe"): the Gearbox Assy as it came (646,064 triangles) on the left and, on the right, the same vertices with
//    the smaller index set the app's own simplifier made of them (tools/bake-wipe.mjs: half, a quarter, a tenth). Drag the line, pick the level.
// 2. Fasteners (data-live="fast"): the truck axle of the opening (295 parts). Find the socket screws, take them out, put them back, with the
//    triangle count they cost. Drag to turn the model.
// Both draw only when something happens (a drag, a click, an animation that is running), never in a loop. They are loaded by site.js where
// WebGL works, on a wide screen with a mouse and motion allowed; anything that goes wrong leaves the picture that is in the page.
// (the import map in the page head says where 'three' and the add-ons come from)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { studioEnvironment, productStudio, kindOfMesh, settleKinds } from './axle-look.js?v=6';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const ease = (t) => t * t * (3 - 2 * t);
const $ = (sel, root) => root.querySelector(sel);

// A canvas in the stage, sized to it, with the app's tone mapping. `redraw` is called when the size changes.
function makeRenderer(stage, redraw) {
  const canvas = document.createElement('canvas');
  canvas.className = 'live-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping || THREE.ACESFilmicToneMapping;
  const size = { w: 0, h: 0 };
  const fit = () => {
    const b = stage.getBoundingClientRect(), w = Math.round(b.width), h = Math.round(b.height);
    if (!w || !h || (w === size.w && h === size.h)) return false;
    size.w = w; size.h = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    return true;
  };
  new ResizeObserver(() => { if (fit()) redraw(); }).observe(stage);
  fit();
  return { renderer, canvas, size, fit };
}

// Frames a box from a direction: the distance at which the whole of it is in the picture.
function frame(camera, box, yaw, pitch, aspect, fill = 0.72) {
  const c = box.getCenter(new THREE.Vector3()), radius = box.min.distanceTo(box.max) / 2;
  const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * aspect);
  const dist = (radius * fill) / Math.sin(Math.min(vf, hf));        // (a smaller `fill` brings the camera closer)
  camera.position.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)).multiplyScalar(dist).add(c);
  camera.near = dist / 100; camera.far = dist * 40;
  camera.aspect = aspect; camera.updateProjectionMatrix();
  camera.lookAt(c);
  camera.updateMatrixWorld(true);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. BEFORE AND AFTER
// ---------------------------------------------------------------------------------------------------------------------------------
async function wipe(el, base) {
  const stage = $('[data-stage]', el);
  // data-model="axle": the truck axle of the Fasteners model, in its look (axle-look.js); otherwise the Gearbox Assy
  const axle = el.dataset.model === 'axle', name = axle ? 'axle' : 'gearbox';
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [gltf, meta, lodBuf] = await Promise.all([
    loader.loadAsync(base + (axle ? 'axle-web.glb?v=1' : 'wipe/gearbox.glb?v=1')),
    fetch(base + 'wipe/' + name + '-lod.json?v=2').then((r) => r.json()),
    fetch(base + 'wipe/' + name + '-lod.bin?v=2').then((r) => r.arrayBuffer()),
  ]);
  let level = Math.max(0, meta.levels.findIndex((l) => l.id === (el.dataset.level || 'half')));
  const yaw0 = axle ? 52 : 38;
  let split = 0.5, queued = false, yaw = THREE.MathUtils.degToRad(yaw0), pitch = THREE.MathUtils.degToRad(axle ? 24 : 20);
  const { renderer, size, fit } = makeRenderer(stage, () => ask());

  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  if (axle) {
    scene.environment = studioEnvironment(renderer);
    scene.environmentIntensity = 1.3;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x303642, 0.3));
    const k = new THREE.DirectionalLight(0xffffff, 1.1); k.position.set(80, 100, -60); scene.add(k);
    const f = new THREE.DirectionalLight(0xb0c4ff, 0.18); f.position.set(-80, 60, 40); scene.add(f);
  } else {
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.9;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x303642, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(60, 90, 50); scene.add(key);
  }

  // The surfaces are pushed back a little so the triangle lines drawn on them are not eaten by the faces they lie on.
  const WIRE = new THREE.MeshBasicMaterial({ color: 0x0a0a0c, wireframe: true, transparent: true, opacity: 0.3, depthWrite: false });
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (axle) {
    // the parts take the materials of the axle by their names (a copy of each, because the surfaces below are pushed back)
    gltf.scene.updateMatrixWorld(true);
    const corner = new THREE.Vector3();
    const entries = meshes.map((m) => {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox, pts = [];
      for (let k = 0; k < 8; k++) { corner.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(m.matrixWorld); pts.push(corner.clone()); }
      return { mesh: m, pts, kind: kindOfMesh(m) };
    });
    settleKinds(entries);
    const own = new Map();
    for (const e of entries) { if (!own.has(e.material)) own.set(e.material, e.material.clone()); e.mesh.material = own.get(e.material); }
  }
  const afterOf = new Map();      // geometry key -> geometry at the current level
  const afters = [];
  for (const m of meshes) {
    for (const mt of [].concat(m.material)) { mt.polygonOffset = true; mt.polygonOffsetFactor = 1; mt.polygonOffsetUnits = 1; if (!axle) { mt.metalness = Math.max(mt.metalness || 0, 0.25); mt.roughness = Math.min(mt.roughness == null ? 0.6 : mt.roughness, 0.55); } }
    m.layers.set(1);
    const before = new THREE.Mesh(m.geometry, WIRE); before.layers.set(1); m.add(before);        // (the lines of the original, a child of the part)
    const a = new THREE.Mesh(m.geometry, m.material);
    a.position.copy(m.position); a.quaternion.copy(m.quaternion); a.scale.copy(m.scale);
    a.layers.set(2);
    const w = new THREE.Mesh(m.geometry, WIRE); w.layers.set(2); a.add(w);
    m.parent.add(a);
    const assoc = gltf.parser.associations.get(m) || {};
    afters.push({ mesh: a, wire: w, key: (assoc.meshes ?? -1) + ':' + (assoc.primitives ?? 0), src: m.geometry });
  }
  const indexFor = (key) => {
    const [mi, pi] = key.split(':').map(Number);
    const e = meta.levels[level].prims.find((p) => p[0] === mi && p[1] === pi);
    if (!e) return null;
    const [, , off, count, width] = e;
    return new THREE.BufferAttribute(width === 4 ? new Uint32Array(lodBuf, off, count) : new Uint16Array(lodBuf, off, count), 1);
  };
  const setLevel = (k) => {
    level = k;
    afterOf.clear();
    for (const x of afters) {
      let g = afterOf.get(x.key);
      if (!g) {
        const idx = indexFor(x.key);
        if (idx) { g = new THREE.BufferGeometry(); for (const n of Object.keys(x.src.attributes)) g.setAttribute(n, x.src.attributes[n]); g.setIndex(idx); g.boundingBox = x.src.boundingBox; g.boundingSphere = x.src.boundingSphere; }
        else g = x.src;
        afterOf.set(x.key, g);
      }
      x.mesh.geometry = g; x.wire.geometry = g;
    }
    hud();
    ask();
  };

  // ---- the controls drawn over the picture ----
  const bar = document.createElement('div');
  bar.className = 'live-bar';
  bar.innerHTML = '<div class="live-side is-before"><small>Before</small><strong data-n="before"></strong><span>triangles</span></div>'
    + '<div class="live-side is-after"><small>After</small><strong data-n="after"></strong><span data-n="pct"></span></div>';
  const handle = document.createElement('div');
  handle.className = 'live-handle';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'slider');
  handle.setAttribute('aria-label', 'Before and after');
  handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '100');
  handle.innerHTML = '<i aria-hidden="true"></i>';
  const chips = document.createElement('div');
  chips.className = 'live-chips';
  chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'How far to simplify');
  chips.innerHTML = meta.levels.map((l, k) => `<button type="button" data-k="${k}">${l.label}</button>`).join('');
  stage.append(bar, handle, chips);
  const hud = () => {
    const L = meta.levels[level];
    $('[data-n="before"]', bar).textContent = fmt(meta.before);
    $('[data-n="after"]', bar).textContent = fmt(L.tris);
    $('[data-n="pct"]', bar).textContent = Math.round(L.tris / meta.before * 100) + '% of the triangles';
    chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.k) === level)));
  };

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const draw = () => {
    queued = false;
    fit();
    const { w, h } = size;
    if (!w || !h) return;
    frame(camera, box, yaw, pitch, w / h, axle ? 0.66 : 0.6);
    const sx = Math.round(w * split);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, w, h);
    camera.layers.mask = 0b011; renderer.setScissor(0, 0, sx, h); renderer.render(scene, camera);
    camera.layers.mask = 0b101; renderer.setScissor(sx, 0, w - sx, h); renderer.render(scene, camera);
    renderer.setScissorTest(false);
    handle.style.left = (split * 100).toFixed(2) + '%';
    handle.setAttribute('aria-valuenow', String(Math.round(split * 100)));
    bar.style.setProperty('--split', (split * 100).toFixed(2) + '%');
  };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };

  // dragging: the line follows the pointer anywhere on the picture; a small turn of the model follows it too
  let drag = false;
  const at = (e) => { const b = stage.getBoundingClientRect(); split = Math.min(0.97, Math.max(0.03, (e.clientX - b.left) / b.width)); yaw = THREE.MathUtils.degToRad(yaw0 + (split - 0.5) * 10); ask(); };
  stage.addEventListener('pointerdown', (e) => { if (e.target.closest('.live-chips') || e.button) return; drag = true; stage.setPointerCapture(e.pointerId); stage.classList.add('is-drag'); at(e); });
  stage.addEventListener('pointermove', (e) => { if (drag) at(e); });
  const up = (e) => { if (!drag) return; drag = false; stage.classList.remove('is-drag'); try { stage.releasePointerCapture(e.pointerId); } catch (_) {} };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    if (e.key === 'ArrowLeft') split = Math.max(0.03, split - step);
    else if (e.key === 'ArrowRight') split = Math.min(0.97, split + step);
    else if (e.key === 'Home') split = 0.03;
    else if (e.key === 'End') split = 0.97;
    else return;
    e.preventDefault(); ask();
  });
  chips.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setLevel(Number(b.dataset.k)); });

  setLevel(level);
  draw();
  el.classList.add('is-live');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. FASTENERS
// ---------------------------------------------------------------------------------------------------------------------------------
async function fast(el, base) {
  const stage = $('[data-stage]', el);
  // data-model="engine": a Scania V8 engine in the file's own materials (chat-scania.glb, Draco); otherwise the truck axle in the site's look
  const engine = el.dataset.model === 'engine';
  const noun = el.dataset.noun || 'screws', whole = el.dataset.whole || 'the whole axle', partsNote = el.dataset.partsNote || '';
  const names = engine ? new Set(JSON.parse($('[data-live-names]', el).textContent)) : null;
  const loader = new GLTFLoader();
  let draco = null;
  if (engine) { draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/draco/gltf/'); loader.setDRACOLoader(draco); }
  else loader.setMeshoptDecoder(MeshoptDecoder);
  const [gltf, table] = await Promise.all([
    loader.loadAsync(base + (engine ? 'chat-scania.glb?v=3' : 'axle-web.glb?v=1')),
    engine ? Promise.resolve(null) : fetch(base + 'axle-offsets.json?v=1').then((r) => r.json()),
  ]);
  if (draco) draco.dispose();
  const isFast = (o) => { for (let q = o; q && q !== gltf.scene; q = q.parent) if (names.has(q.name)) return true; return false; };
  let queued = false, yaw = THREE.MathUtils.degToRad(52), pitch = THREE.MathUtils.degToRad(24);
  const { renderer, size, fit } = makeRenderer(stage, () => ask());

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  let hemi, keyL, fill, head, lights;
  if (engine) {
    // a product-photography studio (axle-look.js), as beside the chat on the Claude page
    renderer.toneMappingExposure = 0.95;
    scene.environment = productStudio(renderer);
    hemi = new THREE.HemisphereLight(0xffffff, 0x303642, 0.4);
    keyL = new THREE.DirectionalLight(0xfff4e8, 0.8); keyL.position.set(90, 120, 70);
    fill = new THREE.DirectionalLight(0xb0c4ff, 0.22); fill.position.set(-90, 50, 50);
    const rim = new THREE.DirectionalLight(0xcfe0ff, 1.0); rim.position.set(-30, 70, -120);
    head = new THREE.DirectionalLight(0xffffff, 0.35);
    scene.add(hemi, keyL, fill, rim, head, head.target);
    lights = [[scene, 'environmentIntensity', 1.05], [hemi, 'intensity', 0.4], [keyL, 'intensity', 0.8], [fill, 'intensity', 0.22], [rim, 'intensity', 1.0], [head, 'intensity', 0.35]];
  } else {
    scene.environment = studioEnvironment(renderer);
    hemi = new THREE.HemisphereLight(0xffffff, 0x303642, 0.3);
    keyL = new THREE.DirectionalLight(0xffffff, 1.1); keyL.position.set(80, 100, -60);
    fill = new THREE.DirectionalLight(0xb0c4ff, 0.18); fill.position.set(-80, 60, 40);
    head = new THREE.DirectionalLight(0xffffff, 0.3);
    scene.add(hemi, keyL, fill, head, head.target);
    lights = [[scene, 'environmentIntensity', 1.3], [hemi, 'intensity', 0.3], [keyL, 'intensity', 1.1], [fill, 'intensity', 0.18], [head, 'intensity', 0.3]];
  }
  const lineMat = new THREE.LineBasicMaterial({ color: 0x0b0c0e, transparent: true, opacity: 0.55 });
  // the screws, when they have been found: lit by themselves, the accent blue of the buttons
  const FOUND = new THREE.MeshBasicMaterial({ color: 0x5fe3d9, transparent: true, opacity: 1, side: THREE.DoubleSide });
  const edgesOf = new Map();

  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const corner = new THREE.Vector3();
  const parts = meshes.map((mesh) => {
    const rest = mesh.matrixWorld.clone();
    const part = new THREE.Mesh(mesh.geometry, mesh.material);
    part.matrixAutoUpdate = false;
    let lines = { visible: false };                       // (the engine is drawn without outlines: its faces are smooth)
    if (!engine) {
      if (!edgesOf.has(mesh.geometry)) edgesOf.set(mesh.geometry, new THREE.EdgesGeometry(mesh.geometry, 38));
      lines = new THREE.LineSegments(edgesOf.get(mesh.geometry), lineMat);
      part.add(lines);
    }
    root.add(part);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox, pts = [];
    for (let k = 0; k < 8; k++) { corner.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(rest); pts.push(corner.clone()); }
    const g = mesh.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    return { part, lines, rest, off: engine ? new THREE.Vector3() : new THREE.Vector3(...(table.offsets[mesh.name] || [0, 0, 0])), pts, kind: engine ? (isFast(mesh) ? 'bolt' : 'steel') : kindOfMesh(mesh), tris, material: engine ? mesh.material : undefined };
  });
  if (!engine) settleKinds(parts);
  for (const p of parts) p.part.material = p.material;
  gltf.scene.clear();
  const screws = parts.filter((p) => p.kind === 'bolt');
  const total = parts.reduce((s, p) => s + p.tris, 0), screwTris = screws.reduce((s, p) => s + p.tris, 0);

  const box = new THREE.Box3();
  for (const p of parts) for (const q of p.pts) box.expandByPoint(q);
  if (engine) {            // a fastener comes out away from the middle of the engine, along the longer way across
    const mid = box.getCenter(new THREE.Vector3()), reach = box.min.distanceTo(box.max) * 0.07, c = new THREE.Vector3();
    for (const p of screws) {
      c.set(0, 0, 0); for (const q of p.pts) c.add(q); c.multiplyScalar(1 / p.pts.length).sub(mid); c.y *= 0.4;
      p.off.copy(c.lengthSq() > 1e-9 ? c.normalize() : c.set(0, 1, 0)).multiplyScalar(reach / 1.4);
    }
  }
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 60);
  camera.up.set(0, 1, 0);
  const shift = new THREE.Matrix4(), tmp = new THREE.Vector3();

  // ---- the state: how far the screws are found (0 to 1) and how far they are out (0 to 1) ----
  let found = 0, out = 0;
  const apply = () => {
    for (const [obj, key, base0] of lights) obj[key] = base0 * (1 - 0.62 * found * (1 - out));
    const o = ease(out);
    for (const p of screws) {
      shift.makeTranslation(p.off.x * 1.4 * o, p.off.y * 1.4 * o, p.off.z * 1.4 * o);
      p.part.matrix.multiplyMatrices(shift, p.rest); p.part.matrixWorldNeedsUpdate = true;
      p.part.material = found > 0.001 ? FOUND : p.material;
      p.part.visible = out < 0.999;
      p.lines.visible = found < 0.001;
    }
    FOUND.opacity = 1 - o;
    if (engine) FOUND.color.setHex(0xffc83d); else FOUND.color.setHex(0x6cc4ff).lerp(new THREE.Color(0x0d99ff), found * 0.5);
  };
  for (const p of parts) { p.part.matrix.copy(p.rest); p.part.matrixWorldNeedsUpdate = true; }
  apply();

  const draw = () => {
    queued = false;
    fit();
    const { w, h } = size;
    if (!w || !h) return;
    frame(camera, box, yaw, pitch, w / h, 0.66);
    camera.setViewOffset(w, h, 0, h * 0.02, w, h);
    camera.updateMatrixWorld(true);
    const right = tmp.setFromMatrixColumn(camera.matrixWorld, 0).clone(), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const dist = camera.position.distanceTo(box.getCenter(new THREE.Vector3()));
    head.position.copy(camera.position).addScaledVector(right, -0.035 * dist).addScaledVector(up, 0.05 * dist);
    head.target.position.copy(camera.position).addScaledVector(new THREE.Vector3().subVectors(camera.position, box.getCenter(new THREE.Vector3())).normalize(), -dist);
    renderer.render(scene, camera);
  };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };

  // ---- the numbers and the button ----
  const bar = document.createElement('div');
  bar.className = 'live-bar is-single';
  bar.innerHTML = '<div class="live-side"><small>Triangles</small><strong data-n="tris"></strong><span data-n="note"></span></div>'
    + '<div class="live-side"><small>Parts</small><strong data-n="parts"></strong><span>' + (partsNote ? partsNote.replace('{n}', screws.length) : 'screws are ' + screws.length + ' of them') + '</span></div>';
  const go = document.createElement('div');
  go.className = 'live-go';
  go.innerHTML = '<button type="button" class="btn is-primary is-large live-step" data-step><span class="live-step-label"></span><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h9M8.5 4l4 4-4 4"/></svg></button>';
  stage.append(bar, go);
  const stepBtn = $('[data-step]', go), stepLabel = $('.live-step-label', go);
  const labels = [`Find the ${screws.length} ${noun}`, 'Take them out', 'Put them back'];
  let phase = 0;
  const hud = () => {
    const now = total - screwTris * ease(out);
    $('[data-n="tris"]', bar).textContent = fmt(now);
    $('[data-n="parts"]', bar).textContent = fmt(parts.length - Math.round(screws.length * ease(out)));
    $('[data-n="note"]', bar).textContent = phase === 0 ? whole : out > 0.999 ? `${fmt(screwTris)} fewer, ${(screwTris / total * 100).toFixed(1)}%` : `${screws.length} ${noun}, ${fmt(screwTris)} triangles`;
    stepLabel.textContent = labels[phase]; stepBtn.dataset.phase = String(phase);
  };

  // one animation at a time, only for as long as it runs
  let run = 0;
  const tween = (from, to, ms, set) => new Promise((resolve) => {
    const id = ++run, t0 = performance.now();
    const tick = (now) => {
      if (id !== run) return resolve();
      const t = Math.min(1, (now - t0) / ms);
      set(from + (to - from) * t); apply(); hud(); draw();
      if (t < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  stepBtn.addEventListener('click', async () => {
    if (phase === 0) { phase = 1; await tween(found, 1, 520, (v) => { found = v; }); }
    else if (phase === 1) { phase = 2; await tween(out, 1, 900, (v) => { out = v; }); }
    else { phase = 0; await Promise.all([tween(out, 0, 800, (v) => { out = v; }).then(() => tween(found, 0, 450, (v) => { found = v; }))]); }
    hud();
  });

  // dragging turns the model
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { if (e.target.closest('.live-go') || e.button) return; drag = { x: e.clientX, y: e.clientY, yaw, pitch }; stage.setPointerCapture(e.pointerId); stage.classList.add('is-drag'); });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw = drag.yaw - (e.clientX - drag.x) * 0.006;
    pitch = Math.max(-0.2, Math.min(1.25, drag.pitch + (e.clientY - drag.y) * 0.005));
    ask();
  });
  const up = (e) => { if (!drag) return; drag = null; stage.classList.remove('is-drag'); try { stage.releasePointerCapture(e.pointerId); } catch (_) {} };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);

  hud();
  draw();
  el.classList.add('is-live');
}

// `el` is a section with data-live="wipe" or "fast"; on any failure the picture in the page stays
export async function start(el, base = '') {
  const kind = el.dataset.live;
  try {
    if (kind === 'wipe') await wipe(el, base);
    else if (kind === 'fast') await fast(el, base);
  } catch (err) {
    console.warn('features3d:', err);
    el.querySelectorAll('.live-canvas, .live-bar, .live-handle, .live-chips, .live-go').forEach((n) => n.remove());
    el.classList.remove('is-live');
  }
}
