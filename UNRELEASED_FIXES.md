# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.27.0**.

## Fixed

![fix][fix] **A picture with a transparent background came out black.** Render image (and Claude's `render_image`) now gives a real see-through PNG when the background is transparent, and a white, light, grey, dark or black background now shows its own colour instead of black. I draw the model once on black and once on white and work the see-through part out from the difference.
Cause: the picture is read back from a canvas without an alpha channel, so an empty background was always opaque black, and every plain colour was laid over that black.
Where: `render_image` in `app-v2.js`.

