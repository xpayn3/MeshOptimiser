// The shared pieces of the help-card clips (assets/help/*.webm): CAD-style geometry helpers built on
// three.js, a small software rasteriser (z-buffer, smooth shading, translucent shells) and the ffmpeg
// step. No GPU and no browser. There are no mesh edge lines: shading and the dark seam where one part
// passes in front of another are all the drawing there is.
//
// A scene is  { parts, camera(t), fov, shadow(t) }  where each part is
//   { mesh: prepare(geometry), at(t) -> { m: Matrix4, sel: 0..1, alpha: 0..1 } }
// sel blends the part's colour toward the accent (the app's selection colour), alpha < 1 draws it as
// glass (no depth write, so what is behind it stays visible).
import * as T from '../vendor/three/build/three.core.js';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export { T };
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.resolve(HERE, '..', 'assets', 'help');
export const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export let W = 592, H = 370, N = 150;
export const SS = 2, FPS = 25;
let RW = W * SS, RH = H * SS;
export const BG = [22, 22, 22];                       // the card's surface (--surface-pop, #161616)
export const GREY = [190, 193, 200];
export const ACCENT = [13, 153, 255];                 // --ac, the app's selection colour

// ── geometry helpers ───────────────────────────────────────────────────────────────────────────────
export const BEV = { bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.7, bevelOffset: 0, bevelSegments: 3, curveSegments: 32 };
export const rrect = (x, y, w, h, r) => {
  const R = Array.isArray(r) ? r : [r, r, r, r], s = new T.Shape(), P = Math.PI;
  s.moveTo(x + R[0], y); s.lineTo(x + w - R[1], y);
  if (R[1]) s.absarc(x + w - R[1], y + R[1], R[1], -P / 2, 0, false); else s.lineTo(x + w, y);
  s.lineTo(x + w, y + h - R[2]);
  if (R[2]) s.absarc(x + w - R[2], y + h - R[2], R[2], 0, P / 2, false); else s.lineTo(x + w, y + h);
  s.lineTo(x + R[3], y + h);
  if (R[3]) s.absarc(x + R[3], y + h - R[3], R[3], P / 2, P, false); else s.lineTo(x, y + h);
  s.lineTo(x, y + R[0]);
  if (R[0]) s.absarc(x + R[0], y + R[0], R[0], P, P * 1.5, false); else s.lineTo(x, y);
  return s;
};
export const hole = (shape, x, y, r) => { const p = new T.Path(); p.absarc(x, y, r, 0, Math.PI * 2, true); shape.holes.push(p); };
export const slot = (shape, x0, x1, y, r) => { const p = new T.Path(); p.moveTo(x0, y - r); p.lineTo(x1, y - r); p.absarc(x1, y, r, -Math.PI / 2, Math.PI / 2, false); p.lineTo(x0, y + r); p.absarc(x0, y, r, Math.PI / 2, Math.PI * 1.5, false); shape.holes.push(p); };
export const ext = (shape, depth, opts = BEV) => new T.ExtrudeGeometry(shape, { depth, ...opts });
export const mat = (rows) => { const m = new T.Matrix4(); m.set(rows[0][0], rows[0][1], rows[0][2], rows[0][3] || 0, rows[1][0], rows[1][1], rows[1][2], rows[1][3] || 0, rows[2][0], rows[2][1], rows[2][2], rows[2][3] || 0, 0, 0, 0, 1); return m; };
// a shape drawn in (u, v) and extruded: onto the XY plane, or standing in the YZ plane (extruded along x), or in the XZ plane (along y)
export const inYZ = (g, x0) => g.applyMatrix4(mat([[0, 0, 1, x0], [1, 0, 0], [0, 1, 0]]));            // (u,v,w) -> (x = x0 + w, y = u, z = v)
export const inXZ = (g, y0) => g.applyMatrix4(mat([[1, 0, 0], [0, 0, 1, y0], [0, 1, 0]]));            // (u,v,w) -> (x = u, y = y0 + w, z = v)   (a mirror: the renderer lights both sides)
export const lathe = (pts, seg = 56) => new T.LatheGeometry(pts.map(([r, a]) => new T.Vector2(r, a)), seg);   // axis: local y
export const alongX = (g, x0, y, z) => g.applyMatrix4(mat([[0, 1, 0, x0], [-1, 0, 0, y], [0, 0, 1, z]]));    // local y -> x
export const alongZ = (g, x, y, z0) => g.applyMatrix4(mat([[1, 0, 0, x], [0, 0, -1, y], [0, 1, 0, z0]]));    // local y -> z
export const merge = (list) => {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  const total = parts.reduce((s, g) => s + g.attributes.position.array.length, 0);
  const pos = new Float32Array(total); let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const out = new T.BufferGeometry(); out.setAttribute('position', new T.BufferAttribute(pos, 3)); return out;
};
// ── a spur gear: n teeth, module m, face width w, a hub, a bore and `holes` lightening holes. The tooth is a plain
// trapezoid, a little narrower than the gap (backlash), so it reads as a gear. z from 0 to w; the hub reaches 3 beyond.
export function gearGeometry(n, m, bore, holes, holeR, holeRing, hubR, w = 8) {
  const Rp = n * m / 2, Ra = Rp + m, Rr = Rp - 1.25 * m, p = Math.PI * 2 / n, s = new T.Shape();
  const pt = (r, a) => [r * Math.cos(a), r * Math.sin(a)], pts = [];
  for (let i = 0; i < n; i++) { const a = i * p; pts.push(pt(Rr, a - 0.34 * p), pt(Rp, a - 0.24 * p), pt(Ra, a - 0.12 * p), pt(Ra, a + 0.12 * p), pt(Rp, a + 0.24 * p), pt(Rr, a + 0.34 * p), pt(Rr * 0.998, a + 0.5 * p)); }
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  hole(s, 0, 0, bore);
  for (let k = 0; k < holes; k++) { const a = k * Math.PI * 2 / holes; hole(s, holeRing * Math.cos(a), holeRing * Math.sin(a), holeR); }
  const g = ext(s, w - 0.6, { bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 1, curveSegments: 24 }).translate(0, 0, 0.3);
  const hub = alongZ(lathe([[bore, -3], [hubR, -3], [hubR, w + 3], [bore, w + 3]], 56), 0, 0, 0);
  return merge([g, hub]);
}

