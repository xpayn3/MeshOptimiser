// node tests/e2e-uv-carry.mjs
// The mesh tools keep a part's texture coordinates. UV spheres (UV = longitude and latitude) are opened in the real app, each tool is run
// on one (Close cracks, Smooth surface, Remesh evenly, Remove slivers, Convex hull, Voxel remesh, Round part, and a Union of two), and the UVs of the
// result are compared with the sphere's own at the middle of each triangle: they must be there, not all zero, and within a few hundredths.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9357, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-uvcarry-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name, process.env.VERBOSE && extra !== undefined ? JSON.stringify(extra) : ''); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ready = async () => { for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); } await sleep(1500); };
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};

// UV spheres (UV = longitude / latitude, seam at longitude 0), one per tool, side by side
const LAT = 24, LON = 48, N = 10, cxOf = (k) => (k - (N - 1) / 2) * 2.6;
function spheresObj() {
  const out = []; let base = 0;
  for (let k = 0; k < N; k++) {
    out.push('o s' + k);
    for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) { const th = i / LAT * Math.PI, ph = j / LON * Math.PI * 2; out.push('v ' + (cxOf(k) + Math.sin(th) * Math.cos(ph)).toFixed(6) + ' ' + Math.cos(th).toFixed(6) + ' ' + (Math.sin(th) * Math.sin(ph)).toFixed(6)); }
    for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) out.push('vt ' + (j / LON).toFixed(6) + ' ' + (1 - i / LAT).toFixed(6));
    const vid = (i, j) => base + i * (LON + 1) + j + 1;
    for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) { const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1); out.push('f ' + a + '/' + a + ' ' + c + '/' + c + ' ' + b + '/' + b, 'f ' + a + '/' + a + ' ' + d + '/' + d + ' ' + c + '/' + c); }
    base += (LAT + 1) * (LON + 1);
  }
  return out.join(String.fromCharCode(10));
}

