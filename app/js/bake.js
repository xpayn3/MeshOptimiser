// Texture baking, the parts that need no three.js: laying parts out flat (UVs) in one shared square, and walking the texels of that
// layout. The Bake card (bake-card.js) holds the rest: it reduces the parts, asks this file for a layout, reads the colour of the
// original surface under every texel and writes the picture.
//
//   unwrapParts(parts, { size, pad, maxAngle })
//     parts: [{ P: Float32Array positions, I: Uint32Array index, scale: mm per unit of P }]
//     A part is cut into charts: groups of triangles that turn away from each other by less than maxAngle (60° by default), found by
//     growing from the largest triangle and across edges that share a position (a UV seam, or a split vertex, does not stop it).
//     Each chart is laid flat along its mean normal, turned to the position that wastes the least room, and all charts of all parts are
//     scaled by ONE density (texels per mm) and shelf-packed into the square, with pad texels round each chart so the picture can bleed
//     past its edge. The density is the largest one that fits, so a big part gets more of the picture than a small one, as it should.
//     Returns, per part, { vertexSrc, index, uv }: the new vertex list as indices into the old one (a vertex on a chart border is
//     there once for each chart it belongs to, so every attribute the part had is copied by vertexSrc), the new index and the UVs
//     (V held from the top, as the app and glTF hold it), plus { density, used, charts } for the whole layout.
//
//   rasterise(uv, index, size, fn): calls fn(x, y, tri, w0, w1, w2) for each texel whose centre lies in a triangle of the layout.
//   dilate(mask, size, rings, fn): grows the covered texels outwards, ring by ring; fn(to, from) is told what copies what.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── 1. charts of one part ───────────────────────────────────────────────────
function chartsOf(P, I, maxAngle) {
  const nT = I.length / 3, nV = P.length / 3;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const q = (Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1) * 1e-6;
  // vertices at the same place are one (a chart goes on across a split vertex)
  const weldOf = new Int32Array(nV), seen = new Map();
  for (let v = 0; v < nV; v++) {
    const key = Math.round(P[3 * v] / q) + ',' + Math.round(P[3 * v + 1] / q) + ',' + Math.round(P[3 * v + 2] / q);
    let w = seen.get(key); if (w === undefined) { w = v; seen.set(key, w); }
    weldOf[v] = w;
  }
  const N = new Float64Array(nT * 3), A = new Float64Array(nT), live = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const n = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l > 0) { N[3 * t] = n[0] / l; N[3 * t + 1] = n[1] / l; N[3 * t + 2] = n[2] / l; A[t] = l / 2; live[t] = 1; }
  }
  // triangles that share an edge
  const edge = new Map(), nb = Array.from({ length: nT }, () => []);
  for (let t = 0; t < nT; t++) {
    if (!live[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = weldOf[I[3 * t + k]], b = weldOf[I[3 * t + (k + 1) % 3]];
      if (a === b) continue;
      const key = a < b ? a * nV + b : b * nV + a, list = edge.get(key);
      if (list) { for (const u of list) { nb[t].push(u); nb[u].push(t); } list.push(t); } else edge.set(key, [t]);
    }
  }
  const maxCos = Math.cos(maxAngle), minCos = Math.cos(Math.min(maxAngle * 1.4, 1.2));
  const chartOf = new Int32Array(nT).fill(-1), charts = [];
  const pending = []; for (let t = 0; t < nT; t++) if (live[t]) pending.push(t);
  pending.sort((x, y) => A[x] - A[y]);                                   // (popped from the end: the largest first)
  while (pending.length) {
    const seed = pending.pop();
    if (chartOf[seed] >= 0) continue;
    const id = charts.length, list = [seed], S = [N[3 * seed] * A[seed], N[3 * seed + 1] * A[seed], N[3 * seed + 2] * A[seed]];
    chartOf[seed] = id;
    for (let h = 0; h < list.length; h++) {
      const t = list[h];
      for (const u of nb[t]) {
        if (chartOf[u] >= 0) continue;
        const m = unit(S);
        if (N[3 * u] * m[0] + N[3 * u + 1] * m[1] + N[3 * u + 2] * m[2] < maxCos) continue;
        chartOf[u] = id; list.push(u); S[0] += N[3 * u] * A[u]; S[1] += N[3 * u + 1] * A[u]; S[2] += N[3 * u + 2] * A[u];
      }
    }
    // the mean moved while it grew: whatever now turns too far from it goes back to be a chart of its own
    const m = unit(S), kept = [];
    for (const t of list) {
      if (t === seed || N[3 * t] * m[0] + N[3 * t + 1] * m[1] + N[3 * t + 2] * m[2] >= minCos) kept.push(t);
      else { chartOf[t] = -1; pending.push(t); }
    }
    charts.push({ tris: kept, normal: m });
  }
  return charts;
}

