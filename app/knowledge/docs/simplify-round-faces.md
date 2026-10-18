# Simplify round faces

Fewer facets on the cylinders, cones, spheres and tori of a part from a STEP, as coarse as a deviation allows. The flat faces follow at the rims, and the part keeps its CAD faces.

A CAD file is cut into triangles fine enough for the workshop, and most of those triangles are on the round faces: fillets, bores, shafts, every cylinder and torus. For a picture on the web they can be far coarser. This tool takes points out of the round faces until the facets are as coarse as the deviation allows. A point on the rim between a wall and its cap goes from both at once, so the cap loses it too and no crack opens.

It needs the CAD faces, so it works on a part from a STEP file opened with them (see [CAD faces and edges](meshoptimiser://docs/cad-edges)), or from a scene saved from one. Unlike most edits, the part keeps its CAD faces afterwards: the faces are the same, only cut coarser, so Remove holes, Untriangulate and Remove fillets and chamfers still know them.

## How to use it

- Select the parts, or select nothing for every part that is shown, and run **Simplify round faces** from the command search (**Ctrl + K**).
- **Deviation up to** is how far the surface may move from the true round face, as a share of the part's size. Looser means fewer facets. The card says how many points went and how many triangles are left.
- **Segments per turn, at least** keeps a full turn from getting coarser than this many facets, however loose the deviation. A bore of 12 facets still reads as round.
- One undo step (**Ctrl + Z**) brings the part back. The flat faces are not touched: [Untriangulate](meshoptimiser://docs/remesh) is the tool for those.

> A point stays where the deviation does not allow it to go: a big cylinder keeps more facets than a small one at the same deviation, which is what a chordal tolerance does. Points where three or more faces meet, and the points of edges that bend sharply, always stay.

Related: [cad-edges](meshoptimiser://docs/cad-edges), [remove-fillets](meshoptimiser://docs/remove-fillets), [remesh](meshoptimiser://docs/remesh)
