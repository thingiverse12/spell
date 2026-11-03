/* =====================================================================
   Finns i sjön – det klassiska kortspellet vid ett bord.

   Två till sex spelare lägger samma insats i en gemensam kassa. Man frågar
   en motspelare efter en valör man redan har på hand: har hen korten får man
   dem och frågar igen, annars säger hen "Finns i sjön!" och man drar ett kort
   ur sjön. Den som har flest fyrtal när korten är slut tar kassan.

   Allt avgörs på servern (lib/api.js): korten blandas och delas där, och
   klienten får bara se sin egen hand och hur många kort de andra har. Vyn
   hämtar bordet med några sekunders mellanrum och ritar bara om när något
   faktiskt har hänt.
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, esc, navigate, updateBalanceUI, openModal } from './core.js';
import { cardHTML, SUIT_ORDER } from './cards.js';

/* Samma siffror som servern – exporteras så att npm run audit kan kontrollera
   spelet utanför webbläsaren. */
export const FINNS_MATH = {
  MIN_SEATS: 2,
  MAX_SEATS: 6,
  HAND_SMALL: 7,
  HAND_BIG: 5,
  TURN_MS: 45 * 1000,
  POLL_MS: 1200,
  CARDS: 52,
  RANKS: 13,
  HOUSE_CUT: 0
};

const RANK_WORDS = {
  A: 'ess',
  2: 'tvåor',
  3: 'treor',
  4: 'fyror',
  5: 'femmor',
  6: 'sexor',
  7: 'sjuor',
  8: 'åttor',
  9: 'nior',
  10: 'tior',
  J: 'knektar',
  Q: 'damer',
  K: 'kungar'
};

const ui = {
  root: null,
  tableId: '',
  view: null,
  sig: '',
  error: '',
  busy: false,
  poll: null,
  clock: null,
  board: null,
  boardSig: '',
  rank: '',
  target: -1,
  lastAskAt: 0
};

/* ------------------------------ smådelar ------------------------------ */

const initial = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?';

function phaseText(view) {
  if (view.phase === 'lobby') return 'Väntrum – alla lägger sin insats innan korten delas';
  if (view.phase === 'playing') return 'Korten är delade – fråga på!';
  return 'Matchen är slut';
}

