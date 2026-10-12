// node tools/build-knowledge.mjs <path to docs-content.js>
//
// The help articles of the website (apps/meshoptimiser/docs-content.js in the website repo: the knowledge base of the app, one
// article per tool and job) turned into plain Markdown in knowledge/docs/, with an index. serve.py hands these to Claude over MCP:
// as resources (meshoptimiser://docs/<slug>) and through the search_docs and read_doc tools, so an agent has what a person who has
// read the docs knows. The hand-written playbooks (what to do in which order, what is safe) are in knowledge/playbooks/.
// Run again after the docs change, and commit knowledge/.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const src = process.argv[2];
if (!src) { console.log('usage: node tools/build-knowledge.mjs <path to docs-content.js>'); process.exit(2); }
const docs = createRequire(import.meta.url)(path.resolve(src));
const OUT = path.resolve('knowledge/docs');
// what an agent needs: how to read, clean up, simplify, check and export a model. Not how to install the app.
const SKIP_GROUPS = new Set(['install', 'claude']);
const SKIP = new Set(['requirements', 'download', 'first-start', 'install-as-app', 'stop-restart-update', 'command-line', 'files-in-folder', 'self-test', 'help-window', 'settings-appearance']);
const link = (slug) => 'meshoptimiser://docs/' + slug;
const md = (t) => String(t)
  .replace(/\[\[([^\]]+)\]\]/g, (_, k) => '`' + k + '`')
  .replace(/\{\{([^}]+)\}\}/g, '**$1**')
  .replace(/\[([^\]]+)\]\(#([a-z0-9-]+)\)/g, (_, w, s) => `[${w}](${link(s)})`);
const block = ([type, a, b]) => {
  if (type === 'p') return md(a);
  if (type === 'h') return '## ' + md(a);
  if (type === 'steps') return a.map((x, i) => `${i + 1}. ${md(x)}`).join('\n');
  if (type === 'list') return a.map(x => `- ${md(x)}`).join('\n');
  if (type === 'terms') return a.map(([t, d]) => `- **${md(t)}**: ${md(d)}`).join('\n');
  if (type === 'keys') return a.map(([k, d]) => `- \`${k}\`: ${md(d)}`).join('\n');
  if (type === 'code') return '```\n' + a + '\n```';
  if (type === 'note') return '> ' + md(a);
  if (type === 'img') return '';
  if (type === 'see') return 'Related: ' + a.map(s => `[${s}](${link(s)})`).join(', ');
  return '';
};
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.md')) fs.unlinkSync(path.join(OUT, f));
const group = Object.fromEntries(docs.groups.map(g => [g.id, g.title]));
const index = [];
for (const a of docs.articles) {
  if (SKIP_GROUPS.has(a.group) || SKIP.has(a.slug)) continue;
  const body = a.blocks.map(block).filter(Boolean).join('\n\n');
  const known = new Set(docs.articles.map(x => x.slug));
  const text = `# ${a.title}\n\n${md(a.summary)}\n\n${body}\n`.replace(/\(meshoptimiser:\/\/docs\/([a-z0-9-]+)\)/g, (m, s) => known.has(s) && !SKIP.has(s) && !SKIP_GROUPS.has(docs.articles.find(x => x.slug === s).group) ? m : '(not in this knowledge base)');
  fs.writeFileSync(path.join(OUT, a.slug + '.md'), text);
  index.push({ slug: a.slug, title: a.title, group: a.group, groupTitle: group[a.group], summary: md(a.summary), chars: text.length });
}
fs.writeFileSync(path.resolve('knowledge/index.json'), JSON.stringify(index, null, 1));
console.log(`Wrote ${index.length} articles (${index.reduce((n, a) => n + a.chars, 0)} characters) to knowledge/docs/`);
