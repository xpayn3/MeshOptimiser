// node tests/brep-after-fill.test.cjs — _brepAfterFill in app.js: Remove holes keeps the CAD faces of a part (a survivor keeps its face, a cap joins
// the face it closes, faces are runs again, the edges along a face that went are dropped). The function is taken out of app.js and run here.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app', 'js', 'app.js'), 'utf8');
const a = src.indexOf('function _brepAfterFill('), b = src.indexOf('// ── B-rep: the CAD faces', a);
let rec = null;
const _Brep = { record: () => rec };
const fn = new Function('_Brep', src.slice(a, b) + '\nreturn _brepAfterFill;')(_Brep);
const pos = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 2,0,0, 2,1,0];
const posAttr = { getX: v => pos[v*3], getY: v => pos[v*3+1], getZ: v => pos[v*3+2] };
// triangles: 0,1 plate A (face 0); 2,3 wall (face 1); 4,5 plate B (face 2)
const index = new Uint32Array([0,1,2, 0,2,3, 1,4,5, 1,5,2, 1,4,5, 1,5,2]);
rec = { tris: 6, faces: [[0,0,2,1], [1,2,2,9,5], [0,4,2,1]], rows: [[0,2,0,0,1], [2,2,0,1,2], [4,2,0,0,2]], pts: new Float32Array(18) };
const res = { removed: new Uint8Array([0,1,1,1,0,0]), caps: new Uint32Array([0,2,3]), capOwner: new Uint32Array([0]) };
const r = fn(null, index, res, null, posAttr);
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };
ok(r && r.parts.length === 1 && r.parts[0].idx.length === 12, 'four triangles come out (one survivor and a cap on A, two on B)');
const f = r.cad.faces;
ok(f[0][1] === 0 && f[0][2] === 2 && f[1][2] === 0 && f[2][1] === 2 && f[2][2] === 2, 'faces are runs again: A 0+2, the wall empty, B 2+2 ' + JSON.stringify(f));
ok(Array.from(r.parts[0].idx.slice(0, 6)).join() === '0,1,2,0,2,3', 'the cap sits with its face, before B');
ok(Math.abs(f[0][3] - 1) < 1e-9, 'face A area measured again (1)');
ok(r.cad.rows.length === 1 && r.cad.rows[0][3] === 0 && r.cad.rows[0][4] === 2, 'the edges along the wall that went are dropped, A-B stays');
rec = { tris: 5, faces: [[0,0,5,1]], rows: [], pts: new Float32Array(0) };
ok(fn(null, index, res, null, posAttr) === null, 'a record for other triangles: null (faces dropped as before)');
// two groups
rec = { tris: 6, faces: [[0,0,2,1], [1,2,2,9,5], [0,4,2,1]], rows: [], pts: new Float32Array(0) };
const r2 = fn(null, index, res, [{ start: 0, count: 6, materialIndex: 0 }, { start: 6, count: 12, materialIndex: 1 }], posAttr);
ok(r2.parts.length === 2 && r2.parts[0].idx.length === 6 && r2.parts[1].idx.length === 6 && r2.cad.faces[2][1] === 2, 'groups are kept, faces follow them');
process.exit(fails ? 1 : 0);
