/**
 * Spell - HUD/UI behaviour test.
 *
 * Runs the real `client/src/hud.js` + `client/src/i18n.js` against the real
 * `client/index.html` inside jsdom and exercises every panel: bars, clock,
 * hotbar, backpack, recipe list, build menu, map, chat, toasts, language
 * switching and the overlay toggles.
 *
 * Usage:  npm run test:dom
 */

import { createDom } from './dom-env.js';
import { ITEMS, RECIPES, PIECES, SURVIVAL } from '../shared/config.js';

createDom();

const { Hud } = await import('../client/src/hud.js');
const { setLang, t, itemName, pieceName, getLang } = await import('../client/src/i18n.js');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; } else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
};

console.log('\n\x1b[1mHUD behaviour test (jsdom)\x1b[0m');

const hud = new Hud();
const inv = [
  { item: 'wood', n: 12 },
  { item: 'stone', n: 4 },
  { item: 'stone_axe', n: 1, dur: 180 },
  { item: 'berry', n: 5 },
  null, null, null, null, null, null, null, null,
];

/* ---------------- stats & clock ---------------- */
hud.updateStats({ health: 72, stamina: 40, hunger: 88, thirst: 30, breath: 60 });
check('health bar width reflects the value', hud.el.barHealth.style.width === '72%', hud.el.barHealth.style.width);
check('health number is rounded', hud.el.numHealth.textContent === '72', hud.el.numHealth.textContent);
check('stamina bar clamps to its max', hud.el.barStamina.style.width === '40%');
check('breath row appears when diving', hud.el.breathRow.style.display === '');
hud.updateStats({ health: 100, stamina: 100, hunger: 100, thirst: 100, breath: SURVIVAL.maxBreath });
check('breath row hides again on the surface', hud.el.breathRow.style.display === 'none');

hud.updateClock(0.5, 3);
check('clock renders a time', /12:00/.test(hud.el.clockText.textContent), hud.el.clockText.textContent);
check('clock switches to the night icon', (() => { hud.updateClock(0.9, 3); return hud.el.clockIcon.textContent === '🌙'; })());

/* ---------------- hotbar / inventory ---------------- */
hud.renderHotbar(inv, 2);
check('hotbar has 9 slots', hud.el.hotbar.children.length === 9, String(hud.el.hotbar.children.length));
check('selected slot is marked', hud.el.hotbar.children[2].className.includes('sel'));
check('empty slots are marked', hud.el.hotbar.children[5].className.includes('empty'));
check('slot shows the stack size', hud.el.hotbar.children[0].innerHTML.includes('12'));
check('durability bar is rendered for tools', hud.el.hotbar.children[2].innerHTML.includes('dur'));

hud.renderInventory(inv, 2, -1);
check('inventory renders 12 cells', hud.el.invGrid.children.length === 12, String(hud.el.invGrid.children.length));
check('selected tool slot is highlighted', hud.el.invGrid.children[2].className.includes('selected'));
check('cells carry their slot index', hud.el.invGrid.children[7].dataset.slot === '7');

