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
  WORLD, NET, PHYS, COMBAT, ITEMS, PIECES, BUILD, NODES,
  buildingAABB, piecePosition, countItem,
} from '../../shared/config.js';
import { sampleHeight } from '../../shared/noise.js';
import { auditGround, describeViolations } from '../../shared/ground.js';
import { auditScene, describeModelProblems, BUDGET } from './palette.js';
import { Net } from './net.js';
import { Hud } from './hud.js';
import { WorldView } from './terrain.js';
import { NodeView, BuildingView, AnimalView, PlayerView, ViewModel, BuildGhost } from './entities.js';
import { settings, loadSettings, saveSettings, playerId } from './settings.js';
import { setLang, t, itemName, pieceName, getLang } from './i18n.js';
import { initAudio, resumeAudio, setAudioEnabled, setAmbient, playSound } from './audio.js';
import {
  clampPitch, applyLook, anchorDrag, dragDelta, computeCameraPose, checkCamera,
} from './camera.js';
import {
  keyIntent, escapeIntent, lookDecision, pressDecision, releaseDecision,
  wheelIntent, clearInputs, bindHudControls, inputBlocked,
} from './controls.js';
import { checkCharacter, repairCharacter, describeCharacter } from './character.js';
import { catalogSummary } from './modelCatalog.js';

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
const modelCatalog = catalogSummary();

/* ------------------------------------------------------------------ *
 *  Runtime error capture
 *
 * "There are some errors" is useless without names. Every uncaught error and
 * rejected promise is logged, toasted and listed in the F3 overlay, and the
 * array is exposed as window.__spellErrors so it can be read straight from the
 * devtools console.
 * ------------------------------------------------------------------ */
const runtimeErrors = [];

function recordError(kind, message, extra = '') {
  const entry = {
    kind,
    message: String(message ?? 'okänt fel').slice(0, 300),
    extra: String(extra ?? '').slice(0, 200),
    at: new Date().toISOString(),
  };
  runtimeErrors.push(entry);
  if (runtimeErrors.length > 20) runtimeErrors.shift();
  console.error(`[spell:${kind}] ${entry.message}`, entry.extra);
  try { hud.toast(`${t('errorToast')}: ${entry.message}`, 'bad'); } catch { /* hud not ready */ }
}