// ── 2. a chart laid flat ────────────────────────────────────────────────────
// {x, y} per vertex of the chart in the part's units times scale (so: mm), moved so that its box starts at 0, 0.
function flatten(P, I, ch, scale) {
  const n = ch.normal, ref = Math.abs(n[0]) < 0.6 ? [1, 0, 0] : Math.abs(n[1]) < 0.6 ? [0, 1, 0] : [0, 0, 1];
  const t1 = unit(cross(n, ref)), t2 = cross(n, t1);
  const loc = new Map(), src = [], xy = [];
  const corner = [];
  for (const t of ch.tris) for (let k = 0; k < 3; k++) {
    const v = I[3 * t + k];
    let l = loc.get(v);
    if (l === undefined) {
      l = src.length; loc.set(v, l); src.push(v);
      const p = [P[3 * v] * scale, P[3 * v + 1] * scale, P[3 * v + 2] * scale];
      xy.push(dot(p, t1), dot(p, t2));
    }
    corner.push(l);
  }
  // turned to the angle whose box is the smallest (a long thin chart then packs as a long thin box)
  let best = 0, bestA = Infinity;
  const nPts = src.length;
  for (let deg = 0; deg < 90; deg += 5) {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < nPts; i++) { const x = xy[2 * i] * c - xy[2 * i + 1] * s, y = xy[2 * i] * s + xy[2 * i + 1] * c; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const a = (x1 - x0) * (y1 - y0);
    if (a < bestA - 1e-12) { bestA = a; best = deg; }
  }
  const c = Math.cos(best * Math.PI / 180), s = Math.sin(best * Math.PI / 180);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < nPts; i++) {
    const x = xy[2 * i] * c - xy[2 * i + 1] * s, y = xy[2 * i] * s + xy[2 * i + 1] * c;
    xy[2 * i] = x; xy[2 * i + 1] = y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  for (let i = 0; i < nPts; i++) { xy[2 * i] -= x0; xy[2 * i + 1] -= y0; }
  return { tris: ch.tris, src, xy, corner, w: Math.max(x1 - x0, 1e-9), h: Math.max(y1 - y0, 1e-9) };
}

// ── 3. packing: shelves, tallest first ──────────────────────────────────────
function shelves(boxes, size) {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b][1] - boxes[a][1]);
  const at = new Array(boxes.length);
  let x = 0, y = 0, rowH = 0;
  for (const i of order) {
    const [w, h] = boxes[i];
    if (w > size || h > size) return null;
    if (x + w > size) { y += rowH; x = 0; rowH = 0; }
    if (y + h > size) return null;
    at[i] = [x, y]; x += w; if (h > rowH) rowH = h;
  }
  return at;
}

