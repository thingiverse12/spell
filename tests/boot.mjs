// Boot test: loads the real src/main.js against a stub DOM, clicks the title
// screen button and drives a few frames. Catches the class of bug that once
// left the canvas black — a module that throws before the first paint.

import assert from 'node:assert/strict';

const noop = () => {};
const gradient = { addColorStop: noop };

function makeCtx(canvas) {
  const state = { canvas, globalAlpha: 1, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1 };
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

function makeCanvas(w = 1280, h = 720) {
  const canvas = {
    width: w,
    height: h,
    style: {},
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
    setPointerCapture: noop,
  };
  const ctx = makeCtx(canvas);
  canvas.getContext = () => ctx;
  return canvas;
}

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    for (const n of names) this.set.add(n);
  }
  remove(...names) {
    for (const n of names) this.set.delete(n);
  }
  contains(n) {
    return this.set.has(n);
  }
  toggle(n, force) {
    const want = force === undefined ? !this.set.has(n) : force;
    if (want) this.set.add(n);
    else this.set.delete(n);
    return want;
  }
}

class El {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.textContent = '';
    this.innerHTML = '';
    this.children = [];
    this.classList = new ClassList();
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
    this.disabled = false;
    this.offsetWidth = 100;
    this.className = '';
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  emit(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) fn({ preventDefault: noop, ...event });
  }
  querySelectorAll(sel) {
    if (sel === '.item' && this.id === 'items') return this._items || (this._items = [makeItem('torch'), makeItem('bow'), makeItem('bombs')]);
    return [];
  }
  setPointerCapture() {}
}

function makeItem(id) {
  const el = new El('button');
  el.dataset = { item: id };
  return el;
}

const registry = new Map();
function el(id) {
  if (!registry.has(id)) registry.set(id, new El('div', id));
  return registry.get(id);
}

// Pre-create the containers the UI queries.
const gameCanvas = makeCanvas(1280, 720);
gameCanvas.id = 'game';
registry.set('game', gameCanvas);
el('hearts');
el('oilPips');
el('items');
// index.html ships with the title screen open; mirror that in the stub.
el('screen-title').classList.add('is-open');

const windowListeners = new Map();
const rafQueue = [];
let now = 0;

globalThis.document = {
  getElementById: (id) => el(id),
  createElement: (tag) => (tag === 'canvas' ? makeCanvas(64, 64) : new El(tag)),
  querySelectorAll: () => [],
};
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener: (type, fn) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(fn);
  },
};
globalThis.matchMedia = () => ({ matches: false, addEventListener: noop });
globalThis.performance = { now: () => now };
globalThis.requestAnimationFrame = (fn) => {
  rafQueue.push(fn);
  return rafQueue.length;
};
globalThis.localStorage = {
  store: new Map(),
  getItem(k) {
    return this.store.has(k) ? this.store.get(k) : null;
  },
  setItem(k, v) {
    this.store.set(k, String(v));
  },
};
globalThis.AudioContext = class {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = {};
  }
  createGain() {
    return { gain: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: (n) => n };
  }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop },
      connect: (n) => n,
      start: noop,
      stop: noop,
    };
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(64) };
  }
  createBufferSource() {
    return { buffer: null, connect: (n) => n, start: noop, stop: noop };
  }
  createBiquadFilter() {
    return { type: 'bandpass', frequency: { value: 0 }, Q: { value: 0 }, connect: (n) => n };
  }
  resume() {
    return Promise.resolve();
  }
};

function frames(n) {
  for (let i = 0; i < n; i++) {
    now += 1000 / 60;
    const fn = rafQueue.shift();
    if (!fn) break;
    fn(now);
  }
}

function key(code, type = 'keydown') {
  const handlers = windowListeners.get(type) || [];
  for (const fn of handlers) fn({ code, repeat: false, preventDefault: noop });
}

await import('../src/main.js');

assert.ok(rafQueue.length > 0, 'main.js started the render loop');
assert.ok(el('screen-title').classList.contains('is-open'), 'the title screen is visible on boot');

frames(6);
assert.ok(window.__booted, 'the game reports a successful boot');

// Click "Börja vandra".
el('startBtn').emit('click');
frames(4);

assert.ok(el('hud').classList.contains('is-live'), 'the HUD becomes live after starting');
assert.equal(el('hearts').children.length, 3, 'three hearts are built');
assert.ok(el('objText').textContent.length > 0, 'the objective line is filled in');

const game = window.__laga.game;
assert.equal(game.mode, 'play', 'the game is playable');
const x0 = game.player.x;

key('KeyD');
frames(45);
key('KeyD', 'keyup');
frames(4);
assert.ok(game.player.x > x0 + 60, `holding D walks the player (${x0} -> ${game.player.x})`);

// The canvas is actually sized for the viewport.
const canvas = document.getElementById('game');
assert.ok(canvas.width > 0 && canvas.height > 0, 'the canvas is sized');
assert.ok(game.enemies.length > 0, 'enemies exist in the world');

// Open the map and close it again.
key('KeyM');
key('KeyM', 'keyup');
frames(2);
assert.ok(game.mapOpen, 'M opens the map');
key('KeyM');
key('KeyM', 'keyup');
frames(2);
assert.ok(!game.mapOpen, 'M closes the map');

console.log('boot ok', {
  mode: game.mode,
  hearts: el('hearts').children.length,
  x: Math.round(game.player.x),
  zone: game.zone.name,
});
