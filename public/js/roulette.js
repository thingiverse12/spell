/* =====================================================================
   Roulette – europeiskt hjul med 37 fickor (0–36).

   Spelaren lägger marker på bordet (ett nummer eller en utsida), trycker
   på SNURRA och får betalt: 45× på ett enkelnummer, hela 100× på den
   gröna nollan, 3× på dussin/kolumn och 2× på jämn/udda och låg/hög.
   Rött och svart går inte att satsa på – se REMOVED_BETS. Enkelnumren och nollan betalar alltså bättre än de matematiska
   oddsen – ju smalare satsning, desto mer att vinna. Precis som i de andra
   spelen multipliceras vinsten med turen (rouletteLuck).
   ===================================================================== */

import {
  registerView, state, api, sfx, toast, kr, num, esc, sleep, navigate, openModal, updateBalanceUI, guardRound
} from './core.js';
import {
  currentLuck, clampLuckSetting, machineLuckPill, luckLevelName, settingLuck, watchLuck
} from './luck.js';

/* Hjulets ordning, medurs från nollan. */
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20,
  14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/* Utbetalning per satsad krona, inklusive insatsen (45× = insatsen + 44×).
   Enkelnumren och den gröna nollan ligger medvetet över de matematiska
   oddsen (36×) så att den som satsar smalt tjänar mer när det slår in. */
const PAYOUTS = { straight: 45, zero: 100, dozen: 3, column: 3, even: 2 };

/* Högst fyra olika vad per snurr. Då går det inte att lägga ut markörer över
   hela bordet (eller på alla tre dussin) och vinna varje gång. */
const MAX_BETS = 4;

/* Rött och svart finns inte som vad. Med hälften på varje var man garanterad
   att få tillbaka insatsen varje snurr, och med turen på det blev det rena
   pengamaskinen. Färgerna syns fortfarande på numren, men går inte att satsa på. */
const REMOVED_BETS = new Set(['red', 'black']);

const OUTSIDE = [
  { key: 'odd', label: 'UDDA', tone: 'plain', mult: 2, hit: (n) => n !== 0 && n % 2 === 1 },
  { key: 'even', label: 'JÄMN', tone: 'plain', mult: 2, hit: (n) => n !== 0 && n % 2 === 0 },
  { key: 'low', label: '1–18', tone: 'plain', mult: 2, hit: (n) => n >= 1 && n <= 18 },
  { key: 'high', label: '19–36', tone: 'plain', mult: 2, hit: (n) => n >= 19 && n <= 36 }
];

const DOZENS = [
  { key: 'dozen1', label: '1:a DUSSIN', mult: 3, hit: (n) => n >= 1 && n <= 12 },
  { key: 'dozen2', label: '2:a DUSSIN', mult: 3, hit: (n) => n >= 13 && n <= 24 },
  { key: 'dozen3', label: '3:e DUSSIN', mult: 3, hit: (n) => n >= 25 && n <= 36 }
];

const COLUMNS = [
  { key: 'col1', label: 'KOLUMN 1', mult: 3, hit: (n) => n !== 0 && n % 3 === 1 },
  { key: 'col2', label: 'KOLUMN 2', mult: 3, hit: (n) => n !== 0 && n % 3 === 2 },
  { key: 'col3', label: 'KOLUMN 3', mult: 3, hit: (n) => n !== 0 && n % 3 === 0 }
];

/* Delas med npm run audit och testerna så oddsen kan kontrolleras utanför
   webbläsaren – även vad varje satsning faktiskt betalar. */
/**
 * Vad en snurr betalar.
 *
 * Turen och gummibandet gäller bara de smala vaden – ett enkelnummer eller
 * den gröna nollan, där man satsar på 1 av 37. Där blir vinsten insatsen
 * plus vinsten över insatsen gånger turen, så en vinst ger alltid mer än
 * insatsen.
 *
 * Utsidorna (jämn/udda, låg/hög, dussin och kolumner) betalar alltid sin
 * fasta multipel. Förut fick de turen på köpet, och med turen på ×3 gav en
 * satsning på udda 4× pengarna på 18 av 37 nummer – då var det i praktiken
 * garanterat att man gick plus, och man kunde lägga hälften på udda och
 * hälften på jämnt och ändå tjäna på varje snurr.
 */
