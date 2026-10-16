// node tests/notes-exchange.test.mjs — notes for several parts, and notes-exchange.js: CSV, JSON, BCF (a zip of XML), taken out and brought back in.
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const N = req('../app/js/notes-core.js'), X = req('../app/js/notes-exchange.js');

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const T = (m) => '2026-10-15T10:' + String(m).padStart(2, '0') + ':00.000Z';

// notes for several parts
{
  const notes = [];
  const n = N.create(notes, { by: 'Ana', text: 'These three fit badly', kind: 'part', part: { uid: 'u1', name: 'Bolt' }, also: [{ uid: 'u2', name: 'Nut' }, { uid: 'u1', name: 'Bolt' }, { uid: 'u3', name: 'Plate' }, { nope: 1 }], now: T(0) });
  ok(n.also.length === 2 && n.also[0].name === 'Nut' && n.also[1].name === 'Plate', 'a note keeps its other parts, without the main one twice or empty ones');
  ok(N.where(n) === 'Bolt +2', 'it says which part and how many more');
  N.setAlso(n, 'Bo', [{ uid: 'u5', name: 'Washer' }], T(1));
  ok(n.also.length === 1 && n.activity.some(a => a.type === 'attached' && /set the other parts/.test(N.activityLine(a))), 'the other parts can be changed, and the history says so');
  const back = N.parse(JSON.parse(JSON.stringify(N.serialize(notes, {}))));
  ok(back.items[0].also.length === 1 && back.items[0].also[0].name === 'Washer', 'they survive a file');
  const copy = JSON.parse(JSON.stringify(notes)); copy[0].also = [{ uid: 'u9', name: 'Pin' }]; copy[0].anchorAt = T(30);
  ok(N.merge(notes, copy).items[0].also[0].name === 'Pin', 'a later change of the parts wins when two copies join');
}

// a set of notes to take out
const notes = [];
const a = N.create(notes, { by: 'Ana', text: 'Check, this "bolt" is loose', kind: 'part', part: { uid: 'u1', name: 'Bolt M8' }, also: [{ uid: 'u2', name: 'Nut' }], world: [1, 2, 3], cam: { pos: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0], fov: 45 }, tag: 'issue', now: T(0) });
N.reply(a, 'Bo', 'Agree <&> thanks', T(1)); N.setPriority(a, 'Bo', 'urgent', T(2)); N.setDue(a, 'Bo', '2026-12-01', T(3)); N.assign(a, 'Bo', 'Cy', T(4)); N.setStatus(a, 'Bo', 'resolved', T(5));
const b = N.create(notes, { by: 'Ana', text: '=HYPERLINK("http://x")', kind: 'scene', tag: 'idea', now: T(6) });

// CSV
{
  const csv = X.toCsv(notes);
  const rows = csv.replace(/^﻿/, '').trim().split('\r\n');
  ok(csv.startsWith('﻿') && rows.length === 3 && rows[0].startsWith('Number,Title,Kind,Status'), 'CSV: a header and a row for each note, with the mark Excel needs for UTF-8');
  ok(/"Check, this ""bolt"" is loose"/.test(csv), 'CSV: commas and quotes are quoted');
  ok(/,Resolved,urgent,2026-12-01,Cy,Bolt M8,Nut,/.test(csv), 'CSV: status, priority, due date, assignee and parts');
  ok(rows[2].includes("'=HYPERLINK"), 'CSV: a cell that starts with = is kept as text, not a formula');
}

// JSON
{
  const js = X.toJson(notes, { Ana: { state: 'approved', at: T(9), text: '' } }, { title: 'Gearbox', at: T(10) });
  const j = X.fromJson(js);
  ok(j && j.items.length === 2 && j.reviews.Ana.state === 'approved' && j.items[0].messages.length === 2, 'JSON: everything comes back, with the sign-offs');
  ok(X.fromJson('{"nothing": 1}') === null && X.fromJson('not json') === null, 'JSON: a file that is not notes gives nothing');
  ok(X.fromJson(JSON.stringify(N.serialize(notes, {}))).items.length === 2, 'JSON: a bare payload is taken too');
}

// zip
{
  const z = X.zipStore([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3, 250]) }]);
  const f = await X.unzip(z);
  ok(f && new TextDecoder().decode(f['a.txt']) === 'hello' && f['dir/b.bin'].join() === '1,2,3,250', 'zip: files go in and come out the same');
  ok(X.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926, 'zip: the checksum is the standard one');
  ok(await X.unzip(new TextEncoder().encode('this is not a zip file at all, only text')) === null, 'zip: a file that is not a zip gives nothing');
  const evil = X.zipStore([{ name: '../evil.txt', data: 'x' }, { name: 'ok.txt', data: 'y' }]);
  const g = await X.unzip(evil);
  ok(g && !g['../evil.txt'] && g['ok.txt'], 'zip: a name with .. is left out');
  let threw = false; try { await X.unzip(X.zipStore([{ name: 'big.bin', data: new Uint8Array(4000) }]), 1000); } catch (_) { threw = true; }
  ok(threw, 'zip: a file that says it holds more than the limit is refused');
}

