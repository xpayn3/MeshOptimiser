// node tests/e2e-axis-gizmo.mjs [model.glb, default inbox/GearboxAssy.glb]
//
// The orientation gizmo (top right of the view) is pixel-exact: its svg is drawn 1:1 (88 px for its 88 units), and in every view the
// three dots (and so the letters in them, which cannot follow a dot by fractions) sit on the device pixel grid. A dot of an odd number
// of pixels is centred on a pixel, one of an even number on a corner. There are three dots only: the positive axes. Needs the app served
// on http://localhost:4242, or APP_PORT.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9395, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-axgizmo-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
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
const ready = async () => {
  // (app-ready alone is not enough: the page shows itself after a cap even while the app's module is still starting, e.g. on a busy
  // graphics card, and the tools below would not be there yet; so the module's own hooks are waited for too)
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moBridgeTools && window.__moOpenFile)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
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
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  let s0 = null;
  for (let i = 0; i < 120; i++) { s0 = await sum(); if (s0 && s0.parts > 0 && s0.triangles > 0) break; await sleep(500); }
  await sleep(1500);
  await sleep(800);
  const read = () => evalJS(`(() => { const svg = document.getElementById('axis-gizmo-svg'); const r = svg.getBoundingClientRect(); const K = window.devicePixelRatio || 1; const out = { svg: [r.x, r.y, r.width, r.height], K, hs: [] }; for (const h of svg.querySelectorAll('.axg-handle')) { const m = /translate\\(([-0-9.]+),([-0-9.]+)\\)/.exec(h.getAttribute('transform') || ''); if (!m) continue; const c = h.querySelector('circle'); const R = parseFloat(c.getAttribute('r')); const half = Math.round(2 * R * K) % 2 ? 0.5 : 0; const fx = ((parseFloat(m[1]) * K) % 1 + 1) % 1, fy = ((parseFloat(m[2]) * K) % 1 + 1) % 1; out.hs.push({ id: h.id, onGrid: Math.abs(fx - half) < 1e-6 && Math.abs(fy - half) < 1e-6 }); } return JSON.stringify(out); })()`).then(JSON.parse);
  let bad = 0, n = 0, first = null;
  for (const v of ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso']) {
    await call('set_camera_view', { view: v }); await sleep(700);
    const r = await read(); if (!first) first = r;
    for (const h of r.hs) { n++; if (!h.onGrid) { bad++; console.log('off the grid in', v, JSON.stringify(h)); } }
  }
  check('the gizmo has three dots, one for each positive axis', first.hs.length === 3 && first.hs.map(h => h.id).sort().join() === 'axg-h-px,axg-h-py,axg-h-pz', first.hs);
  check('in every view every dot sits on the device pixel grid', bad === 0 && n === 21, { n, bad });
  check('the svg is drawn 1:1 (88 px for its 88 units)', first.svg[2] === 88 && first.svg[3] === 88, first.svg);
  check('and stands on whole pixels', Number.isInteger(first.svg[0]) && Number.isInteger(first.svg[1]), first.svg);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
