# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.34.0**.

## Fixed

![fix][fix] **A good update could be taken back by itself.** After an update, three starts without the page confirming put the old version back, including starts where I had only run the server, or Claude had, and nobody opened a window. Now a start counts as failed only when the server did not come up, or the page was handed out and never confirmed; two such runs in a row are needed, and a quiet run starts the count again.
- Cause: `on_startup` counted every start, and only the page's confirm cleared the count.
- Where: `app/updater.py` (`on_startup`, `mark_listening`, `mark_page_served`), `app/serve.py` (calls them when it listens and when it serves `index.html`).
- Test: `tests/updater.test.py` (start-up).

![fix][fix] **An update could get stuck "running" until the app was restarted.** If the temporary folder for the download could not be made (disk full, no rights on `.update`), the updater never left its download state and every later check or install answered "An update is already running". The folder is now made inside the guarded part, so the error shows and the state resets.
- Cause: `tempfile.mkdtemp` ran before the `try` in the install thread.
- Where: `app/updater.py` (`start_install`, `run`). Not covered by a test (a failing temp folder is hard to stage); the code path was read, not run.

![fix][fix] **The Windows installer could write a file outside its folder.** A zip entry such as `../MeshOptimiser-x/file` passed the check that keeps files inside the install folder, because the check compared text with no trailing separator. Entries with `..` are now skipped and the check includes the separator.
- Cause: `$dest.StartsWith($root)` without a trailing `\`.
- Where: `app/install.ps1` (unpack loop). Parsed with PowerShell's parser; the installer was not run against a crafted zip.

![fix][fix] **The Windows installer did not check its download.** The installer unpacked whatever it got from the release address. The feed can now carry the full download's address, SHA-256 and size (`build-update.py --installer <zip>`); when it does, the installer uses only that file and stops if the checksum differs. The current `latest.json` has no such entry yet, so until a release is published with `--installer` the installer still runs unchecked and says so.
- Cause: the feed's checksum is for the in-app update archive, a different file from the installer's zip, and the installer never read it.
- Where: `app/install.ps1` (steps 1 and 2), `tools/app/build-update.py` (`--installer`). Not run end to end; needs a release built with `--installer`.

![fix][fix] **A release could list the same file to install and to remove.** Such an update would fail half-way, put everything back, and could never install. It is now refused before anything is touched, with a plain message.
- Cause: `verify_archive` checked each `delete` path but not that it was absent from `files`.
- Where: `app/updater.py` (`verify_archive`).
- Test: `tests/updater.test.py` (refusals).

![fix][fix] **Checking for updates while one was installing could reset it.** The check set the update's state back to idle, so the page showed nothing running and a second install could start. A plain check now leaves a running update's state alone.
- Cause: `check()` wrote `phase="idle"` whenever it was not called from inside an update.
- Where: `app/updater.py` (`check`).
- Test: `tests/updater.test.py` (check).

![fix][fix] **If the "update to confirm" note could not be written, the message was wrong.** The files were already new but it said the old version was still in place, and the safety net that takes a failing update back was not armed. Writing the note is now part of the step that is undone on any error.
- Cause: `_write_json(PENDING, ...)` ran after the try that restores.
- Where: `app/updater.py` (`apply_archive`). Not covered by a test (a failing write is hard to stage).

![fix][fix] **The installer ran Chrome's setup without checking who made it.** It now runs it only when the file is signed by Google and the signature is valid; otherwise it says Chrome could not be installed and carries on.
- Cause: the downloaded `ChromeStandaloneSetup64.exe` was started as is.
- Where: `app/install.ps1` (step 4). Parsed with PowerShell's parser; not run against a real download.

![fix][fix] **A failed package install said "Nothing was changed".** The app's files were indeed untouched, but pip works on the live Python environment, so some packages could already be new. The message now says the files were not changed and that some packages may already have been installed.
- Cause: the wording promised more than the step can: pip runs before the file swap, in the real environment.
- Where: `app/updater.py` (`_pip_install` messages and the module header). A real rollback of the packages (installing into a separate environment and swapping it in) is not done. Cancel is still not checked while pip runs.


![fix][fix] **A good update could be taken back after I closed the window early twice.** A run in which the page was served but did not confirm in time counted as a failed start, so two early closes rolled the update back. A page that loads and never confirms now has to happen three runs in a row; a server that never comes up still counts after two.
- Cause: a closed window looks the same as a broken page to the server.
- Where: `app/updater.py` (`on_startup`, new `dead` counter). Test: `tests/updater.test.py`.

![fix][fix] **An update could install a file and delete it again when the two paths differed only in capitals.** The check "installs and removes the same file" (and the duplicate check) compared exact spelling, but Windows sees one file. Both now compare lower-cased.
- Where: `app/updater.py` (`verify_archive`). Test: `tests/updater.test.py`.

![fix][fix] **Claude mode, split view: the Properties card was copied from the sidebar twice a second, and its copied styles repeated unrelated rules.** It is now copied only when the sidebar's card changes, and only the `#prop-body` selectors of a rule are carried over.
- Where: `app/js/app.js` (`stats`, the style copy in `ensure`). Syntax-checked only; not run in the browser.

