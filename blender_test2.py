"""Run via blender --background --python blender_test2.py -- <fbx_path>"""
import bpy, sys, os

argv = sys.argv
if '--' in argv:
    argv = argv[argv.index('--') + 1:]
else:
    argv = []

fbx = argv[0] if argv else 'test_out.fbx'
fbx = os.path.abspath(fbx)
print('=== Testing FBX import:', fbx)

bpy.ops.wm.read_factory_settings(use_empty=True)

try:
    result = bpy.ops.import_scene.fbx(filepath=fbx)
    print('=== IMPORT RESULT:', result)
    counts = {}
    total_verts = 0
    for obj in bpy.data.objects:
        counts[obj.type] = counts.get(obj.type, 0) + 1
        if obj.type == 'MESH' and obj.data:
            total_verts += len(obj.data.vertices)
    print('=== Object type counts:', counts)
    print('=== Total mesh vertices:', total_verts)
    # Sample first few meshes.
    n = 0
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and n < 5:
            print(f'   sample mesh: {obj.name}  verts={len(obj.data.vertices)}  faces={len(obj.data.polygons)}')
            n += 1
    print('=== SUCCESS' if total_verts > 0 else '=== EMPTY - no mesh data attached!')
except Exception as e:
    print('=== IMPORT FAILED:', type(e).__name__, e)
