/* =====================================================================
   Kasinots logg – spelarens egna mynthändelser i spelhallen.

   Det här är en egen lista, skild från pluggets logg. Här syns bara
   insatser, vinster, bonusar, utbetalningar och adminändringar.
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, num, esc, navigate, updateBalanceUI } from './core.js';

const GAME_LABELS = {
  slots: 'Star Fortune',
  blackjack: 'Blackjack',
  videopoker: 'Videopoker',
  scratch: 'Skraplotter',
  roulette: 'Roulette',
  atelje: 'Ateljén',
  revolver: 'Rysk roulette',
  revolverbord: 'Rysk roulette – bord',
  sport: 'Live Sport',
  hockey: 'Live Sport',
  quiz: 'Plugget',
  bonus: 'Bonus',
  admin: 'Admin',
  konto: 'Konto',
  kompensation: 'Utbetalning',
  selftest: 'Test'
};

const GAME_ICONS = {
  slots: '🎰',
  blackjack: '♠',
  videopoker: '🃏',
  scratch: '🎟️',
  roulette: '🎡',
  atelje: '🎨',
  revolver: '🔫',
  revolverbord: '👥',
  sport: '⚽',
  hockey: '🏒',
  quiz: '📚',
  bonus: '🎁',
  admin: '⚙',
  konto: '👤',
  kompensation: '💸'
};

function isCasinoEntry(entry) {
  if (!entry) return false;
  if (entry.game === 'quiz' || entry.game === 'konto' || entry.game === 'selftest') return false;
  return true;
}

function timeText(ts) {
  try {
    return new Date(Number(ts) || 0).toLocaleString('sv-SE', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Stockholm'
    });
  } catch (e) {
    return '–';
  }
}

function entryLabel(entry) {
  const game = GAME_LABELS[entry.game] || entry.game || 'Spel';
  const kind = String(entry.kind || '');
  if (kind === 'insats') return game + ' – insats';
  if (kind === 'vinst') return game + ' – vinst';
  if (kind === 'gåva') return '🎁 Gåva från personalen';
  if (kind === 'bonus') return 'Bonus';
  if (kind === 'utbetalning') return 'Utbetalning';
  if (kind === 'admin' && entry.game === 'pausad') return '⏸ Pausad av personalen';
  if (kind === 'admin' && entry.game === 'paus släppt') return '▶ Pausen släppt';
  if (kind === 'admin' || kind === 'saldo ändrat') return 'Admin – ' + (entry.game || 'saldo');
  if (kind === 'aterbetalning') return game + ' – återbetalning';
  if (kind === 'avstängd') return 'Kontot avstängt';
  if (kind === 'nollställd') return 'Kontot nollställt';
  return game + (kind ? ' – ' + kind : '');
}

function renderRows(entries, filter) {
  const list = entries.filter((e) => {
    if (filter === 'alla') return true;
    if (filter === 'insatser') return e.kind === 'insats';
    if (filter === 'vinster') return e.kind === 'vinst' || e.kind === 'utbetalning';
    return !['insats', 'vinst', 'utbetalning'].includes(e.kind);
  });
  if (!list.length) {
    return `<p class="muted small">Inget loggat än. Spela en runda i spelhallen, så dyker den upp här.</p>`;
  }
  return `<div class="log-list">${list
    .map((e) => {
      const amount = Number(e.amount) || 0;
      const cls = amount > 0 ? 'is-plus' : amount < 0 ? 'is-minus' : '';
      return `
        <div class="log-row">
          <span class="log-row__time">${timeText(e.t)}</span>
          <span class="study-log__what">
            <span class="study-log__icon">${GAME_ICONS[e.game] || '🪙'}</span>
            ${esc(entryLabel(e))}
          </span>
          <span class="log-row__amount ${cls}">${amount > 0 ? '+' : ''}${kr(amount)}</span>
        </div>`;
    })
    .join('')}</div>`;
}

async function renderHistorik(root) {
  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Logg</h1>
          <p>Dina spelmynt i spelhallen</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--ghost" id="hist-back">← Spelhallen</button>
      </div>
      <div id="hist-body"><p class="muted small">Hämtar loggen…</p></div>
      <p class="tiny muted" style="margin:18px 0 30px">
        Här ligger bara spelhallen. Vad du svarat i plugget ser du i pluggets egen logg i studieläget.
      </p>
    </div>`;

  root.querySelector('#hist-back').addEventListener('click', () => navigate('/kasino'));

  const body = root.querySelector('#hist-body');
  let filter = 'alla';
  let entries = [];

  const draw = () => {
    const insatser = entries.filter((e) => e.kind === 'insats').reduce((sum, e) => sum + Math.abs(Number(e.amount) || 0), 0);
    const vinster = entries.filter((e) => e.kind === 'vinst' || e.kind === 'utbetalning').reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    body.innerHTML = `
      <div class="grid grid--3" style="margin-bottom:16px">
        <div class="panel" style="padding:18px;background:var(--surface-2)">
          <div class="stat-tile__value">${kr(state.player ? state.player.balance : 0)}</div>
          <div class="stat-tile__label">Saldo nu</div>
        </div>
        <div class="panel" style="padding:18px;background:var(--surface-2)">
          <div class="stat-tile__value">${kr(insatser)}</div>
          <div class="stat-tile__label">Satsat (senaste raderna)</div>
        </div>
        <div class="panel" style="padding:18px;background:var(--surface-2)">
          <div class="stat-tile__value">${kr(vinster)}</div>
          <div class="stat-tile__label">Vunnet (senaste raderna)</div>
        </div>
      </div>

      <div class="wrap-gap" style="margin-bottom:14px">
        ${[
          ['alla', 'Alla'],
          ['insatser', 'Insatser'],
          ['vinster', 'Vinster'],
          ['ovrigt', 'Bonus & övrigt']
        ]
          .map(
            ([key, label]) =>
              `<button class="chip${filter === key ? ' is-on' : ''}" data-filter="${key}">${label}</button>`
          )
          .join('')}
        <button class="btn btn--sm btn--ghost" id="hist-reload" style="margin-left:auto">Ladda om</button>
      </div>

      <div id="hist-rows">${renderRows(entries, filter)}</div>`;

    body.querySelectorAll('[data-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        filter = chip.dataset.filter;
        draw();
      });
    });
    const reload = body.querySelector('#hist-reload');
    if (reload) reload.addEventListener('click', () => load(false));
  };

  async function load(showError = true) {
    try {
      const data = await api.log();
      entries = (data.coins || []).filter(isCasinoEntry);
      if (data.balance != null && state.player) state.player.balance = data.balance;
      updateBalanceUI();
      draw();
    } catch (err) {
      if (showError) {
        body.innerHTML = `<p class="small" style="color:var(--bad)">${esc(
          err.message || 'Kunde inte hämta loggen'
        )} – försök igen om en stund.</p>`;
      } else {
        toast('Kunde inte hämta loggen', 'bad');
      }
    }
  }

  sfx.click();
  await load();
}

registerView('historik', renderHistorik);
