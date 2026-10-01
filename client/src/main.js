/**
 * Spell - browser client entry point.
 *
 * Responsibilities:
 *   - boot: settings, i18n, renderer, terrain, WebSocket
 *   - the frame loop: sample input -> predict -> send -> render -> reconcile
 *   - interaction: harvesting, melee, crafting, building, eating, doors
 *
 * Nothing here decides game truth: every action goes through net.action() and
 * the server answers with `res` / `ev` messages.
 */

import * as THREE from 'three';
import {
  WORLD, NET, PHYS, SURVIVAL, COMBAT, ITEMS, PIECES, RECIPES, BUILD, NODES,
  clamp, buildingAABB, piecePosition, countItem,
} from '../../shared/config.js';
import { sampleHeight } from '../../shared/noise.js';
import { Net } from './net.js';
import { Hud } from './hud.js';
import { WorldView } from './terrain.js';
import { NodeView, BuildingView, AnimalView, PlayerView, ViewModel, BuildGhost } from './entities.js';
import { settings, loadSettings, saveSettings, playerId } from './settings.js';
import { setLang, t, itemName, pieceName, getLang } from './i18n.js';
import { initAudio, resumeAudio, setAudioEnabled, setAmbient, playSound } from './audio.js';

loadSettings();
setLang(settings.lang);

/* ------------------------------------------------------------------ *
 *  Renderer / scene
 * ------------------------------------------------------------------ */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !settings.simpleGraphics, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.simpleGraphics ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = settings.shadows && !settings.simpleGraphics;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fc6e0, 60, settings.renderDistance);
const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.08, 900);

const hud = new Hud();
const viewModel = new ViewModel();
const ghost = new BuildGhost(scene);

let worldView = null;
let nodeView = null;
let buildingView = null;
let animalView = null;
let playerView = null;

/* ------------------------------------------------------------------ *
 *  Client state
 * ------------------------------------------------------------------ */
const state = {
  net: null,
  running: false,
  buildMode: false,
  rotation: 0,
  target: null,
  keys: Object.create(null),
  mouse: { locked: false, drag: false, lastX: 0, lastY: 0, lookMode: 'pointer' },
  inputAccum: 0,
  lastFrame: performance.now(),
  fps: 0,
  frames: 0,
  fpsTimer: 0,
  swingCooldown: 0,
  hitTimer: 0,
  playtime: 0,
  lastPos: new THREE.Vector3(),
  stepDistance: 0,
  wasInWater: false,
  deathCause: 'unknown',
  hoverBuilding: null,
  selection: -1,
};

/* ------------------------------------------------------------------ *
 *  Boot
 * ------------------------------------------------------------------ */
async function boot() {
  hud.setLoading(0.05, t('loading'));
  hud.el.nameInput.value = settings.playerName || '';
  hud.el.seedInfo.textContent = '';
  hud.renderHelp(getLang());
  bindUi();

  await frame();
  worldView = new WorldView(scene, Number(new URLSearchParams(location.search).get('seed')) || WORLD.seed);
  // Menu backdrop: an overview of the island. (The default camera position is
  // the world origin, which is inside the ground.)
  camera.position.set(0, WORLD.maxHeight + 26, -WORLD.half * 0.62);
  camera.lookAt(0, 0, 0);
  hud.setLoading(0.6, t('loading'));
  await frame();

  nodeView = new NodeView(scene);
  buildingView = new BuildingView(scene);
  animalView = new AnimalView(scene);
  playerView = new PlayerView(scene, playerId());
  hud.setLoading(0.9, t('loading'));
  await frame();

  try {
    const res = await fetch('/api/status');
    const json = await res.json();
    hud.el.serverInfo.textContent = `tick ${json.tickRate} Hz · ${json.world.online} spelare online · seed ${json.world.seed}`;
    hud.el.seedInfo.textContent = `server uppe ${Math.round(json.uptimeSec / 60)} min · ${json.memoryMb} MB`;
  } catch {
    hud.el.serverInfo.textContent = t('offline');
  }

  hud.setLoading(1, '');
  hud.showMenu(true);
  requestAnimationFrame(loop);
}

const frame = () => new Promise((r) => requestAnimationFrame(r));

/* ------------------------------------------------------------------ *
 *  Connect / disconnect
 * ------------------------------------------------------------------ */
let reconnectTimer = null;
let reconnectAttempt = 0;

