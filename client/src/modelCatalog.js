/**
 * Spell - the model catalog: eight categories, one entry per model.
 *
 * Rule: "split the models into 8 categories - animals, ground, weapons,
 * material, character, building, equipment, texture - build them one by one in
 * those categories, then check them all one by one. From the earlier rules,
 * placement is added too: check where each model is placed, and then the errors
 * in it."
 *
 * This file is the single list of every model the game can draw. Each entry says
 *   - which category it belongs to (exactly one),
 *   - how it is built (through the *real* view classes, so the catalog can never
 *     drift away from what the game actually renders),
 *   - where it is allowed to be placed, and what that means numerically,
 *   - what it costs (triangle budget) and what size the gameplay data demands.
 *
 * test/model-catalog.js walks the categories one at a time and checks every
 * model, including placement. F3 shows the catalog size.
 */

import * as THREE from 'three';
import { PIECES, NODES, ANIMALS, WORLD, PHYS, piecePosition, buildingAABB, playerColor } from '../../shared/config.js';
import { PALETTE, BUDGET, MATERIALS, trianglesOf } from './palette.js';

/* ------------------------------------------------------------------ *
 *  The eight categories
 * ------------------------------------------------------------------ */

export const MODEL_CATEGORIES = [
  { id: 'djur', sv: 'Djur', en: 'Animals', description: 'allt levande som rör sig i världen' },
  { id: 'mark', sv: 'Mark', en: 'Ground', description: 'terräng, vatten, himmel och ljus' },
  { id: 'vapen', sv: 'Vapen', en: 'Weapons', description: 'det spelaren slår med' },
  { id: 'material', sv: 'Material', en: 'Materials', description: 'resursnoder att samla' },
  { id: 'karaktar', sv: 'Karaktär', en: 'Character', description: 'spelarkroppar och den egna handen' },
  { id: 'bygge', sv: 'Bygge', en: 'Building', description: 'delar spelaren bygger med' },
  { id: 'utrustning', sv: 'Utrustning', en: 'Equipment', description: 'verktyg och belysning spelaren bär' },
  { id: 'textur', sv: 'Textur', en: 'Texture', description: 'skyltar, markörer och texturerade ytor' },
];

export const CATEGORY_IDS = MODEL_CATEGORIES.map((c) => c.id);

/* ------------------------------------------------------------------ *
 *  Shared contexts (built lazily, so the catalog stays cheap)
 * ------------------------------------------------------------------ */

let entities = null;
let terrain = null;
let cachedWorldView = null;

async function loadEntities() {
  if (!entities) entities = await import('./entities.js');
  return entities;
}

async function loadWorldView() {
  if (!terrain) terrain = await import('./terrain.js');
  return terrain;
}

/** One WorldView is shared between the five "mark" models (it is expensive). */
async function worldView() {
  if (!cachedWorldView) {
    const { WorldView } = await loadWorldView();
    const scene = new THREE.Scene();
    const view = new WorldView(scene, WORLD.seed);
    // Put the sun/moon and the water at a known gameplay time and player anchor.
    // Without a real update the celestial body remains at the origin, which is
    // exactly the placement bug this catalog is supposed to catch.
    view.update(0, { x: 0, y: 0, z: 0 }, WORLD.size, false);
    cachedWorldView = { scene, view, placementAnchor: new THREE.Vector3(0, 0, 0) };
  }
  return cachedWorldView;
}

/* ------------------------------------------------------------------ *
 *  Placement rules
 *
 *  A placement rule says where a model may stand and how to verify it. The
 *  test calls `check(model)`; a non-empty result is a placement error.
 * ------------------------------------------------------------------ */

