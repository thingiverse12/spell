/**
 * Spell - client-side prediction & server reconciliation.
 *
 * Used by the browser client and by the headless test bots, so both behave
 * exactly like the real client:
 *
 *   - local world = seed + replicated buildings (collision) + animals
 *   - every input is applied locally at once  (zero-latency feel)
 *   - every snapshot from the server rewinds us to the authoritative state and
 *     replays the inputs the server has not acknowledged yet
 *   - remote players/animals are interpolated into the past (interpDelayMs)
 */

import { NET, WORLD, clamp, buildingAABB } from './config.js';
import { stepMovement } from './physics.js';

/** Minimal world object with the interface shared/physics.js expects. */
export class LocalWorld {
  constructor(seed) {
    this.seed = seed;
    this.buildings = new Map(); // id -> {x, z, ...} replicated building
    this._boxCache = new Map();
  }

  setBuildings(list) {
    this.buildings.clear();
    this._boxCache.clear();
    for (const b of list) this.buildings.set(b.id, b);
  }

  addBuilding(b) {
    this.buildings.set(b.id, b);
    this._boxCache.delete(b.id);
  }

  removeBuilding(id) {
    this.buildings.delete(id);
    this._boxCache.delete(id);
  }

  /** Buildings are stored already resolved to world space {x, z, rot, y, piece}. */
  buildingAABBs(x, z, radius = 2) {
    const out = [];
    for (const b of this.buildings.values()) {
      let box = this._boxCache.get(b.id);
      if (!box) {
        box = buildingAABB(b);
        this._boxCache.set(b.id, box);
      }
      if (!box) continue;
      if (x + radius < box.minX || x - radius > box.maxX) continue;
      if (z + radius < box.minZ || z - radius > box.maxZ) continue;
      out.push(box);
    }
    return out;
  }
}

/** Player state the prediction works on. */
export function createPlayerState(spawn, id = 'local') {
  return {
    id,
    x: spawn.x, y: spawn.y, z: spawn.z,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    crouch: false, onGround: true, inWater: false, swimming: false,
    stamina: 100, staminaDelay: 0,
    health: 100, hunger: 100, thirst: 100, breath: 100,
    inv: [], toolSlot: -1,
    seq: 0,
  };
}

/**
 * Predictor: keeps the input history needed for reconciliation.
 */
export class Predictor {
  constructor(world, state) {
    this.world = world;
    this.state = state;
    this.pending = []; // inputs not yet acknowledged by the server
    this.seq = 0;
    this.lastAck = 0;
    /** Correction applied by the last reconciliation (for debug overlays). */
    this.lastCorrection = 0;
    this.corrections = 0;
  }

  /** Apply an input locally, immediately, and remember it for replay. */
  applyInput(input) {
    this.seq = input.seq;
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    stepMovement(this.world, this.state, input, input.dt);
    return this.state;
  }

  /**
   * Server truth arrived. Snap to it (if it disagrees) and replay the inputs
   * the server has not processed yet.
   */
  reconcile(serverState, ack) {
    const s = this.state;
    const dx = serverState.x - s.x;
    const dy = serverState.y - s.y;
    const dz = serverState.z - s.z;
    const error = Math.hypot(dx, dy, dz);

    this.lastAck = Math.max(this.lastAck, ack);
    s.health = serverState.health;
    s.hunger = serverState.hunger;
    s.thirst = serverState.thirst;
    s.breath = serverState.breath;
    s.inv = serverState.inv;
    s.toolSlot = serverState.toolSlot;

    // Drop inputs the server already simulated.
    this.pending = this.pending.filter((i) => i.seq > this.lastAck);

    if (error > 0.02) {
      this.corrections++;
      this.lastCorrection = error;
      s.x = serverState.x;
      s.y = serverState.y;
      s.z = serverState.z;
      s.vx = serverState.vx;
      s.vy = serverState.vy;
      s.vz = serverState.vz;
      s.onGround = !!serverState.onGround;
      s.inWater = !!serverState.inWater;
    } else {
      this.lastCorrection = 0;
    }

    // Replay everything still in flight (usually 1-3 inputs).
    for (const input of this.pending) stepMovement(this.world, s, input, input.dt);

    // Authoritative stamina wins (it is drained by the server too).
    s.stamina = clamp(serverState.stamina, 0, 100);
    return error;
  }
}

