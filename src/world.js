// Level geometry and entity placement for the cave.
// Everything is axis-aligned rectangles; the renderer turns them into rock.

export const WORLD = { w: 5400, h: 2400 };

/** Rock slab. `ceil` gets stalactites, `floor` gets moss and pebbles. */
const slab = (x, y, w, h, kind = 'rock') => ({ x, y, w, h, kind });

export const SOLIDS = [
  // ---- world shell -------------------------------------------------
  slab(-400, -800, 400, 3400, 'rock'),
  slab(WORLD.w, -800, 400, 3400, 'rock'),
  slab(-800, -900, WORLD.w + 1600, 900, 'ceil'),
  slab(-800, WORLD.h, WORLD.w + 1600, 400, 'rock'),

  // ---- area 1: Den sjunkna brunnen --------------------------------
  slab(-400, 1150, 1970, 300, 'ceil'),
  slab(-400, 1900, 1970, 500, 'floor'),

  // ---- trappan upp mot andra valvet -------------------------------
  slab(1570, 1810, 160, 590, 'floor'),
  slab(1730, 1720, 160, 680, 'floor'),
  slab(1890, 1630, 160, 770, 'floor'),
  slab(2050, 1540, 260, 860, 'floor'),

  // ---- area 2: Valvet med lyktorna --------------------------------
  slab(2210, 1540, 530, 860, 'floor'),
  slab(2740, 1740, 320, 660, 'floor'), // gropens botten (grund nog att klättra ur)
  slab(3060, 1540, 480, 860, 'floor'),

  slab(2210, 1360, 180, 44, 'floor'),
  slab(2450, 1180, 170, 44, 'floor'),
  slab(2630, 1000, 180, 44, 'floor'),
  slab(2780, 900, 300, 54, 'floor'), // avsats med bänk

  slab(1570, 520, 1990, 220, 'ceil'),

  // ---- area 3: Väktarens hall -------------------------------------
  slab(3540, 1540, 1860, 860, 'floor'),
  slab(3540, 480, 1860, 320, 'ceil'),

  slab(3720, 1380, 170, 40, 'floor'),
  slab(3960, 1200, 170, 40, 'floor'),
  slab(4220, 1030, 180, 40, 'floor'),
  slab(4560, 950, 170, 40, 'floor'),
  slab(4820, 1060, 170, 40, 'floor'),
  slab(5060, 900, 340, 46, 'floor'), // amulettavsats
];

/** Small decorative slabs: same collision, drawn darker. */
export const ROCKS = [slab(240, 1410, 210, 170, 'ceil'), slab(1080, 1410, 160, 120, 'ceil')];

export const SPIKES = [
  { x: 2740, y: 1690, w: 320, h: 50 },
  { x: 3860, y: 1500, w: 110, h: 40 },
  { x: 4460, y: 1500, w: 90, h: 40 },
];

export const BENCHES = [
  { x: 330, y: 1900 },
  { x: 2900, y: 900 },
  { x: 3620, y: 1540 },
];

export const PLAYER_SPAWN = { x: 430, y: 1900 };

export const ENEMY_SPAWNS = [
  // area 1
  { type: 'crawler', x: 940, y: 1900, min: 700, max: 1320 },
  { type: 'crawler', x: 1330, y: 1900, min: 1120, max: 1520 },
  { type: 'flyer', x: 760, y: 1520, min: 420, max: 1080 },
  { type: 'flyer', x: 1750, y: 1420, min: 1560, max: 1980 },

  // area 2
  { type: 'husk', x: 2320, y: 1540, min: 2160, max: 2660 },
  { type: 'spitter', x: 2660, y: 1540, min: 2660, max: 2660 },
  { type: 'flyer', x: 2380, y: 1120, min: 2150, max: 2700 },
  { type: 'crawler', x: 2500, y: 1180, min: 2460, max: 2590 },
  { type: 'flyer', x: 2900, y: 760, min: 2650, max: 3100 },
  { type: 'spitter', x: 3020, y: 900, min: 3020, max: 3020 },
  { type: 'husk', x: 3260, y: 1540, min: 3080, max: 3500 },

  // area 3
  { type: 'crawler', x: 3700, y: 1540, min: 3560, max: 4060 },
  { type: 'husk', x: 4180, y: 1540, min: 4060, max: 4400 },
  { type: 'spitter', x: 4560, y: 1540, min: 4560, max: 4560 },
  { type: 'flyer', x: 4300, y: 1300, min: 3900, max: 4700 },
  { type: 'guardian', x: 4780, y: 1540, min: 4460, max: 5040 },
  { type: 'crawler', x: 5200, y: 1540, min: 5060, max: 5320 },
];

export const GEO = [
  { x: 640, y: 1840, n: 6 },
  { x: 900, y: 1840, n: 4 },
  { x: 1240, y: 1840, n: 8 },
  { x: 1500, y: 1720, n: 10 },
  { x: 1830, y: 1600, n: 10 },
  { x: 2300, y: 1300, n: 12 },
  { x: 2520, y: 1120, n: 12 },
  { x: 2700, y: 940, n: 15 },
  { x: 3220, y: 1460, n: 12 },
  { x: 3800, y: 1270, n: 15 },
  { x: 4040, y: 1100, n: 15 },
  { x: 4300, y: 940, n: 18 },
  { x: 4620, y: 870, n: 18 },
  { x: 4900, y: 980, n: 20 },
  { x: 5220, y: 840, n: 25 },
];

export const CHARM = { x: 5200, y: 856 };

/** Glowing mushroom clusters: {x,y,r,color} */
export const LIGHTS = [
  { x: 520, y: 1890, r: 150, color: '#4bd6ff' },
  { x: 1180, y: 1890, r: 120, color: '#5ee0c0' },
  { x: 1660, y: 1810, r: 110, color: '#4bd6ff' },
  { x: 2280, y: 1530, r: 160, color: '#59d9ff' },
  { x: 2980, y: 1520, r: 140, color: '#7f9dff' },
  { x: 3400, y: 1530, r: 120, color: '#4bd6ff' },
  { x: 3900, y: 1530, r: 130, color: '#6ee7ff' },
  { x: 4700, y: 1530, r: 150, color: '#9c8bff' },
  { x: 5280, y: 1530, r: 130, color: '#4bd6ff' },
  { x: 5220, y: 860, r: 150, color: '#ffe6a6', warm: true },
  { x: 2900, y: 880, r: 130, color: '#ffe6a6', warm: true },
  { x: 3620, y: 1520, r: 110, color: '#ffe6a6', warm: true },
];
