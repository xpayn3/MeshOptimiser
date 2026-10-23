// node tests/e2e-env-up.mjs
//
// The environment (the plain backgrounds' studio reflections, an HDRI) lights the model from above in the scene's own up axis.
// three's environments have their sky at +Y and the app's world is Z-up, so they are turned by scene.environmentRotation and
// backgroundRotation (_applyEnvTurn).
// A white matte cube is lit by the environment alone (the app's lights at 0), and the brightness and colour of its top and of a side
// face are read from render_image: in the studio the top must be the bright one (the room's ceiling lights), under the Sunset HDRI the
// side must be the orange one (the horizon) and the top the blue one (the sky). Then the same in a Y-up scene, where "top" is +Y.
// Last, the HDRI turned: a mirror ball seen from a direction reflects what the background shows when looked at in that direction,
// in both up axes (in a Z-up scene the background used to stay put, or turn against the lighting, while the lighting turned).
// Needs the app on http://localhost:4242, Chrome, Node 22+. CAPTURE_GPU=1 uses the machine's own GPU (WebGPU) instead of SwiftShader.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';      // (render_image wants a model; it is hidden while the cube is measured)
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9348, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-envup-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GPU_FLAGS = process.env.CAPTURE_GPU === '1' ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GPU_FLAGS, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name, extra === undefined ? '' : JSON.stringify(extra)); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

