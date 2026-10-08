// Renders the clip at the top of the Split card (assets/help/split.webm and split-poster.webp).
//
// No GPU and no browser: the model is built here from three.js geometry (a CAD-style bracket with
// filleted edges, holes and gussets, a chamfered pin with grooves and a retaining ring, hex bolts
// with threads and washers), drawn by a small software rasteriser (z-buffer, smooth shading, crease
// lines), and the frames go straight into ffmpeg.
//
//   node tools/render-split-clip.mjs                  renders the clip and the poster
//   node tools/render-split-clip.mjs --still=0.4      one frame at t = 0.4 as tools/still.png (to look at)
//
// ffmpeg must be on the PATH, or named in FFMPEG.
import * as T from '../vendor/three/build/three.core.js';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'assets', 'help');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const W = 592, H = 370, SS = 2, FPS = 25, SECONDS = 6, N = FPS * SECONDS;
const RW = W * SS, RH = H * SS;
const BG = [22, 22, 22];                       // the card's surface (--surface-pop, #161616)
const GREY = [190, 193, 200], ORANGE = [228, 158, 106];

// ── model ────────────────────────────────────────────────────────────────────────────────────────
// Millimetres, z up. The base plate lies on x 0..100, y 0..60, z 0..10; the upright stands at its
// back edge (x 0..8); the pin runs along x through the upright; the bolts go down through the plate.
const BEV = { bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.7, bevelOffset: 0, bevelSegments: 3, curveSegments: 32 };
const rrect = (x, y, w, h, r) => {
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
const hole = (shape, x, y, r) => { const p = new T.Path(); p.absarc(x, y, r, 0, Math.PI * 2, true); shape.holes.push(p); };
const slot = (shape, x0, x1, y, r) => { const p = new T.Path(); p.moveTo(x0, y - r); p.lineTo(x1, y - r); p.absarc(x1, y, r, -Math.PI / 2, Math.PI / 2, false); p.lineTo(x0, y + r); p.absarc(x0, y, r, Math.PI / 2, Math.PI * 1.5, false); shape.holes.push(p); };
const ext = (shape, depth, opts = BEV) => new T.ExtrudeGeometry(shape, { depth, ...opts });
const mat = (rows) => { const m = new T.Matrix4(); m.set(rows[0][0], rows[0][1], rows[0][2], rows[0][3] || 0, rows[1][0], rows[1][1], rows[1][2], rows[1][3] || 0, rows[2][0], rows[2][1], rows[2][2], rows[2][3] || 0, 0, 0, 0, 1); return m; };
// a shape drawn in (u, v) and extruded: onto the XY plane, or standing in the YZ plane (extruded along x), or in the XZ plane (along y)
const inYZ = (g, x0) => g.applyMatrix4(mat([[0, 0, 1, x0], [1, 0, 0], [0, 1, 0]]));            // (u,v,w) -> (x = x0 + w, y = u, z = v)
const inXZ = (g, y0) => g.applyMatrix4(mat([[1, 0, 0], [0, 0, 1, y0], [0, 1, 0]]));            // (u,v,w) -> (x = u, y = y0 + w, z = v)   (a mirror: the renderer lights both sides)
const lathe = (pts, seg = 56) => new T.LatheGeometry(pts.map(([r, a]) => new T.Vector2(r, a)), seg);   // axis: local y
const alongX = (g, x0, y, z) => g.applyMatrix4(mat([[0, 1, 0, x0], [-1, 0, 0, y], [0, 0, 1, z]]));    // local y -> x
const alongZ = (g, x, y, z0) => g.applyMatrix4(mat([[1, 0, 0, x], [0, 0, -1, y], [0, 1, 0, z0]]));    // local y -> z
const merge = (list) => {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  const total = parts.reduce((s, g) => s + g.attributes.position.array.length, 0);
  const pos = new Float32Array(total); let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const out = new T.BufferGeometry(); out.setAttribute('position', new T.BufferAttribute(pos, 3)); return out;
};

function buildBracket() {
  const g = [];
  // base plate: rounded corners, two bolt holes, two empty mounting holes, a slot
  const base = rrect(0, 0, 100, 60, [0, 7, 7, 0]);
  hole(base, 62, 16, 5.3); hole(base, 62, 44, 5.3); hole(base, 88, 14, 4.4); hole(base, 88, 46, 4.4); slot(base, 22, 40, 30, 3.6);
  g.push(ext(base, 10 - 1.4).translate(0, 0, 0.7));
  // upright plate: rounded top corners, the pin's bore, two lightening holes
  const up = rrect(0, 0, 60, 56, [0, 0, 7, 7]);
  hole(up, 30, 36, 9.5); hole(up, 9, 46, 3.6); hole(up, 51, 46, 3.6);
  g.push(inYZ(ext(up, 8 - 1.4).translate(0, 0, 0.7), 0));
  // the inner corner: a quarter-round fillet along the whole width
  const fil = new T.Shape(); fil.moveTo(8, 10); fil.lineTo(19, 10); fil.absarc(19, 21, 11, -Math.PI / 2, -Math.PI, true); fil.lineTo(8, 10);
  g.push(inXZ(ext(fil, 60, { depth: 60, bevelEnabled: false, curveSegments: 20 }), 0));
  // two gussets: a triangle with a cut tip and a small bore
  for (const y0 of [9, 43]) {
    const s = new T.Shape(); s.moveTo(8, 10); s.lineTo(44, 10); s.lineTo(44, 14); s.lineTo(12, 42); s.lineTo(8, 42); s.lineTo(8, 10);
    hole(s, 20, 20, 2.6);
    g.push(inXZ(ext(s, 8 - 1, { ...BEV, bevelThickness: 0.5, bevelSize: 0.5 }).translate(0, 0, 0.5), y0));
  }
  return merge(g);
}
function buildPin() {                        // Ø16, along x from -9 to 46 (the upright's face is at x = 8)
  const R = 8;
  const pts = [[0, -9], [R - 1.4, -9], [R, -7.6], [R, -4.6], [R - 1.2, -4.6], [R - 1.2, -2.6], [R, -2.6], [R, 14], [R - 0.7, 14.4], [R - 0.7, 20], [R, 20.4], [R, 30], [R - 1.2, 30], [R - 1.2, 33], [R, 33], [R, 44.6], [R - 1.5, 46], [3.4, 46], [3.4, 44.4], [0, 43.4]];
  return alongX(lathe(pts, 64), 0, 30, 36);
}
function buildRing() {                       // a C-shaped retaining ring in the pin's back groove
  const s = new T.Shape(); const a0 = 0.45, a1 = Math.PI * 2 - 0.45, ro = 10.3, ri = 6.7;
  s.absarc(0, 0, ro, a0, a1, false); s.lineTo(ri * Math.cos(a1), ri * Math.sin(a1)); s.absarc(0, 0, ri, a1, a0, true); s.closePath();
  return inYZ(ext(s, 1.4, { depth: 1.4, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.2, bevelSegments: 2, curveSegments: 40 }), -4.6).translate(0, 30, 36);
}
function buildWasher(x, y) {
  const s = new T.Shape(); s.absarc(0, 0, 8.8, 0, Math.PI * 2, false); hole(s, 0, 0, 5.0);
  return ext(s, 1.6 - 0.5, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 2, curveSegments: 48 }).translate(x, y, 10 + 0.25);
}
function buildBolts() {                       // M8: a hex head with a chamfered top and a washer face, a threaded shank; the head sits on a washer at z = 11.6
  const out = [];
  for (const [x, y] of [[62, 16], [62, 44]]) {
    const head = new T.CylinderGeometry(7.5, 7.5, 5.4, 6, 1);
    const hexG = alongZ(head.translate(0, 2.7, 0), x, y, 11.6);
    const rest = [];
    rest.push(alongZ(lathe([[0, 5.4], [5.0, 5.4], [6.7, 4.5], [7.3, 3.4], [0, 3.4]], 48), x, y, 11.6));
    rest.push(alongZ(lathe([[0, 0.1], [6.1, 0.1], [6.1, -0.4], [0, -0.4]], 48), x, y, 11.6));
    const th = [[0, -0.4], [4.0, -0.4]]; let a = -0.4;
    for (let i = 0; i < 7; i++) { th.push([3.3, a - 0.95], [4.0, a - 1.8]); a -= 2.0; }
    th.push([4.0, -15.6], [3.1, -16.8], [0, -16.8]);
    rest.push(alongZ(lathe(th, 44), x, y, 11.6));
    out.push(merge([hexG, ...rest]));
  }
  return out;
}

