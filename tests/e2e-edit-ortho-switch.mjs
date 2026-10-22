import fs from 'node:fs';
// node tests/e2e-edit-ortho-switch.mjs
//
// Edit mesh's dots keep their size when the view changes kind. Points mode is switched on in the perspective view and every point of a
// sheet is picked; then the view goes to Side, Top and Front and back to perspective, and in each the share of the picture covered by
// the picked points' colour (orange) is measured. On three r186 a dot's shader built for the perspective view was used in the
// orthographic ones too (the camera kind was missing from the program key of node materials), and in Side the dots filled half the
// screen and the view crawled.
// Needs the app on http://localhost:4242 (APP_PORT to change it), Chrome, Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9397, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-editsheet-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--remote-allow-origins=*', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const call = async (name, args = {}) => evalJS(`(async () => { try { await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
async function attach() {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || '').split('\n').slice(0, 3).join(' | ')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
}
// a sheet of 8 x 8 squares, 40 mm a side, flat (OBJ: y up, the app's z), its faces looking up or down
function sheet(up) {
  const N = 8, out = ['o sheet'];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) out.push(`v ${(i * 5 - 20).toFixed(3)} 0 ${(j * 5 - 20).toFixed(3)}`);
  const v = (i, j) => j * (N + 1) + i + 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
    if (up) out.push(`f ${a} ${c} ${b}`, `f ${b} ${c} ${d}`); else out.push(`f ${a} ${b} ${c}`, `f ${b} ${d} ${c}`);
  }
  return out.join('\n');
}
// dark pixels (the dots) in the middle of the canvas
const BLACK = `(async (b64) => {
  const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const r = document.getElementById('canvas').getBoundingClientRect();
  const x0 = Math.round(r.left + r.width * 0.3), y0 = Math.round(r.top + r.height * 0.3), w = Math.round(r.width * 0.4), h = Math.round(r.height * 0.4);
  const d = g.getImageData(x0, y0, w, h).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 250) n++;      // (dark: the dots; the sheet is light and its lines blue)
  return n;
})`;
const shotBlack = async () => { const s = await send('Page.captureScreenshot', { format: 'png' }); return evalJS(`${BLACK}(${JSON.stringify(s.data)})`); };

try {
  await attach();
  for (const up of [true, false]) {
    const side = up ? 'front' : 'back';
    await send('Page.navigate', { url: URL + '?t=' + Date.now() });
    for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready') && !!window.__moElements && !!window.__moBridgeTools").catch(() => false)) break; await sleep(500); }
    await sleep(1200);
    await evalJS("document.getElementById('welcome-close')?.click()");
    await evalJS(`(async () => { const f = new File([${JSON.stringify(sheet(up))}], 'sheet.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    for (let i = 0; i < 60; i++) { if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) await evalJS("document.querySelector('#import-modal-confirm')?.click()"); if (await evalJS("window.state && window.state.parts.some(p => !p.deleted && p.mesh)")) break; await sleep(500); }
    await sleep(1500);
    await call('select_parts', { name_contains: 'sheet' });
    await call('set_camera_view', { view: 'perspective' }).catch(() => {}); await call('frame_selection'); await sleep(1000);
    await evalJS("window.__moElements.mode('points'); true"); await sleep(1500);
    await evalJS("window.__moElements.selectAll(); true"); await sleep(1200);
    const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); 
      return evalJS('(async (b64) => { const img = await createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob()); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let o = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i+1] > 100 && d[i+1] < 190 && d[i+2] < 90) o++; return Math.round(1000 * o / (d.length / 4)) / 10; })(' + JSON.stringify(r.data) + ')'); };
    const o0 = await shot('1-persp');
    check('the picked points show in the perspective view and stay small (orange ' + o0 + ' %)', o0 > 0 && o0 < 3, o0);
    const t0 = Date.now(); await call('set_camera_view', { view: 'side' }); await sleep(1500);
    const o1 = await shot('2-side');
    check('in Side the dots keep their size (orange ' + o1 + ' %, it was half the screen)', o1 < 3, o1);
    for (const v of ['top', 'front']) { await call('set_camera_view', { view: v }); await sleep(1500); const o = await shot('2-' + v); check('in ' + v + ' too (orange ' + o + ' %' + (v === 'top' ? '' : ', the sheet edge-on: its dots on one line') + ')', (v === 'top' ? o > 0 : true) && o < 3, o); }
    await call('set_camera_view', { view: 'perspective' }).catch(() => {}); await sleep(1500);
    const o2 = await shot('3-back');
    check('and back in perspective as before (orange ' + o2 + ' %)', o2 > 0 && o2 < 3, o2);
    break;
    const off = await shotBlack();
    await evalJS("window.__moElements.mode('points'); true"); await sleep(1500);
    await evalJS("window._appFns.requestRender(); new Promise(r => setTimeout(r, 600))");
    const on = await shotBlack();
    check(`the sheet's dots show from the ${side} (dark pixels ${on}, without the dots ${off}; hidden dots give none)`, on - off >= 12, { on, off });
    await evalJS("window.__moElements.mode('edges'); true"); await sleep(800);
    await evalJS("window.__moElements.selectAll(); true"); await sleep(1200);
    await evalJS("window._appFns.requestRender(); new Promise(r => setTimeout(r, 600))");
    const picked = await evalJS("window.__moElements.picked().reduce((n, x) => n + x.edges.length, 0)");
    const drawn = await evalJS("window.__moElements.pickedDrawn().edges");
    check(`every picked edge of the sheet is drawn from the ${side} (${drawn} of ${picked})`, picked > 0 && drawn === picked, { picked, drawn });
    // a box over the whole sheet, in Points mode: all its points, from either side
    await evalJS("window.__moElements.clear(); window.__moElements.mode('points'); true"); await sleep(800);
    const boxed = await evalJS(`(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return window.__moElements.boxPick(r.left + 2, r.top + 2, r.right - 2, r.bottom - 2, 'set'); })()`);
    check(`a box over the sheet picks all 81 of its points from the ${side} (${boxed})`, boxed === 81, { boxed });
  }
  const errs = errors.filter(e => !/ResizeObserver/.test(e));
  check('no page errors', errs.length === 0, errs.slice(0, 3));
} catch (e) { fail++; console.log('FAIL', e && e.message || e); }
console.log(fail ? fail + ' failed' : 'all passed');
try { chrome.kill(); } catch (_) {}
process.exit(fail ? 1 : 0);
