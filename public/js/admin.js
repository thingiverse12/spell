/* =====================================================================
   Adminpanelen – saldon, spelare, spelinställningar och logg.
   Nås med lärarkoden.
   ===================================================================== */

import {
  registerView, state, api, sfx, toast, kr, num, esc, navigate, openModal, confirmModal, storage, localAdmin, sleep,
  updateBalanceUI
} from './core.js';
import { renderEkonomi } from './economy.js';
import { clampLuckSetting, LUCK_SETTING_MIN, LUCK_SETTING_MAX } from './luck.js';

let tab = 'oversikt';

/* All data går via dessa helpers så att panelen fungerar både mot
   servern och i lokalt läge (när API:t inte svarar). */

async function loginWithCode(code) {
  try {
    await api.adminLogin(code);
    state.adminLocal = false;
    return 'cloud';
  } catch (err) {
    if (err.offline) {
      localAdmin.login(code); // kastar Fel kod
      state.adminLocal = true;
      return 'local';
    }
    throw err;
  }
}

async function loadOverview() {
  if (state.adminLocal) return localAdmin.overview();
  try {
    return await api.adminOverview();
  } catch (err) {
    if (err.offline) {
      state.adminLocal = true;
      return localAdmin.overview();
    }
    throw err;
  }
}

const playerAction = (id, action, value) =>
  state.adminLocal ? Promise.resolve(localAdmin.player(id, action, value)) : api.adminPlayer(id, action, value);

const saveSettings = (settings) =>
  state.adminLocal ? Promise.resolve(localAdmin.settings(settings)) : api.adminSettings(settings);

const sendBroadcast = (message) =>
  state.adminLocal ? Promise.resolve(localAdmin.broadcast(message)) : api.adminBroadcast(message);

const GAME_LABELS = {
  blackjack: 'Blackjack',
  slots: 'Star Fortune',
  videopoker: 'Videopoker',
  kortleken: 'Kortleken',
  sport: 'Sport (Live Sport)',
  quiz: 'Quiz',
  bonus: 'Bonus',
  admin: 'Admin',
  konto: 'Konto'
};

const gameLabel = (key) => GAME_LABELS[key] || key;

const TABS = [
  { key: 'oversikt', label: 'Översikt' },
  { key: 'vinster', label: 'Vinster' },
  { key: 'spelare', label: 'Spelare' },
  { key: 'fotboll', label: 'Sport' },
  { key: 'installningar', label: 'Spelinställningar' },
  { key: 'ekonomi', label: 'Ekonomi' },
  { key: 'logg', label: 'Logg' },
  { key: 'meddelande', label: 'Meddelande' }
];

