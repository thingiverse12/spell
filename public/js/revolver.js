/* =====================================================================
   Rysk roulette – en revolver med sex kammare och en enda kula.

   Spelaren lägger en insats och laddar trumman. Kulan hamnar i en
   slumpad kammare (lika sannolikt över alla sex). Sedan gäller det att
   trycka av: varje tom kammare ger en högre vinst, men kulan tar hela
   insatsen. Efter fem klick tar man vinsten automatiskt – den sjätte
   kammaren är ju alltid laddad.

   Vinsten räknas precis som i de andra spelen: insatsen plus
   (multipel − 1) × insatsen × tur, så en vinst ger alltid mer än
   insatsen tillbaka. Allt är spelmynt, ingenting händer på riktigt.
   ===================================================================== */

import {
  registerView, state, api, sfx, toast, kr, esc, sleep, navigate, openModal, updateBalanceUI, guardRound
} from './core.js';
import { currentLuck, luckPayout, luckPill } from './luck.js';
import { renderBord, stopBord } from './revolverbord.js';

/* Trumman och vinsttrappan delas med npm run audit, så oddsen kan
   kontrolleras utanför webbläsaren. PAYOUTS[n] gäller efter n + 1 klick. */
export const REVOLVER_MATH = {
  CHAMBERS: 6,
  BULLETS: 1,
  PAYOUTS: [1.15, 1.4, 1.85, 2.8, 5.6]
};

const MAX_PULLS = REVOLVER_MATH.PAYOUTS.length;
const SPIN_MS = 700;

const game = {
  phase: 'betting', // betting | armed | done
  bet: 0,
  lastBet: 100,
  bullet: 0, // kammaren kulan ligger i (0–5)
  chamber: 0, // kammaren som ligger under hanen
  pulls: 0, // antal tomma klick i den här rundan
  angle: 0, // trummans rotation i grader
  busy: false,
  shot: false, // small det i senaste klicket?
  message: '',
  netLast: 0,
  payoutLast: 0,
  luckFactor: 1
};

/* En runda som är laddad får inte tappas bort vid omladdning – insatsen
   är redan dragen och vinsten kanske inte utbetald. */
let creditPending = false;

guardRound(
  () => state.route.name === 'revolver' && (game.phase === 'armed' || game.busy || creditPending)
);

/* Jämn slump över kammarna – crypto när webbläsaren har det. */
function randomChamber() {
  const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
  if (c) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0xffffffff / REVOLVER_MATH.CHAMBERS) * REVOLVER_MATH.CHAMBERS;
    let v = 0;
    do {
      c.getRandomValues(buf);
      v = buf[0];
    } while (v >= limit);
    return v % REVOLVER_MATH.CHAMBERS;
  }
  return Math.floor(Math.random() * REVOLVER_MATH.CHAMBERS);
}

function payoutFor(pulls = game.pulls) {
  if (pulls <= 0) return 0;
  return luckPayout(game.bet, REVOLVER_MATH.PAYOUTS[Math.min(pulls, MAX_PULLS) - 1], game.luckFactor);
}

/* Risken att nästa klick smäller – en av de kammare som är kvar. */
function nextRisk() {
  const left = Math.max(1, REVOLVER_MATH.CHAMBERS - game.pulls);
  return Math.round((1 / left) * 100);
}

/* ------------------------------ Rendering ------------------------------ */

function chamberHTML(index, { reveal = false } = {}) {
  const fired = index < game.pulls || (game.shot && index === game.chamber);
  const isBullet = reveal && index === game.bullet;
  const next = game.phase === 'armed' && index === game.chamber;
  const cls = [
    'revolver__chamber',
    fired ? 'is-fired' : '',
    isBullet ? 'is-bullet' : '',
    next ? 'is-next' : ''
  ]
    .filter(Boolean)
    .join(' ');
  return `<span class="${cls}" style="transform: rotate(${index * (360 / REVOLVER_MATH.CHAMBERS)}deg) translateY(calc(-1 * var(--rev-radius, 72px)))">
    <span class="revolver__hole"></span>
  </span>`;
}

