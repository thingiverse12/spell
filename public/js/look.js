/* =====================================================================
   Ateljén – spelarens egen figur och eget rum.

   Här ligger katalogen över allt man kan köpa och ha på sig, plus de två
   ritfunktionerna som används överallt i appen (topprad, Hem, konto).

   Samma lista finns i lib/api.js, för servern måste kunna kontrollera pris
   och ägande. `npm run audit` jämför de två listorna så att de inte glider
   isär – klienten får aldrig bestämma vad något kostar.
   ===================================================================== */

export const ATELJE_ITEMS = [
  /* Figur – den som sitter på avataren */
  { id: 'fox', kind: 'emblem', name: 'Räven', emoji: '🦊', price: 0 },
  { id: 'panda', kind: 'emblem', name: 'Pandan', emoji: '🐼', price: 150 },
  { id: 'bee', kind: 'emblem', name: 'Biet', emoji: '🐝', price: 200 },
  { id: 'frog', kind: 'emblem', name: 'Grodan', emoji: '🐸', price: 250 },
  { id: 'owl', kind: 'emblem', name: 'Ugglan', emoji: '🦉', price: 400 },
  { id: 'octopus', kind: 'emblem', name: 'Bläckfisken', emoji: '🐙', price: 500 },
  { id: 'tiger', kind: 'emblem', name: 'Tigern', emoji: '🐯', price: 700 },
  { id: 'unicorn', kind: 'emblem', name: 'Enhörningen', emoji: '🦄', price: 900 },
  { id: 'dragon', kind: 'emblem', name: 'Drakägget', emoji: '🐲', price: 2500, requires: { quizCorrect: 100 } },

  /* Accessoar – det lilla som sitter i hörnet */
  { id: 'none', kind: 'accent', name: 'Ingen', emoji: '', price: 0 },
  { id: 'sparkle', kind: 'accent', name: 'Glitter', emoji: '✨', price: 100 },
  { id: 'bow', kind: 'accent', name: 'Rosetten', emoji: '🎀', price: 250 },
  { id: 'flower', kind: 'accent', name: 'Blomman', emoji: '🌸', price: 300 },
  { id: 'headphones', kind: 'accent', name: 'Hörlurarna', emoji: '🎧', price: 600 },
  { id: 'shades', kind: 'accent', name: 'Solglasögonen', emoji: '🕶️', price: 800 },
  { id: 'crown', kind: 'accent', name: 'Kronan', emoji: '👑', price: 1200 },
  { id: 'star', kind: 'accent', name: 'Stjärnan', emoji: '⭐', price: 1500, requires: { quizCorrect: 50 } },

  /* Färg – ringen runt figuren */
  { id: 'mint', kind: 'color', name: 'Mint', emoji: '', price: 0 },
  { id: 'sunset', kind: 'color', name: 'Solnedgång', emoji: '', price: 150 },
  { id: 'ocean', kind: 'color', name: 'Havet', emoji: '', price: 150 },
  { id: 'candy', kind: 'color', name: 'Godis', emoji: '', price: 300 },
  { id: 'berry', kind: 'color', name: 'Blåbär', emoji: '', price: 400 },
  { id: 'galaxy', kind: 'color', name: 'Galaxen', emoji: '', price: 900 },
  { id: 'gold', kind: 'color', name: 'Guld', emoji: '', price: 2000, requires: { quizCorrect: 200 } },

  /* Rummet – saker som står i din hörna */
  { id: 'balloon', kind: 'room', name: 'Ballongen', emoji: '🎈', price: 120 },
  { id: 'lamp', kind: 'room', name: 'Lampan', emoji: '💡', price: 150 },
  { id: 'plant', kind: 'room', name: 'Monstera', emoji: '🪴', price: 200 },
  { id: 'candle', kind: 'room', name: 'Ljuset', emoji: '🕯️', price: 250 },
  { id: 'teddy', kind: 'room', name: 'Nallen', emoji: '🧸', price: 350 },
  { id: 'art', kind: 'room', name: 'Tavlan', emoji: '🖼️', price: 400 },
  { id: 'books', kind: 'room', name: 'Bokhyllan', emoji: '📚', price: 500 },
  { id: 'mirror', kind: 'room', name: 'Spegeln', emoji: '🪞', price: 650 },
  { id: 'guitar', kind: 'room', name: 'Gitarren', emoji: '🎸', price: 700 },
  { id: 'sofa', kind: 'room', name: 'Soffan', emoji: '🛋️', price: 800 },
  { id: 'window', kind: 'room', name: 'Fönstret', emoji: '🪟', price: 900 },
  { id: 'cat', kind: 'room', name: 'Katten', emoji: '🐈', price: 1000 },
  { id: 'disco', kind: 'room', name: 'Discokulan', emoji: '🪩', price: 1800, requires: { quizCorrect: 150 } }
];