function timeText(t) {
  if (!t) return '–';
  const d = new Date(t);
  return d.toLocaleString('sv-SE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------ Kod-modal ------------------------------ */

const loginErrorText = (err) =>
  err && err.status === 401
    ? 'Fel kod.'
    : 'Kunde inte logga in: ' + ((err && err.message) || 'okänt fel');

export function openAdminCode() {
  openModal({
    title: 'Personal',
    sub: 'Ange koden för att öppna adminpanelen.',
    body: `<label class="field"><span>Kod</span>
        <input class="input" id="admin-code-input" type="password" placeholder="••••••••" autocomplete="off" /></label>
      <div id="admin-code-err"></div>`,
    actions: [
      { label: 'Avbryt' },
      {
        label: 'Öppna',
        kind: 'primary',
        onClick: async (close, root) => {
          const input = root.querySelector('#admin-code-input');
          const code = input.value.trim();
          if (!code) return;
          try {
            await loginWithCode(code);
            close();
            sfx.win();
            toast('Välkommen, chef!', 'gold');
            navigate('/admin');
          } catch (err) {
            root.querySelector('#admin-code-err').innerHTML =
              `<p class="quiz__feedback quiz__feedback--no">${esc(loginErrorText(err))}</p>`;
            sfx.wrong();
            input.value = '';
            input.focus();
          }
        }
      }
    ]
  });
}

/* ------------------------------ Inloggningsvy ------------------------------ */

function renderLogin(root, message = '') {
  root.innerHTML = `
    <div class="wrap">
      <div style="max-width:460px;margin:60px auto">
        <div class="panel" style="padding:28px">
          <div class="admin-hero" style="margin-top:0">
            <div class="admin-hero__icon">⚙</div>
            <div>
              <h2 style="font-size:20px">Adminpanel</h2>
              <p class="small muted">Golden Spade · personal</p>
            </div>
          </div>
          <p class="small muted" style="margin-bottom:18px">Ange koden för att hantera spelare, saldon och spelinställningar.</p>
          <label class="field"><span>Kod</span>
            <input class="input" id="admin-login-code" type="password" placeholder="••••••••" autocomplete="off" />
          </label>
          ${message ? `<p class="quiz__feedback quiz__feedback--no">${esc(message)}</p>` : ''}
          <div id="admin-login-err"></div>
          <button class="btn btn--primary btn--block" id="admin-login-btn">Logga in</button>
          <button class="btn btn--ghost btn--block" id="admin-back" style="margin-top:10px">Till spelhallen</button>
        </div>
      </div>
    </div>`;

  const input = root.querySelector('#admin-login-code');
  const btn = root.querySelector('#admin-login-btn');

  async function submit() {
    const code = input.value.trim();
    if (!code) return;
    btn.disabled = true;
    try {
      await loginWithCode(code);
      sfx.win();
      toast(state.adminLocal ? 'Inloggad lokalt' : 'Inloggad', 'ok');
      renderAdmin(root);
    } catch (err) {
      root.querySelector('#admin-login-err').innerHTML =
        `<p class="quiz__feedback quiz__feedback--no">${esc(loginErrorText(err))}</p>`;
      sfx.wrong();
      input.value = '';
      input.focus();
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  root.querySelector('#admin-back').addEventListener('click', () => navigate('/kasino'));
  setTimeout(() => input.focus(), 80);
}

/* ------------------------------ Dashboard ------------------------------ */

async function renderAdmin(root) {
  if (!state.adminLocal) {
    if (!state.adminToken) {
      const saved = storage.get('ph.admin', null);
      if (saved) state.adminToken = saved;
    }
    if (!state.adminToken) return renderLogin(root);
  }

  root.innerHTML = `<div class="wrap"><p class="muted" style="padding:60px 0">Laddar panelen …</p></div>`;

  let data;
  try {
    data = await loadOverview();
  } catch (err) {
    if (err.status === 401) {
      // Kan vara en fördröjning i lagringen precis efter inloggningen –
      // försök en gång till innan vi loggar ut.
      try {
        await sleep(500);
        data = await loadOverview();
      } catch (err2) {
        state.adminToken = null;
        storage.del('ph.admin');
        return renderLogin(root, 'Sessionen har gått ut. Logga in igen.');
      }
    } else {
      return renderLogin(root, err.message);
    }
  }

  state.adminData = data;
  state.settings = { ...state.settings, ...data.settings };
  const { players, totals, settings, transactions } = data;

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Adminpanel</h1>
          <p>Golden Spade · ${players.length} spelare</p>
        </div>
        <div style="flex:1"></div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn--sm btn--ghost" id="admin-refresh">↻ Uppdatera</button>
          <button class="btn btn--sm btn--ghost" id="admin-goto-casino">Till spelhallen</button>
          <button class="btn btn--sm btn--danger" id="admin-logout">Logga ut</button>
        </div>
      </div>

      <div class="admin-hero">
        <div class="admin-hero__icon">⚙</div>
        <div style="flex:1;min-width:200px">
          <h2 style="font-size:18px">Casinochef</h2>
          <p class="small muted">Du ser allt som händer i spelhallen. Ändringar slår igenom direkt för spelarna.</p>
        </div>
        ${settings.maintenance ? '<span class="chip" style="background:rgba(220,47,72,.18);color:#ff8a9b">🔧 Underhållsläge på</span>' : ''}
        ${data.storage === 'local'
          ? '<span class="chip chip--amber" title="Servern svarar inte – panelen styr den här enhetens spelare">● Lokalt läge</span>'
          : '<span class="chip chip--mint">● Online</span>'}
      </div>

      <div class="admin-stats">
        <div class="admin-stat"><div class="admin-stat__value">${players.length}</div><div class="admin-stat__label">Spelare</div></div>
        <div class="admin-stat"><div class="admin-stat__value">${totals.active24h}</div><div class="admin-stat__label">Aktiva 24 h</div></div>
        <div class="admin-stat"><div class="admin-stat__value">${kr(totals.wagered)}</div><div class="admin-stat__label">Omsatt (mynt)</div></div>
        <div class="admin-stat"><div class="admin-stat__value">${kr(totals.won)}</div><div class="admin-stat__label">Utbetalt (mynt)</div></div>
      </div>

      <div class="tabs">
        ${TABS.map((t) => `<button class="tab ${tab === t.key ? 'is-active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
      </div>

      <div id="admin-content"></div>
    </div>`;

  root.querySelectorAll('[data-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      tab = el.dataset.tab;
      sfx.click();
      renderAdmin(root);
    });
  });
  root.querySelector('#admin-refresh').addEventListener('click', () => renderAdmin(root));
  root.querySelector('#admin-goto-casino').addEventListener('click', () => navigate('/kasino'));
  root.querySelector('#admin-logout').addEventListener('click', async () => {
    const ok = await confirmModal({ title: 'Logga ut?', text: 'Du måste ange koden igen för att komma tillbaka.', confirmLabel: 'Logga ut', danger: true });
    if (!ok) return;
    api.adminLogout();
    state.adminLocal = false;
    navigate('/kasino');
  });

  const content = root.querySelector('#admin-content');
  if (tab === 'oversikt') renderOversikt(content, root, data);
  if (tab === 'vinster') renderVinster(content, data);
  if (tab === 'spelare') renderSpelare(content, root, data);
  if (tab === 'fotboll') renderFotboll(content, root);
  if (tab === 'installningar') renderInstallningar(content, root, data);
  if (tab === 'ekonomi') renderEkonomi(content, root, data);
  if (tab === 'logg') renderLogg(content, data);
  if (tab === 'meddelande') renderMeddelande(content, root, data);
}

/* Admin får fylla på sitt eget konto – mynten är påhittade och loggas. */
const SELF_QUICK = [500, 1000, 5000, 10000];
const SELF_MAX = 1000000;

async function giveSelfCoins(amount, root) {
  const me = state.player;
  if (!me || !me.id) {
    toast('Ingen spelare är inloggad', 'bad');
    return;
  }
  const value = Math.round(Number(amount) || 0);
  if (!(value > 0)) {
    toast('Ange ett belopp först', 'bad');
    return;
  }
  if (value > SELF_MAX) {
    toast(`Högst ${kr(SELF_MAX)} åt gången`, 'bad');
    return;
  }
  try {
    const data = await playerAction(me.id, 'add', value);
    const fresh = data && data.player;
    state.player = state.player || {};
    if (fresh && typeof fresh.balance === 'number') state.player.balance = fresh.balance;
    else state.player.balance = (state.player.balance || 0) + value;
    updateBalanceUI();
    sfx.correct();
    toast(`+${kr(value)} till ditt konto`, 'gold');
    renderAdmin(root);
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function selfCoinsHTML() {
  const me = state.player;
  const name = me && me.name ? me.name : 'gäst';
  const balance = me && typeof me.balance === 'number' ? me.balance : 0;
  if (!me) {
    return `<div class="panel admin-coins">
      <p class="small muted">Ingen spelare är inloggad i webbläsaren – öppna spelhallen först, då skapas ett konto.</p>
    </div>`;
  }
  return `
    <div class="panel admin-coins">
      <div class="admin-coins__head">
        <div>
          <h3 style="font-size:15px">Mina spelmynt</h3>
          <p class="small muted" style="margin-top:4px">
            Du är inloggad som <b>${esc(name)}</b> och har <b class="admin-coins__balance">${kr(balance)}</b>.
            Påfyllningen loggas som admin och mynten är fortfarande bara låtsas.
          </p>
        </div>
      </div>
      <div class="admin-coins__row">
        ${SELF_QUICK.map((v) => `<button class="btn btn--sm btn--ghost" data-self-coins="${v}">+${num(v)}</button>`).join('')}
        <span class="admin-coins__sep"></span>
        <input class="input admin-coins__input" id="self-coins-amount" type="number" inputmode="numeric"
               min="1" max="${SELF_MAX}" step="100" placeholder="Eget belopp" />
        <button class="btn btn--sm btn--primary" id="self-coins-add">Ge mig mynt</button>
      </div>
      <p class="tiny muted" style="margin-top:8px">Högst ${kr(SELF_MAX)} per klick.</p>
    </div>`;
}

function bindSelfCoins(content, root) {
  content.querySelectorAll('[data-self-coins]').forEach((btn) => {
    btn.addEventListener('click', () => giveSelfCoins(Number(btn.dataset.selfCoins), root));
  });
  const add = content.querySelector('#self-coins-add');
  const input = content.querySelector('#self-coins-amount');
  if (!add || !input) return;
  add.addEventListener('click', () => giveSelfCoins(input.value, root));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') giveSelfCoins(input.value, root);
  });
}

function renderOversikt(content, root, data) {
  const { players, transactions, totals } = data;
  const sorted = players.slice().sort((a, b) => b.balance - a.balance);
  const houseEdge = totals.wagered > 0 ? Math.round(((totals.wagered - totals.won) / totals.wagered) * 100) : 0;

  content.innerHTML = `
    ${selfCoinsHTML()}

    <div class="grid grid--2" style="margin-top:16px">
      <div class="panel" style="padding:20px">
        <h3 style="font-size:15px;margin-bottom:14px">Största saldon</h3>
        <div class="log-list">
          ${sorted.slice(0, 8).map((p) => `
            <div class="log-row" style="grid-template-columns:1fr auto">
              <span><b>${esc(p.name)}</b> <span class="muted tiny">· ${p.rounds} rundor</span></span>
              <span class="log-row__amount">${kr(p.balance)}</span>
            </div>`).join('') || '<p class="muted small">Inga spelare än.</p>'}
        </div>
      </div>

      <div class="panel" style="padding:20px">
        <h3 style="font-size:15px;margin-bottom:14px">Huset vs spelarna</h3>
        <div class="row row--between" style="margin-bottom:12px"><span class="small muted">Omsatt</span><b>${kr(totals.wagered)}</b></div>
        <div class="row row--between" style="margin-bottom:12px"><span class="small muted">Utbetalt</span><b>${kr(totals.won)}</b></div>
        <div class="row row--between" style="margin-bottom:12px"><span class="small muted">Rundor</span><b>${num(totals.rounds)}</b></div>
        <div class="progress" style="margin:14px 0 8px"><div class="progress__bar" style="width:${Math.min(100, Math.abs(houseEdge))}%"></div></div>
        <p class="tiny muted">Husets marginal: ${houseEdge} % (spelmynt).</p>
      </div>
    </div>

    <div class="panel" style="padding:20px;margin-top:16px">
      <h3 style="font-size:15px;margin-bottom:14px">Senaste aktivitet</h3>
      <div class="log-list">
        ${(transactions || []).slice(0, 10).map((t) => `
          <div class="log-row">
            <span class="log-row__time">${timeText(t.t)}</span>
            <span>${esc(t.playerName || '–')} · ${esc(t.game)} <span class="muted tiny">(${esc(t.kind)})</span></span>
            <span class="log-row__amount ${t.amount >= 0 ? 'is-plus' : 'is-minus'}">${t.amount >= 0 ? '+' : ''}${kr(t.amount)}</span>
          </div>`).join('') || '<p class="muted small">Ingen aktivitet än.</p>'}
      </div>
    </div>`;

  bindSelfCoins(content, root);
}

function renderVinster(content, data) {
  const { players, totals, gameTotals = {}, transactions = [] } = data;
  const biggest = players.reduce((max, p) => Math.max(max, p.biggestWin || 0), 0);
  const net = Math.round((totals.won || 0) - (totals.wagered || 0));
  const games = Object.entries(gameTotals).sort((a, b) => b[1].won - a[1].won);
  const winners = players.slice().sort((a, b) => (b.won || 0) - (a.won || 0));
  const payouts = transactions.filter((t) => t.kind === 'vinst').slice(0, 40);

  content.innerHTML = `
    <div class="admin-stats">
      <div class="admin-stat"><div class="admin-stat__value">${kr(totals.won)}</div><div class="admin-stat__label">Utbetalt totalt</div></div>
      <div class="admin-stat"><div class="admin-stat__value">${kr(totals.wagered)}</div><div class="admin-stat__label">Satsat totalt</div></div>
      <div class="admin-stat"><div class="admin-stat__value" style="color:${net >= 0 ? '#6ff0b8' : '#ff8a9b'}">${net >= 0 ? '+' : ''}${kr(net)}</div><div class="admin-stat__label">Netto till spelarna</div></div>
      <div class="admin-stat"><div class="admin-stat__value">${kr(biggest)}</div><div class="admin-stat__label">Största enskilda vinst</div></div>
    </div>

    <div class="grid grid--2">
      <div class="panel" style="padding:20px">
        <h3 style="font-size:15px;margin-bottom:14px">Per spel</h3>
        <div class="table-scroll" style="border:0">
          <table class="data-table" style="min-width:0">
            <thead><tr><th>Spel</th><th>Satsat</th><th>Utbetalt</th><th>Netto</th><th>Rundor</th></tr></thead>
            <tbody>
              ${games.length ? games.map(([key, g]) => {
                const diff = Math.round((g.won || 0) - (g.wagered || 0));
                return `<tr>
                  <td><b>${esc(gameLabel(key))}</b></td>
                  <td class="num">${kr(g.wagered || 0)}</td>
                  <td class="num">${kr(g.won || 0)}</td>
                  <td class="num" style="color:${diff >= 0 ? '#6ff0b8' : '#ff8a9b'}">${diff >= 0 ? '+' : ''}${kr(diff)}</td>
                  <td class="num">${g.rounds || 0}</td>
                </tr>`;
              }).join('') : '<tr><td colspan="5" class="muted">Inga spel ännu.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel" style="padding:20px">
        <h3 style="font-size:15px;margin-bottom:14px">Vad spelarna vinner</h3>
        <div class="table-scroll" style="border:0">
          <table class="data-table" style="min-width:0">
            <thead><tr><th>Spelare</th><th>Vunnet</th><th>Satsat</th><th>Netto</th><th>Största</th></tr></thead>
            <tbody>
              ${winners.length ? winners.slice(0, 12).map((p) => {
                const n = Math.round((p.won || 0) - (p.wagered || 0));
                return `<tr>
                  <td><div class="row" style="gap:8px"><span class="avatar">${esc((p.name || '?')[0])}</span><span>${esc(p.name)}</span></div></td>
                  <td class="num">${kr(p.won || 0)}</td>
                  <td class="num">${kr(p.wagered || 0)}</td>
                  <td class="num" style="color:${n >= 0 ? '#6ff0b8' : '#ff8a9b'}">${n >= 0 ? '+' : ''}${kr(n)}</td>
                  <td class="num">${kr(p.biggestWin || 0)}</td>
                </tr>`;
              }).join('') : '<tr><td colspan="5" class="muted">Inga spelare än.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel" style="padding:20px;margin-top:16px">
      <h3 style="font-size:15px;margin-bottom:14px">Senaste utbetalningarna</h3>
      <div class="log-list">
        ${payouts.length ? payouts.map((t) => `
          <div class="log-row">
            <span class="log-row__time">${timeText(t.t)}</span>
            <span><b>${esc(t.playerName || '–')}</b> · ${esc(gameLabel(t.game))}</span>
            <span class="log-row__amount is-plus">+${kr(t.amount)}</span>
          </div>`).join('') : '<p class="muted small">Inga vinster loggade än.</p>'}
      </div>
    </div>`;
}

function renderSpelare(content, root, data) {
  content.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Spelare</th><th>Saldo</th><th>Omsatt</th><th>Vunnet</th><th>Netto</th><th>Rundor</th><th>Senast</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${data.players.map((p) => `
            <tr>
              <td><div class="row" style="gap:9px"><span class="avatar">${esc((p.name || '?')[0])}</span><div><div style="font-weight:700">${esc(p.name)}${state.player && p.id === state.player.id ? ' <span class="chip chip--mint">du</span>' : ''}</div><div class="tiny muted">#${esc(p.id)}</div></div></div></td>
              <td class="num">${kr(p.balance)}</td>
              <td class="num">${kr(p.wagered)}</td>
              <td class="num">${kr(p.won)}</td>
              <td class="num" style="color:${(p.won - p.wagered) >= 0 ? '#6ff0b8' : '#ff8a9b'}">${(p.won - p.wagered) >= 0 ? '+' : ''}${kr(p.won - p.wagered)}</td>
              <td class="num">${p.rounds}</td>
              <td class="tiny muted">${timeText(p.lastSeen)}</td>
              <td>${p.banned ? '<span class="chip" style="background:rgba(220,47,72,.18);color:#ff8a9b">Avstängd</span>' : p.isGuest ? '<span class="chip">Gäst</span>' : '<span class="chip chip--mint">Konto</span>'}</td>
              <td style="white-space:nowrap">
                <button class="btn btn--sm btn--ghost" data-balance="${p.id}">Saldo</button>
                <button class="btn btn--sm btn--ghost" data-ban="${p.id}">${p.banned ? 'Släpp' : 'Stäng'}</button>
                <button class="btn btn--sm btn--ghost" data-reset="${p.id}">Noll</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="8" class="muted">Inga spelare ännu.</td></tr>'}
        </tbody>
      </table>
    </div>
    <p class="tiny muted" style="margin-top:12px">Spelare skapas automatiskt när någon öppnar appen. Saldon är spelmynt utan värde.</p>`;

  content.querySelectorAll('[data-balance]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = data.players.find((p) => p.id === btn.dataset.balance);
      openModal({
        title: 'Ändra saldo',
        sub: `${player.name} har ${kr(player.balance)} i spelmynt.`,
        body: `<label class="field"><span>Nytt saldo</span>
            <input class="input" id="bal-input" type="number" min="0" step="50" value="${Math.round(player.balance)}" /></label>
          <div class="wrap-gap">
            <button class="btn btn--sm btn--ghost" data-add="500">+500</button>
            <button class="btn btn--sm btn--ghost" data-add="1000">+1 000</button>
            <button class="btn btn--sm btn--ghost" data-add="5000">+5 000</button>
          </div>`,
        actions: [
          { label: 'Avbryt' },
          {
            label: 'Spara',
            kind: 'primary',
            onClick: async (close, modal) => {
              const value = Number(modal.querySelector('#bal-input').value);
              try {
                await playerAction(player.id, 'setBalance', value);
                close();
                toast('Saldot uppdaterat', 'ok');
                renderAdmin(root);
              } catch (err) {
                toast(err.message, 'bad');
              }
            }
          }
        ],
        onMount: (modal) => {
          modal.querySelectorAll('[data-add]').forEach((b) => {
            b.addEventListener('click', () => {
              const input = modal.querySelector('#bal-input');
              input.value = Number(input.value || 0) + Number(b.dataset.add);
            });
          });
        }
      });
    });
  });

  content.querySelectorAll('[data-ban]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const player = data.players.find((p) => p.id === btn.dataset.ban);
      try {
        await playerAction(player.id, 'ban', !player.banned);
        toast(player.banned ? 'Spelaren släppt' : 'Spelaren avstängd', 'ok');
        renderAdmin(root);
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  });

  content.querySelectorAll('[data-reset]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const player = data.players.find((p) => p.id === btn.dataset.reset);
      const ok = await confirmModal({
        title: 'Nollställ spelare?',
        text: `${player.name} får tillbaka startbalansen.`,
        confirmLabel: 'Nollställ',
        danger: true
      });
      if (!ok) return;
      try {
        await playerAction(player.id, 'reset');
        toast('Spelaren nollställd', 'ok');
        renderAdmin(root);
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  });
}

const CHANCE_LEVELS = [
  { value: 0.25, label: 'Mycket låg' },
  { value: 0.7, label: 'Låg' },
  { value: 1, label: 'Normal' },
  { value: 1.4, label: 'Hög' },
  { value: 2, label: 'Mycket hög' },
  { value: 3, label: 'Extrem' }
];

const chanceFmt = (v) => '×' + Number(v).toFixed(2).replace('.', ',');

/** Kryssrutor för tur/svårighet – ändringen sparas direkt när man kryssar i. */
function chanceBox(key, title, value) {
  const current = Number(value) || 1;
  const levels = CHANCE_LEVELS.slice();
  if (!levels.some((l) => Math.abs(l.value - current) < 0.001)) {
    levels.push({ value: current, label: 'Egen' });
    levels.sort((a, b) => a.value - b.value);
  }
  return `
    <div class="chance" data-chance="${key}">
      <div class="chance__head">
        <span class="chance__name">${title}</span>
        <b class="chance__value" data-chance-val>${chanceFmt(current)}</b>
      </div>
      <div class="chance__row">
        ${levels
          .map(
            (l) => `<label class="check-chip">
            <input type="checkbox" value="${l.value}" ${Math.abs(l.value - current) < 0.001 ? 'checked' : ''} />
            <span>${l.label} <em>${chanceFmt(l.value)}</em></span>
          </label>`
          )
          .join('')}
      </div>
      <div class="chance__custom">
        <input class="input chance__input" type="text" inputmode="decimal" autocomplete="off"
               value="${Number(current.toFixed(2))}" data-good="${Number(current.toFixed(2))}"
               data-chance-input aria-label="Egen tur-nivå" />
        <button class="btn btn--sm btn--ghost" data-chance-save>Sätt egen nivå</button>
        <span class="tiny muted">${chanceFmt(LUCK_SETTING_MIN)}–${chanceFmt(LUCK_SETTING_MAX)}</span>
      </div>
    </div>`;
}

function renderInstallningar(content, root, data) {
  const s = data.settings;
  content.innerHTML = `
    <div class="panel" style="padding:22px">
      <h3 style="font-size:15px;margin-bottom:16px">Bord och insatser</h3>
      <div class="settings-grid">
        <label class="field"><span>Minsta insats (kr)</span><input class="input" id="set-minBet" type="number" value="${s.minBet}" /></label>
        <label class="field"><span>Högsta insats (kr)</span><input class="input" id="set-maxBet" type="number" value="${s.maxBet}" /></label>
        <label class="field"><span>Startsaldo nya spelare</span><input class="input" id="set-startBalance" type="number" value="${s.startBalance}" /></label>
        <label class="field"><span>Daglig bonus</span><input class="input" id="set-dailyBonus" type="number" value="${s.dailyBonus}" /></label>
        <label class="field"><span>Belöning per rätt svar (quiz)</span><input class="input" id="set-quizReward" type="number" value="${s.quizReward}" /></label>
        <label class="field"><span>Blackjack-utbetalning</span>
          <select class="select" id="set-blackjackPayout">
            <option value="1.5" ${s.blackjackPayout === 1.5 ? 'selected' : ''}>3:2 (1,5×)</option>
            <option value="1.2" ${s.blackjackPayout === 1.2 ? 'selected' : ''}>6:5 (1,2×)</option>
            <option value="1" ${s.blackjackPayout === 1 ? 'selected' : ''}>1:1</option>
          </select>
        </label>
      </div>

      <h3 style="font-size:15px;margin:24px 0 6px">Tur och svårighet</h3>
      <p class="chance-hint">Kryssa i nivån – ändringen sparas direkt, ingen spara-knapp behövs.</p>
      ${chanceBox('slotLuck', 'Slots – tur', s.slotLuck)}
      ${chanceBox('videoPokerLuck', 'Videopoker – tur', s.videoPokerLuck)}
      ${chanceBox('scratchLuck', 'Skraplotter – tur', s.scratchLuck)}

      <div class="switch">
        <div><div class="switch__label">Dealer tar kort på mjuk 17</div><div class="switch__hint">Gör blackjack lite tuffare</div></div>
        <div class="toggle ${s.dealerHitsSoft17 ? 'is-on' : ''}" data-toggle="dealerHitsSoft17"></div>
      </div>
      <div class="switch">
        <div><div class="switch__label">Dubbelt efter split</div><div class="switch__hint">Tillåt dubbel på splittade händer</div></div>
        <div class="toggle ${s.doubleAfterSplit ? 'is-on' : ''}" data-toggle="doubleAfterSplit"></div>
      </div>
      <div class="switch">
        <div>
          <div class="switch__label">Gummiband (dynamisk tur)</div>
          <div class="switch__hint">Lite kvar på kontot → högre tur. Vunnit mycket → lägre tur</div>
        </div>
        <div class="toggle ${s.rubberBand !== false ? 'is-on' : ''}" data-toggle="rubberBand"></div>
      </div>
      <div class="switch">
        <div><div class="switch__label">Underhållsläge</div><div class="switch__hint">Visar en underhållsnotis i spelhallen</div></div>
        <div class="toggle ${s.maintenance ? 'is-on' : ''}" data-toggle="maintenance"></div>
      </div>

      <button class="btn btn--primary" id="save-settings" style="margin-top:20px">Spara inställningar</button>
    </div>`;

  const state2 = {
    dealerHitsSoft17: s.dealerHitsSoft17,
    doubleAfterSplit: s.doubleAfterSplit,
    maintenance: s.maintenance,
    rubberBand: s.rubberBand !== false
  };

  content.querySelectorAll('[data-toggle]').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.toggle;
      state2[key] = !state2[key];
      el.classList.toggle('is-on', state2[key]);
      sfx.click();
      if (key === 'rubberBand') {
        saveSettings({ rubberBand: state2.rubberBand })
          .then(() => {
            toast(state2.rubberBand ? 'Gummibandet är på' : 'Gummibandet är av', 'ok');
            if (state.adminData && state.adminData.settings) state.adminData.settings.rubberBand = state2.rubberBand;
          })
          .catch((err) => toast(err.message, 'bad'));
      }
    });
  });

  const saveChance = async (group, value) => {
    const key = group.dataset.chance;
    group.querySelectorAll('input[type="checkbox"]').forEach((box) => {
      box.checked = Math.abs(Number(box.value) - value) < 0.001;
    });
    const out = group.querySelector('[data-chance-val]');
    if (out) out.textContent = chanceFmt(value);
    const field = group.querySelector('[data-chance-input]');
    if (field) {
      const text = Number(value.toFixed(2));
      field.dataset.good = text;
      if (document.activeElement !== field) field.value = text;
    }
    const name = key === 'slotLuck' ? 'Slots' : key === 'scratchLuck' ? 'Skraplotter' : 'Videopoker';
    try {
      await saveSettings({ [key]: value });
      sfx.click();
      toast(`${name} – tur ${chanceFmt(value)}`, 'ok');
      if (state.adminData && state.adminData.settings) state.adminData.settings[key] = value;
    } catch (err) {
      toast(err.message, 'bad');
    }
  };

  content.querySelectorAll('[data-chance]').forEach((group) => {
    group.querySelectorAll('input[type="checkbox"]').forEach((box) => {
      box.addEventListener('change', () => {
        if (!box.checked) {
          box.checked = true; // en nivå måste alltid vara vald
          return;
        }
        saveChance(group, Number(box.value));
      });
    });

    // Egen nivå: skriv exakt vilken tur som helst inom spannet.
    const input = group.querySelector('[data-chance-input]');
    const save = group.querySelector('[data-chance-save]');
    const restore = () => {
      input.value = input.dataset.good || '1';
    };
    const applyCustom = () => {
      const raw = Number(String(input.value).trim().replace(',', '.'));
      if (!Number.isFinite(raw)) {
        toast('Ange en tur-nivå, t.ex. 1,25', 'bad');
        restore();
        return;
      }
      if (raw <= 0) {
        toast('Tur-nivån måste vara större än 0', 'bad');
        restore();
        return;
      }
      const value = clampLuckSetting(raw);
      if (Math.abs(value - raw) > 0.001) {
        toast(`Nivån ligger mellan ${chanceFmt(LUCK_SETTING_MIN)} och ${chanceFmt(LUCK_SETTING_MAX)}`, 'gold');
      }
      input.value = Number(value.toFixed(2));
      input.dataset.good = input.value;
      saveChance(group, value);
    };
    if (save) save.addEventListener('click', applyCustom);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyCustom();
        }
      });
    }
  });

  content.querySelector('#save-settings').addEventListener('click', async () => {
    const payload = {
      minBet: Number(content.querySelector('#set-minBet').value),
      maxBet: Number(content.querySelector('#set-maxBet').value),
      startBalance: Number(content.querySelector('#set-startBalance').value),
      dailyBonus: Number(content.querySelector('#set-dailyBonus').value),
      quizReward: Number(content.querySelector('#set-quizReward').value),
      blackjackPayout: Number(content.querySelector('#set-blackjackPayout').value),
      ...state2
    };
    try {
      await saveSettings(payload);
      sfx.correct();
      toast('Inställningar sparade', 'ok');
      renderAdmin(root);
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}


/* ------------------------------ Fotboll / live-odds ------------------------------ */

async function renderFotboll(content, root) {
  content.innerHTML = '<div class="panel" style="padding:22px"><p class="small muted">Hämtar matcher och odds …</p></div>';

  let data;
  try {
    data = await api.adminSport();
  } catch (err) {
    const offline = state.offline || err.offline;
    content.innerHTML = `<div class="panel" style="padding:22px">
      <h3 style="font-size:15px">Fotboll och live-odds</h3>
      <p class="small muted" style="margin-top:8px">${
        offline
          ? 'Fotbollsdata kräver uppkoppling. I spelhallen visas demoligan, men spel och statistik hamnar bara på den här enheten.'
          : 'Kunde inte hämta sportdata: ' + esc(err.message)
      }</p>
      <button class="btn btn--sm btn--ghost" id="sport-admin-retry" style="margin-top:12px">Försök igen</button>
    </div>`;
    const retry = content.querySelector('#sport-admin-retry');
    if (retry) retry.addEventListener('click', () => renderFotboll(content, root));
    return;
  }

  const s = data.settings || {};
  const feed = data.feed || {};
  const totals = data.totals || {};
  const open = data.open || [];
  const settled = data.settled || [];
  const SOURCE_LABELS = {
    allsportsapi: 'AllSportsAPI (live)',
    thesportsdb: 'TheSportsDB (öppen)',
    fotmob: 'FotMob (öppen)',
    espn: 'ESPN (öppen)',
    openligadb: 'OpenLigaDB (öppen)',
    nhl: 'NHL (öppen)',
    shl: 'SHL (öppen)',
    demo: 'Demoliga'
  };
  const sourceLabel =
    SOURCE_LABELS[feed.source] ||
    String(feed.source || '')
      .split('+')
      .map((key) => SOURCE_LABELS[key] || key)
      .join(' + ') ||
    'Okänd';
  const sourceCls = feed.source && feed.source !== 'demo' ? 'mint' : 'amber';
  const tried = Array.isArray(feed.tried) ? feed.tried : [];
  const hockey = data.hockeyFeed || null;
  const hockeyLabel = hockey
    ? SOURCE_LABELS[hockey.source] ||
      String(hockey.source || '')
        .split('+')
        .map((key) => SOURCE_LABELS[key] || key)
        .join(' + ')
    : 'Ingen data';

  const openRows = open.length
    ? open
        .map(
          (b) => `<tr>
            <td>${esc(b.match)} <span class="tiny muted">${b.sport === 'hockey' ? '🏒' : '⚽'}</span></td>
            <td>${esc(b.playerName || '')}</td>
            <td>${esc(b.selectionLabel)}<br /><span class="tiny muted">${kr(b.stake)} @ ${Number(b.odds).toFixed(2)}</span></td>
            <td>${kr(b.stake)}</td>
            <td>${kr(b.potential)}</td>
            <td class="tiny muted">${timeText(b.placedAt)}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="muted small" style="padding:16px">Inga öppna sportspel just nu.</td></tr>';

  const settledRows = settled.length
    ? settled
        .map(
          (b) => `<tr>
            <td>${esc(b.match)}</td>
            <td>${esc(b.playerName || '')}</td>
            <td>${esc(b.selectionLabel)}${b.result ? ` <span class="tiny muted">(${esc(b.result)})</span>` : ''}</td>
            <td>${kr(b.stake)}</td>
            <td>${b.status === 'won' ? `<span style="color:#4ade80">+${kr(b.payout)}</span>` : b.status === 'void' ? kr(b.stake) : '–'}</td>
            <td><span class="bet-badge bet-badge--${b.status}">${b.status === 'won' ? 'Vunnen' : b.status === 'lost' ? 'Förlorad' : 'Återbetald'}</span></td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="muted small" style="padding:16px">Inga avgjorda spel än.</td></tr>';

  content.innerHTML = `
    <div class="panel" style="padding:22px">
      <div class="row row--between" style="flex-wrap:wrap;gap:10px;align-items:center">
        <div>
          <h3 style="font-size:15px">Sport och live-odds</h3>
          <p class="small muted" style="margin-top:4px">Här styr du sportspelen och ser vilka matcher spelarna spelar på.</p>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <span class="chip chip--${sourceCls}">⚽ ${esc(sourceLabel)}</span>
          <span class="chip">${Number(feed.matches) || 0} matcher · ${Number(feed.live) || 0} live</span>
          <span class="chip ${hockey && hockey.source !== 'demo' ? 'chip--mint' : 'chip--amber'}">🏒 ${esc(hockeyLabel)}</span>
          <span class="chip">${hockey ? (Number(hockey.matches) || 0) + ' hockeymatcher · ' + (Number(hockey.live) || 0) + ' live' : 'Ingen hockeydata'}</span>
          <button class="btn btn--sm btn--ghost" id="sport-admin-refresh">↻ Uppdatera</button>
        </div>
      </div>

      ${feed.error ? `<p class="small" style="margin-top:10px;color:#fbbf24">⚠ ${esc(feed.error)}</p>` : ''}
      ${
        tried.length
          ? `<ul class="tiny muted" style="margin-top:8px;padding-left:18px;line-height:1.6">${tried
              .map((t) => `<li>${esc(t.source)}: ${esc(t.error)}</li>`)
              .join('')}</ul>`
          : ''
      }

      <div class="admin-stats" style="margin-top:16px">
        <div class="admin-stat"><div class="admin-stat__value">${Number(totals.openCount) || 0}</div><div class="admin-stat__label">Öppna spel</div></div>
        <div class="admin-stat"><div class="admin-stat__value">${kr(totals.openStake || 0)}</div><div class="admin-stat__label">Insats i öppna spel</div></div>
        <div class="admin-stat"><div class="admin-stat__value">${Number(totals.won) || 0} / ${Number(totals.lost) || 0}</div><div class="admin-stat__label">Vunna / förlorade</div></div>
        <div class="admin-stat"><div class="admin-stat__value">${kr(totals.payout || 0)}</div><div class="admin-stat__label">Utbetalt på sport</div></div>
      </div>

      <h3 style="font-size:14px;margin:22px 0 10px">Inställningar</h3>
      <div class="settings-grid">
        <label class="field"><span>Datakälla</span>
          <select class="select" id="sport-source">
            ${['auto', 'allsportsapi', 'fotmob', 'espn', 'thesportsdb', 'openligadb', 'demo']
              .map(
                (src) =>
                  `<option value="${src}" ${(s.source || 'auto') === src ? 'selected' : ''}>${
                    src === 'auto'
                      ? 'Automatisk (bästa tillgängliga)'
                      : src === 'allsportsapi'
                        ? 'AllSportsAPI (kräver nyckel)'
                        : src === 'fotmob'
                          ? 'FotMob (öppen, rekommenderas)'
                          : src === 'espn'
                          ? 'ESPN (öppen)'
                          : src === 'thesportsdb'
                          ? 'TheSportsDB (öppen)'
                          : src === 'openligadb'
                            ? 'OpenLigaDB (öppen)'
                            : 'Demoliga'
                  }</option>`
              )
              .join('')}
          </select></label>
        <label class="field"><span>Högsta insats sport (kr)</span>
          <input class="input" id="sport-maxStake" type="number" value="${Number(s.maxStake) || 500}" /></label>
        <label class="field"><span>Husets marginal (%)</span>
          <input class="input" id="sport-margin" type="number" min="0" max="20" step="0.5" value="${Number(s.margin) || 0}" /></label>
        <label class="field" style="grid-column:1/-1"><span>AllSportsAPI-nyckel ${s.apiKeySet ? '(nyckel finns – lämna tom för att behålla)' : '(saknas – demoligan används)'}</span>
          <input class="input" id="sport-apiKey" type="password" autocomplete="off" placeholder="Klistra in din API-nyckel från allsportsapi.com" /></label>
      </div>
      <div class="switch">
        <div><div class="switch__label">Fotbollsspel påslagna</div><div class="switch__hint">Spelarna kan lägga spel på live-odds</div></div>
        <div class="toggle ${s.enabled ? 'is-on' : ''}" id="sport-enabled"></div>
      </div>
      <div class="row" style="gap:10px;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn--primary" id="sport-save">Spara sportinställningar</button>
        <button class="btn btn--ghost" id="sport-clear-key">Ta bort API-nyckel</button>
      </div>

      <h3 style="font-size:14px;margin:26px 0 10px">Öppna spel</h3>
      <div style="overflow:auto">
        <table class="data-table">
          <thead><tr><th>Match</th><th>Spelare</th><th>Spel</th><th>Insats</th><th>Möjlig vinst</th><th>Lagt</th></tr></thead>
          <tbody>${openRows}</tbody>
        </table>
      </div>

      <h3 style="font-size:14px;margin:26px 0 10px">Avgjorda spel</h3>
      <div style="overflow:auto">
        <table class="data-table">
          <thead><tr><th>Match</th><th>Spelare</th><th>Spel</th><th>Insats</th><th>Utfall</th><th>Status</th></tr></thead>
          <tbody>${settledRows}</tbody>
        </table>
      </div>

      <p class="tiny muted" style="margin-top:18px">
        Utan API-nyckel används öppna källor i tur och ordning: TheSportsDB (global livescore) och
        OpenLigaDB (tyska ligor). Svarar ingen av dem visas demoligan. Med API-nyckel går AllSportsAPI först.
        Oddsen räknas alltid fram av huset med samma modell.
      </p>
    </div>`;

  let enabled = !!s.enabled;
  const toggle = content.querySelector('#sport-enabled');
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    toggle.classList.toggle('is-on', enabled);
    sfx.click();
  });

  content.querySelector('#sport-admin-refresh').addEventListener('click', () => renderFotboll(content, root));

  content.querySelector('#sport-save').addEventListener('click', async () => {
    const payload = {
      enabled,
      margin: Number(content.querySelector('#sport-margin').value),
      maxStake: Number(content.querySelector('#sport-maxStake').value),
      source: content.querySelector('#sport-source').value
    };
    const key = content.querySelector('#sport-apiKey').value.trim();
    if (key) payload.apiKey = key;
    try {
      await api.adminSportSettings(payload);
      sfx.correct();
      toast('Fotbollsinställningarna sparade', 'ok');
      renderFotboll(content, root);
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  content.querySelector('#sport-clear-key').addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Ta bort API-nyckeln?',
      text: 'Fotbollen går då tillbaka till demoligan.',
      confirmLabel: 'Ta bort',
      danger: true
    });
    if (!ok) return;
    try {
      await api.adminSportSettings({ apiKey: '' });
      toast('API-nyckeln är borttagen', 'ok');
      renderFotboll(content, root);
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}


function renderLogg(content, data) {
  content.innerHTML = `
    <div class="panel" style="padding:20px">
      <h3 style="font-size:15px;margin-bottom:14px">Transaktioner (senaste 120)</h3>
      <div class="log-list" style="max-height:560px">
        ${(data.transactions || []).map((t) => `
          <div class="log-row">
            <span class="log-row__time">${timeText(t.t)}</span>
            <span>${esc(t.playerName || '–')} · ${esc(t.game)} <span class="muted tiny">(${esc(t.kind)})</span></span>
            <span class="log-row__amount ${t.amount >= 0 ? 'is-plus' : 'is-minus'}">${t.amount >= 0 ? '+' : ''}${kr(t.amount)}</span>
          </div>`).join('') || '<p class="muted small">Ingen aktivitet än.</p>'}
      </div>
    </div>`;
}

function renderMeddelande(content, root, data) {
  content.innerHTML = `
    <div class="panel" style="padding:22px;max-width:620px">
      <h3 style="font-size:15px;margin-bottom:6px">Meddelande till eleverna</h3>
      <p class="small muted" style="margin-bottom:16px">Visas som en notis på studiestartsidan. Lämna tomt för att ta bort.</p>
      <label class="field"><span>Text</span>
        <input class="input" id="broadcast-input" maxlength="240" value="${esc(data.broadcast || '')}" placeholder="T.ex. Prov på fredag – träna extra på engelska!" />
      </label>
      <div class="row" style="gap:10px">
        <button class="btn btn--primary" id="broadcast-save">Skicka</button>
        <button class="btn btn--ghost" id="broadcast-clear">Rensa</button>
      </div>
    </div>`;

  const send = async (message) => {
    try {
      await sendBroadcast(message);
      state.broadcast = message;
      sfx.correct();
      toast(message ? 'Meddelandet skickat' : 'Meddelandet borttaget', 'ok');
      renderAdmin(root);
    } catch (err) {
      toast(err.message, 'bad');
    }
  };

  content.querySelector('#broadcast-save').addEventListener('click', () => {
    send(content.querySelector('#broadcast-input').value.trim());
  });
  content.querySelector('#broadcast-clear').addEventListener('click', () => send(''));
}

registerView('admin', renderAdmin);
