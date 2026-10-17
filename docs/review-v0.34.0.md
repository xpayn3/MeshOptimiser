# MeshOptimiser v0.34.0: whole-app code review

A read of the whole app by nine reviewers, one per segment (server surface, Claude connection server side, updater and installer,
scene persistence, export, state and undo, geometry algorithms, UI shell and renderer, STEP converter), each hunting for real bugs with a
file, a line and a failure scenario. Nothing was fixed in this pass. The tenth segment, the page side of the Claude connection
(`_ClaudeBridge` in `app.js` ~11507–14120, the tool implementations and the permission gate), was cut short by a session limit and is
only partly covered (the gate finding under *Claude connection* came from the server reviewer); it should get its own pass.

Line numbers are those of the working tree on 2026-10-17 (commit 5051d90 plus the uncommitted updater/export/Claude-mode changes); they
will shift. `[ ]` open, `[x]` fixed, `[~]` partly. HIGH / MED / LOW is the reviewer's severity. (C) confirmed by reading the code path
end to end or by running it; (PL) plausible, the mechanism is real but the trigger was not reproduced. The items marked ✔ were re-read by
the coordinating reviewer as well.

**Tally:** 100 findings: 19 HIGH, 44 MED, 37 LOW. 20 fixed on 2026-10-17 (the `[x]` lines; see UNRELEASED_FIXES.md).


## Most worth tackling first

Ranked by what the user loses and how sure the finding is. Each is one small change.

1. **Parts vanish after a plain Ctrl+Z** (state and undo 1, 2): deleting the last members of a user group, or grouping parts that already
   sit in a group, strands their meshes under a detached container; undo lists them but does not draw them, and the group is gone.
2. **Recovery copies stop for good** after "Close without saving" (persistence 2): the autosave's `closing` flag is only ever set, and the
   main window is reused.
3. **Import into a saved scene leaves it "as saved"** (persistence 1): the tab closes without asking and no recovery copy is written.
4. **The Export origin option has never worked** (export 1): the dialog sends `keep` / `center` / `floor`, the presets `model` / `floor`,
   the builder knows only `bbox`. Nothing recentres, nothing drops to the floor.
5. **A tool that empties one material of a multi-material part makes the whole part disappear** (algorithms 1): no draw groups are
   rebuilt, so an array material draws nothing; the count still says the triangles are there.
6. **The self-healing update does not heal** (updater 1, 2): the page confirms the update after 30 s whether or not the app came up, and a
   crash in the middle of `apply_archive` leaves a mixed tree with no `pending.json` to trigger the rollback; a retry then discards the
   only backup.
7. **An update that changes `requirements.txt` on a bundled-runtime install stops the launcher** (updater 3): pip installs into the
   runtime, the manifest hash is never rewritten, `start.bat` goes to `no_runtime`.
8. **Default Repair mesh breaks the shading of every hard-edged CAD part** (algorithms 2): the weld merges vertices with different normals
   and keeps the first one; confirmed on a cube (24 → 8 vertices, wrong normals on every face).
9. **A native crash in the converter hangs the job for ever** (converter 1): the heartbeat helper inherits the server's pipe and never
   exits on Windows, so the crash fallback (plain reader) is unreachable.
10. **Animate forgets a part that is deleted and brings it back frozen mid-spin on undo** (UI shell 1).
11. **Split and Flatten while exploded bake the exploded layout in as rest** (state and undo 3, 4); Merge resets the view first, these do not.
12. **Any local web page can take over or starve the Claude connection** (Claude connection 1): the poll is a GET with side effects and a
    missing Origin is trusted.
13. **Mirrored parts are written inside-out** by the FBX, OBJ, STL and PLY writers (export 3), and by the converter for mirrored face
    locations (converter 2).

Segments by urgency: state and undo, persistence, updater, export, algorithms, converter, Claude connection, UI shell, server surface
(the last is in good shape; one dev-only hole).


## Claude connection, server side (serve.py 783–1335, bridge handlers 1478–1720)

