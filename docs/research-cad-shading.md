# Research: a sharp, CAD-style viewport (the Plasticity look)

Written 2026-10-08, from a Plasticity screenshot (a cylinder joined to a box, from the product's own tutorial video) and from what
MeshOptimiser does today. What is **sourced** is marked with a link; what is **inferred** from the picture is marked *(inferred)*;
colour values are **estimated by eye** from the screenshot, not measured.

---

## 1. What the reference shows

Look at one cylinder and one box, and five things make it read as sharp:

| # | What you see | Detail |
|---|---|---|
| 1 | **Matte, unlit-looking shading with big contrast between orientations** | The box's left face is a light cool grey (≈ #8d95a0), its right face a dark charcoal (≈ #2f3033): two flat tones, one per orientation. Nothing in between, no shine. |
| 2 | **A smooth side gradient on curved faces** | The cylinder goes from the same light cool grey on the left to near-black on the right in one clean sweep. No specular highlight, no reflection, no banding. |
| 3 | **Warmth on faces that look up** | The cylinder's top, the box's top and the curved cut between them are all one warm sand colour (≈ #b39c88). Cool on the sides, warm on top. |
| 4 | **Thin, near-black outlines on every edge** | About one pixel wide, always the same width on screen, antialiased: the rim of the cylinder, the box's edges, the line where the two solids meet, and the outer silhouette of the cylinder. |
| 5 | **Nothing else** | No shadows, no ambient occlusion, no environment, no grid in the crop. Flat dark grey background (≈ #222326). The picture is a technical illustration, not a render. |

Points 1–3 are the signature of a **matcap**: the colour of a pixel comes only from the direction its surface faces *as seen
from the camera*, looked up in a small picture of a lit sphere. Up (top of the sphere) is warm sand, left is light, right is dark.
That is why "up" is warm and why a curved face sweeps smoothly through the whole range. Points 4–5 are an **edge layer** on top.

---

## 2. How Plasticity gets it

**Sourced.** Plasticity's own documentation ([Shader Mode](https://doc.plasticity.xyz/plasticity-essentials/plasticity-interface/shader-mode)) says:

- When *Render Mode* is off, the viewport uses a **matcap** ("shader"): there are 14 built in, and the default is *Ceramic Dark*.
- A *Color Matcap* variant is **matte and takes the object's own colour**, so a part keeps its material colour under matcap shading.
- Others are analysis shaders (zebra, isophote, draft angle, face direction) that are matcaps or normal-based too.
- **Edges, curves and faces are shown or hidden independently**, with separate toggles. The edge layer is its own thing, not part of the surface material.
- Custom matcaps are a 512 × 512 PNG (plus an EXR) with a transparent background.

**Inferred** (not documented, from the picture and from how CAD kernels work):

- Plasticity's edges are the **edges of the B-rep** (where two faces of the solid meet), not "wherever the mesh bends". That is why the
  cylinder shows a clean rim and no faceting lines. A mesh-only viewer has to guess edges from angles instead.
- Edges are drawn at a **constant screen width** (a line, not geometry), over surfaces that are pushed slightly back in depth so the
  lines never flicker.
- The cylinder's left and right outer lines are a **silhouette** treatment (or the seam plus silhouette), because a smooth curved
  face has no topological edge there.

---

## 3. What MeshOptimiser does today

From `app-v2.js`:

- **Surfaces are physically based.** Parts use `MeshStandardMaterial` (metalness 0.15, roughness 0.55), lit by a hemisphere light, a sun, a fill light and a
  built-in studio environment (`RoomEnvironment` through PMREM, `_ensureStudioReflections`), under `NeutralToneMapping`. That gives soft, realistic
  shading with reflections: the opposite of the flat matcap look.
- **There is a Clay mode** (key 5, `_CLAY_LOOKS`: clay, porcelain, steel, red wax). It is one grey `MeshStandardMaterial`, still lit physically, with no edges.
- **There is an edge system, but only for selections.** `_getEdgesGeom` builds `THREE.EdgesGeometry(geometry, 30)` (30° crease angle), cached per geometry
  in a `WeakMap`; big geometries are computed in a **worker** (`_EDGES_INLINE_TRIS = 3000`), pre-warmed in the background
  (`_prewarmEdges`, capped at `_EDGES_PREWARM_FLOATS = 30e6`), and drawn as a **merged, world-baked line buffer** in two passes (in front, and a faint copy behind).
  It stops above `MAX_SELECTION_HIGHLIGHTS = 1500` parts.
- **Duplicates are instanced** (`auto-instance`) and a BVH is built for picking, so any edge layer has to cope with `InstancedMesh`.
- **The renderer is `WebGPURenderer`** (three r172) with a WebGL2 fallback. `THREE.TSL` node materials are available (the ray-marched grid already uses them).
- **View modes** are Solid, Wire, X-ray, Heat, Clay. Export and Save switch back to Solid first (`_withSolidView`), so a new mode must be handled there.

---

## 4. The gap

| Look | Plasticity | MeshOptimiser now |
|---|---|---|
| Shading model | Matcap, matte, normal-only | PBR with reflections |
| Contrast between faces | Strong, two or three tones | Soft, mostly one tone |
| Warm up / cool side | Yes (it is in the matcap) | No |
| Outlines on all edges | Always, 1 px black | Only the selection, cyan |
| Silhouette | Yes | No |
| Tone mapping | Off or none (exact colours) | `NeutralToneMapping` darkens and shifts colours |
| Cost on big models | Cheap (matcap is one texture lookup) | Reflections and lights per pixel |

---

## 5. What to implement (in order)

### Step 1 — a "CAD" view mode: matcap shading *(biggest change in feel, smallest code)*

- Add a view mode next to Solid / Clay (suggest key **6**, label "CAD"). Do **not** replace Solid: realistic shading is still right for
  materials and export previews.
- Material: a TSL node material (`MeshBasicNodeMaterial`) whose `colorNode` is a **matcap lookup**: take the **view-space normal**
  (`normalView`), build the matcap UV as `normalView.xy * 0.5 + 0.5` (three has `matcapUV` in TSL), sample a texture. Set `toneMapped = false`
  so the colours come out exactly as designed.
- **Generate the matcap in code** (a 256 × 256 canvas, no asset): a sphere lit from the upper left; light cool grey on the left (≈ #8d95a0), dark charcoal on the right
  (≈ #2d2e33), **warm sand on the top** (≈ #b39c88), a slightly lifted dark at the bottom so downward faces are not black, **no specular**. Keep it editable as a few
  colours so it can be offered as presets later.
- **Per-part colour (the "Color Matcap" idea):** use the matcap as a *luminance* (convert to grey) and multiply by the part's colour. A neutral grey part then looks exactly like
  the reference; a red part stays red but keeps the form shading. Offer "Material colour: on / off".
- **One shared material per colour** (the app already shares materials by colour: `state.materialByColor`), so this adds no draw-call cost. It also removes
  all light, shadow and environment work per pixel, so CAD mode will be *faster* than Solid on heavy models.
- Because it uses the view-space normal, the colours change a little as you orbit (up stays warm). That is the real Plasticity behaviour. Optionally offer a
  world-space variant (hemisphere: warm for `normal.z > 0`, cool otherwise) that stays put when you orbit.

### Step 2 — edges on every part *(this is most of the "sharp")*

- Reuse what exists: `_getEdgesGeom` (30° crease, cached, worker, pre-warm). Generalise the selection-only layer into a **scene edge layer**:
  one merged line buffer for the visible parts, rebuilt when visibility or the exploded view changes (the selection code already does this for its subset).
- Draw as `LineSegments` with a `LineBasicNodeMaterial` in near-black (≈ #0d0d10, opacity 0.9), `depthTest: true`, `depthWrite: false`. A 1-pixel hairline is what the
  reference uses and it is essentially free. If a thicker line is wanted, use `Line2` / `LineSegments2` with `Line2NodeMaterial` (about 1.25–1.5 px), at a higher cost.
- **Stop the lines flickering against the surface:** give the CAD surface material `polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1`
  (pushes surfaces back a little) and keep the lines at the default depth.
- **Which edges:** *Sharp* (the 30° crease the app already uses, plus open boundaries) is the default. Offer *All feature edges* (a lower angle, 15°) and *Off*.
  A CAD file from a STEP converter is faceted, so a 30° threshold will draw a cylinder's rim but not its facets, which is what we want.
- **Instanced parts:** an instanced duplicate shares one geometry. Either bake each instance's edges into the merged buffer (simple, uses memory) or draw one
  edge `LineSegments` per instance with its matrix (cheap in memory, more draw calls). Start with baking and a cap.
- **Budget:** skip parts that would be only a few pixels across, hide the edge layer **while the view moves** on heavy scenes (the `_MotionPerf` setting already does this for tiny
  parts), and keep a total cap on edge floats, like `_EDGES_PREWARM_FLOATS`. A scene such as `rd-fine.glb` (668k vertices) must stay interactive.

### Step 3 — silhouette lines on curved faces

A smooth cylinder has no crease, so Step 2 will not outline its sides. Pick one:

1. **Inverted hull** (cheapest to write): draw each part a second time, back faces only, pushed out along the normals by about one pixel in view space, in the line colour.
   Good for smooth parts, doubles the draw cost, can look uneven on thin parts. Use it for parts below a size limit and skip it on huge scenes.
2. **Screen-space edge detection** (cleanest result): render depth (and the normal) to a texture and draw a pixel dark where depth jumps (or the normal turns sharply)
   against its neighbour: a Sobel on the depth buffer. This gives silhouettes *and* creases in one pass, at constant screen width, independent of the model size. In three r172 this
   means a small custom post-process in TSL; check what the vendored build offers before committing.

Recommendation: ship Steps 1 and 2 first (they get most of the look), then add **option 2** as "Outline" in Settings, with option 1 as the fallback for the WebGL2 path.

### Step 4 — controls

In Settings › Viewport: *Shading* (Realistic / CAD), *Edges* (Off / Sharp / All), *Outline* (on / off), *Matcap* (Ceramic dark default, Clay, Metal, "Load a PNG…" like
Plasticity's 512 px files). The state lives in `_Prefs` and in the saved scene's view block.

### Step 5 — things that must keep working

- `_withSolidView` (Export, Save) has to swap CAD mode out, as it does for Wire / X-ray / Heat / Clay, so a file never gets matcap materials.
- The **cyan selection outline** has to stay distinct on top of black edges: keep it thicker and brighter, and draw it after the edge layer.
- X-ray, Wire and Heat do not need edges; hide the edge layer in those modes.
- The grid, fog and background settings are unaffected. Use the dark neutral background (≈ #222326) as the CAD preset.

---

## 6. How to know it worked

1. Add a cylinder and a box from the Library, join them, and switch to CAD. Compare with the reference: warm top, light left, dark right, a 1 px black rim and silhouette.
2. Orbit: no flicker on the edges, colours shift smoothly, up stays warm.
3. Open `rd-fine.glb` (668k vertices, 43 parts): the frame rate in CAD mode is **at least** Solid's. The edge layer builds in the background without freezing a click.
4. Export a GLB while in CAD mode: the file has the normal materials.
5. Memory: the edge layer stays under its cap; a cap hit shows nothing wrong, only fewer edges.

## 7. Effort, honestly

| Piece | Rough size | Risk |
|---|---|---|
| Matcap CAD mode (Step 1) | about a day | Low: one material, no assets |
| Scene edge layer (Step 2) | one to two days | Medium: instancing, rebuilds, memory caps |
| Silhouette (Step 3, depth Sobel) | one to two days | Medium: needs a depth pre-pass in WebGPU and the WebGL2 fallback |
| Controls and persistence (Step 4) | half a day | Low |

## Sources

- Plasticity documentation, Shader Mode: <https://doc.plasticity.xyz/plasticity-essentials/plasticity-interface/shader-mode>
- three.js forum, "Rendering wireframe edges similar to CAD": <https://discourse.threejs.org/t/rendering-wireframe-edges-similar-to-cad/56537> (the thread points to the "LDraw-like edges" approach; it does not go into detail)
- three.js forum, "How to get Onshape-like rendering": <https://discourse.threejs.org/t/how-to-get-onshape-like-rendering/20463/2>
- three.js forum, "Depicting edges": <https://discourse.threejs.org/t/depicting-edges/10927>
- McGill, "Technical illustration" (silhouette and crease rendering): <https://cs.mcgill.ca/~kwysoc/npr/final/techquake.pdf>

---

## 8. What was built, and what the real app taught us (2026-10-08)

Built: the CAD view (key 6) with matcap shading (`_CAD_LOOKS`: Ceramic, Light, Mono), edge lines on every part, a shader silhouette,
and the Settings to go with them. Checked by driving the real app in headless Chrome (`tests/e2e-smoke.mjs`).

Two things only the real app showed:

1. **`polygonOffset` does nothing on this three.js version's WebGPU backend** (r172: the depth-bias options are not passed to the
   pipeline; only the WebGL backend calls `gl.polygonOffset`). A line lying on the face it borders then fights that face for the
   pixel, and which one wins changes with the camera angle: "half the lines on one tilt, the other half on the other".
   Fix: the line material pulls every vertex toward the camera by 0.16 % of its distance, in its own vertex shader (`_CAD_EDGE_MAT`),
   which works on both backends. On a worst-case test scene (thin frames exactly on a wall) the old lines lost 25–45 % of their pixels.
2. **The ground grid is a transparent plane that writes its own depth** and is drawn before other transparent objects. Edge lines drawn
   after it vanish wherever the plane lies between them and the camera: the part of a model below the grid when you look from above,
   the part above it when you look from below. Fix: the lines have `renderOrder -2`, so they are drawn before the grid.
   On the Drive Unit the line pixels went from 8,079 to 14,558 (from above the grid) and from 1,620 to 3,860 (from below).

A third fix, to the silhouette shader: it darkened every face seen at a grazing angle (a window frame's side wall, black on top and
bright below). It now applies only where the surface really curves away (`fwidth` of n·v above a small threshold).

Still open: parts beyond the edge budget (30 M floats, 6,000 parts) are drawn without edges, the smallest first, and the app says so;
a part's textures are ignored in the CAD view (flat colour only).
