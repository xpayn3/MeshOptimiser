// node tests/e2e-isolate.mjs [model.glb] [rounds] [seed]
//
// Stress test for Isolate. Drives the real app in headless Chrome (the app on http://localhost:4242, or APP_PORT) and mixes, in a
// random order, every way in and out of an isolation: isolate_parts by ids and by name through the bridge tools, with a selection
// and with none, the S key and Alt+H as key events, the Isolate button of the selection bar, an eye in the parts tree, a Remove
// holes run and its undo, a camera change, a screenshot framed on the selection, a second scene tab. After every step it reads the
// page's own state (window.state of the active tab) and scene_summary and checks that the isolation, what is shown and what is
// selected are what a user expects. The first failing sequence is printed in full, with the seed, so it can be replayed:
//   node tests/e2e-isolate.mjs inbox/GearboxAssy.glb 60 <seed>
// KEEP=1 goes on after a failure (every failing step is printed); CDP_PORT picks Chrome's debugging port when two runs share a machine.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || (fs.existsSync('inbox/GearboxAssy.glb') ? 'inbox/GearboxAssy.glb' : 'tests/fixtures/test-model.glb');
const ROUNDS = Math.max(1, parseInt(process.argv[3] || process.env.ROUNDS || '60', 10));
const SEED = parseInt(process.argv[4] || process.env.SEED || String(Date.now() % 1000000), 10);
const PORT = parseInt(process.env.CDP_PORT || '9391', 10), PROFILE = (process.env.TEMP || '.') + '/cdp-profile-isolate-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// a small deterministic generator, so a failing run can be replayed with its seed
let _s = SEED >>> 0 || 1;
const rnd = () => { _s ^= _s << 13; _s >>>= 0; _s ^= _s >>> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const some = (arr, n) => { const a = arr.slice(); const out = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
// every call goes to the active scene tab, as the app's own bridge does (a second tab is its own page with its own tools)
const WIN = '((window.__moTabs && window.__moTabs.wins && window.__moTabs.wins[window.__moTabs.active]) || window)';
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const w = ${WIN}; const f = w.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
const sum = async () => (await call('scene_summary')).j;
// what the page itself holds: the isolation flag, the shown and hidden parts, the selection
const actual = () => evalJS(`(() => { const st = ${WIN}.state; const live = st.parts.filter(p => !p.deleted && !p.isCloner); return { iso: !!st._isolated, vis: live.filter(p => p.visible).map(p => p.partId).sort((a, b) => a - b), sel: [...st.selected].sort((a, b) => a - b), n: live.length }; })()`);
const key = (k, mods = {}) => evalJS(`(() => { const w = ${WIN}; const e = new w.KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, code: ${JSON.stringify(k.length === 1 ? 'Key' + k.toUpperCase() : k)}, bubbles: true, cancelable: true, altKey: ${!!mods.alt}, shiftKey: ${!!mods.shift}, ctrlKey: ${!!mods.ctrl} }); w.document.dispatchEvent(e); return true; })()`);
const click = (sel) => evalJS(`(() => { const el = ${WIN}.document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const eyeOf = (pid) => evalJS(`(() => { const d = ${WIN}.document; const row = [...d.querySelectorAll('#tree [data-part-id="${pid}"]')][0]; if (!row) return false; const eye = row.querySelector('.tree-vis'); if (!eye) return false; eye.click(); return true; })()`);
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sorted = (s) => [...s].sort((a, b) => a - b);
let pass = 0, fail = 0;
const log = [];
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } return ok; };
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
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  let s0 = null;
  for (let i = 0; i < 120; i++) { s0 = await sum(); if (s0 && s0.parts > 0 && s0.triangles > 0) break; await sleep(500); }
  await sleep(1500);
  if (!s0 || !s0.parts) throw new Error('the model did not open');
  console.log(`model ${MODEL}: ${s0.parts} parts, ${s0.triangles} triangles · seed ${SEED} · ${ROUNDS} rounds`);
  const lp = await call('list_parts', { limit: 500 });
  const parts = lp.j.parts.map(p => ({ id: p.id, name: String(p.name || '') }));
  const ids = parts.map(p => p.id);
  const byName = (q) => parts.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).map(p => p.id);

  // the expectation: what a user expects after each step, kept beside the sequence
  let exp = { iso: false, vis: sorted(ids), sel: [] };
  const all = () => sorted(ids);
  const same = (a, b) => eq(a, b);
  const step = (text) => { log.push(text); };
  // compare the page with the expectation after a step; on the first failure print the sequence and stop
  const verify = async (what) => {
    await sleep(150);
    const a = await actual(), s = await sum();
    const problems = [];
    if (a.iso !== exp.iso) problems.push(`isolated flag is ${a.iso}, expected ${exp.iso}`);
    if (!same(a.vis, exp.vis)) problems.push(`shown parts ${JSON.stringify(a.vis)}, expected ${JSON.stringify(exp.vis)}`);
    if (!same(a.sel, exp.sel)) problems.push(`selection ${JSON.stringify(a.sel)}, expected ${JSON.stringify(exp.sel)}`);
    if (s.isolated !== exp.iso) problems.push(`scene_summary.isolated is ${s.isolated}, expected ${exp.iso}`);
    if (s.hidden !== a.n - exp.vis.length) problems.push(`scene_summary.hidden is ${s.hidden}, expected ${a.n - exp.vis.length}`);
    if (!check(what, !problems.length, problems)) {
      console.log('\nFirst failing sequence (seed ' + SEED + '):');
      log.forEach((l, i) => console.log('  ' + (i + 1) + '. ' + l));
      console.log('  -> ' + problems.join('; '));
      if (process.env.KEEP) { exp = { iso: a.iso, vis: a.vis, sel: a.sel }; return true; }      // KEEP=1: go on from what the page has, to find every kind of failure in one run
      return false;
    }
    return true;
  };
  // the ways in and out, each with what it should leave behind
  const isolateIds = async () => {
    const want = sorted(some(ids, 1 + Math.floor(rnd() * 4)));
    step(`isolate_parts { ids: ${JSON.stringify(want)} }`);
    const r = await call('isolate_parts', { ids: want });
    if (!r.ok) { log.push('   (tool error: ' + r.e + ')'); }
    exp = { iso: true, vis: want, sel: want };
    return verify('isolate by ids');
  };
  const isolateName = async () => {
    const p = pick(parts); const q = p.name.slice(0, Math.max(2, Math.min(5, p.name.length))).trim() || p.name;
    const want = sorted(byName(q));
    step(`isolate_parts { name_contains: ${JSON.stringify(q)} }   (matches ${want.length})`);
    const r = await call('isolate_parts', { name_contains: q });
    if (!r.ok) log.push('   (tool error: ' + r.e + ')');
    if (want.length) exp = { iso: true, vis: want, sel: want };
    return verify('isolate by name');
  };
  const selectThenIsolate = async () => {
    const want = sorted(some(ids, 1 + Math.floor(rnd() * 3)));
    step(`select_parts { ids: ${JSON.stringify(want)} }; isolate_parts {}`);
    await call('select_parts', { ids: want });
    const r = await call('isolate_parts', {});
    if (!r.ok) log.push('   (tool error: ' + r.e + ')');
    exp = { iso: true, vis: want, sel: want };
    return verify('select then isolate with no ids');
  };
  const isolateNothing = async () => {
    step('Escape (clear the selection); isolate_parts {} with nothing selected');
    await key('Escape'); await sleep(100);
    exp = { ...exp, sel: [] };
    const r = await call('isolate_parts', {});
    log.push('   (tool said: ' + (r.ok ? r.s : 'error: ' + r.e) + ')');
    check('isolate with nothing selected and no ids is refused, not silently a show-all', !r.ok, r.s);
    return verify('isolate with nothing to isolate leaves the view alone');
  };
  // S: isolates the selection when it is not already what is shown; when it is (or nothing is selected while isolated), it shows all
  const expectS = () => {
    if (exp.sel.length && !(exp.iso && same(exp.vis, exp.sel))) exp = { iso: true, vis: exp.sel, sel: exp.sel };
    else if (exp.iso) exp = { iso: false, vis: all(), sel: exp.sel };
  };
  const pressS = async () => { step('S (key)'); await key('s'); expectS(); return verify('S key'); };
  const altH = async () => { step('Alt+H (key)'); await key('h', { alt: true }); exp = { iso: false, vis: all(), sel: exp.sel }; return verify('Alt+H shows all'); };
  const selBar = async () => { step('click #sel-isolate (selection bar)'); const ok = await click('#sel-isolate'); if (!ok) { log.push('   (no selection bar button in the page)'); return true; } expectS(); return verify('selection bar Isolate button'); };
  const selectSome = async () => {
    const want = sorted(some(ids, 1 + Math.floor(rnd() * 3)));
    step(`select_parts { ids: ${JSON.stringify(want)} }`);
    await call('select_parts', { ids: want });
    exp = { ...exp, sel: want };
    return verify('select_parts leaves visibility alone');
  };
  const treeEye = async () => {
    const hidden = ids.filter(i => !exp.vis.includes(i)), shown = exp.vis;
    const hide = shown.length > 1 && (!hidden.length || rnd() < 0.5);
    const pid = hide ? pick(shown) : pick(hidden);
    const ok = await eyeOf(pid);
    if (!ok) {
      // the row is not in the document (the tree is drawn in a window): the tool does the same thing, but it selects the part first
      step(`${hide ? 'hide_parts' : 'show (tree eye not in view: _setPartVisible)'} part ${pid}`);
      if (hide) { await call('hide_parts', { ids: [pid] }); exp = { ...exp, vis: exp.vis.filter(i => i !== pid), sel: [pid] }; }
      else { await evalJS(`(() => { const st = ${WIN}.state; const p = st.partById.get(${pid}); p.visible = true; if (p.mesh) p.mesh.visible = true; return true; })()`); exp = { ...exp, vis: sorted([...exp.vis, pid]) }; }
    } else {
      step(`tree eye on part ${pid} (${hide ? 'hide' : 'show'})`);
      exp = hide ? { ...exp, vis: exp.vis.filter(i => i !== pid) } : { ...exp, vis: sorted([...exp.vis, pid]) };
    }
    return verify('a tree eye changes one part only');
  };
  const fillHoles = async (withIds) => {
    const target = pick(exp.vis.length ? exp.vis : ids);
    const before = { ...exp };
    if (withIds) { step(`fill_holes { ids: [${target}], max_hole_mm: 5 }; undo`); }
    else { step('fill_holes {} (no ids: the selection, or every shown part); undo'); }
    const h0 = (await sum()).undo_steps;
    const r = await call('fill_holes', withIds ? { ids: [target], max_hole_mm: 5 } : { max_hole_mm: 5 });
    if (!r.ok) log.push('   (tool error: ' + r.e + ')');
    await sleep(300);
    const changed = (await sum()).undo_steps > h0;
    // a run that found no hole leaves no undo step, and its reply must say so (an undo then would take back the step before)
    if (r.ok && r.j) check('the Remove holes reply says whether there is a step to undo', changed ? /takes this back/.test(r.j.undo || '') : /no step to undo/.test(r.j.undo || ''), r.j.undo);
    // the selection: the ids given become the selection, as the other tools do; without ids it must survive
    exp = { ...before, sel: withIds ? [target] : before.sel };
    if (!await verify('Remove holes keeps the isolation' + (withIds ? '' : ' and the selection'))) return false;
    if (!changed) { log.push('   (nothing was changed: no undo)'); return true; }
    const u = await call('undo', {});
    if (!u.ok) log.push('   (undo error: ' + u.e + ')');
    return verify('undo of Remove holes keeps the isolation');
  };
  const camera = async () => { const v = pick(['fit', 'top', 'perspective', 'front']); step(`set_camera_view { view: ${v} }`); await call('set_camera_view', { view: v }); return verify('a camera change keeps the isolation'); };
  const shot = async () => {
    const frame = exp.sel.length ? 'selection' : 'model';
    step(`screenshot { frame: ${frame}, width: 400 }`);
    const r = await call('screenshot', { frame, width: 400 });
    if (!r.ok) log.push('   (tool error: ' + r.e + ')');
    return verify('a screenshot keeps the isolation and the selection');
  };
  let tabsMade = 0;
  const tab = async () => {
    if (tabsMade >= 2) return true;
    tabsMade++;
    step('scene_tabs { action: new }; scene_tabs { action: switch, index: 0 }');
    await call('scene_tabs', { action: 'new' });
    await sleep(2500);
    const sw = await call('scene_tabs', { action: 'switch', index: 0 });
    if (!sw.ok) log.push('   (switch error: ' + sw.e + ')');
    await sleep(800);
    return verify('a second scene tab leaves the first one as it was');
  };
  const undoIsolate = async () => {
    const before = { ...exp };
    const want = sorted(some(ids, 1 + Math.floor(rnd() * 3)));
    step(`isolate_parts { ids: ${JSON.stringify(want)} }; undo`);
    await call('isolate_parts', { ids: want });
    exp = { iso: true, vis: want, sel: want };
    if (!await verify('isolate before an undo')) return false;
    await call('undo', {});
    // the undo puts the visibility and the flag back; the selection is not an undo step
    exp = { iso: before.iso, vis: before.vis, sel: want };
    return verify('undo of an isolate puts the previous view back');
  };
  const ops = [isolateIds, isolateIds, isolateName, selectThenIsolate, isolateNothing, pressS, pressS, altH, selBar, selectSome, treeEye, () => fillHoles(true), () => fillHoles(false), camera, shot, tab, undoIsolate];
  let ok = true;
  for (let r = 0; r < ROUNDS && ok; r++) {
    const op = pick(ops);
    ok = await op();
  }
  if (ok) {
    // the fixed sequences the user hit, replayed as they were reported
    step('--- fixed sequence: select, isolate, Remove holes with no ids, camera, scene_summary');
    const want = sorted(some(ids, Math.max(1, Math.min(2, Math.floor(ids.length / 2)))));      // (never every part: the last steps need some left over)
    await call('select_parts', { ids: want }); await call('isolate_parts', {}); exp = { iso: true, vis: want, sel: want };
    ok = await verify('fixed: isolate after select');
    if (ok) { const r = await call('fill_holes', { max_hole_mm: 5 }); await sleep(300); check('fixed: Remove holes ran', r.ok, r.e); ok = await verify('fixed: Remove holes with no ids keeps the isolation and the selection'); }
    if (ok) { await call('set_camera_view', { view: 'fit' }); ok = await verify('fixed: a camera call keeps the isolation'); }
    if (ok) { const r = await call('screenshot', { frame: 'selection', width: 400 }); check('fixed: a screenshot framed on the selection finds one', r.ok, r.e); ok = await verify('fixed: the screenshot keeps the isolation'); }
    const other = sorted(some(ids.filter(i => !want.includes(i)), 2));
    if (ok && other.length) { step('S with a different selection while isolated'); await call('select_parts', { ids: other }); await key('s'); exp = { iso: true, vis: other, sel: other }; ok = await verify('fixed: S with a new selection isolates it, not show-all'); }
    if (ok) { step('S again with the same selection'); await key('s'); exp = { iso: false, vis: all(), sel: exp.sel }; ok = await verify('fixed: S with the selection that is already isolated shows all'); }
  }
  const errs = errors.filter(e => !/favicon|net::ERR|ResizeObserver/.test(e));
  check('no page errors', !errs.length, errs.slice(0, 5));
} catch (e) {
  fail++; console.log('FAIL (harness)', e.message || e);
  if (log.length) { console.log('Sequence so far:'); log.forEach((l, i) => console.log('  ' + (i + 1) + '. ' + l)); }
} finally {
  try { ws && ws.close(); } catch (_) {}
  try { chrome.kill(); } catch (_) {}
  setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {} }, 500);
}
console.log(`\n${pass} passed, ${fail} failed (seed ${SEED})`);
process.exitCode = fail ? 1 : 0;
