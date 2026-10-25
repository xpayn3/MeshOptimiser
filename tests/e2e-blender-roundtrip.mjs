// node tests/e2e-blender-roundtrip.mjs
// Import and export, judged by Blender. Blender builds a fixture of six parts (tests/blender/make-fixture.py: UVs, a turn and a scale,
// a mirrored part, an open box, an inside-out box, a child under a parent) and writes it in every format it has; the .blend is the
// reference (tests/blender/inspect.py measures each part in world space: triangles, box, area, volume with its sign, open edges, UVs).
//   1. Import: the real app opens each of Blender's files (GLB, glTF, OBJ, FBX, STL); every part must be where Blender has it, the
//      same size, facing out, with its UVs.
//   2. Export: the app writes every format it has (GLB, glTF, OBJ, binary and ASCII FBX, STL, PLY, USDZ); Blender opens each, and every
//      part must be as in the reference.
//   3. One part out and back in: one part is exported alone (GLB, FBX, OBJ), edited in Blender, and appended into the scene again: it
//      must land on itself.
//   4. Mended, then exported: the open box closed (fix_mesh close_open_edges), the inside-out box turned (repair_mesh), then merged:
//      Blender must find them closed, facing out, and the merged file as big as the parts.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242, or APP_PORT), Chrome, Node 22+ and
// Blender 5 (BLENDER). Files go to OUT (default: a folder in TEMP).
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const PORT = 9371, PROFILE = path.join(os.tmpdir(), 'cdp-profile-roundtrip-' + Date.now());
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const ROOT = path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'mo-roundtrip'); fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;        // (e.g. ONLY=import,export)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; fails.push(name); console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// ── Blender ──
const blender = (script, args) => execFileSync(BLENDER, ['--background', '--factory-startup', '--python', path.join(ROOT, 'tests/blender', script), '--', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const inspect = (files) => { const m = new Map(); for (const r of [...blender('inspect.py', files).matchAll(/RESULT_BEGIN(.*?)RESULT_END/g)].map(x => JSON.parse(x[1]))) m.set(r.file, r); return files.map(f => m.get(path.basename(f)) || { file: path.basename(f), error: 'no result' }); };

// ── comparing ──
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const boxOf = (objs) => ({ min: [0, 1, 2].map(i => Math.min(...objs.map(o => o.min[i]))), max: [0, 1, 2].map(i => Math.max(...objs.map(o => o.max[i]))) });
const boxDiff = (a, b) => Math.max(...[0, 1, 2].flatMap(i => [Math.abs(a.min[i] - b.min[i]), Math.abs(a.max[i] - b.max[i])]));
const uvSet = (o) => new Set((o.uvs || []).map(([u, v]) => (Math.round(u * 500) / 500).toFixed(3) + ',' + (Math.round(v * 500) / 500).toFixed(3)));
// every (u, v) of one side has a partner on the other within 0.002 (the two are rounded to 0.001 on their own, and a flip rounds again)
const uvSame = (a, b) => {
  const A = (a.uvs || []), B = (b.uvs || []), tol = 0.002;
  const miss = (P, Q) => { const S = Q.slice().sort((x, y) => x[0] - y[0]); let m = 0; const ex = [];
    for (const [u, v] of P) { let lo = 0, hi = S.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (S[mid][0] < u - tol) lo = mid + 1; else hi = mid; }
      let hit = false; for (let i = lo; i < S.length && S[i][0] <= u + tol; i++) if (Math.abs(S[i][1] - v) <= tol) { hit = true; break; }
      if (!hit) { m++; if (ex.length < 4) ex.push([u, v]); } }
    return { m, ex }; };
  const x = miss(A, B), y = miss(B, A);
  return { ok: A.length > 0 && x.m === 0 && y.m === 0, a: A.length, b: B.length, missRef: x.m, missGot: y.m, ex: x.ex.concat(y.ex) };
};
// The app holds every model Z up in millimetres, as Blender holds it Z up in metres: a glTF (metres) or an FBX (its own unit) comes in
// a thousand times Blender's numbers, an OBJ or STL (no unit: taken as millimetres) with Blender's numbers. Going out, the app writes
// glTF, USDZ and FBX in metres for Blender, OBJ, STL and PLY in millimetres (Blender reads those numbers as metres). unitDown(o, f)
// divides a measured part by f so it can be held against the reference. The app holds every UV with V from the top (as glTF), Blender
// from the bottom.
const unitDown = (o, f) => f === 1 ? o : ({ ...o, min: o.min.map(x => x / f), max: o.max.map(x => x / f), volume: o.volume / f ** 3, area: o.area / f ** 2 });
const FILE_UNIT = { obj: 1000, stl: 1000, ply: 1000 };          // (what Blender reads from the app's file, against its metres)
const vflip = (o) => ({ ...o, uvs: (o.uvs || []).map(([u, v]) => [u, Math.round((1 - v) * 1000) / 1000]) });
const baseName = (n) => String(n).replace(/\.\d{3}$/, '').replace(/[ _](mesh|Mesh)$/, '');
// Match the reference parts to what came back, by name (a format may append .001, or name the mesh and not the object)
function byName(ref, got) {
  const out = new Map();
  // (USDZ: Blender names the object after the mesh prim, which copies share, and the part's name is on an ancestor: Box_UV/Geometry/Geometry)
  for (const r of ref) { const g = got.find(o => baseName(o.name) === r.name) || got.find(o => String(o.name).includes(r.name)) || got.find(o => String(o.path || '').split('/').map(baseName).includes(r.name)); if (g) out.set(r.name, g); }
  return out;
}
// What to ask of one part against its reference: place, size, triangles, facing, open edges, UVs (a format may lose some of these)
function judge(label, r, g, { uv = true, tol = 1e-3, tris = true } = {}) {
  if (!g) { check(`${label} ${r.name}: is there`, false); return; }
  const d = boxDiff(r, g);
  check(`${label} ${r.name}: in place and the same size`, d <= tol * 10, { off: +d.toFixed(5), ref: [r.min, r.max], got: [g.min, g.max] });
  if (tris) check(`${label} ${r.name}: same triangles`, g.tris === r.tris, { ref: r.tris, got: g.tris });
  check(`${label} ${r.name}: faces point the same way`, Math.sign(g.volume) === Math.sign(r.volume) && near(Math.abs(g.volume), Math.abs(r.volume), Math.abs(r.volume) * 0.01 + 1e-6), { ref: r.volume, got: g.volume });
  check(`${label} ${r.name}: open edges`, g.open_edges === r.open_edges, { ref: r.open_edges, got: g.open_edges });
  if (uv) { const u = uvSame(r, g); check(`${label} ${r.name}: UVs`, u.ok, u); }
}

// ── the app (headless Chrome) ──
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
async function attach() {
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
}
async function freshApp() {
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1200);
  await evalJS("document.getElementById('welcome-close')?.click(); window.__moQuietToasts = true; true");
}
// Open a file in the app (append: into the scene that is open). Waits for the part count to settle.
async function openInApp(file, { append = false } = {}) {
  const b64 = fs.readFileSync(file).toString('base64');
  const before = await evalJS('window.state.parts.filter(p => !p.deleted).length');
  await evalJS(`(() => { const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)); const f = new File([bin], ${JSON.stringify(path.basename(file))}); if (${append}) window.state._importMode = true; window.__moOpenFile(f); return true; })()`);
  for (let i = 0; i < 20; i++) {
    const modal = await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false);
    if (modal) { if (append) await evalJS("(() => { const c = document.querySelector('#import-modal input[id*=append]'); if (c && !c.checked) c.click(); return true; })()"); await evalJS("document.querySelector('#import-modal-confirm')?.click()"); break; }
    if (await evalJS('window.state.parts.filter(p => !p.deleted).length') > before) break;
    await sleep(250);
  }
  let n = -1, stable = 0;
  for (let i = 0; i < 120 && stable < 4; i++) { const m = await evalJS('window.state.parts.filter(p => !p.deleted).length'); if (m === n && m > before) stable++; else stable = 0; n = m; await sleep(250); }
  await sleep(500);
  return n - before;
}
// Every live part as the app holds it, in the same terms as inspect.py (world space; the app is Z-up like Blender)
const APP_STATS = `(async () => {
  const THREE = await import('three');
  const out = [];
  for (const p of window.state.parts) {
    if (p.deleted) continue;
    const o = p.mesh || p.instancedMesh; if (!o || !o.geometry) continue;
    o.updateWorldMatrix(true, false);
    const m = new THREE.Matrix4(), mi = new THREE.Matrix4();
    if (p.mesh) m.copy(o.matrixWorld); else { o.getMatrixAt(p.instanceIndex, mi); m.multiplyMatrices(o.matrixWorld, mi); }
    const g = o.geometry, pa = g.attributes.position, ix = g.index, uv = g.attributes.uv;
    const n = ix ? ix.count : pa.count, v = new THREE.Vector3(), W = new Float64Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(m); W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z; }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pa.count; i++) for (let k = 0; k < 3; k++) { const x = W[i * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
    const diag = Math.max(1e-9, hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), q = 1e-5 * diag;
    const key = new Map(), weld = new Int32Array(pa.count);
    for (let i = 0; i < pa.count; i++) { const k = Math.round(W[i * 3] / q) + ',' + Math.round(W[i * 3 + 1] / q) + ',' + Math.round(W[i * 3 + 2] / q); let w = key.get(k); if (w === undefined) { w = key.size; key.set(k, w); } weld[i] = w; }
    let vol = 0, area = 0; const E = new Map();
    const at = (j) => ix ? ix.getX(j) : j;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = at(t), b = at(t + 1), c = at(t + 2);
      const ax = W[a * 3], ay = W[a * 3 + 1], az = W[a * 3 + 2], bx = W[b * 3], by = W[b * 3 + 1], bz = W[b * 3 + 2], cx = W[c * 3], cy = W[c * 3 + 1], cz = W[c * 3 + 2];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
      area += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
      for (const [p1, p2] of [[weld[a], weld[b]], [weld[b], weld[c]], [weld[c], weld[a]]]) { if (p1 === p2) continue; const k = p1 < p2 ? p1 + ':' + p2 : p2 + ':' + p1; E.set(k, (E.get(k) || 0) + 1); }
    }
    if (m.determinant() < 0) vol = -vol;
    let open = 0; for (const c of E.values()) if (c === 1) open++;
    const uvs = new Set(); if (uv) for (let i = 0; i < uv.count; i++) uvs.add(JSON.stringify([Math.round(uv.getX(i) * 1000) / 1000, Math.round(uv.getY(i) * 1000) / 1000]));
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    out.push({ name: p.name, visible: p.visible !== false, tris: Math.floor(n / 3), min: lo, max: hi, area, volume: vol, open_edges: open, uvs: [...uvs].map(s => JSON.parse(s)), colour: mat && mat.color ? [mat.color.r, mat.color.g, mat.color.b].map(x => Math.round(x * 1000) / 1000) : null, instanced: !p.mesh });
  }
  return out;
})()`;
const appStats = () => evalJS(APP_STATS);
// Export with Claude's export tool (the same doExport as the dialog, with its defaults: scale 1, axis as in the scene, origin kept)
async function appExport(format, name, extra = {}) {
  const ascii = !!extra.fbxAscii; delete extra.fbxAscii;
  const res = await evalJS(`(async () => { const cb = document.getElementById('exp-fbx-ascii'); if (cb) cb.checked = ${ascii}; const r = await window.__moBridgeTools.export_model(${JSON.stringify({ format, file_name: name, ...extra })}); if (cb) cb.checked = false; return r[0].text; })()`);
  const saved = (JSON.parse(res).files || []).map(f => (typeof f === 'string' ? f : f.path || f.file || f.name)).filter(Boolean);
  const files = saved.map(f => [f, path.join(ROOT, 'exports', path.basename(String(f)))].find(x => x && fs.existsSync(x))).filter(Boolean);
  const moved = files.map(f => { const d = path.join(OUT, path.basename(f)); fs.copyFileSync(f, d); try { fs.unlinkSync(f); } catch (_) {} return d; });
  return moved;
}
const tool = (name, args = {}) => evalJS(`(async () => { const r = await window.__moBridgeTools.${name}(${JSON.stringify(args)}); return r && r[0] ? r[0].text : String(r); })()`);
const want = (k) => !ONLY || ONLY.has(k);