// ── mesh preparation: smooth shading that keeps the creases, and the crease lines ─────────────────
function prepare(geom, creaseDeg = 38) {
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
  const nor = new Float32Array(nT * 9), edgeMap = new Map();
  for (let t = 0; t < nT; t++) {
    if (!keep[t]) continue;
    for (let c = 0; c < 3; c++) {
      let sx = 0, sy = 0, sz = 0;
      for (const u of byKey.get(keys[t * 3 + c])) { const d = fn[t * 3] * fn[u * 3] + fn[t * 3 + 1] * fn[u * 3 + 1] + fn[t * 3 + 2] * fn[u * 3 + 2]; if (d >= cosC) { sx += fn[u * 3]; sy += fn[u * 3 + 1]; sz += fn[u * 3 + 2]; } }
      const l = Math.hypot(sx, sy, sz) || 1; nor[t * 9 + c * 3] = sx / l; nor[t * 9 + c * 3 + 1] = sy / l; nor[t * 9 + c * 3 + 2] = sz / l;
      const k0 = keys[t * 3 + c], k1 = keys[t * 3 + (c + 1) % 3], ek = k0 < k1 ? k0 + '|' + k1 : k1 + '|' + k0;
      const e = edgeMap.get(ek); const i0 = t * 9 + c * 3, i1 = t * 9 + ((c + 1) % 3) * 3;
      if (!e) edgeMap.set(ek, { t, i0, i1, n: 1, crease: false });
      else { e.n++; const d = fn[t * 3] * fn[e.t * 3] + fn[t * 3 + 1] * fn[e.t * 3 + 1] + fn[t * 3 + 2] * fn[e.t * 3 + 2]; if (d < cosC) e.crease = true; }
    }
  }
  const lines = [];
  for (const e of edgeMap.values()) if (e.crease || e.n === 1) lines.push(p[e.i0], p[e.i0 + 1], p[e.i0 + 2], p[e.i1], p[e.i1 + 1], p[e.i1 + 2]);
  return { pos: p, nor, nT, keep, lines: new Float32Array(lines) };
}

