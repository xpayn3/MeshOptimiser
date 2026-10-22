# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.35.5**.

## New

- ![new][new] **three.js r186 (from r172).** The viewer runs on the current three.js. What it brings straight away: screenshots and
  Claude's pictures no longer leave a GPU buffer behind each time (r172 never freed its read-back), freed parts give their GPU memory
  back through three itself, shaders are compiled without holding the page up, and the HDRI rotation now turns the light and the
  reflections with the background (node materials ignored it before). The patches the app keeps in three's loaders and writers (glTF,
  FBX, OBJ, USDZ) were carried over. Checked: the unit tests, and every e2e test run on the graphics card (WebGPU) against r172 and
  r186 side by side: r186 passes all that r172 passes, and four more (depth of field, capture, animate-multi, mode pills).
  Cause / where: `app/vendor/three` (r186.1); `photo.js` (RenderPipeline, its own tone curve); `app.js` (HDRLoader, the steps below).
  Test: `tests/e2e-usd-dae.mjs`, `tests/e2e-photo-average.mjs` and the existing suites.

- ![new][new] **Opens USD and Collada.** `.usd`, `.usda`, `.usdc` and `.usdz` (text, the binary "crate" real files use, or a zip
  with its textures) and `.dae`, from the picker, drag and drop, a dropped folder and Claude's `open_file`. The file's up axis and
  unit are honoured as for every other format (Z up in millimetres in the scene); a USD file that does not state its unit is read as
  metres, as Blender and three read it. Gaussian splat files, which three r186 also reads, are left out: they are not meshes.
  Where: `loadUsdFile`, `loadDaeFile`, `_rootConvention` in `app.js`; `OPEN_EXT` in `serve.py`.
  Test: `tests/e2e-usd-dae.mjs` (Blender writes the USD files Z up, Y up and in centimetres; two Collada files; the app's own USDZ
  read back): all where they were, to half a millimetre.

- ![new][new] **Photo mode: a still view is refined, and a choice of look.** While nothing moves, Photo mode draws the view again and
  again and averages the frames (Best: 32): edges come out smooth, the occlusion's speckle goes, and the sun's shadow gets a soft
  edge (the sun is moved a little each frame, as one of real size would be). Anything that moves or changes starts it again; Save
  photo and Claude's pictures take the whole average. Look (in the Photo card): Neutral (colours as they are), Soft (AgX) or
  Contrast (ACES, the look Photo mode had so far). Draft draws one frame.
  Where: `photo.js` (`render`, `ensure`: two passes, the average in half floats, grain and the tone curve after it); `_Photo`
  in `app.js` (`frame`, `still`, `sunSample`); `requestRender` counts the asks (`state._renderAsks`).
  Test: `tests/e2e-photo-average.mjs` (reaches 32 and stops drawing, a camera move starts it again, every look draws, Draft).
  Not yet looked at by eye.

- ![new][new] **Profile: clean outline.** A profile (a PVC window frame, an aluminium extrusion, a seal strip) is made one clean
  solid, from a card of its own. The cross-section is drawn as it is (grey, chambers dashed) and as it will be (blue) while the
  options change, with a readout (axis or path and length, ends, size across, chambers, gaps closed, triangles), and nothing changes
  until Apply. Options: Fill chambers (off: the hollow cells stay and only the outline is cleaned), Fill holes and cuts across (a bar
  with drilled holes, slots or notches sawn into it is taken too, and they are filled: the fullest cut along the bar is the profile,
  and each end is its biggest flat face), Fill gaps up to (notches, slots and teeth narrower than this, in mm, closed flush), and
  under Advanced Straighten up to and Shading angle (the part's own, as in Properties: the card starts from it, the built part keeps
  it, undo puts it back). Ends may be square or mitred (up to 75° from square). Bent profiles (an arched frame member, a bent tube)
  are found too: the bar is walked cut by cut, and the clean section is carried along the curve with square ends. With nothing
  selected the card looks at every part shown and keeps the profiles; ‹ › steps through them and Apply builds them all, one undo
  step. Edit points turns the preview into an editor: a point dragged (it snaps onto the profile as it was, a corner first, else an
  edge; Shift: free), a point added by a double-click on an edge, one taken out with Delete or Alt-click; the wheel zooms, a drag pans,
  a double-click fits. That part is then built from the section as edited (Reset points goes back). Inside corners stay sharp and
  wider openings stay. A part that is none of these is left as it was, and the toast says why. After Apply the options build the
  parts again live, in the same step; they are remembered (widths as a share of the cross-section). Tolerances go by the size across
  the profile, not its length (a 15 m member merged points 0.15 mm apart in its cross-section and was refused), and an end cap never
  gets a triangle turned the wrong way when its outline touches itself. Black faces reported on some real profiles were not
  reproduced on built ones (800 random profiles checked for inward normals and folded walls); not yet confirmed fixed. Search:
  "Profile: clean outline". Not yet tried on a real customer profile, only on built shapes.
  Where: `app/js/profile.js` (new: `cleanProfile`, `endPlanes`, `refineAxis`, `findMachined`, `findCurved`, `sweepOpen`,
  `fillNotches`, `joinHoles`, `extrudeLoops`), `app/js/profile-card.js` (new: `installProfileCard`), `app/js/section-view.js`
  (new: the preview and editor, shared with the Round part card), the card's markup and `.pf-*` styles in `app/index.html`,
  `cleanProfile` in `app/js/meshops.js`; `_decSnap` and `_applyDecimateOp` in `app/js/app.js` keep the part's Shading angle.
  Test: `tests/profile.test.mjs` (new, 55 checks: an L with two chambers, five teeth, a slot and a wide channel along Z and X; chambers
  kept; mitred 45° and 26.6°; a 15 m member with 0.2 mm details; a slot and a drilled hole filled, a notch in a mitred end, a block
  that is mostly pocket refused; a section given by hand; a profile bent round half a circle (Pappus) and a bent tube; a pyramid and a
  stepped end refused), `tests/e2e-profile.mjs` (new, 17 checks in the app on one mitred L: the card, the preview, the readout,
  nothing before Apply, the Shading angle, Fill chambers off, Done, one undo), `tests/e2e-profile-scene.mjs` (new, 17 checks: nothing
  selected finds the two profiles of three parts, the stepper, a pointer drag that snaps onto a corner, Delete on a point, the part
  built as edited, Reset points, both built and one undo).

