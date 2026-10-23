# Section view

Cut the whole scene with one plane to look inside it: everything on one side is cut away and the inside of the cut is drawn flat.

A section view shows what is inside. One plane goes through the whole scene, everything on one side of it is cut away, and the cut is drawn in one flat blue, so a hollow part reads as solid where the plane goes through it. It is for looking, not for working: while it is on, nothing can be picked.

## How to use it

1. Press `Ctrl + K`, type `section` and choose **Section view**.
2. A **Section** pill appears at the top left of the view, with a small card under it. Choose the axis: **X**, **Y** or **Z**.
3. Drag **Position** to move the plane from one end of the scene to the other. The number is a share of the scene’s extent along that axis, from 0 to 100 %; click it to type one.
4. Press **Flip** to keep the other side.
5. Press `Esc`, or click the **Section** pill, to switch it off. The scene is as it was.

## What works while it is on

- The camera: orbit, pan and zoom as always.
- The panels of the right sidebar. **Exploded view** moves the parts apart and the cut faces go with them.
- Hiding a part, with its eye in the tree.

## What does not

- A click on the view or on a row of the tree selects nothing, and the view does not light up what is under the pointer. Whatever was selected is cleared when the section starts. `Ctrl + A` is ignored.
- The CAD edge lines and the wireframe are not cut, and a transparent part gets no cut face.

> It is light: only the parts the plane passes through get a cut face, and moving the plane costs a comparison for each part. There is one plane, not a box. The cut face is drawn flat and blue; there is no outline or hatching on it.

Related: [view-modes](meshoptimiser://docs/view-modes), [exploded-view](meshoptimiser://docs/exploded-view), [photo-mode](meshoptimiser://docs/photo-mode)
