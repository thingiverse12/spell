// Renders still frames of every zone to ./shots so the art can be reviewed
// without a browser.
import { mkdirSync, writeFileSync } from 'node:fs';
import { installDom } from './dom.mjs';

const outDir = process.argv[2] || './shots';
mkdirSync(outDir, { recursive: true });

const env = installDom({ width: 1280, height: 720 });
const { Game } = await import('../src/game.js');
const { ZONES } = await import('../src/world.js');

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
    return { x: 0, y: 0 };
  }
  endFrame() {
    this.edges.clear();
  }
}

const canvas = env.document.getElementById('game');
const game = new Game(canvas, new FakeInput(), {});
game.cb = {};
const DT = 1 / 60;

function step(n = 1) {
  for (let i = 0; i < n; i++) {
    game.update(DT);
    game.input.endFrame();
  }
}

function place(x, y) {
  const b = game.player.body;
  b.x = x;
  b.y = y;
  b.vx = 0;
  b.vy = 0;
}

async function shot(name) {
  game.draw();
  const buf = canvas.toBuffer('image/png');
  writeFileSync(`${outDir}/${name}.png`, buf);
  console.log('wrote', name);
}

// Village: Hedda and the dead hearth.
game.loadZone('village', { x: 700, y: 660 });
game.mode = 'play';
place(660, 700);
step(45);
await shot('01-village');

// Village with the hearth burning.
game.z.braziers.forEach((b) => (b.lit = true));
place(700, 640);
step(30);
await shot('02-village-hearth');

// Fields, one brazier lit, statue nearby.
game.loadZone('fields', { x: 400, y: 420 });
game.mode = 'play';
game.z.braziers.forEach((b) => (b.lit = true));
place(340, 400);
step(40);
await shot('03-fields');

// Forest.
game.loadZone('forest', { x: 900, y: 700 });
game.mode = 'play';
game.z.braziers.forEach((b) => (b.lit = true));
place(880, 720);
step(40);
await shot('04-forest');

// River + bridge.
game.loadZone('river', { x: 560, y: 560 });
game.mode = 'play';
game.z.braziers.forEach((b) => (b.lit = true));
place(560, 560);
step(40);
await shot('05-river');

// Crypt, dark, with a lit brazier.
game.loadZone('crypt1', { x: 700, y: 500 });
game.mode = 'play';
game.z.braziers.forEach((b) => (b.lit = true));
place(660, 520);
step(40);
await shot('06-crypt');

// Boss chamber.
game.loadZone('crypt3', { x: 700, y: 780 });
game.mode = 'play';
game.z.braziers.forEach((b) => (b.lit = true));
place(700, 640);
step(8);
for (const e of game.enemies) e.state = 'chase';
step(30);
await shot('07-warden');

// Combat moment: shadows in the fields at night.
game.loadZone('fields', { x: 900, y: 560 });
game.mode = 'play';
place(900, 560);
game.enemies.forEach((e) => {
  e.state = 'chase';
  e.body.x = 900 + (Math.random() - 0.5) * 160;
  e.body.y = 560 + (Math.random() - 0.5) * 120;
});
game.player.swingT = 0.14;
game.effects.push({ type: 'swing', x: game.player.body.cx, y: game.player.body.cy, a: 0, life: 0.18, maxLife: 0.22, reach: 52 });
step(3);
await shot('08-combat');

console.log('done', Object.keys(ZONES).length, 'zones');