const PLACEMENT = {
  /** The base of the model rests on the ground the server simulated. */
  ground: {
    sv: 'på marken (foten i markytan)',
    en: 'on the ground (base at the surface)',
    check(built) {
      const box = new THREE.Box3().setFromObject(built.object);
      const minY = box.min.y - (built.anchorY ?? 0);
      if (!Number.isFinite(minY)) return 'modellens höjd gick inte att mäta';
      if (minY < -0.06) return `modellen börjar ${(-minY).toFixed(2)} m under marken`;
      if (minY > 0.35) return `modellen svävar ${minY.toFixed(2)} m över marken`;
      return null;
    },
  },

  /** Terrain, water, sky and lights live in their own layer of the world. */
  layer: {
    sv: 'i sitt eget lager (mark/vatten/himmel)',
    en: 'in its own layer (ground/water/sky)',
    check(built) {
      const y = built.object.position.y;
      const expected = built.expect ?? {};
      if (!Number.isFinite(y)) return 'lagret saknar höjd';
      if (expected.equals !== undefined && Math.abs(y - expected.equals) > 0.01) {
        return `lagret ligger på y=${y.toFixed(2)}, ska vara ${expected.equals}`;
      }
      if (expected.min !== undefined && y < expected.min) return `lagret ligger för lågt (y=${y.toFixed(2)})`;
      if (expected.max !== undefined && y > expected.max) return `lagret ligger för högt (y=${y.toFixed(2)})`;
      return null;
    },
  },

  /** Building pieces snap to the 4 m grid: centre or cell edge, rot*90°. */
  grid: {
    sv: 'på 4 m-rutnätet (kant eller mitten)',
    en: 'on the 4 m grid (edge or centre)',
    check(built) {
      const { object, expect = {} } = built;
      const want = piecePosition(expect.cx, expect.cz, expect.rot, expect.piece);
      const dx = Math.abs(object.position.x - want.x);
      const dz = Math.abs(object.position.z - want.z);
      if (dx > 0.01 || dz > 0.01) {
        return `placerad på ${object.position.x.toFixed(2)},${object.position.z.toFixed(2)} men rutnätet säger ${want.x},${want.z}`;
      }
      const def = PIECES[expect.piece];
      const wantRot = def?.flat ? 0 : (expect.rot * Math.PI) / 2;
      if (Math.abs(object.rotation.y - wantRot) > 1e-6) {
        return `rotationen ${object.rotation.y.toFixed(3)} stämmer inte med rot ${expect.rot}`;
      }
      if (!def?.flat) {
        const aabb = buildingAABB({
          id: 'x', piece: expect.piece, cx: expect.cx, cz: expect.cz, rot: expect.rot, y: object.position.y,
        });
        const box = new THREE.Box3().setFromObject(object);
        if (aabb) {
          const overX = Math.max(box.min.x - aabb.minX, aabb.maxX - box.max.x);
          const overZ = Math.max(box.min.z - aabb.minZ, aabb.maxZ - box.max.z);
          if (overX > 0.2 || overZ > 0.2) return 'modellen sticker utanför sin kollisionsbox';
        }
      }
      return null;
    },
  },

  /** Weapons and equipment are carried: in front of the camera, inside the hand. */
  held: {
    sv: 'i handen (framför kameran, aldrig i världen)',
    en: 'in the hand (in front of the camera, never in the world)',
    check(built) {
      const { object, camera } = built;
      if (!object.parent) return 'föremålet sitter inte i någon hand';
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      if (camera) center.applyMatrix4(new THREE.Matrix4().copy(camera.matrixWorld).invert());
      if (center.z > -0.05) return `föremålet ligger bakom kameran (z=${center.z.toFixed(2)})`;
      if (Math.abs(center.x) > 1.0) return `föremålet är utanför handen (x=${center.x.toFixed(2)})`;
      if (center.y < -1.0 || center.y > 0.6) return `föremålet är inte i handhöjd (y=${center.y.toFixed(2)})`;
      const worldParent = object.parent;
      if (worldParent === null) return 'föremålet är inte kopplat till något';
      return null;
    },
  },

  /** Name tags and similar decorations hang off another model. */
  attached: {
    sv: 'fäst på en annan modell (t.ex. över huvudet)',
    en: 'attached to another model (e.g. above the head)',
    check(built) {
      const { object, expect = {} } = built;
      if (!object.parent) return 'dekorationen är inte fäst på något';
      if (typeof object.position.y !== 'number' || Number.isNaN(object.position.y)) return 'dekorationen saknar höjd';
      if (expect.above !== undefined && object.position.y < expect.above) {
        return `dekorationen sitter för lågt (${object.position.y.toFixed(2)} < ${expect.above})`;
      }
      return null;
    },
  },

  /** Markers (build ghost, node highlight) never collide and never cast shadow. */
  marker: {
    sv: 'som markör (genomskinlig, ingen skugga, ingen kollision)',
    en: 'as a marker (transparent, no shadow, no collision)',
    check(built) {
      const { object } = built;
      let problem = null;
      object.traverse((o) => {
        if (problem || !o.isMesh) return;
        const mat = o.material;
        if (!mat) { problem = 'markören saknar material'; return; }
        if (!mat.transparent) problem = 'markören är inte genomskinlig';
        if (o.castShadow) problem = 'markören kastar skugga (den ska vara en markör)';
      });
      return problem;
    },
  },
};

