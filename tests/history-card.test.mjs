// node tests/history-card.test.mjs
// The words of the History card (app/js/history-card.js): what a step is called, how many parts it says it touched, how old it is.
import { stepLabel, stepMeta, ago } from '../app/js/history-card.js';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

check('a step with a label is called by it', stepLabel({ type: 'decimate', label: 'Reduce 40%' }) === 'Reduce 40%');
check('a blank label falls back to the kind', stepLabel({ type: 'decimate', label: '  ' }) === 'Reduce triangles');
check('known kinds read as plain words', stepLabel({ type: 'delete' }) === 'Delete' && stepLabel({ type: 'vis' }) === 'Show or hide' && stepLabel({ type: 'hierUngroup' }) === 'Ungroup');
check('an unknown kind is split into words', stepLabel({ type: 'someNewKind' }) === 'Some New Kind', stepLabel({ type: 'someNewKind' }));
check('a step with nothing is still named', stepLabel(null) === 'Change' || stepLabel(null).length > 0);

check('one part says nothing', stepMeta({ type: 'delete', items: [{ partId: 1 }] }) === '');
check('three parts', stepMeta({ type: 'delete', items: [{ partId: 1 }, { partId: 2 }, { partId: 3 }] }) === '3 parts');
check('part ids as plain numbers', stepMeta({ type: 'vis', ids: [4, 5] }) === '2 parts');
check('a compound step counts its steps', stepMeta({ type: 'compound', ops: [{ type: 'vis', ids: [1] }, { type: 'delete', items: [{ partId: 2 }] }] }) === '2 steps');
check('a step that says nothing about parts', stepMeta({ type: 'shading' }) === '' && stepMeta(null) === '');

const now = 1_000_000_000_000;
check('seconds', ago(now - 2000, now) === 'now' && ago(now - 30000, now) === '30s');
check('minutes, hours, days', ago(now - 5 * 60000, now) === '5m' && ago(now - 3 * 3600000, now) === '3h' && ago(now - 2 * 86400000, now) === '2d');
check('no time, no text', ago(undefined, now) === '' && ago(0, now) === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
