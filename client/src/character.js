/**
 * Spell - the character check.
 *
 * Rule: "check for errors in the character too - there are several". The camera
 * has had a per-frame self-check since the view flipped; the player state needs
 * the same treatment, because a NaN that reaches `you` does not throw - it
 * quietly spreads into the camera, the HUD bars ("NaN %"), the map, the
 * prediction and finally the server.
 *
 * `checkCharacter(you, context)` is pure (no DOM, no three) and returns a list
 * of human-readable problems, empty when the character is healthy. `main.js`
 * runs it once a second, reports problems through the same error channel as
 * everything else (F3 + window.__spellErrors) and can repair the worst ones.
 *
 * What is checked:
 *   position    - finite, inside the world, not below the surface
 *   angles      - finite yaw, pitch inside the camera limit
 *   motion      - finite velocity, no impossible speed
 *   survival    - health/hunger/thirst/stamina/breath inside their ranges
 *   death       - the dead flag agrees with health
 *   inventory   - 12 slots, known items, whole positive counts, sane durability
 *   tool slot   - points at a real slot
 */

import { ITEMS, WORLD, PHYS, SURVIVAL, clamp } from '../../shared/config.js';
import { sampleHeight } from '../../shared/noise.js';
import { PITCH_LIMIT } from './camera.js';

/** Highest speed a healthy character can have (m/s) before something is wrong. */
export const MAX_SPEED = PHYS.sprintSpeed * 3;

/** 12 slots is what the server simulates; a different length breaks the HUD. */
export const INV_SIZE = 12;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {object} you      the locally predicted player (net.you)
 * @param {object} [ctx]    { seed, ground, invSize }
 * @returns {string[]}      problems, empty when the character is fine
 */
export function checkCharacter(you, ctx = {}) {
  const problems = [];
  if (!you || typeof you !== 'object') return ['spelaren saknas helt'];

  const push = (msg) => { if (!problems.includes(msg)) problems.push(msg); };

  // ---- position
  for (const axis of ['x', 'y', 'z']) {
    if (!finite(you[axis])) push(`position.${axis} är ${you[axis]} (ska vara ett tal)`);
  }
  if (finite(you.x) && finite(you.z)) {
    const half = WORLD.half + 1;
    if (Math.abs(you.x) > half || Math.abs(you.z) > half) {
      push(`positionen (${you.x.toFixed(0)}, ${you.z.toFixed(0)}) ligger utanför världen`);
    }
    const seed = ctx.seed ?? WORLD.seed;
    const ground = finite(ctx.ground) ? ctx.ground : (ctx.sampleHeight ?? ((x, z) => sampleHeight(x, z, seed)))(you.x, you.z);
    if (finite(you.y) && finite(ground) && you.y < ground - 0.05) {
      push(`karaktären är ${(ground - you.y).toFixed(2)} m under markytan`);
    }
  }

  // ---- angles
  if (!finite(you.yaw)) push(`yaw är ${you.yaw}`);
  if (!finite(you.pitch)) push(`pitch är ${you.pitch}`);
  else if (Math.abs(you.pitch) > PITCH_LIMIT + 1e-6) push(`pitch ${you.pitch.toFixed(3)} utanför kamerans gräns`);

  // ---- motion
  for (const axis of ['vx', 'vy', 'vz']) {
    if (you[axis] !== undefined && !finite(you[axis])) push(`hastighet ${axis} är ${you[axis]}`);
  }
  if (finite(you.vx) && finite(you.vz)) {
    const speed = Math.hypot(you.vx, you.vz);
    if (speed > MAX_SPEED) push(`orimlig hastighet ${speed.toFixed(1)} m/s (max ${MAX_SPEED.toFixed(1)})`);
  }

  // ---- survival stats
  const ranges = {
    health: [0, SURVIVAL.maxHealth],
    hunger: [0, SURVIVAL.maxHunger],
    thirst: [0, SURVIVAL.maxThirst],
    stamina: [0, SURVIVAL.maxStamina],
    breath: [0, SURVIVAL.maxBreath],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const v = you[key];
    if (v === undefined) continue;
    if (!finite(v)) push(`${key} är ${v}`);
    else if (v < min - 1e-6 || v > max + 1e-6) push(`${key} ${Number(v).toFixed(1)} ligger utanför ${min}-${max}`);
  }

  // ---- death flag
  if (finite(you.health) && you.dead !== undefined) {
    const shouldBeDead = you.health <= 0;
    if (Boolean(you.dead) !== shouldBeDead) {
      push(`död-flaggan (${you.dead}) stämmer inte med hälsan (${you.health.toFixed(0)})`);
    }
  }

  // ---- inventory
  const size = ctx.invSize ?? INV_SIZE;
  if (!Array.isArray(you.inv)) push('ryggsäcken är inte en lista');
  else {
    if (you.inv.length !== size) push(`ryggsäcken har ${you.inv.length} platser (ska vara ${size})`);
    you.inv.forEach((slot, i) => {
      if (slot === null || slot === undefined) return;
      if (typeof slot !== 'object') { push(`plats ${i + 1} är ${typeof slot}`); return; }
      if (!ITEMS[slot.item]) push(`plats ${i + 1} innehåller okänd resurs "${slot.item}"`);
      if (!finite(slot.n)) push(`plats ${i + 1} har antal ${slot.n}`);
      else if (slot.n <= 0) push(`plats ${i + 1} har antal ${slot.n} (ska städas bort)`);
      else if (slot.n % 1 !== 0) push(`plats ${i + 1} har delat antal ${slot.n}`);
      else {
        const stack = ITEMS[slot.item]?.stack;
        if (stack && slot.n > stack) push(`plats ${i + 1} har ${slot.n} ${slot.item} (max ${stack} per stack)`);
      }
      if (slot.dur !== undefined && (!finite(slot.dur) || slot.dur < 0)) push(`plats ${i + 1} har hållbarhet ${slot.dur}`);
    });
  }

  // ---- tool slot
  if (you.toolSlot !== undefined && you.toolSlot !== null) {
    const t = you.toolSlot;
    if (!Number.isInteger(t)) push(`verktygsplatsen är ${t} (ska vara ett heltal)`);
    else if (t < -1 || t >= (Array.isArray(you.inv) ? you.inv.length : size)) push(`verktygsplatsen ${t} finns inte`);
    // An empty selected slot is the ordinary bare-hands state; do not flag it.
  }

  return problems;
}