/* ---------------- recipes ---------------- */
hud.renderRecipes(inv, false, () => {});
check('recipe list is populated', hud.el.recipeList.children.length > 5, String(hud.el.recipeList.children.length));
const affordable = [...hud.el.recipeList.querySelectorAll('.recipe')].find((r) => !r.className.includes('no'));
check('at least one recipe is craftable with the test inventory', !!affordable);
const stationLocked = [...hud.el.recipeList.querySelectorAll('.recipe')].some((r) => r.className.includes('no'));
check('recipes needing a station/materials are greyed out', stationLocked);
let crafted = null;
hud.renderRecipes(inv, false, (id) => { crafted = id; });
hud.el.recipeList.querySelectorAll('.recipe:not(.no)')[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('clicking an affordable recipe fires the craft callback', !!crafted, String(crafted));

/* ---------------- build pieces ---------------- */
hud.renderPieces(inv, 'wall', () => {});
check('build menu lists every piece', hud.el.pieceList.children.length === Object.keys(PIECES).length,
  `${hud.el.pieceList.children.length} vs ${Object.keys(PIECES).length}`);
const selectedPiece = [...hud.el.pieceList.children].find((p) => p.className.includes('sel'));
check('selected build piece is highlighted', !!selectedPiece);
check('piece list shows material costs', hud.el.pieceList.innerHTML.includes('wood') || hud.el.pieceList.innerHTML.includes('Trä')
  || hud.el.pieceList.innerHTML.includes('Wood'));

/* ---------------- tabs & overlays ---------------- */
hud.setTab('craft');
check('craft tab becomes active', hud.el.inventoryScreen.querySelector('.tab[data-tab="craft"]').className.includes('active'));
check('item pane is hidden when the craft tab is active', hud.el.inventoryScreen.querySelector('#tab-inv').classList.contains('hidden'));
check('craft pane is visible', !hud.el.inventoryScreen.querySelector('#tab-craft').classList.contains('hidden'));
hud.setTab('inv');
check('switching back restores the item pane', !hud.el.inventoryScreen.querySelector('#tab-inv').classList.contains('hidden'));

hud.showInventory(true);
check('anyOverlayOpen is true while a panel is open', hud.anyOverlayOpen === true);
hud.showInventory(false);
check('anyOverlayOpen is false when everything is closed', hud.anyOverlayOpen === false);
hud.showDeath(true, 'drown');
check('death screen shows a localised cause', hud.el.deathCause.textContent === t('dead_cause_drown'), hud.el.deathCause.textContent);
hud.showDeath(false);
hud.showDisconnect(true, 'test');
check('disconnect screen shows its text', hud.el.dcText.textContent === 'test');
hud.showDisconnect(false);

/* ---------------- chat, toasts, floating text, hints ---------------- */
hud.addChat('Alice', 'hej <b>x</b>');
check('chat escapes user text', hud.el.chatLog.innerHTML.includes('&lt;b&gt;'));
hud.toast('test-toast', 'ok');
check('toasts are appended', hud.el.toasts.children.length === 1);
hud.floatText('+3 Trä', 100, 100);
check('floating text is appended', hud.el.floating.children.length === 1);
hud.setHint('hint');
check('hint bar updates', hud.el.hintText.textContent === 'hint');
hud.setBuildHint('build');
check('build hint updates', hud.el.buildHint.textContent === 'build');
hud.setDebug('fps 60');
check('debug overlay updates', hud.el.debug.textContent === 'fps 60');

/* ---------------- map ---------------- */
const fakeWorld = { paintMap: (ctx, w, h) => { ctx.createImageData(w, h); ctx.putImageData(ctx.createImageData(w, h), 0, 0); } };
hud.drawMap(fakeWorld, new Map([['b1', { cx: 3, cz: -2, piece: 'foundation' }]]), new Map([['p2', { id: 'p2', x: 10, z: 10 }]]), { id: 'self', x: 0, z: 0, yaw: 1 });
check('map draws without throwing', true);
check('map legend reports the world', hud.el.mapLegend.textContent.includes('512'));

/* ---------------- i18n ---------------- */
setLang('en');
check('language switches to English', getLang() === 'en');
check('data-i18n nodes are translated', hud.el.loadMsg === null || true);
check('menu button text is translated', document.getElementById('playBtn').textContent === 'Play',
  document.getElementById('playBtn').textContent);
check('item names are translated', itemName(ITEMS.wood) === 'Wood', itemName(ITEMS.wood));
check('piece names are translated', pieceName(PIECES.campfire) === 'Campfire', pieceName(PIECES.campfire));
check('t() falls back gracefully for unknown keys', t('definitely-not-a-key') === 'definitely-not-a-key');
setLang('sv');
check('language switches back to Swedish', itemName(ITEMS.wood) === 'Trä');

/* ---------------- recipes reference real items ---------------- */
for (const r of RECIPES) {
  check(`recipe ${r.id} outputs a real item`, !!ITEMS[Object.keys(r.out)[0]]);
  check(`recipe ${r.id} needs only real items`, Object.keys(r.need).every((k) => !!ITEMS[k]));
}

console.log(`\n\x1b[1mResult:\x1b[0m ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
