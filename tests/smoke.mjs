// Headless gameplay tests for Den sista lågan.
// Runs the real Game and the real renderer against a stub DOM.
import assert from 'node:assert/strict';
import { installDom } from './dom.mjs';

const env = installDom();
const { Game } = await import('../src/game.js');
const { ZONES, QUESTS } = await import('../src/world.js');

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
    let x = 0;
    let y = 0;
    if (this.held.has('left')) x -= 1;
    if (this.held.has('right')) x += 1;
    if (this.held.has('up')) y -= 1;
    if (this.held.has('down')) y += 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }
  press(a) {
    if (!this.held.has(a)) this.edges.add(a);
    this.held.add(a);
  }
  release(a) {
    this.held.delete(a);
  }
  tap(a) {
    this.press(a);
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
const events = { zones: [], items: [], parries: 0, wins: 0, lights: 0, boss: [] };
const cb = {
  onZone: (def) => events.zones.push(def.id),
  onItem: (id) => events.items.push(id),
  onParry: () => (events.parries += 1),
  onWin: () => (events.wins += 1),
  onLight: () => (events.lights += 1),
  onBoss: (a) => events.boss.push(a),
  onDeath: () => {},
  onQuest: () => {},
  onHud: () => {},
  onEmbers: () => {},
  onDialog: () => {},
  onShop: () => {},
  onSelect: () => {},
  onToast: () => {},
  onDamage: () => {},
  onPause: () => {},
};

const game = new Game(env.document.getElementById('game'), input, cb);
game.cb = cb;
const DT = 1 / 60;

function step(n = 1) {
  for (let i = 0; i < n; i++) {
    game.update(DT);
    input.endFrame();
  }
}

function place(x, y) {
  const b = game.player.body;
  b.x = x;
  b.y = y;
  b.vx = 0;
  b.vy = 0;
  game.player.invuln = 0.1;
}

function tp(zone, x, y) {
  game.loadZone(zone, { x, y });
  game.mode = 'play';
  place(x, y);
  step(2);
}

function clearDialog() {
  let guard = 0;
  while (game.mode === 'dialog' && guard++ < 60) {
    input.tap('interact');
    game.update(DT);
    input.endFrame();
    input.release('interact');
  }
  game.mode = 'play';
}

/* ------------------------------------------------------------------ boot */

game.startNew();
assert.equal(game.mode, 'dialog', 'the intro starts as a conversation');
assert.equal(game.zoneId, 'village', 'the game starts in the village');
clearDialog();
assert.equal(game.mode, 'play');

/* -------------------------------------------------------------- movement */

place(750, 700);
const x0 = game.player.body.x;
input.press('right');
step(40);
input.release('right');
assert.ok(game.player.body.x > x0 + 40, `walking works (${x0.toFixed(0)} -> ${game.player.body.x.toFixed(0)})`);

// Walls stop the player instead of letting them leave the map.
input.press('left');
step(400);
input.release('left');
assert.ok(game.player.body.x >= 8, 'the player stays inside the village');

/* ---------------------------------------------------------------- hedda */

place(690, 640);
step(2);
input.tap('interact');
step(1);
assert.equal(game.mode, 'dialog', 'talking to Hedda opens a conversation');
clearDialog();
assert.ok(game.player.items.includes('torch'), 'Hedda gives the torch');
assert.ok(game.flags.torch);

/* ------------------------------------------------------- braziers + items */

tp('fields', 300, 350);
place(300, 350);
step(2);
input.tap('interact');
step(2);
clearDialog();
assert.ok(game.flags.braziers.fields, 'the field brazier is lit');
assert.ok(game.flags.freed.sune, 'lighting it frees Sune');
assert.ok(game.player.items.includes('bomb'), 'Sune hands over the bombs');
assert.equal(game.quest, 'fields', 'the quest moved on');

// A thrown flame lights a brazier from a distance.
tp('forest', 900, 300);
const forestBrazier = game.z.braziers[0];
game.player.items = ['torch', 'bomb'];
game.player.item = 0;
place(forestBrazier.x - 150, forestBrazier.y + 10);
game.player.facing = 0;
game.player.attackCd = 0;
input.tap('item');
step(30);
assert.ok(forestBrazier.lit, 'a thrown flame lights a brazier at range');
clearDialog();
assert.ok(game.flags.freed.alva, 'Alva is freed');
assert.ok(game.player.items.includes('bow'), 'Alva gives the bow');

// Fire burns brambles, steel does not.
const bramble = game.z.brambles[0];
assert.ok(!bramble.burnt);
place(bramble.x - 40, bramble.y + bramble.h * 0.5);
game.player.facing = 0;
game.player.attackCd = 0;
input.tap('item');
step(40);
assert.ok(bramble.burnt, 'the flame burns the bramble');

// The third light gives a heart.
tp('river', 1300, 700);
place(1360, 760);
step(2);
input.tap('interact');
step(2);
clearDialog();
assert.ok(game.flags.braziers.river);
assert.equal(game.player.maxHp, 4, 'Vidar gives an extra heart');
assert.ok(game.flags.braziers.fields && game.flags.braziers.forest && game.flags.braziers.river);

// All three lit → Hedda hands over the crypt key.
tp('village', 700, 640);
place(690, 640);
step(2);
input.tap('interact');
step(1);
clearDialog();
assert.ok(game.flags.cryptKey, 'Hedda gives the crypt key');

/* ------------------------------------------------------------------ crypt */

tp('crypt1', 200, 700);
const rubble = game.z.rubble[0];
assert.ok(!rubble.broken, 'the stair is blocked by rubble');
place(rubble.x + rubble.w / 2, rubble.y + rubble.h + 40);
game.player.items = ['torch', 'bomb', 'bow'];
game.player.item = 1;
game.player.facing = -Math.PI / 2;
game.player.attackCd = 0;
input.tap('item');
step(110);
assert.ok(rubble.broken, 'a bomb clears the rubble');

tp('crypt2', 1100, 240);
const sw = game.z.switches[0];
assert.ok(!sw.hit);
const gate = game.z.gates[0];
assert.ok(!gate.open);
place(sw.x - 140, sw.y + 10);
game.player.items = ['torch', 'bomb', 'bow'];
game.player.item = 2;
game.player.facing = 0;
game.player.attackCd = 0;
input.tap('item');
step(40);
assert.ok(sw.hit, 'an arrow hits the switch');
assert.ok(gate.open, 'the switch opens the gate');

/* ----------------------------------------------------------------- combat */

tp('fields', 600, 600);
game.enemies.length = 0;
const shadow = game.makeEnemy('shadow', 620, 600);
shadow.state = 'chase';
game.enemies.push(shadow);
place(560, 600);
game.player.facing = 0;
const hpBefore = game.player.hp;
for (let i = 0; i < 6 && !shadow.dead; i++) {
  game.player.attackCd = 0;
  input.tap('attack');
  step(14);
}
assert.ok(shadow.dead, 'six swings finish a shadow');

// Parry: a well timed shield stops the hit and opens a counter window.
game.player.hp = 3;
game.player.invuln = 0;
game.player.parryT = 0.2;
game.player.facing = Math.PI; // facing the attacker on the left
const parryResult = game.damagePlayer(1, game.player.body.cx - 30, game.player.body.cy);
assert.equal(parryResult, 'parry', 'a parry beats the attack');
assert.equal(game.player.hp, 3, 'a parry takes no damage');
assert.ok(game.player.counter > 0, 'a parry opens a counter window');

// Blocking without timing still stops damage.
game.player.invuln = 0;
game.player.parryT = 0;
game.player.shielding = true;
const blockResult = game.damagePlayer(1, game.player.body.cx - 30, game.player.body.cy);
assert.equal(blockResult, 'block', 'the raised shield blocks');
assert.equal(game.player.hp, 3);

// Being hit from behind while blocking hurts.
game.player.invuln = 0;
game.player.shielding = true;
game.player.parryT = 0;
game.player.facing = Math.PI; // looking away from the attacker on the right
game.damagePlayer(1, game.player.body.cx + 30, game.player.body.cy);
assert.ok(game.player.hp < 3, 'a hit from behind still hurts');

/* ------------------------------------------------------------------- boss */

game.player.hp = game.player.maxHp;
tp('crypt3', 700, 780);
place(700, 500);
step(20);
const warden = game.enemies.find((e) => e.kind === 'warden');
assert.ok(warden, 'the Warden wakes in the last chamber');
assert.deepEqual(events.boss.slice(-1), [true]);

warden.hp = 1;
game.player.facing = Math.atan2(warden.body.cy - game.player.body.cy, warden.body.cx - game.player.body.cx);
place(warden.body.cx - 50, warden.body.cy + 10);
game.player.facing = 0;
game.player.attackCd = 0;
input.tap('attack');
step(10);
assert.ok(game.flags.bossDead, 'the Warden can be beaten');
clearDialog();

const altar = game.z.altar;
place(altar.x, altar.y + 30);
step(2);
input.tap('interact');
step(2);
assert.ok(game.flags.flameLit, 'the first flame is lit');
assert.equal(events.wins, 1, 'lighting the flame ends the game');

/* ------------------------------------------------------------------- save */

game.mode = 'play';
tp('village', 700, 660);
const data = game.serialize();
Game.clearSave();
localStorage.setItem('sistalagan.save.v1', JSON.stringify(data));
const loaded = Game.loadSave();
assert.ok(loaded, 'a save can be read back');
const game2 = new Game(env.document.getElementById('game'), new FakeInput(), {});
game2.cb = {};
game2.continueGame(loaded);
assert.equal(game2.player.items.length, data.items.length, 'items survive a reload');
assert.equal(game2.player.maxHp, data.maxHp, 'hearts survive a reload');
assert.equal(game2.zoneId, data.zone, 'the zone survives a reload');

/* ------------------------------------------------------------- rendering */

game.mode = 'play';
tp('village', 700, 660);
for (let i = 0; i < 4; i++) {
  game.update(DT);
  input.endFrame();
  game.draw();
}
assert.ok(game.quest);

console.log('smoke ok', {
  zones: [...new Set(events.zones)],
  quest: game.quest,
  quests: QUESTS.length,
  items: game.player.items,
  hearts: game.player.maxHp,
  parries: events.parries,
  wins: events.wins,
  bossBeaten: game.flags.bossDead,
  zonesInWorld: Object.keys(ZONES).length,
});
