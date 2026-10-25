// node tests/e2e-alt-keys.mjs
//
// A held modifier key and a pointer drag cost the page nothing but the camera. A held Alt repeats about thirty times a second;
// each repeat used to run nine selectors over the whole document (the shortcut listeners asking whether a dialog is open), and every
// pointer move rewrote the body's class (an absent class taken off), which woke the watcher that measures every toolbar over the
// view. Here 31 Alt key events and 40 moves of a middle-button drag are sent, and the document-wide dialog queries and the body's
// class rewrites are counted; then an Alt + middle drag is timed. Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9355, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-altkeys-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });
const ALT = 1;
const alt = (type, autoRepeat = false) => send('Input.dispatchKeyEvent', { type, key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: ALT, autoRepeat });
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
// counts: document-wide queries that look for an open dialog, and rewrites of the body's class attribute
const COUNT_ON = `(() => {
  const C = window.__cnt = { dialogQueries: 0, bodyClassWrites: 0 };
  const qs = Document.prototype.querySelector; Document.prototype.querySelector = function (s) { if (/modal-bg|dlg-bg/.test(String(s))) C.dialogQueries++; return qs.call(this, s); };
  C.mo = new MutationObserver((rs) => { C.bodyClassWrites += rs.length; }); C.mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return true; })()`;
