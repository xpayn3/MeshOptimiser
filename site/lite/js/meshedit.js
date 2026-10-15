// meshedit.js — the points, edges and faces of a mesh: which is under a click, which belong to a loop, and which triangles go
// when some of them are deleted.
//
// A mesh from a CAD file is a soup of triangles: the same corner is stored once per face it belongs to, so nothing in the file
// says that two triangles share an edge. buildTopology() finds that out once per geometry: corners at the same place become one
// point, every pair of points joined by a triangle side becomes one edge, and each edge knows its triangles. From there:
//
//   pickElement(topo, tri, point, mode)   the point, edge or face of triangle `tri` nearest to `point` (the place a ray hit it)
//   edgeLoop(topo, edge, { tri })         the loop an edge belongs to (see below)
//   pointLoop(topo, edge, { tri })        the points of that loop
//   faceRegion(topo, tri)                 the whole face a triangle belongs to: everything up to the sharp edges round it
//   removalMask(topo, { points, edges, faces })   the triangles that go when these are deleted (a point or an edge takes
//                                                 every triangle that uses it, as in a modelling program)
//
// What a loop is. On an edge that is sharp (the two faces meet at more than the crease angle) or open (one face only), the loop is
// the outline of the face the click came from: all the sharp and open edges round that face that hang together, so the rim of a
// hole, the outline of a pocket or the four sides of a box face come in one go. On an edge inside a smooth surface, the loop runs
// on through each point along the edge that goes most nearly straight ahead, as a loop does on a grid of quads, and ends where the
// surface ends or where no edge goes straight enough.
//
// Pure functions on typed arrays, linear in the triangles (two hash tables, no string keys): the app calls them per part, the tests
// call them from Node.
//
//   positions   Float32Array, xyz per vertex
//   index       triangle index array (null: every three vertices are a triangle)
//   opts.crease   degrees: two faces that meet at more than this make a sharp edge (default 30)
//   opts.eps      corners nearer than this are one point (default: a ten-millionth of the mesh's size)

const POW2 = (n) => { let s = 16; while (s < n) s <<= 1; return s; };