function seatCard(seat, view) {
  const cls = [
    'finns__seat',
    seat.isYou ? 'is-you' : '',
    seat.isTurn ? 'is-turn' : '',
    seat.out ? 'is-out' : '',
    seat.left ? 'is-left' : '',
    ui.target === seat.index && !seat.isYou ? 'is-picked' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const backs = Array.from({ length: Math.min(seat.cards, 7) }, () => '<span class="finns__back"></span>').join('');
  const books = seat.books.length
    ? `<div class="finns__books">${seat.books.map((r) => `<span class="finns__book" title="Fyrtal ${esc(r)}">${esc(r)}</span>`).join('')}</div>`
    : '';

  return `<button class="${cls}" data-target="${seat.index}" ${seat.isYou || seat.left || view.phase !== 'playing' ? 'disabled' : ''}>
    <span class="finns__seat-top">
      <span class="finns__seat-emoji">${seat.out && !seat.left ? '💤' : seat.emoji || esc(initial(seat.name))}</span>
      <span class="finns__seat-name">
        <b>${esc(seat.name)}</b>
        <small>${seat.isYou ? 'du' : seat.isTurn ? 'frågar nu' : seat.left ? 'lämnade' : seat.out ? 'ute' : 'väntar'}${
    seat.isHost ? ' · värd' : ''
  }</small>
      </span>
    </span>
    <span class="finns__seat-cards">
      <span class="finns__backs">${backs}</span>
      <span class="finns__count">${seat.cards} kort</span>
    </span>
    ${books}
  </button>`;
}

function seatsHTML(view) {
  const list = view.phase === 'lobby' ? view.seats.filter((s) => !s.left) : view.seats.filter((s) => !s.left);
  const cards = list.filter((s) => !s.isYou).map((s) => seatCard(s, view));
  if (!cards.length) {
    cards.push(`<div class="finns__seat is-empty"><span class="finns__seat-top">
      <span class="finns__seat-emoji">+</span>
      <span class="finns__seat-name"><b>Ingen motspelare än</b><small>bjud in någon</small></span></span></div>`);
  }
  return `<div class="finns__opponents">${cards.join('')}</div>`;
}

function seaHTML(view) {
  const count = view.phase === 'playing' ? view.seaCount : 0;
  return `<div class="finns__sea ${count ? '' : 'is-empty'}">
    <span class="finns__sea-icon">🌊</span>
    <span class="finns__sea-label">Sjön</span>
    <strong class="finns__sea-count">${count}</strong>
    <span class="finns__sea-sub">${view.phase === 'playing' ? (count ? 'kort kvar att dra' : 'tom – inget mer att dra') : 'delas ut vid start'}</span>
  </div>`;
}

function handHTML(view) {
  const you = view.you;
  if (!you) return '';
  if (!you.hand.length) {
    return `<div class="finns__hand-empty">Du har inga kort på hand just nu.</div>`;
  }
  return `<div class="finns__hand">${you.hand
    .map(
      (card) =>
        `<button class="finns__card ${ui.rank === card.r ? 'is-picked' : ''}" data-rank="${esc(card.r)}"
          title="Fråga efter ${esc(RANK_WORDS[card.r] || card.r)}">${cardHTML(
          { r: card.r, s: SUIT_ORDER[card.s] || 'spades' },
          { cw: 62, extra: 'finns__face' }
        )}</button>`
    )
    .join('')}</div>`;
}

function askHTML(view) {
  if (view.phase !== 'playing' || !view.you) return '';
  if (!view.you.isTurn) {
    return `<div class="finns__ask"><span class="finns__hint">Väntar på <b>${esc(view.turnName)}</b>…</span></div>`;
  }
  const ranks = view.you.ranks;
  if (!ranks.length) {
    return `<div class="finns__ask"><span class="finns__hint">Du har inga kort – dra ett ur sjön när det blir din tur igen.</span></div>`;
  }
  const target = view.seats.find((s) => s.index === ui.target && !s.isYou && !s.left);
  const ready = !!ui.rank && !!target;
  const label = ready
    ? `Fråga ${esc(target.name)} om ${esc(ui.rank)}`
    : ui.rank
    ? `Välj vem du ska fråga`
    : 'Välj ett kort i handen';
  const targets = view.you.targets.map((index) => {
    const s = view.seats.find((x) => x.index === index);
    if (!s) return '';
    return `<button class="finns__target ${ui.target === index ? 'is-picked' : ''}" data-target="${index}">
      ${s.emoji || esc(initial(s.name))} ${esc(s.name)} <small>${s.cards} kort</small>
    </button>`;
  });
  return `<div class="finns__ask">
    <div class="finns__targets">${targets.join('') || '<span class="finns__hint">Ingen motspelare har kort – dra ur sjön.</span>'}</div>
    <button class="action-btn action-btn--hit finns__ask-btn" id="finns-ask" ${ready && !ui.busy ? '' : 'disabled'}>${label}</button>
    <span class="finns__hint">Du får bara fråga efter en valör du har själv. Missar du säger de "Finns i sjön!" – då drar du ett kort.</span>
  </div>`;
}

function actionsHTML(view) {
  if (view.phase === 'lobby') {
    if (!view.you && !view.seats.some((s) => s.isYou)) {
      return `<button class="action-btn action-btn--deal" id="finns-join" ${ui.busy ? 'disabled' : ''}>
        🐟 Sätt dig (${kr(view.ante)})
      </button>`;
    }
    if (view.isHost) {
      const ready = view.seated >= view.minSeats;
      return `<button class="action-btn action-btn--deal" id="finns-start" ${ready && !ui.busy ? '' : 'disabled'}>
        🎬 Dela ut korten (${view.seated}/${view.maxSeats})
      </button>
      <span class="finns__hint">${ready ? 'Alla som sitter här är med – tryck för att dela ut.' : `Minst ${view.minSeats} spelare behövs.`}</span>`;
    }
    return `<span class="finns__hint">Väntar på att ${esc(view.hostName)} delar ut korten…</span>`;
  }

  if (view.phase === 'done') {
    return `<button class="action-btn action-btn--deal" id="finns-new">🐟 Nytt bord</button>
      <button class="action-btn action-btn--split" id="finns-board">↺ Alla bord</button>`;
  }
  return '';
}

function feedHTML(view) {
  if (!view.log || !view.log.length) return `<li class="rvb__event"><span class="rvb__event-dot"></span>Inget har hänt än.</li>`;
  return view.log
    .slice(0, 8)
    .map((e) => `<li class="rvb__event ${e.kind ? 'is-' + esc(e.kind) : ''}"><span class="rvb__event-dot"></span>${esc(e.text)}</li>`)
    .join('');
}

function resultHTML(view) {
  if (view.phase !== 'done') return '';
  if (view.winners && view.winners.length) {
    const youWon = view.you && view.winners.some((w) => w.playerId === view.you.playerId);
    const tie = view.winners.length > 1;
    return `<div class="rvb__result ${youWon ? 'is-you' : ''}">
      <div class="rvb__result-title">${youWon ? '🏆 Du vann kassan!' : tie ? '🤝 Kassan delades' : `🏆 ${esc(view.winners[0].name)} vann kassan`}</div>
      <div class="rvb__result-sum">${kr(view.prize)}</div>
      <div class="rvb__result-sub">${view.winners
        .map((w) => `${esc(w.name)}: ${w.books} fyrtal (${kr(w.prize)})`)
        .join(' · ')}</div>
    </div>`;
  }
  return `<div class="rvb__result">
    <div class="rvb__result-title">Bordet stängdes</div>
    <div class="rvb__result-sum">${view.expired ? 'Ingen kom' : view.voided ? 'Matchen avbröts' : 'Inga fyrtal'}</div>
    <div class="rvb__result-sub">Alla fick tillbaka sin insats.</div>
  </div>`;
}

/* ------------------------------ bordsvyn ------------------------------ */

function tableHTML(view) {
  const yourTurn = view.you && view.you.isTurn && view.phase === 'playing';
  const books = view.you && view.you.books.length;
  return `<div class="finns">
    <div class="rvb__bar">
      <div class="rvb__pot">
        <span class="rvb__pot-label">Kassan</span>
        <strong class="rvb__pot-sum">${kr(view.pot || view.prize)}</strong>
      </div>
      <div class="rvb__meta">
        <span class="mini-pill">Insats <strong>${kr(view.ante)}</strong></span>
        <span class="mini-pill">Spelare <strong>${view.seated}/${view.maxSeats}</strong></span>
        <span class="mini-pill">Frågor <strong>${view.asks}</strong></span>
        ${books ? `<span class="mini-pill">Dina fyrtal <strong>${books}</strong></span>` : ''}
      </div>
      <div class="spacer"></div>
      <button class="btn btn--sm btn--ghost" id="finns-invite">🔗 Bjud in</button>
      <button class="btn btn--sm btn--ghost" id="finns-leave">${
        view.phase === 'lobby' ? 'Lämna (få igen)' : 'Lämna bordet'
      }</button>
    </div>

    <div class="rvb__status ${yourTurn ? 'is-you' : ''} ${view.phase === 'done' ? 'is-done' : ''}">
      <span class="rvb__status-text">${
        view.phase === 'playing'
          ? yourTurn
            ? '🐟 Din tur – fråga någon om ett kort'
            : `⏳ ${esc(view.turnName)}s tur`
          : esc(phaseText(view))
      }</span>
      ${view.phase === 'playing' ? '<span class="rvb__clock" id="finns-clock"><i></i></span>' : ''}
    </div>

    <div class="finns__board">
      ${seatsHTML(view)}
      ${seaHTML(view)}
    </div>

    ${view.you ? `<div class="finns__mine">
      <div class="finns__mine-head">
        <h3>Din hand</h3>
        <span class="finns__hint">Tryck på ett kort för att välja valör – fråga sedan någon.</span>
      </div>
      ${handHTML(view)}
      ${
        view.you.books.length
          ? `<div class="finns__my-books"><span class="finns__hint">Dina fyrtal:</span>${view.you.books
              .map((r) => `<span class="finns__book">${esc(r)}</span>`)
              .join('')}</div>`
          : ''
      }
    </div>` : ''}

    <div class="action-bar rvb__actions" id="finns-actions">${actionsHTML(view)}</div>
    ${askHTML(view)}
    ${resultHTML(view)}

    <div class="rvb__feed-wrap">
      <h3>Vid bordet</h3>
      <ol class="rvb__feed">${feedHTML(view)}</ol>
    </div>
  </div>`;
}

/* ------------------------------ lobbyn ------------------------------ */

function boardHTML(board) {
  const ante = board.ante || board.min || 10;
  const chips = [25, 50, 100, 250, 500].filter((v) => v >= board.min && v <= board.max);
  return `<div class="rvb rvb--board">
    <div class="rvb__panels">
      <section class="rvb__panel">
        <h2>Öppna ett bord</h2>
        <p class="rvb__panel-text">
          Två till sex spelare lägger <b>samma insats</b> i kassan. Korten delas ut och sedan
          frågar ni varandra efter valörer. Den som har <b>flest fyrtal</b> när korten är slut
          tar kassan – huset tar ingenting.
        </p>
        <div class="bet-field">
          <span class="bet-field__label">Insats per spelare</span>
          <div class="bet-field__row">
            <input class="bet-field__input" id="finns-ante-input" type="number" inputmode="numeric"
                   min="${board.min}" max="${board.max}" step="${Math.max(1, board.min)}" value="${ante}" />
            <span class="bet-field__unit">kr</span>
            <button class="chip-mini" id="finns-ante-half">½</button>
            <button class="chip-mini" id="finns-ante-double">2×</button>
          </div>
        </div>
        <div class="chip-row">
          ${chips
            .map(
              (v, i) => `<button class="chip-btn" data-ante="${v}">
                <div class="poker-chip ${['', 'poker-chip--blue', 'poker-chip--green', 'poker-chip--black', 'poker-chip--gold'][i % 5]}" style="--chip-size:52px"><span>${
                  v >= 1000 ? v / 1000 + 'k' : v
                }</span></div>
              </button>`
            )
            .join('')}
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:4px">
          <span class="mini-pill">Min <strong>${kr(board.min)}</strong></span>
          <span class="mini-pill">Max <strong>${kr(board.max)}</strong></span>
          <span class="mini-pill">Saldo <strong>${kr(state.player?.balance ?? 0)}</strong></span>
        </div>
        <button class="action-btn action-btn--deal" id="finns-create" ${ui.busy ? 'disabled' : ''}>
          🐟 Öppna bordet (${kr(ante)})
        </button>

        <h3 class="finns__rules-title">Så spelas det</h3>
        <ol class="finns__rules">
          <li>Fråga en motspelare efter en valör du har minst ett kort av.</li>
          <li>Har hen korten får du dem – och får fråga igen.</li>
          <li>Har hen inte korten säger hen <b>"Finns i sjön!"</b> – då drar du ett kort ur sjön.</li>
          <li>Fyra lika blir ett fyrtal. Flest fyrtal när korten är slut vinner kassan.</li>
        </ol>
      </section>

      <section class="rvb__panel">
        <h2>Bord just nu ${board.loading ? '<span class="mini-pill">uppdaterar…</span>' : ''}</h2>
        <p class="rvb__panel-text">Sätt dig vid ett bord som väntar på spelare – du betalar samma insats som de andra.</p>
        <div class="rvb__list" id="finns-list">
          ${
            board.tables && board.tables.length
              ? board.tables
                  .map(
                    (t) => `<div class="rvb__row ${t.joined ? 'is-mine' : ''}">
                      <span class="rvb__row-ante">${kr(t.ante)}</span>
                      <span class="rvb__row-host">${esc(t.hostName)}s bord</span>
                      <span class="rvb__row-seats">${t.seats}/${t.maxSeats} spelare</span>
                      <span class="rvb__row-phase">${t.phase === 'lobby' ? 'väntar' : 'igång'}</span>
                      ${
                        t.joined
                          ? `<button class="btn btn--sm btn--primary" data-open="${t.id}">Till bordet</button>`
                          : t.phase === 'lobby'
                          ? `<button class="btn btn--sm btn--primary" data-join="${t.id}" ${ui.busy ? 'disabled' : ''}>Sätt dig</button>`
                          : `<span class="rvb__row-locked">pågår</span>`
                      }
                    </div>`
                  )
                  .join('')
              : `<div class="rvb__empty">Inga öppna bord just nu – öppna ett själv och bjud in.</div>`
          }
        </div>
        <p class="rvb__panel-foot tiny muted">
          Du kan bara sitta vid ett bord i taget. Lämnar du väntrummet får du tillbaka insatsen.
        </p>
      </section>
    </div>
  </div>`;
}

/* ------------------------------ målning ------------------------------ */

function paint() {
  const root = ui.root;
  if (!root) return;
  const body = root.querySelector('#finns-body');
  if (!body) return;

  if (ui.tableId && ui.view) {
    const view = ui.view;
    /* Har draget redan gjorts försvinner valören ur handen – då ska inget
       gammalt val ligga kvar och se ut som att det går att fråga på. */
    if (ui.rank && view.you && !view.you.ranks.includes(ui.rank)) ui.rank = '';
    if (ui.target >= 0 && view.you && !view.you.targets.includes(ui.target)) ui.target = -1;
    const sig = JSON.stringify({ ...view, secondsLeft: 0, serverNow: 0 });
    if (sig !== ui.sig) {
      ui.sig = sig;
      body.innerHTML = tableHTML(view);
      bindTable(view);
      playSounds(view);
    }
    tickClock();
    return;
  }

  if (ui.tableId && !ui.view) {
    body.innerHTML = `<div class="rvb rvb--board"><div class="rvb__panel">
      <h2>Hämtar bordet…</h2>
      <p class="rvb__panel-text">${ui.error ? esc(ui.error) : 'Ett ögonblick.'}</p>
      <button class="btn btn--sm btn--ghost" id="finns-board">↺ Alla bord</button>
    </div></div>`;
    const back = body.querySelector('#finns-board');
    if (back) back.addEventListener('click', () => openBoard());
    return;
  }

  const board = ui.board || { ante: 100, tables: [], min: 10, max: 500, loading: true };
  const sig = JSON.stringify(board);
  if (sig !== ui.boardSig) {
    ui.boardSig = sig;
    body.innerHTML = boardHTML(board);
    bindBoard();
  }
}

function repaint() {
  ui.sig = '';
  paint();
}

function playSounds(view) {
  const ask = view.lastAsk;
  if (ask && Number(ask.at) && Number(ask.at) !== ui.lastAskAt) {
    ui.lastAskAt = Number(ask.at);
    const mine = view.you && view.seats.some((s) => s.isYou && s.index === ask.from);
    if (ask.hit) sfx.chip();
    else sfx.wrong();
    if (mine && ask.hit && ask.count >= 2) sfx.deal();
  }
  if (view.phase === 'done' && view.winners && view.winners.length && ui.sig === '') sfx.win();
}

function tickClock() {
  const root = ui.root;
  const view = ui.view;
  if (!root || !view || view.phase !== 'playing') return;
  const bar = root.querySelector('#finns-clock i');
  const total = Number(view.turnMs) || FINNS_MATH.TURN_MS;
  const left = Math.max(0, Number(view.autoAt) - Date.now());
  if (bar) {
    bar.style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
    bar.classList.toggle('is-low', left < 12000);
  }
  if (left <= 0 && !ui.busy) pollTable();
}

/* ------------------------------ händelser ------------------------------ */

function bindBoard() {
  const root = ui.root;
  if (!root) return;
  const input = root.querySelector('#finns-ante-input');
  const setAnte = (value) => {
    const board = ui.board || {};
    const max = Number(board.max) || 100000;
    const min = Number(board.min) || 1;
    const next = Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
    root.querySelectorAll('[data-ante]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.ante) === next));
    if (input) input.value = next;
    const btn = root.querySelector('#finns-create');
    if (btn) btn.innerHTML = `🐟 Öppna bordet (${kr(next)})`;
    if (ui.board) ui.board.ante = next;
    ui.boardSig = '';
  };

  if (input) input.addEventListener('change', () => setAnte(input.value));
  root.querySelectorAll('[data-ante]').forEach((btn) =>
    btn.addEventListener('click', () => {
      sfx.chip();
      setAnte(Number(btn.dataset.ante));
    })
  );
  const half = root.querySelector('#finns-ante-half');
  if (half) half.addEventListener('click', () => setAnte((Number(input?.value) || 100) / 2));
  const dbl = root.querySelector('#finns-ante-double');
  if (dbl) dbl.addEventListener('click', () => setAnte((Number(input?.value) || 100) * 2));

  const create = root.querySelector('#finns-create');
  if (create) create.addEventListener('click', () => createTable(Number(input?.value) || ui.board?.ante || 100));

  root.querySelectorAll('[data-join]').forEach((btn) => btn.addEventListener('click', () => joinTable(btn.dataset.join)));
  root.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => enterTable(btn.dataset.open)));
}

