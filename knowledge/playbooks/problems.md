# When something does not work

## The connection
- *"MeshOptimiser is not listening"*: the app is not open in a browser, or Let Claude connect is off. Ask the user to open the app and switch it on in Settings, Claude. Check `http://localhost:4242/api/bridge/status` if you can read it.
- *"Another window took over"*: the app is open twice. The user switches it on again in the window they want.
- Stuck or odd after an update: the user can press Reconnect (the pill's dropdown has a restart-connection button, Settings, Claude has Reconnect) and, if that does not help, Restart the server (Settings, Claude). Tell them; you cannot press it for them.
- *"The app did not answer in time"*: a long job (fit to budget, remove hidden faces, smart optimise on a big scene) can take minutes, or the tab is asleep in the background. Ask the user to keep the app in front and call `scene_summary` to see whether it finished.
- A request asks for permission and nothing happens: the user has not answered the prompt in the app. Wait, and tell them.

## A refusal
- *"The user did not allow this"*: stop. Ask what they want. Do not repeat or work round it.
- *"Turned off in Settings, Claude"*: one of the four switches (change the model, move/rename/group, delete, files). Tell the user which; do not argue.
- *"No parts to ..."*: nothing matched `ids` or `name_contains`, or nothing is selected. `list_parts` to see the names.
- *"The view is exploded"*: `set_explode` 0, then repeat.

## A result that is not what you expected
- `fit_to_budget` changed nothing: the scene is already under the number, or every mesh is at its 16-triangle floor. Say which.
- `decimate` says the parts already have fewer triangles than the target: the target is for the whole group of chosen parts, not per part.
- `fill_holes` closed nothing: the holes are larger than `max_hole_mm`, are in curved surfaces, are inside instanced parts (passed over), or the part has none.
- `find_fasteners` found nothing: raise `max_thread_mm`, add `pins`, or the parts are not hardware by shape. `certain_only` false (the default) already includes likely ones.
- `find_hidden_parts` found nothing: every part can be seen from outside. Try `accuracy: "thorough"`, or the model is a single part.
- `smart_optimise` reports `nothing_changed`: the scene is already clean at that level. Try a stronger level, if the user agrees.
- The model looks wrong after a step: `undo`, `screenshot`, then a gentler setting.
- Sizes look off by 1000: the unit. `scene_summary` size and the user's expectation disagree. Ask before using absolute sizes.
- A tool says instanced parts were passed over: those parts share one stored shape. The tools that change a mesh skip them. Say so, and offer `smart_fit` or deleting the copies.

## When you are stuck
`search_docs` with the symptom in plain words ("flicker", "model lies on its side", "too big"), and `read_doc` on the best match. The app's articles have a "Tips" section for most tools.