export function spinPayout(chips, n, luck = 1, factor = 1) {
  let stake = 0;
  let raw = 0;
  let payout = 0;
  /* Under 1 betyder otur och ska inte heller äta upp insatsen. */
  const boost = Math.max(1, (Number(luck) || 1) * (Number(factor) || 1));

  chips.forEach((amount, key) => {
    const bet = Number(amount) || 0;
    if (!(bet > 0)) return;
    stake += bet;
    const mult = pays(key, n);
    if (!(mult > 0)) return;
    const win = bet * mult;
    raw += win;
    const narrow = key === 'n:0' || key.startsWith('n:');
    payout += narrow ? (win > bet ? bet + (win - bet) * boost : win) : win;
  });

  return {
    stake: Math.round(stake * 100) / 100,
    raw: Math.round(raw * 100) / 100,
    payout: Math.round(payout)
  };
}

export const ROULETTE_MATH = {
  WHEEL,
  RED,
  OUTSIDE,
  DOZENS,
  COLUMNS,
  PAYOUTS,
  MAX_BETS,
  REMOVED_BETS,
  pays,
  spinPayout
};

const STEP = 360 / WHEEL.length;
const SPIN_MS = 3200;

/* Hemlig kod för roulettens kontrollpanel. Samma siffror finns på servern,
   som avgör om en spelares nästa snurr ska tvingas till förlust. */
const CONTROL_CODE = '333333';

const game = {
  chips: new Map(), // satsnyckel → belopp
  chip: 25,
  spinning: false,
  angle: 0,
  history: [],
  last: null,
  net: 0,
  spinCount: 0
};

guardRound(() => state.route && state.route.name === 'roulette' && game.spinning);

watchLuck();

/* ------------------------------ Hjälpare ------------------------------ */

const pocketColor = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

function randomPocket() {
  // Jämn slump över alla 37 fickor – crypto när webbläsaren har det.
  const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
  if (c) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0xffffffff / 37) * 37;
    let v = 0;
    do {
      c.getRandomValues(buf);
      v = buf[0];
    } while (v >= limit);
    return v % 37;
  }
  return Math.floor(Math.random() * 37);
}

/* En ficka där ingen av spelarens marker ger något tillbaka. Har spelaren
   täckt hela bordet finns ingen sådan – då tas fickan med minst utdelning. */
function losingPocket(chips) {
  const keys = [...chips.keys()];
  const totalFor = (n) => keys.reduce((sum, key) => sum + (pays(key, n) || 0), 0);
  const safe = WHEEL.filter((n) => totalFor(n) === 0);
  if (safe.length) return safe[Math.floor(Math.random() * safe.length)];
  let best = WHEEL[0];
  let least = Infinity;
  WHEEL.forEach((n) => {
    const sum = totalFor(n);
    if (sum < least) {
      least = sum;
      best = n;
    }
  });
  return best;
}

function betTotal() {
  let sum = 0;
  game.chips.forEach((amount) => {
    sum += amount;
  });
  return Math.round(sum);
}

function limits() {
  const minBet = Math.max(1, Number(state.settings.minBet) || 10);
  const maxBet = Math.max(minBet, Number(state.settings.maxBet) || 500);
  const balance = Math.max(0, state.player ? state.player.balance : 0);
  return { minBet, maxBet: Math.min(maxBet, Math.max(minBet, balance)), balance };
}

/* Adminens turnivå för roulette – den multipliceras in i varje vinst. */
const luckMult = () => clampLuckSetting(state.settings && state.settings.rouletteLuck);

const chipValues = () => [10, 25, 50, 100, 250].filter((v) => v <= Math.max(10, limits().maxBet));

/* Vinstandel för en satsnyckel givet vinnande nummer. */
function pays(key, n) {
  // Gröna nollan är ett eget vad med egen, högre utdelning.
  if (key === 'n:0') return n === 0 ? PAYOUTS.zero : 0;
  if (key.startsWith('n:')) return Number(key.slice(2)) === n ? PAYOUTS.straight : 0;
  const found =
    OUTSIDE.find((b) => b.key === key) || DOZENS.find((b) => b.key === key) || COLUMNS.find((b) => b.key === key);
  if (!found) return 0;
  return found.hit(n) ? found.mult : 0;
}

function labelFor(key) {
  if (key.startsWith('n:')) return key.slice(2);
  const found = [...OUTSIDE, ...DOZENS, ...COLUMNS].find((b) => b.key === key);
  return found ? found.label : key;
}

