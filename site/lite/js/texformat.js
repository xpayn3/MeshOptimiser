// The format each picture is written in when a scene goes out as glTF / GLB. GLTFExporter draws every texture onto a canvas and encodes
// it again as texture.userData.mimeType says, PNG when nothing does: only GLTFLoader sets it, so the 4K JPEGs that came with an OBJ or
// were loaded into a material slot went out as lossless PNGs, ten times their size (a 2 MB table saved as 116 MB). Now a picture keeps
// the format of the file it came from (.jpg / .jpeg, .png), and one with no file behind it (a canvas, a painted texture, a .webp, data)
// is written as JPEG unless it is the colour map and has transparency. The choice is set for the write only: undo() puts back what was
// there, so a texture painted on later is judged again.

const JPEG = 'image/jpeg', PNG = 'image/png';

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
export function setExportTextureFormats(root, { hasAlpha = imageHasAlpha } = {}) {
  const uses = new Map();                                     // texture -> is it a colour map somewhere
  const add = (t, colour) => { if (t && t.isTexture && t.image) uses.set(t, uses.get(t) || colour); };
  root.traverse((o) => {
    if (!o.material) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      for (const k of Object.keys(m)) add(m[k], k === 'map');
    }
  });
  const colourImage = new Set();
  for (const [t, colour] of uses) if (colour) colourImage.add(t.image);
  const byImage = new Map(), changed = [];
  for (const [t] of uses) {
    const u = t.userData || (t.userData = {});
    if (u.mimeType) continue;                                 // (GLTFLoader's: the format the glTF held it in)
    let mime = byImage.get(t.image);
    if (!mime) {
      const src = t.image && (t.image.currentSrc || t.image.src);
      mime = mimeFromName(u.fileName) || mimeFromName(t.name) || mimeFromName(src)
          || (colourImage.has(t.image) && hasAlpha(t.image) ? PNG : JPEG);
      byImage.set(t.image, mime);
    }
    u.mimeType = mime;
    changed.push(t);
  }
  return () => { for (const t of changed) delete t.userData.mimeType; };
}