/** A tab-scoped identity, used when the persistent player is already online. */
function guestId() {
  let id = sessionStorage.getItem('spell.guestId');
  if (!id) {
    id = `g${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    sessionStorage.setItem('spell.guestId', id);
  }
  return id;
}

function clearReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempt = 0;
}

/** Is the HTTP side of the server alive? Tells "offline" apart from "WS blocked". */
async function serverReachable() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

function scheduleReconnect(asGuest = false) {
  reconnectAttempt++;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => play({ asGuest, silent: true }), Math.min(15000, 1000 * reconnectAttempt));
  return reconnectAttempt;
}

async function play({ asGuest = false, silent = false } = {}) {
  const name = (hud.el.nameInput.value || '').trim() || settings.playerName || 'Överlevare';
  settings.playerName = name;
  saveSettings();
  if (!silent) {
    hud.showMenu(false);
    hud.showDisconnect(false, '', '');
  }
  initAudio();
  resumeAudio();

  const net = new Net({
    playerId: asGuest ? guestId() : playerId(),
    name,
    handlers: {
      onWelcome: (msg) => {
        clearReconnect();
        hud.showHud(true);
        hud.showDisconnect(false, '', '');
        // locally predicted player starts at the replicated spawn
        camera.position.set(msg.you.x, msg.you.y + PHYS.eyeHeight, msg.you.z);
        state.lastPos.set(msg.you.x, msg.you.y, msg.you.z);
        if (!silent) hud.toast(`${t('joined')}: ${name}`, 'ok');
      },
      onSnapshot: () => { state.net.reconnectAttempts = 0; },
      onNode: (n) => nodeView.upsert(n),
      onNodeRemove: (id) => nodeView.remove(id),
      onBuilding: (b) => buildingView.upsert(b),
      onBuildingRemove: (id) => buildingView.remove(id),
      onAnimal: (a) => animalView.upsert(a),
      onEvent: handleEvent,
      onChat: (msg) => hud.addChat(msg.from, msg.text),
      onResult: handleResult,
      onClose: (code, reason) => {
        if (!state.running) return;
        state.running = false;
        document.exitPointerLock?.();
        // The server restarted or the link dropped: retry by itself.
        const attempt = scheduleReconnect(asGuest);
        hud.showDisconnect(true, t('reconnecting', { n: attempt }), `kod ${code}${reason ? ` — ${reason}` : ''}`);
      },
    },
  });
  state.net = net;

  if (hud.el.hud.classList.contains('hidden') && !silent) hud.showHud(true);
  try {
    await net.connect();
    state.running = true;
    if (asGuest) hud.toast(t('guestToast'), 'ok');
  } catch (err) {
    const code = err.code || 1006;
    // Same player already in another tab -> offer (and auto-try) a guest identity.
    if (code === 4001 && !asGuest) {
      scheduleReconnect(true);
      hud.showDisconnect(true, t('alreadyConnected'), `${err.url} · kod ${code}`);
      return;
    }
    const reachable = await serverReachable();
    const attempt = scheduleReconnect(asGuest);
    hud.showDisconnect(
      true,
      reachable ? t('wsBlocked') : t('serverOffline'),
      `${err.url} · kod ${code}${err.reason ? ` · ${err.reason}` : ''} · försök ${attempt}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 *  Event / result handling (server -> client feedback)
 * ------------------------------------------------------------------ */
function handleEvent(ev) {
  switch (ev.e) {
    case 'swing': {
      viewModel.swing();
      if (ev.kind === 'harvest' && ev.ok !== false) {
        playSound(ev.sound || 'chop', 0.9);
        if (ev.depleted) {
          const node = state.net.nodes.get(ev.nodeId);
          if (node) nodeView.setDead(ev.nodeId, Date.now() + 60000);
          hud.toast(`${NODES[ev.nodeType] ? (getLang() === 'sv' ? NODES[ev.nodeType].name : NODES[ev.nodeType].nameEn) : ''} ${getLang() === 'sv' ? 'förstörd' : 'destroyed'}`, 'ok');
        }
        if (ev.gained) showGain(ev.gained, ev.nodeId);
        hud.hitMarker(true);
      } else if (ev.kind === 'melee') {
        if (ev.hit) { playSound('hit'); hud.hitMarker(true); } else playSound('swing', 0.7);
        if (ev.killed) hud.toast(`${t('killedAnimal')}: +1 (${ev.animalType})`, 'ok');
        if (ev.killedPlayer) hud.toast(`${t('killed')}: ${ev.victim}`, 'ok');
      }
      break;
    }
    case 'hurt': {
      playSound('hurt');
      hud.setVignette(1);
      setTimeout(() => hud.setVignette(0), 260);
      state.deathCause = ev.from === 'fall' ? 'fall' : ev.from === 'starve' ? 'starve'
        : ev.from === 'thirst' ? 'thirst' : ev.from === 'drown' ? 'drown'
          : ev.from === 'cold' ? 'cold' : 'animal';
      break;
    }
    case 'died': {
      playSound('death');
      state.deathCause = ev.cause || 'unknown';
      hud.showDeath(true, state.deathCause);
      document.exitPointerLock?.();
      break;
    }
    case 'respawned': hud.showDeath(false); break;
    case 'unstuck': hud.toast(getLang() === 'sv' ? 'Flyttad till säker mark' : 'Moved to safe ground', 'ok'); break;
    case 'placed': playSound('build'); break;
    case 'door': playSound('door'); break;
    case 'buildingGone': hud.toast(`${t('left')} ${ev.cause === 'decay' ? '(decay)' : ''}`); break;
    case 'join': hud.addChat('', `${ev.name} ${t('joined')}`); break;
    case 'leave': hud.addChat('', `${ev.name} ${t('left')}`); break;
    case 'chatSlow': hud.toast(t('chatSlow'), 'bad'); break;
    case 'chat': hud.addChat(ev.from, ev.text); break;
    default: break;
  }
}

function handleResult(msg) {
  if (msg.ok) {
    if (msg.t === 'res' && msg.a === 'craft') {
      playSound('craft');
      const out = Object.entries(msg.out || {}).map(([k, n]) => `+${n} ${itemName(ITEMS[k])}`).join(', ');
      hud.toast(`${t('crafted')}: ${out}`, 'ok');
    }
    if (msg.a === 'use' && msg.consumed) playSound('eat');
    if (msg.a === 'repair') { playSound('craft'); hud.toast(t('repaired'), 'ok'); }
    return;
  }
  const map = {
    'missing-materials': t('missing'), 'inventory-full': t('full'), 'too-far': t('tooFar'),
    'needs-station': t('needStation'), 'needs-foundation': t('needFoundation'), 'uneven-ground': t('uneven'),
    occupied: t('occupied'), 'in-water': t('inWater'), 'outside-world': t('outsideWorld'),
    floating: t('floating'), 'already-full': t('alreadyFull'), 'not-repairable': t('notRepairable'),
    empty: t('empty'), alive: t('alive'), 'not-openable': t('notOpenable'), gone: t('gone'),
    'unknown-recipe': t('unknownRecipe'), 'not-found': t('gone'), 'missing-piece': t('missing'),
    'bad-cell': t('occupied'),
  };
  if (msg.error && msg.error !== 'timeout') hud.toast(map[msg.error] || msg.error, 'bad');
}

function showGain(gained, nodeId) {
  const node = state.net.nodes.get(nodeId);
  if (!node) return;
  const pos = new THREE.Vector3(node.x, node.y + 1.6, node.z);
  const screen = projectToScreen(pos);
  if (!screen) return;
  const parts = [`+${gained.n} ${itemName(ITEMS[gained.item])}`];
  if (gained.bonus) parts.push(`+1 ${itemName(ITEMS[gained.bonus])}`);
  hud.floatText(parts.join(' '), screen.x, screen.y);
}

function projectToScreen(vec3) {
  const v = vec3.clone().project(camera);
  if (v.z > 1) return null;
  return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
}

/* ------------------------------------------------------------------ *
 *  Input
 * ------------------------------------------------------------------ */
function bindUi() {
  hud.el.playBtn.addEventListener('click', () => play());
  hud.el.howBtn.addEventListener('click', () => hud.showHelp(true));
  hud.el.respawnBtn.addEventListener('click', async () => {
    await state.net?.action('respawn');
    hud.showDeath(false);
    canvas.requestPointerLock?.();
  });
  hud.el.reconnectBtn.addEventListener('click', () => { clearReconnect(); hud.showDisconnect(false, '', ''); play(); });
  hud.el.guestBtn.addEventListener('click', () => { clearReconnect(); hud.showDisconnect(false, '', ''); play({ asGuest: true }); });
  hud.el.chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = hud.el.chatInput.value;
      if (text.trim()) state.net?.chat(text);
      hud.showChatInput(false);
    } else if (e.key === 'Escape') hud.showChatInput(false);
  });

  // inventory interaction
  hud.el.invGrid.addEventListener('mousedown', async (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const slot = Number(cell.dataset.slot);
    if (e.button === 2) {
      e.preventDefault();
      await state.net.action('use', { slot });
      return;
    }
    if (state.selection === -1) {
      state.selection = slot;
      hud.el.invTooltip.textContent = `Slot ${slot + 1}`;
    } else {
      await state.net.action('moveitem', { from: state.selection, to: slot });
      state.selection = -1;
    }
  });
  hud.el.inventoryScreen.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('click', () => {
    if (!state.running) return;
    if (!hud.anyOverlayOpen) canvas.requestPointerLock?.();
  });
  document.addEventListener('pointerlockchange', () => {
    const wasLocked = state.mouse.locked;
    state.mouse.locked = document.pointerLockElement === canvas;
    // Esc releases the pointer lock; treat that as "open the pause menu"
    if (wasLocked && !state.mouse.locked && state.running && !hud.anyOverlayOpen) {
      hud.showSettings(true);
    }
  });
  document.addEventListener('pointerlockerror', () => {
    // preview iframes often block pointer lock: fall back to drag-to-look
    state.mouse.lookMode = 'drag';
    hud.toast(getLang() === 'sv' ? 'Dra med musen för att titta' : 'Drag the mouse to look around');
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.running) return;
    const sens = settings.sensitivity * 0.0022;
    let dx = 0;
    let dy = 0;
    if (state.mouse.locked) { dx = e.movementX; dy = e.movementY; }
    else if (state.mouse.lookMode === 'drag' && !hud.anyOverlayOpen && e.target === canvas) {
      dx = e.clientX - state.mouse.lastX; dy = e.clientY - state.mouse.lastY;
    } else { state.mouse.lastX = e.clientX; state.mouse.lastY = e.clientY; return; }
    state.mouse.lastX = e.clientX;
    state.mouse.lastY = e.clientY;
    const you = state.net?.you;
    if (!you) return;
    you.yaw -= dx * sens;
    you.pitch = clamp(you.pitch - dy * sens * (settings.invertY ? -1 : 1), -1.55, 1.55);
  });

  window.addEventListener('mousedown', (e) => {
    if (!state.running || hud.anyOverlayOpen || e.target !== canvas) return;
    state.mouse.drag = true;
    if (e.button === 0) primaryAction();
    if (e.button === 2) secondaryAction();
  });
  window.addEventListener('mouseup', () => { state.mouse.drag = false; });
  document.addEventListener('contextmenu', (e) => { if (state.running) e.preventDefault(); });
  document.addEventListener('wheel', (e) => {
    if (!state.running || hud.anyOverlayOpen) return;
    const you = state.net.you;
    if (state.buildMode) {
      state.rotation = (state.rotation + (e.deltaY > 0 ? 1 : 3)) % 4;
    } else {
      const next = (you.toolSlot + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
      state.net.action('equip', { slot: next });
    }
  }, { passive: true });

  bindSettings();
  hud.el.inventoryScreen.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => hud.setTab(btn.dataset.tab));
  });

  document.addEventListener('keydown', (e) => onKey(e, true));
  document.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('resize', onResize);
  window.addEventListener('blur', () => { state.keys = Object.create(null); });
}

