// The Bake textures card: the selected parts are reduced, laid out flat on ONE shared picture (bake.js), and the colour of the original
// surface is read under every texel of that picture and written into it. The reduced parts keep their look with far fewer triangles,
// and with all of them on one material, a draw call fewer for each part. One undo step puts the geometry and the materials back.
//
// What is read from the original, for a point of it: the colour of its material (its Base colour map where it has one, read through
// the part's own UVs and the map's offset, repeat and turn), times the colour of its vertices when the material uses them. A part of
// several materials (its faces in different colours) is read face by face. Opacity and emission are not baked.
// The nearest point of the original to a texel's point on the reduced part is the one read (a BVH of the original), so the reduced
// surface need not lie exactly on the old one. The picture is dilated a few texels past each piece so mipmaps and filtering do not
// pull in the background, and what no piece covers is the average colour.
import * as THREE from 'three';
import { unwrapParts, rasterise, dilate } from './bake.js?v=2';
import { layoutGeometry } from './uv-geom.js?v=1';

export function installBakeCard(app) {
  const {
    state, _Prefs, _CmdCards, _Job, _Tasks, initScrubber, toast, getPart, fmtNum, settle, _nextFrame, _decSnap, _stampGeometry,
    _refreshPartBBox, _cadEdgesPartSwapped, _loadMeshopt, _loadSimplifier, _simplifyKeepingAttributes, _shapeOf, _keepsShape, _matStateSnap, _matHolder, _matOf, _matSet,
    _newMaterial, pushBakeUndo,
  } = app;
  const DEF = { reduce: 50, size: 2048, angle: 60, pad: 4, colour: true, normals: true, ao: false, aoDist: 5, aoRays: 16 }, MIN_REDUCE = 48;
  const $i = (id) => document.getElementById(id);
  const pref = (k) => { const v = _Prefs.get('bake.' + k); return v === undefined || v === null ? DEF[k] : v; };
  const o = { reduce: pref('reduce'), size: pref('size'), angle: pref('angle'), pad: pref('pad'), colour: pref('colour'), normals: pref('normals'), ao: pref('ao'), aoDist: pref('aoDist'), aoRays: pref('aoRays') };
  const SWITCH = { colour: 'bk-colour', normals: 'bk-normals', ao: 'bk-ao' };
  let wired = false, busy = false, cancelled = false;
  const sc = {};

  // ── colour ──
  const toLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const enc = (v) => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255); };
  const imgOf = new Map();
  function pixelsOf(tex) {
    if (imgOf.has(tex)) return imgOf.get(tex);
    let d = null;
    try {
      const img = tex && tex.image, w = img && (img.width || img.naturalWidth), h = img && (img.height || img.naturalHeight);
      if (w && h && w * h <= 64e6) {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
        try { tex.updateMatrix(); } catch (_) {}
        d = { w, h, data: x.getImageData(0, 0, w, h).data, srgb: tex.colorSpace === THREE.SRGBColorSpace, flipY: !!tex.flipY, m: tex.matrix ? tex.matrix.elements.slice() : null, clamp: tex.wrapS === THREE.ClampToEdgeWrapping };
      }
    } catch (_) { d = null; }
    imgOf.set(tex, d);
    return d;
  }
  // The colour of the original under (face, barycentric weights), linear, as a function for one part.
  function samplerOf(p, geom) {
    const h = _matHolder(p), raw = h ? _matOf(h) : null, mats = Array.isArray(raw) ? raw : [raw];
    const nF = geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3;
    const ix = geom.index ? geom.index.array : null;
    const faceMat = new Uint16Array(nF);
    if (geom.groups && geom.groups.length > 1) for (const g of geom.groups) for (let f = g.start / 3; f < Math.min(nF, (g.start + g.count) / 3); f++) faceMat[f] = g.materialIndex | 0;
    const uv = geom.attributes.uv, col = geom.attributes.color;
    const tex = mats.map(m => (m && m.map ? pixelsOf(m.map) : null));
    const out = [1, 1, 1];
    return (f, w0, w1, w2) => {
      const mi = faceMat[f] < mats.length ? faceMat[f] : 0, m = mats[mi];
      let r = 1, g = 1, b = 1;
      if (m && m.color) { r = m.color.r; g = m.color.g; b = m.color.b; }
      const a = ix ? ix[3 * f] : 3 * f, c1 = ix ? ix[3 * f + 1] : 3 * f + 1, c2 = ix ? ix[3 * f + 2] : 3 * f + 2;
      if (m && m.vertexColors && col) {
        r *= w0 * col.getX(a) + w1 * col.getX(c1) + w2 * col.getX(c2);
        g *= w0 * col.getY(a) + w1 * col.getY(c1) + w2 * col.getY(c2);
        b *= w0 * col.getZ(a) + w1 * col.getZ(c1) + w2 * col.getZ(c2);
      }
      const T = tex[mi];
      if (T && uv) {
        let u = w0 * uv.getX(a) + w1 * uv.getX(c1) + w2 * uv.getX(c2), v = w0 * uv.getY(a) + w1 * uv.getY(c1) + w2 * uv.getY(c2);
        if (T.m) { const e = T.m, u2 = e[0] * u + e[3] * v + e[6]; v = e[1] * u + e[4] * v + e[7]; u = u2; }
        if (T.clamp) { u = Math.min(1, Math.max(0, u)); v = Math.min(1, Math.max(0, v)); } else { u -= Math.floor(u); v -= Math.floor(v); }
        const px = Math.min(T.w - 1, Math.floor(u * T.w)), py = Math.min(T.h - 1, Math.floor((T.flipY ? 1 - v : v) * T.h)), k = 4 * (py * T.w + px);
        r *= T.srgb ? toLin[T.data[k]] : T.data[k] / 255; g *= T.srgb ? toLin[T.data[k + 1]] : T.data[k + 1] / 255; b *= T.srgb ? toLin[T.data[k + 2]] : T.data[k + 2] / 255;
      }
      out[0] = r; out[1] = g; out[2] = b;
      return out;
    };
  }

  const onLayout = layoutGeometry;

  // ── the job ──
  // Ambient occlusion: how much of the sky a point of the ORIGINAL surface sees, from rays cast in a cosine-weighted hemisphere round its
  // normal against all the originals together (in the scene, so a part shades the next one), a hit counting for more the nearer it is. Done
  // at half the size of the other pictures (occlusion changes slowly), on the same layout. Returns { data, size } or { skipped }.
  async function aoPass(work, geoms, bvh, opt, last, from, span) {
    let nT = 0, nV = 0, nI = 0;
    for (const w of work) { const g = w.high, pc = g.attributes.position.count, ic = g.index ? g.index.count : pc; nV += pc; nI += ic; nT += ic / 3; }
    if (nT > 8e6) return { skipped: 'the originals have more than 8 million triangles together' };
    const P = new Float32Array(nV * 3), I = new Uint32Array(nI), v = new THREE.Vector3(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let vo = 0, io = 0;
    for (const w of work) {
      w.p.mesh.updateWorldMatrix(true, false);
      const mw = w.p.mesh.matrixWorld, pa = w.high.attributes.position, ix = w.high.index ? w.high.index.array : null, ic = ix ? ix.length : pa.count;
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(mw);
        const j = 3 * (vo + i); P[j] = v.x; P[j + 1] = v.y; P[j + 2] = v.z;
        if (v.x < lo[0]) lo[0] = v.x; if (v.x > hi[0]) hi[0] = v.x; if (v.y < lo[1]) lo[1] = v.y; if (v.y > hi[1]) hi[1] = v.y; if (v.z < lo[2]) lo[2] = v.z; if (v.z > hi[2]) hi[2] = v.z;
      }
      for (let i = 0; i < ic; i++) I[io + i] = (ix ? ix[i] : i) + vo;
      vo += pa.count; io += ic;
    }
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    await tick({ t: 0 }, from, 'Preparing occlusion…');
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(P, 3)); mg.setIndex(new THREE.BufferAttribute(I, 1));
    const scene = new bvh.MeshBVH(mg);
    const dist = Math.max(1e-9, opt.aoDist / 100 * diag), eps = Math.max(dist * 0.002, diag * 1e-7);
    const K = Math.max(4, Math.min(128, opt.aoRays | 0 || 16)), dirs = [];
    for (let i = 0; i < K; i++) {                                    // (Hammersley: even over the hemisphere, whatever K is)
      let bits = i, r = 0, f = 0.5; while (bits) { if (bits & 1) r += f; f /= 2; bits >>= 1; }
      const u = (i + 0.5) / K, rad = Math.sqrt(u), ph = 2 * Math.PI * r;
      dirs.push([rad * Math.cos(ph), rad * Math.sin(ph), Math.sqrt(1 - u)]);
    }
    const asize = Math.max(256, opt.size >> 1), ao = new Uint8ClampedArray(asize * asize * 4), mask = new Uint8Array(asize * asize);
    const ray = new THREE.Ray(), org = new THREE.Vector3(), dir = new THREE.Vector3(), tv = new THREE.Vector3(), bv = new THREE.Vector3(), nW = new THREE.Vector3(), pW = new THREE.Vector3();
    const pt = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), bar = new THREE.Vector3(), tri = new THREE.Triangle(), hn = new THREE.Vector3(), q = new THREE.Vector3(), nm = new THREE.Matrix3();
    const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    let doneTris = 0, allTris = 0, cover = 0;
    for (const g of geoms) if (g) allTris += g.index.count / 3;
    for (let wi = 0; wi < work.length; wi++) {
      const g = geoms[wi]; if (!g) continue;
      const w = work[wi], hg = w.high, ownTree = !hg.boundsTree;
      if (ownTree) hg.boundsTree = new bvh.MeshBVH(hg, { indirect: true });
      const mw = w.p.mesh.matrixWorld; nm.getNormalMatrix(mw);
      const hi2 = hg.index ? hg.index.array : null, hp = hg.attributes.position, hnr = hg.attributes.normal, lp = g.attributes.position, li = g.index.array, uv = g.attributes.uv.array, nT2 = li.length / 3;
      let STEP = 8;
      for (let t0 = 0; t0 < nT2;) {
        if (cancelled) throw 0;
        const t1 = Math.min(nT2, t0 + STEP), clock = performance.now();
        rasterise(uv, g.index.array,asize, (x, y, t, w0, w1, w2) => {
          const k = y * asize + x; if (mask[k]) return;
          a.fromBufferAttribute(lp, li[3 * t]); b.fromBufferAttribute(lp, li[3 * t + 1]); c.fromBufferAttribute(lp, li[3 * t + 2]);
          pt.set(w0 * a.x + w1 * b.x + w2 * c.x, w0 * a.y + w1 * b.y + w2 * c.y, w0 * a.z + w1 * b.z + w2 * c.z);
          const r = hg.boundsTree.closestPointToPoint(pt, hit); if (!r) return;
          const f = r.faceIndex, A = hi2 ? hi2[3 * f] : 3 * f, B = hi2 ? hi2[3 * f + 1] : 3 * f + 1, C = hi2 ? hi2[3 * f + 2] : 3 * f + 2;
          tri.a.fromBufferAttribute(hp, A); tri.b.fromBufferAttribute(hp, B); tri.c.fromBufferAttribute(hp, C);
          tri.getBarycoord(r.point, bar);
          if (hnr) { hn.fromBufferAttribute(hnr, A).multiplyScalar(bar.x).addScaledVector(q.fromBufferAttribute(hnr, B), bar.y).addScaledVector(q.fromBufferAttribute(hnr, C), bar.z); } else tri.getNormal(hn);
          nW.copy(hn).applyMatrix3(nm).normalize(); pW.copy(r.point).applyMatrix4(mw);
          org.copy(pW).addScaledVector(nW, eps);
          // a frame round the normal, turned by an angle of this texel's own so the pattern does not show as bands
          if (Math.abs(nW.x) < 0.9) tv.set(1, 0, 0); else tv.set(0, 1, 0);
          tv.cross(nW).normalize(); bv.crossVectors(nW, tv);
          const rot = (((x * 73856093) ^ (y * 19349663)) & 1023) / 1024 * 2 * Math.PI, cr = Math.cos(rot), sr = Math.sin(rot);
          let occ = 0;
          for (let i = 0; i < K; i++) {
            const d = dirs[i], dx = d[0] * cr - d[1] * sr, dy = d[0] * sr + d[1] * cr;
            dir.set(0, 0, 0).addScaledVector(tv, dx).addScaledVector(bv, dy).addScaledVector(nW, d[2]);
            ray.origin.copy(org); ray.direction.copy(dir);
            const h = scene.raycastFirst(ray, THREE.DoubleSide, 0, dist);
            if (h) occ += 1 - h.distance / dist;
          }
          const val = Math.round(255 * (1 - occ / K)), j = 4 * k;
          ao[j] = ao[j + 1] = ao[j + 2] = val; ao[j + 3] = 255; mask[k] = 1; cover++;
        }, t0, t1);
        doneTris += t1 - t0; t0 = t1;
        STEP = Math.max(1, Math.min(4096, Math.round(STEP * 25 / Math.max(1, performance.now() - clock))));
        await tick(last, from + span * doneTris / Math.max(1, allTris), 'Occlusion ' + Math.round(100 * doneTris / Math.max(1, allTris)) + ' %');
      }
      if (ownTree) hg.boundsTree = null;
    }
    if (!cover) return { skipped: 'no surface to shade' };
    dilate(mask, asize, opt.pad + 1, (to, fr) => { const j = 4 * to, i = 4 * fr; ao[j] = ao[i]; ao[j + 1] = ao[i + 1]; ao[j + 2] = ao[i + 2]; ao[j + 3] = 255; });
    for (let k = 0; k < asize * asize; k++) if (!mask[k]) { const j = 4 * k; ao[j] = ao[j + 1] = ao[j + 2] = 255; ao[j + 3] = 255; }
    return { data: ao, size: asize };
  }
  const tick = async (last, pct, label) => { if (performance.now() - last.t < 30) return; last.t = performance.now(); _Tasks.set('bake', { detail: label, pct }); const l = $i('bk-run-lbl'); if (l) l.textContent = label; await _nextFrame(); };
  async function bake(over) {
    const ids = over && over.ids && over.ids.length ? over.ids : [...(state.selected || [])];
    const parts = ids.map(id => getPart(id)).filter(p => p && !p.deleted && p.mesh && p.mesh.geometry && p.mesh.geometry.attributes.position && !p.isSpline && !p.isCloner && (p.triCount || 0) >= 1);
    if (!parts.length) { if (!(over && over.quiet)) toast('Bake textures', 'Select parts first', 'warn', 2500); return { ok: false, why: 'nothing selected' }; }
    const opt = { ...o, ...(over || {}) };
    return _Job.run('Bake textures', () => run(parts, opt), { task: false });
  }
  async function run(parts, opt) {
    busy = true; cancelled = false;
    const btn = $i('bk-run'), lbl = $i('bk-run-lbl'), was = lbl ? lbl.textContent : '';
    if (btn) btn.disabled = true;
    _Tasks.set('bake', { label: 'Bake textures', detail: 'Reducing…', pct: 0, cancel: () => { cancelled = true; } });
    const last = { t: 0 }, size = opt.size, skipped = [], bakedParts = [], kept = [];
    const matBefore = _matStateSnap();
    let result = { ok: false, why: 'stopped' };
    try {
      try { await _loadSimplifier(); } catch (_) {}       // (the helpers that weld a mesh for reduction need it, as Decimate does)
      const meshopt = await _loadMeshopt();
      const bvh = await import('three-mesh-bvh');
      // 1. reduced copies
      const work = [];
      for (let i = 0; i < parts.length; i++) {
        if (cancelled) throw 0;
        const p = parts[i], high = p.mesh.geometry;
        let low = null;
        // (as Decimate does: a result that has lost its shape is tried again gentler, and a part that keeps it at none of them is left whole)
        if (opt.reduce > 0 && meshopt && (p.triCount | 0) >= MIN_REDUCE) {     // (a part of a few dozen triangles is baked as it is: a reduction there is a different shape)
          try {
            const s0 = _shapeOf(high);
            let keep = 1 - opt.reduce / 100, tries = 0;
            low = _simplifyKeepingAttributes(meshopt, high, keep, 0);
            while (low && !_keepsShape(s0, _shapeOf(low)) && tries++ < 3 && keep < 0.9) { keep = Math.min(0.9, keep * 1.6); low = _simplifyKeepingAttributes(meshopt, high, keep, 0); }
            if (low && !_keepsShape(s0, _shapeOf(low))) { low = null; kept.push(p.name); }
          } catch (e) { console.warn('[bake] could not reduce ' + p.name + ':', e); low = null; }
        }
        if (!low) low = high.clone();
        if (!low.index) { const n = low.attributes.position.count, idx = new Uint32Array(n); for (let k = 0; k < n; k++) idx[k] = k; low.setIndex(new THREE.BufferAttribute(idx, 1)); }
        p.mesh.updateWorldMatrix(true, false);
        const sv = p.mesh.getWorldScale(new THREE.Vector3()), scale = Math.cbrt(Math.abs(sv.x * sv.y * sv.z)) || 1;
        const pa = low.attributes.position, P = new Float32Array(pa.count * 3);
        for (let v = 0; v < pa.count; v++) { P[3 * v] = pa.getX(v); P[3 * v + 1] = pa.getY(v); P[3 * v + 2] = pa.getZ(v); }
        work.push({ p, high, low, P, I: Uint32Array.from(low.index.array), scale });
        await tick(last, 5 * i / parts.length, 'Reducing ' + (i + 1) + ' of ' + parts.length + '…');
      }
      // 2. one layout for all of them
      await tick({ t: 0 }, 6, 'Laying out…');
      const lay = unwrapParts(work.map(w => ({ P: w.P, I: w.I, scale: w.scale })), { size, pad: opt.pad, maxAngle: opt.angle });
      if (!lay.density) { result = { ok: false, why: lay.why || 'the parts could not be laid out' }; toast('Bake textures', 'The parts could not be laid out: ' + result.why, 'warn', 5000); return result; }
      const geoms = work.map((w, i) => (lay.parts[i] ? onLayout(w.low, lay.parts[i]) : null));
      // 3. the pictures: colour and normals in one walk over the texels, then (apart, at half the size) the occlusion
      const wantC = opt.colour !== false, wantN = !!opt.normals, wantO = !!opt.ao;
      const rgba = wantC ? new Uint8ClampedArray(size * size * 4) : null, nrm = wantN ? new Uint8ClampedArray(size * size * 4) : null, mask = new Uint8Array(size * size);
      let sumR = 0, sumG = 0, sumB = 0, cover = 0, doneTris = 0, allTris = 0;
      for (const g of geoms) if (g) allTris += g.index.count / 3;
      const span = wantO ? 45 : 80;
      const V3 = () => new THREE.Vector3();
      const pt = V3(), a = V3(), b = V3(), c = V3(), bar = V3(), tri = new THREE.Triangle(), hit = { point: V3(), distance: 0, faceIndex: 0 };
      const nA = V3(), nB = V3(), nC = V3(), N = V3(), S = V3(), T = V3(), hn = V3(), q1 = V3(), q2 = V3(), q3 = V3();
      const tc = { t: -1, ok: false };
      for (let wi = 0; wi < work.length; wi++) {
        const g = geoms[wi]; if (!g) { skipped.push(work[wi].p.name + ' (no surface to lay out)'); continue; }
        const w = work[wi], hg = w.high;
        const ownTree = !hg.boundsTree;                       // (a tree the part already has, for picking, is used and left in place)
        if (ownTree) hg.boundsTree = new bvh.MeshBVH(hg, { indirect: true });
        const sample = wantC ? samplerOf(w.p, hg) : null, hi = hg.index ? hg.index.array : null, hp = hg.attributes.position, hnr = hg.attributes.normal;
        const lp = g.attributes.position, ln = g.attributes.normal, li = g.index.array, uv = g.attributes.uv.array;
        const nT = li.length / 3;
        let STEP = 64; tc.t = -1;
        for (let t0 = 0; t0 < nT;) {
          if (cancelled) throw 0;
          const t1 = Math.min(nT, t0 + STEP), clock = performance.now();
          rasterise(uv, g.index.array,size, (x, y, t, w0, w1, w2) => {
            const k = y * size + x; if (mask[k]) return;
            const ia = li[3 * t], ib = li[3 * t + 1], ic = li[3 * t + 2];
            a.fromBufferAttribute(lp, ia); b.fromBufferAttribute(lp, ib); c.fromBufferAttribute(lp, ic);
            pt.set(w0 * a.x + w1 * b.x + w2 * c.x, w0 * a.y + w1 * b.y + w2 * c.y, w0 * a.z + w1 * b.z + w2 * c.z);
            const r = hg.boundsTree.closestPointToPoint(pt, hit); if (!r) return;
            const f = r.faceIndex, A = hi ? hi[3 * f] : 3 * f, B = hi ? hi[3 * f + 1] : 3 * f + 1, C = hi ? hi[3 * f + 2] : 3 * f + 2;
            tri.a.fromBufferAttribute(hp, A); tri.b.fromBufferAttribute(hp, B); tri.c.fromBufferAttribute(hp, C);
            tri.getBarycoord(r.point, bar);
            if (wantC) {
              const col = sample(f, bar.x, bar.y, bar.z), j = 4 * k;
              rgba[j] = enc(col[0]); rgba[j + 1] = enc(col[1]); rgba[j + 2] = enc(col[2]); rgba[j + 3] = 255;
              sumR += col[0]; sumG += col[1]; sumB += col[2];
            }
            if (wantN) {
              // the frame the shader builds on this triangle from its UVs (S along U, T along V, N smooth), and the normal of the original in it
              if (tc.t !== t) {
                tc.t = t; tc.ok = false;
                const du1 = uv[2 * ib] - uv[2 * ia], dv1 = uv[2 * ib + 1] - uv[2 * ia + 1], du2 = uv[2 * ic] - uv[2 * ia], dv2 = uv[2 * ic + 1] - uv[2 * ia + 1], det = du1 * dv2 - du2 * dv1;
                if (Math.abs(det) > 1e-30) {
                  q1.subVectors(b, a); q2.subVectors(c, a);
                  S.copy(q1).multiplyScalar(dv2).addScaledVector(q2, -dv1).divideScalar(det);
                  T.copy(q2).multiplyScalar(du1).addScaledVector(q1, -du2).divideScalar(det);
                  tc.ok = S.lengthSq() > 0 && T.lengthSq() > 0; S.normalize(); T.normalize();
                }
                if (ln) { nA.fromBufferAttribute(ln, ia); nB.fromBufferAttribute(ln, ib); nC.fromBufferAttribute(ln, ic); }
              }
              let nx = 0, ny = 0, nz = 1;
              if (tc.ok && ln) {
                N.set(0, 0, 0).addScaledVector(nA, w0).addScaledVector(nB, w1).addScaledVector(nC, w2).normalize();
                if (hnr) { hn.fromBufferAttribute(hnr, A).multiplyScalar(bar.x); hn.addScaledVector(q3.fromBufferAttribute(hnr, B), bar.y).addScaledVector(q3.fromBufferAttribute(hnr, C), bar.z); } else tri.getNormal(hn);
                hn.normalize();
                q1.crossVectors(T, N); const D = S.dot(q1);
                if (Math.abs(D) > 1e-6) {
                  const x = hn.dot(q1) / D, yp = S.dot(q2.crossVectors(hn, N)) / D, z = S.dot(q3.crossVectors(T, hn)) / D, l = Math.hypot(x, yp, z);
                  if (l > 0) { nx = x / l; ny = -yp / l; nz = z / l; }       // (green up in the picture, V from the top: normalScale.y is -1 on the material, as three's glTF reader sets it)
                }
              }
              const j = 4 * k; nrm[j] = Math.round((nx * 0.5 + 0.5) * 255); nrm[j + 1] = Math.round((ny * 0.5 + 0.5) * 255); nrm[j + 2] = Math.round((nz * 0.5 + 0.5) * 255); nrm[j + 3] = 255;
            }
            mask[k] = 1; cover++;
          }, t0, t1);
          doneTris += t1 - t0; t0 = t1;
          // (a slice of about 25 ms: the number of triangles in it follows how long the last one took)
          STEP = Math.max(1, Math.min(8192, Math.round(STEP * 25 / Math.max(1, performance.now() - clock))));
          await tick(last, 8 + span * doneTris / Math.max(1, allTris), 'Baking ' + Math.round(100 * doneTris / Math.max(1, allTris)) + ' %');
        }
        if (ownTree) hg.boundsTree = null;
      }
      if (!cover) { toast('Bake textures', 'Nothing was baked', 'warn', 3500); return { ok: false, why: 'nothing was baked' }; }
      // 4. past the edges, and what no piece covers: the average colour, a flat normal
      await tick({ t: 0 }, 8 + span, 'Finishing…');
      dilate(mask, size, opt.pad + 1, (to, from) => {
        const j = 4 * to, i = 4 * from;
        if (rgba) { rgba[j] = rgba[i]; rgba[j + 1] = rgba[i + 1]; rgba[j + 2] = rgba[i + 2]; rgba[j + 3] = 255; }
        if (nrm) { nrm[j] = nrm[i]; nrm[j + 1] = nrm[i + 1]; nrm[j + 2] = nrm[i + 2]; nrm[j + 3] = 255; }
      });
      const avg = [enc(sumR / cover), enc(sumG / cover), enc(sumB / cover)];
      for (let k = 0; k < size * size; k++) if (!mask[k]) {
        const j = 4 * k;
        if (rgba) { rgba[j] = avg[0]; rgba[j + 1] = avg[1]; rgba[j + 2] = avg[2]; rgba[j + 3] = 255; }
        if (nrm) { nrm[j] = 128; nrm[j + 1] = 128; nrm[j + 2] = 255; nrm[j + 3] = 255; }
      }
      const picture = (data, n, srgb, name) => {
        const cv = document.createElement('canvas'); cv.width = cv.height = n;
        cv.getContext('2d').putImageData(new ImageData(data, n, n), 0, 0);
        const t = new THREE.CanvasTexture(cv);
        t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8; t.name = name;
        t.userData.mimeType = 'image/png';
        return t;
      };
      const texC = rgba ? picture(rgba, size, true, 'Baked colour') : null, texN = nrm ? picture(nrm, size, false, 'Baked normals') : null;
      let texO = null, aoNote = '';
      if (wantO) {
        const ao = await aoPass(work, geoms, bvh, opt, last, 8 + span, 100 - 8 - span - 4);
        if (ao.data) texO = picture(ao.data, ao.size, false, 'Baked occlusion'); else aoNote = ao.skipped || 'it could not be done';
      }
      if (!texC && !texN && !texO) { toast('Bake textures', 'No map was baked' + (aoNote ? ': ' + aoNote : ''), 'warn', 4000); return { ok: false, why: aoNote || 'no map was baked' }; }
      // 5. onto the parts
      const first = _matOf(_matHolder(work[0].p)), m0 = Array.isArray(first) ? first[0] : first;
      const mat = _newMaterial({ roughness: m0 && Number.isFinite(m0.roughness) ? m0.roughness : 0.6, metalness: m0 && Number.isFinite(m0.metalness) ? m0.metalness : 0.1, name: 'Baked' });
      if (texC || !(m0 && m0.color)) mat.color.set(0xffffff); else mat.color.copy(m0.color);
      if (texC) mat.map = texC;
      if (texN) { mat.normalMap = texN; mat.normalScale.set(1, -1); }
      if (texO) { mat.aoMap = texO; mat.aoMapIntensity = 1; }
      mat.needsUpdate = true;
      state.userMaterials = state.userMaterials || new Set(); state.userMaterials.add(mat);
      const items = []; let trisBefore = 0, trisAfter = 0;
      for (let wi = 0; wi < work.length; wi++) {
        const g = geoms[wi]; if (!g) continue;
        const w = work[wi], p = w.p; if (p.deleted || !p.mesh || p.mesh.geometry !== w.high) { skipped.push(p.name + ' (changed while it was being baked)'); continue; }
        const before = _decSnap(p);
        p.mesh.geometry = _stampGeometry(g);
        p.hash = 'bk_' + p.partId + '_' + (state._decSeq = (state._decSeq | 0) + 1);
        state.geomByHash.set(p.hash, g);
        trisBefore += p.triCount | 0;
        p.triCount = g.index.count / 3; p.vertCount = g.attributes.position.count; trisAfter += p.triCount;
        _refreshPartBBox(p); p._fp = null; p._fpKey = null;
        try { _cadEdgesPartSwapped(p); } catch (_) {}
        _matSet(_matHolder(p), mat);
        items.push({ partId: p.partId, before, after: _decSnap(p) });
        bakedParts.push(p.name);
      }
      if (items.length) pushBakeUndo('Bake textures', items, matBefore);
      settle();
      result = { ok: true, parts: items.length, triangles_before: trisBefore, triangles_after: trisAfter, picture: size, coverage: +(lay.used * 100).toFixed(1), skipped, kept_whole: kept };
      toast('Baked', fmtNum(items.length) + (items.length === 1 ? ' part' : ' parts') + ' on one ' + size + ' picture · ' + fmtNum(trisBefore) + ' → ' + fmtNum(trisAfter) + ' triangles' + (kept.length ? ' · ' + fmtNum(kept.length) + (kept.length === 1 ? ' part' : ' parts') + ' kept whole (a reduction would lose its shape)' : '') + (skipped.length ? ' · skipped ' + skipped.slice(0, 2).join(', ') : ''), 'success', 5000);
      _CmdCards.close('bake');
    } catch (e) {
      if (e === 0) { toast('Bake textures', 'Stopped. Nothing was changed.', 'info', 3000); result = { ok: false, why: 'stopped' }; }
      else { console.error('[bake]', e); toast('Bake textures', 'Failed: ' + ((e && e.message) || e), 'error', 6000); result = { ok: false, why: (e && e.message) || String(e) }; }
    } finally {
      busy = false; _Tasks.end('bake');
      if (btn) btn.disabled = false; if (lbl) lbl.textContent = was || 'Bake';
      imgOf.clear();
    }
    return result;
  }

  // ── the card ──
  const niceTris = () => { let n = 0, k = 0; for (const id of state.selected || []) { const p = getPart(id); if (p && !p.deleted && p.mesh) { n += p.triCount || 0; k++; } } return { n, k }; };
  function stats() {
    const box = $i('bk-stats'); if (!box) return;
    const { n, k } = niceTris(), row = (a, v) => '<dt>' + a + '</dt><dd>' + v + '</dd>';
    box.innerHTML = row('Parts', fmtNum(k)) + row('Triangles', k ? fmtNum(n) + ' → about ' + fmtNum(Math.round(n * (1 - o.reduce / 100))) : 'none selected') + row('Maps', [o.colour && 'colour', o.normals && 'normals', o.ao && 'occlusion'].filter(Boolean).join(', ') || 'none chosen') + row('Picture', o.size + ' × ' + o.size + ' px' + (o.ao ? ' (occlusion ' + Math.max(256, o.size >> 1) + ')' : '') + ', one for all');
  }
  function scrub(key, el, label, min, max, step, unit) {
    const box = $i(el); if (!box) return;
    box.textContent = '';
    const steps = Math.max(1, Math.round((max - min) / step));
    sc[key] = initScrubber({
      el: box, label, bar: true, maxSteps: steps, stepToVal: (st) => min + st * step, valToStep: (v) => Math.max(0, Math.min(steps, Math.round((v - min) / step))),
      format: (v) => ({ value: String(Math.round(v)), unit }), initialValue: o[key], promptTitle: label, promptUnit: unit,
      onChange: (v) => { o[key] = v; _Prefs.set('bake.' + key, v); stats(); },
    });
  }
  function marks() {
    const seg = $i('bk-size'); if (!seg) return;
    [...seg.querySelectorAll('button')].forEach((b, i) => { const on = +b.dataset.s === o.size; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (on) seg.style.setProperty('--seg-i', i); });
  }
  function wire() {
    if (wired) return; wired = true;
    for (const b of document.querySelectorAll('#bk-size button')) b.addEventListener('click', () => { o.size = +b.dataset.s; _Prefs.set('bake.size', o.size); marks(); stats(); });
    for (const k in SWITCH) $i(SWITCH[k])?.addEventListener('change', (e) => { o[k] = !!e.target.checked; _Prefs.set('bake.' + k, o[k]); stats(); });
    $i('bk-run')?.addEventListener('click', () => { if (!busy) bake(); });
    $i('bk-reset')?.addEventListener('click', () => { for (const k of ['angle', 'pad', 'aoDist', 'aoRays']) { o[k] = DEF[k]; _Prefs.set('bake.' + k, o[k]); } open(); });
    document.querySelector('.section-cmd[data-cmd="bake"]')?.addEventListener('cmd-close', () => { if (busy) cancelled = true; });
  }
  function open() {
    wire();
    scrub('reduce', 'bk-reduce-scrub', 'Reduce by', 0, 90, 5, '%');
    scrub('angle', 'bk-angle-scrub', 'Cut pieces where surfaces turn', 20, 85, 5, '°');
    scrub('pad', 'bk-pad-scrub', 'Edge margin', 1, 16, 1, 'px');
    scrub('aoDist', 'bk-aodist-scrub', 'Occlusion reaches', 1, 25, 1, '%');
    scrub('aoRays', 'bk-aorays-scrub', 'Occlusion rays', 4, 64, 4, '');
    for (const k in SWITCH) { const c = $i(SWITCH[k]); if (c) c.checked = !!o[k]; }
    marks(); stats();
    const lbl = $i('bk-run-lbl'); if (lbl) lbl.textContent = 'Bake';
    _CmdCards.open('bake');
  }
  function follow() { if (_CmdCards.isOpen('bake') && !busy) stats(); }

  window.__moAgent = Object.assign(window.__moAgent || {}, {
    bakeCard: () => open(),
    // for Claude and tests: reduce_percent, size (px), ids, quiet
    // maps: a list out of 'colour', 'normals', 'occlusion' (default: colour and normals)
    bakeTextures: _Job.strict((x) => {
      const maps = x && Array.isArray(x.maps) && x.maps.length ? x.maps.map(String) : ['colour', 'normals'];
      return bake({
        ...(x && x.reduce_percent != null ? { reduce: x.reduce_percent } : {}), ...(x && x.size ? { size: x.size } : {}), ...(x && x.ids ? { ids: x.ids } : {}),
        colour: maps.includes('colour'), normals: maps.includes('normals'), ao: maps.includes('occlusion'),
        ...(x && x.occlusion_reach_percent > 0 ? { aoDist: x.occlusion_reach_percent } : {}), ...(x && x.occlusion_rays > 0 ? { aoRays: x.occlusion_rays } : {}),
        quiet: !!(x && x.quiet),
      });
    }),
  });
  return { open, follow, bake };
}
