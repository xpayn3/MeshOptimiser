# MeshOptimiser v0.21.0

Turntable video, export presets for where the file is going, and a Selection bar with the actions I reach for most.

## New

**Turntable video.** The film button next to the camera takes the camera once round the model and saves a WebM. Choose the size (720p, 1080p, 1440p, square or portrait), the length (4 to 12 seconds), the frame rate (24, 30 or 60), the direction and the view mode. "Fit the model to the frame" centres the model and fills the picture, whatever the shape of the frame, and the clip loops. It is encoded in the browser (WebCodecs, VP9 or VP8), so nothing leaves your machine. Chrome and Edge.

**Where is it going?** Five presets at the top of the Export dialog: Web viewer (GLB, Draco, metres, Y up), AR on iPhone (USDZ, metres, Y up, on the floor), Unreal Engine (FBX, centimetres), Unity (FBX, metres, Y up) and 3D print (STL, millimetres, one mesh, on the bed). One press sets the format and the numbers, and the size meter checks against the same place. They read the scene as millimetres. Change anything and the preset lets go.

**A view row in the Selection bar.** Hide, Isolate (Show all while isolated), Frame and Duplicate are buttons next to the others.

## Interface

- The Selection bar's buttons sit directly on the panel, outlined, with more room; the Delete count moved into the header.
- The selection actions are in one bar under Properties, every card title has a small icon, and the group labels draw a line.
- Unit scale has "× 0.1 (mm → cm)".
