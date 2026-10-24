import { Game } from './game.js';
import { Input } from './input.js';
import { Sound } from './audio.js';

const canvas = document.getElementById('game');
const sound = new Sound();
const input = new Input(canvas);
const $ = (id) => document.getElementById(id);

const ui = {
  hud: $('hud'),
  masks: $('masks'),
  soulFill: $('soulFill'),
  geoCount: $('geoCount'),
  prompt: $('prompt'),
  banner: $('banner'),
  bannerTitle: $('bannerTitle'),
  bannerSub: $('bannerSub'),
  hintBar: $('hintBar'),
  muteBtn: $('muteBtn'),
  pauseBtn: $('pauseBtn'),
  titleScreen: $('screen-title'),
  pauseScreen: $('screen-pause'),
  benchScreen: $('screen-bench'),
  deadScreen: $('screen-dead'),
  winScreen: $('screen-win'),
  titleBest: $('titleBest'),
  deadStone: $('deadStone'),
  deadDeaths: $('deadDeaths'),
  winStone: $('winStone'),
  winDeaths: $('winDeaths'),
  winTime: $('winTime'),
  touch: $('touch'),
  touchStick: $('touchStick'),
};

const AREAS = [
  { id: 'well', from: -Infinity, to: 2250, title: 'Den sjunkna brunnen', sub: 'Djupt under berget' },
  { id: 'vault', from: 2250, to: 3560, title: 'Valvet med lyktorna', sub: 'Ljus som ingen tänt' },
  { id: 'hall', from: 3560, to: Infinity, title: 'Väktarens hall', sub: 'Något vakar här' },
];
const seenAreas = new Set();

const game = new Game(canvas, input, {
  onStart: () => {
    document.body.classList.add('is-playing');
    ui.hud.classList.add('is-live');
    seenAreas.clear();
    ui.hintBar.style.opacity = '1';
    setTimeout(() => (ui.hintBar.style.opacity = '0'), 14000);
    sound.ready();
    sound.click();
    showArea();
    buildMasks();
  },
  onMode: (mode) => handleMode(mode),
  onJump: () => sound.jump(),
  onDoubleJump: () => sound.doubleJump(),
  onLand: () => sound.land(),
  onDash: () => sound.dash(),
  onSwing: () => sound.swing(),
  onHit: () => sound.hit(),
  onKill: () => sound.kill(),
  onHurt: () => {
    sound.hurt();
    pulseMask();
  },
  onSpit: () => sound.spit(),
  onGuardian: () => sound.roar(),
  onBench: () => sound.bench(),
  onDeath: () => {
    sound.death();
    ui.deadStone.textContent = String(game.stone);
    ui.deadDeaths.textContent = String(game.stats.deaths);
    hideScreens();
    ui.deadScreen.classList.add('is-open');
    ui.hud.classList.remove('is-live');
    document.body.classList.remove('is-playing');
  },
  onFocus: () => sound.bench(),
  onSpell: () => sound.spell(),
  onSpellHit: () => sound.spellHit(),
  onNoSoul: () => sound.noSoul(),
  onRespawn: () => sound.click(),
  onWin: ({ stone, time }) => {
    ui.winStone.textContent = String(stone);
    ui.winDeaths.textContent = String(game.stats.deaths);
    ui.winTime.textContent = formatTime(time);
    ui.titleBest.textContent = String(game.best);
    sound.win();
  },
});

/* -------------------------------------------------------------------- HUD */

let prevHp = 5;

function buildMasks() {
  ui.masks.innerHTML = '';
  for (let i = 0; i < game.player.maxHp; i++) {
    const el = document.createElement('span');
    el.className = 'mask';
    ui.masks.appendChild(el);
  }
  prevHp = game.player.hp;
}

function pulseMask() {
  const idx = Math.max(0, Math.floor(game.player.hp));
  const el = ui.masks.children[idx];
  if (el) {
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }
}

function updateHud() {
  const p = game.player;
  if (!p) return;
  const masks = ui.masks.children;
  for (let i = 0; i < masks.length; i++) masks[i].classList.toggle('empty', i >= p.hp);
  if (p.hp !== prevHp) {
    if (p.hp < prevHp) pulseMask();
    prevHp = p.hp;
  }
  ui.soulFill.style.height = `${Math.round((game.soul / 99) * 100)}%`;
  ui.geoCount.textContent = String(game.stone);
  const showPrompt = !!game.prompt && game.mode === 'play';
  ui.prompt.textContent = game.prompt;
  ui.prompt.classList.toggle('is-on', showPrompt);
  if (input.stick.active) {
    ui.touchStick.style.transform = `translate(${input.stick.dx * 22}px, ${input.stick.dy * 22}px)`;
    const knob = ui.touchStick.firstElementChild;
    if (knob) knob.style.transform = `translate(${input.stick.dx * 16}px, ${input.stick.dy * 16}px)`;
  }
}

function showArea() {
  const x = game.player.body.cx;
  const area = AREAS.find((a) => x >= a.from && x < a.to);
  if (!area || seenAreas.has(area.id)) return;
  seenAreas.add(area.id);
  ui.bannerTitle.textContent = area.title;
  ui.bannerSub.textContent = area.sub;
  ui.banner.classList.add('is-on');
  clearTimeout(showArea.timer);
  showArea.timer = setTimeout(() => ui.banner.classList.remove('is-on'), 3200);
}

