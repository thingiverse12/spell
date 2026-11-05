/* =====================================================================
   Skraplotter – köp ett lott och skrapa fram tre lika belopp.
   Vinstbeloppet räknas ut på samma sätt som i de andra spelen:
   insatsen plus (multipel − 1) × insatsen × tur, så en vinst ger
   alltid mer än lotten kostade.
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, navigate, openModal, updateBalanceUI, guardRound } from './core.js';
import {
  currentLuck, clampLuckSetting, luckPayout, machineLuckPill, watchLuck
} from './luck.js';

/* Vinsttrappan: multiplar av lottpriset och hur många av 10 000 lott
   som ger respektive nivå. Resten är nitlott. */
const TIERS = [
  { mult: 1.5, weight: 2400 },
  { mult: 2.5, weight: 800 },
  { mult: 4, weight: 300 },
  { mult: 8, weight: 120 },
  { mult: 20, weight: 40 },
  { mult: 50, weight: 8 }
];
const NO_WIN_WEIGHT = 6332;
const TOTAL_WEIGHT = TIERS.reduce((sum, tier) => sum + tier.weight, 0) + NO_WIN_WEIGHT;

/** Vinsttrappan delas med adminpanelens spel-ekonomi (economy.js). */
export const SCRATCH_MATH = { TIERS, NO_WIN_WEIGHT, TOTAL_WEIGHT };

const CELLS = 9;
const PRICES = [10, 20, 50, 100, 250, 500];
const DECOY_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

const game = {
  price: 0,
  card: null,
  revealed: new Set(),
  done: false,
  settling: false,
  busy: false,
  scratchTick: 0
};

/* Statistik som hunnit hända sedan spelaren hämtades från servern –
   så att panelen räknar upp direkt i stället för vid nästa omladdning. */
const session = { rounds: 0, won: 0, best: 0 };

/* Ett köpt men oskrapat lott får inte försvinna vid omladdning – och inte
   heller en vinst som är på väg att betalas ut. */
guardRound(
  () => state.route.name === 'scratch' && !!game.card && (!game.done || game.settling)
);

/* ------------------------------ Lottet ------------------------------ */

function luck() {
  return clampLuckSetting(state.settings.scratchLuck);
}

/* Turmärket följer adminens nivå direkt. */
watchLuck();

function drawTier() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const tier of TIERS) {
    roll -= tier.weight;
    if (roll < 0) return tier;
  }
  return null;
}

/** Snygga belopp – inga ören på ett skraplott. */
function niceAmount(value) {
  const v = Math.max(1, Math.round(value));
  if (v >= 100) return Math.round(v / 10) * 10;
  if (v >= 50) return Math.round(v / 5) * 5;
  return v;
}

/** Övriga rutor: samma belopp får högst dyka upp två gånger. */
function decoyAmounts(price, count, avoid = []) {
  const pool = Array.from(new Set(DECOY_STEPS.map((step) => niceAmount(price * step)))).filter(
    (value) => !avoid.includes(value)
  );
  const out = [];
  let guard = 0;
  while (out.length < count && guard < 800 && pool.length) {
    guard += 1;
    const value = pool[Math.floor(Math.random() * pool.length)];
    if (out.filter((x) => x === value).length >= 2) continue;
    out.push(value);
  }
  while (out.length < count && pool.length) out.push(pool[out.length % pool.length]);
  return out;
}

export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Snygga vinstbelopp på lotten – inga udda kronor. */
function nicePrize(amount) {
  const value = Math.max(1, Math.round(amount));
  return value >= 100 ? Math.round(value / 5) * 5 : value;
}

/** Bygger ett lott. Vinsten bestäms innan spelaren skrapar. */
export function buildCard(price, factor = 1) {
  const tier = drawTier();
  if (!tier) {
    return { price, win: 0, mult: 0, cells: shuffle(decoyAmounts(price, CELLS)) };
  }
  const win = nicePrize(luckPayout(price, tier.mult * luck(), factor));
  const decoys = decoyAmounts(price, CELLS - 3, [win]);
  return { price, win, mult: tier.mult, cells: shuffle([win, win, win, ...decoys]) };
}

/* ------------------------------ Priser ------------------------------ */

