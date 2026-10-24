// Painterly top-down renderer. Everything is drawn with canvas paths and
// gradients — no image assets, so the whole game stays text.

import { TAU } from './world.js';
import {
  BRAZIERS,
  CHESTS,
  DECOR,
  DUNGEON_ENTRANCE,
  FOG_SPOTS,
  HOUSES,
  NPCS,
  PATHS,
  POTS,
  PROPS,
  ROCKS,
  SIGNS,
  TREES,
  VILLAGE_FIRE,
  WATER,
  WELLS,
  WORLD_H,
  WORLD_W,
  ZONES,
} from './world.js';
import { clamp, lerp } from './physics.js';

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

const rgba = (hex, a) => {
  if (hex.startsWith('rgb')) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function draw(g) {
  const ctx = g.ctx;
  const dpr = g.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, g.w, g.h);

  const shake = g.shake * g.shake * 9;
  const camX = Math.round(g.camera.x + (Math.random() - 0.5) * shake);
  const camY = Math.round(g.camera.y + (Math.random() - 0.5) * shake);
  const z = g.camera.zoom;

  ctx.fillStyle = '#070a0c';
  ctx.fillRect(0, 0, g.w, g.h);

  ctx.save();
  ctx.scale(z, z);
  ctx.translate(-camX, -camY);

  const view = {
    x: camX - 80,
    y: camY - 80,
    w: g.viewW + 160,
    h: g.viewH + 160,
  };
  const visible = (x, y, pad = 0) =>
    x > view.x - pad && x < view.x + view.w + pad && y > view.y - pad && y < view.y + view.h + pad;

  if (g.scene === 'overworld') drawOverworld(g, ctx, view, visible);
  else drawDungeon(g, ctx, view, visible);

  drawSprites(g, ctx, visible);
  drawProjectiles(g, ctx);
  drawParticles(g, ctx);
  ctx.restore();

  drawLight(g, ctx, camX, camY, z);
  drawFloaters(g, ctx, camX, camY, z);
  drawScreenFx(g, ctx);
  if (g.mapOpen) drawMap(g, ctx);
}

/* ------------------------------------------------------------------ world */

function drawOverworld(g, ctx, view, visible) {
  const t = g.time;
  // Base ground.
  const base = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  base.addColorStop(0, '#1e2620');
  base.addColorStop(0.5, '#22302a');
  base.addColorStop(1, '#1a2420');
  ctx.fillStyle = base;
  ctx.fillRect(view.x, view.y, view.w, view.h);

  // Zone patches, soft edged.
  for (const zone of ZONES) {
    const r = zone.rect;
    if (r.x > view.x + view.w || r.x + r.w < view.x || r.y > view.y + view.h || r.y + r.h < view.y) continue;
    const grd = ctx.createRadialGradient(
      r.x + r.w / 2,
      r.y + r.h / 2,
      Math.min(r.w, r.h) * 0.25,
      r.x + r.w / 2,
      r.y + r.h / 2,
      Math.max(r.w, r.h) * 0.62,
    );
    grd.addColorStop(0, zone.ground);
    grd.addColorStop(0.7, zone.ground2);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(r.x - 120, r.y - 120, r.w + 240, r.h + 240);
  }

  // Soft light pools on the ground (moon through the canopy).
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const x = 400 + i * 420;
    const y = 500 + ((i * 733) % 1500);
    if (!visible(x, y, 320)) continue;
    const gr = ctx.createRadialGradient(x, y, 20, x, y, 300);
    gr.addColorStop(0, 'rgba(180, 220, 200, 0.045)');
    gr.addColorStop(1, 'rgba(180, 220, 200, 0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(x, y, 300, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Paths.
  for (const p of PATHS) {
    if (!visible(p.x + p.w / 2, p.y + p.h / 2, Math.max(p.w, p.h))) continue;
    ctx.fillStyle = 'rgba(58, 52, 38, 0.55)';
    rr(ctx, p.x, p.y, p.w, p.h, 26);
    ctx.fill();
    ctx.fillStyle = 'rgba(92, 80, 56, 0.16)';
    rr(ctx, p.x + 8, p.y + 6, Math.max(0, p.w - 16), Math.max(0, p.h - 12), 20);
    ctx.fill();
  }

  drawWater(ctx, t);
  drawDecor(ctx, visible, t);

  // Props on the ground that aren't depth sorted.
  for (const s of SIGNS) {
    if (!visible(s.x, s.y)) continue;
    drawSign(ctx, s);
  }
  for (const w of WELLS) if (visible(w.x, w.y, 80)) drawWell(ctx, w, g);
  for (const p of POTS) if (visible(p.x, p.y) && !g.flags.pots[`${p.x}-${p.y}`]) drawPot(ctx, p);

  drawProps(ctx, visible, t, g);
  drawVillageFire(ctx, g, t);
  drawEntrance(ctx, g, t);
}

function drawWater(ctx, t) {
  for (const w of WATER) {
    const grd = ctx.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
    grd.addColorStop(0, '#173330');
    grd.addColorStop(0.5, '#12302f');
    grd.addColorStop(1, '#0d2422');
    ctx.fillStyle = grd;
    rr(ctx, w.x, w.y, w.w, w.h, 60);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 190, 180, 0.16)';
    ctx.lineWidth = 3;
    rr(ctx, w.x + 2, w.y + 2, w.w - 4, w.h - 4, 58);
    ctx.stroke();
    // ripples
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const yy = w.y + 24 + ((i * 37 + Math.sin(t * 0.6 + i) * 6) % (w.h - 40));
      ctx.strokeStyle = 'rgba(150, 220, 210, 0.09)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(w.x + 18, yy);
      ctx.bezierCurveTo(
        w.x + w.w * 0.35,
        yy - 5,
        w.x + w.w * 0.65,
        yy + 5,
        w.x + w.w - 18,
        yy,
      );
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawDecor(ctx, visible, t) {
  for (const d of DECOR) {
    if (!visible(d.x, d.y, 20)) continue;
    if (d.zone === 'village' && d.kind === 'grass') continue;
    const sway = Math.sin(t * 0.8 + d.rot) * 1.6;
    if (d.kind === 'grass') {
      ctx.strokeStyle = d.zone === 'marsh' ? 'rgba(110, 160, 130, 0.35)' : 'rgba(96, 140, 96, 0.32)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(d.x + i * 3, d.y);
        ctx.quadraticCurveTo(d.x + i * 3 + sway, d.y - 8 * d.s, d.x + i * 3 + sway * 1.6, d.y - 14 * d.s);
      }
      ctx.stroke();
    } else if (d.kind === 'flower') {
      ctx.fillStyle = d.zone === 'marsh' ? 'rgba(190, 170, 230, 0.4)' : 'rgba(230, 210, 140, 0.4)';
      ctx.beginPath();
      ctx.arc(d.x, d.y - 4, 2.2 * d.s, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90, 130, 90, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x, d.y - 5 * d.s);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(120, 130, 130, 0.16)';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 3 * d.s, 2 * d.s, d.rot, 0, TAU);
      ctx.fill();
    }
  }
}

function drawProps(ctx, visible, t, g) {
  for (const p of PROPS) {
    const cx = p.x + (p.w || 0) / 2;
    const cy = p.y + (p.h || 0) / 2;
    if (!visible(cx, cy, 160)) continue;
    if (p.kind === 'fence') drawFence(ctx, p);
    else if (p.kind === 'garden') drawGarden(ctx, p, t);
    else if (p.kind === 'stall') drawStall(ctx, p, g);
    else if (p.kind === 'post') drawPost(ctx, p, g);
    else if (p.kind === 'woodpile') drawWoodpile(ctx, p);
    else if (p.kind === 'barrels') drawBarrels(ctx, p);
  }
}

function drawFence(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  const n = Math.max(2, Math.round(p.w / 26));
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(p.w / 2, 6, p.w / 2, 5, 0, 0, TAU);
  ctx.fill();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * p.w;
    ctx.fillStyle = i % 2 ? '#4a3b2a' : '#54432f';
    ctx.fillRect(x - 3, -22, 6, 26);
    ctx.fillStyle = 'rgba(120, 96, 64, 0.4)';
    ctx.fillRect(x - 3, -22, 2, 26);
  }
  ctx.fillStyle = '#3f3223';
  ctx.fillRect(0, -16, p.w, 4);
  ctx.fillRect(0, -8, p.w, 4);
  ctx.restore();
}

