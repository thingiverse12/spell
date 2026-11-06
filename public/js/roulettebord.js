/* =====================================================================
   Roulette mot varandra – flera spelare, ett hjul och samma snurr.

   Alla som sitter vid bordet lägger sina marker under en satsningsfas.
   När alla har satsat (eller tiden är ute) drar servern ett nummer som
   gäller för hela bordet och betalar ut med samma fasta odds som
   ensamspelet – utan tur, så att två spelare aldrig får olika betalt för
   samma satsning. Sedan börjar nästa runda av sig själv.

   Vyn hämtar bordets läge med några sekunders mellanrum och ritar bara om
   när något faktiskt har hänt.
   ===================================================================== */

import { state, api, sfx, toast, kr, num, esc, navigate, updateBalanceUI, openModal } from './core.js';

/* Samma siffror som servern (lib/api.js) – exporteras så att npm run audit
   kan kontrollera bordet utanför webbläsaren. */
export const ROULETTE_BORD_MATH = {
  MAX_SEATS: 8,
  MAX_BETS: 4,
  BET_MS: 30 * 1000,
  RESULT_MS: 7 * 1000,
  POLL_MS: 1200,
  PAYOUTS: { straight: 36, zero: 36, dozen: 3, column: 3, even: 2 }
};

const POLL_MS = ROULETTE_BORD_MATH.POLL_MS;
const MAX_BETS = ROULETTE_BORD_MATH.MAX_BETS;
const OUTSIDE_MULT = ROULETTE_BORD_MATH.PAYOUTS.even;

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20,
  14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];
const COLUMNS = [
  { key: 'col1', label: '2:1', hit: (n) => n !== 0 && n % 3 === 1 },
  { key: 'col2', label: '2:1', hit: (n) => n !== 0 && n % 3 === 2 },
  { key: 'col3', label: '2:1', hit: (n) => n !== 0 && n % 3 === 0 }
];
const DOZENS = [
  { key: 'dozen1', label: '1:A DUSSIN' },
  { key: 'dozen2', label: '2:A DUSSIN' },
  { key: 'dozen3', label: '3:E DUSSIN' }
];
const OUTSIDE = [
  { key: 'low', label: '1–18' },
  { key: 'even', label: 'JÄMN' },
  { key: 'odd', label: 'UDDA' },
  { key: 'high', label: '19–36' }
];

const ui = {
  root: null,
  tableId: '',
  view: null,
  sig: '',
  board: null,
  boardSig: '',
  busy: false,
  error: '',
  chip: 25,
  draft: {},
  poll: null,
  clock: null,
  send: null,
  lastSpin: -1,
  skewed: 0
};

/* ------------------------------ smådelar ------------------------------ */

const pocketColor = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const colorName = (n) => (n === 0 ? 'grönt' : RED.has(n) ? 'rött' : 'svart');
const initial = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?';

const draftTotal = () => Object.keys(ui.draft).reduce((sum, key) => sum + (Number(ui.draft[key]) || 0), 0);
const draftCount = () => Object.keys(ui.draft).filter((key) => ui.draft[key] > 0).length;

/** Sekunder kvar av fasen – räknat mot serverns klocka, inte webbläsarens. */
function secondsLeft(view) {
  const until = view.phase === 'result' ? view.resultUntil : view.deadline;
  if (!until) return 0;
  return Math.max(0, Math.ceil((until - (Date.now() + ui.skewed)) / 1000));
}