/* ------------------------------------------------------------------ *
 *  Remote entity interpolation
 * ------------------------------------------------------------------ */

/**
 * Buffers snapshots and renders remote players `interpDelayMs` in the past.
 * This is what hides jitter and packet loss for other people's movement.
 */
export class Interpolator {
  constructor(delayMs = NET.interpDelayMs) {
    this.delay = delayMs;
    this.history = []; // [{at, players: Map, animals: Map}]
  }

  push(serverTimeMs, players, animals) {
    this.history.push({ at: serverTimeMs, players, animals });
    // keep ~1.5 s of history
    while (this.history.length > 2 && serverTimeMs - this.history[0].at > 1500) this.history.shift();
  }

  /** Returns interpolated entity maps at (now - delay). */
  sample(nowMs) {
    if (!this.history.length) return { players: new Map(), animals: new Map() };
    const target = nowMs - this.delay;
    let a = this.history[this.history.length - 1];
    let b = null;
    for (let i = this.history.length - 2; i >= 0; i--) {
      if (this.history[i].at <= target) { a = this.history[i]; b = this.history[i + 1]; break; }
    }
    if (!b) return { players: a.players, animals: a.animals };
    const span = b.at - a.at;
    const t = span > 0 ? clamp((target - a.at) / span, 0, 1) : 0;
    return { players: blendMap(a.players, b.players, t, blendPlayer), animals: blendMap(a.animals, b.animals, t, blendPlayer) };
  }
}

function blendMap(from, to, t, blend) {
  const out = new Map();
  for (const [id, e] of to) {
    const prev = from.get(id);
    out.set(id, prev ? blend(prev, e, t) : e);
  }
  return out;
}

function blendPlayer(a, b, t) {
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t;
  const y = a.y + (b.y - a.y) * t;
  let dyaw = b.yaw - a.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  return { ...b, x, y, z, prevX: a.x, prevY: a.y, prevZ: a.z, yaw: a.yaw + dyaw * t, speed: Math.hypot(x - a.x, z - a.z) / Math.max(0.001, (b.at || 0) - (a.at || 0)) };
}

/* ------------------------------------------------------------------ *
 *  Lag statistics (shown in the debug overlay)
 * ------------------------------------------------------------------ */

export class NetStats {
  constructor() {
    this.ping = 0;
    this.jitter = 0;
    this.packets = 0;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.pps = 0;
    this.snapshots = 0;
    this._pings = [];
    this._bytes = [];
    this._lastReset = performance.now();
    this._n = 0;
  }

  addPing(ms) {
    this._pings.push(ms);
    if (this._pings.length > 30) this._pings.shift();
    this.ping = this._pings.reduce((a, b) => a + b, 0) / this._pings.length;
    const mean = this.ping;
    this.jitter = Math.sqrt(this._pings.reduce((a, b) => a + (b - mean) ** 2, 0) / this._pings.length);
  }

  addBytes(inBytes, outBytes) {
    this.bytesIn += inBytes;
    this.bytesOut += outBytes;
    this._bytes.push(inBytes);
    if (this._bytes.length > 60) this._bytes.shift();
    this.snapshots++;
  }

  tick(now) {
    const elapsed = (now - this._lastReset) / 1000;
    if (elapsed >= 1) {
      this.pps = Math.round(this.snapshots / elapsed);
      this.snapshots = 0;
      this._lastReset = now;
      this._n++;
    }
  }

  get kbpsIn() {
    if (!this._bytes.length) return 0;
    const sum = this._bytes.slice(-20).reduce((a, b) => a + b, 0);
    return ((sum / Math.min(20, this._bytes.length)) * this.pps * 8 / 1000).toFixed(1);
  }
}

export { WORLD, NET };
