/**
 * Spell - camera and look math.
 *
 * This module is deliberately free of DOM and three.js so it can be unit
 * tested in Node (see test/camera.js). It owns the rules that keep the camera
 * sane, all of which were broken at some point during development:
 *
 *   1. pitch is clamped just short of straight up/down, so the up-vector can
 *      never flip (a flipped camera is unfixable by the player)
 *   2. roll is always exactly 0 - "up" on screen is always up in the world
 *   3. a look delta can never be huge (the first mousemove of a drag used to
 *      compare against an unset position and snap the camera to the ceiling)
 *   4. non-finite numbers are rejected instead of poisoning rotation with NaN
 *      (NaN makes the whole scene disappear and stays until a reload)
 */

/** ~89.0 degrees. Below pi/2 on purpose: at exactly pi/2 the up-vector flips. */
export const PITCH_LIMIT = 1.5533;

/** Radians of rotation per pixel of mouse movement, at sensitivity 1.0. */
export const LOOK_SCALE = 0.0022;

/** Must match the default in client/src/settings.js (used when a value is bogus). */
export const DEFAULT_SENSITIVITY = 1.6;

/** Larger single-event deltas than this are treated as a glitch, not a flick. */
export const MAX_LOOK_DELTA = 180;

/** A press shorter/shorter-moving than this counts as a click, not a drag. */
export const TAP_MAX_MS = 260;
export const TAP_MAX_PX = 6;

export function clampPitch(pitch) {
  if (!Number.isFinite(pitch)) return 0;
  if (pitch > PITCH_LIMIT) return PITCH_LIMIT;
  if (pitch < -PITCH_LIMIT) return -PITCH_LIMIT;
  return pitch;
}

/**
 * Apply a look delta to a {yaw, pitch} pair.
 * Screen convention: mouse up = look up, mouse down = look down.
 */
export function applyLook(look, dx, dy, { sensitivity = 1.6, invertY = false } = {}) {
  const scale = LOOK_SCALE
    * (Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : DEFAULT_SENSITIVITY);
  if (Number.isFinite(dx)) look.yaw -= dx * scale;
  if (Number.isFinite(dy)) look.pitch = clampPitch(look.pitch - dy * scale * (invertY ? -1 : 1));

  if (!Number.isFinite(look.yaw)) look.yaw = 0;
  if (!Number.isFinite(look.pitch)) look.pitch = 0;
  look.pitch = clampPitch(look.pitch);
  // keep yaw bounded so it cannot lose precision after hours of spinning
  if (look.yaw > Math.PI) look.yaw -= Math.PI * 2;
  if (look.yaw < -Math.PI) look.yaw += Math.PI * 2;
  return look;
}

/* ------------------------------------------------------------------ *
 *  Drag-look bookkeeping (used when pointer lock is not available,
 *  e.g. inside an embedded preview iframe)
 * ------------------------------------------------------------------ */

/** Remember where the drag started. Without this the first move is huge. */
export function anchorDrag(state, x, y) {
  state.lastX = Number.isFinite(x) ? x : 0;
  state.lastY = Number.isFinite(y) ? y : 0;
  state.hasAnchor = true;
}

/**
 * Delta since the last move, with two protections:
 *   - if there is no anchor yet, it anchors and returns 0 (no jump)
 *   - absurd jumps (pointer re-entering the window, synthetic events) are clamped
 */
export function dragDelta(state, x, y, maxDelta = MAX_LOOK_DELTA) {
  if (!state.hasAnchor) {
    anchorDrag(state, x, y);
    return { dx: 0, dy: 0 };
  }
  let dx = x - state.lastX;
  let dy = y - state.lastY;
  anchorDrag(state, x, y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { dx: 0, dy: 0 };
  dx = Math.max(-maxDelta, Math.min(maxDelta, dx));
  dy = Math.max(-maxDelta, Math.min(maxDelta, dy));
  return { dx, dy };
}

/** Was this press a click (act) or a drag (look)? */
export function isTap(press, now, x, y) {
  if (!press) return false;
  const ms = now - press.at;
  const dist = Math.hypot(x - press.x, y - press.y);
  return ms <= TAP_MAX_MS && dist <= TAP_MAX_PX;
}

/* ------------------------------------------------------------------ *
 *  Camera pose
 * ------------------------------------------------------------------ */

/**
 * Where the camera should be this frame.
 *
 * `you` is the predicted player state, `ground` the *rendered* surface height
 * under the player. The eye is smoothed toward its target so stepping up a
 * ledge is not a jolt, but it is hard-clamped at 0.25 m above the surface:
 * the camera must never end up inside the terrain, whatever happens.
 */
export function computeCameraPose({ you, ground, eyeHeight: eye, dt, currentY, smoothing = 22 }) {
  const target = Math.max(you.y, Number.isFinite(ground) ? ground : you.y) + eye;
  const k = 1 - Math.exp(-smoothing * Math.max(0, Math.min(0.25, dt)));
  let y = Number.isFinite(currentY) ? currentY + (target - currentY) * k : target;
  if (!Number.isFinite(y)) y = target;
  const floor = (Number.isFinite(ground) ? ground : you.y) + 0.25;
  if (y < floor) y = floor;
  return {
    x: you.x,
    y,
    z: you.z,
    yaw: Number.isFinite(you.yaw) ? you.yaw : 0,
    pitch: clampPitch(you.pitch),
    roll: 0, // never, ever roll: that is what makes a view feel upside down
  };
}

/**
 * Runtime self-check. Returns a list of human readable problems; the client
 * reports them and repairs the camera instead of showing a broken world.
 */
export function checkCamera({ position, rotation, fov }) {
  const problems = [];
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
    problems.push('position innehåller NaN/Infinity');
  }
  if (!Number.isFinite(rotation.x) || !Number.isFinite(rotation.y)) {
    problems.push('rotation innehåller NaN/Infinity');
  }
  if (Math.abs(rotation.z) > 1e-6) problems.push(`lutning (roll) är ${rotation.z.toFixed(4)} rad, ska vara 0`);
  if (Math.abs(rotation.x) > PITCH_LIMIT + 1e-6) {
    problems.push(`pitch ${rotation.x.toFixed(3)} utanför gränsen ±${PITCH_LIMIT}`);
  }
  if (!Number.isFinite(fov) || fov < 30 || fov > 130) problems.push(`synfält ${fov} är orimligt`);
  return problems;
}