function ladderHTML() {
  return `<div class="revolver__ladder">
    ${REVOLVER_MATH.PAYOUTS.map((mult, i) => {
      const pulls = i + 1;
      const done = game.pulls >= pulls;
      const current = game.phase === 'armed' && game.pulls === i;
      return `<div class="revolver__step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}">
        <span class="revolver__step-klick">${pulls} klick</span>
        <span class="revolver__step-mult">×${String(mult).replace('.', ',')}</span>
        <span class="revolver__step-sum">${kr(payoutFor(pulls))}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function renderTable(root) {
  const table = root.querySelector('#rv-table');
  if (!table) return;
  const reveal = game.phase === 'done';
  const armed = game.phase === 'armed';

  table.innerHTML = `
    <div class="revolver ${game.shot ? 'is-shot' : ''} ${armed ? 'is-armed' : ''}">
      <div class="revolver__stage">
        <div class="revolver__flash"></div>
        <div class="revolver__gun">
          <div class="revolver__barrel"><span class="revolver__muzzle"></span></div>
          <div class="revolver__cylinder" id="rv-cylinder" style="transform: rotate(${game.angle}deg)">
            ${Array.from({ length: REVOLVER_MATH.CHAMBERS }, (_, i) => chamberHTML(i, { reveal })).join('')}
            <span class="revolver__pin"></span>
          </div>
          <div class="revolver__hammer"></div>
          <button class="revolver__trigger" id="rv-trigger" ${armed && !game.busy ? '' : 'disabled'} aria-label="Tryck av"><span>Tryck av</span></button>
          <div class="revolver__grip"></div>
        </div>
        <div class="revolver__caption">
          ${armed ? `Kammare <strong>${game.pulls + 1}</strong> av ${REVOLVER_MATH.CHAMBERS}` : ''}
          ${game.phase === 'betting' ? 'Ladda trumman när insatsen är lagd' : ''}
          ${reveal ? (game.shot ? '💥 Kulan låg i kammare ' + (game.bullet + 1) : 'Trumman gick runt – du klarade dig') : ''}
        </div>
      </div>

      ${ladderHTML()}

      ${game.message ? `<div class="result-banner">${esc(game.message)}</div>` : ''}
      ${game.phase === 'done'
        ? `<div class="bj-receipt">
            <span>Insats <strong>${kr(game.bet)}</strong></span>
            <span>Utbetalning <strong>${kr(game.payoutLast)}</strong></span>
            <span class="${game.netLast >= 0 ? 'is-plus' : 'is-minus'}">Netto <strong>${game.netLast >= 0 ? '+' : '−'}${kr(Math.abs(game.netLast))}</strong></span>
            <span class="bj-receipt__luck">Tur <strong>×${String(game.luckFactor).replace('.', ',')}</strong></span>
          </div>`
        : ''}
    </div>`;
}

function renderActions(root) {
  const actions = root.querySelector('#rv-actions');
  if (!actions) return;
  const balance = state.player?.balance ?? 0;

  if (game.phase === 'betting') {
    actions.innerHTML = `<button class="action-btn action-btn--deal" id="rv-load" ${
      game.bet <= 0 || game.busy ? 'disabled' : ''
    }>🔫 Ladda trumman (${kr(game.bet)})</button>`;
  } else if (game.phase === 'armed') {
    const cash = payoutFor();
    actions.innerHTML = `
      <button class="action-btn action-btn--stand" id="rv-cash" ${game.pulls > 0 && !game.busy ? '' : 'disabled'}>
        💰 Ta vinsten${game.pulls > 0 ? ' (' + kr(cash) + ')' : ''}
      </button>
      <button class="action-btn action-btn--hit" id="rv-pull" ${game.busy ? 'disabled' : ''}>
        🔫 Tryck av (${nextRisk()} % risk)
      </button>`;
  } else {
    actions.innerHTML = `
      <button class="action-btn action-btn--deal" id="rv-again" ${balance >= game.lastBet ? '' : 'disabled'}>
        🔫 Ny runda (${kr(game.lastBet)})
      </button>
      <button class="action-btn action-btn--split" id="rv-reset">↺ Ändra insats</button>`;
  }
}

function renderChips(root) {
  const chips = root.querySelector('#rv-chips');
  if (!chips) return;
  const balance = state.player?.balance ?? 0;
  const minBet = Number(state.settings.minBet) || 10;
  const maxBet = Number(state.settings.maxBet) || 500;
  const betting = game.phase === 'betting';
  const chipValues = [25, 50, 100, 250, 500].filter((v) => v >= Math.min(minBet, 25));

  chips.innerHTML = `
    <div class="bet-bar">
      <div class="bet-field">
        <span class="bet-field__label">Insats</span>
        <div class="bet-field__row">
          <input class="bet-field__input" id="rv-bet-input" type="number" inputmode="numeric"
                 min="${minBet}" max="${Math.max(0, Math.min(balance, maxBet))}" step="${minBet}"
                 value="${game.bet}" ${betting ? '' : 'disabled'} />
          <span class="bet-field__unit">kr</span>
          <button class="chip-mini" data-bet-mult="0.5" ${betting ? '' : 'disabled'}>½</button>
          <button class="chip-mini" data-bet-mult="2" ${betting ? '' : 'disabled'}>2×</button>
          <button class="chip-mini" data-bet-max="1" ${betting ? '' : 'disabled'}>Max</button>
        </div>
      </div>

      <div class="chip-row">
        ${chipValues
          .map(
            (v, i) => `<button class="chip-btn" data-chip="${v}" ${betting ? '' : 'disabled'}>
              <div class="poker-chip ${['', 'poker-chip--blue', 'poker-chip--green', 'poker-chip--black', 'poker-chip--gold'][i % 5]}" style="--chip-size:52px"><span>${
                v >= 1000 ? v / 1000 + 'k' : v
              }</span></div>
            </button>`
          )
          .join('')}
        <button class="btn btn--sm btn--ghost" id="rv-clear" ${betting && game.bet > 0 ? '' : 'disabled'}>Rensa</button>
      </div>

      <div class="row" style="gap:8px;flex-wrap:wrap">
        <span class="mini-pill">Min <strong>${kr(minBet)}</strong></span>
        <span class="mini-pill">Max <strong>${kr(maxBet)}</strong></span>
        <span class="mini-pill">Saldo <strong>${kr(balance)}</strong></span>
        ${luckPill(currentLuck())}
      </div>
    </div>`;

  bindChips(root);
}

function bindChips(root) {
  const betting = game.phase === 'betting';
  const clampBet = (value) => {
    const balance = state.player?.balance ?? 0;
    const maxBet = Number(state.settings.maxBet) || 500;
    return Math.max(0, Math.min(Math.round(value) || 0, balance, maxBet));
  };

  const input = root.querySelector('#rv-bet-input');
  if (input) {
    input.addEventListener('change', () => {
      if (!betting) return;
      game.bet = clampBet(Number(input.value));
      sfx.click();
      render(root);
    });
  }

  root.querySelectorAll('[data-bet-mult]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!betting) return;
      game.bet = clampBet(game.bet * (Number(btn.dataset.betMult) || 1));
      sfx.chip();
      render(root);
    });
  });

  root.querySelectorAll('[data-bet-max]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!betting) return;
      const balance = state.player?.balance ?? 0;
      const maxBet = Number(state.settings.maxBet) || 500;
      game.bet = Math.max(0, Math.min(balance, maxBet));
      sfx.chip();
      render(root);
    });
  });

  root.querySelectorAll('[data-chip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!betting) return;
      game.bet = clampBet(game.bet + Number(btn.dataset.chip));
      if (game.bet > 0) sfx.chip();
      render(root);
    });
  });

  const clear = root.querySelector('#rv-clear');
  if (clear) {
    clear.addEventListener('click', () => {
      if (!betting) return;
      game.bet = 0;
      sfx.click();
      render(root);
    });
  }
}

