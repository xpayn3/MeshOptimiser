# How to make a CAD model safe to send to a customer

Show your product without handing over your design. Remove hidden parts and fasteners, simplify what is left, clean the names and export a small GLB.

A customer, a dealer or a web visitor needs to see your product. They do not need the screws inside it, the board under the cover or the exact shape of every internal part. This page takes a STEP assembly and turns it into a small GLB that shows the outside and little else.

> No file is a guarantee. Anyone can measure what they can see. This page makes the file show less, which is a good habit. It does not stop a determined person from copying what is left, and it is no replacement for an agreement with the customer.

## What a GLB already leaves out

A GLB holds triangles, colours and the names of parts. It has no feature tree, no sketches, no dimensions and no history of how the model was built. A STEP file has the exact surfaces. A GLB has an approximation made of small flat triangles.

## Steps

1. Export a STEP file from your CAD program and open it. See [Native CAD files: export a STEP file first](meshoptimiser://docs/cad-files-step-first).
2. Decide what the customer should see. Usually that is the closed product, seen from outside.
3. Remove what is inside. Use **Select hidden parts**, press **Isolate** to check what it found, and press **Delete**. See [Select hidden parts](meshoptimiser://docs/select-hidden-parts).
4. Remove the hardware: bolts, screws, nuts and washers. See [How to remove bolts and screws from a STEP assembly](meshoptimiser://docs/remove-bolts-from-step-assembly).
5. Simplify the parts whose shape is the secret. [Smart fit](meshoptimiser://docs/smart-fit) can swap a part for a box, a cylinder, a few boxes or blocks that keep its outline. **Remove holes** closes bolt holes and pockets.
6. Bring the weight down to a number with [Fit to budget](meshoptimiser://docs/fit-to-budget), if the file must be small.
7. Clean the names (below).
8. Export a GLB. See [Export](meshoptimiser://docs/export) and the settings below.
9. Check the exported file (below).

## Clean the names

Part names travel into the GLB. Names like `Gearbox_internal_v7_ACME` say more than a picture does. Select the parts and press `F2` to rename many at once, or use **Flatten** to remove levels of grouping that show how the product is built. See [The parts tree](meshoptimiser://docs/parts-tree).

Material names travel too. Look at them in the materials dock (`Shift + M`), and see [Colours and materials](meshoptimiser://docs/colours-materials).

Leave the extra information off when you convert a STEP file. In the import settings, keep **Layer attributes** and **Validation properties (mass, area)** switched off, so layers and per-part volume and area are not read in the first place.

## Export settings

- Format: GLB.
- Keep **Visible parts only** on, which is the default.
- Better still, delete what you do not want to share instead of only hiding it. A deleted part is gone from the file for certain.
- Choose **Unit scale** and **Up axis** for the viewer your customer will use. See [How to convert a STEP file to GLB](meshoptimiser://docs/convert-step-to-glb).

## Check the file before you send it

1. Drop the exported GLB onto the app window. A file never replaces a scene that has something in it, so it opens in a new tab.
2. Open the parts tree and read every name.
3. Press `3` for X-ray and look inside. Nothing should be there that you took out.
4. Look at **Properties** and the **Optimisation report**. The parts and triangle counts should match what you expect.

## What to send, and what not to send

- Send the file you exported, and only that.
- Do not send the STEP file. It has the exact surfaces.
- Do not send a saved scene. It keeps your view, your selection and your recolouring, and it is meant for you.
- Do not send files from the `inbox` folder. Next to each converted GLB the app keeps a small `.params.json` record that includes the path of the original file on your disk.

## What this does not do

- It removes whole parts, not the inside of a part. A housing keeps its inner walls, because the tool selects parts, not faces.
- It does not hide what is visible. The outside of your product is in the file, and anyone can measure it.
- It does not encrypt or lock the file.

Related: [select-hidden-parts](meshoptimiser://docs/select-hidden-parts), [smart-fit](meshoptimiser://docs/smart-fit), [export](meshoptimiser://docs/export), [privacy-offline](meshoptimiser://docs/privacy-offline)
