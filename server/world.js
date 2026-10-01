/**
 * Spell - authoritative world state.
 *
 * The server owns one `World` instance per game world (per seed). It holds the
 * simulation-relevant entities and persists deltas to disk, per the report's
 * recommendation to keep static terrain in files and dynamic state in storage:
 *
 *   terrain      -> generated from the seed (never stored)
 *   resource nodes -> stored only as "dead until <timestamp>"
 *   buildings    -> stored (they must survive a crash)
 *   players      -> stored (inventory, stats, position)
 *
 * Streaming: nodes are materialised lazily per 64 m chunk around the players
 * (interest management), which is what keeps 512x512 m worlds cheap.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  WORLD, NODES, ANIMALS, PIECES, BUILD, ITEMS, clamp, piecePosition, buildingAABB, playerColor,
} from '../shared/config.js';
import {
  sampleHeight, slopeAt, biomeAt, fbm,
} from '../shared/noise.js';
import {
  auditGround, liftToSurface, describeViolations,
} from '../shared/ground.js';

export const CHUNK = 64;

/** Small deterministic PRNG so chunk contents are identical on every restart. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const chunkKey = (cx, cz) => `${cx}_${cz}`;

/**
 * A player record loaded from disk may be missing fields added since it was
 * written - fill in defaults so the simulation never sees `undefined` maths.
 */
export function sanitizePlayer(p) {
  const base = {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    vx: 0, vy: 0, vz: 0,
    crouch: false, onGround: true, inWater: false, swimming: false,
    health: 100, stamina: 100, hunger: 100, thirst: 100, breath: 100,
    kills: 0, deaths: 0, killsAnimal: 0, staminaDelay: 0,
    inv: [null, null, null, null, null, null, null, null, null, null, null, null],
    toolSlot: 0,
  };
  const out = { ...base, ...p };
  out.x = Number(out.x) || 0;
  out.y = Number(out.y) || 0;
  out.z = Number(out.z) || 0;
  out.yaw = Number(out.yaw) || 0;
  out.pitch = Number(out.pitch) || 0;
  out.vx = out.vy = out.vz = 0;
  out.staminaDelay = 0;
  if (!Array.isArray(out.inv) || out.inv.length !== 12) {
    out.inv = [...base.inv];
  }
  if (!out.spawn || !Number.isFinite(out.spawn.x)) out.spawn = { x: out.x, y: out.y, z: out.z };
  // Colours are derived from player ids, never user-selected. Re-derive them
  // on every load so old space-HSL (rendered white by Three.js) and colours from
  // a previous hash version both migrate deterministically.
  const derivedColor = playerColor(out.id ?? out.name);
  if (out.color !== derivedColor) out.color = derivedColor;
  return out;
}

export class World {
  constructor({ seed = WORLD.seed, dataDir = null, log = () => {} } = {}) {
    this.seed = seed;
    this.dataDir = dataDir;
    this.log = log;

    this.nodes = new Map(); // id -> node
    this.buildings = new Map(); // id -> building
    this.cellIndex = new Map(); // "cx,cz" -> [building]
    this.animals = new Map(); // id -> animal
    this.players = new Map(); // id -> player state
    this.chunks = new Set();
    this.time01 = 0.28; // fraction of the day
    this.nextBuildingId = 1;
    this.day = 1;
    this.pendingDead = new Map();
    this.dirty = false;

    if (dataDir) this.load();
  }

  /* ------------------------------------------------------------ *
   *  Chunk streaming
   * ------------------------------------------------------------ */

