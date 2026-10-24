// LYKTTÄNDAREN — a lantern-lit puzzle platformer in the dusk forest.
// Game state, puzzles and rendering all live here.

import { Body, rectsOverlap, rayRect, reflect } from './physics.js';
import { ROOMS, FLOOR, MEMORIES } from './world.js';

// Older Safari has no roundRect; without this the whole frame would throw.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, r = 0) {
    const rr = Math.min(typeof r === 'number' ? r : 0, Math.abs(w) / 2, Math.abs(h) / 2);
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
    return this;
  };
}

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const sign = (v) => (v < 0 ? -1 : 1);
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

const PHYS = {
  run: 262,
  accel: 2900,
  airAccel: 2100,
  jump: 700,
  jump2: 640,
  gravity: 2080,
  maxFall: 1050,
};

const CHARGE = { push: 0.3, beam: 0.9, max: 1.5 };
const CAST = { pushSpeed: 470, beamRange: 230, bombRadius: 138 };

const MOODS = {
  home: { deep: '#0b141d', sky: '#162633', rock: '#22303f', moss: '#3f8a76', rim: '#9df3d8', accent: '#ffcf7a', glow: '#ffd79a' },
  thorn: { deep: '#0a1618', sky: '#12292a', rock: '#1d3231', moss: '#3c8767', rim: '#9dffcd', accent: '#b6ff8f', glow: '#a8ffcf' },
  mirror: { deep: '#0d0c1c', sky: '#1a1734', rock: '#262247', moss: '#544d96', rim: '#c9b6ff', accent: '#e0d3ff', glow: '#d7c8ff' },
  stone: { deep: '#0b1219', sky: '#162230', rock: '#232f3f', moss: '#4a7288', rim: '#a8e2f7', accent: '#c2e8ff', glow: '#c2e8ff' },
  echo: { deep: '#0a1618', sky: '#122a2e', rock: '#1d3439', moss: '#3f878c', rim: '#9cf3f4', accent: '#bff9ff', glow: '#bff9ff' },
  memory: { deep: '#100e1e', sky: '#1d1a38', rock: '#2b2748', moss: '#5b5499', rim: '#efe7ff', accent: '#fff0c4', glow: '#fff4d2' },
};

const safeStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode: scores simply do not persist */
    }
  },
};

export class Game {
  constructor(canvas, input, cb = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.cb = cb;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 1280;
    this.h = 720;
    this.lightCanvas = document.createElement('canvas');
    this.lightCtx = this.lightCanvas.getContext('2d');

    this.time = 0;
    this.mode = 'title'; // title | play | memory | rest | paused | dead | end
    this.adapt = 0.5;
    this.deaths = 0;
    this.shards = [];
    this.best = Number(safeStorage.get('lykt.memories') || 0);
    this.muted = false;

    this.cam = { x: 0, y: 0 };
    this.zoom = 1;
    this.shake = 0;
    this.flash = 0;
    this.exitLock = 0;
    this.stuck = 0;
    this.hintIndex = 0;
    this.whisperCooldown = 0;

    this.particles = [];
    this.fx = [];
    this.orbs = [];
    this.whispers = [];

    // Callbacks are muted until construction finishes; the constructor itself
    // loads the first room, and the UI is not wired up yet at that point.
    this.ready = false;
    this.player = this.makePlayer();
    this.world = {};
    this.carry = null;
    this.resize();
    this.resetWorld();
    this.loadRoom('hub', ROOMS.hub.spawn);
    this.ready = true;
  }

  /* ------------------------------------------------------------- lifecycle */

  makePlayer() {
    const b = new Body(260, 700, 26, 44);
    return {
      body: b,
      facing: 1,
      hp: 3,
      maxHp: 3,
      invuln: 0.6,
      charging: false,
      chargeT: 0,
      castCd: 0,
      aimUp: false,
      anim: 0,
      land: 0,
      airJump: true,
      coyote: 0,
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(480, Math.round(rect.width));
    this.h = Math.max(320, Math.round(rect.height));
    // A zoomed-in camera keeps the knight readable on tall screens.
    this.zoom = clamp(Math.min(this.w / 1120, this.h / 640), 1, 2.1);
    this.viewW = this.w / this.zoom;
    this.viewH = this.h / this.zoom;
    const dpr = this.dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.lightCanvas.width = Math.round(this.w * dpr);
    this.lightCanvas.height = Math.round(this.h * dpr);
  }

  resetWorld() {
    this.world = {};
    for (const id of Object.keys(ROOMS)) {
      const def = ROOMS[id];
      this.world[id] = {
        lamps: def.lamps.map((l) => ({ ...l, lit: false })),
        vines: def.vines.map((v) => ({ ...v, burnt: false, burn: 0 })),
        mirrors: def.mirrors.map((m) => ({ ...m })),
        crates: def.crates.map((c) => ({ body: new Body(c.x, c.y, 44, 44), vx: 0, vy: 0, glow: 0 })),
        plates: def.plates.map((p) => ({ ...p, pressed: false, anim: 0 })),
        gates: def.gates.map((g) => ({ ...g, open: false, anim: 0 })),
        shard: def.shard ? { ...def.shard, taken: false, t: 0 } : null,
        echo: def.echo
          ? { x: def.echo.x, y: def.echo.y, duration: def.echo.duration, recording: false, playing: false, t: 0, frames: [], playT: 0, pos: null }
          : null,
        midges: def.midges.map((m) => ({ x: m.x, y: m.y, hx: m.x, hy: m.y, phase: Math.random() * TAU, t: 0, dead: false, alert: false })),
        beamHit: false,
        solved: false,
      };
    }
  }

  start() {
    this.mode = 'play';
    this.adapt = 0.5;
    this.deaths = 0;
    this.shards = [];
    this.whispers = [];
    this.particles.length = 0;
    this.fx.length = 0;
    this.orbs.length = 0;
    this.player = this.makePlayer();
    this.resetWorld();
    this.loadRoom('hub', ROOMS.hub.spawn);
    this.cb.onStart?.();
    this.whisper('Glim: Äntligen vaken. Lyktan är din igen.');
  }

  loadRoom(id, spawn = null) {
    this.roomId = id;
    this.roomDef = ROOMS[id];
    this.state = this.world[id];
    this.mood = MOODS[this.roomDef.mood] || MOODS.home;
    const p = this.player;
    const point = spawn || this.roomDef.spawn;
    p.body.x = point.x;
    p.body.y = point.y - p.body.h;
    p.body.vx = 0;
    p.body.vy = 0;
    p.charging = false;
    p.chargeT = 0;
    p.airJump = true;
    this.orbs.length = 0;
    this.beamPath = null;
    this.exitLock = 0.35;
    this.stuck = 0;
    this.hintIndex = 0;
    this.cam.x = clamp(p.body.cx - this.viewW / 2, 0, Math.max(0, this.roomDef.w - this.viewW));
    this.cam.y = clamp(p.body.cy - this.viewH * 0.55, 0, Math.max(0, 900 - this.viewH));
    if (this.ready) this.cb.onRoom?.(id, this.roomDef);
  }

  /* ---------------------------------------------------------------- input */

  interactable() {
    const b = this.player.body;
    const st = this.state;
    const near = (x, y, r = 74) => dist(b.cx, b.cy, x, y) < r;

    for (const m of st.mirrors) if (near(m.x, m.y)) return { type: 'mirror', obj: m };
    if (st.echo && near(st.echo.x, st.echo.y - 20)) return { type: 'echo', obj: st.echo };
    for (const l of st.lamps) if (l.hearth && near(l.x, l.y - 30)) return { type: 'hearth', obj: l };
    if (this.roomDef.altar && near(this.roomDef.altar.x + 55, this.roomDef.altar.y + 40, 90)) {
      return { type: 'altar', obj: this.roomDef.altar };
    }
    return null;
  }

  /** Context prompt for the HUD. */
  prompt() {
    if (this.mode !== 'play') return '';
    const it = this.interactable();
    if (!it) {
      if (this.roomDef.mirror && dist(this.player.body.cx, this.player.body.cy, this.roomDef.mirror.x, this.roomDef.mirror.y - 40) < 110) {
        return 'Minnet väntar';
      }
      return '';
    }
    if (it.type === 'mirror') return 'E — vrid spegeln';
    if (it.type === 'echo') return it.obj.recording ? 'E — avsluta inspelningen' : 'E — spela in dina steg';
    if (it.type === 'hearth') return 'E — vila vid lyktan';
    if (it.type === 'altar') {
      return this.shards.length >= 3 ? 'E — minnas' : `Altaret saknar ${3 - this.shards.length} minne(n)`;
    }
    return '';
  }

  /* --------------------------------------------------------------- update */

  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 3.4);
    this.flash = Math.max(0, this.flash - dt * 2.8);
    this.exitLock = Math.max(0, this.exitLock - dt);
    this.whisperCooldown = Math.max(0, this.whisperCooldown - dt);
    this.updateParticles(dt);
    if (this.state) this.state.shard && (this.state.shard.t += dt);

