/* =====================================================================
   Spel-ekonomi – adminpanelen räknar ut vad spelen faktiskt betalar ut.

   Allt räknas med spelets egna vinsttabeller (slots.js och scratch.js)
   och gummibandets formel (luck.js), så panelen kan inte visa en annan
   siffra än den spelet använder. Marginal = husets andel av varje
   satsad spelmynt; negativ marginal betyder att spelaren har övertag.
   ===================================================================== */

import { state, kr, num } from './core.js';
import { luckFactor, luckPayout, LUCK_MIN, LUCK_MAX } from './luck.js';
import { SLOT_MATH } from './slots.js';
import { SCRATCH_MATH } from './scratch.js';

const clampLuck = (value) => Math.min(1.5, Math.max(0.5, Number(value) || 1));
const pct = (value, digits = 1) =>
  `${Number(value).toFixed(digits).replace('.', ',').replace('-', '−')} %`;
const luckText = (factor) => '×' + Number(factor).toFixed(2).replace('.', ',');

/* ------------------------------ slots ------------------------------ */

const SYM_KEYS = Object.keys(SLOT_MATH.SYMBOLS);
const WEIGHTS = SYM_KEYS.map((key) => SLOT_MATH.SYMBOLS[key].weight);
const WEIGHT_SUM = WEIGHTS.reduce((a, b) => a + b, 0);
const SYM_P = WEIGHTS.map((w) => w / WEIGHT_SUM);

/** Multiplikator för en vinstrad – samma regel som evaluate() i slots.js. */
function lineMultiplier(symbols) {
  let base = symbols[0];
  if (base === 'wild') base = symbols.find((s) => s !== 'wild') || 'wild';
  let count = 0;
  for (let i = 0; i < symbols.length; i += 1) {
    if (symbols[i] === base || symbols[i] === 'wild') count += 1;
    else break;
  }
  if (count < 3) return 0;
  return SLOT_MATH.PAYTABLE[base]?.[count] || 0;
}

/* Fördelningen över en enskild vinstlinje räknas ut en gång
   (8^5 = 32 768 kombinationer) och återanvänds sedan. */
let dist = null;
function lineDist() {
  if (dist) return dist;
  const out = [];
  const symbols = [];
  const walk = (depth, prob) => {
    if (depth === 5) {
      const mult = lineMultiplier(symbols);
      if (mult) out.push({ mult, prob });
      return;
    }
    for (let i = 0; i < SYM_KEYS.length; i += 1) {
      symbols.push(SYM_KEYS[i]);
      walk(depth + 1, prob * SYM_P[i]);
      symbols.pop();
    }
  };
  walk(0, 1);
  dist = out;
  return dist;
}

export function slotRtp(luckSetting, factor = 1, bet = 100) {
  const luck = clampLuck(luckSetting);
  let ev = 0;
  for (const line of lineDist()) {
    ev += line.prob * luckPayout(bet, line.mult * luck, factor);
  }
  ev *= SLOT_MATH.PAYLINES.length;
  return (ev / bet) * 100;
}

/* ---------------------------- skraplotter ---------------------------- */

export function scratchRtp(luckSetting, factor = 1, bet = 100) {
  const luck = clampLuck(luckSetting);
  let ev = 0;
  for (const tier of SCRATCH_MATH.TIERS) {
    ev += (tier.weight / SCRATCH_MATH.TOTAL_WEIGHT) * luckPayout(bet, tier.mult * luck, factor);
  }
  return (ev / bet) * 100;
}

