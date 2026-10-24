// Den sista lågan — the painterly renderer.
import { rng, clamp, lerp, dist, angleDiff } from './physics.js';

const TAU = Math.PI * 2;

const PAL = {
  village: {
    base: '#33472f',
    grass: ['#3a5236', '#455e3c', '#2e4329', '#4d6a42'],
    path: '#7a6244',
    pathEdge: '#5e4c34',
    water: '#2a3f49',
    waterLight: '#41606b',
    stone: '#8d8a7c',
    roof: '#7a4a3a',
    roofDark: '#5a3428',
    wall: '#8a7a62',
    warm: 'rgba(255, 196, 110, 0.9)',
    sky: '#1b2530',
  },
  field: {
    base: '#4a4d2c',
    grass: ['#565b32', '#63683a', '#454929', '#6f7444'],
    path: '#8a7448',
    pathEdge: '#6a5734',
    water: '#31434b',
    waterLight: '#4a6470',
    stone: '#8f8a76',
    roof: '#6d4634',
    roofDark: '#4e3024',
    wall: '#93805f',
    warm: 'rgba(255, 194, 106, 0.9)',
    sky: '#20262d',
  },
  forest: {
    base: '#1f352c',
    grass: ['#294436', '#335040', '#223a2e', '#3a5a46'],
    path: '#5c4a35',
    pathEdge: '#463726',
    water: '#22343c',
    waterLight: '#365059',
    stone: '#6d786e',
    roof: '#4c3a2e',
    roofDark: '#35281f',
    wall: '#7a7157',
    warm: 'rgba(255, 206, 120, 0.9)',
    sky: '#121d1f',
  },
  river: {
    base: '#2b3f3a',
    grass: ['#35504a', '#3f5c53', '#2a4039', '#4a6a5c'],
    path: '#6e5b40',
    pathEdge: '#53442e',
    water: '#28454f',
    waterLight: '#46707c',
    stone: '#7d8478',
    roof: '#5c4234',
    roofDark: '#412e24',
    wall: '#857a5f',
    warm: 'rgba(255, 200, 120, 0.9)',
    sky: '#16242a',
  },
  crypt: {
    base: '#20222e',
    grass: ['#272a38', '#2e3142', '#22242f', '#343748'],
    path: '#3a3c4c',
    pathEdge: '#2a2c39',
    water: '#1a2230',
    waterLight: '#2b3a4a',
    stone: '#5b5f72',
    roof: '#3a3c4a',
    roofDark: '#262833',
    wall: '#4a4d5c',
    warm: 'rgba(255, 200, 120, 0.9)',
    sky: '#0b0c12',
  },
};

const palFor = (zone) => PAL[zone.theme] || PAL.village;

/* ------------------------------------------------------------------ ground */

export function bakeGround(zone) {
  const c = document.createElement('canvas');
  c.width = zone.w;
  c.height = zone.h;
  const g = c.getContext('2d');
  const pal = palFor(zone);
  const rnd = rng(zone.w * 31 + zone.h * 17 + zone.id.length * 977);

  // Base wash.
  const bg = g.createLinearGradient(0, 0, zone.w * 0.3, zone.h);
  bg.addColorStop(0, pal.base);
  bg.addColorStop(0.5, pal.grass[1]);
  bg.addColorStop(1, pal.base);
  g.fillStyle = bg;
  g.fillRect(0, 0, zone.w, zone.h);

  if (zone.theme === 'crypt') {
    // Flagstones.
    const tile = 96;
    for (let y = 0; y < zone.h; y += tile) {
      for (let x = 0; x < zone.w; x += tile) {
        const v = rnd();
        g.fillStyle = `rgba(${40 + v * 26}, ${42 + v * 26}, ${54 + v * 30}, 1)`;
        g.fillRect(x + 1, y + 1, tile - 2, tile - 2);
        g.strokeStyle = 'rgba(10,12,18,0.45)';
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, tile - 2, tile - 2);
      }
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(150,160,190,${0.02 + rnd() * 0.05})`;
      g.beginPath();
      g.ellipse(rnd() * zone.w, rnd() * zone.h, rnd() * 40, rnd() * 22, rnd() * TAU, 0, TAU);
      g.fill();
    }
  } else {
    // Painterly grass daubs.
    for (let i = 0; i < 1500; i++) {
      const x = rnd() * zone.w;
      const y = rnd() * zone.h;
      const r = 14 + rnd() * 46;
      g.fillStyle = pal.grass[Math.floor(rnd() * pal.grass.length)];
      g.globalAlpha = 0.16 + rnd() * 0.22;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.4 + rnd() * 0.5), rnd() * TAU, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    // Fine grass strokes.
    g.lineWidth = 1.2;
    for (let i = 0; i < 2200; i++) {
      const x = rnd() * zone.w;
      const y = rnd() * zone.h;
      g.strokeStyle = `rgba(${90 + rnd() * 60}, ${120 + rnd() * 60}, ${70 + rnd() * 50}, ${0.05 + rnd() * 0.12})`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 5, y - 4 - rnd() * 6);
      g.stroke();
    }
  }

  // Paths.
  for (const p of zone.paths || []) {
    paintPath(g, p, pal, rnd);
  }

  // Water beds.
  for (const w of zone.water || []) {
    g.fillStyle = pal.water;
    g.fillRect(w.x, w.y, w.w, w.h);
    const grad = g.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.04)');
    grad.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = grad;
    g.fillRect(w.x, w.y, w.w, w.h);
    g.strokeStyle = 'rgba(12, 20, 24, 0.7)';
    g.lineWidth = 6;
    g.strokeRect(w.x, w.y, w.w, w.h);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(120, 170, 180, ${0.03 + rnd() * 0.05})`;
      g.beginPath();
      g.ellipse(w.x + rnd() * w.w, w.y + rnd() * w.h, 20 + rnd() * 60, 4 + rnd() * 10, 0, 0, TAU);
      g.fill();
    }
  }

  // Bridges.
  for (const b of zone.bridges || []) {
    g.fillStyle = '#5a4530';
    g.fillRect(b.x, b.y, b.w, b.h);
    g.fillStyle = 'rgba(30, 20, 12, 0.45)';
    for (let x = b.x + 6; x < b.x + b.w; x += 14) g.fillRect(x, b.y + 2, 3, b.h - 4);
    g.strokeStyle = '#33251a';
    g.lineWidth = 4;
    g.strokeRect(b.x, b.y, b.w, b.h);
  }

  // Baked decor.
  for (const d of zone.decor || []) paintDecor(g, d, pal, rnd);

  // Vignette at the edges so the map feels enclosed.
  const edge = 120;
  const vg = g.createRadialGradient(zone.w / 2, zone.h / 2, Math.min(zone.w, zone.h) * 0.32, zone.w / 2, zone.h / 2, Math.max(zone.w, zone.h) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(4, 8, 10, 0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, zone.w, zone.h);

  return c;
}

function paintPath(g, p, pal, rnd) {
  const dx = p.x2 - p.x1;
  const dy = p.y2 - p.y1;
  const len = Math.hypot(dx, dy) || 1;
  const steps = Math.max(2, Math.round(len / 26));
  const curvy = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wob = Math.sin(t * Math.PI * 2.2 + p.x1 * 0.01) * 16;
    curvy.push({
      x: lerp(p.x1, p.x2, t) + (-dy / len) * wob,
      y: lerp(p.y1, p.y2, t) + (dx / len) * wob,
    });
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = pal.pathEdge;
  g.lineWidth = p.w + 12;
  strokePolyline(g, curvy);
  g.strokeStyle = pal.path;
  g.lineWidth = p.w;
  strokePolyline(g, curvy);
  g.strokeStyle = 'rgba(255, 240, 210, 0.06)';
  g.lineWidth = p.w * 0.5;
  strokePolyline(g, curvy);
  for (let i = 0; i < len / 12; i++) {
    const t = rnd();
    const idx = Math.min(curvy.length - 1, Math.floor(t * curvy.length));
    const c = curvy[idx];
    g.fillStyle = `rgba(${140 + rnd() * 40}, ${120 + rnd() * 30}, ${90 + rnd() * 30}, ${0.1 + rnd() * 0.25})`;
    g.beginPath();
    g.ellipse(c.x + (rnd() - 0.5) * p.w, c.y + (rnd() - 0.5) * p.w, 2 + rnd() * 4, 1.5 + rnd() * 3, rnd() * TAU, 0, TAU);
    g.fill();
  }
  g.lineCap = 'butt';
}

