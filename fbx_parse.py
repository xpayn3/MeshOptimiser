"""Parse my generated FBX with the same logic FBXLoader uses, walk the
whole tree, and report any inconsistencies."""
import struct, sys, os

path = sys.argv[1] if len(sys.argv) > 1 else 'test_out.fbx'
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
with open(path, 'rb') as f:
    data = f.read()

print('file size:', len(data))
print('header bytes [0:23]:', data[0:23])
print('version field [23:27]:', struct.unpack_from('<I', data, 23)[0])

if data[0:21] != b'Kaydara FBX Binary  \x00':
    print('ERROR: header magic mismatch!')
    print('  expected:', b'Kaydara FBX Binary  \x00')
    print('  got:     ', data[0:21])

if data[21:23] != b'\x1A\x00':
    print('ERROR: 0x1A 0x00 sentinel missing')

version = struct.unpack_from('<I', data, 23)[0]
is64 = version >= 7500
sz = 8 if is64 else 4
fmt = '<Q' if is64 else '<I'

def parse_node(off):
    end_off = struct.unpack_from(fmt, data, off)[0]
    if end_off == 0:
        return None, off + (3*sz + 1)
    if end_off < off or end_off > len(data):
        raise ValueError(f'invalid end_off={end_off} at pos {off} (file size {len(data)})')
    num_props = struct.unpack_from(fmt, data, off + sz)[0]
    prop_list_len = struct.unpack_from(fmt, data, off + 2*sz)[0]
    name_len = data[off + 3*sz]
    name = data[off + 3*sz + 1 : off + 3*sz + 1 + name_len].decode('utf-8', 'replace')
    props_start = off + 3*sz + 1 + name_len
    return {'name': name, 'num_props': num_props, 'prop_list_len': prop_list_len,
            'props_start': props_start, 'children_start': props_start + prop_list_len,
            'end_off': end_off}, end_off

def parse_props(start, count):
    pos = start
    for _ in range(count):
        if pos >= len(data):
            raise ValueError(f'prop reading went past EOF at {pos}')
        t = chr(data[pos]); pos += 1
        if t == 'I': pos += 4
        elif t == 'L': pos += 8
        elif t == 'D': pos += 8
        elif t == 'F': pos += 4
        elif t == 'C': pos += 1
        elif t == 'Y': pos += 2
        elif t in ('S', 'R'):
            ln = struct.unpack_from('<I', data, pos)[0]; pos += 4 + ln
        elif t in ('f', 'd', 'l', 'i', 'b'):
            count_a = struct.unpack_from('<I', data, pos)[0]; pos += 4
            enc = struct.unpack_from('<I', data, pos)[0]; pos += 4
            comp_len = struct.unpack_from('<I', data, pos)[0]; pos += 4
            pos += comp_len
        else:
            raise ValueError(f'unknown prop type {t!r} at pos {pos-1}')
    return pos

def walk(off, end, depth):
    pos = off
    while pos < end:
        n, next_off = parse_node(pos)
        if n is None:
            print('  '*depth + f'<NULL terminator at {pos}>')
            return next_off
        actual_props_end = parse_props(n['props_start'], n['num_props'])
        if actual_props_end - n['props_start'] != n['prop_list_len']:
            print('  '*depth + f"WARN {n['name']!r}: prop_list_len declared {n['prop_list_len']} actual {actual_props_end - n['props_start']}")
        print('  '*depth + f"{n['name']!r}  props={n['num_props']}  prop_bytes={n['prop_list_len']}  end={n['end_off']}")
        if n['children_start'] < n['end_off']:
            walk(n['children_start'], n['end_off'], depth+1)
        pos = next_off
    return pos

print('\n--- node tree ---')
end_pos = walk(27, len(data), 0)
print(f'\n--- end of nodes at {end_pos}, file size {len(data)}, footer = {len(data) - end_pos} bytes ---')
