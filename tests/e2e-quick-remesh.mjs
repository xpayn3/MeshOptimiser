// node tests/e2e-quick-remesh.mjs [model, default inbox/GearboxAssy.glb]
//
// Quick remesh (B) in the real app, smart against plain: the same level on the same model, compared by the triangles that are left, how
// many of them are slivers (the fans a plain reduction leaves on flat faces), and how far the surface area moved. Needs the app served on
// http://localhost:4242 (python serve.py --no-browser --port 4242), Chrome installed and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9351, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-undomem-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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



const metrics = () => evalJS(`(() => {
  const st = window.state; let tris = 0, sliver = 0, area = 0, bad = 0, n = 0;
  for (const p of st.parts) { if (p.deleted || !p.mesh || !st.selected.has(p.partId)) continue; const g = p.mesh.geometry, pos = g.attributes.position, ix = g.index ? g.index.array : null; const T = (ix ? ix.length : pos.count) / 3; n++;
    for (let t = 0; t < T; t++) { const a = ix ? ix[t * 3] : t * 3, b = ix ? ix[t * 3 + 1] : t * 3 + 1, c = ix ? ix[t * 3 + 2] : t * 3 + 2;
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a), bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b), cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
      const e = [Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - bx, cy - by, cz - bz), Math.hypot(ax - cx, ay - cy, az - cz)];
      const A = Math.hypot((by - ay) * (cz - az) - (bz - az) * (cy - ay), (bz - az) * (cx - ax) - (bx - ax) * (cz - az), (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
      area += A; tris++;
      // the smallest angle through the sine law: sin(angle opposite the shortest edge) = 2A / (e1 * e2)
      const s = [...e].sort((x, y) => x - y); const sinMin = s[0] > 0 && s[1] > 0 ? Math.min(1, 2 * A / (s[1] * s[2])) : 0; if (Math.asin(sinMin) < 10 * Math.PI / 180) sliver++; } }
  return { parts: n, tris, sliver, area }; })()`);
const level = async (i) => {
  await evalJS('window.__moQuickRemesh.toggle()');
  await sleep(800);
  await evalJS(`window.__moQuickRemesh.level(${i})`);
  for (let k = 0; k < 240; k++) { await sleep(500); const busy = await evalJS("!!document.querySelector('.qr.is-busy')"); const shown = await evalJS('window.__moQuickRemesh.shown()'); if (!busy && shown === i) break; }
  await sleep(1500);
};
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);
  await call('select_all');
  const base = await metrics();
  console.log('   the model        ', JSON.stringify(base));
  check('a model is selected', base.tris > 1000, base);
  const LV = +(process.env.LEVEL || 4);      // 4 = 25 %
  const res = {};
  for (const mode of ['plain', 'smart']) {
    await evalJS(`window.__moQuickPlain = ${mode === 'plain'}; true`);
    const t0 = Date.now();
    await level(LV);
    res[mode] = await metrics();
    res[mode].ms = Date.now() - t0;
    console.log('   ' + mode.padEnd(6) + ' level ' + LV + ' ', JSON.stringify(res[mode]));
    await evalJS('window.__moQuickRemesh.cancel()');
    await sleep(800);
  }
  const back = await metrics();
  check('cancelling puts the model back', back.tris === base.tris, [back.tris, base.tris]);
  const ratio = (m) => m.sliver / Math.max(1, m.tris);
  console.log('   slivers: plain ' + (ratio(res.plain) * 100).toFixed(1) + ' %, smart ' + (ratio(res.smart) * 100).toFixed(1) + ' %');
  check('both reduced the model', res.plain.tris < base.tris * 0.6 && res.smart.tris < base.tris * 0.6, [base.tris, res.plain.tris, res.smart.tris]);
  check('smart keeps about the share that was asked for (not under half of it)', res.smart.tris >= base.tris * 0.25 * 0.5, [res.smart.tris, base.tris * 0.25]);
  check('smart leaves fewer slivers than plain', ratio(res.smart) < ratio(res.plain), [ratio(res.plain), ratio(res.smart)]);
  check('smart moved the surface area no more than plain does (+2 %)', Math.abs(res.smart.area / base.area - 1) <= Math.abs(res.plain.area / base.area - 1) + 0.02, [res.plain.area / base.area, res.smart.area / base.area]);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