function strokePolyline(g, pts) {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  g.lineTo(last.x, last.y);
  g.stroke();
}

function paintDecor(g, d, pal, rnd) {
  if (d.type === 'runeCircle') {
    g.save();
    g.translate(d.x, d.y);
    g.scale(1, 0.55);
    g.strokeStyle = 'rgba(170, 190, 235, 0.14)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(0, 0, d.r, 0, TAU);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, d.r * 0.78, 0, TAU);
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const a2 = a + (TAU / 12) * 0.5;
      g.beginPath();
      g.moveTo(Math.cos(a) * d.r * 0.78, Math.sin(a) * d.r * 0.78);
      g.lineTo(Math.cos(a2) * d.r, Math.sin(a2) * d.r);
      g.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const a = rnd() * TAU;
      const r = rnd() * d.r * 0.7;
      g.fillStyle = `rgba(160, 180, 230, ${0.02 + rnd() * 0.05})`;
      g.beginPath();
      g.arc(Math.cos(a) * r, Math.sin(a) * r, 2 + rnd() * 6, 0, TAU);
      g.fill();
    }
    g.restore();
    return;
  }
  if (d.type === 'flowers') {
    for (let i = 0; i < (d.n || 8); i++) {
      const x = d.x + (rnd() - 0.5) * 120;
      const y = d.y + (rnd() - 0.5) * 90;
      const col = ['#d9c07a', '#c98ea0', '#a9c7e0', '#e8d9a8'][Math.floor(rnd() * 4)];
      g.strokeStyle = 'rgba(90, 120, 80, 0.55)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 3, y - 6 - rnd() * 5);
      g.stroke();
      g.fillStyle = col;
      g.globalAlpha = 0.55 + rnd() * 0.35;
      g.beginPath();
      g.arc(x, y - 7 - rnd() * 5, 1.4 + rnd() * 1.6, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }
  } else if (d.type === 'wheat') {
    for (let i = 0; i < (d.n || 20); i++) {
      const x = d.x + (rnd() - 0.5) * 220;
      const y = d.y + (rnd() - 0.5) * 130;
      g.strokeStyle = `rgba(196, 172, 96, ${0.25 + rnd() * 0.3})`;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (rnd() - 0.5) * 8, y - 10, x + (rnd() - 0.5) * 12, y - 20 - rnd() * 8);
      g.stroke();
    }
  } else if (d.type === 'mushrooms') {
    for (let i = 0; i < (d.n || 6); i++) {
      const x = d.x + (rnd() - 0.5) * 110;
      const y = d.y + (rnd() - 0.5) * 80;
      g.fillStyle = 'rgba(200, 210, 230, 0.34)';
      g.beginPath();
      g.ellipse(x, y - 3, 4 + rnd() * 3, 2.4 + rnd() * 2, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(120, 140, 170, 0.3)';
      g.fillRect(x - 0.9, y - 3, 1.8, 4);
    }
  } else if (d.type === 'reeds') {
    for (let i = 0; i < (d.n || 10); i++) {
      const x = d.x + (rnd() - 0.5) * 140;
      const y = d.y + (rnd() - 0.5) * 120;
      g.strokeStyle = `rgba(120, 150, 120, ${0.22 + rnd() * 0.25})`;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (rnd() - 0.5) * 10, y - 14, x + (rnd() - 0.5) * 16, y - 28 - rnd() * 10);
      g.stroke();
    }
  }
}

/* ------------------------------------------------------------------- scene */

export function drawScene(ctx, game, camX, camY) {
  const z = game.zoom;
  const dpr = game.dpr;
  ctx.setTransform(dpr * z, 0, 0, dpr * z, -camX * z * dpr, -camY * z * dpr);
  const zone = game.zoneDef;
  const pal = palFor(zone);

  if (game.ground) ctx.drawImage(game.ground, 0, 0);

  drawWater(ctx, game, pal);
  drawBakedExtras(ctx, game, pal);

  // Everything that needs depth sorting.
  const list = [];
  for (const p of zone.props || []) list.push({ y: p.y, draw: () => drawProp(ctx, p, game, pal) });
  for (const s of game.z.statues) list.push({ y: s.y, draw: () => drawStatue(ctx, s, game) });
  for (const c of game.z.chests) list.push({ y: c.y, draw: () => drawChest(ctx, c, game) });
  for (const b of game.z.braziers) list.push({ y: b.y, draw: () => drawBrazier(ctx, b, game) });
  if (game.z.altar) list.push({ y: game.z.altar.y, draw: () => drawAltar(ctx, game.z.altar, game) });
  for (const g of game.z.gates) list.push({ y: g.y + g.h, draw: () => drawGate(ctx, g, game) });
  for (const r of game.z.rubble) list.push({ y: r.y + r.h, draw: () => drawRubble(ctx, r, game) });
  for (const b of game.z.brambles) list.push({ y: b.y + b.h, draw: () => drawBramble(ctx, b, game) });
  for (const s of game.z.switches) list.push({ y: s.y + 20, draw: () => drawSwitch(ctx, s, game) });
  for (const n of game.z.npcs) list.push({ y: n.y, draw: () => drawNpc(ctx, n, game) });
  for (const e of game.enemies) list.push({ y: e.body.y + e.body.h, draw: () => drawEnemy(ctx, e, game) });
  list.push({ y: game.player.body.y + game.player.body.h, draw: () => drawPlayer(ctx, game) });
  for (const pr of game.projectiles) list.push({ y: pr.y, draw: () => drawProjectile(ctx, pr, game) });
  if (game.zoneDef.cryptDoor) list.push({ y: game.zoneDef.cryptDoor.y + 40, draw: () => drawCryptDoor(ctx, game.zoneDef.cryptDoor, game) });

  list.sort((a, b) => a.y - b.y);
  for (const item of list) item.draw();

  drawParticles(ctx, game);
  for (const e of game.effects) drawEffect(ctx, e, game);
}

