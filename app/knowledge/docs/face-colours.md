# Several colours on one part

Give some faces of a part a colour of their own,. The part stays one part, and the colours go with it into every file.

A part has one main material. Some of its faces can wear other materials, each on a selection of faces: a red body with a blue top, a grey housing with a painted logo. It is still one part: it is selected, moved, merged and exported as one, and it stays closed, because the faces in another colour share their edges with the rest.

Parts like this also come in from other programs. A Blender object with several materials opens as one part with its colours, from GLB, glTF, FBX and OBJ. A STEP body whose faces are painted in more than one colour (SolidWorks and Creo do that) opens as one closed part with each colour on its faces.

## Colour some faces

1. Select the part and press `Enter` for **Edit mesh**, then `3` for polygons.
2. Pick the faces: click, box or brush. A double-click picks a loop.
3. Press **Colour** in the Edit mesh bar, or hold `C` over the view. The colour wheel opens, and only the picked faces change as you move. Click to keep the colour.

Or drop a material from the materials dock onto the picked faces, or press its **Assign**: with faces picked in Edit mesh, the material goes on those faces and not on the whole part. Each of these is one step in the undo list.

## See and change the colours of a part

With one part selected, **Properties** lists its colours under its material: the main one first, then each colour on some faces, with how many triangles wear it.

- **The swatch**: Opens a colour picker. A face colour takes the new colour; the main one recolours the rest of the part.
- **The arrow**: Picks those faces in Edit mesh, to see them, change them or colour them again.
- **The cross**: Gives those faces back to the main material.

A material given to the whole part, from the dock or the colour wheel with no faces picked, becomes its main material. The faces in other colours keep theirs.

## What keeps the colours

- Undo and redo, saving the scene and opening it again, and the recovery copy.
- Merge, Split, Decimate and the mesh tools that keep the triangles they do not change. A tool that builds a new surface (a remesh, a boolean) gives the part its main colour all over.
- Select by colour finds a part by any of its colours. Merge by colour goes by the main colour.
- Export: GLB and glTF write a primitive a colour, OBJ a **usemtl** for each, FBX a material for each polygon, USDZ a subset of faces a material. Blender reads each part as one object with its materials. PLY writes the colours on the points. STL has no colours.

> An OBJ keeps its colours in a .mtl file of its own. To read them, drop the .obj and its .mtl together, or the folder that holds them. An OBJ opened alone comes in with one colour, and the app says where its colours are.

Related: [colours-materials](meshoptimiser://docs/colours-materials), [quick-colour-wheel](meshoptimiser://docs/quick-colour-wheel), [edit-mesh](meshoptimiser://docs/edit-mesh)
