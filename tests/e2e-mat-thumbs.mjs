// node tests/e2e-mat-thumbs.mjs
// The texture slots of the material editor show small pictures, not the textures themselves:
//   1. the Fab table (TABLE_DIR, default the Fab cache on E:, skipped when it is not there) is dropped without its Roughness map, so its
//      roughness is Gloss turned over (a 4K picture made in the page); its material's editor is opened;
//   2. every filled slot shows a data: picture of at most 128 px (not the 4K picture's own address, not a 4K PNG of the canvas);
//   3. painting the slots again takes the kept pictures (a few ms, not the seconds a 4K PNG takes); the editor's own work on opening
//      (the double-click handler) stays under 600 ms (it was 760 ms, most of it scaling the 4K maps down);
//   4. a texture that changes gets a new picture: a canvas put in its place, and that canvas painted on again (its version goes up).
// Prints the times, so it can be run before and after a change. Needs the app served on APP_PORT (default 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9363, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-matthumbs-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const TABLE_DIR = process.env.TABLE_DIR || 'E:/FAB/VaultCache/FabLibrary/Wooden_Table-d69f8adb/fbx/high/wooden_table_veigfjmaw_h_extracted';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
if (!fs.existsSync(TABLE_DIR)) { console.log('SKIP: ' + TABLE_DIR + ' is not here'); process.exit(0); }
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(500); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
};

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready') && !!(window.state && window.state.parts)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click(); window.__drop = []; true");
  for (const n of fs.readdirSync(TABLE_DIR)) {
    if (/_Roughness\./i.test(n)) continue;                       // (so roughness comes from Gloss: a 4K canvas)
    const b64 = fs.readFileSync(path.join(TABLE_DIR, n)).toString('base64');
    await evalJS(`(() => { const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)); window.__drop.push(new File([bin], ${JSON.stringify(n)})); return true; })()`);
  }
  await evalJS(`(() => { const dt = new DataTransfer(); for (const f of window.__drop) dt.items.add(f); document.getElementById('viewport').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
  await evalJS("document.querySelector('#import-modal-confirm')?.click(); true");
  for (let i = 0; i < 120; i++) { if (await evalJS("(window.state.parts || []).some(p => !p.deleted && p.mesh && [].concat(p.mesh.material).some(m => m.map))")) break; await sleep(500); }
  await sleep(3000);

  // 1. the editor of the table's material
  const open = await evalJS(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const part = state.parts.find(p => !p.deleted && p.mesh && [].concat(p.mesh.material).some(m => m.map));
    const m = [].concat(part.mesh.material).find(x => x.map); window.__thumbMat = m;
    const row = [...document.querySelectorAll('.tree-node')].find(r => r.textContent.trim().startsWith(part.name));
    row && row.dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(300);
    const dock = document.getElementById('vp-materials-pop');
    if (!dock.classList.contains('show')) { document.getElementById('tg-materials').click(); await sleep(450); }
    let cell; for (let i = 0; i < 30 && !cell; i++) { cell = [...dock.querySelectorAll('.mat-cell, .mat-row')].find(c => c._mat === m); if (!cell) await sleep(100); }
    if (!cell) return { ok: false, why: 'no cell' };
    const long = []; const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }); po.observe({ type: 'longtask' });
    const t0 = performance.now();
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const handler = Math.round(performance.now() - t0);
    let ok = false; for (let i = 0; i < 300 && !ok; i++) { ok = !!document.querySelector('#_mat-editor-popup .mat-row-tex[data-tex-prop="map"].has-thumb'); if (!ok) await new Promise(r => setTimeout(r, 5)); }
    const shown = Math.round(performance.now() - t0);
    await new Promise(r => setTimeout(r, 1500)); po.disconnect();
    return { ok, ms: shown, handler, long, rough: m.roughnessMap && m.roughnessMap.image && m.roughnessMap.image.width, roughFromGloss: !!(m.roughnessMap && /as roughness/.test(m.roughnessMap.name)) };
  })()`);
  console.log('   editor open', JSON.stringify(open));
  check('the table opens with roughness from Gloss, 4K', open.roughFromGloss && open.rough >= 4096, open);

  // 2. what the slots show
  const slots = await evalJS(`(async () => { const out = [];
    for (const s of document.querySelectorAll('#_mat-editor-popup .mat-row-tex.has-tex')) {
      const bg = s.style.backgroundImage || '', u = (/url\\("?(.*?)"?\\)$/.exec(bg) || [])[1] || '';
      let w = 0; if (u) { const im = new Image(); im.src = u; try { await im.decode(); w = Math.max(im.naturalWidth, im.naturalHeight); } catch (_) {} }
      out.push({ prop: s.dataset.texProp, scheme: u.split(':')[0], kb: +(u.length / 1024).toFixed(1), px: w });
    } return out; })()`);
  console.log('   slots', JSON.stringify(slots));
  check('every filled slot shows a picture', slots.length >= 4 && slots.every(s => s.scheme), slots);
  check('each a small data: picture (at most 128 px, under 64 KB)', slots.every(s => s.scheme === 'data' && s.px > 0 && s.px <= 128 && s.kb < 64), slots);

  // 3. painting the slots again
  const again = await evalJS(`(async () => { const t0 = performance.now();
    for (let k = 0; k < 5; k++) for (const s of document.querySelectorAll('#_mat-editor-popup .mat-row-tex[data-tex-prop]')) { s.click(); document.body.click(); }
    return Math.round(performance.now() - t0); })()`);
  console.log('   5 rounds of the popovers on every slot:', again, 'ms');
  check('the slots open their popovers fast (5 rounds under 400 ms)', again < 400, again);
  check('the editor\'s own work on opening is under 600 ms', open.ok && open.handler < 600, open);

  // 4. a texture that changes gets a new picture
  const changed = await evalJS(`(async () => { const m = window.__thumbMat, s = () => document.querySelector('#_mat-editor-popup .mat-row-tex[data-tex-prop="roughnessMap"]');
    const pic = async () => { s().click(); await new Promise(r => setTimeout(r, 200)); const p = document.querySelector('#_mat-tex-pop img'); const u = p ? p.src : ''; document.body.click(); return u; };
    const before = await pic();
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 64, 64);
    m.roughnessMap.image = c; m.roughnessMap.needsUpdate = true; const red = await pic();
    x.fillStyle = '#0000ff'; x.fillRect(0, 0, 64, 64); m.roughnessMap.needsUpdate = true; const blue = await pic();
    return { differs: !!before && !!red && !!blue && before !== red && red !== blue }; })()`);
  check('a texture painted on gets a new picture', changed.differs, changed);
  check('no page errors', errors.length === 0, errors);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