function statusText(view) {
  const you = view.you;
  if (!you) {
    return view.phase === 'result'
      ? `🎡 Hjulet stannade på ${view.number} ${colorName(view.number)} – gå med till nästa runda`
      : `👀 Du tittar på bordet – gå med för att lägga marker (${secondsLeft(view)} s kvar)`;
  }
  if (view.phase === 'result') {
    const n = view.number;
    return `🎡 Hjulet stannade på ${n} ${colorName(n)} – nästa runda om ${secondsLeft(view)} s`;
  }
  const ready = view.seats.filter((seat) => seat.ready).length;
  if (you && you.staked > 0) {
    const waiting = view.seats.filter((seat) => !seat.isYou && !seat.ready).map((seat) => seat.name);
    return waiting.length
      ? `✅ Din insats är lagd (${kr(you.staked)}) – väntar på ${waiting.join(', ')}`
      : `✅ Din insats är lagd (${kr(you.staked)}) – hjulet snurrar snart`;
  }
  if (ready) return `⏳ ${ready} av ${view.seated} har lagt sina marker – ${secondsLeft(view)} s kvar`;
  return `🃏 Lägg dina marker – ${secondsLeft(view)} s kvar`;
}

/* ------------------------------ bordet ------------------------------ */

function cellHTML(key, label, cls, extra = '') {
  const amount = ui.draft[key] || 0;
  return `<button class="ru-cell ${cls}${amount ? ' is-bet' : ''}" data-bet="${key}" ${extra}>
    <span>${label}</span>${amount ? `<b class="ru-chip">${num(amount)}</b>` : ''}
  </button>`;
}

function tableHTML(view) {
  /* Den som öppnat en bjud-in-länk men inte gått med ska se bordet men inte
     kunna lägga marker förrän hen tryckt på Gå med. */
  const locked = view.phase !== 'betting' || !view.you;
  const numbers = [];
  for (let row = 0; row < 12; row += 1) {
    for (let col = 1; col <= 3; col += 1) {
      const n = row * 3 + col;
      numbers.push(cellHTML('n:' + n, String(n), 'ru-num ru-' + pocketColor(n), locked ? 'disabled' : ''));
    }
  }
  return `
    <div class="ru-grid">
      <div class="ru-zero">${cellHTML('n:0', '0<em class="ru-zero__mult">×36</em>', 'ru-num ru-green ru-zero__btn', locked ? 'disabled' : '')}</div>
      <div class="ru-numbers">${numbers.join('')}</div>
      <div class="ru-columns">${COLUMNS.map((c) =>
        cellHTML(c.key, c.label, 'ru-col', `aria-label="Kolumn" ${locked ? 'disabled' : ''}`)
      ).join('')}</div>
    </div>
    <div class="ru-dozens">${DOZENS.map((d) => cellHTML(d.key, d.label, 'ru-out', locked ? 'disabled' : '')).join('')}</div>
    <div class="ru-outside">${OUTSIDE.map((o) =>
      cellHTML(o.key, o.label, 'ru-out ru-plain', locked ? 'disabled' : '')
    ).join('')}</div>`;
}

function playersHTML(view) {
  return view.seats
    .map((seat) => {
      const result = seat.result;
      const net = result ? result.net : 0;
      return `<div class="rub__player ${seat.isYou ? 'is-you' : ''} ${seat.ready ? 'is-ready' : ''}">
        <span class="rub__avatar">${seat.isYou ? '🙋' : esc(initial(seat.name))}</span>
        <span class="rub__who">
          <b>${esc(seat.name)}${seat.isHost ? ' <span class="rvb__host">värd</span>' : ''}</b>
          <small>${
            view.phase === 'result' && result
              ? `satsade ${kr(result.staked)} · fick ${kr(result.payout)}`
              : seat.staked > 0
              ? `har lagt ${kr(seat.staked)}`
              : 'har inte satsat'
          }</small>
        </span>
        <span class="rub__amount">
          ${
            view.phase === 'result' && result && result.staked > 0
              ? `<b class="${net > 0 ? 'is-plus' : net < 0 ? 'is-minus' : ''}">${net > 0 ? '+' : net < 0 ? '−' : ''}${kr(Math.abs(net))}</b>`
              : seat.staked > 0
              ? `<b>${kr(seat.staked)}</b>`
              : '<span class="tiny muted">—</span>'
          }
          <small class="${seat.total > 0 ? 'is-plus' : seat.total < 0 ? 'is-minus' : ''}">${
            seat.total ? (seat.total > 0 ? '+' : '−') + kr(Math.abs(seat.total)) + ' totalt' : 'inget än'
          }</small>
        </span>
      </div>`;
    })
    .join('');
}