/**
 * Repair the parts of the character that can be repaired without guessing:
 * NaN positions snap back to the last known good spot, angles to 0, and a
 * broken inventory is replaced by empty slots (the server is the truth and will
 * send the real one again on the next snapshot).
 *
 * @returns {number} how many fields were repaired
 */
export function repairCharacter(you, lastGood = {}, ctx = {}) {
  if (!you) return 0;
  let repairs = 0;
  const size = ctx.invSize ?? INV_SIZE;

  for (const axis of ['x', 'z']) {
    if (!Number.isFinite(you[axis])) {
      you[axis] = Number.isFinite(lastGood[axis]) ? lastGood[axis] : 0;
      repairs++;
    }
  }
  const seed = ctx.seed ?? WORLD.seed;
  const ground = Number.isFinite(ctx.ground) ? ctx.ground : sampleHeight(you.x, you.z, seed);
  if (!Number.isFinite(you.y)) {
    const goodY = lastGood.y;
    you.y = Number.isFinite(goodY) && goodY >= ground - 0.05 ? goodY : ground;
    repairs++;
  } else if (Number.isFinite(ground) && you.y < ground - 0.05) {
    // Ground is a hard invariant for the character; lift locally and stop the fall.
    you.y = ground;
    if (Number.isFinite(you.vy)) you.vy = 0;
    repairs++;
  }
  if (!Number.isFinite(you.yaw)) { you.yaw = 0; repairs++; }
  else if (Math.abs(you.yaw) > Math.PI * 4) { you.yaw = Math.atan2(Math.sin(you.yaw), Math.cos(you.yaw)); repairs++; }
  if (!Number.isFinite(you.pitch)) { you.pitch = 0; repairs++; }
  else if (Math.abs(you.pitch) > PITCH_LIMIT) { you.pitch = clamp(you.pitch, -PITCH_LIMIT, PITCH_LIMIT); repairs++; }
  for (const key of ['vx', 'vy', 'vz']) {
    if (you[key] !== undefined && !Number.isFinite(you[key])) { you[key] = 0; repairs++; }
  }
  if (Number.isFinite(you.vx) && Number.isFinite(you.vz)) {
    const speed = Math.hypot(you.vx, you.vz);
    if (speed > MAX_SPEED) {
      const ratio = MAX_SPEED / speed;
      you.vx *= ratio;
      you.vz *= ratio;
      repairs++;
    }
  }
  if (!Array.isArray(you.inv) || you.inv.length !== size) { you.inv = new Array(size).fill(null); repairs++; }
  if (!Number.isInteger(you.toolSlot) || you.toolSlot < -1 || you.toolSlot >= you.inv.length) {
    you.toolSlot = -1;
    repairs++;
  }
  return repairs;
}

/** Short one-line summary for the debug overlay. */
export function describeCharacter(problems) {
  return problems.length ? problems.slice(0, 2).join('; ') : 'ok';
}

/** Clamp helper re-exported so tests and main.js agree on the ranges. */
export { clamp };
