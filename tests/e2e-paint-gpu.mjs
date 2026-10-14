// scratch: car paint presets on spheres. node tests/e2e-paint.mjs [names...]
//
// A model that came without textures (an OBJ with texture coordinates but no .mtl) has its UVs put away at import. Giving its material a
// texture later must bring them back, or the texture shows nothing. Opens a small OBJ with UVs, checks the UVs are off the geometry, gives
// the material a checker texture, checks they are back and that the cube is drawn with the texture's colours.
// Needs the app served on http://localhost:4242 (python serve.py --no-browser --port 4242), Chrome installed and Node 22+.
// Needs the app served on http://localhost:4242 (python serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9356, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-paint-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, curId = ''; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
const sum = async () => (await call('scene_summary')).j;
const copies = () => evalJS(`new Promise((res) => { const r = indexedDB.open('mo-recovery', 1); r.onupgradeneeded = () => r.result.createObjectStore('snaps', { keyPath: 'key' }); r.onsuccess = () => { const q = r.result.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => { res(q.result.map(s => ({ name: s.name, parts: s.parts, size: s.size, unit: s.unit, up: s.up }))); r.result.close(); }; }; r.onerror = () => res(null); })`);
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  curId = target.id;
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
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  const NL = String.fromCharCode(10), out = [];
  const names = process.env.NAMES ? process.env.NAMES.split('|') : ['Metallic Silver', 'Pearl White', 'Candy Red', 'Flip-flop Violet / Green', 'Flip-flop Blue / Gold', 'Glitter Gold', 'Black Pearl'];
  const LAT = 40, LON = 64; let base = 0;
  names.forEach((nm, k) => {
    out.push('o s' + k);
    const cx = (k - (names.length - 1) / 2) * 2.4;
    for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) {
      const th = i / LAT * Math.PI, ph = j / LON * Math.PI * 2;
      const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
      out.push('v ' + (cx + nx).toFixed(5) + ' ' + ny.toFixed(5) + ' ' + nz.toFixed(5));
    }
    for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) out.push('vt ' + (j / LON).toFixed(5) + ' ' + (1 - i / LAT).toFixed(5));
    for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) {
      const th = i / LAT * Math.PI, ph = j / LON * Math.PI * 2;
      out.push('vn ' + (Math.sin(th) * Math.cos(ph)).toFixed(5) + ' ' + Math.cos(th).toFixed(5) + ' ' + (Math.sin(th) * Math.sin(ph)).toFixed(5));
    }
    const idx = (i, j) => base + i * (LON + 1) + j + 1;
    for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) {
      const a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1);
      out.push('f ' + a + '/' + a + '/' + a + ' ' + b + '/' + b + '/' + b + ' ' + c + '/' + c + '/' + c);
      out.push('f ' + a + '/' + a + '/' + a + ' ' + c + '/' + c + '/' + c + ' ' + d + '/' + d + '/' + d);
    }
    base += (LAT + 1) * (LON + 1);
  });
  await evalJS(`(async () => { const f = new File([${JSON.stringify(out.join(NL))}], 'spheres.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
  await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  for (let i = 0; i < 60; i++) { if (await evalJS("window.state && window.state.parts.length >= " + names.length).catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  console.log('parts', await evalJS("window.state.parts.length"), 'presets', await evalJS("window.__moMatPresets.filter(p => p.physical).length"));
  await evalJS("document.getElementById('tg-materials').click()"); await sleep(2500);
  for (let k = 0; k < names.length; k++) {
    await evalJS(`(() => { const st = window.state; const part = st.parts.find(p => p.name === 's${k}'); st.selected = new Set([part.partId]); const pr = window.__moMatPresets.find(p => p.name === ${JSON.stringify(names[k])}); window.__matNewFromPreset(pr); return true; })()`);
    await sleep(300);
  }
  if (process.env.ISO) await evalJS(`(async () => { const T = await import('three'); const ps = window.state.parts; const base = { color: 0xf2eee6, roughness: 0.38, metalness: 0.1, side: T.DoubleSide };
    const mk = [ () => new T.MeshStandardMaterial(base), () => new T.MeshPhysicalMaterial(base), () => new T.MeshPhysicalMaterial({ ...base, clearcoat: 1, clearcoatRoughness: 0.03 }),
      () => new T.MeshPhysicalMaterial({ ...base, sheen: 1, sheenRoughness: 0.4, sheenColor: new T.Color(0xffaa66) }), () => new T.MeshPhysicalMaterial({ ...base, iridescence: 0.5, iridescenceIOR: 1.6 }),
      () => { const m = new T.MeshPhysicalMaterial(base); const c = document.createElement('canvas'); c.width = c.height = 4; const x = c.getContext('2d'); x.fillStyle = '#8080ff'; x.fillRect(0, 0, 4, 4); const t = new T.Texture(c); t.needsUpdate = true; m.normalMap = t; return m; },
      () => new T.MeshPhysicalMaterial({ ...base, clearcoat: 1, sheen: 1, iridescence: 0.5 }) ];
    mk.forEach((f, k) => { ps.find(p => p.name === 's' + k).mesh.material = f(); }); return true; })()`);
  if (process.env.TWEAK) await evalJS(`(() => { const T = ${process.env.TWEAK}; const ps = window.state.parts; T.forEach((fn, k) => { const m = ps.find(p => p.name === 's' + k).mesh.material; (new Function('m', fn))(m); m.needsUpdate = true; }); return true; })()`);
  await evalJS("window.state.selected = new Set(); window.state.selectedGroupIds && window.state.selectedGroupIds.clear(); document.querySelector('#fit-btn, #tg-fit, [data-cmd=fit]')?.click(); true");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 });
  await sleep(2500);
  const info = await evalJS("window.state.parts.slice(0, 7).map(p => { const m = p.mesh.material; return [m.name, m.type, !!m.normalMap, m.clearcoat, m.sheen, m.iridescence].join('|'); })");
  console.log(JSON.stringify(info));
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 450, deltaX: 0, deltaY: 3 }); await sleep(3000);
  const sh = await send('Page.captureScreenshot', { format: 'png' }); (await import('fs')).writeFileSync((process.env.OUT || '.') + '/' + (process.env.NAME || 'paint') + '.png', Buffer.from(sh.data, 'base64'));
} catch (e) { console.log('HARNESS ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(0);