/* ------------------------------------------------------------------ *
 *  The models
 * ------------------------------------------------------------------ */

const model = (spec) => spec;

/** Every model in the game, grouped by category, one entry each. */
export const MODELS = [
  /* ------------------------------- djur ------------------------------- */
  ...Object.entries(ANIMALS).map(([type, def]) => model({
    id: `animal_${type}`,
    category: 'djur',
    sv: def.label,
    en: def.labelEn,
    placement: 'ground',
    budget: BUDGET.animal,
    expect: { height: def.height },
    async build() {
      const { AnimalView } = await loadEntities();
      const scene = new THREE.Scene();
      const view = new AnimalView(scene);
      view.setSeed(WORLD.seed);
      view.upsert({ id: 'a', type, x: 0, y: 0, z: 0, yaw: 0, hp: def.hp });
      return { object: view.map.get('a').obj, anchorY: 0, scene, height: def.height };
    },
  })),

  /* ------------------------------- mark ------------------------------- */
  model({
    id: 'terrain', category: 'mark', sv: 'Terräng', en: 'Terrain', placement: 'layer',
    expect: { y: 0 }, budget: 60000,
    async build() {
      const { scene, view } = await worldView();
      return { object: view.terrain, anchorY: 0, scene };
    },
    placementCheck(built) {
      const box = new THREE.Box3().setFromObject(built.object);
      const size = box.getSize(new THREE.Vector3());
      if (size.x < WORLD.size * 0.9 || size.z < WORLD.size * 0.9) return `terrängen täcker bara ${size.x.toFixed(0)}×${size.z.toFixed(0)} m av ${WORLD.size}`;
      // The ocean floor is allowed to be below 0 - but not below the world's own limits.
      if (box.min.y < -WORLD.maxHeight - 1) return `terrängen har hål nedåt (min y ${box.min.y.toFixed(1)})`;
      return null;
    },
  }),
  model({
    id: 'water', category: 'mark', sv: 'Vatten', en: 'Water', placement: 'layer',
    expect: { y: WORLD.seaLevel }, budget: 60000,
    async build() {
      const { scene, view } = await worldView();
      return { object: view.water, anchorY: 0, scene };
    },
    placementCheck(built) {
      if (Math.abs(built.object.position.y - WORLD.seaLevel) > 0.01) return `vattnet ligger på y=${built.object.position.y}, havsnivån är ${WORLD.seaLevel}`;
      const box = new THREE.Box3().setFromObject(built.object);
      const size = box.getSize(new THREE.Vector3());
      if (size.x < WORLD.size) return 'vattnet täcker inte världen';
      return null;
    },
  }),
  model({
    id: 'sky', category: 'mark', sv: 'Himmel', en: 'Sky', placement: 'layer',
    expect: { y: 0 }, budget: 4000,
    async build() {
      const { scene, view } = await worldView();
      return { object: view.sky, anchorY: 0, scene };
    },
    placementCheck(built) {
      const geo = built.object.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      if (geo.boundingSphere.radius < 500) return `himlen är bara ${geo.boundingSphere.radius.toFixed(0)} m radie`;
      if (built.object.material.side !== THREE.BackSide) return 'himlen är inte ritad inifrån (BackSide)';
      return null;
    },
  }),
  model({
    id: 'stars', category: 'mark', sv: 'Stjärnor', en: 'Stars', placement: 'layer',
    expect: { y: 0 }, budget: 4000,
    async build() {
      const { scene, view } = await worldView();
      return { object: view.stars, anchorY: 0, scene };
    },
    placementCheck(built) {
      const pos = built.object.geometry.attributes.position;
      if (!pos || pos.count < 100) return `bara ${pos?.count ?? 0} stjärnor`;
      let maxR = 0;
      for (let i = 0; i < pos.count; i++) {
        maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
      }
      if (maxR < 300 || maxR > 900) return `stjärnorna ligger på ${maxR.toFixed(0)} m (utanför himlen)`;
      return null;
    },
  }),
  model({
    id: 'celestial', category: 'mark', sv: 'Sol och måne', en: 'Sun and moon', placement: 'layer',
    expect: { y: 0 }, budget: 1000,
    async build() {
      const { scene, view, placementAnchor } = await worldView();
      return { object: view.celestial, anchorY: 0, scene, placementAnchor };
    },
    placementCheck(built) {
      const geo = built.object.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const r = geo.boundingSphere.radius;
      if (r < 3 || r > 60) return `sol/måne har radien ${r.toFixed(1)} m`;
      const distance = built.object.position.distanceTo(built.placementAnchor);
      if (distance < 600 || distance > 760 - r) return `sol/måne ligger ${distance.toFixed(0)} m från spelaren (ska vara inne i himlen)`;
      if (built.object.material.fog !== false) return 'sol/måne påverkas av dimman';
      return null;
    },
  }),

  /* ------------------------------ vapen ------------------------------- */
  model({
    id: 'weapon_axe', category: 'vapen', sv: 'Stenyxa', en: 'Stone axe', placement: 'held',
    expect: { item: 'stone_axe' }, budget: BUDGET.viewModel,
    async build() { return heldModel('stone_axe'); },
  }),
  model({
    id: 'weapon_spear', category: 'vapen', sv: 'Spjut', en: 'Spear', placement: 'held',
    expect: { item: 'spear' }, budget: BUDGET.viewModel,
    async build() { return heldModel('spear'); },
  }),

  /* ----------------------------- material ----------------------------- */
  ...Object.entries(NODES).map(([type, def]) => model({
    id: `resource_${type}`,
    category: 'material',
    sv: def.name,
    en: def.nameEn,
    placement: 'ground',
    budget: BUDGET.node,
    expect: { height: def.height, radius: def.radius },
    async build() {
      const { NodeView } = await loadEntities();
      const scene = new THREE.Scene();
      const view = new NodeView(scene);
      view.upsert({ id: 'n', type, x: 0, y: 0, z: 0, rot: 0, scale: 1 });
      // Instanced pools: measure the slot the node occupies, not the whole pool.
      const layout = (await loadEntities()).nodeLayout(type, 1);
      const object = new THREE.Group();
      object.userData.instanced = true;
      for (const [kind, part] of Object.entries(layout.parts)) {
        const pool = view.pools[kind];
        const m = pool.mesh.clone();
        m.geometry = pool.mesh.geometry;
        m.count = 1;
        m.setMatrixAt(0, new THREE.Matrix4()); // identity: the object carries the transform
        m.instanceMatrix.needsUpdate = true;
        m.position.set(0, part.y, 0);
        m.scale.set(part.sx, part.sy, part.sz);
        object.add(m);
      }
      return { object, anchorY: 0, scene, expect: { height: def.height } };
    },
  })),

  /* ---------------------------- karaktär ------------------------------ */
  model({
    id: 'player_body', category: 'karaktar', sv: 'Spelarkropp', en: 'Player body', placement: 'ground',
    expect: { height: PHYS.height }, budget: BUDGET.player,
    async build() {
      const { PlayerView } = await loadEntities();
      const scene = new THREE.Scene();
      const view = new PlayerView(scene, 'self');
      view.setSeed(WORLD.seed);
      view.upsert({ id: 'p', name: 'Test', x: 0, y: 0, z: 0, yaw: 0, crouch: false, health: 100, toolItem: null, color: playerColor('catalog-player') });
      return { object: view.map.get('p').group, anchorY: 0, scene, height: PHYS.height };
    },
  }),
  model({
    id: 'hand', category: 'karaktar', sv: 'Handen (förstapersonsvy)', en: 'Hand (first person)', placement: 'held',
    expect: {}, budget: BUDGET.viewModel,
    async build() { return heldModel('fist'); },
  }),

  /* ------------------------------ bygge ------------------------------- */
  ...Object.entries(PIECES).map(([piece, def]) => model({
    id: `build_${piece}`,
    category: 'bygge',
    sv: def.label,
    en: def.labelEn,
    placement: 'grid',
    budget: BUDGET.piece * 2,
    expect: { piece, size: def.size, rot: 1 },
    async build() {
      const { BuildingView } = await loadEntities();
      const scene = new THREE.Scene();
      const view = new BuildingView(scene);
      const cx = 2;
      const cz = -3;
      const entry = { id: 'b', piece, cx, cz, rot: 1, y: 0, hp: def.hp, open: false, ownerName: 'Test' };
      view.upsert(entry);
      const object = view.map.get('b').obj;
      return { object, anchorY: entry.y, scene, expect: entry, def };
    },
  })),

  /* --------------------------- utrustning ----------------------------- */
  model({
    id: 'equipment_pickaxe', category: 'utrustning', sv: 'Stenhacka', en: 'Stone pickaxe', placement: 'held',
    expect: { item: 'stone_pickaxe' }, budget: BUDGET.viewModel,
    async build() { return heldModel('stone_pickaxe'); },
  }),
  model({
    id: 'equipment_torch', category: 'utrustning', sv: 'Fackla', en: 'Torch', placement: 'held',
    expect: { item: 'torch' }, budget: BUDGET.viewModel,
    async build() { return heldModel('torch'); },
  }),

  /* ----------------------------- textur ------------------------------- */
  model({
    id: 'name_tag', category: 'textur', sv: 'Namnskylt', en: 'Name tag', placement: 'attached',
    expect: { above: 2 }, budget: 2,
    async build() {
      const { PlayerView } = await loadEntities();
      const scene = new THREE.Scene();
      const view = new PlayerView(scene, 'self');
      view.upsert({ id: 'p', name: 'Namn', x: 0, y: 0, z: 0, yaw: 0, crouch: false, health: 100, toolItem: null, color: playerColor('catalog-name') });
      let sprite = null;
      view.map.get('p').group.traverse((o) => { if (o.isSprite) sprite = o; });
      return { object: sprite, anchorY: 0, scene, expect: { above: 2 } };
    },
  }),
  model({
    id: 'build_ghost', category: 'textur', sv: 'Byggmarkör', en: 'Build marker', placement: 'marker',
    expect: {}, budget: 24,
    async build() {
      const { BuildGhost } = await loadEntities();
      const scene = new THREE.Scene();
      const ghost = new BuildGhost(scene);
      ghost.show('wall', 1, 2, 0, 0, true);
      return { object: ghost.mesh, anchorY: 0, scene, ghost };
    },
  }),
  model({
    id: 'node_highlight', category: 'textur', sv: 'Markeringsring', en: 'Highlight ring', placement: 'marker',
    expect: {}, budget: 64,
    async build() {
      const { NodeView } = await loadEntities();
      const scene = new THREE.Scene();
      const view = new NodeView(scene);
      view.setHighlight({ id: 'n', type: 'tree', x: 0, y: 0, z: 0, scale: 1 });
      return { object: view.highlight, anchorY: 0, scene };
    },
  }),
];

