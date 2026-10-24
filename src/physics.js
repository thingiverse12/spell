// Movement primitives: swept AABB collision, gravity, coyote time, jumping.

export const GRAVITY = 2500;
export const MAX_FALL = 1250;

export const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export class Body {
  constructor(x, y, w, h) {
    this.w = w;
    this.h = h;
    this.x = x;
    this.y = y; // top-left
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

  moveX(dx, solids) {
    if (dx === 0) return 0;
    this.x += dx;
    let hit = null;
    for (const s of solids) {
      if (!rectsOverlap(this, s)) continue;
      this.x = dx > 0 ? s.x - this.w - 0.01 : s.x + s.w + 0.01;
      this.vx = 0;
      this.hitWall = dx > 0 ? 1 : -1;
      hit = s;
    }
    return hit;
  }

  moveY(dy, solids) {
    if (dy === 0) return 0;
    this.y += dy;
    this.onGround = false;
    let hit = null;
    for (const s of solids) {
      if (!rectsOverlap(this, s)) continue;
      if (dy > 0) {
        this.y = s.y - this.h - 0.01;
        this.onGround = true;
      } else {
        this.y = s.y + s.h + 0.01;
      }
      this.vy = 0;
      hit = s;
    }
    return hit;
  }
}

export function moveBody(body, dt, solids, gravityScale = 1) {
  body.hitWall = 0;
  body.moveX(body.vx * dt, solids);
  body.moveY(body.vy * dt, solids);
  if (!body.onGround) {
    body.vy = Math.min(MAX_FALL, body.vy + GRAVITY * gravityScale * dt);
    body.coyote = Math.max(0, body.coyote - dt);
  } else {
    body.coyote = 0.1;
  }
}
