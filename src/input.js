// Keyboard, mouse and touch mapped to game actions.

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
  KeyJ: 'cast',
  KeyX: 'cast',
  KeyE: 'interact',
  Enter: 'interact',
  Escape: 'pause',
  KeyM: 'mute',
  KeyR: 'restart',
};

const BLOCKED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.edges = new Set();
    this.stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    this.touch = false;

    window.addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      const a = KEY_MAP[e.code];
      if (!a) return;
      if (!e.repeat && !this.held.has(a)) this.edges.add(a);
      this.held.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEY_MAP[e.code];
      if (a) this.held.delete(a);
    });
    window.addEventListener('blur', () => {
      this.held.clear();
      this.releaseStick();
    });

    canvas.addEventListener('pointerdown', (e) => {
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
        this.edges.add('cast');
        this.held.add('cast');
        canvas.setPointerCapture?.(e.pointerId);
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' && this.stick.active && e.pointerId === this.stick.id) {
        this.releaseStick();
        return;
      }
      this.held.delete('cast');
    });
    window.addEventListener('pointercancel', () => {
      this.releaseStick();
      this.held.delete('cast');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.stick.active || e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.ox;
      let dy = e.clientY - this.stick.oy;
      const max = 58;
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
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  releaseStick() {
    this.stick.active = false;
    this.stick.id = null;
    this.stick.dx = 0;
    this.stick.dy = 0;
  }

  down(action) {
    return this.held.has(action);
  }

  hit(action) {
    return this.edges.has(action);
  }

  get axis() {
    let a = 0;
    if (this.held.has('left')) a -= 1;
    if (this.held.has('right')) a += 1;
    if (this.stick.active && Math.abs(this.stick.dx) > 0.3) a = Math.sign(this.stick.dx);
    return a;
  }

  virtualDown(action) {
    if (!this.held.has(action)) this.edges.add(action);
    this.held.add(action);
  }

  virtualUp(action) {
    this.held.delete(action);
  }

  endFrame() {
    this.edges.clear();
  }
}
