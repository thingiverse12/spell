/* =====================================================================
   Live Sport – fotboll med live-odds (spelmynt).
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, num, esc, navigate, updateBalanceUI } from './core.js';

const sport = {
  feed: null,
  bets: [],
  filter: 'all',
  selection: null,
  stake: 50,
  loading: false,
  busy: false,
  timer: null,
  root: null,
  clock: null
};

const clockText = (ts) => {
  try {
    return new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
};

const timeText = (ts) => {
  try {
    return new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    return '';
  }
};

function statusHTML(match) {
  if (match.status === 'live') {
    return `<span class="match-status match-status--live"><i></i>LIVE ${match.minute}′</span>`;
  }
  if (match.status === 'finished') {
    return `<span class="match-status match-status--done">Slut</span>`;
  }
  return `<span class="match-status match-status--next">${clockText(match.kickoff)}</span>`;
}

function matchCard(match) {
  const finished = match.status === 'finished';
  const score = match.status === 'upcoming' ? '<span class="match-score match-score--idle">–</span>' : `<span class="match-score">${match.homeScore}</span>`;
  const scoreAway = match.status === 'upcoming' ? '<span class="match-score match-score--idle">–</span>' : `<span class="match-score">${match.awayScore}</span>`;

  const markets = finished
    ? `<div class="match-done">Slutspelat · ${match.result.home}–${match.result.away}</div>`
    : match.markets
    .map((market) => {
      const picks = market.selections
        .map((sel) => {
          const active =
            sport.selection &&
            sport.selection.matchId === match.id &&
            sport.selection.market === market.key &&
            sport.selection.selection === sel.key;
          return `<button class="odd-btn ${active ? 'odd-btn--active' : ''}" data-match="${esc(match.id)}"
            data-market="${esc(market.key)}" data-selection="${esc(sel.key)}" data-odds="${sel.odds}"
            data-label="${esc(sel.long || sel.label)}" data-market-label="${esc(market.label)}"
            data-match-label="${esc(match.home + ' – ' + match.away)}" data-league="${esc(match.league)}"
            ${finished ? 'disabled' : ''}>
            <span class="odd-btn__label">${esc(sel.label)}</span>
            <span class="odd-btn__value">${sel.odds.toFixed(2).replace('.', ',')}</span>
          </button>`;
        })
        .join('');
      return `<div class="match-market">
        <span class="match-market__label">${esc(market.label)}</span>
        <div class="match-market__picks">${picks}</div>
      </div>`;
    })
    .join('');

  return `<article class="match-card ${match.live ? 'match-card--live' : ''} ${finished ? 'match-card--done' : ''}">
    <div class="match-card__top">
      <span class="match-league">${esc(match.league)}${match.country ? ` · ${esc(match.country)}` : ''}</span>
      ${statusHTML(match)}
    </div>
    <div class="match-card__teams">
      <div class="match-team"><span class="match-team__name">${esc(match.home)}</span>${score}</div>
      <div class="match-team"><span class="match-team__name">${esc(match.away)}</span>${scoreAway}</div>
    </div>
    <div class="match-card__markets">${markets}</div>
  </article>`;
}

function visibleMatches() {
  const matches = (sport.feed && sport.feed.matches) || [];
  if (sport.filter === 'live') return matches.filter((m) => m.status === 'live');
  if (sport.filter === 'next') return matches.filter((m) => m.status === 'upcoming');
  return matches;
}

function renderMatches() {
  const root = sport.root;
  if (!root) return;
  const box = root.querySelector('#sport-matches');
  if (!box) return;
  const list = visibleMatches();
  if (!list.length) {
    box.innerHTML = `<div class="panel sport-empty">
      <p class="small muted">Inga matcher just nu. Prova ett annat filter eller ladda om.</p>
    </div>`;
    return;
  }
  box.innerHTML = list.map(matchCard).join('');
  box.querySelectorAll('.odd-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      sfx.click();
      sport.selection = {
        matchId: btn.dataset.match,
        match: btn.dataset.matchLabel,
        league: btn.dataset.league,
        market: btn.dataset.market,
        marketLabel: btn.dataset.marketLabel,
        selection: btn.dataset.selection,
        selectionLabel: btn.dataset.label,
        odds: Number(btn.dataset.odds)
      };
      renderMatches();
      renderSlip();
    });
  });
}

function stakeBounds() {
  const limits = (sport.feed && sport.feed.limits) || {};
  const min = Number(limits.min) || Number(state.settings.minBet) || 10;
  const maxSetting = Number(limits.max) || Number(state.settings.sportMaxStake) || 500;
  const balance = Number(state.player && state.player.balance) || 0;
  const max = Math.max(min, Math.min(maxSetting, balance));
  return { min, max, balance };
}

function renderSlip() {
  const root = sport.root;
  if (!root) return;
  const box = root.querySelector('#sport-slip');
  if (!box) return;
  const sel = sport.selection;
  const { min, max, balance } = stakeBounds();

  if (!sel) {
    box.innerHTML = `
      <div class="slip slip--empty">
        <div class="slip__title">Spelkvitto</div>
        <p class="small muted">Klicka på ett odds till vänster för att lägga ett spel. Allt spelas med spelmynt.</p>
        <div class="slip__balance"><span>Saldo</span><strong>${kr(balance)}</strong></div>
      </div>`;
    return;
  }

  const stake = Math.max(min, Math.min(max, Math.round(Number(sport.stake) || min)));
  const potential = Math.round(stake * sel.odds * 100) / 100;
  box.innerHTML = `
    <div class="slip">
      <div class="slip__title">Spelkvitto</div>
      <div class="slip__pick">
        <div class="slip__pick-top">
          <span class="slip__market">${esc(sel.marketLabel)}</span>
          <span class="slip__odds">${sel.odds.toFixed(2).replace('.', ',')}</span>
        </div>
        <strong class="slip__choice">${esc(sel.selectionLabel)}</strong>
        <span class="slip__match">${esc(sel.match)}</span>
      </div>

      <label class="slip__label" for="sport-stake">Insats (${kr(min)} – ${kr(max)})</label>
      <div class="slip__stake">
        <button class="btn btn--sm btn--ghost" data-step="-1" type="button">−</button>
        <input id="sport-stake" class="bet-field__input slip__input" type="number" inputmode="numeric"
          min="${min}" max="${max}" step="10" value="${stake}" />
        <button class="btn btn--sm btn--ghost" data-step="1" type="button">+</button>
      </div>
      <div class="slip__quick">
        ${[50, 100, 250, 500]
          .filter((v) => v >= min && v <= max)
          .map((v) => `<button class="chip-mini" data-quick="${v}" type="button">${v}</button>`)
          .join('')}
        <button class="chip-mini" data-quick="${max}" type="button">Max</button>
      </div>

      <div class="slip__row"><span>Möjlig vinst</span><strong class="slip__win">${kr(potential)}</strong></div>
      <div class="slip__row slip__row--muted"><span>Saldo efter spel</span><span>${kr(Math.max(0, balance - stake))}</span></div>

      <button class="btn btn--primary slip__place" id="sport-place" ${sport.busy ? 'disabled' : ''}>
        ${sport.busy ? 'Lägger spel…' : 'Lägg spel · ' + kr(stake)}
      </button>
      <button class="btn btn--ghost btn--sm slip__clear" id="sport-clear" type="button">Rensa</button>
      <p class="tiny muted slip__note">Oddsen är påhittade och spelet sker med spelmynt.</p>
    </div>`;

  const input = box.querySelector('#sport-stake');
  const setStake = (value) => {
    sport.stake = Math.max(min, Math.min(max, Math.round(Number(value) || min)));
    renderSlip();
  };
  input.addEventListener('change', () => setStake(input.value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (Number.isFinite(v) && v > 0) sport.stake = v;
  });
  box.querySelectorAll('[data-step]').forEach((btn) => {
    btn.addEventListener('click', () => setStake(stake + Number(btn.dataset.step) * (stake >= 100 ? 50 : 10)));
  });
  box.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => setStake(btn.dataset.quick));
  });
  box.querySelector('#sport-clear').addEventListener('click', () => {
    sport.selection = null;
    renderMatches();
    renderSlip();
  });
  box.querySelector('#sport-place').addEventListener('click', () => placeBet(stake));
}

async function placeBet(stake) {
  if (sport.busy || !sport.selection) return;
  const sel = sport.selection;
  sport.busy = true;
  renderSlip();
  try {
    const data = await api.placeSportBet({
      matchId: sel.matchId,
      market: sel.market,
      selection: sel.selection,
      amount: stake
    });
    sfx.win();
    toast(`Spel lagt: ${kr(stake)} på ${sel.selectionLabel} @ ${data.bet.odds.toFixed(2).replace('.', ',')}`, 'gold', 3200);
    updateBalanceUI();
    sport.selection = null;
    sport.busy = false;
    await refresh({ quiet: true });
  } catch (err) {
    sport.busy = false;
    toast(err.message || 'Kunde inte lägga spelet', 'bad');
    renderSlip();
  }
}

function betRow(bet) {
  const statusMap = {
    open: ['Öppen', 'open'],
    won: ['Vunnen', 'won'],
    lost: ['Förlorad', 'lost'],
    void: ['Återbetald', 'void']
  };
  const [label, cls] = statusMap[bet.status] || ['Okänd', ''];
  const amount =
    bet.status === 'won'
      ? `<strong class="win">+${kr(bet.payout || bet.potential)}</strong>`
      : bet.status === 'lost'
        ? `<strong class="loss">−${kr(bet.stake)}</strong>`
        : bet.status === 'void'
          ? `<strong class="muted">${kr(bet.stake)}</strong>`
          : `<strong>${kr(bet.potential || bet.stake * bet.odds)}</strong>`;
  return `<div class="bet-row">
    <div class="bet-row__main">
      <span class="bet-row__match">${esc(bet.match || '')}</span>
      <span class="bet-row__pick">${esc(bet.selectionLabel || bet.selection)} · ${esc(bet.marketLabel || '')}</span>
      <span class="bet-row__meta">${kr(bet.stake)} @ ${Number(bet.odds).toFixed(2).replace('.', ',')}${bet.result ? ' · ' + esc(bet.result) : ''}</span>
    </div>
    <div class="bet-row__side">
      <span class="bet-badge bet-badge--${cls}">${label}</span>
      ${amount}
    </div>
  </div>`;
}

function renderBets() {
  const root = sport.root;
  if (!root) return;
  const box = root.querySelector('#sport-bets');
  if (!box) return;
  const bets = sport.bets || [];
  if (!bets.length) {
    box.innerHTML = `<p class="small muted">Du har inte lagt några fotbollsspel än.</p>`;
    return;
  }
  box.innerHTML = bets.map(betRow).join('');
  const counter = sport.root.querySelector('#sport-bets-count');
  if (counter) {
    const open = bets.filter((b) => b.status === 'open').length;
    counter.textContent = open ? open + ' öppna' : '';
  }
}

function renderStatus() {
  const root = sport.root;
  if (!root) return;
  const box = root.querySelector('#sport-status');
  if (!box) return;
  const feed = sport.feed || {};
  const live = (feed.matches || []).filter((m) => m.live).length;
  const sourceLabel = feed.source === 'allsportsapi' ? 'AllSportsAPI · live' : 'Demoliga';
  const sourceCls = feed.source === 'allsportsapi' ? 'ok' : 'demo';
  const notes = [];
  if (feed.source !== 'allsportsapi') {
    notes.push(
      feed.apiKeySet
        ? 'Kunde inte nå AllSportsAPI – visar demoligan tills anslutningen fungerar.'
        : 'Demoliga: lägg in en AllSportsAPI-nyckel i adminpanelen för riktiga matcher.'
    );
  }
  if (feed.error) notes.push(feed.error);

  box.innerHTML = `
    <span class="sport-source sport-source--${sourceCls}">${esc(sourceLabel)}</span>
    <span class="sport-livecount">${live} live</span>
    ${feed.updatedAt ? `<span class="sport-updated">Uppdaterad ${timeText(feed.updatedAt)}</span>` : ''}
    ${state.offline ? '<span class="sport-offline">Lokalt läge</span>' : ''}
    ${notes.length ? `<span class="sport-note">${esc(notes.join(' '))}</span>` : ''}`;

  const clock = root.querySelector('#sport-clock');
  if (clock) clock.textContent = clockText(Date.now());
}

async function refresh({ quiet = false } = {}) {
  if (sport.loading) return;
  sport.loading = true;
  if (!quiet) {
    const box = sport.root && sport.root.querySelector('#sport-matches');
    if (box && !sport.feed) box.innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line"></div>';
  }
  try {
    const [feed, bets] = await Promise.all([api.sportMatches(), api.sportBets().catch(() => null)]);
    sport.feed = feed;
    if (bets) sport.bets = bets.bets || [];
    // Släpp valet om matchen inte längre kan spelas.
    if (sport.selection) {
      const match = (feed.matches || []).find((m) => m.id === sport.selection.matchId);
      if (!match || match.status === 'finished') sport.selection = null;
    }
    const { max } = stakeBounds();
    if (sport.stake > max) sport.stake = max;
    renderStatus();
    renderMatches();
    renderSlip();
    renderBets();
  } catch (err) {
    const box = sport.root && sport.root.querySelector('#sport-matches');
    if (box) {
      box.innerHTML = `<div class="panel sport-empty"><p class="small">Kunde inte hämta matcher: ${esc(err.message)}</p></div>`;
    }
  } finally {
    sport.loading = false;
  }
}

function renderSport(root) {
  sport.root = root;
  sport.selection = null;
  sport.bets = [];
  sport.feed = null;
  sport.stake = Math.max(Number(state.settings.minBet) || 10, 50);

  root.innerHTML = `
    <div class="wrap sport-wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Live Sport <span class="sport-pill">fotboll</span></h1>
          <p>Live-odds på fotboll · allt spelas med spelmynt</p>
        </div>
        <div style="flex:1"></div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn--sm btn--ghost" id="sport-refresh">Uppdatera</button>
          <button class="btn btn--sm btn--ghost" id="sport-back">Spelhallen</button>
        </div>
      </div>

      <div class="sport-status" id="sport-status"></div>

      <div class="sport-filters" id="sport-filters">
        <button class="chip ${sport.filter === 'all' ? 'chip--active' : ''}" data-filter="all">Alla</button>
        <button class="chip ${sport.filter === 'live' ? 'chip--active' : ''}" data-filter="live">Live</button>
        <button class="chip ${sport.filter === 'next' ? 'chip--active' : ''}" data-filter="next">Kommande</button>
        <span class="sport-filters__spacer"></span>
        <span class="sport-filters__meta tiny muted">Klienttid <strong id="sport-clock"></strong> · uppdateras var 15:e sekund</span>
      </div>

      <div class="sport-layout">
        <div class="sport-main" id="sport-matches">
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
        </div>
        <aside class="sport-side">
          <div id="sport-slip"></div>
          <div class="panel sport-bets-panel">
            <div class="row row--between" style="align-items:center">
              <h3 style="font-size:15px">Mina spel</h3>
              <span class="tiny muted" id="sport-bets-count"></span>
            </div>
            <div id="sport-bets" class="sport-bets"></div>
          </div>
        </aside>
      </div>

      <p class="tiny muted sport-footnote">
        Oddsen räknas fram av huset (Poisson-modell utifrån ställning och återstående tid) om matchen saknar
        riktiga odds. Inga riktiga pengar – bara spelmynt.
      </p>
    </div>`;

  root.querySelector('#sport-back').addEventListener('click', () => navigate('/kasino'));
  root.querySelector('#sport-refresh').addEventListener('click', () => refresh());
  root.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sport.filter = btn.dataset.filter;
      root.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('chip--active', b === btn));
      renderMatches();
    });
  });

  document.onkeydown = null;
  refresh();

  if (sport.timer) clearInterval(sport.timer);
  sport.timer = setInterval(() => {
    if (!document.body.contains(root)) {
      clearInterval(sport.timer);
      sport.timer = null;
      return;
    }
    refresh({ quiet: true });
  }, 15000);

  updateBalanceUI();
}

registerView('sport', renderSport);
