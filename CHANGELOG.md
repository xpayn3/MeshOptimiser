# Changelog

All notable changes to MeshOptimiser. Newest on top.

Tag legend: &nbsp; ![new][new] new feature &nbsp;·&nbsp; ![fix][fix] bug fix &nbsp;·&nbsp; ![perf][perf] performance &nbsp;·&nbsp; ![polish][polish] UX / visual refinement &nbsp;·&nbsp; ![refactor][refactor] internal cleanup &nbsp;·&nbsp; ![docs][docs] documentation

## Unreleased

**Polish**

- ![fix][fix] **The colour dot in the tree follows a material's colour.** Changing the colour of a material changed the parts in the 3D view but left the dot on their tree rows with the old colour until the tree was redrawn; the dots now change with it.
- ![fix][fix] **The Claude connected dropdown fits its panel.** The buttons at its foot (Claude mode, Copy command, Console, More…) ran out of the panel. *Claude mode* now has a row of its own and the other three sit under it.
- ![polish][polish] **Icon-only buttons in the top bar draw at one size.** The sidebar button drew its icon larger than Menu and Export, so its lines looked thicker; the sidebar, screenshot and turntable buttons now match.
- ![polish][polish] **The start screen cards show their shortcut on hover.** New scene, Open file and Import show the key only while the pointer is over the card or it has the keyboard focus.
- ![polish][polish] **No tooltip over search and filter fields.** The parts search, the library and materials filters and the search boxes of Settings, Help and Shortcuts say what they are in their placeholder.

## v0.31.0

Released 15 Oct 2026.

v0.30.0 added two alpha features. v0.31.0 is a polish of the interface, and a tidier folder. The icons, the toolbars, the menus and the dropdowns were gone over and now share one look, one speed and one set of tokens; the Export window shows only what most exports need; groups can be locked; Export can put each part's pivot at the part, so Cinema 4D, Blender and Maya show every axis where its part is; and the folder you download is organised like an installed program, with a short top level and the program inside `app`. Because the files moved, an installed copy is offered the full download once.

**A tidier folder**

- ![refactor][refactor] **The download is organised like an installed program.** The top of the folder holds only what you start and read: `start.bat`, `start_hidden.vbs`, `start.command`, `start.ico`, `Install MeshOptimiser.bat`, `README.md` and `LICENSE`, and one folder, `app`. The program (the page, `serve.py`, `vendor`, `assets`, the Python environment, your `inbox` and `exports`) is inside `app`, and its scripts are in `app\js` (`app-v2.js` is `app.js`). Why: the top level had grown past fifty files and folders, and it was hard to see what to double-click. The launchers keep their names, so shortcuts and instructions keep working. The download is named `MeshOptimiser-v0.31.0.zip` and unpacks into one folder with that name; the notes of past releases and the development files (tests, tools, docs) are no longer in it.
- ![refactor][refactor] **Moving from an older version is one full download.** The launcher level is 3, so an installed copy is offered the full download instead of the in-place update. The installer moves your `inbox` and `exports` into `app`, keeps the old loose files in `app\.update\backup-old-layout`, and removes the old Python environment (a moved environment does not work); the first start builds a new one.
- ![polish][polish] **The launcher window draws the name out of a wire mesh,** then shows the version, and every step has a bar that runs while it works. It uses only characters every console font has, so it looks the same in Windows Terminal and in the old console.

**Export**

- ![new][new] **Pivot points.** A part from a STEP file has its origin at 0, 0, 0 with its shape out at its place in the model, so every axis in a file opened in Cinema 4D sat at 0, 0, 0. Export (GLB, glTF, FBX and USDZ) now writes each part around its own centre, with its position on the object; *As in the scene* keeps what the part has. Lines are written the same way.
- ![fix][fix] **FBX objects carry rotation and scale.** The FBX writers put the parts' vertices in place under objects with no rotation, so the axis of a part that is turned in the scene pointed along the world axes. They now write position, rotation and scale on each object, and the turn into Y-up and the unit scale go into the vertices, so a part that is not turned has no rotation in the file. A part with shear or a mirrored part is baked as before. Checked in Cinema 4D 2026 and in three.js, binary and ASCII.
- ![polish][polish] **The Export window shows what most exports need.** The format, the file name with its pieces under it, and *Visible parts only* and *Selected parts only* are in front; the rest (size and position, merge and flatten, format options, check the size) is under *Advanced*, shut until you open it, and it stays as you leave it. The *Where is it going?* buttons are gone: choose the format and its options yourself. The ✕ stays in the corner while you scroll, and the options no longer move sideways when the scroll bar appears.

**Locking**

- ![new][new] **Groups can be locked.** *Lock* in Properties, or *Lock everything inside* on the right-click menu of a group, locks every part in it. A group whose parts are all locked counts as locked and shows a red lock instead of its folder; with only some locked it stays a folder. There is nothing of its own to save.
- ![polish][polish] **A locked part looks like one.** It has a red lock where its type icon is, in the part tree and in Properties; the *Locked* label is a small flat button like the others instead of an amber pill with an emoji.

**Menus and dropdowns**

- ![polish][polish] **One look and one speed.** Right-click menus and dropdowns each have one set of tokens (`--ctx-*` and `--dd-*`: padding, text size, row height, corner, the colour of a row and of the row under the pointer), and every menu and dropdown opens the same way, with the dropdown's own fade and short drop (`--menu-in`, 120 ms) and closes at once. This covers the list of a select, the right-click menus and their submenus, the File and menu-button menus, the view and camera menus, the shape and mode pickers, the popovers for materials, textures and colours, the shortcuts profile menu and the Claude popover.
- ![polish][polish] **The right-click menus of the part tree are shorter.** The menu of a part has 14 entries (was 32) and that of a group 11 (was 21); what is used least is one level in (Visibility, Select, Mesh, Fit, Tree for a part; Group, Order, Expand and collapse for a group).
- ![fix][fix] **Right-click menus flickered when they closed,** because a copy was left behind to fade out and took the opening animation too, and the tool menus above the tree played a second, scripted opening. Both are gone.
- ![fix][fix] **A toolbar button's tooltip no longer shows over a menu that is open.** Tips for the rows inside a menu still show.
- ![fix][fix] **The list beside a row of a right-click menu no longer lies 4 px over the menu it came from;** it stands beside it with a small gap.

**Icons and looks**

- ![polish][polish] **Sharper, brighter icons.** The floating toolbars have 18 px icons with a line of 1.5 device pixels (were 16 px and 1), the other icon buttons 16 px, all from tokens (`--icon-btn`, `--icon-btn-float`, `--icon-line`); the dividers in the floating toolbars are three times as visible, and their icons a notch under white.
- ![fix][fix] **The + and − in the circles of the part tree are in the middle.** The character sat about 2 px low; the circle is 13 px across now and the sign is drawn on its middle pixel, a true cross, and the line from the group above meets the middle of the circle.
- ![polish][polish] **A group is one closed folder** in the part tree and in Properties, which used to differ.
- ![fix][fix] **The cards of the right panel sit on whole pixels.** Their text had line heights of 1.2 to 1.55 times the font, which moved everything under them by fractions of a pixel.
- ![polish][polish] **Shorter words.** The tooltips of the tool row above the tree are the name of the tool, and the Smart optimise card says *Every clean-up in one run.*

## v0.30.0

Released 15 Oct 2026.

v0.29.0 was about big assemblies. v0.30.0 brings two alpha features, both early and both about watching and showing: **Claude mode**, a feed that lets you follow Claude with your model beside it, and **Animate**, which makes parts spin, swing, shake and travel. There are also instance commands, three choices for what Claude may do, a Settings window that looks like one, a rounder look, and a lighter app to drag around.

**Claude mode (alpha)**

- ![new][new] **Claude mode.** The app steps out of the way and a feed shows what Claude does: what it says, every call it makes with what came back, and every picture it takes, newest at the bottom like a chat. Your model sits beside it as a rounded card you can show or hide, with the file, parts, triangles and vertices in the corner. Open it from the start screen, the Claude badge, the command search, or with `?claude` on the address, and the normal app never flashes first. It is an early version, so expect rough edges.
- ![new][new] **The first card of a session is your model.** It shows the picture, the name, type and size, the parts, triangles and vertices, how long it took to open, and a green *Ready for Claude*. The numbers roll up as it lands and the model fades in.
- ![new][new] **Open a model in Claude mode.** The folder button lists *Open file…* and your recent files with a picture, size and age each, the latest marked *Continue*; you can also drop a file on the feed. A model opens in the same view and replaces the one that is open, with no scene tab laid over it.
- ![new][new] **Loading you can follow.** A card floats above the controls with what the app is doing, the step, the percent, the time and a Cancel button. Nothing in the feed moves when it appears.
- ![new][new] **Controls in the feed.** Three buttons copy the command of a ready-made job (Optimise for web, Remove fasteners, Review scene); switches for *Connected* and *Ask before edits*; Undo and Redo; a button that copies the connection command; and Stop while a long job runs. Exit asks first.
- ![new][new] **Claude can write to the feed.** The new tool `say` puts a short message in front of you: what Claude is about to do and what it found. Claude now has 67 tools.
- ![new][new] **Claude's permissions are three choices per kind of change** (Settings › Claude): *Allow*, *Ask first* or *Block*, as a small icon switch. The old switches keep working until you choose.

**Animate (alpha)**

- ![new][new] **Animate.** A new window makes a part or a group spin, swing, shake (noise) or travel along a path (circle, figure of eight, rounded square, wave or line). Spin and path loop, with loop points on a small timeline. A part can carry one layer of each kind, added together; a group moves all its parts about its middle. A playbar plays, pauses, rewinds and scrubs one cycle at 0.25× to 4×, and a pill in the view says *Animate mode*, *Playing* or *Paused*.
- ![new][new] **Animations are a view, not an edit.** They keep running when the window closes; saving a scene and exporting put every part back first; a gizmo press on something animated takes its animation away; the turntable video plays them, each frame at its own time. Open Animate from a right-click on a part, a group or the view, or with Ctrl+K.
- ![new][new] **Claude can say what moves.** The new tool `animate_parts` adds, removes, lists or clears animations by part, name or group.

**Instances**

- ![new][new] **Select all instances, Select the original and Make unique.** Pick every part that shares the exact same geometry, jump to the first of them, or give the selected shared parts a mesh of their own so editing one leaves its copies alone (one undo step). They are in the command search, the … menu and the right-click menus of the tree and the view.
- ![fix][fix] **The × count and the *original* mark on instances were wrong after Make unique or deleting copies.** The count is live now, and the first of its kind keeps the part icon.

**Settings, dialogs and looks**

- ![polish][polish] **Settings looks like a settings window should.** Wider, with the search at the top of the section list, no header and footer bars, bigger rows with a quiet line of help, and group titles in plain type.
- ![polish][polish] **Advanced flatten shows each choice as a small before and after tree,** with a legend, whole cards you can click and shorter help. It is at the top of the Flatten menu, and *Selected groups only* follows the selection while the window is open.
- ![polish][polish] **One title bar for Batch rename, Advanced flatten, Animate, Materials and Library.** Windows, trees and menus open, close and drag more smoothly.
- ![polish][polish] **Rounder corners by default.** Appearance › Corners is now Sharp or Default; a saved Round is Default.
- ![polish][polish] **The Export window lists the formats by name,** and the Export button floats at the bottom right and folds into a round button while you scroll the options.
- ![polish][polish] **The keyboard shortcuts window is in colour:** an icon on each command, a colour for each group, and the keys of the on-screen keyboard tinted by category.
- ![polish][polish] **The start screen puts New scene first,** a converted file is a badge on its card, and the start screen shows a Scania V8 engine drawn in lines (1,295 parts; `tools/build-splash-glb.mjs` bakes one from any GLB).
- ![polish][polish] **The quit dialog has a warning, keeps Don't save apart from Cancel and Save, and focuses Save.**
- ![polish][polish] **The quick colour wheel opens with the part's colour under the pointer.** Move to choose and click the ring to keep it; letting go of C, Esc or a click outside puts the old colour back.
- ![polish][polish] **The seven tree toolbar buttons share the row,** the button of an open menu stays lit and a second press closes its menu. Command-panel buttons turn blue while their card is open, scrubbing a number shows a visible fill, one tick mark is used everywhere, and the view toggles in the Library and Materials windows have a sliding thumb with a clearly lighter selected button.
- ![polish][polish] **The File menu no longer lists Scene settings and Help & docs.** Both are in the command search; Ctrl+; and F1 still open them.

**Faster**

- ![perf][perf] **Dragging and resizing a floating window, the Materials and Library docks and the console happens once per frame,** and the sizes are saved once, when you let go.
- ![perf][perf] **Background checks pause while the tab is hidden,** and the thumbnails in the Materials list are drawn as they scroll into view.
- ![perf][perf] **Backdrop blur is gone from the dialogs, pills, the gizmo HUD and tooltips.** Batch rename draws the first 300 rows of its preview and says how many more it renames by the same rule.

**Fixes**

- ![fix][fix] **A STEP made of faceted breps (a mesh exported from 3ds Max or CAD Exchanger) failed with "no solid bodies found in this STEP" after ten minutes.** The plain reader now meshes the closed shells, so it opens: the 413 MB Mercedes-Benz Arocs, with 645,108 bodies.
- ![fix][fix] **Undo and redo on an exploded view left the parts, the sliders and the pill out of step, and holding Ctrl+Z froze the page.** Undo and redo put an exploded view back together first, and a held Ctrl+Z or Ctrl+Y does one step per press.
- ![fix][fix] **Exploding, deleting a part, putting the view back and undoing the delete brought the part back exploded, with the amount at zero.** A deleted part now moves with the exploded view.
- ![fix][fix] **Dragging a material ball showed the system's copy arrow, which could not be hidden.** The ball itself follows the pointer now, and drops on the view, on the Properties material card, or with Shift on another material to merge.
- ![fix][fix] **Delete and Backspace deleted parts in the view while I was working in the Materials window.** They delete the picked materials there now.
- ![fix][fix] **The Model mode button, and keys 1, 2 and 3, did nothing useful with nothing selected.** The button is greyed and the keys say "Select a part first." Edit mesh is off while the Animate window is open.
- ![fix][fix] **The grid lines in the view were two or three pixels of mush from far away.** They are one crisp pixel now, axis lines included.
- ![fix][fix] **Opening Advanced flatten decided "Selected groups only" once.** It now follows what is selected.
- ![fix][fix] **In the Materials window, Ctrl+C and Ctrl+D copied and duplicated the selected parts, not the material I had picked.** With the Materials window the last thing I clicked in and one material picked, Ctrl+D now duplicates the material, Ctrl+C then Ctrl+V pastes a copy of it, and the parts are left alone.
- ![fix][fix] **In a narrow Library window the 3D preview of the part vanished.** Below 900 px it now stays, between the name and the parameters, and it can be thrown: let go while dragging and it keeps turning a little, then slows down.
- ![fix][fix] **The material cards in the sidebar were cut off inside the well, not at its edge, and sat too far apart.** The strip now reaches the edges of the well (4 px between cards, 6 px round the first one), and Duplicate and Delete moved from the Materials window's header into its side panel with Edit, Select parts and Isolate.
- ![fix][fix] **In Points mode the dots from the far side of a thin part showed through it, most when zoomed out.** A point whose surface looks away from the camera is no longer drawn, and the lift that keeps a dot from being cut by its own surface is smaller, so on a thin plate it no longer reaches through to the other side.

## v0.29.0

Released 14 Oct 2026.

v0.28.0 was about trusting your model. v0.29.0 is about working with big assemblies, and a workspace that looks and moves like a finished app: groups now align, copy and keep their pivots as one piece, windows, menus and the colour wheel move the way they do on macOS, and every edge and every line of an icon sits on a whole pixel, so the picture is sharp.

**Groups behave as one piece**

- ![new][new] **Align parts and Spread work on groups.** A selected group is one item, measured by the box round all its parts, and it moves whole; a group inside another selected group goes with it, loose parts can be lined up beside groups, and a group with a locked part stays where it is. The panel says "items" when groups are in the selection.
- ![fix][fix] **With several groups selected, Copy and Paste put a copy of every part next to its original inside the old group.** Each selected group is now copied as a whole folder, next to its original, the way one group already was. Each group has its own undo step.
- ![fix][fix] **When a part or a group was copied, the pivot of the copy was not where the original's is.** A copied folder keeps its pivot, turn and typed scale, a copied user group keeps its place, and a copied part gets its box from where it stands.
- ![fix][fix] **After copying big groups several times (with Undo in between), the pivot of some copies jumped when they were selected later.** Folder ids come round again after an Undo and a new copy picked up the record an undone one had left; a copy now starts clean and Undo clears its records.
- ![fix][fix] **After moving several groups at once, each kept its old pivot and jumped back to it when picked alone.** The gizmo stored a new origin only when exactly one group was selected; with several, the stored origins are now worked out again from the parts.
- ![fix][fix] **After copying big groups, undoing, redoing and clicking around, a copy appeared in the middle of the scene: drawn, but not in the tree and not pickable.** Undo took the copy out of the scene while the gizmo still held it, and the next click put it back. A removed object is no longer put back.
- ![fix][fix] **A copy of a shape made with Add shape was a plain mesh with no parameter panel.** It stays a shape, with its own kind and parameters and its own geometry, so changing one does not touch the other.

**Windows, menus and motion**

- ![polish][polish] **Windows have a macOS shadow.** A close shadow and a longer one under it, almost all of it below; only the window in front has it, a window behind has none, and the thin outline round windows is gone.
- ![polish][polish] **Windows and dialogs spring open; menus fade out.** A dialog or a floating window opens with a small overshoot and settles; a menu appears at once and fades away in 150 ms (the pill menus, the export menu and the right-click menu). Nothing animates with reduced motion.
- ![polish][polish] **Closing a floating Materials or Library window plays a minimize:** it shrinks toward the middle of the bottom toolbar and fades. Opening it again grows it back from there.
- ![polish][polish] **The view menu opens upward when its button is in the lower half of the window,** so it never runs off the bottom.
- ![polish][polish] **A second click on Collapse, Rename or Flatten closes the menu that the first one opened** (the press closed it and the click opened it again).
- ![polish][polish] **The tool pill: Select is the blue one, the gizmo tools (Move, Rotate, Scale, Dynamic place) show grey when on.** Dynamic place sits beside Measure and Draw lines.
- ![polish][polish] **The Shading angle has moved to the Shading section,** under Outlines. It still acts on the selected parts, and is dimmed when none is selected. The Properties card is one row shorter.
- ![polish][polish] **The grab handle under the selection buttons shows only while they are stuck at the top of the panel.**

**Quick colour wheel**

- ![polish][polish] **A tighter wheel.** The outer ring is a little smaller, the dot is held on the edge of the centre hole while the pointer is inside it, the colour swatches in the readout are circles, the readout sits closer to the ring, and the pointer is hidden while it is over the wheel. It opens and closes faster, and closing draws the wheel back into its middle, the way it grew.
- ![polish][polish] **The wheel clears the view while it is open:** the selection's outline and glow and the gizmo are put away, and come back, drawn for the new colour, when it closes. The dot's outline turns light on dark colours, and the dot follows the brightness as you scroll.
- ![perf][perf] **Picking a colour no longer scans every part on every frame.** Only the colour of each material is set while the pointer moves; the stored colours, names and indexes are brought up to date once, when the colour is kept. Brightness is a filter on the picture, not a redraw.
- ![fix][fix] **After a pick, the material in the sidebar kept its old name and swatch.** It shows the new colour name and swatch as soon as the colour is kept.
- ![fix][fix] **The move gizmo stayed on screen while a level was picked with B (Quick remesh).** It is put away while the picker is open.

**Sharp to the pixel**

- ![polish][polish] **Edges and lines sit on whole device pixels.** Every box that draws something was measured in a browser: the wheel, the dot and the readout, the top bar (its buttons were on half pixels), the tree rows (26 px), the tree toolbar and the selection buttons (whole widths and gaps), the Properties rows (a whole line height), the status bar numbers and buttons (whole widths), the Lock badge and the instance icon. Of 63 groups of elements that were off the grid, none is left at 100 % and two text-width boxes are 0.03 px off at 2x.
- ![polish][polish] **Icon lines are one device pixel thick.** An icon is drawn on a 24 unit grid and was scaled, so a 14 px icon had a line 1.17 px thick and a 16 px one 1.33 px: soft on every screen. The line does not scale now, and is one device pixel (one CSS pixel on a 2x screen). Icons look a little lighter.
- ![polish][polish] **A press dims a button instead of shrinking it.** Toolbar, tree and dialog buttons scaled to 92 % when pressed, and the icon went soft while it moved.

**The Properties panel and Heavy parts**

- ![polish][polish] **Heavy parts: better bars.** Thicker rounded bars on a dark inset track, shaded from a darker start to a lighter end, that grow in from the left when the list is drawn (the heaviest first). The rows touch, rows selected next to each other join into one shape, the text and the bar are centred in the row, and the tick no longer jumps when it is turned on.
- ![polish][polish] **The blocks at the bottom of the Properties card are an even 12 px apart:** the tags, the material card, the selection buttons and the Shading heading.
- ![fix][fix] **The name row of the Properties card changed height when the Lock badge was there, and everything below it moved.** The row is one fixed height, and the badge one fixed size, whatever the name, the badge or the notes in it.

**Materials and Library**

- ![new][new] **Materials window: copy, duplicate, paste and delete.** With the materials window the last one worked in and a material picked, Ctrl+C and Ctrl+D copy and duplicate the material and Ctrl+V pastes a copied one as a new material, not the selected parts. The inspector has Duplicate and Delete buttons.
- ![polish][polish] **A part in the Library view keeps turning a little after you let go,** slowing down (it runs only while it turns). The Library inspector stacks its parts in a narrow dock. The material card and strip reach the edges of the Properties card, and the pop-out and close buttons of a window sit together.

## v0.28.0

Released 14 Oct 2026.

v0.27.1 fixed your pictures. v0.28.0 is about trusting your model: the app now tells you what is wrong with it, turns wrong-way faces round in one tap, shows how a texture is laid out, and keeps the real faces and edges of your CAD file. It is also easier to start: one double-click installs it, and a switch in Settings decides whether it opens with a terminal window or without one.

**See what is wrong, then fix it**

- ![new][new] **Model inspector: everything about the model, and what is broken in it.** One window shows what you have (parts, triangles, size, materials, how much is shared) and lists the heaviest parts. Press *Scan the geometry* and it reads every mesh once and tells you about inside-out parts, faces turned the wrong way, triangles with no area, doubled triangles, holes and cracks, edges shared by three or more triangles, pinched corners, parts in several pieces and needle triangles. Each problem has a *Select* button and, where there is one, a button that opens the tool that fixes it. Open it from the command search (Ctrl+K).
- ![new][new] **Fix normals.** A face that points the wrong way looks dark, or see-through from one side. *Find problems* looks without changing anything and selects the parts that have one. *Reverse* turns the faces of the selected parts round. *Align* makes neighbouring faces agree and points every closed shape outward (a hollow inside a part stays pointing inward, as it should). *Highlight back faces* paints the wrong side red while you look. Everything can be undone with Ctrl+Z, and all of it is in the command search too.
- ![new][new] **UV layout.** See how a part's texture is laid out. The card draws the 0 to 1 square, every island, what covers the same place twice and what lies outside the square, and puts numbers beside it: islands, space used, overlap, collapsed and mirrored triangles, texel density. It follows your selection. Open it from the command search (Ctrl+K).

**Your CAD file, as it was drawn**

- ![new][new] **The true faces and edges of a STEP file.** Open a STEP and a *CAD edges* pill appears in the view. The outlines are the file's own edges, not lines guessed from triangle angles. Switch on *Face info on hover* and the face under the pointer is named (plane, cylinder, cone, sphere, torus and more, with its radius, area and triangles) and tinted blue. *Tangent edges* hides the lines where two faces run smoothly into each other, like the borders of a fillet.
- ![new][new] **Surface parts come along.** Sheet covers, shields and other bodies that are open surfaces with no solid inside used to vanish when a STEP was opened. *Surface parts* in the import window (on by default) keeps them as parts of their own.

**Colour, in a flick**

- ![new][new] **Quick colour wheel.** Hold C over the model, move, let go. The angle is the hue, the distance from the middle is the saturation, the very middle is white, and the scroll wheel sets the brightness. Your selected parts take the colour as you move. Drag far out, or press Esc, to cancel and get the old colour back. It is one undo step.
- ![new][new] **A colour picker built for modelling.** A square or a wheel; HEX, RGB, HSV or HSL, all typeable (the arrow keys step the value); a pipette for the screen, a button that takes the colour of any part you click, a Was / New strip, and rows of recent, scene and preset colours. Ctrl+Z steps back through the colours you picked and leaves the picker open.
- ![new][new] **Edit a material where you see it.** The materials panel now has a colour swatch with its hex, and sliders with number boxes for roughness, metalness and opacity. Each change is its own undo step. Pick several materials and *Merge* (Ctrl+M) shows what the merged one will be before you commit.

**A calmer workspace**

- ![new][new] **One View button.** Solid, Wireframe, X-ray and Heatmap are one button now: a click goes to the next view, and holding it (or a right-click) lists all four with their shortcuts. Model mode has a pill of its own above the tools.
- ![new][new] **Quick choices on the tree toolbar.** Click *Collapse*, *Rename* or *Flatten* to see what they can do in one step: collapse or expand the tree or the selection; rename with a preset such as *Strip _geom suffix*, *Add parent prefix* or *snake_case*; flatten everything, merge groups with one child, or flatten only the deepest level. Move across to the next button with the menu open and it opens at once. The toolbar is icons only, and *Recentre*, *Centre pivot* and *Bake transforms* have moved onto it.
- ![new][new] **The Commands menu knows more.** Four lists beside it, *Select*, *Edit*, *Repair* and *Share*, put copy, paste, ungroup, batch rename, repair mesh, fix normals, screenshot, turntable video, measure and save one step away.
- ![new][new] **A tidier Quick wand.** *Isolate* is on the ring itself, a new *Select* fan holds Select similar, Select same colour, Invert and Show in tree, and the name of the command under your pointer stays in one place.
- ![polish][polish] **Edge to edge.** Properties and Shading sit on the sidebar without a card around them, lined up with the buttons below. A small handle under the selection buttons takes you back to the top, and the version number sits at the bottom of the sidebar.
- ![polish][polish] **Plainer words, calmer motion.** *Reduce* shows what it will do as a figure (2,731,301 → 149,996 triangles, with how many meshes or parts it touches), the clean-up cards use shorter names, and the Edit mesh tool bar and the Batch rename tabs fade and slide instead of snapping.

**Getting started**

- ![new][new] **A one-click installer for Windows.** Double-click *Install MeshOptimiser.bat*: it finds the current version, downloads it with a progress bar, puts it in your user folder and adds MeshOptimiser to the Desktop and the Start menu. Run it again to update; your Python environment, inbox and exports stay as they are.
- ![new][new] **Show a terminal window, if you want one.** *Settings › General › Show a terminal window* decides whether MeshOptimiser opens with the window that holds its log (on) or with no window of its own (off, the default). It applies the next time you start it from its shortcut.

**Fixes**

- ![fix][fix] **Ctrl+Z did nothing for a colour or a slider changed in the material editor until I closed the editor.** Each finished change in the editor is now a step of its own, and Undo records a change that is still pending before it undoes.
- ![fix][fix] **After dragging a slider I had to click somewhere else before Ctrl+Z worked.** Shortcuts now work while a slider, a switch or a button has the focus; the keys such a control uses itself stay with it.
- ![fix][fix] **The command search listed commands as ready that cannot run, and listed the quick colour wheel twice.** It now greys out, with the reason, the commands that need a selection or a model, and the wheel is listed once.
- ![fix][fix] **The bottom corners of the colour square showed a dark rim.** The square is clipped to its rounded shape, so the corners are clean.
- ![fix][fix] **The Was / New strip of the colour picker vanished while I dragged a colour.** It stays on screen during a drag, with room round the words, in dark or light text, whichever reads on the colour.
- ![fix][fix] **Ctrl+Z closed the colour picker.** While the picker is open, Ctrl+Z and Ctrl+Y step through the colours picked in it and the picker stays open.
- ![fix][fix] **I could not undo a change of the light, the exposure, the field of view, the fog or the environment strength.** Each of those sliders now records a step when I let go of it.
- ![fix][fix] **Align did nothing on a part that was inverted all over, and would have turned a cavity wall outward.** A piece with a gap, or one inside another, is now judged as well as a fully closed one.
- ![fix][fix] **The red back-face highlight stayed on some parts after it was switched off, and a first version of it stopped the app drawing.** The tint is now added to the colour once, and it goes away when the switch does.
- ![fix][fix] **Switching Shadows on and off several times quickly lost the viewport.** The clicks now settle for a moment and only the last state is applied.
- ![fix][fix] **Closing the tab or the window with a model open asked nothing.** The warning now appears whenever a model is open (Settings › General › *Warn before closing with a model open*, on by default), not only when there are unsaved changes.
- ![fix][fix] **Points in Edit mesh showed through thin parts from the far side.** Points that face away are not drawn, and the ones in front sit closer to the surface.
- ![fix][fix] **Repair mesh turned only fully closed pieces outward.** A piece with a gap is now turned outward when most of its faces agree, and a hollow inside another part is left pointing inward.

## v0.27.1

Released 14 Oct 2026.

