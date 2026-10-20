// node tests/e2e-animate-multi.mjs [model.glb]
//
// The Animate dock in headless Chrome: clips of one kind picked on the timeline (Shift+click) are edited together in the settings (the setting that is
// changed goes to all of them, the other settings of each clip stay), and the object rows of the timeline can be moved up and down.
// Needs the app served (python app/serve.py --no-browser --port 4343), APP_PORT for another port, Chrome and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9356, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-photo-pic-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4343) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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

  const lp = await call('list_parts', { sort_by: 'triangles', limit: 4 });
  const ids = JSON.parse(lp.text).parts.map(p => p.id);
  const list = async () => JSON.parse((await call('animate_parts', { action: 'list' })).text).animations;
  await call('animate_parts', { action: 'add', ids: [ids[0]], type: 'spin', axis: 'X', rpm: 30 });
  await call('animate_parts', { action: 'add', ids: [ids[1]], type: 'spin', axis: 'Y', rpm: 60 });
  await call('animate_parts', { action: 'add', ids: [ids[2]], type: 'swing' });
  check('three animated objects', (await list()).length === 3, (await list()).length);
  await call('select_parts', { ids: [ids[0]] });
  await evalJS("document.getElementById('tg-animate').click()"); await sleep(1500);
  const click = (sel, i, shift) => evalJS(`(() => { const r = [...document.querySelectorAll(${JSON.stringify(sel)})][${i}]; if (!r) return false; r.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: ${!!shift} })); return true; })()`);
  check('the first Spin clip is picked', await click('#vp-animate-pop .adk-lay[data-type="spin"]', 0, false)); await sleep(400);
  check('the second Spin clip is added with Shift', await click('#vp-animate-pop .adk-lay[data-type="spin"]', 1, true)); await sleep(500);
  const title = await evalJS("document.querySelector('#vp-animate-pop #anim-edit-h')?.textContent || ''");
  check('the settings say they are about 2 clips', /2 clips/.test(title), title);
  await evalJS(`(() => { const el = document.querySelector('#vp-animate-pop [data-p="spin.rpm"]'); el.value = 77; el.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(600);
  const spins = (await list()).flatMap(a => a.layers).filter(l => l.type === 'spin');
  check('the speed went to both clips', spins.length === 2 && spins.every(l => l.rpm === 77), spins.map(l => l.rpm));
  check('the axes of the two clips stayed as they were', spins.map(l => l.axis).sort().join('') === 'XY', spins.map(l => l.axis));

  // moving the rows: drag the first object below the last
  const order = () => evalJS("[...document.querySelectorAll('#vp-animate-pop #adk-rows .adk-obj[data-key]')].map(r => r.dataset.key)");
  const before = await order();
  const moved = await evalJS(`(async () => {
    const rows = [...document.querySelectorAll('#vp-animate-pop #adk-rows .adk-obj[data-key]')];
    const h = rows[0].querySelector('.adk-rh'), last = rows[rows.length - 1].getBoundingClientRect();
    const r0 = h.getBoundingClientRect(), x = r0.left + 20, y0 = r0.top + r0.height / 2, y1 = last.bottom + 30;
    h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y0, pointerId: 1 }));
    for (const y of [y0 + 8, (y0 + y1) / 2, y1]) document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
    const line = !!document.querySelector('#vp-animate-pop .adk-drop-before, #vp-animate-pop .adk-drop-after');
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y1, pointerId: 1 }));
    return line;
  })()`);
  await sleep(500);
  const after = await order();
  check('a line shows where the row goes while it is dragged', moved === true);
  check('the first object is last after the drag', after.length === before.length && after[after.length - 1] === before[0] && after[0] === before[1], { before, after });
  check('the animations are still all there', (await list()).length === 3);
  // an animation moved up inside its object
  await call('animate_parts', { action: 'add', ids: [ids[0]], type: 'swing' }); await sleep(500);
  const k0 = after[after.length - 1];
  const lays = () => evalJS(`[...document.querySelectorAll('#vp-animate-pop #adk-rows .adk-lay[data-lid]')].filter(r => r.dataset.key === ${JSON.stringify(k0)}).map(r => r.dataset.type)`);
  const l0 = await lays();
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('#vp-animate-pop #adk-rows .adk-lay[data-lid]')].filter(r => r.dataset.key === ${JSON.stringify(k0)});
    const h = rows[rows.length - 1].querySelector('.adk-rh'), up = rows[0].getBoundingClientRect(), r1 = h.getBoundingClientRect(), x = r1.left + 20, y0 = r1.top + r1.height / 2, y1 = up.top - 2;
    h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y0, pointerId: 1 }));
    for (const y of [y0 - 8, y1]) document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y1, pointerId: 1 }));
  })()`); await sleep(500);
  const l1 = await lays();
  check('an animation can be moved up inside its object', l0.length === 2 && l1.length === 2 && l1[0] === l0[1] && l1[1] === l0[0], { l0, l1 });
  check('no script error', errors.length === 0, errors.slice(0, 2));
} catch (e) { fail++; console.log('FAIL exception', e.message); }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
