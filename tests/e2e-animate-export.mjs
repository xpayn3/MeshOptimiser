// node tests/e2e-animate-export.mjs [model]
//
// The animation in a GLB: a part is spun in Animate, the scene is exported with Claude's export_model, and the file is read back:
// it holds one animation, with a rotation track for the part that turns one quarter by a quarter of a second at 60 rpm and is back
// where it began after a second, while its centre stays put. Needs the app on http://localhost:4242, Chrome and Node 22+.
//
// The Animate feature in the real app (headless Chrome, software WebGL2): the animate_parts tool, the part and group animations, the
// Playing tag and pausing, the Animate window, the poses going back, and the turntable video playing the animations.
// is the layer above them and is not part of this) and checks what each one did, including that the undo tool takes it back.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
// Prints PASS / FAIL per check and every JavaScript error the page threw. Exit code 1 when anything failed.
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
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);

  const lp = await call('list_parts', { sort_by: 'triangles', limit: 4 });
  const id1 = lp.j.parts[0].id;
  let r = await call('animate_parts', { action: 'add', ids: [id1], type: 'spin', rpm: 60, axis: 'Z' });
  check('a part is set to spin', r.ok && r.j && r.j.animated === 1, r);
  r = await call('export_model', { format: 'glb', file_name: 'anim_export_test' });
  check('the export went through', r.ok && r.j && r.j.files && r.j.files.length === 1, r);
  const f = r.j && r.j.files && r.j.files[0];
  const rel = f && (f.path || f.file || f.name || (typeof f === 'string' ? f : ''));
  let glb = null;
  for (const cand of [String(rel), path.join('exports', path.basename(String(rel))), path.join('app', 'exports', path.basename(String(rel)))]) { try { glb = fs.readFileSync(cand); break; } catch (_) {} }
  check('the file can be read back', !!glb, { rel });
  if (glb) {
    const jl = glb.readUInt32LE(12), json = JSON.parse(glb.slice(20, 20 + jl).toString('utf8'));
    const binStart = 20 + jl + 8, bin = glb.slice(binStart);
    check('the file holds one animation', Array.isArray(json.animations) && json.animations.length === 1, json.animations && json.animations.length);
    const an = json.animations && json.animations[0];
    const acc = (i) => json.accessors[i], arr = (i) => { const a = acc(i), bv = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]; return new Float32Array(bin.buffer.slice(bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0) + a.count * n * 4)); };
    const rot = an && an.channels.filter(c => c.target.path === 'rotation'), tr = an && an.channels.filter(c => c.target.path === 'translation');
    check('one part is turned: a rotation and a translation track', rot && rot.length === 1 && tr && tr.length === 1, { rot: rot && rot.length, tr: tr && tr.length });
    if (rot && rot.length === 1) {
      const smp = an.samplers[rot[0].sampler], times = arr(smp.input), q = arr(smp.output), at = (t) => Math.round(t * 30);
      const qd = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(q[4 * a] * q[4 * b] + q[4 * a + 1] * q[4 * b + 1] + q[4 * a + 2] * q[4 * b + 2] + q[4 * a + 3] * q[4 * b + 3]))) * 180 / Math.PI;
      check('the track runs 30 frames a second over the 5 s timeline', times.length === 151 && Math.abs(times[150] - 5) < 1e-4, { n: times.length, last: times[times.length - 1] });
      check('a quarter of a second at 60 rpm is a quarter turn (frames 7 and 8 are either side of it)', Math.abs(qd(0, 7) - 84) < 1 && Math.abs(qd(0, 8) - 96) < 1, { a: qd(0, 7), b: qd(0, 8) });
      check('after one second it is back where it began', qd(0, at(1)) < 1, qd(0, at(1)));
      const tp = arr(an.samplers[tr[0].sampler].output); let drift = 0; for (let i = 1; i < times.length; i++) drift = Math.max(drift, Math.hypot(tp[3 * i] - tp[0], tp[3 * i + 1] - tp[1], tp[3 * i + 2] - tp[2]));
      check('the middle of the part stays where it is (it turns about itself)', drift < 1e-3 * Math.max(1, Math.hypot(tp[0], tp[1], tp[2])), drift);
    }
  }
  r = await call('export_model', { format: 'glb', file_name: 'anim_export_test_off', animation: false });
  const f2 = r.j && r.j.files && r.j.files[0], rel2 = f2 && (f2.path || f2.file || f2.name || (typeof f2 === 'string' ? f2 : ''));
  let glb2 = null; for (const cand of [String(rel2), path.join('exports', path.basename(String(rel2))), path.join('app', 'exports', path.basename(String(rel2)))]) { try { glb2 = fs.readFileSync(cand); break; } catch (_) {} }
  if (glb2) { const j2 = JSON.parse(glb2.slice(20, 20 + glb2.readUInt32LE(12)).toString('utf8')); check('with animation off the file has none', !j2.animations || !j2.animations.length); }
  await call('animate_parts', { action: 'clear' });

} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`
${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
console.log('console errors:', consoleErr.length); consoleErr.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
