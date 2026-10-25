// The UV layout as a view of its own, as in a modelling program: the viewport stays on the left and the layout takes the right, the left
// sidebar folded away to give it room (and put back when it is closed). The pane shows the texture coordinates of every selected part on
// the 0–1 square (every triangle edge, the rim of each island, the picture the part wears behind them, where islands lie on each other)
// and they can be edited there, with a toolbar at the foot of the pane:
//
//   Tools      Select (click, or drag a box; Shift adds, Ctrl takes away), Move, Rotate, Scale: dragged anywhere in the view, about the middle
//              of what is selected. A click with a transform tool picks, as Select does.
//   Pick       Points, Edges, Faces (a triangle) or Islands (what is joined along edges that agree in place and UV). Every pick is a set of
//              UV points; a point that is two points of the mesh (a vertex split for its normal) moves as one. All, None, Invert, Grow, Shrink.
//   Numbers    U and V (the middle of the selection), W and H (its size, linked or not), a turn by degrees, flips, quarter turns.
//   Align      the selection to the left, middle, right, top, centre and bottom of the 0–1 square.
//   Layout     Pack (the selected islands, or all, into the square with one scale), Fit (the selection into the square), Density (every
//              selected island to the same texels per unit of surface), Unwrap (cut and flatten the parts again: it rebuilds their vertices,
//              as Bake textures does), Project (planar X, Y, Z, cylinder, sphere, from the positions of the points), Snap (to a grid).
//
// Wheel zooms at the pointer, a middle or right drag (or Alt + drag) pans, a double-click or F fits. Every change is one undo step.
// V is held from the top, as the pictures are (glTF's way), so a picture is drawn upright and the origin is the top-left corner.
import * as THREE from 'three';
import { analyseUV, hasUsableUV, weldCorners } from './uvtools.js?v=2';
import { unwrapParts, packIslands } from './bake.js?v=2';
import { layoutGeometry } from './uv-geom.js?v=1';