function bindTable(view) {
  const root = ui.root;
  if (!root) return;
  const on = (id, fn) => {
    const el = root.querySelector('#' + id);
    if (el) el.addEventListener('click', fn);
  };
  on('finns-start', () => startMatch());
  on('finns-join', () => joinTable(view.id));
  on('finns-leave', () => leaveTable());
  on('finns-invite', () => invite());
  on('finns-new', () => openBoard());
  on('finns-board', () => openBoard());
  on('finns-ask', () => askNow());

  root.querySelectorAll('.finns__card[data-rank]').forEach((btn) =>
    btn.addEventListener('click', () => {
      ui.rank = ui.rank === btn.dataset.rank ? '' : btn.dataset.rank;
      sfx.click();
      repaint();
    })
  );
  root.querySelectorAll('.finns__seat[data-target], .finns__target[data-target]').forEach((btn) =>
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const index = Number(btn.dataset.target);
      ui.target = ui.target === index ? -1 : index;
      sfx.click();
      repaint();
    })
  );
}

/* ------------------------------ anrop ------------------------------ */

async function createTable(ante) {
  if (ui.busy) return;
  ui.busy = true;
  try {
    const data = await api.finns('table', { ante });
    ui.tableId = data.table.id;
    ui.view = data.table;
    ui.sig = '';
    ui.error = '';
    ui.rank = '';
    ui.target = -1;
    sfx.chip();
    updateBalanceUI();
    startPolling();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.tableId) {
      ui.tableId = err.data.tableId;
      startPolling();
      pollTable();
      toast('Du satt redan vid ett bord', 'bad');
    } else {
      toast(err.message, 'bad');
    }
  } finally {
    ui.busy = false;
    repaint();
  }
}

