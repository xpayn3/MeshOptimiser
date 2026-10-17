// node tests/e2e-export-exploded.mjs [model]
//
// An exploded view is a view: the file is written with the parts together, whatever the view shows, and the view is left as it was.
// Exports the model together and again exploded, and the two files must have the same node transforms and vertex boxes; then a
// recovery copy is taken while a part spins in Animate and must hold the part at rest (a guard: it passes without any fix, parts with their own mesh are written from their saved rest matrix). Needs the app on http://localhost:4242, Chrome, Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9344, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-mcp-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], consoleErr = [];
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
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErr.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 220));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  // (the sample models are in the repository's inbox/, which the server does not serve: the bytes go in through the page's file input)
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);

  const readGlb = (r) => {
    const f = r.j && r.j.files && r.j.files[0], rel = f && (f.path || f.file || f.name || (typeof f === 'string' ? f : ''));
    for (const cand of [String(rel), path.join('exports', path.basename(String(rel))), path.join('app', 'exports', path.basename(String(rel)))]) { try { return fs.readFileSync(cand); } catch (_) {} }
    return null;
  };
  // what places the parts in a GLB: every node's transform and the box of every vertex accessor
  const layout = (glb) => {
    const j = JSON.parse(glb.slice(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    const r5 = (a) => (a || []).map(v => Math.round(v * 1e4) / 1e4);
    const nodes = (j.nodes || []).map(n => [r5(n.translation), r5(n.rotation), r5(n.scale), r5(n.matrix)]);
    const boxes = (j.accessors || []).filter(a => a.type === 'VEC3' && a.min && a.max).map(a => [r5(a.min), r5(a.max)]);
    return JSON.stringify({ nodes, boxes });
  };
  const explodeNow = () => evalJS('(() => { const e = window.state.explode; return e ? e.x + e.y + e.z : 0; })()');

  let r = await call('export_model', { format: 'glb', file_name: 'exploded_test_rest' });
  const rest = readGlb(r);
  check('the model is exported together', !!rest, r);
  r = await call('set_explode', { amount: 60 });
  check('the view is exploded', r.ok && (await explodeNow()) > 0, r);
  r = await call('export_model', { format: 'glb', file_name: 'exploded_test_apart' });
  const apart = readGlb(r);
  check('the exploded view is exported', !!apart, r);
  if (rest && apart) check('the file written from the exploded view has the parts together, as the first', layout(rest) === layout(apart));
  check('the view is still exploded afterwards', (await explodeNow()) > 0);
  await call('set_explode', { amount: 0 });

  // the recovery copy while a part spins: the part must be written at rest, where a copy taken before the animation has it
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 2 });
  const id1 = lp.j.parts[0].id, name1 = lp.j.parts[0].name;
  const copyPose = (why) => evalJS(`(async () => {
    window.__moAutosave.nudge(); window.state.history.push({ type: 'noop-test', label: 'test' });
    const ok = await window.__moAutosave.now(${JSON.stringify(why)});
    if (ok !== true) return { ok };
    const db = await new Promise((res, rej) => { const r = indexedDB.open('mo-recovery', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rows = await new Promise((res, rej) => { const q = db.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const row = rows.sort((x, y) => y.t - x.t)[0], buf = await row.blob.arrayBuffer(), dv = new DataView(buf);
    const j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, dv.getUint32(12, true))));
    const nodes = (j.nodes || []).filter(n => (n.extras && n.extras.soName === ${JSON.stringify(name1)}) || n.name === ${JSON.stringify(name1)});
    return { ok, found: nodes.length, pose: nodes.map(n => JSON.stringify([n.rotation, n.matrix])) };
  })()`);
  const c0 = await copyPose('rest');
  check('a recovery copy is written with nothing animated', c0 && c0.ok === true && c0.found > 0, c0);
  await call('animate_parts', { action: 'add', ids: [id1], type: 'spin', rpm: 60, axis: 'Z' });
  await sleep(700);
  const c1 = await copyPose('animated');
  check('a recovery copy is written while an animation plays', c1 && c1.ok === true && c1.found > 0, c1);
  check('the spinning part is written at rest in it', c0 && c1 && JSON.stringify(c0.pose) === JSON.stringify(c1.pose), { rest: c0 && c0.pose, spun: c1 && c1.pose });
  await call('animate_parts', { action: 'clear' });

} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`
${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
console.log('console errors:', consoleErr.length); consoleErr.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
