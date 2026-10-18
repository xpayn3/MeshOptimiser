#!/usr/bin/env node
// node tools/app/precommit.cjs        (run by .git/hooks/pre-commit; install the hook with: node tools/app/precommit.cjs --install)
//
// Before a commit, on what is staged:
//   1. every staged JS module parses (node --check on the staged content), every staged .py compiles, every staged .json parses;
//   2. no staged text file gains NUL bytes or U+FFFD over HEAD (a lossy write);
//   3. when app/, tests/ or tools/ code is staged: every unit test (tests/*.test.mjs, *.test.cjs, about 25 s) passes;
//   4. the fix log is checked (.claude/skills/mo-log/scripts/check-log.cjs, when present): its problems are printed, not blocking,
//      because older entries by other sessions may carry them.
// Exit 1 stops the commit. The browser tests are not run here (minutes each): the mo-e2e skill runs them.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });

if (process.argv.includes('--install')) {
  const hook = path.join(ROOT, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\n# MeshOptimiser: checks before a commit (tools/app/precommit.cjs)\nexec node "$(git rev-parse --show-toplevel)/tools/app/precommit.cjs"\n');
  try { fs.chmodSync(hook, 0o755); } catch (_) {}
  console.log('installed ' + hook);
  process.exit(0);
}

const t0 = Date.now();
const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean);
if (!staged.length) process.exit(0);
const problems = [];
const LATIN1 = new Set(['tests/holefill.test.mjs']);
const stagedText = (f) => execFileSync('git', ['show', ':' + f], { cwd: ROOT, encoding: LATIN1.has(f) ? 'latin1' : 'utf8', maxBuffer: 1 << 28 });
const headText = (f) => { try { return execFileSync('git', ['show', 'HEAD:' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { return ''; } };
const count = (s, re) => (s.match(re) || []).length;

let checked = 0;
for (const f of staged) {
  if (!/\.(m?js|cjs|html|css|py|md|json|txt)$/i.test(f) || /^app\/vendor\//.test(f)) continue;
  let text; try { text = stagedText(f); } catch (_) { continue; }
  checked++;
  const n = count(text, /\u0000/g), b = count(text, new RegExp(String.fromCharCode(0xfffd), 'g'));
  if (n || b) { const h = headText(f); if (n > count(h, /\u0000/g) || b > count(h, new RegExp(String.fromCharCode(0xfffd), 'g'))) problems.push(`${f}: gains NUL or U+FFFD characters (a lossy write)`); }
  if (/\.(m?js|cjs)$/i.test(f)) {
    const isModule = /\.mjs$/i.test(f) || (!/\.cjs$/i.test(f) && /^\s*(import|export)\s/m.test(text));
    const r = spawnSync(process.execPath, isModule ? ['--input-type=module', '--check'] : ['--check', '-'], { input: text, encoding: 'utf8' });
    if (r.status !== 0) problems.push(`${f}: does not parse: ${String(r.stderr).split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | ')}`);
  }
  if (/\.json$/i.test(f)) { try { JSON.parse(text); } catch (e) { problems.push(`${f}: not valid JSON (${e.message})`); } }
  if (/\.py$/i.test(f)) {
    const r = spawnSync(process.env.PYTHON || 'python', ['-c', 'import sys,ast; ast.parse(sys.stdin.read())'], { input: text, encoding: 'utf8' });
    if (r.status !== 0 && !r.error) problems.push(`${f}: does not compile: ${String(r.stderr).split(/\r?\n/).filter(Boolean).slice(-1)[0] || ''}`);
  }
}
console.log(`pre-commit: ${staged.length} staged, ${checked} checked for syntax and lossy writes`);

// unit tests, when code is staged
if (staged.some(f => /^(app|tests|tools)\/.*\.(m?js|cjs|py|html)$/i.test(f)) && !problems.length) {
  const tests = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => /\.test\.(mjs|cjs)$/.test(f)).sort();
  const failed = [];
  for (const t of tests) {
    const r = spawnSync(process.execPath, [path.join('tests', t)], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) failed.push(`${t}: ${String((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).filter(l => /FAIL|Error|error/.test(l)).slice(0, 3).join(' | ') || 'exit ' + r.status}`);
  }
  console.log(`pre-commit: ${tests.length - failed.length} of ${tests.length} unit tests pass`);
  for (const f of failed) problems.push('unit test ' + f);
}

// the fix log (advice only)
const checker = path.join(ROOT, '.claude', 'skills', 'mo-log', 'scripts', 'check-log.cjs');
if (staged.includes('UNRELEASED_FIXES.md') && fs.existsSync(checker)) {
  const r = spawnSync(process.execPath, [checker], { cwd: ROOT, encoding: 'utf8' });
  const lines = String(r.stdout).split(/\r?\n/).filter(l => /problem|^\s+\d+:/.test(l) && !/warning/.test(l));
  if (r.status !== 0) console.log('pre-commit: the fix log has problems (not blocking):\n' + lines.slice(0, 6).join('\n'));
}

if (problems.length) {
  console.error('\npre-commit: COMMIT STOPPED\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`pre-commit: ok (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
