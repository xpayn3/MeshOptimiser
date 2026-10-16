// node tests/notes.test.mjs — notes-core.js: making and changing notes, who did what, reading a file from anyone, joining two copies,
// and the notes as Markdown / text / an HTML page.
import { createRequire } from 'node:module';
const N = createRequire(import.meta.url)('../app/js/notes-core.js');

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const throws = (f) => { try { f(); return false; } catch (_) { return true; } };
const T = (m) => '2026-10-15T10:' + String(m).padStart(2, '0') + ':00.000Z';

// a name is needed for everything a person does
{
  const notes = [];
  ok(throws(() => N.create(notes, { by: '', text: 'hello' })), 'a note needs a name');
  ok(throws(() => N.create(notes, { by: '   ', text: 'hello' })), 'a name of spaces is no name');
  ok(throws(() => N.create(notes, { by: 'Ana', text: '   ' })), 'a note needs text');
  const n = N.create(notes, { by: 'Ana', text: 'Is this bolt needed?', kind: 'pin', part: { uid: 'u1', name: 'Bolt M8' }, local: [1, 2, 3], world: [4, 5, 6], normal: [0, 0, 1], tag: 'question', now: T(0) });
  ok(notes.length === 1 && n.n === 1 && n.status === 'open' && n.tag === 'question', 'a note is made, number 1, open, tagged');
  ok(n.messages.length === 1 && n.messages[0].by === 'Ana' && n.messages[0].text === 'Is this bolt needed?', 'its first message is the note text, by Ana');
  ok(n.created.by === 'Ana' && n.activity[0].type === 'created', 'who made it is kept');
  ok(throws(() => N.reply(n, '', 'x')), 'a reply needs a name');
  const m2 = N.reply(n, 'Ben', 'Yes, it holds the cover.', T(1));
  ok(n.messages.length === 2 && m2.by === 'Ben', 'a reply by Ben');
  // editing: anyone can, and the old text and who changed it are kept
  N.edit(n, m2.id, 'Cleo', 'Yes, it holds the cover on.', T(2));
  ok(m2.text === 'Yes, it holds the cover on.' && m2.edits.length === 1 && m2.edits[0].by === 'Cleo' && m2.edits[0].was === 'Yes, it holds the cover.', 'an edit by Cleo keeps what Ben wrote');
  ok(N.activityLine(n.activity[n.activity.length - 1]) === 'Cleo edited Ben’s message', 'the history says Cleo edited Ben’s message');
  N.edit(n, m2.id, 'Cleo', 'Yes, it holds the cover on.', T(3));
  ok(m2.edits.length === 1, 'an edit that changes nothing is not an edit');
  ok(throws(() => N.edit(n, m2.id, 'Cleo', '  ', T(3))), 'a message cannot be edited to nothing');
  // deleting a message leaves a mark
  N.removeMessage(n, m2.id, 'Ana', T(4));
  ok(m2.deleted && m2.deleted.by === 'Ana' && m2.text.length > 0, 'a deleted message says who deleted it and keeps its text');
  ok(throws(() => N.edit(n, m2.id, 'Ana', 'again', T(5))), 'a deleted message cannot be edited');
  N.restoreMessage(n, m2.id, 'Ana', T(5));
  ok(!m2.deleted, 'a deleted message can come back');
  // status, tag, assignee
  N.setStatus(n, 'Ben', 'resolved', T(6));
  ok(n.status === 'resolved' && n.statusAt === T(6), 'resolved by Ben');
  const acts = n.activity.length; N.setStatus(n, 'Ben', 'resolved', T(7));
  ok(n.activity.length === acts, 'resolving a resolved note changes nothing');
  N.setStatus(n, 'Ana', 'open', T(8));
  ok(n.status === 'open' && N.activityLine(n.activity[n.activity.length - 1]) === 'Ana reopened it', 'reopened by Ana');
  N.setTag(n, 'Ana', 'issue', T(9)); ok(n.tag === 'issue', 'the tag changes');
  N.setTag(n, 'Ana', 'nonsense', T(10)); ok(n.tag === 'info', 'a tag that does not exist becomes Info');
  N.assign(n, 'Ana', 'Ben', T(11)); ok(n.assignee === 'Ben', 'assigned to Ben');
  N.assign(n, 'Ana', '', T(12)); ok(n.assignee === '', 'taken off again');
  N.moveAnchor(n, 'Ben', { local: [9, 9, 9], world: [8, 8, 8] }, T(13)); ok(n.local[0] === 9 && n.anchorAt === T(13), 'the pin moves');
  N.removeNote(n, 'Cleo', T(14)); ok(n.deleted && n.deleted.by === 'Cleo', 'a note is deleted with a name');
  const s = N.stats(notes); ok(s.total === 0 && s.deleted === 1, 'a deleted note is not counted');
  N.restoreNote(n, 'Cleo', T(15)); ok(!n.deleted && N.stats(notes).total === 1, 'and comes back');
  ok(N.authors(notes).join() === 'Ana,Ben,Cleo', 'the people in the notes');
  const n2 = N.create(notes, { by: 'Ben', text: 'second', kind: 'scene', now: T(16) });
  ok(n2.n === 2, 'the next note is number 2');
}

