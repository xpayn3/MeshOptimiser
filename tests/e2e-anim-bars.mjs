// node tests/e2e-anim-bars.mjs [model, default inbox/GearboxAssy.glb]
//
// The Animate dock's settings: every slider is the app's fill-bar (input.range-bar, its number in the box joined to its end), not the
// old thin track with a round knob; and the settings pane is as wide as it is dragged by its edge, remembered, back to
// its own width on a double-click. SHOT=path saves a picture of the pane. Needs the app served on http://localhost:4242, Chrome, Node 22+.
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9360, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-animbars-' + Date.now();
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

const open = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node[data-part-id]').length"); if (n > 5) break; await sleep(500); }
  await until("!document.getElementById('loader')?.classList.contains('show')", 120);      // (the loading cover is over everything until the model is in)
  await sleep(1000);
  await evalJS("document.querySelector('#tree .tree-node[data-part-id]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true");
  await sleep(400);
  await evalJS("document.getElementById('tg-animate')?.click(); true");
  await until("document.getElementById('vp-animate-pop')?.classList.contains('show')", 20);
  await sleep(500);
  // a Noise animation on the part (the kind chosen, then the blue plus), so its settings show
  const NOISE = "document.querySelector('#vp-animate-pop .anim-props[data-for=\"noise\"]')?.offsetHeight > 0";
  await evalJS("document.querySelector('#vp-animate-pop .adk-insp [data-type=\"noise\"]')?.click(); true");
  await sleep(300);
  if (!(await evalJS(NOISE))) await evalJS("document.getElementById('adk-add')?.click(); true");
  await sleep(400);
  // (in the dock a clip's settings show while the clip is picked on the timeline: its row's head)
  const head = await evalJS(`(() => { const h = document.querySelector('#vp-animate-pop .adk-row[data-type="noise"] .adk-rh'); if (!h) return null; h.scrollIntoView({ block: 'nearest' }); const r = h.getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) }; })()`);
  if (head && !(await evalJS(NOISE))) { await mouse('mousePressed', head.x, head.y, { button: 'left', buttons: 1, clickCount: 1 }); await mouse('mouseReleased', head.x, head.y, { button: 'left', buttons: 0, clickCount: 1 }); }
  await until(NOISE, 20);
  await sleep(300);
};
const INSP_W = "Math.round(document.querySelector('#vp-animate-pop .adk-insp').getBoundingClientRect().width)";

try {
  await attach();
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evalJS("localStorage.removeItem('stepopt-anim-insp-w'); true").catch(() => {});
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await open();
  const bars = await evalJS(`(() => { const pane = document.querySelector('#vp-animate-pop .adk-insp .anim-props[data-for="noise"]'); if (!pane) return null;
    const rs = [...pane.querySelectorAll('input[type=range]')], shown = rs.filter(r => r.offsetWidth);
    const v = pane.querySelector('.anim-speed > .anim-v'), cs = v && getComputedStyle(v), r0 = shown[0] && getComputedStyle(shown[0]);
    return { all: rs.length, bars: rs.filter(r => r.classList.contains('range-bar')).length, shown: shown.length, h: shown[0]?.offsetHeight, boxH: v?.offsetHeight, boxBg: cs?.backgroundColor, text: v?.textContent }; })()`);
  check('every Noise slider is the fill-bar', bars && bars.all >= 6 && bars.bars === bars.all && bars.shown >= 6, bars);
  check('the bar is as tall as its number box, and the box is drawn', bars && bars.h >= 20 && Math.abs(bars.h - bars.boxH) <= 1 && bars.boxBg !== 'rgba(0, 0, 0, 0)', bars);
  const allBars = await evalJS("[...document.querySelectorAll('#vp-animate-pop .adk-insp input[type=range]')].every(r => r.classList.contains('range-bar'))");
  check('so is every slider of the other kinds of animation', allBars);
  if (process.env.SHOT) { const pic = await send('Page.captureScreenshot', { format: 'png', clip: await evalJS("(() => { const r = document.querySelector('#vp-animate-pop').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()") }); fs.writeFileSync(process.env.SHOT, Buffer.from(pic.data, 'base64')); }

  // the pane's width, by its edge
  const w0 = await evalJS(INSP_W);
  const gp = await evalJS("(() => { const r = document.getElementById('adk-insp-grip').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height }; })()");
  check('the pane has a grip on its edge', gp.w > 0 && gp.h > 50, gp);
  await mouse('mousePressed', gp.x, gp.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', gp.x - i * 12, gp.y, { button: 'left', buttons: 1 }); await sleep(16); }
  await mouse('mouseReleased', gp.x - 120, gp.y, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
  const w1 = await evalJS(INSP_W);
  check('dragging its edge 120 px to the left widens the pane by 120 px', Math.abs(w1 - (w0 + 120)) <= 1, { w0, w1 });

  // remembered: saved as the dock's other sizes are, and put back by the same helper when the app starts (a reload here would stop
  // at the browser's leave-the-page question, the scene having changed)
  const saved = await evalJS("+localStorage.getItem('stepopt-anim-insp-w')");
  check('the width is remembered', Math.abs(saved - w1) <= 1, { w1, saved });
  const gp2 = await evalJS("(() => { const r = document.getElementById('adk-insp-grip').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()");
  await mouse('mousePressed', gp2.x, gp2.y, { button: 'left', buttons: 1, clickCount: 1 }); await mouse('mouseReleased', gp2.x, gp2.y, { button: 'left', buttons: 0, clickCount: 1 });
  await mouse('mousePressed', gp2.x, gp2.y, { button: 'left', buttons: 1, clickCount: 2 }); await mouse('mouseReleased', gp2.x, gp2.y, { button: 'left', buttons: 0, clickCount: 2 });
  await sleep(300);
  const w3 = await evalJS(INSP_W);
  check('a double-click puts it back to its own width', Math.abs(w3 - w0) <= 1, { w0, w3 });
  // the sun gizmo (bottom-left of the view, shown with an HDRI) goes under the open dock, not over its buttons
  const sun = await evalJS(`(() => { const w = document.getElementById('sun-gizmo-wrap'); w.style.display = ''; const r = w.getBoundingClientRect(), d = document.getElementById('vp-animate-pop').getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2, over = x > d.left && x < d.right && y > d.top && y < d.bottom, top = document.elementFromPoint(x, y);
    w.style.display = 'none'; return { over, inDock: !!top?.closest('#vp-animate-pop'), inSun: !!top?.closest('#sun-gizmo-wrap') }; })()`);
  check('the sun gizmo goes under the open dock', sun.over && sun.inDock && !sun.inSun, sun);
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`
${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