![fix][fix] **Folders that start with a dot (`.venv`, `.git`, the update backup) could still be read from the local address.** Writing the dot as `%2e` in the address got past the check, because the file server decodes the address after it. The check now decodes first (twice, and also `%2f` / `%5c`).
- Cause: `do_GET` / `do_HEAD` looked at the raw path; `SimpleHTTPRequestHandler.translate_path` unquotes it afterwards.
- Where: `app/serve.py` (`Handler._hidden`). Test: `tests/serve-paths.test.py`. Seen on the running server before the fix (`/%2evenv/pyvenv.cfg` answered 200); the fixed server has not been restarted and checked yet.

![fix][fix] **Exporting an exploded view wrote a mix: some parts together, some apart.** Save already put the parts back together before writing; Export did not. Ordinary parts were written from their saved rest position and instanced parts from where the view had them, so the file had two layouts. Export now builds the file with the parts together and leaves the view exploded afterwards.
- Cause: `_doExportImpl` called `buildExportRoot` with the view still exploded; `_resolvePartWorldMatrix` reads `_exactWorld` for meshes and the live instance matrix for instances.
- Where: `app/js/app.js` (`_whileTogether`, used in `_doExportImpl`). Test: `tests/e2e-export-exploded.mjs` (fails without the change, passes with it; run against the Gearbox sample in headless Chrome).
- Not changed: a part that was moved with the gizmo while the view was exploded may still have the explode offset in its saved matrix (`_exactWorld` is refreshed on a drag); I did not check that case.
- Looked at and left alone: the recovery copy does not go through `_Anim.run` like Save, but a copy taken while a part spins still wrote the part at rest (same test), so nothing was changed there.

![fix][fix] **Undoing the delete of a whole group brought the parts back invisible, and the group stayed gone.** Deleting the last members of a user group dissolved the group after the members had already been taken out of it, so their meshes stayed under a container that was no longer in the scene: after Ctrl+Z the tree listed them and the viewport drew nothing until one was clicked. The delete now dissolves the group first (the meshes go back under the model), and its undo step carries the dissolved groups and the dropped memberships, so undo brings the group and its members back; redo takes them out again. A part deleted out of a group that survived also goes back into that group on undo.
- Cause: `deleteParts` removed the ids from `g.partIds` before calling `removeUserGroup`, whose re-attach loop then found nobody; the group went with `skipUndo`.
- Where: `app/js/app.js` (`deleteParts`, `removeUserGroup` now hands back what undo needs, `_userGroupPutBack` / `_userGroupTakeOut`, the `delete` undo and redo handlers).
- Test: `tests/user-groups-undo.test.mjs` (source-level). Not yet checked in the browser with a model.

![fix][fix] **Grouping parts that were already in a group, then undoing it, made the parts vanish.** The new group emptied the old one and dropped it without a trace; undo hung the parts back under the old group's container, which was no longer in the scene. The emptied groups are now recorded on the group's undo step and put back first, each part goes back into its previous group, and a previous parent that is not in the scene is never used.
- Cause: `addUserGroup` filtered the emptied groups out of `state.userGroups` without recording them; the `group` undo trusted `prevParent`.
- Where: `app/js/app.js` (`addUserGroup`, the `group` undo handler).
- Test: `tests/user-groups-undo.test.mjs` (source-level). Not yet checked in the browser.

![fix][fix] **After "Close without saving", no recovery copy was written for the rest of the session.** Closing the last scene (or the main one) from the strip and choosing to close without saving threw the copy away and then kept the same window for the next model; the autosave's "closing" flag stayed set, so a scene opened afterwards was never covered by a crash copy. The flag is cleared when the window is emptied and reused.
- Cause: `closing` in `_Autosave` was only ever set (`discardHere`, `pagehide`), never cleared; `_Tabs.close` reuses the window through `__moResetScene`.
- Where: `app/js/app.js` (`_Autosave.resume`, called from `_newSceneHere`). Not covered by a test; the path was read, not run.

![fix][fix] **A scene with a file imported into it read as saved: the tab closed without asking and no recovery copy was written.** Importing a model into an open scene cleared the history that the unsaved-changes tracking is built on, so the merged scene looked exactly like the saved file. An import into a scene that has parts now marks the scene unsaved (an import into an empty scene is an ordinary open).
- Cause: the import branch of `_ingestSceneRoot` did `state.history.length = 0` without telling `_Dirty`, whose `dirty()` compares the top of the history with the saved mark.
- Where: `app/js/app.js` (`_ingestSceneRoot`, import branch: `_Dirty.force()`). Not covered by a test; read, not run.

