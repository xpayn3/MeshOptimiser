// The Pivot card. One card for the pivot of the selected parts, in two tabs:
//   Position     where the pivot is: Centre pivot, Pivot to (the origin, the selection, the last picked part, the middle of the view),
//                Move object to, Reset Scale.
//   Orientation  which way its X, Y and Z point: the scene's, the part's own flat faces, its parent's, the last picked part's, the
//                view's, the way the parts are spread, or any angles typed in.
// The shapes never move: a pivot is moved or turned and the mesh is moved or turned the opposite way. The work itself (undo steps,
// the meshes, the gizmo) is in app.js, one engine: axisSet (and axisCenter, axisMoveObject, axisResetScale); this file is the card:
// the tabs, the buttons, and the angles that show where the pivot stands now (they follow the gizmo while it is dragged).
//
// app: the objects and functions of app.js this card uses (see the call in app.js)
export function installPivotCard(app) {
  const { state, THREE, toast, axisSet, axisCenter, axisMoveObject, axisResetScale } = app;
  // one group picked: its own pivot is what moves, not the pivots of its parts
  const G = (where, turn, opts) => { try { return !!(app.groupPivot && app.groupPivot(where, turn, opts)); } catch (e) { console.error('[group pivot]', e); return false; } };
  const card = document.querySelector('.section-cmd[data-cmd="axis"]');
  if (!card || card._wired) return null;
  card._wired = true;
  const $i = (id) => document.getElementById(id);
  const tabs = $i('pivot-tabs');
  const LABEL = { position: 'Centre pivot', orient: 'Turn pivot' };      // (what Enter and the foot's button do on each tab)
  let cur = 'position';

  // The angles are the pivot's turn in the scene, in degrees: where it stands now. They are written again while the gizmo is dragged,
  // except a field that is being typed in.
  function sync(force) {
    if (card.hidden) return;
    if (!(state.pivot && state.gizmo && state.gizmo.object)) return;
    const q = new THREE.Quaternion(); state.pivot.getWorldQuaternion(q);
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ'), R = 180 / Math.PI;
    ['x', 'y', 'z'].forEach((k) => {
      const inp = $i('pivot-' + k);
      if (inp && (force || document.activeElement !== inp)) { const v = e[k] * R; inp.value = String(Math.round(Math.abs(v) < 5e-3 ? 0 : v * 100) / 100); }
    });
  }
  const later = () => setTimeout(() => sync(true), 60);

  function tab(name) {
    if (!LABEL[name]) return;
    cur = name;
    card.querySelectorAll('[data-pv-pane]').forEach((p) => { p.hidden = p.dataset.pvPane !== name; });
    if (tabs) [...tabs.children].forEach((b, i) => { const on = b.dataset.pvTab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); if (on) tabs.style.setProperty('--seg-i', i); });
    // Enter and the foot's button press the card's primary button: the one of the tab that is showing
    card.querySelectorAll('[data-cmd-primary]').forEach((b) => b.removeAttribute('data-cmd-primary'));
    card.querySelector('[data-pv-pane="' + name + '"] [data-pv-primary]')?.setAttribute('data-cmd-primary', '');
    const ok = card.querySelector('.cmd-foot .cmd-ok span'); if (ok) ok.textContent = LABEL[name];
    if (name === 'orient') sync(true);
  }
  tabs?.addEventListener('click', (e) => { const b = e.target.closest('[data-pv-tab]'); if (b) { tab(b.dataset.pvTab); b.blur(); } });

  // Orientation: one chip per way of choosing the axes, and the angles typed in
  card.querySelectorAll('[data-orient]').forEach((b) => b.addEventListener('click', () => { if (!G('keep', b.dataset.orient)) axisSet('keep', b.dataset.orient); b.blur(); later(); }));
  const apply = () => {
    const v = ['x', 'y', 'z'].map((k) => parseFloat(String($i('pivot-' + k).value).replace(',', '.')));
    if (v.some((n) => !Number.isFinite(n))) { sync(true); return; }
    if (!G('keep', 'custom', { euler: v })) axisSet('keep', 'custom', { euler: v });
    later();
  };
  $i('btn-pivot-apply')?.addEventListener('click', apply);

  // Position (and Parent, which turns the pivot to its parent's axes)
  const rot = () => !!($i('axis-reset-rot') && $i('axis-reset-rot').checked);
  const run = {
    centre: () => { if (!G('centre', 'world')) axisCenter(); },
    'axis-bottom': () => { if (!G('bottom', rot() ? 'world' : 'keep')) axisSet('bottom', rot() ? 'world' : 'keep'); },
    'axis-top': () => { if (!G('top', rot() ? 'world' : 'keep')) axisSet('top', rot() ? 'world' : 'keep'); },
    'axis-origin': () => { if (!G('origin', rot() ? 'world' : 'keep')) axisSet('origin', rot() ? 'world' : 'keep'); },
    'axis-selection': () => { if (!G('selection', 'keep')) axisSet('selection', rot() ? 'world' : 'keep'); },
    'axis-active': () => { if (!G('active', 'keep')) axisSet('active', rot() ? 'active' : 'keep'); },
    'axis-view': () => { if (!G('view', rot() ? 'world' : 'keep')) axisSet('view', rot() ? 'world' : 'keep'); },
    'obj-origin': () => axisMoveObject('origin'),
    'obj-active': () => axisMoveObject('active'),
    'obj-view': () => axisMoveObject('view'),
    'turn-parent': () => { if (!G('keep', 'parent')) axisSet('keep', 'parent'); },
    scale: () => axisResetScale(),
  };
  card.querySelectorAll('[data-axis-act]').forEach((b) => b.addEventListener('click', () => {
    const f = run[b.dataset.axisAct];
    try { if (f) f(); } catch (e) { console.error('[axis]', e); toast('The pivot could not be changed', String(e && e.message || e), 'error'); }
    b.blur(); later();
  }));

  // (the card opens from the search: show where the pivot stands the moment it does)
  new MutationObserver(() => { if (!card.hidden) setTimeout(() => sync(true), 80); }).observe(card, { attributes: true, attributeFilter: ['hidden'] });
  tab('position');
  return { tab, sync, get current() { return cur; } };
}