/* ------------------------------ Vyer ------------------------------ */

function renderRoulette(root) {
  const { minBet, maxBet, balance } = limits();
  if (!game.chip || game.chip < minBet) game.chip = Math.max(minBet, 25);
  game.chip = Math.min(game.chip, Math.max(minBet, maxBet));

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Roulette</h1>
          <p>37 nummer · europeiskt hjul · allt spelas med spelmynt</p>
        </div>
        <div style="flex:1"></div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn--sm btn--ghost" id="ru-info">Odds &amp; regler</button>
          <button class="btn btn--sm btn--ghost" id="ru-home">← Spelhallen</button>
        </div>
      </div>

      <div class="roulette-layout">
        <div class="roulette-wheel-card">
          <div class="luck-row" id="ru-luck" data-luck-cell="rouletteLuck">${machineLuckPill('rouletteLuck')}</div>
          <div class="roulette-wheel" id="ru-wheel">
            <div class="roulette-wheel__disc" id="ru-disc"></div>
            <div class="roulette-wheel__hub" id="ru-hub"></div>
            <div class="roulette-wheel__pointer"></div>
          </div>
          <div class="roulette-result" id="ru-result">
            <span class="roulette-result__label">Senaste nummer</span>
            <span class="roulette-result__value" id="ru-result-value">–</span>
          </div>
          <div class="roulette-history" id="ru-history"></div>
        </div>

        <div class="roulette-side">
          <div class="panel" style="padding:18px">
            <div class="row row--between" style="flex-wrap:wrap;gap:10px;align-items:center">
              <h3 style="font-size:15px">Bordet</h3>
              <span class="mini-pill">Saldo <strong id="ru-balance">${kr(balance)}</strong></span>
            </div>
            <div class="roulette-table" id="ru-table"></div>
            <div class="roulette-chips" id="ru-chips"></div>

            <div class="roulette-controls">
              <label class="roulette-stake">
                <span>Insats</span>
                <input class="bet-field__input" id="ru-stake" type="number" inputmode="numeric"
                       min="${minBet}" max="${Math.max(minBet, maxBet)}" step="${Math.max(5, Math.round(minBet / 2))}"
                       value="${game.chip}" />
              </label>
              <button class="btn btn--sm btn--ghost" id="ru-undo">Ångra</button>
              <button class="btn btn--sm btn--ghost" id="ru-clear">Rensa</button>
            </div>

            <div class="roulette-total">
              <span>Insats på bordet <em class="tiny muted" id="ru-bets">${game.chips.size}/${MAX_BETS} vad</em></span>
              <strong id="ru-total">${kr(betTotal())}</strong>
            </div>

            <button class="spin-btn roulette-spin" id="ru-spin" ${betTotal() ? '' : 'disabled'}>
              <span class="spin-btn__icon">⟳</span>
              <span>SNURRA</span>
            </button>

            <div class="row row--between" style="margin-top:12px;flex-wrap:wrap;gap:8px">
              <span class="mini-pill">Min <strong>${kr(minBet)}</strong></span>
              <span class="mini-pill">Max <strong>${kr(maxBet)}</strong></span>
              <span class="mini-pill" id="ru-net">Netto <strong>${kr(game.net)}</strong></span>
            </div>
            <p class="tiny muted" style="margin-top:10px">
              Klicka på ett nummer eller en utsida för att lägga en marker. Högerklick tar bort
              markern igen. Högst <strong>${MAX_BETS} olika vad</strong> per snurr.
              <strong>Enkelnummer ger 45×</strong> och <strong>grön 0 ger 100×</strong> –
              dussin och kolumn 3×, jämn/udda och låg/hög 2×. Bara enkelnummer och nollan
              får turen; utsidorna betalar alltid sin fasta multipel.
              <strong>Rött och svart finns inte som vad</strong> – de gick att lägga hälften på
              varje och få pengarna tillbaka gratis.
            </p>
          </div>
        </div>
      </div>
    </div>`;

  root.querySelector('#ru-home').addEventListener('click', () => navigate('/kasino'));
  root.querySelector('#ru-info').addEventListener('click', showInfo);

  root.querySelector('#ru-spin').addEventListener('click', () => spin(root));
  root.querySelector('#ru-clear').addEventListener('click', () => {
    if (game.spinning) return;
    game.chips.clear();
    sfx.click();
    renderTable(root);
    updateTotals(root);
  });
  root.querySelector('#ru-undo').addEventListener('click', () => {
    if (game.spinning) return;
    const keys = [...game.chips.keys()];
    const last = keys[keys.length - 1];
    if (!last) return;
    const amount = game.chips.get(last);
    if (amount > game.chip) game.chips.set(last, amount - game.chip);
    else game.chips.delete(last);
    sfx.click();
    renderTable(root);
    updateTotals(root);
  });

  const stake = root.querySelector('#ru-stake');
  stake.addEventListener('change', () => {
    const value = Math.round(Number(stake.value) || 0);
    game.chip = Math.max(minBet, Math.min(maxBet, value || minBet));
    stake.value = game.chip;
    renderChips(root);
  });

  renderWheel(root);
  renderTable(root);
  renderChips(root);
  renderHistory(root);
  updateTotals(root);
  if (game.last) showResult(root, game.last, false);
  document.onkeydown = null;
}

function renderWheel(root) {
  const disc = root.querySelector('#ru-disc');
  if (!disc) return;
  // Ett tårtdiagram med hjulets färger och nummer runt kanten.
  const slices = WHEEL.map((n, i) => {
    const color = pocketColor(n);
    const from = i * STEP;
    const to = (i + 1) * STEP;
    return `${color === 'red' ? '#c8232f' : color === 'black' ? '#16161c' : '#0f7a4f'} ${from}deg ${to}deg`;
  });
  disc.style.background = `conic-gradient(from 0deg, ${slices.join(', ')})`;
  disc.innerHTML = WHEEL.map((n, i) => {
    const angle = (i + 0.5) * STEP;
    return `<span class="roulette-pocket-label" style="transform: rotate(${angle}deg) translateY(calc(-1 * var(--ru-radius))) rotate(${-angle}deg)">${n}</span>`;
  }).join('');
  disc.style.transform = `rotate(${game.angle}deg)`;
}

function renderTable(root) {
  const table = root.querySelector('#ru-table');
  if (!table) return;

  const cell = (key, label, cls, extra = '') => {
    const amount = game.chips.get(key) || 0;
    return `<button class="ru-cell ${cls}${amount ? ' is-bet' : ''}" data-bet="${key}" ${extra}>
      <span>${label}</span>${amount ? `<b class="ru-chip">${num(amount)}</b>` : ''}
    </button>`;
  };

  const numbers = [];
  for (let row = 0; row < 12; row += 1) {
    for (let col = 1; col <= 3; col += 1) {
      const n = row * 3 + col;
      numbers.push(cell('n:' + n, String(n), 'ru-num ru-' + pocketColor(n)));
    }
  }

  table.innerHTML = `
    <div class="ru-grid">
      <div class="ru-zero">${cell('n:0', '0<em class="ru-zero__mult">×100</em>', 'ru-num ru-green ru-zero__btn')}</div>
      <div class="ru-numbers">${numbers.join('')}</div>
      <div class="ru-columns">${COLUMNS.map((c) => cell(c.key, '2:1', 'ru-col', `aria-label="${c.label}"`)).join('')}</div>
    </div>
    <div class="ru-dozens">${DOZENS.map((d) => cell(d.key, d.label, 'ru-out')).join('')}</div>
    <div class="ru-outside">${OUTSIDE.map((o) => cell(o.key, o.label, 'ru-out ru-' + o.tone)).join('')}</div>`;

  table.querySelectorAll('[data-bet]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      placeChip(root, el.dataset.bet, 1);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      placeChip(root, el.dataset.bet, -1);
    });
  });
}

function renderChips(root) {
  const box = root.querySelector('#ru-chips');
  if (!box) return;
  const values = chipValues();
  /* Allt-markören satsar hela saldot på ett vad (upp till taket). */
  const all = limits().maxBet;
  box.innerHTML =
    values
      .map(
        (v) => `<button class="ru-chip-btn${v === game.chip ? ' is-active' : ''}" data-chip="${v}">
        <span class="poker-chip poker-chip--gold" style="--chip-size:42px"><span>${v}</span></span>
      </button>`
      )
      .join('') +
    `<button class="ru-chip-btn${all === game.chip ? ' is-active' : ''}" data-chip="${all}" title="Satsa hela saldot">
      <span class="poker-chip poker-chip--gold" style="--chip-size:42px"><span>ALLT</span></span>
    </button>`;
  box.querySelectorAll('[data-chip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      game.chip = Number(btn.dataset.chip) || game.chip;
      const stake = root.querySelector('#ru-stake');
      if (stake) stake.value = game.chip;
      sfx.click();
      renderChips(root);
    });
  });
}

function renderHistory(root) {
  const box = root.querySelector('#ru-history');
  if (!box) return;
  if (!game.history.length) {
    box.innerHTML = '<span class="tiny muted">Inga snurr än.</span>';
    return;
  }
  box.innerHTML = game.history
    .slice(0, 12)
    .map((n) => `<span class="ru-history-dot ru-${pocketColor(n)}">${n}</span>`)
    .join('');
}

function updateTotals(root) {
  const total = betTotal();
  const totalEl = root.querySelector('#ru-total');
  if (totalEl) totalEl.textContent = kr(total);
  const btn = root.querySelector('#ru-spin');
  if (btn) btn.disabled = game.spinning || total <= 0;
  /* Netto är summan av alla snurr sedan bordet öppnades – därför står antalet
     snurr bredvid, så en siffra som −1 000 inte ser ut som en enskild snurr. */
  const netEl = root.querySelector('#ru-net');
  if (netEl) {
    netEl.innerHTML =
      `Netto <strong>${kr(game.net)}</strong>` +
      (game.spinCount ? ` <em class="tiny muted">· ${game.spinCount} snurr</em>` : '');
    netEl.title = 'Summan av alla snurr sedan du öppnade bordet – inte bara den senaste.';
  }
  const balEl = root.querySelector('#ru-balance');
  if (balEl) balEl.textContent = kr(state.player ? state.player.balance : 0);
  const betsEl = root.querySelector('#ru-bets');
  if (betsEl) betsEl.textContent = `${game.chips.size}/${MAX_BETS} vad`;
}

function placeChip(root, key, dir) {
  if (game.spinning) return;
  /* Ifall ett gammalt gränssnitt ligger kvar i cachen. */
  if (REMOVED_BETS.has(key)) {
    toast('Rött och svart går inte att satsa på', 'bad', 2600);
    return;
  }
  const { minBet, maxBet, balance } = limits();
  const total = betTotal();
  const current = game.chips.get(key) || 0;

  if (dir < 0) {
    if (!current) return;
    const next = current - game.chip;
    if (next > 0) game.chips.set(key, next);
    else game.chips.delete(key);
    sfx.click();
    renderTable(root);
    updateTotals(root);
    return;
  }

  if (current === 0 && game.chips.size >= MAX_BETS) {
    toast(`Högst ${MAX_BETS} olika vad per snurr`, 'bad', 2600);
    return;
  }
  if (total + game.chip > balance) {
    toast('Inte tillräckligt med spelmynt – ta en bonus!', 'bad');
    return;
  }
  if (total + game.chip > maxBet) {
    toast(`Högsta insats är ${kr(maxBet)} per snurr`, 'bad');
    return;
  }
  if (current === 0 && game.chip < minBet) game.chip = minBet;
  game.chips.set(key, current + game.chip);
  sfx.chip();
  renderTable(root);
  updateTotals(root);
}

function showResult(root, result, animate = true) {
  const value = root.querySelector('#ru-result-value');
  if (value) {
    value.className = 'roulette-result__value ru-' + pocketColor(result.n);
    value.textContent = String(result.n);
  }
  const hub = root.querySelector('#ru-hub');
  if (hub) {
    hub.className = 'roulette-wheel__hub ru-' + pocketColor(result.n);
    hub.textContent = String(result.n);
  }
  const card = root.querySelector('#ru-result');
  if (card && animate) {
    card.classList.remove('is-win', 'is-lose');
    card.classList.add(result.win > 0 ? 'is-win' : 'is-lose');
  }
  renderHistory(root);
}

/* ------------------------------ Snurret ------------------------------ */

async function spin(root) {
  if (game.spinning) return;
  const total = betTotal();
  if (!(total > 0)) return;

  const { balance, maxBet } = limits();
  if (total > balance) {
    toast('Inte tillräckligt med spelmynt – ta en bonus!', 'bad');
    return;
  }
  if (total > maxBet) {
    toast(`Högsta insats är ${kr(maxBet)} per snurr`, 'bad');
    return;
  }

  game.spinning = true;
  updateTotals(root);

  // Insatsen dras innan hjulet snurrar.
  let rig = null;
  try {
    const bet = await api.bet('roulette', total);
    rig = bet && bet.rig;
    updateBalanceUI();
  } catch (err) {
    toast(err.message, 'bad');
    game.spinning = false;
    updateTotals(root);
    return;
  }
  updateTotals(root);

  // Kontrollpanelen kan ha tvingat fram en förlust för den här spelaren.
  const n = rig === 'lose' ? losingPocket(game.chips) : randomPocket();
  const index = WHEEL.indexOf(n);

  // Snurra till rätt ficka: fem hela varv plus fram till numret.
  const disc = root.querySelector('#ru-disc');
  if (disc) {
    const want = -(index + 0.5) * STEP;
    let target = game.angle - (game.angle % 360) + 360 * 5 + want;
    while (target <= game.angle) target += 360;
    disc.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.15,.85,.2,1)`;
    disc.style.transform = `rotate(${target}deg)`;
    game.angle = target;
  }

  sfx.click();
  await sleep(SPIN_MS + 120);

  // Räkna ut vad snurren ger med gällande tur.
  const factor = currentLuck();
  const luck = luckMult();
  const payout = spinPayout(game.chips, n, luck, factor).payout;

  game.spinCount += 1;
  game.net += payout - total;
  game.history.unshift(n);
  game.history = game.history.slice(0, 20);

  if (payout > 0) {
    try {
      await api.credit('roulette', payout);
    } catch (err) {
      toast(`Vinsten på ${kr(payout)} kunde inte sparas – försök igen`, 'bad', 6000);
      console.error('Kunde inte kreditera roulettevinsten:', err);
    }
    updateBalanceUI();
    const net = payout - total;
    const netText = (net >= 0 ? '+' : '−') + kr(Math.abs(net));
    /* Vinst på flera vad kan ändå ge minusnetto – skriv ut insatsen då, så
       siffran går att räkna hem (t.ex. 500 kr vinst på 1 000 kr insats). */
    const stakeText = net < 0 ? ` (insats ${kr(total)})` : '';
    if (payout >= total * 10) {
      sfx.bigWin();
      toast(`STORVINST! ${kr(payout)} på ${n} ${pocketColor(n) === 'red' ? 'röd' : pocketColor(n) === 'black' ? 'svart' : 'grön'}`, 'gold', 3400);
    } else {
      sfx.win();
      toast(`Vinst ${kr(payout)} på ${n} – netto ${netText}${stakeText}`, 'gold', 3000);
    }
  } else {
    sfx.lose();
    toast(`${n} ${pocketColor(n) === 'red' ? 'rött' : pocketColor(n) === 'black' ? 'svart' : 'grönt'} – ingen vinst denna gång`, 'bad', 2600);
  }

  game.last = { n, payout, stake: total, win: payout };
  game.chips.clear();
  game.spinning = false;

  renderTable(root);
  renderChips(root);
  showResult(root, game.last, true);
  updateTotals(root);
}