let lastAreaCheck = 0;
function checkArea(dt) {
  lastAreaCheck += dt;
  if (lastAreaCheck < 0.4) return;
  lastAreaCheck = 0;
  showArea();
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- screens */

function hideScreens() {
  for (const s of [ui.titleScreen, ui.pauseScreen, ui.benchScreen, ui.deadScreen, ui.winScreen]) {
    s.classList.remove('is-open');
  }
}

let pausedFrom = 'play';

function handleMode(mode) {
  if (mode === 'bench') {
    hideScreens();
    ui.benchScreen.classList.add('is-open');
  } else if (mode === 'won') {
    hideScreens();
    ui.winScreen.classList.add('is-open');
    ui.hud.classList.remove('is-live');
    document.body.classList.remove('is-playing');
  } else if (mode === 'dead') {
    hideScreens();
    ui.deadStone.textContent = String(game.stone);
    ui.deadDeaths.textContent = String(game.stats.deaths);
    ui.deadScreen.classList.add('is-open');
    ui.hud.classList.remove('is-live');
    document.body.classList.remove('is-playing');
  }
}

function togglePause(force) {
  const isPaused = game.mode === 'paused';
  const shouldPause = force !== undefined ? force : !isPaused;
  if (shouldPause && (game.mode === 'play' || game.mode === 'bench')) {
    pausedFrom = game.mode;
    game.mode = 'paused';
    hideScreens();
    ui.pauseScreen.classList.add('is-open');
    document.body.classList.remove('is-playing');
    sound.click();
  } else if (!shouldPause && isPaused) {
    game.mode = pausedFrom;
    ui.pauseScreen.classList.remove('is-open');
    if (game.mode === 'bench') {
      ui.benchScreen.classList.add('is-open');
    } else {
      document.body.classList.add('is-playing');
    }
    sound.click();
  }
}

function startRun(fresh) {
  sound.ready();
  hideScreens();
  ui.winStone.textContent = '0';
  game.reset(fresh);
  game.start();
  buildMasks();
  prevHp = game.player.hp;
  updateHud();
  revealTouch();
}

function respawn() {
  hideScreens();
  ui.hud.classList.add('is-live');
  document.body.classList.add('is-playing');
  game.respawn();
  prevHp = game.player.hp;
}

function closeBench() {
  if (game.mode !== 'bench') return;
  hideScreens();
  ui.hud.classList.add('is-live');
  document.body.classList.add('is-playing');
  game.mode = 'play';
  sound.click();
}

function revealTouch() {
  if (window.matchMedia('(pointer: coarse)').matches) ui.touch.classList.add('is-on');
}

$('startBtn').addEventListener('click', () => startRun(true));
$('againBtn').addEventListener('click', () => startRun(true));
$('respawnBtn').addEventListener('click', respawn);
$('benchBtn').addEventListener('click', closeBench);
$('resumeBtn').addEventListener('click', () => togglePause(false));
$('restartBtn').addEventListener('click', () => startRun(true));
$('pauseBtn').addEventListener('click', () => togglePause());
$('muteBtn').addEventListener('click', () => {
  const muted = sound.toggle();
  sound.click();
  syncMute(muted);
});

function syncMute(muted) {
  ui.muteBtn.classList.toggle('is-muted', muted);
  ui.muteBtn.title = muted ? 'Ljud på (M)' : 'Ljud av (M)';
}
syncMute(sound.muted);

/* ------------------------------------------------------------ touch input */

for (const btn of document.querySelectorAll('.touch-btn')) {
  const action = btn.dataset.action;
  const press = (e) => {
    e.preventDefault();
    input.virtualDown(action);
  };
  const release = (e) => {
    e.preventDefault();
    input.virtualUp(action);
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
}

/* ---------------------------------------------------------------- keyboard */

window.addEventListener('keydown', (e) => {
  const key = e.code;

  if (key === 'KeyM') {
    syncMute(sound.toggle());
    return;
  }

  if (ui.deadScreen.classList.contains('is-open')) {
    if (key === 'KeyJ' || key === 'Space' || key === 'Enter') {
      e.preventDefault();
      respawn();
    }
    return;
  }

  if (ui.winScreen.classList.contains('is-open')) {
    if (key === 'Space' || key === 'Enter' || key === 'KeyJ') {
      e.preventDefault();
      startRun(true);
    }
    return;
  }

  if (ui.benchScreen.classList.contains('is-open')) {
    if (key === 'KeyE' || key === 'Space' || key === 'Enter') {
      e.preventDefault();
      closeBench();
    }
    return;
  }

  if (ui.titleScreen.classList.contains('is-open')) {
    if (key === 'Enter' || key === 'Space') {
      e.preventDefault();
      startRun(true);
    }
    return;
  }

  if (key === 'Escape') {
    e.preventDefault();
    if (game.mode === 'play' || game.mode === 'bench' || game.mode === 'paused') togglePause();
    return;
  }

  if (key === 'KeyR' && game.mode !== 'play') {
    startRun(true);
  }
});

/* -------------------------------------------------------------------- loop */

let last = performance.now();
let elapsed = 0;

function frame(ts) {
  const dt = Math.min(0.033, Math.max(0, (ts - last) / 1000));
  last = ts;

  if (game.mode !== 'paused') {
    game.update(dt);
    elapsed += dt;
    checkArea(dt);
  }
  game.draw();
  updateHud();
  input.endFrame();
  requestAnimationFrame(frame);
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => game.resize(), 120);
});

ui.titleBest.textContent = String(game.best);
ui.titleScreen.classList.add('is-open');
requestAnimationFrame(frame);

// Handy for poking at the game from the console.
window.__spell = { game, sound };