// ── the scene ──────────────────────────────────────────────────────────────────────────────────────
const PARTS = [
  { name: 'bracket', mesh: prepare(buildBracket(), 36), off: (e) => [-22 * e, 0, -6 * e] },
  { name: 'pin',     mesh: prepare(buildPin(), 40),     off: (e) => [52 * e, 0, -4 * e] },
  { name: 'ring',    mesh: prepare(buildRing(), 40),    off: (e) => [-56 * e, 0, 0] },
  ...buildBolts().map((b, i) => ({ name: 'bolt' + i, mesh: prepare(b, 40), off: (e) => [0, 14 * e * (i ? 1 : -1) * 0 + 0, 50 * e] })),
  ...[[62, 16], [62, 44]].map(([x, y], i) => ({ name: 'washer' + i, mesh: prepare(buildWasher(x, y), 40), off: (e) => [0, 0, 26 * e] })),
];
const CENTER = new T.Vector3(50, 30, 22);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function timeline(t) {                        // t in 0..1, a loop that ends where it began
  const e = smooth(0.30, 0.52, t) * (1 - smooth(0.70, 0.92, t));
  const m = smooth(0.16, 0.28, t) * (1 - smooth(0.60, 0.72, t));
  return { e, m };
}

// ── software rasteriser ────────────────────────────────────────────────────────────────────────────
const color = new Uint8ClampedArray(RW * RH * 3), depth = new Float32Array(RW * RH), ids = new Int16Array(RW * RH);
function render(t) {
  const { e, m } = timeline(t);
  const az = 0.40 + 0.06 * Math.sin(t * Math.PI * 2), el = 0.46, dist = 345;
  const cam = new T.PerspectiveCamera(22, W / H, 10, 2000);
  cam.up.set(0, 0, 1);
  cam.position.set(CENTER.x + dist * Math.cos(el) * Math.sin(az) * 1.0 + 0, CENTER.y - dist * Math.cos(el) * Math.cos(az), CENTER.z + dist * Math.sin(el));
  const tgt = CENTER.clone().add(new T.Vector3(2 * e, 0, 6 * e));
  cam.lookAt(tgt); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const view = cam.matrixWorldInverse, VP = new T.Matrix4().multiplyMatrices(cam.projectionMatrix, view);
  const vp = VP.elements, vw = view.elements;
  // lights in the camera's frame: x right, y up, z toward the viewer
  const KEY = norm([-0.45, 0.62, 0.64]), FILL = norm([0.78, 0.12, 0.42]);
  const HV = norm([KEY[0], KEY[1], KEY[2] + 1]);
  // background and a soft shadow on the floor under the parts
  for (let i = 0; i < RW * RH; i++) { color[i * 3] = BG[0]; color[i * 3 + 1] = BG[1]; color[i * 3 + 2] = BG[2]; depth[i] = 0; ids[i] = -1; }
  const proj = (x, y, z) => { const cx = vp[0]*x + vp[4]*y + vp[8]*z + vp[12], cy = vp[1]*x + vp[5]*y + vp[9]*z + vp[13], cw = vp[3]*x + vp[7]*y + vp[11]*z + vp[15]; return [(cx / cw * 0.5 + 0.5) * RW, (1 - (cy / cw * 0.5 + 0.5)) * RH, 1 / cw]; };
  { const c = proj(54 + 14 * e, 30, -6), r = proj(54 + 14 * e + 78 + 26 * e, 30, -6), s = proj(54 + 14 * e, 30 + 40 + 6 * e, -6);
    const rx = Math.abs(r[0] - c[0]), ry = Math.max(14, Math.abs(s[1] - c[1])) * 1.1;
    for (let y = Math.max(0, Math.floor(c[1] - ry)); y < Math.min(RH, Math.ceil(c[1] + ry)); y++) for (let x = Math.max(0, Math.floor(c[0] - rx)); x < Math.min(RW, Math.ceil(c[0] + rx)); x++) {
      const d = Math.hypot((x - c[0]) / rx, (y - c[1]) / ry); if (d >= 1) continue; const f = 1 - 0.62 * Math.pow(1 - d, 1.7), i = (y * RW + x) * 3;
      color[i] = BG[0] * f; color[i + 1] = BG[1] * f; color[i + 2] = BG[2] * f; } }
  const base = [GREY[0] + (ORANGE[0] - GREY[0]) * m, GREY[1] + (ORANGE[1] - GREY[1]) * m, GREY[2] + (ORANGE[2] - GREY[2]) * m];
  PARTS.forEach((part, pid) => {
    const o = part.off(e), { pos, nor, nT, keep } = part.mesh;
    const sx = new Float32Array(nT * 3), sy = new Float32Array(nT * 3), sz = new Float32Array(nT * 3);
    for (let v = 0; v < nT * 3; v++) { const s = proj(pos[v * 3] + o[0], pos[v * 3 + 1] + o[1], pos[v * 3 + 2] + o[2]); sx[v] = s[0]; sy[v] = s[1]; sz[v] = s[2]; }
    for (let tI = 0; tI < nT; tI++) {
      if (!keep[tI]) continue;
      const a = tI * 3, x0 = sx[a], y0 = sy[a], x1 = sx[a + 1], y1 = sy[a + 1], x2 = sx[a + 2], y2 = sy[a + 2];
      const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0); if (Math.abs(area) < 1e-6) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(RW - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(RH - 1, Math.ceil(Math.max(y0, y1, y2)));
      // the three corners' normals in the camera's frame
      const nv = []; for (let c = 0; c < 3; c++) { const nx = nor[tI * 9 + c * 3], ny = nor[tI * 9 + c * 3 + 1], nz = nor[tI * 9 + c * 3 + 2]; nv.push([vw[0]*nx + vw[4]*ny + vw[8]*nz, vw[1]*nx + vw[5]*ny + vw[9]*nz, vw[2]*nx + vw[6]*ny + vw[10]*nz]); }
      const inv = 1 / area;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l0 = ((x1 - px) * (y2 - py) - (y1 - py) * (x2 - px)) * inv, l1 = ((x2 - px) * (y0 - py) - (y2 - py) * (x0 - px)) * inv, l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        const z = l0 * sz[a] + l1 * sz[a + 1] + l2 * sz[a + 2], idx = y * RW + x;
        if (z <= depth[idx]) continue;
        depth[idx] = z; ids[idx] = pid;
        let nx = l0 * nv[0][0] + l1 * nv[1][0] + l2 * nv[2][0], ny = l0 * nv[0][1] + l1 * nv[1][1] + l2 * nv[2][1], nz = l0 * nv[0][2] + l1 * nv[1][2] + l2 * nv[2][2];
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }               // a face seen from behind is lit as if from the front
        const kd = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]), fd = Math.max(0, nx * FILL[0] + ny * FILL[1] + nz * FILL[2]);
        const sp = Math.pow(Math.max(0, nx * HV[0] + ny * HV[1] + nz * HV[2]), 36) * 0.22;
        const lit = 0.36 + 0.10 * ny + 0.64 * kd + 0.22 * fd;
        const c = idx * 3;
        color[c] = base[0] * lit + 255 * sp; color[c + 1] = base[1] * lit + 255 * sp; color[c + 2] = base[2] * lit + 255 * sp;
      }
    }
  });
  // crease lines, hidden where something is in front
  PARTS.forEach((part, pid) => {
    const o = part.off(e), L = part.mesh.lines;
    for (let i = 0; i < L.length; i += 6) {
      const A = proj(L[i] + o[0], L[i + 1] + o[1], L[i + 2] + o[2]), B = proj(L[i + 3] + o[0], L[i + 4] + o[1], L[i + 5] + o[2]);
      const steps = Math.ceil(Math.max(Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1]))) || 1;
      for (let s = 0; s <= steps; s++) {
        const f = s / steps, x = Math.round(A[0] + (B[0] - A[0]) * f), y = Math.round(A[1] + (B[1] - A[1]) * f), z = A[2] + (B[2] - A[2]) * f;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const xx = x + dx - 0, yy = y + dy - 0; if (xx < 0 || yy < 0 || xx >= RW || yy >= RH) continue;
          const idx = yy * RW + xx; if (z < depth[idx] * 0.996) continue;
          const c = idx * 3; color[c] *= 0.52; color[c + 1] *= 0.52; color[c + 2] *= 0.52;
        }
      }
    }
  });
  // outlines where one part ends in front of another (or of the floor): the nearer side darkens
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
function norm(v) { const l = Math.hypot(...v); return v.map(c => c / l); }

