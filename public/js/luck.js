/* =====================================================================
   Gummibandet – dynamisk tur som håller spel-ekonomin i balans.

   Har spelaren lite spelmynt kvar blir turen högre (man vinner mer),
   har spelaren vunnit mycket blir turen lägre (man förlorar mer).
   Faktorn påverkar bara vinsten ovanpå insatsen – en vinst ger alltid
   mer än insatsen tillbaka, oavsett tur.
   ===================================================================== */

import { state } from './core.js';

export const LUCK_MIN = 0.7;
export const LUCK_MAX = 1.35;

/* Spannet för tur-inställningarna i adminpanelen (slotLuck, videoPokerLuck,
   scratchLuck). ×1,00 är neutralt: under 1 betalar spelen sämre, över 1 bättre.
   Nivåerna räknas fram i economy.js och kontrolleras av npm run audit. */
export const LUCK_SETTING_MIN = 0.1;
export const LUCK_SETTING_MAX = 3;

export function clampLuckSetting(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return 1;
  return Math.min(LUCK_SETTING_MAX, Math.max(LUCK_SETTING_MIN, v));
}

/** Faktor utifrån saldo jämfört med start-/jämviktsläget. */
export function luckFactor(balance, startBalance = 2500) {
  const start = Number(startBalance);
  const bal = Math.max(0, Number(balance) || 0);
  if (!(start > 0)) return 1;
  const ratio = bal / start;
  let factor = 1;
  if (ratio < 1) {
    // Lite kvar på kontot → turen skruvas upp (max +35 %).
    factor = 1 + Math.min(0.35, (1 - ratio) * 0.35);
  } else if (ratio > 1.5) {
    // Vunnit mycket → turen skruvas ned (min −30 %).
    factor = 1 - Math.min(0.3, (ratio - 1.5) * 0.2);
  }
  return Math.round(Math.min(LUCK_MAX, Math.max(LUCK_MIN, factor)) * 100) / 100;
}

/** Gällande faktor, med hänsyn till om gummibandet är påslaget. */
export function currentLuck() {
  if (state.settings && state.settings.rubberBand === false) return 1;
  return luckFactor(state.player && state.player.balance, state.settings && state.settings.startBalance);
}

/** Vinst = insats + (insats × (multipel − 1)) × tur. Aldrig under insatsen. */
export function luckPayout(stake, mult, factor = 1) {
  const sats = Math.max(0, Number(stake) || 0);
  const m = Number(mult) || 0;
  if (!(m > 1)) return 0; // ingen vinstrad → ingen utbetalning
  const f = Math.min(LUCK_MAX, Math.max(LUCK_MIN, Number(factor) || 1));
  const raw = sats + sats * (m - 1) * f;
  return Math.max(Math.round(raw), Math.ceil(sats) + 1);
}

/** Samma sak men med två decimaler (sportspel). */
export function luckPayout2(stake, mult, factor = 1) {
  const sats = Math.max(0, Number(stake) || 0);
  const m = Number(mult) || 0;
  if (!(m > 1)) return 0;
  const f = Math.min(LUCK_MAX, Math.max(LUCK_MIN, Number(factor) || 1));
  const raw = sats + sats * (m - 1) * f;
  return Math.max(Math.round(raw * 100) / 100, Math.round(sats * 1.01 * 100) / 100);
}

export const luckText = (factor) => '×' + Number(factor).toFixed(2).replace('.', ',');

export function luckLabel(factor) {
  if (factor >= 1.03) return `Tur ${luckText(factor)} · du har lite kvar`;
  if (factor <= 0.97) return `Tur ${luckText(factor)} · du har vunnit mycket`;
  return `Tur ${luckText(factor)} · jämnt läge`;
}

export function luckTone(factor) {
  if (factor >= 1.03) return 'luck-pill--up';
  if (factor <= 0.97) return 'luck-pill--down';
  return 'luck-pill--flat';
}

/** Litet märke som visas i spelen. */
export function luckPill(factor = currentLuck()) {
  return `<span class="luck-pill ${luckTone(factor)}" data-luck="${factor}">
    <span class="luck-pill__dot"></span>${luckLabel(factor)}</span>`;
}
