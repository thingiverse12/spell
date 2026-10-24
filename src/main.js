import { Game } from './game.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { SPELLS } from './spells.js';

const canvas = document.getElementById('game');
const sound = new Sound();
const input = new Input(canvas);

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'),
  hpFill: $('hpFill'),
  hpText: $('hpText'),
  manaFill: $('manaFill'),
  manaText: $('manaText'),
  waveNum: $('waveNum'),
  scoreText: $('scoreText'),
  bestText: $('bestText'),
  muteBtn: $('muteBtn'),
  abilities: $('abilities'),
  banner: $('banner'),
  bannerTitle: $('bannerTitle'),
  bannerSub: $('bannerSub'),
  titleScreen: $('screen-title'),
  upgradeScreen: $('screen-upgrade'),
  pauseScreen: $('screen-pause'),
  deadScreen: $('screen-dead'),
  cards: $('cards'),
  upgradeWave: $('upgradeWave'),
  titleBest: $('titleBest'),
  finalWave: $('finalWave'),
  finalScore: $('finalScore'),
  finalBest: $('finalBest'),
};

const game = new Game(canvas, input, {
  onWaveStart: (n) => {
    const isBoss = n % 5 === 0;
    showBanner(`VÅG ${n}`, isBoss ? 'En väktare vaknar' : 'Fienderna anländer');
    sound.wave();
    ui.waveNum.textContent = String(n);
  },
  onWaveClear: (n, picks) => {
    openUpgrades(n, picks);
  },
  onDeath: ({ wave, score, best }) => {
    ui.finalWave.textContent = String(wave);
    ui.finalScore.textContent = String(score);
    ui.finalBest.textContent = String(best);
    ui.bestText.textContent = String(best);
    ui.titleBest.textContent = String(best);
    hideScreens();
    ui.deadScreen.classList.add('is-open');
    ui.hud.classList.remove('is-live');
    document.body.classList.remove('is-playing');
    sound.death();
  },
  onHurt: () => sound.hurt(),
  onPickup: () => sound.pickup(),
  onNoMana: () => sound.noMana(),
});

/* ----------------------------------------------------------- abilities */

const abilityEls = new Map();
for (const spell of SPELLS) {
  const el = document.createElement('div');
  el.className = 'ability is-ready';
  el.style.setProperty('--accent', spell.accent);
  el.innerHTML = `
    <span class="key">${spell.key}</span>
    <span class="glyph">${spell.glyph}</span>
    <span class="label">${spell.name}</span>
    <span class="cost">${spell.cost > 0 ? spell.cost : ''}</span>
    <div class="cd"></div>
  `;
  el.title = `${spell.name} — ${spell.hint}${spell.cost ? ` (${spell.cost} mana)` : ''}`;
  // Tappable on touch devices, where there is no right mouse button.
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (ui.upgradeScreen.classList.contains('is-open') || ui.pauseScreen.classList.contains('is-open')) return;
    game.cast(spell.id);
  });
  ui.abilities.appendChild(el);
  abilityEls.set(spell.id, { el, cd: el.querySelector('.cd'), cost: spell.cost });
}

/* -------------------------------------------------------------- banner */

