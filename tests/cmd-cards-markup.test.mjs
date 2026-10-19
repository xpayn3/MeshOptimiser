// The floating command cards (index.html, .section-cmd[data-cmd]) must be well formed: a card that closes too early lets its footer
// ("Esc Cancel / <button>") fall out of the card, and that footer then shows under every card that is opened. This reads index.html,
// walks the <div> depth of each card and checks that the card's own footer is inside it and that nothing but whitespace follows
// the footer before the card closes.
// Run: node tests/cmd-cards-markup.test.mjs [path to an index.html]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.argv[2] || join(here, '..', 'app', 'index.html'), 'utf8');   // (an optional path: the test is checked against a broken copy)

let fails = 0;
const fail = (msg) => { fails++; console.error('FAIL ' + msg); };

const starts = [...html.matchAll(/<div class="section section-cmd[^"]*"[^>]*data-cmd="([^"]+)"[^>]*>/g)];
if (starts.length < 20) fail(`found only ${starts.length} command cards`);

// the index of the </div> that closes the <div> opened at `from` (depth counting over <div ...> and </div>)
function closeOf(from) {
  const re = /<div[\s>]|<\/div>/g; re.lastIndex = from;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) { depth--; if (depth === 0) return m.index; }
    else depth++;
  }
  return -1;
}

for (const s of starts) {
  const name = s[1], open = s.index, close = closeOf(open);
  if (close < 0) { fail(`card "${name}" never closes`); continue; }
  const body = html.slice(open, close);
  const footAt = body.lastIndexOf('<div class="cmd-foot"');
  if (footAt < 0) continue;                         // (a card without a footer is allowed: Draw, UV layout, Edit mesh)
  // the footer is a direct child of the card: the divs between its end and the card's end are balanced to zero
  const footClose = closeOf(open + footAt);
  const rest = html.slice(footClose + '</div>'.length, close);
  if (rest.trim() !== '') fail(`card "${name}": something follows its footer inside the card: ${rest.trim().slice(0, 60)}`);
  // and the card's own end is the one right after the footer, i.e. the footer is at depth 1 of the card
  const before = body.slice(0, footAt);
  const opens = (before.match(/<div[\s>]/g) || []).length, closes = (before.match(/<\/div>/g) || []).length;
  if (opens - closes !== 1) fail(`card "${name}": its footer is not a direct child of the card (depth ${opens - closes})`);
}

// no footer outside a card
const all = [...html.matchAll(/<div class="cmd-foot"/g)].map(m => m.index);
for (const at of all) {
  const inside = starts.some(s => { const c = closeOf(s.index); return at > s.index && at < c; });
  if (!inside) fail(`a cmd-foot at offset ${at} is outside every command card`);
}

// a stray line that is only a "+" (a patch script that went wrong once)
if (/^\s*\+\s*$/m.test(html)) fail('index.html has a line that is only a "+"');

if (fails) { console.error(`${fails} failure(s)`); process.exit(1); }
console.log(`ok: ${starts.length} command cards are well formed, ${all.length} footers all inside their cards`);
