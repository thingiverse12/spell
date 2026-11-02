/* =====================================================================
   Blackjack – 6 kortlekar, dealer stannar på 17, blackjack ger 3:2.
   ===================================================================== */

import {
  registerView, state, api, sfx, toast, kr, num, esc, sleep, navigate, setBalance, updateBalanceUI, openModal
} from './core.js';
import { cardHTML, newDeck, rankValue } from './cards.js';

const game = {
  shoe: newDeck(6),
  bet: 0,
  lastBet: 100,
  hands: [],
  active: 0,
  dealer: [],
  phase: 'betting', // betting | player | dealer | done
  reveal: false,
  busy: false,
  message: '',
  showCards: 0,
  netLast: 0
};

function handTotal(cards) {
  let total = 0;
  let aces = 0;
  cards.forEach((c) => {
    total += rankValue(c.r);
    if (c.r === 'A') aces += 1;
  });
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 && total <= 21 };
}

const isBlackjack = (cards) => cards.length === 2 && handTotal(cards).total === 21;

function ensureShoe() {
  if (game.shoe.length < 52) {
    game.shoe = newDeck(6);
    return true;
  }
  return false;
}

function draw() {
  ensureShoe();
  return game.shoe.pop();
}

function payoutRatio() {
  return Number(state.settings.blackjackPayout) || 1.5;
}

function currentHand() {
  return game.hands[game.active] || null;
}

function totalBet() {
  return game.hands.reduce((sum, h) => sum + h.bet, 0) || game.bet;
}

/* ------------------------------ Rendering ------------------------------ */

function scoreBadge(cards) {
  if (!cards.length) return '';
  const { total, soft } = handTotal(cards);
  const cls = total > 21 ? 'score-badge--bust' : soft ? 'score-badge--soft' : '';
  return `<div class="score-badge ${cls}">${total > 21 ? total : soft ? total : total}</div>`;
}

function renderHand(cards, { hideSecond = false, small = false } = {}) {
  const size = small ? 76 : 92;
  if (!cards.length) return '';
  return `<div class="hand">${cards
    .map((c, i) => {
      const hidden = hideSecond && i === 1;
      const anim = c.anim ? 'card-enter' : '';
      return cardHTML(hidden ? null : c, { cw: size, faceDown: hidden, extra: anim });
    })
    .join('')}</div>`;
}

