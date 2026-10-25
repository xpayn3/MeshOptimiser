// node tests/e2e-group-pivot.mjs [model, default inbox/GearboxAssy.glb]
//
// The pivot of a tree group, in the real app in headless Chrome (software WebGL2, no window shown):
//   - the Pivot card's commands with one group picked move the GROUP's pivot (Centre, origin, view, typed angles), no part moves, and
//     Undo / Redo put the pivot back;
//   - a GLB export writes the group's pivot as the transform of its node, and every part stays exactly where it was;
//   - a saved scene opened again gives the group the same pivot, and the parts are where they were.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9338, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let failed = 0;
const ok = (cond, what, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + what + (extra ? '  ' + extra : '')); if (!cond) failed++; };
const near = (a, b, tol = 1e-3) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol * (1 + Math.abs(b[i])));
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  const openFile = (expr, name) => evalJS(`(async () => { const b = await (${expr}); const f = new File([b], ${JSON.stringify(name)}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById('file-input') || document.querySelector('input[type=file]'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await openFile(`fetch(${JSON.stringify(MODEL)}).then(r => r.blob())`, MODEL.split('/').pop());
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);

  await evalJS(`(() => {
    const A = window._appFns, T = A.THREE;
    window.__g = {
      // a group inside another one, with two or more parts of its own; its first part tells it apart in a file (the groups are all called Group)
      pick: () => {
        const nodes = state.treeNodes;
        for (const n of nodes) {
          if (n.kind !== 'group' || n.depth < 1) continue;
          const own = nodes.filter(k => k.kind === 'part' && k.parentId === n.id && A.getPart(k.partId) && !A.getPart(k.partId).deleted);
          if (own.length >= 2) {
            const at = (k) => { const p = A.getPart(k.partId); p.mesh.updateWorldMatrix(true, false); return new T.Vector3().setFromMatrixPosition(p.mesh.matrixWorld).toArray(); };
            const p = A.getPart(own[0].partId), p2 = A.getPart(own[1].partId);
            return { id: n.id, name: n.name, part: p.partId, pname: p.name, at: at(own[0]), pname2: p2.name, at2: at(own[1]) };
          }
        }
        return null;
      },
      // the group the part with this name, standing here, is in
      groupOf: (pname, at) => {
        let best = null, bd = Infinity;
        for (const p of state.parts) { if (p.deleted || !p.mesh || p.name !== pname) continue; p.mesh.updateWorldMatrix(true, false); const d = new T.Vector3().setFromMatrixPosition(p.mesh.matrixWorld).distanceTo(new T.Vector3(...at)); if (d < bd) { bd = d; best = p; } }
        const n = best && state.treeNodes.find(k => k.kind === 'part' && k.partId === best.partId);
        return n && bd < 1e-3 ? n.parentId : null;
      },
      select: (gid) => { state.selectedGroupIds = new Set([gid]); state.selected = new Set(A._treeGroupDescendants(gid)); },
      origin: (gid) => { A._groupOrigins.has(gid) || A._groupPivotAct; const o = A._groupOrigins.get(gid); return o ? o.toArray() : null; },
      quat: (gid) => { const q = A._groupRotations.get(gid); return q ? q.toArray() : [0, 0, 0, 1]; },
      // where every part's own origin stands in the world, by name and number
      parts: () => state.parts.filter(p => !p.deleted && p.mesh).map(p => { p.mesh.updateWorldMatrix(true, false); const v = new T.Vector3().setFromMatrixPosition(p.mesh.matrixWorld); return [p.name, v.x, v.y, v.z]; }).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2] || a[3] - b[3]),
    };
  })()`);
  const g = await evalJS('__g.pick()');
  ok(!!g, 'a group with two or more parts and a name of its own', JSON.stringify(g));
  const gid = g.id;
  await evalJS(`__g.select(${gid})`);
  const partsBefore = await evalJS('__g.parts()');

  // ── the Pivot card's commands, one group picked
  ok(await evalJS(`_appFns._groupPivotAct('centre', 'world')`) === true, 'Centre pivot is taken by the group');
  const centre = await evalJS(`(() => { _appFns._groupOrigins.get(${gid}); return __g.origin(${gid}); })()`);
  ok(Array.isArray(centre), 'the group has a stored pivot', JSON.stringify(centre));
  await evalJS(`_appFns._groupPivotAct('origin', 'world')`);
  ok(near(await evalJS(`__g.origin(${gid})`), [0, 0, 0]), 'Pivot to the origin puts the group pivot on 0, 0, 0');
  ok(near(await evalJS('__g.parts().flat().filter(x => typeof x === "number")'), partsBefore.flat().filter(x => typeof x === 'number')), 'no part moved');
  await evalJS(`_appFns._groupPivotAct('view', 'keep')`);
  const view = await evalJS(`__g.origin(${gid})`);
  ok(near(view, await evalJS('_appFns.controls.target.toArray()')), 'Pivot to the view puts it on the middle of the view', JSON.stringify(view));
  await evalJS('_appFns.undoLast()'); await sleep(300);
  ok(near(await evalJS(`__g.origin(${gid})`), [0, 0, 0]), 'Undo puts the pivot back on the origin');
  await evalJS('_appFns.redoLast()'); await sleep(300);
  ok(near(await evalJS(`__g.origin(${gid})`), view), 'Redo puts it back on the view');
  await evalJS(`_appFns._groupPivotAct('keep', 'custom', { euler: [0, 0, 30] })`);
  const q = await evalJS(`__g.quat(${gid})`);
  const exp = await evalJS('(() => { const T = _appFns.THREE; return new T.Quaternion().setFromEuler(new T.Euler(0, 0, Math.PI / 6, "XYZ")).toArray(); })()');
  ok(near(q, exp) || near(q, exp.map(x => -x)), 'typed angles 0, 0, 30 turn the group pivot', JSON.stringify(q));
  ok(near(await evalJS('__g.parts().flat().filter(x => typeof x === "number")'), partsBefore.flat().filter(x => typeof x === 'number')), 'still no part moved');
  const o = await evalJS(`__g.origin(${gid})`);

  // ── the export: the group node carries the pivot, the parts stay where they are
  const ex = await evalJS(`(() => {
    const T = _appFns.THREE, args = { visibleOnly: false, merge: false, scale: 1, axis: 'z-up', origin: 'model' };
    const plain = _appFns.buildExportRoot(args), withP = _appFns.buildExportRoot({ ...args, groupPivots: true });
    const meshes = (r) => { r.root.updateMatrixWorld(true); const out = []; r.root.traverse(n => { if (n.isMesh) out.push(n.matrixWorld.toArray()); }); return out; };
    const a = meshes(plain), b = meshes(withP);
    let worst = 0; for (let i = 0; i < a.length; i++) for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(a[i][k] - b[i][k]) / (1 + Math.abs(a[i][k])));
    const m = withP.meshByPart.get(${g.part}), node = m ? m.parent : null;
    const lin = new T.Matrix4().multiplyMatrices(withP.postMat, withP.settingsOut);
    const want = new T.Vector3(...${JSON.stringify(o)}).applyMatrix4(lin);
    const wp = node ? new T.Vector3().setFromMatrixPosition(node.matrixWorld) : null;
    return { n: a.length, same: a.length === b.length, worst, node: !!node, pos: wp ? wp.toArray() : null, want: want.toArray(), local: node ? node.position.toArray() : null };
  })()`);
  ok(ex.n > 0 && ex.same, 'both exports hold the same parts', String(ex.n));
  ok(ex.worst < 1e-5, 'every part is where it was in the file (largest difference ' + ex.worst.toExponential(1) + ')');
  ok(ex.node && near(ex.pos, ex.want, 1e-5), 'the group node stands on the group pivot', JSON.stringify([ex.pos, ex.want]));

  // the same with a scale, the turn into Y-up and a recentring: the parts must still be where the plain export puts them
  const ex2 = await evalJS(`(() => {
    const T = _appFns.THREE, args = { visibleOnly: false, merge: false, scale: 0.001, axis: 'y-up', origin: 'center' };
    const plain = _appFns.buildExportRoot(args), withP = _appFns.buildExportRoot({ ...args, groupPivots: true });
    const meshes = (r) => { r.root.updateMatrixWorld(true); const out = []; r.root.traverse(n => { if (n.isMesh) out.push(n.matrixWorld.toArray()); }); return out; };
    const a = meshes(plain), b = meshes(withP);
    let worst = 0; for (let i = 0; i < a.length; i++) for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(a[i][k] - b[i][k]) / (1 + Math.abs(a[i][k])));
    const m = withP.meshByPart.get(${g.part}), node = m ? m.parent : null;
    const lin = new T.Matrix4().multiplyMatrices(withP.postMat, withP.settingsOut);
    const want = new T.Vector3(...${JSON.stringify(o)}).applyMatrix4(lin);
    return { n: a.length, same: a.length === b.length, worst, pos: node ? new T.Vector3().setFromMatrixPosition(node.matrixWorld).toArray() : null, want: want.toArray() };
  })()`);
  ok(ex2.n > 0 && ex2.same && ex2.worst < 1e-5, 'at scale 0.001, Y-up and recentred the parts stay in place (largest difference ' + ex2.worst.toExponential(1) + ')');
  ok(ex2.pos && near(ex2.pos, ex2.want, 1e-5), 'and the group node stands on the pivot as the file has it', JSON.stringify([ex2.pos, ex2.want]));

  // ── what another program sees: Blender reads the GLB and the FBX (the group's axis is the node's; where a node stands is judged by how far it
  //    is from its first part, which does not depend on which way the file's up axis is turned)
  {
    const { execFileSync } = await import('child_process'), fs = await import('fs'), path = await import('path'), os = await import('os');
    const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
    if (!fs.existsSync(BLENDER)) console.log('skip Blender (not found: set BLENDER)');
    else {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-grp-'));
      const b64 = (expr) => evalJS(`(async () => { const blob = await (${expr}); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); })()`);
      await evalJS('(async () => { window.__blob = await _appFns._saveSceneImpl(true, true); return 1; })()');
      fs.writeFileSync(path.join(dir, 'g.glb'), Buffer.from(await b64('Promise.resolve(window.__blob)'), 'base64'));
      fs.writeFileSync(path.join(dir, 'g.fbx'), Buffer.from(await b64(`(async () => { const r = _appFns.buildExportRoot({ visibleOnly: false, merge: false, scale: 1, axis: 'z-up', origin: 'model', groupPivots: true }); return _appFns._exportFbxBinary(r.root, { scale: 1, axis: 'z-up' }); })()`), 'base64'));
      const want = Math.hypot(...g.at.map((v, i) => v - o[i])), apart = Math.hypot(...g.at.map((v, i) => v - g.at2[i]));
      for (const f of ['g.glb', 'g.fbx']) {
        try {
          execFileSync(BLENDER, ['--background', '--factory-startup', '--python', 'tests/blender/group-pivots.py', '--', path.join(dir, f), path.join(dir, f + '.json')], { stdio: 'ignore', maxBuffer: 1 << 28 });
          const groups = JSON.parse(fs.readFileSync(path.join(dir, f + '.json'), 'utf8'));
          // the empty whose child is the first part of the group; the unit of the file (an FBX comes in at its own scale) is read off two parts
          const named = (e, n) => e.children.find(c => c.name === n || c.name.startsWith(n));
          const e = groups.find(x => named(x, g.pname) && named(x, g.pname2));
          const c1 = e && named(e, g.pname), c2 = e && named(e, g.pname2);
          const have = e ? Math.hypot(...e.at.map((v, i) => v - c1.at[i])) : null;
          const k = e && apart > 0 ? Math.hypot(...c1.at.map((v, i) => v - c2.at[i])) / apart : null;
          const kg = have != null && want > 0 ? have / want : null;
          ok(k != null && kg != null && Math.abs(kg - k) <= 1e-4 * k, 'Blender reads the group axis in ' + f + ': ' + (e ? e.name : 'no group') + ' stands ' + (have == null ? '?' : have.toFixed(3)) + ' from its first part, the parts ' + (k == null ? '?' : (apart * k).toFixed(3)) + ' apart (the app: ' + want.toFixed(3) + ' and ' + apart.toFixed(3) + ', a file scale of ' + (k == null ? '?' : k.toPrecision(4)) + ')');
        } catch (err) { ok(false, 'Blender read ' + f, String(err.message).split('\n')[0]); }
      }
    }
  }

  // ── a saved scene, opened again
  const saved = await evalJS(`(async () => { const blob = await _appFns._saveSceneImpl(true, true); window.__blob = blob; return blob ? blob.size : 0; })()`);
  ok(saved > 1000, 'the scene is written', String(saved));
  const posBefore = await evalJS('__g.parts()');
  await openFile('Promise.resolve(window.__blob)', 'saved.glb');
  for (let i = 0; i < 160; i++) { const n = await evalJS("state.parts.length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);
  const gid2 = await evalJS(`__g.groupOf(${JSON.stringify(g.pname)}, ${JSON.stringify(g.at)})`);
  ok(gid2 != null, 'the group is in the reopened scene');
  if (gid2 != null) {
    ok(near(await evalJS(`__g.origin(${gid2})`) || [], o, 1e-4), 'the reopened group has the same pivot', JSON.stringify([await evalJS(`__g.origin(${gid2})`), o]));
    const q2 = await evalJS(`__g.quat(${gid2})`);
    ok(near(q2, q, 1e-4) || near(q2, q.map(x => -x), 1e-4), 'and the same turn', JSON.stringify([q2, q]));
  }
  const posAfter = await evalJS('__g.parts()');
  ok(posAfter.length === posBefore.length && posAfter.every((p, i) => p[0] === posBefore[i][0] && near(p.slice(1), posBefore[i].slice(1), 1e-4)), 'every part is where it was', posAfter.length + ' parts');
  // ── Reset on a part: its shape lands on the pivot of its group, and the fields read 0, 0, 0
  if (gid2 != null) {
    await evalJS(`(() => {
      const T = _appFns.THREE, p = state.parts.find(q => !q.deleted && q.mesh && q.name === ${JSON.stringify(g.pname)} && (q.mesh.updateWorldMatrix(true, false), new T.Vector3().setFromMatrixPosition(q.mesh.matrixWorld).distanceTo(new T.Vector3(...${JSON.stringify(g.at)})) < 1e-3));
      window.__rp = p.partId; state.selectedGroupIds = new Set(); state.selected = new Set([p.partId]); _appFns.updateGizmo();
    })()`);
    await sleep(600);
    await evalJS("document.getElementById('tform-reset').click()");
    await sleep(1500);
    const r = await evalJS(`(() => {
      const T = _appFns.THREE, p = _appFns.getPart(window.__rp), c = new T.Box3().setFromObject(p.mesh).getCenter(new T.Vector3()), o = _appFns._groupOrigins.get(${gid2});
      return { centre: c.toArray(), origin: o.toArray(), fields: ['px', 'py', 'pz'].map(k => parseFloat(document.getElementById('tform-' + k).value)) };
    })()`);
    ok(near(r.centre, r.origin, 1e-4), "Reset puts the middle of the part on its group's pivot", JSON.stringify([r.centre, r.origin]));
    ok(r.fields.every(v => Math.abs(v) < 1e-2), 'and the fields read 0, 0, 0', JSON.stringify(r.fields));
  }
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