- [x] MED-HIGH 1373, 1642 ✔ (C) `/api/bridge/poll` is a GET with side effects and `_trusted()` accepts a missing Origin: another local page (the site dev server on 8080, any dev tool) can `fetch('http://localhost:4242/api/bridge/poll?c=evil&new=1', {mode:'no-cors'})`, become the active window (1647), 409 the app's own poll and swallow Claude's next command. Fix: refuse when `Sec-Fetch-Site` is present and not `same-origin`/`none`, or make poll a POST.
- [ ] MED 12690–12745 (app.js) ✔ (C) "Ask before edits" is enforced only in the page and only for tools in `EDITS`; no file tool is in it, so the files category set to "ask" behaves as "allow": `open_file` of any model on the disk, `export_model`, `list_folder` run without a prompt. The server has no gate at all.
- [ ] MED 1262–1290, 1549–1668 (C) A dequeued command is tracked only as a count (`inflight`), never cid → window, so when that window closes or reloads the MCP call waits the whole tool timeout (15 min for `remove_hidden_faces`, 2 h for `batch_optimise`) and `inflight` stays 1 afterwards.
- [ ] MED 1652–1665 (PL) A poll whose browser side is gone can still pop a command: the wait loop checks `seq` and `active`, never the socket; `_handle_alive` already shows how (`select`).
- [ ] MED 1281–1289 (C) A server-side timeout neither cancels the job nor tells the page: the Allow prompt stays open, the user clicks Allow later, the edit happens while Claude was told it failed; the result lands in `results` unread.
- [ ] MED-LOW 1471–1476, 1711 + app.js 12808 (PL) A page result over 8 MB gets 400 "bad result" and the page ignores `!r.ok`, so a big `screenshot` hangs the call to its timeout.
- [ ] MED-LOW 1296–1333, 1484, 1146 (C) No try/except around dispatch: malformed-but-valid JSON (`params: []`, `limit: "five"`) raises in the handler thread and the client gets a dropped connection instead of `-32602`.
- [ ] LOW 1271, 1300–1304 (C) `BRIDGE["rpc"]` maps bare JSON-RPC ids to cids with no session scoping; two Claude Code sessions can cancel each other's streamed calls; a cancel for a plain call is ignored.
- [ ] LOW 1283, 1522, 1716 (C) `results` and `prog` grow without bound for cids nobody waits for.
- [ ] LOW 1531–1543 (C) `list_folder` recursive walks the whole tree; the 5000 cap counts model files, not directories, and nothing stops the walk when the call times out (`C:\` pins a thread).
- [ ] LOW 933, 1015, 1048, 887 (C) Hints and schemas out of step with the page: `turntable_video` "animations" field not in its schema, `export_model` reads `animation` (singular, undocumented), `export_notes` readOnly though `save`/`html` write, `read_doc troubleshooting` opens the help article not the playbook (`problems.md`).
- [ ] LOW 1265, 1621, 1255 (C) `last_poll`/`inflight` read outside the lock, `MCP_STATS` bumped without one; benign drift.
- Cleanup: `MCP_RESOURCES` built twice (1103, 1164); `_kb_search` re-tokenises every article twice per query; `_handle_bridge_status` snapshots outside its lock.
- Sound: uuid cids, one condition variable, `seq`/`active` hand-over; exports confined to `exports/` with a sanitised name; file access is whole-disk for model extensions by design and says so.

## Claude connection, page side (app.js 11507–14120) — NOT REVIEWED in full

- [ ] Pending: a pass over the tool implementations (undo/dirty for every mutating tool, argument validation for ids that are groups, deleted parts, cloners or splines, the gate applied before any side effect, failure half-way through a multi-part tool, screenshot/video memory, poll recovery after a restart). The Claude mode feed UI (~59590–60030) was covered by the diff review of 2026-10-17 instead.

## Updater, installer, packaging (updater.py, js/updater.js, install.ps1, start.bat, tools/app/build-*.py)

- [x] HIGH updater.py 357–383 ✔ (C) A crash during `apply_archive` (power, kill, antivirus) after the first `os.replace` and before `pending.json` is written leaves a half-replaced tree that nothing rolls back: `on_startup` finds no pending file. A retry runs `_remove_tree(BACKUP_DIR)` and skips the already-replaced files as identical, so their old versions are gone. Fix: write the marker (or an "in progress" flag in `backup.json`) before the first replacement and let `on_startup` finish or undo an unfinished apply.
- [x] HIGH js/updater.js 306–307 ✔ (C) The page confirms the update after the 100 × 300 ms wait for `app-ready` runs out, whether or not the app came up: a version whose `app.js` throws confirms itself and the "served and never confirmed" count can never reach three.
- [x] HIGH updater.py 320–333 + start.bat 39–44 ✔ (C) On a bundled-runtime install `_pip_install` installs into `runtime\`, the marker goes only to `.venv`, and `runtime\MANIFEST.json` keeps the old `requirements_sha256`; the next `start.bat` fails the `findstr` and goes to `no_runtime` (hidden start exits 1). Fix: rewrite the manifest hash after pip, or treat the hash as advisory when the import check passes.
- [x] MED updater.py 384–389 (C) `_restore(meta)` in the except path is unprotected: a PermissionError there escapes to the generic handler, which says "The old version is still in place" while the tree is half and half; `pending.json` was unlinked first, so no trial rollback either.
- [ ] MED updater.py 408–417, 497–505 + install.ps1 20 (PL) A stale `.update/backup` or `pending.json` survives a full reinstall (`$Skip` keeps `.update`): `on_startup` or Settings › "Restore" can copy 0.34 files over a 0.36 install. `rollback()` should refuse a backup whose `to` is not the installed version; install.ps1 could clear both.
- [ ] MED updater.py 393–405, 416 (C) Rollback with a missing or partial `backup/files` silently "succeeds", writes `version.json` = old number and the "rolled back" notice while the files are new.
- [ ] LOW serve.py 1595 + updater.py 408 (PL) Rollback runs in the request thread with no phase, so an install can start in the middle of it and `_remove_tree(BACKUP_DIR)` under `_restore`'s feet.
- [ ] LOW js/updater.js 93, 102–126 (PL) Two false "did not come back" errors: `rollback()` always goes to `restarting()` even when the server answers `done` (no `RESTART_CMD`); two failed status fetches during a long download flip the card to "Restarting" and it then fails after 120 s while the install continues.
- [ ] LOW install.ps1 20, 175, 189–201 (PL) `runtime` is not in `$Skip` and nothing asks the user to close the app; a locked `python312.dll` aborts the extraction half-way, after `.venv` was already removed on an old-layout install.
- [ ] LOW updater.py 215, 219 (C) Non-numeric `launcher`/`size` in the feed raise `ValueError`, not `UpdateError`; the page shows "did not answer".
- [ ] LOW build-update.py 117–123 + site/latest.json (C) `requirements_changed` and `installer` are only right when `--feed` / `--installer` are passed; 0.34.0's feed has no installer block, so install.ps1 downloads unchecked.
- Cleanup: make `--feed site/latest.json` and `--installer` the defaults; type-check `man["delete"]` as a list of strings (a string is iterated per character); start.bat could rename a dead `.venv` aside instead of asking the user to delete it.
- Sound: host allow-list with redirect re-check, size enforced on the stream, `_safe_rel` (drive letters, ADS, trailing dots, reserved names, case-folded protected folders), `tests/updater.test.py` covers the refusals.

## Scene persistence (save, load, tabs, dirty, recovery)

- [x] HIGH 34188, 20431–20435 ✔ (C) Importing a file into a scene that is "as saved" clears `state.history` without touching `_Dirty`, so `dirty()` is false: the tab closes without asking and the autosave never writes a copy (`snap` requires `dirty()`).
- [x] HIGH 20768 (`discardHere`), 20657, 20036–20046 ✔ (C) `closing` is sticky: `close()` on a dirty 'main' or last tab calls `__moDiscardRecovery()` and then keeps the same window via `__moResetScene()`; that window never writes a recovery copy again for the rest of the session.
- [ ] MED 20697 (C) Timer copies are skipped whenever `state.viewMode !== 'solid'`: a user in Clay, Wireframe, X-ray or Heatmap all session gets no periodic recovery copy, only the hidden/errors/gpu ones.
- [ ] MED 25569–25590 (C) The `<a download>` fallback (no `showSaveFilePicker`, or it threw) calls `_Dirty.mark()` and `_Autosave.forget()` before the browser has written anything; a cancelled save sheet leaves a green dot and no copy.
- [ ] MED 25556–25558, 25226, 50620 (C) Saving with "camera / view" unchecked and no notes drops the animation, the explode amount and the measurements: the marker node is only added `if (ask.view || withNotes)`.
- [ ] MED 2603–2607, 2957, 60010 (C) In Claude mode (`__moNoTabs`) opening or dropping a file replaces a dirty scene with no question; the old scene's recovery copy is deleted at the next `_Dirty.mark()`.
- [ ] MED 20557–20574, 20714 (PL) Two top windows restored after a browser crash: the first `begin()` deletes the dead session rows, the second sees a clean table and `settle(false)` deletes every orphaned copy, including the ones the first is offering.
- [ ] MED 43246–43256, 25725 (PL) Animation is re-attached by old partId with a fallback to the first part of the same name; with duplicate names ("Screw M6") it lands on the wrong copy after reopen.
- [ ] LOW-MED 2609, 10392, 20752 (C) `state._recoveredFile` is set before the load succeeds; a copy that fails to parse leaves the flag, and the next file opened is treated as the recovered scene (forced dirty, the crash copy replaced by a copy of it).
- [ ] LOW 25497–25503, 22381 (C) Partial save with "hidden too" writes a hidden, selected instanced part with its zero-scale matrix (the flip sets `p.visible` but not the instance matrix).
- [ ] LOW 27318–27322, 20660 (PL) A snap taken while the Save dialog is open nests `_withSolidView`; the inner `finally` nulls `_viewModeShown`, so the file records `viewMode: 'solid'`.
- [ ] LOW 2893, 4365–4382, 20550 (C) Recent files: handle keys `name|size` accumulate in IDB 'handles' and are never deleted; cards keyed by name only share one card between two `scene.glb` files; without Web Locks any window older than 15 s counts as dead.
- Cleanup: `partsPayload` is written into every file and never read; the `_Autosave` header comment contradicts the crash-only rule; Lock and flag toggles change what Save writes but are not undo steps, so they never make the scene dirty.

## Export

- [x] HIGH 22492 + index.html 7870–7872 + app.js 12574–12580 ✔ (C) The Origin option is never applied: `buildExportRoot` recognises only `origin === 'bbox'`; the dialog sends `keep`/`center`/`floor`, the MCP presets `model`/`floor`. "Recentre to bbox centre", "drop to floor" and the `ar`/`print` presets write the file as "Keep model origin". There is no floor logic at all.
- [x] HIGH 27356, 22458–22480, 42887–42912 ✔ (C) The glTF animation is baked after `_whileTogether` has re-exploded the view: `_Anim.bake` reads live `matrixWorld` (with the explode offset) while the nodes are written from `_exactWorld` at rest, so a spinning part orbits its explode offset in the file. Move the bake inside `_whileTogether`.
- [ ] MED 23557–23624, 25084–25158, 22694, vendor STLExporter 133–162 (C) Mirrored parts (det < 0) are written inside-out by every non-merge writer except glTF: `_fbxLocalTRS` returns null for det <= 0 and the baked path never flips indices; the OBJ writer and the shear bake likewise. Only the merge path swaps corners (22768).
- [ ] MED 27491–27496 vs 23669–23675 (C) The two FBX back ends disagree about units and up axis: `_fbxGlobals` is used only by the built-in writer, the Assimp path gets a bare GLB; which one runs depends on whether `pairQuads` found quads.
- [ ] MED 25065–25066 (C) `_exportObjStreaming` keeps `_seen` and `_seenFor = root` as properties on the function, so the whole export root stays referenced until the next OBJ export.
- [ ] MED 27625–27642, 11934–11939 (C) The size estimate counts 24 bytes per vertex plus indices: no UVs, colours, tangents or embedded textures although the GLB is written with `embedImages: true`; the MCP `estimate_export_size` also reads the dialog's live checkboxes.
- [ ] MED 29101–29123, 22416, 7596 (C) "Selected parts only" and cloners: the visibility flip restores `mesh.visible = p.visible` (a radial cloner's hidden generator comes back visible); a selected source under `state.pivot` escapes the `hiddenGenerator` test, `_exportEstimate` throws on `it.part` null.
- [ ] LOW 22765 vs 22662 (C) The merge path writes `p.originalColor`, the non-merge path the live material colour: a repainted part exports with its old colour when merged.
- [ ] LOW 22737–22754 (PL/C) The merge path reads `position.array` directly (interleaved attributes mis-counted) and one part without normals drops normals for the whole merged mesh.
- [ ] LOW 23007 vs 23053 (PL) The Draco result is returned as `compressed.buffer`, not sliced to `byteOffset/byteLength` as the meshopt branch does.
- Cleanup: one origin vocabulary across dialog, presets and builder (and a floor implementation or no floor option); `_seen` as a local Map; one post-processor helper.
- Sound: pivot='part' math in both branches, Uint32 switch, cloner copies once, hidden instance via `_instOrigMat`, quad winding, object URLs revoked.

## State and undo (history, delete, groups, transforms, explode, cloner)

- [x] HIGH 20940–20954, 46384–46405, 21540–21548 ✔ (C) Deleting the last members of a user group: `deleteParts` removes the ids from `g.partIds` first, then `removeUserGroup` re-attaches `for (const partId of g.partIds)` (now empty) and removes `g.ref`; the hidden meshes stay under the detached container. Undo shows them in the tree, the viewport does not draw them until one is clicked; the group is gone (`skipUndo`).
- [x] HIGH 46356–46366, 46285–46305 (C) Grouping parts that already belong to a user group removes the old group without recording it; undo re-attaches the parts to the orphaned `A.ref` and they vanish.
- [x] HIGH 44433–44478, 44272–44309 ✔ (C) Split while exploded copies `mesh.position` (the exploded place) as the children's rest and sets no `_origWorldPos`; collapsing the view leaves the pieces apart. Merge, Arrange, Recentre, Bake and Smart fit call `resetExplode()` first; Split does not.
- [x] HIGH 47333–47446, 44759 (C) Flatten while exploded makes the layout permanent (unconditional `invalidateExplodeBaseline()` while `_explodeActive` stays true) and strands deleted parts at their exploded spot (`_ensureExplodeBaseline` skips deleted parts); undo Flatten then undo Delete shows the part exploded in a closed model.
- [x] MED 20945–20950 vs 21540–21564 (C) Delete undo does not restore user-group membership even when the group survives; redo does not drop it again.
- [ ] MED cloner.js 1257–1272, 668–687 (C) Undoing "make cloner" moves nested sources to the top level (`_clonerDissolve` attaches to `partsRoot` and sets depth 0) instead of their recorded parent.
- [ ] MED 19738–19755 (C) `_purgeSoon`'s `live` set holds only geometries of parts with a `.mesh`: when a 'delete' entry of a promoted instance ages out, the geometry still drawn by its instanced siblings is disposed and dropped from `geomByHash`; `_exportDrawList` then skips those siblings.
- [ ] MED 44757–44758 (C) `_ensureExplodeBaseline` uses `Box3.setFromObject(partsRoot)`, which counts hidden and deleted meshes and every zero-scaled instance slot as a point at the InstancedMesh origin: a lopsided explode centre.
- [ ] LOW 21556 (C) Undo of a delete done while exploded restores `_instOrigMat` on a hidden instance and makes it visible.
- [ ] LOW 44289–44290, 44420–44421 (C) Split does not record visibility; undo sets `parent.visible = true` while the mesh stays invisible.
- [ ] LOW 46175 (PL) `Math.max(...state.parts.map(...))` in `_mergeSelectedCore` throws RangeError past ~100k parts (cloner.js avoids it with a loop).
- Cleanup: the `if (exploded) applyExplode()` branches in delete undo (21559) and merge undo (46275) can never run (the wrapper at 57142 resets first); 'merge' entries are never purged; 'paste-group' undo decrements `_userGroupCount` while `userGroupRemove` undo increments it.
- Sound: push/limits/auto pairing, `_UndoOps`, `_applyTransformOp`, `_exactWorld` refreshed at gizmo end, detach, `transform_parts`, recenter, align, explode/reset, flatten; no in-place mutation of a shared InstancedMesh buffer found.

## Geometry algorithms (reduction, workers, cleanup tools, mesh modules)

- [x] HIGH 53163–53164, 56676, holefill.js 1208, 55441 ✔ (C) `_geomFromIndexParts` adds groups only when `outParts.length > 1` or the source had exactly one group; `applyHoleFill`, Remove hidden faces and Floating pieces drop empty groups first, so a two-material part that loses all triangles of one material gets no group and an array material draws nothing: the part vanishes while `triCount` still counts its triangles. Undo brings it back.
- [x] HIGH meshrepair.js 159–166, 222–227 + app.js 56247–56272 ✔ (run) Default Repair mesh welds by position (+UV) but not by normal and keeps the first normal; the app skips recomputing normals when `r.normal` exists. A sound cube goes 24 → 8 vertices with wrong normals on every face, and `changed` is true because `welded > 0`, contradicting "a part that is already sound is left as it is".
- [ ] MED 53670, 53718–53727 (C) Opening Quick remesh on an instanced part promotes it to a mesh with no undo entry; Esc does not undo the promotion and `commit()` snapshots after it.
- [ ] MED 54115–54126 (PL) The Fit to budget bisection collapses when a unit has `diag` 0 (`w = 1e-12`): `hi` becomes ~1e17 and every mesh is planned down to 16 triangles.
- [x] MED holefill.js 1120–1144 (PL) `earClip` is O(n³); a hole outline of a few thousand points takes minutes in a worker that cannot be cancelled.
- [ ] MED meshcheck.js 82–100 (PL) The edge table is sized `cap >= 3·T0` for up to `3·T` edges; an unwelded facet soup near the boundary degenerates linear probing to O(n²) on the page thread.
- [ ] MED 1493–1546 (C) A posted worker job cannot be cancelled or timed out; a worker that never replies is never released, `_Job.cur` is never cleared and every `_Job` tool answers "Still working" for the rest of the session.
- [ ] LOW 53534–53546, 53721, 53736 (PL) Quick remesh holds no `_Job` lock and never checks that the part still wears `part.orig`; an MCP tool in between is overwritten by the next `wear()`.
- [ ] LOW 53294–53308 (PL) `_decimateSelectedRun` checks `p.mesh.geometry === geom` after the await but not `p.deleted`.
- [ ] LOW 53269, 55166, 55430 (PL) mm tolerances use `cbrt(|sx·sy·sz|)`, wrong for a non-uniformly scaled node.
- [ ] LOW 53164, 55233, 55443 (PL) A single source group is re-added over the whole index, ignoring its original `start/count`.
- [ ] LOW mesh-worker.js 34–46 (C) `stats.kept` and `stats.polygons` are those of the last untriangulate pass only.
- Cleanup: CLAUDE.md says meshoptimizer v0.18, the vendored file says 0.22 and `reduceIndex` relies on the 0.20+ `vertex_lock` position; one group list from `src.groups` in `_geomFromIndexParts` fixes the HIGH in one place; size meshcheck's table at `6·T0`.
- Sound: all attributes remapped, triCount/bbox updated in every path, instances skipped or reduced once, late worker results guarded by geometry identity, transfer lists fresh, hole-filler walks bounded, tolerances bbox-relative, hidden-face removal conservative. All fifteen module tests pass.

## UI shell, renderer, notes, Animate, Measure

- [x] HIGH 42608–42613, 42581, 20931 ✔ (C) `applyAll` deletes an animation record when its part stops being `live()` (deleted); `rec.rests`, the only copy of the rest matrix, goes with it. Ctrl+Z brings the part back visible at the mid-spin pose, not animated, with no undo step to restore it.
- [ ] MED 50200–50203, notes.js 137–144 (C) A note on an instanced part keeps only a world point (`local = null`): the pin never follows the part under Explode or the gizmo.
- [ ] MED 6575, 8698–8714, 9671 (C) The device pixel ratio is read at boot and on model load only; moving the window to another monitor or zooming leaves the canvas blurry or 4× too big until a reload.
- [ ] MED 20801–20818 (PL) `webglcontextlost` is handled, `webglcontextrestored` is not: after a driver reset the PMREM environment stays black and the Recover card stays up.
- [ ] MED appearance.js, app.js 3636, 19971 (C) Settings › Appearance applies tokens only to the document the Settings window is in; other scene tabs (iframes) keep the old look until reload (`_MotionPerf` already listens to `storage`).
- [ ] MED 339–420, 445 (C) `_Dialog` has one shared `onClose`: a second `appConfirm` while one shows overwrites it and the first `await` never resolves.
- [ ] LOW 45433–45449, 50163 (C) No `e.repeat` guard on S/M toggles: holding the key flips isolate or Measure every repeat.
- [ ] LOW 2208, 6318, 32817, 38930, 57452, 59312 (C) Five hand-written typing checks beside `_typingTarget` / `_modalOpen` disagree (backtick opens the console over the Export dialog; `?` with a focused select opens shortcuts).
- [ ] LOW 43125 (C) The one `localStorage.getItem` outside a try: opening Animate throws when storage is blocked.
- [ ] LOW 3294–3297 (PL) `_Prefs.load` has no schema version or validation; a corrupt value is used raw by some readers.
- [ ] LOW notes.js 156–178, app.js 9019 (C) Pin layout forces two `getBoundingClientRect` per rendered frame while pins show.
- [ ] LOW 11222–11260 (C) `_WebmMux` holds every chunk until `mux`; a long 4K turntable grows the heap linearly.
- Cleanup: route every key handler through `_typingTarget` / `_modalOpen`; make `_Dialog` queue or reject a second open; let `appearance.js` listen for `storage`.
- Sound: 25 intervals all guarded or cleared, 64 dispose sites, render loop idles, 65 of 66 storage reads wrapped, notes follow rename and delete+undo, save and export go through `_Anim.run`.

## STEP converter (step2glb.py, serve.py 523–780)

- [x] HIGH serve.py 702–712 + step2glb.py 77–118 ✔ (C) The Heartbeat helper inherits the converter's stdout (serve.py's pipe) and only checks its parent `if os.name != 'nt'`; after a native crash it keeps the pipe open and keeps printing "still working", serve.py reads to EOF before `proc.wait()`, the job stays "running" for ever, and the plain-reader retry (719–729) is unreachable. `--batch` sets `STEP2GLB_NO_HEARTBEAT=1` (2617); serve.py does not.
- [x] HIGH step2glb.py 1491–1558 (C) A face whose `TopLoc_Location` is a mirror (det < 0) is written with inverted winding: the flip at 1550/1558 looks only at `TopAbs_REVERSED`; normals are transformed, so normals and winding disagree and the part shades inside-out (plain reader, IGES mirrored subfigures, located sub-shapes). Flip when `reversed != mirrored`.
- [ ] MED step2glb.py 2252–2283, 1039–1052 (C) `--min-size` in the XCAF path prunes nodes but `products` is written unchanged, so every dropped mesh stays in the GLB (trimesh writes unreferenced geometry); the file is as big as before and `tris_out` counts them.
- [ ] MED step2glb.py 1811–1836, 2158–2173 (C) The "cached GLB is still current" test ignores the XCAF read modes, `--props`, `--pca-instances` and the converter's version; `--no-step-names` then a plain run returns the nameless GLB.
- [ ] MED step2glb.py 1292, 1313–1325, 214, 2725 + site docs (PL) `--relative` sets OCCT's per-edge relative deflection, not a fraction of the bbox diagonal as the comment, the help and the docs say (three different claims).
- [ ] MED step2glb.py 1522–1525, 999–1009 (C) Faces and solids that failed to tessellate vanish silently, the mesher status is never read, exit 0.
- [ ] MED-LOW serve.py 667, index.html 7710, step2glb.py 1141 (C) "Share identical shapes" does nothing in the default XCAF path but changes the cache key, so turning it off re-converts for the same output.
- [ ] LOW index.html 7684, step2glb.py 412–424, 758–800 (C) The "Instance overrides (SHUO)" switch (labelled slowest) buys nothing: component labels and SHUO attributes are never queried.
- [ ] LOW-MED step2glb.py 808–860, 879 (C) Per-face colours are dropped; a SolidWorks STEP with face colours and no body colour comes out grey while the docs promise colours.
- [ ] LOW step2glb.py 287–289, 2161 (C) Staleness is mtime-only; a source replaced by a revision with an older mtime is served from the cache (CLI/batch).
- [ ] LOW step2glb.py 2225–2309 (C) The `except Exception` around the whole XCAF path also covers writing and LODs: a disk-full on export is reported as "XCAF reader failed", the STEP is read twice and the user may get a colourless model with exit 0.
- [ ] LOW serve.py 719–769 (C) A plain-reader retry after a crash is stored in the kept-results cache under the colours-on key; the next open shows the colourless model as "the kept result".
- Cleanup: `_doc_has_product_meta` treats an empty `ProductID` as absent so the XCAF cache is never used for such files; `_NORMALS`/`_BREP` hold every vertex array for the life of the process across the five `_convert_with_budget` passes; `pca_canonical`'s docstring and the `--relative` texts describe behaviour the code does not have.
- Sound: nested locations composed correctly, node-level mirrors carried as det<0 matrices, instancing hash never wrongly merges, glTF bytes valid (trimesh 5.1.1 float32 min/max, 4-byte padding), temp files cleaned.

## Server surface (serve.py non-MCP, launchers)

- [ ] MED 1385–1393 ✔ (C) `translate_path`'s `/tests/` branch joins an absolute `rel` onto the tests folder and `Path / "/x"` or `/ "C:/x"` discards the base: `GET /tests/C:/Windows/win.ini` is served in a dev checkout or unpacked source archive (not in the installed app, which has no sibling `tests`). Refuse `isabs` and drive letters, or check `relative_to(up)` after resolve.
- [ ] LOW-MED 111–132, 1721–1752, 204–222 + app.js 20831–20847 (PL) After a restart the server waits 120 s for its first window but the page stops relinking after 5 tries 3 s apart; a slow restart (or the fallback to another port when 4242 is not yet free) means the server exits with the window open.
- [ ] LOW 1902–1931 (PL) The 400/413/507 refusals of `/api/convert` are sent before the body is read and the connection closed; the browser sees a reset and "Failed to fetch" instead of the message.
- [ ] LOW 546–583 (C) Cache eviction is per file, not per key, and a hit touches only the `.glb`: a reused model's B-rep sidecars go first, and one result over `CACHE_MAX_BYTES` empties the whole cache.
- [ ] LOW 532–544 (C) The cache key covers the script, `version.json`, settings and bytes but not the converter's runtime (OCP), so a runtime update keeps serving old results.
- [ ] LOW 566–600 (C/PL) A cancelled cache-hit copy leaves `dst_path` in `inbox/`; `_cache_store` copies straight to the final name, so a parallel lookup can copy a partial `.glb`. Write to `.tmp` and `os.replace`.
- [ ] LOW 1401–1403 (PL) `_hidden` checks the spelled name only; with 8.3 names on, `GET /VENV~1/pyvenv.cfg` is served in a dev checkout.
- [ ] LOW 204–222, 1360–1364 (C) Every restarted server appends every request line to `server.log` with no rotation.
- Cleanup: `interactive_convert` builds the converter command line a second time; `_sweep_stale_inbox` only starts after the first `/api/convert`; `do_HEAD` keeps `If-Modified-Since`.
- Sound: `_trusted` (Host pinned, Origin required to match when present), `/api/convert` name sanitising and `relative_to(INBOX)`, upload bounded and cleaned on every error, `JOBS`/`PROCS` under `JOBS_LOCK`, converters killed three ways, launchers quote their paths.
