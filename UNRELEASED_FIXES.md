# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.35.5**.

## New

## Fixed

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

## Found, not fixed yet

- **Undo is refused for a while after a model opens** ("A step is still running in the app, so nothing was undone"), while other edits
  such as Duplicate go through. Since `71f2455` ("the model shows only once it turns smoothly") the loader stays up through
  "Preparing the view", up to 12 s, and the undo tool and `_Tasks.busy()` count it as a step running. In headless Chrome (SwiftShader)
  it lasts the full 12 s: `e2e-quick-remesh-obj`, `e2e-isolate` (seed 4242) and `e2e-mcp-tools` fail on it, and pass on the commit
  before. On a real GPU it may be short; not checked by hand.

- **Choosing "Target…" or "Within…" on the Decimate card shows no field to type the target or the distance into.** Same cause as the
  estimate below: `_updateDecCount` shows those fields, and it never gets past its visibility check.

- **The Decimate card never shows its estimate ("12,400 → about 6,200 triangles") or its Preview link.** The count under the button
  works. Cause: `_updateDecCount` (`decimate-card.js`) skips its work while `#decimate-info` is not visible, and the stylesheet hides
  that line while its text is empty and the link hidden (`.plan-line:has(>span:empty):has(>.plan-link[hidden])`, `index.html`), so
  neither ever changes. Found by `tests/e2e-decimate-card.mjs` (four checks fail), the same before and after the move.

- **Undo of an isolate can leave the view isolated** after parts were hidden with the eye in the tree: isolate one part, then Ctrl+Z,
  and both parts show with the view still marked isolated. Found by `node tests/e2e-isolate.mjs tests/fixtures/test-model.glb 60 892060`
  (step 51 of its sequence), the same before and after the Remove holes move; not looked into.
- **`e2e-robustness` stops at "broken input must not freeze or strand the app"**: the page does not answer for 60 s. Seen on
  2026-10-22 on v0.35.5 as it is; not looked into.
- **Five `?selftest` tests fail on v0.35.5 as it is** (headless Chrome, WebGL2): repeats ("copies that arrive as separate meshes"),
  three export tests ("Check against", view modes and Recenter, pivots), and "delete small parts: the slider is live", which fails most
  runs but not all. Not looked into: they may be the tests falling behind the app rather than bugs.

- **A STEP whose name is about 190 characters long fails late on Windows without long paths** (Settings › long paths off, the default):
  it uploads and converts, then fails writing its B-rep file with "step2glb.py exited with code 1". Where: `app/serve.py`,
  `_sanitize_filename` (a cap of 200 characters that does not count the folder). Found in the review of 2026-10-21; not seen here, where
  long paths are on.


