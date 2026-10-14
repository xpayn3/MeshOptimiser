// node tests/uvtools.test.mjs — the UV check (uvtools.js) on shapes built here: one square, two islands side by side, islands
// on top of each other, a map outside the 0–1 square, a mirrored island, a collapsed triangle, a stretched strip, an indexed cube
// whose corners are split for their normals (it must still be one island per face, not one per triangle), and a big map's speed.
import { analyseUV, hasUsableUV } from '../uvtools.js';

let failed = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) { failed++; console.log('  FAIL  ' + name + (got !== undefined ? '   got: ' + JSON.stringify(got) : '')); } };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

// a soup of quads: each is [model corners (4 × xyz), uv corners (4 × uv)], two triangles each, no sharing
const soup = (quads) => {
  const P = [], U = [];
  for (const [p, u] of quads) for (const t of [[0, 1, 2], [0, 2, 3]]) for (const k of t) { P.push(...p[k]); U.push(...u[k]); }
  return { positions: new Float32Array(P), uv: new Float32Array(U) };
};
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const plane = (x, y, w, h, z = 0) => [[x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z]];

// ── one square filling the map ────────────────────────────────────────────
{
  const s = soup([[plane(0, 0, 4, 4), sq(0, 0, 1, 1)]]);
  const r = analyseUV(s.positions, s.uv, null);
  check('square: 2 triangles, 1 island', r.triCount === 2 && r.islands === 1, [r.triCount, r.islands]);
  check('square: uses the whole 0–1 square', near(r.used, 1, 0.01), r.used);
  check('square: nothing overlaps, outside, collapsed or flipped', r.overlap === 0 && r.outside === 0 && r.collapsed === 0 && r.flipped === 0, [r.overlap, r.outside, r.collapsed, r.flipped]);
  check('square: density is 0.25 (1 UV over 4 units), even', near(r.density.median, 0.25, 0.005) && r.density.uneven === 0, r.density);
  check('square: the rim is four edges', r.border.length === 4 * 4, r.border.length);
  check('square: bounds', r.bounds.minU === 0 && r.bounds.maxU === 1 && r.bounds.minV === 0 && r.bounds.maxV === 1, r.bounds);
}

// ── two islands side by side, a quarter of the map each ──────────────────
{
  const s = soup([[plane(0, 0, 1, 1), sq(0, 0, 0.5, 0.5)], [plane(2, 0, 1, 1), sq(0.5, 0.5, 1, 1)]]);
  const r = analyseUV(s.positions, s.uv, null);
  check('two islands: counted', r.islands === 2, r.islands);
  check('two islands: half the map used', near(r.used, 0.5, 0.01), r.used);
  check('two islands touching at a corner: no overlap', r.overlap < 0.01, r.overlap);
}

// ── two islands on top of each other ──────────────────────────────────────
{
  const s = soup([[plane(0, 0, 1, 1), sq(0, 0, 1, 1)], [plane(2, 0, 1, 1), sq(0, 0, 1, 1)]]);
  const r = analyseUV(s.positions, s.uv, null);
  check('stacked: 2 islands', r.islands === 2, r.islands);
  check('stacked: all of it overlaps', near(r.overlap, 1, 0.01), r.overlap);
  check('stacked: the cover marks the shared cells as 2', r.cover.includes(2), 0);
}

// ── the same island twice in one island's own triangles does not count as overlap ──
{
  const s = soup([[plane(0, 0, 1, 1), sq(0, 0, 1, 1)]]);
  const r = analyseUV(s.positions, s.uv, null);
  check('one island over itself is not overlap', r.overlap === 0, r.overlap);
}

// ── a map outside the 0–1 square (a second tile) ──────────────────────────
{
  const s = soup([[plane(0, 0, 1, 1), sq(0, 0, 1, 1)], [plane(2, 0, 1, 1), sq(1, 0, 2, 1)]]);
  const r = analyseUV(s.positions, s.uv, null);
  check('second tile: 2 triangles are outside', r.outside === 2, r.outside);
  check('second tile: bounds reach 2', r.bounds.maxU === 2, r.bounds);
  check('second tile: only the first tile is counted as used', near(r.used, 1, 0.01), r.used);
}

