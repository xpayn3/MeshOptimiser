// export-writers.js — the writers that turn the export's scene (buildExportRoot in app.js) into file bytes: binary and ASCII FBX, with
// the scene tree they share and the quads and n-gons they write, and the streaming OBJ writer with its texture files. Moved verbatim
// from app.js (2026-10-23); what they use of the app comes in through installExportWriters(app).
import * as THREE from 'three';
import * as FM from './facemat.js?v=2';
import * as MEDIT from './meshedit.js?v=6';
import { setExportTextureFormats } from './texformat.js?v=1';

// app: what the writers use of app.js (see the call there): state (its sceneUpAxis), toast, _matrixHasShear, and the line index of
// the view (_polyIds, _triOnly, _wireXYZ), which says where a mesh's quads and n-gons are.
export function installExportWriters(app) {
const { state, _polyIds, _triOnly } = app;
const toast = (...a) => app.toast(...a), _matrixHasShear = (...a) => app._matrixHasShear(...a), _wireXYZ = (...a) => app._wireXYZ(...a);

// ── Binary FBX writer ─────────────────────────────────────────────────────
// FBX 7.4 binary spec: 27-byte header + recursively-encoded nodes + 13-byte
// null terminator + optional 168-byte footer. Each node records the absolute
// file offset of its end byte so the parser can jump over it; we backfill
// those during a single-pass write via patchUint32LE. Large array properties
// (vertex positions, indices, normals) are zlib-compressed via the browser's
// CompressionStream — that's where the bulk of the 3× shrink vs ASCII comes
// from.
//
// Designed to mirror the ASCII writer's output exactly so DCC tools see an
// identical scene; only the on-disk encoding changes.

class _FbxBinWriter {
  constructor() {
    this.buf = new ArrayBuffer(64 * 1024);
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
    this.pos = 0;
  }
  _ensure(n) {
    if (this.pos + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength;
    while (this.pos + n > cap) cap *= 2;
    const nb = new ArrayBuffer(cap);
    new Uint8Array(nb).set(this.bytes.subarray(0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb);
    this.bytes = new Uint8Array(nb);
  }
  u8(v)  { this._ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  i16(v) { this._ensure(2); this.view.setInt16(this.pos, v, true); this.pos += 2; }
  i32(v) { this._ensure(4); this.view.setInt32(this.pos, v, true); this.pos += 4; }
  u32(v) { this._ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  f32(v) { this._ensure(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; }
  f64(v) { this._ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; }
  i64(v) { this._ensure(8); this.view.setBigInt64(this.pos, BigInt(v), true); this.pos += 8; }
  bytes_(b) { this._ensure(b.byteLength); this.bytes.set(b, this.pos); this.pos += b.byteLength; }
  patchU32(at, v) { this.view.setUint32(at, v >>> 0, true); }
  finalize() { return new Uint8Array(this.buf, 0, this.pos); }
}

async function _fbxDeflate(bytes) {
  // FBX encoding=1 means RFC 1950 (zlib): 2-byte CMF/FLG header + raw
  // DEFLATE stream + 4-byte Adler-32 checksum (big-endian).
  //
  // We MUST NOT use CompressionStream('deflate') directly: the W3C spec
  // only clarified that 'deflate' = RFC 1950 in late 2022, and Chrome
  // shipped raw DEFLATE for 'deflate' until ~Chrome 106. Using deflate-raw
  // and adding the RFC 1950 framing ourselves guarantees the FBX SDK's
  // zlib decompressor accepts it in Houdini, C4D, Maya, and 3ds Max.
  //
  // Step 1: Adler-32 of the uncompressed input (RFC 1950 requires it).
  let adlerA = 1, adlerB = 0;
  for (let i = 0; i < bytes.length; i++) {
    adlerA = (adlerA + bytes[i]) % 65521;
    adlerB = (adlerB + adlerA) % 65521;
  }

  // Step 2: Raw DEFLATE (no zlib header, no checksum).
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = cs.readable.getReader();
  const rawChunks = [];
  let rawTotal = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    rawChunks.push(value); rawTotal += value.byteLength;
  }

  // Step 3: Assemble RFC 1950: [CMF=0x78, FLG=0x9C] + deflate + Adler-32.
  // 0x78 = deflate + 32 KB window. 0x9C = check bits such that
  // (0x78<<8 | 0x9C) % 31 == 0 — RFC 1950 header validity requirement.
  const out = new Uint8Array(2 + rawTotal + 4);
  out[0] = 0x78; out[1] = 0x9C;
  let off = 2;
  for (const c of rawChunks) { out.set(c, off); off += c.byteLength; }
  // Adler-32 written big-endian in the last 4 bytes.
  // Use >>> 0 to keep the shift unsigned — without it, adlerB > 0x7FFF
  // would produce a negative signed value and corrupt the checksum.
  new DataView(out.buffer).setUint32(2 + rawTotal, ((adlerB << 16) >>> 0) | adlerA, false);
  return out;
}

const _FBX_TENC = new TextEncoder();

function _fbxWriteScalarProp(w, type, value) {
  w.u8(type.charCodeAt(0));
  switch (type) {
    case 'Y': w.i16(value); break;
    case 'C':
      // 'C' is a single byte — FBX SDK convention uses ASCII 'Y'/'N' (89/78)
      // for boolean-ish flags rather than 0/1. Accept either: a JS boolean
      // becomes 'Y'/'N', a number gets written verbatim (caller can pass
      // 89 directly when matching the SDK style).
      if (typeof value === 'boolean') w.u8(value ? 89 : 78);
      else w.u8(value | 0);
      break;
    case 'I': w.i32(value); break;
    case 'F': w.f32(value); break;
    case 'D': w.f64(value); break;
    case 'L': w.i64(value); break;
    case 'S':
    case 'R': {
      const buf = typeof value === 'string' ? _FBX_TENC.encode(value) : value;
      w.u32(buf.byteLength);
      w.bytes_(buf);
      break;
    }
  }
}

async function _fbxWriteArrayProp(w, type, array) {
  // type ∈ {'f','d','l','i','b'} → element typed buffer
  w.u8(type.charCodeAt(0));
  let raw;
  switch (type) {
    case 'f': raw = new Uint8Array(new Float32Array(array).buffer); break;
    case 'd': raw = new Uint8Array(new Float64Array(array).buffer); break;
    case 'i': raw = new Uint8Array(new Int32Array(array).buffer); break;
    case 'l': {
      const big = new BigInt64Array(array.length);
      for (let i = 0; i < array.length; i++) big[i] = BigInt(array[i]);
      raw = new Uint8Array(big.buffer);
      break;
    }
    case 'b': raw = new Uint8Array(array); break;
  }
  w.u32(array.length);
  // Match Blender's encode_bin.py threshold exactly:
  //   encoding = 0 (raw)  if len(data) <= 128
  //   encoding = 1 (zlib) if len(data) >  128
  // Small arrays (e.g. Materials:[0] = 4 bytes) stay uncompressed.
  // Large arrays (vertex positions, indices) get zlib.
  const encoding = raw.byteLength <= 128 ? 0 : 1;
  const payload = encoding === 1 ? await _fbxDeflate(raw) : raw;
  w.u32(encoding);
  w.u32(payload.byteLength);
  w.bytes_(payload);
}

// FBX node tree node:
// { name: 'Foo', props: [{type:'I', value: 7}, ...], children: [...] }
//
// FBX 7.4 binary uses 32-bit fields for the node header. Matching Blender's
// exporter exactly — Blender writes 7.4 (32-bit) and its files load
// universally including C4D 2026. The 64-bit format only matters for
// >4 GB single-file exports.
async function _fbxWriteNode(w, n) {
  const headerStart = w.pos;
  w.u32(0);                 // end_offset (patched at end)
  w.u32(n.props ? n.props.length : 0);
  const propLenPos = w.pos;
  w.u32(0);                 // property_list_len (patched after props)
  const nameBuf = _FBX_TENC.encode(n.name || '');
  w.u8(nameBuf.byteLength);
  w.bytes_(nameBuf);

  const propStart = w.pos;
  if (n.props) {
    for (const p of n.props) {
      // Lowercase array types ('f','d','l','i','b') vs uppercase scalar types
      // ('Y','C','I','F','D','L','S','R'). Single-char unambiguous routing.
      if (p.type === 'f' || p.type === 'd' || p.type === 'l' || p.type === 'i' || p.type === 'b') {
        await _fbxWriteArrayProp(w, p.type, p.value);
      } else {
        _fbxWriteScalarProp(w, p.type, p.value);
      }
    }
  }
  w.patchU32(propLenPos, w.pos - propStart);

  // Write a null-record terminator whenever `children` is PRESENT — even an
  // empty array. Strict FBX importers (Cinema 4D, Maya, FBX SDK validators)
  // walk container nodes assuming there'll be a terminator, and freak out
  // when a node like `References` (which is canonically empty but is a
  // container by spec) has no terminator. Use `children: undefined` to mark
  // a true leaf node with no terminator.
  const hasKidsField = n.children !== undefined;
  if (hasKidsField) {
    for (const c of n.children) {
      await _fbxWriteNode(w, c);
    }
    // Null record (13 bytes for FBX 7.4: three uint32 + one uint8).
    w.u32(0); w.u32(0); w.u32(0); w.u8(0);
  }
  w.patchU32(headerStart, w.pos);
}

// ── FBX scene-tree builder shared by ASCII and binary writers ─────────────
// Walks the export root, dedupes materials by RGB hex, bakes each mesh's
// matrixWorld into a per-mesh world-space copy of the source positions/
// normals (FBX has no shear support — bake-in-vertices avoids decompose
// loss for deeply-nested transforms), and returns a flat list of nodes
// with parent indices ready for either backend to emit.
function _collectFbxScene(root) {
  root.updateMatrixWorld(true);
  const nodes = [];                 // { obj, parentIdx, type: 'Null' | 'Mesh' }
  const objToIdx = new Map();
  function visit(obj, parentIdx) {
    if (obj === root) {
      objToIdx.set(obj, -1);
    } else {
      const isMesh = !!obj.isMesh;
      if (isMesh && obj.visible === false) return;
      if (isMesh && !obj.geometry?.attributes?.position) return;
      const idx = nodes.length;
      nodes.push({ obj, parentIdx, type: isMesh ? 'Mesh' : 'Null' });
      objToIdx.set(obj, idx);
      parentIdx = idx;
    }
    if (obj.children) for (const c of obj.children) visit(c, parentIdx);
  }
  visit(root, -1);

  // Prune empty Null nodes (those with no Mesh descendants).
  {
    const liveDescendantCount = new Array(nodes.length).fill(0);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const mine = n.type === 'Mesh' ? 1 : 0;
      if (n.parentIdx >= 0) liveDescendantCount[n.parentIdx] += mine + liveDescendantCount[i];
      liveDescendantCount[i] += mine;
    }
    const keep = nodes.map((n, i) => n.type === 'Mesh' || liveDescendantCount[i] > 0);
    if (keep.some(k => !k)) {
      const remap = new Array(nodes.length).fill(-1);
      const filtered = [];
      for (let i = 0; i < nodes.length; i++) {
        if (!keep[i]) continue;
        remap[i] = filtered.length;
        const n = nodes[i];
        let p = n.parentIdx;
        while (p >= 0 && !keep[p]) p = nodes[p].parentIdx;
        filtered.push({ obj: n.obj, parentIdx: p < 0 ? -1 : remap[p], type: n.type });
      }
      nodes.length = 0;
      for (const n of filtered) nodes.push(n);
    }
  }

  // (Materials are not collected here: the binary writer gives every mesh a
  // material of its own, see _exportFbxBinary.)
  return { nodes };
}

// A mesh whose world matrix mirrors (det < 0) gets a copy of its geometry with every triangle wound the other way, for the writers
// that bake the transform into the points. Its polygon list (_moPoly) is the same: a polygon keeps its triangles, only their turn
// changes, so the quads and n-gons the writers build from it are reversed too. An FBX part written with its own position, turn and
// scale (_fbxLocalTRS) is left alone: its Model carries the transform and the reader applies it.
function _flipMirroredForBake(root, format) {
  const lin = root.userData.exportLin || null;
  const done = new Map();                      // (a geometry shared by several mirrored meshes is flipped once)
  const swapped = [];
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    if (!(o.matrixWorld.determinant() < 0)) return;
    if (format === 'fbx') { try { if (_fbxLocalTRS(o, lin)) return; } catch (_) {} }
    const g = o.geometry;
    let f = done.get(g);
    if (!f) {
      f = g.clone();
      if (g._moPoly) f._moPoly = g._moPoly;
      if (f.index) {
        const a = f.index.array;
        for (let i = 0; i + 2 < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
        f.index.needsUpdate = true;
      } else {
        for (const name in f.attributes) {
          const at = f.attributes[name], n = at.itemSize, arr = at.array;
          if (at.isInterleavedBufferAttribute) continue;
          for (let v = 0; v + 2 < at.count; v += 3) for (let k = 0; k < n; k++) { const i1 = (v + 1) * n + k, i2 = (v + 2) * n + k, t = arr[i1]; arr[i1] = arr[i2]; arr[i2] = t; }
          at.needsUpdate = true;
        }
      }
      done.set(g, f);
    }
    swapped.push([o, g]);
    o.geometry = f;
  });
  return () => { for (const [o, g] of swapped) o.geometry = g; };
}

// ── Quads and n-gons for the OBJ and FBX writers ────────────────────────────────────────────────────────────────────────
// A geometry in the export root carries `_moPoly` (see buildExportRoot): the polygon each triangle belongs to. This turns that
// into the faces a modelling program wants: { sizes, verts }, the number of corners of each face and, corner after corner, the
// mesh's own vertex number (so a corner keeps its own normal and uv), wound as the triangles are. Two triangles of a polygon that
// share an edge make a quad; a bigger polygon goes round its outline. A polygon whose outline is not one simple loop (a hole in it)
// is written as its triangles. Returns null when nothing has more than three corners: the writers then keep their fast path.
function _exportFaces(geom) {
  const poly = geom && geom._moPoly, pos = geom && geom.attributes && geom.attributes.position;
  if (!poly || !pos) return null;
  const idx = geom.index ? geom.index.array : null, nTri = idx ? (idx.length / 3) | 0 : (pos.count / 3) | 0;
  if (!nTri || poly.length !== nTri) return null;
  const topo = MEDIT.buildTopology(_wireXYZ(pos, false), idx), W = topo.weld, nW = topo.nVert + 1;      // raw vertex → welded point
  const raw = (t, k) => idx ? idx[t * 3 + k] : t * 3 + k;
  let nPoly = 0;
  for (let t = 0; t < nTri; t++) if (poly[t] >= nPoly) nPoly = poly[t] + 1;
  const start = new Uint32Array(nPoly + 1);
  for (let t = 0; t < nTri; t++) start[poly[t] + 1]++;
  for (let q = 0; q < nPoly; q++) start[q + 1] += start[q];
  const order = new Uint32Array(nTri), fill = start.slice(0, nPoly);
  for (let t = 0; t < nTri; t++) order[fill[poly[t]]++] = t;
  const sizes = new Uint32Array(nTri), verts = new Uint32Array(nTri * 3);       // (a polygon of n triangles has n + 2 corners at most: never more than the triangles' own 3n)
  const firstTri = new Uint32Array(nTri);                                          // (the first triangle of each polygon written: its material, for a part of several colours)
  const tm = geom.groups && geom.groups.length > 1 ? FM.triMaterials(geom.groups, nTri) : null;
  let ns = 0, nv = 0, big = false;
  const tri = (t) => { verts[nv++] = raw(t, 0); verts[nv++] = raw(t, 1); verts[nv++] = raw(t, 2); firstTri[ns] = t; sizes[ns++] = 3; };
  for (let q = 0; q < nPoly; q++) {
    const a = start[q], b = start[q + 1], n = b - a;
    if (!n) continue;
    if (n === 1) { tri(order[a]); continue; }
    if (tm) { let mixed = false; for (let i = a + 1; i < b && !mixed; i++) if (tm[order[i]] !== tm[order[a]]) mixed = true; if (mixed) { for (let i = a; i < b; i++) tri(order[i]); continue; } }      // (a polygon across two colours is written as its triangles)
    if (n === 2) {                                     // the common case: two triangles that share an edge are one quad a, d, b, c
      const t1 = order[a], t2 = order[a + 1];
      let done = false;
      for (let k = 0; k < 3 && !done; k++) {
        const wa = W[raw(t1, k)], wb = W[raw(t1, (k + 1) % 3)];
        for (let j = 0; j < 3; j++) {
          if (W[raw(t2, j)] === wb && W[raw(t2, (j + 1) % 3)] === wa) {
            verts[nv++] = raw(t1, k); verts[nv++] = raw(t2, (j + 2) % 3); verts[nv++] = raw(t1, (k + 1) % 3); verts[nv++] = raw(t1, (k + 2) % 3);
            firstTri[ns] = t1; sizes[ns++] = 4; big = true; done = true; break;
          }
        }
      }
      if (!done) { tri(t1); tri(t2); }
      continue;
    }
    // more triangles: the outline is the edges that have no triangle of the polygon on the other side, chained into one loop
    const dir = new Set(), next = new Map();
    for (let i = a; i < b; i++) { const t = order[i]; for (let k = 0; k < 3; k++) { const wa = W[raw(t, k)], wb = W[raw(t, (k + 1) % 3)]; if (wa !== wb) dir.add(wa * nW + wb); } }
    let ok = true, nb = 0, first = -1;
    for (let i = a; i < b && ok; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        const wa = W[raw(t, k)], wb = W[raw(t, (k + 1) % 3)];
        if (wa === wb || dir.has(wb * nW + wa)) continue;
        if (next.has(wa)) { ok = false; break; }
        next.set(wa, [wb, raw(t, k)]); nb++; if (first < 0) first = wa;
      }
    }
    const loop = [];
    if (ok && nb >= 3) {
      let cur = first;
      do { const e = next.get(cur); if (!e || loop.length > nb) { ok = false; break; } loop.push(e[1]); cur = e[0]; } while (cur !== first);
      ok = ok && loop.length === nb;
    } else ok = false;
    if (ok) { for (const v of loop) verts[nv++] = v; firstTri[ns] = order[a]; sizes[ns++] = loop.length; big = true; }
    else for (let i = a; i < b; i++) tri(order[i]);
  }
  return big ? { sizes: sizes.subarray(0, ns), verts: verts.subarray(0, nv), firstTri: firstTri.subarray(0, ns) } : null;
}
// The colours of a mesh of several materials, as the OBJ and FBX writers write them: one entry a colour that a polygon wears (two
// materials of one colour are one), in the order of the material list, and the colour of each polygon written (the faces of
// _exportFaces, else each triangle). null: a mesh of one material.
function _exportFaceMats(meshObj, faces) {
  const mat = meshObj && meshObj.material, g = meshObj && meshObj.geometry;
  if (!Array.isArray(mat) || !g || !g.attributes.position) return null;
  const nTri = ((g.index ? g.index.count : g.attributes.position.count) / 3) | 0;
  const tm = FM.triMaterials(g.groups, nTri);
  const key = (m) => m && m.color ? m.color.getHexString() : 'cccccc';
  const byKey = new Map(), local = new Int32Array(mat.length), cand = [];
  for (let i = 0; i < mat.length; i++) { const k = key(mat[i]); let j = byKey.get(k); if (j === undefined) { j = cand.length; byKey.set(k, j); cand.push(mat[i]); } local[i] = j; }
  const nPoly = faces ? faces.sizes.length : nTri;
  const poly = new Int32Array(nPoly);
  for (let f = 0; f < nPoly; f++) { const t = faces ? faces.firstTri[f] : f; poly[f] = local[Math.min(tm[t] || 0, mat.length - 1)]; }
  const used = new Int32Array(cand.length).fill(-1), colours = [];
  for (let f = 0; f < nPoly; f++) { const c = poly[f]; if (used[c] < 0) used[c] = 1; }
  for (let c = 0; c < cand.length; c++) if (used[c] > 0) { used[c] = colours.length; const m = cand[c], col = m && m.color; colours.push({ r: col ? col.r : 0.8, g: col ? col.g : 0.8, b: col ? col.b : 0.8, mat: m }); }
  for (let f = 0; f < nPoly; f++) poly[f] = used[poly[f]];
  if (!colours.length) return null;
  return { colours, poly };
}
// The polygon of each triangle to write for a source geometry: the numbers it has (an OBJ or FBX file's own, or what Untriangulate
// left), else the four-sided pairs found as in Wireframe (a part that went through Triangulate stays triangles). null: triangles.
const _exportPolyCache = new WeakMap();
function _exportPolysOf(src) {
  if (!src || _triOnly.has(src)) return null;
  const own = _polyIds.get(src);
  if (own) return own;
  if (_exportPolyCache.has(src)) return _exportPolyCache.get(src);
  let out = null;
  try {
    const pos = src.attributes.position, tris = src.index ? src.index.count / 3 : pos.count / 3;
    if (tris > 0 && tris <= 400000) { const topo = MEDIT.buildTopology(_wireXYZ(pos, false), src.index ? src.index.array : null), q = MEDIT.pairQuads(topo); if (q.quads) out = q.polyOf; }
  } catch (_) { out = null; }
  _exportPolyCache.set(src, out);
  return out;
}

// Bake mesh.matrixWorld into a fresh typed-array of world-space positions
// and (inverse-transposed) normals. Returns { positions, normals?, indices? }
// where indices is a typed array if the source geometry was indexed.
// A part's pivot is the origin of its own mesh (Centre pivot moves it). In the file it is the Model's Lcl Translation, and the part's vertices are
// written around it, which is how Blender, Maya, Unreal, Cinema 4D and the loaders in three.js and Assimp all read a pivot. `world` is where
// the pivot is in the scene being written; `local` is the same point in the parent Model's space (the Lcl Translation; the groups are written
// at identity, so the two are the same unless a group carries a transform).
function _fbxPivotOf(meshObj) {
  meshObj.updateWorldMatrix(true, false);
  const world = new THREE.Vector3().setFromMatrixPosition(meshObj.matrixWorld);
  const local = world.clone();
  if (meshObj.parent) {
    meshObj.parent.updateWorldMatrix(true, false);
    local.applyMatrix4(new THREE.Matrix4().copy(meshObj.parent.matrixWorld).invert());
  }
  return { world, local };
}

// The part's own position, rotation and scale as the Lcl of its Model, so that the axis of a part that is turned in the scene is turned in the file
// too. The vertices stay in the part's own frame, with only `lin` (the turn into Y-up and the unit scale, the same for every part) put into them;
// the object carries what is left, `mesh.matrix * lin^-1`, which has no turn in it for a part that is not turned. FBX turns about X first, then Y,
// then Z (R = Rz Ry Rx: 'ZYX' in three). Returns null where that cannot be written truthfully (shear, a mirrored part): those are baked.
function _fbxLocalTRS(meshObj, lin) {
  meshObj.updateMatrix();
  const m = new THREE.Matrix4().copy(meshObj.matrix);
  if (lin) m.multiply(new THREE.Matrix4().copy(lin).invert());
  if (_matrixHasShear(m) || m.determinant() <= 0) return null;
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  m.decompose(p, q, sc);
  const e = new THREE.Euler().setFromQuaternion(q, 'ZYX'), D = 180 / Math.PI;
  return { t: [p.x, p.y, p.z], r: [e.x * D, e.y * D, e.z * D], s: [sc.x, sc.y, sc.z] };
}

// The UVs of a mesh for FBX's LayerElementUV (ByPolygonVertex, IndexToDirect): the vertex UVs as they are, and for every polygon corner,
// in PolygonVertexIndex order, the vertex it is. FBX counts V from the bottom and the scene from the top (every file is read that way
// round: see _ingestSceneRoot), so V is turned (1 - v) for the file. (It used to be turned only for a mesh drawn with a glTF texture, so
// the UVs of an untextured glTF model, and of everything once an OBJ or FBX could come in the other way round, were written mirrored.)
function _fbxUvData(meshObj, faces) {
  const g = meshObj.geometry, uvA = g && g.attributes.uv;
  if (!uvA || uvA.itemSize !== 2) return null;
  const flip = true;
  const uv = new Float64Array(uvA.count * 2);
  for (let i = 0; i < uvA.count; i++) { uv[i * 2] = uvA.getX(i); uv[i * 2 + 1] = flip ? 1 - uvA.getY(i) : uvA.getY(i); }
  const idx = g.index, n = faces ? faces.verts.length : idx ? idx.count : g.attributes.position.count;
  const uvIndex = new Int32Array(n);
  for (let i = 0; i < n; i++) uvIndex[i] = faces ? faces.verts[i] : idx ? idx.getX(i) : i;
  return { uv, uvIndex };
}
function _fbxBakeMeshGeom(meshObj, lin) {
  const g = meshObj.geometry;
  const posAttr = g.attributes.position;
  const norAttr = g.attributes.normal;
  const idxAttr = g.index;
  const trs = _fbxLocalTRS(meshObj, lin);
  const M = trs ? (lin || new THREE.Matrix4()) : meshObj.matrixWorld;      // (with a TRS the vertices only get the Y-up turn and the unit scale)
  const pivot = trs ? { world: new THREE.Vector3(), local: new THREE.Vector3() } : _fbxPivotOf(meshObj);
  const N = new THREE.Matrix3().getNormalMatrix(M);
  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();

  const out = {};
  const stride = posAttr.itemSize;
  const arr = posAttr.array;
  const positions = new Float64Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    tmpV.set(arr[i*stride], arr[i*stride+1], arr[i*stride+2]).applyMatrix4(M);
    positions[i*3]   = tmpV.x - pivot.world.x;
    positions[i*3+1] = tmpV.y - pivot.world.y;
    positions[i*3+2] = tmpV.z - pivot.world.z;
  }
  out.positions = positions;
  out.pivotLocal = pivot.local;                // (the Model's Lcl Translation)
  out.trs = trs;                               // (or all three of its Lcl, when the part can be written that way)

  // Build the indexed triangle list first — needed for the "ByPolygonVertex"
  // normal layout below. FBX wants the LAST index of every polygon to be
  // bitwise NOT (~i) so the parser can detect polygon ends. We always emit
  // triangulated geometry, so every 3rd index gets the NOT.
  const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
  // Quads and n-gons (see _exportFaces): one entry per corner of a polygon, the last of each polygon bitwise NOT.
  const faces = _exportFaces(g);
  const polyVertCount = faces ? faces.verts.length : triCount * 3;
  const indices = new Int32Array(polyVertCount);
  if (faces) {
    let o = 0;
    for (let f = 0; f < faces.sizes.length; f++) {
      const n = faces.sizes[f];
      for (let k = 0; k < n - 1; k++) { indices[o] = faces.verts[o]; o++; }
      indices[o] = ~faces.verts[o]; o++;
    }
  } else if (idxAttr) {
    const ai = idxAttr.array;
    for (let i = 0; i < ai.length; i += 3) {
      indices[i]   = ai[i];
      indices[i+1] = ai[i+1];
      indices[i+2] = ~ai[i+2];
    }
  } else {
    for (let i = 0; i < triCount; i++) {
      const j = i * 3;
      indices[j]   = j;
      indices[j+1] = j + 1;
      indices[j+2] = ~(j + 2);
    }
  }
  out.indices = indices;
  out.triCount = triCount;
  out.uvData = _fbxUvData(meshObj, faces);      // (null when the mesh has no UVs)
  out.faceMats = _exportFaceMats(meshObj, faces);      // (a part of several colours: see _exportFaceMats)

  if (norAttr) {
    // Use Direct layout: one normal per polygon-vertex, in polygon-vertex
    // order (same order as PolygonVertexIndex). This is what every reference
    // binary FBX (Blender 2.79, Assimp, Maya) uses and what the FBX SDK
    // expects by default. IndexToDirect is spec-valid but C4D / Houdini's
    // FBX SDK implementation has known issues with it for static meshes —
    // the SDK defaults to Direct when writing, so strict importers test it
    // more thoroughly. No NormalsIndex array needed.
    //
    // normalsDirect: one xyz triple per polygon-vertex.
    // Size = triCount * 3 * 3 doubles = polyVertCount * 3 doubles.
    const nArr = norAttr.array;
    const ns = norAttr.itemSize;
    const ai = idxAttr ? idxAttr.array : null;
    const normalsDirect = new Float64Array(polyVertCount * 3);
    for (let i = 0; i < polyVertCount; i++) {
      const vi = faces ? faces.verts[i] : ai ? ai[i] : i;   // raw vertex index (no polygon-end NOT)
      tmpN.set(nArr[vi*ns], nArr[vi*ns+1], nArr[vi*ns+2])
          .applyMatrix3(N).normalize();
      normalsDirect[i*3]     = tmpN.x;
      normalsDirect[i*3 + 1] = tmpN.y;
      normalsDirect[i*3 + 2] = tmpN.z;
    }
    out.normalsDirect = normalsDirect;
    // Keep a truthy flag so the geom-node builder knows normals exist.
    out.normals = normalsDirect;
  }
  return out;
}

// What an FBX says about itself in GlobalSettings. It used to say
// "centimetres, Y up" whatever was written:
//   Units. One scene unit is a millimetre (see _fmtLen), and the export's
//     own Unit scale changes what a unit of the file is. FBX gives its unit
//     in centimetres, so millimetres are 0.1. With 1 here Cinema 4D read a
//     2.6 m machine as 26 m.
//   Axes. "Keep as in the scene" writes the scene as it is; "Turn Z-up
//     into Y-up" turns it. The file has to say which way is up in what was
//     written, or a reader that follows the file's axes (Blender, Maya,
//     Unreal) turns a model that was already right. Cinema 4D does not turn
//     anything on import: it shows the numbers as they are.
function _fbxGlobals(opts) {
  const scale = opts && opts.scale > 0 ? opts.scale : 1;
  // "keep" keeps the scene's own up axis, which is Y for a scene shown Y up
  // (Scene settings): its data is Y up, whatever the option's label says.
  const yUp = !!(opts && opts.axis === 'y-up') || state.sceneUpAxis === 'y';
  return { unit: +(0.1 / scale).toPrecision(12), up: yUp ? 1 : 2, front: yUp ? 2 : 1, frontSign: yUp ? 1 : -1 };
}
async function _exportFbxBinary(root, opts) {
  const _fg = _fbxGlobals(opts);
  const { nodes } = _collectFbxScene(root);

  const GEOM_ID_BASE  = 100000000;
  const MODEL_ID_BASE = 200000000;
  const MAT_ID_BASE   = 300000000;
  // NodeAttribute IDs: every Model needs an associated NodeAttribute that
  // declares its kind ("Null" for groups, "Mesh" for meshes). C4D 2026's
  // world.cpp:1745 fails to build the scene when Models lack this — every
  // Blender FBX export includes them, which is why Blender's files load
  // in C4D and ours didn't.
  const NA_ID_BASE    = 400000000;

  // Bake one geometry per mesh node (no sharing — see ASCII writer note;
  // sharing requires Lcl Transform on the Mesh Model, which loses precision
  // on deeply-nested CAD imports).
  // Per-mesh materials too — Cinema 4D 2026's FBX importer fails to build
  // the document tree (world.cpp:1745 error) when a single Material is
  // connected to multiple Models. Inspecting C4D's own export confirms it
  // writes 1 material per mesh (no dedup). We follow the same convention
  // here. Slightly larger file (~601 Material entries instead of N unique
  // colors) but C4D-compatible.
  const meshIdxToGeomIdx = new Map();
  const meshIdxToMatIdx = new Map();      // per-mesh material index
  // The pictures of the materials, embedded in the file as Blender and Cinema 4D write them: a Video (the picture's bytes in Content,
  // and its file name) and a Texture that shows it, connected to the material's DiffuseColor or NormalMap. The colour map and the normal
  // map go out (the normal map drawn OpenGL's way up, as Blender, Unity and three read it); the other maps of a PBR material have no
  // slot in a Phong material.
  const FBX_TEX = [['map', 'DiffuseColor', 'BaseColor'], ['normalMap', 'NormalMap', 'Normal']];
  const fbxTex = new Map();               // texture → { idx, tex, kind, flipGreen, file, mime, bytes }
  const _fbxMapsOf = (mat) => FBX_TEX.filter(([k]) => mat && mat[k] && mat[k].isTexture && mat[k].image)
    .map(([k, prop, kind]) => {
      const t = mat[k];
      let e = fbxTex.get(t);
      if (!e) {
        // (a normal map whose green is not turned in the scene is drawn the DirectX way: written turned)
        const flipGreen = kind === 'Normal' && !!(mat.normalScale && (mat.normalScale.y < 0) === (mat.normalScale.x < 0));
        e = { idx: fbxTex.size, tex: t, kind, flipGreen };
        fbxTex.set(t, e);
      }
      return [prop, e];
    });
  const perMeshMats = [];                 // [{ r, g, b }, ...] one entry per colour (see below)
  const _binMatByColor = new Map();       // "r,g,b" → index in perMeshMats
  const bakedGeoms = [];   // index → { meshNodeIndex, baked }
  // Resolve the display colour for a node, falling back to vertex colours for
  // the merge-into-one path (material.vertexColors=true, no material.color).
  const _binResolveColor = (n) => {
    const rawMat = n.obj.material;
    const mat = Array.isArray(rawMat) ? rawMat[0] : rawMat;
    if (mat?.vertexColors && n.obj.geometry?.attributes?.color) {
      const ca = n.obj.geometry.attributes.color;
      return { r: ca.getX(0), g: ca.getY(0), b: ca.getZ(0) };
    }
    const c = mat?.color;
    return c ? { r: c.r, g: c.g, b: c.b } : { r: 0.8, g: 0.8, b: 0.8 };
  };
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'Mesh') continue;
    meshIdxToGeomIdx.set(i, bakedGeoms.length);
    bakedGeoms.push({ nodeIdx: i, baked: _fbxBakeMeshGeom(nodes[i].obj, root.userData.exportLin) });
    const _fmx = bakedGeoms[bakedGeoms.length - 1].baked.faceMats;
    if (_fmx && _fmx.colours.length > 1) {
      // A part of several colours: a material for each (shared with the meshes of that colour), connected in this order, and the
      // geometry's LayerElementMaterial says which polygon wears which (ByPolygon), as Cinema 4D and Blender write and read it.
      const list = [];
      for (const c of _fmx.colours) {
        const _ck = c.r.toFixed(4) + ',' + c.g.toFixed(4) + ',' + c.b.toFixed(4);
        let _ci = _binMatByColor.get(_ck);
        if (_ci === undefined) { _ci = perMeshMats.length; _binMatByColor.set(_ck, _ci); perMeshMats.push({ r: c.r, g: c.g, b: c.b }); }
        list.push(_ci);
      }
      meshIdxToMatIdx.set(i, list);
      continue;
    }
    const { r, g, b } = _fmx ? _fmx.colours[0] : _binResolveColor(nodes[i]);
    const _maps = _fbxMapsOf(Array.isArray(nodes[i].obj.material) ? nodes[i].obj.material[0] : nodes[i].obj.material);
    // One material per colour, shared by the meshes that wear it. (This used
    // to write one per mesh, on the belief that Cinema 4D could not build a
    // file in which models share a material. That was read off files it
    // refused for another reason, the file id; with that put right it loads
    // shared materials, as it always did from the ASCII writer: 778 meshes
    // came in with 778 materials, now with the scene's own few dozen.)
    const _mk = r.toFixed(4) + ',' + g.toFixed(4) + ',' + b.toFixed(4) + _maps.map(([prop, e]) => '|' + prop + ':' + e.idx).join('');      // (with its maps: two white materials with different pictures stay two)
    let _mIdx = _binMatByColor.get(_mk);
    if (_mIdx === undefined) { _mIdx = perMeshMats.length; _binMatByColor.set(_mk, _mIdx); perMeshMats.push({ r, g, b, maps: _maps }); }
    meshIdxToMatIdx.set(i, _mIdx);
  }

  if (fbxTex.size) {
    let tUndo = null;
    try {
      tUndo = setExportTextureFormats(root);      // (each picture in the format of its own file: texformat.js)
      for (const e of fbxTex.values()) { e.mime = (e.tex.userData && e.tex.userData.mimeType) || 'image/png'; e.file = 'Texture_' + e.idx + '_' + e.kind + (e.mime === 'image/jpeg' ? '.jpg' : '.png'); }
    } finally { if (tUndo) tUndo(); }
    const got = new Map((await _objTextureFiles([...fbxTex.values()])).map(f => [f.name, f.blob]));
    for (const e of fbxTex.values()) { const b = got.get(e.file); e.bytes = b ? new Uint8Array(await b.arrayBuffer()) : null; }
  }
  const safeName = (s) => (s || 'unnamed').replace(/["\\]/g, '_').replace(/[\x00-\x1f]/g, '_');

  // Choose a binary type code per "Properties70 P-record" entry. The first
  // type-string slot (t1) tells us the FBX semantic type; we map that to
  // the appropriate scalar code so importers (Maya, Blender) read each
  // value back at its declared precision instead of treating everything
  // as a float (which works for Cinema 4D but corrupts e.g. enum values
  // that should stay as integers).
  const numTypeFor = (t1) => {
    // FBX 'bool' properties are encoded as INT32 even though the type
    // string is "bool". Blender's importer asserts INT32 for bool props
    // (io_scene_fbx/import_fbx.py:269) and rejects the file otherwise.
    // C4D's own export confirms this: P "TranslationActive" "bool" "" "" I:0.
    if (t1 === 'int' || t1 === 'Integer' || t1 === 'enum' || t1 === 'bool') return 'I';
    if (t1 === 'KTime') return 'L';
    return 'D';
  };
  const P = (name, t1, t2, t3, ...vals) => {
    const props = [
      { type: 'S', value: name },
      { type: 'S', value: t1 },
      { type: 'S', value: t2 },
      { type: 'S', value: t3 },
    ];
    const numCode = numTypeFor(t1);
    for (const v of vals) {
      if (typeof v === 'number') {
        if (numCode === 'I') props.push({ type: 'I', value: v | 0 });
        else if (numCode === 'L') props.push({ type: 'L', value: v });
        else props.push({ type: 'D', value: v });
      } else if (typeof v === 'string') {
        props.push({ type: 'S', value: v });
      } else if (typeof v === 'boolean') {
        // FBX 'bool' properties are int32, not 'C' bytes — see numTypeFor.
        props.push({ type: 'I', value: v ? 1 : 0 });
      } else {
        props.push({ type: 'I', value: v });
      }
    }
    return { name: 'P', props };
  };

  // ── Build node tree ────────────────────────────────────────────────────
  const now = new Date();
  const tree = [];

  tree.push({
    name: 'FBXHeaderExtension', props: [], children: [
      { name: 'FBXHeaderVersion', props: [{ type: 'I', value: 1003 }] },
      { name: 'FBXVersion', props: [{ type: 'I', value: 7400 }] },
      { name: 'EncryptionType', props: [{ type: 'I', value: 0 }] },
      { name: 'CreationTimeStamp', props: [], children: [
        { name: 'Version', props: [{ type: 'I', value: 1000 }] },
        { name: 'Year',    props: [{ type: 'I', value: now.getFullYear() }] },
        { name: 'Month',   props: [{ type: 'I', value: now.getMonth() + 1 }] },
        { name: 'Day',     props: [{ type: 'I', value: now.getDate() }] },
        { name: 'Hour',    props: [{ type: 'I', value: now.getHours() }] },
        { name: 'Minute',  props: [{ type: 'I', value: now.getMinutes() }] },
        { name: 'Second',  props: [{ type: 'I', value: now.getSeconds() }] },
        { name: 'Millisecond', props: [{ type: 'I', value: 0 }] },
      ]},
      // The Creator string, and the SceneInfo records below with their
      // "/foobar.fbx" placeholder paths, are deliberately the ones Blender's
      // FBX exporter writes. This is a compatibility choice, not a leftover:
      // this writer follows Blender's layout node for node, and importers
      // (Cinema 4D 2026 above all, which rejected earlier versions of this
      // file) read these records to decide how to treat what follows.
      // Blender's is the most widely tested writer, so its identity is the
      // one every importer accepts. Do not "correct" them to MeshOptimiser
      // without re-testing in Cinema 4D, Maya and Houdini.
      { name: 'Creator', props: [{ type: 'S', value: 'Blender (stable FBX IO) - 4.1.0 - 4.27.1' }] },
      // OtherFlags block removed — Blender doesn't write it and it's not
      // required. C4D may have been treating its presence (with our
      // arbitrary TCDefinition value) as malformed.
      // SceneInfo block — Maya/Cinema 4D treat its absence as malformed.
      // The minimum that satisfies them: type, version, MetaData, Properties70.
      { name: 'SceneInfo',
        props: [
          { type: 'S', value: 'GlobalInfo\x00\x01SceneInfo' },
          { type: 'S', value: 'UserData' },
        ],
        children: [
          { name: 'Type', props: [{ type: 'S', value: 'UserData' }] },
          { name: 'Version', props: [{ type: 'I', value: 100 }] },
          { name: 'MetaData', props: [], children: [
            { name: 'Version', props: [{ type: 'I', value: 100 }] },
            { name: 'Title',    props: [{ type: 'S', value: '' }] },
            { name: 'Subject',  props: [{ type: 'S', value: '' }] },
            { name: 'Author',   props: [{ type: 'S', value: '' }] },
            { name: 'Keywords', props: [{ type: 'S', value: '' }] },
            { name: 'Revision', props: [{ type: 'S', value: '' }] },
            { name: 'Comment',  props: [{ type: 'S', value: '' }] },
          ]},
          // Full 14 P-records exactly matching Blender's SceneInfo. C4D
          // 2026 reads these to identify the file source — incomplete sets
          // contribute to the world.cpp:1745 rejection.
          { name: 'Properties70', props: [], children: [
            P('DocumentUrl', 'KString', 'Url', '', '/foobar.fbx'),
            P('SrcDocumentUrl', 'KString', 'Url', '', '/foobar.fbx'),
            P('Original', 'Compound', '', ''),
            P('Original|ApplicationVendor', 'KString', '', '', 'Blender Foundation'),
            P('Original|ApplicationName', 'KString', '', '', 'Blender (stable FBX IO)'),
            P('Original|ApplicationVersion', 'KString', '', '', '4.1.0'),
            P('Original|DateTime_GMT', 'DateTime', '', '', '01/01/1970 00:00:00.000'),
            P('Original|FileName', 'KString', '', '', '/foobar.fbx'),
            P('LastSaved', 'Compound', '', ''),
            P('LastSaved|ApplicationVendor', 'KString', '', '', 'Blender Foundation'),
            P('LastSaved|ApplicationName', 'KString', '', '', 'Blender (stable FBX IO)'),
            P('LastSaved|ApplicationVersion', 'KString', '', '', '4.1.0'),
            P('LastSaved|DateTime_GMT', 'DateTime', '', '', '01/01/1970 00:00:00.000'),
            P('Original|ApplicationNativeFile', 'KString', '', '', ''),
          ]},
        ],
      },
    ],
  });

  // FileId, CreationTime and the footer code at the end of the file belong
  // together: the FBX SDK (Cinema 4D, Maya) works the other two out from
  // the time and refuses the file ("cannot read") when they do not agree.
  // These are the three Blender writes, a set known to agree. A random id
  // with today's time, as this used to write, opened in Blender and
  // three.js, which do not check, and in nothing built on the SDK.
  // (Tested in Cinema 4D 2026.4: with only the footer or only the time put
  // right the file is still refused; with all three it loads.)
  // The real time of the export is in FBXHeaderExtension/CreationTimeStamp.
  const fileId = new Uint8Array([0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1]);
  tree.push({ name: 'FileId', props: [{ type: 'R', value: fileId }] });
  tree.push({ name: 'CreationTime', props: [{ type: 'S', value: '1970-01-01 10:00:00:000' }] });
  tree.push({ name: 'Creator', props: [{ type: 'S', value: 'Blender (stable FBX IO) - 4.1.0 - 4.27.1' }] });

  tree.push({
    name: 'GlobalSettings', props: [], children: [
      { name: 'Version', props: [{ type: 'I', value: 1000 }] },
      { name: 'Properties70', props: [], children: [
        P('UpAxis', 'int', 'Integer', '', _fg.up),
        P('UpAxisSign', 'int', 'Integer', '', 1),
        P('FrontAxis', 'int', 'Integer', '', _fg.front),
        P('FrontAxisSign', 'int', 'Integer', '', _fg.frontSign),
        P('CoordAxis', 'int', 'Integer', '', 0),
        P('CoordAxisSign', 'int', 'Integer', '', 1),
        P('OriginalUpAxis', 'int', 'Integer', '', -1),     // Blender writes -1, not 1
        P('OriginalUpAxisSign', 'int', 'Integer', '', 1),
        P('UnitScaleFactor', 'double', 'Number', '', _fg.unit),
        P('OriginalUnitScaleFactor', 'double', 'Number', '', 1),
        P('AmbientColor', 'ColorRGB', 'Color', '', 0, 0, 0),
        P('DefaultCamera', 'KString', '', '', 'Producer Perspective'),
        P('TimeMode', 'enum', '', '', 11),
        P('TimeSpanStart', 'KTime', 'Time', '', 0),
        P('TimeSpanStop', 'KTime', 'Time', '', 46186158000),
        P('CustomFrameRate', 'double', 'Number', '', 24),  // Blender includes this; missing made our P-count = 15 instead of 16
      ]},
    ],
  });

  // ── Documents / References / Takes ──────────────────────────────────────
  // C4D and Maya treat these top-level nodes as required even though they
  // mostly hold placeholder data. Documents binds the scene root; Takes
  // declares animation tracks (we have none); References is empty.
  // Document ID — Cinema 4D uses huge unique IDs (~2 trillion); using a
  // small value like 1 has been observed to make C4D's document-builder
  // mistreat the Document as a sentinel/placeholder. Generate a random
  // 53-bit value (safely representable as a JS number, fits int64).
  const docId = Math.floor(Math.random() * 0x1FFFFFFFFFFFFF);
  tree.push({
    name: 'Documents', props: [], children: [
      { name: 'Count', props: [{ type: 'I', value: 1 }] },
      { name: 'Document',
        props: [
          { type: 'L', value: docId },
          { type: 'S', value: 'Scene' },         // name (Blender uses 'Scene', not '')
          { type: 'S', value: 'Scene' },         // type
        ],
        children: [
          { name: 'Properties70', props: [], children: [
            P('SourceObject', 'object', '', ''),
            P('ActiveAnimStackName', 'KString', '', '', ''),
          ]},
          { name: 'RootNode', props: [{ type: 'L', value: 0 }] },
        ],
      },
    ],
  });
  tree.push({ name: 'References', props: [], children: [] });

  // ── Definitions ─────────────────────────────────────────────────────────
  tree.push({
    name: 'Definitions', props: [], children: [
      { name: 'Version', props: [{ type: 'I', value: 100 }] },
      // Count = number of distinct ObjectType template blocks, NOT total objects.
      // Blender 2.79 writes 3 (GlobalSettings + Geometry + Model) for a scene
      // with 1 of each — confirming this is a template count, not the total
      // object count. The prior formula (sum of all Geometry + Model + Material
      // + NodeAttribute counts) could produce values like 3316 for large CAD
      // scenes, which is technically wrong even if FBX SDK treats it as
      // informational.
      { name: 'Count', props: [{ type: 'I', value:
          1 +                                              // GlobalSettings
          (bakedGeoms.length > 0 ? 1 : 0) +               // Geometry
          (nodes.length > 0 ? 1 : 0) +                    // Model
          (perMeshMats.length > 0 ? 1 : 0) +              // Material
          (nodes.some(n => n.type === 'Null') ? 1 : 0)    // NodeAttribute
      }] },
      { name: 'ObjectType', props: [{ type: 'S', value: 'GlobalSettings' }], children: [
        { name: 'Count', props: [{ type: 'I', value: 1 }] },
      ]},
      { name: 'ObjectType', props: [{ type: 'S', value: 'Geometry' }], children: [
        { name: 'Count', props: [{ type: 'I', value: bakedGeoms.length }] },
        { name: 'PropertyTemplate', props: [{ type: 'S', value: 'FbxMesh' }], children: [
          // Full canonical FbxMesh template — Cinema 4D 2026 cross-checks
          // every property an object overrides against the template; missing
          // base properties make C4D reject the entire file as malformed.
          { name: 'Properties70', props: [], children: [
            P('Color', 'ColorRGB', 'Color', '', 0.8, 0.8, 0.8),
            P('BBoxMin', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('BBoxMax', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('Primary Visibility', 'bool', '', '', 1),
            P('Casts Shadows', 'bool', '', '', 1),
            P('Receive Shadows', 'bool', '', '', 1),
          ]},
        ]},
      ]},
      { name: 'ObjectType', props: [{ type: 'S', value: 'Model' }], children: [
        { name: 'Count', props: [{ type: 'I', value: nodes.length }] },
        { name: 'PropertyTemplate', props: [{ type: 'S', value: 'FbxNode' }], children: [
          // Full canonical FbxNode template (~70 P-records) — what FBX SDK
          // / Cinema 4D / Maya / 3ds Max all write for the Model object
          // type. Order follows the FBX SDK's canonical template.
          { name: 'Properties70', props: [], children: [
            P('QuaternionInterpolate', 'enum', '', '', 0),
            P('RotationOffset', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('RotationPivot', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('ScalingOffset', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('ScalingPivot', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('TranslationActive', 'bool', '', '', 0),
            P('TranslationMin', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('TranslationMax', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('TranslationMinX', 'bool', '', '', 0),
            P('TranslationMinY', 'bool', '', '', 0),
            P('TranslationMinZ', 'bool', '', '', 0),
            P('TranslationMaxX', 'bool', '', '', 0),
            P('TranslationMaxY', 'bool', '', '', 0),
            P('TranslationMaxZ', 'bool', '', '', 0),
            P('RotationOrder', 'enum', '', '', 0),
            P('RotationSpaceForLimitOnly', 'bool', '', '', 0),
            P('RotationStiffnessX', 'double', 'Number', '', 0),
            P('RotationStiffnessY', 'double', 'Number', '', 0),
            P('RotationStiffnessZ', 'double', 'Number', '', 0),
            P('AxisLen', 'double', 'Number', '', 10),
            P('PreRotation', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('PostRotation', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('RotationActive', 'bool', '', '', 0),
            P('RotationMin', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('RotationMax', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('RotationMinX', 'bool', '', '', 0),
            P('RotationMinY', 'bool', '', '', 0),
            P('RotationMinZ', 'bool', '', '', 0),
            P('RotationMaxX', 'bool', '', '', 0),
            P('RotationMaxY', 'bool', '', '', 0),
            P('RotationMaxZ', 'bool', '', '', 0),
            P('InheritType', 'enum', '', '', 0),
            P('ScalingActive', 'bool', '', '', 0),
            P('ScalingMin', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('ScalingMax', 'Vector3D', 'Vector', '', 1, 1, 1),
            P('ScalingMinX', 'bool', '', '', 0),
            P('ScalingMinY', 'bool', '', '', 0),
            P('ScalingMinZ', 'bool', '', '', 0),
            P('ScalingMaxX', 'bool', '', '', 0),
            P('ScalingMaxY', 'bool', '', '', 0),
            P('ScalingMaxZ', 'bool', '', '', 0),
            P('GeometricTranslation', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('GeometricRotation', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('GeometricScaling', 'Vector3D', 'Vector', '', 1, 1, 1),
            P('MinDampRangeX', 'double', 'Number', '', 0),
            P('MinDampRangeY', 'double', 'Number', '', 0),
            P('MinDampRangeZ', 'double', 'Number', '', 0),
            P('MaxDampRangeX', 'double', 'Number', '', 0),
            P('MaxDampRangeY', 'double', 'Number', '', 0),
            P('MaxDampRangeZ', 'double', 'Number', '', 0),
            P('MinDampStrengthX', 'double', 'Number', '', 0),
            P('MinDampStrengthY', 'double', 'Number', '', 0),
            P('MinDampStrengthZ', 'double', 'Number', '', 0),
            P('MaxDampStrengthX', 'double', 'Number', '', 0),
            P('MaxDampStrengthY', 'double', 'Number', '', 0),
            P('MaxDampStrengthZ', 'double', 'Number', '', 0),
            P('PreferedAngleX', 'double', 'Number', '', 0),
            P('PreferedAngleY', 'double', 'Number', '', 0),
            P('PreferedAngleZ', 'double', 'Number', '', 0),
            P('LookAtProperty', 'object', '', ''),
            P('UpVectorProperty', 'object', '', ''),
            P('Show', 'bool', '', '', 1),
            P('NegativePercentShapeSupport', 'bool', '', '', 1),
            P('DefaultAttributeIndex', 'int', 'Integer', '', -1),
            P('Freeze', 'bool', '', '', 0),
            P('LODBox', 'bool', '', '', 0),
            P('Lcl Translation', 'Lcl Translation', '', 'A', 0, 0, 0),
            P('Lcl Rotation', 'Lcl Rotation', '', 'A', 0, 0, 0),
            P('Lcl Scaling', 'Lcl Scaling', '', 'A', 1, 1, 1),
            P('Visibility', 'Visibility', '', 'A', 1),
            P('Visibility Inheritance', 'Visibility Inheritance', '', '', 1),
          ]},
        ]},
      ]},
      { name: 'ObjectType', props: [{ type: 'S', value: 'Material' }], children: [
        { name: 'Count', props: [{ type: 'I', value: perMeshMats.length }] },
        { name: 'PropertyTemplate', props: [{ type: 'S', value: 'FbxSurfacePhong' }], children: [
          // Full canonical FbxSurfacePhong template — every CAD/DCC tool's
          // Phong material derives from this base set of properties.
          { name: 'Properties70', props: [], children: [
            P('ShadingModel', 'KString', '', '', 'Phong'),
            P('MultiLayer', 'bool', '', '', 0),
            P('EmissiveColor', 'Color', '', 'A', 0, 0, 0),
            P('EmissiveFactor', 'Number', '', 'A', 1),
            P('AmbientColor', 'Color', '', 'A', 0.2, 0.2, 0.2),
            P('AmbientFactor', 'Number', '', 'A', 1),
            P('DiffuseColor', 'Color', '', 'A', 0.8, 0.8, 0.8),
            P('DiffuseFactor', 'Number', '', 'A', 1),
            P('Bump', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('NormalMap', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('BumpFactor', 'double', 'Number', '', 1),
            P('TransparentColor', 'Color', '', 'A', 0, 0, 0),
            P('TransparencyFactor', 'Number', '', 'A', 0),
            P('DisplacementColor', 'ColorRGB', 'Color', '', 0, 0, 0),
            P('DisplacementFactor', 'double', 'Number', '', 1),
            P('VectorDisplacementColor', 'ColorRGB', 'Color', '', 0, 0, 0),
            P('VectorDisplacementFactor', 'double', 'Number', '', 1),
            P('SpecularColor', 'Color', '', 'A', 0.2, 0.2, 0.2),
            P('SpecularFactor', 'Number', '', 'A', 1),
            P('ShininessExponent', 'Number', '', 'A', 20),
            P('ReflectionColor', 'Color', '', 'A', 0, 0, 0),
            P('ReflectionFactor', 'Number', '', 'A', 1),
          ]},
        ]},
      ]},
      // NodeAttribute — only include this ObjectType block when there are
      // actually Null/group nodes. Writing it with Count=0 would make
      // Definitions.Count disagree with the actual number of ObjectType
      // blocks, which strict FBX SDK parsers (C4D, Houdini) treat as
      // malformed. Blender omits this block entirely when there are no Null
      // nodes.
      ...(nodes.some(n => n.type === 'Null') ? [{
        name: 'ObjectType', props: [{ type: 'S', value: 'NodeAttribute' }], children: [
          { name: 'Count', props: [{ type: 'I', value: nodes.filter(n => n.type === 'Null').length }] },
        ],
      }] : []),
    ],
  });

  // ── Objects ─────────────────────────────────────────────────────────────
  // Order matches Blender exactly: NodeAttribute → Geometry → Model →
  // Material. C4D's scene-construction pass walks Objects in document
  // order resolving references; NodeAttribute must come BEFORE the Model
  // that references it, or world.cpp:1745 fails with an unresolved
  // reference. Build each type into its own bucket then concat at the end.
  const naBlocks = [];
  const geomBlocks = [];
  const modelBlocks = [];
  const matBlocks = [];
  const texBlocks = [], vidBlocks = [];
  const texWritten = [...fbxTex.values()].filter(e => e.bytes);
  if (texWritten.length) {
    const defs = tree.find(n => n.name === 'Definitions');
    const cnt = defs.children.find(c => c.name === 'Count');
    if (cnt) cnt.props[0].value += 2;
    defs.children.push(
      { name: 'ObjectType', props: [{ type: 'S', value: 'Texture' }], children: [{ name: 'Count', props: [{ type: 'I', value: texWritten.length }] }] },
      { name: 'ObjectType', props: [{ type: 'S', value: 'Video' }], children: [{ name: 'Count', props: [{ type: 'I', value: texWritten.length }] }] });
  }
  const TEX_ID_BASE = 500000000, VID_ID_BASE = 600000000;

  for (let gi = 0; gi < bakedGeoms.length; gi++) {
    const { nodeIdx, baked } = bakedGeoms[gi];
    const geomId = GEOM_ID_BASE + gi;
    const o = nodes[nodeIdx].obj;
    // CRITICAL: every Geometry name must be UNIQUE. Blender writes them
    // as "Mesh", "Mesh.001", "Mesh.002", ... — duplicate names confuse
    // C4D's scene-construction pass even when IDs are unique. Earlier we
    // were emitting "Mesh" for every single Geometry, which is exactly
    // what C4D's world.cpp:1745 was choking on.
    const name = gi === 0
      ? `Mesh\x00\x01Geometry`
      : `Mesh.${String(gi).padStart(3, '0')}\x00\x01Geometry`;
    // Order matches Blender's FBX exporter exactly: empty Properties70
    // FIRST, then GeometryVersion, then Vertices, then PolygonVertexIndex.
    // C4D 2026's parser requires GeometryVersion to come BEFORE the vertex
    // / index arrays — placing it after made C4D's world.cpp:1745 reject
    // the file. Blender's writer is the de-facto reference for "any DCC
    // tool reads it" because it's been hardened against every importer's
    // quirks over many years.
    const geomNode = {
      name: 'Geometry',
      props: [{ type: 'L', value: geomId }, { type: 'S', value: name }, { type: 'S', value: 'Mesh' }],
      children: [
        { name: 'Properties70', props: [], children: [] },
        { name: 'GeometryVersion', props: [{ type: 'I', value: 124 }] },
        { name: 'Vertices', props: [{ type: 'd', value: baked.positions }] },
        { name: 'PolygonVertexIndex', props: [{ type: 'i', value: baked.indices }] },
      ],
    };
    if (baked.normals) {
      // ByPolygonVertex + Direct — one normal per polygon-vertex in
      // PolygonVertexIndex order. No NormalsIndex array needed.
      // Blender 2.79, Maya and the reference FBX SDK files all use this layout.
      // _fbxBakeMeshGeom builds normalsDirect with size = triCount*3*3 doubles.
      geomNode.children.push({
        name: 'LayerElementNormal',
        props: [{ type: 'I', value: 0 }],
        children: [
          { name: 'Version', props: [{ type: 'I', value: 101 }] },
          { name: 'Name', props: [{ type: 'S', value: '' }] },
          { name: 'MappingInformationType', props: [{ type: 'S', value: 'ByPolygonVertex' }] },
          { name: 'ReferenceInformationType', props: [{ type: 'S', value: 'Direct' }] },
          { name: 'Normals', props: [{ type: 'd', value: baked.normalsDirect }] },
        ],
      });
    }
    if (baked.uvData) {
      geomNode.children.push({
        name: 'LayerElementUV',
        props: [{ type: 'I', value: 0 }],
        children: [
          { name: 'Version', props: [{ type: 'I', value: 101 }] },
          { name: 'Name', props: [{ type: 'S', value: 'UVMap' }] },
          { name: 'MappingInformationType', props: [{ type: 'S', value: 'ByPolygonVertex' }] },
          { name: 'ReferenceInformationType', props: [{ type: 'S', value: 'IndexToDirect' }] },
          { name: 'UV', props: [{ type: 'd', value: baked.uvData.uv }] },
          { name: 'UVIndex', props: [{ type: 'i', value: baked.uvData.uvIndex }] },
        ],
      });
    }
    // AllSame material layout — Blender uses this for single-material
    // meshes and it loads in C4D 2026. We earlier had ByPolygon thinking
    // C4D needed it; that was wrong (the per-polygon Materials array was
    // probably triggering its own scene-construction error).
    // (a part of several colours: ByPolygon, a material number for each polygon, in the order the materials are connected)
    const _multi = baked.faceMats && baked.faceMats.colours.length > 1;
    geomNode.children.push({
      name: 'LayerElementMaterial',
      props: [{ type: 'I', value: 0 }],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 101 }] },
        { name: 'Name', props: [{ type: 'S', value: '' }] },
        { name: 'MappingInformationType', props: [{ type: 'S', value: _multi ? 'ByPolygon' : 'AllSame' }] },
        { name: 'ReferenceInformationType', props: [{ type: 'S', value: 'IndexToDirect' }] },
        { name: 'Materials', props: [{ type: 'i', value: _multi ? baked.faceMats.poly : new Int32Array([0]) }] },
      ],
    });
    const layerChildren = [{ name: 'Version', props: [{ type: 'I', value: 100 }] }];
    if (baked.normals) {
      layerChildren.push({ name: 'LayerElement', props: [], children: [
        { name: 'Type', props: [{ type: 'S', value: 'LayerElementNormal' }] },
        { name: 'TypedIndex', props: [{ type: 'I', value: 0 }] },
      ]});
    }
    if (baked.uvData) {
      layerChildren.push({ name: 'LayerElement', props: [], children: [
        { name: 'Type', props: [{ type: 'S', value: 'LayerElementUV' }] },
        { name: 'TypedIndex', props: [{ type: 'I', value: 0 }] },
      ]});
    }
    layerChildren.push({ name: 'LayerElement', props: [], children: [
      { name: 'Type', props: [{ type: 'S', value: 'LayerElementMaterial' }] },
      { name: 'TypedIndex', props: [{ type: 'I', value: 0 }] },
    ]});
    geomNode.children.push({ name: 'Layer', props: [{ type: 'I', value: 0 }], children: layerChildren });
    geomBlocks.push(geomNode);
  }

  // Models. Mesh Models carry the part's pivot as their Lcl Translation (rotation
  // and scale are baked into the vertices, which are written around the pivot);
  // Null Models get their decomposed local matrix (identity in practice
  // since buildExportRoot creates containers at identity).
  //
  // CRITICAL: Model names must be unique across the entire scene. C4D's
  // scene-construction pass uses names as disambiguators alongside IDs;
  // even with unique IDs, two Models sharing the same name (e.g. two
  // groups both named "Group") trigger world.cpp:1745. Track seen names
  // and append an index suffix to duplicates.
  const seenModelNames = new Map();   // base name → next suffix
  const seenNANames = new Map();      // same for NodeAttribute names
  const tmpQ = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpV3 = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const RAD2DEG = 180 / Math.PI;
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    const o = n.obj;
    const modelId = MODEL_ID_BASE + ni;
    // C4D writes Model names as `name\x00\x01Model` (no Class:: prefix).
    // De-duplicate by appending an index suffix to repeated base names.
    let baseName = safeName(o.name || (n.type === 'Mesh' ? `mesh_${ni}` : `group_${ni}`));
    const seenN = seenModelNames.get(baseName) || 0;
    if (seenN > 0) baseName = `${baseName}.${String(seenN).padStart(3, '0')}`;
    seenModelNames.set(safeName(o.name || (n.type === 'Mesh' ? `mesh_${ni}` : `group_${ni}`)), seenN + 1);
    const name = `${baseName}\x00\x01Model`;
    let tx=0,ty=0,tz=0,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1;
    if (n.type === 'Mesh') {
      // The part's pivot: rotation and scale stay baked into the vertices, the position is the Model's.
      const bk = bakedGeoms[meshIdxToGeomIdx.get(ni)]?.baked;
      if (bk && bk.trs) { [tx, ty, tz] = bk.trs.t; [rx, ry, rz] = bk.trs.r; [sx, sy, sz] = bk.trs.s; }
      else if (bk && bk.pivotLocal) { tx = bk.pivotLocal.x; ty = bk.pivotLocal.y; tz = bk.pivotLocal.z; }
    } else {
      o.updateMatrix();
      o.matrix.decompose(tmpV3, tmpQ, tmpScale);
      tmpEuler.setFromQuaternion(tmpQ, 'XYZ');
      tx = tmpV3.x; ty = tmpV3.y; tz = tmpV3.z;
      rx = tmpEuler.x * RAD2DEG; ry = tmpEuler.y * RAD2DEG; rz = tmpEuler.z * RAD2DEG;
      sx = tmpScale.x; sy = tmpScale.y; sz = tmpScale.z;
    }
    // Order + child set matches Blender's FBX exporter exactly. The
    // canonical Model child sequence Blender writes (and that loads in
    // every DCC tool) is:
    //   Version, Properties70 (with DefaultAttributeIndex + InheritType +
    //   Lcl Transform), MultiLayer, MultiTake, Shading, Culling.
    // C4D's world.cpp parser walks Models expecting MultiLayer/MultiTake
    // top-level children right after Properties70 — without them the
    // document-construction step asserts.
    modelBlocks.push({
      name: 'Model',
      props: [{ type: 'L', value: modelId }, { type: 'S', value: name }, { type: 'S', value: n.type }],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 232 }] },
        { name: 'Properties70', props: [], children: [
          P('DefaultAttributeIndex', 'int', 'Integer', '', 0),
          P('InheritType', 'enum', '', '', 1),
          P('Lcl Translation', 'Lcl Translation', '', 'A', tx, ty, tz),
          P('Lcl Rotation', 'Lcl Rotation', '', 'A', rx, ry, rz),
          P('Lcl Scaling', 'Lcl Scaling', '', 'A', sx, sy, sz),
        ]},
        // Blender writes MultiLayer + MultiTake as required Model children.
        { name: 'MultiLayer', props: [{ type: 'I', value: 0 }] },
        { name: 'MultiTake', props: [{ type: 'I', value: 0 }] },
        // Shading: binary FBX 'C' type is a boolean byte — valid values are
        // 0 (false) or 1 (true). ASCII FBX writes the letter 'Y' but binary
        // must use the integer 1. Writing 89 ('Y') is wrong and causes strict
        // SDK parsers (C4D, Houdini, Maya) to reject the Model node.
        { name: 'Shading', props: [{ type: 'C', value: 1 }] },
        { name: 'Culling', props: [{ type: 'S', value: 'CullingOff' }] },
      ],
    });
  }

  // ── NodeAttribute blocks. CRITICAL: Blender writes NodeAttribute ONLY
  // for Null/group nodes — NOT for Mesh nodes. Mesh nodes get their
  // attribute from the Geometry block via OO connection (Geometry → Model).
  // Writing a NodeAttribute for a Mesh Model produces a duplicate-attribute
  // condition that C4D's world.cpp:1745 rejects. Track which node indices
  // get a NodeAttribute so the connection loop only emits matching edges.
  const nodeHasAttr = new Set();        // node indices that get a NodeAttribute
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    if (n.type !== 'Null') continue;    // Mesh nodes use Geometry, not NodeAttribute
    nodeHasAttr.add(ni);
    const naId = NA_ID_BASE + ni;
    // Same de-dup as Model names: append a suffix to repeated base names.
    let baseName = safeName(n.obj.name || `group_${ni}`);
    const seenN = seenNANames.get(baseName) || 0;
    if (seenN > 0) baseName = `${baseName}.${String(seenN).padStart(3, '0')}`;
    seenNANames.set(safeName(n.obj.name || `group_${ni}`), seenN + 1);
    const naName = `${baseName}\x00\x01NodeAttribute`;
    naBlocks.push({
      name: 'NodeAttribute',
      props: [
        { type: 'L', value: naId },
        { type: 'S', value: naName },
        { type: 'S', value: 'Null' },
      ],
      children: [
        { name: 'TypeFlags', props: [{ type: 'S', value: 'Null' }] },
        { name: 'Properties70', props: [], children: [] },
      ],
    });
  }

  for (let mi = 0; mi < perMeshMats.length; mi++) {
    const m = perMeshMats[mi];
    const matId = MAT_ID_BASE + mi;
    // C4D writes Material names as `Mat_X\x00\x01Material` (no Class:: prefix).
    const name = `Mat_${mi}\x00\x01Material`;
    matBlocks.push({
      name: 'Material',
      props: [{ type: 'L', value: matId }, { type: 'S', value: name }, { type: 'S', value: '' }],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 102 }] },
        { name: 'ShadingModel', props: [{ type: 'S', value: 'Phong' }] },
        { name: 'MultiLayer', props: [{ type: 'I', value: 0 }] },
        { name: 'Properties70', props: [], children: [
          P('ShadingModel', 'KString', '', '', 'Phong'),
          P('DiffuseColor', 'Color', '', 'A', m.r, m.g, m.b),
          P('DiffuseFactor', 'Number', '', 'A', 1),
          P('AmbientColor', 'Color', '', 'A', 0, 0, 0),
          P('AmbientFactor', 'Number', '', 'A', 0),
          P('SpecularColor', 'Color', '', 'A', 0.2, 0.2, 0.2),
          P('SpecularFactor', 'Number', '', 'A', 0.5),
          P('Shininess', 'double', 'Number', '', 20),
          P('ShininessExponent', 'double', 'Number', '', 20),
          P('TransparencyFactor', 'Number', '', 'A', 0),
          P('ReflectionFactor', 'Number', '', 'A', 0),
        ]},
      ],
    });
  }

  for (const e of texWritten) {
    const stem = e.file.replace(/\.[^.]+$/, '');
    vidBlocks.push({
      name: 'Video',
      props: [{ type: 'L', value: VID_ID_BASE + e.idx }, { type: 'S', value: stem + '\x00\x01Video' }, { type: 'S', value: 'Clip' }],
      children: [
        { name: 'Type', props: [{ type: 'S', value: 'Clip' }] },
        { name: 'Properties70', props: [], children: [P('Path', 'KString', 'XRefUrl', '', e.file), P('RelPath', 'KString', 'XRefUrl', '', e.file)] },
        { name: 'UseMipMap', props: [{ type: 'I', value: 0 }] },
        { name: 'Filename', props: [{ type: 'S', value: e.file }] },
        { name: 'RelativeFilename', props: [{ type: 'S', value: e.file }] },
        { name: 'Content', props: [{ type: 'R', value: e.bytes }] },
      ],
    });
    texBlocks.push({
      name: 'Texture',
      props: [{ type: 'L', value: TEX_ID_BASE + e.idx }, { type: 'S', value: stem + '\x00\x01Texture' }, { type: 'S', value: '' }],
      children: [
        { name: 'Type', props: [{ type: 'S', value: 'TextureVideoClip' }] },
        { name: 'Version', props: [{ type: 'I', value: 202 }] },
        { name: 'TextureName', props: [{ type: 'S', value: stem + '\x00\x01Texture' }] },
        { name: 'Properties70', props: [], children: [P('UseMaterial', 'bool', '', '', 1)] },
        { name: 'Media', props: [{ type: 'S', value: stem + '\x00\x01Video' }] },
        { name: 'FileName', props: [{ type: 'S', value: e.file }] },
        { name: 'RelativeFilename', props: [{ type: 'S', value: e.file }] },
        { name: 'ModelUVTranslation', props: [{ type: 'D', value: 0 }, { type: 'D', value: 0 }] },
        { name: 'ModelUVScaling', props: [{ type: 'D', value: 1 }, { type: 'D', value: 1 }] },
        { name: 'Texture_Alpha_Source', props: [{ type: 'S', value: 'None' }] },
        { name: 'Cropping', props: [{ type: 'I', value: 0 }, { type: 'I', value: 0 }, { type: 'I', value: 0 }, { type: 'I', value: 0 }] },
      ],
    });
  }

  // Order matches Blender's FBX exporter exactly. C4D's scene-construction
  // pass walks Objects in document order resolving cross-references —
  // NodeAttribute MUST come before Model that references it.
  tree.push({ name: 'Objects', props: [], children:
    [...naBlocks, ...geomBlocks, ...modelBlocks, ...matBlocks, ...texBlocks, ...vidBlocks]
  });

  // ── Connections ─────────────────────────────────────────────────────────
  const conns = [];
  // No OO 0→docId connection. Blender's exporter does NOT write this.
  // The Document's RootNode:0 field already registers id=0 as the scene
  // root — an extra OO connection re-parents the root as a Document child
  // which confuses the FBX SDK's scene-tree builder.
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    const childId = MODEL_ID_BASE + ni;
    const parentId = n.parentIdx < 0 ? 0 : MODEL_ID_BASE + n.parentIdx;
    conns.push({ name: 'C', props: [
      { type: 'S', value: 'OO' },
      { type: 'L', value: childId },
      { type: 'L', value: parentId },
    ]});
    // NodeAttribute connection for Null nodes only — Mesh nodes get their
    // attribute via the Geometry connection below. See nodeHasAttr.
    if (nodeHasAttr.has(ni)) {
      conns.push({ name: 'C', props: [
        { type: 'S', value: 'OO' },
        { type: 'L', value: NA_ID_BASE + ni },
        { type: 'L', value: childId },
      ]});
    }
    if (n.type === 'Mesh') {
      const gIdx = meshIdxToGeomIdx.get(ni);
      if (gIdx != null) {
        conns.push({ name: 'C', props: [
          { type: 'S', value: 'OO' },
          { type: 'L', value: GEOM_ID_BASE + gIdx },
          { type: 'L', value: childId },
        ]});
      }
      // Each mesh has its own private Material (no sharing — see comment
      // at perMeshMats declaration). Look up by node index, not by color.
      const mIdx = meshIdxToMatIdx.get(ni);
      for (const mi of (mIdx == null ? [] : Array.isArray(mIdx) ? mIdx : [mIdx])) {      // (a part of several colours: each, in the order its polygons number them)
        conns.push({ name: 'C', props: [
          { type: 'S', value: 'OO' },
          { type: 'L', value: MAT_ID_BASE + mi },
          { type: 'L', value: childId },
        ]});
      }
    }
  }
  for (const e of texWritten) conns.push({ name: 'C', props: [{ type: 'S', value: 'OO' }, { type: 'L', value: VID_ID_BASE + e.idx }, { type: 'L', value: TEX_ID_BASE + e.idx }] });
  for (let mi = 0; mi < perMeshMats.length; mi++) {
    for (const [prop, e] of perMeshMats[mi].maps || []) {
      if (!e.bytes) continue;
      conns.push({ name: 'C', props: [{ type: 'S', value: 'OP' }, { type: 'L', value: TEX_ID_BASE + e.idx }, { type: 'L', value: MAT_ID_BASE + mi }, { type: 'S', value: prop }] });
    }
  }
  tree.push({ name: 'Connections', props: [], children: conns });

  // ── Takes (animation tracks — empty for static CAD scenes) ──────────────
  tree.push({
    name: 'Takes', props: [], children: [
      { name: 'Current', props: [{ type: 'S', value: '' }] },
    ],
  });

  // ── Serialise ───────────────────────────────────────────────────────────
  const w = new _FbxBinWriter();
  // Header (27 bytes): magic + version.
  w.bytes_(_FBX_TENC.encode('Kaydara FBX Binary  '));   // 20 bytes (note 2 trailing spaces)
  w.u8(0); w.u8(0x1A); w.u8(0);                          // 3 bytes: \0 \x1A \0
  // Version 7400 — exactly matches what Blender's FBX exporter writes,
  // and Blender's files load reliably in Cinema 4D 2026. Don't change
  // this without first verifying the new version still loads in C4D.
  w.u32(7400);                                           // 4 bytes: version 7.4

  for (const node of tree) await _fbxWriteNode(w, node);
  // Top-level null record (13 bytes for FBX 7.4: three uint32 + one uint8).
  w.u32(0); w.u32(0); w.u32(0); w.u8(0);

  // Footer block. FBX SDK and stricter importers (Maya, Cinema 4D 2026)
  // require this; lenient ones (Blender, three.js's FBXLoader) ignore it.
  // The first 16 bytes are a well-known "footer code" that open-source
  // writers (Blender, Assimp) use unconditionally — derived from the FBX
  // SDK's encryption table for version 7.x. Followed by zero-padding,
  // version, more zero-padding, and a fixed 16-byte post-footer magic.
  const FOOT_CODE = new Uint8Array([
    0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66,
    0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e,
  ]);
  const POST_FOOT_MAGIC = new Uint8Array([
    0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e,
    0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b,
  ]);
  w.bytes_(FOOT_CODE);
  // Blender's encode_bin.py writes 4 zero bytes immediately after FOOT_CODE,
  // then pads to the next 16-byte boundary with a minimum of 16 bytes
  // (so when already aligned it still writes 16, never 0).
  w.u32(0);  // 4 forced zeros — Blender always writes these
  const _footPad = 16 - (w.pos % 16);  // always 1..16 (never 0)
  for (let _i = 0; _i < _footPad; _i++) w.u8(0);
  w.u32(7400);   // version must match the header
  for (let i = 0; i < 120; i++) w.u8(0);
  w.bytes_(POST_FOOT_MAGIC);

  return new Blob([w.finalize()], { type: 'application/octet-stream' });
}

// ───────────────────────────────────────────────────────────────────
// ASCII FBX exporter (version 7400 / "FBX 2014").
// Why hand-rolled: three.js doesn't ship an FBX exporter, and a writer of
// our own needs nothing fetched at export time.
// What's written: the group hierarchy (groups as Null models), per-mesh
// triangle geometry (no normals: importers rebuild them), one diffuse
// colour material per colour. Each mesh's transform is baked into its
// vertices, so geometry is not shared between meshes. Cinema 4D, Blender,
// Maya, 3ds Max, and Houdini all read this dialect.
// ───────────────────────────────────────────────────────────────────
function _exportFbxAscii(root, opts) {
  const _fg = _fbxGlobals(opts);
  // FBX uses int64 ids; we space them out by ranges so the output is readable
  // and ids don't collide across object types (Geometry / Model / Material).
  const GEOM_ID_BASE  = 100000000;
  const MODEL_ID_BASE = 200000000;
  const MAT_ID_BASE   = 300000000;

  // ── Walk the scene tree ─────────────────────────────────────────────────
  // We collect THREE objects (Group + Mesh) into a flat list with per-node
  // parent indices so the Connections block can wire up the hierarchy. Each
  // node gets an FBX Model id; THREE.Group nodes become FBX "Null" Models,
  // THREE.Mesh nodes become "Mesh" Models. The export root itself is treated
  // as the FBX scene root and gets id 0 implicitly (FBX convention).
  root.updateMatrixWorld(true);
  const nodes = [];           // { obj, parentIdx, type }  — type: 'Null' | 'Mesh'
  const objToIdx = new Map(); // Object3D → index in nodes[]
  function visit(obj, parentIdx) {
    if (obj === root) {
      // root maps to FBX scene root (parent index = -1, never emitted).
      objToIdx.set(obj, -1);
    } else {
      const isMesh = !!obj.isMesh;
      // Skip invisible meshes; meshes without a position attribute would
      // otherwise produce dangling Connections to Geometry blocks we never
      // emit (the Geometry loop bails on missing position). InstancedMesh
      // is also a Mesh subclass — we don't have a Geometry-instancing path
      // here, so route them as plain meshes (they'll bake one geom and
      // one node, identical to the GLB exporter's behaviour for them).
      if (isMesh && obj.visible === false) return;
      if (isMesh && !obj.geometry?.attributes?.position) return;
      const idx = nodes.length;
      nodes.push({ obj, parentIdx, type: isMesh ? 'Mesh' : 'Null' });
      objToIdx.set(obj, idx);
      parentIdx = idx;
    }
    if (obj.children) {
      for (const c of obj.children) visit(c, parentIdx);
    }
  }
  visit(root, -1);

  // Drop empty Null nodes (groups with no descendant meshes). Walks bottom-up.
  // An empty group has neither a mesh nor any non-empty descendants.
  {
    const liveDescendantCount = new Array(nodes.length).fill(0);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const mine = n.type === 'Mesh' ? 1 : 0;
      if (n.parentIdx >= 0) liveDescendantCount[n.parentIdx] += mine + liveDescendantCount[i];
      // Keep the count as is; we use it to decide whether to keep this node.
      liveDescendantCount[i] += mine;
    }
    const keep = nodes.map((n, i) => n.type === 'Mesh' || liveDescendantCount[i] > 0);
    if (keep.some(k => !k)) {
      const remap = new Array(nodes.length).fill(-1);
      const filtered = [];
      for (let i = 0; i < nodes.length; i++) {
        if (!keep[i]) continue;
        remap[i] = filtered.length;
        const n = nodes[i];
        // Walk up parents until we find one we kept (or hit root).
        let p = n.parentIdx;
        while (p >= 0 && !keep[p]) p = nodes[p].parentIdx;
        filtered.push({ obj: n.obj, parentIdx: p < 0 ? -1 : remap[p], type: n.type });
      }
      nodes.length = 0;
      for (const n of filtered) nodes.push(n);
      objToIdx.clear();
      objToIdx.set(root, -1);
      for (let i = 0; i < nodes.length; i++) objToIdx.set(nodes[i].obj, i);
    }
  }

  // ── Dedup materials ─────────────────────────────────────────────────────
  // (Geometries are not shared in this writer: every mesh node gets a
  // Geometry block of its own, with its transform baked in. See "Geometry
  // blocks" below for why.)
  // Materials are keyed by RGB hex so meshes with identical colours share
  // one Material entry. Different metalness/roughness/etc. would need finer
  // keys; our pipeline produces flat color-only materials so hex is enough.
  const mats = [];                       // [{ r, g, b }]
  const colorHexToIdx = new Map();
  // Helper: resolve the effective display colour for a mesh node.
  // When the merge-into-one path is used, material.vertexColors=true and the
  // actual colours live in geometry.attributes.color. Read the first vertex
  // colour as a representative hue so merged meshes aren't forced grey.
  const resolveColor = (n) => {
    // Three.js material may be an array when a mesh has multiple material groups.
    // Take the first entry so dedup still works — a per-face material array means
    // the mesh needs to be split per-group for perfect accuracy, which is out of
    // scope here. Single-material meshes (the STEP-importer norm) are unaffected.
    const rawMat = n.obj.material;
    const mat = Array.isArray(rawMat) ? rawMat[0] : rawMat;
    if (mat?.vertexColors && n.obj.geometry?.attributes?.color) {
      const ca = n.obj.geometry.attributes.color;
      // Read first vertex (stride can be 3 or 4).
      return { r: ca.getX(0), g: ca.getY(0), b: ca.getZ(0) };
    }
    const c = mat?.color;
    return c ? { r: c.r, g: c.g, b: c.b } : { r: 0.8, g: 0.8, b: 0.8 };
  };
  const asciiFaceMats = new Map();       // mesh object -> { colours, poly, idx } for a part of several colours (see _exportFaceMats)
  const colourIdx = ({ r, g, b }) => {
    const key = ((r * 255 | 0) << 16) | ((g * 255 | 0) << 8) | (b * 255 | 0);
    if (!colorHexToIdx.has(key)) { colorHexToIdx.set(key, mats.length); mats.push({ r, g, b }); }
    return colorHexToIdx.get(key);
  };
  for (const n of nodes) {
    if (n.type !== 'Mesh') continue;
    const fmx = Array.isArray(n.obj.material) && n.obj.geometry ? _exportFaceMats(n.obj, _exportFaces(n.obj.geometry)) : null;
    if (fmx && fmx.colours.length > 1) {
      const idx = fmx.colours.map(colourIdx);
      if (new Set(idx).size === idx.length) { asciiFaceMats.set(n.obj, { ...fmx, idx }); continue; }      // (two colours that round to one byte value: one material)
    }
    colourIdx(fmx ? fmx.colours[0] : resolveColor(n));
  }

  // Streaming via array-of-strings + Blob([chunks]) — sidesteps the V8
  // ~512 MB single-string limit while keeping the writer simple.
  const chunks = [];
  const push = (s) => chunks.push(s);

  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1, day = now.getDate();
  const hour = now.getHours(), minute = now.getMinutes(), second = now.getSeconds();

  // ── Header ────────────────────────────────────────────────────────────
  push(`; FBX 7.4.0 project file
; Created by MeshOptimiser
; ----------------------------------------------------

FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
\tCreationTimeStamp:  {
\t\tVersion: 1000
\t\tYear: ${year}
\t\tMonth: ${month}
\t\tDay: ${day}
\t\tHour: ${hour}
\t\tMinute: ${minute}
\t\tSecond: ${second}
\t\tMillisecond: 0
\t}
\tCreator: "MeshOptimiser ASCII FBX exporter"
}
GlobalSettings:  {
\tVersion: 1000
\tProperties70:  {
\t\tP: "UpAxis", "int", "Integer", "",${_fg.up}
\t\tP: "UpAxisSign", "int", "Integer", "",1
\t\tP: "FrontAxis", "int", "Integer", "",${_fg.front}
\t\tP: "FrontAxisSign", "int", "Integer", "",${_fg.frontSign}
\t\tP: "CoordAxis", "int", "Integer", "",0
\t\tP: "CoordAxisSign", "int", "Integer", "",1
\t\tP: "OriginalUpAxis", "int", "Integer", "",-1
\t\tP: "OriginalUpAxisSign", "int", "Integer", "",1
\t\tP: "UnitScaleFactor", "double", "Number", "",${_fg.unit}
\t\tP: "OriginalUnitScaleFactor", "double", "Number", "",1
\t\tP: "AmbientColor", "ColorRGB", "Color", "",0,0,0
\t\tP: "DefaultCamera", "KString", "", "", "Producer Perspective"
\t\tP: "TimeMode", "enum", "", "",11
\t\tP: "TimeSpanStart", "KTime", "Time", "",0
\t\tP: "TimeSpanStop", "KTime", "Time", "",46186158000
\t}
}

`);

  // ── Definitions ───────────────────────────────────────────────────────
  // Count = number of distinct ObjectType template blocks, not total objects.
  // Blender writes: 3 for a scene with GlobalSettings+Geometry+Model templates.
  // Per-block ObjectType.Count values carry the actual per-type object counts.
  const _asciiNullNodes = nodes.filter(n => n.type === 'Null');
  const _asciiMeshNodes = nodes.filter(n => n.type === 'Mesh' && n.obj.geometry?.attributes?.position);
  const _asciiDefCount = 1 +                                    // GlobalSettings
    (_asciiMeshNodes.length > 0 ? 1 : 0) +                     // Geometry
    (nodes.length > 0 ? 1 : 0) +                               // Model
    (mats.length > 0 ? 1 : 0) +                                // Material
    (_asciiNullNodes.length > 0 ? 1 : 0);                      // NodeAttribute
  push(`Definitions:  {
\tVersion: 100
\tCount: ${_asciiDefCount}
\tObjectType: "GlobalSettings" {
\t\tCount: 1
\t}
\tObjectType: "Geometry" {
\t\tCount: ${_asciiMeshNodes.length}
\t\tPropertyTemplate: "FbxMesh" {
\t\t\tProperties70:  {
\t\t\t\tP: "Color", "ColorRGB", "Color", "",0.8,0.8,0.8
\t\t\t}
\t\t}
\t}
\tObjectType: "Model" {
\t\tCount: ${nodes.length}
\t\tPropertyTemplate: "FbxNode" {
\t\t\tProperties70:  {
\t\t\t\tP: "DefaultAttributeIndex", "int", "Integer", "",0
\t\t\t}
\t\t}
\t}
\tObjectType: "Material" {
\t\tCount: ${mats.length}
\t\tPropertyTemplate: "FbxSurfacePhong" {
\t\t\tProperties70:  {
\t\t\t\tP: "ShadingModel", "KString", "", "", "Phong"
\t\t\t\tP: "DiffuseColor", "Color", "", "A",0.8,0.8,0.8
\t\t\t}
\t\t}
\t}
\tObjectType: "NodeAttribute" {
\t\tCount: ${_asciiNullNodes.length}
\t}
}

`);

  // ── Objects ───────────────────────────────────────────────────────────
  push(`Objects:  {
`);

  // Helper: format a number compactly, to 7 significant digits. (A fixed
  // number of decimals was wrong at either end: an export scaled to metres
  // lost most of its digits, one in large units carried digits that mean
  // nothing.)
  const fmt = (n) => Math.abs(n) < 1e-10 ? '0' : (+n.toPrecision(7)).toString();
  // Sanitise names — FBX is fragile around backslashes, double-quotes and
  // control characters in object labels.
  const safeName = (s) => (s || 'unnamed').replace(/["\\]/g, '_').replace(/[\x00-\x1f]/g, '_');

  // ── Geometry blocks. We BAKE each mesh's local matrix into its emitted
  //    vertex stream (as opposed to relying on Lcl Translation/Rotation/
  //    Scaling on the Mesh Model) to sidestep Euler decomposition issues
  //    that surface on deeply-nested or sheared transforms. With identity
  //    Lcl on every Mesh node, world pose comes purely from vertex coords —
  //    no T/R/S decomposition step can lose information. Cost: each Mesh
  //    Model gets its own Geometry (no sharing across instances), so the
  //    file is larger than if we trusted Lcl. Worth it: the alternative is
  //    visible misorientation on instances buried under non-uniform-scaled
  //    parent groups (Cinema-4D / Blender export idiom).
  //
  //    Hierarchy is still preserved via Connections — group containers'
  //    own Lcl is identity (buildExportRoot creates them at identity), so
  //    they only contribute structure, not transform.
  const geoms = [];                        // one per mesh node: { source: BufferGeometry, mesh }
  const meshIdxToGeomIdx = new Map();      // node index → geom block index
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    if (n.type !== 'Mesh') continue;
    const g = n.obj.geometry;
    if (!g) continue;
    meshIdxToGeomIdx.set(ni, geoms.length);
    geoms.push({ source: g, mesh: n.obj });
  }

  const _bakeM = new THREE.Matrix4();
  const _bakeV = new THREE.Vector3();

  for (let gi = 0; gi < geoms.length; gi++) {
    const entry = geoms[gi];
    const g = entry.source;
    const meshObj = entry.mesh;
    const geomId = GEOM_ID_BASE + gi;
    const posAttr = g.attributes.position;
    if (!posAttr) continue;
    const idxAttr = g.index;
    const stride = posAttr.itemSize;
    const arr = posAttr.array;
    // World transform we'll bake into the emitted vertex stream. matrixWorld
    // is the right source: it composes the mesh's local matrix with every
    // ancestor's local matrix, which is exactly what an FBX importer would
    // otherwise reconstruct from Lcl chains. Baking into vertices means
    // emitted Mesh Models carry identity Lcl — no decomposition risk.
    meshObj.updateWorldMatrix(true, false);
    const _lin = root.userData.exportLin || null;
    const _trs = _fbxLocalTRS(meshObj, _lin);   // (see there: position, rotation and scale on the Model, the vertices in the own frame of the part)
    if (_trs) _bakeM.copy(_lin || new THREE.Matrix4()); else _bakeM.copy(meshObj.matrixWorld);
    const _pv = _trs ? { world: new THREE.Vector3(), local: new THREE.Vector3() } : _fbxPivotOf(meshObj);   // else the vertices are written around the pivot, the Model carries its position
    entry.pivotLocal = _pv.local; entry.trs = _trs;

    push(`\tGeometry: ${geomId}, "Geometry::geom_${gi}", "Mesh" {
\t\tGeometryVersion: 124
\t\tVertices: *${posAttr.count * 3} {
\t\t\ta: `);
    {
      const parts = new Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) {
        // Bake matrixWorld into the emitted position. Identity Lcl on the
        // Mesh Model (below) means the importer won't re-transform.
        _bakeV.set(arr[i*stride], arr[i*stride+1], arr[i*stride+2]).applyMatrix4(_bakeM).sub(_pv.world);
        parts[i] = fmt(_bakeV.x) + ',' + fmt(_bakeV.y) + ',' + fmt(_bakeV.z);
      }
      push(parts.join(','));
    }
    push(`
\t\t}
\t\tPolygonVertexIndex: *`);
    {
      // FBX marks the LAST vertex of each polygon with bitwise NOT (~i)
      // so the parser can tell where polygons end. For triangle meshes
      // that's every 3rd index. We always emit triangulated geometry.
      let count;
      let parts;
      const faces = _exportFaces(g);      // (quads and n-gons: see _exportFaces)
      if (faces) {
        count = faces.verts.length;
        parts = new Array(faces.sizes.length);
        let o = 0;
        for (let f = 0; f < faces.sizes.length; f++) {
          const n = faces.sizes[f];
          let s = '';
          for (let k = 0; k < n - 1; k++) s += faces.verts[o++] + ',';
          parts[f] = s + (~faces.verts[o++]);
        }
      } else if (idxAttr) {
        count = idxAttr.count;
        const ai = idxAttr.array;
        const triCount = count / 3;
        parts = new Array(triCount);
        for (let i = 0; i < triCount; i++) {
          const j = i * 3;
          parts[i] = ai[j] + ',' + ai[j+1] + ',' + (~ai[j+2]);
        }
      } else {
        count = posAttr.count;
        const triCount = count / 3;
        parts = new Array(triCount);
        for (let i = 0; i < triCount; i++) {
          const j = i * 3;
          parts[i] = j + ',' + (j+1) + ',' + (~(j+2));
        }
      }
      push(count + ` {
\t\t\ta: `);
      push(parts.join(','));
    }
    push(`
\t\t}
`);

    // Normals are intentionally omitted from the ASCII export.
    // ASCII FBX is already 3-5× larger than binary; normals alone match
    // the vertex-position footprint (3 floats/vertex × same count). Every
    // major importer (Houdini, C4D, Maya, Blender) recomputes smooth or
    // hard-edge normals from the polygon topology on load, so the visual
    // result is identical while the file stays half the size.
    // If you need to restore normals, uncomment the block below and also
    // add back the LayerElementNormal entry in the Layer block.

    // UVs (see _fbxUvData): written when the mesh has them
    const _uvd = _fbxUvData(meshObj, _exportFaces(g));
    if (_uvd) {
      const uvs = new Array(_uvd.uv.length); for (let i = 0; i < _uvd.uv.length; i++) uvs[i] = fmt(_uvd.uv[i]);
      push(`\t\tLayerElementUV: 0 {
\t\t\tVersion: 101
\t\t\tName: "UVMap"
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tUV: *${_uvd.uv.length} {
\t\t\t\ta: `);
      push(uvs.join(','));
      push(`
\t\t\t}
\t\t\tUVIndex: *${_uvd.uvIndex.length} {
\t\t\t\ta: `);
      push(Array.from(_uvd.uvIndex).join(','));
      push(`
\t\t\t}
\t\t}
`);
    }
    // One material slot, slot 0; a part of several colours has one a colour, and a slot for each polygon (ByPolygon).
    const _afm = asciiFaceMats.get(meshObj);
    push(`\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "${_afm ? 'ByPolygon' : 'AllSame'}"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tMaterials: *${_afm ? _afm.poly.length : 1} {
\t\t\t\ta: ${_afm ? Array.from(_afm.poly).join(',') : 0}
\t\t\t}
\t\t}
\t\tLayer: 0 {
\t\t\tVersion: 100
`);
    if (_uvd) push(`\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementUV"
\t\t\t\tTypedIndex: 0
\t\t\t}
`);
    push(`\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementMaterial"
\t\t\t\tTypedIndex: 0
\t\t\t}
\t\t}
\t}
`);
  }

  // ── NodeAttribute blocks — one per Null/group node. Mesh nodes get their
  //    attribute from the Geometry via OO connection; only Null nodes need an
  //    explicit NodeAttribute (type "Null") for the FBX SDK to build a valid
  //    scene hierarchy. Without these, Houdini's FBX SDK emits "failed to load".
  const _ASCII_NA_BASE = 400000000;
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    if (n.type !== 'Null') continue;
    const naId = _ASCII_NA_BASE + ni;
    const naName = safeName(n.obj.name || `group_${ni}`);
    push(`\tNodeAttribute: ${naId}, "NodeAttribute::${naName}", "Null" {
\t\tTypeFlags: "Null"
\t}
`);
  }

  // ── Model blocks. One per scene-graph node; type = "Null" for groups
  //    (containers that hold other Models) and "Mesh" for actual geometry.
  //    Lcl Translation/Rotation/Scale carry the LOCAL transform; the
  //    parent-child relationships are wired up in Connections below. ──────
  const tmpQ = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const RAD2DEG = 180 / Math.PI;
  // Model names are made unique, as the binary writer makes them: Cinema 4D
  // will not build a scene in which two Models carry one name, even when
  // their ids differ. A repeated name gets ".001", ".002", …
  const seenModelNames = new Map();   // name → how many times it has come up
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    const o = n.obj;
    const modelId = MODEL_ID_BASE + ni;
    const rawName = safeName(o.name || (n.type === 'Mesh' ? `mesh_${ni}` : `group_${ni}`));
    const seenN = seenModelNames.get(rawName) || 0;
    seenModelNames.set(rawName, seenN + 1);
    const modelName = seenN > 0 ? `${rawName}.${String(seenN).padStart(3, '0')}` : rawName;
    // Mesh nodes carry only their pivot as Lcl Translation: rotation and scale
    // were baked into the emitted vertex stream, around that pivot. Group ('Null') nodes get the decomposed
    // local matrix so their structural placement (if any) is preserved —
    // buildExportRoot creates them at identity so this is also (0,0,0)/etc.
    // in practice, but we honour any Lcl that may have ended up on them.
    let tx = 0, ty = 0, tz = 0;
    let rx = 0, ry = 0, rz = 0;
    let sx = 1, sy = 1, sz = 1;
    if (n.type === 'Mesh') {
      const ge = geoms[meshIdxToGeomIdx.get(ni)];
      if (ge && ge.trs) { [tx, ty, tz] = ge.trs.t; [rx, ry, rz] = ge.trs.r; [sx, sy, sz] = ge.trs.s; }
      else if (ge && ge.pivotLocal) { tx = ge.pivotLocal.x; ty = ge.pivotLocal.y; tz = ge.pivotLocal.z; }    // (the pivot: see _fbxPivotOf)
    } else {
      o.updateMatrix();
      o.matrix.decompose(tmpV, tmpQ, tmpScale);
      tmpEuler.setFromQuaternion(tmpQ, 'XYZ');
      tx = tmpV.x; ty = tmpV.y; tz = tmpV.z;
      rx = tmpEuler.x * RAD2DEG; ry = tmpEuler.y * RAD2DEG; rz = tmpEuler.z * RAD2DEG;
      sx = tmpScale.x; sy = tmpScale.y; sz = tmpScale.z;
    }
    push(`\tModel: ${modelId}, "Model::${modelName}", "${n.type}" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "DefaultAttributeIndex", "int", "Integer", "",0
\t\t\tP: "InheritType", "enum", "", "",1
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",${fmt(tx)},${fmt(ty)},${fmt(tz)}
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",${fmt(rx)},${fmt(ry)},${fmt(rz)}
\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",${fmt(sx)},${fmt(sy)},${fmt(sz)}
\t\t}
\t\tMultiLayer: 0
\t\tMultiTake: 0
\t\tShading: Y
\t\tCulling: "CullingOff"
\t}
`);
  }

  // ── Material blocks (one per unique color). ─────────────────────────────
  for (let mi = 0; mi < mats.length; mi++) {
    const m = mats[mi];
    const matId = MAT_ID_BASE + mi;
    push(`\tMaterial: ${matId}, "Material::mat_${mi}", "" {
\t\tVersion: 102
\t\tShadingModel: "Phong"
\t\tMultiLayer: 0
\t\tProperties70:  {
\t\t\tP: "ShadingModel", "KString", "", "", "Phong"
\t\t\tP: "DiffuseColor", "Color", "", "A",${fmt(m.r)},${fmt(m.g)},${fmt(m.b)}
\t\t\tP: "DiffuseFactor", "Number", "", "A",1
\t\t\tP: "AmbientColor", "Color", "", "A",0,0,0
\t\t\tP: "AmbientFactor", "Number", "", "A",0
\t\t\tP: "SpecularColor", "Color", "", "A",0.2,0.2,0.2
\t\t\tP: "SpecularFactor", "Number", "", "A",0.5
\t\t\tP: "Shininess", "double", "Number", "",20
\t\t\tP: "ShininessExponent", "double", "Number", "",20
\t\t\tP: "TransparencyFactor", "Number", "", "A",0
\t\t\tP: "ReflectionFactor", "Number", "", "A",0
\t\t}
\t}
`);
  }

  push(`}

`);

  // ── Documents + References ─────────────────────────────────────────────
  // Both top-level nodes are REQUIRED by the Autodesk FBX SDK (used by Houdini,
  // Maya, and 3ds Max internally). Without them, the SDK fails to initialize the
  // scene graph and returns a silent "failed to load" error.
  push(`Documents:  {
\tCount: 1
\tDocument: 1000000000, "Scene", "Scene" {
\t\tProperties70:  {
\t\t\tP: "SourceObject", "object", "", ""
\t\t\tP: "ActiveAnimStackName", "KString", "", "", ""
\t\t}
\t\tRootNode: 0
\t}
}
References:  {
}

`);

  // ── Connections ───────────────────────────────────────────────────────
  // For each node: child Model → parent Model (or scene root id 0).
  // For mesh nodes additionally: Geometry → Model, Material → Model.
  // For Null nodes: NodeAttribute → Model (FBX SDK requires this for groups).
  push(`Connections:  {
`);
  // REQUIRED: Scene root (id 0) → Document. The FBX SDK uses this connection
  // to register the scene root with the Document node. Without it, Cinema 4D
  // and Houdini (both use the Autodesk FBX SDK) cannot build the scene tree.
  push(`\tC: "OO",0,1000000000\n`);
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    const childId = MODEL_ID_BASE + ni;
    const parentId = n.parentIdx < 0 ? 0 : MODEL_ID_BASE + n.parentIdx;
    push(`\tC: "OO",${childId},${parentId}\n`);
    if (n.type === 'Mesh') {
      const gIdx = meshIdxToGeomIdx.get(ni);
      if (gIdx != null) push(`\tC: "OO",${GEOM_ID_BASE + gIdx},${childId}\n`);
      // Use the same resolveColor helper used when building the mats table,
      // so vertex-colour meshes (merge path) get the right material connection.
      const _afm = asciiFaceMats.get(n.obj);
      if (_afm) { for (const mi of _afm.idx) push(`\tC: "OO",${MAT_ID_BASE + mi},${childId}\n`); }      // (in the order its polygons number them)
      else {
        const fm1 = Array.isArray(n.obj.material) ? _exportFaceMats(n.obj, _exportFaces(n.obj.geometry)) : null;
        const { r, g, b } = fm1 ? fm1.colours[0] : resolveColor(n);
        const key = ((r * 255 | 0) << 16) | ((g * 255 | 0) << 8) | (b * 255 | 0);
        const mIdx = colorHexToIdx.get(key);
        if (mIdx != null) push(`\tC: "OO",${MAT_ID_BASE + mIdx},${childId}\n`);
      }
    }
    if (n.type === 'Null') {
      // NodeAttribute → Model for every group node. The FBX SDK walks
      // these connections to build the scene tree; missing them = load failure.
      push(`\tC: "OO",${_ASCII_NA_BASE + ni},${childId}\n`);
    }
  }
  push(`}

`);

  // ── Takes (required by FBX SDK even for static scenes without animation) ──
  push(`Takes:  {
\tCurrent: ""
}
`);

  return new Blob(chunks, { type: 'application/octet-stream' });
}

