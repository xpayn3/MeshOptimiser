# Test sweep, 2026-10-23

Every test of the repository, run against the working copy of 2026-10-23 (HEAD 9a8bc49 plus the day's uncommitted work: Profile
options, fill-bar sliders, the shortcuts window, Photo mode's AO and lens rings, `export-writers.js` and `anim.js` moved out of
`app.js`; three.js r186 since v0.36.0). The question: what is broken since v0.36.1. Nothing in the app was fixed; one test-harness
line was (`e2e-update`, below).

How it was run:

- Unit: every `tests/*.test.mjs`, `*.test.cjs` with node 24, the `*.test.py` with the system Python 3.12 (it has OCP).
- Browser: every `tests/e2e-*.mjs`, one at a time (they share Chrome debug ports), headless Chrome with SwiftShader WebGL2, against
  the user's server on 4242. Tests that need an argument got `inbox/GearboxAssy.glb` (the only model in `inbox/` here).
- Round 2: every failure run again. Round 3: the ones that failed twice for a reason that could be the setup (port, model).
- `e2e-blender-roundtrip.mjs` with Blender 5.2.
- Other sessions were editing `app.js` / `index.html` and running their own headless Chrome meanwhile (`app.js` was rewritten at
  19:35 during round 3), so a single failure means little; only repeated ones are sorted below.

## Result

**Unit tests: 60 files, 59 pass** (`converter-fuzz` skips itself: no STEP in `inbox/benchmark/`; three of the 60, and
`e2e-quick-remesh-look`, were added by other sessions during the sweep and run at its end). **Browser tests: 105 files**, plus the
Blender round-trip (**381 checks, all pass**). After the re-runs, and with the port and model settings right, the browser tests
that still fail are explained below. **None of the failures that repeat could be traced to a bug in what the app does that is new since
v0.36.1.** What is new: a breach of the design rule (4 typed-in colours) and six tests that today's or recent changes have left
behind. Two real bugs turned up, both there since v0.36.0 (the 12-second settle and the F5 wording). Three timing failures
(`e2e-edit-bgread`, `e2e-notes`, `e2e-quick-remesh-cancel`) were not compared with v0.36.1, which would need a second server; they
are the place to look if something new is hiding.

