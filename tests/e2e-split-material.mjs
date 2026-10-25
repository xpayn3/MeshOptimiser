// node tests/e2e-split-material.mjs [model.glb]
//
// Split by material in the real app (headless Chrome): a part with two materials comes apart into a part for each, each wearing its own colour; a
// part with one material is left alone; Claude's split_parts takes method material; one undo gives the part back. Needs the app served on APP_PORT (default 4343).
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9362, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-photo-pic-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4343) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
// one tool call: the kinds of what came back, its text, and a short fingerprint of the picture
const call = (name, args) => evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; const r = await f(${JSON.stringify(args)}); const img = r.find(x => x.type === 'image'); return { ok: true, text: r.filter(x => x.type === 'text').map(x => x.text).join(' '), img: img ? img.data.length : 0, sig: img ? img.data.slice(2000, 2400) : '', data: img ? img.data : '' }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
const state = () => evalJS(`({ photo: document.getElementById('toggle-photo').checked, cls: document.body.classList.contains('photo-mode'), bg: document.getElementById('bg-mode').value, shadows: document.getElementById('toggle-shadows').checked })`);
// the share of dark pixels and the mean brightness of a picture (a photo with its vignette is darker at the rim than the plain view)
const stats = (b64, mime) => evalJS(`(async () => { const img = new Image(); img.src = 'data:${mime};base64,${b64}'; await img.decode(); const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 160, 90); const d = x.getImageData(0, 0, 160, 90).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return Math.round(s / (d.length / 4 * 3)); })()`);
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
  for (let i = 0; i < 120; i++) { const n = await evalJS("document.querySelectorAll('#tree .row, #tree [data-uuid]').length").catch(() => 0); if (n > 0) break; await sleep(500); }
  await sleep(2500);

  // (on a busy machine the first call can come back before the scene is in: ask again until it answers with parts)
  let lp; for (let i = 0; i < 40; i++) { lp = await call('list_parts', { sort_by: 'triangles', limit: 3 }); if (lp && lp.ok && lp.text && /"parts"/.test(lp.text)) break; await sleep(1000); }
  const ids = JSON.parse(lp.text).parts.map(p => p.id);
  const id = ids[0], solo = ids[1];
  // make part `id` a mesh with two materials: the first half of its triangles wear Steel, the rest Red
  const made = await evalJS(`(() => { const p = window.state.partById.get(${id}); const m = p.mesh; const g = m.geometry, base = Array.isArray(m.material) ? m.material[0] : m.material;
    const a = base.clone(), b = base.clone(); a.name = 'Steel'; b.name = 'Red'; b.color.set(0xff0000);
    const n = g.index ? g.index.count : g.attributes.position.count, half = Math.floor(n / 6) * 3;
    g.clearGroups(); g.addGroup(0, half, 0); g.addGroup(half, n - half, 1); m.material = [a, b]; return { n, half, name: p.name }; })()`);
  check('the part has two materials now', made && made.half > 0, made);
  const before = JSON.parse((await call('scene_summary', {})).text).parts;
  await call('select_parts', { ids: [id] });
  await evalJS("document.getElementById('tg-split').click()"); await sleep(800);
  await evalJS("(() => { const s = document.getElementById('split-method'); s.value = 'material'; s.dispatchEvent(new Event('change', { bubbles: true })); })()"); await sleep(500);
  const note = await evalJS("document.getElementById('split-eps-readout')?.textContent || ''");
  check('the panel says what the Material choice does', /material/i.test(note), note);
  const prev = await evalJS("document.getElementById('split-preview')?.textContent || ''");
  console.log('preview:', prev);
  await evalJS("document.getElementById('btn-split-selected').click()"); await sleep(2500);
  const kids = await evalJS(`(() => { const p = window.state.partById.get(${id}); const ids = p._splitInto || []; return ids.map(i => { const q = window.state.partById.get(i); const m = q.mesh; return { name: q.name, tris: q.triCount, hex: m.material && m.material.color ? m.material.color.getHex() : null, arr: Array.isArray(m.material), groups: m.geometry.groups.length, orig: q.originalColor.getHex() }; }); })()`);
  check('the part came apart into two parts', Array.isArray(kids) && kids.length === 2, kids);
  check('named after their materials', kids.length === 2 && /__Steel$/.test(kids[0].name) && /__Red$/.test(kids[1].name), kids.map(k => k.name));
  check('each wears its own material, not an array', kids.length === 2 && kids.every(k => !k.arr && k.groups === 0), kids);
  check('the red one is red, in the material and in the part colour', kids.length === 2 && kids[1].hex === 0xff0000 && kids[1].orig === 0xff0000 && kids[0].hex !== 0xff0000, kids);
  check('the triangles add up', kids.length === 2 && kids[0].tris + kids[1].tris === made.n / 3, { kids, n: made.n / 3 });
  const after = JSON.parse((await call('scene_summary', {})).text).parts;
  check('the scene has one part more', after === before + 1, { before, after });
  // a part with one material is left alone
  await call('select_parts', { ids: [solo] });
  await evalJS("document.getElementById('btn-split-selected').click()"); await sleep(1500);
  const soloKids = await evalJS(`(window.state.partById.get(${solo})._splitInto || []).length`);
  check('a part with a single material is left as it is', soloKids === 0, soloKids);
  // undo gives the part back
  await call('undo', {}); await sleep(800);
  const back = JSON.parse((await call('scene_summary', {})).text).parts;
  check('one undo gives the part back', back === before, { back, before });
  // Claude's tool
  await evalJS(`(() => { const p = window.state.partById.get(${id}); const m = p.mesh; if (!Array.isArray(m.material)) return; })()`);
  const t = await call('split_parts', { ids: [id], method: 'material' });
  check('split_parts takes method material', t.ok && /material/.test(t.text) && /new_parts/.test(t.text), t.e || t.text);
  check('no script error', errors.length === 0, errors.slice(0, 2));
} catch (e) { fail++; console.log('FAIL exception', e.message); }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
