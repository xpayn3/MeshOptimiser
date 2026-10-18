// node tests/holefill-proof.test.mjs — properties the hole filler must keep, whatever the mesh looks like.
//
// tests/holefill.test.mjs checks what it does on particular shapes. This file checks what must hold on any shape:
//   · a watertight input stays watertight, and no edge gets a third triangle;
//   · a closed through or blind hole gives back exactly the volume of the solid, the caps wind the same way as the face;
//   · the triangles that were not removed are written unchanged, in their order;
//   · filling again finds nothing more;
//   · the same answer whatever the frame: turned, moved far from the origin, scaled by 1e-3 and 1e3, the triangles shuffled,
//     the index a Uint16Array, no index at all (a triangle soup), the vertices welded or one set per triangle, the whole mesh wound
//     inside-out, a doubled triangle, a zero-area stitch;
//   · random plates with random holes (the number closed is the number within the limit; the rest is left as it was);
//   · a hole whose outline has thousands of points is closed in a few seconds, not minutes.
import { fillFlatHoles, applyHoleFill } from '../app/js/holefill.js';

let failed = 0, passed = 0;
const check = (name, cond, extra = '') => { if (cond) passed++; else { failed++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); } };

// ── builders (one set of vertices per triangle, as CAD output) ───────────────────────────────────────────────────────────────
function mesh() {
  const pos = [], idx = [];
  const tri = (a, b, c) => { const n = pos.length / 3; pos.push(...a, ...b, ...c); idx.push(n, n + 1, n + 2); };
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  return { pos, idx, tri, quad, done: () => ({ positions: new Float32Array(pos), index: new Uint32Array(idx) }) };
}
const ring = (n, r, z, cx = 0, cy = 0, phase = 0) => Array.from({ length: n }, (_, i) => { const a = phase + (i / n) * Math.PI * 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a), z]; });
const square = (n, half, z) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), k = half / Math.max(Math.abs(c), Math.abs(s)); return [c * k, s * k, z]; });
function band(m, outer, inner, up) { const n = outer.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (up) m.quad(outer[i], outer[j], inner[j], inner[i]); else m.quad(outer[j], outer[i], inner[i], inner[j]); } }
function disc(m, loop, up) { for (let i = 1; i + 1 < loop.length; i++) up ? m.tri(loop[0], loop[i], loop[i + 1]) : m.tri(loop[0], loop[i + 1], loop[i]); }
function fan(m, loop, centre, up) { const n = loop.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n; up ? m.tri(centre, loop[i], loop[j]) : m.tri(centre, loop[j], loop[i]); } }
function wall(m, top, bot, outward) { const n = top.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (outward) m.quad(bot[i], bot[j], top[j], top[i]); else m.quad(bot[j], bot[i], top[i], top[j]); } }
// a plate (2·HALF)² × TH with holes {x, y, r, kind:'through'|'blind', depth}; every hole has 4k points. The plate is cut into vertical
// strips, one hole each; a strip's outline has k points per side, so neighbouring strips share their border points and the side walls
// follow the outline point by point: no T-junction anywhere.
function plate(holes, HALF = 50, TH = 4, k = 4) {
  const m = mesh(), n = 4 * k;
  const xsorted = holes.map(h => h.x).sort((a, b) => a - b);
  const edges = [-HALF];
  for (let i = 0; i + 1 < xsorted.length; i++) edges.push((xsorted[i] + xsorted[i + 1]) / 2);
  edges.push(HALF);
  const rect = (x0, x1, z) => {          // counter-clockwise from (x1, -HALF): up the right side, left along the top, down the left side, right along the bottom
    const pts = [];
    const yAt = (j) => (j === 0 ? -HALF : j === k ? HALF : -HALF + j * (2 * HALF / k));      // (the corners exact, whatever k)
    const xAt = (i) => (i === 0 ? x0 : i === k ? x1 : x0 + i * (x1 - x0) / k);
    for (let j = 0; j < k; j++) pts.push([x1, yAt(j), z]);
    for (let i = k; i > 0; i--) pts.push([xAt(i), HALF, z]);
    for (let j = k; j > 0; j--) pts.push([x0, yAt(j), z]);
    for (let i = 0; i < k; i++) pts.push([xAt(i), -HALF, z]);
    return pts;
  };
  for (let s = 0; s + 1 < edges.length; s++) {
    const x0 = edges[s], x1 = edges[s + 1];
    const h = holes.find(hh => hh.x >= x0 && hh.x <= x1 && !hh._used);
    if (h) h._used = true;
    const top = rect(x0, x1, TH), bot = rect(x0, x1, 0), mid = [(x0 + x1) / 2, 0];
    if (!h) { fan(m, top, [mid[0], mid[1], TH], true); fan(m, bot, [mid[0], mid[1], 0], false); }
    else {
      const angles = top.map(p => Math.atan2(p[1] - h.y, p[0] - h.x));
      const ringAt = (z) => angles.map(a => [h.x + h.r * Math.cos(a), h.y + h.r * Math.sin(a), z]);
      const topRing = ringAt(TH);
      h._pts = topRing;                 // (what the expectations measure: its widest point and its area)
      band(m, top, topRing, true);
      if (h.kind === 'through') {
        const botRing = ringAt(0);
        band(m, bot, botRing, false);
        wall(m, topRing, botRing, false);
      } else {
        const floorRing = ringAt(TH - h.depth);
        fan(m, bot, [mid[0], mid[1], 0], false);
        wall(m, topRing, floorRing, false);
        disc(m, floorRing, true);
      }
    }
    // the side walls: every outline segment that lies on the plate's rim
    for (let i = 0; i < n; i++) {
      const p = top[i], q = top[(i + 1) % n];
      const onRim = (Math.abs(Math.abs(p[1]) - HALF) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9) || (Math.abs(Math.abs(p[0]) - HALF) < 1e-9 && Math.abs(p[0] - q[0]) < 1e-9);
      if (onRim) m.quad([p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], TH], [p[0], p[1], TH]);
    }
  }
  for (const h of holes) delete h._used;
  return m.done();
}
// a plate with one hole whose outline has n points (round or square), sides following the outline
function plateN(n, r, shape = 'round', HALF = 50, TH = 4) {
  const m = mesh();
  const outT = square(n, HALF, TH), outB = square(n, HALF, 0);
  const inT = shape === 'round' ? ring(n, r, TH) : square(n, r, TH), inB = shape === 'round' ? ring(n, r, 0) : square(n, r, 0);
  band(m, outT, inT, true); band(m, outB, inB, false); wall(m, inT, inB, false); wall(m, outT, outB, true);
  return m.done();
}

