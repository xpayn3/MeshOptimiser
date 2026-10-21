// node tests/e2e-edit-cache.mjs
//
// Edit mesh keeps the marks of the picked edges and points while neither the picks nor the view move (on a big assembly they were all
// worked out again at every paint, a pass of the pointer too). This checks that the kept marks still follow everything that should
// change them: a pass of the pointer leaves the picked edges' buffer alone; turning the view to the plate's back hides them and
// turning it back shows them again; a smaller pick draws fewer; a move of the gizmo moves them; Model mode and back draws them again;
// in Points mode a smaller pick draws fewer dots and Let go none; in Polygons mode the fill (drawn from the part's own points) comes and
// goes many times, follows a gizmo move, and never frees the part's own buffers. Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9372, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-editcache-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// GPU=1 runs on the real graphics card (WebGPU); without it, on swiftshader (WebGL2).
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => evalJS(`(async () => { try { const r = await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']').join('\\n') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
const until = async (expr, tries = 40, ms = 250) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr).catch(() => false)) return true; await sleep(ms); } return false; };
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.consoleAPICalled' && /\[gpu\]|buffer slot|GPUBuffer|not found on geometry/i.test((d.params.args || []).map(a => a.value).join(' '))) errors.push('console: ' + (d.params.args || []).map(a => a.value).join(' ').slice(0, 200));
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};

// a plate of 12 × 12 squares, one-sided, its faces all looking the same way
function model() {
  const N = 12, out = ['o plate'];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) out.push(`v ${i * 2} 0 ${j * 2}`);
  const v = (i, j) => j * (N + 1) + i + 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { out.push(`f ${v(i, j)} ${v(i, j + 1)} ${v(i + 1, j)}`); out.push(`f ${v(i + 1, j)} ${v(i, j + 1)} ${v(i + 1, j + 1)}`); }
  return out.join('\n');
}
// the picked edges' wide lines and the picked dots, as drawn now: how many, and the version of the edges' buffer
const PICKED = `(() => {
  let s = window.state.partsRoot; while (s.parent) s = s.parent;
  const g = s.getObjectByName('_elements'); if (!g) return { edges: 0, ver: -1, dots: 0, first: null };
  const fat = g.children.find(o => o.isMesh && o.geometry && o.geometry.isInstancedBufferGeometry && o.renderOrder === 16);
  const dot = g.children.find(o => o.isSprite && o.renderOrder === 12 && !o.userData.depthPass);
  const a = fat && fat.geometry.attributes.instanceStart;
  return { edges: fat && fat.visible ? fat.geometry.instanceCount : 0, ver: a ? a.version : -1, dots: dot && dot.visible ? dot.count : 0, first: a && fat.visible ? [a.array[0], a.array[1], a.array[2]] : null };
})()`;
// the camera on the side of the plate its faces look to (+1) or on its back (-1)
const SIDE = (k) => `(() => {
  const F = window._appFns, THREE = F.THREE, p = window.state.parts.find(q => !q.deleted && q.mesh);
  const g = p.mesh.geometry, pos = g.attributes.position, ix = g.index ? g.index.array : [0, 1, 2];
  p.mesh.updateWorldMatrix(true, false);
  const P = [0, 1, 2].map(i => new THREE.Vector3().fromBufferAttribute(pos, ix[i]).applyMatrix4(p.mesh.matrixWorld));
  const n = new THREE.Vector3().subVectors(P[1], P[0]).cross(new THREE.Vector3().subVectors(P[2], P[0])).normalize();
  const c = new THREE.Box3().setFromObject(p.mesh).getCenter(new THREE.Vector3());
  const up = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  F.camera.up.copy(up); F.camera.position.copy(c).addScaledVector(n, ${k} * 60).addScaledVector(up, 8); F.controls.target.copy(c); F.camera.lookAt(c); F.camera.updateMatrixWorld(true);
  try { F.controls.update(); } catch (_) {}
  try { F.controls.dispatchEvent({ type: 'change' }); } catch (_) {}
  F.requestRender();
  return true;
})()`;
const settle = () => evalJS("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))))");
const repaint = async () => { await evalJS("window.__moElements.count(); window._appFns.requestRender(); true"); await settle(); };

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const f = new File([${JSON.stringify(model())}], 'plate.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  if (await until("document.getElementById('import-modal').classList.contains('show')", 20)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  check('the plate opened', await until("window.state && window.state.parts.filter(p => !p.deleted && p.mesh).length === 1", 60, 500));
  await sleep(1500);
  await call('select_parts', { name_contains: 'plate' });
  await evalJS(SIDE(1)); await settle();

  // ── Edges ──
  await evalJS("window.__moElements.mode('edges'); window.__moElements.selectAll(); true"); await repaint(); await repaint();
  const all = await evalJS("window.__moElements.count('edges')");
  let m = await evalJS(PICKED);
  check('every edge picked is drawn, seen from the front', all > 100 && m.edges === all, { all, m });
  // a pass of the pointer over the view: the picked edges' buffer is not written again
  const ver0 = m.ver;
  for (let i = 0; i < 8; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 500 + i * 40, y: 400 + i * 15 }); await sleep(60); }
  await settle();
  m = await evalJS(PICKED);
  check('a pass of the pointer leaves the picked edges as they were', m.ver === ver0 && m.edges === all, { ver0, m });
  // the view turned to the plate's back: its faces look away, so its edges are behind it; and back again
  await evalJS(SIDE(-1)); await repaint();
  m = await evalJS(PICKED);
  check('seen from the back, no picked edge is drawn', m.edges === 0, m);
  await evalJS(SIDE(1)); await repaint();
  m = await evalJS(PICKED);
  check('turned to the front again, all of them are', m.edges === all, { all, m });
  // a smaller pick: the box round the middle of the view
  const nBox = await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return window.__moElements.boxPick(r.left + r.width * .45, r.top + r.height * .4, r.left + r.width * .55, r.top + r.height * .6, 'set'); })()");
  await repaint();
  m = await evalJS(PICKED);
  const nNow = await evalJS("window.__moElements.count('edges')");
  check('a smaller pick draws fewer edges, as many as are picked', nNow > 0 && nNow < all && m.edges === nNow, { nBox, nNow, m });
  // the gizmo moves them: the drawn edges move with them
  const before = m.first;
  const moved = await evalJS("window.__moElements.nudge(0, 0, 5)");
  await repaint();
  m = await evalJS(PICKED);
  check('a move of the gizmo moves the drawn edges', moved && before && m.first && Math.abs((m.first[2] - before[2]) - 5) < 0.6 && m.edges === nNow, { moved, before, after: m.first });
  // Model mode puts the marks away; back in Edges mode with the same picks and the same view they are drawn again
  await evalJS("window.__moElements.mode('model'); true"); await repaint();
  check('Model mode: no picked edge drawn', (await evalJS(PICKED)).edges === 0);
  await evalJS("window.__moElements.mode('edges'); true"); await repaint(); await repaint();
  const back = await evalJS("window.__moElements.count('edges')");
  m = await evalJS(PICKED);
  check('back in Edges mode the picked edges are drawn again', m.edges === back, { back, m });

  // ── Points ──
  await evalJS("window.__moElements.mode('points'); window.__moElements.clear(); window.__moElements.selectAll(); true"); await repaint(); await repaint();
  const pts = await evalJS("window.__moElements.count('points')");
  m = await evalJS(PICKED);
  check('every point picked is a dot', pts > 100 && m.dots === pts, { pts, m });
  await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return window.__moElements.boxPick(r.left + r.width * .45, r.top + r.height * .4, r.left + r.width * .55, r.top + r.height * .6, 'set'); })()");
  await repaint();
  const pNow = await evalJS("window.__moElements.count('points')");
  m = await evalJS(PICKED);
  check('a smaller pick draws fewer dots, as many as are picked', pNow > 0 && pNow < pts && m.dots === pNow, { pNow, m });
  await evalJS("window.__moElements.clear(); true"); await repaint();
  m = await evalJS(PICKED);
  check('Let go: no picked dot drawn', m.dots === 0, m);
  // ── Polygons: the fill draws from the part's own points; letting it go must leave the part's buffers alone ──
  await evalJS("window.__moElements.mode('faces'); true"); await repaint();
  const FILL = `(() => { let s = window.state.partsRoot; while (s.parent) s = s.parent; const g = s.getObjectByName('_elements'); const p = window.state.parts.find(q => !q.deleted && q.mesh);
    const f = g && g.children.find(o => o.isMesh && !o.geometry.isInstancedBufferGeometry && o.visible && o.renderOrder === 6), l = g && g.children.find(o => o.isLineSegments && o.renderOrder === 7 && o.visible);
    return { fill: f ? f.geometry.index.count / 3 : 0, shares: !!f && f.geometry.attributes.position === p.mesh.geometry.attributes.position, outline: !!l }; })()`;
  for (let round = 0; round < 4; round++) {
    await evalJS("window.__moElements.selectAll(); true"); await repaint();
    const nf = await evalJS("window.__moElements.count('faces')");
    const f = await evalJS(FILL);
    if (round === 0) check("Polygons: the fill shows every picked polygon from the part's own points, with outlines", nf > 50 && f.fill >= nf && f.shares && f.outline, { nf, f });
    await evalJS("window.__moElements.clear(); true"); await repaint();
    if (round === 0) check('Polygons: Let go takes the fill away', (await evalJS(FILL)).fill === 0);
  }
  await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return window.__moElements.boxPick(r.left + r.width * .4, r.top + r.height * .35, r.left + r.width * .6, r.top + r.height * .65, 'set'); })()"); await repaint();
  check('Polygons: a gizmo move of picked polygons', await evalJS("window.__moElements.nudge(0, 0, 3)")); await repaint();
  const fm = await evalJS(FILL);
  check('Polygons: after the move the fill draws from the moved shape', fm.fill > 0 && fm.shares, fm);
  await evalJS("window.__moElements.mode('model'); true"); await repaint(); await repaint();
  check('no page errors', errors.length === 0, errors.slice(0, 3));
} catch (e) { fail++; console.log('HARNESS ERROR', e); }
finally { console.log(`${pass} passed, ${fail} failed`); try { chrome.kill(); } catch (_) {} process.exit(fail ? 1 : 0); }
