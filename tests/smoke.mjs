// Headless tests for LYKTTÄNDAREN: movement, charge tiers and every puzzle.
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
globalThis.window = { devicePixelRatio: 1, addEventListener: noop };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const { Game } = await import('../src/game.js');
const { ROOMS } = await import('../src/world.js');

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
const events = { shards: 0, rooms: [], gates: 0, whispers: 0, ended: false };
const game = new Game(makeCanvas(), input, {
  onShard: () => (events.shards += 1),
  onRoom: (id) => events.rooms.push(id),
  onGate: () => (events.gates += 1),
  onWhisper: () => (events.whispers += 1),
  onEnd: () => (events.ended = true),
});
const DT = 1 / 60;

function step(n) {
  for (let i = 0; i < n; i++) {
    game.update(DT);
    input.endFrame();
  }
}

/** Put the player at x with their feet at feetY, then let them settle. */
function place(x, feetY) {
  const b = game.player.body;
  b.x = x;
  b.y = feetY - b.h - 1;
  b.vx = 0;
  b.vy = 0;
  b.onGround = false;
  game.player.invuln = 2;
  for (let i = 0; i < 60 && !b.onGround; i++) {
    game.update(DT);
    input.endFrame();
  }
  b.vx = 0;
}

function teleport(room, x, feetY) {
  game.loadRoom(room, { x, y: feetY });
  game.mode = 'play';
  place(x, feetY);
  for (const m of game.world[room].midges) m.dead = true; // keep tests deterministic
}

/** Charge the staff for `seconds`, release, and let the cast resolve. */
function cast(seconds) {
  input.press('cast');
  step(Math.max(1, Math.round(seconds / DT)));
  input.release('cast');
  step(40); // let the projectile / beam resolve
}

/* ------------------------------------------------------------ basic moves */

game.start();
assert.equal(game.mode, 'play');
assert.equal(game.roomId, 'hub');
assert.equal(events.rooms.at(-1), 'hub');

place(520, 780);
step(60);
assert.ok(game.player.body.onGround, 'the player lands on the hub floor');

const groundY = game.player.body.y;
input.press('jump');
step(1);
let apex = Infinity;
for (let i = 0; i < 60; i++) {
  step(1);
  apex = Math.min(apex, game.player.body.y);
}
input.release('jump');
const jumpH = groundY - apex;
assert.ok(jumpH > 90 && jumpH < 150, `single jump is ~117px (got ${jumpH.toFixed(0)})`);

step(60);
const y2 = game.player.body.y;
input.press('jump');
step(10);
input.edges.add('jump');
step(1);
let apex2 = Infinity;
for (let i = 0; i < 70; i++) {
  step(1);
  apex2 = Math.min(apex2, game.player.body.y);
}
input.release('jump');
assert.ok(y2 - apex2 > jumpH, `double jump goes higher (${(y2 - apex2).toFixed(0)} > ${jumpH.toFixed(0)})`);

/* --------------------------------------------------------------- garden */

teleport('garden', 300, 780);
const garden = game.world.garden;
assert.equal(garden.lamps.filter((l) => l.lit).length, 0);

place(480, 780);
game.player.facing = 1;
cast(0.05);
assert.equal(garden.vines[0].burnt, false, 'a tap does not burn the vine');

place(480, 780);
game.player.facing = 1;
cast(0.45);
assert.ok(garden.vines[0].burnt, 'the beam burns the first vine');

place(1000, 780);
game.player.facing = 1;
cast(0.45);
assert.ok(garden.vines[1].burnt, 'the second vine burns too');

place(1330, 780);
game.player.facing = 1;
cast(0.45);
assert.ok(garden.vines[2].burnt, 'the third vine burns too');

const brazierSpots = [590, 1010, 1440]; // clear of the vines
for (let i = 0; i < garden.lamps.length; i++) {
  const lamp = garden.lamps[i];
  place(brazierSpots[i], 780);
  game.player.facing = 1;
  for (let attempt = 0; attempt < 3 && !lamp.lit; attempt++) cast(0.05);
  assert.ok(lamp.lit, `brazier ${i + 1} is lit`);
}
step(6);
assert.ok(garden.gates[0].open, 'lighting all braziers opens the thorn gate');
assert.ok(events.gates >= 1, 'the gate callback fired');

place(1700, 780);
step(4);
assert.equal(events.shards, 1, 'the first memory shard is collected');

/* ---------------------------------------------------------------- grove */

teleport('grove', 200, 780);
const grove = game.world.grove;
assert.equal(grove.beamHit, false, 'the beam starts unsolved');

// Both mirrors need a three-quarter turn.
const mirrorSpots = [
  { x: 700, y: 740 }, // on the low platform
  { x: 665, y: 330 }, // on the high platform
];
for (let i = 0; i < grove.mirrors.length; i++) {
  const mir = grove.mirrors[i];
  const spot = mirrorSpots[i];
  place(spot.x, spot.y);
  game.player.invuln = 2;
  for (let turn = 0; turn < 3; turn++) {
    game.interact();
    step(1);
  }
  assert.ok(Math.abs(mir.angle - (3 * Math.PI) / 4) < 1e-6, `mirror ${i + 1} turned to three quarters`);
  place(spot.x, spot.y);
}
game.updateBeam();
assert.ok(grove.beamHit, 'the light reaches the receptacle when both mirrors are turned');
step(6);
assert.ok(grove.gates[0].open, 'the beam opens the gate');

