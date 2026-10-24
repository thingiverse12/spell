// Den sista lågan — world data.
// Top-down zones. All coordinates are world pixels, y grows downwards.
// A zone is a painted map plus lists of things inside it.

export const VIEW = { w: 1280, h: 720 };

const rect = (x, y, w, h) => ({ x, y, w, h });

/* --------------------------------------------------------------- builders */

const tree = (x, y, s = 1, kind = 'pine') => ({
  type: 'tree',
  x,
  y,
  s,
  kind,
  solid: rect(x - 13 * s, y - 8 * s, 26 * s, 16 * s),
});
const bush = (x, y, s = 1) => ({ type: 'bush', x, y, s, solid: rect(x - 14 * s, y - 7 * s, 28 * s, 12 * s) });
const rock = (x, y, s = 1) => ({ type: 'rock', x, y, s, solid: rect(x - 15 * s, y - 10 * s, 30 * s, 18 * s) });
const house = (x, y, w, h, style, name) => ({
  type: 'house',
  x,
  y,
  w,
  h,
  style,
  name,
  solid: rect(x, y + h * 0.45, w, h * 0.55),
});
const fence = (x, y, w, vertical = false) => ({
  type: 'fence',
  x,
  y,
  w,
  vertical,
  solid: vertical ? rect(x - 4, y, 8, w) : rect(x, y - 4, w, 8),
});
const haystack = (x, y, s = 1) => ({ type: 'haystack', x, y, s, solid: rect(x - 26 * s, y - 16 * s, 52 * s, 26 * s) });
const well = (x, y) => ({ type: 'well', x, y, solid: rect(x - 26, y - 20, 52, 30) });
const pillar = (x, y, s = 1) => ({ type: 'pillar', x, y, s, solid: rect(x - 18 * s, y - 24 * s, 36 * s, 30 * s) });
const grave = (x, y) => ({ type: 'grave', x, y, solid: rect(x - 12, y - 14, 24, 18) });
const urn = (x, y) => ({ type: 'urn', x, y, solid: rect(x - 9, y - 12, 18, 14) });
const bones = (x, y) => ({ type: 'bones', x, y });
const statue = (x, y, id, name) => ({ type: 'statue', x, y, id, name, solid: rect(x - 16, y - 24, 32, 26) });
const bramble = (x, y, w, h) => ({ x, y, w, h, burnt: false });
const rubble = (x, y, w, h) => ({ x, y, w, h, broken: false });

const vp = (props) => props;

/* ------------------------------------------------------------------ village */

const village = {
  id: 'village',
  name: 'Häll',
  sub: 'Byn vid den slocknade härden',
  theme: 'village',
  w: 1500,
  h: 1050,
  spawn: { x: 750, y: 660 },
  safe: true,
  dark: 0.26,
  ambient: 'dusk',
  paths: [
    { x1: 750, y1: 1050, x2: 750, y2: 560, w: 74 },
    { x1: 0, y1: 560, x2: 1500, y2: 560, w: 62 },
    { x1: 750, y1: 560, x2: 1080, y2: 430, w: 44 },
    { x1: 750, y1: 560, x2: 530, y2: 470, w: 40 },
  ],
  water: [],
  props: vp([
    house(330, 300, 280, 190, 'timber', 'Smedjan'),
    house(960, 250, 300, 210, 'church', 'Kyrkan'),
    house(170, 690, 210, 150, 'timber', 'Bostad'),
    house(1180, 700, 230, 160, 'timber', 'Bostad'),
    house(640, 120, 220, 150, 'timber', 'Bostad'),
    well(880, 660),
    haystack(1230, 470, 0.9),
    haystack(1290, 520, 0.7),
    fence(420, 900, 260),
    fence(1000, 880, 240),
    fence(1180, 620, 200, true),
    bush(500, 700, 1),
    bush(1010, 760, 1.1),
    bush(560, 220, 0.8),
    rock(240, 500, 0.9),
    rock(1370, 330, 1),
    tree(150, 250, 1.15, 'pine'),
    tree(1330, 200, 1.2, 'pine'),
    tree(1420, 950, 1.1, 'pine'),
    tree(90, 950, 1.05, 'pine'),
  ]),
  decor: [
    { type: 'flowers', x: 480, y: 600, n: 9 },
    { type: 'flowers', x: 1050, y: 560, n: 8 },
    { type: 'flowers', x: 700, y: 320, n: 7 },
  ],
  brazier: { id: 'hearth', x: 750, y: 520, r: 34, kind: 'great', lit: false, name: 'Byns hjärta' },
  npcs: [
    { id: 'hedda', name: 'Hedda', x: 690, y: 590, palette: 'warm', wander: 12 },
    { id: 'smed', name: 'Smeden Björn', x: 430, y: 560, palette: 'smith', shop: true, wander: 0 },
    { id: 'sune', name: 'Sune', x: 800, y: 640, palette: 'green', after: 'sune', wander: 20 },
    { id: 'alva', name: 'Alva', x: 860, y: 600, palette: 'blue', after: 'alva', wander: 26 },
    { id: 'vidar', name: 'Vidar', x: 900, y: 690, palette: 'red', after: 'vidar', wander: 18 },
    { id: 'barn', name: 'Lilla Ester', x: 620, y: 700, palette: 'green', wander: 30 },
  ],
  braziers: [],
  switches: [],
  gates: [],
  rubble: [],
  brambles: [],
  chests: [{ id: 'village-chest', x: 1290, y: 830, opened: false, loot: { glow: 25 } }],
  enemies: [],
  exits: [
    { x: 0, y: 500, w: 40, h: 130, to: 'fields', spawn: { x: 1620, y: 590 }, label: 'Fälten', dir: 'väst' },
    { x: 700, y: 0, w: 130, h: 40, to: 'forest', spawn: { x: 830, y: 1120 }, label: 'Björkskogen', dir: 'norr' },
    { x: 1460, y: 500, w: 40, h: 130, to: 'river', spawn: { x: 110, y: 560 }, label: 'Bäcken', dir: 'öst' },
  ],
  cryptDoor: { x: 1080, y: 418, w: 84, h: 46 },
};

