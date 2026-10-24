// Keyboard, mouse and touch input for Den sista lågan.
// Actions: up/down/left/right, attack, shield, item, cycle, interact, dodge,
// pause, mute.

const KEY_MAP = {
  up: ['ArrowUp', 'w', 'W'],
  down: ['ArrowDown', 's', 'S'],
  left: ['ArrowLeft', 'a', 'A'],
  right: ['ArrowRight', 'd', 'D'],
  attack: ['j', 'J'],
  shield: ['k', 'K', 'Shift'],
  item: ['l', 'L'],
  cycle: ['q', 'Q', 'Tab'],
  interact: ['e', 'E', 'Enter'],
  dodge: [' ', 'Spacebar'],
  slot1: ['1'],
  slot2: ['2'],
  slot3: ['3'],
  pause: ['Escape', 'p', 'P'],
  mute: ['m', 'M'],
};

const CODE_MAP = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyJ: 'attack',
  KeyK: 'shield',
  ShiftLeft: 'shield',
  ShiftRight: 'shield',
  KeyL: 'item',
  KeyQ: 'cycle',
  Tab: 'cycle',
  KeyE: 'interact',
  Enter: 'interact',
  Space: 'dodge',
  Digit1: 'slot1',
  Numpad1: 'slot1',
  Digit2: 'slot2',
  Numpad2: 'slot2',
  Digit3: 'slot3',
  Numpad3: 'slot3',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
};

const SWEDISH_CODE = (key) => (key && key.length === 1 ? `Key${key.toUpperCase()}` : null);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.edges = new Set();
    this.stick = { active: false, x: 0, y: 0, dx: 0, dy: 0 };
    this.touchButtons = new Map();
    this.anyKey = false;
    this.onFirstInput = null;

    const down = (action) => {
      if (!action) return;
      if (!this.held.has(action)) this.edges.add(action);
      this.held.add(action);
      this.anyKey = true;
      this.onFirstInput?.();
    };
    const up = (action) => {
      if (action) this.held.delete(action);
    };

    window.addEventListener('keydown', (e) => {
      const action = CODE_MAP[e.code] || KEY_MAP[e.key]?.find(Boolean);
      const viaKey = action || this._fromKey(e.key);
      if (viaKey) {
        if (viaKey === 'cycle' || viaKey === 'dodge' || viaKey === 'pause') e.preventDefault();
        down(viaKey);
      }
    });
    window.addEventListener('keyup', (e) => {
      const action = CODE_MAP[e.code] || this._fromKey(e.key);
      if (action) up(action);
    });
    window.addEventListener('blur', () => this.clear());
    this._bindTouch();
  }

  _fromKey(key) {
    if (!key) return null;
    for (const [action, keys] of Object.entries(KEY_MAP)) {
      if (keys.includes(key)) return action;
    }
    const code = SWEDISH_CODE(key);
    if (code && CODE_MAP[code]) return CODE_MAP[code];
    return null;
  }

  _bindTouch() {
    const el = (id) => document.getElementById(id);
    const stick = el('touchStick');
    const knob = el('touchKnob');
    if (stick) {
      const radius = 52;
      let id = null;
      const move = (ev) => {
        const t = [...ev.touches].find((x) => x.identifier === id) || ev.touches[0];
        if (!t) return;
        const rect = stick.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = t.clientX - cx;
        let dy = t.clientY - cy;
        const len = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, radius / len);
        dx *= k;
        dy *= k;
        this.stick.active = true;
        this.stick.dx = dx / radius;
        this.stick.dy = dy / radius;
        if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
        ev.preventDefault();
      };
      const end = (ev) => {
        this.stick.active = false;
        this.stick.dx = 0;
        this.stick.dy = 0;
        if (knob) knob.style.transform = 'translate(0,0)';
        if (ev) ev.preventDefault();
        id = null;
      };
      stick.addEventListener('touchstart', (ev) => {
        id = ev.changedTouches[0].identifier;
        this.anyKey = true;
        this.onFirstInput?.();
        move(ev);
      }, { passive: false });
      stick.addEventListener('touchmove', move, { passive: false });
      stick.addEventListener('touchend', end, { passive: false });
      stick.addEventListener('touchcancel', end, { passive: false });
    }

    for (const btn of document.querySelectorAll('[data-touch-action]')) {
      const action = btn.dataset.touchAction;
      const press = (ev) => {
        ev.preventDefault();
        if (!this.held.has(action)) this.edges.add(action);
        this.held.add(action);
        this.anyKey = true;
        this.onFirstInput?.();
        btn.classList.add('is-down');
      };
      const release = (ev) => {
        if (ev) ev.preventDefault();
        this.held.delete(action);
        btn.classList.remove('is-down');
      };
      btn.addEventListener('touchstart', press, { passive: false });
      btn.addEventListener('touchend', release, { passive: false });
      btn.addEventListener('touchcancel', release, { passive: false });
    }
  }

  down(action) {
    return this.held.has(action);
  }

  hit(action) {
    return this.edges.has(action);
  }

  get axis() {
    let x = 0;
    let y = 0;
    if (this.down('left')) x -= 1;
    if (this.down('right')) x += 1;
    if (this.down('up')) y -= 1;
    if (this.down('down')) y += 1;
    if (this.stick.active) {
      if (Math.abs(this.stick.dx) > 0.22) x = this.stick.dx;
      if (Math.abs(this.stick.dy) > 0.22) y = this.stick.dy;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  endFrame() {
    this.edges.clear();
  }

  clear() {
    this.held.clear();
    this.edges.clear();
    this.stick.active = false;
    this.stick.dx = 0;
    this.stick.dy = 0;
  }
}
