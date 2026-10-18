# Union, Subtract and Intersect parts

Join parts into one, cut one part with others, or keep only where they overlap. Exact, on closed parts, with the first part you picked as the one that changes.

> Union, Subtract and Intersect is in the next version of the app. It is in the project’s repository and not yet in a released version.

These are the classic boolean operations of a CAD program, done exactly on the triangles: the faces they do not touch stay as they were, and no detail is lost to a grid.

- **Union parts**: The parts become one solid. Where they overlap, the inside faces go.
- **Subtract parts**: The first part, less everything the other parts take up. A bolt subtracted from a plate leaves its hole.
- **Intersect parts**: Only what all the parts share is kept.

## How to use them

1. Select the parts in order. The first one you pick is the one that changes. `Ctrl`-click the others.
2. Open the command search (**Ctrl + K**) and run **Union parts**, **Subtract parts** or **Intersect parts**.
3. The first part becomes the result, in its own place. The other parts are left as they are: hide or delete them if you no longer need them.
4. One undo step (**Ctrl + Z**) takes it back.

> Only closed bodies take part. A sheet, or a part with a crack, cannot be a solid, so it is left out and the app says so. Close it first with [Close cracks or Patch holes](meshoptimiser://docs/mend-mesh). To join the overlapping bodies inside one part, use Merge bodies in [Reshape a mesh](meshoptimiser://docs/reshape-mesh).

Related: [mend-mesh](meshoptimiser://docs/mend-mesh), [reshape-mesh](meshoptimiser://docs/reshape-mesh), [voxel-remesh](meshoptimiser://docs/voxel-remesh)
