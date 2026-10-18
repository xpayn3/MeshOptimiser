# Remove fillets and chamfers

Take the small rounds and chamfers off a part that came from a STEP, and get its sharp edges back. The faces on either side are extended until they meet.

A CAD model softens its edges: a fillet is a narrow rounded face between two others, a chamfer a narrow flat one. For a picture on the web they cost a lot of triangles and show little. This tool takes them off and makes the edge sharp again: the two faces the blend ran between are extended until they meet, and the blend is gone. Where three fillets meet at a corner, the patch between them goes too and the corner is the point where the three faces meet.

It needs the CAD faces, so it works on a part from a STEP file opened with them (see [CAD faces and edges](meshoptimiser://docs/cad-edges)), or from a scene saved from one. The CAD faces say what each face is and which faces meet tangent, which is how a fillet is told from a small cylinder that is part of the shape. A part without them says so.

## How to use it

- Select the parts and run **Remove fillets and chamfers** from the command search (**Ctrl + K**). With nothing selected it runs on every part that is shown.
- The card that opens has two limits, as shares of the part's size: **Fillets up to** (a radius) and **Chamfers up to** (a width). A blend wider than its limit stays. 0 leaves that kind alone. A change runs it again from the part as it was.
- The card says how many fillets and chamfers went, and how many blend faces were left and why.
- One undo step (**Ctrl + Z**) brings the part back.

## What is left alone

- A blend between faces that are not planes or cylinders (a cone, a sphere, a free-form surface).
- A corner where four or more faces meet at one point, or a blend that runs into another kind of face along its length.
- A blend whose rim would have to move further than a few times its own size: the faces beside it did not fit.
- A blend that touches, at a point, a blend that was already taken off and could not be done together with it: moving that point again would tear the face.

> The part loses its CAD faces afterwards, like after any edit, so run this before Untriangulate or Remove holes if you want those to use them too. The result keeps the shape everywhere else.

Related: [cad-edges](meshoptimiser://docs/cad-edges), [fill-holes](meshoptimiser://docs/fill-holes), [edit-mesh](meshoptimiser://docs/edit-mesh)
