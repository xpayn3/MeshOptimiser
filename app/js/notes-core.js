// ========== NOTES: the data of the notes on a model ==========
// No page, no scene in here: notes as plain data, the steps that change them, the way they are written into a scene file and read back
// (a file from anyone is untrusted: everything is cut to size and checked), how two copies of the same notes are joined, and the
// notes as text, Markdown and one HTML page. The pins, the card and the pop-up are in notes.js. Tests: tests/notes.test.mjs.
//
// A note is a task about a place in the model (a title, an optional description, who it is for, how urgent, when), with comments under it:
//   { id, n, title, kind: 'pin' | 'part' | 'scene', part: { uid, name } | null, also: [ { uid, name } ] (more parts the note is about), local, world, normal, cam,
//     shots [ data URLs of pictures of the view, up to 6; thumb is the first ], shotCams [ the camera of each picture, in the same order ], tag, assignee, status, priority ('normal' | 'high' | 'urgent'), due ('YYYY-MM-DD' or ''), messages: [ { id, by, at, text, desc (true for the description, the first message), updatedAt, edits: [ { by, at, was } ], deleted, to (the message it answers), react: { like, dislike, done: [names] } } ],
//     activity: [ { id, at, by, type, info } ], created: { by, at }, deleted: { by, at } | null, thumb,
//     statusAt, tagAt, assigneeAt, anchorAt, deletedAt }
// Nothing is ever lost by a step: an edit keeps the text it replaced, a delete leaves who deleted it and when, and each change is a line in
// the note's activity. Every change by a person carries the name that person typed (nobody is signed in: it is what they said they are).
(function (root) {
  'use strict';

  const VERSION = 1;
  const TAGS = [
    { id: 'info', label: 'Info', color: '#4da3ff' },
    { id: 'question', label: 'Question', color: '#b58cff' },
    { id: 'issue', label: 'Issue', color: '#ff6b5e' },
    { id: 'idea', label: 'Idea', color: '#3ecf8e' },
  ];
  const TAG_IDS = TAGS.map(t => t.id);
  const PRIORITIES = ['normal', 'high', 'urgent'];
  const LIMITS = { notes: 2000, messages: 400, activity: 600, edits: 40, text: 6000, name: 60, title: 140, shots: 6, partName: 200, thumb: 30000, tagless: 'info' };

  let seq = 0;
  const rnd = () => Math.random().toString(36).slice(2, 8);
  const newId = (p) => (p || 'n') + '_' + Date.now().toString(36) + (++seq).toString(36) + rnd();
  const isoNow = () => new Date().toISOString();

  // ── what a person types, and what a file says ────────────────────────────────────────────────────
  const str = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : '');
  const name = (v) => str(v, LIMITS.name).replace(/\s+/g, ' ').trim();
  const text = (v) => str(v, LIMITS.text);
  const iso = (v) => { if (typeof v !== 'string') return ''; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };
  const vec = (v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v.map(Number) : null);
  const oneOf = (v, list, d) => (list.includes(v) ? v : d);
  const who = (v) => { const n = name(v); if (!n) throw new Error('A name is needed'); return n; };

  // ── making a note and changing it ─────────────────────────────────────────────────────────────────
  function log(note, by, type, info, at) {
    note.activity.push({ id: newId('a'), at, by, type, info: info == null ? '' : str(String(info), 200) });
    if (note.activity.length > LIMITS.activity) note.activity.splice(0, note.activity.length - LIMITS.activity);
  }
  function nextNumber(notes) { let m = 0; for (const n of notes) if (n.n > m) m = n.n; return m + 1; }

  // opts: { kind, part: { uid, name }, local, world, normal, cam, tag, thumb, text, by, now }
  const PIC = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]*$/;
  const cleanShots = (list) => { const out = []; for (const u of Array.isArray(list) ? list : []) { if (typeof u === 'string' && u.length <= LIMITS.thumb && PIC.test(u) && !out.includes(u)) out.push(u); if (out.length >= LIMITS.shots) break; } return out; };
  function pairShots(list, cams, fallback) {
    const shots = [], out = [];
    (Array.isArray(list) ? list : []).forEach((u, i) => {
      if (typeof u !== 'string' || u.length > LIMITS.thumb || !PIC.test(u) || shots.includes(u) || shots.length >= LIMITS.shots) return;
      shots.push(u); out.push(camOf(cams && cams[i]) || fallback || null);
    });
    return { shots, cams: out };
  }
  const firstLine = (t) => String(t || '').split(/\r?\n/)[0].replace(/\s+/g, ' ').trim().slice(0, LIMITS.title);
  function create(notes, opts) {
    const by = who(opts.by), at = opts.now || isoNow();
    const body = text(opts.text).trim(), ttl = firstLine(opts.title) || firstLine(body);
    if (!ttl) throw new Error('A note needs a title');
    const kind = oneOf(opts.kind, ['pin', 'part', 'scene'], 'pin');
    const note = {
      id: newId('n'), n: nextNumber(notes), title: ttl, kind,
      part: opts.part && (opts.part.uid || opts.part.name) ? { uid: str(opts.part.uid, 60), name: str(opts.part.name, LIMITS.partName) } : null,
      also: cleanAlso(opts.also, opts.part),
      local: vec(opts.local), world: vec(opts.world), normal: vec(opts.normal), cam: camOf(opts.cam),
      tag: oneOf(opts.tag, TAG_IDS, 'info'), assignee: '', status: 'open', priority: 'normal', due: '',
      messages: body ? [{ id: newId('m'), by, at, text: body, desc: true, updatedAt: at, edits: [], deleted: null, to: '', react: {} }] : [],
      activity: [], created: { by, at }, deleted: null, shots: [], shotCams: [], thumb: '', shotsAt: at,
      statusAt: at, tagAt: at, assigneeAt: at, anchorAt: at, deletedAt: at, priorityAt: at, dueAt: at, titleAt: at,
    };
    { const ps = pairShots(opts.shots || (opts.thumb ? [opts.thumb] : []), opts.shotCams, camOf(opts.cam)); note.shots = ps.shots; note.shotCams = ps.cams; }
    note.thumb = note.shots[0] || '';
    log(note, by, 'created', '', at);
    notes.push(note);
    return note;
  }
  // the other parts a note is about (not the one its pin is on)
  function cleanAlso(list, primary) {
    const out = [], seen = new Set(); if (primary && (primary.uid || primary.name)) seen.add((primary.uid || '') + '|' + (primary.name || ''));
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || typeof p !== 'object' || !(p.uid || p.name)) continue;
      const k = (p.uid || '') + '|' + (p.name || ''); if (seen.has(k)) continue; seen.add(k);
      out.push({ uid: str(p.uid, 60), name: str(p.name, LIMITS.partName) }); if (out.length >= 5000) break;      // (no limit a person would reach; a file from anyone is still cut)
    }
    return out;
  }
  function setAlso(note, by, list, now) {
    by = who(by); const next = cleanAlso(list, note.part); if (JSON.stringify(next) === JSON.stringify(note.also || [])) return note;
    const at = now || isoNow(); note.also = next; note.anchorAt = at; log(note, by, 'attached', next.length, at); return note;
  }
  const find = (notes, id) => notes.find(n => n.id === id) || null;
  const msgOf = (note, id) => note.messages.find(m => m.id === id) || null;

  function reply(note, by, body, now, toId) {
    by = who(by); body = text(body).trim(); if (!body) throw new Error('Nothing to send');
    if (note.messages.length >= LIMITS.messages) throw new Error('This note has as many messages as a note can hold');
    const at = now || isoNow();
    const m = { id: newId('m'), by, at, text: body, updatedAt: at, edits: [], deleted: null, to: toId && msgOf(note, toId) ? toId : '', react: {} };
    note.messages.push(m); log(note, by, 'replied', '', at);
    return m;
  }
  // A thumb up or down, or a tick ("done"), on one message: one per person and kind, pressed again it goes. Up and down exclude each other.
  function react(note, msgId, by, kind, now) {
    by = who(by); kind = oneOf(kind, ['like', 'dislike', 'done'], 'like');
    const m = msgOf(note, msgId); if (!m || m.deleted) throw new Error('That message is not there');
    const r = m.react || (m.react = {}); const list = r[kind] || (r[kind] = []); const i = list.indexOf(by);
    if (i >= 0) list.splice(i, 1);
    else { list.push(by); const other = kind === 'like' ? 'dislike' : kind === 'dislike' ? 'like' : ''; if (other && r[other]) r[other] = r[other].filter(x => x !== by); }
    for (const k of Object.keys(r)) if (!r[k].length) delete r[k];
    m.updatedAt = now || isoNow(); return m;
  }
  // Anyone can edit any message; the text it had is kept, with who changed it and when.
  function edit(note, msgId, by, body, now) {
    by = who(by); body = text(body).trim();
    const m = msgOf(note, msgId); if (!m || m.deleted) throw new Error('That message is not there');
    if (!body) throw new Error('A message needs some text (delete it instead)');
    if (body === m.text) return m;
    const at = now || isoNow();
    m.edits.push({ by, at, was: m.text }); if (m.edits.length > LIMITS.edits) m.edits.splice(0, m.edits.length - LIMITS.edits);
    m.text = body; m.updatedAt = at; log(note, by, 'edited', m.by === by ? '' : m.by, at);
    return m;
  }
  function removeMessage(note, msgId, by, now) {
    by = who(by); const m = msgOf(note, msgId); if (!m || m.deleted) throw new Error('That message is not there');
    const at = now || isoNow(); m.deleted = { by, at }; m.updatedAt = at; log(note, by, 'removed', m.by === by ? '' : m.by, at);
    return m;
  }
  function restoreMessage(note, msgId, by, now) {
    by = who(by); const m = msgOf(note, msgId); if (!m || !m.deleted) return m;
    const at = now || isoNow(); m.deleted = null; m.updatedAt = at; log(note, by, 'restored message', '', at);
    return m;
  }
  function setStatus(note, by, status, now) {
    by = who(by); status = oneOf(status, ['open', 'resolved'], 'open'); if (note.status === status) return note;
    const at = now || isoNow(); note.status = status; note.statusAt = at; log(note, by, status === 'resolved' ? 'resolved' : 'reopened', '', at);
    return note;
  }
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const pad2 = (x) => String(x).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const todayStr = (plusDays) => { const d = new Date(); d.setDate(d.getDate() + (plusDays || 0)); return ymd(d); };
  // a date (or '' for none): who set it is in the history
  function setDue(note, by, day, now) {
    by = who(by); day = DAY.test(day || '') ? day : ''; if ((note.due || '') === day) return note;
    const at = now || isoNow(); note.due = day; note.dueAt = at; log(note, by, 'due', day, at); return note;
  }
  // '' (no date, or done), 'overdue', 'today' or 'soon' (within two days)
  function dueState(n, today) {
    if (!n || !n.due || n.status === 'resolved' || n.deleted) return '';
    const t = today || todayStr(); if (n.due < t) return 'overdue'; if (n.due === t) return 'today'; return n.due <= todayStr(2) ? 'soon' : '';
  }
  function dueLabel(n, today) {
    if (!n || !n.due) return ''; const t = today || todayStr();
    if (n.due === t) return 'Due today'; if (n.due === todayStr(1)) return 'Due tomorrow';
    const d = new Date(n.due + 'T12:00:00'); const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] || '';
    return (n.due < t && n.status !== 'resolved' ? 'Overdue · ' : 'Due ') + d.getDate() + ' ' + m;
  }
  // the title of the task; the description is its first message (made, or edited, here)
  function setTitle(note, by, ttl, now) {
    by = who(by); ttl = firstLine(ttl); if (!ttl) throw new Error('A note needs a title'); if (note.title === ttl) return note;
    const at = now || isoNow(); note.title = ttl; note.titleAt = at; log(note, by, 'retitled', ttl, at); return note;
  }
  function setDesc(note, by, body, now) {
    by = who(by); body = text(body).trim(); const d = note.messages.find(m => m.desc && !m.deleted);
    if (d) { if (!body) return removeMessage(note, d.id, by, now); return edit(note, d.id, by, body, now); }
    if (!body) return null; const at = now || isoNow();
    const m = { id: newId('m'), by, at, text: body, desc: true, updatedAt: at, edits: [], deleted: null, to: '', react: {} };
    note.messages.unshift(m); log(note, by, 'described', '', at); return m;
  }
  const noteTitle = (n) => (n && n.title) || firstLine(((n && n.messages.find(m => !m.deleted)) || {}).text) || 'Note ' + (n ? n.n : '');
  // pictures of the view kept with the note (up to 6); the first one is its thumb
  function addShot(note, by, url, cam, now) {
    by = who(by); const ps = pairShots((note.shots || []).concat([url]), (note.shotCams || []).concat([cam]), null); if (ps.shots.length === (note.shots || []).length) return note;
    const at = now || isoNow(); note.shots = ps.shots; note.shotCams = ps.cams; note.thumb = ps.shots[0]; note.shotsAt = at; log(note, by, 'shot', 'added', at); return note;
  }
  function removeShot(note, by, i, now) {
    by = who(by); const list = (note.shots || []).slice(), cams = (note.shotCams || []).slice(); if (!(i >= 0 && i < list.length)) return note; list.splice(i, 1); cams.splice(i, 1);
    const at = now || isoNow(); note.shots = list; note.shotCams = cams; note.thumb = list[0] || ''; note.shotsAt = at; log(note, by, 'shot', 'removed', at); return note;
  }
  function setPriority(note, by, p, now) {
    by = who(by); p = oneOf(p, PRIORITIES, 'normal'); if ((note.priority || 'normal') === p) return note;
    const at = now || isoNow(); note.priority = p; note.priorityAt = at; log(note, by, 'priority', p, at); return note;
  }
  function setTag(note, by, tag, now) {
    by = who(by); tag = oneOf(tag, TAG_IDS, 'info'); if (note.tag === tag) return note;
    const at = now || isoNow(); const was = note.tag; note.tag = tag; note.tagAt = at; log(note, by, 'tagged', was + ' → ' + tag, at);
    return note;
  }
  function assign(note, by, to, now) {
    by = who(by); to = name(to); if (note.assignee === to) return note;
    const at = now || isoNow(); note.assignee = to; note.assigneeAt = at; log(note, by, to ? 'assigned' : 'unassigned', to, at);
    return note;
  }
  // opts: { part, local, world, normal, cam }
  function moveAnchor(note, by, opts, now) {
    by = who(by); const at = now || isoNow();
    if (opts.part !== undefined) note.part = opts.part && (opts.part.uid || opts.part.name) ? { uid: str(opts.part.uid, 60), name: str(opts.part.name, LIMITS.partName) } : null;
    if (opts.local !== undefined) note.local = vec(opts.local);
    if (opts.world !== undefined) note.world = vec(opts.world);
    if (opts.normal !== undefined) note.normal = vec(opts.normal);
    if (opts.cam !== undefined) note.cam = camOf(opts.cam);
    if (note.kind === 'scene' && (note.world || note.local)) note.kind = 'pin';
    note.anchorAt = at; log(note, by, 'moved', '', at);
    return note;
  }
  function removeNote(note, by, now) {
    by = who(by); if (note.deleted) return note;
    const at = now || isoNow(); note.deleted = { by, at }; note.deletedAt = at; log(note, by, 'deleted', '', at);
    return note;
  }
  function restoreNote(note, by, now) {
    by = who(by); if (!note.deleted) return note;
    const at = now || isoNow(); note.deleted = null; note.deletedAt = at; log(note, by, 'restored', '', at);
    return note;
  }
  function camOf(c) {
    if (!c) return null;
    const pos = vec(c.pos), target = vec(c.target); if (!pos || !target) return null;
    return { pos, target, up: vec(c.up) || [0, 1, 0], fov: Number.isFinite(c.fov) ? +c.fov : null, ortho: !!c.ortho, half: Number.isFinite(c.half) ? +c.half : null };
  }

  // ── asking about them ──────────────────────────────────────────────────────────────────────────────
  const live = (notes) => notes.filter(n => !n.deleted);
  function stats(notes) {
    const s = { total: 0, open: 0, resolved: 0, deleted: 0, messages: 0, overdue: 0 };
    for (const n of notes) {
      if (n.deleted) { s.deleted++; continue; }
      s.total++; if (n.status === 'resolved') s.resolved++; else s.open++; if (dueState(n) === 'overdue') s.overdue++;
      s.messages += n.messages.filter(m => !m.deleted).length;
    }
    return s;
  }
  function authors(notes) {
    const set = new Set();
    for (const n of notes) { set.add(n.created.by); if (n.assignee) set.add(n.assignee); for (const m of n.messages) { set.add(m.by); for (const e of m.edits) set.add(e.by); } for (const a of n.activity) set.add(a.by); }
    set.delete(''); return [...set].sort((a, b) => a.localeCompare(b));
  }
  // the time of the last change to a note by anyone
  function lastChange(n) {
    let t = n.created.at;
    for (const a of n.activity) if (a.at > t) t = a.at;
    for (const m of n.messages) if (m.updatedAt > t) t = m.updatedAt;
    return t;
  }
  // The last change made by somebody else than `me`: what to show as new to `me` after `since`.
  function lastOthers(n, me) {
    let t = '';
    for (const a of n.activity) if (a.by !== me && a.at > t) t = a.at;
    return t;
  }
  function unread(n, me, since) { if (!me || n.deleted) return false; const t = lastOthers(n, me); return !!t && (!since || t > since); }
  // text of one message as it reads now, and a line saying what happened to it
  const activityLine = (a) => {
    const i = a.info ? ' ' + a.info : '';
    switch (a.type) {
      case 'created': return a.by + ' started the note';
      case 'replied': return a.by + ' replied';
      case 'edited': return a.by + ' edited' + (a.info ? ' ' + a.info + '’s message' : ' a message');
      case 'removed': return a.by + ' deleted' + (a.info ? ' ' + a.info + '’s message' : ' a message');
      case 'resolved': return a.by + ' marked it resolved';
      case 'reopened': return a.by + ' reopened it';
      case 'due': return a.info ? a.by + ' set the due date to ' + a.info : a.by + ' took the due date off';
      case 'attached': return a.by + ' set the other parts to ' + (a.info || 0);
      case 'retitled': return a.by + ' renamed it' + (a.info ? ' to “' + a.info + '”' : '');
      case 'described': return a.by + ' added a description';
      case 'shot': return a.by + (a.info === 'removed' ? ' took a screenshot off' : ' added a screenshot');
      case 'priority': return a.by + ' set the priority to ' + (a.info || 'normal');
      case 'tagged': return a.by + ' changed the tag' + i;
      case 'assigned': return a.by + ' assigned it to' + i;
      case 'unassigned': return a.by + ' took the assignment off';
      case 'moved': return a.by + ' moved the pin';
      case 'deleted': return a.by + ' deleted the note';
      case 'restored': return a.by + ' brought the note back';
      case 'restored message': return a.by + ' brought a message back';
      default: return a.by + ' ' + a.type + i;
    }
  };

  // ── in a file, and out of one ─────────────────────────────────────────────────────────────────────────
  function cleanReact(r) {
    const out = {}; if (!r || typeof r !== 'object') return out;
    for (const k of ['like', 'dislike', 'done']) { const l = Array.isArray(r[k]) ? [...new Set(r[k].map(name).filter(Boolean))].slice(0, 50) : []; if (l.length) out[k] = l; }
    return out;
  }
  function cleanMessage(m) {
    if (!m || typeof m !== 'object') return null;
    const by = name(m.by), body = text(m.text); if (!by && !body) return null;
    const at = iso(m.at) || isoNow();
    return {
      id: str(m.id, 40) || newId('m'), by: by || 'Unknown', at, text: body, desc: m.desc === true, updatedAt: iso(m.updatedAt) || at,
      edits: (Array.isArray(m.edits) ? m.edits : []).slice(-LIMITS.edits).map(e => (e && typeof e === 'object' ? { by: name(e.by) || 'Unknown', at: iso(e.at) || at, was: text(e.was) } : null)).filter(Boolean),
      deleted: m.deleted && typeof m.deleted === 'object' ? { by: name(m.deleted.by) || 'Unknown', at: iso(m.deleted.at) || at } : null,
      to: str(m.to, 40), react: cleanReact(m.react),
    };
  }
  function cleanNote(r) {
    if (!r || typeof r !== 'object') return null;
    const created = { by: name(r.created && r.created.by) || 'Unknown', at: iso(r.created && r.created.at) || isoNow() };
    const messages = (Array.isArray(r.messages) ? r.messages : []).slice(0, LIMITS.messages).map(cleanMessage).filter(Boolean);
    const ttl = firstLine(r.title) || firstLine((messages[0] || {}).text);
    if (!messages.length && !ttl) return null;
    if (!r.title && messages[0]) messages[0].desc = true;      // (a note made before titles: its first message is its description)
    const at = created.at;
    const ps = pairShots((Array.isArray(r.shots) ? r.shots : []).concat(r.thumb ? [r.thumb] : []), r.shotCams, camOf(r.cam)), shots = ps.shots;
    return {
      id: str(r.id, 40) || newId('n'), n: Number.isFinite(+r.n) && +r.n > 0 ? Math.floor(+r.n) : 0, title: ttl,
      kind: oneOf(r.kind, ['pin', 'part', 'scene'], 'pin'),
      part: r.part && typeof r.part === 'object' && (r.part.uid || r.part.name) ? { uid: str(r.part.uid, 60), name: str(r.part.name, LIMITS.partName) } : null,
      also: cleanAlso(r.also, r.part && typeof r.part === 'object' ? r.part : null),
      local: vec(r.local), world: vec(r.world), normal: vec(r.normal), cam: camOf(r.cam),
      tag: oneOf(r.tag, TAG_IDS, 'info'), assignee: name(r.assignee), status: oneOf(r.status, ['open', 'resolved'], 'open'), priority: oneOf(r.priority, PRIORITIES, 'normal'), due: DAY.test(String(r.due || '')) ? String(r.due) : '',
      messages,
      activity: (Array.isArray(r.activity) ? r.activity : []).slice(-LIMITS.activity).map(a => (a && typeof a === 'object' && a.type ? { id: str(a.id, 40) || newId('a'), at: iso(a.at) || at, by: name(a.by) || 'Unknown', type: str(a.type, 30), info: str(a.info, 200) } : null)).filter(Boolean),
      created, deleted: r.deleted && typeof r.deleted === 'object' ? { by: name(r.deleted.by) || 'Unknown', at: iso(r.deleted.at) || at } : null,
      shots, shotCams: ps.cams, thumb: shots[0] || '', shotsAt: iso(r.shotsAt) || at,
      statusAt: iso(r.statusAt) || at, tagAt: iso(r.tagAt) || at, assigneeAt: iso(r.assigneeAt) || at, anchorAt: iso(r.anchorAt) || at, deletedAt: iso(r.deletedAt) || at, priorityAt: iso(r.priorityAt) || at, dueAt: iso(r.dueAt) || at, titleAt: iso(r.titleAt) || at,
    };
  }
  // The numbers of the notes are theirs for good (they are quoted in conversations); two notes with the same number, which two copies of a
  // file can make, are told apart by when they began: the later one takes the next free number.
  function renumber(notes) {
    const byTime = notes.slice().sort((a, b) => (a.created.at < b.created.at ? -1 : a.created.at > b.created.at ? 1 : a.id < b.id ? -1 : 1));
    const used = new Set(); let max = 0;
    for (const n of byTime) if (n.n > max) max = n.n;
    for (const n of byTime) { if (n.n > 0 && !used.has(n.n)) used.add(n.n); else { n.n = ++max; used.add(n.n); } }
    return notes;
  }
  // ── sign-offs: each person can approve the scene or ask for changes (one answer each, pressed again it goes) ──
  const REVIEW_STATES = ['approved', 'changes'];
  function cleanReviews(r) {
    const out = {}; if (!r || typeof r !== 'object') return out;
    for (const k of Object.keys(r).slice(0, 100)) { const nm = name(k), v = r[k]; if (nm && v && typeof v === 'object' && REVIEW_STATES.includes(v.state)) out[nm] = { state: v.state, at: iso(v.at) || isoNow(), text: str(v.text, 300) }; }
    return out;
  }
  function setReview(reviews, by, state, text, now) {
    by = who(by); state = oneOf(state, REVIEW_STATES, 'approved');
    if (reviews[by] && reviews[by].state === state && !text) delete reviews[by]; else reviews[by] = { state, at: now || isoNow(), text: str(text || '', 300) };
    return reviews;
  }
  function reviewSummary(reviews) {
    const approved = [], changes = [];
    for (const k of Object.keys(reviews || {})) (reviews[k].state === 'approved' ? approved : changes).push(k);
    return { approved, changes, state: changes.length ? 'changes' : approved.length ? 'approved' : 'none' };
  }
  function mergeReviews(mine, theirs) {
    const out = Object.assign({}, mine); for (const k of Object.keys(theirs || {})) if (!out[k] || theirs[k].at > out[k].at) out[k] = theirs[k]; return out;
  }
  // the names (of the ones given) that a text mentions with @
  function mentions(txt, names) {
    const out = []; const t = String(txt || '').toLowerCase(); if (!t.includes('@')) return out;
    for (const nm of names || []) { const k = '@' + String(nm).toLowerCase(); let i = t.indexOf(k); while (i >= 0) { const c = t[i + k.length]; if (!c || !/[\p{L}\p{N}_]/u.test(c)) { out.push(nm); break; } i = t.indexOf(k, i + 1); } }
    return out;
  }
  // raw: what the file holds ({ v, items, seen, reviews }); returns { items, seen, reviews }. Never throws.
  function parse(raw) {
    const out = { items: [], seen: {}, reviews: {} };
    try {
      if (!raw || typeof raw !== 'object') return out;
      const list = Array.isArray(raw.items) ? raw.items : [];
      const ids = new Set();
      for (const r of list.slice(0, LIMITS.notes)) { const n = cleanNote(r); if (n && !ids.has(n.id)) { ids.add(n.id); out.items.push(n); } }
      renumber(out.items); out.reviews = cleanReviews(raw.reviews);
      if (raw.seen && typeof raw.seen === 'object') for (const k of Object.keys(raw.seen).slice(0, 200)) { const nm = name(k), t = iso(raw.seen[k]); if (nm && t) out.seen[nm] = t; }
    } catch (_) { /* a file that is not ours: no notes */ }
    return out;
  }
  function serialize(notes, seen, reviews) {
    return { v: VERSION, items: JSON.parse(JSON.stringify(notes)), seen: Object.assign({}, seen || {}), reviews: JSON.parse(JSON.stringify(reviews || {})) };
  }

  // ── two copies of the same notes become one ───────────────────────────────────────────────────────────
  // For a thing both copies changed, the later change wins; what is only in one copy is added. Messages, activity and the earlier texts of an
  // edited message are joined, so nobody's words are lost. Returns { items, added, changed } (the numbers of notes and messages that came in).
  function merge(mine, theirs) {
    const items = JSON.parse(JSON.stringify(mine)); let added = 0, changed = 0;
    const by = new Map(items.map(n => [n.id, n]));
    for (const t of JSON.parse(JSON.stringify(theirs))) {
      const a = by.get(t.id);
      if (!a) { items.push(t); by.set(t.id, t); added++; continue; }
      let did = false;
      const ms = new Map(a.messages.map(m => [m.id, m]));
      for (const m of t.messages) {
        const x = ms.get(m.id);
        if (!x) { a.messages.push(m); ms.set(m.id, m); did = true; continue; }
        const seen = new Set(x.edits.map(e => e.at + '|' + e.by));
        for (const e of m.edits) if (!seen.has(e.at + '|' + e.by)) { x.edits.push(e); did = true; }
        x.edits.sort((p, q) => (p.at < q.at ? -1 : 1));
        if (m.updatedAt > x.updatedAt) { x.text = m.text; x.updatedAt = m.updatedAt; x.deleted = m.deleted; x.react = m.react || {}; did = true; }
      }
      a.messages.sort((p, q) => (p.at < q.at ? -1 : p.at > q.at ? 1 : p.id < q.id ? -1 : 1));
      const acts = new Set(a.activity.map(x => x.id));
      for (const x of t.activity) if (!acts.has(x.id)) { a.activity.push(x); did = true; }
      a.activity.sort((p, q) => (p.at < q.at ? -1 : p.at > q.at ? 1 : 0));
      if (t.statusAt > a.statusAt) { if (a.status !== t.status) did = true; a.status = t.status; a.statusAt = t.statusAt; }
      if ((t.priorityAt || '') > (a.priorityAt || '')) { if ((a.priority || 'normal') !== (t.priority || 'normal')) did = true; a.priority = t.priority || 'normal'; a.priorityAt = t.priorityAt; }
      if ((t.titleAt || '') > (a.titleAt || '') && t.title && t.title !== a.title) { a.title = t.title; a.titleAt = t.titleAt; did = true; }
      if ((t.dueAt || '') > (a.dueAt || '')) { if ((a.due || '') !== (t.due || '')) did = true; a.due = t.due || ''; a.dueAt = t.dueAt; }
      if (t.tagAt > a.tagAt) { if (a.tag !== t.tag) did = true; a.tag = t.tag; a.tagAt = t.tagAt; }
      if (t.assigneeAt > a.assigneeAt) { if (a.assignee !== t.assignee) did = true; a.assignee = t.assignee; a.assigneeAt = t.assigneeAt; }
      if (t.deletedAt > a.deletedAt) { a.deleted = t.deleted; a.deletedAt = t.deletedAt; did = true; }
      if (t.anchorAt > a.anchorAt) { a.part = t.part; a.also = t.also || []; a.local = t.local; a.world = t.world; a.normal = t.normal; a.cam = t.cam; a.kind = t.kind; a.anchorAt = t.anchorAt; did = true; }
      if ((t.shotsAt || '') > (a.shotsAt || '')) { a.shots = t.shots || []; a.shotCams = t.shotCams || []; a.thumb = a.shots[0] || ''; a.shotsAt = t.shotsAt; did = true; }
      else if (!(a.shots || []).length && (t.shots || []).length) { a.shots = t.shots; a.shotCams = t.shotCams || []; a.thumb = a.shots[0]; did = true; }
      if (did) changed++;
    }
    renumber(items);
    return { items, added, changed };
  }

  // ── the notes as words ────────────────────────────────────────────────────────────────────────────────────
  const pad = (n) => String(n).padStart(2, '0');
  function stamp(t) { const d = new Date(t); if (!Number.isFinite(+d)) return ''; return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function ago(t, nowMs) {
    const d = Date.parse(t); if (!Number.isFinite(d)) return '';
    const s = Math.max(0, Math.round(((nowMs == null ? Date.now() : nowMs) - d) / 1000));
    if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago'; return stamp(t).slice(0, 10);
  }
  const tagLabel = (id) => (TAGS.find(t => t.id === id) || TAGS[0]).label;
  const where = (n) => (n.kind === 'scene' ? 'Whole scene' : n.part && n.part.name ? n.part.name + (n.also && n.also.length ? ' +' + n.also.length : '') : 'a point in the scene');
  function toMarkdown(notes, opts) {
    opts = opts || {};
    const list = live(notes).filter(n => !opts.openOnly || n.status === 'open').sort((a, b) => a.n - b.n);
    const s = stats(notes);
    const rv = opts.reviews ? reviewSummary(opts.reviews) : null;
    let out = '# ' + (opts.title || 'Notes') + '\n\n' + s.total + ' note' + (s.total === 1 ? '' : 's') + ' · ' + s.open + ' open · ' + s.resolved + ' resolved' + (opts.at ? ' · ' + stamp(opts.at) : '') + '\n\n';
    if (rv && rv.state !== 'none') out += '\nReview: ' + (rv.approved.length ? 'approved by ' + rv.approved.join(', ') : '') + (rv.approved.length && rv.changes.length ? ' · ' : '') + (rv.changes.length ? 'changes asked by ' + rv.changes.join(', ') : '') + '\n';
    for (const n of list) {
      out += '## ' + n.n + '. ' + noteTitle(n) + ' · ' + tagLabel(n.tag) + (n.priority && n.priority !== 'normal' ? ' · ' + n.priority + ' priority' : '') + (n.due ? ' · ' + dueLabel(n).toLowerCase() : '') + ' · ' + where(n) + (n.status === 'resolved' ? ' · resolved' : '') + (n.assignee ? ' · for ' + n.assignee : '') + '\n\n';
      for (const m of n.messages) {
        if (m.deleted) { out += '- ~~Message deleted by ' + m.deleted.by + '~~\n'; continue; }
        out += '- **' + m.by + '** (' + stamp(m.at) + '): ' + m.text.replace(/\n+/g, ' ') + (['like', 'dislike', 'done'].map(k => (m.react && m.react[k] ? ' ' + ({ like: '+1', dislike: '-1', done: 'done' })[k] + ' (' + m.react[k].join(', ') + ')' : '')).join('')) + (m.edits.length ? ' _(edited by ' + [...new Set(m.edits.map(e => e.by))].join(', ') + ')_' : '') + '\n';
      }
      out += '\n';
    }
    return out;
  }
  function toText(notes, opts) { return toMarkdown(notes, opts).replace(/[*_#~]/g, ''); }
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // One page that opens in any browser, with no app and nothing to load.
  function toHtml(notes, opts) {
    opts = opts || {};
    const list = live(notes).filter(n => !opts.openOnly || n.status === 'open').sort((a, b) => a.n - b.n);
    const s = stats(notes), col = (id) => (TAGS.find(t => t.id === id) || TAGS[0]).color;
    let body = '';
    for (const n of list) {
      body += '<section class="note' + (n.status === 'resolved' ? ' done' : '') + '"><header><span class="num" style="background:' + col(n.tag) + '">' + n.n + '</span><b>' + esc(tagLabel(n.tag)) + '</b><span>' + esc(where(n)) + '</span>'
        + (n.status === 'resolved' ? '<em>resolved</em>' : '') + (n.assignee ? '<em>for ' + esc(n.assignee) + '</em>' : '') + '</header>';
      if (n.thumb) body += '<img alt="" src="' + n.thumb + '">';
      for (const m of n.messages) {
        if (m.deleted) { body += '<p class="gone">Message deleted by ' + esc(m.deleted.by) + ' · ' + esc(stamp(m.deleted.at)) + '</p>'; continue; }
        body += '<div class="msg"><div class="who"><b>' + esc(m.by) + '</b> ' + esc(stamp(m.at)) + '</div><p>' + esc(m.text).replace(/\n/g, '<br>') + '</p>';
        if (m.edits.length) body += '<div class="ed">Edited by ' + esc([...new Set(m.edits.map(e => e.by))].join(', ')) + ' · last ' + esc(stamp(m.updatedAt)) + '<ul>' + m.edits.map(e => '<li>' + esc(e.by) + ' ' + esc(stamp(e.at)) + ', it said: “' + esc(e.was) + '”</li>').join('') + '</ul></div>';
        body += '</div>';
      }
      body += '<details><summary>History</summary><ul>' + n.activity.map(a => '<li>' + esc(stamp(a.at)) + ' · ' + esc(activityLine(a)) + '</li>').join('') + '</ul></details></section>';
    }
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(opts.title || 'Notes') + '</title><style>'
      + 'body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#1b1b1d;background:#fff}h1{font-size:24px;margin:0 0 4px}.sum{color:#666;margin:0 0 24px}'
      + '.note{border:1px solid #ddd;border-radius:12px;padding:14px 16px;margin:0 0 16px}.note.done{opacity:.65}header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}'
      + '.num{display:inline-grid;place-items:center;min-width:24px;height:24px;border-radius:12px;color:#fff;font-weight:600;font-size:13px}em{font-style:normal;background:#eee;border-radius:10px;padding:1px 8px;font-size:12px}'
      + 'img{max-width:100%;border-radius:8px;margin:4px 0 8px}.msg{margin:8px 0}.who{color:#666;font-size:13px}.msg p{margin:2px 0}.ed{color:#777;font-size:12px}.ed ul,details ul{margin:4px 0;padding-left:18px}.gone{color:#999;font-style:italic}'
      + 'details{margin-top:8px;color:#666;font-size:13px}</style></head><body><h1>' + esc(opts.title || 'Notes') + '</h1><p class="sum">' + s.total + ' note' + (s.total === 1 ? '' : 's') + ' · ' + s.open + ' open · ' + s.resolved + ' resolved'
      + (opts.at ? ' · written ' + esc(stamp(opts.at)) : '') + '</p>' + (body || '<p>No notes.</p>') + '</body></html>';
  }

  // ── the notes inside a scene file that is not open ────────────────────────────────────────────────────────
  // A scene file is a GLB. This reads its JSON part and finds the node the app writes its state on (named `key`, with the state in its
  // extras under the same name). Used to bring the notes of another copy of a scene into this one without opening it.
  function fromGlb(buf, key) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length < 20) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint32(0, true) !== 0x46546C67) return null;                 // "glTF"
    const len0 = dv.getUint32(12, true), type0 = dv.getUint32(16, true);
    if (type0 !== 0x4E4F534A || 20 + len0 > u8.length) return null;       // "JSON"
    let json;
    try { json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + len0))); } catch (_) { return null; }
    for (const n of json.nodes || []) {
      const st = n && n.extras && n.extras[key];
      if (st && typeof st === 'object') return st;
    }
    return null;
  }

  const API = {
    VERSION, TAGS, LIMITS, newId,
    PRIORITIES, REVIEW_STATES, setDue, dueState, dueLabel, todayStr, setPriority, setReview, reviewSummary, mergeReviews, mentions, cleanReviews,
    cleanShots, addShot, removeShot, cleanAlso, setAlso, setTitle, setDesc, noteTitle, create, find, msgOf, reply, react, edit, removeMessage, restoreMessage, setStatus, setTag, assign, moveAnchor, removeNote, restoreNote,
    live, stats, authors, lastChange, lastOthers, unread, activityLine, tagLabel, where,
    parse, serialize, merge, renumber, fromGlb,
    stamp, ago, toMarkdown, toText, toHtml, name,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.MONotes = API;
})(typeof window !== 'undefined' ? window : globalThis);