export function unwrapParts(parts, opts = {}) {
  const size = opts.size || 1024, pad = opts.pad == null ? 4 : opts.pad, maxAngle = (opts.maxAngle || 60) * Math.PI / 180;
  const flat = [];
  parts.forEach((pt, pi) => {
    for (const ch of chartsOf(pt.P, pt.I, maxAngle)) { const f = flatten(pt.P, pt.I, ch, pt.scale || 1); f.pi = pi; flat.push(f); }
  });
  if (!flat.length) return { parts: parts.map(() => null), density: 0, used: 0, charts: 0 };
  let areaSum = 0; for (const f of flat) areaSum += f.w * f.h;
  const boxesAt = (d) => flat.map(f => [Math.ceil(f.w * d) + 2 * pad + 1, Math.ceil(f.h * d) + 2 * pad + 1]);
  // the largest density (texels per mm) at which everything fits
  let lo = 0, hi = Math.sqrt((size * size) / areaSum) * 1.05, got = null;
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2, at = shelves(boxesAt(mid), size);
    if (at) { lo = mid; got = at; } else hi = mid;
  }
  if (!got) return { parts: parts.map(() => null), density: 0, used: 0, charts: flat.length, why: 'the pieces do not fit the picture even at the smallest size' };
  const d = lo, boxes = boxesAt(d);
  // the parts, rebuilt: one vertex for each (old vertex, chart)
  const out = parts.map(() => ({ src: [], uv: [], idx: [] }));
  let usedTex = 0;
  flat.forEach((f, ci) => {
    const o = out[f.pi], base = o.src.length, [bx, by] = got[ci];
    for (let i = 0; i < f.src.length; i++) {
      o.src.push(f.src[i]);
      o.uv.push((bx + pad + 0.5 + f.xy[2 * i] * d) / size, (by + pad + 0.5 + f.xy[2 * i + 1] * d) / size);
    }
    for (const l of f.corner) o.idx.push(base + l);
    usedTex += boxes[ci][0] * boxes[ci][1];
  });
  return {
    parts: out.map(o => o.idx.length ? { vertexSrc: Uint32Array.from(o.src), index: Uint32Array.from(o.idx), uv: Float32Array.from(o.uv) } : null),
    density: d, used: usedTex / (size * size), charts: flat.length,
  };
}

// ── packing boxes already in UV units ───────────────────────────────────────
// packIslands(boxes, { margin }): boxes are [{ w, h }] in UV units. Finds the largest ONE scale at which they all fit the 0–1 square with
// margin (in UV units) between them and the edge, shelf-packed (the tallest first). Returns { scale, at } where at[i] = [u, v] is where the
// top-left corner of box i goes once its size is multiplied by scale; or null when nothing fits (no boxes, or a box of no size).
export function packIslands(boxes, opts = {}) {
  const N = 4096, M = Math.max(1, Math.ceil((opts.margin == null ? 0.004 : opts.margin) * N));
  if (!boxes.length) return null;
  let area = 0; for (const b of boxes) { if (!(b.w >= 0) || !(b.h >= 0)) return null; area += Math.max(b.w, 1e-9) * Math.max(b.h, 1e-9); }
  const rects = (s) => boxes.map(b => [Math.ceil(b.w * s * N) + M, Math.ceil(b.h * s * N) + M]);
  let lo = 0, hi = Math.sqrt(1 / area) * 1.05, got = null;
  for (let it = 0; it < 26; it++) {
    const mid = (lo + hi) / 2, at = shelves(rects(mid), N);
    if (at) { lo = mid; got = at; } else hi = mid;
  }
  if (!got) return null;
  return { scale: lo, at: got.map(([x, y]) => [(x + M / 2) / N, (y + M / 2) / N]) };
}

// ── 4. the texels of a layout ───────────────────────────────────────────────
// (from and to: a range of triangles, so a big layout can be walked in short slices)
export function rasterise(uv, index, size, fn, from = 0, to = index.length / 3) {
  for (let t = from; t < to; t++) {
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    const ax = uv[2 * a] * size, ay = uv[2 * a + 1] * size, bx = uv[2 * b] * size, by = uv[2 * b + 1] * size, cx = uv[2 * c] * size, cy = uv[2 * c + 1] * size;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5)), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx) - 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5)), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy) - 0.5));
    const eps = -1e-6;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w2 = 1 - w0 - w1;
      if (w0 >= eps && w1 >= eps && w2 >= eps) fn(x, y, t, w0, w1, w2);
    }
  }
}

// Covered texels (mask 1) grow outwards by `rings` texels; fn(to, from) copies one texel onto the next. Returns how many were added.
export function dilate(mask, size, rings, fn) {
  let front = [], added = 0;
  const at = (x, y) => y * size + x;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mask[at(x, y)]) front.push(at(x, y));
  for (let r = 0; r < rings && front.length; r++) {
    const next = [];
    for (const i of front) {
      const x = i % size, y = (i - x) / size;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = at(nx, ny);
        if (mask[j]) continue;
        mask[j] = 2; fn(j, i); next.push(j); added++;
      }
    }
    for (const j of next) mask[j] = 1;
    front = next;
  }
  return added;
}
