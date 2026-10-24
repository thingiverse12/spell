// Game data: the overworld of Vedstorp and the three floors beneath Stenringen.
// Everything is plain data; the engine in game.js reads it and never mutates it.

export const WORLD_W = 3200;
export const WORLD_H = 2400;
export const TAU = Math.PI * 2;

export const ZONES = [
  {
    id: 'forest',
    name: 'Vedskogen',
    sub: 'Där ingen längre går',
    rect: { x: 0, y: 600, w: 1060, h: 1800 },
    ground: '#22342a',
    ground2: '#1a2a22',
    fog: '#0d1712',
    dark: 0.34,
  },
  {
    id: 'village',
    name: 'Vedstorp',
    sub: 'Byn som glömde sin låga',
    rect: { x: 1040, y: 1480, w: 1160, h: 920 },
    ground: '#3a4230',
    ground2: '#2e3626',
    fog: '#171a12',
    dark: 0.05,
  },
  {
    id: 'ruins',
    name: 'Stenringen',
    sub: 'Där löftet gavs',
    rect: { x: 860, y: 500, w: 1320, h: 1000 },
    ground: '#2f3138',
    ground2: '#25262c',
    fog: '#12131a',
    dark: 0.62,
  },
  {
    id: 'marsh',
    name: 'Kärret',
    sub: 'Vattnet minns allt',
    rect: { x: 2180, y: 1260, w: 1020, h: 1140 },
    ground: '#1f3230',
    ground2: '#182826',
    fog: '#0a1614',
    dark: 0.5,
  },
  {
    id: 'peak',
    name: 'Vindberget',
    sub: 'Ovanför dimman',
    rect: { x: 2180, y: 0, w: 1020, h: 1280 },
    ground: '#2a2c33',
    ground2: '#20222a',
    fog: '#12131a',
    dark: 0.42,
  },
];

export const PATHS = [
  // Spine of the village: well -> plaza -> crossing
  { x: 1300, y: 2020, w: 620, h: 90 },
  // North road to Stenringen
  { x: 1500, y: 1180, w: 110, h: 900 },
  // West road into Vedskogen
  { x: 900, y: 1960, w: 440, h: 84 },
  // East road out towards the marsh
  { x: 2000, y: 1830, w: 480, h: 84 },
  // Marsh road south
  { x: 2620, y: 1640, w: 90, h: 420 },
  // Peak switchbacks
  { x: 2700, y: 900, w: 400, h: 80 },
  { x: 2820, y: 300, w: 80, h: 640 },
];

export const HOUSES = [
  { id: 'smithy', x: 1150, y: 1620, w: 230, h: 160, roof: '#5a3a34', wall: '#4a3b30', door: { x: 1254, y: 1780 } },
  { id: 'inn', x: 1440, y: 1560, w: 320, h: 200, roof: '#4a3f5c', wall: '#4d4034', door: { x: 1584, y: 1760 } },
  { id: 'shop', x: 1840, y: 1630, w: 250, h: 150, roof: '#3f5545', wall: '#463a2e', door: { x: 1948, y: 1780 } },
  { id: 'elder', x: 1880, y: 2080, w: 210, h: 150, roof: '#54403a', wall: '#473a30', door: { x: 1968, y: 2230 } },
];

