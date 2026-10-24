// Boot + DOM UI for DEN SISTA LÅGAN.

import { Game } from './game.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { draw } from './render.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const input = new Input(canvas);
const sound = new Sound();

/* All mutable UI state lives above `new Game`, so nothing can touch a
   half-initialised module while the engine is still being constructed. */
let lastHp = 3;
let lastMaxHp = 3;
let toastTimer = 0;
let zoneTimer = 0;
let hudLive = false;
let running = false;
let wasDialogue = false;
let lastShopSig = '';
let displayedLine = '';
let saveFlash = 0;

const ui = {
  hud: $('hud'),
  hearts: $('hearts'),
  oilPips: $('oilPips'),
  glodNum: $('glodNum'),
  objText: $('objText'),
  items: $('items'),
  nArrows: $('nArrows'),
  nBombs: $('nBombs'),
  zone: $('zone'),
  zoneName: $('zoneName'),
  zoneSub: $('zoneSub'),
  prompt: $('prompt'),
  toast: $('toast'),
  dialogue: $('dialogue'),
  dialogueName: $('dialogueName'),
  dialogueText: $('dialogueText'),
  shop: $('shop'),
  shopList: $('shopList'),
  shopGlod: $('shopGlod'),
  screenTitle: $('screen-title'),
  screenPause: $('screen-pause'),
  screenDead: $('screen-dead'),
  screenEnd: $('screen-end'),
  continueBtn: $('continueBtn'),
  muteBtn: $('muteBtn'),
  endStats: $('endStats'),
  endTitle: $('endTitle'),
  endText: $('endText'),
};

const game = new Game(canvas, input, {
  onSave: () => {
    saveFlash = 1;
  },
  onHurt: (dmg) => {
    sound.hurt();
    pulseHearts();
  },
  onDeath: () => {
    sound.die();
    showScreen('dead');
  },
  onRevive: () => {
    hideScreens();
  },
  onVictory: () => {
    sound.win();
    showEnd();
  },
  onDialogue: (name, line) => {
    ui.dialogue.classList.add('is-on');
    ui.dialogueName.textContent = name;
    displayedLine = line;
  },
  onDialogueEnd: () => {
    ui.dialogue.classList.remove('is-on');
  },
  onShop: (shop) => {
    ui.shop.classList.toggle('is-on', !!shop);
    renderShop(shop);
  },
  onShopTick: (shop) => renderShop(shop),
  onToast: (text) => {
    ui.toast.textContent = text;
    ui.toast.classList.add('is-on');
    toastTimer = 3.2;
  },
  onScene: (scene, zone) => {
    ui.zoneName.textContent = zone.name;
    ui.zoneSub.textContent = zone.sub || '';
    ui.zone.classList.add('show');
    zoneTimer = 2.6;
  },
  onZone: (zone) => {
    ui.zoneName.textContent = zone.name;
    ui.zoneSub.textContent = zone.sub || '';
    ui.zone.classList.add('show');
    zoneTimer = 2.6;
  },
  onPerfectParry: () => sound.perfectParry(),
  onBlock: () => sound.block(),
  onHit: (counter) => (counter ? sound.perfectParry() : sound.hit()),
  onSwing: () => sound.sword(),
  onParry: () => sound.parry(),
  onBrazier: () => sound.ignite(),
  onPlaceLantern: () => sound.placeLantern(),
  onBow: () => sound.bow(),
  onBomb: () => sound.bomb(),
  onCrack: () => sound.gate(),
  onGate: () => sound.gate(),
  onChest: () => sound.pickup(),
  onPickup: () => sound.pickup(),
  onBuy: () => sound.buy(),
  onDenied: () => sound.click(),
  onTalk: () => sound.talk(),
  onStep: () => sound.step(),
  onKill: () => sound.hit(),
  onUpgrade: () => sound.buy(),
  onHeart: () => sound.pickup(),
  onCold: () => sound.hurt(),
  onRest: () => {
    sound.pickup();
    pulseHearts();
  },
  onBossStart: () => {
    sound.bossRoar();
    ui.toast.textContent = 'Något gammalt rör på sig.';
    ui.toast.classList.add('is-on');
    toastTimer = 3.4;
  },
  onBossPhase: () => {
    sound.bossRoar();
  },
  onPause: (on) => showScreen(on ? 'pause' : null),
});