// reading a file: nothing it holds can break the app
{
  ok(N.parse(null).items.length === 0 && N.parse('x').items.length === 0 && N.parse({ items: 'no' }).items.length === 0, 'junk in, no notes');
  const huge = 'x'.repeat(100000);
  const p = N.parse({ v: 1, items: [
    { id: 'a', n: 1, messages: [{ id: 'm', by: 'A'.repeat(500), at: 'not a date', text: huge }], created: { by: 'Ana', at: T(1) }, tag: 'evil', status: 'weird', local: [1, 2, 'x'], thumb: 'javascript:alert(1)' },
    { id: 'a', n: 2, messages: [{ by: 'Dup', text: 'same id' }] },
    { id: 'b', n: 1, messages: [] },
    { id: 'c', messages: [{ by: 'Ben', text: 'ok', at: T(2) }], created: { by: 'Ben', at: T(2) }, thumb: 'data:image/jpeg;base64,/9j/4AAQ' },
    null, 5, 'str',
  ], seen: { Ana: T(3), '': T(4), Bad: 'nope' } });
  ok(p.items.length === 2, 'a note without messages, a repeated id and junk are dropped');
  const a = p.items[0];
  ok(a.messages[0].text.length <= N.LIMITS.text && a.messages[0].by.length <= N.LIMITS.name, 'text and names are cut to size');
  ok(a.tag === 'info' && a.status === 'open' && a.local === null && a.thumb === '', 'a wrong tag, status, point or picture is put right');
  ok(!Number.isNaN(Date.parse(a.messages[0].at)), 'a bad date becomes a date');
  ok(p.items[1].thumb.startsWith('data:image/jpeg'), 'a real picture is kept');
  ok(new Set(p.items.map(n => n.n)).size === 2, 'the numbers are told apart');
  ok(Object.keys(p.seen).join() === 'Ana', 'the seen list keeps only good entries');
  // round trip
  const notes = []; const n = N.create(notes, { by: 'Ana', text: 'round', kind: 'pin', world: [1, 2, 3], cam: { pos: [1, 1, 1], target: [0, 0, 0] }, now: T(1) });
  N.reply(n, 'Ben', 'back', T(2));
  const back = N.parse(JSON.parse(JSON.stringify(N.serialize(notes, { Ana: T(5) }))));
  ok(back.items.length === 1 && back.items[0].messages.length === 2 && back.items[0].cam.pos[0] === 1 && back.seen.Ana === T(5), 'notes survive being written and read');
}

