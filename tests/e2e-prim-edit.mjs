// node tests/e2e-history-card.mjs [model, default inbox/GearboxAssy.glb]
//
// Model mode (Edit mesh) does not open on a library shape that still has its parameters: its button is grey, says Bake geo first, and a press
// does nothing; after Bake geo the same part can be edited.
// Needs the app served on APP_PORT (default 4242; use 4343 with its own server: python app/serve.py --no-browser --port 4343),
// Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9348, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let failed = 0;
const ok = (cond, what, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + what + (extra ? '  ' + extra : '')); if (!cond) failed++; };
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n')[0]);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const b = await fetch(${JSON.stringify(MODEL)}).then(r => r.blob()); const f = new File([b], ${JSON.stringify(MODEL.split('/').pop())}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById('file-input') || document.querySelector('input[type=file]'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);

  const G = (c) => evalJS(c);
  const pid = await G(`(() => { const p = _appFns._addPrimitive ? _appFns._addPrimitive('cube', {}) : null; return p ? p.partId : null; })()`);
  await G(`(() => { const p = state.parts.filter(q => !q.deleted && q.isPrimitive).pop(); state.selected = new Set([p.partId]); window.__pp = p.partId; _appFns.applySelectionColors && _appFns.applySelectionColors(); })()`);
  await sleep(500);
  ok(await G(`state.parts.some(q => q.partId === window.__pp && q.isPrimitive)`), 'a library shape is in the scene');
  ok(await G(`document.getElementById('em-mode').classList.contains('is-prim') && document.getElementById('em-mode').getAttribute('aria-disabled') === 'true' && /Bake geo/.test(document.getElementById('em-mode').title)`), 'Model mode is grey and says Bake geo first');
  await G(`document.getElementById('em-mode').click()`); await sleep(400);
  ok(await G(`!document.querySelector('.section-cmd[data-cmd="elements"]:not([hidden])')`), 'a press does not open Edit mesh');
  await G(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))`); await sleep(300);
  ok(await G(`!document.querySelector('.section-cmd[data-cmd="elements"]:not([hidden])')`), 'nor does the key for Polygons');
  await G(`document.querySelector('.prim-bake').click()`); await sleep(600);
  ok(await G(`!state.parts.find(q => q.partId === window.__pp).isPrimitive && !document.getElementById('em-mode').classList.contains('is-prim')`), 'after Bake geo the button is on again');
  await G(`document.getElementById('em-mode').click()`); await sleep(600);
  ok(await G(`!!document.querySelector('.section-cmd[data-cmd="elements"]:not([hidden])') || document.getElementById('em-pick-points') && !document.getElementById('em-pick-points').hidden`), 'and Edit mesh opens on it');
  // Edit mesh is open on the baked part; picking another library shape closes it
  const pid2 = await G(`(() => { const p = _appFns._addPrimitive('sphere', {}); return p ? p.partId : null; })()`);
  await sleep(400);
  await G(`(() => { state.selected = new Set([${pid2}]); _appFns.applySelectionColors(); })()`); await sleep(700);
  ok(await G(`!document.querySelector('.section-cmd[data-cmd="elements"]:not([hidden])')`), 'with Edit mesh open, picking a library shape closes it');
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { if (errors.length) console.log('page errors:', errors.slice(0, 5)); try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
