/* =====================================================================
   Inpostern om mynt – samma spel, men alla sitter vid varsin skärm.

   Spelledaren öppnar ett bord och får en fyrsiffrig kod. Kompisarna går med
   med koden på sina egna iPads eller mobiler och betalar samma insats.
   Servern delar ut rollerna, så varje enhet bara ser sin egen roll – det är
   hela poängen med egna skärmar i stället för en telefon som skickas runt.

   En omgång: alla ger en ledtråd med ett ord → alla röstar på en misstänkt →
   åker en inposter ut vinner laget, annars får inposterna gissa ordet.
   Laget får dubbelt igen; inposterna delar hela kassan om de vinner.
   ===================================================================== */

import { state, api, sfx, toast, kr, esc, navigate, updateBalanceUI } from './core.js';

export const IMPOSTER_ONLINE = {
  POLL_MS: 1500,
  MIN_SEATS: 3,
  MAX_SEATS: 12,
  CODE_LENGTH: 4
};

const ui = {
  host: null,
  view: null,
  sig: '',
  board: null,
  busy: false,
  poll: null,
  clock: null,
  error: '',
  ante: 100,
  codeDraft: '',
  clueDraft: '',
  guessDraft: '',
  votePick: -1
};

/* ------------------------------ smådelar ------------------------------ */

const initial = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?';

const phaseLabel = (phase) =>
  phase === 'lobby'
    ? 'Väntrum'
    : phase === 'clues'
    ? 'Ledtrådar'
    : phase === 'vote'
    ? 'Röstning'
    : phase === 'guess'
    ? 'Inposterna gissar'
    : 'Omgången är klar';

function roleHTML(view) {
  if (!view.you || view.phase === 'lobby' || view.phase === 'done') return '';
  if (view.you.isImposter) {
    return `<div class="inpo__role is-imposter">
      <span class="inpo__role-tag">Din hemliga roll</span>
      <strong>Du är inpostern</strong>
      <span>Ledtråd: <b>${esc(view.hint || '—')}</b> · lista ut ordet utan att avslöja dig.</span>
    </div>`;
  }
  return `<div class="inpo__role">
    <span class="inpo__role-tag">Ditt ord</span>
    <strong>${esc(view.word || '—')}</strong>
    <span>Beskriv det med ett enda ord – säg det inte rakt ut.</span>
  </div>`;
}

function seatsHTML(view) {
  return `<div class="inpo__players">${view.seats
    .filter((s) => !s.left)
    .map(
      (s) => `<span class="inpo__player ${s.isYou ? 'is-you' : ''} ${
        view.phase === 'clues' && view.clueTurn && view.clueTurn.seat === s.index ? 'is-turn' : ''
      } ${view.phase === 'done' && s.imposter ? 'is-imposter' : ''}">
        <span class="inpo__avatar">${s.emoji || esc(initial(s.name))}</span>
        <span class="inpo__player-name">${esc(s.name)}${s.isHost ? ' <small>värd</small>' : ''}</span>
        ${s.isYou ? '<span class="inpo__badge">du</span>' : ''}
        ${view.phase === 'clues' ? `<span class="inpo__dot ${s.hasClue ? 'is-done' : ''}"></span>` : ''}
        ${view.phase === 'vote' ? `<span class="inpo__dot ${s.hasVoted ? 'is-done' : ''}"></span>` : ''}
        ${view.phase === 'done' && s.imposter ? '<span class="inpo__badge is-imposter">inposter</span>' : ''}
        ${view.phase === 'done' && s.prize > 0 ? `<span class="inpo__paid">+${kr(s.prize)}</span>` : ''}
      </span>`
    )
    .join('')}</div>`;
}