place(1790, 780);
step(4);
assert.equal(game.shards.length, 2, 'the second shard is collected');

/* --------------------------------------------------------------- stones */

teleport('stones', 200, 780);
const stones = game.world.stones;
assert.ok(!stones.gates[0].open, 'the stone gate starts closed');

// A tap sends a crate sliding.
const crate = stones.crates[0];
const startX = crate.body.cx;
place(crate.body.x - 60, 780);
game.player.facing = 1;
cast(0.05);
step(30);
assert.ok(crate.body.cx > startX + 20, `the light push moves the crate (${startX.toFixed(0)} -> ${crate.body.cx.toFixed(0)})`);

// With both crates on the plates, the gate opens.
for (let i = 0; i < stones.crates.length; i++) {
  const plate = stones.plates[i];
  const c = stones.crates[i];
  c.body.x = plate.x + plate.w / 2 - c.body.w / 2;
  c.body.y = plate.y - c.body.h;
  c.vx = 0;
  c.vy = 0;
}
step(8);
assert.ok(stones.plates.every((p) => p.pressed), 'both plates are pressed by the crates');
assert.ok(stones.gates[0].open, 'the stone gate opens');

/* ----------------------------------------------------------------- hall */

teleport('hall', 200, 780);
const hall = game.world.hall;
assert.ok(!hall.gates[0].open, 'the echo gate starts closed');

place(hall.echo.x + 10, 820);
step(2);
game.interact();
assert.ok(hall.echo.recording, 'the crystal starts recording');

// Walk onto the first plate and stay there for the rest of the recording.
input.press('right');
let frames = 0;
while (frames < 160 && game.player.body.cx < 950) {
  step(1);
  frames += 1;
}
input.release('right');
const recordedX = game.player.body.cx;
assert.ok(recordedX > 890 && recordedX < 1010, `the walk ended on the first plate (x=${recordedX.toFixed(0)})`);
step(Math.round((hall.echo.duration + 0.3) / DT));
assert.ok(hall.echo.playing, 'the echo starts playing back');
assert.ok(hall.echo.pos, 'the echo has a position');

// Stand on the second plate while the echo holds the first.
place(1165, 828);
for (let i = 0; i < 400 && !hall.gates[0].open; i++) {
  step(1);
  game.player.body.x = 1165;
  game.player.body.vx = 0;
}
assert.ok(hall.gates[0].open, 'player + echo holding both plates opens the gate');

place(1350, 820);
step(4);
assert.equal(game.shards.length, 3, 'the third shard is collected');

/* ---------------------------------------------------------------- hub */

teleport('hub', 700, 828);
game.mode = 'play';
step(4);
assert.ok(game.prompt().startsWith('E — minnas'), 'the altar offers the ending with three memories');
game.interact();
assert.equal(game.roomId, 'hollow', 'the altar leads into the hollow');

place(1090, 780);
step(3);
assert.equal(game.mode, 'end', 'the mirror in the hollow ends the story');
assert.ok(events.ended, 'the ending callback fired');

/* ------------------------------------------------------- adaptive + death */

game.resetWorld();
game.start();
assert.equal(game.adapt, 0.5);
const adaptBefore = game.adapt;
game.player.hp = 1;
game.player.invuln = 0;
game.hurt(1, 1);
assert.equal(game.mode, 'dead');
assert.ok(game.adapt < adaptBefore, 'dying makes the forest gentler');
game.respawn();
assert.equal(game.roomId, 'hub');
assert.equal(game.player.hp, 3);

// Gentle mode: thorns bounce you instead of hurting.
game.adapt = 0.1;
teleport('garden', 800, 780);
place(800, 780);
game.player.invuln = 0;
const hpBefore = game.player.hp;
step(4);
assert.equal(game.player.hp, hpBefore, 'gentle mode turns thorn damage off');

// Harsh mode keeps the damage.
game.adapt = 0.9;
teleport('garden', 800, 780);
place(800, 780);
game.player.invuln = 0;
step(4);
assert.ok(game.player.hp < hpBefore, 'harsh mode keeps thorn damage on');

/* ----------------------------------------------------------- room travel */

game.loadRoom('hub', ROOMS.hub.spawn);
game.mode = 'play';
place(1600, 780);
step(30);
assert.equal(game.roomId, 'garden', 'the doorway to the garden works');

console.log('smoke ok', {
  jump: Math.round(jumpH),
  doubleJump: Math.round(y2 - apex2),
  shards: game.shards.length,
  gatesOpened: events.gates,
  roomsVisited: events.rooms.length,
  echoesRecorded: hall.echo.frames.length,
  adapt: Number(game.adapt.toFixed(2)),
  ended: events.ended,
});
