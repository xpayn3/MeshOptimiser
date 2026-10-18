# Remove lettering and logos

Take text and logos off parts, however the CAD program made them: raised or engraved in the part’s own surface, or modelled as separate little bodies laid over it.

> Remove lettering and logos is in the next version of the app. It is in the project’s repository and not yet in a released version.

Part numbers, makers’ names and logos cost a lot of triangles for something nobody reads on a web model. A CAD program makes them in one of three ways, and this card finds all three:

- Raised text cut into the part’s own mesh. It is flattened back into the face.
- Engraved text cut into the part’s own mesh. It is closed as a shallow pocket.
- Text modelled as bodies of their own, laid over a part: often sunk a few millimetres into it and standing a little proud. These bodies are deleted; the part under them is complete. Bodies hidden entirely inside a part are found too.

## How to use it

1. Select the parts that carry the lettering. The card works on the selection only.
2. Open the command search (**Ctrl + K**) and run **Remove lettering and logos…**.
3. Press **Find only** first if you want to look: it selects the lettering bodies and counts the marks, without changing anything. **Isolate** shows them on their own.
4. Press **Remove lettering**. The bodies are deleted and the marks flattened or closed. It is two undo steps: one for the bodies, one for the marks.

## What the settings mean

- **Raised, up to**: Raised text no higher than this above its face counts as lettering. 0.6 mm to begin with: CAD text drawn 0.5 mm high measures a little more once it is cut into triangles.
- **Engraved, down to**: Engraved text no deeper than this counts.
- **Largest mark**: A mark wider than this is a feature of the part, not lettering, and stays.
- **Cut into the part’s mesh**: Off: raised and engraved text in the part’s own surface is left alone.
- **Bodies laid over a part**: Off: separate lettering bodies are left alone.
- **Bodies hidden inside a part**: Off: bodies that are wholly inside a part are left alone.

**Reset to defaults** puts the settings back. They are remembered for next time.

> A body is only judged against a part that is closed: on an open shell, inside and outside cannot be told apart. Run [Close cracks](meshoptimiser://docs/mend-mesh) on the part first if nothing is found.

Related: [fill-holes](meshoptimiser://docs/fill-holes), [mend-mesh](meshoptimiser://docs/mend-mesh), [remove-hidden-faces](meshoptimiser://docs/remove-hidden-faces)
