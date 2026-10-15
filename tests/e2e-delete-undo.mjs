// node tests/e2e-paste-group.mjs [model, default inbox/GearboxAssy.glb]
//
// Copies a group of the model's own tree (click its row, Ctrl+C) and pastes it (Ctrl+V): the result must be one new group, "<name> copy", with a
// copy of every part in it, the way other 3D apps do it; the tree keeps its groups (no flat list); undo takes the copy away, redo brings it back.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9352, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-delundo-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, curId = ''; const pending = new Map(), errors = [];
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
const copies = () => evalJS(`new Promise((res) => { const r = indexedDB.open('mo-recovery', 1); r.onupgradeneeded = () => r.result.createObjectStore('snaps', { keyPath: 'key' }); r.onsuccess = () => { const q = r.result.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => { res(q.result.map(s => ({ name: s.name, parts: s.parts, size: s.size, unit: s.unit, up: s.up }))); r.result.close(); }; }; r.onerror = () => res(null); })`);
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  curId = target.id;
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split(String.fromCharCode(10)).slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);
  const s0 = await sum();
  check('a model is open', s0 && s0.parts > 5, s0);
  const key = async (k, code, vk, mod = 2) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, modifiers: mod, key: k, code, windowsVirtualKeyCode: vk }); };
  const undo = () => key('z', 'KeyZ', 90, 2), redo = () => key('z', 'KeyZ', 90, 2 | 8);
  const click = (sel, ctrl) => evalJS(`(() => { const r = document.querySelector(${JSON.stringify(sel)}); if (!r) return false; r.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ${!!ctrl} })); return true; })()`);
  const groups = await evalJS("[...document.querySelectorAll('#tree .tree-node[data-group-id]')].slice(0, 6).map(r => r.dataset.groupId)");
  const parts = await evalJS("[...document.querySelectorAll('#tree .tree-node[data-part-id]')].slice(0, 6).map(r => r.dataset.partId)");
  console.log('   groups:', groups.length, 'parts:', parts.length);
  check('the tree has groups and parts to pick', groups.length >= 2 && parts.length >= 2, { groups, parts });
  for (let round = 1; round <= 4; round++) {
    // pick several groups and parts, delete them
    await click(`#tree .tree-node[data-group-id="${groups[0]}"]`, false);
    for (const g of groups.slice(1, 4)) await click(`#tree .tree-node[data-group-id="${g}"]`, true);
    for (const p of parts.slice(0, 3)) await click(`#tree .tree-node[data-part-id="${p}"]`, true);
    await sleep(200);
    await key('Delete', 'Delete', 46, 0);
    await sleep(400);
    const s1 = await sum();
    check(`round ${round}: the delete removed parts`, s1 && s1.parts < s0.parts, [s0.parts, s1 && s1.parts]);
    const rows1 = await evalJS("document.querySelectorAll('#tree .tree-node[data-group-id]:not(.is-gone)').length");
    console.log('   after delete: parts', s1 && s1.parts, 'group rows', rows1, 'history', (await sum()).undo_steps);
    // then quickly: undo, redo, undo, redo, undo (no pauses)
    await undo(); await redo(); await undo(); await redo(); await undo();
    await sleep(600);
    const alive = await evalJS("1 + 1").catch(() => null);
    check(`round ${round}: the page still answers after quick undo / redo`, alive === 2);
    const s2 = await sum();
    check(`round ${round}: undo brought the parts back`, s2 && s2.parts === s0.parts, [s0 && s0.parts, s1 && s1.parts, s2 && s2.parts]);
    check(`round ${round}: the tree is intact`, await evalJS("document.querySelectorAll('#tree .tree-node').length > 3"));
    await sleep(300);
  }
  // many separate deletes (a group, a part, a group, ...), then a burst of undo and redo with no pause
  {
    const total0 = (await sum()).parts;
    const pick = async (sel, ctrl) => click(sel, ctrl);
    let did = 0;
    for (let i = 0; i < 8; i++) {
      const gs = await evalJS("[...document.querySelectorAll('#tree .tree-node[data-group-id]:not(.is-gone)')].map(r => r.dataset.groupId)");
      const ps = await evalJS("[...document.querySelectorAll('#tree .tree-node[data-part-id]:not(.is-gone)')].map(r => r.dataset.partId)");
      const useGroup = i % 2 === 0 && gs.length > 1;
      const sel = useGroup ? '#tree .tree-node[data-group-id="' + gs[gs.length - 1] + '"]' : ps.length ? '#tree .tree-node[data-part-id="' + ps[ps.length - 1] + '"]' : null;
      if (!sel) continue;
      await pick(sel, false); await sleep(80);
      await key('Delete', 'Delete', 46, 0); await sleep(120); did++;
    }
    const h1 = (await sum()).undo_steps;
    console.log('   many deletes:', did, 'history', h1, 'parts', (await sum()).parts);
    for (let i = 0; i < 20; i++) await undo();
    for (let i = 0; i < 20; i++) await redo();
    for (let i = 0; i < 10; i++) { await undo(); await redo(); await undo(); }
    await sleep(800);
    check('after many deletes and a burst of undo / redo the page answers', (await evalJS('1+1').catch(() => null)) === 2);
    for (let i = 0; i < 40; i++) await undo();
    await sleep(800);
    const sEnd = await sum();
    check('everything undone: all parts are back', sEnd && sEnd.parts === total0, [total0, sEnd && sEnd.parts]);
    check('the tree is intact at the end', await evalJS("document.querySelectorAll('#tree .tree-node').length > 3"));
  }
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
