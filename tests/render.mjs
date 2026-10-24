// Dev-only: renders frames of the game to PNG (needs @napi-rs/canvas).
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 1440;
const H = 810;
const OUT = process.argv[2] || './shots';

const screen = createCanvas(W, H);
screen.getBoundingClientRect = () => ({ width: W, height: H, left: 0, top: 0 });
globalThis.document = { createElement: () => createCanvas(64, 64), getElementById: () => null };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {} };
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

function step(n) {
  for (let i = 0; i < n; i++) {
    game.update(1 / 60);
    input.endFrame();
  }
}

function stand(x, feetY) {
  const b = game.player.body;
  b.x = x;
  b.y = feetY - b.h - 1;
  b.vx = 0;
  b.vy = 0;
  b.onGround = false;
  game.player.invuln = 3;
  for (let i = 0; i < 40 && !b.onGround; i++) step(1);
  b.vx = 0;
  game.cam.x = Math.max(0, Math.min(game.roomDef.w - W, b.cx - W / 2));
  game.cam.y = Math.max(0, Math.min(900 - H, b.cy - H * 0.56));
}

async function shot(name) {
  game.resize();
  game.draw();
  writeFileSync(`${OUT}/${name}.png`, await screen.encode('png'));
  console.log('wrote', name);
}

// 1. Lykthuset with the lantern, and the way out visible.
game.loadRoom('hub', { x: 380, y: 828 });
stand(380, 828);
step(30);
await shot('01-hub');

// 1b. The garden door with its label and the objective marker.
stand(1480, 828);
step(20);
await shot('01b-hub-door');

// 2. Charging the staff (bomb tier).
game.player.charging = true;
game.player.chargeT = 1.3;
step(2);
await shot('02-charge');
game.player.charging = false;
game.player.chargeT = 0;

// 3. Törngården: vines, braziers, thorn bed.
game.loadRoom('garden', { x: 640, y: 828 });
stand(600, 828);
for (const l of game.world.garden.lamps) l.lit = true;
step(20);
await shot('03-garden');

// 4. Spegellunden with the light beam solved.
game.loadRoom('grove', { x: 700, y: 740 });
stand(700, 740);
for (const m of game.world.grove.mirrors) m.angle = (3 * Math.PI) / 4;
game.updateBeam();
step(6);
await shot('04-grove');

// 5. Stenkammaren: crates on plates, gate open.
game.loadRoom('stones', { x: 1000, y: 828 });
const stones = game.world.stones;
stones.crates.forEach((c, i) => {
  const plate = stones.plates[i];
  c.body.x = plate.x + plate.w / 2 - c.body.w / 2;
  c.body.y = plate.y - c.body.h;
});
stand(560, 828);
step(20);
await shot('05-stones');

// 5b. Mid-push: hands braced against the stone.
game.loadRoom('stones', { x: 700, y: 828 });
input.press('left');
for (let i = 0; i < 90; i++) {
  game.update(1 / 60);
  input.endFrame();
}
await shot('05b-push');
input.release('left');

// 6. Ekokammaren with a live echo.
game.loadRoom('hall', { x: 400, y: 828 });
const hall = game.world.hall;
hall.midges.forEach((m) => (m.dead = true));
stand(300, 828);
game.interact();
input.press('right');
step(150);
input.release('right');
stand(1000, 828);
step(Math.round((hall.echo.duration + 0.2) * 60));
stand(1165, 828);
step(120);
stand(1165, 828);
game.player.body.x = 1165;
step(30);
await shot('06-hall');

// 7. The hollow room and its mirror.
game.loadRoom('hollow', { x: 700, y: 828 });
stand(700, 828);
step(20);
await shot('07-hollow');
