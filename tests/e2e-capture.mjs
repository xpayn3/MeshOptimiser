// node tests/e2e-capture.mjs [model]
//
// A picture of the view (Screenshot, render_image, the recent-file thumbnails) is drawn into a render target and read back from
// the GPU (_gpuCapture). Takes the same picture twice, once that way and once with the read-back made to fail (the old way: the
// live canvas resized for one frame), on the WebGL2 renderer and, where headless Chrome has it, on WebGPU. The two must match:
// same orientation, same tone mapping and colour (the read-back has to apply them itself), and the GPU path must not have fallen
// back. 1000 px wide on purpose: not a multiple of 64, which WebGPU's row padding needs handled. Needs the app on
// http://localhost:4242, Chrome, Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9347, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-capture-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// (CAPTURE_GPU=1: the machine's own GPU, where headless Chrome then has WebGPU; otherwise SwiftShader, WebGL2 only)
const GPU_FLAGS = process.env.CAPTURE_GPU === '1' ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader'];
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GPU_FLAGS, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], infos = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name, extra === undefined ? '' : JSON.stringify(extra)); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// in the page: take a picture with render_image and compare it with another
const PAGE_HELPERS = `
window.__capT = {
  async grab(w, h) {
    const r = await window.__moBridgeTools.render_image({ width: w, height: h, background: 'current', fit: false });
    const img = (r || []).find(x => x && x.type === 'image');
    if (!img || !img.data) throw new Error('render_image gave no picture: ' + JSON.stringify((r || []).map(x => x && x.type)));
    const blob = await (await fetch('data:' + (img.mimeType || 'image/png') + ';base64,' + img.data)).blob();
    const bm = await createImageBitmap(blob), c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d');
    x.drawImage(bm, 0, 0);
    return { w: bm.width, h: bm.height, d: x.getImageData(0, 0, bm.width, bm.height).data };
  },
  diff(a, b, flip) {
    if (a.w !== b.w || a.h !== b.h) return 999;
    let s = 0, n = 0;
    for (let y = 0; y < a.h; y += 2) for (let x = 0; x < a.w; x += 2) {
      const i = (y * a.w + x) * 4, j = ((flip ? a.h - 1 - y : y) * a.w + x) * 4;
      s += Math.abs(a.d[i] - b.d[j]) + Math.abs(a.d[i + 1] - b.d[j + 1]) + Math.abs(a.d[i + 2] - b.d[j + 2]); n += 3;
    }
    return s / n;
  },
  mean(a) { let s = 0; for (let i = 0; i < a.d.length; i += 4) s += a.d[i] + a.d[i + 1] + a.d[i + 2]; return s / (a.d.length / 4 * 3); },
  spread(a) { const m = this.mean(a); let s = 0; for (let i = 0; i < a.d.length; i += 16) { const v = (a.d[i] + a.d[i + 1] + a.d[i + 2]) / 3 - m; s += v * v; } return Math.sqrt(s / (a.d.length / 16)); },
  async run(w, h) {
    const R = window._appFns.renderer;
    const backend = R.backend && R.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    const gpu = await this.grab(w, h);
    const orig = R.readRenderTargetPixelsAsync;
    R.readRenderTargetPixelsAsync = () => Promise.reject(new Error('forced by the test'));
    let canvas;
    try { canvas = await this.grab(w, h); } finally { R.readRenderTargetPixelsAsync = orig; }
    return { backend, size: [gpu.w, gpu.h], diff: +this.diff(gpu, canvas, false).toFixed(2), diffFlipped: +this.diff(gpu, canvas, true).toFixed(2),
             meanGpu: +this.mean(gpu).toFixed(1), meanCanvas: +this.mean(canvas).toFixed(1), spreadGpu: +this.spread(gpu).toFixed(1) };
  },
};`;

async function oneBackend(webgl) {
  infos.length = 0;
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?' + (webgl ? 'webgl=1&' : '') + 't=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);
  await evalJS(PAGE_HELPERS);
  const want = webgl ? 'WebGL2' : 'WebGPU';
  const r = await evalJS('window.__capT.run(1000, 700)');
  if (r.backend !== want) { console.log('SKIP', want, '(headless Chrome gave ' + r.backend + ')'); return; }
  const fellBack = infos.filter(s => s.includes('[capture] GPU read-back failed') && !s.includes('forced by the test'));
  check(`${want}: the GPU read-back was used`, fellBack.length === 0, fellBack);
  check(`${want}: the comparison picture really came from the canvas path`, infos.some(s => s.includes('[capture] GPU read-back failed') && s.includes('forced by the test')));
  check(`${want}: the picture has the size asked for`, r.size[0] === 1000 && r.size[1] === 700, r.size);
  check(`${want}: the picture is not blank`, r.spreadGpu > 4, { spread: r.spreadGpu, mean: r.meanGpu });
  check(`${want}: the GPU picture matches the canvas one (orientation, tone mapping, colour)`, r.diff < 6 && r.diff < r.diffFlipped * 0.6, r);
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
  check('no uncaught errors', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  fail++; console.log('FAIL', e.message);
} finally {
  try { ws && ws.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
