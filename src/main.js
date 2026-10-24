import { Game } from './game.js';
import { Input } from './input.js';
import { Sound } from './audio.js';

const canvas = document.getElementById('game');
const input = new Input(canvas);
const sound = new Sound();
const $ = (id) => document.getElementById(id);

const ui = {
  hud: $('hud'),
  hearts: $('hearts'),
  shards: $('shards'),
  charge: $('charge'),
  chargeFill: $('chargeFill'),
  chargeLabel: $('chargeLabel'),
  roomTitle: $('roomTitle'),
  roomName: $('roomName'),
  roomSub: $('roomSub'),
  whisper: $('whisper'),
  whisperText: $('whisperText'),
  prompt: $('prompt'),
  toast: $('toast'),
  pauseBtn: $('pauseBtn'),
  muteBtn: $('muteBtn'),
  titleScreen: $('screen-title'),
  memoryScreen: $('screen-memory'),
  restScreen: $('screen-rest'),
  pauseScreen: $('screen-pause'),
  deadScreen: $('screen-dead'),
  endScreen: $('screen-end'),
  titleBest: $('titleBest'),
  memoryCount: $('memoryCount'),
  memoryTitle: $('memoryTitle'),
  memoryText: $('memoryText'),
  pauseAdapt: $('pauseAdapt'),
  deadText: $('deadText'),
  memoryList: $('memoryList'),
  endText: $('endText'),
  touch: $('touch'),
  touchStick: $('touchStick'),
};

const game = new Game(canvas, input, {
  onStart: () => {
    hideScreens();
    document.body.classList.add('is-playing');
    ui.hud.classList.add('is-live');
    sound.ready();
    sound.click();
  },
  onRoom: (id, def) => {
    showRoomTitle(def.title, def.sub);
    if (id === 'hub' && game.shards.length) {
      toast(`${game.shards.length} av 3 minnen burna`);
    }
  },
  onWhisper: (text) => showWhisper(text),
  onChargeStart: () => {
    sound.chargeStart();
    ui.charge.classList.add('is-on');
  },
  onCast: (tier) => {
    sound.cast(tier);
    ui.charge.classList.remove('is-on');
  },
  onJump: () => sound.jump(),
  onJump2: () => sound.jump2(),
  onLamp: () => sound.lamp(),
  onBurn: () => sound.burn(),
  onGate: () => {
    sound.gate();
    toast('Porten öppnar sig');
  },
  onMirror: () => sound.mirror(),
  onEcho: (kind) => sound.echo(kind),
  onShard: (memory, count) => openMemory(memory, count),
  onHurt: () => {
    sound.hurt();
    pulseHeart();
  },
  onDeath: () => {
    sound.die();
    game.mode = 'dead';
    openScreen(ui.deadScreen);
    ui.hud.classList.remove('is-live');
    document.body.classList.remove('is-playing');
    const level = game.adapt < 0.34 ? 'lugnare' : game.adapt > 0.7 ? 'vaksammare' : 'som förut';
    ui.deadText.textContent = `Du vaknar vid lyktan i Lykthuset. Skogen andas ${level}.`;
  },
  onRest: () => {
    sound.rest();
    openScreen(ui.restScreen);
    ui.hud.classList.remove('is-live');
    document.body.classList.remove('is-playing');
  },
  onMidgeDeath: () => sound.midge(),
  onAltarLocked: (n) => toast(`Altaret saknar ${n} minne${n === 1 ? '' : n > 1 ? 'n' : ''}`),
  onEnd: ({ shards, deaths, time }) => {
    sound.win();
    ui.memoryList.innerHTML = '';
    for (const m of game.shards) {
      const article = document.createElement('article');
      article.innerHTML = `<h3>${m.title}</h3><p>${m.text}</p>`;
      ui.memoryList.appendChild(article);
    }
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    ui.endText.textContent = `${shards} minnen burna · ${deaths} fall · ${mins}:${String(secs).padStart(2, '0')} i skymningen`;
    ui.hud.classList.remove('is-live');
    document.body.classList.remove('is-playing');
    openScreen(ui.endScreen);
    setTitleBest();
  },
  onTransition: () => {
    sound.click();
  },
});

/* -------------------------------------------------------------------- HUD */

let prevHp = 3;
let whisperTimer = 0;
let titleTimer = 0;

