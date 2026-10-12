# MeshOptimiser v0.22.0

This release is about three things. You can now ask Claude to do the clean-up for you. The app can update itself. And if the app crashes, you get your work back.

## Ask Claude to do it for you

Claude can now use MeshOptimiser. Turn on **Let Claude connect** in Settings, paste one line into a terminal once (Settings shows it, with a Copy button), and then you can just say what you want: "find all the bolts and hide them", or "get this under 5 MB". Claude clicks the same buttons you would. It is off until you turn it on.

- **You stay in control.** Claude asks before it changes anything (Allow or Don't allow), deleting always asks, and you can switch off whole kinds of things it may do. Every change is one step you can undo with Ctrl+Z.
- **Try it first.** Claude can try a step, tell you what would happen, and take it back.
- **Big jobs in one go.** Take a model down to a size you choose, show a before and after picture, or do a whole folder. A bar shows the progress, and a Stop button ends it.
- **Pictures for a client.** Clean pictures up to 8192 pixels, from several angles, with a plain or see-through background.
- **Claude already knows the app,** so it works in a sensible order instead of guessing.

## The app updates itself

Settings, Updates tells you when a new version is out and installs it with one click. It is a small download (a few megabytes), and your files and settings stay as they are. The last version is kept, so **Earlier version** puts it back. If a new version does not start, the old one comes back by itself.

You choose how often it checks, Stable or Beta, and whether a notice shows in the corner. Older versions cannot update themselves, so they need one manual update first.

## Your work comes back after a crash

While you have changes you have not saved, the app keeps a copy of your scene in your browser (every 2 minutes by default; change it or turn it off in Settings, General, Recovery). If the app crashes, it offers to bring the scene back the next time you open it, as a yellow **Continue** card at the top of the start screen.

It is only for crashes. If you close or reload the window yourself, nothing is offered back. It is a safety net, not a backup, so keep saving your scene.

## Smaller things that help

- **Keep sharp edges** when you reduce triangles: rims, steps and corners stay crisp. On by default.
- **Two new export options for GLB.** Meshopt compression makes the file about a quarter of its size (Draco is smaller still, but some viewers read Meshopt and some do not). Faster to draw only re-orders the file so it draws faster, and every viewer opens it.
- **New scenes start the way you like:** pick a unit and an up direction in Settings, General.
- **A Tasks chip** at the bottom shows what each tab is working on, with a Cancel button.
- **Point to find:** point at a row in the list and the part flashes; point at a part and its row lights up.
- **Open a folder** by dropping it in. **Explode** can send each part along its own direction. A **Shading angle** row in Properties. About forty more things in the search.
- A new loading animation, a six-step list when a STEP file opens, a wider left sidebar and sharper turntable videos.

## Fixed

- Closing a tab while a file is converting now stops the conversion at once. Before, it could keep your computer busy for hours.
- The selection stays selected while a model explodes, and the box around parts is no longer off after exploding.
- The floor grid fits again after you add a model to a scene.
- Smart fit now handles a ring that has a small tab or ears.