function barHTML(view) {
  return `<div class="inpo__bar">
    <div class="inpo__code"><span>Kod</span><strong>${esc(view.code || '—')}</strong></div>
    <div class="inpo__meta">
      <span class="mini-pill">Insats <strong>${kr(view.ante)}</strong></span>
      <span class="mini-pill">Kassan <strong>${kr(view.phase === 'done' ? view.prize : view.pot)}</strong></span>
      <span class="mini-pill">Spelare <strong>${view.seated}/${view.maxSeats}</strong></span>
      <span class="mini-pill">Inposter <strong>${view.phase === 'done' ? view.result && view.result.imposters.length : 'hemligt'}</strong></span>
    </div>
    <div style="flex:1"></div>
    <button class="btn btn--sm btn--ghost" id="inpo-leave">${view.phase === 'lobby' ? 'Lämna (få igen)' : 'Lämna'}</button>
  </div>`;
}

function clockHTML(view) {
  if (!['clues', 'vote', 'guess'].includes(view.phase)) return '';
  const who = view.clueTurn ? view.clueTurn.name : '';
  const cluesText =
    view.phase === 'clues'
      ? view.you && view.you.canClue
        ? 'din tur att ge en ledtråd'
        : who
        ? `${who}s tur att ge en ledtråd`
        : 'väntar på ledtrådar'
      : view.you && view.you.isImposter && view.phase === 'guess'
      ? 'dags att gissa ordet'
      : 'tiden rinner';
  return `<div class="rvb__status ${view.you && !view.you.isImposter ? '' : ''}">
    <span class="rvb__status-text">${esc(phaseLabel(view.phase))} – ${esc(cluesText)}</span>
    <span class="rvb__clock" id="inpo-clock"><i></i></span>
  </div>`;
}

/* ------------------------------ vyer ------------------------------ */

function startHTML(board) {
  const ante = ui.ante || board.ante || board.min || 10;
  return `<div class="inpo">
    <div class="rvb__panels">
      <section class="rvb__panel">
        <h2>Spela på egna skärmar</h2>
        <p class="rvb__panel-text">
          Alla lägger <b>samma insats</b> och får en kod. Var och en går med på sin egen iPad eller mobil
          och skriver sin egen ledtråd när det är hens tur, så ingen ser någon annans roll.
          Vinner <b>laget</b> får alla i laget <b>dubbelt igen</b>; vinner <b>inposterna</b> delar de hela kassan.
        </p>
        <div class="bet-field">
          <span class="bet-field__label">Insats per spelare</span>
          <div class="bet-field__row">
            <input class="bet-field__input" id="inpo-ante" type="number" inputmode="numeric"
                   min="${board.min}" max="${board.max}" step="${Math.max(1, board.min)}" value="${ante}" />
            <span class="bet-field__unit">kr</span>
          </div>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <span class="mini-pill">Min <strong>${kr(board.min)}</strong></span>
          <span class="mini-pill">Max <strong>${kr(board.max)}</strong></span>
          <span class="mini-pill">Saldo <strong>${kr(state.player?.balance ?? 0)}</strong></span>
        </div>
        <button class="action-btn action-btn--deal" id="inpo-create" ${ui.busy ? 'disabled' : ''}>
          🎭 Öppna spel (${kr(ante)})
        </button>

        <h3 class="inpo__sub">Så avgörs omgången</h3>
        <ol class="inpo__rules">
          <li>Alla skriver <b>en ledtråd</b> med ett enda ord – i tur och ordning.</li>
          <li>Alla röstar på den de tror är inposter.</li>
          <li>Åker en inposter ut vinner <b>laget</b> – alla i laget får dubbelt igen.</li>
          <li>Annars får inposterna gissa ordet. Rätt gissning = de delar hela kassan.</li>
        </ol>
      </section>

      <section class="rvb__panel">
        <h2>Gå med med kod</h2>
        <p class="rvb__panel-text">Spelledaren har en fyrsiffrig kod. Skriv in den – du betalar samma insats som de andra.</p>
        <input class="input inpo__code-input" id="inpo-code" maxlength="${IMPOSTER_ONLINE.CODE_LENGTH}"
               placeholder="T.ex. K7Q2" value="${esc(ui.codeDraft)}" autocomplete="off" />
        <button class="action-btn action-btn--hit" id="inpo-join" ${ui.busy ? 'disabled' : ''}>
          🚪 Gå med
        </button>
        <p class="tiny muted" style="margin-top:14px">
          ${board.needAccount ? '🔐 Du behöver ett konto med namn och PIN för att vara med – då sparas också mynten.' : 'Du kan bara vara med i ett spel i taget. Lämnar du väntrummet får du tillbaka insatsen.'}
        </p>
        ${ui.error ? `<p class="inpo__error">${esc(ui.error)}</p>` : ''}
      </section>
    </div>
  </div>`;
}