// two copies of the same notes
{
  const base = []; const n = N.create(base, { by: 'Ana', text: 'start', now: T(0) });
  const A = JSON.parse(JSON.stringify(base)), B = JSON.parse(JSON.stringify(base));
  N.reply(A[0], 'Ana', 'from A', T(5)); N.setStatus(A[0], 'Ana', 'resolved', T(6));
  N.reply(B[0], 'Ben', 'from B', T(7)); N.setStatus(B[0], 'Ben', 'resolved', T(8)); N.setStatus(B[0], 'Ben', 'open', T(9));
  N.edit(B[0], B[0].messages[0].id, 'Ben', 'start (clarified)', T(10));
  const x = N.create(B, { by: 'Ben', text: 'new in B', now: T(11) });
  const r = N.merge(A, B);
  ok(r.items.length === 2 && r.added === 1 && r.changed === 1, 'merge adds the new note and joins the changed one');
  const m = r.items.find(i => i.id === n.id);
  ok(m.messages.length === 3 && m.messages.map(q => q.text).includes('from A') && m.messages.map(q => q.text).includes('from B'), 'both replies are kept');
  ok(m.messages[0].text === 'start (clarified)' && m.messages[0].edits.length === 1 && m.messages[0].edits[0].by === 'Ben', 'the later edit wins and keeps who made it');
  ok(m.status === 'open', 'the later status change wins (Ben reopened it after Ana resolved it)');
  ok(m.activity.length === new Set(m.activity.map(a => a.id)).size && m.activity.length >= 6, 'the history of both is joined once');
  const again = N.merge(r.items, B);
  ok(again.added === 0 && again.changed === 0, 'merging the same notes again changes nothing');
  // numbers
  const C = [], D = [];
  N.create(C, { by: 'Ana', text: 'c', now: T(1) }); N.create(D, { by: 'Ben', text: 'd', now: T(2) });
  const j = N.merge(C, D);
  ok(j.items.length === 2 && new Set(j.items.map(q => q.n)).size === 2 && j.items.find(q => q.messages[0].text === 'c').n === 1, 'two notes that were both number 1: the earlier keeps it, the later gets the next');
}

// unread: what somebody else changed since I last looked
{
  const notes = []; const n = N.create(notes, { by: 'Ana', text: 'q', now: T(0) });
  ok(!N.unread(n, 'Ana', ''), 'my own note is not new to me');
  N.reply(n, 'Ben', 'answer', T(5));
  ok(N.unread(n, 'Ana', ''), 'Ben’s reply is new to Ana');
  ok(N.unread(n, 'Ana', T(3)) && !N.unread(n, 'Ana', T(6)), 'new only since she last looked');
  ok(!N.unread(n, 'Ben', T(1)), 'not new to Ben');
  ok(!N.unread(n, '', ''), 'without a name nothing is new');
}

// words
{
  const notes = []; const n = N.create(notes, { by: 'Ana', text: 'Is <b>this</b> needed?', kind: 'pin', part: { uid: 'u', name: 'Bolt <M8>' }, tag: 'question', thumb: 'data:image/jpeg;base64,AAAA', now: T(0) });
  N.reply(n, 'Ben', 'Yes', T(1)); N.edit(n, n.messages[1].id, 'Cleo', 'Yes, it is', T(2));
  const md = N.toMarkdown(notes, { title: 'Review' });
  ok(md.includes('# Review') && md.includes('1 note · 1 open') && md.includes('**Ben**') && md.includes('edited by Cleo'), 'Markdown names who edited');
  const html = N.toHtml(notes, { title: 'Review' });
  ok(html.startsWith('<!DOCTYPE html>') && !html.includes('<b>this</b>') && html.includes('&lt;b&gt;this&lt;/b&gt;') && html.includes('Bolt &lt;M8&gt;'), 'the page escapes what people wrote');
  ok(html.includes('Cleo') && html.includes('it said: “Yes”') && html.includes('data:image/jpeg;base64,AAAA'), 'the page shows who edited, what it said before, and the picture');
  ok(N.toText(notes).includes('Cleo'), 'text too');
  ok(N.toMarkdown(notes, { openOnly: true }).includes('Ana') && !N.toMarkdown((N.setStatus(n, 'Ana', 'resolved', T(3)), notes), { openOnly: true }).includes('Bolt'), 'only the open notes when asked');
}

