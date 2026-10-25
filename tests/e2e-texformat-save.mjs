// node tests/e2e-texformat-save.mjs
// A scene saved as GLB keeps a JPEG texture as JPEG (it used to be written again as a lossless PNG, ten times its size):
//   1. an OBJ with its .mtl and a 1024 px noise JPEG (map_Kd) is dropped on the viewport and opens with the picture on its material;
//   2. the scene is saved (Save a copy, as e2e-save-roundtrip does) and the GLB's image is image/jpeg, about the size of the JPEG;
//   3. the material's texture carries no mimeType afterwards (the format is chosen for the write only).
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9361, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-texfmt-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
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

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  // 1. OBJ + MTL + JPEG, dropped together
  const jpgSize = await evalJS(`(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 1024; const x = c.getContext('2d'), im = x.createImageData(1024, 1024);
    for (let i = 0; i < im.data.length; i += 4) { const v = (Math.random() * 120 + 80) | 0; im.data[i] = v; im.data[i + 1] = (v * 0.7) | 0; im.data[i + 2] = (v * 0.4) | 0; im.data[i + 3] = 255; }
    x.putImageData(im, 0, 0);
    const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    const obj = 'mtllib table.mtl\\nv 0 0 0\\nv 100 0 0\\nv 100 100 0\\nv 0 100 0\\nvt 0 0\\nvt 1 0\\nvt 1 1\\nvt 0 1\\nvn 0 0 1\\nusemtl Wood\\nf 1/1/1 2/2/1 3/3/1\\nf 1/1/1 3/3/1 4/4/1\\n';
    const mtl = 'newmtl Wood\\nKd 1 1 1\\nmap_Kd Table_BaseColor.jpg\\n';
    const dt = new DataTransfer();
    dt.items.add(new File([obj], 'table.obj')); dt.items.add(new File([mtl], 'table.mtl')); dt.items.add(new File([jpg], 'Table_BaseColor.jpg', { type: 'image/jpeg' }));
    document.getElementById('viewport').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return jpg.size; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
  await evalJS("document.querySelector('#import-modal-confirm')?.click(); true");
  for (let i = 0; i < 60; i++) { if (await evalJS("(window.state.parts || []).some(p => !p.deleted && p.mesh)")) break; await sleep(500); }
  await sleep(2500);
  const mat = await evalJS(`(() => { const p = window.state.parts.find(p => !p.deleted && p.mesh); const m = p && [].concat(p.mesh.material)[0]; return m ? { map: !!m.map, w: m.map?.image?.width || 0, mime: m.map?.userData?.mimeType ?? null } : null; })()`);
  check('the OBJ opens with its JPEG on the material', mat && mat.map && mat.w === 1024, mat);

  // 2. save a copy, capture the GLB
  await evalJS(`window.__F = window.File; window.File = function (parts, name, opts) { const f = new window.__F(parts, name, opts); if (/ copy\\.glb$/.test(name)) window.__capt = f; return f; }; window.File.prototype = window.__F.prototype; true`);
  await evalJS('window.__moDuplicateScene()');
  for (let i = 0; i < 40; i++) { if (await evalJS('!!window.__capt')) break; await sleep(500); }
  const glb = await evalJS(`(async () => { const f = window.__capt; if (!f) return null; const b = await f.arrayBuffer(), len = new DataView(b).getUint32(12, true);
    const j = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 20, len)));
    return { size: b.byteLength, images: (j.images || []).map(im => ({ mime: im.mimeType, bytes: j.bufferViews[im.bufferView].byteLength })) }; })()`);
  console.log('   JPEG in', jpgSize, 'bytes; GLB', JSON.stringify(glb));
  check('the saved GLB holds the picture as JPEG', glb && glb.images.length === 1 && glb.images[0].mime === 'image/jpeg', glb);
  check('and about the size of the JPEG (under twice it), not a PNG', glb && glb.images[0] && glb.images[0].bytes < jpgSize * 2, { jpgSize, img: glb && glb.images[0] });

  // 3. nothing left on the texture
  const after = await evalJS(`(() => { const p = window.state.parts.find(p => !p.deleted && p.mesh); const m = [].concat(p.mesh.material)[0]; return m.map ? (m.map.userData.mimeType ?? null) : 'no map'; })()`);
  check('the texture carries no mimeType afterwards', after === null, after);
  check('no page errors', errors.length === 0, errors);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
