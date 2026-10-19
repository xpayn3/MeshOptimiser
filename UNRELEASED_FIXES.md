# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.35.0**.

## New

![perf][perf] **Big STEP files are meshed on all cores.** After the file is read, the parts are meshed and turned into triangles in several processes at once (up to eight, half the cores), where OCCT's own threads reached little more than one core. On a 357 MB V8 engine (1,295 solids) that step went from 26.5 s to 10.4 s and the whole import from 103 s to 81 s; on a 45 MB transmission from 7.4 s to 4.8 s, and with Even curved faces from 23 s to 7 s. Small files (under 5,000 CAD faces) are meshed as before, since starting the processes would cost more. The mesh is the same in size and quality but not bit for bit: OCCT meshes a part a hair differently when it is not meshed inside the whole model (on the V8, 42 triangles fewer of 1.79 million, 37 of 254 meshes a few triangles apart, and one more face of 72,000 that the mesher gives up on). Cancel stops the processes too. Reading the STEP itself (about 64 s of the V8's 103) is unchanged: it is OCCT's and runs on one core.
Where: `parallel_mesh_products` and `_worker_mesh_extract` in `app/step2glb.py`, called from `convert`; `--mesh-jobs N` (0 or 1 = in one process as before, default by the size of the model). With `--brep` or *A part per colour* it meshes in one process.
Test: `t4_mesh_jobs` in `tests/converter.test.py` (nodes, instances, colours and colour runs the same as in one process, triangles within 1 %, with and without size groups).

![new][new] **A tool's card shows the Wireframe on the part in work only.** Fill solid round, Fill round grooves, the mesh tools and Voxel remesh switch the view to Wireframe while their card is open, so each step of the sliders is seen; the lines now go on the parts the card rebuilds and the rest of the model stays as it was. Closing the card puts the view back; a Wireframe switched on by hand afterwards draws every part again. Not yet checked on a part drawn as instances (it shows no lines while a card is open).
Where: `_wireLimit` and `_wireOnlyHosts` in `app/js/app.js` (used by `_wireSync`), called from `offer` and the `cmd-close` handlers of `_RoundSpin`, `_MeshOps` and the Voxel remesh card.
Test: `node tests/e2e-round-wire.mjs` (fails without the change: the block beside the spool had lines too).

![new][new] **The default light is brighter.** The studio reflections on the plain backgrounds are nearly twice as strong (0.5 to 0.9) and the exposure starts at 1.15, so shaded sides and dark parts read more clearly. Not yet checked against saved scenes, which keep the exposure they were saved with.
Where: `_STUDIO_REFL` and `applyConfig` in `app/js/app.js`, `state.exposure`, the hidden `#light-exposure` in `app/index.html`.

![new][new] **The recent-tools list is plain text.** Holding or right-clicking the button at the left of the viewport toolbar lists the last tools as names only, with no icon in front, and a command's shortcut sits at the right when it has one. Checked by seeding the list and reading the rows; not yet looked at with a real model.
Where: `vp-last-pop` in `app/js/app.js`, `.vp-last-item` in `app/index.html`.

![new][new] **The switches in the command cards are the small ones.** Dynamic place, Fill holes and the other cards use the same 30 x 16 switch as the right sidebar instead of the larger 34 x 20 one. The Draw card keeps its own size. Checked by measuring the switches in the open Dynamic place card.
Where: `.section-cmd .toggle .switch` in `app/index.html`.

![new][new] **The number rows of the Remesh card sit closer.** Shading tolerance, Dissolve nearly flat within and Surface may move are 6 px apart instead of 14. Checked by measuring the rows.
Where: `.section-cmd[data-cmd="remesh"] .cmd-num` in `app/index.html`.

![new][new] **The Advanced lists of the command cards are evenly spaced.** In Remove holes and the other cards every switch row and every number row is 32 px high with 4 px between, so the labels at the left are 36 px apart all the way down (the switch rows were 25 px and the number rows 40 px high; number fields are 32 px, as in the right sidebar). The main sections of the cards (Dynamic place, Lettering, Pivot, Floating, Fasteners, Sweep, Normals, Repair) and the Remesh card have the same 32 px rows with 4 px between; only the Draw card keeps its own 34 px rows. Checked by measuring every row of every command card.
Where: `.cmd-adv-b` rules after the small switch in `app/index.html`.

