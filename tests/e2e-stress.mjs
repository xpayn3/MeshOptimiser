// node tests/e2e-stress.mjs [model, default inbox/GearboxAssy.glb]      ONLY=jump,overlap
//
// "Some functions stop working when I jump from one to the next." In the real app (headless Chrome):
//  jump:    a long run of commands one after another with no pause (select, isolate, explode, view modes, Reduce, Remove holes, hide,
//           Merge, Untriangulate, Move, each followed by Ctrl+Z), round after round. Every call must end (an answer or a plain "still
//           working"), the model must come back to what it was, and nothing may be left holding the app: no job lock, orbiting on,
//           messages on, no card left open (window.__moState, the State section of the Tasks list). Geometry, GPU geometry and the JS
//           heap after each round must not keep growing.
//  overlap: four heavy commands started at the same moment. The page must stay answering, nothing may be left stuck, and the
//           next command must still run (the job lock did not stay held).
// Needs the app served (python app/serve.py --no-browser --port 4343; APP_PORT overrides 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const ONLY = (process.env.ONLY || 'jump,overlap').split(',');
const ROUNDS = +(process.env.ROUNDS || 5);
const PORT = 9371, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-stress-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr, ms = 120000) => {
  const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), new Promise((_, j) => setTimeout(() => j(new Error('the page did not answer in ' + ms / 1000 + ' s (frozen?)')), ms))]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
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
  await send('Page.enable'); await send('Runtime.enable'); await send('HeapProfiler.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moBridgeTools && window.__moOpenFile && window.__moState)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click(); true");
};
// a command of the app's tools (what Claude calls), one answer: { ok, s, j } or { ok: false, e }
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
// an answer that is only "not now / nothing to do" is not a failure: the command ended and said so
const POLITE = /still (running|working)|wait for|nothing (to|was)|no (parts|change|holes|flat)|already|cannot|can't|not while|exploded|is busy/i;
const sum = async () => (await call('scene_summary')).j;
const gc = async () => { try { await send('HeapProfiler.collectGarbage'); } catch (_) {} await sleep(300); };
const heapMB = async () => { await gc(); const r = await send('Runtime.getHeapUsage'); return +(r.usedSize / 1048576).toFixed(1); };
const counts = () => evalJS(`(() => { const st = window.state, gpu = window.__moGpuMemory && window.__moGpuMemory(); return { geoms: st.geomByHash.size, history: st.history.length, redo: st.redo.length, gpuGeoms: gpu && gpu.geometries }; })()`);
const loaderShown = () => evalJS("document.getElementById('loader')?.classList.contains('show') === true");
const settle = async (limit = 60000) => {
  const t0 = Date.now(); let quiet = 0;
  while (Date.now() - t0 < limit) {
    await sleep(250);
    const st = await evalJS('window.__moState()');
    if (st.Job.v !== 'none' || await loaderShown()) { quiet = 0; continue; }
    if (++quiet >= 6) return Date.now() - t0;
  }
  return -1;
};
// nothing may be left holding the app
const healthy = async (label) => {
  const quiet = await settle();
  check(label + ': the app went quiet', quiet >= 0, quiet);
  const st = await evalJS('window.__moState()');
  const bad = Object.entries(st).filter(([, x]) => x.bad).map(([k]) => k);
  check(label + ': nothing is flagged as stuck', bad.length === 0, bad.length ? st : undefined);
  check(label + ': no job holds the lock', st.Job.v === 'none', st.Job);
  check(label + ': orbiting is on', st.Orbit.v === 'on', st.Orbit);
  check(label + ': messages are on', st.Messages.v === 'on', st.Messages);
  check(label + ': no undo is half done', st['In undo'].v === 'no', st['In undo']);
  check(label + ': no card is left open', st['Card open'].v === 'none', st['Card open']);
};
const undoTo = async (histLen) => {
  for (let i = 0; i < 60; i++) { const c = await counts(); if (c.history <= histLen) return true; const r = await call('undo'); if (!r.ok && !POLITE.test(r.e)) return false; await sleep(120); }
  return false;
};
const topIds = async (n = 12) => { const r = await call('list_parts', { sort_by: 'triangles', limit: n }); return ((r.j && r.j.parts) || []).map(p => p.id); };

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); window.__moOpenFile(new File([b], ${JSON.stringify(path.basename(MODEL))})); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await settle();
  const s0 = await sum(), c0 = await counts();
  check('a model is open', s0 && s0.parts > 5, s0);
  console.log('   at the start', JSON.stringify({ ...s0, ...c0 }));

  // ── jump: command after command, no pause ──
  if (ONLY.includes('jump')) {
    const rows = [];
    for (let round = 1; round <= ROUNDS; round++) {
      const ids = await topIds(), top = ids.slice(0, 3), few = ids.slice(0, 5);
      const steps = [
        ['select_all', {}], ['isolate_parts', { ids: few }], ['show_all', {}], ['set_explode', { amount: 50 }], ['set_explode', { amount: 0 }],
        ['select_parts', { ids: top }], ['frame_selection', {}], ['set_view_mode', { mode: 'wire' }], ['set_view_mode', { mode: 'xray' }], ['set_view_mode', { mode: 'solid' }],
        ['decimate', { ids: top, reduce_percent: 40 }], ['undo', {}],
        ['fill_holes', { max_hole_mm: 30 }], ['undo', {}],
        ['hide_parts', { ids: top.slice(0, 2) }], ['show_all', {}],
        ['merge_parts', { ids: top }], ['undo', {}],
        ['untriangulate', { ids: top }], ['undo', {}],
        ['transform_parts', { ids: top, move: [10, 0, 0] }], ['undo', {}],
      ];
      const bad = [], t0 = Date.now();
      for (const [name, args] of steps) {
        const r = await call(name, args);
        if (!r.ok && !POLITE.test(r.e || '')) bad.push(name + ': ' + String(r.e).slice(0, 120));
        if (process.env.VERBOSE) console.log('     ', name, r.ok ? 'ok  ' + String(r.s).replace(/\s+/g, ' ').slice(0, 90) : 'NO  ' + String(r.e).slice(0, 90));
      }
      check('round ' + round + ': all ' + steps.length + ' commands ended (' + Math.round((Date.now() - t0) / 1000) + ' s)', bad.length === 0, bad);
      await healthy('round ' + round);
      await undoTo(c0.history);
      await healthy('round ' + round + ' after undo');
      // (what no history entry holds is freed by a sweep that looks twice, a few seconds apart)
      await sleep(8000);
      const sm = await sum(), c = await counts(), heap = await heapMB();
      check('round ' + round + ': Ctrl+Z put the model back (' + (sm && sm.triangles) + ' triangles)', sm && sm.triangles === s0.triangles && sm.parts === s0.parts, { now: sm && [sm.parts, sm.triangles], start: [s0.parts, s0.triangles] });
      rows.push({ round, geoms: c.geoms, gpu: c.gpuGeoms, heap });
      console.log('   round', round, JSON.stringify(rows[rows.length - 1]));
    }
    if (rows.length >= 3) {
      const g = rows.map(r => r.geoms);
      check('the geometry table does not keep growing from round to round', g[g.length - 1] <= g[1] + 6, g);
      if (rows.every(r => r.gpu != null)) { const p = rows.map(r => r.gpu); check('the GPU geometry does not keep growing from round to round', p[p.length - 1] <= p[1] + 6, p); }
    }
    if (rows.length >= 4) {
      const h = rows.map(r => r.heap), early = h[1], late = h[h.length - 1];
      check('the JS heap settles (last round within 25% and 40 MB of the second)', late <= Math.max(early * 1.25, early + 40), h);
    }
  }

  // ── overlap: four heavy commands at the same moment ──
  if (ONLY.includes('overlap')) {
    await undoTo(c0.history);
    const ids = await topIds(), top = ids.slice(0, 3);
    const h0 = (await counts()).history;
    const all = Promise.all([call('decimate', { ids: top, reduce_percent: 30 }), call('merge_parts', { ids: top }), call('fill_holes', { max_hole_mm: 30 }), call('untriangulate', { ids: top })]);
    let done = false, lag = 0, res = null;
    all.then((r) => { res = r; done = true; }, (e) => { res = [{ ok: false, e: String(e) }]; done = true; });
    const t0 = Date.now();
    while (!done && Date.now() - t0 < 240000) { const t = Date.now(); try { await evalJS('1', 30000); } catch (e) { lag = 1e9; break; } lag = Math.max(lag, Date.now() - t); await sleep(300); }
    check('the four commands all ended', done, { waited: Math.round((Date.now() - t0) / 1000) });
    check('the page kept answering while they ran (worst wait ' + lag + ' ms)', lag < 15000, lag);
    const unexpected = (res || []).filter(r => !r.ok && !POLITE.test(r.e || '')).map(r => String(r.e).slice(0, 120));
    check('every command answered or said it was busy', unexpected.length === 0, unexpected);
    check('at least one of them ran', (res || []).some(r => r.ok), (res || []).map(r => r.ok ? 'ok' : r.e));
    await healthy('after the overlap');
    await undoTo(c0.history);
    const sm = await sum();
    check('Ctrl+Z put the model back after the overlap', sm && sm.triangles === s0.triangles && sm.parts === s0.parts, { now: sm && [sm.parts, sm.triangles], start: [s0.parts, s0.triangles] });
    const again = await call('decimate', { ids: top.slice(0, 1), reduce_percent: 20 });
    check('the next command still runs (the job lock was not left held)', again.ok, again);
    await healthy('the next command');
    await undoTo(c0.history);
  }
  check('no uncaught page errors', errors.filter(e => !/ResizeObserver/.test(e)).length === 0, errors.slice(0, 5));
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
