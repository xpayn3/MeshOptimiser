# The window

A tour of the screen: the top bar and tabs, the parts tree, the 3D view and its toolbars, the cards on the right, the drawers, the status bar and how to resize it all.

The window has four areas: a top bar, a left sidebar, the 3D view in the middle (called the viewport) and a right sidebar. A thin status bar runs under the viewport.

When the app starts, a short splash screen shows the version and what the app is doing, then the window fades in. You can switch the splash off under **Settings**, **General**.

## Top bar

- **The app’s mark**: At the far left. Click it for the version number, what is new, links to the source code and to report a problem, **Help & docs** and the list of keyboard shortcuts.
- **Menu**: The file commands: **New scene**, **Open file…**, **Import into scene…**, **Save scene…**, **Export…**, **Revert to source…**, **Scene settings…**, **Settings…**, **Help & docs**, **Welcome screen** and **Quit app**.
- **Sidebar button**: Right after Menu. Shows or hides the left sidebar. When the sidebar is hidden, the button stays next to Menu.
- **Scene tabs**: One tab for each open scene, and a `+` to start a new one. See [Scene tabs](meshoptimiser://docs/scene-tabs).
- **Export**: At the right. Writes the model to a file for another program. See [Export](meshoptimiser://docs/export).
- **Camera button**: Next to Export. Saves a picture of the view. See [Screenshots](meshoptimiser://docs/screenshots).

## Left sidebar

It shows the parts tree: every part of the model, arranged in groups, with a search field and three buttons above it (**Collapse**, **Rename**, **Flatten**). A **Transform** card with position, rotation and size can be shown at its foot. It floats over the bottom of the sidebar and takes its own room under the tree. The library of parts you can add is not in this sidebar any more. It is a drawer under the viewport (see below).

## Viewport

- **Tool strip, left edge**: Move, rotate and scale tools, **Dynamic place** (`D`), a button for the transform card, then four view modes (solid, wireframe, X-ray, heatmap) and a button that highlights small parts. The Clay and CAD looks are in the **Shading** card on the right.
- **View name, top centre**: Says which camera view is active, **Cam** to begin with. Click it to switch to Top, Front or Side. Small pills to its right show a mode that is on: **Isolated**, **Exploded**, **Measure** and **Snap**. Click a pill to leave that mode.
- **View cube, top right**: A small cube that turns with the model. Click a face or an axis dot and the view turns there.
- **Toolbar, bottom centre**: Search, add a shape, **Split**, **Remove holes**, **Draw lines**, **Smart fit**, **Remesh**, **Select hidden parts**, **Fasteners**, **Measure**, **Library**, **Materials**, and `…` for the list of all commands.
- **Shortcut tips, bottom right**: A faint list of what the mouse and keys do right now. It changes when you select something.
- **Command cards, bottom left**: A tool with settings, such as Remove holes, Align to floor or Dynamic place, opens as a card over the viewport. `Enter` runs it and `Esc` puts it away.

## Right sidebar

At the top is **Properties**. With nothing selected it describes the whole scene. With a selection it describes that: the name, the material, the triangle count with a bar that shows its share of the scene, and the number of vertices, the size and the mesh data. Under it are cards you open and close by clicking their title. A card slides open and shut. Every card starts folded except **Properties** and **Shading**, and the ones you open or close are remembered.

- **Shading**: Every look for the Clay and CAD views as a small picture: Clay, Porcelain, Steel and Red wax, and the CAD looks Ceramic, Light and Mono. Click one to choose it and turn the view on. Click the lit one again to go back to Solid. The **Outlines** switch draws a fine dark line on the sharp edges of every part. See [Colours and materials](meshoptimiser://docs/colours-materials) and [View modes](meshoptimiser://docs/view-modes).
- **Selection & actions**: Select all, invert, select similar, by colour, by name, and Merge, Group and Delete.
- **Select similar**: Sets how close a part has to look to the selected ones to count as similar.
- **Inspect**: **Heavy parts** (with a small count of how many there are), **Filters & flags**, **Measurements** (only while there is a measurement) and **Exploded view**.
- **Clean up**: **Delete small parts**, **Auto cleanup** and **Tidy geometry**.
- **Reduce**: **Smart optimise** and **Reduce triangles**, which holds Fit to budget, Decimate, Smart fit all parts and the optimisation report.

Tools with their own settings, such as **Align to floor** and **Find stacked copies**, are not cards in the sidebar. They open over the viewport, from the toolbar, the list of all commands or the search.

## Status bar

Under the viewport: the number of vertices, the size of the mesh data, how many parts are selected (click it to frame them), how many are flagged (click it to isolate them), the frame rate, and a **Console** button. The numbers of parts and triangles are in **Properties**.

## Drawers

Three panels slide up from the bottom of the viewport and take turns: only one is open at a time. Drag the top edge of a drawer to change its height. The Library and the Materials drawer can also pop out as floating windows over the view. Then they do not take turns, and both can be open side by side.

- **Library**: The parts you can add. Opened with the **Library** button on the bottom toolbar or `Shift + L`. See [The library](meshoptimiser://docs/library).
- **Materials**: Every material in the scene. Opened with `Shift + M`. See [Colours and materials](meshoptimiser://docs/colours-materials).
- **Console**: A log of everything the app has done, with filters for information, warnings and errors and a button to copy it. Opened with the backtick key or the **Console** button in the status bar.

## Make room

Each sidebar has a drag handle on its inner edge. A thin line shows when you rest the pointer on it for a moment.

- Drag a handle to make a sidebar wider or narrower. Double-click it to put the width back.
- The left sidebar cannot be narrower than 220 pixels and the right one not narrower than 240. Narrower than that, buttons and labels would wrap or be cut off.
- The window itself cannot be smaller than 960 by 560 pixels. In a smaller window the app scrolls instead of squeezing the panels.
- Use the sidebar button in the top bar to hide the left sidebar.
- On a narrow window, buttons of the bottom toolbar fold away into the `…` list.

## Help

Press `F1` to open the help inside the app. It holds the same articles as this website and works without an internet connection. See [The help window](not in this knowledge base).

Related: [help-window](not in this knowledge base), [move-the-view](meshoptimiser://docs/move-the-view), [parts-tree](meshoptimiser://docs/parts-tree), [search-and-commands](meshoptimiser://docs/search-and-commands), [read-the-numbers](meshoptimiser://docs/read-the-numbers)