function feedHTML(view) {
  if (!view.log || !view.log.length) return '<li class="rvb__event"><span class="rvb__event-dot"></span>Inget har hänt än.</li>';
  return view.log
    .slice(0, 7)
    .map((entry) => `<li class="rvb__event ${entry.kind ? 'is-' + esc(entry.kind) : ''}">
      <span class="rvb__event-dot"></span>${esc(entry.text)}</li>`)
    .join('');
}

function tableScreenHTML(view) {
  const you = view.you;
  const number = view.number;
  const wheel = number === null
    ? `<div class="rub__number is-empty"><span>?</span><small>hjulets nästa nummer</small></div>`
    : `<div class="rub__number ru-${pocketColor(number)}"><span>${number}</span><small>${colorName(number)}</small></div>`;

  return `<div class="rvb">
    <div class="rvb__bar">
      <div class="rvb__pot">
        <span class="rvb__pot-label">På bordet nu</span>
        <strong class="rvb__pot-sum">${kr(view.pot)}</strong>
      </div>
      <div class="rvb__meta">
        <span class="mini-pill">Runda <strong>${view.round}</strong></span>
        <span class="mini-pill">Spelare <strong>${view.seated}/${view.maxSeats}</strong></span>
        <span class="mini-pill">Snurr <strong>${view.spins}</strong></span>
        ${you && you.staked > 0 ? `<span class="mini-pill">Din insats <strong>${kr(you.staked)}</strong></span>` : ''}
      </div>
      <div class="spacer"></div>
      <button class="btn btn--sm btn--ghost" id="rub-invite">🔗 Bjud in</button>
      <button class="btn btn--sm btn--ghost" id="rub-leave">Lämna bordet</button>
    </div>

    <div class="rvb__status ${view.phase === 'result' ? 'is-done' : ''}">
      <span class="rvb__status-text">${esc(statusText(view))}</span>
      <span class="rvb__clock" id="rub-clock"><i></i></span>
    </div>

    <div class="rub__layout">
      <div class="rub__main">
        ${wheel}
        <div class="roulette-table" id="rub-table">${tableHTML(view)}</div>
        ${
          you
            ? `<div class="roulette-chips" id="rub-chips"></div>
        <div class="roulette-controls">
          <span class="rub__sum">Din insats: <strong id="rub-total">${kr(draftTotal())}</strong>
            <em class="tiny muted">${draftCount()}/${MAX_BETS} vad</em></span>
          <button class="btn btn--sm btn--ghost" id="rub-clear" ${draftCount() ? '' : 'disabled'}>Rensa</button>
        </div>`
            : `<div class="rub__join">
                <button class="action-btn action-btn--deal" id="rub-join" ${ui.busy ? 'disabled' : ''}>
                  🎡 Gå med vid bordet (${view.seated}/${view.maxSeats})
                </button>
                <span class="tiny muted">Du betalar inget för att gå med – bara för markerna du lägger.</span>
              </div>`
        }
        <p class="tiny muted" style="margin:10px 0 0">
          Klicka på ett nummer eller en utsida för att lägga en marker – insatsen dras direkt och
          betalas tillbaka om du tar bort den. Högst <strong>${MAX_BETS} olika vad</strong> per runda.
          Enkelnummer och grön nolla ger <strong>36×</strong> (35:1), dussin och kolumn 3× (2:1),
          jämn/udda och låg/hög 2× (1:1). 2× betyder att du får tillbaka insatsen
          <em>plus</em> lika mycket igen. Vid bordet gäller de fasta oddsen för alla – turen hör
          till ensamspelet.
        </p>
      </div>

      <aside class="rub__side">
        <h3 style="font-size:15px;margin:0 0 10px">Vid bordet</h3>
        <div class="rub__players">${playersHTML(view)}</div>
        <h3 style="font-size:15px;margin:18px 0 8px">Händelser</h3>
        <ol class="rvb__feed">${feedHTML(view)}</ol>
      </aside>
    </div>
  </div>`;
}

