// Headless smoke test: runs the real game loop against a stubbed canvas.
// Verifies waves progress, spells fire, enemies die and nothing throws.
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

function makeCanvas(w = 1280, h = 800) {
  return {
    width: w,
    height: h,
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
  };
}

globalThis.document = {
  createElement: () => makeCanvas(128, 128),
  getElementById: () => null,
};
globalThis.window = { devicePixelRatio: 1 };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const { Game } = await import('../src/game.js');

const canvas = makeCanvas();
const stats = { offers: 0, maxWave: 1, deaths: 0, scoreAtEnd: 0 };
let pendingPicks = null;

const game = new Game(canvas, makeFakeInput(), {
  onWaveClear: (wave, picks) => {
    stats.offers += 1;
    stats.maxWave = Math.max(stats.maxWave, wave);
    pendingPicks = picks[0] || null;
  },
  onDeath: () => {
    stats.deaths += 1;
  },
});

function makeFakeInput() {
  const pressed = new Set();
  return {
    pointer: { x: 900, y: 400, inside: true },
    mouse: { down: true, pressed: false },
    aimHold: false,
    stick: { active: false, dx: 0, dy: 0 },
    pressed,
    down: () => false,
    hit: (code) => pressed.has(code),
    endFrame: () => pressed.clear(),
  };
}

game.start();
const input = game.input;
const DT = 1 / 60;
let frames = 0;
let spellCasts = 0;

const originalCast = game.cast.bind(game);
game.cast = (id) => {
  const ok = originalCast(id);
  if (ok) spellCasts += 1;
  return ok;
};

while (frames < 60 * 60 * 6) {
  // Aim at the closest enemy, or sweep the pointer around.
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

  // Keep casting the whole toolkit so every code path runs.
  if (frames % 45 === 0) input.pressed.add('KeyE');
  if (frames % 37 === 0) input.pressed.add('KeyR');
  if (frames % 150 === 0) input.pressed.add('Space');
  input.mouse.down = frames % 3 !== 0;

  // Move around a little so the player never stands still.
  const t = frames * DT;
  game.player && (game.player.x += Math.cos(t) * 0.9);

  if (game.phase === 'offer' && pendingPicks) {
    game.applyUpgrade(pendingPicks.id);
    pendingPicks = null;
    game.beginWave(game.wave + 1);
  }

  game.update(DT);
  game.draw();
  input.endFrame();
  frames += 1;

  if (stats.deaths) break;
}

stats.scoreAtEnd = game.score;
stats.maxWave = Math.max(stats.maxWave, game.wave);

assert.ok(frames > 100, 'loop ran');
assert.ok(game.wave >= 2, `expected at least 2 waves, got ${game.wave}`);
assert.ok(stats.offers >= 1, 'at least one upgrade offer');
assert.ok(spellCasts > 100, `spells were cast (${spellCasts})`);
assert.ok(game.score > 0, 'enemies were killed for score');
assert.ok(Object.keys(game.levels).length >= 1, 'upgrades applied');
assert.ok(game.player.hp <= game.player.maxHp, 'hp stays bounded');

console.log('smoke ok', {
  frames,
  seconds: Math.round(frames * DT),
  waves: game.wave,
  offers: stats.offers,
  score: stats.scoreAtEnd,
  spells: spellCasts,
  deaths: stats.deaths,
  upgrades: Object.keys(game.levels).length,
  hp: Math.round(game.player.hp),
});
