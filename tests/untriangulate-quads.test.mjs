// node tests/untriangulate-quads.test.mjs — pairIntoQuads (untriangulate.js): triangles paired back into quads on curved surfaces,
// never across a UV seam, a CAD face boundary, a sharp fold or a triangle that is turned over; no point moves, no triangle goes.
import { pairIntoQuads } from '../app/js/untriangulate.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// a quad grid on a cube projected onto a sphere (curved everywhere), n × n cells a side, each cell cut along a diagonal that
// alternates (as a triangulator leaves it); shared vertices within a side, the sides' edges split as an exported mesh has them
function sphereCube(n) {
  const pos = [], idx = [], uv = [];
  const sides = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
  for (const [ia, ib, ic, s] of sides) {
    const base = pos.length / 3;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const p = [0, 0, 0]; p[ia] = (i / n) * 2 - 1; p[ib] = ((j / n) * 2 - 1) * s; p[ic] = s;
      const l = Math.hypot(...p); pos.push(p[0] / l, p[1] / l, p[2] / l); uv.push(i / n, j / n);
    }
    const at = (i, j) => base + j * (n + 1) + i;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      if ((i + j) % 2) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), uv: new Float32Array(uv) };
}
const quadsOf = (r) => { const c = new Map(); for (const p of r.poly) c.set(p, (c.get(p) || 0) + 1); let q = 0; for (const v of c.values()) if (v === 2) q++; return q; };

{
  const m = sphereCube(6), T = m.idx.length / 3;
  const r = pairIntoQuads(m.pos, m.idx, {});
  ok(r && r.stats.quads === T / 2 && quadsOf(r) === T / 2, 'a triangulated quad sphere gets every one of its ' + T / 2 + ' quads back (' + (r && r.stats.quads) + ')');
  ok(r && r.index.length === m.idx.length && r.index.every((v, i) => v === m.idx[i]), 'the triangles are the same, in the same order (no point moves, none goes)');
  // every quad is a cell of the grid: its two triangles share a diagonal of that cell (four distinct corners)
  let cells = true;
  const by = new Map(); r.poly.forEach((p, t) => { if (!by.has(p)) by.set(p, []); by.get(p).push(t); });
  for (const ts of by.values()) { if (ts.length !== 2) continue; const s = new Set(); for (const t of ts) for (let k = 0; k < 3; k++) s.add(m.idx[t * 3 + k]); if (s.size !== 4) cells = false; }
  ok(cells, 'each quad has four corners');
  const ru = pairIntoQuads(m.pos, m.idx, { uvs: m.uv });
  ok(ru.stats.quads === T / 2, 'UVs that run on across the cells do not stop it (the sides of the cube meet at seams, along cell edges)');
}

{ // a UV seam along one cell's diagonal: the second triangle gets corners of its own there, with other UVs
  const m = sphereCube(4), T = m.idx.length / 3;
  const pos = Array.from(m.pos), uv = Array.from(m.uv), idx = Array.from(m.idx);
  const t2 = 1;                                                    // the second triangle of the first cell
  const t1 = 0, sh = [0, 1, 2].map(k => idx[t1 * 3 + k]).filter(v => [0, 1, 2].some(j => idx[t2 * 3 + j] === v));
  for (let k = 0; k < 3; k++) {
    const v = idx[t2 * 3 + k];
    if (!sh.includes(v)) continue;
    const nv = pos.length / 3; pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); uv.push(uv[v * 2] + 0.5, uv[v * 2 + 1]); idx[t2 * 3 + k] = nv;
  }
  const r = pairIntoQuads(new Float32Array(pos), new Uint32Array(idx), { uvs: new Float32Array(uv) });
  ok(r.poly[t1] !== r.poly[t2] && r.stats.seams >= 1, 'two triangles are not paired across a UV seam');
  const rn = pairIntoQuads(new Float32Array(pos), new Uint32Array(idx), {});
  ok(rn.poly[t1] === rn.poly[t2], 'the same split points without UVs are one place, and the cell is a quad');
  ok(r.stats.quads >= T / 2 - 2, 'the rest of the sphere still pairs (' + r.stats.quads + ' of ' + T / 2 + ')');
}

{ // a CAD face boundary between the two halves of a cell
  const m = sphereCube(4), T = m.idx.length / 3;
  const face = new Int32Array(T).fill(0); face[1] = 1;
  const r = pairIntoQuads(m.pos, m.idx, { face });
  ok(r.poly[0] !== r.poly[1] && r.stats.faces >= 1, 'not across a CAD face boundary');
}

{ // two triangles folded apart: a right angle is over the 40° limit; with the limit at 95° they pair
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1]);
  const flat = pairIntoQuads(pos, new Uint32Array([0, 1, 2, 0, 2, 3]), {});
  ok(flat.stats.quads === 1, 'a flat square is one quad');
  const fold = new Uint32Array([0, 1, 3, 1, 0, 4]);                // sharing 0-1, one in z = 0, one in y = 0
  // (the second one: 1, 0, 4 is the side x-z, folded 90° from the first)
  const r = pairIntoQuads(pos, fold, {});
  ok(r.stats.quads === 0, 'two triangles folded 90° apart are not paired at 40°');
  const turned = pairIntoQuads(pos, new Uint32Array([0, 1, 2, 0, 3, 2]), {});
  ok(turned.stats.quads === 0, 'a neighbour that is turned over (runs the edge the same way) is not paired');
  // a long thin pair, far from square
  const thin = pairIntoQuads(new Float32Array([0, 0, 0, 10, 0, 0, 11, 1, 0, 1, 1, 0]), new Uint32Array([0, 1, 2, 0, 2, 3]), {});
  ok(thin.stats.quads === 0, 'a slanted sliver pair whose corners are far from square is not a quad');
  const loose = pairIntoQuads(new Float32Array([0, 0, 0, 10, 0, 0, 11, 1, 0, 1, 1, 0]), new Uint32Array([0, 1, 2, 0, 2, 3]), { shapeDeg: 50 });
  ok(loose.stats.quads === 1, 'with the corner limit raised it is one');
}

{ // greedy, best first: a strip of three squares cut into six triangles pairs into the three squares, not across them
  const pos = [], idx = [];
  for (let i = 0; i <= 3; i++) pos.push(i, 0, 0, i, 1, 0);
  for (let i = 0; i < 3; i++) { const a = i * 2, b = a + 2, c = a + 3, d = a + 1; idx.push(a, b, c, a, c, d); }
  const r = pairIntoQuads(new Float32Array(pos), new Uint32Array(idx), {});
  ok(r.stats.quads === 3 && r.poly[0] === r.poly[1] && r.poly[2] === r.poly[3] && r.poly[4] === r.poly[5], 'a strip of squares pairs into its squares');
}

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
