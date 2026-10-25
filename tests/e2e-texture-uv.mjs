// node tests/e2e-texture-uv.mjs
//
// A model that came without textures (an OBJ with texture coordinates but no .mtl) has its UVs put away at import. Giving its material a
// texture later must bring them back, or the texture shows nothing. Opens a small OBJ with UVs, checks the UVs are off the geometry, gives
// the material a checker texture, checks they are back and that the cube is drawn with the texture's colours.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), Chrome installed and Node 22+.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9353, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-texuv-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, curId = ''; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
const sum = async () => (await call('scene_summary')).j;
const copies = () => evalJS(`new Promise((res) => { const r = indexedDB.open('mo-recovery', 1); r.onupgradeneeded = () => r.result.createObjectStore('snaps', { keyPath: 'key' }); r.onsuccess = () => { const q = r.result.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => { res(q.result.map(s => ({ name: s.name, parts: s.parts, size: s.size, unit: s.unit, up: s.up }))); r.result.close(); }; }; r.onerror = () => res(null); })`);
const ready = async () => {
  // (app-ready alone is not enough: the page shows itself after a cap even while the app's module is still starting, e.g. on a busy
  // graphics card, and the tools below would not be there yet; so the module's own hooks are waited for too)
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moBridgeTools && window.__moOpenFile)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  curId = target.id;
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
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  // a cube with its own UVs on every face, as an OBJ
  const faces = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]];
  const V = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const obj = ['o cube', ...V.map(v => 'v ' + v.join(' ')), 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', ...faces.map(f => 'f ' + f.map((vi, k) => (vi + 1) + '/' + (k + 1)).join(' '))].join(String.fromCharCode(10));
  const load = async (keep) => {
    await evalJS(`(async () => { const f = new File([${JSON.stringify(obj)}], 'cube.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    for (let i = 0; i < 40; i++) { if (await evalJS("!!document.getElementById('imp-keep-uv') && document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
    check('the import dialog has the "Keep texture coordinates" switch', await evalJS("!!document.getElementById('imp-keep-uv')"));
    check('and it is on by default', keep === true ? await evalJS("document.getElementById('imp-keep-uv').checked") : true);
    if (!keep) await evalJS("document.getElementById('imp-keep-uv').click()");
    await evalJS("document.querySelector('#import-modal-confirm')?.click()");
    for (let i = 0; i < 60; i++) { if (await evalJS("window.state && window.state.parts.length > 0").catch(() => false)) break; await sleep(500); }
    await sleep(1500);
  };
  await load(true);
  check('the cube is open', await evalJS("window.state.parts.length") === 1);
  check('its UVs are kept by default', await evalJS("!!window.state.parts[0].mesh.geometry.attributes.uv"));
  // a red / green checker texture, as the material editor would make one
  await evalJS(`(async () => {
    const T = await import('three');
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#ff0000'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#00ff00'; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32);
    const tex = new T.Texture(c); tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.needsUpdate = true;
    const m = window.state.parts[0].mesh.material; m.map = tex; m.color.set(0xffffff); m.needsUpdate = true; return true; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 450, deltaX: 0, deltaY: 5 }); await sleep(2500);   // (the view draws on demand: a small zoom asks for a frame, as the material editor's own requestRender does)
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('fs')).writeFileSync(process.env.SHOT || 'scratch/texture-uv.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved');
  await evalJS("window.__moResetScene()"); await sleep(2500);
  await load(false);
  check('with the switch off the cube is open again', await evalJS("window.state.parts.length") === 1);
  check('and its UVs are taken off, as before', await evalJS("!window.state.parts[0].mesh.geometry.attributes.uv"));
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 8).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
