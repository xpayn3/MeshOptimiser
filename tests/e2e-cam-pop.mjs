// node tests/e2e-cam-pop.mjs
//
// A right-click on the camera pill (top left of the view) opens a popup beside it with every camera setting: projection, focal length,
// clip planes, what the view orbits around, the speeds, the orbit options. They are the Settings › Camera pane itself, lent to the popup:
// a setting changed in the popup is the one in Settings. Checks that the popup opens on a right-click (and no other menu with it), holds
// those controls, changes the camera, closes on Esc and on a click elsewhere and gives the pane back each time, closes when Settings opens
// from its own button (which shows the Camera pane, with the controls), and that a left-click still opens the views menu.
// Needs the app served on APP_PORT (default 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9375, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-campop-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const center = (sel) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const mouse = async (x, y, button, clicks = 1) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: clicks }); };
const rightClick = async (sel) => { const [x, y] = await center(sel); await mouse(x, y, 'right'); await sleep(250); };
const leftClick = async (sel) => { const [x, y] = await center(sel); await mouse(x, y, 'left'); await sleep(250); };
const popShown = () => ev("(() => { const p = document.getElementById('vp-cam-pop'); return !!p && p.classList.contains('show') && getComputedStyle(p).visibility === 'visible'; })()");
const inPop = (sel) => ev(`!!document.querySelector('#vp-cam-pop ${sel}')`);
const paneHome = () => ev("!!document.querySelector('#settings-modal #set-pane-camera')");
const otherMenus = () => ev("(() => { const c = document.getElementById('ctx-menu'); return { ctx: !!c && c.offsetParent !== null && getComputedStyle(c).display !== 'none' && getComputedStyle(c).visibility !== 'hidden', views: document.getElementById('vp-view-pill-menu').classList.contains('show') }; })()");
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
  await ev("document.getElementById('welcome-close')?.click()"); await sleep(500);

  // ── open ──
  await rightClick('#vp-view-pill');
  check('a right-click on the camera pill opens the camera popup', await popShown());
  const om = await otherMenus();
  check('and no other menu with it (not the view menu, not the views list)', !om.ctx && !om.views, om);
  for (const [sel, name] of [['#cam-projection', 'Projection'], ['#cam-fov', 'Focal length'], ['#cam-clip', 'Clip planes'], ['#set-camera-prefs .set-row.set-stack', 'Orbit around'], ['#set-zoom-cursor', 'Zoom toward the cursor']])
    check('it holds ' + name, await inPop(sel) && await ev(`[...document.querySelectorAll('#vp-cam-pop ${sel}')].some(e => e.getClientRects().length)`));
  for (const [sel, name] of [['[data-cam="camRotate"]', 'Orbit speed'], ['[data-cam="camPan"]', 'Pan speed'], ['[data-cam="camZoom"]', 'Zoom speed'], ['#set-orbit-invert', 'Invert orbit'], ['#set-orbit-limit', 'Stop at the horizon']])
    check('it leaves out ' + name + ' (Settings only)', !(await ev(`[...document.querySelectorAll('#vp-cam-pop ${sel}')].some(e => e.getClientRects().length)`)));
  check('it leaves out the Speed and Orbit titles too', !(await ev("[...document.querySelectorAll('#vp-cam-pop .set-group-title')].some(e => e.getClientRects().length && /^(Speed|Orbit)$/.test(e.textContent.trim()))")));
  const dd = await ev("[...document.querySelectorAll('#vp-cam-pop .field>.cs-wrap')].map(e => Math.round(e.getBoundingClientRect().width))");
  check('its dropdowns are short (150 px, not the 230 of Settings)', dd.length === 2 && dd.every(w => w <= 150), dd);
  check('it shows no descriptions under its settings (Settings keeps them)', await ev("[...document.querySelectorAll('#vp-cam-pop .set-help')].length > 3 && [...document.querySelectorAll('#vp-cam-pop .set-help')].every(e => !e.getClientRects().length)"));
  const cut = await ev("[...document.querySelectorAll('#vp-cam-pop .field>label, #vp-cam-pop .set-row>span:first-child, #vp-cam-pop .toggle>span:first-child')].filter(l => l.getClientRects().length && (l.scrollWidth > l.clientWidth + 1 || l.getClientRects().length > 1 || l.getBoundingClientRect().height > 30)).map(l => l.textContent.trim().slice(0, 30))");
  check('no label is cut off or wraps (Projection, Clip planes)', cut.length === 0, cut);
  const over = await ev("(() => { const p = document.getElementById('vp-cam-pop'), r = p.getBoundingClientRect(); return [...p.querySelectorAll('.field>*, .set-row>*, .toggle>*')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > r.right - 1).map(e => (e.id || e.className || e.tagName) + ''); })()");
  check('nothing runs past its right edge (the dropdowns fit)', over.length === 0, over);
  if (process.env.SHOT) { const r = await ev("(() => { const b = document.getElementById('vp-cam-pop').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()"); const img = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } }); (await import('fs')).writeFileSync(process.env.SHOT, Buffer.from(img.data, 'base64')); }
  check('it sits beside the pill, inside the window', await ev("(() => { const p = document.getElementById('vp-cam-pop').getBoundingClientRect(), b = document.getElementById('vp-view-pill').getBoundingClientRect(); return p.left >= b.right && p.top >= 0 && p.bottom <= innerHeight && p.right <= innerWidth; })()"));

  // ── it works on the camera ──
  await ev("(() => { const s = document.getElementById('cam-projection'); s.value = 'ortho'; s.dispatchEvent(new Event('change', { bubbles: true })); })()"); await sleep(300);
  check('Projection: Orthographic from the popup makes the camera orthographic', await ev('!!window._appFns.camera.isOrthographicCamera'));
  await ev("(() => { const s = document.getElementById('cam-projection'); s.value = 'persp'; s.dispatchEvent(new Event('change', { bubbles: true })); })()"); await sleep(300);
  check('and Perspective puts it back', await ev('!!window._appFns.camera.isPerspectiveCamera'));
  // the focal length is a lens on a full-frame camera: 29 mm is the 45 degrees the view starts with, and a bigger number zooms in
  const lens = await ev("(() => { const c = window._appFns.camera, f = document.getElementById('cam-fov'), was = f.value, out = {}; for (const mm of [29, 35, 50, 85]) { f.value = String(mm); f.dispatchEvent(new Event('input', { bubbles: true })); out[mm] = +c.fov.toFixed(2); } f.value = was; f.dispatchEvent(new Event('input', { bubbles: true })); out.back = +c.fov.toFixed(2); out.unit = f.parentNode.querySelector('.prim-unit')?.textContent; return out; })()");
  check('Focal length is in mm, and 29 mm is the 45 degrees the view starts with', lens.unit === 'mm' && Math.abs(lens[29] - 45) < 0.1, lens);
  check('a bigger focal length zooms in: 35, 50 and 85 mm narrow the view as on a camera (37.8, 27.0, 16.1 degrees)', Math.abs(lens[35] - 37.85) < 0.1 && Math.abs(lens[50] - 26.99) < 0.1 && Math.abs(lens[85] - 16.07) < 0.1, lens);
  check('the popup stays open while it is used', await popShown());

  // ── close ──
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(250);
  check('Esc closes it', !(await popShown()));
  check('and the Camera pane is back in Settings', await paneHome());
  await rightClick('#vp-view-pill');
  check('it opens again', await popShown());
  await mouse(750, 500, 'left'); await sleep(250);
  check('a click in the view closes it and gives the pane back', !(await popShown()) && await paneHome());
  await rightClick('#vp-view-pill'); await rightClick('#vp-view-pill');
  check('a second right-click on the pill closes it', !(await popShown()) && await paneHome());

  // ── to Settings ──
  await rightClick('#vp-view-pill');
  await ev("document.querySelector('#vp-cam-pop [data-cam-pop=\"settings\"]').click()"); await sleep(400);
  check('its Settings button closes it and opens Settings', !(await popShown()) && await ev("document.getElementById('settings-modal').classList.contains('show')"));
  check('where the descriptions show again', await ev("[...document.querySelectorAll('#settings-modal #set-pane-camera .set-help')].some(e => e.getClientRects().length)"));
  check('and Settings still has the speeds and the orbit options', await ev(`[...document.querySelectorAll('#settings-modal #set-pane-camera [data-cam=\"camRotate\"]')].some(e => e.getClientRects().length)`) && await ev(`[...document.querySelectorAll('#settings-modal #set-orbit-invert')].some(e => e.getClientRects().length)`));
  check('at the Camera pane, with the controls in it', await ev("(() => { const p = document.querySelector('#settings-modal .set-pane[data-pane=\"camera\"]'); return !!p && p.offsetParent !== null && !!p.querySelector('#cam-fov') && !!p.querySelector('#set-camera-prefs .set-row'); })()"));
  await ev("document.getElementById('settings-done')?.click()"); await sleep(300);

  // ── the left click is unchanged ──
  await leftClick('#vp-view-pill');
  check('a left-click still opens the views list (Cam, Top, Front, Side)', (await otherMenus()).views && !(await popShown()));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  check('no uncaught errors in the page', errors.length === 0, errors);
} catch (e) { fail++; console.log('FAIL (threw)', e.message); }
finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  try { ws && ws.close(); } catch (_) {}
  chrome.kill(); process.exit(fail ? 1 : 0);
}
