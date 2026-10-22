// The Profile: clean outline card. A profile (a window frame, an aluminium extrusion, a seal strip; straight or bent) is made one
// clean solid: the work on the cross-section is profile.js; this file is the card and the part that touches the scene.
//
// The card opens on the selection, or with nothing selected on every part that is shown (each is looked at, and the ones that are
// profiles are kept). It shows the cross-section of one of them as it is (grey) and as it will be (blue), with what the options do
// to it, before anything changes; ‹ › steps through them. The new section can be edited by hand (Edit points): a point dragged,
// one added on an edge (double-click), one taken out (Delete, or Alt-click); that part is then built from the section as edited.
// Apply builds every profile again, one undo step; after that the options build them again live in the same step, until undo or
// redo moves past it. The options are remembered (this browser): the gap width and the straightening as shares of the
// cross-section, so they suit a small seal and a big frame alike. The Shading angle is the part's own (the one in Properties): the
// card starts from it, and the parts it builds are shaded at it and keep it.
import { cleanProfile } from './profile.js?v=5';
import { runMeshOp } from './meshops.js?v=18';
import { sectionView } from './section-view.js?v=1';

// app: the objects and functions of app.js this card uses (see the call in app.js)
export function installProfileCard(app) {
  const {
    state, _Prefs, _CmdCards, initScrubber, toast, getPart, fmtNum, requestRender, pushUndo, settle,
    _roundGeom, _stampGeometry, _refreshPartBBox, _decSnap, _getEdgesGeom, _cadEdgesPartSwapped, _uvSetsOf, _disposeEdgesFor, _safeDispose, _nextFrame,
  } = app;
  const TITLE = 'Profile: clean outline';
  const DEF = { fill: true, machining: true, widthShare: 0.04, straightShare: 0.0002, smooth: 30 };      // (smooth: a part that has no Shading angle of its own)
  const $i = (id) => document.getElementById(id);
  const pref = (k) => { const v = _Prefs.get('profile.' + k); return v === undefined || v === null ? DEF[k] : v; };
  const area = (L) => { let s = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
  let cur = null, timer = 0, busy = false, again = false, wired = false, scanSeq = 0;
  const sc = {};

  // ── the parts ──
  const sourceOf = (p) => {
    const g = p.mesh.geometry, pa = g.attributes.position, P = new Float32Array(pa.count * 3);
    for (let v = 0; v < pa.count; v++) { P[3 * v] = pa.getX(v); P[3 * v + 1] = pa.getY(v); P[3 * v + 2] = pa.getZ(v); }
    p.mesh.updateWorldMatrix(true, false);
    const sv = p.mesh.getWorldScale(new p.mesh.scale.constructor());
    return {
      partId: p.partId, name: p.name, P, I: g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: pa.count }, (_, i) => i),
      UV: _uvSetsOf(g), mat: g.groups && g.groups.length ? (g.groups[0].materialIndex || 0) : -1,
      scale: Math.cbrt(Math.abs(sv.x * sv.y * sv.z)) || 1,                // (mm per part unit)
      tris0: p.triCount | 0, shapes: null, last: null, trisAfter: 0,
    };
  };
  const optsFor = (it, dry) => ({
    widthAbs: cur.o.width / it.scale, keepChambers: !cur.o.fill, simplifyAbs: cur.o.straight / it.scale, fillMachining: !!cur.o.machining, smoothDeg: cur.o.smooth, dryRun: !!dry,
    ...(it.shapes ? { shapes: it.shapes } : {}),
    ...(it.UV && !dry ? { uv: it.UV } : {}),
  });
  // triangles the new part will have: per wall edge two (per segment of the path, when it is bent), and the two caps (one loop of
  // n + 2 per chamber, less two per outline)
  const trisOf = (r) => {
    let walls = 0, m = 0, shapes = 0;
    for (const L of r.profileAfter) { walls += L.length; if (area(L) > 0) { shapes++; m += L.length; } else m += L.length + 2; }
    return 2 * walls * (r.pathSegments || 1) + 2 * (m - 2 * shapes);
  };
  const itNow = () => cur && cur.items[cur.at];

  // ── the preview, and the editor on it (section-view.js) ──
  let view = null;
  const viewOf = () => view || (view = sectionView($i('pf-svg'), {
    onEdit(shapes, fast) {
      const it = itNow(); if (!it) return;
      it.shapes = shapes; it.edited = true;
      preview(fast);
      if (!fast && cur.op) { clearTimeout(timer); timer = setTimeout(build, 160); }
    },
  }));
  function draw(fit) {
    const it = itNow(), r = it && it.last;
    viewOf().show(r && r.ok ? { before: r.profileBefore, after: r.profileAfter, shapes: r.shapesAfter } : null, fit);
  }
  function markEdited() {
    const it = itNow(), on = !!(it && it.shapes), ed = !!(view && view.editing);
    const r = $i('pf-edit-reset'); if (r) r.hidden = !on;
    const h = $i('pf-edit-hint'); if (h) h.textContent = ed ? 'Drag a point (it snaps to the profile as it was; Shift: free) · double-click an edge to add one · Delete or Alt-click takes one out' + (on ? ' · this part is built from the section as edited; the options no longer change it' : '') : (on ? 'Built from the section as edited by hand.' : '');
    const btn = $i('pf-edit'); if (btn) btn.classList.toggle('is-on', ed);
  }

  const mm = (v) => fmtNum(v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100) + ' mm';
  function stats() {
    const box = $i('pf-stats'), it = itNow(), r = it && it.last; if (!box) return;
    if (!r || !r.ok) { box.innerHTML = ''; return; }
    const row = (k, v) => '<dt>' + k + '</dt><dd>' + v + '</dd>';
    box.innerHTML = (cur.items.length > 1 || cur.skipped.length ? row('Profiles', fmtNum(cur.items.length) + (cur.skipped.length ? ' · ' + fmtNum(cur.skipped.length) + ' other ' + (cur.skipped.length === 1 ? 'part' : 'parts') + ' left as they are' : '')) : '')
      + row(r.curved ? 'Path' : 'Axis', (r.curved ? 'bent, ' + r.pathSegments + ' segments' : (r.axisName || 'tilted')) + ' · ' + mm(r.length * it.scale))
      + row('Ends', r.mitred ? r.endAngles.map(v => (v ? v + '°' : 'square')).join(' and ') : 'square')
      + row('Cross-section', mm(r.sectionSize * it.scale) + ' across')
      + (r.machined ? row('Holes and cuts across', 'filled') : '')
      + row('Chambers', r.edited ? 'as edited' : r.chambersFound ? r.chambersFound + (cur.o.fill ? ' filled' : ' kept') : 'none')
      + row('Gaps closed', r.edited ? 'as edited' : r.notches ? String(r.notches) : 'none')
      + row('Triangles', fmtNum(it.tris0) + ' → ' + fmtNum(it.trisAfter || trisOf(r)) + (cur.items.length > 1 ? ' (this part)' : ''));
  }
  const say = (t) => { const el = $i('pf-info'); if (el) el.textContent = t; };
  const alive = () => cur && cur.op && state.history[state.history.length - 1] === cur.op;

  // fast: while a point is dragged only the drawing changes (the rest when it is let go)
  function preview(fast) {
    if (!cur) return;
    const it = itNow();
    let r; try { r = cleanProfile(it.P, it.I, optsFor(it, true)); } catch (e) { r = { ok: false, why: e.message }; }
    it.last = r;
    draw(cur.fit); cur.fit = false;
    if (fast) return;
    stats(); markEdited();
    const n = $i('pf-name'); if (n) n.textContent = it.name;
    const pos = $i('pf-pos'); if (pos) pos.textContent = (cur.at + 1) + ' of ' + cur.items.length;
    const st = $i('pf-step'); if (st) st.hidden = cur.items.length < 2;
  }
  function step(d) {
    if (!cur || cur.items.length < 2) return;
    cur.at = (cur.at + d + cur.items.length) % cur.items.length;
    viewOf().reset(itNow().shapes); cur.fit = true;
    preview();
  }

  // ── build the parts ──
  async function build() {
    if (!cur) return;
    if (busy) { again = true; return; }
    if (cur.op && !alive()) { say('This step is no longer the last one (undo or redo moved past it), so the options change nothing now.'); return; }
    busy = true; again = false;
    const btn = $i('pf-run'); if (btn) btn.disabled = true;
    const freed = [], undoItems = [], bad = [];
    try {
      let n = 0;
      for (const it of cur.items) {
        if (cur.items.length > 4) say('Building ' + (++n) + ' of ' + cur.items.length + '…');
        const p = getPart(it.partId); if (!p || p.deleted || !p.mesh) continue;
        let r; try { r = await runMeshOp('cleanProfile', it.P.slice(), it.I.slice(), optsFor(it, false)); } catch (e) { r = { ok: false, why: e.message || String(e) }; }
        if (!r || !r.ok) { bad.push(it.name + ': ' + ((r && r.why) || 'it could not be done')); continue; }
        const before = cur.op ? null : _decSnap(p);
        const out = _roundGeom(r, it.mat, p.mesh.geometry), old = p.mesh.geometry, oldHash = p.hash, hash = 'pf_' + (state._decSeq = (state._decSeq | 0) + 1);
        try { _getEdgesGeom(out); } catch (_) {}
        state.geomByHash.set(hash, out);
        p.mesh.geometry = _stampGeometry(out); p.hash = hash;
        p.triCount = r.index.length / 3; p.vertCount = r.positions.length / 3; it.trisAfter = p.triCount;
        p.shadeAngle = cur.o.smooth;                                    // (shaded at it: Properties shows it, and starts from it)
        _refreshPartBBox(p); p._fp = null; p._fpKey = null;
        try { _cadEdgesPartSwapped(p); } catch (_) {}
        if (cur.op) {                                                   // again, in the same step: the geometry it replaces was ours
          const u = cur.op.items.find(x => x.partId === it.partId);
          if (u) u.after = _decSnap(p); else cur.op.items.push({ partId: p.partId, before: null, after: _decSnap(p) });
          if (oldHash && state.geomByHash.get(oldHash) === old) state.geomByHash.delete(oldHash);
          freed.push(old);
        } else undoItems.push({ partId: p.partId, before, after: _decSnap(p) });
        if (n % 4 === 0) await _nextFrame();
      }
      if (!cur.op && undoItems.length) { cur.op = { type: 'decimate', label: TITLE, items: undoItems }; pushUndo(cur.op); }
    } finally { busy = false; if (btn) btn.disabled = false; }
    settle();
    (async () => { await _nextFrame(); await _nextFrame(); for (const g of freed) { try { _disposeEdgesFor(g, false); } catch (_) {} try { _safeDispose(g); } catch (_) {} } })();
    if (cur && cur.op) {
      const tb = cur.items.reduce((s, x) => s + x.tris0, 0), ta = cur.items.reduce((s, x) => s + (x.trisAfter || x.tris0), 0);
      say('Built ' + (cur.items.length > 1 ? fmtNum(cur.items.length) + ' profiles ' : '') + '· ' + fmtNum(tb) + ' → ' + fmtNum(ta) + ' triangles. The options now build ' + (cur.items.length > 1 ? 'them' : 'it') + ' again; Ctrl+Z takes the whole step back.');
      const lbl = $i('pf-run-lbl'); if (lbl) lbl.textContent = 'Done';
      const fl = document.querySelector('.section-cmd[data-cmd="profile"] .cmd-ok span'); if (fl) fl.textContent = 'Done';
    }
    if (bad.length) toast(TITLE, bad[0] + (bad.length > 1 ? ' (and ' + (bad.length - 1) + ' more)' : ''), 'warn', 6000);
    if (cur) preview();
    if (again) build();
  }

  // an option changed: the preview at once, and the parts again (after Apply) when it rests
  function changed(k, v, fromCtl) {
    if (!cur) return;
    cur.o[k] = v;
    const it = itNow(), r0 = it && it.last, sec = r0 && r0.ok ? r0.sectionSize * it.scale : 0;
    if (k === 'fill' || k === 'machining') _Prefs.set('profile.' + k, !!v);
    else if (k === 'smooth') {}                                         // (the part's own setting, not the card's)
    else if (sec > 0) _Prefs.set(k === 'width' ? 'profile.widthShare' : 'profile.straightShare', v / sec);
    if (!fromCtl && sc[k]) sc[k].setValue(v);
    if (!fromCtl && (k === 'fill' || k === 'machining')) { const c = $i(k === 'fill' ? 'pf-fill' : 'pf-machining'); if (c) c.checked = !!v; }
    preview();
    if (cur.op) { clearTimeout(timer); timer = setTimeout(build, 160); }
  }

  function wire() {
    if (wired) return; wired = true;
    const sec = document.querySelector('.section-cmd[data-cmd="profile"]');
    $i('pf-fill')?.addEventListener('change', (e) => changed('fill', !!e.target.checked, true));
    $i('pf-machining')?.addEventListener('change', (e) => { changed('machining', !!e.target.checked, true); if (cur && !cur.op) rescan(); });
    $i('pf-run')?.addEventListener('click', () => { if (cur && cur.op) _CmdCards.close('profile'); else build(); });
    $i('pf-prev')?.addEventListener('click', () => step(-1));
    $i('pf-next')?.addEventListener('click', () => step(1));
    $i('pf-edit')?.addEventListener('click', () => { if (!cur) return; viewOf().setEdit(!view.editing); markEdited(); });
    $i('pf-edit-reset')?.addEventListener('click', () => { const it = itNow(); if (!it) return; it.shapes = null; it.edited = false; viewOf().reset(null); preview(); if (cur.op) { clearTimeout(timer); timer = setTimeout(build, 160); } });
    $i('pf-reset')?.addEventListener('click', () => {
      const it = itNow(); if (!cur || !it) return; const s = it.last && it.last.ok ? it.last.sectionSize * it.scale : 0;
      changed('fill', DEF.fill); changed('machining', DEF.machining); changed('smooth', DEF.smooth);
      if (s > 0) { changed('width', round(DEF.widthShare * s, cur.wStep)); changed('straight', round(DEF.straightShare * s, cur.sStep)); }
    });
    sec?.addEventListener('cmd-close', () => { clearTimeout(timer); scanSeq++; cur = null; });
  }
  const niceStep = (x) => { const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; };
  const round = (v, step) => Math.round(v / step) * step;
  const decOf = (step) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  // a scrubber for one option, built again for each opening (its range follows the size of the cross-section)
  function scrub(key, el, label, max, step, unit) {
    const box = $i(el); if (!box) return;
    box.textContent = '';
    const steps = Math.max(1, Math.round(max / step)), dec = decOf(step);
    sc[key] = initScrubber({
      el: box, label, maxSteps: steps, stepToVal: (st) => +(st * step).toFixed(dec), valToStep: (v) => Math.max(0, Math.min(steps, Math.round(v / step))),
      format: (v) => ({ value: (+v).toFixed(dec), unit }), initialValue: cur.o[key], promptTitle: label, promptUnit: unit, onChange: (v) => changed(key, v, true),
    });
  }

  // ── open ──
  // Which parts are profiles: each is looked at in turn, a few at a time, so the page stays live on a big scene.
  async function scan(parts, machining, quiet, seq) {
    const items = [], skipped = [];
    for (let i = 0; i < parts.length; i++) {
      if (seq !== scanSeq) return null;
      const p = parts[i], it = sourceOf(p);
      let r; try { r = cleanProfile(it.P, it.I, { dryRun: true, widthAbs: 0, fillMachining: machining }); } catch (e) { r = { ok: false, why: e.message }; }
      if (r.ok) items.push(it); else skipped.push({ name: p.name, why: r.why });
      if (!quiet && parts.length > 6 && i % 6 === 5) { say('Looking for profiles · ' + (i + 1) + ' of ' + parts.length + ' parts…'); await _nextFrame(); }
    }
    return { items, skipped };
  }
  function partsFor(o) {
    const picked = o.ids && o.ids.length ? o.ids : [...state.selected];
    const whole = !picked.length;
    const list = whole ? state.parts.filter(p => p && !p.deleted && p.visible !== false && p.mesh) : picked.map(id => getPart(id));
    return { whole, parts: list.filter(p => p && !p.deleted && p.mesh && p.mesh.geometry && p.mesh.geometry.attributes.position && !p.isSpline && !p.isCloner) };
  }
  // o (for Claude and tests): { ids, width_mm, keep_chambers, fill_machining, straighten_mm, smooth_deg, apply (build at once), quiet (no card) }
  async function open(o = {}) {
    const { whole, parts } = partsFor(o);
    if (!parts.length) { if (!o.quiet) toast(TITLE, whole ? 'Open a model first' : 'Select a profile first', 'info', 2500); return { ok: false, why: 'nothing to look at' }; }
    const machining = o.fill_machining !== undefined ? !!o.fill_machining : !!pref('machining');
    const seq = ++scanSeq;
    if (!o.quiet && whole) toast(TITLE, 'Nothing selected: looking for profiles among the ' + fmtNum(parts.length) + ' parts shown', 'info', 3000);
    const found = await scan(parts, machining, !!o.quiet, seq);
    if (!found) return { ok: false, why: 'stopped' };
    const { items, skipped } = found;
    if (!items.length) { if (!o.quiet) toast(TITLE, (skipped.length === 1 ? skipped[0].name + ' was left as it was: ' : 'None of the ' + skipped.length + ' parts is a profile: ') + skipped[0].why, 'warn', 7000); return { ok: false, why: skipped[0].why, skipped }; }
    clearTimeout(timer);
    const lead = items[0], r0 = cleanProfile(lead.P, lead.I, { dryRun: true, widthAbs: 0, fillMachining: machining });
    const secMm = r0.sectionSize * lead.scale;
    const wMax = secMm * 0.25, wStep = niceStep(wMax / 250), sMax = secMm * 0.01, sStep = niceStep(sMax / 100);
    cur = {
      items, skipped, whole, ids: whole ? null : parts.map(p => p.partId), at: 0, op: null, wStep, sStep, fit: true,
      o: {
        fill: o.keep_chambers !== undefined ? !o.keep_chambers : !!pref('fill'),
        machining,
        width: o.width_mm >= 0 ? o.width_mm : round(pref('widthShare') * secMm, wStep),
        straight: o.straighten_mm >= 0 ? o.straighten_mm : round(pref('straightShare') * secMm, sStep),
        // the parts' own Shading angle when they agree (as Properties shows it), else the default
        smooth: o.smooth_deg >= 0 ? o.smooth_deg : (() => { const a = items.map(it => getPart(it.partId)?.shadeAngle); return a.every(x => Number.isFinite(x) && x === a[0]) ? a[0] : DEF.smooth; })(),
      },
    };
    if (skipped.length && !o.quiet && !whole) toast(TITLE, skipped.length + (skipped.length === 1 ? ' part is' : ' parts are') + ' not a profile and will be left as ' + (skipped.length === 1 ? 'it is' : 'they are') + ': ' + skipped[0].why, 'info', 6000);
    if (!o.quiet) {
      wire();
      viewOf().reset(null); viewOf().setEdit(false);
      const c = $i('pf-fill'); if (c) c.checked = cur.o.fill;
      const m = $i('pf-machining'); if (m) m.checked = cur.o.machining;
      scrub('width', 'pf-width-scrub', 'Fill gaps up to', wMax, wStep, 'mm');
      scrub('straight', 'pf-straight-scrub', 'Straighten up to', sMax, sStep, 'mm');
      scrub('smooth', 'pf-smooth-scrub', 'Shading angle', 180, 1, '°');
      const lbl = $i('pf-run-lbl'); if (lbl) lbl.textContent = items.length > 1 ? 'Apply to ' + fmtNum(items.length) : 'Apply';
      const fl = document.querySelector('.section-cmd[data-cmd="profile"] .cmd-ok span'); if (fl) fl.textContent = 'Apply';
      say('');
      _CmdCards.open('profile');
    }
    preview();
    const res = { ok: true, parts: items.length, skipped, preview: summary() };
    if (o.apply) { await build(); const s = summary(); if (o.quiet) cur = null; return { ...res, applied: true, result: s }; }
    if (o.quiet) cur = null;
    return res;
  }
  // Fill holes and cuts across switched before Apply: the parts are looked at again (more, or fewer, are profiles now)
  async function rescan() {
    if (!cur) return;
    const k = cur.o;
    return open({ ids: cur.ids, fill_machining: k.machining, width_mm: k.width, straighten_mm: k.straight, keep_chambers: !k.fill, smooth_deg: k.smooth });
  }
  function summary() {
    const it = itNow(), r = it && it.last; if (!r || !r.ok) return null;
    return { profiles: cur.items.length, left_out: cur.skipped.length, at: cur.at, name: it.name, axis: r.curved ? 'bent path' : (r.axisName || 'tilted'), end_angles_deg: r.endAngles, length_mm: +(r.length * it.scale).toFixed(3),
      machined: !!r.machined, edited: !!r.edited, chambers_found: r.chambersFound, chambers_filled: r.chambers, gaps_closed: r.notches,
      width_mm: cur.o.width, triangles_before: cur.items.reduce((s, x) => s + x.tris0, 0), triangles_after: cur.items.reduce((s, x) => s + (x.trisAfter || 0), 0) || undefined };
  }

  window.__moAgent = Object.assign(window.__moAgent || {}, {
    cleanProfile: (o) => open(o || {}),
    profileSet: (k, v) => changed(k, v, false),
    profileStep: (d) => { step(d); return summary(); },
    // (for tests: the section of the part shown, as it will be built, and an edit to it)
    profileSection: () => { const it = itNow(); return it && it.last && it.last.ok ? (it.shapes || it.last.shapesAfter) : null; },
    profileEdit: (shapes) => { const it = itNow(); if (!it) return null; it.shapes = shapes; it.edited = true; viewOf().reset(shapes); preview(); if (cur.op) build(); return summary(); },
    profileState: () => (cur ? { options: { ...cur.o }, applied: !!cur.op, edit: !!(view && view.editing), summary: summary() } : null),
  });
  return { open };
}
