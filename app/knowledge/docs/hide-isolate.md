# Hide, isolate, show all

Hide parts that are in the way, look at a few parts on their own, and bring everything back with one key.

Hiding is how you look inside a model. A hidden part is still in the scene. It is only not drawn.

- `H`: Hide the selected parts. When every selected part is already hidden, H shows them again.
- `Shift + H`: Hide the rest: everything that is not selected
- `Alt + H`: Show all parts again
- `S`: Isolate the selection. When the selection is already the only thing on show, S shows everything again.

## Isolate

1. Select the parts you want to look at.
2. Press `S`. Everything else disappears.
3. A pill at the top of the viewport says so, for example “Isolated · 1 of 95 parts”.
4. Press `S` again, or click the pill, to show everything.
5. To look at other parts instead, select them and press `S`: the view isolates those. `S` leaves the isolation only when the selected parts are already the only ones on show.

## In the parts tree

Every row has an eye at its right end. Click it to hide or show that part. The eye on a group hides or shows everything inside it.

## Good to know

- Hiding and showing are undo steps. `Ctrl + Z` takes one back.
- **Properties** shows how many parts are hidden.
- A saved scene remembers which parts were hidden.
- When you export, the switch **Visible parts only** decides whether hidden parts are written to the file. See [Export](meshoptimiser://docs/export).

> Hiding a part does not make the file lighter. To remove a part for good, delete it with `Del`.

Related: [select-parts](meshoptimiser://docs/select-parts), [view-modes](meshoptimiser://docs/view-modes), [select-hidden-parts](meshoptimiser://docs/select-hidden-parts)