function drawWater(ctx, game, pal) {
  const t = game.time;
  for (const w of game.zoneDef.water || []) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(w.x, w.y, w.w, w.h);
    ctx.clip();
    for (let i = 0; i < 7; i++) {
      const yy = w.y + ((t * 16 + i * (w.h / 7)) % w.h);
      ctx.strokeStyle = `rgba(150, 200, 210, ${0.05 + 0.03 * Math.sin(t + i)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = w.x; x < w.x + w.w; x += 12) {
        const y = yy + Math.sin((x + i * 40 + t * 60) * 0.02) * 4;
        if (x === w.x) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  void pal;
}

function drawBakedExtras(ctx, game, pal) {
  // Light shafts and warm pools around lit things are drawn additively later.
  void pal;
  void game;
}

/* ------------------------------------------------------------------- props */

function shadowEllipse(ctx, x, y, rx, ry, a = 0.35) {
  ctx.fillStyle = `rgba(6,10,12,${a})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

function drawProp(ctx, p, game, pal) {
  if (p.type === 'tree') return drawTree(ctx, p, pal, game.time);
  if (p.type === 'bush') return drawBush(ctx, p, pal);
  if (p.type === 'rock') return drawRock(ctx, p, pal);
  if (p.type === 'house') return drawHouse(ctx, p, pal, game);
  if (p.type === 'fence') return drawFence(ctx, p, pal);
  if (p.type === 'haystack') return drawHaystack(ctx, p, pal);
  if (p.type === 'well') return drawWell(ctx, p, pal);
  if (p.type === 'pillar') return drawPillar(ctx, p, pal);
  if (p.type === 'grave') return drawGrave(ctx, p, pal);
  if (p.type === 'urn') return drawUrn(ctx, p);
  if (p.type === 'bones') return drawBones(ctx, p);
}

function drawTree(ctx, p, pal, t) {
  const s = p.s || 1;
  const sway = Math.sin(t * 0.8 + p.x * 0.02) * 2.4 * s;
  shadowEllipse(ctx, p.x + 8 * s, p.y + 2, 32 * s, 11 * s, 0.42);
  // Roots.
  ctx.strokeStyle = p.kind === 'birch' ? '#8f938c' : '#2f2419';
  ctx.lineWidth = 3 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x - 6 * s, p.y - 2);
  ctx.quadraticCurveTo(p.x - 14 * s, p.y + 2, p.x - 20 * s, p.y + 4);
  ctx.moveTo(p.x + 6 * s, p.y - 2);
  ctx.quadraticCurveTo(p.x + 14 * s, p.y + 2, p.x + 20 * s, p.y + 4);
  ctx.stroke();
  ctx.lineCap = 'butt';
  // Trunk.
  ctx.fillStyle = p.kind === 'birch' ? '#cdd4cd' : '#3a2f26';
  ctx.beginPath();
  ctx.moveTo(p.x - 5 * s, p.y);
  ctx.lineTo(p.x - 3.2 * s + sway, p.y - 34 * s);
  ctx.lineTo(p.x + 3.4 * s + sway, p.y - 34 * s);
  ctx.lineTo(p.x + 5.2 * s, p.y);
  ctx.closePath();
  ctx.fill();
  if (p.kind === 'birch') {
    ctx.fillStyle = 'rgba(40,45,45,0.5)';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(p.x - 3 * s + sway * 0.4, p.y - 8 - i * 6 * s, 5.4 * s, 1.5 * s);
    }
  }
  // Canopy: several overlapping blobs, lit from the upper left.
  const base = p.kind === 'birch' ? ['#40603f', '#517a4c', '#2e4a33', '#628c58'] : ['#1f3b2a', '#2b4d33', '#162b1f', '#365c3c'];
  const blobs = [
    { x: 0, y: -44, r: 26 },
    { x: -16, y: -36, r: 18 },
    { x: 16, y: -38, r: 20 },
    { x: -6, y: -56, r: 18 },
    { x: 10, y: -54, r: 15 },
  ];
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    ctx.fillStyle = base[i % base.length];
    ctx.beginPath();
    ctx.ellipse(p.x + b.x * s + sway * (0.4 + i * 0.15), p.y + b.y * s, b.r * s, b.r * 0.82 * s, 0, 0, TAU);
    ctx.fill();
  }
  // Light catching the top-left of the canopy.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(p.x - 10 * s + sway, p.y - 56 * s, 2, p.x - 10 * s + sway, p.y - 56 * s, 30 * s);
  lg.addColorStop(0, 'rgba(190, 220, 170, 0.16)');
  lg.addColorStop(1, 'rgba(190, 220, 170, 0)');
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.arc(p.x - 10 * s + sway, p.y - 56 * s, 30 * s, 0, TAU);
  ctx.fill();
  ctx.restore();
  void pal;
}

function drawBush(ctx, p, pal) {
  const s = p.s || 1;
  shadowEllipse(ctx, p.x + 2, p.y + 1, 16 * s, 6 * s, 0.3);
  ctx.fillStyle = '#2b4635';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 8 * s, 17 * s, 13 * s, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#365639';
  ctx.beginPath();
  ctx.ellipse(p.x - 5 * s, p.y - 12 * s, 10 * s, 8 * s, -0.2, 0, TAU);
  ctx.fill();
}

function drawRock(ctx, p, pal) {
  const s = p.s || 1;
  shadowEllipse(ctx, p.x + 3, p.y + 1, 17 * s, 6 * s, 0.32);
  const g = ctx.createLinearGradient(p.x, p.y - 22 * s, p.x, p.y + 4);
  g.addColorStop(0, '#9a9c92');
  g.addColorStop(1, '#54584f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(p.x - 17 * s, p.y);
  ctx.lineTo(p.x - 12 * s, p.y - 14 * s);
  ctx.lineTo(p.x + 2 * s, p.y - 20 * s);
  ctx.lineTo(p.x + 15 * s, p.y - 10 * s);
  ctx.lineTo(p.x + 17 * s, p.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,26,24,0.4)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawHouse(ctx, p, pal, game) {
  const { x, y, w, h } = p;
  const church = p.style === 'church';
  shadowEllipse(ctx, x + w / 2, y + h + 4, w * 0.52, 16, 0.4);

  // Walls.
  const wallG = ctx.createLinearGradient(x, y, x, y + h);
  wallG.addColorStop(0, church ? '#8d8a86' : pal.wall);
  wallG.addColorStop(1, church ? '#5f5c5a' : '#5c5040');
  ctx.fillStyle = wallG;
  ctx.fillRect(x, y + h * 0.42, w, h * 0.58);

  // Roof.
  ctx.fillStyle = church ? '#4a4a55' : pal.roofDark;
  ctx.beginPath();
  ctx.moveTo(x - 12, y + h * 0.46);
  ctx.lineTo(x + w / 2, y - 10);
  ctx.lineTo(x + w + 12, y + h * 0.46);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = church ? '#5b5b68' : pal.roof;
  ctx.beginPath();
  ctx.moveTo(x - 12, y + h * 0.46);
  ctx.lineTo(x + w / 2, y - 10);
  ctx.lineTo(x + w + 12, y + h * 0.46);
  ctx.lineTo(x + w + 2, y + h * 0.5);
  ctx.lineTo(x + w / 2, y + 4);
  ctx.lineTo(x - 2, y + h * 0.5);
  ctx.closePath();
  ctx.fill();

  // Roof shading strokes.
  ctx.strokeStyle = 'rgba(20, 14, 10, 0.25)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    ctx.beginPath();
    ctx.moveTo(lerp(x - 8, x + w / 2, t), lerp(y + h * 0.45, y - 6, t));
    ctx.lineTo(lerp(x + w * 0.5, x + w + 8, t), lerp(y - 6, y + h * 0.45, t));
    ctx.stroke();
  }

  if (church) {
    // Steeple.
    ctx.fillStyle = '#5d5d6a';
    ctx.fillRect(x + w * 0.42, y - 52, w * 0.16, 52);
    ctx.fillStyle = '#41414e';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.4, y - 52);
    ctx.lineTo(x + w * 0.5, y - 84);
    ctx.lineTo(x + w * 0.6, y - 52);
    ctx.closePath();
    ctx.fill();
    // Rose window.
    ctx.fillStyle = 'rgba(255, 196, 120, 0.55)';
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.62, 15, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,26,24,0.7)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Windows + door.
  const winY = y + h * 0.62;
  const flicker = 0.75 + Math.sin(game.time * 3 + p.x) * 0.1;
  for (const dx of [w * 0.24, w * 0.76]) {
    ctx.fillStyle = `rgba(255, 198, 118, ${0.5 * flicker})`;
    ctx.fillRect(x + dx - 9, winY - 10, 18, 20);
    ctx.strokeStyle = 'rgba(40, 28, 20, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + dx - 9, winY - 10, 18, 20);
    ctx.beginPath();
    ctx.moveTo(x + dx, winY - 10);
    ctx.lineTo(x + dx, winY + 10);
    ctx.moveTo(x + dx - 9, winY);
    ctx.lineTo(x + dx + 9, winY);
    ctx.stroke();
  }
  if (!church) {
    ctx.fillStyle = '#3a2a1e';
    ctx.beginPath();
    ctx.roundRect(x + w / 2 - 14, y + h * 0.72, 28, h * 0.28, [6, 6, 0, 0]);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 214, 150, 0.18)';
    ctx.fillRect(x + w / 2 - 14, y + h * 0.72 + h * 0.14, 28, 3);
  }

  ctx.strokeStyle = 'rgba(16, 12, 10, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y + h * 0.42, w, h * 0.58);
}

