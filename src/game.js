// Den sista lågan — game logic.
import { Body, rectsOverlap, dist, clamp, lerp, angleDiff, rng } from './physics.js';
import { ZONES, ITEMS, QUESTS, SHOP } from './world.js';
import { bakeGround, drawScene, drawLighting, drawEffectLayer } from './render.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

const PLAYER = {
  speed: 214,
  accel: 2400,
  friction: 2100,
  w: 22,
  h: 26,
  maxHp: 3,
  atkCd: 0.34,
  swing: 0.22,
  reach: 52,
  arc: 1.35,
  dodgeSpeed: 470,
  dodgeTime: 0.26,
  dodgeCd: 0.75,
  parryWindow: 0.2,
};

const ENEMY = {
  shadow: { hp: 3, speed: 74, r: 15, dmg: 1, range: 36, windup: 0.42, recover: 0.55, ember: 6, h: 34 },
  crawler: { hp: 2, speed: 122, r: 11, dmg: 1, range: 28, windup: 0.28, recover: 0.45, ember: 5, h: 20 },
  guard: { hp: 9, speed: 60, r: 21, dmg: 2, range: 48, windup: 0.72, recover: 0.85, ember: 14, h: 44 },
  warden: { hp: 44, speed: 74, r: 36, dmg: 2, range: 74, windup: 0.78, recover: 0.8, ember: 0, h: 68 },
};

const ITEM_ORDER = ['torch', 'bomb', 'bow'];

export class Game {
  constructor(canvas, input, cb = {}) {
    this.canvas = canvas;
    this.input = input;
    this.cb = cb;
    this.ctx = canvas.getContext('2d');
    this.sound = null;

    this.mode = 'title'; // title | play | dialog | shop | pause | dead | win
    this.time = 0;
    this.cam = { x: 0, y: 0 };
    this.zoom = 1;
    this.hitstop = 0;
    this.shake = 0;
    this.flash = 0;
    this.fade = 0;

    this.flags = this.freshFlags();
    this.player = this.makePlayer();
    this.zoneId = 'village';
    this.zoneDef = ZONES.village;
    this.z = null;
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.effects = [];
    this.lightsCache = [];
    this.dialog = null;
    this.shop = null;
    this.quest = 'torch';
    this.hint = '';
    this.hintTimer = 0;
    this.resize();
    this.loadZone('village', ZONES.village.spawn);
    this.ready = true;
  }

  attachSound(sound) {
    this.sound = sound;
  }

  freshFlags() {
    return {
      torch: false,
      bombs: false,
      bow: false,
      braziers: { fields: false, forest: false, river: false },
      braziersHearth: false,
      freed: { sune: false, alva: false, vidar: false },
      cryptKey: false,
      cryptEntry: false,
      bossDead: false,
      flameLit: false,
      chests: {},
      rubble: {},
      bramble: {},
      switches: {},
      embers: 0,
      hearts: 0,
      edge: 0,
      lantern: 0,
      seenVillage: false,
      quest: 'torch',
      deaths: 0,
    };
  }

  makePlayer() {
    return {
      body: new Body(750, 660, PLAYER.w, PLAYER.h),
      vx: 0,
      vy: 0,
      facing: Math.PI / 2,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      invuln: 0,
      attackCd: 0,
      swingT: 0,
      swingId: 0,
      shielding: false,
      parryT: 0,
      shieldCd: 0,
      stagger: 0,
      dodgeT: 0,
      dodgeCd: 0,
      dodgeDir: { x: 0, y: 1 },
      counter: 0,
      item: 0,
      items: [],
      step: 0,
      lantern: 0,
      burnT: 0,
    };
  }

  /* ------------------------------------------------------------- lifecycle */

  startNew() {
    this.flags = this.freshFlags();
    this.player = this.makePlayer();
    this.quest = 'torch';
    this.mode = 'play';
    this.loadZone('village', ZONES.village.spawn);
    this.say('Hedda', [
      'Du är inte härifrån. Det syns på hur du står.',
      'Byn heter Häll. Förr brann det i varje fönster här.',
      'Vi lovade graven en låga varje vinter. Sedan glömde vi.',
      'Nu har mörkret tagit dem. Alla utom mig.',
      'Ta facklan. Tänd de tre ljusen ute i markerna — då finns det kraft kvar i byn.',
    ]);
    this.setQuest('torch');
  }

  continueGame(data) {
    this.flags = { ...this.freshFlags(), ...data.flags };
    this.player = this.makePlayer();
    this.player.hp = data.hp ?? PLAYER.maxHp;
    this.player.maxHp = data.maxHp ?? PLAYER.maxHp;
    this.player.items = (data.items || []).filter((i) => ITEMS[i]);
    this.player.item = clamp(data.item || 0, 0, Math.max(0, this.player.items.length - 1));
    this.quest = data.quest || this.flags.quest || 'torch';
    this.mode = 'play';
    this.loadZone(data.zone || 'village', { x: data.x ?? 750, y: data.y ?? 660 });
    this.say('Glim', ['Du är tillbaka. Mörkret väntade.', 'Fortsätt där du var.']);
  }

  serialize() {
    const p = this.player;
    return {
      v: 1,
      zone: this.zoneId,
      x: Math.round(p.body.x),
      y: Math.round(p.body.y),
      hp: p.hp,
      maxHp: p.maxHp,
      items: p.items,
      item: p.item,
      quest: this.quest,
      flags: this.flags,
    };
  }

  save() {
    try {
      localStorage.setItem('sistalagan.save.v1', JSON.stringify(this.serialize()));
    } catch {
      /* ignore */
    }
  }

  static loadSave() {
    try {
      const raw = localStorage.getItem('sistalagan.save.v1');
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && data.v === 1 ? data : null;
    } catch {
      return null;
    }
  }

  static hasSave() {
    return !!Game.loadSave();
  }