/** Den tur-nivå som ger en viss RTP (RTP ökar hela vägen med turen). */
export function luckForRtp(rtpFn, target = 100) {
  let lo = 0.2;
  let hi = 2.5;
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2;
    if (rtpFn(mid, 1, 100) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ----------------------------- simulering ----------------------------- */

const WEIGHTED = SYM_KEYS.flatMap((key, i) => Array(WEIGHTS[i]).fill(key));
const randomSymbol = () => WEIGHTED[Math.floor(Math.random() * WEIGHTED.length)];

export function spinSlots(luckSetting, factor, bet) {
  const luck = clampLuck(luckSetting);
  const grid = Array.from({ length: 5 }, () =>
    Array.from({ length: 3 }, randomSymbol)
  );
  let total = 0;
  for (const line of SLOT_MATH.PAYLINES) {
    const symbols = line.map((row, reel) => grid[reel][row]);
    const mult = lineMultiplier(symbols);
    if (!mult) continue;
    total += luckPayout(bet, mult * luck, factor);
  }
  return total;
}

/**
 * Snabbsimulering i webbläsaren: träffchans, största vinst, längsta nit-svit
 * och hur en spelkväll slutar. Gummibandet räknas om vid varje snurr.
 */
export function runSimulation({ spins = 20000, bet = 20, start = 2500, sessionSpins = 500 } = {}) {
  const settings = state.settings || {};
  const luck = settings.slotLuck;
  const band = settings.rubberBand !== false;
  const factorAt = (balance) => (band ? luckFactor(balance, settings.startBalance) : 1);

  let hits = 0;
  let staked = 0;
  let paid = 0;
  let best = 0;
  let streak = 0;
  let longestStreak = 0;
  for (let i = 0; i < spins; i += 1) {
    const win = spinSlots(luck, factorAt(start), bet);
    staked += bet;
    paid += win;
    if (win > 0) {
      hits += 1;
      streak = 0;
      if (win > best) best = win;
    } else {
      streak += 1;
      if (streak > longestStreak) longestStreak = streak;
    }
  }

  // 200 spelkvällar – vad blir kvar av startkapitalet?
  const sessions = 200;
  const spinsPerSession = sessionSpins;
  const ends = [];
  let busted = 0;
  for (let s = 0; s < sessions; s += 1) {
    let balance = start;
    for (let i = 0; i < spinsPerSession && balance >= bet; i += 1) {
      const factor = factorAt(balance);
      balance -= bet;
      balance += spinSlots(luck, factor, bet);
    }
    if (balance < bet) busted += 1;
    ends.push(balance);
  }
  ends.sort((a, b) => a - b);

  return {
    spins,
    bet,
    start,
    rtp: (paid / staked) * 100,
    hitRate: (hits / spins) * 100,
    best,
    longestStreak,
    median: ends[Math.floor(sessions / 2)],
    sessionSpins,
    busted: (busted / sessions) * 100,
    band
  };
}

/* ------------------------------- panel ------------------------------- */

function statRow(value, label, extra = '') {
  return `<div class="admin-stat">
      <div class="admin-stat__value">${value}</div>
      <div class="admin-stat__label">${label}</div>
      ${extra}
    </div>`;
}

export function renderEkonomi(content, root, data) {
  const s = data.settings || state.settings || {};
  const slotsLuck = clampLuck(s.slotLuck);
  const scratchLuck = clampLuck(s.scratchLuck);
  const band = s.rubberBand !== false;
  const start = Number(s.startBalance) || 2500;

  const slotRtpNow = slotRtp(slotsLuck, 1);
  const scratchRtpNow = scratchRtp(scratchLuck, 1);
  const slotEdge = 100 - slotRtpNow;
  const scratchEdge = 100 - scratchRtpNow;
  const breakEven = luckForRtp(slotRtp, 100);

  const bandSlot = band ? slotRtp(slotsLuck, LUCK_MAX) : slotRtpNow;
  const bandSlotLow = band ? slotRtp(slotsLuck, LUCK_MIN) : slotRtpNow;

  const levels = [...new Set([0.7, 1, 1.4, Number(slotsLuck.toFixed(2)), Number(scratchLuck.toFixed(2))])].sort(
    (a, b) => a - b
  );

  const levelRows = levels
    .map((level) => {
      const used = Math.abs(level - slotsLuck) < 0.001 || Math.abs(level - scratchLuck) < 0.001;
      const slot = slotRtp(level, 1);
      const scratch = scratchRtp(level, 1);
      return `<tr>
        <td><strong>${luckText(level)}</strong>${
          Math.abs(level - slotsLuck) < 0.001 ? ' <span class="chip-mini">slots</span>' : ''
        }${Math.abs(level - scratchLuck) < 0.001 ? ' <span class="chip-mini">lott</span>' : ''}</td>
        <td class="num">${pct(slot)}</td>
        <td class="num">${pct(100 - slot)}</td>
        <td class="num">${pct(scratch)}</td>
        <td class="num">${pct(100 - scratch)}</td>
        <td>${used ? '<span class="chip chip--mint">används</span>' : ''}</td>
      </tr>`;
    })
    .join('');

  const balances = [0, 500, 1000, 1500, 2000, 2500, 3750, 5000, 7500, 10000];
  const balanceRows = balances
    .map((balance) => {
      const factor = band ? luckFactor(balance, start) : 1;
      const slot = slotRtp(slotsLuck, factor);
      const scratch = scratchRtp(scratchLuck, factor);
      return `<tr>
        <td>${kr(balance)}${balance === start ? ' <span class="chip-mini">start</span>' : ''}</td>
        <td class="num">${luckText(factor)}</td>
        <td class="num">${pct(slot)}</td>
        <td class="num">${pct(100 - slot)}</td>
        <td class="num">${pct(scratch)}</td>
      </tr>`;
    })
    .join('');

  content.innerHTML = `
    <section class="economy">
      <div class="admin-hero economy__hero">
        <div class="admin-hero__icon">📊</div>
        <div style="flex:1;min-width:220px">
          <h2 style="font-size:18px">Spel-ekonomi</h2>
          <p class="small muted">Räknat på spelets egna vinsttabeller – hur mycket spelen betalar tillbaka
            vid varje tur-nivå och saldo. Allt är spelmynt utan värde.</p>
        </div>
        ${
          slotEdge < 0 || scratchEdge < 0
            ? '<span class="chip chip--amber">⚠ Spelarna har övertag just nu</span>'
            : '<span class="chip chip--mint">● Huset har marginal</span>'
        }
      </div>

      <div class="admin-stats">
        ${statRow(pct(slotRtpNow), 'Slots – RTP', `<div class="admin-stat__label">tur ${luckText(slotsLuck)}</div>`)}
        ${statRow(pct(slotEdge), 'Slots – marginal', `<div class="admin-stat__label">${
          slotEdge >= 0 ? 'husets andel' : 'spelarens övertag'
        }</div>`)}
        ${statRow(pct(scratchRtpNow), 'Skraplotter – RTP', `<div class="admin-stat__label">tur ${luckText(scratchLuck)}</div>`)}
        ${statRow(luckText(breakEven), 'Jämnt spel (slots)', '<div class="admin-stat__label">RTP 100 %</div>')}
      </div>

      <div class="economy__note">
        ${
          band
            ? `Gummibandet är <strong>på</strong>: slotsens RTP varierar mellan <strong>${pct(
                bandSlotLow
              )}</strong> vid stor hög och <strong>${pct(bandSlot)}</strong> när kontot nästan är tomt.`
            : 'Gummibandet är <strong>av</strong>: turen är alltid ×1,00, så RTP beror bara på tur-nivån.'
        }
        ${slotEdge < 0 ? ` Vid tur ${luckText(slotsLuck)} betalar slotsen ut mer än insatsen – mynten skapas ur tomma luften.` : ''}
      </div>

      <div class="table-shell" style="margin-top:16px">
        <div class="table-shell__bar"><h2>RTP per tur-nivå</h2><div class="spacer"></div>
          <span class="mini-pill">Avrundat till hela kronor</span></div>
        <div class="table-shell__body">
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr>
                <th>Tur-nivå</th><th>Slots RTP</th><th>Slots marginal</th>
                <th>Skraplotter RTP</th><th>Skraplotter marginal</th><th></th>
              </tr></thead>
              <tbody>${levelRows}</tbody>
            </table>
          </div>
          <p class="tiny muted" style="margin-top:10px">
            Marginal = husets andel av varje satsad krona (100 − RTP). Negativ marginal betyder att
            spelaren i snitt får tillbaka mer än hen satsar. Nivåerna väljs i
            <strong>Spelinställningar</strong>.
          </p>
        </div>
      </div>

      <div class="table-shell" style="margin-top:16px">
        <div class="table-shell__bar"><h2>Saldo och gummiband</h2><div class="spacer"></div>
          <span class="mini-pill">${band ? 'Gummiband på' : 'Gummiband av'}</span></div>
        <div class="table-shell__body">
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>Saldo</th><th>Tur</th><th>Slots RTP</th><th>Slots marginal</th><th>Skraplotter RTP</th></tr></thead>
              <tbody>${balanceRows}</tbody>
            </table>
          </div>
          <p class="tiny muted" style="margin-top:10px">
            Turen räknas om före varje snurr utifrån saldot jämfört med startbalansen (${kr(start)}).
          </p>
        </div>
      </div>

      <div class="table-shell" style="margin-top:16px">
        <div class="table-shell__bar"><h2>Prova själv</h2><div class="spacer"></div>
          <span class="mini-pill">Slumpas i din webbläsare</span></div>
        <div class="table-shell__body">
          <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">
            <button class="btn btn--sm btn--primary" id="economy-sim">Simulera 20 000 snurr</button>
            <span class="small muted">Slots, tur ${luckText(slotsLuck)}, insats ${kr(20)}, start ${kr(start)}.</span>
          </div>
          <div id="economy-sim-out" class="economy__out muted small">
            Tryck på knappen för att snurra 20 000 gånger och se hur spelet beter sig med de
            inställningar som gäller just nu.
          </div>
        </div>
      </div>
    </section>`;

  const button = content.querySelector('#economy-sim');
  const out = content.querySelector('#economy-sim-out');
  button.addEventListener('click', () => {
    button.disabled = true;
    out.innerHTML = '<p class="muted">Snurrar …</p>';
    setTimeout(() => {
      const result = runSimulation({ spins: 20000, bet: 20, start, sessionSpins: 500 });
      out.innerHTML = `
        <div class="economy__grid">
          <div><span class="economy__value">${pct(result.rtp)}</span><span class="economy__label">RTP i körningen</span></div>
          <div><span class="economy__value">${pct(result.hitRate)}</span><span class="economy__label">Träffchans</span></div>
          <div><span class="economy__value">${kr(result.best)}</span><span class="economy__label">Största vinst</span></div>
          <div><span class="economy__value">${num(result.longestStreak)}</span><span class="economy__label">Längsta nit-svit</span></div>
          <div><span class="economy__value">${kr(result.median)}</span><span class="economy__label">Median kvar efter ${num(result.sessionSpins)} snurr</span></div>
          <div><span class="economy__value">${pct(result.busted)}</span><span class="economy__label">Spelade slut på kontot</span></div>
        </div>
        <p class="tiny muted" style="margin-top:10px">
          ${num(result.spins)} snurr à ${kr(result.bet)} plus 200 spelkvällar à ${num(result.sessionSpins)} snurr från
          ${kr(result.start)}. ${result.band ? 'Gummibandet var på.' : 'Gummibandet var av.'}
          Siffrorna hoppar lite mellan körningarna – det är slumpen, inte inställningarna.
        </p>`;
      button.disabled = false;
      button.textContent = 'Simulera igen';
    }, 30);
  });
}