function bindSettings() {
  const el = hud.el;
  const range = (input, key, valEl, fmt = (v) => v) => {
    input.value = String(settings[key]);
    valEl.textContent = fmt(settings[key]);
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      valEl.textContent = fmt(settings[key]);
      saveSettings();
      applyGraphicsSettings();
    });
  };
  range(el.settings.querySelector('#setRender'), 'renderDistance', el.settings.querySelector('#setRenderVal'), (v) => `${v} m`);
  range(el.settings.querySelector('#setFov'), 'fov', el.settings.querySelector('#setFovVal'));
  range(el.settings.querySelector('#setSens'), 'sensitivity', el.settings.querySelector('#setSensVal'), (v) => v.toFixed(1));

  const box = (id, key, onChange) => {
    const input = el.settings.querySelector(id);
    input.checked = !!settings[key];
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      saveSettings();
      applyGraphicsSettings();
      onChange?.(input.checked);
    });
  };
  box('#setShadows', 'shadows');
  box('#setInvert', 'invertY');
  box('#setSound', 'sound', (on) => { setAudioEnabled(on); if (on) resumeAudio(); });
  box('#setSimple', 'simpleGraphics');

  const langSel = el.settings.querySelector('#setLang');
  langSel.value = settings.lang;
  langSel.addEventListener('change', () => {
    settings.lang = langSel.value;
    saveSettings();
    setLang(settings.lang);
    hud.renderHelp(settings.lang);
  });
  applyGraphicsSettings();
  hud.setDisclaimer(getLang() === 'sv'
    ? 'Prototyp — ingen autentisering, ingen anti-cheat utöver serverauktoritet. Se docs/ för nästa steg.'
    : 'Prototype — no authentication, no anti-cheat beyond server authority. See docs/ for next steps.');
}

