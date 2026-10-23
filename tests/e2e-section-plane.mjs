// node tests/e2e-section-plane.mjs [model]   (SHOT=<folder> keeps the two pictures)
//
// Section view, stage 1: with it on, a plane cuts the parts (three r186's WebGPURenderer clips only inside a ClippingGroup) and the
// inside of the cut is drawn flat (a second pass of the back faces). Opens the model in headless Chrome on the WebGL2 renderer (and
// on WebGPU where Chrome has it, CAPTURE_GPU=1), takes the view as it is, with the section on and with it flipped, and checks that
// the picture changes, that the flat colour appears where the plane cuts, that switching it off gives the first picture back, and
// that nothing threw. Needs the app on http://localhost:4242, Chrome, Node 22+. The Chrome profile is deleted when it ends.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9351, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-section-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GPU_FLAGS = process.env.CAPTURE_GPU === '1' ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GPU_FLAGS, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], infos = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name, extra === undefined ? '' : JSON.stringify(extra)); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// a screenshot as numbers: how many pixels are the flat cut colour (a blue, 0x4f9dde before the tone mapping) and a hash of all of them (the canvas
// itself reads back blank: it is not kept once drawn, so the picture is the page's own screenshot). The flat colour is 0x4f9dde before
// the output tone mapping; the accent blue of the pill is more saturated and falls outside the range tested.
const READ = (b64, r, name, against) => `(async () => {
  const bm = await createImageBitmap(await (await fetch('data:image/png;base64,${b64}')).blob());
  const c = new OffscreenCanvas(${r.w}, ${r.h}), x = c.getContext('2d'); x.drawImage(bm, -${r.x}, -${r.y});
  const d = x.getImageData(0, 0, ${r.w}, ${r.h}).data; let flat = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] > 40 && d[i] < 125 && d[i + 1] > 120 && d[i + 1] < 195 && d[i + 2] > 190 && d[i + 2] < 248) flat++; sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007; }
  window.__pics = window.__pics || {}; window.__pics[${JSON.stringify(name)}] = d; let diff = 0; const e = window.__pics[${JSON.stringify(against || '')}];
  if (e) for (let i = 360 * ${r.w}; i < d.length; i += 4) if (Math.abs(d[i] - e[i]) + Math.abs(d[i + 1] - e[i + 1]) + Math.abs(d[i + 2] - e[i + 2]) > 24) diff++;      // (the first 90 rows are skipped: the notes banner fades out there)
  return { w: ${r.w}, h: ${r.h}, flat, sum, diff };
})()`;
const take = async (name, against) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (process.env.SHOT) { fs.mkdirSync(process.env.SHOT, { recursive: true }); fs.writeFileSync(path.join(process.env.SHOT, name + '.png'), Buffer.from(r.data, 'base64')); }
  const box = await evalJS("(() => { const b = document.querySelector('canvas').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; })()");
  return evalJS(READ(r.data, box, name, against));
};
async function oneBackend(webgl) {
  infos.length = 0;
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?' + (webgl ? 'webgl=1&' : '') + 't=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  for (let i = 0; i < 120; i++) { if (await evalJS("!document.body.innerText.includes('Parsing GLB')")) break; await sleep(500); }
  await sleep(3000);
  const backend = await evalJS("(() => { const R = window._appFns && window._appFns.renderer; return R && R.backend && R.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2'; })()");
  const want = webgl ? 'WebGL2' : 'WebGPU';
  if (backend !== want) { console.log('SKIP', want, '(headless Chrome gave ' + backend + ')'); return; }
  const tag = want + ': ';
  check(tag + 'the scene is a ClippingGroup that clips nothing yet', await evalJS("(() => { const g = window._appFns.state?.partsRoot || window.state?.partsRoot; return !!g && g.isClippingGroup === true && g.enabled === false; })()"));
  await sleep(600); const off = await take(want + '-0-off');
  check(tag + 'no flat cut colour before', off.flat < off.w * off.h * 0.002, { flat: off.flat });
  const sel = () => evalJS("(() => { const st = window._appFns.state || window.state; return st && st.selected ? st.selected.size : -1; })()");
  const click = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(300); };
  await click(700, 420);
  const picked = await sel();
  check(tag + '(control) the same click selects a part when the section is off', picked > 0, { selected: picked });
  await click(400, 800);      // (empty space: deselects)
  check(tag + 'Section view turns on', await evalJS("window.__moSectionPlane.set(true)") === true);
  await sleep(1200); const on = await take(want + '-1-on', want + '-0-off');
  check(tag + 'the picture changed', on.diff > on.w * on.h * 0.005, { diff: on.diff });
    // the app is locked: a click on a part selects nothing, the panels do not answer, the camera still moves
  const sel0 = await sel();
  await click(700, 420); await click(560, 400);
  check(tag + 'a click on a part selects nothing while the section is on', (await sel()) === sel0, { before: sel0, after: await sel() });
  check(tag + 'the panels are not dimmed or locked (Explode and the rest work)', await evalJS("['sidebar-right', 'sidebar-left', 'tb'].every(i => getComputedStyle(document.getElementById(i)).pointerEvents !== 'none' && getComputedStyle(document.getElementById(i)).opacity === '1')"));
  check(tag + 'the pill still answers', await evalJS("getComputedStyle(document.getElementById('vp-section-pill')).pointerEvents !== 'none'"));
  check(tag + 'the pill and the card are shown', await evalJS("!document.getElementById('vp-section-pill').hidden && !document.getElementById('vp-section-pop').hidden"));
  await evalJS("document.querySelector('#vp-section-pop [data-flip]').click()");
  await sleep(900); const fl = await take(want + '-2-flipped', want + '-0-off');
  check(tag + 'Flip keeps the other side, and its cut faces are the flat colour (seen from above)', fl.diff > fl.w * fl.h * 0.005 && fl.flat > fl.w * fl.h * 0.004, { diff: fl.diff, flat: fl.flat });
  const setEx = (v) => evalJS(`(() => { const r = document.querySelector('#explode-all-scrub .scrub-range'); if (!r) return false; r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); r.value = '${v}'; r.dispatchEvent(new Event('input', { bubbles: true })); window.dispatchEvent(new PointerEvent('pointerup')); r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  check(tag + 'Explode can be driven while the section is on', await setEx(40) === true);
  await sleep(1500);
  const ex = await take(want + '-2b-exploded', want + '-2-flipped');
  check(tag + 'the parts move apart and the cut faces go with them', ex.diff > ex.w * ex.h * 0.005 && ex.flat > ex.w * ex.h * 0.004, { diff: ex.diff, flat: ex.flat });
  await setEx(0); await sleep(1200);
  await evalJS("document.querySelector('#vp-section-pop [data-axis=\"x\"]').click()");
  await sleep(900); const ax = await take(want + '-3-x', want + '-2-flipped');
  check(tag + 'another axis cuts somewhere else', ax.diff > ax.w * ax.h * 0.005, { diff: ax.diff });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
  check(tag + 'Esc turns the section off', await evalJS('!window.__moSectionPlane.on'));
  await sleep(1200); const back = await take(want + '-4-off-again', want + '-0-off');
  check(tag + 'off again gives the first picture back (a few animated pixels aside)', back.diff < back.w * back.h * 0.003 && back.flat <= off.flat + 50, { diff: back.diff, flat: back.flat });
  check(tag + 'the pill and the card are gone', await evalJS("document.getElementById('vp-section-pill').hidden && document.getElementById('vp-section-pop').hidden"));
}

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
    else if (d.method === 'Runtime.consoleAPICalled') infos.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await oneBackend(true);
  await oneBackend(false);
  const gpuErrs = infos.filter(s => /GPU|validation|WebGPU/i.test(s) && /error|invalid/i.test(s));
  check('no uncaught errors', errors.length === 0, errors.slice(0, 5));
  check('no GPU errors logged', gpuErrs.length === 0, gpuErrs.slice(0, 3));
} catch (e) {
  fail++; console.log('FAIL', e.message);
} finally {
  try { ws && ws.close(); } catch (_) {}
  chrome.kill();
  await sleep(800);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}      // (these profiles filled the disk once: always delete)
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
