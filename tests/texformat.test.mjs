// node tests/texformat.test.mjs
// setExportTextureFormats: the format each picture is written in when a scene is saved or exported as glTF / GLB.
//   1. a JPEG loaded into a slot (or with an OBJ) stays JPEG, a PNG stays PNG, by its file name, its name or its URL;
//   2. a picture with no file behind it is JPEG, unless it is a colour map with transparency (PNG); other slots ignore alpha;
//   3. GLTFLoader's own mimeType is left alone; a picture shared by two textures is judged once;
//   4. undo() takes away only what was set, so a texture painted on later is judged again;
//   5. imageHasAlpha on raw RGBA data, opaque and not.
// Then, with the real GLTFExporter in node: a scene of a 64 px noise picture without a file name is written as JPEG, not PNG.
import { register } from 'node:module';
// (GLTFExporter imports 'three': the same core module the test uses, so its instanceof checks hold)
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { return s === 'three' ? { url: ${JSON.stringify(new URL('../app/vendor/three/build/three.core.js', import.meta.url).href)}, shortCircuit: true } : next(s, c); }`));
import * as THREE from '../app/vendor/three/build/three.core.js';
import { setExportTextureFormats, shrinkExportTextures, imageHasAlpha, mimeFromName } from '../app/js/texformat.js';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

const img = (src, alpha = false) => ({ width: 8, height: 8, src, alpha });
const tex = (image, name = '', userData = {}) => { const t = new THREE.Texture(image); t.name = name; Object.assign(t.userData, userData); return t; };
const scene = (...mats) => { const g = new THREE.Group(); for (const m of mats) g.add(new THREE.Mesh(new THREE.BufferGeometry(), m)); return g; };
const fakeAlpha = (im) => !!im.alpha;

// 1. by file name, name, URL
check('names', mimeFromName('a_4K_BaseColor.jpg') === 'image/jpeg' && mimeFromName('x.JPEG') === 'image/jpeg' && mimeFromName('x.png') === 'image/png'
  && mimeFromName('http://h/x.png?v=2') === 'image/png' && mimeFromName('blob:http://localhost:4242/0c1e') === '' && mimeFromName('x.webp') === '');
{
  const a = tex(img('blob:x'), '', { fileName: 'Table_4K_Normal.jpg' });
  const b = tex(img('blob:y'), 'decal.png');
  const c = tex(img('http://h/tex/wood.jpeg'));
  const d = tex(img('blob:z', true), 'Table_4K_BaseColor.jpg');       // (said JPEG by its name: the file's own format wins)
  const undo = setExportTextureFormats(scene(new THREE.MeshStandardMaterial({ normalMap: a, map: d }), new THREE.MeshStandardMaterial({ map: b, roughnessMap: c })), { hasAlpha: fakeAlpha });
  check('a JPEG file stays JPEG', a.userData.mimeType === 'image/jpeg' && d.userData.mimeType === 'image/jpeg', [a.userData, d.userData]);
  check('a PNG file stays PNG', b.userData.mimeType === 'image/png', b.userData);
  check('a URL says the format', c.userData.mimeType === 'image/jpeg', c.userData);
  undo();
}

// 2. no file: JPEG unless a colour map with transparency
{
  const opaque = tex(img('blob:a')), see = tex(img('blob:b', true)), normal = tex(img('blob:c', true)), ao = tex(img(undefined));
  setExportTextureFormats(scene(new THREE.MeshStandardMaterial({ map: opaque, aoMap: ao }), new THREE.MeshStandardMaterial({ map: see, normalMap: normal })), { hasAlpha: fakeAlpha });
  check('opaque colour map without a file -> JPEG', opaque.userData.mimeType === 'image/jpeg');
  check('colour map with transparency -> PNG', see.userData.mimeType === 'image/png');
  check('alpha in a normal map does not matter -> JPEG', normal.userData.mimeType === 'image/jpeg');
  check('no source at all -> JPEG', ao.userData.mimeType === 'image/jpeg');
}

// 3. GLTFLoader's format kept; one picture shared, judged as a colour map
{
  const fromGltf = tex(img('blob:g', true), '', { mimeType: 'image/png' });
  const shared = img('blob:s', true), t1 = tex(shared), t2 = tex(shared);
  let asked = 0;
  const undo = setExportTextureFormats(scene(new THREE.MeshStandardMaterial({ map: fromGltf, bumpMap: t1 }), new THREE.MeshStandardMaterial({ map: t2 })), { hasAlpha: (im) => (asked++, im.alpha) });
  check('GLTFLoader mimeType kept', fromGltf.userData.mimeType === 'image/png');
  check('shared picture: one format, as a colour map', t1.userData.mimeType === 'image/png' && t2.userData.mimeType === 'image/png' && asked === 1, { a: t1.userData.mimeType, b: t2.userData.mimeType, asked });
  // 4. undo
  undo();
  check('undo clears what was set', !('mimeType' in t1.userData) && !('mimeType' in t2.userData));
  check('undo leaves GLTFLoader mimeType', fromGltf.userData.mimeType === 'image/png');
}

// 5. raw data
{
  const d = new Uint8Array(4 * 4 * 4).fill(255);
  check('opaque RGBA data', imageHasAlpha({ data: d, width: 4, height: 4 }) === false);
  d[4 * 7 + 3] = 128;
  check('RGBA data with one see-through pixel', imageHasAlpha({ data: d, width: 4, height: 4 }) === true);
  check('RGB data has no alpha', imageHasAlpha({ data: new Uint8Array(4 * 4 * 3), width: 4, height: 4 }) === false);
}

// The real exporter: what mimeType the GLB's image gets. Node has no canvas, so the exporter's own canvas is a stand-in that records
// the type it is asked to encode in and hands back a few bytes.
{
  const asked = [];
  const canvas = () => ({ width: 0, height: 0, getContext: () => ({ translate() {}, scale() {}, drawImage() {}, putImageData() {} }),
    toBlob: (cb, type) => { asked.push(type); cb(new Blob([new Uint8Array(16)], { type })); } });
  globalThis.document = { createElement: (t) => t === 'canvas' ? canvas() : {} };
  globalThis.ImageData = class { constructor(data, w, h) { Object.assign(this, { data, width: w, height: h }); } };
  globalThis.FileReader = class { readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend(); }); } readAsDataURL(b) { b.arrayBuffer().then(() => { this.result = 'data:,'; this.onloadend(); }); } };
  const { GLTFExporter } = await import('../app/vendor/three/examples/jsm/exporters/GLTFExporter.js');
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i % 4 === 3) ? 255 : (Math.random() * 256) | 0;
  const noise = new THREE.DataTexture(data, n, n, THREE.RGBAFormat); noise.needsUpdate = true;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: noise })));
  const run = async () => { asked.length = 0; const r = await new Promise((ok, no) => new GLTFExporter().parse(root, ok, no, { binary: true, embedImages: true })); const len = new DataView(r).getUint32(12, true); return JSON.parse(new TextDecoder().decode(new Uint8Array(r, 20, len))); };
  const before = await run();
  check('without the pass the exporter writes PNG (the bug)', before.images?.[0]?.mimeType === 'image/png' && asked[0] === 'image/png', { img: before.images, asked });
  const undo = setExportTextureFormats(root);
  const after = await run();
  undo();
  check('with the pass an opaque picture is written as JPEG', after.images?.[0]?.mimeType === 'image/jpeg' && asked[0] === 'image/jpeg', { img: after.images, asked });
  check('and the texture is as it was afterwards', !('mimeType' in noise.userData));
}

// 6. Texture size: pictures longer than max are drawn smaller in proportion, once each, and put back
{
  const fakeCanvas = (w, h) => ({ width: w, height: h, getContext: () => ({ drawImage() {} }) });
  const wide = { width: 4096, height: 2048 }, tiny = { width: 256, height: 256 }, data = { width: 4096, height: 4096, data: new Uint8Array(4) };
  const a = new THREE.Texture(wide), b = new THREE.Texture(wide), c = new THREE.Texture(tiny), d = new THREE.Texture(data);
  const stats = {};
  const undo = shrinkExportTextures(scene(new THREE.MeshStandardMaterial({ map: a, normalMap: b }), new THREE.MeshStandardMaterial({ roughnessMap: c, aoMap: d })), 1024, { makeCanvas: fakeCanvas, stats });
  check('4096 x 2048 at 1024 keeps its proportions', a.image.width === 1024 && a.image.height === 512, [a.image.width, a.image.height]);
  check('a picture shared by two textures is drawn once', a.image === b.image && stats.shrunk === 1, stats);
  check('a small picture and raw data are left alone', c.image === tiny && d.image === data);
  undo();
  check('undo puts the pictures back', a.image === wide && b.image === wide);
  const none = shrinkExportTextures(scene(new THREE.MeshStandardMaterial({ map: a })), 0, { makeCanvas: fakeCanvas });
  none(); check('0 means as they are', a.image === wide);
}
// 7. Pictures as WebP: forced over what a picture says, and undo() brings the old format back
{
  const j = tex(img('blob:j'), '', { fileName: 'a.jpg' }), l = tex(img('blob:l'), '', { mimeType: 'image/png' });
  const undo = setExportTextureFormats(scene(new THREE.MeshStandardMaterial({ map: j, normalMap: l })), { force: 'image/webp' });
  check('forced WebP over JPEG and a loader PNG', j.userData.mimeType === 'image/webp' && l.userData.mimeType === 'image/webp');
  undo();
  check('undo restores the earlier format', !('mimeType' in j.userData) && l.userData.mimeType === 'image/png', [j.userData, l.userData]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