function drawFence(ctx, p, pal) {
  const { x, y, w } = p;
  const len = w;
  ctx.strokeStyle = '#3f3025';
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (p.vertical) {
    ctx.moveTo(x - 2, y);
    ctx.lineTo(x - 2, y + len);
    ctx.stroke();
    ctx.strokeStyle = '#5a4534';
    ctx.lineWidth = 2.4;
    for (let i = 0; i < len; i += 46) {
      ctx.beginPath();
      ctx.moveTo(x - 7, y + i);
      ctx.lineTo(x + 7, y + i);
      ctx.stroke();
    }
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
    ctx.strokeStyle = '#5a4534';
    ctx.lineWidth = 2.4;
    for (let i = 0; i < len; i += 46) {
      ctx.beginPath();
      ctx.moveTo(x + i, y - 7);
      ctx.lineTo(x + i, y + 7);
      ctx.stroke();
    }
  }
  void pal;
}

function drawHaystack(ctx, p, pal) {
  const s = p.s || 1;
  shadowEllipse(ctx, p.x + 2, p.y + 2, 28 * s, 8 * s, 0.3);
  const g = ctx.createLinearGradient(p.x, p.y - 40 * s, p.x, p.y);
  g.addColorStop(0, '#b99b52');
  g.addColorStop(1, '#7d6734');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 4 * s, 26 * s, 26 * s, 0, Math.PI, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(70, 55, 20, 0.4)';
  ctx.lineWidth = 1.4;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(p.x + i * 6 * s, p.y - 6 * s);
    ctx.lineTo(p.x + i * 6 * s + 2, p.y - 26 * s);
    ctx.stroke();
  }
  void pal;
}

function drawWell(ctx, p, pal) {
  shadowEllipse(ctx, p.x, p.y + 4, 30, 9, 0.35);
  ctx.fillStyle = '#6b6a63';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 4, 26, 12, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#1b2426';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 6, 18, 8, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#4a453c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.x - 22, p.y - 8);
  ctx.lineTo(p.x - 18, p.y - 44);
  ctx.moveTo(p.x + 22, p.y - 8);
  ctx.lineTo(p.x + 18, p.y - 44);
  ctx.stroke();
  ctx.fillStyle = pal.roof;
  ctx.beginPath();
  ctx.moveTo(p.x - 28, p.y - 44);
  ctx.lineTo(p.x, p.y - 60);
  ctx.lineTo(p.x + 28, p.y - 44);
  ctx.closePath();
  ctx.fill();
}

function drawPillar(ctx, p, pal) {
  const s = p.s || 1;
  shadowEllipse(ctx, p.x + 3, p.y + 3, 22 * s, 8 * s, 0.4);
  const g = ctx.createLinearGradient(p.x - 18 * s, 0, p.x + 18 * s, 0);
  g.addColorStop(0, '#4b4e5d');
  g.addColorStop(0.4, '#767a8c');
  g.addColorStop(1, '#383b47');
  ctx.fillStyle = g;
  ctx.fillRect(p.x - 16 * s, p.y - 70 * s, 32 * s, 70 * s);
  ctx.fillStyle = '#82869a';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 70 * s, 16 * s, 6 * s, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#5a5d6c';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 16 * s, 6 * s, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(10,12,18,0.35)';
  ctx.lineWidth = 1.4;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(p.x - 16 * s, p.y - i * 17 * s);
    ctx.lineTo(p.x + 16 * s, p.y - i * 17 * s);
    ctx.stroke();
  }
  void pal;
}

function drawGrave(ctx, p, pal) {
  shadowEllipse(ctx, p.x + 2, p.y + 2, 14, 5, 0.35);
  ctx.fillStyle = '#585c66';
  ctx.beginPath();
  ctx.roundRect(p.x - 10, p.y - 22, 20, 22, [8, 8, 2, 2]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 210, 230, 0.16)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  void pal;
}

function drawUrn(ctx, p) {
  shadowEllipse(ctx, p.x, p.y, 10, 4, 0.4);
  const g = ctx.createLinearGradient(p.x, p.y - 26, p.x, p.y);
  g.addColorStop(0, '#6a6472');
  g.addColorStop(1, '#3a3642');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(p.x - 4, p.y - 24);
  ctx.quadraticCurveTo(p.x - 12, p.y - 16, p.x - 8, p.y - 2);
  ctx.lineTo(p.x + 8, p.y - 2);
  ctx.quadraticCurveTo(p.x + 12, p.y - 16, p.x + 4, p.y - 24);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(180, 190, 210, 0.18)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = '#2c2933';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 24, 4, 2, 0, 0, TAU);
  ctx.fill();
}

function drawBones(ctx, p) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#b9b7a8';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x - 12, p.y - 2);
  ctx.lineTo(p.x + 2, p.y + 2);
  ctx.moveTo(p.x + 6, p.y - 4);
  ctx.lineTo(p.x + 16, p.y + 3);
  ctx.moveTo(p.x + 4, p.y + 4);
  ctx.quadraticCurveTo(p.x + 10, p.y - 4, p.x + 14, p.y + 1);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#c6c3b2';
  ctx.beginPath();
  ctx.arc(p.x + 18, p.y + 2, 3.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/* ----------------------------------------------------------------- objects */

function drawStatue(ctx, s, game) {
  const t = game.time;
  shadowEllipse(ctx, s.x, s.y + 2, 18, 6, 0.4);
  ctx.save();
  ctx.translate(s.x, s.y);
  const g = ctx.createLinearGradient(0, -40, 0, 0);
  g.addColorStop(0, '#8e93a6');
  g.addColorStop(1, '#4a4e5e');
  ctx.fillStyle = g;
  // Cloaked figure turned to stone.
  ctx.beginPath();
  ctx.moveTo(0, -38);
  ctx.quadraticCurveTo(-16, -22, -14, 0);
  ctx.quadraticCurveTo(0, 4, 14, 0);
  ctx.quadraticCurveTo(16, -22, 0, -38);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -44, 9, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,22,28,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-6, -30);
  ctx.lineTo(-2, -18);
  ctx.moveTo(5, -34);
  ctx.lineTo(3, -20);
  ctx.stroke();
  // Faint glow of someone still inside.
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + s.x);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const rg = ctx.createRadialGradient(0, -26, 2, 0, -26, 30);
  rg.addColorStop(0, `rgba(190, 220, 255, ${0.12 * pulse})`);
  rg.addColorStop(1, 'rgba(190, 220, 255, 0)');
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.arc(0, -26, 30, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();
  // Name plate.
  ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(210, 220, 240, 0.36)';
  ctx.fillText(s.name, s.x, s.y - 56);
  ctx.textAlign = 'left';
}

