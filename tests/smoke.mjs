// Headless tests for DEN SISTA LÅGAN: movement, combat, parry, light, the
// dungeon chain and the boss. No browser needed.

import assert from 'node:assert/strict';

const noop = () => {};
const gradient = { addColorStop: noop };

function makeCtx() {
  const state = { globalAlpha: 1, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1 };
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
  const ctx = makeCtx();
  return {
    width: w,
    height: h,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
    setPointerCapture: noop,
  };
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
globalThis.document = { createElement: () => makeCanvas(64, 64), getElementById: () => null };
globalThis.window = { devicePixelRatio: 1, addEventListener: noop };

const { Game } = await import('../src/game.js');
const { draw } = await import('../src/render.js');
const { BRAZIERS, DUNGEON, VILLAGE_FIRE } = await import('../src/world.js');

class FakeInput {
  constructor() {
    this.held = new Set();
    this.edges = new Set();
  }
  down(a) {
    return this.held.has(a);
  }
  hit(a) {
    return this.edges.has(a);
  }
  get axis() {
    let x = 0;
    let y = 0;
    if (this.held.has('left')) x -= 1;
    if (this.held.has('right')) x += 1;
    if (this.held.has('up')) y -= 1;
    if (this.held.has('down')) y += 1;
    return { x, y };
  }
  press(a) {
    this.held.add(a);
    this.edges.add(a);
  }
  release(a) {
    this.held.delete(a);
  }
  tap(a) {
    this.edges.add(a);
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
const events = { hits: 0, parries: 0, kills: 0, saved: 0, chests: 0, victory: 0, deaths: 0, cold: 0 };

const game = new Game(makeCanvas(), input, {
  onHit: () => (events.hits += 1),
  onPerfectParry: () => (events.parries += 1),
  onKill: () => (events.kills += 1),
  onSave: () => (events.saved += 1),
  onChest: () => (events.chests += 1),
  onVictory: () => (events.victory += 1),
  onDeath: () => (events.deaths += 1),
  onCold: () => (events.cold += 1),
});

const DT = 1 / 60;
const step = (n) => {
  for (let i = 0; i < n; i++) {
    game.update(DT);
    input.endFrame();
  }
};
const hold = (action, frames) => {
  input.press(action);
  step(frames);
  input.release(action);
  step(2);
};

function teleport(scene, x, y, floor = 0) {
  game.scene = scene;
  if (scene === 'dungeon') game.floor = floor;
  game.loadScene(scene, { x, y }, true, scene === 'dungeon' ? floor : undefined);
  game.mode = 'play';
  game.player.invuln = 4;
  step(4);
}

/* ------------------------------------------------------------------ start */

game.start();
assert.equal(game.mode, 'play', 'the game starts in play mode');
assert.equal(game.player.hp, 3, 'three hearts');
assert.ok(game.scene === 'overworld' && game.enemies.length > 0, 'the overworld has enemies');

/* ---------------------------------------------------------------- walking */

const startX = game.player.x;
const startY = game.player.y;
hold('right', 40);
assert.ok(game.player.x > startX + 60, `walking right moves the player (${startX} -> ${game.player.x})`);
hold('down', 30);
assert.ok(game.player.y > startY + 30, 'walking down moves the player');

/* -------------------------------------------------------------- swordplay */

teleport('overworld', 900, 1200);
game.enemies = [];
const enemy = game.makeEnemy('skugga', 960, 1200, 'test-a');
game.enemies.push(enemy);
game.player.facing = 0;
hold('attack', 20);
assert.ok(enemy.hp < enemy.maxHp, 'a swing damages an enemy in front of you');

/* ----------------------------------------------------------------- parry */

{
  game.player.parryT = 0.2;
  game.player.facing = 0;
  game.player.invuln = 0;
  const src = { x: game.player.x + 40, y: game.player.y, state: 'windup' };
  const result = game.receiveAttack(src, 1);
  assert.equal(result, 'parried', 'a timed parry turns the attack away');
  assert.equal(src.state, 'stagger', 'the attacker is staggered by a parry');
  assert.ok(events.parries > 0, 'the parry callback fired');
}

/* --------------------------------------------------------------- blocking */

{
  game.player.parryT = 0;
  game.player.blocking = true;
  game.player.invuln = 0;
  game.player.facing = 0;
  const hp = game.player.hp;
  const result = game.receiveAttack({ x: game.player.x + 40, y: game.player.y, state: 'windup' }, 1);
  assert.equal(result, 'blocked', 'holding the shield blocks a frontal hit');
  assert.equal(game.player.hp, hp, 'blocking costs no health');
  game.player.blocking = false;
}

/* ------------------------------------------------------------------ dodge */

{
  game.player.invuln = 0;
  const hp = game.player.hp;
  game.receiveAttack({ x: game.player.x + 40, y: game.player.y, state: 'windup' }, 1);
  assert.equal(game.player.hp, hp - 1, 'an unguarded hit costs a heart');
  assert.ok(events.hits > 0, 'the hit callback fired');
  game.revive();
}

/* ------------------------------------------------------------------- fire */

const brazier = BRAZIERS[3]; // forest-1
teleport('overworld', brazier.x + 30, brazier.y + 20);
game.selectItem('torch');
input.tap('item');
step(6);
assert.ok(game.flags.braziers[brazier.id], 'the torch lights a brazier');
assert.ok(game.inHardLight(brazier.x, brazier.y), 'a lit brazier is a real light source');

// Light burns shadows away.
const shadow = game.makeEnemy('skugga', brazier.x + 40, brazier.y, 'test-burn');
game.enemies = [shadow];
const hpBefore = shadow.hp;
step(70);
assert.ok(shadow.dead || shadow.hp < hpBefore, 'shadow creatures burn inside the light');

/* ---------------------------------------------------------------- cold */

{
  teleport('overworld', 1600, 650); // Stenringen, dark and no fire
  game.enemies = []; // isolate the cold from wandering shadows
  game.player.hp = 3;
  game.flags.braziers = {};
  game.lanterns = [];
  let guard = 0;
  while (game.player.hp === 3 && guard < 2400) {
    game.update(DT);
    input.endFrame();
    guard++;
  }
  assert.ok(game.player.hp < 3, 'the cold of the dark eventually takes a heart');
  assert.ok(events.cold > 0, 'the cold callback fired');
}

/* ------------------------------------------------------------- the ring */

{
  game.flags.braziers = {};
  const ring = BRAZIERS.filter((b) => b.id.startsWith('ring'));
  game.selectItem('torch');
  for (const b of ring) {
    teleport('overworld', b.x + 30, b.y + 20);
    game.player.facing = Math.PI; // face the brazier
    game.selectItem('torch');
    input.tap('item');
    step(40);
  }
  assert.ok(game.ringLit(), 'all three braziers in Stenringen burn');
  assert.ok(!game.solids().some((s) => s.x === 1470 && s.y === 430), 'the gate down opens');
}

/* ------------------------------------------------------- enter the dungeon */

{
  game.player.x = 1515;
  game.player.y = 560;
  input.tap('use');
  step(3);
  assert.equal(game.scene, 'dungeon', 'E at the gate takes you down');
  assert.equal(game.floor, 0, 'you land on the first floor');
}

/* ------------------------------------------------- dungeon floor 1 puzzle */

{
  game.flags.braziers = {};
  const f = DUNGEON.floors[0];
  game.selectItem('torch');
  for (const b of f.braziers) {
    game.player.x = b.x + 26;
    game.player.y = b.y + 18;
    game.player.facing = Math.PI;
    input.tap('item');
    step(40);
  }
  assert.ok(game.gateOpen(), 'lighting both braziers opens the first gate');
}

/* -------------------------------------------------- floor 2: switch + bomb */

{
  game.loadScene('dungeon', DUNGEON.floors[1].spawn, true, 1);
  game.mode = 'play';
  game.player.invuln = 4;
  step(3);
  game.flags.switchOn = false;
  const f = DUNGEON.floors[1];
  game.player.x = f.switch.x - 120;
  game.player.y = f.switch.y;
  game.player.owned.bow = true;
  game.player.arrows = 20;
  game.selectItem('bow');
  game.player.facing = 0;
  input.tap('item');
  step(30);
  assert.ok(game.flags.switchOn, 'an arrow hits the eye and opens the gate');

  // A bomb opens the cracked lower wall.
  const wall = f.solids.find((s) => s.cracked);
  const id = game.wallId(wall);
  assert.ok(!game.flags.cracked[id], 'the cracked wall starts intact');
  game.player.x = wall.x - 60;
  game.player.y = wall.y + wall.h / 2;
  game.player.facing = 0;
  game.selectItem('bombs');
  game.player.bombs = 5;
  input.tap('item');
  step(70);
  assert.ok(game.flags.cracked[id], 'a bomb breaks the cracked wall');
}

/* ------------------------------------------------------------------- boss */

{
  game.loadScene('dungeon', DUNGEON.floors[2].spawn, true, 2);
  game.mode = 'play';
  game.bossIntro = 0;
  step(2);
  assert.ok(game.boss, 'the boss is waiting on the last floor');
  const b = game.boss;
  b.hp = b.maxHp * 0.45;
  b.phase = 1;
  step(4);
  assert.equal(b.phase, 2, 'the boss enters its second phase');
  let guard = 0;
  while (game.boss && guard < 400) {
    game.hurtEnemy(b, 3, 0);
    step(1);
    guard++;
  }
  assert.ok(game.flags.bossDead, 'the boss dies');
  assert.equal(game.mode, 'end', 'killing the boss ends the game');
}

/* ---------------------------------------------------- the fire and the end */

{
  game.toVillageAfterWin();
  game.mode = 'play';
  game.player.x = VILLAGE_FIRE.x + 20;
  game.player.y = VILLAGE_FIRE.y + 30;
  input.tap('use');
  step(3);
  assert.ok(game.flags.fireLit, 'lighting the great fire finishes the story');
  assert.equal(game.mode, 'end', 'the ending screen shows');
}

/* -------------------------------------------------------------------- save */

{
  game.save();
  const saved = JSON.parse(store.get('sista-lagan-save-v2'));
  assert.ok(saved && saved.flags.bossDead, 'the save remembers the boss');
  const g2 = new Game(makeCanvas(), new FakeInput(), {});
  assert.equal(g2.loadSave(), true, 'a save can be loaded');
  assert.ok(g2.flags.bossDead, 'the loaded game remembers progress');
}

/* ------------------------------------------------------------------ render */

{
  const g3 = new Game(makeCanvas(), new FakeInput(), {});
  g3.start();
  draw(g3);
  g3.mapOpen = true;
  draw(g3);
  g3.loadScene('dungeon', null, true, 0);
  draw(g3);
  assert.ok(true, 'the renderer draws the overworld, the map and the dungeon');
}

console.log('smoke ok', {
  hits: events.hits,
  parries: events.parries,
  kills: events.kills,
  saves: events.saved,
  chests: events.chests,
  victory: events.victory,
  cold: events.cold,
  braziersLit: game.litCount(),
  bossDead: game.flags.bossDead,
});
