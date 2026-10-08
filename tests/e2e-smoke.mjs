// node tests/e2e-smoke.mjs <folder for screenshots> [model, default inbox/Drive_Unit_DU-240.glb]
//
// Drives the real app in headless Chrome (software WebGL2, no window shown): loads a model through the file input, switches to
// the CAD view, orbits, opens Settings › Appearance and About, the Help window, and prints every JavaScript error. Needs the app
// served on http://localhost:4242 (python serve.py --no-browser --port 4242), Chrome installed (path below) and Node 22+.
// It cannot show WebGPU-only behaviour: on this path the renderer is WebGL2.
// Drives the real app in headless Chrome (software WebGL2): loads a model, switches views, screenshots, collects errors.
import { spawn } from 'child_process';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2];
const MODEL = process.argv[3] || 'inbox/Drive_Unit_DU-240.glb';
const PORT = 9333, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], consoleErr = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); console.log('screenshot', name); };
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
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErr.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 220));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:4242/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  console.log('app ready:', await evalJS("document.body.classList.contains('app-ready')"));
  await sleep(1500);
  await shot('0-start');
  await evalJS("document.getElementById('welcome-close')?.click()");
  // load a model through the app's own file input
  console.log('loading', MODEL);
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(MODEL.split('/').pop())}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) { console.log('tree rows:', n); break; } await sleep(500); }
  await sleep(4000);
  await shot('1-solid');
  const press = (k) => evalJS(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
  await press('6'); await sleep(5000);
  console.log('CAD button active:', await evalJS("document.getElementById('vw-cad')?.classList.contains('active')"));
  await shot('2-cad');
  // a few camera tilts in CAD: orbit with the real controls
  const drag = async (dx, dy) => { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 750, y: 450, button: 'left', buttons: 1, clickCount: 1 }); for (let s = 1; s <= 10; s++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 750 + dx * s / 10, y: 450 + dy * s / 10, button: 'left', buttons: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 750 + dx, y: 450 + dy, button: 'left', buttons: 0, clickCount: 1 }); await sleep(2500); };
  await drag(0, 90); await shot('3-cad-tilt-down');
  await drag(0, -190); await shot('4-cad-tilt-up');
  await press('1'); await sleep(2500);
  console.log('back to solid, CAD active:', await evalJS("document.getElementById('vw-cad')?.classList.contains('active')"));
  // the windows
  await evalJS("window.__openSettings('appearance')"); await sleep(800); await shot('5-settings-appearance');
  console.log('appearance swatches:', await evalJS("document.querySelectorAll('#set-pane-appearance .ap-sw').length"));
  await evalJS("document.querySelector('#set-pane-appearance .ap-sw[data-v=\"#ec5b98\"]')?.click()"); await sleep(400);
  console.log('accent after click:', await evalJS("getComputedStyle(document.documentElement).getPropertyValue('--ac').trim()"));
  await shot('6-settings-pink');
  await evalJS("window.__openSettings('about')"); await sleep(600); await shot('7-settings-about');
  await evalJS("document.getElementById('settings-close')?.click(); window.MOHelp.show()"); await sleep(1500); await shot('8-help');
} catch (e) { console.log('HARNESS ERROR:', e.message); }
console.log('page exceptions:', errors.length); errors.slice(0, 8).forEach(e => console.log('  ' + e));
console.log('console errors:', consoleErr.length); consoleErr.slice(0, 8).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(0);
