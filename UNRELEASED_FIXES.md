# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.29.0**.

## Fixed


![fix][fix] **Undo and redo on an exploded view left the parts, the sliders and the pill out of step, and holding Ctrl+Z froze the page.** Undo and redo now put an exploded view back together first (the sliders go to 0), and a held Ctrl+Z / Ctrl+Y does one step per press.
Cause: undo/redo wrote parts back to their rest pose while state.explode and the cached rest positions stayed exploded; key repeat queued a full outline/tree rebuild per repeat.
Where: app-v2.js, the outermost undoLast / redoLast wrapper (_explodeSettle) and the Ctrl+Z / Ctrl+Y keydown.
![fix][fix] **Exploding, deleting a part, putting the view back and undoing the delete brought the part back exploded, with the amount at zero.** A deleted part now moves with the exploded view, so undoing the delete puts it where the view has it.
Cause: resetExplode / applyExplode skipped deleted parts, and a deleted instance kept the matrix it had when exploded.
Where: app-v2.js, applyExplode, resetExplode and the delete undo handler (op.wasExploded).
