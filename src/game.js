// DEN SISTA LÅGAN — engine.
// Top-down action adventure: parry combat, fire as light and as a tool,
// a village that talks back, and one dungeon with a boss at the bottom.

import {
  Body,
  angleDiff,
  clamp,
  dist,
  lerp,
  pointInArc,
  rectsOverlap,
} from './physics.js';
import {
  BRAZIERS,
  CHESTS,
  DECOR,
  DUNGEON,
  DUNGEON_ENTRANCE,
  ENEMIES,
  ENEMY_DEFS,
  HOUSES,
  ITEM_DEFS,
  NPCS,
  PATHS,
  POTS,
  ROCKS,
  SIGNS,
  VILLAGE_FIRE,
  WATER,
  WELLS,
  WORLD_H,
  WORLD_W,
  ZONES,
} from './world.js';

export const TAU = Math.PI * 2;

const SAVE_KEY = 'sista-lagan-save-v2';

const PLAYER_SPEED = 208;
const SWING_TIME = 0.3;
const SWING_HIT_FROM = 0.06;
const SWING_HIT_TO = 0.24;
const SWING_RANGE = 62;
const SWING_HALF_ARC = 1.05;
const PARRY_WINDOW = 0.22;
const PARRY_COOLDOWN = 0.42;
const INVULN = 0.95;

const safeStorage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode — the game still plays, it just forgets */
    }
  },
};

const DEFAULT_FLAGS = () => ({
  braziers: {},
  chests: {},
  pots: {},
  killed: {},
  cracked: {},
  switchOn: false,
  quests: {},
  bossDead: false,
  fireLit: false,
  seen: {},
});

export class Game {
  constructor(canvas, input, cb = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.cb = cb;
    this.dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);

    this.time = 0;
    this.mode = 'title';
    this.scene = 'overworld';
    this.floor = 0;
    this.pausedFrom = 'play';
    this.shake = 0;
    this.hitstop = 0;
    this.slowmo = 0;
    this.flash = 0;
    this.toast = null;
    this.dialogue = null;
    this.shop = null;
    this.mapOpen = false;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.particles = [];
    this.floaters = [];
    this.projectiles = [];
    this.lanterns = [];
    this.enemies = [];
    this.boss = null;
    this.bossIntro = 0;
    this.cinematic = 0;
    this.ready = false;

