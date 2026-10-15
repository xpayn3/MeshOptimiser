# File formats

Which files the app opens and which it writes, and what each format keeps: the parts tree, materials and vertex colours.

This page follows the format sheet inside the app. Open it there with **Compare** in the Export window.

## Formats it opens

- **STEP (.step, .stp)**: The CAD exchange format. Converted by the local Python converter. Keeps the parts tree and materials. Open only: the app does not write STEP.
- **IGES (.iges, .igs)**: An older CAD exchange format, often a surface model. Converted by the local Python converter. Keeps the names, colours and layers the file has, but not an assembly tree. Open only.
- **BREP (.brep, .brp)**: The OpenCascade shape format. Converted by the local Python converter. Geometry only. Open only.
- **GLB**: Binary glTF. Keeps the parts tree, full materials and vertex colours. The best all-round format.
- **glTF**: The text form of GLB. The same capabilities, larger.
- **FBX**: A common exchange format for Maya, Blender, Unreal and 3ds Max. Keeps the parts tree and materials.
- **OBJ**: Universal, but with no transforms and no tree. Materials come from a separate `.mtl` file.
- **3MF**: A 3D-printing format. Keeps the parts tree and materials. Open only.
- **STL**: Geometry only, as a single mesh. Used for 3D printing.

STEP, IGES and BREP files go through the converter. The others load directly in the browser.

## Formats it writes

- **GLB**: Parts tree, full materials, vertex colours. Optional Draco compression.
- **glTF**: The same as GLB, as text.
- **FBX**: Parts tree and materials. Binary FBX 7.4 by default, with a text (ASCII) version as a fallback.
- **USDZ**: Parts tree and materials. For Apple Quick Look and Reality Composer. Write only.
- **OBJ**: A flat list of parts, with the hierarchy folded into their names. Materials in a `.mtl` file.
- **STL**: One mesh, geometry only.
- **PLY**: One mesh, with a colour for every vertex. Write only.
- **CSV**: A parts list. No geometry. Write only.

## The three columns of the sheet

- **Hierarchy**: Whether the format keeps the parts tree: groups, and groups inside groups.
- **Materials**: Colour and shading for each part. “PBR” means the full set with metalness and roughness. A plain dot means colour only.
- **Vertex colours**: A colour stored on every corner point of the mesh, with no separate material.

Related: [export](meshoptimiser://docs/export), [choose-format](meshoptimiser://docs/choose-format), [first-file](meshoptimiser://docs/first-file)
