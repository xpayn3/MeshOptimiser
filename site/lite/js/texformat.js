// The format each picture is written in when a scene goes out as glTF / GLB. GLTFExporter draws every texture onto a canvas and encodes
// it again as texture.userData.mimeType says, PNG when nothing does: only GLTFLoader sets it, so the 4K JPEGs that came with an OBJ or
// were loaded into a material slot went out as lossless PNGs, ten times their size (a 2 MB table saved as 116 MB). Now a picture keeps
// the format of the file it came from (.jpg / .jpeg, .png), and one with no file behind it (a canvas, a painted texture, a .webp, data)
// is written as JPEG unless it is the colour map and has transparency. The choice is set for the write only: undo() puts back what was
// there, so a texture painted on later is judged again.

const JPEG = 'image/jpeg', PNG = 'image/png';
const COLOUR_KEYS = new Set(['map', 'emissiveMap', 'sheenColorMap', 'specularColorMap']);      // the material slots that hold colours; the others hold numbers

// The format a file name or URL says, or '' when it says none (blob: URLs carry no extension; the name is asked first).
export function mimeFromName(s) {
  const m = /\.(jpe?g|png)(?:[?#].*)?$/i.exec(String(s || '').trim());
  return !m ? '' : (m[1].toLowerCase() === 'png' ? PNG : JPEG);
}

// Whether any pixel of a picture is not fully opaque. Raw data (a DataTexture) is read whole; a picture is drawn at most 1024 px wide
// (a transparent pixel drawn smaller still pulls its neighbourhood under 255). Anything unreadable counts as transparent, to stay lossless.
export function imageHasAlpha(img) {
  if (!img) return false;
  try {
    if (img.data && img.width && img.height) {
      const d = img.data, n = img.width * img.height;
      if (d.length < n * 4) return false;                     // (RGB or one channel: no alpha to keep)
      if (!(d instanceof Uint8Array || d instanceof Uint8ClampedArray)) return true;      // (half or float data: left lossless)
      for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
      return false;
    }
    const w = img.naturalWidth || img.videoWidth || img.width, h = img.naturalHeight || img.videoHeight || img.height;
    if (!w || !h) return false;
    const k = Math.min(1, 1024 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, cw, ch);
    const d = x.getImageData(0, 0, cw, ch).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
    return false;
  } catch (_) { return true; }
}

// Sets userData.mimeType on every texture of the meshes under root that has none, and returns undo(). A picture used by several
// textures is judged once, and as the colour map ("map") if it is one anywhere, so it is written once. hasAlpha is for tests.
// force ('image/webp', say) is written even where a picture already says its format; undo() puts the old one back.
export function setExportTextureFormats(root, { hasAlpha = imageHasAlpha, force = '' } = {}) {
  const uses = new Map();                                     // texture -> is it a colour map somewhere
  const dataUse = new Set();                                  // textures that carry numbers somewhere (normals, roughness, occlusion, ...): never lossy
  const add = (t, colour, key) => { if (t && t.isTexture && t.image) { uses.set(t, uses.get(t) || colour); if (!COLOUR_KEYS.has(key)) dataUse.add(t); } };
  root.traverse((o) => {
    if (!o.material) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      for (const k of Object.keys(m)) add(m[k], k === 'map', k);
    }
  });
  const colourImage = new Set();
  for (const [t, colour] of uses) if (colour) colourImage.add(t.image);
  const byImage = new Map(), changed = [];
  for (const [t] of uses) {
    const u = t.userData || (t.userData = {});
    if (force && !dataUse.has(t)) { changed.push([t, u.mimeType]); u.mimeType = force; continue; }      // (a forced format is for the colour pictures only)
    if (force && u.mimeType) continue;
    if (u.mimeType) continue;                                 // (GLTFLoader's: the format the glTF held it in)
    let mime = byImage.get(t.image);
    if (!mime) {
      const src = t.image && (t.image.currentSrc || t.image.src);
      mime = mimeFromName(u.fileName) || mimeFromName(t.name) || mimeFromName(src)
          || (colourImage.has(t.image) && hasAlpha(t.image) ? PNG : JPEG);
      byImage.set(t.image, mime);
    }
    u.mimeType = mime;
    changed.push([t, undefined]);
  }
  return () => { for (const [t, was] of changed) { if (was === undefined) delete t.userData.mimeType; else t.userData.mimeType = was; } };
}

// Draws every picture longer than max px on its long side at the size that keeps its proportions (GLTFExporter's own maxTextureSize
// cuts each side to max, which squashes a 4096 x 2048 map into a square), by swapping texture.image for the smaller canvas while the
// file is written. A picture used by several textures is drawn once. Raw data (DataTexture), compressed textures and pictures that
// are not larger are left as they are. Returns undo(), which puts the first pictures back; stats.shrunk counts the pictures drawn.
// makeCanvas(w, h) is for tests.
export function shrinkExportTextures(root, max, { makeCanvas = null, stats = null } = {}) {
  const undo = [];
  if (!(max >= 1)) return () => {};
  const mk = makeCanvas || ((w, h) => typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
  const small = new Map(), seen = new Set();
  root.traverse((o) => {
    if (!o.material) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      for (const k of Object.keys(m)) {
        const t = m[k];
        if (!t || !t.isTexture || !t.image || seen.has(t)) continue;
        seen.add(t);
        const im = t.image, w = im.naturalWidth || im.videoWidth || im.width, h = im.naturalHeight || im.videoHeight || im.height;
        if (im.data || t.isCompressedTexture || !w || !h || Math.max(w, h) <= max) continue;
        let c = small.get(im);
        if (c === undefined) {
          const f = max / Math.max(w, h), cw = Math.max(1, Math.round(w * f)), ch = Math.max(1, Math.round(h * f));
          try {
            c = mk(cw, ch);
            const x = c.getContext('2d');
            x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
            x.drawImage(im, 0, 0, cw, ch);
          } catch (_) { c = null; }
          small.set(im, c);
          if (c && stats) stats.shrunk = (stats.shrunk || 0) + 1;
        }
        if (c) { undo.push([t, im]); t.image = c; }
      }
    }
  });
  // (the pictures are the viewer's own textures: one that was uploaded to the graphics card while it held the small copy would keep it, so each is uploaded again from its own picture)
  return () => { for (const [t, im] of undo) { t.image = im; t.needsUpdate = true; } };
}