/* ------------------------------ Info ------------------------------ */

/* Hur mycket en satsning betalar tillbaka i snitt, i procent. */
const rtpLabel = (mult) => `${((mult / 37) * 100).toFixed(1).replace('.', ',')} %`;

function showInfo() {
  sfx.click();
  const luck = settingLuck('rouletteLuck');
  const level = luckLevelName(luck);
  openModal({
    title: 'Roulette – odds och regler',
    sub: 'Ett europeiskt hjul med 37 fickor: 0 (grön), 18 röda och 18 svarta.',
    wide: true,
    body: `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Satsning</th><th>Utbetalning</th><th>Chans</th></tr></thead>
        <tbody>
          <tr><td><strong>Grön nolla (0)</strong></td><td><strong>100× insatsen</strong></td><td>1 av 37</td></tr>
          <tr><td><strong>Ett enkelnummer</strong></td><td><strong>45× insatsen</strong></td><td>1 av 37</td></tr>
          <tr><td>Dussin (1:a, 2:a, 3:e)</td><td>3× insatsen</td><td>12 av 37</td></tr>
          <tr><td>Kolumn (2:1)</td><td>3× insatsen</td><td>12 av 37</td></tr>
          <tr><td>Jämn / udda</td><td>2× insatsen</td><td>18 av 37</td></tr>
          <tr><td>Låg (1–18) / hög (19–36)</td><td>2× insatsen</td><td>18 av 37</td></tr>
        </tbody>
      </table></div>
      <p class="small" style="margin-top:14px">
        <strong>Enkelnumren och nollan betalar mer än de matematiska oddsen</strong> – det är här man
        tjänar stort. Ett nummer ger i snitt <strong>${rtpLabel(PAYOUTS.straight)}</strong> tillbaka och
        grön nolla hela <strong>${rtpLabel(PAYOUTS.zero)}</strong>.
        Utsidorna (jämn/udda, låg/hög, dussin och kolumner) ligger kvar på
        <strong>${rtpLabel(36)}</strong>, och där vinner nollan åt huset.
      </p>
      <p class="tiny muted" style="margin-top:10px">
        Gällande tur: <strong>${'×' + Number(luck).toFixed(2).replace('.', ',')}</strong>
        ${level ? `(${level})` : '(egen nivå)'} – turen gäller bara <strong>enkelnummer och grön
        nolla</strong>, och bara vinsten som blir kvar när insatsen är återbetald. Utsidorna
        (jämn/udda, låg/hög, dussin och kolumner) betalar alltid sin fasta multipel, så en
        satsning på udda är 2× på 18 av 37 nummer – inget mer.
      </p>
      <p class="tiny muted" style="margin-top:6px">
        <strong>Netto</strong> vid bordet är summan av alla snurr sedan du öppnade det: satsar du
        100 kr och förlorar tio snurr i rad står det <strong>−1 000 kr</strong>, även om den senaste
        snurren bara kostade 100 kr. Antalet snurr står bredvid siffran, och en vinst som ändå ger
        minusnetto (flera vad i samma snurr) visar insatsen i rutan.
      </p>
      <p class="tiny muted" style="margin-top:6px">
        <strong>Rött och svart går inte att satsa på</strong> – med hälften på varje fick man
        tillbaka insatsen varje snurr. Satsar man på alla tre dussin (eller alla tre kolumner) får
        man bara tillbaka det man lagt – ingen tur på det, och nollan tar allt.
        Allt spelas med spelmynt, aldrig riktiga pengar.
      </p>`,
    actions: [{ label: 'Stäng' }]
  });
}