/* ------------------------------------------------------------------- fields */

const fields = {
  id: 'fields',
  name: 'Fälten',
  sub: 'Där gräset slutat minnas solen',
  theme: 'field',
  w: 1700,
  h: 1150,
  spawn: { x: 1600, y: 590 },
  dark: 0.36,
  ambient: 'dusk',
  paths: [
    { x1: 1700, y1: 590, x2: 1180, y2: 560, w: 60 },
    { x1: 1180, y1: 560, x2: 640, y2: 640, w: 52 },
    { x1: 640, y1: 640, x2: 330, y2: 400, w: 46 },
  ],
  water: [rect(1180, 760, 330, 210)],
  props: vp([
    fence(1050, 420, 300),
    fence(520, 760, 260),
    fence(760, 980, 320),
    haystack(900, 480, 1.1),
    haystack(960, 540, 0.85),
    haystack(420, 900, 1),
    rock(250, 820, 1.1),
    rock(1420, 380, 1.2),
    rock(700, 300, 0.9),
    tree(180, 620, 1.1, 'pine'),
    tree(300, 980, 1.2, 'pine'),
    tree(1480, 950, 1.15, 'pine'),
    tree(1550, 260, 1.05, 'birch'),
    tree(1050, 950, 1.1, 'pine'),
    tree(1310, 620, 1.05, 'pine'),
    tree(880, 250, 1.1, 'birch'),
    bush(600, 520, 1),
    bush(1120, 900, 1.1),
    bush(380, 250, 0.9),
  ]),
  decor: [
    { type: 'flowers', x: 700, y: 860, n: 10 },
    { type: 'flowers', x: 1320, y: 300, n: 9 },
    { type: 'flowers', x: 480, y: 460, n: 8 },
    { type: 'wheat', x: 760, y: 380, n: 26 },
    { type: 'wheat', x: 1080, y: 700, n: 22 },
  ],
  brazier: { id: 'fields', x: 300, y: 300, r: 34, kind: 'stone', lit: false, name: 'Fältets ljus' },
  statues: [statue(360, 380, 'sune', 'Sune')],
  npcs: [],
  braziers: [],
  switches: [],
  gates: [],
  rubble: [],
  brambles: [bramble(1010, 640, 150, 60)],
  chests: [{ id: 'fields-chest', x: 1420, y: 260, opened: false, loot: { glow: 30 } }],
  enemies: [
    { kind: 'shadow', x: 1200, y: 480 },
    { kind: 'shadow', x: 820, y: 560 },
    { kind: 'shadow', x: 560, y: 820 },
    { kind: 'crawler', x: 980, y: 320 },
    { kind: 'crawler', x: 400, y: 620 },
  ],
  exits: [{ x: 1660, y: 520, w: 40, h: 150, to: 'village', spawn: { x: 90, y: 560 }, label: 'Häll', dir: 'öst' }],
};