// ── measures ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const key = (P, v) => P[v * 3].toFixed(4) + ',' + P[v * 3 + 1].toFixed(4) + ',' + P[v * 3 + 2].toFixed(4);
// directed edges by position: closed and consistently wound when every a→b has one b→a and no a→b twice
function edgeReport(P, I) {
  const dir = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const k = [key(P, I[t]), key(P, I[t + 1]), key(P, I[t + 2])];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;      // a zero-length edge says nothing
    for (let e = 0; e < 3; e++) { const d = k[e] + '>' + k[(e + 1) % 3]; dir.set(d, (dir.get(d) || 0) + 1); }
  }
  let open = 0, doubled = 0, third = 0;
  for (const [d, n] of dir) {
    if (n > 1) doubled++;
    const [a, b] = d.split('>'); const back = dir.get(b + '>' + a) || 0;
    if (!back) open++;
    if (n + back > 2) third++;
  }
  return { open, doubled, third, watertight: open === 0 && doubled === 0 };
}
function volume(P, I) {
  let s = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    s += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) + P[a + 1] * (P[b + 2] * P[c] - P[b] * P[c + 2]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return s / 6;
}
function apply(g, res) {
  if (!res.removed) return g.index;
  const parts = applyHoleFill(g.index, res, null);
  const n = parts.reduce((s, p) => s + p.idx.length, 0), out = new Uint32Array(n); let w = 0;
  for (const p of parts) { out.set(p.idx, w); w += p.idx.length; }
  return out;
}
const fill = (g, maxSize, extra = {}) => fillFlatHoles(g.positions, g.index, { maxSize, ...extra });
const near = (a, b, rel = 1e-6) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b), 1) * rel;
const capCount = (res) => (res.caps ? res.caps.length / 3 : 0);
const polyArea = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return Math.abs(a) / 2; };
const widest = (pts) => { let d2 = 0; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1]; if (dx * dx + dy * dy > d2) d2 = dx * dx + dy * dy; } return Math.sqrt(d2); };

