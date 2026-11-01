/* =====================================================================
   Kortleken: modell, rendering och kortgalleriet.
   ===================================================================== */

import { registerView, sfx, esc, openModal, toast, shuffle } from './core.js';

export const SUITS = {
  spades: { symbol: '♠', red: false, sv: 'Spader', en: 'Spades' },
  hearts: { symbol: '♥', red: true, sv: 'Hjärter', en: 'Hearts' },
  diamonds: { symbol: '♦', red: true, sv: 'Ruter', en: 'Diamonds' },
  clubs: { symbol: '♣', red: false, sv: 'Klöver', en: 'Clubs' }
};

export const SUIT_ORDER = ['spades', 'hearts', 'diamonds', 'clubs'];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const RANK_NAMES = {
  A: { sv: 'Ess', en: 'Ace' },
  2: { sv: 'Tvåa', en: 'Two' },
  3: { sv: 'Trea', en: 'Three' },
  4: { sv: 'Fyra', en: 'Four' },
  5: { sv: 'Femma', en: 'Five' },
  6: { sv: 'Sexa', en: 'Six' },
  7: { sv: 'Sjua', en: 'Seven' },
  8: { sv: 'Åtta', en: 'Eight' },
  9: { sv: 'Nia', en: 'Nine' },
  10: { sv: 'Tia', en: 'Ten' },
  J: { sv: 'Knekt', en: 'Jack' },
  Q: { sv: 'Dam', en: 'Queen' },
  K: { sv: 'Kung', en: 'King' }
};

const PIPS = {
  '2': [[50, 17], [50, 83]],
  '3': [[50, 17], [50, 50], [50, 83]],
  '4': [[27, 17], [73, 17], [27, 83], [73, 83]],
  '5': [[27, 17], [73, 17], [50, 50], [27, 83], [73, 83]],
  '6': [[27, 17], [73, 17], [27, 50], [73, 50], [27, 83], [73, 83]],
  '7': [[27, 17], [73, 17], [50, 33], [27, 50], [73, 50], [27, 83], [73, 83]],
  '8': [[27, 17], [73, 17], [50, 33], [27, 50], [73, 50], [50, 67], [27, 83], [73, 83]],
  '9': [[27, 15], [73, 15], [27, 38], [73, 38], [50, 50], [27, 62], [73, 62], [27, 85], [73, 85]],
  '10': [[27, 14], [73, 14], [50, 26], [27, 38], [73, 38], [27, 62], [73, 62], [50, 74], [27, 86], [73, 86]]
};

export function cardKey(card) {
  return card ? card.r + '-' + card.s : '';
}

/** Rendering av ett spelkort som HTML. */
export function cardHTML(card, opts = {}) {
  const { cw = 88, extra = '', faceDown = false, style = '', attrs = '' } = opts;
  if (!card || faceDown) {
    return `<div class="playing-card playing-card--back ${extra}" style="--cw:${cw}px;${style}" ${attrs}></div>`;
  }
  const suit = SUITS[card.s];
  const isRed = suit.red;
  const corner = `<span class="r">${card.r}</span><span class="s">${suit.symbol}</span>`;
  let inner = '';

  if (card.r === 'J' || card.r === 'Q' || card.r === 'K') {
    inner = `<div class="face">
        <span class="face__letter">${card.r}</span>
        <span class="face__suit">${suit.symbol}</span>
      </div>`;
  } else if (card.r === 'A') {
    inner = `<div class="pips"><span class="pip pip--ace" style="left:50%;top:50%">${suit.symbol}</span></div>`;
  } else {
    const pips = (PIPS[card.r] || []).map(
      ([x, y]) => `<span class="pip" style="left:${x}%;top:${y}%">${suit.symbol}</span>`
    ).join('');
    inner = `<div class="pips">${pips}</div>`;
  }

  return `<div class="playing-card ${isRed ? 'is-red' : ''} ${extra}" style="--cw:${cw}px;${style}" ${attrs} data-card="${cardKey(card)}">
      <div class="corner corner--tl">${corner}</div>
      ${inner}
      <div class="corner corner--br">${corner}</div>
    </div>`;
}

export function rankValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K' || rank === '10') return 10;
  return Number(rank);
}

export function newDeck(count = 1) {
  const cards = [];
  for (let d = 0; d < count; d++) {
    SUIT_ORDER.forEach((s) => RANKS.forEach((r) => cards.push({ r, s })));
  }
  return shuffle(cards);
}

export function cardName(card) {
  return `${RANK_NAMES[card.r].sv} i ${SUITS[card.s].sv.toLowerCase()}`;
}

/* ------------------------------ Kortgalleriet ------------------------------ */

