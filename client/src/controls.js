/**
 * Spell - the control contract.
 *
 * Every key, mouse button, wheel tick and HUD button in the game is described
 * here as a pure decision, so the same rules can be exercised in tests without
 * a GPU (see test/controls.js). main.js owns the side effects; this module owns
 * the *decisions*.
 *
 * Rules this module exists to enforce (they were all real bugs once):
 *   1. A key that repeats (held down) must not toggle a panel over and over.
 *   2. Movement keys must be dropped when input is taken over by a text field,
 *      the window losing focus, or a full-screen panel - otherwise the player
 *      keeps walking while typing.
 *   3. While dead or disconnected only help/debug/pause may react.
 *   4. In drag-look mode, a press that does not move is a click (act) and a
 *      press that moves is looking - never both.
 *   5. Every visible control must actually do something: close buttons, hotbar
 *      slots, tabs, sliders and the respawn/reconnect buttons.
 */

import { isTap } from './camera.js';

/** Keys whose meaning depends on being *held*, not on being pressed once. */
export const HOLD_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
]);

/**
 * The single source of truth for the keyboard. `test/controls.js` compares this
 * table with the help screen so the game and its documentation cannot drift
 * apart, and `KEY_HOLD` is derived from it.
 */
export const KEYBINDS = [
  { action: 'forward', codes: ['KeyW'], hold: true, sv: 'gå framåt', en: 'walk forward' },
  { action: 'back', codes: ['KeyS'], hold: true, sv: 'gå bakåt', en: 'walk back' },
  { action: 'left', codes: ['KeyA'], hold: true, sv: 'gå vänster', en: 'strafe left' },
  { action: 'right', codes: ['KeyD'], hold: true, sv: 'gå höger', en: 'strafe right' },
  { action: 'jump', codes: ['Space'], hold: true, sv: 'hoppa', en: 'jump' },
  { action: 'sprint', codes: ['ShiftLeft', 'ShiftRight'], hold: true, sv: 'spring', en: 'sprint' },
  { action: 'crouch', codes: ['ControlLeft', 'ControlRight'], hold: true, sv: 'smyg', en: 'crouch' },
  { action: 'inventory', codes: ['Tab'], sv: 'ryggsäck', en: 'backpack' },
  { action: 'craft', codes: ['KeyC'], sv: 'tillverka', en: 'craft' },
  { action: 'build', codes: ['KeyB'], sv: 'byggläge', en: 'build mode' },
  { action: 'map', codes: ['KeyM'], sv: 'karta', en: 'map' },
  { action: 'chat', codes: ['KeyT'], sv: 'chatt', en: 'chat' },
  { action: 'repair', codes: ['KeyR'], sv: 'reparera', en: 'repair' },
  { action: 'use', codes: ['KeyE'], sv: 'öppna dörr / ät', en: 'open door / eat' },
  { action: 'equip', codes: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'], sv: 'välj verktyg 1–9', en: 'select tool 1–9' },
  { action: 'pause', codes: ['Escape'], sv: 'stäng panel / inställningar', en: 'close panel / settings' },
  { action: 'help', codes: ['F1'], sv: 'hjälp', en: 'help' },
  { action: 'debug', codes: ['F3'], sv: 'felsökningsinfo', en: 'debug info' },
];

export const KEY_HOLD = new Set(KEYBINDS.filter((b) => b.hold).flatMap((b) => b.codes));

/** code -> bind entry (last one wins; codes are unique by test). */
export const CODE_TO_BIND = (() => {
  const map = new Map();
  for (const bind of KEYBINDS) for (const code of bind.codes) map.set(code, bind);
  return map;
})();

/** 1-9 -> hotbar slot index, anything else -> -1. */
export function digitSlot(code) {
  if (typeof code !== 'string' || !code.startsWith('Digit')) return -1;
  const n = Number(code.slice(5));
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n - 1 : -1;
}

/**
 * What a key press means right now.
 *
 * @param {object} o
 * @param {string} o.code        KeyboardEvent.code
 * @param {boolean} [o.repeat]   KeyboardEvent.repeat (auto-repeat while held)
 * @param {boolean} [o.running]  is a game session active?
 * @param {boolean} [o.dead]     is the death screen up?
 * @param {boolean} [o.disconnected]
 * @param {boolean} [o.buildMode]
 * @param {number}  [o.selection] selected inventory slot (-1 = none)
 * @returns {{kind:string, slot?:number}}
 */
export function keyIntent(o = {}) {
  const { code, repeat = false, running = false, dead = false, disconnected = false } = o;

  // F1/F3 work everywhere, including the menu and the death screen: that is how
  // the player reads the controls and the error list.
  if (code === 'F1') return { kind: 'help' };
  if (code === 'F3') return { kind: 'debug' };
  if (HOLD_CODES.has(code)) return { kind: 'hold' };
  if (!running) return { kind: 'ignore' };

  // A held key must not fire a toggle 30 times per second, and while dead or
  // disconnected only the pause key makes sense.
  if (repeat) return { kind: 'ignore' };
  if (dead || disconnected) return code === 'Escape' ? { kind: 'pause' } : { kind: 'ignore' };

  switch (code) {
    case 'Tab': return { kind: 'inventory' };
    case 'KeyC': return { kind: 'craft' };
    case 'KeyB': return { kind: 'build' };
    case 'KeyM': return { kind: 'map' };
    case 'KeyT': return { kind: 'chat' };
    case 'KeyE': return { kind: 'use' };
    case 'KeyR': return o.buildMode ? { kind: 'rotate' } : { kind: 'repair' };
    case 'Escape': return { kind: 'pause' };
    default: {
      const slot = digitSlot(code);
      return slot >= 0 ? { kind: 'equip', slot } : { kind: 'ignore' };
    }
  }
}

/**
 * Which panel Escape acts on. Priority is top-down (the last thing opened is
 * the first thing closed) which is what a player expects.
 */
export function escapeIntent(open = {}) {
  if (open.settings) return 'close-settings';
  if (open.help) return 'close-help';
  if (open.chat) return 'close-chat';
  if (open.inventory) return 'close-inventory';
  if (open.build) return 'close-build';
  if (open.map) return 'close-map';
  return 'open-settings';
}

/* ------------------------------------------------------------------ *
 *  Mouse
 * ------------------------------------------------------------------ */

/**
 * Look handling. `look` = apply rotation, `anchor` = reset the drag anchor
 * without rotating, `ignore` = not our business.
 */
export function lookDecision(o = {}) {
  const { running, hasPlayer, locked, lookMode, overlayOpen, overCanvas, dragging } = o;
  if (!running || !hasPlayer) return 'ignore';
  if (locked) return 'look'; // deltas come from movementX/Y
  if (lookMode !== 'drag') return 'anchor';
  if (overlayOpen || !overCanvas) return 'anchor';
  return dragging ? 'look' : 'anchor';
}

/** Down: 'arm' records a press (pointer lock fires the action straight away). */
export function pressDecision(o = {}) {
  const { running, overlayOpen, overCanvas } = o;
  if (!running || overlayOpen || !overCanvas) return 'ignore';
  return 'arm';
}

/** Up: 'act' when it was a tap in drag mode, 'none' otherwise. */
export function releaseDecision(o = {}) {
  const { running, overlayOpen, overCanvas, locked, lookMode, press, now, x, y } = o;
  if (locked || lookMode !== 'drag') return 'none';
  if (!press || !running || overlayOpen || !overCanvas) return 'none';
  return isTap(press, now, x, y) ? 'act' : 'none';
}

/**
 * Wheel tick. Build mode rotates the ghost; otherwise the hotbar steps -
 * wrapping in *both* directions (stepping back from "bare hands" must land on
 * slot 9, not slot 8).
 */
export function wheelIntent(o = {}) {
  const { buildMode = false, toolSlot = -1, delta = 0 } = o;
  const step = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  if (step === 0) return { kind: 'none' };
  if (buildMode) return { kind: 'rotate', step };
  const slots = 9;
  const from = toolSlot >= 0 && toolSlot < slots ? toolSlot : (step > 0 ? -1 : 0);
  return { kind: 'equip', slot: ((from + step) % slots + slots) % slots };
}

/* ------------------------------------------------------------------ *
 *  Input state
 * ------------------------------------------------------------------ */

/** Drop every held key and any half-finished drag (window blur, chat, panels). */
export function clearInputs(state) {
  if (!state) return;
  state.keys = Object.create(null);
  if (state.mouse) {
    state.mouse.drag = false;
    state.mouse.press = null;
    state.mouse.hasAnchor = false;
  }
}

/** Movement input must not be sampled while a text field owns the keyboard. */
export function inputBlocked(state) {
  return !!(state && state.typing);
}

/* ------------------------------------------------------------------ *
 *  HUD wiring
 * ------------------------------------------------------------------ */

/** overlay element id -> logical name used by closeOverlay(). */
export const OVERLAY_NAMES = {
  inventoryScreen: 'inventory',
  buildMenu: 'build',
  mapScreen: 'map',
  settings: 'settings',
  help: 'help',
  death: 'death',
  disconnect: 'disconnect',
};

/** Walk up from a clicked element to the overlay it belongs to. */
export function overlayHost(element) {
  let el = element;
  while (el) {
    if (el.classList && el.classList.contains('overlay')) return el;
    el = el.parentElement;
  }
  return null;
}

/** Safari/old browsers do not move focus away from a clicked button. */
export function defocus(el) {
  if (el && typeof el.blur === 'function') el.blur();
}

/**
 * Wire the controls that live in the HUD itself. Returns the number of things
 * that were bound, which the tests assert on (a control that is silently not
 * bound is exactly the failure mode this rule exists for).
 *
 * @param {object} o
 * @param {object} o.hud      Hud instance (needs `.el` and the show* methods)
 * @param {object} o.actions  { closeOverlay(name), equipSlot(i) }
 * @param {Document} o.doc
 */
export function bindHudControls(o = {}) {
  const { hud, actions = {}, doc = globalThis.document } = o;
  if (!hud || !doc) return 0;
  let bound = 0;

  // 1. Close buttons. They are rendered in HTML but were never wired, so
  //    clicking "Stäng" did nothing at all.
  for (const btn of doc.querySelectorAll('.overlay button.close')) {
    btn.addEventListener('click', () => {
      const host = overlayHost(btn);
      const name = host ? OVERLAY_NAMES[host.id] : null;
      if (name) actions.closeOverlay?.(name);
    });
    bound++;
  }

  // 2. Hotbar slots: clicking selects the tool, like the number keys do.
  const hotbar = hud.el?.hotbar;
  if (hotbar && hud.el?.hotbar && doc.querySelectorAll('#hotbar .slot').length) {
    hotbar.addEventListener('click', (e) => {
      const cell = e.target.closest?.('.slot');
      if (!cell) return;
      const slot = Number(cell.dataset.slot);
      if (Number.isInteger(slot) && slot >= 0) actions.equipSlot?.(slot);
    });
    hotbar.addEventListener('contextmenu', (e) => e.preventDefault());
    bound++;
  }

  // 3. A focused button would swallow Space (jump) and Enter, re-firing the
  //    last click. Blur after every click on any button in the game.
  doc.addEventListener('click', (e) => {
    if (e.target?.closest?.('button')) defocus(e.target.closest('button'));
  });
  bound++;

  return bound;
}

export { isTap };
