# UV layout: how a texture sits on a part

See how the picture on a part is laid out, and where it overlaps, runs outside its square or stretches.

A texture is a flat picture wrapped round a part. The numbers that say which spot of the picture lands on which spot of the part are called the UVs. The UV layout card draws them, so you can see problems that are hard to see on the part itself.

Select one part and open **UV layout…** in the command search (`Ctrl` + `K`).

## What you see

A square, the picture’s space, from 0 to 1. Inside it, the part’s islands: the pieces of the part that were unfolded flat. Space that is used once is drawn lightly. Space where two islands lie on top of each other is drawn stronger. Anything that falls outside the square is drawn in the marker colour.

## The numbers

- **Islands**: How many separate pieces the layout has.
- **Space used**: How much of the square the islands cover. A low number wastes picture.
- **On another island**: The share of the covered space where islands overlap. Overlapping islands share the same pixels of the picture.
- **Outside the square**: Triangles that reach beyond 0 to 1. They use another tile of the picture, or a stray island.
- **Collapsed triangles**: Triangles with no area in the layout. The texture smears there.
- **Mirrored triangles**: Triangles laid out back to front, so the picture reads the wrong way round on them.
- **Texel density**: How many pixels of picture each part of the model gets, and how even that is. Large differences show up as blurry or stretched areas.

The card follows your selection while it is open. If the part has no texture coordinates, it says so; import the file again with **Keep texture coordinates** switched on. A part with more than 600,000 triangles is too large to check here.

> The card only looks. It does not change the layout.

Related: [colours-materials](meshoptimiser://docs/colours-materials), [model-inspector](meshoptimiser://docs/model-inspector)
