# Sweep a profile along a line

Turn a path and a profile into a solid part: a pipe, a rail, a ring.

Sweep carries a shape (the profile) along a line (the path) and makes a solid part of it. A circle along a curve makes a pipe, a rectangle along a straight line makes a bar, and a closed path makes a ring.

1. Draw the path with the Draw tool (see [Draw lines and shapes](meshoptimiser://docs/draw-lines)). If the profile should be a drawn shape, draw that too.
2. Open the Sweep card from the search: press `Ctrl + K`, type `sweep` and choose **Sweep…**. It has no button on the bottom toolbar.
3. Pick the **Path** in the list.
4. Choose the **Profile**: a **Circle** (give its size), a **Rectangle** (width and height) or another **Line** from the list.
5. Press **Sweep**.

The result is a normal part called Sweep, with a row in the tree, and one undo step.

## Advanced

- **Scale**: How big the profile is at the start and at the end, as a percentage. 100 and 50 make a pipe that narrows.
- **Twist**: How far the profile turns along the path, in degrees.
- **Close the ends**: Puts a lid on each end so the part is solid.
- **Hard-edge angle**: Corners sharper than this are kept sharp; gentler ones are shaded smooth.

> The sweep follows the line as it is drawn, as short straight pieces. A line with a coarse Interpolation (see Properties of a line) gives a coarse pipe.

Related: [draw-lines](meshoptimiser://docs/draw-lines), [organise-the-tree](meshoptimiser://docs/organise-the-tree), [cleanup](meshoptimiser://docs/cleanup)
