// node tests/e2e-recovery-copy.mjs [model, default inbox/GearboxAssy.glb]
//
// The recovery copy holds the page for no long task. A scene with unsaved changes gets a copy written to the browser once the page
// has been quiet; on a big scene (the Scania V8, 2.9 million points: run with inbox/v8.glb for the real check) the glTF writer used
// to hold the main thread 180 ms in one task. The writer now gives the page its turn between parts, remembers each attribute's
// range, assembles the file in one copy, and the steps around it get a task each. Here one part is deleted, the copy's interval is
// set to one minute, the page is watched for long tasks for 40 s, and the copy must have been written with no task over 50 ms.
// Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9358, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-recovcopy-' + Date.now();
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
const COPIES = "new Promise((res) => { const r = indexedDB.open('mo-recovery', 1); r.onupgradeneeded = () => r.result.createObjectStore('snaps', { keyPath: 'key' }); r.onsuccess = () => { const q = r.result.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => { res(q.result.map(s => ({ parts: s.parts, mb: +(s.size / 1e6).toFixed(1), why: s.why }))); r.result.close(); }; }; r.onerror = () => res([]); })";
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | ')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(encodeURI(MODEL))}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  if (await until("document.getElementById('import-modal').classList.contains('show')", 20)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  check('the model opened', await until("window.state && window.state.parts.filter(p => !p.deleted).length > 0", 240, 500));
  await sleep(8000);                                      // the warm-up after a load settles (its own slices are under 50 ms)
  const parts0 = await evalJS("window.state.parts.filter(p => !p.deleted).length");
  // an edit, and the copy due once the page is quiet (its interval set to one minute so that it comes within the watch)
  await evalJS("(async () => { const p = window.state.parts.find(p => !p.deleted); await window.__moBridgeTools.delete_parts({ ids: [p.partId] }); return true; })()");
  await evalJS("window._appFns._Prefs.set('autosaveMin', 1); true");
  // every long animation frame, with the scripts that ran in it (so a long frame of the warm-up after the edit is told from the copy's)
  const watch = await evalJS(`new Promise((res) => { const long = []; const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push({ ms: Math.round(e.duration), scripts: (e.scripts || []).map(s => (s.sourceFunctionName || s.invoker || '?') + ' ' + Math.round(s.duration)) }); }); po.observe({ type: 'long-animation-frame', buffered: false });
    const t0 = Date.now(); const poll = async () => { const n = await (${COPIES}); if (n.length || Date.now() - t0 > 40000) { await new Promise(r => setTimeout(r, 1500)); po.disconnect(); res({ copies: n, longFrames: long, waitedMs: Date.now() - t0 }); } else setTimeout(poll, 500); }; poll(); })`);
  console.log('after the edit:', JSON.stringify(watch));
  const ofCopy = watch.longFrames.filter(f => f.ms > 50 && f.scripts.some(s => /GLTFExporter|_saveSceneImpl|writeAsync|snap|_Autosave|buildExportRoot|processNodeAsync|Blob/.test(s)));
  check('a recovery copy was written', watch.copies.length === 1 && watch.copies[0].parts === parts0 - 1, watch);
  check('the copy held the page in no frame over 50 ms', ofCopy.length === 0, ofCopy);
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
