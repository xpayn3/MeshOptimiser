# MeshOptimiser v0.36.1

One Boolean card with five styles, a Photo mode that looks like a studio render, a reducer that keeps closer to the shape, new scene tabs that open at once, and a section editor that moves several points together.

## New

- **One Boolean card,** with five styles as Cinema 4D's Boole has them: Union, Subtract, Intersect, *Without* (the cut left open) and *Split* (A cut in two where B meets it). Keep the original, hide or delete B, and optimise the points afterwards; one Apply is one undo step.
- **Photo mode, a studio render:** a contact shadow where the model stands, a softly glossy floor, a backdrop (Dark, Studio grey or White) and studio lights (Product, Dramatic, Soft) with a rim and a fill that follow the view. Its list is more compact.
- **Decimate keeps closer to the shape, and faster.** The points that stay are moved to stand in for the ones removed: on the Gearbox Assy the largest distance from the original surface is 30 to 35 % smaller and the work takes a third of the time. Quick remesh and Fit to budget use it too. Under it, meshoptimizer 1.3 (from 0.22).
- **Profile and Round:** several points picked and moved at once, Shift lines a point up with the others, a grid in the section view, and Make solid can be given its axis.
- **New scene tabs open at once** (about 0.13 s, where they took up to 6.6 s), with or without a model open.

## Around the app

- The rows of the tool cards have room between them.
- Opening a model frees the last one's memory at once.
- Lucide 1.61 icons.

## Fixed

9 fixes: Decimate *Within* on large curved parts; Intersect with three parts or more; a model floating above the Photo mode floor; the section editor losing a drag; a slow new scene tab; the HDRI's background in a Z-up scene; KTX2 textures fetching an old decoder; an FBX with missing textures that never drew; the focus ring after Shift and a click. The full list is in CHANGELOG.md.
