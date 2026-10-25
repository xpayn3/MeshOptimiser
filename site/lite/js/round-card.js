// The Round part card: a turned part (a spool, a bushing, a pulley) or a drive belt made clean from its profile. The work on the
// profile is revolve.js; this file is the card and the part that touches the scene. It is the Profile card's twin: the profile as
// it is (grey) and as it will be (blue) before anything changes, the same editor on it (section-view.js), Apply for every part in
// one undo step, and the options building them again live in that step afterwards.
//
//   Remove ridges  the profile cut through the part, grooves and ridges narrower than the width filled, spun again (fillRoundGrooves)
//   Make solid     the outline of the whole part spun: fins, ribs and the room between them solid (outlineRevolve)
//   Belt           a band swept along a closed path, the gaps between its ribs filled (sweepBelt)
//
// The profile is drawn along the axis (across) by the distance from it (up); a belt's by its width (across) and the depth in from
// its back (up). Edited by hand, a part is built from the profile as edited (a point never goes past the axis). The width is
// remembered as a share of the part's size; Segments around as a number; the Shading angle is the part's own (as in Properties).
// Once applied, the view is Wireframe with the lines on the parts in work only, so each change of Segments around shows; closing
// the card puts the view back as it was, unless it was changed by hand meanwhile.
import { fillRoundGrooves, outlineRevolve, sweepBelt, revolveLoops, sweepLoops } from './revolve.js?v=9';
import { withUvs } from './meshops.js?v=19';
import { sectionView } from './section-view.js?v=9';      // (round-card: mirror toggle)

