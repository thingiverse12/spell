/**
 * Spell - all 3D entities that are not terrain: resource nodes (instanced),
 * buildings, animals, remote players and the first-person view model.
 *
 * Everything here is driven by server snapshots - the client never invents
 * world state, it only renders it (plus local prediction for its own player).
 */

import * as THREE from 'three';
import { sampleHeight } from '../../shared/noise.js';
import { liftToSurface } from '../../shared/ground.js';
import { NODES, PIECES, ANIMALS, ITEMS, WORLD, piecePosition, buildingAABB } from '../../shared/config.js';

const SHARED = {
  trunk: new THREE.CylinderGeometry(0.22, 0.32, 4.2, 5, 1),
  foliage: new THREE.ConeGeometry(1.9, 5.2, 6, 1),
  rock: new THREE.IcosahedronGeometry(0.95, 0),
  bush: new THREE.IcosahedronGeometry(0.75, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  capsule: new THREE.CapsuleGeometry(0.36, 0.9, 3, 8),
  head: new THREE.SphereGeometry(0.24, 8, 6),
};

const MATS = {
  trunk: new THREE.MeshLambertMaterial({ color: 0x6b4a2a, flatShading: true }),
  foliage: new THREE.MeshLambertMaterial({ color: 0x2f6b33, flatShading: true }),
  rock: new THREE.MeshLambertMaterial({ color: 0x8d9099, flatShading: true }),
  bush: new THREE.MeshLambertMaterial({ color: 0x3d7a34, flatShading: true }),
  wood: new THREE.MeshLambertMaterial({ color: 0x9a6b3c, flatShading: true }),
  woodDark: new THREE.MeshLambertMaterial({ color: 0x7a5230, flatShading: true }),
  stone: new THREE.MeshLambertMaterial({ color: 0x9aa0a6, flatShading: true }),
  animal: new THREE.MeshLambertMaterial({ color: 0xa9793f, flatShading: true }),
  animalDark: new THREE.MeshLambertMaterial({ color: 0x5d4a3a, flatShading: true }),
  metal: new THREE.MeshLambertMaterial({ color: 0xb9c2c9, flatShading: true }),
};

/* ------------------------------------------------------------------ *
 *  Resource nodes (InstancedMesh pools)
 * ------------------------------------------------------------------ */

class InstancePool {
  constructor(mesh, capacity, scene) {
    this.mesh = mesh;
    this.capacity = capacity;
    this.free = [];
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = capacity;
    this.mesh.frustumCulled = false;
    this._m = new THREE.Matrix4();
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    scene.add(mesh);
  }

  alloc() { return this.free.pop() ?? -1; }
  freeSlot(i) { if (i >= 0) { this.mesh.setMatrixAt(i, this._hidden); this.mesh.instanceMatrix.needsUpdate = true; this.free.push(i); } }
  hide(i) { if (i >= 0) { this.mesh.setMatrixAt(i, this._hidden); this.mesh.instanceMatrix.needsUpdate = true; } }

  set(i, x, y, z, sx, sy, sz, rotY, color) {
    this._m.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
      new THREE.Vector3(sx, sy, sz),
    );
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (color && this.mesh.instanceColor !== null) {
      this.mesh.setColorAt(i, color);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

export class NodeView {
  constructor(scene) {
    this.scene = scene;
    this.nodes = new Map(); // id -> {type, slots:{trunk,foliage,...}, x,y,z,scale,rot,dead}
    this.pools = {
      trunk: new InstancePool(new THREE.InstancedMesh(SHARED.trunk, MATS.trunk, 900), 900, scene),
      foliage: new InstancePool(new THREE.InstancedMesh(SHARED.foliage, MATS.foliage, 900), 900, scene),
      rock: new InstancePool(new THREE.InstancedMesh(SHARED.rock, MATS.rock, 900), 900, scene),
      bush: new InstancePool(new THREE.InstancedMesh(SHARED.bush, MATS.bush, 900), 900, scene),
    };
    for (const pool of Object.values(this.pools)) {
      pool.mesh.castShadow = true;
      pool.mesh.receiveShadow = true;
    }
    this.highlight = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.4, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }),
    );
    this.highlight.visible = false;
    scene.add(this.highlight);
  }

  upsert(n) {
    const existing = this.nodes.get(n.id);
    if (existing) {
      Object.assign(existing, n);
      if (existing.dead) delete existing.dead; // respawned -> make visible again
      this._place(existing);
      return;
    }
    this._place(this._create(n));
  }

  _create(n) {
    const entry = { ...n, slots: {}, dead: false };
    if (n.type === 'tree') {
      entry.slots.trunk = this.pools.trunk.alloc();
      entry.slots.foliage = this.pools.foliage.alloc();
    } else {
      entry.slots[n.type] = this.pools[n.type].alloc();
    }
    this.nodes.set(n.id, entry);
    return entry;
  }

  _place(entry) {
    const s = entry.scale || 1;
    entry.dead = false;
    if (entry.type === 'tree') {
      const h = NODES.tree.height * s * 0.6;
      this.pools.trunk.set(entry.slots.trunk, entry.x, entry.y + h * 0.5, entry.z, s, s, s, entry.rot, null);
      this.pools.foliage.set(entry.slots.foliage, entry.x, entry.y + h + 2.2 * s, entry.z, s, s, s, entry.rot, null);
    } else if (entry.type === 'rock') {
      this.pools.rock.set(entry.slots.rock, entry.x, entry.y + 0.55 * s, entry.z, s, s * 0.85, s, entry.rot, null);
    } else {
      this.pools.bush.set(entry.slots.bush, entry.x, entry.y + 0.5 * s, entry.z, s, s * 0.85, s, entry.rot, null);
    }
  }

  /** Mark a node as harvested: hide the meshes but keep the slot reserved. */
  setDead(id, respawnAt) {
    const entry = this.nodes.get(id);
    if (!entry || entry.dead) return;
    entry.dead = true;
    entry.respawnAt = respawnAt;
    for (const [kind, slot] of Object.entries(entry.slots)) this.pools[kind]?.hide(slot);
  }

  respawn(id) {
    const entry = this.nodes.get(id);
    if (!entry) return;
    entry.dead = false;
    this._place(entry);
  }

  remove(id) {
    const entry = this.nodes.get(id);
    if (!entry) return;
    for (const [kind, slot] of Object.entries(entry.slots)) this.pools[kind]?.freeSlot(slot);
    this.nodes.delete(id);
  }

  get(id) { return this.nodes.get(id); }

  setHighlight(node) {
    if (!node) { this.highlight.visible = false; return; }
    const h = node.type === 'tree' ? 3.6 * (node.scale || 1) : node.type === 'rock' ? 1.1 : 0.9;
    this.highlight.visible = true;
    this.highlight.scale.set(node.type === 'tree' ? 2.2 : 1.6, h, node.type === 'tree' ? 2.2 : 1.6);
    this.highlight.position.set(node.x, node.y + h * 0.55, node.z);
  }
}

