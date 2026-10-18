// node tests/e2e-scania-uv.mjs [model.glb in the app's inbox or a full path] [shot.png]
// UVs on a real model: the Scania 8x4 (converted from STEP, 1,449 parts, 8 million triangles) opened in the real app in headless Chrome.
//   1. what UVs its parts came with (none, all the same, real);
//   2. the cab with the Flip-flop car paint in Photo mode is not drawn black (a picture is saved to look at);
//   3. Close cracks, Smooth surface and Decimate on a mid-size part and Decimate on the cab: each finishes, in how long, and the part keeps
//      UVs if it had real ones;
//   4. Merge parts on two parts;
//   5. an FBX of a few parts reads back with as many UV layers as they have.
// Slow: the model is big and the page draws with SwiftShader. Needs the app served on http://localhost:4242, Chrome, Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const pickModel = () => {
  const a = process.argv[2];
  if (a) return path.isAbsolute(a) ? a : path.join(ROOT, 'app', 'inbox', a);
  const dir = path.join(ROOT, 'app', 'inbox'), list = fs.readdirSync(dir).filter(f => /Scania-8x4\.glb$/.test(f));
  if (!list.length) throw new Error('no Scania-8x4.glb in app/inbox: give a model');
  return path.join(dir, list.sort((x, y) => fs.statSync(path.join(dir, y)).mtimeMs - fs.statSync(path.join(dir, x)).mtimeMs)[0]);
};
const MODEL = pickModel(), SHOT = process.argv[3] || path.join(ROOT, 'scratch', 'scania-uv.png');
const PORT = 9360, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-scania-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name, extra === undefined ? '' : JSON.stringify(extra)); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ready = async () => { for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); } await sleep(1500); };
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(500); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};
const tool = (name, args) => evalJS(`(async () => { const r = await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return r && r[0] && r[0].text; })()`);
// a part's UVs: none, flat (all the same), or real, and how many triangles
const uvOf = (pid) => evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pid} && !q.deleted); if (!p || !p.mesh) return null; const g = p.mesh.geometry, U = g.attributes.uv; let kind = 'none';
  if (U) { let lo = Infinity, hi = -Infinity; for (let i = 0; i < U.count; i++) { const u = U.getX(i), v = U.getY(i); lo = Math.min(lo, u, v); hi = Math.max(hi, u, v); } kind = hi - lo > 1e-9 ? 'real' : 'flat'; }
  return { kind, tris: p.triCount, name: p.name }; })()`);
const timed = async (label, fn) => { const t0 = Date.now(); let r, err = null; try { r = await fn(); } catch (e) { err = e.message; } return { label, ms: Date.now() - t0, r, err }; };

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  console.log('model', MODEL);
  await tool('open_file', { path: MODEL });
  for (let i = 0; i < 80; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(500); }
  await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  const t0 = Date.now();
  for (let i = 0; i < 600; i++) { const n = await evalJS("window.state && window.state.parts.filter(p => !p.deleted).length").catch(() => 0); if (n > 100 && await evalJS("!document.getElementById('loader')?.classList.contains('show')").catch(() => false)) break; await sleep(1000); }
  await sleep(3000);
  console.log('opened in', Math.round((Date.now() - t0) / 1000), 's');

  // 1. what UVs came in
  const survey = await evalJS(`(() => { const out = { parts: 0, none: 0, flat: 0, real: 0, tris: 0 }; for (const p of window.state.parts) { if (p.deleted || !p.mesh) continue; out.parts++; out.tris += p.triCount; const U = p.mesh.geometry.attributes.uv; if (!U) { out.none++; continue; } let lo = Infinity, hi = -Infinity; for (let i = 0; i < Math.min(U.count, 5000); i++) { lo = Math.min(lo, U.getX(i), U.getY(i)); hi = Math.max(hi, U.getX(i), U.getY(i)); } if (hi - lo > 1e-9) out.real++; else out.flat++; } return out; })()`);
  console.log('survey', JSON.stringify(survey));
  check('the truck opens', survey.parts > 1000, survey);

  const sorted = await evalJS("window.state.parts.filter(p => !p.deleted && p.mesh).sort((a, b) => b.triCount - a.triCount).map(p => [p.partId, p.triCount, p.name])");
  const cab = sorted[0], mid = sorted.find(x => x[1] < 90000 && x[1] > 30000) || sorted[5], small = sorted.filter(x => x[1] > 2000 && x[1] < 20000).slice(0, 2);
  console.log('cab', JSON.stringify(cab), 'mid', JSON.stringify(mid), 'small', JSON.stringify(small));

  // 2. Flip-flop on the cab, Photo mode, isolated and framed
  await evalJS("document.getElementById('tg-materials').click()"); for (let i = 0; i < 20 && !(await evalJS("typeof window.__matNewFromPreset === 'function'")); i++) await sleep(500);
  await evalJS(`(() => { window.state.selected = new Set([${cab[0]}]); const pr = window.__moMatPresets.find(p => p.name === 'Flip-flop Violet / Green'); window.__matNewFromPreset(pr); return true; })()`);
  await tool('isolate_parts', { ids: [cab[0]] }).catch(() => null);
  await tool('frame_selection', { ids: [cab[0]] }).catch(() => null);
  await evalJS(`(() => { const t = document.getElementById('toggle-photo'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(8000);
  const cabUv = await uvOf(cab[0]);
  check('the cab with a car paint has usable UVs (the guard gave it some if it had none)', cabUv && cabUv.kind === 'real', cabUv);
  const sh = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(SHOT, Buffer.from(sh.data, 'base64')); console.log('picture', SHOT);
  await evalJS(`(() => { const t = document.getElementById('toggle-photo'); t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await tool('show_all', {}).catch(() => null);

  // 3. mesh tools on the mid-size part, Decimate on the cab
  const before = await uvOf(mid[0]);
  for (const [label, fn] of [
    ['Close cracks', () => evalJS(`window.__moAgent.meshOp('closeCracks', { ids: [${mid[0]}], quiet: true }).then(r => r && r.parts)`)],
    ['Smooth surface', () => evalJS(`window.__moAgent.meshOp('smoothSurface', { ids: [${mid[0]}], quiet: true }).then(r => r && r.parts)`)],
    ['Decimate 50 %', () => tool('decimate', { ids: [mid[0]], reduce_percent: 50 })],
  ]) {
    const r = await timed(label, fn), after = await uvOf(mid[0]);
    check(label + ' on ' + mid[2] + ': done, UVs ' + (before.kind === 'real' ? 'kept' : 'as they were (' + before.kind + ')'), !r.err && after && (before.kind !== 'real' || after.kind === 'real'), { ms: r.ms, err: r.err, before: before.kind, after: after && after.kind, tris: after && after.tris });
  }
  {
    const r = await timed('Decimate the cab', () => tool('decimate', { ids: [cab[0]], reduce_percent: 50 })), after = await uvOf(cab[0]);
    check('Decimate 50 % on the cab: done, it keeps its UVs', !r.err && after && after.kind === 'real', { ms: r.ms, err: r.err, after });
  }

  // 4. merge two small parts
  if (small.length === 2) {
    const r = await timed('Merge', () => tool('merge_parts', { ids: small.map(x => x[0]) }));
    const m = await evalJS("(() => { const p = window.state.parts.filter(q => !q.deleted).pop(); const ms = [].concat(p.mesh.material); return { name: p.name, mats: ms.length, vertexColors: ms.some(x => x.vertexColors), tris: p.triCount }; })()");
    check('Merge parts on two small parts', !r.err && /merged/i.test(m.name) && m.tris > 0, { ms: r.ms, err: r.err, ...m });
  }

  // 5. FBX of the cab alone (isolated: the export writes what is shown)
  {
    await tool('isolate_parts', { ids: [cab[0]] }).catch(() => null);
    const name = 'scania_uv_' + Date.now();
    const r = await timed('FBX', () => tool('export_model', { format: 'fbx', file_name: name }));
    const saved = r.r ? (JSON.parse(r.r).files || []) : [];
    const file = saved.map(f => (typeof f === 'string' ? f : f.path || f.file || f.name)).find(Boolean);
    const p = [file, path.join(ROOT, 'app', 'exports', path.basename(String(file || ''))), path.join(ROOT, 'exports', path.basename(String(file || '')))].find(x => x && fs.existsSync(x));
    let layers = 0;
    if (p) { const buf = fs.readFileSync(p); let at = 0; while ((at = buf.indexOf('LayerElementUV', at)) >= 0) { layers++; at += 14; } }
    check('FBX of the cab carries a UV layer', !!p && layers > 0, { ms: r.ms, err: r.err, file: p, uvMentions: layers, mb: p ? +(fs.statSync(p).size / 1e6).toFixed(1) : 0 });
    if (p && !process.env.KEEP) try { fs.unlinkSync(p); } catch (_) {}
    await tool('show_all', {}).catch(() => null);
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 8));
} catch (e) { console.log('HARNESS ERROR:', e.message); fail++; }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(fail ? fail + ' failed, ' + pass + ' passed' : 'ok: ' + pass + ' passed');
process.exit(fail ? 1 : 0);
