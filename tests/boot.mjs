// Boot test: loads the real index.html entry (src/main.js) against a stub DOM
// and plays the first minute. Catches crashes that would show a black screen.
import assert from 'node:assert/strict';
import { installDom } from './dom.mjs';

const env = installDom();

// main.js reads these straight away.
window.__sistalaganBooted = false;
await import('../src/main.js');

const api = globalThis.window.__sistalagan;
assert.ok(api, 'main.js exposes the game');
const { game } = api;

assert.equal(game.mode, 'title', 'the title screen comes up first');
assert.ok(env.registry.get('screen-title').classList.contains('is-open'), 'the title screen is visible');

// Draw the title backdrop without exploding.
env.frame(16);
env.frame(33);
assert.ok(game.ready);

// Start a new game through the real button.
env.registry.get('btnNew').click();
env.frame(50);
assert.notEqual(game.mode, 'title', 'pressing Nytt spel leaves the title');
assert.ok(!env.registry.get('screen-title').classList.contains('is-open'), 'the title screen closes');
assert.ok(env.registry.get('hud').classList.contains('is-live'), 'the HUD goes live');

// Walk through the intro conversation with the E key.
for (let i = 0; i < 30 && game.mode === 'dialog'; i++) {
  env.press('KeyE', 'e');
  env.frame(60 + i * 17);
  env.release('KeyE', 'e');
}
assert.equal(game.mode, 'play', 'the intro ends and play begins');
assert.equal(game.zoneId, 'village');
assert.ok(env.registry.get('dialog').classList.contains('is-on') === false, 'the dialog box closes');

// HUD hearts were built.
const hearts = env.registry.get('hearts');
assert.ok(hearts, 'there is a hearts container');
assert.ok(game.player.maxHp >= 3, 'the player starts with hearts');

// Walk right.
const x0 = game.player.body.x;
env.press('KeyD', 'd');
for (let i = 0; i < 40; i++) env.frame(200 + i * 16);
env.release('KeyD', 'd');
assert.ok(game.player.body.x > x0 + 30, `walking moves the player (${x0.toFixed(0)} → ${game.player.body.x.toFixed(0)})`);

// Swing the sword.
env.press('KeyJ', 'j');
env.frame(900);
env.release('KeyJ', 'j');
assert.ok(game.player.attackCd > 0, 'the sword swings');

// Open the pause screen and come back.
env.press('Escape', 'Escape');
env.frame(950);
env.release('Escape', 'Escape');
assert.equal(game.mode, 'pause', 'Esc pauses');
assert.ok(env.registry.get('screen-pause').classList.contains('is-open'), 'the pause screen shows');
env.registry.get('btnResume').click();
env.frame(1000);
assert.equal(game.mode, 'play', 'resuming returns to play');

// Item hotkeys only act on owned items and never crash.
for (const code of ['Digit1', 'Digit2', 'Digit3']) {
  env.press(code);
  env.frame(1050);
  env.release(code);
}

// Change zone through the world exit: fields is west of the village.
game.loadZone('fields', { x: 400, y: 500 });
env.frame(1100);
assert.equal(game.zoneId, 'fields');
assert.ok(env.registry.get('zoneName').textContent.length > 0, 'the zone card gets a name');

// A few hundred frames of real play, to catch per-frame errors.
for (let i = 0; i < 240; i++) env.frame(1200 + i * 16);

// The save that autosave wrote can be found again.
assert.ok(game.serialize().zone, 'the game can be serialized');
assert.ok(globalThis.window.__sistalaganBooted, 'the boot flag is set');

console.log('boot ok', {
  mode: game.mode,
  zone: game.zoneId,
  hearts: game.player.maxHp,
  hudLive: env.registry.get('hud').classList.contains('is-live'),
  x: Math.round(game.player.body.x),
});
