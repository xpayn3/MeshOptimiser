// node tests/e2e-load-settle.mjs [model]
//
// A model is shown only when it turns smoothly (_settleView in app.js). Opens a model and checks that the loader said "Preparing the
// view", that when it went away the picking trees were built, and that the frames drawn in the first two seconds after it are even
// (the longest no more than three times the middle one, or 150 ms). Needs the app served on APP_PORT (default 4242), Chrome and
// Node 22+. GPU=1 uses the real graphics card (WebGPU); without it, Chrome's software WebGL2.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9367, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-settle-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name, extra === undefined ? '' : JSON.stringify(extra)); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra, null, 1)); } };
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

// Watches the loader: every message it shows, and the moment it goes away (with what was still going on then).
const WATCH = `(() => {
  const W = window.__settle = { msgs: [], hiddenAt: 0, bvhAtHide: null };
  let shown = false;
  const look = () => {
    const l = document.getElementById('loader'), m = document.getElementById('loader-msg')?.textContent || '';
    const on = !!l && l.classList.contains('show');
    if (on && W.msgs[W.msgs.length - 1] !== m) W.msgs.push(m);
    if (shown && !on && window.state && window.state.parts.some(p => !p.deleted) && !W.hiddenAt) { W.hiddenAt = performance.now(); W.bvhAtHide = !!window.state._bvhBuilding; }
    shown = on;
  };
  new MutationObserver(look).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true, characterData: true });
})()`;

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await sleep(500);
  await evalJS(WATCH);
  const t0 = Date.now();
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(encodeURI(MODEL))}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  if (await until("document.getElementById('import-modal').classList.contains('show')", 20)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  check('the model opened and the loader went away', await until('window.__settle.hiddenAt > 0', 240, 250));
  console.log('  loaded and shown in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  const w = await evalJS('window.__settle');
  check('the loader said it was preparing the view', w.msgs.includes('Preparing the view'), w.msgs);
  check('the picking trees were built before it went away', w.bvhAtHide === false, w);
  // The first two seconds after it, the view drawn on every frame, as while a person turns it.
  const f = await evalJS(`new Promise(res => {
    const dts = []; let prev = performance.now(); const end = prev + 2000;
    const step = () => {
      const now = performance.now(); dts.push(now - prev); prev = now;
      window.state.needsRender = true;
      if (now < end) requestAnimationFrame(step); else res(dts.slice(1));
    };
    requestAnimationFrame(step);
  })`);
  const sorted = [...f].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)], max = sorted[sorted.length - 1];
  check('the frames after it are even', max <= Math.max(150, med * 3), { frames: f.length, medianMs: +med.toFixed(1), maxMs: +max.toFixed(1) });
  check('no script errors', errors.length === 0, errors);
} catch (e) { fail++; console.log('FAIL', e.message); }
finally { try { ws?.close(); } catch (_) {} chrome.kill(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
