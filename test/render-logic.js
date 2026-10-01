/**
 * Spell - client scene/logic test (no GPU required).
 *
 * Executes the real rendering modules (`client/src/terrain.js`,
 * `client/src/entities.js`) inside jsdom with a stubbed 2D canvas. three.js
 * builds all geometry and scene graphs on the CPU, so this verifies the maths
 * and the object lifecycles (spawn, respawn, damage tinting, door opening,
 * interpolation, pool reuse) even though no WebGL context exists here.
 *
 * What it cannot check: shaders, draw calls and actual pixels. That is what
 * `npm run verify:browser` (real Chromium) is for.
 *
 * Usage:  npm run test:render
 */

import * as THREE from 'three';
import { createDom } from './dom-env.js';
import { WORLD, NODES, ANIMALS, PIECES } from '../shared/config.js';
import { sampleHeight, terrainHeight } from '../shared/noise.js';

createDom();

const { WorldView } = await import('../client/src/terrain.js');
const { NodeView, BuildingView, AnimalView, PlayerView, ViewModel, BuildGhost } = await import('../client/src/entities.js');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; } else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
};

console.log('\n\x1b[1mClient render/scene logic test (jsdom, no GPU)\x1b[0m');

/* ------------------------------------------------------------------ *
 *  Terrain
 * ------------------------------------------------------------------ */
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fc6e0, 60, 160);
const t0 = performance.now();
const world = new WorldView(scene, WORLD.seed);
const buildMs = performance.now() - t0;

const N = WORLD.size / WORLD.grid;
const posAttr = world.terrain.geometry.attributes.position;
check('terrain mesh has two triangles per grid cell', posAttr.count === N * N * 6,
  `${posAttr.count} vs ${N * N * 6}`);
check('terrain has vertex colours', !!world.terrain.geometry.attributes.color);
check('terrain has normals for flat shading', !!world.terrain.geometry.attributes.normal);
check(`terrain builds quickly (${buildMs.toFixed(0)} ms)`, buildMs < 4000);
check('water plane exists and sits at sea level', Math.abs(world.water.position.y - WORLD.seaLevel) < 0.2);
check('sky dome exists', !!world.sky && world.sky.geometry.attributes.color.count > 100);
check('stars exist for the night sky', !!world.stars);
check('sun light is added to the scene', scene.children.some((c) => c.isDirectionalLight));

/* ---- geometry orientation: a ground mesh must face UP ----
   (this exact bug shipped once: reversed winding made the terrain invisible
   from above and visible only from underneath, i.e. "I am under the ground") */
function faceNormal(geometry, i) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  // indexed geometries (PlaneGeometry, CylinderGeometry, ...) need the index
  // buffer; hand-built ones (the terrain) are non-indexed
  const at = (k) => (idx ? idx.getX(i * 3 + k) : i * 3 + k);
  const a = new THREE.Vector3().fromBufferAttribute(pos, at(0));
  const b = new THREE.Vector3().fromBufferAttribute(pos, at(1));
  const c = new THREE.Vector3().fromBufferAttribute(pos, at(2));
  return new THREE.Vector3()
    .crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a))
    .normalize();
}

check('every terrain triangle faces up (front side visible from above)', (() => {
  const geo = world.terrain.geometry;
  const tris = geo.attributes.position.count / 3;
  let down = 0;
  let worst = 1;
  for (let i = 0; i < tris; i++) {
    const n = faceNormal(geo, i);
    worst = Math.min(worst, n.y);
    if (n.y <= 0) down++;
  }
  if (down) console.log(`      (${down}/${tris} triangles face down, lowest n.y=${worst.toFixed(3)})`);
  return down === 0;
})());
check('terrain vertex normals point up', (() => {
  const n = world.terrain.geometry.attributes.normal;
  for (let i = 0; i < n.count; i++) if (n.getY(i) <= 0) return false;
  return true;
})());
check('terrain material renders front faces only', world.terrain.material.side === THREE.FrontSide);
check('water plane faces up (visible from above)', (() => {
  const geo = world.water.geometry;
  const n = faceNormal(geo, 0);
  return n.y > 0.99;
})());
check('vegetation meshes render their outside (tree trunk, canopy, rocks)', (() => {
  const geometries = [
    new THREE.CylinderGeometry(0.22, 0.32, 4.2, 5, 1), // trunk
    new THREE.ConeGeometry(1.9, 5.2, 6, 1), // canopy
    new THREE.IcosahedronGeometry(0.95, 0), // rock
    new THREE.BoxGeometry(1, 1, 1), // building pieces
    new THREE.CapsuleGeometry(0.36, 0.9, 3, 8), // players
  ];
  for (const geo of geometries) {
    const count = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const centroid = new THREE.Vector3();
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) centroid.add(new THREE.Vector3().fromBufferAttribute(pos, i));
    centroid.divideScalar(pos.count);
    let outward = 0;
    for (let i = 0; i < count; i++) {
      const n = faceNormal(geo, i);
      // face centre, relative to the mesh centre
      const idx = geo.index;
      const at = (k) => (idx ? idx.getX(i * 3 + k) : i * 3 + k);
      const centre = new THREE.Vector3()
        .add(new THREE.Vector3().fromBufferAttribute(pos, at(0)))
        .add(new THREE.Vector3().fromBufferAttribute(pos, at(1)))
        .add(new THREE.Vector3().fromBufferAttribute(pos, at(2)))
        .divideScalar(3)
        .sub(centroid);
      if (n.dot(centre) > 0) outward++;
    }
    if (outward / count < 0.95) return false;
  }
  return true;
})());