const COUNT_READ = `(() => { const C = window.__cnt; return { dialogQueries: C.dialogQueries, bodyClassWrites: C.bodyClassWrites }; })()`;
const COUNT_RESET = `(() => { const C = window.__cnt; C.dialogQueries = 0; C.bodyClassWrites = 0; return true; })()`;

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await sleep(1000);
  const c = await evalJS("(() => { const r = window._appFns.renderer.domElement.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()");
  await evalJS(COUNT_ON);

  // a click on the view first (the ring is hidden only after a mouse press), then 31 Alt key events, as a hand holding the key sends them
  await mouse('mousePressed', c.x, c.y, { button: 'left', buttons: 1, clickCount: 1 }); await mouse('mouseReleased', c.x, c.y, { button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
  await evalJS(COUNT_RESET);
  await alt('rawKeyDown'); for (let i = 0; i < 30; i++) { await sleep(33); await alt('rawKeyDown', true); } await alt('keyUp');
  await sleep(300);
  const keys = await evalJS(COUNT_READ);
  console.log('31 Alt key events:', JSON.stringify(keys));
  check('a held Alt runs no document-wide dialog query', keys.dialogQueries === 0, keys);
  // the focus ring is hidden on the focused element, never with a class on the root (a class there, under a rule for every
  // descendant, had the browser look at the whole page again on each modifier press and on the mouse press after it)
  check('a modifier press puts no class on the root element', await evalJS("!document.documentElement.classList.contains('no-mod-ring')"));
  await evalJS("(() => { const b = document.querySelector('#tb-fit, #btn-fit, button'); b.focus(); return b.id || b.className; })()");
  await mouse('mousePressed', c.x, c.y, { button: 'middle', buttons: 4, clickCount: 1 }); await mouse('mouseReleased', c.x, c.y, { button: 'middle', buttons: 0, clickCount: 1 }); await sleep(100);
  await evalJS("(() => { const b = document.querySelector('#tb-fit, #btn-fit, button'); b.focus(); return true; })()");
  await alt('rawKeyDown'); await sleep(100); await alt('keyUp'); await sleep(100);
  const ring = await evalJS("(() => { const a = document.activeElement; return { focused: a && (a.id || a.tagName), onFocused: !!(a && a.classList.contains('no-mod-ring')), onRoot: document.documentElement.classList.contains('no-mod-ring') }; })()");
  console.log('after a click, a focused button and an Alt press:', JSON.stringify(ring));
  check('with a button focused, the ring class goes on that button only', ring.onFocused && !ring.onRoot, ring);

  // a middle-button drag of 40 moves, no Alt
  await evalJS(COUNT_RESET);
  await mouse('mousePressed', c.x, c.y, { button: 'middle', buttons: 4, clickCount: 1 });
  for (let i = 1; i <= 40; i++) { await mouse('mouseMoved', c.x + i * 3, c.y + i * 2, { button: 'middle', buttons: 4 }); await sleep(16); }
  await mouse('mouseReleased', c.x + 120, c.y + 80, { button: 'middle', buttons: 0, clickCount: 1 });
  await sleep(300);
  const moves = await evalJS(COUNT_READ);
  console.log('40 moves of a middle drag:', JSON.stringify(moves));
  check('a pointer drag rewrites the body\'s class on no move', moves.bodyClassWrites === 0, moves);

  // a middle drag, then an Alt + middle drag with the key repeating: the camera answers the first move at once, and the frames of
  // the Alt drag keep up as well as the plain drag's do (on swiftshader every frame is slow, so the two are compared, not timed)
  const timed = async (withAlt) => {
    await evalJS(`(() => { const F = window._appFns, R = window.__rec = { frames: [], changes: [], moves: [], down: 0 };
      const loop = () => { if (!R.stop) { R.frames.push(performance.now()); requestAnimationFrame(loop); } }; requestAnimationFrame(loop);
      R.onChange = () => R.changes.push(performance.now()); F.controls.addEventListener('change', R.onChange);
      R.onMove = (e) => { if (e.buttons) R.moves.push(performance.now()); }; window.addEventListener('pointermove', R.onMove, true);
      R.onDown = () => { R.down = performance.now(); }; window.addEventListener('pointerdown', R.onDown, true); return true; })()`);
    const mods = withAlt ? ALT : 0;
    if (withAlt) { await alt('rawKeyDown'); await sleep(250); }
    await mouse('mousePressed', c.x, c.y, { button: 'middle', buttons: 4, clickCount: 1, modifiers: mods });
    for (let i = 1; i <= 40; i++) { await mouse('mouseMoved', c.x + i * 3, c.y + i * 3, { button: 'middle', buttons: 4, modifiers: mods }); if (withAlt && i % 2 === 0) await alt('rawKeyDown', true); await sleep(16); }
    await mouse('mouseReleased', c.x + 120, c.y + 120, { button: 'middle', buttons: 0, clickCount: 1, modifiers: mods });
    if (withAlt) { await sleep(100); await alt('keyUp'); }
    await sleep(500);
    return evalJS(`(() => { const R = window.__rec, F = window._appFns; R.stop = true; F.controls.removeEventListener('change', R.onChange); window.removeEventListener('pointermove', R.onMove, true); window.removeEventListener('pointerdown', R.onDown, true);
      let worst = 0, over = 0; for (let i = 1; i < R.frames.length; i++) { const g = R.frames[i] - R.frames[i - 1]; if (R.frames[i] > R.down && R.frames[i] < R.down + 900) { worst = Math.max(worst, g); if (g > 50) over++; } }
      return { moves: R.moves.length, changes: R.changes.length, firstAnswerMs: R.moves.length && R.changes.length ? +(R.changes[0] - R.moves[0]).toFixed(1) : null, worstFrameGapMs: +worst.toFixed(0), gapsOver50: over }; })()`);
  };
  const plain = await timed(false); await sleep(400);
  const r = await timed(true);
  console.log('middle drag:', JSON.stringify(plain)); console.log('Alt + middle drag:', JSON.stringify(r));
  check('the camera answers the first move of the Alt drag at once', r.changes >= 30 && r.firstAnswerMs !== null && r.firstAnswerMs < 5, r);
  // (on swiftshader every frame is slow and the counts wander by a few either way; the real check is on the graphics card, GPU=1)
  check('the Alt drag drops no more frames than the plain drag (three allowed)', r.gapsOver50 <= plain.gapsOver50 + 3, { plain, alt: r });
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
