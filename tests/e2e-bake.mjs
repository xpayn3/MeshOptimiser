// node tests/e2e-bake.mjs
//
// The Bake textures card in the real app in headless Chrome. An OBJ with two parts, a sphere (about 6,000 triangles, its colour a picture: half red, half green) and a blue
// box, is opened; both are selected and baked (reduced by half onto one 1024 picture). Checks: the sphere has fewer triangles, both
// parts wear ONE material whose Base colour map is a 1024 picture, their UVs lie inside the square, the picture holds both colours
// (red and green from the sphere's map, blue), one undo puts the triangles and the materials back and one redo bakes them again; the card opens, shows the
// selection and closes when it is done.
// Needs the app served on http://localhost:4242 (or APP_PORT), Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9357, PROFILE = (process.env.TEMP || '.') + '/cdp-bake-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── the model ──
const v = [], f = [], vn = [];
const V = (x, y, z) => { v.push(`v ${x} ${y} ${z}`); return v.length; };
{
  f.push('o sphere_red');
  const nu = 64, nv = 48, r = 20, id = [];
  // (smooth: a normal at every vertex, pointing out, so the sphere itself is what the reduced one is measured against; the sphere is the first object, so a normal has the number of its vertex)
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const a = 2 * Math.PI * i / nu, b = Math.PI * j / nv, x = Math.sin(b) * Math.cos(a), y = Math.cos(b), z = Math.sin(b) * Math.sin(a); const sw = 0.5 * Math.sin(36 * a), tx = -Math.sin(a), tz = Math.cos(a), qx = x + sw * tx, qy = y, qz = z + sw * tz, ql = Math.hypot(qx, qy, qz); vn.push(`vn ${qx / ql} ${qy / ql} ${qz / ql}`); id.push(V(r * x, r * y, r * z)); }
  const T = (k) => `${id[k]}//${id[k]}`;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; if (j > 0) f.push(`f ${T(a)} ${T(b)} ${T(a + 1)}`); if (j < nv - 1) f.push(`f ${T(a + 1)} ${T(b)} ${T(b + 1)}`); }
}
{
  f.push('o box_blue');
  const s = 15, o = 60, c = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(p => V(o + p[0] * s, p[1] * s, p[2] * s));
  for (const q of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]]) f.push(`f ${c[q[0]]} ${c[q[1]]} ${c[q[2]]} ${c[q[3]]}`);
}
{
  f.push('o plate_grey');
  const x0 = 50, x1 = 90, y0 = -3, y1 = 0, z0 = -10, z1 = 30, c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(p => V(...p));
  for (const q of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]]) f.push(`f ${c[q[0]]} ${c[q[1]]} ${c[q[2]]} ${c[q[3]]}`);
}
const objText = v.join('\n') + '\n' + vn.join('\n') + '\n' + f.join('\n') + '\n';

