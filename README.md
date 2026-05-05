<div align="center">

```
   ███╗   ███╗███████╗███████╗██╗  ██╗
   ████╗ ████║██╔════╝██╔════╝██║  ██║
   ██╔████╔██║█████╗  ███████╗███████║
   ██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║
   ██║ ╚═╝ ██║███████╗███████║██║  ██║
   ╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝
     O P T I M I S E R   ·   v 1 . 0
```

### ⚡ From bloated CAD to browser-ready in one click. ⚡

> 🧊 **Drop a STEP.**  🔬 **Crunch the geometry.**  🚀 **Fly through it on the GPU.**
> A self-hosted, open take on the *Pixyz preprocessor* — minus the licence dongle.

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

## ✨ Features

| | |
|---|---|
| 🌳 **XCAF reader**             | Per-solid colours, names, and the full assembly tree pulled straight out of OCCT |
| 🧬 **PCA pose-normalized hash** | Same shape at any rotation/translation → **one** GPU mesh + N transforms |
| 🔷 **Adaptive tessellation**   | Absolute or relative to bbox diagonal · size culling for the tiny stuff |
| 📦 **Meshopt + Draco**         | Optional `EXT_meshopt_compression` via `gltfpack` — **~10× smaller GLBs** |
| 🌐 **WebGPU viewer**           | Hierarchy · picking · hide/isolate · colour groups — vanilla JS, **zero build step** |
| ⚡ **One-click launch**         | `start.bat` / `start.command` bootstraps the venv and opens the browser |

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

## 📜 License

**MIT.** Do whatever — just don't blame me when your assembly tessellates into a black hole.

<div align="center">

✦  ✦  ✦

*Built for engineers who want their CAD to load before their coffee.* ☕

</div>