v0.27.0 was about how things look and how they are kept. v0.27.1 is a small fix, and it is about the pictures you take of them: pictures with a transparent background, at last.

**Pictures**

- ![fix][fix] **A picture with a transparent background came out black.** Render image (and Claude's `render_image`) now gives a real see-through PNG when the background is transparent, and a white, light, grey, dark or black background shows its own colour instead of black. I draw the model once on black and once on white and work the see-through part out from the difference, so the edges are clean on any page.

## v0.27.0

Released 14 Oct 2026.

v0.26.0 was about speed and picking. v0.27.0 is about how things look and how they are kept: shadows in the view, car paint that does not look like sandpaper, a Quick remesh that reduces the way a modeller would, scenes that come back as they were saved, and a long list of freezes and lost settings that are gone.

**Shadows and reducing**

- ![new][new] **Shadows in the viewport.** *Scene › Shadows* makes the sun cast shadows: the parts fall on each other, and the model casts a soft shadow on the floor, which is the plane of the grid. The floor shadow is the model's outline as seen from the sun, laid on the floor along the sun's rays, so it falls away from the sun and follows the Sun gizmo; it is blurrier and fainter the higher the model stands above the floor. The switch is part of a saved scene.
- ![new][new] **Quick remesh (B) reduces the way a modeller does it in Blender.** The flat faces are joined and cut with the fewest triangles first (*Planar*), and at the strong levels the points on faces that are flat to a few degrees go; then every second line of a ring grid is taken away (*Un-Subdivide*: a cylinder or a bellows with 100 lines keeps 50, then 25, as quads that are twice as wide, with no fan); then the simplifier takes what is still over the level; then the flat faces are cut evenly again (*Beautify*). On the Front Axle 8x8 the Un-Subdivide step alone takes 21 % of the triangles of its parts away within a tolerance of 0.2 to 1.5 % of each part's size (35 to 44 % on the round ones).
- ![fix][fix] **Quick remesh and Decimate reduce an OBJ.** An OBJ or an STL has no shared points, and an OBJ without normals gets the flat normal of each face, so nothing could be joined and nothing was taken away. The weld now leaves flat normals out and the reduced mesh gets the usual 30 degree shading back, with its UVs.
- ![fix][fix] **Closing Quick remesh in the middle of its work no longer freezes the page.** With every part selected it queued a reduction of each part at several levels, and closing it left every waiting job to run. They give way now.
- ![fix][fix] **Remove holes closes a ring groove round a flat island** (an O-ring seat, a circle cut into a cap): it was skipped as over the size limit because the limit was checked against the ring's outer diameter; the width of the groove is checked now, and the island goes with it. A shallow groove with flush parts in it is no longer taken for something standing on the face.
- ![polish][polish] **The Exploded view sliders move one percent at a time, not five.**

**Scenes that come back as they were**

- ![fix][fix] **A saved scene appears in Recent.** Only opened files were listed. The saved file now leads the list, takes the place of the card it was opened from (the STEP of the same name) with its picture, says *Scene*, and opens from there after a reload.
- ![fix][fix] **A saved scene keeps the look of its materials.** Metalness, roughness, glow, see-through and texture maps came back as 0.15 / 0.55: every file's materials were replaced by one made from the colour alone. A file saved by the app now keeps its own, also for the copies of a shape that repeat 32 times or more. A paint's colour is saved as the material has it, not as the part was first opened, so a Flip-flop Violet body no longer comes back grey.
- ![fix][fix] **A saved scene keeps more of the scene.** The unit the sizes are shown in, the grid cell, the lights and the shadows, the scale and the up axis of the scene, locked parts and the explode amount did not come back; they do now. The parts of an exploded view were written where the view had put them, so after opening the file nothing could put them back together; they are written together and the amount is saved.

**Selecting, moving and pasting**

- ![new][new] **Change pivot orientation.** *Edit › Change pivot orientation…* turns the pivot of every selected part to World, Last selected, View or Spread, or to X, Y and Z degrees you type, and turns the vertices the other way so that the part looks exactly as it did. The gizmo's axes list has the same choices, and a Gizmo card under Transform sets any angle. One undo step.
- ![new][new] **Hide and Isolate are switches.** The buttons of the selection bar are lit while they apply, and the same click (or *H*) undoes them.
- ![new][new] **A group of the model's own tree pastes as one new group.** Copy a folder and paste it: the whole folder comes back as "Name copy" with the folders and parts inside it, next to the original; one undo takes it away.
- ![fix][fix] **The gizmo no longer sits off the part after a pivot turn or an undo.** The box of a part counted the edge outlines drawn on it, which are stale at that moment.
- ![polish][polish] **Every part of a big selection gets its own outline.** A selection of thousands of parts was mostly drawn as boxes.

**Materials**

- ![new][new] **Car paint presets.** Metallic Silver, Pearl White, Candy Red, two Flip-flops, Glitter Gold and Black Pearl: glossy paint with a faint shimmer of flakes; the pearls and flip-flops change colour with the angle (thin-film iridescence). They export to GLB. The flake map is smooth and large, not a hard grain: a first version put a random, steep normal on every texel, which looked like sandpaper and flickered in a highlight.
- ![new][new] **Keep texture coordinates** is a switch of the import window for meshes: a texture given to a material later shows on a model that came without one. Merging parts and exporting keep the UVs too.
- ![fix][fix] **White lettering under a dark colour.** A colour map is multiplied by the material's colour; the colour goes to white while a map is on and comes back when the map is taken off.
- ![fix][fix] **A file written with a leftover "transparent" flag no longer opens as patchwork.** A fully opaque material flagged transparent was written as BLEND, which other programs draw without depth.

**The look of the app**

- ![polish][polish] **A slimmer loading card.** 540 px instead of the whole start window, no start-screen header, one line for the file name, a thin bar, the steps as a quiet list, the log folded under *Details*, and *Copy log* and *Cancel* as plain text. A STEP read shows its time against an estimate ("22s of about 55s") and the bar moves by it.
- ![new][new] **Settings › Performance › Memory.** What the page holds: the script heap, the geometry of the open models, and what Undo keeps alive.
- ![polish][polish] **Settings groups are cards** with a fold arrow and jump chips.
- ![polish][polish] **Two more typefaces in Appearance:** Geist and Space Grotesk.
- ![polish][polish] **A little more light in the studio**, so dark parts read better.

**Memory, speed and freezes**

- ![fix][fix] **Ctrl+C copies the text that is selected.** With any part selected (and parts stay selected after assigning or merging materials) the app took Ctrl+C for itself, so nothing selected as text ever reached the clipboard.
- ![fix][fix] **Remove holes, Ctrl+Z, Remove holes… no longer runs the page out of memory.** The geometry that Decimate, Quick remesh, Untriangulate and the shading angle make was never freed (its names were not recognised, and the clean-up was put off by every quick action). It is freed once nothing in Undo or Redo holds it.
- ![fix][fix] **Undo and Redo wait while a long step is running,** instead of undoing an earlier step underneath it.
- ![fix][fix] **The recovery copy waits until you stop working,** and no spare copy of the app is started beside a model of over a million triangles.
- ![perf][perf] **The Wireframe view is prepared in the background,** so the first switch to it is quicker.

## v0.26.0

Released 13 Oct 2026.

v0.25.0 gave you more to build with. v0.26.0 is about speed and weight, and about picking: Box and Brush now select whole parts, big files open without freezing the page, opening the same STEP again takes no time, and the app gives memory back.

**Selecting parts**

- ![new][new] **Box and Brush select whole parts.** In Model mode the selection tool has the same three choices as the Edit mesh bar: *Click*, *Box* (a plain left drag draws the marquee) and *Brush* (a left drag paints, and every part under the circle is picked). Shift adds to what is picked; otherwise a stroke starts from nothing. Alt + drag turns the camera in every tool, and the middle button dragged sets the brush size (right bigger, left smaller). A part counts as touched only when one of its own triangles is under the box or circle, not its bounding box.
- ![new][new] **One selection-tool button in the left toolbar.** It shows the tool in use and a menu: let go over a row and that tool is picked, let go on the button and the list stays open for a click. With Edit mesh on it picks pieces, otherwise whole parts.
- ![new][new] **The list points at the view.** Hovering a row of the part list lights the part in the view (the other way round does nothing). Switch it off in Settings › Viewport.
- ![polish][polish] **Delete small parts: Isolate is a switch.** *Isolate* now shows only the parts that would be deleted, so they can be checked first, and pressing it again shows everything (it replaces *Show all*). *Highlight*, which colours those parts in the view and the tree, moved onto the card.
- ![polish][polish] **The Transform toggle sits with the part tree's buttons.**

**Drawing**

- ![perf][perf] **A selection draws at once.** Finding the edges of a part took about a second for 125,000 triangles, inside the click. Now the click draws immediately (cached edges where there are, small parts built inline within a few milliseconds, a bounding box for anything else) and the missing edges are worked out on a worker and swapped in when ready.
- ![fix][fix] **A curved surface is not drawn as a bundle of lines.** A coarsely tessellated curve (the wire of a spring with eight sides) has facets that meet at a modest angle. Edges the mesh itself shades as smooth and that turn by no more than 60 degrees are facets, not features; a ring of patches that turns once round is a smooth surface and keeps one line. A chamfer or bevel is not a ring and keeps its lines. A triangle with no area is no feature.
- ![perf][perf] **The wireframe follows moved points.** When the points of a surface move and its triangles do not, the lines are sent to the graphics card again at once (at most every 120 ms) instead of being rebuilt.
- ![perf][perf] **The view cube redraws only when the camera turns.** A hover or a selection no longer redraws it.
- ![fix][fix] **A frame that failed is asked for again,** so a passing failure does not leave a stale or blank picture until something else redraws.
- ![fix][fix] **The start screen no longer hides a newly opened tab.** It used to stay up over the scene, with the new tab opening behind it.

**Look**

- ![polish][polish] **The command cards open with a line drawing, not a video clip.** Remove holes, Split, Select hidden, Fasteners and Smart fit show a thin-stroke drawing of what the tool does, in two greys and the accent colour, that moves only while the card is open.
- ![polish][polish] **One look for the controls.** New colour steps and tokens for sliders (a white thumb that grows under the pointer and takes a soft halo while held; the filled part of every range input is drawn by CSS from its value, wherever it was set), scrollbars, number fields (a context sets only what differs), transitions, the part tree's search, the menu rows and the context menu.

**Memory and speed**

- ![perf][perf] **Geometry nothing needs any more is freed.** Decimate, Budget, Repair and Remesh keep the old geometry for Undo. When the Undo (or Redo) step that held it fell off the end of the history, nothing released it: on a large scene every earlier full-size copy stayed in memory and on the graphics card until the model was cleared. A check now finds geometry that no part, group or history step can reach and frees it (only after it has been unreachable twice in a row, a few seconds apart).
- ![perf][perf] **A deleted part gives its memory back.** Once the Delete step has fallen off the end of the history the part cannot come back, so its own geometry is released. Geometry that a live part shares stays.
- ![perf][perf] **Large GLB, glTF, OBJ and FBX files no longer freeze the page while they are read.** The loop over the file's meshes now hands control back every so often and shows how many parts are done, as the STEP path already did. It does so only while the window is in front.
- ![perf][perf] **Opening the same STEP again is instant.** The converted model is kept in `inbox/cache/`, keyed by the file's content, the import settings and the converter itself, so a new release or another setting never gets an old answer. The cache holds 3 GB at most and drops the oldest first.
- ![perf][perf] **Two conversions at a time.** More wait as queued (Cancel still works), so two big STEP files do not fight over memory and cores. `MESHOPT_CONVERT_JOBS` changes the number.
- ![perf][perf] **Repair mesh runs in the background.** A large part took seconds on the page; it now goes to a worker (and stays on the page when no worker is available).
- ![perf][perf] **The idle timers rest.** The counters behind the Decimate and Budget cards and the selection watchers do nothing while the window is in the background, and the Decimate one nothing while its card is closed.
- ![perf][perf] **FBX, 3MF and USDZ code is loaded when needed.** About 160 KB less to read at start; opening or exporting one of those formats loads it then.

**Repair, Remove holes and the converter**

- ![fix][fix] **Repair mesh welds a model far from the origin correctly.** The weld cells were counted from the origin and could wrap around for a model millions of units away; they are now counted from the corner of its box.
- ![perf][perf] **Repair mesh uses numbers, not text, for doubled triangles, and sorts material groups in one pass.** 200,000 triangles take about 200 ms; a mesh with many materials no longer slows down with every group.
- ![perf][perf] **Remove holes handles larger meshes.** The edge table is a typed one now and the limit is 12 million triangles (it was about 5.6 million).
- ![perf][perf] **Keeping hard edges while decimating** looks up the vertices at one place with numbers instead of a text per vertex.
- ![fix][fix] **The inbox is cleaned every hour**, not only when the server starts, a cancelled or failed conversion no longer leaves its half-written file, and an upload is refused with a clear message when the disk cannot hold it. A client that stops sending is dropped after five minutes.
- ![polish][polish] **The installed app falls back to a normal window** where the browser has no window-controls overlay.

## v0.25.0

Released 13 Oct 2026.

v0.24.0 let you into the mesh. v0.25.0 gives you more to build with and a better way to line it all up: 26 new library parts on eight shelves, an Align parts panel, a Transform panel that works on several parts at once, a tree search that forgives a typo, and a command search you can move out of the way.

**Library**

- ![new][new] **26 new parts, and two new shelves.** The library has 112 parts on eight shelves now, up from 86 on six. *Fasteners* gain Flange bolt, Clevis pin, Wood screw and Thumb screw. *Machine parts* gain Thrust bearing, Flanged bearing, Roller bearing, Stepped shaft, Shaft coupler, Timing pulley (GT2, 10 to 80 teeth) and Rail carriage. *Profiles and plates* gains Strut channel. The new *Electronics* shelf holds Axial fan, Heatsink, Pin header, Circuit board and Micro servo. The new *Brackets and connectors* shelf holds Angle bracket, T-slot bracket, Three-way corner, Joining plate, Shelf bracket, Joist hanger, Post base, Column base plate and Pipe clamp. Each has a picture of its own.
- ![new][new] **Bake geo.** A library shape's properties have a new button that turns the shape into an ordinary mesh: the shape's parameters go and the mesh tools work on it. Ctrl+Z gives the parameters back. The button is off while the part is locked. Edit mesh skips shapes that are still parametric and says *Bake geo first*.

**Parts and layout**

- ![new][new] **Align parts.** A new card, found by the search as *Align and spread parts…* and as a slice of the Quick wand (no default key). *Align to* has three choices: the selection, the last part picked, or the origin. For X, Y and Z there are three Align buttons (low sides, middles, high sides) and two Spread buttons (middles evenly apart, equal gaps). A *Gap* field sets a fixed gap, counted from the lowest part; empty means even. Parts are measured by their box in the scene. Each press is one undo step, locked parts stay where they are, and Explode is put back first. Spread needs three parts (two when a gap is typed), Align needs two or the origin. A line under the buttons says what moved.
- ![new][new] **The Transform panel works on several parts.** The nine fields used to be closed once a second part was picked. Now a field shows the number when every selected part has it, and *mixed* when they differ. A number typed in goes to each part on its own, about its own origin, and the other eight numbers of every part stay as they were. One undo step. Locked parts, shared (instanced) copies and parts with no thickness along an axis are skipped, and a toast lists what stayed. Above 400 parts the fields just say *mixed*. The Scale switch is respected.
- ![polish][polish] **The gizmo keeps its turn.** With several parts selected that are all turned the same way, the gizmo now keeps that orientation. It used to snap to the scene's axes as soon as a second part was picked.

**Search**

- ![new][new] **Move the search.** Hold the search icon and drag, and the card goes where you want it. Drag its right edge to change the width (at least 320 px). The place and the width are remembered, also after you close it and the next time you open the app. Double-click the icon to put it back in the middle at its own width.
- ![new][new] **The part tree's search reads more.** Several words all have to match, in any order. Case, accents and the marks `_` `-` `.` are ignored, and so are the joins of camelCase, so `gearbox` finds Gear_Box. `"two words"` in quotes matches as written, a comma means or, and `-word` leaves a word out. `>5000` and `<200` filter by triangles, and `5k` and `1.2m` work. `is:hidden`, `is:visible` and `is:selected` filter by state. When nothing is found at all, it tries again forgivingly: one wrong, missing, extra or swapped letter in a word of four letters or more, two in a word of eight or more. `braket` finds Bracket. Groups match by name only.

**Edit mesh**

- ![polish][polish] **The Edit mesh tools are a bar at the right of the view.** The card is gone. A vertical icon bar holds Click, Box and Brush, World, Local and Normal, Loops, Planarize, Straighten, Weld, Fill, Reverse normals, Dissolve and Extract. The icons are one calm colour, and the tool you are using is lit. The left toolbar shows Points, Edges and Polygons as three buttons, and the mode button goes back to Model. Weld has a small card of its own (*Join within* and a Weld button). Key tips show at the bottom right of the view.
- ![polish][polish] **Box pick is live.** The selection follows the box while you drag, pieces the box lets go of are let go, and the history gets one entry when you release. The gizmo is put away during the drag. Changing tool or losing the pointer in the middle cancels the box and gives back what was picked.

**Around the app**

- ![polish][polish] **Long messages scroll like a banner.** A toast too long for its width waits a moment, slides to the end, rests, and stays until it has been read. With reduced motion it wraps onto more lines and stays at least five seconds.
- ![polish][polish] **A slimmer Quick remesh column.** 52 px wide, with 13 px numbers and no % sign (a screen reader still says *N percent*).

**Fixes**

- ![fix][fix] **Frame selected from an orthographic camera** framed nothing and put the camera inside the model. It now fits the box by its half-height.
- ![fix][fix] **Wireframe lines of a thin part's far side showed through the near side** when seen from far away. Fixed in the Wireframe view and for the points in Edit mesh, by lifting only faces that look at the camera.
- ![fix][fix] **Edit mesh edges that run past the camera vanished** in a very close view. They are cut at the near plane and still drawn.
- ![fix][fix] **Quick remesh could ruin a small part.** A result that loses more than 40 % of the surface, or 10 % of the diagonal, is refused and the part takes the next gentler level (a 100-triangle bolt was left with a quarter of its surface at 25 %). A level you are keeping can no longer be changed by a hand still moving.
- ![fix][fix] **Dragging the size of a heavy shape** (over 12,000 triangles) is smoother: the outline is hidden until you let go. Lighter shapes keep it live.
- ![fix][fix] **The start fade:** a sidebar folded to a lower opacity now fades to its own opacity, not to 1, and the first tab's parts fade in again when you switch back to it.

## v0.24.0

Released 12 Oct 2026.

v0.23.0 cleaned a mesh up as a whole. v0.24.0 lets you into it: an Edit mesh mode with points, edges and polygons, as in Cinema 4D, with the tools to pick, move, delete, dissolve, weld and fill them. The shortcuts window became a picture of the keyboard where every key can be changed and kept in a profile, Untriangulate takes away more of the points that say nothing about the shape, and the app starts faster.

**Edit mesh**

- ![new][new] **Edit mesh: points, edges and polygons, as in Cinema 4D.** A mode button at the top of the left toolbar: Points, Edges, Polygons, and Model, which is the app as it was (a click selects a part). A click on it goes in and out of the last piece mode, holding it lists all four. In a piece mode the selected parts, and only they, show their mesh lines in blue (polygons, not triangles: two triangles that make a four-sided shape are one polygon, as a cell of a grid or a strip of a tube wall is, and a triangle with no such partner is one of its own), and the left button picks pieces of them: picked ones are orange, the one under the pointer is light, and every point of the part is shown in Points mode. Three tools in the *Edit mesh* panel: **Click** (Shift adds, Ctrl takes away, a click beside the model clears, a double-click or *Pick loops* picks a loop, and with *Pick loops* on the loop is lit under the pointer before the click), **Box** (drag a rectangle: what lies in it whole and can be seen) and **Brush** (paint; Alt + drag turns the view with both). A loop of polygons runs across four-sided polygons like a ring round a tube, and is the whole face where they are not four-sided; a loop of edges is the outline of a face on a sharp or open edge and the row on a smooth one. `Ctrl+A` takes all, `Ctrl+Z` takes back the last change of what is picked.
- ![new][new] **Move, turn, scale, delete and reverse the picked pieces.** The gizmo (`E`, `R`, `T`, Shift to snap) sits in the middle of what is picked and moves the points the pieces stand on, so everything that uses them follows; letting go is one undo step and the pieces stay picked. In the Wireframe view the part keeps one set of lines while its pieces are worked on, and they follow the move. `Del` takes them out (a point or an edge takes every polygon that uses it; a part is never emptied this way), and *Reverse normals* turns picked polygons round. After an undo of any of these the pieces are picked again. The rules are a module of their own (`meshedit.js`, `tests/meshedit.test.mjs`) and there is a self-test in the app.
- ![new][new] **Edit mesh: Dissolve, Planarize, Straighten, Weld, Fill and Extract.** Six more buttons in the *Edit mesh* panel, one undo step each. **Dissolve** (`Ctrl+Backspace`) takes the picked points out and closes the surface over them; for picked edges and polygons the polygons become one, and the points left inside them or on a straight line of their outline go, so the shape does not change there. **Planarize** moves the points of the picked polygons onto the best-fit plane of each (a polygon that would have to bend a long way is left). **Straighten** moves the points along a picked line of edges onto the straight line between its two ends. **Weld** makes the picked points one, at their middle (with a distance, the points that are that close become one each; picked edges collapse to a point). **Fill** closes a hole whose whole rim is picked, with a cap that has points of its own so it shades on its own. **Extract** takes the picked polygons out into a part of their own, in the same place and with the same material. The rules are modules of their own (`dissolve.js`, `meshtools.js`) with tests in Node.
- ![polish][polish] **`1` `2` `3` `4` pick the mode.** Points, Edges, Polygons, Model. The view modes these keys were (Solid, Wireframe, X-ray, Heatmap) are on `Alt+1` to `Alt+4`.
- ![new][new] **The quads and n-gons of an OBJ or FBX file are remembered.** The loaders split every face into triangles; each triangle now carries the number of the face it came from, so the polygons of the file are known afterwards.
- ![fix][fix] **Edit mesh: a press on the gizmo is not a move.** Clicking a handle without dragging put an empty "Move" step in the history. Leaving the mode in the middle of a drag now finishes the move as one undo step instead of keeping it with no way back, and undoing a move picks the same pieces again.
- ![fix][fix] **Edit mesh: Delete keeps the polygons of what stays, and Reverse normals no longer grows the mesh.** After a delete the remaining faces were guessed again from their triangles; turning faces round left their old corners behind each time.
- ![polish][polish] **Edit mesh: the pointer is stricter.** The brush shows no single piece under the pointer; a stroke or a box ends when the button is no longer down or the pointer is lost; and with the Click tool a point is taken only within 16 px of the pointer, an edge within 12 px.
- ![new][new] **The gizmo's axes: World or Local.** Hold or right-click Move, Rotate or Scale on the toolbar for the list. In Edit mesh the same list also has Normal.

**Remesh**

- ![new][new] **Untriangulate: Points on straight lines, and Dissolve nearly flat within.** *Points on straight lines* also takes away the points that only sit on a straight line of a face's outline (a long edge cut into pieces); they go from every face that touches them at once, so nothing cracks and the shape does not change. *Dissolve nearly flat within* is a limited dissolve for faces that are only nearly flat (a panel with a little noise or a gentle bend): a point that is left goes if the triangles round it turn from each other by less than the angle and the surface moves by less than *Surface may move*. 0 turns it off.
- ![new][new] **Quick remesh (`B`).** A column of keep-levels opens under the pointer with a live preview; the level is taken on letting go of the mouse, on Enter or on letting go of a held `B`, as one undo step. The levels are how many triangles stay.
- ![perf][perf] **Wireframe, Quads: big parts no longer freeze the page.** Above 20,000 triangles the four-sided cells of a part are found in a worker, as Polygons always were (about 240 ms per 250,000 triangles used to run on the page).

**Around the app**

- ![new][new] **The shortcuts window shows the keyboard, and every key can be changed.** A picture of the keyboard sits beside the list: the keys that do something are lit and carry the command's name, and holding Ctrl, Shift or Alt (or clicking them in the picture) shows the keys of that combination, with the list dimmed to match and the mouse gestures for the same keys under it. Pressing any combination names what it does; a click on a key lists everything on it. A shortcut in the list is a button: click it and press the new keys. A combination that is taken warns with the command that has it and offers Replace, and the ones the browser keeps for itself (Ctrl+W, F5…) are refused. *All commands* lists the commands that have no key so they can be given one. Changes are kept in named profiles (new, duplicate, rename, delete, put every key back) in this browser; Default is the app's own keys and cannot be changed, so the first change starts a profile. Esc, the Quick wand's W and the mouse gestures are fixed. The command search, the tooltips and the right-click menu show the changed keys (a command left without a key shows none); the keys written in the app menu and the toolbar's lists are still the default ones.
- ![new][new] **Transform panel: a Scale switch, and a group can be scaled.** The switch beside Reset turns the third column into a scale factor (also for instanced copies). A scale typed for a group of the tree now scales its parts (it only changed the number before), with undo, and Reset takes it back. Tab goes down each column, and the number stays clear of the + button.
- ![fix][fix] **After a big change of scale the view follows.** The far plane and the grid are fitted again, the near plane follows the parts' boxes, and a part's box is measured again after an edit in the panel or a drag of the gizmo (parts were hidden as too small while the camera moved).
- ![polish][polish] **Settings › Appearance uses the app's own colour picker, and steps aside while you drag.** The "any colour" swatch opens the picker instead of the browser's, and while you drag in the colour square or on the hue slider the Settings window and its tint disappear and only the square (or the slider) stays, so you see the colour on the real interface. Esc goes back to the accent you had.
- ![new][new] **Claude's screenshots can fill the picture.** Ask for a screenshot of a result and Claude can frame it on the whole model or on the selected parts: the picture is fitted edge to edge on the geometry itself, the move handles are left out, and your own camera is put back afterwards. A plain screenshot is still the view exactly as it is.
- ![perf][perf] **A faster start.** The browser keeps the app's files and asks the server each time whether one changed (a 304 with no body when it has not), so an edit still shows on reload, three.js and the rest are not downloaded on every start, and the compiled code of the app script can be kept. The server's own answers (`/api/…`, `/mcp`) are never kept. three.js and what the app imports from it are fetched at once instead of one step at a time.
- ![fix][fix] **Alt+1 to Alt+4 work on a Mac.** The view-mode keys are read by their place on the keyboard, since Option+1 types another character there.
- ![refactor][refactor] **Four self-tests follow changes they had fallen behind.** Geometry tools centres the pivot of the torus (Recentre moves only the selected part now, so the cylinder was centred already); group dots switches *Show origin points* on first; heavy parts gives its four parts more than 10,000 triangles each, since the card lists only those; and gizmo snap expects the Snap pill only while a handle is dragged with Shift held. The app itself is unchanged, and the suite passes in full.

## v0.23.0

Released 12 Oct 2026.

v0.22.0 was about letting something else do the work. v0.23.0 goes back to the mesh itself: how a CAD file becomes triangles when it is opened, and the tools that clean a mesh up afterwards. Fill holes is now Remove holes and closes far more of what it used to leave, and it is joined by Remove floating pieces, a Remesh panel and a Split that works by faces. Around them, the search looks through Settings and forgives a slip of the finger, and Materials and Library can float over the view.

**Opening CAD files**

- ![new][new] **Tessellation settings when a STEP, IGES or BREP file is opened.** The import window has a Tessellation block under Surface quality: the sag (how far a triangle may stand off the surface, in mm), the angle (how far a curve may turn per triangle) and the smallest edge allowed. The four presets set the first two, and typing your own numbers selects Custom. *By part size* gives small, medium and large parts a sag and an angle each, split at two shares of the model's size, so the housing comes in fine and the screws coarse. On the command line: `--tiers`, `--min-edge`, and `--angular` as before.
- ![new][new] **Smooth shading from the CAD surfaces.** The converter now writes the normals of the real surfaces into the GLB. A fillet runs into the faces beside it without a visible seam, and a cylinder made of two half faces no longer shows the join. Sharp edges stay sharp. On by default (*Smooth shading* in the import window, `--no-normals` on the command line).
- ![new][new] **Swap Y and Z on import**, for a file that comes in lying on its side (`--swap-yz`).
- ![polish][polish] **A missing converter package says what to do.** When a STEP conversion fails because a Python package is not installed, the log and the notice name the package and the command that installs it (`python -m pip install -r requirements.txt`) instead of pointing at a traceback.
- ![fix][fix] **The Drop small parts field in the import window could not be seen.** The style of the switches hid it and stretched it over its row; it is a visible number field again.
- ![fix][fix] **A changed angle did not count as a changed setting.** The converter's record of what a GLB was made with left the angular deflection out, so a re-run with another `--angular` handed back the old file. The finer presets (Fine, Ultra) now also tighten the angle (20° and 12°), which is what rounds small holes; the sag alone could not.
- ![perf][perf] **The mesher ran over every face twice** (the constructor already does the work; `Perform()` was called again after it).

**Remove holes**

- ![new][new] **Fill holes is now called Remove holes** (panel, toolbar, search, Help and the knowledge base). It also takes out the loose walls a broken file leaves floating where a hole was (a cut-loose tube or cup, small next to its part, never more than a third of a part), and closes the opening they sat in.
- ![new][new] **Surface may move** in the advanced options of Remove holes (0.5 mm by default). After a hole is closed, a vertex of the flat face round it that is a little off the plane of the face, as on a gently curved panel, may still go if the surface moves no more than this, and never more than 1% of the part's size. With 0 only vertices exactly in the plane go.
- ![fix][fix] **Remove holes no longer leaves the ring of vertices behind.** A closed hole used to keep the vertices of its rim in the middle of the flat face, with long triangles fanning out from each. Remove holes now takes every rim vertex that has only flat triangles round it out and triangulates the ring they leave (same outline, same area, no cracks), including on faces Untriangulate could not join. Press Remove holes again and, with *Remove vertices left over* on, it cleans the same way what an earlier run left behind, also on parts in n-gons, and says so even when no hole is left to close.
- ![fix][fix] **Remove holes found the same hole again and again.** A hole whose wall was wound the wrong way round, or whose rim edge was doubled, was capped without its wall being removed, so every click added another cap on top. Those walls are now found and taken out with the hole, and a second click finds nothing more.
- ![fix][fix] **Remove holes closes more of what it used to leave.** A hole through a sheet with one face wound the wrong way round was taken for a raised feature; the far opening of a countersink may be up to five times the limit; and with *Close openings into hollow spaces* on, an opening that leads into a cavity is sealed flush from outside. The toolbar icon of Remesh is now a grid.
- ![fix][fix] **Remove holes gave up on a whole face when two openings met at one point.** Where two holes touch at a corner, or a hole touches the edge of its face (broken and decimated meshes are full of this), the outline of the face passes one point twice. The face was skipped and none of its holes were closed. The outline is now followed round the triangles and split into its separate loops. On a 494-part test assembly with 138 broken parts this closes about 240 more holes at a 30 mm limit.
- ![fix][fix] **Tidy could delete a small piece whose hole had just been closed.** In a part made of several pieces (after Merge), a spacer or a bush with its bore capped looked like a loose hole wall and was taken out, leaving its two caps hanging in the air. A closed piece whose flat faces had just been tidied could go the same way. A piece that carries a cap is never a loose wall now.
- ![polish][polish] **Remove holes shows in the status bar's Tasks list while it runs** (not when it is a step of something that already has the loader up: that task is listed as it is).

**Mesh tools**

- ![new][new] **Remove floating pieces.** A part is usually one piece, but CAD exports and closed holes leave small loose ones next to it: the plug a hole was cut with, a shaving, a dot of a thread. The new panel (Quick fixes, or the search) deletes the pieces that touch nothing and are no longer than *Piece size up to* (5 mm by default); *Keep if over* spares a piece with more triangles than you set. The biggest piece of a part always stays. It works on the selection, or on every visible part when nothing is selected, in one undo step.
- ![new][new] **Remesh: Untriangulate and Triangulate in one panel.** A button on the bottom toolbar opens it; one pill picks the action and its settings show under it. Untriangulate has *Flat faces within* (1° by default), *Even triangles*, *Flatten shading on flat faces*, a *Shading tolerance* and *Surface may move*. Triangulate is the way back: the flat faces stop being polygons, and *Even out the triangles* turns the edges inside each flat face without adding or taking away a vertex. `U` and `Shift+U` run the two on the selection only, so a key never changes the whole scene by accident. A part that has been through Untriangulate draws its polygons and a part that has been through Triangulate its triangles, whatever the Lines setting is. Untriangulate repeats until nothing more goes (joining faces makes bigger faces, and a vertex that was on the edge between two is then in the middle of one). The Untriangulate button left the Reduce triangles card.
- ![new][new] **Split by faces, and a smallest part.** Split has a new method, *Faces (split at creases)*: triangles that share an edge and lie within the *Face angle* of each other (20° by default) stay together and every crease starts another part, so a flat face or a smooth curved one comes out as one part. *Smallest part*, for every method, puts the pieces under a number of triangles together into one more part instead of a part each. The weld tolerance is on the panel itself, not under Advanced.
- ![perf][perf] **Split was rewritten** as a module of its own (`split.js`) that works on typed arrays in time linear in the triangles, and is tested in Node (`tests/split.test.mjs`). The pieces of a split part stay in every group the part was a member of.

**The search**

- ![new][new] **The search looks through Settings.** The rows of the Settings window are found by name; choosing one opens the window at its pane and takes the eye to the row. A mark of `#` in front lists settings only. A switch that is a state of the app (a setting, or a switch in the sidebars and the command cards) is drawn in its result and turned there: Enter, a click or the switch itself turns it and the search stays open; `Shift+Enter` goes to it instead. The options of a tool stay ordinary results that take you to them.
- ![new][new] **The search reads what is typed more loosely.** Words in any order; another word for the same thing ("remove" finds Delete, "bolts" finds Fasteners, "picture" finds Screenshot); one slip of the finger (a letter wrong, missing, one too many, or two the wrong way round); and two to five letters as initials ("rh" finds Remove holes). The better the fit, the higher the command stands, and among commands that fit about as well the ones run lately stand higher. A mark in front narrows it: `>` commands, `@` parts, `+` library parts. When several parts carry what was typed in their name, one row selects them all (hidden parts are left out). The grid command reads Show or Hide ground grid and is found by both.
- ![polish][polish] **A command that cannot run now is greyed out in the search, with the reason** (Select a part first, Open a model first, Nothing to undo). A command that works on the selection, or on every part when nothing is selected, needs only a model. Each kind of result has a colour of its own on its icon: commands by their group, parts, library parts, settings, answers.
- ![new][new] **Settings › Search.** A new pane: what the search looks through (Sidebar controls, Parts of the scene, Library parts, Sums and lengths, Settings), *Switches in the results*, *Other words for the same thing*, *Forgive a slip of the finger*, *Initials*, *Coloured icons*, *What you used lately comes first*, *How many results* (Few, Normal, Many) and a button that forgets the recent commands.
- ![fix][fix] **The search, Settings and Keyboard shortcuts kept the keyboard after they were closed.** The field of a window that had only faded out still had the focus, so every key went into a field nobody could see and the app's shortcuts did nothing (`Shift+C` did not open the search a second time).

**Materials, the docks and the library**

- ![new][new] **Materials and Library pop out as floating windows.** A button in the head of each dock turns it into a window over the view: drag it by its head, resize it by any edge or corner. Where it was left, and whether it floats, is kept in this browser. A floating dock does not push the toolbar up or close the other dock, so both can be open side by side. With several windows open, only the one that was pressed or typed in last keeps its thin edge line, and it stands in front.
- ![new][new] **Drag a material onto the view to assign it.** A tile or a row of the Materials dock dropped in the view goes onto everything that is selected; with nothing selected, onto the part it is dropped on, which is tinted while the material is over it. It is the dock's Assign button done with the mouse, in one undo step. Dragged onto another material with Shift held, it takes that one over (the Merge button, done with the mouse): the dragged material stays, and a tip says "Merge into …" before the drop. Without Shift a drop on another material does nothing.
- ![polish][polish] **The shelves of the library are tabs** under its head. The fastener size sits at the right of that row, and only on the shelves it is for.
- ![polish][polish] **New material: hold the + for the presets** (or right-click it); the Industry presets button is gone. The list opens under a press that is still down, so press, slide to a preset and let go makes it; the arrow beside the + opens the same list with one click. A preset makes a new material (assigned to the selected parts, if any), in one undo step.
- ![polish][polish] **The material editor has the look of the newer panels.** No bold and no capitals, boxed number fields, a slider dot without a ring, texture slots as small sockets, and Transparent, Flat shading, Wireframe and Vertex colours as toggle buttons with a small switch each, two across. The rows and their order are as they were.
- ![fix][fix] **The material editor stays where you put it.** Opening another material in it, or a preset or an undo that refreshes it, sent the window back above the Materials dock every time. It now stays put, moves up only as far as it must to keep its bottom on the screen, and opens again where it was last left.
- ![polish][polish] **The material editor scrolls.** It is as tall as what is in it, up to the room between its top and the bottom of the window: past that its body scrolls up and down, and the window no longer runs off the screen or moves to make room. Drag its top or bottom edge to make it shorter; the height is kept. A folded section has the same room under its name as over it, and with every section folded the window ends where they end.
- ![polish][polish] **The material card in Properties: a double-click anywhere renames, and the part count is a badge.** A double-click on any part of the card puts the name into a field (it had to be on the name itself), and an open material editor takes the new name at once. The number of parts that use the material sits in the card's top right corner as a small badge, the number alone, shortened from a thousand up; the tooltip has it in full.
- ![fix][fix] **A popped-out Materials or Library window can stand in front of the material editor.** The editor was on a layer above them, so it covered them whichever was used last. While a dialog is open, the floating windows are stacked in the order they were used.
- ![fix][fix] **Menus and Settings open in front of floating windows.** A menu that drops from the top bar opened behind a popped-out Materials or Library window and behind the material editor, and the editor covered Settings and the search. Floating windows are now the lowest layer of what floats: the top bar's menus, Settings and the other modal windows, toasts and the right-click menu all stand in front of them.

**The view**

- ![new][new] **An arrow to a selection that is out of sight.** With something selected and none of it in the picture, a faint arrow sits at the edge of the view on the side the selection is on. A click on it frames the selection. *Arrow to a selection out of view* in Settings switches it off.
- ![new][new] **Orbit around: Selection, Scene or Cursor.** The switch *Orbit around the selection* in Settings is now a choice of three. Cursor turns the view around the point under the pointer when the drag starts: the surface it is over, or, over empty space, the point at the depth the view was turning around. Settings also has *Invert orbit direction*, *Stop at the horizon* (the camera cannot go below the grid) and a *Pan speed*.
- ![polish][polish] **Frame fits what it frames.** The camera stops where the whole box of the selection is in the picture with a small margin, and no further: a long thin part seen side-on fills the width and a small part in a big assembly fills the view. Before, the distance came from the longest side alone, times 2.5.
- ![polish][polish] **Dynamic place sets a part down by a box that is turned with the part,** not one stood square to the scene: the best of the pivot's own frame, the first part's and the part's principal axes, turned a few degrees for as long as the box gets smaller. The part rests on its real lowest point, and the whole pose is set from that box and the surface, so a part that was tilted or turned lands the same way every time. The scale cube is never more than a small share of the part and never under 8 px.
- ![fix][fix] **The centre handle of the scale gizmo jumped when it was pressed near the middle.** The size came from the pointer's distance to the object's centre, so a press close to it divided by almost nothing. It now follows how far the pointer has moved on the screen: right or up grows, left or down shrinks, by the same amount wherever the handle was pressed and however far in the view is. With snapping on, the factor goes to the snap step.
- ![fix][fix] **The grid blurred and glitched after focusing on a tiny part,** where the near plane is tiny and the far plane huge. Its rays are now worked out from a projection with the same field of view and a tame near and far. Zoomed out, the grid's fade grows with the camera's distance, so the grid under the model does not fade away when you pull back.
- ![polish][polish] **The hover tint on a part fades in plainly,** with no flash, for a row pointed at in the tree and for a material dragged over a part. The quick wand no longer lights tree rows for the parts under it.
- ![polish][polish] **The Draw tool's readouts in the view look like the gizmo's.** The size of a rectangle, circle or polygon as it is drawn, the corner radius and the "Close the line" hint were bare outlined text. They are the same chip as the gizmo's drag readout now: dark glass with a hairline, the same 11 px type, and the kind of shape small and dim in capitals before the numbers. The corner radius stands in one row after its Round and Bevel buttons.
- ![fix][fix] **Centre pivot pressed a second time made the gizmo disappear.** When nothing moved, because every part was already centred or is instanced, the gizmo and the part's handles were taken off and not put back.

**Around the app**

- ![polish][polish] **The quick ring shows icons only, and is smaller.** The words under the slices are gone (a slice keeps its name for screen readers), the ring takes about 40% less room, and in a fan only the command under the pointer shows its name, as a small pill beside it, at once with no fade.
- ![new][new] **`Shift+C` opens the search,** as well as `Ctrl+K`.
- ![new][new] **New scene is `Alt+N`.** A browser keeps `Ctrl+N` for itself (it opens a new browser window and the page never sees the key). `Ctrl+N` still works in a window the browser does not own, such as the installed app.
- ![new][new] **A right-click menu on every number field,** in place of the browser's: Cut, Copy, Paste, Select all and Reset as ordinary menu rows (an icon, the name and the shortcut at the right), and a few quick edits of the number (a step either way, doubled or halved, a round value, the other sign). Reset goes back to the field's own default. The value of a slider has the menu too, on the first right-click and while it is being typed, and a step or a sum picked there is entered at once. A name being typed has the same Cut, Copy, Paste and Select all rows, with quick edits for names (the case, a suffix like _L or _01, a clean-up). A number field on a card that floats over the view opens this menu alone, not the view's as well.
- ![polish][polish] **A right-click menu opens beside what was clicked, not on it:** under it, else over it, else at its right or left (a material, a tile of the library, a field). The menu of a row of the parts tree opens at the pointer, over the rows if need be: beside the row there is seldom room for it. The material in the Properties card, and the empty space round it, has the material's menu. A right-click on a floating command card is a click on the card: the view's own menu does not open behind it.
- ![polish][polish] **A click anywhere on a switch row turns the switch** (its name, or the free space between the name and the switch), in the sidebars, the cards, Settings, Export and Import.
- ![polish][polish] **Esc closes the Export, Import and Save-scene dialogs,** and the key of a tool closes its panel when it is already open.
- ![polish][polish] **Command panels read the same way:** the label on the left and its number on the right (*Hole width up to*, *Thread size up to M*, *Piece size up to*). Merge by asks *Combine parts that share*, *Group to use* and *Look at*. Align to floor says what its picture shows, runs on Enter, and its Reset is called *Back to how it was loaded*.
- ![polish][polish] **Sweep is opened from the search** (*Sweep…*); its button left the bottom toolbar. The tips in the corner show the keys of the tool whose panel is open, and a scene tab's tooltip carries its full name.
- ![polish][polish] **Delete small parts is off when nothing is flagged** (it used to read "Delete 0 small parts"). Its readout is the count, large, with the words beside it.
- ![new][new] **Arrow keys in the tree.** After a click in the tree, Up and Down go to the row above and below, and with Shift they extend the selection a row at a time. Right opens a closed group (on an open one it steps to its first row); Left closes an open group, and on a part or a closed group goes to the group that holds it. Home and End go to the first and the last row. A click anywhere else gives the keys back.
- ![fix][fix] **Shift+click in the tree starts from the row picked last,** however it was picked (a plain click was not recorded as the start). An open group that a range only runs into gives the rows that are in the range, not the rest of the group, and a group row loses its mark when one of its parts is switched off with Ctrl.
- ![polish][polish] **Leftover old fields and type.** The Scene scale and Save-scene name fields have the look of the other fields, a unit beside a number in a field sits on the number's line, the retired monospace type is replaced by Inter with tabular figures, and the sidebar's buttons lose their hairlines.

## v0.22.0

Released 12 Oct 2026.

v0.21.0 was about getting a model out and showing it. v0.22.0 is about letting something else do the work, and about trusting the app not to lose it: Claude can drive the optimiser, the app can update itself, and a crash no longer costs the scene.

**Work with Claude**

- ![new][new] **Let Claude use the app.** Switch on **Let Claude connect** in Settings, add the app to Claude once with `claude mcp add --transport http meshoptimiser http://localhost:4242/mcp`, and Claude can use the same tools you click, on the scene you have open: 65 of them, from finding bolts and hidden parts to Smart optimise, reducing to a size, pictures and exports. It is off until you switch it on, and a small pill in the top bar says when Claude is listening, working or waiting for you.
- ![new][new] **You stay in charge.** Four switches decide what it may do at all (change the model; move, rename and group; delete; open files and save exports). With **Ask before Claude edits** on, an Allow or Don't allow prompt comes before every edit, and deleting asks even when that is off. Looking, selecting, hiding, isolating, exploding and moving the camera never ask. Every change is one undo step.
- ![new][new] **Try it, watch it, stop it.** Sixteen steps take `dry_run`: the app does the step, reads the numbers and takes it back, so Claude can say what would happen with nothing kept. `optimise_to_target` takes a scene to a size or a place (web, Shopify, AR, a phone) in one call, `compare_images` puts the model as opened beside the model now, and `batch_optimise` does a folder one file after another. Long jobs show their progress in the pill and have a Stop button.
- ![new][new] **Claude arrives knowing the app.** The server hands it six playbooks, about fifty of the help articles (searchable, read one at a time) and six ready-made jobs, and every tool says whether it only reads or changes the model.
- ![new][new] **Pictures for a client.** `render_image` makes PNGs up to 8192 pixels a side in one angle or several, in solid, clay, CAD, wireframe, x-ray or heat view, on a plain or transparent background. `turntable_video` saves the film.
- ![new][new] **Settings, Claude** shows the state of the connection, how many requests were done, declined or failed, the last thirty requests, and has Reconnect and Restart the server. The hosted demo has none of it.

**Updates**

- ![new][new] **Updates inside the app.** Settings, Updates (and Check for updates in the menu) looks for a newer version, shows what is new and installs it. It downloads a small archive of the app's own files (a few megabytes, not the Python environment), checks its size and fingerprint and every file in it, replaces only what changed and restarts. Your scenes, settings, inbox, exports and Python environment are never touched.
- ![new][new] **A way back.** One earlier version is kept: **Earlier version** puts it back. If a new version does not get a working window up in three starts, the old one comes back by itself. Launcher files are never replaced while they run; a release that changes them sends you to the full download.
- ![new][new] **Your choices.** Check automatically (and how often), Stable or Beta, a notice in the corner with Update, Later and Skip this version. A check downloads one small file from lukagrcar.com and sends nothing about you. Versions before this one have no updater, so they need one manual update.

**Crashes**

- ![new][new] **Your scene back after a crash.** While a scene has changes that are not saved, a copy of it is kept inside the browser: every 2 minutes by default (1 or 5, or off, in Settings, General, Recovery), only when something changed, never while you drag. After a crash the app says so and offers the scene back, and the start screen shows it first as a wide yellow Continue card. Saving clears the copy, and a window you close or reload on purpose is not offered back.
- ![fix][fix] **Closing or reloading a tab while a conversion runs stops the converter at once,** and the server cancels a job that nobody has asked about for ten minutes. Before, a core and gigabytes of memory could stay busy for hours.

**Reduce and export**

- ![new][new] **Keep sharp edges** in the Reduce triangles card, on by default. While triangles are taken out, the vertices on a part's hard edges (faces that turn by more than 40 degrees: a rim, a step, a corner) stay where they are, when the part has few of them and the goal can still be reached. A part that is mostly hard edges, like a gear, is reduced as before. Decimate, Fit to budget and Claude's tools use it.
- ![new][new] **Meshopt compression and Faster to draw** in the Export window, for GLB. Meshopt makes the file about a quarter of the plain size (Draco is smaller still, about a fifth on a CAD assembly) and needs a viewer that reads it. Faster to draw only puts the triangles and vertices in the order the graphics card likes: the shape does not change and any viewer opens it. The first use fetches glTF Transform, so it needs a connection once.
- ![new][new] **New scenes start the way you like.** Settings, General has a unit and an up axis for every scene you start from now on.
- ![polish][polish] **Turntable videos are sharper** (a higher bit rate), and Export sits beside the sidebar button in the top bar.

**Around the app**

- ![new][new] **A Tasks chip** in the status bar shows every tab's running job and can cancel it. It is a small empty ring when nothing runs.
- ![new][new] **Point at a row in the tree and the part pulses in the view; point at a part and its row lights up.** The selection has a soft glow, and the tree scrolls only when the picked row is out of sight.
- ![new][new] **Explode along each part's own axis** (Part axis), as well as along the scene's axes. **Recentre on origin** with parts selected moves only them, together. **Shading angle** in Properties re-smooths normals, one undo step.
- ![new][new] **Drop a folder** to open the model in it, and a glTF with an external .bin or textures asks for its folder. A converted STEP is kept as GLB, so its Recent card opens at once. About forty more actions are in the search.
- ![polish][polish] **The loader is a spinning low-poly sphere,** and opening a STEP shows its six steps with times and folds the log under Details. The Import dialog has segmented Quality and Colours choices. The camera pill sits under the view cube, the left sidebar starts wider on a big screen, the grid stays visible until the camera is nearly level with it, and the tree's colours are on by default.
- ![fix][fix] **The selection stays selected while a model explodes,** and a tool run on an exploded model no longer offsets the bounding box twice.
- ![fix][fix] **The floor grid refits after a model is added to a scene or a library part arrives.**
- ![fix][fix] **Smart fit's cylinder copes with a ring that has a tab or ears.**

## v0.21.0

Released 9 Oct 2026.

v0.20.0 was about drawing and trusting the app. v0.21.0 is about getting a model out and showing it: a turntable video, export presets for where the file is going, and a Selection bar with the actions I reach for most.

**Show it**

- ![new][new] **Turntable video.** The film button next to the camera (or "Turntable video…" in the search and the right-click menu) takes the camera once round the model and saves a WebM. Pick a size (720p to 1440p, square or portrait), a length of 4 to 12 seconds, 24, 30 or 60 frames a second, a direction and a view mode, and whether to hide the grid. "Fit the model to the frame" centres it and backs the camera off until it fills the picture, whatever the shape of the frame; the first and last frames are one step apart, so the clip loops. It is encoded in the browser with WebCodecs (VP9, or VP8 where VP9 is missing), so nothing leaves the machine, and the viewport is put back as it was. Chrome and Edge.

**Export**

- ![new][new] **Where is it going?** A row of presets at the top of the Export dialog: Web viewer, AR on iPhone, Unreal Engine, Unity and 3D print. One press picks the format and sets the unit scale, up axis, origin, merge and Draco, and points "Check against" at the same place, so the size meter agrees. They read the scene as millimetres, like the unit-scale choices do. Change any option and the preset lets go.
- ![new][new] **× 0.1 (mm → cm)** in the unit scale, for Unreal.

**Selection bar**

- ![new][new] **A row for the view.** Hide (H), Isolate (S, and Show all while the view is isolated), Frame (F) and Duplicate (Ctrl+D) are buttons now, not only keys. They dim with nothing selected.
- ![polish][polish] **Buttons sit directly on the panel.** Each is an outlined button with room around it, no box around the row, and the Delete count lives in the header ("12 selected") instead of squeezing the button.
- ![polish][polish] **The selection actions are in one bar under Properties,** with a live count; every card title has a small icon and the group labels draw a line.

## v0.20.0

Released 9 Oct 2026.

v0.15.0 was about reaching commands quickly. v0.20.0 is about drawing, organising and trusting the app. You can draw lines and shapes and sweep a profile along them, lines are real parts of the scene (in the tree, in groups, with the gizmo), the tree gets a set of organising commands, the converter reads IGES and BREP and finds repeated parts in other tools' files, and the app now looks after itself: it closes its server with the window, survives a crash and tells you when the graphics card is not doing the work.

**Draw lines and shapes**

- ![new][new] **A Draw tool (L).** Pen, Rectangle, Circle, Arc, Polygon, Freehand and Edit, with the curve type chosen in the card: Bezier, Cubic, B-spline or Linear. A rectangle, circle or polygon is placed with two clicks (the first starts it, the second places it) and can be typed in: `20 x 10`, then Enter. The arrow keys change the corners and the number of sides while you place it; Star, Ellipse, Around the circle and From the centre are switches in the card.
- ![new][new] **Work planes.** Ground, Front, Side, View, or Surface (the first click picks a face of a part), each with an offset.
- ![new][new] **Snapping you can see.** A field of dots fades in round the pointer and follows the grid; a click a few pixels off a dot still lands on it. Points also snap to other lines' points, and Shift snaps the angle in 15° steps. The dots stay quiet when they would crowd (seen from far away or edge-on) and the grid step can be Auto or a number.
- ![new][new] **Edit the points of any line.** Drag points and handles, click a curve to add a point, double-click a point to make it smooth or sharp, Delete removes one, C opens or closes the line. The curve follows live while you drag. Close or open, Reverse, Simplify, Smooth, Sharp, Corner, All corners and Mirror are in the card; changing the curve type converts the line.
- ![new][new] **Round and Bevel corners.** The Round and Bevel switch and a corner size are in the card, and a rectangle or polygon that is still a shape shows a ring on its first corner in the Edit tool: drag it to round or cut every corner at once (it snaps to the grid, one undo step) and click Round or Bevel beside it.
- ![new][new] **Bezier handles snap to the grid** while you draw and while you edit.
- ![new][new] **Ctrl-drag a handle to break it from its partner.** The two handles of a smooth point move together while they are in one line; Ctrl (or Cmd, or Alt) while dragging frees one of them, and it stays free afterwards.
- ![polish][polish] **The Draw card is compact.** One row of tool icons with the tool's name in the title, segmented controls for the curve and the plane, and the settings in small groups with switches. Only the keys that do something are listed at the bottom right with the other shortcuts (handles are offered for Bezier lines only, Enter and C appear when there are enough points), in short words. The X Y Z readout that followed the pointer is gone; a shape still shows its size while you place it.
- ![fix][fix] **Orbit around the selection and F (frame) include lines,** so a line can be orbited and framed like a part.

**Lines are parts**

- ![new][new] **A line is a row in the tree,** like any other part: rename it, hide it, delete it, undo, drag it, put it in a group and nest groups. The separate Lines list is gone.
- ![new][new] **The gizmo moves, turns and scales a line** like a part, and it sits on the line's centre. Clicking a line in the viewport selects it; Shift adds and Ctrl toggles.
- ![new][new] **Lines are read from files.** A GLB or glTF with lines (strips and loops) opens them as lines, and lines go back out into GLB, glTF and saved scenes (grouped lines are written flat, with their names).

**Properties of a line**

- ![new][new] **A Shape card** for a rectangle, circle, ellipse, polygon or star that is still a shape: width, height, radius, sides, star and inner radius, corner type and size. A rectangle grows about its centre. Moving a point by hand turns the shape into an ordinary spline.
- ![new][new] **A Spline card as in Cinema 4D:** Type, Close Spline, Interpolation (None, Natural, Uniform, Adaptive or Subdivided), Points, Angle and Maximum length. The ones that do not apply to the chosen interpolation are greyed.
- ![polish][polish] **Every control in the two cards has one size,** and the number boxes drag from the box, the label or the number. One drag is one undo step, and the Points, Size and Length at the top of the card follow the edit.

**Sweep**

- ![new][new] **Sweep (a card on the bottom toolbar).** Pick a path and a profile (a circle, a rectangle or another line), set the scale at the start and the end, a twist, closed ends and a hard-edge angle, and it makes a normal part along the path.

**Organise the tree**

- ![new][new] **Remove group, keep contents.** Takes a group, or every selected group, out of the tree; what was inside stays as it was, nesting included, and moves up. One undo.
- ![new][new] **Flatten this group** (dissolves every group inside it), **Sort inside A to Z and Z to A** (numbers by value, groups first), **Move group up and down** among its siblings, **Delete empty groups**, and **Expand this branch and Collapse this branch** are in the group's right-click menu.
- ![new][new] **Groups and parts can be picked together.** Ctrl toggles a row as a unit (a group goes in or out with all its parts), Shift selects the range from the last clicked row whatever it is, and Ctrl+Shift adds a range.
- ![fix][fix] **A slip of the mouse no longer eats the click.** The tree's drag and drop started on any press, and after 5 px of movement swallowed the click: Ctrl and Shift clicks, which pick rows, now never start a drag, and a press that lets go on its own row counts as a click.
- ![fix][fix] **The guide lines of the tree end properly:** the last row under a parent gets an L, its line starts under the parent's icon, and a level with no later row draws no line.
- ![polish][polish] **Tooltips follow the pointer.** The first one still waits; once one is up (or has just closed), the next button's tip appears at once, and a gap between two buttons does not make the tip blink or the next wait start again.

**Lighter files, and promises you can check**

- ![fix][fix] **Deduplicate geometry no longer deletes real parts.** It removed every part whose shape had been seen before, so 400 placed copies of one bolt became one. It now removes a part only when an identical one sits in the same place. (A self-test opens 60 placed repeats of three shapes and checks that all 60 stay.)
- ![new][new] **Copies are found in files from other tools.** A GLB, FBX, OBJ or 3MF that writes the same bolt out again for every place it is used is searched for repeats when it opens (`repeats.js`): the same vertices and triangles after one rigid move, checked on every vertex, mirrored and bent parts left alone. Each shape is then kept once and drawn and exported once. A test file of 600 meshes goes from 2.72 MB to 186 KB; every vertex stays within 0.01 mm of where the file put it. The switch is "Auto-instance duplicates" in Settings.
- ![new][new] **Decimate within a distance.** Choose "Within…" and type a number of millimetres: triangles are taken out for as long as no point of the surface moves further than that. The simplifier's own error figure ran 25 % over on a curved part in testing, so the result is measured (the vertices of each surface against the other) and tightened until it fits; the message says the measured figure.
- ![new][new] **Check against a place the file is going.** The Export window can compare the scene with the published guidance for a web page, a Shopify product page, Apple AR Quick Look or a phone app, with an estimate of the triangles and the file size before exporting and a note afterwards. The figures are guidance, not hard limits, and the text says so.
- ![new][new] **Recipes.** Smart optimise can save its settings under a name, apply and run them later, and export or import them as a small file; every field of an imported file is checked. Two steps joined it: remove exact copies, and reduce within a distance.
- ![new][new] **Merge parts of the same colour** (in the command list): one mesh per colour for the selection, or for everything visible. Instanced parts are left alone. One undo.

**The converter reads more, and does more**

- ![new][new] **IGES and BREP files.** `step2glb.py` and the server's upload (`/api/convert`) take `.iges`, `.igs`, `.brep` and `.brp` as well as STEP, picking the reader by the extension, and the app opens them as it opens STEP. IGES keeps the names, colours and layers the file has; a surface model with no solid is meshed as it is (an IGES face for face, one body per colour; a BREP one body per shell). An unknown extension, a damaged file or one with nothing to mesh stops with a message that says why.
- ![new][new] **A whole folder.** `--batch DIR` converts every CAD file in it (`--out`, `--recursive`), one process per file, so a damaged file cannot stop the run. It prints a table with parts, triangles, size, seconds and status, writes `batch-report.csv`, and exits 1 if any file failed.
- ![new][new] **LOD files.** `--lod 100,50,25` writes `name.glb`, `name_lod1.glb`, `name_lod2.glb` at those shares of the triangles, with the same nodes, names and instances. Simplified by gltfpack when it is installed, otherwise by the bundled meshoptimizer through Node.js. The log gives the real triangle count of every level.
- ![new][new] **The CAD file's own data on the nodes.** Each node's `extras` hold its name in the CAD tree, the assembly path, the part it instances, the STEP part number and description, colour, layers, material, volume and area, wherever the file has them (`--no-extras` turns it off; about 200 bytes a node).
- ![new][new] **Copy diagnostics for a bug report** (in the command list): version, browser, renderer, size of the scene and the last log lines, with the file name and drive paths removed. A bug-report form is in `.github/ISSUE_TEMPLATE`.

**The app looks after itself**

- ![new][new] **The server goes when the window goes.** `serve.py` watches the browser windows it opened and exits about ten seconds after the last one closes (`--keep-running` turns it off). On Windows the converters it starts are tied to it, so they die with it; before, a closed app could leave a process eating the machine.
- ![new][new] **A crash is handled, not just survived.** An unclean exit is noticed at the next start ("closed unexpectedly") with Reopen last file and Safe mode, a flood of errors and a lost graphics device each get a panel that says what happened, and slow frames are written to the log.
- ![new][new] **A warning when the graphics card is not used.** Chrome with hardware acceleration switched off runs WebGPU in software and the app crawls; Settings › Performance now has a Graphics row, and the app says so at start.
- ![fix][fix] **Scan whole model no longer freezes the app.** It works in slices with a progress bar and a Cancel button; before, a large model could lock the page.
- ![fix][fix] **A memory leak in Split is closed.** Each split and undo left about 130 outline geometries on the graphics card; they are released now.
- ![fix][fix] **Changing the scene scale no longer strands the view.** The camera, what it looks at, its clip planes and the grid follow the scale, so the picture stays the same; before, the model could end up a speck millions of units away or the camera inside it, and a near plane left over from a larger scale cut the whole model away. The floor grid is cut again for the new size and its cell can be finer than one unit.
- ![fix][fix] **The floor grid is no longer cut off when you zoom in close.** It was drawn from the near plane, so everything closer than that vanished; it now starts at the camera.
- ![fix][fix] **Shift no longer lights up the button you just clicked.** A clicked button keeps focus, and Chrome drew the Tab ring on it the moment Shift (or Ctrl, Alt, Cmd) went down. The ring stays hidden while only a modifier is pressed after a click; Tab and the arrow keys still show it.

**Cards**

- ![polish][polish] **Smart fit has a tidier layout.** Its **Advanced** section has a reset button next to its name that shows once something has changed (the one at the bottom is gone), and the video at the top of a card gets smaller, smoothly, while Advanced is open, instead of disappearing.
- ![polish][polish] **The command cards have no description lines.** What a command does is in its tooltip and in the help.

## v0.15.0

Released 9 Oct 2026.

v0.14.0 was about how the app looks and how it explains itself. v0.15.0 is about reaching things quickly and making models lighter: a ring of commands under the pointer, four clean-up tools, Untriangulate, a wireframe that shows the polygons, a simplifier that looks after normals, UVs and colours, and a scale handle for Dynamic place.

**Quick wand**

- ![new][new] **Quick wand: a ring of commands under the pointer.** Hold **W** over the viewport and a ring opens around the pointer. Move toward a slice and let go of W to run it. Only the direction counts, not the distance, so a short flick is enough; the middle of the ring (or Esc) does nothing. It works on the selection when there is one and on the whole scene when there is not, and the slices are always in the same places, so the hand learns them. Delete is red.
- ![new][new] **With a selection** the ring has four slices: Hide, Reduce, Delete and More. **Reduce** fans out Decimate −50 %, −25 %, −75 % and −90 % (each shows the triangle count before and after), Smart fit, Split and Fill holes. **More** fans out Isolate (Show all while the view is isolated), Select similar, Select same colour, Group, Duplicate, Merge, Frame, Hide others and Show all.
- ![new][new] **With nothing selected** the ring has six: Fit view, Select all, **View** (Camera, Top, Front and Side views, Solid, Wireframe and X-ray, the ground grid), Show all, **File** (Save screenshot, Save scene, Revert to source file) and **Clean** (Recentre on origin, Align to the floor, Smart fit all parts, Remove empty parts, Deduplicate geometry, Fix degenerate parts).
- ![new][new] **A slice that holds a group opens its fan as soon as the pointer is on it.** Move out onto a command and let go. The ring remembers which group you were heading for, so going straight to a command does not turn into another slice on the way. Commands show their shortcut, and one that cannot run right now stays on the ring, dimmed, with the reason ("Nothing is hidden", "Select two or more parts", "Too few triangles to take away").
- ![new][new] **A quick tap of W leaves the ring open** instead: click a slice or a command to run it, W or Esc to close. It is also in the command palette (Ctrl+K) as *Quick wand*, which opens it that way at the pointer.
- ![new][new] **It cannot be left behind or act by accident.** Esc, any other key, the scroll wheel, a click outside, a window that loses focus, a hidden tab and a resize all close it without running anything. It does not open while a mouse button is down (an orbit or a gizmo drag), in a text field, behind a dialog or outside the viewport, and it keeps the right-click menu from opening on top of it. The ring stays inside the window.

**Cleaner, lighter models**

Four tools, each a floating card that opens from the command palette (Ctrl+K).

**Repair, clean-up and selection**

- ![new][new] **Repair mesh.** Joins doubled vertices, removes empty and doubled triangles, turns faces so that neighbours agree on which side is out (a closed shape is turned outward), and can work the shading out again with a smoothing angle. It works on the selected parts or the whole scene, leaves a part that is already sound as it is, keeps UV seams and materials, and reports what it did. One Ctrl+Z takes it back.
- ![new][new] **Remove hidden faces.** The polygon-level partner of Select hidden parts: each part is looked at from many sides (Fast, Normal or Thorough), and the faces that never show are deleted: the inside of a housing, the faces where two parts press together. A face next to a visible one stays, so no holes open in the surface. A part that is hidden altogether is left for Select hidden parts. Can be undone.
- ![new][new] **Merge by material or by group.** Joins parts into one mesh per material, or one per group (the nearest group, or the groups just inside the top one). A merged mesh keeps its material. A whole run is one step to undo.
- ![new][new] **Select by rule.** Rules on a part's name (contains, starts with, ends with, is, wildcards), material, group, triangles, size as a share of the model, and whether it is shown, flagged, instanced or selected. Match all rules or any, and replace, add to, remove from or narrow the selection; the card says how many parts fit as you type.

**Wireframe view**

- ![new][new] **Untriangulate.** Cinema 4D's command of the same name, in Reduce triangles (and the command palette). Neighbouring triangles that lie in one plane are one polygon (an n-gon); the vertices that touch only that polygon are removed and the polygon is triangulated again from its outline with the fewest triangles, so a flat plate cut into a grid of 200 triangles becomes 38. The shape does not change at all (nothing is deviation), and a polygon is only rebuilt when it is flat to 2e-5 of the part's size, its vertex normals agree with its plane, every vertex on its outline is kept (so no crack opens against the neighbouring polygon), and the area adds up; anything else is left as it was and counted in the message. It works on the selection, or on the whole scene when nothing is selected, in the background workers, and it is one step to undo. **Strict, Normal and Loose** set how flat neighbouring triangles must be to join. The triangles remember their polygon, so the Wireframe view shows the polygons. The graphics card and the file formats still draw and store triangles: this removes the triangles and vertices that only cut a flat face up, it does not give OBJ or FBX real n-gon faces.
- ![polish][polish] **Wireframe is the surfaces with a thin black line on every edge.** Like Gouraud Shading (Lines) in Cinema 4D. Before, it drew the surfaces themselves as lines in their own colours, see-through, so an assembly turned into coloured thread. Now the colours, lighting and opacity of the Solid view stay, and a thin black line follows every edge of the mesh on top. The lines share the part's vertex buffer (24 bytes per triangle for the index) and are not kept while the view is off. **Settings › Viewport › Wireframe**: Lines is *Triangles* (the default: every edge of the mesh, the wireframe), *Polygons* (the outline of each flat polygon, curved faces included, with the triangle lines inside flat polygons left out) or *Outline* (only the sharp edges and borders of the shape, the same lines as the CAD view's Outlines), and Flat within sets how flat neighbouring triangles must be to count as one polygon in Polygons. These only change what is drawn; Untriangulate changes the mesh.