function lobbyHTML(view) {
  return `<div class="inpo">
    ${barHTML(view)}
    <section class="rvb__panel inpo__panel">
      <h2>Väntrum</h2>
      <div class="inpo__share">
        <div class="inpo__share-code">
          <span>Koden till kompisarna</span>
          <strong>${esc(view.code)}</strong>
        </div>
        <button class="btn btn--sm btn--ghost" id="inpo-copy">🔗 Kopiera</button>
      </div>
      <p class="rvb__panel-text">Alla går in på <b>Inpostern</b> och skriver koden. Minst ${view.minSeats} spelare behövs.</p>
      ${seatsHTML(view)}
      ${
        view.isHost
          ? `<button class="action-btn action-btn--deal" id="inpo-start" ${view.seated >= view.minSeats && !ui.busy ? '' : 'disabled'}>
              🎬 Dela ut rollerna (${view.seated}/${view.maxSeats})
            </button>
            <p class="inpo__hint">${view.seated >= view.minSeats ? 'Alla som sitter här är med – tryck för att dela ut.' : `Minst ${view.minSeats} spelare behövs.`}</p>`
          : `<p class="inpo__hint">Väntar på att ${esc(view.hostName)} delar ut rollerna…</p>`
      }
    </section>
  </div>`;
}

function cluesHTML(view) {
  const mine = view.you || {};
  const turn = view.clueTurn;
  const given = (view.clues || []).filter((c) => c.clue);
  const rows = given
    .map(
      (c) => `<div class="inpo__clue-row ${turn && turn.playerId === c.playerId ? 'is-turn' : ''}">
        <span class="inpo__clue-name">${esc(c.name)}</span>
        <span class="inpo__clue-word">${esc(c.clue)}</span>
      </div>`
    )
    .join('');

  const head = mine.clue
    ? `<p class="rvb__panel-text">Din ledtråd är skickad: <b>${esc(mine.clue)}</b>.${
        turn ? ` Nu är det <b>${esc(turn.name)}</b>s tur.` : ''
      }</p>`
    : mine.canClue
    ? `<p class="rvb__panel-text"><b>Det är din tur.</b> Skriv ett enda ord som beskriver ordet utan att avslöja det –
         inposterna lyssnar extra noga.</p>
       <div class="inpo__row">
         <input class="input" id="inpo-clue" maxlength="40" placeholder="Ditt ord…" value="${esc(ui.clueDraft)}" />
         <button class="btn btn--primary" id="inpo-clue-send" ${ui.busy ? 'disabled' : ''}>Skicka</button>
       </div>`
    : `<p class="rvb__panel-text">Det är <b>${esc(turn ? turn.name : '…')}</b>s tur att ge en ledtråd.
         Ledtrådarna kommer i tur och ordning – håll koll på listan.</p>`;

  return `<div class="inpo">
    ${barHTML(view)}
    ${roleHTML(view)}
    ${clockHTML(view)}
    <section class="rvb__panel inpo__panel">
      <h2>En ledtråd i taget</h2>
      ${head}
      ${
        rows || mine.clue
          ? `<div class="inpo__clues inpo__clues--live">${rows || '<p class="tiny muted">Ingen har gett sin ledtråd än.</p>'}</div>`
          : ''
      }
      ${seatsHTML(view)}
      ${ui.error ? `<p class="inpo__error">${esc(ui.error)}</p>` : ''}
    </section>
  </div>`;
}

