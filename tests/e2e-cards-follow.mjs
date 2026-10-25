// node tests/e2e-cards-follow.mjs
//
// The cards that show something about the selection keep up when it changes while they are open (Profile: clean outline and Round
// part are in e2e-profile-scene.mjs and e2e-round-wire.mjs). Four cubes: a and b use one material, c and d another. Merge by: a+b
// selected says they become one mesh; a+c (as many parts, others) says there is nothing to merge. Align and spread: its line counts
// the parts selected now, not the ones selected when it opened. Needs the app served on http://localhost:4242 (or APP_PORT), Chrome
// installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9355, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-follow-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── the model: four cubes, two materials ──
const v = [], f = [];
const cube = (name, mat, x) => {
  const b = v.length + 1;
  for (const [dx, dy, dz] of [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]]) v.push(`v ${x + dx} ${dy} ${dz}`);
  f.push(`o ${name}`, `usemtl ${mat}`);
  for (const q of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]) f.push('f ' + q.map(k => b + k).join(' '));
};
cube('cube_a', 'red', 0); cube('cube_b', 'red', 20); cube('cube_c', 'blue', 40); cube('cube_d', 'blue', 60);
const objText = v.join('\n') + '\n' + f.join('\n') + '\n';

const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
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
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(() => { window.__moOpenFile(new File([${JSON.stringify(objText)}], 'follow.obj')); return true; })()`);
  for (let i = 0; i < 20; i++) {             // (an OBJ asks how to bring it in first)
    if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) { await evalJS("document.querySelector('#import-modal-confirm')?.click()"); break; }
    await sleep(250);
  }
  for (let i = 0; i < 120 && !(await evalJS("window.state.parts.filter(p => !p.deleted).length") >= 4); i++) await sleep(500);
  await sleep(1500);
  check('four cubes open', (await evalJS("window.state.parts.filter(p => !p.deleted).length")) === 4);
  // (an OBJ without its .mtl comes in on one material: c and d are given one of their own)
  await evalJS("(() => { const P = (n) => window.state.parts.find(p => p.name === n); const m = P('cube_c').mesh.material.clone(); m.name = 'blue'; P('cube_c').mesh.material = m; P('cube_d').mesh.material = m; return true; })()");
  const info = (id) => evalJS(`document.getElementById('${id}')?.textContent || ''`);
  const pick = async (...names) => { await evalJS('window.state.selected.clear()'); for (const n of names) await call('select_parts', { name_contains: n, mode: 'add' }); };

  // ── Merge by: which parts, not only how many ──
  await pick('cube_a', 'cube_b');
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'mergeBy').run(); true"); await sleep(700);
  const m1 = await info('mb-info');
  check('Merge by, a and b (one material): they become one mesh', /2 parts become 1 mesh/.test(m1), m1);
  await pick('cube_a', 'cube_c'); await sleep(700);
  const m2 = await info('mb-info');
  check('a and c instead (as many, two materials): nothing to merge', /Nothing to merge/.test(m2), m2);
  await evalJS("document.querySelector('.section-cmd[data-cmd=\"mergeby\"] .cmd-close')?.click(); true"); await sleep(300);

  // ── Align and spread: the line counts the selection as it is now ──
  await pick('cube_a');
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'alignParts').run(); true"); await sleep(500);
  const a1 = await info('arr-info');
  check('Align and spread opens on 1 part selected', /^1 part selected/.test(a1), a1);
  await pick('cube_a', 'cube_b', 'cube_c'); await sleep(400);
  const a2 = await info('arr-info');
  check('three selected while it is open: it says 3 parts', /^3 parts selected/.test(a2), a2);
  await evalJS("document.querySelector('.section-cmd[data-cmd=\"arrange\"] .cmd-close')?.click(); true");
  check('no page errors', errors.length === 0, errors);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