![fix][fix] **A tool run by its key did not show up in the recent list.** Pressing P for Remove holes (or X, U, B, L, D, H, Ctrl+B and the other keys) ran the tool but left it out of the recent tools; now it is listed like one picked from the search. Checked by pressing P and reading the list.
Cause: the key table runs the tool directly, and only a command's own run noted it as used.
Where: the key handler's use of `_KEYMAP` in `app/js/app.js`.

![polish][polish] **The right sidebar lists its cards with no section titles.** The headings View, Find, Review and Optimise are gone; the cards follow one another 8 px apart. Checked by measuring the cards; not yet looked at with a model open.
Where: `#sidebar-right .side-group` in `app/index.html` (the elements stay, because `notes.js` places its Review card by them).

![polish][polish] **Some search entries have short names.** It read "Close open edges: cap every rim where the surface stops" in the search and in the recent tools; the extra words still help the search find it. "Highlight back faces (flipped normals in red)" is now "Highlight back faces"; "Model inspector: everything about the model, and what is broken in it" is "Model inspector"; "Add a note: click a spot on the model" is "Add a note"; "Quick colour wheel: hold C over the model, click a colour" is "Quick colour wheel".
Where: the `closeOpenEdges`, `normalsHighlight`, `inspectModel`, `noteAdd` and `quickColour` labels in `_Actions` in `app/js/app.js`.

![polish][polish] **The start screen has no Help button.** The top right keeps Claude mode and the close button; Help is still in the search (Shift+C) and on F1. The New scene tile says "Start with an empty scene" (it said "Start with nothing"). The Open file tile says "or drop one here" (it said "or drop one anywhere here").
Where: the `welcome-help` button in `app/index.html` and its click handler in `app/js/app.js`.

![polish][polish] **Smart optimise and Reduce triangles are floating command cards, not cards of the right sidebar.** They open over the view like Remove holes and the others, from the search ("Smart optimise…", "Reduce triangles…", "Fit to triangle budget"), with the same controls, recipes and buttons; Esc or Cancel puts them away and Enter in Smart optimise runs it. The sidebar no longer has the Optimise group. Claude's tools and the context menu entries work as before. Checked by opening both from the search with a cube in the scene; not yet run on a heavy model, and the docs and the site still say "card in the right sidebar".
Where: `.section-cmd[data-cmd="smart"]` and `[data-cmd="reduce"]` in `app/index.html` (same element ids as before), the `smartopt`, `reduceTris` and `budget` actions in `app/js/app.js`.

![polish][polish] **Moving from one submenu to the next no longer opens it again.** In the right-click menu, the File menu and the "…" toolbar menu, a list opens with its short fade the first time; moving the pointer from Views to Display or More swaps the list at once, with no new fade. Checked by hovering two rows in the right-click menu.
Where: `_ctxSub` in `app/js/app.js`.

![polish][polish] **Settings: the group cards show no number.** A group such as Motion no longer has the count of its settings next to the fold arrow.
Where: `_structure` in `app/js/app.js`.

![polish][polish] **The titles of the Settings panes are in the serif.** General, Appearance and the others are in Fraunces Light at 28 px, like the other window titles (they were in the UI font, semibold).
Where: `.set-pane-h` in `app/index.html`.

![polish][polish] **Notes, Photo mode, Scene and Animate are at the bottom of the right sidebar.** The order ends: Delete small parts, Notes, Photo mode, Scene, Animate (the Animate card shows only while Animate is on); Quick fixes is above Exploded view (they were under Properties and Shading, and Notes above Heavy parts).
Where: the `scene-section` and `photo-section` blocks in `app/index.html`; `buildCard` in `app/js/notes.js` places Notes above Photo mode.

![polish][polish] **Split card: even spacing, a wide enough Weld tolerance box, and no stray letter.** The Weld tolerance value ("1e-6 × diag") no longer runs into its unit, the gaps between the slider, the readout, the Algorithm list, Smallest part and the green result line are the same, and the readout says "Welds within 0.17 µm at this model size" (it said "within H").
Where: the Split card in `app/index.html` (`.section-cmd .scrub-value` for a long unit), `Welds within` in `app/js/app.js`.
Test: `node tests/cmd-cards-markup.test.mjs` (every command card keeps its own footer; fails on a card that closes early).

