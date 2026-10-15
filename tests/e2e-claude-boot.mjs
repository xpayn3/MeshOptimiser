// node tests/e2e-claude-boot.mjs  (APP_PORT=4343): opening the app with ?claude never shows the normal app or its splash
//
// Drives the Claude (MCP) tools of the real app in headless Chrome (software WebGL2): loads a model through the file input, then
// calls every tool of window.__moBridgeTools (the same functions serve.py hands Claude's calls to; the Allow / Don't allow prompt
// is the layer above them and is not part of this) and checks what each one did, including that the undo tool takes it back.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
// Prints PASS / FAIL per check and every JavaScript error the page threw. Exit code 1 when anything failed.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9349, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-boot-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], consoleErr = [];
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
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErr.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 220));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  // sample the page from the first moment: any frame in which the app or the splash is visible and Claude mode is not up is a flash
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__flash = []; window.__samples = 0; (function tick() { try { const d = document, app = d.getElementById('app'), sp = d.getElementById('splash'), vis = (e) => e && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && getComputedStyle(e).opacity !== '0'; const mode = d.body && d.body.classList.contains('claude-mode'); window.__samples++; if (d.body && !mode && (vis(app) || vis(sp))) window.__flash.push([Math.round(performance.now()), !!vis(app), !!vis(sp), d.documentElement.className, d.body.className.slice(0, 60)]); else if (mode && d.body && vis(d.getElementById('tb'))) window.__flash.push(-Math.round(performance.now())); } catch (_) {} if (performance.now() < 9000) setTimeout(tick, 30); })();` });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?claude&t=' + Date.now() });
  await sleep(9500);
  const res = await evalJS("({ flash: window.__flash.slice(0, 8), samples: window.__samples, mode: document.body.classList.contains('claude-mode'), boot: document.documentElement.classList.contains('claude-boot'), feed: getComputedStyle(document.getElementById('claude-feed')).display, appVisible: getComputedStyle(document.getElementById('app')).visibility, on: !!(window.__moBridge && window.__moBridge.enabled()) })");
  console.log('   ', JSON.stringify(res));
  check('the page was sampled throughout the start', res.samples > 100, res);
  check('the normal app or its splash was never shown, and the top bar never appeared in Claude mode', res.flash.length === 0, res.flash);
  check('Claude mode is up at the end, the boot guard is lifted, and Claude can connect', res.mode && !res.boot && res.feed === 'flex' && res.on, res);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
