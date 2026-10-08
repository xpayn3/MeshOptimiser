// node tests/wirelines.test.mjs — checks wirelines.js.
import { wireIndex } from '../wirelines.js';
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const r = wireIndex(new Uint32Array([0, 1, 2, 2, 1, 3]), 4);
ok(r && r.tris === 2 && r.lines.length === 12, 'two triangles: 12 line indices');
ok(same(r.lines, [0, 1, 1, 2, 2, 0, 2, 1, 1, 3, 3, 2]), 'each triangle gives a-b, b-c, c-a');
ok(r.lines instanceof Uint16Array, 'a small mesh gets 16-bit indices');

const n = wireIndex(null, 6);
ok(n && n.tris === 2 && same(n.lines, [0, 1, 1, 2, 2, 0, 3, 4, 4, 5, 5, 3]), 'a mesh without an index counts vertices in threes');

const big = wireIndex(new Uint32Array([0, 1, 70000]), 70001);
ok(big.lines instanceof Uint32Array && big.lines[5] === 0 && big.lines[3] === 70000, 'past 65,535 vertices: 32-bit indices keep the high numbers');

ok(wireIndex(new Uint32Array(0), 0) === null, 'no triangles: null');
ok(wireIndex(null, 2) === null, 'fewer than three vertices: null');
ok(wireIndex(new Uint32Array([0, 1, 2, 3]), 4).tris === 1, 'a stray index at the end is ignored');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
