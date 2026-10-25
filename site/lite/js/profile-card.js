// The Profile: clean outline card. A profile (a window frame, an aluminium extrusion, a seal strip; straight or bent) is made one
// clean solid: the work on the cross-section is profile.js; this file is the card and the part that touches the scene.
//
// The card opens on the selection, or with nothing selected on every part that is shown (each is looked at, and the ones that are
// profiles are kept). It shows the cross-section of one of them as it is (grey) and as it will be (blue), with what the options do
// to it, before anything changes; ‹ › steps through them. The new section can be edited by hand (Edit points): a point dragged,
// one added on an edge (double-click), one taken out (Delete, or Alt-click); that part is then built from the section as edited.
// Apply builds every profile again, one undo step; after that the options build them again live in the same step, until undo or
// redo moves past it. The options are remembered (this browser): the gap width, the straightening, the rounding, the growth and
// the chamber and hole sizes as shares of the cross-section, so they suit a small seal and a big frame alike. The ends and the
// extension are not remembered (they are for the parts in hand). An edit by hand goes, with Same edit on matching profiles, to every
// other profile whose section is the same (section2d.js matchSection: turned or mirrored, any length). The Shading angle is the part's own (the one in Properties): the
// card starts from it, and the parts it builds are shaded at it and keep it.
import { cleanProfile } from './profile.js?v=8';
import { matchSection, moveShapes } from './section2d.js?v=1';
import { runMeshOp } from './meshops.js?v=19';
import { sectionView } from './section-view.js?v=9';

