// node tests/e2e-round-wire.mjs
//
// The Round part card, Make solid: once applied the view is Wireframe, with the lines on the part in work only; the other parts stay
// plain. Closing the card (Done) puts the view back, and a Wireframe switched on by hand afterwards draws every part again. A spool (a
// cylinder of 48 segments) and a block are opened from an OBJ; the spool is selected, the card opened and applied. Needs the app
// served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9353, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-roundwire-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// GPU=1 runs on the real graphics card (WebGPU); without it, on swiftshader (WebGL2).
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => evalJS(`(async () => { try { const r = await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']').join('\\n') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
const until = async (expr, tries = 40, ms = 250) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr).catch(() => false)) return true; await sleep(ms); } return false; };
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
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

// An OBJ with two parts: a spool (a cylinder, radius 10, 30 long, 48 segments, with its two caps) and a block beside it.
function model() {
  const out = []; let base = 0;
  const N = 48, R = 10, H = 30;
  out.push('o spool');
  for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, x = (R * Math.cos(a)).toFixed(4), z = (R * Math.sin(a)).toFixed(4); out.push(`v ${x} 0 ${z}`); out.push(`v ${x} ${H} ${z}`); }
  out.push('v 0 0 0'); out.push(`v 0 ${H} 0`);
  const cb = 2 * N + 1, ct = 2 * N + 2;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, b0 = 2 * i + 1, t0 = 2 * i + 2, b1 = 2 * j + 1, t1 = 2 * j + 2;
    out.push(`f ${b0} ${b1} ${t1}`); out.push(`f ${b0} ${t1} ${t0}`);          // the side, facing out
    out.push(`f ${cb} ${b1} ${b0}`); out.push(`f ${ct} ${t0} ${t1}`);          // the caps
  }
  base = 2 * N + 2;
  out.push('o block');
  const x0 = 30, y0 = 0, z0 = -5, sx = 10, sy = 10, sz = 10;
  for (const q of [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]]) out.push('v ' + (x0 + q[0] * sx) + ' ' + (y0 + q[1] * sy) + ' ' + (z0 + q[2] * sz));
  for (const f of [[1,3,2],[1,4,3],[5,6,7],[5,7,8],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,4,8],[3,8,7],[4,1,5],[4,5,8]]) out.push('f ' + f.map(k => k + base).join(' '));
  return out.join('\n');
}
// visible Wireframe lines per part: { name: count }
const LINES = `(() => { const o = {}; for (const p of window.state.parts) { if (p.deleted || !p.mesh) continue; o[p.name] = p.mesh.children.filter(c => c.userData && c.userData.wireLine && c.visible).length; } return o; })()`;

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const f = new File([${JSON.stringify(model())}], 'spool.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  if (await until("document.getElementById('import-modal').classList.contains('show')", 20)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  check('two parts opened', await until("window.state && window.state.parts.filter(p => !p.deleted).length === 2", 60, 500), await evalJS('window.state.parts.map(p => p.name)'));
  await sleep(2000);
  check('the view starts in Solid', await evalJS("window.state.viewMode") === 'solid', await evalJS("window.state.viewMode"));
  const sel = await call('select_parts', { name_contains: 'spool' });
  check('the spool is selected', sel.ok && await evalJS('window.state.selected.size') === 1, sel);
  await evalJS("window.__moAgent.roundCard({ mode: 'outline' })");
  check('the Round part card is open, on Make solid', await until("(() => { const s = document.querySelector('.section-cmd[data-cmd=\"round\"]'); return !!s && s.offsetHeight > 0 && window.__moAgent.roundCardState().mode === 'outline'; })()", 20));
  check('before Apply the view stays Solid', await evalJS("window.state.viewMode") === 'solid');
  await evalJS("document.getElementById('rc-run').click(); true");
  check('Apply switches the view to Wireframe', await until("window.state.viewMode === 'wire'", 60, 500));
  await until(`(() => { const l = ${LINES}; return l.spool > 0; })()`, 40, 250);
  await sleep(1000);
  const open = await evalJS(LINES);
  check('the spool has its lines', open.spool > 0, open);
  check('the block has none while the card is open', open.block === 0, open);
  await until("!document.getElementById('rc-run').disabled", 20);
  await evalJS("document.getElementById('rc-run')?.click(); true");                  // (Done, once applied)
  await sleep(800);
  check('closing the card puts the view back to Solid', await until("window.state.viewMode === 'solid'", 20), await evalJS('window.state.viewMode'));
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'wire').run(); true");
  await until(`(() => { const l = ${LINES}; return l.spool > 0 && l.block > 0; })()`, 40, 250);
  const after = await evalJS(LINES);
  check('Wireframe by hand afterwards draws every part', after.spool > 0 && after.block > 0, after);
  // the card follows the selection: applied on the spool, then the block selected, it moves to the block at Apply again
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'solid').run(); true"); await until("window.state.viewMode === 'solid'", 20);
  check('back in Solid before the second Apply', await evalJS('window.state.viewMode') === 'solid', await evalJS('window.state.viewMode'));
  await call('select_parts', { name_contains: 'spool' });
  await evalJS("window.__moAgent.roundCard({ mode: 'outline' })"); await sleep(300);
  await evalJS("document.getElementById('rc-run').click(); true");
  check('applied on the spool again', await until("window.__moAgent.roundCardState()?.applied === true && window.state.viewMode === 'wire'", 60, 250));
  const spoolTris = await evalJS("window.state.parts.find(p => p.name.includes('spool')).triCount");
  await call('select_parts', { name_contains: 'block' });
  check('another part selected: the card moves to it, at Apply again', await until("(() => { const s = window.__moAgent.roundCardState(); return !!s && s.summary && /block/.test(s.summary.name) && !s.applied && s.mode === 'outline'; })()", 20, 150)
    && await evalJS("document.getElementById('rc-run-lbl').textContent") === 'Apply', await evalJS('window.__moAgent.roundCardState()'));
  check('the view goes back to Solid', await evalJS('window.state.viewMode') === 'solid', await evalJS('window.state.viewMode'));
  check('the spool keeps what Apply made', await evalJS("window.state.parts.find(p => p.name.includes('spool')).triCount") === spoolTris, [spoolTris, await evalJS("window.state.parts.find(p => p.name.includes('spool')).triCount")]);
  await evalJS('window.state.selected.clear()'); await sleep(400);
  check('nothing selected: the card stays on the block', /block/.test((await evalJS('window.__moAgent.roundCardState()'))?.summary?.name || ''));
  await evalJS("document.querySelector('.section-cmd[data-cmd=\"round\"] .cmd-close')?.click(); true");
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