function renderDeckView(root) {
  let filter = 'alla';
  let search = '';

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Kortleken</h1>
          <p>Alla 52 kort + 2 jokrar – namn på svenska och engelska.</p>
        </div>
      </div>

      <div class="deck-toolbar">
        <button class="btn btn--sm" data-filter="alla">Alla</button>
        <button class="btn btn--sm" data-filter="spades">♠ Spader</button>
        <button class="btn btn--sm" data-filter="hearts">♥ Hjärter</button>
        <button class="btn btn--sm" data-filter="diamonds">♦ Ruter</button>
        <button class="btn btn--sm" data-filter="clubs">♣ Klöver</button>
        <button class="btn btn--sm" data-filter="joker">🃏 Jokrar</button>
        <div style="flex:1"></div>
        <input class="input" style="max-width:220px" placeholder="Sök kort, t.ex. dam" id="deck-search" />
        <button class="btn btn--sm btn--primary" id="deal-five">Dela fem kort</button>
      </div>

      <div id="deck-groups"></div>

      <div class="disclaimer" style="margin-top:26px">
        <span>💡</span>
        <div>Visste du att korten har engelska namn också? <strong>Ace, Two, Three … Jack, Queen, King</strong> – perfekt att träna inför engelskaprov.</div>
      </div>
    </div>`;

  const groupsEl = root.querySelector('#deck-groups');

  function draw() {
    const groups = [];
    const suits = SUIT_ORDER.filter((s) => filter === 'alla' || filter === s);
    suits.forEach((suit) => {
      const cards = RANKS.map((r) => ({ r, s: suit })).filter((c) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          c.r.toLowerCase().includes(q) ||
          RANK_NAMES[c.r].sv.toLowerCase().includes(q) ||
          RANK_NAMES[c.r].en.toLowerCase().includes(q) ||
          SUITS[c.s].sv.toLowerCase().includes(q) ||
          SUITS[c.s].en.toLowerCase().includes(q)
        );
      });
      if (cards.length) {
        groups.push(`
          <section class="deck-section">
            <div class="deck-section__head">
              <h3 style="color:${SUITS[suit].red ? '#e0607a' : 'inherit'}">${SUITS[suit].symbol} ${SUITS[suit].sv} <span class="muted small">/ ${SUITS[suit].en}</span></h3>
              <div class="deck-section__line"></div>
              <span class="tiny muted">${cards.length} kort</span>
            </div>
            <div class="deck-grid">${cards.map((c) => cardHTML(c, { cw: 74, extra: 'deck-card' })).join('')}</div>
          </section>`);
      }
    });

    if (filter === 'alla' || filter === 'joker') {
      const jokers = [
        { r: 'Joker', s: 'spades', joker: true },
        { r: 'Joker', s: 'hearts', joker: true }
      ];
      groups.push(`
        <section class="deck-section">
          <div class="deck-section__head">
            <h3>🃏 Jokrar <span class="muted small">/ Jokers</span></h3>
            <div class="deck-section__line"></div>
            <span class="tiny muted">2 kort</span>
          </div>
          <div class="deck-grid">
            ${jokers.map((j) => `
              <div class="playing-card is-red" style="--cw:74px;cursor:pointer" data-joker="1">
                <div class="face"><span class="face__letter" style="font-size:calc(74px * .28)">JOKER</span><span class="face__suit">🃏</span></div>
              </div>`).join('')}
          </div>
        </section>`);
    }

    groupsEl.innerHTML = groups.length ? groups.join('') : '<p class="muted">Inga kort matchar sökningen.</p>';
  }

  root.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      root.querySelectorAll('[data-filter]').forEach((b) => b.classList.remove('btn--primary'));
      btn.classList.add('btn--primary');
      sfx.click();
      draw();
    });
  });

  root.querySelector('#deck-search').addEventListener('input', (e) => {
    search = e.target.value.trim();
    draw();
  });

  root.querySelector('#deal-five').addEventListener('click', () => {
    sfx.deal();
    const deck = newDeck();
    const five = deck.slice(0, 5);
    openModal({
      title: 'Fem slumpade kort',
      sub: 'Blandade kort ur en vanlig kortlek.',
      wide: true,
      body: `<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;padding:10px 0 4px">
        ${five.map((c) => cardHTML(c, { cw: 110 })).join('')}
      </div>
      <div class="wrap-gap" style="justify-content:center;margin-top:16px">
        ${five.map((c) => `<span class="chip">${esc(cardName(c))}</span>`).join('')}
      </div>`,
      actions: [{ label: 'Stäng', kind: 'ghost' }]
    });
  });

  groupsEl.addEventListener('click', (e) => {
    const cardEl = e.target.closest('[data-card]');
    if (!cardEl) return;
    const [r, s] = cardEl.dataset.card.split('-');
    showCardDetail({ r, s });
  });

  draw();
}

function showCardDetail(card) {
  const suit = SUITS[card.s];
  openModal({
    title: `${RANK_NAMES[card.r].sv} i ${suit.sv.toLowerCase()}`,
    sub: 'Engelska: ' + RANK_NAMES[card.r].en + ' of ' + suit.en.toLowerCase(),
    body: `<div class="card-detail">
      ${cardHTML(card, { cw: 150 })}
      <div class="card-detail__facts">
        <div class="fact"><span>Valör</span><b>${RANK_NAMES[card.r].sv} (${card.r})</b></div>
        <div class="fact"><span>Färg</span><b>${suit.symbol} ${suit.sv}</b></div>
        <div class="fact"><span>Engelska</span><b>${RANK_NAMES[card.r].en} of ${suit.en}</b></div>
        <div class="fact"><span>Poäng i blackjack</span><b>${rankValue(card.r)}</b></div>
        <div class="fact"><span>Kulör</span><b>${suit.red ? 'Röd' : 'Svart'}</b></div>
      </div>
    </div>`,
    actions: [{ label: 'Stäng' }]
  });
}

registerView('kortleken', renderDeckView);

export { showCardDetail };
