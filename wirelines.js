// wirelines.js — polygons (n-gons) found in a triangle mesh, and the lines that draw them.
//
// A triangle mesh from CAD is a flat plate cut into triangles: the lines between the triangles of one plate say
// nothing about the shape. analysePolygons() finds the plates (triangles that lie in one plane and touch along
// an edge); polygonEdges() returns only their outlines; untriangulate.js rebuilds them with fewer triangles.
// wireIndex() is the other choice for the Wireframe view: every triangle edge.
//
// Pure data in, typed arrays out: the page and the background worker both use it.

export const MAX_POLY_TRIS = 4e6;     // past this the analysis is not attempted (the caller falls back to triangle edges)

// positions  Float32Array, xyz per vertex
// index      triangle index array, or null (vertices 3t, 3t+1, 3t+2)
// angleDeg   how far a triangle may turn away from the polygon's first triangle and still belong to it
// poly       optional: a polygon number for every triangle that is already known (skips the search)
//
// Vertices are joined by position first (a CAD mesh is often split along every face, so one corner has one
// vertex per face). A polygon grows from its first triangle and every member is compared with that one, never
// with its neighbour, so a gently curved surface breaks into polygons instead of drifting into one.
// Returns null for no triangles (or more than MAX_POLY_TRIS), else
//   { T, tv, canon, nCanon, diag, nrm, ok, adj, poly, polys }
//   tv(t,k)   the mesh's own vertex number of corner k of triangle t
//   canon[v]  the number of the place vertex v sits at (equal places share a number)
//   nrm       unit normal per triangle (xyz), ok[t] = 0 for a sliver that has none
//   adj[3t+k] the triangle across edge k (from corner k to k+1): -1 open, -2 shared by more than two
//   poly[t]   the polygon triangle t belongs to, polys how many there are
export function analysePolygons(positions, index, angleDeg = 1, polyIn = null) {
  const vc = Math.floor(positions.length / 3);
  const T = index ? Math.floor(index.length / 3) : Math.floor(vc / 3);
  if (!T || T > MAX_POLY_TRIS) return null;
  const tv = index ? (t, k) => index[t * 3 + k] : (t, k) => t * 3 + k;

  // 1. join vertices that sit at the same place: 17 bits per axis on a grid of 1e-5 of the part's size, exact in a double
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < vc; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1, cell = diag * 1e-5;
  const canon = new Int32Array(vc);
  const seen = new Map();
  let nCanon = 0;
  for (let i = 0; i < vc; i++) {
    const key = (Math.round((positions[i * 3] - x0) / cell) * 131072 + Math.round((positions[i * 3 + 1] - y0) / cell)) * 131072 + Math.round((positions[i * 3 + 2] - z0) / cell);
    let id = seen.get(key);
    if (id === undefined) { id = nCanon++; seen.set(key, id); }
    canon[i] = id;
  }
  seen.clear();

  // 2. each triangle's normal, and which neighbour it has across each edge
  const nrm = new Float32Array(T * 3), ok = new Uint8Array(T);
  const minArea2 = diag * diag * diag * diag * 1e-18;
  for (let t = 0; t < T; t++) {
    const a = tv(t, 0) * 3, b = tv(t, 1) * 3, c = tv(t, 2) * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l2 = nx * nx + ny * ny + nz * nz;
    if (l2 > minArea2) { const l = Math.sqrt(l2); nrm[t * 3] = nx / l; nrm[t * 3 + 1] = ny / l; nrm[t * 3 + 2] = nz / l; ok[t] = 1; }
  }
  const adj = new Int32Array(T * 3).fill(-1);
  const edges = new Map();                       // edge → the triangle slot that has it so far; -1 once two have it
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const p = canon[tv(t, k)], q = canon[tv(t, (k + 1) % 3)];
      if (p === q) continue;                     // a collapsed edge
      const key = p < q ? p * nCanon + q : q * nCanon + p;
      const first = edges.get(key);
      if (first === undefined) edges.set(key, t * 3 + k);
      else if (first >= 0) { adj[first] = t; adj[t * 3 + k] = (first / 3) | 0; edges.set(key, -1); }
      else adj[t * 3 + k] = -2;
    }
  }
  edges.clear();

  // 3. polygons
  let poly, polys = 0;
  if (polyIn && polyIn.length === T) {
    poly = polyIn;
    for (let t = 0; t < T; t++) if (poly[t] >= polys) polys = poly[t] + 1;
  } else {
    const cosT = Math.cos(Math.max(0, angleDeg) * Math.PI / 180);
    poly = new Int32Array(T).fill(-1);
    const stack = new Int32Array(T);
    for (let s = 0; s < T; s++) {
      if (poly[s] >= 0) continue;
      const id = polys++;
      poly[s] = id;
      if (!ok[s]) continue;                      // a sliver is a polygon of its own
      const sx = nrm[s * 3], sy = nrm[s * 3 + 1], sz = nrm[s * 3 + 2];
      let top = 0;
      stack[top++] = s;
      while (top) {
        const u = stack[--top];
        for (let k = 0; k < 3; k++) {
          const n = adj[u * 3 + k];
          if (n < 0 || poly[n] >= 0 || !ok[n]) continue;
          if (nrm[n * 3] * sx + nrm[n * 3 + 1] * sy + nrm[n * 3 + 2] * sz >= cosT) { poly[n] = id; stack[top++] = n; }
        }
      }
    }
  }
  return { T, tv, canon, nCanon, diag, nrm, ok, adj, poly, polys };
}

// The outlines of the polygons: an edge is drawn when it is open (one triangle only), shared by more than two
// triangles, or separates two different polygons (once, from the lower-numbered triangle).
// `a` is what analysePolygons returned. Returns { lines, tris, polys }: pairs of the mesh's own vertex numbers.
export function polygonEdges(a, vertCount) {
  const { T, tv, canon, adj, poly, polys } = a;
  const out = new Uint32Array(T * 6);
  let o = 0;
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const p = tv(t, k), q = tv(t, (k + 1) % 3);
      if (canon[p] === canon[q]) continue;
      const n = adj[t * 3 + k];
      if (n < 0 || (n > t && poly[n] !== poly[t])) { out[o++] = p; out[o++] = q; }
    }
  }
  const lines = new (vertCount > 65535 ? Uint32Array : Uint16Array)(o);
  for (let i = 0; i < o; i++) lines[i] = out[i];
  return { lines, tris: T, polys };
}

// Every triangle edge: a pair of vertices for each side of each triangle (a,b, b,c, c,a).
// `index`: the triangle index array, or null for a mesh without one. `vertCount`: picks 16- or 32-bit indices.
// Returns { lines, tris } or null if there are no triangles.
export function wireIndex(index, vertCount) {
  const tris = index ? Math.floor(index.length / 3) : Math.floor(vertCount / 3);
  if (!tris) return null;
  const lines = new (vertCount > 65535 ? Uint32Array : Uint16Array)(tris * 6);
  for (let t = 0, o = 0; t < tris; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
    lines[o++] = a; lines[o++] = b;
    lines[o++] = b; lines[o++] = c;
    lines[o++] = c; lines[o++] = a;
  }
  return { lines, tris };
}