function applyGraphicsSettings() {
  renderer.shadowMap.enabled = settings.shadows && !settings.simpleGraphics;
  scene.fog.near = settings.renderDistance * 0.45;
  scene.fog.far = settings.renderDistance;
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.simpleGraphics ? 1 : 2));
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  viewModel.setAspect(camera.aspect);
}

function onKey(e, down) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.code;
  state.keys[k] = down;
  if (!down) return;

  if (k === 'Space') e.preventDefault();
  if (k === 'F1') { e.preventDefault(); hud.showHelp(hud.el.help.classList.contains('hidden')); return; }
  if (k === 'F3') { e.preventDefault(); hud.toggleDebug(); return; }
  if (!state.running) return;

  switch (k) {
    case 'Tab':
      e.preventDefault();
      if (hud.el.inventoryScreen.classList.contains('hidden')) {
        hud.showInventory(true);
        hud.setTab('inv');
        document.exitPointerLock?.();
      } else hud.showInventory(false);
      break;
    case 'KeyB':
      state.buildMode = !state.buildMode;
      ghost.hide();
      hud.showBuild(state.buildMode);
      if (state.buildMode) document.exitPointerLock?.();
      hud.setBuildHint(state.buildMode ? `${t('hintPlace')} · ${t('hintRotate')} · ${t('hintCancel')}` : '');
      break;
    case 'KeyC':
      hud.showInventory(true);
      hud.setTab('craft');
      document.exitPointerLock?.();
      break;
    case 'KeyM':
      hud.showMap(hud.el.mapScreen.classList.contains('hidden'));
      if (!hud.el.mapScreen.classList.contains('hidden')) document.exitPointerLock?.();
      break;
    case 'KeyT':
      if (hud.el.chatInputWrap.classList.contains('hidden')) { hud.showChatInput(true); }
      break;
    case 'KeyR':
      if (state.buildMode) state.rotation = (state.rotation + 1) % 4;
      else if (!hud.el.inventoryScreen.classList.contains('hidden') && state.selection >= 0) {
        state.net.action('repair', { slot: state.selection });
      }
      break;
    case 'KeyE': {
      const hit = pickBuilding(3.5);
      if (hit && PIECES[hit.building.piece]?.openable) state.net.action('door', { id: hit.building.id });
      else {
        const food = state.net.you.inv.findIndex((s) => s && ITEMS[s.item]?.kind === 'food');
        if (food >= 0) state.net.action('use', { slot: food });
      }
      break;
    }
    case 'Escape':
      if (!hud.el.settings.classList.contains('hidden')) { hud.showSettings(false); saveSettings(); }
      else if (!hud.el.help.classList.contains('hidden')) hud.showHelp(false);
      else if (!hud.el.inventoryScreen.classList.contains('hidden')) hud.showInventory(false);
      else if (!hud.el.buildMenu.classList.contains('hidden')) { hud.showBuild(false); state.buildMode = false; ghost.hide(); }
      else if (!hud.el.mapScreen.classList.contains('hidden')) hud.showMap(false);
      else { hud.showSettings(true); document.exitPointerLock?.(); }
      break;
    default:
      if (k.startsWith('Digit')) {
        const n = Number(k.slice(5));
        if (n >= 1 && n <= 9) state.net.action('equip', { slot: n - 1 });
      }
      break;
  }
}

