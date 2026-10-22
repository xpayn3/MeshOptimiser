// node tests/e2e-undo-while-settling.mjs [model, default inbox/GearboxAssy.glb]
//
// Undo works while a model that has just opened is still "Preparing the view" (_settleView in app.js). That last step of a load only
// draws and builds behind the loader; nothing is being made that an undo could cross, and other edits already go through. It used to
// count as a step still running: Ctrl+Z said "Wait until the running step has finished" and Claude's undo refused, for up to 12 s on
// a slow graphics card (all of it in headless Chrome, whose software WebGL2 is slow, which is why this test can catch it).
// Duplicates a part while the view is being prepared, then takes it back with Ctrl+Z, and again with Claude's undo; redo too.
// Needs the app served on APP_PORT (default 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9374, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-undosettle-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => ev(`(async () => { try { const r = await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.text || '').join('') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
const parts = () => ev('window.state.parts.filter(p => !p.deleted).length');
// the loader is still on its last step, "Preparing the view"
const settling = () => ev("[...document.querySelectorAll('*')].some(e => !e.childElementCount && e.textContent.trim() === 'Preparing the view' && e.getClientRects().length)");
const key = async (k, mods) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, modifiers: mods, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }); };
try {
  let t;
  for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page'); } catch (_) {} if (!t) await sleep(250); }
  if (!t) throw new Error('Chrome did not start');
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | ')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await ev("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await ev("document.getElementById('welcome-close')?.click()");
  await ev(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const dt = new DataTransfer(); dt.items.add(new File([b], ${JSON.stringify(path.basename(MODEL))})); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  let caught = false;
  for (let i = 0; i < 600 && !caught; i++) { caught = (await parts()) > 0 && await settling(); if (!caught) await sleep(50); }
  check('the model is in and the view is being prepared', caught);
  if (caught) {
    const n0 = await parts(), id0 = await ev('window.state.parts.find(p => !p.deleted && p.mesh).partId');
    const d1 = await call('duplicate_parts', { ids: [id0] }); await sleep(300);
    check('a part is duplicated while the view is prepared', d1.ok && (await parts()) === n0 + 1, d1);
    await key('z', 2); await sleep(600);                                                       // Ctrl+Z
    const still1 = await settling();
    check('Ctrl+Z takes it back while the view is prepared', (await parts()) === n0, { parts: await parts(), n0, still: still1 });
    await key('y', 2); await sleep(600);                                                       // Ctrl+Y
    check('Ctrl+Y puts it back', (await parts()) === n0 + 1, { parts: await parts() });
    const u = await call('undo'); await sleep(300);
    check("Claude's undo takes it back too", u.ok && (await parts()) === n0, u);
    // (the view is ready sooner since three.js r184 (compileAsync no longer holds the drawing back): what counts is that Ctrl+Z came
    // while it was still being prepared)
    check('(Ctrl+Z came while the loader still said "Preparing the view", so the case was really tested)', still1);
  }
  check('no uncaught errors in the page', errors.length === 0, errors);
} catch (e) { fail++; console.log('FAIL (threw)', e.message); }
finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  try { ws && ws.close(); } catch (_) {}
  chrome.kill(); process.exit(fail ? 1 : 0);
}