/* ------------------------------ lobbyn ------------------------------ */

function boardHTML(board) {
  const balance = state.player?.balance ?? 0;
  const tables = board.tables || [];
  return `<div class="rub rub--board">
    <div class="rvb__panels">
      <section class="rvb__panel">
        <h2>Öppna ett bord</h2>
        <p class="rvb__panel-text">
          Alla satsar på <b>samma hjul</b>: ni lägger era marker samtidigt, hjulet snurrar en gång och
          alla får betalt enligt samma odds. Huset tar ingenting utöver de fasta oddsen, och det är
          inga riktiga pengar – bara spelmynt.
        </p>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin:14px 0">
          <span class="mini-pill">Min insats <strong>${kr(board.min)}</strong></span>
          <span class="mini-pill">Max insats <strong>${kr(board.max)}</strong></span>
          <span class="mini-pill">Saldo <strong>${kr(balance)}</strong></span>
        </div>
        <button class="action-btn action-btn--deal" id="rub-create" ${ui.busy ? 'disabled' : ''}>
          🎡 Öppna bordet
        </button>
        <p class="tiny muted" style="margin-top:10px">
          En runda tar ungefär ${Math.round(ROULETTE_BORD_MATH.BET_MS / 1000)} sekunder plus
          ${Math.round(ROULETTE_BORD_MATH.RESULT_MS / 1000)} sekunder för resultatet. Bjud in med
          länken så hoppar kompisarna in i samma bord.
        </p>
      </section>

      <section class="rvb__panel">
        <h2>Bord just nu ${board.loading ? '<span class="mini-pill">uppdaterar…</span>' : ''}</h2>
        <p class="rvb__panel-text">Gå med i ett bord som redan är igång – du hoppar in i nästa runda.</p>
        <div class="rvb__list" id="rub-list">
          ${
            tables.length
              ? tables
                  .map(
                    (t) => `<div class="rvb__row ${t.joined ? 'is-mine' : ''}">
                      <span class="rvb__row-ante">Runda ${t.round}</span>
                      <span class="rvb__row-host">${esc(t.hostName)}s bord</span>
                      <span class="rvb__row-seats">${t.seats}/${t.maxSeats} spelare</span>
                      <span class="rvb__row-phase">${t.phase === 'result' ? 'snurr' : 'satsning'}</span>
                      ${
                        t.joined
                          ? `<button class="btn btn--sm btn--primary" data-open="${t.id}">Till bordet</button>`
                          : `<button class="btn btn--sm btn--primary" data-join="${t.id}" ${ui.busy ? 'disabled' : ''}>Gå med</button>`
                      }
                    </div>`
                  )
                  .join('')
              : '<div class="rvb__empty">Inga bord just nu – öppna ett själv och bjud in.</div>'
          }
        </div>
        <p class="rvb__panel-foot tiny muted">
          Du kan bara sitta vid ett bord i taget. Lämnar du bordet får du tillbaka markerna som ligger ute.
        </p>
      </section>
    </div>
  </div>`;
}

/* ------------------------------ målning ------------------------------ */

function paint() {
  const root = ui.root;
  if (!root) return;
  const body = root.querySelector('#rub-body');
  if (!body) return;

  if (ui.tableId && ui.view) {
    const sig = JSON.stringify({
      phase: ui.view.phase,
      round: ui.view.round,
      number: ui.view.number,
      seats: ui.view.seats.map((s) => [s.name, s.staked, s.payout, s.ready, s.total]),
      log: (ui.view.log || []).map((l) => l.text),
      draft: ui.draft
    });
    if (sig !== ui.sig) {
      ui.sig = sig;
      body.innerHTML = tableScreenHTML(ui.view);
      bindTable();
      renderChips();
    }
    tickClock();
    return;
  }

  if (ui.tableId && !ui.view) {
    body.innerHTML = `<div class="rub rub--board"><div class="rvb__panel">
      <h2>Hämtar bordet…</h2>
      <p class="rvb__panel-text">${ui.error ? esc(ui.error) : 'Ett ögonblick.'}</p>
      <button class="btn btn--sm btn--ghost" id="rub-board">↺ Alla bord</button>
    </div></div>`;
    const back = body.querySelector('#rub-board');
    if (back) back.addEventListener('click', () => openBoard());
    return;
  }

  const board = ui.board || { tables: [], min: 10, max: 100, loading: true };
  const sig = JSON.stringify(board);
  if (sig !== ui.boardSig) {
    ui.boardSig = sig;
    body.innerHTML = boardHTML(board);
    bindBoard();
  }
}

