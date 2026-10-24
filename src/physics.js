// Top-down movement helpers: axis-separated AABB collision with sliding.

export const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const rectPoint = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Shortest signed angle difference, in radians. */
export const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function circleRect(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

export function pointInArc(px, py, ox, oy, angle, half, radius) {
  const dx = px - ox;
  const dy = py - oy;
  const d = Math.hypot(dx, dy);
  if (d > radius) return false;
  if (d < 10) return true;
  return Math.abs(angleDiff(Math.atan2(dy, dx), angle)) <= half;
}

/**
 * A box that knows how to walk around obstacles. No gravity — this is a
 * top-down game, so movement is free in both axes.
 */
export class Body {
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.vx = 0;
    this.vy = 0;
    this.hitWall = false;
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

  /** Move and slide along whatever is solid. Returns true if blocked. */
  move(dx, dy, solids) {
    this.hitWall = false;
    if (dx) {
      this.x += dx;
      for (const s of solids) {
        if (!rectsOverlap(this, s)) continue;
        this.x = dx > 0 ? s.x - this.w : s.x + s.w;
        this.hitWall = true;
      }
    }
    if (dy) {
      this.y += dy;
      for (const s of solids) {
        if (!rectsOverlap(this, s)) continue;
        this.y = dy > 0 ? s.y - this.h : s.y + s.h;
        this.hitWall = true;
      }
    }
    return this.hitWall;
  }

  /** Blocked check without moving. */
  blockedAt(dx, dy, solids) {
    const probe = { x: this.x + dx, y: this.y + dy, w: this.w, h: this.h };
    return solids.some((s) => rectsOverlap(probe, s));
  }
}
