// ========== NOTES: pins in the view, the pop-up conversation, the Notes card ==========
// The data and every step that changes it are in notes-core.js (MONotes). This file is what you see and touch: a numbered pin on the model
// where a note was made, the pop-up with its conversation (anyone can reply, edit, delete, resolve; every change carries the name of who made
// it, and an edit keeps what it replaced), the Notes card in the right-hand column, placing a note with a click, flying to a note, saving the
// notes in the scene file and opening them again, bringing in the notes of another copy of the scene, and a report anyone can open.
// app.js hands over what it knows through init(host). Nothing in here runs while nothing changes: the pins are laid out when a frame is drawn.
(function () {
  'use strict';
  const C = window.MONotes;
  if (!C) { console.warn('[notes] notes-core.js is missing'); return; }

  const S = {
    host: null, items: [], seen: {}, thumbs: {}, since: '',          // since: when this person last looked, from the file (for "new")
    pins: true, placing: null, filter: 'open', sort: 'number', search: '',
    openId: null, draft: null, editing: null, pop: null, layer: null, card: null, parts: new Map(),
  };
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const ICONS = {
    note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>', plus: '<path d="M5 12h14"/><path d="M12 5v14"/>', x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>', left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', up: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M5 21h14"/>',
    down: '<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  };
  const svg = (n) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';
  const iconBtn = (name, title, cls) => { const b = el('button', 'nt-ib' + (cls ? ' ' + cls : '')); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.innerHTML = svg(name); return b; };
  const tagColor = (id) => (C.TAGS.find(t => t.id === id) || C.TAGS[0]).color;
  const hue = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
  const avatar = (nm) => { const a = el('span', 'nt-av', (nm.trim()[0] || '?').toUpperCase()); a.style.background = 'hsl(' + hue(nm) + ' 45% 38%)'; a.title = nm; return a; };

  // ── who is writing ───────────────────────────────────────────────────────────────────────────────────
  const author = () => C.name(S.host && S.host.prefs.get('noteAuthor') || '');
  function setAuthor(n) { n = C.name(n); S.host.prefs.set('noteAuthor', n); updateSince(); render(); }
  function updateSince() { const a = author(); S.since = a && S.seen[a] ? S.seen[a] : ''; }
  // The name is typed by the person, never guessed: before a note, a reply or an edit there has to be one. Nobody signs in, so it says who
  // a person said they were, which is what the file shows next to every word.
  function needName(then, why) {
    if (author()) { then(); return; }
    askName(why).then(n => { if (n) { setAuthor(n); then(); } });
  }
  function askName(why) {
    return new Promise((res) => {
      const bg = el('div', 'dlg-bg show'); const card = el('div', 'dlg-card'); card.style.position = 'relative';
      card.innerHTML = '<button class="dlg-close" aria-label="Close">✕</button><div class="dlg-head"><div class="dlg-icon">' + svg('user') + '</div><div class="dlg-text"><div class="dlg-title">Your name</div><div class="dlg-msg"></div></div></div>';
      $('.dlg-msg', card).textContent = (why || 'Notes show who wrote them.') + ' Type the name others should see next to your notes, replies and edits.';
      const inp = el('input'); inp.type = 'text'; inp.maxLength = C.LIMITS.name; inp.placeholder = 'Your name'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.style.cssText = 'width:100%;margin:12px 0 4px;height:34px;padding:0 10px;box-sizing:border-box';
      const foot = el('div', 'dlg-foot'); const cancel = el('button', 'dlg-btn dlg-btn-cancel', 'Cancel'); const ok = el('button', 'dlg-btn dlg-btn-ok', 'Continue');
      cancel.type = ok.type = 'button'; ok.disabled = true; foot.append(cancel, ok); card.append(inp, foot); bg.append(card); document.body.append(bg);
      const done = (v) => { bg.remove(); res(v); };
      inp.addEventListener('input', () => { ok.disabled = !C.name(inp.value); });
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && C.name(inp.value)) done(C.name(inp.value)); else if (e.key === 'Escape') done(null); });
      ok.addEventListener('click', () => { if (C.name(inp.value)) done(C.name(inp.value)); });
      cancel.addEventListener('click', () => done(null)); $('.dlg-close', card).addEventListener('click', () => done(null));
      setTimeout(() => inp.focus(), 30);
    });
  }

  // ── every change is one undo step ─────────────────────────────────────────────────────────────────────
  const snapshot = () => JSON.stringify(S.items.map(n => Object.assign({}, n, { thumb: '' })));
  function restoreSnapshot(json) {
    let raw = []; try { raw = JSON.parse(json); } catch (_) { return; }
    S.items = C.parse({ items: raw }).items;
    for (const n of S.items) n.thumb = S.thumbs[n.id] || '';
    S.parts.clear(); if (S.openId && !C.find(S.items, S.openId)) closePop(); render();
  }
  function change(label, fn) {
    const before = snapshot(); const r = fn(); const after = snapshot();
    if (before !== after) S.host.pushUndo({ type: 'notes', label, before, after });
    render(); return r;
  }
  function undoOp(op, forward) { restoreSnapshot(forward ? op.after : op.before); }

  // ── where a note is ───────────────────────────────────────────────────────────────────────────────────────
  const V = () => S.host.THREE;
  function partOf(n) {
    if (!n.part) return null;
    let p = S.parts.get(n.id);
    if (p && !p.deleted) return p;
    const list = S.host.state.parts;
    p = (n.part.uid && list.find(q => !q.deleted && q.uid === n.part.uid)) || (n.part.name && list.find(q => !q.deleted && q.name === n.part.name)) || null;
    if (p) { S.parts.set(n.id, p); if (!p.uid && n.part.uid) p.uid = n.part.uid; }
    return p;
  }
  // the pin's place in the scene now (the part may have moved, been exploded, ...)
  function worldOf(n, out) {
    const p = partOf(n);
    if (p && p.mesh && n.local) {
      p.mesh.updateWorldMatrix(true, false);
      return out.fromArray(n.local).applyMatrix4(p.mesh.matrixWorld);
    }
    if (n.world) return out.fromArray(n.world);
    return null;
  }
  const hidden = (n) => { const p = partOf(n); return !!(p && !p.visible); };

  // ── the pins ──────────────────────────────────────────────────────────────────────────────────────────────────
  const pinEls = new Map();
  const _v = { w: null, n: null };
  function layout() {
    const h = S.host; if (!h || !S.layer) return;
    const show = S.pins && S.items.some(n => !n.deleted && n.kind !== 'scene');
    S.layer.style.display = show ? '' : 'none';
    if (!show) return;
    const cam = h.cam(), cv = h.canvas(), vp = h.viewport(); if (!cam || !cv || !vp) return;
    const r = cv.getBoundingClientRect(), vr = vp.getBoundingClientRect(); if (!r.width) return;
    _v.w = _v.w || new (V().Vector3)(); _v.n = _v.n || new (V().Vector3)();
    const camPos = cam.position;
    for (const n of S.items) {
      let pin = pinEls.get(n.id);
      const vis = !n.deleted && n.kind !== 'scene' && passes(n, true);
      if (!vis) { if (pin) pin.style.display = 'none'; continue; }
      const w = worldOf(n, _v.w);
      if (!w) { if (pin) pin.style.display = 'none'; continue; }
      if (!pin) pin = makePin(n);
      const p = _v.w.clone().project(cam);
      if (!(p.z > -1 && p.z < 1)) { pin.style.display = 'none'; continue; }
      pin.style.display = '';
      pin.style.transform = 'translate(' + Math.round((p.x * 0.5 + 0.5) * r.width + (r.left - vr.left)) + 'px,' + Math.round((-p.y * 0.5 + 0.5) * r.height + (r.top - vr.top)) + 'px)';
      let away = false;
      const part = partOf(n);
      if (n.normal && part && part.mesh) { _v.n.fromArray(n.normal).transformDirection(part.mesh.matrixWorld); away = _v.n.dot(camPos.clone().sub(w)) < 0; }
      pin.classList.toggle('back', away);
      pin.classList.toggle('hid', hidden(n));
      pin.classList.toggle('gone', !!n.part && !part);
    }
    for (const [id, pin] of pinEls) if (!C.find(S.items, id)) { pin.remove(); pinEls.delete(id); }
    if (S.pop && S.openId) placePop();
  }
  function makePin(n) {
    const b = el('button', 'note-pin'); b.type = 'button'; b.dataset.id = n.id; b.addEventListener('click', (e) => { e.stopPropagation(); openNote(n.id, { fly: false }); });
    b.addEventListener('mousedown', (e) => e.stopPropagation()); b.addEventListener('pointerdown', (e) => e.stopPropagation());
    S.layer.append(b); pinEls.set(n.id, b); decoratePin(n, b); return b;
  }
  function decoratePin(n, b) {
    b.textContent = String(n.n);
    b.style.setProperty('--c', tagColor(n.tag));
    b.classList.toggle('done', n.status === 'resolved');
    b.classList.toggle('sel', S.openId === n.id);
    b.classList.toggle('new', C.unread(n, author(), S.since));
    const first = n.messages.find(m => !m.deleted);
    b.title = '#' + n.n + (first ? ' · ' + first.by + ': ' + first.text.slice(0, 90) : '');
  }

  // ── the pop-up conversation ────────────────────────────────────────────────────────────────────────────────────
  function closePop() { if (S.pop) { S.pop.remove(); S.pop = null; } S.openId = null; S.draft = null; S.editing = null; for (const [id, b] of pinEls) { const n = C.find(S.items, id); if (n) decoratePin(n, b); } }
  function placePop() {
    const pop = S.pop, vp = S.host.viewport(); if (!pop || !vp) return;
    const vr = vp.getBoundingClientRect(); const n = S.draft || C.find(S.items, S.openId);
    let x = vr.width - pop.offsetWidth - 16, y = 64;
    const pin = n && pinEls.get(n.id || '__draft');
    if (S.draft && S.draft.screen) { x = S.draft.screen.x + 18; y = S.draft.screen.y - 14; }
    else if (pin && pin.style.display !== 'none') { const b = pin.getBoundingClientRect(); x = b.left - vr.left + 22; y = b.top - vr.top - 14; }
    x = Math.max(8, Math.min(x, vr.width - pop.offsetWidth - 8)); y = Math.max(8, Math.min(y, vr.height - pop.offsetHeight - 8));
    pop.style.left = Math.round(x) + 'px'; pop.style.top = Math.round(y) + 'px';
  }
  function tagSelect(cur, onChange) {
    const s = el('select', 'nt-sel'); for (const t of C.TAGS) { const o = el('option', null, t.label); o.value = t.id; if (t.id === cur) o.selected = true; s.append(o); }
    s.style.borderLeft = '3px solid ' + tagColor(cur); s.addEventListener('change', () => { s.style.borderLeftColor = tagColor(s.value); onChange(s.value); }); s.addEventListener('keydown', (e) => e.stopPropagation()); return s;
  }
  function composer(placeholder, sendLabel, onSend, opts) {
    opts = opts || {};
    const box = el('div', 'nt-comp'); const ta = el('textarea'); ta.rows = opts.rows || 2; ta.placeholder = placeholder; ta.maxLength = C.LIMITS.text; if (opts.value) ta.value = opts.value;
    const row = el('div', 'nt-comp-row'); const as = el('span', 'nt-as'); const send = el('button', 'nt-btn primary', sendLabel); send.type = 'button'; send.disabled = !ta.value.trim();
    const paintAs = () => { as.textContent = author() ? 'As ' + author() : 'Type your name to write'; };
    paintAs(); as.title = 'Change your name'; as.addEventListener('click', () => askName('Change the name shown next to what you write.').then(n => { if (n) { setAuthor(n); paintAs(); } }));
    const go = () => { const t = ta.value.trim(); if (!t) return; needName(() => { onSend(t); }, 'Before you write, notes need to know who you are.'); };
    ta.addEventListener('input', () => { send.disabled = !ta.value.trim(); });
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } else if (e.key === 'Escape') { e.preventDefault(); opts.onEsc ? opts.onEsc() : closePop(); } });
    send.addEventListener('click', go);
    row.append(as, el('span', 'nt-grow')); if (opts.extra) for (const x of opts.extra) row.append(x); row.append(send); box.append(ta, row);
    return { box, ta };
  }
  function openNote(id, o) {
    o = o || {};
    const n = C.find(S.items, id); if (!n) return;
    S.draft = null; S.editing = null; S.openId = id; buildPop(); render();
    if (o.fly !== false) flyTo(n);
    markSeen(n);
  }
  function markSeen() { /* a note read is not a note saved: "new" clears when the scene is saved (seen[name] = now) or with "Mark all read" */ }
  function buildPop() {
    if (S.pop) S.pop.remove();
    const n = S.draft || C.find(S.items, S.openId); if (!n) { S.pop = null; return; }
    const pop = el('div', 'note-pop'); pop.addEventListener('mousedown', (e) => e.stopPropagation()); pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    pop.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true }); S.pop = pop; S.host.viewport().append(pop);
    if (S.draft) { buildDraft(pop, S.draft); } else buildThread(pop, n);
    placePop(); const ta = $('textarea', pop); if (ta && !S.editing) setTimeout(() => ta.focus(), 20);
  }
  function buildDraft(pop, d) {
    const head = el('div', 'nt-head'); head.append(el('b', null, 'New note'));
    let tag = 'info'; head.append(tagSelect(tag, (v) => { tag = v; })); const close = iconBtn('x', 'Cancel (Esc)'); close.addEventListener('click', closePop); head.append(el('span', 'nt-grow'), close);
    pop.append(head);
    const where = el('div', 'nt-where', d.part ? d.part.name || 'A part' : d.kind === 'scene' ? 'The whole scene' : 'A point in the scene'); pop.append(where);
    if (d.thumb) { const im = el('img', 'nt-thumb'); im.alt = ''; im.src = d.thumb; pop.append(im); }
    const c = composer('Write a note…  (Enter sends, Shift+Enter is a new line)', 'Add note', (t) => { createNote(d, t, tag); }, { rows: 3 });
    pop.append(c.box);
  }
  function createNote(d, body, tag) {
    const by = author(); let note = null;
    change('Add note', () => {
      note = C.create(S.items, { by, text: body, kind: d.kind, part: d.part, local: d.local, world: d.world, normal: d.normal, cam: d.cam, tag, thumb: d.thumb || '' });
      if (note.thumb) S.thumbs[note.id] = note.thumb;
    });
    S.draft = null; S.openId = note.id; buildPop(); S.host.toast('Note ' + note.n + ' added', 'Everyone who opens this scene will see it.', 'success', 2400);
  }
  function buildThread(pop, n) {
    const by = author();
    const head = el('div', 'nt-head'); const num = el('span', 'nt-num', String(n.n)); num.style.background = tagColor(n.tag); head.append(num);
    head.append(tagSelect(n.tag, (v) => needName(() => change('Tag note', () => C.setTag(n, author(), v)), 'Before you change a note, it needs to know who you are.')));
    const st = el('button', 'nt-btn' + (n.status === 'resolved' ? ' on' : ''), n.status === 'resolved' ? 'Resolved ✓' : 'Resolve'); st.type = 'button'; st.title = n.status === 'resolved' ? 'Open it again' : 'Mark as resolved';
    st.addEventListener('click', () => needName(() => change(n.status === 'resolved' ? 'Reopen note' : 'Resolve note', () => C.setStatus(n, author(), n.status === 'resolved' ? 'open' : 'resolved')), 'Before you change a note, it needs to know who you are.'));
    head.append(st, el('span', 'nt-grow'));
    const vis = visibleList(); const at = vis.findIndex(x => x.id === n.id);
    const prev = iconBtn('left', 'Previous note'), next = iconBtn('right', 'Next note'); prev.disabled = next.disabled = vis.length < 2 || at < 0;
    prev.addEventListener('click', () => step(-1)); next.addEventListener('click', () => step(1));
    const more = iconBtn('more', 'More'); more.addEventListener('click', (e) => { e.stopPropagation(); moreMenu(more, n); });
    const close = iconBtn('x', 'Close (Esc)'); close.addEventListener('click', closePop); head.append(prev, next, more, close); pop.append(head);
    // where it is
    const part = partOf(n); const wh = el('div', 'nt-where');
    const wl = el('button', 'nt-link', C.where(n)); wl.type = 'button'; wl.title = 'Show it'; wl.addEventListener('click', () => flyTo(n, true)); wh.append(wl);
    if (n.part && !part) wh.append(el('span', 'nt-warn', 'part gone'));
    if (part && !part.visible) { const sh = el('button', 'nt-link warn', 'hidden · show'); sh.type = 'button'; sh.addEventListener('click', () => { S.host.showPart(part); layout(); buildPop(); }); wh.append(sh); }
    const asg = el('select', 'nt-sel small'); const none = el('option', null, 'Not assigned'); none.value = ''; asg.append(none);
    const names = new Set(C.authors(S.items)); if (by) names.add(by); if (n.assignee) names.add(n.assignee);
    for (const nm of [...names].sort((a, b) => a.localeCompare(b))) { const o = el('option', null, 'For ' + nm); o.value = nm; if (nm === n.assignee) o.selected = true; asg.append(o); }
    asg.addEventListener('change', () => needName(() => change('Assign note', () => C.assign(n, author(), asg.value)), 'Before you change a note, it needs to know who you are.')); asg.addEventListener('keydown', (e) => e.stopPropagation());
    wh.append(el('span', 'nt-grow'), asg); pop.append(wh);
    if (n.thumb) { const im = el('img', 'nt-thumb'); im.alt = 'What the view looked like'; im.src = n.thumb; im.title = 'Go back to this view'; im.addEventListener('click', () => flyTo(n, true)); pop.append(im); }
    // the conversation
    const list = el('div', 'nt-msgs');
    for (const m of n.messages) list.append(messageEl(n, m));
    pop.append(list);
    // history
    const hist = el('details', 'nt-hist'); const sm = el('summary', null, 'History · ' + n.activity.length); hist.append(sm); hist.addEventListener('toggle', () => placePop());
    const ul = el('ul'); for (const a of n.activity.slice().reverse()) { const li = el('li'); li.textContent = C.stamp(a.at) + '  ' + C.activityLine(a); ul.append(li); } hist.append(ul); pop.append(hist);
    // reply
    const c = composer(n.deleted ? 'This note is deleted' : 'Reply…', 'Reply', (t) => { change('Reply', () => C.reply(n, author(), t)); buildPop(); const l = $('.nt-msgs', S.pop); if (l) l.scrollTop = l.scrollHeight; });
    if (n.deleted) { c.ta.disabled = true; const rb = el('button', 'nt-btn', 'Bring the note back'); rb.type = 'button'; rb.addEventListener('click', () => needName(() => { change('Restore note', () => C.restoreNote(n, author())); buildPop(); })); pop.append(rb); }
    else pop.append(c.box);
    const l = $('.nt-msgs', pop); if (l) setTimeout(() => { l.scrollTop = l.scrollHeight; }, 0);
  }
  function messageEl(n, m) {
    const row = el('div', 'nt-msg'); row.append(avatar(m.by));
    const body = el('div', 'nt-body'); const top = el('div', 'nt-top'); top.append(el('b', null, m.by)); const t = el('span', 'nt-time', C.ago(m.at)); t.title = C.stamp(m.at); top.append(t);
    if (m.deleted) {
      body.append(top, el('div', 'nt-gone', 'Deleted by ' + m.deleted.by + ' · ' + C.stamp(m.deleted.at)));
      const rb = el('button', 'nt-link', 'Bring it back'); rb.type = 'button'; rb.addEventListener('click', () => needName(() => { change('Restore message', () => C.restoreMessage(n, m.id, author())); buildPop(); })); body.append(rb); row.append(body); return row;
    }
    const act = el('span', 'nt-acts'); const ed = iconBtn('pencil', 'Edit'), rm = iconBtn('trash', 'Delete this message'); act.append(ed, rm); top.append(el('span', 'nt-grow'), act); body.append(top);
    if (S.editing === m.id) {
      const c = composer('Edit…', 'Save', (v) => { change('Edit message', () => C.edit(n, m.id, author(), v)); S.editing = null; buildPop(); }, { value: m.text, rows: 3, onEsc: () => { S.editing = null; buildPop(); } });
      const cancel = el('button', 'nt-btn', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => { S.editing = null; buildPop(); }); c.box.querySelector('.nt-comp-row').insertBefore(cancel, c.box.querySelector('.nt-btn.primary'));
      body.append(c.box); row.append(body); setTimeout(() => { c.ta.focus(); c.ta.setSelectionRange(c.ta.value.length, c.ta.value.length); }, 20); return row;
    }
    body.append(el('div', 'nt-text', m.text));
    if (m.edits.length) {
      const who = [...new Set(m.edits.map(e => e.by))].join(', ');
      const info = el('div', 'nt-edited'); const lab = el('button', 'nt-link', 'Edited by ' + who + ' · ' + C.ago(m.updatedAt)); lab.type = 'button'; lab.title = 'Show what it said before';
      const prev = el('div', 'nt-prev'); prev.hidden = true;
      for (const e of m.edits.slice().reverse()) { const p = el('div'); p.append(el('span', 'nt-time', e.by + ' · ' + C.stamp(e.at) + ', it said:'), el('div', 'nt-was', e.was)); prev.append(p); }
      lab.addEventListener('click', () => { prev.hidden = !prev.hidden; }); info.append(lab); body.append(info, prev);
    }
    ed.addEventListener('click', () => needName(() => { S.editing = m.id; buildPop(); }, 'Before you edit, notes need to know who you are.'));
    rm.addEventListener('click', () => needName(() => { change('Delete message', () => C.removeMessage(n, m.id, author())); buildPop(); }, 'Before you delete, notes need to know who you are.'));
    row.append(body); return row;
  }
  function moreMenu(anchor, n) {
    document.querySelectorAll('.nt-menu').forEach(x => x.remove());
    const menu = el('div', 'nt-menu'); const add = (label, fn, danger) => { const b = el('button', danger ? 'danger' : '', label); b.type = 'button'; b.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); fn(); }); menu.append(b); };
    add('Show it in the view', () => flyTo(n, true));
    if (n.kind !== 'scene') add('Move the pin…', () => startPlace({ moveId: n.id }));
    add('Use the view now as this note’s view', () => needName(() => captureView().then(v => change('Update view', () => { C.moveAnchor(n, author(), { cam: v.cam }); if (v.thumb) { n.thumb = v.thumb; S.thumbs[n.id] = v.thumb; } }) || buildPop())));
    add('Copy as text', () => { copy(C.toText([n], { title: 'Note ' + n.n })); });
    add(n.deleted ? 'Bring the note back' : 'Delete the note', () => needName(() => { change(n.deleted ? 'Restore note' : 'Delete note', () => (n.deleted ? C.restoreNote(n, author()) : C.removeNote(n, author()))); if (n.deleted && S.filter !== 'deleted') { closePop(); } else buildPop(); }), !n.deleted);
    S.pop.append(menu); const b = anchor.getBoundingClientRect(), p = S.pop.getBoundingClientRect(); menu.style.top = (b.bottom - p.top + 4) + 'px'; menu.style.right = (p.right - b.right) + 'px';
    setTimeout(() => document.addEventListener('click', function off() { menu.remove(); document.removeEventListener('click', off); }, { once: false }), 0);
  }
  function copy(t) { try { navigator.clipboard.writeText(t).then(() => S.host.toast('Copied', '', 'success', 1500)); } catch (_) { S.host.toast('Copy failed', 'The browser did not allow it', 'warn', 2500); } }

  // ── flying the camera to a note ──────────────────────────────────────────────────────────────────────────────────────
  let flight = 0;
  function flyTo(n, force) {
    const h = S.host, cam = h.cam(), ctl = h.ctl(); if (!cam || !ctl) return;
    let to = n.cam;
    if (!to && n.kind !== 'scene') {      // no saved view: look at the pin from where we are
      const w = worldOf(n, new (V().Vector3)()); if (!w) return;
      const dir = cam.position.clone().sub(ctl.target); const dist = Math.max(dir.length() * 0.6, 1e-3); dir.setLength(dist);
      to = { pos: w.clone().add(dir).toArray(), target: w.toArray(), up: cam.up.toArray(), fov: cam.fov };
    }
    if (!to) return;
    const p0 = cam.position.clone(), t0 = ctl.target.clone(), p1 = new (V().Vector3)().fromArray(to.pos), t1 = new (V().Vector3)().fromArray(to.target);
    if (!force && p0.distanceTo(p1) < 1e-6 && t0.distanceTo(t1) < 1e-6) return;
    const id = ++flight, start = performance.now(), dur = 420;
    const lim = [ctl.minDistance, ctl.maxDistance];
    const step = (now) => {
      if (id !== flight) return;
      const k = Math.min(1, (now - start) / dur), e = k * k * (3 - 2 * k);
      cam.position.lerpVectors(p0, p1, e); ctl.target.lerpVectors(t0, t1, e);
      ctl.minDistance = 0; ctl.maxDistance = Infinity; ctl.update(); ctl.minDistance = lim[0]; ctl.maxDistance = lim[1];
      h.requestRender();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const camNow = () => { const h = S.host, c = h.cam(), t = h.ctl(); return c && t ? { pos: c.position.toArray(), target: t.target.toArray(), up: c.up.toArray(), fov: c.fov } : null; };
  // a small picture of the view with a ring where the pin is, kept with the note so it can be seen without the scene
  async function captureView(world) {
    const out = { cam: camNow(), thumb: '' };
    try {
      const cv = await S.host.capture(360, 225); if (!cv) return out;
      if (world) {
        const p = new (V().Vector3)().fromArray(world).project(S.host.cam());
        if (p.z > -1 && p.z < 1) { const ctx = cv.getContext('2d'), x = (p.x * 0.5 + 0.5) * cv.width, y = (-p.y * 0.5 + 0.5) * cv.height; ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.stroke(); ctx.strokeStyle = '#ff3b6b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.stroke(); }
      }
      let q = 0.62, url = cv.toDataURL('image/jpeg', q);
      while (url.length > C.LIMITS.thumb - 200 && q > 0.2) { q -= 0.12; url = cv.toDataURL('image/jpeg', q); }
      out.thumb = url.length <= C.LIMITS.thumb ? url : '';
    } catch (e) { console.warn('[notes] picture failed:', e); }
    return out;
  }

  // ── placing a note: click a spot ─────────────────────────────────────────────────────────────────────────────────────────
  function startPlace(o) {
    o = o || {};
    if (!S.host.state.parts.some(p => !p.deleted)) { S.host.toast('Notes', 'Open a model first', 'info', 2200); return; }
    if (!o.moveId && !author()) { needName(() => startPlace(o), 'Before you write a note, it needs to know who you are.'); return; }
    S.placing = { moveId: o.moveId || null }; document.body.classList.add('notes-placing'); closePop(); render();
    S.host.toast(o.moveId ? 'Move the pin' : 'Add a note', 'Click the spot on the model. Esc cancels. Dragging still turns the view.', 'info', 3600);
  }
  function stopPlace() { if (!S.placing) return; S.placing = null; document.body.classList.remove('notes-placing'); render(); }
  function placeAt(ev) {
    const hit = S.host.rayHit(ev); const mode = S.placing; if (!hit) { S.host.toast('Notes', 'Nothing there: click on the model', 'info', 1800); return; }
    stopPlace();
    const by = author();
    if (mode.moveId) {
      const n = C.find(S.items, mode.moveId); if (!n) return;
      needName(() => { change('Move pin', () => C.moveAnchor(n, author(), { part: hit.part, local: hit.local, world: hit.world, normal: hit.localNormal, cam: camNow() })); S.parts.delete(n.id); openNote(n.id, { fly: false }); });
      return;
    }
    const d = { kind: 'pin', part: hit.part, local: hit.local, world: hit.world, normal: hit.localNormal, cam: camNow(), thumb: '', screen: toViewport(ev) };
    S.draft = d; S.openId = null; buildPop(); render();
    captureView(hit.world).then(v => { if (S.draft === d) { d.thumb = v.thumb; buildPopKeepText(); } });
    void by;
  }
  function buildPopKeepText() { const ta = S.pop && $('textarea', S.pop); const t = ta ? ta.value : ''; buildPop(); const ta2 = S.pop && $('textarea', S.pop); if (ta2 && t) { ta2.value = t; ta2.dispatchEvent(new Event('input')); } }
  function toViewport(ev) { const vr = S.host.viewport().getBoundingClientRect(); return { x: ev.clientX - vr.left, y: ev.clientY - vr.top }; }
  // a note about the selected part (its centre) or about the whole scene
  function addForSelection() {
    needName(() => {
      const sel = [...S.host.state.selected].map(id => S.host.getPart(id)).filter(p => p && !p.deleted && p.mesh);
      if (!sel.length) { S.host.toast('Notes', 'Select a part first, or use “Scene note”', 'info', 2400); return; }
      const hit = S.host.partAnchor(sel[0]); if (!hit) return;
      S.draft = { kind: 'part', part: hit.part, local: hit.local, world: hit.world, normal: null, cam: camNow(), thumb: '' }; S.openId = null; buildPop(); render();
      const d = S.draft; captureView(hit.world).then(v => { if (S.draft === d) { d.thumb = v.thumb; buildPopKeepText(); } });
    }, 'Before you write a note, it needs to know who you are.');
  }
  function addForScene() {
    needName(() => { S.draft = { kind: 'scene', part: null, local: null, world: null, normal: null, cam: camNow(), thumb: '' }; S.openId = null; buildPop(); render(); const d = S.draft; captureView(null).then(v => { if (S.draft === d) { d.thumb = v.thumb; buildPopKeepText(); } }); }, 'Before you write a note, it needs to know who you are.');
  }

  // ── the Notes card ────────────────────────────────────────────────────────────────────────────────────────────────────
  function passes(n, forPin) {
    if (n.deleted) return S.filter === 'deleted' && !forPin;
    const f = S.filter;
    if (f === 'deleted') return false;
    if (forPin) return f !== 'deleted' ? (f === 'resolved' ? n.status === 'resolved' : f === 'open' ? n.status === 'open' || S.openId === n.id : true) : false;
    if (f === 'open' && n.status !== 'open') return false;
    if (f === 'resolved' && n.status !== 'resolved') return false;
    if (f === 'unread' && !C.unread(n, author(), S.since)) return false;
    if (f === 'mine' && !(author() && (n.assignee === author() || n.created.by === author() || n.messages.some(m => m.by === author())))) return false;
    if (S.search) {
      const q = S.search.toLowerCase();
      const hay = (C.where(n) + ' ' + n.assignee + ' ' + C.tagLabel(n.tag) + ' ' + n.n + ' ' + n.messages.map(m => m.by + ' ' + m.text).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }
  function visibleList() {
    const list = S.items.filter(n => passes(n, false));
    if (S.sort === 'newest') list.sort((a, b) => (C.lastChange(a) < C.lastChange(b) ? 1 : -1));
    else if (S.sort === 'part') list.sort((a, b) => C.where(a).localeCompare(C.where(b)) || a.n - b.n);
    else list.sort((a, b) => a.n - b.n);
    return list;
  }
  function step(d) { const l = visibleList(); if (!l.length) return; let i = l.findIndex(n => n.id === S.openId); i = i < 0 ? (d > 0 ? 0 : l.length - 1) : (i + d + l.length) % l.length; openNote(l[i].id); }
  function render() {
    const card = S.card; if (!card) return;
    const st = C.stats(S.items), me = author();
    const badge = $('#notes-count', card.section); if (badge) { badge.hidden = st.total === 0; badge.textContent = String(st.open); badge.title = st.open + ' open of ' + st.total; }
    $('.nt-me', card.body).textContent = me ? me : 'Set your name';
    card.pins.innerHTML = svg(S.pins ? 'eye' : 'eyeoff'); card.pins.title = S.pins ? 'Hide the pins' : 'Show the pins'; card.addPin.classList.toggle('on', !!S.placing);
    card.list.textContent = '';
    const list = visibleList();
    const unread = S.items.filter(n => C.unread(n, me, S.since)).length;
    card.markRead.hidden = !unread; card.markRead.textContent = 'Mark ' + unread + ' read';
    if (!list.length) {
      const e = el('div', 'nt-empty', S.items.length ? 'No notes match.' : 'No notes yet. Press N, then click a spot on the model.'); card.list.append(e);
    }
    for (const n of list) card.list.append(rowEl(n, me));
    for (const [id, b] of pinEls) { const n = C.find(S.items, id); if (n) decoratePin(n, b); }
    for (const n of S.items) if (!pinEls.has(n.id) && n.kind !== 'scene' && !n.deleted && S.layer) makePin(n);
    card.foot.hidden = S.items.length === 0 && !S.host;
    layout();
  }
  function rowEl(n, me) {
    const row = el('div', 'nt-row' + (n.status === 'resolved' ? ' done' : '') + (S.openId === n.id ? ' sel' : '') + (n.deleted ? ' del' : '')); row.tabIndex = 0;
    const num = el('span', 'nt-num', String(n.n)); num.style.background = tagColor(n.tag); if (C.unread(n, me, S.since)) num.classList.add('new');
    const mid = el('div', 'nt-mid'); const first = n.messages.find(m => !m.deleted) || n.messages[0];
    mid.append(el('div', 'nt-line', first ? first.text.replace(/\s+/g, ' ') : ''));
    const last = n.messages.filter(m => !m.deleted); const lm = last[last.length - 1];
    const meta = el('div', 'nt-meta'); meta.textContent = C.where(n) + ' · ' + (lm ? lm.by : n.created.by) + ' · ' + C.ago(C.lastChange(n)) + (last.length > 1 ? ' · ' + (last.length - 1) + (last.length === 2 ? ' reply' : ' replies') : '') + (n.assignee ? ' · for ' + n.assignee : '');
    mid.append(meta);
    const chk = iconBtn('check', n.status === 'resolved' ? 'Open it again' : 'Mark as resolved', n.status === 'resolved' ? 'on' : '');
    chk.addEventListener('click', (e) => { e.stopPropagation(); needName(() => change(n.status === 'resolved' ? 'Reopen note' : 'Resolve note', () => C.setStatus(n, author(), n.status === 'resolved' ? 'open' : 'resolved')), 'Before you change a note, it needs to know who you are.'); });
    row.append(num, mid, chk);
    row.addEventListener('click', () => openNote(n.id)); row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openNote(n.id); });
    return row;
  }
  function buildCard() {
    const side = document.getElementById('sidebar-right'); if (!side || document.getElementById('notes-section')) return;
    const ref = [...side.querySelectorAll('.side-group')].find(g => /find/i.test(g.textContent)); if (!ref) return;
    const grp = el('div', 'side-group', 'Review');
    const sec = el('div', 'section'); sec.id = 'notes-section';
    sec.innerHTML = '<div class="section-h"><i class="sec-ico">' + svg('note') + '</i><span>Notes</span><span class="sec-count" id="notes-count" hidden></span><span class="chev">▾</span></div><div class="section-b" id="notes-body"></div>';
    const body = $('#notes-body', sec);
    const top = el('div', 'nt-top-row'); const me = el('button', 'nt-me', ''); me.type = 'button'; me.title = 'The name shown next to what you write';
    me.addEventListener('click', () => askName('Change the name shown next to what you write.').then(n => { if (n) setAuthor(n); }));
    const pins = iconBtn('eye', 'Hide the pins'); pins.addEventListener('click', () => { S.pins = !S.pins; render(); });
    top.append(avatarSlot(), me, el('span', 'nt-grow'), pins); body.append(top);
    const acts = el('div', 'nt-actions'); const addPin = el('button', 'btn nt-add', ''); addPin.type = 'button'; addPin.innerHTML = svg('pin') + '<span>Add note</span><kbd class="kbd">N</kbd>'; addPin.title = 'Click a spot on the model to leave a note (N)';
    addPin.addEventListener('click', () => (S.placing ? stopPlace() : startPlace()));
    const addSel = el('button', 'btn', 'On selected part'); addSel.type = 'button'; addSel.addEventListener('click', addForSelection);
    const addScn = el('button', 'btn', 'Scene note'); addScn.type = 'button'; addScn.addEventListener('click', addForScene);
    acts.append(addPin, addSel, addScn); body.append(acts);
    const bar = el('div', 'nt-filter'); const fsel = el('select', 'nt-sel');
    for (const [v, l] of [['open', 'Open'], ['all', 'All'], ['resolved', 'Resolved'], ['unread', 'New to me'], ['mine', 'Mine'], ['deleted', 'Deleted']]) { const o = el('option', null, l); o.value = v; fsel.append(o); }
    fsel.value = S.filter; fsel.addEventListener('change', () => { S.filter = fsel.value; render(); }); fsel.addEventListener('keydown', (e) => e.stopPropagation());
    const ssel = el('select', 'nt-sel'); for (const [v, l] of [['number', 'By number'], ['newest', 'Newest first'], ['part', 'By part']]) { const o = el('option', null, l); o.value = v; ssel.append(o); }
    ssel.addEventListener('change', () => { S.sort = ssel.value; render(); }); ssel.addEventListener('keydown', (e) => e.stopPropagation());
    const q = el('input', 'nt-search'); q.type = 'search'; q.placeholder = 'Search notes'; q.addEventListener('input', () => { S.search = q.value.trim(); render(); }); q.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { q.value = ''; S.search = ''; render(); } });
    bar.append(fsel, ssel); body.append(bar, q);
    const list = el('div', 'nt-list'); body.append(list);
    const markRead = el('button', 'nt-link', ''); markRead.type = 'button'; markRead.hidden = true; markRead.addEventListener('click', markAllRead); body.append(markRead);
    const foot = el('div', 'nt-foot');
    const imp = el('button', 'btn', ''); imp.type = 'button'; imp.innerHTML = svg('down') + '<span>Bring in notes…</span>'; imp.title = 'Add the notes of another copy of this scene (a saved scene file)'; imp.addEventListener('click', importFromFile);
    const rep = el('button', 'btn', ''); rep.type = 'button'; rep.innerHTML = svg('up') + '<span>Report…</span>'; rep.title = 'Save the notes as a page anyone can open, with no app'; rep.addEventListener('click', saveReport);
    const cp = el('button', 'btn', ''); cp.type = 'button'; cp.innerHTML = svg('copy') + '<span>Copy</span>'; cp.title = 'Copy the notes as text'; cp.addEventListener('click', () => copy(C.toMarkdown(S.items, { title: title(), at: new Date().toISOString() })));
    foot.append(imp, rep, cp); body.append(foot);
    ref.parentNode.insertBefore(grp, ref); ref.parentNode.insertBefore(sec, ref);
    S.card = { section: sec, body, list, pins, addPin, markRead, foot };
    sec.querySelector('.section-h').addEventListener('click', () => sec.classList.toggle('collapsed'));
  }
  function avatarSlot() { const s = el('span', 'nt-ic'); s.innerHTML = svg('user'); return s; }
  const title = () => 'Notes' + (S.host.state._loadedFilename ? ' · ' + S.host.state._loadedFilename : '');
  function markAllRead() { const a = author(); if (!a) return; S.seen[a] = new Date().toISOString(); updateSince(); render(); }

  // ── saving, opening, bringing in notes from another copy ────────────────────────────────────────────────────────────────────
  function serialize() {
    const a = author(); if (a) S.seen[a] = new Date().toISOString();
    return C.serialize(S.items.map(n => Object.assign({}, n, { thumb: n.thumb || S.thumbs[n.id] || '' })), S.seen);
  }
  const count = () => S.items.length;
  function load(raw, o) {
    o = o || {};
    const p = C.parse(raw); S.items = p.items; S.seen = p.seen; S.parts.clear(); S.thumbs = {};
    for (const n of S.items) if (n.thumb) S.thumbs[n.id] = n.thumb;
    for (const [id, b] of pinEls) { b.remove(); pinEls.delete(id); }
    closePop(); updateSince(); render();
    const st = C.stats(S.items);
    if (st.total && !o.quiet) {
      const me = author(), news = S.items.filter(n => C.unread(n, me, S.since)).length;
      S.host.toast(st.total + (st.total === 1 ? ' note' : ' notes') + ' in this scene', st.open + ' open' + (news ? ' · ' + news + ' new to you' : '') + (me ? '' : ' · type your name to answer'), 'info', 5200);
      const sec = S.card && S.card.section; if (sec) sec.classList.remove('collapsed');
    }
  }
  function reset() { S.items = []; S.seen = {}; S.thumbs = {}; S.parts.clear(); S.filter = 'open'; S.search = ''; for (const [id, b] of pinEls) { b.remove(); pinEls.delete(id); } closePop(); stopPlace(); updateSince(); render(); }
  function importFromFile() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.glb,model/gltf-binary';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      try {
        const st = C.fromGlb(await f.arrayBuffer(), S.host.sceneKey);
        if (!st || !st.notes) { S.host.toast('No notes found', f.name + ' has no notes in it', 'warn', 4500); return; }
        const theirs = C.parse(st.notes);
        needName(() => {
          const r = C.merge(S.items, theirs.items);
          change('Bring in notes', () => { S.items = r.items; for (const n of S.items) if (n.thumb) S.thumbs[n.id] = n.thumb; });
          for (const k of Object.keys(theirs.seen)) if (!S.seen[k] || theirs.seen[k] > S.seen[k]) S.seen[k] = theirs.seen[k];
          updateSince(); render();
          S.host.toast('Notes brought in', r.added + ' new · ' + r.changed + ' changed, from ' + f.name, 'success', 5000);
        }, 'Before notes are brought in, they need to know who you are.');
      } catch (e) { console.warn('[notes] import failed:', e); S.host.toast('Could not read the file', String(e && e.message || e), 'error', 5000); }
    });
    inp.click();
  }
  function download(name, mime, data) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: mime })); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function saveReport() {
    if (!C.stats(S.items).total) { S.host.toast('Notes', 'There are no notes yet', 'info', 2200); return; }
    const base = (S.host.state._loadedFilename || 'scene').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-');
    download(base + '-notes.html', 'text/html', C.toHtml(S.items, { title: title(), at: new Date().toISOString() }));
    S.host.toast('Report saved', 'One page: it opens in any browser, with the pictures and who said what.', 'success', 4500);
  }

  // ── keys and the rest ────────────────────────────────────────────────────────────────────────────────────────────────────
  function onKey(e) {
    if (e.key === 'Escape') {
      if (S.placing) { e.preventDefault(); e.stopImmediatePropagation(); stopPlace(); return; }
      if (S.pop && !(e.target && /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName))) { e.preventDefault(); e.stopImmediatePropagation(); closePop(); }
    }
  }
  function css() {
    const st = el('style'); st.textContent = `
.notes-placing #canvas{cursor:crosshair!important}
#note-pins{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:60}
.note-pin{position:absolute;left:0;top:0;margin:-12px 0 0 -12px;width:24px;height:24px;border-radius:12px 12px 12px 3px;border:2px solid #fff;background:var(--c,#4da3ff);color:#fff;font:600 11px/1 var(--font-sans,system-ui);display:grid;place-items:center;pointer-events:auto;cursor:pointer;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.45);transition:opacity .15s,scale .12s}
.note-pin:hover,.note-pin.sel{scale:1.18;z-index:2}.note-pin.sel{outline:2px solid var(--ac,#0d99ff);outline-offset:2px}
.note-pin.back{opacity:.4}.note-pin.hid{opacity:.25;border-style:dashed}.note-pin.gone{border-style:dotted;filter:grayscale(1)}
.note-pin.done{background:#5b6168;opacity:.7}.note-pin.new::after{content:'';position:absolute;right:-5px;top:-5px;width:9px;height:9px;border-radius:5px;background:#ff3b6b;border:2px solid var(--bg,#111)}
.note-pop{position:absolute;z-index:70;width:320px;max-height:min(560px,calc(100% - 16px));overflow:auto;background:var(--surface-pop,#1a1a1c);border:1px solid var(--bd2,#444);border-radius:var(--r-md,10px);box-shadow:0 12px 40px rgba(0,0,0,.55);padding:10px;color:var(--tx,#eee);font:12px/1.45 var(--font-sans,system-ui);display:flex;flex-direction:column;gap:8px}
.nt-head{display:flex;align-items:center;gap:6px}.nt-grow{flex:1}.nt-num{display:inline-grid;place-items:center;min-width:22px;height:22px;border-radius:11px;color:#fff;font:600 11px/1 var(--font-sans);padding:0 5px;flex:none}.nt-num.new{box-shadow:0 0 0 2px #ff3b6b}
.nt-ib{width:26px;height:26px;display:inline-grid;place-items:center;border:0;border-radius:7px;background:transparent;color:var(--tx2,#bbb);cursor:pointer;padding:0}.nt-ib:hover:not(:disabled){background:var(--s4,rgba(255,255,255,.1));color:var(--tx,#fff)}.nt-ib:disabled{opacity:.3;cursor:default}.nt-ib svg{width:15px;height:15px}.nt-ib.on{color:#3ecf8e}
.nt-btn{height:26px;padding:0 10px;border:1px solid var(--bd,#333);border-radius:7px;background:var(--bg3,#252525);color:var(--tx,#eee);font:inherit;cursor:pointer}.nt-btn:hover:not(:disabled){background:var(--bg4,#2f2f2f)}.nt-btn.primary{background:var(--ac,#0d99ff);border-color:transparent;color:#fff}.nt-btn.primary:disabled{opacity:.4;cursor:default}.nt-btn.on{color:#3ecf8e;border-color:#3ecf8e55}
.nt-sel{height:26px;border:1px solid var(--bd,#333);border-radius:7px;background:var(--bg3,#252525);color:var(--tx,#eee);font:inherit;padding:0 6px}.nt-sel.small{max-width:132px}
.nt-where{display:flex;align-items:center;gap:8px;color:var(--tx3,#999);flex-wrap:wrap}.nt-link{background:none;border:0;padding:0;color:var(--ac-text,#4da3ff);cursor:pointer;font:inherit;text-align:left}.nt-link:hover{text-decoration:underline}.nt-link.warn,.nt-warn{color:#ffb454}
.nt-thumb{width:100%;border-radius:8px;display:block;cursor:pointer;border:1px solid var(--bd,#333)}
.nt-msgs{display:flex;flex-direction:column;gap:10px;max-height:280px;overflow:auto}.nt-msg{display:flex;gap:8px}.nt-av{flex:none;width:22px;height:22px;border-radius:11px;color:#fff;display:grid;place-items:center;font:600 11px/1 var(--font-sans)}
.nt-body{flex:1;min-width:0}.nt-top{display:flex;align-items:center;gap:6px}.nt-time{color:var(--tx3,#888);font-size:11px}.nt-acts{display:none}.nt-msg:hover .nt-acts{display:inline-flex}
.nt-text,.nt-was{white-space:pre-wrap;overflow-wrap:anywhere}.nt-was{color:var(--tx3,#999);margin:2px 0 6px;padding-left:8px;border-left:2px solid var(--bd2,#444)}.nt-gone{color:var(--tx3,#888);font-style:italic}
.nt-edited{font-size:11px;margin-top:2px}.nt-prev{margin-top:4px;font-size:11px}
.nt-hist{color:var(--tx3,#999);font-size:11px}.nt-hist ul{margin:4px 0 0;padding-left:16px;max-height:110px;overflow:auto}
.nt-comp{display:flex;flex-direction:column;gap:6px}.nt-comp textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:48px;max-height:160px;padding:7px 9px;border:1px solid var(--bd2,#444);border-radius:8px;background:var(--bg2,#1c1c1e);color:var(--tx,#eee);font:inherit}.nt-comp textarea:focus{outline:none;border-color:var(--ac,#0d99ff)}
.nt-comp-row{display:flex;align-items:center;gap:6px}.nt-as{color:var(--tx3,#999);font-size:11px;cursor:pointer}.nt-as:hover{color:var(--tx,#fff);text-decoration:underline}
.nt-menu{position:absolute;z-index:5;min-width:210px;background:var(--bg3,#252525);border:1px solid var(--bd2,#444);border-radius:9px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;flex-direction:column}.nt-menu button{background:none;border:0;text-align:left;color:var(--tx,#eee);font:inherit;padding:6px 9px;border-radius:6px;cursor:pointer}.nt-menu button:hover{background:var(--bg4,#333)}.nt-menu .danger{color:#ff6b5e}
#notes-section .sec-ico svg{display:block;width:100%;height:100%}
#notes-body{display:flex;flex-direction:column;gap:8px}.nt-top-row{display:flex;align-items:center;gap:6px}.nt-ic{width:18px;height:18px;color:var(--tx3,#888);display:grid;place-items:center}.nt-ic svg{width:15px;height:15px}
.nt-me{background:none;border:0;color:var(--tx,#eee);font:inherit;cursor:pointer;padding:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nt-me:hover{text-decoration:underline}
.nt-actions{display:flex;gap:6px;flex-wrap:wrap}.nt-actions .btn{flex:1 1 auto}.nt-add{display:inline-flex;align-items:center;justify-content:center;gap:6px}.nt-add svg{width:14px;height:14px}.nt-add.on{outline:1px solid var(--ac,#0d99ff)}
.nt-filter{display:flex;gap:6px}.nt-filter .nt-sel{flex:1;min-width:0}.nt-search{width:100%;box-sizing:border-box;height:28px;padding:0 9px;border:1px solid var(--bd,#333);border-radius:7px;background:var(--bg2,#1c1c1e);color:var(--tx,#eee);font:inherit}
.nt-list{display:flex;flex-direction:column;gap:2px;max-height:300px;overflow:auto}.nt-empty{color:var(--tx3,#888);padding:6px 2px}
.nt-row{display:flex;align-items:center;gap:8px;padding:6px 6px;border-radius:8px;cursor:pointer}.nt-row:hover{background:var(--hairline,rgba(255,255,255,.05))}.nt-row.sel{background:var(--ac-tint-15,rgba(13,153,255,.15))}.nt-row.done .nt-line{text-decoration:line-through;opacity:.6}.nt-row.del{opacity:.5}
.nt-mid{flex:1;min-width:0}.nt-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nt-meta{color:var(--tx3,#888);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nt-foot{display:flex;gap:6px;flex-wrap:wrap}.nt-foot .btn{flex:1 1 auto;display:inline-flex;align-items:center;justify-content:center;gap:5px}.nt-foot svg{width:13px;height:13px}
`;
    document.head.append(st);
  }

  function init(host) {
    if (S.host) return;
    S.host = host; css();
    const vp = host.viewport();
    if (vp) { S.layer = el('div'); S.layer.id = 'note-pins'; vp.append(S.layer); }
    buildCard();
    // clicking a spot while placing: a press that ends within 4 px is the click; a drag still turns the view (as in Measure)
    const canvas = host.canvas();
    if (canvas) {
      let down = null;
      canvas.addEventListener('mousedown', (e) => { if (!S.placing || e.button !== 0) return; if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return; down = { x: e.clientX, y: e.clientY }; e.stopImmediatePropagation(); }, { capture: true });
      canvas.addEventListener('mouseup', (e) => { const d = down; down = null; if (!S.placing || e.button !== 0 || !d) return; e.stopImmediatePropagation(); if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) return; placeAt(e); }, { capture: true });
    }
    window.addEventListener('keydown', onKey, true);
    updateSince(); render();
  }
  window.MONotesUI = {
    init, layout, load, reset, serialize, count, undoOp,
    togglePlace: () => (S.placing ? stopPlace() : startPlace()), addForSelection, addForScene, importFromFile, saveReport,
    togglePins: () => { S.pins = !S.pins; render(); }, openList: () => { const s = S.card && S.card.section; if (s) { s.classList.remove('collapsed'); s.scrollIntoView({ block: 'nearest' }); } }, next: () => step(1), prev: () => step(-1),
    markAllRead, items: () => S.items, author, isPlacing: () => !!S.placing, setAuthor,
    _state: S,
  };
})();
