# Fix normals: faces that point the wrong way

Find faces that are turned the wrong way and turn them right, in one tap, without guessing.

Every face of a model has a front and a back. The front is the side that faces outward, and it is the side that gets light. A face whose front points inward looks dark, or disappears when you look at it from outside. This is what people mean by flipped normals (the normal is the direction a face points).

Open the card with **Fix normals…** in the command search (`Ctrl` + `K`), or from **Repair** in the Commands menu.

## Choose what to look at

Press **Selected parts** or **Whole scene**. With nothing selected, the card works on the whole scene.

## The three buttons

- **Find problems**: Looks, and changes nothing. It reports parts turned inside out, faces that disagree with their neighbours, shading that goes against the faces, edges shared by three or more faces, and parts that are too large to check. Then it selects the parts that have a problem.
- **Reverse**: Turns every face of the selected parts round. Use it when a whole part is inside out.
- **Align**: Makes each face agree with its neighbours, and then turns every closed shape so it points outward. A hollow inside a part is kept pointing inward, as it should. Use it when a part is a mix of both.

## Two switches

- **Highlight back faces**: Paints the back of every face red, so you can see the problem. It changes only how the view is drawn, not the model.
- **Point closed shapes outward**: On by default. When it is on, **Align** also decides which way is outward for each closed piece. Switch it off to line faces up with each other only.

After **Reverse** or **Align** the shading is smoothed again, so the surface does not show the old creases. Both can be undone with `Ctrl` + `Z`.

> A piece with a gap can still be turned outward: if most of its faces agree, the app follows them. If a part is open in a way that makes the right answer unclear, **Find problems** lists it so that you can look at it yourself.

Related: [model-inspector](meshoptimiser://docs/model-inspector), [fill-holes](meshoptimiser://docs/fill-holes), [view-modes](meshoptimiser://docs/view-modes)
