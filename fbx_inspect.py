"""Inspect Geometry/Model nodes and Connections in the user's FBX."""
import struct, sys, os

path = sys.argv[1] if len(sys.argv) > 1 else 'test_out.fbx'
with open(path, 'rb') as f:
    data = f.read()

version = struct.unpack_from('<I', data, 23)[0]
sz = 8 if version >= 7500 else 4
fmt = '<Q' if sz==8 else '<I'

def parse_node(off):
    end_off = struct.unpack_from(fmt, data, off)[0]
    if end_off == 0: return None, off + (3*sz + 1)
    num_props = struct.unpack_from(fmt, data, off + sz)[0]
    prop_list_len = struct.unpack_from(fmt, data, off + 2*sz)[0]
    name_len = data[off + 3*sz]
    name = data[off + 3*sz + 1 : off + 3*sz + 1 + name_len].decode('utf-8', 'replace')
    props_start = off + 3*sz + 1 + name_len
    return {'name':name, 'num_props':num_props, 'prop_list_len':prop_list_len,
            'props_start':props_start, 'children_start':props_start + prop_list_len,
            'end_off':end_off}, end_off

def parse_props(start, count):
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
            count_a = struct.unpack_from('<I', data, pos)[0]; pos += 4
            enc = struct.unpack_from('<I', data, pos)[0]; pos += 4
            cl = struct.unpack_from('<I', data, pos)[0]; pos += 4
            out.append((t, f'array(count={count_a},enc={enc},bytes={cl})'))
            pos += cl
    return out

# Find Objects and Connections.
objects_node = None
connections_node = None
pos = 27
while pos < len(data):
    n, next_off = parse_node(pos)
    if n is None: break
    if n['name'] == 'Objects': objects_node = n
    elif n['name'] == 'Connections': connections_node = n
    pos = next_off

# Count Geometry and Model under Objects.
geom_count = 0; model_count = 0
geom_ids = set(); model_ids = set()
first_geom = None; first_mesh_model = None
pos = objects_node['children_start']
while pos < objects_node['end_off']:
    n, next_off = parse_node(pos)
    if n is None: break
    ps = parse_props(n['props_start'], n['num_props'])
    if n['name'] == 'Geometry':
        geom_count += 1
        if ps and ps[0][0] == 'L': geom_ids.add(ps[0][1])
        if first_geom is None: first_geom = (n, ps)
    elif n['name'] == 'Model':
        model_count += 1
        if ps and ps[0][0] == 'L': model_ids.add(ps[0][1])
        if first_mesh_model is None and len(ps) >= 3 and ps[2][1] == b'Mesh':
            first_mesh_model = (n, ps)
    pos = next_off

print(f'Objects: {geom_count} Geometry, {model_count} Model')
print(f'  geom IDs sample: {list(geom_ids)[:5]}')
print(f'  model IDs sample: {list(model_ids)[:5]}')

# Sample first geometry props.
if first_geom:
    n, ps = first_geom
    print(f'\nFirst Geometry props: {ps}')
    # Inspect children for Vertices/PolygonVertexIndex.
    cpos = n['children_start']
    while cpos < n['end_off']:
        cn, cnext = parse_node(cpos)
        if cn is None: break
        cps = parse_props(cn['props_start'], cn['num_props'])
        print(f'  child {cn["name"]!r}: {cps[:2]}')
        cpos = cnext

if first_mesh_model:
    n, ps = first_mesh_model
    print(f'\nFirst Mesh Model props: {ps[:3]}')

# Walk Connections, look for Geometry→Model links.
print('\n--- Connections sample (first 10) ---')
cpos = connections_node['children_start']
seen_oo_geom = 0; seen_oo_geom_to_model = 0
total_c = 0
while cpos < connections_node['end_off']:
    cn, cnext = parse_node(cpos)
    if cn is None: break
    if cn['name'] == 'C':
        total_c += 1
        cps = parse_props(cn['props_start'], cn['num_props'])
        if total_c <= 10:
            print(f'  C: {cps}')
        # Check if it's an OO connection from a Geometry to a Model.
        if len(cps) == 3 and cps[0] == ('S', b'OO'):
            src = cps[1][1]; dst = cps[2][1]
            if src in geom_ids:
                seen_oo_geom += 1
                if dst in model_ids:
                    seen_oo_geom_to_model += 1
    cpos = cnext

print(f'\nTotal C records: {total_c}')
print(f'OO connections from Geometry: {seen_oo_geom}')
print(f'  ...with destination = Model: {seen_oo_geom_to_model}')
