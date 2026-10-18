# CAD faces and edges from a STEP file

A STEP file knows its real faces and real edges. MeshOptimiser keeps them, so the outlines are the ones the designer drew.

A mesh is made of triangles. The CAD file it came from is made of faces, each one a clean surface such as a plane, a cylinder or a sphere, and of edges, the lines where those faces meet. When the app converts a STEP file, it now keeps that information next to the mesh.

## Outlines that are really there

The lines drawn on a model used to be guessed from the angle between triangles. For a STEP file they are now the file’s own edges. Curved parts show smooth, true outlines, and a flat plate with a lot of triangles does not grow lines where there are none.

## The CAD edges pill

When a scene has this information, a **CAD edges** pill appears in the row of pills in the view. Click it to open the **CAD faces and edges** panel. It tells you the file, how many solids, CAD faces and CAD edges it holds.

- **Face info on hover**: Off by default. Point at a face and a tip names it: plane, cylinder, cone, sphere, torus, a free-form surface and so on, with its radius or angle, its area and how many triangles it has. The face is tinted blue while you point at it.
- **Tangent edges**: On by default. These are the edges where two faces run smoothly into each other, such as the borders of a fillet. Switch them off to see only the edges that are really sharp.

## Flat faces that are exactly flat

Two tools use the CAD faces as well as draw them. **Remove holes** and **Untriangulate** both need to know which triangles make up one flat face. Without the CAD information they work it out from the angles between triangles, with a small tolerance, and a face whose tessellation wobbles a little can fall apart into facets, or two faces that meet at a very shallow angle can be taken for one. With it, a face the CAD file calls a plane is one flat face, exactly, and two neighbouring plane faces are never joined. The rest of the part is handled as before. Nothing to switch on: it happens whenever the part still carries its CAD faces.

> A part you edit (decimate, remesh, move its points) goes back to ordinary outlines, because the CAD faces no longer match its triangles. Copies of the same part share the information. A simplified level-of-detail part has none.

## Surface parts

Some STEP files carry parts that are only surfaces, with no solid inside: sheet covers, shields, trim. They used to be left out. **Surface parts** in the import window is on by default and brings them in as parts of their own. Switch it off to keep only the solids.

Related: [first-file](meshoptimiser://docs/first-file), [convert-step-to-glb](meshoptimiser://docs/convert-step-to-glb), [view-modes](meshoptimiser://docs/view-modes)