// app: the objects and functions of app.js this card uses (see the call in app.js)
export function installProfileCard(app) {
  const {
    state, _Prefs, _CmdCards, initScrubber, toast, getPart, fmtNum, requestRender, pushUndo, settle,
    _roundGeom, _stampGeometry, _refreshPartBBox, _decSnap, _getEdgesGeom, _cadEdgesPartSwapped, _uvSetsOf, _disposeEdgesFor, _safeDispose, _nextFrame, _Job, _swapPartGeometry,
  } = app;
  const TITLE = 'Profile: clean outline';
  const DEF = { fill: true, machining: true, widthShare: 0.04, straightShare: 0.0002, smooth: 30, roundShare: 0, offsetShare: 0, chamberShare: 0, holeShare: 0, symmetric: false, match: true, mitre: 45 };      // (smooth: a part that has no Shading angle of its own)
  // the options kept as a share of the cross-section, and the switches (with their checkbox)
  const SHARE = { width: 'widthShare', straight: 'straightShare', round: 'roundShare', offset: 'offsetShare', keepCh: 'chamberShare', keepHoles: 'holeShare' };
  const SWITCH = { fill: ['fill', 'pf-fill'], machining: ['machining', 'pf-machining'], sym: ['symmetric', 'pf-sym'], match: ['match', 'pf-match'] };
  const SIDES = [[1, 0], [0, 1], [-1, 0], [0, -1]];                   // (the short side of a mitre: right, top, left, bottom as drawn)
  const $i = (id) => document.getElementById(id);
  const pref = (k) => { const v = _Prefs.get('profile.' + k); return v === undefined || v === null ? DEF[k] : v; };
  const area = (L) => { let s = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
  let cur = null, timer = 0, busy = false, again = false, wired = false, scanSeq = 0, selTimer = 0, selTried = '';
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
    keepChambersAbs: cur.o.fill ? cur.o.keepCh / it.scale : 0, roundAbs: cur.o.round / it.scale, offsetAbs: cur.o.offset / it.scale, symmetric: !!cur.o.sym,
    endCut: { type: cur.o.ends, angle: cur.o.mitre, side: SIDES[cur.o.side] || SIDES[1] }, extend: [cur.o.extend / it.scale, cur.o.extend / it.scale],
    keepHolesAbs: cur.o.machining ? cur.o.keepHoles / it.scale : 0,
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
  // the undo and redo buttons in the preview's corner (shown while points are edited; lit when there is a step to go to)
  function histMarks() {
    const ed = !!(view && view.editing);
    for (const k of ['undo', 'redo']) { const b = $i('pf-' + k); if (!b) continue; b.hidden = !ed; b.disabled = !(view && (k === 'undo' ? view.canUndo : view.canRedo)); }
  }
  const viewOf = () => view || (view = sectionView($i('pf-svg'), {
    onHistory: () => histMarks(),
    // (shapes null: the edit was taken back before there was one; crossed: an edge of it crosses another, drawn red, not built)
    onEdit(shapes, fast, crossed) {
      const it = itNow(); if (!it) return;
      it.shapes = shapes || null; it.edited = !!shapes; it.crossed = !!(shapes && crossed); it.editFrom = null;
      preview(fast);
      if (fast) return;
      spread(it); stats();
      if (it.crossed) { clearTimeout(timer); say('An edge of the section crosses another (drawn red): move a point so it does not, and it is built.'); cur.crossSaid = true; return; }
      if (cur.crossSaid) { say(''); cur.crossSaid = false; }
      if (cur.op) { clearTimeout(timer); timer = setTimeout(build, 160); }
    },
  }));
  // An edit by hand (or its reset) carried to every other profile whose section, as cut, is the same shape (turned or mirrored, at
  // most 0.3 % of its size off). A profile edited by hand itself keeps its own edit. Returns how many it went to.
  const sectionMm = (it) => {
    if (it.sec0 === undefined) { let r; try { r = cleanProfile(it.P, it.I, { dryRun: true, widthAbs: 0, fillMachining: cur.o.machining }); } catch (_) { r = null; } it.sec0 = r && r.ok ? { loops: r.profileBefore.map(L => L.map(p => [p[0] * it.scale, p[1] * it.scale])), size: r.sectionSize * it.scale } : null; }
    return it.sec0;
  };
  function spread(src) {
    if (!cur || cur.items.length < 2) return 0;
    let n = 0;
    for (const it of cur.items) {
      if (it === src) continue;
      if (it.editFrom === src && (!cur.o.match || !src.shapes)) { it.shapes = null; it.edited = false; it.crossed = false; it.editFrom = null; continue; }
      if (!cur.o.match || !src.shapes || (it.edited && it.editFrom !== src)) continue;
      const A = sectionMm(src), B = sectionMm(it); if (!A || !B) continue;
      src.matchTo = src.matchTo || new Map();
      let m = src.matchTo.get(it); if (m === undefined) { m = matchSection(A.loops, B.loops, A.size * 3e-3); src.matchTo.set(it, m); }
      if (!m) continue;
      const mm = src.shapes.map(S => ({ outer: S.outer.map(p => [p[0] * src.scale, p[1] * src.scale]), holes: (S.holes || []).map(H => H.map(p => [p[0] * src.scale, p[1] * src.scale])) }));
      it.shapes = moveShapes(mm, m).map(S => ({ outer: S.outer.map(p => [p[0] / it.scale, p[1] / it.scale]), holes: S.holes.map(H => H.map(p => [p[0] / it.scale, p[1] / it.scale])) }));
      it.edited = true; it.crossed = !!src.crossed; it.editFrom = src; n++;
    }
    src.copies = n;
    return n;
  }
  function draw(fit) {
    const it = itNow(), r = it && it.last;
    viewOf().show(r && r.ok ? { before: r.profileBefore, after: r.profileAfter, shapes: r.shapesAfter } : null, fit);
  }
  function markEdited() {
    const it = itNow(), on = !!(it && it.shapes), ed = !!(view && view.editing);
    const r = $i('pf-edit-reset'); if (r) r.hidden = !on;
    const h = $i('pf-edit-hint'); if (h) h.textContent = !on ? '' : it.editFrom ? 'The same edit as ' + it.editFrom.name + ' (a matching profile); the section options no longer change it.' : 'Built from the section as edited by hand; the section options no longer change it.' + (it.copies ? ' The same edit goes to ' + fmtNum(it.copies) + ' matching ' + (it.copies === 1 ? 'profile' : 'profiles') + '.' : '');      // (how to edit: the view's label)
    const btn = $i('pf-edit'); if (btn) btn.classList.toggle('is-on', ed);
    histMarks();
  }

  const mm = (v) => fmtNum(v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100) + ' mm';
  function stats() {
    const box = $i('pf-stats'), it = itNow(), r = it && it.last; if (!box) return;
    if (!r || !r.ok) { box.innerHTML = ''; return; }
    const row = (k, v) => '<dt>' + k + '</dt><dd>' + v + '</dd>';
    box.innerHTML = (cur.items.length > 1 || cur.skipped.length ? row('Profiles', fmtNum(cur.items.length) + (cur.skipped.length ? ' · ' + fmtNum(cur.skipped.length) + ' other ' + (cur.skipped.length === 1 ? 'part' : 'parts') + ' left as they are' : '')) : '')
      + row(r.curved ? 'Path' : 'Axis', (r.curved ? 'bent, ' + r.pathSegments + ' segments' : (r.axisName || 'tilted')) + ' · ' + mm(r.length * it.scale) + (Math.abs(r.lengthAfter - r.lengthFound) * it.scale > 1e-6 ? ' → ' + mm(r.lengthAfter * it.scale) : ''))
      + row('Ends', (r.mitred ? r.endAngles.map(v => (v ? v + '°' : 'square')).join(' and ') : 'square') + (r.endCutIgnored ? ' (a bent profile keeps them square)' : ''))
      + row('Cross-section', mm(r.sectionSize * it.scale) + ' across')
      + (r.machined ? row('Holes and cuts across', cur.o.keepHoles > 0 ? (it.holesKept != null ? (it.holesKept ? fmtNum(it.holesKept) + ' kept, the rest filled' : 'none wide enough, all filled') : 'filled; the wide ones are cut again on Apply') : 'filled') : '')
      + row('Chambers', r.edited ? 'as edited' : r.chambersFound ? (!cur.o.fill ? r.chambersFound + ' kept' : r.chambersKept ? (r.chambersFound - r.chambersKept) + ' filled, ' + r.chambersKept + ' kept' : r.chambersFound + ' filled') : 'none')
      + (cur.o.sym && !r.edited ? row('Symmetry', r.symmetry && r.symmetry.made ? 'made exact (' + mm(r.symmetry.off * it.scale) + ' off before)' : r.symmetry && r.symmetry.off != null ? 'not symmetric (' + mm(r.symmetry.off * it.scale) + ' off), left as it is' : 'not symmetric') : '')
      + (cur.items.length > 1 && cur.o.match && it.copies ? row('Same edit on', fmtNum(it.copies) + ' matching ' + (it.copies === 1 ? 'profile' : 'profiles')) : '')
      + row('Gaps closed', r.edited ? 'as edited' : r.notches ? String(r.notches) : 'none')
      + row('Triangles', fmtNum(it.tris0) + ' → ' + fmtNum(it.trisAfter || trisOf(r)) + (cur.items.length > 1 ? ' (this part)' : ''));
  }
  const say = (t) => { const el = $i('pf-info'); if (el) el.textContent = t; };
  // The step this card applied was undone (Ctrl+Z): the card is as it was before Apply, and Apply builds it again. Redone: it is Done again.
  document.addEventListener('mo-history', () => {
    if (!cur) return;
    const top = state.history[state.history.length - 1], setLbl = (t) => {
      const lbl = $i('pf-run-lbl'); if (lbl) lbl.textContent = t;
      const fl = document.querySelector('.section-cmd[data-cmd="profile"] .cmd-ok span'); if (fl) fl.textContent = t;
    };
    if (cur.op && top !== cur.op && state.redo && state.redo.includes(cur.op)) {
      clearTimeout(timer); cur.undone = cur.op; cur.op = null;
      setLbl(cur.items.length > 1 ? 'Apply to ' + fmtNum(cur.items.length) : 'Apply'); say(''); preview();
    } else if (!cur.op && cur.undone && top === cur.undone) {
      cur.op = cur.undone; cur.undone = null; setLbl('Done'); preview();
    }
  });
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
  // build is called by Apply, by the options and by the timer. While it works another call is kept for after (as it always was), and it
  // takes the app's one-job lock, so another tool cannot start in between.
  function build() { if (!cur) return Promise.resolve(); if (busy) { again = true; return Promise.resolve(); } return _Job.run(TITLE, () => build_job()); }
  async function build_job() {
    if (!cur) return;
    if (busy) { again = true; return; }
    if (cur.op && !alive()) { say('This step is no longer the last one (undo or redo moved past it), so the options change nothing now.'); return; }
    busy = true; again = false;
    const btn = $i('pf-run'); if (btn) btn.disabled = true;
    const freed = [], undoItems = [], bad = []; let built = 0;      // (built: how many were really made this time; one that crosses itself is skipped with a warning)
    try {
      let n = 0;
      for (const it of cur.items) {
        if (cur.items.length > 4) say('Building ' + (++n) + ' of ' + cur.items.length + '…');
        const p = getPart(it.partId); if (!p || p.deleted || !p.mesh) continue;
        if (it.crossed) { bad.push(it.name + ': its section as edited crosses itself'); continue; }
        let r; try { r = await runMeshOp('cleanProfile', it.P.slice(), it.I.slice(), optsFor(it, false)); } catch (e) { r = { ok: false, why: e.message || String(e) }; }
        if (!r || !r.ok) { bad.push(it.name + ': ' + ((r && r.why) || 'it could not be done')); continue; }
        it.holesKept = r.holesKept != null ? r.holesKept : null;
        if (r.holesWhy) bad.push(it.name + ': holes not kept, ' + r.holesWhy);
        const before = cur.op ? null : _decSnap(p);
        const out = _roundGeom(r, it.mat, p.mesh.geometry);
        const { old, oldHash } = _swapPartGeometry(p, out, { prefix: 'pf' });
        it.trisAfter = p.triCount;
        p.shadeAngle = cur.o.smooth;                                    // (shaded at it: Properties shows it, and starts from it)
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
      say('Built ' + (built < cur.items.length ? fmtNum(built) + ' of ' + fmtNum(cur.items.length) + ' profiles (the others were left as they were: see the warning) ' : cur.items.length > 1 ? fmtNum(cur.items.length) + ' profiles ' : '') + '· ' + fmtNum(tb) + ' → ' + fmtNum(ta) + ' triangles. The options now build ' + (cur.items.length > 1 ? 'them' : 'it') + ' again; Ctrl+Z takes the whole step back.');
      const lbl = $i('pf-run-lbl'); if (lbl) lbl.textContent = 'Done';
      const fl = document.querySelector('.section-cmd[data-cmd="profile"] .cmd-ok span'); if (fl) fl.textContent = 'Done';
    }
    if (bad.length) toast(TITLE, bad[0] + (bad.length > 1 ? ' (and ' + (bad.length - 1) + ' more)' : ''), 'warn', 6000);
    if (cur) preview();
    if (again) return build_job();      // (inside the job: asking build() again would be turned away by its own lock)
  }

  // an option changed: the preview at once, and the parts again (after Apply) when it rests
  function changed(k, v, fromCtl) {
    if (!cur) return;
    cur.o[k] = v;
    const it = itNow(), r0 = it && it.last, sec = r0 && r0.ok ? r0.sectionSize * it.scale : 0;
    if (SWITCH[k]) _Prefs.set('profile.' + SWITCH[k][0], !!v);
    else if (k === 'mitre') _Prefs.set('profile.mitre', v);
    else if (SHARE[k] && sec > 0) _Prefs.set('profile.' + SHARE[k], v / sec);   // (smooth is the part's own setting; ends, side and extend are for the parts in hand)
    if (!fromCtl && sc[k]) sc[k].setValue(v);
    if (!fromCtl && SWITCH[k]) { const c = $i(SWITCH[k][1]); if (c) c.checked = !!v; }
    if (k === 'match') for (const x of cur.items) if (x.shapes && !x.editFrom) spread(x);
    if (k === 'machining') for (const x of cur.items) x.holesKept = null;
    shows();
    preview();
    if (cur.op) { clearTimeout(timer); timer = setTimeout(build, 160); }
  }

  // what shows: the mitre's angle and side with Mitre, the chamber size with Fill chambers, the hole size with Fill holes, the match
  // switch with more than one profile
  function shows() {
    if (!cur) return;
    for (const b of document.querySelectorAll('#pf-ends button')) { const on = b.dataset.e === cur.o.ends; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    for (const b of document.querySelectorAll('#pf-side button')) { const on = +b.dataset.s === cur.o.side; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const hide = (id, h) => { const el = $i(id); if (el) el.hidden = !!h; };
    hide('pf-mitre-row', cur.o.ends !== 'mitre'); hide('pf-keepch-row', !cur.o.fill); hide('pf-keepholes-row', !cur.o.machining); hide('pf-match-row', cur.items.length < 2);
  }
  function wire() {
    if (wired) return; wired = true;
    const sec = document.querySelector('.section-cmd[data-cmd="profile"]');
    $i('pf-fill')?.addEventListener('change', (e) => changed('fill', !!e.target.checked, true));
    $i('pf-sym')?.addEventListener('change', (e) => changed('sym', !!e.target.checked, true));
    // the readout is folded away (Details); opened, it stays open the next time
    const more = $i('pf-more'); if (more) { more.open = !!_Prefs.get('profile.details'); more.addEventListener('toggle', () => _Prefs.set('profile.details', more.open)); }
    $i('pf-match')?.addEventListener('change', (e) => changed('match', !!e.target.checked, true));
    for (const b of document.querySelectorAll('#pf-ends button')) b.addEventListener('click', () => changed('ends', b.dataset.e));
    for (const b of document.querySelectorAll('#pf-side button')) b.addEventListener('click', () => changed('side', +b.dataset.s));
    $i('pf-machining')?.addEventListener('change', (e) => { changed('machining', !!e.target.checked, true); if (cur && !cur.op) rescan(); });
    $i('pf-run')?.addEventListener('click', () => { if (cur && cur.op) _CmdCards.close('profile'); else build(); });
    $i('pf-prev')?.addEventListener('click', () => step(-1));
    $i('pf-next')?.addEventListener('click', () => step(1));
    $i('pf-edit')?.addEventListener('click', () => { if (!cur) return; viewOf().setEdit(!view.editing); markEdited(); });
    for (const k of ['undo', 'redo']) $i('pf-' + k)?.addEventListener('click', () => { if (!cur || !view) return; view[k](); $i('pf-svg')?.focus({ preventScroll: true }); });
    $i('pf-edit-reset')?.addEventListener('click', () => { const it = itNow(); if (!it) return; it.shapes = null; it.edited = false; it.crossed = false; it.editFrom = null; spread(it); viewOf().reset(null, true); preview(); if (cur.op) { clearTimeout(timer); timer = setTimeout(build, 160); } });
    $i('pf-reset')?.addEventListener('click', () => {
      const it = itNow(); if (!cur || !it) return; const s = it.last && it.last.ok ? it.last.sectionSize * it.scale : 0;
      changed('fill', DEF.fill); changed('machining', DEF.machining); changed('smooth', DEF.smooth); changed('sym', DEF.symmetric); changed('match', DEF.match);
      changed('ends', 'found'); changed('mitre', DEF.mitre); changed('side', 1); changed('extend', 0);
      changed('round', 0); changed('offset', 0); changed('keepCh', 0); changed('keepHoles', 0);
      if (s > 0) { changed('width', round(DEF.widthShare * s, cur.wStep)); changed('straight', round(DEF.straightShare * s, cur.sStep)); }
    });
    sec?.addEventListener('cmd-close', () => { clearTimeout(timer); clearTimeout(selTimer); scanSeq++; cur = null; });
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
      el: box, label, bar: true, maxSteps: steps, stepToVal: (st) => +(st * step).toFixed(dec), valToStep: (v) => Math.max(0, Math.min(steps, Math.round(v / step))),
      format: (v) => ({ value: (+v).toFixed(dec), unit }), initialValue: cur.o[key], promptTitle: label, promptUnit: unit, onChange: (v) => changed(key, v, true),
    });
  }

  function scrubBoth(key, el, label, max, step, unit) {
    const box = $i(el); if (!box) return;
    box.textContent = '';
    const half = Math.max(1, Math.round(max / step)), dec = decOf(step);
    sc[key] = initScrubber({
      el: box, label, bar: true, zero: half, maxSteps: 2 * half, stepToVal: (st) => +((st - half) * step).toFixed(dec), valToStep: (v) => Math.max(0, Math.min(2 * half, Math.round(v / step) + half)),
      format: (v) => ({ value: (+v).toFixed(dec), unit }), initialValue: cur.o[key], promptTitle: label, promptUnit: unit, onChange: (v) => changed(key, v, true),
    });
  }

  // ── open ──
  // Which parts are profiles: each is looked at in turn, a few at a time, so the page stays live on a big scene.
  // (The page is given back after about 40 ms of work, not after a fixed number of parts: a few heavy parts freeze it as much as many light ones.)
  async function scan(parts, machining, quiet, seq) {
    const items = [], skipped = [];
    let t0 = performance.now();
    for (let i = 0; i < parts.length; i++) {
      if (seq !== scanSeq) return null;
      const p = parts[i];
      let it = null, r;
      try { it = sourceOf(p); r = cleanProfile(it.P, it.I, { dryRun: true, widthAbs: 0, fillMachining: machining }); } catch (e) { r = { ok: false, why: (e && e.message) || 'it could not be read' }; }
      if (r && r.ok && it) items.push(it); else skipped.push({ name: p.name, why: (r && r.why) || 'it is not a profile' });
      if (parts.length > 1 && performance.now() - t0 > 40) {
        if (!quiet) say('Looking for profiles · ' + (i + 1) + ' of ' + parts.length + ' parts…');
        await _nextFrame(); t0 = performance.now();
      }
    }
    return { items, skipped };
  }
  // The reasons parts were left out, said once each with how many: "3 parts: an end is not one flat cut (…); 1 part: …"
  function whyOf(skipped) {
    const by = new Map();
    for (const s of skipped) { const e = by.get(s.why) || { n: 0, name: s.name }; e.n++; by.set(s.why, e); }
    const rows = [...by].sort((a, b) => b[1].n - a[1].n);
    const say1 = ([why, e]) => (skipped.length === 1 ? '' : e.n + (e.n === 1 ? ' part (' + e.name + ')' : ' parts') + ': ') + why;
    return rows.slice(0, 2).map(say1).join('; ') + (rows.length > 2 ? '; and ' + (rows.length - 2) + ' other ' + (rows.length === 3 ? 'reason' : 'reasons') : '');
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
    if (!items.length) { const w = whyOf(skipped); if (!o.quiet) toast(TITLE, (skipped.length === 1 ? skipped[0].name + ' was left as it was: ' : 'None of the ' + skipped.length + ' parts is a profile. ') + w, 'warn', 9000); return { ok: false, why: skipped[0].why, skipped }; }
    clearTimeout(timer);
    const lead = items[0], r0 = cleanProfile(lead.P, lead.I, { dryRun: true, widthAbs: 0, fillMachining: machining });
    const secMm = r0.sectionSize * lead.scale;
    const wMax = secMm * 0.25, wStep = niceStep(wMax / 250), sMax = secMm * 0.01, sStep = niceStep(sMax / 100);
    const oMax = secMm * 0.1, oStep = niceStep(oMax / 100), cMax = secMm * 0.5, cStep = niceStep(cMax / 250);
    const lenMm = r0.length * lead.scale, eMax = lenMm * 0.5, eStep = niceStep(eMax / 250);
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    selTried = '';
    cur = {
      items, skipped, whole, ids: whole ? null : parts.map(p => p.partId), sel: selKey(whole ? [] : (o.ids && o.ids.length ? o.ids : [...state.selected])), at: 0, op: null, wStep, sStep, fit: true,
      o: {
        fill: o.keep_chambers !== undefined ? !o.keep_chambers : !!pref('fill'),
        machining,
        width: o.width_mm >= 0 ? o.width_mm : round(pref('widthShare') * secMm, wStep),
        straight: o.straighten_mm >= 0 ? o.straighten_mm : round(pref('straightShare') * secMm, sStep),
        // the parts' own Shading angle when they agree (as Properties shows it), else the default
        smooth: o.smooth_deg >= 0 ? o.smooth_deg : (() => { const a = items.map(it => getPart(it.partId)?.shadeAngle); return a.every(x => Number.isFinite(x) && x === a[0]) ? a[0] : DEF.smooth; })(),
        round: o.round_mm >= 0 ? o.round_mm : round(pref('roundShare') * secMm, wStep),
        offset: num(o.offset_mm, round(pref('offsetShare') * secMm, oStep)),
        keepCh: o.keep_chambers_over_mm >= 0 ? o.keep_chambers_over_mm : round(pref('chamberShare') * secMm, cStep),
        keepHoles: o.keep_holes_over_mm >= 0 ? o.keep_holes_over_mm : round(pref('holeShare') * secMm, wStep),
        sym: o.symmetric !== undefined ? !!o.symmetric : !!pref('symmetric'),
        match: o.match !== undefined ? !!o.match : !!pref('match'),
        ends: ['found', 'square', 'mitre'].includes(o.ends) ? o.ends : 'found',
        mitre: num(o.mitre_deg, pref('mitre')),
        side: [0, 1, 2, 3].includes(o.mitre_side) ? o.mitre_side : 1,
        extend: num(o.extend_mm, 0),
      },
    };
    if (skipped.length && !o.quiet && !whole) toast(TITLE, fmtNum(items.length) + (items.length === 1 ? ' profile' : ' profiles') + ' found. ' + fmtNum(skipped.length) + (skipped.length === 1 ? ' part is' : ' parts are') + ' not a profile and will be left as ' + (skipped.length === 1 ? 'it is' : 'they are') + '. ' + whyOf(skipped), 'info', 8000);
    if (!o.quiet) {
      wire();
      viewOf().reset(null); viewOf().setEdit(false);
      for (const k in SWITCH) { const c = $i(SWITCH[k][1]); if (c) c.checked = !!cur.o[k]; }
      scrub('width', 'pf-width-scrub', 'Fill gaps up to', wMax, wStep, 'mm');
      scrub('round', 'pf-round-scrub', 'Round corners up to', wMax, wStep, 'mm');
      scrubBoth('offset', 'pf-offset-scrub', 'Grow outline by', oMax, oStep, 'mm');
      scrub('mitre', 'pf-mitre-scrub', 'Mitre angle', 75, 0.5, '°');
      scrubBoth('extend', 'pf-extend-scrub', 'Extend each end by', eMax, eStep, 'mm');
      scrub('keepCh', 'pf-keepch-scrub', 'Keep chambers wider than', cMax, cStep, 'mm');
      scrub('keepHoles', 'pf-keepholes-scrub', 'Keep holes wider than', wMax, wStep, 'mm');
      shows();
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
    return open({ ids: cur.ids, fill_machining: k.machining, width_mm: k.width, straighten_mm: k.straight, keep_chambers: !k.fill, smooth_deg: k.smooth, ...carried(),
      round_mm: k.round, offset_mm: k.offset, keep_chambers_over_mm: k.keepCh, keep_holes_over_mm: k.keepHoles, extend_mm: k.extend });
  }
  // The card is open and another part is selected (before or after Apply): it moves to the new selection, as if opened there,
  // keeping Fill chambers and Fill holes and cuts; the gap width and the straightening follow its cross-section. A step already
  // applied stays as it is (its own undo); the new part starts at Apply again. Nothing selected keeps the card where it is, and a
  // selection that is no profile is said once (the card stays on the part it had).
  const selKey = (ids) => ids.map(String).sort().join('|');
  // what goes with the card to other parts as it is (the sizes follow each section; the extension is for the parts in hand)
  const carried = () => ({ symmetric: cur.o.sym, match: cur.o.match, ends: cur.o.ends, mitre_deg: cur.o.mitre, mitre_side: cur.o.side });
  function follow() {
    if (!cur || !_CmdCards.isOpen('profile')) return;
    const ids = [...state.selected], key = selKey(ids);
    if (!ids.length || key === cur.sel || key === selTried) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(async () => {
      if (!cur || !_CmdCards.isOpen('profile')) return;
      if (busy) { follow(); return; }
      const now = [...state.selected], k = selKey(now);
      if (!now.length || k === cur.sel || k === selTried) return;
      selTried = k;
      clearTimeout(timer);
      await open({ ids: now, fill_machining: cur.o.machining, keep_chambers: !cur.o.fill, ...carried() });
    }, 120);
  }
  function summary() {
    const it = itNow(), r = it && it.last; if (!r || !r.ok) return null;
    return { profiles: cur.items.length, left_out: cur.skipped.length, at: cur.at, name: it.name, axis: r.curved ? 'bent path' : (r.axisName || 'tilted'), end_angles_deg: r.endAngles, length_mm: +(r.length * it.scale).toFixed(3),
      machined: !!r.machined, edited: !!r.edited, chambers_found: r.chambersFound, chambers_filled: r.chambers, gaps_closed: r.notches,
      chambers_kept: r.chambersKept, length_after_mm: +(r.lengthAfter * it.scale).toFixed(3), symmetric: r.symmetry ? !!r.symmetry.made : undefined, holes_kept: it.holesKept != null ? it.holesKept : undefined,
      same_edit_on: it.copies || 0, edit_from: it.editFrom ? it.editFrom.name : undefined,
      width_mm: cur.o.width, triangles_before: cur.items.reduce((s, x) => s + x.tris0, 0), triangles_after: cur.items.reduce((s, x) => s + (x.trisAfter || 0), 0) || undefined };
  }

  window.__moAgent = Object.assign(window.__moAgent || {}, {
    cleanProfile: (o) => open(o || {}),
    profileSet: (k, v) => changed(k, v, false),
    profileStep: (d) => { step(d); return summary(); },
    // (for tests: the section of the part shown, as it will be built, and an edit to it)
    profileSection: () => { const it = itNow(); return it && it.last && it.last.ok ? (it.shapes || it.last.shapesAfter) : null; },
    profileEdit: (shapes) => { const it = itNow(); if (!it) return null; it.shapes = shapes; it.edited = !!shapes; it.crossed = false; it.editFrom = null; spread(it); viewOf().reset(shapes); preview(); if (cur.op) build(); return summary(); },
    profileState: () => (cur ? { options: { ...cur.o }, applied: !!cur.op, edit: !!(view && view.editing), summary: summary() } : null),
  });
  return { open, follow };
}
