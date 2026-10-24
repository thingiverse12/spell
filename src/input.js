// Keyboard + pointer input with per-frame edge detection.

const KEY_MAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyJ: 'attack',
  KeyK: 'parry',
  KeyL: 'item',
  KeyQ: 'lantern',
  KeyE: 'use',
  Enter: 'use',
  Space: 'use',
  Digit1: 'item1',
  Digit2: 'item2',
  Digit3: 'item3',
  Tab: 'cycle',
  KeyM: 'map',
  Escape: 'pause',
  KeyP: 'pause',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.edges = new Set();
    this.pointer = { x: 0, y: 0, down: false };
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const action = KEY_MAP[e.code];
      if (!action) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.held.has(action)) this.edges.add(action);
      this.held.add(action);
    });

    window.addEventListener('keyup', (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      // Two keys can map to one action; only release when both are up.
      const stillDown = Object.entries(KEY_MAP).some(
        ([code, a]) => a === action && code !== e.code && this.codesDown?.has(code),
      );
      if (!stillDown) this.held.delete(action);
    });

    this.codesDown = new Set();
    window.addEventListener('keydown', (e) => this.codesDown.add(e.code));
    window.addEventListener('keyup', (e) => this.codesDown.delete(e.code));

    window.addEventListener('blur', () => {
      this.held.clear();
      this.codesDown.clear();
    });
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
    if (this.held.has('left')) x -= 1;
    if (this.held.has('right')) x += 1;
    if (this.held.has('up')) y -= 1;
    if (this.held.has('down')) y += 1;
    return { x, y };
  }

  endFrame() {
    this.edges.clear();
  }

  clear() {
    this.held.clear();
    this.edges.clear();
  }
}
