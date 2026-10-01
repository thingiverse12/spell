/**
 * Spell - control tests (rule: "check every control in the game").
 *
 * Every control is a decision in client/src/controls.js, and every decision is
 * a test here. The DOM half runs in jsdom against the *real* client/index.html,
 * so it also catches the worst failure mode of all: a control that is drawn but
 * never wired (all five "Stäng" buttons were dead when this suite was written).
 *
 * What is covered:
 *   1. the key table itself (no duplicate codes, sv+en labels, source of truth)
 *   2. keyIntent      - every key in every state, including auto-repeat and death
 *   3. escapeIntent   - panel closing priority
 *   4. mouse          - look / press / release (click and drag are exclusive)
 *   5. wheel          - tool stepping in both directions, build-mode rotation
 *   6. clearInputs    - blur / panel opening cannot leave a key held
 *   7. jsdom          - close buttons, hotbar clicks, the focus trap
 *   8. code audit     - no key is handled outside the contract
 *
 * Usage:  npm run test:controls
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDom } from './dom-env.js';
import { Hud } from '../client/src/hud.js';
import {
  KEYBINDS, KEY_HOLD, HOLD_CODES, CODE_TO_BIND, OVERLAY_NAMES,
  keyIntent, escapeIntent, lookDecision, pressDecision, releaseDecision,
  wheelIntent, clearInputs, inputBlocked, digitSlot, overlayHost, defocus, bindHudControls,
} from '../client/src/controls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; } else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `fick ${JSON.stringify(got)}, väntade ${JSON.stringify(want)}`);

console.log('\n\x1b[1mKontrolltest\x1b[0m');

/* ------------------------------------------------------------------ *
 * 1. The key table
 * ------------------------------------------------------------------ */
section('1. Tangenttabellen (enda källan för kontrollerna)');

check('minst 15 bindningar finns', KEYBINDS.length >= 15, `${KEYBINDS.length}`);
check('varje bindning har svensk och engelsk text', KEYBINDS.every((b) => b.sv && b.en), 'någon saknar text');
check('varje bindning har minst en kod', KEYBINDS.every((b) => Array.isArray(b.codes) && b.codes.length > 0));
const allCodes = KEYBINDS.flatMap((b) => b.codes);
check('inga dubblerade koder', new Set(allCodes).size === allCodes.length, `${allCodes.length} koder`);
check('CODE_TO_BIND täcker alla koder', allCodes.every((c) => CODE_TO_BIND.has(c)));
check('hold-koder stämmer med tabellen', [...HOLD_CODES].every((c) => KEY_HOLD.has(c)) && KEY_HOLD.size === HOLD_CODES.size);
check('Digit1-9 är en enda bindning', CODE_TO_BIND.get('Digit9').action === 'equip');

/* ------------------------------------------------------------------ *
 * 2. keyIntent
 * ------------------------------------------------------------------ */
section('2. keyIntent - vad en tangent betyder just nu');

const run = (o) => keyIntent({ running: true, ...o });

check('W är en håll-tangent', run({ code: 'KeyW' }).kind === 'hold');
check('Skift är en håll-tangent', run({ code: 'ShiftLeft' }).kind === 'hold');
check('Ctrl är en håll-tangent', run({ code: 'ControlLeft' }).kind === 'hold');
check('mellanslag är en håll-tangent', run({ code: 'Space' }).kind === 'hold');
check('Tab öppnar ryggsäcken', run({ code: 'Tab' }).kind === 'inventory');
check('C öppnar tillverkning', run({ code: 'KeyC' }).kind === 'craft');
check('B växlar byggläge', run({ code: 'KeyB' }).kind === 'build');
check('M öppnar kartan', run({ code: 'KeyM' }).kind === 'map');
check('T öppnar chatten', run({ code: 'KeyT' }).kind === 'chat');
check('E använder/öppnar', run({ code: 'KeyE' }).kind === 'use');
check('R reparerar utanför byggläge', run({ code: 'KeyR' }).kind === 'repair');
check('R roterar i byggläge', run({ code: 'KeyR', buildMode: true }).kind === 'rotate');
check('Esc pausar', run({ code: 'Escape' }).kind === 'pause');
check('F1 fungerar även i menyn', keyIntent({ code: 'F1' }).kind === 'help');
check('F3 fungerar även i menyn', keyIntent({ code: 'F3' }).kind === 'debug');
check('1 väljer plats 0', run({ code: 'Digit1' }).kind === 'equip' && run({ code: 'Digit1' }).slot === 0);
check('9 väljer plats 8', run({ code: 'Digit9' }).slot === 8);
check('Digit0 gör ingenting', run({ code: 'Digit0' }).kind === 'ignore');
check('okänd tangent ignoreras', run({ code: 'KeyQ' }).kind === 'ignore');

