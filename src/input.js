// Keyboard + pointer input. Keeps the game logic free of DOM details.

const BLOCKED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.pointer = { x: 0, y: 0, inside: false };
    this.mouse = { down: false, pressed: false };
    this.aimHold = false;
    this.stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    this.touchMode = false;
    this._listeners = [];

    this._on(window, 'keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    this._on(window, 'keyup', (e) => this.keys.delete(e.code));
    this._on(window, 'blur', () => {
      this.keys.clear();
      this.mouse.down = false;
      this.aimHold = false;
      this.stick.active = false;
      this.stick.dx = 0;
      this.stick.dy = 0;
    });

    this._on(canvas, 'pointerdown', (e) => this._pointerDown(e));
    this._on(canvas, 'pointermove', (e) => this._pointerMove(e));
    this._on(window, 'pointerup', (e) => this._pointerUp(e));
    this._on(window, 'pointercancel', (e) => this._pointerUp(e));
    this._on(canvas, 'contextmenu', (e) => e.preventDefault());
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn]);
  }

  _pointerDown(e) {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.inside = true;

    if (e.pointerType === 'touch') {
      this.touchMode = true;
      // Left half of the screen = movement stick, right half = aim & fire.
      if (e.clientX < window.innerWidth * 0.45 && !this.stick.active) {
        this.stick.active = true;
        this.stick.id = e.pointerId;
        this.stick.ox = e.clientX;
        this.stick.oy = e.clientY;
        this.stick.dx = 0;
        this.stick.dy = 0;
      } else {
        this.aimHold = true;
      }
      return;
    }

    this.mouse.down = e.button === 0 ? true : this.mouse.down;
    this.mouse.pressed = true;
    if (e.button === 2) this.pressed.add('MouseRight');
    else if (e.button === 0) this.pressed.add('MouseLeft');
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  _pointerMove(e) {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.inside = true;

    if (e.pointerType === 'touch' && this.stick.active && e.pointerId === this.stick.id) {
      const max = 56;
      let dx = e.clientX - this.stick.ox;
      let dy = e.clientY - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > max) {
        dx = (dx / d) * max;
        dy = (dy / d) * max;
        // Drag the base along so the stick never runs away.
        this.stick.ox = e.clientX - dx;
        this.stick.oy = e.clientY - dy;
      }
      this.stick.dx = dx / max;
      this.stick.dy = dy / max;
    }
  }

  _pointerUp(e) {
    if (e.pointerType === 'touch') {
      if (this.stick.active && e.pointerId === this.stick.id) {
        this.stick.active = false;
        this.stick.id = null;
        this.stick.dx = 0;
        this.stick.dy = 0;
      }
      this.aimHold = false;
      return;
    }
    if (e.button === 0) this.mouse.down = false;
  }

  down(code) {
    return this.keys.has(code);
  }

  /** True only on the first frame the key went down. */
  hit(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.pressed = false;
  }

  destroy() {
    for (const [target, type, fn] of this._listeners) {
      target.removeEventListener(type, fn);
    }
    this._listeners.length = 0;
  }
}