function repaint() {
  ui.sig = '';
  ui.boardSig = '';
  paint();
}

function renderChips() {
  const root = ui.root;
  const box = root && root.querySelector('#rub-chips');
  if (!box) return;
  const values = [10, 25, 50, 100, 250].filter((v) => v >= (ui.view?.limits?.min || 1));
  box.innerHTML = values
    .map(
      (v, i) => `<button class="ru-chip-btn${v === ui.chip ? ' is-active' : ''}" data-chip="${v}">
        <span class="poker-chip ${['poker-chip--blue', 'poker-chip--green', '', 'poker-chip--black', 'poker-chip--gold'][i % 5]}" style="--chip-size:42px"><span>${v}</span></span>
      </button>`
    )
    .join('');
  box.querySelectorAll('[data-chip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.chip = Number(btn.dataset.chip) || ui.chip;
      sfx.chip();
      renderChips();
    });
  });
}

function tickClock() {
  const root = ui.root;
  const view = ui.view;
  if (!root || !view) return;
  const bar = root.querySelector('#rub-clock i');
  if (!bar) return;
  const total = view.phase === 'result' ? ROULETTE_BORD_MATH.RESULT_MS : ROULETTE_BORD_MATH.BET_MS;
  const left = secondsLeft(view);
  bar.style.width = Math.max(0, Math.min(100, (left / (total / 1000)) * 100)) + '%';
  bar.classList.toggle('is-low', left < 8);
}

/* ------------------------------ händelser ------------------------------ */

function bindBoard() {
  const root = ui.root;
  if (!root) return;
  const create = root.querySelector('#rub-create');
  if (create) create.addEventListener('click', () => createTable());
  root.querySelectorAll('[data-join]').forEach((btn) =>
    btn.addEventListener('click', () => joinTable(btn.dataset.join))
  );
  root.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => enterTable(btn.dataset.open))
  );
}

function bindTable() {
  const root = ui.root;
  if (!root) return;
  const on = (id, fn) => {
    const el = root.querySelector('#' + id);
    if (el) el.addEventListener('click', fn);
  };
  on('rub-invite', () => invite());
  on('rub-leave', () => leaveTable());
  on('rub-join', () => joinTable(ui.view && ui.view.id));
  on('rub-clear', () => {
    if (!ui.view || ui.view.phase !== 'betting') return;
    ui.draft = {};
    sfx.click();
    repaint();
    queueBets({});
  });
  root.querySelectorAll('[data-bet]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      placeChip(el.dataset.bet, 1);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      placeChip(el.dataset.bet, -1);
    });
  });
}

/* ------------------------------ anrop ------------------------------ */

function placeChip(key, dir) {
  const view = ui.view;
  if (!view) return;
  if (view.phase !== 'betting') {
    toast('Hjulet snurrar – vänta till nästa runda', 'bad', 2000);
    return;
  }
  const limits = view.limits || { min: 10, max: 1e15 };
  const balance = state.player?.balance ?? 0;
  const current = ui.draft[key] || 0;
  const next = current + dir * ui.chip;

  if (dir < 0 && current <= 0) return;
  if (dir > 0 && current === 0 && draftCount() >= MAX_BETS) {
    toast(`Högst ${MAX_BETS} olika vad per runda`, 'bad', 2400);
    return;
  }
  if (dir > 0 && draftTotal() + ui.chip > balance) {
    toast('Inte tillräckligt med spelmynt – ta en bonus!', 'bad');
    return;
  }
  if (dir > 0 && draftTotal() + ui.chip > limits.max) {
    toast(`Högsta insats är ${kr(limits.max)}`, 'bad');
    return;
  }

  const chips = { ...ui.draft };
  if (next > 0) chips[key] = next;
  else delete chips[key];
  ui.draft = chips;
  sfx.chip();
  repaint();
  queueBets(chips);
}

