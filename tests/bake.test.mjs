// node tests/bake.test.mjs
//
// The layout under Texture baking (bake.js): a box (six charts, 90° apart), a UV sphere (round: more charts, none folded over), and
// both in one picture. Each must come out with every UV inside the square, no texel claimed by two triangles, every old vertex still
// there for the attributes to be copied from, one density for all parts, and the pieces of a big part larger than those of a small one.
import { unwrapParts, rasterise, dilate, packIslands } from '../app/js/bake.js';

let fails = 0;
const ok = (c, msg, extra) => { if (!c) { fails++; console.log('FAIL', msg, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', msg); };

function box(s) {
  const P = [], I = [];
  const faces = [[[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]]];
  for (const [n, u, v] of faces) {
    const b = P.length / 3;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (let k = 0; k < 3; k++) P.push(s * (n[k] + a * u[k] + c * v[k]) / 2);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { P: Float32Array.from(P), I: Uint32Array.from(I), scale: 1 };
}
function sphere(r, nu, nv) {
  const P = [], I = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const a = 2 * Math.PI * i / nu, b = Math.PI * j / nv;
    P.push(r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a));
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + nu + 1;
    if (j > 0) I.push(a, a + 1, b);                  // (no zero-area triangle at a pole: the layout leaves those out)
    if (j < nv - 1) I.push(a + 1, b + 1, b);
  }
  return { P: Float32Array.from(P), I: Uint32Array.from(I), scale: 1 };
}

function check(name, parts, size) {
  const r = unwrapParts(parts, { size, pad: 3 });
  ok(r.parts.every(Boolean), name + ': every part has a layout', r.why);
  let inside = true, claims = 0, twice = 0, vertsKept = true, uvOk = true;
  const owner = new Int32Array(size * size).fill(-1);
  const inside2 = new Uint8Array(size * size);
  r.parts.forEach((o, pi) => {
    for (const u of o.uv) if (!(u >= 0 && u <= 1)) inside = false;
    if (!Number.isFinite(o.uv[0])) uvOk = false;
    const have = new Set(o.vertexSrc), nOld = parts[pi].P.length / 3;
    const used = new Set(parts[pi].I);
    for (const v of used) if (!have.has(v)) vertsKept = false;
    if (o.index.length !== parts[pi].I.length) vertsKept = false;
    // (a texel on the edge two triangles share is read by both: harmless, both find the same point; only a texel well inside two is an overlap)
    rasterise(o.uv, o.index, size, (x, y, t, w0, w1, w2) => {
      const k = y * size + x, id = pi * 1e6 + t, inner = Math.min(w0, w1, w2) > 1e-3;
      if (owner[k] >= 0 && owner[k] !== id) { if (inner && inside2[k]) twice++; } else { owner[k] = id; claims++; }
      if (inner) inside2[k] = 1;
    });
    // the triangles keep the vertices they had (in another order: a chart's triangles go together)
    const tri = (idx, src) => { const out = []; for (let t = 0; t < idx.length; t += 3) out.push([0, 1, 2].map(c => src ? src[idx[t + c]] : idx[t + c]).sort((p, q) => p - q).join('-')); return out.sort(); };
    const A = tri(o.index, o.vertexSrc), B = tri(parts[pi].I, null);
    if (A.join() !== B.join()) vertsKept = false;
  });
  ok(inside, name + ': every UV is inside the square');
  ok(uvOk, name + ': no UV is NaN');
  ok(vertsKept, name + ': the triangles still use the vertices they had');
  ok(twice <= claims * 0.002, name + ': (almost) no texel is claimed by two triangles', { twice, claims });
  ok(r.used > 0.2 && r.used <= 1, name + ': the picture is filled to ' + (r.used * 100).toFixed(0) + ' %');
  return r;
}

const a = check('a box', [box(10)], 256);
ok(a.charts === 6, 'a box is cut into its six faces', a.charts);
const s = check('a sphere', [sphere(10, 24, 16)], 512);
ok(s.charts > 1 && s.charts < 120, 'a sphere is cut into a handful of charts, not one per triangle', s.charts);
const both = check('a big box and a small one', [box(40), box(10)], 512);
// one density: the big box's faces are four times as wide in the picture as the small box's
const w = (o) => { let u0 = 1, u1 = 0; for (let i = 0; i < o.uv.length; i += 2) { u0 = Math.min(u0, o.uv[i]); u1 = Math.max(u1, o.uv[i]); } return u1 - u0; };
const d = (o, n) => { const t = 6; let m = 0; for (let k = 0; k < 6; k++) { let u0 = 9, u1 = -9; for (let i = 0; i < 4; i++) { const u = o.uv[2 * (4 * k + i)]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); } m = Math.max(m, u1 - u0); } return m; };
const wBig = d(both.parts[0]), wSmall = d(both.parts[1]);
ok(Math.abs(wBig / wSmall - 4) < 0.35, 'one density for both parts: the big face is 4 times the small one', { wBig, wSmall });
ok(w(both.parts[0]) > 0, 'sanity');

// a scale in the part's units: the same box in metres (scale 1000) lays out like the one in mm
const m = unwrapParts([{ ...box(0.01), scale: 1000 }], { size: 256, pad: 3 });
ok(Math.abs(m.density - a.density) / a.density < 0.05, 'a part in metres packs like the same part in millimetres', { m: m.density, a: a.density });

// packing islands that already have a size (the UV layout's Pack)
{
  const boxes = [{ w: 0.9, h: 0.2 }, { w: 0.3, h: 0.3 }, { w: 0.5, h: 0.1 }, { w: 0.05, h: 0.6 }, { w: 0.4, h: 0.4 }];
  const r = packIslands(boxes, { margin: 0.004 });
  ok(!!r && r.scale > 0, 'packIslands finds a scale for five boxes', r && r.scale);
  let fits = true, lap = 0;
  const rect = (i) => [r.at[i][0], r.at[i][1], r.at[i][0] + boxes[i].w * r.scale, r.at[i][1] + boxes[i].h * r.scale];
  for (let i = 0; i < boxes.length; i++) {
    const a = rect(i); if (a[0] < -1e-9 || a[1] < -1e-9 || a[2] > 1 + 1e-9 || a[3] > 1 + 1e-9) fits = false;
    for (let j = i + 1; j < boxes.length; j++) { const b = rect(j); if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) lap++; }
  }
  ok(fits, 'every packed box lies inside the square');
  ok(lap === 0, 'no two packed boxes lie on each other', lap);
  ok(packIslands([]) === null, 'no boxes: nothing to pack');
}

// the edge growing
{
  const size = 16, mask = new Uint8Array(size * size), val = new Float32Array(size * size);
  mask[8 * size + 8] = 1; val[8 * size + 8] = 5;
  const n = dilate(mask, size, 3, (to, from) => { val[to] = val[from]; });
  ok(n === 24 + 0 || n > 10, 'dilate grows the covered texels outwards', n);
  ok(val[8 * size + 10] === 5 && val[8 * size + 12] === 0, 'it reaches 3 rings out, not 4 (a ring is a step along an axis)', [val[8 * size + 10], val[8 * size + 12]]);
}

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