async function joinTable(id) {
  if (ui.busy || !id) return;
  ui.busy = true;
  try {
    const data = await api.finns('join', { id });
    ui.tableId = id;
    ui.view = data.table;
    ui.sig = '';
    ui.error = '';
    ui.rank = '';
    ui.target = -1;
    sfx.chip();
    updateBalanceUI();
    startPolling();
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    ui.busy = false;
    repaint();
  }
}

async function leaveTable() {
  if (!ui.tableId || ui.busy) return;
  const view = ui.view;
  const playing = view && view.phase === 'playing';
  if (playing && !(await confirmLeave())) return;
  ui.busy = true;
  try {
    const data = await api.finns('leave', { id: ui.tableId });
    updateBalanceUI();
    if (data.refunded > 0) toast(`Du lämnade bordet och fick ${kr(data.refunded)} tillbaka`, 'ok');
    else if (playing) toast('Du lämnade matchen – insatsen ligger kvar i kassan', 'bad');
    openBoard();
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    ui.busy = false;
    repaint();
  }
}

function confirmLeave() {
  return new Promise((resolve) => {
    openModal({
      title: 'Lämna bordet?',
      sub: 'Insatsen ligger redan i kassan och betalas inte tillbaka när korten är delade.',
      body: '<p class="small muted">Korten du har på handen går tillbaka till bordet.</p>',
      actions: [
        { label: 'Stanna kvar', onClick: (close) => { close(); resolve(false); } },
        { label: 'Lämna', kind: 'danger', onClick: (close) => { close(); resolve(true); } }
      ]
    });
  });
}

