// ========== MESHOPTIMISER SITE: HOW THE AXLE LOOKS ==========
// The studio and the materials of the truck axle, shared by the hero (hero3d.js) and the Features page (features3d.js).
// (the import map in the page head says where 'three' comes from)
import * as THREE from 'three';

// A studio with some contrast: grey walls with a few bright strips and soft boxes, so polished metal has something to catch. Returns the
// environment texture; the caller sets it as scene.environment.
export function studioEnvironment(renderer) {
  const studio = new THREE.Scene();
  studio.add(new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), new THREE.MeshBasicMaterial({ color: 0x45484d, side: THREE.BackSide })));
  const panel = (w, h, at, power, color = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(...at); m.lookAt(0, 0, 0); studio.add(m);
  };
  // (Y is up here: the GLB is Y up)
  panel(54, 16, [-6, 40, -10], 3.8);                 // a soft box overhead
  panel(5, 46, [-42, 6, 6], 5, 0xfff0e0);            // a tall warm strip on the left
  panel(5, 46, [42, 4, -10], 4.5, 0xd4e4ff);         // a tall cool strip on the right
  panel(40, 4, [0, 20, 40], 4);                      // a strip in front, up high
  panel(70, 5, [0, -12, -38], 2.2, 0xe8f0ff);        // a low strip behind
  panel(90, 90, [0, -44, 0], 0.7, 0x8a94a4);         // the floor, a soft glow
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(studio, 0.025).texture;
  pmrem.dispose();
  return texture;
}

// Not everything is polished steel. The app's Steel look (colour #c2c7cd, roughness 0.3, fully metallic) is the base; the parts that do a job
// take the colours the site's function animations use (the palette in site.css and the tiles), so the model and the page are one design:
// gears amber, socket screws the accent blue, brake calipers pink and the seals purple; the big cast housings stay graphite. The rubber of the air springs stays dark.
// Parts are told apart by their names (see `kindOf`).
const mat = (color, roughness, metalness) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
export const PALETTE = { amber: 0xf5a524, teal: 0x35c9c0, accent: 0x0d99ff, pink: 0xf472b6, purple: 0xa78bfa };
export const STEEL = mat(0xbdc3ca, 0.28, 1);
export const MATERIALS = {
  steel: STEEL,
  rubber: mat(0x2a2b2d, 0.5, 0.3),
  seal: mat(PALETTE.purple, 0.5, 0.15),    // the seals (blue in the CAD file)
  brass: mat(PALETTE.amber, 0.3, 0.95),    // gears, pinion shaft and splines
  paint: mat(0x4b5058, 0.46, 0.5),         // cast housings and covers: neutral graphite (the big parts stay quiet, the colours are for the small ones)
  bolt: mat(PALETTE.accent, 0.36, 0.95),   // socket screws: the blue of the site's buttons
  caliper: mat(PALETTE.pink, 0.38, 0.5),   // brake calipers (only the big pieces: the small ones inside stay steel)
};
// `blue` and `dark` come from the colour the part has in the file
export const kindOf = (name, blue, dark) => {
  if (blue) return 'seal';
  if (dark) return 'rubber';
  if (/(^|_)Gear_|Eixo_Motriz|^Spline_/i.test(name)) return 'brass';
  if (/^DIN_(912|6912|908)(?!\d)/i.test(name)) return 'bolt';
  if (/^(Base_do_Diferencial|Tampa_do_Diferencial|Cube_|Final_Drive|Flange_Transfer|Tampa_do_Cilindro|Axle_513B)/i.test(name)) return 'paint';
  if (/^Brake_Calipers/i.test(name)) return 'caliper?';        // painted only if big (decided once the size of the whole model is known)
  return 'steel';
};
// the kind of a mesh of the file, from its name and the colour of its material in the file
export function kindOfMesh(mesh) {
  const c = mesh.material && mesh.material.color;
  const dark = !!c && (c.r + c.g + c.b) / 3 < 0.09;
  const blue = !!c && c.b > 0.4 && c.r < 0.12 && c.g < 0.2;
  return kindOf(mesh.name, blue, dark);
}
// Settles the kinds of a list of { kind, pts } (pts: the eight corners of the part's box where it rests) and returns the material of each.
export function settleKinds(entries) {
  const whole = new THREE.Box3();
  for (const { pts } of entries) for (const q of pts) whole.expandByPoint(q);
  const wholeSize = whole.min.distanceTo(whole.max);
  for (const entry of entries) {
    if (entry.kind === 'caliper?') entry.kind = entry.pts[0].distanceTo(entry.pts[7]) > wholeSize * 0.045 ? 'caliper' : 'steel';
    entry.material = MATERIALS[entry.kind] || STEEL;
  }
}

// A product-photography studio: a dark sweep, one big soft box overhead, two tall strip lights at the sides, a low card in front and a warm bounce
// from the floor. The metal has bright, clean shapes to reflect.
export function productStudio(renderer) {
  const studio = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 p; void main(){ float h = clamp(p.y / 60.0 * 0.5 + 0.5, 0.0, 1.0); vec3 c = mix(vec3(0.05, 0.055, 0.065), vec3(0.2, 0.21, 0.235), smoothstep(0.1, 0.95, h)); gl_FragColor = vec4(c, 1.0); }',
  }));
  studio.add(sky);
  const panel = (w, h, at, power, color = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(...at); m.lookAt(0, 0, 0); studio.add(m);
  };
  panel(70, 34, [0, 46, 6], 4.2);                    // the big soft box overhead
  panel(9, 56, [-44, 8, 14], 5.5, 0xffffff);         // a tall strip on the left
  panel(9, 56, [44, 8, -2], 5, 0xe2ecff);            // a tall strip on the right, a little cool
  panel(60, 5, [0, 4, -46], 3.4, 0xffffff);          // a long strip behind, for the top edges
  panel(46, 8, [0, -4, 46], 1.5, 0xfff0e0);          // a low card in front
  panel(90, 90, [0, -46, 0], 0.9, 0x9a8f84);         // the floor, a warm bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(studio, 0.02).texture;
  pmrem.dispose();
  return tex;
}