function ticketPrices() {
  const min = Math.max(1, Number(state.settings.minBet) || 10);
  const max = Math.max(min, Number(state.settings.maxBet) || 500);
  const list = PRICES.filter((price) => price >= min && price <= max);
  // Finns inget standardpris inom gränserna används minsta insatsen.
  return list.length ? list : [min];
}

/* ------------------------------ Rendering ------------------------------ */

function cellHTML(amount, index, opened, winning = false) {
  return `<button class="scratch-cell ${opened ? 'is-open' : 'is-covered'} ${winning ? 'is-win' : ''}"
      data-cell="${index}" type="button" aria-label="Ruta ${index + 1}">
    <span class="scratch-cell__prize">${kr(amount)}</span>
    <span class="scratch-cell__foil" aria-hidden="true"><span>SKRAPA</span></span>
  </button>`;
}

function gridHTML(card, opened = new Set()) {
  if (!card) {
    return Array.from({ length: CELLS }, (_, i) => `
      <div class="scratch-cell is-locked" aria-hidden="true">
        <span class="scratch-cell__prize">?</span>
        <span class="scratch-cell__foil"><span>?</span></span>
      </div>`).join('');
  }
  const winning = game.done && card.win > 0 ? card.win : 0;
  return card.cells
    .map((amount, i) => cellHTML(amount, i, opened.has(i), winning > 0 && amount === winning))
    .join('');
}

function stats() {
  const s = (state.player && state.player.gameStats && state.player.gameStats.scratch) || {};
  return {
    rounds: (Number(s.rounds) || 0) + session.rounds,
    won: (Number(s.won) || 0) + session.won,
    best: Math.max(Number(s.best) || 0, session.best)
  };
}

function resultHTML() {
  if (!game.card || !game.done) return '';
  const { win, price } = game.card;
  if (win > 0) {
    return `<div class="scratch-result is-win">
      <span class="scratch-result__label">Tre lika – vinst!</span>
      <strong class="scratch-result__amount">${kr(win)}</strong>
      <span class="scratch-result__net">Netto +${kr(win - price)} efter ${kr(price)} i insats</span>
    </div>`;
  }
  return `<div class="scratch-result is-loss">
    <span class="scratch-result__label">Ingen vinst den här lotten</span>
    <span class="scratch-result__net">Lotteriet kostade ${kr(price)} – prova ett till.</span>
  </div>`;
}

/* Hela saldot som lottpris – man får satsa allt, upp till taket. */
function allInPrice() {
  const balance = Math.max(0, state.player?.balance ?? 0);
  const max = Math.min(1000000000000000, Math.max(0, Number(state.settings.maxBet) || 0));
  return Math.round(Math.min(balance, max));
}

