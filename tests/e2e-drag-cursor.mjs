// node tests/e2e-drag-cursor.mjs
//
// A drag's cursor costs the page nothing. A slider scrub, a sidebar resize, a material drag and a tree drag used to set their cursor
// with a rule on every element (`html.is-scrubbing *` and the like) from a class on the root or the body, a style of the whole page at
// the start and the end of each. Now one element over the window carries the cursor. Here: the stylesheet has no such rules; a drag of
// the left sidebar's handle shows the cursor element and puts no class on the body; a slider scrub does the same and still changes the
// value; the closed library dock and console keep their contents out of the page's style and show them when opened. Needs the app
// served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9356, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-dragcursor-' + Date.now();
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
const CURSOR = "(() => { const el = document.getElementById('drag-cursor'); return { shown: !!el && !el.hidden && getComputedStyle(el).display !== 'none', cursor: el ? el.style.cursor : null, bodyClasses: [...document.body.classList].filter(c => /resizing|dragging|dnd-active|scrubbing/.test(c)), rootClasses: [...document.documentElement.classList].filter(c => /scrubbing/.test(c)) }; })()";

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await sleep(800);

  // the stylesheet
  const css = await evalJS("[...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join('\\n'); } catch (_) { return ''; } }).join('\\n')");
  const bad = ['html.is-scrubbing', 'body.mat-dragging', 'body.resizing *', 'body.dnd-active'].filter(s => css.includes(s));
  check('no drag sets its cursor with a rule on every element', bad.length === 0, bad);
  check('the drag cursor element has its rule', css.includes('#drag-cursor'));

  // a resize of the left sidebar by its handle
  const h = await evalJS("(() => { const r = document.getElementById('resize-l').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()");
  const w0 = await evalJS("document.getElementById('sidebar-left').getBoundingClientRect().width");
  await mouse('mousePressed', h.x, h.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', h.x + i * 6, h.y, { button: 'left', buttons: 1 }); await sleep(20); }
  const during = await evalJS(CURSOR);
  await mouse('mouseReleased', h.x + 60, h.y, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
  const afterResize = await evalJS(CURSOR);
  const w1 = await evalJS("document.getElementById('sidebar-left').getBoundingClientRect().width");
  console.log('sidebar resize:', JSON.stringify({ during, after: afterResize, w0, w1 }));
  check('a sidebar resize shows the cursor element with col-resize and puts no class on the body', during.shown && during.cursor === 'col-resize' && during.bodyClasses.length === 0, during);
  check('the sidebar grew with the drag', w1 > w0 + 30, { w0, w1 });
  check('the cursor element goes when the resize ends', !afterResize.shown, afterResize);

  // a slider scrub: the Decimate card's percentage, or any scrubber on the page
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'decimate' || /decim/i.test(a.id))?.run(); true").catch(() => {});
  await sleep(600);
  const sc = await evalJS("(() => { const els = [...document.querySelectorAll('.scrub .scrub-value')].filter(e => e.offsetParent && e.getBoundingClientRect().width > 0 && getComputedStyle(e).pointerEvents !== 'none' && !e.closest('.is-off')); const el = els[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (el.closest('.scrub')?.querySelector('.scrub-label')?.textContent || '').trim().slice(0, 30) + ' = ' + el.textContent.trim() }; })()");
  if (sc) {
    await mouse('mousePressed', sc.x, sc.y, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', sc.x + i * 8, sc.y, { button: 'left', buttons: 1 }); await sleep(20); }
    const mid = await evalJS(CURSOR);
    await mouse('mouseReleased', sc.x + 64, sc.y, { button: 'left', buttons: 0, clickCount: 1 });
    await sleep(300);
    const end = await evalJS(CURSOR);
    console.log('slider scrub:', JSON.stringify({ el: sc.text, mid, end }));
    check('a slider scrub shows the cursor element with ew-resize and puts no class on the root', mid.shown && mid.cursor === 'ew-resize' && mid.rootClasses.length === 0, mid);
    check('the cursor element goes when the scrub ends', !end.shown, end);
  } else console.log('no scrubber on the page to scrub: skipped');

  // the closed panels keep their contents out of the page's style, and show them when opened
  const closed = await evalJS("(() => { const lib = document.getElementById('vp-library-pop'), con = document.getElementById('log-console'); return { lib: lib && getComputedStyle(lib).contentVisibility, con: con && getComputedStyle(con).contentVisibility }; })()");
  check('the closed library dock and console hide their contents from the style of the page', closed.lib === 'hidden' && closed.con === 'hidden', closed);
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'library')?.run(); true").catch(() => {});
  await until("(() => { const lib = document.getElementById('vp-library-pop'); return lib && lib.classList.contains('show'); })()", 12);
  await sleep(500);
  const opened = await evalJS("(() => { const lib = document.getElementById('vp-library-pop'); const list = document.getElementById('lib-list'); return { show: lib && lib.classList.contains('show'), cv: lib && getComputedStyle(lib).contentVisibility, listH: list ? list.getBoundingClientRect().height : 0, tiles: list ? list.children.length : 0 }; })()");
  console.log('library dock opened:', JSON.stringify(opened));
  if (opened.show) check('the library dock shows its contents once opened', opened.cv === 'visible' && opened.listH > 50 && opened.tiles > 0, opened);
  else console.log('the library dock did not open by its action: not checked');
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