export const NPCS = [
  {
    id: 'halvor',
    name: 'Halvor',
    role: 'Smed',
    x: 1254,
    y: 1822,
    color: '#c9875a',
    lines: [
      'Du är inte härifrån. Det syns.',
      'Svärdet du bär är gammalt och trubbigt. Jag kan härda det — om du har glöd.',
      'Glöd får du av skuggor. Slå dem, de faller sönder.',
    ],
    action: 'smith',
  },
  {
    id: 'inga',
    name: 'Inga',
    role: 'Värdshus',
    x: 1584,
    y: 1804,
    color: '#c76f7f',
    lines: [
      'Vila här. Jag håller elden i spisen så länge jag kan.',
      'Ingen sover gott nu. Men en stund är bättre än ingen.',
    ],
    action: 'inn',
  },
  {
    id: 'bote',
    name: 'Bote',
    role: 'Handlare',
    x: 1948,
    y: 1822,
    color: '#a9a05a',
    lines: [
      'Jag säljer det jag har kvar. Det är inte mycket.',
      'Pilar, bomber och olja. Glöd betalar.',
    ],
    action: 'shop',
  },
  {
    id: 'ylva',
    name: 'Ylva',
    role: 'Barn',
    x: 1440,
    y: 1920,
    color: '#8ab4c4',
    lines: [
      'Mamma säger att jag inte får gå ut. Men jag vet saker.',
      'Stenringen uppe i norr — där blev det fel. Det lyser inte där längre.',
      'Om du tänder eldarna i ringen öppnar sig marken. Det står i min bok.',
    ],
    action: null,
  },
  {
    id: 'vidar',
    name: 'Vidar',
    role: 'Präst',
    x: 1690,
    y: 2140,
    color: '#b0a8c8',
    lines: [
      'Byn lovade lågan att vi skulle bära den vidare. Sedan blev vintern lång och vi glömde.',
      'Förbannelsen är inte ond. Den tar bara tillbaka det vi inte höll.',
      'Tänd eldarna. Bär lågan in i mörkret under Stenringen. Bevisa att vi menade det.',
    ],
    action: null,
  },
  {
    id: 'rurik',
    name: 'Rurik',
    role: 'Jägare',
    x: 1090,
    y: 1880,
    color: '#7f9e6a',
    lines: [
      'Jag har gått i Vedskogen hela livet. Nu ser jag skuggor mellan stammarna.',
      'Tänd fyra eldar ute i världen. Då vet jag att det finns något kvar att lita på.',
      'Gör det, och du får något som gör dig svårare att döda.',
    ],
    action: 'hunter',
  },
];

export const BRAZIERS = [
  // Stenringen: the three that open the way down.
  { id: 'ring-1', x: 1300, y: 1120, zone: 'ruins' },
  { id: 'ring-2', x: 1720, y: 1120, zone: 'ruins' },
  { id: 'ring-3', x: 1510, y: 742, zone: 'ruins' },
  // Scattered across the world for Rurik's quest.
  { id: 'forest-1', x: 430, y: 1720, zone: 'forest' },
  { id: 'forest-2', x: 860, y: 1010, zone: 'forest' },
  { id: 'marsh-1', x: 2420, y: 2140, zone: 'marsh' },
  { id: 'peak-1', x: 2860, y: 760, zone: 'peak' },
];

export const CHESTS = [
  { id: 'bow', x: 250, y: 880, item: 'bow', label: 'Vedskogens båge' },
  { id: 'oil', x: 3010, y: 1720, item: 'oil', label: 'Oljeflaska' },
  { id: 'heart-peak', x: 2900, y: 250, item: 'heart', label: 'Hjärtats sten' },
  { id: 'glod-forest', x: 700, y: 1500, item: 'glod', label: 'Glöd' },
  { id: 'glod-ruins', x: 1000, y: 820, item: 'glod', label: 'Glöd' },
];

export const SIGNS = [
  { x: 1520, y: 1510, text: 'STENRINGEN — gå inte upp i mörkret utan eld.' },
  { x: 1060, y: 2000, text: 'VEDSKOGEN. Håll dig till stigen.' },
  { x: 2130, y: 1860, text: 'KÄRRET. Vattnet är djupare än det ser ut.' },
  { x: 1600, y: 2260, text: 'VEDSTORP. Vi håller ut så länge lågan brinner.' },
];

export const WELLS = [{ x: 1350, y: 2085 }];

/** Little village props: fences, gardens, stalls, lamp posts. */
export const PROPS = [
  // fences framing the plaza
  { kind: 'fence', x: 1186, y: 1952, w: 128, rot: 0 },
  { kind: 'fence', x: 1186, y: 1836, w: 128, rot: 0 },
  { kind: 'fence', x: 2062, y: 1900, w: 150, rot: Math.PI / 2 },
  { kind: 'fence', x: 1320, y: 2262, w: 210, rot: 0 },
  { kind: 'fence', x: 1700, y: 2262, w: 260, rot: 0 },
  // gardens
  { kind: 'garden', x: 1470, y: 2210, w: 150, h: 76 },
  { kind: 'garden', x: 1240, y: 1690, w: 120, h: 64 },
  // market stall by the handlar
  { kind: 'stall', x: 1870, y: 1752, w: 110, h: 48 },
  // lamp posts along the road
  { kind: 'post', x: 1420, y: 2000 },
  { kind: 'post', x: 1780, y: 2000 },
  { kind: 'post', x: 1540, y: 1530 },
  { kind: 'post', x: 1120, y: 1900 },
  // woodpile + barrels
  { kind: 'woodpile', x: 1190, y: 1666 },
  { kind: 'barrels', x: 2088, y: 1700 },
  { kind: 'barrels', x: 1348, y: 1700 },
];

