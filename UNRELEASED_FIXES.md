# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.35.0**.

## New

![new][new] **The default light is brighter.** The studio reflections on the plain backgrounds are nearly twice as strong (0.5 to 0.9) and the exposure starts at 1.15, so shaded sides and dark parts read more clearly. Not yet checked against saved scenes, which keep the exposure they were saved with.
Where: `_STUDIO_REFL` and `applyConfig` in `app/js/app.js`, `state.exposure`, the hidden `#light-exposure` in `app/index.html`.

## Fixed

## Found, not fixed yet

