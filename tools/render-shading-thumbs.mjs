// Renders the little hex nuts on the Shading card (assets/shading/<look>.webp).
//
// They used to be ray-marched in the page, at 128 px, with no antialiasing: soft, stair-stepped and
// slow to appear. Now they are baked here once: the nut is ray-marched at 1024 px, shaded with an
// ambient-occlusion term and a small studio (a sky, a horizon, two soft boxes), then averaged down to
// 256 px, so every edge is antialiased and the picture stays sharp on a 3x screen.
//
//   node tools/render-shading-thumbs.mjs            all looks
//   node tools/render-shading-thumbs.mjs steel      one look 
//
// The looks below mirror _CLAY_LOOKS and _CAD_LOOKS in app-v2.js: change one there, change it here, re-run.
// (ffmpeg is needed for the .webp; set FFMPEG if it is not on PATH. Without it the .png files stay.)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'shading');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const SS = 4, FINAL = 256, S = FINAL * SS;                       // the ray-march is S x S, the file FINAL x FINAL

// ---- the looks (mirrors of app-v2.js) ----
const CLAY = {
  default:   { color: 0xc3c6cc, roughness: 0.42, metalness: 0.3 },
  clay:      { color: 0xb7b3ac, roughness: 0.82, metalness: 0 },
  porcelain: { color: 0xf1efea, roughness: 0.2,  metalness: 0 },
  steel:     { color: 0xc2c7cd, roughness: 0.3,  metalness: 1 },
  wax:       { color: 0xb23a2c, roughness: 0.42, metalness: 0, wrap: 0.45 },
};
const CAD = {
  ceramic: { dark: [38, 39, 44],  light: [150, 158, 171], warm: [186, 160, 138], warmAmt: 1.0 },
  light:   { dark: [92, 96, 106], light: [214, 220, 230], warm: [234, 216, 198], warmAmt: 0.8 },
  mono:    { dark: [30, 30, 33],  light: [170, 170, 175], warm: [170, 170, 175], warmAmt: 0 },
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const srgb2lin = (c) => Math.pow(c / 255, 2.2);
const lin2srgb = (c) => Math.round(255 * Math.pow(clamp01(c), 1 / 2.2));

// ---- the part: a hex nut with a double chamfer and a countersunk bore ----
const sdHex = (px, py, r) => {
  const kx = -0.8660254, ky = 0.5, kz = 0.5773503;
  let x = Math.abs(px), y = Math.abs(py);
  const m = 2 * Math.min(kx * x + ky * y, 0); x -= m * kx; y -= m * ky;
  x -= Math.max(-kz * r, Math.min(kz * r, x)); y -= r;
  return Math.hypot(x, y) * (y < 0 ? -1 : 1);
};
const sdf = (x, y, z) => {
  const az = Math.abs(z), rr = Math.hypot(x, y);
  const prism = Math.max(sdHex(x, y, 0.72), az - 0.34);
  const chamfer = (rr + az * 0.9 - 1.0) * 0.7;                                  // a double cone takes the corners off
  const bore = (rr - (0.34 + Math.max(0, az - 0.2) * 0.9)) * 0.74;               // the hole, with a countersink at each face (a cone is steeper than 1, so the step is shortened)
  return Math.max(prism, chamfer, -bore);
};

// ---- the camera: three-quarter view from above, perspective ----
const YAW = -0.62, PITCH = 0.5, CAM_DIST = 2.85, TAN_HALF = Math.tan(19 * Math.PI / 180);
const cy = Math.cos(YAW), sy = Math.sin(YAW), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
const RIGHT = [cy, sy, 0], FWD = [-sy * cp, cy * cp, -sp], UP = [-sy * sp, cy * sp, cp];
const ORIGIN = [-FWD[0] * CAM_DIST, -FWD[1] * CAM_DIST, -FWD[2] * CAM_DIST];
const BOUND = 1.25;                                                              // the nut sits inside this sphere

// ---- pass 1: where the rays hit, the normal (camera space, z toward the viewer), the depth and the occlusion ----
function march() {
  const hit = new Uint8Array(S * S), nv = new Float32Array(S * S * 3), dep = new Float32Array(S * S), ao = new Float32Array(S * S);
  const E = 0.0008;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = ((i + 0.5) / S * 2 - 1) * TAN_HALF, v = (1 - (j + 0.5) / S * 2) * TAN_HALF;
    let dx = FWD[0] + RIGHT[0] * u + UP[0] * v, dy = FWD[1] + RIGHT[1] * u + UP[1] * v, dz = FWD[2] + RIGHT[2] * u + UP[2] * v;
    const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    const [ox, oy, oz] = ORIGIN;
    const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - BOUND * BOUND, disc = b * b - c;
    if (disc < 0) continue;                                                       // the ray misses the bound: it misses the nut
    let t = -b - Math.sqrt(disc), ok = false;
    const tEnd = -b + Math.sqrt(disc);
    for (let s = 0; s < 160 && t < tEnd; s++) {
      const d = sdf(ox + dx * t, oy + dy * t, oz + dz * t);
      if (d < 0.0002) { ok = true; break; }
      t += d * 0.9;
    }
    if (!ok) continue;
    const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
    let nx = sdf(px + E, py, pz) - sdf(px - E, py, pz), ny = sdf(px, py + E, pz) - sdf(px, py - E, pz), nz = sdf(px, py, pz + E) - sdf(px, py, pz - E);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // ambient occlusion: how much of the space just above the surface is taken by the part itself
    let occ = 0, w = 1;
    for (let k = 1; k <= 5; k++) { const h = 0.045 * k; occ += w * (h - sdf(px + nx * h, py + ny * h, pz + nz * h)); w *= 0.62; }
    const k0 = j * S + i;
    hit[k0] = 1; dep[k0] = t; ao[k0] = clamp01(1 - 3.2 * occ);
    nv[k0 * 3] = nx * RIGHT[0] + ny * RIGHT[1] + nz * RIGHT[2];
    nv[k0 * 3 + 1] = nx * UP[0] + ny * UP[1] + nz * UP[2];
    nv[k0 * 3 + 2] = -(nx * FWD[0] + ny * FWD[1] + nz * FWD[2]);
  }
  // where the nut lies in the picture, so it can be centred in the card
  let x0 = S, x1 = 0, y0 = S, y1 = 0;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) if (hit[j * S + i]) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  const sx = Math.round(((S - 1 - x1) - x0) / 2 / SS), sy2 = Math.round(((S - 1 - y1) - y0) / 2 / SS);
  console.log('nut spans ' + ((x1 - x0) / S * 100).toFixed(0) + '% x ' + ((y1 - y0) / S * 100).toFixed(0) + '%, shifted ' + sx + ',' + sy2 + ' px');
  return { hit, nv, dep, ao, shift: [sx, sy2] };
}

