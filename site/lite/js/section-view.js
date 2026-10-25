// The cross-section view of the Profile and Round part cards: the section as it is (grey, chambers dashed) and as it will be (blue),
// and an editor on it. The wheel zooms about the pointer, a drag with the middle or the right button pans (the left one is for the
// points), a double-click on the background fits it.
// With editing on, every point of the new section has a handle. A click picks a point (Shift-click adds one, Ctrl-click takes one
// away), a drag on the background picks the points in its box (with Shift added, with Ctrl taken away), Ctrl+A picks them all. A
// handle dragged moves its point and every other picked point as far (it snaps onto the section as it was: a corner of it within 6
// pixels first, else a point on one of its edges; Shift: lined up across or down with another point of the new section, a guide
// line to it, else free; Esc puts them back), a double-click on an edge adds a point there, Delete (or Backspace) takes the picked
// points out and Alt-click takes one out at once. Edges that cross another are drawn red. The view knows
// nothing of parts: the card shows it a section and hears of each edit (fast while a handle is being dragged, at most once a frame).
//
// Every edit made here (a point let go, points taken out, one added) is a step of this window's own history: Ctrl+Z / Ctrl+Shift+Z
// (Ctrl+Y) with the view in focus, or undo() / redo(); onHistory() hears when they can go. It starts again with each part shown.
//
// sectionView(svg, { onEdit(shapes, fast, crossed), onHistory(), clampY, mirrorY }) → { show({ before, after, shapes }), setEdit(on), editing, fit(), reset(shapes, keep), undo(), redo(), canUndo, canRedo }
//   before, after: loops of [x, y] (y up; outlines counter-clockwise); shapes: the new section as [{ outer, holes }], the one the
//   editor works on (a copy of it is made at the first edit and handed to onEdit from then on; null when an edit is taken back with
//   Esc before there was one); crossed: an edge of it crosses another (told when a drag ends); clampY: no point below this y (a
//   round part's profile: nothing past the axis); mirrorY: a number, or a function that gives one or null: the section is drawn a
//   second time mirrored across the line y = mirrorY, lighter and with no points (it is not edited: it follows the half that is), so a
//   turned part's profile shows the part's whole outline and not one half of it.

const area = (L) => { let s = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
const pathOf = (loops) => loops.map(L => 'M' + L.map(p => p[0].toFixed(5) + ' ' + (-p[1]).toFixed(5)).join('L') + 'Z').join('');
const fin = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
const niceStep = (x) => { const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };

// the edges of a section that cross another one (not ones that only touch, or meet at a point they share); null when there are too
// many edges to look at every pair (then nothing is drawn red)
export function crossings(shapes) {
  const E = [];
  (shapes || []).forEach(S => [S.outer, ...(S.holes || [])].forEach(L => { for (let i = 0; i < L.length; i++) E.push([L[i], L[(i + 1) % L.length]]); }));
  if (E.length > 4000) return null;
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const same = (p, q) => p[0] === q[0] && p[1] === q[1];
  const bad = new Set();
  for (let i = 0; i < E.length; i++) {
    const [a, b] = E[i], ax0 = Math.min(a[0], b[0]), ax1 = Math.max(a[0], b[0]), ay0 = Math.min(a[1], b[1]), ay1 = Math.max(a[1], b[1]);
    for (let j = i + 1; j < E.length; j++) {
      const [c, d] = E[j];
      if (Math.max(c[0], d[0]) < ax0 || Math.min(c[0], d[0]) > ax1 || Math.max(c[1], d[1]) < ay0 || Math.min(c[1], d[1]) > ay1) continue;
      if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue;
      const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
      if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) { bad.add(i); bad.add(j); }
    }
  }
  return [...bad].map(i => E[i]);
}