/** Skickar hela markerkartan – servern drar bara mellanskillnaden. */
function queueBets(chips) {
  if (ui.send) clearTimeout(ui.send);
  ui.send = setTimeout(() => sendBets(), 220);
}

async function sendBets() {
  ui.send = null;
  if (!ui.tableId) return;
  const view = ui.view;
  if (!view || view.phase !== 'betting') return;
  try {
    const data = await api.rouletteBord('bet', { id: ui.tableId, chips: ui.draft });
    applyTable(data.table);
  } catch (err) {
    toast(err.message, 'bad', 2600);
    if (err.status === 409 || err.status === 404) {
      ui.draft = {};
      pollTable();
    }
  }
}

function applyTable(table) {
  if (!table) return;
  ui.view = table;
  ui.skewed = Number(table.serverNow) - Date.now();
  updateBalanceUI();
  playSounds(table);
  repaint();
}

function playSounds(view) {
  if (view.phase === 'result' && Number(view.spins) !== ui.lastSpin) {
    ui.lastSpin = Number(view.spins);
    const you = view.you;
    if (you && you.payout > 0) sfx.win();
    else sfx.lose();
  }
}

/* Adressfältet ska peka på bordet man sitter vid. Då överlever man en
   omladdning, och appen som ritar om vyn (t.ex. när saldot ändras efter en
   vinst) hittar tillbaka till samma bord i stället för till lobbyn. */
function syncHash(id) {
  const want = id ? `#/kasino/roulette/bord/${id}` : '#/kasino/roulette/bord';
  if (window.location.hash === want) return;
  try {
    window.history.replaceState(null, '', want);
  } catch (e) {
    /* Bara kosmetika – vyn fungerar även om adressen inte går att byta. */
  }
}

async function createTable() {
  if (ui.busy) return;
  ui.busy = true;
  repaint();
  try {
    const data = await api.rouletteBord('table', {});
    ui.tableId = data.table.id;
    syncHash(ui.tableId);
    ui.draft = {};
    ui.lastSpin = Number(data.table.spins) || 0;
    applyTable(data.table);
    startPolling();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.tableId) {
      ui.tableId = err.data.tableId;
      syncHash(ui.tableId);
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
  repaint();
  try {
    const data = await api.rouletteBord('join', { id });
    ui.tableId = data.table.id;
    syncHash(ui.tableId);
    ui.draft = (data.table.you && data.table.you.chips) || {};
    ui.lastSpin = Number(data.table.spins) || 0;
    applyTable(data.table);
    startPolling();
    sfx.click();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.tableId) {
      ui.tableId = err.data.tableId;
      syncHash(ui.tableId);
      startPolling();
      pollTable();
    }
    toast(err.message, 'bad');
  } finally {
    ui.busy = false;
    repaint();
  }
}

async function leaveTable() {
  if (ui.busy || !ui.tableId) return;
  ui.busy = true;
  const id = ui.tableId;
  try {
    const data = await api.rouletteBord('leave', { id });
    sfx.click();
    if (data.closed) toast('Bordet stängdes – markerna är tillbaka på saldot', 'ok');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    stopPolling();
    ui.busy = false;
    openBoard();
  }
}

function invite() {
  const id = ui.tableId || (ui.view && ui.view.id);
  if (!id) return;
  const url = location.origin + location.pathname + '#/kasino/roulette/bord/' + id;
  const done = () => toast('Länken är kopierad – skicka den till den du vill spela med', 'ok');
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
    sub: 'Skicka länken – kompisen hoppar in i samma hjul och satsar egna mynt.',
    body: `<div class="rvb__invite"><code>${esc(url)}</code></div>
      <p class="tiny muted" style="margin-top:10px">Bordet syns också under <b>Roulette → Mot varandra</b>.</p>`,
    actions: [{ label: 'Klart' }]
  });
}