  /** Materialise (deterministically) all entities inside one chunk. */
  ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) return;
    this.chunks.add(key);

    const rng = mulberry32((this.seed * 2654435761 + cx * 340573321 + cz * 1013904223) >>> 0);
    const ox = cx * CHUNK;
    const oz = cz * CHUNK;

    // ---- resource nodes: one candidate every 8 m, then biome-weighted picks
    let i = 0;
    for (let lx = 6; lx < CHUNK; lx += 8) {
      for (let lz = 6; lz < CHUNK; lz += 8) {
        const x = ox + lx + (rng() - 0.5) * 4.5;
        const z = oz + lz + (rng() - 0.5) * 4.5;
        const h = sampleHeight(x, z, this.seed);
        const slope = slopeAt(x, z, this.seed);
        if (h < WORLD.seaLevel + 0.4) continue;
        if (slope > 1.35) continue;
        const biome = biomeAt(x, z, h, slope, this.seed);
        const r = rng();
        let type = null;
        if (biome === 'forest') {
          type = r < 0.72 ? 'tree' : r < 0.84 ? 'bush' : r < 0.94 ? 'rock' : null;
        } else if (biome === 'rock') {
          type = r < 0.45 ? 'rock' : r < 0.62 ? 'tree' : r < 0.7 ? 'bush' : null;
        } else if (biome === 'snow') {
          type = r < 0.34 ? 'rock' : r < 0.55 ? 'tree' : null;
        } else if (biome === 'grass') {
          type = r < 0.16 ? 'tree' : r < 0.3 ? 'bush' : r < 0.36 ? 'rock' : null;
        } else if (biome === 'sand') {
          type = r < 0.05 ? 'bush' : null;
        }
        if (!type) { i++; continue; }
        const def = NODES[type];
        const id = `n:${cx}:${cz}:${i}`;
        this.nodes.set(id, {
          id, type, x, y: h, z,
          rot: rng() * Math.PI * 2,
          scale: 0.75 + rng() * 0.6,
          hp: def.hp,
          dead: false,
          respawnAt: 0,
          v: 0,
        });
        i++;
      }
    }

    // ---- animals
    for (const [type, def] of Object.entries(ANIMALS)) {
      const want = def.spawn.perChunk;
      const n = Math.floor(want) + (rng() < (want % 1) ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const x = ox + rng() * CHUNK;
        const z = oz + rng() * CHUNK;
        const h = sampleHeight(x, z, this.seed);
        const biome = biomeAt(x, z, h, slopeAt(x, z, this.seed), this.seed);
        if (h < WORLD.seaLevel + 0.5) continue;
        if (type === 'deer' && biome !== 'forest' && biome !== 'grass') continue;
        const id = `a:${cx}:${cz}:${type}:${k}`;
        this.animals.set(id, {
          id, type, x, y: h, z,
          homeX: x, homeZ: z,
          yaw: rng() * Math.PI * 2,
          hp: def.hp,
          state: 'idle',
          timer: rng() * 3,
          targetX: x, targetZ: z,
          attackCd: 0,
          dead: false,
          respawnAt: 0,
        });
      }
    }
  }

  /** Keep the streaming window around the players up to date. */
  ensureChunksAround(x, z, radius = 96) {
    const c0x = Math.floor((x - radius) / CHUNK);
    const c1x = Math.floor((x + radius) / CHUNK);
    const c0z = Math.floor((z - radius) / CHUNK);
    const c1z = Math.floor((z + radius) / CHUNK);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) this.ensureChunk(cx, cz);
    }
  }

  /* ------------------------------------------------------------ *
   *  Spawning
   * ------------------------------------------------------------ */

  /** Find a safe dry spawn point near the island centre. */
  findSpawn(prefer = null) {
    const candidates = [];
    if (prefer) candidates.push(prefer);
    for (let i = 0; i < 400; i++) {
      const a = (i * 2.399) % (Math.PI * 2);
      const r = (i % 40) * 4;
      candidates.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
    for (const c of candidates) {
      const h = sampleHeight(c.x, c.z, this.seed);
      if (h > WORLD.seaLevel + 1.2 && h < WORLD.maxHeight * 0.55 && slopeAt(c.x, c.z, this.seed) < 0.6) {
        return { x: c.x, y: h + 0.2, z: c.z };
      }
    }
    return { x: 0, y: sampleHeight(0, 0, this.seed) + 1, z: 0 };
  }

  addPlayer(id, name) {
    const spawn = this.findSpawn();
    const p = {
      id,
      name: (name || 'Överlevare').slice(0, 18),
      color: playerColor(id),
      x: spawn.x, y: spawn.y, z: spawn.z,
      vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0,
      crouch: false, onGround: true, inWater: false, swimming: false,
      health: 100, stamina: 100, hunger: 100, thirst: 100, breath: 100,
      inv: [null, null, null, null, null, null, null, null, null, null, null, null],
      toolSlot: 0,
      spawn,
      seq: 0, ack: 0,
      kills: 0, deaths: 0, killsAnimal: 0,
      joinedAt: Date.now(),
      lastInputAt: Date.now(),
      lastChatAt: 0,
      dirty: true,
    };
    this.players.set(id, p);
    this.ensureChunksAround(p.x, p.z);
    this.dirty = true;
    return p;
  }

  /* ------------------------------------------------------------ *
   *  Queries (interest management happens here)
   * ------------------------------------------------------------ */

  nearbyNodes(x, z, radius) {
    const out = [];
    const r2 = radius * radius;
    for (const n of this.nodes.values()) {
      if (n.dead) continue;
      const dx = n.x - x;
      const dz = n.z - z;
      if (dx * dx + dz * dz <= r2) out.push(n);
    }
    return out;
  }

  nearbyAnimals(x, z, radius) {
    const out = [];
    const r2 = radius * radius;
    for (const a of this.animals.values()) {
      if (a.dead) continue;
      const dx = a.x - x;
      const dz = a.z - z;
      if (dx * dx + dz * dz <= r2) out.push(a);
    }
    return out;
  }

  nearbyBuildings(x, z, radius) {
    const out = [];
    const r2 = radius * radius;
    const g = WORLD.grid;
    const c0x = Math.floor((x - radius) / g);
    const c1x = Math.floor((x + radius) / g);
    const c0z = Math.floor((z - radius) / g);
    const c1z = Math.floor((z + radius) / g);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        for (const b of this.piecesInCell(cx, cz)) {
          const p = piecePosition(b.cx, b.cz, b.rot, b.piece);
          const dx = p.x - x;
          const dz = p.z - z;
          if (dx * dx + dz * dz <= r2) out.push(b);
        }
      }
    }
    return out;
  }

  /** Solid building AABBs overlapping a point + radius, for physics. */
  buildingAABBs(x, z, radius = 2) {
    const out = [];
    const g = WORLD.grid;
    const c0x = Math.floor((x - radius - g / 2) / g);
    const c1x = Math.floor((x + radius + g / 2) / g);
    const c0z = Math.floor((z - radius - g / 2) / g);
    const c1z = Math.floor((z + radius + g / 2) / g);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        for (const b of this.piecesInCell(cx, cz)) {
          const box = buildingAABB(b);
          if (!box) continue;
          const cxw = (box.minX + box.maxX) / 2;
          const czw = (box.minZ + box.maxZ) / 2;
          if (Math.abs(cxw - x) > (box.maxX - box.minX) / 2 + radius) continue;
          if (Math.abs(czw - z) > (box.maxZ - box.minZ) / 2 + radius) continue;
          out.push(box);
        }
      }
    }
    return out;
  }

  /* ---------------- building index ---------------- */

  indexKey(cx, cz) { return `${cx},${cz}`; }

  indexAdd(b) {
    const k = this.indexKey(b.cx, b.cz);
    let arr = this.cellIndex.get(k);
    if (!arr) { arr = []; this.cellIndex.set(k, arr); }
    arr.push(b);
  }

  indexRemove(b) {
    const arr = this.cellIndex.get(this.indexKey(b.cx, b.cz));
    if (!arr) return;
    const i = arr.indexOf(b);
    if (i >= 0) arr.splice(i, 1);
    if (!arr.length) this.cellIndex.delete(this.indexKey(b.cx, b.cz));
  }

  addBuilding(b) {
    this.buildings.set(b.id, b);
    this.indexAdd(b);
    this.dirty = true;
    return b;
  }

  removeBuilding(id) {
    const b = this.buildings.get(id);
    if (!b) return false;
    this.buildings.delete(id);
    this.indexRemove(b);
    this.dirty = true;
    return true;
  }

  piecesInCell(cx, cz) {
    return this.cellIndex.get(this.indexKey(cx, cz)) || [];
  }

  /** Is a piece already occupying this cell+rotation? */
  pieceAt(cx, cz, rot, pieceId, flat) {
    for (const b of this.piecesInCell(cx, cz)) {
      const def = PIECES[b.piece];
      if (flat) { if (def?.flat) return b; continue; }
      if (def?.flat) continue;
      if (b.rot === rot) return b;
    }
    return null;
  }

  /** World position of a piece (delegates to the shared helper). */
  piecePosition(cx, cz, rot, piece) {
    return piecePosition(cx, cz, rot, piece);
  }

  /** Height of the foundation a wall/door in this cell+rotation can rest on. */
  supportHeight(cx, cz, rot) {
    const dx = rot === 1 ? 1 : rot === 3 ? -1 : 0;
    const dz = rot === 0 ? -1 : rot === 2 ? 1 : 0;
    const tops = [];
    for (const [ax, az] of [[cx, cz], [cx + dx, cz + dz]]) {
      for (const b of this.piecesInCell(ax, az)) {
        const def = PIECES[b.piece];
        if (def?.flat) tops.push(b.y + def.size[1]);
      }
    }
    return tops.length ? Math.max(...tops) : null;
  }

  /* ------------------------------------------------------------ *
   *  Simulation
   * ------------------------------------------------------------ */

  /**
   * Rule: nothing may end up under the ground.
   *
   * Every entity is checked against the surface it stands on. Animals (and, as
   * a last resort, players) are lifted back up; nodes and buildings are only
   * *reported*, because silently moving a structure would break it. The result
   * is kept in `this.ground` and shows up in /api/status.
   */
  auditGround(now = Date.now()) {
    const sample = (x, z) => sampleHeight(x, z, this.seed);
    const buildings = [];
    for (const b of this.buildings.values()) {
      const pos = piecePosition(b.cx, b.cz, b.rot, b.piece);
      const def = PIECES[b.piece];
      const rotated = b.rot % 2 === 1;
      buildings.push({
        id: b.id, piece: b.piece, x: pos.x, z: pos.z, y: b.y,
        footprint: def ? {
          halfX: (rotated ? def.size[2] : def.size[0]) / 2,
          halfZ: (rotated ? def.size[0] : def.size[2]) / 2,
        } : undefined,
      });
    }
    // Freeze the exact population once for this audit. Chunk streaming can add
    // nodes between the last audit and a later /api/status read; reporting only
    // a total made that live count look like an audit omission.
    const checkedBy = {
      players: [...this.players.values()],
      animals: [...this.animals.values()],
      nodes: [...this.nodes.values()].filter((n) => !n.dead),
      buildings,
    };
    const violations = auditGround(sample, checkedBy, { pieces: PIECES });
    const checkedCounts = {
      players: checkedBy.players.length,
      animals: checkedBy.animals.length,
      nodes: checkedBy.nodes.length,
      buildings: checkedBy.buildings.length,
    };

    let lifted = 0;
    for (const v of violations) {
      if (v.kind !== 'animal' && v.kind !== 'player') continue;
      const target = v.kind === 'animal' ? this.animals.get(v.id) : this.players.get(v.id);
      if (!target) continue;
      target.y = liftToSurface(target.y, v.surface, 0);
      if (target.vy !== undefined && target.vy < 0) target.vy = 0;
      lifted++;
    }
    this.ground = {
      at: now,
      checked: Object.values(checkedCounts).reduce((sum, count) => sum + count, 0),
      checkedBy: checkedCounts,
      lifted,
      buried: violations.length,
      worst: violations[0] ? Number(violations[0].depth.toFixed(2)) : 0,
    };
    // Report loudly, but not once per tick.
    if (violations.length && now - (this.lastGroundReport || 0) > 10000) {
      this.lastGroundReport = now;
      console.warn(`[spell:ground] ${violations.length} objects below the surface (${lifted} lifted): ${describeViolations(violations)}`);
    }
    return this.ground;
  }

  /** dt in seconds. `now` is Date.now(). */
  step(dt, now, hooks = {}) {
    // ground invariant, a few times per second
    if (now - (this.ground?.at ?? 0) > 2000) this.auditGround(now);

    // day/night
    this.time01 += dt / 600;
    while (this.time01 >= 1) { this.time01 -= 1; this.day++; this.dirty = true; }

    // respawning resources
    for (const n of this.nodes.values()) {
      if (n.dead && now >= n.respawnAt) {
        n.dead = false;
        n.hp = NODES[n.type].hp;
        n.v++;
        this.dirty = true;
        hooks.onNodeRespawn?.(n);
      }
    }

    // animals
    for (const a of this.animals.values()) {
      if (a.dead) {
        if (now >= a.respawnAt) {
          const spawn = this.findSpawn({ x: a.homeX, z: a.homeZ });
          a.dead = false;
          a.hp = ANIMALS[a.type].hp;
          a.x = spawn.x; a.z = spawn.z; a.y = sampleHeight(a.x, a.z, this.seed);
          a.homeX = a.x; a.homeZ = a.z;
          a.state = 'idle'; a.timer = 1;
          this.dirty = true;
        }
        continue;
      }
      this.stepAnimal(a, dt, now, hooks);
    }

    // building decay (Rust-like upkeep, simplified: owner activity refreshes)
    for (const b of this.buildings.values()) {
      if (b.decayAt && now > b.decayAt) {
        b.hp -= dt * 4;
        b.v = (b.v || 0) + 1;
        if (b.hp <= 0) {
          this.removeBuilding(b.id);
          hooks.onBuildingDestroyed?.(b, 'decay');
        }
      }
    }
  }

  stepAnimal(a, dt, now, hooks) {
    const def = ANIMALS[a.type];
    a.attackCd = Math.max(0, a.attackCd - dt);
    const player = hooks.nearestPlayer ? hooks.nearestPlayer(a.x, a.z, def.aggro || 14) : null;

    if (player) {
      if (def.aggro > 0) {
        a.state = 'chase';
        a.targetX = player.x; a.targetZ = player.z;
        const d = Math.hypot(player.x - a.x, player.z - a.z);
        if (d < def.radius + 1.0 && a.attackCd <= 0) {
          a.attackCd = def.attackCooldown || 1.5;
          hooks.onAnimalAttack?.(a, player, def.damage);
        }
      } else {
        a.state = 'flee';
        const dx = a.x - player.x;
        const dz = a.z - player.z;
        const len = Math.hypot(dx, dz) || 1;
        a.targetX = a.x + (dx / len) * 26;
        a.targetZ = a.z + (dz / len) * 26;
        a.timer = 2.5;
      }
    } else if (a.state === 'chase' || a.state === 'flee') {
      a.state = 'wander';
      a.timer = 0.6;
    }

    if (a.state === 'wander') {
      a.timer -= dt;
      if (a.timer <= 0) {
        a.state = 'idle';
        a.timer = 3 + Math.random() * 6;
      }
    } else if (a.state === 'idle') {
      a.timer -= dt;
      if (a.timer <= 0) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 8 + Math.random() * 22;
        a.targetX = a.homeX + Math.cos(ang) * dist;
        a.targetZ = a.homeZ + Math.sin(ang) * dist;
        a.state = 'wander';
        a.timer = 6;
      }
    }

    const speed = a.state === 'flee' ? def.fleeSpeed : a.state === 'chase' ? def.fleeSpeed * 0.85 : def.speed * 0.45;
    const dx = a.targetX - a.x;
    const dz = a.targetZ - a.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.5 && a.state !== 'idle') {
      const step = Math.min(speed * dt, d);
      const nx = a.x + (dx / d) * step;
      const nz = a.z + (dz / d) * step;
      const h = sampleHeight(nx, nz, this.seed);
      // do not walk into deep water or up cliffs
      if (h > WORLD.seaLevel + 0.2 && slopeAt(nx, nz, this.seed) < 1.4) {
        a.x = nx;
        a.z = nz;
        a.y = h;
        a.yaw = Math.atan2(dx, dz);
      } else {
        a.state = 'idle';
        a.timer = 1.5;
      }
    }
  }

  /* ------------------------------------------------------------ *
   *  Persistence
   * ------------------------------------------------------------ */

  get savePath() {
    return this.dataDir ? path.join(this.dataDir, `world-${this.seed}.json`) : null;
  }

  save(force = false) {
    if (!this.dataDir) return false;
    if (!this.dirty && !force) return false;
    const payload = {
      version: 1,
      seed: this.seed,
      time01: this.time01,
      day: this.day,
      nextBuildingId: this.nextBuildingId,
      savedAt: Date.now(),
      deadNodes: [...this.nodes.values()]
        .filter((n) => n.dead)
        .map((n) => ({ id: n.id, respawnAt: n.respawnAt })),
      buildings: [...this.buildings.values()],
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, color: p.color,
        x: p.x, y: p.y, z: p.z, yaw: p.yaw, spawn: p.spawn,
        health: p.health, hunger: p.hunger, thirst: p.thirst, stamina: p.stamina,
        inv: p.inv, toolSlot: p.toolSlot,
        kills: p.kills, deaths: p.deaths, killsAnimal: p.killsAnimal,
      })),
    };
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = `${this.savePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, this.savePath);
      this.dirty = false;
      this.log(`[world] saved ${this.buildings.size} buildings, ${this.players.size} players -> ${this.savePath}`);
      return true;
    } catch (err) {
      this.log(`[world] SAVE FAILED: ${err.message}`);
      return false;
    }
  }

  load() {
    const file = this.savePath;
    if (!file || !fs.existsSync(file)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.time01 = data.time01 ?? this.time01;
      this.day = data.day ?? 1;
      this.nextBuildingId = data.nextBuildingId ?? 1;
      for (const b of data.buildings || []) {
        this.buildings.set(b.id, b);
        this.indexAdd(b);
      }
      for (const p of data.players || []) {
        // Player state is restored lazily when they reconnect (see index.js).
        this.players.set(p.id, sanitizePlayer({ ...p, offline: true }));
      }
      for (const n of data.deadNodes || []) {
        // Chunks are not loaded yet; remember the respawn timers and apply them
        // once the chunk materialises.
        this.pendingDead.set(n.id, n.respawnAt);
      }
      this.log(`[world] loaded ${this.buildings.size} buildings, ${this.players.size} players from ${file}`);
      return true;
    } catch (err) {
      this.log(`[world] LOAD FAILED: ${err.message}`);
      return false;
    }
  }

  /** Re-apply persisted dead-node timers after chunk materialisation. */
  applyPendingDead() {
    if (!this.pendingDead.size) return;
    for (const [id, respawnAt] of this.pendingDead) {
      const n = this.nodes.get(id);
      if (!n) continue;
      if (respawnAt > Date.now()) { n.dead = true; n.respawnAt = respawnAt; }
    }
    this.pendingDead.clear();
  }

  stats() {
    return {
      seed: this.seed,
      day: this.day,
      time01: this.time01,
      nodes: this.nodes.size,
      aliveNodes: [...this.nodes.values()].filter((n) => !n.dead).length,
      buildings: this.buildings.size,
      animals: this.animals.size,
      players: this.players.size,
      online: [...this.players.values()].filter((p) => !p.offline).length,
      chunks: this.chunks.size,
      ground: this.ground ?? null,
    };
  }
}

export { ITEMS, PIECES, BUILD, clamp, fbm };