    if (this.mode !== 'play') {
      if (this.mode === 'memory' || this.mode === 'rest' || this.mode === 'paused') return;
      this.updateCamera(dt);
      return;
    }

    const p = this.player;
    p.anim += dt;
    p.castCd = Math.max(0, p.castCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.land = Math.max(0, p.land - dt * 5);

    this.stuck += dt;
    this.updatePlayer(dt);
    this.updateCasting(dt);
    this.updateCrates(dt);
    this.updateGates(dt);
    this.updatePlates(dt);
    this.updateBeam(dt);
    this.updateEcho(dt);
    this.updateMidges(dt);
    this.updateOrbs(dt);
    this.checkPickups();
    this.checkExits();
    this.updateCamera(dt);
    this.updateHints(dt);
  }

  updatePlayer(dt) {
    const p = this.player;
    const b = p.body;
    const input = this.input;
    const solids = this.solids();

    let dir = input.axis;
    const accel = b.onGround ? PHYS.accel : PHYS.airAccel;
    const target = dir * PHYS.run;
    const diff = target - b.vx;
    const step = accel * dt;
    b.vx += Math.abs(diff) < step ? diff : sign(diff) * step;
    if (dir !== 0 && !p.charging) p.facing = dir;
    if (dir !== 0) p.facing = dir;

    const wasGround = b.onGround;

    if (input.hit('jump')) {
      if (b.onGround || b.coyote > 0.09) {
        b.vy = -PHYS.jump;
        b.onGround = false;
        b.coyote = 0;
        p.airJump = true;
        p.land = -0.35;
        this.puff(b.cx, b.bottom, 5, this.mood.accent);
        this.cb.onJump?.();
      } else if (p.airJump) {
        p.airJump = false;
        b.vy = -PHYS.jump2;
        for (let i = 0; i < 8; i++) {
          const a = Math.PI / 2 + rand(-1, 1);
          this.particles.push(this.particle(b.cx, b.cy + 12, Math.cos(a) * rand(30, 130), Math.sin(a) * rand(30, 140), 0.4, rand(1.5, 3), this.mood.rim));
        }
        this.cb.onJump2?.();
      }
    }
    if (!input.down('jump') && b.vy < 0) b.vy += PHYS.gravity * 1.5 * dt;
    b.vy = Math.min(PHYS.maxFall, b.vy + PHYS.gravity * dt);

    this.pushCrates(dir, dt, solids);

    b.moveX(b.vx * dt, solids);
    b.moveY(b.vy * dt, solids);
    b.coyote = b.onGround ? 0.1 : Math.max(0, b.coyote - dt);

    if (!wasGround && b.onGround) {
      p.airJump = true;
      if (b.vy > 340) {
        p.land = 1;
        this.puff(b.cx, b.bottom, 6, this.mood.rim);
      }
    }

    b.x = clamp(b.x, 0, this.roomDef.w - b.w);
    if (b.y > 940) this.hurt(1, 0, true);

    // Thorn beds.
    for (const hz of this.roomDef.hazards) {
      if (!rectsOverlap(b.rect(), hz)) continue;
      if (this.adapt < 0.3) {
        if (b.vy > 0) b.vy = -PHYS.jump * 0.6;
      } else {
        this.hurt(1, b.cx < hz.x + hz.w / 2 ? -1 : 1);
      }
      break;
    }
  }

  /* ------------------------------------------------------------- casting */

  updateCasting(dt) {
    const p = this.player;
    const input = this.input;
    p.aimUp = input.down('up');

    if (input.down('cast') && !p.charging && p.castCd <= 0) {
      p.charging = true;
      p.chargeT = 0;
      this.cb.onChargeStart?.();
    }

    if (p.charging) {
      p.chargeT = Math.min(CHARGE.max, p.chargeT + dt);
      if (Math.random() < dt * (14 + p.chargeT * 30)) {
        const a = rand(0, TAU);
        const r = 18 + p.chargeT * 10;
        this.particles.push(this.particle(p.body.cx + Math.cos(a) * r, p.body.cy - 6 + Math.sin(a) * r, -Math.cos(a) * 60, -Math.sin(a) * 60, 0.4, rand(1.2, 2.6), this.tierColor()));
      }
    }

    if (!input.down('cast') && p.charging) {
      p.charging = false;
      const tier = p.chargeT < CHARGE.push ? 'push' : p.chargeT < CHARGE.beam ? 'beam' : 'bomb';
      this.cast(tier);
      p.chargeT = 0;
      p.castCd = 0.18;
    }
  }

  tierColor() {
    const t = this.player.chargeT;
    if (t < CHARGE.push) return '#ffe6a6';
    if (t < CHARGE.beam) return '#b6f0ff';
    return '#ffffff';
  }

  aimDir() {
    const p = this.player;
    if (p.aimUp) return { x: 0, y: -1 };
    return { x: p.facing, y: 0 };
  }

  cast(tier) {
    const p = this.player;
    const b = p.body;
    const dir = this.aimDir();
    const ox = b.cx + dir.x * 18;
    const oy = b.cy - 4 + dir.y * 18;

    if (tier === 'push') {
      this.orbs.push({ x: ox, y: oy, vx: dir.x * CAST.pushSpeed, vy: dir.y * CAST.pushSpeed, life: 0.85, r: 9, hit: new Set() });
      this.cb.onCast?.('push');
      this.shake = Math.max(this.shake, 0.16);
    } else if (tier === 'beam') {
      const hit = this.beamCast(ox, oy, dir);
      this.fx.push({ type: 'beam', x1: ox, y1: oy, x2: hit.x, y2: hit.y, life: 0.22, max: 0.22 });
      this.cb.onCast?.('beam');
      this.shake = Math.max(this.shake, 0.3);
      this.flash = Math.max(this.flash, 0.18);
    } else {
      this.bomb(ox, oy);
      this.cb.onCast?.('bomb');
      this.shake = Math.max(this.shake, 0.6);
      this.flash = Math.max(this.flash, 0.4);
      // Recoil: aim down while airborne to leap, otherwise a nudge backwards.
      if (this.input.down('down') && !b.onGround) {
        b.vy = -PHYS.jump * 0.92;
        p.airJump = true;
      } else {
        b.vx -= dir.x * 210;
      }
    }
  }

  /** Instant ray for the beam tier. Lights lamps, burns vines, kills midges. */
  beamCast(ox, oy, dir) {
    const st = this.state;
    const solids = this.solids();
    let best = CAST.beamRange;
    for (const s of solids) {
      const t = rayRect(ox, oy, dir.x, dir.y, s);
      if (t < best) best = t;
    }
    const end = { x: ox + dir.x * best, y: oy + dir.y * best };
    const seg = { x1: ox, y1: oy, x2: end.x, y2: end.y };

    for (const l of st.lamps) if (this.segNear(seg, l.x, l.y - 20, 26)) this.lightLamp(l);
    for (const v of st.vines) if (!v.burnt && this.segNear(seg, v.x + v.w / 2, v.y + v.h / 2, Math.max(v.w, v.h) / 2 + 8)) this.burnVine(v);
    for (const m of st.midges) if (!m.dead && this.segNear(seg, m.x, m.y, 26)) this.killMidge(m);
    for (const c of st.crates) {
      if (this.segNear(seg, c.body.cx, c.body.cy, 28)) {
        c.vx += dir.x * 320;
        c.vy -= 90;
        c.glow = 1;
      }
    }
    for (let i = 0; i < 14; i++) {
      const k = rand(0.15, 1);
      this.particles.push(this.particle(lerp(ox, end.x, k), lerp(oy, end.y, k), rand(-30, 30), rand(-30, 30), 0.3, rand(1.5, 3), '#cdf6ff'));
    }
    return end;
  }