window.__laga = { game, sound, input };

/* ------------------------------------------------------------------ screens */

function showScreen(which) {
  for (const key of ['title', 'pause', 'dead', 'end']) {
    ui[`screen${key[0].toUpperCase()}${key.slice(1)}`].classList.toggle('is-open', key === which);
  }
}

function hideScreens() {
  for (const key of ['title', 'pause', 'dead', 'end']) {
    ui[`screen${key[0].toUpperCase()}${key.slice(1)}`].classList.remove('is-open');
  }
}

function beginGame(load = false) {
  hideScreens();
  sound.ensure();
  if (load) {
    const ok = game.loadSave();
    if (!ok) game.start();
  } else {
    game.wipeSave();
    game.start();
  }
  hudLive = true;
  ui.hud.classList.add('is-live');
  lastMaxHp = game.player.maxHp;
  buildHearts();
  lastHp = game.player.hp;
  window.__booted = true;
}

function showEnd() {
  const g = game;
  const lit = g.litCount();
  ui.endTitle.textContent = g.flags.fireLit ? 'Lågan brinner' : 'Förbannelsen är bruten';
  ui.endText.textContent = g.flags.fireLit
    ? 'Förbannelsen fick tillbaka sitt löfte, och byn fick sin eld. Du står kvar i ljuset — en främling som blev den som bar det vidare.'
    : 'Det som höll lågan fången är borta. Bär den tillbaka till Vedstorp och tänd den stora elden.';
  ui.endStats.innerHTML = `
    <div><strong>${lit}</strong><span>eldar tända</span></div>
    <div><strong>${g.player.sword}</strong><span>svärdsgrad</span></div>
    <div><strong>${g.player.maxHp}</strong><span>hjärtan</span></div>
    <div><strong>${Math.round(g.time / 60)}</strong><span>minuter</span></div>`;
  showScreen('end');
}

/* ---------------------------------------------------------------------- HUD */

function buildHearts() {
  const p = game.player;
  ui.hearts.innerHTML = '';
  for (let i = 0; i < p.maxHp; i++) {
    const d = document.createElement('div');
    d.className = 'heart' + (i < p.hp ? '' : ' empty');
    ui.hearts.appendChild(d);
  }
}

function pulseHearts() {
  for (const h of ui.hearts.children) {
    h.classList.remove('pulse');
    void h.offsetWidth;
    h.classList.add('pulse');
  }
}

function renderHearts() {
  const p = game.player;
  if (ui.hearts.children.length !== p.maxHp) buildHearts();
  [...ui.hearts.children].forEach((el, i) => {
    el.classList.toggle('empty', i >= p.hp);
  });
  if (p.hp < lastHp) pulseHearts();
  lastHp = p.hp;
}

function renderOil() {
  const p = game.player;
  if (ui.oilPips.children.length !== p.maxOil) {
    ui.oilPips.innerHTML = '';
    for (let i = 0; i < p.maxOil; i++) {
      const d = document.createElement('div');
      d.className = 'oil-pip';
      ui.oilPips.appendChild(d);
    }
  }
  [...ui.oilPips.children].forEach((el, i) => el.classList.toggle('on', i < p.oil));
}

function renderItems() {
  const p = game.player;
  [...ui.items.querySelectorAll('.item')].forEach((el) => {
    const id = el.dataset.item;
    el.classList.toggle('active', p.item === id);
    el.classList.toggle('locked', !p.owned[id]);
  });
  ui.nArrows.textContent = p.owned.bow ? p.arrows : '–';
  ui.nBombs.textContent = p.bombs;
  ui.glodNum.textContent = p.glod;
}

function renderHud() {
  if (!hudLive) return;
  renderHearts();
  renderOil();
  renderItems();
  const obj = game.objective();
  ui.objText.textContent = obj ? obj.text : '';
  ui.objText.style.opacity = obj ? '1' : '0';

  const prompt = contextPrompt();
  ui.prompt.innerHTML = prompt || '';
  ui.prompt.classList.toggle('is-on', !!prompt);
}

