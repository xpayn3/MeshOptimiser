# Notes: tasks on the model, with comments, sent with the scene

A note is a task about a place or a part: a title, what it is about, who it is for, how urgent and when, with comments under it. Save the scene and whoever opens it sees every note, answers it and signs off, and the file shows who did what.

A note is a task about a place in the model. It has a title, an optional description, the part or parts it is about, who it is for, a priority and a due date, and people write comments under it. Save the scene and send the file: the other person opens it in MeshOptimiser (or the free online version), reads every note, answers it and sends it back. Nothing is uploaded anywhere. The notes live in the scene file.

## Make a note

1. Press `N`, or choose **New note** in the **Notes** card in the right-hand column, and click the spot on the model. With parts selected, it starts a note about those parts at once. Or right-click the model and choose **Add a note here** or **Add a note to this part**. The first time, the app asks for your name: type the one others should see next to what you write.
2. A form opens: a box to write the note in (its first line is its title, which you can rename later), the kind (**Info**, **Question**, **Issue** or **Idea**), who it is for, the priority and a due date. The camera button adds a screenshot of the view.
3. Press **Create note**, or `Ctrl + Enter` in the box. Comments go under it afterwards.

Dragging still turns the view while you place a note; only a click puts the pin down. `Esc` cancels.

- **On a spot**: A pin on the surface. It stays on that part when the part moves, is hidden or the view is exploded.
- **On the selected parts**: **New note** with parts selected, or **A note on the selected part** in the three dots of the card, makes a note about every selected part, with no limit. If several parts are selected and you place a note on one of them, the note takes all of them.
- **About the whole scene**: **Add a note about the whole scene** in the command search (`Shift + C`) has no pin. It is for what applies to the model as a whole.

## The pin

Each kind of note has its own shape, with its number inside: a circle for **Info**, a rounded square for **Question**, a triangle for **Issue** and a diamond for **Idea**. A finished note is green with no outline. A note that is late has a red dashed outline, a high priority an amber one and an urgent one a red one. **Pins** in the three dots of the card chooses what a pin shows: the number, the title as a label, the kind as an icon, only the shape, or the writer’s letter.

## Open a note

Click a pin and a short window opens on the right of the view: the description and how many comments there are. The button in the title bar opens the whole note, and the card’s list opens it in full. Drag the window by its title bar, and pull an edge to change its size; both are remembered for the next one.

- The **Parts** section has a card for every part the note is about. **Focus** selects the part and takes the camera to it. A part that is hidden has an eye to show it.
- The row under it has the arrows to the next and the previous note, the tick that marks the note done (a green circle grows in behind it; press it again to open the note again) and the three dots.
- The comments are at the bottom, with a thumb up, a thumb down and reply on each. A reply shows what it answers.
- An **@name** in a text is shown as a mention, and the field offers the names as you type **@**.

## Edit a note

Everything about the task is edited from the three dots: choose **Edit**, and the dots become a pencil. While you edit, the title and the description are fields, the controls for the kind, who it is for, the priority and the due date appear, every part card has a bin to take that part off, **Add selected** adds the parts selected in the viewport, and the camera adds a screenshot (up to six; each one remembers the view it was taken from and clicking it goes back there). Press the pencil to leave. The comments are out of the way while you edit.

The three dots also have **Show the hidden part** (when the part is hidden), **Add a screenshot of the view**, **Take the screenshots off**, **History** and **Delete the note**. A deleted note leaves the list; choose **Show deleted notes** in the three dots of the card to find it, then **Bring the note back** in the note’s own three dots. Right-clicking a pin has the common ones: comment, edit, resolve, kind, priority, due date, assign to me, move, delete, and **Show it in the view**, **Move the pin…** and **Copy as text**.

## Edit, delete, and what the file shows

Anyone who opens the scene can edit or delete any message, and the file keeps the record:

- An edited message says **Edited by …** and who. Click it to see what the message said before, with the name and time of each change.
- A deleted message stays as a line saying who deleted it and when. **Bring it back** puts the text back.
- **History** lists everything that happened to the note, in order: who started it, who renamed it, who answered, who set the priority, who resolved it.
- Every name is the one the person typed. Nobody signs in, so a name says who someone said they were; it is not proof.

## The Notes card

- **New note**: Click a spot on the model to make a note, or, with parts selected, make one about them.
- **All, Open, Done**: The filter. It starts on **Open**.
- **Search and the eye**: The magnifier opens a search that looks in the title, the text, the names and the parts. The eye shows or hides the pins on the model.
- **The three dots**: **A note on the selected part**, **Show only the parts with notes**, **Only the notes on the selected part**, **Pins**, **Sort by** (number, newest, priority, due date or part), **Show deleted notes**, **Review** and **Share**.
- **The arrows**: Go through the list note by note and fly to each one. The target beside them shows only the parts that have notes; press it again to show everything.
- **A row**: The tick marks it done. The shape and number show the kind, a dot shows a high or urgent priority, a red chip a late due date, and the avatar who it is for.
- **Sign-off**: **Approve this scene** or **Ask for changes**, under **Review** in the three dots, says what you think of the scene. Everyone has one answer, and the card shows who said what once someone has signed.

A red dot on a pin means the note has something new from somebody else. Opening a scene with notes says how many there are, how many are open or late, how many are new to you and who wrote the last one.

## Save, open and send

Notes go in the scene file when you save it (`Ctrl + S`). The save window has **Include the notes** (it shows when there are notes). Open the file the usual way and the notes come with it. A scene is an ordinary GLB, so other programs open the model and ignore the notes. After a restart, a scene this app saved is saved over without asking where.

**Bring in notes…**, also under **Share**, joins the notes of another copy into yours: new notes are added, comments, edits and resolutions are put together, and for something both changed the later change wins. Nobody’s words are lost. Run it again with the same file and nothing changes. It reads a saved scene, a JSON file and a BCF file.

**Take the notes out…**, under **Share** in the three dots of the card, writes the notes as a report page (HTML, with the pictures, every message and the history; anyone can open it with no app), a spreadsheet (CSV, one row per note, for Excel), JSON with every detail, or BCF 2.1 for design tools: one topic per note with its view, picture, comments, priority, due date and who it is for. A BCF file from another tool comes in as notes too, without a pin: its view is kept.

> Notes are in saved scenes only. **Export** (GLB, glTF, FBX, USDZ, …) never writes them, so a note meant for your team cannot reach a customer in an export. If you save a scene to send to somebody outside, leave **Include the notes** off. See [How to make a CAD model safe to send to a customer](meshoptimiser://docs/make-model-safe-to-send).

## Undo

Every change to the notes is one step for `Ctrl + Z`: making a note, a comment, an edit, a resolve, a delete. Undo takes back the last thing done, whoever it was, so check the name in **History** if you are working on somebody else’s file.

Related: [save-scene](meshoptimiser://docs/save-scene), [make-model-safe-to-send](meshoptimiser://docs/make-model-safe-to-send), [undo-redo](meshoptimiser://docs/undo-redo), [shortcuts](meshoptimiser://docs/shortcuts)
