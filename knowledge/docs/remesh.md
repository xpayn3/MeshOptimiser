# Remesh: Untriangulate and Triangulate

Join the triangles of each flat face into one polygon and take away the vertices in its middle, or go back to even triangles. The shape stays as it is.

Screens draw triangles, so every flat face of a part is cut into triangles, often more than it needs. A polygon, also called an n-gon, is a flat face with any number of corners: several triangles in one plane, joined into one face.

Remesh has two actions in one panel. **Untriangulate** joins flat triangles into polygons and takes away the vertices in the middle of each flat face. **Triangulate** is the way back: the flat faces stop being polygons and show their triangles again.

## When to use it

- Untriangulate: on a part whose flat faces carry vertices they do not need, for example around holes you closed with [Remove holes](meshoptimiser://docs/fill-holes). The part loses those vertices and the triangles that hung on them.
- Triangulate: to go back to plain triangles, or to even out long thin triangles on flat faces.

## Steps

1. Select the parts to work on. With nothing selected, the panel works on every part.
2. Click **Remesh** on the bottom toolbar. Its icon is a grid. The panel opens at the bottom left of the viewport. You can also find it with the search (`Ctrl + K`, “Remesh”).
3. Choose **Untriangulate** or **Triangulate** at the top of the panel. The settings of the one you chose show under it.
4. Press the button under the settings, or `Enter`. It carries the name of the action you chose.
5. A message says what was done, for example how many triangles a part had before and after.

## From the keyboard

- `U`: Untriangulate the selection
- `Shift + U`: Triangulate the selection

The two keys work on the selection only, so a key never changes the whole scene by accident. With nothing selected, they only say “Select a part first”.

## The settings of Untriangulate

- **Flat faces within**: How far neighbouring triangles may turn from each other and still count as one flat face, in degrees. It starts at 1.
- **Even triangles**: Turns the edges inside each rebuilt face until its triangles are as even as its vertices allow, instead of long thin fans. No vertex is added or taken away.
- **Flatten shading on flat faces**: A vertex whose triangles all lie in one plane is shaded flat. The rim of a hole you closed needs this. It still carries the tilted shading it had against the wall of the hole, and a face like that is not joined.
- **Shading tolerance**: A flat face is left alone if the shading at its vertices differs from the face by more than this, because joining it would change smooth shading. It starts at 5°.
- **Surface may move**: A vertex that is a little off the plane of its face, as on a gently curved panel, may still go if the surface moves no more than this, and never more than 1% of the part’s size. It starts at 0: only vertices in the plane go.

Untriangulate repeats until nothing more can be joined. Joining faces makes bigger faces, and a vertex that was on the edge between two of them is then in the middle of one.

## The settings of Triangulate

- **Even out the triangles**: Turns the edges inside each flat face until the triangles are as even as its vertices allow, so there are fewer long thin ones. The number of triangles and the vertices do not change.
- **Show their triangle lines**: Draws the triangle lines of these parts in the wireframe, whatever the **Lines** setting is.
- **Flat faces within**: How far neighbouring triangles may turn from each other and still count as one flat face when they are made more even.

## What does not change

The shape of the part. Untriangulate takes away only vertices that lie in the middle of a flat face, so the face keeps its outline. Only when you raise **Surface may move** above 0 can the surface shift, and by no more than the distance you typed. Triangulate adds no vertex and takes none away.

## How it shows in the view

In the wireframe view (`2`), a part that has been through Untriangulate draws its polygons, and a part that has been through Triangulate draws its triangles. That holds whatever **Lines** is set to under **Settings**, **Viewport**.

## Undo

A run is one undo step. Press `Ctrl + Z` and the mesh is as it was.

Related: [fill-holes](meshoptimiser://docs/fill-holes), [remove-floating-pieces](meshoptimiser://docs/remove-floating-pieces), [decimate](meshoptimiser://docs/decimate), [view-modes](meshoptimiser://docs/view-modes), [workflow](meshoptimiser://docs/workflow)