![fix][fix] **The Origin choice in Export never did anything.** "Recentre to bbox centre" and "Centre XY, drop to floor (Z=0)" (and the `ar` and `print` presets Claude uses, which ask for the floor) wrote the file exactly like "Keep model origin". The export builder only understood a value nothing sent. Centre now puts the middle of the model's box at the origin; floor puts the middle on X and Y at the origin and the lowest point at Z = 0 (in the app's own up axis, before the file's axis and unit scale are applied).
- Cause: `buildExportRoot` checked `origin === 'bbox'`; the dialog sends `keep` / `center` / `floor`, the presets `model` / `floor`, and there was no floor logic at all.
- Where: `app/js/app.js` (`buildExportRoot`). Not yet checked with an exported file; read, not run.

![fix][fix] **Remove hidden faces, Remove holes or Remove floating pieces could make a two-material part disappear.** When a tool removed every triangle of one material of a part with several, the rebuilt geometry got no draw groups at all, and a part with an array material is drawn group by group, so nothing was drawn while the triangle count still said most of it was there. The rebuilt geometry now carries one draw group per group of the source, in the source's order, also when a group is empty.
- Cause: `_geomFromIndexParts` added groups only when more than one part came back or the source had exactly one group; the callers leave empty groups out.
- Where: `app/js/app.js` (`_geomFromIndexParts`). Not covered by a test; read, not run against such a model.

![fix][fix] **An update whose page never came up confirmed itself after half a minute, so a broken version stayed.** The page waited up to 30 s for the app to be ready and then told the server the update was good whether or not it was, which disarmed the automatic rollback. It now confirms only when the app really came up.
- Cause: the wait loop in `start()` ran out and the confirm call followed unconditionally.
- Where: `app/js/updater.js` (`start`); `?v=` bumped in `index.html`. Not covered by a test; read, not run.

![fix][fix] **A crash in the middle of an update left the app half old and half new, and a retry threw the only backup away.** The note that arms the rollback was written only after every file had been replaced, so power loss or a kill during the swap left a mixed install that no start ever repaired; running the update again discarded the partial backup and skipped the files already replaced. The note is now written before the first file is touched, marked "applying", and a start that finds it puts the old version back from the backup. If putting the files back fails during an update, the note stays and the message says to start the app again (it used to say the old version was in place).
- Cause: `_write_json(PENDING, …)` came after the loop in `apply_archive`; `on_startup` had nothing to go on.
- Where: `app/updater.py` (`apply_archive`, `on_startup`).
- Test: `tests/updater.test.py` (start-up: "an apply that stopped half-way is undone at the next start").

![fix][fix] **On a bundled-runtime install, an update that changed the Python packages stopped the launcher from starting the app.** The update installed the packages into the bundled runtime and worked until the next start, when the launcher compared the requirements file with the runtime's manifest, saw an older hash, and looked for a system Python instead. The manifest now gets the new hash after the packages are installed.
- Cause: `_pip_install` only wrote the `.venv` marker; `runtime/MANIFEST.json` kept `requirements_sha256` of the build; `start.bat` goes to `no_runtime` when it is not found.
- Where: `app/updater.py` (`_runtime_manifest_note`, called from `_pip_install`).
- Test: `tests/updater.test.py` ("the runtime manifest gets the new requirements hash"). Not run on a real bundled-runtime install.

![fix][fix] **Repair mesh smoothed every hard edge of a sound CAD part, and called it a repair.** The weld joined vertices that share a place whatever their normals and kept the first one's normal for all of them; a clean 24-vertex cube came out as 8 vertices with wrong normals on every face, and because vertices had been joined it counted as changed. Corners now keep their own normal through the weld (they are one vertex for the topology, so faces still join across the edge, but stay apart in the output), and a part that comes out as it went in is left as it is. When the normals are rebuilt by the repair, the weld joins across them as before.
- Cause: `repairMesh` used one weld, by position and UV, both for the topology and for the output vertices.
- Where: `app/js/meshrepair.js` (`repairMesh`, step 4; the `normals` option), `app/js/app.js` (passes `normals`).
- Test: `tests/meshrepair.test.mjs` (normal checks).

![fix][fix] **A native crash in the STEP converter left the conversion "running" for ever.** The converter's heartbeat helper, which prints "still working" during long phases, inherited the server's pipe and on Windows never noticed that the converter had died, so the server kept reading a live-looking log, the job never ended, and the plain-reader retry that exists for exactly this case was never reached. On Windows the helper now holds a handle on the converter's process and stops when it ends.
- Cause: the helper's parent check was skipped on Windows (`os.getppid()` keeps returning the old pid there); `serve.py` reads the pipe to its end before looking at the exit code.
- Where: `app/step2glb.py` (`Heartbeat.__enter__`, the inline helper). Checked with a small script that lets a parent die under a helper and waits for the pipe to close; not with a real converter crash.