/**
 * Shared helper: take one carried model out of a fresh ViewModel, put it in the
 * hand and run one frame so the hand sits where the game puts it
 * (0.28, -0.24, -0.55 in front of the camera).
 */
async function heldModel(itemKey) {
  const { ViewModel } = await loadEntities();
  const vm = new ViewModel();
  vm.setItem(itemKey);
  vm.update(0.016, { moving: 0, onGround: true });
  vm.group.updateMatrixWorld(true);
  vm.camera.updateMatrixWorld(true);
  return { object: vm.models[itemKey] || vm.models.fist, anchorY: 0, camera: vm.camera, viewModel: vm, scene: vm.scene };
}

/* ------------------------------------------------------------------ *
 *  Lookup helpers
 * ------------------------------------------------------------------ */

export function modelsInCategory(categoryId) {
  return MODELS.filter((m) => m.category === categoryId);
}

export function getModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

/** Category counts, e.g. { djur: 2, mark: 5, ... } - shown in F3 and docs. */
export function catalogSummary() {
  const counts = {};
  for (const id of CATEGORY_IDS) counts[id] = modelsInCategory(id).length;
  return { total: MODELS.length, categories: MODEL_CATEGORIES.length, counts };
}

/** Problems with the catalog itself: unknown category, duplicate id, no placement. */
export function auditCatalog() {
  const problems = [];
  const seen = new Set();
  for (const m of MODELS) {
    if (!CATEGORY_IDS.includes(m.category)) problems.push(`${m.id}: okänd kategori ${m.category}`);
    if (seen.has(m.id)) problems.push(`${m.id}: dubblerat id`);
    seen.add(m.id);
    if (!PLACEMENT[m.placement]) problems.push(`${m.id}: okänd placeringsregel ${m.placement}`);
    if (!m.sv || !m.en) problems.push(`${m.id}: saknar namn på sv eller en`);
    if (typeof m.build !== 'function') problems.push(`${m.id}: saknar byggare`);
  }
  for (const id of CATEGORY_IDS) {
    if (!modelsInCategory(id).length) problems.push(`kategorin ${id} är tom`);
  }
  return problems;
}

/**
 * Placement check for one built model. Returns problem strings (empty = placed
 * correctly according to its rule).
 */
export function checkPlacement(spec, built) {
  const rule = PLACEMENT[spec.placement];
  if (!rule) return [`${spec.id}: okänd placeringsregel`];
  // A model may need a sharper check than its rule (the sky is not "a height").
  const problem = (spec.placementCheck ?? rule.check)(built);
  return problem ? [`${spec.id} (${rule.sv}): ${problem}`] : [];
}

/** Where the model is allowed to be, as text (used in docs and F3). */
export function placementText(spec) {
  return PLACEMENT[spec.placement]?.sv ?? 'okänd';
}

/** Triangle count of a built model, index-aware. */
export function trianglesOfModel(object) {
  let total = 0;
  object.traverse((o) => { if (o.isMesh) total += trianglesOf(o.geometry) * (o.isInstancedMesh ? Math.max(1, o.count) : 1); });
  return total;
}

export { PLACEMENT, PALETTE, MATERIALS, BUDGET };
