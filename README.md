<div align="center">

<pre align="center">
███╗   ███╗███████╗███████╗██╗  ██╗
████╗ ████║██╔════╝██╔════╝██║  ██║
██╔████╔██║█████╗  ███████╗███████║
██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║
██║ ╚═╝ ██║███████╗███████║██║  ██║
╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝
  O P T I M I S E R   ·   v 0 . 1 3 . 0
</pre>

### From bloated CAD to browser-ready, locally.

> Drop a STEP file in. Get a Meshopt-compressed GLB and an interactive viewer out.
> A self-hosted take on the Pixyz preprocessor. Python + your browser, no licence server.

[![Python](https://img.shields.io/badge/python-3.10%20|%203.11%20|%203.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![OCCT](https://img.shields.io/badge/OCCT-cadquery--ocp-red)](https://github.com/CadQuery/OCP)
[![WebGPU](https://img.shields.io/badge/WebGPU-ready-005A9C?logo=webgpu)](https://www.w3.org/TR/webgpu/)
[![Draco](https://img.shields.io/badge/compression-Draco%20%2B%20Meshopt-success)](https://github.com/google/draco)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#-license)
[![Platform](https://img.shields.io/badge/platform-Windows%20|%20macOS-lightgrey)](#-requirements)
[![Status](https://img.shields.io/badge/status-pre--1.0-orange)]()

</div>

---

## Screenshots

A 1,583-part, 5.4-million-triangle assembly in v0.11.

| | |
|---|---|
| ![The viewer](docs/screenshots/meshoptimiser-viewer.webp)<br>**The viewer** — tree, viewport, and the scene's totals | ![A part selected](docs/screenshots/meshoptimiser-assembly-inspect.webp)<br>**Inspect** — a part's triangles, share of the scene and rank |
| ![Fill holes](docs/screenshots/meshoptimiser-fill-holes.webp)<br>**Fill holes** — the command panel, and what the fill saved | ![Before and after](docs/screenshots/meshoptimiser-fill-holes-closeup.webp)<br>**Before / after** — 27 holes closed, the rest untouched |
| ![All commands](docs/screenshots/meshoptimiser-commands.webp)<br>**All commands** — one list, with shortcuts | ![Search](docs/screenshots/meshoptimiser-palette.webp)<br>**Search** — suggestions follow the selection |
| ![Scene tabs](docs/screenshots/meshoptimiser-tabs.webp)<br>**Scene tabs** — every tab is its own scene | ![Isolate](docs/screenshots/meshoptimiser-isolate.webp)<br>**Isolate** — one sub-assembly, 360 of 1,583 parts |
| ![Exploded view](docs/screenshots/meshoptimiser-exploded.webp)<br>**Exploded view** — a slider per axis | ![X-ray](docs/screenshots/meshoptimiser-xray.webp)<br>**X-ray** |
| ![Heatmap](docs/screenshots/meshoptimiser-heatmap.webp)<br>**Heatmap** — triangle density, beside the heavy-parts list | ![Materials](docs/screenshots/meshoptimiser-materials.webp)<br>**Materials dock** — filter, sort, inspect |
| ![Material editor](docs/screenshots/meshoptimiser-recolour.webp)<br>**Recolour** — every part that shares a material | ![Settings](docs/screenshots/meshoptimiser-settings.webp)<br>**Settings** — one window, with search |
| ![Right-click menu](docs/screenshots/meshoptimiser-context-menu.webp)<br>**Right-click menu** | ![Export](docs/screenshots/meshoptimiser-export.webp)<br>**Export** |

---

## Why

CAD assemblies are big. A real-world STEP file might contain 400 identical bolts,
80 duplicate brackets, and half a million degenerate triangles, and still expect
your GPU to render it.

The pipeline collapses what it can:

```
   400 bolts × 50 KB        →     1 mesh × 50 KB + 400 transforms
   80 brackets × 12 KB      →     1 mesh × 12 KB + 80  transforms
   500K bad triangles       →     adaptive retess, size-culled
   ───────────────────────────────────────────────────────────
   320 MB STEP              →     11 MB Meshopt-compressed GLB
```

---

## What's in the box

A CAD preprocessor, viewer, hierarchy editor, and exporter, in one local app.

- **Pose-normalized instancing** — PCA-based hashing detects duplicate geometry
  regardless of position or rotation. One GPU mesh, N transforms.
- **Editable assembly tree** — search, isolate, recolour, batch-rename, flatten,
  dissolve, ungroup. All undoable.
- **Two renderers** — WebGPU (default, with TSL nodes and `discardNode` clipping)
  and WebGL2. Hot-swap from the toolbar, no reload.
- **Resumable sessions** — FS Access API + IndexedDB persist file handles across
  reloads. Saved scenes for view/selection/recolour state.
- **Keyboard-first UX** — command palette (⌘K), shortcuts overlay, batch rename
  (F2), context menus, undo/redo.
- **No build step** — vanilla JS, native ES modules, CSS design tokens. Edit a
  file, refresh, done.
- **Non-destructive** — original geometry is never mutated until you export.

---

## ✨ Features

### 🛠 Pipeline (STEP → GLB)
| | |
|---|---|
| 🌳 **XCAF reader**              | Per-solid colours, names, and the full assembly tree pulled straight out of OCCT |
| 🧬 **PCA pose-normalized hash** | Same shape at any rotation/translation → **one** GPU mesh + N transforms |
| 🔷 **Adaptive tessellation**    | Absolute or relative to bbox diagonal · size culling for the tiny stuff |
| 📦 **Meshopt + Draco**          | Optional `EXT_meshopt_compression` via `gltfpack` — **~10× smaller GLBs** |
| ⚡ **One-click launch**          | `start.bat` / `start.command` bootstraps the venv and opens the app in a window of its own |
| 🔁 **Background jobs**          | Long conversions run as server jobs with live progress streamed to the UI |

### 🖥 Viewer & rendering
| | |
|---|---|
| 🌐 **Dual renderer**            | **WebGPU** (default) with hot-swap to **WebGL2** — pick from the toolbar |
| 💡 **PBR + AO + envmap**        | Studio lighting, ambient occlusion, screen-space reflections, fog |
| 🎯 **Pixel-perfect picking**    | Hover, click, marquee-select; works on instanced meshes |
| 👁 **Hide / Isolate / Solo**     | One key per mode — flatten the noise, focus on what matters |
| 🎨 **Recolor by group**         | Per-instance and per-material recolouring with reset baked-in |
| 📐 **Wireframe / Shaded / Matcap** | Three viewport modes, switchable mid-flight |
| 📊 **FPS pill**                 | Tabular-numeric FPS readout, colour-coded for stutter detection |

### 🧹 Mesh tools
| | |
|---|---|
| 🕳 **Fill holes** (`P`)         | Closes bolt holes, slots, pockets and engraved lettering in flat faces; leaves bosses, washer bores and cavity openings alone. Size limit in mm, watertight result, undoable |
| 🔻 **Decimate**                 | meshoptimizer simplifier — keeps normals, UVs and vertex colours; −25 … −90 % or a triangle target for the selection |
| 📦 **Smart fit**                | Replace parts with the best low-poly proxy: box, oriented box or cylinder |
| 🧽 **Clean-up**                 | Remove small, empty, duplicate and degenerate parts; delete empty groups; split fused meshes |
| 🎨 **Materials dock**           | Filter, sort and inspect materials; select or isolate the parts that use one; assign, merge, duplicate, PBR presets |

### 🧬 Hierarchy editing
| | |
|---|---|
| 🌳 **Live tree**                | 10 K+ nodes; only the rows on screen are built, so rebuilds stay in the tens of milliseconds |
| 🔎 **Search + filters**         | Fuzzy name search, "highlight small parts" tinting |
| ✂️ **Flatten / Dissolve**        | Collapse single-child chains, dissolve groups, ungroup scopes — all undoable |
| ✏️ **Batch rename (F2)**         | Token templates (`{name}`, `{idx}`, `{depth}`) + regex find/replace + presets |
| 🔄 **Undo / Redo**              | Tree edits, recolours, renames, flattens — all on a single timeline |
| 📌 **Right-click menu**         | Hide / isolate / recolour / rename / focus camera, all in one click |

### 📤 Export
| | |
|---|---|
| 📦 **GLB / GLTF**               | Draco + Meshopt compression toggles, optional embedded textures |
| 🎬 **FBX / USDZ / OBJ / STL**   | Common DCC + AR formats, scale presets (mm/cm/m/in) or custom |
| 🧷 **Save Scene**               | Snapshot view + selection + recolours into a sidecar `.scene.json` |

### 🧰 UX & polish
| | |
|---|---|
| 👋 **Welcome modal**            | Drag-drop, browse, recent files (IndexedDB-persisted handles) |
| 🗂 **Scene tabs**                | Every tab is its own scene, with its own undo history. New and Open never replace a scene that has something in it |
| 🧩 **Command panels**            | Split (`X`) and Fill holes (`P`) open as a panel beside the viewport: `Enter` runs, `Esc` puts it away |
| ⋯ **All commands**              | Every command that acts on the model in one list, with its shortcut; what cannot run now is dimmed |
| ⌘ **Search (⌘K)**                | Every menu item and every sidebar button and control, one keystroke away, with suggestions for the selection |
| 🔢 **Drag any number**           | Shape parameters and limits are numbers you drag sideways, or click to type. Shift ×10, Alt ÷10 |
| ⌨️ **Shortcuts overlay**         | Discoverable cheatsheet with live key bindings |
| ⚙️ **Settings window**           | General, Viewport, Camera, Performance, Scene and Storage in one place, with search |
| 🎨 **Design-token system**      | Centralised CSS variables — surfaces, radii, type scale, easings |
| 📋 **Copy log / Cancel load**   | Every long operation is observable and abortable |

---

## 🛠 Pipeline

```text
   ┌──────────────┐    ┌────────────────────┐    ┌────────────────┐
   │  .step / .stp│ ─▶ │ step2glb.py (OCCT) │ ─▶ │   .glb (Draco) │
   └──────────────┘    │ • XCAF tree        │    └────────┬───────┘
                       │ • PCA instancing   │             │
                       │ • Tessellation     │             ▼
                       │ • gltfpack/Meshopt │    ┌────────────────┐
                       └────────────────────┘    │ WebGPU viewer  │
                                                 │  index.html    │
                                                 └────────────────┘
```

---

## 🧰 Tech Stack

<div align="center">

`cadquery-ocp` · `trimesh` · `numpy` · **Draco** · **Assimp** (WASM) · **WebGPU** · vanilla JS

*No framework. No bundler. No npm install. Just open and run.*

</div>

---

## 🚀 Quick Start

```bash
# Windows
start.bat

# macOS
./start.command
```

> First run bootstraps `.venv`, pulls deps, opens the viewer.
> Subsequent runs are **~1 second**.

### 🧪 Direct CLI

```bash
python step2glb.py input.step
python step2glb.py input.step --quality 0.2 --min-size 0.5
python step2glb.py input.step --no-instance       # disable instancing
python step2glb.py input.step --meshopt           # shell out to gltfpack
python step2glb.py input.step --relative          # quality as fraction of diag
```

---

## 📋 Requirements

- 🐍 **Python** 3.10 / 3.11 / 3.12 *(3.13 blocked on cadquery-ocp)*
- 🌐 A **WebGPU-capable browser** (recent Chrome, Edge, Firefox, Safari)
- 📴 **No internet needed to run** — the viewer's libraries are bundled. Only a few rarely used converters are fetched on demand
- 💾 ~**2 GB** free for the venv on first install

---

## 🗂 Layout

```text
step2glb.py        STEP → GLB converter (OCCT + instancing)
serve.py           local HTTP server + /api/convert endpoint
index.html         WebGPU viewer shell
app-v2.js          viewer logic (scene graph, picking, colour groups)
holefill.js        hole filler (pure module, no dependencies)
mesh-worker.js     background worker for Fill holes and Decimate
cloner.js          cloner (linear / grid / radial arrays)
tests/
 ├── selftest.js         in-app regression suite (?selftest)
 └── holefill.test.mjs   hole filler on synthetic shapes (node)
vendor/
 ├── three/            three.js r172: the WebGPU build and the add-ons in use
 ├── three-mesh-bvh/   pick acceleration
 ├── meshoptimizer/    simplifier (WASM, embedded)
 ├── lucide/           icon set
 ├── draco/            Draco encoder + decoder (WASM)
 ├── assimp/           Assimp.js (WASM)
 └── inter/            Inter variable font (SIL OFL)
fbx_*.py           FBX inspection / diff utilities
start.{bat,command}    one-click launchers
step2glb.{bat,command} headless converters
```

---

## 🩹 Troubleshooting

<details>
<summary><b>🪟 "python is not on PATH" on Windows</b></summary><br>
Re-run the Python installer and tick <code>Add Python to PATH</code>, or close + reopen your terminal so the new PATH is picked up.
</details>

<details>
<summary><b>🍎 "Operation not permitted" on macOS</b></summary><br>
Right-click <code>start.command</code> → <b>Open</b>. Gatekeeper blocks double-clicking freshly-unzipped scripts the first time.
</details>

<details>
<summary><b>📦 "ModuleNotFoundError: cadquery"</b></summary><br>
Delete <code>.venv/</code> and re-run <code>start.bat</code> / <code>start.command</code> to rebuild from scratch.
</details>

---

## 🗒 What's New

**v0.13.0** — it feels like an app: installs to the desktop, opens in a window of its own, and the tabs grew up.

- ![new][new] **Install it** — a web-app manifest and icon, so Chrome and Edge offer *Install*; the title bar can be folded away and the top bar takes its place.
- ![new][new] **Its own window** — `start.bat` opens the app with no address bar, tabs or extension buttons. `python serve.py --tab` for an ordinary tab.
- ![new][new] **Drag tabs into order** — sideways only, the others slide over, `Esc` puts it back.
- ![polish][polish] **The tab, rearranged** — a status dot on the icon's corner, a click on the icon saves, close at the right end.
- ![new][new] **Same sidebars in every tab** — widths and the folded left sidebar follow you between scenes; a switch turns it off.
- ![perf][perf] **While the view moves** — parts under a few pixels are skipped, and the resolution steps down only if frames are slow. Both back the moment it stops, both switches under Settings.
- ![polish][polish] Renderer picker in Settings; a Menu button without an arrow; a flat accent loading bar; Properties that does not jump.

**v0.12.0** — the app builds as well as reduces: a library drawer of 86 parametric parts to drag onto the model, Align to floor, Select hidden parts, Fit to budget, Smart fit Boxes and Blocks, Clay view, and dark parts that have a shape.

**v0.11.0** — how the app is used changes: scenes in tabs, command panels beside the viewport, numbers you drag, one Settings window, and a speed pass on a 5.4M-triangle assembly.

**v0.10.1** — libraries bundled: the app starts without a CDN and works offline.

**v0.10.0** — the biggest release so far: new tools, and everything you touch is immediate.

- ![new][new] **Fill holes** — closes bolt holes, slots, pockets and engraved lettering in flat faces and leaves everything else untouched. It tells a hole from a boss, a washer's bore or an opening into a cavity. 4,136 holes (427,543 triangles) in about two seconds on the 1,583-part test assembly.
- ![new][new] **Decimate, rebuilt** on meshoptimizer — keeps normals, UVs and colours, takes a triangle target, and reaches the export.
- ![new][new] **Materials dock** — slides up like the console: filter, sort, and an inspector with Select parts / Isolate / Assign.
- ![perf][perf] **Speed** — selection, hover, delete, undo and view switching are immediate on a 5.4M-triangle assembly; the parts tree only builds the rows on screen; Fill holes and Decimate run in background workers.
- ![fix][fix] **Parts tree** — empty groups stay listed (a setting removes them automatically if you prefer), one scroll direction with every icon lined up, deleting a group deletes the group.
- ![new][new] **View cube and axis views** — click a face for Top / Front / Side / Back / Left / Bottom; orbit out to return to perspective.
- ![new][new] **Command search** finds every sidebar button and control.
- ![polish][polish] **Interface** — Plasticity-style viewport, one button scale, three corner radii, bundled Inter, fewer pop-ups.
- ![fix][fix] **Reliability** — every editing action can be undone; a rendering freeze after repeated mesh edits is fixed; Import → Append keeps the tree; Cloner copies are exported.
- ![new][new] **Tests** — `?selftest` runs 31 regression tests inside the live app (41 as of v0.11); `node tests/holefill.test.mjs` checks the hole filler.

See [CHANGELOG.md](CHANGELOG.md) for the full list and the known issues.

---

## 🧪 Self-test

Open the app with `?selftest` (`http://localhost:4242/?selftest`) to run the
regression suite inside the live app. It drives the tree, toolbar, dialogs
and context menu like a user would and checks undo/redo, exports, save
round trips and more; results appear in a panel at the bottom right and in
the console. `?selftest=groups` runs only the tests whose name contains
"groups". Nothing is downloaded — exports are captured in memory. Add a
test to `tests/selftest.js` whenever a bug is fixed.

The hole filler has its own suite, which needs only Node:

```bash
node tests/holefill.test.mjs
```

It builds plates, pockets, counterbores, engraved letters, a boss, a washer
and a hollow box, runs the filler on them and checks that the result is
closed, has the right volume, and is untouched where it should be.

---

## 📜 License

**MIT.** Do whatever — just don't blame me when your assembly tessellates into a black hole.

<div align="center">

✦  ✦  ✦

*Built for engineers who want their CAD to load before their coffee.* ☕

</div>

<!-- ── Changelog tag badges ───────────────────────────────────────────────
     Reference-style image defs used by the What's New block above and by
     CHANGELOG.md. Single source of truth: change the colour / label here
     once and every row in the changelog updates. Modern Linear / Vercel
     palette tuned
     for cohesion: every swatch is the same Tailwind-500 luminance so the
     changelog reads as one cohesive design system rather than six unrelated
     swatches.  `style=flat` for soft pill chips with rounded corners — the
     contemporary take on shield badges.
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