/* ------------------------------ Kontrollrummet ------------------------------ */

/* Skrivs koden 333333 på roulettesidan öppnas panelen. Ingen knapp, ingen
   ledtråd i gränssnittet – bara den som kan koden hittar hit. */
let controlTerm = '';
let controlMode = 'lose';
let codeBuffer = '';

function watchControlCode() {
  window.addEventListener('keydown', (e) => {
    if (!state.route || state.route.name !== 'roulette') {
      codeBuffer = '';
      return;
    }
    // Bara en spelare med eget konto (eller en inloggad admin) kommer åt panelen.
    if (!(state.player && state.player.hasPin) && !state.adminToken) {
      codeBuffer = '';
      return;
    }
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      codeBuffer = '';
      return;
    }
    if (!/^[0-9]$/.test(e.key || '')) {
      codeBuffer = '';
      return;
    }
    codeBuffer = (codeBuffer + e.key).slice(-CONTROL_CODE.length);
    if (codeBuffer === CONTROL_CODE) {
      codeBuffer = '';
      openControl();
    }
  });
}

function timeAgo(ts) {
  if (!ts) return 'aldrig inne';
  const minutes = Math.round(Math.max(0, Date.now() - ts) / 60000);
  if (minutes < 1) return 'nyss';
  if (minutes < 60) return minutes + ' min sedan';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + ' tim sedan';
  return Math.round(hours / 24) + ' dygn sedan';
}

