# MeshOptimiser v0.35.5

v0.35.4 made Edit mesh keep up with big models. v0.35.5 brings depth of field to Photo mode, a *Visible* switch to Edit mesh and status pills that slide, and 42 fixes from a review of the whole app.

## New

**Photo mode: depth of field.** A *Depth of field* row on the Photo mode card softens what is nearer or further than the focus, as a camera lens does. Alt+click a point of the model, or press *Pick* on the *Focus* row and click, to focus there; *Pivot* goes back. It works at every Quality, and Save photo keeps it.

**Edit mesh: a *Visible* switch** in the bar over the view. On, a box takes only what you can see, as before; off, it takes everything inside it, back sides and parts hidden behind others too. The Brush follows it.

**The status pills slide.** *Isolated*, *Exploded*, *Measure*, *Notes*, *Animate* and the CAD pills slide out from the camera pill when their mode comes on and tuck back in when it goes off; the pills beside them glide instead of jumping.

## Fixed

**Merging** keeps each part's own material instead of turning them white, and a merged model remembers its colours when it is opened again. **Mirrored parts** stay the right way out through Bake transforms, Set transform and the booleans. **The mesh tools** keep vertex colours, the extra UV sets and a STEP part's CAD faces.

**Edit mesh:** dots are no longer cut by their own faces, open sheets work from both sides, everything picked on a merged part is drawn, and Ctrl+Z undoes the last edit however long the session.

**STEP files:** a damaged file says what is wrong, an older revision is never read from the cache, a failed or cancelled conversion leaves nothing behind in inbox/, and the times read "1m 34s".

**Claude** leaves locked parts alone in Remove small parts, Remove fillets, Simplify round faces and Merge by colour; Clean up is one undo step and counts as a delete.

**Around the app:** left alone, the app does no style or layout work at all; 232 tooltips are one short line; a command card comes in front of an open window; a held key no longer piles up the same message.

Most fixes were checked by tests in a test browser and not yet by hand in the app; CHANGELOG.md says which.