function drawGarden(ctx, p, t) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = '#3b2f20';
  rr(ctx, 0, 0, p.w, p.h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 150, 100, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const x = 12 + (i % 6) * ((p.w - 24) / 5);
    const y = 20 + Math.floor(i / 6) * 28;
    ctx.strokeStyle = 'rgba(140, 180, 120, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 12);
    ctx.quadraticCurveTo(x + Math.sin(t + i) * 3, y - 2, x + Math.sin(t + i) * 5, y - 10);
    ctx.stroke();
    ctx.fillStyle = 'rgba(150, 200, 130, 0.6)';
    ctx.beginPath();
    ctx.ellipse(x - 3, y + 2, 3.4, 2, -0.5, 0, TAU);
    ctx.ellipse(x + 3, y - 4, 3.4, 2, 0.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawStall(ctx, p, g) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(p.w / 2, p.h + 8, p.w * 0.55, 8, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(6, p.h - 6, 6, -30);
  ctx.fillRect(p.w - 12, p.h - 6, 6, -30);
  ctx.fillStyle = '#5b4632';
  rr(ctx, 0, p.h - 12, p.w, 14, 3);
  ctx.fill();
  // striped awning
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#8a4a3c' : '#c9a870';
    ctx.fillRect((i * p.w) / 6, p.h - 46, p.w / 6, 18);
  }
  ctx.fillStyle = '#3b2c1e';
  ctx.fillRect(0, p.h - 30, p.w, 4);
  // goods
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = ['#7d8f4a', '#b06a4a', '#c9c07a', '#6a8f9e'][i];
    ctx.beginPath();
    ctx.arc(16 + i * 24, p.h - 16, 5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawPost(ctx, p, g) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 6, 10, 4, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#3a3227';
  ctx.fillRect(-3, -54, 6, 60);
  ctx.fillStyle = '#241d16';
  rr(ctx, -11, -70, 22, 22, 4);
  ctx.fill();
  const pulse = 0.7 + 0.3 * Math.sin(g.time * 2 + p.x);
  ctx.fillStyle = `rgba(255, 206, 130, ${pulse})`;
  rr(ctx, -7.5, -66.5, 15, 15, 2);
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gl = ctx.createRadialGradient(0, -58, 2, 0, -58, 58);
  gl.addColorStop(0, `rgba(255, 200, 120, ${0.16 * pulse})`);
  gl.addColorStop(1, 'rgba(255, 200, 120, 0)');
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(0, -58, 58, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawWoodpile(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const x = i * 16 + row * 8;
      const y = -row * 13;
      ctx.fillStyle = '#4a3826';
      ctx.beginPath();
      ctx.ellipse(x, y, 9, 7, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#241a11';
      ctx.beginPath();
      ctx.ellipse(x, y, 5, 4, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(150, 120, 80, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBarrels(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  for (let i = 0; i < 2; i++) {
    const x = i * 26;
    const y = -i * 4;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(x, 6 + y, 13, 5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#4a3a28';
    rr(ctx, x - 11, y - 26, 22, 30, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160, 140, 100, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 11, y - 16);
    ctx.lineTo(x + 11, y - 16);
    ctx.moveTo(x - 11, y - 4);
    ctx.lineTo(x + 11, y - 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSign(ctx, s) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 10, 14, 5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#3b3327';
  ctx.fillRect(-3, -18, 6, 28);
  ctx.fillStyle = '#4a3f2e';
  rr(ctx, -22, -34, 44, 22, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 180, 140, 0.3)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(210, 190, 150, 0.35)';
  ctx.beginPath();
  ctx.moveTo(-14, -27);
  ctx.lineTo(14, -27);
  ctx.moveTo(-14, -21);
  ctx.lineTo(6, -21);
  ctx.stroke();
  ctx.restore();
}

function drawWell(ctx, w, g) {
  ctx.save();
  ctx.translate(w.x, w.y);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 14, 34, 12, 0, 0, TAU);
  ctx.fill();
  const grd = ctx.createLinearGradient(0, -20, 0, 20);
  grd.addColorStop(0, '#5a5750');
  grd.addColorStop(1, '#33322e');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 20, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0d1a1c';
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 12, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#4a463c';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-26, -8);
  ctx.lineTo(-26, -44);
  ctx.moveTo(26, -8);
  ctx.lineTo(26, -44);
  ctx.stroke();
  ctx.fillStyle = '#3c3a30';
  rr(ctx, -30, -52, 60, 10, 3);
  ctx.fill();
  ctx.restore();
}

function drawPot(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 6, 10, 4, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#4d4034';
  ctx.beginPath();
  ctx.ellipse(0, -2, 9, 11, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(220, 190, 150, 0.18)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, -2, 7, 0.6, 2.4);
  ctx.stroke();
  ctx.restore();
}

function drawVillageFire(ctx, g, t) {
  const f = VILLAGE_FIRE;
  const lit = g.flags.fireLit;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 46, 16, 0, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const x = Math.cos(a) * 32;
    const y = Math.sin(a) * 16;
    ctx.fillStyle = i % 2 ? '#4a4640' : '#3c3934';
    ctx.beginPath();
    ctx.ellipse(x, y + 4, 9, 6, a, 0, TAU);
    ctx.fill();
  }
  if (lit) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const w = 10 + Math.sin(t * 7 + i) * 3;
      const h = 40 + i * 12 + Math.sin(t * 5 + i * 1.7) * 8;
      const grd = ctx.createLinearGradient(0, 0, 0, -h);
      grd.addColorStop(0, 'rgba(255, 170, 60, 0.85)');
      grd.addColorStop(0.6, 'rgba(255, 220, 130, 0.6)');
      grd.addColorStop(1, 'rgba(255, 255, 220, 0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(-w, 2);
      ctx.quadraticCurveTo(-w * 0.3, -h * 0.6, Math.sin(t * 2 + i) * 5, -h);
      ctx.quadraticCurveTo(w * 0.3, -h * 0.6, w, 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else {
    ctx.fillStyle = '#1a1a18';
    ctx.beginPath();
    ctx.ellipse(0, 0, 24, 10, 0, 0, TAU);
    ctx.fill();
    // embers, still faintly warm
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const a = t * 0.6 + i;
      const x = Math.cos(a * 1.3) * (10 + i * 3);
      const y = Math.sin(a) * 4 - 6 - (i % 3) * 4;
      ctx.fillStyle = `rgba(255, 150, 80, ${0.6 + 0.4 * Math.sin(t * 3 + i)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawEntrance(ctx, g, t) {
  const e = DUNGEON_ENTRANCE;
  const open = g.ringLit();
  ctx.save();
  ctx.translate(e.x + e.w / 2, e.y + e.h);
  // Stone doorway set into a mound.
  const grd = ctx.createLinearGradient(0, -160, 0, 20);
  grd.addColorStop(0, '#3a3c40');
  grd.addColorStop(1, '#1b1d22');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(-150, 30);
  ctx.quadraticCurveTo(-120, -150, 0, -170);
  ctx.quadraticCurveTo(120, -150, 150, 30);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = open ? '#08090c' : '#191b20';
  ctx.beginPath();
  ctx.moveTo(-42, 26);
  ctx.lineTo(-42, -48);
  ctx.quadraticCurveTo(0, -94, 42, -48);
  ctx.lineTo(42, 26);
  ctx.closePath();
  ctx.fill();

  if (!open) {
    // Sealed with iron and old runes.
    ctx.fillStyle = '#2e3238';
    rr(ctx, -44, -60, 88, 88, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 150, 110, 0.35)';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-40, -50 + i * 18);
      ctx.lineTo(40, -50 + i * 18);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120, 200, 220, 0.3)';
    ctx.beginPath();
    ctx.arc(0, -18, 16 + Math.sin(t * 1.6) * 1.5, 0, TAU);
    ctx.stroke();
  } else {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, -24, 4, 0, -24, 90);
    glow.addColorStop(0, 'rgba(255, 200, 140, 0.25)');
    glow.addColorStop(1, 'rgba(255, 200, 140, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -24, 90, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/* ----------------------------------------------------------------- dungeon */

function drawDungeon(g, ctx, view, visible) {
  const f = g.sceneDef;
  const t = g.time;
  ctx.fillStyle = '#0a0b0e';
  ctx.fillRect(view.x, view.y, view.w, view.h);

  // Floor slabs.
  for (let y = 0; y < f.h; y += 96) {
    for (let x = 0; x < f.w; x += 96) {
      if (!visible(x + 48, y + 48, 60)) continue;
      const v = ((x * 7 + y * 13) % 5) / 5;
      ctx.fillStyle = `rgb(${38 + v * 10}, ${40 + v * 11}, ${46 + v * 12})`;
      ctx.fillRect(x + 1, y + 1, 94, 94);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, 94, 94);
    }
  }

  // Walls.
  for (const s of f.solids) {
    if (!visible(s.x + s.w / 2, s.y + s.h / 2, 80)) continue;
    const destroyed = s.cracked && g.flags.cracked[g.wallId(s)];
    if (destroyed) continue;
    const grd = ctx.createLinearGradient(s.x, s.y, s.x, s.y + Math.min(s.h, 80));
    grd.addColorStop(0, '#4b4f58');
    grd.addColorStop(0.25, '#33363d');
    grd.addColorStop(1, '#1d1f24');
    ctx.fillStyle = grd;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    // drop shadow so walls read as tall in a top-down view
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const sh = ctx.createLinearGradient(s.x, s.y + s.h, s.x, s.y + s.h + 26);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(s.x, s.y + s.h, s.w, 26);
    ctx.restore();
    ctx.strokeStyle = 'rgba(120, 130, 145, 0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
    // brick lines
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    for (let y = s.y + 28; y < s.y + s.h - 4; y += 28) {
      ctx.beginPath();
      ctx.moveTo(s.x + 2, y);
      ctx.lineTo(s.x + s.w - 2, y);
      ctx.stroke();
    }
    if (s.cracked) {
      ctx.strokeStyle = 'rgba(255, 180, 120, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x + 8, s.y + 20);
      ctx.lineTo(s.x + s.w - 10, s.y + 60);
      ctx.moveTo(s.x + s.w - 14, s.y + 20);
      ctx.lineTo(s.x + 12, s.y + 86);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 170, 100, ${0.1 + 0.06 * Math.sin(t * 3)})`;
      ctx.fillRect(s.x, s.y, s.w, s.h);
    }
  }

  // Gate.
  if (f.gate && !g.gateOpen()) {
    const gate = f.gate;
    ctx.fillStyle = '#2a2c33';
    ctx.fillRect(gate.x, gate.y, gate.w, gate.h);
    ctx.strokeStyle = 'rgba(200, 160, 110, 0.45)';
    ctx.lineWidth = 3;
    for (let y = gate.y + 8; y < gate.y + gate.h; y += 26) {
      ctx.beginPath();
      ctx.moveTo(gate.x + 4, y);
      ctx.lineTo(gate.x + gate.w - 4, y + 10);
      ctx.stroke();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255, 210, 150, ${0.3 + 0.2 * Math.sin(t * 2.4)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gate.x + gate.w / 2, gate.y + gate.h * 0.5, 18, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // Arrow switch.
  if (f.switch && !g.flags.switchOn) {
    const s = f.switch;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = '#1a1c22';
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(150, 230, 255, ${0.5 + 0.3 * Math.sin(t * 3)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = `rgba(170, 235, 255, ${0.6 + 0.3 * Math.sin(t * 3)})`;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // Stairs down.
  if (f.stairs) {
    const s = f.stairs;
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(s.x, s.y, s.w, s.h + 10);
    ctx.strokeStyle = 'rgba(150, 170, 200, 0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(s.x + 4 + i * 2, s.y + 12 + i * 14);
      ctx.lineTo(s.x + s.w - 4 - i * 2, s.y + 12 + i * 14);
      ctx.stroke();
    }
  }

  // Way back up.
  if (g.floor > 0) {
    const up = g.upStairs();
    ctx.fillStyle = '#14161b';
    rr(ctx, up.x - 40, up.y - 30, 80, 56, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190, 200, 220, 0.25)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(220, 230, 245, 0.5)';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('UPP', up.x, up.y + 2);
    ctx.textAlign = 'left';
  }

  // Braziers inside.
  for (const b of f.braziers || []) drawBrazier(ctx, b, !!g.flags.braziers[b.id], t, g);
}

/* ----------------------------------------------------------------- sprites */

function drawSprites(g, ctx, visible) {
  const list = [];
  const pushing = (o) => list.push(o);

  if (g.scene === 'overworld') {
    for (const t of TREES) if (visible(t.x, t.y, 90)) pushing({ y: t.y, kind: 'tree', t });
    for (const h of HOUSES) if (visible(h.x + h.w / 2, h.y + h.h / 2, 260)) pushing({ y: h.y + h.h, kind: 'house', h });
    for (const r of ROCKS) if (visible(r.x, r.y, 80)) pushing({ y: r.y, kind: 'rock', r });
    for (const b of BRAZIERS) if (visible(b.x, b.y, 90)) pushing({ y: b.y, kind: 'brazier', b });
    for (const c of CHESTS) {
      if (g.flags.chests[c.id] || !visible(c.x, c.y, 60)) continue;
      pushing({ y: c.y, kind: 'chest', c });
    }
    for (const n of NPCS) if (visible(n.x, n.y, 80)) pushing({ y: n.y, kind: 'npc', n });
  } else {
    for (const b of g.sceneDef.braziers || []) if (visible(b.x, b.y, 90)) pushing({ y: b.y, kind: 'brazier', b });
  }

  for (const e of g.enemies) if (visible(e.x, e.y, 70)) pushing({ y: e.y, kind: 'enemy', e });
  if (g.boss && !g.boss.dead) pushing({ y: g.boss.y, kind: 'boss', e: g.boss });
  for (const l of g.lanterns) pushing({ y: l.y, kind: 'lantern', l });
  pushing({ y: g.player.y, kind: 'player' });

  list.sort((a, b) => a.y - b.y);

  for (const item of list) {
    if (item.kind === 'tree') drawTree(ctx, item.t, g.time);
    else if (item.kind === 'house') drawHouse(ctx, item.h, g);
    else if (item.kind === 'rock') drawRock(ctx, item.r);
    else if (item.kind === 'brazier') drawBrazier(ctx, item.b, !!g.flags.braziers[item.b.id], g.time, g);
    else if (item.kind === 'chest') drawChest(ctx, item.c, g.time);
    else if (item.kind === 'npc') drawNpc(ctx, item.n, g);
    else if (item.kind === 'enemy') drawEnemy(ctx, item.e, g);
    else if (item.kind === 'boss') drawBoss(ctx, item.e, g);
    else if (item.kind === 'lantern') drawLantern(ctx, item.l, g);
    else drawPlayer(ctx, g);
  }
}

function drawTree(ctx, t, time) {
  const sway = Math.sin(time * 0.42 + t.seed * 11) * (2 + t.r * 0.05);
  const cy = t.y - t.r * 1.2;

  // soft ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(t.x + t.r * 0.22, t.y + 5, t.r * 0.85, t.r * 0.3, 0, 0, TAU);
  ctx.fill();

  if (t.dead) {
    ctx.strokeStyle = '#2a2926';
    ctx.lineWidth = Math.max(3, t.r * 0.14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(t.x + sway * 0.5, t.y - t.r * 1.7);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.55;
      const len = t.r * (0.5 + (i % 3) * 0.28);
      ctx.moveTo(t.x + sway * 0.4, t.y - t.r * (0.7 + i * 0.14));
      ctx.lineTo(
        t.x + sway * 0.4 + Math.cos(a) * len,
        t.y - t.r * (0.7 + i * 0.14) + Math.sin(a) * len * 0.8,
      );
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    return;
  }

  // trunk with a slight bend
  ctx.beginPath();
  ctx.moveTo(t.x - t.r * 0.15, t.y);
  ctx.quadraticCurveTo(t.x - t.r * 0.1 + sway * 0.4, t.y - t.r * 0.6, t.x - t.r * 0.06 + sway, t.y - t.r * 1.1);
  ctx.lineTo(t.x + t.r * 0.07 + sway, t.y - t.r * 1.1);
  ctx.quadraticCurveTo(t.x + t.r * 0.1, t.y - t.r * 0.6, t.x + t.r * 0.15, t.y);
  ctx.closePath();
  ctx.fillStyle = '#2a241c';
  ctx.fill();

  // canopy: a cluster of soft masses, darkest underneath
  const seed = t.seed;
  const layers = [
    { dy: 0.34, s: 1.06, c: '#16281f', sp: 0.62 },
    { dy: 0.0, s: 0.94, c: '#1d3328', sp: 0.7 },
    { dy: -0.3, s: 0.74, c: '#274234', sp: 0.55 },
    { dy: -0.52, s: 0.46, c: '#33543f', sp: 0.4 },
  ];
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    for (let i = 0; i < 5; i++) {
      const a = seed * 31 + i * 1.7 + li * 2.1;
      const rad = t.r * L.s * (0.55 + ((Math.sin(a) + 1) / 2) * 0.45);
      const x = t.x + Math.cos(a) * t.r * L.sp * 0.8 + sway * (0.4 + li * 0.2);
      const y = cy + L.dy * t.r + Math.sin(a * 1.3) * t.r * L.sp * 0.5;
      ctx.fillStyle = L.c;
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * 0.92, 0, 0, TAU);
      ctx.fill();
    }
  }
  // moonlight rim on the upper left
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const rim = ctx.createRadialGradient(
    t.x - t.r * 0.4 + sway,
    cy - t.r * 0.55,
    t.r * 0.1,
    t.x - t.r * 0.4 + sway,
    cy - t.r * 0.55,
    t.r * 1.1,
  );
  rim.addColorStop(0, 'rgba(150, 200, 170, 0.14)');
  rim.addColorStop(1, 'rgba(150, 200, 170, 0)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(t.x - t.r * 0.4 + sway, cy - t.r * 0.55, t.r * 1.1, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawRock(ctx, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(r.x + 6, r.y + r.r * 0.42, r.r * 0.98, r.r * 0.4, 0, 0, TAU);
  ctx.fill();
  const g = ctx.createLinearGradient(r.x - r.r, r.y - r.r, r.x + r.r, r.y + r.r);
  g.addColorStop(0, '#4e535c');
  g.addColorStop(0.5, '#3a3e46');
  g.addColorStop(1, '#22252b');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(r.x - r.r, r.y + r.r * 0.25);
  ctx.lineTo(r.x - r.r * 0.6, r.y - r.r * 0.65);
  ctx.lineTo(r.x + r.r * 0.2, r.y - r.r * 0.95);
  ctx.lineTo(r.x + r.r * 0.9, r.y - r.r * 0.25);
  ctx.lineTo(r.x + r.r * 0.7, r.y + r.r * 0.45);
  ctx.lineTo(r.x - r.r * 0.3, r.y + r.r * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(150, 170, 160, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawHouse(ctx, h, g) {
  // warm light spilling from the windows onto the street
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pool = ctx.createRadialGradient(h.x + h.w * 0.5 + 54, h.y + h.h + 20, 10, h.x + h.w * 0.5 + 54, h.y + h.h + 20, 180);
  pool.addColorStop(0, 'rgba(255, 190, 110, 0.10)');
  pool.addColorStop(1, 'rgba(255, 190, 110, 0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.ellipse(h.x + h.w * 0.5 + 54, h.y + h.h + 26, 190, 90, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(h.x + h.w / 2 + 10, h.y + h.h - 6, h.w * 0.55, 20, 0, 0, TAU);
  ctx.fill();

  // wall
  const wg = ctx.createLinearGradient(h.x, h.y, h.x, h.y + h.h);
  wg.addColorStop(0, h.wall);
  wg.addColorStop(1, '#2a231c');
  ctx.fillStyle = wg;
  ctx.fillRect(h.x, h.y + 26, h.w, h.h - 26);
  // timber
  ctx.strokeStyle = 'rgba(24, 18, 14, 0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(h.x + 10, h.y + h.h - 8);
  ctx.lineTo(h.x + 10, h.y + 34);
  ctx.moveTo(h.x + h.w - 10, h.y + h.h - 8);
  ctx.lineTo(h.x + h.w - 10, h.y + 34);
  ctx.moveTo(h.x + 6, h.y + h.h * 0.55);
  ctx.lineTo(h.x + h.w - 6, h.y + h.h * 0.55);
  ctx.stroke();

  // roof
  const rg = ctx.createLinearGradient(h.x, h.y - 20, h.x, h.y + 44);
  rg.addColorStop(0, h.roof);
  rg.addColorStop(1, 'rgba(20, 16, 16, 0.95)');
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.moveTo(h.x - 16, h.y + 34);
  ctx.lineTo(h.x + h.w * 0.5, h.y - 34);
  ctx.lineTo(h.x + h.w + 16, h.y + 34);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.6;
  for (let i = 1; i < 6; i++) {
    const k = i / 6;
    ctx.beginPath();
    ctx.moveTo(lerp(h.x - 16, h.x + h.w * 0.5, k), lerp(h.y + 34, h.y - 34, k));
    ctx.lineTo(lerp(h.x + h.w + 16, h.x + h.w * 0.5, k), lerp(h.y + 34, h.y - 34, k));
    ctx.stroke();
  }

  // door
  const d = h.door;
  ctx.fillStyle = '#150f0c';
  rr(ctx, d.x - 18, d.y - 44, 36, 44, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(190, 160, 120, 0.3)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = '#c9a870';
  ctx.beginPath();
  ctx.arc(d.x + 11, d.y - 20, 2.2, 0, TAU);
  ctx.fill();

  // window with warm light
  const wx = h.x + h.w * 0.5 + 54;
  const wy = h.y + 58;
  ctx.fillStyle = '#101010';
  ctx.fillRect(wx, wy, 30, 26);
  const wink = 0.55 + 0.2 * Math.sin(g.time * 2 + h.x);
  ctx.fillStyle = `rgba(255, 200, 120, ${0.75 * wink})`;
  ctx.fillRect(wx + 3, wy + 3, 24, 20);
  ctx.strokeStyle = 'rgba(20, 14, 10, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(wx + 15, wy + 3);
  ctx.lineTo(wx + 15, wy + 23);
  ctx.moveTo(wx + 3, wy + 13);
  ctx.lineTo(wx + 27, wy + 13);
  ctx.stroke();
}

function drawChest(ctx, c, time) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 8, 20, 7, 0, 0, TAU);
  ctx.fill();
  const bob = Math.sin(time * 2 + c.x) * 1.6;
  ctx.fillStyle = '#4a3520';
  rr(ctx, -18, -18 + bob, 36, 24, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(230, 190, 110, 0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-18, -8 + bob);
  ctx.lineTo(18, -8 + bob);
  ctx.stroke();
  ctx.fillStyle = '#e6c073';
  ctx.fillRect(-4, -10 + bob, 8, 8);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 44);
  gl.addColorStop(0, 'rgba(255, 214, 140, 0.22)');
  gl.addColorStop(1, 'rgba(255, 214, 140, 0)');
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(0, 0, 44, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawBrazier(ctx, b, lit, time, g) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 10, 24, 8, 0, 0, TAU);
  ctx.fill();
  // stone base
  ctx.fillStyle = '#3c3f45';
  ctx.beginPath();
  ctx.ellipse(0, 6, 20, 8, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2a2d33';
  rr(ctx, -9, -18, 18, 26, 3);
  ctx.fill();
  // bowl
  ctx.fillStyle = '#4a4d54';
  ctx.beginPath();
  ctx.ellipse(0, -20, 19, 8, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(190, 200, 210, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (lit) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const w = 8 + Math.sin(time * 8 + i * 2) * 2.5;
      const h = 26 + i * 7 + Math.sin(time * 6 + i) * 5;
      const grd = ctx.createLinearGradient(0, -22, 0, -22 - h);
      grd.addColorStop(0, 'rgba(255, 180, 70, 0.9)');
      grd.addColorStop(0.55, 'rgba(255, 220, 130, 0.55)');
      grd.addColorStop(1, 'rgba(255, 255, 220, 0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(-w, -20);
      ctx.quadraticCurveTo(-w * 0.4, -22 - h * 0.6, Math.sin(time * 2 + i) * 4, -22 - h);
      ctx.quadraticCurveTo(w * 0.4, -22 - h * 0.6, w, -20);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else {
    ctx.fillStyle = '#1c1c1e';
    ctx.beginPath();
    ctx.ellipse(0, -20, 14, 5, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawLantern(ctx, l, g) {
  ctx.save();
  ctx.translate(l.x, l.y);
  const pulse = 0.75 + 0.25 * Math.sin(g.time * 4 + l.x);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 8, 10, 4, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#3b3a36';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.lineTo(0, -4);
  ctx.stroke();
  ctx.fillStyle = '#20180f';
  rr(ctx, -7, -16, 14, 14, 3);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 214, 140, ${pulse})`;
  rr(ctx, -4.5, -13.5, 9, 9, 2);
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gl = ctx.createRadialGradient(0, -9, 2, 0, -9, 46);
  gl.addColorStop(0, `rgba(255, 200, 120, ${0.25 * pulse})`);
  gl.addColorStop(1, 'rgba(255, 200, 120, 0)');
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(0, -9, 46, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawNpc(ctx, n, g) {
  ctx.save();
  ctx.translate(n.x, n.y);
  const bob = Math.sin(g.time * 2 + n.x) * 1.2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 8, 15, 6, 0, 0, TAU);
  ctx.fill();

  // body
  ctx.fillStyle = n.color;
  ctx.beginPath();
  ctx.moveTo(-11, 6);
  ctx.quadraticCurveTo(-13, -18, 0, -22);
  ctx.quadraticCurveTo(13, -18, 11, 6);
  ctx.quadraticCurveTo(0, 11, -11, 6);
  ctx.fill();
  // head
  ctx.fillStyle = '#e8d9c4';
  ctx.beginPath();
  ctx.arc(0, -28 + bob, 8, 0, TAU);
  ctx.fill();
  // eyes
  ctx.fillStyle = '#1a1512';
  ctx.beginPath();
  ctx.arc(-3, -29 + bob, 1.3, 0, TAU);
  ctx.arc(3, -29 + bob, 1.3, 0, TAU);
  ctx.fill();
  // hood/hair
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.arc(0, -31 + bob, 8.4, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();

  // name tag when close
  if (g.player && Math.hypot(g.player.x - n.x, g.player.y - n.y) < 150) {
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(n.name, 0, -48);
    ctx.fillStyle = 'rgba(240, 232, 210, 0.95)';
    ctx.fillText(n.name, 0, -49);
    ctx.fillStyle = 'rgba(255, 220, 150, 0.8)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('E', 18, -22);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

/* ----------------------------------------------------------------- enemies */

function drawEnemy(ctx, e, g) {
  const hurt = e.hurtT > 0;
  const windup = e.state === 'windup';
  const stagger = e.state === 'stagger';
  ctx.save();
  ctx.translate(e.x, e.y);

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, e.r * 0.75, e.r * 0.95, e.r * 0.35, 0, 0, TAU);
  ctx.fill();

  if (e.def.ranged) {
    // hooded archer
    ctx.fillStyle = hurt ? '#ffe9d0' : '#2b2b34';
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.8, e.r * 0.7);
    ctx.quadraticCurveTo(-e.r, -e.r * 0.6, 0, -e.r);
    ctx.quadraticCurveTo(e.r, -e.r * 0.6, e.r * 0.8, e.r * 0.7);
    ctx.fill();
    ctx.fillStyle = '#0c0c10';
    ctx.beginPath();
    ctx.ellipse(0, -e.r * 0.28, e.r * 0.55, e.r * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = windup ? '#ffb27a' : 'rgba(160, 220, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(-4, -e.r * 0.3, 1.8, 0, TAU);
    ctx.arc(4, -e.r * 0.3, 1.8, 0, TAU);
    ctx.fill();
  } else {
    // shadow blob with tendrils
    const wob = Math.sin(g.time * 4 + e.x) * 0.06;
    const grd = ctx.createRadialGradient(0, -e.r * 0.2, 2, 0, 0, e.r * 1.5);
    grd.addColorStop(0, hurt ? 'rgba(255,255,255,0.95)' : 'rgba(52, 48, 74, 0.98)');
    grd.addColorStop(0.6, hurt ? 'rgba(255,220,200,0.8)' : 'rgba(30, 26, 46, 0.9)');
    grd.addColorStop(1, 'rgba(12, 10, 20, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(0, -e.r * 0.2, e.r * 1.18 * (1 + wob), e.r * 1.12, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = 'rgba(28, 24, 42, 0.85)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 2 + (i - 1.5) * 0.5 + Math.sin(g.time * 1.6 + i) * 0.1;
      ctx.beginPath();
      ctx.moveTo(0, e.r * 0.2);
      ctx.quadraticCurveTo(
        Math.cos(a) * e.r * 0.9,
        e.r * 0.6,
        Math.cos(a) * e.r * 1.15,
        e.r * (0.95 + Math.sin(g.time * 2 + i) * 0.12),
      );
      ctx.stroke();
    }

    // eyes
    const eye = windup ? '#ff9a6a' : 'rgba(190, 220, 255, 0.9)';
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.ellipse(-e.r * 0.32, -e.r * 0.34, 2.6, 3.6, 0, 0, TAU);
    ctx.ellipse(e.r * 0.32, -e.r * 0.34, 2.6, 3.6, 0, 0, TAU);
    ctx.fill();
  }

  // Telegraph: a bright ring + facing wedge, so a parry is learnable.
  if (windup) {
    const k = 1 - e.stateT / e.def.windup;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255, 170, 120, ${0.25 + k * 0.6})`;
    ctx.lineWidth = 2 + k * 2;
    ctx.beginPath();
    ctx.arc(0, 0, e.r * (1.4 + k * 0.7), 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 140, 90, ${0.2 + k * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(e.facing) * e.def.reach, Math.sin(e.facing) * e.def.reach);
    ctx.stroke();
    ctx.restore();
  }

  if (stagger) {
    ctx.fillStyle = 'rgba(255, 236, 160, 0.9)';
    for (let i = 0; i < 3; i++) {
      const a = g.time * 6 + (i * TAU) / 3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * e.r * 0.9, -e.r * 1.2 + Math.sin(a) * 5, 2.2, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawBoss(ctx, b, g) {
  const hurt = b.hurtT > 0;
  const windup = b.state === 'windup';
  ctx.save();
  ctx.translate(b.x, b.y + Math.sin(g.time * 1.3) * 5);
  ctx.scale(1.55, 1.55);
  const t = g.time;

  // huge shadow
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.ellipse(0, b.r * 0.7, b.r * 1.1, b.r * 0.38, 0, 0, TAU);
  ctx.fill();

  // Long tendrils reaching for the floor.
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + t * 0.22;
    const len = b.r * (1.5 + 0.35 * Math.sin(t * 1.4 + i));
    ctx.strokeStyle = hurt ? 'rgba(255, 240, 255, 0.5)' : 'rgba(52, 34, 78, 0.75)';
    ctx.lineWidth = 7 - (i % 3);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * b.r * 0.5, Math.sin(a) * b.r * 0.5);
    ctx.quadraticCurveTo(
      Math.cos(a + 0.3) * len * 0.8,
      Math.sin(a + 0.3) * len * 0.8,
      Math.cos(a + 0.12) * len,
      Math.sin(a + 0.12) * len + b.r * 0.3,
    );
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  const grd = ctx.createRadialGradient(-b.r * 0.2, -b.r * 0.3, 4, 0, 0, b.r * 1.5);
  grd.addColorStop(0, hurt ? 'rgba(255,255,255,0.95)' : b.phase === 2 ? 'rgba(132, 78, 168, 0.98)' : 'rgba(92, 72, 132, 0.98)');
  grd.addColorStop(0.55, 'rgba(40, 28, 62, 0.96)');
  grd.addColorStop(1, 'rgba(8, 6, 14, 0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.ellipse(0, 0, b.r * 1.2, b.r * 1.3, 0, 0, TAU);
  ctx.fill();

  if (b.phase === 2) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(214, 156, 255, ${0.4 + 0.3 * Math.sin(t * 4)})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * b.r * 0.3, Math.sin(a) * b.r * 0.3);
      ctx.lineTo(Math.cos(a + 0.4) * b.r * 0.7, Math.sin(a + 0.4) * b.r * 0.7);
      ctx.lineTo(Math.cos(a + 0.2) * b.r * 0.95, Math.sin(a + 0.2) * b.r * 0.95);
      ctx.stroke();
    }
    ctx.restore();
  }

  // horned crown
  ctx.strokeStyle = b.phase === 2 ? 'rgba(200, 150, 255, 0.55)' : 'rgba(150, 130, 200, 0.4)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * 0.85 + i * 0.36;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * b.r * 0.7, Math.sin(a) * b.r * 0.7);
    ctx.quadraticCurveTo(
      Math.cos(a) * b.r * 1.15,
      Math.sin(a) * b.r * 1.15 - 8,
      Math.cos(a) * b.r * 1.36,
      Math.sin(a) * b.r * 1.36,
    );
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  // mask
  ctx.fillStyle = 'rgba(12, 8, 18, 0.9)';
  ctx.beginPath();
  ctx.ellipse(0, -b.r * 0.25, b.r * 0.62, b.r * 0.78, 0, 0, TAU);
  ctx.fill();
  const eyeColor = windup ? '#ff8a5a' : b.phase === 2 ? '#d59cff' : '#9fe0ff';
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.ellipse(-b.r * 0.26, -b.r * 0.3, 5.5, 8, 0.2, 0, TAU);
  ctx.ellipse(b.r * 0.26, -b.r * 0.3, 5.5, 8, -0.2, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const eg = ctx.createRadialGradient(0, -b.r * 0.3, 2, 0, -b.r * 0.3, b.r * 1.2);
  eg.addColorStop(0, b.phase === 2 ? 'rgba(200, 140, 255, 0.25)' : 'rgba(120, 200, 255, 0.2)');
  eg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.arc(0, -b.r * 0.3, b.r * 1.2, 0, TAU);
  ctx.fill();
  ctx.restore();

  if (windup) {
    const k = 1 - b.stateT / b.def.windup;
    ctx.strokeStyle = `rgba(255, 120, 90, ${0.3 + k * 0.6})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, b.r * (1.5 + k), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ player */

function drawPlayer(ctx, g) {
  const p = g.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1.32, 1.32);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.ellipse(0, 9, 15, 6.5, 0, 0, TAU);
  ctx.fill();

  if (p.invuln > 0 && Math.floor(g.time * 18) % 2 === 0) ctx.globalAlpha = 0.5;

  const bob = p.moving ? Math.sin(p.walkPhase) * 1.8 : Math.sin(g.time * 2) * 0.9;
  ctx.save();
  ctx.translate(0, bob);

  // cloak, oriented by facing
  ctx.rotate(p.facing + Math.PI / 2);
  const cg = ctx.createLinearGradient(0, -20, 0, 16);
  cg.addColorStop(0, '#3b5566');
  cg.addColorStop(0.55, '#22333e');
  cg.addColorStop(1, '#16222b');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.quadraticCurveTo(-15, -6, -13, 12);
  ctx.quadraticCurveTo(0, 18, 13, 12);
  ctx.quadraticCurveTo(15, -6, 0, -18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(160, 210, 220, 0.35)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // hood + face
  ctx.fillStyle = '#101a20';
  ctx.beginPath();
  ctx.ellipse(0, -13, 10, 9, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e9f4ff';
  ctx.beginPath();
  ctx.ellipse(0, -16, 5.6, 4.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0d1216';
  ctx.beginPath();
  ctx.arc(-2, -16.5, 1.1, 0, TAU);
  ctx.arc(2, -16.5, 1.1, 0, TAU);
  ctx.fill();
  ctx.restore();

  // shoulder cape edge
  ctx.strokeStyle = 'rgba(12, 18, 22, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 14, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();

  // lantern in the left hand
  const lx = Math.cos(p.facing - 1.9) * 15;
  const ly = Math.sin(p.facing - 1.9) * 15;
  ctx.fillStyle = '#20180f';
  rr(ctx, lx - 4, ly - 5, 8, 9, 2);
  ctx.fill();
  const flick = 0.7 + 0.3 * Math.sin(g.time * 9);
  ctx.fillStyle = `rgba(255, 214, 140, ${flick})`;
  rr(ctx, lx - 2.4, ly - 3.4, 4.8, 5.8, 1.5);
  ctx.fill();

  // sword
  const swing = p.swingT;
  if (swing > 0) {
    const k = 1 - swing / 0.3;
    const a0 = p.swingDir - 1.0 + k * 2.0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grd = ctx.createRadialGradient(0, 0, 12, 0, 0, 62);
    grd.addColorStop(0, 'rgba(210, 245, 255, 0)');
    grd.addColorStop(0.7, `rgba(190, 235, 255, ${0.28 * (1 - k)})`);
    grd.addColorStop(1, 'rgba(190, 235, 255, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 62, a0 - 0.5, a0 + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(230, 250, 255, ${0.85 * (1 - k)})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 50, a0 - 0.32, a0 + 0.32);
    ctx.stroke();
    ctx.restore();
  } else {
    const sx = Math.cos(p.facing + 0.7) * 14;
    const sy = Math.sin(p.facing + 0.7) * 14;
    ctx.strokeStyle = '#b9c8cf';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(p.facing + 0.7) * 16, sy + Math.sin(p.facing + 0.7) * 16);
    ctx.stroke();
  }

  // parry flash: a shield arc in front
  if (p.parryFlash > 0 || p.blocking) {
    const intensity = p.blocking ? 0.5 : p.parryFlash;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(190, 235, 255, ${0.35 + intensity * 0.6})`;
    ctx.lineWidth = p.blocking ? 4 : 5;
    ctx.beginPath();
    ctx.arc(0, 0, 26, p.facing - 0.8, p.facing + 0.8);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/* ---------------------------------------------------------- projectiles/fx */

function drawProjectiles(g, ctx) {
  for (const pr of g.projectiles) {
    if (pr.ring) {
      ctx.strokeStyle = `rgba(190, 140, 240, ${Math.max(0, pr.t) * 0.7})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, pr.r, 0, TAU);
      ctx.stroke();
      continue;
    }
    if (pr.kind === 'bomb') {
      ctx.fillStyle = '#1b1b1e';
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, 8, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#c9a870';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pr.x - 4, pr.y - 5, 3, 0, TAU);
      ctx.stroke();
      const blink = Math.sin(g.time * 22) > 0;
      if (blink) {
        ctx.fillStyle = '#ffb45a';
        ctx.beginPath();
        ctx.arc(pr.x + 4, pr.y - 9, 2.4, 0, TAU);
        ctx.fill();
      }
      continue;
    }
    // arrow
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(Math.atan2(pr.vy, pr.vx));
    ctx.strokeStyle = pr.friendly ? '#e8f4ff' : '#ffb08a';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.fillStyle = pr.friendly ? '#e8f4ff' : '#ff9a70';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(6, -3.5);
    ctx.lineTo(6, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawParticles(g, ctx) {
  for (const p of g.particles) {
    const a = clamp(p.t / (p.max || 0.8), 0, 1);
    ctx.fillStyle = p.color.startsWith('rgba') ? p.color : rgba(p.color, a);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.8), 0, TAU);
    ctx.fill();
  }
}

/* ------------------------------------------------------------------- light */

function drawLight(g, ctx, camX, camY, z) {
  const p = g.player;
  const darkness = clamp(g.dark + (g.scene === 'dungeon' ? 0.06 : 0), 0, 0.93);
  if (darkness < 0.06) return;

  const toS = (x, y) => ({ x: (x - camX) * z, y: (y - camY) * z });
  const lights = [];
  // your lantern: a small bubble, never enough on its own
  const ps = toS(p.x, p.y);
  lights.push({ ...ps, r: (g.flags.bonusLantern ? 320 : 280) * z, a: 0.94 });

  for (const s of g.lightSources()) {
    const q = toS(s.x, s.y);
    lights.push({ ...q, r: s.r * z, a: s.soft ? 0.5 : 1 });
  }
  if (g.boss && !g.boss.dead) {
    const q = toS(g.boss.x, g.boss.y);
    lights.push({ ...q, r: 330 * z, a: 0.72 });
    lights.push({ ...q, r: 170 * z, a: 0.9 });
  }
  for (const pr of g.projectiles) {
    if (pr.kind === 'bomb') {
      const q = toS(pr.x, pr.y);
      lights.push({ ...q, r: 90 * z, a: 0.7 });
    }
  }
  for (const pa of g.particles) {
    if (pa.color && (pa.color.includes('255, 210') || pa.color.includes('255, 180'))) {
      const q = toS(pa.x, pa.y);
      lights.push({ ...q, r: 30 * z, a: 0.35 });
    }
  }

  // Dark overlay via an offscreen buffer.
  const lc = g.lightCtx || (g.lightCtx = document.createElement('canvas').getContext('2d'));
  if (!g.lightCanvas) {
    g.lightCanvas = lc.canvas;
  }
  const cw = Math.round(g.w * g.dpr);
  const chh = Math.round(g.h * g.dpr);
  if (lc.canvas.width !== cw || lc.canvas.height !== chh) {
    lc.canvas.width = cw;
    lc.canvas.height = chh;
  }
  lc.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  lc.clearRect(0, 0, g.w, g.h);
  lc.fillStyle = `rgba(3, 5, 9, ${darkness})`;
  lc.fillRect(0, 0, g.w, g.h);
  lc.globalCompositeOperation = 'destination-out';
  for (const l of lights) {
    const grd = lc.createRadialGradient(l.x, l.y, 2, l.x, l.y, l.r);
    grd.addColorStop(0, `rgba(0,0,0,${l.a})`);
    grd.addColorStop(0.55, `rgba(0,0,0,${l.a * 0.72})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = grd;
    lc.beginPath();
    lc.arc(l.x, l.y, l.r, 0, TAU);
    lc.fill();
  }
  lc.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(g.lightCanvas, 0, 0, cw, chh);
  ctx.restore();

  // Warm additive glow around real fire.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (g.boss && !g.boss.dead) {
    const q = toS(g.boss.x, g.boss.y);
    const hue = g.boss.phase === 2 ? '190, 120, 255' : '140, 100, 230';
    const bg = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 300 * z);
    bg.addColorStop(0, `rgba(${hue}, 0.34)`);
    bg.addColorStop(0.45, `rgba(${hue}, 0.14)`);
    bg.addColorStop(1, `rgba(${hue}, 0)`);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 300 * z, 0, TAU);
    ctx.fill();
  }
  for (const s of g.lightSources()) {
    if (s.soft) continue;
    const q = toS(s.x, s.y);
    const grd = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, s.r * z);
    grd.addColorStop(0, 'rgba(255, 196, 120, 0.18)');
    grd.addColorStop(0.55, 'rgba(255, 170, 90, 0.07)');
    grd.addColorStop(1, 'rgba(255, 170, 90, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(q.x, q.y, s.r * z, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawFloaters(g, ctx, camX, camY, z) {
  ctx.save();
  ctx.scale(z, z);
  ctx.translate(-camX, -camY);
  ctx.textAlign = 'center';
  for (const f of g.floaters) {
    const a = clamp(f.t * 1.6, 0, 1);
    ctx.font = `700 ${f.size}px system-ui, sans-serif`;
    ctx.fillStyle = `rgba(0,0,0,${a * 0.5})`;
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color.startsWith('#') ? rgba(f.color, a) : f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawScreenFx(g, ctx) {
  const w = g.w;
  const h = g.h;
  // vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // hurt vignette
  const hurt = Math.max(g.player.hurtT / 0.45, 0);
  const cold = g.player.cold || 0;
  if (hurt > 0.01 || cold > 0.01) {
    const a = Math.min(0.55, hurt * 0.5 + cold * 0.35);
    const g2 = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.66);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(1, cold > hurt ? `rgba(120, 190, 255, ${a})` : `rgba(220, 60, 50, ${a})`);
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  }

  if (g.flash > 0.01) {
    ctx.fillStyle = `rgba(255, 244, 220, ${g.flash * 0.45})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Boss health bar.
  if (g.boss && !g.boss.dead) {
    const bw = Math.min(520, w * 0.55);
    const bx = (w - bw) / 2;
    const by = h - 54;
    ctx.fillStyle = 'rgba(6, 8, 12, 0.7)';
    rr(ctx, bx - 4, by - 4, bw + 8, 22, 11);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    rr(ctx, bx, by, bw, 14, 7);
    ctx.fill();
    const frac = clamp(g.boss.hp / g.boss.maxHp, 0, 1);
    const bg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    bg.addColorStop(0, '#7b4fa8');
    bg.addColorStop(1, '#d59cff');
    ctx.fillStyle = bg;
    rr(ctx, bx, by, Math.max(2, bw * frac), 14, 7);
    ctx.fill();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(240, 226, 255, 0.9)';
    ctx.fillText('FÖRBANNELSEN', w / 2, by - 12);
    ctx.textAlign = 'left';
  }
}

/* --------------------------------------------------------------------- map */

function drawMap(g) {
  const ctx = g.ctx;
  const w = g.w;
  const h = g.h;
  ctx.save();
  ctx.fillStyle = 'rgba(6, 8, 10, 0.86)';
  ctx.fillRect(0, 0, w, h);

  const pad = Math.min(w, h) * 0.1;
  const scale = Math.min((w - pad * 2) / WORLD_W, (h - pad * 2 - 60) / WORLD_H);
  const ox = (w - WORLD_W * scale) / 2;
  const oy = (h - WORLD_H * scale) / 2 + 18;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  for (const z of ZONES) {
    ctx.fillStyle = z.ground;
    rr(ctx, z.rect.x, z.rect.y, z.rect.w, z.rect.h, 40);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 210, 180, 0.12)';
    ctx.lineWidth = 4 / scale;
    ctx.stroke();
  }
  for (const p of PATHS) {
    ctx.fillStyle = 'rgba(120, 104, 70, 0.35)';
    rr(ctx, p.x, p.y, p.w, p.h, 20);
    ctx.fill();
  }
  for (const w2 of WATER) {
    ctx.fillStyle = 'rgba(40, 90, 96, 0.85)';
    rr(ctx, w2.x, w2.y, w2.w, w2.h, 50);
    ctx.fill();
  }
  for (const h2 of HOUSES) {
    ctx.fillStyle = 'rgba(60, 50, 40, 0.9)';
    ctx.fillRect(h2.x, h2.y, h2.w, h2.h);
  }

  // braziers
  for (const b of BRAZIERS) {
    const lit = g.flags.braziers[b.id];
    ctx.fillStyle = lit ? '#ffca70' : 'rgba(200, 200, 200, 0.3)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, lit ? 26 : 16, 0, TAU);
    ctx.fill();
  }
  // dungeon
  ctx.fillStyle = g.flags.bossDead ? 'rgba(255, 220, 150, 0.6)' : 'rgba(160, 120, 220, 0.7)';
  ctx.beginPath();
  ctx.arc(DUNGEON_ENTRANCE.x + 45, DUNGEON_ENTRANCE.y + 20, 26, 0, TAU);
  ctx.fill();

  // player
  const p = g.player;
  ctx.fillStyle = '#eaf6ff';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 22, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150, 230, 255, 0.9)';
  ctx.lineWidth = 6 / scale;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 42 + Math.sin(g.time * 4) * 8, 0, TAU);
  ctx.stroke();

  // labels
  ctx.textAlign = 'center';
  for (const z of ZONES) {
    ctx.font = `700 ${34}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(240, 232, 210, 0.72)';
    ctx.fillText(z.name.toUpperCase(), z.rect.x + z.rect.w / 2, z.rect.y + z.rect.h / 2);
  }
  ctx.textAlign = 'left';
  ctx.restore();

  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(235, 226, 200, 0.75)';
  ctx.textAlign = 'center';
  ctx.fillText('M — stäng kartan', w / 2, h - pad * 0.55);
  ctx.textAlign = 'left';
  ctx.restore();
}
