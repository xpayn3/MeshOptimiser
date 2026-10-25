// node tests/e2e-back-faces-sync.mjs
// "Highlight back faces" is one state: the icon in Filters & flags and the one in Fix normals follow each other, and the search command.
import { spawn } from 'child_process';
import path from 'path';
const CH = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9483, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-bfsync-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
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
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moNormals)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  const st = () => evalJS("({ ff: document.getElementById('ff-hl-back').classList.contains('active'), nm: document.getElementById('nm-hl').checked, on: window.__moNormals.isHighlighting() })");
  const same = (s, v) => s.ff === v && s.nm === v && s.on === v;
  check('both start off', same(await st(), false), await st());
  await evalJS("document.getElementById('ff-hl-back').click()"); await sleep(300);
  check('the Filters & flags switch turns it on, the Fix normals one follows', same(await st(), true), await st());
  await evalJS("document.getElementById('nm-hl').click()"); await sleep(300);
  check('the Fix normals switch turns it off, the other follows', same(await st(), false), await st());
  await evalJS("window.__moNormals.highlight()"); await sleep(300);
  check('the command turns both on', same(await st(), true), await st());
  check('no uncaught page errors', errors.filter(e => !/ResizeObserver/.test(e)).length === 0, errors.slice(0, 4));
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`
${pass} passed, ${fail} failed`);
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