**Decimate and Fit to budget**

- ![new][new] **Normals, UVs and vertex colours now steer which triangles are removed.** Before, only positions counted, so a crease, a UV seam or a colour edge could be flattened as readily as a smooth patch. Now the simplifier weighs them in first and falls back to the old position-only pass, then to an unlocked-border pass, only when that does not reach the target. The same code runs in the background workers and on the page (`simplify-core.js`).
- ![new][new] **The report shows how far the surfaces moved.** Decimate and Fit to budget take the simplifier's own error estimate, scale it to the part's size in the scene, and add it up over every reduction. It shows as "Surface deviation (est.)" in the Optimisation report, in the unit the scene is shown in, and in the toast after a run. Undo and redo take it back with the step. It is an estimate, not a measured distance: on a test sphere it came out about a third under what was measured, so read it as a floor, not a limit.

**Interface**

- ![polish][polish] **The sidebar drag handles sit on the status-bar row.** Only the bottom of the edge between a sidebar and the viewport can be grabbed, so nothing over the viewport or a sidebar is caught by accident. A short faint notch shows there once the pointer has rested on it for a moment, and is invisible otherwise.
- ![polish][polish] **The buttons above the tree are cards.** Collapse, Rename and Flatten have the same fill as the cards in the right sidebar and no outline.
- ![polish][polish] **The four tool buttons left the bottom toolbar.** Repair mesh, Remove hidden faces, Merge by material or by group and Select by rule are opened from the command palette.
- ![new][new] **Dynamic place has a scale handle.** A small solid cube floats on the middle of the selected part's top face. Drag it up and the part grows, down and it shrinks, evenly in all three directions (Shift: steps of 5 %). The part is scaled about the middle of its underside, so one resting on a surface stays on it, and a see-through ghost of the part at its old size stays behind while you drag. A part that is scaled still rests correctly when it is dragged over another surface. One Ctrl+Z takes the whole drag back, and Esc cancels it.
- ![polish][polish] **The animations at the top of the Help cards are redrawn so that they match.** Split, Select hidden parts, Fasteners, Smart fit, Fill holes and the cover now share one lighting and one grey material, with the accent blue for what is selected. In Split the bracket stays in the middle while the other parts fly out of it; Select hidden parts shows a gearbox with eighteen parts inside its housing instead of a box with a cylinder; Smart fit lays its three parts out in an even row again. No mesh lines are drawn except in the cover, whose subject is the mesh. The clips are made by `tools/render-*-clip.mjs`, on one shared renderer, `tools/clip-kit.mjs`.

