// An object with objects under it (Cinema 4D's way) becomes a group holding the object and its children, and nothing moves.
// Reads _wrapMeshParents out of app/js/app.js and runs it on a three.js scene.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..', 'app');
const THREE = await import(pathToFileURL(path.join(app, 'vendor', 'three', 'build', 'three.core.js')).href);
const src = fs.readFileSync(path.join(app, 'js', 'app.js'), 'utf8');
const a = src.indexOf('function _wrapMeshParents'), b = src.indexOf('function _toSceneConvention');
if (a < 0 || b < 0) throw new Error('_wrapMeshParents not found in app.js');
const wrap = new Function('THREE', src.slice(a, b) + '\nreturn _wrapMeshParents;')(THREE);

const mk = (n, x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); m.name = n; m.position.set(x, 0, 0); return m; };
const root = new THREE.Group();
const A = mk('A', 5), B = mk('B', 2), C = mk('C', 1);
A.rotation.z = 0.5; A.scale.set(2, 2, 2);
A.add(B); B.add(C);
root.add(mk('S', -3), A);
root.updateMatrixWorld(true);
const before = new Map(); root.traverse(o => { if (o.isMesh) before.set(o.name, o.getWorldPosition(new THREE.Vector3()).toArray()); });

const n = wrap(root);
root.updateMatrixWorld(true);
const fail = [];
if (n !== 2) fail.push('wrapped ' + n + ', expected 2 (A and B)');
root.traverse(o => { if (o.isMesh) { const w = o.getWorldPosition(new THREE.Vector3()).toArray(), e = before.get(o.name); if (w.some((v, i) => Math.abs(v - e[i]) > 1e-9)) fail.push(o.name + ' moved'); } });
if (root.children.map(c => c.name + (c.isMesh ? ':mesh' : ':group')).join() !== 'S:mesh,A:group') fail.push('order or kinds of the top level changed');
if (A.parent.children[0] !== A || A.position.length() !== 0) fail.push('the object is not first in its group at the group\'s origin');
if (wrap(root) !== 0) fail.push('a second pass wrapped something again');
if (fail.length) { console.error('FAIL\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('PASS wrap-mesh-parents');
