// node tests/e2e-decimate-card.mjs [model, default inbox/GearboxAssy.glb]
//
// The Decimate card itself (app/js/decimate-card.js), driven in the real app in headless Chrome, on the three heaviest parts: the count
// under the button and the estimate follow the selection and the setting; the preview shows the plan, Esc closes it untouched and its
// own button runs it; a share, a triangle target and a distance each reduce as one undo step named Decimate, and undo puts every triangle
// back; the Claude tool at the same share gives the same count as the button; Smart optimise's entry point (__moDecimateWithin) works;
// nothing runs without a selection; and nothing throws. The reduction itself is covered by simplify-core, reduce-quality and
// decimate-align. Needs the app on http://localhost:4242 (python app/serve.py --no-browser --port 4242) or APP_PORT, Chrome, Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9368, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-deccard-' + Date.now();
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
const hist = () => evalJS('window.state.history.length');
const lastUndo = () => evalJS('(() => { const u = window.state.history; const o = u[u.length - 1]; return o ? { type: o.type, label: o.label, n: (o.items || []).length } : null; })()');
const selTris = () => evalJS('[...window.state.selected].reduce((s, id) => { const p = window.state.partById.get(id); return s + (p && !p.deleted && p.mesh ? p.triCount || 0 : 0); }, 0)');
// a run that changes something ends with its undo step; one that changes nothing is given a few seconds
const settle = async (before) => {
  if (before === undefined) { await sleep(2500); return; }
  for (let i = 0; i < 480; i++) { if ((await hist()) > before) break; await sleep(250); }
  await sleep(800);
};
const setVal = (sel, v) => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(String(v))}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const shown = (sel) => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.style.display !== 'none' && !e.hidden; })()`);
const undoAll = async (t0) => { await call('undo'); await sleep(600); return (await selTris()) === t0; };
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
  check('the card is wired: button, share, count, estimate, preview, and the entry points', await evalJS("!!(document.getElementById('btn-decimate-sel') && document.getElementById('decimate-strength') && document.getElementById('dec-sel-count') && document.getElementById('decimate-info') && document.getElementById('decimate-preview') && window.__moAgent && typeof window.__moAgent.decimate === 'function' && typeof window.__moDecimateWithin === 'function')"));

  // ── nothing selected: nothing runs ──
  const h0 = await hist();
  await evalJS("window.state.selected.clear(); document.getElementById('btn-decimate-sel').click()"); await settle();
  check('with nothing selected, Decimate changes nothing', (await hist()) === h0);

  // ── the three heaviest parts, the card open ──
  const ids = await evalJS('window.state.parts.filter(p => !p.deleted && p.mesh).sort((a, b) => (b.triCount || 0) - (a.triCount || 0)).slice(0, 3).map(p => p.partId)');
  await call('select_parts', { ids });
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'reduceTris').run()"); await sleep(800);
  const t0 = await selTris();
  check('three parts with triangles are selected', ids.length === 3 && t0 > 1000, { ids, t0 });
  await setVal('#decimate-strength', '0.5'); await sleep(700);
  check('the count under the button says 3', (await evalJS("document.getElementById('dec-sel-count').textContent.trim()")) === '3');
  check('the estimate shows the selection going from its count to about half', await evalJS(`(() => { const i = document.getElementById('decimate-info'); const f = i.querySelector('.plan-from'), t = i.querySelector('.plan-to'); return !!(f && t) && f.textContent.replace(/\\D/g, '') === String(${t0}) && t.textContent.replace(/\\D/g, '') === String(Math.round(${t0} * 0.5)); })()`), await evalJS("document.getElementById('decimate-info').textContent"));
  check('the preview link shows', await shown('#decimate-preview'));
  await setVal('#decimate-strength', 'target'); await sleep(700);
  check('Target… shows the target field', await shown('#decimate-target'));
  await setVal('#decimate-strength', 'tol'); await sleep(700);
  check('Within… shows the distance row and says as many as possible go', (await shown('#decimate-tol-row')) && /as many as possible go/.test(await evalJS("document.getElementById('decimate-info').textContent")), await evalJS("document.getElementById('decimate-info').textContent"));
  await setVal('#decimate-strength', '0.5'); await sleep(700);
  check('a share hides both again', !(await shown('#decimate-target')) && !(await shown('#decimate-tol-row')));

  // ── the preview ──
  await evalJS("document.getElementById('decimate-preview').click()"); await sleep(400);
  check('the preview opens a plan titled Decimate with a Decimate button', await evalJS("document.getElementById('plan-modal')?.classList.contains('show') && document.getElementById('plan-title').textContent === 'Decimate' && document.getElementById('plan-run').textContent === 'Decimate' && !document.getElementById('plan-run').disabled"));
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))"); await sleep(300);
  check('Esc closes it and nothing changed', !(await evalJS("document.getElementById('plan-modal').classList.contains('show')")) && (await hist()) === h0 && (await selTris()) === t0);
  await evalJS("document.getElementById('decimate-preview').click()"); await sleep(400);
  await evalJS("document.getElementById('plan-run').click()"); await settle(h0);
  const tPlan = await selTris();
  check('its own button runs Decimate', tPlan < t0 && (await hist()) === h0 + 1, { t0, tPlan });
  check('and undo puts every triangle back', await undoAll(t0));

  // ── a share ──
  await evalJS("document.getElementById('btn-decimate-sel').click()"); await settle(h0);
  const tHalf = await selTris(), lu = await lastUndo();
  check('−50 % reduces the selection', tHalf < t0 && tHalf > t0 * 0.2, { t0, tHalf });
  check('as one undo step named Decimate, one item per part', (await hist()) === h0 + 1 && lu && lu.label === 'Decimate' && lu.type === 'decimate' && lu.n === 3, lu);
  check('the preview and the button agree', tHalf === tPlan, { tHalf, tPlan });
  check('undo puts every triangle back', await undoAll(t0));

  // ── a triangle target ──
  const want = Math.floor(t0 / 3);
  await setVal('#decimate-strength', 'target'); await setVal('#decimate-target', String(want)); await sleep(300);
  await evalJS("document.getElementById('btn-decimate-sel').click()"); await settle(h0);
  const tT = await selTris();
  check('a target of a third takes the selection near it', tT < t0 && tT <= want * 1.25, { t0, want, tT });
  check('and undo puts it back', await undoAll(t0));
  await setVal('#decimate-target', String(t0 + 10)); await sleep(300);
  await evalJS("document.getElementById('btn-decimate-sel').click()"); await settle();
  check('a target above the count changes nothing', (await hist()) === h0 && (await selTris()) === t0);

  // ── a distance ──
  await setVal('#decimate-strength', 'tol'); await setVal('#decimate-tol', '0.05'); await sleep(300);
  await evalJS("document.getElementById('btn-decimate-sel').click()"); await settle(h0);
  const tW = await selTris();
  check('Within 0.05 mm reduces the selection as one step', tW < t0 && (await hist()) === h0 + 1, { t0, tW });
  check('and undo puts it back', await undoAll(t0));
  await setVal('#decimate-strength', '0.5');

  // ── the other ways in ──
  const r = await call('decimate', { ids, reduce_percent: 50 });
  check('the Claude tool at 50 % gives the same count as the button', r.ok && (await selTris()) === tHalf, r.ok ? { now: await selTris(), tHalf } : r);
  check('and undo puts it back', await undoAll(t0));
  await evalJS('window.__moDecimateWithin(0.05)'); await settle(h0);
  check("Smart optimise's entry point reduces within a distance", (await selTris()) === tW, { now: await selTris(), tW });
  check('and undo puts it back', await undoAll(t0));

  // ── a part as a STEP part comes (flat normals, a corner of its own on every face) stays indexed, and Remesh still works on it ──
  // (Decimate's crease pass handed back one vertex per triangle corner: Remesh then found nothing to join)
  const cpid = await evalJS(`(async () => {
    const BGU = await import('three/addons/utils/BufferGeometryUtils.js');
    const p = window.state.parts.filter(p => !p.deleted && p.mesh && p.triCount >= 3000 && p.triCount <= 40000).sort((a, b) => b.triCount - a.triCount)[0];
    let g = p.mesh.geometry.toNonIndexed(); g.deleteAttribute('normal'); g.computeVertexNormals(); g = BGU.mergeVertices(g);
    g.computeBoundingBox(); g.computeBoundingSphere();
    p.mesh.geometry = g; p.triCount = g.index.count / 3; p.vertCount = g.attributes.position.count;
    return p.partId; })()`);
  const geo = () => evalJS(`(() => { const g = window.state.partById.get(${JSON.stringify(cpid)}).mesh.geometry; return { indexed: !!g.index, tris: g.index ? g.index.count / 3 : g.attributes.position.count / 3, verts: g.attributes.position.count }; })()`);
  await call('select_parts', { ids: [cpid] });
  await setVal('#decimate-strength', '0.5');
  const hC = await hist(), g0 = await geo();
  await evalJS("document.getElementById('btn-decimate-sel').click()"); await settle(hC);
  const g1 = await geo();
  check('a part with a corner per face is reduced', g1.tris < g0.tris, { g0, g1 });
  check('and keeps its corners shared (indexed, fewer vertices than three per triangle)', g1.indexed && g1.verts < g1.tris * 2, g1);
  const hR = await hist();
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'remesh').run(); document.querySelector('#remesh-mode [data-mode=\"ut\"]').click(); document.getElementById('btn-remesh-run').click()");
  await settle(hR);
  const g2 = await geo();
  check('Remesh (polygons) after Decimate still joins flat faces', (await hist()) === hR + 1 && g2.tris < g1.tris, { g1, g2 });
  await call('undo'); await call('undo'); await sleep(600);

  check('no uncaught errors in the page', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL (threw)', e.message);
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  try { ws && ws.close(); } catch (_) {}
  chrome.kill();
  process.exit(fail ? 1 : 0);
}
