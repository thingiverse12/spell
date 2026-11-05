/* =====================================================================
   Live Sport – fotboll med live-odds (spelmynt).
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, num, esc, navigate, updateBalanceUI } from './core.js';
import { currentLuck, luckPayout2, luckText } from './luck.js';

const SPORT_INFO = {
  football: {
    name: 'Fotboll',
    sub: 'Live-odds på fotboll · allt spelas med spelmynt',
    markets: 'Marknader: 1X2, mål över/under 2,5, båda lagen gör mål, handikapp, halvtid och nästa mål.',
    note: 'Demoligan'
  },
  hockey: {
    name: 'Hockey',
    sub: 'Live-odds på SHL och NHL · allt spelas med spelmynt',
    markets: 'Marknader: vinnare inkl. förlängning/straffar, mål över/under 5,5, båda lagen gör mål och handikapp −1/+1.',
    note: 'Demohockeyn'
  }
};

/* Underhållsläget stänger sportspelen på servern. Då visar vi det i stället
   för att låta spelaren få ett fel först när spelet ska läggas. */
const sportClosed = () => !!state.settings.maintenance;

const sport = {
  feed: null,
  bets: [],
  sport: 'football',
  filter: 'all',
  league: 'all',
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

const whenText = (ts) => {
  try {
    const date = new Date(ts);
    const today = new Date();
    const sameDay =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();
    if (sameDay) return clockText(ts);
    return date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) + ' ' + clockText(ts);
  } catch (e) {
    return clockText(ts);
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
    const clock = match.sport === 'hockey' && match.period
      ? esc(match.period) + ' ' + match.minute + '′'
      : match.minute + '′';
    return `<span class="match-status match-status--live"><i></i>LIVE ${clock}</span>`;
  }
  if (match.status === 'finished') {
    return `<span class="match-status match-status--done">Slut</span>`;
  }
  return `<span class="match-status match-status--next">${whenText(match.kickoff)}</span>`;
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
  let matches = (sport.feed && sport.feed.matches) || [];
  if (sport.league && sport.league !== 'all') matches = matches.filter((m) => m.league === sport.league);
  if (sport.filter === 'live') return matches.filter((m) => m.status === 'live');
  if (sport.filter === 'next') return matches.filter((m) => m.status === 'upcoming');
  return matches;
}

/** Ligachips (SHL/NHL) – visas för hockey. */
function renderLeagues() {
  const root = sport.root;
  if (!root) return;
  const box = root.querySelector('#sport-leagues');
  if (!box) return;
  if (sport.sport !== 'hockey') {
    box.innerHTML = '';
    return;
  }
  const matches = (sport.feed && sport.feed.matches) || [];
  const leagues = [...new Set(matches.map((m) => m.league).filter(Boolean))];
  const options = ['all', ...leagues];
  box.innerHTML = options
    .map(
      (key) =>
        `<button class="chip ${sport.league === key ? 'chip--active' : ''}" data-league="${esc(key)}">${
          key === 'all' ? 'Alla ligor' : esc(key)
        }</button>`
    )
    .join('');
  box.querySelectorAll('[data-league]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sport.league = btn.dataset.league;
      renderLeagues();
      renderMatches();
    });
  });
}

