// Den sista lågan — UI, screens and the game loop.
import { Input } from './input.js';
import { Game } from './game.js';
import { QUESTS, ITEMS, SHOP } from './world.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);

/* ---- UI state (declared before the game is built: the engine may call back
   into the UI while it is still constructing itself) ---- */
let zoneTimer = 0;
let toastTimer = 0;
let lastHp = -1;
let lastMaxHp = -1;
let lastItems = '';
let lastQuest = '';
let lastEmbers = -1;

const canvas = $('game');
const input = new Input(canvas);
const sound = new Sound();

const game = new Game(canvas, input, {});
game.attachSound(sound);
window.__sistalagan = { game, sound };

const ICONS = {
  torch: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2c1.6 2.4 1.2 4 .3 5-.7.8-1.1 1.6-.8 2.6.9-.5 1.6-1.3 1.8-2.4 1.9 1.8 2.7 4 2.7 5.8a5 5 0 1 1-10 0c0-2.2 1.3-4.6 3.2-6.4.3 1 .8 1.7 1.6 2.2-.7-1.7-.3-4.2 1.2-6.8Z" fill="#ffb45c"/><rect x="11" y="15" width="2" height="8" rx="1" fill="#8a6a44"/></svg>',
  bomb: '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="15" r="7" fill="#3c4150" stroke="#7a8296" stroke-width="1.4"/><path d="M15 7.5c1.2-1.6 2.6-1.8 3.6-1.2" stroke="#c9b089" stroke-width="1.6" stroke-linecap="round"/><circle cx="19" cy="5.6" r="1.8" fill="#ff8a4c"/><circle cx="8.4" cy="12.6" r="1.6" fill="#596176"/></svg>',
  bow: '<svg viewBox="0 0 24 24" fill="none"><path d="M7 3c5 2.4 8 6.4 8 9s-3 6.6-8 9" stroke="#c8a06a" stroke-width="1.8" stroke-linecap="round"/><path d="M7 3 7 21" stroke="#e9ddc4" stroke-width="1"/><path d="M5 12h14" stroke="#e9ddc4" stroke-width="1.4"/><path d="m19 12-3-2v4l3-2Z" fill="#e9ddc4"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path class="fill" d="M12 21s-8-5.1-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.6C20 15.9 12 21 12 21Z" stroke="rgba(0,0,0,0.35)" stroke-width="1"/></svg>',
};

/* ------------------------------------------------------------------- hud */

function renderHearts(animate = false) {
  const box = $('hearts');
  if (!box) return;
  const p = game.player;
  if (document.querySelectorAll('.heart').length !== p.maxHp) {
    box.innerHTML = '';
    for (let i = 0; i < p.maxHp; i++) {
      const h = document.createElement('div');
      h.className = 'heart';
      h.innerHTML = ICONS.heart;
      box.appendChild(h);
    }
  }
  [...box.children].forEach((el, i) => {
    const full = i < p.hp;
    const wasFull = el.dataset.full === '1';
    el.classList.toggle('is-empty', !full);
    el.dataset.full = full ? '1' : '0';
    if (animate && wasFull && !full) {
      el.classList.remove('is-lost');
      void el.offsetWidth;
      el.classList.add('is-lost');
    }
  });
}

function renderItems(highlight = null) {
  const box = $('items');
  if (!box) return;
  const p = game.player;
  const key = p.items.join(',');
  if (key !== lastItems) {
    lastItems = key;
    box.innerHTML = '';
    p.items.forEach((id, i) => {
      const slot = document.createElement('div');
      slot.className = 'item-slot';
      slot.dataset.slot = i;
      slot.innerHTML = `${ICONS[id] || ''}<span class="slot-key">${ITEMS[id]?.key || i + 1}</span>`;
      box.appendChild(slot);
    });
  }
  [...box.children].forEach((el, i) => {
    el.classList.toggle('is-active', i === p.item);
    if (highlight && ITEMS[highlight] && p.items[i] === highlight) {
      el.classList.remove('is-new');
      void el.offsetWidth;
      el.classList.add('is-new');
    }
  });
}

function renderEmbers() {
  const box = $('embers');
  if (box) box.textContent = String(game.flags.embers);
  const shopBox = $('shopEmbers');
  if (shopBox) shopBox.textContent = String(game.flags.embers);
}

function renderQuest() {
  const q = QUESTS.find((x) => x.id === game.quest) || QUESTS[0];
  const box = $('quest');
  if (box && q.text !== lastQuest) {
    lastQuest = q.text;
    box.textContent = q.text;
  }
  const pq = $('pauseQuest');
  if (pq) pq.textContent = q.text;
}

function renderHud(animate = false) {
  const p = game.player;
  if (p.hp !== lastHp || p.maxHp !== lastMaxHp) {
    lastHp = p.hp;
    lastMaxHp = p.maxHp;
    renderHearts(animate);
  }
  renderItems();
  if (game.flags.embers !== lastEmbers) {
    lastEmbers = game.flags.embers;
    renderEmbers();
  }
  renderQuest();
}

function showZone(def) {
  const card = $('zoneCard');
  if (!card) return;
  $('zoneName').textContent = def.name;
  $('zoneSub').textContent = def.sub || '';
  card.classList.add('is-on');
  clearTimeout(zoneTimer);
  zoneTimer = setTimeout(() => card.classList.remove('is-on'), 2600);
}

function toast(text) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

/* ---------------------------------------------------------------- screens */

function openScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('is-open', s.id === id));
}

function closeScreens() {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-open'));
}