/* ------------------------------------------------------------------- forest */

const forest = {
  id: 'forest',
  name: 'Björkskogen',
  sub: 'Träden står tätt för att slippa se',
  theme: 'forest',
  w: 1700,
  h: 1250,
  spawn: { x: 830, y: 1160 },
  dark: 0.46,
  ambient: 'dusk',
  paths: [
    { x1: 830, y1: 1250, x2: 830, y2: 900, w: 66 },
    { x1: 830, y1: 900, x2: 1080, y2: 620, w: 54 },
    { x1: 1080, y1: 620, x2: 1010, y2: 330, w: 48 },
  ],
  water: [rect(1260, 720, 180, 300)],
  props: vp([
    tree(240, 300, 1.25, 'birch'),
    tree(380, 420, 1.1, 'birch'),
    tree(140, 560, 1.2, 'pine'),
    tree(560, 260, 1.15, 'birch'),
    tree(700, 420, 1.05, 'pine'),
    tree(430, 760, 1.2, 'birch'),
    tree(180, 940, 1.15, 'pine'),
    tree(1330, 260, 1.25, 'pine'),
    tree(1500, 420, 1.1, 'birch'),
    tree(1600, 700, 1.2, 'pine'),
    tree(1420, 1000, 1.15, 'birch'),
    tree(1180, 1100, 1.1, 'pine'),
    tree(640, 1060, 1.2, 'birch'),
    tree(300, 1140, 1.05, 'pine'),
    tree(520, 700, 1.1, 'pine'),
    tree(760, 860, 1.15, 'birch'),
    tree(980, 980, 1.2, 'pine'),
    tree(1180, 880, 1.1, 'birch'),
    tree(1240, 640, 1.15, 'pine'),
    tree(600, 520, 1.05, 'birch'),
    tree(1500, 900, 1.2, 'pine'),
    tree(1560, 120, 1.1, 'pine'),
    bush(900, 740, 1.2),
    bush(1000, 520, 1),
    rock(1270, 520, 1.1),
    rock(520, 980, 1),
    rock(880, 200, 0.9),
  ]),
  decor: [
    { type: 'flowers', x: 760, y: 1000, n: 8 },
    { type: 'mushrooms', x: 1120, y: 820, n: 7 },
    { type: 'mushrooms', x: 620, y: 640, n: 6 },
    { type: 'mushrooms', x: 1420, y: 620, n: 5 },
  ],
  brazier: { id: 'forest', x: 1010, y: 260, r: 34, kind: 'stone', lit: false, name: 'Skogens ljus' },
  statues: [statue(1070, 320, 'alva', 'Alva')],
  npcs: [],
  braziers: [],
  switches: [],
  gates: [{ id: 'forest-gate', x: 1440, y: 760, w: 34, h: 200, open: false, key: 'bow' }],
  rubble: [],
  brambles: [bramble(730, 1000, 170, 70), bramble(1160, 380, 130, 90)],
  chests: [{ id: 'forest-chest', x: 1560, y: 1020, opened: false, loot: { glow: 40 } }],
  enemies: [
    { kind: 'shadow', x: 900, y: 900 },
    { kind: 'shadow', x: 700, y: 600 },
    { kind: 'shadow', x: 1180, y: 700 },
    { kind: 'crawler', x: 980, y: 420 },
    { kind: 'crawler', x: 460, y: 900 },
    { kind: 'guard', x: 1300, y: 1000 },
  ],
  exits: [{ x: 760, y: 1210, w: 150, h: 40, to: 'village', spawn: { x: 760, y: 60 }, label: 'Häll', dir: 'söder' }],
};

/* -------------------------------------------------------------------- river */