/* ------------------------------------------------------------------ *
 *  Actions
 * ------------------------------------------------------------------ */
function primaryAction() {
  const you = state.net.you;
  if (!you || you.dead) return;
  if (Date.now() - state.swingCooldown < COMBAT.cooldown * 1000) return;
  state.swingCooldown = Date.now();

  if (state.buildMode) { placePiece(); return; }
  const target = state.target;
  if (target) state.net.action('harvest', { id: target.id });
  else state.net.action('melee');
  viewModel.swing();
  playSound('swing', 0.5);
}

async function secondaryAction() {
  const you = state.net.you;
  if (!you || you.dead) return;
  if (state.buildMode) {
    const hit = pickBuilding(BUILD.reach);
    if (hit) state.net.action('demolish', { id: hit.building.id });
    return;
  }
  const hit = pickBuilding(3.2);
  if (hit && PIECES[hit.building.piece]?.openable) { state.net.action('door', { id: hit.building.id }); return; }
  if (you.toolSlot >= 0) state.net.action('use', { slot: you.toolSlot });
}

function placePiece() {
  const g = ghost.cell;
  if (!ghost.piece || !ghost.visible) return;
  state.net.action('place', { piece: ghost.piece, cx: g.cx, cz: g.cz, rot: g.rot });
}

