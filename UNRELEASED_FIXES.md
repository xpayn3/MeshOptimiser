# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.37.0**.

## New

## Fixed

## Found, not fixed yet

- **After a model opens, "Preparing the view" can stay up for the full 12 seconds on a slow graphics path**, even for a sheet
  of 128 triangles (seen in headless Chrome with software WebGL: the Gearbox at 14 s from file to view, the sheet at 11 s and more).
  The settle loop waits for four frames in a row no slower than 1.5 times the quickest frame so far (34 ms at least); one quick frame
  early on (a frame with little to draw) sets a bar that 150 to 200 ms frames never meet, so it runs to its cap. Since v0.36.0, not
  new. It also keeps the `load` task listed, which spoils several browser tests (`e2e-edit-sheet`, `e2e-edit-ortho-switch`,
  `e2e-recovery`: the loader covers what they measure). Not checked on a real graphics card.
  Where: `_settleView` in `app/js/app.js` (`even` / `best`). Found 2026-10-23 (`docs/test-sweep-2026-10-23.md`).

- **F5 while "Preparing the view" is up says "A file is still converting… you would have to start the import again"**, though
  the model is already in the scene. The reload guard counts the tab's `load` task as a conversion, and that task stays listed through
  the settle stage. Seen in `e2e-recovery` (2026-10-23).
  Where: `_convertingNow` and the F5 / Ctrl+R handler in `app/js/app.js`.

- **Browser tests that are out of date** (they test what the app no longer does; the app is right), found 2026-10-23:
  `e2e-dof` (presses Alt+click to set the focus; it is Ctrl+click since the lens rings), `e2e-texsets` (expects a DirectX OBJ normal
  map at `normalScale.y = -1`; since 9a8bc49 OBJ maps are turned on import and a DirectX one ends at +1, which
  `e2e-normal-map-direction` proves by its picture), `e2e-edit-cache` (looks for the picked dots at `renderOrder` 12; now 19),
  `e2e-drag-cursor` (scrubs the first `.scrub-value` it finds, now the greyed Shading angle bar with nothing selected),
  `e2e-mcp-server` (expects the Claude pill's dropdown below the pill; the pill is in the status bar since v0.35.3 and opens upward),
  `e2e-update` (rewrites `v0.21.0` in the brand menu's version, which now reads `v0.37.0`, so the reload checks never see the
  new version). Five tests (`e2e-animate-multi`, `-cmd-card-grow`, `-dof`, `-photo-pictures`, `-split-material`) default to
  port 4343 and need `APP_PORT=4242` against the user's server.

- **ASCII FBX (the export dialog's ASCII option) still leaves the pictures out**; the binary FBX (the default) carries them. Found
  2026-10-23.

- **Blender marks an OBJ's normal map as sRGB** instead of Non-Color (its OBJ importer does it whatever the .mtl says; it reads
  `map_Bump`, not `norm`), which bends the normals a little. The FBX's comes in as Non-Color. Nothing to do in the .mtl.

- **`e2e-photo-average` fails 7 of 15 on 2026-10-23**: the average of a still view reaches 15 to 25 of its 32 frames before the test
  stops waiting, so the checks that need all 32 fail. The same with the new softboxes switched off, so not from them. Looks like time
  (SwiftShader, with another session's headless Chrome running on the same machine); not compared with v0.36.1, which would need a
  second server. Not looked into further.

- **`e2e-edit-sheet` gives different results from run to run since the three.js r186 upgrade**: the sheet's dots seen from the front or
  the back, and the picked edges, are counted as not drawn in some runs (the dark pixels with the dots on equal those with them off). The
  same with three-mesh-bvh 0.8.3 and 0.9.16, so it is the rendering of the marks, not the picking. On 2026-10-23 its screenshots showed
  the dots drawn from both sides, with the "Preparing the view" loader still over the middle of the view where the test counts (see the
  12-second settle entry above): the count is spoiled, not the dots.

- **`inbox/GearboxAssy.glb` carries a note now** ("Check this bolt please.", with a screenshot), saved into it on 2026-10-22 at 15:46,
  most likely by a Claude session (`add_note` and a save over the file). The file is local (git ignores `inbox/`); tests that count
  notes on it were off by one. Worth putting the clean sample back.

- **`e2e-isolate` on the Gearbox, seed 4242, fails at its eighth step on a busy machine**: after a second scene tab is opened and the
  first one switched back to, the first shows no parts for the moment the test looks. It passed 84/84 on 19cbd3f, and passes for
  another session on the same checkout as it fails here; seed 618581 failed at the same step earlier and passed alone. Timing under
  load (several sessions running headless Chrome at once), not seen by hand: a probe that waits after the load saw all 95 parts at
  every moment after the switch. Not looked into further.

- **A STEP whose name is about 190 characters long fails late on Windows without long paths** (Settings › long paths off, the default):
  it uploads and converts, then fails writing its B-rep file with "step2glb.py exited with code 1". Where: `app/serve.py`,
  `_sanitize_filename` (a cap of 200 characters that does not count the folder). Found in the review of 2026-10-21; not seen here, where
  long paths are on.
