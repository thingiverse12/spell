/**
 * Spell - shared game configuration.
 *
 * This file is imported by BOTH the browser client and the Node.js game server,
 * so that terrain, physics and rules are identical on both sides. That property
 * is what makes client-side prediction + server reconciliation cheap and exact.
 *
 * Everything here is data, no imports, no side effects.
 */

/* ------------------------------------------------------------------ *
 *  World
 * ------------------------------------------------------------------ */

export const WORLD = {
  /** Island is a square of SIZE x SIZE metres, centred on the origin. */
  size: 512,
  /** Terrain mesh / physics sample step, in metres. Low-poly look on purpose. */
  grid: 4,
  /** Deterministic default seed (overridable per server via env). */
  seed: 1337,
  /** Water level (terrain height below this is under water). */
  seaLevel: 0,
  /** Max terrain altitude produced by the generator, roughly. */
  maxHeight: 34,
};

WORLD.half = WORLD.size / 2;
/** Vertices per side of the terrain grid. */
WORLD.verts = WORLD.size / WORLD.grid + 1;

/* ------------------------------------------------------------------ *
 *  Networking
 * ------------------------------------------------------------------ */

export const NET = {
  /** Authoritative simulation rate (server ticks / second). Report recommends 20-30. */
  tickRate: 20,
  /** Client sends input at this rate. */
  inputRate: 30,
  /** Remote players are rendered this far in the past (ms) for smooth interpolation. */
  interpDelayMs: 120,
  /** Max simultaneous players per server process (MVP target from the report). */
  maxPlayers: 32,
  /** Interest radius: entities further away than this are not sent (metres). */
  interestRadius: 220,
  /** Server autosave interval, ms. */
  autosaveMs: 20000,
  /** Kick players that have not sent input for this long (ms). */
  idleTimeoutMs: 60000,
};

/* ------------------------------------------------------------------ *
 *  Player physics (shared: predicted on the client, authoritative on the server)
 * ------------------------------------------------------------------ */

export const PHYS = {
  gravity: -24,
  radius: 0.4,
  height: 1.8,
  crouchHeight: 1.2,
  eyeHeight: 1.62,
  crouchEyeHeight: 1.05,
  walkSpeed: 4.6,
  sprintSpeed: 7.6,
  crouchSpeed: 2.1,
  swimSpeed: 3.2,
  waterDrag: 0.86,
  accel: 12, // ground acceleration (per second, exponential blend factor)
  airAccel: 2.5,
  jumpSpeed: 8.4,
  /** How high a ledge the player can walk up without jumping. */
  stepHeight: 0.65,
  /** Terminal fall speed. */
  maxFall: -55,
  /** Fall damage starts above this speed. */
  safeFallSpeed: -18,
  fallDamagePerMs: 3.2,
  /** Terrain slope (rise/run) above which movement is blocked. */
  maxSlope: 2.6,
  swimWaterDepth: 1.35,
  respirationSeconds: 18,
};

/* ------------------------------------------------------------------ *
 *  Survival stats
 * ------------------------------------------------------------------ */

export const SURVIVAL = {
  maxHealth: 100,
  maxStamina: 100,
  maxHunger: 100,
  maxThirst: 100,
  /** Stat lost per second. */
  hungerDrain: 100 / 900, // full -> empty in 15 min
  thirstDrain: 100 / 720, // full -> empty in 12 min
  starveDamage: 1.6,
  dehydrateDamage: 2.2,
  sprintStamina: 13,
  jumpStamina: 7,
  staminaRegen: 11,
  staminaRegenDelay: 1.1,
  /** Health regenerates slowly while well fed and hydrated. */
  healRate: 1.2,
  healMinHunger: 45,
  healMinThirst: 45,
  coldDamage: 0.8,
  maxBreath: 100,
  drownDamage: 6,
};

/* ------------------------------------------------------------------ *
 *  World day/night cycle
 * ------------------------------------------------------------------ */

export const TIME = {
  /** Length of a full day in seconds (6 min day + 4 min night). */
  dayLengthSec: 600,
  /** World time starts here (0..1, 0.25 = sunrise). */
  start: 0.28,
  /** Fraction of the day that is night. */
  nightFraction: 0.38,
};

