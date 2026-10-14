// node tests/e2e-paste-group.mjs [model, default inbox/GearboxAssy.glb]
//
// Copies a group of the model's own tree (click its row, Ctrl+C) and pastes it (Ctrl+V): the result must be one new group, "<name> copy", with a
// copy of every part in it, the way other 3D apps do it; the tree keeps its groups (no flat list); undo takes the copy away, redo brings it back.
// Needs the app served on http://localhost:4242 (python serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9351, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-paste-' + Date.now();
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
  check('the test hook exists', await evalJS("typeof window.__moAutosave?.now") === 'function');
  const key = async (k, code, vk) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, modifiers: 2, key: k, code, windowsVirtualKeyCode: vk }); await sleep(600); };
  const s0 = await sum();
  check('a model is open', s0 && s0.parts > 5, s0);
  const grp = await evalJS("(() => { const r = document.querySelector('#tree .tree-node[data-group-id]'); return r ? { id: r.dataset.groupId, text: r.innerText.trim().split(String.fromCharCode(10))[0] } : null; })()");
  check('the tree has a group row', !!grp, grp);
  if (grp) {
    await evalJS(`document.querySelector('#tree .tree-node[data-group-id="${grp.id}"] .tree-label, #tree .tree-node[data-group-id="${grp.id}"]').click()`);
    await sleep(500);
    const nSel = (await call('get_selection')).j;
    console.log('   group:', JSON.stringify(grp), 'selected:', JSON.stringify(nSel).slice(0, 120));
    await key('c', 'KeyC', 67);
    await key('v', 'KeyV', 86);
    const s1 = await sum();
    const added = s1.parts - s0.parts;
    check('paste added parts', added > 0, [s0.parts, s1.parts]);
    const all = await call('list_parts', { limit: 5000 });
    const names = (all.j && all.j.parts || []).map(p => p.name);
    check('the copies keep the part names (no "copy" on each part)', !names.some(n => / copy( \d+)?$/.test(n)), names.filter(n => / copy/.test(n)).slice(0, 4));
    check('the tree still shows groups (not the flat list)', await evalJS("document.getElementById('tree').classList.contains('has-groups')"));
    const rowsText = await evalJS("[...document.querySelectorAll('#tree .tree-node[data-group-id]')].map(r => (r.querySelector('.tree-label') || r).textContent.trim())");
    console.log('   group rows in view:', JSON.stringify(rowsText.slice(0, 8)));
    check('a group row "... copy" exists', rowsText.some(t => / copy( \d+)?$/.test(t)) || (await evalJS(`(async()=>{const t=document.getElementById('tree');for(let y=0;y<=t.scrollHeight;y+=300){t.scrollTop=y;await new Promise(r=>setTimeout(r,120));if([...t.querySelectorAll('.tree-node')].some(n=>/ copy( \d+)?$/.test(n.textContent.trim())))return true;}return false;})()`)), rowsText.slice(0, 6));
    await call('undo');
    check('undo removes the whole copy', (await sum()).parts === s0.parts, (await sum()).parts);
    await call('redo');
    check('redo brings it back', (await sum()).parts === s1.parts, (await sum()).parts);
  }
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
