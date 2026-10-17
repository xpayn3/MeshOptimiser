// node tests/user-groups-undo.test.mjs — a delete or a new group that dissolves a user group can be undone.
//
// Source-level (the app needs a browser): checks the pieces that keep these fixed.
//   1. deleteParts dissolves a group BEFORE its members are taken out of it (so their meshes go back under partsRoot and are drawn
//      again on undo), and records the dropped memberships and the dissolved groups on its undo step;
//   2. the delete undo puts those groups and memberships back, the redo takes them out again;
//   3. addUserGroup records the groups it empties and each part's previous group, and the 'group' undo puts the emptied groups back
//      before it hangs the parts under their previous parent (which used to be a container no longer in the scene).
import fs from 'fs';

const src = fs.readFileSync(new URL('../app/js/app.js', import.meta.url), 'utf8');
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL  ' + msg); } };
const body = (re, name) => { const m = src.match(re); ok(m, 'could not find ' + name); return m ? m[0] : ''; };

// 1. deleteParts
const del = body(/function deleteParts\(ids, label='Deleted parts'\) \{[\s\S]*?_treeAfterDelete\(/, 'deleteParts');
const dissolve = del.indexOf("removeUserGroup(g.id, { skipRebuild: true, skipUndo: true }); if (r) removedGroups.push(r); continue; }\r\n      for (const pid of gone) g.partIds.delete(pid);".replace(/\r\n/g, '\n'));
ok(dissolve >= 0 || /gone\.length === g\.partIds\.size\) \{ const r = removeUserGroup\(g\.id[\s\S]*?\n\s*for \(const pid of gone\) g\.partIds\.delete\(pid\);/.test(del), 'a group that loses all its members is dissolved before the ids are taken out of it');
ok(/groups\.push\(\{ groupId: g\.id, partIds: gone \}\)/.test(del), 'the memberships a delete drops are recorded');
ok(/pushUndo\(\{ type: 'delete', items: hidden, label, groups, removedGroups,/.test(del), 'the delete step carries the groups and the dissolved groups');
ok(/return op;/.test(body(/function removeUserGroup\(groupId, opts = \{\}\) \{[\s\S]*?\n\}\r?\n/, 'removeUserGroup')), 'removeUserGroup hands back what undo needs');

// 2. the delete undo / redo
const h = body(/_UndoOps\.register\('delete', \{[\s\S]*?\n\}\);/, 'the delete undo handler');
const undoPart = h.slice(0, h.indexOf('redo(op)')), redoPart = h.slice(h.indexOf('redo(op)'));
ok(/for \(const r of op\.removedGroups \|\| \[\]\) _userGroupPutBack\(r\);/.test(undoPart), 'undoing a delete puts the dissolved groups back');
ok(/ug\.partIds\.add\(pid\)/.test(undoPart), 'undoing a delete restores the dropped memberships');
ok(/for \(const r of op\.removedGroups \|\| \[\]\) _userGroupTakeOut\(r\);/.test(redoPart), 'redoing a delete takes the groups out again');
ok(/ug\.partIds\.delete\(pid\)/.test(redoPart), 'redoing a delete drops the memberships again');
ok(/function _userGroupPutBack\(op\)[\s\S]*?op\.groupHostObj\.add\(op\.groupRef\)[\s\S]*?op\.groupRef\.attach\(p\.mesh\)[\s\S]*?state\.userGroups\.push\(op\.groupRecord\)/.test(src), '_userGroupPutBack re-adds the container, the members and the record');

// 3. addUserGroup and the 'group' undo
const add = body(/function addUserGroup\(name, partIds, opts = \{\}\) \{[\s\S]*?\n\}\r?\n/, 'addUserGroup');
ok(/prevGroupId: old \? old\.id : null/.test(add), 'a new group records each part\'s previous group');
ok(/emptiedGroups\.push\(\{ groupRecord: g, groupRef: g\.ref, groupHostObj:/.test(add) && /groupRecordId: ug\.id, emptiedGroups \}/.test(add), 'a new group records the groups it emptied on its undo step');
const g = body(/_UndoOps\.register\('group', \{[\s\S]*?\n\}\);/, "the 'group' undo handler");
ok(g.indexOf('_userGroupPutBack(r)') >= 0 && g.indexOf('_userGroupPutBack(r)') < g.indexOf('targetParent.attach(p.mesh)'), "undoing a group puts the emptied groups back before the parts go to their previous parent");
ok(/it\.prevParent\.parent\)\) \? it\.prevParent : state\.partsRoot/.test(g), 'a previous parent that is not in the scene is never used');
ok(/og\.partIds\.add\(it\.partId\)/.test(g), 'undoing a group restores the previous memberships');

if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('user-groups-undo: all checks passed');
