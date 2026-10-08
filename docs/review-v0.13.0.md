# MeshOptimiser v0.13.0: code review and beta test

A read of the whole code base (app-v2.js in seven slices, the stylesheet, the markup, and the server / converter / launchers) by ten reviewers, plus hands-on testing in the running app: the regression suite, hostile and broken files, and every command on an empty scene and on a full selection with undo back to the start.

Line numbers are those of the v0.13.0 commit (2b4538d); they have shifted since. `[x]` fixed in this pass, `[~]` partly, `[ ]` open. HIGH / MED / LOW is the reviewer's severity; (PL) means plausible but not fully traced.

**Tally:** 80 fixed, 14 partly, 148 open.




## Self-test suite (39/41 before fixes)
- [x] tests/selftest.js "properties: with nothing selected…" expects "N triangles" in the card; card says "N tris". Stale test.
- [x] tests/selftest.js "materials: a colour name follows…" expects new material named mat_<hex>; app names it "Material N" on purpose (app-v2.js ~24214). Stale test.

## Reviewer A (app-v2.js 1–5200)
- [x] HIGH 4603 _promoteInstanceToMesh reads zero-scale matrix of hidden instanced part -> NaN transform spreads to all selected meshes (hide/isolate, Ctrl+A, gizmo on). Fix: use p._instOrigMat when p.visible===false; mesh.visible = p.visible!==false. (14085 handles same for export)
- [x] MED 372 Enter always accepts app dialog even when focus on Cancel; same in import modal 2021-2027 (comment says number input, code tests textarea) and quit dialog 2497-2500.
- [x] MED 2016 import dialog saves append:true with per-format options -> later plain Open becomes append. Fix: opts.append=!!forceAppend after _loadOpts; drop append before _saveOpts.
- [x] MED 2046 _ImportSettings.resetSkips() never called; "Don't ask again" cannot be undone; index.html:3950 says "(reset from File menu)". Add Settings>Storage row.
- [x] MED 2510 Quit only looks at calling tab; uses native confirm(); closed page written to iframe only. Use __moTabs dirty, appConfirm, top document.
- [x] MED 2381 Firefox/Safari fallback: cancel of Import leaves state._importMode on. Add 'cancel' listener reset.
- [ ] LOW 3660 early global shortcut handler not gated by _modalOpen().
- [x] LOW 2766 Reset all does not apply zoomToCursor to live controls.
- [ ] LOW 4078 Alt+right-drag dolly no effect in ortho views.
- [ ] LOW 2204 STEP progress not mirrored to wl-sub; abort listener added every second.
- [ ] LOW 3406 calculator copy toasts before clipboard promise resolves.
- [x] LOW 3501/3502/1655 palette rows + log tag innerHTML unescaped (no live vector found).
- [ ] LOW dead code: _SceneSettings 2534-2566; _listenerBag 188-221; commitOnRelease/onPending 726-803; $('btn-settings') 3759; showFps pref + _applyShowFps; #settings-reset handler 2855; renderer-name/dot writes 3945-3949; _selectRow 2668; _Welcome.toggle 3106; torus no-op 4543-4548.
- [~] LOW 3862 console.log '[STEP] Early file picker wired'; 4685 duplicate promote log.  — the boot log line is removed; the doubled promote log is not
- [ ] LOW stale comments: 3946-3955 top-bar renderer; 3873-3876; 3782-3784; 2632-2635; 4174-4186; 953; 427,1394 "Settings → Behavior"; 4192; 1536-1537.
- [ ] LOW orphaned comments 1054-1059 (belongs above _snapshotTreeNodes 1532); 4583-4590; 4642-4645.
- [~] LOW US spelling: 'Recenter model' 3272; "colors" 2442; index.html:3746 "Recenter on origin"/"bbox center".  — done for the strings listed; index.html done
- [ ] LOW 676/712/867 drag tooltip written three ways.
- [ ] LOW 2040, 3619, 3645 call window.lucide?.createIcons() instead of _lucide().
- [ ] LOW(PLAUSIBLE) 6975 newScene() uses "any live parts" test; should match 2093.

## Beta test (mine)
- [x] Corrupt/empty GLB or glTF: toast shows raw loader error ("GLB load failed Invalid typed array length: 4"); also says GLB for .gltf. Friendlier text.
- [x] NaN/Infinity coordinates in a file: camera goes NaN, SVG axis gizmo floods console with errors every frame. Guard.


