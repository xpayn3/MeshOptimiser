# MeshOptimiser v0.37.0 (Vršič)

A Section view that cuts the whole scene with a plane, a Photo mode with a toolbar, lens rings and softboxes, Remove thickness for thin-walled parts, textures in OBJ and FBX exports, a Profile that shapes its outline, and a Properties card that keeps one height.

## New

- **Section view.** One plane through the whole scene (X, Y or Z, Flip, Position), the parts cut and the inside of the cut drawn flat. Nothing can be picked while it is on; Explode, the panels and the camera work. Esc turns it off.
- **Photo mode** has a button on the tool pill and a toolbar of its own (lights, backdrop, look, quality, effects, size, Save photo), lens rings on V (focus, aperture, zoom), softboxes in the reflections, and a `photo_mode` tool for Claude.
- **Remove thickness:** a hollow pipe keeps its outside, a bent sheet one face; Move into the wall makes the middle surface instead.
- **OBJ and FBX exports carry their textures,** and the app reads an OBJ's normal map and PBR values back.
- **Profile:** round corners, grow the outline, trim the ends, keep the chambers and holes you want, make symmetric, the same edit on matching profiles. Round part shows the whole part.
- **Picture quality:** sharp textures at an angle, finer shadows, smooth edges and resolution under Settings › Performance.
- **Every value slider is a fill bar,** and the sliding highlights stretch as they move.

## Around the app

- The Properties card is the same height for every selection, with the tags in a line that slides.
- Sounds for the lens rings and the quick wheels (Settings › General › Sound).
- The quick wheels wear the lens rings' look; the Library's Add to scene is a floating +; even spacing in the right sidebar and the Edit mesh bar.

## Fixed

17 fixes: a group's volume larger than the group; Simplify round faces crumpling pipes and changing the shading; bumps of OBJ, FBX, 3MF, USD and Collada models pointing the wrong way; a USDZ export shrinking its pictures; blurry textures at a slant; the CAD view's dark looks; Photo mode's dark blotches and CAD edge lines; Edit mesh dots too big zoomed out and a highlight sitting below its button; the sun gizmo over the docks; Profile and Round part staying on the old part; Merge by and Align and spread reading an old selection; a stray "&" in seven menu labels; the updater's browser test.
