// node tests/e2e-right-sidebar.mjs [model.glb, default inbox/GearboxAssy.glb]
//
// The right sidebar: the Transform block sits in it (always shown, reads the selected part, a typed number is written back, a long number
// is not cut off); the clean-up and tool buttons are behind a chevron under the first row of the selection bar (six buttons folded,
// eighteen open, and it folds again); the Heavy parts card is there (its list is as long as the count) and the heavy parts are also a warning tag in the Properties card (the
// scene says how many, a click selects them, a part says heavy). Needs the app served on http://localhost:4242, or APP_PORT.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9393, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-rsidebar-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
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
const ready = async () => {
  // (app-ready alone is not enough: the page shows itself after a cap even while the app's module is still starting, e.g. on a busy
  // graphics card, and the tools below would not be there yet; so the module's own hooks are waited for too)
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moBridgeTools && window.__moOpenFile)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
try {
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
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  let s0 = null;
  for (let i = 0; i < 120; i++) { s0 = await sum(); if (s0 && s0.parts > 0 && s0.triangles > 0) break; await sleep(500); }
  await sleep(1500);
  check('the model is open', s0 && s0.parts > 5, s0);
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 1 });
  const pid = lp.j.parts[0].id;
  const esc = async () => { await evalJS("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))"); await sleep(600); };

  // Transform in the right sidebar
  await call('select_parts', { ids: [pid] }); await sleep(1500);
  check('the Transform block is in the right sidebar and shown', await evalJS("document.getElementById('transform-panel').parentElement.id === 'sidebar-right' && document.getElementById('transform-panel').classList.contains('show')"));
  check('the toolbar of the left sidebar has no Transform button any more', await evalJS("!document.getElementById('tg-transform')"));
  check('it reads the selected part', (await evalJS("document.getElementById('tform-sx').value")) !== '');
  await evalJS("(() => { const e = document.getElementById('tform-px'); e.focus(); e.value = '123.4'; e.dispatchEvent(new Event('change', { bubbles: true })); e.blur(); })()"); await sleep(800);
  check('a typed number is written to the part', Math.abs(parseFloat(await evalJS("document.getElementById('tform-px').value")) - 123.4) < 0.01);
  const cut = await evalJS("['px','py','pz','sx','sy','sz'].filter(k => { const e = document.getElementById('tform-' + k); return e.scrollWidth > e.clientWidth + 1; })");
  check('no number is cut off in its field', cut.length === 0, cut);

  // the tool buttons behind the chevron
  const vis = () => evalJS("JSON.stringify({ expanded: document.getElementById('sel-more-toggle').getAttribute('aria-expanded'), shown: [...document.querySelectorAll('#sel-bar .sel-bar-grid .btn')].filter(b => b.offsetParent).length })").then(JSON.parse);
  await evalJS("try { localStorage.removeItem('stepopt-sel-more'); } catch (_) {} true");
  const v0 = await vis();
  if (v0.expanded === 'true') { await evalJS("document.getElementById('sel-more-toggle').click()"); await sleep(400); }
  const f0 = await vis();
  check('folded: the six selection buttons show', f0.shown === 6 && f0.expanded === 'false', f0);
  await evalJS("document.getElementById('sel-more-toggle').click()"); await sleep(1000);      // (the rows open with an animation of about half a second)
  const f1 = await vis();
  check('the chevron opens the other twelve', f1.shown === 18 && f1.expanded === 'true', f1);
  check('the Decimate button among them still works', await evalJS("(() => { const b = document.querySelector('#sel-bar [data-act=\"decimate\"]'); return !!b && !!b.offsetParent; })()"));
  await evalJS("document.getElementById('sel-more-toggle').click()"); await sleep(1000);
  const f2 = await vis();
  check('and folds them again', f2.shown === 6 && f2.expanded === 'false', f2);

  // the heavy parts, as a warning tag
  check('the Heavy parts card is in the sidebar', await evalJS("!!document.getElementById('offenders-list') && [...document.querySelectorAll('#sidebar-right .section-h span')].some(e => e.textContent === 'Heavy parts')"));
  const nRows = await evalJS("document.querySelectorAll('#offenders-list .off-row').length"), nBadge = await evalJS("parseInt(document.getElementById('heavy-count').textContent, 10)");
  check('its list has a row for every heavy part, and its count says so', nRows > 0 && nRows === nBadge, { nRows, nBadge });
  await esc(); await call('select_all'); await sleep(400); await esc();
  const tag = () => evalJS("(() => { const t = document.querySelector('#prop-body [data-prop-act=\"select-heavy\"]'); return t ? t.textContent.trim() : null; })()");
  const t0 = await tag();
  check('with nothing selected the card says how many parts are heavy', !!t0 && /^\d+ heavy$/.test(t0), t0);
  check('and it is the same number as the card of the list', parseInt(t0, 10) === nRows, { t0, nRows });
  await evalJS("document.querySelector('#prop-body [data-prop-act=\"select-heavy\"]').click()"); await sleep(800);
  check('a click on it selects them', (await evalJS('window.state.selected.size')) === parseInt(t0, 10), t0);
  const many = await evalJS("[...document.querySelectorAll('#prop-body .prop-tags .tree-badge')].map(e => e.textContent.trim()).join('|')");
  check('several selected: the card counts the heavy ones', /\d+ heavy/.test(many), many);
  await call('select_parts', { ids: [pid] }); await sleep(800);
  const one = await evalJS("[...document.querySelectorAll('#prop-body .prop-tags .tree-badge')].map(e => e.textContent.trim()).join('|')");
  check('the heaviest part says heavy', /heavy/.test(one), one);

  // the Heavy parts list: press on a row and drag over the others
  await esc();
  await evalJS("(() => { const sec = document.getElementById('offenders-body').closest('.section'); const h = sec.querySelector('.section-h'); if (h.classList.contains('collapsed') || !document.getElementById('offenders-list').offsetParent) h.click(); document.getElementById('offenders-list').scrollIntoView({ block: 'center' }); return true; })()"); await sleep(700);
  const ticked = () => evalJS("[...document.querySelectorAll('#offenders-list .off-row')].map((r, i) => r.classList.contains('selected') ? i : -1).filter(i => i >= 0).join(',')");
  const centre = (i) => evalJS("(() => { const r = document.querySelectorAll('#offenders-list .off-row')[" + i + "].getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2]); })()").then(JSON.parse);
  const mouse = (type, x, y, mods = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers: mods });
  // (the section slides open and the sidebar scrolls to it: wait until the list stands still)
  const still = async () => { await sleep(900); for (let k = 0, last = null, n = 0; k < 60; k++) { const t = await evalJS("Math.round(document.querySelector('#offenders-list .off-row').getBoundingClientRect().top)"); if (t === last) { if (++n >= 3) break; } else n = 0; last = t; await sleep(150); } };
  const press = async (i, mods = 0) => { await evalJS("document.getElementById('offenders-list').scrollTo({ top: 0, behavior: 'instant' })"); await still(); const [x, y] = await centre(i); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await mouse('mousePressed', x, y, mods); return [x, y]; };
  const moveTo = async (i, mods = 0) => { const [x, y] = await centre(i); await mouse('mouseMoved', x, y, mods); await sleep(40); return [x, y]; };
  const release = async (i, mods = 0) => { const [x, y] = await centre(i); await mouse('mouseReleased', x, y, mods); await sleep(300); };
  const drag = async (from, to, mods = 0) => {
    await press(from, mods);
    const step = to >= from ? 1 : -1;
    for (let i = from + step; i !== to + step && from !== to; i += step) await moveTo(i, mods);
    await release(to, mods);
  };
  check('nothing is ticked to begin with', (await ticked()) === '', await ticked());
  // the tick shows when the mouse goes down, not when it comes up
  await press(2);
  check('the checkmark is there as soon as the mouse is down', (await ticked()) === '2', await ticked());
  await release(2);
  check('and the release does not take it off again', (await ticked()) === '2', await ticked());
  await drag(2, 2);
  check('a plain click on a ticked row takes its tick off', (await ticked()) === '', await ticked());
  await drag(1, 4);
  check('press on a row and drag down over three more: the four are ticked', (await ticked()) === '1,2,3,4', await ticked());
  check('and the parts are selected', (await evalJS('window.state.selected.size')) >= 4);
  await drag(3, 1);
  check('press on a ticked row and drag up over two: they are taken off, the one below stays', (await ticked()) === '4', await ticked());
  // going back over a row puts it back
  await press(6); await moveTo(7); await moveTo(8); await moveTo(7); await release(7);
  check('going back over a row puts it back as it was (6 and 7 ticked, 8 not)', (await ticked()) === '4,6,7', await ticked());
  await drag(0, 3);
  check('press on a row and drag over rows, some ticked already: they are all ticked', (await ticked()) === '0,1,2,3,4,6,7', await ticked());
  await drag(4, 0);
  check('press on a ticked row and drag up over them: they are taken off', (await ticked()) === '6,7', await ticked());
  const before = await ticked();
  await drag(5, 5);
  check('a plain click still ticks one row', (await ticked()) === '5,6,7' && before === '6,7', await ticked());
  // dragged to the bottom edge of the list it scrolls by itself (also with the pointer still), steadily, and ticks the rows that pass under it
  for (const k of (await ticked()).split(',').filter(Boolean).map(Number)) await drag(k, k);      // (nothing ticked again)
  await still();
  const lbox = await evalJS("(() => { const r = document.getElementById('offenders-list').getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.top, r.bottom]); })()").then(JSON.parse);
  await press(1);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: lbox[0], y: lbox[2] - 30, buttons: 1, button: 'left' }); await sleep(700);
  const inside = await evalJS("document.getElementById('offenders-list').scrollTop");      // (30 px inside the edge: the last rows are for ticking, it does not scroll yet)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: lbox[0], y: lbox[2] + 20, buttons: 1, button: 'left' });      // (past the edge)
  const sc = [];
  for (let k = 0; k < 8; k++) { await sleep(150); sc.push(await evalJS("document.getElementById('offenders-list').scrollTop")); }
  await mouse('mouseReleased', lbox[0], lbox[2] + 20); await sleep(300);
  const t1 = (await ticked()).split(',').filter(Boolean).map(Number);
  check('thirty pixels inside the bottom edge the list does not scroll', inside === 0, inside);
  check('past the bottom edge the list scrolls by itself, with the pointer still', sc[7] > sc[0] && sc[0] > 0, sc);      // (how steadily it goes is for a real display: the frames of headless Chrome come a few a second)
  check('the rows that passed under the pointer are ticked, one run from the row pressed on', t1.length > 8 && t1[0] === 1 && t1.every((v, i) => i === 0 || v === t1[i - 1] + 1), t1);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
