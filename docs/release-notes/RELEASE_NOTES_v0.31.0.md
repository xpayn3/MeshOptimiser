# MeshOptimiser v0.31.0 (Bled)

A polish of the interface, and a tidier folder: icons, menus and dropdowns share one look, groups can be locked, and the download is organised like an installed program.

## New

**A polish of the interface.** The icons in the toolbars are sharper and a little softer, the dividers in them are easy to see, and the + and − of the part tree are in the middle of their circles. Every menu and dropdown has the same look and opens the same way, in 120 ms, and closes at once. The right-click menus of the part tree are about half as long: what is used least is one level in. The Export window shows the format, the file name and *Visible parts only* up front, with the rest under *Advanced*.

**Pivot points in Export.** A part from a STEP file has its origin at 0, 0, 0, so every axis in a file opened in Cinema 4D sat there. Export (GLB, glTF, FBX and USDZ) now writes each part around its own centre, so the axis is where the part is. FBX objects also carry the rotation and scale of their part.

**Groups can be locked.** *Lock* in Properties, or *Lock everything inside* on the right-click menu of a group, locks every part in it. A locked part or group shows a red lock where its icon is.

## Around the app

**A tidier folder, and why.** The top of the download had grown past fifty files and folders, and it was hard to see what to double-click. It is organised like an installed program now: the top holds only what you start and read (`start.bat`, `start_hidden.vbs`, `start.command`, `Install MeshOptimiser.bat`, the README and the licence) and one folder, `app`, with the program inside (`app\js` for its scripts). The launchers keep their names, so shortcuts keep working. The download is named `MeshOptimiser-v0.31.0.zip` and unpacks into one folder.
Because the files moved, an installed copy is offered the full download once instead of the in-place update; the installer moves your `inbox` and `exports` into `app` and keeps the old loose files in `app\.update\backup-old-layout`. The first start builds the Python environment again.

The launcher window draws the name out of a wire mesh and shows a bar for each step. The *Where is it going?* buttons of the Export window are gone.

## Fixed

FBX objects carry rotation and scale, so the axis of a turned part points along the part. Right-click menus no longer flicker when they close, a toolbar tooltip no longer shows over an open menu, and the list beside a menu row no longer overlaps the menu. The + and − of the part tree are in the middle of their circles, and the cards of the right panel sit on whole pixels.

Full details are in the CHANGELOG.