/* ------------------------------------------------------------------ *
 *  World picking (crosshair)
 * ------------------------------------------------------------------ */
function viewDir() {
  camera.getWorldDirection(_dir);
  return _dir;
}
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();

function pickNode() {
  const you = state.net.you;
  const dir = viewDir();
  let best = null;
  let bestScore = -1;
  for (const n of state.net.nodes.values()) {
    const def = NODES[n.type];
    const dx = n.x - camera.position.x;
    const dz = n.z - camera.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > COMBAT.reach + def.radius) continue; // same rule the server enforces
    const dy = n.y + (n.type === 'tree' ? 2 : 0.6) - camera.position.y;
    const len = Math.hypot(dx, dy, dz) || 1;
    const dot = (dx / len) * dir.x + (dy / len) * dir.y + (dz / len) * dir.z;
    if (dot < 0.72) continue;
    const score = dot - dist * 0.02;
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return best;
}

/** Ray vs building AABBs; returns {building, distance} for the nearest hit. */
function pickBuilding(maxDist) {
  const origin = camera.position;
  const dir = viewDir();
  let best = null;
  for (const b of state.net.buildings.values()) {
    const box = buildingAABB(b);
    if (!box) continue;
    const t = rayBox(origin, dir, box);
    if (t === null || t > maxDist) continue;
    if (!best || t < best.distance) best = { building: b, distance: t };
  }
  return best;
}

function rayBox(origin, dir, box) {
  let tmin = 0;
  let tmax = 1e9;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    const min = box[`min${axis.toUpperCase()}`];
    const max = box[`max${axis.toUpperCase()}`];
    if (Math.abs(d) < 1e-6) {
      if (o < min || o > max) return null;
    } else {
      let t1 = (min - o) / d;
      let t2 = (max - o) / d;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** Where would the build ghost go? */
function updateGhost() {
  if (!state.buildMode) { ghost.hide(); return; }
  const def = PIECES[state.selectedPiece];
  const dir = viewDir();
  const origin = camera.position;
  const reach = BUILD.reach;
  let hit = null;
  for (let d = 0.5; d <= reach; d += 0.3) {
    _tmp.copy(origin).addScaledVector(dir, d);
    for (const b of state.net.buildings.values()) {
      const box = buildingAABB(b);
      if (!box) continue;
      if (_tmp.x >= box.minX && _tmp.x <= box.maxX && _tmp.y >= box.minY && _tmp.y <= box.maxY && _tmp.z >= box.minZ && _tmp.z <= box.maxZ) {
        hit = { kind: 'building', building: b, point: _tmp.clone() };
        break;
      }
    }
    if (hit) break;
    if (_tmp.y <= sampleHeight(_tmp.x, _tmp.z, worldView.seed)) {
      hit = { kind: 'terrain', point: _tmp.clone() };
      break;
    }
  }
  if (!hit) { ghost.hide(); hud.setBuildHint(''); return; }

  let cx;
  let cz;
  let y;
  let rot = def.rotates ? state.rotation : 0;
  if (hit.kind === 'building' && !def.flat) {
    cx = hit.building.cx;
    cz = hit.building.cz;
    y = hit.building.y + PIECES[hit.building.piece].size[1];
  } else if (hit.kind === 'building' && def.flat) {
    cx = hit.building.cx;
    cz = hit.building.cz;
    y = hit.building.y + PIECES[hit.building.piece].size[1];
  } else {
    cx = Math.round(hit.point.x / WORLD.grid);
    cz = Math.round(hit.point.z / WORLD.grid);
    y = sampleHeight(cx * WORLD.grid, cz * WORLD.grid, worldView.seed);
    if (def.rotates) {
      const base = piecePosition(cx, cz, rot, state.selectedPiece);
      const distToBase = Math.hypot(base.x - hit.point.x, base.z - hit.point.z);
      // pick the closest of the four edges to the aim point
      let bestRot = rot;
      let bestD = distToBase;
      for (let r = 0; r < 4; r++) {
        const p = piecePosition(cx, cz, r, state.selectedPiece);
        const dd = Math.hypot(p.x - hit.point.x, p.z - hit.point.z);
        if (dd < bestD) { bestD = dd; bestRot = r; }
      }
      rot = bestRot;
    }
  }

  // local validity check (server re-validates)
  const you = state.net.you;
  const pos = piecePosition(cx, cz, rot, state.selectedPiece);
  const dist = Math.hypot(pos.x - you.x, pos.z - you.z);
  const hasItem = countItem(you.inv, def.item) > 0;
  const occupied = [...state.net.buildings.values()].some((b) => b.cx === cx && b.cz === cz
    && (def.flat ? PIECES[b.piece].flat : b.rot === rot && !PIECES[b.piece].flat));
  const valid = dist <= BUILD.reach && hasItem && !occupied;
  ghost.show(state.selectedPiece, cx, cz, rot, y, valid);
  const reason = !hasItem ? t('missing') : occupied ? t('occupied') : '';
  hud.setBuildHint(`${pieceName(def)} · ${t('hintPlace')}${reason ? ` · ${reason}` : ''}`);
}

/* ------------------------------------------------------------------ *
 *  Frame loop
 * ------------------------------------------------------------------ */
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - state.lastFrame) / 1000);
  state.lastFrame = now;

  state.frames++;
  state.fpsTimer += dt;
  if (state.fpsTimer >= 0.5) {
    state.fps = Math.round(state.frames / state.fpsTimer);
    state.frames = 0;
    state.fpsTimer = 0;
  }

  if (state.running && state.net?.ready) update(dt, now);
  render(dt, now);
}

