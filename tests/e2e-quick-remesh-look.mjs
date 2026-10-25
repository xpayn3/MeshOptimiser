// node tests/e2e-quick-remesh-look.mjs [model, default inbox/GearboxAssy.glb]
//
// The quick remesh pill (B) as it looks: opened over a selected part it shows its levels round the pointer, the one under the pointer
// lit, the readout beside it; the wheel moves it a level at a time; Esc closes it and the part is as it was. SHOT=folder saves pictures
// of it (at the top, two levels down) and of the command wheel (Q) beside it, to compare their looks. Needs the app served on
// http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9367, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-qrlook-' + Date.now();
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

const shot = async (name, sel, pad = 40) => {
  if (!process.env.SHOT) return;
  const c = await evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.max(0, r.left - ${pad}), y: Math.max(0, r.top - ${pad}), width: r.width + ${pad * 2} + 160, height: r.height + ${pad * 2}, scale: 2 }; })()`);
  if (!c) return;
  fs.writeFileSync(path.join(process.env.SHOT, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: c })).data, 'base64'));
};
const key = async (k, code, vk, type = 'both') => { for (const t of type === 'both' ? ['keyDown', 'keyUp'] : [type]) await send('Input.dispatchKeyEvent', { type: t, key: k, code, windowsVirtualKeyCode: vk, ...(t === 'keyDown' && k.length === 1 ? { text: k } : {}) }); };

try {
  await attach();
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node[data-part-id]').length"); if (n > 5) break; await sleep(500); }
  await until("!document.getElementById('loader')?.classList.contains('show')", 120);
  await sleep(1000);
  const pid = await evalJS(`(() => { const ps = window.state.parts.filter(p => !p.deleted && p.mesh && p.mesh.geometry); ps.sort((a, b) => b.mesh.geometry.attributes.position.count - a.mesh.geometry.attributes.position.count);
    const row = document.querySelector('#tree .tree-node[data-part-id="' + ps[0].partId + '"]'); row?.scrollIntoView({ block: 'center' }); row?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return ps[0].partId; })()`);
  await sleep(500);
  const tris0 = await evalJS(`window.state.parts.find(p => p.partId === ${pid}).mesh.geometry.index.count / 3`);
  const vc = await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width * .45), y: Math.round(r.top + r.height * .45) }; })()");
  await mouse('mouseMoved', vc.x, vc.y, { buttons: 0 }); await sleep(150);

  await key('b', 'KeyB', 66, 'keyDown'); await sleep(450);
  check('B opens the pill over the selected part', await evalJS("!!document.querySelector('.qr.is-in')"));
  await shot('qr-top', '.qr');
  const lv0 = await evalJS("[...document.querySelectorAll('.qr-i')].findIndex(e => e.classList.contains('is-hot'))");
  for (let i = 0; i < 2; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: vc.x, y: vc.y, deltaX: 0, deltaY: 100 }); await sleep(i ? 70 : 260); if (i) await shot('qr-slide', '.qr'); }      // (the second step caught mid-slide)
  await sleep(600);
  const lv2 = await evalJS("[...document.querySelectorAll('.qr-i')].findIndex(e => e.classList.contains('is-hot'))");
  check('the wheel moves it two levels down', lv0 === 0 && lv2 === 2, { lv0, lv2 });
  await shot('qr-level2', '.qr');
  await key('Escape', 'Escape', 27, 'keyDown'); await key('b', 'KeyB', 66, 'keyUp'); await sleep(500);
  const tris1 = await evalJS(`window.state.parts.find(p => p.partId === ${pid}).mesh.geometry.index.count / 3`);
  check('Esc closes it and the part is as it was', !(await evalJS("!!document.querySelector('.qr.is-in')")) && tris1 === tris0, { tris0, tris1 });

  // the command wheel, to compare
  await mouse('mouseMoved', vc.x, vc.y, { buttons: 0 }); await sleep(150);
  await key('q', 'KeyQ', 81, 'keyDown'); await sleep(400);
  await mouse('mouseMoved', vc.x + 60, vc.y - 20, { buttons: 0 }); await sleep(300);
  await shot('q-wheel', '.qw, #quick-wand, .quick-wand, [class*="qw-root"]', 10);
  await key('Escape', 'Escape', 27, 'keyDown'); await key('q', 'KeyQ', 81, 'keyUp'); await sleep(300);
  // the colour wheel (hold C), to compare
  await mouse('mouseMoved', vc.x, vc.y, { buttons: 0 }); await sleep(150);
  await key('c', 'KeyC', 67, 'keyDown'); await sleep(500);
  await mouse('mouseMoved', vc.x + 30, vc.y - 25, { buttons: 0 }); await sleep(300);
  check('C opens the colour wheel', await evalJS("!!document.querySelector('#qc-wheel.show')"));
  await shot('qc-wheel', '#qc-wheel', 16);
  await key('Escape', 'Escape', 27, 'keyDown'); await key('c', 'KeyC', 67, 'keyUp');
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
