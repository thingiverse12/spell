/* =====================================================================
   Rysk roulette mot varandra – ett bord, en revolver och en gemensam kassa.

   Alla som sitter vid bordet lägger samma insats i kassan. Sedan turas de
   om att trycka av samma revolver: en tom kammare betyder att du lever och
   att turen går vidare, kulan betyder att du är ute. Den som står kvar
   ensam tar hela kassan – huset tar ingenting.

   Kulan dras alltid på servern och skickas aldrig till klienten, så alla
   ser samma trumma och ingen kan se i förväg var kulan ligger. Vyn hämtar
   bordets läge med några sekunders mellanrum och ritar bara om när något
   faktiskt har hänt.
   ===================================================================== */

import { state, api, sfx, toast, kr, esc, navigate, updateBalanceUI, openModal } from './core.js';

/* Samma siffror som servern (lib/api.js) – exporteras så att npm run audit
   kan kontrollera bordsläget utanför webbläsaren. */
export const REVOLVER_BORD_MATH = {
  CHAMBERS: 6,
  MAX_SEATS: 6,
  MIN_SEATS: 2,
  TURN_MS: 45 * 1000,
  POLL_MS: 1200,
  HOUSE_CUT: 0
};

const POLL_MS = REVOLVER_BORD_MATH.POLL_MS;

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
  lastSound: 0,
  lastPullAt: 0,
  lastBangs: 0
};

/* ------------------------------ smådelar ------------------------------ */

const initial = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?';

function phaseText(view) {
  if (view.phase === 'lobby') return 'Väntrum – alla lägger sin insats innan start';
  if (view.phase === 'playing') return 'Matchen är igång';
  if (view.winner) return `${view.winner.name} vann kassan`;
  return 'Matchen är slut';
}

function seatTag(seat, view) {
  if (seat.left) return 'lämnade';
  if (!seat.alive) return 'ute';
  if (seat.isTurn) return 'trycker av';
  if (seat.isYou) return 'du';
  if (view.phase === 'lobby') return 'redo';
  return 'väntar';
}

function seatHTML(seat, view) {
  const cls = [
    'rvb__seat',
    seat.isYou ? 'is-you' : '',
    seat.isTurn ? 'is-turn' : '',
    !seat.alive ? 'is-out' : '',
    seat.left ? 'is-left' : ''
  ]
    .filter(Boolean)
    .join(' ');
  return `<div class="${cls}">
    <span class="rvb__avatar">${seat.alive ? esc(initial(seat.name)) : '💀'}</span>
    <span class="rvb__who">
      <b>${esc(seat.name)}${seat.isHost ? ' <span class="rvb__host">värd</span>' : ''}</b>
      <small>${esc(seatTag(seat, view))}</small>
    </span>
  </div>`;
}

function seatsHTML(view) {
  /* I väntrummet visas bara de som sitter kvar – platser som lämnats blir
     lediga igen. Under en match sitter alla kvar med sin status. */
  const list = view.phase === 'lobby' ? view.seats.filter((seat) => !seat.left) : view.seats;
  const seats = list.map((seat) => seatHTML(seat, view));
  if (view.phase === 'lobby') {
    for (let i = list.length; i < view.maxSeats; i += 1) {
      seats.push(`<div class="rvb__seat is-empty"><span class="rvb__avatar">+</span>
        <span class="rvb__who"><b>Ledig plats</b><small>bjud in någon</small></span></div>`);
    }
  }
  return `<div class="rvb__seats">${seats.join('')}</div>`;
}

/* Revolvern i mitten – samma pjäs som i ensamläget, men trumman stannar på
   den kammare som ligger under hanen just nu. */