export function buildTopology(positions, index, opts = {}) {
  const nRaw = (positions.length / 3) | 0;
  const nTri = ((index ? index.length : nRaw) / 3) | 0;
  const ix = index ? (i) => index[i] : (i) => i;

  // ── points: corners at the same place are one ──
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < nRaw; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const diag = nRaw ? Math.hypot(maxx - minx, maxy - miny, maxz - minz) : 0;
  const cell = opts.eps > 0 ? opts.eps : Math.max(diag * 1e-7, 1e-12);
  const inv = 1 / cell;
  const weld = new Uint32Array(nRaw);
  const Q = new Int32Array(nRaw * 3);
  const repTmp = new Uint32Array(nRaw);
  let nVert = 0;
  {
    const size = POW2(nRaw * 2), mask = size - 1, table = new Int32Array(size).fill(-1);
    for (let i = 0; i < nRaw; i++) {
      const qx = Math.round((positions[i * 3] - minx) * inv), qy = Math.round((positions[i * 3 + 1] - miny) * inv), qz = Math.round((positions[i * 3 + 2] - minz) * inv);
      let h = ((Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) >>> 0) & mask, found = -1;
      for (;;) {
        const j = table[h];
        if (j === -1) break;
        if (Q[j * 3] === qx && Q[j * 3 + 1] === qy && Q[j * 3 + 2] === qz) { found = j; break; }
        h = (h + 1) & mask;
      }
      if (found === -1) { found = nVert++; table[h] = found; Q[found * 3] = qx; Q[found * 3 + 1] = qy; Q[found * 3 + 2] = qz; repTmp[found] = i; }
      weld[i] = found;
    }
  }
  const rep = repTmp.slice(0, nVert);

  // ── triangles by their points, and their normals ──
  const tri = new Uint32Array(nTri * 3), normal = new Float32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) {
    const a = ix(t * 3), b = ix(t * 3 + 1), c = ix(t * 3 + 2);
    tri[t * 3] = weld[a]; tri[t * 3 + 1] = weld[b]; tri[t * 3 + 2] = weld[c];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (l > 0) { normal[t * 3] = nx / l; normal[t * 3 + 1] = ny / l; normal[t * 3 + 2] = nz / l; }
  }

  // ── edges: one for each pair of points a triangle side joins ──
  const maxE = nTri * 3;
  let edgeV = new Uint32Array(maxE * 2), edgeT = new Int32Array(maxE * 2).fill(-1), edgeN = new Uint8Array(maxE);
  const triE = new Uint32Array(nTri * 3);
  let nEdge = 0;
  {
    const size = POW2(maxE * 2), mask = size - 1, table = new Int32Array(size).fill(-1);
    for (let t = 0; t < nTri; t++) {
      for (let k = 0; k < 3; k++) {
        let a = tri[t * 3 + k], b = tri[t * 3 + (k + 1) % 3];
        if (a > b) { const s = a; a = b; b = s; }
        let h = ((Math.imul(a, 0x9E3779B1) ^ Math.imul(b, 0x85EBCA77)) >>> 0) & mask, e = -1;
        for (;;) {
          const j = table[h];
          if (j === -1) break;
          if (edgeV[j * 2] === a && edgeV[j * 2 + 1] === b) { e = j; break; }
          h = (h + 1) & mask;
        }
        if (e === -1) { e = nEdge++; table[h] = e; edgeV[e * 2] = a; edgeV[e * 2 + 1] = b; }
        if (a !== b) {                                           // (a triangle squeezed to a line has a side of no length: not an edge)
          if (edgeN[e] < 2) edgeT[e * 2 + edgeN[e]] = t;
          if (edgeN[e] < 255) edgeN[e]++;
        }
        triE[t * 3 + k] = e;
      }
    }
  }
  edgeV = edgeV.slice(0, nEdge * 2); edgeT = edgeT.slice(0, nEdge * 2); edgeN = edgeN.slice(0, nEdge);

  // ── what kind of edge: 0 inside a smooth surface, 1 sharp, 2 open (one triangle), 3 shared by more than two ──
  const cosCrease = Math.cos(((opts.crease > 0 ? opts.crease : 30) * Math.PI) / 180);
  const kind = new Uint8Array(nEdge);
  for (let e = 0; e < nEdge; e++) {
    const n = edgeN[e];
    if (n <= 1) kind[e] = 2;
    else if (n > 2) kind[e] = 3;
    else {
      const p = edgeT[e * 2] * 3, q = edgeT[e * 2 + 1] * 3;
      const lp = normal[p] || normal[p + 1] || normal[p + 2], lq = normal[q] || normal[q + 1] || normal[q + 2];
      const d = normal[p] * normal[q] + normal[p + 1] * normal[q + 1] + normal[p + 2] * normal[q + 2];
      kind[e] = (lp && lq && d < cosCrease) ? 1 : 0;             // (a triangle of no area has no say)
    }
  }

  // ── the edges at each point ──
  const vStart = new Uint32Array(nVert + 1);
  for (let e = 0; e < nEdge; e++) { vStart[edgeV[e * 2] + 1]++; if (edgeV[e * 2 + 1] !== edgeV[e * 2]) vStart[edgeV[e * 2 + 1] + 1]++; }
  for (let v = 0; v < nVert; v++) vStart[v + 1] += vStart[v];
  const vEdges = new Uint32Array(vStart[nVert]), fill = vStart.slice(0, nVert);
  for (let e = 0; e < nEdge; e++) { const a = edgeV[e * 2], b = edgeV[e * 2 + 1]; vEdges[fill[a]++] = e; if (b !== a) vEdges[fill[b]++] = e; }

  // ── faces: triangles that hang together across smooth edges ──
  const region = new Int32Array(nTri).fill(-1);
  let nRegion = 0;
  {
    const stack = new Uint32Array(nTri);
    for (let s = 0; s < nTri; s++) {
      if (region[s] !== -1) continue;
      let top = 0; stack[top++] = s; region[s] = nRegion;
      while (top) {
        const t = stack[--top];
        for (let k = 0; k < 3; k++) {
          const e = triE[t * 3 + k];
          if (kind[e] !== 0) continue;
          const o = edgeT[e * 2] === t ? edgeT[e * 2 + 1] : edgeT[e * 2];
          if (o >= 0 && region[o] === -1) { region[o] = nRegion; stack[top++] = o; }
        }
      }
      nRegion++;
    }
  }

  return { positions, index: index || null, nRaw, nTri, nVert, nEdge, nRegion, weld, rep, tri, normal, edgeV, edgeT, edgeN, triE, kind, vStart, vEdges, region };
}