- ![new][new] **Round part: the same card with the profile.** Round part: remove ridges, Round part: make solid and Belt: remove ribs
  now open one card, the Profile card's twin: the profile (along the axis, by the distance from it; a belt's across it, by the depth
  in from its back) as it is and as it will be, before anything changes, the mode (Ridges, Solid, Belt), Fill grooves up to,
  Segments around (0: as many as the part had), the Shading angle, the readout, the same editor (a point never goes past the axis),
  nothing selected looks at every part shown, and Apply for all in one undo step, the options building them again live afterwards.
  Once applied the view is Wireframe on the parts in work, and closing the card puts it back. It takes the place of the small Round
  part card that opened after the commands (Segments and Smooth up to only), which is gone. Claude's tool and
  `window.__moAgent.fillGrooves` work as before (quietly; they never opened a card).
  Where: `app/js/round-card.js` (new: `installRoundCard`), its markup in `app/index.html` (ids `rc-*`: `rp-*` are Repair mesh's),
  the three commands in `app/js/app.js`; out: `_RoundSpin`, the `roundpart` card and the `roundSegments` / `roundSmooth` hooks
  and the `roundSmooth` setting.
  Test: `tests/e2e-round-card.mjs` (new, 24 checks on a spool: the card, the profile before and after, the readout, nothing before
  Apply, Solid and back, Segments, a pointer drag that snaps onto a corner, Apply, the mode held once applied, Segments after Apply;
  and moved from the old card's test: the selection outline and glow following the new shape, Wireframe while open, Shading angle
  2° lit flat and back, Enter closing the card and putting the view back, one undo, Segments remembered, the options doing nothing
  after undo), `tests/e2e-round-wire.mjs` (now on the new card: Wireframe on the spool only, the view back on Done, 11 checks),
  `tests/e2e-round-part.mjs` (now only Claude's tool: dry run, run, undo; 6 checks on a spool).

- ![new][new] **Align to floor works on the selection.** With nothing selected it stands the whole model on the floor, as before. With
  parts selected it moves only those: the turn set on the card turns them, and the chosen point of their box (Low, Mid, High, Floor)
  goes to zero, while the rest of the model stays where it is. The card's heading says which it will move ("Whole model" or
  "Selection (3 parts)"), and its drawing shows the selection. One undo step. Reset original position and Claude's align tool still
  act on the whole model; with the view exploded, the selection is not aligned (a note asks to put the view back first).
  Where: `alignSelectionToFloor`, `_alignSelMove` and the button handler in `app/js/app.js`; `_liveModelBox` takes a set of parts.
  Test: `tests/e2e-align-selection.mjs` (new, 10 checks: one cube of two aligned and the other left alone, undo, the whole model with
  nothing selected, the heading).

- ![new][new] **Drop a picture on a texture slot.** In the material editor, a PNG, JPEG, WebP or AVIF dragged from the file explorer onto
  the small square of a row (Colour, Roughness, Normal and the rest) loads into that slot, as Load… in its popover does; the square is
  outlined in blue while the file is over it. Another kind of file is turned away with a note, and is not opened as a model.
  Where: `_setTexFromFile` (the load step, shared with Load…) and the drag handlers on `.mat-row-tex` in `_openMaterialEditor`,
  `app/js/app.js`; style `.mat-row-tex.tex-drop-over` in `index.html`.
  Test: `tests/e2e-tex-drop.mjs` (new, 8 checks, with synthetic drag events; a real drag from Explorer not tried).

- ![new][new] **An FBX or OBJ takes the textures beside it, found by name.** A model from a library (Fab, Megascans) names no picture:
  its maps sit next to it as `<name>_4K_BaseColor.jpg`, `_Normal`, `_Roughness`, `_AO`. Dropped as a folder, or with its files together,
  it now opens with them on its materials: colour, normal (a DirectX one with its green turned), roughness (from Gloss, turned over, when
  there is no Roughness), AO, metalness, opacity, and Bump only when there is no normal map. With one set every material takes it; with
  several, each material takes the set named like it, its part or its own picture. Slots the file or its .mtl filled are kept. A toast
  says what was used and what was left (Cavity, Displacement, Specular are not used). The import dialog of FBX and OBJ has a switch for
  it, Find textures by name, on by default. A model opened alone (Open, the Recent list, one file dropped) brings no folder, since the
  browser gives the app the file only: when it has texture coordinates and no picture of its own, a dialog asks for its folder (the
  picker starts where the model is; dropping the folder on the dialog works too), and Not now opens it plain. A file opened by a test,
  the inbox or Claude has no file handle and is never asked. The Fab wooden table (FBX and nine 4K JPEGs) opens textured and saves as a
  13.8 MB GLB.
  Where: `app/js/texsets.js` (new: names, sets, slots), `_applyTextureSets` in `app/js/app.js` (called by `loadFbxFile` and
  `loadObjFile` before the scene is taken in), the `imp-tex-sets` switch in `index.html` and the import dialog's options.
  Test: `tests/texsets.test.mjs` (new, 30 checks) and `tests/e2e-texsets.mjs` (new, 14 checks: an OBJ with five pictures, the OBJ alone,
  the switch off, opened alone with a handle (the dialog, pictures dropped on it, Not now), and the Fab table when it is on this
  computer). The real folder picker is not driven by the test (it needs a click in Chrome's own window). Not checked by eye: which way up a normal map's green reads on a real
  model.

- ![new][new] **The camera's lens and navigation from the camera pill.** A right-click on the camera pill (top left of the view) opens a
  popup beside it with projection, focal length, clip planes, what the view orbits around and zoom toward the cursor. They are the
  Settings › Camera pane itself, lent to the popup while it is open, so a change made there is the one in Settings; its gear button
  opens that pane, where the speeds and the orbit options are too. Esc, a click elsewhere or another right-click close it. A left-click
  still opens Cam, Top, Front and Side. It is the short form, laid out like the cards of the right sidebar: their row spacing, 12px
  labels, no descriptions (Settings keeps them), short dropdowns.
  Where: the end of `_wireViewPill` in `app/js/app.js` (`window.__moCamPop`), `_Settings.cameraPane()`; styles `.vp-cam-pop` in
  `index.html`.
  Test: `tests/e2e-cam-pop.mjs` (new, 34 checks: it opens alone, holds the lens and navigation controls and leaves the speeds and the
  orbit options to Settings, changes the projection and the focal length, shows no descriptions, cuts no label off, runs past no edge,
  closes four ways and gives the pane back). The toolbar right-click selftest passes.

- ![new][new] **The lens in mm: Field of view is now Focal length.** The camera's lens is set as on a full-frame camera, 10 to 200 mm, and
  a bigger number zooms in (35 mm wide, 50 mm normal, 85 mm close), where a bigger field of view used to zoom out. 29 mm is the view the
  app has always started with (45 degrees).
  Where: the `cam-fov` field in `index.html` and its input handler in `app/js/app.js`: the camera keeps its angle (`state.cameraFov`,
  the vertical angle a lens of that length gives over the 24 mm height of a 36 x 24 mm frame); only the field is in mm. Undo replays
  the field's value, so it works in mm too. The docs still say "Field of view": they change with the release.
  Test: `tests/e2e-cam-pop.mjs` (29 mm is 45 degrees; 35, 50 and 85 mm give 37.8, 27.0 and 16.1 degrees). On the Gearbox, 90 mm showed
  the model 2.5 times the width of the view where 29 mm showed it at 80 %, with the camera where it was.

- ![new][new] **Textures show on the material balls and in the texture slots.** A material with a colour texture shows it on its ball in
  the Materials dock, wrapped as on a sphere, tinted by the colour and lit like the others (it used to be a plain ball of its colour:
  white, since the colour turns white when a texture is loaded). The texture slots of the material editor and the card of a slot show
  the picture too for a texture that came with a model (an ImageBitmap: they showed an empty picture icon).
  Where: `_matThumb` (`mapImage`, `_paintMap`; a ball whose texture is still loading is drawn again, not kept) and `_texThumbUrl` (a small
  picture of any readable texture, kept in `_texThumbCache`) in `app/js/app.js`. Some 5,000 pixels per ball, once per material.
  Test: `?selftest=materials` "a colour texture shows on the ball in the Materials dock and in its slot" (new: a red and blue PNG through
  the editor's Load…, then an ImageBitmap texture; it failed before, passes now).

## Fixed

- ![fix][fix] **Quick remesh "smart" left more long thin triangles than "plain", and on some parts a much rougher shape.** Before the
  simplifier, smart took away the points of faces that turn by up to 3 degrees; on gently curved faces (gear flanks, fine cylinders,
  the teeth of a lockring) that left long fans the simplifier kept. Measured with the worker's own path on five models (the Gearbox
  and four CAD parts: a brake disc, a rotor, a lockring, a caliper) at keep 50 %, 25 % and 10 %: without that step smart is as good or
  better on slivers and on the shape everywhere (Gearbox at 25 %: 16.8 % slivers against 18.3 %; the lockring at 10 %: 36.7 % against
  60.8 %, and a fifth of the shape error), and a step of 0.5 degrees was no better than none. The step is gone; points on straight
  runs of an outline still go. (It is the step the v0.27.0 notes describe as "points on faces that are flat to a few degrees go".)
  Cause: the limited dissolve (`limitDeg: 3`). Where: `smartOpts` in `app/js/mesh-worker.js` (`limitDeg: 0`).
  Test: `tests/e2e-quick-remesh.mjs` ("smart leaves fewer slivers than plain": 16.8 % against 17.0 %).

- ![fix][fix] **After a move in Edit mesh the console said "picking tree not refitted: Maximum call stack size exceeded", and picking the
  part afterwards built its tree again from nothing** (half a second on two million triangles). The tree the part had is reused for the
  moved shape and only refitted; it was handed to three-mesh-bvh without its format version, the library took it for its old format and
  "fixed it up" (the "Serialization format has been changed" warning), which scrambled it, and refitting it ran out of stack. The
  version is passed now: no warnings, and the tree is refitted as meant.
  Cause: `MeshBVH.deserialize` without `version`. Where: `_commitGeomEdit` in `app.js` (version from `MeshBVH.serialize`).
  Test: `tests/e2e-edit-move.mjs` ("the moves refit the picking tree they had"; without the fix it logs both warnings twice).

- ![fix][fix] **After Photo mode the model was lit a little differently than before it.** Photo mode turns the shadows on, which fits
  the sun round the model (it moves to the model's middle); switching Photo mode off turned the shadows off but left the sun where the
  shadows had put it, so every lit surface came out a few levels off. Photo mode now puts the sun back where it was.
  Cause: `_shadowRefit` moves the sun; `_Photo.leave` did not undo it. Where: `_Photo` `enter` / `leave` in `app.js` (`kept.sun`).
  Test: `tests/e2e-photo-pictures.mjs` ("a screenshot without the option is a plain one again": the same picture, byte for byte).

- ![fix][fix] **The left sidebar could not be widened by the middle of its handle.** Since v0.35.3 the status bar lay over the two
  resize handles (it was raised so the console and the library dock slide in under it), and the left handle's middle and right half
  were the status bar's: a press there did nothing. The handles are above the status bar again.
  Cause: `#sb{z-index:var(--z-statusbar)}` (98) is over `.resize-handle` (`--z-toolbar` + 2 = 92) in the same grid row.
  Where: `app/index.html`, the `.resize-handle` rule (now `--z-statusbar` + 1).
  Test: `tests/e2e-drag-cursor.mjs` (the sidebar resize checks).

- ![fix][fix] **The dots of Edit mesh and of the groups vanished in Top, Front and Side (three r186).** three r186 stopped scaling a
  sprite of fixed size by 4 / P11 in an orthographic view; the dots were sized for that and shrank to a speck. They are the size
  they were again, pixel for pixel.
  Cause: `SpriteNodeMaterial.setupPositionView` in r186. Where: `_fixedSpriteScale` in `app.js` (the factor in the dots' scale
  node, read live from the camera). Test: `tests/e2e-edit-sheet.mjs` on WebGPU (22 and 34 dark pixels, as on r172).

- ![fix][fix] **A hidden scene tab logged WebGPU errors (three r186).** Its view, 0 pixels wide, was drawn anyway, and r186 made that
  frame a depth buffer 0 wide, which WebGPU refuses. A view with no pixels is not drawn; it draws again when the tab is shown.
  Cause: the render loop drew into an empty canvas. Where: `tick` in `app.js`. Test: `e2e-cad-lines`, `e2e-edit-marks` on WebGPU.

- ![fix][fix] **A part first drawn in Top, Front or Side kept flat highlights back in the perspective view (three r186).** r186 builds
  a material's view direction for the kind of camera it is drawn with, and the app's camera changes kind without three noticing.
  The kind is now part of every shader's key; the first switch builds the other kind's shaders, later ones find them.
  (First done for plain materials only: node materials inherited the "done" mark and were skipped, so Edit mesh's picked points,
  made in the perspective view, filled half the screen in Side and the view crawled. Each class is keyed on its own now.)
  Where: `_orthoProgramKey` and `DualCamera.setOrtho` in `app.js`. Test: `tests/e2e-edit-ortho-switch.mjs` (picked points in
  perspective, then Side, Top, Front and back: the dots keep their size).

- ![fix][fix] **Photo mode would have lost its ACES look on three r186.** A pipeline reads the renderer's tone mapping on every frame
  since three r184, so lending it ACES while the chain was built no longer held. The tone curve is applied in the chain itself.
  Where: `ensure` in `photo.js`.

- ![fix][fix] **A Z-up FBX would have been turned twice (three r186).** r186's FBX loader turns a Z-up file to Y up itself, and the
  app does it from the file's up axis; the loader's turn is taken out again (marked as a MeshOptimiser patch).
  Where: `app/vendor/three/examples/jsm/loaders/FBXLoader.js`. Not yet checked with `e2e-blender-roundtrip`.

- ![fix][fix] **Photo mode's averaging never got past the first frame in Top, Front and Side.** The camera's place is worked out
  again every frame there and came out a hair different (1e-14 mm), which counted as a move and started the average again. Only a
  real change of view starts it again now.
  Where: `viewOf` / `sameView` in `photo.js`. Test: `tests/e2e-photo-average.mjs` ("builds up to 32 again" after the Front view).

- ![fix][fix] **Remove holes said half the holes of a sheet-metal part were left alone, though they were closed.** A flow-drilled
  (plunged) hole is a cone from the outer face into a bore whose collar hangs inside the sheet. The hole was filled from the outer
  face, and then the loop round the collar's root on the inner face, the same hole seen from the other side, was counted again as
  "an opening into a cavity" (or as "a raised feature" when the inner face came first). A hollow profile with 40 such holes reported
  44 filled and 40 left alone. It now reports 44 filled and none left alone; what is built is the same as before (the cone and the
  bore go, both ends are capped, the collar stays as a closed stub out of sight), and the part stays watertight.
  Cause: once a hole was filled, its other loop was still looked at on its own: the surface behind it ran into the triangles the
  fill had taken out, which counted as a leak; met from the collar side first, it stood on its face and counted as raised.
  Where: `fillFlatHoles` in `app/js/holefill.js`: a loop whose surface runs into a filled hole is settled with that hole
  (`holeOf`), and a loop left alone earlier whose surface ran through a hole that is then filled is taken off the count (`metBy`).
  Test: `tests/holefill.test.mjs` section 15 (a plate with a cone, bore and collar, built with either face met first: one hole, none
  left alone, watertight; before: one opening into a cavity, or one raised feature). Checked in Node on the customer's part
  (`__0_1_1_57_000129__geom`, 41 872 triangles) at 50 to 1000 mm: watertight every time, nothing counted as a cavity any more. Not yet checked in the app itself.

- ![polish][polish] **The facts in Settings › About sat far apart.** Version, Renderer, Scene, Display and Browser were each a 56px row,
  the height kept for a setting with a description under it; a row that is only a name and a value is 34px now (one in Updates too).
  Where: `#settings-modal .set-pane-b .set-row:has(>.set-val):not(:has(.set-help))` in `app/index.html`.

- ![polish][polish] **The links in Settings › About were the browser's own blue and purple.** The credits (three.js, Draco, Open CASCADE…)
  are in the app's accent for text now (`--ac-text`), with no underline until the pointer is on one, and a ring for the keyboard.
  Where: `#settings-modal .set-pane-b a:not(.btn)` in `app/index.html` (the Website and Source code buttons keep their own look).

- ![fix][fix] **Ctrl+Z after an isolate could undo something else and leave the view marked isolated.** Hide a part with the eye in the
  tree, isolate the other one, Ctrl+Z: the hidden part came back and the view stayed "isolated". Now an isolate is always one step of its
  own, and Ctrl+Z after it undoes it and nothing else; Show all is a step too when it ends an isolation in which every part was shown.
  Cause: an isolate that changed no part's visibility (the parts it leaves out already hidden) recorded no step while it marked the view
  isolated, so Ctrl+Z took the step before it.
  Where: `_isolateSet` and `showAllParts` (the `vis` steps) in `app/js/app.js`.
  Test: `node tests/e2e-isolate.mjs tests/fixtures/test-model.glb 60 892060` (failed at its step 51, passes: 80/80); seeds 11, 777 and
  618581 pass too.

- ![fix][fix] **Check against under-counted a GLB of many parts by about a third.** Its size estimate took 160 bytes for each part's node;
  a node is some 300 (its name and a full matrix that carries the file's metres and axis turn, written to 17 digits). On a 60-part
  model it said 19 KB for a 34 KB file; it says 28 KB now. On a big model the change is under one per cent.
  Where: `_exportEstimate` in `app/js/app.js`. Test: `?selftest` "export: Check against estimates the size…" (failed, passes).

- ![fix][fix] **A part copied in Photo mode had no shadow.** Duplicate or Copy and Paste with the shadows on (Photo mode turns them on)
  made a part that stood on the floor without a shadow and took none from the others. Now every part that arrives while the shadows
  are on (a copy, a paste, a split, the library, Cloner) casts and receives them from its first frame, and the sun's shadow is fitted
  round the model again so a copy put beside it is covered. With the shadows off a copy has none, as before.
  Cause: `_applyShadows` set the shadow flags only on the meshes there when it ran (switching shadows on, a model loading); a fresh copy
  also hangs from the move gizmo's pivot, outside `partsRoot`, until it is let go.
  Where: `_shadowNewParts` (new, beside `_applyShadows`), called before each frame in `tick` in `app/js/app.js`.
  Test: `tests/e2e-copy-shadows.mjs` (new, 5 checks: Photo mode on, Duplicate, Copy and Paste, shadows off again).

- ![fix][fix] **The material window was slow with 4K textures.** Each texture slot showed the texture itself: a 4K picture as the
  background of a 20 px square (decoded whole and scaled at every paint), and a canvas (roughness made from Gloss, a painted texture)
  encoded whole as a PNG each time, 14 MB for one slot. The material ball scaled the same 4K colour map down again. Now each texture has
  one small copy (256 px), made as it loads where it can (off the main thread) and shared by the ball and the slots, and each slot a
  96 px picture kept until its picture changes (a canvas: until it is painted on). With the Fab table (4K maps): the editor's own work
  on opening 760 ms to about 250 ms, opening the slot popovers five times over 3.6 s to 0.09 s (headless Chrome, software rendering).
  Roughness made from Gloss is kept as a picture that does not change (an ImageBitmap), as a loaded file is.
  Cause: `_texThumbUrl` returned the texture's own address or a PNG of the whole canvas; `_paintMap` drew the 4K map at every ball.
  Where: `_texSmall`, `_texSmallAhead`, `_texPicKey` beside `_texThumbCache`, `_texThumbUrl` in the material editor, `_paintMap` in
  `_matThumb`, and `_loadTexture` / `_applyTextureSets` (which make the copy ahead) in `app/js/app.js`.
  Test: `tests/e2e-mat-thumbs.mjs` (new, 7 checks: what each slot shows, the time of the popovers and of opening the editor, a texture
  painted on gets a new picture; needs the Fab table on this computer, skipped otherwise). Not measured on a real GPU: these times are
  headless software rendering.

- ![fix][fix] **A texture put on a material could not be undone.** Loading, dropping or clearing a texture in the material editor left
  nothing in the history, and some fields (the specular colour, depth write, the iridescence range and others) were not put back by an
  undo either. Now every change to a material is undone and redone: each texture loaded, dropped or cleared is a step of its own, and a
  texture replaced by another comes back with its picture.
  Cause: the snapshot an undo restores (`_snapshotMat`) held a short list of fields and no textures; a replaced texture also had its
  picture let go (`_releaseTexUrl`), which was only safe while it could not come back. Where: `_snapshotMat` / `_applyMatSnapshot`
  (every number, switch, colour, vector, range and texture slot of the material, textures by reference), `_setTexFromFile` and the
  Clear button in `_openMaterialEditor` (`_texStep`), `app/js/app.js`. A replaced texture now keeps its picture in memory while the
  history can bring it back.
  Test: `tests/e2e-tex-drop.mjs` (13 checks now: undo and redo of a drop, of a texture dropped over another, of Clear, and of the
  fields the old snapshot left out); `tests/undo-redo.test.mjs` passes.

- ![fix][fix] **A long Cloner array was cut off while the view was panned.** With many copies (a row of tables), the copies nearer the
  camera than the source were cut away. Now the whole array stays in view. Cause: the near plane follows the box of the model, built
  from each part's box, and a cloner kept the box of its source from when it was made (its group has no geometry, so the box was
  never refreshed); the near plane was put just short of that box, behind the nearer copies. Where: the end of `_clonerRebuild` in
  `app/js/cloner.js` (the box of the whole array after every rebuild) and `_refreshPartBBox` in `app/js/app.js` (a cloner's box is
  its group's, so a move keeps it right). Test: `tests/e2e-cloner-clip.mjs` (new, 5 checks: 40 cubes 300 mm apart, camera past the
  far end; it also shows the old box would have cut the nearest copy). The move path is not covered by the test.

- ![fix][fix] **After the list of presets had been open, the next click on + in the Materials dock did nothing.** The arrow beside the
  + (or a right-click on it, or the command palette) opens the list; after that, New material from the palette, or Enter on the + button,
  was swallowed once. Now only a press held on the + marks the click that ends it as not a click.
  Cause: every way of opening the list set the "held" mark, and only a mouse press on the + cleared it.
  Where: `openList(fromHold)` in `_wireMaterialActions`, `app/js/app.js`.
  Test: `?selftest=materials` "after the preset list was open, the next click on + still adds a material" (new).

- ![fix][fix] **The material editor reopened on the material it showed last.** Close the editor, double-click another material, and it
  came back with the previous material's name, colour and slots, until the pointer went over it.
  Cause: a closed editor stays in the page, and `_DraggablePopup.create` hands it back without the new body.
  Where: `_openMaterialEditor` in `app/js/app.js`: a reused editor is filled for the new material.
  Test: the new texture selftest above opens the editor of a new material after another test closed one (it read the old name before).

- ![fix][fix] **The Cloner's spacing stopped at 500 mm.** A distance typed into Spacing (Grid) or Position step (Linear) was cut to
  500 either way, and the Radial radius to 1000. Now any distance is kept (2500, -12000, 12.5 were checked), and the radius has no
  upper limit. The Cloner card also takes the spacing of the other Properties cards: it runs to the panel's edges like the part card,
  with no tinted band behind its header, and its switches have no description under them (it is the row's tooltip).
  Cause: the number boxes carried the hidden slider's range as their limits. Where: `_renderClonerCard` (`slider`, `distSlider`) and
  the clamp in `_wireClonerControls`, `app/js/cloner.js`. Not covered by a test yet; checked in headless Chrome on a Grid cloner.

- ![fix][fix] **The camera popup was solid while the camera pill beside it is see-through.** It now has the pill's transparency
  (`--pill-bg`), only behind the text, and has no "Navigation" heading over Orbit around (Settings keeps it).
  Where: `.vpc.cam-corner>.vp-cam-pop` and `.vp-cam-pop #set-camera-prefs` in `app/index.html`.

- ![fix][fix] **A model with JPEG textures saved as a GLB ten times its size.** A wooden table from an OBJ with five 4K JPEG maps (a few
  MB in all) saved as a 116 MB GLB: every picture was written again as a lossless PNG. Now a picture keeps the format of the file it came
  from (.jpg stays JPEG, .png stays PNG), and one with no file behind it (a canvas, a painted texture, a .webp) is written as JPEG unless
  it is a colour map with transparency. The same for Save, Save a copy, the recovery copy and Export as glTF / GLB. A GLB saved before
  this fix already holds PNGs and keeps them when saved again.
  Cause: GLTFExporter encodes each texture as `texture.userData.mimeType` says, PNG when nothing does, and only GLTFLoader sets it.
  Where: `app/js/texformat.js` (new: `setExportTextureFormats`, set for the write and undone after it), called in the scene save and the
  glTF / GLB branch of the export in `app/js/app.js`.
  Test: `tests/texformat.test.mjs` (new, 18 checks, with the real GLTFExporter in node: PNG without the pass, JPEG with it) and
  `tests/e2e-texformat-save.mjs` (new, 5 checks: an OBJ + .mtl + 1024 px JPEG dropped on the app and saved; the GLB holds a 598 KB
  JPEG for a 569 KB file). Not yet checked with the table itself, whose OBJ is not on this computer.

- ![fix][fix] **Ctrl+Z did nothing for a while after a model opened ("Wait until the running step has finished").** While the loader
  said "Preparing the view" (up to 12 seconds on a slow graphics card), undo and redo were refused, Claude's undo too, though other
  edits such as Duplicate went through. They work during it now; the view is still prepared the same way.
  Cause: that last step of a load keeps the loader up, and the loader's entry on the Tasks list counted as a step still running, which
  holds undo and redo back. Nothing is being made then that an undo could cross.
  Where: `_Tasks` in `app/js/app.js`: a task can be passive (it only shows progress) and `busy()` passes over it; `_publishTask` marks the
  loader's task passive while `setLoader` was last called for "Preparing the view" (`_viewSettling`), and any other loader, a new load
  among them, holds undo back as before.
  Test: `tests/e2e-undo-while-settling.mjs` (new: a part duplicated while the view is prepared, then Ctrl+Z, Ctrl+Y and Claude's undo,
  all while the loader still says "Preparing the view"; Ctrl+Z and Claude's undo failed before). `e2e-quick-remesh-obj`, `e2e-isolate`
  (seed 4242) and `e2e-mcp-tools` pass again; `e2e-load-settle` still passes.

- ![fix][fix] **Decimate's "Target…" and "Within…" showed no field to type into, and its estimate and Preview link never showed.**
  The target field, the distance field, the "12,400 → about 6,200 triangles" line and Preview come up as they should.
  Cause: `_updateDecCount` did nothing while the estimate's line was not visible, and that line hides itself while it is empty, so it
  stayed empty, and the fields it also shows never came up.
  Where: `_updateDecCount` in `app/js/decimate-card.js`: it asks whether the card is open instead.
  Test: `tests/e2e-decimate-card.mjs` (its four checks of the estimate, the preview link and the two fields failed before, pass now).

- ![fix][fix] **Remesh did nothing on a STEP part after Decimate ("Nothing to join").** A part from a STEP file came out of Decimate
  with every triangle on its own three corners, nothing shared, so Remesh found no flat face to join, and the part held three times the
  vertices it needs. Decimate, Fit to triangle budget and Quick remesh now join the corners that are alike again (the same point with
  the same normal), so the part comes out as it came from the file: on the 203 mm brake disc, 6,850 vertices for 5,830 triangles
  instead of 17,490, and Remesh sees its flat faces as polygons.
  Cause: a part whose normals are the flat ones of each face (every STEP part) is reduced without them and shaded again afterwards with
  three's `toCreasedNormals`, which hands back a corner per triangle; nothing joined them again.
  Where: `_creaseAfter` in `app/js/app.js` (shared by Decimate, Fit to budget and Quick remesh): it re-indexes with `mergeVertices`.
  Test: `tests/e2e-decimate-card.mjs`, last section (a Gearbox part given a corner per face, as a STEP part comes: 51,864 vertices for
  17,288 triangles before, indexed now, and Remesh then joins its flat faces). Every remesh tool after Decimate checked on the brake
  disc (STEP) and the Gearbox in headless Chrome: all work. Not yet checked in the app by hand.

- ![fix][fix] **A big model showed before it was ready, and stuttered for the first seconds of turning it.** The loader that is open
  (the start screen's, or the card over the view) now stays up through a last step, with "Preparing the view" under its heading: no
  second loader comes up. Every shader program the scene needs is built ahead, the view is drawn behind the loader
  until the frames come at an even pace, and the trees that make hover and clicks fast are finished. Only then does the model show. It
  never waits longer than 12 seconds (a scene that is slow on this computer is shown anyway), and Cancel on the loader shows it at once.
  Cause: the loader went away as soon as the file was read, and the first frames then sent the buffers to the graphics card, compiled
  the programs, rebuilt every material for the shadows and built the picking trees, all while the user was already turning the model.
  Where: `_settleView` in `app/js/app.js`, called from `_runLoad` (GLB, FBX, OBJ, 3MF, STL, and STEP converted by the server) and
  `loadStepFile` (STEP read in the page); a file opened from the start screen keeps that screen up until then (`onSceneActivated`
  defers its closing to `setLoader(false)`).
  Test: `tests/e2e-load-settle.mjs` (Gearbox Assy opened from the start screen, real GPU: its loader said "Preparing the view", the
  separate loader card never came up, the picking trees were done when the screen went away, and the first two seconds after it ran at
  16.6 ms a frame with the longest at 21.2 ms). Not yet checked on a model as big as the V8.

- ![fix][fix] **Remove holes opened the part instead of closing it: polygons went missing on the far side.** With a large size, an
  opening that is not a hole (a bore that runs on into other geometry) is sealed from outside, and the wall under it is taken out.
  On a plate no thicker than the opening is wide, that column reached the face on the other side of the plate and took its triangles
  too, so the plate came out with a hole in its back (a 25 mm plate with a 25 mm stepped bore: 27 open edges and five loose triangles
  from 30 mm up). Such an opening is now left as it is and counted as an opening into a cavity; the rest of the part is filled as before.
  Cause: the seal took every triangle in the column under the opening, including ones that face away from it (the part's far side), and
  did not check what it left bare.
  Where: `trySeal` in `app/js/holefill.js`: it gives up when the column holds a triangle facing away from the opening, or when what it
  takes out borders one.
  Test: `tests/holefill.test.mjs` section 8 (a hole into a slot cut from the underside: 28 open edges before, none now). Checked on the
  model in Node at 12 to 12 000 mm: closed every time. Not yet checked in the app itself.

## Refactor

- ![refactor][refactor] **No more "renderAsync() has been deprecated" in the console.** The six places that drew with
  `renderAsync()` (the GPU screenshot, its fallback, the thumbnails of shapes and the picture taken for a scene) use `render()`, as three
  r181 on asks; both renderers are initialised when they are made. Test: `e2e-capture` (11 of 11).

- ![refactor][refactor] **three-mesh-bvh 0.8.3 → 0.9.16**, the library behind fast picking, hover and Decimate's distance check (the latest,
  for three.js r159 and up, so r186 too). What it brings here: a pick on a part with overlapping colour groups reports the right material,
  triangles in no group are left out of the tree, trees take less memory, and results match three.js's own in a few edge cases where
  they did not. New, not used yet: trees for lines and points (Draw lines, splines, CAD edges) and BVH queries in WebGPU compute shaders.
  Nothing the app calls changed (computeBoundsTree, disposeBoundsTree, acceleratedRaycast, MeshBVH with indirect, closestPointToPoint,
  refit). Where: `app/vendor/three-mesh-bvh/index.module.js` (the npm build, unchanged) and its LICENSE.
  Test: on the Gearbox the same 123 of 900 rays hit, the centre pick is the same part and triangle, the closest-point worst distance is the
  same; build and pick times are within the spread of runs (about 80 ms for 220,000 triangles, 20,000 to 34,000 rays a second in headless
  WebGL2). `?selftest` 63/63, `e2e-smoke-drag`, `e2e-select-all`, `e2e-edit-move`, `-dots`, `-marks`, `-stays`, `e2e-decimate-card`,
  `e2e-holefill-card`, `e2e-mcp-tools`, `e2e-load-settle`, `e2e-undo-while-settling`, `e2e-isolate` pass, as before the swap.

- ![refactor][refactor] **Eleven e2e tests caught up with the app; every one passes on WebGPU now.** None of these was a fault of the app:
  - `e2e-shadows`: the floor of the grid has had no shadow picture since v0.35.0 (`_FLOOR_SHADOW` off on purpose); the test checks
    that, and keeps its floor checks for the day it is switched back on.
  - `e2e-idle-draws`: its counters saw WebGL draw calls only, so on WebGPU the viewport was invisible to them; WebGPU frames and queue
    submits count too, and every state is still quiet.
  - `e2e-save-roundtrip`: the saved scene (5.7 MB) went out of the page and back in as one 7.7 MB DevTools message and the
    connection stalled (the test sat until it was killed); it goes in pieces of 1 MB, and phase 2 waits for the scene to settle.
  - `e2e-animate-card`: nothing plays by itself since v0.35.2 and the card starts folded since v0.35.3; it presses Play and opens the
    card first.
  - `e2e-notes`: the dialog's surface is read from `--surface-pop` (#1a1a1a since v0.35.3), cards start folded, and the notes a
    model carries are cleared first (see Found below).
  - `e2e-claude-feed`: the second model was a customer's file that is not on this computer (the 404 page went to the glTF reader); it
    is `inbox/shapes_test.glb` now, and the split view is waited for (a 0.55 s transition).
  - `e2e-round-part` and `e2e-voxel-remesh`: written for a one-part model; on an assembly they pick a part the tool takes and count
    that part's triangles.
  - `e2e-texture-uv`, `e2e-robustness` (and the three above that open models): `ready()` waits for the app's tools as well as
    `app-ready`, which the page sets after a time cap even while the app is still starting on a busy graphics card.

- ![refactor][refactor] **Remove holes has a file of its own.** Its card (the size, the Advanced options and their saved values, the run
  and its undo step) moved out of `app.js` into `app/js/holefill-card.js`, as it was; nothing changes in what it does. It is the first
  of the mesh tools to be moved, one at a time, so that each lives beside its own maths (`holefill.js`).
  Where: `installHoleFillCard` in `holefill-card.js`, called from `app.js` where the block was; it hands back `_fillHoles`,
  `_fillHoles_job` and `_fillHolesRun` for Lettering and logos, Smart optimise and the Claude tools. The one line that changed reads
  whether the loader is up through `app.loaderBusy()`.
  Test: `tests/e2e-holefill-card.mjs` (new: the button, Enter, the Advanced options and Reset, nothing run on an empty size, Lettering's
  dry run); the unit tests, `?selftest`, `e2e-mcp-tools`, `e2e-isolate`, `e2e-undo-memory`, `e2e-cmd-card-grow`, `e2e-mesh-tools` and
  `e2e-brep-fill` (on a STEP brake disc) gave the same results before and after.

- ![refactor][refactor] **Decimate has a file of its own.** Its card (the run by a share, to a triangle target or within a distance, the
  preview, and the count under its button) moved out of `app.js` into `app/js/decimate-card.js`, word for word. The helpers it shares
  with Quick remesh, Fit to budget and Remove holes (loading the simplifier, welding, `_geomFromIndexParts`, `_decSnap`, the undo op)
  stay in `app.js`.
  Where: `installDecimateCard` in `decimate-card.js`, called from `app.js` where the run was; it hands back `_decimateSelected` and
  `_decimateSelected_job` (Smart optimise). `tests/decimate-align.test.mjs` reads the card files beside `app.js`.
  Test: `tests/e2e-decimate-card.mjs` (new: the three ways to set it, the preview and its button, undo, the Claude tool and Smart
  optimise's entry point); the unit tests, `?selftest`, `e2e-mcp-tools`, `e2e-idle-writes`, `e2e-quick-remesh(-obj)`, `e2e-uv-carry`,
  `e2e-drag-cursor`, `e2e-cmd-card-grow` and `e2e-isolate` gave the same results before and after.

- ![refactor][refactor] **The self-test and the robustness test caught up with the app; all 63 self-tests pass.** Four checks still
  expected a glTF in the file's own metres and Y up, from before the scene became Z up in millimetres: repeats now expects what the app
  makes of the file, and `T.gltfNodes` reads an exported glTF's node places back through the convention the file states
  (`asset.extras.meshoptimiser`) and its whole transforms (Recenter and pivots). The slider test of Delete small parts waits for the
  frames the slider hands its value on at, not a fixed 120 ms (it failed most runs in headless Chrome). `e2e-robustness` cuts the model
  for its truncated-file cases inside the page: it used to send some 10 MB of base64 through the DevTools connection and stop there,
  which read as "the page did not answer"; now every broken file is tried, none freezes or strands the app, and a good one opens after.

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