/* ------------------------------------------------------------------ *
 *  Items / resources
 *
 *  kind: 'resource' | 'tool' | 'food' | 'weapon' | 'build'
 *  tool: which node types this tool efficiently harvests + damage per swing
 * ------------------------------------------------------------------ */

export const ITEMS = {
  wood: { name: 'Trä', nameEn: 'Wood', kind: 'resource', stack: 200, icon: '🪵', color: '#8a5a2b' },
  stone: { name: 'Sten', nameEn: 'Stone', kind: 'resource', stack: 200, icon: '🪨', color: '#9aa0a6' },
  fiber: { name: 'Fiber', nameEn: 'Fiber', kind: 'resource', stack: 200, icon: '🌿', color: '#4f8f3a' },
  hide: { name: 'Skinn', nameEn: 'Hide', kind: 'resource', stack: 100, icon: '🟫', color: '#a8763f' },
  berry: { name: 'Bär', nameEn: 'Berries', kind: 'food', stack: 100, icon: '🫐', color: '#5b4b9c',
    food: { hunger: 10, thirst: 6, heal: 0 } },
  meat_raw: { name: 'Rått kött', nameEn: 'Raw meat', kind: 'food', stack: 100, icon: '🥩', color: '#b8544f',
    food: { hunger: 14, thirst: 0, heal: -6 } },
  meat_cooked: { name: 'Tillagat kött', nameEn: 'Cooked meat', kind: 'food', stack: 100, icon: '🍖', color: '#8c5a34',
    food: { hunger: 38, thirst: 2, heal: 8 } },

  stone_axe: { name: 'Stenyxa', nameEn: 'Stone axe', kind: 'tool', stack: 1, icon: '🪓', color: '#a9764a',
    tool: { tree: 26, rock: 6, bush: 8, animal: 22 }, durability: 220, repair: { wood: 1, stone: 1 } },
  stone_pickaxe: { name: 'Stenhacka', nameEn: 'Stone pickaxe', kind: 'tool', stack: 1, icon: '⛏️', color: '#8d949c',
    tool: { tree: 8, rock: 26, bush: 4, animal: 15 }, durability: 220, repair: { wood: 1, stone: 2 } },
  spear: { name: 'Spjut', nameEn: 'Spear', kind: 'weapon', stack: 1, icon: '🔱', color: '#c2a06a',
    tool: { tree: 6, rock: 4, bush: 6, animal: 34 }, durability: 180, repair: { wood: 2 } },
  torch: { name: 'Fackla', nameEn: 'Torch', kind: 'tool', stack: 1, icon: '🔥', color: '#e0912f',
    tool: { tree: 4, rock: 2, bush: 4, animal: 9 }, durability: 400, light: true },

  // Building pieces are inventory items too (crafted, carried, then placed).
  foundation: { name: 'Grund', nameEn: 'Foundation', kind: 'build', stack: 32, icon: '⬛', color: '#7a5230' },
  wall: { name: 'Vägg', nameEn: 'Wall', kind: 'build', stack: 32, icon: '🧱', color: '#9a6b3c' },
  door: { name: 'Dörr', nameEn: 'Door', kind: 'build', stack: 16, icon: '🚪', color: '#8a5a2b' },
  campfire: { name: 'Lägereld', nameEn: 'Campfire', kind: 'build', stack: 16, icon: '🔥', color: '#9aa0a6' },
};

/** Damage dealt by bare hands against every node type. */
export const FIST_DAMAGE = 5;

/* ------------------------------------------------------------------ *
 *  Resource nodes
 * ------------------------------------------------------------------ */

export const NODES = {
  tree: {
    hp: 100, radius: 0.55, height: 7, respawnSec: 240,
    yields: { item: 'wood', perHit: 3, bonus: 'fiber', bonusChance: 0.25 },
    name: 'Träd', nameEn: 'Tree', sound: 'chop',
  },
  rock: {
    hp: 100, radius: 0.8, height: 1.6, respawnSec: 420,
    yields: { item: 'stone', perHit: 3, bonus: 'fiber', bonusChance: 0 },
    name: 'Sten', nameEn: 'Rock', sound: 'mine',
  },
  bush: {
    hp: 24, radius: 0.5, height: 1.1, respawnSec: 150,
    yields: { item: 'berry', perHit: 1, bonus: 'fiber', bonusChance: 0.5 },
    name: 'Bärbuske', nameEn: 'Berry bush', sound: 'pick',
  },
};

