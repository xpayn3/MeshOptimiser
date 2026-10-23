// thickness.js — Remove thickness: a thin-walled part becomes the one surface it stands for.
//
// A pipe from a CAD file is two walls (outside and inside) and two rings at its ends; a bracket bent from 1 mm sheet is two faces a
// millimetre apart and a narrow strip round its edges. For a picture, a game or a simulation that wants a surface, one side is enough.
// This finds the thin walls and keeps one side of each:
//
//   1. A triangle is on a thin wall when, looking straight into the material from its middle (against its normal), it meets the
//      other side of the part within `maxThickness`, facing back at it. Its wall thickness is that distance.
//   2. The triangles on thin walls fall into sides: the pieces of surface they make, joined along their edges. Sides face each other
//      (the outside of a pipe faces its inside, the top of a sheet its bottom); a surface can come in several pieces (where something
//      stands on it), so the sides that face each other are gathered into walls and each wall split in its two surfaces, as the two
//      colours of a map: two sides that face each other are on different surfaces.
//   3. Of the two surfaces of a wall the larger stays (a pipe's outside is larger than its inside: the outside stays; the faces of a
//      sheet are the same size: the one that faces away from the middle of the part stays, the one with the first piece in the file
//      when even that is a tie). A wall that cannot be split so (a side that faces itself, an odd ring of sides) is left alone.
//   4. What joined the two sides goes with the one that goes: each piece of surface that is not on a thin wall, touches the side
//      that goes and lies, every point of it, within one and a half thicknesses of both sides (the rings at the ends of a pipe, the
//      strip round the edge of a sheet, however finely they are cut).
//   5. With the CAD faces, a face goes or stays whole (by the larger share of its area), and the record keeps its faces (an empty
//      range for one that went) so the edges that bounded them still name them.
//   6. opts.inset moves the side that stays into the wall, as a share of its thickness at each point: 0 leaves it where it is, 0.5
//      makes it the middle surface of the wall (a 1 mm sheet becomes the plane through its middle).
//
// The surface that is left is open (one layer, no inside): a renderer must draw it from both sides. Pure function on typed arrays.
//
//   positions, index          the mesh
//   opts.maxThickness         walls up to this thick, in the mesh's units (default 1 % of its size)
//   opts.inset                0 … 1 (default 0)
//   opts.cad                  the CAD record (_Brep), optional
// Returns { ok, positions, index, cad, removed, kept, sides, thickness, before, after } or { ok: false, why }.

