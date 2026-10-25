// node tests/e2e-photo-average.mjs [model.glb]
//
// Photo mode averages the frames of a still view (photo.js: each frame moved by a fraction of a pixel, the occlusion's noise and the
// depth of field's spiral turned, the sun moved a little for a soft shadow edge). Checks: the average builds up to the quality preset's
// number of frames and then the view stops drawing; moving the camera starts it again; every look (Neutral, AgX, ACES) draws a whole
// picture; Draft averages nothing; nothing is thrown or logged as an error. Reads window.__moPhoto (frames, refining, on).
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9398, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-photo-average-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], logs = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const waitFor = async (expr, ms = 20000) => { for (let t = 0; t < ms; t += 200) { if (await evalJS(expr).catch(() => false)) return true; await sleep(200); } return false; };
const frames = () => evalJS('window.__moPhoto.frames');
// (a slow graphics path, software WebGL at a second a frame, takes half a minute to add up 32 frames; a quick one returns at once)
const settled = (n) => waitFor(`window.__moPhoto.frames >= ${n} && !window.__moPhoto.refining`, 120000);
// the share of pixels that differ from the corner colour, and the mean brightness, of what is on screen (as e2e-photo.mjs)
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
const select = (id, value) => evalJS(`(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
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
    else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
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
  check('the photo hook is there (window.__moPhoto)', await evalJS('!!window.__moPhoto && typeof window.__moPhoto.frames === "number"'));

  logs.length = 0; errors.length = 0;
  await evalJS(`(() => { const t = document.getElementById('toggle-photo'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  check('Photo mode switches on', await waitFor("window.__moPhoto.on && document.body.classList.contains('photo-mode') && !document.getElementById('photo-loading').classList.contains('show')", 40000));
  const q = await evalJS("document.getElementById('photo-quality').value");
  check('the quality preset is Best to begin with', q === 'best', q);
  check('the average of the still view reaches 32 frames', await settled(32), await frames());
  await sleep(800);
  const idle = await evalJS('({ frames: window.__moPhoto.frames, refining: window.__moPhoto.refining, needs: !!window.state.needsRender, active: window.state.activeFrames | 0 })');
  check('then the view stops drawing (nothing more is asked for)', idle.frames === 32 && !idle.refining && !idle.needs && idle.active === 0, idle);
  const p0 = await probe();
  check('the averaged picture is a whole picture', p0.differ > 0.02 && p0.mean > 5, p0);

  // a camera move starts the average again, and it builds up again
  await evalJS(`(async () => { await window.__moBridgeTools.set_camera_view({ view: 'front' }); return true; })()`);
  check('moving the camera starts the average again', await waitFor('window.__moPhoto.frames < 32', 4000), await frames());
  check('and it builds up to 32 again', await settled(32), await frames());

  // the looks: each draws a whole picture once its average is done
  for (const look of ['agx', 'aces', 'neutral']) {
    await select('photo-look', look);
    await sleep(300);
    const done = await settled(32);
    const p = await probe();
    check(`the ${look} look draws a whole picture`, done && p.differ > 0.02 && p.mean > 5, { done, frames: await frames(), p });
  }

  // Draft: one frame, nothing averaged
  await select('photo-quality', 'draft');
  await sleep(1500);
  const draft = await evalJS('({ frames: window.__moPhoto.frames, refining: window.__moPhoto.refining })');
  check('Draft draws one frame and averages nothing', draft.frames === 1 && !draft.refining, draft);
  await select('photo-quality', 'best');
  check('back on Best it averages 32 again', await settled(32), await frames());

  check('no exceptions', errors.length === 0, errors.slice(0, 5));
  check('no shader, pipeline or WebGPU errors logged', !logs.some(l => /error|invalid|failed|shader|pipeline|wgsl|glsl/i.test(l)), logs.slice(0, 6));
} catch (e) { fail++; console.log('FAIL exception', e.message); }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
