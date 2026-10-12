# Scene tabs

Each tab is a scene of its own. Open several files side by side, drop a file to add it or open it in a tab, drag tabs into order, and save from the tab’s dot.

A scene is everything you are working on in one tab: its parts, materials, camera and undo history. The tabs sit in the top bar, like tabs in a browser. Each one is a separate scene.

## Open and close

- Click the `+` after the last tab, or press `Ctrl + N`, for a new empty scene.
- Opening a file never replaces a scene that has something in it. The file opens in a new tab.
- Click a tab to switch to it. Nothing is reloaded.
- Click the cross at the right end of a tab to close it. A click with the middle mouse button closes it too.
- If the scene has changes that are not saved, the app asks before it closes the tab.

## Drop a file on the window

You can drop a file anywhere on the window. What happens depends on the scene you have open.

- **The scene is empty**: The file opens there.
- **The scene has parts in it**: A small question comes up: **Add to this scene** or **Open in new tab**. Add puts the parts of the file in the scene you are looking at, next to what is there. Open in new tab makes a scene of its own. Press `Esc` or click outside the question to do nothing.

The **Import into scene…** command in the menu (`Ctrl + Shift + O`) always adds to the open scene. After an add, the new parts are selected, so you can see where they landed.

## Read a tab

- **Dot**: The first thing in every tab. Yellow means there are changes that are not saved. Green means the scene is saved. Faint means the scene is empty. Click the dot of the open tab to save the scene. It does the same as `Ctrl + S`.
- **Name**: The name of the scene. Double-click it to rename the scene. A long name is cut in the middle, so the end of it and the type of the file stay readable.
- **Cross**: Closes the tab.

Every tab has the same width, and nothing in a tab moves when you pick it.

## Right-click a tab

A menu opens with the things you can do with tabs:

- **Duplicate scene**: Opens a copy of that tab’s scene in a new tab. It is dimmed when the scene is empty.
- **Close all**: Closes every tab. `Ctrl + Shift + F4`.
- **Close others**: Closes every tab except this one.
- **Open…**: Opens a file, as `Ctrl + O` does.
- **Open recent**: A list of the files you opened lately.

Close all and Close others ask just once for all the scenes that have unsaved changes. Duplicate scene, Close all and Close others are in the search (`Ctrl + K`) too.

## Put tabs in order

1. Press a tab and pull it sideways.
2. The tab rides with the pointer and the others slide over to make room.
3. Let go. It drops into the nearest place.

Press `Esc` while you are still holding the tab to put it back where it was.

## Sidebars across tabs

When you switch tabs, the widths of the sidebars and the folded left sidebar stay as they were in the tab you came from. To let each tab keep its own layout, switch off **Same sidebars in every tab** under **Settings**, **General**.

Related: [save-scene](meshoptimiser://docs/save-scene), [first-file](meshoptimiser://docs/first-file), [undo-redo](meshoptimiser://docs/undo-redo)
