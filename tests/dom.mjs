// A tiny DOM + canvas stub so the whole game (including main.js and the
// renderer) can run inside Node during tests.
import { createCanvas } from '@napi-rs/canvas';

class ClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...c) {
    c.forEach((x) => x && this.set.add(x));
  }
  remove(...c) {
    c.forEach((x) => this.set.delete(x));
  }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c);
    else this.set.delete(c);
    return on;
  }
  contains(c) {
    return this.set.has(c);
  }
}

class Element {
  constructor(tag = 'div', doc = null) {
    this.tagName = tag.toUpperCase();
    this.doc = doc;
    this.children = [];
    this.parent = null;
    this.classList = new ClassList(this);
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.listeners = new Map();
    this.value = '';
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((f) => f !== fn));
  }
  dispatch(type, event = {}) {
    const list = this.listeners.get(type) || [];
    for (const fn of list) fn({ type, target: this, preventDefault() {}, ...event });
  }
  click() {
    this.dispatch('click', {});
  }
  getBoundingClientRect() {
    return { width: 1280, height: 720, left: 0, top: 0, right: 1280, bottom: 720, x: 0, y: 0 };
  }
  querySelectorAll(sel) {
    const cls = sel.replace(/^\./, '');
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c.classList.contains(cls) || c.tagName === sel.toUpperCase()) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  setAttribute() {}
  getContext() {
    return null;
  }
}

/**
 * A real (napi-rs) canvas, decorated with the DOM bits the game touches.
 * It stays a genuine canvas so ctx.drawImage(canvas) works.
 */
function makeCanvas(w = 1280, h = 720) {
  const c = createCanvas(w, h);
  c.style = {};
  c.dataset = {};
  c.classList = new ClassList(c);
  c.addEventListener = () => {};
  c.removeEventListener = () => {};
  c.appendChild = () => {};
  c.getBoundingClientRect = () => ({
    width: c.width,
    height: c.height,
    left: 0,
    top: 0,
    right: c.width,
    bottom: c.height,
    x: 0,
    y: 0,
  });
  return c;
}

export function installDom({ width = 1280, height = 720 } = {}) {
  const doc = new Element('document');
  const registry = new Map();
  const IDS = [
    'game', 'hud', 'hearts', 'items', 'embers', 'embersBox', 'quest', 'zoneCard', 'zoneName', 'zoneSub',
    'toast', 'dialog', 'dialogName', 'dialogText', 'shop', 'shopList', 'shopEmbers', 'shopMsg',
    'screen-title', 'screen-pause', 'screen-dead', 'screen-win', 'pauseQuest', 'winStats',
    'btnNew', 'btnContinue', 'btnResume', 'btnRestart', 'btnRespawn', 'btnWinBack', 'btnWinNew',
    'touch', 'touchStick', 'touchKnob', 'bootError', 'bootErrorText', 'btnReload',
  ];
  for (const id of IDS) {
    const el = id === 'game' ? makeCanvas(width, height) : new Element('div', doc);
    el.id = id;
    registry.set(id, el);
    doc.appendChild(el);
  }
  const screens = ['screen-title', 'screen-pause', 'screen-dead', 'screen-win'];
  registry.get('screen-title').classList.add('is-open');
  screens.forEach((s) => (registry.get(s).classList.add('screen')));

  doc.getElementById = (id) => registry.get(id) || null;
  doc.createElement = (tag) => (tag === 'canvas' ? makeCanvas(width, height) : new Element(tag, doc));
  doc.querySelectorAll = (sel) => {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return [...registry.values()].filter((el) => el.classList.contains(cls));
    }
    if (sel === '[data-touch-action]') return [...registry.values()].filter((el) => el.dataset.touchAction);
    if (sel === '.screen') return screens.map((s) => registry.get(s));
    return [];
  };
  doc.body = new Element('body', doc);
  doc.hidden = false;
  doc.addEventListener = () => {};

  const rafQueue = [];
  globalThis.document = doc;
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    AudioContext: class {
      constructor() {
        this.currentTime = 0;
        this.sampleRate = 44100;
        this.state = 'running';
        this.destination = {};
      }
      createGain() {
        return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return this; } };
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() { return this; },
          start() {},
          stop() {},
        };
      }
      createBuffer(ch, len) {
        return { getChannelData: () => new Float32Array(len) };
      }
      createBufferSource() {
        return { buffer: null, connect() { return this; }, start() {} };
      }
      createBiquadFilter() {
        return { type: 'bandpass', frequency: { value: 0 }, Q: { value: 0 }, connect() { return this; } };
      }
      resume() {}
    },
    requestAnimationFrame: (fn) => {
      rafQueue.push(fn);
      return rafQueue.length;
    },
  };
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  try {
    globalThis.navigator = { maxTouchPoints: 0 };
  } catch {
    Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
  }
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const keyListeners = { keydown: [], keyup: [] };
  globalThis.window.addEventListener = (type, fn) => {
    (keyListeners[type] ||= []).push(fn);
  };
  return {
    document: doc,
    registry,
    rafQueue,
    press(code, key = '') {
      for (const fn of keyListeners.keydown) fn({ code, key, preventDefault() {} });
    },
    release(code, key = '') {
      for (const fn of keyListeners.keyup) fn({ code, key, preventDefault() {} });
    },
    frame(time = 16) {
      const next = rafQueue.splice(0, rafQueue.length);
      for (const fn of next) fn(time);
    },
    store,
  };
}