// OBJ precision — default JS Number.toString() emits up to 17 significant
// digits, which roughly doubles file size with no real-world benefit. 6
// decimals on positions/UVs and 5 on normals is sub-micron at 1 m scale
// and well below CAD tolerance.
const _OBJ_POS_DEC = 6;
const _OBJ_UV_DEC  = 6;
const _OBJ_NRM_DEC = 5;

// Format a float with up to `d` decimals, stripping trailing zeros and the
// dangling `.` so we don't pay for digits we didn't need. Avoids "-0".
function _objFloat(n, d) {
  if (!isFinite(n) || n === 0) return '0';
  let s = n.toFixed(d);
  if (s.indexOf('.') !== -1) {
    s = s.replace(/0+$/, '');
    if (s.endsWith('.')) s = s.slice(0, -1);
  }
  return s === '-0' ? '0' : s;
}

// Streaming OBJ exporter — bypasses V8's ~500 MB single-string limit.
//
// three.js's stock OBJExporter builds one giant string and returns it. For a
// 10M-vertex model that string is ~300 MB; V8 caps single strings at ~500 MB
// and concat operations at ~256 MB on some builds, so the user sees
// "Invalid string length" and the download fails outright.
//
// This version writes per-mesh chunks into a BlobPart array. Each chunk is
// capped at TARGET_CHUNK bytes of UTF-8 — small enough that V8's string
// concat path stays in the fast lane, large enough that we don't churn out
// millions of tiny array entries. The final Blob has no total-size limit.
//
// Numbers are written with a fixed number of decimals (_OBJ_POS_DEC and
// friends above), not three.js's default toString().
function _exportObjStreaming(root, mtlBaseName) {
  const TARGET_CHUNK = 4 * 1024 * 1024;   // 4 MB per string chunk
  const _objSeen = new Map();             // the object names used in this file (local: kept on the function it held the whole export root)
  // Banner spells out the OBJ format's two structural limitations so a future
  // user reading the file knows why pivots/hierarchy look the way they do.
  const parts = [
    '# Exported by MeshOptimiser\n',
    ...(root.userData && root.userData.moUp ? ['# Up axis: ' + root.userData.moUp + '; 1 unit = ' + (root.userData.moMmPerUnit || 1) + ' mm\n'] : []),
    '# OBJ does not store per-object transforms — all vertices are baked\n',
    '# into world space, so every imported object inherits an origin at\n',
    '# (0,0,0). In Blender, enable the importer\'s "Object Origin → Bounds\n',
    '# Center" option to recompute correct per-part pivots on import.\n',
    '# Group hierarchy is encoded in the object name as parent/child/leaf.\n',
  ];
  let buf = '';
  const flush = () => { if (buf) { parts.push(buf); buf = ''; } };
  const append = (s) => { buf += s; if (buf.length >= TARGET_CHUNK) flush(); };

  // ── Material table ──────────────────────────────────────────────────────
  // OBJ references named materials by `usemtl <name>`; the actual definitions
  // live in a sibling .mtl file linked via `mtllib`. We collect unique
  // materials by hex color (any two meshes with the same color share one mtl
  // entry) and emit the .mtl as a parallel Blob so the caller can download
  // both files together.
  // A material with pictures is an entry of its own (its colour and its maps), so two white materials with different maps stay apart.
  // Each picture is written once, as a file beside the .obj named after it (<name>_BaseColor.jpg, <name>_Normal.png, ...), and the
  // .mtl points at it: map_Kd the colour, norm and map_Bump the normal map (Blender reads either as a normal map), map_Pr, map_Pm and
  // map_d the roughness, metalness and opacity of the PBR extension. The pictures themselves are encoded by the caller (_objTextureFiles).
  const matByHex = new Map();    // key (colour, and the maps) → { name, r, g, b, metalness, roughness, maps }
  const texFiles = new Map();    // texture → { file, kind, tex, flipGreen }
  const usedTexNames = new Set();
  const OBJ_TEX = [['map', 'BaseColor'], ['normalMap', 'Normal'], ['roughnessMap', 'Roughness'], ['metalnessMap', 'Metallic'], ['alphaMap', 'Opacity']];
  const texFile = (t, kind, mat) => {
    let f = texFiles.get(t);
    if (!f) {
      const mime = (t.userData && t.userData.mimeType) || 'image/png';
      const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
      let stem = (mtlBaseName || 'model') + '_' + kind, n = 1;
      while (usedTexNames.has(stem + (n > 1 ? '_' + n : ''))) n++;
      stem += n > 1 ? '_' + n : ''; usedTexNames.add(stem);
      // (a normal map whose green is not turned in the scene is drawn the DirectX way: written turned, as OBJ readers expect OpenGL's)
      const flipGreen = kind === 'Normal' && !!(mat.normalScale && (mat.normalScale.y < 0) === (mat.normalScale.x < 0));
      f = { file: stem + '.' + ext, kind, tex: t, mime, flipGreen };
      texFiles.set(t, f);
    }
    return f.file;
  };
  const matNameFor = (mat) => {
    if (!mat || !mat.color) return null;
    const hex = mat.color.getHex();
    const maps = OBJ_TEX.filter(([k]) => mat[k] && mat[k].isTexture && mat[k].image);
    const key = maps.length ? hex + '|' + maps.map(([k]) => k + ':' + mat[k].uuid).join('|') : hex;
    let entry = matByHex.get(key);
    if (!entry) {
      let name = 'mat_' + hex.toString(16).padStart(6, '0');
      if (maps.length) { let n = 1; for (const e of matByHex.values()) if (e.name === name || e.name.startsWith(name + '_tex')) n++; name += '_tex' + n; }
      entry = {
        name,
        r: mat.color.r, g: mat.color.g, b: mat.color.b,
        metalness: typeof mat.metalness === 'number' ? mat.metalness : 0,
        roughness: typeof mat.roughness === 'number' ? mat.roughness : 1,
        maps: maps.map(([k, kind]) => [k, texFile(mat[k], kind, mat)]),
      };
      matByHex.set(key, entry);
    }
    return entry.name;
  };

  if (mtlBaseName) parts.push(`mtllib ${mtlBaseName}.mtl\n`);

  // OBJ uses 1-based indices that span the entire file. Track running totals
  // across meshes so a mesh's faces reference the right global vertex IDs.
  let vOffset = 0, nOffset = 0, uvOffset = 0, objIdx = 0;

  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  // Build the group chain for a mesh: outermost ancestor → ... → leaf parent.
  // OBJ has no real hierarchy, and most importers ignore the `g` directive
  // for object splitting (they split on `o` instead). So we ALSO bake the
  // chain into the object name with `/` as a separator — Blender, Maya and
  // 3ds Max all preserve the full string verbatim, and Blender groups names
  // alphabetically in the outliner so a chain prefix produces correct
  // visible grouping. The redundant `g <chain>` line is still emitted for
  // tools that DO use it (some legacy CAD tools, Substance).
  const sanitize = (s) => (s || '').replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.-]/gu, '') || 'Part';
  const chainNames = (child) => {
    const names = [];
    let cur = child.parent;
    while (cur && cur !== root) {
      if (cur.name) names.unshift(sanitize(cur.name));
      cur = cur.parent;
    }
    return names;
  };

  root.traverse((child) => {
    if (!child.isMesh) return;
    const geom = child.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) return;
    const nrm = geom.attributes.normal || null;
    const uv  = geom.attributes.uv     || null;
    const idx = geom.index;
    const matrix = child.matrixWorld;
    normalMatrix.getNormalMatrix(matrix);

    objIdx++;
    const _objNameSeen = _objSeen;
    const chain = chainNames(child);
    const baseName = sanitize(child.name || 'Mesh_' + objIdx);
    // `o` line: prefix with chain joined by `/` so the importer's outliner
    // shows the full path. Identifier-safe characters only.
    let objName = chain.length ? chain.join('/') + '/' + baseName : baseName;
    // Parts that share a name (and a place in the tree) get a number: an
    // importer that goes by name (Cinema 4D) made one object of all of them,
    // 778 parts arriving as 325.
    { const k = (_objNameSeen.get(objName) || 0) + 1; _objNameSeen.set(objName, k); if (k > 1) objName += '.' + String(k - 1).padStart(3, '0'); }
    append(`o ${objName}\n`);
    // `g` line: same chain space-separated. Some tools read it as group tags.
    if (chain.length) append('g ' + chain.join(' ') + '\n');
    const faces = _exportFaces(geom);      // quads and n-gons, when the part has polygons (see _exportFaces)
    const fmat = _exportFaceMats(child, faces);      // (a part of several colours: a usemtl for each, below)
    const matName = matNameFor(fmat ? fmat.colours[0].mat : child.material);
    if (matName && !(fmat && fmat.colours.length > 1)) append('usemtl ' + matName + '\n');

    // positions (apply world matrix)
    const vc = pos.count;
    for (let i = 0; i < vc; i++) {
      tmpV.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      append('v ' + _objFloat(tmpV.x, _OBJ_POS_DEC) + ' ' + _objFloat(tmpV.y, _OBJ_POS_DEC) + ' ' + _objFloat(tmpV.z, _OBJ_POS_DEC) + '\n');
    }
    // uvs
    if (uv) {
      const uc = uv.count;
      for (let i = 0; i < uc; i++) {
        append('vt ' + _objFloat(uv.getX(i), _OBJ_UV_DEC) + ' ' + _objFloat(1 - uv.getY(i), _OBJ_UV_DEC) + '\n');      // (OBJ counts V from the bottom; the scene from the top)
      }
    }
    // normals (apply normal matrix; renormalize)
    if (nrm) {
      const nc = nrm.count;
      for (let i = 0; i < nc; i++) {
        tmpN.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize();
        append('vn ' + _objFloat(tmpN.x, _OBJ_NRM_DEC) + ' ' + _objFloat(tmpN.y, _OBJ_NRM_DEC) + ' ' + _objFloat(tmpN.z, _OBJ_NRM_DEC) + '\n');
      }
    }
    // faces — combine all referenced index arrays + format depends on what's
    // actually present, matching the OBJExporter's per-vertex slot syntax
    // (`v[/vt][/vn]`).
    const ia = idx ? idx.array : null;
    const triCount = (ia ? ia.length : vc) / 3;

    if (fmat && fmat.colours.length > 1) {
      // A part of several colours: its faces a colour at a time, each run under the usemtl of its material (Blender, Cinema 4D and
      // three's OBJLoader read them as one object with a material a polygon).
      const ref = uv && nrm ? (a) => (a + vOffset) + '/' + (a + uvOffset) + '/' + (a + nOffset) : nrm ? (a) => (a + vOffset) + '//' + (a + nOffset) : uv ? (a) => (a + vOffset) + '/' + (a + uvOffset) : (a) => String(a + vOffset);
      const nF = faces ? faces.sizes.length : triCount;
      const fStart = new Uint32Array(nF + 1);
      if (faces) for (let f = 0; f < nF; f++) fStart[f + 1] = fStart[f] + faces.sizes[f];
      for (let c = 0; c < fmat.colours.length; c++) {
        append('usemtl ' + matNameFor(fmat.colours[c].mat || { color: new THREE.Color(fmat.colours[c].r, fmat.colours[c].g, fmat.colours[c].b) }) + '\n');
        for (let f = 0; f < nF; f++) {
          if (fmat.poly[f] !== c) continue;
          let line = 'f';
          if (faces) for (let o = fStart[f]; o < fStart[f + 1]; o++) line += ' ' + ref(faces.verts[o] + 1);
          else for (let k = 0; k < 3; k++) line += ' ' + ref((ia ? ia[f * 3 + k] : f * 3 + k) + 1);
          append(line + '\n');
        }
      }
    } else if (faces) {
      let o = 0;
      for (let f = 0; f < faces.sizes.length; f++) {
        const n = faces.sizes[f];
        let line = 'f';
        for (let k = 0; k < n; k++) {
          const a = faces.verts[o++] + 1;
          line += ' ' + (a + vOffset) + (uv && nrm ? '/' + (a + uvOffset) + '/' + (a + nOffset) : nrm ? '//' + (a + nOffset) : uv ? '/' + (a + uvOffset) : '');
        }
        append(line + '\n');
      }
    } else if (uv && nrm) {
      for (let t = 0; t < triCount; t++) {
        const a = (ia ? ia[t*3]   : t*3)   + 1;
        const b = (ia ? ia[t*3+1] : t*3+1) + 1;
        const c = (ia ? ia[t*3+2] : t*3+2) + 1;
        append('f ' +
          (a + vOffset) + '/' + (a + uvOffset) + '/' + (a + nOffset) + ' ' +
          (b + vOffset) + '/' + (b + uvOffset) + '/' + (b + nOffset) + ' ' +
          (c + vOffset) + '/' + (c + uvOffset) + '/' + (c + nOffset) + '\n');
      }
    } else if (nrm) {
      for (let t = 0; t < triCount; t++) {
        const a = (ia ? ia[t*3]   : t*3)   + 1;
        const b = (ia ? ia[t*3+1] : t*3+1) + 1;
        const c = (ia ? ia[t*3+2] : t*3+2) + 1;
        append('f ' +
          (a + vOffset) + '//' + (a + nOffset) + ' ' +
          (b + vOffset) + '//' + (b + nOffset) + ' ' +
          (c + vOffset) + '//' + (c + nOffset) + '\n');
      }
    } else if (uv) {
      for (let t = 0; t < triCount; t++) {
        const a = (ia ? ia[t*3]   : t*3)   + 1;
        const b = (ia ? ia[t*3+1] : t*3+1) + 1;
        const c = (ia ? ia[t*3+2] : t*3+2) + 1;
        append('f ' +
          (a + vOffset) + '/' + (a + uvOffset) + ' ' +
          (b + vOffset) + '/' + (b + uvOffset) + ' ' +
          (c + vOffset) + '/' + (c + uvOffset) + '\n');
      }
    } else {
      for (let t = 0; t < triCount; t++) {
        const a = (ia ? ia[t*3]   : t*3)   + 1;
        const b = (ia ? ia[t*3+1] : t*3+1) + 1;
        const c = (ia ? ia[t*3+2] : t*3+2) + 1;
        append('f ' + (a + vOffset) + ' ' + (b + vOffset) + ' ' + (c + vOffset) + '\n');
      }
    }

    vOffset  += vc;
    if (nrm) nOffset  += nrm.count;
    if (uv)  uvOffset += uv.count;
  });

  flush();
  const objBlob = new Blob(parts, { type: 'text/plain' });

  // Build the .mtl content. PBR roughness/metalness aren't standard OBJ MTL
  // fields, but `Pr` (roughness) and `Pm` (metalness) are the de-facto PBR
  // extension that Blender, Substance, and SideFX Houdini all read.
  let mtlBlob = null;
  if (mtlBaseName && matByHex.size > 0) {
    const lines = ['# Exported by MeshOptimiser\n'];
    for (const e of matByHex.values()) {
      lines.push(`newmtl ${e.name}\n`);
      lines.push(`Kd ${_objFloat(e.r, 4)} ${_objFloat(e.g, 4)} ${_objFloat(e.b, 4)}\n`);
      lines.push(`Ka 0 0 0\n`);
      lines.push(`Ks 0 0 0\n`);
      lines.push(`d 1\n`);                       // opacity
      lines.push(`illum 2\n`);                   // diffuse + specular
      lines.push(`Pr ${_objFloat(e.roughness, 3)}\n`);
      lines.push(`Pm ${_objFloat(e.metalness, 3)}\n`);
      for (const [k, file] of e.maps || []) {
        if (k === 'map') lines.push(`map_Kd ${file}\n`);
        else if (k === 'normalMap') lines.push(`norm ${file}\n`, `map_Bump -bm 1 ${file}\n`);
        else if (k === 'roughnessMap') lines.push(`map_Pr ${file}\n`);
        else if (k === 'metalnessMap') lines.push(`map_Pm ${file}\n`);
        else if (k === 'alphaMap') lines.push(`map_d ${file}\n`);
      }
    }
    mtlBlob = new Blob(lines, { type: 'text/plain' });
  }
  return { objBlob, mtlBlob, textures: [...texFiles.values()] };
}