![fix][fix] **Deleting an animated part and undoing it brought the part back frozen mid-turn, with its animation gone.** Animate dropped the record of a part as soon as it was deleted, and the only copy of the part's rest position went with it. A deleted part now keeps its record and waits; the undo of the delete finds it moving again, and clearing the animation while the part is deleted puts its hidden mesh back to rest too.
- Cause: `applyRec` answered 0 ("nothing left to move") for a part that was merely deleted, and `applyAll` dropped every record that answered 0.
- Where: `app/js/app.js` (`_Anim`: `applyRec`, `applyAll`, `dropRec`).
- Test: `tests/animate-delete.test.mjs` (source-level). Not yet checked in the browser.

![fix][fix] **Splitting a part while the view was exploded left the pieces apart when the view was put back.** The pieces took the exploded place as their rest position. Split now puts the view together first and explodes it again after, as Merge did.
- Cause: `splitSelectedParts` copied `mesh.position` under an active explode and never called `resetExplode()`.
- Where: `app/js/app.js` (`splitSelectedParts` wraps `_splitSelectedPartsCore` in `_settledView`, the helper Merge now uses as well).
- Test: `tests/explode-undo.test.mjs` (part 4). Not yet checked in the browser.

![fix][fix] **Flattening the tree while the view was exploded made the exploded layout permanent.** Every part's rest position was measured again at its exploded place, so sliding the explode back to 0 left the model apart; a part deleted before the flatten was left at its exploded spot. Flatten now puts the view together once its dialog is answered and explodes it again after.
- Cause: `flattenTree_job` called `invalidateExplodeBaseline()` with the explode still active and never settled the view.
- Where: `app/js/app.js` (`flattenTree_job` runs `_flattenTreeCore` in `_settledView`).
- Test: `tests/explode-undo.test.mjs` (part 4). Not yet checked in the browser.

![fix][fix] **An exported animation of an exploded view circled each part around its explode offset.** The file's parts were written together, but the animation was baked after the view had been exploded again, so the clip carried the offsets: at time 0 the part was right, then it orbited instead of turning in place. The animation is now baked in the same breath as the parts, while they are together.
- Cause: `_animationClipForExport` ran after `_whileTogether` had restored the view; `_Anim.bake` reads the live matrices.
- Where: `app/js/app.js` (`_doExportImpl`: the clip is made inside the `_whileTogether` callback).
- Test: `tests/explode-undo.test.mjs` (part 5). Not yet checked with an exported file.

![fix][fix] **Another web page open in the browser could take over, or starve, the Claude connection.** The poll the app's window keeps open is a plain GET, and a request without an Origin header was trusted, so a page on any other site (or another local port) could become "the window", push the app's own poll away and swallow Claude's next command. Browsers say where a request comes from in `Sec-Fetch-Site`; anything but the app's own page (or an address typed in) is now refused.
- Cause: `_trusted` checked only Host and Origin; a no-cors GET carries no Origin.
- Where: `app/serve.py` (`Handler._trusted`). Takes effect after the server is restarted.
- Test: `tests/serve-paths.test.py` (trust). Not checked against a live cross-site page.

![fix][fix] **A STEP or IGES part placed with a mirror came out inside-out.** When a face carries a reflecting placement inside its shape, its triangles must be turned over as well; the converter turned them over only for faces marked reversed, so the normals and the winding disagreed and the face shaded inside-out (the model inspector called the part inside-out; viewers that cull back faces showed holes). Mirrored placements of whole parts were already right.
- Cause: `solid_to_mesh` flipped on `TopAbs_REVERSED` only, not on `det(location) < 0`.
- Where: `app/step2glb.py` (`solid_to_mesh`). The converter suite (`tests/converter.test.py`) was run after the change; no model with a mirrored face location is in it, so the case itself is not covered by a test.

![fix][fix] **Remove holes took minutes on a hole whose outline has thousands of points.** A finely tessellated round pocket (3,000 points on its rim) took almost seven minutes to close, in a worker that cannot be stopped. The test that decides whether a corner can be clipped off the outline ran over every point of the outline for every corner, for every clip. It now looks only at the corners that turn the wrong way, which are the only ones that can lie inside an ear; a round hole has none. The same 3,000-point hole closes in well under a second, and the triangles that come out are the same.
- Cause: `earClip`'s `blocked()` walked the whole ring.
- Where: `app/js/holefill.js` (`earClip`); `?v=` of the module bumped in `app.js` and `mesh-worker.js`.
- Test: `tests/holefill-proof.test.mjs` (600 and 3,000-point outlines under 5 s); `tests/holefill.test.mjs` unchanged and green.

![fix][fix] **A hole exactly as wide as the size limit was left alone.** A Ø10 hole measured 10.000000000000002 from its single-precision corners, so "holes up to 10 mm" skipped it as too large. The comparison now allows one part in a million.
- Cause: `f.size > maxSize` with no tolerance against the rounding of the mesh's own coordinates.
- Where: `app/js/holefill.js` (step 5, the size test).
- Test: `tests/holefill-proof.test.mjs` ("a Ø10 hole is closed with the limit at exactly 10").