try {
  // ── 0. the fixture, made and measured by Blender ──
  blender('make-fixture.py', [OUT]);
  const [REFR] = inspect([path.join(OUT, 'fixture.blend')]);
  const REF = REFR.objects;
  check('Blender made the fixture (6 parts)', REF.length === 6, REF.map(o => o.name));
  fs.writeFileSync(path.join(OUT, 'reference.json'), JSON.stringify(REF, null, 1));
  await attach();

  // ── 1. import: Blender's files opened in the app ──
  if (want('import')) for (const [file, opt] of [['fixture.glb', { mm: 1000, vflip: true }], ['fixture-embedded.gltf', { mm: 1000, vflip: true }], ['fixture.fbx', { mm: 1000, vflip: true }], ['fixture.obj', { mm: 1, vflip: true, tris: false }], ['fixture.stl', { mm: 1, merged: true }]]) {
    await freshApp();
    const added = await openInApp(path.join(OUT, file));
    const raw = await appStats();
    const got = raw.map(o => { let x = unitDown(o, opt.mm); if (opt.vflip) x = vflip(x); return x; });
    const label = 'import ' + file.replace('fixture', '').replace(/^[.-]/, '');
    fs.writeFileSync(path.join(OUT, 'app-' + file + '.json'), JSON.stringify(got, null, 1));
    if (!added) { check(label + ': opened', false, { errors: errors.slice(-3) }); continue; }
    if (opt.merged) {          // (an STL is one mesh: judged as a whole)
      const box = boxOf(REF), gb = boxOf(got), tris = got.reduce((s, o) => s + o.tris, 0), rt = REF.reduce((s, o) => s + o.tris, 0);
      check(label + ': the whole model in place', boxDiff(box, gb) < 0.01, { ref: box, got: gb });
      check(label + ': every triangle', tris === rt, { ref: rt, got: tris });
      continue;
    }
    check(label + ': six parts', got.length === 6, got.map(o => o.name));
    { const r = REF.find(o => o.name === 'Flipped'), g = byName(REF, got).get('Flipped'); check(label + ': stands upright in the app (Z up, as in Blender)', g && boxDiff(r, g) < 0.01, g && { ref: [r.min, r.max], app: [g.min, g.max] }); }
    const M = byName(REF, got);
    for (const r of REF) judge(label, r, M.get(r.name), { tris: opt.tris !== false });
  }

  // ── 2. export: the app's files opened in Blender ──
  if (want('export')) {
    await freshApp();
    await openInApp(path.join(OUT, 'fixture.glb'));
    const before = await appStats();
    const jobs = [['glb', {}], ['gltf', {}], ['obj', {}], ['fbx', {}], ['fbx', { fbxAscii: true }], ['stl', {}], ['ply', {}], ['usdz', {}]];
    const made = [];
    for (const [fmt, extra] of jobs) {
      const label = 'export ' + fmt + (extra.fbxAscii ? ' (ASCII)' : '');
      try {
        const files = await appExport(fmt, 'rt_' + fmt + (extra.fbxAscii ? '_ascii' : ''), { ...extra });
        const main = files.find(f => f.toLowerCase().endsWith('.' + fmt)) || files[0];
        check(label + ': written', !!main, files); if (main) made.push({ label, fmt, main });
      } catch (e) { check(label + ': written', false, e.message); }
    }
    const res = inspect(made.map(m => m.main));
    for (let i = 0; i < made.length; i++) {
      const { label, fmt } = made[i], R = res[i];
      if (R.error && /ASCII FBX files are not supported/.test(R.error)) { console.log('SKIP', label + ': Blender has no ASCII FBX reader (tests/e2e-export-uv.mjs reads it with the FBXLoader of three)'); continue; }
      if (R.error) { check(label + ': Blender opens it', false, R.error); continue; }
      const got = R.objects.map(o => unitDown(o, FILE_UNIT[fmt] || 1));
      if (fmt === 'stl' || fmt === 'ply') {
        const box = boxOf(REF), gb = boxOf(got), tris = got.reduce((s, o) => s + o.tris, 0), rt = REF.reduce((s, o) => s + o.tris, 0);
        check(label + ': the whole model in place', boxDiff(box, gb) < 0.01, { ref: box, got: gb, parts: got.length });
        check(label + ': every triangle', tris === rt, { ref: rt, got: tris });
        if (got.length === REF.length) { const M = byName(REF, got); for (const r of REF) if (M.get(r.name)) judge(label, r, M.get(r.name), { uv: fmt === 'ply' }); }
        else { const v = got.reduce((s, o) => s + o.volume, 0), rv = REF.reduce((s, o) => s + o.volume, 0); check(label + ': volume as the parts', near(v, rv, Math.abs(rv) * 0.01), { ref: rv, got: v }); }
        continue;
      }
      check(label + ': six parts', got.length === 6, got.map(o => o.name));
      const M = byName(REF, got);
      for (const r of REF) judge(label, r, M.get(r.name), { tris: true });
    }
    check('export left the scene as it was', JSON.stringify((await appStats()).map(o => [o.name, o.tris])) === JSON.stringify(before.map(o => [o.name, o.tris])));
  }

  // ── 2b. across formats: a model opened from OBJ or FBX, written as GLB, OBJ and FBX: the UVs must still be Blender's ──
  if (want('cross')) for (const src of ['fixture.obj', 'fixture.fbx']) {
    await freshApp();
    await openInApp(path.join(OUT, src));
    const made = [];
    for (const fmt of ['glb', 'obj', 'fbx']) { const f = (await appExport(fmt, 'rt_from_' + src.split('.')[1] + '_' + fmt)).find(x => x.toLowerCase().endsWith('.' + fmt)); if (f) made.push([fmt, f]); }
    const res = inspect(made.map(m => m[1]));
    made.forEach(([fmt, f], i) => {
      const M = byName(REF, res[i].objects || []);
      for (const r of REF) { const g = M.get(r.name); if (!g) { check(`${src} -> ${fmt} ${r.name}: is there`, false); continue; } const u = uvSame(r, g); check(`${src} -> ${fmt} ${r.name}: UVs`, u.ok, u); }
    });
  }

  // ── 3. one part out, edited in Blender, and back into the scene ──
  if (want('part')) {
    for (const fmt of ['glb', 'fbx', 'obj']) {
      await freshApp();
      await openInApp(path.join(OUT, 'fixture.glb'));
      const st0 = await appStats(), ball0 = st0.find(o => o.name === 'Ball');
      await tool('isolate_parts', { name_contains: 'Ball' });
      await evalJS("(() => { for (const p of window.state.parts) if (!p.deleted && p.name !== 'Ball') { p.visible = false; } return true; })()");
      const files = await appExport(fmt, 'rt_ball_' + fmt);
      await tool('show_all');
      const main = files.find(f => f.toLowerCase().endsWith('.' + fmt));
      if (!main) { check(`one part (${fmt}): written`, false, files); continue; }
      const [R] = inspect([main]);
      const balls = (R.objects || []).map(o => unitDown(o, FILE_UNIT[fmt] || 1)).filter(o => baseName(o.name) === 'Ball' || String(o.name).includes('Ball'));
      check(`one part (${fmt}): only that part is in the file`, R.objects && R.objects.length === 1, (R.objects || []).map(o => o.name));
      const refBall = REF.find(o => o.name === 'Ball');
      if (balls[0]) judge(`one part (${fmt})`, refBall, balls[0], { tris: fmt !== 'obj' });
      // edited in Blender (every face cut in four), written as the same format, appended into the scene: it must land on the part
      const edited = path.join(OUT, 'rt_ball_' + fmt + '_edited.' + fmt);
      blender('edit-part.py', [main, edited]);
      if (!fs.existsSync(edited)) { check(`one part (${fmt}): Blender wrote the edited copy`, false); continue; }
      const added = await openInApp(edited, { append: true });
      const st1 = await appStats();
      check(`one part (${fmt}): appended into the scene`, added >= 1 && st1.length === st0.length + added, { added, before: st0.length, after: st1.length });
      const back = st1.slice(st0.length);
      if (back.length) {
        const bb = boxOf(back), d = boxDiff(bb, ball0);
        check(`one part (${fmt}): lands on the part it came from`, d < 0.01, { off: +d.toFixed(5), part: [ball0.min, ball0.max], back: [bb.min, bb.max] });
        check(`one part (${fmt}): the edit came back (4x the triangles)`, back.reduce((s, o) => s + o.tris, 0) === ball0.tris * 4 || fmt === 'obj', { was: ball0.tris, now: back.reduce((s, o) => s + o.tris, 0) });
        check(`one part (${fmt}): faces out`, back.every(o => o.volume > 0), back.map(o => o.volume));
      }
    }
  }

  // ── 4. mended in the app, then exported ──
  if (want('mend')) {
    await freshApp();
    await openInApp(path.join(OUT, 'fixture.glb'));
    const r1 = await tool('fix_mesh', { action: 'close_open_edges', name_contains: 'Holey' });
    const r2 = await tool('repair_mesh', { name_contains: 'Flipped' });
    const st = await appStats();
    const hol = st.find(o => o.name === 'Holey'), fl = st.find(o => o.name === 'Flipped');
    check('mend: Holey is closed in the app', hol && hol.open_edges === 0, { hol, r1: String(r1).slice(0, 300) });
    check('mend: Flipped faces out in the app', fl && fl.volume > 0, { vol: fl && fl.volume, r2: String(r2).slice(0, 300) });
    const made = [];
    for (const fmt of ['glb', 'fbx', 'obj', 'stl']) { const f = (await appExport(fmt, 'rt_mended_' + fmt)).find(x => x.toLowerCase().endsWith('.' + fmt)); if (f) made.push([fmt, f]); else check('mend: ' + fmt + ' written', false); }
    const res = inspect(made.map(m => m[1]));
    made.forEach(([fmt, f], i) => {
      const O = (res[i].objects || []).map(o => unitDown(o, FILE_UNIT[fmt] || 1));
      if (fmt === 'stl') { const open = O.reduce((s, o) => s + o.open_edges, 0); check('mend: the STL has no open edges', open === 0, { open }); return; }
      const M = byName(REF, O), h = M.get('Holey'), x = M.get('Flipped');
      check(`mend (${fmt}): Holey closed in Blender`, h && h.open_edges === 0 && h.volume > 7.9, h && { open: h.open_edges, vol: h.volume });
      check(`mend (${fmt}): Flipped faces out in Blender`, x && x.volume > 7.9, x && { vol: x.volume });
      check(`mend (${fmt}): Mirror still faces out`, M.get('Mirror') && M.get('Mirror').volume > 0, M.get('Mirror') && M.get('Mirror').volume);
    });
    // merged: one part, as big as the six
    const live = await evalJS("window.state.parts.filter(p => !p.deleted).map(p => p.partId)");
    await tool('merge_parts', { ids: live });
    const sm = await appStats();
    check('merge: one part in the app', sm.length === 1, sm.map(o => o.name));
    for (const fmt of ['glb', 'stl']) {
      const f = (await appExport(fmt, 'rt_merged_' + fmt)).find(x => x.toLowerCase().endsWith('.' + fmt));
      if (!f) { check('merge: ' + fmt + ' written', false); continue; }
      const [R] = inspect([f]); const O = (R.objects || []).map(o => unitDown(o, FILE_UNIT[fmt] || 1));
      const vol = O.reduce((s, o) => s + o.volume, 0), want = 8 + 13.7381 + 8.6667 + 8 + 8 + 0.4219;        // the six closed, facing out
      check(`merge (${fmt}): one object`, O.length === 1, O.map(o => o.name));
      check(`merge (${fmt}): in place`, boxDiff(boxOf(O), boxOf(REF)) < 0.01, { got: boxOf(O), ref: boxOf(REF) });
      check(`merge (${fmt}): volume of the six parts, facing out`, near(vol, want, 0.05 * want), { got: +vol.toFixed(3), want: +want.toFixed(3) });
      check(`merge (${fmt}): closed`, O.reduce((s, o) => s + o.open_edges, 0) === 0, O.map(o => o.open_edges));
    }
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 8));
} catch (e) { console.log('HARNESS ERROR:', e.stack || e.message); fail++; }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(fail ? fail + ' failed, ' + pass + ' passed' : 'ok: ' + pass + ' passed');
if (fails.length) console.log('failed:\n  ' + fails.join('\n  '));
console.log('files in', OUT);
process.exit(fail ? 1 : 0);
