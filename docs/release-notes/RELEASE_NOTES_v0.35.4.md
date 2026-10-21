# MeshOptimiser v0.35.4

v0.35.3 was about what the app shows you before it changes anything. v0.35.4 is about Edit mesh on big models: a part of millions of triangles is read in the background as soon as Edit mesh is entered, its points show, and moving, box-picking and hovering over many picked pieces no longer hold the view up.

## New

**Big parts are read in the background.** A part of more than 60,000 triangles is read on a worker as soon as Edit mesh is entered, and the view keeps turning meanwhile. A very big part used to wait for a first click, which then held the app up for seconds. A click, a box or Pick all made while a part is still being read is made as soon as it is ready.

**Points mode shows up to 2,000,000 points** (it was 400,000), so a part of 2.7 million triangles shows its 1.3 million points a few seconds after the mode is entered.

**Moving picked pieces on a part of two million triangles takes half a second** (it was five), and a frame of the drag 7 ms. **A box over such a part** takes about a tenth of a second a pass (in Polygons mode one drag used to take 13 seconds). **Many picked edges or points** no longer slow the pointer and the view down.

**Merge by group names the merged part after its group.**

## Around the app

The picked polygons are drawn from the part's own points; their outlines show up to 40,000 polygons, as the picked points and edges do.

## Fixed

Dissolving a point on an edge line that has another line ending at it now works; colours kept in the vertices (merged and painted parts) show in the CAD view; the Edit mesh tools no longer drop you out of Edit mesh.

The speed-ups were measured in a test browser on a desktop graphics card, on a generated part of two million triangles and on a real assembly; several items were not yet checked by hand in the app, and the changelog says which.
