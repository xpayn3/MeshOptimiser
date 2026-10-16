# The tools, by what you want to do

Parts are chosen by `ids` (from `list_parts`), by `name_contains` (part of a name), or, with neither, by the current selection. Sizes are in the scene's units (usually millimetres). Tools marked (asks) show the user an Allow / Don't allow prompt first. `undo` takes any of them back.

## I want to know what is here
`scene_summary` (file, parts, triangles, size, view mode, explode) · `render_image` (a big smooth picture saved as a PNG, up to 8192 px: `views`, `mode`, `background`, `width`/`height`; for a client or a report) · `list_parts` (sort by triangles, size or name; filter by name, selection, hidden; page with limit and offset) · `get_selection` · `screenshot` · `measure_parts` (two ids: centre distance and the gap between boxes) · `list_groups`.

## I want to look at it differently (never asks)
`set_view_mode` solid, wire, xray, heat (colours parts by how dense their triangles are for their size), clay (shape without colour), cad · `set_camera_view` perspective, top, front, side, fit · `frame_selection` · `set_explode` (0 to 300%, any axes) · `set_grid` · `hide_parts` · `isolate_parts` · `show_all` · `select_parts` (`mode` replace, add, remove) · `select_all` (`invert`).

## I want to understand the model first (free)
`check_model` (one call: where the weight is, tiny, thin, empty, stacked, hidden, instanced, the unit, advice) · `optimisation_report` (the file as opened against now, with the change in percent) · `estimate_export_size` (GLB size plain and with Draco, against the app's limits for the web, Shopify, AR Quick Look and a phone app) · `list_materials`.

## I want to find what can go (select only; never asks)
`find_fasteners` (`kinds` bolts, nuts, washers, pins; `max_thread_mm` default 30; `certain_only`; `used_at_least`; `selection_only`; `add`) · `find_hidden_parts` (`accuracy` fast, normal, thorough; `see_through_hides`; `max_size_percent`; `name_contains`; `selection_only`; `add`) · `find_stacked_copies` (`tolerance_percent`, `near_copies`) · `select_similar` (the other copies of a shape) · `select_by_colour` (`colour` or from parts) · `select_by_material` (`name_contains`).

## I want it lighter (asks)
- Hard edges: decimate, fit_to_budget, smart_optimise and optimise_to_target hold on to each part's sharp edges (rims, steps, corners) when the part has few of them and the goal can still be reached; `keep_sharp_edges` false switches it off for one call. Parts that are mostly hard edges (gears) are reduced as before.
- To a size or a place: `optimise_to_target` (`preset` web, shopify, ar, phone, or `target_mb`, `target_triangles`; `level`, `draco`, `max_rounds`): tidy-up, Smart optimise, reduction in rounds, one answer.
- Try before you keep: `dry_run` true on any of delete_parts, remove_small_parts, merge_parts, merge_by_colour, decimate, fit_to_budget, fill_holes, remove_hidden_faces, repair_mesh, clean_up, duplicate_parts, smart_optimise, smart_fit, untriangulate, run_recipe, optimise_to_target: the step is done, the numbers read, then taken back. It asks nothing.
- Everything in one: `smart_optimise` (`level` auto, light, balanced, strong; options for each step), or the user's own settings: `list_recipes`, `run_recipe`.
- Remove: `delete_parts` · `remove_small_parts` (`max_size` in scene units) · `clean_up` (`empty`, `duplicates`, `degenerate`).
- Remove detail without changing the shape: `untriangulate` · `fill_holes` (`max_hole_mm`) · `remove_hidden_faces` (`views` 26, 64, 128; slow on big scenes) · `repair_mesh`.
- Replace with stand-ins: `smart_fit` (`shape` auto, box, turned_box, cylinder, few_boxes, blocks).
- Reduce triangles: `fit_to_budget` (`target_triangles` for the whole scene) · `decimate` (`reduce_percent` or `target_triangles` for the chosen parts).
- Join and split: `merge_parts` (one mesh from several: loses structure) · `merge_by_colour` · `split_parts` (a mesh that is really several solids; `method` vertex, edge, spatial, hybrid; `whole_scene`).

## I want it tidy (asks)
`remove_floating_pieces` (asks; `max_size`, `max_triangles`: loose bits that float free of a part) · `make_unique` (asks; instances get a mesh each) · `select_instances` (only selects; `original` for the first of each shared shape) · `lock_parts` (`locked` false to unlock) · `list_library` · `add_library_part` (a standard bolt, nut, pipe, profile or machine part; `kind`, `count`) · `rename_parts` (`renames`, or `find`/`replace`, `prefix`, `suffix`) · `group_parts` · `ungroup` · `duplicate_parts` · `transform_parts` (`move`, `rotate_degrees`, `scale` about the middle of the chosen parts; not while exploded) · `recenter_model` · `align_to_floor`.

## I want a file or a film
`render_image` · `compare_images` (before and after in one picture, then the scene is put back) · `list_folder` (model files in a folder) · `batch_optimise` (a folder: open, optimise, export, close, one file after another; `dry_run` lists first; the user can stop it) · `save_scene` (a scene file with the edits: before a drastic step) · `export_model` (`preset` web, ar, unreal, unity, print; or `format` glb, gltf, fbx, usdz, obj, stl; `file_name`; for a GLB `compression` none, draco or meshopt, and `faster_to_draw` to reorder without compressing) · `turntable_video` · `open_file` (a path on this computer).

## Notes: reviewing the model with people
People leave notes on a model: a numbered pin on a part, or on the whole scene, with a conversation under it (tag info, question, issue or idea; open or resolved; who it is for). They are saved in the scene file, so they travel with the model. You write under the name **Claude** and every change shows in the note's history.
`list_notes` (open ones by default; `status` all, resolved or deleted; `tag`, `assignee`, `part_contains`, `search`; each note with its last messages and the `part_id` it is about) · `get_note` (all messages, edits and history) · `show_note` (opens it and flies the camera to its own view, then `screenshot`) · `add_note` (asks; `text`, a part by `ids` / `name_contains` / the selection, or `whole_scene`; `tag`, `assignee`) · `reply_to_note` (asks) · `update_note` (asks; `status` resolved or open, `tag`, `assignee`, `edit_message`, `delete_message`, `delete`, `restore`) · `export_notes` (Markdown in the reply, `save` for a file, `format` html for the one-page report).
How to work with them: read `list_notes` before you change a model that others have been reviewing, and do what an open note asks (or answer why not) before you resolve it. Resolve a note only when the thing it asks for is done; leave other people's messages and notes alone. Leave your own note on what you flagged, kept or could not decide (a part you did not reduce, fasteners you kept, a question about the unit). One undo step each.

## Scenes and history
`scene_tabs` (list, switch, new) · `undo` (`steps`) · `redo`.

## The app's own knowledge base
`search_docs` (what does the app say about a word or a task) · `read_doc` (one article in full). Resources: the playbooks (`meshoptimiser://playbook/...`) and the articles (`meshoptimiser://docs/...`).

## Which tool for which job
| Job | Tool |
| --- | --- |
| "Get it under N triangles" | clean up and find/delete first, then `fit_to_budget` |
| "Take the bolts out" | `find_fasteners`, `hide_parts`, `screenshot`, then `delete_parts` |
| "Keep the bolts but make them cheap" | `find_fasteners`, `smart_fit` `cylinder` |
| "It flickers" | `find_stacked_copies` |
| "Nobody sees the inside" | `find_hidden_parts`, `remove_hidden_faces` |
| "Lots of holes in plates" | `fill_holes` |
| "Flat faces are made of thousands of triangles" | `untriangulate` |
| "Make it light with no fuss" | `smart_optimise` `balanced` |
| "It looks dark or odd" | `repair_mesh`, `set_view_mode` clay |
| "Where do I start?" | `check_model` |
| "Will it fit the page?" | `estimate_export_size` |
| "What did we save?" | `optimisation_report` |
| "Same settings as last time" | `list_recipes`, `run_recipe` |
| "Under 5 MB" / "for the web" | `optimise_to_target` `preset` web (`dry_run` first) |
| "How much would that save?" | the tool with `dry_run` true |
| "Show the difference" | `compare_images` |
| "Do all of these files" | `list_folder`, then `batch_optimise` |
| "A picture for the client" | `render_image` (`mode` clay, `background` white, `views` a set) |
| "It is lying down" | `align_to_floor` |
