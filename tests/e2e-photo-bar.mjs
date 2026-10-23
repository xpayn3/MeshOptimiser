// node tests/e2e-photo-bar.mjs [model, default inbox/GearboxAssy.glb]
//
// Photo mode from the tool pill, with a toolbar of its own. Here: the camera button at the foot of the tool pill on the left switches
// Photo mode on (it lights up); the bottom toolbar steps aside and Photo mode's pill stands in its place, bottom centre; a choice in its
// Lights list reaches Photo mode (the card's list shows it, the button names it); the Effects panel holds the Photo mode card's own effect
// rows, whose bar still sets the effect; Save photo runs the card's Save; the pill's X (or the camera button) leaves, the rows go back
// into the card and the bottom toolbar comes back. SHOT=folder saves two pictures (the bar, the bar with Effects open). Needs the app
// served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9361, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-photobar-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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

const shot = async (name, sel, pad = 12) => {
  if (!process.env.SHOT) return;
  const c = await evalJS(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left - ${pad}), y: Math.max(0, r.top - ${pad}), width: r.width + ${pad * 2}, height: r.height + ${pad * 2}, scale: 1 }; })()`);
  const pic = await send('Page.captureScreenshot', { format: 'png', clip: c });
  fs.writeFileSync(path.join(process.env.SHOT, name), Buffer.from(pic.data, 'base64'));
};
// shown as it is seen: laid out, not hidden, not faded out (the two bars swap with a fade, so this is read after it has run)
const VIS = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.5 && e.getBoundingClientRect().width > 0; })()`;

