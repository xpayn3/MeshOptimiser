// node tests/e2e-cmd-card-grow.mjs [model.glb]
//
// A floating command card (Remove holes) is dragged up near the top of the view and its Advanced list is opened: the card grows, and its header must stay
// inside the view (it used to go past the top edge, out of reach). Needs the app served (python app/serve.py --no-browser --port 4343), APP_PORT, Chrome, Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9357, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-photo-pic-' + Date.now();
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

  await evalJS("document.getElementById('tg-fill-holes').click()"); await sleep(1200);
  const rect = () => evalJS("(() => { const s = document.querySelector('.vp-cmd-host .section-cmd:not([hidden])'); const v = document.getElementById('viewport').getBoundingClientRect(); if (!s) return null; const b = s.getBoundingClientRect(), h = s.querySelector('.section-h').getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), headTop: Math.round(h.top), vTop: Math.round(v.top), vBottom: Math.round(v.bottom), details: !!document.querySelector('#fh-adv[open]') }; })()");
  const r0 = await rect(); check('the Remove holes card is open', !!r0, r0);
  // drag it up by its header to the top of the view
  const g = await evalJS("(() => { const h = document.querySelector('.vp-cmd-host .section-cmd:not([hidden]) .section-h span'); const b = h.getBoundingClientRect(); return { x: b.x + 4, y: b.y + b.height / 2 }; })()");
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', clickCount: 1 });
  for (const f of [0.25, 0.5, 0.75, 1]) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y - (g.y - r0.vTop) * f, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x, y: 0, button: 'left', clickCount: 1 }); await sleep(500);
  const r1 = await rect(); check('the card now sits at the top of the view', r1 && r1.top - r1.vTop <= 12, r1);
  // open Advanced
  await evalJS("document.querySelector('#fh-adv > summary').click()"); await sleep(900);
  const r2 = await rect();
  check('Advanced is open and the card grew', r2.details && (r2.bottom - r2.top) > (r1.bottom - r1.top), { r1, r2 });
  check('the header of the card is still inside the view', r2.headTop >= r2.vTop && r2.top >= r2.vTop - 1, r2);
  check('no script error', errors.length === 0, errors.slice(0, 2));
} catch (e) { fail++; console.log('FAIL exception', e.message); }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
