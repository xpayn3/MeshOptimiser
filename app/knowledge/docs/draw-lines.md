# Draw lines and shapes

Draw curves, rectangles, circles and polygons on the floor or on a face, edit their points, and use them as paths.

MeshOptimiser can draw lines. A line is a curve you place yourself, point by point, or a ready-made shape such as a rectangle or a circle. It is a part of the scene like any other: it has a row in the parts tree, can be hidden, renamed, grouped and moved with the gizmo, and every change can be undone. Lines have no triangles; they are there to look at, to measure against, and to sweep a profile along (see [Sweep](meshoptimiser://docs/sweep)).

## Start drawing

1. Press `L`, or click **Draw** on the bottom toolbar. The card opens bottom left in the viewport.
2. Choose a tool at the top of the card, and the kind of curve: **Bezier**, **Cubic**, **B-spline** or **Linear**.
3. Click in the viewport. The keys that do something right now are listed at the bottom right.
4. Press `Esc` to put the tool away.

## The tools

- **Pen**: Click for a point; drag to pull out handles and make a curve (Bezier). `Enter` finishes the line, `C` closes it, and a click on the first point closes it too. `Backspace` takes back the last point.
- **Rectangle**: Click one corner, move, click again to place it. `Shift` makes a square and `Alt` draws from the centre.
- **Circle**: Click the centre, move, click again. The ellipse switch gives it two radii.
- **Arc**: Three clicks: the start, the end, and a point the arc passes through.
- **Polygon**: Click the centre, move, click again. The arrow keys change the number of sides; the card has Star and Around the circle.
- **Freehand**: Draw with the mouse held down; the stroke is smoothed into a curve when you let go.
- **Edit**: Change a line that is already there (see below).

While a rectangle, circle or polygon waits for its second click you can type its size, for example `20 x 10`, and press `Enter`.

## Where it draws

- **Ground, Front, Side**: The three flat planes of the scene.
- **View**: A plane that faces the camera.
- **Surface**: The face of a part: the first click picks the face, and the line is drawn on it.
- **Offset**: Moves the plane along its normal, in millimetres.

## Snapping

With **Snap to grid** on, a field of dots fades in around the pointer, and a click a few pixels from a dot lands exactly on it. **Grid step** is Auto (it follows the zoom) or a number you type. **Snap to points** snaps to the points of other lines. Holding `Shift` snaps the angle in steps of 15°. The dots hide themselves when they would crowd, for example when you look at the plane from far away or edge-on.

## Edit a line

1. Choose **Edit** in the card and click a line (or pick it in the tree).
2. Drag a point or a handle. The curve follows while you drag.
3. Click on the curve to add a point. Double-click a point to make it smooth or sharp. `Delete` removes the selected point and `C` opens or closes the line.
4. Hold `Ctrl` while you drag a handle to move it on its own; the other handle of that point stays where it was, and stays free afterwards.
5. The buttons in the card close or open the line, reverse it, simplify it, make a point smooth or sharp, round a corner (or all of them), or add a mirrored copy.

Bezier handles snap to the grid like points do.

## Round or cut the corners

A rectangle or polygon that is still a shape shows a small ring on its first corner in Edit. Drag it along the diagonal to round or cut every corner at once; it snaps to the grid and the card says how far the corner reaches. Click **Round** or **Bevel** next to the ring to change the kind: a true arc, or a straight cut. The same two settings are in the card and in Properties.

## Properties of a line

Select a line and look at **Properties** in the right sidebar.

- **Shape**: For a rectangle, circle, ellipse, polygon or star that has not had its points moved: width, height, radius, sides, star and inner radius, corner type and size. A rectangle grows about its centre.
- **Spline**: Type (Bezier, Cubic, B-spline, Linear), Close Spline, and **Interpolation**, which says how the curve is cut into the short straight pieces that are drawn: None keeps only the points, Natural and Uniform put a number of points on each piece, Adaptive adds points until no corner turns by more than the Angle, and Subdivided does that and also keeps every piece shorter than the Maximum length. The settings that do not apply are greyed.

Once you move a point of a shape by hand it becomes an ordinary spline, and the Shape card goes away.

> Lines are written into GLB, glTF and saved scenes. The other export formats have no lines and leave them out.

Related: [sweep](meshoptimiser://docs/sweep), [organise-the-tree](meshoptimiser://docs/organise-the-tree), [move-rotate-scale](meshoptimiser://docs/move-rotate-scale)