function gunHTML(view) {
  const chamber = Math.max(0, Math.min(REVOLVER_BORD_MATH.CHAMBERS - 1, view.chamberNo - 1));
  const loaded = view.phase === 'playing' || view.phase === 'done';
  const jaw = view.lastPull && view.lastPull.fires ? 'is-shot' : '';
  const cells = Array.from({ length: REVOLVER_BORD_MATH.CHAMBERS }, (_, i) => {
    const done = loaded && i < chamber;
    const next = view.phase === 'playing' && i === chamber;
    const cls = ['revolver__chamber', done ? 'is-fired' : '', next ? 'is-next' : ''].filter(Boolean).join(' ');
    return `<span class="${cls}" style="transform: rotate(${i * (360 / REVOLVER_BORD_MATH.CHAMBERS)}deg) translateY(calc(-1 * var(--rev-radius, 72px)))">
      <span class="revolver__hole"></span>
    </span>`;
  }).join('');

  const yourTurn = view.you && view.you.isTurn && view.phase === 'playing';

  return `<div class="revolver ${yourTurn ? 'is-armed' : ''} ${jaw}">
    <div class="revolver__stage">
      <div class="revolver__flash"></div>
      <div class="revolver__gun">
        <div class="revolver__barrel"><span class="revolver__muzzle"></span></div>
        <div class="revolver__cylinder" style="transform: rotate(${-chamber * (360 / REVOLVER_BORD_MATH.CHAMBERS)}deg)">
          ${cells}
          <span class="revolver__pin"></span>
        </div>
        <div class="revolver__hammer"></div>
        <button class="revolver__trigger" id="rvb-trigger" ${yourTurn && !ui.busy ? '' : 'disabled'} aria-label="Tryck av">
          <span>Tryck av</span>
        </button>
        <div class="revolver__grip"></div>
      </div>
      <div class="revolver__caption">
        ${
          view.phase === 'playing'
            ? `Kammare <strong>${view.chamberNo}</strong> av ${view.chambers} · turen går till <strong>${esc(view.turnName)}</strong>`
            : view.phase === 'lobby'
            ? 'Trumman laddas när matchen startar'
            : 'Matchen är över'
        }
      </div>
    </div>
  </div>`;
}

function actionsHTML(view) {
  if (view.phase === 'lobby') {
    if (!view.you) {
      return `<button class="action-btn action-btn--deal" id="rvb-join" ${ui.busy ? 'disabled' : ''}>
        🔫 Gå med (${kr(view.ante)})
      </button>`;
    }
    if (view.isHost) {
      const ready = view.seated >= view.minSeats;
      return `<button class="action-btn action-btn--deal" id="rvb-start" ${ready && !ui.busy ? '' : 'disabled'}>
        🎬 Starta matchen (${view.seated}/${view.maxSeats})
      </button>
      <span class="rvb__hint">${ready ? 'Alla som sitter här är med – tryck start.' : `Minst ${view.minSeats} spelare behövs.`}</span>`;
    }
    return `<span class="rvb__hint">Väntar på att ${esc(view.hostName)} startar matchen…</span>`;
  }

  if (view.phase === 'playing') {
    if (!view.you) {
      return `<span class="rvb__hint">Matchen är igång – vänta på nästa bord.</span>`;
    }
    if (!view.you.alive) {
      return `<span class="rvb__hint">💀 Du är ute. Heja på ${esc(view.turnName)} i stället.</span>`;
    }
    if (view.you.isTurn) {
      return `<button class="action-btn action-btn--hit" id="rvb-pull" ${ui.busy ? 'disabled' : ''}>
        🔫 Tryck av (1 av ${view.chambers} kammare)
      </button>
      <span class="rvb__hint">Tiden rinner ut – bordet trycker av åt dig om du tvekar för länge.</span>`;
    }
    return `<span class="rvb__hint">Väntar på <b>${esc(view.turnName)}</b>…</span>`;
  }

  /* Färdig match */
  return `
    <button class="action-btn action-btn--deal" id="rvb-new">🔫 Nytt bord</button>
    <button class="action-btn action-btn--split" id="rvb-board">↺ Alla bord</button>`;
}

function feedHTML(view) {
  if (!view.log || !view.log.length) {
    return `<li class="rvb__event"><span class="rvb__event-dot"></span>Inget har hänt än – starta matchen.</li>`;
  }
  return view.log
    .slice(0, 6)
    .map((entry) => {
      const cls = ['rvb__event', entry.kind ? `is-${entry.kind}` : ''].filter(Boolean).join(' ');
      return `<li class="${cls}"><span class="rvb__event-dot"></span>${esc(entry.text)}</li>`;
    })
    .join('');
}