## Reviewer F (app-v2.js 26000–31200)
- [x] HIGH 26953/26995/27110/27121 Split "Spatial proximity (AABB)": one Map entry per grid cell a triangle bbox covers, cell = 0.1% diag, no cap -> freeze/crash on big triangles (live preview 27254 runs it; Hybrid falls in at 27079/27092). Fix: cap grid 64-128 cells/axis from geometry bbox; big triangle -> centroid cell only.
- [x] MED 27186 Split weld tolerance chip: inline editor passes linear text through valToStep expecting log10 -> blur sets max. Fix valToStep: lg = v>0 ? log10(v) : v.
- [x] MED 26589 Split children get getOrCreateMaterial(part.originalColor) not source material. Fix: part.mesh.material.
- [ ] MED 26263 cloner rows open group context menu; rename/delete/ungroup/select fail (kind cloner).
- [x] MED 29150 Flatten dialog: selectedNames into innerHTML unescaped (XSS). escapeHtml.
- [ ] MED 27021 "Watertight regions" split == vertex connectivity; readout 27222 + index.html:3521 tooltip promise a manifold check. Implement or remove option.
- [ ] MED 30040 Batch rename open is quadratic (all.find per part 30044; new Map per _ancestorNames 30025).
- [ ] MED 30619 Batch rename scope radios rendered twice under same name (30688, 30718) -> default tab shows none selected.
- [ ] MED 26043/26108/26274/26161/28940 user-group rows (_ug_ string ids): parseInt NaN -> Rename/Delete/Toggle visibility do nothing; expand/collapse-all wrong.
- [x] MED 27832 Esc in dropdown inside Batch rename closes dialog too (stopImmediatePropagation); 30515 popup Esc does not stop propagation -> clearSelection also runs.
- [ ] MED(PL) 27651 Frame selected skips instanced-only parts -> frames whole model. Use p.bbox.
- [~] LOW 28073/28040 sidebar handle dblclick reset sets 280/320 but defaults are 248/280. removeProperty.  — double-click now returns to the stylesheet default; the 280/320 fallback at the drag start is unchanged
- [ ] LOW 28039 dragging right handle while left collapsed opens blank left column (read widths from body/app not root).
- [ ] LOW 26661 undo split leaves child geoms in state.geomByHash.
- [x] LOW 26266 "Add group parts to selection" uses toggle -> should be add.
- [x] LOW 26317 Lock/Unlock inverts per part on mixed selection.
- [ ] LOW 27221/27098/27186/27300 Split readout/preview mismatches (clamp 1e-3; hybrid count; scrubber start; poll signature).
- [x] LOW 30179 plain Find & Replace interprets $ in replacement. Use function replacer when not regex.
- [ ] LOW(PL) 28156 Merge drops normals if any source lacks; computeVertexNormals.
- [ ] LOW dead: 29548.. old flatten (_runFlattenOps, _flattenByDepth, _flattenLastLevel, _collapseSingleChildChains, _ungroupScope, _removeEmptyContainers, _patchTreeNodesForSubtree, _collectContainers, _isLeafGroup, _isSingleChildLink; `card` in _FlattenDialog); 26338 selection history + handlers for #tree-sel-back/#tree-sel-fwd/#tree-hide-unsel/#tree-show-all/#tree-sort (28894-28912), groupSelectedUnderNull (28318, 28680-28716); 27856 oldHandler; 27912-27928 data-mat-color branch; _explodeDragLatch 27597-27606 (+ rename _wireExplodeAndClip -> _wireExplode, also 27985); state._splitUndo 26399, _splitFromId 26605; _injectChromeStyles 30355-30362, _injectStyles 30611; backdrop mousedown 30503-30507.
- [x] LOW 29480 debug console.log([flatten] scope=…).
- [~] LOW copy: "Select same color" 26310, 27939; 27918-27919; 30315 "Material color hex"; 30642 "Color ="; 30711 "color bucket"; 27973 "Save scene" -> "Save scene…" + kbd Ctrl+S.  — "Select same/all/hide … colour" done; batch-rename strings (30315, 30642, 30711) not
- [ ] LOW stale comments: 26756-26759; 27162; 27429-27435; 27512-27513, 27595-27596; 27851, 27874-27876; 28315-28317, 28383-28385; 28512-28524; 28973-28979; 29174-29176; 29103, 30349, 30802 "click-outside closes"; 28860, 28892.