  static clearSave() {
    try {
      localStorage.removeItem('sistalagan.save.v1');
    } catch {
      /* ignore */
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(480, Math.round(rect.width || 1280));
    this.h = Math.max(320, Math.round(rect.height || 720));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    // Keep roughly 900x640 world pixels on screen.
    this.zoom = clamp(Math.min(this.w / 840, this.h / 540), 0.85, 2.1);
    this.viewW = this.w / this.zoom;
    this.viewH = this.h / this.zoom;
    if (this.lightCanvas) {
      this.lightCanvas.width = Math.round(this.w * dpr);
      this.lightCanvas.height = Math.round(this.h * dpr);
    }
  }

  ensureLightCanvas() {
    if (this.lightCanvas) return;
    this.lightCanvas = document.createElement('canvas');
    this.lightCanvas.width = Math.round(this.w * this.dpr);
    this.lightCanvas.height = Math.round(this.h * this.dpr);
    this.lightCtx = this.lightCanvas.getContext('2d');
  }

  setQuest(id) {
    // Quests only ever move forward: a late hint must never rewind progress.
    const order = QUESTS.map((q) => q.id);
    const next = order.indexOf(id);
    const now = order.indexOf(this.quest);
    if (next >= 0 && now >= 0 && next < now) return;
    this.quest = id;
    this.flags.quest = id;
    const q = QUESTS.find((x) => x.id === id);
    if (q) this.cb.onQuest?.(q);
    this.save();
  }

  advanceQuest() {
    const f = this.flags;
    const litAll = f.braziers.fields && f.braziers.forest && f.braziers.river;
    if (!f.torch || !litAll) return this.setQuest('torch');
    if (!f.cryptEntry) return this.setQuest('crypt');
    if (!f.flameLit) return this.setQuest('flame');
    return this.setQuest('done');
  }

  /* ------------------------------------------------------------------ zone */

  loadZone(id, spawn = null) {
    const def = ZONES[id];
    if (!def) return;
    this.zoneId = id;
    this.zoneDef = def;
    this.z = this.buildZoneState(def);
    this.ground = bakeGround(def);
    this.lightsCache = [];
    this.projectiles.length = 0;
    this.particles.length = 0;
    this.effects.length = 0;
    this.enemies = [];
    this.bossStarted = false;
    this.spawnEnemies();
    const p = this.player;
    const s = spawn || def.spawn;
    p.body.x = s.x;
    p.body.y = s.y;
    p.vx = 0;
    p.vy = 0;
    p.invuln = 1.1;
    p.dodgeT = 0;
    p.stagger = 0;
    p.swingT = 0;
    this.cam.x = clamp(p.body.cx - this.viewW / 2, 0, Math.max(0, def.w - this.viewW));
    this.cam.y = clamp(p.body.cy - this.viewH / 2, 0, Math.max(0, def.h - this.viewH));
    this.exitLock = 0.5;
    this.fade = 1;
    if (id.startsWith('crypt') && !this.flags.cryptEntry) {
      this.flags.cryptEntry = true;
      this.setQuest('flame');
    }
    if (this.ready) this.cb.onZone?.(def, this.z);
    if (id === 'village' && !this.flags.seenVillage) this.flags.seenVillage = true;
    this.save();
  }

  buildZoneState(def) {
    const f = this.flags;
    const st = {
      braziers: [],
      rubble: (def.rubble || []).map((r, i) => ({ ...r, broken: !!f.rubble[`${def.id}:${i}`], idx: i })),
      brambles: (def.brambles || []).map((b, i) => ({ ...b, burnt: !!f.bramble[`${def.id}:${i}`], idx: i })),
      gates: (def.gates || []).map((g) => ({ ...g, open: !!f.switches[g.id] })),
      switches: (def.switches || []).map((s) => ({ ...s, hit: !!f.switches[s.id] })),
      chests: (def.chests || []).map((c) => ({ ...c, opened: !!f.chests[c.id] })),
      statues: (def.statues || []).map((s) => ({ ...s })).filter((s) => !f.freed[s.id]),
      npcs: (def.npcs || []).filter((n) => !n.after || f.freed[n.after]).map((n) => ({ ...n })),
      altar: def.altar ? { ...def.altar, lit: !!f.flameLit } : null,
    };
    if (def.brazier) {
      const lit = def.brazier.id === 'hearth' ? !!f.braziersHearth : !!f.braziers[def.brazier.id];
      st.braziers.push({ ...def.brazier, lit, hearth: def.brazier.id === 'hearth' });
    }
    for (const b of def.braziers || []) {
      st.braziers.push({ ...b, lit: !!f.braziers[b.id] });
    }
    return st;
  }

  spawnEnemies() {
    if (this.zoneDef.boss) {
      if (!this.flags.bossDead && !this.bossStarted) {
        // The warden wakes when the player walks toward the altar.
      }
      return;
    }
    for (const e of this.zoneDef.enemies || []) this.enemies.push(this.makeEnemy(e.kind, e.x, e.y));
  }

  makeEnemy(kind, x, y) {
    const def = ENEMY[kind] || ENEMY.shadow;
    return {
      kind,
      body: new Body(x - def.r, y - def.r, def.r * 2, def.r * 2),
      def,
      hp: def.hp * (1 + this.flags.deaths * 0.02),
      maxHp: def.hp,
      state: 'idle',
      stateT: 0,
      vx: 0,
      vy: 0,
      facing: 0,
      hitBy: -1,
      burnT: 0,
      flash: 0,
      staggerT: 0,
      bob: Math.random() * TAU,
      phase: 1,
      attackAngle: 0,
      dead: false,
      spawnGrace: 0.4,
    };
  }

  /** Everything the player collides with right now. */
  solids() {
    const out = [];
    for (const p of this.zoneDef.props || []) if (p.solid) out.push(p.solid);
    for (const w of this.zoneDef.walls || []) out.push(w);
    for (const w of this.waterSolids()) out.push(w);
    for (const g of this.z.gates) if (!g.open) out.push({ x: g.x, y: g.y, w: g.w, h: g.h });
    for (const r of this.z.rubble) if (!r.broken) out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
    for (const b of this.z.brambles) if (!b.burnt) out.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    for (const b of this.z.braziers) out.push({ x: b.x - 16, y: b.y - 12, w: 32, h: 20 });
    for (const c of this.z.chests) if (!c.opened) out.push({ x: c.x - 16, y: c.y - 12, w: 32, h: 18 });
    for (const s of this.z.statues) out.push(s.solid);
    for (const n of this.z.npcs) out.push({ x: n.x - 11, y: n.y - 10, w: 22, h: 16 });
    if (this.z.altar) out.push({ x: this.z.altar.x - 34, y: this.z.altar.y - 16, w: 68, h: 30 });
    return out;
  }

  /** Water collides everywhere except where a bridge crosses it. */
  waterSolids() {
    const out = [];
    for (const w of this.zoneDef.water || []) {
      const bridges = (this.zoneDef.bridges || []).filter((b) => rectsOverlap(b, w));
      if (!bridges.length) {
        out.push(w);
        continue;
      }
      const xs = [
        w.x,
        w.x + w.w,
        ...bridges.flatMap((b) => [clamp(b.x, w.x, w.x + w.w), clamp(b.x + b.w, w.x, w.x + w.w)]),
      ].sort((a, b) => a - b);
      for (let i = 0; i < xs.length - 1; i++) {
        const x0 = xs[i];
        const x1 = xs[i + 1];
        if (x1 - x0 < 0.5) continue;
        const covered = bridges
          .filter((b) => b.x <= x0 + 0.5 && b.x + b.w >= x1 - 0.5)
          .map((b) => [Math.max(b.y, w.y), Math.min(b.y + b.h, w.y + w.h)])
          .sort((a, b) => a[0] - b[0]);
        let y = w.y;
        for (const [a, b] of covered) {
          if (a > y) out.push({ x: x0, y, w: x1 - x0, h: a - y });
          y = Math.max(y, b);
        }
        if (y < w.y + w.h) out.push({ x: x0, y, w: x1 - x0, h: w.y + w.h - y });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ light */

  lightSources() {
    const out = [];
    const p = this.player;
    const lampR = 168 + p.lantern * 46;
    out.push({ x: p.body.cx, y: p.body.cy, r: lampR, warm: 0.85, player: true });
    for (const b of this.z.braziers) {
      if (!b.lit) continue;
      out.push({ x: b.x, y: b.y - 14, r: b.hearth ? 430 : b.r * 5.2, warm: b.hearth ? 1 : 0.9 });
    }
    if (this.z.altar && this.z.altar.lit) out.push({ x: this.z.altar.x, y: this.z.altar.y, r: 520, warm: 1 });
    for (const l of this.zoneDef.lights || []) out.push(l);
    for (const pr of this.projectiles) if (pr.kind === 'flame') out.push({ x: pr.x, y: pr.y, r: 96, warm: 0.8 });
    return out;
  }

  lightAt(x, y) {
    const lights = this.lightsCache.length ? this.lightsCache : this.lightSources();
    let best = 0;
    for (const l of lights) {
      const d = dist(x, y, l.x, l.y);
      if (d > l.r) continue;
      const t = 1 - d / l.r;
      best = Math.max(best, t * t * (l.warm ?? 1));
    }
    const ambient = 1 - (this.zoneDef.dark || 0);
    return clamp(Math.max(best, ambient * 0.55), 0, 1);
  }

  /* ----------------------------------------------------------------- update */

  update(dt) {
    this.time += dt;
    this.lightsCache = this.lightSources();
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.fade = Math.max(0, this.fade - dt * 2);
    this.hintTimer = Math.max(0, this.hintTimer - dt);
    this.exitLock = Math.max(0, (this.exitLock || 0) - dt);

    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      return;
    }

    if (this.mode === 'dialog') {
      this.updateDialog();
      this.updateParticles(dt);
      return;
    }
    if (this.mode === 'shop') {
      this.updateShop();
      return;
    }
    if (this.mode !== 'play') {
      this.updateParticles(dt);
      return;
    }

    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateParticles(dt);
    this.updateEffects(dt);
    this.updateZoneLogic(dt);
    this.updateCamera(dt);
    this.checkExits();
    if (this.input.hit('pause')) this.cb.onPause?.();
  }

  updatePlayer(dt) {
    const p = this.player;
    const input = this.input;
    const b = p.body;
    const solids = this.solids();
    const axis = input.axis;

    p.invuln = Math.max(0, p.invuln - dt);
    p.attackCd = Math.max(0, p.attackCd - dt);
    p.shieldCd = Math.max(0, p.shieldCd - dt);
    p.dodgeCd = Math.max(0, p.dodgeCd - dt);
    p.stagger = Math.max(0, p.stagger - dt);
    p.counter = Math.max(0, p.counter - dt);
    p.burnT = Math.max(0, p.burnT - dt);
    if (p.swingT > 0) p.swingT = Math.max(0, p.swingT - dt);
    if (p.parryT > 0) p.parryT = Math.max(0, p.parryT - dt);

    // Facing follows movement, and the swing locks it a little.
    if (axis.x || axis.y) {
      const target = Math.atan2(axis.y, axis.x);
      if (p.stagger <= 0 && p.swingT <= 0) p.facing = this.turnToward(p.facing, target, dt * 16);
      p.step += dt * Math.hypot(axis.x, axis.y) * 7;
    }

    // Dodge.
    if (input.hit('dodge') && p.dodgeCd <= 0 && p.stagger <= 0) {
      p.dodgeT = PLAYER.dodgeTime;
      p.dodgeCd = PLAYER.dodgeCd;
      p.invuln = Math.max(p.invuln, PLAYER.dodgeTime + 0.06);
      const dir = axis.x || axis.y ? axis : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      const len = Math.hypot(dir.x, dir.y) || 1;
      p.dodgeDir = { x: dir.x / len, y: dir.y / len };
      this.sound?.swing();
      for (let i = 0; i < 6; i++) this.dust(b.cx, b.cy + 10, 1);
    }

    // Movement.
    let speedScale = 1;
    if (p.shielding) speedScale *= 0.55;
    if (this.lightAt(b.cx, b.cy) < 0.22) speedScale *= 0.82;
    if (p.dodgeT > 0) {
      p.dodgeT = Math.max(0, p.dodgeT - dt);
      b.vx = p.dodgeDir.x * PLAYER.dodgeSpeed;
      b.vy = p.dodgeDir.y * PLAYER.dodgeSpeed;
      if (Math.random() < 0.5) this.dust(b.cx, b.cy + 8, 0.8);
    } else if (p.stagger > 0) {
      b.vx *= Math.pow(0.02, dt);
      b.vy *= Math.pow(0.02, dt);
    } else {
      const targetVx = axis.x * PLAYER.speed * speedScale;
      const targetVy = axis.y * PLAYER.speed * speedScale;
      const a = (axis.x || axis.y ? PLAYER.accel : PLAYER.friction) * dt;
      b.vx = this.approach(b.vx, targetVx, a);
      b.vy = this.approach(b.vy, targetVy, a);
    }
    b.move(b.vx * dt, b.vy * dt, solids);
    b.x = clamp(b.x, 8, this.zoneDef.w - b.w - 8);
    b.y = clamp(b.y, 8, this.zoneDef.h - b.h - 8);

    // Combat.
    p.shielding = input.down('shield') && p.stagger <= 0 && p.swingT <= 0 && p.dodgeT <= 0;
    if (input.hit('shield') && p.shieldCd <= 0 && p.stagger <= 0) {
      p.parryT = PLAYER.parryWindow;
      p.shieldCd = 0.3;
    }
    if (input.hit('attack') && p.attackCd <= 0 && p.stagger <= 0 && p.dodgeT <= 0) {
      p.swingT = PLAYER.swing;
      p.attackCd = PLAYER.atkCd;
      p.swingId++;
      p.shielding = false;
      this.sound?.swing();
      this.effects.push({ type: 'swing', x: b.cx, y: b.cy, a: p.facing, life: 0.22, maxLife: 0.22, reach: PLAYER.reach });
    }
    if (p.swingT > 0) this.resolveSwing();

    // Items.
    if (input.hit('cycle') && p.items.length > 0) {
      p.item = (p.item + 1) % p.items.length;
      this.sound?.ui();
      this.cb.onSelect?.(p.items[p.item]);
    }
    for (let i = 0; i < 3; i++) {
      if (input.hit(`slot${i + 1}`) && i < p.items.length) {
        p.item = i;
        this.sound?.ui();
        this.cb.onSelect?.(p.items[i]);
      }
    }
    if (input.hit('item')) this.useItem();
    if (input.hit('interact')) this.interact();

    p.lantern = this.flags.lantern;
  }

  turnToward(a, b, maxStep) {
    const d = angleDiff(b, a);
    return a + clamp(d, -maxStep, maxStep);
  }

  approach(v, target, step) {
    if (v < target) return Math.min(target, v + step);
    if (v > target) return Math.max(target, v - step);
    return target;
  }

  resolveSwing() {
    const p = this.player;
    const b = p.body;
    const dmg = (1 + (this.flags.edge ? 1 : 0)) * (p.counter > 0 ? 2 : 1);
    for (const e of this.enemies) {
      if (e.dead || e.hitBy === p.swingId) continue;
      const d = dist(b.cx, b.cy, e.body.cx, e.body.cy);
      if (d > PLAYER.reach + e.def.r) continue;
      const ang = Math.atan2(e.body.cy - b.cy, e.body.cx - b.cx);
      if (Math.abs(angleDiff(ang, p.facing)) > PLAYER.arc) continue;
      e.hitBy = p.swingId;
      this.damageEnemy(e, dmg, ang, 240);
      p.counter = 0;
    }
  }

  useItem() {
    const p = this.player;
    if (!p.items.length || p.attackCd > 0.05) return;
    const item = p.items[p.item];
    if (item === 'torch') {
      if (p.attackCd > 0.1) return;
      p.attackCd = 0.42;
      this.projectiles.push({
        kind: 'flame',
        x: p.body.cx + Math.cos(p.facing) * 20,
        y: p.body.cy + Math.sin(p.facing) * 20,
        vx: Math.cos(p.facing) * 430,
        vy: Math.sin(p.facing) * 430,
        life: 0.75,
        r: 12,
        damage: 1,
      });
      this.sound?.fire();
    } else if (item === 'bomb') {
      if (p.attackCd > 0.1) return;
      p.attackCd = 0.5;
      this.projectiles.push({
        kind: 'bomb',
        x: p.body.cx + Math.cos(p.facing) * 26,
        y: p.body.cy + Math.sin(p.facing) * 26,
        vx: 0,
        vy: 0,
        life: 1.35,
        r: 10,
      });
      this.sound?.ui();
    } else if (item === 'bow') {
      if (p.attackCd > 0.1) return;
      p.attackCd = 0.46;
      this.projectiles.push({
        kind: 'arrow',
        x: p.body.cx + Math.cos(p.facing) * 22,
        y: p.body.cy + Math.sin(p.facing) * 22,
        vx: Math.cos(p.facing) * 640,
        vy: Math.sin(p.facing) * 640,
        life: 1.15,
        r: 6,
        damage: 2,
        angle: p.facing,
      });
      this.sound?.swing();
    }
  }

  damageEnemy(e, dmg, ang, knock = 200) {
    e.hp -= dmg;
    e.flash = 0.2;
    e.body.vx += Math.cos(ang) * knock;
    e.body.vy += Math.sin(ang) * knock;
    this.hitstop = Math.max(this.hitstop, 0.05);
    this.shake = Math.max(this.shake, 0.28);
    this.spark(e.body.cx, e.body.cy, 8);
    this.sound?.hit();
    if (e.hp <= 0) this.killEnemy(e);
    else if (e.kind === 'guard' || e.kind === 'warden') e.state = e.state === 'windup' ? e.state : 'chase';
    else e.staggerT = Math.max(e.staggerT, 0.12);
  }

  killEnemy(e) {
    e.dead = true;
    this.dissolve(e.body.cx, e.body.cy, e.def.r);
    this.sound?.die();
    this.flags.embers += e.def.ember;
    this.cb.onEmbers?.(this.flags.embers);
    if (e.kind === 'warden') {
      this.flags.bossDead = true;
      this.bossStarted = false;
      this.shake = 1;
      this.flash = 0.8;
      this.sound?.win();
      this.say('Gravens väktare', ['…lågan är din. Ta den.', 'Byn glömde. Du glömde inte.']);
      this.cb.onBoss?.(false);
      this.save();
    }
  }

  damagePlayer(dmg, fromX, fromY, opts = {}) {
    const p = this.player;
    if (p.invuln > 0 || this.mode !== 'play') return false;
    const ang = Math.atan2(p.body.cy - fromY, p.body.cx - fromX);
    // Parry.
    if (p.parryT > 0 && !opts.unblockable) {
      const facingDiff = Math.abs(angleDiff(ang, p.facing + Math.PI));
      if (facingDiff < 1.2) {
        p.parryT = 0;
        p.counter = 2.2;
        p.invuln = 0.35;
        p.shieldCd = 0.1;
        this.hitstop = 0.1;
        this.shake = 0.5;
        this.flash = 0.35;
        this.effects.push({ type: 'parry', x: p.body.cx, y: p.body.cy, life: 0.5, maxLife: 0.5 });
        this.spark(p.body.cx + Math.cos(ang) * 18, p.body.cy + Math.sin(ang) * 18, 16, '#ffe9a8');
        this.sound?.parry();
        this.cb.onParry?.();
        return 'parry';
      }
    }
    // Block.
    if (p.shielding) {
      const facingDiff = Math.abs(angleDiff(ang, p.facing + Math.PI));
      if (facingDiff < 1.35) {
        p.invuln = 0.3;
        p.stagger = 0.18;
        p.shieldCd = 0.35;
        this.shake = 0.25;
        this.spark(p.body.cx + Math.cos(ang) * 16, p.body.cy + Math.sin(ang) * 16, 6, '#cfe6ff');
        this.sound?.block();
        return 'block';
      }
    }
    p.hp -= dmg;
    p.invuln = 1.0;
    p.stagger = 0.22;
    p.counter = 0;
    p.body.vx = Math.cos(ang) * 210;
    p.body.vy = Math.sin(ang) * 210;
    this.shake = 0.7;
    this.flash = 0.4;
    this.sound?.hurt();
    this.cb.onDamage?.(p.hp, p.maxHp);
    if (p.hp <= 0) this.die();
    return 'hit';
  }

  die() {
    this.flags.deaths++;
    this.mode = 'dead';
    this.sound?.die();
    this.cb.onDeath?.();
  }

  respawn() {
    const p = this.player;
    p.hp = p.maxHp;
    p.invuln = 1.4;
    this.mode = 'play';
    const spot = this.zoneId.startsWith('crypt') ? 'village' : this.zoneId;
    const spawn = spot === 'village' ? { x: 750, y: 660 } : ZONES[spot].spawn;
    this.loadZone(spot, spawn);
  }

  updateEnemies(dt) {
    const p = this.player;
    const solids = this.solids();
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = e.def;
      e.flash = Math.max(0, e.flash - dt);
      e.stateT += dt;
      e.bob += dt * 3;

      if (e.kind === 'warden' && e.phase === 1 && e.hp <= e.maxHp * 0.5) {
        e.phase = 2;
        e.state = 'windup';
        e.stateT = -0.6;
        this.sound?.bossRoar();
        this.shake = 0.8;
        this.flash = 0.5;
        this.showHint('Väktaren reser sig igen.');
      }

      // Shadows burn in strong light.
      const light = this.lightAt(e.body.cx, e.body.cy);
      if ((e.kind === 'shadow' || e.kind === 'crawler') && light > 0.55) {
        e.burnT += dt;
        if (e.burnT > 0.55) {
          e.burnT = 0;
          this.damageEnemy(e, 1, Math.atan2(e.body.cy - p.body.cy, e.body.cx - p.body.cx), 60);
          this.spark(e.body.cx, e.body.cy, 6, '#ffd28a');
          if (e.dead) continue;
        }
      } else {
        e.burnT = Math.max(0, e.burnT - dt * 0.5);
      }

      if (e.staggerT > 0) {
        e.staggerT -= dt;
        e.body.vx *= Math.pow(0.02, dt);
        e.body.vy *= Math.pow(0.02, dt);
        e.body.move(e.body.vx * dt, e.body.vy * dt, solids);
        continue;
      }

      const distToP = dist(e.body.cx, e.body.cy, p.body.cx, p.body.cy);
      const ang = Math.atan2(p.body.cy - e.body.cy, p.body.cx - e.body.cx);

      if (e.state === 'idle') {
        if (distToP < 430) {
          e.state = 'chase';
          e.stateT = 0;
        }
      } else if (e.state === 'chase') {
        const speed = d.speed * (e.kind === 'warden' && e.phase === 2 ? 1.25 : 1);
        e.facing = this.turnToward(e.facing, ang, dt * 6);
        const wobble = e.kind === 'crawler' ? Math.sin(e.bob * 4) * 0.5 : 0;
        e.body.vx = Math.cos(ang + wobble) * speed;
        e.body.vy = Math.sin(ang + wobble) * speed;
        // Keep a little distance when winding up.
        if (distToP < d.range * 0.75) {
          e.body.vx *= 0.2;
          e.body.vy *= 0.2;
        }
        if (distToP < d.range && e.stateT > 0.25) {
          e.state = 'windup';
          e.stateT = 0;
          e.attackAngle = ang;
          this.cb.onTelegraph?.(e);
        }
        if (e.kind === 'warden' && e.phase === 2 && e.stateT > 2.4 && Math.random() < dt * 1.4) {
          this.wardenSummon(e);
        }
      } else if (e.state === 'windup') {
        e.body.vx *= Math.pow(0.05, dt);
        e.body.vy *= Math.pow(0.05, dt);
        if (e.stateT >= d.windup) {
          e.state = 'strike';
          e.stateT = 0;
          this.enemyStrike(e);
        }
      } else if (e.state === 'strike') {
        if (e.stateT > 0.16) {
          e.state = 'recover';
          e.stateT = 0;
        }
      } else if (e.state === 'recover') {
        e.body.vx *= Math.pow(0.1, dt);
        e.body.vy *= Math.pow(0.1, dt);
        if (e.stateT >= d.recover) {
          e.state = 'chase';
          e.stateT = 0;
        }
      }

      e.body.move(e.body.vx * dt, e.body.vy * dt, solids);
      e.body.x = clamp(e.body.x, 8, this.zoneDef.w - e.body.w - 8);
      e.body.y = clamp(e.body.y, 8, this.zoneDef.h - e.body.h - 8);
    }
    this.enemies = this.enemies.filter((e) => !e.dead);

    // Boss wake-up.
    if (this.zoneDef.bossSpawn && !this.flags.bossDead && !this.bossStarted) {
      const p2 = this.player.body;
      if (dist(p2.cx, p2.cy, this.zoneDef.bossSpawn.x, this.zoneDef.bossSpawn.y) < 320) {
        this.bossStarted = true;
        const w = this.makeEnemy('warden', this.zoneDef.bossSpawn.x, this.zoneDef.bossSpawn.y);
        w.state = 'chase';
        this.enemies.push(w);
        this.sound?.bossRoar();
        this.shake = 0.8;
        this.cb.onBoss?.(true, w);
      }
    }
  }

  wardenSummon(e) {
    for (let i = 0; i < 2; i++) {
      const a = rand(0, TAU);
      const c = this.makeEnemy('crawler', e.body.cx + Math.cos(a) * 90, e.body.cy + Math.sin(a) * 90);
      c.state = 'chase';
      this.enemies.push(c);
      this.dissolve(c.body.cx, c.body.cy, c.def.r, '#8a7ad0');
    }
    this.sound?.bossRoar();
  }

  enemyStrike(e) {
    const p = this.player;
    const d = e.def;
    const distToP = dist(e.body.cx, e.body.cy, p.body.cx, p.body.cy);
    const ang = Math.atan2(p.body.cy - e.body.cy, p.body.cx - e.body.cx);
    this.effects.push({
      type: 'strike',
      x: e.body.cx,
      y: e.body.cy,
      a: ang,
      life: 0.24,
      maxLife: 0.24,
      reach: d.range + 18,
      big: e.kind === 'warden',
    });
    if (distToP < d.range + 16) {
      // The player can be hit only if roughly in front of the attacker.
      if (Math.abs(angleDiff(ang, e.facing)) < 1.5) this.damagePlayer(d.dmg, e.body.cx, e.body.cy);
    }
    if (e.kind === 'warden') this.shake = Math.max(this.shake, 0.5);
  }

  updateProjectiles(dt) {
    const p = this.player;
    for (const pr of this.projectiles) {
      pr.life -= dt;
      if (pr.kind === 'bomb') {
        pr.vx *= Math.pow(0.02, dt);
        pr.vy *= Math.pow(0.02, dt);
        if (pr.life <= 0) this.explode(pr);
        continue;
      }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (pr.kind === 'flame') {
        pr.vx *= Math.pow(0.55, dt);
        pr.vy *= Math.pow(0.55, dt);
        if (Math.random() < 0.7) this.particles.push(this.particle(pr.x, pr.y, rand(-30, 30), rand(-40, 10), 0.35, rand(2, 4), '#ffb45c'));
      }
      for (const b of this.z.braziers) {
        if (!b.lit && pr.kind === 'flame' && dist(pr.x, pr.y, b.x, b.y - 10) < 46) {
          this.lightBrazier(b);
          pr.life = 0;
        }
      }
      for (const br of this.z.brambles) {
        if (br.burnt) continue;
        if (pr.x > br.x && pr.x < br.x + br.w && pr.y > br.y && pr.y < br.y + br.h) {
          if (pr.kind === 'flame') this.burnBramble(br, 'fackla');
          pr.life = 0;
        }
      }
      for (const s of this.z.switches) {
        if (!s.hit && pr.kind === 'arrow' && dist(pr.x, pr.y, s.x, s.y) < 26) {
          s.hit = true;
          this.flags.switches[s.id] = true;
          this.sound?.pickup();
          this.burst(s.x, s.y, 10, '#ffe9a8');
          this.openGates('switch');
          pr.life = 0;
        }
      }
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (dist(pr.x, pr.y, e.body.cx, e.body.cy) < e.def.r + pr.r) {
          const ang = Math.atan2(pr.vy, pr.vx);
          this.damageEnemy(e, pr.damage, ang, pr.kind === 'arrow' ? 150 : 90);
          pr.life = 0;
          if (pr.kind === 'flame') this.burst(pr.x, pr.y, 8, '#ffb45c');
        }
      }
      if (pr.kind === 'bomb' || pr.kind === 'arrow' || pr.kind === 'flame') {
        const hitWall = this.solids().some((s) => pr.x > s.x && pr.x < s.x + s.w && pr.y > s.y && pr.y < s.y + s.h);
        if (hitWall) {
          if (pr.kind === 'bomb') pr.life = Math.min(pr.life, 0.05);
          else pr.life = 0;
        }
      }
      if (pr.x < 0 || pr.x > this.zoneDef.w || pr.y < 0 || pr.y > this.zoneDef.h) pr.life = 0;
    }
    this.projectiles = this.projectiles.filter((pr) => pr.life > 0);
  }

  explode(pr) {
    this.sound?.bossRoar();
    this.shake = 0.6;
    this.flash = 0.3;
    this.burst(pr.x, pr.y, 26, '#ffca7a', 320);
    this.effects.push({ type: 'bomb', x: pr.x, y: pr.y, life: 0.4, maxLife: 0.4, r: 118 });
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist(pr.x, pr.y, e.body.cx, e.body.cy);
      if (d < 118 + e.def.r) {
        const ang = Math.atan2(e.body.cy - pr.y, e.body.cx - pr.x);
        this.damageEnemy(e, 3, ang, 380);
      }
    }
    for (const r of this.z.rubble) {
      if (r.broken) continue;
      const nx = clamp(pr.x, r.x, r.x + r.w);
      const ny = clamp(pr.y, r.y, r.y + r.h);
      if (dist(pr.x, pr.y, nx, ny) < 60) this.breakRubble(r);
    }
  }