export const ATELJE_ROOM_SLOTS = 8;

export const ATELJE_KINDS = [
  { key: 'emblem', label: 'Figur' },
  { key: 'color', label: 'Färg' },
  { key: 'accent', label: 'Accessoar' },
  { key: 'room', label: 'Rummet' }
];

export const DEFAULT_LOOK = { emblem: 'fox', accent: 'none', color: 'mint', room: [] };

const BY_ID = new Map(ATELJE_ITEMS.map((item) => [item.id, item]));

export const itemById = (id) => BY_ID.get(String(id || '')) || null;

/** Allt som är gratis ägs av alla – resten måste köpas. */
export function ownsItem(owned, id) {
  const item = itemById(id);
  if (!item) return false;
  if (item.price === 0) return true;
  return Array.isArray(owned) && owned.includes(item.id);
}

/** Ser till att ett sparat utseende bara innehåller saker spelaren äger. */
export function normalizeLook(look, owned) {
  const src = look && typeof look === 'object' ? look : {};
  const pick = (kind, value, fallback) => {
    const item = itemById(value);
    return item && item.kind === kind && ownsItem(owned, item.id) ? item.id : fallback;
  };
  const room = Array.isArray(src.room)
    ? src.room
        .map((id) => itemById(id))
        .filter((item) => item && item.kind === 'room' && ownsItem(owned, item.id))
        .map((item) => item.id)
        .slice(0, ATELJE_ROOM_SLOTS)
    : [];
  return {
    emblem: pick('emblem', src.emblem, DEFAULT_LOOK.emblem),
    accent: pick('accent', src.accent, DEFAULT_LOOK.accent),
    color: pick('color', src.color, DEFAULT_LOOK.color),
    room
  };
}

/** Figuren: en ring i vald färg, en figur i mitten och en accessoar i hörnet. */
export function avatarHTML(look, { size = '', className = '' } = {}) {
  const src = look && typeof look === 'object' ? look : {};
  const emblemItem = itemById(src.emblem);
  const emblem = emblemItem && emblemItem.kind === 'emblem' ? emblemItem : itemById(DEFAULT_LOOK.emblem);
  const accent = itemById(src.accent);
  const colorItem = itemById(src.color);
  const color = colorItem && colorItem.kind === 'color' ? colorItem.id : DEFAULT_LOOK.color;
  const cls = ['look', 'look--' + color, size ? 'look--' + size : '', className].filter(Boolean).join(' ');
  return `<span class="${cls}" aria-hidden="true">
    <span class="look__emblem">${emblem ? emblem.emoji : '🦊'}</span>
    ${accent && accent.emoji ? `<span class="look__accent">${accent.emoji}</span>` : ''}
  </span>`;
}

/* Platserna i rummet: vänster, botten och storlek per plats, så att sakerna
   sprider ut sig som i en riktig hörna i stället för på rad. */
const ROOM_SPOTS = [
  { left: 6, bottom: 12, scale: 1 },
  { left: 30, bottom: 4, scale: 1.15 },
  { left: 56, bottom: 14, scale: 0.95 },
  { left: 80, bottom: 2, scale: 1.1 },
  { left: 18, bottom: 40, scale: 1.25 },
  { left: 46, bottom: 52, scale: 1 },
  { left: 72, bottom: 44, scale: 1.2 },
  { left: 88, bottom: 58, scale: 0.9 }
];

/** Spelarens hörna – vägg, golv och sakerna hen har ställt fram. */
export function roomHTML(look, { className = '' } = {}) {
  const src = look && typeof look === 'object' ? look : {};
  const color = itemById(src.color) ? src.color : DEFAULT_LOOK.color;
  const items = (Array.isArray(src.room) ? src.room : [])
    .map((id) => itemById(id))
    .filter(Boolean)
    .slice(0, ATELJE_ROOM_SLOTS);
  const things = items
    .map((item, i) => {
      const spot = ROOM_SPOTS[i] || ROOM_SPOTS[0];
      return `<span class="room__item" style="left:${spot.left}%;bottom:${spot.bottom}%;font-size:calc(var(--room-scale, 1) * ${
        Math.round(34 * spot.scale)
      }px)">${item.emoji}</span>`;
    })
    .join('');
  return `<div class="room room--${color} ${className}">
    <span class="room__wall"></span>
    <span class="room__floor"></span>
    <span class="room__window"></span>
    ${things}
    ${items.length ? '' : '<span class="room__empty">Ditt rum är tomt – köp något i Ateljén</span>'}
  </div>`;
}
