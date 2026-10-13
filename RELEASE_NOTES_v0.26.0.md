# MeshOptimiser v0.26.0

Faster, lighter and easier to pick with: Box and Brush select whole parts, big files open without freezing the page, opening the same STEP again is instant, and the app gives memory back.

## New

**Box and Brush select whole parts.** In Model mode the selection tool has Click, Box and Brush, as in Edit mesh, behind one button in the left toolbar. Shift adds, Alt turns the camera, and the middle button sets the brush size. A part counts as touched only when one of its own triangles is under the box or circle.

**The same STEP opens instantly.** The converted model is kept by the file's content, the import settings and the converter, so a new release or another setting never gets an old answer. At most two conversions run at once; the rest wait their turn.

**The part list points at the view.** Hover a row and the part lights up (Settings > Viewport switches it off). Isolate in Delete small parts is a switch, and Highlight sits on the card.

## Around the app

**Memory is given back.** Geometry that Undo can no longer reach is freed, and so is the geometry of deleted parts. Large GLB, glTF, OBJ and FBX files no longer freeze the page while they open, Repair mesh runs in the background, FBX, 3MF and USDZ code loads only when needed, and the idle timers rest in a background window.

**A selection draws at once.** The outline of a heavy part is worked out on a worker. The view cube redraws only when the camera turns, and the wireframe follows moved points.

**One look for the controls.** Sliders, scrollbars, number fields and menus share one set of tokens, and the command cards open with a line drawing instead of a video clip.

## Fixed

A spring or a coarse curve drawn as a bundle of lines, Repair mesh on a model far from the origin, the start screen hiding a new tab, a frame that failed to draw staying blank, and the inbox only being cleaned at start-up. Remove holes now takes meshes of up to twelve million triangles.

Full details are in the CHANGELOG.