![fix][fix] **The "…" toolbar menu had no way to open Smart optimise and Reduce triangles.** It lists both now, and "Fit to triangle budget" opens the Reduce triangles card with the budget field ready.
Where: `_openCommandsMenu` in `app/js/app.js`.

![polish][polish] **A closed card of the right sidebar is 40 px tall.** It was 44 px; the header row of every sidebar card is 38 px now (8 px above and below), so more cards fit in view.
Where: `#sidebar-right .section>.section-h` padding in `app/index.html`.

![polish][polish] **The name of a picked row in the parts tree, part or group, is a lighter blue.** It was the same blue as the row's tint and hard to read; it is about half way to white now (a clear contrast on the dark row). The icon in front of it keeps the full blue. A picked group's name has the same lighter blue. The + / - box of a row stands 4 px from the icon after it (it was 7 px).
Where: `.tree-node.selected .tree-label` and `.tree-node.is-group.selected .tree-label` and `.tree-node>.tree-expand` in `app/index.html`.

![polish][polish] **The greys of the text are a little lighter.** Labels and hints in every panel read more clearly on the dark surfaces: the second text grey goes from #b0b0b0 to #bcbcbc and the third from #8c8c8c to #9a9a9a. Not yet looked at in the Appearance themes.
Where: `--tx2` and `--tx3` in the first `:root` of `app/index.html`.

![polish][polish] **Smart fit: the labels fit on one line.** The Advanced rows read Cylinder roundness, Cylinder vs box volume, Length to width and Use the part's axes (the third wrapped onto two lines before).
Where: the `fit-circ`, `fit-waste`, `fit-aspect` and `fit-pca` labels in `app/index.html`.

![polish][polish] **Select hidden and Remove hidden faces: the Fast, Normal and Thorough switch fills the width of the card, without the word Accuracy.** Its tooltip still says what it does.
Where: the `#sh-views` and `#hf-views` rows and `.cmd-num>.cmd-seg:only-child` in `app/index.html`.

![polish][polish] **The command cards have no picture on top any more.** Remove holes, Smart fit, Select hidden, Fasteners and Split lost their moving line drawing and look like the other cards: the title in the card's own header, one blue button that runs the command.
Where: the five `figure.cmd-hero` blocks and the `has-hero` styles taken out of `app/index.html` (the cards are `cmd-blue` now); the fold of the picture when Advanced opens (`_advTurn`) and the picture as a drag handle taken out of `_CmdCards` in `app/js/app.js`.
Test: selftest "command panels: Split and Remove holes show on demand…" now checks that the cards carry no picture.

![polish][polish] **The floating command cards share one row rhythm.** Every switch and number row in every card has the same small padding, small type and no line above it, and rows that follow each other sit the same short distance apart, in a card's body and under Advanced alike (before, it was 0, 2, 6 or 10 px depending on the card). The Draw card keeps its framed groups with the same type, label colour and switch.
Where: `<style id="cmd-rhythm">` in `app/index.html`; the card-only row overrides of Remesh, Edit mesh and Axis and the Draw card's own switch sizes taken out. Checked by measuring all 26 cards headless (every pair of visible rows 2 px apart).

![polish][polish] **Shorter labels in Remove holes, Select hidden, Remove hidden faces and Fasteners.** Blind holes, Seal hollows, Leftover vertices, Inner pieces, Raised details, Up to; Glass blocks the view, Add to selection, Max part size. The tooltips keep the full explanation. The docs (`site/docs-content.js`) still use the old names and need the new ones with the release.
Where: the `fh-*`, `sh-*`, `hf-glass` and `fa-add` labels in `app/index.html`.