function voteHTML(view) {
  const mine = view.you || {};
  const others = view.seats.filter((s) => !s.left && !s.isYou);
  const clueRows = view.clues
    .map(
      (c) => `<div class="inpo__clue-row">
        <span class="inpo__clue-name">${esc(c.name)}</span>
        <span class="inpo__clue-word">${esc(c.clue || '—')}</span>
      </div>`
    )
    .join('');

  return `<div class="inpo">
    ${barHTML(view)}
    ${roleHTML(view)}
    ${clockHTML(view)}
    <section class="rvb__panel inpo__panel">
      <h2>Vem är inposter?</h2>
      <p class="rvb__panel-text">Allas ledtrådar ligger på bordet. Läs dem och rösta på den som verkar veta minst.</p>
      <div class="inpo__clues">${clueRows}</div>
      ${
        mine.hasVoted
          ? `<p class="rvb__panel-text">Du har röstat. Nu väntar vi på de andra.</p>`
          : `<div class="inpo__votes">${others
              .map(
                (s) => `<button class="inpo__vote ${ui.votePick === s.index ? 'is-picked' : ''}" data-vote="${s.index}">
                  <span class="inpo__avatar">${s.emoji || esc(initial(s.name))}</span>${esc(s.name)}
                </button>`
              )
              .join('')}</div>
            <button class="action-btn action-btn--hit" id="inpo-vote-send" ${
              ui.votePick >= 0 && !ui.busy ? '' : 'disabled'
            }>🗳 Rösta</button>`
      }
      ${seatsHTML(view)}
      ${ui.error ? `<p class="inpo__error">${esc(ui.error)}</p>` : ''}
    </section>
  </div>`;
}

function guessHTML(view) {
  const mine = view.you || {};
  return `<div class="inpo">
    ${barHTML(view)}
    ${roleHTML(view)}
    ${clockHTML(view)}
    <section class="rvb__panel inpo__panel">
      <h2>${mine.isImposter ? 'Vilket ord är det?' : 'Inposterna gissar ordet'}</h2>
      ${
        mine.isImposter
          ? `<p class="rvb__panel-text">Du klarade dig undan röstningen. Nu gäller det: vilket ord hade de andra?
             Du har ledtråden <b>${esc(view.hint || '—')}</b> och alla ledtrådarna nedan.</p>
             ${
               mine.guess
                 ? `<p class="rvb__panel-text">Din gissning: <b>${esc(mine.guess)}</b></p>`
                 : `<div class="inpo__row">
                     <input class="input" id="inpo-guess" maxlength="40" placeholder="Ditt svar…" value="${esc(ui.guessDraft)}" />
                     <button class="btn btn--primary" id="inpo-guess-send" ${ui.busy ? 'disabled' : ''}>Gissa</button>
                   </div>`
             }`
          : `<p class="rvb__panel-text">Ingen inposter åkte ut – nu får inposterna en chans att gissa ordet.
             Håll tummarna för att de gissar fel.</p>`
      }
      <div class="inpo__clues">${view.clues
        .map(
          (c) => `<div class="inpo__clue-row"><span class="inpo__clue-name">${esc(c.name)}</span>
            <span class="inpo__clue-word">${esc(c.clue || '—')}</span></div>`
        )
        .join('')}</div>
      ${seatsHTML(view)}
      ${ui.error ? `<p class="inpo__error">${esc(ui.error)}</p>` : ''}
    </section>
  </div>`;
}

