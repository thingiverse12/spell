// Renders the game headlessly to PNGs for visual review.
//   npm run shots   →   ./shots/*.png

import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Game } from '../src/game.js';
import { draw } from '../src/render.js';

const noop = () => {};

globalThis.document = {
  createElement: () => createCanvas(64, 64),
  getElementById: () => null,
};
globalThis.window = { devicePixelRatio: 1, addEventListener: noop };
globalThis.localStorage = { getItem: () => null, setItem: noop };

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
    return { x: 0, y: 0 };
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
}

const W = 1280;
const H = 720;
const canvas = createCanvas(W, H);
canvas.getBoundingClientRect = () => ({ width: W, height: H, left: 0, top: 0 });

const input = new FakeInput();
const game = new Game(canvas, input, {});
game.start();
game.player.invuln = 0;

const dir = process.argv[2] || './shots';
mkdirSync(dir, { recursive: true });

const ctx = canvas.getContext('2d');

function settle(n = 20) {
  for (let i = 0; i < n; i++) {
    game.update(1 / 60);
    input.endFrame();
  }
}

function shot(name) {
  draw(game);
  writeFileSync(`${dir}/${name}.png`, canvas.toBuffer('image/png'));
  console.log('wrote', name);
}

// 1. Vedstorp at dusk, bonfire unlit, villagers about.
game.loadScene('overworld', { x: 1600, y: 2080 });
game.mode = 'play';
settle(30);
shot('01-village');

// 2. Up by the smithy and the inn.
game.loadScene('overworld', { x: 1350, y: 1880 });
settle(10);
shot('02-village-north');

// 3. The forest with a lit brazier.
game.flags.braziers['forest-1'] = true;
game.loadScene('overworld', { x: 470, y: 1780 });
settle(10);
shot('03-forest');

// 4. Stenringen, the ring of braziers and the sealed gate.
game.loadScene('overworld', { x: 1510, y: 1250 });
settle(10);
shot('04-ruins-sealed');

game.flags.braziers['ring-1'] = true;
game.flags.braziers['ring-2'] = true;
game.flags.braziers['ring-3'] = true;
game.loadScene('overworld', { x: 1510, y: 780 });
settle(10);
shot('05-ruins-open');

// 6. The marsh, cold water and an archer.
game.loadScene('overworld', { x: 2600, y: 1900 });
settle(10);
shot('06-marsh');

// 7. Dungeon, first floor, one brazier lit.
game.flags.braziers['d0-1'] = true;
game.loadScene('dungeon', null, true, 0);
game.mode = 'play';
settle(20);
shot('07-dungeon-1');

// 8. Crypt floor with the eye switch.
game.loadScene('dungeon', null, true, 1);
game.mode = 'play';
game.flags.braziers['d1-1'] = true;
game.player.x = 620;
game.player.y = 420;
settle(20);
shot('08-dungeon-2');

// 9. The boss.
game.loadScene('dungeon', null, true, 2);
game.mode = 'play';
game.bossIntro = 0;
game.flags.braziers['d2-1'] = true;
game.player.x = 560;
game.player.y = 640;
settle(30);
shot('09-boss');

// 10. The map.
game.loadScene('overworld', { x: 1600, y: 2000 });
game.mode = 'play';
game.mapOpen = true;
settle(4);
shot('10-map');

console.log('done');