// rule 6b: a held key must not toggle a panel over and over
check('auto-repeat på B växlar inte byggläget', run({ code: 'KeyB', repeat: true }).kind === 'ignore');
check('auto-repeat på Tab öppnar inte ryggsäcken gång på gång', run({ code: 'Tab', repeat: true }).kind === 'ignore');
check('auto-repeat på Esc pausar inte upprepade gånger', run({ code: 'Escape', repeat: true }).kind === 'ignore');
check('auto-repeat på 1 byter inte verktyg', run({ code: 'Digit1', repeat: true }).kind === 'ignore');
check('auto-repeat på R roterar inte hysteriskt', run({ code: 'KeyR', repeat: true, buildMode: true }).kind === 'ignore');
check('håll-tangenter påverkas inte av repeat', run({ code: 'KeyW', repeat: true }).kind === 'hold');

// rule 6c: the dead and the disconnected cannot act
check('död spelare kan inte öppna ryggsäcken', run({ code: 'Tab', dead: true }).kind === 'ignore');
check('död spelare kan inte bygga', run({ code: 'KeyB', dead: true }).kind === 'ignore');
check('död spelare kan inte byta verktyg', run({ code: 'Digit3', dead: true }).kind === 'ignore');
check('död spelare kan stänga pausen med Esc', run({ code: 'Escape', dead: true }).kind === 'pause');
check('död spelare kan läsa hjälpen', run({ code: 'F1', dead: true }).kind === 'help');
check('frånkopplad spelare kan inte handla', run({ code: 'KeyE', disconnected: true }).kind === 'ignore');
check('Esc fungerar vid frånkoppling', run({ code: 'Escape', disconnected: true }).kind === 'pause');
check('inget händer före spelstart', keyIntent({ code: 'KeyB', running: false }).kind === 'ignore');
check('rörelse spelas in även före start', keyIntent({ code: 'KeyW', running: false }).kind === 'hold');

/* ------------------------------------------------------------------ *
 * 3. escapeIntent
 * ------------------------------------------------------------------ */
section('3. Esc-prioritet (det översta stängs först)');

eq('inställningar först', escapeIntent({ settings: true, inventory: true }), 'close-settings');
eq('hjälpen före ryggsäcken', escapeIntent({ help: true, inventory: true }), 'close-help');
eq('chatten stängs före ryggsäcken', escapeIntent({ chat: true, inventory: true }), 'close-chat');
eq('ryggsäcken före byggläget', escapeIntent({ inventory: true, build: true }), 'close-inventory');
eq('byggläget före kartan', escapeIntent({ build: true, map: true }), 'close-build');
eq('kartan stängs sist', escapeIntent({ map: true }), 'close-map');
eq('inget öppet -> inställningar', escapeIntent({}), 'open-settings');

/* ------------------------------------------------------------------ *
 * 4. Mouse decisions
 * ------------------------------------------------------------------ */
section('4. Musen: titta kontra handla');

const look = (o) => lookDecision({ running: true, hasPlayer: true, locked: false, lookMode: 'drag', overlayOpen: false, overCanvas: true, dragging: true, ...o });
check('pekarlås ger alltid titt', lookDecision({ running: true, hasPlayer: true, locked: true, lookMode: 'pointer', overlayOpen: false, overCanvas: false, dragging: false }) === 'look');
check('drag med knapp nere tittar', look({}) === 'look');
check('drag utan knapp ankrar bara', look({ dragging: false }) === 'anchor');
check('panel öppen -> ingen titt', look({ overlayOpen: true }) === 'anchor');
check('pekare utanför duken -> ingen titt', look({ overCanvas: false }) === 'anchor');
check('fel tittläge -> ingen titt', look({ lookMode: 'pointer' }) === 'anchor');
check('före spelstart -> ingen titt', look({ running: false }) === 'ignore');
check('utan spelare -> ingen titt', look({ hasPlayer: false }) === 'ignore');