  bomb(x, y) {
    const st = this.state;
    const R = CAST.bombRadius;
    this.fx.push({ type: 'bomb', x, y, r: 10, max: R, life: 0.5, maxLife: 0.5 });
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU);
      this.particles.push(this.particle(x, y, Math.cos(a) * rand(40, 300), Math.sin(a) * rand(40, 300), rand(0.3, 0.7), rand(1.5, 3.4), '#ffefc4', 260));
    }
    for (const l of st.lamps) if (dist(x, y, l.x, l.y - 20) < R) this.lightLamp(l);
    for (const v of st.vines) {
      if (v.burnt) continue;
      const nx = clamp(x, v.x, v.x + v.w);
      const ny = clamp(y, v.y, v.y + v.h);
      if (dist(x, y, nx, ny) < R) this.burnVine(v);
    }
    for (const m of st.midges) if (!m.dead && dist(x, y, m.x, m.y) < R + 12) this.killMidge(m);
    for (const c of st.crates) {
      const d = dist(x, y, c.body.cx, c.body.cy);
      if (d < R) {
        const a = Math.atan2(c.body.cy - y, c.body.cx - x);
        c.vx += Math.cos(a) * 420;
        c.vy -= 140;
        c.glow = 1;
      }
    }
  }

  segNear(seg, px, py, r) {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const len2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - seg.x1) * dx + (py - seg.y1) * dy) / len2, 0, 1);
    return dist(seg.x1 + dx * t, seg.y1 + dy * t, px, py) < r;
  }

  /* -------------------------------------------------------- room pieces */

  solids() {
    const out = this.roomDef.solids.slice();
    for (const g of this.state.gates) if (!g.open) out.push({ x: g.x, y: g.y, w: g.w, h: g.h });
    for (const v of this.state.vines) if (!v.burnt) out.push({ x: v.x, y: v.y, w: v.w, h: v.h });
    for (const c of this.state.crates) out.push({ x: c.body.x, y: c.body.y, w: c.body.w, h: c.body.h });
    return out;
  }

  pushCrates(dir, dt, solids) {
    const b = this.player.body;
    if (dir === 0) return;
    for (const c of this.state.crates) {
      const probe = { x: b.x + dir * 3, y: b.y, w: b.w, h: b.h };
      if (!rectsOverlap(probe, c.body)) continue;
      const push = dir * Math.min(Math.abs(b.vx) || 40, 90) * dt;
      const others = solids.filter((s) => s !== c.body && !(s.x === c.body.x && s.y === c.body.y && s.w === c.body.w));
      c.body.moveX(push, others);
      c.glow = Math.max(c.glow, 0.3);
      this.stuck = Math.min(this.stuck, 3);
    }
  }

  updateCrates(dt) {
    const st = this.state;
    const solids = this.roomDef.solids.concat(
      st.gates.filter((g) => !g.open).map((g) => ({ x: g.x, y: g.y, w: g.w, h: g.h })),
      st.vines.filter((v) => !v.burnt).map((v) => ({ x: v.x, y: v.y, w: v.w, h: v.h })),
    );
    for (const c of st.crates) {
      const body = c.body;
      c.glow = Math.max(0, c.glow - dt * 2);
      c.vy = Math.min(900, c.vy + PHYS.gravity * dt);
      body.vx = c.vx;
      body.moveX(c.vx * dt, solids.concat(st.crates.filter((o) => o !== c).map((o) => o.body)));
      c.vx = body.vx;
      body.moveY(c.vy * dt, solids);
      c.vy = body.vy;
      if (body.onGround) c.vx *= Math.pow(0.02, dt);
      else c.vx *= Math.pow(0.7, dt);
      body.x = clamp(body.x, 40, this.roomDef.w - 40 - body.w);
    }
  }

  updateGates(dt) {
    const st = this.state;
    for (const g of st.gates) {
      let solved = false;
      if (g.key === 'lamps') solved = st.lamps.length > 0 && st.lamps.every((l) => l.lit);
      else if (g.key === 'beam') solved = st.beamHit;
      else solved = st.plates.length > 0 && st.plates.every((p) => p.pressed);

      if (solved && !g.open) {
        g.open = true;
        g.anim = 1;
        this.flash = Math.max(this.flash, 0.3);
        this.shake = Math.max(this.shake, 0.4);
        this.burst(g.x + g.w / 2, g.y + g.h / 2, 26, this.mood.rim, 220);
        this.cb.onGate?.();
        this.adapt = Math.min(1, this.adapt + 0.07);
        this.stuck = 0;
        this.whisper('Glim: Där. Vägen öppnar sig.');
      }
      if (!solved && g.open && g.key === 'echo') {
        // Echo plates can release again, but solved gates stay open for the rest.
      }
      g.anim = Math.max(0, g.anim - dt);
    }
  }

  updatePlates(dt) {
    const st = this.state;
    const p = this.player.body;
    for (const plate of st.plates) {
      const rect = { x: plate.x, y: plate.y, w: plate.w, h: 12 };
      const byCrate = st.crates.some((c) => rectsOverlap(rect, c.body));
      const byPlayer = rectsOverlap(rect, p.rect());
      const byEcho = !!(st.echo && st.echo.playing && st.echo.pos && rectsOverlap(rect, { x: st.echo.pos.x - 12, y: st.echo.pos.y - 44, w: 24, h: 44 }));
      const pressed = byCrate || byPlayer || byEcho;
      if (pressed && !plate.pressed) this.burst(plate.x + plate.w / 2, plate.y, 8, this.mood.accent, 90);
      plate.pressed = pressed;
      plate.anim = clamp(plate.anim + (pressed ? dt * 6 : -dt * 6), 0, 1);
    }
  }

  updateBeam() {
    const st = this.state;
    if (!this.roomDef.emitters.length) return;
    const solids = this.roomDef.solids;
    const path = [];
    let hit = false;

    for (const em of this.roomDef.emitters) {
      let px = em.x;
      let py = em.y;
      let dx = Math.cos(em.angle);
      let dy = Math.sin(em.angle);
      let skip = null;
      const points = [{ x: px, y: py }];
      for (let bounce = 0; bounce < 8; bounce++) {
        let bestT = 3000;
        let what = null;
        for (const s of solids) {
          const t = rayRect(px, py, dx, dy, s);
          if (t < bestT) {
            bestT = t;
            what = { type: 'solid' };
          }
        }
        for (const m of st.mirrors) {
          if (m === skip) continue;
          const cd = { x: m.x - 15, y: m.y - 15, w: 30, h: 30 };
          const t = rayRect(px, py, dx, dy, cd);
          if (t < bestT) {
            bestT = t;
            what = { type: 'mirror', m };
          }
        }
        for (const t2 of this.roomDef.targets) {
          const t = rayRect(px, py, dx, dy, t2);
          if (t < bestT) {
            bestT = t;
            what = { type: 'target' };
          }
        }
        if (!what || bestT > 2999) break;
        px += dx * bestT;
        py += dy * bestT;
        points.push({ x: px, y: py });
        if (what.type === 'target') {
          hit = true;
          break;
        }
        if (what.type === 'solid') break;
        // Snap to the mirror centre so the new segment runs cleanly.
        px = what.m.x;
        py = what.m.y;
        points[points.length - 1] = { x: px, y: py };
        const r = reflect(dx, dy, what.m.angle);
        dx = r.x;
        dy = r.y;
        what.m.glow = 1;
        skip = what.m;
        px += dx * 6;
        py += dy * 6;
        points.push({ x: px, y: py });
      }
      path.push(points);
    }
    this.beamPath = path;
    if (hit !== st.beamHit) {
      st.beamHit = hit;
      if (hit) this.stuck = 0;
    }
  }

  /* --------------------------------------------------------------- echo */

  updateEcho(dt) {
    const st = this.state;
    const e = st.echo;
    if (!e) return;
    const p = this.player;

    if (e.recording) {
      e.t += dt;
      e.frames.push({ x: p.body.cx, y: p.body.bottom, facing: p.facing });
      if (e.t >= e.duration) {
        e.recording = false;
        e.playing = e.frames.length > 2;
        e.playT = 0;
        this.whisper('Glim: Ekot minns dig nu.');
        this.cb.onEcho?.('play');
      }
    }

    if (e.playing && e.frames.length) {
      e.playT += dt;
      const total = e.duration;
      const at = e.playT % total;
      const idx = clamp(Math.floor((at / total) * e.frames.length), 0, e.frames.length - 1);
      e.pos = e.frames[idx];
    }
  }

  startEchoRecording() {
    const e = this.state.echo;
    e.recording = true;
    e.playing = false;
    e.t = 0;
    e.frames = [];
    e.pos = null;
    this.whisper('Glim: Gå. Jag minns vart du går.');
    this.cb.onEcho?.('record');
  }

  /* -------------------------------------------------------------- midges */

  updateMidges(dt) {
    const st = this.state;
    const p = this.player.body;
    const speed = 46 + this.adapt * 52;
    for (const m of st.midges) {
      if (m.dead) continue;
      m.t += dt;
      const d = dist(m.x, m.y, p.cx, p.cy);
      if (d < 430) m.alert = true;
      if (m.alert && d > 34) {
        const a = Math.atan2(p.cy - m.y, p.cx - m.x);
        m.x += Math.cos(a) * speed * dt;
        m.y += Math.sin(a) * speed * dt;
        m.x += Math.cos(m.t * 2.2 + m.phase) * 22 * dt;
        m.y += Math.sin(m.t * 2.6 + m.phase) * 26 * dt;
      } else if (!m.alert) {
        m.x = lerp(m.x, m.hx + Math.cos(m.t * 0.8 + m.phase) * 60, dt);
        m.y = lerp(m.y, m.hy + Math.sin(m.t * 1.1 + m.phase) * 40, dt);
      }
      if (this.mode === 'play' && p.invuln <= 0 && rectsOverlap(p.rect(), { x: m.x - 14, y: m.y - 14, w: 28, h: 28 })) {
        this.hurt(1, sign(p.cx - m.x));
        m.alert = false;
        m.x = m.hx;
        m.y = m.hy;
      }
    }
  }

  killMidge(m) {
    m.dead = true;
    this.burst(m.x, m.y, 12, '#cfe6ff', 150);
    this.cb.onMidgeDeath?.();
  }

  /* --------------------------------------------------------------- orbs */

  updateOrbs(dt) {
    const st = this.state;
    for (const o of this.orbs) {
      o.life -= dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (Math.random() < 0.7) this.particles.push(this.particle(o.x, o.y, rand(-20, 20), rand(-20, 20), 0.28, rand(1.4, 2.6), '#fff0c8'));

      for (const l of st.lamps) {
        if (dist(o.x, o.y, l.x, l.y - 20) < 26) {
          this.lightLamp(l);
          o.life = 0;
        }
      }
      for (const m of st.midges) {
        if (!m.dead && dist(o.x, o.y, m.x, m.y) < 24) {
          this.killMidge(m);
          o.life = 0;
        }
      }
      for (const c of st.crates) {
        if (rectsOverlap({ x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 }, c.body)) {
          c.vx += sign(o.vx) * 300;
          c.vy -= 80;
          c.glow = 1;
          o.life = 0;
          this.burst(o.x, o.y, 10, '#ffe9b0', 130);
        }
      }
      for (const s of this.solids()) {
        if (o.x > s.x && o.x < s.x + s.w && o.y > s.y && o.y < s.y + s.h) {
          o.life = 0;
          this.burst(o.x, o.y, 6, '#ffe9b0', 90);
          break;
        }
      }
      if (o.x < 0 || o.x > this.roomDef.w || o.y < 0 || o.y > 940) o.life = 0;
    }
    this.orbs = this.orbs.filter((o) => o.life > 0);
  }

  /* ------------------------------------------------------------ pickups */

  lightLamp(lamp) {
    if (lamp.lit) return;
    lamp.lit = true;
    this.burst(lamp.x, lamp.y - 20, 18, '#ffe6a6', 160);
    this.cb.onLamp?.();
    this.stuck = 0;
    const lit = this.state.lamps.filter((l) => l.lit).length;
    if (this.state.lamps.length > 1) {
      this.whisper(`Glim: ${lit} av ${this.state.lamps.length} eldar.`);
    }
  }

  burnVine(vine) {
    if (vine.burnt) return;
    vine.burnt = true;
    this.burst(vine.x + vine.w / 2, vine.y + vine.h / 2, 22, '#ffd08a', 190);
    this.cb.onBurn?.();
    this.stuck = 0;
  }

  checkPickups() {
    const st = this.state;
    const p = this.player.body;

    if (st.shard && !st.shard.taken && dist(p.cx, p.cy, st.shard.x, st.shard.y - 20) < 46) {
      st.shard.taken = true;
      const memory = MEMORIES[this.shards.length] || MEMORIES[MEMORIES.length - 1];
      this.shards.push(memory);
      this.burst(st.shard.x, st.shard.y - 20, 40, '#fff2c8', 240);
      this.flash = 0.6;
      this.shake = 0.5;
      this.cb.onShard?.(memory, this.shards.length);
      this.stuck = 0;
    }

    if (this.roomDef.mirror && dist(p.cx, p.cy, this.roomDef.mirror.x, this.roomDef.mirror.y - 40) < 90) {
      if (this.mode === 'play') {
        this.mode = 'end';
        this.cb.onEnd?.({ shards: this.shards.length, deaths: this.deaths, time: this.time });
      }
    }
  }

  checkExits() {
    if (this.exitLock > 0) return;
    const p = this.player.body;
    for (const ex of this.roomDef.exits) {
      if (!rectsOverlap(p.rect(), ex)) continue;
      this.loadRoom(ex.to, ex.spawn);
      this.cb.onTransition?.(ex.to);
      return;
    }
  }

  interact() {
    if (this.mode !== 'play') return;
    const it = this.interactable();
    if (!it) return;
    if (it.type === 'mirror') {
      it.obj.angle = (it.obj.angle + it.obj.step) % TAU;
      it.obj.glow = 1;
      this.cb.onMirror?.();
      this.stuck = 0;
    } else if (it.type === 'echo') {
      if (it.obj.recording) {
        it.obj.recording = false;
        it.obj.playing = it.obj.frames.length > 2;
        it.obj.playT = 0;
        this.cb.onEcho?.('play');
      } else {
        this.startEchoRecording();
      }
    } else if (it.type === 'hearth') {
      this.player.hp = this.player.maxHp;
      this.mode = 'rest';
      this.cb.onRest?.();
    } else if (it.type === 'altar') {
      if (this.shards.length >= 3) {
        this.loadRoom('hollow', ROOMS.hollow.spawn);
        this.cb.onTransition?.('hollow');
      } else {
        this.cb.onAltarLocked?.(3 - this.shards.length);
      }
    }
  }

  resume() {
    if (this.mode === 'rest' || this.mode === 'memory') this.mode = 'play';
  }

  /* ------------------------------------------------------------- damage */

  hurt(amount, dirX = 0, fell = false) {
    if (this.mode !== 'play' || this.player.invuln > 0) return;
    const p = this.player;
    p.hp = Math.max(0, p.hp - amount);
    p.invuln = 1.1;
    p.body.vx = dirX * 240;
    if (!fell) p.body.vy = -320;
    this.shake = Math.max(this.shake, 0.7);
    this.flash = Math.max(this.flash, 0.6);
    this.burst(p.body.cx, p.body.cy, 16, '#ffb0c8', 200);
    this.cb.onHurt?.();
    if (p.hp <= 0) this.die();
  }

  die() {
    this.mode = 'dead';
    this.deaths += 1;
    this.adapt = Math.max(0, this.adapt - 0.16);
    this.burst(this.player.body.cx, this.player.body.cy, 34, '#ffe9c0', 260);
    this.shake = 1.1;
    this.cb.onDeath?.({ deaths: this.deaths, adapt: this.adapt });
  }

  respawn() {
    this.player.hp = this.player.maxHp;
    this.player.invuln = 1.2;
    for (const id of Object.keys(this.world)) {
      for (const m of this.world[id].midges) {
        m.dead = false;
        m.x = m.hx;
        m.y = m.hy;
        m.alert = false;
      }
    }
    this.mode = 'play';
    this.loadRoom('hub', ROOMS.hub.spawn);
    this.mode = 'play';
  }

  /* ------------------------------------------------------------- camera */

  updateCamera(dt) {
    const b = this.player.body;
    const targetX = clamp(b.cx + b.vx * 0.25 - this.viewW / 2, 0, Math.max(0, this.roomDef.w - this.viewW));
    const targetY = clamp(b.cy - this.viewH * 0.56 + clamp(b.vy * 0.08, -40, 80), 0, Math.max(0, 900 - this.viewH));
    const k = Math.min(1, dt * 5.2);
    this.cam.x = lerp(this.cam.x, targetX, k);
    this.cam.y = lerp(this.cam.y, targetY, k);
  }

  /* -------------------------------------------------------------- hints */

  whisper(text) {
    if (this.whisperCooldown > 0) return;
    this.whisperCooldown = 1.4;
    this.whispers.push(text);
    if (this.whispers.length > 4) this.whispers.shift();
    this.cb.onWhisper?.(text);
  }

  updateHints(dt) {
    const delay = 7 + (1 - this.adapt) * 16;
    const hints = this.roomDef.hints || [];
    if (!hints.length) return;
    if (this.stuck > delay) {
      this.stuck = 0;
      this.hintIndex = (this.hintIndex + 1) % hints.length;
      this.whisper(hints[this.hintIndex]);
    }
  }

  /* ----------------------------------------------------------------- fx */

  particle(x, y, vx, vy, life, size, color, gravity = 0) {
    return { x, y, vx, vy, life, max: life, size, color, gravity };
  }

  burst(x, y, n, color, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = rand(speed * 0.25, speed);
      this.particles.push(this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.8), rand(1.4, 3.2), color, 320));
    }
  }

  puff(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-1.2, 1.2);
      this.particles.push(this.particle(x + rand(-8, 8), y, Math.cos(a) * rand(30, 110), Math.sin(a) * rand(20, 80), rand(0.2, 0.45), rand(1.4, 2.8), color, 240));
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.1, dt);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 800) this.particles.splice(0, this.particles.length - 800);
    for (const f of this.fx) f.life -= dt;
    this.fx = this.fx.filter((f) => f.life > 0);
  }

  /* ================================================================ draw */

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const shake = this.shake * this.shake * 9;
    const camX = Math.round(this.cam.x + rand(-shake, shake));
    const camY = Math.round(this.cam.y + rand(-shake, shake));
    const z = this.zoom;

    this.drawBackdrop(ctx, camX * z, camY * z);

    ctx.save();
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, -camX * z * this.dpr, -camY * z * this.dpr);
    this.drawSolids(ctx, camX, camY);
    this.drawDecor(ctx);
    this.drawObjects(ctx);
    this.drawCrates(ctx);
    this.drawEcho(ctx);
    this.drawMidges(ctx);
    this.drawPlayer(ctx);
    this.drawOrbs(ctx);
    this.drawFx(ctx);
    this.drawParticles(ctx);
    this.drawBeamLight(ctx);
    ctx.restore();

    this.drawLighting(ctx, camX, camY, z);
    this.drawGlowPass(ctx, camX, camY, z);
    this.drawOverlay(ctx);
  }

  /* ---------------------------------------------------------- background */

  drawBackdrop(ctx, camX, camY) {
    const m = this.mood;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, m.sky);
    g.addColorStop(0.6, m.deep);
    g.addColorStop(1, '#04070b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // Pale band of the never-setting dusk.
    const band = ctx.createRadialGradient(this.w * 0.72, this.h * 0.12, 10, this.w * 0.72, this.h * 0.12, this.w * 0.7);
    band.addColorStop(0, this.alpha(m.rim, 0.1));
    band.addColorStop(1, this.alpha(m.rim, 0));
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, this.w, this.h);

    // Three layers of trees.
    const layers = [
      { k: 0.14, step: 260, w: 150, col: this.alpha(m.rock, 0.55), y: 0.34 },
      { k: 0.26, step: 210, w: 120, col: this.alpha(m.rock, 0.75), y: 0.44 },
      { k: 0.4, step: 170, w: 96, col: this.alpha('#050b10', 0.72), y: 0.54 },
    ];
    for (const layer of layers) {
      const shift = camX * layer.k;
      const baseY = this.h * layer.y - camY * layer.k;
      ctx.fillStyle = layer.col;
      for (let i = 0; i < 30; i++) {
        const wx = i * layer.step + ((i * 137) % 90);
        const sx = wx - shift;
        if (sx < -layer.w * 2 || sx > this.w + layer.w * 2) continue;
        const tall = 220 + ((i * 71) % 180);
        const trunkW = layer.w * 0.16;
        // trunk
        ctx.fillRect(sx - trunkW / 2, baseY - tall * 0.2, trunkW, this.h);
        // canopy: stack of lobes
        for (let j = 0; j < 4; j++) {
          const cw = layer.w * (1 - j * 0.16);
          const cy = baseY - tall * (0.1 + j * 0.22);
          ctx.beginPath();
          ctx.ellipse(sx, cy, cw * 0.6, cw * 0.34, 0, 0, TAU);
          ctx.fill();
        }
      }
    }

    // Drifting mist.
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const y = this.h * (0.45 + i * 0.1);
      const x = ((this.time * (8 + i * 5) + i * 260) % (this.w + 700)) - 350;
      const mg = ctx.createRadialGradient(x, y, 10, x, y, 340);
      mg.addColorStop(0, this.alpha(m.rim, 0.045));
      mg.addColorStop(1, this.alpha(m.rim, 0));
      ctx.fillStyle = mg;
      ctx.fillRect(x - 340, y - 160, 680, 320);
    }
    ctx.restore();
  }

  alpha(hex, a) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  visible(x, y, w, h, camX, camY, pad = 120) {
    return x + w > camX - pad && x < camX + this.viewW + pad && y + h > camY - pad && y < camY + this.viewH + pad;
  }

  /* -------------------------------------------------------------- terrain */

  drawSolids(ctx, camX, camY) {
    const m = this.mood;
    for (const s of this.roomDef.solids) {
      if (!this.visible(s.x, s.y, s.w, s.h, camX, camY)) continue;
      const isFloor = s.h > 60 || s.y + s.h >= 880;
      const g = ctx.createLinearGradient(0, s.y, 0, s.y + Math.min(s.h, 200));
      g.addColorStop(0, m.rock);
      g.addColorStop(1, this.alpha('#050a0f', 0.96));
      ctx.fillStyle = g;
      ctx.fillRect(s.x, s.y, s.w, s.h);

      // Mossy top with a soft rim light.
      if (s.h <= 30 || isFloor) {
        ctx.fillStyle = this.alpha(m.moss, 0.9);
        ctx.fillRect(s.x, s.y, s.w, 5);
        ctx.fillStyle = this.alpha(m.rim, 0.35);
        ctx.fillRect(s.x, s.y, s.w, 1.6);
        // moss tufts
        ctx.fillStyle = this.alpha(m.moss, 0.55);
        for (let x = s.x + 10; x < s.x + s.w - 6; x += 24 + ((x * 13) % 19)) {
          const hgt = 3 + ((x * 7) % 8);
          ctx.fillRect(x, s.y - hgt, 3 + ((x * 3) % 5), hgt);
        }
      }

      if (isFloor) {
        // roots hanging into the soil
        ctx.strokeStyle = this.alpha(m.moss, 0.25);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = s.x + 30; x < s.x + s.w; x += 90 + ((x * 7) % 60)) {
          const len = 20 + ((x * 11) % 70);
          ctx.moveTo(x, s.y + 6);
          ctx.quadraticCurveTo(x + 12, s.y + len * 0.6, x + Math.sin(x) * 10, s.y + len);
        }
        ctx.stroke();
      } else if (s.h > 30 && s.w <= 70) {
        // Vertical wall: a soft edge on the side that faces the room.
        const inner = s.x <= 60 ? s.x + s.w : s.x;
        const grad2 = ctx.createLinearGradient(inner - 20, 0, inner + 20, 0);
        grad2.addColorStop(0, this.alpha(m.rim, 0.16));
        grad2.addColorStop(1, this.alpha(m.rim, 0));
        ctx.fillStyle = grad2;
        ctx.fillRect(inner - 20, s.y, 40, s.h);
        ctx.strokeStyle = this.alpha(m.rim, 0.18);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(inner, s.y);
        ctx.lineTo(inner, s.y + s.h);
        ctx.stroke();
      } else if (s.h > 30) {
        // ceiling stalactites / hanging roots
        ctx.strokeStyle = this.alpha(m.moss, 0.3);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = s.x + 26; x < s.x + s.w; x += 60 + ((x * 17) % 40)) {
          const len = 14 + ((x * 13) % 44);
          ctx.moveTo(x, s.y + s.h);
          ctx.lineTo(x + 4, s.y + s.h + len);
        }
        ctx.stroke();
      }
    }
  }

  drawDecor(ctx) {
    const m = this.mood;
    // Glowing mushrooms and grass tufts, deterministic per room.
    const seed = this.roomId.length * 977 + this.roomDef.w;
    const layers = this.roomDef.solids.filter((s) => s.h <= 30 || s.y + s.h >= 880);
    for (const s of layers) {
      for (let i = 0; i < 8; i++) {
        const x = s.x + ((i * 173 + seed) % Math.max(1, s.w - 20)) + 10;
        const kind = (i + seed) % 3;
        if (kind === 0) {
          // mushroom
          ctx.fillStyle = this.alpha(m.rim, 0.5);
          ctx.beginPath();
          ctx.ellipse(x, s.y - 6, 6, 4, 0, Math.PI, TAU);
          ctx.fill();
          ctx.fillRect(x - 1, s.y - 6, 2, 6);
        } else if (kind === 1) {
          // grass
          ctx.strokeStyle = this.alpha(m.moss, 0.6);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let k = 0; k < 4; k++) {
            ctx.moveTo(x + k * 3, s.y);
            ctx.quadraticCurveTo(x + k * 3 + 4, s.y - 8, x + k * 3 + Math.sin(this.time + k) * 3, s.y - 14 - k);
          }
          ctx.stroke();
        } else {
          // pebbles
          ctx.fillStyle = this.alpha('#0a141c', 0.8);
          ctx.beginPath();
          ctx.ellipse(x, s.y - 2, 7, 3, 0, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  /* ------------------------------------------------------------- objects */

  drawObjects(ctx) {
    const st = this.state;
    const m = this.mood;

    // Braziers / hearth lanterns.
    for (const l of st.lamps) this.drawLamp(ctx, l);

    // Vines.
    for (const v of st.vines) {
      if (v.burnt) continue;
      const sway = Math.sin(this.time * 1.6 + v.x) * 4;
      ctx.strokeStyle = this.alpha('#2f6b52', 0.95);
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const x = v.x + 4 + i * (v.w / 4);
        ctx.beginPath();
        ctx.moveTo(x, v.y);
        ctx.bezierCurveTo(x + sway, v.y + v.h * 0.3, x - sway, v.y + v.h * 0.7, x + sway * 0.6, v.y + v.h);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      // thorns
      ctx.fillStyle = this.alpha('#8fdcb4', 0.8);
      for (let i = 0; i < 7; i++) {
        const y = v.y + 10 + i * (v.h / 7);
        const side = i % 2 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(v.x + v.w / 2, y);
        ctx.lineTo(v.x + v.w / 2 + side * 12, y - 5);
        ctx.lineTo(v.x + v.w / 2 + side * 4, y + 3);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Gates: thorn curtains with runes.
    for (const g of st.gates) {
      if (g.open) continue;
      const pulse = 0.5 + 0.2 * Math.sin(this.time * 2 + g.x);
      ctx.strokeStyle = this.alpha(m.rim, 0.75);
      ctx.lineWidth = 3;
      for (let i = 0; i < 5; i++) {
        const x = g.x + 3 + i * (g.w / 5);
        ctx.beginPath();
        ctx.moveTo(x, g.y);
        ctx.bezierCurveTo(x + 8, g.y + g.h * 0.4, x - 8, g.y + g.h * 0.6, x, g.y + g.h);
        ctx.stroke();
      }
      ctx.strokeStyle = this.alpha(m.accent, pulse);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(g.x - 3, g.y, g.w + 6, g.h);
      ctx.fillStyle = this.alpha(m.accent, pulse * 0.8);
      ctx.beginPath();
      ctx.arc(g.x + g.w / 2, g.y + 18, 4, 0, TAU);
      ctx.fill();
    }

    // Mirrors.
    for (const mir of st.mirrors) {
      const glow = mir.glow || 0;
      ctx.save();
      ctx.translate(mir.x, mir.y);
      ctx.rotate(mir.angle);
      ctx.strokeStyle = this.alpha('#dfe6ff', 0.85 + glow * 0.15);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(18, 0);
      ctx.stroke();
      ctx.strokeStyle = this.alpha(m.rim, 0.5);
      ctx.lineWidth = 10;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(18, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
      // stand
      ctx.strokeStyle = this.alpha('#1a2a33', 0.95);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(mir.x, mir.y + 6);
      ctx.lineTo(mir.x, mir.y + 34);
      ctx.stroke();
      mir.glow = Math.max(0, (mir.glow || 0) - 0.02);
    }

    // Emitters.
    for (const em of this.roomDef.emitters) {
      ctx.fillStyle = this.alpha('#0d1a22', 0.95);
      ctx.beginPath();
      ctx.arc(em.x, em.y, 14, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = this.alpha(m.rim, 0.9);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#eaffff';
      ctx.beginPath();
      ctx.arc(em.x, em.y, 6, 0, TAU);
      ctx.fill();
    }

    // Targets (receptacles).
    for (const t of this.roomDef.targets) {
      const hit = st.beamHit;
      ctx.strokeStyle = this.alpha(hit ? '#fff2c8' : m.rim, hit ? 1 : 0.5);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(t.x, t.y, t.w, t.h, 8);
      ctx.stroke();
      if (hit) {
        ctx.fillStyle = 'rgba(255, 242, 200, 0.22)';
        ctx.fill();
      }
    }

    // Plates.
    for (const p of st.plates) {
      const lift = p.anim * 3;
      ctx.fillStyle = this.alpha('#0d1a20', 0.95);
      ctx.fillRect(p.x, p.y - lift, p.w, 9);
      ctx.fillStyle = this.alpha(p.pressed ? '#ffe6a6' : m.rim, p.pressed ? 0.8 : 0.25);
      ctx.fillRect(p.x + 3, p.y - lift + 1, p.w - 6, 2.4);
      ctx.strokeStyle = this.alpha(m.rim, 0.4);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x, p.y - lift, p.w, 9);
    }

    // Echo crystal.
    if (st.echo) {
      const e = st.echo;
      const bob = Math.sin(this.time * 2) * 3;
      ctx.save();
      ctx.translate(e.x, e.y - 34 + bob);
      ctx.rotate(Math.sin(this.time * 0.6) * 0.2);
      ctx.fillStyle = this.alpha(e.recording ? '#ffd6a0' : '#bfe9ff', 0.9);
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(11, 0);
      ctx.lineTo(0, 22);
      ctx.lineTo(-11, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = this.alpha('#0c161c', 0.95);
      ctx.fillRect(e.x - 16, e.y - 8, 32, 10);
    }

    // Altar with three sockets.
    if (this.roomDef.altar) {
      const a = this.roomDef.altar;
      ctx.fillStyle = this.alpha('#101c22', 0.98);
      ctx.beginPath();
      ctx.roundRect(a.x, a.y, a.w, a.h, 6);
      ctx.fill();
      ctx.strokeStyle = this.alpha(m.rim, 0.5);
      ctx.lineWidth = 2;
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const cx = a.x + 26 + i * 29;
        const filled = i < this.shards.length;
        ctx.beginPath();
        ctx.moveTo(cx, a.y + 22);
        ctx.lineTo(cx + 9, a.y + 38);
        ctx.lineTo(cx, a.y + 54);
        ctx.lineTo(cx - 9, a.y + 38);
        ctx.closePath();
        ctx.fillStyle = filled ? '#fff0c0' : 'rgba(120, 180, 200, 0.16)';
        ctx.fill();
        ctx.strokeStyle = this.alpha(m.rim, filled ? 0.9 : 0.35);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    // Memory shard: a small eight-rayed star of light.
    if (st.shard && !st.shard.taken) {
      const sh = st.shard;
      const bob = Math.sin(sh.t * 2.2) * 5;
      const x = sh.x;
      const y = sh.y - 34 + bob;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(sh.t * 0.4);
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU - Math.PI / 2;
        const r = i % 2 === 0 ? 20 : 7;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const sg = ctx.createRadialGradient(x, y, 2, x, y, 70);
      sg.addColorStop(0, 'rgba(255, 244, 210, 0.55)');
      sg.addColorStop(1, 'rgba(255, 230, 170, 0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(x, y, 70, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // The hollow room's mirror.
    if (this.roomDef.mirror) {
      const mr = this.roomDef.mirror;
      ctx.save();
      ctx.translate(mr.x, mr.y);
      ctx.strokeStyle = this.alpha('#f3e8ff', 0.85);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, -60, 46, 78, 0, 0, TAU);
      ctx.stroke();
      const mg = ctx.createRadialGradient(0, -60, 4, 0, -60, 90);
      mg.addColorStop(0, 'rgba(255, 250, 235, 0.30)');
      mg.addColorStop(1, 'rgba(255, 250, 235, 0)');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.ellipse(0, -60, 46, 78, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = this.alpha('#1a2430', 0.95);
      ctx.fillRect(-16, 14, 32, 20);
      ctx.restore();
    }
  }

  drawLamp(ctx, l) {
    const m = this.mood;
    const lit = l.lit;
    const flicker = 0.9 + Math.sin(this.time * 8 + l.x) * 0.06;
    const cy = l.y - 26;
    if (l.hearth) {
      // Lantern post of the hub.
      ctx.strokeStyle = this.alpha('#16242c', 1);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(l.x, l.y - 74);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(l.x, l.y - 74);
      ctx.quadraticCurveTo(l.x + 20, l.y - 84, l.x + 26, l.y - 60);
      ctx.stroke();
      ctx.fillStyle = this.alpha('#0d181e', 1);
      ctx.fillRect(l.x + 16, l.y - 62, 22, 26);
      ctx.fillStyle = lit ? '#ffd79a' : 'rgba(90, 120, 130, 0.35)';
      ctx.fillRect(l.x + 19, l.y - 59, 16, 19);
    } else {
      // Brazier.
      ctx.fillStyle = this.alpha('#122026', 1);
      ctx.beginPath();
      ctx.moveTo(l.x - 14, l.y);
      ctx.lineTo(l.x - 8, l.y - 22);
      ctx.lineTo(l.x + 8, l.y - 22);
      ctx.lineTo(l.x + 14, l.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = this.alpha(m.rim, 0.4);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (lit) {
        for (let i = 0; i < 3; i++) {
          const h = 16 + Math.sin(this.time * 9 + i * 2) * 4;
          ctx.fillStyle = i === 1 ? '#fff6d0' : '#ffbe6a';
          ctx.beginPath();
          ctx.ellipse(l.x + (i - 1) * 5, l.y - 26 - h * 0.3, 6 - i, h * 0.5, 0, 0, TAU);
          ctx.fill();
        }
      }
    }
    if (lit) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(l.x, cy, 4, l.x, cy, 90 * flicker);
      g.addColorStop(0, 'rgba(255, 226, 160, 0.35)');
      g.addColorStop(1, 'rgba(255, 200, 120, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(l.x, cy, 90 * flicker, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawCrates(ctx) {
    for (const c of this.state.crates) {
      const b = c.body;
      const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      g.addColorStop(0, '#3e5560');
      g.addColorStop(1, '#18262d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 7);
      ctx.fill();
      ctx.strokeStyle = this.alpha(this.mood.rim, 0.6 + c.glow * 0.4);
      ctx.lineWidth = 2;
      ctx.stroke();
      // glowing rune
      ctx.strokeStyle = `rgba(255, 240, 200, ${0.5 + c.glow * 0.5})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(b.cx, b.cy - 9);
      ctx.lineTo(b.cx + 9, b.cy);
      ctx.lineTo(b.cx, b.cy + 9);
      ctx.lineTo(b.cx - 9, b.cy);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.x + 5, b.y + 15);
      ctx.lineTo(b.x + b.w - 5, b.y + 15);
      ctx.moveTo(b.x + 5, b.y + b.h - 15);
      ctx.lineTo(b.x + b.w - 5, b.y + b.h - 15);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(b.cx, b.bottom + 3, b.w * 0.42, 4, 0, 0, TAU);
      ctx.fill();
    }
  }

  drawMidges(ctx) {
    for (const m of this.state.midges) {
      if (m.dead) continue;
      const bob = Math.sin(m.t * 7) * 3;
      ctx.save();
      ctx.translate(m.x, m.y + bob);
      ctx.fillStyle = 'rgba(10, 14, 20, 0.9)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 8, 0, 0, TAU);
      ctx.fill();
      // wings
      const flap = Math.sin(m.t * 22) * 0.5;
      ctx.fillStyle = 'rgba(170, 210, 235, 0.25)';
      ctx.beginPath();
      ctx.ellipse(-7, -4, 9, 4, -0.5 + flap, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(7, -4, 9, 4, 0.5 - flap, 0, TAU);
      ctx.fill();
      // eyes
      ctx.fillStyle = m.alert ? '#ffd0a0' : '#9fe8ff';
      ctx.beginPath();
      ctx.arc(-4, -1, 1.8, 0, TAU);
      ctx.arc(4, -1, 1.8, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawEcho(ctx) {
    const e = this.state.echo;
    if (!e || !e.playing || !e.pos) return;
    const { x, y } = e.pos;
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#bfe9ff';
    ctx.beginPath();
    ctx.ellipse(x, y - 22, 12, 20, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - 42, 9, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.ellipse(x, y - 22, 18, 26, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* --------------------------------------------------------------- player */

  drawPlayer(ctx) {
    const p = this.player;
    const b = p.body;
    const f = p.facing;
    const walking = b.onGround && Math.abs(b.vx) > 30;
    const bob = walking ? Math.sin(p.anim * 12) * 1.6 : Math.sin(p.anim * 2.2) * 0.8;

    ctx.save();
    ctx.translate(b.cx, b.bottom);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 15, 5, 0, 0, TAU);
    ctx.fill();

    if (p.invuln > 0 && Math.floor(p.anim * 20) % 2 === 0) ctx.globalAlpha = 0.45;

    const squash = p.land * 0.1;
    ctx.scale(f * (1 + squash * 0.4), 1 - squash);

    // cloak
    ctx.beginPath();
    ctx.moveTo(-1, -46);
    ctx.quadraticCurveTo(-17, -28, -16, -1);
    ctx.quadraticCurveTo(-4, 4, 0, 2);
    ctx.quadraticCurveTo(8, 4, 15, -2);
    ctx.quadraticCurveTo(16, -28, 2, -46);
    ctx.closePath();
    const cg = ctx.createLinearGradient(0, -46, 0, 2);
    cg.addColorStop(0, '#1b2a34');
    cg.addColorStop(0.55, '#101a22');
    cg.addColorStop(1, '#22333d');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = this.alpha(this.mood.rim, 0.32);
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // feet
    ctx.strokeStyle = '#0a1218';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    const swing = walking ? Math.sin(p.anim * 12) * 4 : 0;
    ctx.beginPath();
    ctx.moveTo(-4, -12);
    ctx.lineTo(-5 + swing, 1);
    ctx.moveTo(4, -12);
    ctx.lineTo(5 - swing, 1);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // head + wide hat
    ctx.save();
    ctx.translate(0, -46 + bob);
    ctx.beginPath();
    ctx.ellipse(0, -6, 9, 10, 0, 0, TAU);
    ctx.fillStyle = '#e9f6ff';
    ctx.fill();
    ctx.fillStyle = '#0a1620';
    ctx.beginPath();
    ctx.ellipse(-3.4, -6, 1.7, 2.6, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(3.4, -6, 1.7, 2.6, 0, 0, TAU);
    ctx.fill();
    // hat brim
    ctx.beginPath();
    ctx.ellipse(0, -12, 15, 4.4, -0.06, 0, TAU);
    ctx.fillStyle = '#16222c';
    ctx.fill();
    ctx.strokeStyle = this.alpha(this.mood.rim, 0.4);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-7, -13);
    ctx.quadraticCurveTo(-4, -26, 3, -25);
    ctx.quadraticCurveTo(6, -18, 7, -13);
    ctx.closePath();
    ctx.fillStyle = '#16222c';
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // staff + lantern in the leading hand
    const staffX = 12;
    ctx.strokeStyle = '#2b3d46';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(staffX - 3, -34);
    ctx.lineTo(staffX + 4, 0);
    ctx.stroke();

    const lx = staffX + 4;
    const ly = -40;
    ctx.fillStyle = '#0f1a20';
    ctx.fillRect(lx - 6, ly - 2, 12, 14);
    ctx.strokeStyle = this.alpha(this.mood.accent, 0.85);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(lx - 6, ly - 2, 12, 14);
    const flick = 0.8 + Math.sin(this.time * 9) * 0.2;
    ctx.fillStyle = `rgba(255, 226, 160, ${0.7 + flick * 0.3})`;
    ctx.fillRect(lx - 4, ly, 8, 10);

    // charge ring
    if (p.charging) {
      const t = p.chargeT / CHARGE.max;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const color = this.tierColor();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(lx, ly + 4, 16 + t * 10, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, t));
      ctx.stroke();
      const g = ctx.createRadialGradient(lx, ly + 4, 2, lx, ly + 4, 40 + t * 26);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 0.28 + t * 0.3;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lx, ly + 4, 40 + t * 26, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    // Companion firefly.
    this.drawGlim(ctx);
  }

  drawGlim(ctx) {
    const b = this.player.body;
    const t = this.time;
    const x = b.cx + Math.cos(t * 0.9) * 34 - this.player.facing * 10;
    const y = b.cy - 58 + Math.sin(t * 1.6) * 9;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 1, x, y, 26);
    g.addColorStop(0, 'rgba(210, 255, 240, 0.95)');
    g.addColorStop(0.3, 'rgba(140, 240, 220, 0.45)');
    g.addColorStop(1, 'rgba(120, 230, 200, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#f2fffb';
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, TAU);
    ctx.fill();
  }

  drawOrbs(ctx) {
    for (const o of this.orbs) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(o.x, o.y, 1, o.x, o.y, 26);
      g.addColorStop(0, 'rgba(255, 250, 230, 0.95)');
      g.addColorStop(0.4, 'rgba(255, 214, 150, 0.5)');
      g.addColorStop(1, 'rgba(255, 190, 120, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 26, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fffdf4';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 4, 0, TAU);
      ctx.fill();
    }
  }

  drawFx(ctx) {
    for (const f of this.fx) {
      const k = 1 - f.life / f.max;
      if (f.type === 'beam') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(230, 250, 255, ${(1 - k) * 0.9})`;
        ctx.lineWidth = 10 * (1 - k) + 2;
        ctx.beginPath();
        ctx.moveTo(f.x1, f.y1);
        ctx.lineTo(f.x2, f.y2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 255, 255, ${1 - k})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      } else if (f.type === 'bomb') {
        const r = f.r + (f.max - f.r) * k;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255, 236, 190, ${(1 - k) * 0.9})`;
        ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 220, 150, ${(1 - k) * 0.1})`;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const t = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + t * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawBeamLight(ctx) {
    if (!this.beamPath) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const points of this.beamPath) {
      if (!points || points.length < 2) continue;
      ctx.strokeStyle = 'rgba(180, 245, 255, 0.35)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------- lighting */

  drawLighting(ctx, camX, camY, z = 1) {
    const lc = this.lightCtx;
    const dpr = this.dpr;
    lc.setTransform(dpr, 0, 0, dpr, 0, 0);
    lc.clearRect(0, 0, this.w, this.h);
    lc.fillStyle = 'rgba(5, 10, 16, 0.74)';
    lc.fillRect(0, 0, this.w, this.h);
    lc.globalCompositeOperation = 'destination-out';

    const toScreen = (x, y) => ({ x: (x - camX) * z, y: (y - camY) * z });
    const holes = [];
    const b = this.player.body;
    const p = toScreen(b.cx, b.cy);
    holes.push({ ...p, r: 430 * z, a: 0.98 });
    holes.push({ ...p, r: 210 * z, a: 0.9 });

    for (const l of this.state.lamps) {
      if (!l.lit) continue;
      const s2 = toScreen(l.x, l.y - 26);
      holes.push({ ...s2, r: (l.hearth ? 330 : 230) * z, a: 0.95 });
    }
    for (const em of this.roomDef.emitters) {
      const s2 = toScreen(em.x, em.y);
      holes.push({ ...s2, r: 190 * z, a: 0.75 });
    }
    for (const g of this.state.gates) if (!g.open) {
      const s2 = toScreen(g.x, g.y + 60);
      holes.push({ ...s2, r: 110 * z, a: 0.4 });
    }
    if (this.state.shard && !this.state.shard.taken) {
      const s2 = toScreen(this.state.shard.x, this.state.shard.y - 30);
      holes.push({ ...s2, r: 190 * z, a: 0.85 });
    }
    if (this.roomDef.mirror) {
      const s2 = toScreen(this.roomDef.mirror.x, this.roomDef.mirror.y - 60);
      holes.push({ ...s2, r: 270 * z, a: 0.85 });
    }
    if (this.roomDef.altar) {
      const s2 = toScreen(this.roomDef.altar.x + 55, this.roomDef.altar.y + 40);
      holes.push({ ...s2, r: 160 * z, a: 0.55 });
    }
    if (this.state.echo) {
      const s2 = toScreen(this.state.echo.x, this.state.echo.y - 30);
      holes.push({ ...s2, r: 130 * z, a: 0.5 });
    }
    for (const t of this.roomDef.targets) {
      const s2 = toScreen(t.x + t.w / 2, t.y + t.h / 2);
      holes.push({ ...s2, r: 140 * z, a: this.state.beamHit ? 0.85 : 0.35 });
    }
    if (this.player.charging) {
      const t = this.player.chargeT / CHARGE.max;
      holes.push({ ...p, r: (170 + t * 110) * z, a: 0.7 + t * 0.3 });
    }
    for (const o of this.orbs) {
      const s2 = toScreen(o.x, o.y);
      holes.push({ ...s2, r: 120 * z, a: 0.75 });
    }
    for (const m of this.state.midges) if (!m.dead) {
      const s2 = toScreen(m.x, m.y);
      holes.push({ ...s2, r: 55 * z, a: 0.3 });
    }
    for (const c of this.state.crates) {
      const s2 = toScreen(c.body.cx, c.body.cy);
      holes.push({ ...s2, r: 90 * z, a: 0.35 });
    }

    for (const h of holes) {
      const g = lc.createRadialGradient(h.x, h.y, 2, h.x, h.y, h.r);
      g.addColorStop(0, `rgba(0,0,0,${h.a})`);
      g.addColorStop(0.5, `rgba(0,0,0,${h.a * 0.7})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.beginPath();
      lc.arc(h.x, h.y, h.r, 0, TAU);
      lc.fill();
    }
    lc.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.lightCanvas, 0, 0, this.w, this.h);
  }

  drawGlowPass(ctx, camX, camY, z = 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Lantern halo around the player.
    const b = this.player.body;
    const px = (b.cx - camX) * z;
    const py = (b.cy - camY) * z;
    const g = ctx.createRadialGradient(px, py, 10, px, py, 320);
    g.addColorStop(0, 'rgba(255, 226, 170, 0.13)');
    g.addColorStop(0.5, 'rgba(255, 210, 150, 0.05)');
    g.addColorStop(1, 'rgba(255, 200, 140, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - 320, py - 320, 640, 640);

    // Fireflies drifting in the room.
    for (let i = 0; i < 14; i++) {
      const seed = i * 97 + this.roomId.length * 31;
      const x = (((seed * 13 + Math.sin(this.time * 0.5 + i) * 60) % Math.max(1, this.roomDef.w)) - camX) * z;
      const y = ((((seed * 29 + Math.cos(this.time * 0.4 + i * 1.7) * 40) % 700) + 90) - camY) * z;
      if (x < -20 || x > this.w + 20) continue;
      const tw = 0.35 + 0.35 * Math.sin(this.time * 2 + i);
      ctx.fillStyle = `rgba(200, 255, 235, ${tw * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(160, 250, 220, ${tw * 0.12})`;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawOverlay(ctx) {
    const v = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.34, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, this.w, this.h);

    if (this.flash > 0.25) {
      ctx.fillStyle = `rgba(255, 240, 200, ${(this.flash - 0.25) * 0.18})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    // Low health vignette.
    if (this.player.hp === 1 && this.mode === 'play') {
      ctx.fillStyle = `rgba(40, 6, 14, ${0.18 + Math.sin(this.time * 4) * 0.05})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }
}
