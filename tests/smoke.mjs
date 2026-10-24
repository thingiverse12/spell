// Headless gameplay tests: runs the real game logic against a stub canvas.
import assert from 'node:assert/strict';

const noop = () => {};
const gradient = { addColorStop: noop };

function makeCtx() {
  const state = { globalAlpha: 1 };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradient;
      if (prop === 'measureText') return () => ({ width: 10 });
      return noop;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function makeCanvas(w = 1280, h = 720) {
  return {
    width: w,
    height: h,
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
    setPointerCapture: noop,
  };
}

globalThis.document = { createElement: () => makeCanvas(64, 64), getElementById: () => null };
globalThis.window = { devicePixelRatio: 1 };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const { Game } = await import('../src/game.js');
const { PLAYER_SPAWN, BENCHES, CHARM } = await import('../src/world.js');

class FakeInput {
  constructor() {
    this.held = new Set();
    this.edges = new Set();
    this.stick = { active: false, dx: 0, dy: 0 };
  }
  down(a) {
    return this.held.has(a);
  }
  hit(a) {
    return this.edges.has(a);
  }
  get axis() {
    let a = 0;
    if (this.held.has('left')) a -= 1;
    if (this.held.has('right')) a += 1;
    return a;
  }
  press(a) {
    this.held.add(a);
    this.edges.add(a);
  }
  release(a) {
    this.held.delete(a);
  }
  endFrame() {
    this.edges.clear();
  }
  clear() {
    this.held.clear();
    this.edges.clear();
  }
}

const input = new FakeInput();
const game = new Game(makeCanvas(), input, {});
const DT = 1 / 60;

function step(n, dt = DT) {
  for (let i = 0; i < n; i++) {
    game.update(dt);
    input.endFrame();
  }
}

function placePlayer(x, feetY) {
  const b = game.player.body;
  b.x = x;
  b.y = feetY - b.h - 1;
  b.vx = 0;
  b.vy = 0;
  b.onGround = true;
  game.player.hp = game.player.maxHp;
  game.player.invuln = 0;
}

/* ------------------------------------------------------- basic mechanics */

game.start();

// 1. Gravity + landing.
placePlayer(700, 1700);
game.player.body.onGround = false;
step(90);
assert.ok(game.player.body.onGround, 'player should land on the floor');
assert.ok(Math.abs(game.player.body.bottom - 1900) < 2, `feet at ground level (got ${game.player.body.bottom})`);

// 2. Jump reaches a sensible height and double jump goes higher.
const groundY = game.player.body.y;
input.press('jump');
let apex = 9999;
for (let i = 0; i < 70; i++) {
  if (i === 40) input.release('jump');
  step(1);
  apex = Math.min(apex, game.player.body.y);
}
const singleJump = groundY - apex;
step(60);
assert.ok(game.player.body.onGround, 'landed again after jump');
const groundY2 = game.player.body.y;
input.press('jump');
step(12);
input.edges.add('jump'); // fresh edge for the mid-air jump
step(1);
let apex2 = 9999;
for (let i = 0; i < 80; i++) {
  if (i === 45) input.release('jump');
  step(1);
  apex2 = Math.min(apex2, game.player.body.y);
}
const doubleJump = groundY2 - apex2;
assert.ok(singleJump > 90 && singleJump < 220, `single jump ~136px (got ${singleJump.toFixed(1)})`);
assert.ok(doubleJump > singleJump, `double jump higher (${doubleJump.toFixed(1)} > ${singleJump.toFixed(1)})`);

// 3. Nail damage and kill.
placePlayer(900, 1900);
const testEnemy = game.makeEnemy({ type: 'crawler', x: 955, y: 1900, min: 700, max: 1500 }, 99);
game.enemies.push(testEnemy);
game.player.facing = 1;
const hpBefore = testEnemy.hp;
input.press('attack');
step(1);
input.release('attack');
step(12);
assert.ok(testEnemy.hp < hpBefore, `nail damaged the crawler (${hpBefore} -> ${testEnemy.hp})`);
assert.ok(game.soul > 0, 'hitting an enemy grants soul');

// 3b. Spell: soul blast costs soul and hits at range.
placePlayer(900, 1900);
const farEnemy = game.makeEnemy({ type: 'crawler', x: 1180, y: 1900, min: 700, max: 1500 }, 98);
game.enemies.push(farEnemy);
game.player.facing = 1;
game.soul = 66;
const farHp = farEnemy.hp;
input.press('spell');
step(1);
input.release('spell');
step(30);
assert.ok(farEnemy.hp < farHp, `spell damaged the distant enemy (${farHp} -> ${farEnemy.hp})`);
assert.equal(game.soul, 33, 'spell spent 33 soul');
step(34);
assert.equal(game.spells.length, 0, 'spell projectile expired');
game.soul = 0;
input.press('spell');
step(1);
input.release('spell');
assert.equal(game.spells.length, 0, 'cannot cast without soul');

// 4. Benches restore masks and set the respawn point.
placePlayer(BENCHES[0].x + 20, 1900);
game.player.hp = 2;
input.press('interact');
step(1);
input.release('interact');
assert.equal(game.mode, 'bench', 'interacting at a bench opens the rest state');
assert.equal(game.player.hp, game.player.maxHp, 'bench heals to full');
game.mode = 'play';

// 5. Spikes hurt.
placePlayer(2740 + 60, 1740);
game.player.invuln = 0;
const hpBeforeSpike = game.player.hp;
step(6);
assert.ok(game.player.hp < hpBeforeSpike, 'spikes deal damage');

// 6. Death, respawn and enemy reset.
placePlayer(1800, 1900);
game.player.hp = 1;
game.hurtPlayer(5, 1);
assert.equal(game.mode, 'dead', 'player dies when masks run out');
assert.equal(game.player.hp, 0);
game.respawn();
assert.equal(game.mode, 'play');
assert.equal(game.player.hp, game.player.maxHp, 'respawn restores masks');

// 7. Reaching the charm ends the run.
game.charm.taken = false;
placePlayer(CHARM.x - 10, 900);
step(2);
assert.equal(game.mode, 'won', 'picking up the charm wins the run');
assert.equal(game.charm.taken, true);

/* -------------------------------------------- bot playthrough (sanity run) */

game.reset(false);
game.start();
placePlayer(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
game.enemies = game.enemies.filter((e) => e.min > 500); // fresh enemies near spawn are fine
let maxX = 0;
let frames = 0;
const target = 60 * 75;

while (frames < target) {
  const p = game.player;
  const b = p.body;
  const enemies = game.enemies.filter((e) => !e.dead);
  let nearest = null;
  let nd = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.body.cx - b.cx, e.body.cy - b.cy);
    if (d < nd) {
      nd = d;
      nearest = e;
    }
  }

  input.clear();
  input.press('right');
  if (nearest && nd < 110) {
    p.facing = Math.sign(nearest.body.cx - b.cx) || 1;
    if (frames % 14 === 0) input.press('attack');
  }
  if (b.onGround && frames % 34 === 0) input.press('jump');
  if (!b.onGround && frames % 61 === 0) input.press('jump');
  if (frames % 190 === 0) input.press('dash');

  game.update(DT);
  input.endFrame();
  maxX = Math.max(maxX, b.cx);
  frames += 1;
  if (game.mode === 'dead' || game.mode === 'won') {
    if (game.mode === 'dead') {
      game.respawn();
      placePlayer(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
    } else break;
  }
}

assert.ok(maxX > 1400, `bot made it across the first stretch (x=${maxX.toFixed(0)})`);
assert.ok(game.stats.kills >= 1, `bot killed enemies (${game.stats.kills})`);
assert.ok(game.stone > 0, 'geo collected');

console.log('smoke ok', {
  singleJump: Math.round(singleJump),
  doubleJump: Math.round(doubleJump),
  botFrames: frames,
  botMaxX: Math.round(maxX),
  kills: game.stats.kills,
  geo: game.stone,
  deaths: game.stats.deaths,
});