async function startMatch() {
  if (!ui.tableId || ui.busy) return;
  ui.busy = true;
  try {
    const data = await api.finns('start', { id: ui.tableId });
    ui.view = data.table;
    ui.rank = '';
    ui.target = -1;
    sfx.deal();
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    ui.busy = false;
    repaint();
  }
}

async function askNow() {
  if (!ui.tableId || ui.busy) return;
  const view = ui.view;
  if (!view || view.phase !== 'playing' || !view.you || !view.you.isTurn) return;
  if (!ui.rank || ui.target < 0) return;
  ui.busy = true;
  sfx.deal();
  try {
    const data = await api.finns('ask', { id: ui.tableId, target: ui.target, rank: ui.rank });
    ui.view = data.table;
    ui.rank = '';
    ui.target = -1;
    if (data.hit) sfx.chip();
  } catch (err) {
    toast(err.message, 'bad');
    pollTable();
  } finally {
    ui.busy = false;
    repaint();
  }
}

/* ------------------------------ pollning ------------------------------ */

function onFinnsRoute() {
  const route = state.route;
  return !!route && route.casino && (route.parts || [])[1] === 'finns';
}

async function pollTable() {
  if (!ui.tableId || !ui.root) return;
  if (!onFinnsRoute()) {
    stopPolling();
    return;
  }
  if (document.hidden) return;
  try {
    const data = await api.finns('table?id=' + encodeURIComponent(ui.tableId));
    ui.view = data.table;
    ui.error = '';
    updateBalanceUI();
    paint();
  } catch (err) {
    if (err.status === 404) {
      ui.tableId = '';
      ui.view = null;
      ui.sig = '';
      stopPolling();
      toast('Bordet finns inte längre', 'bad');
      openBoard();
    } else {
      ui.error = err.message;
    }
  }
}