// ── go ─────────────────────────────────────────────────────────────────────────────────────────────
const still = process.argv.find(a => a.startsWith('--still='));
const tmp = path.join(HERE, '.render-tmp'); fs.mkdirSync(tmp, { recursive: true });
const toPng = (raw, file) => { const rf = path.join(tmp, 'f.raw'); fs.writeFileSync(rf, raw); execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', rf, '-frames:v', '1', file]); };
if (still) {
  const t = parseFloat(still.split('=')[1]); toPng(render(t), path.join(HERE, 'still.png')); console.log('still at t =', t);
} else {
  const raw = path.join(tmp, 'clip.raw'); const fd = fs.openSync(raw, 'w');
  for (let f = 0; f < N; f++) { fs.writeSync(fd, render(f / N)); if (f % 25 === 0) process.stdout.write(`frame ${f}/${N}\n`); }
  fs.closeSync(fd);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', raw, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-pix_fmt', 'yuv420p', '-an', '-row-mt', '1', path.join(OUT, 'split.webm')]);
  const first = Buffer.alloc(W * H * 3); { const fdr = fs.openSync(raw, 'r'); fs.readSync(fdr, first, 0, first.length, 0); fs.closeSync(fdr); }
  const ff = path.join(tmp, 'first.raw'); fs.writeFileSync(ff, first);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', ff, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '88', path.join(OUT, 'split-poster.webp')]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', path.join(OUT, 'split.webm'), 'and split-poster.webp');
}