function resultHTML(view) {
  if (view.phase !== 'done') return '';
  if (view.winner) {
    const youWon = view.you && view.winner.playerId === view.you.playerId;
    return `<div class="rvb__result ${youWon ? 'is-you' : ''}">
      <div class="rvb__result-title">${youWon ? '🏆 Du vann kassan!' : `🏆 ${esc(view.winner.name)} vann kassan`}</div>
      <div class="rvb__result-sum">${kr(view.prize)}</div>
      <div class="rvb__result-sub">${view.seated} spelare · insats ${kr(view.ante)} · ${view.bangs} pang</div>
    </div>`;
  }
  return `<div class="rvb__result">
    <div class="rvb__result-title">Bordet stängdes</div>
    <div class="rvb__result-sum">${view.expired ? 'Ingen kom' : 'Matchen avbröts'}</div>
    <div class="rvb__result-sub">Alla fick tillbaka sin insats.</div>
  </div>`;
}

/* ------------------------------ bordsvyn ------------------------------ */

function tableHTML(view) {
  const turnYour = view.you && view.you.isTurn && view.phase === 'playing';
  return `
    <div class="rvb">
      <div class="rvb__bar">
        <div class="rvb__pot">
          <span class="rvb__pot-label">Kassan</span>
          <strong class="rvb__pot-sum">${kr(view.pot || view.prize)}</strong>
        </div>
        <div class="rvb__meta">
          <span class="mini-pill">Insats <strong>${kr(view.ante)}</strong></span>
          <span class="mini-pill">Spelare <strong>${view.seated}/${view.maxSeats}</strong></span>
          <span class="mini-pill">Klick <strong>${view.pulls}</strong></span>
          <span class="mini-pill">PANG <strong>${view.bangs}</strong></span>
        </div>
        <div class="spacer"></div>
        <button class="btn btn--sm btn--ghost" id="rvb-invite">🔗 Bjud in</button>
        <button class="btn btn--sm btn--ghost" id="rvb-leave">${view.phase === 'lobby' ? 'Lämna (få igen)' : 'Lämna bordet'}</button>
      </div>

      <div class="rvb__status ${turnYour ? 'is-you' : ''} ${view.phase === 'done' ? 'is-done' : ''}">
        <span class="rvb__status-text">
          ${
            view.phase === 'playing'
              ? turnYour
                ? '🔫 Din tur – tryck av om du vågar'
                : `⏳ ${esc(view.turnName)}s tur`
              : esc(phaseText(view))
          }
        </span>
        ${view.phase === 'playing' ? '<span class="rvb__clock" id="rvb-clock"><i></i></span>' : ''}
      </div>

      ${seatsHTML(view)}
      ${gunHTML(view)}
      <div class="action-bar rvb__actions" id="rvb-actions">${actionsHTML(view)}</div>
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
  /* Allt: sätt in hela saldot i kassan (högst bordets tak). */
  const allIn = Math.round(Math.min(state.player?.balance ?? 0, board.max));
  return `
    <div class="rvb rvb--board">
      <div class="rvb__panels">
        <section class="rvb__panel">
          <h2>Öppna ett bord</h2>
          <p class="rvb__panel-text">
            Två till sex spelare lägger <b>samma insats</b> i kassan. Sedan turas ni om att
            trycka av – den som står kvar tar allt. Huset tar ingenting.
          </p>
          <div class="bet-field">
            <span class="bet-field__label">Insats per spelare</span>
            <div class="bet-field__row">
              <input class="bet-field__input" id="rvb-ante-input" type="number" inputmode="numeric"
                     min="${board.min}" max="${board.max}" step="${Math.max(1, board.min)}" value="${ante}" />
              <span class="bet-field__unit">kr</span>
              <button class="chip-mini" id="rvb-ante-half">½</button>
              <button class="chip-mini" id="rvb-ante-double">2×</button>
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
            ${
              allIn > 0 && !chips.includes(allIn)
                ? `<button class="chip-btn" data-ante="${allIn}" title="Sätt in hela saldot">
                  <div class="poker-chip poker-chip--gold" style="--chip-size:52px"><span>ALLT</span></div>
                </button>`
                : ''
            }
          </div>
          <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:4px">
            <span class="mini-pill">Min <strong>${kr(board.min)}</strong></span>
            <span class="mini-pill">Max <strong>${kr(board.max)}</strong></span>
            <span class="mini-pill">Saldo <strong>${kr(state.player?.balance ?? 0)}</strong></span>
          </div>
          <button class="action-btn action-btn--deal" id="rvb-create" ${ui.busy ? 'disabled' : ''}>
            🎬 Öppna bordet (${kr(ante)})
          </button>
        </section>

        <section class="rvb__panel">
          <h2>Bord just nu ${board.loading ? '<span class="mini-pill">uppdaterar…</span>' : ''}</h2>
          <p class="rvb__panel-text">Gå med i ett bord som väntar på spelare – du betalar samma insats som de andra.</p>
          <div class="rvb__list" id="rvb-list">
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
                            ? `<button class="btn btn--sm btn--primary" data-join="${t.id}" ${ui.busy ? 'disabled' : ''}>Gå med</button>`
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
  const body = root.querySelector('#rvb-body');
  if (!body) return;

  if (ui.tableId && ui.view) {
    const view = ui.view;
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
      <button class="btn btn--sm btn--ghost" id="rvb-board">↺ Alla bord</button>
    </div></div>`;
    const back = body.querySelector('#rvb-board');
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

/* Ritar om vyn direkt efter en åtgärd (knapparna är låsta medan anropet
   pågår, så de måste få tillbaka sitt läge med en gång). */
function repaint() {
  ui.sig = '';
  paint();
}

function playSounds(view) {
  const last = view.lastPull || null;
  const at = last ? Number(last.at) || 0 : 0;
  if (at && at !== ui.lastPullAt) {
    ui.lastPullAt = at;
    if (last.fires) sfx.bang();
    else sfx.klik();
    return;
  }
  if (view.phase === 'done' && view.winner && view.bangs > ui.lastBangs) {
    ui.lastBangs = view.bangs;
    sfx.win();
  }
}

function tickClock() {
  const root = ui.root;
  const view = ui.view;
  if (!root || !view || view.phase !== 'playing') return;
  const bar = root.querySelector('#rvb-clock i');
  const total = Number(view.turnMs) || REVOLVER_BORD_MATH.TURN_MS;
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
  const input = root.querySelector('#rvb-ante-input');
  const setAnte = (value) => {
    const board = ui.board || {};
    const max = Number(board.max) || 100000;
    const min = Number(board.min) || 1;
    const next = Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
    root.querySelectorAll('[data-ante]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.ante) === next));
    if (input) input.value = next;
    const btn = root.querySelector('#rvb-create');
    if (btn) btn.innerHTML = `🎬 Öppna bordet (${kr(next)})`;
    if (ui.board) ui.board.ante = next;
    ui.boardSig = ''; // inget att jämföra – nästa målning får rita om
  };

  if (input) input.addEventListener('change', () => setAnte(input.value));
  root.querySelectorAll('[data-ante]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sfx.chip();
      setAnte(Number(btn.dataset.ante));
    });
  });
  const half = root.querySelector('#rvb-ante-half');
  if (half)
    half.addEventListener('click', () => {
      sfx.chip();
      setAnte((Number(input?.value) || 100) / 2);
    });
  const dbl = root.querySelector('#rvb-ante-double');
  if (dbl)
    dbl.addEventListener('click', () => {
      sfx.chip();
      setAnte((Number(input?.value) || 100) * 2);
    });

  const create = root.querySelector('#rvb-create');
  if (create)
    create.addEventListener('click', () => {
      createTable(Number(input?.value) || ui.board?.ante || 100);
    });

  root.querySelectorAll('[data-join]').forEach((btn) =>
    btn.addEventListener('click', () => joinTable(btn.dataset.join))
  );
  root.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => enterTable(btn.dataset.open))
  );
}

function bindTable(view) {
  const root = ui.root;
  if (!root) return;
  const on = (id, fn) => {
    const el = root.querySelector('#' + id);
    if (el) el.addEventListener('click', fn);
  };

  on('rvb-pull', () => pullTrigger());
  on('rvb-trigger', () => pullTrigger());
  on('rvb-start', () => startMatch());
  on('rvb-join', () => joinTable(view.id));
  on('rvb-leave', () => leaveTable());
  on('rvb-invite', () => invite());
  on('rvb-new', () => openBoard());
  on('rvb-board', () => openBoard());
}

/* ------------------------------ anrop ------------------------------ */

async function createTable(ante) {
  if (ui.busy) return;
  ui.busy = true;
  try {
    const data = await api.revolverBord('table', { ante });
    ui.tableId = data.table.id;
    ui.view = data.table;
    ui.sig = '';
    ui.error = '';
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
    const data = await api.revolverBord('join', { id });
    ui.tableId = id;
    ui.view = data.table;
    ui.sig = '';
    ui.error = '';
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
  ui.busy = true;
  try {
    const data = await api.revolverBord('leave', { id: ui.tableId });
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

async function startMatch() {
  if (!ui.tableId || ui.busy) return;
  ui.busy = true;
  try {
    const data = await api.revolverBord('start', { id: ui.tableId });
    ui.view = data.table;
    sfx.spin();
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    ui.busy = false;
    repaint();
  }
}

async function pullTrigger() {
  if (!ui.tableId || ui.busy) return;
  const view = ui.view;
  if (!view || view.phase !== 'playing' || !view.you || !view.you.isTurn) return;
  ui.busy = true;
  const hammer = ui.root?.querySelector('.revolver__hammer');
  if (hammer) hammer.classList.add('is-cocked');
  sfx.spin();
  try {
    const data = await api.revolverBord('pull', { id: ui.tableId });
    ui.view = data.table;
  } catch (err) {
    toast(err.message, 'bad');
    pollTable();
    return;
  } finally {
    ui.busy = false;
    repaint();
  }
  /* Hanen slår fram i den nyritade revolvern. */
  const fresh = ui.root?.querySelector('.revolver__hammer');
  if (fresh) {
    fresh.classList.add('is-falling');
    setTimeout(() => fresh.classList.remove('is-falling'), 260);
  }
}

function onBordRoute() {
  const route = state.route;
  return !!route && route.name === 'revolver' && (route.parts || [])[2] === 'bord';
}

async function pollTable() {
  if (!ui.tableId || !ui.root) return;
  if (!onBordRoute()) {
    stopPolling();
    return;
  }
  if (document.hidden) return;
  try {
    const data = await api.revolverBord('table?id=' + encodeURIComponent(ui.tableId));
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
    const data = await api.revolverBord('tables');
    ui.board = {
      ante: data.ante,
      tables: data.tables || [],
      min: data.min,
      max: data.max,
      loading: false
    };
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
  ui.poll = setInterval(pollTable, POLL_MS);
  ui.clock = setInterval(tickClock, 200);
}

/* Lobbyn hämtar nya bord med några sekunders mellanrum. */
function startBoardPolling() {
  stopPolling();
  ui.poll = setInterval(() => {
    if (!onBordRoute()) {
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
  stopPolling();
  startBoardPolling();
  if (location.hash.indexOf('/bord/') > 0) navigate('/kasino/revolver/bord');
  refreshBoard();
  paint();
}

function invite() {
  const id = ui.tableId || (ui.view && ui.view.id);
  if (!id) return;
  const url = location.origin + location.pathname + '#/kasino/revolver/bord/' + id;
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
    body: `<div class="rvb__invite"><code id="rvb-invite-url">${esc(url)}</code></div>
      <p class="tiny muted" style="margin-top:10px">Bordet kan också hittas under <b>Rysk roulette → Mot varandra</b>.</p>`,
    actions: [{ label: 'Klart' }]
  });
}

/* ------------------------------ vyn ------------------------------ */

/** Ritas av revolver.js när adressen är #/kasino/revolver/bord. */
export function renderBord(root, route) {
  ui.root = root;
  const wanted = (route.parts && route.parts[3]) || '';

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Rysk roulette – mot varandra</h1>
          <p>Ett bord, en kula och en gemensam kassa – den som står kvar tar allt</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--ghost" id="rvb-solo">🔫 Spela ensam</button>
        <button class="btn btn--sm btn--ghost" id="rvb-home">← Spelhallen</button>
      </div>
      <div id="rvb-body"></div>
    </div>`;

  root.querySelector('#rvb-solo').addEventListener('click', () => {
    sfx.click();
    navigate('/kasino/revolver');
  });
  root.querySelector('#rvb-home').addEventListener('click', () => {
    sfx.click();
    navigate('/kasino');
  });

  document.onkeydown = (e) => {
    if (!document.body.classList.contains('theme-casino')) return;
    if (document.querySelector('.modal-backdrop')) return;
    const key = e.key.toLowerCase();
    if ((key === ' ' || key === 'enter') && ui.view && ui.view.you && ui.view.you.isTurn && ui.view.phase === 'playing') {
      e.preventDefault();
      pullTrigger();
    }
  };

  if (wanted && wanted !== ui.tableId) {
    /* En delad länk pekar på ett bord – visa det och låt spelaren gå med. */
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
export function stopBord() {
  stopPolling();
  ui.root = null;
}
