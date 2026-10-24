import { SPELL_BY_ID } from './spells.js';
import { drawGlow, polygon, hexToRgba } from './gfx.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};
const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

const ENEMY_TYPES = {
  grunt: {
    hp: 26,
    speed: 62,
    radius: 20,
    damage: 9,
    score: 10,
    color: '#ff5f7e',
    glow: '#ff2d6f',
    shape: 'blob',
  },
  shard: {
    hp: 16,
    speed: 118,
    radius: 15,
    damage: 7,
    score: 14,
    color: '#ffb35c',
    glow: '#ff7a2f',
    shape: 'shard',
  },
  orb: {
    hp: 34,
    speed: 52,
    radius: 19,
    damage: 8,
    score: 20,
    color: '#ff7fe0',
    glow: '#ff2bd0',
    shape: 'orb',
  },
  brute: {
    hp: 120,
    speed: 42,
    radius: 33,
    damage: 16,
    score: 45,
    color: '#c07dff',
    glow: '#8d3dff',
    shape: 'brute',
  },
  boss: {
    hp: 640,
    speed: 40,
    radius: 66,
    damage: 22,
    score: 250,
    color: '#ff4d6d',
    glow: '#ff0044',
    shape: 'boss',
  },
};

export const UPGRADE_POOL = [
  {
    id: 'power',
    name: 'Arkan skärpa',
    icon: '✦',
    accent: '#6ff2ff',
    max: 8,
    desc: '+15 % skada med alla besvärjelser.',
  },
  {
    id: 'multi',
    name: 'Splittrad bult',
    icon: '✧',
    accent: '#8ff0ff',
    max: 3,
    desc: '+1 projektil per kast. Spridningen växer.',
  },
  {
    id: 'pierce',
    name: 'Genomträngning',
    icon: '➹',
    accent: '#b9ffe3',
    max: 3,
    desc: 'Bultar fortsätter genom 1 fiende till.',
  },
  {
    id: 'haste',
    name: 'Snabbkast',
    icon: '⟳',
    accent: '#ffd48f',
    max: 4,
    desc: '-12 % nedkylning på alla besvärjelser.',
  },
  {
    id: 'crit',
    name: 'Ödeskrit',
    icon: '✷',
    accent: '#ffb0f0',
    max: 4,
    desc: '+8 % kritchans. Krit gör dubbel skada.',
  },
  {
    id: 'fire',
    name: 'Eldstorm',
    icon: '❂',
    accent: '#ff9d57',
    max: 5,
    desc: '+25 % explosionens radie och skada.',
  },
  {
    id: 'frost',
    name: 'Vinterkyla',
    icon: '❄',
    accent: '#8fe3ff',
    max: 5,
    desc: '+22 % frostnovans radie og längre kyla.',
  },
  {
    id: 'chain',
    name: 'Stormlänk',
    icon: '⚡',
    accent: '#c79dff',
    max: 4,
    desc: '+1 kedjehopp för blixten.',
  },
  {
    id: 'swift',
    name: 'Vindsteg',
    icon: '➤',
    accent: '#a7ffd0',
    max: 5,
    desc: '+10 % rörelsehastighet.',
  },
  {
    id: 'vigor',
    name: 'Blodkärl',
    icon: '❤',
    accent: '#ff7d9c',
    max: 6,
    desc: '+20 max liv och läk 20 direkt.',
  },
  {
    id: 'regen',
    name: 'Regenerering',
    icon: '✚',
    accent: '#8effc0',
    max: 4,
    desc: '+1,4 liv per sekund.',
  },
  {
    id: 'manapool',
    name: 'Manabrunn',
    icon: '◈',
    accent: '#63c7ff',
    max: 4,
    desc: '+25 max mana.',
  },
  {
    id: 'flow',
    name: 'Arkant flöde',
    icon: '◉',
    accent: '#63c7ff',
    max: 4,
    desc: '+2,5 mana per sekund.',
  },
  {
    id: 'soul',
    name: 'Själsslukare',
    icon: '☾',
    accent: '#d7b0ff',
    max: 5,
    desc: 'Läk 1 liv varje gång en fiende dör.',
  },
  {
    id: 'magnet',
    name: 'Dragningskraft',
    icon: '◎',
    accent: '#ffe58f',
    max: 3,
    desc: '+70 % upplockningsradie för kristaller.',
  },
];

const BASE_STATS = {
  power: 1,
  boltSpeed: 640,
  multi: 1,
  spread: 0,
  pierce: 0,
  crit: 0.05,
  haste: 1,
  moveSpeed: 1,
  maxHp: 100,
  regen: 0,
  maxMana: 100,
  manaRegen: 9,
  fireScale: 1,
  novaScale: 1,
  frostTime: 2.2,
  chainJumps: 1,
  soul: 0,
  magnet: 1,
};

export class Game {
  constructor(canvas, input, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.cb = callbacks;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 0;
    this.h = 0;

    this.phase = 'idle';
    this.time = 0;
    this.wave = 0;
    this.score = 0;
    this.best = Number(localStorage.getItem('spell.best') || 0);

    this.player = null;
    this.enemies = [];
    this.projectiles = [];
    this.hazards = [];
    this.particles = [];
    this.effects = [];
    this.pickups = [];
    this.texts = [];

    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.clearTimer = 0;
    this.boss = null;

    this.shake = 0;
    this.shakeMag = 0;
    this.flash = 0;
    this.timeScale = 1;

    this.stats = { ...BASE_STATS };
    this.levels = {};
    this.cooldowns = { arcane: 0, fire: 0, frost: 0, chain: 0, blink: 0 };
    this.dust = [];
    this.resize();
    this._buildDust();
  }