// ── a hex bolt along +z: the washer face (and a washer, if washerR) at z = 0, the head above it, the shank going down to -len
export function hexBolt({ headR = 7.5, headH = 5.4, shankR = 4, len = 16, washerR = 0, pitch = 2 } = {}) {
  const g = [], zh = washerR ? 1.1 : 0, kx = headR / 7.5, kz = headH / 5.4;
  if (washerR) g.push(alongZ(lathe([[shankR + 0.9, 0], [washerR, 0], [washerR, 1.1], [shankR + 0.9, 1.1]], 56), 0, 0, 0));
  g.push(alongZ(new T.CylinderGeometry(headR, headR, headH, 6, 1).translate(0, headH / 2, 0), 0, 0, zh));
  g.push(alongZ(lathe([[0, headH], [5.0 * kx, headH], [6.7 * kx, 4.5 * kz], [7.3 * kx, 3.4 * kz], [0, 3.4 * kz]], 48), 0, 0, zh));
  g.push(alongZ(lathe([[0, 0.1], [headR * 0.8, 0.1], [headR * 0.8, -0.4], [0, -0.4]], 48), 0, 0, zh));
  const th = [[0, -0.4], [shankR, -0.4]]; let a = -0.4;
  if (pitch) { while (a - pitch > -len + 1.6) { th.push([shankR * 0.82, a - pitch * 0.48], [shankR, a - pitch * 0.9]); a -= pitch; } }
  th.push([shankR, -len + 0.4], [shankR * 0.78, -len], [0, -len]);
  g.push(alongZ(lathe(th, 44), 0, 0, zh));
  return merge(g);
}
export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const norm = (v) => { const l = Math.hypot(...v); return v.map(c => c / l); };

