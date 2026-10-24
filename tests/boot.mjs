// Boot test: loads src/main.js against a minimal DOM stub, runs frames and
// reports any runtime error. This is what catches "black screen" bugs.
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
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return noop;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

const listeners = new Map();

function addListener(target, type, fn) {
  if (!listeners.has(target)) listeners.set(target, new Map());
  const byType = listeners.get(target);
  if (!byType.has(type)) byType.set(type, []);
  byType.get(type).push(fn);
}

function emit(target, type, event = {}) {
  const byType = listeners.get(target);
  if (!byType || !byType.has(type)) return;
  for (const fn of byType.get(type)) fn({ preventDefault: noop, ...event });
}

function makeElement(tag = 'div', id = '') {
  const classes = new Set();
  const style = {};
  const el = {
    tagName: tag.toUpperCase(),
    id,
    dataset: {},
    style,
    innerHTML: '',
    textContent: '',
    title: '',
    children: [],
    firstElementChild: null,
    offsetWidth: 100,
    addEventListener: (type, fn) => addListener(el, type, fn),
    removeEventListener: noop,
    appendChild(child) {
      el.children.push(child);
      if (child && typeof child === 'object') el.firstElementChild = el.children[0];
      return child;
    },
    querySelector: () => makeElement('div'),
    querySelectorAll: () => [],
    setPointerCapture: noop,
    getBoundingClientRect: () => ({ width: 1440, height: 810, left: 0, top: 0 }),
    getContext: () => makeCtx(),
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      },
      contains: (c) => classes.has(c),
    },
    focus: noop,
    blur: noop,
  };
  el.width = 1440;
  el.height = 810;
  return el;
}

const registry = new Map();
const ids = [
  'game', 'hud', 'hearts', 'shards', 'charge', 'chargeFill', 'chargeLabel', 'roomTitle', 'roomName', 'roomSub',
  'whisper', 'whisperText', 'prompt', 'toast', 'pauseBtn', 'muteBtn', 'screen-title', 'screen-memory',
  'screen-rest', 'screen-pause', 'screen-dead', 'screen-end', 'titleBest', 'memoryCount', 'memoryTitle',
  'memoryText', 'pauseAdapt', 'deadText', 'memoryList', 'endText', 'touch', 'touchStick',
  'startBtn', 'againBtn', 'restartBtn', 'memoryBtn', 'restBtn', 'respawnBtn', 'resumeBtn',
];
for (const id of ids) registry.set(id, makeElement(id === 'game' ? 'canvas' : 'div', id));

globalThis.document = {
  getElementById: (id) => registry.get(id) || null,
  createElement: (tag) => makeElement(tag),
  querySelectorAll: () => [],
  body: makeElement('body'),
};

const rafQueue = [];
globalThis.window = {
  devicePixelRatio: 1,
  innerWidth: 1440,
  innerHeight: 810,
  addEventListener: (type, fn) => addListener(globalThis.window, type, fn),
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  requestAnimationFrame: (fn) => {
    rafQueue.push(fn);
    return rafQueue.length;
  },
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = noop;
globalThis.performance = { now: () => Date.now() };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
globalThis.AudioContext = class {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = {};
  }
  createGain() {
    return { gain: { value: 0, setTargetAtTime: noop, setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: (x) => x };
  }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop, setTargetAtTime: noop, linearRampToValueAtTime: noop },
      connect: (x) => x,
      start: noop,
      stop: noop,
    };
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(8) };
  }
  createBufferSource() {
    return { buffer: null, connect: (x) => x, start: noop, stop: noop };
  }
  createBiquadFilter() {
    return { type: 'bandpass', frequency: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop }, Q: { value: 0 }, connect: (x) => x };
  }
  resume() {}
};

await import('../src/main.js');

assert.ok(rafQueue.length > 0, 'a frame was scheduled');
const { game } = globalThis.window.__lykt || {};
assert.ok(game, 'the game instance is exposed on window.__lykt');

let now = 0;
function frames(n) {
  for (let i = 0; i < n; i++) {
    const fn = rafQueue.shift();
    if (!fn) break;
    now += 1000 / 60;
    fn(now);
  }
}

frames(10);
const title = registry.get('screen-title');
assert.ok(title.classList.contains('is-open'), 'the title screen opens on boot');
assert.ok(game.mode === 'title', 'the game starts on the title');

// Press "start".
emit(registry.get('startBtn'), 'click');
frames(5);
assert.equal(game.mode, 'play', 'clicking start begins the run');
assert.ok(registry.get('hud').classList.contains('is-live'), 'the HUD becomes visible');
assert.equal(registry.get('hearts').children.length, game.player.maxHp, 'hearts are built for the HUD');

// Walk right for a second and make sure the player actually moves and the room draws.
const x0 = game.player.body.x;
emit(globalThis.window, 'keydown', { code: 'KeyD' });
frames(60);
emit(globalThis.window, 'keyup', { code: 'KeyD' });
assert.ok(game.player.body.x > x0 + 100, `holding D moves the player (${x0.toFixed(0)} -> ${game.player.body.x.toFixed(0)})`);

// Jump.
const y0 = game.player.body.y;
emit(globalThis.window, 'keydown', { code: 'Space' });
frames(20);
emit(globalThis.window, 'keyup', { code: 'Space' });
assert.ok(game.player.body.y < y0 - 20, 'space makes the player jump');

frames(140);

// Enter the garden and confirm a room transition works end to end.
game.loadRoom('garden', { x: 200, y: 780 });
frames(30);
assert.equal(game.roomId, 'garden');
assert.ok(registry.get('roomName').textContent.length > 0, 'the room title is filled in');

console.log('boot ok', {
  rooms: ['hub', 'garden'],
  hearts: registry.get('hearts').children.length,
  hudLive: registry.get('hud').classList.contains('is-live'),
  x: Math.round(game.player.body.x),
});
