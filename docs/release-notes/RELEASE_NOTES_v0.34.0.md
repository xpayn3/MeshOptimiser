# MeshOptimiser v0.34.0 (Bled)

Animate gets a timeline along the bottom and a motion for pistons, Claude can read and write notes, the axis tools of Cinema 4D arrive, and Python can come inside the Windows download.

## New

**A timeline along the bottom.** Animate is a drawer set out like a video editor: a ruler, a row for every animated object and a bar for every motion. Drag the ruler or the playhead to scrub; drag the end of a bar to change its repeats and the bar to change its delay. The Animation card in the right sidebar plays, pauses, plays backwards, loops three ways and shows a miniature of the timeline.

**Oscillate, for pistons, rockers and pumps.** A to-and-fro on all three axes of shift and of turn at once, perfectly loopable. Waves: Sine, Piston (a crank turning a rod), Eased and Triangle, with lags that turn X and Y into circles and ellipses.

**Animation leaves the app.** *Include animation* writes every moving part's motion into a GLB or glTF as keyframes, and the timeline can be rendered to a WebM video.

**Axis Center and the Axis card.** Centre the axis on the part and reset its rotation, move the axis or the object to the world origin, the selection, the last selected part or the view, align the axis to the world, its parent or the part's faces, and reset the scale. The shape stays where it is; each command is one undo step.

**Claude and notes.** Seven new tools (`list_notes`, `get_note`, `show_note`, `add_note`, `reply_to_note`, `update_note`, `export_notes`) and four more (`remove_floating_pieces`, `make_unique`, `select_instances`, `lock_parts`): 78 in all. Claude writes under its own name and never signs a scene off.

**Python inside the Windows download.** With a `runtime` folder, `start.bat` starts at once: no Python to install and no 500 MB of packages on the first start.

**Share to GrabCAD, Sketchfab and more** from the Export window.

## Around the app

**Groups.** A selected group shows its parts dimly; Ctrl+click or Shift+click lights up the ones you pick. **The Notes card** has one toolbar and a ⋯ menu, and recent cards show their notes. **The search** marks commands that open a panel and has shorter names. **Claude mode** says what each call did in words and shows no floor grid. **Fonts:** Fraunces Light for the name and Source Serif 4 for the Serif choice, both bundled. Dragging a command card is smooth.

## Fixed

The installer works where Windows Script Host is switched off. Stray edge lines after Remove holes. Heavy jobs no longer start on top of each other. A part that follows another is no longer sheared. Pressing an Axis command twice no longer piles up undo steps. The Materials and Library docks no longer stack. Undo and redo no longer put pills at the top.
