<div align="center">

```
   ███╗   ███╗███████╗███████╗██╗  ██╗
   ████╗ ████║██╔════╝██╔════╝██║  ██║
   ██╔████╔██║█████╗  ███████╗███████║
   ██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║
   ██║ ╚═╝ ██║███████╗███████║██║  ██║
   ╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝
     O P T I M I S E R   ·   v 1 . 1
```

### ⚡ From bloated CAD to browser-ready in one click. ⚡

> 🧊 **Drop a STEP.**  🔬 **Crunch the geometry.**  🚀 **Fly through it on the GPU.**
> A self-hosted, open take on the *Pixyz preprocessor* — minus the licence dongle,
> minus the seat-fee, minus the install wizard. Just Python and your browser.

[![Python](https://img.shields.io/badge/python-3.10%20|%203.11%20|%203.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![OCCT](https://img.shields.io/badge/OCCT-cadquery--ocp-red)](https://github.com/CadQuery/OCP)
[![WebGPU](https://img.shields.io/badge/WebGPU-ready-005A9C?logo=webgpu)](https://www.w3.org/TR/webgpu/)
[![Draco](https://img.shields.io/badge/compression-Draco%20%2B%20Meshopt-success)](https://github.com/google/draco)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#-license)
[![Platform](https://img.shields.io/badge/platform-Windows%20|%20macOS-lightgrey)](#-requirements)
[![Status](https://img.shields.io/badge/status-active-brightgreen)]()

</div>

---

## 🎯 Why?

CAD assemblies are *enormous*. A real-world `.step` file can hide **400 identical bolts**,
**80 duplicate brackets**, and **half a million degenerate triangles** — and still expect
your GPU to swallow it whole.

**MeshOptimiser** chews through it instead:

```
   400 bolts × 50 KB        →     1 mesh × 50 KB + 400 transforms
   80 brackets × 12 KB      →     1 mesh × 12 KB + 80  transforms
   500 K bad triangles      →     adaptive retess, size-culled
   ───────────────────────────────────────────────────────────
   320 MB STEP              →     11 MB Meshopt-compressed GLB ✨
```

---

## 💎 What makes it special

This isn't another GLB viewer. It's a **full CAD preprocessor + inspector + editor + exporter**
that runs entirely on your machine, with a UI that feels like a native desktop app and a
renderer that doesn't blink at 10,000-node assemblies.

- 🧠 **Smart by default** — PCA pose-normalized hashing finds duplicate geometry across
  any rotation/translation. No tagging, no manual grouping. Drop a STEP, get instances.
- 🎛 **Hierarchy as a first-class citizen** — Browse, search, isolate, recolour, batch-rename,
  flatten, dissolve, ungroup. Edit the assembly tree like layers in Photoshop.
- ⚙️ **Two renderers, one app** — Hot-swap between **WebGPU** (TSL nodes, compute shaders,
  custom discardNode clipping) and **WebGL2** at runtime. No reload. No regression.
- 🔪 **Real section/clip planes** — Live cross-section via TSL `discardNode`, not a fake
  plane mesh. Cut into your assembly and see what's inside, instantly.
- 💾 **Resume where you left off** — Recent files, file-handle persistence (FS Access API
  + IndexedDB), saved scenes. Close the tab, come back, hit *Resume*.
- ⌨️ **Real keyboard support** — Command palette (⌘K), shortcuts overlay, F2 batch rename,
  context menus, undo/redo. Mouse-only is optional.
- 🪶 **Zero build step** — Vanilla JS, native ES modules, design tokens in CSS. Inspect it,
  fork it, edit a line, refresh. No webpack, no Vite, no `node_modules` graveyard.
- 🧪 **Lossless until you say otherwise** — Edits are reversible. Exports are explicit.
  The original geometry is never mutated until you press *Export*.

---

## ✨ Features

### 🛠 Pipeline (STEP → GLB)
| | |
|---|---|
| 🌳 **XCAF reader**              | Per-solid colours, names, and the full assembly tree pulled straight out of OCCT |
| 🧬 **PCA pose-normalized hash** | Same shape at any rotation/translation → **one** GPU mesh + N transforms |
| 🔷 **Adaptive tessellation**    | Absolute or relative to bbox diagonal · size culling for the tiny stuff |
| 📦 **Meshopt + Draco**          | Optional `EXT_meshopt_compression` via `gltfpack` — **~10× smaller GLBs** |
| ⚡ **One-click launch**          | `start.bat` / `start.command` bootstraps the venv and opens the browser |
| 🔁 **Background jobs**          | Long conversions run as server jobs with live progress streamed to the UI |

### 🖥 Viewer & rendering
| | |
|---|---|
| 🌐 **Dual renderer**            | **WebGPU** (default) with hot-swap to **WebGL2** — pick from the toolbar |
| 🔪 **Section / Clip planes**    | Live cross-section via TSL `discardNode` — true GPU clipping, not fake plane meshes |
| 💡 **PBR + AO + envmap**        | Studio lighting, ambient occlusion, screen-space reflections, fog |
| 🎯 **Pixel-perfect picking**    | Hover, click, marquee-select; works on instanced meshes |
| 👁 **Hide / Isolate / Solo**     | One key per mode — flatten the noise, focus on what matters |
| 🎨 **Recolor by group**         | Per-instance and per-material recolouring with reset baked-in |
| 📐 **Wireframe / Shaded / Matcap** | Three viewport modes, switchable mid-flight |
| 📊 **FPS pill**                 | Tabular-numeric FPS readout, colour-coded for stutter detection |

### 🧬 Hierarchy editing
| | |
|---|---|
| 🌳 **Live tree**                | 10 K+ nodes, virtualized, sticky right column, content-visibility tuned |
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
| ⌘ **Command palette (⌘K)**       | Searchable action registry — every menu item, one keystroke away |
| ⌨️ **Shortcuts overlay**         | Discoverable cheatsheet with live key bindings |
| ⚙️ **Settings modal**            | Persistent prefs (renderer, perf mode, background, toggles) |
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
- 💾 ~**2 GB** free for the venv on first install

---

## 🗂 Layout

```text
step2glb.py        STEP → GLB converter (OCCT + instancing)
serve.py           local HTTP server + /api/convert endpoint
index.html         WebGPU viewer shell
app-v2.js          viewer logic (scene graph, picking, colour groups)
vendor/
 ├── draco/        Draco encoder + decoder (WASM)
 └── assimp/       Assimp.js (WASM)
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

## 🗒 Updates

### **v1.1** — *the "feels like a real app" release*

The viewer grew up. v1.0 could open and render. v1.1 lets you **work**.

**🆕 New features**

- 👋 **Welcome modal** — drag-drop, browse, recents with FS Access API + IndexedDB handle persistence. Resume your last file with one click.
- ⌘ **Command palette (⌘K / Ctrl-K)** — every action in the app, fuzzy-searchable.
- ⌨️ **Shortcuts overlay** — `?` to open, full keymap, always in sync.
- ⚙️ **Settings modal** — persistent prefs for renderer, perf mode, background, FPS pill, instancing, material sharing, auto-rotate, highlight thresholds.
- 🔪 **Section / Clip planes** — TSL `discardNode`-based GPU clipping. Live cross-sections, no shader fakery.
- 🌐 **Renderer hot-swap** — switch between **WebGPU** and **WebGL2** from the toolbar without reloading.
- ✏️ **Batch rename (F2)** — token templates, regex find/replace, presets, live preview.
- ✂️ **Hierarchy flatten / dissolve / ungroup** — clean up imported assemblies; every edit is undoable.
- 🔄 **Undo / Redo** for tree edits, recolours, renames, and flatten ops.
- 📌 **Right-click context menu** on tree rows.
- 💾 **Save Scene** — snapshot view + selection + recolours.
- 🏷 **Brand menu** — about / GitHub / version / shortcuts dropdown.
- 📊 **FPS pill** with colour-coded stutter detection.
- 🎨 **Design tokens** — centralised CSS variables (surfaces, radii, type scale, easings) drive the entire UI.
- 🚦 **Cancel + Copy-log** on every long-running load.

**🛠 Improvements**

- 🚀 Tree expand/collapse on 10 K+ nodes is now **<10 ms** (was ~1 s) — class-flip toggling instead of DOM rebuild.
- 🎭 Modal body scrolls so the footer stays visible on short screens.
- 🔧 Toolbar `Export` is now a dropdown menu with consolidated settings modal.
- 🎯 Highlight-small-parts toggle with subtle yellow-tinted rows.
- 🧹 Viewport perf cleanups, dead-button fixes, archive of stale experiments.

### **v1.0** — initial release
- STEP → GLB pipeline with OCCT, PCA instancing, adaptive tessellation, Meshopt/Draco compression.
- WebGPU viewer with hierarchy, picking, hide/isolate, colour groups.
- One-click launchers for Windows + macOS.

---

## 📜 License

**MIT.** Do whatever — just don't blame me when your assembly tessellates into a black hole.

<div align="center">

✦  ✦  ✦

*Built for engineers who want their CAD to load before their coffee.* ☕

</div>
