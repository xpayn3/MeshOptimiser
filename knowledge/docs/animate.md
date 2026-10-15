# Animate (alpha)

Make parts or groups spin, swing, shake or travel along a path, and play it in the turntable video.

Animate makes the parts you choose move: a fan that spins, a lever that swings, a part that shakes, a part that travels along a path. The motion is a view, not an edit: the model is not changed, and a saved scene or an export sees every part where it started.

> Animate is an alpha. It works, but it is new, so expect rough edges and changes.

## Open it

- Right-click a part, a group in the tree, or the view with something selected, and choose **Animate…**.
- Or open the command search and choose **Animate the selection…**.

## Four kinds of motion

- **Spin**: Turns round an axis (X, Y or Z, clockwise or counter) at 1 to 600 turns a minute.
- **Swing**: Rocks to and fro round an axis by an angle of 1 to 180 degrees, in 0.2 to 20 seconds.
- **Noise**: A shake of the position and the turn: wave, smooth random or steps. Set how far it moves (up to 50 percent of the part) and turns (up to 90 degrees) on each axis, how fast, how fine and how rough, with a seed and a dice for a new one.
- **Path**: A trip along a circle, a figure of eight, a rounded square, a wave or a line, in the plane you choose, from 5 to 200 percent of the part’s size.

Spin and path also loop: **Loop**, **Ping-pong** or **Once**, with two handles on a small timeline for where in the cycle it starts and ends. A part or group can have one layer of each kind, and the layers add up. A group moves all its parts together, about the middle of the group.

## Play it

Under the title bar a playbar has rewind, play and pause, the time, a scrubber over one cycle, and a speed button that steps through 0.25×, 0.5×, 1×, 2× and 4×. `Space` plays or pauses and `Home` rewinds while the window has focus. **In the scene** lists everything that is animated: click a row to select it, or the bin to take its animation away.

While the window is open, a pill in the view says **Animate mode**, **Playing** or **Paused**, with play and exit buttons. Click it to bring the window back.

## What to know

- Animations keep running after you close the window or change the selection, until you remove them or close the scene.
- They are not saved in a scene, and an export or a saved scene puts every part back first.
- Pressing a gizmo handle on something that is animated takes its animation away first. No gizmo shows while the window is open, and Edit mesh is off.
- The exploded view works together with animations.
- The turntable video plays them, each frame at its own time.

Claude can set this up for you with **animate_parts**: it adds, removes, lists or clears animations by part, name or group.

Related: [exploded-view](meshoptimiser://docs/exploded-view), [screenshots](meshoptimiser://docs/screenshots), [work-with-claude](not in this knowledge base)