const river = {
  id: 'river',
  name: 'Bäcken',
  sub: 'Vattnet bär minnen utför',
  theme: 'river',
  w: 1600,
  h: 1050,
  spawn: { x: 100, y: 560 },
  dark: 0.4,
  ambient: 'dusk',
  paths: [
    { x1: 0, y1: 560, x2: 420, y2: 600, w: 58 },
    { x1: 420, y1: 600, x2: 760, y2: 560, w: 50 },
    { x1: 760, y1: 560, x2: 1180, y2: 700, w: 50 },
    { x1: 1180, y1: 700, x2: 1360, y2: 760, w: 44 },
  ],
  water: [rect(430, 0, 260, 1050), rect(900, 0, 200, 380)],
  bridges: [
    rect(430, 520, 260, 74),
    rect(900, 300, 200, 70),
    rect(760, 540, 90, 70),
  ],
  props: vp([
    rock(300, 320, 1.1),
    rock(360, 880, 1.2),
    rock(1240, 420, 1),
    rock(1420, 900, 1.1),
    tree(180, 860, 1.15, 'birch'),
    tree(1360, 260, 1.2, 'pine'),
    tree(1500, 640, 1.1, 'birch'),
    tree(700, 200, 1.1, 'birch'),
    bush(240, 720, 1),
    bush(1320, 560, 1.1),
    bush(980, 880, 1),
  ]),
  decor: [
    { type: 'reeds', x: 420, y: 640, n: 12 },
    { type: 'reeds', x: 700, y: 320, n: 10 },
    { type: 'flowers', x: 300, y: 460, n: 8 },
    { type: 'mushrooms', x: 1200, y: 900, n: 6 },
  ],
  brazier: { id: 'river', x: 1360, y: 720, r: 34, kind: 'stone', lit: false, name: 'Vattnets ljus' },
  statues: [statue(1420, 780, 'vidar', 'Vidar')],
  npcs: [],
  braziers: [],
  switches: [],
  gates: [],
  rubble: [],
  brambles: [bramble(1120, 480, 160, 80)],
  chests: [{ id: 'river-chest', x: 180, y: 300, opened: false, loot: { glow: 35 } }],
  enemies: [
    { kind: 'shadow', x: 620, y: 420 },
    { kind: 'shadow', x: 900, y: 760 },
    { kind: 'crawler', x: 1000, y: 500 },
    { kind: 'crawler', x: 1180, y: 880 },
    { kind: 'guard', x: 540, y: 820 },
  ],
  exits: [{ x: 0, y: 500, w: 40, h: 140, to: 'village', spawn: { x: 1400, y: 560 }, label: 'Häll', dir: 'väst' }],
};

/* -------------------------------------------------------------------- crypt */

const cryptFloor = (id, name, sub, w, h, extra) => ({
  id,
  name,
  sub,
  theme: 'crypt',
  w,
  h,
  spawn: { x: 120, y: h - 150 },
  dark: 0.86,
  ambient: 'crypt',
  paths: [],
  water: [],
  props: [],
  decor: [],
  braziers: [],
  switches: [],
  gates: [],
  rubble: [],
  brambles: [],
  chests: [],
  enemies: [],
  exits: [],
  ...extra,
});

const crypt1 = cryptFloor('crypt1', 'Kryptan', 'Trappan ner', 1400, 900, {
  walls: [
    rect(0, 0, 1400, 70),
    rect(0, 0, 70, 900),
    rect(1330, 0, 70, 900),
    rect(0, 830, 1400, 70),
  ],
  props: vp([
    pillar(320, 300, 1),
    pillar(320, 620, 1),
    pillar(1080, 300, 1),
    pillar(1080, 620, 1),
    grave(700, 720),
    grave(760, 720),
    grave(820, 720),
    urn(420, 780),
    urn(1000, 780),
    bones(520, 480),
  ]),
  braziers: [{ id: 'crypt1-a', x: 760, y: 300, r: 120, lit: false }],
  rubble: [rubble(700, 140, 220, 80)],
  enemies: [
    { kind: 'shadow', x: 900, y: 500 },
    { kind: 'shadow', x: 500, y: 640 },
    { kind: 'crawler', x: 700, y: 260 },
  ],
  exits: [
    { x: 60, y: 760, w: 70, h: 70, to: 'village', spawn: { x: 1120, y: 500 }, label: 'Häll', dir: 'upp' },
    { x: 660, y: 60, w: 120, h: 60, to: 'crypt2', spawn: { x: 120, y: 760 }, label: 'Nedåt', dir: 'ner' },
  ],
});

