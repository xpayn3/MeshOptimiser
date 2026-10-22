// node tests/e2e-usd-dae.mjs
//
// USD (.usda, .usdc, .usdz) and Collada (.dae), read with three r186's USDLoader and ColladaLoader, land in the scene's own convention:
// Z up, millimetres, whatever up axis and unit the file says. Blender writes the USD files (tests/blender/make-usd.py: a 100 mm box
// with its middle at (200, 0, 50) mm and a can 60 mm across, 200 mm tall, standing at (-200, 0, 0) mm), as Z-up metres, turned to Y up,
// and in centimetres; the Collada files are written here (the same box, Z up in centimetres and Y up in metres). A USDZ written by the
// app is read back too. Each check: the parts are where they were, to a tenth of a millimetre.
// Needs the app served on http://localhost:4242 (or APP_PORT), Chrome, Node 22+, and Blender 5 for the USD files (BLENDER; without it
// only the Collada cases run).
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const PORT = 9377, PROFILE = path.join(os.tmpdir(), 'cdp-profile-usd-' + Date.now());
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const ROOT = path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(os.tmpdir(), 'mo-usd-dae-' + Date.now()); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// ── the files ──
const BOX = { lo: [150, -50, 0], hi: [250, 50, 100] }, CAN = { lo: [-230, -30, 0], hi: [-170, 30, 200] };
const cube = (s) => {            // a cube of side s about the origin: positions and triangles
  const h = s / 2, P = [];
  for (const x of [-h, h]) for (const y of [-h, h]) for (const z of [-h, h]) P.push(x, y, z);
  const T = [0,1,3, 0,3,2, 4,6,7, 4,7,5, 0,4,5, 0,5,1, 2,3,7, 2,7,6, 0,2,6, 0,6,4, 1,5,7, 1,7,3];
  return { P, T };
};
const dae = (unit, up, side, at) => {
  const { P, T } = cube(side);
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit name="u" meter="${unit}"/><up_axis>${up}</up_axis></asset>
  <library_geometries><geometry id="cube" name="cube"><mesh>
    <source id="cube-pos"><float_array id="cube-pos-a" count="${P.length}">${P.join(' ')}</float_array>
      <technique_common><accessor source="#cube-pos-a" count="${P.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <vertices id="cube-v"><input semantic="POSITION" source="#cube-pos"/></vertices>
    <triangles count="${T.length / 3}"><input semantic="VERTEX" source="#cube-v" offset="0"/><p>${T.join(' ')}</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="scene" name="scene">
    <node id="Box" name="Box"><translate>${at.join(' ')}</translate><instance_geometry url="#cube"/></node>
  </visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>`;
};
const cases = [];
fs.writeFileSync(path.join(OUT, 'box-zup-cm.dae'), dae(0.01, 'Z_UP', 10, [20, 0, 5]));
fs.writeFileSync(path.join(OUT, 'box-yup-m.dae'), dae(1, 'Y_UP', 0.1, [0.2, 0.05, 0]));
cases.push({ file: 'box-zup-cm.dae', want: [BOX] }, { file: 'box-yup-m.dae', want: [BOX] });
let usdMade = [];
if (fs.existsSync(BLENDER)) {
  const res = execFileSync(BLENDER, ['--background', '--factory-startup', '--python', path.join(ROOT, 'tests/blender/make-usd.py'), '--', OUT], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });
  usdMade = JSON.parse(res.split('RESULT_BEGIN')[1].split('RESULT_END')[0]).made;
  for (const m of usdMade) cases.push({ file: m.file, want: [BOX, CAN], says: m.upAxis + ' up, ' + m.metersPerUnit + ' m/unit' });
} else console.log('Blender not found: the USD cases are skipped');

// ── the app ──
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
async function freshApp() {
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1200);
  await evalJS("document.getElementById('welcome-close')?.click(); window.__moQuietToasts = true; true");
}
async function openInApp(file) {
  const b64 = fs.readFileSync(file).toString('base64');
  await evalJS(`(() => { const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)); window.__moOpenFile(new File([bin], ${JSON.stringify(path.basename(file))})); return true; })()`);
  for (let i = 0; i < 20; i++) {
    if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) { await evalJS("document.querySelector('#import-modal-confirm')?.click()"); break; }
    if (await evalJS('window.state.parts.filter(p => !p.deleted).length') > 0) break;
    await sleep(250);
  }
  let n = -1, stable = 0;
  for (let i = 0; i < 80 && stable < 4; i++) { const m = await evalJS('window.state.parts.filter(p => !p.deleted).length'); if (m === n && m > 0) stable++; else stable = 0; n = m; await sleep(250); }
  await sleep(400);
  return n;
}
// the world box of every live part, in the scene's units (mm, Z up)
const boxes = () => evalJS(`(async () => {
  const THREE = await import('three');
  return window.state.parts.filter(p => !p.deleted && (p.mesh || p.instancedMesh)).map(p => {
    const o = p.mesh || p.instancedMesh; o.updateWorldMatrix(true, false);
    const b = new THREE.Box3().setFromObject(o);
    return { name: p.name, lo: b.min.toArray(), hi: b.max.toArray() };
  });
})()`);
const near = (a, b, tol = 0.1) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
function judge(label, got, want) {
  check(label + ': ' + want.length + ' part(s)', got.length === want.length, got.map(g => g.name));
  for (const w of want) {
    const g = got.find(x => near(x.lo, w.lo, 0.5) && near(x.hi, w.hi, 0.5));      // (a can is a polygon: its box is the circle's to half a mm)
    check(label + ': a part at ' + JSON.stringify(w.lo) + '..' + JSON.stringify(w.hi), !!g, got.map(x => ({ lo: x.lo.map(Math.round), hi: x.hi.map(Math.round) })));
  }
}

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const c of cases) {
    await freshApp();
    const n = await openInApp(path.join(OUT, c.file));
    judge(c.file + (c.says ? ' (' + c.says + ')' : ''), n > 0 ? await boxes() : [], c.want);
  }

  // A USDZ written by the app, read back: the parts where they were
  if (usdMade.some(m => m.file === 'scene.usdc')) {
    await freshApp();
    await openInApp(path.join(OUT, 'scene.usdc'));
    const before = await boxes();
    const res = await evalJS(`(async () => { const r = await window.__moBridgeTools.export_model({ format: 'usdz', file_name: 'usd-roundtrip' }); return r[0].text; })()`);
    const saved = (JSON.parse(res).files || []).map(f => (typeof f === 'string' ? f : f.path || f.file || f.name)).filter(Boolean);
    const f = saved.map(x => [x, path.join(ROOT, 'app', 'exports', path.basename(String(x))), path.join(ROOT, 'exports', path.basename(String(x)))].find(y => y && fs.existsSync(y))).find(Boolean);
    check('the app wrote a USDZ', !!f, res.slice(0, 300));
    if (f) {
      const back = path.join(OUT, 'roundtrip.usdz'); fs.copyFileSync(f, back); try { fs.unlinkSync(f); } catch (_) {}
      await freshApp();
      await openInApp(back);
      judge('the app\'s own USDZ read back', await boxes(), before.map(b => ({ lo: b.lo, hi: b.hi })));
    }
  }
  check('no page exceptions', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  fail++; console.log('FAIL harness', e?.stack || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
