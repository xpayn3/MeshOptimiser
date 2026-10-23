# Remove thickness

Make a thin-walled part the one surface it stands for: a hollow pipe keeps its outside, a part bent from sheet keeps one face.

A pipe, a bent bracket or a stamped cover is modelled as a wall with two sides. For a picture, a game or a light file you often need only one: the outside of the pipe, one face of the sheet. **Remove thickness** finds the walls and takes the other side away, with the rings at the ends of a pipe and the strip round the edge of a sheet.

## How to use it

1. Select the parts, or select nothing for every part that is shown.
2. Press `Ctrl + K`, type `thickness` and choose **Remove thickness**. A card opens and the tool runs on each part.
3. Set **Thickness up to**: walls up to this thick, as a share of the part’s size, become one surface. It starts at 0.5 %.
4. **Move into the wall** starts at 0 %, which leaves the side that stays where it is. 50 % puts the surface in the middle of the wall.
5. Press **Done** or `Esc` to close the card. One undo step (`Ctrl + Z`) brings the parts back.

The card says how many triangles went, how thick the walls were and what is left. A wall that cannot be split into two sides (a folded one, or a solid part with only fine features) is left alone, and the card says why. With CAD faces, whole faces go or stay. The surface that is left is open, one layer thick, and the faces that stay keep their own shading.

> On the oil pump pipe of a diesel engine the walls were 1.005 mm and 2,376 triangles became 1,148, open only at the two ends of the pipe. Claude can run the same tool as `remove_thickness`.

Related: [simplify-round-faces](meshoptimiser://docs/simplify-round-faces), [remove-fillets](meshoptimiser://docs/remove-fillets), [mend-mesh](meshoptimiser://docs/mend-mesh)
