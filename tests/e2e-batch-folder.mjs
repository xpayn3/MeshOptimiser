// node tests/e2e-batch-folder.mjs [model.glb, default inbox/GearboxAssy.glb]
//
// Batch optimise, the card behind a folder: three models of a folder (OBJ spheres made here) are listed, optimised one after another
// (Smart optimise, light; each opens in a scene tab of its own, is exported into the exports folder and its tab is closed) while the
// scene that is open (the model) is not touched. Also: the start screen has the Batch folder tile and the search has the command. Needs the app served on http://localhost:4242, or APP_PORT.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9396, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-batch-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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
  check('the model is open', s0 && s0.parts > 5, s0);
  check('the search has the command', await evalJS("window._appFns._Actions.list.some(a => a.id === 'batchFolder' && /folder/i.test(a.label))"));
  check('the start screen has the tile', await evalJS("!!document.getElementById('welcome-batch')"));
  const tabsOpen = () => evalJS("window.top.__moTabs.tabs.filter(t => !t.closed).length");
  const tabs0 = await tabsOpen();
  // three models: OBJ spheres of different fineness, as the files of a folder
  await evalJS(`(() => {
    const sphere = (nu, nv) => {
      let v = 'v 0 100 0\\n', f = '';
      for (let j = 1; j < nv; j++) { const ph = Math.PI * j / nv; for (let i = 0; i < nu; i++) { const th = 2 * Math.PI * i / nu; v += 'v ' + (100 * Math.sin(ph) * Math.cos(th)).toFixed(3) + ' ' + (100 * Math.cos(ph)).toFixed(3) + ' ' + (100 * Math.sin(ph) * Math.sin(th)).toFixed(3) + '\\n'; } }
      v += 'v 0 -100 0\\n';
      for (let i = 0; i < nu; i++) f += 'f 1 ' + (2 + i) + ' ' + (2 + (i + 1) % nu) + '\\n';
      for (let j = 0; j < nv - 2; j++) for (let i = 0; i < nu; i++) { const a = 2 + j * nu + i, b = 2 + j * nu + (i + 1) % nu, c = a + nu, d = b + nu; f += 'f ' + a + ' ' + c + ' ' + b + '\\nf ' + b + ' ' + c + ' ' + d + '\\n'; }
      const last = 2 + (nv - 1) * nu, ring = 2 + (nv - 2) * nu;
      for (let i = 0; i < nu; i++) f += 'f ' + last + ' ' + (ring + (i + 1) % nu) + ' ' + (ring + i) + '\\n';
      return v + f;
    };
    window.__batchRels = [['balls/a_sphere.obj', new File([sphere(24, 16)], 'a_sphere.obj')], ['balls/b_sphere.obj', new File([sphere(32, 20)], 'b_sphere.obj')], ['balls/sub/c_sphere.obj', new File([sphere(40, 24)], 'c_sphere.obj')], ['balls/readme.txt', new File(['not a model'], 'readme.txt')]];
    return true;
  })()`);
  await evalJS("window.__moAgent.batchFolder(window.__batchRels, 'balls')"); await sleep(800);
  const card = () => evalJS("JSON.stringify({ shown: !document.querySelector('.section-cmd[data-cmd=\"batch\"]').hidden, rows: document.querySelectorAll('#bt-list .bt-row').length, lede: document.getElementById('bt-lede').textContent, run: document.querySelector('#bt-run span').textContent, level: (document.querySelector('#bt-level .active') || {}).dataset && document.querySelector('#bt-level .active').dataset.l })").then(JSON.parse);
  const c0 = await card();
  check('the card opens with the three models (the text file is left out)', c0.shown && c0.rows === 3 && /^3 models in balls/.test(c0.lede), c0);
  check('the button says how many files', c0.run === 'Optimise 3 files', c0);
  check('the level starts on Light', c0.level === 'light', c0);
  await evalJS("document.querySelector('#bt-level [data-l=\"balanced\"]').click()"); await sleep(200);
  check('a level can be chosen', (await card()).level === 'balanced');
  await evalJS("document.querySelector('#bt-level [data-l=\"light\"]').click()"); await sleep(200);
  const t0 = Date.now();
  await evalJS("document.getElementById('bt-run').click()");
  await sleep(1500);
  check('while it runs Stop is shown and Optimise is off', await evalJS("!document.getElementById('bt-stop').hidden && document.getElementById('bt-run').disabled"));
  for (let k = 0; k < 400 && await evalJS('window.__moAgent.batchBusy()'); k++) await sleep(1000);
  console.log('   (the batch took ' + Math.round((Date.now() - t0) / 1000) + ' s)');
  const rows = await evalJS("[...document.querySelectorAll('#bt-list .bt-row')].map(r => r.className + ' | ' + r.querySelector('.bt-st').textContent).join('\\n')");
  console.log(rows.split('\n').map(l => '   ' + l).join('\n'));
  check('every file is done, with its triangles before and after', rows.split('\n').length === 3 && rows.split('\n').every(l => /is-ok/.test(l) && /[\d,]+ → [\d,]+ triangles/.test(l)), rows);
  check('the info line says what was done and where it is saved', /3 of 3 done/.test(await evalJS("document.getElementById('bt-info').textContent")) && /exports folder/.test(await evalJS("document.getElementById('bt-info').textContent")));
  check('the scene that was open is untouched', (await sum()).parts === s0.parts && (await sum()).triangles === s0.triangles, [s0.parts, (await sum()).parts]);
  check('the scene tabs are as they were (each file closed its own)', (await tabsOpen()) === tabs0, [tabs0, await tabsOpen()]);
  check('Stop is gone again and Optimise is back', await evalJS("document.getElementById('bt-stop').hidden && !document.getElementById('bt-run').disabled"));
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'welcome').run()"); await sleep(800);
  check('the files of the batch are not in the Recent list of the start screen', !/sphere/.test(await evalJS("document.getElementById('welcome-recents').textContent")), await evalJS("document.getElementById('welcome-recents').textContent.slice(0, 160)"));
  await evalJS("document.getElementById('welcome-close').click()"); await sleep(300);
  // a folder dropped on the app (its entries, as a drop gives them): two or more models go to the card
  await evalJS(`(() => {
    const file = (name, f) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(f) });
    const dir = (name, kids) => ({ isFile: false, isDirectory: true, name, createReader() { let done = false; return { readEntries: (ok) => { if (done) ok([]); else { done = true; ok(kids); } } }; } });
    const r = window.__batchRels;
    window.__moAgent.dropFolder([dir('dropped', [file('a_sphere.obj', r[0][1]), file('b_sphere.obj', r[1][1]), dir('sub', [file('c_sphere.obj', r[2][1])]), file('readme.txt', r[3][1])])]);
    return true;
  })()`);
  await sleep(1200);
  const c1 = await card();
  check('a dropped folder with three models opens the card with them', c1.shown && c1.rows === 3 && /^3 models in dropped/.test(c1.lede), c1);
  // closing the card
  await evalJS("document.querySelector('.section-cmd[data-cmd=\"batch\"] .cmd-close').click()"); await sleep(300);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
