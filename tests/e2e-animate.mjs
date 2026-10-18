// node tests/e2e-animate.mjs [model, default inbox/GearboxAssy.glb]
//
// The Animate feature in the real app (headless Chrome, software WebGL2): the animate_parts tool, the part and group animations, the
// Playing tag and pausing, the Animate window, the poses going back, and the turntable video playing the animations.
// is the layer above them and is not part of this) and checks what each one did, including that the undo tool takes it back.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
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
  // (Animate opens as the timeline drawer along the bottom since v0.34.0; this test is about the small window, which is still there
  //  for whoever chooses it: it is chosen before the page loads, unless a choice is already saved)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { if (!localStorage.getItem('mo-anim-tl')) localStorage.setItem('mo-anim-tl', JSON.stringify({ mode: 'mini' })); } catch (_) {}" });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);

  const mw = (id) => evalJS(`window.state.partById.get(${id}).mesh.matrixWorld.elements.map(v => Math.round(v * 1e4) / 1e4).join(',')`);
  // (software rendering is slow: a change is waited for, not slept for)
  const changed = async (id, from, ms = 6000) => { for (let t0 = Date.now(); Date.now() - t0 < ms; ) { if ((await mw(id)) !== from) return true; await sleep(150); } return false; };
  const pageTools = await evalJS('Object.keys(window.__moBridgeTools)');
  check('animate_parts has a handler in the page', pageTools.includes('animate_parts'));
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 8 });
  const P = lp.j.parts, id1 = P[0].id, id2 = P[1].id, id3 = P[2].id;
  // — a part spins —
  const rest1 = await mw(id1);
  let r = await call('animate_parts', { action: 'add', ids: [id1], type: 'spin', rpm: 120, axis: 'Z' });
  check('animate_parts add spin', r.ok && r.j && r.j.animated === 1, r);
  check('the part moved', await changed(id1, rest1));
  const tag = await evalJS("(() => { const t = document.getElementById('vp-animate-pill'); return t ? { hidden: t.hidden, text: t.textContent } : null; })()");
  check('the Playing tag is shown', tag && !tag.hidden && /Playing/.test(tag.text), tag);
  // — a click on the tag pauses everything where it is —
  await evalJS("document.querySelector('#vp-animate-pill [data-a=\"toggle\"]').click()");
  const p1 = await mw(id1); await sleep(500); const p2 = await mw(id1);
  check('paused: the part stays where it is', p1 === p2);
  // (paused, the pill goes away since v0.34.0: it is played again from the card in the right sidebar or the timeline)
  check('paused: the pill goes away', await evalJS("document.getElementById('vp-animate-pill').hidden === true"));
  await evalJS("document.querySelector('#vp-animate-pill [data-a=\"toggle\"]').click()"); await sleep(200);
  check('the button on the pill plays it again', /Playing/.test(await evalJS("document.getElementById('vp-animate-pill').textContent")));
  await evalJS("document.querySelector('#vp-animate-pill [data-a=\"exit\"]').click()"); await sleep(200);
  const x1 = await mw(id1); await sleep(400);
  check('the X pauses everything and closes the pill', (await mw(id1)) === x1 && await evalJS("document.getElementById('vp-animate-pill').hidden"));
  r = await call('animate_parts', { action: 'list' });
  check('list shows the spin', r.ok && r.j && r.j.animations.length === 1 && r.j.animations[0].layers[0].type === 'spin' && r.j.animations[0].layers[0].rpm === 120, r);
  // — the window, from the menu of the view —
  await call('select_parts', { ids: [id1] });
  await evalJS("document.querySelector('canvas').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 }))");
  await sleep(400);
  const opened = await evalJS("(() => { const row = [...document.querySelectorAll('#ctx-menu .ctx-menu-row')].find(r => /Animate/.test(r.textContent)); if (!row) return false; row.click(); return true; })()");
  check('the view menu has Animate…', opened);
  await sleep(600);
  check('the Animate window opens', await evalJS("document.getElementById('_anim-dialog')?.classList.contains('show') === true"));
  check('one pill says Animate mode, in the row of the other status pills', await evalJS("(() => { const t = document.getElementById('vp-animate-pill'); return !t.hidden && /Animate mode/.test(t.textContent) && t.parentElement.id === 'vp-mode-pills' && !document.getElementById('anim-mode') && !document.getElementById('anim-tag'); })()"));
  check('no gizmo while the Animate window is open', await evalJS("!window.state.gizmo.object && !(window.state.gizmoHelper && window.state.gizmoHelper.visible)"));
  const listTxt = await evalJS("document.getElementById('anim-list')?.textContent || ''");
  check('the window lists the animated part with its properties', /120 rpm/.test(listTxt) && /Spin/.test(listTxt), listTxt);
  const playLab = await evalJS("document.getElementById('anim-pb-play')?.getAttribute('aria-label') || ''");
  check('the playbar has a Play button while paused', playLab === 'Play', playLab);
  await evalJS("document.getElementById('anim-pb-play').click()");
  const q1 = await mw(id1);
  check('Play in the window starts it again', await changed(id1, q1));
  check('the tag is back', await evalJS("document.getElementById('vp-animate-pill').hidden === false"));
  // — more kinds on the same part (layers add up), changed from the window —
  await evalJS("document.querySelector('#_anim-dialog [data-type=\"noise\"]').click()");
  await evalJS("document.getElementById('anim-add').click()");
  await sleep(300);
  r = await call('animate_parts', { action: 'list' });
  check('a second layer (noise) is added', r.ok && r.j.animations[0].layers.length === 2, r);
  await evalJS("document.querySelector('#_anim-dialog [data-rmlayer=\"noise\"]').click()");
  r = await call('animate_parts', { action: 'list' });
  check('a layer is removed from its chip', r.ok && r.j.animations[0].layers.length === 1, r);
  // — remove puts the part back —
  r = await call('animate_parts', { action: 'remove', ids: [id1] });
  await sleep(200);
  check('remove: the part is back where it started', (await mw(id1)) === rest1, { rest1, now: await mw(id1) });
  check('remove: the controls are gone, the pill says Animate mode while the window is open', await evalJS("(() => { const t = document.getElementById('vp-animate-pill'); return t.querySelector('[data-a=toggle]').hidden && /Animate mode/.test(t.textContent) && !/Playing/.test(t.textContent); })()"));
  // — with the exploded view: an animated part keeps its exploded place (it turns about its own middle, which stays put) —
  const cen = (id) => evalJS(`(() => { const m = window.state.partById.get(${id}).mesh; const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox(); const c = m.localToWorld(g.boundingBox.getCenter(new m.position.constructor())); return [c.x, c.y, c.z].map(v => Math.round(v * 100) / 100).join(','); })()`);
  const c0 = await cen(id1);
  await call('set_explode', { amount: 60 }); await sleep(800);
  const cEx = await cen(id1);
  check('explode moves the part', cEx !== c0, { c0, cEx });
  await call('animate_parts', { action: 'add', ids: [id1], type: 'spin', rpm: 120 });
  const mAn = await mw(id1);
  check('the part turns in the exploded view', await changed(id1, mAn));
  check('animated and exploded: it stays at its exploded place', (await cen(id1)) === cEx, { cEx, now: await cen(id1) });
  await call('set_explode', { amount: 100 }); await sleep(800);
  const cEx2 = await cen(id1);
  check('the explode changes while it is animated: it follows', cEx2 !== cEx && cEx2 !== c0, { cEx, cEx2 });
  await call('animate_parts', { action: 'remove', ids: [id1] }); await sleep(300);
  check('removed while exploded: it stays in the exploded view', (await cen(id1)) === cEx2);
  await call('animate_parts', { action: 'add', ids: [id1], type: 'spin', rpm: 120 }); await sleep(500);
  await call('set_explode', { amount: 0 }); await sleep(800);
  check('explode back to 0 while animated: the assembled place', (await cen(id1)) === c0, { c0, now: await cen(id1) });
  await call('animate_parts', { action: 'clear' }); await sleep(200);
  check('cleared: back where it started', (await mw(id1)) === rest1);
  // — a group moves every part in it —
  const rest2 = await mw(id2), rest3 = await mw(id3);
  r = await call('group_parts', { ids: [id2, id3] }); check('group_parts', r.ok, r);
  const lg = await call('list_groups'); const gl = lg.j ? [...(lg.j.user_groups || []), ...(lg.j.file_groups || [])].filter(g => /^Group \d+$/.test(g.name)) : [], gname = gl.length ? gl[gl.length - 1].name : '';
  check('the new group is listed', !!gname, lg);
  r = await call('animate_parts', { action: 'add', group_contains: [gname], type: 'swing', angle_degrees: 30, seconds: 1 });
  check('animate_parts add to a group', r.ok && r.j && r.j.animated === 1, r);
  // clicking the group's row in the Animate window selects the group (the tree row need not be drawn)
  await call('select_all', {}); await call('select_parts', { ids: [id1], mode: 'replace' });
  await sleep(500);
  const picked = await evalJS(`(() => { const b = document.querySelector('#_anim-dialog [data-pick^="g:"]'); if (!b) return null; b.click(); return { groups: window.state.selectedGroupIds.size, hasA: window.state.selected.has(${id2}), hasB: window.state.selected.has(${id3}) }; })()`);
  check('a group row in the window selects the group', picked && picked.groups === 1 && picked.hasA && picked.hasB, picked);
  check('a part of the group moved', await changed(id2, rest2));
  check('the other part of the group moved', await changed(id3, rest3));
  r = await call('animate_parts', { action: 'clear' });
  await sleep(200);
  check('clear: both parts are back', (await mw(id2)) === rest2 && (await mw(id3)) === rest3);
  check('nothing is animated after clear', (await call('animate_parts', { action: 'list' })).s === 'Nothing is animated.');
  // — a path (a wave goes there and back) and a spin held to a quarter turn with ping-pong —
  const restP = await mw(id1);
  r = await call('animate_parts', { action: 'add', ids: [id1], type: 'path', shape: 'wave', plane: 'XZ', size_percent: 80, seconds: 1 });
  check('animate_parts add path', r.ok && r.j && r.j.settings.shape === 'wave', r);
  check('the path moves the part', await changed(id1, restP));
  r = await call('animate_parts', { action: 'add', ids: [id1], type: 'spin', loop_mode: 'pingpong', loop_from_percent: 0, loop_to_percent: 25, rpm: 60 });
  check('animate_parts add spin with loop points', r.ok && r.j && r.j.loop && r.j.loop.mode === 'pingpong' && r.j.loop.to === 25, r);
  r = await call('animate_parts', { action: 'list' });
  check('two layers on the part, with their settings listed', r.ok && r.j.animations[0].layers.length === 2 && /ping-pong/.test(r.j.animations[0].layers[1].summary), r);
  await call('animate_parts', { action: 'clear' });
  await sleep(200);
  check('clear: back at the start', (await mw(id1)) === restP);
  // — noise with its own settings: a kind, amplitude, axes, detail, a seed —
  const restN = await mw(id1);
  r = await call('animate_parts', { action: 'add', ids: [id1], type: 'noise', noise_type: 'random', shift_percent: 12, turn_degrees: 20, shift_axes: 'x', turn_axes: 'z', detail: 3, roughness_percent: 40, seed: 7, speed: 2 });
  check('animate_parts add noise with its settings', r.ok && r.j && r.j.settings.type === 'random' && r.j.settings.sx === 'x' && r.j.settings.rx === 'z' && r.j.settings.detail === 3 && r.j.settings.seed === 7, r);
  check('the noise moves the part', await changed(id1, restN));
  r = await call('animate_parts', { action: 'list' });
  check('the list shows the noise settings', r.ok && /random/.test(r.s) && /detail 3/.test(r.s) && /seed 7/.test(r.s), r.s);
  await call('select_parts', { ids: [id1] }); await sleep(700);
  check('the card of the window lists the layers with their settings', await evalJS("(() => { const l = [...document.querySelectorAll('#_anim-dialog .anim-lay')]; return l.length >= 1 && l.some(x => /random/.test(x.textContent) && /seed 7/.test(x.textContent)); })()"));
  await call('animate_parts', { action: 'clear' }); await sleep(200);
  check('clear: back at the start', (await mw(id1)) === restN);
  // — an instanced part (no mesh of its own until it is promoted) can be animated too —
  const instId = await evalJS("(() => { const p = window.state.parts.find(q => !q.deleted && !q.mesh && q.instancedMesh); return p ? p.partId : null; })()");
  if (instId != null) {
    r = await call('animate_parts', { action: 'add', ids: [instId], type: 'spin', rpm: 60 });
    check('an instanced part can be animated', r.ok && r.j && r.j.animated === 1, r);
    check('the instanced part turns', await changed(instId, await mw(instId)));
    await call('animate_parts', { action: 'clear' }); await sleep(200);
  } else console.log('(no instanced part in this model)');
  // — speed of playback, the keyboard, and what a frame costs —
  await call('animate_parts', { action: 'add', ids: [id1], type: 'spin', rpm: 60 });
  await call('select_parts', { ids: [id1] });
  await evalJS("document.querySelector('canvas').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 }))");
  await sleep(300);
  await evalJS("[...document.querySelectorAll('#ctx-menu .ctx-menu-row')].find(r => /Animate/.test(r.textContent))?.click()"); await sleep(800);
  await evalJS("document.getElementById('anim-pb-rate').click()"); await sleep(100);
  check('the playbar has a playback speed button', (await evalJS("document.getElementById('anim-pb-rate').textContent")) === '2×');
  check('the playback speed is reported', (await evalJS("window.__moAnimStats().speed")) === 2);
  await evalJS("document.getElementById('anim-pb-rate').click(); document.getElementById('anim-pb-rate').click(); document.getElementById('anim-pb-rate').click(); document.getElementById('anim-pb-rate').click();");
  check('the playback speed goes round to 1×', (await evalJS("document.getElementById('anim-pb-rate').textContent")) === '1×');
  await evalJS("document.querySelector('#_anim-dialog .dlg-body').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))"); await sleep(150);
  check('Space pauses', (await evalJS("window.__moAnimStats().playing")) === false);      // (the pill no longer says Paused: it goes away)
  await evalJS("document.querySelector('#_anim-dialog .dlg-body').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))"); await sleep(150);
  check('Space plays again', /Playing/.test(await evalJS("document.getElementById('vp-animate-pill').textContent")));
  await call('animate_parts', { action: 'clear' });
  r = await call('animate_parts', { action: 'add', group_contains: ['Group'], type: 'spin', rpm: 30 });
  await sleep(1500);
  const st = await evalJS("window.__moAnimStats()");
  console.log('frame cost with every group animated:', JSON.stringify(st));
  check('a frame of many animated parts costs little', st.parts_moved_per_frame > 20 && st.ms_per_frame < 25, st);
  await call('animate_parts', { action: 'clear' }); await sleep(300);
  // — bad calls are refused —
  check('animate_parts with nothing to animate is refused', !(await call('animate_parts', { action: 'add', ids: [999999] })).ok);
  check('animate_parts with a bad action is refused', !(await call('animate_parts', { action: 'dance', ids: [id1] })).ok);
  // — the video plays the animations —
  r = await call('animate_parts', { action: 'add', ids: [id1], type: 'noise', shift_percent: 20 });
  r = await call('turntable_video', { seconds: 2, width: 320, height: 180, fps: 24 });
  check('turntable_video with an animation', r.ok && r.j && r.j.file, r);
  await sleep(300);
  r = await call('animate_parts', { action: 'list' });
  check('the animation is still there after the video', r.ok && r.j && r.j.animations.length === 1, r);
  await call('animate_parts', { action: 'clear' });
  // — closing the window brings the gizmo back —
  await evalJS("document.querySelector('#_anim-dialog .dlg-x[aria-label=Close]').click()");
  await call('select_parts', { ids: [id1], mode: 'replace' });
  await sleep(800);
  check('the gizmo is back when the window is closed', await evalJS("!!window.state.gizmo.object"));

} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
console.log('console errors:', consoleErr.length); consoleErr.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