function renderScratch(root) {
  const prices = ticketPrices();
  const allIn = allInPrice();
  const price = game.price || prices[0];
  const balance = state.player?.balance ?? 0;
  const st = stats();
  const scratching = !!game.card && !game.done;
  const opened = game.revealed;

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Skraplotter</h1>
          <p>Tre lika belopp ger vinst · spelmynt, aldrig riktiga pengar</p>
        </div>
        <div style="flex:1"></div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn--sm btn--ghost" id="sc-info">Så funkar det</button>
          <button class="btn btn--sm btn--ghost" id="sc-home">← Spelhallen</button>
        </div>
      </div>

      <div class="scratch-layout">
        <div class="scratch-card">
          <div class="scratch-card__head">
            <div>
              <span class="scratch-card__kicker">Lott</span>
              <strong class="scratch-card__price">${kr(price)}</strong>
            </div>
            <span class="scratch-card__tag">${game.card ? (game.done ? 'Skrapad' : 'Skrapa!') : 'Ej köpt'}</span>
          </div>

          <div class="scratch-grid ${scratching ? 'is-live' : ''}" id="scratch-grid">
            ${gridHTML(game.card, opened)}
          </div>

          <p class="scratch-card__rule">Hitta <strong>tre lika belopp</strong> – då vinner du det beloppet.</p>

          ${resultHTML()}

          <div class="scratch-actions">
            ${
              !game.card
                ? `<button class="btn btn--primary scratch-buy" id="sc-buy" ${price > balance ? 'disabled' : ''}>
                    Köp lott för ${kr(price)}
                  </button>`
                : scratching
                  ? `<button class="btn btn--ghost" id="sc-all">Skrapa alla rutor</button>`
                  : `<button class="btn btn--primary scratch-buy" id="sc-buy" ${price > balance ? 'disabled' : ''}>
                      Köp nytt lott för ${kr(price)}
                    </button>`
            }
          </div>
        </div>

        <aside class="scratch-side">
          <div class="scratch-panel">
            <span class="scratch-panel__label">Lottpris</span>
            <div class="scratch-prices" id="sc-prices">
              ${prices
                .map(
                  (p) => `<button class="scratch-price ${p === price ? 'is-active' : ''}" data-price="${p}" type="button"
                    ${p > balance ? 'title="Du har inte tillräckligt med spelmynt"' : ''}>${kr(p)}</button>`
                )
                .join('')}
              ${
                allIn > 0 && !prices.includes(allIn)
                  ? `<button class="scratch-price ${allIn === price ? 'is-active' : ''}" data-price="${allIn}" type="button"
                      title="Spela om hela saldot på ett lott">Allt in · ${kr(allIn)}</button>`
                  : ''
              }
            </div>
            <p class="tiny muted" style="margin-top:8px">Vinsten räknas på lottpriset – ett dyrare lott ger större belopp.</p>
          </div>

          <div class="scratch-panel">
            <span class="scratch-panel__label">Tur</span>
            <div id="sc-luck" data-luck-cell="scratchLuck">${machineLuckPill('scratchLuck')}</div>
            <p class="tiny muted" style="margin-top:8px">Turen är adminens nivå gånger gummibandet – har du lite kvar på kontot blir vinsterna större.</p>
          </div>

          <div class="scratch-panel">
            <span class="scratch-panel__label">Dina skraplotter</span>
            <div class="scratch-stats">
              <div><strong>${st.rounds}</strong><span>köpta</span></div>
              <div><strong>${kr(st.won)}</strong><span>vunnet</span></div>
              <div><strong>${kr(st.best)}</strong><span>bästa</span></div>
            </div>
          </div>

          <div class="scratch-panel">
            <span class="scratch-panel__label">Saldo</span>
            <strong class="scratch-balance">${kr(balance)}</strong>
            <p class="tiny muted" style="margin-top:6px">Fyll på genom att plugga eller ta bonusen i spelhallen.</p>
          </div>
        </aside>
      </div>
    </div>`;

  root.querySelector('#sc-home').addEventListener('click', () => navigate('/kasino'));
  root.querySelector('#sc-info').addEventListener('click', () => showInfo());

  root.querySelectorAll('[data-price]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (game.card && !game.done) {
        toast('Skrapa klart lotten först', 'bad');
        return;
      }
      game.price = Number(btn.dataset.price) || prices[0];
      // Ett färdigskrapat lott hör till sitt pris – nollställ när priset byts.
      if (game.done) {
        game.card = null;
        game.done = false;
        game.revealed = new Set();
      }
      sfx.click();
      renderScratch(root);
    });
  });

  const buyBtn = root.querySelector('#sc-buy');
  if (buyBtn) buyBtn.addEventListener('click', () => buy(root, price));

  const allBtn = root.querySelector('#sc-all');
  if (allBtn) allBtn.addEventListener('click', () => scratchAll(root));

  setupScratch(root);
  document.onkeydown = null;
}

/* ------------------------------ Skrapa ------------------------------ */

function setupScratch(root) {
  const grid = root.querySelector('#scratch-grid');
  if (!grid || !grid.classList.contains('is-live')) return;

  let pressed = false;

  const revealAt = (target) => {
    const cell = target && target.closest ? target.closest('.scratch-cell') : null;
    if (!cell || !cell.dataset.cell) return;
    reveal(root, Number(cell.dataset.cell), cell);
  };

  grid.addEventListener('pointerdown', (event) => {
    pressed = true;
    revealAt(event.target);
  });
  grid.addEventListener('pointermove', (event) => {
    if (!pressed || event.buttons === 0) return;
    revealAt(event.target);
  });
  grid.addEventListener('pointerup', () => {
    pressed = false;
  });
  grid.addEventListener('pointercancel', () => {
    pressed = false;
  });
  grid.addEventListener('pointerleave', () => {
    pressed = false;
  });
  // Tangentbord: ruta är en knapp, så Enter/mellanslag skickar click.
  grid.addEventListener('click', (event) => revealAt(event.target));
}

function reveal(root, index, cell) {
  if (!game.card || game.done) return;
  if (game.revealed.has(index)) return;
  game.revealed.add(index);
  if (cell) {
    cell.classList.remove('is-covered');
    cell.classList.add('is-open');
  }
  game.scratchTick += 1;
  if (game.scratchTick % 3 === 1) sfx.click();

  if (game.revealed.size >= CELLS) {
    window.setTimeout(() => settle(root), 380);
  }
}

function scratchAll(root) {
  if (!game.card || game.done) return;
  const cells = Array.from(root.querySelectorAll('.scratch-cell[data-cell]'));
  cells.forEach((cell, i) => {
    const index = Number(cell.dataset.cell);
    if (game.revealed.has(index)) return;
    window.setTimeout(() => reveal(root, index, cell), i * 70);
  });
}

/* ------------------------------ Spela ------------------------------ */

async function buy(root, price) {
  if (game.busy) return;
  const balance = state.player?.balance ?? 0;
  if (price > balance) {
    toast('Inte tillräckligt med spelmynt – ta en bonus!', 'bad');
    return;
  }
  game.busy = true;
  try {
    await api.bet('scratch', price);
  } catch (err) {
    toast(err.message, 'bad');
    game.busy = false;
    return;
  }

  game.price = price;
  game.card = buildCard(price, currentLuck());
  game.revealed = new Set();
  game.done = false;
  game.busy = false;
  game.scratchTick = 0;
  session.rounds += 1;
  updateBalanceUI();
  sfx.chip();
  renderScratch(root);
  toast('Lott köpt – skrapa fram tre lika!', 'gold');
}

async function settle(root) {
  if (!game.card || game.done) return;
  game.done = true;
  game.settling = true;
  const { win, price } = game.card;

  if (win > 0) {
    try {
      await api.credit('scratch', win);
    } catch (err) {
      toast(err.message, 'bad');
    }
    session.won += win;
    session.best = Math.max(session.best, win);
    updateBalanceUI();
    if (win >= price * 10) sfx.bigWin();
    else sfx.win();
    if (win >= price * 10) toast(`STORVINST! ${kr(win)}`, 'gold', 3200);
    else toast(`Vinst: ${kr(win)} (+${kr(win - price)} netto)`, 'gold');
  } else {
    sfx.lose();
  }

  game.settling = false;
  renderScratch(root);
}

/* ------------------------------ Info ------------------------------ */

function showInfo() {
  sfx.click();
  const rows = TIERS.map(
    (tier) => `<tr>
      <td>${String(tier.mult).replace('.', ',')}× lottpriset</td>
      <td class="num">${(tier.weight / 100).toFixed(tier.weight < 100 ? 2 : 0).replace('.', ',')} %</td>
    </tr>`
  ).join('');
  const hitRate = ((TOTAL_WEIGHT - NO_WIN_WEIGHT) / TOTAL_WEIGHT) * 100;

  openModal({
    title: 'Skraplotter – så funkar det',
    sub: 'Du köper ett lott för spelmynt och skrapar de nio rutorna. Tre lika belopp ger vinst.',
    wide: true,
    body: `<ol class="scratch-rules">
        <li>Välj lottpris och tryck <strong>Köp lott</strong>. Insatsen dras direkt.</li>
        <li>Skrapa rutorna med musen eller fingret – dra över flera rutor på en gång.</li>
        <li>Hittar du tre lika belopp vinner du det beloppet, alltid mer än lotten kostade.</li>
      </ol>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Vinstnivå</th><th>Chans per lott</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="tiny muted" style="margin-top:14px">
        ${hitRate.toFixed(1).replace('.', ',')} % av lotterna ger vinst. Beloppen räknas på lottpriset och påverkas av
        turen (gummibandet) precis som i de andra spelen. Allt spelas med spelmynt – aldrig riktiga pengar.
      </p>`,
    actions: [{ label: 'Stäng' }]
  });
}

registerView('scratch', (root) => {
  if (!game.price) game.price = ticketPrices()[0];
  renderScratch(root);
});