function contextPrompt() {
  const g = game;
  if (g.mode !== 'play') return '';
  const p = g.player;
  const near = (x, y, r) => Math.hypot(p.x - x, p.y - y) < r;

  const npc = g.npcsNear?.();
  if (npc) return `<kbd>E</kbd> prata med ${npc.name}`;
  if (g.braziersHere().some((b) => !g.flags.braziers[b.id] && near(b.x, b.y, 95))) {
    return `<kbd>E</kbd> tänd med facklan`;
  }
  if (g.scene === 'overworld' && g.nearDungeonEntrance()) {
    return g.ringLit() ? '<kbd>E</kbd> gå ner' : 'Tre eldar i ringen måste brinna';
  }
  if (g.scene === 'overworld' && near(1600, 2000, 110)) {
    return g.flags.bossDead ? '<kbd>E</kbd> tänd den stora elden' : '<kbd>E</kbd> lyssna';
  }
  if (g.scene === 'dungeon') {
    const f = g.sceneDef;
    if (f.stairs && near(f.stairs.x + f.stairs.w / 2, f.stairs.y + 30, 75)) return '<kbd>E</kbd> gå ned';
    if (g.floor > 0 && near(650, 780, 75)) return '<kbd>E</kbd> gå upp';
    if (g.floor === 0 && near(650, 770, 85)) return '<kbd>E</kbd> ut i Stenringen';
  }
  return '';
}

function renderShop(shop) {
  if (!shop) return;
  const sig = `${shop.index}-${game.player.glod}-${game.player.bombs}-${game.player.arrows}-${game.player.oil}-${game.player.hp}`;
  if (sig === lastShopSig) return;
  lastShopSig = sig;
  ui.shopGlod.textContent = game.player.glod;
  ui.shopList.innerHTML = shop.options
    .map(
      (o, i) =>
        `<li class="${i === shop.index ? 'sel' : ''} ${game.player.glod < o.cost ? 'poor' : ''}">
           <span>${o.name}</span><span class="cost">${o.cost} glöd</span>
         </li>`,
    )
    .join('');
}

/* ----------------------------------------------------------------- keyboard */

function handleGlobalKeys(e) {
  if (e.code === 'Escape') {
    if (game.mode === 'title' || !hudLive) return;
    if (game.mode === 'shop') {
      game.shop = null;
      game.mode = 'play';
      ui.shop.classList.remove('is-on');
    }
  }
  if (e.code === 'Enter') {
    if (ui.screenTitle.classList.contains('is-open')) beginGame(false);
  }
}

window.addEventListener('keydown', handleGlobalKeys);

/* -------------------------------------------------------------------- touch */

const touch = $('touch');
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) touch.classList.add('on');

const stick = $('stick');
const knob = $('stickKnob');
let stickId = null;

function setStick(dx, dy) {
  const mag = Math.hypot(dx, dy);
  const max = 44;
  const k = mag > max ? max / mag : 1;
  const x = dx * k;
  const y = dy * k;
  knob.style.transform = `translate(${x}px, ${y}px)`;
  const dead = 10;
  input.held.delete('left');
  input.held.delete('right');
  input.held.delete('up');
  input.held.delete('down');
  if (x < -dead) input.held.add('left');
  if (x > dead) input.held.add('right');
  if (y < -dead) input.held.add('up');
  if (y > dead) input.held.add('down');
}

function stickFromEvent(e) {
  const r = stick.getBoundingClientRect();
  setStick(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
}

stick.addEventListener('pointerdown', (e) => {
  stickId = e.pointerId;
  stick.setPointerCapture(e.pointerId);
  stickFromEvent(e);
});
stick.addEventListener('pointermove', (e) => {
  if (e.pointerId === stickId) stickFromEvent(e);
});
const endStick = (e) => {
  if (e.pointerId !== stickId) return;
  stickId = null;
  knob.style.transform = 'translate(0px, 0px)';
  input.held.delete('left');
  input.held.delete('right');
  input.held.delete('up');
  input.held.delete('down');
};
stick.addEventListener('pointerup', endStick);
stick.addEventListener('pointercancel', endStick);

for (const btn of document.querySelectorAll('[data-touch]')) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const action = btn.dataset.touch;
    input.edges.add(action);
    input.held.add(action);
    sound.ensure();
  });
  btn.addEventListener('pointerup', () => input.held.delete(btn.dataset.touch));
  btn.addEventListener('pointerleave', () => input.held.delete(btn.dataset.touch));
}

