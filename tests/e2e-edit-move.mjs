// node tests/e2e-edit-move.mjs
//
// Edit mesh, a move of picked points with the gizmo. A move changes where the points are, not how the triangles hang together, so the
// part's reading is kept and only what the moved points change is worked out again round them, the gizmo's picking tree is refitted
// instead of built anew, and the shading of the moved corners looks only at the triangles round them (on a part of two million
// triangles a move took five seconds). This checks the kept results against ones made from nothing: the reading against
// meshedit.js's buildTopology on the moved shape (triangle normals, sharp edges, faces), the blue lines' slopes and the dots' normals
// against the same sums done here, the shading against renormal as it was (every triangle), the picking tree against plain rays;
// then that Undo puts the shape back and a second move works from the kept reading. Needs the app served on http://localhost:4242,
// Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9374, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-editmove-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// GPU=1 runs on the real graphics card (WebGPU); without it, on swiftshader (WebGL2).
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => evalJS(`(async () => { try { const r = await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
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
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  // (the console, for the check that a move refits the picking tree it had: window.__warns)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "(() => { window.__warns = []; for (const k of ['warn', 'error']) { const o = console[k]; console[k] = function (...a) { try { window.__warns.push(k + ': ' + a.map(String).join(' ').slice(0, 200)); } catch (_) {} return o.apply(this, a); }; } })()" });
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};

// a dome of 40 × 40 squares (an OBJ of triangles: the app pairs them into quads), with a fold across it so that it has sharp edges
// and more than one face
function model() {
  const N = 40, out = ['o dome'];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = i - N / 2, z = j - N / 2, y = 12 - (x * x + z * z) / 40 + (x > 6 ? (x - 6) * 1.5 : 0);
    out.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
  }
  const v = (i, j) => j * (N + 1) + i + 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { out.push(`f ${v(i, j)} ${v(i, j + 1)} ${v(i + 1, j)}`); out.push(`f ${v(i + 1, j)} ${v(i, j + 1)} ${v(i + 1, j + 1)}`); }
  return out.join('\n');
}

// In the page: the part's kept reading against references made from nothing on its shape as it is now. B: positions before the move
// (to find the moved corners), N0: the vertex normals before it.
const COMPARE = `(async (B, N0) => {
  const MEDIT = await import('/js/meshedit.js');
  const p = window.state.parts.find(q => !q.deleted && q.mesh), geom = p.mesh.geometry, P = geom.attributes.position.array, ix = geom.index ? geom.index.array : null;
  const R = window.__moElements.read(p.partId), T = R.topo, F = MEDIT.buildTopology(P, ix);
  const out = { nTri: T.nTri, nVert: T.nVert };
  let dn = 0; for (let i = 0; i < F.normal.length; i++) dn = Math.max(dn, Math.abs(F.normal[i] - T.normal[i]));
  out.normal = dn;
  let dk = 0; for (let e = 0; e < F.nEdge; e++) if (F.kind[e] !== T.kind[e]) dk++;
  out.kind = dk; out.sharp = F.kind.reduce((a, k) => a + (k === 1 ? 1 : 0), 0);
  let dr = 0; for (let t = 0; t < F.nTri; t++) if (F.region[t] !== T.region[t]) dr++;
  out.region = dr; out.nRegion = [F.nRegion, T.nRegion];
  out.positionsOwn = T.positions === P;
  out.facesAgain = !!(Object.getOwnPropertyDescriptor(T, 'region') || {}).get;      // (the move changed which edges are sharp: the faces were found again)
  // the blue lines' slopes, as slopeOf sums them
  {
    const nV = F.nVert, sum = new Float32Array(nV * 3), ref = new Float32Array(nV * 3), spread = new Float32Array(nV), nrm = F.normal, tri = F.tri;
    for (let i = 0; i < F.nTri; i++) { const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2]; if (!nx && !ny && !nz) continue;
      for (let k = 0; k < 3; k++) { const w = tri[i * 3 + k] * 3; if (!ref[w] && !ref[w + 1] && !ref[w + 2]) { ref[w] = nx; ref[w + 1] = ny; ref[w + 2] = nz; } const s = (nx * ref[w] + ny * ref[w + 1] + nz * ref[w + 2]) < 0 ? -1 : 1; sum[w] += s * nx; sum[w + 1] += s * ny; sum[w + 2] += s * nz; } }
    for (let w = 0; w < nV; w++) { const l = Math.hypot(sum[w * 3], sum[w * 3 + 1], sum[w * 3 + 2]) || 1; sum[w * 3] /= l; sum[w * 3 + 1] /= l; sum[w * 3 + 2] /= l; }
    for (let i = 0; i < F.nTri; i++) { const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2]; if (!nx && !ny && !nz) continue;
      for (let k = 0; k < 3; k++) { const w = tri[i * 3 + k], a = Math.acos(Math.min(1, Math.abs(nx * sum[w * 3] + ny * sum[w * 3 + 1] + nz * sum[w * 3 + 2]))); if (a > spread[w]) spread[w] = a; } }
    let ds = 0; const S = R.slope;
    if (!S) ds = -1; else for (let i = 0; i < F.nRaw; i++) { const w = F.weld[i]; ds = Math.max(ds, Math.abs(S[i * 4] - sum[w * 3]), Math.abs(S[i * 4 + 1] - sum[w * 3 + 1]), Math.abs(S[i * 4 + 2] - sum[w * 3 + 2]), Math.abs(S[i * 4 + 3] - spread[w])); }
    out.slope = ds;
  }
  // the vertex normals of the moved corners, as renormal worked them out for the whole part (EDIT_SHADE_DEG 60)
  {
    const pg = R.pg, polyOf = pg && pg.polyOf && pg.polyOf.length === F.nTri ? pg.polyOf : null, nRaw = P.length / 3, nTri = F.nTri;
    const corner = (t, k) => ix ? ix[t * 3 + k] : t * 3 + k;
    const fn = new Float32Array(nTri * 3), fa = new Float32Array(nTri);
    for (let t = 0; t < nTri; t++) { const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2);
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); fa[t] = l; if (l > 0) { fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l; } }
    let pn = null;
    if (polyOf) { pn = new Float32Array(pg.count * 3); for (let t = 0; t < nTri; t++) { const q = polyOf[t] * 3; pn[q] += fn[t * 3] * fa[t]; pn[q + 1] += fn[t * 3 + 1] * fa[t]; pn[q + 2] += fn[t * 3 + 2] * fa[t]; }
      for (let q = 0; q < pg.count; q++) { const l = Math.hypot(pn[q * 3], pn[q * 3 + 1], pn[q * 3 + 2]) || 1; pn[q * 3] /= l; pn[q * 3 + 1] /= l; pn[q * 3 + 2] /= l; } }
    const moved = new Uint8Array(nRaw); let nMoved = 0;
    for (let i = 0; i < nRaw; i++) if (P[i * 3] !== B[i * 3] || P[i * 3 + 1] !== B[i * 3 + 1] || P[i * 3 + 2] !== B[i * 3 + 2]) { moved[i] = 1; nMoved++; }
    const nV = F.nVert, start = new Uint32Array(nV + 1);
    for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) start[F.tri[t * 3 + k] + 1]++;
    for (let v = 0; v < nV; v++) start[v + 1] += start[v];
    const fill = start.slice(0, nV), around = new Uint32Array(nTri * 3);
    for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) around[fill[F.tri[t * 3 + k]]++] = t;
    const cosA = Math.cos(60 * Math.PI / 180), N = Float32Array.from(N0);
    const polyHit = polyOf ? new Uint8Array(pg.count) : null;
    if (polyHit) for (let t = 0; t < nTri; t++) if (moved[corner(t, 0)] || moved[corner(t, 1)] || moved[corner(t, 2)]) polyHit[polyOf[t]] = 1;
    const done = new Uint8Array(nRaw);
    for (let t = 0; t < nTri; t++) {
      if (!(moved[corner(t, 0)] || moved[corner(t, 1)] || moved[corner(t, 2)] || (polyHit && polyHit[polyOf[t]]))) continue;
      for (let k = 0; k < 3; k++) { const v = corner(t, k); if (done[v]) continue; done[v] = 1; const w = F.tri[t * 3 + k];
        const rx = pn ? pn[polyOf[t] * 3] : fn[t * 3], ry = pn ? pn[polyOf[t] * 3 + 1] : fn[t * 3 + 1], rz = pn ? pn[polyOf[t] * 3 + 2] : fn[t * 3 + 2];
        let sx = 0, sy = 0, sz = 0;
        for (let i = start[w]; i < start[w + 1]; i++) { const u = around[i]; const uses = corner(u, 0) === v || corner(u, 1) === v || corner(u, 2) === v;
          if (!(uses || (polyOf && polyOf[u] === polyOf[t]) || fn[u * 3] * rx + fn[u * 3 + 1] * ry + fn[u * 3 + 2] * rz >= cosA)) continue;
          sx += fn[u * 3] * fa[u]; sy += fn[u * 3 + 1] * fa[u]; sz += fn[u * 3 + 2] * fa[u]; }
        const l = Math.hypot(sx, sy, sz); if (l > 0) { N[v * 3] = sx / l; N[v * 3 + 1] = sy / l; N[v * 3 + 2] = sz / l; } }
    }
    const G = geom.attributes.normal.array; let dv = 0, changed = 0;
    for (let i = 0; i < N.length; i++) { dv = Math.max(dv, Math.abs(G[i] - N[i])); if (Math.abs(N0[i] - N[i]) > 1e-6) changed++; }
    out.shade = dv; out.moved = nMoved; out.shadeChanged = changed;
  }
  // the picking tree: on this geometry, and a ray down onto every moved corner hits the surface where a plain raycast does
  {
    const THREE = window._appFns.THREE, bt = geom.boundsTree;
    out.tree = !!bt && bt.geometry === geom;
    let rays = 0, agree = 0;
    if (bt) {
      const m = new THREE.Mesh(geom), plain = new THREE.Mesh(geom); plain.raycast = THREE.Mesh.prototype.raycast;
      const rc = new THREE.Raycaster(); rc.firstHitOnly = true;
      const nRaw = P.length / 3;
      for (let i = 0; i < nRaw && rays < 60; i += 7) {
        if (P[i * 3] === B[i * 3] && P[i * 3 + 1] === B[i * 3 + 1] && P[i * 3 + 2] === B[i * 3 + 2]) continue;
        rays++;
        const o = new THREE.Vector3(P[i * 3] + 0.013, P[i * 3 + 1] + 500, P[i * 3 + 2] + 0.017);
        rc.set(o, new THREE.Vector3(0, -1, 0));
        const a = geom.boundsTree.raycastFirst(rc.ray, THREE.DoubleSide), b = rc.intersectObject(plain, false).sort((x, y) => x.distance - y.distance)[0];
        if ((!a && !b) || (a && b && Math.abs(a.distance - b.distance) < 1e-3)) agree++;
      }
    }
    out.rays = rays; out.agree = agree;
  }
  return out;
})`;
const SNAP = `(() => { const p = window.state.parts.find(q => !q.deleted && q.mesh), g = p.mesh.geometry; return { P: Array.from(g.attributes.position.array), N: Array.from(g.attributes.normal.array) }; })()`;
const judge = (tag, c) => {
  check(tag + ': the kept triangle normals are the moved shape\'s', c.normal < 1e-5, c);
  check(tag + ': the sharp edges and the faces are the moved shape\'s', c.kind === 0 && c.region === 0 && c.nRegion[0] === c.nRegion[1] && c.sharp > 0, c);
  check(tag + ': the reading holds the finished shape\'s own positions', c.positionsOwn, c);
  if (tag === 'first move') check(tag + ': it made new sharp edges, so the faces were found again', c.facesAgain, c);
  check(tag + ': the blue lines\' slopes are worked out again', c.slope >= 0 && c.slope < 1e-4, c);
  check(tag + ': the moved corners are shaded as before (every triangle looked at)', c.moved > 0 && c.shade < 1e-4 && c.shadeChanged > 0, c);
  check(tag + ': the picking tree is the shape\'s and meets the moved points', c.tree && c.rays > 3 && c.agree === c.rays, c);
};

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const f = new File([${JSON.stringify(model())}], 'dome.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  if (await until("document.getElementById('import-modal').classList.contains('show')", 20)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  check('the dome opened', await until("window.state && window.state.parts.filter(p => !p.deleted && p.mesh).length === 1", 60, 500));
  await sleep(2500);      // (the picking trees are built in slices after a load)
  await call('select_parts', { name_contains: 'dome' }); await call('frame_selection'); await sleep(1200);
  await evalJS("window.__moElements.mode('points'); true"); await sleep(1200);
  const pick = await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return window.__moElements.boxPick(r.left + r.width * .44, r.top + r.height * .42, r.left + r.width * .56, r.top + r.height * .58, 'set'); })()");
  check('some points picked', pick > 3, pick);
  const hadTree = await evalJS("!!window.state.parts.find(q => !q.deleted && q.mesh).mesh.geometry.boundsTree");
  check('the part has a picking tree before the move', hadTree);

  // the first move: up, across the fold
  let before = await evalJS(SNAP);
  check('the gizmo moves them', await evalJS("window.__moElements.nudge(3, 2.5, 4)"));
  await sleep(300);
  judge('first move', await evalJS(`${COMPARE}(${JSON.stringify(before.P)}, ${JSON.stringify(before.N)})`));
  check('the same points are still picked', await evalJS('window.__moElements.count("points")') === pick);

  // a second move works from the kept reading
  const mid = await evalJS(SNAP);
  check('a second move', await evalJS("window.__moElements.nudge(-6, 1, 0)"));
  await sleep(300);
  judge('second move', await evalJS(`${COMPARE}(${JSON.stringify(mid.P)}, ${JSON.stringify(mid.N)})`));

  // Undo twice: the shape it had
  await call('undo'); await sleep(300); await call('undo'); await sleep(500);
  const back = await evalJS(SNAP);
  let d = 0; for (let i = 0; i < back.P.length; i++) d = Math.max(d, Math.abs(back.P[i] - before.P[i]));
  check('Undo twice puts every point back', back.P.length === before.P.length && d < 1e-6, d);
  check('no page errors', errors.length === 0, errors.slice(0, 3));
  const treeWarns = JSON.parse(await evalJS('JSON.stringify(window.__warns || [])')).filter(x => /picking tree not refitted|MeshBVH\.deserialize/.test(x));
  check('the moves refit the picking tree they had (no "not refitted", no format fix-up)', treeWarns.length === 0, treeWarns.slice(0, 3));
} catch (e) { fail++; console.log('HARNESS ERROR', e); }
finally { console.log(`${pass} passed, ${fail} failed`); try { chrome.kill(); } catch (_) {} process.exit(fail ? 1 : 0); }
