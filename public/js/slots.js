/* =====================================================================
   Star Fortune – 5 hjul, 3 rader, 20 vinstlinjer.
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, num, sleep, navigate, openModal, updateBalanceUI, guardRound } from './core.js';
import {
  currentLuck, clampLuckSetting, luckPayout, machineLuckPill, luckLevelName, settingLuck, watchLuck
} from './luck.js';

const SYMBOLS = {
  wild: { glyph: '★', cls: 'sym--star', weight: 2, name: 'Stjärna (joker)' },
  seven: { glyph: '7', cls: 'sym--seven', weight: 4, name: 'Sjua' },
  diamond: { glyph: '💎', cls: 'sym--diamond', weight: 5, name: 'Diamant' },
  bell: { glyph: '🔔', cls: '', weight: 6, name: 'Klocka' },
  bar: { glyph: 'BAR', cls: 'sym--bar', weight: 6, name: 'Bar' },
  melon: { glyph: '🍉', cls: '', weight: 8, name: 'Melon' },
  plum: { glyph: '🍇', cls: '', weight: 9, name: 'Plommon' },
  cherry: { glyph: '🍒', cls: '', weight: 10, name: 'Körsbär' }
};

/* Vinsttabell: multiplar av total insats för 3 / 4 / 5 i rad från vänster.
   Varje vinst ger minst 1,4× insatsen – en vinst ska alltid ge plus.
   Låga symboler kräver fyra i rad, annars blir de för små vinster. */
const PAYTABLE = {
  wild: { 3: 4.5, 4: 21, 5: 85 },
  seven: { 3: 2.3, 4: 8.5, 5: 42 },
  diamond: { 3: 1.9, 4: 5.2, 5: 23 },
  bell: { 3: 1.45, 4: 3.7, 5: 14 },
  bar: { 4: 3.2, 5: 12.5 },
  melon: { 4: 2.5, 5: 8.5 },
  plum: { 4: 2.1, 5: 6.8 },
  cherry: { 4: 1.65, 5: 5.2 }
};

const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 1, 0, 0, 0],
  [1, 1, 2, 2, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [0, 2, 0, 2, 0]
];

/** Vinsttabellerna delas med adminpanelens spel-ekonomi (economy.js). */
export const SLOT_MATH = { SYMBOLS, PAYTABLE, PAYLINES };

const WEIGHTED = Object.entries(SYMBOLS).flatMap(([key, s]) => Array(s.weight).fill(key));

const REELS = 5;
const ROWS = 3;

const game = {
  bet: 20,
  grid: [],
  spinning: false,
  auto: 0,
  lastWin: 0,
  winLines: [],
  muted: false
};

/* En snurr får inte avbrytas av en omladdning – insatsen är redan dragen. */
guardRound(() => state.route.name === 'slots' && game.spinning);

function randomSymbol() {
  return WEIGHTED[Math.floor(Math.random() * WEIGHTED.length)];
}

function randomGrid() {
  return Array.from({ length: REELS }, () => Array.from({ length: ROWS }, randomSymbol));
}

function luck() {
  return clampLuckSetting(state.settings.slotLuck);
}

const shortLuckText = (value) => '×' + Number(value).toFixed(2).replace('.', ',');

/* Turmärket ska visa adminens nivå direkt när den ändras. */
watchLuck();

export function evaluate(grid, bet, factor = 1) {
  const lines = [];
  let total = 0;

  PAYLINES.forEach((line, lineIndex) => {
    const symbols = line.map((row, reel) => grid[reel][row]);
    let base = symbols[0];
    if (base === 'wild') {
      const next = symbols.find((s) => s !== 'wild');
      base = next || 'wild';
    }
    let count = 0;
    for (let i = 0; i < REELS; i++) {
      if (symbols[i] === base || symbols[i] === 'wild') count++;
      else break;
    }
    if (count < 3) return;
    const mult = PAYTABLE[base]?.[count];
    if (!mult) return;
    const win = luckPayout(bet, mult * luck(), factor);
    if (win <= 0) return;
    total += win;
    lines.push({
      line: lineIndex + 1,
      symbol: base,
      count,
      win,
      cells: line.slice(0, count).map((row, reel) => ({ reel, row }))
    });
  });

  return { total, lines };
}

/* ------------------------------ Rendering ------------------------------ */

function symbolHTML(key) {
  const s = SYMBOLS[key];
  return `<span class="sym ${s.cls}">${s.glyph}</span>`;
}

function cellHTML(key) {
  return `<div class="reel__cell" data-sym="${key}">${symbolHTML(key)}</div>`;
}

