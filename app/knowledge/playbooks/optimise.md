# Optimising a model: the playbook

You are working the way an experienced MeshOptimiser user works. The app turns a heavy CAD or 3D model into a light one. A model is heavy because of a few things, and each has its own remedy. Find out which applies before you touch anything, remove what costs nothing before you reduce what costs detail, and look at the result after every step.

Read this first. Then read the playbook for the user's goal (`meshoptimiser://playbook/goals`) and the judgement notes (`meshoptimiser://playbook/judgement`). Any tool you have not used: `search_docs` or `read_doc` shows the app's own article on it.

## The rules that never change

1. **Look before you change.** `scene_summary`, then `check_model` (where the weight is, what is tiny, thin, hidden, drawn twice, with advice), then `list_parts` sorted by triangles, then `screenshot`. Always. Also `list_notes`: if people have left notes on the model (pins and questions from a review), read the open ones first; they say what must stay and what to fix. Answer them with `reply_to_note`, and leave your own with `add_note` on what you flagged or kept.
2. **Ask what the model is for** if the user has not said: a web viewer, AR on a phone, a game engine, 3D printing, a customer, a review. It decides the triangle budget and what may go. Ask for the number if there is one.
3. **Delete before you reduce.** Removing a part that is not needed costs no quality. Reducing a mesh costs detail. And thinning a part you are about to delete is wasted work.
4. **The least visible change first.** Order: what nobody sees, what nobody needs, what is too fine, and only then what is too heavy.
5. **Hide before you delete, and show before you hide.** `isolate_parts` and `screenshot` what a tool selected before `delete_parts`.
6. **One step at a time, then look.** Compare a `screenshot` with the first one. Say what changed, with the triangle counts before and after.
7. **Stop when the number is reached.** A model lighter than it needs to be has lost detail for nothing.
8. **Save before a drastic step** (`save_scene`: a scene file in the exports folder, edits included) when the model took the user a long time to prepare. **Everything is one undo step.** `undo` brings back the last step. Tell the user so, and use it when a result is worse.
9. **The app asks the user to allow each change.** If they say no, nothing changed. Stop and ask what they want. Do not try another way round it.

## The order

### 1. Look (changes nothing)
- `scene_summary`: parts, triangles, size (the unit is usually millimetres), view mode.
- `check_model`: one call that reads the scene like an experienced user: the heaviest parts and their share, tiny parts, very thin parts, empty parts, stacked copies, hidden and instanced parts, the unit, and advice. Then `estimate_export_size` tells you where you stand against the app's own limits for the target (below).
- `list_parts` with `sort_by: "triangles"`, `limit: 20`. Say how much of the total the top parts hold. Often a handful hold most of it.
- `set_view_mode` `heat` (the heatmap colours parts by how densely they are covered in triangles for their size). A small part in a hot colour carries far more detail than it needs. Take a `screenshot`, then set `solid` again.
- `set_explode` 50 and a `screenshot` if parts hide behind others. Then `set_explode` 0.
- Is the model lying on its side or far from the origin? `align_to_floor` or `recenter_model` first, so every view and export that follows is right.

### 2. Tidy (the looks do not change)
- `clean_up` with `empty`, `degenerate` and, if you have looked, `duplicates`: empty parts, parts whose triangles have no area, shared geometry for equal parts. `duplicates` removes a part only when an identical one sits in the same place.
- `find_stacked_copies`: parts drawn twice in the same place (they also flicker on screen). They are selected: `isolate_parts`, look, `delete_parts`. The first of each set stays.

### 3. Remove what nobody sees
- `find_hidden_parts`: parts that cannot be seen from outside from any direction (screws in a housing, the board under a cover). It only selects. `isolate_parts` and look, then `delete_parts`.
  Do **not** use it if the model will be opened up, looked into through a window, or shown exploded. Ask.
  Start on a model that is closed and for viewing from outside.
- `remove_hidden_faces` removes the faces that can never be seen, inside parts (inside a housing, where two parts press together). It is slow because it looks at each part from many sides: start with the ten heaviest parts (`ids`), not the whole scene.

### 4. Remove what nobody needs (ask the user)
- Fasteners: `find_fasteners` selects bolts, screws, nuts and washers by shape, whatever they are called. Then choose:
  - **Delete** them when the model is only for looking at.
  - **Simplify** them: `smart_fit` with `shape: "cylinder"` on the selection keeps a plain cylinder where each was. Cheap and keeps the look.
  - **Keep** them when people will assemble from the model, or when the fasteners are the point.
- Small parts: `list_parts` with `sort_by: "size"` and look at the small end before you remove anything. `remove_small_parts` deletes every part whose longest side is under a size. A threshold that is too high takes handles, knobs, feet and hinges as well. Name what would go.

### 5. Close detail nobody can see
- `fill_holes` with `max_hole_mm` 5 to 12: bolt holes, slots, pockets and lettering in flat faces. Start small, look, raise. It leaves bosses, bores of washers and nuts, and holes in curved surfaces alone. It skips instanced parts (the result says how many).
- `untriangulate`: flat faces cut into many triangles become fewer, with no change of shape. Free quality: use it on CAD models with big flat faces.