## v0.14.0

Released 8 Oct 2026.

The biggest release so far. It adds a CAD view and a Shading card with a look for every taste, Dynamic place, an Align to floor that shows what it will do, a Help window with the whole knowledge base inside the app, a Settings window that can change the look of the interface, a rebuilt Export window, and three tools that clean up a scene for you (Smart optimise, Fasteners and Stacked copies). It also fixes what a read of the whole code base and a round of testing on assemblies with thousands of parts found, and it makes opening a big model faster.

**CAD view and shading**

- ![new][new] **A CAD view (key 6).** A view mode like the ones in CAD programs: no lights, reflections or shadows. Every surface is shaded only by which way it faces the camera, read from a small picture of a lit sphere (a matcap). Faces that look left are a light cool grey, faces that look right are dark and faces that look up are a warm sand. A grey or white part takes the matcap as it is; a coloured part keeps its colour with the matcap's shading. A dark line follows the sharp edges of every part, and a smooth surface such as the side of a cylinder gets a thin dark outline where it turns edge-on to the camera. Three looks: Ceramic, Light and Mono. Export and Save switch to Solid while they run, so none of it reaches a file.
- ![new][new] **A Shading card under Properties.** Clay and CAD left the toolbar on the left. The card has a strip of small 3D parts (a hex nut), one for every look drawn in that look: Default (the plain Solid view), Clay, Porcelain, Steel and Red wax, then the CAD looks Ceramic, Light and Mono (they carry a CAD badge). A click chooses a look and turns the view on; a click on the lit one goes back to Solid. Keys 5 (Clay) and 6 (CAD) work as before. The card starts open.
- ![new][new] **Outlines.** One switch on the Shading card (and in Settings › Viewport) draws the fine dark line on the sharp edges of every part in every view: Solid, Clay and CAD. It is on to start. Where lines are drawn in Solid and Clay the surfaces are pushed slightly back in depth so a line never flickers against the face it lies on.
- ![polish][polish] **The strips scroll like the materials strip.** With a mouse, drag a strip sideways: it carries on after a flick, slows down, and at either end it stretches like an iOS list and springs back. A drag is not taken as a click on a tile. The strip fades at an edge that has more behind it, and a lit tile that is out of view is scrolled into view when the look changes. The materials strip in Properties is dragged the same way.
- ![fix][fix] **Edge lines no longer show only half.** A line lies exactly on the faces it borders, so which of the two won the pixel changed with the camera angle: half the lines on one tilt, the other half on the other. The lines are now pulled toward the camera in their own shader, which works on both the WebGL and the WebGPU renderer (this version of the WebGPU renderer has no polygon offset).
- ![fix][fix] **Edge lines are no longer hidden by the ground grid.** The grid plane writes its own depth, so a line drawn after it vanished where the plane lay between line and camera (the part of the model below the grid seen from above, the part above it seen from below). The lines are drawn before the grid now.
- ![fix][fix] **Edge lines do not lag behind their parts.** The lines of duplicated parts (drawn as one instanced mesh) were baked on the processor and drawn again 90 ms after a move, so they trailed the surfaces in an exploded view and while snap-moving. They are drawn by the graphics card now, with the very same matrices as the parts. A copy that is selected or edited and becomes a mesh of its own gets its lines in the same moment.
- ![fix][fix] **Hidden parts do not keep drawing edge lines.** While the view moves and Skip tiny parts leaves a part out, its CAD edge lines are left out with it.
- ![polish][polish] **A very heavy model says when some parts have no edges.** The view draws edges for at most 6,000 parts and about 30 million floats of lines. Past that the biggest parts are outlined first, the same ones every time, and a notice says how many of the smallest parts are drawn without.
- ![fix][fix] **Materials work while Clay or CAD is on.** Under Clay or CAD a part wears the view's shared material, and the material panels, the "used by" marks, Assign, New material, Duplicate, Delete material and merging materials used to look at that shared one. They read and change the material the part really has now, and the Properties card shows it. Parts made while a view is on (a copy turned into a mesh of its own) are dressed at once.

**Dynamic place**

- ![new][new] **Drag the selected part over other surfaces (key D).** A button in the toolbar on the left, the key D and the command palette open a card. With it on, press the selected part and drag: it rests on the surface under the cursor, with its lowest point (measured along the surface's normal) on it so it never sinks in, and turns to face the surface, like dragging a part out of a library onto a model. A press that is not on the selected part selects as usual; Shift, Ctrl, Alt and Cmd keep their normal meaning.
- ![new][new] **Its options.** Align to surface; Land on the grid where nothing is under the cursor; Top axis (X, Y or Z of the part as it was picked up) and Direction (+ or −), which choose the side of the part that points away from the surface; Gap (a negative gap sinks the part in); Turn about the surface's normal, with quick buttons for 0°, 90°, 180° and 270°; and Reset gap and turn. The mouse wheel turns the held part in steps of 15°. Esc, a lost focus or a cancelled pointer puts the part back where it was. A drag is one undo step.
- ![polish][polish] **Out of the way.** The transform gizmo is neither drawn nor grabbable while the tool is on, and choosing a gizmo (E, R, T, Q or its button) ends it. The cursor is a cross-hair, a hand over the selected part and a closed hand while it is held. With the view exploded it says to put the parts back together first. The tips at the foot of the viewport follow the tool.

**Align to floor**

- ![polish][polish] **It shows what it will do.** A small 3D drawing sits at the top of the card: the floor with its grid, the origin with the three axes and the model as the box it fills. The point of the model that goes to zero is ringed, a dashed line joins it to the origin while they are apart, a model that stands on the floor gets a blue footprint, and two arrows (its top and its front, as it was loaded) turn with the model. With no model open it draws an example box, so the choices can be tried first.
- ![polish][polish] **Nothing moves until you press Align to floor.** The turn buttons and the choices only change the drawing ("Preview: not applied yet"); Align to floor does it, as one undo step. The three drop-downs are buttons now (Low / Mid / High / Keep, and Floor / Mid / Top / Keep). Reset puts the model back as it was loaded and the card back to its start (no turn, Mid / Mid / Floor).
- ![polish][polish] **It is a floating card.** Align to floor left the right sidebar and opens over the viewport like Split and Fill holes, from the command palette (Ctrl+K, "Align model to the floor…") or the All commands menu (the three dots). "Align model to the floor (with the last choices)" in the palette does it without opening the card. Esc puts it away.
- ![polish][polish] **Less on the card.** The line of numbers under the buttons is gone (the picture says it), and so is "Place every file I open": a file that is opened no longer moves itself.

**Floating cards and tools**

- ![new][new] **Move a card.** Split, Fill holes, Fasteners, Align to floor and the other cards over the viewport can be dragged by their title bar, or by the picture at the top of one that has a picture. A card stays inside the viewport, remembers where it was left in this browser, goes back to its corner with a double-click on the title, and is pulled back inside when the window shrinks.
- ![polish][polish] **Stacked copies is a floating card too.** It left the right sidebar and opens from the command palette ("Find stacked copies…"). The tolerance, the near-copies switch, Find, Isolate and Delete work as before.
- ![polish][polish] **Heavy parts are the parts over 10,000 triangles.** The card lists only those (up to 500, heaviest first) and shows how many there are as a small number beside its title, seen while the card is folded. It goes down as they are deleted or reduced, and reads 0 (dimmed) when none is that big; the empty list says "No part has more than 10,000 triangles." or "Load a model to see heavy parts.". Ticking a row never moves the camera now; a right-click on a row goes to the part.
- ![polish][polish] **Cards over the viewport have no outline,** only a shadow, and every dropdown keeps the same hairline ring. They end in a Done bar with the Esc key.
- ![polish][polish] **Small parts that are flagged stand out.** The yellow of Highlight small parts is stronger (62% instead of 22% opaque), a fainter yellow shows through whatever hides the part, and a yellow outline that nothing covers is drawn, so a screw inside a housing is found at a glance (for the first 400 flagged parts; beyond that the plain fill). The fill of a duplicated part stays on its copy when the copies move.

**Exploded view**

- ![polish][polish] **A simpler Exploded view card.** One Amount slider moves every axis that is on; X, Y and Z are pills with a coloured dot (red, green, blue) that choose which axes explode (switching one off puts it back, switching it on gives it the current amount); quick amounts (25%, 50%, 100%, 200%) set round values; the single-axis sliders are folded under Fine tune each axis. Reset puts every part back.
- ![polish][polish] **Solid state pills.** Isolated is the accent blue, Exploded violet, Measure amber and Snap green, each a flat colour instead of a dim tint with a ring.
- ![fix][fix] **Frame selection in an exploded view.** A copy drawn as part of a repeated set was framed where it sits at rest, so the camera aimed at where it used to be. Orbiting around the selection and Skip tiny parts also use where the parts are drawn now.

**Settings, Appearance and Help**

- ![new][new] **Appearance.** A new Settings page changes how the interface looks: an accent colour (presets and a picker for any colour), four tones for the greys, the interface font, the text size, the shape of corners and the density (the height of buttons, fields and dropdowns), and an Interface animations switch that turns off fades, slides and the start-up movement. Changes show at once and a Reset button on the page puts them back.
- ![new][new] **Help & docs in the app (F1).** A window with the whole knowledge base of the website: articles in groups on the left, the open article on the right, and a search of all of them at the top. It works offline. It opens with F1, from the Menu, from the File menu, from the command palette, from a link on the start screen and from Settings.
- ![new][new] **About.** A Settings page with the version, renderer, scene size, display and browser, buttons for Help and the shortcuts, a Copy details button that puts those facts and the GPU and the chosen look on the clipboard for a bug report, and links to report an issue, the website and the source.
- ![new][new] **More Settings.** Camera speed (Orbit speed and Zoom speed, each Slow, Normal or Fast); Undo history (Short 50, Normal 200 or Long 500 steps); Warn before leaving with unsaved changes (on to start); Splash screen on or off; CAD view look and Outlines under Viewport. Settings no longer blurs what is behind it, so a colour or size changed there is seen as it changes.
- ![polish][polish] **Show origin points** replaces "Group origins on select". It is off to start; when on, a dot shows at the origin of every group.
- ![polish][polish] **Lower the resolution if it stutters is off to start.** It used to be on. Skip tiny parts stays on.
- ![fix][fix] **Reset all settings resets everything it should:** the appearance, the camera speed, the undo depth, the CAD look and the outlines, not only the General page.
- ![polish][polish] **The Keyboard shortcuts window is complete.** Besides the keys it lists the mouse (orbit, pan, zoom, select, box select, context menu), the tree (select rows and ranges, rename, drag into a group), fields (drag a number, Shift ten times faster, Alt ten times finer, click to type) and panels (Enter runs the open command, Esc closes it, Ctrl+Enter applies a batch rename), and shows a second key after "or". A test checks that every key the app binds is listed. CAD view (6), Batch rename (F2), Help & docs (F1) and Dynamic place (D) are in the command palette too.

**Start-up**

- ![new][new] **A splash screen while the app opens.** A dark card with a drawing of a rear derailleur as glowing 3D lines (the parts fly together, the camera glides round and a band of light climbs the model), the icon, the name, the version, a status line ("Building the interface", "Starting the renderer", "Preparing the scene") and a thin progress bar along the bottom edge. The app fades in by parts (top bar, left sidebar, viewport, right sidebar) when it has finished starting, after a short minimum (2.2 s the first time in a browser session, 0.7 s after a reload) and at the latest after 6 s. It can be switched off in Settings › General, and with "reduce motion" on the drawing is one still frame.
- ![polish][polish] **The start screen keeps one height** (at least 720 px, or the window less 48 px) instead of changing size with the number of recent files.

**Export**

- ![polish][polish] **The Export window is rebuilt.** It is wider and taller. On the left is an inset list of formats under a heading; on the right are the format's name with its extension, a line saying what it is, and the options as hairline rows under small group titles (File name, Size and position, Parts, Format options), each with a bold name and a line saying what it does. Only the options that apply to the format are shown (Draco for GLB, ASCII for FBX and STL; the parts list shows no scale, axis, origin or merge; the custom-scale row appears only when Custom is chosen).
- ![new][new] **Name the file.** A file name field with the same pills as Save scene (date, time, version, triangles, parts, size, percentage saved, optimised, selection and the source name), filled with what the file would be called anyway. A pill puts its piece in the name or takes it out; the version pill counts up when pressed again. Characters a file name cannot hold become `_`, and a typed extension is dropped, since the format adds its own.
- ![new][new] **A summary before you export.** Three figures (parts, triangles and an approximate file size) and a line at the foot saying "Saves as name.ext" (an OBJ adds "and a .mtl for the colours"). With nothing to export the line says so and the Export button is disabled.
- ![new][new] **Flatten groups and ASCII STL.** Flatten groups writes every part at the top level, without group folders, for tools that stumble on nested groups (not offered for formats without a tree or for one merged mesh). ASCII STL writes readable text instead of binary.
- ![polish][polish] **The choices are remembered:** scale, up axis, origin, merge, Visible only and Flatten. Selected only and the file name are not.
- ![fix][fix] **Ctrl+E, File › Export and the palette open the Export window itself,** with the format chosen last (GLB at first). They used to press the toolbar button, whose dropdown picks a format.

**Batch rename**

- ![polish][polish] **Batch rename is redesigned** to match Settings and Export. The rule column is wider; the tabs are one segmented control; every switch and every piece of a rule is a pill; the Quick tab shows what it built as a line of code; the scope is one list on every tab (Selection, Selection + contents, Selected parts only, Selected groups only, Whole tree), each with a line saying what it does, kept in step between the tabs; optional filters fold away and presets sit in a two-column grid. Each result row has a small kind tag, the old name quiet and the new name lit with the changed part highlighted (yellow for a warning, red for an error).
- ![new][new] **A Quick tab.** Between Find & replace and Pattern: the usual jobs without writing a pattern. Add text before and after the name, change the letters (As it is, UPPER, lower, Title Case, snake_case, kebab-case, camelCase), trim spaces, remove characters from the start and the end, and number the parts (Start at, Step, Digits from 1 to 8, a separator, before or after the name, and Start again per nothing, parent group, colour or size). A line under the options shows the pattern the choices make, Edit as pattern opens it on the Pattern tab with the numbering carried over, and a Quick rule can be saved as a preset.
- ![new][new] **Press a piece instead of typing it.** On the Pattern tab, two rows of buttons: the tokens (each puts `{token}` at the cursor) and the modifiers (each adds `:modifier` to the piece at or before the cursor), the ones that take a value with one to start from, like `strip(_)`, `slice(0,8)`, `pad(3,0)`, `round(1)` and `abbrev(12)`. Typing `{` for the list still works.
- ![new][new] **The preview shows what changed.** In the new name the part that differs from the old name is marked, and what both share at the start and the end stays plain. A "changed only" switch in the Preview header hides the names that stay the same. An empty preview says why ("Nothing changes yet. Make a rule on the left…" or "Nothing to rename in this scope…").
- ![polish][polish] **A bigger dialog.** It opens at 940 × 640 (was 880 × 580) and can be made no smaller than 700 × 440 (was 560 × 380). Fields have their labels above them, the optional filters are called "Only if…" (Name matches, Name does not match, Colour is, Kind, Depth, Triangles), the counter settings are always open, and Reset clears every tab, Quick included.
- ![fix][fix] **Whole word matches whole words,** and has its own switch next to regex and match case. The match may not touch a letter or a digit, in any script; an underscore or a dash counts as a boundary, so `Hub` is found in `Coupling_Hub_A`. It works with plain text and with regular expressions.

**Left sidebar and the tree**

- ![new][new] **The Collapse button has a menu.** The arrow in its corner (or a right-click) collapses or expands the whole tree, the selection (the selected groups and everything inside; for a selected part, the group it is in) or from the selection down. Without a selection those entries are dimmed. The Locate button is gone.
- ![polish][polish] **An import shows where it landed.** After Add to this scene or Import, the new parts are selected, the tree scrolls to them (opening the groups they sit in) and the camera frames them.
- ![fix][fix] **The drag handles stay put.** The right one used to scroll away with the sidebar. Both are now cells of the app grid, 16 px wide, centred on the gap between a sidebar and the viewport, the same on both sides (the left one is hidden while the sidebar is folded). A thin line shows in the middle once the pointer has rested on the handle for a moment (passing over it shows nothing) and fades out toward both ends. Double-click resets the width.
- ![polish][polish] **Minimum sizes.** The left sidebar cannot be dragged narrower than 220 px and the right one than 240 px (narrower, buttons and labels wrap or are cut off). The window has a minimum of 960 × 560: smaller, the app scrolls instead of squeezing the panels.
- ![polish][polish] **Folding the left sidebar leaves a 10 px strip of the dark window at the left,** so the view does not run to the edge.
- ![polish][polish] **Tree rows line up with the buttons above.** The colour swatch ends 14 px from the panel's edge (less the width of the scrollbar), the eye and swatch take 34 px, and a long name is cut 8 px before the eye.

**Viewport**

- ![polish][polish] **The dark background is a little cooler** (a touch more blue-grey).
- ![fix][fix] **The view cube hides an axis where it passes behind the cube.** Each axis line is drawn in pieces, and a piece that lies behind a face is left out; an axis dot that points away from you is drawn behind the cube and the others in front.
- ![polish][polish] **The Properties card puts the material row last,** under the facts and tags, and its strip is as wide as the cards around it.

**Performance**

- ![perf][perf] **The selection outline is drawn by the graphics card.** Up to 200 selected parts carry outline lines of their own that share the part's edges, so nothing is copied or uploaded when the selection moves. A drag with a bigger selection no longer rebuilds the outline on every move.
- ![perf][perf] **Opening a big model gets all the speed.** The picture for the Recents list, and the spare copy of the app that makes the next tab open instantly, now wait until you have stopped clicking for a moment instead of starting in the first seconds. No spare copy is kept beside a scene of more than 1,500 parts (a new tab then takes about a second longer). The viewport is no longer resized when its size has not changed.

**Interface**

- ![polish][polish] **One design language.** Fields, buttons, dropdowns and search boxes in dialogs (Export, Batch rename, Save screenshot, Flatten, the shortcuts search, text prompts) share one height (32 px), corner and edge, at rest, under the pointer and in focus, and keyboard focus is drawn on the Export format list, the Batch rename pills and segmented controls. The colours, radii and sizes are tokens now.
- ![fix][fix] **Labels and numbers are no longer selected by dragging or double-clicking.** Only fields, the console log and the help articles can be selected.
- ![fix][fix] **The logo, Menu and Export menus open at the same height** under the top bar, and the Commands menu stops at 520 px with a thin visible scrollbar.
- ![polish][polish] **The Transform card has room for 280 px** when it opens (the fields are taller). Reset puts the selection at the origin of its parent group (the world origin if it has none), turned to 0 and at scale 1; a group is reset as one rigid body, a locked part stays where it is, and an instanced part says to move it once with the gizmo first.

**The view cube**

- ![new][new] **The cube turns to the new view.** Clicking an axis dot or a
  face of the view cube now turns the camera there in a third of a second
  instead of jumping, and the cube follows. A drag on the viewport takes over.
- **Cleaner axes.** The dots are flat, with the letter centred in the circle;
  each line stops at the rim of its dot instead of running into the letter, and
  a line is cut where it passes behind a face of the cube, so the cube hides what is behind it.

**The library is a drawer**

- ![new][new] **A drawer along the bottom.** The library no longer takes
  the tree's place in the left sidebar: it slides up under the viewport,
  like the materials, from a button of its own on the bottom toolbar
  (Shift + L). Drag its top edge for the height. One drawer is open at a
  time: the library, the materials and the console give way to each other.
- ![new][new] **Look before you place.** A click on a tile now picks the
  part instead of adding it, and the right side of the drawer shows it: a
  view you can turn with the mouse and zoom with the wheel, its triangles
  and its size, and the same rows as Shape parameters. What is set there is
  what the part has when it goes in: by a double-click on its tile, by a
  drag into the view (the see-through copy follows the parameters too), or
  by *Add to scene*. The size chosen in the drawer's head still goes for
  every fastener.
- ![new][new] **More in the drawer.** One shelf at a time from a dropdown,
  a star that keeps a part on a *Favourites* shelf, large or small tiles,
  and *Clear* on the recently used.
- ![polish][polish] The button that folds the left sidebar away stands where
  the parts / library switch was, at the right end of the sidebar's stretch
  of the top bar; with the sidebar folded it stays next to Menu.
- ![polish][polish] The help clips in the command cards share one
  background and have their subject in the middle; the Smart fit clip loops
  without a jump (each part pops into its stand-in with a small swell, then
  the stand-ins fade away).

**New: fasteners**

- ![new][new] **Fasteners.** One command finds the bolts, screws, nuts and
  washers of a scene and selects them, ready to isolate or delete. It goes
  by shape, not by name: an exported assembly calls its screws
  `=>0_1_1_9_000009`, and on the 1,583-part test assembly two parts in all
  had a name that said what they were. A part is cut across its own axis
  and read as a profile — a round shank with a wider head, six flats around
  a hole, a flat ring — against the proportions in the ISO tables, so a hex
  bolt, a socket screw, a countersunk screw, a set screw, a hex, flange,
  cap or coupling nut and a plain or cup washer are told from the things
  that look like them: bushings, bearings, O-rings, grommets, shafts, pipe
  fittings and cable glands stay. 130 fasteners on the test assembly, in
  two to three seconds.
  - It has a panel of its own (the bolt on the bottom toolbar, the command
    list and the search), with a looping clip of what it does: the three
    kinds as switches, the largest thread to look for, and what was found
    as a short list — *102 bolts and screws · M4 ×80 · M6 ×22*. A click on a
    row narrows the selection to that kind.
  - Advanced: whole scene or the selection, certain finds only, pins and
    studs (plain round bars, off by default because a shaft is one too),
    shapes used at least so many times, a smallest thread.
  - A file saved in metres or inches is read at the unit in which its
    fasteners have fastener sizes, and the panel says so.
  - `fasteners.js` is a module of its own with no dependencies;
    `node tests/fasteners.test.mjs` checks it on 47 built shapes, and the
    self-test drives the panel on the library's own bolt, nut and washer.

**New: Smart optimise**

- ![new][new] **One card, one button.** At the top of *Reduce* in the right
  sidebar: every clean-up the app has, run one after another on the whole
  scene. Pick a level (Light, Balanced, Strong) or leave it on Auto, which
  chooses from how heavy the scene is and says what it chose. A line under
  the controls spells out what the run will do before you press Optimise.
- ![new][new] **A level is a starting point.** Under *Steps* each one has
  its own switch: empty and broken parts, parts hidden inside, bolts, nuts
  and washers (keep, simplify to cylinders, or delete), parts under a share
  of the model's size, and holes in flat faces (with the Fill holes panel's
  settings). *Reduce triangles* is a switch of its own with the triangle
  target beside it (`150k`, `1.5m`): off, the run only removes and tidies
  and every mesh that stays keeps all its triangles.
