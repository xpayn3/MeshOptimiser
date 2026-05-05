"""Diff structural details between C4D's reference and our latest export."""
import struct, sys

def parse_node(data, offset, sz):
    fmt = '<Q' if sz==8 else '<I'
    end_off = struct.unpack_from(fmt, data, offset)[0]
    if end_off == 0: return None, offset + (3*sz + 1)
    num_props = struct.unpack_from(fmt, data, offset + sz)[0]
    prop_list_len = struct.unpack_from(fmt, data, offset + 2*sz)[0]
    name_len = data[offset + 3*sz]
    name = data[offset + 3*sz + 1 : offset + 3*sz + 1 + name_len].decode('utf-8', 'replace')
    props_start = offset + 3*sz + 1 + name_len
    return {'name':name, 'num_props':num_props, 'prop_list_len':prop_list_len,
            'props_start':props_start, 'children_start':props_start + prop_list_len,
            'end_off':end_off}, end_off

def parse_props(data, start, count):
    pos = start; out = []
    for _ in range(count):
        t = chr(data[pos]); pos += 1
        if t == 'I': out.append(('I', struct.unpack_from('<i', data, pos)[0])); pos += 4
        elif t == 'L': out.append(('L', struct.unpack_from('<q', data, pos)[0])); pos += 8
        elif t == 'D': out.append(('D', struct.unpack_from('<d', data, pos)[0])); pos += 8
        elif t == 'C': out.append(('C', data[pos])); pos += 1
        elif t in ('S','R'):
            ln = struct.unpack_from('<I', data, pos)[0]; pos += 4
            out.append((t, data[pos:pos+ln])); pos += ln
        elif t in 'fdli':
            ca = struct.unpack_from('<I', data, pos)[0]; pos += 4
            enc = struct.unpack_from('<I', data, pos)[0]; pos += 4
            cl = struct.unpack_from('<I', data, pos)[0]; pos += 4
            out.append((t, f'array(count={ca},enc={enc})')); pos += cl
    return out

def find_top_node(data, name):
    sz = 8 if struct.unpack_from('<I', data, 23)[0] >= 7500 else 4
    pos = 27
    while pos < len(data):
        n, next_off = parse_node(data, pos, sz)
        if n is None: break
        if n['name'] == name: return n, sz
        pos = next_off
    return None, sz

def get_first_child(data, parent, child_name, sz):
    pos = parent['children_start']
    while pos < parent['end_off']:
        n, next_off = parse_node(data, pos, sz)
        if n is None: break
        if n['name'] == child_name: return n
        pos = next_off
    return None

def dump_subtree(data, off, end, depth, sz, max_depth=4):
    if depth > max_depth: return
    pos = off
    while pos < end:
        n, next_off = parse_node(data, pos, sz)
        if n is None: break
        ps = parse_props(data, n['props_start'], n['num_props'])
        s = []
        for t, v in ps[:8]:
            if isinstance(v, bytes):
                s.append(f"{t}:{v[:40]!r}")
            else:
                s.append(f"{t}:{v}")
        print('  '*depth + f"{n['name']!r} [{', '.join(s)}]")
        if n['children_start'] < n['end_off']:
            dump_subtree(data, n['children_start'], n['end_off']-(3*sz+1), depth+1, sz, max_depth)
        pos = next_off

# Three files: Blender's resaved-from-our-FBX, our broken version, C4D's reference.
blender_path = r'C:\Users\Luka\Downloads\blender_convert.fbx'
ours_path = r'C:\Users\Luka\Downloads\step_optimized (12).fbx'

for label, path in [('BLENDER', blender_path), ('OURS', ours_path)]:
    with open(path, 'rb') as f: data = f.read()
    print(f'\n========== {label}: {path} ==========')
    print(f'  size={len(data)} version={struct.unpack_from("<I", data, 23)[0]}')

    # Connections — first 6 lines.
    n, sz = find_top_node(data, 'Connections')
    if n:
        print(f'\n  --- Connections (first 8) ---')
        pos = n['children_start']; cnt = 0
        while pos < n['end_off'] and cnt < 8:
            cn, cnext = parse_node(data, pos, sz)
            if cn is None or cn['name'] != 'C': break
            ps = parse_props(data, cn['props_start'], cn['num_props'])
            print(f'  C: {ps}')
            pos = cnext; cnt += 1

    # Geometry block - first one.
    objects, _ = find_top_node(data, 'Objects')
    if objects:
        first_geom = get_first_child(data, objects, 'Geometry', sz)
        if first_geom:
            print(f'\n  --- First Geometry block ---')
            ps = parse_props(data, first_geom['props_start'], first_geom['num_props'])
            print(f'  Geometry props: {ps}')
            dump_subtree(data, first_geom['children_start'], first_geom['end_off']-(3*sz+1), 1, sz, max_depth=3)

        # First Model.
        pos = objects['children_start']
        while pos < objects['end_off']:
            n, next_off = parse_node(data, pos, sz)
            if n is None: break
            if n['name'] == 'Model':
                ps = parse_props(data, n['props_start'], n['num_props'])
                # Skip cameras / lights, find first 'Mesh' or 'Null'
                if len(ps) >= 3 and ps[2][1] in (b'Mesh', b'Null'):
                    print(f'\n  --- First "Mesh"/"Null" Model ---')
                    print(f'  Model props: {ps}')
                    dump_subtree(data, n['children_start'], n['end_off']-(3*sz+1), 1, sz, max_depth=3)
                    break
            pos = next_off
