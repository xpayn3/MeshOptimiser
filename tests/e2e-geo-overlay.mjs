// node tests/e2e-history-card.mjs [model, default inbox/GearboxAssy.glb]
//
// The Model inspector's "Show in the view": a mesh with a hole in it gets its open edges drawn on the model, and they go when the kind is switched off.
// Needs the app served on APP_PORT (default 4242; use 4343 with its own server: python app/serve.py --no-browser --port 4343),
// Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9344, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let failed = 0;
const ok = (cond, what, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + what + (extra ? '  ' + extra : '')); if (!cond) failed++; };
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
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const b = await fetch(${JSON.stringify(MODEL)}).then(r => r.blob()); const f = new File([b], ${JSON.stringify(MODEL.split('/').pop())}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById('file-input') || document.querySelector('input[type=file]'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);

  const G = (c) => evalJS(c);
  // a part with a few triangles taken out: open edges
  const pid = await G(`(() => {
    const p = state.parts.filter(q => !q.deleted && q.mesh && q.mesh.geometry && q.mesh.geometry.index && q.mesh.geometry.index.count > 3000)[0];
    const g = p.mesh.geometry, ix = g.index.array, keep = new (ix.constructor)(ix.length - 60);
    keep.set(ix.subarray(0, ix.length - 60)); g.setIndex(new THREE.BufferAttribute(keep, 1)); g.index.version++;
    window.__pid = p.partId; return p.partId;
  })()`.replace('new THREE.BufferAttribute', 'new (_appFns.THREE.BufferAttribute)'));
  await G(`_appFns._Actions.list.find(a => a.id === 'inspectModel').run()`); await sleep(2000);
  ok(await G(`document.querySelectorAll('#_model-inspector .mi2-chip').length`) === 8, 'the window offers eight kinds to show');
  await G(`document.querySelector('#_model-inspector [data-mi2=scan]').click()`);
  for (let i = 0; i < 100; i++) { if (await G(`document.querySelector('#_model-inspector [data-mi2=scan]')?.textContent === 'Scan again'`)) break; await sleep(300); }
  const chips = await G(`[...document.querySelectorAll('#_model-inspector .mi2-chip')].map(c => [c.dataset.k, c.querySelector('.mi2-cn').textContent, c.disabled])`);
  console.log('chips', JSON.stringify(chips));
  ok(chips.find(c => c[0] === 'open' && c[1] !== '' && c[1] !== '0' && !c[2]), 'after the scan, Open edges has a count and is on offer', JSON.stringify(chips));
  const nPl = () => G(`document.querySelectorAll('#_model-inspector .mi2-plist').length`);
  const n0 = await nPl();
  await G(`document.querySelector('#_model-inspector .mi2-row.can-open .mi2-l').click()`); await sleep(400);
  ok((await nPl()) === n0 + 1, 'a click on the name of a check opens its parts, not only the arrow');
  await G(`document.querySelector('#_model-inspector .mi2-row.can-open .mi2-n').click()`); await sleep(400);
  ok((await nPl()) === n0, 'and a second click on the strip closes them');
  await G(`document.querySelector('#_model-inspector [data-k=open]').click()`);
  for (let i = 0; i < 40; i++) { if (await G('window.__moGeoOverlay.count()') > 0) break; await sleep(250); }
  ok((await G('window.__moGeoOverlay.count()')) > 0, 'a click on Open edges puts lines on the model');
  ok(await G(`(() => { const p = state.parts.find(q => q.partId === window.__pid); return p.mesh.children.some(c => c.name === '__geo_open' && c.userData.noPick); })()`), 'on the part that has them, and they cannot be picked');
  ok(await G(`document.querySelector('#_model-inspector [data-k=open]').getAttribute('aria-pressed') === 'true'`), 'the chip shows it is on');
  await G(`(() => { const b = document.querySelector('#_model-inspector .dlg-body'); b.scrollTop = b.scrollHeight; })()`);
  await sleep(600);
  if (process.env.SHOT) { const shot = await send('Page.captureScreenshot', { format: 'png' }); (await import('fs')).writeFileSync(process.env.SHOT, Buffer.from(shot.data, 'base64')); }
  await G(`document.querySelector('#_model-inspector [data-k=open]').click()`);
  for (let i = 0; i < 20; i++) { if ((await G('window.__moGeoOverlay.count()')) === 0) break; await sleep(200); }
  ok((await G('window.__moGeoOverlay.count()')) === 0, 'a second click takes them off again');
  ok(await G(`!state.parts.find(q => q.partId === window.__pid).mesh.children.some(c => /^__geo/.test(c.name))`), 'and leaves nothing on the part');
  await G(`window.__moGeoOverlay.show('flip', true)`); await sleep(1500);
  await G(`document.querySelector('#_model-inspector .dlg-close, #_model-inspector [aria-label=Close]')?.click()`); await sleep(500);
  ok((await G('window.__moGeoOverlay.count()')) === 0 && (await G('window.__moGeoOverlay.kinds().length')) === 0, 'closing the window takes every overlay off');
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { if (errors.length) console.log('page errors:', errors.slice(0, 5)); try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