function render(root) {
  renderTable(root);
  renderActions(root);
  renderChips(root);
  bindActions(root);
  updateBalanceUI();
}

/* ------------------------------ Knappar ------------------------------ */

function bindActions(root) {
  const on = (id, fn) => {
    const el = root.querySelector('#' + id);
    if (el) el.addEventListener('click', fn);
  };

  on('rv-load', () => load(root));
  on('rv-trigger', () => pull(root));
  on('rv-pull', () => pull(root));
  on('rv-cash', () => cashOut(root));
  on('rv-again', () => {
    game.bet = Math.min(game.lastBet, state.player?.balance ?? 0);
    load(root);
  });
  on('rv-reset', () => {
    game.bet = 0;
    game.phase = 'betting';
    game.message = '';
    game.pulls = 0;
    game.shot = false;
    game.angle = 0;
    render(root);
  });
}

/* ------------------------------ Spelet ------------------------------ */

async function load(root) {
  if (game.busy) return;
  const bet = Math.round(game.bet);
  const balance = state.player?.balance ?? 0;
  if (bet <= 0) return toast('Lägg en insats först', 'bad');
  if (bet > balance) return toast('Du har inte tillräckligt med spelmynt', 'bad');
  if (bet < (Number(state.settings.minBet) || 10)) {
    return toast(`Minsta insats är ${kr(Number(state.settings.minBet) || 10)}`, 'bad');
  }

  game.busy = true;
  try {
    await api.bet('revolver', bet);
  } catch (err) {
    game.busy = false;
    return toast(err.message, 'bad');
  }

  game.lastBet = bet;
  game.bet = bet;
  game.luckFactor = currentLuck();
  game.bullet = randomChamber();
  game.chamber = 0;
  game.pulls = 0;
  game.angle = 0;
  game.shot = false;
  game.message = '';
  game.netLast = 0;
  game.payoutLast = 0;
  game.phase = 'armed';
  game.busy = false;
  sfx.spin();
  render(root);

  /* Trumman snurrar ett par varv innan den stannar. */
  const cylinder = root.querySelector('#rv-cylinder');
  if (cylinder) {
    cylinder.classList.add('is-spinning');
    await sleep(SPIN_MS);
    cylinder.classList.remove('is-spinning');
  }
  render(root);
}