export function installRoundCard(app) {
  const {
    state, _Prefs, _CmdCards, initScrubber, toast, getPart, fmtNum, pushUndo, settle, setViewMode, _wireLimit,
    _roundGeom, _stampGeometry, _refreshPartBBox, _decSnap, _getEdgesGeom, _cadEdgesPartSwapped, _uvSetsOf, _disposeEdgesFor, _safeDispose, _nextFrame, _Job, _swapPartGeometry,
  } = app;
  const NAMES = { exact: 'Round part: remove ridges', outline: 'Round part: make solid', belt: 'Belt: remove ribs' };
  const DEF = { mode: 'exact', widthShare: 0.15, segments: 0, smooth: 30 };           // (segments 0: the part's own, or 64 for Make solid)
  const $i = (id) => document.getElementById(id);
  const pref = (k) => { const v = _Prefs.get('round.' + k); return v === undefined || v === null ? DEF[k] : v; };
  let cur = null, timer = 0, busy = false, again = false, wired = false, view = null, scanSeq = 0, selTimer = 0, selTried = '';
  const sc = {};

  const sourceOf = (p) => {
    const g = p.mesh.geometry, pa = g.attributes.position, P = new Float32Array(pa.count * 3);
    for (let v = 0; v < pa.count; v++) { P[3 * v] = pa.getX(v); P[3 * v + 1] = pa.getY(v); P[3 * v + 2] = pa.getZ(v); }
    p.mesh.updateWorldMatrix(true, false);
    const sv = p.mesh.getWorldScale(new p.mesh.scale.constructor());
    return {
      partId: p.partId, name: p.name, P, I: g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: pa.count }, (_, i) => i),
      UV: _uvSetsOf(g), mat: g.groups && g.groups.length ? (g.groups[0].materialIndex || 0) : -1,
      scale: Math.cbrt(Math.abs(sv.x * sv.y * sv.z)) || 1, tris0: p.triCount | 0, shapes: null, last: null, before: null, trisAfter: 0,
    };
  };
  const itNow = () => cur && cur.items[cur.at];
  // the largest extent of a part (a part that is not found round has no width of its own to size the options by)
  const sizeOf = (P) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); } return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1; };
  const FN = { exact: fillRoundGrooves, outline: outlineRevolve, belt: sweepBelt };
  // the profile of one part for the options as they are (cheap enough to run at every change: only the part shown)
  function profileOf(it) {
    const o = cur.o, mode = cur.mode;
    // (kept for the options it was made with: an edit by hand, or another look at the same part, does not cut it again)
    // (Make solid: the axis chosen, or the one the part is roundest round)
    const axis = mode === 'outline' && o.axis && o.axis !== 'auto' ? o.axis : undefined;
    const key = mode + '|' + o.width + '|' + o.segments + '|' + (axis || '');
    let r = it.dry && it.dry.key === key ? it.dry.r : null;
    if (!r) { try { r = FN[mode](it.P, it.I, { width: o.width / it.scale, segments: o.segments > 2 ? o.segments : undefined, axis, dryRun: true }); } catch (e) { r = { ok: false, why: e.message }; } it.dry = { key, r }; }
    if (!r || !r.ok) return r || { ok: false, why: 'nothing came back' };
    // what it was: the exact cut (Make solid has none of its own: the exact one when the part is round enough to have it)
    if (!it.before || it.before.mode !== mode) {
      let b = r.profileBefore;
      if (!b && mode === 'outline') { try { const x = fillRoundGrooves(it.P, it.I, { width: 0, dryRun: true }); if (x.ok) b = x.profileBefore; } catch (_) {} }
      it.before = { mode, loops: b || [] };
    }
    const N = mode === 'belt' ? null : (o.segments > 2 ? o.segments : (mode === 'outline' ? 64 : r.ownSegments || r.segments));
    return { ...r, N, before: it.before.loops, after: it.shapes ? it.shapes.map(S => S.outer) : r.profileAfter };
  }
  // the new mesh from a profile (as the options make it, or edited)
  function meshOf(it, r) {
    const loops = r.after, deg = cur.o.smooth;
    const g = cur.mode === 'belt' ? sweepLoops(loops, r.sweep, deg) : revolveLoops(loops, r.center, r.axis, r.N, r.phase || 0, r.eps, deg);
    return it.UV ? withUvs(g, it.P, it.I, it.UV) : g;
  }

  // ── the preview ──
  // the undo and redo buttons in the preview's corner (shown while points are edited; lit when there is a step to go to)
  function histMarks() {
    const ed = !!(view && view.editing);
    for (const k of ['undo', 'redo']) { const b = $i('rc-' + k); if (!b) continue; b.hidden = !ed; b.disabled = !(view && (k === 'undo' ? view.canUndo : view.canRedo)); }
  }
  const viewOf = () => view || (view = sectionView($i('rc-svg'), {
    onHistory: () => histMarks(),
    clampY: 0,
    mirrorY: () => (cur && cur.mode !== 'belt' && _Prefs.get('round.mirror') !== false ? 0 : null),      // (the other half of the part, drawn and not edited: a bolt reads as a bolt; the corner button switches it off)
    onEdit(shapes, fast, crossed) {
      const it = itNow(); if (!it) return;
      it.shapes = shapes || null; it.crossed = !!(shapes && crossed); preview(fast);
      if (fast) return;
      if (it.crossed) { clearTimeout(timer); say('An edge of the profile crosses another (drawn red): move a point so it does not, and it is built.'); cur.crossSaid = true; return; }
      if (cur.crossSaid) { say(''); cur.crossSaid = false; }
      if (cur.op) { clearTimeout(timer); timer = setTimeout(build, 160); }
    },
  }));
  const mm = (v) => fmtNum(v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100) + ' mm';
  function preview(fast) {
    if (!cur) return;
    const it = itNow(), r = profileOf(it);
    it.last = r;
    // (a belt's profile runs in from its back: drawn with the back at the top)
    viewOf().show(r && r.ok ? { before: r.before, after: r.after, shapes: r.profileAfter.map(L => ({ outer: L, holes: [] })) } : null, cur.fit); cur.fit = false;
    if (fast) return;
    if (r && r.ok) { try { it.trisEst = meshOf(it, r).index.length / 3; } catch (_) { it.trisEst = 0; } }
    const box = $i('rc-stats');
    // (the readout is kept for Claude and the tests, and shown only when the part cannot be done this way: it says why)
    if (box) box.hidden = !!(r && r.ok);
    if (box) {
      const row = (k, v) => '<dt>' + k + '</dt><dd>' + v + '</dd>';
      box.innerHTML = !r || !r.ok ? row('Not this way', r && r.why ? r.why : 'it could not be done') : (cur.items.length > 1 || cur.skipped.length ? row('Parts', fmtNum(cur.items.length) + (cur.skipped.length ? ' · ' + fmtNum(cur.skipped.length) + ' other ' + (cur.skipped.length === 1 ? 'part' : 'parts') + ' left as they are' : '')) : '')
        + (cur.mode === 'belt' ? row('Path', (r.segments || 0) + ' corners · ' + mm((r.pathLength || 0) * it.scale) + ' round') : row('Axis', axisName(r.axis) + (r.roundness !== undefined ? ' · round to ' + mm(r.roundness * it.scale) : '')))
        + row(cur.mode === 'belt' ? 'Gaps between ribs' : 'Grooves filled', it.shapes ? 'as edited' : r.grooves ? String(r.grooves) : 'none')
        + (cur.mode === 'belt' ? '' : row('Segments around', r.N + (r.ownSegments && cur.mode === 'exact' ? ' (the part had ' + r.ownSegments + ')' : '')))
        + row('Triangles', fmtNum(it.tris0) + ' → ' + fmtNum(it.trisAfter || it.trisEst || 0) + (cur.items.length > 1 ? ' (this part)' : ''));
    }
    const n = $i('rc-name'); if (n) n.textContent = it.name;
    const pos = $i('rc-pos'); if (pos) pos.textContent = (cur.at + 1) + ' of ' + cur.items.length;
    const st = $i('rc-step'); if (st) st.hidden = cur.items.length < 2;
    const seg = $i('rc-seg-row'); if (seg) seg.hidden = cur.mode === 'belt';
    const ax = $i('rc-axis-row'); if (ax) ax.hidden = cur.mode !== 'outline';
    marks();
  }
  const axisName = (a) => (!a ? 'tilted' : Math.abs(Math.abs(a[0]) - 1) < 1e-9 ? 'X' : Math.abs(Math.abs(a[1]) - 1) < 1e-9 ? 'Y' : Math.abs(Math.abs(a[2]) - 1) < 1e-9 ? 'Z' : 'tilted');
  function marks() {
    const it = itNow(), on = !!(it && it.shapes), ed = !!(view && view.editing);
    { const mb = $i('rc-mirror'); if (mb && cur) { const m = _Prefs.get('round.mirror') !== false; mb.hidden = cur.mode === 'belt'; mb.classList.toggle('is-on', m); mb.setAttribute('aria-pressed', String(m)); } }
    const r = $i('rc-edit-reset'); if (r) r.hidden = !on;
    const h = $i('rc-edit-hint'); if (h) h.textContent = on ? 'Built from the profile as edited by hand.' : '';      // (how to edit: the view's label)
    const b = $i('rc-edit'); if (b) b.classList.toggle('is-on', ed);
    histMarks();
    for (const m of document.querySelectorAll('#rc-mode button')) m.classList.toggle('active', m.dataset.m === cur.mode);
    for (const b of document.querySelectorAll('#rc-axis button')) b.classList.toggle('active', b.dataset.a === (cur.o.axis || 'auto'));
    const t = $i('rc-title'); if (t) t.textContent = NAMES[cur.mode];
  }
  function step(d) {
    if (!cur || cur.items.length < 2) return;
    cur.at = (cur.at + d + cur.items.length) % cur.items.length; cur.fit = true;
    viewOf().reset(itNow().shapes); preview();
  }

  // ── build ──
  // The step this card applied was undone (Ctrl+Z): the card is as it was before Apply, and Apply builds it again. Redone: it is Done again.
  document.addEventListener('mo-history', () => {
    if (!cur) return;
    const top = state.history[state.history.length - 1], setLbl = (t) => {
      const lbl = $i('rc-run-lbl'); if (lbl) lbl.textContent = t;
      const fl = document.querySelector('.section-cmd[data-cmd="round"] .cmd-ok span'); if (fl) fl.textContent = t;
    };
    if (cur.op && top !== cur.op && state.redo && state.redo.includes(cur.op)) {
      clearTimeout(timer); cur.undone = cur.op; cur.op = null;
      setLbl(cur.items.length > 1 ? 'Apply to ' + fmtNum(cur.items.length) : 'Apply'); say(''); preview();
    } else if (!cur.op && cur.undone && top === cur.undone) {
      cur.op = cur.undone; cur.undone = null; setLbl('Done'); preview();
    }
  });
  const alive = () => cur && cur.op && state.history[state.history.length - 1] === cur.op;
  const say = (t) => { const el = $i('rc-info'); if (el) el.textContent = t; };
  // build is called by Apply, by the options and by the timer. While it works another call is kept for after (as it always was), and it
  // takes the app's one-job lock, so another tool cannot start in between.
  function build() { if (!cur) return Promise.resolve(); if (busy) { again = true; return Promise.resolve(); } return _Job.run(NAMES[cur.mode] || 'Round part', () => build_job()); }
  async function build_job() {
    if (!cur) return;
    if (busy) { again = true; return; }
    if (cur.op && !alive()) { say('This step is no longer the last one (undo or redo moved past it), so the options change nothing now.'); return; }
    busy = true; again = false;
    const btn = $i('rc-run'); if (btn) btn.disabled = true;
    const freed = [], undoItems = [], bad = [];
    const lblEl = $i('rc-run-lbl'), lblWas = lblEl ? lblEl.textContent : '';
    try {
      let n = 0;
      for (const it of cur.items) {
        { ++n; if (cur.items.length > 4 && lblEl) lblEl.textContent = 'Building ' + n + ' of ' + cur.items.length + '…'; }   // in the button, so the card keeps its height
        const p = getPart(it.partId); if (!p || p.deleted || !p.mesh) continue;
        if (it.crossed) { bad.push(it.name + ': its profile as edited crosses itself'); continue; }
        const r = it === itNow() && it.last && it.last.ok ? it.last : profileOf(it);
        if (!r || !r.ok) { bad.push(it.name + ': ' + ((r && r.why) || 'it could not be done')); continue; }
        let g; try { g = meshOf(it, r); } catch (e) { bad.push(it.name + ': ' + e.message); continue; }
        const before = cur.op ? null : _decSnap(p);
        const out = _roundGeom(g, it.mat, p.mesh.geometry);
        const { old, oldHash } = _swapPartGeometry(p, out, { prefix: 'rp' });
        it.trisAfter = p.triCount;
        p.shadeAngle = cur.o.smooth;
        if (cur.op) {
          const u = cur.op.items.find(x => x.partId === it.partId);
          if (u) u.after = _decSnap(p);
          if (oldHash && state.geomByHash.get(oldHash) === old) state.geomByHash.delete(oldHash);
          freed.push(old);
        } else undoItems.push({ partId: p.partId, before, after: _decSnap(p) });
        if (n % 4 === 0) await _nextFrame();
      }
      if (!cur.op && undoItems.length) {
        cur.op = { type: 'decimate', label: NAMES[cur.mode], items: undoItems }; pushUndo(cur.op);
        // Wireframe on the parts in work while the card stays open
        if (state.viewMode !== 'wire') { cur.viewBefore = state.viewMode; try { setViewMode('wire'); } catch (_) {} }
        try { _wireLimit(cur.items.map(x => x.partId)); } catch (_) {}
      }
    } finally { busy = false; if (btn) btn.disabled = false; if (lblEl) lblEl.textContent = lblWas; }
    settle();
    (async () => { await _nextFrame(); await _nextFrame(); for (const g of freed) { try { _disposeEdgesFor(g, false); } catch (_) {} try { _safeDispose(g); } catch (_) {} } })();
    if (cur && cur.op) {
      const tb = cur.items.reduce((s, x) => s + x.tris0, 0), ta = cur.items.reduce((s, x) => s + (x.trisAfter || x.tris0), 0);
      say('');                                                         // (no readout of the build under the view)
      const lbl = $i('rc-run-lbl'); if (lbl) lbl.textContent = 'Done';
      const fl = document.querySelector('.section-cmd[data-cmd="round"] .cmd-ok span'); if (fl) fl.textContent = 'Done';
    }
    if (bad.length) toast(NAMES[cur ? cur.mode : 'exact'], bad[0] + (bad.length > 1 ? ' (and ' + (bad.length - 1) + ' more)' : ''), 'warn', 6000);
    if (cur) preview();
    if (again) return build_job();      // (inside the job: asking build() again would be turned away by its own lock)
  }

  function changed(k, v, fromCtl) {
    if (!cur) return;
    cur.o[k] = v;
    const it = itNow();
    if (k === 'width' && it) _Prefs.set('round.widthShare', v / Math.max(1e-9, it.sizeMm));
    if (k === 'segments') _Prefs.set('roundSegments', v);
    if (!fromCtl && sc[k]) sc[k].setValue(v);
    preview();
    if (cur.op) { clearTimeout(timer); timer = setTimeout(build, 160); }
  }
  // Make solid's axis: another axis is another profile, so an edit by hand is dropped and the view fitted again
  function setAxis(a) {
    if (!cur || !['auto', 'x', 'y', 'z'].includes(a) || (cur.o.axis || 'auto') === a) return;
    if (cur.op && !alive()) return;
    cur.o.axis = a;
    for (const it of cur.items) { it.shapes = null; it.crossed = false; }
    viewOf().reset(null); cur.fit = true; preview();
    if (cur.op) { clearTimeout(timer); timer = setTimeout(build, 160); }
  }
  function setMode(m) {
    if (!cur || cur.mode === m || cur.op) return;
    cur.mode = m; _Prefs.set('round.mode', m);
    for (const it of cur.items) { it.shapes = null; it.before = null; it.crossed = false; }
    viewOf().reset(null); cur.fit = true; preview(); marks();      // (marks: the mirror button goes for a belt)
  }

  const niceStep = (x) => { const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; };
  const round = (v, step) => Math.round(v / step) * step;
  const decOf = (step) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  function scrub(key, el, label, min, max, step, unit) {
    const box = $i(el); if (!box) return;
    box.textContent = '';
    const steps = Math.max(1, Math.round((max - min) / step)), dec = decOf(step);
    sc[key] = initScrubber({
      el: box, label, maxSteps: steps, stepToVal: (st) => +(min + st * step).toFixed(dec), valToStep: (v) => Math.max(0, Math.min(steps, Math.round((v - min) / step))),
      format: (v) => ({ value: (+v).toFixed(dec), unit }), initialValue: cur.o[key], promptTitle: label, promptUnit: unit, onChange: (v) => changed(key, v, true),
    });
  }
  function wire() {
    if (wired) return; wired = true;
    const sec = document.querySelector('.section-cmd[data-cmd="round"]');
    for (const b of document.querySelectorAll('#rc-mode button')) b.addEventListener('click', () => setMode(b.dataset.m));
    for (const b of document.querySelectorAll('#rc-axis button')) b.addEventListener('click', () => setAxis(b.dataset.a));
    $i('rc-run')?.addEventListener('click', () => { if (cur && cur.op) _CmdCards.close('round'); else build(); });
    $i('rc-prev')?.addEventListener('click', () => step(-1));
    $i('rc-next')?.addEventListener('click', () => step(1));
    $i('rc-edit')?.addEventListener('click', () => { if (!cur) return; viewOf().setEdit(!view.editing); marks(); });
    // the other half on or off (remembered); the view fits again, the points as they are
    $i('rc-mirror')?.addEventListener('click', (e) => { e.currentTarget.blur(); if (!cur) return; _Prefs.set('round.mirror', _Prefs.get('round.mirror') === false); viewOf().fit(); marks(); });
    for (const k of ['undo', 'redo']) $i('rc-' + k)?.addEventListener('click', () => { if (!cur || !view) return; view[k](); $i('rc-svg')?.focus({ preventScroll: true }); });
    $i('rc-edit-reset')?.addEventListener('click', () => { const it = itNow(); if (!it) return; it.shapes = null; it.crossed = false; viewOf().reset(null, true); preview(); if (cur.op) { clearTimeout(timer); timer = setTimeout(build, 160); } });
    sec?.addEventListener('cmd-close', () => {
      clearTimeout(timer); clearTimeout(selTimer); scanSeq++;
      viewBack();
      cur = null;
    });
  }

  // the view as it was before Apply turned it to Wireframe (closing the card, or moving on to another part)
  function viewBack() {
    try { _wireLimit(null); } catch (_) {}
    if (cur && cur.viewBefore && state.viewMode === 'wire') { try { setViewMode(cur.viewBefore); } catch (_) {} }
  }

  // ── open ──
  // o: { mode, ids, width_mm, segments, smooth_deg, axis ('auto', 'x', 'y', 'z': Make solid), apply, quiet }. Nothing selected: every
  // part shown is looked at.
  async function open(o = {}) {
    const mode = o.mode || pref('mode');
    const picked = o.ids && o.ids.length ? o.ids : [...state.selected], whole = !picked.length;
    const parts = (whole ? state.parts.filter(p => p && !p.deleted && p.visible !== false && p.mesh) : picked.map(id => getPart(id)))
      .filter(p => p && !p.deleted && p.mesh && p.mesh.geometry && p.mesh.geometry.attributes.position && !p.isSpline && !p.isCloner);
    if (!parts.length) { if (!o.quiet) toast(NAMES[mode], whole ? 'Open a model first' : 'Select a part first', 'info', 2500); return { ok: false, why: 'nothing to look at' }; }
    const seq = ++scanSeq;
    if (!o.quiet && whole) toast(NAMES[mode], 'Nothing selected: looking among the ' + fmtNum(parts.length) + ' parts shown', 'info', 3000);
    const items = [], skipped = [];
    for (let i = 0; i < parts.length; i++) {
      if (seq !== scanSeq) return { ok: false, why: 'stopped' };
      const it = sourceOf(parts[i]);
      const axis = mode === 'outline' && ['x', 'y', 'z'].includes(o.axis) ? o.axis : undefined;
      let r; try { r = FN[mode](it.P, it.I, { dryRun: true, axis }); } catch (e) { r = { ok: false, why: e.message }; }
      if (r && r.ok) { it.sizeMm = (mode === 'belt' ? r.width / 0.25 : r.width / 0.15) * it.scale || 1; items.push(it); }
      // (Make solid on a part that is not round round any axis of its own: kept, so an axis can be chosen for it)
      else if (mode === 'outline' && r && /not round enough/.test(r.why || '')) { it.sizeMm = sizeOf(it.P) * it.scale || 1; items.push(it); }
      else skipped.push({ name: parts[i].name, why: r && r.why });
      if (!o.quiet && parts.length > 6 && i % 6 === 5) await _nextFrame();
    }
    if (!items.length) { if (!o.quiet) toast(NAMES[mode], (skipped.length === 1 ? skipped[0].name + ' was left as it was: ' : 'None of the ' + skipped.length + ' parts fits: ') + (skipped[0].why || 'it could not be done'), 'warn', 7000); return { ok: false, why: skipped[0].why, skipped }; }
    clearTimeout(timer);
    if (!o.quiet) viewBack();
    selTried = '';
    const lead = items[0], wMax = lead.sizeMm * 0.5, wStep = niceStep(wMax / 250);
    cur = {
      items, skipped, whole, mode, sel: selKey(whole ? [] : picked), at: 0, op: null, fit: true,
      o: {
        width: o.width_mm >= 0 ? o.width_mm : round(pref('widthShare') * lead.sizeMm, wStep),
        axis: ['x', 'y', 'z'].includes(o.axis) ? o.axis : 'auto',
        segments: o.segments > 2 ? Math.round(o.segments) : (_Prefs.get('roundSegments') > 2 ? Math.round(_Prefs.get('roundSegments')) : 0),
        smooth: o.smooth_deg >= 0 ? o.smooth_deg : (() => { const a = items.map(it => getPart(it.partId)?.shadeAngle); return a.every(x => Number.isFinite(x) && x === a[0]) ? a[0] : DEF.smooth; })(),
      },
    };
    if (!o.quiet) {
      wire();
      viewOf().reset(null); viewOf().setEdit(false);
      scrub('width', 'rc-width-scrub', mode === 'belt' ? 'Fill gaps up to' : 'Fill grooves up to', 0, wMax, wStep, 'mm');
      // (Segments around: 0 shows as the part's own, which the readout names)
      if (!(cur.o.segments > 2)) cur.o.segments = 0;
      scrub('segments', 'rc-seg-scrub', 'Segments around', 0, 128, 1, '');
      scrub('smooth', 'rc-smooth-scrub', 'Shading angle', 0, 180, 1, '°');
      const lbl = $i('rc-run-lbl'); if (lbl) lbl.textContent = items.length > 1 ? 'Apply to ' + fmtNum(items.length) : 'Apply';
      const fl = document.querySelector('.section-cmd[data-cmd="round"] .cmd-ok span'); if (fl) fl.textContent = 'Apply';
      say('');
      _CmdCards.open('round');
    }
    preview();
    const res = { ok: true, parts: items.length, skipped, preview: summary() };
    if (o.apply) { await build(); const s = summary(); if (o.quiet) cur = null; return { ...res, applied: true, result: s }; }
    if (o.quiet) cur = null;
    return res;
  }
  // The card is open and another part is selected (before or after Apply): it moves to the new selection, as if opened there, in
  // the same mode. A step already applied stays as it is (its own undo); the view goes back from Wireframe; the new part starts at
  // Apply again. Nothing selected keeps the card where it is; a selection that does not fit is said once and the card stays.
  const selKey = (ids) => ids.map(String).sort().join('|');
  function follow() {
    if (!cur || !_CmdCards.isOpen('round')) return;
    const ids = [...state.selected], key = selKey(ids);
    if (!ids.length || key === cur.sel || key === selTried) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(async () => {
      if (!cur || !_CmdCards.isOpen('round')) return;
      if (busy) { follow(); return; }
      const now = [...state.selected], k = selKey(now);
      if (!now.length || k === cur.sel || k === selTried) return;
      selTried = k;
      clearTimeout(timer);
      await open({ ids: now, mode: cur.mode });
    }, 120);
  }
  function summary() {
    const it = itNow(), r = it && it.last; if (!r || !r.ok) return null;
    return { mode: cur.mode, axis: cur.mode === 'outline' ? (cur.o.axis || 'auto') : undefined, parts: cur.items.length, left_out: cur.skipped.length, name: it.name, grooves: r.grooves || 0, segments: r.N, edited: !!it.shapes,
      width_mm: cur.o.width, triangles_before: it.tris0, triangles_after: it.trisAfter || it.trisEst || undefined };
  }

  window.__moAgent = Object.assign(window.__moAgent || {}, {
    roundCard: (o) => open(o || {}),
    roundCardSet: (k, v) => (k === 'mode' ? setMode(v) : k === 'axis' ? setAxis(v) : changed(k, v, false)),
    roundCardState: () => (cur ? { mode: cur.mode, options: { ...cur.o }, applied: !!cur.op, edit: !!(view && view.editing), summary: summary() } : null),
    roundCardSection: () => { const it = itNow(); return it && it.last && it.last.ok ? it.last.after : null; },
  });
  return { open, follow };
}
