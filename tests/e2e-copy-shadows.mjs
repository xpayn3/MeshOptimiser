// node tests/e2e-copy-shadows.mjs
// A part copied while the shadows are on casts and takes them, as the parts that were there do:
//   1. a model opened, Photo mode on (it turns the shadows on): its parts cast and receive;
//   2. a part duplicated (the Duplicate command), and one copied and pasted: each copy casts and receives once a frame is drawn
//      (they used to stand on the Photo floor with no shadow);
//   3. Photo mode off with the shadows off before it: a copy made then has none, as the rest.
// Needs the app served on http://localhost:4242 (or APP_PORT), Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9364, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-copyshadow-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(500); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
};
// the shadow flags of the live parts' meshes, the new ones (ids not in `before`) apart
const flags = (before) => evalJS(`(() => { const old = new Set(${JSON.stringify(before || [])}), out = { old: [0, 0], new: [0, 0] };
  for (const p of window.state.parts) { if (p.deleted || !p.mesh) continue; const k = old.size && !old.has(p.partId) ? 'new' : 'old'; out[k][0]++; if (p.mesh.castShadow && p.mesh.receiveShadow) out[k][1]++; }
  return out; })()`);
const ids = () => evalJS('window.state.parts.filter(p => !p.deleted && p.mesh).map(p => p.partId)');
const act = (aid) => evalJS(`(async () => { const a = window._appFns._Actions.list.find(a => a.id === '${aid}'); if (!a) return 'no action'; await a.run(); await new Promise(r => setTimeout(r, 600)); return 'ok'; })()`);
const frames = () => evalJS('(async () => { for (let i = 0; i < 4; i++) { window.requestRender && window.requestRender(); await new Promise(r => requestAnimationFrame(r)); } await new Promise(r => setTimeout(r, 300)); return 1; })()');
const select = () => evalJS(`(() => { const st = window.state, p = st.parts.find(p => !p.deleted && p.mesh); st.selected = new Set([p.partId]); try { window._appFns.rebuildTree && window._appFns.rebuildTree(); } catch (_) {} return p.partId; })()`);

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready') && !!(window.state && window.state.parts)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const f = new File([await r.blob()], 'model.glb'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { if (await evalJS("window.state.parts.filter(p => !p.deleted && p.mesh).length > 3")) break; await sleep(500); }
  await sleep(3000);
  const shadowsBefore = await evalJS('!!window.state.shadowsEnabled');

  // 1. Photo mode
  await evalJS("document.getElementById('toggle-photo').click(); true");
  for (let i = 0; i < 60; i++) { if (await evalJS("document.body.classList.contains('photo-mode') && window.state.shadowsEnabled")) break; await sleep(500); }
  await sleep(1500); await frames();
  const f0 = await flags();
  check('Photo mode: the parts cast and receive', f0.old[0] > 3 && f0.old[1] === f0.old[0], f0);

  // 2. Duplicate, then Copy + Paste
  let before = await ids(); await select();
  const d = await act('duplicate'); await frames();
  const f1 = await flags(before);
  check('a duplicated part casts and receives', d === 'ok' && f1.new[0] >= 1 && f1.new[1] === f1.new[0], { d, f1 });
  before = await ids(); await select();
  const c = await act('copy'), p = await act('paste'); await frames();
  const f2 = await flags(before);
  check('a copied and pasted part casts and receives', c === 'ok' && p === 'ok' && f2.new[0] >= 1 && f2.new[1] === f2.new[0], { c, p, f2 });

  // 3. shadows off again: a copy has none
  await evalJS("document.getElementById('toggle-photo').click(); true");
  for (let i = 0; i < 40; i++) { if (!(await evalJS("document.body.classList.contains('photo-mode')"))) break; await sleep(500); }
  await sleep(1000);
  if (!shadowsBefore && !(await evalJS('!!window.state.shadowsEnabled'))) {
    before = await ids(); await select();
    await act('duplicate'); await frames();
    const f3 = await flags(before);
    check('with the shadows off, a copy has none', f3.new[0] >= 1 && f3.new[1] === 0, f3);
  } else console.log('SKIP the shadows were on before Photo mode');
  check('no page errors', errors.length === 0, errors.slice(0, 5));
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
