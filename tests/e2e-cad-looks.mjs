// node tests/e2e-cad-looks.mjs [model, default inbox/GearboxAssy.glb]
//
// How light the CAD view's looks are. The model is drawn in the plain view and in each CAD look (Ceramic, Light, Mono), and from a
// picture of the view the model's pixels (those that differ from the background) are measured: their average lightness, the share that
// is nearly black (under 15 %), and the lightest tenth (the floor grid is off, so its lines are not counted). A CAD look is matte shading for working in, so it must not be darker than the
// plain view nor leave more of the model in near-black than
// the plain view does (the model's own black parts and the edge lines). SHOT=folder saves the pictures. Needs the app served on
// http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9363, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-cadlooks-' + Date.now();
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

// a picture of the view; the model's pixels measured in the page (lightness 0..1, sRGB luma)
const measure = async (name) => {
  const clip = await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()");
  const pic = await send('Page.captureScreenshot', { format: 'png', clip });
  if (process.env.SHOT) fs.writeFileSync(path.join(process.env.SHOT, 'cad-' + name + '.png'), Buffer.from(pic.data, 'base64'));
  return evalJS(`new Promise((res) => { const im = new Image(); im.onload = () => {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data, W = c.width;
    const bgAt = (px, py) => { const i = (py * W + px) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const bgs = [bgAt(4, 4), bgAt(W - 5, 4), bgAt(4, c.height - 5), bgAt(W - 5, c.height - 5)];
    const ls = [];
    for (let i = 0; i < d.length; i += 4 * 3) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (bgs.some(q => Math.abs(q[0] - r) + Math.abs(q[1] - g) + Math.abs(q[2] - b) < 14)) continue;
      ls.push((0.299 * r + 0.587 * g + 0.114 * b) / 255);
    }
    ls.sort((a, b) => a - b);
    const mean = ls.reduce((a, b) => a + b, 0) / Math.max(1, ls.length);
    res({ px: ls.length, mean: +mean.toFixed(3), dark: +(ls.filter(v => v < 0.15).length / Math.max(1, ls.length)).toFixed(3), p90: +(ls[Math.floor(ls.length * 0.9)] || 0).toFixed(3), p10: +(ls[Math.floor(ls.length * 0.1)] || 0).toFixed(3) });
  }; im.src = 'data:image/png;base64,${pic.data}'; })`);
};
const look = async (kind, lk) => {
  await evalJS(`(() => { const b = document.querySelector('.shade-sw[data-kind="${kind}"][data-look="${lk}"]'); if (!b) return false; if (!b.classList.contains('is-on')) b.click(); return true; })()`);
  await sleep(1500);
};

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
  await sleep(2500);
  check('the Shading card has the three CAD looks', (await evalJS("document.querySelectorAll('.shade-sw[data-kind=\"cad\"]').length")) === 3);

  // (the floor grid's lines would count as the model's pixels: off while measuring)
  await evalJS("(() => { const g = document.getElementById('toggle-grid'); if (g && g.checked) g.click(); return true; })()");
  await sleep(300);
  await look('solid', 'default');
  const plain = await measure('plain');
  console.log('  plain view', JSON.stringify(plain));
  const res = {};
  for (const lk of ['ceramic', 'light', 'mono']) {
    await look('cad', lk);
    res[lk] = await measure(lk);
    console.log('  CAD ' + lk.padEnd(8), JSON.stringify(res[lk]));
  }
  for (const lk of ['ceramic', 'light', 'mono']) {
    const r = res[lk];
    // (CAD view draws a dark line on every edge, which the plain view has not: so within a margin of it, not above it. The looks were 0.22
    // to 0.34 against 0.44 before they were made lighter.)
    check(`CAD ${lk}: about as light as the plain view (within 0.1)`, r.mean >= plain.mean - 0.1, { mean: r.mean, plain: plain.mean });
    check(`CAD ${lk}: no more of the model nearly black than in the plain view (its black parts and lines)`, r.dark <= plain.dark + 0.05, { dark: r.dark, plain: plain.dark });
    check(`CAD ${lk}: its lightest tenth is light (over 0.7)`, r.p90 > 0.7, { p90: r.p90 });
  }
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
