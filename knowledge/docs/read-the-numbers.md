# How to read the numbers

What a triangle count tells you, where the app shows it, how to find the heaviest parts, and how to see what your work has saved.

A 3D model on a screen is made of triangles. Every triangle has to be stored in the file and drawn many times a second. So the triangle count is the simplest measure of how heavy a model is: fewer triangles mean a smaller file and a smoother view.

There is no single right number. It depends on where the model will be shown. Ask whoever will use the file what they need, then work towards that.

## The whole scene

With nothing selected, **Properties** in the right sidebar describes the scene:

- **The large number**: Triangles in the scene (“tris”).
- **% of original**: How many triangles are left compared with the file as it was opened. It starts at 100%.
- **per part**: The average number of triangles in a part.
- **Parts**: How many parts there are.
- **Vertices**: How many corner points the triangles have.
- **Size**: How large the whole model is along its three axes, in the display unit.
- **Mesh data**: How much memory the triangles take. A shape that repeats is counted once.

The status bar under the viewport shows the number of vertices, the size of the mesh data, how many parts are selected and flagged, the frame rate and the console.

## One part

Select a part and **Properties** describes it instead: its name, its material, its triangle count, its share of the scene, and where it ranks by weight, for example “#28 of 67 by weight”. Below that are its vertices, size and volume.

Every part remembers the triangle count it arrived with. After you have reduced a part, the card leads with what was saved, in the form “21,688 triangles −34% · was 32,728 · saved 11,040”.

## What an action saved

Right after an action that removes triangles, the saving shows beside the scene’s triangle count for a few seconds, for example “−427,543 (−38%)”.

## Find the heavy parts

1. Open the card **Heavy parts** in the right sidebar.
2. It lists the parts with the most triangles, heaviest first, each with a bar that shows how it compares with the heaviest.
3. Click a row to tick it: the part is selected in the viewport. Right-click a row to move the view to the part. The card **Heavy parts** lists the parts with more than 10,000 triangles.
4. Decide what to do with it: delete it, simplify it, or leave it.

A few parts often hold a large share of the triangles. Start with those.

## Heatmap

Press `4` for the heatmap view. Each part is coloured by how densely it is covered in triangles for its size. Dense parts stand out in warm colours. A small part in a hot colour carries far more detail than it needs. Press `1` to go back to the normal view.

## The optimisation report

The report puts the scene as it was opened beside the scene as it is now. It is the number to show whoever asked for a lighter file.

1. Open the card **Reduce triangles** and press **Optimisation report**. The search (`Ctrl + K`) finds it too.
2. Read the table: **Original**, **Now** and **Change** for triangles, vertices, parts, draw calls, materials and mesh data in memory.
3. The row **File** fills in after you have exported.
4. Press **Copy** to copy the table as text.

Related: [workflow](meshoptimiser://docs/workflow), [delete-small-parts](meshoptimiser://docs/delete-small-parts), [fit-to-budget](meshoptimiser://docs/fit-to-budget), [view-modes](meshoptimiser://docs/view-modes)
