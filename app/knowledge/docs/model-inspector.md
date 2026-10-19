# Model inspector: what the model is, and what is wrong with it

One window that shows what is in the model and finds the faults in it: faces turned the wrong way, holes, doubled triangles. Each fault has a button that fixes it.

Before you clean a model up, it helps to know what you are looking at. The Model inspector tells you, and then it tells you what is wrong.

Open the command search with `Ctrl` + `K` and type **Model inspector**.

## What the model is

At the top are tiles with the numbers that matter: how many parts, groups, triangles and points the model has, how big it is, how much memory its meshes use, how many materials it has and how much of it is shared.

## Checks that are instant

These need no scan. Each one is a row with a count and a **Select** button.

- **Parts with no material**: Parts that would draw in a plain grey. **Select** picks them, and the **Materials** button gives them one.
- **Parts with no triangles**: Empty parts. They carry nothing and can be deleted.
- **Tiny parts**: Parts too small to see at the size of the model. **Delete small parts…** removes them.
- **Heavy parts**: Parts that each hold more than a twentieth of all the triangles. **Decimate** takes triangles out of them.
- **Hidden parts**: Parts you have hidden. **Show all** brings them back.

## Scan the geometry

Press **Scan the geometry**. The inspector reads every mesh once, with a progress bar, and you can press **Stop** at any time. A mesh with more than a million triangles is skipped and reported as too big for the scan. When it finishes, each check shows how many it found. Open a row with its arrow to list the parts, worst first: a click selects a part, a double-click frames it.

- **Parts turned inside out**: Every face of the part points inward. The part looks dark, or see-through from outside. **Fix normals…** turns it right.
- **Faces turned the wrong way**: One face, or a few, point the opposite way to their neighbours. **Fix normals…** lines them up.
- **Triangles with no area**: Triangles squashed flat to a line or a point. **Repair mesh…** removes them.
- **The same triangle twice**: Two triangles sitting on each other. **Repair mesh…** keeps one.
- **Edges shared by three or more triangles**: A seam where more than two surfaces meet, which most programs cannot treat as a solid.
- **Pinched corners**: A point where the surface touches itself, like a bow-tie.

> A hollow inside a part (a closed shell with its faces pointing inward, inside another shell) is correct, so the scan does not call it a fault. The scan also leaves out open edges, parts in several pieces and needle triangles, because a CAD sheet or a fine fillet has them by design.

Related: [fix-normals](meshoptimiser://docs/fix-normals), [fill-holes](meshoptimiser://docs/fill-holes), [delete-small-parts](meshoptimiser://docs/delete-small-parts), [heavy-parts](meshoptimiser://docs/heavy-parts)
