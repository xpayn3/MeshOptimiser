// node tests/decimate-align.test.mjs — Decimate and Quick remesh (B) reduce the same way.
//
// Source-level (the app needs a browser): both send the worker the same message shape (the shared simplifier, the sharp-edge lock,
// the smart payload from one builder), both hold a result against the same shape guard, and the Smart switch is one control.
import fs from 'fs';

const src = fs.readFileSync(new URL('../app/js/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL  ' + msg); } };
const count = (re) => (src.match(re) || []).length;

ok(/function _smartPayload\(geom, threeUrl\)/.test(src) && /function _shapeOf\(g\)/.test(src) && /const _keepsShape = \(before, after\) =>/.test(src), 'the shared helpers exist');
ok(count(/op: 'simplify', positions, index, groups, keep, tol: (?:0|tolFor\(p, FIRST_PASS\)), url: [^,]+, attrs, sharp: \(_sharpOpts\(\) \|\| \{\}\)\.sharp \|\| 0, \.\.\.sp \}/g) === 2, 'Decimate and Quick remesh send the same simplify message, with the smart payload spread in');
ok(count(/const sp = _smartPayload\((geom|src), /g) === 2, 'both take the payload from _smartPayload');
ok(count(/_keepsShape\(/g) >= 3, 'both hold the result against _keepsShape (Decimate twice: the loop and the final test; Quick remesh once)');
ok(!/function shapeOf\(g\)/.test(src), "Quick remesh's own shapeOf is gone");
ok(/skipped\.push\(p\.name \+ ' \(would lose its shape\)'\)/.test(src), 'Decimate leaves a part alone when no gentler share keeps its shape');
ok(/const _smartOn = \(\) => \{ const el = \$\('decimate-smart'\); return \(!el \|\| el\.checked\) && !window\.__moQuickPlain; \};/.test(src), 'one Smart switch, on by default, __moQuickPlain still honoured');
ok(/id="decimate-smart" checked/.test(html) && /id="decimate-smart-lbl"/.test(html), 'the Smart switch is on the Decimate card');
ok(/stepopt-decimate-smart/.test(src), 'the switch is remembered');

if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('decimate-align: all checks passed');
