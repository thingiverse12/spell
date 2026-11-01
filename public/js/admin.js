/* =====================================================================
   Adminpanelen – saldon, spelare, spelinställningar och logg.
   Nås med lärarkoden.
   ===================================================================== */

import {
  registerView, state, api, sfx, toast, kr, num, esc, navigate, openModal, closeModal, confirmModal, storage
} from './core.js';

let tab = 'oversikt';

const TABS = [
  { key: 'oversikt', label: 'Översikt' },
  { key: 'spelare', label: 'Spelare' },
  { key: 'installningar', label: 'Spelinställningar' },
  { key: 'logg', label: 'Logg' },
  { key: 'meddelande', label: 'Meddelande' }
];

function timeText(t) {
  if (!t) return '–';
  const d = new Date(t);
  return d.toLocaleString('sv-SE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------ Kod-modal ------------------------------ */

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
            await api.adminLogin(code);
            close();
            sfx.win();
            toast('Välkommen, chef!', 'gold');
            navigate('/admin');
          } catch (err) {
            root.querySelector('#admin-code-err').innerHTML =
              '<p class="quiz__feedback quiz__feedback--no">Fel kod.</p>';
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
      await api.adminLogin(code);
      sfx.win();
      toast('Inloggad', 'ok');
      renderAdmin(root);
    } catch (err) {
      root.querySelector('#admin-login-err').innerHTML =
        '<p class="quiz__feedback quiz__feedback--no">Fel kod.</p>';
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
  if (!state.adminToken) {
    const saved = storage.get('ph.admin', null);
    if (saved) state.adminToken = saved;
  }
  if (!state.adminToken) return renderLogin(root);

  root.innerHTML = `<div class="wrap"><p class="muted" style="padding:60px 0">Laddar panelen …</p></div>`;

  let data;
  try {
    data = await api.adminOverview();
  } catch (err) {
    state.adminToken = null;
    storage.del('ph.admin');
    return renderLogin(root, err.status === 401 ? 'Sessionen har gått ut.' : err.message);
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
        ${settings.maintenance ? '<span class="chip" style="background:rgba(220,47,72,.18);color:#ff8a9b">🔧 Underhållsläge på</span>' : '<span class="chip chip--mint">● Online</span>'}
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
    navigate('/kasino');
  });

  const content = root.querySelector('#admin-content');
  if (tab === 'oversikt') renderOversikt(content, data);
  if (tab === 'spelare') renderSpelare(content, root, data);
  if (tab === 'installningar') renderInstallningar(content, root, data);
  if (tab === 'logg') renderLogg(content, data);
  if (tab === 'meddelande') renderMeddelande(content, root, data);
}

function renderOversikt(content, data) {
  const { players, transactions, totals } = data;
  const sorted = players.slice().sort((a, b) => b.balance - a.balance);
  const houseEdge = totals.wagered > 0 ? Math.round(((totals.wagered - totals.won) / totals.wagered) * 100) : 0;

  content.innerHTML = `
    <div class="grid grid--2">
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
}

function renderSpelare(content, root, data) {
  content.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Spelare</th><th>Saldo</th><th>Omsatt</th><th>Vunnet</th><th>Rundor</th><th>Senast</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${data.players.map((p) => `
            <tr>
              <td><div class="row" style="gap:9px"><span class="avatar">${esc((p.name || '?')[0])}</span><div><div style="font-weight:700">${esc(p.name)}</div><div class="tiny muted">#${esc(p.id)}</div></div></div></td>
              <td class="num">${kr(p.balance)}</td>
              <td class="num">${kr(p.wagered)}</td>
              <td class="num">${kr(p.won)}</td>
              <td class="num">${p.rounds}</td>
              <td class="tiny muted">${timeText(p.lastSeen)}</td>
              <td>${p.banned ? '<span class="chip" style="background:rgba(220,47,72,.18);color:#ff8a9b">Avstängd</span>' : '<span class="chip chip--mint">Aktiv</span>'}</td>
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
                await api.adminPlayer(player.id, 'setBalance', value);
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
        await api.adminPlayer(player.id, 'ban', !player.banned);
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
        await api.adminPlayer(player.id, 'reset');
        toast('Spelaren nollställd', 'ok');
        renderAdmin(root);
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  });
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
      <div class="settings-grid">
        <label class="field"><span>Slots – tur (0,5–1,5): <b id="luck-val">${s.slotLuck}</b></span>
          <input class="input" id="set-slotLuck" type="range" min="0.5" max="1.5" step="0.05" value="${s.slotLuck}" /></label>
        <label class="field"><span>Videopoker – tur: <b id="vpluck-val">${s.videoPokerLuck}</b></span>
          <input class="input" id="set-videoPokerLuck" type="range" min="0.5" max="1.5" step="0.05" value="${s.videoPokerLuck}" /></label>
      </div>

      <div class="switch">
        <div><div class="switch__label">Dealer tar kort på mjuk 17</div><div class="switch__hint">Gör blackjack lite tuffare</div></div>
        <div class="toggle ${s.dealerHitsSoft17 ? 'is-on' : ''}" data-toggle="dealerHitsSoft17"></div>
      </div>
      <div class="switch">
        <div><div class="switch__label">Dubbelt efter split</div><div class="switch__hint">Tillåt dubbel på splittade händer</div></div>
        <div class="toggle ${s.doubleAfterSplit ? 'is-on' : ''}" data-toggle="doubleAfterSplit"></div>
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
    maintenance: s.maintenance
  };

  content.querySelectorAll('[data-toggle]').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.toggle;
      state2[key] = !state2[key];
      el.classList.toggle('is-on', state2[key]);
      sfx.click();
    });
  });

  content.querySelector('#set-slotLuck').addEventListener('input', (e) => {
    content.querySelector('#luck-val').textContent = e.target.value;
  });
  content.querySelector('#set-videoPokerLuck').addEventListener('input', (e) => {
    content.querySelector('#vpluck-val').textContent = e.target.value;
  });

  content.querySelector('#save-settings').addEventListener('click', async () => {
    const payload = {
      minBet: Number(content.querySelector('#set-minBet').value),
      maxBet: Number(content.querySelector('#set-maxBet').value),
      startBalance: Number(content.querySelector('#set-startBalance').value),
      dailyBonus: Number(content.querySelector('#set-dailyBonus').value),
      quizReward: Number(content.querySelector('#set-quizReward').value),
      blackjackPayout: Number(content.querySelector('#set-blackjackPayout').value),
      slotLuck: Number(content.querySelector('#set-slotLuck').value),
      videoPokerLuck: Number(content.querySelector('#set-videoPokerLuck').value),
      ...state2
    };
    try {
      await api.adminSettings(payload);
      sfx.correct();
      toast('Inställningar sparade', 'ok');
      renderAdmin(root);
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
      await api.adminBroadcast(message);
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
