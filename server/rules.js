/**
 * Spell - authoritative gameplay rules.
 *
 * This module runs on the SERVER ONLY and is the single source of truth. The
 * client predicts movement with the same maths (client/src/predict.js mirrors
 * stepPlayer), but every consequence - loot, damage, crafting, building - is
 * decided here and replicated back. Nothing the client sends is trusted.
 */

import {
  PHYS, SURVIVAL, COMBAT, NODES, ANIMALS, ITEMS, PIECES, BUILD, RECIPES, WORLD,
  clamp, giveItem, consume, canAfford, countItem,
} from '../shared/config.js';
import { sampleHeight, slopeAt } from '../shared/noise.js';
import { solidAt, moveHorizontal, moveVertical, stepMovement } from '../shared/physics.js';

const FIST_DAMAGE = 8;

export { solidAt, moveHorizontal, moveVertical };

export function stepPlayer(world, p, input, dt) {
  const { fallImpact } = stepMovement(world, p, input, dt);
  if (fallImpact > 0) {
    const dmg = fallImpact * PHYS.fallDamagePerMs;
    if (dmg > 1) damage(world, p, dmg, 'fall');
  }
  updateSurvival(world, p, dt, { sprinting: p.sprinting });
  return p;
}

/* ------------------------------------------------------------------ *
 *  Survival stats
 * ------------------------------------------------------------------ */