// ── a mirrored island ─────────────────────────────────────────────────────
{
  const s = soup([[plane(0, 0, 1, 1), sq(0, 0, 0.3, 0.3)], [plane(2, 0, 1, 1), sq(0.4, 0, 0.7, 0.3)], [plane(4, 0, 1, 1), sq(0.7, 0, 1, 0.3)], [plane(6, 0, 1, 1), sq(0.3, 0.5, 0, 0.8)]]);
  const r = analyseUV(s.positions, s.uv, null);
  check('mirrored: one reversed island of four flips its 2 triangles', r.flipped === 2, r.flipped);
}

// ── a collapsed triangle ──────────────────────────────────────────────────
{
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uv = new Float32Array([0.2, 0.2, 0.4, 0.4, 0.6, 0.6]);       // on one line
  const r = analyseUV(positions, uv, null);
  check('collapsed: a triangle on a line has no UV area', r.collapsed === 1, r.collapsed);
  check('collapsed: it does not break the numbers', Number.isFinite(r.used) && Number.isFinite(r.density.median), [r.used, r.density]);
}

// ── a stretched strip: the middle gets four times the density ─────────────
{
  const quads = [];
  for (let i = 0; i < 20; i++) quads.push([plane(i, 0, 1, 1), i === 10 ? sq(0.5, 0, 0.5 + 0.25, 1) : sq(i / 40, 0, i / 40 + 0.025, 1)]);
  const s = soup(quads);
  const r = analyseUV(s.positions, s.uv, null);
  check('stretched: the one wide quad is "uneven"', r.density.uneven > 0.04 && r.density.uneven < 0.2, r.density.uneven);
}

// ── an indexed cube whose corners are split for their normals ────────────
{
  // six faces, 4 vertices each (24), 12 triangles; every face has its own UV square in a 3 × 2 layout
  const P = [], U = [], I = [];
  const faces = [
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
    [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  ];
  faces.forEach((f, i) => {
    const ox = (i % 3) / 3, oy = Math.floor(i / 3) / 2, base = P.length / 3;
    f.forEach((v, k) => { P.push(...v); U.push(ox + [0, 1, 1, 0][k] / 3, oy + [0, 0, 1, 1][k] / 2); });
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const r = analyseUV(new Float32Array(P), new Float32Array(U), Uint32Array.from(I));
  check('cube: 12 triangles, 6 islands (one per face)', r.triCount === 12 && r.islands === 6, [r.triCount, r.islands]);
  check('cube: the layout fills the map, nothing overlaps', near(r.used, 1, 0.02) && r.overlap === 0, [r.used, r.overlap]);
  check('cube: the model faces all get the same density', r.density.uneven < 0.2, r.density);
}

// ── an indexed grid whose vertices are shared: one island ─────────────────
{
  const N = 30, P = [], U = [], I = [];
  for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) { P.push(x, y, 0); U.push(x / N, y / N); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const a = y * (N + 1) + x, b = a + 1, c = a + N + 1, d = c + 1; I.push(a, b, d, a, d, c); }
  const r = analyseUV(new Float32Array(P), new Float32Array(U), Uint32Array.from(I));
  check('grid: one island', r.islands === 1, r.islands);
  check('grid: the rim is the 4 × 30 outer edges', r.border.length === 4 * 120, r.border.length);
  check('grid: it fills the map', near(r.used, 1, 0.01), r.used);
}

// ── no UVs ────────────────────────────────────────────────────────────────
check('hasUsableUV: missing, all-zero, and real', !hasUsableUV(null, 3) && !hasUsableUV(new Float32Array(6), 3) && hasUsableUV(new Float32Array([0, 0, 1, 0, 0, 1]), 3), 0);

// ── a big map is quick ────────────────────────────────────────────────────
{
  const N = 400, P = [], U = [], I = [];
  for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) { P.push(x, y, Math.sin(x / 9) * 3); U.push(x / N, y / N); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const a = y * (N + 1) + x, b = a + 1, c = a + N + 1, d = c + 1; I.push(a, b, d, a, d, c); }
  const t0 = Date.now(), r = analyseUV(new Float32Array(P), new Float32Array(U), Uint32Array.from(I));
  check('big: 320,000 triangles analysed in under 3 s', r.triCount === 320000 && r.islands === 1 && Date.now() - t0 < 3000, [r.triCount, r.islands, Date.now() - t0 + ' ms']);
}

console.log(failed ? `${failed} of ${n} checks failed` : `all ${n} checks passed`);
process.exit(failed ? 1 : 0);
