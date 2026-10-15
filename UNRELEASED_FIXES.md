# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.31.0**.

## Fixed

- The buttons at the bottom of the Claude connected dropdown (Claude mode, Copy command, Console, More…) ran out of the panel. Claude mode now has a row of its own and the other three sit under it.
- The sidebar button in the top bar drew its icon larger than the Menu and Export icons, so its lines looked thicker. Icon-only buttons in the top bar now draw at the same size.
- The start screen cards (New scene, Open file, Import) now show their shortcut only on hover or keyboard focus.
- No tooltip over search and filter fields (the parts search, the library and materials filters, Settings, Help and Shortcuts search).
