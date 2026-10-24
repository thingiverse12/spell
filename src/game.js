// SPELL — a Hollow Knight-ish cave platformer.
// Owns the world state, combat, and all rendering.

import { Body, moveBody, rectsOverlap, GRAVITY } from './physics.js';
import { WORLD, SOLIDS, ROCKS, SPIKES, BENCHES, PLAYER_SPAWN, ENEMY_SPAWNS, CHARM, LIGHTS } from './world.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const sign = (v) => (v < 0 ? -1 : 1);

const VIEW = { w: 1280, h: 720 };

const PHYS = {
  run: 330,
  runWater: 210,
  accelGround: 3000,
  accelAir: 1900,
  jump: 800,
  gravity: 2350,
  maxFall: 1150,
  dashSpeed: 740,
  dashTime: 0.17,
  jumpCut: 0.45,
};

/* ------------------------------------------------------------------ queries */

function movingHitbox(h) {
  return { x: h.body.x, y: h.body.y, w: h.body.w, h: h.body.h };
}

const ENEMIES = {
  crawler: {
    w: 46,
    h: 30,
    hp: 42,
    speed: 54,
    contact: 16,
    geo: 4,
    shape: 'crawler',
  },
  flyer: {
    w: 42,
    h: 36,
    hp: 30,
    speed: 88,
    contact: 14,
    geo: 3,
    shape: 'flyer',
  },
  husk: {
    w: 46,
    h: 70,
    hp: 84,
    speed: 74,
    contact: 20,
    geo: 6,
    shape: 'husk',
  },
  spitter: {
    w: 40,
    h: 62,
    hp: 48,
    speed: 0,
    contact: 14,
    geo: 5,
    shape: 'spitter',
  },
  guardian: {
    w: 74,
    h: 104,
    hp: 290,
    speed: 96,
    contact: 26,
    geo: 30,
    shape: 'guardian',
  },
};

export class Game {
  constructor(canvas, input, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.cb = callbacks;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = VIEW.w;
    this.h = VIEW.h;
    this.time = 0;
    this.mode = 'title'; // title | play | bench | paused | dead | won

    this.stone = 0;
    this.best = Number(localStorage.getItem('spell.stone') || 0);
    this.soul = 0;
    this.ending = false;
    this.stats = { deaths: 0, kills: 0 };

    this.cam = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y };
    this.shake = 0;
    this.hitstop = 0;
    this.flash = 0;
    this.darkFlash = 0;
    this.hintTimer = 0;
    this.hint = '';
    this.prompt = '';
    this.focus = 0;
    this.focusTarget = null;

    this.solids = SOLIDS;
    this.plats = SOLIDS.filter((s) => s.kind === 'floor');
    this.spikes = SPIKES;
    this.benches = BENCHES.map((b) => ({ ...b, w: 90, h: 34 }));
    this.charm = { ...CHARM, taken: false, t: 0 };

    this.enemies = [];
    this.projectiles = [];
    this.spells = [];
    this.particles = [];
    this.texts = [];
    this.fx = [];

