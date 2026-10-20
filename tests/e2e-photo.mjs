// node tests/e2e-photo.mjs [model.glb] [shot.png]
//
// Photo mode in the real app in headless Chrome: opens a model, switches Photo mode on, checks that the post-processing chain draws (the
// canvas is not blank, nothing throws, no shader or pipeline errors are logged), that the effects sliders and Save photo work, takes a
// picture (optional second argument), then switches it off and checks the viewport is back as it was (grid, shadows, background).
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb', SHOT = process.argv[3];
const PORT = 9352, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-photo-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], logs = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
// the share of pixels that differ from the corner colour, and the mean brightness, of what is on screen (a blank or black view shows up in
// both). Read from a screenshot: a WebGL canvas cannot be read back with drawImage once it has been presented.
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
    else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, process.env.FULL_LOG ? 6000 : 300));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 120; i++) { const n = await evalJS("document.querySelectorAll('#tree .row, #tree [data-uuid]').length").catch(() => 0); if (n > 0) break; await sleep(500); }
  await sleep(2500);
  const before = await evalJS(`({ bg: document.getElementById('bg-mode').value, shadows: document.getElementById('toggle-shadows').checked, photo: document.getElementById('toggle-photo') ? document.getElementById('toggle-photo').checked : null })`);
  check('the Photo mode switch is in the page and off', before.photo === false, before);
  check('the effects section is inert (cannot be used) while Photo mode is off', await evalJS("document.getElementById('photo-fx').inert === true && document.getElementById('photo-fx').classList.contains('is-off')"));
  const p0 = await probe();
  check('the model is drawn before', p0.differ > 0.02, p0);

  // the sun's shadows alone first, so that a shader error can be told from one of the existing shadows
  logs.length = 0;
  await evalJS(`(() => { const t = document.getElementById('toggle-shadows'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(3000);
  console.log('shadows alone, logged errors:', logs.length, logs.slice(0, 1).join('').slice(0, 160));
  await evalJS(`(() => { const t = document.getElementById('toggle-shadows'); t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(2500);
  logs.length = 0; errors.length = 0;
  await evalJS(`(() => { const t = document.getElementById('toggle-photo'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(60);
  check('right after the switch the loading card with the spinner is shown in the view', await evalJS("(() => { const c = document.getElementById('photo-loading'); return !!c && c.classList.contains('show') && !!c.querySelector('.spinner') && /loading/i.test(c.textContent); })()"));
  await sleep(6000);                                   // (the loft HDRI is fetched and prefiltered; the chain's shaders are compiled)
  for (let i = 0; i < 30 && await evalJS("document.getElementById('photo-loading').classList.contains('show')"); i++) await sleep(500);
  check('the loading card is gone once Photo mode is on', await evalJS("!document.getElementById('photo-loading').classList.contains('show') && document.body.classList.contains('photo-mode')"));
  check('the effects can be used while Photo mode is on (not inert)', await evalJS("!document.getElementById('photo-fx').inert"));
  const on = await evalJS(`({ bg: document.getElementById('bg-mode').value, shadows: document.getElementById('toggle-shadows').checked, ctl: document.getElementById('photo-fx').classList.contains('is-off') ? 'off' : 'on', cls: document.body.classList.contains('photo-mode') })`);
  if (!on.cls) console.log('toasts:', await evalJS(`Array.from(document.querySelectorAll('[class*=toast]')).map(e => e.textContent).join(' | ').slice(0, 400)`), 'logs:', JSON.stringify(logs.slice(0, 3)).slice(0, 600), 'errors:', JSON.stringify(errors));
  check('Photo mode lights with an HDRI, turns the shadows on and undims its card', on.bg === 'hdri' && on.shadows && on.ctl === 'on' && on.cls, on);
  const p1 = await probe();
  check('the post-processed picture is not blank', p1.differ > 0.02 && p1.mean > 5, p1);
  check('no exceptions while it draws', errors.length === 0, errors);
  check('no shader or pipeline errors logged', !logs.some(l => /error|invalid|failed|shader|pipeline|wgsl|glsl/i.test(l)), logs.slice(0, 6));

  for (const k of ['ao', 'glow', 'fringe', 'vignette', 'grain']) {
    await evalJS(`(() => { const e = document.getElementById('photo-${k}'); e.value = 100; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  await sleep(1500);
  const p2 = await probe();
  check('all effects at full still draw', p2.differ > 0.02 && p2.mean > 2, p2);
  check('no errors with the effects at full', errors.length === 0 && !logs.some(l => /invalid|shader|wgsl|glsl/i.test(l)), { errors, logs: logs.slice(0, 6) });

  // the floor disc can be switched off and on
  await evalJS(`(() => { const t = document.getElementById('photo-stage'); t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(1200);
  const stageOff = await probe();
  await evalJS(`(() => { const t = document.getElementById('photo-stage'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(1200);
  check('the floor disc switch works and the picture still draws', stageOff.differ > 0.02, stageOff);
  // each effect off, one after the other, and every quality: the chain is rebuilt each time and still draws
  for (const k of ['ao', 'glow', 'fringe', 'vignette', 'grain']) {
    await evalJS(`(() => { const t = document.getElementById('photo-fx-${k}'); t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  await sleep(2500);
  const pOff = await probe();
  check('every effect off still draws (plain multisampled picture)', pOff.differ > 0.02 && pOff.mean > 2, pOff);
  for (const k of ['ao', 'glow', 'fringe', 'vignette', 'grain']) {
    await evalJS(`(() => { const t = document.getElementById('photo-fx-${k}'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  for (const q of ['draft', 'good', 'max', 'best']) {
    await evalJS(`(() => { const t = document.getElementById('photo-quality'); t.value = '${q}'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(2500);
    const pq = await probe();
    check('quality ' + q + ' draws', pq.differ > 0.02 && pq.mean > 2, pq);
  }
  check('no errors across switches and qualities', errors.length === 0 && !logs.some(l => /invalid|shader|wgsl|glsl|error/i.test(l)), { errors, logs: logs.slice(0, 4) });
  if (process.env.FULL_LOG) console.log('ALL LOGS:', JSON.stringify(logs));
  if (SHOT) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(SHOT, Buffer.from(r.data, 'base64')); console.log('picture:', SHOT); }

  await evalJS(`document.getElementById('photo-save').click()`);
  await sleep(2500);
  const toasts = await evalJS(`Array.from(document.querySelectorAll('.toast, [class*=toast]')).map(e => e.textContent).join(' | ').slice(0, 300)`);
  check('Save photo reports a saved picture', /Saved \d+ × \d+/.test(toasts), toasts);

  await evalJS(`(() => { const t = document.getElementById('toggle-photo'); t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(2500);
  const off = await evalJS(`({ bg: document.getElementById('bg-mode').value, shadows: document.getElementById('toggle-shadows').checked, ctl: document.getElementById('photo-fx').classList.contains('is-off') ? 'off' : 'on', cls: document.body.classList.contains('photo-mode') })`);
  check('switching it off puts the background, shadows and panel back', off.bg === before.bg && off.shadows === before.shadows && off.ctl === 'off' && !off.cls, { before, off });
  const p3 = await probe();
  check('the plain viewport draws again', p3.differ > 0.02, p3);
} catch (e) { fail++; console.log('FAIL exception', e.message); }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
