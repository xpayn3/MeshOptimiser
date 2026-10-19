# Reshape a mesh: Remesh evenly, Smooth surface, Convex hull and more

Rebuild a part’s triangles: even and well shaped, smoothed without rounding the edges, as a simple convex shell for a game engine, or with its overlapping bodies joined into one.

These tools keep the part where it is but change the triangles it is made of. Each one is for a different job.

- **Remesh evenly**: Even, well-shaped triangles of one size, lying on the part’s own surface. Edges sharper than **Keep edges sharper than** stay sharp, and so do open outlines. **Edge length** is how long the edges are, as a share of the part’s size: shorter gives more, finer triangles. A very short length is raised so the part does not grow too heavy, and the card says so. For a part that needs clean triangles to be edited, sculpted or printed.
- **Smooth surface**: Takes the noise and the faceting out of a surface without rounding its edges. **Strength** is how many rounds of smoothing. Faces that meet at more than **Keep edges sharper than** keep their edge. Open outlines do not move. For a scan, or a part that was cut into too few triangles.
- **Convex hull**: The smallest shell with no dents that wraps the whole part, like cling film pulled tight. **Points at most** keeps it under the number of points a game engine accepts (most want 255 or fewer). For a collision shape.
- **Convex pieces**: A few convex shells that together follow a part with dents, an L or a U. **Pieces at most** caps how many, **Cut while emptier than** is how much empty room a shell may hold before it is cut in two, and **Points per piece** caps each shell. For a collision shape that fits better than one hull.
- **Merge bodies**: Joins all the closed bodies of one part into one solid, exactly. Bodies that overlap become one, the faces where they met go, and a body wholly inside another goes too. A body that is not closed is left as it was, and the card counts it. It has no settings.

## How to use them

1. Select the parts.
2. Open the command search (**Ctrl + K**) and type the tool’s name.
3. The tool runs on each selected part, and a card opens with its settings, and the Wireframe goes on those parts so you see the triangles change. Change one and the tool runs again from the parts as they were, in the same undo step.
4. Press **Done** or `Esc` to close the card. One undo step (**Ctrl + Z**) takes it all back.

On a part from a STEP file opened with its CAD faces (see [CAD faces and edges](meshoptimiser://docs/cad-edges)), Remesh evenly and Smooth surface keep the CAD file’s own edges sharp, whatever their angle, and leave the seams inside one round face smooth.

> Convex hull and Convex pieces replace the part’s shape with a simpler one: keep a copy of the part (Duplicate, **Ctrl + D**) if you need the original too. Merge bodies needs closed bodies: run [Close cracks](meshoptimiser://docs/mend-mesh) first on a part with hairline gaps.

Related: [mend-mesh](meshoptimiser://docs/mend-mesh), [booleans](meshoptimiser://docs/booleans), [voxel-remesh](meshoptimiser://docs/voxel-remesh), [remesh](meshoptimiser://docs/remesh)