/* ------------------------------------------------------------------ *
 *  Buildings
 * ------------------------------------------------------------------ */

export class BuildingView {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map(); // id -> {obj, data}
  }

  upsert(data) {
    let entry = this.map.get(data.id);
    if (!entry) {
      const obj = this._build(data);
      entry = { obj, data, open: !!data.open };
      this.map.set(data.id, entry);
      this.scene.add(obj);
    } else {
      entry.data = data;
      if (data.piece === 'door' && entry.open !== !!data.open && entry.obj.userData.panel) {
        entry.open = !!data.open;
        entry.obj.userData.panel.rotation.y = entry.open ? Math.PI / 2 : 0;
      }
      // damage tint (per-building materials, never the shared ones)
      const ratio = Math.max(0.35, Math.min(1, data.hp / (PIECES[data.piece]?.hp || 400)));
      entry.obj.traverse((o) => {
        if (o.isMesh && o.material?.userData?.ownColor) o.material.color.setScalar(ratio);
      });
    }
  }

  _build(data) {
    const def = PIECES[data.piece];
    const pos = piecePosition(data.cx, data.cz, data.rot, data.piece);
    const group = new THREE.Group();
    group.position.set(pos.x, data.y, pos.z);

    const own = (mat) => { const m = mat.clone(); m.userData.ownColor = true; return m; };
    if (data.piece === 'foundation') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2]), own(MATS.woodDark));
      m.position.y = def.size[1] / 2;
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    } else if (data.piece === 'wall') {
      const g = new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2]);
      const m = new THREE.Mesh(g, own(MATS.wood));
      m.position.y = def.size[1] / 2;
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    } else if (data.piece === 'door') {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2] * 0.6), own(MATS.woodDark));
      frame.position.y = def.size[1] / 2;
      frame.scale.x = 1.02;
      group.add(frame);
      const panel = new THREE.Group();
      panel.position.set(-0.75, 0, 0);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.5, def.size[1] * 0.94, def.size[2] * 0.7), own(MATS.wood));
      leaf.position.set(0.75, def.size[1] / 2, 0);
      leaf.castShadow = true;
      panel.add(leaf);
      group.add(panel);
      group.userData.panel = panel;
    } else if (data.piece === 'campfire') {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.22, 6), MATS.stone);
      ring.position.y = 0.11;
      group.add(ring);
      const logs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 5), MATS.woodDark);
      logs.rotation.z = Math.PI / 2;
      logs.position.y = 0.28;
      group.add(logs);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 0.9, 5),
        new THREE.MeshBasicMaterial({ color: 0xffa23c, transparent: true, opacity: 0.92 }),
      );
      flame.position.y = 0.8;
      group.add(flame);
      group.userData.flame = flame;
      const light = new THREE.PointLight(0xff9a3c, 2.4, 16, 2);
      light.position.y = 1.0;
      group.add(light);
      group.userData.light = light;
    }

    // Walls/doors are modelled spanning local X; rotate them onto the cell edge
    // the server placed them on (piecePosition already moved them there).
    group.rotation.y = def.flat ? 0 : (data.rot * Math.PI) / 2;
    return group;
  }

  remove(id) {
    const entry = this.map.get(id);
    if (!entry) return;
    this.scene.remove(entry.obj);
    entry.obj.traverse((o) => { if (o.isMesh && o.geometry && !Object.values(SHARED).includes(o.geometry)) o.geometry.dispose(); });
    this.map.delete(id);
  }

  update(dt, time) {
    for (const { obj } of this.map.values()) {
      const flame = obj.userData.flame;
      if (flame) {
        const s = 0.85 + Math.sin(time * 9 + obj.position.x) * 0.12;
        flame.scale.set(s, s * (1 + Math.sin(time * 13) * 0.09), s);
        if (obj.userData.light) obj.userData.light.intensity = 2.2 + Math.sin(time * 11) * 0.5;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Animals
 * ------------------------------------------------------------------ */

export class AnimalView {
  /** Terrain seed used to lift interpolated positions back onto the surface. */
  setSeed(seed) { this.seed = seed; }

  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
  }

  upsert(a) {
    let entry = this.map.get(a.id);
    if (!entry) {
      const obj = this._build(a);
      entry = { obj, type: a.type, x: a.x, y: a.y, z: a.z, target: a, lastSeen: performance.now(), phase: Math.random() * 10 };
      this.map.set(a.id, entry);
      this.scene.add(obj);
    }
    entry.target = a;
    entry.lastSeen = performance.now();
  }

  _build(a) {
    const def = ANIMALS[a.type];
    const g = new THREE.Group();
    const mat = a.type === 'boar' ? MATS.animalDark : MATS.animal;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.65, 1.25), mat);
    body.position.y = 0.85;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.5), mat);
    head.position.set(0, 1.12, 0.72);
    g.add(head);
    for (const [dx, dz] of [[-0.24, 0.45], [0.24, 0.45], [-0.24, -0.45], [0.24, -0.45]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), mat);
      leg.position.set(dx, 0.28, dz);
      leg.userData.legPhase = dz > 0 ? 0 : Math.PI;
      g.add(leg);
    }
    if (a.type === 'deer') {
      const antler = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 4), MATS.woodDark);
      antler.position.set(0, 1.45, 0.6);
      g.add(antler);
    }
    g.scale.setScalar(Math.max(0.8, def.height));
    return g;
  }

  remove(id) {
    const entry = this.map.get(id);
    if (!entry) return;
    this.scene.remove(entry.obj);
    this.map.delete(id);
  }

  update(dt) {
    const now = performance.now();
    for (const [id, entry] of this.map) {
      if (now - entry.lastSeen > 900) { this.remove(id); continue; }
      const t = entry.target;
      const lerp = 1 - Math.exp(-8 * dt);
      const px = entry.x;
      const pz = entry.z;
      entry.x += (t.x - entry.x) * lerp;
      entry.y += (t.y - entry.y) * lerp;
      entry.z += (t.z - entry.z) * lerp;
      // A straight line between two points on a slope passes *under* the hill,
      // so the interpolated value is lifted to the surface before it is drawn.
      if (this.seed) entry.y = liftToSurface(entry.y, sampleHeight(entry.x, entry.z, this.seed), 0);
      entry.obj.position.set(entry.x, entry.y, entry.z);
      let dyaw = t.yaw - entry.obj.rotation.y;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      entry.obj.rotation.y += dyaw * lerp;

      const speed = Math.hypot(entry.x - px, entry.z - pz) / Math.max(dt, 0.001);
      entry.phase += dt * Math.min(14, 3 + speed * 2.4);
      for (const child of entry.obj.children) {
        if (child.userData.legPhase !== undefined) {
          child.rotation.x = Math.sin(entry.phase + child.userData.legPhase) * Math.min(0.7, speed * 0.16);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Remote players
 * ------------------------------------------------------------------ */

function nameTexture(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = 'bold 34px Segoe UI, Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 16), 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

export class PlayerView {
  /** Terrain seed used to lift interpolated positions back onto the surface. */
  setSeed(seed) { this.seed = seed; }

  constructor(scene, selfId) {
    this.scene = scene;
    this.selfId = selfId;
    this.map = new Map();
  }

  upsert(p) {
    if (p.id === this.selfId) return;
    let entry = this.map.get(p.id);
    if (!entry || entry.name !== p.name) {
      if (entry) this.remove(p.id);
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(p.color || '#c88'), flatShading: true });
      const body = new THREE.Mesh(SHARED.capsule, bodyMat);
      body.position.y = 0.85;
      body.castShadow = true;
      group.add(body);
      const head = new THREE.Mesh(SHARED.head, new THREE.MeshLambertMaterial({ color: 0xe8b48a, flatShading: true }));
      head.position.y = 1.62;
      head.castShadow = true;
      group.add(head);
      const held = new THREE.Mesh(SHARED.box, MATS.wood);
      held.scale.set(0.12, 0.5, 0.12);
      held.position.set(0.42, 1.0, 0.18);
      group.add(held);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(p.name), transparent: true, depthTest: false }));
      sprite.scale.set(2.2, 0.55, 1);
      sprite.position.y = 2.35;
      group.add(sprite);
      this.map.set(p.id, { group, target: p, x: p.x, y: p.y, z: p.z, name: p.name, held });
      this.scene.add(group);
      entry = this.map.get(p.id);
    }
    entry.target = p;
    entry.lastSeen = performance.now();
    if (entry.held) entry.held.visible = !!p.item;
  }

  remove(id) {
    const entry = this.map.get(id);
    if (!entry) return;
    this.scene.remove(entry.group);
    this.map.delete(id);
  }

  update(dt) {
    const now = performance.now();
    for (const [id, entry] of this.map) {
      if (now - entry.lastSeen > 1000) { this.remove(id); continue; }
      const t = entry.target;
      const k = 1 - Math.exp(-14 * dt);
      const px = entry.x;
      const pz = entry.z;
      entry.x += (t.x - entry.x) * k;
      entry.y += (t.y - entry.y) * k;
      entry.z += (t.z - entry.z) * k;
      // Same rule for other players: never draw a body inside a hillside.
      if (this.seed) entry.y = liftToSurface(entry.y, sampleHeight(entry.x, entry.z, this.seed), 0);
      const speed = Math.hypot(entry.x - px, entry.z - pz) / Math.max(dt, 0.001);
      entry.group.position.set(entry.x, entry.y, entry.z);
      let dyaw = t.yaw - entry.group.rotation.y;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      entry.group.rotation.y += dyaw * k;
      entry.group.children[0].scale.y = t.crouch ? 0.7 : 1;
      entry.group.children[0].position.y = t.crouch ? 0.65 : 0.85;
      entry.group.children[1].position.y = t.crouch ? 1.12 : 1.62;
      const bob = Math.sin(now * 0.012) * Math.min(0.06, speed * 0.012);
      entry.group.children[1].position.y += bob;
    }
  }
}