/* ------------------------------------------------------------------ *
 *  Crafting
 * ------------------------------------------------------------------ */

export const RECIPES = [
  { id: 'fiber_twine', out: { fiber: 3 }, need: { fiber: 5 }, station: null, cat: 'resource' },
  { id: 'stone_axe', out: { stone_axe: 1 }, need: { wood: 3, stone: 2, fiber: 2 }, station: null, cat: 'tools' },
  { id: 'stone_pickaxe', out: { stone_pickaxe: 1 }, need: { wood: 3, stone: 3, fiber: 2 }, station: null, cat: 'tools' },
  { id: 'spear', out: { spear: 1 }, need: { wood: 4, stone: 1, fiber: 2 }, station: null, cat: 'tools' },
  { id: 'torch', out: { torch: 1 }, need: { wood: 2, fiber: 1 }, station: null, cat: 'tools' },
  { id: 'foundation', out: { foundation: 1 }, need: { wood: 6 }, station: null, cat: 'build' },
  { id: 'wall', out: { wall: 1 }, need: { wood: 4 }, station: null, cat: 'build' },
  { id: 'door', out: { door: 1 }, need: { wood: 6, stone: 2 }, station: null, cat: 'build' },
  { id: 'campfire', out: { campfire: 1 }, need: { stone: 8, wood: 4 }, station: null, cat: 'build' },
  { id: 'cook_meat', out: { meat_cooked: 1 }, need: { meat_raw: 1 }, station: 'campfire', cat: 'food' },
];

/* ------------------------------------------------------------------ *
 *  Building pieces
 *
 *  Build grid is aligned with the terrain grid (4 m) so snapping is trivial:
 *  pieces are placed on integer cell coordinates (cx, cz) and carry a rotation
 *  of 0..3 quarter turns.
 * ------------------------------------------------------------------ */

export const BUILD = {
  /** Max distance from the player when placing (metres). */
  reach: 9,
  /** Pieces decay if the owner does not refresh them (report: Rust-style upkeep). */
  decayAfterSec: 3600 * 6,
  maxSlope: 0.85,
  reuse: 0.5,
};

export const PIECES = {
  /** size = [x-extent, height, z-extent] in the piece's local (unrotated) frame. */
  foundation: {
    label: 'Grund', labelEn: 'Foundation',
    size: [4, 0.35, 4], solid: true, hp: 500, material: 'wood',
    flat: true, rotates: false, item: 'foundation',
  },
  wall: {
    label: 'Vägg', labelEn: 'Wall',
    size: [4, 2.7, 0.35], solid: true, hp: 400, material: 'wood',
    rotates: true, item: 'wall',
  },
  door: {
    label: 'Dörr', labelEn: 'Door',
    size: [4, 2.3, 0.35], solid: true, hp: 300, material: 'wood',
    rotates: true, openable: true, item: 'door',
  },
  campfire: {
    label: 'Lägereld', labelEn: 'Campfire',
    size: [1.4, 0.6, 1.4], solid: false, hp: 200, material: 'stone',
    flat: true, rotates: false, station: 'campfire', light: true, item: 'campfire',
  },
};

/* ------------------------------------------------------------------ *
 *  Animals (MVP AI: passive / territorial wanderers)
 * ------------------------------------------------------------------ */

export const ANIMALS = {
  deer: {
    label: 'Rådjur', labelEn: 'Deer', hp: 45, speed: 5.6, fleeSpeed: 8.2, radius: 0.6, height: 1.5,
    damage: 0, aggro: 0, drops: [{ item: 'meat_raw', n: 3 }, { item: 'hide', n: 1 }],
    spawn: { perChunk: 0.5, max: 40 }, color: '#a9793f',
  },
  boar: {
    label: 'Vildsvin', labelEn: 'Boar', hp: 80, speed: 3.2, fleeSpeed: 4.2, radius: 0.7, height: 1.0,
    damage: 14, aggro: 12, attackCooldown: 1.5, drops: [{ item: 'meat_raw', n: 4 }, { item: 'hide', n: 2 }],
    spawn: { perChunk: 0.7, max: 60 }, color: '#5d4a3a',
  },
};