// The position of point `v` (one of the corners that were welded into it), into `out` at `at`.
export function pointPosition(topo, v, out = [0, 0, 0], at = 0) {
  const r = topo.rep[v] * 3, p = topo.positions;
  out[at] = p[r]; out[at + 1] = p[r + 1]; out[at + 2] = p[r + 2];
  return out;
}

function distToSegment2(px, py, pz, ax, ay, az, bx, by, bz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, l2 = ux * ux + uy * uy + uz * uz;
  let t = l2 > 0 ? ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + ux * t), dy = py - (ay + uy * t), dz = pz - (az + uz * t);
  return dx * dx + dy * dy + dz * dz;
}

// The element of triangle `t` nearest to `point` ([x, y, z] in the mesh's own space): { mode, id, tri }.
//   'points'  the nearest of its three points      'edges'  the nearest of its three edges      'faces'  the triangle itself
export function pickElement(topo, t, point, mode) {
  if (!(t >= 0 && t < topo.nTri)) return null;
  if (mode === 'faces') return { mode, id: t, tri: t };
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 3; k++) pointPosition(topo, topo.tri[t * 3 + k], c, k * 3);
  const [px, py, pz] = point;
  let best = -1, bd = Infinity;
  if (mode === 'points') {
    for (let k = 0; k < 3; k++) { const d = (px - c[k * 3]) ** 2 + (py - c[k * 3 + 1]) ** 2 + (pz - c[k * 3 + 2]) ** 2; if (d < bd) { bd = d; best = k; } }
    return { mode, id: topo.tri[t * 3 + best], tri: t };
  }
  for (let k = 0; k < 3; k++) {
    const j = (k + 1) % 3;
    if (topo.tri[t * 3 + k] === topo.tri[t * 3 + j]) continue;
    const d = distToSegment2(px, py, pz, c[k * 3], c[k * 3 + 1], c[k * 3 + 2], c[j * 3], c[j * 3 + 1], c[j * 3 + 2]);
    if (d < bd) { bd = d; best = k; }
  }
  return best < 0 ? null : { mode: 'edges', id: topo.triE[t * 3 + best], tri: t };
}

// The whole face triangle `t` belongs to: every triangle reached from it without crossing a sharp or an open edge.
export function faceRegion(topo, t) {
  if (!(t >= 0 && t < topo.nTri)) return new Uint32Array(0);
  const r = topo.region[t], out = [];
  for (let i = 0; i < topo.nTri; i++) if (topo.region[i] === r) out.push(i);
  return Uint32Array.from(out);
}

