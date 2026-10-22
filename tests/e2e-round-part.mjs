// node tests/e2e-round-part.mjs <model.glb> [shot.png] [ridges|solid|belt]
//
// Drives Round part (remove ridges / make solid / belt) through Claude's tool in the real app in headless Chrome: opens a model of one
// round part (handed to the page as a file, so it may be anywhere), selects it, checks a dry run changes nothing, runs the
// simplify_round_part tool, checks the part has fewer triangles and is still one part, takes a picture (optional second argument) and
// checks that one undo puts the triangles back. (The card the commands open is tests/e2e-round-card.mjs.)
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2], SHOT = process.argv[3], MODE = process.argv[4] || 'ridges';
if (!MODEL) { console.log('usage: node tests/e2e-round-part.mjs <model.glb> [shot.png] [ridges|solid]'); process.exit(2); }
const PORT = 9351, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-grooves-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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
const sum = async () => (await call('scene_summary')).j;
const ready = async () => {
  // (app-ready alone is not enough: the page shows itself after a cap even while the app's module is still starting, e.g. on a busy
  // graphics card, and the tools below would not be there yet; so the module's own hooks are waited for too)
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moBridgeTools && window.__moOpenFile)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
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
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  let s0 = null;
  for (let i = 0; i < 120; i++) { s0 = await sum(); if (s0 && s0.parts > 0 && s0.triangles > 0) break; await sleep(500); }
  await sleep(1500);
  check('the model is open', s0 && s0.parts > 0, s0);
  // A model of one part: that part. An assembly (e.g. inbox/GearboxAssy.glb): the biggest part the tool takes in this mode, found with
  // one dry run over all of them (the biggest part of an assembly is often a housing, which is not round and is rightly left alone).
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 500 });
  let pid = lp.j.parts[0].id;
  if (lp.j.parts.length > 1) {
    const all = lp.j.parts.map(p => p.id);
    const scan = await evalJS(`window.__moDryRun('simplify_round_part', { ids: ${JSON.stringify(all)}, mode: ${JSON.stringify(MODE)}, dry_run: true }).then(r => JSON.parse(r[0].text))`);
    const rows = ((scan && scan.details && scan.details.parts) || []).filter(q => q.ok && (MODE === 'solid' || q.grooves > 0))
      .sort((a, b) => ((b.segments > 16) - (a.segments > 16)) || (b.triangles_before || 0) - (a.triangles_before || 0));   // (more than 16 segments of its own first: the slider check below goes down to 16)
    if (rows.length) pid = rows[0].id;
    console.log('part used:', rows.length ? rows[0].name + ' (' + rows[0].triangles_before + ' triangles, ' + rows[0].segments + ' segments of its own, ' + rows.length + ' of ' + all.length + ' parts qualify)' : 'none qualifies, the biggest');
  }
  // (a dry run goes through the app's own dispatcher, which does the step and takes it back)
  const dry = await evalJS(`window.__moDryRun('simplify_round_part', { ids: [${pid}], mode: ${JSON.stringify(MODE)}, dry_run: true }).then(r => JSON.parse(r[0].text))`);
  check('a dry run says what it would do and changes nothing', dry && dry.nothing_changed && dry.would_result.triangles_saved > 0, dry);
  const r = await call('simplify_round_part', { ids: [pid], mode: MODE });
  console.log(r.s);
  const row = r.j && r.j.parts && r.j.parts[0];
  check(MODE === 'belt' ? 'the part is taken for a belt' : 'the part is found to be round', row && row.ok, row);
  check(MODE === 'solid' ? 'it was made solid' : MODE === 'belt' ? 'the gaps between the ribs were filled' : 'ridges were removed', row && (MODE === 'solid' ? row.triangles_after > 0 : row.grooves > 0), row);
  const s1 = await sum();
  check('fewer triangles, same parts', s1.triangles < s0.triangles && s1.parts === s0.parts, { s0, s1 });
  if (SHOT) {
    const shot = await call('set_camera_view', { view: 'fit' });
    await call('set_view_mode', { mode: 'wireframe' }).catch(() => {});
    await sleep(800);
    const img = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SHOT, Buffer.from(img.data, 'base64'));
    console.log('picture:', SHOT, shot.ok ? '' : shot.e);
  }
  await call('undo');
  await sleep(400);
  const s2 = await sum();
  check('one undo puts the triangles back', s2.triangles === s0.triangles, { s0, s2 });

} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
