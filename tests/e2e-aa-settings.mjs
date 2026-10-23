// node tests/e2e-aa-settings.mjs
//
// Settings › Performance › Edges and resolution. Here: the view is drawn with multisampling (4 samples) by default and Smooth edges is
// on; switched off, it is remembered and a Reload row shows (the renderer is made with it), switched back the row goes; after a reload
// with it off the view is drawn without (0 samples) and the switch says so; Resolution is the Quality of the view's settings: Full there
// lights Full here, Low here sets Low there and the pixel ratio drops to 0.6. SHOT=folder saves a picture of the group. Needs the app
// served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9362, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-aaset-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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

const boot = async () => {
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1200);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await sleep(300);
};
const ST = `(() => { const r = window.__moRenderer || null; const seg = [...document.querySelectorAll('#set-res button')];
  return { msaa: document.getElementById('set-msaa')?.checked, reload: (() => { const r = document.getElementById('set-msaa-reload-row'); return !!r && getComputedStyle(r).display !== 'none'; })(), res: seg.filter(b => b.classList.contains('active')).map(b => b.dataset.v).join(),
    quality: document.getElementById('perf-mode')?.value, saved: localStorage.getItem('stepopt-gfx-msaa') }; })()`;

try {
  await attach();
  await evalJS("localStorage.removeItem('stepopt-gfx-msaa'); true").catch(() => {});
  await boot();
  const samples0 = await evalJS("(window.__moSamples ? window.__moSamples() : null)");
  await evalJS('window.__openSettings("perf")'); await sleep(400);
  const s0 = await evalJS(ST);
  check('by default: Smooth edges on, no Reload row, Resolution shows the Quality in use', s0.msaa === true && !s0.reload && s0.res === s0.quality && !!s0.quality, s0);
  check('and the view is drawn with 4 samples', samples0 === 4, samples0);
  if (process.env.SHOT) { const c = await evalJS("(() => { document.getElementById('set-msaa').closest('.set-row').scrollIntoView({ block: 'center' }); const t = document.getElementById('set-msaa').closest('.set-row').previousElementSibling || document.getElementById('set-msaa').closest('.set-row'); const last = document.getElementById('set-res').closest('.set-row'); const a = t.getBoundingClientRect(), b = last.getBoundingClientRect(); return { x: a.left - 12, y: a.top - 12, width: Math.max(a.width, b.right - a.left) + 24, height: b.bottom - a.top + 24, scale: 1 }; })()"); const pic = await send('Page.captureScreenshot', { format: 'png', clip: c }); fs.writeFileSync(path.join(process.env.SHOT, 'aa-settings.png'), Buffer.from(pic.data, 'base64')); }

  await evalJS("document.getElementById('set-msaa').click(); true"); await sleep(200);
  const s1 = await evalJS(ST);
  check('switched off: remembered, and the Reload row shows', s1.msaa === false && s1.saved === '0' && s1.reload, s1);
  await evalJS("document.getElementById('set-msaa').click(); true"); await sleep(200);
  const s2 = await evalJS(ST);
  check('switched back on: forgotten, the row goes', s2.msaa === true && s2.saved === null && !s2.reload, s2);

  // Resolution follows the view's Quality, both ways
  await evalJS("(() => { const s = document.getElementById('perf-mode'); s.value = 'high'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()"); await sleep(200);
  check("Full in the view's settings lights Full here", (await evalJS(ST)).res === 'high');
  await evalJS("document.querySelector('#set-res button[data-v=\"low\"]').click(); true"); await sleep(400);
  const low = await evalJS(`({ q: document.getElementById('perf-mode').value, st: window.state?.perfMode, dpr: window.__moRendererDpr ? window.__moRendererDpr() : null, res: ${ST}.res })`);
  check("Low here sets Low in the view's settings, and the picture drops to 0.6 of the screen's pixels", low.q === 'low' && low.st === 'low' && low.res === 'low' && (low.dpr === null || Math.abs(low.dpr - 0.6) < 0.01), low);
  await evalJS("document.querySelector('#set-res button[data-v=\"auto\"]').click(); true"); await sleep(200);

  // off, then a reload: drawn without
  await evalJS("document.getElementById('set-msaa').click(); true"); await sleep(200);
  await evalJS("window.onbeforeunload = null; true");
  await boot();
  const samples1 = await evalJS("(window.__moSamples ? window.__moSamples() : null)");
  await evalJS('window.__openSettings("perf")'); await sleep(400);
  const s3 = await evalJS(ST);
  check('after a reload with it off: the view is drawn without multisampling, the switch is off, no Reload row', samples1 === 0 && s3.msaa === false && !s3.reload, { samples1, s3 });
  await evalJS("localStorage.removeItem('stepopt-gfx-msaa'); true");
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
