// node tests/e2e-dof.mjs [model.glb] [shot-prefix]
//
// Photo mode's depth of field in the real app in headless Chrome.
//   Depth of field: switched on in Photo mode it draws at every quality; Ctrl+click on the model sets the focus (the Focus row names the
//   part) without selecting anything; Pick then a plain click does the same and selects nothing; Pivot goes back to the orbit pivot.
// Needs the app served on http://localhost:4343 (python app/serve.py --no-browser --port 4343), or another port in APP_PORT.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb', SHOT = process.argv[3];
const PORT = 9353, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-dof-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4343) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], logs = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const bad = () => logs.filter(l => /invalid|shader|wgsl|glsl|pipeline|error/i.test(l));
const probe = async () => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  return evalJS(`(async () => {
    const img = new Image(); img.src = 'data:image/png;base64,${r.data}'; await img.decode();
    const c2 = document.createElement('canvas'); c2.width = 200; c2.height = 120;
    const x = c2.getContext('2d'); x.drawImage(img, 0, 0, 200, 120);
    const d = x.getImageData(0, 0, 200, 120).data; let sum = 0, n = 0, differ = 0;
    for (let i = 0; i < d.length; i += 4) { sum += d[i] + d[i + 1] + d[i + 2]; n++; if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 30) differ++; }
    return { mean: Math.round(sum / (n * 3)), differ: Math.round(1000 * differ / n) / 1000 };
  })()`);
};
const shot = async (suffix) => { if (!SHOT) return; const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(SHOT + suffix + '.png', Buffer.from(r.data, 'base64')); console.log('picture:', SHOT + suffix + '.png'); };
const click = async (x, y, mods = 0) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: mods });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, modifiers: mods });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers: mods });
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
    else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 600));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 120; i++) { const n = await evalJS("document.querySelectorAll('#tree .row, #tree [data-uuid]').length").catch(() => 0); if (n > 0) break; await sleep(500); }
  await sleep(2500);
  // the canvas centre, where the model is after opening
  const C = await evalJS(`(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);

  // ── Depth of field ──
  logs.length = 0; errors.length = 0;
  await evalJS(`(() => { const t = document.getElementById('toggle-photo'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(6000);
  for (let i = 0; i < 30 && await evalJS("document.getElementById('photo-loading').classList.contains('show')"); i++) await sleep(500);
  check('Photo mode is on', await evalJS("document.body.classList.contains('photo-mode')"));
  check('depth of field starts off', await evalJS("!document.getElementById('photo-fx-dof').checked && document.getElementById('photo-row-dof').classList.contains('is-off')"));
  await evalJS(`(() => { const t = document.getElementById('photo-fx-dof'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); const e = document.getElementById('photo-dof'); e.value = 100; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(3000);
  const d1 = await probe();
  check('depth of field draws', d1.differ > 0.02 && d1.mean > 2, d1);
  check('no exceptions or shader errors with depth of field', errors.length === 0 && bad().length === 0, { errors, logs: bad().slice(0, 4) });
  check('the Focus row starts on the orbit pivot', await evalJS("document.getElementById('photo-focus-val').textContent === 'Orbit pivot' && document.getElementById('photo-focus-reset').disabled"));
  const sel0 = await evalJS("(window.state ? window.state.selected.size : document.querySelectorAll('#tree .selected').length)");
  await click(C.x, C.y, 2);                              // Ctrl+click (CDP modifier bit 2; Alt was the key before the lens rings)
  await sleep(1500);
  const f1 = await evalJS("document.getElementById('photo-focus-val').textContent");
  check('Ctrl+click on the model sets the focus', f1 !== 'Orbit pivot' && !(await evalJS("document.getElementById('photo-focus-reset').disabled")), f1);
  check('Ctrl+click selects nothing', (await evalJS("(window.state ? window.state.selected.size : document.querySelectorAll('#tree .selected').length)")) === sel0);
  await shot('-dof');
  await evalJS("document.getElementById('photo-focus-reset').click()");
  await sleep(500);
  check('Pivot puts the focus back on the orbit pivot', await evalJS("document.getElementById('photo-focus-val').textContent === 'Orbit pivot'"));
  await evalJS("document.getElementById('photo-focus-pick').click()");
  check('Pick arms the next click', await evalJS("document.getElementById('photo-focus-pick').classList.contains('active') && document.getElementById('canvas').style.cursor === 'crosshair'"));
  await click(C.x, C.y, 0);
  await sleep(1500);
  check('a click after Pick sets the focus and disarms', (await evalJS("document.getElementById('photo-focus-val').textContent")) !== 'Orbit pivot' && !(await evalJS("document.getElementById('photo-focus-pick').classList.contains('active')")));
  check('the click after Pick selects nothing', (await evalJS("(window.state ? window.state.selected.size : document.querySelectorAll('#tree .selected').length)")) === sel0);
  for (const q of ['draft', 'good', 'max', 'best']) {
    await evalJS(`(() => { const t = document.getElementById('photo-quality'); t.value = '${q}'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(2500);
    const pq = await probe();
    check('depth of field at quality ' + q + ' draws', pq.differ > 0.02 && pq.mean > 2, pq);
  }
  check('no errors across qualities', errors.length === 0 && bad().length === 0, { errors, logs: bad().slice(0, 4) });
  await evalJS(`(() => { const t = document.getElementById('toggle-photo'); t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(2000);
  const p3 = await probe();
  check('the plain viewport draws again', p3.differ > 0.02, p3);
} catch (e) { fail++; console.log('FAIL exception', e.message); }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
