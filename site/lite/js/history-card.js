// The History card of the right sidebar: every step Ctrl+Z can go back to, newest first, the steps that were undone (and can be redone)
// above the one the model is at, the opened state at the bottom. A click puts the model at that step, however many undos or redos it
// takes. The list is drawn from state.history and state.redo as they are; it keeps nothing of its own (the time of each step is
// op._t, set in pushUndo).
//
//   installHistoryCard({ state, undoLast, redoLast, canRedo, clear, savedOp, max, confirm, toast, lucide })
//
// Rows are buttons (Arrow keys, Home and End move between them, Enter or Space jumps). The card draws only while it is open.

// What a step is called when it carries no label of its own, and its icon.
const KIND = {
  transform: ['Move, turn or scale', 'move-3d'], transformGroup: ['Move, turn or scale a group', 'move-3d'], groupTransform: ['Move, turn or scale a group', 'move-3d'],
  groupPivot: ['Move a group pivot', 'crosshair'], geomXform: ['Change the shape', 'move-3d'], recenter: ['Recentre the model', 'axis-3d'],
  align: ['Align parts', 'align-center-vertical'], decimate: ['Reduce triangles', 'shrink'], budget: ['Fit to a budget', 'gauge'],
  delete: ['Delete', 'trash-2'], addPart: ['Add a part', 'plus'], duplicate: ['Duplicate', 'copy-plus'], makeUnique: ['Make unique', 'copy-x'],
  merge: ['Merge', 'combine'], split: ['Split', 'split'], boxify: ['Replace with a box', 'box'], flatten: ['Flatten groups', 'list-tree'],
  group: ['Group', 'folder-plus'], hierGroup: ['Group', 'folder-plus'], hierUngroup: ['Ungroup', 'folder-minus'], userGroupRemove: ['Remove a group', 'folder-minus'],
  ugState: ['Change a group', 'folder'], cleanEmptyGroups: ['Remove empty groups', 'folder-minus'], treeMove: ['Move in the list', 'list-tree'],
  batchRename: ['Rename', 'pen-line'], typename: ['Rename', 'pen-line'], vis: ['Show or hide', 'eye'],
  materialEdit: ['Change a material', 'palette'], matBatch: ['Change materials', 'palette'], faceMat: ['Paint faces', 'paintbrush'], shading: ['Change the shading', 'lens'],
  normals: ['Fix normals', 'flip-horizontal-2'], uvEdit: ['Edit UVs', 'grid-3x3'], bake: ['Bake textures', 'croissant'], primBake: ['Bake a shape', 'box'],
  primParams: ['Change a shape', 'sliders-horizontal'], editSpline: ['Edit a curve', 'pencil'], instMaster: ['Change the original', 'link'], instShare: ['Share identical shapes', 'link'],
  anim: ['Change the animation', 'play'], notes: ['Note', 'message-square'], uiSlider: ['Change a setting', 'sliders-horizontal'], compound: ['Several changes', 'layers'],
};
const kindOf = (op) => KIND[op && op.type] || [String((op && op.type) || 'Change').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()), 'circle-dot'];

