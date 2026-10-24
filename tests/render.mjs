// Dev-only: renders real frames of the canvas to PNG so the art can be reviewed
// without a browser. Requires @napi-rs/canvas (not a runtime dependency).
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 1440;
const H = 860;
const OUT = process.argv[2] || './shots';

const screen = createCanvas(W, H);
screen.getBoundingClientRect = () => ({ width: W, height: H, left: 0, top: 0 });
globalThis.document = {
  createElement: () => createCanvas(128, 128),
};
globalThis.window = { devicePixelRatio: 1 };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

mkdirSync(OUT, { recursive: true });

const { Game } = await import('../src/game.js');

const input = {
  pointer: { x: W * 0.7, y: H * 0.45, inside: true },
  mouse: { down: true, pressed: false },
  aimHold: false,
  stick: { active: false, dx: 0, dy: 0 },
  pressed: new Set(),
  down: () => false,
  hit(code) {
    return this.pressed.has(code);
  },
  endFrame() {
    this.pressed.clear();
  },
};

const game = new Game(screen, input, {
  onWaveClear: () => {},
  onDeath: () => {},
});
game.start();

const DT = 1 / 60;
function step(frames, { auto = true } = {}) {
  for (let i = 0; i < frames; i++) {
    if (auto) {
      const alive = game.enemies.filter((e) => e.hp > 0);
      if (alive.length && game.player) {
        let best = alive[0];
        let bd = Infinity;
        for (const e of alive) {
          const d = (e.x - game.player.x) ** 2 + (e.y - game.player.y) ** 2;
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
        input.pointer.x = best.x;
        input.pointer.y = best.y;
      }
      if (i % 50 === 0) input.pressed.add('KeyE');
      if (i % 42 === 0) input.pressed.add('KeyR');
      if (i % 24 === 0) input.pressed.add('MouseRight');
      if (i % 210 === 0) input.pressed.add('Space');
      input.mouse.down = i % 4 !== 0;
      if (game.player) {
        // Gentle kiting so the player does not get cornered.
        const t = i * DT;
        game.player.x += Math.cos(t * 0.9) * 1.4;
        game.player.y += Math.sin(t * 1.3) * 1.1;
      }
    }
    game.update(DT);
    input.endFrame();
  }
}

async function shot(name) {
  game.draw();
  const png = await screen.encode('png');
  writeFileSync(`${OUT}/${name}.png`, png);
  console.log('wrote', name, game.wave, game.enemies.length);
}

mkdirSync(OUT, { recursive: true });

// 1. Opening wave.
step(150);
await shot('01-opening');

// 2. Mid combat with a busy screen.
game.beginWave(4);
game.enemies.length = 0;
step(420);
await shot('02-combat');

// 3. Boss wave.
game.beginWave(5);
game.enemies.length = 0;
step(300);
await shot('03-boss');

// 4. Heavy effects: fireball + nova + lightning all at once.
game.player.mana = 999;
game.player.maxMana = 999;
game.cast('fire');
game.cast('frost');
game.cast('chain');
step(9);
await shot('04-effects');
