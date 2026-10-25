# blender --background --factory-startup --python tests/blender/group-pivots.py -- <file.glb|file.fbx> <out.json>
# What Blender (or any reader of the file) sees of the groups: every empty with where it stands in the world, and its children meshes' places.
import bpy, sys, json, os
src, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(src)[1].lower()
if ext in ('.glb', '.gltf'): bpy.ops.import_scene.gltf(filepath=src)
elif ext == '.fbx': bpy.ops.import_scene.fbx(filepath=src)
else: raise SystemExit('unknown file type ' + ext)
bpy.context.view_layer.update()
res = []
for o in bpy.data.objects:
    if o.type != 'EMPTY': continue
    res.append({
        'name': o.name, 'at': list(o.matrix_world.translation),
        'children': [{'name': c.name, 'type': c.type, 'at': list(c.matrix_world.translation)} for c in o.children],
    })
json.dump(res, open(out, 'w'))
print('GROUPS', len(res))
