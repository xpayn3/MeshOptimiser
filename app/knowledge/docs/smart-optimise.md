# Smart optimise

One card, one button: every clean-up the app has, run one after another on the whole scene. Choose how far to go, read the plan, press Optimise.

The other tools in this group each do one job. Smart optimise runs them for you, one after another, on the whole scene. Use it when you want a lighter model and do not want to choose the order yourself.

It is lossy: it removes parts and triangles. The whole run is one undo step, so one `Ctrl + Z` takes everything back.

## Steps

1. Open a model.
2. Open the card **Smart optimise**: press `Ctrl + K` and type `Smart optimise`, or choose it in the `…` list. It opens over the viewport.
3. Choose how far to go: **Auto**, **Light**, **Balanced** or **Strong**. Auto is the default.
4. Look at **Target**. Type another number if you need one, for example `300k` or `1.5m`.
5. Read the line under the controls. It spells out what the run will do, in order. With Auto it also says which level was chosen, for example “Auto picked Balanced for 1,103,373 triangles in 43 parts”.
6. Press **Optimise**.
7. When it is done, a message gives the triangles before and after and how many parts were removed.
8. Look at the model. If it lost too much, press `Ctrl + Z` once and try a lighter level.

In the card, `Enter` runs it, like **Optimise**, and `Esc` puts the card away.

## The levels

A level is a starting point. It sets the switches under **Steps** and the triangle target.

- **Auto**: Chooses from how heavy the scene is: under 200,000 triangles it uses Light, under 2 million it uses Balanced, and above that Strong. The line under the controls says what it chose.
- **Light**: Only tidies. It removes empty parts, parts whose triangles have no area, empty groups and exact copies. No triangles are reduced.
- **Balanced**: Also removes parts hidden inside the model, turns bolts, nuts and washers into plain cylinders, removes parts smaller than 1% of the model, and reduces the scene to half its triangles.
- **Strong**: Like Balanced, but it removes parts smaller than 2%, also closes holes in flat faces, and reduces the scene to a quarter of its triangles.

## The steps

Open **Steps** in the card to see each switch. If you change one, no level is lit any more: the settings are yours. Each step is the same tool you could run by hand.

- **Empty parts**: Parts with no triangles, parts whose triangles have no area, and groups with nothing left in them. See [Quick fixes and tidying up](meshoptimiser://docs/cleanup).
- **Hidden parts**: Parts that cannot be seen from outside, from any direction. See [Select hidden parts](meshoptimiser://docs/select-hidden-parts).
- **Fasteners**: Found by their shape, up to a thread of M30, as in [Fasteners](meshoptimiser://docs/fasteners). **Keep** leaves them alone. **Simplify** turns each into a plain cylinder. **Delete** removes them.
- **Small parts**: Parts whose box, measured from corner to corner, is shorter than this share of the whole model. 0 leaves small parts alone. See [Delete small parts](meshoptimiser://docs/delete-small-parts).
- **Holes**: Closes holes in flat faces, with the settings and the size limit of the Remove holes panel. See [Remove holes](meshoptimiser://docs/fill-holes).
- **Exact copies**: The same part twice in the same place: only the second copy goes, and parts that merely share a shape stay. It is the removal that **Duplicates** does in [Quick fixes and tidying up](meshoptimiser://docs/cleanup). It is on at every level.
- **Tolerance**: Takes triangles out of each part for as long as no point of its surface moves by more than this many millimetres. 0, the default, leaves it out. It runs before the triangle target.
- **Reduce triangles**: A switch of its own. On: the densest meshes are reduced until the whole scene has the number of triangles in **Target**, as in [Fit to budget](meshoptimiser://docs/fit-to-budget). Off: the run only removes and tidies, and every mesh that stays keeps all its triangles. If the target is not lower than the scene has now, nothing is reduced.
- **Target**: How many triangles the whole scene may have after the run. You can write `150000`, `150k` or `1.5m`. Choosing a level sets it from the scene you have now. A number you type is kept.

The steps always run in this order: tidy up, exact copies, hidden parts, fasteners, small parts, holes, tolerance, then the reduction. Removing comes before reducing on purpose, so no effort goes into thinning a part that is deleted a moment later.

## Recipes

Open **Recipes** in the card to keep the settings under a name with **Save these…**, and run them again later with **Apply and run**, for example on the next revision of the model. **Export** and **Import** move saved recipes between computers as a small file, and **Delete** removes one.

## While it runs

A progress card names the step that is running. **Cancel** stops the run before the next step and keeps what has already been done. Each step writes a line to the Console (the button at the bottom of the window), and one summary is shown at the end.

## Undo

The whole run is one undo step. `Ctrl + Z` takes all of it back, and redo does all of it again.

> Start with Light or Balanced and look at the result. Undo is one key press, so you can try Strong afterwards at no cost. Do not use the removing steps when someone will open a cover, look through a window in the casing, or need the fasteners. Switch those steps off, or use the single tools one at a time.

Related: [workflow](meshoptimiser://docs/workflow), [fasteners](meshoptimiser://docs/fasteners), [select-hidden-parts](meshoptimiser://docs/select-hidden-parts), [delete-small-parts](meshoptimiser://docs/delete-small-parts), [fill-holes](meshoptimiser://docs/fill-holes), [fit-to-budget](meshoptimiser://docs/fit-to-budget)