function controlRows(players) {
  const term = controlTerm.trim().toLowerCase();
  const list = players.filter((p) => !term || String(p.name).toLowerCase().includes(term));
  if (!list.length) {
    return players.length
      ? '<p class="small muted">Ingen spelare matchar.</p>'
      : '<p class="small muted">Ingen är online i roulette just nu. Öppna spelet på en enhet så dyker spelaren upp här inom några sekunder.</p>';
  }
  return list
    .map((p) => {
      const forever = p.rig === 'loseAlways';
      return `
      <div class="ru-ctl__row${p.rig ? ' is-rigged' : ''}${p.online ? '' : ' is-offline'}">
        <div class="ru-ctl__who">
          <strong>${esc(p.name)}${p.online ? '' : ' <span class="tiny muted">· offline</span>'}</strong>
          <span class="tiny muted">${kr(p.balance)} · ${num(p.rounds)} snurr · ${p.online ? 'online nu' : timeAgo(p.lastSeen)}${p.isGuest ? ' · gäst' : ''}</span>
        </div>
        ${p.rig ? `<span class="chip ru-ctl__flag">${forever ? 'Förlorar tills du släpper' : 'Förlorar nästa snurr'}</span>` : ''}
        <button class="btn ${p.rig ? 'btn--ghost' : 'btn--danger'} btn--sm" data-act="${p.rig ? 'off' : controlMode}" data-id="${esc(p.id)}">
          ${p.rig ? 'Släpp igenom' : 'Låt förlora'}
        </button>
      </div>`;
    })
    .join('');
}

