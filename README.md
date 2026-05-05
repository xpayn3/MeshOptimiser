# MeshOptimiser

A native STEP → GLB pipeline with a WebGPU viewer. Drop a CAD assembly in,
get back a tiny, instanced, browser-ready mesh — and inspect it on the spot.

Think of it as a self-hosted, open take on the Pixyz preprocessor: shape-aware
instancing, configurable tessellation, optional Meshopt compression, all wired
into a one-click local app.

## What it does

- **XCAF-based STEP reader** — pulls per-solid colors, names, and the full assembly tree out of OCCT
- **PCA pose-normalized instancing** — the same screw at 400 different positions becomes *one* GPU mesh + 400 transforms
- **Configurable tessellation** — absolute or relative to bbox diagonal, with optional size culling for tiny parts
- **Meshopt / Draco** — optional EXT_meshopt_compression via `gltfpack` for ~10× smaller GLBs
- **WebGPU viewer** — inspect the result in the browser: color groups, hierarchy, hide/isolate, the lot

## Stack

`cadquery-ocp` (OCCT) · `trimesh` · `numpy` · Draco + Assimp WASM ·
WebGPU · vanilla JS (no framework, no build step)

## Quick start

```bash
# Windows
start.bat

# macOS
./start.command
```

First run bootstraps a `.venv`, pulls dependencies, opens the viewer.
Subsequent runs are ~1s.

Direct CLI:

```bash
python step2glb.py input.step --quality 0.2 --min-size 0.5 --meshopt
```

## Requirements

- Python 3.10 / 3.11 / 3.12 (3.13 is blocked on cadquery-ocp)
- A WebGPU-capable browser (recent Chrome, Edge, Firefox, Safari)
- ~2 GB free for the venv on first install

## Layout

```
step2glb.py        STEP → GLB converter (OCCT + instancing)
serve.py           local HTTP server + /api/convert endpoint
index.html         WebGPU viewer shell
app-v2.js          viewer logic (scene graph, picking, color groups)
vendor/            Draco + Assimp WASM
fbx_*.py           FBX inspection / diff utilities
```

## License

MIT.
