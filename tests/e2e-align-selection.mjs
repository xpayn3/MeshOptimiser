// node tests/e2e-align-selection.mjs
//
// Align to floor moves the whole model when nothing is selected, and only the selection when there is one. Two cubes (100 mm) are put
// in the air apart from each other. With one selected, Align to floor stands that one on the floor over 0,0 and leaves the other where
// it was; Undo puts it back. With nothing selected, the two together are stood on the floor, centred over 0,0, as before. The card's
// heading says which it will move.
// Needs the app served on APP_PORT (default 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9379, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-alignsel-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
try {
  let t;
  for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page'); } catch (_) {} if (!t) await sleep(250); }
  if (!t) throw new Error('Chrome did not start');
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | ')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await ev("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await ev("document.getElementById('welcome-start-empty')?.click()"); await sleep(300);
  await ev("document.getElementById('welcome-close')?.click()"); await sleep(300);
  await ev("Promise.resolve(window._addPrimitive('cube')).then(() => 1)"); await sleep(600);
  await ev("Promise.resolve(window._addPrimitive('cube')).then(() => 1)"); await sleep(600);
  // A at (1000, 0, 500), B at (-600, 400, 900): both in the air, apart (Z is up)
  await ev(`(() => { const L = state.parts.filter(p => !p.deleted && p.mesh); window.__A = L[0].partId; window.__B = L[1].partId;
    L[0].mesh.position.set(1000, 0, 500); L[1].mesh.position.set(-600, 400, 900);
    for (const p of L) { p.mesh.updateMatrixWorld(true); p._exactWorld = p.mesh.matrixWorld.clone(); window._appFns._refreshPartBBox?.(p); }
    window._appFns._Actions.list.find(a => a.id === 'selClear').run(); return 1; })()`);
  await sleep(300);
  await ev("window._appFns._Actions.list.find(a => a.id === 'alignFloor').run(), 1"); await sleep(500);
  const box = (pid) => `(() => { const p = state.parts.find(q => q.partId === ${pid}); p.mesh.updateMatrixWorld(true); const b = new window._appFns.THREE.Box3().setFromObject(p.mesh); return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]; })()`;
  const boxes = async () => ({ A: await ev(box('window.__A')), B: await ev(box('window.__B')) });
  const what = () => ev("document.querySelector('.section-cmd[data-cmd=\"align\"] .align-what')?.textContent || ''");
  const click = async () => { await ev("document.getElementById('btn-align-floor').click(), 1"); await sleep(500); };
  const pick = async (pid) => { await ev(`(() => { window._appFns._Actions.list.find(a => a.id === 'selClear').run();
    const p = state.parts.find(q => q.partId === ${pid}); const row = [...document.querySelectorAll('#tree .tree-node')].find(r => r.dataset.partId == p.partId || r.dataset.pid == p.partId) || [...document.querySelectorAll('#tree .tree-node')].filter(r => r.textContent.trim().startsWith(p.name))[0];
    row.dispatchEvent(new MouseEvent('click', { bubbles: true })); return [...state.selected]; })()`); await sleep(400); };

  check('with nothing selected the card says it moves the whole model', (await what()) === 'Whole model', await what());

  // ── one part selected: only that one moves ──
  await pick('window.__B');
  const sel = await ev('[...state.selected]');
  check('one cube is selected', sel.length === 1 && sel[0] === await ev('window.__B'), sel);
  check('with a part selected the card says it moves the selection', (await what()) === 'Selection (1 part)', await what());
  const b0 = await boxes();
  await click();
  const b1 = await boxes();
  check('the selected cube stands on the floor, centred over 0,0', near(b1.B[2], 0) && near(b1.B[0] + b1.B[3], 0) && near(b1.B[1] + b1.B[4], 0), b1.B);
  check('the other cube stays where it was', b1.A.every((v, i) => near(v, b0.A[i])), { before: b0.A, after: b1.A });
  await ev("window._appFns._Actions.list.find(a => a.id === 'undo').run(), 1"); await sleep(500);
  const b2 = await boxes();
  check('Undo puts the selected cube back', b2.B.every((v, i) => near(v, b0.B[i])), { before: b0.B, after: b2.B });

  // ── nothing selected: the whole model, as before ──
  await ev("window._appFns._Actions.list.find(a => a.id === 'selClear').run(), 1"); await sleep(400);
  check('after clearing the selection the card says whole model again', (await what()) === 'Whole model', await what());
  await click();
  const b3 = await boxes();
  const lo = Math.min(b3.A[2], b3.B[2]), cx = (Math.min(b3.A[0], b3.B[0]) + Math.max(b3.A[3], b3.B[3])) / 2, cy = (Math.min(b3.A[1], b3.B[1]) + Math.max(b3.A[4], b3.B[4])) / 2;
  check('the whole model stands on the floor, centred over 0,0', near(lo, 0) && near(cx, 0) && near(cy, 0), { lo, cx, cy });
  const gap0 = [b0.A[0] - b0.B[0], b0.A[1] - b0.B[1], b0.A[2] - b0.B[2]], gap3 = [b3.A[0] - b3.B[0], b3.A[1] - b3.B[1], b3.A[2] - b3.B[2]];
  check('the two cubes keep their places relative to each other', gap0.every((v, i) => near(v, gap3[i])), { gap0, gap3 });

  check('no script errors', errors.length === 0, errors);
} catch (e) { fail++; console.log('FAIL', e.message); }
finally { try { ws?.close(); } catch (_) {} chrome.kill(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
