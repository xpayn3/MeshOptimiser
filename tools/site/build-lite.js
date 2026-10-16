/* ===================================================================
   tools/site/build-lite.js — copies the app's front end into site/lite/
   so the site can offer "Open online": the real app, running in the
   browser from static files, with no server.

     node tools/site/build-lite.js [path to the app folder]

   The app folder defaults to this repository
   (or the MESHOPT_APP environment variable); the program itself is its app/
   folder (an older layout, with the files loose in it, is read as well).
   What is copied: index.html, the scripts it loads (js/), vendor/ and
   assets/. What is not: the server,
   the converter, the tests, the docs and any *.bak-* file. inbox/ is kept as
   it is (it holds the sample models: GearboxAssy.glb, 2CylinderEngine.glb and ReciprocatingSaw.glb, all from Khronos's
   glTF-Sample-Models, credited on the site).

   index.html is patched in two places: lite-shim.js (from tools/site/lite/) is
   the first script, and the install manifest is dropped. The page also gets
   noindex. Re-run after changing the app, then commit the result.
   =================================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let SRC = path.resolve(process.argv[2] || process.env.MESHOPT_APP || ROOT);
if (fs.existsSync(path.join(SRC, 'app', 'index.html'))) SRC = path.join(SRC, 'app');      // the layout with the program in app/
const OUT = path.join(ROOT, 'site', 'lite');

if (!fs.existsSync(path.join(SRC, 'index.html'))) { console.error('No index.html in ' + SRC); process.exit(1); }

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (/\.bak-/.test(entry.name)) continue;
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
};

// the scripts at the top level that the page (or a worker) loads
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
// js/ in the current layout; the top level in the old one (then the old copies are cleared out first, below)
const JS_DIR = fs.existsSync(path.join(SRC, 'js', 'app.js')) ? 'js' : '';
const scripts = fs.readdirSync(path.join(SRC, JS_DIR)).filter(f => /\.m?js$/.test(f) && !/\.bak-/.test(f));
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.m?js$/.test(f) && f !== 'lite-shim.js') fs.rmSync(path.join(OUT, f));      // loose scripts of an earlier build
fs.rmSync(path.join(OUT, 'js'), { recursive: true, force: true });
if (JS_DIR) fs.mkdirSync(path.join(OUT, JS_DIR), { recursive: true });
for (const f of scripts) fs.copyFileSync(path.join(SRC, JS_DIR, f), path.join(OUT, JS_DIR, f));
for (const dir of ['vendor', 'assets']) {
  fs.rmSync(path.join(OUT, dir), { recursive: true, force: true });
  copyDir(path.join(SRC, dir), path.join(OUT, dir));
}
fs.copyFileSync(path.join(__dirname, 'lite', 'lite-shim.js'), path.join(OUT, 'lite-shim.js'));

let patched = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<meta name="robots" content="noindex">\n<script src="lite-shim.js?v=6"></script>');
if (patched === html) throw new Error('index.html: the charset line was not found');
const noManifest = patched.replace(/<link rel="manifest"[^>]*>\n?/, '');
if (noManifest === patched) throw new Error('index.html: the manifest line was not found');
patched = noManifest.replace('<title>MeshOptimiser</title>', '<title>MeshOptimiser online</title>');
fs.writeFileSync(path.join(OUT, 'index.html'), patched);

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log('Wrote the Web version to site/lite/ (' + (size(OUT) / 1048576).toFixed(1) + ' MB, ' + scripts.length + ' scripts)');