async function refreshBoard({ silent = false } = {}) {
  if (!ui.board) ui.board = { ante: 100, tables: [], min: 10, max: 500, loading: true };
  if (!silent) ui.board.loading = true;
  try {
    const data = await api.finns('tables');
    ui.board = { ante: data.ante, tables: data.tables || [], min: data.min, max: data.max, loading: false };
    if (data.mine && !ui.tableId) {
      ui.tableId = data.mine;
      startPolling();
      pollTable();
      return;
    }
    const next = JSON.stringify(ui.board);
    if (silent && next === ui.boardSig) return;
    ui.boardSig = '';
    paint();
  } catch (err) {
    ui.board.loading = false;
    ui.error = err.message;
    ui.boardSig = '';
    paint();
  }
}

/* ------------------------------ lägen ------------------------------ */

function startPolling() {
  stopPolling();
  ui.poll = setInterval(pollTable, FINNS_MATH.POLL_MS);
  ui.clock = setInterval(tickClock, 200);
}

function startBoardPolling() {
  stopPolling();
  ui.poll = setInterval(() => {
    if (!onFinnsRoute()) {
      stopPolling();
      return;
    }
    if (document.hidden || ui.tableId || ui.busy) return;
    refreshBoard({ silent: true });
  }, 4000);
}

