// node tests/e2e-materials-select.mjs [model, default inbox/GearboxAssy.glb]
//
// The Materials window: a click on empty space lets go of the picked materials, a drag on empty space draws a square and picks the
// materials it touches (Shift adds to what is picked), a press on a material still picks only it, and the list view has no sliders
// button on its rows. Needs the app served (python app/serve.py --no-browser --port 4343; APP_PORT overrides 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9485, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-matsel-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const mouse = (type, x, y, mods = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers: mods });
const click = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(150); };
const drag = async (x0, y0, x1, y1, mods = 0) => { await mouse('mouseMoved', x0, y0); await mouse('mousePressed', x0, y0, mods); for (let i = 1; i <= 8; i++) await mouse('mouseMoved', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8, mods); await mouse('mouseReleased', x1, y1, mods); await sleep(200); };
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moOpenFile)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click(); true");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); window.__moOpenFile(new File([b], ${JSON.stringify(path.basename(MODEL))})); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(5000);
  await evalJS("document.getElementById('tg-materials').click(); true");
  for (let i = 0; i < 40; i++) { await sleep(250); const t = await evalJS("document.getElementById('vp-materials-pop').getBoundingClientRect().top"); if (t < 700) { await sleep(400); break; } }      // (it slides up; slow in a headless Chrome)
  const sel = () => evalJS("document.querySelectorAll('#mat-list .mat-cell.selected, #mat-list .mat-row.selected').length");
  const rects = () => evalJS("[...document.querySelectorAll('#mat-list .mat-cell, #mat-list .mat-row')].map(c => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })");
  const host = await evalJS("(() => { const r = document.querySelector('#mat-list').closest('.pop-section').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, document.querySelector('#mat-list').closest('.pop-section').clientWidth]; })()");
  const cells = await rects();
  check('the Materials window lists materials', cells.length >= 3, cells.length);

  // a press on a material picks only it
  const c0 = cells[0];
  await click((c0[0] + c0[2]) / 2, (c0[1] + c0[3]) / 2);
  check('a click on a material picks it', (await sel()) === 1, await sel());
  const bar = await evalJS("(() => { const bs = [...document.querySelectorAll('#mat-inspector .mi-actions .btn')]; const ys = new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))); return { n: bs.length, rows: ys.size, text: bs.map(b => b.textContent.trim()).join(''), labelled: bs.every(b => b.title && b.getAttribute('aria-label')) }; })()");
  check('the buttons of one material are icons in one row, each with a name', bar.n === 6 && bar.rows === 1 && bar.text === '' && bar.labelled, bar);

  // a click on empty space lets go
  const bottom = Math.max(...cells.map(c => c[3]));
  const emptyY = Math.min(host[3] - 6, bottom + 14), emptyX = host[0] + 6;
  const emptyOk = await evalJS(`(() => { const e = document.elementFromPoint(${emptyX}, ${emptyY}); return !!e && !e.closest('.mat-cell, .mat-row'); })()`);
  check('there is empty space to press on', emptyOk, { emptyX, emptyY, host });
  await click(emptyX, emptyY);
  check('a click on empty space lets go of the pick', (await sel()) === 0, await sel());

  // a drag over several materials picks them
  await click((c0[0] + c0[2]) / 2, (c0[1] + c0[3]) / 2);
  await drag(emptyX, emptyY, Math.min(host[4] + host[0] - 8, cells[Math.min(5, cells.length - 1)][2] + 4), cells[0][1] - 2);
  const n = await sel();
  check('a drag on empty space picks the materials it touches', n >= 3, n);
  check('the square is gone when the button is let go', (await evalJS("document.querySelectorAll('.mat-marquee').length")) === 0);

  // a drag that starts on a material does not draw a square
  await click(emptyX, emptyY);
  await mouse('mouseMoved', (c0[0] + c0[2]) / 2, (c0[1] + c0[3]) / 2); await mouse('mousePressed', (c0[0] + c0[2]) / 2, (c0[1] + c0[3]) / 2);
  await mouse('mouseMoved', (c0[0] + c0[2]) / 2 + 30, (c0[1] + c0[3]) / 2 + 3);
  check('no square starts on a material', (await evalJS("document.querySelectorAll('.mat-marquee').length")) === 0);
  await mouse('mouseReleased', (c0[0] + c0[2]) / 2 + 30, (c0[1] + c0[3]) / 2 + 3);

  // the list view has no sliders button on its rows
  await evalJS("document.getElementById('mat-view-list').click(); true"); await sleep(600);
  check('list view: rows, and no sliders button on them', (await evalJS("document.querySelectorAll('#mat-list .mat-row').length")) > 3 && (await evalJS("document.querySelectorAll('#mat-list .mat-row-edit').length")) === 0);

  check('no script error', errors.length === 0, errors.slice(0, 3));
} catch (e) { fail++; console.log('FAIL', e && e.stack || e); }
console.log(pass + ' passed, ' + fail + ' failed');
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