function drawChest(ctx, c, game) {
  if (c.opened) {
    shadowEllipse(ctx, c.x, c.y + 2, 16, 5, 0.3);
    ctx.fillStyle = '#4a382a';
    ctx.beginPath();
    ctx.roundRect(c.x - 16, c.y - 16, 32, 16, 3);
    ctx.fill();
    return;
  }
  shadowEllipse(ctx, c.x, c.y + 2, 17, 5, 0.35);
  const bob = Math.sin(game.time * 2 + c.x) * 1.2;
  ctx.fillStyle = '#6a4d32';
  ctx.beginPath();
  ctx.roundRect(c.x - 16, c.y - 24 + bob, 32, 24, [4, 4, 2, 2]);
  ctx.fill();
  ctx.fillStyle = '#8a6742';
  ctx.beginPath();
  ctx.roundRect(c.x - 16, c.y - 30 + bob, 32, 12, [8, 8, 0, 0]);
  ctx.fill();
  ctx.strokeStyle = '#d8b264';
  ctx.lineWidth = 2;
  ctx.strokeRect(c.x - 16, c.y - 24 + bob, 32, 24);
  ctx.fillStyle = '#f0d38a';
  ctx.fillRect(c.x - 3, c.y - 20 + bob, 6, 8);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(c.x, c.y - 20, 2, c.x, c.y - 20, 40);
  g.addColorStop(0, `rgba(255, 220, 140, ${0.16 + 0.08 * Math.sin(game.time * 3)})`);
  g.addColorStop(1, 'rgba(255, 220, 140, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c.x, c.y - 20, 40, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBrazier(ctx, b, game) {
  const lit = b.lit;
  const t = game.time;
  const great = b.kind === 'great';
  const s = great ? 1.55 : 1;

  if (great) {
    // Ring of stones around the village hearth.
    ctx.fillStyle = 'rgba(24, 26, 30, 0.5)';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 4, 62, 26, 0, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const px = b.x + Math.cos(a) * 54;
      const py = b.y + 4 + Math.sin(a) * 22;
      ctx.fillStyle = i % 2 ? '#585c62' : '#4b4f57';
      ctx.beginPath();
      ctx.ellipse(px, py, 9, 6, a, 0, TAU);
      ctx.fill();
    }
  }

  shadowEllipse(ctx, b.x, b.y + 2, 20 * s, 8 * s, 0.4);
  // Pedestal.
  ctx.fillStyle = '#3f424b';
  ctx.beginPath();
  ctx.moveTo(b.x - 18 * s, b.y - 22 * s);
  ctx.lineTo(b.x + 18 * s, b.y - 22 * s);
  ctx.lineTo(b.x + 12 * s, b.y);
  ctx.lineTo(b.x - 12 * s, b.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#575b66';
  ctx.beginPath();
  ctx.ellipse(b.x, b.y - 22 * s, 18 * s, 7 * s, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = lit ? '#2a1a10' : '#1e2026';
  ctx.beginPath();
  ctx.ellipse(b.x, b.y - 22 * s, 12 * s, 4.4 * s, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(160, 150, 130, 0.22)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  if (lit) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const ph = t * 7 + i * 2.1;
      const h = (34 + Math.sin(ph) * 10 + i * 5) * s;
      const w = (13 - i * 2.8) * s;
      const x = b.x + Math.sin(ph * 0.7) * 2.6;
      const base = b.y - 22 * s;
      const g = ctx.createRadialGradient(x, base - h * 0.35, 1, x, base - h * 0.3, h * 0.95);
      g.addColorStop(0, i === 0 ? 'rgba(255, 236, 190, 0.92)' : 'rgba(255, 190, 100, 0.75)');
      g.addColorStop(0.45, i === 0 ? 'rgba(255, 200, 120, 0.72)' : 'rgba(255, 150, 60, 0.55)');
      g.addColorStop(1, 'rgba(255, 110, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, base - h);
      ctx.bezierCurveTo(x + w, base - h * 0.6, x + w * 0.85, base, x, base);
      ctx.bezierCurveTo(x - w * 0.85, base, x - w, base - h * 0.6, x, base - h);
      ctx.fill();
    }
    ctx.restore();
  } else {
    // Cold ash and a faint rune: it can still be lit.
    ctx.fillStyle = 'rgba(120, 118, 112, 0.5)';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y - 21.5 * s, 8 * s, 3 * s, 0, 0, TAU);
    ctx.fill();
    const pulse = 0.4 + 0.4 * Math.sin(t * 2.2);
    ctx.strokeStyle = `rgba(255, 190, 120, ${0.18 + pulse * 0.18})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(b.x, b.y - 26 * s, 9 * s, 0.3, Math.PI - 0.3);
    ctx.stroke();
  }
}

function drawAltar(ctx, a, game) {
  shadowEllipse(ctx, a.x, a.y + 6, 60, 16, 0.45);
  ctx.fillStyle = '#3f4250';
  ctx.beginPath();
  ctx.roundRect(a.x - 46, a.y - 26, 92, 30, 6);
  ctx.fill();
  ctx.fillStyle = '#565a6b';
  ctx.beginPath();
  ctx.roundRect(a.x - 40, a.y - 34, 80, 12, 4);
  ctx.fill();
  const lit = a.lit;
  const t = game.time;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const r = lit ? 120 : 34;
  const g = ctx.createRadialGradient(a.x, a.y - 40, 4, a.x, a.y - 40, r);
  g.addColorStop(0, lit ? `rgba(255, 240, 190, ${0.75 + Math.sin(t * 6) * 0.1})` : 'rgba(255, 190, 120, 0.16)');
  g.addColorStop(1, 'rgba(255, 170, 90, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(a.x, a.y - 40, r, 0, TAU);
  ctx.fill();
  ctx.restore();
  if (!lit) {
    ctx.strokeStyle = 'rgba(255, 210, 150, 0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(a.x, a.y - 40, 12 + Math.sin(t * 3) * 2, 0, TAU);
    ctx.stroke();
  }
}

function drawGate(ctx, g, game) {
  if (g.open) {
    shadowEllipse(ctx, g.x + g.w / 2, g.y + g.h, g.w, 8, 0.25);
    return;
  }
  ctx.fillStyle = '#3a3d49';
  ctx.fillRect(g.x, g.y, g.w, g.h);
  ctx.strokeStyle = '#6c7183';
  ctx.lineWidth = 3;
  for (let y = g.y + 8; y < g.y + g.h; y += 22) {
    ctx.beginPath();
    ctx.moveTo(g.x + 3, y);
    ctx.lineTo(g.x + g.w - 3, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(200, 170, 110, 0.35)';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(g.x + 2, g.y + 2, g.w - 4, g.h - 4);
  void game;
}

function drawRubble(ctx, r, game) {
  if (r.broken) {
    ctx.fillStyle = 'rgba(90, 92, 100, 0.35)';
    for (let i = 0; i < 12; i++) {
      const x = r.x + ((i * 37) % r.w);
      const y = r.y + r.h - ((i * 17) % 12);
      ctx.beginPath();
      ctx.ellipse(x, y, 4 + (i % 3), 2.5, 0, 0, TAU);
      ctx.fill();
    }
    return;
  }
  shadowEllipse(ctx, r.x + r.w / 2, r.y + r.h - 2, r.w * 0.5, 12, 0.4);
  for (let i = 0; i < 16; i++) {
    const x = r.x + ((i * 53) % r.w);
    const y = r.y + r.h - ((i * 29) % (r.h - 6));
    const s = 9 + (i % 4) * 5;
    ctx.fillStyle = i % 3 === 0 ? '#6d707c' : i % 3 === 1 ? '#565965' : '#7d808c';
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * 0.66, (i % 5) * 0.5, 0, TAU);
    ctx.fill();
  }
  const pulse = 0.5 + 0.5 * Math.sin(game.time * 2);
  ctx.strokeStyle = `rgba(255, 200, 140, ${0.12 * pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r.x + r.w * 0.3, r.y + r.h * 0.8);
  ctx.lineTo(r.x + r.w * 0.45, r.y + r.h * 0.5);
  ctx.lineTo(r.x + r.w * 0.6, r.y + r.h * 0.7);
  ctx.stroke();
}

function drawBramble(ctx, b, game) {
  if (b.burnt) {
    ctx.strokeStyle = 'rgba(60, 50, 40, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x + b.w * 0.2, b.y + b.h);
    ctx.quadraticCurveTo(b.x + b.w * 0.4, b.y + b.h * 0.6, b.x + b.w * 0.5, b.y + b.h);
    ctx.moveTo(b.x + b.w * 0.6, b.y + b.h);
    ctx.quadraticCurveTo(b.x + b.w * 0.8, b.y + b.h * 0.5, b.x + b.w * 0.85, b.y + b.h);
    ctx.stroke();
    return;
  }
  const t = game.time;
  ctx.save();
  ctx.globalAlpha = 0.92;
  for (let i = 0; i < 16; i++) {
    const px = b.x + ((i * 41) % b.w);
    const py = b.y + b.h - ((i * 23) % (b.h - 8));
    const a = Math.sin(t * 1.5 + i) * 0.3;
    ctx.strokeStyle = i % 3 ? '#2c3a2c' : '#3e4a34';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + Math.cos(a) * 16, py - 14, px + Math.cos(a) * 26, py - 24 - (i % 3) * 6);
    ctx.stroke();
    ctx.fillStyle = '#4a5a3a';
    ctx.beginPath();
    ctx.arc(px + Math.cos(a) * 26, py - 24 - (i % 3) * 6, 2.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawSwitch(ctx, s, game) {
  shadowEllipse(ctx, s.x, s.y + 16, 14, 5, 0.35);
  ctx.fillStyle = s.hit ? '#6c5a3a' : '#4c5262';
  ctx.beginPath();
  ctx.roundRect(s.x - 12, s.y - 16, 24, 30, 4);
  ctx.fill();
  const pulse = s.hit ? 1 : 0.4 + 0.4 * Math.sin(game.time * 3);
  ctx.fillStyle = s.hit ? 'rgba(255, 220, 150, 0.95)' : `rgba(180, 200, 255, ${0.5 * pulse})`;
  ctx.beginPath();
  ctx.arc(s.x, s.y - 2, 5.5, 0, TAU);
  ctx.fill();
}

function drawCryptDoor(ctx, d, game) {
  shadowEllipse(ctx, d.x + d.w / 2, d.y + d.h, d.w * 0.6, 10, 0.4);
  ctx.fillStyle = '#3d3a42';
  ctx.beginPath();
  ctx.roundRect(d.x, d.y, d.w, d.h, [26, 26, 2, 2]);
  ctx.fill();
  ctx.strokeStyle = '#6a6570';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 200, 120, 0.18)';
  ctx.fillRect(d.x + d.w / 2 - 10, d.y + 12, 20, d.h - 12);
  const locked = !game.flags.cryptKey;
  ctx.strokeStyle = locked ? 'rgba(220, 180, 120, 0.5)' : 'rgba(255, 230, 170, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(d.x + d.w / 2, d.y + d.h * 0.62, 6, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(230, 225, 210, 0.55)';
  ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(locked ? 'Låst' : 'Öppna', d.x + d.w / 2, d.y - 10);
  ctx.textAlign = 'left';
}

/* ------------------------------------------------------------------- folk */

function drawNpc(ctx, n, game) {
  const t = game.time;
  const bob = Math.sin(t * 2 + n.x * 0.05) * 1.2;
  shadowEllipse(ctx, n.x, n.y - 1, 13, 5, 0.35);
  const palettes = {
    warm: ['#7a5a44', '#b19165'],
    smith: ['#4a4a55', '#8d7a5f'],
    green: ['#3f5a44', '#8fae86'],
    blue: ['#3f4a63', '#93a8c6'],
    red: ['#6a3a3a', '#bd8272'],
  };
  const [cloak, trim] = palettes[n.palette] || palettes.warm;
  ctx.save();
  ctx.translate(n.x, n.y + bob);

  // Cloak.
  const g = ctx.createLinearGradient(0, -38, 0, 0);
  g.addColorStop(0, cloak);
  g.addColorStop(1, 'rgba(12, 16, 20, 0.9)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -38);
  ctx.quadraticCurveTo(-10, -32, -9, -16);
  ctx.quadraticCurveTo(-12, -5, -12, -1);
  ctx.quadraticCurveTo(-5, 3, 0, 2);
  ctx.quadraticCurveTo(6, 3, 12, -1);
  ctx.quadraticCurveTo(10, -6, 9, -16);
  ctx.quadraticCurveTo(10, -32, 0, -38);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = trim;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Head + hood.
  ctx.fillStyle = '#e6dccb';
  ctx.beginPath();
  ctx.arc(0, -44, 6.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2a2420';
  ctx.beginPath();
  ctx.arc(-2.2, -45, 1.15, 0, TAU);
  ctx.arc(2.2, -45, 1.15, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30, 24, 20, 0.75)';
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.arc(0, -44, 7, Math.PI * 0.94, Math.PI * 2.06);
  ctx.stroke();

  // Arms crossed in front.
  ctx.strokeStyle = trim;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, -30);
  ctx.lineTo(4, -24);
  ctx.moveTo(6, -30);
  ctx.lineTo(-3, -23);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
  ctx.restore();

  // Shop marker.
  if (n.shop) {
    const y = n.y - 62 + Math.sin(t * 2) * 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gg = ctx.createRadialGradient(n.x, y, 1, n.x, y, 18);
    gg.addColorStop(0, 'rgba(255, 214, 140, 0.5)');
    gg.addColorStop(1, 'rgba(255, 214, 140, 0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(n.x, y, 18, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath();
    ctx.arc(n.x, y, 2.6, 0, TAU);
    ctx.fill();
  }

  ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(240, 235, 220, 0.34)';
  ctx.fillText(n.name, n.x, n.y - 58);
  ctx.textAlign = 'left';
}

function drawPlayer(ctx, game) {
  const p = game.player;
  const b = p.body;
  const t = game.time;
  const f = p.facing;
  const moving = Math.hypot(b.vx, b.vy) > 20;
  const bob = moving ? Math.sin(p.step * 2) * 1.6 : Math.sin(t * 2) * 0.7;

  shadowEllipse(ctx, b.cx, b.y + b.h - 1, 14, 5.5, 0.42);

  ctx.save();
  ctx.translate(b.cx, b.y + b.h + bob);
  if (p.invuln > 0 && p.dodgeT <= 0 && Math.floor(t * 18) % 2 === 0) ctx.globalAlpha = 0.6;

  // Feet.
  const swing = moving ? Math.sin(p.step * 2) * 3.4 : 0;
  ctx.fillStyle = '#141b22';
  ctx.beginPath();
  ctx.ellipse(-4.5, -1 + swing * 0.3, 3.6, 2.4, 0, 0, TAU);
  ctx.ellipse(4.5, -1 - swing * 0.3, 3.6, 2.4, 0, 0, TAU);
  ctx.fill();

  // Cloak: narrow shoulders, flared hem.
  const g = ctx.createLinearGradient(0, -40, 0, 0);
  g.addColorStop(0, '#41586d');
  g.addColorStop(0.45, '#2a3947');
  g.addColorStop(1, '#161f28');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.quadraticCurveTo(-11, -34, -10, -18);
  ctx.quadraticCurveTo(-13, -6, -14, -1);
  ctx.quadraticCurveTo(-6, 3, 0, 2);
  ctx.quadraticCurveTo(7, 3, 14, -1);
  ctx.quadraticCurveTo(12, -8, 10, -18);
  ctx.quadraticCurveTo(11, -34, 0, -40);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(10, 14, 18, 0.55)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // Cloak fold highlights.
  ctx.strokeStyle = 'rgba(150, 190, 220, 0.16)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-3, -34);
  ctx.quadraticCurveTo(-6, -20, -7, -6);
  ctx.moveTo(4, -33);
  ctx.quadraticCurveTo(7, -20, 8, -7);
  ctx.stroke();

  // Rim light from the lantern side.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255, 206, 140, 0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -39);
  ctx.quadraticCurveTo(-11, -33, -10, -17);
  ctx.quadraticCurveTo(-13, -6, -13, -2);
  ctx.stroke();
  ctx.restore();

  // Belt + lantern at the hip.
  ctx.fillStyle = '#6b5433';
  ctx.fillRect(-9, -14, 18, 2.6);
  const lx = Math.cos(f + 2.1) * 10;
  const ly = Math.sin(f + 1.9) * 4 - 15;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(lx, ly, 1, lx, ly, 16);
  lg.addColorStop(0, 'rgba(255, 220, 150, 0.8)');
  lg.addColorStop(1, 'rgba(255, 190, 110, 0)');
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.arc(lx, ly, 16, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#ffdfa0';
  ctx.beginPath();
  ctx.arc(lx, ly, 2.6, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#2b2620';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Head with hood.
  const hx = Math.cos(f) * 2.2;
  const hy = -47;
  ctx.fillStyle = '#efe7d8';
  ctx.beginPath();
  ctx.arc(hx, hy, 6.4, 0, TAU);
  ctx.fill();
  // Eyes.
  const ex = Math.cos(f) * 2.1;
  const ey = Math.sin(f) * 1.3 + 0.5;
  ctx.fillStyle = '#26303a';
  ctx.beginPath();
  ctx.arc(hx + ex - 2.1, hy + ey, 1.2, 0, TAU);
  ctx.arc(hx + ex + 2.1, hy + ey, 1.2, 0, TAU);
  ctx.fill();
  // Hood behind the head.
  ctx.strokeStyle = '#33475a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(hx, hy, 7.2, Math.PI * 0.92, Math.PI * 2.08);
  ctx.stroke();
  // Hood point.
  ctx.fillStyle = '#2b3d4d';
  ctx.beginPath();
  ctx.moveTo(hx - 6, hy - 5);
  ctx.quadraticCurveTo(hx, hy - 14, hx + 6, hy - 5);
  ctx.quadraticCurveTo(hx, hy - 8, hx - 6, hy - 5);
  ctx.fill();

  // Arms + sword.
  const swingT = p.swingT > 0 ? 1 - p.swingT / 0.22 : 0;
  const armAng = p.shielding ? f + 0.9 : f + lerp(-1.0, 1.1, swingT) * 0.6;
  ctx.strokeStyle = '#2a3947';
  ctx.lineWidth = 4.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -32);
  ctx.lineTo(Math.cos(armAng) * 9, -32 + Math.sin(armAng) * 8);
  ctx.stroke();
  ctx.lineCap = 'butt';

  const handX = Math.cos(armAng) * 10;
  const handY = -32 + Math.sin(armAng) * 9;
  const bladeAng = p.shielding ? f : f + lerp(-0.7, 0.9, swingT);
  ctx.strokeStyle = '#cfdae6';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(handX + Math.cos(bladeAng) * (13 + swingT * 9), handY + Math.sin(bladeAng) * (13 + swingT * 9));
  ctx.stroke();
  ctx.strokeStyle = '#a88a52';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(handX + Math.cos(bladeAng) * 4, handY + Math.sin(bladeAng) * 4);
  ctx.lineTo(handX + Math.cos(bladeAng + 1.4) * 5, handY + Math.sin(bladeAng + 1.4) * 5);
  ctx.stroke();
  ctx.fillStyle = '#efe7d8';
  ctx.beginPath();
  ctx.arc(handX, handY, 2.4, 0, TAU);
  ctx.fill();

  // Shield.
  if (p.shielding || p.parryT > 0) {
    ctx.save();
    ctx.translate(Math.cos(f) * 12, -30 + Math.sin(f) * 9);
    ctx.rotate(f);
    ctx.fillStyle = 'rgba(126, 166, 206, 0.6)';
    ctx.beginPath();
    ctx.roundRect(-3, -9, 8, 18, 3.5);
    ctx.fill();
    ctx.strokeStyle = p.parryT > 0 ? 'rgba(255, 244, 200, 0.98)' : 'rgba(185, 220, 250, 0.65)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    if (p.parryT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255, 235, 170, 0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Counter window: a warm ring around the hero.
  if (p.counter > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255, 220, 140, ${0.18 + 0.12 * Math.sin(t * 12)})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, -22, 20, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  if (p.burnT > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255, 140, 60, ${0.25 * p.burnT})`;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, 18, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawEnemy(ctx, e, game) {
  const b = e.body;
  const t = game.time;
  const wind = e.state === 'windup';
  const charge = wind ? clamp(e.stateT / e.def.windup, 0, 1) : 0;

  shadowEllipse(ctx, b.cx, b.y + b.h - 1, b.w * 0.5, 6, 0.45);

  if (e.kind === 'crawler') {
    ctx.save();
    ctx.translate(b.cx, b.cy + Math.sin(e.bob * 3) * 1.2);
    ctx.rotate(e.facing);
    // Legs.
    ctx.strokeStyle = '#1a1a26';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * (11 + Math.sin(e.bob * 6 + i) * 2), Math.sin(a) * 6);
      ctx.stroke();
    }
    ctx.fillStyle = e.flash > 0 ? '#ffd9a0' : '#2a2436';
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 7, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 90, 90, 0.95)';
    ctx.beginPath();
    ctx.arc(6, -2, 1.8, 0, TAU);
    ctx.arc(6, 2, 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  } else if (e.kind === 'guard') {
    ctx.save();
    ctx.translate(b.cx, b.cy);
    const g = ctx.createLinearGradient(0, -24, 0, 22);
    g.addColorStop(0, '#6e7285');
    g.addColorStop(1, '#33363f');
    ctx.fillStyle = e.flash > 0 ? '#ffe0b0' : g;
    ctx.beginPath();
    ctx.roundRect(-18, -20, 36, 40, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(12,14,20,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = wind ? `rgba(255, ${120 - charge * 80}, 80, 1)` : 'rgba(160, 210, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(-6, -8, 2.4, 0, TAU);
    ctx.arc(6, -8, 2.4, 0, TAU);
    ctx.fill();
    // Rune.
    ctx.strokeStyle = 'rgba(180, 210, 255, 0.4)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 6, 6, 0, TAU);
    ctx.stroke();
    ctx.restore();
  } else if (e.kind === 'warden') {
    drawWarden(ctx, e, game, charge);
  } else {
    // Shadow.
    const r = e.def.r;
    ctx.save();
    ctx.translate(b.cx, b.cy);
    const flick = Math.sin(e.bob * 2) * 2;
    const gg = ctx.createRadialGradient(0, -4, 2, 0, -4, r + 8);
    gg.addColorStop(0, e.flash > 0 ? 'rgba(255, 220, 170, 0.95)' : 'rgba(44, 38, 66, 0.95)');
    gg.addColorStop(0.7, e.flash > 0 ? 'rgba(255, 170, 120, 0.6)' : 'rgba(20, 18, 32, 0.9)');
    gg.addColorStop(1, 'rgba(12, 10, 20, 0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.ellipse(0, flick * 0.4, r + 5, r + 8, 0, 0, TAU);
    ctx.fill();
    // Cold rim so the shape still reads in the dark.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rim = ctx.createRadialGradient(0, -6, r * 0.5, 0, -6, r + 12);
    rim.addColorStop(0, 'rgba(90, 70, 150, 0)');
    rim.addColorStop(0.8, 'rgba(120, 95, 190, 0.1)');
    rim.addColorStop(1, 'rgba(120, 95, 190, 0)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, -6, r + 12, 0, TAU);
    ctx.fill();
    ctx.restore();
    // Tattered edges.
    ctx.fillStyle = 'rgba(16, 14, 26, 0.85)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + e.bob * 0.3;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * (r - 2), Math.sin(a) * (r - 4) + flick, 5, 7, a, 0, TAU);
      ctx.fill();
    }
    // Eyes.
    const eyeGlow = wind ? `rgba(255, ${160 - charge * 90}, 90, 1)` : 'rgba(255, 120, 120, 0.95)';
    ctx.fillStyle = eyeGlow;
    const ex = Math.cos(e.facing) * 3;
    const ey = Math.sin(e.facing) * 2 - 3;
    ctx.beginPath();
    ctx.ellipse(ex - 4, ey, 2.2, 3, 0, 0, TAU);
    ctx.ellipse(ex + 4, ey, 2.2, 3, 0, 0, TAU);
    ctx.fill();
    if (wind) {
      ctx.strokeStyle = `rgba(255, 120, 90, ${0.3 + charge * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r + 8 + charge * 8, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Health pips for tough enemies.
  if ((e.kind === 'guard' || e.kind === 'warden') && e.hp < e.maxHp) {
    const w = e.kind === 'warden' ? 120 : 44;
    const x = b.cx - w / 2;
    const y = b.y - (e.kind === 'warden' ? 30 : 16);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = '#e8c07a';
    ctx.fillRect(x, y, w * clamp(e.hp / e.maxHp, 0, 1), 4);
  }
  void t;
}

function drawWarden(ctx, e, game, charge) {
  const b = e.body;
  const t = game.time;
  ctx.save();
  ctx.translate(b.cx, b.cy + Math.sin(t * 1.6) * 2);
  const r = 40;
  const g = ctx.createRadialGradient(0, -10, 4, 0, -10, r + 22);
  g.addColorStop(0, e.flash > 0 ? 'rgba(255, 220, 180, 0.95)' : 'rgba(52, 40, 74, 0.96)');
  g.addColorStop(0.6, 'rgba(22, 16, 34, 0.94)');
  g.addColorStop(1, 'rgba(10, 8, 18, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r + 8, r + 12, 0, 0, TAU);
  ctx.fill();

  // Crown of shards.
  ctx.fillStyle = 'rgba(70, 56, 96, 0.95)';
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.85 + (i / 6) * Math.PI * 0.7;
    const x = Math.cos(a) * (r - 6);
    const y = Math.sin(a) * (r - 10) - 10;
    ctx.beginPath();
    ctx.moveTo(x - 5, y + 12);
    ctx.lineTo(x, y - 16 - (i % 2) * 8);
    ctx.lineTo(x + 5, y + 12);
    ctx.closePath();
    ctx.fill();
  }

  // Arms.
  const swing = e.state === 'windup' ? -0.5 - charge * 0.8 : Math.sin(t * 2) * 0.2;
  ctx.strokeStyle = 'rgba(26, 20, 40, 0.95)';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, -6);
  ctx.lineTo(-30 - Math.cos(swing) * 12, 6 + Math.sin(swing) * 10);
  ctx.moveTo(16, -6);
  ctx.lineTo(30 + Math.cos(swing) * 12, 6 - Math.sin(swing) * 10);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Eyes.
  ctx.fillStyle = e.state === 'windup' ? `rgba(255, ${150 - charge * 100}, 80, 1)` : 'rgba(255, 130, 120, 0.95)';
  ctx.beginPath();
  ctx.ellipse(-10, -8, 4, 6, 0, 0, TAU);
  ctx.ellipse(10, -8, 4, 6, 0, 0, TAU);
  ctx.fill();

  if (e.state === 'windup') {
    ctx.strokeStyle = `rgba(255, 110, 80, ${0.25 + charge * 0.6})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r + 16 + charge * 14, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
  void game;
}

function drawProjectile(ctx, pr, game) {
  const t = game.time;
  if (pr.kind === 'flame') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(pr.x, pr.y, 1, pr.x, pr.y, 26 + Math.sin(t * 20) * 3);
    g.addColorStop(0, 'rgba(255, 245, 210, 0.95)');
    g.addColorStop(0.4, 'rgba(255, 170, 80, 0.6)');
    g.addColorStop(1, 'rgba(255, 120, 40, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, 26, 0, TAU);
    ctx.fill();
    ctx.restore();
  } else if (pr.kind === 'bomb') {
    const blink = pr.life < 0.5 ? (Math.floor(pr.life * 16) % 2 === 0) : true;
    ctx.fillStyle = '#232632';
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, 10, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#4a4f62';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (blink) {
      ctx.fillStyle = 'rgba(255, 120, 80, 0.95)';
      ctx.beginPath();
      ctx.arc(pr.x + 2, pr.y - 10, 2.6, 0, TAU);
      ctx.fill();
    }
  } else if (pr.kind === 'arrow') {
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(Math.atan2(pr.vy, pr.vx));
    ctx.strokeStyle = '#d8c9a4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(6, 0);
    ctx.stroke();
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(2, -3.4);
    ctx.lineTo(2, 3.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    void game;
  }
}

/* --------------------------------------------------------------- fx layers */

function drawParticles(ctx, game) {
  for (const p of game.particles) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawEffect(ctx, e, game) {
  const k = 1 - e.life / e.maxLife;
  if (e.type === 'swing' || e.type === 'strike') {
    const a0 = e.a - 1.1 + k * 1.9;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = e.type === 'strike' ? `rgba(255, 110, 80, ${(1 - k) * 0.75})` : `rgba(200, 230, 255, ${(1 - k) * 0.8})`;
    ctx.lineWidth = e.big ? 12 : 6;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.reach * (0.55 + k * 0.45), a0, a0 + 1.5);
    ctx.stroke();
    ctx.restore();
  } else if (e.type === 'parry') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = 20 + k * 46;
    ctx.strokeStyle = `rgba(255, 238, 180, ${(1 - k) * 0.9})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(a) * r * 0.7, e.y + Math.sin(a) * r * 0.7);
      ctx.lineTo(e.x + Math.cos(a) * r * 1.15, e.y + Math.sin(a) * r * 1.15);
      ctx.stroke();
    }
    ctx.restore();
  } else if (e.type === 'bomb') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = e.r * (0.3 + k * 0.9);
    const g = ctx.createRadialGradient(e.x, e.y, 4, e.x, e.y, r);
    g.addColorStop(0, `rgba(255, 245, 200, ${(1 - k) * 0.8})`);
    g.addColorStop(0.5, `rgba(255, 160, 70, ${(1 - k) * 0.5})`);
    g.addColorStop(1, 'rgba(255, 120, 40, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  void game;
}

/* ---------------------------------------------------------------- lighting */

export function drawLighting(ctx, game, camX, camY) {
  const zone = game.zoneDef;
  const dark = zone.dark ?? 0.5;
  const dpr = game.dpr;
  const w = game.w;
  const h = game.h;
  const lc = game.lightCtx;
  lc.setTransform(dpr, 0, 0, dpr, 0, 0);
  lc.clearRect(0, 0, w, h);

  const tint = zone.theme === 'crypt' ? '4, 5, 12' : '8, 12, 22';
  lc.fillStyle = `rgba(${tint}, ${dark})`;
  lc.fillRect(0, 0, w, h);
  lc.globalCompositeOperation = 'destination-out';

  const z = game.zoom;
  const toScreen = (x, y) => ({ x: (x - camX) * z, y: (y - camY) * z });

  for (const l of game.lightsCache) {
    const s = toScreen(l.x, l.y);
    const r = l.r * z;
    if (s.x + r < 0 || s.x - r > w || s.y + r < 0 || s.y - r > h) continue;
    const g = lc.createRadialGradient(s.x, s.y, r * 0.05, s.x, s.y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.96)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.72)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath();
    lc.arc(s.x, s.y, r, 0, TAU);
    lc.fill();
  }
  lc.globalCompositeOperation = 'source-over';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(game.lightCanvas, 0, 0, w, h);

  // Warm additive glow pass.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const l of game.lightsCache) {
    const s = toScreen(l.x, l.y);
    const r = l.r * z * 0.85;
    const warm = l.warm ?? 0.8;
    const g = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, r);
    const isPlayer = l.player;
    g.addColorStop(0, isPlayer ? `rgba(255, 216, 150, ${0.075 * warm})` : `rgba(255, 190, 110, ${0.2 * warm})`);
    g.addColorStop(0.4, isPlayer ? 'rgba(255, 210, 150, 0.03)' : `rgba(255, 160, 80, ${0.09 * warm})`);
    g.addColorStop(1, 'rgba(255, 150, 70, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Damage flash and vignette.
  if (game.flash > 0) {
    ctx.fillStyle = `rgba(255, 90, 70, ${game.flash * 0.35})`;
    ctx.fillRect(0, 0, w, h);
  }
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

export function drawEffectLayer(ctx, game, camX, camY) {
  const dpr = game.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = game.w;
  const h = game.h;

  // Transition fade.
  if (game.fade > 0) {
    ctx.fillStyle = `rgba(4, 6, 10, ${Math.min(1, game.fade)})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Off-screen hint arrows toward unfound things? Keep the frame clean.

  // Low health pulse.
  const p = game.player;
  if (p.hp <= 1 && game.mode === 'play') {
    const pulse = 0.12 + 0.08 * Math.sin(game.time * 5);
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(150, 20, 20, ${pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  void camX;
  void camY;
  void dist;
  void angleDiff;
}
