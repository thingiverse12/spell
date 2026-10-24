// Dev-only: dense combat frame + zoomed-in crops for visual review.
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 1440;
const H = 860;
const OUT = process.argv[2] || './shots';

const screen = createCanvas(W, H);
screen.getBoundingClientRect = () => ({ width: W, height: H, left: 0, top: 0 });
globalThis.document = { createElement: () => createCanvas(128, 128) };
globalThis.window = { devicePixelRatio: 1 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

mkdirSync(OUT, { recursive: true });

const { Game } = await import('../src/game.js');

const input = {
  pointer: { x: W * 0.62, y: H * 0.4, inside: true },
  mouse: { down: true, pressed: false },
  aimHold: false,
  stick: { active: false, dx: 0, dy: 0 },
  pressed: new Set(),
  down: () => false,
  hit(c) {
    return this.pressed.has(c);
  },
  endFrame() {
    this.pressed.clear();
  },
};

const game = new Game(screen, input, { onWaveClear() {}, onDeath() {} });
game.start();
game.beginWave(7);
game.enemies.length = 0;
game.spawnQueue.length = 0;

const types = ['grunt', 'grunt', 'shard', 'orb', 'brute', 'boss'];
for (let i = 0; i < 30; i++) {
  const e = game._spawnEnemy(types[i % types.length]);
  e.x = ((i * 137) % (W - 160)) + 80;
  e.y = ((i * 211) % (H - 160)) + 80;
  e.vx = e.vy = 0;
  e.hp = e.maxHp * (0.5 + ((i * 7) % 10) / 20);
}
game.player.x = W * 0.5;
game.player.y = H * 0.55;
game.player.mana = 999;
game.player.maxMana = 999;

function step(n) {
  for (let i = 0; i < n; i++) {
    game.update(1 / 60);
    input.endFrame();
  }
}

step(40);
game.player.mana = 999;
game.cast('fire');
game.cast('frost');
game.cast('chain');
step(8);
game.draw();

writeFileSync(`${OUT}/dense.png`, await screen.encode('png'));

// Crops (3x zoom) around the player and a couple of enemies.
function crop(name, x, y, w, h, scale = 3) {
  const c = createCanvas(w * scale, h * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(screen, x, y, w, h, 0, 0, w * scale, h * scale);
  writeFileSync(`${OUT}/${name}.png`, c.encodeSync ? c.encodeSync('png') : c.toBuffer('image/png'));
}

crop('crop-player', game.player.x - 90, game.player.y - 90, 180, 180, 4);
const grunt = game.enemies.find((e) => e.type === 'grunt' && e.hp > 0);
if (grunt) crop('crop-grunt', grunt.x - 70, grunt.y - 70, 140, 140, 5);
const boss = game.enemies.find((e) => e.type === 'boss' && e.hp > 0);
if (boss) crop('crop-boss', boss.x - 130, boss.y - 130, 260, 260, 2.4);

console.log('dense frame written');