check('nedtryck armerar', pressDecision({ running: true, overlayOpen: false, overCanvas: true }) === 'arm');
check('nedtryck över panel ignoreras', pressDecision({ running: true, overlayOpen: true, overCanvas: true }) === 'ignore');
check('nedtryck utanför duken ignoreras', pressDecision({ running: true, overlayOpen: false, overCanvas: false }) === 'ignore');

const press = { button: 0, at: 1000, x: 100, y: 100 };
const rel = (o) => releaseDecision({
  running: true, overlayOpen: false, overCanvas: true, locked: false, lookMode: 'drag',
  press, now: 1200, x: 102, y: 101, ...o,
});
check('kort stillastående tryck = klick', rel({}) === 'act');
check('långt tryck = inget klick', rel({ now: 1400 }) === 'none');
check('långt drag = inget klick', rel({ x: 300 }) === 'none');
check('pekarlås klickar inte två gånger', rel({ locked: true }) === 'none');
check('utan nedtryckning inget klick', rel({ press: null }) === 'none');
check('klick över panel ignorerat', rel({ overlayOpen: true }) === 'none');

/* ------------------------------------------------------------------ *
 * 5. Wheel
 * ------------------------------------------------------------------ */
section('5. Mushjulet');

eq('hjul nedåt från tomt läge väljer plats 0', wheelIntent({ toolSlot: -1, delta: 1 }), { kind: 'equip', slot: 0 });
eq('hjul uppåt från tomt läge väljer sista platsen', wheelIntent({ toolSlot: -1, delta: -1 }), { kind: 'equip', slot: 8 });
eq('hjul nedåt stegar framåt', wheelIntent({ toolSlot: 3, delta: 1 }), { kind: 'equip', slot: 4 });
eq('hjul uppåt stegar bakåt', wheelIntent({ toolSlot: 3, delta: -1 }), { kind: 'equip', slot: 2 });
eq('hjul nedåt från sista platsen slår runt', wheelIntent({ toolSlot: 8, delta: 1 }), { kind: 'equip', slot: 0 });
eq('hjul uppåt från första platsen slår runt', wheelIntent({ toolSlot: 0, delta: -1 }), { kind: 'equip', slot: 8 });
eq('ogiltig plats behandlas som tom', wheelIntent({ toolSlot: 42, delta: 1 }), { kind: 'equip', slot: 0 });
eq('hjul i byggläge roterar framåt', wheelIntent({ buildMode: true, toolSlot: 0, delta: 1 }), { kind: 'rotate', step: 1 });
eq('hjul bakåt i byggläge roterar bakåt', wheelIntent({ buildMode: true, toolSlot: 0, delta: -1 }), { kind: 'rotate', step: -1 });
eq('stilla hjul gör ingenting', wheelIntent({ toolSlot: 0, delta: 0 }), { kind: 'none' });

/* ------------------------------------------------------------------ *
 * 6. clearInputs / typing
 * ------------------------------------------------------------------ */
section('6. Inmatningstillstånd (får aldrig fastna)');

const st = { keys: Object.assign(Object.create(null), { KeyW: true, ShiftLeft: true }), mouse: { drag: true, press: { button: 0 }, hasAnchor: true, locked: true } };
clearInputs(st);
check('alla tangenter släpps', Object.keys(st.keys).length === 0);
check('drag avbryts', st.mouse.drag === false);
check('nedtryckningen släpps', st.mouse.press === null);
check('ankaret glöms', st.mouse.hasAnchor === false);
check('pekarlåset rörs inte av misstag', st.mouse.locked === true);
check('clearInputs tål undefined', (() => { clearInputs(undefined); return true; })());
check('inputBlocked speglar typing', inputBlocked({ typing: true }) === true && inputBlocked({ typing: false }) === false && inputBlocked(null) === false);

section('7. digitSlot');
check('Digit1 -> 0', digitSlot('Digit1') === 0);
check('Digit9 -> 8', digitSlot('Digit9') === 8);
check('Digit0 -> -1', digitSlot('Digit0') === -1);
check('Numpad1 -> -1', digitSlot('Numpad1') === -1);
check('skräp -> -1', digitSlot(null) === -1 && digitSlot(undefined) === -1 && digitSlot('KeyW') === -1);

/* ------------------------------------------------------------------ *
 * 8. jsdom: the HUD controls are actually wired
 * ------------------------------------------------------------------ */
section('8. HUD-kontroller i riktig DOM (jsdom)');

const dom = createDom();
const { window } = dom;
const doc = window.document;