/* ------------------------------------------------------------------ buttons */

$('startBtn').addEventListener('click', () => beginGame(false));
ui.continueBtn.addEventListener('click', () => beginGame(true));
$('resumeBtn').addEventListener('click', () => {
  game.mode = 'play';
  hideScreens();
});
ui.muteBtn.addEventListener('click', () => {
  const muted = sound.toggle();
  ui.muteBtn.textContent = muted ? 'Ljud: av' : 'Ljud: på';
});
$('restartBtn').addEventListener('click', () => {
  game.wipeSave();
  hideScreens();
  game.start();
  buildHearts();
  hudLive = true;
  ui.hud.classList.add('is-live');
  sound.click();
});
$('reviveBtn').addEventListener('click', () => {
  hideScreens();
  game.revive();
  buildHearts();
});
$('keepBtn').addEventListener('click', () => {
  hideScreens();
  game.toVillageAfterWin();
});
$('bootReload').addEventListener('click', () => location.reload());

for (const el of ui.items.querySelectorAll('.item')) {
  el.addEventListener('click', () => {
    game.selectItem(el.dataset.item);
    sound.click();
  });
}

/* --------------------------------------------------------------------- loop */

let last = performance.now();

function frame(now) {
  const raw = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;

  game.update(raw);

  // Overlays that the engine drives.
  if (hudLive) {
    const pauseOpen = game.mode === 'pause';
    if (pauseOpen !== ui.screenPause.classList.contains('is-open')) {
      ui.screenPause.classList.toggle('is-open', pauseOpen);
    }
    if (game.mode === 'dead' && !ui.screenDead.classList.contains('is-open')) showScreen('dead');
    if (game.mode !== 'dead' && ui.screenDead.classList.contains('is-open') && !game.player.dead) {
      ui.screenDead.classList.remove('is-open');
    }
    if (game.mode === 'end' && !ui.screenEnd.classList.contains('is-open')) showEnd();
    if (game.mode !== 'end' && ui.screenEnd.classList.contains('is-open')) {
      // the "stay in Vedstorp" button drives this transition
    }
  }

  // Dialogue typing.
  if (game.dialogue) {
    const d = game.dialogue;
    const line = d.lines[d.index].slice(0, Math.floor(d.char));
    ui.dialogueText.textContent = line;
    if (!wasDialogue) {
      ui.dialogue.classList.add('is-on');
      ui.dialogueName.textContent = d.name;
      wasDialogue = true;
    }
  } else if (wasDialogue) {
    ui.dialogue.classList.remove('is-on');
    wasDialogue = false;
  }

  if (game.mode === 'shop') {
    ui.shop.classList.add('is-on');
    renderShop(game.shop);
  } else if (ui.shop.classList.contains('is-on') && game.mode !== 'shop') {
    ui.shop.classList.remove('is-on');
  }

  if (toastTimer > 0) {
    toastTimer -= raw;
    if (toastTimer <= 0) ui.toast.classList.remove('is-on');
  }
  if (zoneTimer > 0) {
    zoneTimer -= raw;
    if (zoneTimer <= 0) ui.zone.classList.remove('show');
  }
  if (saveFlash > 0) {
    saveFlash -= raw;
    ui.hud.dataset.saved = saveFlash > 0 ? '1' : '0';
  }

  renderHud();
  draw(game);
  requestAnimationFrame(frame);
}

// Keep the canvas sharp when the window changes.
window.addEventListener('resize', () => game.resize());

// Title state: show continue only when there is something to continue.
ui.continueBtn.disabled = !game.hasSave();
window.__booted = true;
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});
