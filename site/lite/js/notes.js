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
    pins: true, badge: 'number', placing: null, filter: 'open', sort: 'number', search: '',
    openId: null, draft: null, editing: null, replyTo: null, expanded: false, justDone: null, reviews: {}, onlySel: false, selKey: '', pop: null, layer: null, card: null, parts: new Map(),
  };
  const keepShots = (n) => { S.thumbs[n.id] = { shots: (n.shots || []).slice(), cams: (n.shotCams || []).slice() }; };
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
    thumbup: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
    thumbdown: '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
    reply: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    issue: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    idea: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    expand: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
    collapse: '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
    focus: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    locate: '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/>',
    boxsel: '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  };
  const svg = (n) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';
  const svgEl = (n) => { const i = el('i', 'nt-i'); i.innerHTML = svg(n); return i; };
  const iconBtn = (name, title, cls) => { const b = el('button', 'nt-ib' + (cls ? ' ' + cls : '')); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.innerHTML = svg(name); return b; };
  const SHAPES = {
    circle: '<circle cx="12" cy="12" r="10"/>', square: '<rect x="3" y="3" width="18" height="18" rx="5"/>',
    triangle: '<path d="M12 3.4 21 19.5a1.3 1.3 0 0 1-1.1 1.9H4.1A1.3 1.3 0 0 1 3 19.5Z"/>', diamond: '<path d="M12 2.6 21.4 12 12 21.4 2.6 12Z"/>',
  };
  const TAG_SHAPE = { info: 'circle', question: 'square', issue: 'triangle', idea: 'diamond' };
  const shapeOf = (tag) => TAG_SHAPE[tag] || 'circle';
  const shapeSvg = (tag) => '<svg class="shape" viewBox="0 0 24 24" stroke-linejoin="round" aria-hidden="true">' + SHAPES[shapeOf(tag)] + '</svg>';
  function richText(txt, cls) {
    const d = el('div', 'nt-text' + (cls ? ' ' + cls : '')); const names = [...getAuthors()].sort((a, b) => b.length - a.length);
    if (!names.length || !txt.includes('@')) { d.textContent = txt; return d; }
    const re = new RegExp('@(' + names.map(n => n.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}\\p{N}_])', 'giu'); let i = 0, m;
    while ((m = re.exec(txt))) { if (m.index > i) d.append(txt.slice(i, m.index)); const sp = el('span', 'nt-mention', m[0]); if (author() && m[1].toLowerCase() === author().toLowerCase()) sp.classList.add('me'); d.append(sp); i = m.index + m[0].length; }
    if (i < txt.length) d.append(txt.slice(i)); return d;
  }
  function numBadge(tag, txt, done) { const b = el('span', 'nt-num' + (done ? ' done' : '')); b.style.setProperty('--c', tagColor(tag)); b.dataset.shape = shapeOf(tag); b.innerHTML = shapeSvg(tag) + '<b></b>'; b.lastChild.textContent = txt; return b; }
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
      const bg = el('div', 'dlg-bg show');
      bg.innerHTML = '<div class="dlg-card" style="position:relative"><button class="dlg-close" aria-label="Close">✕</button><div class="dlg-head"><div class="dlg-icon">' + svg('user') + '</div><div class="dlg-text"><div class="dlg-title">Your name</div><div class="dlg-msg"></div><input type="text" class="dlg-input" style="display:block" placeholder="Your name" autocomplete="off" spellcheck="false"></div></div><div class="dlg-foot"><button type="button" class="dlg-btn dlg-btn-cancel">Cancel</button><button type="button" class="dlg-btn dlg-btn-ok" disabled>Continue</button></div></div>';
      const card = $('.dlg-card', bg), inp = $('.dlg-input', bg), cancel = $('.dlg-btn-cancel', bg), ok = $('.dlg-btn-ok', bg);
      $('.dlg-msg', card).textContent = (why || 'Notes show who wrote them.') + ' Type the name others should see next to your notes, replies and edits.';
      inp.maxLength = C.LIMITS.name; document.body.append(bg);
      const done = (v) => { bg.remove(); res(v); };
      inp.addEventListener('input', () => { ok.disabled = !C.name(inp.value); });
      bg.addEventListener('mousedown', (e) => { if (e.target === bg) done(null); });
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && C.name(inp.value)) done(C.name(inp.value)); else if (e.key === 'Escape') done(null); });
      ok.addEventListener('click', () => { if (C.name(inp.value)) done(C.name(inp.value)); });
      cancel.addEventListener('click', () => done(null)); $('.dlg-close', card).addEventListener('click', () => done(null));
      setTimeout(() => inp.focus(), 30);
    });
  }

  // ── every change is one undo step ─────────────────────────────────────────────────────────────────────
  const snapshot = () => JSON.stringify(S.items.map(n => Object.assign({}, n, { thumb: '', shots: [], shotCams: [] })));
  function restoreSnapshot(json) {
    let raw = []; try { raw = JSON.parse(json); } catch (_) { return; }
    S.items = C.parse({ items: raw }).items;
    for (const n of S.items) { const k = S.thumbs[n.id] || { shots: [], cams: [] }; n.shots = k.shots.slice(); n.shotCams = k.cams.slice(); n.thumb = n.shots[0] || ''; }
    S.parts.clear(); if (S.openId && !C.find(S.items, S.openId)) closePop(); render();
  }
  function change(label, fn) {
    const before = snapshot(); const r = fn(); const after = snapshot();
    if (before !== after) S.host.pushUndo({ type: 'notes', label, before, after });
    S._auth = null; render(); return r;
  }
  function undoOp(op, forward) { restoreSnapshot(forward ? op.after : op.before); }

  // ── where a note is ───────────────────────────────────────────────────────────────────────────────────────
  const V = () => S.host.THREE;
  // every part a note is about: the one its pin is on, then the others
  // a part by its uid or name: looked up in a table made once for each time the window or the list is drawn (not a search through every part for every card)
  const resolveRef = (ref) => {
    if (!ref) return null;
    const m = S._pmap || (S._pmap = (() => { const byUid = new Map(), byName = new Map(); for (const q of S.host.state.parts) { if (q.deleted) continue; if (q.uid && !byUid.has(q.uid)) byUid.set(q.uid, q); if (q.name && !byName.has(q.name)) byName.set(q.name, q); } return { byUid, byName }; })());
    return (ref.uid && m.byUid.get(ref.uid)) || (ref.name && m.byName.get(ref.name)) || null;
  };
  const getAuthors = () => S._auth || (S._auth = C.authors(S.items));      // (the names on the notes: worked out once for each change, not for every message)
  function partsOf(n) { const out = []; const p = partOf(n); if (p) out.push(p); for (const ref of n.also || []) { const q = resolveRef(ref); if (q && !out.includes(q)) out.push(q); } return out; }
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
  const pinEls = new Map(), pinAt = new Map();
  const _v = { w: null, n: null };
  function layout() {
    const h = S.host; if (!h || !S.layer) return;
    if (S.onlySel) { const k = [...h.state.selected].join(','); if (k !== S.selKey) { S.selKey = k; render(); return; } }      // (the list follows the selection)
    const show = S.pins && S.items.some(n => !n.deleted && n.kind !== 'scene');
    S.layer.style.display = show ? '' : 'none';
    if (!show) return;
    const cam = h.cam(), cv = h.canvas(), vp = h.viewport(); if (!cam || !cv || !vp) return;
    const r = cv.getBoundingClientRect(), vr = vp.getBoundingClientRect(); if (!r.width) return;
    _v.w = _v.w || new (V().Vector3)(); _v.n = _v.n || new (V().Vector3)(); _v.p = _v.p || new (V().Vector3)(); _v.d = _v.d || new (V().Vector3)();
    const camPos = cam.position;
    for (const n of S.items) {
      let pin = pinEls.get(n.id);
      const vis = !n.deleted && n.kind !== 'scene' && passes(n, true);
      if (!vis) { if (pin) pin.style.display = 'none'; continue; }
      const w = worldOf(n, _v.w);
      if (!w) { if (pin) pin.style.display = 'none'; continue; }
      if (!pin) pin = makePin(n);
      const p = _v.p.copy(_v.w).project(cam);
      if (!(p.z > -1 && p.z < 1)) { pin.style.display = 'none'; continue; }
      pin.style.display = '';
      const px = Math.round((p.x * 0.5 + 0.5) * r.width + (r.left - vr.left)), py = Math.round((-p.y * 0.5 + 0.5) * r.height + (r.top - vr.top)); pinAt.set(n.id, { x: px, y: py });
      const tf = 'calc(' + px + 'px - 50%) calc(' + py + 'px - 50%)'; if (pin._tf !== tf) { pin._tf = tf; pin.style.translate = tf; }
      let away = false;
      const part = partOf(n);
      if (n.normal && part && part.mesh) { _v.n.fromArray(n.normal).transformDirection(part.mesh.matrixWorld); away = _v.n.dot(_v.d.copy(camPos).sub(w)) < 0; }
      pin.classList.toggle('back', away);
      pin.classList.toggle('hid', !!(part && !part.visible));
      pin.classList.toggle('gone', !!n.part && !part);
    }
    for (const [id, pin] of pinEls) if (!C.find(S.items, id)) { pin.remove(); pinEls.delete(id); }
  }
  function makePin(n) {
    const b = el('button', 'note-pin'); b.type = 'button'; b.dataset.id = n.id; b.addEventListener('click', (e) => { e.stopPropagation(); openNote(n.id, { fly: false }); });
    b.addEventListener('mousedown', (e) => e.stopPropagation()); b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); pinMenu(n.id, e.clientX, e.clientY); });
    b.classList.add('in'); b.addEventListener('animationend', () => b.classList.remove('in'), { once: true }); S.layer.append(b); pinEls.set(n.id, b); decoratePin(n, b); return b;
  }
  function selectNoteParts(n) { const ps = partsOf(n); if (!ps.length) { S.host.toast('Notes', 'Its parts are not in the scene', 'info', 2000); return; } S.host.selectParts(ps); }
  // the parts selected now join the parts of the note (the ones it has stay); each new one gets its own card
  function attachSelected(n) {
    const sel = [...S.host.state.selected].map(id => S.host.getPart(id)).filter(p => p && !p.deleted); if (!sel.length) { S.host.toast('Notes', 'Select the parts in the viewport first', 'info', 2200); return; }
    const have = [n.part].concat(n.also || []).filter(Boolean), same = (a, b) => (a.uid && a.uid === b.uid) || (a.name && a.name === b.name);
    const add = sel.map(p => S.host.partRef(p)).filter(r2 => !have.some(h => same(h, r2)));
    if (!add.length) { S.host.toast('Notes', sel.length === 1 ? 'That part is already on this note' : 'Those parts are already on this note', 'info', 2200); return; }
    S.freshParts = add.map(r2 => r2.uid || r2.name);
    change('Add parts', () => { const rest = add.slice(); if (!n.part) { n.part = rest.shift(); if (n.kind === 'scene') n.kind = 'part'; } C.setAlso(n, author(), (n.also || []).concat(rest)); });
    S.parts.delete(n.id); buildPop(); S.host.toast('Note ' + n.n, add.length === 1 ? 'A part was added' : add.length + ' parts were added', 'success', 1800);
  }
  // one part comes off the note; if it was the one the pin is on, the next one takes the pin
  function removePart(n, i) {
    const refs = [n.part].concat(n.also || []).filter(Boolean); if (i < 0 || i >= refs.length) return; refs.splice(i, 1);
    if (!refs.length) { change('Take a part off', () => { C.moveAnchor(n, author(), { part: null }); C.setAlso(n, author(), []); if (n.kind === 'part') n.kind = 'scene'; }); S.parts.delete(n.id); buildPop(); return; }
    if (i === 0) { const q = resolveRef(refs[0]), a = q && S.host.partAnchor(q); change('Take a part off', () => { C.moveAnchor(n, author(), { part: refs[0], local: a ? a.local : null, world: a ? a.world : n.world, normal: null }); C.setAlso(n, author(), refs.slice(1)); }); }
    else change('Take a part off', () => C.setAlso(n, author(), refs.slice(1)));
    S.parts.delete(n.id); buildPop();
  }
  function flyToPart(q) { const a = q && S.host.partAnchor(q); if (a) flyTo({ id: '__f', kind: 'pin', part: null, world: a.world, cam: null }, true); else S.host.toast('Notes', 'That part cannot be shown', 'info', 1800); }
  // right-click on a pin: what people do with a note, without opening it first
  function pinMenu(id, x, y) {
    const n = C.find(S.items, id); if (!n || !S.host.ctxMenu) return;
    const need = 'Before you change a note, it needs to know who you are.'; const me = author(); const done = n.status === 'resolved';
    const last = [...n.messages].reverse().find(m => !m.deleted);
    S.host.ctxMenu([
      { icon: 'message-square', label: 'Open', fn: () => openNote(id, { fly: false }) },
      { icon: 'message-square', label: 'Open the conversation', fn: () => openNote(id, { fly: false, expand: true }) },
      { icon: 'message-square', label: 'Comment…', fn: () => { openNote(id, { fly: false, expand: true }); setTimeout(() => { const ta = $('textarea', S.pop); if (ta) ta.focus(); }, 60); } },
      { icon: 'pencil', label: 'Edit…', fn: () => { openNote(id, { fly: false, expand: true }); S.editProps = true; buildPop(); setTimeout(() => { const i = S.pop && S.pop.querySelector('.nt-rename'); if (i) { i.focus(); i.select(); } }, 40); } },
      '---',
      { icon: 'check', label: done ? 'Open it again' : 'Mark as resolved', fn: () => needName(() => change(done ? 'Reopen note' : 'Resolve note', () => C.setStatus(n, author(), done ? 'open' : 'resolved')), need) },
      { icon: 'palette', label: 'Tag', sub: C.TAGS.map(t => ({ icon: 'circle', label: t.label + (t.id === n.tag ? '  ✓' : ''), fn: () => needName(() => change('Tag note', () => C.setTag(n, author(), t.id)), need) })) },
      { icon: 'calendar', label: 'Due date', sub: [['Today', C.todayStr(0)], ['Tomorrow', C.todayStr(1)], ['In a week', C.todayStr(7)], ['Take it off', '']].map(([l, d]) => ({ icon: 'calendar', label: l + (d && n.due === d ? '  ✓' : ''), fn: () => needName(() => change('Due date', () => C.setDue(n, author(), d)), need) })) },
      { icon: 'flag', label: 'Priority', sub: C.PRIORITIES.map(p => ({ icon: 'circle', label: p[0].toUpperCase() + p.slice(1) + ((n.priority || 'normal') === p ? '  ✓' : ''), fn: () => needName(() => change('Priority', () => C.setPriority(n, author(), p)), need) })) },
      { icon: 'user', label: n.assignee && n.assignee === me ? 'Take my name off it' : 'Assign to me', fn: () => needName(() => change('Assign note', () => C.assign(n, author(), n.assignee === author() ? '' : author())), need) },
      '---',
      { icon: 'locate', label: 'Show it in the view', fn: () => flyTo(n, true) },
      { icon: 'box-select', label: 'Select its parts' + ((n.also || []).length ? ' (' + (1 + n.also.length) + ')' : ''), off: n.kind === 'scene' ? 'This note is about the whole scene' : false, fn: () => selectNoteParts(n) },
      { icon: 'crosshair', label: 'Move the pin…', off: n.kind === 'scene' ? 'This note is about the whole scene' : false, fn: () => startPlace({ moveId: id }) },
      { icon: 'focus', label: 'Show only the parts with notes', fn: () => isolateNoted() },
      { icon: 'copy', label: 'Copy as text', fn: () => copy(C.toText([n], { title: 'Note ' + n.n })) },
      { icon: 'eye-off', label: 'Hide all pins', fn: () => { S.pins = false; render(); } },
      '---',
      { icon: 'trash-2', label: 'Delete the note', danger: true, fn: () => needName(() => { change('Delete note', () => C.removeNote(n, author())); if (S.openId === id) closePop(); }, need) },
    ], x, y);
  }
  function decoratePin(n, b) {
    const mode = S.badge; const who = (n.messages[0] && n.messages[0].by) || n.created.by;
    const snip = mode === 'text' ? C.noteTitle(n) : '';
    const face = mode + '|' + n.tag + '|' + (mode === 'number' ? n.n : mode === 'name' ? who : mode === 'text' ? snip : '');
    if (b._face !== face) {
      b._face = face; b.className = b.className.replace(/\bb-\w+/g, '').trim() + ' b-' + mode; b.dataset.shape = shapeOf(n.tag);
      if (mode === 'text') { b.innerHTML = '<i>' + shapeSvg(n.tag) + '</i><span></span>'; b.lastChild.textContent = snip || 'Note ' + n.n; }
      else {
        b.innerHTML = shapeSvg(n.tag) + (mode === 'color' ? '' : '<b></b>');
        if (mode === 'number') b.lastChild.textContent = String(n.n); else if (mode === 'name') b.lastChild.textContent = (who.trim()[0] || '?').toUpperCase(); else if (mode === 'icon') b.lastChild.innerHTML = svg(n.tag);
      }
      b.style.setProperty('--bg-name', mode === 'name' ? 'hsl(' + hue(who) + ' 45% 38%)' : '');
    }
    const pri = n.priority || 'normal'; if (b.dataset.pri !== pri) b.dataset.pri = pri;
    b.classList.toggle('late', C.dueState(n) === 'overdue');
    const col = tagColor(n.tag); if (b._col !== col) { b._col = col; b.style.setProperty('--c', col); }
    b.classList.toggle('done', n.status === 'resolved');
    b.classList.toggle('sel', S.openId === n.id);
    b.classList.toggle('new', C.unread(n, author(), S.since));
    const tip = '#' + n.n + ' · ' + C.noteTitle(n); if (b.title !== tip) b.title = tip;
  }

  // ── the pop-up conversation ────────────────────────────────────────────────────────────────────────────────────
  function closePop() { if (S.pop) { S.pop.remove(); S.pop = null; } S.openId = null; S.draft = null; S.editing = null; S.replyTo = null; S.editProps = false; for (const [id, b] of pinEls) { const n = C.find(S.items, id); if (n) decoratePin(n, b); } }
  function placePop() {
    const pop = S.pop, vp = S.host.viewport(); if (!pop || !vp) return;
    const vr = vp.getBoundingClientRect(); const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = vr.width - w - 16, y = 64;
    if (S.popPos) { x = S.popPos.x; y = S.popPos.y; }
    else {      // the right-hand side, below the bars and above the shortcut tips
      const tips = $('.vp-tips:not(:empty)', vp), tr = tips && tips.getBoundingClientRect();
      if (tr && tr.width && y + h > tr.top - vr.top - 8) y = Math.max(8, tr.top - vr.top - h - 8);
    }
    x = Math.max(8, Math.min(x, vr.width - w - 8)); y = Math.max(8, Math.min(y, vr.height - h - 8));
    const lx = Math.round(x) + 'px', ly = Math.round(y) + 'px'; if (pop._lx !== lx) { pop._lx = lx; pop.style.left = lx; } if (pop._ly !== ly) { pop._ly = ly; pop.style.top = ly; }
  }
  // drag it by its top row; where it is left is where the next one opens
  function enableDrag(pop) {
    for (const head of [$('.nt-titlebar', pop), $('.nt-bar', pop), $('.nt-head', pop)]) {
      if (!head) continue;
      head.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button, select, input, textarea')) return;
        const vp = S.host.viewport(), vr = vp.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, ox = parseFloat(pop.style.left) || 0, oy = parseFloat(pop.style.top) || 0;
        try { head.setPointerCapture(e.pointerId); } catch (_) {} pop.classList.add('dragging'); e.preventDefault();
        const mv = (ev) => {
          const x = Math.max(8, Math.min(ox + ev.clientX - sx, vr.width - pop.offsetWidth - 8)), y = Math.max(8, Math.min(oy + ev.clientY - sy, vr.height - pop.offsetHeight - 8));
          pop.style.left = pop._lx = Math.round(x) + 'px'; pop.style.top = pop._ly = Math.round(y) + 'px';
        };
        const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); pop.classList.remove('dragging'); S.popPos = { x: parseFloat(pop.style.left) || 0, y: parseFloat(pop.style.top) || 0 }; };
        head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
      });
    }
  }
  // size: pull an edge or a corner; the size is kept for the next windows (the height only for the full form)
  const MIN_W = 300, MAX_W = 700, MIN_H = 260;
  function applySize(pop) {
    if (S.popSize && S.popSize.w) pop.style.width = S.popSize.w + 'px';
    if (S.expanded && S.popSize && S.popSize.h) { pop.style.height = S.popSize.h + 'px'; pop.style.maxHeight = 'calc(100% - 16px)'; }
  }
  function enableResize(pop) {
    for (const edge of ['e', 'w', 's', 'se', 'sw']) {
      const h = el('div', 'nt-rz nt-rz-' + edge); h.setAttribute('aria-hidden', 'true'); pop.append(h);
      h.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
        const vr = S.host.viewport().getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
        const L = parseFloat(pop.style.left) || 0, T = parseFloat(pop.style.top) || 0, W = pop.offsetWidth, H = pop.offsetHeight;
        try { h.setPointerCapture(e.pointerId); } catch (_) {} pop.classList.add('dragging');
        const mv = (ev) => {
          const dx = ev.clientX - x0, dy = ev.clientY - y0; let w = W, hh = H, l = L;
          if (edge.includes('e')) w = Math.max(MIN_W, Math.min(W + dx, MAX_W, vr.width - 8 - L));
          if (edge.includes('w')) { w = Math.max(MIN_W, Math.min(W - dx, MAX_W, W + L - 8)); l = L + (W - w); }
          if (edge.includes('s')) hh = Math.max(MIN_H, Math.min(H + dy, vr.height - 8 - T));
          pop.style.width = w + 'px'; pop.style.left = pop._lx = Math.round(l) + 'px';
          if (edge.includes('s')) { pop.style.height = hh + 'px'; pop.style.maxHeight = 'calc(100% - 16px)'; }
        };
        const up = () => {
          h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); pop.classList.remove('dragging');
          S.popSize = Object.assign({}, S.popSize, { w: pop.offsetWidth }); if (edge.includes('s')) S.popSize.h = pop.offsetHeight;
          S.popPos = { x: parseFloat(pop.style.left) || 0, y: parseFloat(pop.style.top) || 0 };
        };
        h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
      });
    }
  }
  // after a rebuild or a change of height: stay where it is, only keep it inside the view
  function clampPop() {
    const pop = S.pop, vp = S.host.viewport(); if (!pop || !vp) return; const vr = vp.getBoundingClientRect();
    const x = Math.max(8, Math.min(parseFloat(pop.style.left) || 8, vr.width - pop.offsetWidth - 8)), y = Math.max(8, Math.min(parseFloat(pop.style.top) || 8, vr.height - pop.offsetHeight - 8));
    pop.style.left = Math.round(x) + 'px'; pop.style.top = Math.round(y) + 'px'; pop._lx = pop.style.left; pop._ly = pop.style.top;
  }
  // the four tags as four small dots in a row: the one that is lit is the note's
  function tagDots(cur, onChange) {
    const wrap = el('span', 'nt-tags'); const name = el('span', 'nt-tagname', C.tagLabel(cur));
    for (const t of C.TAGS) {
      const b = el('button', 'nt-tagdot' + (t.id === cur ? ' on' : '')); b.type = 'button'; b.style.setProperty('--c', t.color); b.title = t.label; b.setAttribute('aria-label', t.label); b.innerHTML = shapeSvg(t.id);
      b.addEventListener('click', () => { if (t.id === cur) return; cur = t.id; for (const x of wrap.querySelectorAll('.nt-tagdot')) x.classList.toggle('on', x === b); name.textContent = t.label; onChange(t.id); });
      wrap.append(b);
    }
    wrap.append(name); return wrap;
  }
  // a message field: grows with what is written, Enter sends, the round arrow sends
  function composer(placeholder, sendLabel, onSend, opts) {
    opts = opts || {};
    const box = el('div', 'nt-comp'); const ta = el('textarea'); ta.rows = 1; ta.placeholder = placeholder; ta.maxLength = C.LIMITS.text; if (opts.value) ta.value = opts.value;
    const row = el('div', 'nt-comp-row'); const as = el('span', 'nt-as'); const send = iconBtn('send', sendLabel + ' (Enter)', 'nt-send'); send.disabled = !ta.value.trim();
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
    const paintAs = () => { as.textContent = author() ? author() : 'Your name'; };
    paintAs(); as.title = 'Change your name'; as.addEventListener('click', () => askName('Change the name shown next to what you write.').then(n => { if (n) { setAuthor(n); paintAs(); } }));
    const go = () => { const t = ta.value.trim(); if (!t) return; needName(() => { onSend(t); }, 'Before you write, notes need to know who you are.'); };
    const pick = el('div', 'nt-mentions'); pick.hidden = true; box.append(pick); let pi = 0;
    const offer = () => {
      const m = /(^|\s)@([^\s@]{0,30})$/.exec(ta.value.slice(0, ta.selectionStart)); if (!m) { pick.hidden = true; return; }
      const q = m[2].toLowerCase(), me = author(); const names = [...getAuthors()].filter(n => n !== me && n.toLowerCase().startsWith(q)).slice(0, 5);
      if (!names.length) { pick.hidden = true; return; }
      pi = Math.min(pi, names.length - 1); pick.textContent = '';
      names.forEach((nm, i) => { const b = el('button', i === pi ? 'on' : '', '@' + nm); b.type = 'button'; b.addEventListener('mousedown', (e) => { e.preventDefault(); put(nm); }); pick.append(b); }); pick._n = names; pick.hidden = false;
    };
    const put = (nm) => { const pos = ta.selectionStart, head = ta.value.slice(0, pos).replace(/@([^\s@]{0,30})$/, '@' + nm + ' '); ta.value = head + ta.value.slice(pos); ta.selectionStart = ta.selectionEnd = head.length; pick.hidden = true; ta.dispatchEvent(new Event('input')); };
    ta.addEventListener('input', () => { send.disabled = !ta.value.trim(); grow(); offer(); });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (!pick.hidden && pick._n) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pi = (pi + (e.key === 'ArrowDown' ? 1 : pick._n.length - 1)) % pick._n.length; offer(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); put(pick._n[pi]); return; }
        if (e.key === 'Escape') { e.preventDefault(); pick.hidden = true; return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } else if (e.key === 'Escape') { e.preventDefault(); opts.onEsc ? opts.onEsc() : closePop(); }
    });
    send.addEventListener('click', go);
    if (opts.extra) for (const x of opts.extra) row.append(x);
    row.append(as, el('span', 'nt-grow'), send); box.append(ta, row); setTimeout(grow, 0);
    return { box, ta };
  }
  function openNote(id, o) {
    o = o || {};
    const n = C.find(S.items, id); if (!n) return;
    if (!o.keep && !(S.openId === id && !o.expand)) S.expanded = !!o.expand;
    if (S.openId !== id) { S.replyTo = null; S.showHist = false; S.editProps = false; } S.draft = null; S.editing = null; S.openId = id; buildPop(); render();
    if (o.fly !== false) flyTo(n);
  }
  let stickBottom = false;
  function buildPop() {
    const prev = S.pop; const keep = prev && !S.draft && prev._id === S.openId ? { sc: (prev.querySelector('.nt-scroll') || {}).scrollTop || 0, x: prev._lx, y: prev._ly } : null;
    S._auth = null; S._pmap = null;
    const had = !prev || prev.classList.contains('win-focus');      // (a window that was in use stays the one in use when it is drawn again)
    if (prev) prev.remove();
    const n = S.draft || C.find(S.items, S.openId); if (!n) { S.pop = null; return; }
    const pop = el('div', 'note-pop'); pop.addEventListener('mousedown', (e) => e.stopPropagation()); pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    pop.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true }); S.pop = pop; S.host.viewport().append(pop);
    { const tb = el('div', 'nt-titlebar'); let ico = el('span', 'nt-tico'); ico.innerHTML = svg('note');
      if (!S.draft) { ico = numBadge(n.tag, '', n.status === 'resolved'); ico.classList.add('nt-tbadge'); }
      const x = iconBtn('x', S.draft ? 'Cancel (Esc)' : 'Close (Esc)'); x.addEventListener('click', closePop);
      tb.append(ico, el('span', 'nt-ttitle', S.draft ? 'New note' : 'Note ' + n.n), el('span', 'nt-grow'));
      if (!S.draft && !S.editProps) { const fold = iconBtn(S.expanded ? 'collapse' : 'expand', S.expanded ? 'Show less' : 'Show the details and the comments'); fold.classList.add('nt-fold'); fold.addEventListener('click', () => { S.expanded = !S.expanded; buildPop(); }); tb.append(fold); }
      tb.append(x); pop.append(tb); }
    if (S.draft) { buildDraft(pop, S.draft); } else buildThread(pop, n);
    { const sc = el('div', 'nt-scroll'); for (const c of [...pop.children]) if (!c.classList.contains('nt-titlebar')) sc.append(c); pop.append(sc); }
    if (keep) { pop.style.animation = 'none'; if (keep.x) { pop.style.left = keep.x; pop._lx = keep.x; } if (keep.y) { pop.style.top = keep.y; pop._ly = keep.y; } }
    pop._id = S.draft ? '' : S.openId; enableDrag(pop); enableResize(pop); applySize(pop);
    if (had && window.__moWinFocus) window.__moWinFocus(pop);
    if (keep) clampPop(); else placePop();
    if (keep) { const sc2 = $('.nt-scroll', pop); if (sc2) { sc2.scrollTop = stickBottom ? sc2.scrollHeight : keep.sc; stickBottom = false; } }
    const ta = $('textarea', pop); if (ta && !S.editing && S.replyTo) setTimeout(() => ta.focus({ preventScroll: true }), 20);
  }
  // pictures of the view, only when asked for (up to six)
  function shotButton(d, after) {
    const b = iconBtn('camera', 'Add a screenshot of the view', 'nt-shot'); b.classList.toggle('on', !!(d.shots && d.shots.length));
    b.addEventListener('click', async () => {
      d.shots = d.shots || []; if (d.shots.length >= C.LIMITS.shots) { S.host.toast('Notes', 'Up to ' + C.LIMITS.shots + ' screenshots', 'info', 2200); return; }
      b.disabled = true; const v = await captureView(S.draft ? S.draft.world : null); b.disabled = false;
      if (v.thumb) { d.shots.push(v.thumb); (d.shotCams = d.shotCams || []).push(v.cam); } else S.host.toast('Notes', 'The picture could not be taken', 'warn', 2400); after();
    });
    return b;
  }
  // one head for both: a number, a title, a line under it, then the tools in a row above it
  // the row of tools: back and forward on the left, edit, done and more on the right
  function toolBar(tools) { const bar = el('div', 'nt-bar'); bar.append(...(tools.left || []), el('span', 'nt-grow'), ...(tools.right || [])); return bar; }
  function popHead(num, title, sub, tools, onTitle) {
    const head = el('div', 'nt-head'); const hl = el('div', 'nt-hl');
    const t = onTitle ? el('button', 'nt-htitle', title) : el('div', 'nt-htitle', title); if (onTitle) { t.type = 'button'; t.title = 'Click to rename'; t.addEventListener('click', onTitle); }
    hl.append(t); if (num) head.append(num); head.append(hl);
    const out = [head];
    if (sub) { const card = el('div', 'nt-ctx'), tx = el('div', 'nt-ctxtx'); tx.append(el('div', 'nt-ctxname', sub.name), el('div', 'nt-sub', sub.meta)); card.append(svgEl('box'), tx); out.push(card); }
    return out;
  }
  const focusBtn = (tip) => { const b = el('button', 'nt-focus'); b.type = 'button'; b.title = tip; b.setAttribute('aria-label', 'Focus'); b.innerHTML = svg('locate'); return b; };
  function partCard1(n, ref, i, total) {
    const q = resolveRef(ref), key = ref.uid || ref.name, need = 'Before you change a note, it needs to know who you are.';
    const card = el('div', 'nt-partcard' + (S.freshParts && S.freshParts.includes(key) ? ' fresh' : '')); const ico = el('span', 'nt-pico'); ico.innerHTML = svg('box');
    const txt = el('div', 'nt-ptxt'); txt.append(el('div', 'nt-pname', ref.name || 'A part'));
    const sb = [i === 0 && total > 1 ? 'The pin is here' : '', !q ? 'not in the scene' : q.visible ? '' : 'hidden'].filter(Boolean).join(' · '); if (sb) txt.append(el('div', 'nt-psub', sb));
    card.append(txt, el('span', 'nt-grow'));
    if (q && !q.visible) { const eye = iconBtn('eye', 'Show this part'); eye.addEventListener('click', () => { S.host.showPart(q); layout(); buildPop(); }); card.append(eye); }
    const foc = focusBtn('Focus: show this part and highlight it'); foc.disabled = !q; foc.addEventListener('click', () => { if (q) S.host.selectParts([q]); }); card.append(foc);
    if (S.editProps) { const x = iconBtn('trash', 'Delete this part from the note'); x.classList.add('nt-pdel'); x.addEventListener('click', () => needName(() => removePart(n, i), need)); card.append(x); }
    return card;
  }
  function partsSection(n, meta) {
    const scene = n.kind === 'scene' || !n.part, refs = scene ? [] : [n.part].concat(n.also || []), need = 'Before you change a note, it needs to know who you are.';
    const head = el('div', 'nt-seclabel nt-plabel'); head.append(el('span', null, scene ? 'Where' : refs.length > 1 ? 'Parts · ' + refs.length : 'Parts'));
    if (S.editProps && !scene) { const add = el('button', 'nt-padd'); add.type = 'button'; add.title = 'Add the parts that are selected in the viewport'; add.innerHTML = svg('plus') + '<span>Add selected</span>'; add.addEventListener('click', () => needName(() => attachSelected(n), need)); head.append(el('span', 'nt-grow'), add); }
    const out = [head]; if (meta) out.push(el('div', 'nt-pmeta', meta));
    const list = el('div', 'nt-plist2');
    if (scene) {
      const card = el('div', 'nt-partcard'), ico = el('span', 'nt-pico'); ico.innerHTML = svg(n.kind === 'scene' ? 'layers' : 'pin'); const txt = el('div', 'nt-ptxt'); txt.append(el('div', 'nt-pname', n.kind === 'scene' ? 'The whole scene' : 'A point in the scene')); card.append(txt, el('span', 'nt-grow'));
      if (n.kind !== 'scene') { const foc = focusBtn('Focus: go to this point'); foc.addEventListener('click', () => flyTo(n, true)); card.append(foc); }
      list.append(card);
    } else refs.forEach((ref, i) => list.append(partCard1(n, ref, i, refs.length)));
    out.push(list); S.freshParts = null; return out;
  }
  // the properties of a task, in two compact lines: kind and who it is for / how urgent and when. m: { tag, assignee, priority, due, status }
  function propsBlock(m, set) {
    const props = el('div', 'nt-props'), row1 = el('div', 'nt-prow'), row2 = el('div', 'nt-prow');
    row1.append(tagDots(m.tag, (v) => set('tag', v)), el('span', 'nt-grow'));
    const asg = el('select', 'nt-sel nt-asg'); asg.title = 'Who it is for'; const none = el('option', null, 'Assign to…'); none.value = ''; asg.append(none);
    const names = new Set(getAuthors()); if (author()) names.add(author()); if (m.assignee) names.add(m.assignee);
    for (const nm of [...names].sort((a, b) => a.localeCompare(b))) { const o = el('option', null, nm); o.value = nm; if (nm === m.assignee) o.selected = true; asg.append(o); }
    asg.addEventListener('change', () => set('assignee', asg.value)); asg.addEventListener('keydown', (e) => e.stopPropagation()); row1.append(asg);
    const priSeg = el('div', 'nt-seg nt-mini');
    for (const v of C.PRIORITIES) { const b = el('button', (m.priority || 'normal') === v ? 'on' : '', v[0].toUpperCase() + v.slice(1)); b.type = 'button'; b.addEventListener('click', () => set('priority', v)); priSeg.append(b); }
    const dueBox = el('div', 'nt-duebox'), dueIn = el('input', 'nt-date'); dueIn.type = 'date'; dueIn.value = m.due || ''; dueIn.title = 'When it should be done'; dueIn.addEventListener('keydown', (e) => e.stopPropagation());
    dueIn.addEventListener('change', () => set('due', dueIn.value));
    const view = { due: m.due || '', status: m.status || 'open' };
    const pill = el('button', 'nt-due' + (C.dueState(view) === 'overdue' ? ' late' : '') + (m.due ? ' set' : '')); pill.type = 'button'; pill.title = m.due ? 'Change the due date' : 'Set a due date'; pill.innerHTML = svg('calendar') + '<span></span>'; pill.lastChild.textContent = m.due ? C.dueLabel(view).replace(/^Due /, '') : 'Due date';
    pill.addEventListener('click', () => { try { dueIn.showPicker(); } catch (_) { dueIn.focus(); dueIn.click(); } }); dueBox.append(pill, dueIn);
    if (m.due) { const x = iconBtn('x', 'Take the due date off'); x.classList.add('nt-due-clear'); x.addEventListener('click', () => set('due', '')); dueBox.append(x); }
    row2.append(priSeg, dueBox); props.append(row1, row2); return props;
  }
  // the name of the task is edited where it stands
  function startRename(tEl, n) {
    if (!tEl) return; const inp = el('input', 'nt-rename'); inp.value = C.noteTitle(n); inp.maxLength = C.LIMITS.title; inp.setAttribute('aria-label', 'The name of the note');
    tEl.replaceWith(inp); inp.focus(); inp.select(); let fin = false;
    const finish = (save) => {
      if (fin) return; fin = true; const v = inp.value.trim();
      if (save && v && v !== C.noteTitle(n)) needName(() => { change('Rename note', () => C.setTitle(n, author(), v)); buildPop(); }, 'Before you change a note, it needs to know who you are.'); else buildPop();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    inp.addEventListener('blur', () => finish(true));
  }
  // a new note is a form (a task), not a comment: a title, what it is about, who it is for, how urgent, when
  function buildDraft(pop, d) {
    const f = d.form || (d.form = { title: '', desc: '', tag: 'info', assignee: '', priority: 'normal', due: '' });
    let num = numBadge(f.tag, '+');
    pop.append(...popHead(num, 'New note', { name: d.part ? (d.part.name || 'A part') + (d.also && d.also.length ? ' + ' + d.also.length + ' more' : '') : d.kind === 'scene' ? 'The whole scene' : 'A point in the scene', meta: 'A new note' }, {}));
    const form = el('div', 'nt-form'); const ttl = el('input', 'nt-ttl'); ttl.placeholder = 'Title'; ttl.maxLength = C.LIMITS.title; ttl.value = f.title; ttl.setAttribute('aria-label', 'Title');
    const desc = el('textarea', 'nt-descin'); desc.placeholder = 'Description (optional)'; desc.rows = 2; desc.maxLength = C.LIMITS.text; desc.value = f.desc;
    const grow = () => { desc.style.height = 'auto'; desc.style.height = Math.min(Math.max(desc.scrollHeight, 44), 160) + 'px'; };
    form.append(ttl, desc); pop.append(form);
    let props = null;
    const set = (k, v) => { f[k] = v; if (k === 'tag') { const nn = numBadge(v, '+'); num.replaceWith(nn); num = nn; } const np = propsBlock(f, set); props.replaceWith(np); props = np; };
    props = propsBlock(f, set); pop.append(props);
    if (d.shots && d.shots.length) {
      const g = el('div', 'nt-shots nt-shots-draft');
      d.shots.forEach((u, i) => { const w = el('div', 'nt-shotitem'), im = el('img', 'nt-thumb'); im.src = u; im.alt = 'Screenshot ' + (i + 1); w.append(im); const x = iconBtn('x', 'Take this screenshot off', 'nt-shotx'); x.addEventListener('click', () => { d.shots.splice(i, 1); if (d.shotCams) d.shotCams.splice(i, 1); buildPop(); }); w.append(x); g.append(w); });
      pop.append(g);
    }
    const foot = el('div', 'nt-formfoot'); const cam = shotButton(d, buildPop);
    const cancel = el('button', 'nt-btn', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', closePop);
    const make = el('button', 'nt-btn primary', 'Create note'); make.type = 'button'; make.disabled = !f.title.trim();
    const go = () => { if (!f.title.trim()) { ttl.focus(); return; } needName(() => createNote(d, f), 'Before you write a note, it needs to know who you are.'); };
    ttl.addEventListener('input', () => { f.title = ttl.value; make.disabled = !f.title.trim(); });
    ttl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(); } else if (e.key === 'Escape') { e.preventDefault(); closePop(); } });
    desc.addEventListener('input', () => { f.desc = desc.value; grow(); });
    desc.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } else if (e.key === 'Escape') { e.preventDefault(); closePop(); } });
    make.addEventListener('click', go); foot.append(cam, el('span', 'nt-grow'), cancel, make); pop.append(foot);
    setTimeout(() => { grow(); if (!S.editing) ttl.focus({ preventScroll: true }); }, 20);
  }
  function createNote(d, f) {
    const by = author(); let note = null;
    change('Add note', () => {
      note = C.create(S.items, { by, title: f.title, text: f.desc, kind: d.kind, part: d.part, also: d.also, local: d.local, world: d.world, normal: d.normal, cam: d.cam, tag: f.tag, shots: d.shots || [], shotCams: d.shotCams || [] });
      if (f.assignee) C.assign(note, by, f.assignee); if (f.priority && f.priority !== 'normal') C.setPriority(note, by, f.priority); if (f.due) C.setDue(note, by, f.due);
      if (note.shots.length) keepShots(note);
    });
    const at = S.pop ? { l: S.pop.style.left, t: S.pop.style.top } : null; S.draft = null; S.expanded = true; S.editProps = false; S.openId = note.id; buildPop(); if (at && S.pop) { S.pop.style.left = at.l; S.pop.style.top = at.t; S.pop._lx = at.l; S.pop._ly = at.t; clampPop(); } S.host.toast('Note ' + note.n + ' made', 'Everyone who opens this scene will see it. Comments go under it.', 'success', 2600);
  }
  function buildThread(pop, n) {
    const need = 'Before you change a note, it needs to know who you are.'; const part = partOf(n);
    const num = numBadge(n.tag, String(n.n), n.status === 'resolved');
    const isDone = n.status === 'resolved';
    const done = iconBtn('check', isDone ? 'Done: open it again' : 'Mark as done', 'nt-done' + (isDone ? ' on' : '') + (isDone && S.justDone === n.id ? ' pop' : '')); if (S.justDone === n.id) S.justDone = null;
    done.addEventListener('click', () => needName(() => {
      const apply = () => { S.justDone = isDone ? null : n.id; change(isDone ? 'Reopen note' : 'Resolve note', () => C.setStatus(n, author(), isDone ? 'open' : 'resolved')); buildPop(); };
      if (isDone) { done.classList.add('unmark'); setTimeout(apply, 160); } else apply();
    }, need));
    const more = iconBtn(S.editProps ? 'pencil' : 'more', S.editProps ? 'Done editing' : 'More', S.editProps ? 'nt-edit on' : '');
    more.addEventListener('click', (e) => { e.stopPropagation(); if (S.editProps) { S.editProps = false; buildPop(); } else moreMenu(more, n); });      // (while editing, the dots are the pencil: press it to leave)
    const sub = { name: C.where(n), meta: C.tagLabel(n.tag) + ' · ' + (n.status === 'resolved' ? 'Done' : 'Open') + (n.assignee ? ' · For ' + n.assignee : '') + (n.priority && n.priority !== 'normal' ? ' · ' + n.priority[0].toUpperCase() + n.priority.slice(1) : '') + (n.due ? ' · ' + C.dueLabel(n) : '') + (n.part && !part ? ' · part gone' : '') + (part && !part.visible ? ' · part hidden' : '') };
    const vis = visibleList(n.id), at = vis.findIndex(x => x.id === n.id);
    const prev = iconBtn('left', 'Previous note'), next = iconBtn('right', 'Next note'); prev.disabled = next.disabled = vis.length < 2 || at < 0;
    prev.addEventListener('click', () => step(-1)); next.addEventListener('click', () => step(1));
    pop.append(...popHead(null, C.noteTitle(n), null, {}));
    if (S.editProps) {
      const tEl = pop.querySelector('.nt-htitle'), inp = el('input', 'nt-rename'); inp.value = C.noteTitle(n); inp.maxLength = C.LIMITS.title; inp.setAttribute('aria-label', 'The name of the note');
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } else if (e.key === 'Escape') { e.preventDefault(); inp.value = C.noteTitle(n); inp.blur(); } });
      inp.addEventListener('change', () => { const v = inp.value.trim(); if (!v) { inp.value = C.noteTitle(n); return; } needName(() => { change('Rename note', () => C.setTitle(n, author(), v)); }, need); });
      if (tEl) tEl.replaceWith(inp);
    }
    const live = n.messages.filter(m => !m.deleted), dm = live.find(m => m.desc), cs = live.filter(m => !m.desc);
    if (!S.expanded) {      // the short form: the description, and how many comments there are
      const brief = el('div', 'nt-brief');
      if (dm) { const bd = el('div', 'nt-body'); bd.append(richText(dm.text, 'clamp'), el('div', 'nt-descby', 'Written by ' + dm.by + ' \u00b7 ' + C.ago(dm.at))); brief.append(bd); }
      else brief.append(el('div', 'nt-nodesc', 'No description'));
      pop.append(brief);
      pop.append(...partsSection(n, sub.meta));
      const info = el('button', 'nt-moreinfo'); info.type = 'button'; info.textContent = (cs.length ? cs.length + (cs.length === 1 ? ' comment' : ' comments') : 'No comments yet') + ' · Show the details'; info.title = 'Show the details and the comments';
      info.addEventListener('click', () => { S.expanded = true; buildPop(); }); pop.append(info);
      return;
    }
    // what it is about
    const gallery = (editable) => {
      if (!n.shots || !n.shots.length) return null; const g = el('div', 'nt-shots');
      n.shots.forEach((u, i) => {
        const w = el('div', 'nt-shotitem'), im = el('img', 'nt-thumb'); im.src = u; im.alt = 'Screenshot ' + (i + 1); im.title = 'Go back to this view'; im.addEventListener('click', () => flyTo(n, true, n.shotCams && n.shotCams[i])); w.append(im);
        if (editable) { const x = iconBtn('x', 'Take this screenshot off', 'nt-shotx'); x.addEventListener('click', (e) => { e.stopPropagation(); needName(() => { C.removeShot(n, author(), i); keepShots(n); buildPop(); }, need); }); w.append(x); }
        g.append(w);
      }); return g;
    };
    if (S.editProps && !n.deleted) {
      const blk = el('div', 'nt-descblock'), ta = el('textarea', 'nt-descin'); ta.placeholder = 'What is this about?'; ta.rows = 2; ta.maxLength = C.LIMITS.text; ta.value = dm ? dm.text : ''; ta.setAttribute('aria-label', 'Description');
      const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(Math.max(ta.scrollHeight, 44), 200) + 'px'; };
      ta.addEventListener('input', grow); ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); ta.value = dm ? dm.text : ''; ta.blur(); } });
      ta.addEventListener('change', () => needName(() => { change('Describe note', () => C.setDesc(n, author(), ta.value)); }, need));
      const cam = iconBtn('camera', (n.shots || []).length >= C.LIMITS.shots ? 'Up to ' + C.LIMITS.shots + ' screenshots' : 'Add a screenshot of the view', 'nt-shot' + ((n.shots || []).length ? ' on' : '')); cam.disabled = (n.shots || []).length >= C.LIMITS.shots;
      cam.addEventListener('click', () => needName(async () => {
        cam.disabled = true; const w = n.kind === 'scene' ? null : worldOf(n, new (V().Vector3)()); const v = await captureView(w ? w.toArray() : null); cam.disabled = false;
        if (v.thumb) { C.addShot(n, author(), v.thumb, v.cam); keepShots(n); } else S.host.toast('Notes', 'The picture could not be taken', 'warn', 2400); buildPop();
      }, need));
      const top = el('div', 'nt-desctop'); top.append(el('span', 'nt-desclabel', 'Description'), el('span', 'nt-grow'), cam); blk.append(top, ta); const g0 = gallery(true); if (g0) blk.append(g0); pop.append(blk); setTimeout(grow, 0);
    }
    else if (dm) { const blk = el('div', 'nt-descblock'); blk.append(descEl(n, dm)); const g1 = gallery(false); if (g1) blk.append(g1); pop.append(blk); }
    else if (!n.deleted) { const w = el('div', 'nt-descblock'); w.append(el('div', 'nt-nodesc', 'No description')); const g2 = gallery(false); if (g2) w.append(g2); pop.append(w); }
        pop.append(...partsSection(n, sub.meta));
    pop.append(toolBar({ left: [prev, next], right: [done, more] }));
    if (S.editProps) pop.append(propsBlock(n, (k, v) => needName(() => {
      if (k === 'tag') change('Tag note', () => C.setTag(n, author(), v)); else if (k === 'assignee') change('Assign note', () => C.assign(n, author(), v));
      else if (k === 'priority') change('Priority', () => C.setPriority(n, author(), v)); else if (k === 'due') change('Due date', () => C.setDue(n, author(), v));
      buildPop();
    }, need)));
    // the comments
    const panel = el('div', 'nt-cpanel'); pop.append(panel);
    panel.append(el('div', 'nt-seclabel nt-clabel', cs.length ? 'Comments · ' + cs.length : 'Comments'));
    const list = el('div', 'nt-msgs' + (n.messages.some(m => !m.desc) ? '' : ' empty'));
    for (const m of n.messages) if (!m.desc) list.append(messageEl(n, m));
    if (!cs.length && !n.messages.some(m => !m.desc)) list.append(el('div', 'nt-empty', 'No comments yet'));
    panel.append(list);
    if (S.showHist) { const ul = el('ul', 'nt-hist'); for (const a of n.activity.slice().reverse()) { const li = el('li'); li.textContent = C.stamp(a.at) + '  ' + C.activityLine(a); ul.append(li); } panel.append(ul); }
    const target = S.replyTo && C.msgOf(n, S.replyTo); if (S.replyTo && !target) S.replyTo = null;
    const c = composer(target ? 'Reply to ' + target.by + '…' : n.deleted ? 'This note is deleted' : 'Add a comment…', 'Comment', (t) => { const to = S.replyTo; S.replyTo = null; change('Comment', () => C.reply(n, author(), t, undefined, to)); stickBottom = true; buildPop(); });
    if (target) {
      const chip = el('div', 'nt-replying'); chip.append(svgEl('reply'), el('span', null, target.by + ': ' + target.text.replace(/\s+/g, ' ').slice(0, 60)));
      const x = iconBtn('x', 'Cancel the reply'); x.addEventListener('click', () => { S.replyTo = null; buildPop(); }); chip.append(x); c.box.insertBefore(chip, c.ta);
    }
    if (n.deleted) { c.ta.disabled = true; const rb = el('button', 'nt-btn', 'Bring the note back'); rb.type = 'button'; rb.addEventListener('click', () => needName(() => { change('Restore note', () => C.restoreNote(n, author())); buildPop(); })); panel.append(rb); }
    else panel.append(c.box);
    if (S.editProps) panel.remove();
  }
  // the description of a task: what it is about, written when the note was made. It is not a comment (no avatar, no replies or reactions); a line says who wrote it
  function descEl(n, m) {
    if (S.editing === m.id) return messageEl(n, m);                  // being edited it uses the same box as a message
    const blk = el('div', 'nt-desc'), top = el('div', 'nt-desctop');
    top.append(el('span', 'nt-desclabel', 'Description')); blk.append(top, richText(m.text));
    blk.append(el('div', 'nt-descby', m.edits.length ? 'Edited by ' + [...new Set(m.edits.map(e => e.by))].join(', ') + ' \u00b7 ' + C.ago(m.updatedAt) : 'Written by ' + m.by + ' \u00b7 ' + C.ago(m.at)));
    return blk;
  }
  function messageEl(n, m) {
    const row = el('div', 'nt-msg'); row.dataset.mid = m.id; row.append(avatar(m.by));
    const body = el('div', 'nt-body'); const top = el('div', 'nt-top'); top.append(el('b', null, m.by)); const t = el('span', 'nt-time', C.ago(m.at)); t.title = C.stamp(m.at); top.append(t);
    if (m.deleted) {
      body.append(top, el('div', 'nt-gone', 'Deleted by ' + m.deleted.by + ' · ' + C.stamp(m.deleted.at)));
      const rb = el('button', 'nt-link', 'Bring it back'); rb.type = 'button'; rb.addEventListener('click', () => needName(() => { change('Restore message', () => C.restoreMessage(n, m.id, author())); buildPop(); })); body.append(rb); row.append(body); return row;
    }
    const act = el('span', 'nt-acts'); const ed = iconBtn('pencil', 'Edit'), rm = iconBtn('trash', 'Delete this message'); act.append(ed, rm); top.append(el('span', 'nt-grow'), act); body.append(top);
    if (S.editing === m.id) {
      const cancel = iconBtn('x', 'Cancel'); cancel.addEventListener('click', () => { S.editing = null; buildPop(); });
      const c = composer('Edit…', 'Save', (v) => { change('Edit message', () => C.edit(n, m.id, author(), v)); S.editing = null; buildPop(); }, { value: m.text, onEsc: () => { S.editing = null; buildPop(); }, extra: [cancel] });
      body.append(c.box); row.append(body); setTimeout(() => { c.ta.focus(); c.ta.setSelectionRange(c.ta.value.length, c.ta.value.length); }, 20); return row;
    }
    if (m.to) {
      const q = C.msgOf(n, m.to);
      if (q) { const qe = el('button', 'nt-quote'); qe.type = 'button'; qe.append(el('b', null, q.by), document.createTextNode(' ' + (q.deleted ? 'Deleted message' : q.text.replace(/\s+/g, ' ').slice(0, 90)))); qe.title = 'Show that message';
        qe.addEventListener('click', () => { const t2 = S.pop && S.pop.querySelector('[data-mid="' + q.id + '"]'); if (t2) { t2.scrollIntoView({ block: 'nearest' }); t2.classList.remove('flash'); void t2.offsetWidth; t2.classList.add('flash'); } }); body.append(qe); }
    }
    body.append(richText(m.text));
    const bar = el('div', 'nt-react'); const me = author(); const rr = m.react || {};
    const rbtn = (kind, icon, tip) => {
      const list = rr[kind] || []; const b = el('button', 'nt-rb' + (me && list.includes(me) ? ' on ' + kind : '') + (list.length ? ' has' : '')); b.type = 'button'; b.innerHTML = svg(icon) + (list.length ? '<span>' + list.length + '</span>' : '');
      b.title = list.length ? tip + ': ' + list.join(', ') : tip; b.setAttribute('aria-label', tip);
      b.addEventListener('click', () => needName(() => { change('React', () => C.react(n, m.id, author(), kind)); buildPop(); }, 'Before you react, notes need to know who you are.')); return b;
    };
    const rp = el('button', 'nt-rb' + (S.replyTo === m.id ? ' on' : '')); rp.type = 'button'; rp.innerHTML = svg('reply'); rp.title = 'Reply to this message'; rp.setAttribute('aria-label', 'Reply');
    rp.addEventListener('click', () => { S.replyTo = S.replyTo === m.id ? null : m.id; buildPop(); });
    bar.append(rbtn('like', 'thumbup', 'Like'), rbtn('dislike', 'thumbdown', 'Dislike'), rp); body.append(bar);
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
    add('Edit', () => { S.editProps = true; S.expanded = true; buildPop(); });
    if (n.kind !== 'scene') add('Select its parts' + ((n.also || []).length ? ' (' + (1 + n.also.length) + ')' : ''), () => selectNoteParts(n));
    add('Add the selected parts to this note', () => needName(() => attachSelected(n), 'Before you change a note, it needs to know who you are.'));
    { const vis = visibleList(n.id); if (vis.length > 1) { add('Next note', () => step(1)); add('Previous note', () => step(-1)); } }
    { const part = partOf(n); if (part && !part.visible) add('Show the hidden part', () => { S.host.showPart(part); layout(); buildPop(); }); }
    if (n.kind !== 'scene') add('Move the pin…', () => startPlace({ moveId: n.id }));
    add('Save the view now with this note', () => needName(() => { change('Update view', () => C.moveAnchor(n, author(), { cam: camNow() })); buildPop(); }));
    add('Add a screenshot of the view', () => needName(() => { const w = n.kind === 'scene' ? null : worldOf(n, new (V().Vector3)()); captureView(w ? w.toArray() : null).then(v => { if (v.thumb) { C.addShot(n, author(), v.thumb, v.cam); keepShots(n); } else S.host.toast('Notes', 'The picture could not be taken', 'warn', 2400); buildPop(); }); }));
    if ((n.shots || []).length) add('Take the screenshots off', () => needName(() => { while ((n.shots || []).length) C.removeShot(n, author(), 0); delete S.thumbs[n.id]; buildPop(); }));
    add(S.showHist ? 'Hide the history' : 'History · ' + n.activity.length, () => { S.showHist = !S.showHist; buildPop(); });
    add('Copy as text', () => { copy(C.toText([n], { title: 'Note ' + n.n })); });
    add(n.deleted ? 'Bring the note back' : 'Delete the note', () => needName(() => { change(n.deleted ? 'Restore note' : 'Delete note', () => (n.deleted ? C.restoreNote(n, author()) : C.removeNote(n, author()))); if (n.deleted && S.filter !== 'deleted') { closePop(); } else buildPop(); }), !n.deleted);
    S.pop.append(menu); const b = anchor.getBoundingClientRect(), p = S.pop.getBoundingClientRect(); menu.style.top = (b.bottom - p.top + 4) + 'px'; menu.style.right = (p.right - b.right) + 'px';
    setTimeout(() => document.addEventListener('click', function off() { menu.remove(); document.removeEventListener('click', off); }, { once: false }), 0);
  }
  function copy(t) { try { navigator.clipboard.writeText(t).then(() => S.host.toast('Copied', '', 'success', 1500)); } catch (_) { S.host.toast('Copy failed', 'The browser did not allow it', 'warn', 2500); } }

  // ── flying the camera to a note ──────────────────────────────────────────────────────────────────────────────────────
  let flight = 0;
  function flyTo(n, force, camOver) {
    const h = S.host, cam = h.cam(), ctl = h.ctl(); if (!cam || !ctl) return;
    let to = camOver || n.cam;
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
    const d = { kind: 'pin', part: hit.part, also: alsoFor(hit.part), local: hit.local, world: hit.world, normal: hit.localNormal, cam: camNow(), thumb: '', screen: toViewport(ev) };
    S.draft = d; S.openId = null; buildPop(); render();
    void by;
  }
  function buildPopKeepText() { const ta = S.pop && $('textarea', S.pop); const t = ta ? ta.value : ''; buildPop(); const ta2 = S.pop && $('textarea', S.pop); if (ta2 && t) { ta2.value = t; ta2.dispatchEvent(new Event('input')); } }
  function toViewport(ev) { const vr = S.host.viewport().getBoundingClientRect(); return { x: ev.clientX - vr.left, y: ev.clientY - vr.top }; }
  const selectedParts = () => [...S.host.state.selected].map(id => S.host.getPart(id)).filter(p => p && !p.deleted);
  const sameRef = (p, ref) => { if (!ref) return false; const r0 = S.host.partRef(p); return !!((ref.uid && r0.uid === ref.uid) || (ref.name && r0.name === ref.name)); };
  // a note made on one of several selected parts is about all of them
  function alsoFor(primary) { const sel = selectedParts(); if (sel.length < 2 || !primary || !sel.some(p => sameRef(p, primary))) return []; return sel.filter(p => !sameRef(p, primary)).map(p => S.host.partRef(p)); }
  // a note about the selected part (its centre) or about the whole scene
  function addForSelection() {
    needName(() => {
      const sel = selectedParts();
      if (!sel.length) { S.host.toast('Notes', 'Select a part first, or use “Scene note”', 'info', 2400); return; }
      let primary = null, hit = null; for (const p of sel) { hit = S.host.partAnchor(p); if (hit) { primary = p; break; } }
      if (!hit) { primary = sel[0]; hit = { part: S.host.partRef(primary), local: null, world: null }; }      // (no mesh of its own: the note is about it, without a pin)
      const also = sel.filter(p => p !== primary).map(p => S.host.partRef(p));
      S.draft = { kind: 'part', part: hit.part, also, local: hit.local, world: hit.world, normal: null, cam: camNow(), thumb: '' }; S.openId = null; buildPop(); render();
    }, 'Before you write a note, it needs to know who you are.');
  }
  // a note at the spot of a right click: the same as placing one, with the click already made
  function addAt(pt) {
    if (!S.host.state.parts.some(p => !p.deleted)) { S.host.toast('Notes', 'Open a model first', 'info', 2200); return; }
    needName(() => {
      const hit = S.host.rayHit(pt); if (!hit) { S.host.toast('Notes', 'Nothing there: right-click on the model', 'info', 1800); return; }
      const d = { kind: 'pin', part: hit.part, also: alsoFor(hit.part), local: hit.local, world: hit.world, normal: hit.localNormal, cam: camNow(), thumb: '', screen: toViewport(pt) };
      closePop(); S.draft = d; S.openId = null; buildPop(); render();
    }, 'Before you write a note, it needs to know who you are.');
  }
  // a note about the whole part under a right click (placed at the part's centre, not at the click)
  function addToPartAt(pt) {
    if (!S.host.state.parts.some(p => !p.deleted)) { S.host.toast('Notes', 'Open a model first', 'info', 2200); return; }
    needName(() => {
      const hit = S.host.rayHit(pt); if (!hit || !hit.part) { S.host.toast('Notes', 'Nothing there: right-click on a part', 'info', 1800); return; }
      S.parts.delete('__pt'); const p = partOf({ id: '__pt', part: hit.part }); S.parts.delete('__pt');
      const a = p && S.host.partAnchor(p); if (!a) { S.host.toast('Notes', 'That part cannot hold a note', 'info', 1800); return; }
      closePop(); S.draft = { kind: 'part', part: a.part, also: alsoFor(a.part), local: a.local, world: a.world, normal: null, cam: camNow(), thumb: '' }; S.openId = null; buildPop(); render();
    }, 'Before you write a note, it needs to know who you are.');
  }
  function addForScene() {
    needName(() => { S.draft = { kind: 'scene', part: null, local: null, world: null, normal: null, cam: camNow(), thumb: '' }; S.openId = null; buildPop(); render(); }, 'Before you write a note, it needs to know who you are.');
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
    if (f === 'mine' && !(author() && (n.assignee === author() || n.created.by === author() || n.messages.some(m => m.by === author() || C.mentions(m.text, [author()]).length)))) return false;
    if (S.onlySel) {
      const sel = [...S.host.state.selected].map(id => S.host.getPart(id)).filter(Boolean);
      if (!n.part || ![n.part].concat(n.also || []).some(ref => sel.some(p => (ref.uid && p.uid === ref.uid) || (ref.name && p.name === ref.name)))) return false;
    }
    if (S.search) {
      const q = S.search.toLowerCase();
      const hay = (C.where(n) + ' ' + n.assignee + ' ' + C.tagLabel(n.tag) + ' ' + n.n + ' ' + n.messages.map(m => m.by + ' ' + m.text).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }
  function visibleList(keepId) {
    const list = S.items.filter(n => passes(n, false) || (keepId && n.id === keepId && !n.deleted));
    if (S.sort === 'newest') list.sort((a, b) => (C.lastChange(a) < C.lastChange(b) ? 1 : -1));
    else if (S.sort === 'due') list.sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : a.n - b.n);
    else if (S.sort === 'priority') { const w = { urgent: 2, high: 1, normal: 0 }; list.sort((a, b) => (w[b.priority] || 0) - (w[a.priority] || 0) || a.n - b.n); }
    else if (S.sort === 'part') list.sort((a, b) => C.where(a).localeCompare(C.where(b)) || a.n - b.n);
    else list.sort((a, b) => a.n - b.n);
    return list;
  }
  // show only the parts that carry a note (the ones the list shows), then everything again
  function isolateNoted() {
    if (S.isoNoted && S.host.isolated()) { S.host.showAll(); S.isoNoted = false; render(); return; }
    const seen = new Set(), ps = [];
    for (const n of S.items) { if (n.deleted || n.kind === 'scene' || !passes(n, false)) continue; for (const p of partsOf(n)) if (!p.deleted && !seen.has(p)) { seen.add(p); ps.push(p); } }
    if (!ps.length) { S.host.toast('Notes', 'No part has a note in this list', 'info', 2200); return; }
    S.isoNoted = S.host.isolate(ps); render();
    if (S.isoNoted) S.host.toast('Only the parts with notes', ps.length + (ps.length === 1 ? ' part' : ' parts') + ' shown. Press the button again to show everything.', 'info', 3200);
  }
  function step(d) { const l = visibleList(S.openId); if (!l.length) return; let i = l.findIndex(n => n.id === S.openId); i = i < 0 ? (d > 0 ? 0 : l.length - 1) : (i + d + l.length) % l.length; openNote(l[i].id, { keep: true }); }
  function render() {
    const card = S.card; if (!card) return; S._pmap = null;
    const st = C.stats(S.items), me = author();
    const badge = $('#notes-count', card.section); if (badge) { badge.hidden = st.total === 0; badge.textContent = String(st.open); badge.title = st.open + ' open of ' + st.total; }
    $('.nt-me', card.body).textContent = me ? me : 'Set your name'; card.setSeg(); card.setPins(); card.setReview(); card.isoBtn.classList.toggle('on', !!S.isoNoted && !!S.host.isolated());
    const list = visibleList();
    { const vis = S.openId && !list.some(x => x.id === S.openId) ? visibleList(S.openId) : list, at = vis.findIndex(x => x.id === S.openId); card.navLabel.textContent = vis.length ? (at >= 0 ? (at + 1) + ' of ' + vis.length : vis.length + (vis.length === 1 ? ' note' : ' notes')) : 'No notes'; card.navPrev.disabled = card.navNext.disabled = vis.length < 1; }
    card.mine.textContent = ''; if (me) card.mine.append(avatar(me)); else card.mine.append(avatarSlot());
    card.pins.innerHTML = svg(S.pins ? 'eye' : 'eyeoff'); card.pins.title = S.pins ? 'Hide the pins' : 'Show the pins'; card.pins.setAttribute('aria-label', card.pins.title); card.addPin.classList.toggle('on', !!S.placing);
    card.list.textContent = '';
    const unread = S.items.filter(n => C.unread(n, me, S.since)).length;
    card.markRead.hidden = !unread; card.markRead.textContent = 'Mark ' + unread + ' read';
    if (!list.length) {
      const e = el('div', 'nt-empty', S.items.length ? 'No notes match.' : 'No notes yet. Press N, then click a spot on the model.'); card.list.append(e);
    }
    const cap = S.rowLimit || 150; for (const n of list.slice(0, cap)) card.list.append(rowEl(n, me));
    if (list.length > cap) { const more = el('button', 'nt-more', 'Show ' + Math.min(150, list.length - cap) + ' more of ' + (list.length - cap)); more.type = 'button'; more.addEventListener('click', () => { S.rowLimit = cap + 150; render(); }); card.list.append(more); }
    for (const [id, b] of pinEls) { const n = C.find(S.items, id); if (n) decoratePin(n, b); }
    for (const n of S.items) if (!pinEls.has(n.id) && n.kind !== 'scene' && !n.deleted && S.layer) makePin(n);
    card.foot.hidden = S.items.length === 0 && !S.host;
    layout();
  }
  // a row of the list is a task: a tick, its title, and a line of what matters (kind and number, part, comments, due date, who it is for)
  function rowEl(n, me) {
    const done = n.status === 'resolved';
    const row = el('div', 'nt-row' + (done ? ' done' : '') + (S.openId === n.id ? ' sel' : '') + (n.deleted ? ' del' : '')); row.tabIndex = 0;
    const chk = el('button', 'nt-chk' + (done ? ' on' : '')); chk.type = 'button'; chk.title = done ? 'Done: open it again' : 'Mark as done'; chk.setAttribute('aria-label', chk.title); chk.innerHTML = svg('check');
    chk.addEventListener('click', (e) => { e.stopPropagation(); needName(() => change(done ? 'Reopen note' : 'Resolve note', () => C.setStatus(n, author(), done ? 'open' : 'resolved')), 'Before you change a note, it needs to know who you are.'); });
    const mid = el('div', 'nt-mid'); const line = el('div', 'nt-rtitle');
    const badge = numBadge(n.tag, String(n.n), done); badge.classList.add('mini'); if (C.unread(n, me, S.since)) badge.classList.add('new'); line.append(badge);
    if (n.priority && n.priority !== 'normal') { const p = el('i', 'nt-pri ' + n.priority); p.title = n.priority[0].toUpperCase() + n.priority.slice(1) + ' priority'; line.append(p); }
    line.append(el('span', 'nt-rt', C.noteTitle(n))); mid.append(line);
    const live = n.messages.filter(m => !m.deleted && !m.desc);
    const meta = el('div', 'nt-meta'); const bits = [C.where(n)];
    if (live.length) bits.push(live.length + (live.length === 1 ? ' comment' : ' comments'));
    meta.append(el('span', 'nt-mt', bits.join(' · ')));
    if (n.due) { const d = el('span', 'nt-chip' + (C.dueState(n) === 'overdue' ? ' late' : C.dueState(n) === 'today' ? ' soon' : '')); d.textContent = C.dueLabel(n).replace(/^Due /, ''); meta.append(d); }
    mid.append(meta);
    row.append(chk, mid);
    if (n.assignee) { const a = avatar(n.assignee); a.classList.add('nt-ra'); a.title = 'For ' + n.assignee; row.append(a); }
    row.addEventListener('click', () => openNote(n.id, { expand: true })); row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openNote(n.id, { expand: true }); });
    return row;
  }
  function buildCard() {
    const side = document.getElementById('sidebar-right'); if (!side || document.getElementById('notes-section')) return;
    const ref = [...side.querySelectorAll('.side-group')].find(g => /find/i.test(g.textContent)); if (!ref) return;
    const grp = el('div', 'side-group', 'Review');
    const sec = el('div', 'section'); sec.id = 'notes-section';
    sec.innerHTML = '<div class="section-h"><i class="sec-ico">' + svg('note') + '</i><span>Notes</span><span class="sec-count" id="notes-count" hidden></span><span class="chev">▾</span></div><div class="section-b" id="notes-body"></div>';
    const body = $('#notes-body', sec);
    // who is writing, and what the pins show
    const top = el('div', 'nt-top-row'); const me = el('button', 'nt-me', ''); me.type = 'button'; me.title = 'The name shown next to what you write';
    me.addEventListener('click', () => askName('Change the name shown next to what you write.').then(n => { if (n) setAuthor(n); }));
    const pins = iconBtn('eye', 'What the pins show'); pins.classList.add('nt-pinsbtn');
    pins.addEventListener('click', () => {
      const b = pins.getBoundingClientRect();
      S.host.ctxMenu([
        ...[['number', 'The number', 'circle'], ['text', 'The title, as a label', 'circle'], ['icon', 'The kind, as an icon', 'circle'], ['color', 'Only the shape and colour', 'circle'], ['name', 'The writer’s letter', 'circle']].map(([v, l, ic]) => ({ icon: ic, label: l + (S.badge === v ? '  ✓' : ''), fn: () => { S.badge = v; try { S.host.prefs.set('noteBadge', v); } catch (_) {} render(); } })),
        '---',
        { icon: S.pins ? 'eye-off' : 'eye', label: S.pins ? 'Hide the pins' : 'Show the pins', fn: () => { S.pins = !S.pins; render(); } },
      ], Math.max(8, Math.round(b.left - 190)), Math.round(b.bottom + 4));
    });
    const mine = el('span', 'nt-me-av'); me.before(mine); top.append(me, el('span', 'nt-grow'), pins); body.append(top);
    // make a note: on a spot, on the selected part(s), or about the whole scene
    const tool = (icon, tip, fn) => { const b = el('button', 'nt-tool'); b.type = 'button'; b.title = tip; b.setAttribute('aria-label', tip); b.innerHTML = svg(icon); b.addEventListener('click', fn); return b; };
    const acts = el('div', 'nt-tools');
    const addPin = el('button', 'nt-new'); addPin.type = 'button'; addPin.title = 'Click a spot on the model to make a note (N)'; addPin.setAttribute('aria-label', 'New note: click a spot on the model'); addPin.innerHTML = svg('plus') + '<span>New note</span>';
    addPin.addEventListener('click', () => (S.placing ? stopPlace() : startPlace()));
    acts.append(addPin, tool('box', 'A note about the selected part (or parts)', addForSelection), tool('layers', 'A note about the whole scene', addForScene)); body.append(acts);
    // which notes
    const seg = el('div', 'nt-seg'); seg.setAttribute('role', 'tablist');
    for (const [v, l] of [['open', 'Open'], ['all', 'All'], ['resolved', 'Done'], ['unread', 'New'], ['mine', 'Mine']]) { const b = el('button', null, l); b.type = 'button'; b.dataset.v = v; b.title = ({ open: 'Open notes', all: 'All notes', resolved: 'Done', unread: 'New to me', mine: 'Mine: for me, by me, or mentioning me' })[v]; b.addEventListener('click', () => { S.filter = v; S.rowLimit = 150; render(); }); seg.append(b); }
    body.append(seg);
    const sbar = el('div', 'nt-sbar'); const box = el('label', 'nt-searchbox'); box.innerHTML = svg('search');
    const q = el('input', 'nt-search'); q.type = 'search'; q.placeholder = 'Search'; q.addEventListener('input', () => { S.search = q.value.trim(); S.rowLimit = 150; render(); }); q.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { q.value = ''; S.search = ''; render(); } });
    box.append(q);
    const ssel = el('select', 'nt-sel'); ssel.title = 'Order'; for (const [v, l] of [['number', 'Number'], ['newest', 'Newest'], ['priority', 'Priority'], ['due', 'Due date'], ['part', 'Part']]) { const o = el('option', null, l); o.value = v; ssel.append(o); }
    ssel.addEventListener('change', () => { S.sort = ssel.value; S.rowLimit = 150; render(); }); ssel.addEventListener('keydown', (e) => e.stopPropagation());
    const selBtn = iconBtn('box', 'Only the notes on the selected part'); selBtn.addEventListener('click', () => { S.onlySel = !S.onlySel; S.selKey = S.onlySel ? [...S.host.state.selected].join(',') : ''; render(); });
    const del = iconBtn('trash', 'Show deleted notes'); del.addEventListener('click', () => { S.filter = S.filter === 'deleted' ? 'open' : 'deleted'; render(); });
    sbar.append(box, ssel, selBtn, del); body.append(sbar);
    // the list, and a stepper to jump through it
    const nav = el('div', 'nt-nav'); const navLabel = el('span', 'nt-navlabel', ''); const navPrev = iconBtn('left', 'Previous note'), navNext = iconBtn('right', 'Next note');
    navPrev.addEventListener('click', () => step(-1)); navNext.addEventListener('click', () => step(1));
    const isoBtn = iconBtn('focus', 'Show only the parts that have notes'); isoBtn.addEventListener('click', isolateNoted); nav.append(navLabel, isoBtn, navPrev, navNext); body.append(nav);
    const list = el('div', 'nt-list'); body.append(list);
    const markRead = el('button', 'nt-link', ''); markRead.type = 'button'; markRead.hidden = true; markRead.addEventListener('click', markAllRead); body.append(markRead);
    // sign-off on the scene
    const rev = el('div', 'nt-review'); const revSum = el('div', 'nt-sub nt-revsum');
    const rbtn2 = (state, icon, label, tip) => { const b = el('button', 'nt-rv'); b.type = 'button'; b.dataset.state = state; b.title = tip; b.innerHTML = svg(icon) + '<span>' + label + '</span>'; b.addEventListener('click', () => needName(() => { C.setReview(S.reviews, author(), state); render(); }, 'Before you sign off, notes need to know who you are.')); return b; };
    rev.append(rbtn2('approved', 'check', 'Approve', 'Approve this scene'), rbtn2('changes', 'undo', 'Changes', 'Ask for changes before it goes on'));
    body.append(el('div', 'nt-seclabel', 'Sign-off'), rev, revSum);
    // in and out
    const foot = el('div', 'nt-tools nt-foot');
    foot.append(tool('down', 'Bring in notes: from a scene file, a JSON file or a BCF file (what design tools use)', importFromFile), tool('up', 'Take the notes out: a report page, a spreadsheet, JSON or BCF', (e) => exportMenu(e.currentTarget)), tool('copy', 'Copy the notes as text', () => copy(C.toMarkdown(S.items, { title: title(), at: new Date().toISOString(), reviews: S.reviews })))); body.append(foot);
    const setSeg = () => { for (const b of seg.children) b.classList.toggle('on', b.dataset.v === S.filter); del.classList.toggle('on', S.filter === 'deleted'); selBtn.classList.toggle('on', S.onlySel); };
    const setReview = () => {
      const me2 = author(), mine2 = me2 && S.reviews[me2] ? S.reviews[me2].state : '', sm = C.reviewSummary(S.reviews);
      for (const b of rev.children) b.classList.toggle('on', b.dataset.state === mine2);
      revSum.textContent = sm.state === 'none' ? 'No sign-off yet' : [sm.approved.length ? 'Approved by ' + sm.approved.join(', ') : '', sm.changes.length ? 'Changes asked by ' + sm.changes.join(', ') : ''].filter(Boolean).join(' · ');
    };
    ref.parentNode.insertBefore(grp, ref); ref.parentNode.insertBefore(sec, ref);
    S.card = { section: sec, body, list, pins, addPin, markRead, foot, mine, setSeg, setPins: () => {}, setReview, isoBtn, navLabel, navPrev, navNext };
    const hd = sec.querySelector('.section-h'); hd.addEventListener('click', (e) => { e.stopImmediatePropagation(); hd.classList.toggle('collapsed'); }, true);      // (the app also wires every section header once; this one answers alone, so the two never toggle it twice)
  }
  function avatarSlot() { const s = el('span', 'nt-ic'); s.innerHTML = svg('user'); return s; }
  const title = () => 'Notes' + (S.host.state._loadedFilename ? ' · ' + S.host.state._loadedFilename : '');
  function markAllRead() { const a = author(); if (!a) return; S.seen[a] = new Date().toISOString(); updateSince(); render(); }

  // ── saving, opening, bringing in notes from another copy ────────────────────────────────────────────────────────────────────
  function serialize() {
    const a = author(); if (a) S.seen[a] = new Date().toISOString();
    return C.serialize(S.items.map(n => Object.assign({}, n, n.shots && n.shots.length ? {} : { shots: (S.thumbs[n.id] || {}).shots || [], shotCams: (S.thumbs[n.id] || {}).cams || [] })), S.seen, S.reviews);
  }
  const count = () => S.items.length;
  function load(raw, o) {
    o = o || {};
    const p = C.parse(raw); S.items = p.items; S.seen = p.seen; S.reviews = p.reviews || {}; S.parts.clear(); S.thumbs = {};
    for (const n of S.items) if (n.shots && n.shots.length) keepShots(n);
    for (const [id, b] of pinEls) { b.remove(); pinEls.delete(id); }
    closePop(); updateSince(); render();
    const st = C.stats(S.items);
    if (st.total && !o.quiet) {
      const me = author(), news = S.items.filter(n => C.unread(n, me, S.since));
      // who wrote last, and when: the newest message of any note
      let last = null; for (const n of S.items) { if (n.deleted) continue; for (const m of n.messages) if (!m.deleted && (!last || m.at > last.at)) last = m; }
      const bits = [];
      bits.push(st.open ? st.open + ' open' + (st.overdue ? ' (' + st.overdue + ' overdue)' : '') : 'all resolved');
      if (me) bits.push(news.length ? news.length + (news.length === 1 ? ' is new to you' : ' are new to you') : 'nothing new for you');
      else bits.push('type your name to see what is new');
      { const rv = C.reviewSummary(S.reviews); if (rv.approved.length) bits.push('approved by ' + rv.approved.join(', ')); if (rv.changes.length) bits.push('changes asked by ' + rv.changes.join(', ')); }
      if (last) bits.push('latest from ' + last.by + ', ' + C.ago(last.at));
      S.host.toast(st.total + (st.total === 1 ? ' note' : ' notes') + ' in this scene' + (news.length ? ' · ' + news.length + ' new' : ''), bits.join(' · '), news.length ? 'success' : 'info', news.length ? 7000 : 5200);
      const sec = S.card && S.card.section; if (sec) sec.querySelector('.section-h').classList.remove('collapsed');
    }
  }
  function reset() { S.items = []; S.seen = {}; S.reviews = {}; S.thumbs = {}; S.parts.clear(); S.filter = 'open'; S.search = ''; for (const [id, b] of pinEls) { b.remove(); pinEls.delete(id); } closePop(); stopPlace(); updateSince(); render(); }
  function importFromFile() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.glb,.json,.bcf,.bcfzip,.zip,model/gltf-binary,application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      try {
        let theirs = null; const ext = (f.name.split('.').pop() || '').toLowerCase(); const IO = window.MONotesIO;
        if (ext === 'json') { theirs = IO && IO.fromJson(await f.text()); if (!theirs) { S.host.toast('No notes found', f.name + ' is not a notes file', 'warn', 4500); return; } }
        else if (ext === 'bcf' || ext === 'bcfzip' || ext === 'zip') {
          const b = IO && await IO.fromBcf(await f.arrayBuffer(), S.items); if (!b || !b.items.length) { S.host.toast('No topics found', f.name + ' has no BCF topics in it', 'warn', 4500); return; }
          theirs = { items: b.items, seen: {}, reviews: {} };
        } else {
          const st = C.fromGlb(await f.arrayBuffer(), S.host.sceneKey);
          if (!st || !st.notes) { S.host.toast('No notes found', f.name + ' has no notes in it', 'warn', 4500); return; }
          theirs = C.parse(st.notes);
        }
        needName(() => {
          const r = C.merge(S.items, theirs.items); S.reviews = C.mergeReviews(S.reviews, theirs.reviews);
          change('Bring in notes', () => { S.items = r.items; for (const n of S.items) if (n.shots && n.shots.length) keepShots(n); });
          for (const k of Object.keys(theirs.seen)) if (!S.seen[k] || theirs.seen[k] > S.seen[k]) S.seen[k] = theirs.seen[k];
          updateSince(); render();
          S.host.toast('Notes brought in', r.added + ' new · ' + r.changed + ' changed, from ' + f.name, 'success', 5000);
        }, 'Before notes are brought in, they need to know who you are.');
      } catch (e) { console.warn('[notes] import failed:', e); S.host.toast('Could not read the file', String(e && e.message || e), 'error', 5000); }
    });
    inp.click();
  }
  function exportMenu(anchor) {
    if (!C.stats(S.items).total) { S.host.toast('Notes', 'There are no notes yet', 'info', 2200); return; }
    const b = anchor.getBoundingClientRect(), base = (S.host.state._loadedFilename || 'scene').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-'), at = new Date().toISOString(), IO = window.MONotesIO;
    const done = (what) => S.host.toast('Notes saved', what, 'success', 3600);
    S.host.ctxMenu([
      { icon: 'file-text', label: 'A report page (.html)', fn: saveReport },
      { icon: 'table', label: 'A spreadsheet (.csv)', fn: () => { download(base + '-notes.csv', 'text/csv;charset=utf-8', IO.toCsv(S.items)); done('One row per note, ready for Excel.'); } },
      { icon: 'braces', label: 'Everything (.json)', fn: () => { download(base + '-notes.json', 'application/json', IO.toJson(S.items, S.reviews, { title: title(), at, seen: S.seen })); done('All details. "Bring in notes" reads it back.'); } },
      { icon: 'share', label: 'For design tools (.bcf)', fn: () => { download(base + '-notes.bcf', 'application/octet-stream', IO.toBcf(S.items, { title: title() })); done('BCF 2.1: one topic per note, with its view and picture.'); } },
    ], Math.round(b.left), Math.round(b.top - 150));
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
#note-pins{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:calc(var(--z-console) + 1)}
.note-pin{position:absolute;left:0;top:0;width:var(--btn-h-sm);height:var(--btn-h-sm);border:0;background:none;padding:0;color:var(--white);font:var(--fw-semibold) var(--fs-11)/1 var(--font-sans,system-ui);font-variant-numeric:tabular-nums;display:grid;place-items:center;pointer-events:auto;cursor:pointer;filter:drop-shadow(0 1px 2px var(--blk-40)) drop-shadow(0 3px 7px var(--blk-30));transition:opacity var(--dur-base) var(--ease-out),scale var(--dur-200) var(--ease-ios)}
.shape{position:absolute;inset:0;width:100%;height:100%;fill:var(--c,var(--ac));stroke:var(--white);stroke-width:1.8;overflow:visible;transition:fill var(--dur-base) var(--ease-out),stroke var(--dur-base) var(--ease-out)}
.note-pin>b{position:relative;font-weight:inherit;pointer-events:none}.note-pin[data-shape=triangle]>b{margin-top:5px}
.note-pin::before{content:'';position:absolute;inset:-6px;border-radius:50%}
.note-pin.in{animation:note-pin-in var(--dur-300) var(--ease-ios)}.note-pin:hover{scale:1.1;z-index:2}.note-pin:active{scale:.95}
.note-pin[data-pri=high] .shape{stroke:var(--pin);stroke-width:2.4}.note-pin[data-pri=urgent] .shape{stroke:var(--er);stroke-width:2.6}.note-pin.b-name[data-pri=high] .shape,.note-pin.b-name[data-pri=urgent] .shape{stroke-width:2.6}
.note-pin.late .shape{stroke:var(--er);stroke-width:2.6;stroke-dasharray:4 2.2}
.note-pin.sel{z-index:2}.note-pin.sel .shape,.note-pin.sel[data-pri] .shape,.note-pin.sel.late .shape{stroke:var(--ac);stroke-width:2.6;stroke-dasharray:none}
.note-pin.b-icon>b svg{width:var(--icon-xs);height:var(--icon-xs)}.note-pin.b-color{width:16px;height:16px}
.note-pin.b-name .shape{fill:var(--bg-name,var(--c));stroke:var(--c)}
.note-pin.b-text{display:inline-flex;align-items:center;gap:var(--space-sm);width:auto;max-width:210px;height:var(--btn-h-sm);padding:0 var(--space-lg) 0 var(--space-md);border-radius:var(--r-pill);background:var(--surface-pop);color:var(--tx);font-weight:var(--fw-medium);white-space:nowrap;filter:none;box-shadow:0 0 0 1px var(--s6),var(--surface-shadow)}
.note-pin.b-text i{position:relative;flex:none;width:var(--icon-xs);height:var(--icon-xs)}.note-pin.b-text i .shape{stroke:none}.note-pin.b-text span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.note-pin.b-text.sel{box-shadow:0 0 0 1.5px var(--ac),var(--surface-shadow)}.note-pin.b-text.sel i .shape{stroke:none}
.note-pin.back{opacity:.4}.note-pin.hid{opacity:.25}.note-pin.gone{opacity:.5}.note-pin.gone .shape{fill:var(--tx3)}
.note-pin.done .shape,.note-pin.b-name.done .shape,.note-pin.b-text.done i .shape{fill:var(--ok);stroke:none}.note-pin.sel.done .shape{stroke:var(--ac);stroke-width:2.6}
.note-pin.new::after{content:'';position:absolute;right:-3px;top:-3px;width:9px;height:9px;border-radius:50%;background:var(--er);box-shadow:0 0 0 2px var(--surface-pop)}
@keyframes note-pin-in{from{scale:.4;opacity:0}}
@media (prefers-reduced-motion:reduce){.note-pin,.note-pin.in{animation:none;transition:opacity var(--dur-base)}}

.note-pop{position:absolute;z-index:calc(var(--z-console) + 2);width:340px;max-height:min(760px,calc(100% - 16px));display:flex;flex-direction:column;background:var(--surface-pop);border:0;border-radius:var(--surface-win-r);box-shadow:var(--surface-shadow-win);color:var(--tx);font:var(--fs-sm)/var(--lh-base) var(--font-sans,system-ui);animation:var(--menu-in)}
.nt-rz{position:absolute;z-index:3;touch-action:none}.nt-rz-e,.nt-rz-w{top:44px;bottom:22px;width:8px;cursor:ew-resize}.nt-rz-e{right:-4px}.nt-rz-w{left:-4px}.nt-rz-s{left:22px;right:22px;bottom:-4px;height:8px;cursor:ns-resize}.nt-rz-se,.nt-rz-sw{bottom:-4px;width:16px;height:16px}.nt-rz-se{right:-4px;cursor:nwse-resize}.nt-rz-sw{left:-4px;cursor:nesw-resize}
.note-pop:not(.win-focus){box-shadow:var(--surface-shadow-win-off)}
.note-pop>*{flex:none}.note-pop>.nt-rz{flex:none}.note-pop>.nt-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;overscroll-behavior:contain;border-radius:0 0 var(--surface-win-r) var(--surface-win-r)}.note-pop>.nt-scroll::-webkit-scrollbar{display:none;width:0;height:0}.note-pop.dragging{user-select:none}
.nt-titlebar{display:flex;align-items:center;gap:var(--space-xl);padding:var(--space-lg) var(--space-xl) var(--space-lg) var(--space-2xl);cursor:grab;user-select:none;touch-action:none}.note-pop.dragging .nt-titlebar{cursor:grabbing}
.nt-tico{width:22px;height:22px;display:grid;place-items:center;flex:none;border-radius:var(--r-sm);background:var(--ac-tint-12);color:var(--ac-text);box-shadow:inset 0 0 0 1px var(--ac-tint-20)}.nt-tico svg{width:var(--icon-xs);height:var(--icon-xs)}
.nt-ttitle{font-size:var(--fs-11);font-weight:var(--fw-semibold);letter-spacing:var(--tracking-wide);text-transform:uppercase;color:var(--tx3);white-space:nowrap}
.nt-titlebar .nt-ib{width:var(--btn-h-sm);height:var(--btn-h-sm);border-radius:50%;color:var(--tx3)}.nt-titlebar .nt-ib:hover{color:var(--tx);background:var(--s4)}.nt-titlebar .nt-ib:active{transform:scale(.92)}
.nt-bar{display:flex;align-items:center;gap:var(--space-2xs);padding:var(--space-sm) 5px 0 4px}      /* (the arrows and dots are drawn inside their boxes: this puts what you see on the same edges as the text) */
.nt-head{display:flex;align-items:center;gap:var(--space-xl);padding:var(--space-md) var(--space-2xl) var(--space-xs)}.nt-ctx{display:flex;align-items:center;gap:var(--space-lg);margin:0 var(--space-lg) var(--space-lg);padding:var(--space-lg) var(--space-xl);min-width:0;border-radius:var(--r-md);background:var(--s3);box-shadow:var(--surface-ring)}.nt-ctx>.nt-i{flex:none;display:grid;place-items:center;width:var(--btn-h-sm);height:var(--btn-h-sm);border-radius:var(--r-sm);background:var(--s4);color:var(--tx-control)}.nt-ctx>.nt-i svg{width:14px;height:14px}.nt-ctxtx{min-width:0;display:flex;flex-direction:column;gap:var(--space-2xs)}.nt-ctxname{color:var(--tx);font-size:var(--fs-sm);font-weight:var(--fw-medium);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nt-hl{min-width:0;flex:1 1 auto;display:flex;flex-direction:column;gap:var(--space-2xs)}.nt-htitle{background:none;border:0;padding:0;text-align:left;color:var(--tx);font:inherit;font-size:var(--fs-3xl);font-weight:var(--fw-semibold);letter-spacing:var(--tracking-tighter);line-height:1.25;max-width:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}button.nt-htitle{cursor:pointer}button.nt-htitle:hover{color:var(--ac-text)}.nt-sub{color:var(--tx3);font-size:var(--fs-11);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.nt-props{display:flex;flex-direction:column;gap:var(--space-md);padding:var(--space-lg) var(--space-2xl);}.nt-prow{display:flex;align-items:center;gap:var(--space-md);min-width:0}.nt-props .nt-tags{margin:0}
.nt-asg{appearance:none;-webkit-appearance:none;height:var(--btn-h-sm);max-width:150px;padding:0 24px 0 var(--space-lg);border-radius:var(--r-pill);font-size:var(--fs-11);text-overflow:ellipsis;background:var(--s3) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239a9aa0' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") right 9px center/9px no-repeat}.nt-asg:hover{background-color:var(--s4)}
.nt-prow>.nt-seg{flex:1;min-width:0}.nt-prow .nt-seg button{padding:0 var(--space-md)}
.nt-due{display:inline-flex;align-items:center;gap:var(--space-sm);height:var(--btn-h-sm);padding:0 var(--space-lg);border:0;border-radius:var(--r-pill);background:var(--s3);color:var(--tx3);font:inherit;font-size:var(--fs-11);font-weight:var(--fw-medium);white-space:nowrap;cursor:pointer;transition:var(--tr-bg-fg)}.nt-due svg{width:var(--icon-xs);height:var(--icon-xs)}.nt-due:hover{background:var(--s4);color:var(--tx)}.nt-due.set{color:var(--tx)}.nt-due.late{color:var(--er);background:color-mix(in srgb,var(--er) 14%,transparent)}
.nt-duebox{position:relative;display:flex;align-items:center;gap:var(--space-2xs);flex:none}.nt-duebox .nt-date{position:absolute;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;padding:0;border:0}.nt-due-clear{width:22px;height:22px}
.nt-title{font-size:var(--fs-md);font-weight:var(--fw-semibold)}.nt-grow{flex:1}
.nt-num{position:relative;display:inline-grid;place-items:center;flex:none;width:28px;height:var(--btn-h-md);color:var(--white);font:var(--fw-semibold) var(--fs-11)/1 var(--font-sans);font-variant-numeric:tabular-nums}.nt-num>b{position:relative;font-weight:inherit}.nt-num[data-shape=triangle]>b{margin-top:5px}.nt-num.new .shape{stroke:var(--er)}.nt-num.done .shape{fill:var(--ok);stroke:none}
.nt-tags{display:inline-flex;align-items:center;gap:var(--space-lg)}
.nt-tagdot{position:relative;width:var(--icon-sm);height:var(--icon-sm);border:0;padding:0;background:none;color:var(--c);opacity:.45;cursor:pointer;transition:opacity var(--dur-fast),scale var(--dur-fast) var(--ease-ios)}.nt-tagdot::before{content:'';position:absolute;inset:-5px;border-radius:50%}.nt-tagdot:hover{opacity:.85}.nt-tagdot.on{opacity:1;scale:1.12}
.nt-tagdot .shape{position:static;display:block;fill:var(--c);stroke:none}.nt-tagdot.on .shape{stroke:var(--tx);stroke-width:2.2}
.nt-tagname{color:var(--tx3);font-size:var(--fs-11);margin-left:var(--space-2xs)}
.nt-ib{width:var(--btn-h-sm);height:var(--btn-h-sm);display:inline-grid;place-items:center;border:0;border-radius:var(--r-sm);background:transparent;color:var(--tx-control);cursor:pointer;padding:0;transition:var(--tr-bg-fg)}.nt-ib:hover:not(:disabled){background:var(--s4);color:var(--tx)}.nt-ib:disabled{opacity:var(--op-4);cursor:default}.nt-ib svg{width:var(--icon-sm);height:var(--icon-sm)}.nt-ib.on{color:var(--ok)}
.nt-btn{height:var(--btn-h-sm);padding:0 var(--space-xl);border:0;border-radius:var(--r-sm);background:var(--s3);color:var(--tx-control);font:inherit;font-size:var(--fs-sm);font-weight:var(--fw-medium);cursor:pointer;transition:var(--tr-bg-fg)}.nt-btn:hover:not(:disabled){background:var(--s4);color:var(--tx)}
.nt-sel{height:var(--btn-h-sm);border:0;border-radius:var(--r-sm);background:var(--s3);color:var(--tx-control);font:inherit;font-size:var(--fs-sm);padding:0 var(--space-md);cursor:pointer;transition:var(--tr-bg-fg)}.nt-sel:hover{background:var(--s4);color:var(--tx)}.nt-sel.small{max-width:128px;height:22px;font-size:var(--fs-11)}
.nt-where{display:flex;align-items:center;gap:var(--space-md);padding:0 var(--space-xl) var(--space-md);color:var(--tx3);font-size:var(--fs-11);min-width:0}
.nt-link{background:none;border:0;padding:0;color:var(--ac-text);cursor:pointer;font:inherit;text-align:left;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nt-link:hover{text-decoration:underline}.nt-link.warn,.nt-warn{color:var(--pin)}
.nt-thumb{display:block;width:calc(100% - 28px);height:84px;object-fit:cover;margin:0 var(--space-2xl) var(--space-lg);border-radius:var(--r-md);cursor:pointer;box-shadow:var(--surface-ring)}
.nt-msgs{display:flex;flex-direction:column;gap:var(--space-2xl);min-height:120px;overflow-y:auto;padding:var(--space-2xl);scrollbar-width:thin;scrollbar-color:var(--s7) transparent}
.nt-msg{display:flex;gap:var(--space-lg);border-radius:var(--r-md)}.nt-av{flex:none;width:var(--btn-h-sm);height:var(--btn-h-sm);border-radius:50%;color:var(--white);display:grid;place-items:center;font:var(--fw-semibold) var(--fs-11)/1 var(--font-sans)}
.nt-body{flex:1;min-width:0}.nt-top{display:flex;align-items:center;gap:var(--space-md);min-height:22px}.nt-top b{font-weight:var(--fw-semibold)}.nt-time{color:var(--tx3);font-size:var(--fs-11)}
.nt-acts{display:inline-flex;opacity:0;transition:opacity var(--dur-fast)}.nt-msg:hover .nt-acts,.nt-acts:focus-within{opacity:1}.nt-acts .nt-ib{width:22px;height:22px}.nt-acts .nt-ib svg{width:var(--icon-xs);height:var(--icon-xs)}
.nt-text,.nt-was{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--tx)}.nt-was{color:var(--tx3);margin:2px 0 6px;padding-left:var(--space-md);border-left:2px solid var(--s6)}.nt-gone{color:var(--tx3);font-style:italic}
.nt-edited{font-size:var(--fs-11);margin-top:2px}.nt-prev{margin-top:4px;font-size:var(--fs-11)}
.nt-quote{display:block;width:100%;text-align:left;background:none;border:0;border-left:2px solid var(--s6);padding:0 0 0 var(--space-md);margin:var(--space-2xs) 0;color:var(--tx3);font:inherit;font-size:var(--fs-11);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:var(--tr-bg-fg)}.nt-quote:hover{color:var(--tx2)}.nt-quote b{font-weight:var(--fw-semibold);color:var(--tx2)}
.nt-react{display:flex;gap:var(--space-2xs);margin:var(--space-sm) 0 0 -6px}
.nt-rb{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-xs);height:22px;min-width:22px;padding:0 var(--space-sm);border:0;border-radius:var(--r-pill);background:transparent;color:var(--tx3);font:inherit;font-size:var(--fs-11);cursor:pointer;opacity:0;transition:var(--tr-bg-fg),opacity var(--dur-fast)}.nt-rb svg{width:var(--icon-xs);height:var(--icon-xs)}
.nt-msg:hover .nt-rb,.nt-rb.has,.nt-rb.on,.nt-rb:focus-visible{opacity:1}.nt-rb:hover{background:var(--s4);color:var(--tx)}.nt-rb.on{background:var(--ac-tint-12);color:var(--ac-text)}.nt-rb.on.done{background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok)}
.nt-msg.flash{animation:nt-flash 1.1s var(--ease-out)}@keyframes nt-flash{from{background:var(--ac-tint-18)}}
.nt-hist{list-style:none;margin:0 var(--space-2xl) var(--space-lg);padding:0;max-height:96px;overflow:auto;color:var(--tx3);font-size:var(--fs-11);scrollbar-width:thin}
.nt-brief{display:flex;gap:var(--space-lg);padding:var(--space-md) var(--space-2xl) var(--space-lg);}.nt-text.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.nt-moreinfo{display:block;width:calc(100% - 28px);margin:var(--space-lg) var(--space-2xl) var(--space-2xl);padding:var(--space-sm) var(--space-lg);border:0;border-radius:var(--r-sm);background:var(--s3);color:var(--tx3);font:inherit;font-size:var(--fs-11);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:var(--tr-bg-fg)}.nt-moreinfo:hover{background:var(--s4);color:var(--tx)}
.nt-comp{margin:0 var(--space-2xl) var(--space-2xl);padding:var(--space-md) var(--space-sm) var(--space-sm) var(--space-lg);border-radius:var(--r-lg);background:var(--ctl-bg);border:1px solid var(--ctl-bd);display:flex;flex-direction:column;gap:var(--space-xs);transition:border-color var(--dur-base) var(--ease-out)}.nt-comp:hover{border-color:var(--ctl-bd-hover)}.nt-comp:focus-within{border-color:var(--s7)}
.nt-comp textarea{display:block;width:100%;box-sizing:border-box;resize:none;border:0;outline:0;background:transparent;color:var(--tx);font:inherit;min-height:20px;max-height:140px;padding:var(--space-2xs) 0;overflow-y:auto;scrollbar-width:thin}
.nt-comp-row{display:flex;align-items:center;gap:var(--space-xs)}.nt-as{color:var(--tx3);font-size:var(--fs-11);cursor:pointer;margin-left:var(--space-xs)}.nt-as:hover{color:var(--tx);text-decoration:underline}
.nt-send{width:var(--btn-h-sm);height:var(--btn-h-sm);border-radius:50%;background:var(--ac);color:var(--tx-on-accent,var(--white))}.nt-send svg{width:var(--icon-xs);height:var(--icon-xs)}.nt-send:hover:not(:disabled){background:var(--ac);color:var(--tx-on-accent,var(--white));filter:brightness(1.1)}.nt-send:disabled{background:var(--s4);color:var(--tx3);opacity:1}
.nt-shot.on{background:var(--ac-tint-12);color:var(--ac-text)}
.nt-replying{display:flex;align-items:center;gap:var(--space-sm);color:var(--tx3);font-size:var(--fs-11)}.nt-replying span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nt-replying .nt-i{display:inline-flex}.nt-replying svg{width:var(--icon-xs);height:var(--icon-xs)}.nt-replying .nt-ib{width:20px;height:20px}
.nt-menu{position:absolute;z-index:5;min-width:220px;background:var(--surface-pop);border-radius:var(--r-md);padding:var(--space-xs);box-shadow:var(--surface-shadow),var(--surface-ring);display:flex;flex-direction:column;animation:var(--menu-in)}.nt-menu button{background:none;border:0;text-align:left;color:var(--tx-control);font:inherit;padding:var(--space-sm) var(--space-lg);border-radius:var(--r-sm);cursor:pointer;transition:var(--tr-bg-fg)}.nt-menu button:hover{background:var(--s4);color:var(--tx)}.nt-menu .danger{color:var(--er)}

#notes-section .sec-ico svg{display:block;width:100%;height:100%}
#notes-body{display:flex;flex-direction:column;gap:var(--space-lg)}
.nt-seg.nt-mini button{height:20px}
.nt-date{height:var(--btn-h-sm);box-sizing:border-box;padding:0 var(--space-md);border:1px solid var(--ctl-bd);border-radius:var(--ctl-r);background:var(--ctl-bg);color:var(--tx);font:inherit;font-size:var(--fs-sm);color-scheme:dark;outline:none;transition:border-color var(--dur-base) var(--ease-out)}.nt-date:hover{border-color:var(--ctl-bd-hover)}.nt-date:focus{border-color:var(--s7)}
.nt-review{display:flex;gap:var(--space-sm)}.nt-rv{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:var(--space-sm);height:var(--btn-h-md);border:0;border-radius:var(--r-md);background:var(--s3);color:var(--tx-control);font:inherit;font-size:var(--fs-11);font-weight:var(--fw-medium);cursor:pointer;transition:var(--tr-bg-fg)}.nt-rv svg{width:var(--icon-xs);height:var(--icon-xs)}.nt-rv:hover{background:var(--s4);color:var(--tx)}.nt-rv.on[data-state=approved]{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}.nt-rv.on[data-state=changes]{background:color-mix(in srgb,var(--pin) 16%,transparent);color:var(--pin)}
.nt-revsum{padding:0 var(--space-xs);margin-top:calc(var(--space-sm) * -1)}
.nt-mention{color:var(--ac-text);font-weight:var(--fw-medium)}.nt-mention.me{background:var(--ac-tint-18);border-radius:var(--r-xs);padding:0 var(--space-xs)}
.nt-comp{position:relative}.nt-mentions{position:absolute;left:var(--space-lg);bottom:100%;margin-bottom:4px;min-width:160px;display:flex;flex-direction:column;padding:var(--space-xs);border-radius:var(--r-md);background:var(--surface-pop);box-shadow:var(--surface-shadow),var(--surface-ring);z-index:6}.nt-mentions[hidden]{display:none}.nt-mentions button{background:none;border:0;text-align:left;color:var(--tx-control);font:inherit;padding:var(--space-sm) var(--space-lg);border-radius:var(--r-sm);cursor:pointer}.nt-mentions button.on,.nt-mentions button:hover{background:var(--s4);color:var(--tx)}
.note-pop :is(input,textarea,select):focus-visible{outline:none}
.nt-form{display:flex;flex-direction:column;gap:var(--space-md);padding:var(--space-lg) var(--space-2xl) var(--space-md)}
.nt-ttl,.nt-descin{width:100%;box-sizing:border-box;border:1px solid var(--ctl-bd);border-radius:var(--ctl-r);background:var(--ctl-bg);color:var(--tx);font:inherit;outline:none;transition:border-color var(--dur-base) var(--ease-out)}
.nt-ttl{height:var(--btn-h-md);padding:0 var(--ctl-px);font-size:var(--fs-md);font-weight:var(--fw-semibold)}.nt-descin{resize:none;padding:var(--space-md) var(--ctl-px);min-height:44px;overflow-y:auto;scrollbar-width:thin}
.nt-ttl:hover,.nt-descin:hover{border-color:var(--ctl-bd-hover)}.nt-ttl:focus,.nt-descin:focus{border-color:var(--s7)}
.nt-formfoot{display:flex;align-items:center;gap:var(--space-md);padding:var(--space-md) var(--space-2xl) var(--space-2xl)}
.nt-btn.primary{background:var(--ac);color:var(--tx-on-accent,var(--white))}.nt-btn.primary:hover:not(:disabled){background:var(--ac);filter:brightness(1.1)}.nt-btn:disabled{opacity:var(--op-4);cursor:default}
.nt-rename{width:100%;max-width:100%;height:var(--btn-h-md);box-sizing:border-box;padding:0 var(--space-md);border:1px solid var(--s7);border-radius:var(--r-sm);background:var(--ctl-bg);color:var(--tx);font:inherit;font-size:var(--fs-3xl);font-weight:var(--fw-semibold);outline:none}
.nt-htitle{max-width:100%}.nt-hl{flex:1}.nt-sub{max-width:230px}
.nt-descblock{padding:var(--space-xs) var(--space-2xl) 0}.nt-desc{display:flex;flex-direction:column;gap:var(--space-sm)}.nt-desctop{display:flex;align-items:center;gap:var(--space-md);min-height:22px}.nt-desclabel{color:var(--tx3);font-size:var(--fs-10);font-weight:var(--fw-semibold);letter-spacing:var(--tracking-wide);text-transform:uppercase}.nt-desctop .nt-ib{width:22px;height:22px;opacity:0;transition:opacity var(--dur-fast)}.nt-desc:hover .nt-desctop .nt-ib,.nt-desctop .nt-ib:focus-visible{opacity:1}.nt-descby{color:var(--tx3);font-size:var(--fs-11)}.nt-adddesc{background:none;border:0;padding:0;color:var(--tx3);font:inherit;font-size:var(--fs-11);cursor:pointer}.nt-adddesc:hover{color:var(--ac-text)}.nt-nodesc{color:var(--tx3);font-size:var(--fs-11)}
.nt-seclabel{padding:var(--space-2xl) var(--space-2xl) var(--space-md);color:var(--tx3);font-size:var(--fs-10);font-weight:var(--fw-semibold);letter-spacing:var(--tracking-wide);text-transform:uppercase;}#notes-body .nt-seclabel{padding:0}
.nt-msgs .nt-empty{padding:var(--space-md) 0}
.nt-new{flex:2;height:var(--btn-h-md);display:inline-flex;align-items:center;justify-content:center;gap:var(--space-sm);border:0;border-radius:var(--r-md);background:var(--ac-tint-18);color:var(--ac-text);font:inherit;font-size:var(--fs-sm);font-weight:var(--fw-medium);cursor:pointer;transition:var(--tr-bg-fg),transform var(--dur-fast) var(--ease-ios)}.nt-new svg{width:var(--icon-xs);height:var(--icon-xs)}.nt-new:hover{filter:brightness(1.15)}.nt-new:active{transform:scale(.97)}
.nt-chk{flex:none;width:18px;height:18px;margin-top:1px;border-radius:50%;border:1.5px solid var(--s7);background:transparent;color:transparent;display:grid;place-items:center;padding:0;cursor:pointer;transition:var(--tr-bg-fg),border-color var(--dur-fast)}.nt-chk svg{width:var(--icon-xs);height:var(--icon-xs);stroke-width:3}.nt-chk:hover{border-color:var(--ok);color:var(--ok)}.nt-chk.on{background:var(--ok);border-color:var(--ok);color:var(--white)}
.nt-rtitle{display:flex;align-items:center;gap:var(--space-sm);min-width:0}.nt-rt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-sm);font-weight:var(--fw-medium);color:var(--tx)}.nt-row.done .nt-rt{text-decoration:line-through;color:var(--tx3);font-weight:inherit}
.nt-num.mini{width:18px;height:18px;font-size:9px}.nt-pri{flex:none;width:6px;height:6px;border-radius:50%}.nt-pri.high{background:var(--pin)}.nt-pri.urgent{background:var(--er)}
.nt-meta{display:flex;align-items:center;gap:var(--space-sm);overflow:hidden}.nt-mt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nt-chip{flex:none;padding:0 var(--space-sm);border-radius:var(--r-pill);background:var(--s3);color:var(--tx2);font-size:var(--fs-10);line-height:15px}.nt-chip.late{background:color-mix(in srgb,var(--er) 16%,transparent);color:var(--er)}.nt-chip.soon{background:color-mix(in srgb,var(--pin) 16%,transparent);color:var(--pin)}
.nt-ra{flex:none;width:20px;height:20px;font-size:var(--fs-10)}
.nt-partcard{display:flex;align-items:center;gap:var(--space-lg);margin:0 var(--space-2xl) var(--space-xs);padding:var(--space-md) var(--space-sm) var(--space-md) var(--space-lg);border-radius:var(--r-lg);background:var(--s3)}.nt-pico{flex:none;width:28px;height:var(--btn-h-md);display:grid;place-items:center;border-radius:var(--r-md);background:var(--ac-tint-12);color:var(--ac-text);box-shadow:inset 0 0 0 1px var(--ac-tint-20)}.nt-pico svg{width:var(--icon-sm);height:var(--icon-sm)}.nt-ptxt{min-width:0;display:flex;flex-direction:column;gap:1px}.nt-pname{font-size:var(--fs-sm);font-weight:var(--fw-medium);color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nt-psub{font-size:var(--fs-11);color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nt-partcard .nt-ib{width:var(--btn-h-sm);height:var(--btn-h-sm)}
.nt-done{position:relative;overflow:visible}.nt-done svg{position:relative;z-index:1}
.nt-done::before{content:'';position:absolute;inset:1px;border-radius:50%;background:var(--ok);scale:0;opacity:0}
.nt-ib.nt-done.on{color:var(--white)}.nt-done.on::before{scale:1;opacity:1}.nt-ib.nt-done.on:hover:not(:disabled){background:transparent;color:var(--white)}
.nt-done.pop::before{animation:nt-done-in var(--dur-300) var(--ease-ios)}.nt-done.pop svg{animation:nt-check-in var(--dur-300) var(--ease-ios) .05s both}
.nt-done.unmark::before{animation:nt-done-out var(--dur-fast) ease-in forwards}.nt-ib.nt-done.unmark{color:var(--tx-control)}
@keyframes nt-done-in{from{scale:0;opacity:0}60%{scale:1.18;opacity:1}to{scale:1;opacity:1}}@keyframes nt-check-in{from{scale:.3;opacity:0}to{scale:1;opacity:1}}@keyframes nt-done-out{to{scale:0;opacity:0}}
@media (prefers-reduced-motion:reduce){.nt-done.pop::before,.nt-done.pop svg,.nt-done.unmark::before{animation:none}}
.nt-titlebar .nt-tbadge{width:22px;height:22px;flex:none}
.nt-cpanel{display:flex;flex-direction:column;background:color-mix(in srgb,var(--tx) 2%,transparent);border-radius:0 0 var(--surface-win-r) var(--surface-win-r);margin-top:var(--space-xl)}.nt-cpanel>.nt-msgs{flex:1 1 auto;min-height:96px;overflow:visible;max-height:none}.nt-cpanel>.nt-msgs.empty{flex:0 0 auto;min-height:0;padding-top:var(--space-xs);padding-bottom:var(--space-md)}.nt-msgs.empty .nt-empty{padding:0}.nt-clabel{padding-bottom:var(--space-md)}
.nt-ib.nt-edit.on{color:var(--ac-text);background:var(--ac-tint-12)}
.nt-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:var(--space-sm);margin-top:var(--space-md)}.nt-shots-draft{margin:0 var(--space-2xl) var(--space-md)}.nt-shotitem{position:relative}.nt-shots .nt-thumb{width:100%;height:68px;margin:0}
.nt-shotx{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:var(--blk-50);color:var(--white)}.nt-shotx:hover:not(:disabled){background:var(--blk-50);color:var(--white)}.nt-shotx svg{width:var(--icon-xs);height:var(--icon-xs)}
.nt-titlebar .nt-fold{margin-right:calc(var(--space-md) * -1)}
.nt-partcard.multi{align-items:flex-start}.nt-plist{display:flex;flex-direction:column;gap:1px;margin-top:var(--space-sm);min-width:0}.nt-plrow{background:none;border:0;padding:var(--space-2xs) 0;text-align:left;color:var(--tx2);font:inherit;font-size:var(--fs-11);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;transition:color var(--dur-fast)}.nt-plrow:hover{color:var(--ac-text)}.nt-plrow.gone{color:var(--tx3);text-decoration:line-through;cursor:default}.nt-plmore{color:var(--tx3);font-size:var(--fs-11)}
.nt-plabel{display:flex;align-items:center;gap:var(--space-md)}.nt-padd{display:inline-flex;align-items:center;gap:var(--space-xs);height:20px;padding:0 var(--space-md);border:0;border-radius:var(--r-pill);background:var(--ac-tint-12);color:var(--ac-text);font:inherit;font-size:var(--fs-10);font-weight:var(--fw-medium);text-transform:none;letter-spacing:0;cursor:pointer;transition:var(--tr-bg-fg)}.nt-padd svg{width:var(--icon-xs);height:var(--icon-xs)}.nt-padd:hover{filter:brightness(1.15)}
.nt-pmeta{padding:0 var(--space-2xl) var(--space-md);color:var(--tx3);font-size:var(--fs-11)}
.nt-plist2{display:flex;flex-direction:column;gap:var(--space-xs);margin:0}.nt-plist2 .nt-partcard{margin:0 var(--space-2xl);flex:none}
.nt-partcard.fresh{animation:nt-fresh var(--dur-300) var(--ease-ios)}@keyframes nt-fresh{from{opacity:0;transform:translateY(-6px) scale(.98);background:var(--ac-tint-18)}}
.nt-focus{display:inline-grid;place-items:center;width:var(--btn-h-sm);height:var(--btn-h-sm);padding:0;border:0;border-radius:50%;background:var(--s4);color:var(--tx-control);font:inherit;font-size:var(--fs-11);font-weight:var(--fw-medium);cursor:pointer;transition:var(--tr-bg-fg)}.nt-focus svg{width:var(--icon-xs);height:var(--icon-xs)}.nt-focus:hover:not(:disabled){background:var(--s6);color:var(--tx)}.nt-focus:disabled{opacity:var(--op-4);cursor:default}
.nt-partcard .nt-pdel:hover{color:var(--er);background:color-mix(in srgb,var(--er) 14%,transparent)}
.nt-more{align-self:center;margin:var(--space-sm) 0;height:var(--btn-h-sm);padding:0 var(--space-xl);border:0;border-radius:var(--r-pill);background:var(--s3);color:var(--tx-control);font:inherit;font-size:var(--fs-11);cursor:pointer;transition:var(--tr-bg-fg)}.nt-more:hover{background:var(--s4);color:var(--tx)}
.nt-pinsrow{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:var(--space-lg)}.nt-pseg button{padding:0 var(--space-xs)}
.nt-nav{display:flex;align-items:center;gap:var(--space-2xs)}.nt-nav .nt-ib.on{background:var(--ac-tint-18);color:var(--ac-text)}.nt-navlabel{flex:1;color:var(--tx3);font-size:var(--fs-11);padding-left:var(--space-sm)}
.nt-top-row{display:flex;align-items:center;gap:var(--space-md)}.nt-ic{width:20px;height:20px;color:var(--tx3);display:grid;place-items:center}.nt-ic svg{width:var(--icon-sm);height:var(--icon-sm)}
.nt-me{background:none;border:0;color:var(--tx);font:inherit;font-size:var(--fs-md);font-weight:var(--fw-medium);cursor:pointer;padding:0;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nt-me:hover{color:var(--tx-control-hover)}
#notes-section .nt-me-av{display:inline-flex}#notes-section .nt-me-av .nt-av{width:22px;height:22px;font-size:var(--fs-10)}
.nt-top-row .nt-sel{width:74px}
.nt-tools{display:flex;gap:var(--space-sm)}.nt-tool{flex:1;height:var(--btn-h-md);display:inline-grid;place-items:center;border:0;border-radius:var(--r-md);background:var(--s3);color:var(--tx-control);cursor:pointer;padding:0;transition:var(--tr-bg-fg),transform var(--dur-fast) var(--ease-ios)}.nt-tool svg{width:var(--icon-sm);height:var(--icon-sm)}.nt-tool:hover{background:var(--s4);color:var(--tx)}.nt-tool:active{transform:scale(.96)}.nt-tool.on{background:var(--ac-tint-18);color:var(--ac-text)}
.nt-seg{display:flex;gap:var(--space-2xs);padding:2px;border-radius:var(--r-md);background:var(--s3)}.nt-seg button{flex:1;min-width:0;height:var(--btn-h-sm);border:0;border-radius:calc(var(--r-md) - 2px);background:transparent;color:var(--tx3);font:inherit;font-size:var(--fs-11);font-weight:var(--fw-medium);cursor:pointer;transition:var(--tr-bg-fg)}.nt-seg button:hover{color:var(--tx)}.nt-seg button.on{background:var(--s6);color:var(--tx);box-shadow:0 1px 2px var(--blk-30)}
.nt-sbar{display:flex;gap:var(--space-sm);align-items:center}.nt-searchbox{position:relative;flex:1;min-width:0;display:block}.nt-searchbox svg{position:absolute;left:var(--space-lg);top:50%;width:var(--icon-xs);height:var(--icon-xs);margin-top:-6.5px;color:var(--tx3);pointer-events:none}
.nt-search{width:100%;box-sizing:border-box;height:var(--ctl-h);padding:0 var(--ctl-px) 0 30px;border:1px solid var(--ctl-bd);border-radius:var(--ctl-r);background:var(--ctl-bg);color:var(--tx);font:inherit;font-size:var(--ctl-fs);outline:none;transition:border-color var(--dur-base) var(--ease-out)}.nt-search:hover{border-color:var(--ctl-bd-hover)}.nt-search:focus{border-color:var(--ctl-bd-focus)}
.nt-sbar .nt-sel{width:72px;height:var(--ctl-h)}.nt-sbar .nt-ib.on{background:var(--ac-tint-18);color:var(--ac-text)}
.nt-list{display:flex;flex-direction:column;gap:var(--space-2xs);max-height:320px;overflow:auto;scrollbar-width:thin}.nt-empty{color:var(--tx3);padding:var(--space-md) var(--space-2xs);font-size:var(--fs-sm)}
.nt-row{display:flex;align-items:flex-start;gap:var(--space-lg);padding:var(--space-md);border-radius:var(--r-md);cursor:pointer;outline:none;transition:var(--tr-bg-fg)}.nt-row:hover,.nt-row:focus-visible{background:var(--s3)}.nt-row.sel{background:var(--ac-tint-12)}.nt-row.done .nt-line{opacity:var(--op-5)}.nt-row.del{opacity:var(--op-5)}
.nt-rav{position:relative;flex:none;display:inline-flex}.nt-rav .nt-av{width:var(--btn-h-sm);height:var(--btn-h-sm);font-size:var(--fs-11)}.nt-rnum{position:absolute;right:-5px;bottom:-4px;min-width:14px;height:14px;padding:0 var(--space-xs);box-sizing:border-box;border-radius:var(--r-pill);display:grid;place-items:center;color:var(--white);font:var(--fw-semibold) var(--fs-9)/1 var(--font-sans);box-shadow:0 0 0 2px var(--surface-pop,var(--bg))}.nt-rnum.new{outline:2px solid var(--er);outline-offset:1px}
.nt-mid{flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--space-2xs)}.nt-rtop{display:flex;align-items:baseline;gap:var(--space-sm)}.nt-rtop b{font-weight:var(--fw-semibold);font-size:var(--fs-sm);color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nt-line{font-size:var(--fs-sm);color:var(--tx2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.nt-meta{color:var(--tx3);font-size:var(--fs-11);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nt-row .nt-ib{margin:-2px -2px 0 0;opacity:0;transition:var(--tr-bg-fg),opacity var(--dur-fast)}.nt-row:hover .nt-ib,.nt-row .nt-ib.on,.nt-row:focus-visible .nt-ib{opacity:1}
`;
    document.head.append(st);
  }

  function init(host) {
    if (S.host) return;
    S.host = host; css();
    try { const b = host.prefs.get('noteBadge'); if (['number', 'text', 'icon', 'color', 'name'].includes(b)) S.badge = b; } catch (_) {}
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
    togglePlace: () => (S.placing ? stopPlace() : startPlace()), addForSelection, addForScene, addAt, addToPartAt, isolateNoted, importFromFile, saveReport,
    togglePins: () => { S.pins = !S.pins; render(); }, openList: () => { const s = S.card && S.card.section; if (s) { s.querySelector('.section-h').classList.remove('collapsed'); s.scrollIntoView({ block: 'nearest' }); } }, next: () => step(1), prev: () => step(-1),
    markAllRead, review: (state) => needName(() => { C.setReview(S.reviews, author(), state); render(); }, 'Before you sign off, notes need to know who you are.'), reviews: () => S.reviews, items: () => S.items, author, isPlacing: () => !!S.placing, setAuthor,
    _state: S,
  };
})();
