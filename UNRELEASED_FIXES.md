# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.36.1**.

## New

- ![new][new] **Claude can set up Photo mode.** A new MCP tool, `photo_mode`, switches it on or off and sets the lights, backdrop,
  finish, quality, floor, every effect (depth of field, occlusion, glow, vignette, grain, colour fringe, contact shadow, floor
  reflection) and the focus (the pivot, the middle of the view, or a part by id or name); the Photo mode card shows what was set.
  `render_image` and `screenshot` with `photo_mode` true keep those settings. `set_camera_view` can now also turn, tilt and zoom the
  camera round the model (`turn_deg`, `tilt_deg`, `zoom`, and `view` current) and set the lens (`lens_mm`, the camera moved so the
  model keeps its size: 85 mm gives the flat look of a product photo).
  Where: `app/js/app.js` tools `photo_mode`, `set_camera_view`, `_Photo.setFocus` / `hitAt`; `app/serve.py` `MCP_TOOLS`.
  Test: `tests/e2e-mcp-photo.mjs` (24 checks); `e2e-mcp-tools` still passes (199). Needs serve.py restarted to be listed to Claude.

- ![new][new] **Picture quality switches** under Settings › Performance. *Sharp textures at an angle* (on) keeps textures on a
  slanted surface sharp; *Finer shadows* (off) draws the sun's shadow from a 4096 px picture instead of 2048, for crisper edges on a
  large model and up close (about 50 MB more graphics memory). Both apply at once, are remembered, and every open tab follows.
  Where: `app/js/app.js`, `_gfxSharpTex` / `_gfxApplySharpTex`, `_gfxFineShadows` / `_shadowMapSize` / `_gfxApplyShadows`, the Performance pane.
  Test: `tests/e2e-texture-anisotropy.mjs` (both switches, SwiftShader and GPU); `e2e-shadows` and `e2e-copy-shadows` still pass. The
  difference Finer shadows makes has not been judged by eye yet.

## Fixed

- ![fix][fix] **Photo mode pictures had the CAD edge lines on them** (thin dark outlines round every face, like ink on a render).
  Photo mode now hides them, and they come back when it is left.
  Cause: the edge lines are children of the parts and Photo mode drew the scene as the viewport has it.
  Where: `app/js/app.js`, `_Photo` enter / leave (the shared `_CAD_EDGE_MAT` hidden).
  Test: `tests/e2e-mcp-photo.mjs` (89 edge lines on the Gearbox, none drawn in Photo mode, drawn again after).
  (A report that Photo mode renders were stretched was measured and is not a bug: a sphere comes out round at 16:9, 1:1 and 9:16. The
  long look was the wide 45 degree lens close up; `lens_mm` is the answer.)

- ![fix][fix] **Textures went blurry on a surface seen at a slant** (a table top going away from the camera smeared into a soft
  wash). Every texture of a model, and every texture added in the material editor, is now filtered at the graphics card's best
  (anisotropic filtering, 16 on nearly every card), so the grain stays sharp at a grazing angle.
  Cause: three.js loads textures with anisotropy 1, so a slanted surface is read from the small mip levels; nothing in the app raised it
  (only the paint flakes and the measure labels had their own).
  Where: `app/js/app.js`, `_sharpTex` / `_sharpenTextures`, called from `_ingestSceneRoot` (every format), the material editor's `_loadTexture`,
  `_applyTextureSets` (textures picked from a folder) and `_pasteForeign` (parts pasted from another window).
  Test: `tests/e2e-texture-anisotropy.mjs` (SwiftShader and, with `CAPTURE_GPU=1`, the machine's GPU; fails with 1 without the fix). Not
  checked by eye on the table model, and textures made inside the app (baked, painted) are not covered.

## Found, not fixed yet

- **`e2e-edit-sheet` gives different results from run to run since the three.js r186 upgrade**: the sheet's dots seen from the front or
  the back, and the picked edges, are counted as not drawn in some runs (the dark pixels with the dots on equal those with them off). The
  same with three-mesh-bvh 0.8.3 and 0.9.16, so it is the rendering of the marks, not the picking. Not looked into.

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
