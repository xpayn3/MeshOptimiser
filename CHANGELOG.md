# Changelog

All notable changes to STEP Optimiser. Newest on top.

Tag legend: &nbsp; ![new][new] new feature &nbsp;·&nbsp; ![fix][fix] bug fix &nbsp;·&nbsp; ![perf][perf] performance &nbsp;·&nbsp; ![polish][polish] UX / visual refinement &nbsp;·&nbsp; ![refactor][refactor] internal cleanup &nbsp;·&nbsp; ![docs][docs] documentation

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
