// The forest: six connected rooms with their puzzles.
// Coordinates are room-local, y grows downward. Floor surface sits at y = 828.

export const VIEW = { w: 1280, h: 720 };
export const FLOOR = 828;
export const HEIGHT = 900;

const ground = (w) => ({ x: 0, y: FLOOR, w, h: HEIGHT - FLOOR });
const walls = (w) => [
  { x: 0, y: 0, w: 40, h: HEIGHT },
  { x: w - 40, y: 0, w: 40, h: HEIGHT },
  { x: 0, y: 0, w, h: 40 },
];
const plat = (x, y, w) => ({ x, y, w, h: 18 });

/** A doorway: matching triggers and a visible frame. */
const door = (w, y, to, spawn) => ({
  zone: { x: w - 90, y: y - 128, w: 80, h: 128 },
  to,
  spawn,
});

export const ROOMS = {
  /* ============================================================ hub */
  hub: {
    id: 'hub',
    title: 'Lykthuset',
    sub: 'Där skymningen stannar',
    mood: 'home',
    w: 1700,
    spawn: { x: 300, y: 780 },
    solids: [
      ground(1700),
      ...walls(1700),
      { x: 120, y: 640, w: 240, h: 16 },
      plat(300, 700, 180),
      plat(560, 600, 160),
      plat(820, 500, 160),
      plat(1080, 400, 170),
      plat(1300, 300, 240),
    ],
    hazards: [],
    lamps: [{ x: 250, y: FLOOR, hearth: true }],
    vines: [],
    mirrors: [],
    crates: [],
    plates: [],
    emitters: [],
    targets: [],
    gates: [],
    midges: [],
    echo: null,
    shard: null,
    altar: { x: 700, y: FLOOR - 120, w: 110, h: 120 },
    exits: [
      { x: 1580, y: 700, w: 70, h: 128, to: 'garden', spawn: { x: 140, y: 780 }, label: 'Törngården', labelAt: { x: 1600, y: 660 } },
      { x: 1400, y: 190, w: 90, h: 110, to: 'grove', spawn: { x: 140, y: 780 }, label: 'Spegellunden', labelAt: { x: 1445, y: 150 } },
    ],
    hints: [
      'Glim: Lyktan sover. Sätt dig vid den när du behöver vila.',
      'Glim: Till höger ligger Törngården. Där växer minnet som rankor.',
      'Glim: Trappan upp leder till Spegellunden. Ljus kan böjas, vet du.',
      'Glim: Altaret tar emot tre minnen. Du har dem inte än.',
    ],
  },

  /* ========================================================== garden */
  garden: {
    id: 'garden',
    title: 'Törngården',
    sub: 'Rankorna minns regnet',
    mood: 'thorn',
    w: 1800,
    spawn: { x: 140, y: 780 },
    solids: [
      ground(1800),
      ...walls(1800),
      plat(200, 700, 150),
      plat(430, 600, 150),
      plat(900, 700, 200),
      plat(1200, 580, 180),
      plat(1450, 480, 200),
    ],
    hazards: [{ x: 760, y: 800, w: 140, h: 28 }],
    lamps: [
      { x: 640, y: FLOOR },
      { x: 1120, y: FLOOR },
      { x: 1500, y: FLOOR },
    ],
    vines: [
      { x: 545, y: 678, w: 28, h: 150 },
      { x: 1065, y: 678, w: 28, h: 150 },
      { x: 1385, y: 698, w: 28, h: 130 },
    ],
    mirrors: [],
    crates: [],
    plates: [],
    emitters: [],
    targets: [],
    gates: [{ x: 1640, y: 600, w: 26, h: 228, key: 'lamps' }],
    midges: [
      { x: 1260, y: 700 },
      { x: 980, y: 520 },
    ],
    echo: null,
    shard: { x: 1706, y: 782 },
    altar: null,
    exits: [
      { x: 0, y: 700, w: 70, h: 128, to: 'hub', spawn: { x: 1540, y: 780 }, label: 'Lykthuset', labelAt: { x: 70, y: 660 } },
      { x: 1692, y: 700, w: 68, h: 128, to: 'grove', spawn: { x: 140, y: 780 }, label: 'Spegellunden', labelAt: { x: 1706, y: 660 } },
    ],
    hints: [
      'Glim: Rankorna tål inte ljus. Håll in staven och släpp när den glöder.',
      'Glim: Ett tryck tänder. Ett andetag bränner. Ett helt andetag spränger.',
      'Glim: Tre eldar. Sedan öppnar sig porten.',
    ],
  },

  /* ============================================================ grove */
  grove: {
    id: 'grove',
    title: 'Spegellunden',
    sub: 'Ljuset går dit du pekar',
    mood: 'mirror',
    w: 1900,
    spawn: { x: 140, y: 780 },
    solids: [
      ground(1900),
      ...walls(1900),
      plat(600, 740, 180),
      plat(480, 600, 150),
      plat(560, 470, 120),
      plat(560, 330, 120),
      plat(820, 560, 150),
      plat(1140, 470, 170),
      plat(1420, 380, 160),
    ],
    hazards: [],
    lamps: [],
    vines: [],
    mirrors: [
      { x: 700, y: 700, angle: 0, step: Math.PI / 4 },
      { x: 700, y: 300, angle: 0, step: Math.PI / 4 },
    ],
    crates: [],
    plates: [],
    emitters: [{ x: 200, y: 700, angle: 0 }],
    targets: [{ x: 1500, y: 260, w: 60, h: 80 }],
    gates: [{ x: 1700, y: 600, w: 26, h: 228, key: 'beam' }],
    midges: [{ x: 1200, y: 300 }],
    echo: null,
    shard: { x: 1786, y: 782 },
    altar: null,
    exits: [
      { x: 0, y: 700, w: 70, h: 128, to: 'garden', spawn: { x: 1640, y: 760 }, label: 'Törngården', labelAt: { x: 70, y: 660 } },
      { x: 1792, y: 700, w: 68, h: 128, to: 'stones', spawn: { x: 140, y: 780 }, label: 'Stenkammaren', labelAt: { x: 1806, y: 660 } },
    ],
    hints: [
      'Glim: Ställ dig vid en spegel och tryck E för att vrida den.',
      'Glim: Ljuset vill in i mottagaren till höger. Böj det dit.',
      'Glim: Två speglar. Samma lutning på båda.',
    ],
  },

  /* =========================================================== stones */
  stones: {
    id: 'stones',
    title: 'Stenkammaren',
    sub: 'Tunga saker minns tyngd',
    mood: 'stone',
    w: 1600,
    spawn: { x: 140, y: 780 },
    solids: [
      ground(1600),
      ...walls(1600),
      plat(700, 640, 150),
      plat(980, 480, 160),
      plat(1200, 360, 170),
      // A low divider keeps each stone in its own lane, so a long shove can
      // never smear both stones into a corner.
      { x: 1000, y: 780, w: 26, h: 48 },
    ],
    // Thorns sit on the optional lower ledge, never on the stone lane.
    hazards: [{ x: 760, y: 626, w: 90, h: 14 }],
    lamps: [],
    vines: [],
    mirrors: [],
    // One stone to the left, one to the right: each can be shoved to its
    // own hollow without ever bumping into the other.
    crates: [
      { x: 660, y: 780 },
      { x: 1100, y: 780 },
    ],
    plates: [
      { x: 300, y: 820, w: 90 },
      { x: 1300, y: 820, w: 90 },
    ],
    emitters: [],
    targets: [],
    gates: [{ x: 1440, y: 600, w: 26, h: 228, key: 'crates' }],
    midges: [
      { x: 900, y: 520 },
      { x: 1240, y: 300 },
    ],
    echo: null,
    shard: null,
    altar: null,
    exits: [
      { x: 0, y: 700, w: 70, h: 128, to: 'grove', spawn: { x: 1740, y: 760 }, label: 'Spegellunden', labelAt: { x: 70, y: 660 } },
      { x: 1500, y: 700, w: 68, h: 128, to: 'hall', spawn: { x: 140, y: 780 }, label: 'Ekokammaren', labelAt: { x: 1514, y: 660 } },
    ],
    hints: [
      'Glim: Gå in i en sten och håll riktningen. Den följer dig.',
      'Glim: En sten till vänster, en till höger. En platta åt varje håll.',
      'Glim: Ställer du en sten på en platta sjunker den till rätta.',
    ],
  },

  /* ============================================================= hall */
  hall: {
    id: 'hall',
    title: 'Ekokammaren',
    sub: 'Du har varit här förut',
    mood: 'echo',
    w: 1700,
    spawn: { x: 140, y: 780 },
    solids: [
      ground(1700),
      ...walls(1700),
      plat(520, 660, 150),
      plat(760, 520, 150),
      plat(1160, 620, 150),
    ],
    hazards: [],
    lamps: [],
    vines: [],
    mirrors: [],
    crates: [],
    plates: [
      { x: 900, y: 820, w: 90 },
      { x: 1120, y: 820, w: 90 },
    ],
    emitters: [],
    targets: [],
    gates: [{ x: 1250, y: 600, w: 26, h: 228, key: 'echo' }],
    midges: [{ x: 760, y: 460 }],
    echo: { x: 260, y: 820, duration: 6 },
    shard: { x: 1350, y: 782 },
    altar: null,
    exits: [
      { x: 0, y: 700, w: 70, h: 128, to: 'stones', spawn: { x: 1460, y: 760 }, label: 'Stenkammaren', labelAt: { x: 70, y: 660 } },
      { x: 1580, y: 700, w: 70, h: 128, to: 'hub', spawn: { x: 760, y: 700 }, label: 'Lykthuset', labelAt: { x: 1600, y: 660 } },
    ],
    hints: [
      'Glim: Ekokristallen minns dina steg. Tryck E för att spela in.',
      'Glim: Spela upp dig själv på en platta och stå på den andra.',
      'Glim: Ett eko håller kvar. Du behöver inte vara på båda platserna.',
    ],
  },

  /* =========================================================== hollow */
  hollow: {
    id: 'hollow',
    title: 'Det inre rummet',
    sub: 'Här förvaras du',
    mood: 'memory',
    w: 1400,
    spawn: { x: 140, y: 780 },
    solids: [ground(1400), ...walls(1400), plat(560, 660, 160), plat(820, 520, 160)],
    hazards: [],
    lamps: [],
    vines: [],
    mirrors: [],
    crates: [],
    plates: [],
    emitters: [],
    targets: [],
    gates: [],
    midges: [],
    echo: null,
    shard: null,
    altar: null,
    mirror: { x: 1090, y: 770 },
    exits: [{ x: 0, y: 700, w: 70, h: 128, to: 'hub', spawn: { x: 760, y: 700 }, label: 'Lykthuset', labelAt: { x: 70, y: 660 } }],
    hints: ['Glim: ...jag minns den här platsen. Gör du?'],
  },
};

export const MEMORIES = [
  {
    id: 'ranks',
    title: 'Det första minnet',
    text: 'Du tände lyktan åt någon som inte kunde se. Rankorna drog sig undan och natten blev en handsbredd kortare.',
  },
  {
    id: 'spegeln',
    title: 'Det andra minnet',
    text: 'Du vände ljuset mot dig själv för att se vem du var. Spegeln visade bara skogen. Du skrattade, och ekot skrattade tillbaka.',
  },
  {
    id: 'ekot',
    title: 'Det tredje minnet',
    text: 'Du gick ut i mörkret efter en röst som lät som din egen. Sedan kom du inte tillbaka. Glim har letat sedan dess.',
  },
];
