// node tests/e2e-multicolour.mjs [STEP file]
// Parts of several colours (app/js/facemat.js), as Cinema 4D has them: one object, a material on a selection of its faces.
//   1. Import: Blender writes a cube with three materials (tests/blender/make-multicolour.py) as GLB, OBJ and FBX; each must open as ONE
//      part with its three colours on the right faces (8 red, 2 blue, 2 green triangles), closed.
//   2. In the app: the top of a plain cube is given a colour of its own (__moAgent.colourFaces), undone, done again; a face colour is
//      recoloured and given back to the main material (faceGroupSet), each undone; Edit mesh picks faces and the Colour button's wheel
//      colours them; Merge and Split keep the colours.
//   3. Save and open again: the colours come back on the same faces.
//   4. Export: GLB, glTF, OBJ, FBX, USDZ opened in Blender: one object for each part, every colour on its faces (inspect.py's colours).
//   5. A STEP solid with faces in two colours (NIST FTC 10, or the file given): one part, two colours, no open edges, also after Decimate
//      and in the GLB written from it.
// Needs the app served (APP_PORT, the mo-e2e runner starts one on 4343), Chrome, Node 22+, Blender 5 (BLENDER) and app/.venv.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const PORT = 9373, PROFILE = path.join(os.tmpdir(), 'cdp-profile-multicolour-' + Date.now());
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const ROOT = path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'mo-multicolour'); fs.mkdirSync(OUT, { recursive: true });
const NIST = 'inbox/benchmark/nist/NIST-PMI-STEP-Files/AP203 geometry only/nist_ftc_10_asme1_rb.stp';
const STEP = [process.argv[2], process.env.STEP, path.join(ROOT, NIST), path.resolve(ROOT, '../../..', NIST)].find(p => p && fs.existsSync(p)) || path.join(ROOT, NIST);      // (in a worktree, the main checkout's inbox)
const PY = path.join(ROOT, 'app/.venv/Scripts/python.exe');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; fails.push(name); console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