try {
  await attach();
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node[data-part-id]').length"); if (n > 5) break; await sleep(500); }
  await until("!document.getElementById('loader')?.classList.contains('show')", 120);
  await sleep(1000);

  check('the tool pill has a Photo mode button, and the Photo bar is not shown', await evalJS(VIS('#vp-tool-bar #tg-photo-mode')) && !(await evalJS(VIS('#vp-photo-bar'))) && await evalJS(VIS('.vpc.tr:not(#vp-photo-bar)')));

  await evalJS("document.getElementById('tg-photo-mode').click(); true");
  const inPhoto = await until("document.body.classList.contains('photo-mode') && !document.getElementById('photo-loading')?.classList.contains('show')", 120);
  await sleep(800);
  check('the camera button switches Photo mode on, and lights up', inPhoto && await evalJS("document.getElementById('tg-photo-mode').classList.contains('active') && document.getElementById('toggle-photo').checked"));
  const where = await evalJS(`(() => { const b = document.getElementById('vp-photo-bar').getBoundingClientRect(), v = document.getElementById('viewport').getBoundingClientRect();
    return { mid: Math.round(b.left + b.width / 2 - (v.left + v.width / 2)), fromBottom: Math.round(v.bottom - b.bottom), w: Math.round(b.width) }; })()`);
  check('the Photo bar stands where the bottom toolbar was (bottom centre), and the bottom toolbar steps aside',
    await evalJS(VIS('#vp-photo-bar')) && !(await evalJS(VIS('.vpc.tr:not(#vp-photo-bar)'))) && Math.abs(where.mid) <= 2 && where.fromBottom >= 4 && where.fromBottom <= 40, where);
  const names = await evalJS("[...document.querySelectorAll('#vp-photo-bar [data-list] .vpb-l')].map(e => e.textContent)");
  check('its lists show what is chosen (Lights, Backdrop, Look, Quality, size)', names.length === 5 && names.every(n => n.length > 0), names);
  await shot('photo-bar.png', '#vp-photo-bar');

  // a list: Lights → Dramatic
  await evalJS("document.querySelector('#vp-photo-bar [data-list=\"photo-lights\"]').click(); true");
  await sleep(200);
  const items = await evalJS("[...document.querySelectorAll('#vp-photo-bar .vp-photo-list .vp-prim-pop-item')].map(e => e.textContent)");
  check('the Lights list opens above the bar with the four lights', items.length === 4 && await evalJS(`(() => { const p = document.querySelector('#vp-photo-bar .vp-photo-list').getBoundingClientRect(), b = document.getElementById('vp-photo-bar').getBoundingClientRect(); return p.bottom <= b.top + 1; })()`), items);
  await evalJS("[...document.querySelectorAll('#vp-photo-bar .vp-photo-list .vp-prim-pop-item')].find(e => e.textContent === 'Dramatic').click(); true");
  await sleep(300);
  const lights = await evalJS("({ sel: document.getElementById('photo-lights').value, btn: document.querySelector('#vp-photo-bar [data-list=\"photo-lights\"] .vpb-l').textContent, open: getComputedStyle(document.querySelector('#vp-photo-bar .vp-photo-list')).display })");
  check('choosing Dramatic sets Photo mode\'s lights, the button says so, the list closes', lights.sel === 'dramatic' && lights.btn === 'Dramatic' && lights.open === 'none', lights);

  // Effects: the card's own rows
  await evalJS("document.querySelector('#vp-photo-bar [data-fx]').click(); true");
  await sleep(300);
  const fx = await evalJS(`(() => { const p = document.querySelector('#vp-photo-bar .vp-photo-fx'); return { shown: getComputedStyle(p).display !== 'none', rows: p.querySelectorAll('.prim-row').length,
    ao: !!p.querySelector('#photo-fx-ao'), bar: !!p.querySelector('#photo-row-glow .photo-bar'), note: getComputedStyle(document.querySelector('#photo-fx .photo-moved-note')).display }; })()`);
  check('Effects opens a panel with the card\'s own rows (floor, softboxes, the effects, focus)', fx.shown && fx.rows === 11 && fx.ao && fx.bar, fx);
  check('the card says where they went', fx.note === 'block', fx.note);
  await shot('photo-bar-effects.png', '#vp-photo-bar .vp-photo-fx');
  const glow = await evalJS(`(() => { const r = document.querySelector('#photo-row-glow .photo-bar'); r.value = '63'; r.dispatchEvent(new Event('input', { bubbles: true })); return document.getElementById('photo-glow').value; })()`);
  check('a bar in the panel still sets its effect', glow === '63', glow);

  // Save photo runs the card's Save
  const saved = await evalJS("(() => { let n = 0; const b = document.getElementById('photo-save'); const f = (e) => { n++; e.stopImmediatePropagation(); }; b.addEventListener('click', f, true); document.querySelector('#vp-photo-bar [data-save]').click(); b.removeEventListener('click', f, true); return n; })()");
  check('Save photo on the bar runs Save photo', saved === 1, saved);

  // leave by the bar's X
  await evalJS("document.querySelector('#vp-photo-bar [data-leave]').click(); true");
  await until("!document.body.classList.contains('photo-mode')", 40);
  await until(`${VIS('.vpc.tr:not(#vp-photo-bar)')} && !${VIS('#vp-photo-bar')}`, 20);      // (the fade back)
  const back = await evalJS(`({ bottom: ${VIS('.vpc.tr:not(#vp-photo-bar)')}, photoBar: ${VIS('#vp-photo-bar')}, rowsHome: !!document.querySelector('#photo-fx #photo-fx-ao') && !!document.querySelector('#photo-fx #photo-stage') && !!document.querySelector('#photo-fx #photo-focus-pick'),
    panelEmpty: document.querySelectorAll('#vp-photo-bar .vp-photo-fx .prim-row').length === 0, btn: document.getElementById('tg-photo-mode').classList.contains('active'), sw: document.getElementById('toggle-photo').checked, glow: document.getElementById('photo-glow').value })`);
  check('the X leaves Photo mode: the bottom toolbar is back, the rows are back in the card (and keep their values)', back.bottom && !back.photoBar && back.rowsHome && back.panelEmpty && !back.btn && !back.sw && back.glow === '63', back);

  // and again from the card's switch: the bar follows
  await evalJS("document.getElementById('toggle-photo').click(); true");
  await until("document.body.classList.contains('photo-mode') && !document.getElementById('photo-loading')?.classList.contains('show')", 120);
  await sleep(500);
  check("the card's switch brings the bar too, and lights the camera button", await evalJS(VIS('#vp-photo-bar')) && await evalJS("document.getElementById('tg-photo-mode').classList.contains('active') && document.querySelectorAll('#vp-photo-bar .vp-photo-fx .prim-row').length === 11"));
  await evalJS("document.getElementById('tg-photo-mode').click(); true");
  await until("!document.body.classList.contains('photo-mode')", 40);
  check('the camera button switches it off again', await evalJS("!document.body.classList.contains('photo-mode') && !!document.querySelector('#photo-fx #photo-fx-ao')"));
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