// ── 1. the two reference plates ─────────────────────────────────────────────────────────────────────────────────────────────
const HALF = 50, TH = 4;
const solidVol = (HALF * 2) ** 2 * TH;
const through = plate([{ x: 0, y: 0, r: 5, kind: 'through' }]);
const blind = plate([{ x: 0, y: 0, r: 5, kind: 'blind', depth: 2.5 }]);
{
  for (const [name, g] of [['through', through], ['blind', blind]]) {
    const before = edgeReport(g.positions, g.index);
    check(name + ': the input is watertight', before.watertight, JSON.stringify(before));
    const res = fill(g, 20);
    check(name + ': one hole closed', res.holes === 1, JSON.stringify(res.skipped));
    const out = apply(g, res), after = edgeReport(g.positions, out);
    check(name + ': the result is watertight', after.watertight, JSON.stringify(after));
    check(name + ': no edge got a third triangle', after.third === 0);
    check(name + ': the volume is the solid plate', near(volume(g.positions, out), solidVol, 1e-6), volume(g.positions, out) + ' vs ' + solidVol);
    let k = 0, same = true;
    for (let t = 0; t < g.index.length / 3; t++) { if (res.removed[t]) continue; for (let c = 0; c < 3; c++) if (out[k * 3 + c] !== g.index[t * 3 + c]) same = false; k++; }
    check(name + ': the triangles that stay are written unchanged and in order', same && k * 3 + res.caps.length === out.length);
    let flat = true, wound = true;
    for (let i = 0; i < res.caps.length; i += 3) {
      const a = res.caps[i], b = res.caps[i + 1], c = res.caps[i + 2], P = g.positions;
      const z = P[a * 3 + 2]; if (Math.abs(P[b * 3 + 2] - z) > 1e-6 || Math.abs(P[c * 3 + 2] - z) > 1e-6) flat = false;
      const s = (P[b * 3] - P[a * 3]) * (P[c * 3 + 1] - P[a * 3 + 1]) - (P[c * 3] - P[a * 3]) * (P[b * 3 + 1] - P[a * 3 + 1]);
      if (Math.abs(z - TH) < 1e-6 ? !(s > 0) : !(s < 0)) wound = false;
    }
    check(name + ': the caps are flat in their face and wound with it', flat && wound);
    const again = fillFlatHoles(g.positions, out, { maxSize: 20 });
    check(name + ': filling again finds nothing more', again.holes === 0 && capCount(again) === 0, JSON.stringify({ holes: again.holes, skipped: again.skipped }));
  }
}

