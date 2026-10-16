# MeshOptimiser v0.33.0 (Ptuj)

Notes become tasks: a title, a description, the parts, who it is for, a priority and a due date, with comments under them, and they can leave the app as a spreadsheet, JSON or BCF.

## New

**A note is a task.** Press N and click a spot, or right-click the model: Add a note here, Add a note to this part. A form asks for a title, an optional description, the kind, who it is for, the priority and a due date, with a camera for a screenshot. Comments go under the note afterwards, with a thumb up, a thumb down, reply and @mentions.

**Shapes, priority and due dates.** Each kind has its own shape with the number inside: a circle for Info, a square for Question, a triangle for Issue, a diamond for Idea. A finished note is green, a late one has a red dashed outline, a high or urgent one is marked. The pins button chooses what a pin shows, including the title as a label on the model.

**Many parts, with no limit.** The Parts section has a card for every part: Focus selects the part and takes the camera to it, and in edit mode a bin takes a part off and Add selected adds the selected parts. A note made with several parts selected is about all of them.

**Screenshots, up to six,** each remembering the view it was taken from. Edit is in the three dots and turns them into a pencil. Approve or Changes signs off the whole scene.

## Around the app

**The note window** opens on the right of the view, drags by its title bar, resizes by its edges, scrolls inside itself and has its shadow only while it is the window in use. **The Notes card is a task list** with filters, search, order, only the selected part, arrows through the list, and a button that shows only the parts that have notes. Opening a scene tells how many notes there are, how many are late and who wrote last.

**CSV, JSON and BCF.** The export button writes a report page, a spreadsheet, JSON or BCF 2.1 for design tools. Bring in notes reads a scene, a JSON file or a BCF file.

**Save writes over the scene's file after a restart.** A scene saved by this app opens ready to be saved over; a model from elsewhere never is.

**The Claude connection card** has Copy command, Console and More in one row, with Claude mode across the whole card below.

## Fixed

A big STEP file with colours could stop the import with "step2glb.py exited with code 3221225477": the app now retries with the plain reader. The notes window and card were rough (a pin that slid away on hover, a window that jumped, a card that would not fold): all fixed.
