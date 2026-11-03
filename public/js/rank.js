/* =====================================================================
   Rikast – topplistan över spelmynt i spelhallen.

   Vem har mest pengar? Alla spelare rankas på saldo (eller på vunnet /
   största vinst). Bara namn och siffror visas – aldrig kontouppgifter.
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, esc, navigate, updateBalanceUI } from './core.js';

const SORTS = [
  { key: 'balance', icon: '💰', label: 'Mest pengar', unit: 'saldo' },
  { key: 'won', icon: '🏆', label: 'Vunnit mest', unit: 'vunnet' },
  { key: 'biggestWin', icon: '💥', label: 'Största vinsten', unit: 'största vinst' }
];

const MEDALS = ['🥇', '🥈', '🥉'];

const sortOf = (key) => SORTS.find((s) => s.key === key) || SORTS[0];

/** Siffran som listan sorteras på. */
const valueOf = (row, by) => Number(row && row[by]) || 0;

function metaText(row, by) {
  const rounds = Number(row.rounds) || 0;
  const rundor = rounds === 1 ? '1 runda' : rounds + ' rundor';
  if (by === 'won') return `${rundor} · satsat ${kr(row.wagered || 0)}`;
  if (by === 'biggestWin') return `${rundor} · vunnit ${kr(row.won || 0)}`;
  return `${rundor} · vunnit ${kr(row.won || 0)}`;
}

function podium(players, by) {
  const top = players.slice(0, 3);
  if (!top.length) return '';
  return `
    <div class="rank-podium">
      ${top
        .map(
          (row) => `
        <div class="rank-podium__card ${row.rank === 1 ? 'is-first' : ''} ${row.me ? 'is-me' : ''}">
          <div class="rank-podium__medal">${MEDALS[row.rank - 1] || row.rank}</div>
          <div class="avatar avatar--lg">${esc((row.name || '?')[0])}</div>
          <div class="rank-podium__name">${esc(row.name || '–')}${
            row.me ? ' <span class="chip chip--mint">du</span>' : ''
          }</div>
          <div class="rank-podium__value">${kr(valueOf(row, by))}</div>
          <div class="rank-podium__meta">${esc(sortOf(by).unit)}</div>
        </div>`
        )
        .join('')}
    </div>`;
}

function renderRows(players, by) {
  if (!players.length) {
    return '<p class="muted small">Ingen har spelat än – du kan bli etta.</p>';
  }
  return players
    .map(
      (row) => `
      <div class="rank-row${row.me ? ' is-me' : ''}">
        <span class="rank-row__place">${row.rank}</span>
        <span class="avatar">${esc((row.name || '?')[0])}</span>
        <span class="rank-row__name">${esc(row.name || '–')}${
          row.me ? ' <span class="chip chip--mint">du</span>' : ''
        }</span>
        <span class="rank-row__meta">${esc(metaText(row, by))}</span>
        <span class="rank-row__amount">${kr(valueOf(row, by))}</span>
      </div>`
    )
    .join('');
}

async function renderRikast(root) {
  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Rikast</h1>
          <p>Topplistan över spelmynt i spelhallen</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--ghost" id="rank-back">← Spelhallen</button>
      </div>
      <div id="rank-body"><p class="muted small">Räknar ihop alla konton…</p></div>
      <p class="tiny muted" style="margin:18px 0 30px">
        Bara spelmynt som finns på kontona just nu – inga riktiga pengar, och inga
        kontouppgifter. Korten visas för alla som är inloggade i spelhallen.
      </p>
    </div>`;

  root.querySelector('#rank-back').addEventListener('click', () => navigate('/kasino'));

  const body = root.querySelector('#rank-body');
  let by = 'balance';
  let data = null;

  const draw = () => {
    const rows = (data && data.players) || [];
    const me = data && data.me;
    const leader = rows[0];
    const sort = sortOf(by);
    body.innerHTML = `
      <div class="grid grid--3" style="margin-bottom:16px">
        <div class="panel" style="padding:18px;background:var(--surface-2)">
          <div class="stat-tile__value">${leader ? esc(leader.name || '–') : '–'}</div>
          <div class="stat-tile__label">Har mest pengar</div>
        </div>
        <div class="panel" style="padding:18px;background:var(--surface-2)">
          <div class="stat-tile__value">${kr((data && data.pool) || 0)}</div>
          <div class="stat-tile__label">Spelmynt i omlopp</div>
        </div>
        <div class="panel" style="padding:18px;background:var(--surface-2)">
          <div class="stat-tile__value">${me ? '#' + me.rank : '–'}</div>
          <div class="stat-tile__label">Din plats · ${(data && data.total) || 0} spelare</div>
        </div>
      </div>

      <div class="wrap-gap" style="margin-bottom:16px">
        ${SORTS.map(
          (s) =>
            `<button class="chip${s.key === by ? ' is-on' : ''}" data-sort="${s.key}">${s.icon} ${s.label}</button>`
        ).join('')}
        <button class="btn btn--sm btn--ghost" id="rank-reload" style="margin-left:auto">Ladda om</button>
      </div>

      ${podium(rows, by)}

      <div class="panel" style="padding:10px 16px">
        <div class="rank-head">
          <span>#</span><span></span><span>Spelare</span>
          <span class="rank-head__meta">${esc(sort.unit === 'saldo' ? 'spelat' : sort.unit)}</span>
          <span class="rank-head__value">${esc(sort.unit === 'saldo' ? 'saldo' : sort.unit)}</span>
        </div>
        <div class="rank-list">${renderRows(rows.slice(3), by)}</div>
      </div>

      ${
        me && !me.inTop
          ? `<div class="panel" style="padding:12px 16px;margin-top:12px">
              <div class="rank-row is-me">
                <span class="rank-row__place">${me.rank}</span>
                <span class="avatar">${esc((me.name || '?')[0])}</span>
                <span class="rank-row__name">${esc(me.name || '–')} <span class="chip chip--mint">du</span></span>
                <span class="rank-row__meta">utanför topp 50</span>
                <span class="rank-row__amount">${kr(valueOf(me, by))}</span>
              </div>
            </div>`
          : ''
      }`;

    body.querySelectorAll('[data-sort]').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (by === chip.dataset.sort) return;
        by = chip.dataset.sort;
        sfx.click();
        load();
      });
    });
    const reload = body.querySelector('#rank-reload');
    if (reload) reload.addEventListener('click', () => load(false));
  };

  async function load(showError = true) {
    try {
      data = await api.leaderboard(by);
      if (state.player && data.me) state.player.balance = data.me.balance;
      updateBalanceUI();
      draw();
    } catch (err) {
      if (showError) {
        body.innerHTML = `<p class="small" style="color:var(--bad)">${esc(
          err.message || 'Kunde inte hämta topplistan'
        )} – försök igen om en stund.</p>`;
      } else {
        toast('Kunde inte hämta topplistan', 'bad');
      }
    }
  }

  sfx.click();
  await load();
}

registerView('rikast', renderRikast);