const crypt2 = cryptFloor('crypt2', 'Kryptan', 'Vaktens sal', 1500, 1000, {
  walls: [
    rect(0, 0, 1500, 70),
    rect(0, 0, 70, 1000),
    rect(1430, 0, 70, 1000),
    rect(0, 930, 1500, 70),
    rect(560, 380, 60, 420),
  ],
  props: vp([
    pillar(300, 300, 1.1),
    pillar(300, 700, 1.1),
    pillar(1000, 300, 1.1),
    pillar(1000, 800, 1.1),
    grave(760, 860),
    grave(820, 860),
    urn(420, 860),
    urn(1000, 880),
    bones(700, 560),
  ]),
  braziers: [
    { id: 'crypt2-a', x: 260, y: 520, r: 110, lit: false },
    { id: 'crypt2-b', x: 820, y: 220, r: 110, lit: false },
    { id: 'crypt2-c', x: 1240, y: 620, r: 110, lit: false },
  ],
  switches: [{ id: 'crypt2-switch', x: 1240, y: 160, hit: false }],
  gates: [{ id: 'crypt2-gate', x: 1180, y: 780, w: 34, h: 170, open: false, key: 'switch' }],
  enemies: [
    { kind: 'shadow', x: 380, y: 760 },
    { kind: 'shadow', x: 900, y: 520 },
    { kind: 'guard', x: 1120, y: 260 },
    { kind: 'crawler', x: 700, y: 700 },
  ],
  exits: [
    { x: 660, y: 60, w: 120, h: 60, to: 'crypt1', spawn: { x: 700, y: 180 }, label: 'Uppåt', dir: 'upp' },
    { x: 1260, y: 850, w: 90, h: 60, to: 'crypt3', spawn: { x: 700, y: 800 }, label: 'Djupt', dir: 'ner' },
  ],
});

const crypt3 = cryptFloor('crypt3', 'Kryptan', 'Den första lågan', 1400, 950, {
  boss: true,
  walls: [
    rect(0, 0, 1400, 70),
    rect(0, 0, 70, 950),
    rect(1330, 0, 70, 950),
    rect(0, 880, 1400, 70),
  ],
  props: vp([
    pillar(260, 260, 1.2),
    pillar(1140, 260, 1.2),
    pillar(260, 740, 1.2),
    pillar(1140, 740, 1.2),
    grave(180, 500),
    grave(1220, 500),
    urn(340, 830),
    urn(1060, 830),
    bones(560, 620),
    bones(840, 720),
  ]),
  decor: [{ type: 'runeCircle', x: 700, y: 560, r: 210 }],
  braziers: [
    { id: 'crypt3-a', x: 400, y: 200, r: 130, lit: false },
    { id: 'crypt3-b', x: 1000, y: 200, r: 130, lit: false },
  ],
  altar: { x: 700, y: 300, r: 44, lit: false },
  bossSpawn: { kind: 'warden', x: 700, y: 540 },
  enemies: [],
  exits: [{ x: 640, y: 60, w: 130, h: 70, to: 'crypt2', spawn: { x: 1280, y: 800 }, label: 'Uppåt', dir: 'upp' }],
});

export const ZONES = { village, fields, forest, river, crypt1, crypt2, crypt3 };

export const ZONE_ORDER = ['village', 'fields', 'forest', 'river', 'crypt1', 'crypt2', 'crypt3'];

/** Item list. Found items unlock a slot in the HUD. */
export const ITEMS = {
  torch: { id: 'torch', name: 'Facklan', key: '1', icon: 'torch', desc: 'Kastar en flamma. Tänder ljus, bränner törnsnår.' },
  bomb: { id: 'bomb', name: 'Bomben', key: '2', icon: 'bomb', desc: 'Spränger rasmassor och skadar allt i närheten.' },
  bow: { id: 'bow', name: 'Bågen', key: '3', icon: 'bow', desc: 'Pil som träffar långt bort. Väcker gamla mekanismer.' },
};

/** Quest steps, in order. Each has an id the game flips on. */
export const QUESTS = [
  { id: 'torch', text: 'Hedda gav dig facklan. Tänd de tre ljusen ute i markerna.' },
  { id: 'fields', text: 'Fältets ljus är tänt. Sune är fri och har gett dig bomberna.' },
  { id: 'forest', text: 'Skogens ljus är tänt. Alva är fri och har gett dig bågen.' },
  { id: 'river', text: 'Vattnets ljus är tänt. Vidar är fri och gav dig ett hjärta.' },
  { id: 'crypt', text: 'Alla tre ljusen brinner. Spräng rasmassorna i kyrkan och gå ner.' },
  { id: 'flame', text: 'Tänd den första lågan i kryptans djup.' },
  { id: 'done', text: 'Lågan brinner igen. Byn är räddad.' },
];

export const SHOP = [
  { id: 'heart', name: 'Ett hjärta till', cost: 60, desc: 'Ett hjärta mer att förlora.', repeat: false },
  { id: 'edge', name: 'Vässat svärd', cost: 45, desc: 'Svärdet gör mer skada.', repeat: false },
  { id: 'light', name: 'Större fackla', cost: 40, desc: 'Facklan lyser längre och brinner hetare.', repeat: false },
  { id: 'heal', name: 'Laga dig', cost: 15, desc: 'Fyller alla hjärtan.', repeat: true },
];