/** Rubrik, flikar och fotnot för vald sport. */
function renderSportChrome() {
  const root = sport.root;
  if (!root) return;
  const info = SPORT_INFO[sport.sport] || SPORT_INFO.football;
  const pill = root.querySelector('#sport-pill');
  if (pill) pill.textContent = info.name;
  const sub = root.querySelector('#sport-subtitle');
  if (sub) sub.textContent = info.sub;
  const note = root.querySelector('#sport-footnote-markets');
  if (note) note.textContent = info.markets;
  root.querySelectorAll('[data-sport]').forEach((btn) => {
    btn.classList.toggle('chip--active', btn.dataset.sport === sport.sport);
  });
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
        sport: sport.sport,
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
  const factor = currentLuck();
  const potential = luckPayout2(stake, sel.odds, factor);
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
        <button class="chip-mini" data-quick="${max}" type="button" title="Satsa hela saldot">Allt</button>
      </div>

      <div class="slip__row"><span>Utbetalning vid vinst</span><strong class="slip__win">${kr(potential)}</strong></div>
      <div class="slip__row slip__row--muted"><span>Netto vid vinst</span><span>+${kr(Math.round((potential - stake) * 100) / 100)}</span></div>
      <div class="slip__row slip__row--muted"><span>Tur</span><span>${luckText(factor)} · ${factor >= 1.03 ? 'lite kvar' : factor <= 0.97 ? 'vunnit mycket' : 'jämnt läge'}</span></div>
      <div class="slip__row slip__row--muted"><span>Saldo efter spel</span><span>${kr(Math.max(0, balance - stake))}</span></div>

      <button class="btn btn--primary slip__place" id="sport-place" ${sport.busy || sportClosed() ? 'disabled' : ''}>
        ${sportClosed() ? 'Underhållsläge – spel stängda' : sport.busy ? 'Lägger spel…' : 'Lägg spel · ' + kr(stake)}
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
  if (sportClosed()) {
    toast('Sportspelen är stängda – underhållsläge', 'bad');
    renderSlip();
    return;
  }
  if (sport.busy || !sport.selection) return;
  const sel = sport.selection;
  sport.busy = true;
  renderSlip();
  try {
    const data = await api.placeSportBet({
      matchId: sel.matchId,
      market: sel.market,
      selection: sel.selection,
      amount: stake,
      sport: sel.sport || sport.sport
    });
    sfx.win();
    toast(
      `Spel lagt: ${kr(stake)} på ${sel.selectionLabel} @ ${data.bet.odds.toFixed(2).replace('.', ',')} · ${kr(data.bet.potential)} vid vinst`,
      'gold',
      3200
    );
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
    box.innerHTML = `<p class="small muted">Du har inte lagt några sportspel än.</p>`;
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
  const SOURCE_LABELS = {
    allsportsapi: 'AllSportsAPI · live',
    fotmob: 'FotMob · live',
    espn: 'ESPN · live',
    thesportsdb: 'TheSportsDB · live',
    openligadb: 'OpenLigaDB · live',
    nhl: 'NHL · live',
    shl: 'SHL · live',
    demo: 'Demoliga'
  };
  const sourceLabel =
    SOURCE_LABELS[feed.source] ||
    String(feed.source || '')
      .split('+')
      .map((key) => SOURCE_LABELS[key] || key)
      .join(' + ') ||
    'Okänd källa';
  const sourceCls = feed.source && feed.source !== 'demo' ? 'ok' : 'demo';
  const notes = [];
  if (feed.source === 'demo') notes.push('Påhittade matcher – riktig data laddas när en extern källa svarar.');
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
    const [feed, bets] = await Promise.all([
      api.sportMatches(sport.sport),
      api.sportBets().catch(() => null)
    ]);
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
    renderLeagues();
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

function setSport(kind) {
  const next = kind === 'hockey' ? 'hockey' : 'football';
  if (sport.sport === next) return;
  sport.sport = next;
  sport.feed = null;
  sport.selection = null;
  sport.bets = [];
  sport.filter = 'all';
  sport.league = 'all';
  const root = sport.root;
  if (root) {
    root.querySelectorAll('[data-filter]').forEach((b) =>
      b.classList.toggle('chip--active', b.dataset.filter === 'all')
    );
    const box = root.querySelector('#sport-matches');
    if (box) box.innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line"></div>';
    renderSportChrome();
    renderLeagues();
    renderSlip();
    renderBets();
  }
  refresh();
}

function renderSport(root) {
  sport.root = root;
  sport.selection = null;
  sport.bets = [];
  sport.feed = null;
  sport.filter = 'all';
  sport.league = 'all';
  sport.stake = Math.max(Number(state.settings.minBet) || 10, 50);

  root.innerHTML = `
    <div class="wrap sport-wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Live Sport <span class="sport-pill" id="sport-pill">Fotboll</span></h1>
          <p id="sport-subtitle">Live-odds på fotboll · allt spelas med spelmynt</p>
        </div>
        <div style="flex:1"></div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn--sm btn--ghost" id="sport-refresh">Uppdatera</button>
          <button class="btn btn--sm btn--ghost" id="sport-back">Spelhallen</button>
        </div>
      </div>

      <div class="sport-status" id="sport-status"></div>
      ${sportClosed() ? `<div class="banner-strip" id="sport-closed"><span>🔧</span><span>Underhållsläge – sportspelen är stängda just nu. Oddsen visas, men du kan inte lägga spel.</span></div>` : ''}

      <div class="sport-tabs" id="sport-tabs">
        <button class="chip chip--active" data-sport="football">Fotboll</button>
        <button class="chip" data-sport="hockey">Hockey · SHL &amp; NHL</button>
      </div>

      <div class="sport-leagues" id="sport-leagues"></div>

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
        <span id="sport-footnote-markets">Marknader: 1X2, mål över/under 2,5, båda lagen gör mål, handikapp, halvtid och nästa mål.</span>
        Oddsen räknas fram av huset (Poisson-modell utifrån ställning och återstående tid). Inga riktiga
        pengar – bara spelmynt.
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

  root.querySelectorAll('[data-sport]').forEach((btn) => {
    btn.addEventListener('click', () => setSport(btn.dataset.sport));
  });

  renderSportChrome();
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