// ── mesh preparation: smooth shading that keeps the creases ───────────────────────────────────────
export function prepare(geom, creaseDeg = 38) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const p = g.attributes.position.array, nT = p.length / 9, cosC = Math.cos(creaseDeg * Math.PI / 180);
  const fn = new Float32Array(nT * 3), keep = new Uint8Array(nT);
  const key = (i) => Math.round(p[i * 3] * 400) + ',' + Math.round(p[i * 3 + 1] * 400) + ',' + Math.round(p[i * 3 + 2] * 400);
  const byKey = new Map(), keys = new Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = t * 9;
    const ux = p[a + 3] - p[a], uy = p[a + 4] - p[a + 1], uz = p[a + 5] - p[a + 2], vx = p[a + 6] - p[a], vy = p[a + 7] - p[a + 1], vz = p[a + 8] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    keep[t] = 1; fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
    for (let c = 0; c < 3; c++) { const k = key(t * 3 + c); keys[t * 3 + c] = k; (byKey.get(k) || byKey.set(k, []).get(k)).push(t); }
  }
  const nor = new Float32Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    if (!keep[t]) continue;
    for (let c = 0; c < 3; c++) {
      let sx = 0, sy = 0, sz = 0;
      for (const u of byKey.get(keys[t * 3 + c])) { const d = fn[t * 3] * fn[u * 3] + fn[t * 3 + 1] * fn[u * 3 + 1] + fn[t * 3 + 2] * fn[u * 3 + 2]; if (d >= cosC) { sx += fn[u * 3]; sy += fn[u * 3 + 1]; sz += fn[u * 3 + 2]; } }
      const l = Math.hypot(sx, sy, sz) || 1; nor[t * 9 + c * 3] = sx / l; nor[t * 9 + c * 3 + 1] = sy / l; nor[t * 9 + c * 3 + 2] = sz / l;
    }
  }
  return { pos: p, nor, nT, keep };
}