// ── 2. the same answer in any frame ─────────────────────────────────────────────────────────────────────────────────────────
function transform(g, fn) { const P = new Float32Array(g.positions.length); for (let i = 0; i < P.length; i += 3) { const [x, y, z] = fn(g.positions[i], g.positions[i + 1], g.positions[i + 2]); P[i] = x; P[i + 1] = y; P[i + 2] = z; } return { positions: P, index: g.index }; }
function rot(x, y, z) {   // a turn about an odd axis
  const a = 0.7, b = 1.1, c = 0.3;
  const y1 = y * Math.cos(a) - z * Math.sin(a), z1 = y * Math.sin(a) + z * Math.cos(a);
  const x2 = x * Math.cos(b) + z1 * Math.sin(b), z2 = -x * Math.sin(b) + z1 * Math.cos(b);
  const x3 = x2 * Math.cos(c) - y1 * Math.sin(c), y3 = x2 * Math.sin(c) + y1 * Math.cos(c);
  return [x3, y3, z2];
}
{
  const frames = [
    ['turned', (x, y, z) => rot(x, y, z), 20, solidVol],
    ['moved 1e5 away', (x, y, z) => [x + 1e5, y - 1e5, z + 1e5], 20, solidVol],
    ['moved 1e4 away', (x, y, z) => [x + 1e4, y - 1e4, z + 1e4], 20, solidVol],
    ['scaled 1e-3', (x, y, z) => [x * 1e-3, y * 1e-3, z * 1e-3], 20e-3, solidVol * 1e-9],
    ['scaled 1e3', (x, y, z) => [x * 1e3, y * 1e3, z * 1e3], 20e3, solidVol * 1e9],
    ['turned and moved', (x, y, z) => { const p = rot(x, y, z); return [p[0] + 3e3, p[1] + 1e3, p[2] - 2e3]; }, 20, solidVol],
  ];
  for (const [name, fn, lim, vol] of frames) for (const [kind, g0] of [['through', through], ['blind', blind]]) {
    const g = transform(g0, fn);
    const res = fill(g, lim);
    const out = apply(g, res), after = edgeReport(g.positions, out);
    const v = volume(g.positions, out);
    check(kind + ' ' + name + ': one hole, watertight, the solid volume', res.holes === 1 && after.watertight && near(v, vol, 1e-3), JSON.stringify({ holes: res.holes, skipped: res.skipped, after, v, vol }));
  }
}
// the index shuffled, a Uint16 index, no index, welded vertices, the whole mesh inside-out, a doubled triangle, a stitch sliver
{
  const g = through;
  const T = g.index.length / 3;
  { const order = [...Array(T).keys()]; let s = 12345; for (let i = T - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const idx = new Uint32Array(T * 3); order.forEach((t, k) => { idx[k * 3] = g.index[t * 3]; idx[k * 3 + 1] = g.index[t * 3 + 1]; idx[k * 3 + 2] = g.index[t * 3 + 2]; });
    const gg = { positions: g.positions, index: idx }; const res = fill(gg, 20); const out = apply(gg, res);
    check('triangles shuffled: same hole, watertight, solid volume', res.holes === 1 && edgeReport(g.positions, out).watertight && near(volume(g.positions, out), solidVol, 1e-6), JSON.stringify(res.skipped)); }
  { const gg = { positions: g.positions, index: Uint16Array.from(g.index) }; const res = fill(gg, 20); const out = apply(gg, res);
    check('Uint16 index: same hole, watertight', res.holes === 1 && edgeReport(g.positions, out).watertight, JSON.stringify(res.skipped)); }
  { const res = fillFlatHoles(g.positions, null, { maxSize: 20 });
    const idx = new Uint32Array(g.positions.length / 3); for (let i = 0; i < idx.length; i++) idx[i] = i;
    const out = apply({ positions: g.positions, index: idx }, res);
    check('no index: same hole, watertight', res.holes === 1 && edgeReport(g.positions, out).watertight, JSON.stringify(res.skipped)); }
  { const map = new Map(), P = [], idx = new Uint32Array(g.index.length);
    for (let i = 0; i < g.index.length; i++) { const v = g.index[i], k = key(g.positions, v); let w = map.get(k); if (w === undefined) { w = P.length / 3; map.set(k, w); P.push(g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]); } idx[i] = w; }
    const gg = { positions: new Float32Array(P), index: idx }; const res = fill(gg, 20); const out = apply(gg, res);
    check('welded vertices: same hole, watertight, solid volume', res.holes === 1 && edgeReport(gg.positions, out).watertight && near(volume(gg.positions, out), solidVol, 1e-6), JSON.stringify(res.skipped)); }
  { const idx = new Uint32Array(g.index.length); for (let t = 0; t < T; t++) { idx[t * 3] = g.index[t * 3]; idx[t * 3 + 1] = g.index[t * 3 + 2]; idx[t * 3 + 2] = g.index[t * 3 + 1]; }
    const gg = { positions: g.positions, index: idx }; const res = fill(gg, 20); const out = apply(gg, res);
    check('inside-out mesh: the hole is still closed, watertight, the solid volume (negative)', res.holes === 1 && edgeReport(g.positions, out).watertight && near(volume(g.positions, out), -solidVol, 1e-6), JSON.stringify({ holes: res.holes, skipped: res.skipped, v: volume(g.positions, out) })); }
  { const idx = new Uint32Array(g.index.length + 3); idx.set(g.index); idx.set(g.index.subarray(0, 3), g.index.length);
    const gg = { positions: g.positions, index: idx }; const res = fill(gg, 20);
    check('a doubled face triangle does not stop the hole', res.holes === 1, JSON.stringify(res.skipped)); }
  { const P = new Float32Array(g.positions.length + 9); P.set(g.positions); const b = g.positions.length / 3;
    P.set([5, 0, TH, 5 * Math.cos(Math.PI / 8), 5 * Math.sin(Math.PI / 8), TH, 5 * Math.cos(Math.PI / 16), 5 * Math.sin(Math.PI / 16), TH], g.positions.length);
    const idx = new Uint32Array(g.index.length + 3); idx.set(g.index); idx.set([b, b + 1, b + 2], g.index.length);
    const gg = { positions: P, index: idx }; const res = fill(gg, 20);
    check('a zero-area stitch on the rim does not stop the hole', res.holes === 1, JSON.stringify(res.skipped)); }
}

