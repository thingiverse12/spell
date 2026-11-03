/* =====================================================================
   Videopoker – Jacks or Better med hela kortleken.
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, num, sleep, navigate, openModal, updateBalanceUI, guardRound } from './core.js';
import {
  currentLuck, clampLuckSetting, luckPayout, machineLuckPill, refreshLuckPills, watchLuck
} from './luck.js';
import { cardHTML, newDeck, rankValue } from './cards.js';

/* Utbetalning i multiplar av insatsen. Lägsta vinsten ger 1,2× insatsen,
   så en vinst ger alltid mer än du satsade. */
const PAYS = [
  { key: 'royal', name: 'Royal flush', sv: 'Royal flush', mult: 250 },
  { key: 'straightFlush', name: 'Straight flush', sv: 'Straight flush', mult: 50 },
  { key: 'quads', name: 'Four of a kind', sv: 'Fyrtal', mult: 25 },
  { key: 'fullHouse', name: 'Full house', sv: 'Kåk', mult: 8 },
  { key: 'flush', name: 'Flush', sv: 'Färg', mult: 5 },
  { key: 'straight', name: 'Straight', sv: 'Stege', mult: 3.5 },
  { key: 'trips', name: 'Three of a kind', sv: 'Triss', mult: 2.5 },
  { key: 'twoPair', name: 'Two pair', sv: 'Två par', mult: 2 },
  { key: 'jacks', name: 'Jacks or better', sv: 'Par i knekt eller högre', mult: 1.2 }
];

const game = {
  bet: 20,
  deck: [],
  hand: [],
  held: new Set(),
  phase: 'betting', // betting | draw | done
  result: null,
  message: '',
  busy: false,
  luckFactor: 1
};

/* Turmärket ska visa adminens nivå direkt när den ändras. */
watchLuck();

export function evaluateHand(cards) {
  const ranks = cards.map((c) => rankValue(c.r)).sort((a, b) => a - b);
  const rawRanks = cards.map((c) => c.r);
  const suits = cards.map((c) => c.s);
  const isFlush = suits.every((s) => s === suits[0]);

  const uniq = [...new Set(ranks)].sort((a, b) => a - b);
  let isStraight = false;
  if (uniq.length === 5) {
    if (uniq[4] - uniq[0] === 4) isStraight = true;
    if (uniq.join(',') === '2,3,4,5,14') isStraight = true; // ess lågt
  }
  const isRoyal = isStraight && isFlush && uniq[0] === 10 && uniq[4] === 14;

  const counts = {};
  rawRanks.forEach((r) => (counts[r] = (counts[r] || 0) + 1));
  const groups = Object.entries(counts)
    .map(([r, n]) => ({ r, n }))
    .sort((a, b) => b.n - a.n || rankValue(b.r) - rankValue(a.r));

  const find = (key) => PAYS.find((p) => p.key === key);

  if (isRoyal) return { ...find('royal'), cards: cards.slice() };
  if (isStraight && isFlush) return { ...find('straightFlush'), cards: cards.slice() };
  if (groups[0].n === 4) return { ...find('quads'), cards: cards.slice() };
  if (groups[0].n === 3 && groups[1]?.n === 2) return { ...find('fullHouse'), cards: cards.slice() };
  if (isFlush) return { ...find('flush'), cards: cards.slice() };
  if (isStraight) return { ...find('straight'), cards: cards.slice() };
  if (groups[0].n === 3) return { ...find('trips'), cards: cards.slice() };
  if (groups[0].n === 2 && groups[1]?.n === 2) return { ...find('twoPair'), cards: cards.slice() };
  if (groups[0].n === 2 && rankValue(groups[0].r) >= 11) return { ...find('jacks'), cards: cards.slice() };

  return { key: 'none', name: 'Ingen vinst', sv: 'Ingen vinst', mult: 0, cards: cards.slice() };
}

function luck() {
  return clampLuckSetting(state.settings.videoPokerLuck);
}