// The pictures an OBJ export names in its .mtl, as files: each texture drawn at its own size and encoded in its own format (JPEG at
// 0.92, as GLTFExporter does, or PNG). A normal map drawn the DirectX way has its green turned on the way out. A texture that only lives
// on the graphics card (compressed, KTX2) has no picture to draw and is left out, and said so.
async function _objTextureFiles(textures) {
  const out = [], missed = [];
  for (const f of textures || []) {
    try {
      const img = f.tex && f.tex.image;
      const w = img && (img.naturalWidth || img.videoWidth || img.width), h = img && (img.naturalHeight || img.videoHeight || img.height);
      if (!img || !w || !h || f.tex.isCompressedTexture) { missed.push(f.file); continue; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: f.flipGreen });
      if (img.data) {                                      // (raw pixels: a DataTexture)
        const d = new Uint8ClampedArray(w * h * 4), src = img.data, ch = src.length / (w * h);
        for (let i = 0, j = 0; i < w * h; i++, j += ch) { d[i * 4] = src[j]; d[i * 4 + 1] = ch > 1 ? src[j + 1] : src[j]; d[i * 4 + 2] = ch > 2 ? src[j + 2] : src[j]; d[i * 4 + 3] = ch > 3 ? src[j + 3] : 255; }
        x.putImageData(new ImageData(d, w, h), 0, 0);
      } else x.drawImage(img, 0, 0, w, h);
      if (f.flipGreen) { const id = x.getImageData(0, 0, w, h), d = id.data; for (let i = 1; i < d.length; i += 4) d[i] = 255 - d[i]; x.putImageData(id, 0, 0); }
      const blob = await new Promise(r => c.toBlob(r, f.mime, f.mime === 'image/jpeg' ? 0.92 : undefined));
      if (blob) out.push({ name: f.file, blob }); else missed.push(f.file);
    } catch (e) { console.warn('[obj] picture not written:', f.file, e); missed.push(f.file); }
  }
  if (missed.length) { try { toast('Some pictures not written', missed.join(', ') + ': they live only on the graphics card (compressed) or could not be read.', 'warn', 6000); } catch (_) {} }
  return out;
}

return { _exportFbxAscii, _exportFbxBinary, _exportObjStreaming, _exportPolysOf, _flipMirroredForBake, _objTextureFiles };
}