  /* ------------------------------------------------------------ setup */

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, Math.round(rect.width));
    this.h = Math.max(320, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this._buildDust();
    if (this.player) {
      this.player.x = clamp(this.player.x, 40, this.w - 40);
      this.player.y = clamp(this.player.y, 40, this.h - 40);
    }
  }

  _buildDust() {
    this.dust = [];
    const count = Math.round((this.w * this.h) / 26000);
    for (let i = 0; i < count; i++) {
      this.dust.push({
        x: rand(0, this.w),
        y: rand(0, this.h),
        r: rand(0.6, 1.9),
        a: rand(0.08, 0.4),
        s: rand(4, 18),
        p: rand(0, TAU),
      });
    }
  }

  start() {
    this.phase = 'combat';
    this.time = 0;
    this.score = 0;
    this.wave = 0;
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.hazards.length = 0;
    this.particles.length = 0;
    this.effects.length = 0;
    this.pickups.length = 0;
    this.texts.length = 0;
    this.stats = { ...BASE_STATS };
    this.levels = {};
    for (const key of Object.keys(this.cooldowns)) this.cooldowns[key] = 0;
    this.boss = null;
    this.shake = 0;
    this.flash = 0;

    this.player = {
      x: this.w / 2,
      y: this.h / 2,
      vx: 0,
      vy: 0,
      r: 17,
      hp: this.stats.maxHp,
      maxHp: this.stats.maxHp,
      mana: this.stats.maxMana,
      maxMana: this.stats.maxMana,
      aim: -Math.PI / 2,
      hurtCd: 0,
      invuln: 0,
      walk: 0,
      alive: true,
    };

    this.beginWave(1);
  }

  beginWave(n) {
    this.wave = n;
    this.phase = 'combat';
    this.spawnQueue = this._buildWave(n);
    this.spawnTimer = 0.55;
    this.boss = null;
    this.cb.onWaveStart?.(n);
  }

  _buildWave(n) {
    const queue = [];
    const isBoss = n % 5 === 0;
    const count = Math.min(46, Math.round(4 + n * 1.8));
    const pool = [{ type: 'grunt', weight: 10 }];
    if (n >= 2) pool.push({ type: 'shard', weight: 5 + n * 0.5 });
    if (n >= 4) pool.push({ type: 'orb', weight: 3 + n * 0.4 });
    if (n >= 6) pool.push({ type: 'brute', weight: 1.5 + n * 0.25 });

    const totalWeight = pool.reduce((s, p) => s + p.weight, 0);
    const roll = () => {
      let r = Math.random() * totalWeight;
      for (const p of pool) {
        r -= p.weight;
        if (r <= 0) return p.type;
      }
      return 'grunt';
    };

    if (isBoss) queue.push({ type: 'boss', delay: 0.9 });
    for (let i = 0; i < count; i++) {
      queue.push({ type: roll(), delay: rand(0.05, 0.42) });
    }
    // A short breather, then the stragglers.
    return queue;
  }

  /* ----------------------------------------------------------- helpers */

  get aliveEnemies() {
    return this.enemies.filter((e) => e.hp > 0);
  }

  applyUpgrade(id) {
    const def = UPGRADE_POOL.find((u) => u.id === id);
    if (!def) return;
    const level = (this.levels[id] || 0) + 1;
    this.levels[id] = level;
    const s = this.stats;
    const p = this.player;

    switch (id) {
      case 'power':
        s.power += 0.15;
        break;
      case 'multi':
        s.multi += 1;
        s.spread = 0.055 * (s.multi - 1);
        break;
      case 'pierce':
        s.pierce += 1;
        break;
      case 'haste':
        s.haste *= 0.88;
        break;
      case 'crit':
        s.crit += 0.08;
        break;
      case 'fire':
        s.fireScale += 0.25;
        break;
      case 'frost':
        s.novaScale += 0.22;
        s.frostTime += 0.35;
        break;
      case 'chain':
        s.chainJumps += 1;
        break;
      case 'swift':
        s.moveSpeed += 0.1;
        break;
      case 'vigor':
        s.maxHp += 20;
        p.maxHp = s.maxHp;
        p.hp = Math.min(p.maxHp, p.hp + 20);
        break;
      case 'regen':
        s.regen += 1.4;
        break;
      case 'manapool':
        s.maxMana += 25;
        p.maxMana = s.maxMana;
        p.mana = Math.min(p.maxMana, p.mana + 25);
        break;
      case 'flow':
        s.manaRegen += 2.5;
        break;
      case 'soul':
        s.soul += 1;
        break;
      case 'magnet':
        s.magnet += 0.7;
        break;
      default:
        break;
    }
  }

  availableUpgrades() {
    return UPGRADE_POOL.filter((u) => (this.levels[u.id] || 0) < u.max);
  }

  offerUpgrades(count = 3) {
    const pool = this.availableUpgrades().slice();
    const picks = [];
    while (picks.length < count && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(i, 1)[0]);
    }
    return picks;
  }

  get spellCooldown() {
    return (id) => {
      const base = SPELL_BY_ID[id].cooldown;
      return base * this.stats.haste;
    };
  }

  /* ------------------------------------------------------------ update */

  update(dt) {
    const input = this.input;
    this.time += dt;

    // Ambient drift.
    for (const d of this.dust) {
      d.y -= d.s * dt;
      d.x += Math.sin(this.time * 0.4 + d.p) * 6 * dt;
      if (d.y < -4) {
        d.y = this.h + 4;
        d.x = rand(0, this.w);
      }
    }
    this.shake = Math.max(0, this.shake - dt * 3.4);
    this.flash = Math.max(0, this.flash - dt * 3.2);

    for (const e of this.effects) e.life -= dt;

    if (this.phase === 'dead') {
      this._updateParticles(dt);
      return;
    }

    const p = this.player;
    if (!p) return;

    // Cooldowns.
    for (const id of Object.keys(this.cooldowns)) {
      this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    }

    // Aim.
    const pointer = input.pointer;
    if (pointer.inside) {
      p.aim = angleTo(p.x, p.y, pointer.x, pointer.y);
    }

    // Movement.
    let mx = 0;
    let my = 0;
    if (input.down('KeyW') || input.down('ArrowUp')) my -= 1;
    if (input.down('KeyS') || input.down('ArrowDown')) my += 1;
    if (input.down('KeyA') || input.down('ArrowLeft')) mx -= 1;
    if (input.down('KeyD') || input.down('ArrowRight')) mx += 1;
    if (input.stick && input.stick.active) {
      mx += input.stick.dx;
      my += input.stick.dy;
    }
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }

    const speed = 268 * this.stats.moveSpeed;
    const accel = 14;
    p.vx += (mx * speed - p.vx) * Math.min(1, accel * dt);
    p.vy += (my * speed - p.vy) * Math.min(1, accel * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const margin = 22;
    p.x = clamp(p.x, margin, this.w - margin);
    p.y = clamp(p.y, margin, this.h - margin);
    p.walk += Math.hypot(p.vx, p.vy) * dt * 0.06;

    // Regen.
    p.mana = Math.min(p.maxMana, p.mana + this.stats.manaRegen * dt);
    if (this.stats.regen > 0 && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + this.stats.regen * dt);
    }
    p.hurtCd = Math.max(0, p.hurtCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    // Casting.
    const wantBolt = input.mouse.down || input.aimHold;
    if (wantBolt) this.cast('arcane');
    if (input.hit('MouseRight')) this.cast('fire');
    if (input.hit('KeyE')) this.cast('frost');
    if (input.hit('KeyR')) this.cast('chain');
    if (input.hit('Space')) this.cast('blink');

    // Wave flow.
    this._updateSpawns(dt);
    this._updateEnemies(dt);
    this._updateProjectiles(dt);
    this._updateHazards(dt);
    this._updatePickups(dt);
    this._updateParticles(dt);
    this._updateTexts(dt);

    // Wave cleared?
    if (this.phase === 'combat' && this.spawnQueue.length === 0 && this.aliveEnemies.length === 0) {
      this.phase = 'clear';
      this.clearTimer = 1.1;
    } else if (this.phase === 'clear') {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) {
        this.phase = 'offer';
        const heal = Math.min(18, this.player.maxHp - this.player.hp);
        if (heal > 0) {
          this.player.hp += heal;
          this._text(this.player.x, this.player.y - 26, `+${Math.round(heal)}`, '#8effc0');
        }
        this.player.mana = Math.min(this.player.maxMana, this.player.mana + 30);
        this.cb.onWaveClear?.(this.wave, this.offerUpgrades(3));
      }
    }
  }

  /* ------------------------------------------------------------ spells */

  cast(id) {
    const def = SPELL_BY_ID[id];
    if (!def) return false;
    if (this.phase !== 'combat' && this.phase !== 'clear') return false;
    if (this.cooldowns[id] > 0) return false;
    const p = this.player;
    if (p.mana < def.cost) {
      if (def.cost > 0) this.cb.onNoMana?.();
      return false;
    }

    p.mana -= def.cost;
    this.cooldowns[id] = def.cooldown * this.stats.haste;
    const s = this.stats;

    switch (def.cast) {
      case 'bolt': {
        for (let i = 0; i < s.multi; i++) {
          const offset = (i - (s.multi - 1) / 2) * s.spread;
          this._spawnBolt(p.aim + offset);
        }
        this.shake = Math.max(this.shake, 0.12);
        break;
      }
      case 'fireball': {
        const a = p.aim;
        this.projectiles.push({
          kind: 'fireball',
          x: p.x + Math.cos(a) * 18,
          y: p.y + Math.sin(a) * 18,
          vx: Math.cos(a) * 470,
          vy: Math.sin(a) * 470,
          r: 9,
          damage: 34 * s.power,
          life: 1.5,
          color: '#ff9d57',
          trail: '#ff5a2f',
          pierce: 0,
          hits: new Set(),
        });
        this._burst(p.x + Math.cos(a) * 20, p.y + Math.sin(a) * 20, 8, '#ffb066', 90);
        break;
      }
      case 'nova': {
        const radius = 128 * s.novaScale;
        const targets = this.enemies.filter(
          (e) => e.hp > 0 && dist2(p.x, p.y, e.x, e.y) < (radius + e.r) ** 2,
        );
        for (const e of targets) {
          this._damageEnemy(e, 22 * s.power, p.aim);
          e.slow = Math.max(e.slow || 0, s.frostTime);
          e.slowFactor = 0.42;
        }
        this.effects.push({ type: 'nova', x: p.x, y: p.y, r: 0, max: radius, life: 0.5, color: '#9ae8ff' });
        this._burst(p.x, p.y, 18, '#a9ecff', 210);
        this.shake = Math.max(this.shake, 0.55);
        break;
      }
      case 'chain': {
        const chained = new Set();
        let from = { x: p.x, y: p.y };
        let dmg = 30 * s.power;
        let jumps = 1 + s.chainJumps;
        let searchFrom = from;
        while (jumps > 0) {
          let target = null;
          let bestD = 260 ** 2;
          for (const e of this.enemies) {
            if (e.hp <= 0 || chained.has(e)) continue;
            const d = dist2(searchFrom.x, searchFrom.y, e.x, e.y);
            if (d < bestD) {
              bestD = d;
              target = e;
            }
          }
          if (!target) break;
          chained.add(target);
          this.effects.push({
            type: 'lightning',
            a: { x: searchFrom.x, y: searchFrom.y },
            b: { x: target.x, y: target.y },
            life: 0.24,
            color: '#c9a8ff',
            seed: Math.random() * 1000,
          });
          this._damageEnemy(target, dmg, angleTo(from.x, from.y, target.x, target.y));
          target.shock = 0.35;
          this._burst(target.x, target.y, 6, '#d6bcff', 120);
          searchFrom = target;
          from = target;
          dmg *= 0.82;
          jumps -= 1;
        }
        this.flash = Math.min(1, this.flash + 0.16);
        break;
      }
      case 'blink': {
        const dist = 190;
        const tx = clamp(p.x + Math.cos(p.aim) * dist, 24, this.w - 24);
        const ty = clamp(p.y + Math.sin(p.aim) * dist, 24, this.h - 24);
        this.effects.push({
          type: 'trail',
          a: { x: p.x, y: p.y },
          b: { x: tx, y: ty },
          life: 0.35,
          color: '#a7ffd0',
        });
        this._burst(p.x, p.y, 16, '#a7ffd0', 160);
        p.x = tx;
        p.y = ty;
        p.vx *= 0.25;
        p.vy *= 0.25;
        p.invuln = Math.max(p.invuln, 0.32);
        this._burst(tx, ty, 16, '#a7ffd0', 160);
        this.shake = Math.max(this.shake, 0.3);
        break;
      }
      default:
        break;
    }
    return true;
  }

  _spawnBolt(angle) {
    const s = this.stats;
    const p = this.player;
    const crit = Math.random() < s.crit;
    this.projectiles.push({
      kind: 'bolt',
      x: p.x + Math.cos(angle) * 18,
      y: p.y + Math.sin(angle) * 18,
      vx: Math.cos(angle) * s.boltSpeed,
      vy: Math.sin(angle) * s.boltSpeed,
      r: 5,
      damage: 13 * s.power * (crit ? 2.2 : 1),
      crit,
      life: 0.95,
      color: crit ? '#ffe9a8' : '#8df4ff',
      trail: crit ? '#ffbe5c' : '#4ad0ff',
      pierce: s.pierce,
      hits: new Set(),
    });
  }

  /* ---------------------------------------------------------- spawning */

  _updateSpawns(dt) {
    if (this.phase !== 'combat') return;
    if (!this.spawnQueue.length) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    if (this.aliveEnemies.length > 62) {
      this.spawnTimer = 0.3;
      return;
    }
    const next = this.spawnQueue.shift();
    this._spawnEnemy(next.type);
    this.spawnTimer = next.delay * (this.wave > 8 ? 0.72 : 1);
  }

  _spawnEnemy(type) {
    const def = ENEMY_TYPES[type];
    const w = this.w;
    const h = this.h;
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const edge = randInt(0, 3);
      const pad = 34;
      if (edge === 0) {
        x = rand(pad, w - pad);
        y = pad;
      } else if (edge === 1) {
        x = w - pad;
        y = rand(pad, h - pad);
      } else if (edge === 2) {
        x = rand(pad, w - pad);
        y = h - pad;
      } else {
        x = pad;
        y = rand(pad, h - pad);
      }
      if (!this.player || dist2(x, y, this.player.x, this.player.y) > 230 ** 2) break;
    }

    const hpScale = 1 + (this.wave - 1) * 0.19;
    const dmgScale = 1 + (this.wave - 1) * 0.085;
    const speedScale = 1 + Math.min(0.5, (this.wave - 1) * 0.028);

    const enemy = {
      type,
      x,
      y,
      vx: 0,
      vy: 0,
      r: def.radius,
      hp: def.hp * hpScale * (type === 'boss' ? 1.15 : 1),
      maxHp: def.hp * hpScale * (type === 'boss' ? 1.15 : 1),
      speed: def.speed * speedScale,
      damage: def.damage * dmgScale,
      score: def.score,
      color: def.color,
      glow: def.glow,
      shape: def.shape,
      rot: rand(0, TAU),
      spin: rand(-1.6, 1.6),
      wobble: rand(0, TAU),
      slow: 0,
      slowFactor: 1,
      burn: 0,
      burnDps: 0,
      shock: 0,
      flash: 0,
      kx: 0,
      ky: 0,
      touchCd: 0,
      shootCd: rand(1.2, 2.6),
      phase: rand(0, TAU),
      strafe: Math.random() < 0.5 ? 1 : -1,
    };
    if (type === 'boss') {
      enemy.shootCd = 2.4;
      this.boss = enemy;
    }
    this.enemies.push(enemy);

    this.effects.push({ type: 'spawn', x, y, r: 6, max: def.radius * 3.4, life: 0.55, color: def.glow });
    this._burst(x, y, 8, def.glow, 80);
    return enemy;
  }

  /* ----------------------------------------------------------- enemies */

  _updateEnemies(dt) {
    const p = this.player;
    if (!p) return;

    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const def = ENEMY_TYPES[e.type];
      e.rot += e.spin * dt;
      e.wobble += dt * 2.4;
      e.flash = Math.max(0, e.flash - dt * 4);
      e.shock = Math.max(0, (e.shock || 0) - dt);
      e.touchCd = Math.max(0, e.touchCd - dt);

      if (e.slow > 0) e.slow = Math.max(0, e.slow - dt);
      const slowMul = e.slow > 0 ? e.slowFactor || 0.5 : 1;

      if (e.burn > 0) {
        e.burn -= dt;
        this._damageEnemy(e, e.burnDps * dt, 0, true);
        if (Math.random() < dt * 14) {
          this.particles.push(this._particle(e.x + rand(-e.r, e.r), e.y + rand(-e.r, e.r), rand(-20, 20), rand(-60, -20), rand(0.3, 0.6), rand(2, 4), '#ff9d57'));
        }
        if (e.hp <= 0) continue;
      }

      const a = angleTo(e.x, e.y, p.x, p.y);
      const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
      let ax = 0;
      let ay = 0;

      if (e.type === 'orb') {
        const desired = 235;
        const radial = d > desired + 30 ? 1 : d < desired - 30 ? -1 : 0;
        ax = Math.cos(a) * radial + Math.cos(a + Math.PI / 2) * 0.65 * e.strafe;
        ay = Math.sin(a) * radial + Math.sin(a + Math.PI / 2) * 0.65 * e.strafe;
        e.shootCd -= dt;
        if (e.shootCd <= 0 && d < 700) {
          e.shootCd = Math.max(1.1, 2.5 - this.wave * 0.03);
          const spread = rand(-0.1, 0.1);
          this.hazards.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a + spread) * 205,
            vy: Math.sin(a + spread) * 205,
            r: 8,
            damage: 9 * (1 + (this.wave - 1) * 0.07),
            life: 4,
            color: '#ff7fe0',
          });
          this._burst(e.x, e.y, 4, '#ff7fe0', 60);
        }
      } else if (e.type === 'shard') {
        const weave = Math.sin(this.time * 4 + e.phase) * 0.55;
        ax = Math.cos(a + weave);
        ay = Math.sin(a + weave);
      } else if (e.type === 'boss') {
        e.shootCd -= dt;
        ax = Math.cos(a);
        ay = Math.sin(a);
        if (e.shootCd <= 0) {
          e.shootCd = Math.max(1.4, 3.1 - this.wave * 0.04);
          const shots = 12;
          for (let i = 0; i < shots; i++) {
            const sa = (i / shots) * TAU + e.rot;
            this.hazards.push({
              x: e.x + Math.cos(sa) * e.r,
              y: e.y + Math.sin(sa) * e.r,
              vx: Math.cos(sa) * 175,
              vy: Math.sin(sa) * 175,
              r: 9,
              damage: 11 * (1 + (this.wave - 1) * 0.06),
              life: 5,
              color: '#ff4d6d',
            });
          }
          this.effects.push({ type: 'nova', x: e.x, y: e.y, r: e.r, max: e.r * 2.6, life: 0.45, color: '#ff4d6d' });
        }
      } else {
        ax = Math.cos(a);
        ay = Math.sin(a);
      }

      const targetVx = ax * e.speed * slowMul;
      const targetVy = ay * e.speed * slowMul;
      e.vx += (targetVx - e.vx) * Math.min(1, 6 * dt);
      e.vy += (targetVy - e.vy) * Math.min(1, 6 * dt);
      e.x += (e.vx + e.kx) * dt;
      e.y += (e.vy + e.ky) * dt;
      e.kx *= Math.pow(0.0015, dt);
      e.ky *= Math.pow(0.0015, dt);

      e.x = clamp(e.x, e.r, this.w - e.r);
      e.y = clamp(e.y, e.r, this.h - e.r);

      // Contact damage.
      const contact = (e.r + p.r) * 0.92;
      if (dist2(e.x, e.y, p.x, p.y) < contact * contact && e.touchCd <= 0) {
        e.touchCd = 0.8;
        this._hurtPlayer(e.damage, e.x, e.y);
        // Push the enemy back so it does not sit inside the player.
        e.kx -= Math.cos(a) * 170;
        e.ky -= Math.sin(a) * 170;
      }
    }

    this._separate(dt);
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    if (this.boss && this.boss.hp <= 0) this.boss = null;
  }

  _separate(dt) {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.hp <= 0) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.hp <= 0) continue;
        const min = a.r + b.r;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.5 * Math.min(1, dt * 18);
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
        }
      }
    }
  }

  _damageEnemy(e, amount, dirAngle, silent = false) {
    if (e.hp <= 0) return;
    e.hp -= amount;
    e.flash = 1;
    if (!silent) {
      if (amount >= 22 || Math.random() < 0.35) {
        this._text(e.x + rand(-6, 6), e.y - e.r * 0.5, String(Math.round(amount)), amount >= 30 ? '#ffe08a' : '#e8e1ff');
      }
    }
    if (e.hp <= 0) this._killEnemy(e, dirAngle);
  }

  _killEnemy(e, dirAngle) {
    e.hp = 0;
    const def = ENEMY_TYPES[e.type];
    this.score += e.score;
    this._burst(e.x, e.y, e.type === 'boss' ? 60 : 14, e.glow, e.type === 'boss' ? 320 : 170);
    this.effects.push({ type: 'nova', x: e.x, y: e.y, r: e.r * 0.6, max: e.r * 2.4, life: 0.4, color: e.glow });
    this.shake = Math.max(this.shake, e.type === 'boss' ? 1.1 : 0.22);

    if (this.stats.soul > 0) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.stats.soul);
    }

    // Loot.
    const roll = Math.random();
    if (e.type === 'boss') {
      this.pickups.push(this._pickup(e.x, e.y, 'heal', 25));
      this.pickups.push(this._pickup(e.x + 22, e.y, 'mana', 40));
    } else if (roll < 0.05) {
      this.pickups.push(this._pickup(e.x, e.y, 'heal', 12));
    } else if (roll < 0.13) {
      this.pickups.push(this._pickup(e.x, e.y, 'mana', 18));
    }

    if (def) {
      this.cb.onScore?.(this.score);
    }
  }

  /* ------------------------------------------------------- projectiles */

  _updateProjectiles(dt) {
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;

      if (Math.random() < 0.85) {
        this.particles.push(
          this._particle(pr.x, pr.y, rand(-18, 18), rand(-18, 18), rand(0.14, 0.3), rand(1.6, 3.2), pr.trail || pr.color),
        );
      }

      if (pr.x < -30 || pr.x > this.w + 30 || pr.y < -30 || pr.y > this.h + 30) pr.life = 0;
      if (pr.life <= 0) continue;

      for (const e of this.enemies) {
        if (e.hp <= 0 || pr.hits.has(e)) continue;
        const rr = pr.r + e.r;
        if (dist2(pr.x, pr.y, e.x, e.y) < rr * rr) {
          pr.hits.add(e);
          const ang = Math.atan2(pr.vy, pr.vx);
          this._damageEnemy(e, pr.damage, ang);
          e.kx += Math.cos(ang) * 90;
          e.ky += Math.sin(ang) * 90;
          this._burst(pr.x, pr.y, 6, pr.color, 130);

          if (pr.kind === 'fireball') {
            this._explode(pr);
            pr.life = 0;
            break;
          }
          if (pr.pierce > 0) {
            pr.pierce -= 1;
            pr.damage *= 0.9;
          } else {
            pr.life = 0;
            break;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  _explode(pr) {
    const s = this.stats;
    const radius = 74 * s.fireScale;
    const dmg = 30 * s.power * s.fireScale;
    this.effects.push({ type: 'nova', x: pr.x, y: pr.y, r: 8, max: radius, life: 0.42, color: '#ffb066' });
    this._burst(pr.x, pr.y, 18, '#ffb066', 230);
    this.particles.push(this._particle(pr.x, pr.y, 0, 0, 0.5, 40, '#ff7a2f'));
    this.shake = Math.max(this.shake, 0.4);
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (dist2(pr.x, pr.y, e.x, e.y) < (radius + e.r) ** 2) {
        this._damageEnemy(e, dmg, angleTo(pr.x, pr.y, e.x, e.y));
        e.burn = Math.max(e.burn, 2.4);
        e.burnDps = Math.max(e.burnDps, 7 * s.power);
      }
    }
  }

  _updateHazards(dt) {
    const p = this.player;
    for (const hz of this.hazards) {
      hz.life -= dt;
      hz.x += hz.vx * dt;
      hz.y += hz.vy * dt;
      if (Math.random() < 0.3) {
        this.particles.push(this._particle(hz.x, hz.y, rand(-10, 10), rand(-10, 10), 0.25, 2.5, hz.color));
      }
      if (hz.life <= 0 || hz.x < -40 || hz.x > this.w + 40 || hz.y < -40 || hz.y > this.h + 40) {
        hz.life = 0;
        continue;
      }
      if (p.invuln <= 0 && dist2(hz.x, hz.y, p.x, p.y) < (hz.r + p.r) ** 2) {
        hz.life = 0;
        this._hurtPlayer(hz.damage, hz.x, hz.y);
      }
    }
    this.hazards = this.hazards.filter((h) => h.life > 0);
  }

  _updatePickups(dt) {
    const p = this.player;
    for (const it of this.pickups) {
      it.life -= dt;
      it.bob += dt * 3;
      const d = Math.sqrt(dist2(it.x, it.y, p.x, p.y));
      const reach = 62 * this.stats.magnet;
      if (d < reach) {
        const a = angleTo(it.x, it.y, p.x, p.y);
        const pull = (1 - d / reach) * 340 * dt;
        it.x += Math.cos(a) * pull;
        it.y += Math.sin(a) * pull;
      }
      if (d < p.r + 14) {
        it.life = 0;
        if (it.kind === 'heal') {
          p.hp = Math.min(p.maxHp, p.hp + it.amount);
          this._text(p.x, p.y - 30, `+${it.amount}`, '#8effc0');
        } else {
          p.mana = Math.min(p.maxMana, p.mana + it.amount);
          this._text(p.x, p.y - 30, `+${it.amount}`, '#7fd8ff');
        }
        this._burst(it.x, it.y, 10, it.kind === 'heal' ? '#8effc0' : '#7fd8ff', 130);
        this.cb.onPickup?.();
      }
    }
    this.pickups = this.pickups.filter((i) => i.life > 0);
  }

  _hurtPlayer(amount, fromX, fromY) {
    const p = this.player;
    if (p.invuln > 0 || this.phase === 'dead') return;
    p.hp -= amount;
    p.invuln = 0.55;
    this.flash = Math.min(1, this.flash + 0.55);
    this.shake = Math.max(this.shake, 0.6);
    const a = angleTo(fromX, fromY, p.x, p.y);
    p.vx += Math.cos(a) * 130;
    p.vy += Math.sin(a) * 130;
    this._burst(p.x, p.y, 12, '#ff5c7c', 150);
    this._text(p.x, p.y - 32, `-${Math.round(amount)}`, '#ff8fa3');
    this.cb.onHurt?.();

    if (p.hp <= 0) {
      p.hp = 0;
      this._die();
    }
  }

  saveBest() {
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('spell.best', String(this.best));
    }
    return this.best;
  }

  _die() {
    this.phase = 'dead';
    const p = this.player;
    p.alive = false;
    this._burst(p.x, p.y, 50, '#a98bff', 320);
    this.effects.push({ type: 'nova', x: p.x, y: p.y, r: 10, max: 220, life: 0.7, color: '#c9b6ff' });
    this.shake = 1.4;
    const best = this.saveBest();
    this.cb.onDeath?.({ wave: this.wave, score: this.score, best });
  }

  /* ------------------------------------------------------ fx & utils */

  _particle(x, y, vx, vy, life, size, color, glow = true) {
    return { x, y, vx, vy, life, maxLife: life, size, color, glow };
  }

  _burst(x, y, count, color, speed) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(speed * 0.25, speed);
      this.particles.push(
        this._particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.25, 0.7), rand(1.5, 4), color),
      );
    }
  }

  _text(x, y, text, color) {
    this.texts.push({ x, y, text, color, life: 0.8, maxLife: 0.8, vy: -38 });
    if (this.texts.length > 60) this.texts.shift();
  }

  _pickup(x, y, kind, amount) {
    return { x, y, kind, amount, life: 16, bob: rand(0, TAU) };
  }

  _updateParticles(dt) {
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.pow(0.06, dt);
      pt.vy *= Math.pow(0.06, dt);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 1400) this.particles.splice(0, this.particles.length - 1400);
  }

  _updateTexts(dt) {
    for (const t of this.texts) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= Math.pow(0.2, dt);
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  /* ------------------------------------------------------------ render */

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    this._drawFloor(ctx);

    ctx.save();
    if (this.shake > 0) {
      const m = this.shake * this.shake * 12;
      ctx.translate(rand(-m, m), rand(-m, m));
    }

    this._drawEffects(ctx, true);
    this._drawPickups(ctx);
    this._drawEnemies(ctx);
    this._drawProjectiles(ctx);
    this._drawHazards(ctx);
    if (this.player && this.player.alive) this._drawPlayer(ctx);
    this._drawParticles(ctx);
    this._drawEffects(ctx, false);
    this._drawTexts(ctx);
    ctx.restore();

    this._drawVignette(ctx);

    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(255, 60, 90, ${this.flash * 0.22})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    if (this.phase !== 'idle') this._drawReticle(ctx);
  }

  _drawFloor(ctx) {
    const { w, h } = this;
    const bg = ctx.createRadialGradient(w * 0.5, h * 0.42, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    bg.addColorStop(0, '#171034');
    bg.addColorStop(0.5, '#0c0920');
    bg.addColorStop(1, '#06040f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const cell = 72;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(140, 120, 255, 0.075)';
    ctx.beginPath();
    for (let x = 0; x <= w; x += cell) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = 0; y <= h; y += cell) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();

    // Rune ticks at intersections, pulsing gently.
    const pulse = 0.06 + 0.04 * Math.sin(this.time * 1.6);
    ctx.strokeStyle = `rgba(111, 242, 255, ${pulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += cell * 2) {
      for (let y = 0; y <= h; y += cell * 2) {
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x + 4, y);
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x, y + 4);
      }
    }
    ctx.stroke();

    for (const d of this.dust) {
      ctx.fillStyle = `rgba(180, 200, 255, ${d.a})`;
      ctx.fillRect(d.x, d.y, d.r, d.r);
    }

    // Arena frame.
    ctx.strokeStyle = 'rgba(150, 130, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(12.5, 12.5, w - 25, h - 25);
    const corners = [
      [12, 12, 1, 1],
      [w - 12, 12, -1, 1],
      [12, h - 12, 1, -1],
      [w - 12, h - 12, -1, -1],
    ];
    ctx.strokeStyle = 'rgba(111, 242, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of corners) {
      ctx.moveTo(cx + sx * 46, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * 46);
    }
    ctx.stroke();
  }

  _drawPlayer(ctx) {
    const p = this.player;
    const bob = Math.sin(p.walk) * 1.8;

    // Ground shadow keeps the mage readable on the dark floor.
    ctx.fillStyle = 'rgba(4, 2, 12, 0.55)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 20, 20, 7, 0, 0, TAU);
    ctx.fill();

    drawGlow(ctx, p.x, p.y + 2, 66, '#6b4dff', 0.34);

    // Aim beam: a thin line showing exactly where the staff points.
    ctx.strokeStyle = 'rgba(150, 240, 255, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 9]);
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(p.aim) * 26, p.y + Math.sin(p.aim) * 26);
    ctx.lineTo(p.x + Math.cos(p.aim) * 110, p.y + Math.sin(p.aim) * 110);
    ctx.stroke();
    ctx.setLineDash([]);

    // Cloak + body: dark robe, bright trim.
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(p.aim + Math.PI / 2);

    ctx.beginPath();
    ctx.moveTo(0, -21);
    ctx.quadraticCurveTo(23, 14, 0, 25);
    ctx.quadraticCurveTo(-23, 14, 0, -21);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, -22, 0, 26);
    grad.addColorStop(0, '#3d2f83');
    grad.addColorStop(0.5, '#2a1f63');
    grad.addColorStop(1, '#150f38');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(176, 226, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cloak trim.
    ctx.beginPath();
    ctx.moveTo(-9, 8);
    ctx.quadraticCurveTo(0, 17, 9, 8);
    ctx.strokeStyle = 'rgba(111, 242, 255, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Hood.
    ctx.beginPath();
    ctx.arc(0, -11, 11, 0, TAU);
    ctx.fillStyle = '#120e2e';
    ctx.fill();
    ctx.strokeStyle = 'rgba(196, 236, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Face sigil.
    ctx.beginPath();
    ctx.arc(0, -11, 4.4, 0, TAU);
    ctx.fillStyle = '#c8fff8';
    ctx.fill();
    drawGlow(ctx, 0, -11, 14, '#6ff2ff', 0.75);
    ctx.restore();

    // Staff.
    ctx.strokeStyle = 'rgba(200, 235, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(p.aim) * 6, p.y + Math.sin(p.aim) * 6 + bob);
    ctx.lineTo(p.x + Math.cos(p.aim) * 24, p.y + Math.sin(p.aim) * 24 + bob);
    ctx.stroke();

    const ox = p.x + Math.cos(p.aim) * 24;
    const oy = p.y + Math.sin(p.aim) * 24 + bob;
    drawGlow(ctx, ox, oy, 26, '#6ff2ff', 0.8);
    ctx.beginPath();
    ctx.arc(ox, oy, 5.4, 0, TAU);
    ctx.fillStyle = '#f2ffff';
    ctx.fill();

    // Rotating ward ring.
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-this.time * 1.4);
    ctx.strokeStyle = 'rgba(140, 240, 255, 0.42)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([9, 12]);
    ctx.beginPath();
    ctx.arc(0, 0, 29, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    if (p.invuln > 0) {
      ctx.globalAlpha = 0.5 + 0.35 * Math.sin(this.time * 30);
      ctx.strokeStyle = '#a7ffd0';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 31, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _drawEnemies(ctx) {
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const flash = e.flash;
      drawGlow(ctx, e.x, e.y, e.r * 3.4, e.glow, 0.5 + flash * 0.35);

      // Ground shadow.
      ctx.fillStyle = 'rgba(4, 2, 12, 0.4)';
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + e.r * 0.85, e.r * 0.85, e.r * 0.28, 0, 0, TAU);
      ctx.fill();

      ctx.save();
      ctx.translate(e.x, e.y);

      if (e.shape === 'blob') {
        const wob = 1 + Math.sin(e.wobble) * 0.07;
        ctx.rotate(Math.sin(e.wobble * 0.5) * 0.2);
        ctx.beginPath();
        const pts = 9;
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * TAU;
          const rr = e.r * wob * (0.86 + 0.16 * Math.sin(a * 3 + e.wobble));
          const x = Math.cos(a) * rr;
          const y = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const g = ctx.createRadialGradient(0, 0, e.r * 0.1, 0, 0, e.r * 1.15);
        g.addColorStop(0, '#ffd0dd');
        g.addColorStop(0.45, hexToRgba(e.color, 0.95));
        g.addColorStop(1, 'rgba(84, 8, 44, 0.96)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = flash > 0.4 ? '#ffffff' : 'rgba(255, 160, 190, 0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Core eye.
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.24, 0, TAU);
        ctx.fillStyle = '#fff3f7';
        ctx.fill();
      } else if (e.shape === 'shard') {
        ctx.rotate(Math.atan2(e.vy, e.vx));
        const g = ctx.createLinearGradient(-e.r, 0, e.r * 1.4, 0);
        g.addColorStop(0, 'rgba(120, 40, 6, 0.95)');
        g.addColorStop(0.65, hexToRgba(e.color, 1));
        g.addColorStop(1, '#fff6d8');
        ctx.beginPath();
        ctx.moveTo(e.r * 1.6, 0);
        ctx.lineTo(-e.r * 0.9, e.r * 0.75);
        ctx.lineTo(-e.r * 0.3, 0);
        ctx.lineTo(-e.r * 0.9, -e.r * 0.75);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = flash > 0.4 ? '#ffffff' : 'rgba(255, 226, 170, 0.95)';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      } else if (e.shape === 'orb') {
        ctx.beginPath();
        ctx.arc(0, 0, e.r, 0, TAU);
        ctx.fillStyle = 'rgba(46, 4, 40, 0.92)';
        ctx.fill();
        ctx.strokeStyle = flash > 0.4 ? '#ffffff' : hexToRgba(e.color, 1);
        ctx.lineWidth = 3.4;
        ctx.stroke();
        drawGlow(ctx, 0, 0, e.r * 1.25, e.color, 0.85);
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.52, 0, TAU);
        ctx.fillStyle = '#ffeafb';
        ctx.fill();
        ctx.rotate(-e.rot * 1.5);
        for (let i = 0; i < 3; i++) {
          const ra = (i / 3) * TAU;
          ctx.beginPath();
          ctx.arc(Math.cos(ra) * e.r * 1.45, Math.sin(ra) * e.r * 1.45, 3, 0, TAU);
          ctx.fillStyle = '#ffb8ef';
          ctx.fill();
        }
      } else {
        const isBoss = e.shape === 'boss';
        const sides = isBoss ? 8 : 6;
        ctx.rotate(e.rot * (isBoss ? 0.45 : 0.9));
        polygon(ctx, 0, 0, e.r, sides);
        const g = ctx.createRadialGradient(0, 0, e.r * 0.15, 0, 0, e.r);
        g.addColorStop(0, hexToRgba(e.color, 1));
        g.addColorStop(0.55, hexToRgba(e.color, 0.72));
        g.addColorStop(1, 'rgba(34, 4, 30, 0.96)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = flash > 0.4 ? '#ffffff' : hexToRgba('#ffd6ea', 0.95);
        ctx.lineWidth = isBoss ? 4 : 2.6;
        ctx.stroke();

        // Inner struts give the heavy units a mechanical read.
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
          const a0 = (i / sides) * TAU;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a0) * e.r * 0.92, Math.sin(a0) * e.r * 0.92);
        }
        ctx.strokeStyle = hexToRgba(e.color, 0.35);
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.36, 0, TAU);
        ctx.fillStyle = '#ffe1ec';
        ctx.fill();
        drawGlow(ctx, 0, 0, e.r * 0.9, e.glow, 0.55);

        if (isBoss) {
          ctx.rotate(-e.rot * 1.6);
          ctx.strokeStyle = 'rgba(255, 170, 200, 0.6)';
          ctx.lineWidth = 2.4;
          ctx.setLineDash([12, 16]);
          ctx.beginPath();
          ctx.arc(0, 0, e.r * 1.32, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#ffd0e0';
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * TAU + this.time * 0.9;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * e.r * 1.32, Math.sin(a) * e.r * 1.32, 3.6, 0, TAU);
            ctx.fill();
          }
        }
      }
      ctx.restore();

      // Frozen shell.
      if (e.slow > 0) {
        ctx.strokeStyle = 'rgba(170, 240, 255, 0.9)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 6, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(220, 250, 255, 0.35)';
        ctx.lineWidth = 6;
        ctx.stroke();
      }

      // Health bar.
      if (e.type === 'boss') {
        const width = 190;
        const y = e.y - e.r - 26;
        ctx.fillStyle = 'rgba(5, 3, 12, 0.8)';
        ctx.beginPath();
        ctx.roundRect(e.x - width / 2, y, width, 8, 4);
        ctx.fill();
        const grad = ctx.createLinearGradient(e.x - width / 2, 0, e.x + width / 2, 0);
        grad.addColorStop(0, '#ff2d6f');
        grad.addColorStop(1, '#ffb066');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(e.x - width / 2 + 1, y + 1, Math.max(0, (width - 2) * clamp(e.hp / e.maxHp, 0, 1)), 6, 3);
        ctx.fill();
      } else if (e.hp < e.maxHp) {
        const width = e.r * 2.2;
        const y = e.y - e.r - 11;
        ctx.fillStyle = 'rgba(5, 3, 12, 0.75)';
        ctx.beginPath();
        ctx.roundRect(e.x - width / 2, y, width, 4, 2);
        ctx.fill();
        ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#ff7d9c' : '#ffd166';
        ctx.beginPath();
        ctx.roundRect(e.x - width / 2, y, Math.max(0, width * (e.hp / e.maxHp)), 4, 2);
        ctx.fill();
      }
    }
  }

  _drawProjectiles(ctx) {
    for (const pr of this.projectiles) {
      const a = Math.atan2(pr.vy, pr.vx);
      ctx.save();
      ctx.translate(pr.x, pr.y);
      ctx.rotate(a);
      drawGlow(ctx, 0, 0, pr.r * 6, pr.color, 0.9);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 0, pr.r * 2.1, pr.r * 0.72, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.ellipse(-pr.r * 1.6, 0, pr.r * 1.9, pr.r * 0.5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawHazards(ctx) {
    for (const hz of this.hazards) {
      const a = Math.atan2(hz.vy, hz.vx);
      drawGlow(ctx, hz.x, hz.y, hz.r * 5, hz.color, 0.85);
      ctx.save();
      ctx.translate(hz.x, hz.y);
      ctx.rotate(a);
      ctx.fillStyle = hexToRgba(hz.color, 0.5);
      ctx.beginPath();
      ctx.ellipse(-hz.r * 2.2, 0, hz.r * 2.4, hz.r * 0.8, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, hz.r, 0, TAU);
      ctx.fillStyle = '#fff6fd';
      ctx.fill();
      ctx.strokeStyle = hz.color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  _drawPickups(ctx) {
    for (const it of this.pickups) {
      const y = it.y + Math.sin(it.bob) * 3;
      const color = it.kind === 'heal' ? '#7dffb8' : '#7fd8ff';
      drawGlow(ctx, it.x, y, 24, color, 0.6);
      ctx.save();
      ctx.translate(it.x, y);
      ctx.rotate(it.bob * 0.6);
      polygon(ctx, 0, 0, 7, 4, Math.PI / 4);
      ctx.fillStyle = it.kind === 'heal' ? '#c8ffe2' : '#d6f4ff';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawParticles(ctx) {
    for (const pt of this.particles) {
      const t = Math.max(0, pt.life / pt.maxLife);
      if (pt.size > 12) {
        // Shockwave puffs.
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, pt.x, pt.y, pt.size * (1 + (1 - t)), pt.color, t * 0.35);
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      // Soft halo, then a solid core so overlapping sparks keep their colour
      // instead of blowing out to white.
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, pt.x, pt.y, pt.size * 3.2, pt.color, t * 0.3);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = t;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (0.55 + t * 0.55), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawEffects(ctx, behind) {
    for (const fx of this.effects) {
      if (fx.life <= 0) continue;
      const isBehind = fx.type === 'nova' || fx.type === 'spawn';
      if (isBehind !== behind) continue;
      const t = clamp(fx.life / 0.5, 0, 1);

      if (fx.type === 'nova' || fx.type === 'spawn') {
        const k = 1 - fx.life / (fx.type === 'spawn' ? 0.55 : 0.5);
        const r = fx.r + (fx.max - fx.r) * Math.min(1, k * 1.25);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hexToRgba(fx.color, 0.09 * (1 - k));
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(fx.color, 0.9 * (1 - k));
        ctx.lineWidth = 5 * (1 - k) + 1.5;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = hexToRgba('#ffffff', 0.6 * (1 - k));
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, Math.max(0, r - 5), 0, TAU);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }

      if (fx.type === 'lightning' && !behind) {
        const a = fx.a;
        const b = fx.b;
        const segs = 9;
        ctx.globalCompositeOperation = 'lighter';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass === 0 ? hexToRgba(fx.color, 0.35 * t) : `rgba(255,255,255,${0.9 * t})`;
          ctx.lineWidth = pass === 0 ? 7 : 1.8;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          for (let i = 1; i < segs; i++) {
            const k = i / segs;
            const nx = a.x + (b.x - a.x) * k;
            const ny = a.y + (b.y - a.y) * k;
            const jitter = Math.sin(fx.seed + i * 3.7) * 11 * (1 - Math.abs(k - 0.5) * 0.8);
            const px = -((b.y - a.y) / (Math.hypot(b.x - a.x, b.y - a.y) || 1));
            const py = (b.x - a.x) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
            ctx.lineTo(nx + px * jitter, ny + py * jitter);
          }
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      if (fx.type === 'trail' && behind) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = hexToRgba(fx.color, 0.3 * t);
        ctx.lineWidth = 18 * t;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fx.a.x, fx.a.y);
        ctx.lineTo(fx.b.x, fx.b.y);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    this.effects = this.effects.filter((f) => f.life > 0);
  }

  _drawTexts(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.maxLife;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.font = `700 ${13 + (1 - k) * 4}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 12;
      ctx.fillText(t.text, t.x, t.y);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  _drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.3,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.75,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  _drawReticle(ctx) {
    const pointer = this.input.pointer;
    if (!pointer.inside) return;
    const ready = this.player && this.player.mana >= SPELL_BY_ID.fire.cost;
    ctx.save();
    ctx.translate(pointer.x, pointer.y);
    ctx.rotate(this.time * 2.1);
    ctx.strokeStyle = ready ? 'rgba(255, 196, 120, 0.9)' : 'rgba(150, 235, 255, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
      ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, TAU);
    ctx.strokeStyle = 'rgba(160, 240, 255, 0.25)';
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 2, 0, TAU);
    ctx.fillStyle = '#eafcff';
    ctx.fill();
  }
}