function render(root) {
  const table = root.querySelector('#bj-table');
  const actions = root.querySelector('#bj-actions');
  const chips = root.querySelector('#bj-chips');
  if (!table) return;

  const hand = currentHand();
  const dealerCards = game.dealer;
  const dealerScore = game.reveal ? handTotal(dealerCards).total : '';

  table.innerHTML = `
    <div class="felt">
      <div>
        <div class="felt__arc">Blackjack betalar 3 : 2 · Insurance betalar 2 : 1</div>
        <div class="dealer-zone">
          <span class="hand-label">Dealer</span>
          <div style="display:flex;align-items:center;gap:14px">
            ${renderHand(dealerCards, { hideSecond: !game.reveal })}
            ${dealerCards.length ? `<div class="score-badge ${dealerScore > 21 ? 'score-badge--bust' : ''}">${dealerScore === '' ? '?' : dealerScore}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="felt__center-label">— Blackjack —</div>

      <div>
        <div class="player-hands">
          ${game.hands
            .map((h, idx) => {
              const { total } = handTotal(h.cards);
              const active = idx === game.active && game.phase === 'player';
              const resultLabel = h.result
                ? {
                    win: 'Vinst',
                    lose: 'Förlust',
                    push: 'Lika',
                    blackjack: 'Blackjack!'
                  }[h.result]
                : '';
              const resultClass =
                h.result === 'win' || h.result === 'blackjack'
                  ? 'is-win'
                  : h.result === 'lose'
                  ? 'is-lose'
                  : h.result === 'push'
                  ? 'is-push'
                  : '';
              return `<div class="player-hand ${active ? 'is-active' : ''}">
                  <span class="hand-label">${game.hands.length > 1 ? 'Hand ' + (idx + 1) : 'Du'}${h.doubled ? ' · dubblat' : ''}</span>
                  <div style="display:flex;align-items:center;gap:14px">
                    ${renderHand(h.cards)}
                    ${h.cards.length ? `<div class="score-badge ${total > 21 ? 'score-badge--bust' : ''}">${total}</div>` : ''}
                  </div>
                  ${resultLabel ? `<span class="player-hand__result ${resultClass}">${resultLabel}</span>` : ''}
                </div>`;
            })
            .join('')}
        </div>

        <div class="bet-circle">
          ${
            game.bet > 0
              ? `<div class="poker-chip" style="--chip-size:64px"><span>${num(game.bet)}</span></div>
                 <div class="bet-circle__amount">INSATS ${kr(game.bet)}</div>`
              : '<span class="tiny muted">Lägg insats</span>'
          }
        </div>
      </div>

      ${game.message ? `<div class="result-banner">${esc(game.message)}</div>` : ''}
    </div>`;

  /* ---------- Åtgärdsknappar ---------- */
  const balance = state.player?.balance ?? 0;
  const splitDoubleBlocked = hand && hand.fromSplit && state.settings.doubleAfterSplit === false;
  const canDouble =
    hand && hand.cards.length === 2 && balance >= (game.bet || 0) && game.phase === 'player' && !splitDoubleBlocked;
  const canSplit =
    hand &&
    game.phase === 'player' &&
    game.hands.length < 3 &&
    hand.cards.length === 2 &&
    hand.cards[0].r === hand.cards[1].r &&
    balance >= hand.bet;

  if (game.phase === 'betting') {
    actions.innerHTML = `
      <button class="action-btn action-btn--deal" id="bj-deal" ${game.bet <= 0 || game.busy ? 'disabled' : ''}>♠ Dela ut (${kr(game.bet)})</button>`;
  } else if (game.phase === 'player') {
    actions.innerHTML = `
      <button class="action-btn action-btn--stand" id="bj-stand">✕ Stanna</button>
      <button class="action-btn action-btn--hit" id="bj-hit">＋ Ta kort</button>
      <button class="action-btn action-btn--double" id="bj-double" ${canDouble ? '' : 'disabled'}>⏩ Dubbel</button>
      <button class="action-btn action-btn--split" id="bj-split" ${canSplit ? '' : 'disabled'}>⑃ Splitta</button>`;
  } else if (game.phase === 'dealer') {
    actions.innerHTML = `<button class="action-btn action-btn--hit" disabled>Dealern spelar …</button>`;
  } else {
    actions.innerHTML = `
      <button class="action-btn action-btn--deal" id="bj-again">♠ Nytt spel (${kr(game.lastBet)})</button>
      <button class="action-btn action-btn--split" id="bj-reset">↺ Ändra insats</button>`;
  }

  const minBet = Number(state.settings.minBet) || 10;
  const maxBet = Number(state.settings.maxBet) || 500;
  const chipValues = [25, 50, 100, 250, 500].filter((v) => v >= Math.min(minBet, 25));
  const classes = ['', 'poker-chip--blue', 'poker-chip--green', 'poker-chip--black', 'poker-chip--gold'];

  chips.innerHTML = `
    <div class="bet-bar">
      <div class="bet-field">
        <span class="bet-field__label">Egen insats</span>
        <div class="bet-field__row">
          <input class="bet-field__input" id="bj-bet-input" type="number" inputmode="numeric"
                 min="${minBet}" max="${Math.max(0, Math.min(balance, maxBet))}" step="${minBet}"
                 value="${game.bet}" ${game.phase !== 'betting' ? 'disabled' : ''} />
          <span class="bet-field__unit">kr</span>
          <button class="chip-mini" data-bet-mult="0.5" ${game.phase !== 'betting' ? 'disabled' : ''}>½</button>
          <button class="chip-mini" data-bet-mult="2" ${game.phase !== 'betting' ? 'disabled' : ''}>2×</button>
          <button class="chip-mini" data-bet-max="1" ${game.phase !== 'betting' ? 'disabled' : ''}>Max</button>
        </div>
      </div>

      <div class="chip-row">
        ${chipValues
          .map(
            (v, i) => `<button class="chip-btn" data-chip="${v}" ${game.phase !== 'betting' ? 'disabled' : ''}>
              <div class="poker-chip ${classes[i % classes.length]}" style="--chip-size:52px"><span>${v >= 1000 ? v / 1000 + 'k' : v}</span></div>
            </button>`
          )
          .join('')}
        <button class="btn btn--sm btn--ghost" id="bj-clear" ${game.phase !== 'betting' || game.bet === 0 ? 'disabled' : ''}>Rensa</button>
      </div>

      <div class="row" style="gap:8px;flex-wrap:wrap">
        <span class="mini-pill">Min <strong>${kr(minBet)}</strong></span>
        <span class="mini-pill">Max <strong>${kr(maxBet)}</strong></span>
        <span class="mini-pill">Saldo <strong>${kr(balance)}</strong></span>
      </div>
    </div>`;

  bind(root);
  updateBalanceUI();
}

function bind(root) {
  const on = (id, fn) => {
    const el = root.querySelector('#' + id);
    if (el) el.addEventListener('click', fn);
  };

  on('bj-deal', () => startRound());
  on('bj-again', () => {
    game.bet = Math.min(game.lastBet, state.player?.balance ?? 0);
    startRound();
  });
  on('bj-reset', () => {
    game.bet = 0;
    game.hands = [];
    game.dealer = [];
    game.reveal = false;
    game.phase = 'betting';
    game.message = '';
    render(root);
  });
  on('bj-hit', () => hit(root));
  on('bj-stand', () => stand(root));
  on('bj-double', () => double(root));
  on('bj-split', () => split(root));
  on('bj-clear', () => {
    game.bet = 0;
    sfx.click();
    render(root);
  });

  const betField = root.querySelector('#bj-bet-input');
  if (betField) {
    betField.addEventListener('change', () => {
      if (game.phase !== 'betting') return;
      const balance = state.player?.balance ?? 0;
      const maxBet = Number(state.settings.maxBet) || 500;
      const value = Math.round(Number(betField.value) || 0);
      game.bet = Math.max(0, Math.min(value, balance, maxBet));
      sfx.click();
      render(root);
    });
  }

  root.querySelectorAll('[data-bet-mult]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (game.phase !== 'betting') return;
      const balance = state.player?.balance ?? 0;
      const maxBet = Number(state.settings.maxBet) || 500;
      const factor = Number(btn.dataset.betMult) || 1;
      game.bet = Math.max(0, Math.min(Math.round(game.bet * factor), balance, maxBet));
      sfx.chip();
      render(root);
    });
  });

  root.querySelectorAll('[data-bet-max]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (game.phase !== 'betting') return;
      const balance = state.player?.balance ?? 0;
      const maxBet = Number(state.settings.maxBet) || 500;
      game.bet = Math.min(balance, maxBet);
      sfx.chip();
      render(root);
    });
  });

  root.querySelectorAll('[data-chip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (game.phase !== 'betting') return;
      const balance = state.player?.balance ?? 0;
      const maxBet = Number(state.settings.maxBet) || 500;
      const value = btn.dataset.chip === 'all' ? balance : Number(btn.dataset.chip);
      game.bet = Math.min(balance, maxBet, game.bet + value);
      if (game.bet < balance) sfx.chip();
      render(root);
    });
  });
}

/* ------------------------------ Spelflöde ------------------------------ */

function clearAnimFlags() {
  game.hands.forEach((h) => h.cards.forEach((c) => delete c.anim));
  game.dealer.forEach((c) => delete c.anim);
}

async function startRound(root) {
  if (game.busy) return;
  const bet = Math.round(game.bet);
  const balance = state.player?.balance ?? 0;
  if (bet <= 0) return toast('Lägg en insats först', 'bad');
  if (bet > balance) return toast('Du har inte tillräckligt med spelmynt', 'bad');

  game.busy = true;
  try {
    await api.bet('blackjack', bet);
  } catch (err) {
    game.busy = false;
    return toast(err.message, 'bad');
  }

  game.lastBet = bet;
  game.hands = [{ cards: [], bet, doubled: false, result: null }];
  game.dealer = [];
  game.active = 0;
  game.reveal = false;
  game.phase = 'player';
  game.message = '';
  game.netLast = 0;

  const r = root || document;
  const animCard = (card) => ({ ...card, anim: true });

  game.hands[0].cards.push(animCard(draw()));
  game.dealer.push(animCard(draw()));
  render(r);
  sfx.deal();
  await sleep(280);
  clearAnimFlags();

  game.hands[0].cards.push(animCard(draw()));
  game.dealer.push(animCard(draw()));
  render(r);
  sfx.deal();
  await sleep(320);
  clearAnimFlags();

  const playerBJ = isBlackjack(game.hands[0].cards);
  const dealerBJ = isBlackjack(game.dealer);

  if (playerBJ || dealerBJ) {
    game.reveal = true;
    if (playerBJ && dealerBJ) {
      game.hands[0].result = 'push';
      game.message = 'Båda har blackjack – insatsen tillbaka';
      await api.credit('blackjack', bet);
    } else if (playerBJ) {
      game.hands[0].result = 'blackjack';
      const win = Math.round(bet * (1 + payoutRatio()));
      game.message = `Blackjack! Du vinner ${kr(win - bet)}`;
      sfx.win();
      await api.credit('blackjack', win);
    } else {
      game.hands[0].result = 'lose';
      game.message = 'Dealern har blackjack';
      sfx.lose();
    }
    game.phase = 'done';
    game.busy = false;
    render(r);
    return;
  }

  game.phase = 'player';
  game.busy = false;
  render(r);
}

async function hit(root) {
  if (game.busy || game.phase !== 'player') return;
  const hand = currentHand();
  if (!hand) return;
  game.busy = true;
  hand.cards.push({ ...draw(), anim: true });
  sfx.deal();
  render(root);
  clearAnimFlags();

  if (handTotal(hand.cards).total > 21) {
    hand.result = 'lose';
    hand.done = true;
    sfx.lose();
    game.busy = false;
    await nextHandOrDealer(root);
    return;
  }
  if (handTotal(hand.cards).total === 21) {
    hand.done = true;
    game.busy = false;
    await nextHandOrDealer(root);
    return;
  }
  game.busy = false;
  render(root);
}

async function stand(root) {
  if (game.busy || game.phase !== 'player') return;
  const hand = currentHand();
  if (!hand) return;
  hand.done = true;
  sfx.click();
  await nextHandOrDealer(root);
}

async function double(root) {
  if (game.busy || game.phase !== 'player') return;
  const hand = currentHand();
  const balance = state.player?.balance ?? 0;
  if (!hand || hand.cards.length !== 2 || balance < hand.bet) return;
  game.busy = true;
  try {
    await api.bet('blackjack', hand.bet);
  } catch (err) {
    game.busy = false;
    return toast(err.message, 'bad');
  }
  hand.bet *= 2;
  hand.doubled = true;
  game.bet = totalBet();
  hand.cards.push({ ...draw(), anim: true });
  sfx.chip();
  render(root);
  clearAnimFlags();
  await sleep(260);
  const bust = handTotal(hand.cards).total > 21;
  hand.done = true;
  if (bust) hand.result = 'lose';
  game.busy = false;
  await nextHandOrDealer(root);
}

async function split(root) {
  if (game.busy || game.phase !== 'player') return;
  const hand = currentHand();
  const balance = state.player?.balance ?? 0;
  if (!hand || hand.cards.length !== 2 || hand.cards[0].r !== hand.cards[1].r || game.hands.length >= 3) return;
  game.busy = true;
  try {
    await api.bet('blackjack', hand.bet);
  } catch (err) {
    game.busy = false;
    return toast(err.message, 'bad');
  }
  const [a, b] = hand.cards;
  const newHands = [
    { cards: [a, { ...draw(), anim: true }], bet: hand.bet, doubled: false, result: null, fromSplit: true },
    { cards: [b, { ...draw(), anim: true }], bet: hand.bet, doubled: false, result: null, fromSplit: true }
  ];
  game.hands.splice(game.active, 1, ...newHands);
  sfx.deal();
  render(root);
  clearAnimFlags();
  await sleep(260);
  game.busy = false;
  render(root);
}

async function nextHandOrDealer(root) {
  const nextIdx = game.hands.findIndex((h) => !h.done);
  if (nextIdx >= 0) {
    game.active = nextIdx;
    game.busy = false;
    render(root);
    return;
  }
  game.phase = 'dealer';
  game.busy = false;
  render(root);
  await sleep(300);
  game.reveal = true;
  sfx.deal();
  render(root);
  await sleep(500);

  const anyAlive = game.hands.some((h) => handTotal(h.cards).total <= 21);
  const dealerHitsSoft17 = !!state.settings.dealerHitsSoft17;

  while (anyAlive) {
    const { total, soft } = handTotal(game.dealer);
    if (total < 17 || (total === 17 && soft && dealerHitsSoft17)) {
      game.dealer.push({ ...draw(), anim: true });
      sfx.deal();
      render(root);
      clearAnimFlags();
      await sleep(460);
    } else {
      break;
    }
  }

  await settle(root);
}

async function settle(root) {
  const dealerTotal = handTotal(game.dealer).total;
  const dealerBust = dealerTotal > 21;
  let totalWin = 0;
  let anyWin = false;
  let allLose = true;

  game.hands.forEach((h) => {
    if (h.result) return;
    const total = handTotal(h.cards).total;
    if (total > 21) {
      h.result = 'lose';
    } else if (dealerBust || total > dealerTotal) {
      h.result = 'win';
      totalWin += h.bet * 2;
      anyWin = true;
      allLose = false;
    } else if (total === dealerTotal) {
      h.result = 'push';
      totalWin += h.bet;
      allLose = false;
    } else {
      h.result = 'lose';
    }
  });

  game.hands.forEach((h) => {
    if (h.result === 'win') h.result = 'win';
  });

  const net = totalWin - totalBet();
  game.phase = 'done';
  game.busy = false;

  if (totalWin > 0) {
    try {
      await api.credit('blackjack', totalWin);
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  if (anyWin) {
    sfx.win();
    game.message = net > 0 ? `Du vann ${kr(net)}!` : 'Insatsen tillbaka';
  } else if (allLose) {
    sfx.lose();
    game.message = dealerBust ? 'Dealern sprack – men du var över 21' : 'Dealern vinner handen';
  } else {
    game.message = 'Insatsen tillbaka';
  }

  if (state.player) {
    state.player.won = (state.player.won || 0) + totalWin;
    state.player.rounds = (state.player.rounds || 0) + 1;
  }
  render(root);
  setBalance(state.player?.balance ?? 0);
}

/* ------------------------------ Vyn ------------------------------ */

function renderView(root) {
  game.bet = Math.min(game.bet || 0, state.player?.balance ?? 0);

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Blackjack</h1>
          <p>Sex kortlekar · dealern stannar på 17 · blackjack ger 3:2</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--ghost" id="bj-home">← Spelhallen</button>
      </div>

      <div class="table-shell">
        <div class="table-shell__bar">
          <h2>Blackjack</h2>
          <span class="mini-pill">Kort kvar i given <strong>${game.shoe.length}</strong></span>
          <span class="mini-pill">Blackjack <strong>${(payoutRatio() === 1.5 ? '3:2' : payoutRatio() === 1.2 ? '6:5' : payoutRatio() + ':1')}</strong></span>
          <div class="spacer"></div>
          <button class="btn btn--sm btn--ghost" id="bj-rules">Regler</button>
        </div>
        <div id="bj-table"></div>
        <div id="bj-actions" class="action-bar"></div>
        <div id="bj-chips" style="padding:14px 18px;border-top:1px solid var(--line);background:rgba(0,0,0,.2)"></div>
      </div>
    </div>`;

  root.querySelector('#bj-home').addEventListener('click', () => navigate('/kasino'));
  root.querySelector('#bj-rules').addEventListener('click', () => {
    sfx.click();
    openModal({
      title: 'Blackjack – regler',
      sub: 'Snabba regler för bordet.',
      body: `<ul style="padding-left:18px;line-height:1.9;font-size:14px;color:var(--text-soft)">
        <li>Målet är att komma närmare 21 än dealern – utan att gå över.</li>
        <li>Ess räknas som 11 eller 1. Knekt, dam och kung är 10.</li>
        <li>Dealern måste ta kort till 17 och stannar där.</li>
        <li>Blackjack (ess + tio) betalar <b>3:2</b>.</li>
        <li><b>Dubbel</b>: dubbla insatsen och få exakt ett kort till.</li>
        <li><b>Splitta</b>: två lika kort blir två händer (kostar en insats till).</li>
        <li>Lika poäng = insatsen tillbaka (push).</li>
      </ul>
      <p class="tiny muted" style="margin-top:14px">Allt spelas med spelmynt. Inga riktiga pengar, ingen utbetalning.</p>`,
      actions: [{ label: 'Uppfattat' }]
    });
  });

  document.onkeydown = (e) => {
    if (!document.body.classList.contains('theme-casino')) return;
    if (document.querySelector('.modal-backdrop')) return;
    const key = e.key.toLowerCase();
    if (game.phase === 'betting' && (key === ' ' || key === 'enter')) { e.preventDefault(); startRound(root); }
    else if (game.phase === 'player') {
      if (key === 'h') hit(root);
      if (key === 's') stand(root);
      if (key === 'd') double(root);
      if (key === 'p') split(root);
    } else if (game.phase === 'done' && (key === ' ' || key === 'enter')) {
      e.preventDefault();
      game.bet = Math.min(game.lastBet, state.player?.balance ?? 0);
      startRound(root);
    }
  };

  render(root);
}

registerView('blackjack', renderView);

export { handTotal, isBlackjack };