function renderMachine(root) {
  const maxBet = Number(state.settings.maxBet) || 500;
  const minBet = Number(state.settings.minBet) || 10;
  const step = Math.max(5, Math.round(minBet / 2));
  const balance = state.player?.balance ?? 0;
  const bet = game.bet;

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Spelhallen</h1>
          <p>Star Fortune · 5 hjul · 20 vinstlinjer</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--ghost" id="sl-home">← Spelhallen</button>
      </div>

      <div class="slot-machine">
        <div class="slot-title">Star Fortune</div>
        <div class="slot-sub">20 vinstlinjer · jokern ersätter alla symboler</div>
        <div class="luck-row" id="sl-luck" data-luck-cell="slotLuck">${machineLuckPill('slotLuck')}</div>

        <div class="reels" id="reels"></div>
        <div class="win-lines" id="win-lines"></div>

        <div class="slot-hud">
          <button class="btn btn--sm btn--ghost" id="sl-info">INFO</button>

          <div class="slot-box">
            <span class="slot-box__label">Vinst</span>
            <span class="slot-box__value" id="sl-win">0 kr</span>
          </div>

          <div class="slot-box">
            <span class="slot-box__label">Insats</span>
            <div class="bet-stepper">
              <button class="stepper-btn" id="sl-minus" aria-label="Minska insats">−</button>
              <input class="bet-field__input bet-field__input--slot" id="sl-bet" type="number" inputmode="numeric"
                     min="${minBet}" max="${Math.max(minBet, Math.min(balance, maxBet))}" step="${step}" value="${bet}" />
              <button class="stepper-btn" id="sl-plus" aria-label="Öka insats">+</button>
            </div>
          </div>

          <div class="row" style="gap:8px">
            <div class="slot-controls">
              <button class="btn btn--sm btn--ghost" id="sl-auto">AUTO<br>SPEL</button>
              <button class="spin-btn" id="sl-spin">
                <span class="spin-btn__icon">⟳</span>
                <span>SNURRA</span>
              </button>
            </div>
          </div>
        </div>

        <div class="row row--between" style="margin-top:14px;flex-wrap:wrap;gap:10px">
          <span class="mini-pill">Saldo <strong>${kr(state.player?.balance ?? 0)}</strong></span>
          <span class="mini-pill">Min <strong>${kr(minBet)}</strong></span>
          <span class="mini-pill">Max <strong>${kr(maxBet)}</strong></span>
          <span class="mini-pill" id="sl-auto-state">Autospel: av</span>
        </div>
      </div>
    </div>`;

  const reelsEl = root.querySelector('#reels');
  reelsEl.innerHTML = Array.from({ length: REELS }, (_, i) => `
    <div class="reel" data-reel="${i}"><div class="reel__strip"></div></div>`).join('');

  game.grid = randomGrid();
  paintGrid(root);

  root.querySelector('#sl-home').addEventListener('click', () => {
    game.auto = 0;
    navigate('/kasino');
  });
  root.querySelector('#sl-info').addEventListener('click', () => showInfo(root));
  const betField = root.querySelector('#sl-bet');
  const setBet = (value) => {
    game.bet = Math.max(minBet, Math.min(Math.round(value), maxBet, state.player?.balance ?? maxBet));
    if (betField) betField.value = game.bet;
  };

  root.querySelector('#sl-minus').addEventListener('click', () => {
    setBet(game.bet - step);
    sfx.click();
  });
  root.querySelector('#sl-plus').addEventListener('click', () => {
    setBet(game.bet + step);
    sfx.chip();
  });
  betField.addEventListener('change', () => {
    setBet(Number(betField.value) || minBet);
    sfx.click();
  });
  root.querySelector('#sl-spin').addEventListener('click', () => {
    if (game.auto > 0) {
      game.auto = 0;
      updateAutoLabel(root);
      toast('Autospel stoppat');
      return;
    }
    spin(root);
  });
  root.querySelector('#sl-auto').addEventListener('click', () => {
    if (game.spinning) return;
    game.auto = game.auto > 0 ? 0 : 10;
    updateAutoLabel(root);
    if (game.auto > 0) spin(root);
  });

  document.onkeydown = (e) => {
    if (!document.body.classList.contains('theme-casino')) return;
    if (document.querySelector('.modal-backdrop')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!game.spinning) spin(root);
    }
  };
}

function updateAutoLabel(root) {
  const el = root.querySelector('#sl-auto-state');
  if (el) el.textContent = 'Autospel: ' + (game.auto > 0 ? game.auto + ' kvar' : 'av');
  const btn = root.querySelector('#sl-auto');
  if (btn) btn.classList.toggle('btn--primary', game.auto > 0);
}

function paintGrid(root, wins = []) {
  const reels = root.querySelectorAll('.reel');
  const winSet = new Set();
  wins.forEach((w) => w.cells.forEach((c) => winSet.add(c.reel + ':' + c.row)));

  reels.forEach((reel, r) => {
    const strip = reel.querySelector('.reel__strip');
    strip.innerHTML = game.grid[r].map((sym, row) =>
      `<div class="reel__cell ${winSet.has(r + ':' + row) ? 'is-win' : ''}" data-sym="${sym}">${symbolHTML(sym)}</div>`
    ).join('');
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
  });
}

async function spin(root) {
  if (game.spinning) return;
  const bet = game.bet;
  const balance = state.player?.balance ?? 0;
  if (bet > balance) {
    toast('Inte tillräckligt med spelmynt – ta en bonus!', 'bad');
    game.auto = 0;
    updateAutoLabel(root);
    return;
  }
  if (bet < (Number(state.settings.minBet) || 10)) {
    toast('Insatsen är för låg', 'bad');
    return;
  }

  const factor = currentLuck();
  game.spinning = true;
  const spinBtn = root.querySelector('#sl-spin');
  spinBtn.disabled = true;
  root.querySelector('#win-lines').innerHTML = '';
  root.querySelector('#sl-win').textContent = '0 kr';
  root.querySelector('#sl-win').classList.remove('is-win');

  try {
    await api.bet('slots', bet);
    updateBalanceUI();
  } catch (err) {
    toast(err.message, 'bad');
    game.spinning = false;
    spinBtn.disabled = false;
    return;
  }

  const finalGrid = randomGrid();
  const reels = Array.from(root.querySelectorAll('.reel'));
  const cellH = reels[0].querySelector('.reel__cell')?.offsetHeight || 96;

  const durations = [1000, 1150, 1300, 1450, 1600];

  reels.forEach((reel, i) => {
    const strip = reel.querySelector('.reel__strip');
    const filler = Array.from({ length: 12 }, randomSymbol);
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
    strip.innerHTML =
      filler.map(cellHTML).join('') + finalGrid[i].map(cellHTML).join('');

    requestAnimationFrame(() => {
      strip.style.transition = `transform ${durations[i]}ms cubic-bezier(.12,.72,.2,1)`;
      strip.style.transform = `translateY(-${12 * cellH}px)`;
    });

    const tick = setInterval(() => sfx.spin(), 90);
    setTimeout(() => clearInterval(tick), durations[i]);
  });

  const longest = durations[durations.length - 1] + 120;
  await sleep(longest);

  game.grid = finalGrid;
  const result = evaluate(finalGrid, bet, factor);
  game.lastWin = result.total;
  game.winLines = result.lines;

  paintGrid(root, result.lines);

  const winEl = root.querySelector('#sl-win');
  winEl.textContent = kr(result.total);
  if (result.total > 0) winEl.classList.add('is-win');

  root.querySelector('#win-lines').innerHTML = [
    result.total > 0
      ? `<span class="chip chip--mint">Netto +${kr(result.total - bet)}</span>`
      : '',
    ...result.lines
      .slice(0, 8)
      .map((l) => `<span class="chip">Linje ${l.line} · ${l.count}×${SYMBOLS[l.symbol].glyph} · ${kr(l.win)}</span>`)
  ].join('');

  if (result.total > 0) {
    let saved = true;
    try {
      await api.credit('slots', result.total);
      updateBalanceUI();
    } catch (err) {
      saved = false;
      toast(`Vinsten på ${kr(result.total)} kunde inte sparas – försök igen`, 'bad', 6000);
      console.error('Kunde inte kreditera vinsten:', err);
    }
    if (saved) {
      if (result.total >= bet * 10) sfx.bigWin();
      else sfx.win();
      if (result.total >= bet * 15) toast(`STORVINST! ${kr(result.total)}`, 'gold', 3200);
    }
  } else {
    sfx.lose();
  }

  const luckEl = root.querySelector('#sl-luck');
  if (luckEl) luckEl.innerHTML = machineLuckPill('slotLuck');

  const balanceEl = root.querySelector('.mini-pill strong');
  if (balanceEl) balanceEl.textContent = kr(state.player?.balance ?? 0);

  game.spinning = false;
  spinBtn.disabled = false;

  if (game.auto > 0) {
    game.auto -= 1;
    updateAutoLabel(root);
    if (game.auto > 0) {
      await sleep(700);
      spin(root);
    } else {
      toast('Autospel klart');
    }
  }
}

function showInfo(root) {
  sfx.click();
  const rows = Object.entries(PAYTABLE)
    .map(([key, pays]) => {
      const s = SYMBOLS[key];
      const cell = (n) => (pays[n] ? `${pays[n]}×` : '–');
      return `<tr>
        <td style="font-size:20px">${symbolHTML(key)}</td>
        <td class="num">${cell(5)}</td>
        <td class="num">${cell(4)}</td>
        <td class="num">${cell(3)}</td>
      </tr>`;
    })
    .join('');

  openModal({
    title: 'Star Fortune – vinsttabell',
    sub: 'Vinsterna räknas från vänster till höger på 20 fasta linjer. Summorna är multiplar av insatsen.',
    wide: true,
    body: `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Symbol</th><th>5 i rad</th><th>4 i rad</th><th>3 i rad</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="tiny muted" style="margin-top:14px">★ Stjärnan är joker och ersätter alla symboler. Allt spelas med spelmynt – aldrig riktiga pengar.</p>
      <div class="disclaimer" style="margin-top:12px"><span>🍀</span><div>
        Gällande tur: <strong>${shortLuckText(settingLuck('slotLuck'))}</strong>
        ${luckLevelName(settingLuck('slotLuck')) ? `(${luckLevelName(settingLuck('slotLuck'))})` : '(egen nivå)'}
        – den multiplicerar varje vinst. Admin kan ändra den i panelen.</div></div>`,
    actions: [{ label: 'Stäng' }]
  });
}

registerView('slots', (root) => {
  if (!game.bet) game.bet = Number(state.settings.minBet) || 20;
  renderMachine(root);
});