function doneHTML(view) {
  const result = view.result || {};
  const youWon =
    view.you &&
    ((result.crewWin && result.crew.some((c) => c.playerId === view.you.playerId)) ||
      (!result.crewWin && result.imposters.some((c) => c.playerId === view.you.playerId)));
  const imposters = (result.imposters || []).map((i) => i.name).join(' och ');
  const payouts = (result.payouts || [])
    .map((p) => `<div class="inpo__payout"><span>${esc(p.name)}</span><b>+${kr(p.amount)}</b></div>`)
    .join('');

  return `<div class="inpo">
    ${barHTML(view)}
    <div class="inpo__result ${youWon ? 'is-win' : ''}">
      <span class="inpo__result-tag">Omgång ${view.round}</span>
      <h2>${result.voided ? 'Omgången avbröts' : result.crewWin ? '🏆 Laget vann!' : '🎭 Inposterna vann!'}</h2>
      <p class="inpo__result-word">Ordet var <b>${esc(result.word || '')}</b></p>
      <p class="inpo__result-imposters">Inposter: <b>${esc(imposters || '—')}</b></p>
      ${
        result.caught
          ? `<p class="small muted">${esc(result.caught.name)} röstades ut – och var inposter.</p>`
          : (result.guesses || []).length
          ? `<p class="small muted">Gissningar: ${result.guesses
              .map((g) => `${esc(g.name)} gissade "${esc(g.guess || '—')}"${g.correct ? ' ✅' : ''}`)
              .join(' · ')}</p>`
          : ''
      }
      ${result.voided ? '<p class="small muted">Alla fick tillbaka sin insats.</p>' : `<div class="inpo__payouts">${payouts}</div>`}
      <div class="row" style="gap:10px;flex-wrap:wrap;justify-content:center;margin-top:18px">
        ${view.isHost ? '<button class="action-btn action-btn--deal" id="inpo-again">↺ Ny omgång (samma insats)</button>' : ''}
        <button class="btn btn--ghost" id="inpo-new">Nytt spel</button>
      </div>
      ${view.isHost ? '' : '<p class="tiny muted" style="margin-top:12px">Spelledaren startar nästa omgång.</p>'}
    </div>
    <section class="rvb__panel inpo__panel">
      <h3 style="font-size:14px;margin:0 0 10px">Rösterna</h3>
      <div class="inpo__tally">
        ${(result.votes || [])
          .map(
            (v) => `<div class="inpo__tally-row ${v.imposter ? 'is-imposter' : ''}">
              <span>${esc(v.name)}</span><b>${v.votes} röst${v.votes === 1 ? '' : 'er'}</b>
            </div>`
          )
          .join('') || '<p class="small muted">Inga röster lades.</p>'}
      </div>
      <h3 style="font-size:14px;margin:18px 0 10px">Loggen</h3>
      <ol class="rvb__feed">${(view.log || [])
        .map((e) => `<li class="rvb__event is-${esc(e.kind || '')}"><span class="rvb__event-dot"></span>${esc(e.text)}</li>`)
        .join('')}</ol>
    </section>
  </div>`;
}

function bodyHTML() {
  const view = ui.view;
  if (!view) {
    const board = ui.board || { ante: 100, min: 10, max: 500, needAccount: false };
    return startHTML(board);
  }
  if (view.phase === 'lobby') return lobbyHTML(view);
  if (view.phase === 'clues') return cluesHTML(view);
  if (view.phase === 'vote') return voteHTML(view);
  if (view.phase === 'guess') return guessHTML(view);
  return doneHTML(view);
}

/* ------------------------------ målning ------------------------------ */

function paint() {
  const host = ui.host;
  if (!host) return;
  const sig = JSON.stringify({ view: ui.view, board: ui.board, pick: ui.votePick, error: ui.error, busy: ui.busy });
  if (sig === ui.sig) {
    tickClock();
    return;
  }
  /* Ritar inte om mitt i ett skrivfält – då tappar man det man skrivit. */
  if (host.querySelector('input:focus')) {
    tickClock();
    return;
  }
  ui.sig = sig;
  host.innerHTML = bodyHTML();
  bind();
  tickClock();
}

function repaint() {
  ui.sig = '';
  paint();
}

function tickClock() {
  const host = ui.host;
  const view = ui.view;
  if (!host || !view || !view.autoAt) return;
  const bar = host.querySelector('#inpo-clock i');
  if (!bar) return;
  const total = Number(view.phaseMs) || 1;
  const left = Math.max(0, Number(view.autoAt) - Date.now());
  bar.style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
  bar.classList.toggle('is-low', left < 15000);
}

/* ------------------------------ händelser ------------------------------ */

