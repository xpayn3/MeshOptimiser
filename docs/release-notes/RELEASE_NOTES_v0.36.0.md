# MeshOptimiser v0.36.0 (Triglav)

The biggest update so far: the 3D view moves to three.js r186 and its picking to three-mesh-bvh 0.9.16, the app opens USD and Collada, profiles get a tool of their own, Photo mode refines a still view, and the camera's lens is set in millimetres.

## What the library updates bring

- **three.js r186 (from r172).** Shaders are compiled without holding the page up, so a big model is ready sooner; screenshots and Claude's pictures no longer leave GPU memory behind; freed parts give their graphics memory back; the HDRI rotation turns its light and reflections with the background; and new loaders for USD and Collada. Every test that passed on r172 passes on r186, and four more.
- **three-mesh-bvh 0.9.16 (from 0.8.3).** Picks report the right colour group on multi-colour parts, triangles outside any group are left out, trees take less memory, and results match three.js's own in a few edge cases. Picking is as fast as before.

## New

- **Opens USD and Collada** (`.usd`, `.usda`, `.usdc`, `.usdz`, `.dae`), with their up axis and unit honoured.
- **Profile: clean outline.** A window frame, an extrusion or a seal strip becomes one clean solid: a live before-and-after cross-section, filled chambers, holes and gaps, square or mitred ends, bent profiles, and an editor for the section's points.
- **Round part** shares the Profile card, with the same cross-section view.
- **Photo mode** averages a still view (up to 32 frames: smooth edges, soft shadows) and offers three looks: Neutral, Soft (AgX), Contrast (ACES).
- **Focal length in millimetres** (10 to 200 mm, a bigger number zooms in), and a card with the camera's lens and navigation on a right-click of the camera pill.
- **Textures** show on the material balls and in the texture slots; a picture can be dropped on a slot; an FBX or OBJ takes the maps beside it, found by name.
- **Align to floor** works on the selection.

## Around the app

- A big model shows only once it turns smoothly (*Preparing the view*), and Ctrl+Z works while it is prepared.
- Settings › About is tidier, and its credits use the app's accent colour.

## Fixed

27 fixes, among them: Remesh after Decimate on STEP parts; Decimate's Target and Within fields; Quick remesh's smart mode; Remove holes on thin plates and flow-drilled holes; a GLB with JPEG textures ten times too big; textures that could not be undone; undo after an isolate; shadows of parts copied in Photo mode; five changes in three.js r186. The full list is in CHANGELOG.md.