let bannerTimer = 0;
function showBanner(title, sub) {
  ui.bannerTitle.textContent = title;
  ui.bannerSub.textContent = sub || '';
  ui.banner.classList.add('is-on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => ui.banner.classList.remove('is-on'), 1900);
}

/* ------------------------------------------------------------- screens */

function hideScreens() {
  for (const s of [ui.titleScreen, ui.upgradeScreen, ui.pauseScreen, ui.deadScreen]) {
    s.classList.remove('is-open');
  }
}

let offeredUpgrades = [];
let pausedFrom = null;

function openUpgrades(wave, picks) {
  offeredUpgrades = picks;
  ui.upgradeWave.textContent = `Våg ${wave} klar`;
  ui.cards.innerHTML = '';
  picks.forEach((u, i) => {
    const level = game.levels[u.id] || 0;
    const pips = Array.from({ length: u.max }, (_, k) => `<i class="${k < level ? 'on' : ''}"></i>`).join('');
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.style.setProperty('--accent', u.accent);
    card.innerHTML = `
      <span class="card-key">${i + 1}</span>
      <span class="card-icon">${u.icon}</span>
      <h3>${u.name}</h3>
      <p>${u.desc}</p>
      <span class="card-foot">Nivå ${level + 1} / ${u.max}<span class="pips">${pips}</span></span>
    `;
    card.addEventListener('click', () => chooseUpgrade(u));
    ui.cards.appendChild(card);
  });
  hideScreens();
  ui.upgradeScreen.classList.add('is-open');
  sound.upgrade();
}

function chooseUpgrade(u) {
  if (!ui.upgradeScreen.classList.contains('is-open')) return;
  game.applyUpgrade(u.id);
  sound.click();
  hideScreens();
  game.beginWave(game.wave + 1);
}

function startRun() {
  sound.ready();
  sound.click();
  hideScreens();
  input.pressed.clear();
  document.body.classList.add('is-playing');
  ui.hud.classList.add('is-live');
  game.start();
}

function togglePause(force) {
  const paused = game.phase === 'paused';
  const shouldPause = force !== undefined ? force : !paused;

  if (shouldPause && (game.phase === 'combat' || game.phase === 'clear')) {
    pausedFrom = game.phase;
    game.phase = 'paused';
    ui.pauseScreen.classList.add('is-open');
    document.body.classList.remove('is-playing');
    sound.click();
  } else if (!shouldPause && paused) {
    game.phase = pausedFrom || 'combat';
    pausedFrom = null;
    ui.pauseScreen.classList.remove('is-open');
    document.body.classList.add('is-playing');
    sound.click();
  }
}

$('startBtn').addEventListener('click', startRun);
$('pauseBtn').addEventListener('click', () => togglePause());
$('againBtn').addEventListener('click', startRun);
$('resumeBtn').addEventListener('click', () => togglePause(false));
$('quitBtn').addEventListener('click', () => {
  game.phase = 'idle';
  game.player = null;
  game.enemies.length = 0;
  game.projectiles.length = 0;
  game.hazards.length = 0;
  game.particles.length = 0;
  game.pickups.length = 0;
  game.texts.length = 0;
  game.effects.length = 0;
  hideScreens();
  ui.pauseScreen.classList.remove('is-open');
  ui.titleScreen.classList.add('is-open');
  ui.hud.classList.remove('is-live');
  document.body.classList.remove('is-playing');
  const best = game.saveBest();
  ui.titleBest.textContent = String(best);
  ui.bestText.textContent = String(best);
  sound.click();
});

function syncMuteUI() {
  ui.muteBtn.classList.toggle('is-muted', sound.muted);
  ui.muteBtn.textContent = sound.muted ? '♪' : '♪';
  ui.muteBtn.title = sound.muted ? 'Ljud på (M)' : 'Ljud av (M)';
}
ui.muteBtn.addEventListener('click', () => {
  sound.toggle();
  sound.click();
  syncMuteUI();
});
syncMuteUI();

ui.titleBest.textContent = String(game.best);
ui.bestText.textContent = String(game.best);
ui.titleScreen.classList.add('is-open');

/* ------------------------------------------------------------ keyboard */

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    sound.toggle();
    sound.click();
    syncMuteUI();
    return;
  }

  if (ui.upgradeScreen.classList.contains('is-open')) {
    const idx = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
    if (idx !== undefined && offeredUpgrades[idx]) {
      e.preventDefault();
      chooseUpgrade(offeredUpgrades[idx]);
    }
    return;
  }

  if (e.code === 'Escape') {
    e.preventDefault();
    if (game.phase === 'combat' || game.phase === 'clear' || game.phase === 'paused') {
      togglePause();
    }
    return;
  }

  if (ui.deadScreen.classList.contains('is-open') && (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space')) {
    e.preventDefault();
    startRun();
    return;
  }

  if (ui.titleScreen.classList.contains('is-open') && (e.code === 'Enter' || e.code === 'Space')) {
    e.preventDefault();
    startRun();
  }
});

/* ---------------------------------------------------------------- loop */

let last = performance.now();
let raf = 0;

function updateHud() {
  const p = game.player;
  if (!p) return;
  const hpPct = Math.max(0, (p.hp / p.maxHp) * 100);
  const manaPct = Math.max(0, (p.mana / p.maxMana) * 100);
  ui.hpFill.style.width = `${hpPct}%`;
  ui.manaFill.style.width = `${manaPct}%`;
  ui.hpText.textContent = `${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`;
  ui.manaText.textContent = `${Math.floor(p.mana)} / ${Math.round(p.maxMana)}`;
  ui.scoreText.textContent = String(game.score);
  ui.bestText.textContent = String(Math.max(game.best, game.score));

  for (const spell of SPELLS) {
    const entry = abilityEls.get(spell.id);
    const remain = game.cooldowns[spell.id] || 0;
    const total = spell.cooldown * game.stats.haste;
    const ratio = total > 0 ? Math.min(1, remain / total) : 0;
    entry.cd.style.height = `${ratio * 100}%`;
    const noMana = p.mana < spell.cost;
    entry.el.classList.toggle('no-mana', noMana);
    entry.el.classList.toggle('is-ready', ratio === 0 && !noMana);
  }
}

function frame(ts) {
  const dt = Math.min(0.034, Math.max(0, (ts - last) / 1000));
  last = ts;

  if (game.phase === 'combat' || game.phase === 'clear' || game.phase === 'dead' || game.phase === 'idle') {
    game.update(dt);
  }

  game.draw();
  updateHud();
  input.endFrame();
  raf = requestAnimationFrame(frame);
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => game.resize(), 120);
});

raf = requestAnimationFrame(frame);
window.addEventListener('beforeunload', () => cancelAnimationFrame(raf));

// Expose for quick debugging in the console.
window.__spell = { game, sound };