export const POTS = [
  { x: 1210, y: 1900 },
  { x: 1300, y: 1910 },
  { x: 1900, y: 1960 },
  { x: 1760, y: 1870 },
  { x: 2020, y: 2000 },
  { x: 1140, y: 1760 },
];

export const WATER = [
  { x: 2360, y: 1420, w: 300, h: 220 },
  { x: 2820, y: 1900, w: 340, h: 260 },
  { x: 2500, y: 2300, w: 260, h: 100 },
  { x: 2200, y: 1700, w: 140, h: 180 },
];

export const ROCKS = [
  { x: 1180, y: 780, r: 34 },
  { x: 1900, y: 700, r: 40 },
  { x: 960, y: 620, r: 30 },
  { x: 1760, y: 470, r: 26 },
  { x: 2300, y: 1150, r: 34 },
  { x: 3040, y: 1160, r: 38 },
  { x: 2960, y: 460, r: 44 },
  { x: 2560, y: 600, r: 30 },
  { x: 620, y: 2100, r: 28 },
  { x: 300, y: 1320, r: 32 },
];

export const ENEMIES = [
  // Vedskogen
  { type: 'skugga', x: 600, y: 1780 },
  { type: 'skugga', x: 380, y: 1200 },
  { type: 'krypare', x: 820, y: 1420 },
  // Kärret
  { type: 'bagskytt', x: 2600, y: 2000 },
  { type: 'skugga', x: 2900, y: 1560 },
  { type: 'krypare', x: 2320, y: 2260 },
  // Vindberget
  { type: 'bagskytt', x: 2900, y: 640 },
  { type: 'vakt', x: 2760, y: 1000 },
  // Stenringen
  { type: 'skugga', x: 1200, y: 900 },
  { type: 'skugga', x: 1840, y: 960 },
  { type: 'vakt', x: 1510, y: 980 },
];

/** The gate down into the crypt, in Stenringen. */
export const DUNGEON_ENTRANCE = { x: 1470, y: 500, w: 90, h: 46 };

export const VILLAGE_FIRE = { x: 1600, y: 2000, r: 34 };

/* ------------------------------------------------------------------ dungeon */

