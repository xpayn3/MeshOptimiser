"""Validate FBX structure: duplicate IDs, dangling connections, cycles,
declared-vs-actual counts. Prints first issue found."""
import struct, sys

path = sys.argv[1] if len(sys.argv) > 1 else 'test_out.fbx'
with open(path, 'rb') as f: data = f.read()
version = struct.unpack_from('<I', data, 23)[0]
sz = 8 if version >= 7500 else 4
print(f'file: {path}  size={len(data)}  version={version}')

def parse_node(off):
    fmt = '<Q' if sz==8 else '<I'
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
            ca = struct.unpack_from('<I', data, pos)[0]; pos += 4
            enc = struct.unpack_from('<I', data, pos)[0]; pos += 4
            cl = struct.unpack_from('<I', data, pos)[0]; pos += 4
            out.append((t, f'array(count={ca})')); pos += cl
    return out

def find_top(name):
    pos = 27
    while pos < len(data):
        n, next_off = parse_node(pos)
        if n is None: break
        if n['name'] == name: return n
        pos = next_off
    return None

# Walk Objects: collect all (id, type, name).
objects_n = find_top('Objects')
all_ids = {}     # id -> (name, type)
counts_by_type = {}
pos = objects_n['children_start']
while pos < objects_n['end_off']:
    n, next_off = parse_node(pos)
    if n is None: break
    ps = parse_props(n['props_start'], n['num_props'])
    obj_type = n['name']
    counts_by_type[obj_type] = counts_by_type.get(obj_type, 0) + 1
    if ps and ps[0][0] == 'L':
        oid = ps[0][1]
        if oid in all_ids:
            print(f'!!! DUPLICATE ID: {oid} previously {all_ids[oid]} now ({obj_type}, {ps[1][1] if len(ps) > 1 else "?"})')
        all_ids[oid] = (obj_type, ps[1][1] if len(ps) > 1 else b'')
    pos = next_off

print(f'\nObject counts: {counts_by_type}')
print(f'Total objects: {len(all_ids)}')

# Verify Definitions counts match.
defs = find_top('Definitions')
declared_counts = {}
pos = defs['children_start']
while pos < defs['end_off']:
    n, next_off = parse_node(pos)
    if n is None: break
    if n['name'] == 'ObjectType':
        ps = parse_props(n['props_start'], n['num_props'])
        if ps and ps[0][0] == 'S':
            type_name = ps[0][1].decode()
            # Find Count child.
            cpos = n['children_start']
            while cpos < n['end_off']:
                cn, cnext = parse_node(cpos)
                if cn is None: break
                if cn['name'] == 'Count':
                    cps = parse_props(cn['props_start'], cn['num_props'])
                    declared_counts[type_name] = cps[0][1]
                    break
                cpos = cnext
    pos = next_off

print(f'\nDeclared in Definitions: {declared_counts}')
for t, count in counts_by_type.items():
    declared = declared_counts.get(t, '???')
    if t != 'GlobalSettings' and declared != count:
        print(f'!!! MISMATCH: {t} declared={declared} actual={count}')

# Walk Connections: check for dangling refs, duplicate edges, cycles.
conns_n = find_top('Connections')
all_edges = []
duplicates = 0
dangling = 0
self_refs = 0
seen_edges = set()
pos = conns_n['children_start']
while pos < conns_n['end_off']:
    n, next_off = parse_node(pos)
    if n is None: break
    if n['name'] == 'C':
        ps = parse_props(n['props_start'], n['num_props'])
        if len(ps) >= 3 and ps[0][0] == 'S':
            kind = ps[0][1]
            src = ps[1][1]; dst = ps[2][1]
            edge = (kind, src, dst)
            if edge in seen_edges:
                duplicates += 1
                if duplicates <= 5: print(f'!!! DUPLICATE edge: {edge}')
            seen_edges.add(edge)
            if src == dst and src != 0:
                self_refs += 1
                if self_refs <= 5: print(f'!!! SELF-REF: {edge}')
            if src != 0 and src not in all_ids:
                dangling += 1
                if dangling <= 5: print(f'!!! DANGLING SRC: {src} (edge to {dst})')
            if dst != 0 and dst not in all_ids:
                dangling += 1
                if dangling <= 5: print(f'!!! DANGLING DST: {dst} (edge from {src})')
            all_edges.append((kind, src, dst))
    pos = next_off

print(f'\nTotal connections: {len(all_edges)}')
print(f'Unique edges: {len(seen_edges)}')
print(f'Duplicates: {duplicates}, Dangling: {dangling}, Self-refs: {self_refs}')

# Detect cycles via DFS over OO Model->Model edges.
parent_of = {}  # child -> parent (only Model connections to other Models or 0)
for kind, src, dst in all_edges:
    if kind != b'OO': continue
    if src in all_ids and all_ids[src][0] == 'Model':
        if dst == 0 or (dst in all_ids and all_ids[dst][0] == 'Model'):
            if src in parent_of and parent_of[src] != dst:
                print(f'!!! Multiple parents for Model {src}: {parent_of[src]} and {dst}')
            parent_of[src] = dst

# Check for cycles.
def detect_cycle(start):
    seen = set()
    cur = start
    while cur in parent_of:
        if cur in seen: return cur
        seen.add(cur)
        cur = parent_of[cur]
        if cur == 0: break
    return None

cycle_count = 0
for mid in parent_of:
    c = detect_cycle(mid)
    if c is not None:
        cycle_count += 1
        if cycle_count <= 3:
            print(f'!!! CYCLE detected starting at Model {mid}, looping back to {c}')

print(f'\nCycles found: {cycle_count}')
print('OK' if (duplicates == 0 and dangling == 0 and self_refs == 0 and cycle_count == 0) else 'ISSUES FOUND')
