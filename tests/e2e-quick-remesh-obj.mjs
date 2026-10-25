// node tests/e2e-quick-remesh-obj.mjs
//
// Quick remesh (B) on an OBJ: its mesh comes without an index (three corners to a triangle), and it must be reduced all the same, and
// put back by Esc. Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9351, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-undomem-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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
  const LAT = 60, LON = 96;
  for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) { const th = i / LAT * Math.PI, ph = j / LON * Math.PI * 2; out.push('v ' + (Math.sin(th) * Math.cos(ph)).toFixed(5) + ' ' + Math.cos(th).toFixed(5) + ' ' + (Math.sin(th) * Math.sin(ph)).toFixed(5)); }
  for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) out.push('vt ' + (j / LON).toFixed(5) + ' ' + (1 - i / LAT).toFixed(5));
  const idx = (i, j) => i * (LON + 1) + j + 1;
  for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) { const a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1); out.push('f ' + a + '/' + a + ' ' + b + '/' + b + ' ' + c + '/' + c); out.push('f ' + a + '/' + a + ' ' + c + '/' + c + ' ' + d + '/' + d); }
  await evalJS(`(async () => { const f = new File([${JSON.stringify(out.join(NL))}], 'ball.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
  await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  for (let i = 0; i < 60; i++) { if (await evalJS("window.state && window.state.parts.length >= 1").catch(() => false)) break; await sleep(500); }
  await sleep(2000);
  const info = await evalJS("(() => { const p = window.state.parts[0]; const g = p.mesh.geometry; return { tris: p.triCount, indexed: !!g.index }; })()");
  check('the OBJ has no index (the case this is about)', info.indexed === false && info.tris === 11520, info);
  await call('select_all');
  await evalJS('window.__moQuickRemesh.toggle()'); await sleep(1200);
  await evalJS('window.__moQuickRemesh.level(4)');
  for (let k = 0; k < 60; k++) { await sleep(500); if (!(await evalJS("!!document.querySelector('.qr.is-busy')")) && (await evalJS('window.__moQuickRemesh.shown()')) === 4) break; }
  const tip = await evalJS("document.querySelector('.qr-tip')?.textContent || ''");
  const shown = +(/([\d,]+)\s*triangles/.exec(tip) || [0, '0'])[1].replace(/,/g, '');
  console.log('   pill:', tip);
  check('at 25 % the pill shows a lighter mesh', shown > 0 && shown < 11520 * 0.45, shown);
  const live = await evalJS("(() => { const g = window.state.parts[0].mesh.geometry; return (g.index ? g.index.count : g.attributes.position.count) / 3; })()");
  check('and the part wears it', live < 11520 * 0.45, live);
  await evalJS('window.__moQuickRemesh.cancel()'); await sleep(800);
  const back = await evalJS("(() => { const g = window.state.parts[0].mesh.geometry; return { tris: (g.index ? g.index.count : g.attributes.position.count) / 3, indexed: !!g.index }; })()");
  check('Esc puts the OBJ back as it was', back.tris === 11520 && back.indexed === false, back);
  // kept with Enter: one step, the part is lighter
  await evalJS('window.__moQuickRemesh.toggle()'); await sleep(1000);
  await evalJS('window.__moQuickRemesh.level(3)');
  for (let k = 0; k < 60; k++) { await sleep(500); if (!(await evalJS("!!document.querySelector('.qr.is-busy')")) && (await evalJS('window.__moQuickRemesh.shown()')) === 3) break; }
  await evalJS('window.__moQuickRemesh.commit()'); await sleep(1500);
  const kept = await evalJS("window.state.parts[0].triCount");
  check('kept at 35 %: the part has about a third of its triangles', kept < 11520 * 0.5 && kept > 11520 * 0.2, kept);
  await call('undo'); await sleep(800);
  check('and undo brings it back', (await evalJS("window.state.parts[0].triCount")) === 11520);
  // Decimate (the sidebar button and the tool) shares the weld
  const pid = await evalJS('window.state.parts[0].partId');
  const dec = await call('decimate', { ids: [pid], reduce_percent: 50 });
  await sleep(1500);
  const afterDec = await evalJS('window.state.parts[0].triCount');
  console.log('   decimate 50 %:', afterDec, 'triangles', (dec.s || dec.e || '').slice(0, 120));
  check('Decimate takes the OBJ down by half as well', afterDec > 4000 && afterDec < 7500, afterDec);
  const g = await evalJS("(() => { const g = window.state.parts[0].mesh.geometry; const n = g.attributes.normal; return { normal: !!n, uv: !!g.attributes.uv }; })()");
  check('the reduced OBJ still has normals and its UVs', g.normal && g.uv, g);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