export function installUvSplit(app) {
  const { state, getPart, fmtNum, toast, getCamera, ctxMenu, _Prefs, _matOf, _matHolder, _leftSidebarShow, onResize, pushUndo, requestRender, _decSnap, _stampGeometry, _refreshPartBBox, _cadEdgesPartSwapped, settle } = app;
  const $i = (id) => document.getElementById(id);
  const pane = $i('uv-pane'), cv = $i('uv-canvas');
  if (!pane || !cv) return null;
  const MAX_TRIS = 600000, MAX_LINES = 250000, MAX_PARTS = 400, MAX_DOTS = 40000;
  // (the viewport's Edit mesh colours: picked points, edges and polygons orange, the mesh blue, what is under the pointer white)
  const ORANGE = '#ff9a2e', ORANGE_LINE = '#ffb45c', LINE_BLUE = 'rgba(58,160,232,.72)', HOT = '#ffffff', HOT_RING = '#05080d';
  const cache = new Map();                              // signature → analysis
  const view = { cx: 0.5, cy: 0.5, s: 1 };              // the centre (in UV) and the pixels per UV unit
  let hover = null, hoverRaf = 0, hoverAt = null, userView = false, on = false, leftWas = true, raf = 0, token = 0, lastSig = '', data = null, fitted = false, ro = null, timer = 0, anim = false, animTimer = 0, keyIds = '';
  let sel = new Uint8Array(0);                          // per UV point (a vertex of the buffers): 1 when it is selected
  const opt = {
    bg: _Prefs.get('uvsplit.bg') || 'map', lines: _Prefs.get('uvsplit.lines') !== false, overlap: _Prefs.get('uvsplit.overlap') !== false, checker: !!_Prefs.get('uvsplit.checker'),
    tool: _Prefs.get('uvsplit.tool') || 'select', mode: _Prefs.get('uvsplit.mode') || 'face', snap: !!_Prefs.get('uvsplit.snap'), grid: _Prefs.get('uvsplit.grid') || 16,
    lock: _Prefs.get('uvsplit.lock') !== false, stretch: !!_Prefs.get('uvsplit.stretch'), packRot: !!_Prefs.get('uvsplit.packrot'), angle: _Prefs.get('uvsplit.angle') || 60, proj: _Prefs.get('uvsplit.proj') || 'z',
  };
  const geomOf = (p) => (p.mesh && p.mesh.geometry) || (p.instancedMesh && p.instancedMesh.geometry) || (state.geomByHash && state.geomByHash.get(p.hash)) || null;
  const livePart = (id) => { const p = getPart(id); return p && !p.deleted && !p.isSpline && geomOf(p) ? p : null; };
  const flat = (a, size) => {
    if (!a.isInterleavedBufferAttribute && a.array instanceof Float32Array && a.itemSize === size) return a.array;
    const out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) { out[i * size] = a.getX(i); out[i * size + 1] = a.getY(i); if (size > 2) out[i * size + 2] = a.getZ(i); }
    return out;
  };
  const editable = (g) => { const a = g.attributes.uv; return !!a && !a.isInterleavedBufferAttribute && a.array instanceof Float32Array && a.itemSize === 2; };
  const pct = (v) => { const x = v * 100; return (x >= 10 || x === 0 ? Math.round(x) : x.toFixed(1)) + ' %'; };
  const sigOf = (ids) => ids.map((id) => {
    const p = livePart(id), g = p && geomOf(p), uv = g && g.attributes.uv, pos = g && g.attributes.position;
    return [id, g ? g.uuid : '-', uv ? uv.version : -1, pos ? pos.count : -1, g && g.index ? g.index.count : -1].join(':');
  }).join('|');
  const sizeNow = () => ({ W: cv.clientWidth, H: cv.clientHeight });

  // ── what is shown ──
  function say(text) {
    data = null; sel = new Uint8Array(0); keyIds = '';
    const e = $i('uv-empty'); e.textContent = ''; { const [head, ...rest] = String(text || '').split('\n'); const a = document.createElement('span'); a.textContent = head; e.appendChild(a); if (rest.length) { const b = document.createElement('span'); b.className = 'uv-empty-sub'; b.textContent = rest.join(' '); e.appendChild(b); } } e.hidden = !text;
    $i('uv-which').textContent = ''; $i('uv-stats').textContent = '';
    syncTools(); draw();
  }
  function stats(r) {
    const bits = [
      [fmtNum(r.islands) + (r.islands === 1 ? ' island' : ' islands'), false], [pct(r.used) + ' of the square used', false],
      [r.overlap > 0.005 ? pct(r.overlap) + ' on another island' : 'no overlap', r.overlap > 0.005],
      [r.outside ? fmtNum(r.outside) + ' outside the square' : '', r.outside > 0], [r.collapsed ? fmtNum(r.collapsed) + ' collapsed' : '', r.collapsed > 0],
      [r.flipped ? fmtNum(r.flipped) + ' mirrored' : '', false], [r.density.uneven > 0.1 ? 'density ' + pct(r.density.uneven) + ' uneven' : 'density even', r.density.uneven > 0.1],
    ].filter(b => b[0]);
    const el = $i('uv-stats'); el.textContent = '';
    for (const [t, warn] of bits) { const s = document.createElement('span'); s.textContent = t; if (warn) s.className = 'warn'; el.append(s); }
  }
  const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh(true, true), data && data.tris > 150000 ? 2500 : 700); };
  async function refresh(keep, own) {
    if (!on) return;
    const my = ++token;
    const ids = [...(state.selected || [])].filter(livePart).slice(0, MAX_PARTS);
    lastSig = sigOf([...(state.selected || [])]);
    if (!ids.length) { say('Select a part to see how its texture is laid out.'); return; }
    // every selected part with usable UVs (a geometry that two parts share once), side by side in one list of arrays
    const parts = [], noUv = [], seen = new Set();
    let tris = 0, verts = 0, shared = 0;
    for (const id of ids) {
      const p = livePart(id), g = geomOf(p), pos = g.attributes.position, uvA = g.attributes.uv;
      if (!uvA || uvA.count !== pos.count || !hasUsableUV(uvA.isInterleavedBufferAttribute ? flat(uvA, 2) : uvA.array, pos.count)) { noUv.push(p.name || 'part'); continue; }
      if (seen.has(g)) { shared++; continue; }
      seen.add(g);
      const t = g.index ? Math.floor(g.index.count / 3) : Math.floor(pos.count / 3);
      parts.push({ p, g, t, vo: verts, vc: pos.count, io: tris * 3 }); tris += t; verts += pos.count;
    }
    if (!parts.length) { say((ids.length === 1 ? (livePart(ids[0]).name || 'This part') + ' has no' : 'None of the selected parts has any') + ' texture coordinates.\nImport with “Keep texture coordinates” on, add them in a modelling tool, bake the part (Bake textures), or press Unwrap.'); showUnwrapOnly(ids); return; }
    if (tris > MAX_TRIS) { say('The selection has ' + fmtNum(tris) + ' triangles: too many to draw here. Select fewer parts, or reduce them first.'); return; }
    const sig = sigOf(ids);
    let r = cache.get(sig);
    const P = new Float32Array(verts * 3), UV = new Float32Array(verts * 2), I = new Uint32Array(tris * 3), v3 = [0, 0, 0];
    for (const pt of parts) {
      const { g, t, vo, io } = pt, pos = flat(g.attributes.position, 3), uv = flat(g.attributes.uv, 2), n = g.attributes.position.count;
      let sc = 1; try { if (pt.p.mesh) { pt.p.mesh.updateWorldMatrix(true, false); const w = pt.p.mesh.getWorldScale(new pt.p.mesh.scale.constructor()); sc = Math.cbrt(Math.abs(w.x * w.y * w.z)) || 1; } } catch (_) {}
      pt.scale = sc;
      for (let i = 0; i < n * 3; i++) P[vo * 3 + i] = pos[i] * sc;     // (in the scene's units, so the density of one part can be set against another's)
      UV.set(uv, vo * 2);
      if (g.index) for (let i = 0; i < t * 3; i++) I[io + i] = g.index.array[i] + vo; else for (let i = 0; i < t * 3; i++) I[io + i] = vo + i;
    }
    if (!r) {
      $i('uv-empty').textContent = 'Reading ' + fmtNum(tris) + ' triangles…'; $i('uv-empty').hidden = false;
      if (tris > 100000) await new Promise((res) => setTimeout(res, 30));
      if (my !== token) return;
      try { r = analyseUV(P, UV, I); } catch (e) { console.warn('[uv] analysis failed:', e); say('The UV check failed.'); return; }
      cache.set(sig, r); if (cache.size > 6) cache.delete(cache.keys().next().value);
    }
    if (my !== token) return;
    // (a point of one part is never the twin of a point of another, however alike they are: the copies of a bolt each keep their own;
    // so the twins are looked for in each part by itself, and their numbers go on from the part before)
    const wid = new Int32Array(verts); let wcount = 0;
    for (const pt of parts) { const w = weldCorners(P.subarray(pt.vo * 3, (pt.vo + pt.vc) * 3), UV.subarray(pt.vo * 2, (pt.vo + pt.vc) * 2), pt.vc); for (let i = 0; i < pt.vc; i++) wid[pt.vo + i] = wcount + w.id[i]; wcount += w.count; }
    const weld = { id: wid, count: wcount }, gOff = new Int32Array(weld.count + 1), gList = new Int32Array(verts);
    for (let i = 0; i < verts; i++) gOff[weld.id[i] + 1]++;
    for (let i = 0; i < weld.count; i++) gOff[i + 1] += gOff[i];
    { const at = gOff.slice(0, weld.count); for (let i = 0; i < verts; i++) gList[at[weld.id[i]]++] = i; }
    const key = ids.join(',') + '#' + verts + '#' + tris;
    const carried = keep && key === keyIds && sel.length === verts ? sel : new Uint8Array(verts);
    keyIds = key; sel = carried;
    // the rim of every island: the edges that one triangle has (or more than two), as pairs of points: drawn from where the points are now,
    // so a moved island takes its outline with it
    const seenE = new Map(), firstE = new Map(), rimArr = [];
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = I[t + k], b = I[t + (k + 1) % 3], wa = weld.id[a], wb = weld.id[b]; if (wa === wb) continue;
      const key = wa < wb ? wa * weld.count + wb : wb * weld.count + wa, n = seenE.get(key);
      if (n === undefined) { seenE.set(key, 1); firstE.set(key, a * 2097152 + b); } else seenE.set(key, n + 1);
    }
    for (const [key, n] of seenE) if (n !== 2) { const ab = firstE.get(key), b = ab % 2097152; rimArr.push((ab - b) / 2097152, b); }
    const rim = Int32Array.from(rimArr);
    const sameId = !!(own && keep && data && data.UV && key === data.key);
    if (!sameId) dataVer++; hover = null;
    data = { key, id: sameId ? data.id : ++dataSeq, grid: null, isl: null, r, P, UV, I, tris, verts, parts, cover: null, coverStale: false, uvStamp: stampOf(UV), coverOkVer: dataVer, coverOk: true, rim, weld: weld.id, nW: weld.count, gOff, gList, vertPart: null };
    $i('uv-empty').hidden = true;
    const names = parts.map(x => x.p.name || 'part');
    $i('uv-which').textContent = (parts.length === 1 ? names[0] : fmtNum(parts.length) + ' parts') + (noUv.length ? ' · ' + noUv.length + ' without UVs' : '') + (shared ? ' · ' + shared + ' share a shape' : '');
    $i('uv-which').title = names.slice(0, 20).join(', ') + (names.length > 20 ? ', …' : '');
    stats(r); syncBg(); syncTools();
    if (!fitted) fit();
    draw();
  }
  // Parts without UVs can still be unwrapped: the pane says so, and the Unwrap button works on them.
  function showUnwrapOnly(ids) { data = { unwrapOnly: ids.slice(), r: null, parts: [], tris: 0, verts: 0 }; syncTools(); }

  // ── the picture behind ──
  const MAPS = { map: 'map', normal: 'normalMap', ao: 'aoMap' };
  function pictureOf(kind) {
    if (!data || !data.parts) return null;
    for (const { p } of data.parts) {
      const h = _matHolder(p), raw = h ? _matOf(h) : null, m = Array.isArray(raw) ? raw[0] : raw, t = m && m[MAPS[kind]];
      if (t && t.image && (t.image.width || t.image.naturalWidth)) return t.image;
    }
    return null;
  }
  function syncBg() {
    const bar = $i('uv-bg');
    for (const b of bar.querySelectorAll('button')) {
      const k = b.dataset.b, has = k === 'none' || !!pictureOf(k);
      b.disabled = !has; b.classList.toggle('active', k === opt.bg && has);
      if (k === opt.bg && has) bar.style.setProperty('--seg-i', [...bar.children].indexOf(b));
    }
    if (!bar.querySelector('button.active')) { bar.querySelector('button[data-b="none"]').classList.add('active'); bar.style.setProperty('--seg-i', 0); }
    for (const [id, k] of [['uv-lines', 'lines'], ['uv-overlap', 'overlap'], ['uv-checker', 'checker']]) { const b = $i(id); b.classList.toggle('is-on', !!opt[k]); b.setAttribute('aria-pressed', String(!!opt[k])); }
  }

  // ── the drawing ──
  function fit() {
    const { W, H } = sizeNow(); if (!W || !H) return;
    let x0 = 0, x1 = 1, y0 = 0, y1 = 1;
    if (data && data.r && data.r.bounds) { const b = data.r.bounds; x0 = Math.min(x0, b.minU); x1 = Math.max(x1, b.maxU); y0 = Math.min(y0, b.minV); y1 = Math.max(y1, b.maxV); }
    const m = 0.06 * Math.max(x1 - x0, y1 - y0);
    const top = 46;                                    // (the floating bars over the top of the layout: it is fitted into what is left under them)
    view.s = Math.min(W / (x1 - x0 + 2 * m), (H - top) / (y1 - y0 + 2 * m)); view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2 - top / 2 / view.s; fitted = true; userView = false;
  }
  function draw() { if (!raf) raf = requestAnimationFrame(paint); }
  let band = null;                                      // the rubber band while a box is dragged: { x0, y0, x1, y1 } in canvas pixels
  // The layout is drawn in layers. The picture, the tiles, the triangle edges and the island rims are drawn onto a canvas of their own, and what
  // is picked onto a second one, each only when what they show has changed (the view, the points, the options; the pick). Every paint copies
  // the two over the view and adds what moves with the pointer: the mark under it, the box round the pick, the rubber band. Moving the pointer
  // over a layout of a hundred thousand triangles therefore costs two copies and a few marks, not a repaint of every edge.
  const baseCv = document.createElement('canvas'), selCv = document.createElement('canvas');
  const prof = { base: 0, sel: 0, rest: 0, n: 0, lite: false };
  const nosCv = document.createElement('canvas');           // the layout without what is picked, made in the background for a drag
  let nosKey = '', prepToken = 0, prepTimer = 0, refreshTimer = 0, selAny = false;
  let baseKey = '', selKey = '', dataVer = 0, selVer = 0, dataSeq = 0, lastMove = 0, liteTimer = 0;
  const touched = () => { dataVer++; if (data) { data.grid = null; data.cover = data.cover; } };
  // The yellow where islands lie on each other was worked out for the points as they were when the numbers were last read. It is drawn only
  // while the points are still those: their hash is taken when the data is made, and again (once) after every change. (A flag that said "stale"
  // was cleared by a plain click on the layout, and the old yellow came back over islands that had moved; an undo or a cancel that puts the points
  // back shows it again, with no refresh.)
  function stampOf(a) { const u = new Uint32Array(a.buffer, a.byteOffset, a.length); let h = 2166136261; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); } return h >>> 0; }
  function coverValid() {
    if (!data || !data.UV) return false;
    if (data.coverOkVer !== dataVer) { data.coverOkVer = dataVer; data.coverOk = stampOf(data.UV) === data.uvStamp; }
    return data.coverOk;
  }       // (the points moved: what was drawn from them is drawn again)
  // (panning and zooming a very heavy layout: its triangle edges are left out while it moves, and drawn again a moment after it stops)
  const moving = () => { if (!data || data.tris <= 60000) return; lastMove = performance.now(); clearTimeout(liteTimer); liteTimer = setTimeout(() => { baseKey = ''; draw(); }, 190); };
  function paint() {
    raf = 0;
    if (!on || anim || !cv.offsetParent) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    const PW = Math.round(W * dpr), PH = Math.round(H * dpr);
    if (cv.width !== PW || cv.height !== PH) { cv.width = PW; cv.height = PH; if (!fitted) fit(); }
    if (baseCv.width !== PW || baseCv.height !== PH) { baseCv.width = selCv.width = PW; baseCv.height = selCv.height = PH; baseKey = ''; }
    const css = getComputedStyle(document.documentElement), MARK = css.getPropertyValue('--marker').trim() || '#ffc928';
    const s = view.s, X = (u) => (u - view.cx) * s + W / 2, Y = (v) => (v - view.cy) * s + H / 2;
    const dragging = !!(tx && tx.moved && data && data.UV), lite = !dragging && !!(data && data.tris > 60000 && performance.now() - lastMove < 170);      // (a very heavy layout, while it is panned or zoomed: no triangle edges)
    const vk = view.cx + '|' + view.cy + '|' + view.s + '|' + PW + '|' + PH;
    const bk = baseKeyFor(dragging ? 'D' : dataVer, lite);
    const p0 = performance.now(); let p1 = p0, p2 = p0;
    // while a pick is dragged the layout comes from the picture made without it, when that is ready
    const nos = dragging && nosKey === nosKeyFor(tx.ver);
    if (!nos && bk !== baseKey) { renderBase(baseCv.getContext('2d'), W, H, dpr, X, Y, s, MARK, lite, dragging ? sel : null); baseKey = bk; selKey = ''; p1 = performance.now(); }
    const sk = bk + '|' + selVer + '|' + opt.mode;
    if (!dragging && sk !== selKey) { renderSel(selCv.getContext('2d'), W, H, dpr, X, Y, s); selKey = sk; p2 = performance.now(); }
    // (a heavy layout with something picked: the layout without the pick is made in the background, ready for a drag)
    if (!dragging && selAny && data && data.UV && data.tris > 30000 && !prepTimer && nosKey !== nosKeyFor(dataVer)) prepTimer = setTimeout(() => { prepTimer = 0; prepNoSel(); }, 160);
    prof.base = p1 - p0; prof.sel = Math.max(0, p2 - p1); prof.lite = lite; prof.nos = nos; prof.dragging = dragging; prof.nosKey = nosKey.slice(-40); prof.want = dragging ? nosKeyFor(tx.ver).slice(-40) : ''; prof.n++;
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, PW, PH); g.drawImage(nos ? nosCv : baseCv, 0, 0); if (!dragging) g.drawImage(selCv, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (data && data.r && opt.overlap && !dragging && coverValid() && data.r.res && data.r.cover.length) { g.imageSmoothingEnabled = false; g.drawImage(coverCanvas(MARK, opt.bg !== 'none' && !!pictureOf(opt.bg)), X(0), Y(0), s, s); }
    if (dragging) { renderMover(g, X, Y, tx); renderSel(g, W, H, dpr, X, Y, s, tx.tris, true); }
    const UV = data && data.UV;
    // what is under the pointer, in white
    if (UV && hover && hover.ids.length) {
      const h = hover.ids;
      if (hover.mode === 'point') { const x = X(UV[2 * h[0]]), y = Y(UV[2 * h[0] + 1]); g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fillStyle = HOT; g.fill(); g.strokeStyle = HOT_RING; g.lineWidth = 1.5; g.stroke(); }
      else if (hover.mode === 'edge') { g.beginPath(); g.moveTo(X(UV[2 * h[0]]), Y(UV[2 * h[0] + 1])); g.lineTo(X(UV[2 * h[1]]), Y(UV[2 * h[1] + 1])); g.strokeStyle = HOT; g.lineWidth = 3; g.lineCap = 'round'; g.stroke(); g.lineCap = 'butt'; }
      // (a face or an island under the pointer is no longer filled in white: it lit up as the pointer moved over the layout and stayed lit when it stopped)
    }
    // the box round what is picked, and its middle
    const bb = UV && opt.tool !== 'select' ? selBox() : null;
    if (bb) {
      g.setLineDash([4, 3]); g.strokeStyle = ORANGE; g.lineWidth = 1; g.strokeRect(X(bb.u0) + .5, Y(bb.v0) + .5, (bb.u1 - bb.u0) * s, (bb.v1 - bb.v0) * s); g.setLineDash([]);
      const cx = X(bb.cu), cy = Y(bb.cv); g.beginPath(); g.moveTo(cx - 7, cy); g.lineTo(cx + 7, cy); g.moveTo(cx, cy - 7); g.lineTo(cx, cy + 7); g.strokeStyle = ORANGE; g.lineWidth = 1.5; g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1; g.strokeRect(Math.round(X(0)) + .5, Math.round(Y(0)) + .5, Math.round(s) - 1, Math.round(s) - 1);
    // the corners, named
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '10px ' + (css.getPropertyValue('--font-sans').trim() || 'Inter, system-ui, sans-serif'); g.textBaseline = 'bottom';
    if (s > 80) { g.textAlign = 'left'; g.fillText('0, 0', X(0) + 2, Y(0) - 3); g.textAlign = 'right'; g.fillText('1, 1', X(1) - 2, Y(1) + 13); g.textAlign = 'right'; g.fillText('1, 0', X(1) - 2, Y(0) - 3); g.textAlign = 'left'; g.fillText('0, 1', X(0) + 2, Y(1) + 13); }
    prof.rest = performance.now() - Math.max(p1, p2);
    if (band) { g.fillStyle = '#fff'; g.globalAlpha = 0.08; g.fillRect(Math.min(band.x0, band.x1), Math.min(band.y0, band.y1), Math.abs(band.x1 - band.x0), Math.abs(band.y1 - band.y0)); g.globalAlpha = 1; g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1; g.strokeRect(Math.min(band.x0, band.x1) + .5, Math.min(band.y0, band.y1) + .5, Math.abs(band.x1 - band.x0), Math.abs(band.y1 - band.y0)); }
  }
  const baseKeyFor = (ver, lite) => view.cx + '|' + view.cy + '|' + view.s + '|' + cv.width + '|' + cv.height + '|' + ver + (opt.mode === 'point' ? 'p' + selVer : '') + '|' + (data ? data.id : 0) + '|' + opt.bg + opt.lines + opt.checker + opt.snap + opt.grid + (opt.stretch ? 'S' : '') + (lite ? 'L' : '');
  const nosKeyFor = (ver) => view.cx + '|' + view.cy + '|' + view.s + '|' + cv.width + '|' + cv.height + '|' + (data ? data.id : 0) + '|' + ver + '|' + selVer + '|' + opt.bg + opt.lines + opt.checker + opt.snap + opt.grid + (opt.stretch ? 'S' : '') + opt.mode;
  // where several islands lie on each other (as they were when the numbers were read): a picture of its own
  function coverCanvas(MARK, hasImg) {
    const r = data.r;
    if (data.cover && data.coverImg === hasImg) return data.cover;
    const R = r.res, c2 = document.createElement('canvas'); c2.width = c2.height = R;
    const cg = c2.getContext('2d'), im = cg.createImageData(R, R), d = im.data, mk = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(MARK), mr = mk ? parseInt(mk[1], 16) : 255, mg = mk ? parseInt(mk[2], 16) : 201, mb = mk ? parseInt(mk[3], 16) : 40;
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) { const v = r.cover[y * R + x]; if (v !== 2) continue; const o = (y * R + x) * 4; d[o] = mr; d[o + 1] = mg; d[o + 2] = mb; d[o + 3] = 170; }      // (only where islands lie on each other: the grey tint of where one lies was blocks on a coarse grid, fat boxes round thin islands)
    cg.putImageData(im, 0, 0); data.cover = c2; data.coverImg = hasImg;
    return c2;
  }
  // the tiles, the 0–1 square, the picture, the snap grid and the checker
  function baseBack(g, W, H, X, Y, s) {
    const t0x = Math.floor((-W / 2 / s) + view.cx), t1x = Math.ceil((W / 2 / s) + view.cx), t0y = Math.floor((-H / 2 / s) + view.cy), t1y = Math.ceil((H / 2 / s) + view.cy);
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1; g.beginPath();
    if (t1x - t0x < 200 && t1y - t0y < 200) {
      for (let u = t0x; u <= t1x; u++) { g.moveTo(Math.round(X(u)) + .5, 0); g.lineTo(Math.round(X(u)) + .5, H); }
      for (let v = t0y; v <= t1y; v++) { g.moveTo(0, Math.round(Y(v)) + .5); g.lineTo(W, Math.round(Y(v)) + .5); }
    }
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,.38)'; g.fillRect(X(0), Y(0), s, s);
    const img = opt.bg !== 'none' ? pictureOf(opt.bg) : null;
    if (img) { g.imageSmoothingEnabled = s < (img.width || img.naturalWidth || 1) * 1.5; try { g.drawImage(img, X(0), Y(0), s, s); } catch (_) {} }
    if (opt.snap && s > 40) {                              // the snap grid, over the square
      const n = opt.grid, c = s / n; g.strokeStyle = 'rgba(255,255,255,.1)'; g.beginPath();
      for (let i = 1; i < n; i++) { g.moveTo(X(0) + i * c, Y(0)); g.lineTo(X(0) + i * c, Y(1)); g.moveTo(X(0), Y(0) + i * c); g.lineTo(X(1), Y(0) + i * c); }
      g.stroke();
    }
    if (opt.checker) {
      const N = 16, c = s / N;
      g.save(); g.beginPath(); g.rect(X(0), Y(0), s, s); g.clip();
      g.fillStyle = img ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.16)';
      if (c > 2) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if ((i + j) & 1) g.fillRect(X(0) + i * c, Y(0) + j * c, c, c);
      g.restore();
    }
  }
  // the triangles from..to as lines (the mesh, in the viewport's blue); the triangles that touch skip are left out
  function baseLines(g, X, Y, W, H, skip, from, to) {
    const UV = data.UV, I = data.I;
    g.beginPath();
    for (let t = from * 3; t < to * 3; t += 3) {
      if (skip && (skip[I[t]] || skip[I[t + 1]] || skip[I[t + 2]])) continue;
      const a = I[t] * 2, b = I[t + 1] * 2, c = I[t + 2] * 2;
      const ax = X(UV[a]), ay = Y(UV[a + 1]), bx = X(UV[b]), by = Y(UV[b + 1]), cx = X(UV[c]), cy = Y(UV[c + 1]);
      if (Math.max(ax, bx, cx) < 0 || Math.min(ax, bx, cx) > W || Math.max(ay, by, cy) < 0 || Math.min(ay, by, cy) > H) continue;
      g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.lineTo(ax, ay);
    }
    g.strokeStyle = LINE_BLUE; g.lineWidth = 1; g.stroke();
  }
  // the rim of every island (what lies outside the square in the marker colour), from where its points are now
  function baseRim(g, X, Y, skip, MARK) {
    const UV = data.UV, rim = data.rim;
    for (const outside of [false, true]) {
      g.beginPath();
      for (let q = 0; q < rim.length; q += 2) {
        if (skip && (skip[rim[q]] || skip[rim[q + 1]])) continue;
        const a = rim[q] * 2, b = rim[q + 1] * 2, u0 = UV[a], v0 = UV[a + 1], u1 = UV[b], v1 = UV[b + 1];
        const out = u0 < -1e-4 || u0 > 1 + 1e-4 || v0 < -1e-4 || v0 > 1 + 1e-4 || u1 < -1e-4 || u1 > 1 + 1e-4 || v1 < -1e-4 || v1 > 1 + 1e-4;
        if (out !== outside) continue;
        g.moveTo(X(u0), Y(v0)); g.lineTo(X(u1), Y(v1));
      }
      g.strokeStyle = outside ? MARK : 'rgba(235,235,240,.9)'; g.lineWidth = 1; g.stroke();
    }
  }
  // the points that are not picked (Points mode): black discs
  function baseDots(g, X, Y, W, H, s) {
    if (opt.mode !== 'point' || data.nW > MAX_DOTS * 2 || s <= 30) return;
    const UV = data.UV; let n = 0; g.beginPath();
    for (let w = 0; w < data.nW && n < MAX_DOTS; w++) {
      const v = data.gList[data.gOff[w]]; if (sel[v]) continue;
      const x = X(UV[2 * v]), y = Y(UV[2 * v + 1]);
      if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
      g.moveTo(x + 3, y); g.arc(x, y, 3, 0, Math.PI * 2); n++;
    }
    g.fillStyle = '#000'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.stroke();
  }
  function renderBase(g, W, H, dpr, X, Y, s, MARK, lite, skip) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    baseBack(g, W, H, X, Y, s);
    if (!data || !data.r) return;
    if (opt.stretch) baseStretch(g, X, Y, W, H, skip);
    if (opt.lines && !lite && data.tris <= MAX_LINES) baseLines(g, X, Y, W, H, skip, 0, data.I.length / 3);
    baseRim(g, X, Y, skip, MARK); baseDots(g, X, Y, W, H, s);
  }
  // The layout without what is picked, drawn in the background in slices of triangles (the page stays live); ready, it is what a drag starts from.
  async function prepNoSel() {
    if (!on || anim || !data || !data.UV || !selAny) return;
    const my = ++prepToken, key = nosKeyFor(dataVer), dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    const PW = Math.round(W * dpr), PH = Math.round(H * dpr);
    if (nosCv.width !== PW || nosCv.height !== PH) { nosCv.width = PW; nosCv.height = PH; }
    const g = nosCv.getContext('2d'), s = view.s, X = (u) => (u - view.cx) * s + W / 2, Y = (v) => (v - view.cy) * s + H / 2, MARK = getComputedStyle(document.documentElement).getPropertyValue('--marker').trim() || '#ffc928';
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    baseBack(g, W, H, X, Y, s);
    if (opt.stretch) baseStretch(g, X, Y, W, H, sel);
    const nT = data.I.length / 3, CH = 20000, stale = () => my !== prepToken || nosKeyFor(dataVer) !== key || !on;
    if (opt.lines && data.tris <= MAX_LINES) for (let a = 0; a < nT; a += CH) { if (stale()) return; baseLines(g, X, Y, W, H, sel, a, Math.min(nT, a + CH)); g.getImageData(0, 0, 1, 1); await new Promise((r) => setTimeout(r, 0)); }      // (a canvas keeps what is drawn on it as a list and draws it when it is first used: reading a point makes it do the work now, slice by slice)
    if (stale()) return;
    baseRim(g, X, Y, sel, MARK); baseDots(g, X, Y, W, H, s); g.getImageData(0, 0, 1, 1);
    nosKey = key;
  }
  // On release: the picture made without the pick, with the moved triangles drawn over it, is the layout again: nothing is drawn from the start.
  function adoptBase(t) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight, g = baseCv.getContext('2d'), s = view.s;
    if (baseCv.width !== nosCv.width || baseCv.height !== nosCv.height) { baseCv.width = selCv.width = nosCv.width; baseCv.height = selCv.height = nosCv.height; }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, baseCv.width, baseCv.height); g.drawImage(nosCv, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); renderMover(g, (u) => (u - view.cx) * s + W / 2, (v) => (v - view.cy) * s + H / 2, t);
    baseKey = baseKeyFor(dataVer, false); selKey = '';
  }
  // What is picked, as the viewport's Edit mesh shows it: polygons filled orange with a lighter outline (Faces and Islands), picked edges a wide
  // orange line (from Edges on), the picked points (Points mode) orange discs. tris: only these triangles are looked at (while the pick is dragged);
  // direct: drawn onto the view as it is, not onto a layer of its own.
  function renderSel(g, W, H, dpr, X, Y, s, tris, direct) {
    if (!direct) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); }
    if (!data || !data.UV) return;
    const UV = data.UV, I = data.I;
    let any = !!tris; if (!any) for (let i = 0; i < sel.length; i++) if (sel[i]) { any = true; break; }
    if (!any) return;
    const each = (fn) => { if (tris) for (let k = 0; k < tris.length; k++) fn(tris[k] * 3); else for (let t = 0; t < I.length; t += 3) fn(t); };
    // How many triangles are picked: a very large pick (a whole layout of a quarter of a million) is drawn as a fill and the outlines of its islands, not
    // as three edges for every triangle, which a canvas takes seconds to stroke. (And a path is not closed at every triangle: the fill closes it, and Chrome
    // measures the whole path at each closePath, so a path of 258,000 triangles took a minute and a half to make.)
    let nSel = 0;
    if (opt.mode !== 'point' && !tris) each((t) => { if (sel[I[t]] && sel[I[t + 1]] && sel[I[t + 2]]) nSel++; });
    const BIG = 40000;
    if (opt.mode === 'face' || opt.mode === 'island') {
      g.beginPath();
      each((t) => {
        const a = I[t], b = I[t + 1], c = I[t + 2];
        if (!(sel[a] && sel[b] && sel[c])) return;
        g.moveTo(X(UV[2 * a]), Y(UV[2 * a + 1])); g.lineTo(X(UV[2 * b]), Y(UV[2 * b + 1])); g.lineTo(X(UV[2 * c]), Y(UV[2 * c + 1]));
      });
      g.fillStyle = ORANGE; g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1;      // (the outline of each triangle is the edges drawn next, in a wider line)
    }
    if (opt.mode !== 'point') {
      g.beginPath();
      const rim = data.rim;
      if (nSel > BIG && rim && rim.length) { for (let q = 0; q + 1 < rim.length; q += 2) { const a = rim[q], b = rim[q + 1]; if (sel[a] && sel[b]) { g.moveTo(X(UV[2 * a]), Y(UV[2 * a + 1])); g.lineTo(X(UV[2 * b]), Y(UV[2 * b + 1])); } } }
      else each((t) => { for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; if (sel[a] && sel[b]) { g.moveTo(X(UV[2 * a]), Y(UV[2 * a + 1])); g.lineTo(X(UV[2 * b]), Y(UV[2 * b + 1])); } } });
      g.strokeStyle = ORANGE; g.lineWidth = 2.5; g.lineCap = nSel > BIG ? 'butt' : 'round'; g.stroke(); g.lineCap = 'butt';
    }
    if (opt.mode === 'point') {                                  // (the picked points are marked in Points mode only: a picked edge or island is not a row of dots)
      let n = 0; g.beginPath();
      for (let w = 0; w < data.nW && n < MAX_DOTS; w++) {
        const v = data.gList[data.gOff[w]]; if (!sel[v]) continue;
        const x = X(UV[2 * v]), y = Y(UV[2 * v + 1]);
        if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
        g.moveTo(x + 3, y); g.arc(x, y, 3, 0, Math.PI * 2); n++;
      }
      g.fillStyle = ORANGE; g.fill();
    }
  }
  // the triangles that touch the pick, and the island outlines that do, drawn where the points are now (while they are dragged)
  function renderMover(g, X, Y, tr) {
    const UV = data.UV, I = data.I, T = tr.tris, R = data.rim;
    if (opt.lines) {
      g.beginPath();
      for (let k = 0; k < T.length; k++) { const t = T[k] * 3, a = I[t] * 2, b = I[t + 1] * 2, c = I[t + 2] * 2; g.moveTo(X(UV[a]), Y(UV[a + 1])); g.lineTo(X(UV[b]), Y(UV[b + 1])); g.lineTo(X(UV[c]), Y(UV[c + 1])); g.lineTo(X(UV[a]), Y(UV[a + 1])); }
      g.strokeStyle = LINE_BLUE; g.lineWidth = 1; g.stroke();
    }
    g.beginPath();
    for (let k = 0; k < tr.rims.length; k++) { const q = tr.rims[k], a = R[q] * 2, b = R[q + 1] * 2; g.moveTo(X(UV[a]), Y(UV[a + 1])); g.lineTo(X(UV[b]), Y(UV[b + 1])); }
    g.strokeStyle = 'rgba(235,235,240,.9)'; g.lineWidth = 1; g.stroke();
  }

  // ── the selection ──
  const anySel = () => { for (let i = 0; i < sel.length; i++) if (sel[i]) return true; return false; };
  const selIndices = () => { const out = []; for (let i = 0; i < sel.length; i++) if (sel[i]) out.push(i); return out; };
  function selBox() {
    if (!data || !data.UV) return null;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    if (tx && tx.moved && tx.idx) { for (const i of tx.idx) { const u = data.UV[2 * i], v = data.UV[2 * i + 1]; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; } return u0 === Infinity ? null : { u0, u1, v0, v1, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, w: u1 - u0, h: v1 - v0 }; }
    for (let i = 0; i < sel.length; i++) if (sel[i]) { const u = data.UV[2 * i], v = data.UV[2 * i + 1]; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    return u0 === Infinity ? null : { u0, u1, v0, v1, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, w: u1 - u0, h: v1 - v0 };
  }
  const setGroup = (w, v) => { for (let k = data.gOff[w]; k < data.gOff[w + 1]; k++) sel[data.gList[k]] = v; };
  const setVertex = (i, v) => { if (!data) return; setGroup(data.weld[i], v); };
  function combine(ids, e) {                                // ids: the points a pick gives (any of their twins)
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) sel.fill(0);
    const sub = e.ctrlKey || e.metaKey;
    if (e.shiftKey && !sub && ids.length === 1) { const was = sel[ids[0]]; for (const i of ids) setVertex(i, was ? 0 : 1); return; }   // (a shift-click on what is picked puts it back)
    for (const i of ids) setVertex(i, sub ? 0 : 1);
  }
  const toUV = (px, py) => { const { W, H } = sizeNow(); return [(px - W / 2) / view.s + view.cx, (py - H / 2) / view.s + view.cy]; };
  const toPx = (u, v) => { const { W, H } = sizeNow(); return [(u - view.cx) * view.s + W / 2, (v - view.cy) * view.s + H / 2]; };
  const distSeg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };
  // A grid over the layout (built once for the points as they are): each cell lists the triangles whose box touches it, so a pick or a hover looks
  // at the few triangles near the pointer and not at every one.
  function ensureGrid() {
    if (data.grid) return data.grid;
    const UV = data.UV, I = data.I, nT = I.length / 3;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < data.verts; i++) { const u = UV[2 * i], v = UV[2 * i + 1]; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const n = Math.max(8, Math.min(160, Math.round(Math.sqrt(nT / 5)))), cw = Math.max((u1 - u0) / n, 1e-9), ch = Math.max((v1 - v0) / n, 1e-9), off = new Int32Array(n * n + 1);
    const cl = (x) => Math.max(0, Math.min(n - 1, x));
    const range = (t) => {
      const a = I[3 * t] * 2, b = I[3 * t + 1] * 2, c = I[3 * t + 2] * 2;
      return [cl(Math.floor((Math.min(UV[a], UV[b], UV[c]) - u0) / cw)), cl(Math.floor((Math.max(UV[a], UV[b], UV[c]) - u0) / cw)), cl(Math.floor((Math.min(UV[a + 1], UV[b + 1], UV[c + 1]) - v0) / ch)), cl(Math.floor((Math.max(UV[a + 1], UV[b + 1], UV[c + 1]) - v0) / ch))];
    };
    for (let t = 0; t < nT; t++) { const [x0, x1, y0, y1] = range(t); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) off[y * n + x + 1]++; }
    for (let i = 0; i < n * n; i++) off[i + 1] += off[i];
    const list = new Int32Array(off[n * n]), at = off.slice(0, n * n);
    for (let t = 0; t < nT; t++) { const [x0, x1, y0, y1] = range(t); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) list[at[y * n + x]++] = t; }
    return (data.grid = { n, u0, v0, cw, ch, off, list, stamp: new Int32Array(nT), gen: 0 });
  }
  // the triangles near (u, v), within r UV units, each once
  function nearTris(u, v, r) {
    const gr = ensureGrid(), n = gr.n, cl = (x) => Math.max(0, Math.min(n - 1, x));
    const x0 = cl(Math.floor((u - r - gr.u0) / gr.cw)), x1 = cl(Math.floor((u + r - gr.u0) / gr.cw)), y0 = cl(Math.floor((v - r - gr.v0) / gr.ch)), y1 = cl(Math.floor((v + r - gr.v0) / gr.ch)), out = [];
    gr.gen++;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let k = gr.off[y * n + x]; k < gr.off[y * n + x + 1]; k++) { const t = gr.list[k]; if (gr.stamp[t] !== gr.gen) { gr.stamp[t] = gr.gen; out.push(t); } }
    return out;
  }
  function islandTris() {                                  // the triangles of each island, once for the points as they are
    if (data.isl) return data.isl;
    const r = data.r, nI = r.islands, cnt = new Int32Array(nI + 1);
    for (let t = 0; t < r.islandOf.length; t++) cnt[r.islandOf[t] + 1]++;
    for (let i = 0; i < nI; i++) cnt[i + 1] += cnt[i];
    const list = new Int32Array(r.islandOf.length), at = cnt.slice(0, nI);
    for (let t = 0; t < r.islandOf.length; t++) list[at[r.islandOf[t]]++] = t;
    return (data.isl = { off: cnt, list });
  }
  function pickAt(px, py, modeIn) {                         // the points under a click, by the pick mode (or the one asked for)
    const mode = modeIn || opt.mode;
    const { UV, I } = data, s = view.s, { W, H } = sizeNow();
    const X = (u) => (u - view.cx) * s + W / 2, Y = (v) => (v - view.cy) * s + H / 2;
    if (mode === 'point') {
      const [u, v] = toUV(px, py); let best = -1, bd = 10;
      for (const t of nearTris(u, v, 12 / s)) for (let k = 0; k < 3; k++) { const q = I[3 * t + k], d = Math.hypot(X(UV[2 * q]) - px, Y(UV[2 * q + 1]) - py); if (d < bd) { bd = d; best = q; } }
      return best >= 0 ? [best] : [];
    }
    if (mode === 'edge') {
      const [u, v] = toUV(px, py); let best = null, bd = 8;
      for (const t of nearTris(u, v, 10 / s)) for (let k = 0; k < 3; k++) {
        const a = I[3 * t + k], b = I[3 * t + (k + 1) % 3], d = distSeg(px, py, X(UV[2 * a]), Y(UV[2 * a + 1]), X(UV[2 * b]), Y(UV[2 * b + 1]));
        if (d < bd) { bd = d; best = [a, b]; }
      }
      return best || [];
    }
    // a face (the one on top: the last drawn) or the island of it
    const [u, v] = toUV(px, py), cand = nearTris(u, v, 1e-9).sort((x, y) => y - x);
    for (const tri of cand) {
      const t = tri * 3, a = I[t] * 2, b = I[t + 1] * 2, c = I[t + 2] * 2;
      const d = (UV[b] - UV[a]) * (UV[c + 1] - UV[a + 1]) - (UV[c] - UV[a]) * (UV[b + 1] - UV[a + 1]);
      if (!d) continue;
      const w1 = ((u - UV[a]) * (UV[c + 1] - UV[a + 1]) - (UV[c] - UV[a]) * (v - UV[a + 1])) / d, w2 = ((UV[b] - UV[a]) * (v - UV[a + 1]) - (u - UV[a]) * (UV[b + 1] - UV[a + 1])) / d;
      if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
      if (mode === 'face') return [I[t], I[t + 1], I[t + 2]];
      const il = islandTris(), isl = data.r.islandOf[tri], out = [];
      for (let k = il.off[isl]; k < il.off[isl + 1]; k++) { const q = il.list[k] * 3; out.push(I[q], I[q + 1], I[q + 2]); }
      return out;
    }
    return [];
  }
  function boxSelect(b, e) {
    const { UV, I, nW, gOff, gList } = data, [ua, va] = toUV(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1)), [ub, vb] = toUV(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    const inside = (v) => UV[2 * v] >= ua && UV[2 * v] <= ub && UV[2 * v + 1] >= va && UV[2 * v + 1] <= vb;
    const ids = [];
    if (opt.mode === 'point') { for (let w = 0; w < nW; w++) { const v = gList[gOff[w]]; if (inside(v)) ids.push(v); } }
    else if (opt.mode === 'edge') { for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], c = I[t + (k + 1) % 3]; if (inside(a) && inside(c)) ids.push(a, c); } }
    else if (opt.mode === 'face') { for (let t = 0; t < I.length; t += 3) if (inside(I[t]) && inside(I[t + 1]) && inside(I[t + 2])) ids.push(I[t], I[t + 1], I[t + 2]); }
    else {                                                   // islands: any triangle whose middle is inside takes its island
      const want = new Set();
      for (let t = 0; t < I.length; t += 3) { const mu = (UV[2 * I[t]] + UV[2 * I[t + 1]] + UV[2 * I[t + 2]]) / 3, mv = (UV[2 * I[t] + 1] + UV[2 * I[t + 1] + 1] + UV[2 * I[t + 2] + 1]) / 3; if (mu >= ua && mu <= ub && mv >= va && mv <= vb) want.add(data.r.islandOf[t / 3]); }
      for (let q = 0; q < data.r.islandOf.length; q++) if (want.has(data.r.islandOf[q])) ids.push(I[3 * q], I[3 * q + 1], I[3 * q + 2]);
    }
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) sel.fill(0);
    const sub = e.ctrlKey || e.metaKey; for (const i of ids) setVertex(i, sub ? 0 : 1);
  }
  function selectAll() { if (!data || !data.UV) return; sel.fill(1); syncTools(); draw(); }
  function selectNone() { if (!data || !data.UV) return; sel.fill(0); syncTools(); draw(); }
  function invert() { if (!data || !data.UV) return; for (let w = 0; w < data.nW; w++) { const was = sel[data.gList[data.gOff[w]]]; setGroup(w, was ? 0 : 1); } syncTools(); draw(); }
  function grow() {
    if (!data || !data.UV) return; const add = [], I = data.I;
    for (let t = 0; t < I.length; t += 3) if (sel[I[t]] || sel[I[t + 1]] || sel[I[t + 2]]) add.push(I[t], I[t + 1], I[t + 2]);
    for (const i of add) setVertex(i, 1); syncTools(); draw();
  }
  function shrink() {
    if (!data || !data.UV) return; const drop = [], I = data.I;
    for (let t = 0; t < I.length; t += 3) if (!(sel[I[t]] && sel[I[t + 1]] && sel[I[t + 2]])) { for (let k = 0; k < 3; k++) if (sel[I[t + k]]) drop.push(I[t + k]); }
    for (const i of drop) setVertex(i, 0); syncTools(); draw();
  }

  // ── changes: one undo step each ──
  // A change is made on the working copy (data.UV) and handed back to the geometries by commit(): the parts whose points moved get their
  // UV array replaced, and the old and new arrays are the undo step.
  const snap = () => data.UV.slice();
  function commit(before, label) {
    const items = [];
    for (const pt of data.parts) {
      const a = before.subarray(2 * pt.vo, 2 * (pt.vo + pt.vc)), b = data.UV.subarray(2 * pt.vo, 2 * (pt.vo + pt.vc));
      let diff = false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff = true; break; }
      if (!diff || !editable(pt.g)) continue;
      const after = b.slice(), was = a.slice();
      pt.g.attributes.uv.array.set(after); pt.g.attributes.uv.needsUpdate = true;
      items.push({ geom: pt.g, before: was, after });
    }
    if (!items.length) return false;
    pushUndo({ type: 'uvEdit', label, items });
    try { requestRender(); } catch (_) {}
    lastSig = sigOf([...(state.selected || [])]);            // (the numbers and the islands are read again a little later: scheduleRefresh)
    return true;
  }
  const needSel = () => { if (!data || !data.UV) { toast('UV layout', 'Select a part with texture coordinates first', 'info', 2500); return false; } if (!anySel()) { toast('UV layout', 'Pick something first: click it, or drag a box', 'info', 2500); return false; } return true; };
  function edit(label, fn, needs = true) {
    if (!data || !data.UV) { toast('UV layout', 'Select a part with texture coordinates first', 'info', 2500); return false; }
    if (needs && !needSel()) return false;
    const before = snap(); data.coverStale = true; fn(); touched();
    const ok = commit(before, label); syncTools(); draw(); if (ok) scheduleRefresh();
    return ok;
  }
  // the points to move: what is picked
  const aboutBox = (fn) => { const bb = selBox(); if (!bb) return; const U = data.UV; for (let i = 0; i < sel.length; i++) if (sel[i]) { const [u, v] = fn(U[2 * i] - bb.cu, U[2 * i + 1] - bb.cv); U[2 * i] = bb.cu + u; U[2 * i + 1] = bb.cv + v; } };
  const flipH = () => edit('Flip UVs horizontally', () => aboutBox((u, v) => [-u, v]));
  const flipV = () => edit('Flip UVs vertically', () => aboutBox((u, v) => [u, -v]));
  const turn = (deg) => edit('Rotate UVs', () => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); aboutBox((u, v) => [u * c - v * s, u * s + v * c]); });
  function align(how) {
    edit('Align UVs', () => {
      const bb = selBox(); if (!bb) return; let dx = 0, dy = 0;
      if (how === 'left') dx = -bb.u0; else if (how === 'center') dx = 0.5 - bb.cu; else if (how === 'right') dx = 1 - bb.u1;
      else if (how === 'top') dy = -bb.v0; else if (how === 'middle') dy = 0.5 - bb.cv; else if (how === 'bottom') dy = 1 - bb.v1;
      for (let i = 0; i < sel.length; i++) if (sel[i]) { data.UV[2 * i] += dx; data.UV[2 * i + 1] += dy; }
    });
  }
  function fitSquare() {
    edit('Fit UVs to the square', () => {
      const idx = anySel() ? selIndices() : null, bb = idx ? selBox() : allBox(); if (!bb || !(bb.w > 0 || bb.h > 0)) return;
      const k = 1 / Math.max(bb.w, bb.h, 1e-9), U = data.UV, each = (i) => { U[2 * i] = 0.5 + (U[2 * i] - bb.cu) * k; U[2 * i + 1] = 0.5 + (U[2 * i + 1] - bb.cv) * k; };
      if (idx) idx.forEach(each); else for (let i = 0; i < data.verts; i++) each(i);
    }, false);
  }
  function allBox() { const U = data.UV; let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (let i = 0; i < data.verts; i++) { const u = U[2 * i], v = U[2 * i + 1]; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; } return { u0, u1, v0, v1, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, w: u1 - u0, h: v1 - v0 }; }
  // The pieces that Pack and Density work on: triangles joined along an edge (as the islands are) AND those that meet at a corner, so a
  // point is in one piece only (a corner two islands share would otherwise be moved with the first and drag the other's triangles to it).
  // Which have a picked point (all of them when nothing is picked), and the points of each.
  function piecesOf() {
    if (data.pieces) return data.pieces;
    const I = data.I, nT = I.length / 3, parent = new Int32Array(nT), first = new Int32Array(data.nW).fill(-1);
    for (let t = 0; t < nT; t++) parent[t] = t;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const w = data.weld[I[3 * t + k]]; if (first[w] < 0) first[w] = t; else { const a = find(first[w]), b = find(t); if (a !== b) parent[b] = a; } }
    const idOf = new Map(), compOf = new Int32Array(nT);
    for (let t = 0; t < nT; t++) { const r0 = find(t); let i = idOf.get(r0); if (i === undefined) { i = idOf.size; idOf.set(r0, i); } compOf[t] = i; }
    const nI = idOf.size, lists = Array.from({ length: nI }, () => []), stamp = new Int32Array(data.verts).fill(-1);
    for (let t = 0; t < nT; t++) { const isl = compOf[t]; for (let k = 0; k < 3; k++) { const v = I[3 * t + k]; if (stamp[v] !== isl) { stamp[v] = isl; lists[isl].push(v); } } }
    return (data.pieces = { compOf, n: nI, lists });
  }
  function islandSets() {
    const { compOf, n: nI, lists } = piecesOf(), I = data.I, nT = I.length / 3, pickedAny = anySel(), has = new Uint8Array(nI);
    if (pickedAny) for (let t = 0; t < nT; t++) if (sel[I[3 * t]] || sel[I[3 * t + 1]] || sel[I[3 * t + 2]]) has[compOf[t]] = 1;
    const ids = []; for (let i = 0; i < nI; i++) if (!pickedAny || has[i]) ids.push(i);
    return { ids, lists, compOf, n: nI };
  }
  const boxOf = (list) => { const U = data.UV; let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const v of list) { const u = U[2 * v], w = U[2 * v + 1]; if (u < u0) u0 = u; if (u > u1) u1 = u; if (w < v0) v0 = w; if (w > v1) v1 = w; } return { u0, u1, v0, v1, w: u1 - u0, h: v1 - v0 }; };
  function pack() {
    edit('Pack UV islands', () => {
      const { ids, lists } = islandSets(), boxes = ids.map(i => boxOf(lists[i])), turn = boxes.map(b => opt.packRot && b.h > b.w * 1.05);      // (turned: the long side across)
      const res = packIslands(boxes.map((b, k) => ({ w: Math.max(turn[k] ? b.h : b.w, 1e-6), h: Math.max(turn[k] ? b.w : b.h, 1e-6) })), { margin: 0.004 });
      if (!res) { toast('UV layout', 'The islands could not be packed', 'warn', 3000); return; }
      const U = data.UV, moved = new Uint8Array(data.verts);
      ids.forEach((isl, k) => {
        const b = boxes[k], [x, y] = res.at[k];
        for (const v of lists[isl]) {
          if (moved[v]) continue; moved[v] = 1;
          const du = U[2 * v] - b.u0, dv = U[2 * v + 1] - b.v0;
          if (turn[k]) { U[2 * v] = x + dv * res.scale; U[2 * v + 1] = y + (b.w - du) * res.scale; } else { U[2 * v] = x + du * res.scale; U[2 * v + 1] = y + dv * res.scale; }
        }
      });
    }, false);
  }
  function density() {
    edit('Even out texel density', () => {
      const { ids, lists, compOf, n } = islandSets(), P = data.P, U = data.UV, I = data.I, a3 = new Float64Array(n), au = new Float64Array(n);
      for (let t = 0; t < I.length / 3; t++) {
        const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2], isl = compOf[t];
        const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
        a3[isl] += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
        au[isl] += Math.abs((U[2 * b] - U[2 * a]) * (U[2 * c + 1] - U[2 * a + 1]) - (U[2 * c] - U[2 * a]) * (U[2 * b + 1] - U[2 * a + 1])) / 2;
      }
      // the target is the density of the whole of what is chosen (the area-weighted mean of the logarithms)
      let sw = 0, sl = 0; for (const i of ids) if (a3[i] > 0 && au[i] > 0) { sw += a3[i]; sl += a3[i] * Math.log(Math.sqrt(au[i] / a3[i])); }
      if (!sw) return; const target = Math.exp(sl / sw), moved = new Uint8Array(data.verts);
      for (const i of ids) {
        if (!(a3[i] > 0 && au[i] > 0)) continue;
        const k = target / Math.sqrt(au[i] / a3[i]), b = boxOf(lists[i]), cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2;
        for (const v of lists[i]) { if (moved[v]) continue; moved[v] = 1; U[2 * v] = cu + (U[2 * v] - cu) * k; U[2 * v + 1] = cv + (U[2 * v + 1] - cv) * k; }
      }
    }, false);
  }
  // ── the heat-map: how much each triangle's picture is stretched or squeezed against the others (RizomUV's distortion bar) ──
  // The texel density of a triangle is sqrt(its UV area / its area on the surface), in the scene's units. Against the middle one (the median): twice as
  // dense or more is blue, 1.3 times cyan; half as dense or less is red, 0.77 orange; the rest is left clear.
  function stretchBins() {
    if (data.stretch && data.stretchVer === dataVer) return data.stretch;
    const P = data.P, U = data.UV, I = data.I, nT = I.length / 3, d = new Float32Array(nT), samp = [];
    for (let t = 0; t < nT; t++) {
      const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
      const a3 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      const au = Math.abs((U[2 * b] - U[2 * a]) * (U[2 * c + 1] - U[2 * a + 1]) - (U[2 * c] - U[2 * a]) * (U[2 * b + 1] - U[2 * a + 1])) / 2;
      d[t] = a3 > 1e-12 && au > 1e-14 ? 0.5 * Math.log2(au / a3) : NaN;
      if (d[t] === d[t] && (nT < 60000 || t % Math.ceil(nT / 60000) === 0)) samp.push(d[t]);
    }
    samp.sort((x, y) => x - y);
    const med = samp.length ? samp[samp.length >> 1] : 0, bins = new Uint8Array(nT);
    for (let t = 0; t < nT; t++) { const v = d[t]; if (v !== v) continue; const q = v - med; bins[t] = q > 1 ? 1 : q > 0.38 ? 2 : q < -1 ? 5 : q < -0.38 ? 4 : 3; }
    data.stretchVer = dataVer; data.stretchMed = med; data.stretchD = d;
    return (data.stretch = bins);
  }
  const HEAT = [null, 'rgba(40,110,255,.55)', 'rgba(40,200,220,.42)', null, 'rgba(255,160,40,.46)', 'rgba(255,60,50,.62)'];
  function baseStretch(g, X, Y, W, H, skip) {
    const bins = stretchBins(), UV = data.UV, I = data.I;
    for (const bin of [1, 2, 4, 5]) {
      g.beginPath();
      for (let t = 0; t < bins.length; t++) {
        if (bins[t] !== bin) continue;
        const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
        if (skip && (skip[a] || skip[b] || skip[c])) continue;
        g.moveTo(X(UV[2 * a]), Y(UV[2 * a + 1])); g.lineTo(X(UV[2 * b]), Y(UV[2 * b + 1])); g.lineTo(X(UV[2 * c]), Y(UV[2 * c + 1]));
      }
      g.fillStyle = HEAT[bin]; g.fill();
    }
  }
  // how far the layout is from an even density: the mean of |log2 density - median| over the triangles (0 is even)
  function stretchScore() { stretchBins(); const d = data.stretchD, m = data.stretchMed; let sum = 0, n = 0; for (let t = 0; t < d.length; t++) if (d[t] === d[t]) { sum += Math.abs(d[t] - m); n++; } return n ? sum / n : 0; }
  function pickBy(test) {                                    // pick the triangles a test says yes to (by their number)
    if (!data || !data.UV) return;
    sel.fill(0); const I = data.I;
    for (let t = 0; t < I.length / 3; t++) if (test(t)) { setVertex(I[3 * t], 1); setVertex(I[3 * t + 1], 1); setVertex(I[3 * t + 2], 1); }
    if (opt.mode === 'point' || opt.mode === 'edge') { opt.mode = 'face'; _Prefs.set('uvsplit.mode', 'face'); }
    syncTools(); draw();
  }
  function pickFlipped() {
    const U = data.UV, I = data.I, nT = I.length / 3, sg = new Int8Array(nT); let pos = 0, neg = 0;
    for (let t = 0; t < nT; t++) { const a = I[3 * t] * 2, b = I[3 * t + 1] * 2, c = I[3 * t + 2] * 2, v = (U[b] - U[a]) * (U[c + 1] - U[a + 1]) - (U[c] - U[a]) * (U[b + 1] - U[a + 1]); sg[t] = v > 0 ? 1 : v < 0 ? -1 : 0; if (v > 0) pos++; else if (v < 0) neg++; }
    const odd = pos >= neg ? -1 : 1; pickBy((t) => sg[t] === odd);
  }
  function pickStretched() { const b = stretchBins(); pickBy((t) => b[t] === 1 || b[t] === 5); }

  // ── arranging ──
  const shiftList = (list, du, dv, moved) => { const U = data.UV; for (const v of list) { if (moved[v]) continue; moved[v] = 1; U[2 * v] += du; U[2 * v + 1] += dv; } };
  // Distribute: points or islands (by the pick mode) spaced evenly between the first and the last along U (h) or V (v).
  function distribute(axis) {
    const h = axis === 'h', byPoints = opt.mode === 'point' || opt.mode === 'edge';
    if (byPoints && !anySel()) { toast('UV layout', 'Pick the points to space first', 'info', 2500); return; }
    edit('Distribute UVs', () => {
      const U = data.UV;
      if (byPoints) {
        const seen = new Set(), groups = [];
        for (let i = 0; i < sel.length; i++) if (sel[i]) { const w = data.weld[i]; if (!seen.has(w)) { seen.add(w); groups.push(w); } }
        if (groups.length < 3) { toast('UV layout', 'Pick at least three points to space', 'info', 2500); return; }
        const at = h ? 0 : 1, co = (w) => U[2 * data.gList[data.gOff[w]] + at];
        groups.sort((a, b) => co(a) - co(b));
        const lo = co(groups[0]), hi = co(groups[groups.length - 1]);
        groups.forEach((w, k) => { const val = lo + (hi - lo) * k / (groups.length - 1); for (let q = data.gOff[w]; q < data.gOff[w + 1]; q++) U[2 * data.gList[q] + at] = val; });
        return;
      }
      const { ids, lists } = islandSets();
      if (ids.length < 3) { toast('UV layout', 'Pick at least three islands to space', 'info', 2500); return; }
      const items = ids.map((i) => ({ i, b: boxOf(lists[i]) })).sort((x, y) => (h ? x.b.u0 - y.b.u0 : x.b.v0 - y.b.v0));
      let end = -Infinity, sum = 0; const start = h ? items[0].b.u0 : items[0].b.v0;
      for (const it of items) { end = Math.max(end, h ? it.b.u1 : it.b.v1); sum += h ? it.b.w : it.b.h; }
      const gap = (end - start - sum) / (items.length - 1), moved = new Uint8Array(data.verts);
      if (gap >= 0) {
        let pos = start;
        for (const it of items) { const cur = h ? it.b.u0 : it.b.v0; shiftList(lists[it.i], h ? pos - cur : 0, h ? 0 : pos - cur, moved); pos += (h ? it.b.w : it.b.h) + gap; }
      } else {                                              // they do not fit side by side: their middles are spaced evenly instead
        const mid = (it) => (h ? (it.b.u0 + it.b.u1) / 2 : (it.b.v0 + it.b.v1) / 2);
        items.sort((x, y) => mid(x) - mid(y));
        const c0 = mid(items[0]), c1 = mid(items[items.length - 1]);
        items.forEach((it, k) => { const d = c0 + (c1 - c0) * k / (items.length - 1) - mid(it); shiftList(lists[it.i], h ? d : 0, h ? 0 : d, moved); });
      }
    }, false);
  }
  // The convex hull of points ([x, y, ...] flat), for the turning of an island: its tightest box is found on the hull, which has few points.
  function hullOf(pts) {
    const n = pts.length / 2, idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]), cr = (o, a, b) => (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) - (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
    const lo = [], up = [];
    for (const i of idx) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], i) <= 0) up.pop(); up.push(i); }
    lo.pop(); up.pop(); const h = lo.concat(up), out = new Float64Array(h.length * 2);
    h.forEach((i, k) => { out[2 * k] = pts[2 * i]; out[2 * k + 1] = pts[2 * i + 1]; });
    return out;
  }
  // Orient: each island turned to the angle at which its box is smallest, the long side across ("almost always results in straight shells")
  function orient() {
    edit('Orient islands', () => {
      const { ids, lists } = islandSets(), U = data.UV, moved = new Uint8Array(data.verts);
      for (const i of ids) {
        const L = lists[i]; if (L.length < 3) continue;
        let cu = 0, cv = 0; const pts = new Float64Array(L.length * 2);
        L.forEach((v, k) => { pts[2 * k] = U[2 * v]; pts[2 * k + 1] = U[2 * v + 1]; cu += U[2 * v]; cv += U[2 * v + 1]; }); cu /= L.length; cv /= L.length;
        const hp = hullOf(pts), m = hp.length / 2;
        const measure = (deg) => { const c = Math.cos(deg * Math.PI / 180), sn = Math.sin(deg * Math.PI / 180); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let k = 0; k < m; k++) { const x = (hp[2 * k] - cu) * c - (hp[2 * k + 1] - cv) * sn, y = (hp[2 * k] - cu) * sn + (hp[2 * k + 1] - cv) * c; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return { a: (x1 - x0) * (y1 - y0), w: x1 - x0, h: y1 - y0 }; };
        let best = 0, bestA = Infinity;
        for (let d = 0; d < 90; d += 1) { const r = measure(d); if (r.a < bestA - 1e-12) { bestA = r.a; best = d; } }
        const r = measure(best); let ang = best; if (r.h > r.w) ang += 90;
        const c = Math.cos(ang * Math.PI / 180), sn = Math.sin(ang * Math.PI / 180);
        for (const v of L) { if (moved[v]) continue; moved[v] = 1; const x = U[2 * v] - cu, y = U[2 * v + 1] - cv; U[2 * v] = cu + x * c - y * sn; U[2 * v + 1] = cv + x * sn + y * c; }
      }
    }, false);
  }
  // Line up: the picked points on one straight line, at the middle of where they are (across: h, down: v)
  function lineUp(axis) {
    edit('Line up UVs', () => {
      const U = data.UV, at = axis === 'h' ? 1 : 0, seen = new Set(), groups = []; let sum = 0;
      for (let i = 0; i < sel.length; i++) if (sel[i]) { const w = data.weld[i]; if (!seen.has(w)) { seen.add(w); groups.push(w); sum += U[2 * i + at]; } }
      if (groups.length < 2) return;
      const val = sum / groups.length;
      for (const w of groups) for (let q = data.gOff[w]; q < data.gOff[w + 1]; q++) U[2 * data.gList[q] + at] = val;
    });
  }
  // ── texel density in pixels per scene unit (mm) at the size of the picture Bake textures makes ──
  const texSize = () => +(_Prefs.get('bake.size') || 2048) || 2048;
  function areasOfIslands() {
    const sets = islandSets(), P = data.P, U = data.UV, I = data.I, n = sets.n, a3 = new Float64Array(n), au = new Float64Array(n);
    for (let t = 0; t < I.length / 3; t++) {
      const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2], isl = sets.compOf[t];
      const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
      a3[isl] += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      au[isl] += Math.abs((U[2 * b] - U[2 * a]) * (U[2 * c + 1] - U[2 * a + 1]) - (U[2 * c] - U[2 * a]) * (U[2 * b + 1] - U[2 * a + 1])) / 2;
    }
    return Object.assign(sets, { a3, au });
  }
  function densityNow() {                                  // pixels per mm of the picked islands (all of them when nothing is picked), as a whole
    if (!data || !data.UV || data.tris > 800000) return null;
    const A = areasOfIslands(); let s3 = 0, su = 0; for (const i of A.ids) { s3 += A.a3[i]; su += A.au[i]; }
    return s3 > 0 && su > 0 ? Math.sqrt(su / s3) * texSize() : null;
  }
  function setDensity(px) {
    if (!(px > 0)) { syncFields(); return; }
    edit('Set texel density', () => {
      const A = areasOfIslands(), U = data.UV, moved = new Uint8Array(data.verts);
      for (const i of A.ids) {
        if (!(A.a3[i] > 0 && A.au[i] > 0)) continue;
        const k = px / (Math.sqrt(A.au[i] / A.a3[i]) * texSize()), b = boxOf(A.lists[i]), cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2;
        for (const v of A.lists[i]) { if (moved[v]) continue; moved[v] = 1; U[2 * v] = cu + (U[2 * v] - cu) * k; U[2 * v + 1] = cv + (U[2 * v + 1] - cv) * k; }
      }
    }, false);
  }
  let tdTimer = 0;
  function tdSoon() { if (tdTimer) return; tdTimer = setTimeout(() => { tdTimer = 0; const el = $i('uv-f-td'); if (!el || document.activeElement === el) return; const v = on ? densityNow() : null; el.disabled = v == null; el.value = v == null ? '' : (v >= 100 ? Math.round(v) : +v.toPrecision(3)).toString(); }, 140); }
  // ── relax: the picked points (all when nothing is picked) move to where the edges on the UV layout are as long as they are on the surface ──
  function relax() {
    edit('Relax UVs', () => {
      const P = data.P, U = data.UV, I = data.I, Wd = data.weld, nW = data.nW, moving = new Uint8Array(nW);
      if (anySel()) { for (let i = 0; i < sel.length; i++) if (sel[i]) moving[Wd[i]] = 1; } else moving.fill(1);
      const gu = new Float64Array(nW), gv = new Float64Array(nW), gp = new Float64Array(nW * 3), old = new Float64Array(nW * 2);
      for (let w = 0; w < nW; w++) { const v = data.gList[data.gOff[w]]; gu[w] = old[2 * w] = U[2 * v]; gv[w] = old[2 * w + 1] = U[2 * v + 1]; gp[3 * w] = P[3 * v]; gp[3 * w + 1] = P[3 * v + 1]; gp[3 * w + 2] = P[3 * v + 2]; }
      const seen = new Set(), ea = [], eb = [], el = [];
      for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
        const a = Wd[I[t + k]], b = Wd[I[t + (k + 1) % 3]]; if (a === b || (!moving[a] && !moving[b])) continue;
        const key = a < b ? a * nW + b : b * nW + a; if (seen.has(key)) continue; seen.add(key);
        ea.push(a); eb.push(b); el.push(Math.hypot(gp[3 * a] - gp[3 * b], gp[3 * a + 1] - gp[3 * b + 1], gp[3 * a + 2] - gp[3 * b + 2]));
      }
      const E = ea.length; if (!E) return;
      const ratios = []; for (let e = 0; e < E; e++) if (el[e] > 0) ratios.push(Math.hypot(gu[ea[e]] - gu[eb[e]], gv[ea[e]] - gv[eb[e]]) / el[e]);
      ratios.sort((x, y) => x - y); const sc = ratios.length ? ratios[ratios.length >> 1] : 1;
      const du = new Float64Array(nW), dv = new Float64Array(nW), cnt = new Int32Array(nW);
      for (let it = 0; it < 40; it++) {
        du.fill(0); dv.fill(0); cnt.fill(0);
        for (let e = 0; e < E; e++) {
          const a = ea[e], b = eb[e], dx = gu[b] - gu[a], dy = gv[b] - gv[a], cur = Math.hypot(dx, dy) || 1e-12, f = (cur - sc * el[e]) / cur * 0.5;
          if (moving[a]) { du[a] += dx * f; dv[a] += dy * f; cnt[a]++; } if (moving[b]) { du[b] -= dx * f; dv[b] -= dy * f; cnt[b]++; }
        }
        for (let w = 0; w < nW; w++) if (cnt[w]) { gu[w] += du[w] / cnt[w]; gv[w] += dv[w] / cnt[w]; }
      }
      // the relaxing drifts: each island keeps the middle of its moving points where it was
      const { ids, lists } = islandSets(), done = new Uint8Array(data.verts);
      for (const i of ids) {
        let n = 0, ou = 0, ov = 0, nu = 0, nv = 0;
        for (const v of lists[i]) { const w = Wd[v]; if (!moving[w]) continue; ou += old[2 * w]; ov += old[2 * w + 1]; nu += gu[w]; nv += gv[w]; n++; }
        if (!n) continue; const sx = (ou - nu) / n, sy = (ov - nv) / n;
        for (const v of lists[i]) { const w = Wd[v]; if (!moving[w] || done[v]) continue; done[v] = 1; U[2 * v] = gu[w] + sx; U[2 * v + 1] = gv[w] + sy; }
      }
    }, false);
  }

  // ── projection, as in Cinema 4D's UV Projection ──
  //   Cubic     every face from the side it looks toward, the six sides laid out in a cross (three across, two down) so none lies on another
  //   Box       the same sides, all in the same square (they lie on each other, as a texture repeated on each side of a box does)
  //   Shrink    from a pole: the angle round the axis is the angle on the picture, the distance from the pole the distance from its middle
  //   Sphere    longitude across, latitude down (twice as wide as it is tall when the aspect is kept)
  //   Cylinder  the angle round the axis across, the height down
  //   View      as the 3D view sees the parts now
  //   Axis      flat, looking along the chosen axis
  // Cubic and Box give a vertex to each side that uses it, so they rebuild the parts (as Unwrap does) and take the whole parts; the others
  // set the UVs of the picked points (all of them when nothing is picked). Preserve aspect keeps the proportions of what is projected.
  const PROJ = { type: _Prefs.get('uvsplit.ptype') || 'cubic', axis: _Prefs.get('uvsplit.paxis') || 'y', aspect: _Prefs.get('uvsplit.paspect') !== false };
  const WHOLE = { cubic: 1, box: 1 }, NOTES = {
    cubic: 'Each side of the part on its own place in the square, in a cross. It rebuilds the vertices of the whole part, and keeps no other UV set.',
    box: 'Each side in the same square, lying on each other: for a texture that repeats on every side. It rebuilds the vertices of the whole part.',
    shrink: 'From a pole round the axis, as if a cloth were drawn over the part from that end.', sphere: 'Longitude across, latitude down, round the axis.',
    cylinder: 'The angle round the axis across, the height down. The seam is where the angle starts.', view: 'As the 3D view shows the parts now: turn the view first.', axis: 'Flat, looking along the axis.',
  };
  function syncProj() {
    $i('uv-proj-type').value = PROJ.type;
    for (const b of $i('uv-proj-axis').querySelectorAll('button')) { b.classList.toggle('active', b.dataset.a === PROJ.axis); b.disabled = !['shrink', 'sphere', 'cylinder', 'axis'].includes(PROJ.type); if (b.dataset.a === PROJ.axis) $i('uv-proj-axis').style.setProperty('--seg-i', ['x', 'y', 'z'].indexOf(PROJ.axis)); }
    $i('uv-proj-pa').checked = PROJ.aspect; $i('uv-proj-pa').disabled = PROJ.type === 'shrink';
    $i('uv-proj-note').textContent = NOTES[PROJ.type] + (WHOLE[PROJ.type] ? '' : ' It sets the picked points' + (anySel() ? '.' : ' (nothing is picked: all of them).'));
  }
  function openProj() { if (!data || !(data.UV || data.unwrapOnly)) { toast('UV layout', 'Select a part first', 'info', 2500); return; } $i('uv-proj-pop').hidden = false; syncProj(); }
  const closeProj = () => { $i('uv-proj-pop').hidden = true; };
  $i('uv-proj-x').addEventListener('click', closeProj);
  $i('uv-proj-type').addEventListener('change', (e) => { PROJ.type = e.target.value; _Prefs.set('uvsplit.ptype', PROJ.type); syncProj(); });
  for (const b of $i('uv-proj-axis').querySelectorAll('button')) b.addEventListener('click', () => { if (b.disabled) return; PROJ.axis = b.dataset.a; _Prefs.set('uvsplit.paxis', PROJ.axis); syncProj(); });
  $i('uv-proj-pa').addEventListener('change', (e) => { PROJ.aspect = !!e.target.checked; _Prefs.set('uvsplit.paspect', PROJ.aspect); });
  $i('uv-proj-go').addEventListener('click', () => { if (WHOLE[PROJ.type]) projectWhole(PROJ.type); else projectPoints(PROJ.type); });
  // (p1, p2, up) of a point for the chosen axis as the one that points up
  const frame = (axis, x, y, z) => (axis === 'x' ? [y, z, x] : axis === 'z' ? [x, y, z] : [x, z, y]);
  // fits the raw numbers into the square: kept in proportion (and in the middle) or stretched to fill it
  function fitRaw(idx, raw, aspect) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < idx.length; k++) { const a = raw[2 * k], b = raw[2 * k + 1]; if (a < u0) u0 = a; if (a > u1) u1 = a; if (b < v0) v0 = b; if (b > v1) v1 = b; }
    const w = Math.max(u1 - u0, 1e-9), h = Math.max(v1 - v0, 1e-9), k0 = 1 / Math.max(w, h), U = data.UV;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      if (aspect) { U[2 * i] = 0.5 + (raw[2 * k] - (u0 + u1) / 2) * k0; U[2 * i + 1] = 0.5 + (raw[2 * k + 1] - (v0 + v1) / 2) * k0; }
      else { U[2 * i] = (raw[2 * k] - u0) / w; U[2 * i + 1] = (raw[2 * k + 1] - v0) / h; }
    }
  }
  function projectPoints(type) {
    edit('Project UVs', () => {
      const idx = anySel() ? selIndices() : Array.from({ length: data.verts }, (_, i) => i), P = data.P, U = data.UV, raw = new Float64Array(idx.length * 2), ax = PROJ.axis;
      if (type === 'view') {
        const cam = getCamera && getCamera(); if (!cam) { toast('UV layout', 'There is no view to project from', 'warn', 3000); return; }
        cam.updateMatrixWorld(); const v = new THREE.Vector3();
        for (const pt of data.parts) {
          const pa = pt.g.attributes.position, mw = pt.p.mesh ? pt.p.mesh.matrixWorld : null;
          idx.forEach((i, k) => { if (i < pt.vo || i >= pt.vo + pt.vc) return; v.fromBufferAttribute(pa, i - pt.vo); if (mw) v.applyMatrix4(mw); v.project(cam); raw[2 * k] = v.x; raw[2 * k + 1] = -v.y; });
        }
        fitRaw(idx, raw, PROJ.aspect); return;
      }
      let rSum = 0, up0 = Infinity, up1 = -Infinity;
      idx.forEach((i, k) => {
        const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
        if (type === 'axis') { if (ax === 'x') { raw[2 * k] = -z; raw[2 * k + 1] = -y; } else if (ax === 'y') { raw[2 * k] = x; raw[2 * k + 1] = z; } else { raw[2 * k] = x; raw[2 * k + 1] = -y; } return; }
        const [p1, p2, up] = frame(ax, x, y, z), r = Math.hypot(p1, p2, up);
        rSum += Math.hypot(p1, p2); if (up < up0) up0 = up; if (up > up1) up1 = up;
        const az = Math.atan2(p2, p1);
        if (type === 'cylinder') { raw[2 * k] = az / (2 * Math.PI) + 0.5; raw[2 * k + 1] = -up; }
        else if (type === 'sphere') { raw[2 * k] = az / (2 * Math.PI) + 0.5; raw[2 * k + 1] = Math.acos(Math.max(-1, Math.min(1, up / (r || 1)))) / Math.PI; }
        else { const rr = Math.acos(Math.max(-1, Math.min(1, up / (r || 1)))) / Math.PI; raw[2 * k] = 0.5 + 0.5 * rr * Math.cos(az); raw[2 * k + 1] = 0.5 + 0.5 * rr * Math.sin(az); }
      });
      if (type === 'axis') { fitRaw(idx, raw, PROJ.aspect); return; }
      if (type === 'shrink') { idx.forEach((i, k) => { U[2 * i] = raw[2 * k]; U[2 * i + 1] = raw[2 * k + 1]; }); return; }
      if (type === 'sphere') { idx.forEach((i, k) => { U[2 * i] = raw[2 * k]; U[2 * i + 1] = PROJ.aspect ? 0.5 + (raw[2 * k + 1] - 0.5) * 0.5 : raw[2 * k + 1]; }); return; }
      // cylinder: the height in proportion to the way round (the radius is the mean), or stretched over the whole height
      const height = Math.max(up1 - up0, 1e-9), circ = 2 * Math.PI * Math.max(rSum / idx.length, 1e-9);
      if (PROJ.aspect) {
        const ext = height / circ, k0 = ext > 1 ? 1 / ext : 1;
        idx.forEach((i, k) => { U[2 * i] = 0.5 + (raw[2 * k] - 0.5) * k0; U[2 * i + 1] = 0.5 + ((raw[2 * k + 1] + up1) / height - 0.5) * ext * k0; });
      } else idx.forEach((i, k) => { U[2 * i] = raw[2 * k]; U[2 * i + 1] = (raw[2 * k + 1] + up1) / height; });
    }, false);
  }
  // Cubic and Box: a vertex for each (vertex, side), so the parts are rebuilt on it (the geometry's undo step, as Unwrap)
  async function projectWhole(type) {
    const ids = [...(state.selected || [])].filter(livePart), parts = [], seenG = new Set();
    for (const id of ids) { const p = livePart(id); if (!p.mesh) continue; const g = p.mesh.geometry; if (seenG.has(g) || !g.attributes.position) continue; seenG.add(g); parts.push({ p, g }); }
    if (!parts.length) { toast('UV layout', 'Select a part first', 'info', 2500); return; }
    const lays = parts.map(({ g }) => {
      const pa = g.attributes.position, nT = (g.index ? g.index.count : pa.count) / 3, ix = g.index ? g.index.array : null, pos = (v, k) => pa.getComponent(v, k);
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < pa.count; v++) for (let k = 0; k < 3; k++) { const c = pos(v, k); if (c < lo[k]) lo[k] = c; if (c > hi[k]) hi[k] = c; }
      const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], M = Math.max(...ext, 1e-9), map = new Map(), src = [], uv = [], idxOut = new Uint32Array(nT * 3);
      // (face number: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z, by the biggest part of the triangle's normal)
      const CELL = [[2, 0], [1, 0], [0, 0] /* unused */];
      const place = (f, x, y, z) => {                      // the flat coordinates of a point on side f, in part units (u across, v down)
        if (f === 4) return [x, -y]; if (f === 5) return [-x, -y]; if (f === 0) return [-z, -y]; if (f === 1) return [z, -y]; if (f === 2) return [x, z]; return [x, -z];
      };
      const CROSS = [[1, 0], [0, 1], [1, 1], [2, 1], [0, 0], [2, 0]];             // (the cell of each side: right, left, top, bottom, front, back)
      for (let t = 0; t < nT; t++) {
        const c = [0, 1, 2].map(k => (ix ? ix[3 * t + k] : 3 * t + k)), p = c.map(v => [pos(v, 0), pos(v, 1), pos(v, 2)]);
        const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], an = n.map(Math.abs);
        const axis = an[0] >= an[1] && an[0] >= an[2] ? 0 : an[1] >= an[2] ? 1 : 2, f = axis * 2 + (n[axis] >= 0 ? 0 : 1);
        for (let k = 0; k < 3; k++) {
          const key = c[k] * 6 + f; let nv = map.get(key);
          if (nv === undefined) {
            nv = src.length; map.set(key, nv); src.push(c[k]);
            const [a, b] = place(f, p[k][0] - lo[0], p[k][1] - lo[1], p[k][2] - lo[2]);
            // (the sides keep one scale, so the texels are the same on all of them; stretched to fill when the aspect is not kept)
            let u, v;
            if (type === 'cubic') { const cell = CROSS[f]; u = (cell[0] + (a + (f === 5 || f === 0 ? ext[0] || ext[2] : 0) * 0) / M + (PROJ.aspect ? 0 : 0)) / 3; v = (cell[1] + b / M + 1) / 3; u = (cell[0] * M + ((f === 5 ? a + ext[0] : f === 0 ? a + ext[2] : a))) / (3 * M); v = (cell[1] * M + ((f === 4 || f === 5 || f === 0 || f === 1) ? b + ext[1] : f === 2 ? b : b + ext[2])) / (3 * M); }
            else { const wA = f < 2 ? ext[2] : ext[0], hA = f < 2 ? ext[1] : f < 4 ? ext[2] : ext[1]; const aa = (f === 5 ? a + ext[0] : f === 0 ? a + ext[2] : a), bb = (f === 4 || f === 5 || f === 0 || f === 1) ? b + ext[1] : f === 2 ? b : b + ext[2]; u = PROJ.aspect ? aa / M : aa / Math.max(wA, 1e-9); v = PROJ.aspect ? bb / M : bb / Math.max(hA, 1e-9); }
            uv.push(u, v);
          }
          idxOut[3 * t + k] = nv;
        }
      }
      return { vertexSrc: Uint32Array.from(src), index: idxOut, uv: Float32Array.from(uv) };
    });
    swapGeometries(parts.map(x => x.p), parts.map(x => x.g), lays, 'Project UVs (' + type + ')');
    toast('UV layout', 'Projected ' + fmtNum(parts.length) + (parts.length === 1 ? ' part' : ' parts') + ' (' + type + ')', 'success', 3000);
  }
  // the parts' geometries replaced by ones built on the layouts: one undo step (the Decimate kind)
  function swapGeometries(ps, gs, lays, label) {
    const items = [];
    ps.forEach((p, i) => {
      let src = gs[i];
      if (!src.index) { const n = src.attributes.position.count, I = new Uint32Array(n); for (let k = 0; k < n; k++) I[k] = k; src = src.clone(); src.setIndex(new THREE.BufferAttribute(I, 1)); }
      const out = layoutGeometry(src, lays[i]), before = _decSnap(p);
      p.mesh.geometry = _stampGeometry(out);
      p.hash = 'uw_' + p.partId + '_' + (state._decSeq = (state._decSeq | 0) + 1);
      state.geomByHash.set(p.hash, out);
      p.triCount = out.index.count / 3; p.vertCount = out.attributes.position.count;
      _refreshPartBBox(p); p._fp = null; p._fpKey = null;
      try { _cadEdgesPartSwapped(p); } catch (_) {}
      items.push({ partId: p.partId, before, after: _decSnap(p) });
    });
    if (items.length) { pushUndo({ type: 'decimate', label, items }); try { settle(); } catch (_) {} }
    sel = new Uint8Array(0); keyIds = ''; fitted = false; lastSig = ''; refresh();
  }
  // Unwrap: the parts cut and flattened again (bake.js), all of them on one square. Their vertices are rebuilt, so this is a change of the
  // geometry (the same undo step as Decimate's), not only of the UVs.
  async function unwrap() {
    const ids = [...(state.selected || [])].filter(livePart);
    const parts = []; const seenG = new Set();
    for (const id of ids) { const p = livePart(id); if (!p.mesh) continue; const g = p.mesh.geometry; if (seenG.has(g) || !g.attributes.position) continue; seenG.add(g); parts.push({ p, g }); }
    if (!parts.length) { toast('UV layout', 'Select a part first', 'info', 2500); return; }
    const work = parts.map(({ p, g }) => {
      p.mesh.updateWorldMatrix(true, false);
      const w = p.mesh.getWorldScale(new p.mesh.scale.constructor()), scale = Math.cbrt(Math.abs(w.x * w.y * w.z)) || 1, pa = g.attributes.position, P = new Float32Array(pa.count * 3);
      for (let v = 0; v < pa.count; v++) { P[3 * v] = pa.getX(v); P[3 * v + 1] = pa.getY(v); P[3 * v + 2] = pa.getZ(v); }
      let I; if (g.index) I = Uint32Array.from(g.index.array); else { I = new Uint32Array(pa.count); for (let i = 0; i < pa.count; i++) I[i] = i; }
      return { p, g, P, I, scale };
    });
    const lay = unwrapParts(work.map(w => ({ P: w.P, I: w.I, scale: w.scale })), { size: 2048, pad: 4, maxAngle: opt.angle });
    if (!lay.density) { toast('UV layout', 'The parts could not be unwrapped: ' + (lay.why || 'nothing to lay out'), 'warn', 4000); return; }
    const items = [];
    work.forEach((w, i) => {
      if (!lay.parts[i]) return;
      let src = w.g;
      if (!src.index) { src = w.g.clone(); src.setIndex(new THREE.BufferAttribute(w.I, 1)); }
      const out = layoutGeometry(src, lay.parts[i]);
      const before = _decSnap(w.p);
      w.p.mesh.geometry = _stampGeometry(out);
      w.p.hash = 'uw_' + w.p.partId + '_' + (state._decSeq = (state._decSeq | 0) + 1);
      state.geomByHash.set(w.p.hash, out);
      w.p.triCount = out.index.count / 3; w.p.vertCount = out.attributes.position.count;
      _refreshPartBBox(w.p); w.p._fp = null; w.p._fpKey = null;
      try { _cadEdgesPartSwapped(w.p); } catch (_) {}
      items.push({ partId: w.p.partId, before, after: _decSnap(w.p) });
    });
    if (items.length) { pushUndo({ type: 'decimate', label: 'Unwrap UVs', items }); try { settle(); } catch (_) {} }
    sel = new Uint8Array(0); keyIds = ''; fitted = false; lastSig = ''; refresh();
    toast('UV layout', 'Unwrapped ' + fmtNum(items.length) + (items.length === 1 ? ' part' : ' parts') + ' into ' + fmtNum(lay.charts) + ' pieces, ' + pct(lay.used) + ' of the square used', 'success', 3500);
  }

  // ── the transform tools: drag anywhere ──
  let tx = null;                                              // the drag in progress
  function beginTransform(e, rect) {
    const bb = selBox(); if (!bb) return null;
    const idx = selIndices(), base = new Float32Array(idx.length * 2);
    idx.forEach((i, k) => { base[2 * k] = data.UV[2 * i]; base[2 * k + 1] = data.UV[2 * i + 1]; });
    const [cx, cy] = toPx(bb.cu, bb.cv);
    const tl = [], rl = [], I = data.I, R = data.rim;
    for (let t = 0; t < I.length; t += 3) if (sel[I[t]] || sel[I[t + 1]] || sel[I[t + 2]]) tl.push(t / 3);
    for (let q = 0; q < R.length; q += 2) if (sel[R[q]] || sel[R[q + 1]]) rl.push(q);
    return { kind: opt.tool, idx, base, bb, before: snap(), tris: Int32Array.from(tl), rims: Int32Array.from(rl), ver: dataVer, px: e.clientX - rect.left, py: e.clientY - rect.top, cxp: cx, cyp: cy, a0: Math.atan2(e.clientY - rect.top - cy, e.clientX - rect.left - cx), d0: Math.max(8, Math.hypot(e.clientX - rect.left - cx, e.clientY - rect.top - cy)), moved: false };
  }
  function runTransform(e, rect) {
    const t = tx, mx = e.clientX - rect.left, my = e.clientY - rect.top, U = data.UV;
    let f;
    if (t.kind === 'move') {
      let du = (mx - t.px) / view.s, dv = (my - t.py) / view.s;
      if (e.shiftKey) { if (Math.abs(du) > Math.abs(dv)) dv = 0; else du = 0; }
      if (opt.snap) { const step = 1 / opt.grid; du = Math.round((t.bb.u0 + du) / step) * step - t.bb.u0; dv = Math.round((t.bb.v0 + dv) / step) * step - t.bb.v0; }
      f = (u, v) => [u + du, v + dv];
    } else if (t.kind === 'rotate') {
      let a = Math.atan2(my - t.cyp, mx - t.cxp) - t.a0;
      if (e.shiftKey || opt.snap) { const q = 15 * Math.PI / 180; a = Math.round(a / q) * q; }
      const c = Math.cos(a), s = Math.sin(a);
      f = (u, v) => { const x = u - t.bb.cu, y = v - t.bb.cv; return [t.bb.cu + x * c - y * s, t.bb.cv + x * s + y * c]; };
    } else {
      const k = Math.max(0.01, Math.hypot(mx - t.cxp, my - t.cyp) / t.d0);
      f = (u, v) => [t.bb.cu + (u - t.bb.cu) * k, t.bb.cv + (v - t.bb.cv) * k];
    }
    t.idx.forEach((i, k) => { const [u, v] = f(t.base[2 * k], t.base[2 * k + 1]); U[2 * i] = u; U[2 * i + 1] = v; });
    t.moved = true; touched(); syncFieldsSoon(); draw();
  }
  function endTransform(cancel) {
    const t = tx; tx = null; if (!t || !t.moved) return;
    if (cancel) { data.UV.set(t.before); data.coverStale = false; touched(); draw(); return; }
    const label = t.kind === 'move' ? 'Move UVs' : t.kind === 'rotate' ? 'Rotate UVs' : 'Scale UVs';
    const nosOk = nosKey === nosKeyFor(t.ver);
    if (commit(t.before, label)) { if (nosOk) adoptBase(t); scheduleRefresh(); }
    syncFields(); draw();
  }

  // ── wheel, drag, pick ──
  let drag = null, pick = null;
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, { W, H } = sizeNow();
    const u = (mx - W / 2) / view.s + view.cx, v = (my - H / 2) / view.s + view.cy;
    const k = Math.exp(-Math.max(-300, Math.min(300, e.deltaY)) * 0.0015);
    userView = true; moving();
    view.s = Math.max(5, Math.min(2e5, view.s * k));
    view.cx = u - (mx - W / 2) / view.s; view.cy = v - (my - H / 2) / view.s;
    draw();
  }, { passive: false });
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId); cv.focus({ preventScroll: true }); e.preventDefault(); hover = null;
    const rect = cv.getBoundingClientRect();
    if (e.button === 1 || e.button === 2 || e.altKey || !data || !data.UV) { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, button: e.button, moved: false }; cv.classList.add('is-drag'); return; }
    if (e.button !== 0) return;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    pick = { x, y, e, moved: false };
    if (opt.tool !== 'select' && anySel()) { tx = beginTransform(e, rect); if (tx) data.coverStale = true; }
  });
  cv.addEventListener('pointermove', (e) => {
    const rect = cv.getBoundingClientRect();
    if (drag) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true; moving(); view.cx = drag.cx - (e.clientX - drag.x) / view.s; view.cy = drag.cy - (e.clientY - drag.y) / view.s; draw(); return; }
    if (!pick) return;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (!pick.moved && Math.hypot(x - pick.x, y - pick.y) > 4) pick.moved = true;
    if (!pick.moved) return;
    if (tx) runTransform(e, rect);
    else if (opt.tool === 'select') { band = { x0: pick.x, y0: pick.y, x1: x, y1: y }; draw(); }
    else { band = { x0: pick.x, y0: pick.y, x1: x, y1: y }; draw(); }
  });
  const up = (e) => {
    try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
    if (drag) {
      const d = drag; drag = null; cv.classList.remove('is-drag');
      if (d.moved) userView = true;
      else if (d.button === 2) { const r = cv.getBoundingClientRect(); openMenu(e.clientX, e.clientY, e.clientX - r.left, e.clientY - r.top); }     // (a right click that did not drag)
      return;
    }
    if (!pick) return;
    const p = pick; pick = null;
    if (tx) { if (p.moved) { endTransform(false); return; } tx = null; if (data) data.coverStale = false; }
    if (!data || !data.UV) { band = null; return; }
    if (p.moved && band) { const b = band; band = null; boxSelect(b, p.e); }
    else { band = null; const ids = pickAt(p.x, p.y); if (ids.length) combine(ids, p.e); else if (!p.e.shiftKey && !p.e.ctrlKey && !p.e.metaKey) sel.fill(0); }
    syncTools(); draw();
  };
  cv.addEventListener('pointermove', (e) => {
    if (drag || pick || tx || !data || !data.UV) return;
    const r = cv.getBoundingClientRect(); hoverAt = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0; if (!hoverAt || !data || !data.UV || data.tris > 250000) return;
      const ids = opt.mode === 'point' || opt.mode === 'edge' ? pickAt(hoverAt.x, hoverAt.y) : []; const next = ids.length ? { mode: opt.mode, ids } : null;
      if (!hover && !next) return; hover = next; draw();
    });
  });
  cv.addEventListener('pointerleave', () => { hoverAt = null; if (hover) { hover = null; draw(); } });
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', (e) => { if (tx) endTransform(true); drag = null; pick = null; band = null; cv.classList.remove('is-drag'); try { cv.releasePointerCapture(e.pointerId); } catch (_) {} draw(); });
  cv.addEventListener('dblclick', () => { fit(); draw(); });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  // The view's own right-click menu listens on the document, in the capture phase: this one, on the window, comes before it and keeps it
  // from opening over the layout (a field of the toolbar keeps the browser's own).
  window.addEventListener('contextmenu', (e) => {
    if (!on || !pane.contains(e.target)) return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    e.preventDefault(); e.stopPropagation();
  }, true);
  // The right-click menu: what can be done here, with what is under the pointer first. The names and the keys are the toolbar's.
  function openMenu(cx, cy, px, py) {
    if (!ctxMenu) return;
    const has = !!(data && data.UV), picked = has && anySel(), noUv = has ? false : 'The selected parts have no texture coordinates', needPick = noUv || (picked ? false : 'Pick something first');
    const run = (f) => () => { f(); syncTools(); draw(); };
    const items = [];
    if (has) {
      const isl = pickAt(px, py, 'island'), fc = pickAt(px, py, 'face');
      if (isl.length) {
        items.push({ label: 'Pick this island', icon: 'shapes', fn: run(() => { sel.fill(0); for (const i of isl) setVertex(i, 1); }) });
        items.push({ label: 'Add this island to the pick', fn: run(() => { for (const i of isl) setVertex(i, 1); }) });
        items.push({ label: 'Pick this face', icon: 'triangle', fn: run(() => { sel.fill(0); for (const i of fc) setVertex(i, 1); }) });
        items.push('---');
      }
    }
    const tick = (on2, label) => (on2 ? '✓ ' : '   ') + label;
    items.push(
      { label: 'Pick all', kbd: 'Ctrl+A', off: noUv, fn: selectAll }, { label: 'Pick none', kbd: 'Esc', off: noUv, fn: selectNone }, { label: 'Invert the pick', kbd: 'Ctrl+I', off: noUv, fn: invert },
      { label: 'Grow the pick', off: needPick, fn: grow }, { label: 'Shrink the pick', off: needPick, fn: shrink },
      '---',
      { label: 'Flip across', icon: 'flip-horizontal-2', off: needPick, fn: flipH }, { label: 'Flip down', icon: 'flip-vertical-2', off: needPick, fn: flipV },
      { label: 'Turn a quarter forward', icon: 'rotate-cw', off: needPick, fn: () => turn(90) }, { label: 'Turn a quarter back', icon: 'rotate-ccw', off: needPick, fn: () => turn(-90) },
      { label: 'Align to the square', icon: 'align-horizontal-justify-center', off: needPick, sub: [
        { label: 'Left', fn: () => align('left') }, { label: 'Middle, across', fn: () => align('center') }, { label: 'Right', fn: () => align('right') },
        { label: 'Top', fn: () => align('top') }, { label: 'Middle, down', fn: () => align('middle') }, { label: 'Bottom', fn: () => align('bottom') } ] },
      '---',
      { label: 'Arrange', icon: 'align-horizontal-distribute-center', off: noUv, sub: [
        { label: 'Distribute across', fn: () => distribute('h') }, { label: 'Distribute down', fn: () => distribute('v') }, { label: 'Orient islands (tightest box)', fn: orient },
        { label: 'Line up across', off: needPick, fn: () => lineUp('h') }, { label: 'Line up down', off: needPick, fn: () => lineUp('v') }, { label: 'Relax', fn: relax } ] },
      { label: 'Pick problems', icon: 'scan-search', off: noUv, sub: [{ label: 'Mirrored faces', fn: () => pickFlipped() }, { label: 'Stretched faces', fn: () => pickStretched() }] },
      { label: 'Pack the islands', icon: 'layout-grid', off: noUv, fn: pack }, { label: 'Fit into the square', icon: 'maximize', off: noUv, fn: fitSquare },
      { label: 'Even out the texel density', icon: 'gauge', off: noUv, fn: density },
      { label: 'Unwrap the parts', icon: 'wand-sparkles', off: data && (data.UV || data.unwrapOnly) ? false : 'Select a part first', fn: unwrap },
      { label: 'Project…', icon: 'axis-3d', off: data && (data.UV || data.unwrapOnly) ? false : 'Select a part first', fn: openProj },
      '---',
      { label: 'Pick mode', sub: [['point', 'Points', '1'], ['edge', 'Edges', '2'], ['face', 'Faces', '3'], ['island', 'Islands', '4']].map(([m, l, k]) => ({ label: tick(opt.mode === m, l), kbd: k, fn: () => setMode(m) })) },
      { label: 'Tool', sub: [['select', 'Select', 'Q'], ['move', 'Move', 'W'], ['rotate', 'Rotate', 'E'], ['scale', 'Scale', 'R']].map(([t, l, k]) => ({ label: tick(opt.tool === t, l), kbd: k, fn: () => setTool(t) })) },
      { label: 'View', sub: [
        { label: 'Fit the view', kbd: 'F', fn: () => { fit(); draw(); } },
        ...[['none', 'No picture'], ['map', 'Colour picture'], ['normal', 'Normal picture'], ['ao', 'Occlusion picture']].map(([k, l]) => ({ label: tick(opt.bg === k, l), off: k === 'none' || pictureOf(k) ? false : 'The part has no such map', fn: () => { opt.bg = k; _Prefs.set('uvsplit.bg', k); syncBg(); draw(); } })),
        { label: tick(opt.lines, 'Triangle edges'), fn: () => { opt.lines = !opt.lines; _Prefs.set('uvsplit.lines', opt.lines); syncBg(); draw(); } },
        { label: tick(opt.overlap, 'Overlap colouring'), fn: () => { opt.overlap = !opt.overlap; _Prefs.set('uvsplit.overlap', opt.overlap); syncBg(); draw(); } },
        { label: tick(opt.checker, 'Checker'), fn: () => { opt.checker = !opt.checker; _Prefs.set('uvsplit.checker', opt.checker); syncBg(); draw(); } },
        { label: tick(opt.snap, 'Snap to the grid'), fn: () => { opt.snap = !opt.snap; _Prefs.set('uvsplit.snap', opt.snap); syncTools(); draw(); } } ] },
    );
    ctxMenu(items, cx, cy);
  }
  const TOOL_KEYS = { q: 'select', w: 'move', e: 'rotate', r: 'scale' }, MODE_KEYS = { 1: 'point', 2: 'edge', 3: 'face', 4: 'island' };
  document.addEventListener('keydown', (e) => {
    if (!on || e.altKey) return;
    const t = e.target; if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    if (!pane.matches(':hover') && document.activeElement !== cv) return;       // (these keys are the 3D view's own: they are the layout's only while the pointer is over it)
    const k = e.key.toLowerCase(); let used = true;
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
    else if (!e.ctrlKey && !e.metaKey && !e.shiftKey && MODE_KEYS[k]) setMode(MODE_KEYS[k]);
    else if ((e.ctrlKey || e.metaKey) && k === 'a') selectAll();
    else if ((e.ctrlKey || e.metaKey) && k === 'i') invert();
    else if (k === 'escape' && anySel()) selectNone();
    else if (k === 'f' && !e.ctrlKey && !e.metaKey) { fit(); draw(); }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ── the toolbar ──
  const FIELDS = { u: 'uv-f-u', v: 'uv-f-v', w: 'uv-f-w', h: 'uv-f-h' };
  const fmt = (x) => (Math.abs(x) < 1e-9 ? 0 : +x.toFixed(4)).toString();
  // (the numbers of the toolbar while the points are dragged: written a few times a second, not on every move; each write makes the page work
  // out its styles again, which costs far more than the move)
  let fieldsTimer = 0;
  function syncFieldsSoon() { if (fieldsTimer) return; fieldsTimer = setTimeout(() => { fieldsTimer = 0; syncFields(); }, 140); }
  function syncFields() {
    const bb = data && data.UV ? selBox() : null;
    for (const [k, id] of Object.entries(FIELDS)) { const el = $i(id); if (!el || document.activeElement === el) continue; el.disabled = !bb; el.value = bb ? fmt(k === 'u' ? bb.cu : k === 'v' ? bb.cv : k === 'w' ? bb.w : bb.h) : ''; }
  }
  function syncTools() {
    selVer++; selAny = !!(data && data.UV) && anySel();
    for (const b of pane.querySelectorAll('[data-tool]')) { const on2 = b.dataset.tool === opt.tool; b.classList.toggle('active', on2); b.setAttribute('aria-pressed', String(on2)); }
    for (const b of pane.querySelectorAll('[data-mode]')) { const on2 = b.dataset.mode === opt.mode; b.classList.toggle('active', on2); b.setAttribute('aria-pressed', String(on2)); }
    const ok = !!(data && data.UV), picked = ok && anySel();
    for (const b of pane.querySelectorAll('[data-needs="sel"]')) b.disabled = !picked;
    for (const b of pane.querySelectorAll('[data-needs="uv"]')) b.disabled = !ok;
    for (const b of pane.querySelectorAll('[data-needs="part"]')) b.disabled = !(ok || (data && data.unwrapOnly));
    for (const [id, k] of [['uv-stretch', 'stretch'], ['uv-packrot', 'packRot']]) { const b = $i(id); if (b) { b.classList.toggle('is-on', !!opt[k]); b.setAttribute('aria-pressed', String(!!opt[k])); } }
    tdSoon();
    $i('uv-lock').classList.toggle('is-on', opt.lock); $i('uv-lock').setAttribute('aria-pressed', String(opt.lock));
    $i('uv-snap').classList.toggle('is-on', opt.snap); $i('uv-snap').setAttribute('aria-pressed', String(opt.snap));
    $i('uv-grid').value = String(opt.grid); $i('uv-angle').value = String(opt.angle);
    const hint = { select: 'Pick: click or drag a box · Shift adds · Ctrl takes away', move: 'Drag to move · Shift keeps a direction', rotate: 'Drag to turn · Shift snaps to 15°', scale: 'Drag to scale' }[opt.tool];
    $i('uv-hint').textContent = hint;
    syncFields();
  }
  function setTool(t) { opt.tool = t; _Prefs.set('uvsplit.tool', t); cv.dataset.tool = t; syncTools(); draw(); }
  function setMode(m) { opt.mode = m; _Prefs.set('uvsplit.mode', m); syncTools(); draw(); }
  for (const b of pane.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  for (const b of pane.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
  const ACT = {
    all: selectAll, none: selectNone, invert, grow, shrink, flipH, flipV, rotL: () => turn(-90), rotR: () => turn(90), pack, fit: fitSquare, density, unwrap,
    'al-left': () => align('left'), 'al-center': () => align('center'), 'al-right': () => align('right'), 'al-top': () => align('top'), 'al-middle': () => align('middle'), 'al-bottom': () => align('bottom'),
    project: () => openProj(),
    'dist-h': () => distribute('h'), 'dist-v': () => distribute('v'), orient, 'line-h': () => lineUp('h'), 'line-v': () => lineUp('v'), relax,
    'pick-flipped': () => { if (data && data.UV) pickFlipped(); }, 'pick-stretched': () => { if (data && data.UV) pickStretched(); },
  };
  for (const b of pane.querySelectorAll('[data-act]')) b.addEventListener('click', () => { const f = ACT[b.dataset.act]; if (f) f(); b.blur(); });
  // the numbers: a value typed and entered is one undo step
  function setField(which, val) {
    const bb = selBox(); if (!bb || !Number.isFinite(val)) { syncFields(); return; }
    edit('Set UVs', () => {
      const U = data.UV;
      if (which === 'u' || which === 'v') { const du = which === 'u' ? val - bb.cu : 0, dv = which === 'v' ? val - bb.cv : 0; for (let i = 0; i < sel.length; i++) if (sel[i]) { U[2 * i] += du; U[2 * i + 1] += dv; } }
      else {
        const kx = which === 'w' ? (bb.w > 1e-9 ? val / bb.w : 1) : (opt.lock && bb.h > 1e-9 ? val / bb.h : 1), ky = which === 'h' ? (bb.h > 1e-9 ? val / bb.h : 1) : (opt.lock && bb.w > 1e-9 ? val / bb.w : 1);
        for (let i = 0; i < sel.length; i++) if (sel[i]) { U[2 * i] = bb.cu + (U[2 * i] - bb.cu) * kx; U[2 * i + 1] = bb.cv + (U[2 * i + 1] - bb.cv) * ky; }
      }
    });
  }
  for (const [k, id] of Object.entries(FIELDS)) {
    const el = $i(id);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setField(k, parseFloat(el.value.replace(',', '.'))); el.blur(); } else if (e.key === 'Escape') { el.blur(); syncFields(); } e.stopPropagation(); });
    el.addEventListener('change', () => setField(k, parseFloat(el.value.replace(',', '.'))));
  }
  $i('uv-turn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const d = parseFloat($i('uv-turn').value.replace(',', '.')); if (Number.isFinite(d) && d) turn(d); $i('uv-turn').blur(); } e.stopPropagation(); });
  for (const [id, k, key] of [['uv-stretch', 'stretch', 'uvsplit.stretch'], ['uv-packrot', 'packRot', 'uvsplit.packrot']]) $i(id).addEventListener('click', () => { opt[k] = !opt[k]; _Prefs.set(key, opt[k]); syncTools(); draw(); });
  $i('uv-f-td').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setDensity(parseFloat($i('uv-f-td').value.replace(',', '.'))); $i('uv-f-td').blur(); } else if (e.key === 'Escape') { $i('uv-f-td').blur(); tdSoon(); } e.stopPropagation(); });
  $i('uv-lock').addEventListener('click', () => { opt.lock = !opt.lock; _Prefs.set('uvsplit.lock', opt.lock); syncTools(); });
  $i('uv-snap').addEventListener('click', () => { opt.snap = !opt.snap; _Prefs.set('uvsplit.snap', opt.snap); syncTools(); draw(); });
  $i('uv-grid').addEventListener('change', (e) => { opt.grid = +e.target.value || 16; _Prefs.set('uvsplit.grid', opt.grid); draw(); });
  $i('uv-angle').addEventListener('change', (e) => { opt.angle = Math.max(10, Math.min(89, parseFloat(e.target.value) || 60)); _Prefs.set('uvsplit.angle', opt.angle); e.target.value = String(opt.angle); });
  for (const id of ['uv-angle', 'uv-turn']) $i(id).addEventListener('keydown', (e) => e.stopPropagation());

  // ── the pane's own controls, and the width of the split ──
  for (const b of pane.querySelectorAll('#uv-bg button')) b.addEventListener('click', () => { if (b.disabled) return; opt.bg = b.dataset.b; _Prefs.set('uvsplit.bg', opt.bg); syncBg(); draw(); });
  for (const [id, k] of [['uv-lines', 'lines'], ['uv-overlap', 'overlap'], ['uv-checker', 'checker']]) $i(id).addEventListener('click', () => { opt[k] = !opt[k]; _Prefs.set('uvsplit.' + k, opt[k]); syncBg(); draw(); });
  $i('uv-fit').addEventListener('click', () => { fit(); draw(); });
  $i('uv-close').addEventListener('click', () => toggle(false));
  const root = document.documentElement;
  const widthDefault = () => Math.round(Math.max(360, (window.innerWidth - 560) / 2));
  const setWidth = (w) => { w = Math.max(320, Math.min(window.innerWidth - 700, Math.round(w))); root.style.setProperty('--uv-w', w + 'px'); return w; };
  {
    const grip = $i('uv-grip'); let g0 = null;
    grip.addEventListener('pointerdown', (e) => { g0 = { x: e.clientX, w: pane.getBoundingClientRect().width }; grip.setPointerCapture(e.pointerId); document.getElementById('app')?.classList.add('resizing'); e.preventDefault(); });
    grip.addEventListener('pointermove', (e) => { if (!g0) return; setWidth(g0.w + (g0.x - e.clientX)); draw(); });
    const end = (e) => { if (!g0) return; g0 = null; document.getElementById('app')?.classList.remove('resizing'); try { grip.releasePointerCapture(e.pointerId); } catch (_) {} try { localStorage.setItem('uvSplitWidth', String(parseInt(getComputedStyle(root).getPropertyValue('--uv-w'), 10) || '')); } catch (_) {} try { onResize?.(); } catch (_) {} };
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', () => { setWidth(widthDefault()); try { localStorage.removeItem('uvSplitWidth'); } catch (_) {} setTimeout(() => { try { onResize?.(); } catch (_) {} draw(); }, 50); });
  }

  // ── on and off, with the pane sliding in and the viewport following it ──
  // While the columns move, the 3D view is resized with them (every other frame), so it is never stretched; the layout waits and is drawn
  // once, fitted, when the move is over.
  const follow = (ms) => { const t0 = performance.now(); let n = 0; const step = () => { if ((n++ & 1) === 0) { try { onResize?.(); } catch (_) {} } if (performance.now() - t0 < ms) requestAnimationFrame(step); else { try { onResize?.(); } catch (_) {} } }; requestAnimationFrame(step); };
  function toggle(want) {
    const next = want === undefined ? !on : !!want;
    if (next === on) return on;
    on = next; clearTimeout(animTimer);
    const btn = $i('tg-uv');
    if (btn) { btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', String(on)); }
    const calm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches), MS = calm ? 0 : 340;
    if (on) {
      leftWas = !document.body.classList.contains('left-collapsed');
      if (leftWas) _leftSidebarShow(false);
      let w = 0; try { w = parseInt(localStorage.getItem('uvSplitWidth') || '', 10); } catch (_) {}
      const target = w >= 320 ? w : widthDefault();
      anim = true; fitted = false; lastSig = '';
      root.style.setProperty('--uv-w', '0px');                  // (the column is there, empty, before it grows: the right sidebar does not jump)
      pane.hidden = false; document.body.classList.add('uv-split');
      void pane.offsetWidth;
      requestAnimationFrame(() => { setWidth(target); pane.classList.add('is-open'); follow(MS + 60); });
      if (window.ResizeObserver && !ro) { ro = new ResizeObserver(() => { if (!on) return; if (!userView) fit(); if (!anim) draw(); }); ro.observe(cv); }
      clearInterval(timer);
      timer = setInterval(() => { if (document.hidden || anim || drag || tx || pick) return; const s = sigOf([...(state.selected || [])]); if (s !== lastSig) refresh(true); }, 350);
      animTimer = setTimeout(() => { anim = false; fit(); refresh(true); draw(); }, MS + 40);
    } else {
      clearInterval(timer); timer = 0; token++; anim = true;
      pane.classList.remove('is-open'); root.style.setProperty('--uv-w', '0px');
      if (leftWas) _leftSidebarShow(true);
      follow(MS + 60);
      animTimer = setTimeout(() => {
        anim = false; pane.hidden = true; document.body.classList.remove('uv-split'); root.style.removeProperty('--uv-w');
        try { onResize?.(); } catch (_) {}
      }, MS + 40);
    }
    return on;
  }
  $i('tg-uv')?.addEventListener('click', () => toggle());
  cv.dataset.tool = opt.tool; syncTools();
  return {
    toggle, refresh, follow() { if (on && !anim) refresh(true); }, get on() { return on; },
    // for tests and for Claude's tools
    _t: { get data() { return data; }, coverShown: () => !!(data && data.r && opt.overlap && coverValid() && data.r.res && data.r.cover.length), get sel() { return sel; }, setTool, setMode, selectAll, selectNone, pack, density, fitSquare, flipH, flipV, turn, align, projectPoints, projectWhole, openProj, unwrap, view, selBox, get opt() { return opt; }, prof, refresh: (k, o) => refresh(k, o), stretchScore, distribute, orient, lineUp, setDensity, densityNow, relax, pickFlipped, pickStretched, boxes() { const { ids, lists } = islandSets(); return ids.map((i) => boxOf(lists[i])); }, get prepared() { return nosKey === nosKeyFor(dataVer); } },
  };
}
