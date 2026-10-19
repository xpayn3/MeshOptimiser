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

![new][new] **The recent-tools list is plain text.** Holding or right-clicking the button at the left of the viewport toolbar lists the last tools as names only, with no icon in front, and a command's shortcut sits at the right when it has one. Checked by seeding the list and reading the rows; not yet looked at with a real model.
Where: `vp-last-pop` in `app/js/app.js`, `.vp-last-item` in `app/index.html`.

![new][new] **The switches in the command cards are the small ones.** Dynamic place, Fill holes and the other cards use the same 30 x 16 switch as the right sidebar instead of the larger 34 x 20 one. The Draw card keeps its own size. Checked by measuring the switches in the open Dynamic place card.
Where: `.section-cmd .toggle .switch` in `app/index.html`.

![new][new] **The number rows of the Remesh card sit closer.** Shading tolerance, Dissolve nearly flat within and Surface may move are 6 px apart instead of 14. Checked by measuring the rows.
Where: `.section-cmd[data-cmd="remesh"] .cmd-num` in `app/index.html`.

![new][new] **The Advanced lists of the command cards are evenly spaced.** In Remove holes and the other cards every switch row and every number row is 32 px high with 4 px between, so the labels at the left are 36 px apart all the way down (the switch rows were 25 px and the number rows 40 px high; number fields are 32 px, as in the right sidebar). The main sections of the cards (Dynamic place, Lettering, Pivot, Floating, Fasteners, Sweep, Normals, Repair) and the Remesh card have the same 32 px rows with 4 px between; only the Draw card keeps its own 34 px rows. Checked by measuring every row of every command card.
Where: `.cmd-adv-b` rules after the small switch in `app/index.html`.

![fix][fix] **A tool run by its key did not show up in the recent list.** Pressing P for Remove holes (or X, U, B, L, D, H, Ctrl+B and the other keys) ran the tool but left it out of the recent tools; now it is listed like one picked from the search. Checked by pressing P and reading the list.
Cause: the key table runs the tool directly, and only a command's own run noted it as used.
Where: the key handler's use of `_KEYMAP` in `app/js/app.js`.

![polish][polish] **Smart fit: the labels fit on one line.** The Advanced rows read Cylinder roundness, Cylinder vs box volume, Length to width and Use the part's axes (the third wrapped onto two lines before).
Where: the `fit-circ`, `fit-waste`, `fit-aspect` and `fit-pca` labels in `app/index.html`.

## Fixed

## Found, not fixed yet

