// node tests/e2e-capslock.mjs
// Caps Lock does not change the shortcuts: with it on, S still isolates the selection (it used to arrive as "S" and be taken for
// Shift+S), S again shows everything, and Shift+S with Caps Lock on still reveals in the tree instead of isolating.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9361, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-caps-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ready = async () => { for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); } await sleep(1500); };
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(500); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } };
  await send('Page.enable'); await send('Runtime.enable');
};
// two boxes, so that isolating one hides the other
const obj = ['o a', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'f 1 2 3', 'f 1 3 4', 'o b', 'v 3 0 0', 'v 4 0 0', 'v 4 1 0', 'v 3 1 0', 'f 5 6 7', 'f 5 7 8'].join(String.fromCharCode(10));
const press = (key, shift) => evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: 'KeyS', shiftKey: ${shift}, modifierCapsLock: true, bubbles: true, cancelable: true })); return true; })()`);
const isolated = () => evalJS('!!window.state._isolated');
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(() => { const f = new File([${JSON.stringify(obj)}], 'two.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
  await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  for (let i = 0; i < 60; i++) { if (await evalJS("window.state && window.state.parts.length >= 2").catch(() => false)) break; await sleep(500); }
  await sleep(1000);
  await evalJS("(() => { window.state.selected = new Set([window.state.parts.find(p => p.name === 'a').partId]); document.activeElement && document.activeElement.blur && document.activeElement.blur(); return true; })()");
  const before = await isolated();
  await press('S', false); await sleep(600);          // Caps Lock on, no Shift: the browser reports "S"
  check('S with Caps Lock on isolates the selection', !before && await isolated(), { before });
  await press('S', false); await sleep(600);
  check('S with Caps Lock on, again, shows everything', !(await isolated()));
  await press('s', true); await sleep(600);           // Caps Lock on and Shift: the browser reports "s"
  check('Shift+S with Caps Lock on does not isolate (it reveals in the tree)', !(await isolated()));
} catch (e) { console.log('HARNESS ERROR:', e.message); fail++; }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(fail ? fail + ' failed, ' + pass + ' passed' : 'ok: ' + pass + ' passed');
process.exit(fail ? 1 : 0);
