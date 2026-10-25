# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.37.1**.

## New

## Fixed

- ![fix][fix] **Review of v0.37.1: eight faults found by reading the code.** (1) *Texture size* in the export window swapped the images of the live textures while the file was written, so a texture uploaded to the graphics card in that moment kept the small copy; the textures are now uploaded again from their own pictures afterwards. (2) The History card tagged "Opened" as *Saved* on a new, blank scene; a new scene has no tag now (a file just opened still has it: it is as saved). (3) The fault overlays of the Model inspector built one set of buffers for every copy of a mesh; the copies share one set. (4) The overlay of a part shown as a copy stayed where it was drawn first; it follows its copy at every frame now. (5) Edit mesh could still be used on a library shape when it was already open; it closes (with the "Bake geo first" note) when one is picked. (6) *Pictures as WebP* made the normal, roughness and other data maps lossy too; only the colour pictures are written as WebP now. (7) Animate noted where it had put each part with a second world-matrix update; it reuses the one it has just made. (8) The shadows' start-up reset also ran when the page finished loading and could switch off a choice made before that; it runs once. Not changed: a part moved in the very frame the explode amount changes is still not adopted (one pointer cannot do both). Not checked: the overlay of a part shown as a copy moving with its copy, by eye.
  Where: `shrinkExportTextures`, `setExportTextureFormats` (`COLOUR_KEYS`) in `app/js/texformat.js`; `wasSaved` in `_Dirty` and `app/js/history-card.js`; `refreshOverlays` in `app/js/app.js` and `instance` in `app/js/geo-overlay.js`; the selection follower and `setMode` of the Edit mesh module; `rootPoseOf` in `app/js/anim.js`.
  Test: `tests/texformat.test.mjs` (28 checks), `tests/e2e-prim-edit.mjs`, `tests/e2e-history-card.mjs`.

## Found, not fixed yet

- **`e2e-uv-split` fails "the toolbar is at the foot of the pane, under the layout"**: in the pane the tool pill (Select, Move, Rotate, Scale, the pick modes) lies over the foot of the layout, not under it. 65 of 66 checks pass. Not from the colouring fix; the pane (`uv-split.js`, `#uv-pane`) is another session's unreleased work. Found 2026-10-24.
  Where: `tests/e2e-uv-split.mjs`, the layout of `#uv-pane` in `app/index.html`.

- **Other places still swap a part's geometry on their own.** Reduce (`decimate-card.js`) does not refresh the CAD lines of the part (`_cadEdgesPartSwapped`), clear the old edge buffers or free the old name; Bake frees no old name; Remove holes keeps one geometry for parts that share a shape, so it cannot use the per-part routine as it is; about 25 places in `app.js` have their own copy. Whether the missing steps leave stale CAD lines after Reduce on a part with its lines shown has not been tried.
  Where: `_swapPartGeometry` (the model), `app/js/decimate-card.js`, `app/js/bake-card.js`.

- **`e2e-round-card` fails its last-but-one check, "and say why"**: it expects "This step is no longer the last one" after Apply, Ctrl+Z and a change of Segments around, but `round-card.js` now clears the card's step on undo (the card goes back to Apply, uncommitted work of another session), so the options build nothing and say nothing. The test needs the new behaviour. Found 2026-10-24.
  Where: `tests/e2e-round-card.mjs` (line 203), `app/js/round-card.js` (the undo handler).

- **ASCII FBX still leaves the pictures out** (the export dialog now says so beside the switch; the binary FBX, the default, carries them). Blender cannot read ASCII FBX at all, and no reader that can was at hand to try pictures against, so
  the writer was not extended. Where: `_exportFbxAscii` in `app/js/export-writers.js`. Found 2026-10-23.

- **Blender marks an OBJ's normal map as sRGB** instead of Non-Color (its OBJ importer does it whatever the .mtl says; it reads
  `map_Bump`, not `norm`), which bends the normals a little. The FBX's comes in as Non-Color. Nothing to do in the .mtl.

- **`e2e-edit-sheet` gives different results from run to run since the three.js r186 upgrade**: the sheet's dots seen from the front or
  the back, and the picked edges, are counted as not drawn in some runs (the dark pixels with the dots on equal those with them off). The
  same with three-mesh-bvh 0.8.3 and 0.9.16, so it is the rendering of the marks, not the picking. On 2026-10-23 its screenshots showed
  the dots drawn from both sides, with the "Preparing the view" loader still over the middle of the view where the test counts (see the
  12-second settle entry above): the count is spoiled, not the dots. Run again on 2026-10-24, after the settle change above: `e2e-edit-sheet` 7 of 7 and `e2e-edit-ortho-switch` 6 of 6 in one run each, so the loader no longer covers the view; one run is not enough to call it stable, so the entry stays until it has held for a few more.

- **`e2e-isolate` on the Gearbox, seed 4242, fails at its eighth step on a busy machine**: after a second scene tab is opened and the
  first one switched back to, the first shows no parts for the moment the test looks. It passed 84/84 on 19cbd3f, and passes for
  another session on the same checkout as it fails here; seed 618581 failed at the same step earlier and passed alone. Timing under
  load (several sessions running headless Chrome at once), not seen by hand: a probe that waits after the load saw all 95 parts at
  every moment after the switch. Not looked into further. On 2026-10-24 it passed 79 of 79 with a random seed (377253) on a quiet machine.