const PAGE = `
window.__envT = {
  setup() {
    const A = window._appFns, cam = A.camera, scene = cam.parent, T = A.THREE;
    for (const o of scene.children) if (o !== cam && o.visible) { o.visible = false; }
    scene.traverse(o => { if (o.isLight) o.intensity = 0; });
    this.cube = new T.Mesh(new T.BoxGeometry(2, 2, 2), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
    scene.add(this.cube);
    this.scene = scene; this.T = T; this.cam = cam;
  },
  lightsOff() { this.scene.traverse(o => { if (o.isLight) o.intensity = 0; }); },
  aim(zs) {
    const cam = this.cam;
    cam.position.set(6, 6, 6 * zs); cam.near = 0.1; cam.far = 1000; cam.lookAt(0, 0, 0); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    window._appFns.controls.target.set(0, 0, 0);
  },
  async faces(zs = 1) {
    this.lightsOff(); this.aim(zs);
    const W = 640, H = 480;
    const r = await window.__moBridgeTools.render_image({ width: W, height: H, background: 'current', fit: false });
    const img = r.find(x => x && x.type === 'image');
    const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + img.data)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    const d = x.getImageData(0, 0, bm.width, bm.height).data;
    const c2 = this.cam.clone(); c2.aspect = bm.width / bm.height; c2.updateProjectionMatrix(); c2.updateMatrixWorld();
    const at = (vx, vy, vz) => {
      const p = new this.T.Vector3(vx, vy, vz).project(c2), px = Math.round((p.x + 1) / 2 * bm.width), py = Math.round((1 - p.y) / 2 * bm.height);
      let s = [0, 0, 0], n = 0;
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { const k = ((py + j) * bm.width + px + i) * 4; s[0] += d[k]; s[1] += d[k + 1]; s[2] += d[k + 2]; n++; }
      return s.map(v => Math.round(v / n));
    };
    return { px: at(1, 0, 0), py: at(0, 1, 0), pz: at(0, 0, 1), nz: at(0, 0, -1) };
  },
};`;
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const warm = (c) => (c[0] + 1) / (c[2] + 1);

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);
  console.log('renderer:', await evalJS("window._appFns.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2'"));
  await evalJS(PAGE);
  for (let i = 0; i < 40; i++) { if (await evalJS('!!window._appFns.camera.parent.environment')) break; await sleep(250); }
  await evalJS('window.__envT.setup()');
  const setUp = (v) => evalJS(`(() => { const s = document.getElementById('scene-up-axis'); s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const setBg = (v) => evalJS(`(() => { const s = document.getElementById('bg-mode'); s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

  const seen = {};
  for (const up of ['z', 'y']) {
    await setUp(up); await setBg('dark'); await sleep(2500);
    // (the same two walls of the environment in both: the top, and Z-up's +Y = Y-up's -Z)
    const top = up === 'z' ? 'pz' : 'py', side = up === 'z' ? 'py' : 'nz', zs = up === 'z' ? 1 : -1;
    const st = await evalJS(`window.__envT.faces(${zs})`);
    seen[up] = st[top];
    check(`${up.toUpperCase()}-up, studio reflections: the top is lit more than the side`, lum(st[top]) > lum(st[side]) * 1.15, { top: st[top], side: st[side] });
    await setBg('hdri'); await sleep(800);
    await evalJS("document.querySelector('.hdri-preset[data-hdri-preset=\"sunset\"]').click()"); await sleep(1500);
    const hs = await evalJS(`window.__envT.faces(${zs})`);
    check(`${up.toUpperCase()}-up, Sunset HDRI: the side is warmer (horizon) than the top (sky)`, warm(hs[side]) > warm(hs[top]) * 1.2, { top: hs[top], side: hs[side] });
  }
  check('the top is lit the same in a Z-up and a Y-up scene', Math.abs(lum(seen.z) - lum(seen.y)) < 0.08 * lum(seen.z), seen);
  // the HDRI turned: the reflection in direction d and the background in direction d are the same colour
  const agree = () => evalJS(`(async () => {
    const A = window._appFns, T = A.THREE, r = A.renderer, scene = A.camera.parent;
    const was = [];
    for (const o of scene.children) if (o.visible && !o.isCamera) { was.push(o); o.visible = false; }
    const ball = new T.Mesh(new T.SphereGeometry(1, 128, 64), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0, metalness: 1 }));
    scene.add(ball); scene.traverse(o => { if (o.isLight) o.intensity = 0; });
    const N = 64, rt = new T.RenderTarget(N, N, { type: T.UnsignedByteType });
    const cam = new T.PerspectiveCamera(10, 1, 0.01, 1000);
    const mid = async () => { r.setRenderTarget(rt); r.render(scene, cam); const px = await r.readRenderTargetPixelsAsync(rt, 0, 0, N, N); r.setRenderTarget(null); const k = (N / 2 * N + N / 2) * 4; return [px[k], px[k + 1], px[k + 2]]; };
    let worst = 0;
    for (const d of [[1, 0, 0.2], [0, 1, 0.2], [-1, 0.3, 0.1], [0.4, -1, 0.5], [0.6, 0.5, -0.4]]) {
      const v = new T.Vector3(...d).normalize();
      ball.visible = true; cam.position.copy(v).multiplyScalar(8); cam.up.set(0, 0, 1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
      const refl = await mid();
      ball.visible = false; cam.position.set(0, 0, 0); cam.lookAt(v); cam.updateMatrixWorld();
      const bg = await mid();
      worst = Math.max(worst, ...refl.map((q, i) => Math.abs(q - bg[i])));
    }
    scene.remove(ball); ball.geometry.dispose(); ball.material.dispose(); rt.dispose();
    for (const o of was) o.visible = true;
    return worst;
  })()`);
  for (const up of ['z', 'y']) {
    await setUp(up); await setBg('hdri'); await sleep(800);
    await evalJS("document.querySelector('.hdri-preset[data-hdri-preset=\"outdoor\"]').click()"); await sleep(1500);
    for (const rot of [0, 1.1, 2.6]) {
      await evalJS(`window.__moAgent.sceneState.apply({ app: 'step-optimizer', view: { hdriRotation: ${rot} } })`); await sleep(300);
      const w = await agree();
      check(`${up.toUpperCase()}-up, Outdoor HDRI turned ${rot}: the background shows what the reflections show`, w <= 14, { worst: w });
    }
  }
  // the HDRI's strength reaches a plain MeshStandardMaterial through the scene alone (no material is touched for it)
  const setInt = (k) => evalJS(`window.__moAgent.sceneState.apply({ app: 'step-optimizer', view: { hdriIntensity: ${k} } })`);
  await setUp('z'); await sleep(800);
  await setInt(0.4); await sleep(400);
  const dim = await evalJS('window.__envT.faces(1)');
  await setInt(1.6); await sleep(400);
  const bright = await evalJS('window.__envT.faces(1)');
  await setInt(1); await sleep(300);
  check('the HDRI strength lights the cube (top at 1.6 brighter than at 0.4)', lum(bright.pz) > lum(dim.pz) * 1.5, { dim: dim.pz, bright: bright.pz, envMapIntensity: await evalJS('window.__envT.cube.material.envMapIntensity') });
  check('no uncaught errors', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  fail++; console.log('FAIL', e.message);
} finally {
  try { ws && ws.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
