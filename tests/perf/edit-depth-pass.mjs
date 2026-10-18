// What a separate depth pass for Edit mesh's marks would cost: the frame time while the camera turns, as the app draws it, and with one
// more drawing of the scene before it (depth only, into a target of its own, at full and at half resolution), on a big model.
//   node tests/perf/edit-depth-pass.mjs <model.glb>        (APP_PORT: the app's port, default 4242; WebGPU on the graphics card, WEBGL=1 for WebGL2)
// Each frame: the camera moves a step round the model, the scene is drawn, and the time is taken once the GPU has finished (WebGPU:
// queue.onSubmittedWorkDone; WebGL: a 1-pixel read). The app's own render loop is left idle meanwhile.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = path.resolve(process.argv[2] || 'inbox/GearboxAssy.glb');
const WEBGL = process.env.WEBGL === '1';
const PORT = 9361, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-depthpass-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html' + (WEBGL ? '?webgl=1' : '');
const W = 1920, H = 1080, FRAMES = +(process.env.FRAMES || 90);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text); };
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + (URL.includes('?') ? '&' : '?') + 't=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  // the model through the file input, from where it is on disk (no copy)
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [MODEL] });
  const t0 = Date.now();
  let last = -1, same = 0;
  for (let i = 0; i < 1200; i++) {
    await sleep(1000);
    const n = await evalJS("document.querySelectorAll('#tree .tree-node').length").catch(() => 0);
    if (n > 3 && n === last) same++; else same = 0;
    last = n;
    if (same >= 8) break;
  }
  await sleep(5000);
  console.log('model', path.basename(MODEL), 'open after', Math.round((Date.now() - t0) / 1000), 's');
  const info = await evalJS(`(() => { const F = window._appFns, r = F.renderer; return { backend: r.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2', dpr: r.getPixelRatio(), size: [r.domElement.width, r.domElement.height], info: document.querySelector('#stat-tris, .stat-tris')?.textContent || '' }; })()`);
  console.log('renderer', JSON.stringify(info));
  const res = await evalJS(`(async () => {
    const F = window._appFns, THREE = F.THREE, r = F.renderer, cam = F.camera, ctl = F.controls;
    let scene = null; for (let id = 0; id < 100000 && !scene; id++) { const p = F.getPart(id); if (p && p.mesh) { let o = p.mesh; while (o.parent) o = o.parent; scene = o; } }
    let tris = 0, parts = 0; scene.traverse(o => { if (o.isMesh && o.visible && o.geometry) { parts++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
    const gpu = r.backend.isWebGPUBackend;
    const done = async () => { if (gpu) await r.backend.device.queue.onSubmittedWorkDone(); else { const gl = r.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); } };
    // the depth pass: every visible mesh in depth only, into a target of its own (lines, sprites and helpers are left out by a layer)
    const LAYER = 7;
    scene.traverse(o => { if (o.isMesh && !o.isSprite) o.layers.enable(LAYER); });
    const depthMat = new THREE.MeshBasicNodeMaterial({ colorWrite: false, side: THREE.DoubleSide });
    depthMat.forceSinglePass = true;
    const size = new THREE.Vector2(); r.getDrawingBufferSize(size);
    const mk = (s) => { const dt = new THREE.DepthTexture(Math.max(1, Math.round(size.x * s)), Math.max(1, Math.round(size.y * s))); dt.type = THREE.FloatType; return new THREE.RenderTarget(Math.round(size.x * s), Math.round(size.y * s), { depthTexture: dt, depthBuffer: true, samples: 0 }); };
    const rtFull = mk(1), rtHalf = mk(0.5);
    const depthPass = (rt) => {
      const prevT = r.getRenderTarget(), mask = cam.layers.mask, ov = scene.overrideMaterial, bg = scene.background;
      scene.overrideMaterial = depthMat; cam.layers.set(LAYER); scene.background = null;
      r.setRenderTarget(rt); r.render(scene, cam);
      r.setRenderTarget(prevT); cam.layers.mask = mask; scene.overrideMaterial = ov; scene.background = bg;
    };
    const target = ctl.target.clone(), start = cam.position.clone().sub(target);
    const step = (i) => { const a = i * 2 * Math.PI / ${FRAMES}; const v = start.clone().applyAxisAngle(cam.up, a); cam.position.copy(target).add(v); cam.lookAt(target); cam.updateMatrixWorld(); };
    // The variants take turns, frame by frame (the GPU's clock and the browser's other work change over a run: one after the other,
    // the same picture measured 54 ms in one block and 63 in the next).
    const V = [
      { label: 'as the app draws it', f: () => r.render(scene, cam) },
      { label: '+ depth pass, full resolution', f: () => { depthPass(rtFull); r.render(scene, cam); } },
      { label: '+ depth pass, half resolution', f: () => { depthPass(rtHalf); r.render(scene, cam); } },
      { label: 'the depth pass alone, half', f: () => depthPass(rtHalf) },
    ];
    for (const v of V) { v.ts = []; for (let i = 0; i < 6; i++) { step(i); v.f(); await done(); } }      // (warm-up: pipelines built)
    for (let i = 0; i < ${FRAMES}; i++) for (const v of V) { step(i); const t = performance.now(); v.f(); await done(); v.ts.push(performance.now() - t); }
    const out = V.map(v => { const ts = v.ts.sort((a, b) => a - b), mean = ts.reduce((a, b) => a + b, 0) / ts.length; return { label: v.label, mean: +mean.toFixed(2), median: +ts[ts.length >> 1].toFixed(2), p90: +ts[Math.floor(ts.length * 0.9)].toFixed(2) }; });
    return { tris: Math.round(tris), parts, size: [size.x, size.y], out };
  })()`);
  console.log('scene', res.parts, 'meshes,', res.tris.toLocaleString('en'), 'triangles drawn,', res.size.join('×'), 'px');
  for (const o of res.out) console.log(o.label.padEnd(34), 'mean', o.mean, 'ms  median', o.median, 'ms  90%', o.p90, 'ms');
  if (errors.length) console.log('errors:', errors.slice(0, 5));
} catch (e) { console.log('HARNESS ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
