// node tests/blender/compare-tools.mjs [case ...]
// The app's mesh tools against Blender's own, on the same meshes (tests/blender/make-compare.py), measured the same way in Blender
// (tests/blender/metrics.py: surface error both ways against the original, closed or not, facing, slivers, faces). Cases:
//   decimate   Decimate to a quarter            app: decimate (target triangles)         Blender: Decimate modifier, Collapse 0.25
//   fill       Fill holes                       app: fix_mesh patch_holes / close_open_edges   Blender: Fill Holes
//   orient     Recalculate normals              app: repair_mesh (orient only)           Blender: Recalculate Outside
//   voxel      Voxel remesh                     app: voxel_remesh 160 cells              Blender: Voxel remesh at the same size
//   quads      Triangles to quads               app: untriangulate, flat and mode quads (OBJ keeps quads)   Blender: Tris to Quads, Limited Dissolve
//   union      Boolean union                    app: boolean_parts union (Manifold)      Blender: Boolean, Exact
//   convex     Convex hull                      app: reshape_mesh convex_hull            Blender: Convex Hull
// Prints a table and writes compare.json into OUT. Needs the app on 4242, Chrome and Blender 5. Not a pass/fail test: a report.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const PORT = 9373, URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const ROOT = path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'mo-compare'); fs.mkdirSync(OUT, { recursive: true });
const CASES = process.argv.length > 2 ? process.argv.slice(2) : ['decimate', 'fill', 'orient', 'voxel', 'quads', 'union', 'convex'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const py = (script, args) => execFileSync(BLENDER, ['--background', '--factory-startup', '--python', path.join(ROOT, 'tests/blender', script), '--', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const metrics = (orig, files) => [...py('metrics.py', [orig, ...files]).matchAll(/RESULT_BEGIN(.*?)RESULT_END/g)].map(m => JSON.parse(m[1]));
const bOp = (op, src, dst, params) => { const o = py('blender-op.py', [op, src, dst, JSON.stringify(params || {})]); return +(o.match(/OP_SECONDS ([\d.]+)/) || [0, NaN])[1]; };

// ── the app ──
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(os.tmpdir(), 'cdp-compare-' + Date.now())}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
async function attach() {
  let t; for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page'); } catch (_) {} if (!t) await sleep(500); }
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } };
  await send('Page.enable'); await send('Runtime.enable');
}
async function openFresh(file) {
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await ev("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1200); await ev("document.getElementById('welcome-close')?.click(); window.__moQuietToasts = true; 1");
  const b64 = fs.readFileSync(file).toString('base64');
  await ev(`(() => { const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)); window.__moOpenFile(new File([bin], ${JSON.stringify(path.basename(file))})); return 1; })()`);
  for (let i = 0; i < 40; i++) { if (await ev("document.getElementById('import-modal')?.classList.contains('show')")) { await ev("document.querySelector('#import-modal-confirm').click()"); break; } if (await ev('window.state.parts.length') > 0) break; await sleep(250); }
  for (let i = 0; i < 60; i++) { if (await ev('window.state.parts.filter(p => !p.deleted).length') > 0) break; await sleep(250); }
  await sleep(1500);
}
const tool = async (name, args = {}) => { const t0 = Date.now(); const r = await ev(`(async () => { const r = await window.__moBridgeTools.${name}(${JSON.stringify(args)}); return r && r[0] ? r[0].text : String(r); })()`); return { text: r, secs: (Date.now() - t0) / 1000 }; };
async function appExport(format, name) {
  const cb = format === 'obj' ? "const q = document.getElementById('exp-quads'); if (q) q.checked = true;" : '';
  const res = await ev(`(async () => { ${cb} const r = await window.__moBridgeTools.export_model(${JSON.stringify({ format, file_name: name })}); return r[0].text; })()`);
  const f = (JSON.parse(res).files || []).map(x => (typeof x === 'string' ? x : x.path || x.file || x.name)).find(x => String(x).toLowerCase().endsWith('.' + format));
  const p = [f, path.join(ROOT, 'exports', path.basename(String(f || '')))].find(x => x && fs.existsSync(x));
  const d = path.join(OUT, path.basename(p)); fs.copyFileSync(p, d); try { fs.unlinkSync(p); } catch (_) {} return d;
}
const ids = () => ev("window.state.parts.filter(p => !p.deleted).map(p => ({ id: p.partId, name: p.name, tris: p.triCount }))");

const rows = [];
const add = (kase, who, how, m, secs, note) => rows.push({ case: kase, who, how, tris: m.tris, faces: m.faces, quads: m.quads, ngons: m.ngons, open: m.open_edges, nonman: m.nonmanifold, 'err_mean%': m.err_mean === undefined ? '-' : +(m.err_mean * 100).toFixed(3), 'err_max%': m.err_max === undefined ? '-' : +(m.err_max * 100).toFixed(3), 'sliver%': m.slivers === undefined ? '-' : +(m.slivers * 100).toFixed(1), 'inward%': m.inward === undefined ? '-' : +(m.inward * 100).toFixed(1), volume: m.volume, sec: secs === undefined ? '-' : +secs.toFixed(2), note: note || m.error || '' });

try {
  { const o = py('make-compare.py', [OUT]); const q = o.match(/QUADS_BEFORE (.*)/); if (q) console.log('quads before triangulating:', q[1]); }
  await attach();
  const F = (n) => path.join(OUT, n + '.glb');
  for (const kase of CASES) {
    if (kase === 'decimate') {
      const src = F('organic'); await openFresh(src); const [p] = await ids(); const target = Math.round(p.tris * 0.25);
      const a = await tool('decimate', { ids: [p.id], target_triangles: target }); const fa = await appExport('glb', 'cmp_dec_app');
      const fb = path.join(OUT, 'cmp_dec_blender.glb'); const sb = bOp('decimate', src, fb, { ratio: 0.25 });
      const [ma, mb, mo] = metrics(src, [fa, fb, src]);
      add(kase, 'original', '', mo); add(kase, 'app', 'Decimate (Claude tool)', ma, a.secs); add(kase, 'blender', 'Decimate, Collapse 0.25', mb, sb);
    }
    if (kase === 'fill') {
      const src = F('holes'), res = [];
      for (const [how, args] of [['Patch holes', { action: 'patch_holes', max_hole_mm: 1000 }], ['Close open edges', { action: 'close_open_edges' }]]) {
        await openFresh(src); const [p] = await ids(); const a = await tool('fix_mesh', { ids: [p.id], ...args }); res.push([how, await appExport('glb', 'cmp_fill_' + args.action), a.secs, a.text.slice(0, 120)]);
      }
      const fb = path.join(OUT, 'cmp_fill_blender.glb'); const sb = bOp('fill_holes', src, fb);
      const M = metrics(src, [...res.map(r => r[1]), fb, src]);
      add(kase, 'original', '', M[M.length - 1]);
      res.forEach((r, i) => add(kase, 'app', r[0], M[i], r[2]));
      add(kase, 'blender', 'Fill Holes', M[res.length], sb);
    }
    if (kase === 'orient') {
      const src = F('flipped'); await openFresh(src); const [p] = await ids();
      const a = await tool('repair_mesh', { ids: [p.id], weld: true, degenerate: false, orient: true, separate_touching: false, smooth_normals: false });
      const fa = await appExport('glb', 'cmp_orient_app'); const fb = path.join(OUT, 'cmp_orient_blender.glb'); const sb = bOp('orient', src, fb);
      const fw = path.join(OUT, 'cmp_orient_blender_weld.glb'); const sw = bOp('orient', src, fw, { weld: true });
      const [ma, mb, mw, mo] = metrics(src, [fa, fb, fw, src]);
      add(kase, 'original', '', mo); add(kase, 'app', 'Repair mesh, orient', ma, a.secs, a.text.slice(0, 100)); add(kase, 'blender', 'Recalculate Outside', mb, sb); add(kase, 'blender', 'Merge by Distance + Recalculate', mw, sw);
    }
    if (kase === 'voxel') {
      const src = F('organic'), res = [];
      for (const adapt of [0, 0.25]) { await openFresh(src); const [p] = await ids(); const a = await tool('voxel_remesh', { ids: [p.id], detail: 160, adaptivity: adapt }); res.push(['Voxel remesh 160, adaptivity ' + adapt, await appExport('glb', 'cmp_voxel_app_' + adapt), a.secs]); }
      const fb = path.join(OUT, 'cmp_voxel_blender.glb'); const sb = bOp('voxel', src, fb, { voxel: 100 / 160 });
      const M = metrics(src, [...res.map(r => r[1]), fb, src]);
      add(kase, 'original', '', M[M.length - 1]); res.forEach((r, i) => add(kase, 'app', r[0], M[i], r[2])); add(kase, 'blender', 'Voxel, size 0.625', M[res.length], sb);
    }
    if (kase === 'quads') {
      const src = F('quads'); await openFresh(src);
      const a = await tool('untriangulate', {}); const fa = await appExport('obj', 'cmp_quads_app');
      await openFresh(src);
      const q = await tool('untriangulate', { mode: 'quads' }); const fq = await appExport('obj', 'cmp_quads_app_pair');
      const fb = path.join(OUT, 'cmp_quads_blender.obj'); const sb = bOp('quads', src, fb);
      const fd = path.join(OUT, 'cmp_dissolve_blender.obj'); const sd = bOp('dissolve', src, fd, { weld: true });
      const fw = path.join(OUT, 'cmp_quads_blender_weld.obj'); const sw = bOp('quads', src, fw, { weld: true });
      const [ma, mq, mb, md, mw, mo] = metrics(src, [fa, fq, fb, fd, fw, src]);
      add(kase, 'original', 'cube 96 quads + Suzanne 1,968 quads, triangulated', mo); add(kase, 'app', 'Untriangulate (OBJ, keep quads)', ma, a.secs); add(kase, 'app', 'Untriangulate, Pair into quads 40/40', mq, q.secs, q.text.slice(0, 160)); add(kase, 'blender', 'Tris to Quads 40/40', mb, sb); add(kase, 'blender', 'Merge + Limited Dissolve 5', md, sd); add(kase, 'blender', 'Merge + Tris to Quads 40/40', mw, sw);
    }
    if (kase === 'union') {
      const src = F('bool'); await openFresh(src); const P = await ids(); const A = P.find(p => /^A/.test(p.name)), B = P.find(p => /^B/.test(p.name));
      const a = await tool('boolean_parts', { op: 'union', ids: [A.id, B.id] });
      await tool('hide_parts', { ids: [B.id] }); const fa = await appExport('glb', 'cmp_union_app');
      const fb = path.join(OUT, 'cmp_union_blender.glb'); const sb = bOp('union', src, fb);
      const [ma, mb] = metrics(src, [fa, fb]);
      add(kase, 'app', 'Boolean union (Manifold)', ma, a.secs, a.text.slice(0, 100)); add(kase, 'blender', 'Boolean, Exact', mb, sb);
    }
    if (kase === 'convex') {
      const src = F('hull'); await openFresh(src); const [p] = await ids();
      const a = await tool('reshape_mesh', { ids: [p.id], action: 'convex_hull' }); const fa = await appExport('glb', 'cmp_convex_app');
      const fb = path.join(OUT, 'cmp_convex_blender.glb'); const sb = bOp('convex', src, fb);
      const [ma, mb] = metrics(src, [fa, fb]);
      add(kase, 'app', 'Convex hull', ma, a.secs); add(kase, 'blender', 'Convex Hull', mb, sb);
    }
    console.log('done', kase);
  }
} catch (e) { console.log('HARNESS ERROR:', e.stack || e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.table(rows.map(({ note, ...r }) => r));
for (const r of rows) if (r.note) console.log(r.case, r.who, r.how, '-', r.note);
fs.writeFileSync(path.join(OUT, 'compare.json'), JSON.stringify(rows, null, 1));
console.log('details in', path.join(OUT, 'compare.json'));
