// node tests/facemat.test.mjs: several colours on one part (app/js/facemat.js): the material of each triangle from geometry groups
// and back, colouring picked triangles, tidying the material list, and primitives joined into one part.
import { triMaterials, runs, covers, paint, tidy, census, joined } from '../app/js/facemat.js';

let failed = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) { failed++; console.log('  FAIL  ' + name + (got !== undefined ? '   got: ' + JSON.stringify(got) : '')); } };
const arr = (a) => Array.from(a);

// groups to triangles and back
{
  const g = [{ start: 0, count: 6, materialIndex: 0 }, { start: 6, count: 3, materialIndex: 1 }, { start: 9, count: 6, materialIndex: 0 }];
  const tm = triMaterials(g, 5);
  check('triMaterials: 0 0 1 0 0', arr(tm).join() === '0,0,1,0,0', arr(tm));
  const r = runs(tm);
  check('runs: three runs, in order', r.length === 3 && r[1].start === 6 && r[1].count === 3 && r[1].materialIndex === 1, r);
  check('runs cover the index', covers(r, 15));
  check('no groups: everything is the main material', arr(triMaterials(null, 3)).join() === '0,0,0');
  check('covers: a gap is not covered', !covers([{ start: 0, count: 3, materialIndex: 0 }, { start: 6, count: 3, materialIndex: 1 }], 9));
  check('covers: empty is not covered', !covers([], 9));
}

// colouring picked triangles, then giving them back
{
  const tm = new Uint16Array(6);
  const pick = Uint8Array.from([0, 1, 1, 0, 0, 1]);
  const a = paint(tm, pick, 2);
  check('paint: the picked triangles wear 2', arr(a).join() === '0,2,2,0,0,2', arr(a));
  check('paint leaves the input alone', arr(tm).join() === '0,0,0,0,0,0');
  const t1 = tidy(a, ['main', 'unused', 'red']);
  check('tidy: an unused material goes, the numbers follow', t1.mats.join() === 'main,red' && arr(t1.triMat).join() === '0,1,1,0,0,1', t1);
  const back = paint(t1.triMat, Uint8Array.from([0, 1, 1, 0, 0, 0]), 0);
  const t2 = tidy(back, t1.mats);
  check('given back, the material stays while a triangle wears it', t2.mats.join() === 'main,red' && arr(t2.triMat).join() === '0,0,0,0,0,1', t2);
  const t3 = tidy(paint(t2.triMat, Uint8Array.from([0, 0, 0, 0, 0, 1]), 0), t2.mats);
  check('all given back: only the main material is left', t3.mats.join() === 'main' && arr(t3.triMat).every(x => x === 0), t3);
}

// the same material twice is one
{
  const t = tidy(Uint16Array.from([0, 1, 2, 3]), ['a', 'b', 'a', 'b']);
  check('tidy: duplicates join', t.mats.join() === 'a,b' && arr(t.triMat).join() === '0,1,0,1', t);
  const u = tidy(Uint16Array.from([1, 1, 2]), [{ c: 1 }, { c: 2 }, { c: 2 }], (x, y) => x.c === y.c);
  check('tidy: the main material stays first even when no triangle wears it', u.mats.length === 2 && u.mats[0].c === 1 && arr(u.triMat).join() === '1,1,1', u);
}

// counts
{
  const c = census(Uint16Array.from([1, 0, 1, 1]), 3);
  check('census', c[0].tris === 1 && c[1].tris === 3 && c[1].first === 0 && c[2].tris === 0 && c[2].first === -1, c);
}

// primitives joined
{
  const j = joined([2, 3, 1], [0, 1, 0]);
  check('joined: the meshes in order', arr(j).join() === '0,0,1,1,1,0', arr(j));
  check('joined then runs: three groups', runs(j).length === 3);
}

console.log(failed ? `facemat: ${failed} of ${n} checks FAILED` : `facemat: all ${n} checks pass`);
process.exit(failed ? 1 : 0);
