# MeshOptimiser v0.35.3

v0.35.2 was about working with more than one scene. v0.35.3 is about what the app shows you before it changes anything, and about how it looks: Smart optimise scans the model first, the colour picker has a right-click menu, a material of the Properties card is picked with a click and opened with a double-click, and the colours, spacing and buttons of the whole app were gone through again.

## New

**Smart optimise scans the scene first.** A Scan button lists what the clean-ups would find (empty parts, exact copies, hidden parts, fasteners with their share of the triangles, small parts, holes) without changing anything. Highlight selects the parts of a finding, Isolate shows only them. The list dims and a Rescan button comes back when the scene changes. Measured on a model of 3.1 million triangles: 7 s.

**A right-click menu in the colour picker.** Copy and paste the colour, copy it as HEX, RGB, HSV or HSL, and choose the space the numbers are shown in. The strip of colour-space buttons is gone from the window, which is narrower.

**Materials.** A click on a material of the Properties card only picks it; a double-click opens its editor; Delete takes the picked material off the selected parts. A saved scene reopens with the same parts selected and the view still isolated.

**The parts tree** has Scroll to top and Show in list on its buttons; **the website's menu bar** goes away when you scroll down and comes back when you scroll up.

## Around the app

A new black (#141414) with the greys above it lifted to match; every main button is flat and takes the same tokens; the check boxes are one look; the rows of the command cards are 28 px high; the top bar, the Properties card, the material editor and the colour picker were measured and put on whole pixels; the Quick wand is on Q; the Claude pill sits in the status bar; Notes has the sticky-note icons and an unread dot.

## Fixed

A floating Materials, Library or Animate window no longer rises under a bottom drawer and jumps in front of it; the console no longer covers the status bar as it slides in; the text of the parts tree is no longer soft; a refresh no longer leaves the sidebars scrolled or Notes mode on; the right-click menu of a material is over the selection buttons; the Tools buttons do not leave one alone on a row; and the Quick wand's dimmed commands are solid and its slices can be clicked after a tap of W.

Several of these were checked only by reading the code or by measuring in a test browser; the full list in the changelog says which.
