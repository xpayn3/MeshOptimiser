<div align="center">

<pre align="center">
███╗   ███╗███████╗███████╗██╗  ██╗
████╗ ████║██╔════╝██╔════╝██║  ██║
██╔████╔██║█████╗  ███████╗███████║
██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║
██║ ╚═╝ ██║███████╗███████║██║  ██║
╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝
  O P T I M I S E R   ·   v 1 . 1
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
[![Status](https://img.shields.io/badge/status-active-brightgreen)]()

</div>

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
- **GPU section planes** — real `discardNode`-based clipping, not a placeholder mesh.
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

Tag legend: &nbsp; ![new][new] new feature &nbsp;·&nbsp; ![fix][fix] bug fix &nbsp;·&nbsp; ![perf][perf] performance &nbsp;·&nbsp; ![polish][polish] UX / visual refinement &nbsp;·&nbsp; ![refactor][refactor] internal cleanup &nbsp;·&nbsp; ![docs][docs] documentation

### **v1.3**

v1.2 hardened the editing surface. v1.3 makes the viewport itself feel modern:
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

### **v1.2**

v1.1 was the editing surface. v1.2 hardens it: a real material editor with
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

### **v1.1**

v1.0 could open and render. v1.1 adds the editing surface around it.

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

### **v1.0** — first public commit (2026-05-05)

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

### Pre-1.0 — what predates the repo

The git history starts at v1.0, but there was a stretch of work before that.
Traces of it are still in the tree, mostly under `_archive/`:

- **FBX inspection tooling** — `fbx_inspect.py`, `fbx_diff.py`, `fbx_recursive_diff.py`,
  `fbx_validate.py`, `fbx_node_test.mjs`, `fbx_unique_names.py`. Written to figure out
  why different DCC apps disagreed about the same FBX file. The takeaway (don't rely on
  FBX as an interchange format) is why v1.0 targets GLB first.
- **Headless Blender experiments** — `blender_test.py`, `blender_test2.py`. Briefly
  considered using Blender as the converter, dropped in favour of going OCCT → GLB
  directly to avoid a lossy round-trip.
- **Pixyz feature study** — the v1.0 feature list (PCA instancing, adaptive tessellation,
  size culling, `EXT_meshopt_compression`) is a deliberate subset of what the Pixyz
  preprocessor does for browser delivery.
- **PCA hash tuning** — getting same-shape-different-pose to land on the same hash
  bucket took a few rounds of basis-canonicalisation experiments before the version
  in `step2glb.py` settled.
- **Viewer rewrite** — the `app-v2.js` filename is a fossil from this period. An
  earlier `app.js` (Three.js WebGL2, no XCAF tree) was the proving ground for picking,
  instancing, and colour-group rendering before the WebGPU + hierarchy rewrite.

---

## 📜 License

**MIT.** Do whatever — just don't blame me when your assembly tessellates into a black hole.

<div align="center">

✦  ✦  ✦

*Built for engineers who want their CAD to load before their coffee.* ☕

</div>

<!-- ── Changelog tag badges ───────────────────────────────────────────────
     Reference-style image defs used by every entry under ## Updates. Single
     source of truth: change the colour / label here once and every row in
     the changelog updates.  Hex values map to GitHub's own label palette:
       new      → green   (matches "Type: feature")
       fix      → red     (matches "Type: bug")
       perf     → amber   (performance work)
       polish   → purple  (matches "enhancement")
       refactor → blue    (matches "good first issue" link blue)
       docs     → grey    (matches "documentation")
-->
[new]:      https://img.shields.io/badge/new-1a7f37?style=flat-square
[fix]:      https://img.shields.io/badge/fix-cf222e?style=flat-square
[perf]:     https://img.shields.io/badge/perf-9a6700?style=flat-square
[polish]:   https://img.shields.io/badge/polish-8250df?style=flat-square
[refactor]: https://img.shields.io/badge/refactor-0969da?style=flat-square
[docs]:     https://img.shields.io/badge/docs-57606a?style=flat-square
