// Remove holes on curved surfaces (opts.curved): a thick-walled tube with a round hole drilled through its wall.
import { fillFlatHoles, applyHoleFill } from '../app/js/holefill.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

// A tube, outer radius Ro, inner Ri, length L along z, closed by flat rings at both ends. Quads in (a, k) cells; the cells whose centre
// lies within `holeR` of (angle 0, mid-length) are left out of both skins and joined by a wall.
function tube({ Ro = 20, Ri = 18, L = 60, NA = 96, NK = 30, holeR = 6 } = {}) {
  const pos = [], idx = [];
  const vid = new Map();
  const vert = (layer, a, k) => {
    const key = layer + ',' + (a % NA) + ',' + k;
    let v = vid.get(key);
    if (v === undefined) {
      v = pos.length / 3; vid.set(key, v);
      const R = layer === 0 ? Ro : Ri, th = (a % NA) / NA * Math.PI * 2;
      pos.push(R * Math.cos(th), R * Math.sin(th), k / NK * L);
    }
    return v;
  };
  const inHole = (a, k) => {
    const th = (a + 0.5) / NA * Math.PI * 2, z = (k + 0.5) / NK * L;
    const dth = Math.atan2(Math.sin(th), Math.cos(th));
    return Math.hypot(dth * Ro, z - L / 2) < holeR;
  };
  const quad = (a, b, c, d) => { idx.push(a, b, c, a, c, d); };
  const wall = (a, b, c, d) => quad(d, c, b, a);
  const hole = [];
  for (let a = 0; a < NA; a++) for (let k = 0; k < NK; k++) {
    if (inHole(a, k)) { hole.push([a, k]); continue; }
    quad(vert(0, a, k), vert(0, a + 1, k), vert(0, a + 1, k + 1), vert(0, a, k + 1));               // outer, facing out
    quad(vert(1, a, k), vert(1, a, k + 1), vert(1, a + 1, k + 1), vert(1, a + 1, k));               // inner, facing in
  }
  const has = (a, k) => hole.some(h => h[0] === (a + NA) % NA && h[1] === k);
  for (const [a, k] of hole) {                                                                       // the wall: an edge of a hole cell whose neighbour is not a hole cell
    if (!has(a - 1, k)) wall(vert(0, a, k), vert(0, a, k + 1), vert(1, a, k + 1), vert(1, a, k));
    if (!has(a + 1, k)) wall(vert(0, a + 1, k), vert(1, a + 1, k), vert(1, a + 1, k + 1), vert(0, a + 1, k + 1));
    if (!has(a, k - 1)) wall(vert(0, a, k), vert(1, a, k), vert(1, a + 1, k), vert(0, a + 1, k));
    if (!has(a, k + 1)) wall(vert(0, a, k + 1), vert(0, a + 1, k + 1), vert(1, a + 1, k + 1), vert(1, a, k + 1));
  }
  for (let a = 0; a < NA; a++) {                                                                     // end rings
    quad(vert(0, a, 0), vert(1, a, 0), vert(1, a + 1, 0), vert(0, a + 1, 0));
    quad(vert(0, a, NK), vert(0, a + 1, NK), vert(1, a + 1, NK), vert(1, a, NK));
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

const openEdges = (index) => {
  const m = new Map();
  for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = index[t + e], b = index[t + (e + 1) % 3], k = a < b ? a + ',' + b : b + ',' + a;
    m.set(k, (m.get(k) || 0) + (a < b ? 1 : -1));
  }
  let n = 0; for (const v of m.values()) if (v !== 0) n++;
  return n;
};

const g = tube();
const before = openEdges(g.index);
check('the fixture is watertight', before === 0, 'open edges ' + before);

const flat = fillFlatHoles(g.positions, g.index, { maxSize: 20 });
check('without curved, a hole in a cylinder is left alone', flat.holes === 0, 'holes ' + flat.holes);

const res = fillFlatHoles(g.positions, g.index, { maxSize: 20, curved: true });
check('with curved, the hole through the wall is closed', res.holes === 1 && res.through === 1, JSON.stringify({ holes: res.holes, through: res.through, skipped: res.skipped }));
if (res.holes) {
  const parts = applyHoleFill(g.index, res);
  const out = parts.length ? parts[0].idx : g.index;
  check('and the result is still watertight', openEdges(out) === 0, 'open edges ' + openEdges(out));
}

// with new vertices the patch follows the tube instead of running straight across it
{
  const nv = fillFlatHoles(g.positions, g.index, { maxSize: 20, curved: true, newVertices: true });
  check('with new vertices the hole is closed too', nv.holes === 1 && nv.newPositions && nv.newPositions.length > 0, 'new vertices ' + (nv.newPositions ? nv.newPositions.length / 3 : 0));
  if (nv.newPositions) {
    const V = g.positions.length / 3, pos = new Float32Array(g.positions.length + nv.newPositions.length);
    pos.set(g.positions); pos.set(nv.newPositions, g.positions.length);
    const parts = applyHoleFill(g.index, nv), out = parts[0].idx;
    check('and it is still watertight', openEdges(out) === 0, 'open edges ' + openEdges(out));
    let worst = 0;
    for (let k = 0; k < nv.newPositions.length / 3; k++) {
      const x = nv.newPositions[k * 3], y = nv.newPositions[k * 3 + 1], r = Math.hypot(x, y);
      const onOuter = Math.abs(r - 20) < Math.abs(r - 18);
      worst = Math.max(worst, Math.abs(r - (onOuter ? 20 : 18)));
    }
    check('every new vertex lies on the tube, not on the chord', worst < 0.05, 'worst ' + worst.toFixed(4) + ' mm');
    let maxIdx = 0; for (const v of out) if (v > maxIdx) maxIdx = v;
    check('new vertex numbers follow the mesh', maxIdx < V + nv.newPositions.length / 3, 'max ' + maxIdx + ' of ' + (V + nv.newPositions.length / 3));
    check('each new vertex has a normal and three sources', nv.newNormals.length === nv.newPositions.length && nv.newSrc.length === nv.newPositions.length && nv.newW.length === nv.newPositions.length);
  }
}

// the end of the tube and its outer rim are big openings: never taken for holes
const big = fillFlatHoles(g.positions, g.index, { maxSize: 20, curved: true, minSize: 0 });
check('nothing else is closed', big.holes === 1);

// a flat part is unaffected by the option
const box = (() => {
  const p = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10];
  const i = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7];
  return { positions: new Float32Array(p), index: new Uint32Array(i) };
})();
check('a plain box has no holes with curved on', fillFlatHoles(box.positions, box.index, { maxSize: 20, curved: true }).holes === 0);