export const DUNGEON = {
  name: 'Under Stenringen',
  floors: [
    {
      id: 0,
      name: 'Förgården',
      w: 1300,
      h: 820,
      spawn: { x: 650, y: 740 },
      dark: 0.82,
      braziers: [
        { id: 'd0-1', x: 300, y: 300 },
        { id: 'd0-2', x: 1000, y: 300 },
      ],
      solids: [
        { x: 0, y: 0, w: 1300, h: 40 },
        { x: 0, y: 780, w: 1300, h: 40 },
        { x: 0, y: 0, w: 40, h: 820 },
        { x: 1260, y: 0, w: 40, h: 820 },
        { x: 200, y: 180, w: 40, h: 300 },
        { x: 1060, y: 180, w: 40, h: 300 },
        { x: 480, y: 380, w: 340, h: 40 },
        { x: 630, y: 420, w: 40, h: 160 },
      ],
      chests: [],
      enemies: [
        { type: 'skugga', x: 400, y: 640 },
        { type: 'skugga', x: 900, y: 640 },
        { type: 'krypare', x: 650, y: 500 },
      ],
      gate: { x: 590, y: 0, w: 120, h: 46, needs: 'braziers' },
      stairs: { x: 615, y: 40, w: 70, h: 60 },
      hint: 'Två eldar. Mörkret viker för ljus.',
    },
    {
      id: 1,
      name: 'Kryptan',
      w: 1500,
      h: 920,
      spawn: { x: 130, y: 470 },
      dark: 0.9,
      braziers: [
        { id: 'd1-1', x: 320, y: 800 },
        { id: 'd1-2', x: 1180, y: 780 },
      ],
      solids: [
        { x: 0, y: 0, w: 1500, h: 40 },
        { x: 0, y: 880, w: 1500, h: 40 },
        { x: 0, y: 0, w: 40, h: 920 },
        { x: 1460, y: 0, w: 40, h: 920 },
        { x: 380, y: 120, w: 40, h: 260 },
        { x: 380, y: 600, w: 40, h: 280 },
        // The wall that splits the crypt in two.
        { x: 700, y: 40, w: 44, h: 300 },
        // Its lower half is cracked: a bomb is the other way through.
        { x: 700, y: 580, w: 44, h: 300, cracked: true },
        { x: 1120, y: 180, w: 40, h: 200 },
        { x: 1120, y: 520, w: 40, h: 260 },
      ],
      chests: [],
      enemies: [
        { type: 'bagskytt', x: 250, y: 260 },
        { type: 'krypare', x: 520, y: 700 },
        { type: 'bagskytt', x: 1320, y: 240 },
        { type: 'skugga', x: 1240, y: 700 },
      ],
      // Shoot the eye to raise the gate.
      switch: { x: 560, y: 300, gate: { x: 700, y: 340, w: 44, h: 240 } },
      gate: { x: 700, y: 340, w: 44, h: 240, needs: 'switch' },
      stairs: { x: 900, y: 40, w: 70, h: 60 },
      hint: 'Sprickor i väggen. Bomber öppnar det som inte vill öppna sig. Ögat i väggen öppnar resten.',
    },
    {
      id: 2,
      name: 'Hjärtat',
      w: 1120,
      h: 820,
      spawn: { x: 560, y: 760 },
      dark: 0.92,
      braziers: [
        { id: 'd2-1', x: 190, y: 700 },
        { id: 'd2-2', x: 930, y: 700 },
      ],
      solids: [
        { x: 0, y: 0, w: 1120, h: 40 },
        { x: 0, y: 780, w: 1120, h: 40 },
        { x: 0, y: 0, w: 40, h: 820 },
        { x: 1080, y: 0, w: 40, h: 820 },
        { x: 180, y: 180, w: 60, h: 60 },
        { x: 880, y: 180, w: 60, h: 60 },
      ],
      chests: [],
      enemies: [],
      boss: { x: 560, y: 330 },
      hint: 'Det som en gång skyddade byn vill ha tillbaka sitt löfte.',
    },
  ],
};

/* --------------------------------------------------------------- decoration */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inRect = (r, x, y, pad = 0) =>
  x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad;

/** Keep decor out of walkways, houses and points of interest. */
function isClear(x, y) {
  if (x < 40 || x > WORLD_W - 40 || y < 40 || y > WORLD_H - 40) return false;
  if (HOUSES.some((h) => inRect(h, x, y, 58))) return false;
  if (PATHS.some((p) => inRect(p, x, y, 46))) return false;
  if (WATER.some((w) => inRect(w, x, y, 40))) return false;
  if (ROCKS.some((r) => Math.hypot(r.x - x, r.y - y) < r.r + 46)) return false;
  for (const b of BRAZIERS) if (Math.hypot(b.x - x, b.y - y) < 84) return false;
  for (const c of CHESTS) if (Math.hypot(c.x - x, c.y - y) < 78) return false;
  for (const n of NPCS) if (Math.hypot(n.x - x, n.y - y) < 74) return false;
  for (const s of SIGNS) if (Math.hypot(s.x - x, s.y - y) < 50) return false;
  for (const e of ENEMIES) if (Math.hypot(e.x - x, e.y - y) < 90) return false;
  if (Math.hypot(VILLAGE_FIRE.x - x, VILLAGE_FIRE.y - y) < 110) return false;
  if (Math.hypot(DUNGEON_ENTRANCE.x + 45 - x, DUNGEON_ENTRANCE.y + 23 - y) < 150) return false;
  if (inRect({ x: 1160, y: 1560, w: 1000, h: 700 }, x, y, 0)) return false; // village plaza
  return true;
}

