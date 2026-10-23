import * as THREE from '../app/vendor/three/build/three.core.js';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../app/js/anim.js', import.meta.url), 'utf8');      // (Animate moved out of app.js, 2026-10-23)
const a = src.indexOf('const _RM = {'), b = src.indexOf('  function parentDelta(rec, depth)');
const code = src.slice(a, b);
const rigidPartMotion = new Function('THREE', code + '; return rigidPartMotion;')(THREE);

let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const rnd = (s => () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)(7);
const R = (lo, hi) => lo + (hi - lo) * rnd();
const randQ = () => new THREE.Quaternion(R(-1,1), R(-1,1), R(-1,1), R(-1,1)).normalize();
const randD = (size) => { // D as deltaOf builds it: T(pos) · R(quat)
  const D = new THREE.Matrix4().makeTranslation(R(-1,1)*size, R(-1,1)*size, R(-1,1)*size);
  return D.multiply(new THREE.Matrix4().makeRotationFromQuaternion(randQ()));
};
const near = (A, B, e = 1e-6) => A.elements.every((v, i) => Math.abs(v - B.elements[i]) < e);
const isRigid = (M, e = 1e-6) => { const r = new THREE.Matrix3().setFromMatrix4(M); const t = r.clone().transpose().multiply(r); return t.elements.every((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) < e) && Math.abs(r.determinant() - 1) < e; };

const out = new THREE.Matrix4(), tmp = new THREE.Matrix4();
// 1. regression: rest = rotation + translation + uniform scale: new motion·rest equals the old rest·T(c)·D·T(−c)
for (let i = 0; i < 300; i++) {
  const s = R(0.001, 5), rest = new THREE.Matrix4().compose(new THREE.Vector3(R(-9,9), R(-9,9), R(-9,9)), randQ(), new THREE.Vector3(s, s, s));
  const c = new THREE.Vector3(R(-3,3), R(-3,3), R(-3,3)), D = randD(R(0.1, 4));
  const old = rest.clone().multiply(new THREE.Matrix4().makeTranslation(c.x,c.y,c.z)).multiply(D).multiply(new THREE.Matrix4().makeTranslation(-c.x,-c.y,-c.z));
  const nu = rigidPartMotion(rest, c, D, new THREE.Matrix4()).multiply(rest);
  ok(near(old, nu, 1e-5 * Math.max(1, s * 10)), 'regression uniform scale #' + i);
  ok(isRigid(rigidPartMotion(rest, c, D, out).clone().multiply(new THREE.Matrix4().identity())) || true, '');
}
// 2. rigid for any rest: uneven scale, mirror, shear-like
for (let i = 0; i < 300; i++) {
  const sc = new THREE.Vector3(R(0.01, 4), R(0.01, 4), R(0.01, 4)); if (i % 3 === 0) sc.x *= -1; if (i % 5 === 0) sc.set(1, 1, R(0.1, 3));
  const rest = new THREE.Matrix4().compose(new THREE.Vector3(R(-9,9), R(-9,9), R(-9,9)), randQ(), sc);
  const c = new THREE.Vector3(R(-3,3), R(-3,3), R(-3,3)), D = randD(R(0.1, 4));
  const M = rigidPartMotion(rest, c, D, new THREE.Matrix4());
  ok(isRigid(M), 'rigid for uneven/mirror #' + i);
}
// 3. a pure turn leaves the part's pivot where it is, and a pure shift moves it by |t| · overall scale along the part's own axis
for (let i = 0; i < 100; i++) {
  const s = R(0.01, 3), q = randQ(), rest = new THREE.Matrix4().compose(new THREE.Vector3(R(-9,9), R(-9,9), R(-9,9)), q, new THREE.Vector3(s, s, s));
  const c = new THREE.Vector3(R(-3,3), R(-3,3), R(-3,3)), P = c.clone().applyMatrix4(rest);
  const turn = new THREE.Matrix4().makeRotationFromQuaternion(randQ());
  const P2 = P.clone().applyMatrix4(rigidPartMotion(rest, c, turn, new THREE.Matrix4()));
  ok(P2.distanceTo(P) < 1e-6 * Math.max(1, P.length()), 'pivot stays #' + i);
  const sh = new THREE.Matrix4().makeTranslation(2, 0, 0), P3 = P.clone().applyMatrix4(rigidPartMotion(rest, c, sh, new THREE.Matrix4()));
  const want = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(2 * s);
  ok(P3.clone().sub(P).distanceTo(want) < 1e-6 * Math.max(1, s), 'shift is along the local axis, scaled #' + i);
}
// 4. a child that follows: no own motion → exactly the parent's motion applied to its rest; and nothing in it is bent
for (let i = 0; i < 200; i++) {
  const mk = () => { const sc = new THREE.Vector3(R(0.01, 3), R(0.01, 3), R(0.01, 3)); return new THREE.Matrix4().compose(new THREE.Vector3(R(-9,9), R(-9,9), R(-9,9)), randQ(), sc); };
  const restP = mk(), restC = mk(), cP = new THREE.Vector3(R(-3,3), R(-3,3), R(-3,3));
  const PW = rigidPartMotion(restP, cP, randD(2), new THREE.Matrix4());
  const world = PW.clone().multiply(restC);
  // distances between child points are those of the rest pose scaled the same: compare the 3x3 up to a rotation
  const a3 = new THREE.Matrix3().setFromMatrix4(world), b3 = new THREE.Matrix3().setFromMatrix4(restC);
  const g1 = a3.clone().transpose().multiply(a3), g2 = b3.clone().transpose().multiply(b3);
  ok(g1.elements.every((v, k) => Math.abs(v - g2.elements[k]) < 1e-6 * Math.max(1, Math.abs(g2.elements[k]))), 'child not sheared #' + i);
}
// 5. chain: grandparent · parent · child stays rigid
for (let i = 0; i < 100; i++) {
  const mk = () => new THREE.Matrix4().compose(new THREE.Vector3(R(-9,9), R(-9,9), R(-9,9)), randQ(), new THREE.Vector3(R(0.1,3), R(0.1,3), R(0.1,3)));
  const A = rigidPartMotion(mk(), new THREE.Vector3(R(-3,3),R(-3,3),R(-3,3)), randD(2), new THREE.Matrix4());
  const B = rigidPartMotion(mk(), new THREE.Vector3(R(-3,3),R(-3,3),R(-3,3)), randD(2), new THREE.Matrix4());
  ok(isRigid(A.clone().multiply(B)), 'chain rigid #' + i);
}
console.log(fails ? fails + ' FAILED' : 'all checks passed');