export function updateSurvival(world, p, dt, { sprinting } = {}) {
  p.hunger = clamp(p.hunger - SURVIVAL.hungerDrain * dt * (sprinting ? 1.6 : 1), 0, SURVIVAL.maxHunger);
  p.thirst = clamp(p.thirst - SURVIVAL.thirstDrain * dt * (sprinting ? 1.6 : 1), 0, SURVIVAL.maxThirst);

  if (p.hunger <= 0) damage(world, p, SURVIVAL.starveDamage * dt, 'starve');
  if (p.thirst <= 0) damage(world, p, SURVIVAL.dehydrateDamage * dt, 'thirst');

  if (p.hunger > SURVIVAL.healMinHunger && p.thirst > SURVIVAL.healMinThirst && p.health < SURVIVAL.maxHealth) {
    p.health = clamp(p.health + SURVIVAL.healRate * dt, 0, SURVIVAL.maxHealth);
  }

  const eye = p.y + (p.crouch ? PHYS.crouchEyeHeight : PHYS.eyeHeight);
  if (eye < WORLD.seaLevel - 0.2) {
    p.breath = clamp(p.breath - (SURVIVAL.maxBreath / SURVIVAL.respirationSeconds) * dt, 0, SURVIVAL.maxBreath);
    if (p.breath <= 0) damage(world, p, SURVIVAL.drownDamage * dt, 'drown');
  } else {
    p.breath = clamp(p.breath + 30 * dt, 0, SURVIVAL.maxBreath);
  }

  // night chill unless you are near a fire
  const night = world.time01 > 0.75 || world.time01 < 0.22;
  const warm = world.nearbyBuildings(p.x, p.z, 9).some((b) => PIECES[b.piece]?.light);
  if (night && !warm) damage(world, p, SURVIVAL.coldDamage * dt * 0.5, 'cold');

  // Base upkeep: being near your own structure refreshes its decay timer.
  const now = Date.now();
  for (const b of world.nearbyBuildings(p.x, p.z, 12)) {
    if (b.owner === p.id && b.decayAt < now + BUILD.decayAfterSec * 900) {
      b.decayAt = now + BUILD.decayAfterSec * 1000;
      world.dirty = true;
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Damage / death / respawn
 * ------------------------------------------------------------------ */

export function damage(world, p, amount, cause = 'unknown', attacker = null) {
  if (p.health <= 0) return false;
  p.health = clamp(p.health - amount, 0, SURVIVAL.maxHealth);
  p.lastDamage = { cause, at: Date.now(), attacker: attacker?.id || null, amount };
  if (p.health <= 0) {
    p.deaths = (p.deaths || 0) + 1;
    world.dirty = true;
    return true;
  }
  return false;
}

export function respawn(world, p) {
  const spot = world.findSpawn(p.spawn ? { x: p.spawn.x, z: p.spawn.z } : null);
  p.x = spot.x; p.y = spot.y + 0.3; p.z = spot.z;
  p.vx = p.vy = p.vz = 0;
  p.health = SURVIVAL.maxHealth;
  p.hunger = Math.max(40, p.hunger);
  p.thirst = Math.max(40, p.thirst);
  p.stamina = SURVIVAL.maxStamina;
  p.breath = SURVIVAL.maxBreath;
  world.dirty = true;
  return p;
}

/* ------------------------------------------------------------------ *
 *  Tools
 * ------------------------------------------------------------------ */

export function selectedTool(p) {
  const slot = p.inv[p.toolSlot];
  if (slot && slot.n > 0 && (ITEMS[slot.item]?.tool || ITEMS[slot.item]?.kind === 'weapon')) return slot;
  return null;
}

export function damageFor(p, nodeType) {
  const tool = selectedTool(p);
  if (!tool) return { dmg: FIST_DAMAGE, tool: null };
  const def = ITEMS[tool.item];
  return { dmg: def.tool?.[nodeType] ?? FIST_DAMAGE, tool };
}

/* ------------------------------------------------------------------ *
 *  Harvesting
 * ------------------------------------------------------------------ */

export function harvest(world, p, nodeId, now) {
  if (p.cooldownUntil && now < p.cooldownUntil) return null;
  const node = world.nodes.get(nodeId);
  if (!node || node.dead) return { ok: false, error: 'gone' };
  const def = NODES[node.type];
  const dist = Math.hypot(node.x - p.x, node.z - p.z);
  if (dist > COMBAT.reach + def.radius) return { ok: false, error: 'too-far' };
  if (Math.abs(node.y - p.y) > COMBAT.verticalReach) return { ok: false, error: 'too-far' };

  p.cooldownUntil = now + COMBAT.cooldown * 1000;
  const { dmg, tool } = damageFor(p, node.type);
  node.hp -= dmg;
  node.v = (node.v || 0) + 1;

  // yield scales with tool quality: hands ~1/smack, a stone axe the full rate
  const amount = Math.max(1, Math.round(def.yields.perHit * (0.35 + 0.65 * Math.min(1.4, dmg / 26))));
  const left = giveItem(p.inv, def.yields.item, amount);
  let gained = { item: def.yields.item, n: amount - left };
  if (def.yields.bonus && Math.random() < def.yields.bonusChance) {
    const bl = giveItem(p.inv, def.yields.bonus, 1);
    if (bl === 0) gained = { item: def.yields.item, n: gained.n, bonus: def.yields.bonus };
  }

  if (tool) {
    tool.dur = (tool.dur ?? ITEMS[tool.item].durability) - 1;
    if (tool.dur <= 0) {
      const slot = p.inv.indexOf(tool);
      if (slot >= 0) p.inv[slot] = null;
      if (p.toolSlot === slot) p.toolSlot = -1;
    }
  }

  let depleted = false;
  if (node.hp <= 0) {
    node.hp = 0;
    node.dead = true;
    node.respawnAt = now + def.respawnSec * 1000;
    depleted = true;
    // fell-the-tree bonus
    const bonus = node.type === 'tree' ? 4 : node.type === 'rock' ? 3 : 2;
    const bl = giveItem(p.inv, def.yields.item, bonus);
    gained.n += bonus - bl;
    world.dirty = true;
  }
  if (gained.n > 0) world.dirty = true;
  return {
    ok: true, nodeId, nodeType: node.type, dmg, depleted, gained,
    sound: def.sound, durability: tool ? tool.dur : null,
  };
}

/* ------------------------------------------------------------------ *
 *  Melee (animals + PvP)
 * ------------------------------------------------------------------ */

export function melee(world, p, now) {
  if (p.cooldownUntil && now < p.cooldownUntil) return null;
  p.cooldownUntil = now + COMBAT.cooldown * 1000;
  const { dmg: base } = damageFor(p, 'animal');
  const dirX = Math.sin(p.yaw);
  const dirZ = Math.cos(p.yaw);

  let best = null;
  let bestDist = Infinity;
  for (const a of world.nearbyAnimals(p.x, p.z, COMBAT.reach + 1.2)) {
    const dx = a.x - p.x;
    const dz = a.z - p.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    if ((dx / dist) * dirX + (dz / dist) * dirZ < COMBAT.coneCos) continue;
    if (Math.abs(a.y - p.y) > COMBAT.verticalReach) continue;
    if (dist < bestDist) { bestDist = dist; best = { kind: 'animal', ref: a }; }
  }
  for (const other of world.players.values()) {
    if (other.id === p.id || other.offline || other.health <= 0) continue;
    const dx = other.x - p.x;
    const dz = other.z - p.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    if (dist > COMBAT.reach) continue;
    if ((dx / dist) * dirX + (dz / dist) * dirZ < COMBAT.coneCos) continue;
    if (Math.abs(other.y - p.y) > COMBAT.verticalReach) continue;
    if (dist < bestDist) { bestDist = dist; best = { kind: 'player', ref: other }; }
  }
  if (!best) return { ok: true, hit: false, sound: 'swing' };

  if (best.kind === 'animal') {
    const a = best.ref;
    const def = ANIMALS[a.type];
    a.hp -= base;
    a.state = 'flee';
    a.timer = 3;
    if (a.hp <= 0) {
      a.dead = true;
      a.respawnAt = now + 180 * 1000;
      p.killsAnimal = (p.killsAnimal || 0) + 1;
      const drops = [];
      for (const d of def.drops) {
        const left = giveItem(p.inv, d.item, d.n);
        if (d.n - left > 0) drops.push({ item: d.item, n: d.n - left });
      }
      world.dirty = true;
      return { ok: true, hit: true, killed: true, animalId: a.id, animalType: a.type, dmg: base, drops };
    }
    return { ok: true, hit: true, animalId: a.id, animalType: a.type, dmg: base, animalHp: a.hp };
  }

  const other = best.ref;
  const died = damage(world, other, base, 'melee', p);
  if (died) {
    p.kills = (p.kills || 0) + 1;
    const dropped = [];
    for (let i = 0; i < other.inv.length; i++) {
      const s = other.inv[i];
      if (!s) continue;
      const kind = ITEMS[s.item]?.kind;
      if (kind === 'resource' || kind === 'food') {
        const n = Math.floor(s.n * 0.5);
        if (n > 0) {
          giveItem(p.inv, s.item, n);
          dropped.push({ item: s.item, n });
          s.n -= n;
          if (s.n <= 0) other.inv[i] = null;
        }
      } else if (s.n === 1) {
        other.inv[i] = null; // lose the equipped tool on death
      }
    }
    world.dirty = true;
    return { ok: true, hit: true, killedPlayer: other.id, victim: other.name, dmg: base, dropped };
  }
  return { ok: true, hit: true, targetPlayer: other.id, victim: other.name, dmg: base, targetHealth: other.health };
}

/* ------------------------------------------------------------------ *
 *  Crafting
 * ------------------------------------------------------------------ */

export function craft(world, p, recipeId) {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return { ok: false, error: 'unknown-recipe' };
  if (!canAfford(p.inv, recipe.need)) return { ok: false, error: 'missing-materials', need: recipe.need };
  if (recipe.station) {
    const ok = world.nearbyBuildings(p.x, p.z, 6).some((b) => PIECES[b.piece]?.station === recipe.station);
    if (!ok) return { ok: false, error: 'needs-station', station: recipe.station };
  }
  consume(p.inv, recipe.need);
  for (const [item, n] of Object.entries(recipe.out)) {
    const left = giveItem(p.inv, item, n, ITEMS[item]?.durability);
    if (left > 0) return { ok: false, error: 'inventory-full' };
  }
  world.dirty = true;
  return { ok: true, recipe: recipe.id, out: recipe.out };
}

/* ------------------------------------------------------------------ *
 *  Building
 *
 *  Pieces snap to the 4 m terrain grid. "Flat" pieces (foundation, campfire)
 *  fill a cell; walls/doors snap to one of the four cell edges (rotation 0-3).
 * ------------------------------------------------------------------ */

export function placeBuilding(world, p, pieceId, cx, cz, rot) {
  const def = PIECES[pieceId];
  if (!def) return { ok: false, error: 'unknown-piece' };
  if (!Number.isInteger(cx) || !Number.isInteger(cz)) return { ok: false, error: 'bad-cell' };
  if (Math.abs(cx * WORLD.grid) > WORLD.half - 2 || Math.abs(cz * WORLD.grid) > WORLD.half - 2) {
    return { ok: false, error: 'outside-world' };
  }
  const r = def.rotates ? (((rot | 0) % 4) + 4) % 4 : 0;
  const { x: wx, z: wz } = world.piecePosition(cx, cz, r, pieceId);
  if (Math.hypot(wx - p.x, wz - p.z) > BUILD.reach) return { ok: false, error: 'too-far' };
  if (countItem(p.inv, def.item) < 1) return { ok: false, error: 'missing-piece' };

  const existing = world.pieceAt(cx, cz, def.flat ? 0 : r, pieceId, def.flat);
  if (def.flat) {
    const occupied = world.piecesInCell(cx, cz).some((b) => PIECES[b.piece]?.flat && !(b.piece === 'campfire' && pieceId !== 'campfire'));
    if (occupied) return { ok: false, error: 'occupied' };
  } else if (existing) {
    return { ok: false, error: 'occupied' };
  }

  const terrainY = sampleHeight(wx, wz, world.seed);
  const slope = slopeAt(wx, wz, world.seed);
  let y;
  if (def.flat) {
    if (terrainY < WORLD.seaLevel + 0.25) return { ok: false, error: 'in-water' };
    if (slope > BUILD.maxSlope) return { ok: false, error: 'uneven-ground' };
    y = terrainY;
  } else {
    const support = world.supportHeight(cx, cz, r);
    if (support !== null) {
      y = support;
    } else {
      if (slope > 0.45) return { ok: false, error: 'needs-foundation' };
      y = terrainY;
    }
  }

  consume(p.inv, { [def.item]: 1 });
  const id = `b${world.nextBuildingId++}`;
  const building = {
    id, piece: pieceId, cx, cz, rot: r, y,
    owner: p.id, ownerName: p.name,
    hp: def.hp,
    createdAt: Date.now(),
    decayAt: Date.now() + BUILD.decayAfterSec * 1000,
    open: false,
    v: 0,
  };
  world.addBuilding(building);
  world.dirty = true;
  return { ok: true, building };
}

export function toggleDoor(world, p, buildingId) {
  const b = world.buildings.get(buildingId);
  if (!b) return { ok: false, error: 'not-found' };
  if (!PIECES[b.piece]?.openable) return { ok: false, error: 'not-openable' };
  const { x, z } = world.piecePosition(b.cx, b.cz, b.rot, b.piece);
  if (Math.hypot(x - p.x, z - p.z) > BUILD.reach) return { ok: false, error: 'too-far' };
  b.open = !b.open;
  b.v = (b.v || 0) + 1;
  world.dirty = true;
  return { ok: true, building: b };
}

export function demolishBuilding(world, p, buildingId) {
  const b = world.buildings.get(buildingId);
  if (!b) return { ok: false, error: 'not-found' };
  const { x, z } = world.piecePosition(b.cx, b.cz, b.rot, b.piece);
  if (Math.hypot(x - p.x, z - p.z) > BUILD.reach) return { ok: false, error: 'too-far' };
  world.removeBuilding(b.id);
  const refund = {};
  const recipe = RECIPES.find((rec) => rec.id === PIECES[b.piece]?.item);
  for (const [item, n] of Object.entries(recipe?.need || {})) {
    const back = Math.floor(n * BUILD.reuse);
    if (back > 0) { giveItem(p.inv, item, back); refund[item] = back; }
  }
  world.dirty = true;
  return { ok: true, refund, demolished: b.id };
}

/* ------------------------------------------------------------------ *
 *  Items / inventory
 * ------------------------------------------------------------------ */

export function consumeSlot(world, p, slotIndex) {
  const slot = p.inv[slotIndex];
  if (!slot) return { ok: false, error: 'empty' };
  const def = ITEMS[slot.item];
  if (!def) return { ok: false, error: 'unknown-item' };

  if (def.kind === 'food') {
    p.hunger = clamp(p.hunger + (def.food.hunger || 0), 0, SURVIVAL.maxHunger);
    p.thirst = clamp(p.thirst + (def.food.thirst || 0), 0, SURVIVAL.maxThirst);
    p.health = clamp(p.health + (def.food.heal || 0), 1, SURVIVAL.maxHealth);
    slot.n -= 1;
    if (slot.n <= 0) p.inv[slotIndex] = null;
    world.dirty = true;
    return { ok: true, consumed: slot.item, food: def.food };
  }
  if (def.kind === 'tool' || def.kind === 'weapon') {
    p.toolSlot = slotIndex;
    return { ok: true, equipped: slot.item, toolSlot: slotIndex };
  }
  if (slot.item === 'berry') return { ok: false, error: 'not-usable' };
  return { ok: true, material: slot.item };
}

export function setToolSlot(world, p, slotIndex) {
  if (slotIndex < 0) { p.toolSlot = -1; return { ok: true, toolSlot: -1 }; }
  p.toolSlot = clamp(slotIndex | 0, 0, p.inv.length - 1);
  return { ok: true, toolSlot: p.toolSlot };
}

export function moveItem(world, p, from, to) {
  const inv = p.inv;
  if (from < 0 || to < 0 || from >= inv.length || to >= inv.length || from === to) {
    return { ok: false, error: 'bad-slot' };
  }
  const a = inv[from];
  const b = inv[to];
  if (!a) return { ok: false, error: 'empty' };
  const stack = ITEMS[a.item]?.stack || 1;
  if (b && b.item === a.item && stack > 1) {
    const space = stack - b.n;
    const amount = Math.min(a.n, space);
    b.n += amount;
    a.n -= amount;
    if (a.n <= 0) inv[from] = null;
  } else {
    inv[from] = b || null;
    inv[to] = a;
    if (p.toolSlot === from) p.toolSlot = to;
    else if (p.toolSlot === to) p.toolSlot = from;
  }
  world.dirty = true;
  return { ok: true, inv };
}

export function repair(world, p, slotIndex) {
  const slot = p.inv[slotIndex];
  if (!slot) return { ok: false, error: 'empty' };
  const def = ITEMS[slot.item];
  if (!def?.repair) return { ok: false, error: 'not-repairable' };
  const cur = slot.dur ?? def.durability;
  if (cur >= def.durability) return { ok: false, error: 'already-full' };
  if (!canAfford(p.inv, def.repair)) return { ok: false, error: 'missing-materials', need: def.repair };
  consume(p.inv, def.repair);
  slot.dur = def.durability;
  world.dirty = true;
  return { ok: true, repaired: slot.item, dur: slot.dur };
}