## Reviewer G (app-v2.js 31200–end)
- [x] HIGH 32022 measurement list innerHTML from it.id/it.kind unescaped; values come from scene state embedded in any opened GLB (setSerialized 32050). XSS. escapeHtml + sanitise in setSerialized.
- [x] HIGH 32968 tree drag ghost: firstLabel (textContent of escaped name) into innerHTML. XSS. escapeHtml.
- [x] HIGH 31327 measure _fmtVal appends display unit but does not convert (x _UNIT_FACTOR); labels not rebuilt on unit change (18385).
- [x] MED 35379 Select hidden parts finds nothing in Heatmap view (heat materials transparent). Use _withSolidView.
- [ ] MED 35997 Welcome "Start from a shape" with non-empty scene: new tab opens, shape added to old scene.
- [x] MED 34945 Decimate hand-updates hidden readouts; visible sb-verts/sb-mem stale. Call recomputeStats().
- [ ] MED(PL) 34722 Decimate/Budget drop single geometry group on array-material mesh (34873, 35007-35021, 34777).
- [ ] MED(PL) 34820 _decimateSelected no busy guard; second run can apply stale index ranges.
- [ ] MED 34570 Heatmap stuck after scene replaced in same tab (_heatActive never reset). Remove early return; exit in clearModel.
- [ ] MED 32628 STEP hierarchy -> user groups can never run (_pendingStepRoot nulled by clearModel 6939). Dead: 32624-32659, 32713-32731.
- [ ] MED 34302 per-part half of colour picker unreachable (.prop-color, #materials-body, data-mat-hex do not exist); buildMaterialsPanel no-op (22508). Dead 33945-34000 etc.
- [x] MED 33892 drop "before" a part missing from manual-order map -> goes to top (indexOf -1 -> 0).
- [ ] LOW 35133 Fit to budget orphans geoms in geomByHash (and on cancel 35158-35169).
- [ ] LOW 35868 Fill holes says "select it to include it" for instanced parts but selected ones are skipped too (35792).
- [ ] LOW 32699 dead keydown listener (first statement return) + _mouseOverLeftSidebar, _wireSidebarHoverScroll 32690-32711.
- [x] LOW 32041 setSerialized should call _cancelPending() not _disposePendingMarker().
- [ ] LOW 34608 Heatmap clones material per instanced group, never disposed.
- [ ] LOW(PL) 35102 Fit to budget: failed simplifier import -> misleading toast + unhandled rejection.
- [ ] LOW(PL) 34117 colour picker drag listeners only removed on pointerup (add pointercancel/lostpointercapture).
- [ ] LOW 36142-36143, 36154 comments say "File" button -> "Menu".
- [ ] LOW stale comments: 32737-32747; 34375-34378; 31265-31267, 31963-31965; 32106; 34538.
- [ ] LOW unused: _v,_v2 31278-31279; _wppPos 31286; userData._isMeasure* flags; _ensureManualSortOption 33897-33906 (+ calls 33847, 33872).
- [x] LOW 32166/34668/32568 M, 4, F2 shortcuts fire while a select is focused.
- [ ] LOW 33776 user-group drag always pushes "Move in tree" undo even if nothing changed.
- [~] LOW copy 33453/33459 "1 parts"; Decimate toasts "tris" 34963, 34888, "(no geom)" 34886 -> "triangles".  — "1 parts" fixed in the two reparent toasts; Decimate still says "tris"

## Reviewer D (app-v2.js 15600–20800)
- [x] HIGH 17083/17090 (producers 4611, cloner.js:304,322) Clay view: mesh built from live material takes shared clay material permanently (promote instance / cloner copies during Clay). Add _ownMaterial(o) helper.
- [x] MED 19085 _buildBVHsForAllGeoms finally clears state.renderPaused though it never sets it (unpauses mid-load). Delete line; fix comment 20775.
- [ ] MED 20637-20652 _addPrimitive mixes world vs partsRoot-local (spawnPos from world bbox into local position; bbox computed before parenting). worldToLocal; refresh bbox after add.
- [x] MED 16081 ASCII FBX positions fixed 4 decimals regardless of export scale. toPrecision(7).
- [ ] MED 16764/16615/16935 saved scene never records view mode (saved inside _withSolidView). Stash prev mode or drop field.
- [ ] MED 20329-20338 Y-up scene: dragged library part and ghost lie on side (_libTilt from world Y; parts built along Z). Always tilt from (0,0,1); _libFoot local z.
- [x] MED 16448 OBJ export strips non-ASCII from names (regex without u flag). Use \p{L}\p{N}.
- [ ] MED 16728 vs 16739-16740 Save scene dialog computes "Saves over" before forcing copy; never turns copy back off.
- [x] LOW 17851 `rebuildTreeSelectionOnly?.() ?? rebuildTree()` always runs full rebuild.
- [ ] LOW 20690/20707 "Primitives" group found by name prefix; count stale after delete.
- [ ] LOW(PL) 16261 ASCII FBX no Model name de-dup (binary does 15618-15640).
- [ ] LOW 18354-18360, 18312 (index.html:3296) add-shape button reacts to any mouse button, ignores keyboard, wrong tooltip.
- [ ] LOW 20201-20253 24 _LIB_EXTRA parts have no line icon; tiles drawn at boot never get one.
- [x] LOW 17145-17149 Clay "5" fires behind dialogs / with select focused. Use _typingTarget(e) || _modalOpen().
- [ ] LOW 18740-18742 CSV export ignores "selected only overrides visible"; lists cloner containers.
- [x] LOW(PL) 20324.. _libPrefs shape not validated; unguarded call at module top (20585) can stop boot. Array.isArray(recent); try/catch.
- [ ] LOW 16778/16812 Save scene remembers name + handle before write succeeds.
- [ ] LOW unused: overall/_wasEmpty 20596-20598; _smallBusy 18135; refreshFlaggedRaf 18144; _setThumb/thumbImg 18286-18291 (+ img#vp-add-prim-img index.html:3296); label 18376; R_OUTER 18529; dedup loop 15926-15936 discarded at 16103; COLORS 17480-17485; no-op Object.assign 18341; vi.style.display 20738.
- [ ] LOW 16586-16598, 16631, 17007-17009 sidecar `parts` array written never read; stale comments.
- [ ] LOW stale comments: 16191; 17185-17191; 19096-19098; 19099-19104, 19278-19282; 17589; 18879 ("1-4 shading", Clay is 5); 18657-18661.
- [~] LOW copy: 18810 "vertex colors"; 18811 "Name, color, …"; 17367/17441 "draco"; 18805 "GLTF"/"Export GLTF" -> glTF; "Exported" toast " - " vs " · ".  — export captions done; "GLTF" and the toast separator not
- [ ] LOW(PL) 18985 KTX2 transcoder fetched from unpkg (not vendored) -> offline fails.
- [ ] LOW(PL) 17478, 17503-17529 thumbnail renderer never disposed; old stepopt-prim-thumbs-v1..v8 keys never removed.
- [ ] LOW(PL) 20654 _addPrimitive id via Math.max(...spread) instead of _allocPartId().


## Reviewer C (app-v2.js 10400–15600)
- [x] HIGH 13624 recomputeStats() removes an InstancedMesh once all its parts are deleted; 'delete' undo (13518-13530) never restores it -> parts back in tree but invisible/unpickable. Fix in undo: if (p.instancedMesh && !p.instancedMesh.parent) { partsRoot.add(inst); if (p.group && !instancedGroups.includes(p.group)) push }.
- [x] HIGH 14310 Export overrides cloned live material colour with p.originalColor (merge path 14390 too) -> colour edited in material editor (_applyColor 23573-23601) not exported. Fix: editor colour change writes originalColor of parts using the material (also fixes tree swatch 10498).
- [ ] MED 13959 setViewMode() hard-writes transparent/opacity/depthWrite/depthTest/side/blending -> destroys per-material Opacity and Side (X-ray then Solid; Clay 17121; Heatmap 34650; _withSolidView 17156). Stash in m.userData._vm and restore.
- [x] MED 13169 _clonePart() gives duplicate getOrCreateMaterial(src.originalColor) not source material.
- [x] MED 12771 tab reporting in after the 9 s fallback (12736) gets hidden while active (childReady reveal sets display:none). Fix: in else branch if (REG.active === myId) activate(myId).
- [ ] MED(PL) 12724 adopting a still-starting spare has no 9 s fallback -> tab loading forever, cannot be closed.
- [ ] MED 11936/11972/13280 marquee replace, shift-range replace, duplicateParts don't clear state.selectedGroupIds.
- [x] MED 11046 _disposeEdgesFor() doesn't cancel in-flight worker job -> stale edges cached. Delete from _edgesInFlight.
- [x] MED 12050 _countPartsUsingMaterial() skips instanced parts -> "0 parts".
- [ ] LOW 13016 _Dirty says saved after >30 edits then undo all (history cap 30 at 12578).
- [x] LOW 13504 transform undo pushes a new op object to redo -> identity lost, unsaved dot stays on after undo+redo. Use state.redo.push(op).
- [x] LOW 12803 closing active tab doesn't carry sidebar layout (wins deleted before activate). Call carryLayout(id, next.id) first.
- [ ] LOW(PL) 11523 flagged fill overlay for instanced parts added to scene ignoring partsRoot transform.
- [x] LOW 11115 _edgesPrewarmFloats only grows -> prewarm switches off for the session. Reset in _prewarmEdges().
- [ ] LOW(PL) 11313 _syncPrimWireframe rebuilds every highlight pass.
- [ ] LOW(PL) 14478 _loadUmdScript never settles on retry after failed tag; _getAssimp caches rejected promise.
- [ ] LOW 14515 Draco export needs network (@gltf-transform from CDN); failed -> file still named .draco.glb (17253).
- [ ] LOW 15249 binary FBX writer spoofs Blender creator string + /foobar.fbx placeholders (experiment comment).
- [ ] LOW 11343 dead hasPrimWf logic (11356-11358).
- [ ] LOW unused: _ensureTreeRow 10476; depth0/activeAncestor 10904-10905; _FbxBinWriter.u64/patchU64 14814-14827; mats/colorHexToIdx 15136, meshNodes 15157; _isolateSet label param + shown/hidden 13857-13861 (callers 13916, 13917, 13923).
- [ ] LOW 11930 marquee toggle branch can never run; comment 11876-11879 wrong.
- [x] LOW 12824 "Unsaved pill" wording (also index.html:2777, tests/selftest.js:1031-1035).
- [ ] LOW 14456.. Draco comments + error toast 14561 "gstatic build mismatch?" stale; 14652 "re-normalized".
- [ ] LOW comments wrong/misplaced: 11705-11712 & 11763 sample counts; 11749; 10732-10736; 14036-14041; 14449-14455; 14667-14690; 14032-14034 tombstone.

## Beta (mine), continued


## Reviewer E (app-v2.js 20800–26000)
- [x] HIGH 25360 (25450, 22394) Smart fit and Center pivot move mesh origin but leave p._origWorldPos stale -> next Explode tick throws part to old origin; export wrong too. Fix: bboxifyParts set p._origWorldPos from matrixWorld after 25360 and 25450 (undo saves old); centerPivotsOnSelection null _origPos/_origWorldPos/_partCenter + state._explodeBaselineDone=false (or resetExplode first).
- [ ] MED 22605 (22890, 23995, 24133, 24229, 24268, 24318, 24402) Materials dock reads p.mesh.material; instanced parts (p.mesh null) invisible to dock: Assign does nothing, counts under-report. Helper p.mesh || p.instancedMesh, or toast skipped.
- [x] MED 21130 Escape in Shape-parameters number field leaves state._primDragging true and outline hidden. Fix: delete `_gestureBefore = null;` in Escape branch.
- [~] MED 21952/22118/22217/22352 _detachGizmo() up front; early returns never updateGizmo() -> gizmo vanishes ("Already centered" 21957, "Already in place" 22134, 22119/22126, bake nothing 22306, center pivot 22421).  — gizmo returns after "Already centred" and "Already in place"; Bake and Centre pivot early returns still to do
- [ ] MED 22023 _liveModelBox assumes _exactWorld excludes Up-axis turn but writers store full matrixWorld -> Y-up: Align to floor / Recenter miss. (convention problem; risky)
- [ ] MED 23150/24220 _matPanelSelected and state.userMaterials never reset on clearModel -> stale materials across models, Merge onto disposed material.
- [x] MED 22215 Bake gizmo transforms while exploded bakes the explosion. resetExplode() first.
- [ ] MED(PL) 21209-21211 _ingestSceneRoot computes p.bbox before attaching to partsRoot (21257). _refreshPartBBox after add.
- [ ] LOW 23374 envSection built never inserted (23419-23425); 23737 no-op; comment 23473-23475.
- [ ] LOW 21493 failed FBX load -> two error toasts.
- [x] LOW 22493 ?file= guard: backslash bypass to cross-origin fetch; not restricted to inbox/. Use new URL(f, location.href) origin + pathname check.
- [ ] LOW 22508 buildMaterialsPanel() dead (#materials-body missing); called 22583, 25760, 6999, 24169, 28856, 33989, 33996, 34293.
- [ ] LOW 22647-22719 WebGL shader-ball thumbnail path unreachable (three.webgpu has no WebGLRenderer); comments 22625-22634, 23178-23180, 23542-23544.
- [ ] LOW 21059, 21094-21107 listeners on permanently hidden primitive range sliders.
- [ ] LOW _openMaterialEditor leftovers: slider/texRow/_diamondSvg unused (23231, 23267, 23295); scrubbers [] 23490; displBias scrub; eyedropper block 23639-23654; "100%" pct pill does nothing (23928-23951).
- [ ] LOW 24385 window._populateMaterialsList wrapper bypassed by internal callers -> "used by selection" ring disappears. Move into function.
- [ ] LOW 25010/25074 Smart fit wrong vertCount (box 8 vs 24; cylinder). Use g.attributes.position.count.
- [ ] LOW 25250 vs 25271 undo item pushed before fitProxy null check.
- [ ] LOW(PL) 21178/21197 appended files take ids from state.parts.length; gap on skipped mesh. _allocPartId().
- [ ] LOW(PL) 21356 _loadGen only guards finally.
- [ ] LOW unused: partsBefore 21354; count 21735; seenGeoms 22241; baseSize 20875; assigned 24224; preIsExportSide (void); _resetFitCache() stub + calls 25090, 25633, 25638, 25639; _grabExtras/userExtras 21220.
- [ ] LOW stale comments: 22234-22240, 22340-22344 ("first part wins"); 24286-24289, 24329-24335 (disposed); 25169 ("see app-v2.js:1057"); 25584; 21259; 21724; 25660-25668.
- [~] LOW copy US "center": 21955-21969, 22349, 22409-22424, 25884-25885 (Recenter/centered/Center pivot) + index.html:3746, 3748.  — done
- [ ] LOW copy: material editor 'Color','Sheen color','Specular color','Vertex colors','Click to pick color' (23243-23370); presets 'Aluminum','Carbon Fiber' (24043-24047); Smart fit toasts 'AABB box','OBB','cyl','Box-ifying parts…' (25151, 25479-25481, 25580, 25592); 'cloned to keep shared geom safe' 22419; '1 sliver parts' 21688/21692.
- [ ] LOW 23888/23904 texture replace/clear disposes without revoking blob URL.


## Reviewer H (index.html markup 3066–4677, manifest)
- [x] HIGH 3950 "Don't ask again for this format (reset from File menu)" — no reset exists (see A 2046). Add Settings › Storage row; copy "(undo in Settings › Storage)".
- [x] HIGH 4456-4460 tooltip script adopts title once into data-tip and discards later titles -> stale tooltips (#doc-save, #tree-collapse-toggle, #vp-add-prim). Fix 4458: `if (v) t.dataset.tip = v;`.
- [x] MED 3474 `<div class="btn-row" id="sh-after" hidden>` never hidden (.btn-row{display:grid} beats [hidden]). Add `.btn-row[hidden]{display:none}`.
- [x] MED 4456-4460 tooltip code strips title = only accessible name of 48 icon-only buttons. Before removing: set aria-label from title (strip trailing "(shortcut)") if none and no text.
- [x] MED US spellings in visible text: 3086 "Optimize" -> "Optimise, inspect and convert"; 3189, 4014 "Geometry + colours"; 3272 "colour parts by triangle density"; 3333 "Neutral grey"; 3379 "Share materials by colour"; 3625 "shares a colour"/"By colour"; 3746 "bbox centre"/"Recentre on origin"; 3748 "bbox centre"/"Centre pivot"; 3909 "Colours &amp; materials"; 3911 "colours + names + hierarchy"; 3912 "no colours / hierarchy"; 3919 "colour/material overrides"; 4057 "Recentre to bbox centre"; 4058 "Centre XY, drop to floor (Z=0)"; 4091, 4111 "Vertex colours"; 4104 "per-vertex colours"; 4110 "colour + shading info"; 4148-4150 "Millimetres (mm)", "Centimetres (cm)", "Metres (m)". (visible text only; leave values/ids)
- [ ] LOW 3146-3165 old Add dropdown + old Cloner button in markup, hidden (line 2057). Dead wiring app-v2.js:17462-17660, cloner.js:1405-1429 (setInterval 200ms forever at cloner.js:1427).
- [ ] LOW 3167-3168, 4071 hidden Undo/Redo + #export-cancel: JS hard-requires btn-undo (6944, 17388) and export-cancel (18699) unguarded. Keep unless guarded.
- [ ] LOW 4133-4195 #scene-settings-modal dead frame; keep only #scene-settings-body as source; drop _SceneSettings IIFE.
- [ ] LOW 4563-4602 settings-popover half of 2nd inline script dead; `.ctx-menu` (4528) and `#vp-settings-pop.show` (4529) match nothing.
- [ ] LOW 4126 #settings-reset; 3296 #vp-add-prim-img (img without src).
- [ ] LOW missing ids looked up by JS (guarded, dead code): btn-settings (3759), btn-fit (6950, 7016, 17387), tg-bbox (16951), materials-body (22509), tree-sort (28894, 33898), tree-hide-unsel (28899), tree-show-all (28908), tree-sel-back/fwd (28911-28912).
- [ ] LOW unreferenced ids: vp-view-pill-wrap 3276, vp-tribar 3384?, split-adv 3529, import-modal-body 3888, import-modal-icon 3890, imp-append-row 3944, exp-selected-row 4064; classes with no rule/JS: vp-bar-solo 3294, split-presets 3508, sv-modal 3961, wl-titles 4238, wl-foot-hints 4285.
- [ ] LOW 3976-3982 save-name chip tooltips hard-code sample values ("Today's date, 2026-10-08", "about, 370KB"). Use "like …".
- [ ] LOW 3131 add Ctrl+E hint; 3620 title "(Ctrl+I)"; 3629 "(Ctrl+M)".
- [ ] LOW(PL) 3126, 4258 Ctrl+N reserved by browser tab.
- [ ] LOW 4433-4437, 4374 tooltip shortening hides "hold for shape picker"; backtick not drawn as key. 3296 title "Add shape (hold for more)".
- [~] LOW copy nits: 3422 grammar; 4210 "Press Ctrl+K to open the command palette and run anything by name."; 3093 curly apostrophe; 4121 placeholder "Search settings…".  — the Search settings placeholder is fixed; the other three are open
- [ ] LOW 3775 "Smart-fit EVERY part — picks tight box, OBB, or cylinder…" -> label "Smart fit all parts", plain title; 3512 "intentionally MERGES".
- [ ] LOW same thing two names: 3945 vs 4289 (Fit view after loading); 3127 vs 4256 (Open file…); 3128 vs 4257 (Import into scene…); 3126 vs 4258 (New scene); 3235 vs 3241 Reset tooltip; 3787 "geom" vs 3610 "Mesh data"; "Search commands" 3294 vs "command palette" 4210, 4285.
- [ ] LOW 3184, 4007, 4098 "GLTF" -> "glTF"; 4100 "C4D R26+" -> "Cinema 4D R26+"; 4012 STL "3D printing"; 4016 "Parts list (BOM)".
- [ ] LOW ARIA: 3815 role=tablist with aria-pressed buttons -> role=group; 3803 aria-label on role-less div; 3286 role=option without aria-selected; 3125 #file-menu lacks role=menu/menuitem; 3077 #brand-menu role=menu holds prose.
- [ ] LOW 38 .toggle switches no accessible name; 27 .field labels not tied (no for=).
- [ ] LOW 9 .modal-bg windows lack role=dialog/aria-modal/label; 4234 wl-cover aria-hidden wraps the heading.
- [ ] LOW 3574-3576 #vp-perf borrows class "vpc tl" with inline override; comment wrong.
- [ ] LOW(PL) 4652-4654 comment says cloner.js loads after app-v2.js; classic script runs first (cloner polls 10 s). Add defer.
- [ ] LOW(PL) 4530-4543 tooltip MutationObserver runs on every class/style change; early return when no tooltip.
- [ ] LOW 4634-4651 import map: unused entries three/webgpu, three/tsl, three/examples/jsm/; comment out of date. fetch('/api/…') absolute at app-v2.js:2171, 2198, 2264, 2525.
- [ ] LOW 3117, 3197 assets/webgl.png is 3000×2000 for an 18px logo.
- [ ] LOW(PL) brand mark is a lightning bolt (zap) while app icon is the icosahedron.
- [ ] LOW(PL) manifest: installed app tied to origin; server falls back to other ports (serve.py:585); #file-warn (4328) hard-codes 4242.
- Clean: versions agree; no duplicate ids (437); lucide names resolve; assets exist; manifest valid.


## Reviewer B (app-v2.js 5200–10400)
- [x] HIGH 5166 setBackground() disposes scene.background texture, but those are the cached HDRI env textures -> HDRI -> Dark -> HDRI = black. Fix: replace 5166-5169 with `if (scene.background && scene.background.isTexture) scene.background = null;`.
- [x] HIGH 5985 watchdog revive adds second rAF(tick) without cancelling the queued one (5937) -> loop runs twice per frame forever after one >3 s frame. Keep handle _tickRaf; cancel before re-queue.
- [x] MED 5995 watchdog treats deliberate renderPaused as stall: toast after 5 s, force-clears at 6013 after 10 s during load/boxify. Add && !state.renderPaused to `stuck` (+ progress stamp).
- [x] MED 8437/8423 _applySceneScale/_applySceneUpAxis don't refresh p.bbox (world) -> _MotionPerf.cull wrong (parts vanish at scene scale 1000). Recompute bboxes after.
- [ ] MED 6708 _autoInstanceFromGLB uses world matrix as instance matrix then parents under partsRoot -> double transform when partsRoot not identity. Multiply by inverse partsRoot.matrixWorld.
- [ ] MED 8752 _transformTarget() returns state.partsRoot for synthetic groups -> panel writes/reset modify partsRoot (9287, 9241, 9500-9502).
- [ ] MED 9576 "Reset Size" header menu writes 1 into size inputs = shrink part to 1 mm box (9293-9302). For parts set obj.scale.set(1,1,1).
- [ ] MED 7108/7163 screenshot only adjusts aspect for perspective; DualCamera ortho also uses aspect -> stretched ortho screenshots.
- [x] MED 7177 screenshot fallback restores with setSize(prevW, prevH) in device px -> ratio^2. Use setPixelRatio(prev); onResize().
- [ ] MED 7092 capture throw leaves temp view mode/hidden grid/aspect (no try/finally); 16384 cap > WebGPU 8192.
- [x] MED 7855 fitToView() in orthographic doesn't frame (_orthoHalfH/zoom untouched).
- [ ] MED 9937 Y-up mode wrong in several places (grid plane, fit direction 7865, OrbitControls up quat 8430).
- [ ] MED 7791 recent-file thumbnail fallback draws grid/bbox and is stretched.
- [x] MED(PL) 5735 _MotionPerf: `fastest` all-time min makes step-up unreachable; `want` never reset. Step up on ema < max(18, fastest*1.15); reset want=1, fastest=16.7 from applyPerfMode/clearModel.
- [ ] LOW 7433 screenshot dialog "Viewport 1x/2x/4x" frozen at first-open canvas size.
- [ ] LOW 9742 snap to grid hard-coded 10 for auto; grid cell change doesn't re-apply snap (18638-18641).
- [ ] LOW(PL) 6627 orphan rows spliced one by one (quadratic) on appended import.
- [ ] LOW 6094 in-browser OCCT path (getStepWorker, parseStepInWorker, loadStepFile, buildModelFromMeshes ~260 lines) reachable only via ?file= non-mesh ext; drifted + bugs (cancel never settles 6135, heartbeat 6158).
- [ ] LOW 6419 bbox overlay dead (_ensureBboxHelpers, state.bboxRoot, showBboxes, #tg-bbox css).
- [ ] LOW 6950 dead refs: btn-fit (6950, 7016, 17387); uMajorEvery 8063/8351/9718; userData.isRaymarchedGrid 8222; minorMesh etc 8020-8023; vec3 8056; accent 7283; _treeFitIndent(deepest) 10302; identical ternary 5398; 'forest' preset 5338/5388/5420; `!== 'Ready'` 7236, 7356; state.history reset twice 6925, 6943.
- [ ] LOW 5270 leaks: PMREMGenerator never disposed; _loadCustomHdri blob URL on throw (5452 vs 5463); _applyGridCell legacy dispose 9733-9734; _removeSunGizmo ArrowHelper 8704.
- [ ] LOW stale comments: 6045; 6829; 6680; 6970; 6188; 7106; 8236-8241, 8340-8347; 9881; 9986, 5803-5805; 6881; 8581.
- [ ] LOW copy: "Studio (built-in)" 5378/5444 vs "Built-in studio" 18490; "Ctrl 1" 10017 vs "Ctrl+1"; "Side"/"Left" 9914; load toast " - " 6201.
- [~] LOW 7733, 7846 console.log recent-thumb; 6482 "[STEP] perfMode" log every call -> Log.debug.  — recent-thumb logs removed; the perfMode log stays
- [x] LOW(PL) 5749 _MotionPerf.set() re-reads localStorage -> can't turn off when storage blocked. Assign directly.

## Reviewer I (index.html stylesheet 1–3066)
- [x] HIGH 790 `.toggle input{display:none}` removes all 38 switches from tab order. Hide like .wl-opt (1956-1960: position:absolute;opacity:0) + `.toggle input:focus-visible + .switch{outline:2px solid var(--ac-text);outline-offset:2px}`.
- [x] MED 2346 (2862, 2864, 2921, 3061) var(--fs-13) undefined. Add --fs-13:13px or use --fs-lg.
- [ ] MED 2563-2564 box-shadow:none!important on range thumbs incl :focus-visible; --ring-focus too faint (198); .prim-toggle input no focus style (562).
- [x] MED 673, 1259, 1645 `line-height:var(--lh-relaxed)5` / `var(--lh-base)5` invalid (stray 5).
- [ ] MED 740 .off-list scrollbar-width/scrollbar-color defeats wide scrollbar (2402-2405).
- [ ] MED 2555-2556 !important text colour on text inputs erases .invalid red (1197). Add :not(.invalid).
- [x] MED 381 `.dot{…background:var(--ok)}` global rule hits `<span class="dot">·</span>` in brand menu footer (3113) -> green disc. Scope to #stat-renderer .dot.
- [ ] MED dead CSS blocks: 985-997 #vp-settings-pop (+1995); 1009-1011, 1036-1037, 2154-2156, 2328 old materials popover; 871-881, 883 + all --btn-tint (884, 898-901, 904-905, 909, 928-935, 1985); 553-560 .prim-slider, 550-551, 2495; 802-815 .vpc.bc; selectors for nonexistent classes (.btn-split 757-760, 1789, 2516-2517; .btn-caret/.fit-item 2541-2552; .kbd-keys 346, 360; .tform-empty 433; .mat-color-hex 1092, 1135; .dd-sm 1805; .rep-up 2302; .wl-foot-tip 3033; .prop-color 494; .mat-eyedrop 1203-1206; .wl-drop.drag-over 1935; .tform-input.mixed 432; #tree-sort 645; .stat-renderer 2066, 2997; .brand h1/small 363-364); 972-980, 1868, 1885 #add-prim-menu; 885-887, 2081 thumb; .divider 376; #sb #sb-status 2144, 2148; 936-937, 943-944, 2190-2193, 2622-2625 triangle read-out; 311-312, 316-317, 954, 2176-2177, 2179 brand glow; 280-288 first scrollbar block; 692-694, 1178 .scrub-input; welcome middle layer 2024-2026, 2028, 2033, 2571, 3030; pairs 1480-1482, 1237-1238, 833, 440-441, 478, 2709, 753(first selector).
- [ ] LOW 417 padding-right:22px cancelled by later padding shorthand; 1075 border-top cancelled by border shorthand.
- [x] LOW 530 var(--fw-normal) undefined -> --fw-regular.
- [ ] LOW(PL) 1549-1552, 1281-1284 dialog transitions never run (display none -> grid same frame).
- [ ] LOW 1422, 2109, 1107, 1757, 1426 self-cancelling pseudo rules.
- [ ] LOW 462, 653, 654, 1911-1912, 1423-1424, 661, 473, 2157, 2423, 390, 2248 tree leftovers.
- [ ] LOW 14 unused tokens (--select-arrow-color 85, --sh-thumb-strong 93, --ring-focus-thick 95, --lh-flat 127, --space-3xl/4xl/5xl 150-152, --ease-in-out 170, --ease-std 172, --z-base/--z-dropdown/--z-toast 175-182, --row-selected(-hover) 1769, --menu-bg 2093, --menu-r 2470).
- [ ] LOW 565 old accent rgba(110,168,255) live on checked shape toggles; other literal clusters.
- [ ] LOW(PL) contrast: .vp-tips opacity .5 (2003-2004, 2052); 1339 placeholder; white on --ac.
- [ ] LOW stale comments (98, 2088, 2091, 307-309, 318-319, 323, 349-355, 379-380, 474-477, 1414-1418, 586, 950-952, 958, 2058-2064, 2777, orphan comment lines).

## Reviewer J (serve.py, step2glb.py, cloner.js, holefill.js, launchers)
- [x] HIGH requirements.txt: cadquery-ocp>=7.7 resolves to 8.x -> step2glb ImportError (TDF_LabelSequence). Pin `cadquery-ocp>=7.7,<8`; cap trimesh>=4.0,<6, numpy>=1.24,<3.
- [x] HIGH serve.py 377-383, 399-414, 424-518 POST endpoints no Origin/Host check: any web page can /api/quit or /api/convert. Add check in do_GET/do_POST (Host in {localhost:port,127.0.0.1:port}; Origin None or matching) -> 403. Cap running jobs.
- [x] MED serve.py 365-375 directory listings + any Host (DNS rebinding); /.git readable. Override list_directory -> 404; reject dot-segments.
- [x] MED step2glb.py 259-275 XCAF cache load returns empty doc -> degraded GLB on cache hit. Raise if free_labels.Length()==0.
- [~] MED step2glb.py 756-758, 1321-1335, 1554-1555 STEP with no solids writes no GLB, exits 0 -> "GLB fetch failed". Raise; serve.py error if dst missing.  — the server now reports "no solid bodies"; the converter still exits 0
- [x] MED start.bat 69-93 failed/outdated dependency install never repaired (venv exists -> skip). Marker file like start.command.
- [x] MED *.command committed mode 100644 (not executable); no .gitattributes (CRLF). git update-index --chmod=+x; add .gitattributes.
- [x] MED serve.py 584-590 Windows SO_REUSEADDR double bind; no server stop when window closes. allow_reuse_address = (os.name != "nt") via subclass.
- [ ] MED(PL) serve.py 52-61 POSIX cancel doesn't kill heartbeat helper.
- [x] MED step2glb.py 1745 `json` not imported at module level -> --target-tris never works.
- [x] MED step2glb.bat:13 uses global python not venv.
- [ ] MED serve.py 113-151, 320-326 every import leaves <jobid>_name.glb + params.json in inbox forever. Sweep after 24 h.
- [~] MED(PL) serve.py 528-546 app window Popen in server's process group (POSIX Ctrl+C); uses first Chromium not default browser. start_new_session.  — the app window now starts in its own session; it still uses the first Chromium found, not the default browser
- [ ] MED cloner.js 1339-1344 redo "create cloner" corrupts undo/redo stacks.
- [x] MED cloner.js 109 radial mode: clone at centre, slot at start angle empty. Delete `if (i === 0) return out.identity();`.
- [ ] LOW step2glb flags no-ops on XCAF path; params sidecar omits simplify; node.color unused; min-size bbox wrong frame; gltfpack defaults.
- [ ] LOW serve.py 303-304 + app-v2.js 2205-2210 live log stops after 200 lines.
- [~] LOW serve.py job bookkeeping (cancelled never pruned; cancel-before-Popen race; quit doesn't stop converters; /api/jobs unused).  — Quit now stops running converters; the rest is open
- [ ] LOW launchers: no Python version check; README range stale; start.bat 185-187 PATH refresh drops System32; start_hidden.vbs can hang invisibly; argument/exit-code handling.
- [ ] LOW serve.py --open cache keyed by stem; SameFileError.
- [ ] LOW cloner.js 422 Math.max spread; holefill.js 136-144 Map limit >5.6M tris.
- [ ] LOW cloner.js 836-837 distance/radius/angle fields drop decimals.
- [~] LOW loose ends: step2glb collect_solids_with_meta 427-473; cloner _renderClonerSection 790, 'dissolved' branch 1080, boot console.log + _Cloner.stress 1504-1603; serve.py:20 "pygltflib"; README.txt stale lines 14, 22, 37, 44-50; .gitignore 10-13, 31; no LICENSE file though README says MIT.  — "pygltflib" comment corrected; the rest is open

## Beta tests (mine)
- Hostile files, fresh page each (t1): no crash, no XSS from part/file names in tree/tab/properties/search/report/materials.
- [x] Corrupt/empty .glb/.gltf: error toast shows raw loader text; "GLB load failed" even for .gltf. (toast observer missed them in run 3 but they were seen in run 1)
- [x] NaN/Infinity coordinates: part loads, camera becomes NaN, SVG axis gizmo logs ~600 errors/sec forever. Guard.
- [x] 1e12, 1e-9, bad index, 3000 nodes, hostile names: fine.

