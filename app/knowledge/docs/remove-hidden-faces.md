# Remove hidden faces

Delete the faces that can never be seen from outside, such as the inside of a housing or the faces where two parts press together.

A part is a shell of small faces. On a CAD part, many of them are not on the outside at all: the walls inside a housing, the faces where a bracket sits against a plate. Nobody sees them, and they cost triangles. This card looks at each part from many sides and deletes the faces that never show.

**Select hidden parts** works on whole parts. This card works one level down, on the faces inside a part that is otherwise visible. A part that is hidden altogether is not touched: the card tells you, and you use [Select hidden parts](meshoptimiser://docs/select-hidden-parts) for it.

## When to use it

When the model will be shown closed, from outside, and it has housings, covers or parts that press together. Not when someone will open a cover, look through a window in the casing, or show an exploded view.

## Steps

1. Open the card with **Remove hidden faces…** in the command search (`Ctrl` + `K`), or from **Repair** in the Commands menu. It opens as a card over the viewport.
2. Choose what to work on: **Selected parts**, or **Whole scene**. With nothing selected, the card tells you to select parts or clean the whole scene.
3. Read the line under the button. It says how many parts will be looked at. A large scene takes a while, so start with a few parts.
4. Press **Remove hidden faces**.
5. Wait for the progress. **Cancel** stops it: the parts that are already finished keep their change, and the rest are left as they were.
6. Read the message at the end. It says how many faces were removed from how many parts, and the triangles in the scene before and after.

Parts are looked at one by one. Everything else in the scene still counts as something that can stand in front of the part, also when you chose **Selected parts**, so a face is not called hidden just because its cover was not selected.

## What the options mean

These are under **Advanced**. The defaults suit most models.

- **Selected parts / Whole scene**: Clean only the parts you selected, or every part in the scene.
- **Accuracy**: How many directions each part is looked at from: Fast, Normal or Thorough. More directions find faces that show only through a narrow gap, and take longer. Normal is the default.
- **Keep faces next to visible ones**: On by default. A face that touches a visible face stays. This stops holes from opening in the surface, and a face too small to be caught is not lost. Turn it off to remove the most, at the risk of a ragged edge where the inside meets the outside.
- **See-through parts hide what is behind**: Off by default: a clear part, such as glass, hides nothing, so what is behind it counts as visible. On: it hides what is behind it like any other part.
- **Skip parts under**: Parts with fewer triangles than this are left alone. The default is 20.
- **Reset to defaults**: Puts all of the above back.

## The message at the end

Besides the number of faces removed, it can say how many parts had nothing hidden, and how many are hidden altogether. If nothing was found, it says so and changes nothing.

## Undo

The cleaning is one undo step. Press `Ctrl + Z` and the faces are back.

## Tips

- Show all parts first (`Alt + H`). Parts you hid are not looked at, and they do not count as something in front of the others.
- Try one heavy part first and look at it from inside. It is the quickest way to learn what the card does on your model.
- If a face you can see through a small opening was removed, undo and run it again with **Accuracy** on Thorough, and keep **Keep faces next to visible ones** on.
- The card needs WebGL2. If the browser does not have it, the card says so and does nothing.

Related: [select-hidden-parts](meshoptimiser://docs/select-hidden-parts), [delete-small-parts](meshoptimiser://docs/delete-small-parts), [cleanup](meshoptimiser://docs/cleanup), [remove-floating-pieces](meshoptimiser://docs/remove-floating-pieces), [workflow](meshoptimiser://docs/workflow)