| File | First run | Round 2 | Round 3 | Verdict |
|---|---|---|---|---|
| `animate-delete.test.mjs` | pass (animate-delete: all checks passed) |  |  | pass |
| `animate-rigid.test.mjs` | pass (all checks passed) |  |  | pass |
| `appearance.test.cjs` | pass (appearance.js: all checks pass) |  |  | pass |
| `booleans.test.mjs` | pass (all passed) |  |  | pass |
| `brep-after-fill.test.cjs` | pass (ok   groups are kept, faces follow them) |  |  | pass |
| `cad-edges.test.mjs` | pass (all passed) |  |  | pass |
| `cad-planes.test.mjs` | pass (all checks passed) |  |  | pass |
| `cadcut.test.mjs` | pass (all passed) |  |  | pass |
| `cmd-cards-markup.test.mjs` | pass (ok: 31 command cards are well formed, 30 footers all inside ) |  |  | pass |
| `converter-fuzz.test.py` | pass (SKIP: no test STEP at C:\Users\Luka\Documents\MeshOptimiser-) |  |  | skipped itself (no `inbox/benchmark/as1` STEP) |
| `converter.test.py` | pass (20 of 20 passed in 185s) |  |  | pass |
| `convex.test.mjs` | pass (all passed) |  |  | pass |
| `decimate-align.test.mjs` | pass (decimate-align: all checks passed) |  |  | pass |
| `defeature.test.mjs` | pass (all checks passed) |  |  | pass |
| `dissolve.test.mjs` | pass (all passed) |  |  | pass |
| `e2e-aa-settings.mjs` | FAIL (6 passed, 1 failed) | pass (8 passed, 0 failed) |  | flaky (passed on re-run) |
| `e2e-align-selection.mjs` | pass (10 passed, 0 failed) |  |  | pass |
| `e2e-alt-keys.mjs` | pass (7 passed, 0 failed) |  |  | pass |
| `e2e-anim-bars.mjs` | pass (9 passed, 0 failed) |  |  | pass |
| `e2e-animate-card.mjs` | pass (26 passed, 0 failed) |  |  | pass |
| `e2e-animate-export.mjs` | pass (10 passed, 0 failed) |  |  | pass |
| `e2e-animate-multi.mjs` | FAIL (0 passed, 1 failed) | FAIL (0 passed, 1 failed) | pass (11 passed, 0 failed) | pass on 4242 (defaults to 4343) |
| `e2e-animate.mjs` | pass (60 passed, 0 failed) |  |  | pass |
| `e2e-blender-roundtrip.mjs` | pass (381 passed) |  |  | pass |
| `e2e-brep-fill.mjs` | FAIL (0 passed, 1 failed) |  |  | missing file (NIST STEP) |
| `e2e-cad-cut.mjs` | FAIL (0 passed, 1 failed) |  |  | missing file (NIST STEP) |
| `e2e-cad-lines.mjs` | pass (17 passed, 0 failed) |  |  | pass |
| `e2e-cad-looks.mjs` | pass (11 passed, 0 failed) |  |  | pass |
| `e2e-cam-pop.mjs` | pass (34 passed, 0 failed) |  |  | pass |
| `e2e-capslock.mjs` | pass (3 passed) |  |  | pass |
| `e2e-capture.mjs` | pass (6 passed, 0 failed) |  |  | pass |
| `e2e-cards-follow.mjs` | pass (6 passed, 0 failed) |  |  | pass |
| `e2e-claude-boot.mjs` | pass (3 passed, 0 failed) |  |  | pass |
| `e2e-claude-feed.mjs` | FAIL (37 passed, 1 failed) | pass (38 passed, 0 failed) |  | flaky (passed on re-run) |
| `e2e-cloner-clip.mjs` | FAIL (0 passed, 1 failed) | pass (5 passed, 0 failed) |  | flaky (passed on re-run) |
| `e2e-cmd-card-grow.mjs` | FAIL (0 passed, 1 failed) | FAIL (0 passed, 1 failed) | pass (5 passed, 0 failed) | pass on 4242 (defaults to 4343) |
| `e2e-copy-keys.mjs` | pass (4 passed, 0 failed) |  |  | pass |
| `e2e-copy-shadows.mjs` | FAIL (0 passed, 1 failed) | pass (5 passed, 0 failed) |  | flaky (passed on re-run) |
| `e2e-decimate-card.mjs` | pass (30 passed, 0 failed) |  |  | pass |
| `e2e-delete-undo.mjs` | pass (21 passed, 0 failed) |  |  | pass |
| `e2e-dof.mjs` | FAIL (0 passed, 1 failed) | FAIL (0 passed, 1 failed) | FAIL (14 passed, 3 failed) | **(b)** Alt+click is Ctrl+click now |
| `e2e-drag-cursor.mjs` | FAIL (9 passed, 1 failed) | FAIL (9 passed, 1 failed) |  | **(b)** scrubs the greyed Shading angle bar |
| `e2e-edit-bgread.mjs` | FAIL (8 passed, 5 failed) | FAIL (12 passed, 1 failed) |  | (c) frame over 400 ms entering Points, varies |
| `e2e-edit-cache.mjs` | FAIL (15 passed, 2 failed) | FAIL (15 passed, 2 failed) |  | **(b)** dots' renderOrder 12 → 19 |
| `e2e-edit-dot-size.mjs` | pass (8 passed, 0 failed) |  |  | pass |
| `e2e-edit-dots.mjs` | pass (7 passed, 0 failed) |  |  | pass |
| `e2e-edit-marks.mjs` | pass (17 passed, 0 failed) |  |  | pass |
| `e2e-edit-merged.mjs` | pass (all passed) |  |  | pass |
| `e2e-edit-move.mjs` | pass (22 passed, 0 failed) |  |  | pass |
| `e2e-edit-ortho-switch.mjs` | FAIL (1 failed) | FAIL (1 failed) |  | (c) settle loader over the view; smaller dots |
| `e2e-edit-sheet.mjs` | FAIL (1 failed) | FAIL (2 failed) |  | (c) settle loader over the counted area |
| `e2e-edit-stays.mjs` | pass (all passed) |  |  | pass |
| `e2e-env-up.mjs` | pass (13 passed, 0 failed) |  |  | pass |
| `e2e-export-exploded.mjs` | pass (8 passed, 0 failed) |  |  | pass |
| `e2e-export-texture-size.mjs` | pass (9 passed, 0 failed) |  |  | pass |
| `e2e-export-uv.mjs` | pass (6 passed) |  |  | pass |
| `e2e-focus-ring.mjs` | FAIL (9 passed, 4 failed) |  | timeout (timeout) | not judged: new, being written by another session |
| `e2e-glass.mjs` | pass (parts red,yellow,glass) |  |  | pass |
| `e2e-grid-far.mjs` | pass (6 passed, 0 failed) |  |  | pass |
| `e2e-holefill-card.mjs` | pass (23 passed, 0 failed) |  |  | pass |
| `e2e-idle-draws.mjs` | pass (4 passed, 0 failed) |  |  | pass |
| `e2e-idle-writes.mjs` | pass (6 passed, 0 failed) |  |  | pass |
| `e2e-import-textures.mjs` | pass (6 passed) |  |  | pass |
| `e2e-isolate.mjs` | pass (84 passed, 0 failed) |  |  | pass |
| `e2e-load-settle.mjs` | pass (6 passed, 0 failed) |  |  | pass |
| `e2e-mat-thumbs.mjs` | FAIL (6 passed, 1 failed) | pass (7 passed, 0 failed) |  | flaky (613 ms vs 600, passed on re-run) |
| `e2e-mcp-photo.mjs` | pass (29 passed, 0 failed) |  |  | pass |
| `e2e-mcp-server.mjs` | FAIL (8 passed, 2 failed) | FAIL (8 passed, 2 failed) | FAIL (167 passed, 2 failed) | missing model, then **(b)** pill in status bar |
| `e2e-mcp-tools.mjs` | pass (199 passed, 0 failed) |  |  | pass |
| `e2e-mesh-tools.mjs` | pass (45 passed, 0 failed) |  |  | pass |
| `e2e-mode-pills.mjs` | pass (12 passed, 0 failed) |  |  | pass |
| `e2e-multicolour.mjs` | pass (79 passed) |  |  | pass |
| `e2e-normal-map-direction.mjs` | pass (16 passed, 0 failed) |  |  | pass |
| `e2e-notes.mjs` | FAIL (90 passed, 1 failed) | FAIL (90 passed, 1 failed) | FAIL (90 passed, 1 failed) | (c) pin's hover transition did not advance |
| `e2e-paint-gpu.mjs` | pass (["Metallic Silver/MeshPhysicalMaterial/true/0/0/0","Pearl Wh) |  |  | pass |
| `e2e-paint.mjs` | pass (["Metallic Silver/MeshPhysicalMaterial/true/0/0/0","Pearl Wh) |  |  | pass |
| `e2e-paste-group.mjs` | FAIL (0 passed, 3 failed) | pass (9 passed, 0 failed) |  | flaky (passed on re-run) |
| `e2e-photo-average.mjs` | FAIL (8 passed, 7 failed) | FAIL (8 passed, 7 failed) |  | (c) known: frames in headless |
| `e2e-photo-bar.mjs` | FAIL (13 passed, 1 failed) | pass (14 passed, 0 failed) |  | flaky (passed on re-run) |
| `e2e-photo-pictures.mjs` | FAIL (0 passed, 1 failed) | FAIL (0 passed, 1 failed) | pass (12 passed, 0 failed) | pass on 4242 (defaults to 4343) |
| `e2e-photo.mjs` | pass (22 passed, 0 failed) |  |  | pass |
| `e2e-pivot-orient.mjs` | pass (all checks pass) |  |  | pass |
| `e2e-polytools.mjs` | pass (  warning: THREE.WebGPURenderer: WebGPU is not available, ru) |  |  | pass |
| `e2e-profile-options.mjs` | pass (18 passed, 0 failed) |  |  | pass |
| `e2e-profile-scene.mjs` | FAIL (18 passed, 3 failed) | FAIL (18 passed, 3 failed) |  | known (3 fails before today), not re-diagnosed |
| `e2e-profile.mjs` | pass (17 passed, 0 failed) |  |  | pass |
| `e2e-quick-remesh-cancel.mjs` | FAIL (4 passed, 1 failed) | FAIL (4 passed, 1 failed) |  | (c) 2–3 page stalls over 0.7 s, limit 1 |
| `e2e-quick-remesh-look.mjs` | pass (5 passed, 0 failed) |  |  | pass |
| `e2e-quick-remesh-obj.mjs` | pass (8 passed, 0 failed) |  |  | pass |
| `e2e-quick-remesh.mjs` | pass (6 passed, 0 failed) |  |  | pass |
| `e2e-recovery-copy.mjs` | pass (4 passed, 0 failed) |  |  | pass |
| `e2e-recovery.mjs` | FAIL (29 passed, 2 failed) | FAIL (3 passed, 3 failed) | FAIL (29 passed, 2 failed) | (c)+(a) settle loader; F5 wording (pre-existing) |
| `e2e-review-fixes.mjs` | FAIL (1 failed) | FAIL (1 failed) |  | missing file (as1 STEP: a 404 page is posted) |
| `e2e-robustness.mjs` | pass (50 passed, 0 failed) |  |  | pass |
| `e2e-round-card.mjs` | pass (29 passed, 0 failed) |  |  | pass |
| `e2e-round-part.mjs` | pass (6 passed, 0 failed) |  |  | pass |
| `e2e-round-wire.mjs` | pass (17 passed, 0 failed) |  |  | pass |
| `e2e-save-recent.mjs` | pass (13 passed, 0 failed) |  |  | pass |
| `e2e-save-roundtrip.mjs` | pass (19 passed, 0 failed) |  |  | pass |
| `e2e-scania-uv.mjs` | FAIL (Node.js v24.16.0) |  |  | missing file (Scania-8x4.glb) |
| `e2e-seg-thumb.mjs` | pass (18 passed, 0 failed) |  |  | pass |
| `e2e-select-all.mjs` | pass (select all #2 (after deselect) selected: 95 long tasks (ms):) |  |  | pass |
| `e2e-shade-scrub.mjs` | FAIL (0 passed, 2 failed) | pass (7 passed, 0 failed) |  | flaky (passed on re-run) |
| `e2e-shadows.mjs` | pass (8 passed, 0 failed) |  |  | pass |
| `e2e-smoke-drag.mjs` | pass (page exceptions 0) |  |  | pass |
| `e2e-smoke.mjs` | pass (console errors: 0) | pass (console errors: 0) |  | pass (needs the model as 2nd argument) |
| `e2e-split-material.mjs` | FAIL (0 passed, 1 failed) | FAIL (0 passed, 1 failed) | pass (12 passed, 0 failed) | pass on 4242 (defaults to 4343) |
| `e2e-tex-drop.mjs` | pass (13 passed, 0 failed) |  |  | pass |
| `e2e-texformat-save.mjs` | pass (5 passed, 0 failed) |  |  | pass |
| `e2e-texsets.mjs` | FAIL (13 passed, 1 failed) | FAIL (6 passed, 2 failed) | FAIL (13 passed, 1 failed) | **(b)** DirectX map's ny is +1 since 9a8bc49 |
| `e2e-texture-anisotropy.mjs` | pass (11 passed, 0 failed) |  |  | pass |
| `e2e-texture-uv.mjs` | pass (8 passed, 0 failed) |  |  | pass |
| `e2e-transform-multi.mjs` | pass (all checks pass) |  |  | pass |
| `e2e-undo-memory.mjs` | pass (16 passed, 0 failed) |  |  | pass |
| `e2e-undo-while-settling.mjs` | pass (7 passed, 0 failed) |  |  | pass |
| `e2e-update.mjs` | FAIL (Node.js v24.16.0) |  |  | harness fixed (then 40 passed, 3 failed); **(b)** version text |
| `e2e-usd-dae.mjs` | pass (30 passed, 0 failed) |  |  | pass |
| `e2e-uv-carry.mjs` | pass (11 passed) |  |  | pass |
| `e2e-visible-only.mjs` | pass (all passed) |  |  | pass |
| `e2e-voxel-remesh.mjs` | pass (12 passed, 0 failed) |  |  | pass |
| `e2e-wire-switch.mjs` | pass (second switch to wire long tasks (ms): [] total blocked 0 ms) |  |  | pass |
| `ellipsis-labels.test.cjs` | pass (PASS no stray & at the end of a word in 55 files) |  |  | pass |
| `emboss.test.mjs` | pass (emboss: all checks passed) |  |  | pass |
| `explode-undo.test.mjs` | pass (explode-undo: all checks passed) |  |  | pass |
| `facemat.test.mjs` | pass (facemat: all 16 checks pass) |  |  | pass |
| `fasteners.test.mjs` | pass (all checks passed) |  |  | pass |
| `gridmesh.test.py` | pass (all passed) |  |  | pass |
| `holefill-proof.test.mjs` | pass (53 passed, 0 failed) |  |  | pass |
| `holefill.test.mjs` | pass (all checks passed) |  |  | pass |
| `meshcheck.test.mjs` | pass (30 passed, 0 failed) |  |  | pass |
| `meshedit.test.mjs` | pass (all 62 checks passed) |  |  | pass |
| `meshfix.test.mjs` | pass (all passed) |  |  | pass |
| `meshrepair.test.mjs` | pass (meshrepair: turned-corner checks pass) |  |  | pass |
| `meshtools.test.mjs` | pass (all passed) |  |  | pass |
| `normals-stress.test.mjs` | pass (normals stress: 314/314 checks pass) |  |  | pass |
| `notes-exchange.test.mjs` | pass (all checks passed) |  |  | pass |
| `notes.test.mjs` | pass (all checks passed) |  |  | pass |
| `pipegrid.test.mjs` | pass (all checks passed) |  |  | pass |
| `profile.test.mjs` | pass (all passed) |  |  | pass |
| `reduce-quality.test.mjs` | pass (reduce-quality: all checks passed) |  |  | pass |
| `remesh.test.mjs` | pass (all passed) |  |  | pass |
| `repeats.test.mjs` | pass (11 passed, 0 failed) |  |  | pass |
| `revolve.test.mjs` | pass (all passed) |  |  | pass |
| `roundfaces.test.mjs` | pass (all checks passed) |  |  | pass |
| `serve-paths.test.py` | pass (all checks passed) |  |  | pass |
| `shortcuts.test.mjs` | pass (ok: 93 bindings listed, 22 in _KEYMAP, 32 by hand) |  |  | pass |
| `simplify-core.test.mjs` | pass (all passed) |  |  | pass |
| `smooth.test.mjs` | pass (all passed) |  |  | pass |
| `splines.test.mjs` | pass (all 104 checks passed) |  |  | pass |
| `split.test.mjs` | pass (all passed) |  |  | pass |
| `stacked-copies.test.mjs` | pass (stacked-copies: all cases as expected) |  |  | pass |
| `stylesheet-literals.test.cjs` | FAIL (  app/index.html:6421  @keyframes art-find { 0%, 26% { strok) |  |  | **(a)** design rule: 4 new literal colours |
| `texformat.test.mjs` | pass (18 passed, 0 failed) |  |  | pass |
| `texsets.test.mjs` | pass (30 passed, 0 failed) |  |  | pass |
| `thickness.test.mjs` | pass (all checks passed) |  |  | pass |
| `triangulate-stress.test.mjs` | pass (24 plates, 458 checks, 0 failed, 4246 ms) |  |  | pass |
| `undo-redo.test.mjs` | pass (undo-redo: all checks passed) |  |  | pass |
| `unsubdivide.test.mjs` | pass (all checks passed) |  |  | pass |
| `untriangulate-quads.test.mjs` | pass (all passed) |  |  | pass |
| `untriangulate.test.mjs` | pass (all passed) |  |  | pass |
| `updater.test.py` | pass (all checks passed) |  |  | pass |
| `user-groups-undo.test.mjs` | pass (user-groups-undo: all checks passed) |  |  | pass |
| `uvcarry.test.mjs` | pass (7 passed) |  |  | pass |
| `uvtools.test.mjs` | pass (all 28 checks passed) |  |  | pass |
| `voxel.test.mjs` | pass (all passed) |  |  | pass |
| `wirelines.test.mjs` | pass (all passed) |  |  | pass |

All other files: pass on the first run. "Missing file" = a sample model that is not in this checkout (`inbox/` holds only the Gearbox;
`inbox/benchmark/`, `Drive_Unit_DU-240.glb` and `Scania-8x4.glb` are on the other computer, or nowhere): these tests could not be
judged. `e2e-update` after the harness fix: 40 passed, 3 failed.

## (a) Real bugs

1. **The settle loader runs to its 12-second cap on a slow graphics path** (since v0.36.0, 71f2455; not new). After a load,
   `_settleView` draws behind "Preparing the view" until four frames in a row take no more than `max(34 ms, 1.5 × the quickest
   frame)`. With software WebGL one quick frame early on (little to draw) sets a bar that the real 150 to 200 ms frames never meet.
   Measured with a probe on 4242: the Gearbox showed parts at 2.5 s and the loader until 14.3 s, with the tab's `load` task listed
   throughout; the 128-triangle sheet of `e2e-edit-sheet` still had the loader at 11 s (screenshots). Not checked on a real graphics
   card, where frames are even sooner; a slow laptop would wait the full 12 s after every load. Where: `_settleView` in
   `app/js/app.js` (`best`, `even`). It is what spoils `e2e-edit-sheet`, `e2e-edit-ortho-switch` and `e2e-recovery` (below).
2. **F5 during "Preparing the view" says a file is still converting**: "A file is still converting. Reloading stops the conversion
   and loses the changes … you would have to start the import again", though the model is in. `_convertingNow` counts the tab's `load`
   task, which is listed through the settle. Seen in `e2e-recovery` (rounds 1 and 3: `FAIL F5 asks first and says the changes are
   lost "Reload while converting?…"`). Where: `_convertingNow` and the F5 handler in `app/js/app.js`.
3. **Design rule**: `stylesheet-literals.test.cjs`: `FAIL lines with a literal hex colour: 37 is above the ceiling of 35`. New in
   today's `git diff` of `app/index.html`: `.sc-key.is-held{…color:var(--white,#fff)…}` and `.photo-focus-tag` (`color:#16181d`),
   `.photo-focus-tag svg{…stroke:#16181d}`, `.photo-focus-tag b{…color:#6a6f78…}`.

All three are in `UNRELEASED_FIXES.md` under *Found, not fixed yet*.

## (b) Tests out of date

- **`e2e-dof`** (round 3, on 4242): `FAIL Alt+click on the model sets the focus "Orbit pivot"`, `FAIL Alt+click selects nothing`,
  `FAIL the click after Pick selects nothing`. Today's lens rings made Ctrl+click the focus key and dropped Alt ("It replaces … Alt as
  the key", the *New* entry in `UNRELEASED_FIXES.md`; `wireFocus` in `_Photo`). The test still presses Alt.
- **`e2e-texsets`**: `FAIL OBJ: DirectX normal map, green flipped […"normal":"Crate_2K_Normal_DX.jpg","ny":1…]`. Since 9a8bc49 (after
  v0.36.1) an OBJ's normal map is turned on import (`normalScale.y = -1`, as glTF's), and a DirectX map turned again ends at +1. The
  test expects the old -1. `e2e-normal-map-direction` (new in 9a8bc49) checks the lighting itself and passes, so the app is right.
- **`e2e-edit-cache`**: `FAIL every point picked is a dot {"pts":169,"m":{…"dots":0…}}` and the next check. It finds the picked dots as
  the sprite with `renderOrder === 12`; today's dot change draws them last, at 18 / 19 / 20 (`DOT` in `_Elements`). `e2e-edit-dots`,
  `-marks`, `-dot-size` pass.
- **`e2e-drag-cursor`**: `FAIL a slider scrub shows the cursor element with ew-resize … {"shown":false,"cursor":"col-resize"}`, with
  `slider scrub: {"el":"Shading angle = —"…}`. It drags the first visible `.scrub-value`, which is now the right panel's Shading angle
  fill bar, greyed (`.prop-shade.is-off{pointer-events:none}`) with nothing selected, so no drag starts and the cursor left by the
  sidebar resize is read. Whether a fill bar should show the drag cursor element at all is a design question: the bars are native
  range inputs now.
- **`e2e-mcp-server`**: with its default model missing it stops at `scene_summary` (0 parts; a 404 page parsed as a GLB). Given the
  Gearbox: 167 passed, 2 failed: `FAIL the pill opens a dropdown … under it {…"below":false…}` (the pill is in the status bar since
  v0.35.3 and `place()` opens the dropdown upward there) and `FAIL after Stop the tabs are closed again and the pill is idle` (the tab
  count is right; the pill's text did not match /connected/; not looked into further).
- **`e2e-update`**: `ENOENT … copyfile 'tools\build-update.py'`: the script moved to `tools/app/` on 2026-10-18. **Fixed** (one
  line, the copy). Then 40 passed, 3 failed: `the server restarted and the page reloaded on 0.22.0`, `after the reload the card says
  "Updated to 0.22.0"`, `the earlier version is back and the page reloaded`. The server side of each passes (0.22.0 runs, files
  replaced, rolled back); the page checks wait for the brand menu to read `v0.22.0`, but the test makes it so by replacing
  `id="brand-menu-ver">v0.21.0<`, and `index.html` now reads `v0.36.1`, so it never changes.
- **Port 4343**: `e2e-animate-multi`, `-cmd-card-grow`, `-dof`, `-photo-pictures`, `-split-material` default to `APP_PORT || 4343`
  (the mo-e2e skill's own server); against nothing there the page is Chrome's error page and `#file-input` is null (`Cannot set
  properties of null (setting 'files')`). With `APP_PORT=4242` four pass and `e2e-dof` fails as above. Not an app bug.
- Missing files, not judged: `e2e-brep-fill`, `e2e-cad-cut` (NIST STEP), `e2e-review-fixes` (fetches `inbox/benchmark/as1/…stp`, gets
  a 404 page, posts it as a STEP: `status":"error"` from `parse_xcaf_cached`), `e2e-scania-uv`, `converter-fuzz` (skips). `e2e-smoke`
  needs the model as its second argument; given it, it runs clean (0 exceptions, 0 console errors).

## (c) Timing and headless limits

- **`e2e-edit-sheet`** (rounds 1, 2 and a probe): `FAIL the sheet's dots show from the front (dark pixels 134039, without the dots
  134433…)`. Screenshots from a copy of the test: the dots *are* drawn, from the front and from the back; the settle loader (bug 1)
  is still over the middle of the view where the dark pixels are counted. The entry already in *Found, not fixed yet* now says so.
- **`e2e-edit-ortho-switch`**: `FAIL the picked points show in the perspective view and stay small (orange 0 %)`; the later views
  (top 0.1 %, back to perspective 0.1 %) pass. The first shot is about 5 s after the load, under the settle loader; and today's
  picked dots are 6 px (were 9) and shrink in crowds, so 81 dots are about 0.1 % of the picture at the best of times.
- **`e2e-recovery`**: `FAIL writing a copy shows no loader` and the F5 one: the loader seen is the settle's, still up seconds after
  the load; see bugs 1 and 2. Round 2 failed earlier (`the test hook exists`), most likely a half-written file.
- **`e2e-edit-bgread`**: round 1 five failures, round 2 one: `entering Points mode does not hold the page up {"f0":186,"f1":2962}`
  (limit 400 ms; round 1 `{"f0":1055,"f1":8}`). Different checks each time. Today's dots work out each point's gap to its nearest
  neighbour on the page (`pointGaps` in `_Elements`, made once per mesh; three plates of 204,800 triangles) which may add to the first
  frame; not measured, not compared with v0.36.1.
- **`e2e-notes`** (all three rounds): `FAIL and it grows a little, around its own centre [26,26]`. A probe showed the pin matching
  `:hover` with `.note-pin:hover{scale:1.1}` and a `scale` transition `running`, but the computed scale still 1 after 450 ms: the
  transition did not advance in headless while the page was busy. `notes.js` has not changed since v0.35.3. Not proven either way.
- **`e2e-quick-remesh-cancel`**: `FAIL the page was not blocked for long 3` (round 2: 2; the limit is 1 stall over 0.7 s). The cancel
  itself works (the other four pass). Software rendering of the Gearbox; not compared with v0.36.1.
- **`e2e-photo-average`** (known): 8 passed, 7 failed both rounds, the average reaching 12 to 24 of its 32 frames; already in *Found,
  not fixed yet*.
- Flaky, passed on the re-run: `e2e-aa-settings` and `e2e-cloner-clip` (`__openSettings` / `_addPrimitive is not a function`: the
  module had not run, most likely `app.js` half-written by another session), `e2e-paste-group`, `e2e-copy-shadows`,
  `e2e-shade-scrub`, `e2e-claude-feed`, `e2e-photo-bar`, `e2e-mat-thumbs` (613 ms against 600).

## Not judged

- **`e2e-profile-scene`**: the same 3 failures as before today's slider work (known): `a dragged point snaps onto a corner of the
  profile as it was {"snapMark":false}`, `Apply builds both profiles and leaves the pyramid {"L0":412,"L1":412,"B0":12,"B1":12}`
  (nothing changed), `one undo puts both parts back`. Not diagnosed here.
- **`e2e-focus-ring`** (new, untracked, the lens rings): round 2 9 passed, 4 failed (`folded before Photo mode: still folded after`,
  `dragging shows the focus ring, where the press was null`, a `MutationObserver` TypeError); round 3 timed out after 8 minutes with
  no output. Another session was changing that code during the sweep.

## Follow-ups worth doing

- Fix the six out-of-date tests (each is small: Ctrl instead of Alt, `ny === 1`, the dots' order, a part selected before the scrub,
  the pill opening upward, the version string), and give the five 4343 tests the same default as the rest, or document `APP_PORT`.
- Look at `_settleView`'s even-frames rule (bug 1), then re-run `e2e-edit-sheet`, `-ortho-switch` and `-recovery`.
- Measure `e2e-edit-bgread`, `e2e-notes` and `e2e-quick-remesh-cancel` against v0.36.1 on a second server.