// BCF
{
  const z = X.toBcf(notes, { title: 'Gearbox' });
  const f = await X.unzip(z); const names = Object.keys(f);
  ok(names.includes('bcf.version') && names.some(n => /markup\.bcf$/.test(n)) && names.filter(n => /viewpoint\.bcfv$/.test(n)).length === 1, 'BCF: version file, one markup for each note, a viewpoint where there is a view');
  ok(/VersionId="2\.1"/.test(new TextDecoder().decode(f['bcf.version'])), 'BCF: version 2.1');
  const mk = new TextDecoder().decode(f[names.find(n => /markup\.bcf$/.test(n))]);
  ok(/&amp;/.test(mk) && !/<&>/.test(mk) && /TopicStatus="Closed"/.test(mk) && /<Priority>Critical<\/Priority>/.test(mk) && /<DueDate>2026-12-01T00:00:00Z<\/DueDate>/.test(mk), 'BCF: text is escaped, status closed, priority critical, due date');
  const back = await X.fromBcf(z, notes);
  const r = back.items.find(n => n.id === a.id);
  ok(back.items.length === 2 && r, 'BCF: our own file brings back the same notes (by their ids)');
  ok(r.status === 'resolved' && r.priority === 'urgent' && r.due === '2026-12-01' && r.assignee === 'Cy' && r.tag === 'issue' && r.messages.length === 2 && r.messages[1].by === 'Bo', 'BCF: status, priority, due date, assignee, kind and the conversation');
  ok(r.cam && Math.abs(r.cam.pos[0] - 1) < 1e-6 && Math.abs(r.cam.pos[1] - 2) < 1e-6 && Math.abs(r.cam.pos[2] - 3) < 1e-6 && Math.abs(r.cam.up[1] - 1) < 1e-6, 'BCF: the view is turned to Z up on the way out and back to Y up on the way in');
  const m = N.merge(notes, back.items);
  ok(m.added === 0 && m.changed === 0 && m.items.length === 2 && m.items[0].messages.length === 2, 'BCF: bringing our own file back in changes nothing and doubles nothing');
  const fresh = await X.fromBcf(z, []);
  ok(fresh.items.find(n => n.id === a.id) && fresh.items.length === 2, 'BCF: into an empty scene the notes come in with their ids');
  ok(await X.fromBcf(new TextEncoder().encode('not a zip file, just words ..........'), []) === null, 'BCF: a file that is not a zip gives nothing');
  // a topic made in another tool, changed later there
  const other = X.zipStore([
    { name: 'bcf.version', data: '<Version VersionId="2.0"/>' },
    { name: 'aaaaaaaa-0000-4000-8000-000000000001/markup.bcf', data: '<Markup><Topic Guid="aaaaaaaa-0000-4000-8000-000000000001" TopicType="Clash" TopicStatus="Closed"><Title>Pipe through beam</Title><Priority>Major</Priority><CreationDate>2026-10-01T08:00:00Z</CreationDate><CreationAuthor>Lena</CreationAuthor><ModifiedDate>2026-10-02T08:00:00Z</ModifiedDate><AssignedTo>Marko</AssignedTo><Description>It cuts the beam &lt;here&gt;</Description></Topic><Comment Guid="aaaaaaaa-0000-4000-8000-0000000000c1"><Date>2026-10-01T09:00:00Z</Date><Author>Marko</Author><Comment>On it</Comment></Comment></Markup>' },
  ]);
  const o = await X.fromBcf(other, []); const t = o.items[0];
  ok(o.items.length === 1 && t.tag === 'issue' && t.status === 'resolved' && t.priority === 'high' && t.assignee === 'Marko' && t.created.by === 'Lena' && t.messages.length === 2 && t.messages[0].text === 'It cuts the beam <here>' && t.messages[1].text === 'On it', 'BCF: a topic from another tool comes in as a note, with its comment');
  const mine = N.create([], { by: 'Lena', text: 'x', now: T(0) }); void mine;
  // the other tool closed it later than we changed it: its change wins; an older one does not
  const local = []; const l = N.create(local, { by: 'Lena', text: 'It cuts the beam <here>', now: '2026-10-01T08:00:00.000Z' }); l.id = t.id; l.messages[0].id = t.messages[0].id; l.created.at = '2026-10-01T08:00:00Z'; l.messages[0].at = '2026-10-01T08:00:00Z'; l.messages[0].by = 'Lena';
  const mj = N.merge(local, o.items); ok(mj.items[0].status === 'resolved' && mj.items[0].assignee === 'Marko', 'BCF: a later change in the other tool is taken in');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