- ![new][new] **One undo for the whole run.** The steps report once, at the
  end (triangles before and after, parts removed); their own messages go to
  the log. One `Ctrl+Z` takes the whole run back and one redo re-applies
  it. Cancel stops before the next step and keeps what has already run.
  Also in the search as *Smart optimise*.

**Number fields and the Transform card**

- ![polish][polish] **Number fields are bigger, and no number is cut
  off.** A slider's value is a field you can see, 32 px tall (as high as a button) and at least
  60 wide, and it grows with what is in it, as does the field it turns into
  when you type. The fields of the command panels and of the Shape card
  follow the same height.
- ![fix][fix] **Position, rotation and size show the whole number.** The −
  and + of each field took half its width and the unit was printed over
  the digits, so −1091.234 read as −1091. The steppers now stand over the
  ends of the field while the pointer is on it, the unit follows the
  number, and when both do not fit it is the unit that gives way.
- ![polish][polish] **Transform is a floating card.** It rises into place
  at the foot of the left sidebar on the same surface as the command
  panels, clear of the sidebar's edges, instead of a strip docked to it. It
  still takes its own room under the tree and covers nothing.

**Right sidebar**

- ![polish][polish] **Cards slide open and shut.** A card of the right
  sidebar grows from its header and shrinks back into it instead of
  appearing at once, and its arrow turns with it. What is inside keeps its
  final layout while the card grows and is simply uncovered. A second click
  half-way turns it round from where it is. With "reduce motion" on, cards
  open at once as before.
- ![fix][fix] **A card opened at the foot of the sidebar stays in view.** It
  used to unfold below the edge of the window; the sidebar now scrolls with
  it as it grows, never so far that the card's header leaves at the top.
- ![new][new] **Heavy parts: tick, tick, delete.** A click on a row ticks
  it — a tick box takes the place of its rank — and a second click takes
  the tick off; rows ticked before stay ticked, and `Shift`+click ticks a
  run of them. The button under the list deletes the ticked rows and says
  what they weigh: *Delete 3 parts · 171.3k triangles*. One undo step. A tick
  leaves the camera alone; a right-click on a row goes to the part.
- ![fix][fix] **The Heavy parts list follows the scene.** A part deleted
  with the Delete key stayed listed until the tree was next rebuilt, and an
  undo did not bring it back into the list.
- ![polish][polish] **A button that cannot be pressed is grey.** A primary
  button that was switched off kept its blue at 40%, like a blue button
  behind glass (Optimise with no model loaded). It takes the plain surface
  and the dimmed text now, in the sidebar and in the command panels.

- ![polish][polish] **Cards start folded.** Every card in the right sidebar
  opens folded the first time (Properties has no fold, and Shading starts open). The ones you open
  or close are remembered, as before.

**Gizmo and selection**

- ![new][new] **Shift + wheel sets the snap step.** Holding `Shift` while
  dragging a handle snaps, as before; turning the wheel during that drag now
  sets what it snaps to — up for a coarser step, down for a finer one. A
  move steps through 1 · 2 · 5 × powers of ten, a turn through 1, 5, 10, 15,
  30, 45 and 90°, a scale through 0.01 to 1. The part takes the new step at
  once, and the step is kept for the drags after it.
- ![polish][polish] **A Snap pill beside Cam.** While snap is on, a pill at
  the top of the viewport says so and shows the step in the units on
  screen: *Snap 10 mm*, *Snap 15°*, *Snap × 0.1*. It follows the wheel and
  the gizmo's mode, and it stands beside the Cam pill without moving it.
  The SNAP badge in the readout beside the gizmo is gone (it also said 15°
  and 0.1 whatever the step was).
- ![fix][fix] **Reset in the Transform card took the part and left its
  outline behind.** The outline is built again where the part stands.
- ![fix][fix] **A hidden part kept its outline, and a part shown again had
  none.** `H` on a selected part left its outline on screen; Show all and
  the eye in the tree brought a selected part back without one. Every way
  of hiding and showing now ends with the outline of exactly the selected
  parts that can be seen.
- ![fix][fix] **`Shift`+`M` opened Materials and switched Measure on or
  off as well.** The Measure key now leaves the shifted key alone.
- ![polish][polish] **Menu comes first in the top bar**, the sidebar toggle
  after it.

**Measure**

- ![polish][polish] **Measure is yellow everywhere.** While measuring, a
  yellow *Measure* pill sits in the viewport beside the isolate pill (a
  click on it leaves the mode) and the Measure button is yellow. A click
  on a row in the Measurements card picks that measurement: its line is
  drawn thicker and its label turns yellow, and it stays on show after
  the mode is left. The camera-view pill shares the toolbars' surface and has a
  caret because it opens a list; the isolate, exploded, measure and snap pills
  are flat colours.

**Views**

- ![new][new] **An *Exploded* pill.** While the view is exploded a pill
  beside the camera pill says so (with the amount); a click on it puts
  the parts back and zeroes the sliders. Status pills (isolate, exploded,
  measure, snap) always sit just right of the camera pill, in that order,
  filled with their own colour, and the camera pill never moves when one
  comes or goes. The camera pill is smaller and has no tooltip.
- ![polish][polish] **Exploding is for looking.** Moving a slider lets go
  of the selection; parts can still be picked (and are outlined) but carry
  no transform gizmo until they are put back.
- ![polish][polish] **Smart fit keeps the exploded view.** It still fits the
  parts at rest, then puts the explosion back as it was, like Fill holes.
- ![fix][fix] **Select similar shape is no longer all-or-nothing.** It asked
  for the same vertex count, the same triangle count and a box within 0.1%,
  so copies of a leaf that differ a little in tessellation or size were
  left out. Now a part matches when it is close enough, and a new
  *Select similar* card in the right sidebar sets how close: a Strictness
  scrubber from 0 % (about the same size and weight) to 100 % (the very
  same shape, as before). It starts at 60 % (triangle count within 20 %,
  each side of the box within 10 % of the longest) and is remembered.
- ![polish][polish] **Undo goes back further.** The history held 30 steps; it
  now keeps 200 by default (Settings › General: Short 50, Normal 200, Long 500), with the last 30 of the kinds that carry geometry (delete,
  split, merge, bake, decimate and the like), so a big model does not run
  out of memory.