// ── software rasteriser ────────────────────────────────────────────────────────────────────────────
let color, depth, ids, gz, gc, rs, rn;
export function size(w = 592, h = 370, seconds = 6) {   // the picture's size in pixels and the clip's length
  W = w; H = h; N = FPS * seconds; RW = W * SS; RH = H * SS;
  color = new Uint8ClampedArray(RW * RH * 3); depth = new Float32Array(RW * RH); ids = new Int16Array(RW * RH);
  gz = new Float32Array(RW * RH); gc = new Float32Array(RW * RH * 4); rs = new Float32Array(RW * RH * 3); rn = new Uint8Array(RW * RH);   // glass: nearest depth, nearest colour + alpha, the layers behind (sum and count)
}
size();
export function render(scene, t) {
  const { pos: camPos, tgt } = scene.camera(t);
  const cam = new T.PerspectiveCamera(scene.fov, W / H, 10, 3000);
  cam.up.set(0, 0, 1); cam.position.copy(camPos); cam.lookAt(tgt); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const view = cam.matrixWorldInverse, VP = new T.Matrix4().multiplyMatrices(cam.projectionMatrix, view);
  const vp = VP.elements, vw = view.elements;
  // lights in the camera's frame: x right, y up, z toward the viewer
  const KEY = norm([-0.45, 0.62, 0.64]), FILL = norm([0.78, 0.12, 0.42]);
  const HV = norm([KEY[0], KEY[1], KEY[2] + 1]);
  for (let i = 0; i < RW * RH; i++) { color[i * 3] = BG[0]; color[i * 3 + 1] = BG[1]; color[i * 3 + 2] = BG[2]; depth[i] = 0; ids[i] = -1; }
  gz.fill(0); gc.fill(0); rs.fill(0); rn.fill(0);
  const proj = (x, y, z) => { const cx = vp[0]*x + vp[4]*y + vp[8]*z + vp[12], cy = vp[1]*x + vp[5]*y + vp[9]*z + vp[13], cw = vp[3]*x + vp[7]*y + vp[11]*z + vp[15]; return [(cx / cw * 0.5 + 0.5) * RW, (1 - (cy / cw * 0.5 + 0.5)) * RH, 1 / cw]; };
  // a soft shadow on the floor under the parts
  if (scene.shadow) { const s = scene.shadow(t), c = proj(s.x, s.y, s.z), r = proj(s.x + s.rx, s.y, s.z), q = proj(s.x, s.y + s.ry, s.z);
    const rx = Math.abs(r[0] - c[0]), ry = Math.max(14, Math.abs(q[1] - c[1])) * 1.1;
    for (let y = Math.max(0, Math.floor(c[1] - ry)); y < Math.min(RH, Math.ceil(c[1] + ry)); y++) for (let x = Math.max(0, Math.floor(c[0] - rx)); x < Math.min(RW, Math.ceil(c[0] + rx)); x++) {
      const d = Math.hypot((x - c[0]) / rx, (y - c[1]) / ry); if (d >= 1) continue; const f = 1 - 0.62 * Math.pow(1 - d, 1.7), i = (y * RW + x) * 3;
      color[i] = BG[0] * f; color[i + 1] = BG[1] * f; color[i + 2] = BG[2] * f; } }
  const states = scene.parts.map(part => { const st = part.at(t); return { wire: 0, ...st }; });
  const drawn = [];
  // mode 'solid': the opaque parts. Glass is order-independent so nothing flickers as a shell fades: 'gdepth' finds the nearest glass
  // surface at each pixel, 'gshade' lays that surface over the scene at the part's alpha and the layers behind it in as one average.
  const pass = (mode) => scene.parts.forEach((part, pid) => {
    const glass = mode !== 'solid', st = states[pid], isGlass = st.alpha < 0.999; if (isGlass !== glass) return;
    const base = [0, 1, 2].map(k => GREY[k] + (ACCENT[k] - GREY[k]) * st.sel), m = st.m.elements;
    const { pos, nor, nT, keep } = part.mesh;
    const sx = new Float32Array(nT * 3), sy = new Float32Array(nT * 3), sz = new Float32Array(nT * 3);
    for (let v = 0; v < nT * 3; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const s = proj(m[0]*x + m[4]*y + m[8]*z + m[12], m[1]*x + m[5]*y + m[9]*z + m[13], m[2]*x + m[6]*y + m[10]*z + m[14]);
      sx[v] = s[0]; sy[v] = s[1]; sz[v] = s[2];
    }
    if (!glass && st.wire > 0.01) drawn.push({ sx, sy, sz, keep, nT, wire: st.wire });
    for (let tI = 0; tI < nT; tI++) {
      if (!keep[tI]) continue;
      const a = tI * 3, x0 = sx[a], y0 = sy[a], x1 = sx[a + 1], y1 = sy[a + 1], x2 = sx[a + 2], y2 = sy[a + 2];
      const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0); if (Math.abs(area) < 1e-6) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(RW - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(RH - 1, Math.ceil(Math.max(y0, y1, y2)));
      // the three corners' normals: turned by the part's matrix, then into the camera's frame
      const nv = []; for (let c = 0; c < 3; c++) {
        const ox = nor[tI * 9 + c * 3], oy = nor[tI * 9 + c * 3 + 1], oz = nor[tI * 9 + c * 3 + 2];
        const nx = m[0]*ox + m[4]*oy + m[8]*oz, ny = m[1]*ox + m[5]*oy + m[9]*oz, nz = m[2]*ox + m[6]*oy + m[10]*oz;
        nv.push([vw[0]*nx + vw[4]*ny + vw[8]*nz, vw[1]*nx + vw[5]*ny + vw[9]*nz, vw[2]*nx + vw[6]*ny + vw[10]*nz]);
      }
      const inv = 1 / area;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l0 = ((x1 - px) * (y2 - py) - (y1 - py) * (x2 - px)) * inv, l1 = ((x2 - px) * (y0 - py) - (y2 - py) * (x0 - px)) * inv, l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        const z = l0 * sz[a] + l1 * sz[a + 1] + l2 * sz[a + 2], idx = y * RW + x;
        if (z <= depth[idx]) continue;
        if (mode === 'gdepth') { if (z > gz[idx]) gz[idx] = z; continue; }
        let nx = l0 * nv[0][0] + l1 * nv[1][0] + l2 * nv[2][0], ny = l0 * nv[0][1] + l1 * nv[1][1] + l2 * nv[2][1], nz = l0 * nv[0][2] + l1 * nv[1][2] + l2 * nv[2][2];
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }               // a face seen from behind is lit as if from the front
        const kd = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]), fd = Math.max(0, nx * FILL[0] + ny * FILL[1] + nz * FILL[2]);
        const sp = Math.pow(Math.max(0, nx * HV[0] + ny * HV[1] + nz * HV[2]), 36) * 0.22;
        const lit = 0.36 + 0.10 * ny + 0.64 * kd + 0.22 * fd;
        const c = idx * 3;
        if (!glass) {
          depth[idx] = z; ids[idx] = part.group ?? pid;       // parts of one group share a seam: no dark line between them
          color[c] = base[0] * lit + 255 * sp; color[c + 1] = base[1] * lit + 255 * sp; color[c + 2] = base[2] * lit + 255 * sp;
        } else {
          const r = base[0] * lit + 255 * sp, g = base[1] * lit + 255 * sp, b = base[2] * lit + 255 * sp;
          if (z >= gz[idx] * (1 - 1e-6)) { const q = idx * 4; gc[q] = r; gc[q + 1] = g; gc[q + 2] = b; gc[q + 3] = st.alpha; }
          else { rs[c] += r; rs[c + 1] += g; rs[c + 2] += b; rn[idx]++; }
        }
      }
    }
  });
  pass('solid');
  // the mesh, drawn as accent lines over the parts that ask for it (only Cover does: that clip is about triangles)
  for (const { sx, sy, sz, keep, nT, wire } of drawn) {
    for (let tI = 0; tI < nT; tI++) {
      if (!keep[tI]) continue;
      for (let c = 0; c < 3; c++) {
        const i0 = tI * 3 + c, i1 = tI * 3 + (c + 1) % 3, ax = sx[i0], ay = sy[i0], bx = sx[i1], by = sy[i1];
        const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))) || 1;
        for (let k = 0; k <= steps; k++) {
          const f2 = k / steps, x = Math.round(ax + (bx - ax) * f2), y = Math.round(ay + (by - ay) * f2), z = sz[i0] + (sz[i1] - sz[i0]) * f2;
          if (x < 0 || y < 0 || x >= RW || y >= RH) continue;
          const idx = y * RW + x; if (z < depth[idx] * 0.995) continue;
          const q = idx * 3, al = 0.85 * wire;
          color[q] += (ACCENT[0] - color[q]) * al; color[q + 1] += (ACCENT[1] - color[q + 1]) * al; color[q + 2] += (ACCENT[2] - color[q + 2]) * al;
        }
      }
    }
  }
  pass('gdepth'); pass('gshade');
  for (let i = 0; i < RW * RH; i++) {
    const a = gc[i * 4 + 3]; if (a <= 0) continue;
    const c = i * 3, n = rn[i];
    if (n) { const w = (1 - a) * 0.3; for (let k = 0; k < 3; k++) color[c + k] = color[c + k] * (1 - w) + (rs[c + k] / n) * w; }   // what lies behind the nearest surface, faintly
    for (let k = 0; k < 3; k++) color[c + k] = color[c + k] * (1 - a) + gc[i * 4 + k] * a;                                       // the nearest surface at its alpha
  }
  // a dark seam where one solid part ends in front of another: the nearer side darkens
  for (let y = 0; y < RH - 1; y++) for (let x = 0; x < RW - 1; x++) {
    const i = y * RW + x;
    for (const j of [i + 1, i + RW]) {
      if (ids[i] === ids[j]) continue;
      const near = depth[i] > depth[j] ? i : j; if (ids[near] < 0) continue;
      const other = near === i ? j : i; if (ids[other] < 0) continue;          // against the floor the shading is enough
      const c = near * 3; color[c] *= 0.62; color[c + 1] *= 0.62; color[c + 2] *= 0.62;
    }
  }
  // down to the output size: the average of each SS × SS block
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0; for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += color[((y * SS + dy) * RW + x * SS + dx) * 3 + ch];
    out[(y * W + x) * 3 + ch] = Math.round(s / (SS * SS));
  }
  return out;
}

