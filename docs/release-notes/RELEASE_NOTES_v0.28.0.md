# MeshOptimiser v0.28.0

Know what is wrong with your model, fix it in a tap, and keep the real edges of your CAD file. And installing it is one double-click.

## New

**Model inspector.** One window shows what you have and what is broken in it: inside-out parts, faces turned the wrong way, holes and cracks, doubled and needle triangles. Each problem has a Select button and a button that opens the tool that fixes it.

**Fix normals.** Find faces that point the wrong way, turn them round or line them up with their neighbours, and paint the wrong side red while you look. One undo takes it back.

**UV layout.** See how a part's texture is laid out: the 0 to 1 square, every island, overlaps and what lies outside, with the numbers beside it.

**The true faces and edges of a STEP file.** A CAD edges pill appears when you open a STEP: the outlines are the file's own, the face under the pointer is named and tinted, and tangent edges can be hidden. Surface-only parts (sheet covers, shields) come along too.

**Quick colour wheel.** Hold C over the model, move, let go. A colour picker rebuilt for modelling, materials you edit where you see them, and one View button for Solid, Wireframe, X-ray and Heatmap.

## Around the app

A one-click installer for Windows and a switch in Settings to show or hide the terminal window. Quick choices on Collapse, Rename and Flatten. Four more lists in the Commands menu (Select, Edit, Repair, Share). A tidier Quick wand. Properties and Shading sit edge to edge.

## Fixed

Undo now reaches colours and sliders in the material editor and the light, exposure, field of view and fog sliders; shortcuts work while a slider has the focus; the colour picker keeps its Was / New strip and no longer closes on Ctrl+Z; switching Shadows quickly no longer loses the view; closing with a model open asks first; points no longer show through thin parts; Align and Repair mesh turn pieces with gaps outward.

Full details are in the CHANGELOG.