/* ------------------------------------------------------------------ *
 *  First person view model + build ghost
 * ------------------------------------------------------------------ */

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.camera.position.set(0, 0, 0);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1, 2, 1);
    this.scene.add(key);

    this.models = {
      fist: this._fist(),
      stone_axe: this._axe(),
      stone_pickaxe: this._pickaxe(),
      spear: this._spear(),
      torch: this._torch(),
    };
    this.hand = new THREE.Group();
    this.group.add(this.hand);

    this.swingT = 0;
    this.bobPhase = 0;
    this.current = undefined; // undefined so the first setItem() always applies
  }

  _fist() {
    const g = new THREE.Group();
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.22), new THREE.MeshLambertMaterial({ color: 0xe8b48a, flatShading: true }));
    fist.position.set(0, 0, 0);
    g.add(fist);
    return g;
  }

  _handle() {
    const g = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.8), MATS.woodDark);
    stick.position.set(0, 0, -0.15);
    g.add(stick);
    return g;
  }

  _axe() {
    const g = this._handle();
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.26, 0.16), MATS.rock);
    head.position.set(0, 0, -0.5);
    head.rotation.x = 0.2;
    g.add(head);
    return g;
  }

  _pickaxe() {
    const g = this._handle();
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.44), MATS.rock);
    head.position.set(0, 0.02, -0.5);
    g.add(head);
    return g;
  }

  _spear() {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), MATS.woodDark);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0, -0.55);
    g.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 6), MATS.rock);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0, -1.45);
    g.add(tip);
    return g;
  }

  _torch() {
    const g = this._handle();
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 6), new THREE.MeshBasicMaterial({ color: 0xffa23c }));
    flame.position.set(0, 0.16, -0.52);
    g.add(flame);
    const light = new THREE.PointLight(0xffa050, 2.2, 12, 2);
    light.position.set(0, 0.2, -0.5);
    g.add(light);
    return g;
  }

  setItem(itemKey) {
    if (this.current === itemKey) return;
    this.current = itemKey;
    for (const m of Object.values(this.models)) m.visible = false;
    const model = this.models[itemKey] || this.models.fist;
    model.visible = true;
    if (model.parent !== this.hand) this.hand.add(model);
  }

  swing() { this.swingT = 1; }

  update(dt, { moving = 0, onGround = true } = {}) {
    this.swingT = Math.max(0, this.swingT - dt * 3.4);
    const swing = Math.sin((1 - this.swingT) * Math.PI) * Math.min(1, this.swingT * 4);
    this.bobPhase += dt * (4 + moving * 2.4);
    const bobX = Math.cos(this.bobPhase) * 0.012 * moving * (onGround ? 1 : 0.2);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.014 * moving;

    this.hand.position.set(0.28 + bobX, -0.24 + bobY - swing * 0.12, -0.55 + swing * 0.22);
    this.hand.rotation.set(-swing * 1.1, -0.25 + swing * 0.15, 0.1 - swing * 0.5);
    this.camera.aspect = this._aspect || 1;
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect) { this._aspect = aspect; }

  render(renderer) {
    renderer.render(this.scene, this.camera);
  }
}

/* ------------------------------------------------------------------ *
 *  Build ghost
 * ------------------------------------------------------------------ */

export class BuildGhost {
  constructor(scene) {
    this.scene = scene;
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x7ac74f, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.mesh.visible = false;
    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
    );
    this.mesh.add(this.edges);
    scene.add(this.mesh);
    this.piece = null;
    this.cell = { cx: 0, cz: 0, rot: 0 };
  }

  show(piece, cx, cz, rot, y, valid) {
    const def = PIECES[piece];
    const pos = piecePosition(cx, cz, rot, piece);
    this.piece = piece;
    this.cell = { cx, cz, rot };
    this.mesh.visible = true;
    this.mesh.scale.set(def.size[0], def.size[1], def.size[2]);
    this.mesh.position.set(pos.x, y + def.size[1] / 2, pos.z);
    this.mesh.material.color.set(valid ? 0x7ac74f : 0xe2574c);
    this.mesh.material.opacity = valid ? 0.35 : 0.3;
  }

  hide() { this.mesh.visible = false; this.piece = null; }
}

export { SHARED, MATS, WORLD, ITEMS, buildingAABB };
