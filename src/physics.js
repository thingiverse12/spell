// Top-down movement primitives: rectangle bodies, sliding collisions and a few
// geometry helpers used by combat, sight and light.

export const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const rectPoint = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

/** Shortest distance from point to a rect (0 when inside). */
export function distToRect(x, y, r) {
  const nx = clamp(x, r.x, r.x + r.w);
  const ny = clamp(y, r.y, r.y + r.h);
  return Math.hypot(x - nx, y - ny);
}

export function circleRect(x, y, radius, r) {
  const nx = clamp(x, r.x, r.x + r.w);
  const ny = clamp(y, r.y, r.y + r.h);
  return (x - nx) ** 2 + (y - ny) ** 2 <= radius * radius;
}

/** Angle difference in radians, wrapped to [-PI, PI]. */
export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Body {
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.vx = 0;
    this.vy = 0;
  }

  get cx() {
    return this.x + this.w / 2;
  }

  get cy() {
    return this.y + this.h / 2;
  }

  get bottom() {
    return this.y + this.h;
  }

  rect() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  /** Moves along one axis, stopping flush against any solid. */
  moveX(dx, solids) {
    if (!dx) return 0;
    const before = this.x;
    this.x += dx;
    for (const s of solids) {
      if (!rectsOverlap(this, s)) continue;
      this.x = dx > 0 ? s.x - this.w : s.x + s.w;
      this.vx = 0;
    }
    return this.x - before;
  }

  moveY(dy, solids) {
    if (!dy) return 0;
    const before = this.y;
    this.y += dy;
    for (const s of solids) {
      if (!rectsOverlap(this, s)) continue;
      this.y = dy > 0 ? s.y - this.h : s.y + s.h;
      this.vy = 0;
    }
    return this.y - before;
  }

  move(dx, dy, solids) {
    this.moveX(dx, solids);
    this.moveY(dy, solids);
  }
}

/** Deterministic pseudo random, so painted scenery looks the same every load. */
export function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
