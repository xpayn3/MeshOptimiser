# MeshOptimiser v0.35.0 (Vipava)

One part can now wear several colours, STEP files open with cleaner meshes, Photo mode draws the model for pictures, and a long audit makes file opening, undo, textures, Claude and the updater more dependable.

## New

**Several colours on one part.** Pick polygons in Edit mesh and press *Colour* (or hold C), drop a material on them, or press its *Assign*: the part stays one closed part with a material on each selection of faces. In Properties each colour is a card in the material strip, with a right-click menu to pick, recolour or give back its faces. A GLB, glTF, FBX or OBJ object with several materials opens the same way, and the colours go out in every format. A switch in the import window, *A part per colour*, keeps the old way.

**Cleaner STEP files.** *Even strips* lays clean strips on fillets, and a new *Clean* surface quality keeps the triangle count close to a default import (59,222 on the Scania 8x4 cab against 52,590). **CAD edit** picks whole CAD faces, takes them out and remesh. **Remove holes** and **Untriangulate** read the CAD faces, **Remesh evenly** and **Smooth surface** keep the CAD edges, and parts keep their CAD layers (*Select by layer…*). A STEP converts to a GLB 4 to 6 % smaller, with nothing moved.

**New mesh tools.** *Simplify round faces* gives cylinders, cones, spheres and tori fewer facets; *Remove fillets and chamfers* makes edges sharp again; *Remove lettering and logos* finds raised, engraved and separate-body text; *Close open edges* caps rims and bridges two rims; *Untriangulate* can pair triangles into quads. Decimate keeps the shape closer. Six new Help articles describe the mesh tools, and Claude knows them too.

**Photo mode.** A card in the View group draws the viewport the slow, pretty way: loft studio light, shadows, a round stage, ambient occlusion, glow, lens fringe, vignette and grain, with *Save photo* up to 4x the pixel density. The Scene card is shorter, has five photographed environments as picture cards, and a *Show as background* switch for the HDRI.

**Bottom docks and the start screen.** Materials, Library and Animate share one height (a switch in Settings > General turns it off) and fade into each other. The start screen lists recent files in rows. The Materials panel has a size slider for its pictures. The Animate timeline has a project frame rate.

## Around the app

**One switch, CAD lines,** with a line that says whether the edges are real CAD edges or found by angle. **The sidebar** has one small switch and one dragged number field with a fill everywhere. **Menus** are in a new order and shorter. **The Midnight, Warm and Black tones** now reach the shortcuts window, library, material and animation docks, share menu and splash card. **Smart optimise** steps have short names. Every layer of the stylesheet has a `--z-*` name.

## Fixed

Models from Blender open upright at their real size, and each format is written in its own convention. Textures and UVs survive the mesh tools, Merge, Decimate and the exports, and FBX gets texture coordinates. Mirrored parts no longer come out inside-out. Export honours its Origin choice, and an exploded view exports whole. Undo and redo are sound after Claude's steps, groups, clones, Split, Merge and the gizmo. Claude's calls no longer hang, a dry run changes nothing, and "Ask before edits" asks before files are opened or written. Repair mesh, Fix normals, Split, Voxel remesh, Convex hull and Remove holes give better results. Edit mesh points and lines, CAD lines at a tilt, screenshots and the lighting are fixed. Recovery copies, the updater, the installer and the server are safer: a good update is no longer taken back by itself, and a broken one is.