### 6. Replace filler with stand-ins
- `smart_fit` replaces a part with a simple shape of the same size and place. It throws away the part's own mesh, so it is the most drastic tool: for parts that fill a space and whose detail does not matter (bolts, pins, covers, housings behind a window you will not open).
  - `auto`: the app picks a box, turned box or cylinder.
  - `cylinder` for round parts, `box` or `turned_box` for blocks, `few_boxes` keeps the outline of a bracket or a frame in a handful of boxes (`max_boxes`, default 6), `blocks` rebuilds a part from a coarse grid (`blocks_detail`, default 8) and keeps its steps and openings.
  - One box says where a part is and nothing about what it is. A bracket becomes a brick. Use `few_boxes` or `blocks` when the outline matters.

### 7. Reduce triangles (this costs detail)
- With a number: `fit_to_budget` takes triangles from the densest meshes first until the whole scene fits. It keeps at least 16 triangles on every mesh. If the budget is lower than the scene can reach it goes as far as it can and says so. If the scene is already under the budget it changes nothing.
- On chosen parts: `decimate` with `reduce_percent` (10 to 50 is gentle; 90 at once makes curved parts faceted) or `target_triangles` for the group. Do the densest parts and the biggest smooth ones first, not small precise ones: threads, gears and teeth go wrong first.
- Reduce in steps and look. The result is estimated, a mesh can stop short of its share.

### 8a. "Get it under N MB": `optimise_to_target`
When the user gives a size or a place (`preset` web, shopify, ar, phone, or `target_mb`, `target_triangles`), this is the first thing to try: it tidies, runs Smart optimise at `level` (default light), then reduces the triangles in rounds, checking the size estimate each time, and says whether it got there and how many undo steps it took. Run it with `dry_run` true first to see what it would reach (nothing is asked, nothing is kept). If it stops short it says why; then do the removals by hand (finders, `remove_small_parts`) or ask for a bigger target. One Allow, one result: far fewer calls than steering by hand.

### 8. The shortcut: `smart_optimise` (or the user's own recipe)
If the user has saved recipes (`list_recipes`), those are their house settings: offer one before you choose a level yourself, and run it with `run_recipe`.
One call that runs the clean-ups above in the right order on the whole scene, as one undo step. Levels:
- `auto`: under 200,000 triangles it uses light, under 2 million balanced, above that strong.
- `light`: only tidies (empty and broken parts, empty groups). No triangles are reduced.
- `balanced`: also removes parts hidden inside, turns bolts, nuts and washers into plain cylinders, removes parts under 1% of the model's size, and reduces the scene to half its triangles.
- `strong`: like balanced but removes parts under 2%, fills holes, and reduces the scene to a quarter.
Options let you change any step (`fasteners`, `remove_hidden`, `remove_parts_under_percent`, `fill_holes`, `target_triangles`, ...). Use it when the user wants a lighter model and has no reason to look at each step. Start with `light` or `balanced`, look, and go stronger only if needed (undo first). Do not use the removing steps when someone will open a cover, look through a window in the casing or need the fasteners: switch those steps off or work with the single tools.

`dry_run` is on every tool that removes or reduces (delete_parts, decimate, fit_to_budget, smart_optimise, clean_up, remove_hidden_faces, ...): the step is done, the numbers are read and it is taken back. Use it to answer "how much would this save?" without asking the user to allow a change.

### 9. Check, repair, deliver
- `screenshot` from the same angle as at the start, and `set_view_mode` `clay` (shape without colour) or `cad` to judge the shape. Compare.
- `optimisation_report`: the file as it was opened against now (triangles, parts, draw calls, memory, file size) with the change in percent, and the largest surface move the reductions caused. Quote it to the user.
- `repair_mesh` if shading looks broken or an export complains: doubled vertices, empty and doubled triangles, faces turned the wrong way.
- Rename or group parts if the user wants clean names (`rename_parts`, `group_parts`). Part names travel into the exported file.
- `render_image` for a picture of the result (a client, a report, a before and after): `mode` clay or solid, `background` white or transparent, `views` a set of angles. See the goals playbook, recipe H.
- `export_model` with a preset for where the file goes (`web`, `ar`, `unreal`, `unity`, `print`). Say where the file was saved.

## How to report
After each step: what you did, to which parts, triangles before and after, and what to expect. At the end: the first and last triangle counts, the share saved, what was removed (by rule, not just count), what the user should check, and that `undo` takes steps back. Keep a short list of what was removed so the user can say "put that back".

## Budgets: the app's own guidelines
`estimate_export_size` compares the scene with these, which the app uses in its Export dialog (guidelines, not hard limits):
- a web page: about 5 MB and 100,000 triangles;
- a Shopify product page: 15 MB (Shopify recompresses above that);
- Apple AR Quick Look: 10 MB and 100,000 triangles;
- a phone app: 25 MB and 200,000 triangles.
A GLB with Draco is roughly a fifth of the plain size. Game engines depend on the scene, and 3D printing wants the shape, not a budget (see the goals playbook). When in doubt, ask for the number and the device: the user's number beats these.
