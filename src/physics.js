// Movement primitives: swept AABB collision and gravity.

export const rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const rectPoint = (rect, x, y) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;

export class Body {
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.hitWall = 0;
    this.coyote = 0;
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

  moveX(dx, solids) {
    if (!dx) return;
    this.x += dx;
    for (const s of solids) {
      if (!rectsOverlap(this, s)) continue;
      this.x = dx > 0 ? s.x - this.w - 0.01 : s.x + s.w + 0.01;
      this.vx = 0;
      this.hitWall = dx > 0 ? 1 : -1;
    }
  }

  moveY(dy, solids) {
    if (!dy) return;
    this.y += dy;
    this.onGround = false;
    for (const s of solids) {
      if (!rectsOverlap(this, s)) continue;
      if (dy > 0) {
        this.y = s.y - this.h - 0.01;
        this.onGround = true;
      } else {
        this.y = s.y + s.h + 0.01;
      }
      this.vy = 0;
    }
  }
}

export function gatherSolids(list) {
  const out = [];
  for (const s of list) if (!s.open) out.push(s);
  return out;
}

// ---- ray helpers (used by the mirror puzzles and beam spells) ----

/** Distance along a ray until it enters `rect`, or Infinity. */
export function rayRect(px, py, dx, dy, rect) {
  const invX = dx === 0 ? Infinity : 1 / dx;
  const invY = dy === 0 ? Infinity : 1 / dy;
  let t1 = (rect.x - px) * invX;
  let t2 = (rect.x + rect.w - px) * invX;
  let t3 = (rect.y - py) * invY;
  let t4 = (rect.y + rect.h - py) * invY;
  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
  if (tmax < 0 || tmin > tmax) return Infinity;
  return tmin < 0 ? 0 : tmin;
}

/** Reflect a direction vector around a mirror whose surface angle is `angle`. */
export function reflect(dx, dy, angle) {
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  const dot = dx * nx + dy * ny;
  return { x: dx - 2 * dot * nx, y: dy - 2 * dot * ny };
}