  updateZoneLogic(dt) {
    // Altar burning = ending.
    if (this.z.altar && this.z.altar.lit && this.mode === 'play' && !this.flags.flameLit) {
      this.flags.flameLit = true;
      this.setQuest('done');
      this.save();
    }
    // Bramble regrowth is off; braziers keep burning.
    for (const b of this.z.braziers) {
      if (b.lit && Math.random() < dt * 6) {
        this.particles.push(
          this.particle(b.x + rand(-8, 8), b.y - 16, rand(-12, 12), rand(-50, -18), rand(0.5, 1), rand(1.4, 2.8), Math.random() < 0.5 ? '#ffc46a' : '#ffe9b0'),
        );
      }
    }
  }

  updateCamera(dt) {
    const p = this.player.body;
    const tx = clamp(p.cx - this.viewW / 2, 0, Math.max(0, this.zoneDef.w - this.viewW));
    const ty = clamp(p.cy - this.viewH / 2, 0, Math.max(0, this.zoneDef.h - this.viewH));
    const k = 1 - Math.pow(0.0009, dt);
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);
  }

  checkExits() {
    if (this.exitLock > 0) return;
    const p = this.player.body;
    for (const ex of this.zoneDef.exits || []) {
      if (!rectsOverlap(p.rect(), ex)) continue;
      if (ex.to.startsWith('crypt') && !this.flags.cryptKey) {
        this.showHint('Dörren är låst. Hedda har nyckeln.');
        return;
      }
      this.loadZone(ex.to, ex.spawn);
      return;
    }
  }

  /* ------------------------------------------------------------- interaction */

  nearby() {
    const p = this.player.body;
    const list = [];
    // Useful things win over scenery when both are close.
    for (const n of this.z.npcs) list.push({ kind: 'npc', prio: 0, d: dist(p.cx, p.cy, n.x, n.y), o: n });
    for (const b of this.z.braziers) list.push({ kind: 'brazier', prio: 0, d: dist(p.cx, p.cy, b.x, b.y), o: b });
    for (const c of this.z.chests) if (!c.opened) list.push({ kind: 'chest', prio: 0, d: dist(p.cx, p.cy, c.x, c.y), o: c });
    for (const s of this.z.statues) list.push({ kind: 'statue', prio: 2, d: dist(p.cx, p.cy, s.x, s.y), o: s });
    if (this.z.altar && !this.z.altar.lit) list.push({ kind: 'altar', prio: 0, d: dist(p.cx, p.cy, this.z.altar.x, this.z.altar.y), o: this.z.altar });
    if (this.zoneDef.cryptDoor) {
      const cd = this.zoneDef.cryptDoor;
      list.push({ kind: 'cryptDoor', prio: 0, d: dist(p.cx, p.cy, cd.x + cd.w / 2, cd.y + cd.h / 2), o: cd });
    }
    for (const r of this.z.rubble) if (!r.broken) list.push({ kind: 'rubble', prio: 1, d: dist(p.cx, p.cy, r.x + r.w / 2, r.y + r.h / 2), o: r });
    list.sort((a, b) => (a.prio ?? 1) - (b.prio ?? 1) || a.d - b.d);
    return list.find((x) => x.d < 74) || null;
  }

  interact() {
    const near = this.nearby();
    if (!near) return;
    const p = this.player;
    if (near.kind === 'npc') return this.talkTo(near.o);
    if (near.kind === 'brazier') return this.tryLightBrazier(near.o);
    if (near.kind === 'chest') return this.openChest(near.o);
    if (near.kind === 'statue') {
      return this.say(near.o.name, ['…hon sover i sten. Ljuset kan väcka henne.']);
    }
    if (near.kind === 'altar') {
      if (!this.flags.bossDead) return this.say('Lågan', ['Något håller lågan fången. Det andas i mörkret.']);
      this.z.altar.lit = true;
      this.flags.flameLit = true;
      this.flash = 1;
      this.shake = 0.6;
      this.sound?.win();
      this.burst(this.z.altar.x, this.z.altar.y, 40, '#ffd98a', 260);
      this.setQuest('done');
      this.save();
      this.cb.onWin?.(this.serialize());
      return;
    }
    if (near.kind === 'cryptDoor') {
      if (!this.flags.cryptKey) return this.say('Kyrkdörren', ['Låst. Hedda har nyckeln till graven.']);
      return this.loadZone('crypt1', ZONES.crypt1.spawn);
    }
    if (near.kind === 'rubble') {
      return this.showHint('Rasmassor. Bara en explosion kan flytta dem.');
    }
  }

  talkTo(npc) {
    if (npc.shop) return this.openShop();
    const f = this.flags;
    if (npc.id === 'hedda') {
      const lit = f.braziers.fields && f.braziers.forest && f.braziers.river;
      if (!f.torch) {
        f.torch = true;
        this.player.items = ['torch'];
        this.player.item = 0;
        this.cb.onItem?.('torch');
        return this.say('Hedda', [
          'Ta den här. Den har legat i min hand i tre nätter.',
          'Facklan tänder det som en gång brann. Tryck L för att kasta en flamma.',
          'Börja med Fälten västerut. Sune är där ute, förstenad som de andra.',
        ]);
      }
      if (!lit) {
        return this.say('Hedda', [
          `Ljusen: Fälten ${f.braziers.fields ? '✓' : '—'}, Skogen ${f.braziers.forest ? '✓' : '—'}, Bäcken ${f.braziers.river ? '✓' : '—'}.`,
          'Varje ljus väcker en av dem. Skynda dig, mitt hjärta orkar inte vänta länge.',
        ]);
      }
      if (!f.cryptKey) {
        f.cryptKey = true;
        this.save();
        return this.say('Hedda', [
          'Alla tre brinner. Jag känner värmen ända hit.',
          'Ta nyckeln. Graven ligger under kyrkan, öster om torget.',
          'Den första lågan finns längst ner. Tänd den, och byn är vår igen.',
        ]);
      }
      if (f.flameLit) return this.say('Hedda', ['Lågan brinner. Hör du? Hela byn andas igen.']);
      return this.say('Hedda', ['Ner i graven med dig. Jag håller hjärtat vid liv så länge jag kan.']);
    }
    if (npc.id === 'smed') return this.openShop();
    if (npc.id === 'barn') {
      return this.say('Lilla Ester', ['Mamma säger att solen finns bakom berget.', 'Kan du hämta den?']);
    }
    if (npc.id === 'sune') return this.say('Sune', ['Bomberna var mina. Nu är de dina.', 'Spräng rasmassorna i kyrkan — jag orkar inte gå dit själv.']);
    if (npc.id === 'alva') return this.say('Alva', ['Jag hörde pilen innan jag såg bågen.', 'Skjut något långt bort åt mig också.']);
    if (npc.id === 'vidar') return this.say('Vidar', ['Vattnet gav mig tillbaka hjärtat.', 'Ta det. Du behöver det mer än jag.']);
    return this.say(npc.name, ['…']);
  }

  tryLightBrazier(b) {
    if (b.lit) return this.say(b.name || 'Ljuset', ['Det brinner redan.']);
    if (!this.flags.torch) return this.showHint('Du har inget att tända med.');
    return this.lightBrazier(b);
  }

  lightBrazier(b) {
    if (b.lit) return;
    b.lit = true;
    if (b.hearth) {
      this.flags.braziersHearth = true;
    } else {
      this.flags.braziers[b.id] = true;
    }
    this.sound?.lightBrazier();
    this.flash = 0.4;
    this.shake = 0.3;
    this.burst(b.x, b.y - 10, 24, '#ffd98a', 200);
    this.cb.onLight?.(b);
    this.onBrazierLit(b);
    this.save();
  }

  onBrazierLit(b) {
    const f = this.flags;
    const statue = this.z.statues.find((s) => Math.abs(s.x - b.x) < 220 && Math.abs(s.y - b.y) < 240);
    if (statue) this.freeStatue(statue);
    const litAll = f.braziers.fields && f.braziers.forest && f.braziers.river;
    if (litAll && !f.cryptKey) {
      this.showHint('Alla tre ljusen brinner. Hedda väntar i byn.');
    } else if (!litAll) {
      const left = 3 - [f.braziers.fields, f.braziers.forest, f.braziers.river].filter(Boolean).length;
      this.showHint(`${left} ljus kvar.`);
    }
    this.setQuest(litAll ? 'crypt' : 'torch');
  }

  freeStatue(statue) {
    const f = this.flags;
    f.freed[statue.id] = true;
    this.z.statues = this.z.statues.filter((s) => s !== statue);
    this.burst(statue.x, statue.y, 30, '#ffe1a8', 180);
    this.sound?.pickup();
    if (statue.id === 'sune') {
      f.bombs = true;
      if (!this.player.items.includes('bomb')) this.player.items.push('bomb');
      this.say('Sune', ['Jag… lever? Du tände ljuset.', 'Ta bomberna. De spränger det som sten inte klarar.', 'Tryck 2 för att välja dem, L för att lägga en.']);
      this.setQuest('fields');
    } else if (statue.id === 'alva') {
      f.bow = true;
      if (!this.player.items.includes('bow')) this.player.items.push('bow');
      this.say('Alva', ['Jag hörde elden i sömnen.', 'Ta bågen. Den når dit armen inte räcker.', 'Tryck 3 för att välja den, L för att skjuta.']);
      this.setQuest('forest');
    } else if (statue.id === 'vidar') {
      this.player.maxHp += 1;
      this.player.hp = this.player.maxHp;
      this.say('Vidar', ['Vattnet släppte mig.', 'Och jag har ett hjärta över. Ta det.']);
      this.setQuest('river');
    }
    this.cb.onItem?.(statue.id);
    this.cb.onHud?.();
    this.save();
  }

  openChest(c) {
    c.opened = true;
    this.flags.chests[c.id] = true;
    const loot = c.loot || {};
    if (loot.glow) {
      this.flags.embers += loot.glow;
      this.showHint(`+${loot.glow} glöd`);
      this.cb.onEmbers?.(this.flags.embers);
    }
    this.sound?.pickup();
    this.burst(c.x, c.y - 10, 14, '#ffe9a8', 150);
    this.save();
  }

  burnBramble(b, source) {
    if (b.burnt) return;
    b.burnt = true;
    this.flags.bramble[`${this.zoneId}:${b.idx}`] = true;
    this.burst(b.x + b.w / 2, b.y + b.h / 2, 18, '#ffbe72', 160);
    this.sound?.fire();
    if (source === 'svärd') this.showHint('Svärdet rår inte på törnen. Eld tar dem.');
  }

  breakRubble(r) {
    if (r.broken) return;
    r.broken = true;
    this.flags.rubble[`${this.zoneId}:${r.idx}`] = true;
    this.burst(r.x + r.w / 2, r.y + r.h / 2, 30, '#c9c2b4', 240);
    this.sound?.door();
    this.showHint('Vägen är öppen.');
    this.save();
  }

  openGates(key) {
    for (const g of this.z.gates) {
      if (g.key !== key || g.open) continue;
      g.open = true;
      this.sound?.door();
      this.burst(g.x + g.w / 2, g.y + g.h / 2, 16, '#ffe9a8', 160);
    }
  }

  /* ------------------------------------------------------------------- shop */

  openShop() {
    this.mode = 'shop';
    this.shop = { index: 0, items: SHOP, message: '' };
    this.sound?.ui();
    this.cb.onShop?.(this.shop);
  }

  updateShop() {
    const s = this.shop;
    if (!s) {
      this.mode = 'play';
      return;
    }
    if (this.input.hit('down')) {
      s.index = (s.index + 1) % s.items.length;
      this.sound?.ui();
    }
    if (this.input.hit('up')) {
      s.index = (s.index + s.items.length - 1) % s.items.length;
      this.sound?.ui();
    }
    if (this.input.hit('interact') || this.input.hit('attack')) {
      this.buy(s.items[s.index]);
    }
    if (this.input.hit('pause') || this.input.hit('cycle')) this.closeShop();
    this.cb.onShop?.(s);
  }

  buy(item) {
    const f = this.flags;
    if (!item) return;
    if (f[`bought-${item.id}`] && !item.repeat) {
      this.shop.message = 'Redan köpt.';
      return;
    }
    if (f.embers < item.cost) {
      this.shop.message = 'Du har inte tillräckligt med glöd.';
      this.sound?.block();
      return;
    }
    f.embers -= item.cost;
    f[`bought-${item.id}`] = true;
    if (item.id === 'heart') {
      this.player.maxHp += 1;
      this.player.hp = this.player.maxHp;
    } else if (item.id === 'edge') {
      f.edge = 1;
    } else if (item.id === 'light') {
      f.lantern = 1;
    } else if (item.id === 'heal') {
      this.player.hp = this.player.maxHp;
    }
    this.sound?.pickup();
    this.shop.message = `${item.name} — klart.`;
    this.cb.onEmbers?.(f.embers);
    this.cb.onHud?.();
    this.save();
  }

  closeShop() {
    this.shop = null;
    this.mode = 'play';
    this.cb.onShop?.(null);
  }

  /* ----------------------------------------------------------------- dialog */

  say(name, lines) {
    this.dialog = { name, lines, i: 0 };
    this.mode = 'dialog';
    this.cb.onDialog?.(this.dialog);
    this.sound?.ui();
  }

  updateDialog() {
    if (this.input.hit('interact') || this.input.hit('attack')) {
      const d = this.dialog;
      if (!d) {
        this.mode = 'play';
        return;
      }
      if (d.i < d.lines.length - 1) {
        d.i++;
        this.sound?.ui();
        this.cb.onDialog?.(d);
      } else {
        this.dialog = null;
        this.mode = 'play';
        this.cb.onDialog?.(null);
      }
    }
  }

  /* ------------------------------------------------------------- fx helpers */

  particle(x, y, vx, vy, life, size, color, gravity = 0) {
    return { x, y, vx, vy, life, max: life, size, color, gravity };
  }

  dust(x, y, scale = 1) {
    this.particles.push(this.particle(x + rand(-6, 6), y, rand(-30, 30), rand(-18, 4), rand(0.3, 0.6), rand(2, 5) * scale, 'rgba(214,205,180,0.5)'));
  }

  spark(x, y, n, color = '#ffe9a8') {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = rand(60, 260);
      this.particles.push(this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.2, 0.5), rand(1.5, 3), color, 260));
    }
  }

  burst(x, y, n, color = '#ffd98a', speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = rand(speed * 0.25, speed);
      this.particles.push(this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.35, 0.9), rand(2, 5), color, 90));
    }
  }

  dissolve(x, y, r, color = '#9a8ac8') {
    for (let i = 0; i < 18; i++) {
      const a = rand(0, TAU);
      const s = rand(20, 120);
      this.particles.push(this.particle(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, Math.cos(a) * s, Math.sin(a) * s - 30, rand(0.4, 1), rand(2, 5), color, -40));
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.gravity || 0) * dt;
      p.vx *= Math.pow(0.4, dt);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  updateEffects(dt) {
    for (const e of this.effects) e.life -= dt;
    this.effects = this.effects.filter((e) => e.life > 0);
  }

  showHint(text) {
    this.hint = text;
    this.hintTimer = 3;
    this.cb.onToast?.(text);
  }

  /* ------------------------------------------------------------------- draw */

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const shake = this.shake * this.shake * 10;
    const camX = Math.round(this.cam.x + rand(-shake, shake));
    const camY = Math.round(this.cam.y + rand(-shake, shake));
    this.ensureLightCanvas();
    drawScene(ctx, this, camX, camY);
    drawLighting(ctx, this, camX, camY);
    drawEffectLayer(ctx, this, camX, camY);
  }
}
