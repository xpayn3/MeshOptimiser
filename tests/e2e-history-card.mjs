// node tests/e2e-history-card.mjs [model, default inbox/GearboxAssy.glb]
//
// The History card of the right sidebar, in the real app in headless Chrome (software WebGL2, no window shown):
//   - an opened model lists only "Opened"; each step adds a row, newest first, the last one lit;
//   - a click on an older row undoes down to it, the steps after it stay above, dimmed; a click on a dimmed row redoes up to it;
//   - the Undo and Redo buttons of the card, the Opened row, Arrow keys between rows;
//   - Clear history asks first, then forgets every step and leaves the model as it is.
// Needs the app served on APP_PORT (default 4242; use 4343 with its own server: python app/serve.py --no-browser --port 4343),
// Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9339, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let failed = 0;
const ok = (cond, what, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + what + (extra ? '  ' + extra : '')); if (!cond) failed++; };
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n')[0]);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const b = await fetch(${JSON.stringify(MODEL)}).then(r => r.blob()); const f = new File([b], ${JSON.stringify(MODEL.split('/').pop())}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById('file-input') || document.querySelector('input[type=file]'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);

  const rows = () => evalJS(`[...document.querySelectorAll('#history-list .hist-row')].map(r => ({ n: +r.dataset.n, name: r.querySelector('.hist-name').textContent, now: r.classList.contains('is-now'), undone: r.classList.contains('is-undone') }))`);
  const live = () => evalJS('state.parts.filter(p => !p.deleted).length');
  const depth = () => evalJS('[state.history.length, state.redo.length]');
  const run = (aid) => evalJS(`(() => { const a = _appFns._Actions.list.find(x => x.id === ${JSON.stringify(aid)}); a.run(); })()`);
  const pick = (i) => evalJS(`(() => { const ps = state.parts.filter(p => !p.deleted && p.mesh); state.selectedGroupIds = new Set(); state.selected = new Set([ps[${i}].partId]); })()`);
  const waitFor = async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await evalJS(expr)) return true; await sleep(100); } return false; };

  // ── the card is there, and opens
  ok(await evalJS("!!document.getElementById('history-section')"), 'the History section is in the right sidebar');
  await evalJS("(() => { const h = document.querySelector('#history-section .section-h'); if (h.classList.contains('collapsed')) h.click(); })()");
  await sleep(500);
  let r = await rows();
  ok(r.length === 1 && r[0].name === 'Opened' && r[0].now, 'a model with no steps lists only "Opened", lit', JSON.stringify(r));
  ok((await evalJS("document.getElementById('history-status').textContent")) === 'Nothing done yet.', 'and says nothing is done yet');
  ok(await evalJS("!!document.querySelector('#history-list .hist-base .hist-tag')"), 'a file that was just opened is as saved: its first row carries the Saved tag');
  ok(await evalJS("document.getElementById('history-undo').disabled && document.getElementById('history-redo').disabled && document.getElementById('history-clear').disabled"), 'Undo, Redo and Clear are off');

  // ── three steps
  const parts0 = await live();
  await pick(0); await run('duplicate'); await sleep(900);
  await pick(1); await run('hideSel'); await sleep(500);
  await run('recenter'); await sleep(900);
  const [h3] = await depth();
  await sleep(300);
  r = await rows();
  ok(h3 >= 3 && r.length === h3 + 1, 'each step is a row, and "Opened" is the last', JSON.stringify([h3, r.length]));
  ok(r[0].now && r.filter(x => x.now).length === 1, 'the newest row is lit');
  ok(r.slice(0, -1).every(x => x.name && x.name.length > 0), 'every step has a name', JSON.stringify(r.map(x => x.name)));
  ok(await evalJS("state.history.every(o => typeof o._t === 'number')"), 'every step carries the time it was done');
  const partsAfter = await live();
  ok(partsAfter > parts0, 'the duplicate added a part', partsAfter + ' vs ' + parts0);
  ok((await evalJS("document.getElementById('history-status').textContent")).startsWith(h3 + ' steps'), 'the status counts the steps');
  ok(await evalJS("!document.getElementById('history-undo').disabled && document.getElementById('history-redo').disabled"), 'Undo is on, Redo is off');

  // ── a click on an older row: back to after step 1
  await evalJS("document.querySelector('#history-list .hist-row[data-n=\"1\"]').click()");
  ok(await waitFor('state.history.length === 1'), 'a click on step 1 undoes down to it');
  await sleep(300);
  r = await rows();
  ok(r.filter(x => x.undone).length === h3 - 1 && r.find(x => x.n === 1).now, 'the later steps stay above, dimmed, and step 1 is lit', JSON.stringify(r.map(x => [x.n, x.now, x.undone])));
  ok((await depth())[1] === h3 - 1, 'they can all be redone');
  ok(await evalJS('document.getElementById("history-redo").disabled === false'), 'Redo is on');

  // ── a click on a dimmed row: forward to the end
  await evalJS(`document.querySelector('#history-list .hist-row[data-n="${h3}"]').click()`);
  ok(await waitFor(`state.history.length === ${h3}`), 'a click on the newest dimmed row redoes up to it');
  await sleep(300);
  ok((await live()) === partsAfter, 'the model is as it was before the jumps', (await live()) + ' vs ' + partsAfter);

  // ── Opened
  await evalJS("document.querySelector('#history-list .hist-base').click()");
  ok(await waitFor('state.history.length === 0'), 'a click on "Opened" undoes every step');
  await sleep(300);
  ok((await live()) === parts0, 'the parts are back to what the file had', (await live()) + ' vs ' + parts0);
  r = await rows();
  ok(r.length === h3 + 1 && r.filter(x => x.undone).length === h3 && r[r.length - 1].now, 'all steps are dimmed above, "Opened" is lit');

  // ── the card's own Undo / Redo
  await evalJS("document.getElementById('history-redo').click()");
  ok(await waitFor('state.history.length === 1'), 'the card Redo does one step forward');
  ok(await waitFor("!document.getElementById('history-undo').disabled"), 'and the card Undo comes on');
  await evalJS("document.getElementById('history-undo').click()");
  ok(await waitFor('state.history.length === 0'), 'the card Undo does one step back');

  // ── keys between rows
  await evalJS("document.querySelector('#history-list .hist-row').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  ok((await evalJS("document.activeElement && document.activeElement.dataset.n")) === String(h3 - 1), 'ArrowDown moves to the next row', await evalJS("document.activeElement && document.activeElement.dataset.n"));

  // ── a new step drops the dimmed ones, as everywhere
  await pick(0); await run('hideSel'); await sleep(500);
  ok((await depth())[1] === 0, 'a new step forgets what was undone');

  // ── Clear asks first
  await evalJS("document.getElementById('history-clear').click()");
  ok(await waitFor("!!document.querySelector('.cq-card')"), 'Clear history asks first');
  await evalJS("document.querySelector('.cq-card [data-act=cancel]').click()");
  await sleep(300);
  ok((await depth())[0] === 1, 'Cancel keeps the steps');
  const partsBeforeClear = await live();
  await evalJS("document.getElementById('history-clear').click()");
  await waitFor("!!document.querySelector('.cq-card')");
  ok(await evalJS("!!document.querySelector('.cq-card .cq-slide') && !document.querySelector('.cq-card [data-act=save]')"), 'it is the slide-to-confirm window');
  await evalJS("document.querySelector('.cq-card [data-act=cancel]').click()"); await sleep(400);
  ok((await depth())[0] === 1, 'a click on Cancel keeps them');
  await evalJS("document.getElementById('history-clear').click()");
  await waitFor("!!document.querySelector('.cq-card')");
  await evalJS("(() => { const t = document.querySelector('.cq-slide-thumb'); t.focus(); for (let i = 0; i < 3; i++) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); })()");
  ok(await waitFor('state.history.length === 0 && state.redo.length === 0'), 'OK forgets every step');
  await sleep(400);
  r = await rows();
  ok(r.length === 1 && r[0].name === 'Opened', 'and the card lists only "Opened" again');
  ok((await live()) === partsBeforeClear, 'the model is as it was');
  ok(await evalJS("document.getElementById('btn-undo').disabled"), 'the toolbar Undo is off');

  // ── the search finds it
  ok(await evalJS("!!_appFns._Actions.list.find(a => a.id === 'historyCard')"), 'the search lists "History"');
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { if (errors.length) console.log('page errors:', errors.slice(0, 5)); try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
