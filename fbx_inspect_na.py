"""Inspect first NodeAttribute block + its connections in Blender's output."""
import struct, sys

with open(r'C:\Users\Luka\Downloads\blender_convert.fbx', 'rb') as f: data = f.read()
ver = struct.unpack_from('<I', data, 23)[0]
sz = 8 if ver >= 7500 else 4
fmt = '<Q' if sz==8 else '<I'

def parse_node(off):
    e = struct.unpack_from(fmt, data, off)[0]
    if e == 0: return None, off + (3*sz + 1)
    np = struct.unpack_from(fmt, data, off + sz)[0]
    pl = struct.unpack_from(fmt, data, off + 2*sz)[0]
    nl = data[off + 3*sz]
    return {'name':data[off+3*sz+1:off+3*sz+1+nl].decode('utf-8','replace'),
            'np':np,'pl':pl,'ps':off+3*sz+1+nl,'cs':off+3*sz+1+nl+pl,'end':e}, e

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
            out.append((t, f'arr(n={ca},e={enc})')); pos += cl
    return out

def dump(off, end, depth):
    pos = off
    while pos < end:
        n, nxt = parse_node(pos)
        if n is None: break
        ps = parse_props(n['ps'], n['np'])
        ss = []
        for t, v in ps:
            if isinstance(v, bytes):
                ss.append(f"{t}:{v[:60]!r}")
            else: ss.append(f"{t}:{v}")
        print('  '*depth + f"{n['name']!r} [{', '.join(ss)}]")
        if n['cs'] < n['end'] - (3*sz+1):
            dump(n['cs'], n['end']-(3*sz+1), depth+1)
        pos = nxt

# Find first 3 NodeAttribute objects.
pos = 27
na_ids = set()
while pos < len(data):
    n, nxt = parse_node(pos)
    if n is None: break
    if n['name'] == 'Objects':
        cp = n['cs']; cnt = 0
        while cp < n['end']:
            cn, cnxt = parse_node(cp)
            if cn is None: break
            if cn['name'] == 'NodeAttribute':
                ps = parse_props(cn['ps'], cn['np'])
                if cnt < 3:
                    print(f'\n=== NodeAttribute #{cnt} ===')
                    for t,v in ps:
                        if isinstance(v, bytes):
                            print(f'  prop: {t}:{v[:80]!r}')
                        else:
                            print(f'  prop: {t}:{v}')
                    if cn['cs'] < cn['end']-(3*sz+1):
                        dump(cn['cs'], cn['end']-(3*sz+1), 1)
                if ps and ps[0][0] == 'L': na_ids.add(ps[0][1])
                cnt += 1
            cp = cnxt
    elif n['name'] == 'Connections':
        # Find first 5 NodeAttribute → Model connections
        cp = n['cs']; cnt = 0
        print('\n=== First 5 NodeAttribute → Model connections ===')
        while cp < n['end'] and cnt < 5:
            cn, cnxt = parse_node(cp)
            if cn is None: break
            if cn['name'] == 'C':
                ps = parse_props(cn['ps'], cn['np'])
                if len(ps) == 3 and ps[0] == ('S', b'OO') and ps[1][0] == 'L' and ps[1][1] in na_ids:
                    print(f'  C: {ps}')
                    cnt += 1
            cp = cnxt
    pos = nxt

# Count NodeAttribute types.
print(f'\nTotal unique NodeAttribute IDs: {len(na_ids)}')