- ![fix][fix] **Delete small parts leaves hidden parts alone.** What is
  flagged, highlighted, counted, isolated and deleted is now only what is on
  show (the tree's eyes); the card says how many hidden parts it skipped.
  Showing or hiding a part (or undoing that) updates the count at once. When
  the small parts are isolated, what was on show before the isolation is
  what the threshold goes on choosing from.
- ![new][new] **Stacked copies.** A card (it opens over the viewport from the command palette) finds parts that sit
  on an identical copy (the same shape in the same place: drawn twice,
  flickering where they meet). It selects the extra copies and keeps the
  first of each; Isolate shows them, Delete removes them (Ctrl+Z brings
  them back). *Same place within* sets how exact "the same place" is (a
  share of the part's size) and *Also near copies* lets the triangle count
  differ a little. Hidden parts are not looked at.
- ![fix][fix] **Merge leaves the part where it was in the tree.** The merged
  part used to be put at the very end of the tree, outside every group. It
  now takes the place of the first part that went into it: same group, same
  depth, same spot (or the same group the user made).
- ![fix][fix] **Less flicker between panels lying on each other.** With the
  camera outside the model the near plane now goes to the model's nearest
  depth along the view (a twentieth of the way to the orbit target before),
  which gives the depth buffer several times the resolution at the usual
  distance: on the 3.5 m test assembly seen from 6.8 m, 0.001 mm instead of
  0.008 mm. (Faces that lie exactly on each other still fight; the Stacked
  copies card finds those.)
- ![fix][fix] **Undoing a fit in an exploded view no longer throws parts
  around.** The fit is made with the model at rest and the explosion put
  back after, but its undo put the parts back at rest and left them there
  among parts that were pushed apart. The explosion is now put back on them,
  from their own rest positions.
- ![fix][fix] **Merging in an exploded view.** The merged part was built at
  the exploded places and stayed there when the explosion was taken out.
  Merge now works on the model at rest and puts the explosion back after;
  undo does too.
- ![fix][fix] **Smart fit no longer fits (and moves) its neighbours.** Parts
  that share a shape with a fitted part were fitted with it, and put on its
  position, when they stood within 5 % of the model's size of it (176 mm on
  the 3.5 m test assembly). Only copies lying on the part itself (within 2 %
  of its size) go along now.
- ![fix][fix] **A dropped file can be added to the open scene.** Dropping a
  file on a scene that already has parts always opened a tab, and only the
  Import button could add one. Now a small question comes up: *Add to this
  scene* or *Open in new tab* (Esc or a click outside does nothing). On an
  empty scene the file opens there as before.
- ![polish][polish] **The selected part's material stands out in the drawer.**
  The whole card of the material (or materials) the selection uses is lit in
  a neutral grey, in the grid and in the list, instead of a thin blue ring
  round the thumbnail. The blue stays for the material picked in the panel.
- ![fix][fix] **Orbiting out of a 2D view** drops back to the perspective
  camera again (the check ran once a frame and never saw a drag, which
  OrbitControls applies inside its own handler). Pan and zoom stay in the
  view, and switching from one 2D view to another stays in 2D.

- ![fix][fix] **The 2D views have their grid back.** The grid shader cast
  its rays from the camera position, which is wrong for an orthographic
  camera (the rays run parallel), so Top / Front / Side showed no grid.
  The ray now runs from the pixel's near-plane point to its far-plane
  point, right for both projections.
- ![polish][polish] **Turn a library part freely.** Dragging the preview
  in the library drawer is a trackball: it turns about every axis, so a
  part can be rolled over and seen from underneath. Double-click returns
  to the first view.

**Tabs**

- ![fix][fix] **The top bar follows a sidebar steadily.** Folding or
  opening the left sidebar slides the tabs and the fold button on the
  same curve as the sidebar (the Menu word no longer blinks away
  half-way), and dragging the sidebar's edge keeps the button on the
  sidebar's edge at every width.

- ![new][new] **Right-click a tab.** *Duplicate scene* opens a copy of that
  tab's scene in a new tab, *Close all* (`Ctrl+Shift+F4`) and *Close others*
  ask once for all the unsaved scenes together, and *Open…* and *Open
  recent* are there too, the recent files in a list beside the row. The
  three scene commands are also in the search.
- ![polish][polish] **Every tab is one width.** A long name is cut in the
  middle, so its end (and the file's type) stays readable:
  `Menerga…O HP.fbx`. Nothing in a tab moves when it is picked: the open
  tab and the others share one layout.
- ![polish][polish] **A dot instead of the cube.** The icon is gone; the
  status dot leads every tab, open or not: yellow with unsaved changes,
  green when saved, faint while the scene is empty. A click on the open
  tab's dot still saves. The name no longer shows a text cursor
  (double-click still renames).

**Start screen**

- ![new][new] **Rebuilt.** The banner clip is gone. From the top: a search
  bar for the recent files (`Enter` opens the first match), a row of four
  tiles to start from (Open file… in the accent colour, New scene, Import…
  and the four shapes), then the recent files as cards with their
  pictures, name, type, size and when they were opened. The file opened
  last leads the cards at twice the width, marked *Continue*.
- ![new][new] **Drop a file anywhere.** There is no drop box: the whole
  window takes a file, and says *Drop to open* while one is held over it.
- ![fix][fix] **Settings and Keyboard shortcuts open in front.** They used
  to open behind the start screen, so nothing seemed to happen. The start
  screen now steps aside for them and comes back when they close, if there
  is still no scene. Settings opens on General, where the start-up options
  are; the separate Options popup that repeated them is gone.
- ![polish][polish] The arrow keys walk the cards (up and down by a row),
  the search hides while there are four files or fewer, and at most ten
  recent files are kept.

**Export and scene settings**

- ![fix][fix] **Cinema 4D opens the FBX.** A binary FBX carries a file
  id, a creation time and a code at its end that have to agree; the FBX
  SDK (Cinema 4D, Maya) checks them and refuses the file when they do
  not. The export wrote a random id and the time of day with a fixed
  code, so Blender and the app itself read the file and Cinema 4D said
  it could not. The three now agree. (An FBX exported before this can be
  re-exported, or opened in Blender and saved again.)
- ![fix][fix] **An FBX says what its units are.** The scene is in
  millimetres and the file claimed centimetres, so Cinema 4D showed a
  2.6 m machine 26 m long. The file now states its unit (millimetres, or
  whatever the export's Unit scale makes of them: × 0.001 is metres).
- ![fix][fix] **…and which way is up.** A scene written as it is, Z up,
  was labelled Y up; it is labelled as written, so Blender, Maya and
  Unreal stand it up. A scene that is shown Y up (Scene settings) is
  labelled Y up. Cinema 4D does not turn a file on import.
- ![polish][polish] **The Up axis choice says what it does**: *Keep as in
  the scene* and *Turn Z-up into Y-up*. A model that already stands Y up
  (anything that came from Cinema 4D or a glTF) must be kept: turning it
  lays it on its side.
- ![fix][fix] **The binary FBX shares its materials.** It wrote one
  material per mesh: a 778-part model arrived in Cinema 4D with 778
  materials and took 13 s to open. It writes one per colour, as the ASCII
  FBX does: 40 materials, 1.4 s.
- ![fix][fix] **OBJ: parts that share a name stay separate.** Repeated
  names get a number (`name.001`). Cinema 4D goes by name and made one
  object of all of them: 778 parts arrived as 325.
- ![docs][docs] All eight formats were exported from a 778-part,
  793,550-triangle model and opened in Cinema 4D 2026.4: GLB, glTF, FBX
  (binary and ASCII), OBJ, STL and USDZ read with every triangle; PLY
  cannot be read there (Cinema 4D has no PLY import).
- ![fix][fix] **Up axis and Scene scale stay out of the file, for every
  part.** A part moved after either setting changed was written turned or
  resized, the others were not, and instanced parts differed again. The
  two settings are how the scene is shown and measured; Export's own
  Scale and Axis decide the file.
- ![fix][fix] **A position typed in the Transform panel lands where the
  field says** in a Y-up or scaled scene.
- ![fix][fix] **Screenshots from Top, Front and Side are not stretched**
  when the picture has another shape than the viewport.
- ![fix][fix] Draco export names the file `.glb` when it had to fall back
  to an uncompressed one; CSV export honours "Selected parts only"; ASCII
  FBX gives repeated names a number, as the binary writer does.

**Security**

- ![fix][fix] **The local server answers only its own page.** Any web page
  open in the browser could send requests to `localhost:4242`: stop the
  server, or start a conversion on a file of its choosing. Requests are
  now refused unless they come from the app's own address, folders are no
  longer listed, and nothing is served from `.git` or `.venv`.
- ![fix][fix] **Names and scene data from a file are never run as markup.**
  Three places built HTML from them without escaping: measurements saved
  inside a GLB, the label that follows a dragged tree row, and the Flatten
  dialog. The `?file=` address is checked the way it will be fetched.

**Parts and scenes**

- ![fix][fix] **A fresh install converts STEP again.** The OpenCascade
  package had moved to a version the converter cannot import; the
  versions are pinned, and `start.bat` installs again when the
  requirements change or the first install failed.
- ![fix][fix] **Hidden instanced parts no longer wreck a Select all.** A
  hidden copy was made into a mesh from a zero matrix, and the NaN that
  came out spread to every selected part.
- ![fix][fix] **Undo brings back deleted instanced parts.** Deleting every
  copy of a repeated part removed the set from the scene; undo restored
  the rows but nothing drew them.
- ![fix][fix] **A colour changed in the material editor is exported**, and
  shows on the part's swatch in the tree. Duplicate and Split keep the
  material a part is wearing.
- ![fix][fix] **Smart fit, Centre pivot and Bake no longer fight the
  exploded view.** A fitted part jumped back to its old origin on the
  next move of the slider.
- ![fix][fix] **Clay does not stick.** A part made from an instance, or a
  cloner copy built while Clay was on, kept the clay material for good.
- ![fix][fix] **Split by proximity cannot freeze the tab.** Its grid is
  bounded: on a plate or a box one triangle used to fill millions of
  cells.
- ![fix][fix] **Measurements are shown in the unit chosen**, not in
  millimetres with another unit's name after them.
- ![fix][fix] **Files with invalid coordinates open.** NaN and Infinity
  are set to 0, with a notice; before, the camera became not-a-number
  and the viewport never recovered. A broken or empty file gets a plain
  message, and a file with no meshes says so.
- ![fix][fix] **FBX files with leftover geometry open directly.** A
  geometry attached to no object, left behind when its object was deleted
  before export, made the FBX reader give up, and the file went through
  the slower Assimp conversion instead. Such geometry is now skipped. The
  fix is a patch to the bundled three.js `FBXLoader.js` and has to be
  carried over when three.js is updated.
- ![fix][fix] **Import no longer turns later Opens into appends**, and
  "Don't ask again" can be undone under Settings › Storage.
- ![fix][fix] **Quit asks about every open scene**, not only the one in
  front.

**Viewport**

- ![fix][fix] **New scene takes the selection outline with it.** With the
  gizmo on, the outline of a selected part is not kept with the parts, and
  emptying the scene forgot it without removing it: the old part's cyan
  outline stayed drawn in the new scene for good. (It is also why the
  top-view screenshot test failed only in a full run: the picture was
  right, with the previous test's outlines in it.)

- ![fix][fix] **HDRI works the second time.** Leaving it disposed the
  environment it would need again.
- ![fix][fix] **One slow frame no longer doubles the render loop**, and a
  long load is not reported as a stalled viewport.
- ![fix][fix] **Fit frames the model in orthographic views.**
- ![fix][fix] **Parts keep their size on screen after a scene scale.** The
  moving-view culling measured boxes from before the change.

**Interface**

- ![polish][polish] **Fill holes: the button is on the right**, after the
  size field, in line with the panel's other buttons.

- ![fix][fix] **Switches can be reached with Tab and flipped with Space.**
  All of them were out of the tab order.
- ![fix][fix] **Tooltips follow what they describe**: the save state on a
  tab, Collapse / Expand all. Icon-only buttons keep a name for screen
  readers.
- ![fix][fix] **Enter presses the button that has the focus** in a dialog,
  instead of always accepting. `Esc` in a dropdown closes the dropdown
  only.
- ![fix][fix] Single-key shortcuts (`4`, `5`, `M`, `F2`) no longer fire
  behind a dialog or while a dropdown has the focus.
- ![polish][polish] **British spelling throughout** the visible text.
- ![fix][fix] Lock / Unlock on a mixed selection; "Add group parts to
  selection" adds; plain Find & Replace treats `$` as text; OBJ export
  keeps non-Latin names; ASCII FBX keeps its precision at any export
  scale; cloner radial mode no longer leaves a copy at the centre.

- ![fix][fix] The unsaved dot survives more than 30 edits followed by
  undoing them; shortcuts no longer reach the scene from behind a dialog;
  the add-shape button answers the keyboard; `Alt` + right-drag zooms in
  orthographic views; snap follows the grid's own cell.
- ![fix][fix] Split: "Watertight regions" is gone (it did what Vertex
  connectivity does); the read-out and the preview agree with the split;
  undo frees what the split made. Merge keeps shading when one source had
  no normals. Fit to budget and Heatmap free what they replace.
- ![fix][fix] Cloner: redo of "create" and "add sources" no longer adds a
  second undo step or throws the remaining redos away, and undo puts the
  source parts back where they were.
- ![polish][polish] Labels and roles for screen readers on switches, fields,
  menus and windows; keyboard focus is visible on sliders, links and
  tick boxes; shortcut tips over the viewport are easier to read.
- ![refactor][refactor] Well over a thousand lines of code and 150 style rules that
  nothing used are gone: the old flatten routines, the bounding-box
  overlay, the per-part colour picker, the old Add menu, the scene
  settings window.

**Launchers and converter**

- ![fix][fix] **A STEP file with nothing solid in it says so**, instead of
  a traceback. Cancelling a conversion stops the converter on macOS and
  Linux too, and a cancel that arrives early is not lost. A long
  conversion keeps printing its log past 200 lines.
- ![fix][fix] `--open` reuses a converted file only when it came from the
  same source; a `.gltf` with side files is refused with a reason.
- ![fix][fix] The launchers check for Python 3.10 to 3.12 and say what is
  wrong when it is another version; a hidden start no longer waits on a
  key nobody can press, and reports a failed start.
- ![docs][docs] A LICENSE file (MIT).

- ![fix][fix] `step2glb.bat` uses the project's own Python and passes
  every argument on. The macOS launchers are executable after a clone,
  and line endings are fixed by `.gitattributes`.
- ![fix][fix] Starting the app twice opens the window on the server that
  is already running instead of starting a second one.

## v0.13.0

v0.12 gave the app things to build with. v0.13 makes it feel like an app.
It installs to the desktop with an icon of its own, opens in a window
with no address bar, no browser tabs and no extension buttons, and can
fold its title bar away so the top bar is all there is. The scene tabs
grew up with it: drag them into the order you want, save from the tab's
icon, and keep your sidebars where you put them from one scene to the
next. And a view that is moving now gives up what you cannot see anyway.

**An app of its own**

- ![new][new] **Install it.** The app carries a web-app manifest and its own
  icon, so Chrome and Edge offer *Install*. Installed, it has a desktop and
  Start-menu shortcut and a window to itself.
- ![new][new] **A window with nothing of the browser in it.** `start.bat`
  (and `serve.py`) now open the app in Chrome's app mode, falling back to
  Edge, then Brave: a title bar and the app, no address bar, no tabs, no
  extensions button. It uses your usual browser profile, so settings and
  recent files are the ones you had. `python serve.py --tab` opens an
  ordinary browser tab as before.
- ![new][new] **Fold the title bar away.** In the installed app the `^` in
  the title bar hides it: the window's own buttons float over the top
  right corner and the app's top bar becomes the title bar. Its empty
  stretches drag the window; buttons, tabs and fields stay clickable, and
  Export and the screenshot button stay where they were.
- ![new][new] **A cover on the start screen.** The start screen opens with a
  wide clip across its top, the app's name over it and the essentials
  underneath.

**Tabs**

- ![new][new] **Drag tabs into order.** Press a tab and pull it sideways. It
  rides with the pointer, the others slide over to make room, and it
  drops into the place nearest to it. It moves left and right only and
  stops at the ends of the row; `Esc` puts it back. Nothing in the strip
  is rebuilt or measured again while a tab is held, so tabs of different
  widths cannot flicker between two places.
- ![polish][polish] **The tab, rearranged.** The icon on the left stays an
  icon and carries the status dot on its corner: yellow with unsaved
  changes, green when saved. A click on the icon saves. The close button
  is at the right end, always there on the open tab and under the pointer
  on the others. Other tabs show the yellow dot when they have unsaved
  changes.
- ![new][new] **Same sidebars in every tab.** Switching tabs keeps the
  sidebar widths, and the folded left sidebar, of the tab you came from,
  applied before the tab is shown so nothing slides. A switch under
  Settings › General turns it off, and each tab keeps its own again.

**While the view moves**

- ![perf][perf] **Tiny parts are skipped.** While you orbit, pan or zoom, a
  part that would be under about three pixels across is not drawn, and it
  is back on the first frame after the view stops. CAD assemblies are
  mostly screws, washers and clips: on the 1,583-part test assembly that
  is 77 parts at the opening view and 570 with the model zoomed out.
  Parts that are large for the model are always drawn, so a model seen
  from far away keeps its shape, and so is whatever is selected.
- ![perf][perf] **The resolution gives way before the frame rate does.**
  Only when moving frames are actually slow, the picture is drawn a step
  coarser (80%, 65%, 50%) until the view moves freely, and sharp again
  when it stops. A scene that already moves at the display's rate is left
  alone. The step that was needed is remembered for the next movement.
- Both are switches under Settings › Performance, on by default.

**Interface**

- ![polish][polish] **The renderer picker moved to Settings › Performance.**
  The top bar ends with Export and the screenshot button.
- ![polish][polish] **The Menu button has no arrow**, and drops its word for
  the icon alone when the sidebar's stretch of the top bar is too narrow
  for it.
- ![polish][polish] **One flat accent blue on the loading bar**, in place of
  the blue-to-purple gradient, with a faint band of light drifting across
  it while something loads.
- ![polish][polish] **The triangle count over the viewport's corner is gone.**
  Properties shows the same totals.
- ![fix][fix] **Properties no longer jumps when a tag appears.** The tag row
  under the name keeps its line, so "782 hidden" arriving on Isolate does
  not push the rest of the card down.

## v0.12.0

**The biggest release yet.** Until now MeshOptimiser opened a model and
made it lighter. From today it also *builds*. There is a library drawer
full of real parts — hex bolts, wing nuts, pillow blocks, I-beams, gears,
a stepper motor — and you drag them straight onto your model. A file
that arrives lying on its side forty metres from the origin stands up on
the floor from one card. A five-million-triangle scene comes down to the
budget you type. The screws nobody will ever see are found for you. And
for the first time a black part on a dark background actually looks like
something.

**New: the library drawer**

- ![new][new] **86 parts, one drawer.** Flip the left sidebar from the
  parts tree to the library and there they are, each with its own
  picture, on six shelves:
  - **Shapes** — cube, sphere, torus, capsule, wedge, rounded box, star…
  - **Fasteners** — hex bolt, Allen screw, countersunk, button head,
    carriage bolt, U-bolt, eye bolt, set screw, threaded rod, rivet,
    washer, spring washer, retaining ring, standoff…
  - **Nuts** — hex, lock, jam, flange, cap, castle, wing, thumb, square,
    coupling, eye and T-slot nuts.
  - **Pipes and flanges** — tube, elbow, tee, cross, reducer, pipe cap,
    flange.
  - **Profiles and plates** — I-beam, box tube, angle, C-channel, T and Z
    profiles, T-slot extrusion, flat bar, round and hex bar,
    perforated and slotted plate, gusset, hinge.
  - **Machine parts** — gear, rack, sprocket, pulley, bearing, bushing,
    pillow block, shaft collar, linear rail, spring, handwheel, star
    knob, pull handle, levelling foot, wheel, enclosure, a stepper motor.

  Search the drawer, pick a thread size and length once at the top (M6 ×
  24 by default) and every fastener comes out in it. The six parts used
  last wait at the top. Nothing in it is a dead mesh: every part stays
  parametric, and its Shape card changes it afterwards.
- ![new][new] **Drag it onto the model.** Pull a part out of the drawer
  and a see-through copy follows the pointer, already standing where it
  will land: square to the face under the pointer, or upright on the floor
  where there is none. Let go and a bolt sits on the plate, the right way
  up. The ghost lives outside the parts, so it is never picked, counted
  or exported.
- ![new][new] **A bolt that brings its own nut.** Tick *Nut on the bolt*
  on a hex bolt, an Allen screw, a threaded rod or an eye bolt, choose
  the nut (a wing nut, a castle nut, a flange nut…) and how far from the
  head it sits. It is part of the bolt's own shape, in the bolt's
  thread, so it follows Size, Length and Orientation, is one row in the
  tree and one undo step, and cannot sit past the end of the thread. A
  nut with a side to it goes on facing the head, as it would be tightened.
- ![new][new] **Type "add flange".** The search (`Ctrl+K`) reaches into
  the drawer too: `Enter` adds the part.

**New: stand it up**

- ![new][new] **Align to floor.** Files arrive anywhere and any way up: a
  part modelled 40 m from its origin, an assembly on its side, a scan
  centred on nothing. One card fixes all of it. Turn the model in steps
  about X, Y and Z (90° by default, any angle you like) and say, for each
  axis, which side goes to zero: low, middle, high, or leave it. Middle /
  middle / floor stands it on the grid over 0,0,0. You watch it move,
  a whole run of adjustments is one undo step, and the transform is worked
  out from scratch each time, so nothing drifts. Group origins and the
  exploded view go along with it. Switch it on for every file you open and
  never see a model lying down again.

**New: make it lighter, faster**

- ![new][new] **Select hidden parts.** The screws inside a housing, the
  board under a cover, the bearing nobody will ever see: one command finds
  every part that cannot be seen from outside and selects it, ready to
  delete or isolate. It has a panel of its own, with a looping clip of
  what it does.
- ![new][new] **Fit to budget.** Type the number of triangles the scene is
  allowed to have. The densest meshes are reduced first until the total
  fits. One undo step, a preview before anything is committed, and Cancel
  while it runs.
- ![new][new] **Smart fit learned shapes.** One box says where a part is
  and nothing of what it is: a bracket becomes a brick, a frame a slab.
  Two new stand-ins keep the outline.
  - **Boxes** covers the part with a handful of boxes, each sized and
    turned to one piece of it. A levelling foot becomes a slab and a bar,
    an L two bars, a frame four. 12 triangles a box.
  - **Blocks** rebuilds it from a coarse grid, with its steps, arms and
    openings in the right places, in a few dozen to a few hundred
    triangles — whatever the part had.

  Both fall back to a plain box when they would not be clearly lighter.
- ![new][new] **Optimisation report.** The scene as it was opened against
  the scene now, plus the size of the last export: the number to show
  whoever asked for a lighter file.
- ![new][new] **Preview and Cancel.** Decimate and Fit to budget show
  their result before it is applied, and the long jobs can be stopped.
- ![polish][polish] **Delete small parts shows what it will delete.** With
  the small parts isolated, what is on screen follows the threshold as
  you drag the slider. It is the same isolation, adjusted, so it adds no
  undo step of its own.

**New: see what you are looking at**

- ![new][new] **Clay (`5`).** One key and the colours are gone: every
  part in the same plain material, so all that is left is form — edges,
  curvature, what stands in front of what. It is a real lit material, so
  the lights, the headlight and the studio reflections shape it.
  Right-click the button for porcelain, steel or red wax. Export and Save
  switch to Solid while they run; nothing of it reaches a file.
- ![fix][fix] **Parts no longer show through thin covers from a distance.**
  Zoomed out, the parts under a sheet-metal cover or a thin panel used to
  flicker through it, worse the further away the camera was. The depth
  buffer loses precision with distance, and the camera's near plane sat a
  millimetre or so in front of the lens however far out the view was. It
  now follows the camera out: while the camera is outside the model the
  near plane moves to half the empty gap in front of it, and comes back as
  you zoom in. On a 0.7 m test assembly seen from 5.7 m that takes depth
  precision from about 1.6 mm to under a thousandth of a millimetre.
  Orthographic views never had the problem and are unchanged; saved scenes
  still store the clip preset's own near value.
- ![new][new] **Dark parts have a shape.** On a plain background the scene
  was lit by three lights and had nothing to reflect, so a dark part came
  out as a flat near-black silhouette and dark parts in front of dark parts
  could not be told apart. The plain backgrounds now carry a soft studio as
  their surroundings: it is never shown, only reflected and used as gentle
  fill, so dark parts get an edge, a sheen and a visible top and side
  while colours stay what they were. HDRI mode replaces it with the chosen
  environment and puts it back on exit.
- ![new][new] **A headlight that follows the view.** The three scene lights
  are fixed, so a face turned away from all of them stayed flat however
  you orbited. A soft light now travels with the camera, from just above
  and beside the eye: it always falls on what you are looking at, and its
  highlight slides across the surfaces as the view turns, which is what
  makes their form readable. It is off in HDRI mode, where the environment
  does the lighting.
- ![polish][polish] **Lighting rebalanced** to make room for the two above:
  the sky light and the key light are a little lower, so overall
  brightness and colours are unchanged.

**Search and input**

- ![new][new] **Search finds parts and the library.** `Ctrl+K` used to find
  commands. It now also finds parts by name (`Enter` selects and frames
  one, hidden ones included) and library parts (`Enter` adds one; "add
  flange" works too). Commands run lately lead the list while nothing is
  typed, and the card eases to the height of its results.
- ![new][new] **A calculator in the search.** Type a sum (`12*25.4`) or a
  length (`2 in`, `50 mm in in`, `3 thou`) and `Enter` copies the answer.
- ![new][new] **Every number field drags.** Not only the fields a panel set
  up: any number field is wired the first time the pointer comes over it,
  with its own min, max and step, or a step read off the number in it
  (12.50 moves in hundredths, 24 in ones). Dialogs and the Properties
  panel are covered as they are built.
- ![polish][polish] **Move snaps to a step you can see.** A fixed 10 units
  was invisible on a model metres across and a leap on one of a few
  millimetres. The step is now a round number near a twentieth of the
  scene's size, and always a multiple of the floor grid's lines.

**Interface**

- ![polish][polish] **Right sidebar regrouped** into Inspect, Clean up and
  Reduce; Measure, highlight and the grid and sun toggles moved to where
  they are used.
- ![polish][polish] **Selection in the tree is easier to find.** The
  selected row sits on a faint accent wash that runs the full width, and
  the groups above it are clearly tinted instead of only hinted.
- ![polish][polish] **Unsaved is a dot** on the tab, yellow or green,
  instead of a pill.
- ![new][new] **Help clips** for Split and Select hidden parts, and a
  re-cut one for Smart fit. The app's own pictures and clips are now kept
  by the browser between reloads and only checked for changes.
- ![new][new] **Drop overlay** on the viewport while a file is dragged in.
- ![fix][fix] **Recent files keep their location** after a drag-and-drop,
  a re-pick, and when the file has changed size.
- ![refactor][refactor] **Section plane removed**, along with the clipping
  code it threaded through every material. Isolate, X-ray and Select
  hidden parts are the ways to see inside a model.
- ![refactor][refactor] **Stylesheet consolidated** — overridden and dead
  rules removed, duplicate selectors folded. No visual change.

## v0.11.0

v0.10 made the app fast. This one changes how it is *used*. Scenes open
in tabs, tools appear where you are working instead of sitting in a
sidebar, every number can be dragged, and one Settings window replaces
three places that used to hold options. The interface is darker,
quieter and more of one piece — and Fill holes, the tool people came
for, got options and a much harder test. Underneath, a speed pass on a
5.4-million-triangle assembly took the pauses out of orbiting, selecting,
scrolling the tree and switching view modes.

**Highlights**

- ![new][new] **Scene tabs.** Every tab is a scene of its own, with its own
  parts, materials, undo history and camera. *New scene* and *Open* never
  replace a scene that has something in it — they open a tab. A spare
  tab is kept warm in the background, so a new one is there at once, and
  switching does not reload anything. The tab shows the scene's name
  (double-click to rename) and an **Unsaved** pill that saves on click;
  hover a tab and its icon becomes the close button.
- ![new][new] **Command panels.** Split and Fill holes are no longer cards in
  the sidebar. Run the command — `X`, `P`, the search, the right-click
  menu, the toolbar — and its panel appears over the bottom-left of the
  viewport, the way Plasticity does it. `Enter` runs it, `Esc` puts it
  away (and only then clears the selection).
- ![new][new] **Fill holes shows itself.** A six-second silent loop runs
  across the top of its panel and dissolves into the card: the holes of a
  real part closing a few at a time (90 KB). It plays only while the
  panel is open.
- ![new][new] **Fill holes, advanced.** An *Advanced* fold in the panel: fill
  through holes, blind holes and open holes separately; ignore holes
  under a size; a depth limit; a flatness tolerance for meshes whose
  flat faces are not quite flat; and a switch for the rule that keeps
  openings which shape the part. Stress-tested on a 5.4-million-triangle
  assembly across nine option sets — 334 meshes compared edge by edge
  before and after, none left with a new open edge — and two ways it
  could have left a crack are closed for good (see Fixes).
- ![new][new] **Everything a number can be dragged.** Shape parameters take one
  line each: no slider underneath, drag the number or its label
  sideways, click to type. Shift is ten times faster, Alt ten times
  finer. The size limit of Fill holes and the numbers beside the sidebar
  sliders work the same way.
- ![new][new] **One Settings window.** General, Viewport, Camera, Performance,
  Scene and Storage in one place, with a search across all of them. The
  viewport's display popover and the separate Scene settings window are
  gone — their controls moved in, so nothing changed underneath.
- ![new][new] **Properties always has something to say.** With nothing selected
  it describes the scene. With a selection the triangle count leads the
  card, and when triangles were saved that is the headline: "21,688
  triangles −34% · was 32,728 · saved 11,040", the share of the scene,
  and where the part ranks by weight.
- ![new][new] **All commands in one list.** The "…" at the end of the bottom
  toolbar opens every command that acts on the model, with its shortcut;
  what cannot run right now is dimmed. The search is its own popup,
  standing on its button, with suggestions that follow what is selected.
- ![new][new] **Shortcuts that make sense together.** `H` hide · `Shift+H` hide
  the rest · `Alt+H` show all · `S` isolate · `X` split · `P` fill holes
  · `Ctrl+M` merge · `Ctrl+B` smart fit · `Ctrl+Shift+G` ungroup ·
  `Ctrl+I` invert selection · `Ctrl+E` export · `Shift+M` materials. One
  table, exact combinations, nothing fighting (Ctrl+R no longer also
  switched the gizmo; `S` over the tree no longer did two things).

**Also new**

- ![new][new] **What an action saved** shows beside the triangle count for a few
  seconds: "−427,543 (−38%)".
- ![new][new] **Isolate says so:** a pill at the top of the viewport reads
  "Isolated · 3 of 1,583 parts"; click it to show everything again.
- ![new][new] **Materials dock can be resized** — drag its top edge and the edge
  of its inspector; both are remembered, double-click resets.
- ![new][new] The bottom toolbar never runs into the shortcut tips: when it
  would, the tips step aside; on a viewport narrower than the toolbar
  itself, buttons fold away from the right into the "…" list.
- ![new][new] **The tree scrolls sideways, and its indent holds still.**
  The indent used to be recalculated from the width of the sidebar and
  the depth of the hierarchy, so the whole tree slid left and right
  while a sidebar edge was dragged; and long names ended in an ellipsis.
  The indent is now one fixed step per level and names are shown in
  full. When a row is wider than the panel a scrollbar appears under the
  tree (Shift + wheel and a sideways swipe work too): the names slide,
  the eye and colour column stays where it is.

**Fixes**

- ![fix][fix] **Material names keep up.** A new material is named after its
  colour (it used to get a random code that looked like one) and such a
  name follows the colour. Applying a preset — or undoing one — while
  the editor is open refreshes the editor's name, colour, sliders and
  preview; undo gives the name back too.
- ![fix][fix] **Fill holes can no longer leave a crack.** A fill is accepted only
  if every edge it cuts is covered by a cap and every cap can be closed
  completely; and the zero-area stitch triangles CAD meshes carry are
  removed with the wall they were stitched to instead of being left
  hanging.
- ![fix][fix] A scene made only of added shapes showed 0 triangles in the status
  bar and no viewport statistics.
- ![fix][fix] The start screen's four shape tiles all showed the torus: their
  thumbnails were rendered at the same time through one shared mesh.
- ![fix][fix] The status bar and Properties gave different sizes for the same
  mesh data right after loading; both count shared geometry once now.
- ![fix][fix] Dragging a number in Shape parameters could go on following the
  mouse after the button was released, and a click did not always put
  the caret in the field.
- ![fix][fix] Tooltips inside a command panel appeared instantly and cut to the
  first words, like the toolbar's; they now wait and show the whole tip.
- ![fix][fix] **Undoing a group could throw its parts across the scene.**
  A selected part hangs on the move gizmo's pivot, and the undo entry of
  a new group recorded that pivot as the part's parent. Group some parts,
  select something else, press Ctrl+Z: the grouped parts jumped (1,300
  units in the test) and stayed attached to the gizmo. The gizmo now lets
  go before the entry is recorded. The same for groups in a flat list.
- ![fix][fix] **Redoing "group a group" moved everything inside it.** Clicking
  a group selects its parts, so grouping it also listed every part in it;
  redo re-attached each of those parts to the new group with a matrix
  meant for its old parent. Only what the action really moved is redone.
- ![fix][fix] **Hide selected (`H`) is an undo step.** It had none: Ctrl+Z
  after `H` undid whatever came before it.
- ![fix][fix] The flat-list rule that hides the expand column no longer
  depends on which rows happen to be filled.

**Faster**

A speed pass, measured in Chrome on a 1,583-part, 5.4-million-triangle
assembly in two forms: flat, and with its full hierarchy (2,768 groups,
ten levels deep). Every number below is that model on one machine.

- ![perf][perf] **Group dots are one draw.** Every group has a dot at its
  origin, and each dot was a sprite of its own: 2,768 extra draw calls
  per frame on the nested model, four fifths of the frame. They are now
  one instanced sprite. Orbiting went from 47–50 fps with dropped frames
  to the display's full rate.
- ![perf][perf] **Group origins in one pass.** They were worked out by walking
  the whole tree once per group, and that was repeated once per group on
  every selection change. A click on a part took 64 ms; it takes 8–10.
  The same loop was the 4.5-second freeze while a nested model opened.
- ![perf][perf] **The tree keeps its rows.** A rebuild used to throw every
  row away and make it again. Rows that are still needed are now kept
  and corrected, the ones whose place changed are moved, and the browser
  is no longer asked for a layout in the middle of it. Hide, isolate and
  show all: 55 ms → 16–20. Undo or redo of a group: 115 ms → 24.
  Grouping 445 parts: 137 ms → 63. Typing in the search: 170 ms → 35–55.
- ![perf][perf] **The tree scrolls as a layer.** It had a see-through
  background, so the browser repainted every visible row on each scroll
  step; and every row was `content-visibility:auto`, which with 4,350
  rows cost more per frame than it saved. Rows away from the view are
  plain empty boxes, rows are filled a screenful ahead rather than one
  per scroll step, and rows left far behind are emptied again. Wheel
  scrolling dropped 28 % of frames; it now drops about 1 %.
- ![perf][perf] **Fewer, larger instance groups.** A shape that repeats was
  drawn as one instanced object from three copies up. Each such object
  needs a shader and a GPU pipeline of its own, rebuilt on every change
  of view mode: 106 of them on the nested model, 2.7 seconds frozen per
  switch to wireframe or x-ray. Instancing now starts at 32 copies.
  A switch takes 0.3–0.5 s, and the frame rate is unchanged.
- ![perf][perf] **X-ray draws each surface once**, not twice (its blending has
  no order, so one pass gives the same picture).
- ![perf][perf] **Select all on an assembly with instances** refreshed every
  matrix in the model once per instance: half a second the first time.
  It refreshes the one mesh it has just made.
- ![perf][perf] **Dragging a sidebar edge** set a variable on the page root on
  every mouse move, which restyled the whole document several times per
  move (15 fps). The width is applied once per frame, directly, and the
  variable is set when the drag ends: 20–30 fps on the nested model's
  4,350-row tree, where every row still has to be laid out at the new
  width. Dragging the materials dock is once per frame too.
- ![perf][perf] The shortcut tips are measured in the next frame instead of
  in the middle of a selection change (13 ms per change saved), the
  document tab is aligned without laying the page out twice, and numbers
  in the tree are formatted by one shared formatter.
- ![perf][perf] The split preview no longer runs on every selection change — only
  while the Split panel is open.
- ![perf][perf] The Materials card in the sidebar is gone, and with it a rebuild of
  its list on every change to the tree.

**Look**

- ![polish][polish] The interface black is `#101010`, floating surfaces `#161616`:
  menus, popups, tooltips, dialogs and panels are one darker tone.
- ![polish][polish] No pure-white text on controls — one set of tokens
  (`--tx-control…`) for buttons, dropdowns, fields and menu rows.
- ![polish][polish] Flat slider dots, no outlines around sidebar cards, Properties as a
  fixed dark card, tighter tree rows (25px), every control in the
  materials bar one height, grey instead of blue for what is switched on
  in the bottom toolbar (blue stays for the active tool).
- ![polish][polish] Export sits on the right with Screenshot; Undo and Redo are
  keyboard-only; the start screen uses the plain white mark.

**Removed**

- ![polish][polish] **The GPU path tracer** (the Render button, `pathtracer.js` and the
  second three.js build only it used). Nothing is fetched from a CDN at
  start-up any more.
- ![polish][polish] The Materials card in the right sidebar (the dock is the one place
  for materials), the "N parts in hierarchy" line, the viewport settings
  popover and the Scene settings window (both now in Settings).

**Tests**

- ![new][new] 41 in-app tests (was 31) and 88 hole-filler checks (was 76): scene
  tabs, command panels, dragging numbers, the scene card and triangle
  delta, isolate, material names and presets, the fill options and the
  stitch-triangle case; a rebuilt tree equals one built from nothing
  after every kind of change; group dots are one draw; group undo and
  redo leave every part in place; Hide is one undo step.
- ![docs][docs] A performance driver in `tests/perf/` measures frame gaps under
  real input in a Chrome it starts itself.

## v0.10.1

- ![perf][perf] **Starts without the internet.** The libraries the app
  needs to start are bundled in `vendor/` instead of being fetched from
  a CDN on every launch: three.js r172 (both builds and the add-ons in
  use), three-mesh-bvh, meshoptimizer and the lucide icon set — 37
  files, 4.2 MB, each with its licence. Startup no longer waits on
  unpkg, and the app opens, edits and exports with no connection at
  all. Still fetched on demand: the path tracer, the KTX2 texture
  transcoder and the in-browser STEP / glTF-Transform / Assimp
  converters.
- ![fix][fix] **The icon set is pinned** (lucide 1.52.0). It was loaded
  as "latest", so an upstream release could rename or drop an icon
  without warning.
- ![polish][polish] Text on buttons, dropdowns and slider values is a
  soft grey instead of white (it brightens on hover); two-button rows
  split evenly, including the Smart fit / Merge row; a slider's value
  field keeps its size when you click it to type.

## v0.10.0

The biggest release so far. v0.9.0 made the app trustworthy; this one
makes it *fast* and gives it tools it did not have. There is a real
hole filler now, a proper materials panel, a decimator that keeps your
normals and UVs, and a parts tree that keeps up with 5 million
triangles — plus a long list of bugs that only show up on real
assemblies, found by working through one.

**Highlights**

- ![new][new] **Fill holes.** One click closes the bolt holes, slots,
  pockets and engraved lettering in flat faces and leaves the rest of
  every mesh untouched. It can tell a hole from a boss, from the bore of
  a washer and from an opening into a cavity. 4,136 holes — 427,543
  triangles — gone in about two seconds on the test assembly.
- ![new][new] **Decimate, rebuilt** on meshoptimizer: keeps normals, UVs
  and colours, takes a triangle budget, and its result reaches the
  export.
- ![new][new] **Materials dock** — slides up like the console: filter,
  sort, inspect, select or isolate the parts that use a material,
  assign it to the selection.
- ![perf][perf] **Everything you touch is immediate.** Selecting,
  hovering, deleting, undoing, switching views, dragging a slider: each
  was measured on a 1,583-part / 5.4M-triangle assembly and the slow
  step removed. Heavy tools run in background workers.
- ![fix][fix] **The hierarchy shows what is there.** Empty groups stay
  listed, the tree scrolls in one direction with everything lined up,
  and every editing action can be undone.
- ![polish][polish] **A calmer interface** — Plasticity-style viewport
  and view cube, one button scale, three corner radii, Inter bundled,
  fewer pop-ups.

**Fill holes**

- ![new][new] **Fill holes** (Optimize card, and the command palette)
  closes holes in flat faces and leaves the rest of each mesh exactly as
  it is — no remeshing, no decimation. It finds the flat faces, the
  loops cut into them and the surface behind each loop, and only acts
  when that surface is a hole:
  - through holes, blind holes, counterbores, slots, pockets and
    engraved lettering are closed; a counterbore or a pocket with a hole
    in its floor goes as one feature or not at all;
  - a boss or pin standing on a face is left alone (it rises above the
    face instead of sinking into it);
  - an opening that is what the part *is* — the bore of a washer, a nut
    or a bushing — is left alone (it is wide both for its face and for
    the part as a whole);
  - an opening that leads into a cavity or out through a curved surface
    is left alone;
  - plunged and flow-drilled holes, which are a plain hole on one side
    and a collar on the other, are filled from the hole's side and the
    collar stays;
  - "up to N mm" sets the largest hole, measured across its widest
    point.
  The cap is triangulated flush with the face from the face's own
  vertices, so normals, UVs, vertex colours and material ranges carry
  over and the mesh stays closed. Works on the selection, or on every
  visible part when nothing is selected; one undo step; the result is
  what gets exported. The search runs in background workers: on the
  1,583-part test assembly at 12 mm it closes 4,136 holes in 438 parts
  (427,543 triangles fewer) in about two seconds, and none of the 110
  changed meshes that were checked gained an open edge.

**Decimate**

- ![new][new] **meshoptimizer simplifier** — reduction runs on the index
  buffer and keeps normals, UVs and vertex colours (the old path
  stripped parts to bare positions). Multi-material parts keep their
  material ranges. Falls back to the basic simplifier offline.
- ![new][new] **Target…** — a triangle budget for the whole selection,
  next to the −25 … −90% presets, with a live "12,400 → about 6,200
  triangles" readout.
- ![perf][perf] Runs in background workers, several parts at a time; the
  page stays responsive during a large run.

**Materials**

- ![new][new] **Materials dock** — the materials panel was a 228 px
  popover that ran off the top of the viewport. It is now a dock that
  slides up from the bottom like the console, as wide as the viewport:
  filter by name, colour or type; order by use, triangles, name or
  colour; a grid that uses the whole width; and an inspector for the
  picked material (colour, roughness, metalness, opacity, textures, how
  many parts and triangles use it) with Edit, Select parts, Isolate and
  Assign to the selection. The bottom toolbar and the tips ride up with
  it; the console and the dock take turns.

**Parts tree and groups**

- ![fix][fix] **The tree hides nothing.** A group vanished from the
  hierarchy as soon as it had no live parts — after its parts were
  dragged out or deleted — although it still existed in the scene. Every
  group is now listed; one with nothing in it says "empty" and can be
  filled again, renamed or deleted. Empty containers in an imported file
  are listed too.
- ![fix][fix] **Deleting a group deletes the group.** Delete on a
  selected group, and "Delete group" in the context menu, remove the
  group row with its contents, and one undo brings both back. (Deleting
  only the parts inside a group leaves the group, empty.)
- ![new][new] **Settings → Delete groups when they become empty** (off by
  default). When on, a group that held something before an action and
  holds nothing after it is removed with that action — one undo restores
  both. Groups that were already empty are never touched.
- ![fix][fix] **Parts tree scrolls in one direction.** It used to scroll
  sideways with the eye / colour column pinned to the right edge; rows
  were as wide as their own text, so pinning only worked for long rows —
  scrolled sideways, the eyes of short rows slid left while the others
  stayed, and the pinned column trailed behind the wheel. Every row is
  now exactly as wide as the panel, the icon column is an ordinary last
  cell, long names end in an ellipsis (the full name shows on hover),
  and deep hierarchies get a narrower indent step instead of running
  off the edge.
- ![polish][polish] **Parts tree** — neutral icons, selection shown on
  the label and icon in the accent blue, group rows show their part
  count, more room at the right edge. Only the row that was clicked is
  bright: clicking a group hints the parts inside it instead of lighting
  them all up, and parents of a selected part are hinted the same way.
- ![polish][polish] **Parts search** has a clear button, is dimmed while
  empty and idle, and the six buttons under it span the panel's width.
- ![fix][fix] **Import → Append keeps the existing tree** instead of
  moving every existing part into "Untraced"; totals and model size
  cover the whole scene afterwards. A failed load no longer turns the
  next Open into an append, or replaces the file Revert reloads.

**Speed**

- ![perf][perf] **Selection is immediate on large models.** Every
  selection change re-created every icon in the document (about 90 ms on
  a 1,500-part tree); icons are now rendered once. Selection outlines no
  longer block the click: cached edges are drawn at once, small parts
  are built inline within a few milliseconds, and anything heavier gets
  a bounding box while its edges are computed in a worker. On the
  1,583-part assembly a click went from ~140 ms to under 15 ms, and the
  first click on a 125k-triangle part from a one-second freeze to none.
- ![perf][perf] **Highlight and gizmo appear with the press.** A tree row
  is selected when the mouse button goes down rather than when it comes
  back up, and the outline and gizmo are rebuilt before the next paint
  instead of one frame later. Outlines of heavy parts are computed in
  the background after a model loads, so the first click on a large
  part shows its real outline at once. Measured on the same assembly:
  selected 4–8 ms after the press, outline and gizmo ready by 15 ms.
- ![perf][perf] **Hovering the parts tree keeps up with the pointer.**
  Finding the row under the cursor walked all 1,500+ rows — about 7 ms
  each time, several times per mouse move, so a row lit up some 22 ms
  late. Off-screen rows are now skipped (`content-visibility`); the same
  measurement is 0.3 ms and hover starts within about 2 ms.
- ![perf][perf] **The parts tree only builds the rows you can see.** A
  rebuild used to write every row and then replace ten thousand icon
  placeholders: 325 ms on a 4,350-row tree, paid again by every undo,
  search keystroke and visibility toggle. Rows are now empty shells
  until they scroll into view and icons are CSS masks. A rebuild takes
  about 60 ms, and undoing a 710-part delete went from 700 ms to 80.
- ![perf][perf] **Delete is immediate.** Deleting parts rebuilt the tree
  twice (once hidden inside the "recount flagged parts" step). The rows
  of the deleted parts are now taken out and the group counts updated in
  place: about 30 ms for 710 parts instead of 780, with a result
  identical to a full rebuild.
- ![perf][perf] **Fill holes and Decimate run in background workers**,
  up to four meshes at a time. A whole-model hole fill went from 4–5
  seconds of frozen page to 1.7 seconds of a page that still responds.
  Where workers cannot start, the tools run on the page as before.
- ![perf][perf] **Switching between Cam, Top, Front and Side is
  instant.** Each switch built a new camera, and the renderer prepares
  every part again for a camera it has not seen — seconds on a large
  model, every time. One camera now changes its projection in place; the
  first frame after a switch costs the same as any other frame.
- ![perf][perf] **No stalls after loading.** The pick-acceleration trees
  were built 25 meshes at a time with rendering paused. They are now
  built in 8 ms slices while the browser is idle, without touching the
  buffers the renderer uses.
- ![perf][perf] **The size-threshold slider recounts when it is let
  go**, not on every pixel of the drag, and no longer rebuilds the tree.
  The Delete button reads "Calculating…" until the new count is in.
- ![fix][fix] Collapsing and re-expanding a group no longer brings the
  rows of deleted parts back.

**Viewport and camera**

- ![polish][polish] **Viewport** — Plasticity's cool grey background
  (`#28282b` on screen; the old value came out near-black); a view cube
  in the top-right corner, sitting in the corner of its three axes with
  a labelled dot at the end of each — click a dot or a face to look
  along that axis; triangle statistics moved to the
  top-left as a quiet readout; the grid toggle left the toolbar (`G`
  and the command palette still switch it); nothing drawn over the
  viewport can be selected as text.
- ![new][new] **View cube** — click a dot or a face for the orthographic
  view along that axis; the view pill names it (Top, Bottom, Front,
  Back, Side, Left). Orbiting out of an axis view returns to the
  perspective camera from where you are, at the same size on screen —
  it used to be locked until you picked "Cam". The face under the
  pointer takes its axis colour.
- ![polish][polish] **Viewport toolbars** — two dark pills in the manner
  of Plasticity: tools down the left edge, display controls along the
  bottom centre with a search button that opens the command palette.
  Contextual shortcut tips sit, faintly, at the bottom right; the
  triangle readout moved to the top right.
- ![polish][polish] **Floor grid** adapts to zoom the way Cinema 4D,
  Blender and Houdini do: finer lines fade out and the next decade
  takes over, so density on screen stays constant and the horizon no
  longer shimmers. Quieter overall.
- ![polish][polish] The selection box is a soft blue pane with a thin
  dashed edge and square corners.
- ![fix][fix] **The move readout showed "Y +0.00" and "Z +0.00"** while
  dragging a part that is rotated: it read the travel along the wrong
  axes. Move and rotate readouts now follow the gizmo's own axes.
- ![polish][polish] Scrollbars have no arrow buttons; tooltips on the
  viewport tools appear at once and show only the name and the
  shortcut, beside the tool pill rather than over its icons; group names
  are a soft grey instead of white; the renderer picker ends level with
  the sidebar.

**Interface**

- ![new][new] **The command search finds every sidebar control.** Every
  button, dropdown, slider, switch and field in the sidebars is listed
  under its card's name when the palette opens (read from the page, so
  it cannot fall out of step). A button entry runs the button; any
  other entry opens its card, scrolls to the control and focuses it.
- ![polish][polish] **Startup screen** redesigned in two columns: drop
  zone, Open / Import / New, start from a shape, and three option
  switches on the left; resume and a filterable recent-files list on
  the right.
- ![polish][polish] **Top bar** — Add, Cloner and Fit are gone (shapes
  are added from the tool pill, Cloner from the command palette);
  Screenshot and Render sit on the right, ending at the viewport's
  edge. The status bar spans the viewport only, so both sidebars run
  to the bottom of the window.
- ![polish][polish] **Top bar and edges** — the app icon is a plain
  white mark with a menu arrow instead of a blue tile; the sidebar
  toggle's pressed state is a quiet fill, not a glowing ring; the right
  sidebar starts and ends level with the viewport, and so does the
  search field; the FPS readout sits beside Console and keeps its
  width.
- ![polish][polish] **Three corner radii for the whole page** — 4px for
  tiny chips, 6px for every control, 10px for every container (cards,
  menus, tool pills, the viewport, dialogs, docks). The page used
  thirteen values between 2 and 16px.
- ![polish][polish] **One surface for everything that floats** — menus,
  popovers, tooltips, toasts, dialogs and windows take their colour,
  radius, ring and shadow from a single set of `--surface-*` tokens
  instead of each defining its own.
- ![polish][polish] **Inter is bundled** (`vendor/inter`, SIL Open Font
  License), so the app looks the same on every machine, and nothing in
  the interface is bold.
- ![polish][polish] **Fewer status messages.** Everyday edits — delete,
  paste, duplicate, group, add a shape, new scene — no longer pop a
  toast; the result is on screen already. They are still written to the
  log console. Toasts remain for what you could not otherwise see:
  clean-up and mesh-operation results, files written, the reason a
  command did nothing, and every warning and error.
- ![polish][polish] **Card headers** have a real chevron in a small hit
  area instead of a 7px text triangle, centred on whole pixels, with
  equal space above and below; sliders keep the normal pointer over the
  thumb as well as the track.
- ![polish][polish] **Shape picker** uses flat line icons like the rest
  of the toolbar (it showed small shaded renders) and opens beside its
  button.
- ![polish][polish] Properties rows fit on one line (Diagonal removed),
  the viewport has rounded corners, the right sidebar scrolls without a
  scrollbar and clips its cards on rounded corners, the app icon is the
  same size as the other top-bar buttons, sliders keep the normal
  cursor, and keyboard focus shows one consistent ring.
- ![fix][fix] **Small windows** — the right sidebar was pushed off the
  edge when the window got narrow (the status bar's text held the
  viewport column open). The column now shrinks; the status bar drops
  the vertex and memory counts, then the file name, instead of wrapping
  or overlapping; the shortcut tips fold into one column and move above
  the bottom toolbar rather than sitting on top of it.

**Fixes**

- ![fix][fix] **A second geometry edit on the same part could stop the
  viewport from drawing** ("setIndexBuffer … is not of type GPUBuffer",
  every frame). The WebGPU renderer decides whether an object's buffers
  need uploading by comparing attribute names and version numbers, not
  the geometry's identity, so a freshly built geometry that replaced
  another freshly built one went unnoticed whenever the part shared its
  material with other visible parts. Every tool that swaps geometry
  (Fill holes, Decimate, Smart fit, bake, and their undo / redo) now
  gives the new geometry version numbers of its own.
- ![fix][fix] **The remaining gaps are closed** — values typed into the
  transform panel (steppers, wheel and Reset included; a held stepper is
  one step), tree drag-and-drop, the eye icon on a group row and every
  other visibility toggle, Materials-panel Add / Duplicate / Merge /
  Delete / presets, context-menu "Rename group" and deleting an empty
  group are all undoable.
- ![fix][fix] **Visibility toggles reach instanced parts** — the eye
  icon, Hide unselected, group toggles and hide-by-colour all go through
  one helper.
- ![fix][fix] **Cloner copies are exported and saved** (only the source
  part used to be written). Exports also reuse one material per
  (material, colour) pair instead of one per part, "Origin: bbox centre"
  is centred correctly, and a merged export keeps mirrored parts facing
  outward.
- ![fix][fix] **Cancel stops a STEP conversion** — the loader's Cancel
  ends the polling and kills the converter on the server
  (`POST /api/cancel/<job>`); opening another file does the same. A
  conversion can no longer finish later and replace the scene, and the
  loader no longer polls forever after a server restart.
- ![fix][fix] Adding a shape highlighted the previously selected row in
  the tree instead of the new part.
- ![fix][fix] Undoing the creation of a selected group left Properties
  showing a group that no longer existed ("Group -2").
- ![fix][fix] Opening the Export menu flipped the arrow on the **File**
  button instead of its own (both wrappers share a class and the code
  took the first one).
- ![polish][polish] The "Instances promoted" notice goes to the log
  console instead of popping a toast on every click.

**Testing**

- ![new][new] **`tests/selftest.js`** — open the app with `?selftest` to
  run 31 regression tests inside the live app (groups, flatten, every
  undo path, export, save round trip, import-append, decimate,
  shortcuts, selection speed). `?selftest=groups` runs a subset.
- ![new][new] **`tests/holefill.test.mjs`** — `node tests/holefill.test.mjs`
  checks the hole filler on shapes built in the test (through, blind,
  counterbored, pockets, engraved letters, a boss, a washer, a hollow
  box): the result must be closed, the right volume, and untouched
  where it should be.

**Known issues**

- Fill holes works on flat faces; holes in curved surfaces are left
  alone. A flow-drilled hole is closed but its collar stays, as a small
  stub on the inside.
- Merge cannot be redone after an undo.
- Dragging a part out of a cloner is not undoable, and undoing a cloner
  does not always return its sources to their original group.
- Values typed into the transform panel do not refresh a group's stored
  origin on undo.
- A newly created group appears collapsed.
- `serve.py` never clears converted files out of `inbox/`.

## v0.9.0

v0.8.0 modernised the plumbing. v0.9.0 is a *reliability* release: a
stress test on a 1,583-part / 5.4M-triangle assembly plus three code
audits turned up tools that destroyed geometry, exports that ignored
edits, and a group of actions that Ctrl+Z could not undo. Those are
fixed. The interface also gets one button scale, readable secondary
text, and a full proofreading pass. The app is now called
**MeshOptimiser** everywhere.

**Data loss and wrong output**

- ![fix][fix] **Decimate destroyed parts** — the removal count was taken
  from the un-indexed corner count (three per triangle) instead of the
  welded vertex count, so at −50% most parts were reduced to zero
  triangles. −25 / −50 / −75% now remove that share (a 2,208-triangle
  sphere becomes 1,656 / 1,102 / 550).
- ![fix][fix] **Decimate never reached the export** — the reduced
  geometry was not registered under the part's hash, so export, merge
  and the memory readout still used the original mesh. Export now reads
  the geometry the part is actually drawing.
- ![fix][fix] **Save scene lost its state** — the state marker node was
  flagged invisible and `GLTFExporter` skips invisible objects, so the
  camera, view settings, hidden parts and measurements were never
  written. Hidden / flagged state now travels on each part's own node,
  so duplicate part names can no longer mis-assign it.
- ![fix][fix] **Save scene mangled names and nested the scene** — glTF
  loaders rewrite node names (`Group 2` → `Group_2`, `Cube.001` →
  `Cube001`) and every save / reopen wrapped the scene in one more
  `Group`. Real names are stored in node extras and restored on load;
  the wrapper is gone. Two consecutive round trips now return an
  identical tree.
- ![fix][fix] **Exporting in Wireframe / X-ray / Heatmap** baked the view
  mode into the file (line primitives, see-through or heat-coloured
  materials). Export and Save scene run in Solid and restore the view
  mode afterwards.
- ![fix][fix] **Recenter and Center pivot did not reach the export** —
  the exported file kept the old positions. Bake transforms also
  displaced parts that sat under a moved parent.
- ![fix][fix] **PLY export hung on "Preparing export…"** whenever the tab
  was in the background. Long jobs (load, decimate, screenshots) no
  longer stall in a background tab either.
- ![fix][fix] **Hidden instanced parts exported with NaN transforms**;
  they now export from the matrix they were built with.
- ![fix][fix] **Bake / Center pivot on shared geometry** — a part that
  shared its buffer with another part (any duplicate) was transformed
  twice, or moved a part that was not selected. Shared buffers are now
  copied before they are edited.
- ![fix][fix] A new model no longer inherits the previous model's
  Recenter offset, and Save scene no longer silently overwrites the
  previous model's file.
- ![fix][fix] An export that fails before the writer starts now takes
  the loader down and reports the error instead of leaving
  "Preparing export…" on screen.

**Undo / redo**

- ![fix][fix] **Six tools pushed no undo entry**, so Ctrl+Z reverted an
  older, unrelated action: Decimate, Recenter on origin, Bake
  transforms, Center pivot, Recompute normals and Delete empty groups.
  All six now undo and redo.
- ![fix][fix] **Undo of Isolate / Show all / Hide unselected** now
  restores instanced parts as well.
- ![fix][fix] **Redo of Smart fit and Paste group** no longer discards
  the rest of the redo stack; a co-fitted sibling is restored to its
  real parent.
- ![fix][fix] A change too large to keep an undo copy of now clears the
  history (with a notice) instead of leaving Ctrl+Z pointing at an
  older step.

**Groups, Flatten and cleanup**

- ![fix][fix] **Flatten and "Delete empty groups" now work from the
  tree.** Selecting a part moves its mesh out of its group in the scene
  graph, and both tools trusted the scene graph: "last level" and
  "keep N levels" over-flattened, rows reshuffled, and a group full of
  live parts could be judged empty. All five Flatten modes, scoped and
  whole-tree, pass with undo and redo; rows keep their order and group
  ids.
- ![fix][fix] **Grouping parts from different levels** no longer pulls
  the outside part into the first part's group; the new group is
  created at the level the selection shares.
- ![polish][polish] A flatten that changes nothing says why instead of
  reporting success, "Preserve user groups" defaults off when every
  group is one you created, and the depth readout is no longer off by
  one.
- ![polish][polish] **Group rows show their part count**, so a collapsed
  group says what it holds. New groups no longer reuse a name.
- ![polish][polish] **Cinema 4D-style nesting** — a child's icon sits one
  step in from its parent's and the connector runs right up to it; a
  flat list drops the empty arrow column.

**Selection, shortcuts and measuring**

- ![fix][fix] **The ruler only measured on Ctrl+click** while the
  on-screen hint said "Click two points". A plain click now picks,
  dragging still orbits, and picking no longer changes the selection.
- ![fix][fix] **Delete acted on the scene behind an open dialog**, and
  Ctrl+S also toggled Isolate. Global shortcuts are ignored while a
  dialog is open or a dropdown has focus.
- ![fix][fix] **Shift-click range** no longer sweeps up rows hidden by a
  search or a collapsed group; a search shows matches inside collapsed
  groups; selection back / forward never restores deleted parts.
- ![fix][fix] Wrong shortcut hints: move / rotate / scale are `E` / `R`
  / `T` (not `W` / `E` / `R`), and Reveal in tree is `Shift+S`.
- ![fix][fix] "% of model" showed 173% for a single cube in a new
  scene; it now measures against what is in the scene.
- ![fix][fix] Three sidebar cards (Selection & actions, Auto cleanup,
  Optimize) would not collapse.
- ![polish][polish] The Measurements card only appears while there is a
  measurement to list.

**Interface**

- ![polish][polish] **One button scale** — every button, dropdown
  trigger and close button uses three sizes (26 / 32 / 40px) from
  tokens at the end of the stylesheet. Heights previously ran from 17 to
  40px, text from 10 to 13px and radius from 4 to 8px depending on the
  panel. Full-width action buttons are left-aligned so their icons form
  one column.
- ![polish][polish] **Readable secondary text** — tertiary text (labels,
  triangle counts, status bar) measured about 3:1 against the 4.5:1
  minimum and now passes. Accent-coloured text uses a lighter tint;
  fills and borders keep the brand colour.
- ![polish][polish] **Selected rows** get a filled background as well as
  the label colour, and keyboard focus shows one consistent ring.
- ![polish][polish] More room at the right edge of the parts list.
- ![polish][polish] The top bar uses the same dark surface as the two
  sidebars.
- ![polish][polish] **Menus restyled** — every dropdown and context menu
  is a dark rounded panel with a solid accent bar under the pointer and
  white text; shortcuts are plain text at the right, and menus that pick
  a value mark the current one with a check.
- ![polish][polish] **New primary colour** — the accent is now blue
  (`#0d99ff`) instead of indigo, across buttons, sliders, highlights and
  the primitive thumbnails.

**Copy**

- ![docs][docs] **Proofreading pass** — about a hundred corrections to
  labels, tooltips, toasts and loader messages: stale or wrong
  information (the Add tooltip listed a shape that isn't in the menu,
  Blender listed as Y-up, "Open or drop a .step file" ignoring seven
  other formats), self-contradicting tooltips, developer jargon in
  user-facing text, plurals ("1 parts"), and consistent American
  spelling and `…`.
- ![fix][fix] "Decimated" / "Decimate failed" toasts used a type with no
  styling; cancelling the path-tracer save showed "Render saved — null";
  every FBX load failure was titled "FBX too old to read".
- ![docs][docs] **Renamed to MeshOptimiser** in the app, launchers,
  server banner and exported-file headers. The default export name is
  now `mesh_optimised`. The saved-scene format id and browser storage
  keys are unchanged, so existing scenes and settings keep working.

**Known issues**

- No undo yet for: values typed into the transform panel, tree
  drag-and-drop, the eye icon on a group row, Materials-panel actions
  (Add, Duplicate, Merge, Delete, presets) and context-menu "Rename
  group". Ctrl+Z after any of these undoes the action before it.
- Import → Append replaces the existing tree hierarchy.
- Cloner output is not included in exports or saved scenes.
- Cancel does not stop a STEP conversion that is already running.
- The eye icon on a single part and "Hide unselected" have no visible
  effect on instanced parts.
- Merge cannot be redone after an undo.

## v0.8.0

v0.7.0 made *presentation and discoverability* feel modern. v0.8.0 makes
the *plumbing* feel modern: the floor grid rewritten as an
industry-standard ray-marched shader, a single keycap-chip primitive
that ties every shortcut surface together, the undo system rebuilt as a
flat command registry (no more wrapper chains), and every runtime-
injected `<style>` block lifted out of the JS and into the stylesheet.

**Viewport — ray-marched infinite grid**

- ![new][new] **Ray-marched floor grid** — `_makeShaderGrid` rewritten
  to the industry-standard pattern (Blender / Godot / Bevy / Fyrestar's
  `InfiniteGridHelper`). The shader runs on a fullscreen NDC quad,
  reconstructs the eye ray per pixel, intersects with the active plane,
  and writes its own analytic depth biased along the plane normal. No
  more `PlaneGeometry(2e6, 2e6)` losing vertex precision at distance, no
  plane edge to fall off the screen at oblique angles, no
  `polygonOffset` quirks under WebGPU — coplanar geometry (e.g. a cube
  bottom sitting at `z=0`) always wins the depth test cleanly.
- ![fix][fix] **Sub-pixel grid jitter under orbit** — the previous
  camera-follow shifted `mesh.position` by sub-pixel amounts every frame
  which shifted `positionWorld` of each vertex which made `fwidth()` /
  `fract()` read slightly different values per frame (visible 1–2 px
  shimmer along the grid lines). The ray-marched shader is camera-
  independent, so there's no mesh to drift.
- ![fix][fix] **Cube-on-grid Z-fight** — solved analytically by the
  shader's depth write + `uPlaneBias` instead of the previous
  `depthFunc:LessDepth` strict-less trick that occasionally lost ties.

**Keyboard shortcuts — unified across the app**

- ![new][new] **Redesigned Shortcuts modal** — sticky search input at
  the top, category headers with lucide icons (File / Edit / Selection /
  View / App), 2-column grid per group, multi-key combos rendered as
  separate keycap chips joined by a faint `+`. Footer hint points at
  the command palette. Opens via `?` or the logo-dropdown "Keyboard
  shortcuts" item.
- ![polish][polish] **`.kbd-chip` shared primitive** — single class now
  owns the keycap look on the bottom-center hint strip, tooltips, the
  command palette rows, the brand menu's mini-changelog, the Shortcuts
  modal, and the cmdk `↵` indicator. Combo splitting (`Ctrl+Shift+O` →
  three chips joined by `+`) is consistent everywhere.
- ![polish][polish] **Bottom-center hint strip — faint and chip-based**
  — transparent (no card chrome), each input verb (`Click`, `Drag`,
  `Scroll`, `Right-click`, `Esc`, `Shift`, `W` / `E` / `R`) renders as a
  small keycap chip. The hint reads as a row of pills instead of a
  paragraph of `<span>` separators.

**Selection & Actions card — Smart fit polish**

- ![polish][polish] **Smart fit + caret merged** — same background, no
  inner seam, rounded outer corners only. Hover lights each half
  independently (no `:has()` cross-highlight). Subtle hairline divider
  between them. Yellow accent scoped to `--ac → --wn` inside the
  popover so its sliders + checkbox match the warn-yellow trigger.
- ![polish][polish] **Smart fit dropdown sliders** — switched from the
  default 18 px white-thumb `<input type=range>` to the same
  `.scrub-range` 4 px track + 12 px accent thumb the sidebar's
  Threshold slider uses. Gradient fill animates with the value.
- ![polish][polish] **Sidebar card spacing** — Selection & Actions,
  Auto cleanup and Optimize cards converted from inline
  `<div style="height:Npx">` spacer divs to flex+gap on `.section-b`.
  Uniform 6 px gaps; no more arbitrary 6 / 10 mix.

**Fixes**

- ![fix][fix] **Tree summary stuck at "1 parts in hierarchy"** —
  `totalParts` was counting every part-kind tree node, including
  deleted-but-tracked ones. Now counts only live parts; deleting the
  last part correctly shows "0 parts in hierarchy".
- ![fix][fix] **Stranded group origin dot after delete** — when every
  part inside a group was deleted, the group's origin-dot sprite
  remained at the stale world position. The dot reconcile walk now
  bubbles "has live descendant" up the ancestor chain and skips groups
  with zero live parts.
- ![fix][fix] **Group selection no longer prompts for a name** — the
  toolbar "Group selection" button used to pop a "New group" dialog
  asking for a name. Now it acts exactly like the `Ctrl+G` shortcut:
  creates the group with `Group N` and lets you rename inline.
- ![fix][fix] **Path tracer on empty scene** — clicking the aperture
  button with no model loaded now toasts "Nothing to render — load a
  model or add a primitive first" instead of throwing `Scene is empty`
  into the console and opening a broken modal.
- ![fix][fix] **Material panel: add no longer toasts a confusing hint**
  — the "Material added — Select parts and use Duplicate to assign"
  toast is gone. Creating a material just creates it; the new entry is
  visually selected in the panel.
- ![fix][fix] **Material panel: duplicate works without a part
  selection** — duplicating a material previously demanded parts be
  selected ("Select parts first" toast). Now duplicate always clones
  the material into `state.userMaterials`; if parts happen to be
  selected they receive the clone as a convenience.
- ![fix][fix] **Material panel: merge cleans up properly** — absorbed
  materials are now removed from `state.userMaterials` and disposed,
  matching Delete's cleanup. Previously they lingered as zero-count
  ghost rows in the panel and leaked GPU resources.

**Internals — industry-standard rewrites**

- ![refactor][refactor] **All runtime `<style>` injections lifted into
  the stylesheet** — 8 blocks (~490 lines) across app dialog, Save
  Screenshot dialog, material editor popup, custom select widget,
  Advanced flatten dialog, `_DraggablePopup` chrome, Batch Rename
  dialog, and tree drag-and-drop. Every block lives under a labelled
  `── Section ──` comment header in `index.html`. No more sweep
  gotchas where the same CSS exists in two places.
- ![refactor][refactor] **Undo as a command registry** — 11
  monkey-patches around `undoLast` / `redoLast` collapsed into a single
  `_UndoOps.register('typename', {undo, redo})` dispatch table covering
  21 op types (boxify, merge, group, flatten, batchRename, duplicate,
  paste-group, measure-add / -delete / -clear, addPart, primParams,
  vis, hierGroup, hierUngroup, userGroupRemove, materialEdit, color,
  delete, split, transform, transformGroup, groupTransform). New op
  types now register with one call; no more 19-deep chain-of-
  responsibility indirection on every Ctrl+Z. The plugin-facing
  `_appHooks.undoHandlers` extension API (used by `cloner.js`) is
  preserved by design.
- ![refactor][refactor] **Renderer lifecycle owner** — `_RendererOwner`
  module encapsulates create + apply-config + device-lost glue. The
  fallback retry no longer duplicates the option list; `applyConfig`
  is re-usable for any future rebuild path.
- ![refactor][refactor] **Popover dismiss helper** — `_Popover.dismiss`
  centralises outside-click + Escape for the context menu, brand menu,
  export menu, and add-primitive menu. ~20 lines of duplicated
  `addEventListener('click') / keydown` boilerplate gone. Future
  popovers declare intent (containers, isOpen, capture, escape) instead
  of owning the glue.
- ![refactor][refactor] **Right-click context menu CSS** — `_ctxBuild`
  used to write `row.style.cssText` and add per-row `mouseenter` /
  `mouseleave` listeners. Replaced with proper `.ctx-menu-row` /
  `.ctx-menu-sep` / `.ctx-menu-icon` classes and a CSS `:hover` rule.
  Shortcut chips inside rows reuse `.kbd-chip` for consistency.
- ![refactor][refactor] **Off-grid design tokens audit** — dropped 5
  unused space tokens (`--space-3`, `--space-5`, `--space-9`,
  `--space-11`, `--space-18`). The remaining off-grid escape hatches
  (`--space-7` and `--fs-9/10/11/12`) all have real callers.

## v0.7.0

v0.6.0 made authoring feel modern. v0.7.0 makes *presentation and
discoverability* feel modern: a GPU path tracer that turns the viewport
into a portfolio-grade render, a contextual hint strip that teaches the
UI as you use it, a Cloner you can build C4D-style by dragging parts in,
and a Revert-to-source escape hatch for when the edit pile gets away
from you.

**Path tracer — portfolio renders from the viewport**

- ![new][new] **New `pathtracer.js` module** — three-gpu-pathtracer hooked
  up to the viewport via a new aperture button (top-right of the canvas).
  Click to open a render modal that accumulates samples in the background
  while the live WebGPU viewport keeps responding. Save the result via the
  shared FSA picker (same naming + folder memory as the Screenshot flow).
- ![new][new] **Parallel WebGL2 scene** — the host runs WebGPU but
  three-gpu-pathtracer needs WebGL2, so the module spins up a separate
  offscreen `WebGLRenderer` and mirrors meshes / camera / lights into a
  classic-three scene. Geometries are shared, materials are re-bound as
  fresh `MeshStandardMaterial`s, GPU resources tear down on close.
- ![new][new] **Aperture button** in the viewport (`#tg-render`,
  lavender tint) sits beside Screenshot. Pre-1.0: slow, beautiful,
  on-demand — no per-frame accumulation.

**Cloner — drag-to-build + centred arrays**

- ![new][new] **Standalone Cloner** — top-bar **Cloner** button now creates
  an empty cloner with no sources when nothing is selected. Drag parts
  into the cloner row in the tree to register them as sources (C4D-style).
  Rebuild is reactive; empty cloners emit nothing but remain fully
  functional until you populate them.
- ![new][new] **`centerArray`** — toggle centres linear / grid arrays on
  the cloner origin instead of growing in +direction. With the source
  hidden, every position is a synthetic clone (offsets 0..N-1) so the
  array straddles the pivot symmetrically. No-op for radial (already
  centred by definition).
- ![new][new] **`hideSources`** — hide the original mesh from the viewport
  so only generated clones render. Useful when the array is symmetric and
  the source-at-origin is already represented by clone-0.

**Workspace — discoverability and polish**

- ![new][new] **Contextual hint strip** (`#vp-hint`) at the bottom-centre
  of the viewport. Reads selection count, gizmo mode, and measure mode to
  emit one-line tips — "Click to select · Drag to orbit · Scroll to zoom"
  empty, "N selected · Drag gizmo to move · Shift to snap" translating,
  "Measure · Click two points · Esc to exit" mid-measure. Pointer-events:
  none so it never blocks the gizmo or marquee underneath.
- ![new][new] **Add-primitive button — long-hold picker, click-to-repeat**.
  Click adds the last-used shape (cube by default). Hold for 400 ms to
  open a 13-shape picker (cube, sphere, cylinder, cone, torus, plane,
  capsule, icosahedron, dodecahedron, hex bolt, hex nut, socket-head
  screw, washer). A tiny corner triangle hints at the long-press
  affordance, Figma / Photoshop tool-group convention. Last-used shape
  + per-kind thumbnails persist in localStorage.
- ![polish][polish] **Brand menu moved to top-left** — the *About / GitHub
  / What's new* dropdown now anchors to a brand mark at the start of the
  top bar instead of the right corner. Right side stays free for the
  Export + cog cluster. Left-anchored variant (`.brand-left`) overrides
  the transform-origin so the popover grows from the top-left edge.
- ![polish][polish] **Cloner promoted to the top bar** — was a sidebar
  affordance, now a first-class `#btn-cloner` button next to File. Single
  click whether you have a selection (wraps it) or not (creates standalone).
- ![polish][polish] **Status bar + log console layering** — the status
  bar lost its top border and gained a higher z-index so the global log
  console now slides up *behind* it instead of overlapping. Console
  bottom-offset trimmed from 28 → 22 px to match.
- ![polish][polish] **Format card selection** in the Export modal uses
  tokenized accent tints (`--ac-tint-12` / `--ac-tint-20`) instead of
  baked `rgba(107,141,255,…)`. Selected cards now follow accent-colour
  changes without a stale highlight.

**File menu — Revert to source**

- ![new][new] **Revert to source file…** — drops every edit and re-parses
  the on-disk file the scene was loaded from. Destructive confirmation
  dialog ("Revert to original model?" / "Revert"). Works for STEP, GLB,
  GLTF, FBX, OBJ, 3MF, STL via the same drag-and-drop dispatcher, so the
  revert path is identical to the open path.

## v0.6.0

v0.5.0 made sessions feel modern. v0.6.0 makes the *authoring loop* feel modern:
a C4D-style live Cloner, a Ctrl-click measure tool, per-group origin markers
that follow your gizmo, a Spline-style two-panel Export modal, mesh
simplification on the backend, and a CAD-correct mouse mapping.

**Cloner — C4D-style live instancing**

- ![new][new] **New `cloner.js` module** wraps the current selection in a
  cloner group with three modes: **Linear** (count + per-step XYZ / rotation
  / scale), **Radial** (count + radius + axis + start/end angle + faceCenter),
  **Grid** (nx/ny/nz × dx/dy/dz). Defaults to **InstancedMesh** for fast
  high counts; flip to independent Mesh siblings when each clone needs to
  be individually editable. Undoable.

**Measure tool**

- ![new][new] **Measure mode** (`M` to toggle, ruler button in the viewport).
  Ctrl-click two points on geometry to drop a measurement. Left-drag still
  orbits, Esc cancels. Accent-blue **hover dot** follows the cursor while
  active. Measurements stay visible after you exit pick mode (Pixyz /
  Onshape behaviour).

**Origin markers**

- ![new][new] **Per-group origin axes** visualise each group's pivot. Drag
  with the gizmo and the origin tracks in real time; the new position
  persists on drag-end so re-selecting reads the moved pivot, not the
  stale pre-drag one.
- ![new][new] **Scene origin** — axes helper at world 0,0,0 rendered with
  `depthTest:false` so it stays visible through geometry.

**Export modal — Spline-style two-panel**

- ![new][new] **Redesigned Export window**. Left sidebar (200 px):
  categorised format list — **3D Formats** (GLB / GLTF / FBX / USDZ / OBJ),
  **3D Printing** (STL), **Point Cloud** (PLY), **Data** (CSV). Right panel:
  sticky header with live title + description, Compare button, scrollable
  options grid, full-width primary **Export {FMT}** button.

**Pipeline — smaller GLBs by default + simplification**

- ![new][new] **`--simplify <ratio>`** — meshoptimizer quadric-error
  decimation via `gltfpack -si`, with feature-edge preservation (holes /
  chamfers / fillets stay sharp). `0.5` halves the triangle count. Lossy.
- ![new][new] **Meshopt is now ON by default** when `gltfpack` is on PATH —
  most users wanted the ~10× smaller GLB and never remembered to pass
  `--meshopt`. Pass `--no-meshopt` to opt out.
- ![new][new] **XCAF read-mode toggles** — `--no-shuo` / `--no-layers` /
  `--no-materials` / `--no-step-names` / `--no-step-props` skip parts of
  the slow STEPCAF `Transfer(doc)` pass. SHUO is the biggest win on
  instanced assemblies. All five flow through `/api/convert` so the
  in-browser drag accepts the same options.
- ![fix][fix] **Face winding** — only `TopAbs_REVERSED` flips now; the old
  `!= 0` check incorrectly flipped INTERNAL / EXTERNAL faces and produced
  back-face artefacts on cellular geometry.
- ![fix][fix] **PCA hash collision** — `lexsort` along axis=0 instead of
  flattening all axes into one bag, so a cube and its diagonal mirror no
  longer collide.
- ![fix][fix] **GLB metrics on meshopt files** — direct JSON-chunk reader
  replaces `trimesh.load`, which can't decode compressed GLBs (the
  `--target-tris` auto-tune was blind to its own output).
- ![new][new] **Partial-read cache bypass** — `*.xcaf-cache.xbf` is skipped
  on both read and write when any read-mode flag is off, so a partial run
  can't be silently upgraded by a cached full-read doc. Interactive
  prompt now shows the cached GLB's `quality=X` before asking to reuse it.

**Server — boot hygiene**

- ![new][new] **Inbox sweep on boot** — drops orphaned `<job_id>_*.step|.stp`
  uploads and `*.xcaf-cache.xbf` caches older than 24 h from crashed
  previous runs. User-placed files (no job-id prefix) are left alone.

**Authoring overlay — add primitive**

- ![new][new] **Add-primitive button** in the viewport overlay. Click adds
  your last-used kind (C4D's "last tool used"); long-press opens a picker
  with thumbnails. Catalog expanded with **capsule, icosahedron,
  dodecahedron, hex bolt, hex nut, socket-head screw, washer**.

**Camera — CAD-correct mouse mapping**

- ![new][new] **LEFT = orbit, MIDDLE = pan, RIGHT = pan, wheel = zoom**
  (middle was DOLLY by default; CAD apps reserve it for pan).
  **Alt + RMB-drag = dolly** (C4D convention) — exponential, drag up
  zooms in. Windows' middle-mouse autoscroll glyph suppressed on canvas.

**Right sidebar + status bar**

- ![new][new] **Collapsible sections** with persisted state. Default: only
  Properties + "Selection & actions" expanded (was 12 always-open sections).
- ![new][new] **Renderer selector** in the status bar — direct WebGPU /
  WebGL2 dropdown with logos, replacing the text-only status.
- ![new][new] **Scene rename** — double-click the status pill; export uses
  `state.sceneName` over the source filename. Snap-gizmo-to-grid toggle
  added under Display.
- ![polish][polish] **Tighter sidebar sizing** — buttons / dropdowns /
  toggles 30→28 px, 11→10 px font. Selected dropdown row shows a trailing
  ● instead of a leading ✓. Name-regex inline input removed (the "By name"
  button still drives the flow).

**Materials**

- ![new][new] **Grid ↔ List view toggle** in the materials popup,
  persisted via localStorage. **"Show N more"** overflow on long lists.

**Brand menu + design tokens**

- ![polish][polish] **Accent-gradient brand menu** with white-tinted text
  variants; WebGPU + WebGL logos in the footer.
- ![polish][polish] **Accent shift** `--ac` `#6b8dff` → `#5b67f5` — less
  violet, marginally more saturated. All 15 `--ac-tint-XX` triplets
  re-derived.
- ![refactor][refactor] **Off-grid spacing tokens** — `--space-3` / `-5` /
  `-7` / `-9` / `-11` / `-18` named, were raw literals.
- ![polish][polish] **Properties value rows** — font-weight 500 → normal,
  size 11 px for a denser read. Welcome modal gains a **New scene** button
  alongside Browse; resume card 140 → 180 px tall, simplified hover.

**Launcher**

- ![new][new] **`start_hidden.vbs`** — silent .lnk launcher (no console
  window). Use `start.bat` directly when you want boot logs.

## v0.5.0

v0.4.0 made the viewport feel modern. v0.5.0 makes the *session* feel modern:
real scene management (start empty, merge files in, edit scene-level
settings as a first-class modal), parametric primitives that round-trip
cleanly through the transform panel with mm-snapped inputs, unit-aware
transforms that follow the right-sidebar display unit, a banding-free
background pipeline, and a clean-shutdown server endpoint.

**Scene management — File menu**

- ![new][new] **New scene** action — boots straight into an empty viewport
  instead of forcing a load to start working. The toolbar, gizmos, and
  right sidebar all initialize from the empty-state path so primitives
  / imports can land into a known-clean scene.
- ![new][new] **Import (merge)** — load a STEP / GLB / GLTF / FBX file
  *into* the current scene instead of replacing it, with the imported
  hierarchy folded into the existing tree under its own root node.
- ![new][new] **Scene settings** is now a dedicated modal in the File
  menu, lifted out of the viewport cog popup. Camera controls remain in
  the cog popup where they're contextual to the viewport.

**Primitives — parameter polish**

- ![new][new] **Editable number inputs** for every primitive parameter —
  any size slider can be type-edited directly with the keyboard.
- ![polish][polish] **Round defaults** on insertion (whole-mm radii /
  heights / tube thicknesses) so freshly-added primitives don't show
  long decimal trails.
- ![polish][polish] Size sliders now **snap to whole-mm increments** —
  drag-edits land on round values without needing the input field.
- ![fix][fix] **Transform panel refreshes** after a parametric rebuild,
  so the displayed translation / rotation / scale matches the new
  geometry's bounds instead of staying stuck on pre-rebuild values.

**Transform — unit alignment**

- ![polish][polish] Transform panel units now **follow the right-sidebar
  `displayUnit`** (mm / cm / m / in). Switching the global unit updates
  the transform readouts in lockstep so the two panels can never disagree.

**Visual — banding-free backgrounds**

- ![new][new] Gradient backgrounds get a **per-pixel dither pass** that
  breaks up the smooth ramp into a high-frequency noise pattern. Eight
  bits of colour can no longer band visibly across the viewport, even
  on dark gradients where banding was most obvious.
- ![refactor][refactor] **Design-token expansion** — font-weight tokens
  (`--fw-regular/-medium/-semibold/-bold`), select-arrow tokens
  (`--select-arrow` / `--select-arrow-color`), and unified button-height
  rules (`.tbtn` 26px, `.btn` 32px). Native `<select>` and the JS-injected
  custom selects now share the same chevron SVG.

**Server — clean shutdown**

- ![new][new] **`/api/quit` endpoint** for graceful shutdown — the desktop
  shell can now close the bundled server cleanly instead of hard-killing
  the process and leaking the port.

## v0.4.0

v0.3.0 hardened the editing surface. v0.4.0 makes the viewport itself feel modern:
HDRI environment lighting with procedural presets and a draggable sun, an
LOD-aware infinite floor grid with spline-style hairlines, atmospheric fog,
parametric primitive insertion, a pill-shaped camera-view selector at the
top centre, full keyboard shortcuts (Ctrl+1..4) for standard CAD views, a
borderless popup language across every modal/popover, and an accent-token
refresh toward IBM blue with strict token-only colour usage.

**Lighting — HDRI environment**

- ![new][new] New **HDRI** mode in Background settings. Loads any `.hdr` /
  `.exr` file as an image-based environment that lights every PBR
  material in the scene. Plus 4 **procedural presets** so a user can ship
  a polished look without sourcing an HDRI file.
- ![new][new] **Custom HDR / EXR loader** wired to the file picker — the
  loaded environment becomes both the scene background AND the IBL light
  source.
- ![new][new] **Draggable sun gizmo** repurposed to drive HDRI rotation:
  rotating the sun rotates the whole environment, and the model relights
  in real time as the gizmo moves.
- ![new][new] **HDRI intensity slider** under Display → Lighting. Forces a
  full re-light pass on change so the model brightness updates instantly.
- ![fix][fix] Fixed black-scene bug when switching back to HDRI mode after
  having loaded a different background.
- ![polish][polish] Sun rig dims automatically when HDRI is active so it
  doesn't double-up over the IBL.

**Atmosphere — floor grid + fog**

- ![new][new] Replaced the finite `THREE.GridHelper` with an "infinite"
  axis-coloured `LineSegments` grid that scales to ~200× the model
  footprint. Centre row red (X axis) / green (Y axis); every other line
  thin grey.
- ![new][new] **Spline-style hairline fade** — per-vertex alpha smoothsteps
  out toward the horizon, with corners past the fadeEnd dropped at build
  time so the vertex budget stays under 50k even on a 1mm-unit model.
- ![new][new] **LOD on the minor cells** — minor hairlines fade out when
  zoomed out so far the cells become visual noise; restore correctly on
  zoom-in.
- ![polish][polish] Overall grid opacity dropped 0.55 → 0.22 — the grid now
  reads as a quiet reference plane instead of a dominant element.
- ![new][new] **Scene fog** enabled by default with Display-section
  controls for **near**, **far**, and **intensity**. Fog colour picks
  itself from the active background mode so the horizon dissolves cleanly.

**Primitives — direct mesh creation**

- ![new][new] New toolbar dropdown to **add primitives** (`+` icon) —
  Cube, Sphere, Cylinder, Cone, Torus, plus more. Inserted directly into
  the scene with proper materials and a fresh tree node so they're
  immediately editable like any other part.
- ![new][new] **Parametric Shape-parameters panel** in the C4D
  Attributes-Manager style. After insertion the panel exposes all the
  generator parameters (radius, segments, height, etc.) — re-edits
  rebuild the geometry in place.
- ![fix][fix] Deferred geometry dispose on parameter edits to fix the
  WebGPU `setIndexBuffer` race that would crash the renderer on rapid
  re-evaluations.

**Camera views — top-center pill**

- ![new][new] Removed the four `T / F / S / Persp` buttons from the
  top-left toolbar in favour of a single **pill button at the top centre
  of the viewport**. The pill shows the active view's name (Cam / Top /
  Front / Side); clicking it reveals a dropdown of the alternatives.
- ![new][new] **`Ctrl/⌘ + 1..4`** keyboard shortcuts: 1 = Cam
  (Perspective), 2 = Top, 3 = Front, 4 = Side. Each row in the pill
  dropdown shows its shortcut as a kbd chip; the prefix is platform-aware
  (`⌘` on macOS, `Ctrl` everywhere else). Existing bare `1/2/3` keys
  for view modes (solid / wireframe / x-ray) now require *no* modifier
  so the two systems don't collide.
- ![new][new] Pill auto-syncs back to **Cam** the instant the user starts
  orbiting, so the toolbar can never lie about the active view.
- ![polish][polish] Pill label centered, lucide camera icon, slight black
  glaze background, no stroke, blur backdrop. Camera-view shortcuts also
  added to the command palette and Shortcuts overlay.

**Viewport — render-to-PNG enhancements**

- ![new][new] **Camera-shutter flash fires on icon click**, *before* the
  Save Screenshot dialog opens — the visual snap precedes the
  configuration step rather than firing after, so the click-to-shutter
  feedback feels like a real camera. The dialog now lands ~120 ms later,
  just as the flash fades, with the OS save picker still firing on Save.
- ![new][new] Right-click on empty viewport space now exposes **17
  actions** (was 5): Fit / Reset camera, all 4 standard views with
  shortcuts, all 3 render modes, live-state toggles for grid /
  bounding-boxes / auto-rotate (label flips `Show ↔ Hide`, `Start ↔ Stop`
  based on current state), Select all / Show all parts, Save
  screenshot…, Save scene.
- ![fix][fix] **Right-click viewport menu was completely broken** —
  another `contextmenu` capture-phase listener in `app-v2.js:16359`
  unconditionally `preventDefault`s on every non-input target to
  suppress the native browser menu, which set `defaultPrevented=true`
  before the app's custom menu builder ran. The custom builder bailed
  on the first line via `if (e.defaultPrevented) return;`. Removed the
  guard — each branch is target-scoped, so unconditional run is safe
  and the bubble-phase tree-row handler still wins for tree clicks.

**Tooltips — bulletproof against navigation**

- ![fix][fix] Tooltips no longer get stranded when a popup opens, a modal
  shows, the page loses focus, the anchor's DOM gets rebuilt, or the
  cursor sits still while a panel slides in over the button. Six
  layered safeguards added without changing the happy path:
  - Defensive `document.contains(target)` check inside `show()` so a
    detached anchor doesn't render at a stale rect.
  - `mousedown / pointerdown / touchstart / contextmenu` capture-phase
    hides — fire before `click` and catch drag-starts the original
    listener missed.
  - `focusin` (capture) — palette open, form focus, etc.
  - `visibilitychange` — alt-tab + return no longer leaves stale tips.
  - **rAF-coalesced `mousemove` validator** that uses
    `document.elementFromPoint` to verify the cursor is still inside
    `currentTarget`. Catches "popup slid over my anchor without me
    moving" instantly.
  - **MutationObserver on `class` / `style`** at `<body>` watches for
    `.modal-bg.show`, `.dlg-popup.show`, `.vp-pill-menu.show`,
    `#vp-settings-pop.show`, `#vp-materials-pop.show`, `.ctx-menu`
    appearing — any of those gaining `.show` retires the tip.
  - Detach observer (`childList:true subtree:true`) re-checks
    `document.contains(currentTarget)` whenever the DOM mutates, so
    tree rebuilds / panel refreshes can't park a tooltip on a removed
    row. `pagehide` added too.

**Visual language — borderless popups**

- ![polish][polish] Removed the 1px stroke from every popup card sitewide.
  `.dlg-popup .dlg-pop` (Save Screenshot, Batch Rename, Material editor,
  any `_DraggablePopup`), `.modal` (Welcome, Settings, Shortcuts,
  Cmd-K, Save Scene, Export), `#vp-materials-pop`, `#vp-settings-pop`,
  and the camera-view dropdown all now sit flush on their `var(--bg1)`
  / blurred backgrounds with `box-shadow:var(--sh)` for depth.
- ![polish][polish] Removed the world-axis triad button (`tg-axes`) and the
  in-scene `THREE.AxesHelper` it controlled. Boot path, scene init,
  thumbnail capture, command palette, scene-state save/restore — all
  references swept. The bottom-left axis-gizmo SVG (camera-orient
  click target) is unaffected.

**Visual language — accent refresh**

- ![polish][polish] Accent token `--ac` shifted from `#6ea8ff` (sky blue)
  toward IBM blue: **`#6b8dff`** rgb(107,141,255). Slightly more
  saturated, marginally less violet. Gradient companion `#4f8be5` →
  `#4f7ce0`. All `rgba(110,168,255, X)` triplets updated to
  `rgba(107,141,255, X)` sitewide.
- ![refactor][refactor] Audit + sweep: every hardcoded accent reference (the
  Z-axis label, gizmo HUD Z value, mixed-material gradient, view-mode
  + gizmo + grid `--btn-tint` declarations) now uses `var(--ac)`. The
  only remaining literal `#6b8dff` is the token definition itself and
  the material-color-picker `PRESETS` array (a list of distinct user
  swatches).
- ![polish][polish] **iOS switch tint** flipped from `var(--ok)` (green) to
  `var(--ac)` (accent blue) — single rule
  `.toggle input:checked+.switch` changes every checkbox switch in
  Display, Export, Save Scene, dynamic-template toggles, etc.

**Right sidebar — readability**

- ![polish][polish] Yellow `.btn.warn` text on the right sidebar
  (`Smart fit`, `Remove empty parts`, `Deduplicate geometry`, `Fix
  degenerate parts`, `Delete empty groups`, `Flag low-triangle parts`,
  `Flag thin slivers`, `Smart-fit all parts`, `Decimate`) flipped to
  `var(--tx)` white. The yellow-tinted hover background still flags
  them as lossy/destructive ops; only the resting label/icon colour
  changed.
- ![polish][polish] Right-sidebar button font weight 500 → 400 so a column
  of buttons reads quieter at the 11 px size.

**Material editor + popups**

- ![new][new] Single-click swap when the material editor is already
  open — clicking a different material in the grid switches the editor
  contents to that material in place instead of needing close/reopen.
- ![polish][polish] Materials popup actions row promoted to the top of the
  panel (action bar above grid) so the most-used buttons are always
  reachable without scrolling.

**Toolbar**

- ![polish][polish] Only one toolbar dropdown can be open at a time —
  opening any of the format / primitive / export menus auto-closes the
  others.

## v0.3.0

v0.2.0 was the editing surface. v0.3.0 hardens it: a real material editor with
shader-ball previews, transform-gizmo polish (scale + snap + live HUD),
screenshot capture with custom resolutions and a system save dialog,
orthographic Top/Front/Side viewport toggles, FBX legacy-format rescue,
and a long tail of fixes around dispose hygiene, drag perf, and context
menus.

**Viewport — standard CAD views**

- ![new][new] New `T` / `F` / `S` viewport buttons → switch to orthographic
  and align to Top, Front, or Side. Z-up CAD scenes use the CAD convention
  (Y forward); Y-up scenes (glTF / Blender) flip accordingly. The active
  button highlights itself, and the highlight clears the instant the user
  orbits — no stale active state.
- ![new][new] New `Persp` button (`video` icon) → snap back to a 3/4
  isometric perspective view. Restores the scene's CAD up-axis, re-enables
  the FOV slider, and clears the ortho-view active state in one click.

**Viewport — screenshot capture**

- ![new][new] New camera button (top-right of the viewport) opens a custom
  draggable, resizable **Save Screenshot** popup with:
  - 6 resolution presets — Viewport 1×/2×/4×, 1080p, 1440p, 4K — in a 3×2
    grid; the active preset auto-highlights when W/H matches.
  - Custom width × height inputs with live aspect ratio + megapixel readout.
  - Filename field auto-populated as `<modelStem>_<ISO timestamp>.png`,
    pre-selected on open for instant rename.
- ![new][new] Save uses the **File System Access API** (`showSaveFilePicker`)
  on supported browsers so you pick the destination + filename in the OS
  dialog. Falls back to a regular browser download otherwise.
- ![new][new] Optional bottom-left info stamp burnt into the saved PNG —
  filename, dimensions, timestamp.
- ![new][new] Camera-shutter flash effect — a white overlay fades in (~65 ms)
  and out (~280 ms) as the frame is captured, masking the unintentional
  swap-chain blink during readback so the capture feels like a real shutter
  click.
- ![new][new] Capture pipeline renders into a `WebGLRenderTarget` at the
  chosen resolution and reads back via `readRenderTargetPixels`. Identical
  output on WebGL and WebGPU; for perspective cameras it temporarily
  adjusts `camera.aspect` so a 16:9 export of a square viewport isn't
  squashed.
- ![fix][fix] 3-phase File System Access error handling — `showSaveFilePicker`
  returns null on user cancel, but `createWritable` can also reject (write
  denial, OneDrive lock). All three failure modes now route to the regular
  download fallback instead of silently dropping the save.
- ![fix][fix] Stop the double-prompt corrupted-file bug where the save dialog
  fired twice and produced a 0-byte PNG.

**Materials — full editor + shader-ball preview**

- ![new][new] Disney-style **shader-ball preview** assembly replaces the
  bare sphere — sphere + cylinder + ground disk + back-card geometry, lit
  with a PMREM env map + a side-key fill so PBR responses read the way
  they would in a real DCC viewport.
- ![new][new] Same shader-ball geometry now powers the materials grid
  thumbnails, not just the editor's hero preview.
- ![new][new] Material editor switched to **C4D / Redshift-style row
  layout** — each property is a single horizontal row; map slots, intensity
  scalars, and the eyedropper sit inline with the property they belong to.
- ![new][new] Per-property texture slots covering the full PBR set — base
  color, normal, roughness, metalness, AO, emissive, bump, displacement,
  alpha, env, clearcoat (×3), sheen (×2), transmission, thickness, specular
  (×2), iridescence (×2), anisotropy. Map intensity scalars per slot.
- ![new][new] Floating texture-attach popover anchored to each `.mat-row-tex`,
  plus an eyedropper button flush with the colour picker.
- ![fix][fix] Texture leak on model swap — `material.dispose()` doesn't dispose
  textures, and `_loadTexture` only revoked its blob URL on error. The
  deferred-dispose drain now walks all 25 PBR map slots, revokes any
  `userData.dataUrl` blob URL, disposes the texture, and nulls the slot.
- ![fix][fix] Material thumbnails fall back to a lightweight 2D canvas paint
  when `WebGLRenderer` is unavailable, instead of showing blank tiles.

**Gizmo — scale, snap, HUD**

- ![new][new] Added a **scale gizmo** (`T` shortcut, `scaling` icon).
- ![new][new] Global **Shift-to-snap** across all three gizmo modes —
  10 units for translate, 15° for rotate, 0.1-step for scale.
- ![new][new] Live **gizmo HUD** — readout panel next to the gizmo while
  dragging, showing the current delta in world units / degrees / scale
  factor.
- ![polish][polish] HUD only shows the axis you're actually grabbing, not the
  full XYZ block, while a single-axis handle is active.

**Transform panel**

- ![new][new] Right-click on the Position / Rotation / Size column headers
  for **Copy / Paste XYZ** — round-trips the three values as
  `x, y, z` text via the clipboard, so transforms move between objects in
  one keystroke pair.
- ![perf][perf] Skip `_readStableSize()` while a translate or rotate gizmo
  drag is in flight — the size readout doesn't change during pure
  position/rotation, and the per-frame box recompute was a measurable
  hit on 50K-tri parts.
- ![fix][fix] Restored the **native browser context menu** on form inputs —
  Copy / Paste / Select All works again on every numeric/text field. The
  custom right-click was eating those events project-wide.

**Loaders & format coverage**

- ![new][new] Legacy **FBX rescue path** — FBX FileVersion 6100 (and any
  ASCII variant Three.js's loader chokes on) now routes through Assimp.js
  → GLB → GLTFLoader. Saves files that were previously stuck at "loader
  threw, no model on screen".
- ![polish][polish] When both Three.js and Assimp give up, the toast names
  the actual cause instead of a generic "loader failed".

**Tree / sidebar**

- ![polish][polish] Tree rows: object/group labels shrink from 12.5 px → 11.5 px,
  and group rows lose the bold weight. Reads denser without losing
  hierarchy.
- ![polish][polish] Sidebar: compact sidebar buttons; the "draws" stat was
  noise alongside "tris/parts/instanced" — dropped.
- ![polish][polish] Welcome modal: drop zone pushed lower so the recent-files
  list breathes.

**Visual polish**

- ![polish][polish] Background: Blender-grey preset lightened — the previous
  shade tipped too dark and competed with the grid's contrast.
- ![polish][polish] Chromium scrollbars: `::-webkit-scrollbar` set to match
  Firefox's `scrollbar-width: thin` so the sidebar reads consistent
  across browsers.

**Internal**

- ![refactor][refactor] Removed dead `_tfStashQuat` global (declared, never
  referenced).
- ![refactor][refactor] Scoped four `_shearTmp*` THREE-object globals into the
  `_matrixHasShear` IIFE; same per-call profile, no module-level pollution.
- ![refactor][refactor] Collapsed `_Welcome._fmtBytes` (7 lines) into a one-line
  wrapper around the global `fmtBytes` — kept the `Number.isFinite` guard
  for stored-state reads.

**Docs**

- ![docs][docs] README: ASCII logo centered, Pre-1.0 R&D section added,
  marketing copy toned down across About + Updates.

## v0.2.0

v0.1.0 could open and render. v0.2.0 adds the editing surface around it.

**Added**

- Welcome modal with drag-drop, file picker, and recent files (FS Access API + IndexedDB handle persistence).
- Command palette (⌘K / Ctrl-K) over a unified action registry.
- Shortcuts overlay (`?` to open).
- Settings modal — persistent prefs for renderer, perf mode, background, FPS pill, instancing, material sharing, auto-rotate, highlight thresholds.
- Section / clip planes via TSL `discardNode` (real GPU clipping).
- Renderer hot-swap between WebGPU and WebGL2 from the toolbar.
- Batch rename (F2) with token templates, regex find/replace, presets, live preview.
- Hierarchy flatten / dissolve / ungroup, undoable.
- Undo / redo for tree edits, recolours, renames, flatten ops.
- Right-click context menu on tree rows.
- Save Scene — view + selection + recolours.
- Brand menu (about / GitHub / version / shortcuts).
- FPS pill with colour-coded stutter detection.
- CSS design-token system — surfaces, radii, type scale, easings.
- Cancel + copy-log on every long-running load.

**Changed**

- Tree expand/collapse on 10K+ nodes: ~1s → <10ms, by flipping a class instead of rebuilding the DOM.
- Modal body scrolls so the footer stays visible on short screens.
- Export consolidated into a single toolbar dropdown + settings modal.
- Added a highlight-small-parts toggle with tinted rows.
- Viewport perf cleanups, dead-button fixes, stale experiments archived.

## v0.1.0 — first public commit (2026-05-05)

What landed in the initial commit:

- **STEP → GLB pipeline** (`step2glb.py`) — OCCT-backed XCAF reader, PCA pose-normalized
  instance hashing, adaptive tessellation (absolute or relative to bbox diagonal),
  size culling, optional Meshopt compression via `gltfpack`.
- **WebGPU viewer** (`index.html` + `app-v2.js`) — full assembly tree, picking,
  hide / isolate, per-group colouring, fit-to-view, viewport modes (shaded / wireframe / matcap).
- **Local server** (`serve.py`) — static file server + `/api/convert` endpoint that
  spawns the converter as a background job.
- **One-click launchers** — `start.bat` / `start.command` bootstraps the `.venv`, pulls
  deps, and opens the browser. Subsequent runs are sub-second.
- **Vendored decoders** — Draco encoder/decoder and Assimp.js shipped as WASM under
  `vendor/`, so no CDN is required at runtime.

<!-- ── Changelog tag badges ───────────────────────────────────────────────
     Reference-style image defs used by every entry above. Single source of
     truth: change the colour / label here once and every row updates.
     Modern Linear / Vercel-inspired palette tuned for cohesion: every swatch
     is the same Tailwind-500 luminance so the changelog reads as one cohesive
     design system rather than six unrelated swatches. `style=flat` for soft
     pill chips with rounded corners — the contemporary take on shield badges.
       new      #10b981  emerald 500  — feature additions
       fix      #f43f5e  rose 500     — bug fixes (warmer than fire-engine red)
       perf     #f59e0b  amber 500    — performance work
       polish   #a855f7  purple 500   — UX / visual refinement
       refactor #3b82f6  blue 500     — internal cleanup
       docs     #64748b  slate 500    — documentation
-->
[new]:      https://img.shields.io/badge/new-10b981?style=flat
[fix]:      https://img.shields.io/badge/fix-f43f5e?style=flat
[perf]:     https://img.shields.io/badge/perf-f59e0b?style=flat
[polish]:   https://img.shields.io/badge/polish-a855f7?style=flat
[refactor]: https://img.shields.io/badge/refactor-3b82f6?style=flat
[docs]:     https://img.shields.io/badge/docs-64748b?style=flat
