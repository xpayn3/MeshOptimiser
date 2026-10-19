# Mend a mesh: Close cracks, Remove slivers, Patch holes

Three small repairs for meshes that came out of a CAD program: close the hairline cracks between faces, get rid of needle-thin triangles, and patch openings so the patch follows the curve round them.

A CAD program cuts each face of a model into triangles on its own. Where two faces meet, their edges do not always line up: a hairline crack opens, or a point of one face sits in the middle of an edge of the other. Some triangles come out as long thin needles. A face can also be missing altogether. None of this changes how the part looks from a distance, but it stops the part from being closed, and other tools (Merge bodies, Union, a 3D print) need it closed. These three tools mend it and leave the shape as it was.

## The three tools

- **Close cracks**: Joins the edges of a crack. Ends of open edges that lie closer together than **Gap up to** become one point, and an edge that has another face’s point lying on it is split there, so both sides share their points. Nothing moves further than the gap. The card says how many points were joined and how many open edges there were before and after.
- **Remove slivers**: Cleans up needle triangles. A triangle whose shortest edge is shorter than **Needle under** (a share of its longest edge) has that short edge taken out, and a triangle with one angle near 180° has its long edge turned. Nothing is done where a triangle round it would turn over, so the shape stays.
- **Patch holes**: Closes each opening up to **Holes up to** across (a share of the part’s size). The patch is cut to the size of the triangles round the hole and bent to carry on the curve of the surface, so a hole in a curved face is closed curved, not flat.

## How to use them

1. Select the parts to mend.
2. Open the command search (**Ctrl + K**) and type the tool’s name: **Close cracks**, **Remove slivers** or **Patch holes**.
3. The tool runs on each selected part, and a card opens with its one setting. Change the setting and the tool runs again from the parts as they were, in the same undo step.
4. Press **Done** or `Esc` to close the card. One undo step (**Ctrl + Z**) takes the whole change back.

The settings are remembered for next time. The parts keep their texture coordinates where the surface did not change.

> These tools close cracks and gaps that were never meant to be there. To take out the holes a part was designed with (the bolt holes in a plate), use [Remove holes](meshoptimiser://docs/fill-holes). For a part that is missing whole faces, with open rims all round, **Close** in [Edit mesh](meshoptimiser://docs/edit-mesh) puts a cap on every rim at once.

Related: [fill-holes](meshoptimiser://docs/fill-holes), [edit-mesh](meshoptimiser://docs/edit-mesh), [reshape-mesh](meshoptimiser://docs/reshape-mesh), [booleans](meshoptimiser://docs/booleans)
