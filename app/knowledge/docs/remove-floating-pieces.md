# Remove floating pieces

Delete the small loose pieces of a part that touch nothing: a plug, a shaving, a dot of a thread. The biggest piece of each part always stays.

A part is usually one piece: all its triangles hang together. A CAD export, or a hole that was closed, can leave small loose pieces next to it that belong to the same part. The plug a hole was cut with, a shaving, a dot of a thread. These floating pieces touch nothing. Nobody sees them, and they still cost triangles. Remove floating pieces deletes them.

## When to use it

After you open a CAD file, or after [Remove holes](meshoptimiser://docs/fill-holes), when a part still has specks beside it or inside a hole that was closed. It is a clean-up, so run it before you reduce triangles.

## Steps

1. Select the parts to work on. With nothing selected, it works on every visible part.
2. Open the card **Quick fixes** in the right sidebar and press **Remove floating pieces…**. Or press `Ctrl + K` and type `floating`. The panel opens at the bottom left of the viewport.
3. Set **Piece size up to** to the longest loose piece you want removed, in millimetres. It starts at 5.
4. Press **Remove**, or `Enter`.
5. A message says how many floating pieces were removed, from how many parts, and how many triangles that took away.

## The two fields

- **Piece size up to**: A loose piece is removed if its longest side is no more than this. 5 mm to begin with.
- **Keep if over**: A loose piece with more triangles than this is kept, however small it is. It starts at 0, which switches it off: the number of triangles does not matter.

## What always stays

- The biggest piece of each part, whatever its size. A part is never emptied.
- Every loose piece that is longer than the limit.
- Every loose piece that has more triangles than **Keep if over** allows, when that field is above 0.

## Undo

A whole run is one undo step. Press `Ctrl + Z` and every piece is back.

> This tool looks inside each part. A small part with a row of its own in the tree, such as a tiny screw, is not a floating piece. For those, see [Delete small parts](meshoptimiser://docs/delete-small-parts).

Related: [fill-holes](meshoptimiser://docs/fill-holes), [remesh](meshoptimiser://docs/remesh), [delete-small-parts](meshoptimiser://docs/delete-small-parts), [cleanup](meshoptimiser://docs/cleanup), [workflow](meshoptimiser://docs/workflow)