function buildHud() {
  ui.hearts.innerHTML = '';
  for (let i = 0; i < game.player.maxHp; i++) {
    const el = document.createElement('span');
    el.className = 'heart';
    ui.hearts.appendChild(el);
  }
  prevHp = game.player.hp;
}

function pulseHeart() {
  const idx = Math.max(0, Math.floor(game.player.hp));
  const el = ui.hearts.children[idx];
  if (!el) return;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

function updateHud() {
  const p = game.player;
  const hearts = ui.hearts.children;
  for (let i = 0; i < hearts.length; i++) hearts[i].classList.toggle('empty', i >= p.hp);
  if (p.hp !== prevHp) {
    if (p.hp < prevHp) pulseHeart();
    prevHp = p.hp;
  }

  const pips = ui.shards.children;
  for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < game.shards.length);

  const charging = p.charging;
  ui.charge.classList.toggle('is-on', charging);
  if (charging) {
    const t = Math.min(1, p.chargeT / 1.5);
    ui.chargeFill.style.width = `${t * 100}%`;
    const label = p.chargeT < 0.3 ? 'knuff' : p.chargeT < 0.9 ? 'stråle' : 'bomb';
    ui.chargeLabel.textContent = `${label} · ${(p.chargeT).toFixed(1)}s`;
  }

  const prompt = game.prompt();
  ui.prompt.textContent = prompt;
  ui.prompt.classList.toggle('is-on', !!prompt && game.mode === 'play');

  if (input.stick.active) {
    ui.touchStick.style.transform = `translate(${input.stick.dx * 20}px, ${input.stick.dy * 20}px)`;
    const knob = ui.touchStick.firstElementChild;
    if (knob) knob.style.transform = `translate(${input.stick.dx * 15}px, ${input.stick.dy * 15}px)`;
  }
}

function showWhisper(text) {
  ui.whisperText.textContent = text;
  ui.whisper.classList.add('is-on');
  whisperTimer = 7;
}

function showRoomTitle(name, sub) {
  ui.roomName.textContent = name;
  ui.roomSub.textContent = sub;
  ui.roomTitle.classList.add('is-on');
  titleTimer = 3.4;
}

let toastTimer = 0;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-on'), 2300);
}

function setTitleBest() {
  ui.titleBest.textContent = String(Math.max(game.best, game.shards.length));
}

function adaptLabel() {
  if (game.adapt < 0.34) return 'lugn — fällorna väntar på dig';
  if (game.adapt > 0.7) return 'vaksam — skogen prövar dig';
  return 'normal — skogen lyssnar';
}

/* ----------------------------------------------------------------- screens */

function openScreen(el) {
  for (const s of [ui.titleScreen, ui.memoryScreen, ui.restScreen, ui.pauseScreen, ui.deadScreen, ui.endScreen]) {
    s.classList.toggle('is-open', s === el);
  }
}

function hideScreens() {
  for (const s of [ui.titleScreen, ui.memoryScreen, ui.restScreen, ui.pauseScreen, ui.deadScreen, ui.endScreen]) {
    s.classList.remove('is-open');
  }
}

let pendingMemory = null;

function openMemory(memory, count) {
  pendingMemory = memory;
  game.mode = 'memory';
  sound.shard();
  ui.memoryCount.textContent = ['Första minnet', 'Andra minnet', 'Tredje minnet'][count - 1] || 'Ett minne';
  ui.memoryTitle.textContent = memory.title;
  ui.memoryText.textContent = memory.text;
  openScreen(ui.memoryScreen);
  ui.hud.classList.remove('is-live');
  setTitleBest();
}

function closeMemory() {
  if (!pendingMemory) return;
  pendingMemory = null;
  game.resume();
  hideScreens();
  ui.hud.classList.add('is-live');
  document.body.classList.add('is-playing');
  if (game.shards.length >= 3) {
    setTimeout(() => toast('Altaret i Lykthuset väntar'), 500);
  }
}

function closeRest() {
  game.resume();
  hideScreens();
  ui.hud.classList.add('is-live');
  document.body.classList.add('is-playing');
}

let pausedFrom = 'play';

