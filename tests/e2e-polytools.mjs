// node tests/e2e-polytools.mjs <folder for screenshots> [model, default inbox/Drive_Unit_DU-240.glb]
//
// Runs Repair mesh, Remove hidden faces, Merge by and Select by rule in the real app (headless Chrome, software WebGL2, no
// window shown) and prints what each reports, the triangle counts before and after, and every JavaScript error.
// Needs the app served on http://localhost:4242 (python serve.py --no-browser --port 4242) and Chrome installed.
import { spawn } from 'child_process';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2] || '.';
const MODEL = process.argv[3] || 'inbox/Drive_Unit_DU-240.glb';
const PORT = 9334, PROFILE = process.env.TEMP + '/cdp-profile-poly-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], consoleErr = [], logs = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); console.log('screenshot', name); };
const tris = () => evalJS("(document.getElementById('vp-tris')?.textContent || '').trim()");
const text = (id) => evalJS(`(document.getElementById(${JSON.stringify(id)})?.textContent || '').trim()`);
const click = (sel) => evalJS(`document.querySelector(${JSON.stringify(sel)})?.click(), true`);
// the four tools have no toolbar button: they open from the command palette, which opens the card like this
const openCard = (name) => evalJS(`(() => { const c = document.querySelector('.section-cmd[data-cmd="${name}"]'); c.hidden = false; c.dispatchEvent(new CustomEvent("cmd-open")); return true; })()`);
const waitIdle = async (what, max = 240) => { for (let i = 0; i < max; i++) { const busy = await evalJS("!!document.querySelector('#loader.show, #loader:not([hidden]).show, .loader.show')").catch(() => false); if (!busy && i > 2) return; await sleep(500); } console.log('(still busy after waiting for ' + what + ')'); };
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n')[0]);
    else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) consoleErr.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 260));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:4242/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  console.log('app ready:', await evalJS("document.body.classList.contains('app-ready')"));
  await sleep(1500);
  await click('#welcome-close');
  console.log('loading', MODEL);
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(MODEL.split('/').pop())}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) { console.log('tree rows:', n); break; } await sleep(500); }
  await sleep(4000);
  console.log('triangles at start:', await tris());
  await shot('p0-loaded');

  // ── Repair mesh, on the whole scene
  await openCard('repair'); await sleep(500);
  await click('#rp-scope [data-scope="all"]'); await sleep(200);
  await shot('p1-repair-card');
  console.log('repair hint:', await text('rp-info'));
  await click('#rp-run'); await waitIdle('repair'); await sleep(1000);
  console.log('repair result:', await text('rp-info'));
  console.log('triangles after repair:', await tris());
  await shot('p2-repaired');
  // undo it
  await evalJS("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(800);
  console.log('triangles after undo:', await tris());

  // ── Remove hidden faces, on a few selected parts (all of them would take a long time in software GL)
  await openCard('hidfaces'); await sleep(500);
  await evalJS("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))"); await sleep(600);
  await click('#hf-views [data-views="26"]');
  await shot('p3-hidfaces-card');
  const t0 = Date.now();
  await click('#hf-run'); await waitIdle('hidden faces', 600); await sleep(1500);
  console.log('hidden faces took', Math.round((Date.now() - t0) / 1000), 's:', await text('hf-info'));
  console.log('triangles after hidden faces:', await tris());
  await shot('p4-hidfaces-done');
  await evalJS("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(800);
  console.log('triangles after undo:', await tris());

  // ── Merge by material, whole scene
  await openCard('mergeby'); await sleep(500);
  await click('#mb-scope [data-scope="all"]'); await sleep(300);
  console.log('merge preview:', await text('mb-info'));
  await shot('p5-mergeby-card');
  await click('#mb-run'); await waitIdle('merge'); await sleep(1500);
  console.log('merge result:', await text('mb-info'));
  console.log('parts after merge:', await text('vp-parts'));
  await shot('p6-merged');
  await evalJS("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(1000);
  console.log('parts after undo:', await text('vp-parts'));

  // ── Merge by group (nearest, then top-level)
  await click('#mb-mode [data-mode="group"]'); await sleep(300);
  console.log('group preview (nearest):', await text('mb-info'));
  await click('#mb-level [data-level="top"]'); await sleep(300);
  console.log('group preview (top level):', await text('mb-info'));
  await click('#mb-run'); await waitIdle('merge by group'); await sleep(1500);
  console.log('group merge result:', await text('mb-info'));
  console.log('parts after group merge:', await text('vp-parts'));
  await shot('p6b-merged-groups');
  await evalJS("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(1000);
  console.log('parts after undo:', await text('vp-parts'));

  // ── Select by rule
  await openCard('selrule'); await sleep(600);
  await evalJS("window.__moSelectByRule.rules.length = 0; window.__moSelectByRule.addRule({ field: 'tris', op: 'gt', value: '100' })"); await sleep(400);
  console.log('rule preview:', await text('sr-info'));
  await shot('p7-selrule-card');
  await click('#sr-run'); await sleep(800);
  console.log('rule result:', await text('sr-info'));
  await evalJS("window.__moSelectByRule.rules.length = 0; window.__moSelectByRule.addRule({ field: 'name', op: 'like', value: '*a*' }); window.__moSelectByRule.addRule({ field: 'shown', op: 'is', value: 'yes' })"); await sleep(400);
  console.log('two rules preview:', await text('sr-info'));
  await shot('p8-selrule-two');
  await click('#sr-match [data-match="any"]'); await sleep(300);
  console.log('any-rule preview:', await text('sr-info'));
  await click('#sr-run'); await sleep(500);
  const nAny = await text('sr-info');
  await click('#sr-mode [data-mode="remove"]');
  await evalJS("window.__moSelectByRule.rules.length = 0; window.__moSelectByRule.addRule({ field: 'name', op: 'contains', value: 'bolt' })"); await sleep(300);
  await click('#sr-run'); await sleep(500);
  console.log('after removing bolts:', await text('sr-info'), '| any-rule run:', nAny);
} catch (e) { console.log('HARNESS ERROR:', e.message); }
console.log('page exceptions:', errors.length); errors.slice(0, 10).forEach(e => console.log('  ' + e));
console.log('console errors/warnings:', consoleErr.length); consoleErr.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(0);