const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const tris = (name) => evalJS(`(window.state.parts.find(p => p.name === ${JSON.stringify(name)}) || {}).triCount`);
const info = (name) => evalJS(`(() => {
  const p = window.state.parts.find(q => q.name === ${JSON.stringify(name)}); if (!p) return null;
  const g = p.mesh.geometry, m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material, uv = g.attributes.uv;
  let lo = 9, hi = -9; if (uv) for (let i = 0; i < uv.array.length; i++) { lo = Math.min(lo, uv.array[i]); hi = Math.max(hi, uv.array[i]); }
  return { attrs: Object.keys(g.attributes).join(','), verts: g.attributes.position.count, indexed: !!g.index, tris: p.triCount, matId: m.uuid, hasMap: !!m.map, mapSize: m.map && m.map.image ? m.map.image.width : 0, uvLo: lo, uvHi: hi, groups: g.groups.length, hasColorAttr: !!g.attributes.color };
})()`);
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
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(() => { window.__moOpenFile(new File([${JSON.stringify(objText)}], 'bake.obj')); return true; })()`);
  for (let i = 0; i < 20; i++) {
    if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) { await evalJS("document.querySelector('#import-modal-confirm')?.click()"); break; }
    await sleep(250);
  }
  for (let i = 0; i < 120; i++) { const n = await evalJS('window.state.parts.length').catch(() => 0); if (n >= 3) break; await sleep(500); }
  await sleep(1500);
  const S0 = await tris('sphere_red'), B0 = await tris('box_blue');
  console.log('before:', JSON.stringify(await info('sphere_red')));
  check('the two parts are open', S0 > 5000 && B0 === 12, [S0, B0]);
  // red and blue materials of their own
  await evalJS(`(() => { for (const [n, c] of [['sphere_red', [0.8, 0.05, 0.05]], ['box_blue', [0.05, 0.1, 0.8]]]) { const p = window.state.parts.find(q => q.name === n); const m = (Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material).clone(); m.color.setRGB(...c); m.map = null; p.mesh.material = m; } return true; })()`);
  // the sphere reads its colour from a picture (half red, half green) through its own UVs: the map is read, not only the material colour
  await evalJS(`(async () => {
    const T = await import('three'), p = window.state.parts.find(q => q.name === 'sphere_red'), g = p.mesh.geometry, pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[2 * i] = 0.5 + Math.atan2(pos.getZ(i), pos.getX(i)) / (2 * Math.PI); uv[2 * i + 1] = 0.5 - Math.asin(Math.max(-1, Math.min(1, pos.getY(i) / 20))) / Math.PI; }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#d02020'; x.fillRect(0, 0, 32, 64); x.fillStyle = '#20c020'; x.fillRect(32, 0, 32, 64);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.flipY = false;
    const m = p.mesh.material; m.color.setRGB(1, 1, 1); m.map = tex; m.needsUpdate = true; return true;
  })()`);

  // ── the card ──
  await evalJS(`window.state.selected.clear(); for (const p of window.state.parts) window.state.selected.add(p.partId)`);
  await evalJS('window.__moAgent.bakeCard()'); await sleep(500);
  check('the card opens', await evalJS("!document.querySelector('.section-cmd[data-cmd=\"bake\"]').hidden"));
  const st = await evalJS("document.getElementById('bk-stats').textContent");
  check('the card says what is selected', /Parts\s*3/.test(st) && /Triangles/.test(st), st);
  check('the picture size is chosen', (await evalJS("document.querySelector('#bk-size button.active')?.dataset.s")) === '2048');

  // ── the bake ──
  await evalJS("(window.__hi = window.state.parts.find(q => q.name === 'sphere_red').mesh.geometry, true)");      // (the original, kept to measure the map against)
  const r = await evalJS(`window.__moAgent.bakeTextures({ reduce_percent: 50, size: 1024, quiet: true })`);
  await sleep(600);
  check('the bake is done', r && r.ok && r.parts === 3, r);
  const S1 = await info('sphere_red'), B1 = await info('box_blue');
  check('the sphere has fewer triangles', S1 && S1.tris < S0 * 0.7 && S1.tris > 100, [S0, S1 && S1.tris]);
  check('both parts wear one material', S1 && B1 && S1.matId === B1.matId, [S1 && S1.matId, B1 && B1.matId]);
  check('its Base colour map is a 1024 picture', S1 && S1.hasMap && S1.mapSize === 1024, S1);
  check('the UVs are inside the square', S1.uvLo >= 0 && S1.uvHi <= 1 && B1.uvLo >= 0 && B1.uvHi <= 1, [S1.uvLo, S1.uvHi, B1.uvLo, B1.uvHi]);
  check('one group and no vertex colours are left', S1.groups === 1 && !S1.hasColorAttr, S1);
  // the normal map: read the way the shader reads it, it gives back the normal of the sphere under the centre of each triangle
  const nrm = await evalJS(`(async () => {
    const T3 = await import('three'), { MeshBVH } = await import('three-mesh-bvh');
    const hg = window.__hi, tree = new MeshBVH(hg, { indirect: true }), hp = hg.attributes.position, hnr = hg.attributes.normal, hit = { point: new T3.Vector3(), distance: 0, faceIndex: 0 }, tr = new T3.Triangle(), bar = new T3.Vector3();
    const p = window.state.parts.find(q => q.name === 'sphere_red'), g = p.mesh.geometry, m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material;
    if (!m.normalMap) return { missing: true };
    const im = m.normalMap.image, d = im.getContext('2d').getImageData(0, 0, im.width, im.height).data, pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal, ix = g.index.array;
    let ok = 0, bad = 0, sumB = 0, sumF = 0, sy = m.normalScale.y;
    for (let t = 0; t < ix.length / 3; t += 5) {
      const a = ix[3 * t], b = ix[3 * t + 1], c = ix[3 * t + 2], P = [a, b, c].map(i => [pos.getX(i), pos.getY(i), pos.getZ(i)]), U = [a, b, c].map(i => [uv.getX(i), uv.getY(i)]);
      const dp1 = P[1].map((v, k) => v - P[0][k]), dp2 = P[2].map((v, k) => v - P[0][k]), du1 = U[1][0] - U[0][0], dv1 = U[1][1] - U[0][1], du2 = U[2][0] - U[0][0], dv2 = U[2][1] - U[0][1], det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-12) continue;
      const nrm3 = (v) => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
      const S = nrm3(dp1.map((v, k) => (v * dv2 - dp2[k] * dv1) / det)), T = nrm3(dp2.map((v, k) => (v * du1 - dp1[k] * du2) / det));
      const N = nrm3([0, 1, 2].map(k => nor.getComponent(a, k) + nor.getComponent(b, k) + nor.getComponent(c, k)));
      const cu = (U[0][0] + U[1][0] + U[2][0]) / 3, cv = (U[0][1] + U[1][1] + U[2][1]) / 3, cp = [0, 1, 2].map(k => (P[0][k] + P[1][k] + P[2][k]) / 3);
      const x = Math.min(im.width - 1, Math.floor(cu * im.width)), y = Math.min(im.height - 1, Math.floor(cv * im.height)), k = 4 * (y * im.width + x);
      const mx = d[k] / 255 * 2 - 1, my = (d[k + 1] / 255 * 2 - 1) * sy, mz = d[k + 2] / 255 * 2 - 1;
      const n = nrm3([0, 1, 2].map(i => mx * S[i] + my * T[i] + mz * N[i]));
      // what the original has at the nearest point of its surface: its own normals, interpolated
      const rr = tree.closestPointToPoint(new T3.Vector3(...cp), hit), f = rr.faceIndex;
      tr.a.fromBufferAttribute(hp, 3 * f); tr.b.fromBufferAttribute(hp, 3 * f + 1); tr.c.fromBufferAttribute(hp, 3 * f + 2); tr.getBarycoord(rr.point, bar);
      const truth = nrm3([0, 1, 2].map(i => bar.x * hnr.getComponent(3 * f, i) + bar.y * hnr.getComponent(3 * f + 1, i) + bar.z * hnr.getComponent(3 * f + 2, i)));
      // (the sphere of this file is wound inside out: its normals point inwards. What counts is that the map gives back the direction of the surface, on the side of the vertex normals)
      const dB = Math.abs(n[0] * truth[0] + n[1] * truth[1] + n[2] * truth[2]), dF = Math.abs(N[0] * truth[0] + N[1] * truth[1] + N[2] * truth[2]);
      sumB += dB; sumF += dF; (dB > 0.9 && n[0] * N[0] + n[1] * N[1] + n[2] * N[2] > 0.5) ? ok++ : bad++;
    }
    return { ok, bad, sy, withMap: sumB / Math.max(1, ok + bad), withoutMap: sumF / Math.max(1, ok + bad) };
  })()`);
  check('the baked normal map gives back the normal of the sphere (read as the shader reads it)', nrm.ok > 100 && nrm.bad < nrm.ok * 0.1 && nrm.sy === -1 && nrm.withMap > nrm.withoutMap + 0.00004 && nrm.withMap > 0.9999, nrm);
  const px = await evalJS(`(() => {
    const p = window.state.parts.find(q => q.name === 'sphere_red'), m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material, im = m.map.image;
    const d = im.getContext('2d').getImageData(0, 0, im.width, im.height).data; let red = 0, green = 0, blue = 0, other = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > d[i + 1] + 70 && d[i] > d[i + 2] + 70) red++; else if (d[i + 1] > d[i] + 70 && d[i + 1] > d[i + 2] + 70) green++; else if (d[i + 2] > d[i] + 70 && d[i + 2] > d[i + 1] + 50) blue++; else other++; }
    return { red, green, blue, other };
  })()`);
  check('the picture holds the map of the sphere (red and green halves) and the blue of the box', px.red > 8000 && px.green > 8000 && px.blue > 2000, px);
  // where the colour landed: at the UV of each vertex of the reduced sphere the picture must show what the original has at that point
  const where = await evalJS(`(() => {
    const p = window.state.parts.find(q => q.name === 'sphere_red'), g = p.mesh.geometry, m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material, im = m.map.image;
    const d = im.getContext('2d').getImageData(0, 0, im.width, im.height).data, pos = g.attributes.position, uv = g.attributes.uv;
    let ok = 0, bad = 0;
    for (let i = 0; i < pos.count; i += 3) {
      const u0 = 0.5 + Math.atan2(pos.getZ(i), pos.getX(i)) / (2 * Math.PI);
      if (Math.abs(u0 - 0.5) < 0.04 || u0 < 0.04 || u0 > 0.96) continue;
      const x = Math.min(im.width - 1, Math.floor(uv.getX(i) * im.width)), y = Math.min(im.height - 1, Math.floor(uv.getY(i) * im.height)), k = 4 * (y * im.width + x);
      const isRed = d[k] > d[k + 1] + 60, isGreen = d[k + 1] > d[k] + 60;
      if ((u0 < 0.5 && isRed) || (u0 > 0.5 && isGreen)) ok++; else bad++;
    }
    return { ok, bad };
  })()`);
  check('each vertex of the reduced sphere finds its own colour in the picture', where.ok > 200 && where.bad < where.ok * 0.08, where);
  check('the card closed when it was done', await evalJS("document.querySelector('.section-cmd[data-cmd=\"bake\"]').hidden"));

  // ── undo / redo ──
  await evalJS("window.__moAgent.undo ? window.__moAgent.undo() : document.getElementById('btn-undo')?.click()");
  await sleep(700);
  let U = await info('sphere_red');
  if (U && U.tris === S1.tris) { await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(700); U = await info('sphere_red'); }
  check('one undo puts the triangles back', U && U.tris === S0, [U && U.tris, S0]);
  check('and the material: its own 64 px map again, not the baked picture', U && U.hasMap && U.mapSize === 64, U);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }))"); await sleep(700);
  const R = await info('sphere_red');
  check('one redo bakes it again', R && R.tris === S1.tris && R.mapSize === 1024, R);

  // ── ambient occlusion: the plate under the box darkens where the box stands on it ──
  await evalJS('window.state.selected.clear(); for (const p of window.state.parts) window.state.selected.add(p.partId)');
  const ar = await evalJS(`window.__moAgent.bakeTextures({ maps: ['occlusion'], size: 1024, reduce_percent: 0, quiet: true })`);
  await sleep(500);
  check('occlusion alone is baked', ar && ar.ok && ar.parts === 3, ar);
  const ao = await evalJS(`(() => {
    const p = window.state.parts.find(q => q.name === 'plate_grey'), m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material;
    if (!m.aoMap) return { missing: true };
    const im = m.aoMap.image, d = im.getContext('2d').getImageData(0, 0, im.width, im.height).data; let lo = 255, hi = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); if (d[i] < 215) dark++; }
    return { size: im.width, lo, hi, dark, hasMap: !!m.map, hasNormal: !!m.normalMap };
  })()`);
  check('the occlusion picture is half the size and varies: dark where the box stands on the plate, white in the open', ao && ao.size === 512 && ao.lo < 215 && ao.hi > 250 && ao.dark > 30 && !ao.hasMap && !ao.hasNormal, ao);

  // ── the tool Claude uses ──
  console.log('box:', JSON.stringify(await evalJS(`window.state.parts.map(p => ({ id: p.partId, n: p.name, t: p.triCount, m: !!p.mesh, d: !!p.deleted, sp: !!p.isSpline, cl: !!p.isCloner }))`)));
  const mc = await evalJS(`(async () => { try { const r = await window.__moBridgeTools.bake_textures({ name_contains: 'box_blue', reduce_percent: 0, size_px: 1024 }); return { ok: true, t: r.map(x => x.text).join('') }; } catch (e) { return { ok: false, e: e.message }; } })()`);
  let mj = null; try { mj = JSON.parse(mc.t); } catch (_) {}
  check('bake_textures (the tool Claude uses) bakes the chosen part', mc.ok && mj && mj.picture_px === 1024 && mj.result && mj.result.ok && mj.result.parts === 1, mc);
  const none = await evalJS(`(async () => { try { await window.__moBridgeTools.bake_textures({ name_contains: 'no_such_part_xyz' }); return 'no error'; } catch (e) { return e.message; } })()`);
  check('and says so when no part is named', /Name the parts|no part|None of/i.test(none) && none !== 'no error', none);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