![polish][polish] **Windows, menus and the bars over the view cast one kind of shadow, in three levels, the way macOS draws them.** A close contact shadow for the edge and a wide soft one that falls a little down and spreads round every side, where the windows had a dark band under the bottom edge only; windows also get a dark half-pixel outline. Bars and pills over the view are lowest, menus, popovers, tooltips, toasts and the command cards next, windows (dialogs, Settings, Export, the command palette) highest. About a dozen menus and popovers that had a shadow of their own (Export's share menu, the B-rep face popover, the animation key menu, the Claude pop-up, the recovery bar, the quick ring) use the levels now.
Where: `--surface-shadow-bar`, `--surface-shadow`, `--surface-shadow-win` (and `-off`, `--surface-ring-dark`) in `app/index.html`, with `--sh` and `--sh-pop` pointing at them; the quick ring's styles in `app/js/app.js`.

## Fixed

- ![fix][fix] **While the app stood still, the page was changed several times a second for nothing, and a drag that followed paid for it.** The Reduce card's count was written again every 200 ms whether or not it had changed (its empty text never read back as empty), the fps readouts every 500 ms, and each write had the status bar measure every one of its items again, a layout of the page. Each readout now remembers what it last wrote and writes only a change, and the status bar measures only the items whose text changed. Measured headless on the Gearbox assembly: 30 changes of the page in 6 s of idling before, none after.
Cause: `_updateDecCount` comparing `info.textContent` with `''`; the fps block of `tick()` writing unconditionally; `_statusBarWhole.fix` re-measuring every item on any text change.
Where: `_updateDecCount`, the fps block of `tick()` and `_statusBarWhole` in `app/js/app.js`.
Test: `node tests/e2e-idle-writes.mjs` (fails without the fix).

- ![fix][fix] **Turning off Materials in the STEP import settings changed nothing.** The materials are now left unread when the switch is off, as the window says; colours, layers, names and part numbers come in as before.
Cause: the converter asked the reader for `SetMaterialMode`, which is the writer's name; the reader's is `SetMatMode`, so the `getattr` found nothing and the setting was skipped without a word (OCP 7.9.3). It saves little time (all the read modes together moved the V8 engine's transfer by about 2 s of 48).
Where: `app/step2glb.py`, `parse_step_xcaf` (the list of reader setters; both names are tried).
Test: `t4_no_materials` in `tests/converter.test.py` (fails without the change: the bolt still carried Steel 1.0037).

- ![fix][fix] **A slider scrub, a sidebar resize, a material drag and a drag in the tree each started and ended with a stall on a big model.** Each set its cursor with a rule on every element of the page from a class on the body or the root (`html.is-scrubbing *` and the like): a style of every element again, 60 ms on a page with a tree of a thousand parts, at the start and the end of the drag. One element over the whole window carries the drag's cursor now (1 ms), text selection is held off by swallowing `selectstart` meanwhile, and the drags that ask what is under the pointer look through that element. The closed library dock, the console and the closed dialogs also keep their contents out of every style of the page now (`content-visibility: hidden` while closed), so what remains of a page-wide style, as when a mode is switched, is a third shorter: 60 ms to 37 ms on the Scania V8. Not yet checked: a dialog that measures its own contents before it is shown would read zero sizes; none was found, and the smoke, save and Alt tests pass.
Cause: `html.is-scrubbing *`, `body.mat-dragging *`, `body.resizing *` and `body.dnd-active .tree-node` in `app/index.html`, toggled by the scrubber (`initScrubber`), the sidebar handles (`#resize-l`, `#resize-r`), the materials dock's `startPointerDrag` and `_dndBegin`/`_dndCleanup`.
Where: `_dragCursor`, `_dragCursorOff` and `_underPointer` in `app/js/app.js` (before `_wireModifierRing`), the four drags, and `#drag-cursor`, `#app.resizing` and the `content-visibility` rule in `app/index.html`.
Test: `node tests/e2e-drag-cursor.mjs` (fails without the fix: the rules are in the stylesheet, and a sidebar resize puts `resizing` on the body).

- ![fix][fix] **With Alt, Shift or Ctrl held, orbiting, panning and zooming started late and stuttered, where the same drag without the key was smooth.** The app hides Chrome's focus ring while only a modifier is held after a click, and did it with a class on the `<html>` element under a rule for every descendant: each modifier press, and the mouse press after it, had the browser look at every element of the page again, 55 ms on a page with a tree of 1295 parts, paid by the first pointer handler that reads the layout, and again on every repeat of the held key. The class now goes on the focused element alone, and when nothing is focused nothing is done. Measured in Chrome on the Scania V8: a forced layout after an Alt press cost 54 to 60 ms and the press that followed the same; plain presses cost 0. On the way there, three smaller costs went too: the shortcut listeners asked nine times per key event whether a dialog is open with a selector over the whole document (now two live collections); every pointer move took an absent class off the body (now only when it is there); the toolbars over the view were measured and moved one at a time (now measured together).
Cause: `_wireModifierRing` toggling `html.no-mod-ring` under the rule `html.no-mod-ring :focus-visible`; also `_modalOpen`, `_move` of the library's placing tool, and `_vpcWhole.one`.
Where: `_wireModifierRing`, `_modalOpen` and its callers, `_move` (dyn placing) and `_vpcWhole` in `app/js/app.js`; the rule `.no-mod-ring:focus-visible` in `app/index.html`.
Test: `node tests/e2e-alt-keys.mjs` (fails without the fix: the root element carries the class after a click and an Alt press; 279 document queries for 31 Alt events; 40 body rewrites for 40 pointer moves; `GPU=1` runs it on the graphics card).

- ![fix][fix] **The recovery copy of a big scene held the page for a fifth of a second, once in a while, right when work resumed.** The copy is written when the page has been quiet for a moment; on the Scania V8 (2.9 million points, 54 MB) the glTF writer took 180 ms on the main thread in one task, and a pan begun in that moment started late. The writer now gives the page its turn between parts (a recovery copy asks for it; a save to a file is still written in one go), copies an attribute's array in one go instead of writing every component through a DataView, remembers each attribute's range by its version so a later copy of the same geometry reads it back, and lays the file out in one buffer with one copy of the data instead of five Blob and FileReader passes; the building of the export root and the final assembly get a task each as well. The file is the same byte for byte (checked against the original writer on a scene of float, unsigned and signed normalized integer attributes and 16- and 32-bit indices; a signed normalized 32-bit attribute keeps the original path). Measured on the V8: one task of 182 ms before, no task over 50 ms after; the writer alone 340 ms to 67 ms on a mesh of a million points. Not yet checked: a copy written while the user edits between its slices would hold parts from before and after the edit; a crash copy is taken only after 2.5 s of quiet, and each part is written whole.
Cause: `getMinMax` and `processBufferView` in three's `GLTFExporter` going through getX() and DataView writes per component; its binary assembly through two Blobs and two FileReaders; the whole copy in one task.
Where: `app/vendor/three/examples/jsm/exporters/GLTFExporter.js` (`getMinMax`, `processBufferView`, `writeAsync`, the `yieldMs` option); `_saveSceneImpl` in `app/js/app.js` (the `breathe` steps and `yieldMs: 8` for the recovery copy). The copy itself is `_Autosave.snap`.
Test: `node tests/e2e-recovery-copy.mjs` (no long task during the copy; `inbox/v8.glb` for the real check, fails without the fix), `node tests/e2e-recovery.mjs` and `node tests/e2e-save-roundtrip.mjs` (the saved file is read back unchanged).

- ![fix][fix] **A right-click on a button of a toolbar in the view opened the view's menu (Fit view, Select all…).** It now opens the toolbar's own list of every command, the one the "…" button opens, at the pointer, on every toolbar floating in the view and on the toolbar between its buttons. Buttons with a list of their own (the gizmo buttons, Last tool, Clay and CAD, the view and Edit mesh switches) keep it. A right-click on the view itself still opens the view's menu.
Cause: the view's menu answered every right-click inside `#viewport`, and the floating toolbars are in it; only the Clay and CAD buttons were left out.
Where: `_VP_TOOLBAR_SEL` and the contextmenu listener after `_openCommandsMenu` (which now takes a point) in `app/js/app.js`; the view's menu skips that selector.
Test: selftest "toolbars: a right-click on a toolbar button in the view opens the toolbar list, never the view menu".

- ![fix][fix] **In Edit mesh, the blue lines and the picked edges went over the points.** The dots are now drawn before the lines of Edit mesh, and a second, colourless pass of the dots writes their depth with the whole disc lifted for the steepest face (as the lines are lifted), so that the lines, drawn after it and tested against it, are kept out of every disc, even where a dot's own face cuts its edge (a point right on the silhouette, fading out and cut by the near side, keeps no line out of the few pixels left of it). The blue lines and the orange outline of picked polygons leave no depth behind (as the wide lines and the fills already did). Checked on WebGPU and WebGL2 in headless Chrome, on a cylinder whose rim points sit on a sharp corner; not yet on a model with hundreds of thousands of points (the second pass draws the dots once more, without colour).
Cause: `WIRE_MAT` and `OUTLINE_MAT` in `_Elements` wrote depth from where `_pulledPosition` had moved them, nearer the camera than the dots, which are tested at the depth of the surface; and the wide lines (render order 9 and 10) were drawn after the plain dots (8).
Where: `dotLayer` (the depth pass, `DOT_DEPTH_ORDER`, and the pixel's rise capped at `DOT_RISE_TAN_MAX`), `wireMat`, `outlineMat`, `DOT` and `FAT` in `_Elements`, `app/js/app.js`.
Test: `node tests/e2e-edit-dots.mjs`, the check "the dots are over the lines" (fails without the fix: 71 of 72 dots had a line through the middle).

- ![fix][fix] **In Edit mesh, the points of a part showed through another part in front of it: a ring of dots on a cover.** A dot on a face seen nearly edge-on was pulled towards the camera by up to twenty times its radius, so that its own face would not cut it, and a part a few millimetres in front of that face no longer hid it. Each pixel of a dot is now tested at the depth of the surface under it (up the slope by the slope, at a corner by the turn of its faces), so the disc is still not cut by its own faces and nothing but its edge can stand nearer than the surface it is on. Checked on WebGPU and on WebGL2 in headless Chrome; not yet on a model with hundreds of thousands of points.
Cause: `dotLayer` in `_Elements` (`app/js/app.js`) lifted the whole sprite along the view by `reach × tan(slope + spread)`, capped at tan 87°.
Where: `dotLayer`: the sprite's `positionNode` keeps only the depth-step pull; `depthNode` gives each pixel its own depth.
Test: `node tests/e2e-edit-dots.mjs` (fails without the fix: 849 dark pixels of the ring's dots in the middle of the cover; `GPU=1` runs it on the graphics card, `ANGLE=1 SHOT=x.png` saves the app's own angled view for a look).

- ![fix][fix] **Zoomed far out, the floor grid broke into stairs and dots.** The grid worked out each pixel's ray with the camera's distance from the origin inside the same 32-bit numbers as the pixel's own small part; a few hundred metres out (in a scene in millimetres) the small part was rounded away and runs of pixels shared one ray, so the axes came out stepped and the fine lines as dots. The rays are now worked out relative to the camera, and the grid stays a clean line at any distance. Checked on WebGPU and WebGL2, in perspective and in the orthographic views.
Cause: `uInvViewProj` (the inverse of projection × view, in float32 on the GPU) carried the camera's translation; its entries then held a number of the camera's distance beside the pixel's part of the sum, which is under 1.
Where: the per-frame update of the grid's uniforms in `tick()` (the view goes in without its translation) and `rayOrg` in `_makeShaderGrid`, `app/js/app.js`.
Test: `node tests/e2e-grid-far.mjs` (fails without the fix: steps of 8 to 9 pixels on the axis lines).

- ![fix][fix] **A few seconds after a tool, a part stopped drawing and the console filled with "Vertex buffer slot 1 required by [RenderPipeline ...] was not set".** It came back only when the part was moved, and the viewport's own answers (normals, upload the parts again) held only until the next clean-up. Freeing a geometry nothing refers to any more now frees that geometry's own buffers and leaves the ones the part draws with alone. Not yet checked in a long session on a real model.
Cause: three r172 frees a disposed geometry's GPU buffers by asking the render object that first drew it for its attributes; after a tool or Undo gave the part another geometry, those are the new geometry's. The sweep of unreferenced geometries (and the purge of deleted parts) then destroyed the buffers the part was drawing with, and three uploads a part again only when the part itself changed (matrix, material, buffer versions), a check that parts which look alike share, so nothing put them back.
Where: `_fixGeometryDispose` in `app/js/app.js`, installed in the renderer's `create()` beside `_hookGpuErrors`.
Test: selftest "gpu: freeing a geometry a part no longer draws leaves the buffers the part draws with alone" (fails without the fix on WebGPU and on WebGL2). Whole selftest on WebGPU, headless on this PC's GPU: 56 of 60, the same four failures as without the fix (repeats, and three export tests).

## Found, not fixed yet

