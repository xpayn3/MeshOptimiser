// node tests/e2e-edit-dot-size.mjs [model, default inbox/GearboxAssy.glb]
//
// Edit mesh, Points mode: the dots shrink as the view zooms out. Dots of a fixed size ran together into a dark crust over the mesh when
// the points came close on the screen (and the picked ones, drawn bigger, into an orange one). Here, on the part with the most points:
// each dot is sized by the gap to its nearest point as it is on the screen: close up they are
// larger, far away at or near their least (3.5 px); the picked points are the
// size of the others, only orange, near and far. SHOT=folder saves the near and the far picture. Needs the app served on
// http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9364, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-dotsize-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });
const until = async (expr, tries = 40, ms = 250) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr).catch(() => false)) return true; await sleep(ms); } return false; };
const attach = async () => {
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
};

// the camera at k times the part's radius from its middle, looking at it
const AT = (k) => `(async () => { const F = window._appFns, THREE = F.THREE, p = window.state.parts.find(q => q.partId === window.__dsPart);
  const b = new THREE.Box3().setFromObject(p.mesh), c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
  F.camera.position.copy(c).add(new THREE.Vector3(1, -1.2, 0.8).normalize().multiplyScalar(r * ${k})); F.controls.target.copy(c); F.camera.lookAt(c); F.camera.updateMatrixWorld(true);
  F.controls.update?.(); F.requestRender(); await new Promise(res => setTimeout(res, 900)); const m = window.__moElements.marks(); return { ...m.dotPx, max: m.dotPxMax.all, pickMax: m.dotPxMax.pick }; })()`;
const shot = async (name) => {
  if (!process.env.SHOT) return;
  const clip = await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left + r.width * .25, y: r.top + r.height * .2, width: r.width * .5, height: r.height * .6, scale: 1 }; })()");
  const pic = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(process.env.SHOT, 'dots-' + name + '.png'), Buffer.from(pic.data, 'base64'));
};

try {
  await attach();
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node[data-part-id]').length"); if (n > 5) break; await sleep(500); }
  await until("!document.getElementById('loader')?.classList.contains('show')", 120);
  await sleep(1500);
  // the part with the most points, selected by its row, then Points mode
  const pid = await evalJS(`(() => { const ps = window.state.parts.filter(p => !p.deleted && p.mesh && p.mesh.geometry); ps.sort((a, b) => b.mesh.geometry.attributes.position.count - a.mesh.geometry.attributes.position.count);
    const p = ps[0]; window.__dsPart = p.partId; const row = document.querySelector('#tree .tree-node[data-part-id="' + p.partId + '"]'); row?.scrollIntoView({ block: 'center' }); row?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return p.partId; })()`);
  await sleep(500);
  await evalJS("window.__moElements.mode('points'); true");
  check('Points mode draws the part\'s dots', await until("window.__moElements.marks().dots > 100", 40, 250), await evalJS('window.__moElements.marks()'));

  const near = await evalJS(AT(1.3));
  await shot('near');
  const far = await evalJS(AT(40));
  await shot('far');
  console.log('  dots in view: near middle', near.all, 'px, largest', near.max, 'px; far middle', far.all, 'px, largest', far.max, 'px');
  check('close up a point with no other near it has its full size (6 px)', near.max === 6, near);
  check('far away every dot is smaller: even the largest', far.max < near.max, { near, far });
  check('far away they are at or near their least size (3.5 px), never under it', far.all >= 3.5 && far.all <= 4, far);

  // picked points: the size of the others, only orange
  await evalJS(AT(1.3));
  const n = await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return window.__moElements.boxPick(r.left + r.width * .3, r.top + r.height * .3, r.left + r.width * .7, r.top + r.height * .7); })()");
  await sleep(500);
  check('some points are picked', (await evalJS("window.__moElements.marks().picked")) > 0, n);
  const full = await evalJS("window.__moElements.marks().dotFull");
  check('a picked point is sized as any other point: the same full size, least size and share of its gap (only its colour differs)', JSON.stringify(full.pick) === JSON.stringify(full.all), full);
  await shot('near-picked');
  const farP = await evalJS(AT(40));
  check('far away the picked dots shrink as the others do', farP.pick != null && farP.pickMax < 6, farP);
  await shot('far-picked');
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