// A rounded-corner extrusion (a tank): a flat top that turns into a rounded edge, a hole where the curvature changes. The patch has to
// run on as the surface does, however the profile turns.
{
  const A = 60, B = 40, E = 4, T = 2, NA = 96, NK = 12, L = 200;
  const rim = (a, b, th) => { const c = Math.cos(th), s = Math.sin(th); const k = Math.pow(Math.pow(Math.abs(c) / a, E) + Math.pow(Math.abs(s) / b, E), -1 / E); return [k * c, k * s]; };
  const layerPt = (layer, a, k) => { const [x, y] = rim(layer ? A - T : A, layer ? B - T : B, (a % NA) / NA * Math.PI * 2); return [x, y, k / NK * L]; };
  const pos = [], idx = [], vid = new Map();
  const vert = (layer, a, k) => { const key = layer + ',' + (a % NA) + ',' + k; let v = vid.get(key); if (v === undefined) { v = pos.length / 3; vid.set(key, v); pos.push(...layerPt(layer, a, k)); } return v; };
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  const wall = (a, b, c, d) => quad(d, c, b, a);
  const th0 = 35 / 180 * Math.PI, a0 = Math.round(th0 / (Math.PI * 2) * NA);
  const holeCell = new Set(); for (let da = 0; da < 3; da++) for (let dk = 0; dk < 2; dk++) holeCell.add((a0 + da) + ',' + (5 + dk));
  const isHole = (a, k) => holeCell.has(a + ',' + k);
  for (let a = 0; a < NA; a++) for (let k = 0; k < NK; k++) {
    if (isHole(a, k)) continue;
    quad(vert(0, a, k), vert(0, a + 1, k), vert(0, a + 1, k + 1), vert(0, a, k + 1));
    quad(vert(1, a, k), vert(1, a, k + 1), vert(1, a + 1, k + 1), vert(1, a + 1, k));
  }
  for (const key of holeCell) {
    const [a, k] = key.split(',').map(Number);
    if (!isHole(a - 1, k)) wall(vert(0, a, k), vert(0, a, k + 1), vert(1, a, k + 1), vert(1, a, k));
    if (!isHole(a + 1, k)) wall(vert(0, a + 1, k), vert(1, a + 1, k), vert(1, a + 1, k + 1), vert(0, a + 1, k + 1));
    if (!isHole(a, k - 1)) wall(vert(0, a, k), vert(1, a, k), vert(1, a + 1, k), vert(0, a + 1, k));
    if (!isHole(a, k + 1)) wall(vert(0, a, k + 1), vert(0, a + 1, k + 1), vert(1, a + 1, k + 1), vert(1, a, k + 1));
  }
  for (let a = 0; a < NA; a++) {
    quad(vert(0, a, 0), vert(1, a, 0), vert(1, a + 1, 0), vert(0, a + 1, 0));
    quad(vert(0, a, NK), vert(0, a + 1, NK), vert(1, a + 1, NK), vert(1, a, NK));
  }
  const gp = new Float32Array(pos), gi = new Uint32Array(idx);
  check('the rounded extrusion fixture is watertight', openEdges(gi) === 0, 'open edges ' + openEdges(gi));
  const r = fillFlatHoles(gp, gi, { maxSize: 60, curved: true, newVertices: true });
  console.log('   curvedHoles', r.curvedHoles, 'flat-only', fillFlatHoles(gp, gi, { maxSize: 60 }).holes);
  check('its hole is closed', r.holes === 1, JSON.stringify({ holes: r.holes, sk: r.skipped }));
  if (r.newPositions) {
    // distance of each new vertex from the true outline (the outer or the inner one, whichever it is nearer to)
    const curves = [0, 1].map(l => { const pts = []; for (let i = 0; i < 6000; i++) pts.push(rim(l ? A - T : A, l ? B - T : B, i / 6000 * Math.PI * 2)); return pts; });
    let worst = 0;
    for (let k = 0; k < r.newPositions.length / 3; k++) {
      const x = r.newPositions[k * 3], y = r.newPositions[k * 3 + 1];
      let best = Infinity; for (const pts of curves) for (const q of pts) best = Math.min(best, Math.hypot(q[0] - x, q[1] - y));
      worst = Math.max(worst, best);
    }
    check('the patch follows the profile as it turns', worst < 0.15, 'worst ' + worst.toFixed(3) + ' mm from the true outline, ' + r.newPositions.length / 3 + ' new vertices');
    const out = applyHoleFill(gi, r)[0].idx;
    check('and is watertight', openEdges(out) === 0, 'open edges ' + openEdges(out));
  }
}

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all ok');