function stopPolling() {
  if (ui.poll) clearInterval(ui.poll);
  if (ui.clock) clearInterval(ui.clock);
  ui.poll = null;
  ui.clock = null;
}

function enterTable(id) {
  ui.tableId = id;
  ui.view = null;
  ui.sig = '';
  ui.rank = '';
  ui.target = -1;
  startPolling();
  pollTable();
  paint();
}

function openBoard() {
  ui.tableId = '';
  ui.view = null;
  ui.sig = '';
  ui.error = '';
  ui.boardSig = '';
  ui.rank = '';
  ui.target = -1;
  stopPolling();
  startBoardPolling();
  if (location.hash.indexOf('/finns/') > 0) navigate('/kasino/finns');
  refreshBoard();
  paint();
}

function invite() {
  const id = ui.tableId || (ui.view && ui.view.id);
  if (!id) return;
  const url = location.origin + location.pathname + '#/kasino/finns/' + id;
  const done = () => toast('Länken är kopierad – skicka den till den du vill spela mot', 'ok');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => showInvite(url));
      return;
    }
  } catch (e) {
    /* faller igenom */
  }
  showInvite(url);
}

function showInvite(url) {
  openModal({
    title: '🔗 Bjud in till bordet',
    sub: 'Skicka länken till den du vill spela mot – alla betalar samma insats.',
    body: `<div class="rvb__invite"><code>${esc(url)}</code></div>
      <p class="tiny muted" style="margin-top:10px">Bordet kan också hittas under <b>Finns i sjön</b> i spelhallen.</p>`,
    actions: [{ label: 'Klart' }]
  });
}

/* ------------------------------ vyn ------------------------------ */

function renderFinns(root, route) {
  ui.root = root;
  const wanted = (route.parts && route.parts[2]) || '';

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Finns i sjön</h1>
          <p>Fråga, samla fyrtal – flest fyrtal när korten är slut tar kassan</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--ghost" id="finns-home">← Spelhallen</button>
      </div>
      <div id="finns-body"></div>
    </div>`;

  root.querySelector('#finns-home').addEventListener('click', () => {
    sfx.click();
    navigate('/kasino');
  });

  document.onkeydown = null;

  if (wanted && wanted !== ui.tableId) {
    enterTable(wanted);
    return;
  }

  if (ui.tableId) {
    startPolling();
    pollTable();
    paint();
    return;
  }

  startBoardPolling();
  refreshBoard();
  paint();
}

/** Stoppar pollningen när man lämnar vyn. */
export function stopFinns() {
  stopPolling();
  ui.root = null;
}

registerView('finns', renderFinns);
