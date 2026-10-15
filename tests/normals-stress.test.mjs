// node tests/normals-stress.test.mjs: Align / Reverse / the normals analysis against shapes that are known to be right,
// then broken in every way a model can be (all inverted, a few faces reversed, half and half, nested shells, open shells,
// non-manifold edges, junk input). Every result is checked by arithmetic, not by eye.
import { repairMesh, analyseNormals } from '../app/js/meshrepair.js';

let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.error('FAIL: ' + msg); } };
let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

// ── shapes (all with their faces pointing OUT, corners counter-clockwise seen from outside)
function sphere(nu, nv, r = 1, c = [0, 0, 0]) {
  const pos = [c[0], c[1], c[2] + r];
  for (let j = 1; j < nv; j++) for (let i = 0; i < nu; i++) { const th = Math.PI * j / nv, ph = 2 * Math.PI * i / nu; pos.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.sin(th) * Math.sin(ph), c[2] + r * Math.cos(th)); }
  const south = pos.length / 3; pos.push(c[0], c[1], c[2] - r);
  const idx = [], at = (j, i) => 1 + (j - 1) * nu + (i % nu);
  for (let i = 0; i < nu; i++) idx.push(0, at(1, i), at(1, i + 1));
  for (let j = 1; j < nv - 1; j++) for (let i = 0; i < nu; i++) { idx.push(at(j, i), at(j + 1, i), at(j + 1, i + 1)); idx.push(at(j, i), at(j + 1, i + 1), at(j, i + 1)); }
  for (let i = 0; i < nu; i++) idx.push(south, at(nv - 1, i + 1), at(nv - 1, i));
  return { position: Float32Array.from(pos), index: Uint32Array.from(idx) };
}
function torus(nu, nv, R = 2, r = 0.7) {
  const pos = [], idx = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const u = 2 * Math.PI * i / nu, v = 2 * Math.PI * j / nv; pos.push((R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)); }
  const at = (i, j) => (i % nu) * nv + (j % nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1)); idx.push(at(i, j), at(i + 1, j + 1), at(i, j + 1)); }
  return { position: Float32Array.from(pos), index: Uint32Array.from(idx) };
}
function box(s = 1, c = [0, 0, 0]) {
  const h = s / 2, p = [];
  for (const z of [-h, h]) for (const y of [-h, h]) for (const x of [-h, h]) p.push(c[0] + x, c[1] + y, c[2] + z);
  const idx = [0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5];
  return { position: Float32Array.from(p), index: Uint32Array.from(idx) };
}
const merge = (...ms) => {
  const pos = [], idx = []; let off = 0;
  for (const m of ms) { pos.push(...m.position); for (const i of m.index) idx.push(i + off); off += m.position.length / 3; }
  return { position: Float32Array.from(pos), index: Uint32Array.from(idx) };
};
const invert = (m) => { const a = m.index.slice(); for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } return { ...m, index: a }; };
const scramble = (m, p) => { const a = m.index.slice(); for (let i = 0; i < a.length; i += 3) if (rnd() < p) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } return { ...m, index: a }; };
const volume = (m) => { let v = 0; const P = m.position, I = m.index; for (let i = 0; i < I.length; i += 3) { const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3; v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) + P[a + 1] * (P[b + 2] * P[c] - P[b] * P[c + 2]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); } return v / 6; };
// every directed edge once, its reverse once (welded vertices): the faces agree
function consistent(m) { const seen = new Set(); const I = m.index; for (let i = 0; i < I.length; i += 3) for (let k = 0; k < 3; k++) { const u = I[i + k], v = I[i + (k + 1) % 3]; if (u === v) continue; const key = u + ',' + v; if (seen.has(key)) return false; seen.add(key); } return true; }
const align = (m, o = {}) => repairMesh({ position: m.position, index: m.index.slice() }, { weld: false, degenerate: false, orient: true, ...o });
const asMesh = (r) => ({ position: r.position, index: r.index });