function togglePause(force) {
  const paused = game.mode === 'paused';
  const should = force !== undefined ? force : !paused;
  if (should && (game.mode === 'play' || game.mode === 'rest')) {
    pausedFrom = game.mode;
    game.mode = 'paused';
    ui.pauseAdapt.textContent = `Skogen lyssnar: ${adaptLabel()}`;
    openScreen(ui.pauseScreen);
    document.body.classList.remove('is-playing');
    sound.click();
  } else if (!should && paused) {
    game.mode = pausedFrom;
    hideScreens();
    if (pausedFrom === 'rest') {
      openScreen(ui.restScreen);
      ui.hud.classList.remove('is-live');
    } else {
      ui.hud.classList.add('is-live');
      document.body.classList.add('is-playing');
    }
    sound.click();
  }
}

function startRun() {
  sound.ready();
  hideScreens();
  buildHud();
  game.start();
  document.body.classList.add('is-playing');
  ui.hud.classList.add('is-live');
  prevHp = game.player.hp;
  updateHud();
  if (window.matchMedia('(pointer: coarse)').matches) ui.touch.classList.add('is-on');
}

function respawn() {
  hideScreens();
  game.respawn();
  buildHud();
  prevHp = game.player.hp;
  ui.hud.classList.add('is-live');
  document.body.classList.add('is-playing');
  sound.click();
}

/* ------------------------------------------------------------------ events */

$('startBtn').addEventListener('click', startRun);
$('againBtn').addEventListener('click', startRun);
$('restartBtn').addEventListener('click', startRun);
$('memoryBtn').addEventListener('click', closeMemory);
$('restBtn').addEventListener('click', closeRest);
$('respawnBtn').addEventListener('click', respawn);
$('resumeBtn').addEventListener('click', () => togglePause(false));
$('pauseBtn').addEventListener('click', () => togglePause());

function syncMute() {
  ui.muteBtn.classList.toggle('is-muted', sound.muted);
  ui.muteBtn.title = sound.muted ? 'Ljud på (M)' : 'Ljud av (M)';
}
$('muteBtn').addEventListener('click', () => {
  sound.toggle();
  sound.click();
  syncMute();
});
syncMute();

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

window.addEventListener('keydown', (e) => {
  const key = e.code;

  if (key === 'KeyM') {
    sound.toggle();
    syncMute();
    return;
  }

  if (ui.endScreen.classList.contains('is-open')) {
    if (key === 'Enter' || key === 'Space' || key === 'KeyE') startRun();
    return;
  }
  if (ui.deadScreen.classList.contains('is-open')) {
    if (key === 'Enter' || key === 'Space' || key === 'KeyE') respawn();
    return;
  }
  if (ui.memoryScreen.classList.contains('is-open')) {
    if (key === 'Enter' || key === 'Space' || key === 'KeyE') {
      e.preventDefault();
      closeMemory();
    }
    return;
  }
  if (ui.restScreen.classList.contains('is-open')) {
    if (key === 'Enter' || key === 'Space' || key === 'KeyE') {
      e.preventDefault();
      closeRest();
    }
    return;
  }
  if (ui.titleScreen.classList.contains('is-open')) {
    if (key === 'Enter' || key === 'Space') {
      e.preventDefault();
      startRun();
    }
    return;
  }
  if (key === 'Escape') {
    e.preventDefault();
    if (game.mode === 'play' || game.mode === 'rest' || game.mode === 'paused') togglePause();
  }
});

// Auto-pause when the tab loses focus.
window.addEventListener('blur', () => {
  if (game.mode === 'play') togglePause(true);
});

/* -------------------------------------------------------------------- loop */

let last = performance.now();

function frame(ts) {
  const dt = Math.min(0.033, Math.max(0, (ts - last) / 1000));
  last = ts;

  if (game.mode === 'play' && input.hit('interact')) game.interact();

  if (game.mode !== 'paused' && game.mode !== 'memory' && game.mode !== 'rest') {
    game.update(dt);
  } else {
    game.update(0);
  }

  if (game.player.charging) sound.chargeUpdate(Math.min(1, game.player.chargeT / 1.5));

  game.draw();
  updateHud();

  if (whisperTimer > 0) {
    whisperTimer -= dt;
    if (whisperTimer <= 0) ui.whisper.classList.remove('is-on');
  }
  if (titleTimer > 0) {
    titleTimer -= dt;
    if (titleTimer <= 0) ui.roomTitle.classList.remove('is-on');
  }

  input.endFrame();
  requestAnimationFrame(frame);
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => game.resize(), 120);
});

setTitleBest();
openScreen(ui.titleScreen);
requestAnimationFrame(frame);

window.__lykt = { game, sound };
