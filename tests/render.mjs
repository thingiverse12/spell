// Dev-only: renders real game frames to PNG (needs @napi-rs/canvas).
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 1440;
const H = 810;
const OUT = process.argv[2] || './shots';

const screen = createCanvas(W, H);
screen.getBoundingClientRect = () => ({ width: W, height: H, left: 0, top: 0 });
globalThis.document = { createElement: () => createCanvas(64, 64), getElementById: () => null };
globalThis.window = { devicePixelRatio: 1 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

mkdirSync(OUT, { recursive: true });

const { Game } = await import('../src/game.js');

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
const game = new Game(screen, input, {});
game.start();

function place(x, feetY) {
  const b = game.player.body;
  b.x = x;
  b.y = feetY - b.h - 2;
  b.vx = 0;
  b.vy = 0;
  b.onGround = true;
  game.cam.x = x - W / 2;
  game.cam.y = feetY - H * 0.6;
}

function step(n) {
  for (let i = 0; i < n; i++) {
    game.update(1 / 60);
    input.endFrame();
  }
}

async function shot(name, x, feetY) {
  game.resize();
  if (x !== undefined) place(x, feetY);
  game.draw();
  writeFileSync(`${OUT}/${name}.png`, await screen.encode('png'));
  console.log('wrote', name);
}

// 1. Spawn: the sunken well, the first bench.
place(430, 1900);
step(30);
await shot('01-spawn');

// 2. Combat with a crawler, mid-swing.
place(900, 1900);
step(6);
input.press('right');
input.press('attack');
step(4);
input.release('attack');
await shot('02-combat');
input.clear();

// 3. Area two: platforms, lamps, flyers.
place(2600, 1200);
step(40);
await shot('03-vault');

// 4. The guardian hall.
place(4200, 1540);
step(30);
await shot('04-hall');

// 5. Soul blast in flight.
place(900, 1900);
game.soul = 99;
game.player.facing = 1;
input.press('spell');
step(2);
input.release('spell');
step(6);
await shot('05-spell');
input.clear();

// 6. The charm at the end of the hall.
place(5050, 900);
game.charm.taken = false;
step(4);
game.mode = 'play';
await shot('06-charm');
