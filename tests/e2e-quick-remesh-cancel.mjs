// node tests/e2e-quick-remesh-cancel.mjs [model, default inbox/GearboxAssy.glb]
//
// Quick remesh (B) with every part selected, closed in the middle of its work (Esc / B again): the jobs that were still waiting for a
// worker must not run after that, and the page must stay responsive. Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9351, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-undomem-' + Date.now();
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
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);
  await call('select_all');
  const tris0 = (await sum()).triangles;
  // count what is sent to the workers, and how long the page is blocked
  await evalJS(`window.__sent = 0; window.__long = 0; const pm = Worker.prototype.postMessage; Worker.prototype.postMessage = function (m, t) { if (m && m.op === 'simplify') window.__sent++; return pm.call(this, m, t); };
    let last = performance.now(); setInterval(() => { const n = performance.now(); if (n - last > 700) window.__long++; last = n; }, 100); true`);
  await evalJS('window.__moQuickRemesh.toggle()');
  await sleep(300);
  await evalJS('window.__moQuickRemesh.level(7)');                    // 5 %: the heaviest, worked out for every part
  await sleep(250);
  const sentAtCancel = await evalJS('window.__sent');
  await evalJS('window.__moQuickRemesh.cancel()');
  await sleep(6000);
  const sentAfter = await evalJS('window.__sent');
  console.log('   jobs sent before the cancel:', sentAtCancel, '| sent in the six seconds after:', sentAfter - sentAtCancel, '| page stalls over 0.7 s:', await evalJS('window.__long'));
  check('the pill is closed', !(await evalJS("!!document.querySelector('.qr')")));
  check('the jobs that were waiting did not run after the cancel (at most the ones a worker already had, 4 + 1)', sentAfter - sentAtCancel <= 6, sentAfter - sentAtCancel);
  check('the model is as it was', (await sum()).triangles === tris0, [(await sum()).triangles, tris0]);
  check('the page was not blocked for long', (await evalJS('window.__long')) <= 1, await evalJS('window.__long'));
  // it works again afterwards
  await evalJS('window.__moQuickRemesh.toggle()');
  await sleep(300);
  await evalJS('window.__moQuickRemesh.level(3)');
  for (let k = 0; k < 120; k++) { await sleep(500); if (!(await evalJS("!!document.querySelector('.qr.is-busy')")) && (await evalJS('window.__moQuickRemesh.shown()')) === 3) break; }
  const tip = await evalJS("document.querySelector('.qr-tip')?.textContent || ''");
  const shownTris = +(/([\d,]+)\s*triangles/.exec(tip) || [0, '0'])[1].replace(/,/g, '');
  console.log('   the pill after the second go:', tip);
  check('and Quick remesh works again after it (the pill shows the lighter model)', shownTris > 0 && shownTris < tris0 * 0.6, [shownTris, tris0]);
  await evalJS('window.__moQuickRemesh.cancel()');
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
