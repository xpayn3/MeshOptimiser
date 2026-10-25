// node tests/e2e-idle-writes.mjs
//
// An idle app changes nothing on the page. The Reduce card's count, the fps readouts and the status bar's whole-pixel fixer used to
// write every 200 to 500 ms whether or not anything had changed, and every write was a change of the page that the next pointer
// handler paid for with a layout. Here the Gearbox assembly is opened, the app is left alone for six seconds, and every mutation
// of the page and every measurement of the status bar is counted. Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9357, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-idlewrites-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
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
// every mutation of the page (where, what) and every measurement of a status-bar item, for `ms` milliseconds
const WATCH = (ms) => `(() => new Promise((res) => {
  const name = (t) => t.nodeType === 3 ? 'text in ' + name(t.parentNode) : (t.id ? '#' + t.id : (t.tagName || t.nodeName) + '.' + String(t.className || '').split(' ').slice(0, 2).join('.'));
  const muts = new Map(); const mo = new MutationObserver((rs) => { for (const r of rs) { const k = (r.type === 'attributes' ? r.attributeName + '=' : r.type + ' ') + name(r.target); muts.set(k, (muts.get(k) || 0) + 1); } });
  mo.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true });
  let rects = 0; const sb = document.getElementById('sb'); const g = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () { if (sb && sb.contains(this)) rects++; return g.call(this); };
  setTimeout(() => { mo.disconnect(); Element.prototype.getBoundingClientRect = g; const total = [...muts.values()].reduce((s, n) => s + n, 0); res({ total, statusBarMeasurements: rects, by: [...muts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => n + 'x ' + k) }); }, ${ms});
}))()`;

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(encodeURI(MODEL))}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  if (await until("document.getElementById('import-modal').classList.contains('show')", 20)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  check('the model opened', await until("window.state && window.state.parts.filter(p => !p.deleted).length > 0", 120, 500));
  await sleep(6000);                                      // the warm-up after a load (lines, acceleration structures, thumbnails) settles
  const idle = await evalJS(WATCH(6000));
  console.log('6 s idle:', JSON.stringify(idle));
  check('an idle app changes the page at most twice in six seconds', idle.total <= 2, idle);
  check('an idle app measures no status-bar item', idle.statusBarMeasurements === 0, idle);
  // with a part selected, the Reduce card's count has something to say; still nothing changes while idle
  await evalJS("window.__moBridgeTools.select_parts({ ids: [window.state.parts.find(p => !p.deleted).partId] })");
  await sleep(2500);
  check('the Reduce card\'s selection count follows the selection', await evalJS("document.getElementById('dec-sel-count')?.textContent.trim()") === '1', await evalJS("document.getElementById('dec-sel-count')?.textContent"));
  const selected = await evalJS(WATCH(4000));
  console.log('4 s idle with a selection:', JSON.stringify(selected));
  check('with a selection, an idle app still changes the page at most twice in four seconds', selected.total <= 2, selected);
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