// ---- a small studio, in camera space (x right, y up, z toward the viewer): what a shiny part reflects ----
const norm3 = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const KEY = norm3([-0.55, 0.62, 0.62]), RIM = norm3([0.8, 0.25, -0.35]), TOP = norm3([0.05, 1, 0.1]);
function studio(rx, ry, rz, rough) {
  const blur = 0.035 + rough * rough * 0.9;                                       // how wide a highlight spreads
  const blob = (L, k) => Math.exp((Math.max(-1, Math.min(1, rx * L[0] + ry * L[1] + rz * L[2])) - 1) / blur) * k;
  const sky = 0.12 + 0.62 * sstep(-0.35, 0.95, ry);                               // a bright top over a dark floor
  const floor = 0.1 * sstep(0.1, -0.9, ry);
  return sky + floor + blob(KEY, 2.4) + blob(RIM, 1.1) + blob(TOP, 0.9) * 0.6;
}

// ---- pass 2: shade ----
function shadeClay(g, look) {
  const col = [(look.color >> 16) & 255, (look.color >> 8) & 255, look.color & 255].map(srgb2lin);
  const m = look.metalness, rgh = look.roughness, wrap = look.wrap || 0;
  const L = norm3([-0.5, 0.65, 0.58]), F = norm3([0.7, 0.15, 0.4]);                // the key light and a weak fill from the other side
  const H = norm3([L[0], L[1], L[2] + 1]);
  const shin = 12 + (1 - rgh) * (1 - rgh) * 420;
  const out = new Float32Array(S * S * 3);
  for (let k = 0; k < S * S; k++) {
    if (!g.hit[k]) continue;
    const nx = g.nv[k * 3], ny = g.nv[k * 3 + 1], nz = g.nv[k * 3 + 2], ao = g.ao[k];
    const dl = (L0) => (nx * L0[0] + ny * L0[1] + nz * L0[2]);
    const wr = (x) => Math.max(0, (x + wrap) / (1 + wrap));
    const key = wr(dl(L)), fill = wr(dl(F)) * 0.22;
    const hemi = 0.22 + 0.3 * (ny * 0.5 + 0.5);
    const ndh = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]);
    const rx = 2 * nz * nx, ry = 2 * nz * ny, rz = 2 * nz * nz - 1;                 // the view ray bounced off the surface
    const env = studio(rx, ry, rz, rgh);
    const fres = Math.pow(1 - Math.max(0, nz), 5);
    const i = k * 3;
    for (let c = 0; c < 3; c++) {
      const diff = col[c] * (1 - m) * (hemi * ao + 0.95 * key * (0.55 + 0.45 * ao) + fill);
      const refl = m ? col[c] * env * 0.78 * (0.45 + 0.55 * ao) : env * (0.035 + 0.55 * fres) * (1 - rgh * 0.7) * ao;
      const spec = Math.pow(ndh, shin) * (0.08 + 0.45 * (1 - rgh)) * (m ? col[c] * 1.2 : 1) * ao;
      out[i + c] = diff + refl + spec;
    }
  }
  return out;
}
function paintMatcap(look, M = 256) {                                              // _cadPaintMatcap, into an array
  const d = new Uint8Array(M * M * 3), L = [-0.52, 0.46, 0.72], ln = Math.hypot(...L);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    let nx = (x + 0.5) / M * 2 - 1, ny = 1 - (y + 0.5) / M * 2, nz;
    const r2 = nx * nx + ny * ny;
    if (r2 > 1) { const k = 1 / Math.sqrt(r2); nx *= k; ny *= k; nz = 0; } else nz = Math.sqrt(1 - r2);
    const t = sstep(0.02, 0.92, (nx * L[0] + ny * L[1] + nz * L[2]) / ln);
    const w = look.warmAmt * sstep(0.50, 0.90, ny);
    for (let c = 0; c < 3; c++) d[(y * M + x) * 3 + c] = Math.round(mix(mix(look.dark[c], look.light[c], t), look.warm[c], w));
  }
  return d;
}
function shadeCad(g, look) {
  const M = 256, mp = paintMatcap(look, M), out = new Float32Array(S * S * 3);
  const at = (ix, iy, c) => mp[(Math.max(0, Math.min(M - 1, iy)) * M + Math.max(0, Math.min(M - 1, ix))) * 3 + c];
  for (let k = 0; k < S * S; k++) {
    if (!g.hit[k]) continue;
    const nx = g.nv[k * 3], ny = g.nv[k * 3 + 1], nz = g.nv[k * 3 + 2];
    const fx = (nx * 0.5 + 0.5) * M - 0.5, fy = (0.5 - ny * 0.5) * M - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const rim = sstep(0.0, 0.2, Math.abs(nz));                                       // a surface turning edge-on goes dark
    for (let c = 0; c < 3; c++) {
      const v = mix(mix(at(x0, y0, c), at(x0 + 1, y0, c), tx), mix(at(x0, y0 + 1, c), at(x0 + 1, y0 + 1, c), tx), ty);
      out[k * 3 + c] = srgb2lin(Math.min(255, v * rim * 1.06));
    }
  }
  // the dark line where the surface turns sharply or jumps in depth, and round the silhouette; about 1.5 px at card size
  const W = 7, mask = new Uint8Array(S * S);
  const edgeAt = (k, k2) => {
    if (!g.hit[k2]) return true;
    const dot = g.nv[k * 3] * g.nv[k2 * 3] + g.nv[k * 3 + 1] * g.nv[k2 * 3 + 1] + g.nv[k * 3 + 2] * g.nv[k2 * 3 + 2];
    return dot < 0.86 || Math.abs(g.dep[k] - g.dep[k2]) > 0.05;
  };
  for (let j = 1; j < S - 1; j++) for (let i = 1; i < S - 1; i++) {
    const k = j * S + i; if (!g.hit[k]) continue;
    if (edgeAt(k, k + 1) || edgeAt(k, k - 1) || edgeAt(k, k + S) || edgeAt(k, k - S)) mask[k] = 1;
  }
  const dil = new Uint8Array(S * S), r = Math.floor(W / 2);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {                          // (grow the line, but only over the part)
    const k = j * S + i; if (!g.hit[k]) continue;
    let on = 0;
    for (let dj = -r; dj <= r && !on; dj++) for (let di = -r; di <= r; di++) {
      if (di * di + dj * dj > r * r + 1) continue;
      const jj = j + dj, ii = i + di;
      if (jj >= 0 && ii >= 0 && jj < S && ii < S && mask[jj * S + ii]) { on = 1; break; }
    }
    dil[k] = on;
  }
  const ink = [3, 3, 6].map(srgb2lin);
  for (let k = 0; k < S * S; k++) if (dil[k]) for (let c = 0; c < 3; c++) out[k * 3 + c] = out[k * 3 + c] * 0.1 + ink[c] * 0.9;
  return out;
}