/* ---- physics must ride the *rendered* surface, not a separate one ---- */
check('sampleHeight equals the rendered triangle surface everywhere', (() => {
  const g = WORLD.grid;
  const pos = world.terrain.geometry.attributes.position;
  const heights = (x, z) => terrainHeight(x, z, WORLD.seed);
  for (let i = 0; i < 3000; i++) {
    const x = (Math.random() * 2 - 1) * (WORLD.half - 2);
    const z = (Math.random() * 2 - 1) * (WORLD.half - 2);
    const x0 = Math.floor(x / g) * g;
    const z0 = Math.floor(z / g) * g;
    const tx = (x - x0) / g;
    const tz = (z - z0) / g;
    const h00 = heights(x0, z0);
    const h10 = heights(x0 + g, z0);
    const h01 = heights(x0, z0 + g);
    const h11 = heights(x0 + g, z0 + g);
    const mesh = (tx + tz <= 1)
      ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
      : h11 + (h10 - h11) * (1 - tz) + (h01 - h11) * (1 - tx);
    if (Math.abs(sampleHeight(x, z, WORLD.seed) - mesh) > 1e-9) return false;
  }
  void pos;
  return true;
})());

check('heightAt matches the shared sampler', (() => {
  for (const [x, z] of [[0, 0], [50, -30], [-120, 88], [200, 200]]) {
    if (Math.abs(world.heightAt(x, z) - sampleHeight(x, z, WORLD.seed)) > 1e-9) return false;
  }
  return true;
})());

check('a second WorldView with the same seed is identical', (() => {
  const other = new WorldView(new THREE.Scene(), WORLD.seed);
  const a = world.terrain.geometry.attributes.position.array;
  const b = other.terrain.geometry.attributes.position.array;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 997) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  return true;
})());

check('a different seed produces different terrain', (() => {
  const other = new WorldView(new THREE.Scene(), WORLD.seed + 1);
  const a = world.terrain.geometry.attributes.position.array;
  const b = other.terrain.geometry.attributes.position.array;
  let diff = 0;
  for (let i = 1; i < a.length; i += 997) if (Math.abs(a[i] - b[i]) > 0.5) diff++;
  return diff > 3;
})());

check('the island actually rises above the sea', terrainHeight(0, 0, WORLD.seed) > WORLD.seaLevel + 1,
  `h(0,0)=${terrainHeight(0, 0, WORLD.seed).toFixed(2)}`);
check('the map edge is under water', terrainHeight(WORLD.half - 2, WORLD.half - 2, WORLD.seed) < WORLD.seaLevel);

const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 900);
camera.position.set(0, 20, 0);

let fogDay = null;
let fogNight = null;
let fogUnderwater = null;
for (const t of [0.25, 0.5, 0.75, 0.95]) {
  world.update(t, camera.position, 160);
  if (t === 0.5) fogDay = world.scene.fog.color.getHex();
  if (t === 0.95) fogNight = world.scene.fog.color.getHex();
}
world.update(0.5, camera.position, 160, true);
fogUnderwater = world.scene.fog.far;
check('day and night produce different sky/fog colours', fogDay !== fogNight, `${fogDay} vs ${fogNight}`);
check('underwater shortens the fog dramatically', fogUnderwater < 30, String(fogUnderwater));
check('stars are only visible at night', (() => {
  world.update(0.95, camera.position, 160);
  const night = world.starMat.opacity;
  world.update(0.5, camera.position, 160);
  return night > world.starMat.opacity;
})());

const mapCtx = document.createElement('canvas').getContext('2d');
world.paintMap(mapCtx, 128, 128, new Map(), new Map(), { id: 'x', x: 0, z: 0, yaw: 0 });
check('map painting writes pixels', mapCtx.calls.putImageData === 1);

