# Judgement: reading a scene and choosing

What separates a good optimisation from a destructive one is judgement. This is how an experienced user thinks.

## What is making this model heavy?
Read `scene_summary` and `list_parts` (`sort_by: "triangles"`) together, then ask:

- **A few very heavy parts** (the top 5 hold most of the triangles): reduce those. Delete the ones nobody needs, `decimate` the rest. `fit_to_budget` does this on its own: the densest meshes give up the most.
- **Thousands of small parts** (hundreds of fasteners, brackets, clips): the weight is in the count. `find_fasteners`, `remove_small_parts`, `find_hidden_parts`. Draw calls matter too: the number of parts affects how smooth a viewer runs, not only triangles.
- **Heavy because of fine curves** (bolts with threads, gears, fillets): `smart_fit` for filler, `decimate` for what matters, `fill_holes` for flat plates with many holes.
- **Heavy because of stacked or hidden things** (assemblies exported with every internal part, copies in the same place): `find_stacked_copies`, `find_hidden_parts`, `remove_hidden_faces`. These cost no looks.
- **Flat faces cut into thousands of triangles** (typical for STEP converted to a mesh): `untriangulate`. Free.
- **A model that is simply too big for its target and has none of the above:** it needs real reduction. Say so, give the user the number you can reach, and ask what detail may go.

## What does each step cost in looks?
From free to expensive:
1. `clean_up`, `find_stacked_copies`, `untriangulate`: nothing visible.
2. `remove_hidden_faces`, `find_hidden_parts` + delete: nothing visible from outside. Visible if the model is opened or exploded.
3. Deleting fasteners and small parts: invisible at normal distance; visible up close, and wrong if the fasteners are the point.
4. `fill_holes`: bolt holes, pockets and lettering disappear. Wrong for a part someone will fasten to, or a plate shown close up.
5. `smart_fit`: the part's own mesh is gone. Right for filler.
6. `decimate` and `fit_to_budget`: curved parts become faceted when pushed. Fine up to about half; at 90% on curved parts it shows.

## Ask, do not assume, when
- You do not know where the model will be seen, or the budget.
- A step removes things that might matter: fasteners, small parts, hidden parts, anything under a size. Say what would go and how many.
- The model might be opened, exploded, looked into, or used to build the product.
- Units are unclear (check `scene_summary` size: a car 4 mm long is metres read as millimetres; the app tries to detect inches, centimetres and metres for fasteners and says so).
- The user's instruction conflicts with the model (a budget they cannot reach, "remove the screws" when they are all part of the sculpture).

## Choosing a smart_fit shape
- Round, long, plain (bolt shanks, pins, rods, shafts): `cylinder`.
- Blocks, housings, covers, filler: `box`; if it sits at an angle, `turned_box`.
- Bracket, frame, angle, levelling foot, a part with an obvious outline: `few_boxes` (a slab and a bar for a foot, four bars for a frame).
- A part with steps, arms or openings that must stay where they are, but not the detail: `blocks` (raise `blocks_detail` for a closer outline; an opening narrower than a cell closes).
- Not sure: `auto` picks a box, turned box or cylinder per part.
`smart_fit` on every part (`smart_fit` with no ids selects nothing: it needs ids or a selection) is the roughest possible stand-in. Use it only when the user asked for that.

## Thresholds that work
- `remove_small_parts`: the tool takes a size in the scene's units. Express it as a share of the model: take the size of the whole model from `scene_summary` and list what would go with `list_parts` (`sort_by: "size"`). 1% of the model is a normal start; at a few percent handles, knobs, feet and hinges count as small too.
- `fill_holes`: 5 to 12 mm for sheet metal and plates, smaller for small products. Raise the limit only after looking; too high closes openings you wanted (cable cut-outs, windows).
- `decimate`: 10 to 50% in a step. Reduce curved, smooth, heavy parts first.
- `fit_to_budget`: the number the user gave. Every mesh keeps at least 16 triangles.

## Things the app does that you should expect
- Instanced parts (the file stores one shape used many times) can be skipped by tools that change a mesh (`fill_holes`, `untriangulate`, `smart_fit` on a shared shape). The result says how many were passed over.
- Hidden parts (the eye off in the tree) are not looked at by the finders: `show_all` first.
- The finders (`find_fasteners`, `find_hidden_parts`, `find_stacked_copies`) only select. Nothing is deleted until you call `delete_parts`.
- While the view is exploded, `transform_parts` and some tools refuse: `set_explode` 0 first.
- After a very large change the undo history can be cleared and the app says so. Warn the user before a heavy step on a huge scene.
- The user's file on disk is never changed. Edits live in the open scene until an export.

## When a result is worse than expected
`undo`, tell the user what happened, and try a gentler setting or a different tool. Do not stack steps on a bad result.