function update(dt, now) {
  const net = state.net;
  const you = net.you;
  if (!net.connected || !you) return; // waiting for a reconnect: keep rendering only
  state.playtime += dt;

  // ---- input sampling (sent at NET.inputRate)
  state.inputAccum += dt;
  const step = 1 / NET.inputRate;
  while (state.inputAccum >= step) {
    state.inputAccum -= step;
    const forward = (state.keys.KeyW ? 1 : 0) - (state.keys.KeyS ? 1 : 0);
    const strafe = (state.keys.KeyD ? 1 : 0) - (state.keys.KeyA ? 1 : 0);
    net.sendInput({
      yaw: you.yaw, pitch: you.pitch,
      wish: forward, strafe,
      jump: !!state.keys.Space,
      sprint: !!(state.keys.ShiftLeft || state.keys.ShiftRight),
      crouch: !!(state.keys.ControlLeft || state.keys.ControlRight),
      dt: step,
    });
  }

  // ---- camera follows the predicted player
  const eye = you.crouch ? PHYS.crouchEyeHeight : PHYS.eyeHeight;
  const ground = sampleHeight(you.x, you.z, net.welcome?.seed ?? WORLD.seed);
  const eyeTarget = Math.max(you.y, ground) + eye;
  const smoothY = camera.position.y + (eyeTarget - camera.position.y) * (1 - Math.exp(-22 * dt));
  // hard floor: the camera may never dip below the visible surface
  camera.position.set(you.x, Math.max(smoothY, ground + 0.25), you.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = you.yaw;
  camera.rotation.x = you.pitch;
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();

  // ---- footsteps + splash + ambient
  const moved = Math.hypot(you.x - state.lastPos.x, you.z - state.lastPos.z);
  state.lastPos.set(you.x, you.y, you.z);
  if (you.onGround && moved > 0.01) {
    state.stepDistance += moved;
    const stride = you.sprinting ? 2.5 : 3.1;
    if (state.stepDistance > stride) { state.stepDistance = 0; playSound('step', 0.5); }
  }
  if (you.inWater && !state.wasInWater) playSound('splash');
  state.wasInWater = you.inWater;

  // ---- world views (sky/light follow the player; see render() for the sky pass)
  const time01 = net.time01;
  nodeView.setHighlight(state.target);
  buildingView.update(dt, now / 1000);
  animalView.update(dt);
  playerView.update(dt);

  const interp = net.interp.sample(now);
  for (const p of interp.players.values()) if (p.id !== you.id) playerView.upsert(p);
  for (const a of interp.animals.values()) animalView.upsert(a);

  // ---- targeting
  state.target = state.buildMode ? null : pickNode();
  state.hoverBuilding = state.buildMode ? null : pickBuilding(3.2);

  // ---- build ghost
  updateGhost();

  // ---- view model
  viewModel.setItem(you.toolSlot >= 0 && you.inv[you.toolSlot] ? you.inv[you.toolSlot].item : null);
  viewModel.update(dt, { moving: Math.min(1, moved / (dt * 5)), onGround: you.onGround });

  // ---- HUD
  hud.updateStats(you);
  hud.updateClock(time01, net.day);
  hud.renderHotbar(you.inv, you.toolSlot);

  state.underwater = camera.position.y < WORLD.seaLevel - 0.1;
  hud.setUnderwater(state.underwater ? 1 : 0);
  setAmbient(0.05 + (1 - Math.min(1, you.hunger / 60)) * 0.03);

  const canvasOpen = !hud.el.inventoryScreen.classList.contains('hidden');
  if (canvasOpen) {
    hud.renderInventory(you.inv, you.toolSlot, state.selection);
    const nearStation = [...net.buildings.values()].some((b) => PIECES[b.piece]?.station && Math.hypot(b.cx * WORLD.grid - you.x, b.cz * WORLD.grid - you.z) < 6);
    hud.renderRecipes(you.inv, nearStation, (id) => net.action('craft', { id }));
  }
  if (!hud.el.buildMenu.classList.contains('hidden')) {
    hud.renderPieces(you.inv, state.selectedPiece, (id) => { state.selectedPiece = id; });
  }
  if (!hud.el.mapScreen.classList.contains('hidden')) {
    hud.drawMap(worldView, net.buildings, net.players, { id: net.playerId, x: you.x, z: you.z, yaw: you.yaw });
  }

  // hovers tooltip / hint bar
  if (state.target) {
    hud.setHint(`${getLang() === 'sv' ? NODES[state.target.type].name : NODES[state.target.type].nameEn} · ${t('hintHarvest')}`);
  } else if (state.hoverBuilding) {
    const b = state.hoverBuilding.building;
    hud.setHint(`${pieceName(PIECES[b.piece])} · ${b.ownerName || ''}${PIECES[b.piece].openable ? ' · E' : ''}`);
  } else if (!state.buildMode) {
    hud.setHint('');
  }

  // stuck rescue: if we have been below the surface for a while, ask the server
  // to place us somewhere safe (keeps inventory; only fires when something is
  // genuinely wrong, e.g. a save from an older world build)
  const surface = sampleHeight(you.x, you.z, net.welcome?.seed ?? WORLD.seed);
  if (you.y < surface - 0.6 && !you.dead) {
    state.stuckSince = state.stuckSince ?? now;
    if (now - state.stuckSince > 2500) {
      state.stuckSince = null;
      net.action('unstick');
      hud.toast(getLang() === 'sv' ? 'Fastnade — flyttad till säker mark' : 'Stuck — moved to safe ground');
    }
  } else {
    state.stuckSince = null;
  }

  // death
  if (you.dead) hud.showDeath(true, state.deathCause);

  // ping + debug
  if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000)) net.ping();
  const stats = net.stats;
  hud.setDebug(
    `fps ${state.fps}  ping ${stats.ping.toFixed(0)}ms  jitter ${stats.jitter.toFixed(1)}\n`
    + `pos ${you.x.toFixed(1)} ${you.y.toFixed(1)} ${you.z.toFixed(1)}  ${you.onGround ? 'mark' : 'luft'}\n`
    + `tick ${net.welcome?.tickRate ?? NET.tickRate}Hz  tid ${(net.time01 * 24).toFixed(1)}h  dag ${net.day}\n`
    + `noder ${net.nodes.size}  byggen ${net.buildings.size}  spelare ${net.players.size}  djur ${interp.animals.size}\n`
    + `pred-korrigeringar ${net.predictor.corrections} (senaste ${net.predictor.lastCorrection.toFixed(3)} m)\n`
    + `nätverk ↓${stats.kbpsIn} kbit/s  upp ${(stats.bytesOut * 8 / 1000 / Math.max(1, state.playtime)).toFixed(1)} kbit/s`,
  );
}

function render(dt, now) {
  worldView.update(state.net?.time01 ?? 0.3, camera.position, settings.renderDistance, state.underwater);
  renderer.autoClear = true;
  renderer.render(scene, camera);
  if (!settings.simpleGraphics) {
    renderer.autoClear = false;
    renderer.clearDepth();
    viewModel.setAspect(camera.aspect);
    viewModel.render(renderer);
    renderer.autoClear = true;
  }
}

boot();

export { state, hud, worldView };