window.addEventListener('error', (e) => recordError('error', e.message || 'okänt fel', `${e.filename || ''}${e.lineno ? `:${e.lineno}` : ''}`));
window.addEventListener('unhandledrejection', (e) => recordError('promise', e.reason?.message || String(e.reason ?? '')));
window.__spellErrors = runtimeErrors;

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
  mouse: { locked: false, drag: false, lastX: 0, lastY: 0, lookMode: 'pointer', hasAnchor: false, press: null },
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
  typing: false,      // the chat field owns the keyboard; movement stands still
  hudControls: 0,     // HUD controls bound by controls.js (F3 shows the count)
  groundAudit: { at: 0, buried: 0, lifted: 0, worst: 0 }, // rule: nothing under the ground
  groundErrorAt: 0,
  modelAudit: { at: 0, meshes: 0, triangles: 0, materials: 0, problems: [] }, // rule: the models
  modelErrorAt: 0,
  characterAudit: { at: 0, problems: [], repairs: 0 }, // rule: errors in the character
  characterErrorAt: 0,
  serverAudit: { at: -5000, online: true, errors: 0, last: null, ground: null }, // live /api/status check
  serverErrorAt: 0,
  // fields that are created at runtime (declared here so typos are caught)
  selectedPiece: 'foundation',
  underwater: false,
  stuckSince: null,
  cameraRepairAt: 0,
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
        // The views need the terrain seed to lift interpolated bodies onto the
        // surface (a straight line between two ticks passes under a slope).
        animalView?.setSeed(msg.seed ?? WORLD.seed);
        playerView?.setSeed(msg.seed ?? WORLD.seed);
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
      closeOverlay('chat');
    } else if (e.key === 'Escape') closeOverlay('chat');
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
    // Embedded previews/iframes often block pointer lock. The fallback changes
    // the controls (drag = look, click = act) so say so instead of silently
    // behaving differently from what the help screen promises.
    if (state.mouse.lookMode === 'drag') return;
    state.mouse.lookMode = 'drag';
    state.mouse.hasAnchor = false;
    hud.toast(t('dragLook'));
  });

  /**
   * Look. Two modes:
   *   pointer lock - the browser reports deltas (movementX/Y)
   *   drag         - we track the pointer ourselves, but only while a button is
   *                  held, and the first move after anchoring is ignored. That
   *                  bug (comparing against an unset 0,0) snapped the camera to
   *                  the ceiling the moment the player started dragging.
   */
  document.addEventListener('mousemove', (e) => {
    if (!state.running) return;
    const you = state.net?.you;
    if (!you) return;

    const decision = lookDecision({
      running: state.running,
      hasPlayer: !!you,
      locked: state.mouse.locked,
      lookMode: state.mouse.lookMode,
      overlayOpen: hud.anyOverlayOpen,
      overCanvas: e.target === canvas,
      dragging: state.mouse.drag,
    });
    if (decision === 'ignore') return;
    if (decision === 'anchor') { anchorDrag(state.mouse, e.clientX, e.clientY); return; }
    if (state.mouse.locked) { applyLook(you, e.movementX, e.movementY, settings); return; }
    const { dx, dy } = dragDelta(state.mouse, e.clientX, e.clientY);
    if (dx || dy) applyLook(you, dx, dy, settings);
  });

  window.addEventListener('mousedown', (e) => {
    if (pressDecision({
      running: state.running, overlayOpen: hud.anyOverlayOpen, overCanvas: e.target === canvas,
    }) === 'ignore') return;
    state.mouse.drag = true;
    anchorDrag(state.mouse, e.clientX, e.clientY);
    state.mouse.press = { button: e.button, at: performance.now(), x: e.clientX, y: e.clientY };
    // With a locked pointer the mouse is for looking only, so a press is an action.
    if (state.mouse.locked) {
      if (e.button === 0) primaryAction();
      if (e.button === 2) secondaryAction();
    }
  });

  window.addEventListener('mouseup', (e) => {
    const press = state.mouse.press;
    state.mouse.drag = false;
    state.mouse.press = null;
    anchorDrag(state.mouse, e.clientX, e.clientY);
    // Drag mode: a short press that did not move is a click -> act. Otherwise the
    // player would swing the axe every time they looked around.
    const act = releaseDecision({
      running: state.running,
      overlayOpen: hud.anyOverlayOpen,
      overCanvas: e.target === canvas,
      locked: state.mouse.locked,
      lookMode: state.mouse.lookMode,
      press, now: performance.now(), x: e.clientX, y: e.clientY,
    }) === 'act';
    if (act && press) {
      if (press.button === 0) primaryAction();
      else if (press.button === 2) secondaryAction();
    }
  });
  document.addEventListener('contextmenu', (e) => { if (state.running) e.preventDefault(); });
  document.addEventListener('wheel', (e) => {
    if (!state.running || hud.anyOverlayOpen) return;
    const you = state.net.you;
    const intent = wheelIntent({ buildMode: state.buildMode, toolSlot: you.toolSlot, delta: e.deltaY });
    if (intent.kind === 'rotate') state.rotation = (state.rotation + intent.step + 4) % 4;
    else if (intent.kind === 'equip') state.net.action('equip', { slot: intent.slot });
  }, { passive: true });

  bindSettings();
  hud.el.inventoryScreen.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => hud.setTab(btn.dataset.tab));
  });

  // Close buttons, hotbar clicks and the focus trap: a control that is drawn but
  // never wired is a bug, so the number of bindings is asserted by the tests and
  // shown in the debug overlay.
  state.hudControls = bindHudControls({
    hud,
    doc: document,
    actions: {
      closeOverlay,
      equipSlot: (slot) => state.net?.action('equip', { slot }),
    },
  });

  document.addEventListener('keydown', (e) => onKey(e, true));
  document.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('resize', onResize);
  // Blur: drop every held key and any half-finished drag - a stale anchor would
  // otherwise turn the next mousemove into a jump, and a stale key into a player
  // who walks away on their own.
  window.addEventListener('blur', () => clearInputs(state));
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

function closeOverlay(name) {
  switch (name) {
    case 'settings': hud.showSettings(false); saveSettings(); break;
    case 'help': hud.showHelp(false); break;
    case 'inventory': hud.showInventory(false); break;
    case 'build': hud.showBuild(false); state.buildMode = false; ghost.hide(); hud.setBuildHint(''); break;
    case 'map': hud.showMap(false); break;
    case 'chat': hud.showChatInput(false); state.typing = false; break;
    default: break;
  }
}