function render(root) {
  const minBet = Number(state.settings.minBet) || 10;
  const maxBet = Number(state.settings.maxBet) || 500;
  const step = Math.max(5, Math.round(minBet / 2));
  const balance = state.player?.balance ?? 0;

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Videopoker</h1>
          <p>Jacks or Better · håll korten du vill behålla</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--ghost" id="vp-home">← Spelhallen</button>
      </div>

      <div class="table-shell">
        <div class="table-shell__bar">
          <h2>Videopoker</h2>
          <span class="mini-pill">Kort kvar <strong>${game.deck.length || 47}</strong></span>
          <span data-luck-cell="videoPokerLuck">${machineLuckPill('videoPokerLuck')}</span>
          <div class="spacer"></div>
          <button class="btn btn--sm btn--ghost" id="vp-paytable">Vinsttabell</button>
        </div>

        <div class="table-shell__body vp-wrap">
          <div class="vp-cards" id="vp-cards"></div>
          <div class="vp-result" id="vp-result">${game.message || ''}</div>

          <div class="row row--between" style="flex-wrap:wrap;gap:12px;margin-top:8px">
            <div class="bet-stepper">
              <button class="stepper-btn" id="vp-minus" ${game.phase !== 'betting' ? 'disabled' : ''}>−</button>
              <div class="bet-stepper__field">
                <span class="slot-box__label">Insats</span>
                <input class="bet-field__input bet-field__input--slot" id="vp-bet" type="number" inputmode="numeric"
                       min="${minBet}" max="${Math.max(minBet, Math.min(balance, maxBet))}" step="${step}" value="${game.bet}" ${game.phase !== 'betting' ? 'disabled' : ''} />
              </div>
              <button class="stepper-btn" id="vp-plus" ${game.phase !== 'betting' ? 'disabled' : ''}>+</button>
            </div>

            <div class="row" style="gap:10px;flex-wrap:wrap">
              <button class="action-btn action-btn--deal" id="vp-action" style="max-width:280px">
                ${game.phase === 'betting' ? '♠ Dela ut' : game.phase === 'draw' ? '↻ Byt kort' : '♠ Nytt spel'}
              </button>
              <button class="btn btn--sm btn--ghost" id="vp-holdall" ${game.phase !== 'draw' ? 'disabled' : ''}>Håll alla</button>
            </div>
          </div>

          <div class="row row--between" style="margin-top:18px;flex-wrap:wrap;gap:10px">
            <span class="mini-pill">Saldo <strong>${kr(balance)}</strong></span>
            <span class="mini-pill">Min <strong>${kr(minBet)}</strong></span>
            <span class="mini-pill">Max <strong>${kr(maxBet)}</strong></span>
          </div>
        </div>
      </div>
    </div>`;

  const cardsEl = root.querySelector('#vp-cards');
  if (!game.hand.length) {
    cardsEl.innerHTML = Array.from({ length: 5 }, () =>
      `<div class="vp-card"><div class="playing-card playing-card--back" style="--cw:112px"></div></div>`).join('');
  } else {
    cardsEl.innerHTML = game.hand
      .map((card, i) => `
        <div class="vp-card ${game.held.has(i) ? 'is-held' : ''}" data-index="${i}">
          <span class="vp-hold">HÅLL</span>
          ${cardHTML(card, { cw: 112 })}
        </div>`)
      .join('');
  }

  if (game.phase === 'draw') {
    cardsEl.querySelectorAll('.vp-card').forEach((el) => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.index);
        if (game.held.has(i)) game.held.delete(i);
        else game.held.add(i);
        sfx.click();
        el.classList.toggle('is-held');
      });
    });
  }

  const actionBtn = root.querySelector('#vp-action');
  actionBtn.addEventListener('click', () => {
    if (game.phase === 'betting') deal(root);
    else if (game.phase === 'draw') drawCards(root);
    else resetRound(root);
  });

  root.querySelector('#vp-minus').addEventListener('click', () => {
    if (game.phase !== 'betting') return;
    game.bet = Math.max(minBet, game.bet - step);
    sfx.click();
    render(root);
  });
  root.querySelector('#vp-plus').addEventListener('click', () => {
    if (game.phase !== 'betting') return;
    game.bet = Math.min(Math.min(maxBet, balance), game.bet + step);
    sfx.click();
    render(root);
  });
  root.querySelector('#vp-bet').addEventListener('change', (e) => {
    if (game.phase !== 'betting') return;
    const value = Math.round(Number(e.target.value) || 0);
    game.bet = Math.max(minBet, Math.min(value, Math.min(maxBet, balance)));
    sfx.click();
    render(root);
  });
  root.querySelector('#vp-holdall').addEventListener('click', () => {
    game.hand.forEach((_, i) => game.held.add(i));
    sfx.click();
    render(root);
  });
  root.querySelector('#vp-home').addEventListener('click', () => navigate('/kasino'));
  root.querySelector('#vp-paytable').addEventListener('click', showPaytable);

  document.onkeydown = (e) => {
    if (!document.body.classList.contains('theme-casino')) return;
    if (document.querySelector('.modal-backdrop')) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (game.phase === 'betting') deal(root);
      else if (game.phase === 'draw') drawCards(root);
      else resetRound(root);
    }
    if (game.phase === 'draw' && /^[1-5]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (game.held.has(i)) game.held.delete(i);
      else game.held.add(i);
      sfx.click();
      render(root);
    }
  };
}

/* Korten är utdelade men ännu inte bytta, eller vinsten inte utbetald. */
let creditPending = false;

guardRound(
  () => state.route.name === 'videopoker' && (game.phase === 'draw' || game.busy || creditPending)
);

async function creditVideoPoker(amount) {
  creditPending = true;
  try {
    return await api.credit('videopoker', amount);
  } finally {
    creditPending = false;
  }
}

async function deal(root) {
  if (game.busy) return;
  const bet = game.bet;
  if (bet > (state.player?.balance ?? 0)) return toast('Inte tillräckligt med spelmynt', 'bad');
  game.busy = true;
  game.luckFactor = currentLuck();
  refreshLuckPills(root);
  try {
    await api.bet('videopoker', bet);
  } catch (err) {
    game.busy = false;
    return toast(err.message, 'bad');
  }
  updateBalanceUI();
  game.deck = newDeck();
  game.hand = game.deck.splice(0, 5);
  game.held = new Set();
  game.phase = 'draw';
  game.message = 'Välj vilka kort du vill behålla';
  game.result = null;
  sfx.deal();
  render(root);
  game.busy = false;
}

async function drawCards(root) {
  if (game.busy) return;
  game.busy = true;
  const bet = game.bet;

  // Animera utbytet
  const cardsEl = root.querySelector('#vp-cards');
  const cards = Array.from(cardsEl.querySelectorAll('.vp-card'));
  cards.forEach((el, i) => {
    if (!game.held.has(i)) el.style.opacity = '0.25';
  });
  await sleep(180);

  for (let i = 0; i < 5; i++) {
    if (!game.held.has(i)) {
      game.hand[i] = game.deck.pop();
      sfx.deal();
      cards[i].style.opacity = '1';
      cards[i].innerHTML = `<span class="vp-hold">HÅLL</span>${cardHTML(game.hand[i], { cw: 112, extra: 'card-enter' })}`;
      await sleep(110);
    }
  }

  const result = evaluateHand(game.hand);
  game.result = result;
  game.phase = 'done';

  const win = result.mult > 0 ? luckPayout(bet, result.mult * luck(), game.luckFactor) : 0;
  if (win > 0) {
    try {
      await creditVideoPoker(win);
    } catch (err) {
      toast(err.message, 'bad');
    }
    game.message = `${result.sv} – ${kr(win)} tillbaka (+${kr(win - bet)} i vinst)`;
    if (result.mult >= 25) sfx.bigWin();
    else sfx.win();
    toast(`${result.sv}: +${kr(win - bet)}`, 'gold');
  } else {
    game.message = 'Ingen vinst denna gång';
    sfx.lose();
  }

  if (state.player) state.player.won = (state.player.won || 0) + win;
  game.busy = false;
  render(root);

  const resultEl = root.querySelector('#vp-result');
  if (resultEl) {
    resultEl.textContent = game.message;
    if (win > 0) resultEl.style.color = '#ffd764';
    else resultEl.style.color = '';
  }
  root.querySelector('#vp-cards').querySelectorAll('.vp-card').forEach((el) => el.classList.remove('is-held'));
  updateBalanceUI();
}

function resetRound(root) {
  game.phase = 'betting';
  game.hand = [];
  game.held = new Set();
  game.message = '';
  render(root);
}

function showPaytable() {
  const bet = game.bet || 20;
  openModal({
    title: 'Videopoker – vinsttabell',
    sub: 'Jacks or Better. Vinsterna är multiplar av insatsen.',
    wide: true,
    body: `<div class="table-scroll"><table class="data-table">
      <thead><tr><th>Hand</th><th>Svenska</th><th>Vinst</th></tr></thead>
      <tbody>
        ${PAYS.map((p) => `<tr>
          <td>${p.name}</td>
          <td class="muted">${p.sv}</td>
          <td class="num">${num(p.mult * bet)} kr</td>
        </tr>`).join('')}
      </tbody></table></div>
      <p class="tiny muted" style="margin-top:14px">Ett par i knekt, dam, kung eller ess ger vinst. Lägsta handen vinner inget.</p>`,
    actions: [{ label: 'Stäng' }]
  });
}

registerView('videopoker', (root) => {
  render(root);
});