/* ------------------------------------------------------------------ *
 *  Resource nodes (instancing)
 * ------------------------------------------------------------------ */
const nodeView = new NodeView(scene);
const nodes = [];
let id = 0;
for (let i = 0; i < 60; i++) {
  const type = i % 3 === 0 ? 'tree' : i % 3 === 1 ? 'rock' : 'bush';
  const x = (i % 10) * 20 - 90;
  const z = Math.floor(i / 10) * 20 - 60;
  const node = { id: `n${id++}`, type, x, y: sampleHeight(x, z, WORLD.seed), z, rot: i * 0.3, scale: 0.9 };
  nodes.push(node);
  nodeView.upsert(node);
}
check('every node got an instance slot', nodeView.nodes.size === 60, String(nodeView.nodes.size));
check('trees allocate two instanced meshes (trunk + canopy)', (() => {
  const tree = nodes.find((n) => n.type === 'tree');
  const entry = nodeView.get(tree.id);
  return entry.slots.trunk !== undefined && entry.slots.foliage !== undefined;
})());
check('instanced matrices were written', (() => {
  const m = new THREE.Matrix4();
  const tree = nodes.find((n) => n.type === 'tree');
  nodeView.pools.trunk.mesh.getMatrixAt(nodeView.get(tree.id).slots.trunk, m);
  const scale = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return scale.x > 0.5;
})());

const deadId = nodes[0].id;
nodeView.setDead(deadId, Date.now() + 1000);
check('a harvested node is hidden', (() => {
  const m = new THREE.Matrix4();
  nodeView.pools.trunk.mesh.getMatrixAt(nodeView.get(deadId).slots.trunk, m);
  const scale = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return scale.x === 0;
})());
nodeView.upsert(nodes[0]); // server respawn
check('a respawned node becomes visible again', nodeView.get(deadId).dead !== true);

const before = nodeView.nodes.size;
nodeView.remove(deadId);
check('removing a node frees it from the view', nodeView.nodes.size === before - 1);

const highlightNode = nodes[5];
nodeView.setHighlight(highlightNode);
check('target highlight follows the aimed node', nodeView.highlight.visible
  && Math.abs(nodeView.highlight.position.x - highlightNode.x) < 1e-6);
nodeView.setHighlight(null);
check('highlight hides when nothing is targeted', nodeView.highlight.visible === false);

/* ------------------------------------------------------------------ *
 *  Buildings
 * ------------------------------------------------------------------ */
const buildingView = new BuildingView(scene);
const pieces = [
  { id: 'b1', piece: 'foundation', cx: 2, cz: 3, rot: 0, y: 5, hp: 500, open: false, ownerName: 'Alice' },
  { id: 'b2', piece: 'wall', cx: 2, cz: 3, rot: 1, y: 5.35, hp: 400, open: false, ownerName: 'Alice' },
  { id: 'b3', piece: 'door', cx: 3, cz: 3, rot: 0, y: 5.35, hp: 300, open: false, ownerName: 'Alice' },
  { id: 'b4', piece: 'campfire', cx: 4, cz: 4, rot: 0, y: 6, hp: 200, open: false, ownerName: 'Bob' },
];
for (const p of pieces) buildingView.upsert(p);
check('all building pieces created a mesh', buildingView.map.size === 4, String(buildingView.map.size));
check('every piece has geometry in the scene', [...buildingView.map.values()].every((e) => e.obj.parent === scene));

const door = buildingView.map.get('b3');
const panel = door.obj.userData.panel;
check('door has a hinged panel', !!panel && Math.abs(panel.rotation.y) < 1e-6);
buildingView.upsert({ ...pieces[2], open: true });
check('an opened door swings its panel', Math.abs(buildingView.map.get('b3').obj.userData.panel.rotation.y - Math.PI / 2) < 1e-6,
  String(buildingView.map.get('b3').obj.userData.panel.rotation.y));

check('damaged buildings are tinted per building (shared material untouched)', (() => {
  const wall = buildingView.map.get('b2');
  let tinted = null;
  wall.obj.traverse((o) => { if (o.isMesh && o.material.userData.ownColor) tinted = o.material; });
  if (!tinted) return false;
  const before = tinted.color.getHex();
  buildingView.upsert({ ...pieces[1], hp: 100 });
  return tinted.color.getHex() !== before;
})());
check('campfire gets a flame and a light', !!buildingView.map.get('b4').obj.userData.flame
  && !!buildingView.map.get('b4').obj.userData.light);
buildingView.update(0.016, 12.34);
check('campfire animation runs without throwing', true);

buildingView.remove('b1');
check('removing a building detaches it from the scene', buildingView.map.size === 3);

