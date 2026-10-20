# MeshOptimiser v0.35.2

v0.35.1 made the command cards calmer. v0.35.2 is about working with more than one scene: parts can be copied from one scene tab or one window into another, the app opens again in a window of its own, several animations can be edited at once and the rows of the timeline moved, a mesh with several materials can be split by material, and Claude can take its pictures in Photo mode. The right sidebar's Quick fixes card is now Tools, with Merge, Decimate, Recentre and Align beside the clean-ups. Several entries below were checked only by reading the code or by measuring in a test browser, and say so.

## New

**Copy parts between scenes and windows.** Ctrl+C in one scene tab and Ctrl+V in another brings the parts across, standing where they stood, with their colours, materials and pictures; the same works between two windows of the app. A pill on top of the view says what was pasted and from where. Menu › New window opens the app again in a window of its own.

**Split meshes by material.** A mesh that came in with several materials comes apart into one part for each material. Claude's `split_parts` takes `method: "material"`.

**Animate.** Rows of the timeline can be dragged into order, several animations can be edited at once, the object's card has a plus that adds an animation, the animation cards are one line, and nothing plays until you press Play.

**Claude and Photo mode.** The `screenshot` and `render_image` tools can draw a picture in Photo mode, and Claude asks you first.

## Around the app

The Quick fixes card is Tools, Delete small parts is a floating card, the right sidebar's gaps are 12 px, the gizmo handles grab from nearer, tooltips are narrower, a Website link is in the app menu, and many icons were changed to ones that say more.

## Fixed

7 fixes: a scene saved with Photo mode on, glass and other see-through materials, the gizmo handles grabbing from too far, a command card that grew past the top edge, the Enter chip on the blue buttons, the greyed-out Photo mode effects that could still be used, and adding an animation that started it playing at once.

Several of these were checked only by reading the code or by measuring in a test browser; the full list in the changelog says which.