async function pull(root) {
  if (game.busy || game.phase !== 'armed') return;
  if (game.pulls >= MAX_PULLS) return;
  game.busy = true;
  renderActions(root);

  /* Trumman går vidare ett steg (och ett extra varv för effekten). */
  const chamber = game.chamber;
  let target = -chamber * (360 / REVOLVER_MATH.CHAMBERS);
  while (target >= game.angle) target -= 360;
  game.angle = target;
  const cylinder = root.querySelector('#rv-cylinder');
  if (cylinder) cylinder.style.transform = `rotate(${game.angle}deg)`;
  const hammer = root.querySelector('.revolver__hammer');
  if (hammer) hammer.classList.add('is-cocked');
  sfx.spin();
  await sleep(SPIN_MS);

  const fires = chamber === game.bullet;
  game.shot = fires;

  if (hammer) {
    hammer.classList.remove('is-cocked');
    hammer.classList.add('is-falling');
    setTimeout(() => hammer.classList.remove('is-falling'), 260);
  }

  if (fires) {
    sfx.bang();
    game.phase = 'done';
    game.payoutLast = 0;
    game.netLast = -game.bet;
    game.message = `💥 PANG! Kulan låg i kammare ${game.bullet + 1} – insatsen är förlorad.`;
    game.busy = false;
    render(root);
    return;
  }

  sfx.klik();
  game.pulls += 1;
  game.chamber = Math.min(game.chamber + 1, REVOLVER_MATH.CHAMBERS - 1);

  if (game.pulls >= MAX_PULLS) {
    /* Fem tomma kammare – den sjätte är alltid laddad. Vinsten tas hem. */
    game.busy = false;
    render(root);
    await sleep(320);
    return settle(root, `Fem klick! Den sjätte kammaren är alltid laddad – du tar vinsten.`);
  }

  game.busy = false;
  render(root);
}

async function cashOut(root) {
  if (game.busy || game.phase !== 'armed' || game.pulls <= 0) return;
  await settle(root, `Du tog vinsten efter ${game.pulls} klick.`);
}

async function settle(root, message) {
  const win = payoutFor();
  game.phase = 'done';
  game.busy = false;
  game.payoutLast = win;
  game.netLast = win - game.bet;
  game.message = message;

  creditPending = true;
  try {
    if (win > 0) await api.credit('revolver', win);
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    creditPending = false;
  }

  if (game.netLast > 0) sfx.win();
  else sfx.klik();
  if (state.player) {
    state.player.won = (state.player.won || 0) + win;
    state.player.rounds = (state.player.rounds || 0) + 1;
  }
  render(root);
}

