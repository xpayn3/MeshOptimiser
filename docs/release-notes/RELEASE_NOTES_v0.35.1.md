# MeshOptimiser v0.35.1

v0.35.0 let one part wear several colours. v0.35.1 is a smaller release: a big STEP is meshed in several processes at once (the 357 MB V8 went from 103 s to 81 s), the floating command cards share one calm look, and a handful of stalls and drawing faults are gone.

## New

**Big STEP files are meshed on all cores.** The parts are meshed in up to eight processes at once; the V8 import went from 103 s to 81 s and a 45 MB transmission from 7.4 s to 4.8 s for the meshing step. **A tool's card shows the Wireframe on the part in work only.** **A brighter default light.** **Plain-text recent tools**, small switches and evenly spaced rows in the command cards, and Smart optimise and Reduce triangles as floating cards.

## Around the app

The right sidebar has no section titles, closed cards are 40 px tall, the greys of the text are a little lighter, menus and windows cast one kind of shadow, and the Settings titles are in the serif.

## Fixed

The page was rewritten several times a second while idle; slider scrubs, sidebar resizes and drags stalled on a big model; orbiting with Alt, Shift or Ctrl held stuttered; the recovery copy of a big scene held the page for a moment; in Edit mesh the lines and dots drew in the wrong order and dots showed through other parts; the floor grid broke up far out; a part stopped drawing a few seconds after a tool; Materials off in the STEP import settings did nothing; a tool run by its key was missing from the recent list.
