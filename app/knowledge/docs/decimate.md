# Decimate

Remove a share of the triangles from the selected parts while keeping their shape. Choose a percentage or a target, and preview first.

Decimate thins out the triangles of a part while keeping its overall shape. It is the tool for a part that matters and is simply too dense.

It is lossy: the removed detail is gone from the mesh. It can be undone.

## When to use it

On the heavy parts you found in [How to read the numbers](meshoptimiser://docs/read-the-numbers), after you have deleted what is not needed. For a whole scene at once, [Fit to budget](meshoptimiser://docs/fit-to-budget) is easier.

## Steps

1. Select the parts to reduce.
2. Open the card **Reduce triangles**: press `Ctrl + K` and type `Reduce triangles`, or find it in the `…` list.
3. In the list beside **Decimate**, choose how much to remove: −25%, −50%, −75% or −90%.
4. Press **Preview…** under it. A table shows each part with its triangle count now and after.
5. Press **Decimate**. The button shows how many parts are selected.
6. Look at the parts. If they have lost too much, press `Ctrl + Z` and try a smaller percentage.

## A triangle target instead of a percentage

1. Choose **Target…** in the list.
2. Type the number of triangles that everything selected may have together.
3. A line under the field says what will happen, in the form “12,400 → about 6,200 triangles”.
4. Press **Decimate**. Each selected part gives up the same share.

Choose **Within…** in the list to give a distance instead: type the largest number of millimetres any point of the surface may move, and triangles are taken out for as long as that holds. The switch **Smart: tidy flat faces**, on at first, tidies the flat faces before and after the reduction.

## What it keeps

- Normals, so the shading stays smooth.
- UVs, the coordinates that place a texture on a surface.
- Vertex colours.
- Material ranges, for a part that uses more than one material.
- Sharp edges, when **Keep sharp edges** is on (it is by default). The vertices on a rim, a step or a corner, where the faces turn by more than 40 degrees, stay where they are while the triangles around them go. It only applies when the part has few such edges and the goal can still be reached. A part that is mostly hard edges, such as a gear (more than 8% of its vertices), is reduced the old way. The switch is in the **Reduce triangles** card and is remembered; Fit to budget uses it too.

## Good to know

- It runs in the background, several parts at a time. The window stays usable, and a long run can be stopped.
- The reduced mesh is what gets saved and exported.
- Decimate has no keyboard shortcut on purpose, because it is lossy. Find it in the card, in the `…` list or with the search.

> A common mistake is to decimate everything by 90% at once. Curved parts become visibly faceted. Reduce in steps, and reduce the densest parts more than the rest.

Related: [fit-to-budget](meshoptimiser://docs/fit-to-budget), [heavy-parts](meshoptimiser://docs/heavy-parts), [read-the-numbers](meshoptimiser://docs/read-the-numbers), [smart-fit](meshoptimiser://docs/smart-fit), [smart-optimise](meshoptimiser://docs/smart-optimise)
