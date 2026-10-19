# Quick fixes and tidying up

Small one-click repairs: remove empty parts and empty groups, fix shading, recentre the model and make moves permanent.

The card **Quick fixes** in the right sidebar holds one-click commands. In the right-click menu they are called Remove empty parts, Deduplicate geometry, Fix degenerate parts, Delete empty groups and Recompute normals. Each command is one undo step.

## Quick fixes

- **Empty parts**: Deletes parts that contain no triangles. Files often carry a few of these.
- **Duplicates**: Looks for parts whose mesh data is identical to another part’s. See the note below before you use it.
- **Degenerate**: Removes parts whose triangles have no area, which can confuse the programs that draw them.
- **Floating…**: Opens a panel that deletes the small loose pieces of a part that touch nothing. See [Remove floating pieces](meshoptimiser://docs/remove-floating-pieces).
- **Empty groups**: Removes groups that have no parts left in them.
- **Normals**: Works out the shading directions of every surface again. Use it when parts look oddly faceted or dark after large changes.

Each command reports what it did, or says that it found nothing.

> Be careful with **Duplicates** on an assembly. It removes a part only when another part with identical mesh data sits in the same place (two copies stacked on each other), so a set of identical bolts placed in different positions stays. Check the parts count afterwards, and press `Ctrl + Z` if it took parts you wanted. (Before v0.20.0 it removed every repeat, placed or not; that was a bug.)

[Smart optimise](meshoptimiser://docs/smart-optimise) starts every run with the first three commands, empty parts, degenerate parts and empty groups, under the name **Empty parts**. Its next step, **Exact copies**, removes what **Duplicates** removes. It runs none of the other commands on this page.

## On the toolbar of the parts tree

- **Recentre**: Moves the model so the centre of its bounding box sits at 0,0,0.
- **Bake transforms**: Makes the moves, turns and scalings you did with the gizmo permanent in the mesh itself.
- **Centre pivot**: Moves the pivot of each selected part to the centre of its bounding box. The part does not move on screen.

## Flags

The card **Filters & flags**, under Find, marks suspicious parts without changing them:

- **Flag low-poly**: Marks parts with fewer triangles than the slider says.
- **Flag slivers**: Marks parts that are extremely long for their width, such as gaskets, wires and decals.

The status bar shows how many parts are flagged. Click that number to isolate them, look at them, and decide what to do.

Related: [remove-floating-pieces](meshoptimiser://docs/remove-floating-pieces), [stacked-copies](meshoptimiser://docs/stacked-copies), [smart-optimise](meshoptimiser://docs/smart-optimise), [parts-tree](meshoptimiser://docs/parts-tree), [align-to-floor](meshoptimiser://docs/align-to-floor), [workflow](meshoptimiser://docs/workflow)