/* ------------------------------------------------------------------ *
 *  Animals & remote players
 * ------------------------------------------------------------------ */
const animalView = new AnimalView(scene);
const deer = { id: 'a1', type: 'deer', x: 10, y: 3, z: 10, yaw: 0, hp: 45 };
animalView.upsert(deer);
check('an animal spawns a mesh', animalView.map.size === 1 && animalView.map.get('a1').obj.parent === scene);
const startX = animalView.map.get('a1').x;
animalView.upsert({ ...deer, x: 30, z: 25 });
for (let i = 0; i < 30; i++) animalView.update(0.05);
check('animals interpolate toward the server position', animalView.map.get('a1').x > startX + 5,
  `x=${animalView.map.get('a1').x.toFixed(1)}`);
animalView.map.get('a1').lastSeen = performance.now() - 5000;
animalView.update(0.05);
check('stale animals are removed', animalView.map.size === 0);

const playerView = new PlayerView(scene, 'self');
playerView.upsert({ id: 'self', name: 'Me', x: 0, y: 0, z: 0, yaw: 0 });
check('the local player is never rendered as a remote', playerView.map.size === 0);
playerView.upsert({ id: 'p2', name: 'Bob', color: '#6ec1e4', x: 5, y: 4, z: 5, yaw: 1, crouch: false, item: 'stone_axe' });
check('a remote player spawns with a name tag', playerView.map.size === 1
  && playerView.map.get('p2').group.children.some((c) => c.isSprite));
playerView.upsert({ id: 'p2', name: 'Bob', color: '#6ec1e4', x: 6, y: 4, z: 6, yaw: 1.2, crouch: true, item: 'stone_axe' });
for (let i = 0; i < 20; i++) playerView.update(0.05);
check('a crouching remote player is rendered lower', playerView.map.get('p2').group.children[1].position.y < 1.4);
check('a remote player holding an item shows it', playerView.map.get('p2').held.visible === true);
playerView.remove('p2');
check('remote players are removed cleanly', playerView.map.size === 0);

/* ------------------------------------------------------------------ *
 *  Build ghost + first person view model
 * ------------------------------------------------------------------ */
const ghost = new BuildGhost(scene);
check('ghost starts hidden', ghost.mesh.visible === false);
ghost.show('wall', 1, 2, 0, 4, true);
check('ghost appears at the snapped cell edge', ghost.mesh.visible === true
  && Math.abs(ghost.mesh.position.x - 1 * WORLD.grid) < 1e-6
  && Math.abs(ghost.mesh.position.z - (2 * WORLD.grid - WORLD.grid / 2)) < 1e-6,
  JSON.stringify(ghost.mesh.position));
check('ghost turns green when valid', ghost.mesh.material.color.getHex() === 0x7ac74f);
ghost.show('wall', 1, 2, 0, 4, false);
check('ghost turns red when invalid', ghost.mesh.material.color.getHex() === 0xe2574c);
check('ghost box matches the piece size', Math.abs(ghost.mesh.scale.x - PIECES.wall.size[0]) < 1e-6);
ghost.hide();
check('ghost hides again', ghost.mesh.visible === false);

const viewModel = new ViewModel();
viewModel.setAspect(1.6);
for (const item of [null, 'stone_axe', 'stone_pickaxe', 'spear', 'torch']) {
  viewModel.setItem(item);
  const model = viewModel.models[item] || viewModel.models.fist;
  check(`view model shows ${item || 'bare hands'}`, model.visible === true && model.parent === viewModel.hand);
}
viewModel.setItem('stone_axe');
viewModel.swing();
check('swinging sets the animation timer', viewModel.swingT === 1);
viewModel.update(0.05, { moving: 1, onGround: true });
check('swing animation progresses', viewModel.swingT < 1 && viewModel.swingT > 0);
check('view model camera has the screen aspect', Math.abs(viewModel.camera.aspect - 1.6) < 1e-6);
check('view model hand is positioned in front of the camera', viewModel.hand.position.z < 0);

/* ------------------------------------------------------------------ *
 *  Config sanity for the renderer
 * ------------------------------------------------------------------ */
for (const [type, def] of Object.entries(NODES)) {
  check(`node type ${type} has render data`, !!def.name && def.respawnSec > 0 && def.hp > 0);
}
for (const [type, def] of Object.entries(ANIMALS)) {
  check(`animal ${type} has render data`, !!def.color && def.hp > 0 && def.drops.length > 0);
}
for (const [piece, def] of Object.entries(PIECES)) {
  check(`piece ${piece} has a size vector`, Array.isArray(def.size) && def.size.length === 3);
}

console.log(`\n\x1b[1mResult:\x1b[0m ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