async function refreshControl(backdrop) {
  const box = backdrop.querySelector('.ru-ctl');
  if (!box) return;
  let data;
  try {
    data = await api.rouletteControl(null, CONTROL_CODE);
  } catch (err) {
    box.innerHTML = `<p class="small" style="color:var(--bad)">${esc(
      err.message || 'Kunde inte hämta spelarna'
    )} – panelen behöver servern.</p>`;
    return;
  }
  const players = data.players || [];
  const rigged = players.filter((p) => p.rig).length;
  const online = players.filter((p) => p.online).length;
  const log = (data.log || []).slice(0, 3);
  box.innerHTML = `
    <div class="ru-ctl__head">
      <input class="input" id="ru-ctl-search" type="search" placeholder="Sök spelare…" value="${esc(controlTerm)}">
      <span class="chip">${online + ' online'}</span>
      <span class="chip">${rigged ? rigged + ' förlorar' : 'Ingen tvingas förlora'}</span>
    </div>
    <div class="ru-ctl__modes">
      <button class="chip${controlMode === 'lose' ? ' is-on' : ''}" data-mode="lose">Nästa snurr</button>
      <button class="chip${controlMode === 'loseAlways' ? ' is-on' : ''}" data-mode="loseAlways">Tills jag släpper</button>
    </div>
    <p class="tiny muted">Bara spelare som varit inne de senaste ${num(
      data.onlineMinutes || 2
    )} minuterna syns här – alltså de som sitter vid rouletten nu. Markera läget och tryck på spelaren.
      En tvingad förlust släpps av sig själv efter ${num(data.ttlMinutes || 15)} min om spelaren inte snurrar.</p>
    <div class="ru-ctl__list">${controlRows(players)}</div>
    ${
      log.length
        ? `<p class="tiny muted" style="margin-top:10px">Senast: ${log
            .map((l) => esc(l.playerName) + ' (' + timeAgo(l.at) + ')')
            .join(' · ')}</p>`
        : ''
    }`;

  const list = box.querySelector('.ru-ctl__list');
  const search = box.querySelector('#ru-ctl-search');
  const draw = () => {
    list.innerHTML = controlRows(players);
  };
  search.addEventListener('input', () => {
    controlTerm = search.value;
    draw();
  });
  box.querySelectorAll('.ru-ctl__modes .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      controlMode = chip.dataset.mode === 'loseAlways' ? 'loseAlways' : 'lose';
      box.querySelectorAll('.ru-ctl__modes .chip').forEach((c) => c.classList.toggle('is-on', c.dataset.mode === controlMode));
      draw();
    });
  });
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    try {
      await api.rouletteControl({ playerId: btn.dataset.id, action: btn.dataset.act }, CONTROL_CODE);
      sfx.click();
      await refreshControl(backdrop);
    } catch (err) {
      toast(err.message || 'Kunde inte ändra spelaren', 'bad');
      await refreshControl(backdrop);
    }
  });
}

function openControl() {
  sfx.click();
  const backdrop = openModal({
    title: 'Roulettens kontrollrum',
    sub: 'Bara den här maskinen. Välj en spelare och tryck – deras nästa snurr blir en förlust.',
    wide: true,
    body: '<div class="ru-ctl"><p class="small muted">Hämtar spelare…</p></div>',
    actions: [{ label: 'Stäng', onClick: (close) => close() }]
  });
  refreshControl(backdrop);
}

watchControlCode();

registerView('roulette', (root) => {
  if (!game.chip) game.chip = Math.max(1, Number(state.settings.minBet) || 10);
  renderRoulette(root);
});