// a scene file that is not open
{
  const KEY = '__stepOptimizerSceneState__';
  const notes = []; N.create(notes, { by: 'Ana', text: 'in a file', now: T(0) });
  const json = JSON.stringify({ asset: { version: '2.0' }, nodes: [{ name: 'a' }, { name: KEY, extras: { [KEY]: { app: 'step-optimizer', notes: N.serialize(notes, {}) } } }] });
  let jb = new TextEncoder().encode(json); const pad4 = (4 - jb.length % 4) % 4; if (pad4) { const t = new Uint8Array(jb.length + pad4).fill(0x20); t.set(jb); jb = t; }
  const buf = new ArrayBuffer(20 + jb.length); const dv = new DataView(buf);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, 20 + jb.length, true); dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4E4F534A, true); new Uint8Array(buf).set(jb, 20);
  const st = N.fromGlb(buf, KEY);
  ok(st && st.app === 'step-optimizer' && N.parse(st.notes).items[0].messages[0].text === 'in a file', 'the notes are read out of a GLB without opening it');
  ok(N.fromGlb(new ArrayBuffer(8), KEY) === null && N.fromGlb(new TextEncoder().encode('not a glb file at all, just text'), KEY) === null, 'a file that is not a GLB gives nothing');
}

// priority, replies to a message, reactions, sign-offs and mentions
{
  const notes = []; const n = N.create(notes, { by: 'Ana', text: 'first', now: T(0) });
  ok(n.priority === 'normal', 'a note starts at normal priority');
  N.setPriority(n, 'Bo', 'urgent', T(1));
  ok(n.priority === 'urgent' && n.activity.some(a => a.type === 'priority' && /urgent/.test(N.activityLine(a))), 'priority is set, and the history says who');
  const r = N.reply(n, 'Bo', 'answer', T(2), n.messages[0].id);
  ok(r.to === n.messages[0].id, 'a reply can answer one message');
  N.react(n, n.messages[0].id, 'Bo', 'like', T(3)); N.react(n, n.messages[0].id, 'Bo', 'dislike', T(4));
  ok(!n.messages[0].react.like && n.messages[0].react.dislike.length === 1, 'a thumb down takes the thumb up away');
  N.react(n, n.messages[0].id, 'Bo', 'dislike', T(5));
  ok(!n.messages[0].react.dislike, 'pressed again, a reaction goes');
  const rv = {}; N.setReview(rv, 'Ana', 'approved', '', T(6)); N.setReview(rv, 'Bo', 'changes', '', T(7));
  ok(N.reviewSummary(rv).state === 'changes' && N.reviewSummary(rv).approved[0] === 'Ana', 'one asking for changes outweighs an approval');
  const back = N.parse(JSON.parse(JSON.stringify(N.serialize(notes, {}, rv))));
  ok(back.items[0].priority === 'urgent' && back.items[0].messages[1].to === n.messages[0].id && back.reviews.Ana.state === 'approved', 'priority, replies and sign-offs survive a file');
  ok(N.parse({ items: [], reviews: { x: { state: 'hacked' } } }).reviews.x === undefined, 'a sign-off that is not one is dropped');
  N.setReview(rv, 'Bo', 'changes', '', T(8));
  ok(!rv.Bo, 'the same sign-off again takes it back');
  ok(N.mentions('thanks @Ana Kovac, and @Bo!', ['Ana Kovac', 'Bo', 'Cy']).join() === 'Ana Kovac,Bo', 'who is mentioned with @');
  ok(/Review: approved by Ana/.test(N.toMarkdown(notes, { reviews: rv })), 'the sign-offs are in the Markdown');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