    this.flags = DEFAULT_FLAGS();
    this.player = this.makePlayer();
    this.resize();
    this.loadScene('overworld', null, true);
    this.ready = true;
    this.updateCamera(1, true);
  }

  /* ------------------------------------------------------------- lifecycle */

  makePlayer() {
    return {
      x: 1600,
      y: 2050,
      r: 15,
      vx: 0,
      vy: 0,
      facing: -Math.PI / 2,
      hp: 3,
      maxHp: 3,
      oil: 3,
      maxOil: 3,
      arrows: 6,
      bombs: 2,
      glod: 0,
      sword: 1,
      item: 'torch',
      owned: { torch: true, bow: false, bombs: true },
      swingT: 0,
      swingCd: 0,
      swingDir: 0,
      hitSet: new Set(),
      parryT: 0,
      parryCd: 0,
      blocking: false,
      invuln: 0,
      hurtT: 0,
      cold: 0,
      itemCd: 0,
      stepT: 0,
      walkPhase: 0,
      moving: false,
      dead: false,
    };
  }

  /** Fresh run. */
  start() {
    this.flags = DEFAULT_FLAGS();
    this.player = this.makePlayer();
    this.lanterns = [];
    this.mode = 'play';
    this.loadScene('overworld', { x: 1600, y: 2050 });
    this.showToast('Vedstorp. Ingen här känner dig.');
    this.cb.onStart?.();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect
      ? this.canvas.getBoundingClientRect()
      : { width: 1280, height: 720 };
    this.w = Math.max(360, Math.round(rect.width || 1280));
    this.h = Math.max(280, Math.round(rect.height || 720));
    this.dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // Closer than a typical top-down game: the character should have presence.
    this.zoom = clamp(Math.min(this.w / 980, this.h / 560), 1.05, 2.2);
    this.viewW = this.w / this.zoom;
    this.viewH = this.h / this.zoom;
    if (this.ready) this.updateCamera(0.016, true);
  }

  /* ------------------------------------------------------------------ save */

  save() {
    const p = this.player;
    const data = {
      v: 2,
      scene: this.scene,
      floor: this.floor,
      x: p.x,
      y: p.y,
      hp: p.hp,
      maxHp: p.maxHp,
      oil: p.oil,
      maxOil: p.maxOil,
      arrows: p.arrows,
      bombs: p.bombs,
      glod: p.glod,
      sword: p.sword,
      owned: p.owned,
      item: p.item,
      flags: { ...this.flags, killed: this.flags.killed },
      lanterns: this.lanterns.map((l) => ({ x: l.x, y: l.y, scene: l.scene, floor: l.floor })),
    };
    safeStorage.set(SAVE_KEY, JSON.stringify(data));
    this.cb.onSave?.();
  }

  hasSave() {
    return !!safeStorage.get(SAVE_KEY);
  }

  loadSave() {
    const raw = safeStorage.get(SAVE_KEY);
    if (!raw) return false;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!data || data.v !== 2) return false;
    this.flags = { ...DEFAULT_FLAGS(), ...data.flags };
    this.flags.braziers ||= {};
    this.flags.chests ||= {};
    this.flags.killed ||= {};
    this.flags.cracked ||= {};
    const p = this.makePlayer();
    Object.assign(p, {
      x: data.x,
      y: data.y,
      hp: data.hp,
      maxHp: data.maxHp,
      oil: data.oil,
      maxOil: data.maxOil,
      arrows: data.arrows,
      bombs: data.bombs,
      glod: data.glod,
      sword: data.sword,
      owned: data.owned || p.owned,
      item: data.item || 'torch',
    });
    this.player = p;
    this.lanterns = (data.lanterns || []).map((l) => ({ ...l, born: 0 }));
    this.mode = 'play';
    this.loadScene(data.scene || 'overworld', { x: p.x, y: p.y }, true, data.floor || 0);
    this.showToast('Du fortsätter där du var.');
    this.cb.onStart?.();
    return true;
  }

  wipeSave() {
    safeStorage.set(SAVE_KEY, '');
  }

  /* ---------------------------------------------------------------- scenes */

  get sceneDef() {
    if (this.scene === 'dungeon') return DUNGEON.floors[this.floor];
    return null;
  }

  get zone() {
    if (this.scene === 'dungeon') {
      const f = this.sceneDef;
      return { id: 'dungeon', name: f.name, sub: 'Under Stenringen', dark: f.dark };
    }
    const p = this.player;
    return (
      ZONES.find(
        (z) =>
          p.x > z.rect.x && p.x < z.rect.x + z.rect.w && p.y > z.rect.y && p.y < z.rect.y + z.rect.h,
      ) || ZONES[1]
    );
  }

  get dark() {
    if (this.scene === 'dungeon') return this.sceneDef.dark;
    const base = this.zone.dark ?? 0.3;
    // Lighting the ring of Stenringen pushes the dark back for good.
    if (this.zone.id === 'ruins' && this.ringLit()) return base * 0.45;
    return base;
  }

  loadScene(scene, pos = null, silent = false, floor = null) {
    const prevZone = this.scene === 'overworld' ? this.zone.id : null;
    this.scene = scene;
    if (scene === 'dungeon') this.floor = floor ?? this.floor;
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.boss = null;
    this.bossIntro = 0;
    this.dialogue = null;
    this.shop = null;
    this.mapOpen = false;

    if (scene === 'overworld') {
      const spawn = pos || { x: 1600, y: 2050 };
      this.player.x = spawn.x;
      this.player.y = spawn.y;
      ENEMIES.forEach((e, i) => {
        if (this.flags.killed[`over-${i}`]) return;
        this.enemies.push(this.makeEnemy(e.type, e.x, e.y, `over-${i}`));
      });
    } else {
      const f = this.sceneDef;
      const spawn = pos || f.spawn;
      this.player.x = spawn.x;
      this.player.y = spawn.y;
      f.enemies.forEach((e, i) => {
        if (this.flags.killed[`d${f.id}-${i}`]) return;
        this.enemies.push(this.makeEnemy(e.type, e.x, e.y, `d${f.id}-${i}`));
      });
      if (f.boss && !this.flags.bossDead) {
        this.boss = this.makeEnemy('boss', f.boss.x, f.boss.y, 'boss');
        this.bossIntro = 1.4;
        this.cb.onBossStart?.();
      }
    }

    this.player.vx = 0;
    this.player.vy = 0;
    this.player.invuln = 0.6;
    this.updateCamera(0.016, true);
    const zone = this.zone;
    if (!silent) {
      this.cb.onScene?.(scene, zone);
      if (prevZone !== (scene === 'overworld' ? zone.id : 'dungeon')) this.showToast(zone.name);
    }
    this.flags.seen[scene === 'dungeon' ? `d${this.floor}` : zone.id] = true;
  }

  makeEnemy(type, x, y, id) {
    const def = ENEMY_DEFS[type];
    return {
      id,
      type,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: def.hp,
      maxHp: def.hp,
      r: def.radius,
      facing: Math.PI / 2,
      state: 'idle',
      stateT: 0,
      hurtT: 0,
      glowT: 0,
      cooldown: 0.6 + Math.random() * 0.8,
      wanderT: Math.random() * 2,
      wanderDir: Math.random() * TAU,
      dead: false,
      burnT: 0,
      phase: 1,
      def,
    };
  }

  /* --------------------------------------------------------------- solids */

  overworldSolids() {
    if (this._overSolids && this._overSolidsKey === this.solidsKey()) return this._overSolids;
    const out = [];
    // world edge
    out.push({ x: -200, y: -200, w: WORLD_W + 400, h: 214 });
    out.push({ x: -200, y: WORLD_H - 14, w: WORLD_W + 400, h: 400 });
    out.push({ x: -200, y: -200, w: 54, h: WORLD_H + 400 });
    out.push({ x: WORLD_W - 54, y: -200, w: 214, h: WORLD_H + 400 });
    for (const h of HOUSES) out.push({ x: h.x, y: h.y, w: h.w, h: h.h });
    for (const r of ROCKS) out.push({ x: r.x - r.r * 0.8, y: r.y - r.r * 0.6, w: r.r * 1.6, h: r.r * 1.3 });
    for (const w of WATER) out.push(w);
    for (const t of TREES_CACHE) {
      out.push({ x: t.x - t.r * 0.3, y: t.y - t.r * 0.22, w: t.r * 0.6, h: t.r * 0.5 });
    }
    out.push({ x: VILLAGE_FIRE.x - 34, y: VILLAGE_FIRE.y - 26, w: 68, h: 52 });
    // the stone gate down into the crypt stays shut until the ring burns
    if (!this.ringLit()) out.push({ x: DUNGEON_ENTRANCE.x, y: DUNGEON_ENTRANCE.y - 70, w: DUNGEON_ENTRANCE.w, h: 116 });
    this._overSolids = out;
    this._overSolidsKey = this.solidsKey();
    return out;
  }

  solidsKey() {
    return `${this.ringLit()}-${Object.keys(this.flags.cracked).length}-${this.flags.switchOn}`;
  }

  solids() {
    if (this.scene === 'overworld') return this.overworldSolids();
    const f = this.sceneDef;
    const out = f.solids.filter((s) => !(s.cracked && this.flags.cracked[this.wallId(s)]));
    const gateOpen = this.gateOpen();
    if (f.gate && !gateOpen) out.push({ x: f.gate.x, y: f.gate.y, w: f.gate.w, h: f.gate.h });
    if (f.switch && this.flags.switchOn) {
      // the switch gate is open; nothing to add
    }
    return out;
  }

  wallId(wall) {
    return `d${this.floor}-${wall.x}-${wall.y}`;
  }

  gateOpen() {
    const f = this.sceneDef;
    if (!f || !f.gate) return true;
    if (f.gate.needs === 'braziers') return f.braziers.every((b) => this.flags.braziers[b.id]);
    if (f.gate.needs === 'switch') return !!this.flags.switchOn;
    return true;
  }

  ringLit() {
    return ['ring-1', 'ring-2', 'ring-3'].every((id) => this.flags.braziers[id]);
  }

  litCount() {
    return BRAZIERS.filter((b) => this.flags.braziers[b.id]).length;
  }

  /* ---------------------------------------------------------------- lights */

  lightSources() {
    if (!this._lights || this._lightsKey !== this.lightKey()) {
      const out = [];
      if (this.scene === 'overworld') {
        for (const b of BRAZIERS) if (this.flags.braziers[b.id]) out.push({ x: b.x, y: b.y, r: 300 });
        if (this.flags.fireLit) out.push({ x: VILLAGE_FIRE.x, y: VILLAGE_FIRE.y, r: 480 });
        for (const w of WELLS) out.push({ x: w.x, y: w.y, r: 130, soft: true });
      } else {
        for (const b of this.sceneDef.braziers || []) {
          if (this.flags.braziers[b.id]) out.push({ x: b.x, y: b.y, r: 310 });
        }
      }
      for (const l of this.lanterns) {
        if (l.scene === this.scene && (this.scene !== 'dungeon' || l.floor === this.floor)) {
          out.push({ x: l.x, y: l.y, r: 250, placed: true });
        }
      }
      this._lights = out;
      this._lightsKey = this.lightKey();
    }
    return this._lights;
  }

  lightKey() {
    return `${Object.keys(this.flags.braziers).length}-${this.flags.fireLit}-${this.lanterns.length}-${this.scene}-${this.floor}-${this.flags.bonusLantern ? 1 : 0}`;
  }

  inHardLight(x, y) {
    return this.lightSources().some((s) => !s.soft && dist(x, y, s.x, s.y) < s.r);
  }

  /* ---------------------------------------------------------------- update */

  update(rawDt) {
    const input = this.input;
    const paused = this.mode !== 'play';

    this.time += rawDt;
    if (this.toast) {
      this.toast.t -= rawDt;
      if (this.toast.t <= 0) this.toast = null;
    }
    this.flash = Math.max(0, this.flash - rawDt * 2.6);
    this.shake = Math.max(0, this.shake - rawDt * 3);

    this.updateParticles(rawDt);

    if (this.mode === 'dialogue') {
      this.updateDialogue(rawDt);
      input.endFrame();
      return;
    }
    if (this.mode === 'shop') {
      this.updateShop(rawDt);
      input.endFrame();
      return;
    }
    if (this.mode === 'pause') {
      if (input.hit('pause') || input.hit('use')) this.mode = this.pausedFrom;
      input.endFrame();
      return;
    }
    if (this.mode === 'dead') {
      input.endFrame();
      return;
    }
    if (this.mode !== 'play') {
      input.endFrame();
      return;
    }

    if (input.hit('pause')) {
      this.mode = 'pause';
      this.pausedFrom = 'play';
      this.cb.onPause?.(true);
      input.endFrame();
      return;
    }
    if (input.hit('map')) {
      this.mapOpen = !this.mapOpen;
      this.cb.onMap?.(this.mapOpen);
      input.endFrame();
      return;
    }
    if (this.mapOpen) {
      if (input.hit('use') || input.hit('pause') || input.hit('map')) {
        this.mapOpen = false;
        this.cb.onMap?.(false);
      }
      input.endFrame();
      return;
    }

    let dt = rawDt;
    if (this.slowmo > 0) {
      this.slowmo -= rawDt;
      dt *= 0.42;
    }
    if (this.hitstop > 0) {
      this.hitstop -= rawDt;
      dt *= 0.08;
    }

    this.bossIntro = Math.max(0, this.bossIntro - rawDt);
    this.cinematic = Math.max(0, this.cinematic - rawDt);

    const p = this.player;
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.swingCd = Math.max(0, p.swingCd - dt);
    p.parryCd = Math.max(0, p.parryCd - dt);
    p.itemCd = Math.max(0, p.itemCd - dt);
    p.parryT = Math.max(0, p.parryT - dt);

    this.updatePlayer(dt);
    this.updateCombat(dt);
    this.updateEnemies(dt);
    this.updateBoss(dt);
    this.updateProjectiles(dt);
    this.updateDarkness(dt);
    this.updateLanternFeel(dt);
    this.updateCamera(rawDt);
    this.updateZoneWatch();

    if (p.hp <= 0 && !p.dead) this.killPlayer();
    input.endFrame();
  }

  updatePlayer(dt) {
    const p = this.player;
    const input = this.input;
    const axis = input.axis;
    let ax = axis.x;
    let ay = axis.y;
    const len = Math.hypot(ax, ay) || 1;
    ax /= len;
    ay /= len;

    p.blocking = false;
    if (input.hit('parry') && p.parryCd <= 0) {
      p.parryT = PARRY_WINDOW;
      p.parryCd = PARRY_COOLDOWN;
      this.cb.onParry?.();
    }
    if (input.down('parry') && p.parryT <= 0) p.blocking = true;

    const speed = PLAYER_SPEED * (p.blocking ? 0.44 : 1) * (p.swingT > 0 ? 0.62 : 1);
    const targetVx = ax * speed;
    const targetVy = ay * speed;
    const accel = (ax || ay ? 14 : 18) * dt;
    p.vx = lerp(p.vx, targetVx, Math.min(1, accel));
    p.vy = lerp(p.vy, targetVy, Math.min(1, accel));
    if (Math.abs(p.vx) < 1) p.vx = 0;
    if (Math.abs(p.vy) < 1) p.vy = 0;

    const body = new Body(p.x - 12, p.y - 10, 24, 20);
    body.x += p.vx * dt;
    body.y += p.vy * dt;
    const solids = this.solids();
    for (const s of solids) {
      if (!rectsOverlap(body, s)) continue;
      // Push out along the shallowest axis.
      const dxL = body.x + body.w - s.x;
      const dxR = s.x + s.w - body.x;
      const dyT = body.y + body.h - s.y;
      const dyB = s.y + s.h - body.y;
      const m = Math.min(dxL, dxR, dyT, dyB);
      if (m === dxL) body.x = s.x - body.w;
      else if (m === dxR) body.x = s.x + s.w;
      else if (m === dyT) body.y = s.y - body.h;
      else body.y = s.y + s.h;
    }
    p.x = body.x + 12;
    p.y = body.y + 10;
    p.x = clamp(p.x, 20, (this.scene === 'overworld' ? WORLD_W : this.sceneDef.w) - 20);
    p.y = clamp(p.y, 20, (this.scene === 'overworld' ? WORLD_H : this.sceneDef.h) - 20);

    p.moving = Math.hypot(p.vx, p.vy) > 20;
    if (p.moving && p.swingT <= 0) p.facing = Math.atan2(p.vy, p.vx);
    if (p.moving) {
      p.walkPhase += dt * 9;
      p.stepT -= dt;
      if (p.stepT <= 0) {
        p.stepT = 0.34;
        this.cb.onStep?.();
        if (this.zone.dark > 0.4) this.puff(p.x, p.y + 12, 2, 'rgba(150,170,160,0.5)');
      }
    }

    // Items + interaction.
    if (input.hit('item1')) this.selectItem('torch');
    if (input.hit('item2')) this.selectItem('bow');
    if (input.hit('item3')) this.selectItem('bombs');
    if (input.hit('cycle')) this.cycleItem();
    if (input.hit('item')) this.useItem();
    if (input.hit('attack')) this.swing();
    if (input.hit('lantern')) this.placeLantern();
    if (input.hit('use')) this.interact();

    if (p.swingT > 0) {
      p.swingT -= dt;
      if (p.swingT <= SWING_HIT_TO && p.swingT >= SWING_HIT_FROM) this.resolveSwing();
    }
  }

  selectItem(id) {
    const p = this.player;
    if (!p.owned[id]) {
      this.showToast('Du har inte det än.');
      return;
    }
    if (p.item === id) return;
    p.item = id;
    this.cb.onItem?.(id);
    this.cb.onClick?.();
  }

  cycleItem() {
    const order = ['torch', 'bow', 'bombs'].filter((id) => this.player.owned[id]);
    const i = order.indexOf(this.player.item);
    this.selectItem(order[(i + 1) % order.length]);
  }

  swing() {
    const p = this.player;
    if (p.swingCd > 0 || p.blocking) return;
    p.swingT = SWING_TIME;
    p.swingCd = 0.4;
    p.swingDir = p.facing;
    p.hitSet.clear();
    this.cb.onSwing?.();
    this.shake = Math.max(this.shake, 0.05);
  }

  resolveSwing() {
    const p = this.player;
    const dmg = 1 + (p.sword - 1);
    let hitAny = false;
    for (const e of this.enemies) {
      if (e.dead || p.hitSet.has(e)) continue;
      if (!pointInArc(e.x, e.y, p.x, p.y - 6, p.swingDir, SWING_HALF_ARC, SWING_RANGE + e.r)) continue;
      p.hitSet.add(e);
      const counter = e.state === 'stagger';
      this.hurtEnemy(e, counter ? dmg + 2 : dmg, p.swingDir, counter);
      hitAny = true;
    }
    const b = this.boss;
    if (b && !b.dead && !p.hitSet.has(b)) {
      if (pointInArc(b.x, b.y, p.x, p.y - 6, p.swingDir, SWING_HALF_ARC, SWING_RANGE + b.r)) {
        p.hitSet.add(b);
        const counter = b.state === 'stagger';
        this.hurtEnemy(b, counter ? dmg + 2 : dmg, p.swingDir, counter);
        hitAny = true;
      }
    }
    if (hitAny) {
      this.hitstop = 0.055;
      this.shake = Math.max(this.shake, 0.16);
    }
  }

  hurtEnemy(e, dmg, dir, counter = false) {
    e.hp -= dmg;
    e.hurtT = 0.22;
    e.glowT = 0.3;
    e.vx += Math.cos(dir) * 180;
    e.vy += Math.sin(dir) * 180;
    if (e.state === 'windup' && !counter) e.stateT = Math.max(e.stateT, 0.2);
    this.floaters.push({
      x: e.x,
      y: e.y - e.r - 8,
      text: counter ? `${dmg} PERFEKT` : `${dmg}`,
      t: 0.85,
      color: counter ? '#ffe9a8' : '#ffffff',
      size: counter ? 22 : 16,
    });
    this.burst(e.x, e.y, counter ? 18 : 8, counter ? '#ffe6a6' : '#cfe6d8', 190);
    this.cb.onHit?.(counter);
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    e.dead = true;
    e.state = 'dead';
    const p = this.player;
    const glod = e.def.glod || 1;
    p.glod += glod;
    this.burst(e.x, e.y, 26, '#9fe6c0', 250);
    this.floaters.push({ x: e.x, y: e.y - 16, text: `+${glod} glöd`, t: 1.1, color: '#ffd88a', size: 14 });
    if (e.id === 'boss') {
      this.onBossDown();
    } else if (e.id) {
      this.flags.killed[e.id] = true;
    }
    this.cb.onKill?.(e);
    this.shake = Math.max(this.shake, 0.3);
    this.save();
  }

  /* ---------------------------------------------------------------- combat */

  updateCombat(dt) {
    const p = this.player;
    // Parry sparkle fades with the window; visual feedback lives in render.
    if (p.parryT > 0) p.parryFlash = Math.min(1, p.parryT / PARRY_WINDOW);
    else p.parryFlash = Math.max(0, (p.parryFlash || 0) - dt * 6);
  }

  /** Called when an enemy's strike lands. Returns 'hit' | 'parried' | 'blocked'. */
  receiveAttack(source, damage) {
    const p = this.player;
    const angleToSource = Math.atan2(source.y - p.y, source.x - p.x);
    const facingSource = Math.abs(angleDiff(angleToSource, p.facing)) < 1.5;

    if (p.invuln > 0) return 'immune';

    if (p.parryT > 0 && facingSource) {
      // Perfect parry: stagger, stop time for a blink, everyone loves it.
      if (source && source.state) {
        source.state = 'stagger';
        source.stateT = 1.5;
        source.hp -= 1;
      }
      p.parryT = 0;
      p.parryCd = 0.3;
      p.invuln = 0.35;
      this.slowmo = 0.18;
      this.flash = 0.5;
      this.shake = Math.max(this.shake, 0.35);
      this.burst(source.x ?? p.x, source.y ?? p.y, 22, '#fff3c4', 280);
      this.floaters.push({ x: p.x, y: p.y - 50, text: 'PARERING', t: 0.9, color: '#ffefae', size: 20 });
      this.cb.onPerfectParry?.(source);
      return 'parried';
    }

    if (p.blocking && facingSource) {
      p.invuln = 0.2;
      this.shake = Math.max(this.shake, 0.18);
      this.burst(p.x + Math.cos(angleToSource) * 20, p.y + Math.sin(angleToSource) * 20, 8, '#d8e6ff', 140);
      this.cb.onBlock?.();
      return 'blocked';
    }

    this.hurtPlayer(damage, angleToSource);
    return 'hit';
  }

  hurtPlayer(dmg, fromAngle) {
    const p = this.player;
    if (p.invuln > 0) return;
    p.hp -= dmg;
    p.invuln = INVULN;
    p.hurtT = 0.45;
    p.cold = 0;
    p.vx += Math.cos(fromAngle) * 210;
    p.vy += Math.sin(fromAngle) * 210;
    this.shake = Math.max(this.shake, 0.55);
    this.flash = 0.25;
    this.burst(p.x, p.y - 8, 14, '#ff9c8a', 200);
    this.cb.onHurt?.(dmg);
    if (p.hp <= 0) this.killPlayer();
  }

  killPlayer() {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    p.hp = 0;
    this.mode = 'dead';
    this.shake = 0.8;
    this.cb.onDeath?.();
  }

  revive() {
    const p = this.player;
    p.dead = false;
    p.hp = p.maxHp;
    p.cold = 0;
    p.invuln = 2;
    p.oil = Math.max(p.oil, 1);
    this.mode = 'play';
    // Wake up in the village, or at the bottom of the stairs you fell on.
    if (this.scene === 'dungeon') this.loadScene('dungeon', null, true);
    else this.loadScene('overworld', { x: VILLAGE_FIRE.x, y: VILLAGE_FIRE.y + 90 });
    this.cb.onRevive?.();
  }

  /* --------------------------------------------------------------- enemies */

  updateEnemies(dt) {
    const p = this.player;
    const speedMul = this.dark > 0.5 ? 1.18 : 1;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.hurtT = Math.max(0, e.hurtT - dt);
      e.glowT = Math.max(0, e.glowT - dt);

      // Light burns shadows. This is what makes building fire worth it.
      const lit = this.inHardLight(e.x, e.y);
      if (lit && !e.def.armored) {
        e.burnT = (e.burnT || 0) + dt;
        e.hp -= dt * 1.4;
        if (Math.random() < dt * 8) this.puff(e.x + (Math.random() - 0.5) * 20, e.y - 10, 1, 'rgba(255,220,150,0.8)');
        if (e.hp <= 0) {
          this.floaters.push({ x: e.x, y: e.y - 24, text: 'brann upp', t: 0.9, color: '#ffd88a', size: 13 });
          this.killEnemy(e);
          continue;
        }
      }

      const d = dist(e.x, e.y, p.x, p.y);
      const dmgScale = 1 + Math.max(0, this.dark - 0.4) * 0.6;

      if (e.state === 'stagger') {
        e.stateT -= dt;
        e.vx = lerp(e.vx, 0, Math.min(1, dt * 6));
        e.vy = lerp(e.vy, 0, Math.min(1, dt * 6));
        if (e.stateT <= 0) {
          e.state = 'chase';
          e.cooldown = 0.4;
        }
      } else if (e.state === 'windup') {
        e.stateT -= dt;
        e.facing = Math.atan2(p.y - e.y, p.x - e.x);
        if (e.stateT <= 0) {
          e.state = 'strike';
          e.stateT = e.def.strike;
          this.resolveEnemyStrike(e, dmgScale);
        }
      } else if (e.state === 'strike') {
        e.stateT -= dt;
        if (e.stateT <= 0) {
          e.state = 'recover';
          e.stateT = 0.35;
          e.cooldown = e.def.boss ? 0.9 : 0.85 + Math.random() * 0.5;
        }
      } else if (e.state === 'recover') {
        e.stateT -= dt;
        if (e.stateT <= 0) e.state = 'chase';
      } else {
        e.cooldown = Math.max(0, e.cooldown - dt);
        if (lit && !e.def.armored) {
          // Flee the light.
          const light = this.nearestLight(e.x, e.y);
          if (light) {
            const a = Math.atan2(e.y - light.y, e.x - light.x);
            e.x += Math.cos(a) * e.def.speed * 0.8 * dt;
            e.y += Math.sin(a) * e.def.speed * 0.8 * dt;
          }
        } else if (d < 420) {
          e.state = 'chase';
          const stop = e.def.ranged ? 300 : e.def.reach * 0.85;
          if (d > stop) {
            const a = Math.atan2(p.y - e.y, p.x - e.x);
            e.facing = lerp(e.facing, a, Math.min(1, dt * 6));
            e.x += Math.cos(a) * e.def.speed * speedMul * dt;
            e.y += Math.sin(a) * e.def.speed * speedMul * dt;
          } else if (e.cooldown <= 0) {
            e.state = 'windup';
            e.stateT = e.def.windup;
            e.facing = Math.atan2(p.y - e.y, p.x - e.x);
            this.cb.onTelegraph?.(e);
          }
        } else {
          e.wanderT -= dt;
          if (e.wanderT <= 0) {
            e.wanderT = 2 + Math.random() * 3;
            e.wanderDir = Math.random() * TAU;
          }
          e.x += Math.cos(e.wanderDir) * 22 * dt;
          e.y += Math.sin(e.wanderDir) * 22 * dt;
        }
      }

      // Integrate knockback and keep them out of walls.
      const body = new Body(e.x - e.r * 0.7, e.y - e.r * 0.6, e.r * 1.4, e.r * 1.2);
      body.x += e.vx * dt;
      body.y += e.vy * dt;
      const solids = this.solids();
      for (const s of solids) {
        if (!rectsOverlap(body, s)) continue;
        const dxL = body.x + body.w - s.x;
        const dxR = s.x + s.w - body.x;
        const dyT = body.y + body.h - s.y;
        const dyB = s.y + s.h - body.y;
        const m = Math.min(dxL, dxR, dyT, dyB);
        if (m === dxL) body.x = s.x - body.w;
        else if (m === dxR) body.x = s.x + s.w;
        else if (m === dyT) body.y = s.y - body.h;
        else body.y = s.y + s.h;
      }
      e.x = body.x + e.r * 0.7;
      e.y = body.y + e.r * 0.6;
      e.vx *= Math.pow(0.02, dt);
      e.vy *= Math.pow(0.02, dt);
      const maxX = this.scene === 'overworld' ? WORLD_W : this.sceneDef.w;
      const maxY = this.scene === 'overworld' ? WORLD_H : this.sceneDef.h;
      e.x = clamp(e.x, 24, maxX - 24);
      e.y = clamp(e.y, 24, maxY - 24);
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  nearestLight(x, y) {
    let best = null;
    let bd = Infinity;
    for (const s of this.lightSources()) {
      const d = dist(x, y, s.x, s.y);
      if (d < s.r * 1.4 && d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  resolveEnemyStrike(e, dmgScale) {
    const p = this.player;
    const d = dist(e.x, e.y, p.x, p.y);
    if (e.def.ranged) {
      // Loose an arrow.
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      this.projectiles.push({
        x: e.x + Math.cos(a) * 20,
        y: e.y + Math.sin(a) * 20,
        vx: Math.cos(a) * 420,
        vy: Math.sin(a) * 420,
        t: 2.2,
        dmg: Math.round(e.def.damage * dmgScale),
        friendly: false,
        kind: 'arrow',
        angle: a,
      });
      this.cb.onBow?.();
      return;
    }
    if (d < e.def.reach + 18 && pointInArc(p.x, p.y, e.x, e.y, e.facing, 1.15, e.def.reach + 20)) {
      this.receiveAttack(e, Math.round(e.def.damage * dmgScale));
    }
  }

  /* ------------------------------------------------------------------ boss */

  updateBoss(dt) {
    const b = this.boss;
    if (!b || b.dead) return;
    const p = this.player;
    b.hurtT = Math.max(0, b.hurtT - dt);
    b.glowT = Math.max(0, b.glowT - dt);
    b.stateT -= dt;
    const d = dist(b.x, b.y, p.x, p.y);

    if (this.bossIntro > 0) return;

    if (b.hp <= b.maxHp * 0.5 && b.phase === 1) {
      b.phase = 2;
      this.flash = 0.6;
      this.shake = 0.7;
      this.slowmo = 0.5;
      this.showToast('Förbannelsen drar efter andan.');
      this.burst(b.x, b.y, 40, '#c9a6ff', 340);
      this.cb.onBossPhase?.(2);
      b.state = 'stagger';
      b.stateT = 1.4;
    }

    if (b.state === 'stagger') {
      if (b.stateT <= 0) {
        b.state = 'idle';
        b.stateT = 0.4;
      }
      return;
    }

    if (b.state === 'windup') {
      b.facing = Math.atan2(p.y - b.y, p.x - b.x);
      if (b.stateT <= 0) {
        b.state = 'strike';
        b.stateT = 0.16;
        if (d < b.def.reach + 26) this.receiveAttack(b, b.def.damage);
        else if (Math.random() < 0.7) {
          // shockwave rings
          for (let i = 0; i < (b.phase === 2 ? 2 : 1); i++) {
            this.projectiles.push({
              x: b.x,
              y: b.y,
              vx: 0,
              vy: 0,
              ring: true,
              r: 30,
              max: 300,
              t: 1.1,
              dmg: 1,
              friendly: false,
              kind: 'ring',
            });
          }
          this.cb.onBomb?.();
        }
      }
      return;
    }

    if (b.state === 'strike') {
      if (b.stateT <= 0) {
        b.state = 'recover';
        b.stateT = 0.55;
      }
      return;
    }

    if (b.state === 'recover') {
      if (b.stateT <= 0) b.state = 'idle';
      return;
    }

    // idle: drift and choose an attack
    b.cooldown = (b.cooldown || 0) - dt;
    const a = Math.atan2(p.y - b.y, p.x - b.x);
    b.facing = lerp(b.facing, a, Math.min(1, dt * 3));
    if (d > 90) {
      b.x += Math.cos(a) * b.def.speed * dt;
      b.y += Math.sin(a) * b.def.speed * dt;
    }
    if (b.cooldown <= 0) {
      b.cooldown = b.phase === 2 ? 1.15 : 1.7;
      if (b.phase === 2 && Math.random() < 0.4) {
        const spots = [
          [200, 250],
          [920, 250],
        ];
        for (const [sx, sy] of spots) {
          if (this.enemies.length < 9) this.enemies.push(this.makeEnemy('skugga', sx, sy, null));
        }
        this.showToast('Skuggor reser sig ur golvet.');
      }
      b.state = 'windup';
      b.stateT = b.def.windup;
      this.cb.onTelegraph?.(b);
    }
  }

  onBossDown() {
    this.flags.bossDead = true;
    this.boss = null;
    this.mode = 'end';
    this.slowmo = 2;
    this.flash = 1;
    this.cb.onVictory?.();
    this.save();
  }

  /* ------------------------------------------------------------ projectiles */

  updateProjectiles(dt) {
    const p = this.player;
    const solids = this.solids();
    for (const pr of this.projectiles) {
      pr.t -= dt;
      if (pr.ring) {
        pr.r += 300 * dt;
        const inside = dist(p.x, p.y, pr.x, pr.y) < pr.r && dist(p.x, p.y, pr.x, pr.y) > pr.r - 26;
        if (inside && !pr.hitPlayer) {
          pr.hitPlayer = true;
          this.receiveAttack({ x: pr.x, y: pr.y, state: null }, pr.dmg);
        }
        continue;
      }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (pr.kind === 'bomb') {
        pr.vy += 0;
        if (pr.t <= 0) this.explode(pr);
      }
      if (pr.friendly) {
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (dist(pr.x, pr.y, e.x, e.y) < e.r + 6) {
            this.hurtEnemy(e, pr.dmg, Math.atan2(pr.vy, pr.vx), false);
            pr.t = 0;
          }
        }
        if (this.boss && !this.boss.dead && dist(pr.x, pr.y, this.boss.x, this.boss.y) < this.boss.r + 6) {
          this.hurtEnemy(this.boss, pr.dmg, Math.atan2(pr.vy, pr.vx));
          pr.t = 0;
        }
        // switch target
        const f = this.sceneDef;
        if (f && f.switch && !this.flags.switchOn) {
          if (dist(pr.x, pr.y, f.switch.x, f.switch.y) < 24) {
            this.flags.switchOn = true;
            this.flash = 0.3;
            this.showToast('Något klickar i stenens inre.');
            this.cb.onGate?.();
            this.save();
            pr.t = 0;
          }
        }
      } else if (dist(pr.x, pr.y, p.x, p.y) < 16) {
        if (!pr.hitPlayer) {
          pr.hitPlayer = true;
          this.receiveAttack({ x: pr.x, y: pr.y, state: null }, pr.dmg);
          pr.t = 0;
        }
      }
      for (const s of solids) {
        if (rectsOverlap({ x: pr.x - 4, y: pr.y - 4, w: 8, h: 8 }, s)) {
          if (pr.kind === 'bomb') this.explode(pr);
          else this.puff(pr.x, pr.y, 4, '#cfe0d8');
          pr.t = 0;
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.t > 0);
  }

  explode(pr) {
    const R = 118;
    this.burst(pr.x, pr.y, 40, '#ffb15a', 380);
    this.flash = 0.45;
    this.shake = 0.6;
    this.cb.onBomb?.();
    for (const e of this.enemies) {
      if (dist(pr.x, pr.y, e.x, e.y) < R + e.r) {
        this.hurtEnemy(e, 3, Math.atan2(e.y - pr.y, e.x - pr.x));
      }
    }
    const b = this.boss;
    if (b && dist(pr.x, pr.y, b.x, b.y) < R + b.r) this.hurtEnemy(b, 2, 0);
    if (this.scene === 'dungeon') {
      for (const s of this.sceneDef.solids) {
        if (!s.cracked) continue;
        const id = this.wallId(s);
        if (this.flags.cracked[id]) continue;
        if (dist(pr.x, pr.y, s.x + s.w / 2, s.y + s.h / 2) < R + Math.max(s.w, s.h) * 0.4) {
          this.flags.cracked[id] = true;
          this.shake = 0.9;
          this.showToast('Väggen ger vika.');
          this.cb.onCrack?.();
          this.save();
        }
      }
    }
    pr.t = 0;
  }

  /* ---------------------------------------------------------------- items */

  useItem() {
    const p = this.player;
    if (p.itemCd > 0) return;
    if (p.item === 'torch') {
      p.itemCd = 0.5;
      const tx = p.x + Math.cos(p.facing) * 34;
      const ty = p.y + Math.sin(p.facing) * 34;
      this.burst(tx, ty, 10, '#ffcf8a', 120);
      this.cb.onIgnite?.();
      let litSomething = false;
      for (const b of this.braziersHere()) {
        if (!this.flags.braziers[b.id] && dist(tx, ty, b.x, b.y) < 84) {
          this.lightBrazier(b);
          litSomething = true;
        }
      }
      if (!litSomething && !this.anyBrazierNear(84)) {
        // A short-lived light flare: costs nothing, but shows the mechanic.
        this.lanterns.push({ x: tx, y: ty, scene: this.scene, floor: this.floor, born: this.time, temp: 2.4 });
      }
    } else if (p.item === 'bow') {
      if (p.arrows <= 0) {
        this.showToast('Inga pilar kvar.');
        return;
      }
      p.arrows--;
      p.itemCd = 0.42;
      const a = p.facing;
      this.projectiles.push({
        x: p.x + Math.cos(a) * 22,
        y: p.y + Math.sin(a) * 22,
        vx: Math.cos(a) * 620,
        vy: Math.sin(a) * 620,
        t: 1.4,
        dmg: 2 + (p.sword - 1),
        friendly: true,
        kind: 'arrow',
        angle: a,
      });
      this.cb.onBow?.();
    } else if (p.item === 'bombs') {
      if (p.bombs <= 0) {
        this.showToast('Inga bomber kvar.');
        return;
      }
      p.bombs--;
      p.itemCd = 0.6;
      const a = p.facing;
      this.projectiles.push({
        x: p.x + Math.cos(a) * 18,
        y: p.y + Math.sin(a) * 18,
        vx: Math.cos(a) * 300,
        vy: Math.sin(a) * 300,
        t: 0.85,
        dmg: 3,
        friendly: true,
        kind: 'bomb',
      });
      this.cb.onThrow?.();
    }
  }

  placeLantern() {
    const p = this.player;
    if (p.oil <= 0) {
      this.showToast('Ingen olja kvar. Fyll på vid brunnen.');
      return;
    }
    // Don't stack them on top of each other.
    if (this.lanterns.some((l) => l.scene === this.scene && dist(l.x, l.y, p.x, p.y) < 80)) return;
    p.oil--;
    this.lanterns.push({ x: p.x, y: p.y, scene: this.scene, floor: this.floor, born: this.time });
    this.burst(p.x, p.y, 14, '#ffd68a', 140);
    this.cb.onPlaceLantern?.();
    this.save();
  }

  braziersHere() {
    if (this.scene === 'overworld') return BRAZIERS;
    return this.sceneDef.braziers || [];
  }

  anyBrazierNear(r) {
    return this.braziersHere().some((b) => dist(this.player.x, this.player.y, b.x, b.y) < r);
  }

  lightBrazier(b) {
    if (this.flags.braziers[b.id]) return;
    this.flags.braziers[b.id] = true;
    this.player.oil = Math.min(this.player.maxOil, this.player.oil + 1);
    this.flash = 0.35;
    this.shake = 0.2;
    this.burst(b.x, b.y - 10, 26, '#ffd28a', 230);
    this.floaters.push({ x: b.x, y: b.y - 40, text: 'låga', t: 1, color: '#ffd88a', size: 15 });
    this.cb.onBrazier?.();
    this.save();
    if (this.scene === 'overworld' && this.ringLit() && !this.flags.ringAnnounced) {
      this.flags.ringAnnounced = true;
      this.showToast('Stenringen brinner. Marken öppnar sig i norr.');
      this.cb.onGate?.();
    }
  }

  /* ------------------------------------------------------------- interact */

  npcsNear() {
    const p = this.player;
    if (this.scene !== 'overworld') return null;
    return NPCS.find((n) => dist(p.x, p.y, n.x, n.y) < 84) || null;
  }

  interact() {
    const p = this.player;
    // NPCs first: they're the ones you walked up to.
    const npc = NPCS.find((n) => dist(p.x, p.y, n.x, n.y) < 84);
    if (npc) {
      this.talkTo(npc);
      return;
    }

    // Braziers.
    const brazier = this.braziersHere().find((b) => dist(p.x, p.y, b.x, b.y) < 90);
    if (brazier) {
      if (this.flags.braziers[brazier.id]) this.showToast('Elden brinner.');
      else if (p.item === 'torch') this.lightBrazier(brazier);
      else this.showToast('Du behöver facklan.');
      return;
    }

    // Chests.
    const chest = CHESTS.find((c) => !this.flags.chests[c.id] && dist(p.x, p.y, c.x, c.y) < 70);
    if (chest) {
      this.flags.chests[chest.id] = true;
      this.openChest(chest);
      return;
    }

    // Well: refill oil.
    if (WELLS.some((w) => dist(p.x, p.y, w.x, w.y) < 80)) {
      if (p.oil >= p.maxOil) this.showToast('Flaskan är redan full.');
      else {
        p.oil = p.maxOil;
        this.showToast('Oljan är fylld.');
        this.cb.onPickup?.('oil');
        this.save();
      }
      return;
    }

    // The great fire.
    if (this.scene === 'overworld' && dist(p.x, p.y, VILLAGE_FIRE.x, VILLAGE_FIRE.y) < 110) {
      if (this.flags.fireLit) {
        this.showToast('Byn lever. Du tände den.');
      } else if (this.flags.bossDead) {
        this.lightGreatFire();
      } else {
        this.say('Inga', [
          'Lågan slocknade när vi glömde vårt löfte.',
          'Nere under Stenringen sitter det som håller den. Ta tillbaka den.',
        ]);
      }
      return;
    }

    // Dungeon entrance.
    if (this.scene === 'overworld' && this.nearDungeonEntrance()) {
      if (!this.ringLit()) {
        this.say('Stenringen', [
          'Dörren är kall och stum.',
          'Tre eldar i ringen måste brinna först.',
        ]);
      } else {
        this.loadScene('dungeon', null, false, 0);
        this.showToast('Under Stenringen. Förgården.');
        this.cb.onEnterDungeon?.();
      }
      return;
    }

    // Stairs down / up inside the dungeon.
    if (this.scene === 'dungeon') {
      const f = this.sceneDef;
      if (f.stairs && dist(p.x, p.y, f.stairs.x + f.stairs.w / 2, f.stairs.y + 30) < 70) {
        if (this.floor < DUNGEON.floors.length - 1) {
          this.loadScene('dungeon', null, false, this.floor + 1);
          this.showToast(`Våning ${this.floor + 1}: ${this.sceneDef.name}`);
        } else {
          this.showToast('Det finns ingen väg längre ner.');
        }
        return;
      }
      if (this.floor > 0) {
        const up = this.upStairs();
        if (up && dist(p.x, p.y, up.x, up.y) < 70) {
          this.flags.switchOn = this.floor === 1 ? this.flags.switchOn : this.flags.switchOn;
          this.loadScene('dungeon', null, false, this.floor - 1);
          return;
        }
      } else {
        // Back out to the ring.
        if (dist(p.x, p.y, 650, 770) < 80) {
          this.loadScene('overworld', { x: DUNGEON_ENTRANCE.x + 45, y: DUNGEON_ENTRANCE.y + 110 });
          this.showToast('Stenringen. Kall luft.');
          return;
        }
      }
      this.showToast(f.hint || 'Inget här.');
      return;
    }

    // Breakable pots.
    const pot = POTS.find(
      (q) => !this.flags.pots[`${q.x}-${q.y}`] && dist(p.x, p.y, q.x, q.y) < 46,
    );
    if (pot) {
      this.flags.pots[`${pot.x}-${pot.y}`] = true;
      p.glod += 1;
      this.burst(pot.x, pot.y - 6, 14, '#8a6a4a', 160);
      this.showToast('+1 glöd');
      this.cb.onPickup?.('glod');
      return;
    }

    // Signs are read by walking close; a nudge here reminds you.
    this.showToast('Inget att göra här.');
  }

  upStairs() {
    if (this.scene !== 'dungeon' || this.floor === 0) return null;
    return { x: 650, y: 780 };
  }

  nearDungeonEntrance() {
    const e = DUNGEON_ENTRANCE;
    return dist(this.player.x, this.player.y, e.x + e.w / 2, e.y + e.h + 10) < 110;
  }

  openChest(chest) {
    const p = this.player;
    this.burst(chest.x, chest.y - 16, 22, '#ffe0a0', 200);
    this.cb.onChest?.();
    if (chest.item === 'bow') {
      p.owned.bow = true;
      p.arrows += 8;
      p.item = 'bow';
      this.say('Vedskogens båge', ['En båge, torr och rak.', 'Nu kan du träffa det ögat inte når. (2)']);
      this.cb.onItem?.('bow');
    } else if (chest.item === 'oil') {
      p.maxOil += 2;
      p.oil = p.maxOil;
      this.flags.bonusLantern = true;
      this.say('Oljeflaska', ['Flaskan rymmer mer nu.', 'Du kan bära fem lanternor. (Q)']);
    } else if (chest.item === 'heart') {
      p.maxHp += 1;
      p.hp = p.maxHp;
      this.say('Hjärtats sten', ['Ett hjärta till. Det gör ont lite mindre.']);
      this.cb.onHeart?.();
    } else {
      p.glod += 8;
      this.showToast('+8 glöd');
      this.cb.onPickup?.('glod');
    }
    this.save();
  }

  talkTo(npc) {
    const p = this.player;
    if (npc.action === 'inn') {
      p.hp = p.maxHp;
      p.oil = p.maxOil;
      p.cold = 0;
      this.save();
      this.say(npc.name, ['Vila. Jag håller elden.', 'Du är hel igen. Jag har skrivit ner var du var.']);
      this.cb.onRest?.();
      return;
    }
    if (npc.action === 'smith') {
      const cost = 6 + (p.sword - 1) * 4;
      if (p.sword >= 3) {
        this.say(npc.name, ['Svärdet är så vasst det kan bli här i byn.', 'Mer än så krävs det eld för.']);
      } else if (p.glod >= cost) {
        p.glod -= cost;
        p.sword += 1;
        this.cb.onUpgrade?.(p.sword);
        this.say(npc.name, [
          'Ge mig glöden.',
          `Svärdet sjunger nu. Skada ${p.sword}.`,
        ]);
        this.save();
      } else {
        this.say(npc.name, [
          `Det kostar ${cost} glöd att härda svärdet.`,
          `Du har ${p.glod}. Skuggorna bär glöd — slå dem.`,
        ]);
      }
      return;
    }
    if (npc.action === 'shop') {
      this.openShop();
      return;
    }
    if (npc.action === 'hunter') {
      if (this.litCount() >= 4) {
        if (!this.flags.quests.rurik) {
          this.flags.quests.rurik = true;
          p.maxHp += 1;
          p.hp = p.maxHp;
          this.cb.onHeart?.();
          this.say(npc.name, [
            'Fyra eldar. Du menade det.',
            'Ta detta. Det är från min far. Det håller dig vid liv en gång till.',
          ]);
          this.save();
        } else {
          this.say(npc.name, [`Fyra eldar brinner. ${this.litCount()} av sju.`, 'Mörkret är inte borta, men det viker.']);
        }
      } else {
        this.say(npc.name, [
          'Tänd fyra eldar ute i världen. Stenringen räknas inte — de är redan hans.',
          `Just nu brinner ${this.litCount()} av sju.`,
        ]);
      }
      return;
    }
    this.say(npc.name, npc.lines);
  }

  say(name, lines) {
    this.dialogue = { name, lines, index: 0, char: 0, t: 0 };
    this.mode = 'dialogue';
    this.cb.onDialogue?.(name, lines[0]);
    this.cb.onTalk?.();
  }

  updateDialogue(dt) {
    const d = this.dialogue;
    if (!d) {
      this.mode = 'play';
      return;
    }
    d.t += dt;
    d.char = Math.min(d.lines[d.index].length, d.t * 42);
    const input = this.input;
    if (input.hit('use') || input.hit('attack')) {
      if (d.char < d.lines[d.index].length) {
        d.char = d.lines[d.index].length;
        d.t = 99;
      } else if (d.index < d.lines.length - 1) {
        d.index++;
        d.t = 0;
        d.char = 0;
        this.cb.onDialogue?.(d.name, d.lines[d.index]);
        this.cb.onTalk?.();
      } else {
        this.dialogue = null;
        this.mode = 'play';
        this.cb.onDialogueEnd?.();
      }
    }
  }

  /* ------------------------------------------------------------------ shop */

  openShop() {
    const p = this.player;
    this.shop = {
      index: 0,
      options: [
        { id: 'bombs', name: '3 bomber', cost: 5, apply: () => (p.bombs += 3) },
        { id: 'arrows', name: '8 pilar', cost: 4, apply: () => (p.arrows += 8) },
        { id: 'oil', name: 'Olja (fyll flaskan)', cost: 3, apply: () => (p.oil = p.maxOil) },
        { id: 'heart', name: 'Ett hjärta (tillfälligt)', cost: 10, apply: () => (p.hp = Math.min(p.maxHp, p.hp + 2)) },
      ],
    };
    this.mode = 'shop';
    this.cb.onShop?.(this.shop);
  }

  updateShop() {
    const s = this.shop;
    const input = this.input;
    if (!s) {
      this.mode = 'play';
      return;
    }
    if (input.hit('up')) s.index = (s.index + s.options.length - 1) % s.options.length;
    if (input.hit('down')) s.index = (s.index + 1) % s.options.length;
    if (input.hit('pause') || input.hit('map')) {
      this.shop = null;
      this.mode = 'play';
      this.cb.onShop?.(null);
      return;
    }
    if (input.hit('use') || input.hit('attack')) {
      const opt = s.options[s.index];
      if (this.player.glod >= opt.cost) {
        this.player.glod -= opt.cost;
        opt.apply();
        this.cb.onBuy?.(opt);
        this.cb.onShop?.(this.shop);
      } else {
        this.showToast('Du har inte råd.');
        this.cb.onDenied?.();
      }
    }
    this.cb.onShopTick?.(s);
  }

  /* -------------------------------------------------------------- darkness */

  updateDarkness(dt) {
    const p = this.player;
    const dark = this.dark;
    const safe = this.inHardLight(p.x, p.y);
    const draining = dark > 0.45 && !safe;
    if (draining) {
      p.cold = Math.min(1, p.cold + dt * (0.12 + dark * 0.16));
      if (p.cold >= 1) {
        p.cold = 0;
        if (p.hp > 1) {
          p.hp -= 1;
          p.invuln = INVULN;
          this.shake = 0.5;
          this.floaters.push({ x: p.x, y: p.y - 40, text: 'kylan tar dig', t: 1.2, color: '#a8d8ff', size: 14 });
          this.cb.onCold?.();
        }
      }
    } else {
      p.cold = Math.max(0, p.cold - dt * 0.55);
    }
    this.player.warm = safe;
    // Temporary torch flares burn out.
    for (const l of this.lanterns) {
      if (l.temp) l.temp -= dt;
    }
    this.lanterns = this.lanterns.filter((l) => !(l.temp !== undefined && l.temp <= 0));
  }

  updateLanternFeel(dt) {
    // Nothing heavy here; keeps the light cache honest.
    if (this._lightsKey !== this.lightKey()) {
      this._lights = null;
    }
  }

  updateZoneWatch() {
    if (this.scene !== 'overworld') return;
    const z = this.zone;
    if (z.id !== this._lastZone) {
      this._lastZone = z.id;
      if (this.flags.seen[z.id] === undefined || this._announceZone !== z.id) {
        this._announceZone = z.id;
        this.cb.onZone?.(z);
        this.showToast(z.name);
      }
      this.flags.seen[z.id] = true;
      this.cb.onAutosave?.();
      this.save();
    }
  }

  /* ---------------------------------------------------------------- camera */

  updateCamera(dt, snap = false) {
    const p = this.player;
    const worldW = this.scene === 'overworld' ? WORLD_W : this.sceneDef.w;
    const worldH = this.scene === 'overworld' ? WORLD_H : this.sceneDef.h;
    const targetX = clamp(p.x - this.viewW / 2, 0, Math.max(0, worldW - this.viewW));
    const targetY = clamp(p.y - this.viewH / 2, 0, Math.max(0, worldH - this.viewH));
    if (snap) {
      this.camera.x = targetX;
      this.camera.y = targetY;
    } else {
      const k = Math.min(1, dt * 7);
      this.camera.x = lerp(this.camera.x, targetX, k);
      this.camera.y = lerp(this.camera.y, targetY, k);
    }
    this.camera.zoom = this.zoom;
  }

  /* ------------------------------------------------------------- utility */

  showToast(text) {
    this.toast = { text, t: 3.2 };
    this.cb.onToast?.(text);
  }

  puff(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 60,
        vy: -20 - Math.random() * 40,
        t: 0.4 + Math.random() * 0.5,
        max: 0.9,
        size: 1.5 + Math.random() * 2.5,
        color,
        gravity: -10,
      });
    }
  }

  burst(x, y, n, color, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 20,
        t: 0.3 + Math.random() * 0.5,
        max: 0.8,
        size: 1.5 + Math.random() * 3,
        color,
        gravity: 60,
      });
    }
  }

  updateParticles(dt) {
    for (const pa of this.particles) {
      pa.t -= dt;
      pa.x += pa.vx * dt;
      pa.y += pa.vy * dt;
      pa.vy += (pa.gravity || 0) * dt;
      pa.vx *= Math.pow(0.2, dt);
      pa.vy *= Math.pow(0.5, dt);
    }
    this.particles = this.particles.filter((pa) => pa.t > 0);
    for (const f of this.floaters) {
      f.t -= dt;
      f.y -= dt * 34;
    }
    this.floaters = this.floaters.filter((f) => f.t > 0);
  }

  /* ---------------------------------------------------------------- goals */

  /** What the player should do next. Feeds the HUD line and the compass. */
  objective() {
    const f = this.flags;
    if (f.bossDead && !f.fireLit) return { text: 'Tänd den stora elden i Vedstorp', x: VILLAGE_FIRE.x, y: VILLAGE_FIRE.y };
    if (this.scene === 'dungeon') {
      const fl = this.sceneDef;
      if (fl.boss) return { text: 'Förbannelsen', x: fl.boss.x, y: fl.boss.y };
      if (!this.gateOpen()) {
        if (fl.gate.needs === 'braziers') {
          const b = fl.braziers.find((x) => !f.braziers[x.id]);
          return { text: 'Tänd eldarna på våningen', x: b.x, y: b.y };
        }
        if (fl.gate.needs === 'switch') return { text: 'Skjut ögat i väggen', x: fl.switch.x, y: fl.switch.y };
      }
      return { text: 'Nedåt', x: fl.stairs.x + 35, y: fl.stairs.y + 30 };
    }
    if (!this.ringLit()) {
      const b = BRAZIERS.slice(0, 3).find((x) => !f.braziers[x.id]);
      return { text: `Tänd ringen i Stenringen (${['ring-1', 'ring-2', 'ring-3'].filter((id) => f.braziers[id]).length}/3)`, x: b.x, y: b.y };
    }
    if (!f.bossDead) return { text: 'Ner under Stenringen', x: DUNGEON_ENTRANCE.x + 45, y: DUNGEON_ENTRANCE.y + 80 };
    return { text: 'Tänd den stora elden', x: VILLAGE_FIRE.x, y: VILLAGE_FIRE.y };
  }

  lightGreatFire() {
    this.flags.fireLit = true;
    this.flash = 1;
    this.shake = 0.8;
    this.burst(VILLAGE_FIRE.x, VILLAGE_FIRE.y, 80, '#ffd28a', 420);
    this.mode = 'end';
    this.cb.onVictory?.();
    this.save();
  }

  toVillageAfterWin() {
    this.mode = 'play';
    this.loadScene('overworld', { x: VILLAGE_FIRE.x + 110, y: VILLAGE_FIRE.y + 60 });
    this.showToast('Vedstorp lever. Gå vart du vill.');
  }
}

// Trees are precomputed in world.js; keep a local reference for collisions.
import { TREES } from './world.js';
const TREES_CACHE = TREES;
