# Fit to budget

Type the number of triangles the whole scene may have. The densest meshes are reduced first until the total fits.

Often you are given one number: “the model must be under 500,000 triangles”. Fit to budget takes that number and decides for you which parts to reduce and by how much. The densest meshes give up the most. Large, sparse ones are left alone.

## When to use it

Near the end, after you have deleted the parts that are not needed. Deleting is free. Reducing costs detail, so reduce only what is left.

## Steps

1. Open the card **Reduce triangles**: press `Ctrl + K` and type `Fit to triangle budget`, which opens it with the budget field ready.
2. Type the budget in the field beside **Fit to budget**. You can write `150000`, `150k` or `1.5m`.
3. Press **Preview…**. A table lists the meshes that will be reduced, with their triangle count now and after, and an estimate of the new total.
4. Press **Fit to budget**.
5. A progress card appears. **Cancel** stops it, and then nothing is changed.
6. A message gives the result, for example how many triangles the scene went from and to, and how many meshes were reduced.

## What to expect

- The preview is an estimate. A mesh can stop a little short of its share.
- Every mesh keeps at least 16 triangles. If the budget is lower than the scene can reach, the app goes as far as it can and says that the budget was not reached.
- If the scene is already under the budget, the app says so and changes nothing.
- **Keep sharp edges**, at the top of the same card, applies here too: rims, steps and corners keep their vertices while the budget is met.

## Undo

The whole step is one undo: `Ctrl + Z` restores every mesh.

> If the result looks too rough, undo, delete more of what is not needed (see [Select hidden parts](meshoptimiser://docs/select-hidden-parts) and [Delete small parts](meshoptimiser://docs/delete-small-parts)), and run it again. The same budget then leaves more triangles for the parts that remain.

[Smart optimise](meshoptimiser://docs/smart-optimise) can do this as its last step, together with the other clean-ups. The whole run is then one undo step. Open its card with **Smart optimise…** in the search.

Related: [decimate](meshoptimiser://docs/decimate), [smart-optimise](meshoptimiser://docs/smart-optimise), [heavy-parts](meshoptimiser://docs/heavy-parts), [read-the-numbers](meshoptimiser://docs/read-the-numbers), [workflow](meshoptimiser://docs/workflow)
