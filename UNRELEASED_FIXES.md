# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.35.5**.

## New

## Fixed

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

## Found, not fixed yet

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