// ── go: a still (to look at) or the clip and its poster ───────────────────────────────────────────
export function run(scene, name) {                 // size() first, if the clip is not 592 x 370                 // writes assets/help/<name>.webm and <name>-poster.webp
  const still = process.argv.find(a => a.startsWith('--still='));
  const tmp = path.join(HERE, '.render-tmp'); fs.mkdirSync(tmp, { recursive: true });
  const toPng = (raw, file) => { const rf = path.join(tmp, 'f.raw'); fs.writeFileSync(rf, raw); execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', rf, '-frames:v', '1', file]); };
  if (still) {
    const t = parseFloat(still.split('=')[1]); toPng(render(scene, t), path.join(HERE, 'still.png')); console.log('still at t =', t);
  } else {
    const raw = path.join(tmp, 'clip.raw'); const fd = fs.openSync(raw, 'w');
    for (let f = 0; f < N; f++) { fs.writeSync(fd, render(scene, f / N)); if (f % 25 === 0) process.stdout.write(`frame ${f}/${N}\n`); }
    fs.closeSync(fd);
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', raw, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-pix_fmt', 'yuv420p', '-an', '-row-mt', '1', path.join(OUT, name + '.webm')]);
    const first = Buffer.alloc(W * H * 3); { const fdr = fs.openSync(raw, 'r'); fs.readSync(fdr, first, 0, first.length, 0); fs.closeSync(fdr); }
    const ff = path.join(tmp, 'first.raw'); fs.writeFileSync(ff, first);
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', ff, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '88', path.join(OUT, name + '-poster.webp')]);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('wrote', path.join(OUT, name + '.webm'), 'and', name + '-poster.webp');
  }
}