function bind() {
  const host = ui.host;
  if (!host) return;
  const on = (id, fn) => {
    const el = host.querySelector('#' + id);
    if (el) el.addEventListener('click', fn);
  };

  const anteInput = host.querySelector('#inpo-ante');
  if (anteInput)
    anteInput.addEventListener('change', () => {
      const board = ui.board || {};
      const min = Number(board.min) || 1;
      const max = Number(board.max) || 100000;
      ui.ante = Math.max(min, Math.min(max, Math.round(Number(anteInput.value) || min)));
      repaint();
    });

  const codeInput = host.querySelector('#inpo-code');
  if (codeInput) {
    codeInput.addEventListener('input', () => {
      ui.codeDraft = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      codeInput.value = ui.codeDraft;
    });
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinByCode(ui.codeDraft);
    });
  }

  const clueInput = host.querySelector('#inpo-clue');
  if (clueInput) {
    clueInput.addEventListener('input', () => (ui.clueDraft = clueInput.value));
    clueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendClue();
    });
  }

  const guessInput = host.querySelector('#inpo-guess');
  if (guessInput) {
    guessInput.addEventListener('input', () => (ui.guessDraft = guessInput.value));
    guessInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendGuess();
    });
  }

  on('inpo-create', () => createTable(ui.ante));
  on('inpo-join', () => joinByCode(ui.codeDraft));
  on('inpo-start', () => startGame());
  on('inpo-leave', () => leaveTable());
  on('inpo-clue-send', () => sendClue());
  on('inpo-vote-send', () => sendVote());
  on('inpo-guess-send', () => sendGuess());
  on('inpo-again', () => againRound());
  on('inpo-new', () => openBoard());
  on('inpo-copy', () => copyCode());

  host.querySelectorAll('[data-vote]').forEach((btn) =>
    btn.addEventListener('click', () => {
      ui.votePick = Number(btn.dataset.vote);
      sfx.click();
      repaint();
    })
  );
}

/* ------------------------------ anrop ------------------------------ */

async function run(fn, busyMsg) {
  if (ui.busy) return null;
  ui.busy = true;
  ui.error = '';
  repaint();
  try {
    return await fn();
  } catch (err) {
    ui.error = err.message || 'Något gick fel';
    if (busyMsg) toast(err.message, 'bad');
    return null;
  } finally {
    ui.busy = false;
  }
}

async function createTable(ante) {
  const data = await run(() => api.inposter('table', { ante }));
  if (!data) return repaint();
  ui.view = data.table;
  updateBalanceUI();
  sfx.chip();
  startPolling();
  repaint();
}

async function joinByCode(code) {
  const cleaned = String(code || '').trim().toUpperCase();
  if (cleaned.length < IMPOSTER_ONLINE.CODE_LENGTH) {
    ui.error = 'Skriv hela koden (fyra tecken)';
    repaint();
    return;
  }
  const data = await run(() => api.inposter('join', { code: cleaned }));
  if (!data) return repaint();
  ui.view = data.table;
  ui.error = '';
  updateBalanceUI();
  sfx.chip();
  startPolling();
  repaint();
}

async function startGame() {
  if (!ui.view) return;
  const data = await run(() => api.inposter('start', { id: ui.view.id }));
  if (!data) return repaint();
  ui.view = data.table;
  ui.clueDraft = '';
  sfx.deal();
  repaint();
}

async function sendClue() {
  if (!ui.view) return;
  const text = (ui.clueDraft || '').trim();
  if (text.length < 2) {
    ui.error = 'Skriv minst ett ord';
    repaint();
    return;
  }
  const data = await run(() => api.inposter('clue', { id: ui.view.id, text }));
  if (!data) return repaint();
  ui.view = data.table;
  ui.clueDraft = '';
  sfx.click();
  repaint();
}

async function sendVote() {
  if (!ui.view || ui.votePick < 0) return;
  const data = await run(() => api.inposter('vote', { id: ui.view.id, target: ui.votePick }));
  if (!data) return repaint();
  ui.view = data.table;
  sfx.click();
  repaint();
}

async function sendGuess() {
  if (!ui.view) return;
  const word = (ui.guessDraft || '').trim();
  if (word.length < 2) {
    ui.error = 'Skriv vilket ord du tror det är';
    repaint();
    return;
  }
  const data = await run(() => api.inposter('guess', { id: ui.view.id, word }));
  if (!data) return repaint();
  ui.view = data.table;
  ui.guessDraft = '';
  sfx.click();
  repaint();
}