export function sectionView(svg, hooks = {}) {
  let data = null, view = null, home = null, edit = false, snap = null, guide = null, work = null, drag = null, bad = null;
  let raf = 0, pend = null;
  // this window's history: the section as it was before each edit (null: the options' own), and the ones undone
  const past = [], future = [];
  const cloneW = (w) => w && w.map(S => ({ outer: S.outer.map(p => p.slice()), holes: S.holes.map(H => H.map(p => p.slice())) }));
  const heard = () => { if (hooks.onHistory) { try { hooks.onHistory(); } catch (e) { console.warn('section history', e); } } };
  const record = (pre) => { past.push(pre); if (past.length > 200) past.shift(); future.length = 0; heard(); };
  const wipe = () => { past.length = 0; future.length = 0; heard(); };
  // the points picked, by "shape:loop:point" (indices into the section as it is now; any edit that adds or takes out points clears it)
  const sel = new Map();
  const key = (s, l, p) => s + ':' + l + ':' + p;
  const pick = (s, l, p) => sel.set(key(s, l, p), { s, l, p });
  const clampY = Number.isFinite(hooks.clampY) ? hooks.clampY : -Infinity;
  const mirrorY = () => { const m = typeof hooks.mirrorY === 'function' ? hooks.mirrorY() : hooks.mirrorY; return Number.isFinite(m) ? m : null; };
  const mirrored = (loops, m) => loops.map(L => L.map(p => [p[0], 2 * m - p[1]]));
  const shapesNow = () => work || (data && data.shapes) || [];
  const loopOf = (sh, s, l) => { const S = sh[s]; return S ? (l === 0 ? S.outer : S.holes[l - 1]) : null; };
  const eachPoint = (fn) => shapesNow().forEach((S, s) => [S.outer, ...S.holes].forEach((L, l) => L.forEach((p, i) => fn(p, s, l, i))));
  // one screen pixel, in the section's units (the drawing keeps its proportions: a section taller than the box is fitted by its height)
  const pxOf = () => Math.max(view.w / Math.max(1, svg.clientWidth || 300), view.h / Math.max(1, svg.clientHeight || 200));
  // a place on the screen in the section's units (null while the view is not laid out: the card hidden)
  const toSec = (cx, cy) => {
    const m = svg.getScreenCTM && svg.getScreenCTM(); if (!m) return null;
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; const q = pt.matrixTransform(m.inverse()), r = [q.x, -q.y];
    return fin(r) ? r : null;
  };
  function fitView() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const L of (data.before || []).concat(data.after || [])) for (const p of L) { if (!fin(p)) continue; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    if (!(x1 >= x0)) { x0 = y0 = 0; x1 = y1 = 1; }
    { const m = mirrorY(); if (m !== null) { const a = 2 * m - y1, b = 2 * m - y0; y0 = Math.min(y0, a); y1 = Math.max(y1, b); } }      // (the mirrored half too)
    const w = x1 - x0 || 1, h = y1 - y0 || 1, pad = Math.max(w, h) * 0.02;
    return { x: x0 - pad, y: y0 - pad, w: w + 2 * pad, h: h + 2 * pad };
  }
  function draw() {
    if (!data) { svg.innerHTML = ''; return; }
    if (!view) view = fitView();
    svg.setAttribute('viewBox', [view.x, -(view.y + view.h), view.w, view.h].map(n => n.toFixed(5)).join(' '));      // (y up: drawn at −y)
    const px = pxOf(), before = data.before || [];
    // a faint grid under it all, over the whole box (a line every 24 to 60 pixels, whatever the zoom; from 0, so the axis is on one)
    let grid = '';
    {
      const st = niceStep(px * 24), cw = Math.max(1, svg.clientWidth || 300) * px, ch = Math.max(1, svg.clientHeight || 200) * px, m = 64 * px;
      const cx = view.x + view.w / 2, cy = view.y + view.h / 2, x0 = cx - cw / 2 - m, x1 = cx + cw / 2 + m, y0 = cy - ch / 2 - m, y1 = cy + ch / 2 + m;
      if (st > 0 && (x1 - x0) / st < 400 && (y1 - y0) / st < 400) {
        for (let x = Math.ceil(x0 / st) * st; x <= x1; x += st) grid += 'M' + x.toFixed(5) + ' ' + (-y1).toFixed(5) + 'V' + (-y0).toFixed(5);
        for (let y = Math.ceil(y0 / st) * st; y <= y1; y += st) grid += 'M' + x0.toFixed(5) + ' ' + (-y).toFixed(5) + 'H' + x1.toFixed(5);
      }
    }
    // (while the section is being edited the blue is drawn from the points themselves: the card hears of them a frame later at most)
    const after = work && edit ? work.flatMap(S => [S.outer, ...S.holes]) : (data.after || []);
    let html = grid ? '<path class="pf-grid" d="' + grid + '"/>' : '';
    {
      const m = mirrorY();
      if (m !== null) {
        const ax0 = view.x - view.w, ax1 = view.x + 2 * view.w;
        html += '<path class="pf-axis" d="M' + ax0.toFixed(5) + ' ' + (-m).toFixed(5) + 'H' + ax1.toFixed(5) + '"/>'
          + '<path class="pf-now pf-mirror" fill-rule="evenodd" d="' + pathOf(mirrored(after, m)) + '"/>'
          + '<path class="pf-was pf-mirror" d="' + pathOf(mirrored(before.filter(L => area(L) > 0), m)) + '"/>'
          + '<path class="pf-was pf-hole pf-mirror" d="' + pathOf(mirrored(before.filter(L => area(L) < 0), m)) + '"/>';
      }
    }
    html += '<path class="pf-now" fill-rule="evenodd" d="' + pathOf(after) + '"/>'
      + '<path class="pf-was" d="' + pathOf(before.filter(L => area(L) > 0)) + '"/>'
      + '<path class="pf-was pf-hole" d="' + pathOf(before.filter(L => area(L) < 0)) + '"/>';
    if (bad && bad.length) html += '<path class="pf-bad" d="' + bad.map(([a, b]) => 'M' + a[0].toFixed(5) + ' ' + (-a[1]).toFixed(5) + 'L' + b[0].toFixed(5) + ' ' + (-b[1]).toFixed(5)).join('') + '"/>';
    if (edit) eachPoint((p, si, li, pi) => {
      const on = sel.has(key(si, li, pi));
      html += '<circle class="pf-pt' + (on ? ' is-sel' : '') + '" data-s="' + si + '" data-l="' + li + '" data-p="' + pi + '" cx="' + p[0].toFixed(5) + '" cy="' + (-p[1]).toFixed(5) + '" r="' + (px * (on ? 5 : 4)).toFixed(5) + '"/>';
    });
    if (snap) { const p = snap.p, r = px * 7; html += snap.kind === 'point' ? '<rect class="pf-snap" x="' + (p[0] - r).toFixed(5) + '" y="' + (-p[1] - r).toFixed(5) + '" width="' + (2 * r).toFixed(5) + '" height="' + (2 * r).toFixed(5) + '"/>' : '<circle class="pf-snap" cx="' + p[0].toFixed(5) + '" cy="' + (-p[1]).toFixed(5) + '" r="' + r.toFixed(5) + '"/>'; }
    if (guide) {                                                            // (Shift: a line from the point it lines up with)
      const p = guide.p, ln = (a) => '<line class="pf-guide" x1="' + a[0].toFixed(5) + '" y1="' + (-a[1]).toFixed(5) + '" x2="' + p[0].toFixed(5) + '" y2="' + (-p[1]).toFixed(5) + '"/>';
      if (guide.gx) html += ln([p[0], guide.gx[1]]);
      if (guide.gy) html += ln([guide.gy[0], p[1]]);
    }
    if (drag && drag.kind === 'box' && drag.moved) {                        // (the box being dragged to pick points)
      const a = drag.a, b = drag.b;
      html += '<rect class="pf-box" x="' + Math.min(a[0], b[0]).toFixed(5) + '" y="' + (-Math.max(a[1], b[1])).toFixed(5) + '" width="' + Math.abs(b[0] - a[0]).toFixed(5) + '" height="' + Math.abs(b[1] - a[1]).toFixed(5) + '"/>';
    }
    svg.innerHTML = html;
    svg.classList.toggle('is-edit', edit);
  }
  // snapping on the section as it was: a corner within 6 pixels first, else the nearest point on an edge within 6 pixels
  function snapTo(q) {
    const lim = 6 * pxOf(); let best = null;
    for (const M of data.before || []) for (const p of M) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < lim && (!best || d < best.d)) best = { d, p: p.slice(), kind: 'point' }; }
    if (best) return best;
    for (const M of data.before || []) for (let i = 0; i < M.length; i++) {
      const a = M[i], b = M[(i + 1) % M.length], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2)), p = [a[0] + t * ex, a[1] + t * ey], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < lim && (!best || d < best.d)) best = { d, p, kind: 'edge' };
    }
    return best;
  }
  // Shift: lining up with the other points of the new section (not the ones being moved), each way on its own: x onto the nearest
  // point straight above or below within 6 pixels, y onto the nearest one level with it (the point it lines up with is kept, for the
  // guide line)
  function alignTo(q, moving) {
    const lim = 6 * pxOf(); let bx = null, by = null;
    eachPoint((p, s, l, i) => {
      if (moving.has(key(s, l, i))) return;
      const dx = Math.abs(p[0] - q[0]), dy = Math.abs(p[1] - q[1]);
      if (dx < lim && (!bx || dx < bx.d)) bx = { d: dx, p };
      if (dy < lim && (!by || dy < by.d)) by = { d: dy, p };
    });
    return { p: [bx ? bx.p[0] : q[0], by ? by.p[1] : q[1]], gx: bx && bx.p.slice(), gy: by && by.p.slice() };
  }
  const own = () => { if (!work) work = shapesNow().map(S => ({ outer: S.outer.map(p => p.slice()), holes: S.holes.map(H => H.map(p => p.slice())) })); return work; };
  // the card hears of the section (at the end of an edit, with whether it crosses itself)
  const told = (fast) => {
    if (!fast) bad = work ? crossings(work) : null;
    if (hooks.onEdit) { try { hooks.onEdit(work, !!fast, !!(bad && bad.length)); } catch (e) { console.warn('section edit', e); } }
    if (fast) draw();
  };
  const clamp = (p) => [p[0], Math.max(clampY, p[1])];
  // a drag stopped from outside (another part shown, the card closed, editing switched off): nothing more is heard of it
  const drop = () => { svg.classList.remove('is-pan'); if (raf) cancelAnimationFrame(raf); raf = 0; pend = null; if (drag) { try { svg.releasePointerCapture(drag.id); } catch (_) {} } drag = null; snap = null; guide = null; };
  // the picked points taken out (each outline keeps three at least), the highest first so the others keep their places
  function takeOut() {
    const pre = cloneW(work), by = new Map();
    for (const { s, l, p } of sel.values()) { const k = s + ':' + l; if (!by.has(k)) by.set(k, { s, l, ps: [] }); by.get(k).ps.push(p); }
    let n = 0;
    for (const { s, l, ps } of by.values()) {
      const L0 = loopOf(shapesNow(), s, l); if (!L0) continue;
      const room = L0.length - 3; if (room <= 0) continue;
      const L = loopOf(own(), s, l);
      ps.filter(p => p < L.length).sort((a, b) => b - a).slice(0, room).forEach(p => { L.splice(p, 1); n++; });
    }
    sel.clear();
    if (n) { record(pre); told(false); }
    draw();
  }

  // the point under the pointer, once a frame (a pointer reports far more often than the drawing can follow)
  function move(m) {
    if (!drag || !data) return;
    const q = toSec(m.x, m.y); if (!q) return;
    drag.last = m;
    if (drag.kind === 'pt') {
      // the point held goes where the pointer is (snapped, or lined up with Shift); every other picked point moves as far
      const sh = own(), L = loopOf(sh, drag.s, drag.l); if (!L || !L[drag.p]) { drop(); return; }
      let p;
      if (m.shift) { const a = alignTo(q, drag.moving); p = clamp(a.p); guide = (a.gx || a.gy) ? { p, gx: a.gx, gy: a.gy } : null; snap = null; }
      else { const to = snapTo(q); p = clamp(to ? to.p : q); snap = to; guide = null; }
      if (!fin(p)) return;
      const dx = p[0] - drag.base[0], dy = p[1] - drag.base[1];
      for (const it of drag.items) {
        const M = loopOf(sh, it.s, it.l); if (!M || !M[it.p]) continue;
        M[it.p] = it.s === drag.s && it.l === drag.l && it.p === drag.p ? p : clamp([it.was[0] + dx, it.was[1] + dy]);
      }
      drag.moved = true; told(true); return;
    }
    if (drag.kind === 'box') {
      // the picked points: the box's (Shift: added to them, Ctrl: taken from them) as it is dragged
      drag.b = q;
      if (!drag.moved && Math.hypot(q[0] - drag.a[0], q[1] - drag.a[1]) < 3 * pxOf()) return;
      drag.moved = true;
      const x0 = Math.min(drag.a[0], q[0]), x1 = Math.max(drag.a[0], q[0]), y0 = Math.min(drag.a[1], q[1]), y1 = Math.max(drag.a[1], q[1]);
      sel.clear(); if (drag.mode !== 'set') for (const [k, v] of drag.base) sel.set(k, v);
      eachPoint((p, s, l, i) => {
        if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) return;
        if (drag.mode === 'sub') sel.delete(key(s, l, i)); else pick(s, l, i);
      });
      draw(); return;
    }
    const dx = q[0] - drag.at[0], dy = q[1] - drag.at[1]; if (!dx && !dy) return;
    view.x -= dx; view.y -= dy; draw();
  }
  const flush = () => { raf = 0; const m = pend; pend = null; if (m) move(m); };
  const later = (m) => { pend = m; if (!raf) raf = requestAnimationFrame(flush); };
  const hold = (e) => { try { svg.setPointerCapture(e.pointerId); } catch (_) {} svg.focus({ preventScroll: true }); };

  svg.addEventListener('pointerdown', (e) => {
    if (!data || drag) return;
    const c = e.target.closest && e.target.closest('.pf-pt');
    if (e.button === 0 && edit) {
      const add = e.shiftKey, sub = e.ctrlKey || e.metaKey;
      if (!c) {
        // the background: a box that picks the points in it (Shift adds them, Ctrl takes them away; a click alone picks none)
        const at = toSec(e.clientX, e.clientY); if (!at || !view) return;
        drag = { kind: 'box', id: e.pointerId, a: at, b: at, mode: add ? 'add' : sub ? 'sub' : 'set', base: new Map(sel), moved: false };
        hold(e); e.preventDefault(); return;
      }
      const s = +c.dataset.s, l = +c.dataset.l, p = +c.dataset.p, L0 = loopOf(shapesNow(), s, l);
      if (!L0 || !L0[p]) return;
      e.preventDefault();
      if (e.altKey) { if (L0.length > 3) { const pre = cloneW(work); loopOf(own(), s, l).splice(p, 1); record(pre); sel.clear(); told(false); draw(); } return; }
      const k = key(s, l, p);
      if (sub) { sel.delete(k); draw(); return; }                            // (Ctrl-click: that point is no longer picked)
      // a click on a point picks it alone; Shift adds it; on one of several picked, they stay picked (a drag moves them all) and a click
      // that does not move picks it alone when it is let go
      const alone = !add && sel.has(k) && sel.size > 1;
      if (!add && !sel.has(k)) sel.clear();
      pick(s, l, p);
      const sh = shapesNow(), items = [...sel.values()].filter(v => { const M = loopOf(sh, v.s, v.l); return M && M[v.p]; }).map(v => ({ ...v, was: loopOf(sh, v.s, v.l)[v.p].slice() }));
      // (the section is copied only once a point really moves: a click alone leaves it the options' own)
      drag = { kind: 'pt', s, l, p, id: e.pointerId, base: L0[p].slice(), items, moving: new Set(items.map(v => key(v.s, v.l, v.p))), fresh: !work, alone, pre: cloneW(work) };
      hold(e); draw(); return;
    }
    if (e.button !== 1 && e.button !== 2) return;                           // (pan: the middle or the right button only)
    e.preventDefault();                                                     // (no scrolling mode from the middle button)
    const at = toSec(e.clientX, e.clientY); if (!at || !view) return;
    drag = { kind: 'pan', id: e.pointerId, at }; svg.classList.add('is-pan'); // (the grabbing hand while it pans)
    hold(e);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    later({ x: e.clientX, y: e.clientY, shift: e.shiftKey });
  });
  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (pend) { const m = pend; pend = null; move(m); }                     // (where it was let go, not a frame before)
    const d = drag; drag = null; snap = null; guide = null; svg.classList.remove('is-pan');
    if (!d) return;
    if (d.kind === 'box') { if (!d.moved && d.mode === 'set') sel.clear(); draw(); return; }
    if (d.kind !== 'pt') { draw(); return; }
    if (!d.moved) { if (d.alone) { sel.clear(); pick(d.s, d.l, d.p); } draw(); return; }
    // one point let go on top of the one before or after it: the two are one (the one dragged stays, and stays picked)
    const L = loopOf(work, d.s, d.l), n = L ? L.length : 0;
    if (L && n > 3 && d.items.length === 1) {
      const p = L[d.p], tiny = (home ? Math.max(home.w, home.h) : 1) * 1e-9;
      for (const k of [(d.p + n - 1) % n, (d.p + 1) % n]) if (Math.hypot(L[k][0] - p[0], L[k][1] - p[1]) <= tiny) { L.splice(k, 1); sel.clear(); pick(d.s, d.l, k < d.p ? d.p - 1 : d.p); break; }
    }
    record(d.pre); told(false); draw();
  };
  svg.addEventListener('contextmenu', (e) => e.preventDefault());           // (the right button pans here)
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end); svg.addEventListener('lostpointercapture', end);
  // Shift pressed or let go while points are held: they line up (or not) at once, without a move; Esc puts them back (a box: the
  // points picked before it)
  const keys = (e) => {
    if (!drag || (drag.kind !== 'pt' && drag.kind !== 'box')) return;
    if (drag.kind === 'pt' && e.key === 'Shift' && drag.last) { later({ ...drag.last, shift: e.type === 'keydown' }); return; }
    if (e.key !== 'Escape' || e.type !== 'keydown') return;
    e.preventDefault(); e.stopPropagation();                                 // (not the scene's Esc, nor the card's)
    const d = drag; drop();
    if (d.kind === 'box') { sel.clear(); for (const [k, v] of d.base) sel.set(k, v); draw(); return; }
    if (!d.moved) { draw(); return; }
    if (d.fresh) work = null; else for (const it of d.items) { const L = loopOf(work, it.s, it.l); if (L && L[it.p]) L[it.p] = it.was; }
    told(false); draw();
  };
  window.addEventListener('keydown', keys, true); window.addEventListener('keyup', keys, true);
  svg.addEventListener('dblclick', (e) => {
    if (!data) return;
    const q = toSec(e.clientX, e.clientY); if (!q) return;
    if (edit) {
      // the nearest edge of the new section within 8 pixels: a point there
      const lim = 8 * pxOf(); let best = null;
      shapesNow().forEach((S, s) => [S.outer, ...S.holes].forEach((L, l) => L.forEach((a, i) => {
        const b = L[(i + 1) % L.length], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2));
        const d = Math.hypot(a[0] + t * ex - q[0], a[1] + t * ey - q[1]); if (d < lim && (!best || d < best.d)) best = { d, s, l, i, p: clamp([a[0] + t * ex, a[1] + t * ey]) };
      })));
      if (best) { const pre = cloneW(work); loopOf(own(), best.s, best.l).splice(best.i + 1, 0, best.p); record(pre); sel.clear(); pick(best.s, best.l, best.i + 1); told(false); draw(); return; }
      if (e.target.closest && e.target.closest('.pf-pt')) return;           // (a double-click on a point: not a fit)
    }
    view = null; draw();                                                    // (a double-click on nothing: fit)
  });
  svg.addEventListener('wheel', (e) => {
    if (!data || !view) return; e.preventDefault();
    const q = toSec(e.clientX, e.clientY); if (!q) return;
    // (from a ten-thousandth of the section across to fifty times it: past that a wheel loses it)
    const lo = home ? Math.max(home.w, home.h) * 1e-4 : 0, hi = home ? Math.max(home.w, home.h) * 50 : Infinity;
    let k = Math.exp(Math.sign(e.deltaY) * 0.15), big = Math.max(view.w, view.h);
    if (big * k < lo) k = lo / big; else if (big * k > hi) k = hi / big;
    if (!(k > 0) || k === 1) return;
    view.x = q[0] - (q[0] - view.x) * k; view.y = q[1] - (q[1] - view.y) * k; view.w *= k; view.h *= k; draw();
  }, { passive: false });
  svg.addEventListener('keydown', (e) => {
    if (!edit || drag) return;
    // Ctrl+Z undoes the last edit made here, Ctrl+Shift+Z or Ctrl+Y does it again (not the scene's own undo while this view is in focus)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault(); e.stopPropagation();
      (e.key === 'y' || e.key === 'Y' || e.shiftKey ? redo : undo)(); return;
    }
    // Ctrl+A: every point picked
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); e.stopPropagation(); sel.clear(); eachPoint((p, s, l, i) => pick(s, l, i)); draw(); return; }
    if (!sel.size || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    e.preventDefault(); e.stopPropagation();                                 // (not the scene's Delete)
    takeOut();
  });

  // a step back or forward: the section as it was is told to the card like any edit
  function step(from, to) {
    if (!from.length) return false;
    drop(); to.push(cloneW(work)); work = from.pop(); bad = work ? crossings(work) : null; sel.clear();
    told(false); draw(); heard(); return true;
  }
  const undo = () => step(past, future), redo = () => step(future, past);

  return {
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    undo, redo,
    // fit: start the view again (another part shown)
    show(d, fit) {
      data = d && (d.before || d.after) ? d : null;
      if (fit || !data) { drop(); view = null; sel.clear(); }
      else if (!work) sel.clear();                                           // (the options' own section again: its points may be others)
      home = data ? fitView() : null;
      draw();
    },
    setEdit(on) { drop(); edit = !!on; sel.clear(); draw(); },
    get editing() { return edit; },
    fit() { view = null; draw(); },
    // forget the edited copy (the card went back to the section the options make, or shows another part)
    // keep: the card's own Reset points, which is a step of the history too (the section it had goes to the past)
    reset(shapes, keep) { drop(); if (keep) { if (work) record(cloneW(work)); } else wipe(); work = shapes || null; bad = work ? crossings(work) : null; sel.clear(); draw(); },
  };
}
