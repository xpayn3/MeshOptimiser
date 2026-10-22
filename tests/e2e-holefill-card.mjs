// node tests/e2e-holefill-card.mjs [model, default inbox/GearboxAssy.glb]
//
// The Remove holes card itself (app/js/holefill-card.js), driven in the real app in headless Chrome: its button and Enter in the size
// field each fill holes as one undo step and say so under the button; an empty size or every kind of hole switched off changes nothing;
// the Advanced options are saved, mark the Advanced header while one differs from its default, and Reset puts them back but keeps the
// size; Lettering (which runs through the same code) answers a dry run; and nothing throws. The other ways in (the Claude tool, Smart
// optimise) are covered by e2e-mcp-tools, e2e-isolate and e2e-undo-memory.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242) or APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9367, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-hfcard-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
const sum = async () => (await call('scene_summary')).j;
const tris = async () => (await sum()).triangles;
const undoLen = () => evalJS('window.state.history.length');
const lastUndo = () => evalJS('(() => { const u = window.state.history; const o = u && u[u.length - 1]; return o ? { type: o.type, label: o.label, n: (o.items || []).length } : null; })()');
// wait until the card's run is over. A run that changes something ends with its undo step (the tidy after the fill runs after the
// button is enabled again, so the button says nothing); one that changes nothing is given a few seconds.
const settle = async (before) => {
  if (before === undefined) { await sleep(2500); return; }
  for (let i = 0; i < 240; i++) { if ((await undoLen()) > before) break; await sleep(250); }
  await sleep(800);
};
const info = () => evalJS("document.getElementById('fill-holes-info')?.textContent || ''");
const el = (sel, prop) => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e[${JSON.stringify(prop)}] : null; })()`);
const setVal = (sel, v) => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e.type === 'checkbox') e.checked = ${JSON.stringify(!!v)}; else e.value = ${JSON.stringify(String(v))}; e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const saved = () => evalJS("JSON.parse(localStorage.getItem('stepopt-fillholes') || 'null')");
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
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);
  const t0 = await tris();
  check('a model is open', t0 > 0, t0);
  check('the card is wired: button, size field, Advanced, and the Claude entry point', await evalJS("!!(document.getElementById('btn-fill-holes') && document.getElementById('fill-holes-size') && document.getElementById('fh-adv') && window.__moAgent && typeof window.__moAgent.fillHoles === 'function')"));

  // ── settings: saved, marked, reset ──
  await evalJS("localStorage.removeItem('stepopt-fillholes')");
  check('Advanced is not marked at the defaults', !(await evalJS("document.getElementById('fh-adv').classList.contains('is-changed')")));
  await setVal('#fh-blind', false);
  let sv = await saved();
  check('switching Blind holes off is saved', sv && sv.blind === false && sv._t3 === true, sv);
  check('and marks Advanced as changed', await evalJS("document.getElementById('fh-adv').classList.contains('is-changed')"));
  await setVal('#fill-holes-size', '30');
  await evalJS("document.getElementById('fh-reset').click()");
  check('Reset turns Blind holes back on', await el('#fh-blind', 'checked') === true);
  check('Reset keeps the size', await el('#fill-holes-size', 'value') === '30', await el('#fill-holes-size', 'value'));
  check('Reset clears the mark on Advanced', !(await evalJS("document.getElementById('fh-adv').classList.contains('is-changed')")));
  sv = await saved();
  check('Reset is saved too', sv && sv.blind === true && sv.size === '30', sv);

  // ── what may not run ──
  const u0 = await undoLen();
  await setVal('#fill-holes-size', '');
  await evalJS("document.getElementById('btn-fill-holes').click()"); await settle();
  check('an empty size changes nothing', (await tris()) === t0 && (await undoLen()) === u0);
  await setVal('#fill-holes-size', '30');
  for (const k of ['through', 'blind', 'open', 'raised']) await setVal('#fh-' + k, false);
  await evalJS("document.getElementById('btn-fill-holes').click()"); await settle();
  check('every kind switched off changes nothing', (await tris()) === t0 && (await undoLen()) === u0);
  await evalJS("document.getElementById('fh-reset').click()");

  // ── the button ──
  check('nothing is selected, so it works on every shown part', await evalJS('window.state.selected.size') === 0);
  await evalJS("document.getElementById('btn-fill-holes').click()"); await settle(u0);
  const t1 = await tris(), lu = await lastUndo(), msg = await info();
  check('the button fills holes', t1 < t0, { t0, t1 });
  check('as one undo step named Remove holes', (await undoLen()) === u0 + 1 && lu && lu.label === 'Remove holes' && lu.n > 0, lu);
  check('and says so under the button', /filled in \d+ parts?/.test(msg), msg);
  check('the button is enabled and labelled again', (await el('#btn-fill-holes', 'disabled')) === false && (await el('#fill-holes-label', 'textContent')) === 'Remove holes');
  await call('undo'); await sleep(500);
  check('undo puts every triangle back', (await tris()) === t0, { t0, now: await tris() });

  // ── Enter in the size field ──
  await evalJS("document.getElementById('fill-holes-size').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))"); await settle(u0);
  check('Enter in the size field runs it the same way', (await tris()) === t1, { t1, now: await tris() });
  await call('undo'); await sleep(500);
  check('and undo puts it back', (await tris()) === t0);

  // ── the Claude entry point and Lettering (same code, op "marks") ──
  const r = await call('fill_holes', { max_hole_mm: 30 });
  check('fill_holes (Claude) gives the same result', r.ok && (await tris()) === t1, r.ok ? { now: await tris(), t1 } : r);
  await call('undo'); await sleep(500);
  const ids = await evalJS('window.state.parts.filter(p => !p.deleted && p.mesh).slice(0, 3).map(p => p.partId)');
  const lr = await call('remove_lettering', { ids, dry_run: true });
  check('Lettering answers a dry run through the shared code', lr.ok && lr.j && lr.j.dry_run === true, lr);
  check('and changes nothing', (await tris()) === t0);

  check('no uncaught errors in the page', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL (threw)', e.message);
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  try { ws && ws.close(); } catch (_) {}
  chrome.kill();
  process.exit(fail ? 1 : 0);
}