async function againRound() {
  if (!ui.view) return;
  const data = await run(() => api.inposter('again', { id: ui.view.id }), true);
  if (!data) return repaint();
  ui.view = data.table;
  ui.votePick = -1;
  ui.clueDraft = '';
  ui.guessDraft = '';
  updateBalanceUI();
  sfx.deal();
  repaint();
}

async function leaveTable() {
  if (!ui.view) return;
  const id = ui.view.id;
  const data = await run(() => api.inposter('leave', { id }), true);
  updateBalanceUI();
  if (data && data.refunded > 0) toast(`Du fick tillbaka ${kr(data.refunded)}`, 'ok');
  openBoard();
  repaint();
}

function copyCode() {
  const code = ui.view && ui.view.code;
  if (!code) return;
  const done = () => toast('Koden är kopierad – skicka den till kompisarna', 'ok');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, () => toast('Koden är ' + code, 'ok'));
      return;
    }
  } catch (e) {
    /* faller igenom */
  }
  toast('Koden är ' + code, 'ok');
}

/* ------------------------------ pollning ------------------------------ */

function onInposterRoute() {
  const route = state.route;
  if (!route || !route.casino) return false;
  const sub = (route.parts || [])[1] || '';
  return sub === 'imposter' || sub === 'inposter';
}

async function pollTable() {
  if (!ui.view || !ui.host) return;
  /* Vyn kan ha bytts ut medan pollningen låg i bakgrunden. */
  if (!onInposterRoute() || !ui.host.isConnected) {
    stopPolling();
    return;
  }
  if (document.hidden) return;
  try {
    const data = await api.inposter('table?id=' + encodeURIComponent(ui.view.id));
    ui.view = data.table;
    ui.error = '';
    updateBalanceUI();
    paint();
  } catch (err) {
    if (err.status === 404) {
      stopPolling();
      ui.view = null;
      openBoard();
    } else {
      ui.error = err.message;
      paint();
    }
  }
}

async function refreshBoard() {
  try {
    const data = await api.inposter('tables');
    ui.board = {
      ante: data.ante,
      min: data.min,
      max: data.max,
      minSeats: data.minSeats,
      maxSeats: data.maxSeats,
      needAccount: data.needAccount,
      mine: data.mine
    };
    if (!ui.ante) ui.ante = data.ante;
    if (data.mine && !ui.view) {
      ui.view = { id: data.mine, phase: 'loading', code: data.code };
      startPolling();
      pollTable();
      return;
    }
    repaint();
  } catch (err) {
    ui.error = err.message;
    repaint();
  }
}

function startPolling() {
  stopPolling();
  ui.poll = setInterval(pollTable, IMPOSTER_ONLINE.POLL_MS);
  ui.clock = setInterval(tickClock, 250);
}

function stopPolling() {
  if (ui.poll) clearInterval(ui.poll);
  if (ui.clock) clearInterval(ui.clock);
  ui.poll = null;
  ui.clock = null;
}

function openBoard() {
  stopPolling();
  ui.view = null;
  ui.votePick = -1;
  ui.clueDraft = '';
  ui.guessDraft = '';
  ui.sig = '';
  refreshBoard();
  repaint();
}

/* ------------------------------ ut mot vyn ------------------------------ */

/** Monteras av imposter.js när man väljer läget "Egna skärmar". */
export function mountOnline(container) {
  ui.host = container;
  ui.sig = '';
  startPolling();
  refreshBoard();
  paint();
}

export function unmountOnline() {
  stopPolling();
  ui.host = null;
  ui.sig = '';
}

/** Länk med kod: #/kasino/inposter/KOD */
export function joinCode(code) {
  ui.codeDraft = String(code || '').toUpperCase();
  openBoard();
  if (ui.codeDraft.length >= IMPOSTER_ONLINE.CODE_LENGTH) joinByCode(ui.codeDraft);
}