    this.spawnDust();
    this.resize();
    this.reset(true);
  }

  /* ------------------------------------------------------------- lifecycle */

  reset(full = false) {
    this.player = this.makePlayer();
    this.enemies = ENEMY_SPAWNS.map((s, i) => this.makeEnemy(s, i));
    this.projectiles.length = 0;
    this.spells.length = 0;
    this.particles.length = 0;
    this.fx.length = 0;
    this.texts.length = 0;
    this.charm = { ...CHARM, taken: false, t: 0 };
    this.soul = 0;
    this.ending = false;
    this.cam.x = this.player.body.cx;
    this.cam.y = this.player.body.cy;
    this.hintTimer = 0;
    this.mode = 'title';
    if (full) this.stats = { deaths: 0, kills: 0 };
  }

  makePlayer() {
    const b = new Body(PLAYER_SPAWN.x, PLAYER_SPAWN.y - 46, 30, 46);
    return {
      body: b,
      maxHp: 5,
      hp: 5,
      facing: 1,
      invuln: 0.4,
      hurtLock: 0,
      dash: 0,
      dashCd: 0,
      dashDir: 1,
      dashUsed: false,
      attacking: 0,
      attackDir: 'side',
      attackCd: 0,
      attackHit: new Set(),
      recoil: 0,
      airJump: true,
      animTime: 0,
      landSquash: 0,
      bench: null,
      respawn: { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y },
    };
  }

  makeEnemy(spawn, i) {
    const def = ENEMIES[spawn.type];
    const b = new Body(spawn.x, spawn.y - def.h, def.w, def.h);
    return {
      id: i,
      type: spawn.type,
      def,
      body: b,
      home: { x: spawn.x, y: spawn.y - def.h },
      min: spawn.min,
      max: spawn.max,
      hp: def.hp,
      maxHp: def.hp,
      dead: false,
      dieT: 0,
      flash: 0,
      stunned: 0,
      state: 'idle',
      t: rand(0, 10),
      dir: -1,
      cooldown: rand(0.4, 1.6),
      alert: false,
      animT: 0,
      phase: rand(0, TAU),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(480, Math.round(rect.width));
    this.h = Math.max(320, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  start() {
    this.mode = 'play';
    this.cb.onStart?.();
  }

  setMode(mode) {
    this.mode = mode;
    this.cb.onMode?.(mode);
  }

  playerRect() {
    return movingHitbox(this.player);
  }

  /* ---------------------------------------------------------------- update */

  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.darkFlash = Math.max(0, this.darkFlash - dt * 2);
    this.hintTimer = Math.max(0, this.hintTimer - dt);
    if (this.focus > 0) this.focus = Math.max(0, this.focus - dt);

    this.updateParticles(dt);
    this.updateTexts(dt);
    this.charm.t += dt;

    // Hitstop: the world crawls for a few frames when the nail connects, so
    // every hit lands with weight. Input still registers during the slowdown.
    let scale = 1;
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      scale = 0.14;
    }
    const sdt = dt * scale;

    if (this.mode === 'play' || this.mode === 'bench' || this.mode === 'won') {
      if (this.mode !== 'won') this.updatePlayer(sdt);
      this.updateEnemies(sdt);
      this.updateProjectiles(sdt);
      this.updateSpells(sdt);
      this.checkInteractions(sdt);
    }
    this.updateCamera(dt);
  }

  /* ---------------------------------------------------------------- player */

  updatePlayer(dt) {
    const p = this.player;
    const b = p.body;
    const input = this.input;
    const frozen = this.mode === 'bench';

    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtLock = Math.max(0, p.hurtLock - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.attackCd = Math.max(0, p.attackCd - dt);
    p.attacking = Math.max(0, p.attacking - dt);
    p.recoil = Math.max(0, p.recoil - dt * 6);
    p.landSquash = Math.max(0, p.landSquash - dt * 6);
    p.animTime += dt;
    if (p.invuln <= 0) p.attackHit.clear();

    const wasGround = b.onGround;
    if (!frozen && p.dash <= 0) {
      // Horizontal movement.
      let dir = input.axis;
      const target = dir * PHYS.run;
      const accel = b.onGround ? PHYS.accelGround : PHYS.accelAir;
      const diff = target - b.vx;
      const step = accel * dt;
      b.vx += Math.abs(diff) < step ? diff : sign(diff) * step;
      if (dir !== 0) p.facing = dir;
    }

    // Gravity, jump and jump-cut.
    if (p.dash > 0) {
      p.dash -= dt;
      b.vx = p.dashDir * PHYS.dashSpeed;
      b.vy = 0;
      if (p.dash <= 0) b.vx *= 0.55;
    } else {
      const rising = b.vy < 0;
      const cut = rising && !input.down('jump');
      b.vy = Math.min(PHYS.maxFall, b.vy + PHYS.gravity * (cut ? 2.1 : 1) * dt);
    }

    if (input.hit('jump') && !frozen) {
      if (b.onGround || b.coyote > 0.09) {
        b.vy = -PHYS.jump;
        b.onGround = false;
        b.coyote = 0;
        p.airJump = true;
        p.landSquash = -0.6;
        this.puff(b.cx, b.bottom, 6, '#9ff3ff');
        this.cb.onJump?.();
      } else if (p.airJump) {
        p.airJump = false;
        b.vy = -PHYS.jump * 0.94;
        for (let i = 0; i < 10; i++) {
          const a = Math.PI + rand(-0.7, 0.7);
          this.particles.push(this.particle(b.cx, b.bottom, Math.cos(a) * rand(60, 190), Math.sin(a) * rand(30, 130), 0.36, rand(2, 4), '#bff6ff'));
        }
        this.cb.onDoubleJump?.();
      }
    }

    // Dash.
    if (input.hit('dash') && !frozen && p.dashCd <= 0 && p.dash <= 0) {
      p.dash = PHYS.dashTime;
      p.dashDir = p.facing;
      p.dashCd = 0.52;
      p.dashUsed = true;
      p.invuln = Math.max(p.invuln, PHYS.dashTime + 0.04);
      this.fx.push({ type: 'dash', x: b.cx, y: b.cy, dir: p.facing, life: 0.3, max: 0.3 });
      this.cb.onDash?.();
    }

    // Attack.
    if ((input.hit('attack')) && p.attackCd <= 0 && p.dash <= 0 && !frozen) {
      this.startAttack();
    }

    // Spell: spend soul on a wisp that flies through enemies.
    p.spellCd = Math.max(0, (p.spellCd || 0) - dt);
    if (input.hit('spell') && !frozen && p.spellCd <= 0 && p.dash <= 0) {
      if (this.soul >= 33) {
        this.soul -= 33;
        p.spellCd = 0.45;
        const dirX = p.facing;
        this.spells.push({
          x: b.cx + dirX * 22,
          y: b.cy - 6,
          vx: dirX * 620,
          vy: 0,
          life: 0.85,
          r: 16,
          damage: 34,
          facing: dirX,
          hit: new Set(),
        });
        this.fx.push({ type: 'death', x: b.cx + dirX * 22, y: b.cy - 6, r: 4, max: 46, life: 0.35, max_life: 0.35 });
        this.burst(b.cx + dirX * 22, b.cy - 6, 14, '#bfefff', 190);
        this.cb.onSpell?.();
      } else {
        this.cb.onNoSoul?.();
      }
    }

    // Focus: stand still and hold F to trade soul for a mask.
    const wantsFocus = input.down('focus') && b.onGround && Math.abs(b.vx) < 40 && this.soul >= 33 && p.hp < p.maxHp && !frozen && p.attacking <= 0;
    if (wantsFocus) {
      p.focusT = (p.focusT || 0) + dt;
      if (Math.random() < dt * 30) {
        this.particles.push(this.particle(b.cx + rand(-14, 14), b.cy + rand(-24, 16), rand(-20, 20), rand(-90, -30), 0.5, rand(1.5, 3), '#bdf6ff'));
      }
      if (p.focusT >= 0.9) {
        p.focusT = 0;
        this.soul = Math.max(0, this.soul - 33);
        p.hp = Math.min(p.maxHp, p.hp + 1);
        this.burst(b.cx, b.cy, 20, '#d8fbff', 170);
        this.fx.push({ type: 'death', x: b.cx, y: b.cy, r: 6, max: 70, life: 0.5, max_life: 0.5 });
        this.cb.onFocus?.();
      }
    } else {
      p.focusT = Math.max(0, (p.focusT || 0) - dt * 2);
    }

    // Integrate.
    b.moveX(b.vx * dt, this.solids);
    const falling = b.vy;
    b.moveY(b.vy * dt, this.solids);
    b.coyote = b.onGround ? 0.1 : Math.max(0, b.coyote - dt);

    if (!wasGround && b.onGround) {
      p.airJump = true;
      if (falling > 380) {
        p.landSquash = 1;
        this.puff(b.cx, b.bottom, 8, '#8fd8ff');
        this.shake = Math.max(this.shake, 0.18);
        this.cb.onLand?.();
      }
    }

    // Keep the knight inside the world.
    b.x = clamp(b.x, 0, WORLD.w - b.w);
    if (b.y > WORLD.h + 200) this.killPlayer(true);

    // Spike damage.
    for (const sp of this.spikes) {
      if (rectsOverlap(this.playerRect(), sp)) {
        this.hurtPlayer(1, b.cx + (b.cx < sp.x + sp.w / 2 ? -1 : 1) * 200);
        break;
      }
    }

    // Attack hitbox resolution.
    if (p.attacking > 0) this.resolveAttack();
  }

  startAttack() {
    const p = this.player;
    const b = p.body;
    let dir = 'side';
    if (this.input.down('up')) dir = 'up';
    else if (this.input.down('down') && !b.onGround) dir = 'down';
    p.attackDir = dir;
    p.attacking = 0.2;
    p.attackCd = 0.32;
    p.attackHit.clear();
    if (dir === 'down' && !b.onGround) {
      b.vy = Math.max(b.vy, 320);
    } else if (dir === 'side') {
      b.vx += p.facing * 40;
    }
    this.fx.push({ type: 'slash', dir, face: p.facing, life: 0.2, max: 0.2, id: Math.random() });
    this.cb.onSwing?.();
  }

  attackHitbox() {
    const p = this.player;
    const b = p.body;
    if (p.attackDir === 'up') return { x: b.x - 6, y: b.y - 52, w: b.w + 12, h: 60 };
    if (p.attackDir === 'down') return { x: b.x - 4, y: b.bottom - 4, w: b.w + 8, h: 58 };
    return {
      x: p.facing > 0 ? b.x + b.w - 4 : b.x - 56,
      y: b.y - 2,
      w: 60,
      h: b.h + 4,
    };
  }

  resolveAttack() {
    const p = this.player;
    const b = p.body;
    const hit = this.attackHitbox();

    for (const e of this.enemies) {
      if (e.dead || p.attackHit.has(e)) continue;
      if (!rectsOverlap(hit, e.body)) continue;
      p.attackHit.add(e);
      this.hitstop = 0.055;
      const dmg = 11;
      this.damageEnemy(e, dmg, p.facing);
      this.soul = clamp(this.soul + 11, 0, 99);
      this.shake = Math.max(this.shake, 0.3);
      this.flash = Math.max(this.flash, 0.22);
      this.hitSpark(e.body.cx, e.body.cy, p.facing, p.attackDir);
      this.cb.onHit?.();
      if (p.attackDir === 'down') {
        b.vy = -PHYS.jump * 0.86;
        p.airJump = true;
        p.dashUsed = false;
        p.dashCd = 0;
      } else if (p.attackDir === 'side') {
        b.vx = -p.facing * 210;
        if (!b.onGround) b.vy = Math.min(b.vy, -80);
      }
    }

    // Cut projectiles out of the air.
    for (const pr of this.projectiles) {
      if (pr.dead || !rectsOverlap(hit, { x: pr.x - 9, y: pr.y - 9, w: 18, h: 18 })) continue;
      pr.dead = true;
      this.burst(pr.x, pr.y, 8, '#c9b6ff');
    }
  }

  damageEnemy(e, amount, dir) {
    e.hp -= amount;
    e.flash = 1;
    e.stunned = Math.max(e.stunned, 0.16);
    e.body.vx = dir * 210;
    if (e.type !== 'guardian' || e.body.onGround) e.body.vy = Math.min(e.body.vy, -120);
    if (e.hp <= 0 && !e.dead) this.killEnemy(e);
  }

  killEnemy(e) {
    e.dead = true;
    e.dieT = 0.45;
    this.stats.kills += 1;
    this.stone += e.def.geo;
    this.soul = clamp(this.soul + 12, 0, 99);
    this.texts.push({ x: e.body.cx, y: e.body.cy - 20, text: `+${e.def.geo}`, color: '#eaf6ff', life: 0.8, max: 0.8 });
    this.burst(e.body.cx, e.body.cy, e.type === 'guardian' ? 40 : 20, '#cfeeff', e.type === 'guardian' ? 320 : 210);
    this.fx.push({ type: 'death', x: e.body.cx, y: e.body.cy, r: 10, max: e.type === 'guardian' ? 190 : 90, life: 0.45, max_life: 0.45 });
    this.shake = Math.max(this.shake, e.type === 'guardian' ? 0.9 : 0.32);
    this.cb.onKill?.(e);
  }

  hurtPlayer(amount, knockX) {
    const p = this.player;
    const b = p.body;
    if (p.invuln > 0 || this.mode !== 'play') return;
    p.hp = Math.max(0, p.hp - amount);
    p.invuln = 1.15;
    p.hurtLock = 0.24;
    b.vx = knockX * 1.1;
    b.vy = -300;
    this.shake = Math.max(this.shake, 0.8);
    this.flash = Math.max(this.flash, 0.75);
    this.burst(b.cx, b.cy, 18, '#8fe8ff', 240);
    this.texts.push({ x: b.cx, y: b.cy - 34, text: `-${amount}`, color: '#ff9db4', life: 0.9, max: 0.9 });
    this.cb.onHurt?.();
    if (p.hp <= 0) this.killPlayer();
  }

  killPlayer(fell = false) {
    if (this.mode !== 'play') return;
    const p = this.player;
    const b = p.body;
    this.mode = 'dead';
    this.stats.deaths += 1;
    this.burst(b.cx, b.cy, 46, '#bfefff', 340);
    this.fx.push({ type: 'death', x: b.cx, y: b.cy, r: 12, max: 230, life: 0.8, max_life: 0.8 });
    this.shake = 1.2;
    this.darkFlash = 1;
    if (this.stone > this.best) {
      this.best = this.stone;
      localStorage.setItem('spell.stone', String(this.best));
    }
    const respawnBench = this.lastBench || PLAYER_SPAWN;
    this.respawnPoint = { x: respawnBench.x + 20, y: respawnBench.y };
    this.cb.onDeath?.({ fell, stone: this.stone });
  }

  respawn() {
    const p = this.player;
    const point = this.respawnPoint || PLAYER_SPAWN;
    p.body.x = point.x;
    p.body.y = point.y - p.body.h - 2;
    p.body.vx = 0;
    p.body.vy = 0;
    p.hp = p.maxHp;
    p.invuln = 1;
    this.soul = 0;
    this.mode = 'play';
    this.cam.x = p.body.cx;
    this.cam.y = p.body.cy;
    for (const e of this.enemies) {
      if (!e.dead) {
        e.body.x = e.home.x;
        e.body.y = e.home.y;
        e.hp = e.maxHp;
        e.body.vx = 0;
        e.body.vy = 0;
        e.alert = false;
      }
    }
    this.cb.onRespawn?.();
  }

  /* --------------------------------------------------------------- enemies */

  updateEnemies(dt) {
    const p = this.player;
    const b = p.body;

    for (const e of this.enemies) {
      if (e.dead) {
        e.dieT -= dt;
        continue;
      }
      const eb = e.body;
      e.t += dt;
      e.animT += dt;
      e.flash = Math.max(0, e.flash - dt * 4);
      e.stunned = Math.max(0, e.stunned - dt);
      e.cooldown = Math.max(0, e.cooldown - dt);

      const dx = b.cx - eb.cx;
      const dy = b.cy - eb.cy;
      const dist = Math.hypot(dx, dy);
      if (!e.alert && dist < 520 && Math.abs(dy) < 260) e.alert = true;

      if (e.type === 'flyer') this.updateFlyer(e, dt, dx, dy, dist);
      else if (e.type === 'spitter') this.updateSpitter(e, dt, dx, dy, dist);
      else this.updateWalker(e, dt, dx, dist);

      eb.x = clamp(eb.x, e.min - 120, e.max + 120);
      if (eb.onGround && e.type !== 'flyer') {
        // Ledge guard: do not walk into pits.
        const ahead = eb.cx + Math.sign(eb.vx || 1) * (eb.w / 2 + 10);
        const probe = { x: ahead - 2, y: eb.bottom + 6, w: 4, h: 22 };
        const ground = this.solids.some((s) => rectsOverlap(probe, s));
        if (!ground && e.state !== 'charge') eb.vx = 0;
      }

      if (eb.y > WORLD.h + 300) {
        e.dead = true;
        e.dieT = 0;
      }

      // Contact damage.
      if (this.mode === 'play' && rectsOverlap(this.playerRect(), eb) && e.stunned <= 0.02) {
        this.hurtPlayer(e.type === 'guardian' ? 2 : 1, sign(b.cx - eb.cx));
      }
    }

    this.enemies = this.enemies.filter((e) => !(e.dead && e.dieT <= 0));
  }

  updateWalker(e, dt, dx, dist) {
    const eb = e.body;
    if (e.stunned > 0) {
      eb.vx *= 0.9;
    } else if (e.alert) {
      e.dir = sign(dx);
      eb.vx = e.dir * e.def.speed;
      if (e.type === 'guardian') {
        if (e.cooldown <= 0 && Math.abs(dx) < 300 && eb.onGround) {
          e.cooldown = 2.2;
          e.state = 'leap';
          eb.vy = -740;
          eb.vx = e.dir * e.def.speed * 3;
          this.cb.onGuardian?.();
        }
        if (e.state === 'leap' && eb.onGround) e.state = 'idle';
      } else if (e.cooldown <= 0 && dist < 150 && Math.random() < 0.9) {
        e.cooldown = 1.8;
        eb.vy = -320;
      }
    } else {
      eb.vx = lerp(eb.vx, 0, Math.min(1, dt * 6));
    }
    moveBody(eb, dt, this.solids);
    if (eb.hitWall) e.dir = -e.dir;
  }

  updateFlyer(e, dt, dx, dy, dist) {
    const eb = e.body;
    const tx = this.player.body.cx + Math.cos(e.t * 0.9 + e.phase) * 40;
    const ty = this.player.body.cy - 70 + Math.sin(e.t * 1.4 + e.phase) * 36;
    if (e.alert) {
      eb.vx = lerp(eb.vx, clamp((tx - eb.cx) * 2.2, -e.def.speed * 1.4, e.def.speed * 1.4), Math.min(1, dt * 2));
      eb.vy = lerp(eb.vy, clamp((ty - eb.cy) * 2.2, -e.def.speed, e.def.speed), Math.min(1, dt * 2));
      e.dir = sign(dx);
    } else {
      const hx = e.home.x + Math.sin(e.t * 0.8 + e.phase) * 120;
      const hy = e.home.y + Math.sin(e.t * 1.3) * 46;
      eb.vx = lerp(eb.vx, (hx - eb.cx) * 1.6, Math.min(1, dt * 2));
      eb.vy = lerp(eb.vy, (hy - eb.cy) * 1.6, Math.min(1, dt * 2));
    }
    eb.moveX(eb.vx * dt, this.solids);
    eb.moveY(eb.vy * dt, this.solids);
  }

  updateSpitter(e, dt, dx, dy, dist) {
    const eb = e.body;
    e.dir = sign(dx);
    if (!eb.onGround) eb.vy = Math.min(900, eb.vy + 2000 * dt);
    eb.moveY(eb.vy * dt, this.solids);
    if (e.alert && e.cooldown <= 0 && dist < 640 && Math.abs(dy) < 300) {
      e.cooldown = 1.9;
      const a = Math.atan2(this.player.body.cy - eb.cy, this.player.body.cx - eb.cx);
      this.projectiles.push({
        x: eb.cx + Math.cos(a) * 22,
        y: eb.cy - 6 + Math.sin(a) * 22,
        vx: Math.cos(a) * 330,
        vy: Math.sin(a) * 330,
        life: 3,
        dead: false,
      });
      this.cb.onSpit?.();
    }
  }

  updateSpells(dt) {
    for (const sp of this.spells) {
      sp.life -= dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.r += dt * 26;
      if (Math.random() < 0.9) {
        this.particles.push(this.particle(sp.x - sp.facing * 10, sp.y + rand(-8, 8), rand(-40, 40), rand(-30, 30), rand(0.18, 0.4), rand(2, 4), '#cdf3ff'));
      }
      for (const e of this.enemies) {
        if (e.dead || sp.hit.has(e)) continue;
        if (!rectsOverlap({ x: sp.x - sp.r, y: sp.y - sp.r, w: sp.r * 2, h: sp.r * 2 }, e.body)) continue;
        sp.hit.add(e);
        this.damageEnemy(e, sp.damage, sp.facing);
        this.hitstop = 0.06;
        this.hitSpark(e.body.cx, e.body.cy, sp.facing, 'side');
        this.cb.onSpellHit?.();
      }
      for (const solid of this.solids) {
        if (sp.x > solid.x && sp.x < solid.x + solid.w && sp.y > solid.y && sp.y < solid.y + solid.h) {
          sp.life = 0;
          this.burst(sp.x, sp.y, 10, '#bfefff', 150);
          break;
        }
      }
    }
    this.spells = this.spells.filter((sp) => sp.life > 0);
  }

  updateProjectiles(dt) {
    const p = this.player;
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (pr.life <= 0) pr.dead = true;
      if (Math.random() < 0.6) {
        this.particles.push(this.particle(pr.x, pr.y, rand(-14, 14), rand(-14, 14), 0.3, rand(1.5, 2.6), '#c8b4ff'));
      }
      for (const s of this.solids) {
        if (pr.x > s.x && pr.x < s.x + s.w && pr.y > s.y && pr.y < s.y + s.h) {
          pr.dead = true;
          this.burst(pr.x, pr.y, 5, '#a78bff');
          break;
        }
      }
      if (pr.dead) continue;
      if (rectsOverlap({ x: pr.x - 8, y: pr.y - 8, w: 16, h: 16 }, this.playerRect())) {
        pr.dead = true;
        this.hurtPlayer(1, sign(p.body.cx - pr.x));
      }
    }
    this.projectiles = this.projectiles.filter((p2) => !p2.dead);
  }

  /* ---------------------------------------------------------- interactions */

  checkInteractions(dt) {
    const p = this.player;
    const b = p.body;
    this.prompt = '';

    // Bench.
    p.bench = null;
    for (const bench of this.benches) {
      const rect = { x: bench.x, y: bench.y - 40, w: bench.w, h: 76 };
      if (rectsOverlap(this.playerRect(), rect)) {
        p.bench = bench;
        this.prompt = 'Sitt vid bänken';
        if (this.input.hit('interact') && this.mode === 'play') {
          p.hp = p.maxHp;
          this.soul = 0;
          this.lastBench = { x: bench.x + 20, y: bench.y };
          this.setMode('bench');
          this.burst(b.cx, b.cy, 24, '#ffe6a6', 160);
          this.cb.onBench?.();
        }
        break;
      }
    }

    // Charm pickup.
    if (!this.charm.taken && this.dist(b.cx, b.cy, this.charm.x, this.charm.y) < 62) {
      this.charm.taken = true;
      this.ending = true;
      this.fx.push({ type: 'death', x: this.charm.x, y: this.charm.y, r: 6, max: 260, life: 1.1, max_life: 1.1 });
      this.burst(this.charm.x, this.charm.y, 50, '#ffe6a6', 260);
      this.shake = 0.9;
      this.flash = 1;
      this.setMode('won');
      if (this.stone > this.best) {
        this.best = this.stone;
        localStorage.setItem('spell.stone', String(this.best));
      }
      this.cb.onWin?.({ stone: this.stone, time: this.time });
    }
  }

  dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  /* ----------------------------------------------------------------- camera */

  updateCamera(dt) {
    const p = this.player;
    const b = p.body;
    const lookAhead = clamp(b.vx * 0.36, -150, 150);
    const targetX = b.cx + lookAhead - this.w / 2;
    const targetY = b.cy - 40 - this.h * 0.56 + clamp(b.vy * 0.09, -60, 90);
    const k = Math.min(1, dt * 4.6);
    this.cam.x = lerp(this.cam.x, targetX, k);
    this.cam.y = lerp(this.cam.y, targetY, k);
    this.cam.x = clamp(this.cam.x, 0, Math.max(0, WORLD.w - this.w));
    this.cam.y = clamp(this.cam.y, 0, Math.max(0, WORLD.h - this.h));
  }

  /* -------------------------------------------------------------------- fx */

  particle(x, y, vx, vy, life, size, color, gravity = 0) {
    return { x, y, vx, vy, life, max: life, size, color, gravity };
  }

  burst(x, y, n, color, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = rand(speed * 0.3, speed);
      this.particles.push(this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.85), rand(1.4, 3.6), color, 420));
    }
  }

  puff(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-1.1, 1.1);
      this.particles.push(this.particle(x + rand(-10, 10), y, Math.cos(a) * rand(40, 140), Math.sin(a) * rand(20, 90), rand(0.2, 0.45), rand(1.6, 3), color, 300));
    }
  }

  hitSpark(x, y, dir, attackDir) {
    this.fx.push({ type: 'spark', x, y, dir, attackDir, life: 0.24, max: 0.24 });
    for (let i = 0; i < 12; i++) {
      const a = attackDir === 'up' ? -Math.PI / 2 : attackDir === 'down' ? Math.PI / 2 : (dir > 0 ? 0 : Math.PI);
      const spread = a + rand(-0.9, 0.9);
      this.particles.push(this.particle(x, y, Math.cos(spread) * rand(80, 320), Math.sin(spread) * rand(80, 320), rand(0.18, 0.45), rand(1.5, 3.2), '#e8fbff', 260));
    }
  }

  updateParticles(dt) {
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.vy += (pt.gravity || 0) * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.pow(0.12, dt);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
    for (const f of this.fx) f.life -= dt;
    this.fx = this.fx.filter((f) => f.life > 0);
  }

  updateTexts(dt) {
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 26 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  spawnDust() {
    this.dust = [];
    for (let i = 0; i < 120; i++) {
      this.dust.push({ x: rand(0, WORLD.w), y: rand(0, WORLD.h), r: rand(0.8, 2.2), a: rand(0.05, 0.22), s: rand(3, 12) });
    }
  }

  /* ---------------------------------------------------------------- render */

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, this.w, this.h);

    const shake = this.shake * this.shake * 10;
    const camX = Math.round(this.cam.x + rand(-shake, shake));
    const camY = Math.round(this.cam.y + rand(-shake, shake));

    this.drawBackdrop(ctx, camX, camY);

    ctx.save();
    ctx.translate(-camX, -camY);
    this.drawSolids(ctx, camX, camY);
    this.drawLights(ctx);
    this.drawBenches(ctx);
    this.drawCharm(ctx);
    this.drawSpikes(ctx);
    this.drawEnemies(ctx);
    this.drawSpells(ctx);
    this.drawProjectiles(ctx);
    this.drawPlayer(ctx);
    this.drawParticles(ctx);
    this.drawFx(ctx);
    this.drawTexts(ctx);
    ctx.restore();

    this.drawOverlay(ctx);
  }

  drawBackdrop(ctx, camX, camY) {
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#070a18');
    g.addColorStop(0.55, '#0a1122');
    g.addColorStop(1, '#04060e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // Far parallax layers.
    ctx.save();
    for (let layer = 0; layer < 2; layer++) {
      const px = camX * (0.16 + layer * 0.14);
      const py = camY * (0.16 + layer * 0.14);
      const cell = 260 + layer * 120;
      ctx.fillStyle = layer === 0 ? 'rgba(16, 26, 52, 0.55)' : 'rgba(11, 18, 38, 0.7)';
      const offX = -((px % cell) + cell) % cell;
      const offY = -((py % cell) + cell) % cell;
      for (let x = offX; x < this.w + cell; x += cell) {
        for (let y = offY; y < this.h + cell; y += cell) {
          const w = cell * 0.62;
          const h = cell * 0.5;
          const jx = ((x * 13 + y * 7) % 40) - 20;
          ctx.beginPath();
          ctx.moveTo(x + jx, y + h);
          ctx.quadraticCurveTo(x + jx + w * 0.5, y - h * 0.35, x + jx + w, y + h);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Hanging vines in the mid layer.
    ctx.save();
    ctx.strokeStyle = 'rgba(30, 56, 74, 0.5)';
    for (let i = 0; i < 26; i++) {
      const worldX = i * 260 + ((i * 97) % 130);
      const sx = worldX - camX * 0.55;
      if (sx < -60 || sx > this.w + 60) continue;
      const top = -camY * 0.55 + ((i * 53) % 90);
      ctx.lineWidth = 1.5 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(sx, top);
      ctx.quadraticCurveTo(sx + Math.sin(this.time * 0.6 + i) * 16, top + 90, sx + Math.sin(this.time * 0.5 + i) * 26, top + 180 + (i % 5) * 26);
      ctx.stroke();
    }
    ctx.restore();

    // Distant pillars: the deepest layer, barely visible.
    ctx.save();
    const pillarShift = camX * 0.34;
    for (let i = 0; i < 40; i++) {
      const wx = i * 320 + ((i * 137) % 190);
      const sx = wx - pillarShift;
      if (sx < -220 || sx > this.w + 220) continue;
      const w = 60 + ((i * 53) % 90);
      const top = 60 + ((i * 97) % 180);
      const g2 = ctx.createLinearGradient(sx, top, sx + w, top);
      g2.addColorStop(0, 'rgba(9, 17, 32, 0.85)');
      g2.addColorStop(0.5, 'rgba(13, 25, 44, 0.9)');
      g2.addColorStop(1, 'rgba(7, 13, 25, 0.85)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(sx, this.h + 40);
      ctx.lineTo(sx + w * 0.12, top + 40);
      ctx.quadraticCurveTo(sx + w * 0.5, top - 30, sx + w * 0.9, top + 50);
      ctx.lineTo(sx + w, this.h + 40);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Dust motes.
    for (const d of this.dust) {
      const sx = d.x - camX * 0.8;
      const sy = (d.y - camY * 0.8 + this.time * d.s) % WORLD.h;
      if (sx < 0 || sx > this.w) continue;
      ctx.fillStyle = `rgba(150, 220, 255, ${d.a})`;
      ctx.fillRect(sx, sy % this.h, d.r, d.r);
    }
  }

  visible(x, y, w, h, camX, camY) {
    return x + w > camX - 80 && x < camX + this.w + 80 && y + h > camY - 80 && y < camY + this.h + 80;
  }

  drawSolids(ctx, camX, camY) {
    for (const s of this.solids) {
      if (!this.visible(s.x, s.y, s.w, s.h, camX, camY)) continue;
      const g = ctx.createLinearGradient(0, s.y, 0, s.y + Math.min(s.h, 220));
      if (s.kind === 'ceil') {
        g.addColorStop(0, '#0c1526');
        g.addColorStop(1, '#0a1220');
      } else {
        g.addColorStop(0, '#101c31');
        g.addColorStop(1, '#070d19');
      }
      ctx.fillStyle = g;
      ctx.fillRect(s.x, s.y, s.w, s.h);

      // Strata lines for a stony read.
      ctx.strokeStyle = 'rgba(90, 140, 180, 0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = s.y + 18; y < s.y + s.h; y += 34) {
        ctx.moveTo(s.x, y);
        ctx.lineTo(s.x + s.w, y + ((y * 7) % 5) - 2);
      }
      ctx.stroke();

      // Bright rim where the surface is exposed.
      const top = s.y;
      const rim = ctx.createLinearGradient(0, top, 0, top + 26);
      rim.addColorStop(0, 'rgba(120, 240, 255, 0.5)');
      rim.addColorStop(0.4, 'rgba(70, 150, 200, 0.14)');
      rim.addColorStop(1, 'rgba(70, 150, 200, 0)');
      if (s.kind !== 'ceil') {
        ctx.fillStyle = rim;
        ctx.fillRect(s.x, s.y - 12, s.w, 26);
        ctx.strokeStyle = 'rgba(150, 245, 255, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + 1);
        ctx.lineTo(s.x + s.w, s.y + 1);
        ctx.stroke();
        // Moss + pebbles along the top edge.
        ctx.fillStyle = 'rgba(80, 220, 200, 0.22)';
        for (let x = s.x + 10; x < s.x + s.w - 6; x += 27 + ((x * 13) % 17)) {
          const hgt = 3 + ((x * 7) % 7);
          ctx.fillRect(x, s.y - hgt, 5 + ((x * 3) % 6), hgt);
        }
        ctx.fillStyle = 'rgba(140, 200, 230, 0.16)';
        for (let x = s.x + 20; x < s.x + s.w; x += 61) {
          ctx.beginPath();
          ctx.ellipse(x, s.y - 3, 5 + ((x * 11) % 5), 2.4, 0, 0, TAU);
          ctx.fill();
        }
      }

      // Large hanging lobes break up the flat ceiling silhouettes.
      if (s.kind === 'ceil' && s.w > 400) {
        const bottom = s.y + s.h;
        ctx.fillStyle = '#091120';
        for (let x = s.x + 60; x < s.x + s.w - 60; x += 210 + ((x * 31) % 150)) {
          const wob = 60 + ((x * 17) % 90);
          const depth = 40 + ((x * 23) % 70);
          ctx.beginPath();
          ctx.moveTo(x - wob, bottom);
          ctx.quadraticCurveTo(x, bottom + depth, x + wob, bottom);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(110, 200, 240, 0.12)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - wob, bottom);
          ctx.quadraticCurveTo(x, bottom + depth, x + wob, bottom);
          ctx.stroke();
        }
      }

      // Stalactites under ceilings.
      if (s.kind === 'ceil') {
        ctx.fillStyle = '#0b1424';
        for (let x = s.x + 26; x < s.x + s.w - 20; x += 42 + ((x * 17) % 30)) {
          const hgt = 26 + ((x * 29) % 96);
          const wid = 9 + ((x * 7) % 16);
          ctx.beginPath();
          ctx.moveTo(x - wid / 2, s.y + s.h - 1);
          ctx.lineTo(x + wid / 2, s.y + s.h - 1);
          ctx.lineTo(x + 2, s.y + s.h + hgt);
          ctx.closePath();
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(120, 230, 255, 0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + s.h - 1);
        ctx.lineTo(s.x + s.w, s.y + s.h - 1);
        ctx.stroke();
      }

      // Solid rock continues downward, so floors never float in the dark.
      if (s.kind === 'floor' && s.h > 100) {
        const rockBottom = camY + this.h + 80;
        if (s.y + s.h < rockBottom) {
          const rg = ctx.createLinearGradient(0, s.y + s.h, 0, s.y + s.h + 420);
          rg.addColorStop(0, '#060c15');
          rg.addColorStop(1, '#03060b');
          ctx.fillStyle = rg;
          ctx.fillRect(s.x, s.y + s.h, s.w, rockBottom - (s.y + s.h));
          ctx.fillStyle = 'rgba(120, 190, 230, 0.05)';
          for (let x = s.x + 12; x < s.x + s.w - 8; x += 37) {
            const yy = s.y + s.h + 26 + ((x * 13) % 120);
            ctx.fillRect(x, yy, 3 + ((x * 7) % 5), 2 + ((x * 3) % 6));
          }
        }

      }

      // Thin platforms get a rocky lip so they read as stone, not glass.
      if (s.kind === 'floor') {
        if (s.h <= 60) {
          ctx.fillStyle = '#081120';
          ctx.beginPath();
          ctx.moveTo(s.x, s.y + s.h);
          ctx.lineTo(s.x + s.w, s.y + s.h);
          ctx.lineTo(s.x + s.w - 6, s.y + s.h + 12);
          ctx.lineTo(s.x + 6, s.y + s.h + 14);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(130, 210, 245, 0.07)';
          for (let x = s.x + 16; x < s.x + s.w - 12; x += 29) {
            ctx.fillRect(x, s.y + s.h + 3, 4 + ((x * 5) % 6), 2);
          }
        }
      }

      // Outlines.
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.15)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
    }

    // Purely decorative slabs.
    for (const r of ROCKS) {
      if (!this.visible(r.x, r.y, r.w, r.h, camX, camY)) continue;
      ctx.fillStyle = '#0a1322';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#0b1524';
      for (let x = r.x + 18; x < r.x + r.w; x += 52) {
        const hgt = 20 + ((x * 11) % 40);
        ctx.beginPath();
        ctx.moveTo(x - 9, r.y + r.h);
        ctx.lineTo(x + 9, r.y + r.h);
        ctx.lineTo(x, r.y + r.h + hgt);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  drawLights(ctx) {
    for (const l of LIGHTS) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.55 + 0.12 * Math.sin(this.time * 1.6 + l.x * 0.01);
      const g = ctx.createRadialGradient(l.x, l.y - 14, 4, l.x, l.y - 14, l.r);
      g.addColorStop(0, this.hex(l.color, 0.5 * pulse));
      g.addColorStop(0.45, this.hex(l.color, 0.13 * pulse));
      g.addColorStop(1, this.hex(l.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(l.x, l.y - 14, l.r, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Mushroom cluster: small caps, tinted by the light.
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = l.warm ? '#9fc7dd' : l.color;
      for (let i = 0; i < 6; i++) {
        const mx = l.x - 30 + i * 11 + ((i * 5) % 4);
        const mh = 4 + ((i * 7) % 7);
        ctx.beginPath();
        ctx.ellipse(mx, l.y - mh * 0.3, 3.4 + (i % 3) * 0.7, mh * 0.62, 0, Math.PI, TAU);
        ctx.fill();
        ctx.fillRect(mx - 0.8, l.y - mh * 0.35, 1.6, mh * 0.45);
      }
      ctx.globalAlpha = 1;
    }
  }

  hex(color, alpha) {
    const n = parseInt(color.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  drawBenches(ctx) {
    for (const bench of this.benches) {
      const { x, y } = bench;
      ctx.fillStyle = '#132238';
      ctx.fillRect(x + 8, y - 12, 74, 12);
      ctx.fillStyle = '#0d1728';
      ctx.fillRect(x + 12, y, 8, 22);
      ctx.fillRect(x + 70, y, 8, 22);
      ctx.fillStyle = 'rgba(255, 226, 160, 0.12)';
      ctx.fillRect(x + 8, y - 12, 74, 3);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x + 45, y - 22, 2, x + 45, y - 22, 120);
      g.addColorStop(0, 'rgba(255, 226, 160, 0.28)');
      g.addColorStop(1, 'rgba(255, 226, 160, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + 45, y - 22, 120, 0, TAU);
      ctx.fill();
      ctx.restore();
      // Hanging lamp.
      ctx.strokeStyle = 'rgba(160, 190, 220, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 45, y - 96);
      ctx.lineTo(x + 45, y - 34);
      ctx.stroke();
      ctx.fillStyle = '#ffe6a6';
      ctx.beginPath();
      ctx.arc(x + 45, y - 28, 6, 0, TAU);
      ctx.fill();
    }
  }

  drawCharm(ctx) {
    if (this.charm.taken) return;
    const { x, y } = this.charm;
    const bob = Math.sin(this.charm.t * 2) * 4;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y + bob, 3, x, y + bob, 110);
    g.addColorStop(0, 'rgba(255, 235, 180, 0.55)');
    g.addColorStop(1, 'rgba(255, 200, 120, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y + bob, 110, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(this.charm.t * 0.9);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      ctx.quadraticCurveTo(Math.cos(a + 0.4) * 18, Math.sin(a + 0.4) * 18, Math.cos(a) * 26, Math.sin(a) * 26);
      ctx.quadraticCurveTo(Math.cos(a - 0.4) * 18, Math.sin(a - 0.4) * 18, 0, 0);
    }
    ctx.fillStyle = '#ffe9b0';
    ctx.fill();
    ctx.strokeStyle = '#fff8e0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  drawSpikes(ctx) {
    for (const sp of this.spikes) {
      ctx.fillStyle = '#20344d';
      ctx.beginPath();
      const n = Math.floor(sp.w / 16);
      for (let i = 0; i < n; i++) {
        const x = sp.x + i * (sp.w / n);
        ctx.moveTo(x, sp.y + sp.h);
        ctx.lineTo(x + sp.w / n / 2, sp.y);
        ctx.lineTo(x + sp.w / n, sp.y + sp.h);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(170, 235, 255, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  drawPlayer(ctx) {
    const p = this.player;
    const b = p.body;
    if (this.mode === 'dead') return;
    const f = p.facing;
    const t = p.animTime;

    ctx.save();
    ctx.translate(b.cx, b.bottom);

    // Soul glow.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, -24, 4, 0, -24, 60);
    glow.addColorStop(0, `rgba(120, 240, 255, ${0.16 + (this.soul / 99) * 0.14})`);
    glow.addColorStop(1, 'rgba(120, 240, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -24, 60, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (p.invuln > 0 && Math.floor(t * 24) % 2 === 0 && p.dash <= 0) ctx.globalAlpha = 0.45;

    // Ground shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 17, 5, 0, 0, TAU);
    ctx.fill();

    const squash = p.landSquash * 0.12;
    const speedLean = clamp(b.vx / 620, -0.22, 0.22);
    ctx.scale(f, 1);
    ctx.rotate(speedLean);
    ctx.scale(1 + squash, 1 - squash);

    const walk = b.onGround ? Math.sin(t * 13) * clamp(Math.abs(b.vx) / 300, 0, 1) : 0;

    // Cloak.
    ctx.beginPath();
    ctx.moveTo(-2, -54);
    ctx.quadraticCurveTo(-20, -34, -19 + walk * 2, -2);
    ctx.quadraticCurveTo(-6, 4, 0, 3);
    ctx.quadraticCurveTo(9, 4, 18 - walk * 2, -3);
    ctx.quadraticCurveTo(19, -32, 2, -54);
    ctx.closePath();
    const cg = ctx.createLinearGradient(0, -54, 0, 4);
    cg.addColorStop(0, '#121b2e');
    cg.addColorStop(0.6, '#0b1322');
    cg.addColorStop(1, '#16283f');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.34)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Legs.
    ctx.strokeStyle = '#0e1828';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, -14);
    ctx.lineTo(-5 + walk * 5, 0);
    ctx.moveTo(5, -15);
    ctx.lineTo(6 - walk * 5, 0);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Head: pale mask.
    ctx.save();
    ctx.translate(1, -46 + (b.onGround ? 0 : -1));
    ctx.beginPath();
    ctx.moveTo(-13, 0);
    ctx.quadraticCurveTo(-16, -16, 0, -19);
    ctx.quadraticCurveTo(16, -16, 13, 0);
    ctx.quadraticCurveTo(6, 9, 0, 8);
    ctx.quadraticCurveTo(-6, 9, -13, 0);
    ctx.closePath();
    const hg = ctx.createLinearGradient(0, -19, 0, 9);
    hg.addColorStop(0, '#dff4ff');
    hg.addColorStop(1, '#9fc6d8');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(230, 250, 255, 0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Horns.
    ctx.fillStyle = '#e8f8ff';
    ctx.beginPath();
    ctx.moveTo(-11, -12);
    ctx.lineTo(-24, -30);
    ctx.lineTo(-8, -17);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(9, -14);
    ctx.lineTo(19, -32);
    ctx.lineTo(12, -12);
    ctx.closePath();
    ctx.fill();

    // Eyes.
    ctx.fillStyle = '#0a1522';
    ctx.beginPath();
    ctx.ellipse(-5, -3, 3.4, 5, -0.15, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(5, -3, 3.4, 5, 0.15, 0, TAU);
    ctx.fill();
    if (this.soul > 60) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(140, 245, 255, 0.5)';
      ctx.beginPath();
      ctx.ellipse(-5, -3, 2, 3.2, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(5, -3, 2, 3.2, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    ctx.restore();

    // Nail swing arc.
    if (p.attacking > 0) this.drawSwing(ctx, p);

    // Dash afterimages.
    for (const fx of this.fx) {
      if (fx.type !== 'dash') continue;
      const k = fx.life / fx.max;
      ctx.globalAlpha = k * 0.4;
      ctx.fillStyle = 'rgba(150, 240, 255, 0.8)';
      for (let i = 0; i < 3; i++) {
        const x = fx.x - fx.dir * (i * 26 + 10);
        ctx.beginPath();
        ctx.ellipse(x, fx.y, 12 - i * 2, 22 - i * 3, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  drawSwing(ctx, p) {
    const b = p.body;
    const k = 1 - p.attacking / 0.2;
    const alpha = 1 - k;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(220, 250, 255, ${0.85 * alpha})`;
    ctx.lineWidth = 9 - k * 4;
    ctx.lineCap = 'round';
    const cx = b.cx;
    const cy = b.cy;
    if (p.attackDir === 'side') {
      const dir = p.facing;
      const sweep = lerp(-0.9, 0.9, k);
      ctx.beginPath();
      ctx.arc(cx + dir * 8, cy, 56, sweep - 0.55 + (dir > 0 ? 0 : Math.PI), sweep + 0.55 + (dir > 0 ? 0 : Math.PI));
      ctx.stroke();
      ctx.strokeStyle = `rgba(120, 230, 255, ${0.5 * alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (p.attackDir === 'up') {
      ctx.beginPath();
      ctx.arc(cx, cy - 10, 52, -Math.PI * 0.92, -Math.PI * 0.08);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy + 12, 52, Math.PI * 0.08, Math.PI * 0.92);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawEnemies(ctx) {
    for (const e of this.enemies) {
      const b = e.body;
      const dead = e.dead;
      if (dead) {
        const k = 1 - e.dieT / 0.45;
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.save();
        ctx.translate(b.cx, b.cy);
        ctx.scale(1 + k * 0.3, 1 + k * 0.3);
        ctx.fillStyle = '#e9fbff';
        ctx.beginPath();
        ctx.ellipse(0, 0, b.w / 2, b.h / 2, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
        continue;
      }

      const flash = e.flash;
      const f = e.dir;
      ctx.save();
      ctx.translate(b.cx, b.bottom);
      ctx.scale(f, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 2, b.w * 0.4, 4, 0, 0, TAU);
      ctx.fill();

      if (e.def.shape === 'crawler') {
        const legT = Math.sin(e.animT * 16);
        ctx.strokeStyle = '#16233a';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const lx = -12 + i * 11;
          ctx.moveTo(lx, -12);
          ctx.lineTo(lx + legT * 5, 0);
        }
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.ellipse(0, -18, 23, 14 + legT * 1.2, 0, 0, TAU);
        const g = ctx.createLinearGradient(0, -32, 0, -4);
        g.addColorStop(0, flash > 0.3 ? '#ffffff' : '#2c5f74');
        g.addColorStop(1, '#0d1b2a');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = flash > 0.3 ? '#fff' : 'rgba(120, 235, 255, 0.65)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = '#bff8ff';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(4 + i * 6, -22, 1.8, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#0b1524';
        ctx.beginPath();
        ctx.arc(14, -18, 3.4, 0, TAU);
        ctx.fill();
      } else if (e.def.shape === 'flyer') {
        const flap = Math.sin(e.animT * 14);
        ctx.fillStyle = 'rgba(150, 120, 255, 0.35)';
        ctx.beginPath();
        ctx.ellipse(-6, -22, 20, 8 + flap * 6, -0.5 + flap * 0.3, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(14, -22, 18, 7 - flap * 5, 0.5 - flap * 0.3, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, -22, 13, 12, 0, 0, TAU);
        const g = ctx.createRadialGradient(0, -26, 2, 0, -22, 16);
        g.addColorStop(0, flash > 0.3 ? '#fff' : '#d9ccff');
        g.addColorStop(1, '#2a2050');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(200, 180, 255, 0.7)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.fillStyle = '#1a1030';
        ctx.beginPath();
        ctx.arc(4, -24, 2.4, 0, TAU);
        ctx.fill();
      } else if (e.def.shape === 'husk' || e.def.shape === 'guardian') {
        const scale = e.def.shape === 'guardian' ? 1 : 0.72;
        const sway = Math.sin(e.animT * 5) * 2;
        // Cloak body.
        ctx.beginPath();
        ctx.moveTo(-16 * scale, -60 * scale);
        ctx.quadraticCurveTo(-26 * scale, -20 * scale, -22 * scale + sway, 0);
        ctx.quadraticCurveTo(0, 6, 22 * scale + sway, 0);
        ctx.quadraticCurveTo(26 * scale, -20 * scale, 16 * scale, -60 * scale);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, -70 * scale, 0, 0);
        g.addColorStop(0, flash > 0.3 ? '#ffffff' : e.def.shape === 'guardian' ? '#4a3a7d' : '#26314d');
        g.addColorStop(1, '#0a1020');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = flash > 0.3 ? '#fff' : e.def.shape === 'guardian' ? 'rgba(190, 160, 255, 0.8)' : 'rgba(120, 200, 240, 0.4)';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        // Mask.
        ctx.beginPath();
        ctx.ellipse(0, -66 * scale, 13 * scale, 12 * scale, 0, 0, TAU);
        ctx.fillStyle = flash > 0.3 ? '#fff' : '#c8dced';
        ctx.fill();
        ctx.fillStyle = '#0a1420';
        ctx.beginPath();
        ctx.ellipse(-4 * scale, -66 * scale, 2.6 * scale, 4 * scale, 0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(4 * scale, -66 * scale, 2.6 * scale, 4 * scale, 0, 0, TAU);
        ctx.fill();
        // Arms.
        ctx.strokeStyle = e.def.shape === 'guardian' ? '#3b2f66' : '#1b2740';
        ctx.lineWidth = 5 * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-14 * scale, -42 * scale);
        ctx.lineTo(-26 * scale, -18 * scale + Math.sin(e.animT * 4) * 4);
        ctx.moveTo(14 * scale, -42 * scale);
        ctx.lineTo(27 * scale, -20 * scale);
        ctx.stroke();
        ctx.lineCap = 'butt';
        if (e.def.shape === 'guardian') {
          // Bone claw.
          const swing = Math.sin(e.animT * 4) * 6;
          ctx.fillStyle = '#c9b8ff';
          ctx.beginPath();
          ctx.moveTo(26, -24);
          ctx.quadraticCurveTo(54, -46 + swing, 68, -18 + swing);
          ctx.quadraticCurveTo(50, -26 + swing, 30, -14);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(240, 232, 255, 0.85)';
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      } else {
        // Spitter: rooted pod.
        const pulse = 0.9 + Math.sin(e.animT * 3) * 0.08;
        ctx.save();
        ctx.scale(pulse, pulse);
        ctx.strokeStyle = '#1a2b42';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.quadraticCurveTo(-4, -18, -12, -30);
        ctx.moveTo(8, 0);
        ctx.quadraticCurveTo(6, -18, 14, -32);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, -34, 17, 22, 0, 0, TAU);
        const g = ctx.createRadialGradient(0, -42, 3, 0, -34, 26);
        g.addColorStop(0, flash > 0.3 ? '#fff' : '#a98bff');
        g.addColorStop(1, '#160f2c');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(200, 170, 255, 0.75)';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // Health pip bar for bosses.
      if (e.type === 'guardian') {
        const w = 120;
        const y = b.y - 18;
        ctx.fillStyle = 'rgba(4, 8, 16, 0.8)';
        ctx.fillRect(b.cx - w / 2, y, w, 6);
        ctx.fillStyle = '#b79bff';
        ctx.fillRect(b.cx - w / 2, y, w * clamp(e.hp / e.maxHp, 0, 1), 6);
        ctx.strokeStyle = 'rgba(220, 210, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(b.cx - w / 2 + 0.5, y + 0.5, w - 1, 5);
      }
    }
  }

  drawSpells(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const sp of this.spells) {
      const k = clamp(sp.life / 0.85, 0, 1);
      const g = ctx.createRadialGradient(sp.x, sp.y, 2, sp.x, sp.y, sp.r * 2.2);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      g.addColorStop(0.35, `rgba(170, 240, 255, ${0.55 * k})`);
      g.addColorStop(1, 'rgba(90, 180, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r * 2.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(220, 250, 255, ${0.5 * k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, sp.r * 1.5, sp.r * 0.75, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawProjectiles(ctx) {
    for (const pr of this.projectiles) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(pr.x, pr.y, 1, pr.x, pr.y, 22);
      g.addColorStop(0, 'rgba(220, 200, 255, 0.9)');
      g.addColorStop(0.4, 'rgba(150, 120, 255, 0.45)');
      g.addColorStop(1, 'rgba(120, 90, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, 22, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#f3eaff';
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, 5, 0, TAU);
      ctx.fill();
    }
  }

  drawParticles(ctx) {
    for (const pt of this.particles) {
      const t = clamp(pt.life / pt.max, 0, 1);
      ctx.globalAlpha = t;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (0.5 + t * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawFx(ctx) {
    for (const f of this.fx) {
      const k = 1 - f.life / f.max;
      if (f.type === 'spark') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const x = f.x;
        const y = f.y;
        ctx.strokeStyle = `rgba(230, 252, 255, ${1 - k})`;
        ctx.lineWidth = 3 * (1 - k) + 0.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + k * 2;
          ctx.moveTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
          ctx.lineTo(x + Math.cos(a) * (26 + k * 18), y + Math.sin(a) * (26 + k * 18));
        }
        ctx.stroke();
        ctx.restore();
      } else if (f.type === 'death') {
        const r = f.r + (f.max - f.r) * k;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(200, 245, 255, ${(1 - k) * 0.8})`;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawTexts(ctx) {
    ctx.textAlign = 'center';
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    for (const t of this.texts) {
      ctx.globalAlpha = clamp(t.life / t.max, 0, 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  drawOverlay(ctx) {
    // Vignette anchored on the knight, so the cave feels lit only around you.
    const b = this.player.body;
    const px = b.cx - this.cam.x;
    const py = b.cy - this.cam.y;
    const v = ctx.createRadialGradient(px, py, 90, px, py, Math.max(this.w, this.h) * 0.82);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.42, 'rgba(0,0,0,0.18)');
    v.addColorStop(0.75, 'rgba(0,0,0,0.55)');
    v.addColorStop(1, 'rgba(2,4,8,0.86)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, this.w, this.h);

    // Dark when low on life.
    const p = this.player;
    if (this.mode === 'play' && p.hp === 1) {
      ctx.fillStyle = `rgba(10, 0, 20, ${0.25 + Math.sin(this.time * 4) * 0.05})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    if (this.flash > 0.3) {
      ctx.fillStyle = `rgba(200, 245, 255, ${(this.flash - 0.3) * 0.16})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (this.darkFlash > 0) {
      ctx.fillStyle = `rgba(2, 4, 10, ${this.darkFlash * 0.55})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }
}