// The loop edge `e0` belongs to (see the top of the file). opts.tri: the triangle the click came from, which says whose outline
// is meant on a sharp edge; opts.maxTurn: how far (degrees) a loop inside a smooth surface may bend at a point (default 35).
export function edgeLoop(topo, e0, opts = {}) {
  if (!(e0 >= 0 && e0 < topo.nEdge)) return new Uint32Array(0);
  const { edgeV, edgeT, kind, vStart, vEdges, region } = topo;
  if (kind[e0] !== 0) {
    // the outline of one face: the sharp and open edges round region R that hang together with e0
    let R = -1;
    const ta = edgeT[e0 * 2], tb = edgeT[e0 * 2 + 1];
    if (opts.tri >= 0 && (opts.tri === ta || opts.tri === tb)) R = region[opts.tri];
    else if (opts.tri >= 0 && opts.tri < topo.nTri && ((ta >= 0 && region[ta] === region[opts.tri]) || (tb >= 0 && region[tb] === region[opts.tri]))) R = region[opts.tri];
    else R = ta >= 0 ? region[ta] : (tb >= 0 ? region[tb] : -1);
    const borders = (e) => {
      if (kind[e] === 0) return false;
      const a = edgeT[e * 2], b = edgeT[e * 2 + 1];
      const ra = a >= 0 ? region[a] : -2, rb = b >= 0 ? region[b] : -2;
      return (ra === R) !== (rb === R) || (kind[e] === 3 && (ra === R || rb === R));
    };
    if (R < 0 || !borders(e0)) return Uint32Array.of(e0);
    const seen = new Set([e0]), queue = [e0];
    while (queue.length) {
      const e = queue.pop();
      for (let s = 0; s < 2; s++) {
        const v = edgeV[e * 2 + s];
        for (let i = vStart[v]; i < vStart[v + 1]; i++) { const o = vEdges[i]; if (!seen.has(o) && borders(o)) { seen.add(o); queue.push(o); } }
      }
    }
    return Uint32Array.from(seen);
  }
  // inside a smooth surface: on through each point, along the edge that goes most nearly straight ahead
  // (opts.real, from buildPolygons: a line inside a polygon is not an edge, and a loop does not run along one)
  const real = opts.real || null;
  if (real && !real[e0]) return Uint32Array.of(e0);
  const cosMax = Math.cos(((opts.maxTurn > 0 ? opts.maxTurn : 35) * Math.PI) / 180);
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  const out = [e0], seen = new Set([e0]);
  let closed = false;
  const walk = (from, v, push) => {
    let cur = e0, guard = topo.nEdge + 1;
    while (guard-- > 0) {
      pointPosition(topo, from, a); pointPosition(topo, v, b);
      let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
      let best = -1, bestDot = -2, second = -2, bestV = -1;
      for (let i = vStart[v]; i < vStart[v + 1]; i++) {
        const o = vEdges[i];
        if (o === cur || kind[o] !== 0 || (real && !real[o])) continue;
        const w = edgeV[o * 2] === v ? edgeV[o * 2 + 1] : edgeV[o * 2];
        pointPosition(topo, w, c);
        let ex = c[0] - b[0], ey = c[1] - b[1], ez = c[2] - b[2]; const el = Math.hypot(ex, ey, ez); if (!(el > 0)) continue;
        const d = (ex * dx + ey * dy + ez * dz) / el;
        if (d > bestDot) { second = bestDot; bestDot = d; best = o; bestV = w; } else if (d > second) second = d;
      }
      if (best < 0 || bestDot < cosMax || bestDot - second < 1e-3) return;        // nothing straight enough, or two ways equally straight
      if (best === e0) { closed = true; return; }
      if (seen.has(best)) return;
      seen.add(best); push(best);
      from = v; v = bestV; cur = best;
    }
  };
  walk(edgeV[e0 * 2], edgeV[e0 * 2 + 1], (e) => out.push(e));
  if (!closed) walk(edgeV[e0 * 2 + 1], edgeV[e0 * 2], (e) => out.unshift(e));
  return Uint32Array.from(out);
}

// The points of the loop through edge `e`.
export function pointLoop(topo, e, opts = {}) {
  const loop = edgeLoop(topo, e, opts), seen = new Set();
  for (const x of loop) { seen.add(topo.edgeV[x * 2]); seen.add(topo.edgeV[x * 2 + 1]); }
  return Uint32Array.from(seen);
}

