// Keyboard, mouse and touch input, mapped to game actions.

const KEY_MAP = {
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  Space: 'jump',
  KeyZ: 'jump',
  KeyK: 'jump',
  KeyJ: 'attack',
  KeyX: 'attack',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyL: 'dash',
  KeyC: 'dash',
  KeyE: 'interact',
  Enter: 'interact',
  KeyF: 'focus',
  KeyQ: 'spell',
  KeyI: 'spell',
  Escape: 'pause',
  KeyR: 'restart',
  KeyM: 'mute',
};

const BLOCKED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down_ = new Set();
    this.pressed_ = new Set();
    this.stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    this.touch = false;
    this._listeners = [];

    this._on(window, 'keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      const action = KEY_MAP[e.code];
      if (!action) return;
      if (!e.repeat && !this.down_.has(action)) this.pressed_.add(action);
      this.down_.add(action);
    });
    this._on(window, 'keyup', (e) => {
      const action = KEY_MAP[e.code];
      if (action) this.down_.delete(action);
    });
    this._on(window, 'blur', () => {
      this.down_.clear();
      this.releaseStick();
    });

    this._on(canvas, 'pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.touch = true;
        if (e.clientX < window.innerWidth * 0.45 && !this.stick.active) {
          this.stick.active = true;
          this.stick.id = e.pointerId;
          this.stick.ox = e.clientX;
          this.stick.oy = e.clientY;
          this.stick.dx = 0;
          this.stick.dy = 0;
          return;
        }
      }
      if (e.button === 0) {
        this.pressed_.add('attack');
        this.down_.add('attack');
        canvas.setPointerCapture?.(e.pointerId);
      }
    });
    this._on(window, 'pointerup', (e) => {
      if (e.pointerType === 'touch' && this.stick.active && e.pointerId === this.stick.id) {
        this.releaseStick();
        return;
      }
      this.down_.delete('attack');
    });
    this._on(window, 'pointercancel', () => {
      this.releaseStick();
      this.down_.delete('attack');
    });
    this._on(canvas, 'pointermove', (e) => {
      if (!this.stick.active || e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.ox;
      let dy = e.clientY - this.stick.oy;
      const max = 60;
      const d = Math.hypot(dx, dy);
      if (d > max) {
        dx = (dx / d) * max;
        dy = (dy / d) * max;
        this.stick.ox = e.clientX - dx;
        this.stick.oy = e.clientY - dy;
      }
      this.stick.dx = dx / max;
      this.stick.dy = dy / max;
    });
  }

  _on(target, type, fn) {
    target.addEventListener(type, fn, { passive: false });
    this._listeners.push([target, type, fn]);
  }

  releaseStick() {
    this.stick.active = false;
    this.stick.id = null;
    this.stick.dx = 0;
    this.stick.dy = 0;
  }

  down(action) {
    return this.down_.has(action);
  }

  hit(action) {
    return this.pressed_.has(action);
  }

  /** -1, 0 or 1 from keyboard or the touch stick. */
  get axis() {
    let a = 0;
    if (this.down_.has('left')) a -= 1;
    if (this.down_.has('right')) a += 1;
    if (this.stick.active && Math.abs(this.stick.dx) > 0.28) a = Math.sign(this.stick.dx);
    return a;
  }

  /** Touch buttons call this. */
  virtualDown(action) {
    if (!this.down_.has(action)) this.pressed_.add(action);
    this.down_.add(action);
  }

  virtualUp(action) {
    this.down_.delete(action);
  }

  endFrame() {
    this.pressed_.clear();
  }
}
