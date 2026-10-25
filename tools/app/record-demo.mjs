// node tools/app/record-demo.mjs <folder> [model.glb] [--fps=25] [--still=<second>] [--only=<second to stop at>]
//
// Records the demo clip of the website (a 20 s loop, 1920 x 1080, the app only): a big cursor works the real app on a model: it orbits and
// pans, pulls the model apart with Exploded view, opens the Materials and Library drawers and the command search, then goes back to
// where it began, so the clip loops. The app runs in headless Chrome on a server of its own (port 4343).
//
// The frames are not taken as fast as the page can draw: the page's clock is paused (Emulation.setVirtualTimePolicy) and moved on one frame
// at a time, so animations, easing and the cursor are exact whatever the speed of the machine, and a frame costs as long as it needs.
// Then ffmpeg makes <folder>/meshoptimiser-demo.webm (VP9) and meshoptimiser-demo_thumb.webp (the first frame).
// --still=<s> writes only the frame at that second (<folder>/still.png) for a look. Needs Chrome, Python, Node 22+ and ffmpeg (FFMPEG).
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const pos = process.argv.slice(2).filter(x => !x.startsWith('--'));
const OUT = pos[0]; if (!OUT) { console.log('usage: node tools/app/record-demo.mjs <folder> [model.glb] [--fps=25] [--still=s]'); process.exit(2); }
const MODEL = (pos[1] || 'C:/Users/Luka/Downloads/Scania-Engine-V8-XT-Turbo.glb').replace(/\\/g, '/');
const FPS = +arg('fps', 25), STILL = arg('still', null), ONLY = arg('only', null);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const W = 1920, H = 1080, TOTAL = 20;
const APP = 4343, DBG = 9379, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-demo-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const FR = path.join(OUT, 'frames'); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR);
const srv = spawn('python', ['app/serve.py', '--no-browser', '--port', String(APP)], { cwd: path.resolve('.'), stdio: 'ignore' });
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), waiters = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const once = (method) => new Promise(res => waiters.push({ method, res }));
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

// ---- the cursor: a big arrow drawn into the page, so it is in every frame ----
const CURSOR = `(() => {
  const s = document.createElement('style');
  s.textContent = '#demo-cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:0;height:0;opacity:0;transition:opacity .35s ease;will-change:transform}#demo-cur.on{opacity:1}#demo-cur svg{position:absolute;left:-4px;top:-3px;width:50px;height:68px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.55))}#demo-cur i{position:absolute;left:-34px;top:-34px;width:68px;height:68px;border-radius:50%;border:4px solid #0d99ff;opacity:0}#demo-cur.tap i{animation:demo-tap .5s cubic-bezier(.23,1,.32,1)}@keyframes demo-tap{from{opacity:.95;transform:scale(.3)}to{opacity:0;transform:scale(1.5)}}';
  document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'demo-cur';
  d.innerHTML = '<i></i><svg viewBox="0 0 20 27"><path d="M1.5 1.5v21.2l5.2-4.9 3.6 7.8 3.6-1.6-3.5-7.6h7.1z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(d);
  window.__cur = (x, y, on, tap) => { d.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)'; d.classList.toggle('on', !!on); if (tap) { d.classList.remove('tap'); void d.offsetWidth; d.classList.add('tap'); } };
  return true;
})()`;

