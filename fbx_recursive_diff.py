"""Recursively diff two FBX files' node trees to find structural differences."""
import struct, sys

def parse(path):
    with open(path, 'rb') as f: data = f.read()
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
            elif t == 'F': out.append(('F', struct.unpack_from('<f', data, pos)[0])); pos += 4
            elif t == 'Y': out.append(('Y', struct.unpack_from('<h', data, pos)[0])); pos += 2
            elif t in ('S','R'):
                ln = struct.unpack_from('<I', data, pos)[0]; pos += 4
                out.append((t, data[pos:pos+ln])); pos += ln
            elif t in 'fdli':
                ca = struct.unpack_from('<I', data, pos)[0]; pos += 4
                enc = struct.unpack_from('<I', data, pos)[0]; pos += 4
                cl = struct.unpack_from('<I', data, pos)[0]; pos += 4
                out.append((t, f'arr(n={ca},e={enc})')); pos += cl
        return out

    def build_tree(off, end):
        # Returns list of {name, props, children}.
        result = []
        pos = off
        while pos < end:
            n, nxt = parse_node(pos)
            if n is None: break
            children = build_tree(n['cs'], n['end'] - (3*sz+1))
            ps = parse_props(n['ps'], n['np'])
            result.append({'name':n['name'],'props':ps,'children':children})
            pos = nxt
        return result

    return build_tree(27, len(data))

def short(p):
    t, v = p
    if isinstance(v, bytes):
        return f"{t}:{v[:25]!r}"
    return f"{t}:{v}"

def diff_trees(a, b, path='', limit=[40]):
    if limit[0] <= 0: return
    # Match by node name, first occurrence on each side.
    # Collect names + counts at this level.
    def by_name(t):
        d = {}
        for n in t:
            d.setdefault(n['name'], []).append(n)
        return d
    da, db = by_name(a), by_name(b)
    for name in sorted(set(da) | set(db)):
        if limit[0] <= 0: return
        la, lb = da.get(name, []), db.get(name, [])
        if len(la) != len(lb):
            print(f'  COUNT  {path}/{name}: A={len(la)} B={len(lb)}')
            limit[0] -= 1
        # Compare first instance (sample).
        if la and lb:
            a0, b0 = la[0], lb[0]
            pa = [short(p) for p in a0['props']]
            pb = [short(p) for p in b0['props']]
            if pa != pb:
                print(f'  PROPS  {path}/{name}:')
                print(f'    A: {pa}')
                print(f'    B: {pb}')
                limit[0] -= 1
            diff_trees(a0['children'], b0['children'], path + '/' + name, limit)

a = parse(sys.argv[1])
b = parse(sys.argv[2])
print(f'A = {sys.argv[1]}')
print(f'B = {sys.argv[2]}')
print()
diff_trees(a, b)