/** Which panels are up - the input system needs this for several decisions. */
function overlayState() {
  return {
    settings: !hud.el.settings.classList.contains('hidden'),
    help: !hud.el.help.classList.contains('hidden'),
    chat: !hud.el.chatInputWrap.classList.contains('hidden'),
    inventory: !hud.el.inventoryScreen.classList.contains('hidden'),
    build: !hud.el.buildMenu.classList.contains('hidden'),
    map: !hud.el.mapScreen.classList.contains('hidden'),
    death: !hud.el.death.classList.contains('hidden'),
    disconnect: !hud.el.disconnect.classList.contains('hidden'),
  };
}

function onKey(e, down) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.code;
  if (down && k === 'Space') e.preventDefault();

  // Every decision is made by the control contract (client/src/controls.js) so
  // it can be tested: auto-repeat never toggles, the dead cannot act, and so on.
  const intent = down
    ? keyIntent({
      code: k, repeat: !!e.repeat, running: state.running,
      dead: !hud.el.death.classList.contains('hidden'),
      disconnected: !hud.el.disconnect.classList.contains('hidden'),
      buildMode: state.buildMode,
      selection: state.selection,
    })
    : { kind: 'hold' };

  if (intent.kind === 'hold') { state.keys[k] = true; if (!down) delete state.keys[k]; return; }

  switch (intent.kind) {
    case 'help': e.preventDefault(); hud.showHelp(hud.el.help.classList.contains('hidden')); break;
    case 'debug': e.preventDefault(); hud.toggleDebug(); break;
    case 'inventory':
      e.preventDefault();
      if (hud.anyOverlayOpen) closeOverlay('inventory');
      else { hud.showInventory(true); hud.setTab('inv'); clearInputs(state); document.exitPointerLock?.(); }
      break;
    case 'craft':
      hud.showInventory(true); hud.setTab('craft'); clearInputs(state); document.exitPointerLock?.();
      break;
    case 'build':
      state.buildMode = !state.buildMode;
      ghost.hide();
      hud.showBuild(state.buildMode);
      if (state.buildMode) { clearInputs(state); document.exitPointerLock?.(); }
      hud.setBuildHint(state.buildMode ? `${t('hintPlace')} · ${t('hintRotate')} · ${t('hintCancel')}` : '');
      break;
    case 'map':
      hud.showMap(hud.el.mapScreen.classList.contains('hidden'));
      if (!hud.el.mapScreen.classList.contains('hidden')) { clearInputs(state); document.exitPointerLock?.(); }
      break;
    case 'chat':
      if (hud.el.chatInputWrap.classList.contains('hidden')) {
        clearInputs(state);           // stop walking the moment the field opens
        state.typing = true;
        hud.showChatInput(true);
      }
      break;
    case 'rotate':
      if (state.buildMode) state.rotation = (state.rotation + 1) % 4;
      break;
    case 'repair':
      if (!hud.el.inventoryScreen.classList.contains('hidden') && state.selection >= 0) {
        state.net.action('repair', { slot: state.selection });
      }
      break;
    case 'use': {
      const hit = pickBuilding(3.5);
      if (hit && PIECES[hit.building.piece]?.openable) state.net.action('door', { id: hit.building.id });
      else {
        const food = state.net.you.inv.findIndex((slot) => slot && ITEMS[slot.item]?.kind === 'food');
        if (food >= 0) state.net.action('use', { slot: food });
      }
      break;
    }
    case 'equip': state.net.action('equip', { slot: intent.slot }); break;
    case 'pause': {
      const what = escapeIntent(overlayState());
      if (what === 'open-settings') { hud.showSettings(true); clearInputs(state); document.exitPointerLock?.(); }
      else closeOverlay(what.replace('close-', ''));
      break;
    }
    default: break;
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

/**
 * Rule: nothing may end up under the ground - and if it does, that is an error
 * that must be visible, not something the player has to guess at. Uses the same
 * shared audit as the server, once per second, on the replicated truth.
 */
function auditClientGround(now) {
  const net = state.net;
  if (!net?.welcome || now - state.groundAudit.at < 1000) return;
  const seed = net.welcome.seed ?? WORLD.seed;
  const buildings = [];
  for (const b of net.buildings.values()) {
    const def = PIECES[b.piece];
    const pos = piecePosition(b.cx, b.cz, b.rot, b.piece);
    const rotated = b.rot % 2 === 1;
    buildings.push({
      id: b.id, piece: b.piece, x: pos.x, z: pos.z, y: b.y,
      footprint: def ? {
        halfX: (rotated ? def.size[2] : def.size[0]) / 2,
        halfZ: (rotated ? def.size[0] : def.size[2]) / 2,
      } : undefined,
    });
  }
  const list = auditGround((x, z) => sampleHeight(x, z, seed), {
    players: [...net.players.values()],
    animals: [...interp.animals.values()].map((a) => a.target ?? a),
    nodes: [...net.nodes.values()],
    buildings,
  }, { pieces: PIECES });

  state.groundAudit = {
    at: now,
    buried: list.length,
    lifted: list.filter((v) => v.kind === 'animal' || v.kind === 'player').length,
    worst: list[0] ? Number(list[0].depth.toFixed(2)) : 0,
  };
  if (list.length && now - state.groundErrorAt > 5000) {
    state.groundErrorAt = now;
    recordError('ground', describeViolations(list, 3, getLang()), `${list.length} objekt under markytan`);
  }
}

/**
 * Rule: check the models - design, colours, materials, how good they are, then
 * the errors in them. The scene is measured a few times per second: mesh count,
 * triangle count, material count and anything that breaks a rule (NaN geometry,
 * a mesh without a material, an impossible triangle count for its kind).
 */
function auditModels(now) {
  if (now - state.modelAudit.at < 3000) return;
  const result = auditScene(scene, { budget: BUDGET });
  state.modelAudit = {
    at: now,
    meshes: result.meshes,
    triangles: result.triangles,
    materials: result.materials,
    problems: result.problems,
  };
  const problems = result.problems;
  if (problems.length && now - state.modelErrorAt > 5000) {
    state.modelErrorAt = now;
    recordError('model', describeModelProblems(problems, 3, getLang()), `${result.meshes} meshes, ${result.triangles} trianglar`);
  }
}

/**
 * Rule: check for errors in the character. Runs once a second on the state the
 * client actually predicts and renders with, reports through recordError (F3 +
 * window.__spellErrors) and repairs what can be repaired without guessing.
 */
function auditCharacter(now, you, ground) {
  if (!you || now - state.characterAudit.at < 1000) return;
  const context = { ground, seed: state.net?.welcome?.seed };
  const problems = checkCharacter(you, context);
  let repairs = 0;
  if (problems.length) repairs = repairCharacter(you, state.lastPos, context);
  state.characterAudit = { at: now, problems, repairs };
  if (problems.length && now - state.characterErrorAt > 5000) {
    state.characterErrorAt = now;
    recordError('character', describeCharacter(problems), `${problems.length} fel${repairs ? `, ${repairs} lagade` : ''}`);
  }
}

/**
 * Read the server's error counter and ground audit through a same-origin URL.
 * It works in the live preview too: the browser never calls localhost or a
 * separate backend.
 */
async function auditServer(now) {
  if (now - state.serverAudit.at < 5000) return;
  state.serverAudit.at = now;
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`/api/status svarade ${response.status}`);
    const status = await response.json();
    const count = Number.isFinite(status.errors?.count) ? status.errors.count : 0;
    state.serverAudit = {
      at: now, online: true, errors: count,
      last: status.errors?.last ?? null, ground: status.world?.ground ?? null,
    };
    if (count > 0 && now - state.serverErrorAt > 5000) {
      state.serverErrorAt = now;
      recordError('server', `servern rapporterar ${count} fel`, state.serverAudit.last || 'inget felmeddelande');
    }
  } catch (err) {
    state.serverAudit = { ...state.serverAudit, at: now, online: false, last: err?.message || String(err) };
    if (now - state.serverErrorAt > 5000) {
      state.serverErrorAt = now;
      recordError('server', 'serverns status kunde inte läsas', state.serverAudit.last);
    }
  }
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
    const typing = inputBlocked(state);
    const forward = typing ? 0 : (state.keys.KeyW ? 1 : 0) - (state.keys.KeyS ? 1 : 0);
    const strafe = typing ? 0 : (state.keys.KeyD ? 1 : 0) - (state.keys.KeyA ? 1 : 0);
    net.sendInput({
      yaw: you.yaw, pitch: you.pitch,
      wish: forward, strafe,
      jump: !typing && !!state.keys.Space,
      sprint: !typing && !!(state.keys.ShiftLeft || state.keys.ShiftRight),
      crouch: !typing && !!(state.keys.ControlLeft || state.keys.ControlRight),
      dt: step,
    });
  }

  // ---- ground audit: is anything below the surface?
  auditClientGround(now);

  // ---- model audit: design, colours, materials, cost
  auditModels(now);

  // ---- camera follows the predicted player (math lives in camera.js)
  const eye = you.crouch ? PHYS.crouchEyeHeight : PHYS.eyeHeight;
  const ground = sampleHeight(you.x, you.z, net.welcome?.seed ?? WORLD.seed);

  // ---- character audit: NaN, impossible values, broken inventory
  auditCharacter(now, you, ground);

  // ---- server audit: its real error counter and shared ground check
  auditServer(now);

  const pose = computeCameraPose({ you, ground, eyeHeight: eye, dt, currentY: camera.position.y });
  camera.position.set(pose.x, pose.y, pose.z);
  // Rotation is set as a whole with roll pinned to 0: assigning x and y alone
  // would keep whatever roll was left from an earlier lookAt().
  camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();

  // ---- camera self-check: repair instead of showing a broken world
  const camProblems = checkCamera({ position: camera.position, rotation: camera.rotation, fov: camera.fov });
  if (camProblems.length) {
    if (!state.cameraRepairAt || now - state.cameraRepairAt > 5000) {
      state.cameraRepairAt = now;
      recordError('camera', camProblems.join('; '), `pos ${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)}`);
    }
    camera.position.set(you.x, Math.max(you.y, Number.isFinite(ground) ? ground : you.y) + eye, you.z);
    camera.rotation.set(clampPitch(you.pitch), Number.isFinite(you.yaw) ? you.yaw : 0, 0, 'YXZ');
  }

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

  // Contextual hint bar. One place decides the text: appending from elsewhere
  // does not work because this runs every frame.
  let hint = '';
  if (state.target) {
    const def = NODES[state.target.type];
    hint = `${getLang() === 'sv' ? def.name : def.nameEn} · ${t('hintHarvest')}`;
  } else if (state.hoverBuilding) {
    const b = state.hoverBuilding.building;
    hint = `${pieceName(PIECES[b.piece])}${b.ownerName ? ` · ${b.ownerName}` : ''}${PIECES[b.piece].openable ? ' · E' : ''}`;
  }
  if (state.buildMode) hint = `${pieceName(PIECES[state.selectedPiece])} · ${t('hintPlace')} · ${t('hintRotate')}`;
  // Without pointer lock the controls differ, so say so every frame
  if (state.mouse.lookMode === 'drag' && !state.mouse.locked) {
    hint = hint ? `${hint} · ${t('dragHintShort')}` : t('dragHintShort');
  }
  hud.setHint(hint);

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
    + `nätverk ↓${stats.kbpsIn} kbit/s  upp ${(stats.bytesOut * 8 / 1000 / Math.max(1, state.playtime)).toFixed(1)} kbit/s\n`
    + `titt: ${state.mouse.locked ? 'pekarlås' : state.mouse.lookMode === 'drag' ? 'drag' : 'pekarlås (ej aktivt)'}`
    + `  pitch ${(you.pitch * 57.3).toFixed(0)}°  roll ${(camera.rotation.z).toFixed(3)}\n`
    + `modeller ${state.modelAudit.meshes} meshes/${state.modelAudit.triangles} tris/${state.modelAudit.materials} mat`
    + `${state.modelAudit.problems.length ? `  modellfel: ${state.modelAudit.problems.length}` : ''}\n`
    + `modellkatalog ${modelCatalog.total}/8: `
    + `djur ${modelCatalog.counts.djur} mark ${modelCatalog.counts.mark} vapen ${modelCatalog.counts.vapen} `
    + `material ${modelCatalog.counts.material} karaktär ${modelCatalog.counts.karaktar} bygge ${modelCatalog.counts.bygge} `
    + `utrustning ${modelCatalog.counts.utrustning} textur ${modelCatalog.counts.textur}\n`
    + `karaktär: ${describeCharacter(state.characterAudit.problems)}`
    + `${state.characterAudit.repairs ? ` (lagade ${state.characterAudit.repairs})` : ''}\n`
    + `server ${state.serverAudit.online ? 'online' : 'fel'}  serverfel: ${state.serverAudit.errors}`
    + `  servermark: ${state.serverAudit.ground?.buried ?? '–'}`
    + `${state.serverAudit.last ? ` — ${state.serverAudit.last.slice(0, 60)}` : ''}\n`
    + `kontroller ${state.hudControls}  under mark: ${state.groundAudit.buried}`
    + `${state.groundAudit.buried ? ` (värst ${state.groundAudit.worst} m)` : ''}`
    + `  fel: ${runtimeErrors.length}`
    + `${runtimeErrors.length ? `  senast: ${runtimeErrors[runtimeErrors.length - 1].message}` : ''}`,
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
