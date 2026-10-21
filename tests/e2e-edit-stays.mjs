// node tests/e2e-edit-stays.mjs
//
// Edit mesh: none of its functions (Dissolve, Delete, Flip, Planarize, Straighten, Weld, Fill, Close open edges) may throw the user out of
// Edit mesh: the card stays open and the mode stays on, with a point picked again afterwards. Needs the app on http://localhost:4242, Chrome, Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9375, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-editstays-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// GPU=1 runs on the real graphics card (WebGPU); without it, on swiftshader (WebGL2).
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--remote-allow-origins=*', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => evalJS(`(async () => { try { const r = await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
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

// a dome of 40 × 40 squares (an OBJ of triangles: the app pairs them into quads), with a fold across it so that it has sharp edges
// and more than one face
function model() {
  const N = 40, out = ['o dome'];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = i - N / 2, z = j - N / 2, y = 12 - (x * x + z * z) / 40 + (x > 6 ? (x - 6) * 1.5 : 0);
    out.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
  }
  const v = (i, j) => j * (N + 1) + i + 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { out.push(`f ${v(i, j)} ${v(i, j + 1)} ${v(i + 1, j)}`); out.push(`f ${v(i + 1, j)} ${v(i, j + 1)} ${v(i + 1, j + 1)}`); }
  return out.join('\n');
}


const open = () => evalJS("!document.querySelector('.section-cmd[data-cmd=\"elements\"]').hidden");
const pickSome = (m) => evalJS(`(() => { const r = document.getElementById('canvas').getBoundingClientRect(); window.__moElements.mode(${JSON.stringify(m)}); return window.__moElements.boxPick(r.left + r.width * .44, r.top + r.height * .42, r.left + r.width * .56, r.top + r.height * .58, 'set'); })()`);
try {
  console.log('attaching'); await attach(); console.log('attached');
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  console.log('ready'); await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const f = new File([${JSON.stringify(model())}], 'dome.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  if (await until("document.getElementById('import-modal').classList.contains('show')", 20)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  check('the dome opened', await until("window.state && window.state.parts.filter(p => !p.deleted && p.mesh).length === 1", 60, 500));
  await sleep(2500);
  await call('select_parts', { name_contains: 'dome' }); await call('frame_selection'); await sleep(1200);
  await evalJS("window.__moElements.mode('points'); true"); await sleep(1200);
  check('Edit mesh is on', await open());
  const ops = [['points', 'dissolve'], ['edges', 'dissolve'], ['faces', 'dissolve'], ['points', 'planarize'], ['points', 'straighten'], ['points', 'weld'], ['points', 'fill'], ['faces', 'flipPicked'], ['points', 'closeOpen'], ['points', 'delete'], ['faces', 'delete']];
  for (const [m, fn] of ops) {
    const n = await pickSome(m);
    const r = await evalJS(`(async () => { try { const x = window.__moElements[${JSON.stringify(fn)}](); if (x && x.then) await x; return 'ok'; } catch (e) { return String(e && e.message || e); } })()`);
    await sleep(700);
    check(fn + ' on ' + m + ' (' + n + ' picked): still in Edit mesh', await open(), r);
  }
  // the same through the bar's buttons and the keys (what a person does)
  for (const [m, id] of [['points', 'btn-el-dissolve'], ['faces', 'btn-el-dissolve'], ['points', 'btn-el-planar'], ['points', 'btn-el-straight'], ['points', 'btn-el-weld'], ['points', 'btn-el-fill'], ['faces', 'btn-el-extract'], ['points', 'btn-el-close'], ['points', 'el-foot-delete']]) {
    const n = await pickSome(m);
    await evalJS(`document.getElementById(${JSON.stringify(id)})?.click()`); await sleep(700);
    check('button ' + id + ' on ' + m + ' (' + n + ' picked): still in Edit mesh', await open());
  }
  for (const [m, k, code, vk, mod] of [['points', 'Backspace', 'Backspace', 8, 2], ['points', 'Delete', 'Delete', 46, 0], ['faces', 'Backspace', 'Backspace', 8, 2]]) {
    const n = await pickSome(m);
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, modifiers: mod, key: k, code, windowsVirtualKeyCode: vk });
    await sleep(700);
    check('key ' + (mod ? 'Ctrl+' : '') + k + ' on ' + m + ' (' + n + ' picked): still in Edit mesh', await open());
  }
  const errs = errors.filter(e => !/ResizeObserver/.test(e));
  check('no page errors', errs.length === 0, errs.slice(0, 3));
} catch (e) { fail++; console.log('FAIL', e && e.message || e); }
console.log(fail ? fail + ' failed' : 'all passed');
try { chrome.kill(); } catch (_) {}
process.exit(fail ? 1 : 0);
