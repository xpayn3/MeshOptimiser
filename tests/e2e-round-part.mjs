// node tests/e2e-round-part.mjs <model.glb> [shot.png] [ridges|solid|belt]
//
// Drives Round part (remove ridges / make solid) in the real app in headless Chrome: opens a model of one round part (handed to the page as a
// file, so it may be anywhere), selects it, runs the simplify_round_part tool, checks the part has fewer triangles and is still one part,
// takes a picture (optional second argument) and checks that one undo puts the triangles back.
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
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
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
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 1 });
  const pid = lp.j.parts[0].id;
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

  if (MODE === 'belt') {
    // A belt: the card opens without the Segments row (its path is fixed); Smooth up to works; one undo takes it all back.
    await call('select_parts', { ids: [pid] });
    await evalJS(`window.__moAgent.fillGrooves({ ids: [${pid}], mode: 'belt' })`);
    await sleep(600);
    const b1 = await sum();
    check('the card opens', await evalJS("!document.querySelector('.section-cmd[data-cmd=\"roundpart\"]').hidden"));
    check('without the Segments row', await evalJS("document.getElementById('rnd-seg-scrub').parentElement.hidden"));
    check('its title says Belt', /^Belt: remove ribs$/.test(await evalJS("document.getElementById('rnd-title').textContent")));
    check('the view is Wireframe', b1.view_mode === 'wire');
    await evalJS('window.__moAgent.roundSmooth(2)'); await sleep(300);
    check('Smooth up to rebuilds it, same triangles', (await sum()).triangles === b1.triangles);
    await evalJS('window.__moAgent.roundSmooth(30)'); await sleep(300);
    if (SHOT) {
      await call('set_camera_view', { view: 'perspective' }); await call('set_camera_view', { view: 'fit' }); await sleep(900);
      const img = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(SHOT.replace(/\.png$/, '-belt.png'), Buffer.from(img.data, 'base64'));
    }
    await call('undo'); await sleep(400);
    check('one undo puts the belt back', (await sum()).triangles === s0.triangles);
  } else {
  // The Segments slider: run as the command does (not quietly), the card opens; a new count spins the profile again in the same step.
  await evalJS(`window.__moAgent.fillGrooves({ ids: [${pid}], mode: ${JSON.stringify(MODE === 'solid' ? 'outline' : 'exact')} })`);
  await sleep(500);
  check('the Round part card opens', await evalJS("!document.querySelector('.section-cmd[data-cmd=\"roundpart\"]').hidden"));
  const s3 = await sum();
  const n = await evalJS('window.__moAgent.roundSegments(16)');
  await sleep(500);
  const s4 = await sum();
  { const inf = await evalJS("(() => { const e = document.getElementById('rnd-info'); return { h: e.offsetHeight, t: e.textContent }; })()"); check('the info line shows the count', inf.h > 0 && /triangles/.test(inf.t), inf); }
  check('the slider shows 16', /16/.test(await evalJS("document.querySelector('#rnd-seg-scrub .scrub-value')?.textContent || ''")));
  // the selection's outline and glow follow the new shape at once (no 250 ms wait): the glow is drawn from the part's own geometry
  await call('select_parts', { ids: [pid] });
  await evalJS('window.__moAgent.roundSegments(20)');
  const ov = await evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pid}); const kids = p.mesh.children.filter(k => k.userData && k.userData.selGlow); return { glows: kids.length, same: kids.every(k => k.geometry === p.mesh.geometry) }; })()`);
  check('the selection glow is the new shape in the same frame', ov.glows > 0 && ov.same, ov);
  // Same tick as a step: the selection outline is the shape's edges (not the 24-point box), there is a glow on the new shape, and the
  // wireframe lines are on the part. Ten steps in a row, each looked at before the browser draws.
  const tick = await evalJS(`(async () => { const p = window.state.parts.find(q => q.partId === ${pid}); const bad = [];
    for (const n of [22, 30, 41, 12, 64, 9, 100, 33, 17, 48]) {
      window.__moAgent.roundSegments(n);
      await new Promise(r => queueMicrotask(r));   // (the selection redraws in a microtask: still before the browser draws)
      const kids = p.mesh.children, sel = kids.filter(k => k.userData && k.userData.selChild && !k.userData.selGlow), glow = kids.filter(k => k.userData && k.userData.selGlow);
      const wl = kids.filter(k => k.userData && k.userData.wireLine && k.visible);
      const boxy = sel.some(l => l.geometry.attributes.position.count <= 24);
      if (!sel.length || boxy || glow.length !== 1 || glow[0].geometry !== p.mesh.geometry || (window.state.viewMode === 'wire' && !wl.length)) bad.push({ n, sel: sel.length, boxy, glow: glow.length, wl: wl.length });
    }
    return bad; })()`);
  check('ten slider steps: outline, glow and wireframe right before the next frame', tick.length === 0, tick);
  check('16 segments: fewer triangles', n === 16 && s4.triangles < s3.triangles && s4.parts === s3.parts, { n, s3, s4 });
  if (SHOT) {
    const img = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SHOT.replace(/\.png$/, '-16.png'), Buffer.from(img.data, 'base64'));
  }
  await evalJS('window.__moAgent.roundSegments(96)');
  await sleep(500);
  const s5 = await sum();
  check('96 segments: more triangles', s5.triangles > s4.triangles, { s4, s5 });
  // Smooth up to: at 96 segments (3.75° apart) and 2°, every face is lit flat; back to 30° it is smooth again; the shape is the same
  const flatShare = () => evalJS(`(() => { const g = window.state.parts.find(q => q.partId === ${pid}).mesh.geometry, P = g.attributes.position.array, Nn = g.attributes.normal.array, I = g.index.array; let flat = 0;
    for (let t = 0; t < I.length; t += 3) { const v = [I[t], I[t + 1], I[t + 2]]; const u = [0, 1, 2].map(k => P[3 * v[1] + k] - P[3 * v[0] + k]), w = [0, 1, 2].map(k => P[3 * v[2] + k] - P[3 * v[0] + k]);
      const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...f) || 1;
      if (v.every(i => (Nn[3 * i] * f[0] + Nn[3 * i + 1] * f[1] + Nn[3 * i + 2] * f[2]) / l > 0.9999)) flat++; }
    return flat / (I.length / 3); })()`);
  await evalJS('window.__moAgent.roundSmooth(2)'); await sleep(300);
  const f2 = await flatShare(), s5c = await sum();
  check('Smooth up to 2°: every face lit flat, same triangles', f2 > 0.999 && s5c.triangles === s5.triangles, { f2, s5c });
  await evalJS('window.__moAgent.roundSmooth(30)'); await sleep(300);
  check('back to 30°: shaded smooth round the part', (await flatShare()) < 0.9);
  check('the view is Wireframe while the card is open', s5.view_mode === 'wire', s5.view_mode);
  // Enter, with the slider in focus, closes the card (Done) and puts the view back
  await evalJS("document.querySelector('#rnd-seg-scrub input[type=range]').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(500);
  check('Enter closes the card', await evalJS("document.querySelector('.section-cmd[data-cmd=\"roundpart\"]').hidden"));
  const s5b = await sum();
  check('and the view is as it was', s5b.view_mode === s0.view_mode && s5b.triangles === s5.triangles, { before: s0.view_mode, now: s5b.view_mode });
  await call('undo');
  await sleep(400);
  const s6 = await sum();
  check('still one undo for the command and every slider move', s6.triangles === s0.triangles, { s0, s6 });
  await evalJS('window.__moAgent.roundSegments(24)');
  await sleep(300);
  check('after undo the slider leaves the part alone', (await sum()).triangles === s0.triangles);
  check('and says why', /no longer the last one/.test(await evalJS("document.getElementById('rnd-info').textContent")));

  // The sliders are remembered: moved by hand (input and change on the range, as a drag ends), then the command is run again.
  await evalJS(`window.__moAgent.fillGrooves({ ids: [${pid}], mode: ${JSON.stringify(MODE === 'solid' ? 'outline' : 'exact')} })`);
  await sleep(500);
  const drag = (id, step) => evalJS(`(() => { const r = document.querySelector('#${id} input[type=range]'); r.value = '${step}'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await drag('rnd-seg-scrub', 20 - 6);          // (the Segments slider starts at 6)
  await drag('rnd-smooth-scrub', 12);
  await sleep(400);
  check('a drag sets the segments', await evalJS('window.__moAgent.roundSegments(20)') === 20);
  await call('undo'); await sleep(400);
  await evalJS(`window.__moAgent.fillGrooves({ ids: [${pid}], mode: ${JSON.stringify(MODE === 'solid' ? 'outline' : 'exact')} })`);
  await sleep(500);
  const seen = await evalJS("[...document.querySelectorAll('#rnd-seg-scrub .scrub-value, #rnd-smooth-scrub .scrub-value')].map(e => e.textContent)");
  check('run again: it starts at the remembered 20 segments and 12°', seen[0] === '20' && seen[1] === '12', seen);
  check('and the part is built with them', /meet at 18\.0°, so they are lit flat/.test(await evalJS("document.getElementById('rnd-info').textContent")));
  await call('undo'); await sleep(300);
  }
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
