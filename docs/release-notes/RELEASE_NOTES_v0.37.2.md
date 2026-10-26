# MeshOptimiser v0.37.2

A review of v0.37.1's code: eight faults found by reading it, fixed.

## Fixed

- **Texture size** in the export window could leave a shrunken picture on the graphics card; the textures are uploaded again from their own pictures afterwards.
- **Pictures as WebP** wrote normal, roughness and other data maps as lossy WebP; only colour pictures are WebP now.
- **Model mode** could still be used on a library shape when Edit mesh was already open; it closes with the "Bake geo first" note.
- The **fault overlays** share their buffers between copies of a mesh, and the overlay of a part shown as a copy follows its copy.
- The History card no longer tags a new blank scene as saved.
- Animate does less work per frame, and the shadows' start-up reset runs once.