function setHudLive(on) {
  $('hud')?.classList.toggle('is-live', on);
}

function updateContinueButton() {
  const btn = $('btnContinue');
  if (btn) btn.hidden = !Game.hasSave();
}

/* ---------------------------------------------------------------- dialog */

function renderDialog(d) {
  const box = $('dialog');
  if (!box) return;
  if (!d) {
    box.classList.remove('is-on');
    return;
  }
  $('dialogName').textContent = d.name;
  $('dialogText').textContent = d.lines[d.i] || '';
  box.classList.add('is-on');
}

/* ------------------------------------------------------------------ shop */

function renderShop(shop) {
  const box = $('shop');
  if (!box) return;
  if (!shop) {
    box.classList.remove('is-on');
    return;
  }
  const list = $('shopList');
  list.innerHTML = '';
  shop.items.forEach((item, i) => {
    const li = document.createElement('li');
    const bought = game.flags[`bought-${item.id}`] && !item.repeat;
    li.className = i === shop.index ? 'is-active' : '';
    li.innerHTML = `
      <span><b>${item.name}</b><br><span class="tiny">${item.desc}</span></span>
      <span class="${bought ? 'bought' : 'cost'}">${bought ? 'köpt' : `${item.cost} glöd`}</span>`;
    list.appendChild(li);
  });
  $('shopMsg').textContent = shop.message || '';
  $('shopEmbers').textContent = String(game.flags.embers);
  box.classList.add('is-on');
}

/* --------------------------------------------------------------- handlers */

game.cb = {
  onZone: (def) => {
    showZone(def);
    setHudLive(true);
    renderHud();
  },
  onDialog: renderDialog,
  onShop: renderShop,
  onQuest: () => renderQuest(),
  onEmbers: renderEmbers,
  onHud: () => renderHud(),
  onItem: (id) => {
    renderHud();
    if (ITEMS[id]) toast(`Du fick ${ITEMS[id].name}`);
  },
  onToast: toast,
  onLight: () => renderHud(),
  onSelect: (id) => {
    renderItems();
    if (ITEMS[id]) toast(ITEMS[id].name);
  },
  onDamage: () => renderHud(true),
  onParry: () => toast('Parerat!'),
  onDeath: () => {
    setHudLive(false);
    openScreen('screen-dead');
  },
  onPause: () => {
    game.mode = 'pause';
    setHudLive(false);
    openScreen('screen-pause');
  },
  onBoss: (active) => {
    if (active) toast('Gravens väktare vaknar');
  },
  onWin: (data) => {
    game.mode = 'win';
    renderWin(data);
    setHudLive(false);
    openScreen('screen-win');
    sound.win();
  },
};

function renderWin(data) {
  const stats = $('winStats');
  if (!stats) return;
  const minutes = Math.max(1, Math.round((game.time || 0) / 60));
  stats.textContent = `Glöd: ${data.flags.embers} · Hjärtan: ${data.maxHp} · Mörka nätter: ${data.flags.deaths} · Tid: ${minutes} min`;
}

/* ------------------------------------------------------------------ flow */

function startNew() {
  Game.clearSave();
  closeScreens();
  setHudLive(true);
  sound.init();
  sound.resume();
  game.startNew();
  renderHud();
}

function continueGame() {
  const data = Game.loadSave();
  closeScreens();
  setHudLive(true);
  sound.init();
  sound.resume();
  if (data) game.continueGame(data);
  else game.startNew();
  renderHud();
}

$('btnNew')?.addEventListener('click', () => {
  sound.init();
  startNew();
});
$('btnContinue')?.addEventListener('click', () => {
  sound.init();
  continueGame();
});
$('btnResume')?.addEventListener('click', () => {
  closeScreens();
  setHudLive(true);
  game.mode = 'play';
});
$('btnRestart')?.addEventListener('click', startNew);
$('btnRespawn')?.addEventListener('click', () => {
  closeScreens();
  setHudLive(true);
  game.respawn();
  renderHud();
});
$('btnWinBack')?.addEventListener('click', () => {
  closeScreens();
  setHudLive(true);
  game.mode = 'play';
  game.loadZone('village', { x: 750, y: 660 });
});
$('btnWinNew')?.addEventListener('click', startNew);

// Pause when the tab loses focus.
window.addEventListener('blur', () => {
  if (game.mode === 'play') game.cb.onPause?.();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'play') game.cb.onPause?.();
});

// Touch layout only where it makes sense.
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.body.classList.add('is-touch');
}

window.addEventListener('resize', () => {
  game.resize();
});

// Mute toggle.
input.onFirstInput = () => sound.resume();

/* ------------------------------------------------------------------ loop */

let last = performance.now();
let hudTick = 0;

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;

  if (game.mode === 'play' || game.mode === 'dialog' || game.mode === 'shop') {
    game.update(dt);
  } else {
    game.time += dt;
  }
  input.endFrame();

  if (game.mode === 'play' || game.mode === 'dialog' || game.mode === 'shop' || game.mode === 'title') {
    game.draw();
  }

  hudTick += dt;
  if (hudTick > 0.2) {
    hudTick = 0;
    if (game.mode === 'play') renderHud();
  }

  // Item hotkeys 1-3.
  if (game.mode === 'play') {
    for (const [i, id] of game.player.items.entries()) {
      if (input.hit(`slot${i}`)) {
        game.player.item = i;
        renderItems();
      }
    }
  }

  requestAnimationFrame(frame);
}

updateContinueButton();
renderHud();
renderQuest();
renderEmbers();
requestAnimationFrame(frame);
window.__sistalaganBooted = true;
