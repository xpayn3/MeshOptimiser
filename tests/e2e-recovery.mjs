// node tests/e2e-recovery.mjs [model, default inbox/GearboxAssy.glb]
//
// Drives the recovery copies (Settings › General › Recovery) of the real app in headless Chrome: an edit makes the scene "not saved", a
// copy is written, undoing back to the saved state clears it, a second edit is copied again, the renderer is then killed (Page.crash, the
// way a crashed tab ends) and the app is started again: it must say it closed unexpectedly, offer the scene back, and bring it back with
// the edit in it, as a scene that is not saved. Also checks the new-scene defaults (unit, up axis).
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9347, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-recovery-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};
try {
  await attach();
  // the new-scene defaults: a stored choice is what the page starts with
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("localStorage.setItem('stepopt-prefs', JSON.stringify({ newUnit: 'cm', newUpAxis: 'y' }))");
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  check('new-scene unit default (cm) is applied', await evalJS("document.getElementById('display-units').value") === 'cm');
  check('new-scene up-axis default (Y) is applied', await evalJS("document.getElementById('scene-up-axis').value") === 'y');
  await evalJS("localStorage.setItem('stepopt-prefs', JSON.stringify({ newUnit: 'mm', newUpAxis: 'z' }))");
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  check('back to mm / Z-up', await evalJS("document.getElementById('display-units').value + document.getElementById('scene-up-axis').value") === 'mmz');

  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);
  check('the test hook exists', await evalJS("typeof window.__moAutosave?.now") === 'function');
  const s0 = await sum();
  check('a model is open', s0 && s0.parts > 5, s0);
  check('nothing to copy while the scene is as opened', (await evalJS("window.__moAutosave.now('test')")) === false && (await copies()).length === 0);

  // an edit: the scene is not saved, so a copy is written
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 3 });
  const del1 = await call('delete_parts', { ids: [lp.j.parts[0].id] });
  check('delete_parts', del1.ok, del1);
  const s1 = await sum();
  check('the edit changed the part count', s1.parts === s0.parts - 1, [s0.parts, s1.parts]);
  const t0 = Date.now();
  check('a copy is written', (await evalJS("window.__moAutosave.now('test')")) === true);
  const c1 = await copies();
  console.log('   copy took', Date.now() - t0, 'ms:', JSON.stringify(c1));
  check('one copy, with the parts that were left', c1.length === 1 && c1[0].parts === s1.parts && c1[0].size > 1000, c1);
  check('the copy has a name', c1[0] && c1[0].name && c1[0].name !== 'undefined');
  check('the copy keeps the unit and the up axis', c1[0] && c1[0].unit === 'mm' && c1[0].up === 'z', c1[0]);
  check('writing a copy shows no loader', !(await evalJS("document.getElementById('loader').classList.contains('show')")));

  // undone back to the saved state: the copy goes (within the 15 s check)
  await call('undo');
  await sleep(16500);
  check('undoing back to the saved state clears the copy', (await copies()).length === 0, await copies());

  // edit again, copy, then the tab crashes
  const lp2 = await call('list_parts', { sort_by: 'triangles', limit: 3 });
  await call('delete_parts', { ids: [lp2.j.parts[0].id] });
  const s2 = await sum();
  check('second edit', s2.parts === s0.parts - 1, [s0.parts, s2.parts]);
  check('a copy is written again', (await evalJS("window.__moAutosave.now('test')")) === true && (await copies()).length === 1);
  // Page.crash never answers (the page is gone), so it is not awaited; the socket is opened again on the same tab
  console.log('   crashing the tab'); send('Page.crash').catch(() => {});
  await sleep(2500);
  // a crashed tab cannot be driven any more: a new tab of the same profile takes its place (the locks of the dead page are gone)
  const dead = curId;
  try { ws.close(); } catch (_) {}
  pending.clear();
  await fetch(`http://127.0.0.1:${PORT}/json/new?` + encodeURIComponent(URL + '?t=' + Date.now()), { method: 'PUT' });
  await fetch(`http://127.0.0.1:${PORT}/json/close/` + dead).catch(() => {});
  await sleep(500);
  await attach();
  await ready();
  const panel = await evalJS("(() => { const p = document.getElementById('mo-recover'); return p && !p.hidden ? { title: p.querySelector('.mr-title').textContent, msg: p.querySelector('.mr-msg').textContent, acts: [...p.querySelectorAll('.mr-actions button')].map(b => b.textContent) } : null; })()");
  for (let i = 0; i < 20 && !panel; i++) { await sleep(500); }
  const panel2 = panel || await evalJS("(() => { const p = document.getElementById('mo-recover'); return p && !p.hidden ? { title: p.querySelector('.mr-title').textContent, msg: p.querySelector('.mr-msg').textContent, acts: [...p.querySelectorAll('.mr-actions button')].map(b => b.textContent) } : null; })()");
  console.log('   panel:', JSON.stringify(panel2));
  check('after the crash the app says so', panel2 && /unexpectedly/i.test(panel2.title), panel2);
  check('and offers the scene back', panel2 && panel2.acts.some(a => /^Recover/.test(a)) && panel2.acts.includes('Delete the copy') && panel2.acts.includes('Safe mode'), panel2);
  check('the offer names the scene', panel2 && /GearboxAssy|Untitled/i.test(panel2.msg), panel2 && panel2.msg);

  const tag = await evalJS("(() => { const t = document.querySelector('#welcome-recents .welcome-recent.is-recovered .wr-tag'); return t ? { text: t.textContent, bg: getComputedStyle(t).backgroundColor, first: !!t.closest('.welcome-recent').matches('#welcome-recents > :first-child'), wide: t.closest('.welcome-recent').classList.contains('is-resume') && document.querySelectorAll('#welcome-recents .is-resume').length === 1 } : null; })()");
  console.log('   recent tag:', JSON.stringify(tag));
  check('Recent shows the recovered scene as the yellow Continue card', tag && tag.text === 'Continue' && tag.wide, tag);
  check('the tag is yellow', tag && tag.bg === 'rgb(251, 191, 36)', tag);
  check('and the recovered scene leads the list', tag && tag.first, tag);
  await evalJS("[...document.querySelectorAll('#mo-recover .mr-actions button')].find(b => /^Recover/.test(b.textContent))?.click()");
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);
  const s3 = await sum();
  check('the recovered scene has the edit in it', s3 && s3.parts === s2.parts, [s2.parts, s3 && s3.parts]);
  const dot = await evalJS("(() => { const e = document.getElementById('doc-unsaved'); return e ? { empty: e.classList.contains('is-empty'), saved: e.classList.contains('is-saved') } : null; })()");
  check('and it counts as not saved', dot && !dot.empty && !dot.saved, dot);
  await sleep(1500);
  const c3 = await copies();
  check('the old copy is replaced by this page\'s own (one copy, not two)', c3 && c3.length === 1 && c3[0].parts === s2.parts, c3);
  check('the offer is gone once it was taken', await evalJS("document.getElementById('mo-recover').hidden !== false"));

  // F5 with unsaved changes is a choice, not a crash: no offer, no Recovered card, and the copy is gone
  const lp4 = await call('list_parts', { sort_by: 'triangles', limit: 3 });
  await call('delete_parts', { ids: [lp4.j.parts[0].id] });
  await evalJS("window.__moAutosave.now('test')");
  check('a copy exists before the reload', (await copies()).length === 1);
  await evalJS("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }))");
  await sleep(600);
  // (the way through is a slide-to-confirm track since v0.37.x: its thumb is moved with the arrow keys, three presses reach the end)
  const dlg = await evalJS("(() => { const t = document.querySelector('.cq-slide-thumb'); return t ? t.closest('.cq-card').innerText : null; })()");
  check('F5 asks first and says the changes are lost', dlg && /will be lost/i.test(dlg) && /not bring the scene back/i.test(dlg), dlg);
  evalJS("(() => { const t = document.querySelector('.cq-slide-thumb'); for (let i = 0; i < 3; i++) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); })()").catch(() => {});
  await sleep(3000);
  await ready();
  await sleep(3000);
  check('after the reload there is no recovery offer', await evalJS("(() => { const p = document.getElementById('mo-recover'); return !p || p.hidden; })()"));
  check('and no Recovered card in Recent', await evalJS("!document.querySelector('#welcome-recents .is-recovered')"));
  check('and the copy was deleted', (await copies()).length === 0, await copies());
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