// ── 3. a square hole (points on straight runs), the limit as a diameter ─────────────────────────────────────────────────────
{
  const g = plateN(48, 6, 'square');
  check('square hole: the input is watertight', edgeReport(g.positions, g.index).watertight);
  const r = fill(g, 20); const o = apply(g, r);
  check('a square hole with 12 points per side: closed, watertight, the solid volume', r.holes === 1 && edgeReport(g.positions, o).watertight && near(volume(g.positions, o), solidVol, 1e-6), JSON.stringify({ holes: r.holes, skipped: r.skipped, v: volume(g.positions, o) }));
  check('a Ø10 hole is closed with the limit at exactly 10', fill(through, 10).holes === 1);
  check('…and stays with the limit at 9.99 (both of its openings counted)', fill(through, 9.99).holes === 0 && fill(through, 9.99).skipped.tooLarge === 2, JSON.stringify(fill(through, 9.99).skipped));
}

// ── 4. random plates ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  let s = 987654321; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  let runs = 0, bad = 0, note = '';
  for (let it = 0; it < 60 && !bad; it++) {
    const nh = 1 + Math.floor(rnd() * 4), k = 2 + Math.floor(rnd() * 7), n = 4 * k;
    const holes = [];
    const strip = 100 / nh;
    for (let i = 0; i < nh; i++) {
      const r = 2 + rnd() * Math.min(6, strip / 2 - 3);
      holes.push({ x: -50 + strip * (i + 0.5) + (rnd() - 0.5) * (strip / 2 - r - 2), y: (rnd() - 0.5) * (100 - 2 * r - 4), r, kind: rnd() < 0.5 ? 'through' : 'blind', depth: 1 + rnd() * 2.5 });
    }
    const g = plate(holes, HALF, TH, k);
    const before = edgeReport(g.positions, g.index);
    if (!before.watertight) { note = 'builder made an open plate: ' + JSON.stringify({ k, holes, before }); bad++; break; }
    const lim = 4 + rnd() * 14;
    for (const h of holes) h.size = widest(h._pts);
    if (holes.some(h => Math.abs(h.size - lim) < 1e-3)) continue;          // (a size at the limit is its own check, above)
    const within = holes.filter(h => h.size <= lim).length;
    const res = fill(g, lim); const out = apply(g, res); const after = edgeReport(g.positions, out);
    const vExpected = solidVol - holes.filter(h => h.size > lim).reduce((sum, h) => sum + polyArea(h._pts) * (h.kind === 'through' ? TH : h.depth), 0);
    const v = volume(g.positions, out);
    runs++;
    if (res.holes !== within || !after.watertight || !near(v, vExpected, 1e-5)) { bad++; note = JSON.stringify({ it, k, lim, holes, got: res.holes, within, skipped: res.skipped, after, v, vExpected }); }
  }
  check('random plates: the holes within the limit are closed, the others stay, watertight, exact volume (' + runs + ' runs)', !bad, note);
}

// ── 5. a hole outline with thousands of points ──────────────────────────────────────────────────────────────────────────────
for (const n of [600, 3000]) {
  const g = plateN(n, 8, 'round');
  const t0 = performance.now();
  const res = fill(g, 20);
  const dt = performance.now() - t0;
  const out = apply(g, res);
  check('a ' + n + '-point round hole: closed, watertight, the solid volume', res.holes === 1 && edgeReport(g.positions, out).watertight && near(volume(g.positions, out), solidVol, 1e-5), JSON.stringify({ holes: res.holes, skipped: res.skipped }));
  check('…in under 5 s (took ' + (dt / 1000).toFixed(2) + ' s)', dt < 5000);
}

