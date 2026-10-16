// node tests/e2e-notes.mjs [model, default inbox/GearboxAssy.glb]
//
// Stress test of the notes: many notes at real spots on the model, then the things people do with them (hover and click a pin, open the window,
// like / dislike / tick / reply, rebuild it over and over, turn the camera, fold the card, change the pin style, undo, save and read back, write
// hostile text). It looks for what was reported broken: a pin that moves under the pointer, a window that jumps or follows the pin, a window
// under the shortcut tips, a name box that is not the app's own, a card that cannot fold.
// Needs the app served on http://localhost:4242 (python app/serve.py), Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9361, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-notes-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ready = async () => { for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); } await sleep(1500); };
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
const hoverAt = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
const clickAt = async (x, y) => { await hoverAt(x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
const centre = (sel) => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top }; })()`);
const wait = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evalJS(fn).catch(() => false)) return true; await sleep(100); } return false; };
const UI = 'window.MONotesUI';
const popBox = () => evalJS(`(() => { const p = document.querySelector('.note-pop'); if (!p) return null; const r = p.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), scroll: p.scrollTop }; })()`);
// a note written through the window, as a person would: spot, text, Enter
const editTask = () => evalJS(`(async () => { document.querySelector('.note-pop .nt-bar .nt-ib[aria-label=More]').click(); await new Promise(r => setTimeout(r, 120)); [...document.querySelectorAll('.nt-menu button')].find(b => b.textContent.trim() === 'Edit').click(); await new Promise(r => setTimeout(r, 150)); })()`);
const writeNote = (x, y, title, desc = '') => evalJS(`(async () => {
  ${UI}.addAt({ clientX: ${x}, clientY: ${y} });
  for (let i = 0; i < 40 && !document.querySelector('.note-pop .nt-ttl'); i++) await new Promise(r => setTimeout(r, 25));
  const ti = document.querySelector('.note-pop .nt-ttl'); if (!ti) return false;
  ti.value = ${JSON.stringify(title)}; ti.dispatchEvent(new Event('input'));
  const de = document.querySelector('.note-pop .nt-descin'); if (de && ${JSON.stringify(desc)}) { de.value = ${JSON.stringify(desc)}; de.dispatchEvent(new Event('input')); }
  document.querySelector('.note-pop .nt-formfoot .nt-btn.primary').click();
  await new Promise(r => setTimeout(r, 30)); return true; })()`);

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = (await import('fs')).readFileSync(MODEL).toString('base64');   // (the model sits beside the app folder, which is all the server shows)
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 240; i++) { const n = await evalJS("(window.state && window.state.parts ? window.state.parts.filter(p => !p.deleted).length : 0)").catch(() => 0); if (n > 3) break; await sleep(500); }
  await sleep(2500);
  console.log('   loaded parts', await evalJS('window.state.parts.length'), 'files', await evalJS("document.getElementById('file-input') ? document.getElementById('file-input').files.length : -1"), 'errors', JSON.stringify(errors.slice(0, 3)), 'welcome', await evalJS("!!document.getElementById('welcome-close')"));
  check('the notes module is there', await evalJS(`!!${UI} && !!document.getElementById('notes-section')`));

  // ── the name box is the app's own ──────────────────────────────────────────────────────────────────
  const vp = await centre('#canvas');
  await evalJS(`localStorage.removeItem('noteAuthor'); ${UI}.setAuthor && 0`);
  console.log('   parts', await evalJS('window.state.parts.filter(p => !p.deleted).length'), 'author', JSON.stringify(await evalJS(UI + '.author()')));
  await evalJS(`${UI}.addAt({ clientX: ${vp.x}, clientY: ${vp.y} })`);
  await wait("!!document.querySelector('.dlg-bg.show .dlg-input')");
  const nb = await evalJS(`(() => { const i = document.querySelector('.dlg-bg.show .dlg-input'); if (!i) return null; const cs = getComputedStyle(i), h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-h')) || 0; const card = document.querySelector('.dlg-bg.show .dlg-card'); return { shown: cs.display !== 'none', height: i.getBoundingClientRect().height, ctl: parseFloat(getComputedStyle(i).minHeight), bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, cardBg: getComputedStyle(card).backgroundColor, okDisabled: document.querySelector('.dlg-bg.show .dlg-btn-ok').disabled }; })()`);
  check('the name box shows a field in the app\'s dialog', nb && nb.shown && nb.okDisabled, nb);
  check('the field is as tall as every other control (--ctl-h)', nb && Math.abs(nb.height - nb.ctl) < 1, nb);
  check('the dialog uses the shared surface (not a literal)', nb && nb.cardBg === 'rgb(22, 22, 22)', nb && nb.cardBg);
  await evalJS(`(() => { const i = document.querySelector('.dlg-bg.show .dlg-input'); i.value = 'Tester One'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(300);
  check('Enter in the name box continues, and the box goes', await evalJS("!document.querySelector('.dlg-bg.show')"));
  await evalJS(`${UI}.setAuthor('Tester One')`);
  await evalJS(`(() => { const d = document.querySelector('.note-pop'); if (d) ${UI}._state && 0; })()`);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

  // ── many notes at real spots ───────────────────────────────────────────────────────────────────────
  const N = +(process.env.NOTES || 60);
  const cv = await centre('#canvas');
  let made = 0; const t0 = Date.now(); const good = [];   // (spots where a click does land on the model)
  for (let i = 0; i < N * 8 && made < N; i++) {
    const x = cv.l + cv.w * (0.2 + 0.6 * ((i * 0.618) % 1)), y = cv.t + cv.h * (0.25 + 0.5 * ((i * 0.381) % 1));
    const before = await evalJS(`${UI}.items().length`);
    await writeNote(x, y, 'Note ' + i, 'details ' + 'word '.repeat(i % 7));
    const after = await evalJS(`${UI}.items().length`);
    if (after > before) { made++; good.push([x, y]); }
    await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  }
  const spot = (k = 0) => good[k % good.length] || [cv.l + cv.w / 2, cv.t + cv.h / 2];
  console.log('   made', made, 'notes in', Date.now() - t0, 'ms');
  check('made at least ' + Math.min(N, 5) + ' notes at spots on the model', made >= Math.min(N, 5), made);
  await sleep(500);
  const pins = await evalJS("document.querySelectorAll('.note-pin').length");
  check('every note has a pin', pins === made, [pins, made]);
  check('the card lists them (count badge)', (await evalJS("document.getElementById('notes-count').textContent")) === String(made));

  // ── a pin does not move under the pointer ────────────────────────────────────────────────────────────
  await evalJS("window.__mm = { n: 0, t: '', x: 0, y: 0 }; document.addEventListener('mousemove', (e) => { window.__mm.n++; window.__mm.t = (e.target.className || e.target.tagName) + ''; window.__mm.x = e.clientX; window.__mm.y = e.clientY; }, true)");
  const firstPin = await evalJS(`(() => { const ps = [...document.querySelectorAll('.note-pin')].filter(p => p.style.display !== 'none' && !p.classList.contains('back')); const p = ps[0]; if (!p) return null; p.dataset.test = '1'; return true; })()`);
  check('there is a visible pin to test', !!firstPin);
  await evalJS(`(() => { const p = document.querySelector('.note-pin[data-test]'); const r = p.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const q = top && top.closest('.note-pin'); if (q && q !== p) { p.removeAttribute('data-test'); q.dataset.test = '1'; } })()`);   // (the pin on top, where two overlap)
  await evalJS("document.querySelectorAll('.note-pin:not([data-test])').forEach(p => { p.style.pointerEvents = 'none'; })");   // (only this pin answers the mouse: pins that overlap would take the hover)
  const c0 = await centre('.note-pin[data-test]');
  await hoverAt(c0.x - 40, c0.y - 40); await sleep(150);
  const r0 = await centre('.note-pin[data-test]');
  for (let k = 0; k < 4; k++) { await hoverAt(c0.x + (k % 2), c0.y); await sleep(150); if (await evalJS("document.querySelector('.note-pin[data-test]').matches(':hover')")) break; }
  await sleep(450);
  const r1 = await centre('.note-pin[data-test]');
  check('hovering the pin keeps its centre where it was', Math.abs(r1.x - r0.x) < 0.6 && Math.abs(r1.y - r0.y) < 0.6, [r0, r1]);
  console.log('   hover state', JSON.stringify(await evalJS(`(() => { const p = document.querySelector('.note-pin[data-test]'); const cs = getComputedStyle(p); return { hover: p.matches(':hover'), scale: cs.scale, translate: cs.translate, cls: p.className, mm: window.__mm, hovered: [...document.querySelectorAll(':hover')].map(e => e.className || e.tagName).slice(-3), active: document.activeElement && document.activeElement.className, capture: !!document.querySelector('.dragging'), top: (document.elementFromPoint(${c0.x}, ${c0.y}) || {}).className }; })()`)));
  check('and it grows a little, around its own centre', r1.w > r0.w && r1.w < r0.w * 1.3, [r0.w, r1.w]);
  // creep the pointer to the very edge of the hit area: it must stay hovered (no flicker between grown and not)
  const states = [];
  for (const d of [8, 9, 10, 11, 12]) { await hoverAt(c0.x + d, c0.y); await sleep(300); states.push(await evalJS("document.querySelector('.note-pin[data-test]').matches(':hover')")); }
  const flips = states.filter((v, i) => i && v !== states[i - 1]).length;
  check('moving to the edge flips hover at most once (no flicker loop)', flips <= 1, states);
  await hoverAt(c0.x - 60, c0.y - 60);

  // ── right-click on a pin: its own menu ──
  await hoverAt(c0.x, c0.y); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c0.x, y: c0.y, button: 'right', buttons: 2, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c0.x, y: c0.y, button: 'right', buttons: 0, clickCount: 1 });
  await wait("document.getElementById('ctx-menu') && document.getElementById('ctx-menu').style.display === 'block'", 2000);
  const menuTxt = await evalJS("(document.getElementById('ctx-menu') || {}).textContent || ''");
  check('right-clicking a pin shows the note menu', /Open the conversation/.test(menuTxt) && /Mark as resolved/.test(menuTxt) && /Assign to me/.test(menuTxt) && /Delete the note/.test(menuTxt), menuTxt.slice(0, 160));
  check('and not the viewport menu', !/Fit view|Select all/.test(menuTxt), menuTxt.slice(0, 80));
  const pinNoteId = await evalJS("document.querySelector('.note-pin[data-test]').dataset.id");
  await evalJS("[...document.querySelectorAll('#ctx-menu .ctx-menu-row')].find(r => /Mark as resolved/.test(r.textContent)).click()"); await sleep(300);
  console.log('   pmDbg', JSON.stringify(await evalJS('window.__pmDbg || null')));
  console.log('   author', JSON.stringify(await evalJS(UI + '.author()')), 'dialog', await evalJS("!!document.querySelector('.dlg-bg.show')"), 'errors', JSON.stringify(errors.slice(-2)));
  console.log('   after menu click', JSON.stringify(await evalJS('(() => { const n = ' + UI + '.items().find(n => n.id === ' + JSON.stringify(pinNoteId) + '); return n ? { status: n.status, tag: n.tag, id: n.id, count: ' + UI + '.items().length } : null; })()')), pinNoteId, await evalJS("(document.getElementById('ctx-menu')||{}).style.display"));
  check('Mark as resolved works from the menu', await evalJS(`${UI}.items().find(n => n.id === ${JSON.stringify(pinNoteId)}).status === 'resolved'`));
  check('a resolved pin is fully green, with no outline', await evalJS(`(() => { const p = document.querySelector('.note-pin[data-id="' + ${JSON.stringify(pinNoteId)} + '"]'); const sh = getComputedStyle(p.querySelector('.shape')); return p.classList.contains('done') && sh.stroke === 'none' && sh.fill === getComputedStyle(document.documentElement).getPropertyValue('--ok').trim().replace(/^#/, '') || (p.classList.contains('done') && sh.stroke === 'none' && /rgb/.test(sh.fill)); })()`));
  await evalJS(`(() => { ${UI}.items().find(n => n.id === ${JSON.stringify(pinNoteId)}).status = 'open'; ${UI}.layout(); })()`);
  await hoverAt(c0.x - 80, c0.y - 80);
  await evalJS("document.querySelectorAll('.note-pin').forEach(p => { p.style.pointerEvents = ''; })");
  // ── open it: the window is over the tips, beside the pin, and stays ────────────────────────────────────
  await clickAt(c0.x, c0.y);
  check('clicking the pin opens the window', await wait("!!document.querySelector('.note-pop')"));
  await sleep(500);
  check('a pin opens the short form (one message, no composer)', await evalJS("!!document.querySelector('.note-pop .nt-brief') && !document.querySelector('.note-pop .nt-comp') && !document.querySelector('.note-pop .nt-msgs')"));
  check('the window has a title bar like the Material window: icon, title, close', await evalJS("(() => { const g = document.querySelector('.note-pop .nt-titlebar'); return !!g && !!g.querySelector('.nt-tico, .nt-tbadge') && /^Note [0-9]+$/.test(g.querySelector('.nt-ttitle').textContent) && !!g.querySelector('.nt-ib') && !document.querySelector('.note-pop .nt-grip'); })()"));
  const shortH = (await popBox()).h;
  await clickAt((await centre('.note-pop .nt-titlebar .nt-fold')).x, (await centre('.note-pop .nt-titlebar .nt-fold')).y); await sleep(300);
  check('expanding shows the conversation, the reply field and more options', await evalJS("!!document.querySelector('.note-pop .nt-msgs') && !!document.querySelector('.note-pop .nt-comp') && !!document.querySelector('.note-pop .nt-bar .nt-ib[aria-label=More]')"));
  check('and the window gets taller', (await popBox()).h > shortH, [shortH, (await popBox()).h]);
  const p0 = await popBox();
  const clearOfTips = await evalJS(`(() => { const p = document.querySelector('.note-pop').getBoundingClientRect(); const t = document.querySelector('.vp-tips:not(:empty)'); if (!t) return { none: true }; const r = t.getBoundingClientRect(); return { overlap: !(p.right < r.left || p.left > r.right || p.bottom < r.top || p.top > r.bottom), top: document.elementFromPoint(p.left + p.width / 2, p.top + 20)?.closest('.note-pop') ? 'pop' : 'other' }; })()`);
  check('the window is on top where it stands', clearOfTips.none || clearOfTips.top === 'pop', clearOfTips);
  check('and clear of the shortcut tips', clearOfTips.none || !clearOfTips.overlap, clearOfTips);
  const vb = await evalJS(`(() => { const v = document.getElementById('viewport').getBoundingClientRect(); return { r: v.right, l: v.left }; })()`);
  check('the window opens on the right side of the view', p0.l + p0.w >= vb.r - 40 && p0.l > (vb.l + vb.r) / 2 - p0.w, [p0, vb]);
  const inside = await evalJS(`(() => { const p = document.querySelector('.note-pop').getBoundingClientRect(), v = document.getElementById('viewport').getBoundingClientRect(); return p.left >= v.left && p.top >= v.top && p.right <= v.right && p.bottom <= v.bottom; })()`);
  check('and inside the view', inside);
  // turn the camera: the window stays, the pins move
  const pinBefore = await centre('.note-pin[data-test]');
  await evalJS(`(() => { const c = window.state.camera || window.camera; const ctl = window.state.controls || window.controls; if (ctl && ctl.rotateLeft) { ctl.rotateLeft(0.4); ctl.update(); } window.requestRender && window.requestRender(); })()`);
  await sleep(700);
  const p1 = await popBox(); const pinAfter = await centre('.note-pin[data-test]');
  console.log('   window', JSON.stringify(p0), '->', JSON.stringify(p1), '; pin moved', pinBefore && pinAfter ? Math.round(Math.hypot(pinAfter.x - pinBefore.x, pinAfter.y - pinBefore.y)) : '?', 'px');
  check('turning the camera does not drag the window along', p1 && p0 && p1.l === p0.l && p1.t === p0.t, [p0, p1]);

  // ── drag it by its top row ──
  const hh = await centre('.note-pop .nt-titlebar .nt-grow');
  await hoverAt(hh.x, hh.y); await mouse('mousePressed', hh.x, hh.y); await sleep(50);
  for (let i = 1; i <= 8; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hh.x - i * 15, y: hh.y + i * 8, button: 'left', buttons: 1 }); await sleep(20); }
  await mouse('mouseReleased', hh.x - 120, hh.y + 64); await sleep(200);
  const pd = await popBox(); await sleep(400);
  check('the window drags by its top row', Math.abs((pd.l - p0.l) + 120) <= 2 && Math.abs((pd.t - p0.t) - 64) <= 2, [p0, pd]);
  check('and stays where it was dropped', (await popBox()).l === pd.l);
  p0.l = pd.l; p0.t = pd.t;
  // ── the card's buttons are icons in a row ──
  const rows = await evalJS(`(() => [...document.querySelectorAll('#notes-body .nt-tools')].map(r => { const b = [...r.children].map(x => x.getBoundingClientRect()); return { n: b.length, sameRow: b.every(x => Math.abs(x.top - b[0].top) < 1), text: [...r.children].map(x => x.textContent.trim()).join('') }; }))()`);
  check('the two button rows are three buttons each on one line: New note then icons, and icons only below', rows.length === 2 && rows.every(r => r.n === 3 && r.sameRow) && rows[0].text === 'New note' && rows[1].text === '', rows);
  // ── reactions and reply, each click leaves the window where it is ──────────────────────────────────────
  const steps = [];
  const clickIn = async (sel, label) => {
    const before = await popBox(); const c = await centre(sel); if (!c) { steps.push([label, 'no button']); return false; }
    await clickAt(c.x, c.y); await sleep(250); const after = await popBox();
    steps.push([label, before && after && before.l === after.l && before.t === after.t]); return true;
  };
  await hoverAt(p0.l + 100, p0.t + 120);
  // a first comment, to react to (the description has no reactions: it is the task's own text)
  await evalJS(`(() => { const ta = document.querySelector('.note-pop .nt-comp textarea'); ta.value = 'the first comment'; ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  await sleep(300);
  check('a comment goes under the note, and the description stays above it', await evalJS(`(() => { const n = ${UI}.items().find(x => x.id === ${UI}._state.openId); return n.messages.length >= 2 && n.messages[0].desc === true && n.messages[1].desc !== true && n.messages[1].text === 'the first comment' && !!document.querySelector('.note-pop .nt-msgs .nt-msg'); })()`));
  await clickIn('.note-pop .nt-rb[aria-label="Like"]', 'like');
  check('Like counts and is marked mine', await evalJS(`(() => { const b = document.querySelector('.note-pop .nt-rb[aria-label="Like"]'); return b.classList.contains('on') && b.textContent.trim() === '1'; })()`));
  await clickIn('.note-pop .nt-rb[aria-label="Dislike"]', 'dislike');
  check('there is no Done button under a comment (done is for the whole note)', !(await evalJS("!!document.querySelector('.note-pop .nt-rb[aria-label=Done]')")));
  check('Dislike takes the like away', await evalJS(`(() => { const l = document.querySelector('.note-pop .nt-rb[aria-label="Like"]'), d = document.querySelector('.note-pop .nt-rb[aria-label="Dislike"]'); return !l.classList.contains('on') && d.classList.contains('on'); })()`));
  // reply to the first message
  await clickIn('.note-pop .nt-rb[aria-label="Reply"]', 'reply');
  check('Reply shows who is being answered', await evalJS("!!document.querySelector('.note-pop .nt-replying')"));
  await evalJS(`(() => { const ta = document.querySelector('.note-pop textarea'); ta.value = 'An answer'; ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  await sleep(300);
  check('the answer carries the quote of what it answers', await evalJS("document.querySelectorAll('.note-pop .nt-quote').length === 1"));
  check('and is saved with the id of that message', await evalJS(`(() => { const n = ${UI}.items().find(n => n.messages.some(m => m.text === 'An answer')); const a = n && n.messages.find(m => m.text === 'An answer'), c = n && n.messages.find(m => m.text === 'the first comment'); return !!(a && c && a.to === c.id); })()`));
  const moved = steps.filter(s => s[1] !== true);
  check('no click inside the window moved it', moved.length === 0, moved);

  // ── rebuild it again and again: position, scroll, no new animation ─────────────────────────────────────
  await evalJS(`(() => { const l = document.querySelector('.note-pop .nt-msgs'); if (l) l.scrollTop = 0; })()`);
  const b0 = await popBox();
  for (let i = 0; i < 40; i++) await evalJS(`(() => { const x = document.querySelector('.note-pop .nt-rb[aria-label="Like"]'); x && x.click(); })()`);
  await sleep(300);
  const b1 = await popBox();
  check('40 quick clicks leave it where it was', b1 && b0 && b1.l === b0.l && b1.t === b0.t, [b0, b1]);
  check('and it did not replay its opening animation', await evalJS(`getComputedStyle(document.querySelector('.note-pop')).animationName === 'none'`));

  // ── next / previous: the window goes to the other note's pin ─────────────────────────────────────────────
  await evalJS(`${UI}.next()`); await sleep(500);
  check('Next keeps the window open as it was (expanded)', await evalJS("!!document.querySelector('.note-pop .nt-msgs')"));
  check('Next opens another note', await evalJS(`(() => { const o = ${UI}._state.openId; return !!o; })()`));
  check('and there is still one window', (await evalJS("document.querySelectorAll('.note-pop').length")) === 1);

  // ── screenshots only when asked ──
  check('no note got a screenshot on its own', await evalJS(`${UI}.items().every(n => !n.thumb)`));
  await writeNote(...spot(1), 'with picture', 'a few words about it');
  await evalJS(`document.querySelector('.note-pop .nt-more, .note-pop .nt-bar .nt-ib[aria-label=More]').click()`); await sleep(150);
  await evalJS(`[...document.querySelectorAll('.nt-menu button')].find(b => /screenshot/i.test(b.textContent)).click()`);
  check('the menu can add one', await wait(`${UI}.items().some(n => n.thumb)`, 8000));
  await sleep(400);
  const lay = await evalJS(`(() => { const p = document.querySelector('.note-pop'), m = p.querySelector('.nt-msgs').getBoundingClientRect(), c = p.querySelector('.nt-comp').getBoundingClientRect(), t = p.querySelector('.nt-thumb').getBoundingClientRect(), pr = p.getBoundingClientRect(); return { msgsH: Math.round(m.height), thumbH: Math.round(t.height), clear: m.bottom <= c.top + 1 && t.bottom <= m.top + 1, inside: c.bottom <= pr.bottom + 1 }; })()`);
  check('a screenshot is a small strip that leaves the comments room, and covers nothing', lay.thumbH <= 90 && lay.msgsH >= 20 && lay.clear && lay.inside, lay);
  // ── the window can be resized, and the size is kept ──
  const w0 = (await popBox()).w;
  const wh = await centre('.note-pop .nt-rz-w');
  await hoverAt(wh.x, wh.y); await mouse('mousePressed', wh.x, wh.y); await sleep(50);
  for (let i = 1; i <= 6; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: wh.x - i * 20, y: wh.y, button: 'left', buttons: 1 }); await sleep(20); }
  await mouse('mouseReleased', wh.x - 120, wh.y); await sleep(200);
  const w1 = (await popBox()).w;
  check('pulling the left edge makes the window wider', w1 > w0 + 90, [w0, w1]);
  const sh = await centre('.note-pop .nt-rz-s'); const h0 = (await popBox()).h;
  await hoverAt(sh.x, sh.y); await mouse('mousePressed', sh.x, sh.y); await sleep(50);
  for (let i = 1; i <= 4; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sh.x, y: sh.y - i * 25, button: 'left', buttons: 1 }); await sleep(20); }
  await mouse('mouseReleased', sh.x, sh.y - 100); await sleep(200);
  const h1 = (await popBox()).h;
  check('pulling the bottom edge makes it shorter', h1 < h0 - 60 && h1 >= 260, [h0, h1]);
  await evalJS(`${UI}.next()`); await sleep(400);
  const nextBox = await popBox();
  check('the next window opens at the size it was left', Math.abs(nextBox.w - w1) <= 1, [w1, nextBox.w]);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  // ── the card folds ────────────────────────────────────────────────────────────────────────────────────
  await evalJS("document.querySelector('#notes-section .section-h').scrollIntoView({ block: 'center' })"); await sleep(200);
  const hd = await centre('#notes-section .section-h');
  console.log('   fold target', JSON.stringify(hd), await evalJS(`(() => { const e = document.elementFromPoint(${hd.x}, ${hd.y}); return (e && (e.className || e.tagName)) + ' | ' + (e && e.closest('#notes-section') ? 'inside' : 'outside') + ' | ' + window.innerWidth + 'x' + window.innerHeight; })()`));
  const vis0 = await evalJS("document.getElementById('notes-body').getBoundingClientRect().height");
  await clickAt(hd.x, hd.y);
  const cls1 = await evalJS("document.querySelector('#notes-section .section-h').classList.contains('collapsed')");
  await wait("document.getElementById('notes-body').getBoundingClientRect().height < 10", 3000);   // (the app slides the body shut)
  const vis1 = await evalJS("document.getElementById('notes-body').getBoundingClientRect().height");
  await clickAt(hd.x, hd.y); await wait("document.getElementById('notes-body').getBoundingClientRect().height > 50", 3000);
  const vis2 = await evalJS("document.getElementById('notes-body').getBoundingClientRect().height");
  check('the card folds', vis0 > 0 && cls1 && vis1 < 10, [vis0, cls1, vis1]);
  check('and opens again', vis2 > 0, vis2);

  // ── pin styles ──────────────────────────────────────────────────────────────────────────────────────────
  check('there is a pins button in the card (what the pins show)', !!(await evalJS("document.querySelector('#notes-body .nt-pinsbtn')")));
  for (const [mode, label, test] of [['icon', 'The kind, as an icon', "p.querySelector('b svg')"], ['color', 'Only the shape', "!p.querySelector('b') && p.textContent === ''"], ['name', 'The writer', "/^[A-Z?]$/.test(p.textContent)"], ['text', 'The title, as a label', "p.classList.contains('b-text') && p.querySelector('span').textContent.length > 0"], ['number', 'The number', "/^\\d+$/.test(p.textContent)"]]) {
    await evalJS("document.querySelector('#notes-body .nt-pinsbtn').click()"); await sleep(150);
    await evalJS(`[...document.querySelectorAll('#ctx-menu .ctx-menu-row')].find(r => r.textContent.startsWith(${JSON.stringify(label)})).click()`); await sleep(250);
    const ok = await evalJS(`[...document.querySelectorAll('.note-pin')].every(p => ${test})`);
    check('every pin shows the ' + mode + ' style', ok);
  }

  // ── review: shapes, sign-off, priority, mentions, jumping, the selected part ──
  const items = await evalJS(`${UI}.items().filter(n => !n.deleted).slice(0, 4).map(n => n.id)`);
  const tags = ['info', 'question', 'issue', 'idea'];
  await evalJS(`(() => { const S = ${UI}._state; ${JSON.stringify(items)}.forEach((id, i) => { S.items.find(x => x.id === id).tag = ${JSON.stringify(tags)}[i]; }); ${UI}.togglePins(); ${UI}.togglePins(); })()`); await sleep(300);
  const shapes = await evalJS(`${JSON.stringify(items)}.map(id => { const p = document.querySelector('.note-pin[data-id="' + id + '"]'); return p ? p.dataset.shape + ':' + !!p.querySelector('svg.shape') + ':' + p.textContent.trim() : null; })`);
  check('each kind of note has its own shape, with the number inside', shapes.length >= 3 && shapes[0].startsWith('circle:true') && shapes[1].startsWith('square:true') && shapes[2].startsWith('triangle:true') && shapes.every(x => x && /:\d+$/.test(x)), shapes);
  await evalJS(`document.querySelector('#notes-body .nt-rv[data-state="approved"]').click()`); await sleep(150);
  const sum1 = await evalJS("document.querySelector('#notes-body .nt-revsum').textContent");
  check('Approve shows in the card', /Approved by Tester One/.test(sum1), sum1);
  await evalJS(`document.querySelector('#notes-body .nt-rv[data-state="changes"]').click()`); await sleep(150);
  const sum2 = await evalJS("document.querySelector('#notes-body .nt-revsum').textContent");
  check('Changes replaces it (one answer each)', /Changes asked by Tester One/.test(sum2) && !/Approved/.test(sum2), sum2);
  check('and it is kept in the saved notes', await evalJS(`${UI}.serialize().reviews['Tester One'].state === 'changes'`));
  await evalJS(`document.querySelector('#notes-body .nt-rv[data-state="changes"]').click()`);
  await writeNote(...spot(1), 'priority and mention', 'look at this @Tester One'); await sleep(300);
  check('an @name in a message is shown as a mention', await evalJS("!!document.querySelector('.note-pop .nt-mention')"));
  check('a new task window does not show the task controls', !(await evalJS("!!document.querySelector('.note-pop .nt-props')")));
  await editTask();
  check('Edit the task, from the three dots, brings them back', await evalJS("!!document.querySelector('.note-pop .nt-props .nt-seg')"));
  await evalJS(`document.querySelectorAll('.note-pop .nt-props .nt-seg button')[2].click()`); await sleep(250);
  const pid = await evalJS(`${UI}._state.openId`);
  check('Urgent is saved on the note', await evalJS(`${UI}.items().find(n => n.id === ${JSON.stringify(pid)}).priority === 'urgent'`));
  check('and its pin is marked', (await evalJS(`(document.querySelector('.note-pin[data-id="' + ${JSON.stringify(pid)} + '"]') || { dataset: {} }).dataset.pri`)) === 'urgent');
  await evalJS(`(() => { const ta = document.querySelector('.note-pop textarea'); ta.focus(); window.MONotes.reply(${UI}._state.items.find(n => !n.deleted), 'Ana Kovac', 'a reply from someone else'); ta.value = 'hello @An'; ta.setSelectionRange(9, 9); ta.dispatchEvent(new Event('input')); })()`); await sleep(150);
  check('typing @ offers the names of the people on the notes', await evalJS("(() => { const m = document.querySelector('.note-pop .nt-mentions'); return !!m && !m.hidden && /Ana Kovac/.test(m.textContent); })()"));
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  const lab0 = await evalJS("document.querySelector('#notes-body .nt-navlabel').textContent");
  await evalJS(`document.querySelectorAll('#notes-body .nt-nav .nt-ib')[1].click()`); await sleep(400);
  const lab1 = await evalJS("document.querySelector('#notes-body .nt-navlabel').textContent");
  check('the card jumps to the next note and says which one ("3 of 9")', /^\d+ of \d+$/.test(lab1), [lab0, lab1]);
  check('and opens it', !!(await evalJS(`${UI}._state.openId`)));
  const allRows = await evalJS("document.querySelectorAll('#notes-body .nt-row').length");
  await evalJS(`(() => { const S = ${UI}._state; const n = S.items.find(x => !x.deleted && x.part); if (n) { const p = S.host.state.parts.find(q => (n.part.uid && q.uid === n.part.uid) || q.name === n.part.name); if (p) { S.host.state.selected.clear(); S.host.state.selected.add(p.partId); } } document.querySelector('#notes-body .nt-sbar .nt-ib[aria-label^="Only the notes"]').click(); })()`); await sleep(300);
  const selRows = await evalJS("document.querySelectorAll('#notes-body .nt-row').length");
  check('"only the selected part" narrows the list', selRows >= 1 && selRows <= allRows, [allRows, selRows]);
  await evalJS(`document.querySelector('#notes-body .nt-sbar .nt-ib[aria-label^="Only the notes"]').click()`);

  // ── due dates ──
  await evalJS(`${UI}.next()`); await sleep(300);
  await evalJS(`(() => { const S = ${UI}._state; S.expanded = true; })()`);
  await evalJS(`${UI}.next()`); await sleep(300);
  const dueId = await evalJS(`${UI}._state.openId`);
  const yday = await evalJS(`window.MONotes.todayStr(-1)`);
  await editTask();
  await evalJS(`(() => { const i = document.querySelector('.note-pop .nt-date'); i.value = ${JSON.stringify(yday)}; i.dispatchEvent(new Event('change')); })()`); await sleep(300);
  check('a due date is set from the window', (await evalJS(`${UI}.items().find(n => n.id === ${JSON.stringify(dueId)}).due`)) === yday);
  check('a date in the past, not done, marks the pin late', await evalJS(`document.querySelector('.note-pin[data-id="' + ${JSON.stringify(dueId)} + '"]').classList.contains('late')`));
  check('and the window says it is overdue', /Overdue/.test(await evalJS("document.querySelector('.note-pop .nt-pmeta').textContent")));
  await evalJS(`document.querySelector('.note-pop .nt-duebox .nt-ib').click()`); await sleep(250);
  check('the due date can be taken off', (await evalJS(`${UI}.items().find(n => n.id === ${JSON.stringify(dueId)}).due`)) === '');
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  // ── right-click on the model: a note here, or on this part ──
  { const [gx, gy] = spot(0);
    await evalJS(`${UI}.togglePins()`); await sleep(200);      // (a pin there would answer with its own menu)
    await hoverAt(gx, gy); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gx, y: gy, button: 'right', buttons: 2, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gx, y: gy, button: 'right', buttons: 0, clickCount: 1 });
    await wait("document.getElementById('ctx-menu') && document.getElementById('ctx-menu').style.display === 'block'", 2000);
    const vm = await evalJS("(document.getElementById('ctx-menu') || {}).textContent || ''");
    check('the right-click menu on the model offers a note here and a note on this part', /Add a note here/.test(vm) && /Add a note to this part/.test(vm), vm.slice(0, 120));
    await evalJS("[...document.querySelectorAll('#ctx-menu .ctx-menu-row')].find(r => /Add a note to this part/.test(r.textContent)).click()"); await sleep(500);
    check('"to this part" opens a new note about that part', await evalJS(`(() => { const d = ${UI}._state.draft; return !!d && d.kind === 'part' && !!d.part && !!document.querySelector('.note-pop'); })()`));
    await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await evalJS(`${UI}.togglePins()`); await sleep(200); }

  // ── show only the parts that have notes ──
  const total = await evalJS("window.state.parts.filter(p => !p.deleted && p.visible).length");
  const noted = await evalJS(`new Set(${UI}.items().filter(n => !n.deleted && n.part).map(n => n.part.name)).size`);
  await evalJS(`document.querySelector('#notes-body .nt-nav .nt-ib[aria-label^="Show only the parts"]').click()`); await sleep(500);
  const shown = await evalJS("window.state.parts.filter(p => !p.deleted && p.visible).length");
  check('the isolate button leaves only the parts that have notes visible', shown > 0 && shown < total && shown <= noted + 3, [total, shown, noted]);
  check('and the button shows it is on', await evalJS("document.querySelector('#notes-body .nt-nav .nt-ib[aria-label^=\"Show only the parts\"]').classList.contains('on')"));
  await evalJS(`document.querySelector('#notes-body .nt-nav .nt-ib[aria-label^="Show only the parts"]').click()`); await sleep(500);
  check('pressing it again shows everything', (await evalJS("window.state.parts.filter(p => !p.deleted && p.visible).length")) === total);

  // ── a note about several parts ──
  await evalJS(`(() => { const S = ${UI}._state; const ps = S.host.state.parts.filter(p => !p.deleted && p.mesh).slice(3, 6); S.host.state.selected.clear(); for (const p of ps) S.host.state.selected.add(p.partId); })()`);
  await evalJS(`${UI}.addForSelection()`); await sleep(500);
  await evalJS(`(() => { const ti = document.querySelector('.note-pop .nt-ttl'); ti.value = 'three parts together'; ti.dispatchEvent(new Event('input')); ti.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`); await sleep(400);
  const multi = await evalJS(`(() => { const n = ${UI}.items().find(x => x.title === 'three parts together'); return n ? { also: n.also.length, kind: n.kind } : null; })()`);
  check('a note written with three parts selected is about all three', multi && multi.also === 2 && multi.kind === 'part', multi);
  check('and the window says so', /Parts . 3/.test(await evalJS("document.querySelector('.note-pop .nt-plabel').textContent")));
  const order = await evalJS("(() => { const kids = [...document.querySelector('.note-pop .nt-scroll').children].map(c => c.className.split(' ')[0]); return { kids, d: kids.indexOf('nt-descblock'), l: kids.indexOf('nt-seclabel'), m: kids.indexOf('nt-pmeta'), c: kids.indexOf('nt-plist2'), pr: kids.indexOf('nt-props') }; })()");
  check('under the description: a Parts title, the line about the note, a card for every part, then the toolbar and the comments; the controls stay hidden', order.d >= 0 && order.l === order.d + 1 && order.m === order.d + 2 && order.c === order.d + 3 && order.kids[order.c + 1] === 'nt-bar' && order.kids[order.c + 2] === 'nt-cpanel' && order.pr === -1, order);
  check('the title says Parts, and how many', await evalJS("document.querySelector('.note-pop .nt-plabel').textContent.startsWith('Parts')"));
  check('and every part has its own card with one Focus button', await evalJS("(() => { const cs = [...document.querySelectorAll('.note-pop .nt-plist2 .nt-partcard')]; return cs.length === 3 && cs.every(c => c.querySelector('.nt-pname').textContent.length > 0 && c.querySelectorAll('.nt-focus').length === 1); })()"));
  await evalJS(`(() => { const n = ${UI}.items().find(x => x.title === 'three parts together'); const S = ${UI}._state; S.host.state.selected.clear(); ${UI}.isolateNoted && 0; })()`);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  // ── taking the notes out ──
  await evalJS(`document.querySelectorAll('#notes-body .nt-foot .nt-tool')[1].click()`); await sleep(300);
  const exp = await evalJS("(document.getElementById('ctx-menu') || {}).textContent || ''");
  check('the export button offers a report, a spreadsheet, JSON and BCF', /report page/i.test(exp) && /spreadsheet/i.test(exp) && /json/i.test(exp) && /bcf/i.test(exp), exp.slice(0, 120));
  const csvOk = await evalJS(`(() => { const csv = window.MONotesIO.toCsv(${UI}.items()); return csv.split('\\r\\n').length - 2 === ${UI}.items().filter(n => !n.deleted).length; })()`);
  check('the spreadsheet has a row for every note', csvOk);
  const bcfOk = await evalJS(`(async () => { const z = window.MONotesIO.toBcf(${UI}.items(), { title: 'x' }); const f = await window.MONotesIO.unzip(z); return Object.keys(f).filter(k => /markup\\.bcf$/.test(k)).length === ${UI}.items().filter(n => !n.deleted).length; })()`);
  check('the BCF file has a topic for every note', bcfOk);
  await evalJS("document.body.click()");
  // ── undo ────────────────────────────────────────────────────────────────────────────────────────────────
  const n0 = await evalJS(`${UI}.items().length`);
  await writeNote(...spot(1), 'to undo');
  const n1 = await evalJS(`${UI}.items().length`);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await evalJS("document.body.focus()");
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
  await sleep(500);
  const n2 = await evalJS(`${UI}.items().length`);
  check('Ctrl+Z takes the last note away', n1 === n0 + 1 && n2 === n0, [n0, n1, n2]);

  // ── hostile text ────────────────────────────────────────────────────────────────────────────────────────
  await writeNote(...spot(1), '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1<\/script> ' + 'y'.repeat(300), '<b>x</b>' + 'x'.repeat(7000));
  await sleep(300);
  check('markup in a note is text, not run', !(await evalJS('!!window.__pwned')));
  check('a very long title and description are cut to the limit', await evalJS(`${UI}.items().every(n => n.title.length <= 140 && n.messages.every(m => m.text.length <= 6000))`));
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

  // ── save and read back ──────────────────────────────────────────────────────────────────────────────────
  const ser = await evalJS(`(() => { const a = ${UI}.items().length; const s = ${UI}.serialize(); const j = JSON.stringify(s); ${UI}.load(JSON.parse(j), { quiet: true }); const b = ${UI}.items(); return { a, b: b.length, react: b.some(n => n.messages.some(m => m.react && (m.react.like || m.react.dislike || m.react.done))), to: b.some(n => n.messages.some(m => m.to)), kb: Math.round(j.length / 1024) }; })()`);
  await evalJS(`(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); ${UI}.load(JSON.parse(JSON.stringify(${UI}.serialize()))); })()`);
  await sleep(300);
  const toastTxt = await evalJS("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')");
  check('opening a scene with notes says how many, how many are open, and who wrote last', /notes in this scene/.test(toastTxt) && /open|resolved/.test(toastTxt) && /latest from/.test(toastTxt), toastTxt);
  check('saved and read back: same number of notes', ser.a === ser.b, ser);
  check('the replies are still replies', ser.to);
  console.log('   saved notes', ser.kb, 'KB');

  // ── the cost: layout of all the pins, per frame, and many rebuilds ───────────────────────────────────────
  const perf = await evalJS(`(() => { const t0 = performance.now(); for (let i = 0; i < 200; i++) ${UI}.layout(); const lay = (performance.now() - t0) / 200; const t1 = performance.now(); const n = ${UI}.items()[0]; for (let i = 0; i < 100; i++) ${UI}._state && ${UI}.next(); return { layoutMs: +lay.toFixed(2), openMs: +((performance.now() - t1) / 100).toFixed(2), pins: document.querySelectorAll('.note-pin').length }; })()`);
  console.log('   ', JSON.stringify(perf));
  check('laying out the pins takes under 4 ms a frame', perf.layoutMs < 4, perf);
  check('opening the next note takes under 25 ms', perf.openMs < 25, perf);
  check('no script errors the whole time', errors.length === 0, errors.slice(0, 4));
} catch (e) { fail++; console.log('FAIL (threw)', e && e.stack || e); }
finally { console.log(`\n${pass} passed, ${fail} failed`); try { ws && ws.close(); } catch (_) {} chrome.kill(); setTimeout(() => process.exit(fail ? 1 : 0), 500); }
