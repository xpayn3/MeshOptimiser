# MeshOptimiser v0.27.0

Shadows in the view, car paint that does not look like sandpaper, a Quick remesh that reduces the way a modeller would, and scenes that come back as they were saved.

## New

**Shadows.** Scene > Shadows makes the sun cast shadows: the parts fall on each other, and the model casts a soft shadow on the floor, along the sun's rays, so it follows the Sun gizmo. It is part of a saved scene.

**Quick remesh reduces like Blender does.** Flat faces are joined first (Planar), then every second line of a ring grid goes (Un-Subdivide: a cylinder or a bellows with 100 lines keeps 50, then 25, with no fans), then the simplifier takes the rest, then the flat faces are cut evenly again (Beautify). On the Front Axle 8x8 the Un-Subdivide step alone takes 21 % of the triangles of its parts within a tolerance of 0.2 to 1.5 % of each part's size.

**Change pivot orientation.** Turn the pivot of the selected parts to World, Last selected, View, Spread or to angles you type; the vertices turn the other way, so the parts look exactly as they did. The gizmo has the same choices and a Gizmo card. Hide and Isolate are switches now, and a folder of the model's tree pastes as one new group.

**Car paint presets** with a faint shimmer of flakes, and iridescent pearls and flip-flops. **Keep texture coordinates** is a switch of the import window, so a texture given to a material later shows. **Settings > Performance > Memory** shows what the page holds, and the settings are grouped as cards.

## Around the app

**Scenes come back as they were saved.** A saved scene leads Recent, keeps the look of its materials (and a paint's colour), the unit, grid, lights, shadows, scale and up axis, locked parts, and the explode amount, which used to be written as the view looked, so the parts could not be put back together.

**No more freezes or lost clipboards.** Ctrl+C copies selected text again (the app took it whenever a part was selected), Remove holes with Ctrl+Z in a loop no longer runs out of memory, Undo waits for a running step, closing Quick remesh in the middle of its work does not freeze the page, and the recovery copy waits until you stop working.

**A slimmer loading card**, a time estimate for the STEP read, a prepared Wireframe view, Geist and Space Grotesk as typefaces, and a little more light in the studio.

## Fixed

Quick remesh and Decimate on an OBJ, Remove holes on a ring groove, the gizmo off the part after a pivot turn, patchwork in other programs from a leftover transparent flag, white lettering under a dark colour, merged parts losing their UVs, and the Exploded view sliders jumping by five.

Full details are in the CHANGELOG.