const closed = [];
let equipped = null;
// The real Hud class, exactly as main.js uses it.
const hud = new Hud();
hud.renderHotbar([], -1); // draws the nine slots (they are created at runtime)
const bound = bindHudControls({
  hud, doc,
  actions: {
    closeOverlay: (name) => closed.push(name),
    equipSlot: (slot) => { equipped = slot; },
  },
});

check('bindningar registrerades', bound >= 6, `fick ${bound}`);
check('stäng-knappar finns i dokumentet', doc.querySelectorAll('.overlay button.close').length === 5);

// every close button closes its own overlay - the real bug this suite caught
const expectations = [
  ['inventoryScreen', 'inventory'],
  ['buildMenu', 'build'],
  ['mapScreen', 'map'],
  ['settings', 'settings'],
  ['help', 'help'],
];
for (const [id, name] of expectations) {
  closed.length = 0;
  const host = doc.getElementById(id);
  const btn = host.querySelector('button.close');
  check(`${id}: har en stäng-knapp`, !!btn);
  if (btn) {
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check(`${id}: stänger ${name}`, closed.length === 1 && closed[0] === name, JSON.stringify(closed));
  }
}

check('overlayHost hittar rätt förälder', overlayHost(doc.querySelector('#settings button.close')).id === 'settings');
check('OVERLAY_NAMES täcker alla overlay-element', expectations.every(([id]) => OVERLAY_NAMES[id]));

// hotbar clicks select the tool
const slots = doc.querySelectorAll('#hotbar .slot');
check('snabbraden har nio platser', slots.length === 9, `${slots.length}`);
check('platserna har data-slot', slots[2]?.dataset.slot === '2');
slots[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('klick på plats 3 utrustar plats 2', equipped === 2, String(equipped));

// focus trap: a clicked button must not keep focus (Space would re-fire it)
const playBtn = doc.getElementById('playBtn');
playBtn.focus();
check('knappen har fokus före klick', doc.activeElement === playBtn);
playBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('fokus släpps efter klick', doc.activeElement !== playBtn);
check('defocus tål element utan blur', (() => { defocus({}); defocus(null); return true; })());

/* ------------------------------------------------------------------ *
 * 9. Code audit: no control bypasses the contract
 * ------------------------------------------------------------------ */
section('9. Kodrevision: ingen kontroll går förbi kontraktet');

const main = read('client/src/main.js');
const controls = read('client/src/controls.js');

check('main.js använder keyIntent', /keyIntent\(\{/.test(main));
check('main.js använder escapeIntent', /escapeIntent\(/.test(main));
check('main.js använder lookDecision', /lookDecision\(\{/.test(main));
check('main.js använder pressDecision/releaseDecision', /pressDecision\(\{/.test(main) && /releaseDecision\(\{/.test(main));
check('main.js använder wheelIntent', /wheelIntent\(\{/.test(main));
check('main.js använder bindHudControls', /bindHudControls\(\{/.test(main));
check('main.js använder clearInputs på blur', /addEventListener\('blur', \(\) => clearInputs\(state\)\)/.test(main));
check('inga råa paneltangenter kvar i main.js', !/case '(KeyB|KeyC|KeyM|KeyT|Tab|Escape)':/.test(main));
check('ingen egen Esc-kedja kvar i main.js', !/classList\.contains\('hidden'\)\) hud\.showHelp/.test(main));
// Only hold keys may be read or written, and bracket access is allowed only
// through the intent's own variable (`state.keys[k]`) - never a literal code.
check('tangenterna läses bara för håll-koder', (() => {
  const reads = [...main.matchAll(/state\.keys\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  return reads.every((k) => HOLD_CODES.has(k));
})(), [...new Set([...main.matchAll(/state\.keys\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))].join(','));
check('hakparenteser används bara via intent-variabeln', (() => {
  const brackets = [...main.matchAll(/state\.keys\[([^\]]+)\]/g)].map((m) => m[1].trim());
  return brackets.length > 0 && brackets.every((b) => b === 'k');
})(), [...new Set([...main.matchAll(/state\.keys\[([^\]]+)\]/g)].map((m) => m[1].trim()))].join(','));
check('controls.js importerar isTap från kameran', /import \{ isTap \} from '\.\/camera\.js'/.test(controls));

console.log(`\n\x1b[1mResultat:\x1b[0m ${passed} godkända, ${failed} misslyckade\n`);
if (failed) process.exit(1);
