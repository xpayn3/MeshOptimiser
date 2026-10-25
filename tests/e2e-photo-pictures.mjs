// node tests/e2e-photo-pictures.mjs [model.glb]
//
// Claude's pictures in Photo mode (headless Chrome): the screenshot and render_image tools take photo_mode. Opens a model, takes a plain
// screenshot and one with photo_mode, checks that the two differ, that Photo mode is off again afterwards (switch, body class, background,
// shadows), that render_image with photo_mode returns a picture and refuses a plain background, and that a screenshot without the option
// is as before. Needs the app served (python app/serve.py --no-browser --port 4343), APP_PORT for another port, Chrome and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9353, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-photo-pic-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4343) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
// one tool call: the kinds of what came back, its text, and a short fingerprint of the picture
const call = (name, args) => evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; const r = await f(${JSON.stringify(args)}); const img = r.find(x => x.type === 'image'); return { ok: true, text: r.filter(x => x.type === 'text').map(x => x.text).join(' '), img: img ? img.data.length : 0, sig: img ? img.data.slice(2000, 2400) : '', data: img ? img.data : '' }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
const state = () => evalJS(`({ photo: document.getElementById('toggle-photo').checked, cls: document.body.classList.contains('photo-mode'), bg: document.getElementById('bg-mode').value, shadows: document.getElementById('toggle-shadows').checked })`);
// the share of dark pixels and the mean brightness of a picture (a photo with its vignette is darker at the rim than the plain view)
const stats = (b64, mime) => evalJS(`(async () => { const img = new Image(); img.src = 'data:${mime};base64,${b64}'; await img.decode(); const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 160, 90); const d = x.getImageData(0, 0, 160, 90).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return Math.round(s / (d.length / 4 * 3)); })()`);
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

  const before = await state();
  check('Photo mode starts off', before.photo === false && before.cls === false, before);
  const plain = await call('screenshot', { width: 800, frame: 'model' });
  check('a plain screenshot returns a picture', plain.ok && plain.img > 1000 && !/Photo mode/.test(plain.text), plain.e || plain.text);
  const photo = await call('screenshot', { width: 800, frame: 'model', photo_mode: true });
  check('a screenshot with photo_mode returns a picture that says so', photo.ok && photo.img > 1000 && /in Photo mode/.test(photo.text), photo.e || photo.text);
  check('and it is not the same picture', photo.ok && plain.ok && photo.sig !== plain.sig, { a: plain.img, b: photo.img });
  const mp = photo.ok ? await stats(photo.data, 'image/png') : -1, mq = plain.ok ? await stats(plain.data, 'image/png') : -1;
  console.log('mean brightness: plain', mq, 'photo', mp);
  const after = await state();
  check('Photo mode is off again, the background and shadows are as they were', after.photo === before.photo && after.cls === false && after.bg === before.bg && after.shadows === before.shadows, { before, after });
  const again = await call('screenshot', { width: 800, frame: 'model' });
  check('a screenshot without the option is a plain one again', again.ok && !/Photo mode/.test(again.text) && again.sig === plain.sig, again.e || { a: again.img, b: plain.img });

  const ri = await call('render_image', { width: 640, height: 360, photo_mode: true, save: false, preview: true });
  check('render_image with photo_mode returns a picture', ri.ok && ri.img > 1000, ri.e || ri.text);
  check('and leaves Photo mode off', (await state()).cls === false);
  const bad = await call('render_image', { width: 640, height: 360, photo_mode: true, background: 'white', save: false });
  check('render_image with photo_mode and a plain background is refused, in words', bad.ok === false && /own background/.test(bad.e || ''), bad);
  check('and leaves Photo mode off after the refusal', (await state()).cls === false);
  const plainRi = await call('render_image', { width: 640, height: 360, save: false, preview: true });
  check('render_image without the option still works', plainRi.ok && plainRi.img > 1000, plainRi.e);
  check('no script error was thrown', errors.length === 0, errors.slice(0, 2));
} catch (e) { fail++; console.log('FAIL exception', e.message); }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
