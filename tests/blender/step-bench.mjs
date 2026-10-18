// node tests/blender/step-bench.mjs [STEP files or folders ...]
// The STEP benchmark: every file is converted the way the app's server converts it (app/step2glb.py, quality 0.5, --force-colors
// --no-meshopt), then Blender opens the GLB and each part is judged against the B-rep that OpenCASCADE reads from the same STEP file
// (tests/blender/step-reference.py): the parts must be closed, face out, and the mesh's volume and area must be within a fraction of
// a percent of the exact ones. Default files: inbox/benchmark/ (the NIST PMI test parts and the CAx-IF AS1 assembly from five CAD systems).
// Needs Blender 5 (BLENDER, or the usual install folder) and app/.venv. Writes into OUT (default: a folder in TEMP).
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const PY = path.join(ROOT, 'app/.venv/Scripts/python.exe');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'mo-step-bench'); fs.mkdirSync(OUT, { recursive: true });
const QUALITY = process.env.QUALITY || '0.5';
const UNIT = +(process.env.UNIT || 1);        // the converter keeps the STEP file's millimetres
const walk = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap(n => walk(path.join(p, n))) : /\.(stp|step)$/i.test(p) ? [p] : [];
const inputs = (process.argv.length > 2 ? process.argv.slice(2) : [path.join(ROOT, 'inbox/benchmark')]).flatMap(walk)
  .filter(p => !/AP203 with PMI/.test(p));        // (the same parts as the AP203 geometry-only files, plus their PMI)
const results = (txt) => [...txt.matchAll(/RESULT_BEGIN(.*?)RESULT_END/g)].map(m => JSON.parse(m[1]));

const ref = new Map();
for (const line of execFileSync(PY, [path.join(ROOT, 'tests/blender/step-reference.py'), ...inputs], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/))
  if (line.startsWith('{')) { const r = JSON.parse(line); ref.set(r.file, r); }

const glbs = [];
for (const f of inputs) {
  const dst = path.join(OUT, path.basename(f).replace(/\.(stp|step)$/i, '.glb'));
  const t0 = Date.now();
  try { execFileSync(PY, [path.join(ROOT, 'app/step2glb.py'), f, '--out', dst, '--quality', QUALITY, '--no-meshopt', '--force-colors', '--force', ...(process.env.STEP_ARGS ? process.env.STEP_ARGS.split(' ') : [])], { stdio: 'ignore', timeout: 600000 }); glbs.push({ f, dst, s: (Date.now() - t0) / 1000 }); }
  catch (e) { glbs.push({ f, dst: null, err: 'exit ' + e.status }); }
}
const insp = new Map();
const ok = glbs.filter(g => g.dst && fs.existsSync(g.dst));
for (const r of results(execFileSync(BLENDER, ['--background', '--factory-startup', '--python', path.join(ROOT, 'tests/blender/inspect.py'), '--', ...ok.map(g => g.dst)], { encoding: 'utf8', maxBuffer: 1 << 28 })))
  insp.set(r.file, r);

let fail = 0;
const rows = [];
for (const g of glbs) {
  const name = path.basename(g.f), R = ref.get(name) || {};
  if (!g.dst) { rows.push({ file: name, verdict: 'FAIL convert ' + g.err }); fail++; continue; }
  const I = insp.get(path.basename(g.dst));
  if (!I || I.error) { rows.push({ file: name, verdict: 'FAIL blender ' + (I && I.error) }); fail++; continue; }
  const O = I.objects;
  // What counts as a solid: every part, but a solid split into colour pieces is judged as one (welded: I.groups), and a sheet the
  // STEP file has besides its solids (the converter's extras say product SHELL or COMPOUND) is not judged as closed.
  const key = (n) => n.replace(/(__geom(_\d+)?)(\.\d+)?$/, '');
  const sheet = (o) => /^(SHELL|COMPOUND)$/.test(String(o.props?.product || ''));
  const G = new Map((I.groups || []).map(g => [g.name, g]));
  const solidsSeen = new Map();
  for (const o of O) { if (sheet(o)) continue; const k = key(o.name); if (!solidsSeen.has(k)) solidsSeen.set(k, G.get(k) || o); }
  let S = [...solidsSeen.values()], sheets = O.filter(sheet).length;
  // (not every file says what a piece is: open pieces beyond the file's own count of solids are its sheets too)
  if (R.solids && S.length > R.solids) {
    const ranked = S.slice().sort((a, b) => (a.open_edges > 0) - (b.open_edges > 0) || Math.abs(b.volume) - Math.abs(a.volume));
    const extra = ranked.slice(R.solids).filter(o => o.open_edges > 0);
    S = S.filter(o => !extra.includes(o)); sheets += extra.length;
  }
  const k = UNIT;
  const vol = S.reduce((s, o) => s + o.volume, 0) * k ** 3, area = O.reduce((s, o) => s + o.area, 0) * k ** 2;
  const open = S.reduce((s, o) => s + o.open_edges, 0), inside = S.filter(o => o.volume < 0).length;
  const split = (I.groups || []).filter(g => solidsSeen.get(g.name) === g).length;
  const dv = R.volume ? (vol - R.volume) / R.volume * 100 : null, da = R.area ? (area - R.area) / R.area * 100 : null;
  const bad = [];
  if (R.solids && S.length < R.solids) bad.push(`solids ${S.length} < ${R.solids}`);
  if (open) bad.push(`${open} open edges`);
  if (inside) bad.push(`${inside} inside out`);
  if (dv !== null && Math.abs(dv) > 1) bad.push(`volume ${dv.toFixed(2)}%`);
  if (da !== null && Math.abs(da) > 1) bad.push(`area ${da.toFixed(2)}%`);
  if (bad.length) fail++;
  rows.push({ file: name, parts: O.length, solids: S.length + '/' + (R.solids ?? '?'), sheets, split, tris: O.reduce((s, o) => s + o.tris, 0), open, inside,
    'vol%': dv === null ? '-' : +dv.toFixed(3), 'area%': da === null ? '-' : +da.toFixed(3), sec: g.s, verdict: bad.length ? 'FAIL ' + bad.join(', ') : 'ok' });
}
console.table(rows);
fs.writeFileSync(path.join(OUT, 'step-bench.json'), JSON.stringify({ rows, ref: [...ref.values()] }, null, 1));
console.log('triangles in all:', rows.reduce((s, r) => s + (r.tris || 0), 0), '  worst volume error %:', Math.max(...rows.map(r => typeof r['vol%'] === 'number' ? Math.abs(r['vol%']) : 0)), '  worst area error %:', Math.max(...rows.map(r => typeof r['area%'] === 'number' ? Math.abs(r['area%']) : 0)));
console.log(fail ? fail + ' of ' + rows.length + ' files failed' : 'ok: all ' + rows.length + ' files'); console.log('details in', path.join(OUT, 'step-bench.json'));
process.exit(fail ? 1 : 0);
