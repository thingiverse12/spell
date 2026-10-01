/**
 * Spell - tiny i18n layer. Swedish is the default (the design report is
 * Swedish); English is a click away in the settings.
 */

const STRINGS = {
  sv: {
    tagline: 'Lågpoly-överlevnad i webbläsaren',
    menuSub: 'Prototyp: MVP ur utvecklingsplanen — motor, nätverk, crafting, bygge',
    menuName: 'Namn',
    menuPlay: 'Spela',
    menuHow: 'Så spelar du',
    connecting: 'Ansluter …',
    loading: 'Bygger världen …',
    invTitle: 'Ryggsäck',
    tabInv: 'Föremål',
    tabCraft: 'Tillverka',
    invHelp: 'Klicka för att välja, klicka igen för att flytta. Högerklick = använd/ät. R = reparera.',
    buildTitle: 'Bygg',
    buildHelp: 'Välj del, sikta mot marken och vänsterklicka. R eller mushjul roterar. Högerklick tar bort.',
    mapTitle: 'Karta',
    setTitle: 'Inställningar',
    helpTitle: 'Så spelar du',
    close: 'Stäng (Tab)', close2: 'Stäng (B)', close3: 'Stäng (M)', close4: 'Stäng (Esc)', close5: 'Stäng',
    deadTitle: 'Du dog',
    respawn: 'Återuppstå',
    dcTitle: 'Anslutningen bröts',
    reconnect: 'Anslut igen',
    playAsGuest: 'Spela som gäst',
    reconnecting: 'Återansluter … (försök {n})',
    serverOffline: 'Servern svarar inte. Starta om den (npm start) och försök igen.',
    wsBlocked: 'Kunde inte öppna WebSocket-anslutningen. Servern svarar på HTTP men vägrar spelanslutningen — kontrollera att proxyn/porten tillåter WebSocket.',
    alreadyConnected: 'Samma spelare är redan inloggad i en annan flik. Välj "Spela som gäst" för att spela som en egen spelare.',
    guestToast: 'Du spelar som gäst — samma spelare var upptagen i en annan flik.',
    setRender: 'Siktavstånd', setFov: 'Synfält', setSens: 'Musens känslighet',
    setShadows: 'Skuggor', setInvert: 'Invertera mus (Y)', setSound: 'Ljud',
    setLang: 'Språk', setSimple: 'Enkel grafik (lågpresterande)',
    noTool: 'Handkraft',
    hintHarvest: 'Vänsterklick: samla', hintAttack: 'Vänsterklick: anfall',
    hintPlace: 'Vänsterklick: bygg', hintRotate: 'R: rotera', hintCancel: 'B: avsluta byggläge',
    crafting: 'Tillverkar', crafted: 'Tillverkade', missing: 'Saknar material',
    full: 'Ryggsäcken är full', tooFar: 'För långt bort', needStation: 'Kräver lägereld',
    needFoundation: 'Kräver grund', uneven: 'Ojämn mark', occupied: 'Upptaget',
    inWater: 'I vatten', outsideWorld: 'Utanför världen', floating: 'Saknar stöd',
    alreadyFull: 'Redan fullt skick', notRepairable: 'Går inte att reparera',
    repaired: 'Reparerad', equipped: 'Utrustad', ate: 'Åt', empty: 'Tomt',
    alive: 'Du lever', notOpenable: 'Går inte att öppna', gone: 'Borta', unknownRecipe: 'Okänt recept',
    joined: 'anslöt', left: 'lämnade', say: 'säger',
    chatSlow: 'Ta det lugnt med chatten',
    builtBy: 'Byggd av',
    damage: 'Skada', health: 'Hälsa', hunger: 'Hunger', thirst: 'Törst', stamina: 'Stamina',
    dropped: 'Tappade', killed: 'Dödade', killedAnimal: 'Djur fällda', deaths: 'Dödsfall',
    day: 'dag', night: 'natt',
    dead_cause_starve: 'Du svalt ihjäl', dead_cause_thirst: 'Du dog av törst',
    dead_cause_drown: 'Du drunknade', dead_cause_cold: 'Du frös ihjäl',
    dead_cause_fall: 'Du föll ihjäl', dead_cause_melee: 'Du dödades',
    dead_cause_animal: 'Du dödades av ett djur', dead_cause_unknown: 'Du dog',
    hurtBy: 'Skadad av',
    pickedUp: 'Plockade upp',
    offline: 'SERVERN ÄR OFFLINE — kör npm start i terminalen.',
  },
  en: {
    tagline: 'Low-poly survival in the browser',
    menuSub: 'Prototype: the MVP from the development plan — engine, networking, crafting, building',
    menuName: 'Name',
    menuPlay: 'Play',
    menuHow: 'How to play',
    connecting: 'Connecting …',
    loading: 'Building the world …',
    invTitle: 'Backpack',
    tabInv: 'Items',
    tabCraft: 'Craft',
    invHelp: 'Click to pick up, click again to move. Right click = use/eat. R = repair.',
    buildTitle: 'Build',
    buildHelp: 'Pick a piece, aim at the ground and left click. R or the mouse wheel rotates. Right click removes.',
    mapTitle: 'Map',
    setTitle: 'Settings',
    helpTitle: 'How to play',
    close: 'Close (Tab)', close2: 'Close (B)', close3: 'Close (M)', close4: 'Close (Esc)', close5: 'Close',
    deadTitle: 'You died',
    respawn: 'Respawn',
    dcTitle: 'Connection lost',
    reconnect: 'Reconnect',
    playAsGuest: 'Play as guest',
    reconnecting: 'Reconnecting … (attempt {n})',
    serverOffline: 'The server is not responding. Restart it (npm start) and try again.',
    wsBlocked: 'Could not open the WebSocket connection. The server answers over HTTP but refuses the game connection — check that the proxy/port allows WebSocket upgrades.',
    alreadyConnected: 'This player is already connected in another tab. Choose "Play as guest" to join as a separate player.',
    guestToast: 'Playing as a guest — the same player was taken in another tab.',
    setRender: 'View distance', setFov: 'Field of view', setSens: 'Mouse sensitivity',
    setShadows: 'Shadows', setInvert: 'Invert mouse (Y)', setSound: 'Sound',
    setLang: 'Language', setSimple: 'Simple graphics (low end)',
    noTool: 'Bare hands',
    hintHarvest: 'Left click: gather', hintAttack: 'Left click: attack',
    hintPlace: 'Left click: place', hintRotate: 'R: rotate', hintCancel: 'B: exit build mode',
    crafting: 'Crafting', crafted: 'Crafted', missing: 'Missing materials',
    full: 'Inventory is full', tooFar: 'Too far away', needStation: 'Needs a campfire',
    needFoundation: 'Needs a foundation', uneven: 'Uneven ground', occupied: 'Occupied',
    inWater: 'In water', outsideWorld: 'Outside the world', floating: 'Unsupported',
    alreadyFull: 'Already in full condition', notRepairable: 'Cannot be repaired',
    repaired: 'Repaired', equipped: 'Equipped', ate: 'Ate', empty: 'Empty',
    alive: 'You are alive', notOpenable: 'Cannot be opened', gone: 'Gone', unknownRecipe: 'Unknown recipe',
    joined: 'joined', left: 'left', say: 'says',
    chatSlow: 'Slow down with the chat',
    builtBy: 'Built by',
    damage: 'Damage', health: 'Health', hunger: 'Hunger', thirst: 'Thirst', stamina: 'Stamina',
    dropped: 'Dropped', killed: 'Kills', killedAnimal: 'Animals', deaths: 'Deaths',
    day: 'day', night: 'night',
    dead_cause_starve: 'You starved', dead_cause_thirst: 'You died of thirst',
    dead_cause_drown: 'You drowned', dead_cause_cold: 'You froze to death',
    dead_cause_fall: 'You fell to your death', dead_cause_melee: 'You were killed',
    dead_cause_animal: 'You were killed by an animal', dead_cause_unknown: 'You died',
    hurtBy: 'Hurt by',
    pickedUp: 'Picked up',
    offline: 'THE SERVER IS OFFLINE — run npm start in your terminal.',
  },
};

let lang = 'sv';

export function setLang(next) {
  lang = STRINGS[next] ? next : 'sv';
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    const val = STRINGS[lang][key];
    if (val) el.textContent = val;
  }
  return lang;
}

export function getLang() { return lang; }

export function t(key, vars) {
  let s = STRINGS[lang][key] ?? STRINGS.sv[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

export function itemName(item) {
  const def = item?.def || item;
  if (!def) return '';
  return lang === 'sv' ? (def.name || def.label) : (def.nameEn || def.labelEn || def.name || def.label);
}

export function pieceName(piece) {
  const def = piece?.def || piece;
  if (!def) return '';
  return lang === 'sv' ? def.label : (def.labelEn || def.label);
}