// How many parts a step touched, when it says so.
function partsOf(op) {
  if (!op) return 0;
  if (op.type === 'compound') { const s = new Set(); for (const o of op.ops || []) for (const k of ids(o)) s.add(k); return s.size; }
  return ids(op).length;
}
function ids(op) {
  const a = op.items || op.partIds || op.ids || op.parts || op.before;
  if (!Array.isArray(a)) return op.partId != null ? [op.partId] : [];
  return a.map((x) => (x && typeof x === 'object') ? (x.partId != null ? x.partId : x.id) : x).filter((x) => x != null);
}
export function stepLabel(op) { return (op && typeof op.label === 'string' && op.label.trim()) || kindOf(op)[0]; }
export function stepMeta(op) {
  if (!op) return '';
  if (op.type === 'compound' && Array.isArray(op.ops) && op.ops.length > 1) return op.ops.length + ' steps';
  const n = partsOf(op);
  return n > 1 ? n + ' parts' : '';
}
export function ago(t, now = Date.now()) {
  if (!t) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return s + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function installHistoryCard(app) {
  const { state } = app;
  const sec = document.getElementById('history-section');
  if (!sec || sec._wired) return null;
  sec._wired = true;
  const head = sec.querySelector('.section-h'), list = document.getElementById('history-list'), status = document.getElementById('history-status');
  const bUndo = document.getElementById('history-undo'), bRedo = document.getElementById('history-redo'), bClear = document.getElementById('history-clear');
  const foot = document.getElementById('history-foot');
  let busy = false, queued = 0, lastKey = '';

  const open = () => !!head && !head.classList.contains('collapsed');

  // The steps in the order of time: what was done, then what was undone with the one a redo does next first.
  const timeline = () => [...state.history, ...(state.redo || []).slice().reverse()];

  function rows() {
    const H = state.history.length, all = timeline(), saved = app.savedOp ? app.savedOp() : undefined, now = Date.now();
    let html = '';
    for (let k = all.length - 1; k >= 0; k--) {
      const op = all[k], done = k < H, cur = k === H - 1, [, icon] = kindOf(op), meta = stepMeta(op), t = ago(op._t, now);
      const tag = saved === op ? '<span class="hist-tag" title="The scene was saved here">Saved</span>' : '';
      const redoNote = !done && app.canRedo && !app.canRedo(op) ? ' (cannot be redone)' : '';
      html += `<button type="button" class="hist-row${cur ? ' is-now' : ''}${done ? '' : ' is-undone'}" role="option" aria-selected="${cur}" data-n="${k + 1}"` +
        ` title="${esc(stepLabel(op))}${op._t ? ' · ' + esc(new Date(op._t).toLocaleTimeString()) : ''}${esc(redoNote)}">` +
        `<i data-lucide="${icon}"></i><span class="hist-name">${esc(stepLabel(op))}</span>${tag}` +
        `<span class="hist-meta">${esc(meta)}</span><span class="hist-time">${cur ? 'now' : esc(t)}</span></button>`;
    }
    const base = !H;
    html += `<button type="button" class="hist-row hist-base${base ? ' is-now' : ''}" role="option" aria-selected="${base}" data-n="0" title="How the scene was when it was opened">` +
      `<i data-lucide="flag"></i><span class="hist-name">Opened</span>${saved === null && app.wasSaved && app.wasSaved() ? '<span class="hist-tag" title="The scene was saved here">Saved</span>' : ''}<span class="hist-meta"></span><span class="hist-time">${base ? 'now' : ''}</span></button>`;
    return { html, all, H };
  }

  function render() {
    queued = 0;
    if (!open() || !list) return;
    const { html, all, H } = rows(), R = all.length - H;
    const key = html;
    if (key !== lastKey) {
      const keep = list.scrollTop, hadFocus = list.contains(document.activeElement) ? document.activeElement.dataset.n : null;
      lastKey = key;
      list.innerHTML = html;
      try { app.lucide && app.lucide(); } catch (_) {}
      const now = list.querySelector('.is-now');
      if (hadFocus != null) list.querySelector(`[data-n="${hadFocus}"]`)?.focus({ preventScroll: true });
      list.scrollTop = keep;
      if (now) { const a = now.offsetTop - list.offsetTop, b = a + now.offsetHeight; if (a < list.scrollTop || b > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, a - list.clientHeight / 2); }
    }
    list.classList.toggle('is-busy', busy);
    const n = state.history.length;
    status.textContent = !all.length ? 'Nothing done yet.' : n + (n === 1 ? ' step' : ' steps') + (R ? ' · ' + R + ' undone' : '');
    bUndo.disabled = busy || !n;
    bRedo.disabled = busy || !R;
    bClear.disabled = busy || !all.length;
    if (foot) foot.textContent = 'Keeps the last ' + app.max() + ' steps. Change it under Settings › General.';
  }
  const soon = () => { if (!queued && open()) queued = requestAnimationFrame(render); };

  // Puts the model at the state after n steps: undoes down to it, or redoes up to it. A redo that runs a job (Smart fit) is waited for.
  async function jumpTo(n) {
    if (busy || n === state.history.length) return;
    busy = true; render();
    try {
      let guard = 0;
      while (state.history.length > n && guard++ < 5000) { const b = state.history.length; app.undoLast(); if (state.history.length >= b) break; }
      while (state.history.length < n && (state.redo || []).length && guard++ < 10000) {
        const r = state.redo.length; app.redoLast();
        for (let i = 0; i < 100 && state.redo.length >= r; i++) await new Promise((res) => setTimeout(res, 40));
        if (state.redo.length >= r) { app.toast('Stopped', 'A step could not be redone', 'warn', 3000); break; }
      }
    } catch (e) { console.error('[history]', e); }
    finally { busy = false; lastKey = ''; render(); }
  }

  list.addEventListener('click', (e) => {
    const b = e.target.closest('.hist-row'); if (!b || busy) return;
    jumpTo(parseInt(b.dataset.n, 10));
  });
  list.addEventListener('keydown', (e) => {
    const rs = [...list.querySelectorAll('.hist-row')], i = rs.indexOf(document.activeElement);
    if (i < 0) return;
    const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rs.length - 1 }[e.key];
    if (go == null) return;
    e.preventDefault(); e.stopPropagation();
    rs[Math.max(0, Math.min(rs.length - 1, go))].focus();
  });
  bUndo.addEventListener('click', () => { app.undoLast(); bUndo.blur(); });
  bRedo.addEventListener('click', () => { app.redoLast(); bRedo.blur(); });
  bClear.addEventListener('click', async () => {
    if (busy) return;
    const n = state.history.length + (state.redo || []).length;
    const act = await app.confirm({ title: 'Clear the history?', text: 'The ' + n + (n === 1 ? ' step' : ' steps') + ' can no longer be undone or redone. The model stays as it is, and the memory the old versions held is freed.', slide: true, save: false, discard: 'Slide to clear', cancel: 'Cancel' });      // (the same slider as Revert and Quit: it cannot be undone)
    if (act === 'discard') { app.clear(); app.toast('History cleared', '', 'info', 1800); }
    bClear.blur();
  });

  document.addEventListener('mo-history', soon);
  new MutationObserver(() => { if (open()) { lastKey = ''; render(); } }).observe(head, { attributes: true, attributeFilter: ['class'] });
  setInterval(() => { if (open() && !document.hidden) { lastKey = ''; soon(); } }, 20000);      // (the times move on; the list is drawn again)
  if (open()) render();
  return { render, jumpTo, get timeline() { return timeline; } };
}