export function removeThickness(positions, index, opts = {}) {
  const P = Float32Array.from(positions), I = index, T = (I.length / 3) | 0, V = (P.length / 3) | 0;
  if (T < 4) return { ok: false, why: 'the part is too small' };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (!(diag > 0)) return { ok: false, why: 'the part has no size' };
  const maxT = +opts.maxThickness > 0 ? +opts.maxThickness : diag * 0.01;
  const inset = Math.max(0, Math.min(1, +opts.inset || 0));
  const mid = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];

  // places: vertices joined by position
  const inv = 1 / (diag * 1e-6);
  const table = new Map(), place = new Int32Array(V); let nP = 0;
  for (let v = 0; v < V; v++) { const k = Math.round((P[v * 3] - x0) * inv) + ',' + Math.round((P[v * 3 + 1] - y0) * inv) + ',' + Math.round((P[v * 3 + 2] - z0) * inv); let c = table.get(k); if (c === undefined) { c = nP++; table.set(k, c); } place[v] = c; }

  // per triangle: corners, normal (unit), area, middle
  const N = new Float64Array(T * 3), A = new Float64Array(T), C = new Float64Array(T * 3);
  for (let t = 0; t < T; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
    A[t] = l / 2; if (l > 0) { nx /= l; ny /= l; nz /= l; }
    N[t * 3] = nx; N[t * 3 + 1] = ny; N[t * 3 + 2] = nz;
    C[t * 3] = (P[a] + P[b] + P[c]) / 3; C[t * 3 + 1] = (P[a + 1] + P[b + 1] + P[c + 1]) / 3; C[t * 3 + 2] = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
  }

  // a grid of the triangles' boxes, cells about the wall thickness (and at least a 200th of the size, so a big part stays a few
  // thousand cells deep), for the short rays of step 1
  const cell = Math.max(maxT, diag / 200), gx = (x) => Math.floor((x - x0) / cell), gy = (y) => Math.floor((y - y0) / cell), gz = (z) => Math.floor((z - z0) / cell);
  const grid = new Map();
  const ckey = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  for (let t = 0; t < T; t++) {
    if (!(A[t] > 0)) continue;
    let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
    for (let k = 0; k < 3; k++) { const o = I[t * 3 + k] * 3; lx = Math.min(lx, P[o]); hx = Math.max(hx, P[o]); ly = Math.min(ly, P[o + 1]); hy = Math.max(hy, P[o + 1]); lz = Math.min(lz, P[o + 2]); hz = Math.max(hz, P[o + 2]); }
    const i0 = gx(lx), i1 = gx(hx), j0 = gy(ly), j1 = gy(hy), k0 = gz(lz), k1 = gz(hz);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1) > 4096) { let l = grid.get('big'); if (!l) grid.set('big', l = []); l.push(t); continue; }      // (a huge triangle: tried by every ray)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) { const key = ckey(i, j, k); let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(t); }
  }
  const big = grid.get('big') || [];
  // a ray against a triangle (Möller–Trumbore): the distance, or -1
  const hitTri = (ox, oy, oz, dx, dy, dz, t) => {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-18) return -1;
    const id = 1 / det, sx = ox - P[a], sy = oy - P[a + 1], sz = oz - P[a + 2], u = (sx * px + sy * py + sz * pz) * id;
    if (u < -1e-9 || u > 1 + 1e-9) return -1;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (dx * qx + dy * qy + dz * qz) * id;
    if (v < -1e-9 || u + v > 1 + 1e-9) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * id;
  };

  // the distance from a point to a triangle
  const distTri = (qx, qy, qz, t) => {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ax = P[a], ay = P[a + 1], az = P[a + 2];
    const abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az, acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
    const apx = qx - ax, apy = qy - ay, apz = qz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let px, py, pz;
    if (d1 <= 0 && d2 <= 0) { px = ax; py = ay; pz = az; }
    else {
      const bpx = qx - P[b], bpy = qy - P[b + 1], bpz = qz - P[b + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      const cpx = qx - P[c], cpy = qy - P[c + 1], cpz = qz - P[c + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
      const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
      if (d3 >= 0 && d4 <= d3) { px = P[b]; py = P[b + 1]; pz = P[b + 2]; }
      else if (d6 >= 0 && d5 <= d6) { px = P[c]; py = P[c + 1]; pz = P[c + 2]; }
      else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); px = ax + v * abx; py = ay + v * aby; pz = az + v * abz; }
      else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); px = ax + w * acx; py = ay + w * acy; pz = az + w * acz; }
      else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); px = P[b] + w * (P[c] - P[b]); py = P[b + 1] + w * (P[c + 1] - P[b + 1]); pz = P[b + 2] + w * (P[c + 2] - P[b + 2]); }
      else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; px = ax + abx * v + acx * w; py = ay + aby * v + acy * w; pz = az + abz * v + acz * w; }
    }
    return Math.hypot(qx - px, qy - py, qz - pz);
  };

  // 1. the triangles on a thin wall: what they meet, and how far
  const partner = new Int32Array(T).fill(-1), thick = new Float64Array(T);
  const eps = diag * 1e-7, reach = maxT * 1.02;
  for (let t = 0; t < T; t++) {
    if (!(A[t] > 0)) continue;
    const dx = -N[t * 3], dy = -N[t * 3 + 1], dz = -N[t * 3 + 2], ox = C[t * 3] + dx * eps, oy = C[t * 3 + 1] + dy * eps, oz = C[t * 3 + 2] + dz * eps;
    const ex = ox + dx * reach, ey = oy + dy * reach, ez = oz + dz * reach;
    const seen = new Set(); let best = Infinity, who = -1;
    const visit = (h) => {
      if (h === t || seen.has(h)) return; seen.add(h);
      const d = hitTri(ox, oy, oz, dx, dy, dz, h);
      if (!(d > 0) || d > reach || d >= best) return;
      best = d; who = h;
    };
    const i0 = gx(Math.min(ox, ex)), i1 = gx(Math.max(ox, ex)), j0 = gy(Math.min(oy, ey)), j1 = gy(Math.max(oy, ey)), k0 = gz(Math.min(oz, ez)), k1 = gz(Math.max(oz, ez));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) { const l = grid.get(ckey(i, j, k)); if (l) for (const h of l) visit(h); }
    for (const h of big) visit(h);
    // the nearest thing it meets must be the other side, facing back (a wall that turns away is no wall)
    if (who >= 0 && N[t * 3] * N[who * 3] + N[t * 3 + 1] * N[who * 3 + 1] + N[t * 3 + 2] * N[who * 3 + 2] < -0.5) { partner[t] = who; thick[t] = best; }
  }

  // 2. the sides: the wall triangles joined along their edges
  const edgeTris = new Map();
  for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) { const a = place[I[t * 3 + k]], b = place[I[t * 3 + (k + 1) % 3]]; if (a === b) continue; const key = a < b ? a * nP + b : b * nP + a; let l = edgeTris.get(key); if (!l) edgeTris.set(key, l = []); l.push(t); }
  const side = new Int32Array(T).fill(-1); let nS = 0;
  for (let t = 0; t < T; t++) {
    if (partner[t] < 0 || side[t] >= 0) continue;
    const s = nS++, stack = [t]; side[t] = s;
    while (stack.length) {
      const u = stack.pop();
      for (let k = 0; k < 3; k++) { const a = place[I[u * 3 + k]], b = place[I[u * 3 + (k + 1) % 3]]; const key = a < b ? a * nP + b : b * nP + a; for (const w of edgeTris.get(key) || []) if (w !== u && partner[w] >= 0 && side[w] < 0) { side[w] = s; stack.push(w); } }
    }
  }
  if (!nS) return { ok: false, why: 'no wall thinner than ' + +maxT.toPrecision(3) + ' was found' };
  const sArea = new Float64Array(nS), sOut = new Float64Array(nS), meets = Array.from({ length: nS }, () => new Map());
  for (let t = 0; t < T; t++) {
    const s = side[t]; if (s < 0) continue;
    sArea[s] += A[t];
    sOut[s] += A[t] * ((C[t * 3] - mid[0]) * N[t * 3] + (C[t * 3 + 1] - mid[1]) * N[t * 3 + 1] + (C[t * 3 + 2] - mid[2]) * N[t * 3 + 2]);
    const o = side[partner[t]]; if (o >= 0) meets[s].set(o, (meets[s].get(o) || 0) + A[t]);
  }
  // the walls: sides joined where they face each other over a fair share of the smaller (a fifth), each split in its two surfaces
  const link = Array.from({ length: nS }, () => []);
  for (let s = 0; s < nS; s++) for (const [o, w] of meets[s]) { if (o === s) continue; const both = w + (meets[o].get(s) || 0); if (both > 0.2 * Math.min(sArea[s], sArea[o]) && s < o) { link[s].push(o); link[o].push(s); } }
  const colour = new Int8Array(nS).fill(-1), wallOf = new Int32Array(nS).fill(-1);
  const goes = new Uint8Array(nS), handled = new Uint8Array(nS);
  let pairs = 0;
  for (let s0 = 0; s0 < nS; s0++) {
    if (colour[s0] >= 0 || !link[s0].length) continue;
    const members = [s0]; colour[s0] = 0; wallOf[s0] = s0; let odd = false;
    for (let q = 0; q < members.length; q++) { const s = members[q]; for (const o of link[s]) { if (colour[o] < 0) { colour[o] = 1 - colour[s]; wallOf[o] = s0; members.push(o); } else if (colour[o] === colour[s]) odd = true; } }
    if (members.some(s => (meets[s].get(s) || 0) > sArea[s] * 0.3)) odd = true;          // (a side that faces itself: folded, not a wall)
    if (odd) continue;
    const area = [0, 0], out = [0, 0], first = [Infinity, Infinity];
    for (const s of members) { area[colour[s]] += sArea[s]; out[colour[s]] += sOut[s]; first[colour[s]] = Math.min(first[colour[s]], s); }
    if (!area[0] || !area[1]) continue;
    const close = Math.abs(area[0] - area[1]) <= 0.02 * Math.max(area[0], area[1]);
    const keep = !close ? (area[0] > area[1] ? 0 : 1) : (Math.abs(out[0] - out[1]) > 1e-9 * diag * diag ? (out[0] > out[1] ? 0 : 1) : (first[0] < first[1] ? 0 : 1));
    for (const s of members) { handled[s] = 1; if (colour[s] !== keep) goes[s] = 1; }
    pairs++;
  }
  if (!pairs) return { ok: false, why: 'the thin walls found do not pair up into two sides' };
  const facing = handled;      // (a side of a wall that was split: step 4 reads it)

  // 4. what goes: the sides that go, and what joins them to the ones that stay
  const out = new Uint8Array(T);
  const onKept = new Uint8Array(nP), onGone = new Uint8Array(nP);
  for (let t = 0; t < T; t++) { const s = side[t]; if (s < 0 || !facing[s]) continue; if (goes[s]) out[t] = 1; for (let k = 0; k < 3; k++) (goes[s] ? onGone : onKept)[place[I[t * 3 + k]]] = 1; }
  // the pieces that are not on a wall that was split, joined along their edges
  const piece = new Int32Array(T).fill(-1); let nPc = 0;
  const free = (t) => !out[t] && !(side[t] >= 0 && facing[side[t]]);
  for (let t = 0; t < T; t++) {
    if (!free(t) || piece[t] >= 0) continue;
    const pc = nPc++, stack = [t]; piece[t] = pc;
    while (stack.length) { const u = stack.pop(); for (let k = 0; k < 3; k++) { const a = place[I[u * 3 + k]], b = place[I[u * 3 + (k + 1) % 3]]; const key = a < b ? a * nP + b : b * nP + a; for (const w of edgeTris.get(key) || []) if (w !== u && free(w) && piece[w] < 0) { piece[w] = pc; stack.push(w); } } }
  }
  // how far a point is from the side that stays and from the side that goes (the nearest of their triangles, through the grid)
  const keptSide = new Uint8Array(T), goneSide = new Uint8Array(T);
  for (let t = 0; t < T; t++) { const s = side[t]; if (s >= 0 && facing[s]) (goes[s] ? goneSide : keptSide)[t] = 1; }
  const near = (x, y, z, which, r) => {
    for (let i = gx(x - r); i <= gx(x + r); i++) for (let j = gy(y - r); j <= gy(y + r); j++) for (let k = gz(z - r); k <= gz(z + r); k++) {
      const l = grid.get(ckey(i, j, k)); if (!l) continue;
      for (const h of l) if (which[h] && distTri(x, y, z, h) <= r) return true;
    }
    for (const h of big) if (which[h] && distTri(x, y, z, h) <= r) return true;
    return false;
  };
  const touchesGone = new Uint8Array(nPc), bad = new Uint8Array(nPc);
  for (let t = 0; t < T; t++) { const pc = piece[t]; if (pc < 0) continue; for (let k = 0; k < 3; k++) if (onGone[place[I[t * 3 + k]]]) touchesGone[pc] = 1; }
  const r15 = maxT * 1.5, checked = new Set();
  for (let t = 0; t < T; t++) {
    const pc = piece[t]; if (pc < 0 || !touchesGone[pc] || bad[pc]) continue;
    for (let k = 0; k < 3 && !bad[pc]; k++) {
      const v = I[t * 3 + k], c = place[v]; if (checked.has(pc * nP + c)) continue; checked.add(pc * nP + c);
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      if (!near(x, y, z, keptSide, r15) || !near(x, y, z, goneSide, r15)) bad[pc] = 1;
    }
  }
  for (let t = 0; t < T; t++) { const pc = piece[t]; if (pc >= 0 && touchesGone[pc] && !bad[pc]) out[t] = 1; }

  // 5. with the CAD faces: whole faces
  const cad = opts.cad && opts.cad.faces && opts.cad.faces.length ? opts.cad : null;
  const fOf = new Int32Array(T).fill(-1);
  if (cad) {
    const F = cad.faces;
    for (let f = 0; f < F.length; f++) { const [, s, c] = F[f]; let gone = 0, all = 0; for (let t = s; t < s + c && t < T; t++) { fOf[t] = f; all += A[t]; if (out[t]) gone += A[t]; } const whole = gone > all * 0.5 ? 1 : 0; for (let t = s; t < s + c && t < T; t++) out[t] = whole; }
  }
  let removed = 0; for (let t = 0; t < T; t++) if (out[t]) removed++;
  if (!removed) return { ok: false, why: 'nothing to take away: no two sides of a thin wall were found' };
  if (removed === T) return { ok: false, why: 'everything would go' };

  // 6. the side that stays moved into the wall
  if (inset > 0) {
    const nx = new Float64Array(nP), ny = new Float64Array(nP), nz = new Float64Array(nP), dd = new Float64Array(nP), w = new Float64Array(nP);
    for (let t = 0; t < T; t++) {
      if (out[t] || partner[t] < 0) continue;
      for (let k = 0; k < 3; k++) { const c = place[I[t * 3 + k]]; nx[c] += N[t * 3] * A[t]; ny[c] += N[t * 3 + 1] * A[t]; nz[c] += N[t * 3 + 2] * A[t]; dd[c] += thick[t] * A[t]; w[c] += A[t]; }
    }
    const moved = new Uint8Array(nP);
    for (let v = 0; v < V; v++) {
      const c = place[v]; if (!(w[c] > 0)) continue;
      const l = Math.hypot(nx[c], ny[c], nz[c]) || 1, d = dd[c] / w[c] * inset;
      P[v * 3] -= nx[c] / l * d; P[v * 3 + 1] -= ny[c] / l * d; P[v * 3 + 2] -= nz[c] / l * d; moved[c] = 1;
    }
  }

  // the triangles that are left, grouped by face, and the record
  const keep = []; for (let t = 0; t < T; t++) if (!out[t]) keep.push(t);
  if (cad) keep.sort((p, q) => (fOf[p] - fOf[q]) || (p - q));
  const newIndex = new Uint32Array(keep.length * 3);
  keep.forEach((t, i) => { newIndex[i * 3] = I[t * 3]; newIndex[i * 3 + 1] = I[t * 3 + 1]; newIndex[i * 3 + 2] = I[t * 3 + 2]; });
  let newCad = null;
  if (cad) {
    const F = cad.faces, nf = F.map(f => [f[0], 0, 0, 0, ...f.slice(4)]);
    keep.forEach((t, i) => { const f = fOf[t]; if (f < 0) return; if (!nf[f][2]) nf[f][1] = i; nf[f][2]++; nf[f][3] += A[t]; });
    for (const f of nf) f[3] = +f[3].toFixed(6);
    const gone = new Set(); F.forEach((f, i) => { if (f[2] && !nf[i][2]) gone.add(i); });
    // an edge between two faces that both went goes too; one that bounded a face that stays stays (it is the edge of the sheet now)
    const rows = (cad.rows || []).filter(r => !(gone.has(r[3]) && (r[4] < 0 || gone.has(r[4]))));
    newCad = { faces: nf, rows, pts: cad.pts };
    if (inset > 0) newCad.rows = [];                                                   // (the edges of the wall moved: drawn again from the mesh)
  }
  const ts = []; for (let t = 0; t < T; t++) if (partner[t] >= 0) ts.push(thick[t]); ts.sort((a, b) => a - b);
  return { ok: true, keepNormals: true, positions: P, index: newIndex, cad: newCad, removed, kept: keep.length, sides: pairs, thickness: ts.length ? +ts[ts.length >> 1].toPrecision(4) : 0, before: T, after: keep.length };
}
