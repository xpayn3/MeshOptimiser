# Notes: leave comments on a model and send them with it

Put a numbered pin on the model, write what you want to say, and save the scene. Whoever opens it sees every note, can answer, edit and resolve, and the file shows who did what.

A note is a conversation about a place in the model. You click a spot, write a few words, and a numbered pin stays there. Save the scene and send the file: the other person opens it in MeshOptimiser (or the free online version) and reads every note, answers it, and sends it back. Nothing is uploaded anywhere. The notes live in the scene file.

## Leave a note

1. Press `N`, or choose **Add note** in the **Notes** card in the right-hand column. The first time, the app asks for your name: type the one others should see next to what you write.
2. Click the spot on the model. A small window opens with a picture of the view you are looking at.
3. Write the note and press `Enter`. (`Shift + Enter` starts a new line.) Pick a tag if you want: **Info**, **Question**, **Issue** or **Idea**.

Dragging still turns the view while you place a note; only a click puts the pin down. `Esc` cancels.

- **On a spot**: A pin on the surface. It stays on that part when the part moves, is hidden or the view is exploded.
- **On the selected part**: **On selected part** puts the note on the middle of the part you selected.
- **About the whole scene**: **Scene note** has no pin. It is for what applies to the model as a whole.

## Read and answer

Click a pin, or a row in the **Notes** card. The camera goes back to the view the note was written from, and the window shows the whole conversation.

- **Reply** adds a message under the note.
- **Resolve** marks the note as done. It stays in the list, dimmed, and **Resolve** becomes **Resolved ✓**: click it again to open the note again.
- The tag and **Not assigned** change who it is for and what kind of note it is. The people in the list are the people who wrote in this file.
- The arrows at the top go to the next and the previous note.
- If the part is hidden, the window says so and offers **hidden · show**. If the part has been deleted, the note says **part gone** and keeps its place.

## Edit, delete, and what the file shows

Anyone who opens the scene can edit or delete any message, and the file keeps the record:

- An edited message says **Edited by …** and who. Click it to see what the message said before, with the name and time of each change.
- A deleted message stays as a line saying who deleted it and when. **Bring it back** puts the text back.
- **History** at the foot of each note lists everything that happened to it, in order: who started it, who answered, who resolved it, who moved the pin.
- Every name is the one the person typed. Nobody signs in, so a name says who someone said they were; it is not proof.

The **⋯** menu has **Move the pin…**, **Use the view now as this note’s view**, **Copy as text** and **Delete the note**. A deleted note leaves the list; choose **Deleted** in the filter to find it and bring it back.

## The Notes card

- **Your name**: Shown at the top of the card. Click it to change it.
- **The eye**: Hides or shows the pins in the view.
- **Open, All, Resolved, New to me, Mine, Deleted**: The filter. **New to me** shows the notes somebody else has changed since you last saved this scene. **Mine** shows the notes you wrote, answered or were given.
- **Search**: Looks in the text, the names, the part and the tag.
- **Mark … read**: Clears the “new” marks. Saving the scene does the same for your name.

A red dot on a pin, and a ring on its number in the list, mean the note has something new from somebody else.

## Save, open and send

Notes go in the scene file when you save it (`Ctrl + S`). The save window has **Include the notes** (it shows when there are notes). Open the file the usual way and the notes come with it; a message at the top says how many there are and how many are open. A scene is an ordinary GLB, so other programs open the model and ignore the notes.

When two people have worked on their own copies of one scene, **Bring in notes…** takes a saved scene file and joins its notes into the ones you have: new notes are added, replies, edits and resolutions are put together, and for something both changed the later change wins. Nobody’s words are lost: an edit keeps what it replaced. Run it again with the same file and nothing changes.

**Report…** writes the notes as one HTML page with the pictures, every message, who edited what and the history. Anyone can open it in a browser, with no app. **Copy** puts the notes on the clipboard as text.

> Notes are in saved scenes only. **Export** (GLB, glTF, FBX, USDZ, …) never writes them, so a note meant for your team cannot reach a customer in an export. If you save a scene to send to somebody outside, leave **Include the notes** off. See [How to make a CAD model safe to send to a customer](meshoptimiser://docs/make-model-safe-to-send).

## Undo

Every change to the notes is one step for `Ctrl + Z`: adding a note, a reply, an edit, a resolve, a delete. Undo takes back the last thing done, whoever it was, so check the name in **History** if you are working on somebody else’s file.

Related: [save-scene](meshoptimiser://docs/save-scene), [make-model-safe-to-send](meshoptimiser://docs/make-model-safe-to-send), [undo-redo](meshoptimiser://docs/undo-redo), [shortcuts](meshoptimiser://docs/shortcuts)