/* ------------------------------ pollning ------------------------------ */

const onBordRoute = () =>
  !!state.route && state.route.name === 'roulette' && (state.route.parts || [])[2] === 'bord';

async function pollTable() {
  if (!ui.tableId || !ui.root) return;
  if (!onBordRoute()) {
    stopPolling();
    return;
  }
  if (document.hidden) return;
  try {
    const data = await api.rouletteBord('table?id=' + encodeURIComponent(ui.tableId));
    /* Servern är facit för markerna – utom när ett klick är på väg dit. */
    if (!ui.send && data.table.you) ui.draft = { ...(data.table.you.chips || {}) };
    applyTable(data.table);
  } catch (err) {
    if (err.status === 404) {
      ui.tableId = '';
      ui.view = null;
      ui.draft = {};
      stopPolling();
      syncHash('');
      toast('Bordet finns inte längre', 'bad');
      openBoard();
    } else {
      ui.error = err.message;
    }
  }
}

async function refreshBoard({ silent = false } = {}) {
  if (!ui.board) ui.board = { tables: [], min: 10, max: 100, loading: true };
  if (!silent) ui.board.loading = true;
  try {
    const data = await api.rouletteBord('tables');
    ui.board = {
      tables: data.tables || [],
      min: data.min,
      max: data.max,
      loading: false
    };
    if (data.mine && !ui.tableId) {
      ui.tableId = data.mine;
      startPolling();
      await pollTable();
      return;
    }
    paint();
  } catch (err) {
    ui.board = { ...(ui.board || {}), loading: false };
    ui.error = err.message;
    paint();
  }
}

function startPolling() {
  stopPolling();
  ui.poll = setInterval(pollTable, POLL_MS);
  ui.clock = setInterval(tickClock, 500);
}

function stopPolling() {
  if (ui.poll) clearInterval(ui.poll);
  if (ui.clock) clearInterval(ui.clock);
  ui.poll = null;
  ui.clock = null;
}

function startBoardPolling() {
  stopPolling();
  ui.poll = setInterval(() => {
    if (!onBordRoute() || document.hidden) return;
    refreshBoard({ silent: true });
  }, 2500);
}

/* ------------------------------ vyn ------------------------------ */

function openBoard() {
  ui.tableId = '';
  syncHash('');
  ui.view = null;
  ui.sig = '';
  ui.boardSig = '';
  startBoardPolling();
  refreshBoard();
  paint();
}

export function renderRouletteBord(root, route) {
  ui.root = root;
  const wanted = (route.parts && route.parts[3]) || '';

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Roulette – mot varandra</h1>
          <p>Ett hjul, flera spelare och samma snurr – alla satsar egna spelmynt</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--ghost" id="rub-solo">🎡 Spela själv</button>
        <button class="btn btn--sm btn--ghost" id="rub-home">← Spelhallen</button>
      </div>
      <div id="rub-body"></div>
    </div>`;

  root.querySelector('#rub-solo').addEventListener('click', () => {
    sfx.click();
    navigate('/kasino/roulette');
  });
  root.querySelector('#rub-home').addEventListener('click', () => {
    sfx.click();
    navigate('/kasino');
  });

  document.onkeydown = null;

  if (wanted && wanted !== ui.tableId) {
    ui.tableId = wanted;
    ui.view = null;
    ui.draft = {};
    startPolling();
    pollTable();
    paint();
    return;
  }

  if (ui.tableId) {
    startPolling();
    pollTable();
    paint();
    return;
  }

  openBoard();
}

/** Stoppar pollningen när man lämnar vyn. */
export function stopRouletteBord() {
  stopPolling();
  ui.root = null;
  /* Bordet sparas med flit: appen ritar om vyn när saldot ändras (t.ex. efter
     en vinst), och då ska man vara kvar vid bordet – inte i lobbyn. */
  ui.view = null;
  ui.draft = {};
}
