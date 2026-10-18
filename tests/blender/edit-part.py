# blender --background --factory-startup --python tests/blender/edit-part.py -- <in file> <out file>
# Opens a part the app exported, edits it as someone would in Blender (every face cut in four, nothing moved) and writes it back in the
# same format, with Blender's own exporter at its defaults. What the app must then do is take it back and put it where it was.
import bpy, bmesh, sys, os
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
ext = src.rsplit('.', 1)[-1].lower()
bpy.ops.wm.read_factory_settings(use_empty=True)
{'glb': lambda: bpy.ops.import_scene.gltf(filepath=src), 'gltf': lambda: bpy.ops.import_scene.gltf(filepath=src),
 'fbx': lambda: bpy.ops.import_scene.fbx(filepath=src), 'obj': lambda: bpy.ops.wm.obj_import(filepath=src)}[ext]()
for o in bpy.context.scene.objects:
    if o.type != 'MESH': continue
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    bm.to_mesh(o.data); bm.free()
bpy.ops.object.select_all(action='SELECT')
{'glb': lambda: bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB'),
 'fbx': lambda: bpy.ops.export_scene.fbx(filepath=dst),
 'obj': lambda: bpy.ops.wm.obj_export(filepath=dst, export_materials=False)}[ext]()
print('EDITED', dst)
