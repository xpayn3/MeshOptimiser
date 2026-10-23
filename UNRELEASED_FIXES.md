# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.36.1**.

## New

- ![new][new] **Photo mode has softboxes in its reflections.** Metal and gloss reflected the studio as a dim grey blur; Photo mode
  now lights reflections from the studio with four bright panels hung in it (a key box, an overhead strip, two tall strips behind),
  made twice as sharp (512 px a side), so chrome shows clean streaks along its curves. A Softboxes switch on the card (on) and
  `softboxes` in Claude's `photo_mode` leave them out: shiny flat surfaces read a little lighter with them.
  Where: `app/js/app.js`, `_Photo` softboxEnv / softApply; `app/index.html` #photo-softbox; `app/serve.py` photo_mode.
  Test: `tests/e2e-mcp-photo.mjs`. Judged by eye on the Scania engine (with and without, same camera).

- ![new][new] **OBJ and FBX exports carry their textures.** An OBJ is written with each picture beside it (<name>_BaseColor.jpg,
  <name>_Normal.png, ...) and its .mtl points at them: `map_Kd`, `norm` and `map_Bump` (the normal map), `map_Pr`, `map_Pm`, `map_d`.
  A binary FBX carries the colour map and the normal map inside it (Video and Texture, connected to DiffuseColor and NormalMap, as
  Blender writes them). Pictures keep their size and their own format; a normal map drawn the DirectX way goes out OpenGL's way.
  Before, both formats left every picture out (a 2048 px textured square came out as a 14 KB FBX). The app's OBJ reader now also
  reads `norm` / `map_Bump` and the PBR values and maps of a .mtl, so an OBJ goes out and comes back with its normal map.
  Where: `app/js/app.js`, `_exportObjStreaming`, `_objTextureFiles`, `_exportFbxBinary`, `_parseMtl` / `_objApplyMtl`.
  Test: `tests/e2e-export-texture-size.mjs` (OBJ files and .mtl lines; FBX opened again, both maps at 2048 px),
  `tests/e2e-normal-map-direction.mjs` (GLB → OBJ and GLB → FBX → open, bumps the right way). Checked by hand in Blender 5.2: OBJ
  and FBX both import with the colour map on Base Color and the normal map through a Normal Map node, at 2048 px.

- ![polish][polish] **No Edit mesh in Photo mode.** Entering Photo mode leaves Edit mesh, its mode button is hidden, and it cannot be
  opened until Photo mode is left (as in Animate). Its marks were drawn into the picture.
  Where: `app/js/app.js` `_Photo` enter, `_Elements` setMode; `app/index.html` `body.photo-mode #vp-mode-bar`. Test: `tests/e2e-mcp-photo.mjs`.

- ![polish][polish] **The Edit mesh bar on the right has the spacing of the tool bar on the left**: 4 px round the buttons, 2 px
  between them and 4 px above and below a divider (it had 6, 4 and 8, so it stood wider and looser). Both are 38 px wide now.
  Where: `app/index.html`, `.vpc.el-bar`, `.el-bar .el-row`, `.el-bar .vpb-sep`. Measured in headless Chrome; not checked in the user's own window.

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

- ![fix][fix] **Bumps of an OBJ, FBX, 3MF, USD or Collada model pointed the wrong way** (a normal map's dents came out as bumps and
  its bumps as dents, lit from the wrong side). The app turns those files' UVs to run from the top, as glTF's do, and now turns the
  normal maps' green with them (as three's glTF reader does for a GLB). DirectX maps (`_Normal_DX`) come out right too.
  Cause: the UV turn on import (`_ingestSceneRoot`) left `normalScale.y` at +1; a GLB's is -1.
  Where: `app/js/app.js`, `_ingestSceneRoot` (the turn of V).
  Test: `tests/e2e-normal-map-direction.mjs` (a square lit from the side its normal map leans to: GLB, OBJ, OBJ with a DirectX map).

- ![fix][fix] **The material editor's Normal scale turned a GLB's bumps inside out, and a normal map loaded into the editor came in
  inside out.** The knob wrote the same value to both directions of the map, wiping the turned green a glTF has; a map put on where
  there was none got +1. The knob now keeps the turn, and a new map is given the turn the scene's UVs need.
  Where: `app/js/app.js`, the Normal scale scrubber and `_setTexFromFile`. Not covered by a test (the editor was not driven); the
  sign rule is the one the import test checks.

- ![fix][fix] **A USDZ export shrank every picture to 1024 px** (a 4K map came out at a sixteenth of its pixels). Pictures keep their
  size up to 4096, the most AR Quick Look takes.
  Cause: three's USDZExporter has `maxTextureSize: 1024` unless told otherwise.
  Where: `app/js/app.js`, the USDZ branch of the export.
  Test: `tests/e2e-export-texture-size.mjs` (2048 px colour and normal maps through GLB, meshopt, the web preset, glTF and USDZ).

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

- **`e2e-photo-average` fails 7 of 15 on 2026-10-23**: the average of a still view reaches 15 to 25 of its 32 frames before the test
  stops waiting, so the checks that need all 32 fail. The same with the new softboxes switched off, so not from them. Looks like time
  (SwiftShader, with another session's headless Chrome running on the same machine); not compared with v0.36.1, which would need a
  second server. Not looked into further.

- **ASCII FBX (the export dialog's ASCII option) still leaves the pictures out**; the binary FBX (the default) carries them. Found
  2026-10-23.

- **Blender marks an OBJ's normal map as sRGB** instead of Non-Color (its OBJ importer does it whatever the .mtl says; it reads
  `map_Bump`, not `norm`), which bends the normals a little. The FBX's comes in as Non-Color. Nothing to do in the .mtl.

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
