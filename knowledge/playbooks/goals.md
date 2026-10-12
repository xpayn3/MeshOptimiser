# Recipes by goal

Pick the recipe for what the model is for. Each one is a sequence of tool calls. Every recipe starts with the same look: `scene_summary`, `list_parts` (`sort_by: "triangles"`, `limit: 20`), `screenshot`. Every recipe ends with the same check: a `screenshot` from the same angle, the triangle counts before and after, and `undo` mentioned.

Always ask first if the user has not said: where will it be seen, on what device, is there a triangle number, may fasteners and insides go, will anyone open it or explode it.

## A. A web viewer, a configurator or a product page
Goal: small and smooth, looks right from outside.
1. `clean_up` (`empty`, `degenerate`, `duplicates`).
2. `find_stacked_copies`, check, delete.
3. `find_hidden_parts`, `isolate_parts`, check, delete (closed product, seen from outside only).
4. `find_fasteners`, then `hide_parts`, `screenshot`; then delete them, or `smart_fit` with `cylinder` to keep stand-ins if the look of screws matters up close.
5. `remove_hidden_faces` on the ten heaviest parts.
6. `fill_holes` 6 to 12 mm.
7. `fit_to_budget` to the user's number. The app's own guideline for a web page is under 5 MB and 100,000 triangles (`estimate_export_size` shows where you are); ask what the page really needs.
8. Export `web` (GLB with Draco: the smallest file; measured on one CAD assembly it was 0.56 MB against 0.99 MB with Meshopt and 4.2 MB plain). Draco needs a viewer that reads it: ask if unsure and export without if not. `compression` meshopt decodes quickly but is larger and needs a viewer that reads it; `faster_to_draw` keeps the file plain (any viewer) and reorders it for the graphics card, which cut the vertex-cache misses per triangle by about a third on the same assembly.
Shortcut: `smart_optimise` `balanced`, with `target_triangles` set to the budget.

## B. AR on a phone (iPhone Quick Look, Android viewers)
Goal: light enough for a phone, correct size and up direction.
1. Steps 1 to 6 of A. The app's guideline for Apple AR Quick Look is 10 MB and 100,000 triangles (`estimate_export_size`); a phone app 25 MB and 200,000.
2. `align_to_floor` so the model stands on the floor, centred.
3. Check the size in `scene_summary`. AR uses metres: the `ar` export preset scales millimetres to metres.
4. Export `ar` (USDZ).

## C. A game engine (Unreal, Unity)
Goal: right scale and axis, a clean hierarchy, a budget the engine can take.
1. `clean_up`, stacked copies, hidden parts, `fill_holes`.
2. Keep part structure (do not `merge_parts`): engines use the parts to place, move and cull.
3. `fit_to_budget` to the number the engine team gives.
4. `rename_parts` if the names are CAD codes.
5. Export `unreal` (FBX, scale 0.1, Z-up) or `unity` (FBX, scale 0.001, Y-up). One test export is worth more than a guess: tell the user to check scale and orientation.

## D. 3D printing
Goal: the shape is exact and the mesh is one watertight body. Triangle budget does not matter; detail does.
1. Do **not** `decimate`, `smart_fit` or `fill_holes` unless the user wants holes closed.
2. `clean_up`, `repair_mesh` (join doubled vertices, turn faces the same way).
3. `align_to_floor`.
4. Export `print` (STL, one merged mesh, millimetres). Printer software wants one object: the preset merges.
Hidden inner parts matter for printing only if they should print: ask.

## E. Send it to a customer without handing over the design
Goal: the product looks right and reveals little.
1. `find_hidden_parts`: delete what is inside. `find_fasteners`: delete them (a deleted part is gone from the file; a hidden one is not).
2. `smart_fit` `few_boxes` or `blocks` on parts whose shape is the secret. `fill_holes` closes bolt holes and pockets.
3. `fit_to_budget` if the file must be small.
4. `rename_parts` to remove names that say too much; `group_parts` or flatten levels that show how it is built. Material names travel too.
5. Export GLB with visible parts only (the default), after deleting, not hiding.
No file is a guarantee: say so. It shows less; it does not stop a determined person.

## F. Reviewing a heavy model with no changes ("what is wrong with it?")
1. The look, `set_view_mode` `heat` and a screenshot, `set_explode` 50 and a screenshot.
2. `find_stacked_copies`, `find_hidden_parts`, `find_fasteners`: the selecting ones change nothing. Report counts and the triangles in each.
3. `list_parts` `sort_by: "size"` for the small end: how many parts are under 1% of the model.
4. Finish with a short list: what you would do first, and what each step would save. Change nothing.

## G. Make an even lighter copy for a thumbnail, a 3D preview or a very small device
1. Everything in A.
2. `smart_optimise` `strong`, or `fit_to_budget` to a low number, and `smart_fit` on everything that is only filler.
3. Accept the loss: tell the user what is gone. This is a preview.

## H. Pictures of the result: for a client, a report, a before and after
Goal: show what was optimised, looking its best. `render_image` makes big, smooth pictures and saves them; `screenshot` is only a quick look.
1. Finish the optimising first, then `screenshot` once to check the model. Hide helpers (`set_grid` false, or `hide_grid`), `show_all`, `set_explode` 0.
2. For a client: `render_image` with `mode: "clay"` (shape without colour) or `solid`, `background: "white"` or `"transparent"` for a cutout, `views: ["perspective", "front", "side", "top"]` for a set (one file each, one contact sheet to look at), `width` 2560 and `height` 1440 (or 3840 by 2160 for print). Say where the files are.
3. For a before and after: `compare_images` does it in one picture after the work is done: the model as it was opened on the left, as it is now on the right, same camera, the triangle and part counts and the size under each (`steps_back` to compare against an earlier step; `mode: "heat"` shows where the weight was). The scene ends exactly as it was. Tell the user the file path and the numbers.
4. To show how it goes together: `set_explode` 50, `render_image`, then `set_explode` 0.
5. A moving picture: `turntable_video` (one slow turn, a WebM).
Do not pick the look by yourself if the user has a house style: ask which background and which angle. `render_image` changes the camera and view for the picture: tell the user, and `set_camera_view` perspective puts it back.

## J. A whole folder of models
Goal: the same clean-up on many files. `list_folder` shows the model files (`recursive` for sub-folders). Do ONE file by hand first (a recipe, or `optimise_to_target`) and check the result with the user. Then `batch_optimise` with a `folder` and the same settings (`recipe`, or `preset` / `target_mb` / `target_triangles` and `level`, `export_preset` web by default). Each file opens in a scene tab of its own, is optimised, exported as name_optimised in the exports folder and closed; the scene the user has open is not touched. Use `dry_run` to list the files first. It takes a while: the user can stop it from the Claude pill, and the result lists every file with its numbers or its error. Never put customer files through settings nobody has looked at.

## I. The user gave a number only ("under 500k")
1. Look. If the scene is far above the number, `optimise_to_target` (with `target_triangles`) does the tidy-up and the reduction in one go; or do the removals first (tidy, stacked, hidden, fasteners, small parts), then `fit_to_budget`. Deleting leaves more triangles for the parts that remain.
2. If the scene is already under the number, say so and change nothing.
3. If the number is not reachable without ruining the shape, say what you can reach and what it would cost, and ask.