// ── 1. already right: nothing is touched
for (const [name, m] of [['sphere', sphere(24, 16)], ['torus', torus(32, 16)], ['box', box()]]) {
  const r = align(m); ok(r.stats.flipped === 0, `${name} that is right is left alone (flipped ${r.stats.flipped})`);
  const a = analyseNormals(m); ok(!a.bad && a.wrongFaces === 0 && a.insideOut === 0, `${name} analysis is clean`);
  ok(a.closed === 1 && a.pieces === 1, `${name} is one closed piece`);
}
// ── 2. inverted all over: every face turned, result outward and consistent
for (const [name, m] of [['sphere', sphere(24, 16)], ['torus', torus(32, 16)], ['box', box()]]) {
  const bad = invert(m), a0 = analyseNormals(bad);
  ok(a0.bad && a0.insideOut === 1 && a0.mixed === 0, `${name} inverted is detected as inside-out, not mixed`);
  const r = align(bad); ok(r.stats.flipped === m.index.length / 3, `${name} inverted: all faces turned (${r.stats.flipped})`);
  const o = asMesh(r); ok(volume(o) > 0 && consistent(o), `${name} inverted → outward and consistent`);
  const again = align(o); ok(again.stats.flipped === 0, `${name} align twice: second does nothing`);
  const keep = align(bad, { outward: false }); ok(keep.stats.flipped === 0, `${name} inverted with outward off keeps its side`);
}
// ── 3. random damage at several strengths, many seeds
for (const p of [0.003, 0.05, 0.2, 0.5, 0.8, 0.97]) for (let s = 0; s < 6; s++) {
  for (const [name, m] of [['sphere', sphere(30, 20)], ['torus', torus(40, 20)]]) {
    const broken = scramble(m, p), r = align(broken), o = asMesh(r);
    ok(consistent(o) && volume(o) > 0, `${name} ${p * 100}% flipped (seed ${s}) → consistent and outward`);
    const a = analyseNormals(o); ok(a.wrongFaces === 0 && !a.bad, `${name} ${p * 100}% flipped: analysis clean afterwards`);
    const a0 = analyseNormals(broken);
    ok(p > 0.5 || a0.mixed >= 1 || a0.wrongFaces === 0, `${name} ${p * 100}% flipped is seen as mixed`);
  }
}
// ── 4. several pieces in one mesh, each judged on its own
{
  const m = merge(sphere(16, 12, 1, [0, 0, 0]), invert(sphere(16, 12, 1, [5, 0, 0])), box(1, [0, 5, 0]), invert(box(1, [5, 5, 0])));
  const a0 = analyseNormals(m); ok(a0.pieces === 4 && a0.insideOut === 2, `four pieces, two inside-out (got ${a0.pieces}/${a0.insideOut})`);
  const r = align(m); const o = asMesh(r); ok(consistent(o) && volume(o) > 0, 'four pieces → all outward');
  ok(r.stats.flipped === (16 * 12 * 2 - 16 * 2 + 12), `only the two inverted pieces turned (${r.stats.flipped})`);
}
// ── 5. a hollow part: the cavity wall faces in, and must stay that way
{
  const outer = sphere(24, 16, 3), cavity = invert(sphere(16, 12, 1));
  const m = merge(outer, cavity);
  const r = align(m); ok(r.stats.flipped === 0, `hollow part (cavity facing in) is left alone (turned ${r.stats.flipped})`);
  const a = analyseNormals(m); ok(a.wrongFaces === 0 && !a.bad, 'hollow part analysis is clean');
  const wrongCavity = merge(outer, sphere(16, 12, 1));            // cavity wall facing out: the mistake
  const r2 = align(wrongCavity); ok(r2.stats.flipped === sphere(16, 12, 1).index.length / 3, `cavity facing out is turned in (${r2.stats.flipped})`);
  const both = merge(invert(outer), sphere(16, 12, 1));            // both wrong
  const r3 = align(both); const o3 = asMesh(r3);
  ok(r3.stats.flipped === both.index.length / 3, 'both shells wrong: both turned');
  const twice = align(o3); ok(twice.stats.flipped === 0, 'hollow part: align twice does nothing');
  const three = merge(outer, cavity, sphere(8, 6, 0.4, [0, 0, 0]));   // an island inside the cavity: outward again
  ok(align(three).stats.flipped === 0, 'island inside a cavity faces out and is left alone');
}
// ── 6. open shells
{
  const full = sphere(32, 20); const keepTris = []; const I = full.index;
  for (let i = 0; i < I.length; i += 3) { const z = (full.position[I[i] * 3 + 2] + full.position[I[i + 1] * 3 + 2] + full.position[I[i + 2] * 3 + 2]) / 3; if (z > -0.2) keepTris.push(I[i], I[i + 1], I[i + 2]); }
  const cap = { position: full.position, index: Uint32Array.from(keepTris) };       // a bowl-less dome: open at the bottom
  const r = align(invert(cap)); ok(r.stats.flipped === cap.index.length / 3, `inverted dome is turned outward (${r.stats.flipped} of ${cap.index.length / 3})`);
  ok(align(cap).stats.flipped === 0, 'dome that is right is left alone');
  const sheet = { position: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 2, 0, 0, 2, 1, 0]), index: Uint32Array.from([0, 1, 2, 1, 3, 2, 1, 4, 3, 4, 5, 3]) };
  ok(align(sheet).stats.flipped === 0, 'a flat sheet has no outside and is not turned');
  const half = Uint32Array.from(sheet.index); const t = half[7]; half[7] = half[8]; half[8] = t;
  const r2 = align({ position: sheet.position, index: half }); ok(r2.stats.flipped === 1 || r2.stats.flipped === 3, 'a sheet with one face reversed gets agreeing faces');
  ok(consistent(asMesh(r2)), 'sheet: faces agree afterwards');
}
// ── 7. junk must never throw
{
  const cases = {
    empty: { position: new Float32Array(0), index: new Uint32Array(0) },
    oneTri: { position: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), index: Uint32Array.from([0, 1, 2]) },
    degenerate: { position: Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0]), index: Uint32Array.from([0, 1, 2]) },
    nan: { position: Float32Array.from([NaN, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1]), index: Uint32Array.from([0, 1, 2, 1, 2, 3]) },
    inf: { position: Float32Array.from([Infinity, 0, 0, 1, 0, 0, 0, 1, 0]), index: Uint32Array.from([0, 1, 2]) },
    nonManifold: { position: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1]), index: Uint32Array.from([0, 1, 2, 0, 1, 3, 0, 1, 4, 0, 1, 5]) },
    doubled: (() => { const b = box(); return { position: b.position, index: Uint32Array.from([...b.index, ...b.index]) }; })(),
    doubledOpposite: (() => { const b = box(); return { position: b.position, index: Uint32Array.from([...b.index, ...invert(b).index]) }; })(),
    nonIndexed: { position: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0]), index: null },
    hugeCoords: (() => { const b = box(1e9, [5e9, 0, 0]); return b; })(),
    tiny: (() => { const b = box(1e-6); return b; })(),
    farFromOrigin: (() => { const b = sphere(16, 12, 1, [1e6, -1e6, 1e6]); return invert(b); })(),
  };
  for (const [name, m] of Object.entries(cases)) {
    let ok1 = true, res = null;
    try { res = repairMesh({ position: m.position, index: m.index ? m.index.slice() : null }, { weld: true, degenerate: true, orient: true }); analyseNormals(m); } catch (e) { ok1 = false; console.error(name, e); }
    ok(ok1, `${name} does not throw`);
    if (res && res.index) ok(res.index.every(i => i < res.position.length / 3), `${name} output indices are valid`);
  }
  const far = cases.farFromOrigin; const rf = align(far); ok(volume(asMesh(rf)) < 0 ? false : true, 'a sphere far from the origin is judged by its own middle');
  ok(rf.stats.flipped === far.index.length / 3, 'far from the origin: inverted sphere turned');
  const nm = analyseNormals(cases.nonManifold); ok(nm.nonManifold >= 1, 'a fin of four triangles on one edge is called non-manifold');
  const dop = analyseNormals(cases.doubledOpposite); ok(dop.pieces >= 1, 'a doubled box with opposite faces is analysed');
}
// ── 8. weld: a mesh with split vertices (flat shaded) is joined before the faces are compared
{
  const m = sphere(20, 14), I = m.index, P = [], idx = [];
  for (let i = 0; i < I.length; i++) { P.push(m.position[I[i] * 3], m.position[I[i] * 3 + 1], m.position[I[i] * 3 + 2]); idx.push(i); }
  const flat = { position: Float32Array.from(P), index: Uint32Array.from(idx) };
  const a = analyseNormals(invert(flat)); ok(a.pieces === 1 && a.insideOut === 1, 'split vertices: one piece, inside-out');
  const r = repairMesh({ position: invert(flat).position, index: invert(flat).index.slice() }, { weld: true, degenerate: false, orient: true });
  ok(r.stats.flipped === I.length / 3 && volume(asMesh(r)) > 0 && consistent(asMesh(r)), 'split vertices: joined, turned outward');
}
// ── 9. shading normals opposite to the faces
{
  const m = sphere(16, 12), n = new Float32Array(m.position.length);
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(m.position[i], m.position[i + 1], m.position[i + 2]) || 1; n[i] = -m.position[i] / l; n[i + 1] = -m.position[i + 1] / l; n[i + 2] = -m.position[i + 2] / l; }
  const a = analyseNormals({ ...m, normal: n }); ok(a.shadingFlipped > a.tris * 0.9 && a.bad, 'normals pointing in are reported');
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  ok(analyseNormals({ ...m, normal: n }).shadingFlipped === 0, 'normals pointing out are fine');
}
// ── 10. size and speed
{
  const t0 = performance.now();
  const big = scramble(sphere(1000, 500), 0.3);
  const tris = big.index.length / 3;
  const t1 = performance.now();
  const a = analyseNormals(big); const t2 = performance.now();
  const r = align(big); const t3 = performance.now();
  ok(consistent(asMesh(r)) && volume(asMesh(r)) > 0, `${(tris / 1e6).toFixed(2)}M triangles, 30% flipped → consistent and outward`);
  ok(a.mixed === 1 && a.wrongFaces > 0, 'the big mesh is reported mixed');
  console.log(`  ${(tris / 1e6).toFixed(2)}M tris: build ${(t1 - t0) | 0} ms, analyse ${(t2 - t1) | 0} ms, align ${(t3 - t2) | 0} ms`);
  ok(t3 - t2 < 20000, 'align on a million triangles takes under 20 s');
  // a model with 300 small pieces (an assembly in one mesh)
  const parts = []; for (let i = 0; i < 300; i++) { const s = sphere(10, 8, 0.4, [(i % 20) * 2, ((i / 20) | 0) * 2, 0]); parts.push(rnd() < 0.5 ? invert(s) : s); }
  const asm = merge(...parts), t4 = performance.now();
  const ra = align(asm); ok(consistent(asMesh(ra)) && volume(asMesh(ra)) > 0, '300 pieces, half inverted → all outward');
  console.log(`  300 pieces: ${(performance.now() - t4) | 0} ms`);
}
// ── 11. the same mesh many times: nothing drifts
{
  let m = scramble(sphere(24, 16), 0.4);
  for (let i = 0; i < 25; i++) { const r = align(m); m = asMesh(r); if (i > 0) ok(r.stats.flipped === 0, `pass ${i + 1} turns nothing`); }
}

console.log(`normals stress: ${checks - fails}/${checks} checks pass`);
process.exit(fails ? 1 : 0);