let frameNo = 0, cx = 1700, cy = 960, curOn = false, tapNext = false, buttons = 0;
const t = () => frameNo / FPS;
const stillAt = STILL !== null ? Math.round(+STILL * FPS) : -1, stopAt = ONLY !== null ? Math.round(+ONLY * FPS) : Infinity;
let done = false;
const DEBUG = !!process.env.DEBUG;
const frame = async () => {
  if (done) return;
  if (DEBUG) console.log('frame', frameNo, 'start');
  await evalJS(`window.__cur(${cx}, ${cy}, ${curOn}, ${tapNext})`); tapNext = false;
  const exp = once('Emulation.virtualTimeBudgetExpired');
  await send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 1000 / FPS });
  await exp;
  if (DEBUG) console.log('frame', frameNo, 'time advanced');
  if (STILL === null || frameNo === stillAt) {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 93 });
    fs.writeFileSync(STILL === null ? path.join(FR, String(frameNo).padStart(5, '0') + '.jpg') : path.join(OUT, 'still.png'), Buffer.from(r.data, 'base64'));
    if (frameNo % 25 === 0) console.log('frame', frameNo, (t()).toFixed(1) + 's');
  }
  frameNo++;
  if (frameNo > stillAt && STILL !== null) done = true;
  if (frameNo >= stopAt) done = true;
};
const mouse = (type, x, y, button = 'none', extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, ...extra });
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const hold = async (sec) => { for (let i = 0, n = Math.round(sec * FPS); i < n && !done; i++) await frame(); };
// to a point in `sec`, in a slight arc, with the buttons held down if any
const move = async (x, y, sec, o = {}) => {
  const x0 = cx, y0 = cy, n = Math.max(1, Math.round(sec * FPS)), dx = x - x0, dy = y - y0, len = Math.hypot(dx, dy) || 1, bow = (o.straight ? 0 : 0.06) * Math.min(len, 500);
  for (let i = 1; i <= n && !done; i++) {
    const u = ease(i / n), b = Math.sin(Math.PI * i / n) * bow;
    cx = x0 + dx * u - dy / len * b; cy = y0 + dy * u + dx / len * b;
    await mouse('mouseMoved', cx, cy, buttons ? o.button || 'left' : 'none');
    await frame();
  }
};
const down = async (button = 'left') => { buttons = button === 'left' ? 1 : 2; tapNext = true; await mouse('mousePressed', cx, cy, button, { clickCount: 1 }); await frame(); };
const up = async (button = 'left') => { await mouse('mouseReleased', cx, cy, button, { clickCount: 1 }); buttons = 0; await frame(); };
const click = async () => { await down(); await hold(0.08); await up(); };
const drag = async (x, y, sec, button = 'left') => { await down(button); await move(x, y, sec, { button, straight: true }); await up(button); };
const typeText = async (s) => { for (const ch of s) { await send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await hold(0.11); } };
const key = async (k, code, vk, mods = 0) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); };
const at = async (sel) => { const r = await evalJS(`(() => { const e = ${sel}; if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); if (!r) throw new Error('not found: ' + sel); return r; };
const byId = (i) => `document.getElementById('${i}')`;
const byText = (txt, scope = 'document') => `[...${scope}.querySelectorAll('*')].find(e => e.children.length < 3 && (e.textContent || '').trim() === ${JSON.stringify(txt)} && e.getBoundingClientRect().width > 0)`;

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${APP}/index.html`)).ok) break; } catch (_) {} await sleep(250); }
  let target; for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${DBG}/json`)).json()).find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method) { const k = waiters.findIndex(w => w.method === d.method); if (k >= 0) waiters.splice(k, 1)[0].res(d.params); }
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/index.html?t=` + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500); await evalJS("document.getElementById('welcome-close')?.click()");
  const fi = await send('Runtime.evaluate', { expression: "document.getElementById('file-input')" });
  await send('DOM.setFileInputFiles', { files: [MODEL], objectId: fi.result.objectId });
  for (let i = 0; i < 60; i++) { if (await evalJS("(() => { const b = document.getElementById('import-modal-confirm'); return !!b && b.getBoundingClientRect().width > 0; })()")) { await evalJS("document.getElementById('import-modal-confirm').click()"); break; } await sleep(300); }
  for (let i = 0; i < 240; i++) { if ((await evalJS("document.querySelectorAll('#tree .tree-node').length")) > 3) break; await sleep(500); }
  await sleep(6000);
  await evalJS("document.querySelectorAll('.toast, #toast-host > *, .toasts > *').forEach(e => e.remove()); true");
  await evalJS(CURSOR);
  await evalJS("document.activeElement && document.activeElement.blur && document.activeElement.blur(); true");
  console.log('setup done, pausing the clock');
  await send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
  console.log('paused');
  await frame();
  console.log('first frame ok');

  // ---- the script of the clip (seconds are the clip's) ----
  curOn = true; cx = 1560; cy = 930; await hold(0.5);
  // 1  orbit, then back (the drag out and back is net zero, so the clip ends where it began)
  await move(980, 540, 1.0);
  await drag(1180, 470, 1.8); await hold(0.45);
  await move(1180, 470, 0.01); await drag(980, 540, 1.5); await hold(0.4);
  // 2  pan with the right button, and back
  await drag(1090, 600, 1.1, 'right'); await hold(0.3);
  await drag(980, 540, 1.0, 'right'); await hold(0.3);
  // 3  Exploded view: open it, pull the slider out, orbit while it is apart, bring it back
  let [ex, ey] = await at(byText('Exploded view')); await move(ex, ey, 0.8); await click(); await hold(0.5);
  const [sx, sy] = await at("document.querySelector('#explode-all-scrub input.scrub-range')");
  await move(sx - 110, sy, 0.7); await drag(sx + 70, sy, 1.5); await hold(0.4);
  await move(1000, 500, 0.8); await drag(1160, 450, 1.3); await hold(0.3); await move(1160, 450, 0.01); await drag(1000, 500, 1.0); await hold(0.3);
  await move(sx + 70, sy, 0.7); await drag(sx - 110, sy, 1.2); await hold(0.3);
  await move(ex, ey, 0.5); await click(); await hold(0.4);
  // 4  the Materials drawer: look at what is in it, click two materials, close it
  let [mx, my] = await at(byId('tg-materials')); await move(mx, my, 0.9); await click(); await hold(0.7);
  const sw = await evalJS(`JSON.stringify([...document.querySelectorAll('.mat-dock *')].filter(e => e.children.length === 0 && /^mat_[0-9a-f]{6}$/.test((e.textContent || '').trim())).map(e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top - 36]; }))`);
  const mats = JSON.parse(sw);
  if (mats.length > 5) { await move(mats[3][0], mats[3][1], 0.8); await click(); await hold(0.6); await move(mats[5][0], mats[5][1], 0.6); await click(); await hold(0.6); }
  const [cxm, cym] = await at(`[...document.querySelectorAll('button')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left > 1585 && r.left < 1640 && r.top > 700 && r.top < 800; }).pop()`);
  await move(cxm, cym, 0.7); await click(); await hold(0.4);
  // 5  the Library drawer
  [mx, my] = await at(byId('tg-library')); await move(mx, my, 0.8); await click(); await hold(0.7);
  const [fx, fy] = await at(byText('Fasteners')); await move(fx, fy, 0.7); await click(); await hold(0.8);
  const [nx, ny] = await at(byText('Nuts')); await move(nx, ny, 0.5); await click(); await hold(0.6);
  const [lx, ly] = await at(`[...document.querySelectorAll('button')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left > 1585 && r.left < 1640 && r.top > 700 && r.top < 800; }).pop()`);
  await move(lx, ly, 0.7); await click(); await hold(0.4);
  // 6  the command search
  [mx, my] = await at(byId('vp-cmdk')); await move(mx, my, 0.8); await click(); await hold(0.5);
  await typeText('fasten'); await hold(0.9);
  await key('Escape', 'Escape', 27); await hold(0.4);
  // back to where it began
  await move(1560, 930, 0.9); curOn = false; await hold(0.5);
  console.log('frames', frameNo, 'seconds', t().toFixed(2));
} catch (e) { console.log('ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill(); srv.kill();
if (STILL === null && frameNo > 10) {
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(FR, '%05d.jpg'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-pix_fmt', 'yuv420p', '-an', '-row-mt', '1', path.join(OUT, 'meshoptimiser-demo.webm')]);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', path.join(FR, '00000.jpg'), '-vf', 'scale=960:-1', '-quality', '85', path.join(OUT, 'meshoptimiser-demo_thumb.webp')]);
  console.log('wrote', path.join(OUT, 'meshoptimiser-demo.webm'));
}
process.exit(0);
