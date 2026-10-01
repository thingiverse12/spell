/**
 * Spell - shared player physics (movement + collision).
 *
 * This module is imported by the browser client (for client-side prediction)
 * and by the server (for authoritative simulation). They MUST stay identical:
 * any difference shows up as rubber-banding. The `world` object only has to
 * provide two things:
 *
 *    world.seed                       - terrain seed
 *    world.buildingAABBs(x, z, r)     - solid building boxes near a point
 */

import { PHYS, SURVIVAL, WORLD, clamp } from './config.js';
import { sampleHeight } from './noise.js';

/** Solid building AABB blocking a capsule at (x, y, z). */
export function solidAt(world, x, y, z, radius, height) {
  const boxes = world.buildingAABBs(x, z, radius + 0.35);
  for (const b of boxes) {
    if (y + height <= b.minY || y >= b.maxY) continue;
    if (x + radius <= b.minX || x - radius >= b.maxX) continue;
    if (z + radius <= b.minZ || z - radius >= b.maxZ) continue;
    return b;
  }
  return null;
}

/** Horizontal movement with terrain + building collision and step-up. */
export function moveHorizontal(p, dx, dz, world) {
  const h = p.crouch ? PHYS.crouchHeight : PHYS.height;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / 0.35));
  const sx = dx / steps;
  const sz = dz / steps;
  let ground = sampleHeight(p.x, p.z, world.seed);

  for (let i = 0; i < steps; i++) {
    for (const axis of ['x', 'z']) {
      const nx = axis === 'x' ? p.x + sx : p.x;
      const nz = axis === 'z' ? p.z + sz : p.z;
      if (nx < -WORLD.half || nx > WORLD.half || nz < -WORLD.half || nz > WORLD.half) continue;

      const nh = sampleHeight(nx, nz, world.seed);
      const rise = nh - ground;
      const deepWater = nh < WORLD.seaLevel - PHYS.swimWaterDepth * 0.35;
      if (!deepWater && rise > PHYS.stepHeight) continue;     // cliff, blocked
      if (deepWater && nh < WORLD.seaLevel - 4) continue;     // ocean floor, blocked

      const box = solidAt(world, nx, p.y, nz, PHYS.radius, h);
      if (box) {
        const stepY = box.maxY;
        if (stepY - p.y <= PHYS.stepHeight && !solidAt(world, nx, stepY + 0.02, nz, PHYS.radius, h)) {
          p.y = stepY + 0.02; // step up onto a foundation
        } else {
          continue;
        }
      }
      if (axis === 'x') p.x = nx; else p.z = nz;
      ground = sampleHeight(p.x, p.z, world.seed);
    }
  }
  return ground;
}

/** Vertical movement, resolves ground and landing. Returns true when grounded. */
export function moveVertical(p, dy, world) {
  const h = p.crouch ? PHYS.crouchHeight : PHYS.height;
  const steps = Math.max(1, Math.ceil(Math.abs(dy) / 0.35));
  const s = dy / steps;
  let onGround = false;
  for (let i = 0; i < steps; i++) {
    const ny = p.y + s;
    const ground = sampleHeight(p.x, p.z, world.seed);
    if (ny <= ground) { p.y = ground; p.vy = 0; onGround = true; break; }
    const box = solidAt(world, p.x, ny, p.z, PHYS.radius, h);
    if (box) {
      if (s < 0) { p.y = box.maxY; p.vy = 0; onGround = true; } else { p.vy = 0; }
      break;
    }
    p.y = ny;
  }
  return onGround;
}

/**
 * One movement step. `p` is mutated. Returns { fallImpact } so the caller can
 * turn a hard landing into damage (server) or a camera effect (client).
 */
export function stepMovement(world, p, input, dt) {
  const ground = sampleHeight(p.x, p.z, world.seed);
  const waterDepth = WORLD.seaLevel - Math.max(ground, p.y);
  p.inWater = waterDepth > 0.4;
  p.swimming = waterDepth > PHYS.swimWaterDepth;

  const wish = clamp(input.wish || 0, -1, 1);
  const strafe = clamp(input.strafe || 0, -1, 1);
  const mag = Math.min(1, Math.hypot(wish, strafe));
  p.crouch = !!input.crouch && !p.swimming;
  const sprint = !!input.sprint && (p.stamina ?? 100) > 3 && wish > 0.1 && !p.crouch && !p.swimming;
  p.sprinting = sprint;

  const speed = p.swimming ? PHYS.swimSpeed
    : p.crouch ? PHYS.crouchSpeed
      : sprint ? PHYS.sprintSpeed : PHYS.walkSpeed;

  const yaw = input.yaw;
  let dirX = Math.sin(yaw) * wish + Math.cos(yaw) * strafe;
  let dirZ = Math.cos(yaw) * wish - Math.sin(yaw) * strafe;
  const len = Math.hypot(dirX, dirZ);
  if (len > 1e-4) { dirX /= len; dirZ /= len; }

  const accel = p.onGround ? PHYS.accel : PHYS.airAccel;
  const k = 1 - Math.exp(-accel * dt);
  p.vx += (dirX * mag * speed - p.vx) * k;
  p.vz += (dirZ * mag * speed - p.vz) * k;
  if (p.swimming) { p.vx *= PHYS.waterDrag; p.vz *= PHYS.waterDrag; }

  const wasOnGround = p.onGround;
  moveHorizontal(p, p.vx * dt, p.vz * dt, world);

  if (p.swimming) {
    p.vy += PHYS.gravity * 0.22 * dt;
    if (input.jump) p.vy = Math.min(p.vy + 9 * dt, 3.2);
    p.vy *= 0.9;
  } else {
    if (input.jump && p.onGround && (p.stamina ?? 100) > 2) {
      p.vy = PHYS.jumpSpeed;
      p.stamina = clamp(p.stamina - SURVIVAL.jumpStamina, 0, SURVIVAL.maxStamina);
      p.staminaDelay = SURVIVAL.staminaRegenDelay;
      p.onGround = false;
    }
    p.vy = Math.max(PHYS.maxFall, p.vy + PHYS.gravity * dt);
  }

  const impactSpeed = p.vy;
  p.onGround = moveVertical(p, p.vy * dt, world);

  if (sprint && mag > 0.1 && p.onGround) {
    p.stamina = clamp((p.stamina ?? 100) - SURVIVAL.sprintStamina * dt, 0, SURVIVAL.maxStamina);
    p.staminaDelay = SURVIVAL.staminaRegenDelay;
  }
  p.staminaDelay = Math.max(0, (p.staminaDelay || 0) - dt);
  if (p.staminaDelay <= 0) {
    p.stamina = clamp((p.stamina ?? 100) + SURVIVAL.staminaRegen * dt, 0, SURVIVAL.maxStamina);
  }

  p.x = clamp(p.x, -WORLD.half + 1, WORLD.half - 1);
  p.z = clamp(p.z, -WORLD.half + 1, WORLD.half - 1);

  let fallImpact = 0;
  if (!wasOnGround && p.onGround && Math.abs(impactSpeed) > Math.abs(PHYS.safeFallSpeed)) {
    fallImpact = Math.abs(impactSpeed) - Math.abs(PHYS.safeFallSpeed);
  }
  p.yaw = input.yaw;
  p.pitch = input.pitch;
  return { fallImpact };
}