/* ------------------------------------------------------------------ *
 *  Combat
 * ------------------------------------------------------------------ */

export const COMBAT = {
  reach: 3.4,
  coneCos: 0.55, // dot(yawDir, toTarget) > this counts as a hit
  cooldown: 0.55,
  verticalReach: 2.4,
};

/* ------------------------------------------------------------------ *
 *  Helpers used by both sides
 * ------------------------------------------------------------------ */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Build grid cell centre -> world position. */
export const cellToWorld = (c) => c * WORLD.grid;

/**
 * World position of a building piece. Flat pieces (foundation, campfire) fill
 * the cell; walls/doors snap to one of the four cell edges (rot 0=N,1=E,2=S,3=W).
 * Shared by the server world and the client's prediction collider.
 */
export function piecePosition(cx, cz, rot, piece) {
  const def = PIECES[piece];
  const g = WORLD.grid;
  let ox = 0;
  let oz = 0;
  if (!def?.flat) {
    if (rot === 0) oz = -g / 2;
    else if (rot === 1) ox = g / 2;
    else if (rot === 2) oz = g / 2;
    else ox = -g / 2;
  }
  return { x: cx * g + ox, z: cz * g + oz };
}

/** Axis-aligned collision box for a building piece, in world space. */
export function buildingAABB(b) {
  const def = PIECES[b.piece];
  if (!def || !def.solid) return null;
  if (def.openable && b.open) return null;
  const pos = piecePosition(b.cx, b.cz, b.rot, b.piece);
  const rotated = b.rot % 2 === 1;
  const halfX = (rotated ? def.size[2] : def.size[0]) / 2;
  const halfZ = (rotated ? def.size[0] : def.size[2]) / 2;
  return {
    id: b.id,
    piece: b.piece,
    minX: pos.x - halfX, maxX: pos.x + halfX,
    minY: b.y, maxY: b.y + def.size[1],
    minZ: pos.z - halfZ, maxZ: pos.z + halfZ,
  };
}

/**
 * Stable per-player colour, derived from the id.
 *
 * It used to be `hsl(${(id * 47) % 360} ...)` - but ids are strings
 * ("color-a" * 47 === NaN), so every player was drawn as `hsl(NaN 62% 55%)`.
 */
export function playerColor(id) {
  let h = 0;
  for (const ch of String(id ?? 'x')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 62% 55%)`;
}

export function itemName(key, lang = 'sv') {
  const it = ITEMS[key];
  if (!it) return key;
  return lang === 'sv' ? it.name : it.nameEn;
}

/** Total stack weight/count of an inventory (array of {item, n, dur?}). */
export function countItem(inv, item) {
  let n = 0;
  for (const s of inv) if (s && s.item === item) n += s.n;
  return n;
}

export function canAfford(inv, need) {
  for (const [item, n] of Object.entries(need)) if (countItem(inv, item) < n) return false;
  return true;
}

export function consume(inv, need) {
  for (const [item, n] of Object.entries(need)) {
    let left = n;
    for (const s of inv) {
      if (!s || s.item !== item || left <= 0) continue;
      const take = Math.min(s.n, left);
      s.n -= take;
      left -= take;
    }
  }
  for (let i = inv.length - 1; i >= 0; i--) if (inv[i] && inv[i].n <= 0) inv[i] = null;
  return inv;
}

/** Add item(s) to an inventory array (fixed length, nulls are empty slots). */
export function giveItem(inv, item, n, dur) {
  const def = ITEMS[item] || {};
  const stack = def.stack || 1;
  let left = n;
  for (let i = 0; i < inv.length && left > 0; i++) {
    const s = inv[i];
    if (s && s.item === item && stack > 1 && s.n < stack) {
      const add = Math.min(stack - s.n, left);
      s.n += add;
      left -= add;
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (!inv[i]) {
      const add = Math.min(stack, left);
      inv[i] = { item, n: add };
      if (dur !== undefined) inv[i].dur = dur;
      left -= add;
    }
  }
  return left; // leftover that did not fit
}
