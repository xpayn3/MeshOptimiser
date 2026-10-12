# Auto cleanup and Tidy geometry

Small one-click repairs: remove empty parts and empty groups, fix shading, recentre the model and make moves permanent.

Two cards in the right sidebar, under Clean up, hold one-click commands. Each is one undo step.

## Auto cleanup

- **Remove empty parts**: Deletes parts that contain no triangles. Files often carry a few of these.
- **Fix degenerate parts**: Removes parts whose triangles have no area, which can confuse the programs that draw them.
- **Delete empty groups**: Removes groups that have no parts left in them.
- **Deduplicate geometry**: Looks for parts whose mesh data is identical to another part’s. See the note below before you use it.

Each command reports what it did, or says that it found nothing.

> Be careful with **Deduplicate geometry** on an assembly. It removes a part only when another part with identical mesh data sits in the same place (two copies stacked on each other), so a set of identical bolts placed in different positions stays. Check the parts count afterwards, and press `Ctrl + Z` if it took parts you wanted. (Before v0.20.0 it removed every repeat, placed or not; that was a bug.)

[Smart optimise](meshoptimiser://docs/smart-optimise) starts every run with the first three commands, empty parts, degenerate parts and empty groups, under the name **Remove empty and broken parts**. It does not run **Deduplicate geometry** or any of the Tidy geometry commands.

## Tidy geometry

- **Recompute smooth normals**: Works out the shading directions of every surface again. Use it when parts look oddly faceted or dark after large changes.
- **Recentre on origin**: Moves the model so the centre of its bounding box sits at 0,0,0.
- **Bake gizmo transforms**: Makes the moves, turns and scalings you did with the gizmo permanent in the mesh itself.
- **Centre pivot**: Moves the pivot of each selected part to the centre of its bounding box. The part does not move on screen.

## Flags

The card **Filters & flags**, under Inspect, marks suspicious parts without changing them:

- **Flag low-triangle parts**: Marks parts with fewer triangles than the slider says.
- **Flag thin slivers**: Marks parts that are extremely long for their width, such as gaskets, wires and decals.

The status bar shows how many parts are flagged. Click that number to isolate them, look at them, and decide what to do.

Related: [stacked-copies](meshoptimiser://docs/stacked-copies), [smart-optimise](meshoptimiser://docs/smart-optimise), [parts-tree](meshoptimiser://docs/parts-tree), [align-to-floor](meshoptimiser://docs/align-to-floor), [workflow](meshoptimiser://docs/workflow)
