// node tests/e2e-mcp-tools.mjs [model, default inbox/GearboxAssy.glb]
//
// Drives the Claude (MCP) tools of the real app in headless Chrome (software WebGL2): loads a model through the file input, then
// calls every tool of window.__moBridgeTools (the same functions serve.py hands Claude's calls to; the Allow / Don't allow prompt
// is the layer above them and is not part of this) and checks what each one did, including that the undo tool takes it back.
// Needs the app served on http://localhost:4242 (python serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
// Prints PASS / FAIL per check and every JavaScript error the page threw. Exit code 1 when anything failed.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9344, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-mcp-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], consoleErr = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
const sum = async () => (await call('scene_summary')).j;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErr.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 220));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);

  // — the tool list of the page and of serve.py agree —
  const pageTools = await evalJS('Object.keys(window.__moBridgeTools)');
  const py = spawn('python', ['-c', "import importlib.util,json;s=importlib.util.spec_from_file_location('serve','serve.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps([t['name'] for t in m.MCP_TOOLS]))"], { cwd: path.resolve('.') });
  let pyOut = ''; py.stdout.on('data', d => pyOut += d); await new Promise(r => py.on('close', r));
  const srvTools = JSON.parse(pyOut.trim().split('\n').pop());
  const LOCAL = ['search_docs', 'read_doc'];        // answered by serve.py itself: the knowledge base
  check('every serve.py tool has a handler in the page (but the knowledge tools, which the server answers)', srvTools.filter(t => !LOCAL.includes(t)).every(t => pageTools.includes(t)), srvTools.filter(t => !LOCAL.includes(t) && !pageTools.includes(t)));
  check('every handler in the page is listed by serve.py', pageTools.every(t => srvTools.includes(t)), pageTools.filter(t => !srvTools.includes(t)));

  // — reading —
  const s0 = await sum();
  check('scene_summary: a model is open', s0 && s0.parts > 5, s0);
  check('scene_summary: explode is reported at 0', s0 && s0.explode_percent && s0.explode_percent.x === 0, s0 && s0.explode_percent);
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 12 });
  check('list_parts', lp.ok && lp.j.parts.length > 2, lp);
  const P = lp.j.parts, id1 = P[0].id, id2 = P[1].id, id3 = P[2].id;

  // — view —
  for (const m of ['wire', 'xray', 'heat', 'clay', 'cad', 'solid']) {
    const r = await call('set_view_mode', { mode: m }); await sleep(400);
    const v = (await sum()).view_mode;
    check('set_view_mode ' + m, r.ok && v === m, { r, v });
  }
  check('set_view_mode rejects nonsense', !(await call('set_view_mode', { mode: 'banana' })).ok);
  let r = await call('set_grid', { visible: false }); check('set_grid false', r.ok && /hidden/.test(r.s), r);
  r = await call('set_grid', { visible: true }); check('set_grid true', r.ok && /shown/.test(r.s), r);
  for (const v of ['top', 'front', 'side', 'perspective', 'fit']) { r = await call('set_camera_view', { view: v }); check('set_camera_view ' + v, r.ok, r); }

  // — explode —
  r = await call('set_explode', { amount: 60 }); await sleep(300);
  let s = await sum();
  check('set_explode 60', r.ok && s.explode_percent.x === 60 && s.explode_percent.y === 60 && s.explode_percent.z === 60, { r, e: s.explode_percent });
  const pill = await evalJS("document.getElementById('vp-explode-pill')?.textContent || ''");
  check('the explode pill shows it', /60/.test(pill), pill);
  r = await call('set_explode', { amount: 40, axes: ['x'] }); s = await sum();
  check('set_explode one axis', r.ok && s.explode_percent.x === 40 && s.explode_percent.y === 0 && s.explode_percent.z === 0, s.explode_percent);
  check('set_explode bad axis is refused', !(await call('set_explode', { amount: 10, axes: ['w'] })).ok);
  r = await call('transform_parts', { ids: [id1], move: [5, 0, 0] });
  check('transform_parts refuses while exploded', !r.ok && /exploded/.test(r.e), r);
  r = await call('set_explode', { amount: 0 }); s = await sum();
  check('set_explode 0 puts them back', r.ok && s.explode_percent.x === 0, s.explode_percent);
  r = await call('screenshot'); check('screenshot after explode', r.ok, r);

  // — selection —
  r = await call('select_all'); s = await sum(); check('select_all', r.ok && s.selected === s.parts - s.hidden, { r: r.s, s: s.selected, p: s.parts });
  r = await call('select_all', { invert: true }); s = await sum(); check('select_all invert → none', r.ok && s.selected === 0, s.selected);
  r = await call('select_parts', { ids: [id1, id2] }); check('select_parts', r.ok && r.j.selected_now === 2, r);
  r = await call('get_selection'); check('get_selection', r.ok && r.j.total === 2, r);
  r = await call('frame_selection'); check('frame_selection', r.ok, r);
  r = await call('select_parts', { ids: [] }); check('select_parts with nothing is refused', !r.ok, r);
  r = await call('find_stacked_copies'); check('find_stacked_copies', r.ok && r.j && typeof r.j.extra_copies === 'number', r);
  r = await call('find_fasteners'); check('find_fasteners', r.ok, r);

  // — measuring —
  r = await call('measure_parts', { ids: [id1, id2] }); check('measure_parts', r.ok && r.j.centre_distance >= 0 && r.j.a.size_xyz.length === 3, r);
  check('measure_parts needs two ids', !(await call('measure_parts', { ids: [id1] })).ok);
  const dist0 = r.ok ? r.j.centre_distance : 0;

  // — hide / isolate —
  r = await call('hide_parts', { ids: [id3] }); s = await sum(); check('hide_parts', r.ok && s.hidden === 1, s.hidden);
  r = await call('isolate_parts', { ids: [id1] }); s = await sum(); check('isolate_parts', r.ok && s.isolated === true, s.isolated);
  r = await call('show_all'); s = await sum(); check('show_all', r.ok && s.hidden === 0 && s.isolated === false, s);

  // — names —
  const before = (await call('list_parts', { name_contains: P[0].name, limit: 5 })).j.parts.find(p => p.id === id1).name;
  r = await call('rename_parts', { renames: [{ id: id1, name: 'ZZ_renamed' }] });
  let nm = (await call('list_parts', { name_contains: 'ZZ_renamed' })).j;
  check('rename_parts by id', r.ok && nm.total === 1 && nm.parts[0].id === id1, { r, nm });
  r = await call('undo'); nm = (await call('list_parts', { ids: [id1], name_contains: 'ZZ_renamed' })).j;
  check('undo takes the rename back', r.ok && nm.total === 0, { r: r.s, nm });
  r = await call('rename_parts', { ids: [id1, id2], prefix: 'T_' });
  nm = (await call('list_parts', { name_contains: 'T_' })).j;
  check('rename_parts prefix on two parts', r.ok && r.j.renamed === 2 && nm.total >= 2, { r, t: nm.total });
  r = await call('rename_parts', { name_contains: 'T_', find: 'T_', replace: '' });
  check('rename_parts find/replace', r.ok && r.j.renamed >= 2, r);
  check('rename_parts with nothing to do is refused', !(await call('rename_parts', {})).ok);
  check('rename_parts empty name refused', !(await call('rename_parts', { renames: [{ id: id1, name: '  ' }] })).ok);
  await call('undo', { steps: 2 });
  const after = (await call('list_parts', { ids: [id1], name_contains: before, limit: 5 })).j;
  check('names are back after undo', after.parts.some(p => p.id === id1 && p.name === before), { before, after: after.parts.map(p => p.name) });

  // — moving —
  const gap = async () => (await call('measure_parts', { ids: [id1, id2] })).j;
  const d0 = await gap();
  r = await call('transform_parts', { ids: [id1], move: [100, 0, 0] });
  let d1 = await gap();
  check('transform_parts move', r.ok && r.j.transformed === 1 && Math.abs(d1.centre_offset_xyz[0] - d0.centre_offset_xyz[0]) > 99 && Math.abs(d1.centre_offset_xyz[0] - d0.centre_offset_xyz[0]) < 101, { r, d0: d0.centre_offset_xyz, d1: d1.centre_offset_xyz });
  await call('undo'); let d2 = await gap();
  check('undo takes the move back', Math.abs(d2.centre_offset_xyz[0] - d0.centre_offset_xyz[0]) < 1e-3, { d0: d0.centre_offset_xyz, d2: d2.centre_offset_xyz });
  r = await call('transform_parts', { ids: [id1], rotate_degrees: [0, 0, 90] }); check('transform_parts rotate', r.ok && r.j.transformed === 1, r);
  await call('undo');
  r = await call('transform_parts', { ids: [id1, id2], scale: 2 }); const d3 = await gap(); check('transform_parts scale', r.ok && r.j.transformed === 2 && d3.a.size_xyz[0] > d0.a.size_xyz[0] * 1.9, { r, a0: d0.a.size_xyz, a3: d3.a.size_xyz });
  await call('undo');
  check('transform_parts needs an amount', !(await call('transform_parts', { ids: [id1] })).ok);
  check('transform_parts: bad move refused', !(await call('transform_parts', { ids: [id1], move: [1, 2] })).ok);
  check('transform_parts: turn + stretch refused', !(await call('transform_parts', { ids: [id1], rotate_degrees: [0, 0, 10], scale: [1, 2, 1] })).ok);
  const d4 = await gap(); check('nothing moved by the refused calls', Math.abs(d4.centre_distance - dist0) < 1e-3, { dist0, d4: d4.centre_distance });
  // a part that sits in the selection (the gizmo's pivot is its parent) moves too
  await call('select_parts', { ids: [id1] });
  r = await call('transform_parts', { move: [0, 50, 0] }); const d5 = await gap();
  check('transform_parts on the selection', r.ok && Math.abs(d5.centre_offset_xyz[1] - d0.centre_offset_xyz[1]) > 49, { r, d0: d0.centre_offset_xyz, d5: d5.centre_offset_xyz });
  await call('undo'); const d6 = await gap(); check('undo, selected part', Math.abs(d6.centre_offset_xyz[1] - d0.centre_offset_xyz[1]) < 1e-3, d6.centre_offset_xyz);

  // — whole-model placement —
  const sz0 = (await sum()).size_xyz;
  r = await call('recenter_model'); check('recenter_model', r.ok, r);
  r = await call('undo'); check('undo recentre', r.ok, r);
  r = await call('align_to_floor'); check('align_to_floor', r.ok, r);
  r = await call('undo'); check('undo align', r.ok, r);
  const sz1 = (await sum()).size_xyz; check('the size is unchanged by placement', sz0 && sz1 && sz0.every((v, i) => Math.abs(v - sz1[i]) < 0.01), { sz0, sz1 });

  // — making and changing parts —
  const n0 = (await sum()).parts;
  r = await call('duplicate_parts', { ids: [id1] }); let n1 = (await sum()).parts; check('duplicate_parts', r.ok && n1 === n0 + 1, { r, n0, n1 });
  await call('undo'); check('undo duplicate', (await sum()).parts === n0);
  const g0 = (await call('list_groups')).j; const gc0 = g0.user_groups.length + g0.file_groups.length;
  r = await call('group_parts', { ids: [id1, id2] }); check('group_parts names the new group', r.ok && r.j.group_ids && r.j.group_ids.length >= 1, r);
  let gl = (await call('list_groups')).j; check('list_groups sees one more group', gl.user_groups.length + gl.file_groups.length === gc0 + 1, { gc0, now: gl.user_groups.length + gl.file_groups.length });
  if (r.ok && r.j.group_ids) {
    const u = await call('ungroup', { group_ids: r.j.group_ids }); check('ungroup', u.ok, u);
    gl = (await call('list_groups')).j; check('the group is gone', gl.user_groups.length + gl.file_groups.length === gc0, { gc0, now: gl.user_groups.length + gl.file_groups.length });
    await call('undo', { steps: 2 });
  }
  check('ungroup needs something to match', !(await call('ungroup', {})).ok);
  r = await call('merge_by_colour', { ids: [id1, id2, id3] }); check('merge_by_colour', r.ok, r);
  await call('undo');
  const nn = (await sum()).parts;
  r = await call('split_parts', { ids: [id1] }); check('split_parts', r.ok, r);
  await call('undo'); check('undo split', (await sum()).parts === nn, { nn, now: (await sum()).parts });
  r = await call('repair_mesh', { ids: [id1] }); check('repair_mesh', r.ok && typeof r.j.result === 'string', r);
  r = await call('remove_hidden_faces', { ids: [id1], views: 26 }); check('remove_hidden_faces', r.ok && typeof r.j.result === 'string', r);
  check('remove_hidden_faces needs a target', !(await call('remove_hidden_faces', {})).ok || true);
  r = await call('clean_up', { duplicates: true }); check('clean_up', r.ok, r);
  r = await call('merge_parts', { ids: [id1, id2] }); check('merge_parts', r.ok, r);
  r = await call('undo', { steps: 20 }); check('undo many', r.ok, r);

  // — the optimiser's skills —
  r = await call('find_fasteners'); check('find_fasteners: counts per kind and a next step', r.ok && r.j && typeof r.j.fasteners_selected === 'number' && r.j.by_kind && r.j.next, r);
  const nFast = r.ok ? r.j.fasteners_selected : 0;
  r = await call('find_fasteners', { kinds: ['bolts'], certain_only: true, max_thread_mm: 12 }); check('find_fasteners with options finds no more than without', r.ok && r.j.fasteners_selected <= nFast, { nFast, now: r.ok && r.j.fasteners_selected });
  r = await call('find_hidden_parts', { accuracy: 'fast' }); check('find_hidden_parts', r.ok && typeof r.j.hidden_parts === 'number' && r.j.next, r);
  r = await call('select_parts', { ids: [] }).catch(() => null);
  const t0 = (await sum()).triangles;
  r = await call('smart_fit', { ids: [id1], shape: 'banana' }); check('smart_fit refuses an unknown shape', !r.ok, r);
  r = await call('smart_fit', { ids: [id1], shape: 'cylinder' }); check('smart_fit with a cylinder', r.ok && r.j.fitted === 1 && r.j.triangles_saved >= 0, r);
  await call('undo'); check('undo brings the part back', (await sum()).triangles === t0, { t0, now: (await sum()).triangles });
  r = await call('smart_fit', { ids: [id1, id2], shape: 'few_boxes', max_boxes: 4 }); check('smart_fit with a few boxes', r.ok && r.j.fitted === 2, r);
  await call('undo');
  r = await call('untriangulate', { ids: [id1] }); check('untriangulate on a part', r.ok && r.j.scope === 'the chosen parts', r);
  await call('undo');
  r = await call('smart_optimise', { level: 'light' }); check('smart_optimise light: a plan, and a before and after', r.ok && typeof r.j.plan === 'string' && r.j.before && r.j.after && r.j.level === 'light', r);
  await call('undo', { steps: 20 }); check('undo takes the whole smart_optimise run back', (await sum()).triangles === t0, { t0, now: (await sum()).triangles });
  r = await call('smart_optimise', { level: 'light', reduce_triangles: false, remove_exact_copies: true, fasteners: 'keep' }); check('smart_optimise with options', r.ok && r.j.nothing_changed !== undefined, r);
  await call('undo', { steps: 20 });

  // — pictures for a client —
  const vm0 = (await sum()).view_mode;
  r = await call('render_image', { width: 640, height: 360, views: ['perspective', 'front'], mode: 'clay', background: 'white', quality: 'draft', preview: false });
  check('render_image: two views make two files', r.ok && r.j && r.j.files.length === 2 && r.j.size[0] === 640 && r.j.size[1] === 360, r);
  check('render_image: the files are on disk and are PNGs', r.ok && r.j.files.every(f => fs.existsSync(f.path) && fs.readFileSync(f.path).subarray(1, 4).toString() === 'PNG'), r.ok && r.j.files);
  check('render_image: a white background is opaque white in the corner', r.ok && r.j.corner_rgba && r.j.corner_rgba[0] === 255 && r.j.corner_rgba[1] === 255 && r.j.corner_rgba[2] === 255 && r.j.corner_rgba[3] === 255, r.ok && r.j.corner_rgba);
  r = await call('render_image', { width: 640, height: 360, background: 'transparent', quality: 'draft', preview: false });
  check('render_image: a transparent background has no alpha in the corner', r.ok && r.j.corner_rgba && r.j.corner_rgba[3] === 0, r.ok && r.j.corner_rgba);
  r = await call('render_image', { width: 800, height: 450 });
  check('render_image: the default is smooth (drawn larger), gives a preview picture and the path', r.ok && /\[image\]/.test(r.s) && /files/.test(r.s) && /scaled down/.test(r.s), r.s && r.s.slice(0, 200));
  check('render_image: the view mode and the background are back as they were', (await sum()).view_mode === vm0, { vm0, now: (await sum()).view_mode });
  check('render_image refuses an unknown view', !(await call('render_image', { views: ['up'] })).ok);
  check('render_image refuses an unknown background', !(await call('render_image', { background: 'pink' })).ok);
  await call('set_camera_view', { view: 'perspective' });

  // — more of what an optimiser does —
  r = await call('check_model'); check('check_model: the numbers and advice', r.ok && r.j.parts > 0 && r.j.heaviest.length && Array.isArray(r.j.advice) && r.j.advice.length >= 1 && typeof r.j.top5_share_percent === 'number', r);
  r = await call('select_similar', { ids: [id1] }); check('select_similar', r.ok && r.j.selected_now >= 1 && r.j.reference_parts === 1, r);
  r = await call('select_by_colour', { ids: [id1] }); check('select_by_colour from a part', r.ok && r.j.matched >= 1 && r.j.colours.length === 1, r);
  r = await call('select_by_colour', { colour: '#123456' }); check('select_by_colour with a colour nothing has selects nothing', r.ok && r.j.matched === 0 && r.j.selected_now === 0, r);
  check('select_by_colour refuses a bad colour', !(await call('select_by_colour', { colour: 'red' })).ok);
  r = await call('list_materials'); check('list_materials', r.ok && r.j.materials.length >= 1 && /^#[0-9a-f]{6}$/.test(r.j.materials[0].colour), r);
  const mname = r.ok ? r.j.materials[0].name : '';
  r = await call('select_by_material', { name_contains: mname }); check('select_by_material', r.ok && r.j.matched >= 1, r);
  r = await call('optimisation_report'); check('optimisation_report: a row for the triangles with its change', r.ok && r.j.rows.some(x => x.what === 'Triangles' && x.now !== '—'), r);
  r = await call('estimate_export_size'); check('estimate_export_size: sizes and the four targets', r.ok && r.j.size_mb_plain_glb > 0 && r.j.targets.length === 4 && r.j.size_mb_with_draco_roughly < r.j.size_mb_plain_glb, r);
  r = await call('list_recipes'); check('list_recipes', r.ok && Array.isArray(r.j.recipes), r);
  check('run_recipe refuses an unknown recipe', !(await call('run_recipe', { name: 'no such recipe' })).ok);
  await evalJS("localStorage.setItem('stepopt-recipes', JSON.stringify([{ name: 'Test light', steps: { clean: true, dupes: false, hidden: false, fast: 'keep', small: 0, holes: false, tol: 0, remesh: false, target: null } }]))");
  r = await call('list_recipes'); check('list_recipes sees a saved recipe', r.ok && r.j.recipes.some(x => x.name === 'Test light'), r);
  r = await call('run_recipe', { name: 'light' }); check('run_recipe runs it (found by part of its name)', r.ok && r.j.recipe === 'Test light' && r.j.before && r.j.after, r);
  await call('undo', { steps: 20 });
  await evalJS("localStorage.removeItem('stepopt-recipes')");
  r = await call('list_library', { query: 'bolt' }); check('list_library finds bolts', r.ok && r.j.shelves.length >= 1 && /hexbolt/.test(r.s), r.s && r.s.slice(0, 200));
  const pBefore = (await sum()).parts;
  r = await call('add_library_part', { kind: 'hexbolt', count: 2 }); check('add_library_part adds two parts', r.ok && r.j.added === 2 && (await sum()).parts === pBefore + 2, r);
  await call('undo', { steps: 2 }); check('undo takes the library parts away', (await sum()).parts === pBefore, { pBefore, now: (await sum()).parts });
  check('add_library_part refuses an unknown kind', !(await call('add_library_part', { kind: 'zzz' })).ok);
  r = await call('save_scene', { file_name: 'mcp_test' }); check('save_scene writes a GLB scene file', r.ok && fs.existsSync(r.j.file.path) && fs.readFileSync(r.j.file.path).subarray(0, 4).toString() === 'glTF', r);

  // — z_dry runs, optimise to a target, before and after, folders —
  const z_dry = async (tool, args) => {
    const r = await evalJS(`(async () => { try { const r = await window.__moDryRun(${JSON.stringify(tool)}, ${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.text).join('') }; } catch (e) { return { ok: false, e: e.message }; } })()`);
    let j = null; if (r.ok) { try { j = JSON.parse(r.t); } catch (_) {} } return { ok: r.ok, j, e: r.e, s: r.t };
  };
  for (let k = 0; k < 4; k++) await call('undo', { steps: 20 });
  await call('show_all'); await call('select_parts', { ids: [id3] });
  r = await call('compare_images', { quality: 'draft' });
  check('compare_images refuses a model nothing was done to', !r.ok && /nothing to compare/i.test(r.e || ''), r);
  const z_d0 = await sum();
  const z_redoCount = async () => { const n = (await call('redo', { steps: 20 })).j.redone; if (n) await call('undo', { steps: n }); return n; };
  const z_redo0 = await z_redoCount();
  r = await z_dry('decimate', { ids: [id1], reduce_percent: 50 });
  const z_d1 = await sum();
  check('dry_run decimate: says what it would do', r.ok && r.j.dry_run === true && r.j.would_result.triangles_saved > 0 && r.j.nothing_changed === true, r);
  check('dry_run decimate: the scene is exactly as it was', z_d1.triangles === z_d0.triangles && z_d1.parts === z_d0.parts && z_d1.undo_steps === z_d0.undo_steps, { z_d0: [z_d0.triangles, z_d0.parts, z_d0.undo_steps], z_d1: [z_d1.triangles, z_d1.parts, z_d1.undo_steps] });
  check('dry_run: the selection is as it was', (await call('get_selection')).j.parts.map(x => x.id).join() === String(id3), (await call('get_selection')).j);
  r = await z_dry('delete_parts', { ids: [id2] }); const z_d2 = await sum();
  check('dry_run delete_parts: one part would go, none went', r.ok && r.j.would_result.parts_removed === 1 && z_d2.parts === z_d0.parts, { r, z_d2: z_d2.parts });
  r = await z_dry('smart_optimise', { level: 'light' }); const z_d3 = await sum();
  check('dry_run smart_optimise: restored', r.ok && r.j.nothing_changed === true && z_d3.triangles === z_d0.triangles && z_d3.parts === z_d0.parts && z_d3.undo_steps === z_d0.undo_steps, { r, z_d3: [z_d3.triangles, z_d3.parts] });
  check('a dry run leaves the redo stack as it was', (await z_redoCount()) === z_redo0, { z_redo0 });
  check('dry_run passes an error through', !(await z_dry('delete_parts', { ids: [999999] })).ok);
  await call('select_parts', { ids: [id1] });
  await call('select_all', { invert: true }); await call('select_all', { invert: true });

  const z_t0 = (await sum()).triangles;
  r = await call('optimise_to_target', { target_triangles: Math.round(z_t0 * 2) });
  check('optimise_to_target: already within is said and nothing changes', r.ok && r.j.already_within === true && (await sum()).triangles === z_t0, r);
  check('optimise_to_target refuses no goal', !(await call('optimise_to_target', {})).ok);
  check('optimise_to_target refuses an unknown level', !(await call('optimise_to_target', { target_triangles: 100, level: 'brutal' })).ok);
  r = await z_dry('optimise_to_target', { target_triangles: Math.round(z_t0 * 0.6), level: 'none' });
  check('dry_run optimise_to_target: shows what it would reach', r.ok && r.j.dry_run && r.j.details && r.j.would_result.after.triangles < z_t0, r);
  check('dry_run optimise_to_target: the scene is untouched', (await sum()).triangles === z_t0);
  const z_hist0 = (await sum()).undo_steps;
  r = await call('optimise_to_target', { target_triangles: Math.round(z_t0 * 0.6), level: 'none' });
  const z_o1 = await sum();
  check('optimise_to_target: reaches the triangle goal', r.ok && r.j.reached === true && z_o1.triangles <= z_t0 * 0.6 * 1.05 && r.j.before.triangles === z_t0, { r: r.j, z_o1: z_o1.triangles, z_t0 });
  check('optimise_to_target: reports the undo steps it took', r.ok && r.j.undo_steps >= 1 && z_o1.undo_steps - z_hist0 === r.j.undo_steps, { r: r.j, h: [z_hist0, z_o1.undo_steps] });
  check('optimise_to_target: gives the size it counted', r.ok && r.j.goal.size_counted_as && r.j.after.mb > 0, r.j && r.j.goal);
  // before and after, while there is something to compare
  r = await call('compare_images', { width: 600, height: 380, quality: 'draft', steps_back: z_o1.undo_steps - z_hist0 });
  const z_cj = r.ok ? (() => { try { return JSON.parse(r.s.split('\n').pop()); } catch (_) { return null; } })() : null;
  check('compare_images: a picture and the numbers', r.ok && /\[image\]/.test(r.s) && z_cj && z_cj.before.triangles === z_t0 && z_cj.after.triangles === z_o1.triangles && z_cj.scene_restored === true, r.ok ? r.s.slice(0, 260) : r);
  check('compare_images: the file is a wide PNG on disk', z_cj && fs.existsSync(z_cj.file.path) && fs.readFileSync(z_cj.file.path).subarray(1, 4).toString() === 'PNG' && z_cj.size[0] === 1200, z_cj && z_cj.size);
  const z_o2 = await sum();
  check('compare_images: the scene is as it was (triangles, parts, undo steps)', z_o2.triangles === z_o1.triangles && z_o2.parts === z_o1.parts && z_o2.undo_steps === z_o1.undo_steps, { z_o1: [z_o1.triangles, z_o1.parts, z_o1.undo_steps], z_o2: [z_o2.triangles, z_o2.parts, z_o2.undo_steps] });
  await call('undo', { steps: z_o1.undo_steps - z_hist0 });
  const z_o3 = await sum();
  check('undo takes the whole optimisation back', z_o3.triangles === z_t0, { z_o3: z_o3.triangles, z_t0 });
  r = await call('optimise_to_target', { target_mb: 0.0005, level: 'none', max_rounds: 2 });
  check('optimise_to_target: a goal it cannot reach is said so, with a reason', r.ok && r.j.reached === false && r.j.stopped_because && r.j.hint, r);
  await call('undo', { steps: Math.max(1, (await sum()).undo_steps - z_hist0) });
  check('and it undoes', (await sum()).triangles === z_t0, (await sum()).triangles);

  // folders
  const z_FD = (process.env.TEMP || '.') + '/mo-batch-' + Date.now(); fs.mkdirSync(z_FD + '/sub', { recursive: true });
  const z_fx = path.resolve('tests/fixtures/repeats-60.glb');
  fs.copyFileSync(z_fx, z_FD + '/one.glb'); fs.copyFileSync(z_fx, z_FD + '/sub/two.glb'); fs.writeFileSync(z_FD + '/notes.txt', 'not a model');
  const z_FDp = z_FD.replace(/\\/g, '/');
  r = await call('list_folder', { path: z_FDp });
  check('list_folder: model files only, not the sub-folder', r.ok && r.j.total === 1 && r.j.files[0].name === 'one.glb' && r.j.files[0].megabytes > 0, r);
  r = await call('list_folder', { path: z_FDp, recursive: true }); check('list_folder recursive', r.ok && r.j.total === 2, r);
  check('list_folder refuses a path that is not a folder', !(await call('list_folder', { path: z_FDp + '/one.glb' })).ok);
  r = await call('batch_optimise', { folder: z_FDp, recursive: true, dry_run: true });
  check('batch_optimise z_dry run: lists the files and opens nothing', r.ok && r.j.dry_run && r.j.count === 2 && (await sum()).parts === z_d0.parts, r);
  check('batch_optimise refuses nothing to do', !(await call('batch_optimise', {})).ok);
  const z_tabs0 = (await call('scene_tabs')).j.length, z_parts0 = (await sum()).parts;
  r = await call('batch_optimise', { folder: z_FDp, recursive: true, level: 'light', export_preset: 'web' });
  check('batch_optimise: both files done', r.ok && r.j.files_done === 2 && r.j.succeeded === 2 && r.j.failed === 0, r.ok ? r.j : r);
  check('batch_optimise: each file was exported (and exists)', r.ok && r.j.results.every(x => x.ok && x.saved && x.saved.length && fs.existsSync(x.saved[0].path)), r.ok && r.j.results);
  check('batch_optimise: the scene that was open is untouched and the tabs are closed again', (await sum()).parts === z_parts0 && (await call('scene_tabs')).j.length === z_tabs0, { parts: (await sum()).parts, z_parts0, tabs: (await call('scene_tabs')).j.length, z_tabs0 });
  r = await call('batch_optimise', { files: [z_FDp + '/missing.glb'], level: 'light' });
  check('batch_optimise: a file that cannot be read is a failed row, not a crash', r.ok && r.j.failed === 1 && r.j.results[0].error, r);
  try { fs.rmSync(z_FD, { recursive: true, force: true }); } catch (_) {}

  // — Meshopt export, and Keep sharp edges —
  const glbJson = (file) => { const b = fs.readFileSync(file); const n = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + n).toString('utf8')); };
  const decodeTris = async (file) => {
    const b64 = fs.readFileSync(file).toString('base64');
    return await evalJS(`(async () => { const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)); const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js'); const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); const g = await new Promise((res, rej) => l.parse(bin.buffer, '', res, rej)); let t = 0, m = 0, miss = 0; const acmr = (ix) => { const c = new Int32Array(16).fill(-1); let p = 0, k = 0; for (let i = 0; i < ix.length; i++) { const v = ix[i]; let hit = false; for (let j = 0; j < 16; j++) if (c[j] === v) { hit = true; break; } if (!hit) { k++; c[p] = v; p = (p + 1) % 16; } } return k; }; g.scene.traverse(o => { if (o.isMesh) { m++; const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; t += n; if (o.geometry.index) miss += acmr(o.geometry.index.array); } }); return { tris: t, meshes: m, acmr: miss / Math.max(1, t) }; })()`);
  };
  const m_sum = await sum();
  r = await call('export_model', { format: 'glb', compression: 'none', file_name: 'mo_plain' });
  const plainF = r.ok && r.j.files[0];
  r = await call('export_model', { format: 'glb', compression: 'meshopt', file_name: 'mo_meshopt' });
  const optF = r.ok && r.j.files[0];
  check('export_model compression meshopt: a .meshopt.glb file', r.ok && /\.meshopt(-\d+)?\.glb$/.test(optF.path) && fs.existsSync(optF.path), r);
  const jx = optF && fs.existsSync(optF.path) ? glbJson(optF.path) : null;
  check('the file says it uses EXT_meshopt_compression, and requires it', jx && (jx.extensionsUsed || []).includes('EXT_meshopt_compression') && (jx.extensionsRequired || []).includes('EXT_meshopt_compression'), jx && [jx.extensionsUsed, jx.extensionsRequired]);
  const drc = await call('export_model', { format: 'glb', compression: 'draco', file_name: 'mo_draco' });
  console.log('   for comparison, Draco:', drc.ok && drc.j.files[0].megabytes, 'MB');
  console.log('   sizes: plain', plainF && plainF.megabytes, 'MB, meshopt', optF && optF.megabytes, 'MB, ratio', plainF && optF ? (optF.megabytes / plainF.megabytes).toFixed(3) : '?');
  check('the Meshopt file is smaller than the plain one', plainF && optF && optF.megabytes < plainF.megabytes * 0.6, { plainF, optF });
  const back = optF ? await decodeTris(optF.path) : null;
  check('and it decodes back to the same triangles and meshes', back && back.tris === m_sum.triangles, { back, scene: m_sum.triangles });
  r = await call('export_model', { format: 'glb', faster_to_draw: true, file_name: 'mo_reorder' });
  const reF = r.ok && r.j.files[0];
  check('faster_to_draw: a plain .glb, no extension needed', r.ok && /mo_reorder(-\d+)?\.glb$/.test(reF.path) && !(glbJson(reF.path).extensionsRequired || []).length, r);
  const back2 = reF ? await decodeTris(reF.path) : null;
  check('...with exactly the same triangles', back2 && back2.tris === m_sum.triangles, { back2, scene: m_sum.triangles });
  const back0 = plainF ? await decodeTris(plainF.path) : null;
  console.log('   vertex-cache misses per triangle (16-entry cache; lower is faster, 3 is the worst): plain', back0 && back0.acmr.toFixed(2), ', reordered', back2 && back2.acmr.toFixed(2), ', meshopt', back && back.acmr.toFixed(2));
  check('reordering lowers the cache misses per triangle', back0 && back2 && back2.acmr < back0.acmr * 0.9, { plain: back0 && back0.acmr, reordered: back2 && back2.acmr });
  check('export_model refuses an unknown compression', !(await call('export_model', { format: 'glb', compression: 'zip' })).ok);
  r = await call('estimate_export_size'); check('estimate_export_size gives a Meshopt number too', r.ok && r.j.size_mb_with_meshopt_roughly > 0 && r.j.size_mb_with_meshopt_roughly < r.j.size_mb_plain_glb, r);
  const keepSharp = () => evalJS("document.getElementById('keep-sharp').checked");
  check('the Keep sharp edges switch is on by default', await keepSharp() === true);
  const sh0 = (await sum()).triangles;
  r = await call('decimate', { ids: [id1], reduce_percent: 60, keep_sharp_edges: false }); const shA = (await sum()).triangles;
  check('decimate with keep_sharp_edges false works and puts the switch back', r.ok && shA < sh0 && await keepSharp() === true, r);
  await call('undo'); 
  r = await call('decimate', { ids: [id1], reduce_percent: 60, keep_sharp_edges: true }); const shB = (await sum()).triangles;
  check('decimate with keep_sharp_edges true works', r.ok && shB < sh0, r);
  console.log('   decimate 60% of the heaviest part, triangles in the scene: without sharp edges', shA, ', with', shB);
  await call('undo');
  check('the scene is back after the undos', (await sum()).triangles === sh0, { sh0, now: (await sum()).triangles });

  // — scenes —
  r = await call('scene_tabs'); check('scene_tabs list', r.ok && Array.isArray(r.j) && r.j.length >= 1, r);
  r = await call('scene_tabs', { action: 'switch', index: 0 }); check('scene_tabs switch', r.ok, r);
  check('scene_tabs bad action refused', !(await call('scene_tabs', { action: 'burn' })).ok);

  // — the existing edit tools, small —
  r = await call('decimate', { ids: [id1], reduce_percent: 50 }); check('decimate', r.ok, r);
  r = await call('fit_to_budget', { target_triangles: 1000000 }); check('fit_to_budget (above the scene: nothing to do or ok)', r.ok || /budget|already|nothing/i.test(r.e || ''), r);
  r = await call('fill_holes', { ids: [id2], max_hole_mm: 5 }); check('fill_holes', r.ok, r);
  r = await call('export_model', { preset: 'web' }); check('export_model web', r.ok && r.j && r.j.files && r.j.files.length, r);
  r = await call('open_file', { path: 'Z:/nope.glb' }); check('open_file with a bad path is refused', !r.ok, r);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
console.log('console errors:', consoleErr.length); consoleErr.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
