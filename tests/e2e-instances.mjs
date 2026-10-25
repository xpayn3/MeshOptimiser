// node tests/e2e-instances.mjs [model, default inbox/GearboxAssy.glb]
//
// The Instances panel and what is behind it (window.__moInstances): the survey of shared shapes, Make original (and its undo), Share
// identical shapes (exact copies, and copies written turned and moved, which join with the part's own turn and place making up the
// difference so no vertex moves in the world), Replace with original, Edit all instances together (a tool run on one part reaches every
// copy in the same undo step, and Undo takes it all back), and what an export writes (the geometries it hands to GLTFExporter).
// Needs the app served (python app/serve.py --no-browser --port 4343; APP_PORT overrides 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9483, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-inst-' + Date.now();
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
const I = (expr) => evalJS('(async () => { const I = window.__moInstances; return ' + expr + '; })()');
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moOpenFile && window.__moInstances && window._appFns)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click(); true");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); window.__moOpenFile(new File([b], ${JSON.stringify(path.basename(MODEL))})); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(5000);

  // helpers inside the page
  await evalJS(`window.__t = {
    sel: (ids) => { state.selected = new Set(ids); },
    dup: (id) => { state.selected = new Set([id]); const before = new Set(state.parts.map(p => p.partId)); window._appFns._Actions.list.find(a => a.id === 'duplicate').run(); return state.parts.filter(p => !before.has(p.partId)).map(p => p.partId); },
    world: (id) => { const p = state.partById.get(id), m = p.mesh; m.updateWorldMatrix(true, false); const a = m.geometry.attributes.position, v = new window._appFns.THREE.Vector3(), out = []; const n = a.count, step = Math.max(1, Math.floor(n / 40)); for (let i = 0; i < n; i += step) { v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); out.push(v.x, v.y, v.z); } return out; },
    far: (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; },
    geom: (id) => state.partById.get(id).mesh.geometry,
    live: () => state.parts.filter(p => !p.deleted),
  }; true`);
  const mesh = await evalJS(`(() => { const ps = __t.live().filter(p => p.mesh && p.mesh.isMesh && !p.instancedMesh && !p.isCloner && p.triCount > 200 && p.triCount < 20000); const c = {}; for (const p of ps) c[p.mesh.geometry.uuid] = (c[p.mesh.geometry.uuid] || 0) + 1; const one = ps.find(p => c[p.mesh.geometry.uuid] === 1); return one ? { id: one.partId, tris: one.triCount, name: one.name } : null; })()`);
  check('a plain mesh part to work with', !!mesh, mesh);
  const s0 = await I('I.survey()');
  console.log('  survey at the start:', s0.parts, 'parts,', s0.shapes, 'shapes,', s0.sets.length, 'shared sets,', s0.copies, 'copies');

  // 0. the panel
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'instances').run(); true"); await sleep(600);
  const ui = await evalJS(`(() => { const sec = document.querySelector('.section-cmd[data-cmd="instances"]'); const rows = [...sec.querySelectorAll('#in-list .in-row')]; return { open: !sec.hidden, rows: rows.length, first: rows[0] && rows[0].textContent, info: sec.querySelector('#in-info').textContent, toggles: sec.querySelectorAll('.toggle input[type=checkbox]').length, buttons: ['all','original','copies','master','unique','share','replace','unique-all'].every(k => !!sec.querySelector('#btn-in-' + k)), tip: sec.querySelector('#in-info').title }; })()`);
  check('the panel opens from the search and lists the shared sets', ui.open && ui.rows > 3 && /cop(y|ies) of/.test(ui.info), ui);
  check('it has two switches in a row and all its buttons', ui.toggles === 2 && ui.buttons, ui);
  check('what an export does is in the tooltip of the summary, not a paragraph', /GLB/.test(ui.tip), ui.tip);
  await evalJS("document.getElementById('in-follow').click(); true");
  check('the Edit all instances together switch is kept', (await evalJS("window._appFns._Prefs.get('instFollow')")) === true);
  await evalJS("document.getElementById('in-follow').click(); true");
  check('and switches off again', (await evalJS("window._appFns._Prefs.get('instFollow')")) === false);
  await evalJS("document.querySelector('#in-sort [data-sort=name]').click(); true"); await sleep(200);
  const names = await evalJS("[...document.querySelectorAll('#in-list .in-row .in-name')].map(e => e.textContent)");
  check('Sort by name sorts the list', JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))), names.slice(0, 4));
  await evalJS("(() => { const f = document.getElementById('in-filter'); f.value = '" + (await evalJS("(document.querySelector('#in-list .in-row .in-name')||{}).textContent || ''")).slice(0, 3).replace(/'/g, '') + "'; f.dispatchEvent(new Event('input')); return true; })()"); await sleep(200);
  check('the name filter narrows the list', (await evalJS("document.querySelectorAll('#in-list .in-row').length")) <= ui.rows);
  await evalJS("(() => { const f = document.getElementById('in-filter'); f.value = ''; f.dispatchEvent(new Event('input')); return true; })()");

  // 1. survey and the panel
  const d1 = await evalJS(`__t.dup(${mesh.id})`);
  check('Ctrl+D made one copy', d1.length === 1, d1);
  const s1 = await I('I.survey()');
  const dupShared = s1.sets.find(x => x.ids.includes(d1[0]) || x.ids.includes(mesh.id));
  console.log('  duplicate shares its mesh with the original:', !!dupShared);
  // make it a part of its own: unique, then it is an exact copy of the original with a separate buffer
  await I(`I.makeUnique([${d1[0]}])`);
  const gSame = await evalJS(`__t.geom(${d1[0]}) !== __t.geom(${mesh.id})`);
  check('Make unique gave the copy a mesh of its own', gSame);

  // 2. Share identical shapes: the exact copy joins the original
  const w0 = await evalJS(`__t.world(${d1[0]})`);
  const n1 = await I('I.share({})');
  check('Share identical shapes joined at least the copy', n1 >= 1, n1);
  check('the copy uses the original\'s mesh now', await evalJS(`__t.geom(${d1[0]}) === __t.geom(${mesh.id})`));
  check('no vertex of the copy moved in the world', (await evalJS(`__t.far(${JSON.stringify(w0)}, __t.world(${d1[0]}))`)) < 1e-6);
  const h = await evalJS(`state.partById.get(${d1[0]}).hash === state.partById.get(${mesh.id}).hash`);
  check('the copy has the original\'s hash (an export writes the mesh once)', h);
  await evalJS('window._appFns.undoLast(); true'); await sleep(200);
  check('Undo gives the copy its own mesh back', await evalJS(`__t.geom(${d1[0]}) !== __t.geom(${mesh.id})`));
  await evalJS('window._appFns.redoLast(); true'); await sleep(200);
  check('Redo shares again', await evalJS(`__t.geom(${d1[0]}) === __t.geom(${mesh.id})`));

  // 3. Make original (and undo)
  const orig0 = (await I('I.survey()')).sets.find(x => x.ids.includes(d1[0]));
  check('the set of two has the first part as its original', orig0 && orig0.original === mesh.id, orig0);
  await I(`I.makeOriginal(${d1[0]})`);
  const orig1 = (await I('I.survey()')).sets.find(x => x.ids.includes(d1[0]));
  check('Make original: the copy is the original now', orig1 && orig1.original === d1[0], orig1);
  await evalJS('window._appFns.undoLast(); true'); await sleep(200);
  const orig2 = (await I('I.survey()')).sets.find(x => x.ids.includes(d1[0]));
  check('Undo puts the first part back as the original', orig2 && orig2.original === mesh.id, orig2);

  // 4. a copy written turned and moved (its own buffer, the same points in the same order, rotated and moved in the geometry)
  const t = await evalJS(`__t.dup(${mesh.id})`);
  await I(`I.makeUnique([${t[0]}])`);
  await evalJS(`(() => { const TH = window._appFns.THREE, g = __t.geom(${t[0]}); const m = new TH.Matrix4().makeRotationFromEuler(new TH.Euler(0.6, -0.4, 1.1)).setPosition(37, -12, 9); g.applyMatrix4(m); return true; })()`);
  const w1 = await evalJS(`__t.world(${t[0]})`);
  check('before: the turned copy has a mesh of its own', await evalJS(`__t.geom(${t[0]}) !== __t.geom(${mesh.id})`));
  const nExact = await I('I.share({})');
  check('without "turned and moved" it is left alone', await evalJS(`__t.geom(${t[0]}) !== __t.geom(${mesh.id})`), nExact);
  const nMoved = await I('I.share({ moved: true, tol: 1e-4 })');
  check('with "turned and moved" it joins the original', nMoved >= 1 && (await evalJS(`__t.geom(${t[0]}) === __t.geom(${mesh.id})`)), nMoved);
  const dev = await evalJS(`__t.far(${JSON.stringify(w1)}, __t.world(${t[0]}))`);
  check('no vertex of it moved in the world (to a millionth of its size)', dev < 1e-3, dev);
  await evalJS('window._appFns.undoLast(); true'); await sleep(200);
  check('Undo puts its mesh and its place back', (await evalJS(`__t.geom(${t[0]}) !== __t.geom(${mesh.id})`)) && (await evalJS(`__t.far(${JSON.stringify(w1)}, __t.world(${t[0]}))`)) < 1e-6);

  // 5. Replace with original: a turned copy and a part that is not the shape
  const other = await evalJS(`(() => { const p = __t.live().find(q => q.mesh && q.mesh.isMesh && !q.instancedMesh && q.partId !== ${mesh.id} && q.triCount !== ${mesh.tris} && q.triCount > 50 && q.triCount < 5000); return p ? p.partId : null; })()`);
  const rep = await I(`I.replace([${mesh.id}, ${t[0]}${other ? ', ' + other : ''}], { tol: 1e-4 })`);
  check('Replace with original replaced the turned copy', rep === 1 && (await evalJS(`__t.geom(${t[0]}) === __t.geom(${mesh.id})`)), rep);
  if (other) check('a part that is not the shape was left alone', await evalJS(`__t.geom(${other}) !== __t.geom(${mesh.id})`));
  check('no vertex moved in the world', (await evalJS(`__t.far(${JSON.stringify(w1)}, __t.world(${t[0]}))`)) < 1e-3);
  await evalJS('window._appFns.undoLast(); true'); await sleep(200);

  // 6. Edit all instances together
  await I(`I.share({ moved: true })`);                         // the turned copy and the copy of the copy join again
  await I('I.follow(true)');
  const set = (await I('I.survey()')).sets.find(x => x.ids.includes(mesh.id));
  check('a set of at least three to follow', set && set.ids.length >= 3, set && set.ids.length);
  const before = await evalJS(`(() => ({ tris: __t.live().filter(p => ${JSON.stringify(set ? set.ids : [])}.includes(p.partId)).map(p => p.triCount), hist: state.history.length }))()`);
  const uuid0 = await evalJS(`__t.geom(${mesh.id}).uuid`);
  const run = await evalJS(`(async () => { const r = await window.__moAgent.meshOp('smoothSurface', { ids: [${mesh.id}], quiet: true }); return { parts: r.parts, why: r.results && r.results[0] && r.results[0].why }; })()`);
  await sleep(500);
  check('the tool ran (its step counts the copies that followed)', run.parts >= 1, run);
  const after = await evalJS(`(() => { const ids = ${JSON.stringify(set ? set.ids : [])}; const g = __t.geom(${mesh.id}); return { same: ids.every(id => __t.geom(id) === g), changed: g.uuid !== ${JSON.stringify(uuid0)}, hist: state.history.length, tris: ids.map(id => state.partById.get(id).triCount) }; })()`);
  check('every copy has the new mesh, still one shape', after.same && after.changed, after);
  check('it is one undo step', after.hist === before.hist + 1, { before: before.hist, after: after.hist });
  await evalJS('window._appFns.undoLast(); true'); await sleep(300);
  const back = await evalJS(`(() => { const ids = ${JSON.stringify(set ? set.ids : [])}; const g = __t.geom(${mesh.id}); return { same: ids.every(id => __t.geom(id) === g), tris: ids.map(id => state.partById.get(id).triCount) }; })()`);
  check('Undo puts every copy back, still one shape', back.same && JSON.stringify(back.tris) === JSON.stringify(before.tris), { back, before });
  await I('I.follow(false)');

  // 7. the export hands one geometry to GLTFExporter for a shared shape
  const ex = await evalJS(`(async () => {
    const { root } = window._appFns.buildExportRoot({ visibleOnly: false, merge: false, scale: 1, axis: 'z-up', origin: 'model' }); const set = new Set(); let meshes = 0;
    root.traverse(o => { if (o.isMesh) { meshes++; set.add(o.geometry); } });
    return { meshes, geometries: set.size };
  })()`).catch(e => ({ err: String(e.message || e) }));
  console.log('  export root:', JSON.stringify(ex));
  if (!ex.err) check('the export has fewer geometries than meshes (a shared shape is handed over once)', ex.geometries < ex.meshes, ex);

  check('no script error', errors.length === 0, errors.slice(0, 3));
} catch (e) { fail++; console.log('FAIL', e && e.stack || e); }
console.log(pass + ' passed, ' + fail + ' failed');
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