// ── 6. pieces sealed inside (opts.enclosed): a small closed body in the bore of a through hole goes with the fill; one outside stays
{
  const cube = (m, c, h, out = true) => {   // a closed cube of half-size h about c, faces outward
    const [x, y, z] = c, p = (dx, dy, dz) => [x + dx * h, y + dy * h, z + dz * h];
    const q = (a, b, cc, d) => out ? m.quad(a, b, cc, d) : m.quad(d, cc, b, a);
    q(p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1)); q(p(-1, -1, 1), p(-1, 1, 1), p(1, 1, 1), p(1, -1, 1));   // bottom (normal −z), top (+z)
    q(p(-1, -1, -1), p(-1, -1, 1), p(1, -1, 1), p(1, -1, -1)); q(p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1));   // −y, +y
    q(p(-1, -1, -1), p(-1, 1, -1), p(-1, 1, 1), p(-1, -1, 1)); q(p(1, -1, -1), p(1, -1, 1), p(1, 1, 1), p(1, 1, -1));   // −x, +x
  };
  const build = (withInside, withOutside) => {
    const m = mesh(), n = 16;
    const outT = square(n, HALF, TH), outB = square(n, HALF, 0), inT = ring(n, 5, TH), inB = ring(n, 5, 0);
    band(m, outT, inT, true); band(m, outB, inB, false); wall(m, inT, inB, false); wall(m, outT, outB, true);
    if (withInside) cube(m, [0, 0, TH / 2], 1);           // a 2 mm ball-stand-in in the bore: sealed inside once the hole is closed
    if (withOutside) cube(m, [30, 30, 20], 1);            // the same, standing free above the plate: never inside
    return m.done();
  };
  const g = build(true, true);
  const r1 = fill(g, 20, { enclosed: true });
  const o1 = apply(g, r1);
  check('a body sealed in the bore goes with the fill, the free one stays', r1.holes === 1 && r1.enclosed === 1 && o1.length / 3 === g.index.length / 3 - r1.removedTris + capCount(r1) && volume(g.positions, o1) > 0, JSON.stringify({ holes: r1.holes, enclosed: r1.enclosed, removed: r1.removedTris }));
  check('…the plate is still watertight and the free body intact (12 triangles of it remain)', edgeReport(g.positions, o1).watertight && (() => { let n = 0; for (let t = 0; t < o1.length; t += 3) if (g.positions[o1[t] * 3 + 2] > TH + 1) n++; return n === 12; })());
  const r2 = fill(g, 20, { enclosed: false });
  check('without the option both bodies stay', r2.holes === 1 && !r2.enclosed && r2.removedTris === r1.removedTris - 12);
  const r3 = fill(build(true, false), 20, { enclosed: true, through: false });   // the hole is not closed: the body is still open to the outside
  check('a body in an open bore is not "inside": nothing removed', r3.holes === 0 && !r3.enclosed && r3.removedTris === 0, JSON.stringify({ holes: r3.holes, enclosed: r3.enclosed, removed: r3.removedTris }));
  const g4 = build(true, false); g4.index = g4.index.subarray(3);                 // one triangle of the outer wall missing: the shell is open
  const r4 = fill(g4, 20, { enclosed: true });
  check('with the shell open somewhere, no piece is judged inside', !r4.enclosed, JSON.stringify({ holes: r4.holes, enclosed: r4.enclosed }));
}

// ── 7. a depth limit (opts.maxDepth): engraved lettering is a shallow pocket, a bore is not
{
  const g = plate([{ x: 0, y: 0, r: 5, kind: 'blind', depth: 2.5 }]);
  const shallowOnly = fill(g, 20, { maxDepth: 1 });
  check('a 2.5 mm deep pocket is left alone with the depth limit at 1 mm', shallowOnly.holes === 0 && shallowOnly.skipped.tooDeep === 1, JSON.stringify({ holes: shallowOnly.holes, skipped: shallowOnly.skipped }));
  const deeper = fill(g, 20, { maxDepth: 3 });
  check('…and closed with the limit at 3 mm', deeper.holes === 1 && deeper.blind === 1);
  const none = fill(g, 20, { maxDepth: 0 });
  check('…and 0 means no depth limit', none.holes === 1);
  const thr = fill(through, 20, { maxDepth: 1 });
  check('the depth limit does not touch a through hole', thr.holes === 1);
}

console.log(`holefill-proof: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
