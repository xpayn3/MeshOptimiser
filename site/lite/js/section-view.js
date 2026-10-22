// The cross-section view of the Profile and Round part cards: the section as it is (grey, chambers dashed) and as it will be (blue),
// and an editor on it. The wheel zooms about the pointer, a drag on the background pans, a double-click on the background fits it.
// With editing on, every point of the new section has a handle: a handle dragged moves its point (snapping onto the section as it
// was: a corner of it within 6 pixels first, else a point on one of its edges; Shift: free), a double-click on an edge adds a point
// there, Delete (or Backspace) takes the picked point out and Alt-click takes one out at once. The view knows nothing of parts:
// the card shows it a section and hears of each edit (fast while a handle is being dragged).
//
// sectionView(svg, { onEdit(shapes, fast), clampY }) → { show({ before, after, shapes }), setEdit(on), editing, fit(), reset() }
//   before, after: loops of [x, y] (y up; outlines counter-clockwise); shapes: the new section as [{ outer, holes }], the one the
//   editor works on (a copy of it is made at the first edit and handed to onEdit from then on); clampY: no point below this y (a
//   round part's profile: nothing past the axis).

const area = (L) => { let s = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
const pathOf = (loops) => loops.map(L => 'M' + L.map(p => p[0].toFixed(5) + ' ' + (-p[1]).toFixed(5)).join('L') + 'Z').join('');

export function sectionView(svg, hooks = {}) {
  let data = null, view = null, edit = false, sel = null, snap = null, work = null, drag = null;
  const clampY = Number.isFinite(hooks.clampY) ? hooks.clampY : -Infinity;
  const shapesNow = () => work || (data && data.shapes) || [];
  const loopOf = (sh, s, l) => (l === 0 ? sh[s].outer : sh[s].holes[l - 1]);
  // one screen pixel, in the section's units (the drawing keeps its proportions: a section taller than the box is fitted by its height)
  const pxOf = () => Math.max(view.w / Math.max(1, svg.clientWidth || 300), view.h / Math.max(1, svg.clientHeight || 200));
  const toSec = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, -q.y]; };
  function fitView() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const L of (data.before || []).concat(data.after || [])) for (const p of L) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    if (!(x1 >= x0)) { x0 = y0 = 0; x1 = y1 = 1; }
    const w = x1 - x0 || 1, h = y1 - y0 || 1, pad = Math.max(w, h) * 0.02;
    return { x: x0 - pad, y: y0 - pad, w: w + 2 * pad, h: h + 2 * pad };
  }
  function draw() {
    if (!data) { svg.innerHTML = ''; return; }
    if (!view) view = fitView();
    svg.setAttribute('viewBox', [view.x, -(view.y + view.h), view.w, view.h].map(n => n.toFixed(5)).join(' '));      // (y up: drawn at −y)
    const px = pxOf(), before = data.before || [];
    let html = '<path class="pf-now" fill-rule="evenodd" d="' + pathOf(data.after || []) + '"/>'
      + '<path class="pf-was" d="' + pathOf(before.filter(L => area(L) > 0)) + '"/>'
      + '<path class="pf-was pf-hole" d="' + pathOf(before.filter(L => area(L) < 0)) + '"/>';
    if (edit) shapesNow().forEach((S, si) => [S.outer, ...S.holes].forEach((L, li) => L.forEach((p, pi) => {
      const on = sel && sel.s === si && sel.l === li && sel.p === pi;
      html += '<circle class="pf-pt' + (on ? ' is-sel' : '') + '" data-s="' + si + '" data-l="' + li + '" data-p="' + pi + '" cx="' + p[0].toFixed(5) + '" cy="' + (-p[1]).toFixed(5) + '" r="' + (px * (on ? 5 : 4)).toFixed(5) + '"/>';
    })));
    if (snap) { const p = snap.p, r = px * 7; html += snap.kind === 'point' ? '<rect class="pf-snap" x="' + (p[0] - r).toFixed(5) + '" y="' + (-p[1] - r).toFixed(5) + '" width="' + (2 * r).toFixed(5) + '" height="' + (2 * r).toFixed(5) + '"/>' : '<circle class="pf-snap" cx="' + p[0].toFixed(5) + '" cy="' + (-p[1]).toFixed(5) + '" r="' + r.toFixed(5) + '"/>'; }
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
  const own = () => { if (!work) work = shapesNow().map(S => ({ outer: S.outer.map(p => p.slice()), holes: S.holes.map(H => H.map(p => p.slice())) })); return work; };
  const told = (fast) => { if (hooks.onEdit) hooks.onEdit(work, !!fast); };
  const clamp = (p) => [p[0], Math.max(clampY, p[1])];

  svg.addEventListener('pointerdown', (e) => {
    if (!data) return;
    const c = e.target.closest && e.target.closest('.pf-pt');
    if (c && edit) {
      const s = +c.dataset.s, l = +c.dataset.l, p = +c.dataset.p;
      if (e.altKey) { const L = loopOf(own(), s, l); if (L.length > 3) { L.splice(p, 1); sel = null; told(false); } e.preventDefault(); return; }
      sel = { s, l, p }; own();
      drag = { kind: 'pt', s, l, p, id: e.pointerId }; try { svg.setPointerCapture(e.pointerId); } catch (_) {} svg.focus(); draw(); e.preventDefault(); return;
    }
    drag = { kind: 'pan', id: e.pointerId, at: toSec(e) }; try { svg.setPointerCapture(e.pointerId); } catch (_) {} svg.focus();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const q = toSec(e);
    if (drag.kind === 'pt') {
      const to = e.shiftKey ? null : snapTo(q);
      loopOf(work, drag.s, drag.l)[drag.p] = clamp(to ? to.p : q); snap = to; drag.moved = true; told(true); return;
    }
    const dx = q[0] - drag.at[0], dy = q[1] - drag.at[1]; if (!dx && !dy) return;
    view.x -= dx; view.y -= dy; draw();
  });
  const end = (e) => { if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null; snap = null; if (d.kind === 'pt' && d.moved) told(false); else draw(); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', (e) => {
    if (!data) return;
    const q = toSec(e);
    if (edit) {
      // the nearest edge of the new section within 8 pixels: a point there
      const sh = own(), lim = 8 * pxOf(); let best = null;
      sh.forEach((S, s) => [S.outer, ...S.holes].forEach((L, l) => L.forEach((a, i) => {
        const b = L[(i + 1) % L.length], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2));
        const d = Math.hypot(a[0] + t * ex - q[0], a[1] + t * ey - q[1]); if (d < lim && (!best || d < best.d)) best = { d, s, l, i, p: clamp([a[0] + t * ex, a[1] + t * ey]) };
      })));
      if (best) { loopOf(sh, best.s, best.l).splice(best.i + 1, 0, best.p); sel = { s: best.s, l: best.l, p: best.i + 1 }; told(false); return; }
    }
    view = null; draw();                                                    // (a double-click on nothing: fit)
  });
  svg.addEventListener('wheel', (e) => {
    if (!data || !view) return; e.preventDefault();
    const q = toSec(e), k = Math.exp(Math.sign(e.deltaY) * 0.15);
    view.x = q[0] - (q[0] - view.x) * k; view.y = q[1] - (q[1] - view.y) * k; view.w *= k; view.h *= k; draw();
  }, { passive: false });
  svg.addEventListener('keydown', (e) => {
    if (!edit || !sel || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    e.preventDefault(); e.stopPropagation();                                 // (not the scene's Delete)
    const L = loopOf(own(), sel.s, sel.l); if (L.length > 3) { L.splice(sel.p, 1); sel = null; told(false); }
  });

  return {
    // fit: start the view again (another part shown)
    show(d, fit) { data = d; if (fit) { view = null; sel = null; } draw(); },
    setEdit(on) { edit = !!on; sel = null; draw(); },
    get editing() { return edit; },
    fit() { view = null; draw(); },
    // forget the edited copy (the card went back to the section the options make, or shows another part)
    reset(shapes) { work = shapes || null; sel = null; draw(); },
  };
}