/** Trees are sold as data so the renderer can draw them painterly. */
export const TREES = (() => {
  const rand = mulberry32(1337);
  const trees = [];
  const zones = {
    forest: { rect: { x: 30, y: 680, w: 960, h: 1690 }, n: 150, r: [26, 52] },
    village: { rect: { x: 1060, y: 1460, w: 1130, h: 950 }, n: 14, r: [22, 34] },
    ruins: { rect: { x: 880, y: 540, w: 1280, h: 940 }, n: 12, r: [18, 30] },
    marsh: { rect: { x: 2190, y: 1290, w: 990, h: 1090 }, n: 26, r: [20, 34] },
    peak: { rect: { x: 2190, y: 50, w: 990, h: 1220 }, n: 30, r: [22, 40] },
  };
  for (const [id, cfg] of Object.entries(zones)) {
    let placed = 0;
    let guard = 0;
    while (placed < cfg.n && guard < cfg.n * 40) {
      guard++;
      const x = cfg.rect.x + rand() * cfg.rect.w;
      const y = cfg.rect.y + rand() * cfg.rect.h;
      if (!isClear(x, y)) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < 74)) continue;
      const r = cfg.r[0] + rand() * (cfg.r[1] - cfg.r[0]);
      trees.push({ x, y, r, zone: id, seed: rand(), dead: id === 'ruins' || (id === 'peak' && rand() < 0.4) });
      placed++;
    }
  }
  return trees;
})();

/** Grass, flowers and small stones — purely cosmetic. */
export const DECOR = (() => {
  const rand = mulberry32(90210);
  const items = [];
  for (let i = 0; i < 900; i++) {
    const x = 40 + rand() * (WORLD_W - 80);
    const y = 40 + rand() * (WORLD_H - 80);
    const zone = ZONES.find((z) => inRect(z.rect, x, y));
    if (!zone) continue;
    if (WATER.some((w) => inRect(w, x, y, 6))) continue;
    items.push({
      x,
      y,
      zone: zone.id,
      kind: rand() < 0.14 ? 'flower' : rand() < 0.2 ? 'stone' : 'grass',
      s: 0.7 + rand() * 0.8,
      rot: rand() * TAU,
    });
  }
  return items;
})();

/** Clear-water ripples and drifting fog patches. */
export const FOG_SPOTS = (() => {
  const rand = mulberry32(4242);
  const spots = [];
  for (let i = 0; i < 26; i++) {
    const z = ZONES[Math.floor(rand() * ZONES.length)];
    spots.push({
      x: z.rect.x + rand() * z.rect.w,
      y: z.rect.y + rand() * z.rect.h,
      r: 130 + rand() * 180,
      a: 0.05 + rand() * 0.09,
      speed: 6 + rand() * 10,
      phase: rand() * TAU,
    });
  }
  return spots;
})();

/* -------------------------------------------------------------------- items */

export const ITEM_DEFS = {
  torch: {
    id: 'torch',
    name: 'Facklan',
    key: '1',
    desc: 'Tänder eldar och bränner bort det som håller emot.',
    oil: 0,
  },
  bow: {
    id: 'bow',
    name: 'Bågen',
    key: '2',
    desc: 'Träffar det ögat inte når. Pilar.',
    ammo: 'arrows',
  },
  bombs: {
    id: 'bombs',
    name: 'Bomberna',
    key: '3',
    desc: 'Spränger sprickor i sten. Och skuggor.',
    ammo: 'bombs',
  },
};

export const ENEMY_DEFS = {
  skugga: {
    name: 'Skugga',
    hp: 3,
    speed: 92,
    radius: 18,
    reach: 44,
    windup: 0.52,
    strike: 0.16,
    damage: 1,
    glod: 2,
    parryable: true,
  },
  krypare: {
    name: 'Krypare',
    hp: 2,
    speed: 138,
    radius: 15,
    reach: 36,
    windup: 0.38,
    strike: 0.13,
    damage: 1,
    glod: 1,
    parryable: true,
  },
  bagskytt: {
    name: 'Bågskytt',
    hp: 2,
    speed: 62,
    radius: 16,
    reach: 420,
    windup: 0.62,
    strike: 0.12,
    damage: 1,
    glod: 3,
    ranged: true,
    parryable: false,
  },
  vakt: {
    name: 'Stenvakt',
    hp: 8,
    speed: 64,
    radius: 26,
    reach: 66,
    windup: 0.78,
    strike: 0.2,
    damage: 2,
    glod: 6,
    parryable: true,
    armored: true,
  },
  boss: {
    name: 'Förbannelsen',
    hp: 26,
    speed: 82,
    radius: 46,
    reach: 96,
    windup: 0.6,
    strike: 0.22,
    damage: 2,
    glod: 30,
    parryable: true,
    boss: true,
  },
};
