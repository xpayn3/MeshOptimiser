// node tests/e2e-xray-ghost.mjs [model, default inbox/GearboxAssy.glb]
//
// X-ray isolate (Filters & flags): with parts flagged, the X-ray button shows them as they are and every other part as a see-through ghost;
// a selected part is not a ghost; an export never sees a ghost; the dial under the comma key sets how much of the ghosts shows; off, every
// part has its own material back. Needs the app served (python app/serve.py --no-browser --port 4343; APP_PORT overrides 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9481, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-xray-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const attach = async () => {
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
};
const key = async (type, k, code, vk) => send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, text: type === 'keyDown' ? k : undefined });
const mouse = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
const X = (expr) => evalJS('(() => { const g = window.__moXrayGhost; return ' + expr + '; })()');
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moOpenFile && window.__moXrayGhost && window._appFns)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click(); true");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); window.__moOpenFile(new File([b], ${JSON.stringify(path.basename(MODEL))})); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(5000);
  const parts = await evalJS("state.parts.filter(p => !p.deleted && p.mesh && p.mesh.isMesh && !p.instancedMesh).map(p => p.partId)");
  check('a model is open', parts.length > 10, parts.length);
  check('the X-ray button is in Filters & flags, next to Highlight and Isolate', await evalJS("!!document.querySelector('#btn-xray-isolate') && !!document.querySelector('#btn-isolate-flags') && document.querySelector('#btn-xray-isolate').parentElement === document.querySelector('#btn-isolate-flags').parentElement"));

  // 1. nothing flagged: it says so and stays off
  await evalJS("document.getElementById('btn-xray-isolate').click()"); await sleep(300);
  check('with nothing flagged it stays off', (await X('g.on')) === false);

  // 2. five parts flagged
  const flagged = parts.slice(0, 5);
  await evalJS(`(() => { state.pendingFlagged.clear(); for (const id of ${JSON.stringify(flagged)}) { state.pendingFlagged.add(id); const p = state.parts.find(q => q.partId === id); if (p) p.flagged = true; } })()`);
  const before = await evalJS(`(() => Object.fromEntries(state.parts.filter(p => p.mesh).map(p => [p.partId, p.mesh.material && p.mesh.material.uuid])))()`);
  await evalJS("document.getElementById('btn-xray-isolate').click()"); await sleep(700);
  check('now it is on', (await X('g.on')) === true);
  const want = parts.length - flagged.length;
  check('every other part is a ghost (' + want + ')', (await X('g.ghosted')) === want, await X('g.ghosted'));
  const st = await evalJS(`(() => { const ghost = (p) => !!(p.mesh && p.mesh.material && p.mesh.material.userData && p.mesh.material.userData.isGhost); const ps = state.parts.filter(p => !p.deleted && p.mesh); const fl = ${JSON.stringify(flagged)}; const g = ps.find(p => ghost(p)).mesh.material; return { flaggedGhost: ps.filter(p => fl.includes(p.partId) && ghost(p)).length, flaggedSame: ps.filter(p => fl.includes(p.partId)).every(p => p.mesh.material.uuid === ${JSON.stringify(before)}[p.partId]), transparent: g.transparent, opacity: g.opacity, same: g.type === window._appFns._exportDrawList(false).find(it => it.part.mesh.material === g).srcMat.type, kept: g.color.getHex() === window._appFns._exportDrawList(false).find(it => it.part.mesh.material === g).srcMat.color.getHex(), depthWrite: g.depthWrite, depthTest: g.depthTest }; })()`);
  check('the flagged parts are not ghosts and keep their own material', st.flaggedGhost === 0 && st.flaggedSame, st);
  check('a ghost is the material of the part made see-through (same kind, same colour; no glow), at the opacity of the dial, behind what is solid', st.transparent && st.same && st.kept && Math.abs(st.opacity - 0.18) < 1e-6 && st.depthWrite === false && st.depthTest === true, st);
  const accent = await evalJS("(() => { const b = document.getElementById('btn-xray-isolate'); const probe = document.createElement('i'); probe.style.background = 'var(--ac)'; document.body.appendChild(probe); const ac = getComputedStyle(probe).backgroundColor; probe.remove(); return { bg: getComputedStyle(b).backgroundColor, ac, active: b.classList.contains('active') }; })()");
  check('the button is in the accent colour while it is on', accent.active && accent.bg === accent.ac, accent);

  // 3. an export never sees a ghost
  const ex = await evalJS("(() => { const l = window._appFns._exportDrawList(true); return { n: l.length, ghosts: l.filter(it => it.srcMat && it.srcMat.userData && it.srcMat.userData.isGhost).length, transparent: l.filter(it => it.srcMat && it.srcMat.transparent && it.srcMat.opacity < 0.99).length }; })()");
  check('an export sees no ghost material', ex.n > 10 && ex.ghosts === 0 && ex.transparent === 0, ex);

  // 3b. the ghosts are drawn far to near by the depth of the middle of their shape, whichever way the camera looks (they used to jump in front of or
  // behind each other: three sorted them by the origin of each part)
  for (const [view, turn] of [['perspective', 0], ['perspective', 130], ['top', 0], ['front', 40], ['side', 200]]) {
    await evalJS(`window.__moBridgeTools.set_camera_view(${JSON.stringify({ view, turn_deg: turn })}).then(() => true)`); await sleep(1200);
    const o = await evalJS(`(() => {
      const cam = window._appFns.camera, T = window._appFns.THREE; cam.updateMatrixWorld(true);
      const v = new T.Vector3(), rows = [];
      for (const p of state.parts) { const m = p.mesh && p.mesh.material; if (!(m && m.userData && m.userData.isGhost)) continue; const g = p.mesh.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); p.mesh.updateWorldMatrix(true, false); v.copy(g.boundingSphere.center).applyMatrix4(p.mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse); rows.push([p.mesh.renderOrder, v.z]); }
      rows.sort((a, b) => a[0] - b[0]);
      let bad = 0, pairs = 0; for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) { pairs++; if (rows[i][1] > rows[j][1] + 1e-6) bad++; }
      return { n: rows.length, bad, pairs, distinct: new Set(rows.map(r => r[0])).size, min: rows[0] && rows[0][0] };
    })()`);
    check('the ghosts are drawn far to near (' + view + ', turned ' + turn + '): ' + o.bad + ' of ' + o.pairs + ' pairs the wrong way round', o.n > 10 && o.bad === 0 && o.distinct === o.n && o.min >= 100, o);
  }
  // 4. a selected part is not a ghost
  const pick = parts[10];
  await evalJS(`(async () => { await window.__moBridgeTools.select_parts({ ids: [${pick}] }); return true; })()`); await sleep(700);
  check('a selected part is not a ghost', await evalJS(`(() => { const p = state.parts.find(q => q.partId === ${pick}); return !(p.mesh.material.userData && p.mesh.material.userData.isGhost); })()`));
  check('and one ghost fewer', (await X('g.ghosted')) === want - 1, await X('g.ghosted'));
  await evalJS("(() => { state.selected.clear(); return true; })()"); await sleep(700);

  // 5. the dial under the comma key
  await mouse(700, 500); await sleep(100);
  await key('keyDown', ',', 'Comma', 188); await sleep(300);
  check('holding the comma key shows the dial', (await X('g.dialShown')) === true);
  const op0 = await X('g.opacity');
  for (let i = 1; i <= 10; i++) { await mouse(700, 500 - i * 4); await sleep(30); }
  const op1 = await X('g.opacity');
  check('moving up lets more of the ghosts show (' + Math.round(op0) + ' → ' + Math.round(op1) + ' %)', op1 > op0 + 5, [op0, op1]);
  check('and the ghosts follow it', await evalJS(`(() => { const p = state.parts.find(q => q.partId === ${parts[20]}); return Math.abs(p.mesh.material.opacity - ${op1} / 100) < 1e-6; })()`));
  for (let i = 1; i <= 30; i++) { await mouse(700, 460 + i * 8); await sleep(20); }
  check('moving down lets less show', (await X('g.opacity')) < op1 - 10, await X('g.opacity'));
  check('the setting is kept (this browser)', await evalJS("JSON.parse(localStorage.getItem('stepopt-prefs') || '{}').ghostOpacity === window.__moXrayGhost.opacity"));
  // at 0 % nothing of the ghosts is drawn
  for (let i = 1; i <= 40; i++) { await mouse(700, 700 + i * 12); await sleep(15); }
  check('at 0 % no ghost is drawn', (await X('g.opacity')) === 0 && await evalJS(`(() => { const p = state.parts.find(q => q.partId === ${parts[20]}); return p.mesh.material.visible === false && p.mesh.material.opacity === 0; })()`), await X('g.opacity'));
  await key('keyUp', ',', 'Comma', 188); await sleep(300);
  check('letting go hides the dial', (await X('g.dialShown')) === false);

  // 6. a comma typed in a field does nothing
  check('a field has the keyboard', await evalJS("(() => { const i = document.querySelector('input[placeholder^=\"Search parts\"]'); i.focus(); return document.activeElement === i; })()"));
  await key('keyDown', ',', 'Comma', 188); await sleep(200);
  check('a comma typed in a field does not show the dial', (await X('g.dialShown')) === false);
  await key('keyUp', ',', 'Comma', 188);
  await evalJS("document.activeElement && document.activeElement.blur()");

  // 7. off: every part has its own material back
  await evalJS("document.getElementById('btn-xray-isolate').click()"); await sleep(700);
  check('off: the button is off', (await X('g.on')) === false && (await evalJS("!document.getElementById('btn-xray-isolate').classList.contains('active')")));
  check('off: every part has its own material back', await evalJS(`(() => { const b = ${JSON.stringify(before)}; return state.parts.filter(p => p.mesh).every(p => p.mesh.material.uuid === b[p.partId]); })()`));
  check('no uncaught page errors', errors.filter(e => !/ResizeObserver/.test(e)).length === 0, errors.slice(0, 4));
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