/* ------------------------------ Vyn ------------------------------ */

function renderView(root) {
  /* Samma adress rymmer båda lägena: #/kasino/revolver är ensamläget och
     #/kasino/revolver/bord är borden där man spelar mot varandra. */
  if ((state.route.parts || [])[2] === 'bord') {
    renderBord(root, state.route);
    return;
  }
  stopBord();

  game.bet = Math.min(game.bet || 0, state.player?.balance ?? 0);

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Rysk roulette</h1>
          <p>En kula · sex kammare · bara spelmynt – ingenting händer på riktigt</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--primary" id="rv-bord">👥 Mot varandra</button>
        <button class="btn btn--sm btn--ghost" id="rv-home">← Spelhallen</button>
      </div>

      <div class="table-shell">
        <div class="table-shell__bar">
          <h2>Rysk roulette</h2>
          <span class="mini-pill">Kammare <strong>${REVOLVER_MATH.CHAMBERS}</strong></span>
          <span class="mini-pill">Klick <strong>${game.pulls}</strong></span>
          ${game.phase === 'armed' ? `<span class="mini-pill">Vinst nu <strong>${kr(payoutFor())}</strong></span>` : ''}
          <div class="spacer"></div>
          <button class="btn btn--sm btn--ghost" id="rv-rules">Regler</button>
        </div>
        <div id="rv-table"></div>
        <div id="rv-actions" class="action-bar"></div>
        <div id="rv-chips" style="padding:14px 18px;border-top:1px solid var(--line);background:rgba(0,0,0,.2)"></div>
      </div>
    </div>`;

  root.querySelector('#rv-home').addEventListener('click', () => navigate('/kasino'));
  root.querySelector('#rv-bord').addEventListener('click', () => {
    sfx.click();
    navigate('/kasino/revolver/bord');
  });
  root.querySelector('#rv-rules').addEventListener('click', () => {
    sfx.click();
    openModal({
      title: 'Rysk roulette – regler',
      sub: 'Sex kammare, en kula och en hel del nerver.',
      body: `<ul style="padding-left:18px;line-height:1.9;font-size:14px;color:var(--text-soft)">
        <li>Lägg en insats och ladda trumman. Kulan hamnar i en slumpad kammare.</li>
        <li>Tryck av: <b>tom kammare</b> = du klarar dig och vinsten växer.</li>
        <li>Efter varje klick väljer du själv – <b>ta vinsten</b> eller <b>tryck av igen</b>.</li>
        <li>Vinsttrappan: ${REVOLVER_MATH.PAYOUTS.map((m, i) => `${i + 1} klick ×${String(m).replace('.', ',')}`).join(' · ')}.</li>
        <li>Efter <b>fem</b> klick tar du vinsten automatiskt – den sjätte kammaren är alltid laddad.</li>
        <li>Kulan tar hela insatsen för rundan.</li>
        <li>Vill du spela mot andra? Tryck <b>Mot varandra</b> – då lägger alla vid bordet samma insats i en kassa och den som står kvar tar allt.</li>
      </ul>
      <p class="tiny muted" style="margin-top:14px">Bara spelmynt och en låtsasrevolver. Ingen ammunition, inga riktiga pengar.</p>`,
      actions: [{ label: 'Uppfattat' }]
    });
  });

  document.onkeydown = (e) => {
    if (!document.body.classList.contains('theme-casino')) return;
    if (document.querySelector('.modal-backdrop')) return;
    const key = e.key.toLowerCase();
    if (game.phase === 'betting' && (key === ' ' || key === 'enter')) {
      e.preventDefault();
      load(root);
    } else if (game.phase === 'armed') {
      if (key === ' ' || key === 'enter') {
        e.preventDefault();
        pull(root);
      }
      if (key === 'c') cashOut(root);
    } else if (game.phase === 'done' && (key === ' ' || key === 'enter')) {
      e.preventDefault();
      game.bet = Math.min(game.lastBet, state.player?.balance ?? 0);
      load(root);
    }
  };

  render(root);
}

registerView('revolver', renderView);