// how far a part's UVs are from the sphere's own: for each triangle, the UV of its middle (from its corners) against the UV the sphere has at
// that point (longitude / latitude); triangles astride the seam and at the poles are left out (no single expected UV there)
const uvError = (k) => evalJS(`(() => {
  const p = window.state.parts.find(q => q.name === 's${k}'), g = p.mesh.geometry, P = g.attributes.position, U = g.attributes.uv, I = g.index;
  if (!U) return { hasUv: false };
  const cx = ${cxOf(k)}, errs = []; let zero = 0;
  const n = I ? I.count / 3 : P.count / 3;
  for (let t = 0; t < n; t++) {
    const c = [0, 1, 2].map(j => I ? I.getX(t * 3 + j) : t * 3 + j);
    let x = 0, y = 0, z = 0, u = 0, v = 0; for (const i of c) { x += P.getX(i) / 3; y += P.getY(i) / 3; z += P.getZ(i) / 3; u += U.getX(i) / 3; v += U.getY(i) / 3; }
    const us = c.map(i => U.getX(i)); if (us.every(q => q === 0) && c.every(i => U.getY(i) === 0)) zero++;
    if (Math.max(...us) - Math.min(...us) > 0.5) continue;
    // (the OBJ is Y up and the app stands it upright, Z up: the file's y is the app's z, the file's z the app's -y)
    const fy = z, fz = -y;
    const r = Math.hypot(x - cx, fy, fz) || 1, th = Math.acos(Math.max(-1, Math.min(1, fy / r)));
    let ph = Math.atan2(fz, x - cx); if (ph < 0) ph += Math.PI * 2;
    const eu = ph / (Math.PI * 2), ev = th / Math.PI;      // (the file's V is 1 - th / pi, from the bottom; the app holds V from the top, as glTF)
    if (Math.abs(eu - u) > 0.5) continue;
    if (ev < 0.06 || ev > 0.94) continue;
    errs.push(Math.max(Math.abs(eu - u), Math.abs(ev - v)));
  }
  errs.sort((a, b) => a - b);
  return { hasUv: true, tris: n, checked: errs.length, median: +(errs[errs.length >> 1] || 0).toFixed(4), p95: +(errs[Math.floor(errs.length * 0.95)] || 0).toFixed(4), zero };
})()`);

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const f = new File([${JSON.stringify(spheresObj())}], 'uvspheres.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
  await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  for (let i = 0; i < 60; i++) { if (await evalJS("window.state && window.state.parts.length >= " + N).catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  const idOf = (k) => evalJS(`window.state.parts.find(p => p.name === 's${k}').partId`);
  const tris = (k) => evalJS(`window.state.parts.find(p => p.name === 's${k}').triCount`);

  const before = await uvError(0);
  check('the spheres come in with their UVs', before.hasUv && before.p95 < 0.02, before);
  const runs = [
    ['Close cracks', (id) => `window.__moAgent.meshOp('closeCracks', { ids: [${id}], quiet: true })`],
    ['Smooth surface', (id) => `window.__moAgent.meshOp('smoothSurface', { ids: [${id}], quiet: true })`],
    ['Remesh evenly', (id) => `window.__moAgent.meshOp('remeshEvenly', { ids: [${id}], quiet: true })`],
    ['Remove slivers', (id) => `window.__moAgent.meshOp('removeSlivers', { ids: [${id}], quiet: true })`],
    ['Convex hull', (id) => `window.__moAgent.meshOp('convexHull', { ids: [${id}], quiet: true })`],
    ['Voxel remesh', (id) => `window.__moAgent.voxelRemesh({ ids: [${id}], quiet: true })`],
    ['Round part (make solid)', (id) => `window.__moAgent.fillGrooves({ ids: [${id}], mode: 'outline', quiet: true })`],
  ];
  for (let k = 0; k < runs.length; k++) {
    const [name, call] = runs[k], pid = await idOf(k), tb = await tris(k);
    let res; try { res = await evalJS(`(async () => { window.state.selected = new Set([${pid}]); const r = await ${call(pid)}; return r ? { parts: r.parts, why: r.results && r.results[0] && r.results[0].why } : null; })()`); } catch (e) { res = { err: e.message }; }
    await sleep(500);
    const e = await uvError(k), ta = await tris(k);
    check(name + ': the part keeps its UVs and they follow the sphere', e.hasUv && e.p95 < 0.03 && e.zero === 0, { res, tris: [tb, ta], ...e });
  }
  // a union of the last sphere with the one before it (moved to overlap): the first one picked keeps its UVs where its surface is left
  {
    const a = await idOf(7), b = await idOf(5);
    await evalJS(`(() => { const m = window.state.parts.find(p => p.name === 's5').mesh; m.position.x += 2 * 2.6 - 1.2; m.updateMatrixWorld(true); return true; })()`);
    let res; try { res = await evalJS(`(async () => { window.state.selected = new Set([${a}, ${b}]); const r = await window.__moAgent.meshOp('union', { ids: [${a}, ${b}], quiet: true }); return r ? { parts: r.parts, why: r.results && r.results[0] && r.results[0].why } : null; })()`); } catch (e) { res = { err: e.message }; }
    await sleep(500);
    const e = await uvError(7);
    check('Union: the first part keeps its UVs', e.hasUv && e.median < 0.02 && e.zero === 0, { res, ...e });
  }
  // Decimate by half (Claude's tool): the simplifier keeps the vertex buffer, so the UVs that remain are the sphere's own
  {
    const pid = await idOf(8), tb = await tris(8);
    let res; try { res = await evalJS(`(async () => (await window.__moBridgeTools.decimate({ ids: [${pid}], reduce_percent: 50 }))[0].text)()`); } catch (e) { res = e.message; }
    await sleep(500);
    const e = await uvError(8), ta = await tris(8);
    check('Decimate: the part keeps its UVs', e.hasUv && ta < tb && e.p95 < 0.03 && e.zero === 0, { tris: [tb, ta], ...e, res: String(res).slice(0, 120) });
  }
  // Smart fit as blocks: the proxy gets UVs that span its faces, not all zero
  {
    const pid = await idOf(9);
    let res; try { res = await evalJS(`(async () => (await window.__moBridgeTools.smart_fit({ ids: [${pid}], shape: 'blocks' }))[0].text)()`); } catch (e) { res = e.message; }
    await sleep(500);
    const u = await evalJS(`(() => { const p = window.state.parts.find(q => q.name === 's9' && !q.deleted) || window.state.parts.filter(q => !q.deleted).pop(); const U = p.mesh && p.mesh.geometry.attributes.uv; if (!U) return null; let lo = Infinity, hi = -Infinity; for (let i = 0; i < U.array.length; i++) { lo = Math.min(lo, U.array[i]); hi = Math.max(hi, U.array[i]); } return { span: hi - lo, n: U.count }; })()`);
    check('Smart fit (blocks): the proxy has UVs that span its faces', u && u.span > 0.1, { u, res: String(res).slice(0, 120) });
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
} catch (e) { console.log('HARNESS ERROR:', e.message); fail++; }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(fail ? fail + ' failed, ' + pass + ' passed' : 'ok: ' + pass + ' passed');
process.exit(fail ? 1 : 0);