// ---- average down, write ----
function downsample(g, lin) {
  const px = Buffer.alloc(FINAL * FINAL * 4);
  for (let j = 0; j < FINAL; j++) for (let i = 0; i < FINAL; i++) {
    let a = 0, r = 0, gg = 0, b = 0;
    const si = i - g.shift[0], sj = j - g.shift[1];                                // (the centring shift, in whole card pixels)
    if (si < 0 || sj < 0 || si >= FINAL || sj >= FINAL) continue;
    for (let dj = 0; dj < SS; dj++) for (let di = 0; di < SS; di++) {
      const k = (sj * SS + dj) * S + (si * SS + di);
      if (!g.hit[k]) continue;
      a++; r += lin[k * 3]; gg += lin[k * 3 + 1]; b += lin[k * 3 + 2];
    }
    const o = (j * FINAL + i) * 4;
    if (!a) continue;
    px[o] = lin2srgb(r / a); px[o + 1] = lin2srgb(gg / a); px[o + 2] = lin2srgb(b / a); px[o + 3] = Math.round(255 * a / (SS * SS));
  }
  return px;
}
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(rgba, w, h) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const only = process.argv[2];
const names = [...Object.keys(CLAY), ...Object.keys(CAD)].filter(n => !only || n === only);
if (!names.length) { console.error('no such look:', only); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const g = march();
console.log('marched ' + S + 'x' + S + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
for (const n of names) {
  const px = downsample(g, CLAY[n] ? shadeClay(g, CLAY[n]) : shadeCad(g, CAD[n]));
  const file = path.join(OUT, n + '.png');
  fs.writeFileSync(file, png(px, FINAL, FINAL));
  
  let kb = fs.statSync(file).size / 1024, ext = 'png';
  try {
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-i', file, '-c:v', 'libwebp', '-quality', '94', '-compression_level', '6', path.join(OUT, n + '.webp')]);
    fs.unlinkSync(file); ext = 'webp'; kb = fs.statSync(path.join(OUT, n + '.webp')).size / 1024;
  } catch (e) { console.warn('  (no webp for ' + n + ': ' + String(e.message).split('\n')[0] + ')'); }
  console.log('  ' + n + '.' + ext + '  ' + kb.toFixed(1) + ' KB');
}
console.log('done in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
