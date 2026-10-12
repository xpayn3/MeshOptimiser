# How to export a STEP file from Rhino

Export selected Rhino objects as STEP with File, Export Selected: which protocol keeps colours, what happens to black objects, and what to do with meshes.

Rhino models are made of surfaces and solids, and Rhino writes them to STEP with its Export command.

## Steps

1. Select the objects you want to export.
2. Choose **File**, then **Export Selected**. **Save As** writes the whole model instead.
3. In **Save as type**, choose **STEP (.stp; .step)**.
4. Name the file and press **Save**.
5. The window **STEP Export Options** opens. Choose **AP214AutomotiveDesign** as the schema, so colours and layers come along.
6. Leave the other options as they are, and press **OK**.

## What the choices mean

- **AP203ConfigControlDesign**: The default. Geometry, topology and configuration data, without colours and layers.
- **AP214AutomotiveDesign**: Everything AP203 has, plus colours, layers and GD&T. Choose this one.
- **AP214AutomotiveDesignCC2**: A minor syntax update of the earlier AP214.
- **AP242**: The newest standard, new in Rhino 8. It merges AP203 and AP214.

Rhino’s help says your company’s standards decide which schema to use, and that without a standard the default is fine. For MeshOptimiser, AP214AutomotiveDesign is the one that keeps colours.

## Things to know

- A Rhino object that is black gets no colour in the STEP file, so the next program gives it its default colour. This is on purpose, because black objects look like ink blots in some programs. If you want a colour on them, recolour the parts in MeshOptimiser.
- SubD objects are turned into polysurfaces when they are exported.
- If your model is already a mesh, for example from a scan, STEP is not the best route. Export it as OBJ, FBX or STL instead. MeshOptimiser opens those directly.

> If Rhino’s dialog looks different in your version, search the Rhino help for “STEP import and export”.

## Next

Open the file in MeshOptimiser: see [Open your first file](meshoptimiser://docs/first-file).

Related: [cad-files-step-first](meshoptimiser://docs/cad-files-step-first), [first-file](meshoptimiser://docs/first-file), [convert-step-to-glb](meshoptimiser://docs/convert-step-to-glb)
