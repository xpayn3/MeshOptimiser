// node tests/e2e-texsets.mjs
// An FBX or OBJ dropped with its maps beside it (named <name>_BaseColor, _Normal, ...) opens with them on its material:
//   1. an OBJ with no .mtl and five pictures (BaseColor, Gloss, Normal_DX, Bump, Cavity), dropped together: colour, normal (green
//      flipped), roughness made from Gloss (turned over), no bump (there is a normal map); the toast names what was used and what was not;
//   2. the same OBJ dropped alone: no maps, no toast; with its pictures but the import dialog's "Find textures by name" off: no maps;
//   2c. opened alone the way Open opens it (with a file handle): a dialog asks for its folder; the pictures dropped on it go on;
//       "Not now" leaves it plain;
//   3. the Fab table (TABLE_DIR, default the Fab cache on E:, skipped when it is not there): the FBX and its nine JPEGs dropped together
//      open with colour, normal, roughness and AO, and the scene saved as GLB holds JPEGs, under 40 MB (it was 116 MB of PNGs).
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9362, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-texsets-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const TABLE_DIR = process.env.TABLE_DIR || 'E:/FAB/VaultCache/FabLibrary/Wooden_Table-d69f8adb/fbx/high/wooden_table_veigfjmaw_h_extracted';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ready = async () => { for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); } await sleep(1500); };
const attach = async () => {
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
};
const fresh = async () => {
  await send('Page.navigate', { url: URL + '?t=' + Date.now() }); await ready(); await evalJS("document.getElementById('welcome-close')?.click()");
  for (let i = 0; i < 60; i++) { if (await evalJS('!!(window.state && window.state.parts)').catch(() => false)) break; await sleep(500); }      // (app-ready can come before the state is there)
  // every toast is kept, to read back what it said
  await evalJS(`window.__toasts = []; new MutationObserver(() => { for (const el of document.querySelectorAll('.toast')) { const t = el.textContent.trim(); if (t && !window.__toasts.includes(t)) window.__toasts.push(t); } }).observe(document.body, { childList: true, subtree: true }); true`);
};
// drops the files in window.__drop on the viewport and confirms the import dialog
const drop = async (texSets = true) => {
  await evalJS(`(() => { const dt = new DataTransfer(); for (const f of window.__drop) dt.items.add(f); document.getElementById('viewport').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
  await evalJS(`(() => { const t = document.getElementById('imp-tex-sets'); if (t) t.checked = ${texSets}; document.querySelector('#import-modal-confirm')?.click(); return true; })()`);
  for (let i = 0; i < 120; i++) { if (await evalJS("(window.state.parts || []).some(p => !p.deleted && p.mesh)")) break; await sleep(500); }
  await sleep(2500);
};
const look = () => evalJS(`(() => { const ms = new Set(); for (const p of window.state.parts) if (!p.deleted && p.mesh) for (const m of [].concat(p.mesh.material)) ms.add(m);
  return [...ms].map(m => ({ type: m.type, map: m.map ? m.map.name : null, normal: m.normalMap ? m.normalMap.name : null, ny: m.normalScale ? m.normalScale.y : null,
    rough: m.roughnessMap ? m.roughnessMap.name : null, roughness: m.roughness, ao: m.aoMap ? m.aoMap.name : null, bump: m.bumpMap ? m.bumpMap.name : null,
    colour: m.color ? m.color.getHex() : null, flipY: m.map ? m.map.flipY : null })); })()`);

try {
  await attach();
  // 1. OBJ + five pictures
  await fresh();
  await evalJS(`(async () => {
    const pic = async (name, fill) => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = fill; x.fillRect(0, 0, 64, 64); return new File([await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9))], name, { type: 'image/jpeg' }); };
    const obj = 'v 0 0 0\\nv 100 0 0\\nv 100 100 0\\nv 0 100 0\\nvt 0 0\\nvt 1 0\\nvt 1 1\\nvt 0 1\\nvn 0 0 1\\nf 1/1/1 2/2/1 3/3/1\\nf 1/1/1 3/3/1 4/4/1\\n';
    window.__obj = new File([obj], 'Crate.obj');
    window.__drop = [window.__obj, await pic('Crate_2K_BaseColor.jpg', '#a0602a'), await pic('Crate_2K_Gloss.jpg', '#404040'), await pic('Crate_2K_Normal_DX.jpg', '#8080ff'), await pic('Crate_2K_Bump.jpg', '#808080'), await pic('Crate_2K_Cavity.jpg', '#ffffff')];
    return true; })()`);
  await drop();
  const a = await look(), toasts = await evalJS('window.__toasts');
  const m = a[0] || {};
  check('OBJ: colour from BaseColor', m.map === 'Crate_2K_BaseColor.jpg' && m.colour === 0xffffff && m.flipY === false, a);
  // an OBJ's normal map is turned on import (normalScale.y = -1, as glTF's), and a DirectX one turned again ends at +1 (9a8bc49; e2e-normal-map-direction proves the lighting)
  check('OBJ: DirectX normal map, green flipped', m.normal === 'Crate_2K_Normal_DX.jpg' && m.ny === 1, a);
  check('OBJ: roughness from Gloss, turned over', m.rough === 'Crate_2K_Gloss (as roughness)' && m.roughness === 1, a);
  check('OBJ: no bump with a normal map', m.bump === null, a);
  const t = toasts.find(s => /Textures found/.test(s)) || '';
  check('the toast says what was used and what not', /colour/.test(t) && /roughness/.test(t) && /Not used:.*bump.*Cavity/.test(t), toasts);

  // 2. the OBJ alone
  await fresh();
  await evalJS(`(() => { const obj = 'v 0 0 0\\nv 100 0 0\\nv 100 100 0\\nvt 0 0\\nvt 1 0\\nvt 1 1\\nf 1/1 2/2 3/3\\n'; window.__drop = [new File([obj], 'Crate.obj')]; return true; })()`);
  await drop();
  const b = await look(), toasts2 = await evalJS('window.__toasts');
  check('OBJ alone: no maps, no toast', b.every(x => !x.map && !x.normal) && !toasts2.some(s => /Textures found/.test(s)), { b, toasts2 });
  check('... and, with no file handle, no question', await evalJS('window.__moTexFolderAsks') === 0);

  // 2b. pictures beside it, the switch off
  await fresh();
  await evalJS(`(async () => { const c = document.createElement('canvas'); c.width = c.height = 64; c.getContext('2d').fillRect(0, 0, 64, 64);
    const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg')); const obj = 'v 0 0 0\\nv 100 0 0\\nv 100 100 0\\nvt 0 0\\nvt 1 0\\nvt 1 1\\nf 1/1 2/2 3/3\\n';
    window.__drop = [new File([obj], 'Crate.obj'), new File([jpg], 'Crate_BaseColor.jpg'), new File([jpg], 'Crate_Normal.jpg')]; return true; })()`);
  await drop(false);
  const off = await look(), toasts4 = await evalJS('window.__toasts');
  check('switch off: the pictures beside it are left', off.every(x => !x.map && !x.normal) && !toasts4.some(s => /Textures found/.test(s)), { off, toasts4 });

  // 2c. opened with a handle: the dialog asks for the folder
  const openAlone = () => evalJS(`(() => { const obj = 'v 0 0 0\\nv 100 0 0\\nv 100 100 0\\nvt 0 0\\nvt 1 0\\nvt 1 1\\nf 1/1 2/2 3/3\\n';
    const f = new File([obj], 'Crate.obj'); f.__moHandle = { kind: 'file', name: 'Crate.obj' }; window.__moOpenFile(f); return true; })()`);
  const waitAsk = async () => { for (let i = 0; i < 60; i++) { if (await evalJS("!!document.querySelector('[data-mo-ask=textures]')")) return true; await sleep(250); } return false; };
  const confirmImport = async () => { for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); } await evalJS("document.getElementById('imp-tex-sets').checked = true; document.querySelector('#import-modal-confirm')?.click(); true"); };
  await fresh(); await openAlone(); await confirmImport();
  check('opened alone: the dialog asks for its folder', await waitAsk());
  await evalJS(`(async () => { const c = document.createElement('canvas'); c.width = c.height = 64; c.getContext('2d').fillRect(0, 0, 64, 64);
    const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg')); const dt = new DataTransfer(); dt.items.add(new File([jpg], 'Crate_4K_BaseColor.jpg')); dt.items.add(new File([jpg], 'Crate_4K_Roughness.jpg'));
    document.querySelector('[data-mo-ask=textures]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
  for (let i = 0; i < 60; i++) { if (await evalJS("(window.state.parts || []).some(p => !p.deleted && p.mesh)")) break; await sleep(500); }
  await sleep(2000);
  const asked = await look();
  check('the pictures dropped on the dialog go on the material', asked.some(x => x.map === 'Crate_4K_BaseColor.jpg' && x.rough === 'Crate_4K_Roughness.jpg'), asked);
  await fresh(); await openAlone(); await confirmImport();
  const shown = await waitAsk();
  await evalJS("document.querySelector('[data-mo-ask=textures] [data-c=no]').click(); true");
  for (let i = 0; i < 60; i++) { if (await evalJS("(window.state.parts || []).some(p => !p.deleted && p.mesh)")) break; await sleep(500); }
  await sleep(1500);
  const plain = await look();
  check('"Not now" opens it plain', shown && plain.length && plain.every(x => !x.map), plain);

  // 3. the Fab table
  if (!fs.existsSync(TABLE_DIR)) console.log('SKIP the Fab table: ' + TABLE_DIR + ' is not here');
  else {
    await fresh();
    await evalJS('window.__drop = []; true');
    for (const n of fs.readdirSync(TABLE_DIR)) {
      const b64 = fs.readFileSync(path.join(TABLE_DIR, n)).toString('base64');
      await evalJS(`(() => { const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)); window.__drop.push(new File([bin], ${JSON.stringify(n)})); return true; })()`);
    }
    await drop();
    await sleep(3000);
    const c = await look(), toasts3 = await evalJS('window.__toasts');
    const tm = c.find(x => x.map) || {};
    console.log('   table materials', JSON.stringify(c));
    console.log('   toast', JSON.stringify(toasts3.find(s => /Textures found/.test(s))));
    check('table: colour, normal, roughness, AO from the folder', /BaseColor/.test(tm.map) && /Normal/.test(tm.normal) && /Roughness/.test(tm.rough) && /AO/.test(tm.ao) && tm.bump === null, c);
    await evalJS(`window.__F = window.File; window.File = function (parts, name, opts) { const f = new window.__F(parts, name, opts); if (/ copy\\.glb$/.test(name)) window.__capt = f; return f; }; window.File.prototype = window.__F.prototype; true`);
    await evalJS('window.__moDuplicateScene()');
    for (let i = 0; i < 120; i++) { if (await evalJS('!!window.__capt')) break; await sleep(500); }
    const glb = await evalJS(`(async () => { const f = window.__capt; if (!f) return null; const b = await f.arrayBuffer(), len = new DataView(b).getUint32(12, true);
      const j = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 20, len))); return { mb: +(b.byteLength / 1048576).toFixed(1), mimes: (j.images || []).map(im => im.mimeType) }; })()`);
    console.log('   saved', JSON.stringify(glb));
    check('table: saved as a GLB of JPEGs under 40 MB', glb && glb.mimes.length >= 4 && glb.mimes.every(x => x === 'image/jpeg') && glb.mb < 40, glb);
  }
  check('no page errors', errors.length === 0, errors);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
