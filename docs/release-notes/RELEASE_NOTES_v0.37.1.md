# MeshOptimiser v0.37.1

A History card that goes back to any step, a Model inspector that draws the faults of a mesh on the model, an Animate window that keeps what you move and copies its clips, Settings built as cards with a say in what a scene file keeps, right-click menus on the toolbar buttons, and 58 fixes.

## New

- **History card** in the right sidebar: every step Ctrl+Z goes back to, newest first, the undone ones dimmed above; a click goes to any step; Clear history asks with a slider.
- **Model inspector** redrawn from the app's tokens. *Show in the view* draws open edges, edges with three or more triangles, wrong-way faces, parts turned inside out, empty and doubled triangles, pinched corners and long thin triangles on the model, one colour each.
- **Animate:** positions are in mm (older scene files are converted once); copy and paste of clips and of their properties, with a right-click menu on every clip; picked clips are trimmed together; Space plays and pauses wherever the focus is; a part moved by hand inside an animated group keeps its new place; the gizmo stays; the parts list on the left keeps still; a wider names column you can drag.
- **Settings** as cards with a live summary ("8 of 9 on"), tiles for a long run of switches, All on / None. **Saved in a scene file** chooses what a file keeps: camera, display, lights, shadows, units, part flags, explode, animation, notes. Shadows start off every time the app opens.
- **Right-click menus** on the Animate, Library, Materials, search and "…" buttons of the toolbar.
- **Export:** texture size (down to 256 px) and Pictures as WebP for GLB, glTF and USDZ.
- Also: Pivot to bottom and top, Edit mesh blocked until a library shape is baked, Remove holes in curved surfaces, a Materials window you can sweep a square across, Batch folder, Instances panel, X-ray the others, Bake textures, UV layout as a view, a group pivot written into the file.

## Fixed

58 fixes, among them: Select similar missing obvious copies; the floating Materials window vanishing; a black viewport while resizing; a part moved inside an animated group snapping back; the command search button not lighting; Camera settings losing their padding; the Export window's file-name box with a seam. The full list is in the changelog.
