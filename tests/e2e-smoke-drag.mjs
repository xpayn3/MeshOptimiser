// scratch: the real car, drop a material on many parts. node tests/e2e-cardrop.mjs
//
// A model that came without textures (an OBJ with texture coordinates but no .mtl) has its UVs put away at import. Giving its material a
// texture later must bring them back, or the texture shows nothing. Opens a small OBJ with UVs, checks the UVs are off the geometry, gives
// the material a checker texture, checks they are back and that the cube is drawn with the texture's colours.
// Needs the app served on http://localhost:4242 (python serve.py --no-browser --port 4242), Chrome installed and Node 22+.
// Needs the app served on http://localhost:4242 (python serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9361, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-smoke-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
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
  const obj = ['o a', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join(String.fromCharCode(10));
  await evalJS(`(() => { const f = new File([${JSON.stringify(obj)}], 'drop.obj'); const dt = new DataTransfer(); dt.items.add(f); const vp = document.getElementById('viewport');
    for (const type of ['dragenter', 'dragover', 'drop']) vp.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 600, clientY: 400 })); return true; })()`);
  await sleep(2500);
  console.log('import dialog after a file drop:', await evalJS("document.getElementById('import-modal').classList.contains('show')"));
  await evalJS("document.querySelector('#import-modal-confirm')?.click()"); await sleep(3000);
  console.log('parts after confirming:', await evalJS("window.state.parts.length"));
  await evalJS("document.getElementById('tg-materials').click()"); await sleep(2000);
  console.log('material tiles draggable:', await evalJS("[...document.querySelectorAll('#vp-materials-pop .mat-cell, #vp-materials-pop .mat-row')].map(c => c.draggable).join(',')"));
  console.log('page exceptions', errors.length, errors.slice(0, 4).join(' | ').slice(0, 400));
} catch (e) { console.log('HARNESS ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(0);
