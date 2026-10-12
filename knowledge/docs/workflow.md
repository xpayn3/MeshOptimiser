# A sensible order to work in

A suggested routine for a first clean-up: look, delete what is not needed, simplify what remains, check, save and export.

This is a suggestion, not a rule. It follows from what the tools do: deleting a part costs nothing in quality, so delete first. Reducing a mesh costs detail, so reduce only what you decided to keep. And there is no point in simplifying a part you are about to delete.

If you want the shortest way, [Smart optimise](meshoptimiser://docs/smart-optimise) follows this same order for you: one button, one undo. The steps below are for when you want to look at the result of each tool before the next one.

1. Open the file and look at it. Read the totals in **Properties**. See [How to read the numbers](meshoptimiser://docs/read-the-numbers).
2. If the model lies on its side or sits far from the grid, stand it up with [Align to floor](meshoptimiser://docs/align-to-floor).
3. Find out where the weight is: open [Heavy parts](meshoptimiser://docs/heavy-parts) and press `4` for the heatmap. Delete the heavy parts that nobody needs.
4. Remove what nobody will see with [Select hidden parts](meshoptimiser://docs/select-hidden-parts). Isolate, check, delete.
5. Remove copies that lie on top of each other with [Stacked copies](meshoptimiser://docs/stacked-copies). Find, isolate, check, delete.
6. Find the bolts, nuts and washers with [Fasteners](meshoptimiser://docs/fasteners). Delete them if the model does not need them, or replace them with stand-ins using [Smart fit](meshoptimiser://docs/smart-fit).
7. Remove other small parts with [Delete small parts](meshoptimiser://docs/delete-small-parts), if the model does not need them.
8. Close holes with [Remove holes](meshoptimiser://docs/fill-holes). If small loose pieces are left beside a part, take them out with [Remove floating pieces](meshoptimiser://docs/remove-floating-pieces).
9. Replace other filler parts with stand-ins, using [Smart fit](meshoptimiser://docs/smart-fit).
10. Reduce the heavy parts that remain with [Decimate](meshoptimiser://docs/decimate), or bring the whole scene to a number with [Fit to budget](meshoptimiser://docs/fit-to-budget).
11. Tidy up: **Remove empty parts** and **Delete empty groups** in the card **Quick fixes**.
12. Look at the whole model again in the normal view (`1`) and in clay (`5`). Open the **Optimisation report** to see what you saved.
13. Save the scene, so you can come back to it. See [Save a scene](meshoptimiser://docs/save-scene).
14. Export the file for the program it is meant for. See [Export](meshoptimiser://docs/export).

## Habits that help

- Check before you delete. **Isolate** shows exactly what a tool has selected.
- Work in steps and look after each one. `Ctrl + Z` takes back any of them.
- Save a scene before a drastic step. Your original file is never touched, and a saved scene is a second safety net.
- Stop when the number is reached. A model that is lighter than it needs to be has lost detail for nothing.

Related: [smart-optimise](meshoptimiser://docs/smart-optimise), [remove-floating-pieces](meshoptimiser://docs/remove-floating-pieces), [remesh](meshoptimiser://docs/remesh), [read-the-numbers](meshoptimiser://docs/read-the-numbers), [save-scene](meshoptimiser://docs/save-scene), [export](meshoptimiser://docs/export)
