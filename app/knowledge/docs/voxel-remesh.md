# Voxel remesh

Rebuild a part as one clean, closed, even surface, the way Blender’s Voxel remesh does. Overlapping bodies become one and hollows inside are filled. Good for a watertight stand-in of a messy part.

Voxel remesh puts the part on a grid of small cubes (voxels), works out which cubes are inside it, and builds a new surface round them. The result is always one closed surface with even triangles, whatever the part was made of: bodies that overlap become one, and hollows shut inside the part are filled. Sharp edges and corners stay sharp, down to the size of one voxel. It is not exact CAD: small details under a voxel are lost.

## How to use it

1. Select the parts.
2. Open the command search (**Ctrl + K**) and run **Voxel remesh**.
3. The Wireframe goes on the part being rebuilt (the rest of the model stays as it was) so you can see the new triangles, and the **Voxel remesh** card opens. Drag a setting and let go: the part is built again from the original.
4. Press **Done** or `Esc`. The view goes back to how it was. One undo step (**Ctrl + Z**) takes the whole thing back.

## What the settings mean

- **Detail**: How many voxels fit along the part’s longest side, from 32 to 400. More gives finer detail and more triangles.
- **Adaptivity**: How far the new surface may move, in voxels, while it is reduced to fewer triangles. 0 keeps every face of the grid.
- **Smooth up to**: Faces meeting at less than this angle are shaded smooth; sharper ones keep a hard edge.
- **Close gaps up to**: Fills gaps narrower than this, as a share of the part’s size: the room between fins, a narrow slot. 0 fills nothing. Inside corners of a filled gap come out rounded.

The card says how many triangles the result has, how big one voxel is in millimetres and how wide a gap is closed. The settings are remembered.

## Wrap a whole assembly in one skin

With two or more parts selected, the card has a switch, **Wrap parts into one**. Turn it on and the parts are made one part, called Wrap, and that part is rebuilt on one grid: one closed skin round the whole assembly, with everything inside it gone. Gaps up to 3 % of the length are bridged, so a housing with a small opening is wrapped over it. Use it for a light stand-in that is only seen from outside: a far level of detail, a collision shape, a silhouette. The switch is remembered, so the next Voxel remesh starts the way you left it.

The sliders rebuild the wrap: **Detail** sets how closely the skin follows the shapes, **Close gaps up to** how big an opening is bridged. The parts are not kept: they become one part, and one undo (**Ctrl + Z**) gives every one of them back. Turn the switch off and every part is rebuilt on its own again.

> For a round, turned part (a spool, a pulley) [Round parts](meshoptimiser://docs/round-parts) rebuilds it exactly from its profile, which is usually better than a voxel grid.

Related: [round-parts](meshoptimiser://docs/round-parts), [reshape-mesh](meshoptimiser://docs/reshape-mesh), [smart-fit](meshoptimiser://docs/smart-fit), [decimate](meshoptimiser://docs/decimate)