// The edge at point `v` that is nearest to `point` among the sides of triangle `t` (for a loop of points: which way it runs).
export function edgeAtPoint(topo, t, v, point, real = null) {
  const hit = pickElement(topo, t, point, 'edges');
  if (hit && (!real || real[hit.id]) && (topo.edgeV[hit.id * 2] === v || topo.edgeV[hit.id * 2 + 1] === v)) return hit.id;
  let best = -1, bd = Infinity; const c = [0, 0, 0, 0, 0, 0];
  if (real) {                                                  // (polygons are known: any real edge at the point, the one nearest the click)
    for (let i = topo.vStart[v]; i < topo.vStart[v + 1]; i++) {
      const e = topo.vEdges[i]; if (!real[e]) continue;
      pointPosition(topo, topo.edgeV[e * 2], c, 0); pointPosition(topo, topo.edgeV[e * 2 + 1], c, 3);
      const d = distToSegment2(point[0], point[1], point[2], c[0], c[1], c[2], c[3], c[4], c[5]);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  for (let k = 0; k < 3; k++) {
    const e = topo.triE[t * 3 + k], a = topo.edgeV[e * 2], b = topo.edgeV[e * 2 + 1];
    if (a === b || (a !== v && b !== v)) continue;
    pointPosition(topo, a, c, 0); pointPosition(topo, b, c, 3);
    const d = distToSegment2(point[0], point[1], point[2], c[0], c[1], c[2], c[3], c[4], c[5]);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// The triangles that go when these are deleted: { removed: Uint8Array over the triangles (1 = remove), count }.
// sel.points / sel.edges / sel.faces: anything that can be iterated (a Set, an array) of point, edge and triangle numbers.
export function removalMask(topo, sel = {}) {
  const removed = new Uint8Array(topo.nTri);
  let count = 0;
  const mark = (t) => { if (t >= 0 && t < topo.nTri && !removed[t]) { removed[t] = 1; count++; } };
  if (sel.faces) for (const t of sel.faces) mark(t);
  let vs = null, es = null;
  if (sel.points) { vs = new Uint8Array(topo.nVert); let any = false; for (const v of sel.points) if (v >= 0 && v < topo.nVert) { vs[v] = 1; any = true; } if (!any) vs = null; }
  if (sel.edges) { es = new Uint8Array(topo.nEdge); let any = false; for (const e of sel.edges) if (e >= 0 && e < topo.nEdge) { es[e] = 1; any = true; } if (!any) es = null; }
  if (vs || es) {
    const { tri, triE } = topo;
    for (let t = 0; t < topo.nTri; t++) {
      if (removed[t]) continue;
      if ((vs && (vs[tri[t * 3]] || vs[tri[t * 3 + 1]] || vs[tri[t * 3 + 2]])) || (es && (es[triE[t * 3]] || es[triE[t * 3 + 1]] || es[triE[t * 3 + 2]]))) { removed[t] = 1; count++; }
    }
  }
  return { removed, count };
}

// How many of each there are, for the readout.
export function counts(topo) { return { points: topo.nVert, edges: topo.nEdge, faces: topo.nTri, regions: topo.nRegion }; }

// ── polygons ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// A flat plate cut into triangles is one polygon to the eye (and to a modelling program): its inner lines are not edges anyone
// would pick. `polyOf` says which polygon each triangle belongs to and `count` how many there are (wirelines.js finds them:
// triangles in one plane that touch); without them every triangle is a polygon of its own. Returns
//   { polyOf, count, pStart, pTris, oStart, oEdges, real }
//   pTris[pStart[p] .. pStart[p + 1])    the triangles of polygon p
//   oEdges[oStart[p] .. oStart[p + 1])   its outline: the edges that have another polygon, or nothing, on the other side
//   real[e]                              1 when edge e is on a polygon's outline, 0 for a line inside one
export function buildPolygons(topo, polyOf, count) {
  const { nTri, nEdge, triE, edgeT, edgeN } = topo;
  if (!polyOf || polyOf.length !== nTri) { polyOf = new Int32Array(nTri); for (let t = 0; t < nTri; t++) polyOf[t] = t; count = nTri; }
  if (!(count > 0)) { count = 0; for (let t = 0; t < nTri; t++) if (polyOf[t] >= count) count = polyOf[t] + 1; }
  const pStart = new Uint32Array(count + 1);
  for (let t = 0; t < nTri; t++) pStart[polyOf[t] + 1]++;
  for (let p = 0; p < count; p++) pStart[p + 1] += pStart[p];
  const pTris = new Uint32Array(nTri), pf = pStart.slice(0, count);
  for (let t = 0; t < nTri; t++) pTris[pf[polyOf[t]]++] = t;
  const real = new Uint8Array(nEdge);
  for (let e = 0; e < nEdge; e++) {
    const n = edgeN[e];
    real[e] = n === 0 ? 0 : n !== 2 ? 1 : (polyOf[edgeT[e * 2]] !== polyOf[edgeT[e * 2 + 1]] ? 1 : 0);
  }
  const oStart = new Uint32Array(count + 1);
  for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) if (real[triE[t * 3 + k]]) oStart[polyOf[t] + 1]++;
  for (let p = 0; p < count; p++) oStart[p + 1] += oStart[p];
  const oEdges = new Uint32Array(oStart[count]), of = oStart.slice(0, count);
  for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) { const e = triE[t * 3 + k]; if (real[e]) oEdges[of[polyOf[t]]++] = e; }
  return { polyOf, count, pStart, pTris, oStart, oEdges, real };
}

// The edge on the outline of polygon `p` nearest to `point`, or -1.
export function nearestOutlineEdge(topo, pg, p, point) {
  let best = -1, bd = Infinity; const c = [0, 0, 0, 0, 0, 0];
  for (let i = pg.oStart[p]; i < pg.oStart[p + 1]; i++) {
    const e = pg.oEdges[i];
    pointPosition(topo, topo.edgeV[e * 2], c, 0); pointPosition(topo, topo.edgeV[e * 2 + 1], c, 3);
    const d = distToSegment2(point[0], point[1], point[2], c[0], c[1], c[2], c[3], c[4], c[5]);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// What a click on triangle `t` at `point` picks when the mesh is read as polygons: { mode, id, tri, poly }.
//   'faces'   id is the polygon          'edges'  the nearest edge of the polygon's outline (never a line inside it)
//   'points'  the nearest point of the triangle
export function pickPolygonElement(topo, pg, t, point, mode) {
  if (!(t >= 0 && t < topo.nTri)) return null;
  const p = pg.polyOf[t];
  if (mode === 'faces') return { mode, id: p, tri: t, poly: p };
  if (mode === 'edges') {
    let best = -1, bd = Infinity; const c = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const e = topo.triE[t * 3 + k]; if (!pg.real[e]) continue;
      pointPosition(topo, topo.edgeV[e * 2], c, 0); pointPosition(topo, topo.edgeV[e * 2 + 1], c, 3);
      const d = distToSegment2(point[0], point[1], point[2], c[0], c[1], c[2], c[3], c[4], c[5]);
      if (d < bd) { bd = d; best = e; }
    }
    if (best < 0) best = nearestOutlineEdge(topo, pg, p, point);
    return best < 0 ? null : { mode, id: best, tri: t, poly: p };
  }
  // the nearest corner of the polygon's outline: a point inside a polygon (what Untriangulate leaves of the triangles' corners) is not
  // one of its points, as it is not in a modelling program, so it is never what a click, a hover or a brush takes
  const c = [0, 0, 0]; let best = -1, bd = Infinity;
  for (let i = pg.oStart[p]; i < pg.oStart[p + 1]; i++) {
    const e = pg.oEdges[i];
    for (let k = 0; k < 2; k++) {
      const v = topo.edgeV[e * 2 + k]; pointPosition(topo, v, c, 0);
      const d = (c[0] - point[0]) ** 2 + (c[1] - point[1]) ** 2 + (c[2] - point[2]) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
  }
  if (best >= 0) return { mode: 'points', id: best, tri: t, poly: p };
  const el = pickElement(topo, t, point, 'points');
  return el ? { mode: 'points', id: el.id, tri: t, poly: p } : null;
}

// Which points are on the outline of some polygon (1) and which lie inside one (0): the corners of the cells an Untriangulate joined
// into a polygon are still in the mesh, but only the outline's points are points of the polygons.
export function outlinePoints(topo, pg) {
  const on = new Uint8Array(topo.nVert);
  for (let e = 0; e < topo.nEdge; e++) if (pg.real[e]) { on[topo.edgeV[e * 2]] = 1; on[topo.edgeV[e * 2 + 1]] = 1; }
  return on;
}

// The loop of polygons through polygon `p0` across its edge `e0`, as in a modelling program: from a four-sided polygon the loop
// leaves through the side opposite the one it came in by, and goes on while the polygons are four-sided. Returns the polygons
// (p0 first), or just [p0] when p0 is not four-sided: the caller then takes the whole face instead.
export function polygonLoop(topo, pg, p0, e0) {
  const { edgeV, edgeT } = topo;
  const sides = (p) => pg.oStart[p + 1] - pg.oStart[p];
  const has = (p, e) => { for (let i = pg.oStart[p]; i < pg.oStart[p + 1]; i++) if (pg.oEdges[i] === e) return true; return false; };
  const opposite = (p, e) => {
    const a = edgeV[e * 2], b = edgeV[e * 2 + 1];
    for (let i = pg.oStart[p]; i < pg.oStart[p + 1]; i++) { const o = pg.oEdges[i]; if (o !== e && edgeV[o * 2] !== a && edgeV[o * 2] !== b && edgeV[o * 2 + 1] !== a && edgeV[o * 2 + 1] !== b) return o; }
    return -1;
  };
  const across = (p, e) => { if (topo.edgeN[e] !== 2) return -1; const pa = pg.polyOf[edgeT[e * 2]], pb = pg.polyOf[edgeT[e * 2 + 1]]; return pa === p ? pb : pb === p ? pa : -1; };
  if (!(p0 >= 0 && p0 < pg.count) || sides(p0) !== 4 || !has(p0, e0)) return Uint32Array.of(p0);
  const out = [p0], seen = new Set([p0]);
  let closed = false;
  const walk = (e) => {
    let cur = p0, guard = pg.count + 1;
    while (e >= 0 && guard-- > 0) {
      const q = across(cur, e);
      if (q < 0) return;
      if (q === p0) { closed = true; return; }
      if (seen.has(q)) return;
      seen.add(q); out.push(q);
      if (sides(q) !== 4) return;
      e = opposite(q, e); cur = q;
    }
  };
  walk(e0);
  if (!closed) walk(opposite(p0, e0));
  return Uint32Array.from(out);
}

// ── four-sided polygons from pairs of triangles ───────────────────────────────────────────────────────────────────────
// A mesh from a file is triangles, but most of them are halves of four-sided polygons: a wall of a tube, a cell of a grid.
// pairQuads() puts two triangles together when they share an edge, make a four-sided shape whose corners are near enough to square
// (each within opts.corner degrees of 90, default 40), and are not folded apart by more than opts.flat degrees (default 45: a
// quad that is bent along its diagonal, as on a curved or sharply turning surface, is still one four-sided polygon, as in Cinema 4D
// and Blender; it is the squareness that keeps two triangles of different faces from being joined across a real crease): the
// squarest pairs first, each triangle in one pair at most. A triangle that finds no partner (a fan round a point, a sliver) stays
// a polygon of its own. A whole flat plate is NOT one polygon here: that is what a click should not take in one go.
// Returns { polyOf (Int32Array, the polygon of each triangle), count, quads }.
export function pairQuads(topo, opts = {}) {
  const { nTri, nEdge, edgeT, edgeN, edgeV, kind, normal, tri } = topo;
  const cosFlat = Math.cos(((opts.flat > 0 ? opts.flat : 45) * Math.PI) / 180), maxDev = ((opts.corner > 0 ? opts.corner : 40) * Math.PI) / 180;
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0];
  const third = (t, a, b) => { for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k]; if (v !== a && v !== b) return v; } return -1; };
  // how far the corner at p, between the sides to q and r, is from square
  const dev = (p, q, r) => {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    const l = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
    if (!(l > 0)) return Infinity;
    let c = (ux * vx + uy * vy + uz * vz) / l; c = c < -1 ? -1 : c > 1 ? 1 : c;
    return Math.abs(Math.acos(c) - Math.PI / 2);
  };
  const cand = [];
  for (let e = 0; e < nEdge; e++) {
    if (edgeN[e] !== 2) continue;                       // (a sharp edge may be the fold of a bent quad: the flat limit and the corners decide)
    const t1 = edgeT[e * 2], t2 = edgeT[e * 2 + 1], p = t1 * 3, q = t2 * 3;
    if (!(normal[p] || normal[p + 1] || normal[p + 2]) || !(normal[q] || normal[q + 1] || normal[q + 2])) continue;
    if (normal[p] * normal[q] + normal[p + 1] * normal[q + 1] + normal[p + 2] * normal[q + 2] < cosFlat) continue;
    const a = edgeV[e * 2], b = edgeV[e * 2 + 1], c = third(t1, a, b), d = third(t2, a, b);
    if (c < 0 || d < 0 || c === d) continue;
    pointPosition(topo, a, A); pointPosition(topo, b, B); pointPosition(topo, c, C); pointPosition(topo, d, D);
    // the four-sided shape is a, c, b, d: its corners at a and b lie between c and d, those at c and d between a and b
    const s = Math.max(dev(A, C, D), dev(B, C, D), dev(C, A, B), dev(D, A, B));
    if (s <= maxDev) cand.push([s, e]);
  }
  cand.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const mate = new Int32Array(nTri).fill(-1);
  let quads = 0;
  for (const [, e] of cand) { const t1 = edgeT[e * 2], t2 = edgeT[e * 2 + 1]; if (mate[t1] === -1 && mate[t2] === -1) { mate[t1] = t2; mate[t2] = t1; quads++; } }
  const polyOf = new Int32Array(nTri).fill(-1);
  let count = 0;
  for (let t = 0; t < nTri; t++) { if (polyOf[t] !== -1) continue; polyOf[t] = count; if (mate[t] !== -1) polyOf[mate[t]] = count; count++; }
  return { polyOf, count, quads };
}

// The outlines of the polygons as pairs of the mesh's own vertices (one of the corners that stand on each point): for lines.
export function outlineLines(topo, pg) {
  let n = 0; for (let e = 0; e < topo.nEdge; e++) if (pg.real[e]) n++;
  const out = new Uint32Array(n * 2);
  let o = 0;
  for (let e = 0; e < topo.nEdge; e++) if (pg.real[e]) { out[o++] = topo.rep[topo.edgeV[e * 2]]; out[o++] = topo.rep[topo.edgeV[e * 2 + 1]]; }
  return out;
}