const blender = (script, args) => execFileSync(BLENDER, ['--background', '--factory-startup', '--python', path.join(ROOT, 'tests/blender', script), '--', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const inspect = (files) => { const m = new Map(); for (const r of [...blender('inspect.py', files).matchAll(/RESULT_BEGIN(.*?)RESULT_END/g)].map(x => JSON.parse(x[1]))) m.set(r.file, r); return files.map(f => m.get(path.basename(f)) || { file: path.basename(f), error: 'no result' }); };
// a colour by what it looks like (the files and the app hold it linear or sRGB: the strongest channel says which it is)
const cls = (c) => { if (!Array.isArray(c)) return String(c); const [r, g, b] = c; if (Math.min(r, g, b) > 0.6) return 'white'; if (r > g && r > b) return g > 0.5 * r ? 'yellow' : 'red'; return g > b ? 'green' : 'blue'; };
const sig = (cols) => (cols || []).map(([c, n]) => cls(c) + ':' + n).sort().join(',');
const baseName = (n) => String(n).replace(/\.\d{3}$/, '').replace(/[ _](mesh|Mesh)$/, '');

// ── the app ──
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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
// (with: other files that come with it, as when they are dropped together: an OBJ's .mtl)
async function openInApp(file, name, withFiles = []) {
  const b64 = fs.readFileSync(file).toString('base64');
  const sib = withFiles.map(w => [path.basename(w), fs.readFileSync(w).toString('base64')]);
  const before = await evalJS('window.state.parts.filter(p => !p.deleted).length');
  await evalJS(`(() => { const mk = (b, n) => new File([Uint8Array.from(atob(b), c => c.charCodeAt(0))], n); const f = mk(${JSON.stringify(b64)}, ${JSON.stringify(name || path.basename(file))});
    const s = ${JSON.stringify(sib)}.map(([n, b]) => mk(b, n)); if (s.length) f.__moSiblings = [f, ...s]; window.__moOpenFile(f); return true; })()`);
  for (let i = 0; i < 20; i++) {
    if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) { await evalJS("document.querySelector('#import-modal-confirm')?.click()"); break; }
    if (await evalJS('window.state.parts.filter(p => !p.deleted).length') > before) break;
    await sleep(250);
  }
  let n = -1, stable = 0;
  for (let i = 0; i < 160 && stable < 4; i++) { const m = await evalJS('window.state.parts.filter(p => !p.deleted).length'); if (m === n && m > 0) stable++; else stable = 0; n = m; await sleep(250); }
  await sleep(500);
  return n;
}
// A part's colours as the app has them: [[rgb, triangles], ...], whether its groups cover every triangle in order, and its open edges
// (welded by position, as inspect.py counts them)
const FG = (name) => evalJS(`(() => {
  const p = window.state.parts.find(q => !q.deleted && q.name === ${JSON.stringify(name)}); if (!p) return null;
  const o = p.mesh || p.instancedMesh, own = window._ownMaterialOf(o), mats = Array.isArray(own) ? own : [own], g = o.geometry;
  const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) | 0, tm = new Int32Array(n);
  let covered = true;
  if (Array.isArray(own)) { let at = 0; for (const gr of g.groups) { if (gr.start !== at) covered = false; at = gr.start + gr.count; for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) tm[t] = gr.materialIndex; } if (at !== n * 3) covered = false; }
  const by = new Map(); for (let t = 0; t < n; t++) { const c = mats[tm[t]] && mats[tm[t]].color; const k = c ? [c.r, c.g, c.b].map(x => +x.toFixed(3)).join(',') : 'none'; by.set(k, (by.get(k) || 0) + 1); }
  const pa = g.attributes.position, ix = g.index, W = new Map(), weld = new Int32Array(pa.count);
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < pa.count; i++) { lo = Math.min(lo, pa.getX(i), pa.getY(i), pa.getZ(i)); hi = Math.max(hi, pa.getX(i), pa.getY(i), pa.getZ(i)); }
  const q = 1e-5 * Math.max(1e-9, hi - lo);
  for (let i = 0; i < pa.count; i++) { const k = Math.round(pa.getX(i) / q) + ',' + Math.round(pa.getY(i) / q) + ',' + Math.round(pa.getZ(i) / q); let w = W.get(k); if (w === undefined) { w = W.size; W.set(k, w); } weld[i] = w; }
  const E = new Map(); const at = (j) => ix ? ix.getX(j) : j;
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) { const a = weld[at(t * 3 + k)], b = weld[at(t * 3 + (k + 1) % 3)]; if (a === b) continue; const key = a < b ? a + ':' + b : b + ':' + a; E.set(key, (E.get(key) || 0) + 1); }
  let open = 0; for (const c of E.values()) if (c === 1) open++;
  return { id: p.partId, n, covered, mats: mats.length, open, colours: [...by.entries()].map(([k, v]) => [k.split(',').map(Number), v]) };
})()`);
const tool = (name, args = {}) => evalJS(`(async () => { const r = await window.__moBridgeTools.${name}(${JSON.stringify(args)}); return r && r[0] ? r[0].text : String(r); })()`);
const undo = () => evalJS("(async () => { document.getElementById('btn-undo').click(); await new Promise(r => setTimeout(r, 300)); return true; })()");
const redo = () => evalJS("(async () => { document.getElementById('btn-redo').click(); await new Promise(r => setTimeout(r, 300)); return true; })()");
const liveNames = () => evalJS('window.state.parts.filter(p => !p.deleted).map(p => p.name)');
async function appExport(format, name, ascii = false) {
  const res = await evalJS(`(async () => { const cb = document.getElementById('exp-fbx-ascii'); if (cb) cb.checked = ${ascii}; const r = await window.__moBridgeTools.export_model(${JSON.stringify({ format, file_name: name })}); if (cb) cb.checked = false; return r[0].text; })()`);
  const saved = (JSON.parse(res).files || []).map(f => (typeof f === 'string' ? f : f.path || f.file || f.name)).filter(Boolean);
  const files = saved.map(f => [f, path.join(ROOT, 'exports', path.basename(String(f)))].find(x => x && fs.existsSync(x))).filter(Boolean);
  return files.map(f => { const d = path.join(OUT, path.basename(f)); fs.copyFileSync(f, d); try { fs.unlinkSync(f); } catch (_) {} return d; });
}
// the triangles of a part whose normal points up (+Z, in the world)
const topTris = (name) => evalJS(`(async () => {
  const THREE = await import('three');
  const p = window.state.parts.find(q => !q.deleted && q.name === ${JSON.stringify(name)}); const o = p.mesh; o.updateWorldMatrix(true, false);
  const g = o.geometry, pa = g.attributes.position, ix = g.index, n = (ix ? ix.count : pa.count) / 3, out = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let t = 0; t < n; t++) { const i = (k) => ix ? ix.getX(t * 3 + k) : t * 3 + k; A.fromBufferAttribute(pa, i(0)).applyMatrix4(o.matrixWorld); B.fromBufferAttribute(pa, i(1)).applyMatrix4(o.matrixWorld); C.fromBufferAttribute(pa, i(2)).applyMatrix4(o.matrixWorld);
    const nn = B.clone().sub(A).cross(C.clone().sub(A)).normalize(); if (nn.z > 0.9) out.push(t); }
  return { id: p.partId, n, tris: out };
})()`);
const paint = (id, n, tris, hex) => evalJS(`(async () => { const THREE = await import('three'); const pick = new Uint8Array(${n}); for (const t of ${JSON.stringify(tris)}) pick[t] = 1;
  const op = window.__moAgent.colourFaces([{ partId: ${id}, pick }], new THREE.MeshStandardMaterial({ color: ${hex}, metalness: 0.15, roughness: 0.55 }), 'Colour faces'); return !!op; })()`);

try {
  blender('make-multicolour.py', [OUT]);
  const [REF] = inspect([path.join(OUT, 'multicolour.blend')]);
  const refPainted = REF.objects.find(o => o.name === 'Painted');
  const WANT = sig(refPainted.colours);
  check('Blender made the fixture (Painted: red 8, blue 2, green 2)', WANT === 'blue:2,green:2,red:8', WANT);
  await attach();

  // ── 1. import ──
  for (const f of ['multicolour.glb', 'multicolour.obj', 'multicolour.fbx']) {
    await freshApp();
    await openInApp(path.join(OUT, f), null, f.endsWith('.obj') ? [path.join(OUT, 'multicolour.mtl')] : []);
    const names = await liveNames();
    check(`import ${f}: two parts (Painted is one, not one a colour)`, names.length === 2 && names.includes('Painted') && names.includes('Plain'), names);
    const g = await FG('Painted');
    check(`import ${f}: Painted has its three colours on the right faces`, g && sig(g.colours) === WANT, g && g.colours);
    check(`import ${f}: Painted's groups cover every triangle`, g && g.covered, g);
    check(`import ${f}: Painted is closed`, g && g.open === 0, g && g.open);
    const p = await FG('Plain');
    check(`import ${f}: Plain has one colour`, p && p.mats === 1 && sig(p.colours) === 'yellow:12', p && p.colours);
  }

  // ── 2. in the app (from the GLB) ──
  await freshApp();
  await openInApp(path.join(OUT, 'multicolour.glb'));
  {
    const top = await topTris('Plain');
    check('paint: Plain has two triangles on top', top.tris.length === 2, top);
    check('paint: the top gets a colour of its own', await paint(top.id, top.n, top.tris, '0xffffff'));
    let g = await FG('Plain');
    check('paint: Plain is yellow 10, white 2', g && sig(g.colours) === 'white:2,yellow:10' && g.covered, g && g.colours);
    await undo(); g = await FG('Plain');
    check('paint: undo gives back one colour', g && g.mats === 1 && sig(g.colours) === 'yellow:12', g && g.colours);
    await redo(); g = await FG('Plain');
    check('paint: redo colours the top again', g && sig(g.colours) === 'white:2,yellow:10', g && g.colours);
    // recolour a face colour, then give it back to the main material
    await evalJS(`(async () => { const THREE = await import('three'); return !!window.__moAgent.faceGroupSet(${top.id}, 1, new THREE.MeshStandardMaterial({ color: 0x1030e0 })); })()`);
    g = await FG('Plain');
    check('recolour: the top is blue now', g && sig(g.colours) === 'blue:2,yellow:10', g && g.colours);
    await undo(); g = await FG('Plain');
    check('recolour: undo makes it white again', g && sig(g.colours) === 'white:2,yellow:10', g && g.colours);
    await evalJS(`!!window.__moAgent.faceGroupSet(${top.id}, 1, null)`);
    g = await FG('Plain');
    check('remove: the top goes back to the main material', g && g.mats === 1 && sig(g.colours) === 'yellow:12', g && g.colours);
    await undo(); g = await FG('Plain');
    check('remove: undo puts the face colour back', g && sig(g.colours) === 'white:2,yellow:10', g && g.colours);
    // in the CAD view (the parts wear the view's materials): a face colour changed there is the part's own, and Solid shows it
    await tool('set_view_mode', { mode: 'cad' });
    await evalJS(`(async () => { const THREE = await import('three'); return !!window.__moAgent.faceGroupSet(${top.id}, 1, new THREE.MeshStandardMaterial({ color: 0xd01010 })); })()`);
    g = await FG('Plain');
    check('CAD view: the face colour is recoloured on the part itself', g && sig(g.colours) === 'red:2,yellow:10', g && g.colours);
    await tool('set_view_mode', { mode: 'solid' });
    const shown = await evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${top.id}); const m = p.mesh.material; return Array.isArray(m) ? m.map(x => x.userData && x.userData.isCad ? 'cad' : '#' + x.color.getHexString()) : 'one'; })()`);
    check('CAD view left: the part wears its two materials again', Array.isArray(shown) && shown.length === 2 && !shown.includes('cad'), shown);
    await undo(); g = await FG('Plain');
    check('CAD view: undo makes the top white again', g && sig(g.colours) === 'white:2,yellow:10', g && g.colours);
    const list = await evalJS(`JSON.stringify(window.__moAgent.faceGroupsOf(${top.id}))`);
    check('faceGroupsOf lists main and the face colour', JSON.parse(list).length === 2, list);
    // the Properties card shows each face colour of the selected part as a card of its material strip, and a right-click on one
    // offers what acts on those faces
    await evalJS(`(() => { window.state.selected.clear(); window.state.selected.add(${top.id}); window.refreshPropertiesPanel && window.refreshPropertiesPanel(); return true; })()`);
    await tool('select_parts', { ids: [top.id] }).catch(() => {});
    await sleep(400);
    const cards = await evalJS("JSON.stringify([...document.querySelectorAll('#sidebar-right .prop-mat-strip .prop-mat-btn.is-face')].map(c => c.dataset.fcMi))");
    check('Properties: two face colour cards in the material strip, the main one first', cards === '["0","1"]', cards);
    check('Properties: no face colour list under the strip', await evalJS("!document.querySelector('.prop-facecols')"));
    const menu = await evalJS(`(() => { const c = document.querySelector('#sidebar-right .prop-mat-strip .prop-mat-btn[data-fc-mi="1"]'); if (!c) return null;
      const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
      const m = document.getElementById('ctx-menu'); const t = m && m.style.display === 'block' ? m.textContent : null; if (m) m.style.display = 'none'; return t; })()`);
    check('Properties: right-click a face colour card: Pick, Recolour, Give back', !!menu && /Pick these faces/.test(menu) && /Recolour these faces/.test(menu) && /Give these faces back to the main colour/.test(menu), menu);
  }
  {
    // Edit mesh: the side faces of Painted picked, then the Colour button's wheel colours them
    const P = await FG('Painted');
    await tool('select_parts', { ids: [P.id] }).catch(() => {});
    await evalJS(`(() => { window.state.selected.clear(); window.state.selected.add(${P.id}); window.__moElements.mode('faces'); return true; })()`);
    await sleep(800);
    const side = await evalJS(`(async () => { const THREE = await import('three'); const p = window.state.parts.find(q => q.partId === ${P.id}), o = p.mesh, g = o.geometry, pa = g.attributes.position, ix = g.index, n = ix.count / 3, out = [];
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(); o.updateWorldMatrix(true, false);
      for (let t = 0; t < n; t++) { A.fromBufferAttribute(pa, ix.getX(t * 3)).applyMatrix4(o.matrixWorld); B.fromBufferAttribute(pa, ix.getX(t * 3 + 1)).applyMatrix4(o.matrixWorld); C.fromBufferAttribute(pa, ix.getX(t * 3 + 2)).applyMatrix4(o.matrixWorld); if (B.clone().sub(A).cross(C.clone().sub(A)).normalize().y < -0.9) out.push(t); }
      return out; })()`);
    const picked = await evalJS(`window.__moElements.pickTriangles(${P.id}, ${JSON.stringify(side)})`);
    check('Edit mesh: the -Y side of Painted is picked', picked >= 1, { picked, side });
    const fp = await evalJS('(() => { const f = window.__moAgent.facePicks(); return f ? f.map(x => [x.partId, Array.from(x.pick).reduce((s, v) => s + v, 0)]) : null; })()');
    check('Edit mesh: facePicks gives its two triangles', fp && fp.length === 1 && fp[0][1] === 2, fp);
    const enabled = await evalJS("!document.getElementById('btn-el-colour').disabled");
    check('Edit mesh: the Colour button is on', enabled);
    // the wheel: the button opens it under the pointer, a move picks a colour, a click keeps it
    await evalJS("window.dispatchEvent(new PointerEvent('pointermove', { clientX: 700, clientY: 450, bubbles: true })); true");
    await evalJS("document.getElementById('btn-el-colour').click(); true");
    await sleep(300);
    const open = await evalJS("!!document.querySelector('#qc-wheel.show')");
    check('Colour button: the wheel opens', open);
    await evalJS("window.dispatchEvent(new PointerEvent('pointermove', { clientX: 700, clientY: 520, bubbles: true })); true");
    await sleep(200);
    await evalJS("window.dispatchEvent(new PointerEvent('pointermove', { clientX: 700, clientY: 540, bubbles: true })); true");
    await sleep(200);
    await evalJS("window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 700, clientY: 540, button: 0, buttons: 1, bubbles: true })); true");
    await sleep(400);
    let g = await FG('Painted');
    check('Colour wheel: Painted has a fourth colour on two triangles', g && g.colours.length === 4 && g.colours.some(([, n]) => n === 2) && g.covered, g && g.colours);
    await undo(); g = await FG('Painted');
    check('Colour wheel: one undo takes it back', g && sig(g.colours) === WANT, g && g.colours);
    await evalJS("window.__moElements.mode('model'); true");
    await sleep(300);
  }
  {
    // merge and split keep the colours
    const ids = await evalJS("window.state.parts.filter(p => !p.deleted).map(p => p.partId)");
    await tool('merge_parts', { ids });
    const names = await liveNames();
    check('merge: one part', names.length === 1, names);
    let g = await FG(names[0]);
    check('merge: every colour of both parts', g && sig(g.colours) === 'blue:2,green:2,red:8,white:2,yellow:10' && g.covered, g && g.colours);
    await tool('split_parts', { ids: [g.id] });
    const after = await liveNames();
    check('split: two parts again', after.length === 2, after);
    const gs = []; for (const n of after) gs.push(sig((await FG(n)).colours));
    check('split: each keeps its colours', gs.sort().join(' | ') === ['blue:2,green:2,red:8', 'white:2,yellow:10'].sort().join(' | '), gs);
    await undo(); await undo();
    const back = await liveNames();
    check('undo of split and merge: Painted and Plain', back.length === 2 && back.includes('Painted') && back.includes('Plain'), back);
  }

  // ── 3. save and open again ──
  {
    await evalJS(`window.__F = window.File; window.File = function (parts, name, opts) { const f = new window.__F(parts, name, opts); if (/ copy\\.glb$/.test(name)) window.__capt = f; return f; }; window.File.prototype = window.__F.prototype; true`);
    await evalJS('window.__moDuplicateScene()'); await sleep(4000);
    const b64 = await evalJS(`(async () => { if (!window.__capt) return null; const b = new Uint8Array(await window.__capt.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); })()`);
    check('save: the scene was written', !!b64);
    if (b64) {
      const f = path.join(OUT, 'mc-scene copy.glb'); fs.writeFileSync(f, Buffer.from(b64, 'base64'));
      await freshApp();
      await openInApp(f, 'mc-scene copy.glb');
      const names = await liveNames();
      check('reopened: two parts', names.length === 2, names);
      const a = await FG('Painted'), b = await FG('Plain');
      check('reopened: Painted has its three colours', a && sig(a.colours) === WANT && a.covered, a && a.colours);
      check('reopened: Plain has its white top', b && sig(b.colours) === 'white:2,yellow:10', b && b.colours);
      check('reopened: Painted is closed', a && a.open === 0, a && a.open);
    }
  }

  // ── 4. export, judged by Blender ──
  {
    const made = [];
    for (const [fmt, ascii] of [['glb'], ['gltf'], ['obj'], ['fbx'], ['fbx', true], ['usdz'], ['ply'], ['stl']]) {
      const files = await appExport(fmt, 'mc_' + fmt + (ascii ? '_ascii' : ''), !!ascii);
      const main = files.find(x => x.toLowerCase().endsWith('.' + fmt));
      check(`export ${fmt}${ascii ? ' (ASCII)' : ''}: written`, !!main, files);
      if (main) made.push({ fmt, ascii, main });
    }
    const res = inspect(made.map(m => m.main));
    made.forEach(({ fmt, ascii, main }, i) => {
      const R = res[i], label = `export ${fmt}${ascii ? ' (ASCII)' : ''}`;
      if (R.error && /ASCII FBX/.test(R.error)) {
        // (Blender reads no ASCII FBX: the file must say ByPolygon with a material for each of Painted's faces)
        const txt = fs.readFileSync(main, 'utf8');
        check(label + ': a material a polygon (ByPolygon) for the parts of several colours', (txt.match(/MappingInformationType: "ByPolygon"/g) || []).length === 2, (txt.match(/MappingInformationType: "\w+"/g) || []));
        return;
      }
      if (R.error) { check(label + ': Blender opens it', false, R.error); return; }
      if (fmt === 'stl' || fmt === 'ply') { const tris = R.objects.reduce((s, o) => s + o.tris, 0); check(label + ': every triangle', tris === 24, tris); return; }
      const P = R.objects.filter(o => baseName(o.name) === 'Painted' || String(o.path || '').split('/').map(baseName).includes('Painted'));
      const Q = R.objects.filter(o => baseName(o.name) === 'Plain' || String(o.path || '').split('/').map(baseName).includes('Plain'));
      check(label + ': Painted is one object', P.length === 1, R.objects.map(o => o.name));
      if (P[0]) check(label + ': Painted has its three colours on the right faces', sig(P[0].colours) === WANT, P[0].colours);
      if (P[0]) check(label + ': Painted is closed', P[0].open_edges === 0, P[0].open_edges);
      if (Q[0]) check(label + ': Plain is yellow with a white top', sig(Q[0].colours) === 'white:2,yellow:10', Q[0].colours);
    });
  }

  // ── 5. a STEP solid with faces in two colours ──
  if (!fs.existsSync(STEP)) console.log('SKIP the STEP part: no file at', STEP);
  else {
    const glb = path.join(OUT, 'ftc10.glb');
    execFileSync(PY, [path.join(ROOT, 'app/step2glb.py'), STEP, '--out', glb, '--quality', '0.5', '--force-colors', '--no-meshopt', '--force'], { stdio: 'ignore', timeout: 600000 });
    await freshApp();
    await openInApp(glb);
    const names = await liveNames();
    check('STEP: one part', names.length === 1, names);
    let g = await FG(names[0]);
    check('STEP: two colours', g && g.colours.length === 2 && g.covered, g && g.colours);
    check('STEP: closed (no open edges along the colour seam)', g && g.open === 0, g && g.open);
    const t0 = g ? g.n : 0;
    await tool('decimate', { ids: [g.id], reduce_percent: 50 });
    g = await FG(names[0]);
    check('STEP decimated: fewer triangles, still two colours over every triangle', g && g.n < t0 && g.colours.length === 2 && g.covered, g && { n: g.n, was: t0, colours: g.colours });
    console.log('   (after Decimate: ' + (g && g.open) + ' open edges)');
    await undo();
    const files = await appExport('glb', 'mc_step');
    const main = files.find(x => x.endsWith('.glb'));
    if (main) {
      const [R] = inspect([main]);
      check('STEP exported: one object in Blender', R.objects && R.objects.length === 1, R.objects && R.objects.map(o => o.name));
      if (R.objects && R.objects[0]) { check('STEP exported: two colours', R.objects[0].colours.length === 2, R.objects[0].colours); check('STEP exported: closed', R.objects[0].open_edges === 0, R.objects[0].open_edges); }
    } else check('STEP exported: written', false, files);
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 8));
} catch (e) { console.log('HARNESS ERROR:', e.stack || e.message); fail++; }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(fail ? fail + ' failed, ' + pass + ' passed' : 'ok: ' + pass + ' passed');
if (fails.length) console.log('failed:\n  ' + fails.join('\n  '));
console.log('files in', OUT);
process.exit(fail ? 1 : 0);