![fix][fix] **Find stacked copies missed a duplicate whose vertices were welded differently.** The same part twice in the same place, once with its vertices shared (8 on a box) and once with a set per triangle (24, as CAD writes them), has the same triangles but not the same vertex count, and the card required both to match unless "Also near copies" was on. The vertex count is no longer required; the triangle count, the box and the centre of the surface are.
- Cause: `_findStackedCopies` compared `vertCount` in its exact mode.
- Where: `app/js/app.js` (`_findStackedCopies`).
- Test: `tests/stacked-copies.test.mjs` (case B; it drives the app's own function on built parts).

![fix][fix] **"Also near copies" missed a re-meshed duplicate whenever the finer triangles sat on one side.** Two exports of one part, one with a fillet meshed finer, have the same surface in the same place, but the mean of their vertices is not the same: it leans towards the denser side, and the check threw the pair out even at 2 %. The placement is now judged by the centre of the surface (each triangle's middle, weighted by its area), which does not move with the tessellation.
- Cause: `_stkMeanWorld` averaged the vertices.
- Where: `app/js/app.js` (`_stkMeanWorld`). The Clean up › duplicates step uses the same finder at its tightest and benefits too.
- Test: `tests/stacked-copies.test.mjs` (cases C and D). Not yet checked in the browser with a model.

![fix][fix] **Decimate at −75 % or −90 % could take a small part down to a sliver.** Quick remesh (B) refuses a result that has lost most of its surface and shows the next gentler level instead; Decimate had no such guard, so a bolt or a thin bracket could be reduced to a shape that reads as the part disappearing. Decimate now holds the result against the same guard (at least 60 % of the surface and 90 % of the size must remain), tries gentler shares first, and leaves a part alone, saying so, when none keeps its shape. Not applied in "Within…" mode, where the measured deviation already bounds it.
- Cause: the guard lived inside `_QuickRemesh` only.
- Where: `app/js/app.js` (`_shapeOf`, `_keepsShape`, shared; `_decimateSelectedRun`).
- Test: `tests/decimate-align.test.mjs` (source-level). Not yet checked in the browser.

![fix][fix] **Quick remesh (B) and Decimate gave different results for the same share.** B cleaned the flat faces before and after the reduction (Untriangulate and Un-Subdivide passes in the worker); Decimate did not, so "50 %" on B and "−50 %" on the card were not the same thing and nothing said so. The card now has a switch, {{Smart: tidy flat faces}}, on by default and remembered; both tools read it, and the hidden `window.__moQuickPlain` still turns it off.
- Cause: the `smart` flag was set only in `_QuickRemesh`'s worker message.
- Where: `app/js/app.js` (`_smartOn`, `_smartPayload`, shared by `_decimateSelectedRun` and `_QuickRemesh`), `app/index.html` (`#decimate-smart`).
- Test: `tests/decimate-align.test.mjs`. Not yet checked in the browser; the docs article `decimate` (site) and the help text do not mention the switch yet and need a line at release.

![fix][fix] **Reducing a CAD part broke its surface long before the triangles ran out.** A part from STEP (and from most glTF exporters) comes with a vertex per face corner, split at every hard edge for flat shading. The simplifier may only collapse along such a seam, so on a machined part every face was an island; the reduction missed its target, fell through to its loosest setting, and tore outlines and borders. Only meshes without an index were welded before. Every mesh is now welded by position first (UVs and colours kept apart, the normals re-creased afterwards at 30°), unless its vertices are already shared. Measured on the three heaviest parts of the Scania V8 at 10 %: the worst distance between the old surface and the new fell from 9.1 to 1.05 mm, from 73 to 10 mm (and that part's 98 border edges, of which 11 had been left, all stay), and from 24.5 to 4.5 mm; at 25 % from 1.4 to 0.5, 6.7 to 2.7 and 3.7 to 1.9 mm. Quick remesh (B) goes the same way.
- Cause: `_weldForReduction` returned an indexed geometry untouched; Decimate's worker path sent the split mesh as it was.
- Where: `app/js/app.js` (`_weldForReduction`, `_decimateSelectedRun`, `_QuickRemesh.levelOf`).
- Test: `tests/reduce-quality.test.mjs` (the real parts, about half a minute; `tests/draco-node.cjs` reads the Draco file in Node), `tests/decimate-align.test.mjs`. Not yet checked in the browser. A smooth mesh with custom normals that are split at edges (some game assets) now gets its normals re-creased at 30° after a reduction.

![fix][fix] **Keep sharp edges could make the rest of a part drift several times further.** Locking the vertices on hard edges spends the whole budget elsewhere; on one engine part at 10 % the locked result was 25 mm off where the plain one was 4.5 mm, and the lock was taken whenever it reached the target. The plain reductions are now always run as well, and the locked one is kept only when the simplifier's own error estimate for it is not clearly worse (within one and a half times) than the plain one's.
- Cause: `reduceIndex` returned the sharp-edge result as soon as it reached the target.
- Where: `app/js/simplify-core.js` (`reduceIndex`: `sharpR`, `pick`).
- Test: `tests/simplify-core.test.mjs` (the sharp path still wins on the rim test), `tests/reduce-quality.test.mjs`.
- Looked at and left alone: a bounded error limit per step (meshoptimizer's `target_error`) made no difference to the collapse order in share mode on these parts (measured: identical results at every limit from 0.2 % to 100 % of the extent), so it was not added.

![fix][fix] **After Remove holes, stray lines and points stayed inside a part.** A part's mesh can hold separate closed pieces inside its body: the oil pump of the Scania V8 (`Oil_Pump_V8-XT-08_1_001097__geom_009`) has four, each about 4 mm and 1,500 to 1,800 triangles, the balls of its valves. They were seen through the bores; with the holes closed they were sealed inside, never visible again, but still drawn, and in the edge overlay they showed through as floating lines and points. Remove holes now takes out every piece that lies entirely inside the closed part (new switch under Advanced, {{Remove what is sealed inside}}, on by default; the Claude tool `fill_holes` takes `remove_enclosed`). The part must be closed for it to judge; a part with an opening left anywhere is not touched by this step. On the oil pump: 10 holes closed, the four bodies gone, one closed piece of 97,326 triangles left (109,712 before).
- Cause: nothing looked at what the caps enclosed.
- Where: `app/js/holefill.js` (`removeEnclosedPieces`, `opts.enclosed`), `app/js/app.js` (`_fillHoleOpts`, the tally and toast, the `fill_holes` tool), `app/index.html` (`#fh-enclosed`), `app/serve.py` (the tool's schema).
- Test: `tests/holefill-proof.test.mjs` (part 6: a body in a bore goes, a free one stays, an open bore or an open shell leaves everything). The oil pump itself was run from the file in Node, not yet in the browser. The docs article `fill-holes` needs a line about the switch at release.

A new test, `tests/holefill-proof.test.mjs`, checks what the hole filler must keep on any mesh rather than what it does on a particular one: a watertight input stays watertight with no edge used three times; a closed through or blind hole gives back exactly the solid's volume and the caps wind with their face; the triangles that stay are written unchanged and in order; filling again finds nothing; the same answer turned, moved 1e4 and 1e5 away, scaled by 1e-3 and 1e3, with the triangles shuffled, a Uint16 index, no index, welded vertices, the whole mesh wound inside-out, a doubled triangle or a zero-area stitch; 60 random plates with one to four round holes, through and blind, against a random limit (the holes within it are closed, the others stay, exact volume). All 44 checks pass. Not covered yet: outlines that touch themselves, walls with doubled or non-manifold edges, and the raised, ring-groove and floating-wall paths beyond what `tests/holefill.test.mjs` already has.

![fix][fix] **The line drawings on the command cards used colours the app does not define.** The drawings at the top of Remove holes, Split, Select hidden, Fasteners and Smart fit were written with the site's token names (`--accent`, `--surface`, `--tx-3`, `--mono`), which the app does not have, so the accent flash in one animation, the fill of the solid shapes and the small label text fell back to the browser's own values. They now use the app's tokens (`--ac-text`, `--surface-pop`, `--tx3` and a new `--font-mono`). Found by a design-system audit of the stylesheet (`docs/review-design-system.md`); fixed in the stylesheet, not yet looked at in the app.
- Cause: the block was brought over from `site/site.css`, where those names exist.
- Where: `app/index.html`, `<style id="cmd-art">` (`.tile-art .art-hot`, `.art-t`, `.art-solid`, `.art-fnd`, keyframes `art-core` and `art-lockc`); `--font-mono` is new in `:root` next to `--font-sans`.

![fix][fix] **Two rules named tokens that do not exist, so their padding and weight were lost.** The loading steps on the start screen asked for `--space-2` and the lock note in the properties card for `--fw-normal`; neither is defined. They now use `--space-xs` and `--fw-regular`. Found by the same audit, not checked on screen.
- Where: `app/index.html` stylesheet (`#welcome-load-pane .ld-step`, `.prop-lock-note`).

![fix][fix] **The Midnight, Warm and Black tones left graphite patches behind.** The shortcuts window's keys, the library cards and inspector, the material dock, the animation dock (its rows, ruler, lanes, inspector and footer buttons), the share menu under Export, the knob of the material editor's toggle and the splash card were painted with literal greys, so they stayed graphite whatever tone was chosen in Settings › Appearance. They now take their colour from the surface and text tokens (`--bg1`…`--bg4`, `--surface-pop`, `--tx`…`--tx3`), so a tone reaches them too. The shortcuts keys' three raised states are mixes of `--bg4` with a little white. Not yet checked in the app in any tone; the splash card's text is a step lighter than before (`--tx2` / `--tx3` instead of the old greys).
- Cause: these parts were added after the token pass, with the greys typed in.
- Where: `app/index.html` stylesheet (`.sc-key` and its states, `.exp-share-menu`, `.lib-item`, `.lib-inspector .li-view`, `#vp-materials-pop.mat-dock`, `.adk-scroll`, `.adk-ruler`, `.adk-rh`, `.adk-insp`, `.adk-bar`, `.cq-btn` disabled and danger, `.adk-addb:disabled`, `.mat-edit-toggle`, `.sp-card`, `.sp-art`, `.sp-info`, `.sp-word`, `#sp-status`). Left as they are: the two greys of the card drawings (`#77777c`, `#46464a`, the drawing's own palette) and the animation clip colours.

![fix][fix] **The colours a few parts paint from script stayed graphite in the other tones.** The dots of the mesh check, the quick wheel's cap and dot, the colour picker's surface and cursors, the quick ring and the frame of a scene tab had their colours typed into the style that app.js builds, so a tone or accent chosen in Settings › Appearance did not reach them. They now use the status, surface and text tokens; the quick ring also drops its typed-in fallbacks. The colour picker keeps the pure red, white and black of its hue strip and square: those are the picker itself, not the theme. Not checked on screen.
- Cause: styles built in app.js were written with the colours in, like the ones in the stylesheet fixed above.
- Where: `app/js/app.js` (`.mi2-dot` in the mesh check, `#qc-wheel`, `.cp-pop` / `.cp-cur` / `.cp-bar-cur`, `.qr`, the tab frame's cssText in `spawn`). Test: `tests/stylesheet-literals.test.cjs` now reads the styles app.js, cloner.js and notes.js inject too, and fails if a colour is typed in there.

![refactor][refactor] **Every layer has a name.** The 22 z-index values that were typed in as numbers (10 to 2147483000) are now `--z-*` tokens in one block of `:root`, lowest first, each keeping the number it had, so nothing stacks differently; the ones under 10 and two inside the animation dock stay numbers, as the stacking within one component. The window layer app.js hands out (`WIN_LAYER`) is read from `--z-window`. The test fails if a new z-index of 10 or more is typed in as a number. Not checked on screen.
- Where: `app/index.html` (`:root`, "Z-index scale"; `#tb`, `#vp-drop`, `#vp-settings-pop`, `#vp-brep-pop` / `-tip`, `.export-menu`, `.dlg-popup`, `#loader`, `#marquee-box`, `.toasts`, `.dlg-bg`, `#ctx-menu`, `#quick-wand`, `.brn-token-pop`, `#claude-pop`, `#mo-recover`, `.cq-bg`, `.mat-ghost`), `app/js/app.js` (`#qc-wheel`, `.cp-pop`, `.qr`, the brush ring, the tab frame in `spawn`, `WIN_LAYER`). Test: `tests/stylesheet-literals.test.cjs`.

![fix][fix] **The 3D view stayed soft (or needlessly heavy) after zooming the browser or moving the window to another screen.** The view's pixel ratio was set at start and when a model loaded, and nothing noticed devicePixelRatio change afterwards. Now the view picks up the new ratio as soon as it changes (still capped by the model's weight and Settings › Performance). Checked with the syntax check only, not on screen.
- Cause: no listener for a change of devicePixelRatio; a window resize does not always come with one, and onResize keeps the ratio it has.
- Where: `app/js/app.js`, `initRenderer` (`_followPixelRatio`, a media query on the current ratio that runs `applyPerfMode`).

![fix][fix] **The thumbnails of the shapes in the Add menu opened a second WebGPU device.** Their small renderer asked for WebGPU next to the viewport's and kept it for the session. It now draws on WebGL, like the library preview, with a context that keeps its picture for the read-back a frame later. The thumbnails keep their own tone mapping (ACES, brighter): they are accent-coloured icons, not previews of the view. Thumbnails already saved in the browser are kept. Checked with the syntax check only, not on screen.
- Cause: `new THREE.WebGPURenderer` without `forceWebGL`.
- Where: `app/js/app.js`, `_primThumb` → `init`.

![refactor][refactor] **A setting that did nothing is gone.** The renderer setup switched on `dithering` against banding, but this three.js version's WebGPU renderer has no such setting, so the line was skipped every time; a note says so in its place. Nothing on screen changes.
- Where: `app/js/app.js`, `_RendererOwner.applyConfig`.

![fix][fix] **Taking a screenshot made the view flicker, and the recent-file thumbnails did the same.** Every picture was meant to be drawn off screen and read back from the GPU, but that read-back failed every time, so each one fell back to resizing the live view for a frame. Pictures (Screenshot, Claude's render_image and the thumbnails) are now drawn off screen and read back without touching the view, with the same tone mapping and colour as the view shows; the old way stays as the fallback when a read-back is not possible (a picture larger than the GPU allows, for one). Checked headlessly on both renderers: the picture read back matches the one from the canvas pixel for pixel, the right way up, at 1000 px wide. Not checked by hand in the app.
- Cause: the pixel buffer was passed to `readRenderTargetPixelsAsync` as a sixth argument, as for the WebGL renderer; in three r172 that is the texture index (the data is returned instead), so the call threw "Invalid value used as weak map key", which a comment put down to "a known three.js issue". Fixing only that would have given darker pictures: a render target gets no tone mapping and stays linear. And on WebGPU r172 pads rows to 256 bytes without padding its buffer, and returns the top row first where WebGL returns the bottom row first.
- Where: `app/js/app.js`, new `_gpuCapture` (scene into a half-float target, a full-screen pass with `renderOutput` into an 8-bit one 64-px aligned on WebGPU, read back, cropped, rows in order), used by `_captureFrameAsBlobRun` and `_captureRecentThumb`. Test: `tests/e2e-capture.mjs` (`CAPTURE_GPU=1` for WebGPU on the machine's own GPU; headless SwiftShader has WebGL2 only).

![fix][fix] **The studio light and the HDRI lit a model from the side, and the HDRI's sky stood beside it.** The environments (the soft studio behind the plain backgrounds, the HDRI presets, a loaded .hdr or .exr) are made with their sky at +Y, and the scene is Z-up, so the studio's ceiling light fell on one side of every part instead of its top, and an HDRI's sky and ground lay to the left and right. They are now made standing on the scene's floor, and made again when Scene › Up axis changes; the HDRI background turns about the up axis, and in a Y-up scene the HDRI's sun light stands above the floor as well. Checked headlessly on WebGL2 and WebGPU with a white cube lit only by the environment: its top is now twice as bright as a side in the studio and blue-violet under Sunset with the side orange, in a Z-up scene exactly as in a Y-up one. Not checked by hand in the app; the reflections still do not turn with the sun puck (only the background and the sun light do: three r172 cannot turn an environment once it is made).
- Cause: three's environments are Y-up, and the node materials of three r172 ignore `scene.environmentRotation`; the background was turned about Z only. A comment said the turn worked for the diffuse light on WebGL2; it did not, on either renderer.
- Where: `app/js/app.js`, new `_envFromRoom`, `_envFromEquirect` (an equirect drawn onto a box round the PMREM camera with its lookup turned) and `_envFollowUp`; used by `_ensureStudioReflections`, `_ensurePresetEnv`, `_ensureHdriEnvironment`, `_loadCustomHdri` (which keeps the HDRI's source for a later change of axis); `_applyHdriRotation`, `_applyHdriSunPosition`, `_applySceneUpAxis`. Test: `tests/e2e-env-up.mjs`.

## Found, not fixed yet

![fix][fix] **A STEP file that holds only a face (no solid) is converted instead of being refused.** The converter's test expects exit code 3 and "no solid bodies found" for such a file; the converter now writes a one-mesh GLB and exits 0, both from the command line and through `/api/convert` (`tests/converter.test.py`: `t1_errors`, `t5_api_convert`, 14 of 16 pass). Either the converter should refuse it again or the test is out of date since the surface-body path was added; not decided here. Seen on 2026-10-17 while running the suite after the mirrored-face change, which does not touch this path (the two failures are the same with the change taken out, judged from the diff; not re-run without it).
- Where: `app/step2glb.py` (`_surface_bodies`, the XCAF path), `tests/converter.test.py` lines 406 and 681.

![fix][fix] **On the WebGL2 renderer the floor grid's lines (and the red and green axes) are drawn over parts.** The grid writes its own depth as the projected NDC z, which is 0..1 on WebGPU but −1..1 on WebGL; written to `gl_FragDepth` unconverted, it is too near, and the grid passes the depth test on any part farther than about half the distance to the floor behind it. Found by reading the code against three r172's WebGL backend, not yet seen on screen (open with `?webgl=1` to check). Fix: `z * 0.5 + 0.5` when `renderer.coordinateSystem === THREE.WebGLCoordinateSystem`.
- Cause: the comment at the depth write assumes WebGPU's depth range only.
- Where: `app/js/app.js`, `_makeShaderGrid` (`ndcZ`).

![fix][fix] **Group dots and point dots change size with zoom in the orthographic views (or stop keeping a fixed pixel size in perspective).** A `SpriteNodeMaterial` with `sizeAttenuation: false` picks its perspective or orthographic formula when its shader is built, from `camera.isPerspectiveCamera`; `DualCamera` switches that flag on the same camera object and the render object's cache key does not include it, so the shader keeps the formula of the projection it was first drawn in. Found by reading three r172, not yet seen on screen. Fix: give those two materials `customProgramCacheKey = () => (camera.isOrthographicCamera ? 'o' : 'p')`.
- Where: `app/js/app.js`, `_groupDotsEnsure` and `dotLayer` (the point picker).
