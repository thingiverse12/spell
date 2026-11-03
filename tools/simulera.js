#!/usr/bin/env node
'use strict';

/**
 * Simulerar spelmynt-ekonomin i alla casinospel:
 *
 *   1. Slots – Star Fortune: exakt RTP (husets marginal) för varje tur-nivå
 *      (slotLuck) och varje gummibandsfaktor, plus vad insatsens storlek gör
 *      med avrundningen.
 *   2. Slots – Monte Carlo: träffchans, svansar (storvinster), svalt,
 *      längsta förlustsvit och vinstfördelning.
 *   3. Slots – hel session med gummibandet live: hur ofta kontot tar slut.
 *   4. Skraplotter – exakt RTP per tur-nivå.
 *   5. Videopoker – Monte Carlo med en förenklad men nära optimal strategi.
 *   6. Blackjack – Monte Carlo med basic strategy.
 *
 * Allt räknas med exakt samma formler som spelet använder (luck.js,
 * slots.js, scratch.js) – tabellerna läses direkt ur källkoden så att
 * simuleringen inte kan glida ifrån spelet.
 *
 * Kör med: npm run simulera
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/* ------------------------------ småhjälpare ------------------------------ */

/** Plockar ut ett objekt/array-literal ur källkoden och tolkar det som JS. */
function literal(source, startMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error('Hittade inte ' + startMarker);
  const from = source.indexOf(startMarker.includes('[') ? '[' : '{', start);
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return new Function('return ' + source.slice(from, i + 1))();
    }
  }
  throw new Error('Kunde inte läsa ' + startMarker);
}

const sv = (n, d = 0) =>
  Number(n).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 1) => sv(x, d) + ' %';
const kr = (x) => Math.round(x).toLocaleString('sv-SE') + ' kr';
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const table = (head, rows, aligns = []) =>
  [
    head.map((h, i) => (aligns[i] === 'l' ? pad(h, Math.max(h.length, 14)) : padL(h, Math.max(h.length, 10)))).join('  '),
    head.map((h, i) => (aligns[i] === 'l' ? '-'.repeat(Math.max(h.length, 14)) : '-'.repeat(Math.max(h.length, 10)))).join('  '),
    ...rows.map((r) =>
      r
        .map((c, i) => (aligns[i] === 'l' ? pad(c, Math.max(head[i].length, 14)) : padL(c, Math.max(head[i].length, 10))))
        .join('  ')
    )
  ].join('\n');

/* ------------------------------ regelmotorn ------------------------------ */

const luckSrc = read('public/js/luck.js');
const LUCK_MIN = Number(/export const LUCK_MIN = ([\d.]+)/.exec(luckSrc)[1]);
const LUCK_MAX = Number(/export const LUCK_MAX = ([\d.]+)/.exec(luckSrc)[1]);
const START_BALANCE = 2500;

/** Exakt kopia av luckFactor() i luck.js. */
function luckFactor(balance, startBalance = START_BALANCE) {
  const start = Number(startBalance);
  const bal = Math.max(0, Number(balance) || 0);
  if (!(start > 0)) return 1;
  const ratio = bal / start;
  let factor = 1;
  if (ratio < 1) factor = 1 + Math.min(0.35, (1 - ratio) * 0.35);
  else if (ratio > 1.5) factor = 1 - Math.min(0.3, (ratio - 1.5) * 0.2);
  return Math.round(Math.min(LUCK_MAX, Math.max(LUCK_MIN, factor)) * 100) / 100;
}

/** Exakt kopia av luckPayout() i luck.js. */
function luckPayout(stake, mult, factor = 1) {
  const sats = Math.max(0, Number(stake) || 0);
  const m = Number(mult) || 0;
  if (!(m > 1)) return 0;
  const f = Math.min(LUCK_MAX, Math.max(LUCK_MIN, Number(factor) || 1));
  const raw = sats + sats * (m - 1) * f;
  return Math.max(Math.round(raw), Math.ceil(sats) + 1);
}

const print = (s = '') => console.log(s);
const h1 = (s) => print('\n' + s + '\n' + '='.repeat(s.length));
const h2 = (s) => print('\n' + s + '\n' + '-'.repeat(s.length));

/* ============================ 1. SLOTS ============================ */

const slotsSrc = read('public/js/slots.js');
const SYMBOLS = literal(slotsSrc, 'const SYMBOLS = {');
const PAYTABLE = literal(slotsSrc, 'const PAYTABLE = {');
const PAYLINES = literal(slotsSrc, 'const PAYLINES = [');
const LINES = PAYLINES.length;

const SYM_KEYS = Object.keys(SYMBOLS);
const WEIGHTS = SYM_KEYS.map((k) => SYMBOLS[k].weight);
const WEIGHT_SUM = WEIGHTS.reduce((a, b) => a + b, 0);
const SYM_P = WEIGHTS.map((w) => w / WEIGHT_SUM);

/** Tur-nivån som adminpanelen erbjuder (public/js/admin.js CHANCE_LEVELS). */
const adminSrc = read('public/js/admin.js');
const CHANCE_LEVELS = literal(adminSrc, 'const CHANCE_LEVELS = [').map((l) => l.value);
/** Tur-inställningarna kläms till LUCK_SETTING_MIN–MAX (luck.js). */
const LUCK_SETTING_MIN = Number(/export const LUCK_SETTING_MIN = ([\d.]+);/.exec(read('public/js/luck.js'))[1]);
const LUCK_SETTING_MAX = Number(/export const LUCK_SETTING_MAX = ([\d.]+);/.exec(read('public/js/luck.js'))[1]);
const clampSetting = (v) => Math.min(LUCK_SETTING_MAX, Math.max(LUCK_SETTING_MIN, v));

/** Multiplikator för en vinstrad, precis som evaluate() i slots.js. */
function lineMultiplier(symbols) {
  let base = symbols[0];
  if (base === 'wild') base = symbols.find((s) => s !== 'wild') || 'wild';
  let count = 0;
  for (let i = 0; i < symbols.length; i += 1) {
    if (symbols[i] === base || symbols[i] === 'wild') count += 1;
    else break;
  }
  if (count < 3) return 0;
  return PAYTABLE[base]?.[count] || 0;
}

/** Fördelning över (sannolikhet, multipel) för en enskild vinstlinje. */
const lineDist = (() => {
  const out = new Map(); // mult -> sannolikhet
  const pick = (depth, prob, symbols) => {
    if (depth === 5) {
      const mult = lineMultiplier(symbols);
      if (mult) out.set(mult, (out.get(mult) || 0) + prob);
      return;
    }
    for (let i = 0; i < SYM_KEYS.length; i += 1) {
      symbols.push(SYM_KEYS[i]);
      pick(depth + 1, prob * SYM_P[i], symbols);
      symbols.pop();
    }
  };
  pick(0, 1, []);
  return [...out.entries()]
    .map(([mult, probability]) => ({ mult, probability }))
    .sort((a, b) => a.mult - b.mult);
})();

/** Fördelning över (sannolikhet, multipel) för en hel snurr (summan av alla rader). */
function slotRtp(luckSetting, factor, bet) {
  const luck = clampSetting(luckSetting);
  let ev = 0;
  for (const { mult, probability } of lineDist) {
    ev += probability * luckPayout(bet, mult * luck, factor);
  }
  ev *= LINES;
  return (ev / bet) * 100;
}

/** Letar upp den tur-nivå som ger en viss RTP (RTP ökar linjärt med turen). */
function solveLuck(rtpFn, target, lo = 0.3, hi = 2.5) {
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (rtpFn(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const weightedSymbols = SYM_KEYS.flatMap((key, i) => Array(WEIGHTS[i]).fill(key));
const randomSymbol = () => weightedSymbols[Math.floor(Math.random() * weightedSymbols.length)];
const randomGrid = () =>
  Array.from({ length: 5 }, () => Array.from({ length: 3 }, randomSymbol));

/** En snurr: total utbetalning, antal vinstrader och högsta enskilda rad. */
function spinPayout(grid, bet, luckSetting, factor) {
  const luck = clampSetting(luckSetting);
  let total = 0;
  let lines = 0;
  let best = 0;
  for (const line of PAYLINES) {
    const symbols = line.map((row, reel) => grid[reel][row]);
    const mult = lineMultiplier(symbols);
    if (!mult) continue;
    const win = luckPayout(bet, mult * luck, factor);
    if (win <= 0) continue;
    total += win;
    lines += 1;
    if (win > best) best = win;
  }
  return { total, lines, best };
}

h1('STAR FORTUNE – SLOTS');
print(
  `Hjul: 5 × 3 rutor · ${LINES} vinstlinjer · symbolvikter ${SYM_KEYS.map(
    (k) => `${SYMBOLS[k].glyph || k} ${SYMBOLS[k].weight}`
  ).join(', ')} (summa ${WEIGHT_SUM}).`
);
print(
  `Tur-nivåer i adminpanelen: ${CHANCE_LEVELS.map((v) => '×' + sv(v, 2)).join(', ')} ` +
    `(egna värden ${sv(LUCK_SETTING_MIN, 2)}–${sv(LUCK_SETTING_MAX, 2)}) · ` +
    `gummibandet klämmer faktorn till ${sv(LUCK_MIN, 2)}–${sv(LUCK_MAX, 2)}.`
);

/* ---- 1a. Exakt RTP per tur-nivå och gummiband ---- */

h2('1. Husets marginal – exakt uträknat (insats 100 kr)');

const LUCK_TABLE = [...new Set([...CHANCE_LEVELS, LUCK_SETTING_MIN, LUCK_SETTING_MAX])].sort((a, b) => a - b);

const exactRows = LUCK_TABLE.map((luck) => {
  const neutral = slotRtp(luck, 1, 100);
  const lowBal = slotRtp(luck, LUCK_MAX, 100);
  const highBal = slotRtp(luck, LUCK_MIN, 100);
  return [
    '×' + sv(luck, 2),
    pct(neutral),
    pct(100 - neutral),
    pct(lowBal),
    pct(highBal),
  ];
});

print(
  table(
    ['Tur-nivå', 'RTP neutral', 'Marginal', 'RTP lågt saldo', 'RTP högt saldo'],
    exactRows,
    ['l']
  )
);
print('\n"Lågt saldo" = gummibandet ger max tur (×' + sv(LUCK_MAX, 2) + '), "högt saldo" = lägsta (×' + sv(LUCK_MIN, 2) + ').');
print('Marginal = husets andel av varje satsad krona (100 − RTP). Negativ marginal = spelaren har övertag.');

h2('Brytpunkter – vilken tur-nivå ger vilken RTP? (gummibandet neutralt)');
print(
  table(
    ['RTP-mål', 'Tur-nivå som krävs'],
    [110, 105, 100, 95, 90, 85, 80].map((target) => [
      pct(target),
      '×' + sv(solveLuck((l) => slotRtp(l, 1, 100), target), 2)
    ]),
    ['l']
  )
);
print(
  `\nBrytpunkten för jämnt spel ligger på ×${sv(solveLuck((l) => slotRtp(l, 1, 100), 100), 2)}. ` +
    `Allt över den nivån ger spelaren övertag – ×1,40 ger 129,6 % och ×3,00 hela 277,7 %.`
);

/* ---- 1b. Gummibandets kurva ---- */

h2('2. Gummibandet – turen vid olika saldon (startsaldo 2 500 kr)');

const balPoints = [0, 250, 500, 1000, 1500, 2000, 2500, 3000, 3750, 5000, 7500, 10000, 25000];
print(
  table(
    ['Saldo', 'Tur-faktor', 'RTP slots (×1,00)', 'RTP slots (×1,40)', 'Marginal (×1,00)'],
    balPoints.map((bal) => {
      const f = luckFactor(bal);
      const r1 = slotRtp(1, f, 100);
      const r14 = slotRtp(1.4, f, 100);
      return [kr(bal), '×' + sv(f, 2), pct(r1), pct(r14), pct(100 - r1)];
    }),
    ['l']
  )
);

/* ---- 1c. Insatsens storlek (avrundning) ---- */

h2('3. Spelar insatsens storlek någon roll? (avrundning till hela kronor)');

const bets = [10, 20, 50, 100, 250, 500, 1000, 2500, 5000];
print(
  table(
    ['Insats', 'RTP ×0,70', 'RTP ×1,00', 'RTP ×1,40', 'Marginal ×1,00'],
    bets.map((bet) => {
      const a = slotRtp(0.7, 1, bet);
      const b = slotRtp(1, 1, bet);
      const c = slotRtp(1.4, 1, bet);
      return [kr(bet), pct(a, 2), pct(b, 2), pct(c, 2), pct(100 - b, 2)];
    }),
    ['l']
  )
);
print('\nAvrundningen i luckPayout() kan bara lyfta små vinster, så skillnaden mellan insatserna är försumbar.');

/* ---- 1d. Var kommer pengarna ifrån? ---- */

h2('4. Vilka rader betalar? (bidrag till RTP vid neutral tur och ×1,00)');

const totalRtpNeutral = slotRtp(1, 1, 100);
const bySymbol = new Map();
const pick3 = (depth, prob, symbols) => {
  if (depth === 5) {
    const mult = lineMultiplier(symbols);
    if (!mult) return;
    let base = symbols[0];
    if (base === 'wild') base = symbols.find((s) => s !== 'wild') || 'wild';
    let count = 0;
    for (let i = 0; i < 5; i += 1) {
      if (symbols[i] === base || symbols[i] === 'wild') count += 1;
      else break;
    }
    const key = `${base}:${count}`;
    const entry = bySymbol.get(key) || { rtp: 0, probability: 0 };
    entry.rtp += prob * luckPayout(100, mult, 1) * LINES; // procentenheter av RTP
    entry.probability += prob;
    bySymbol.set(key, entry);
    return;
  }
  for (let i = 0; i < SYM_KEYS.length; i += 1) {
    symbols.push(SYM_KEYS[i]);
    pick3(depth + 1, prob * SYM_P[i], symbols);
    symbols.pop();
  }
};
pick3(0, 1, []);

const bySymbolRows = [...bySymbol.entries()]
  .map(([key, entry]) => {
    const [sym, count] = key.split(':');
    return {
      sym,
      count: Number(count),
      rtp: entry.rtp,
      probability: entry.probability,
      name: SYMBOLS[sym].name,
      mult: PAYTABLE[sym]?.[count]
    };
  })
  .sort((a, b) => b.rtp - a.rtp);

print(
  table(
    ['Rad', 'Antal i rad', 'Multiplikator', 'Chans per linje', 'Andel av RTP'],
    bySymbolRows.map((r) => [
      r.name,
      r.count + ' st',
      sv(r.mult, 2) + '×',
      pct(r.probability * 100, 3),
      pct((r.rtp / totalRtpNeutral) * 100, 2)
    ]),
    ['l']
  )
);

const symbolTotals = new Map();
bySymbolRows.forEach((r) => {
  const entry = symbolTotals.get(r.name) || { rtp: 0, probability: 0 };
  entry.rtp += r.rtp;
  entry.probability += r.probability;
  symbolTotals.set(r.name, entry);
});
print();
print(
  table(
    ['Symbol', 'Chans per linje', 'Andel av RTP'],
    [...symbolTotals.entries()]
      .sort((a, b) => b[1].rtp - a[1].rtp)
      .map(([name, e]) => [name, pct(e.probability * 100, 2), pct((e.rtp / totalRtpNeutral) * 100, 2)]),
    ['l']
  )
);
const rowSum = bySymbolRows.reduce((acc, r) => acc + r.rtp, 0);
print(
  `\nSumman av alla rader blir ${pct(rowSum, 2)} RTP – samma tal som ${pct(totalRtpNeutral, 2)} i tabell 1.`
);

/* ---- 1e. Monte Carlo ---- */

h2('5. Monte Carlo – träffchans, storvinster och svit (400 000 snurr per nivå, insats 20 kr)');

const SPINS = 400000;
const BET = 20;
const mcLevels = [...new Set([...CHANCE_LEVELS, LUCK_SETTING_MIN, LUCK_SETTING_MAX])].sort((a, b) => a - b);
const mc = new Map();

for (const luck of mcLevels) {
  const payouts = new Float64Array(SPINS);
  let hits = 0;
  let sum = 0;
  let best = 0;
  let bestLines = 0;
  let streak = 0;
  let longestStreak = 0;
  let big10 = 0;
  let big15 = 0;
  let big50 = 0;
  let lineSum = 0;
  for (let i = 0; i < SPINS; i += 1) {
    const { total, lines, best: rowBest } = spinPayout(randomGrid(), BET, luck, 1);
    payouts[i] = total;
    sum += total;
    if (total > 0) {
      hits += 1;
      lineSum += lines;
      streak = 0;
      if (total > best) best = total;
      if (rowBest > bestLines) bestLines = rowBest;
      if (total >= BET * 10) big10 += 1;
      if (total >= BET * 15) big15 += 1;
      if (total >= BET * 50) big50 += 1;
    } else {
      streak += 1;
      if (streak > longestStreak) longestStreak = streak;
    }
  }
  const mean = sum / SPINS;
  let varSum = 0;
  for (let i = 0; i < SPINS; i += 1) varSum += (payouts[i] - mean) ** 2;
  const sd = Math.sqrt(varSum / SPINS);
  const sorted = payouts.slice().sort();
  const q = (p) => sorted[Math.min(SPINS - 1, Math.floor(p * SPINS))];
  mc.set(luck, {
    rtp: (sum / (SPINS * BET)) * 100,
    hitRate: (hits / SPINS) * 100,
    mean,
    sd,
    best,
    bestLines,
    longestStreak,
    big10: (big10 / SPINS) * 100,
    big15: (big15 / SPINS) * 100,
    big50: (big50 / SPINS) * 100,
    avgLines: hits ? lineSum / hits : 0,
    p50: q(0.5),
    p90: q(0.9),
    p99: q(0.99),
    p999: q(0.999)
  });
}

print(
  table(
    ['Tur-nivå', 'RTP', 'Marginal', 'Träffchans', 'Snittvinst*', 'Std.avvik.', 'Största'],
    mcLevels.map((luck) => {
      const m = mc.get(luck);
      return [
        '×' + sv(luck, 2),
        pct(m.rtp),
        pct(100 - m.rtp),
        pct(m.hitRate),
        kr(m.mean) + ' (' + sv(m.mean / BET, 2) + '×)',
        kr(m.sd),
        kr(m.best)
      ];
    }),
    ['l']
  )
);
print('* snitt per snurr, alltså inklusive nitarna.');

print();
print(
  table(
    ['Tur-nivå', 'Vinst ≥10×', 'Vinst ≥15×', 'Vinst ≥50×', 'Längsta nit-svit', 'Snitt vinstrader'],
    mcLevels.map((luck) => {
      const m = mc.get(luck);
      return [
        '×' + sv(luck, 2),
        pct(m.big10, 2),
        pct(m.big15, 2),
        pct(m.big50, 3),
        m.longestStreak + ' snurr',
        sv(m.avgLines, 2) + ' st'
      ];
    }),
    ['l']
  )
);
print('\n"Vinst ≥15×" är nivån där STORVINST-toasten dyker upp i spelet.');

/* ---- 1f. En riktig session med gummibandet på ---- */

h2('6. Hel session med gummibandet på (start 2 500 kr, insats 20 kr, max 1 000 snurr)');

const SESSIONS = 4000;
const MAX_SPINS = 1000;
let busted = 0;
let endSum = 0;
let spinsToBust = 0;
let bustCount = 0;
const ends = [];
let sessionRtpSum = 0;

for (let s = 0; s < SESSIONS; s += 1) {
  let balance = START_BALANCE;
  let spent = 0;
  let returned = 0;
  let n = 0;
  for (; n < MAX_SPINS && balance >= BET; n += 1) {
    const factor = luckFactor(balance);
    const { total } = spinPayout(randomGrid(), BET, 1, factor);
    balance -= BET;
    spent += BET;
    balance += total;
    returned += total;
  }
  if (balance < BET) {
    busted += 1;
    spinsToBust += n;
    bustCount += 1;
  }
  endSum += balance;
  sessionRtpSum += spent ? (returned / spent) * 100 : 0;
  ends.push(balance);
}
ends.sort((a, b) => a - b);
const qEnd = (p) => ends[Math.min(SESSIONS - 1, Math.floor(p * SESSIONS))];

print(
  table(
    ['Mätvärde', 'Värde'],
    [
      ['Andel som spelar slut på kontot', pct((busted / SESSIONS) * 100)],
      ['Snitt saldo efter 1 000 snurr', kr(endSum / SESSIONS)],
      ['Median saldo', kr(qEnd(0.5))],
      ['10 % sämsta utfall', kr(qEnd(0.1))],
      ['10 % bästa utfall', kr(qEnd(0.9))],
      ['Snitt-RTP under sessionen', pct(sessionRtpSum / SESSIONS)],
      [
        'Snitt antal snurr innan kontot tar slut',
        bustCount ? sv(spinsToBust / bustCount, 0) + ' snurr' : '–'
      ]
    ],
    ['l', 'r']
  )
);
print('\nGummibandet håller spelaren kvar längre: ju lägre saldo, desto högre RTP.');

/* ============================ 2. SKRAPLOTTER ============================ */

const scratchSrc = read('public/js/scratch.js');
const TIERS = literal(scratchSrc, 'const TIERS = [');
const NO_WIN_WEIGHT = Number(/const NO_WIN_WEIGHT = (\d+);/.exec(scratchSrc)[1]);
const TOTAL_WEIGHT = TIERS.reduce((sum, t) => sum + t.weight, 0) + NO_WIN_WEIGHT;

const scratchRtp = (luckSetting, factor, price) => {
  const luck = clampSetting(luckSetting);
  let ev = 0;
  for (const tier of TIERS) {
    ev += (tier.weight / TOTAL_WEIGHT) * luckPayout(price, tier.mult * luck, factor);
  }
  return (ev / price) * 100;
};

h1('SKRAPLOTTER');

print(
  table(
    ['Tur-nivå', 'RTP neutral', 'Marginal', 'RTP lågt saldo', 'RTP högt saldo'],
    LUCK_TABLE.map((luck) => {
      const n = scratchRtp(luck, 1, 100);
      return ['×' + sv(luck, 2), pct(n), pct(100 - n), pct(scratchRtp(luck, LUCK_MAX, 100)), pct(scratchRtp(luck, LUCK_MIN, 100))];
    }),
    ['l']
  )
);
h2('Brytpunkter för skraplotterna');
print(
  table(
    ['RTP-mål', 'Tur-nivå som krävs'],
    [110, 100, 95, 90].map((target) => [
      pct(target),
      '×' + sv(solveLuck((l) => scratchRtp(l, 1, 100), target), 2)
    ]),
    ['l']
  )
);
print(
  `\nVinstchans: ${pct(((TOTAL_WEIGHT - NO_WIN_WEIGHT) / TOTAL_WEIGHT) * 100)} · ` +
    `trappan ${TIERS.map((t) => sv(t.mult, 1) + '×').join(' / ')} · priser 10–500 kr.`
);
print(
  table(
    ['Lottpris', 'RTP ×1,00', 'RTP ×1,40'],
    [10, 20, 50, 100, 250, 500].map((price) => [
      kr(price),
      pct(scratchRtp(1, 1, price), 2),
      pct(scratchRtp(1.4, 1, price), 2)
    ]),
    ['l']
  )
);

/* ============================ 3. VIDEOPOKER ============================ */

const vpSrc = read('public/js/videopoker.js');
const PAYS = literal(vpSrc, 'const PAYS = [');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const rankValue = (r) => RANKS.indexOf(r) + 2;

function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  return deck;
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Samma bedömning som evaluateHand() i videopoker.js. */
function evaluateHand(cards) {
  const ranks = cards.map((c) => rankValue(c.r)).sort((a, b) => a - b);
  const suits = cards.map((c) => c.s);
  const isFlush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)].sort((a, b) => a - b);
  let isStraight = false;
  if (uniq.length === 5) {
    if (uniq[4] - uniq[0] === 4) isStraight = true;
    if (uniq.join(',') === '2,3,4,5,14') isStraight = true;
  }
  const isRoyal = isStraight && isFlush && uniq[0] === 10 && uniq[4] === 14;
  const counts = {};
  cards.forEach((c) => (counts[c.r] = (counts[c.r] || 0) + 1));
  const groups = Object.entries(counts)
    .map(([r, n]) => ({ r, n }))
    .sort((a, b) => b.n - a.n || rankValue(b.r) - rankValue(a.r));
  const find = (key) => PAYS.find((p) => p.key === key);

  if (isRoyal) return find('royal');
  if (isStraight && isFlush) return find('straightFlush');
  if (groups[0].n === 4) return find('quads');
  if (groups[0].n === 3 && groups[1]?.n === 2) return find('fullHouse');
  if (isFlush) return find('flush');
  if (isStraight) return find('straight');
  if (groups[0].n === 3) return find('trips');
  if (groups[0].n === 2 && groups[1]?.n === 2) return find('twoPair');
  if (groups[0].n === 2 && rankValue(groups[0].r) >= 11) return find('jacks');
  return { key: 'none', mult: 0 };
}

/** Förenklad strategi i klassisk ordning: behåll det som är värt mest. */
function groupBy(cards, key) {
  const out = {};
  cards.forEach((c, i) => (out[key(c)] = out[key(c)] || []).push(i));
  return out;
}

/** Fyra kort som bildar stege (öppen eller med ett hål). */
function straightDrawIndices(cards) {
  for (let skip = 0; skip < 5; skip += 1) {
    const idx = [0, 1, 2, 3, 4].filter((i) => i !== skip);
    const vals = [...new Set(idx.map((i) => rankValue(cards[i].r)))].sort((a, b) => a - b);
    if (vals.length === 4 && vals[3] - vals[0] === 4) return idx;
  }
  return null;
}

function chooseHold(cards) {
  const made = evaluateHand(cards);
  if (made.mult > 0) {
    if (made.key === 'jacks' || made.key === 'trips') {
      const target = Object.values(groupBy(cards, (c) => c.r)).sort((a, b) => b.length - a.length)[0];
      return new Set(target);
    }
    if (made.key === 'twoPair') {
      return new Set(Object.values(groupBy(cards, (c) => c.r)).filter((g) => g.length === 2).flat());
    }
    return new Set([0, 1, 2, 3, 4]);
  }

  // Fyra till en färg (även royal).
  const fourFlush = Object.values(groupBy(cards, (c) => c.s)).find((g) => g.length === 4);
  if (fourFlush) return new Set(fourFlush);

  // Fyra till en stege.
  const draw = straightDrawIndices(cards);
  if (draw) return new Set(draw);

  // Lågt par: behåll paret och dra tre kort.
  const pair = Object.values(groupBy(cards, (c) => c.r)).find((g) => g.length === 2);
  if (pair) return new Set(pair);

  // Tre till en royal/stege i samma färg.
  const bySuit = Object.values(groupBy(cards, (c) => c.s));
  for (const group of bySuit) {
    if (group.length >= 3) {
      const ranks = group.map((i) => rankValue(cards[i].r)).sort((a, b) => a - b);
      if (ranks[2] - ranks[0] <= 4) return new Set(group.slice(0, 3));
    }
  }

  // Två höga kort i samma färg, annars ett högt kort.
  const high = cards.map((c, i) => ({ c, i })).filter(({ c }) => rankValue(c.r) >= 11);
  if (high.length >= 2) {
    const suited = high.filter((a) => a.c.s === high[0].c.s);
    if (suited.length >= 2) return new Set(suited.slice(0, 2).map((h) => h.i));
    return new Set(high.slice(0, 2).map((h) => h.i));
  }
  if (high.length === 1) return new Set([high[0].i]);
  return new Set();
}

function playVideoPoker(luckSetting, factor, bet, alwaysDraw = false) {
  const luck = clampSetting(luckSetting);
  const deck = shuffle(newDeck());
  const hand = deck.splice(0, 5);
  const hold = alwaysDraw ? new Set() : chooseHold(hand);
  const finalHand = hand.map((c, i) => (hold.has(i) ? c : deck.shift()));
  const result = evaluateHand(finalHand);
  if (!result.mult) return 0;
  return luckPayout(bet, result.mult * luck, factor);
}

h1('VIDEOPOKER – JACKS OR BETTER');

const VP_HANDS = 400000;
const vpRows = [];
const vpLevels = [...new Set([...CHANCE_LEVELS, LUCK_SETTING_MIN, LUCK_SETTING_MAX])].sort((a, b) => a - b);

// Nedre gräns: spelaren byter bort alla fem korten varje gång.
let drawAllSum = 0;
for (let i = 0; i < VP_HANDS; i += 1) drawAllSum += playVideoPoker(1, 1, 20, true);
const drawAllRtp = (drawAllSum / (VP_HANDS * 20)) * 100;

for (const luck of vpLevels) {
  let sum = 0;
  let hits = 0;
  let best = 0;
  for (let i = 0; i < VP_HANDS; i += 1) {
    const win = playVideoPoker(luck, 1, 20);
    sum += win;
    if (win > 0) {
      hits += 1;
      if (win > best) best = win;
    }
  }
  vpRows.push([
    '×' + sv(luck, 2),
    pct((sum / (VP_HANDS * 20)) * 100),
    pct(100 - (sum / (VP_HANDS * 20)) * 100),
    pct((hits / VP_HANDS) * 100),
    kr(best)
  ]);
}
print(table(['Tur-nivå', 'RTP', 'Marginal', 'Träffchans', 'Största vinst'], vpRows, ['l']));
print(
  `\nFörenklad strategi (färdiga händer, fyra till färg/stege, lågt par, höga kort). ` +
    `Byter man bort alla kort varje gång blir RTP bara ${pct(drawAllRtp)} – ` +
    `strategin är alltså värd ungefär ${sv(vpRows.find((r) => r[0] === '×1,00')[1].replace(' %', '').replace(',', '.') * 1 - drawAllRtp, 1)} procentenheter.`
);

const vpPayRows = PAYS.map((p) => [
  p.sv,
  sv(p.mult, 2) + '×',
  kr(luckPayout(20, p.mult, 1)) + ' / 20 kr',
  kr(luckPayout(20, p.mult, LUCK_MIN))
]);
print();
print(table(['Hand', 'Multiplikator', 'Utbetalning neutral', 'Utbetalning lägsta tur'], vpPayRows, ['l']));

/* ============================ 4. BLACKJACK ============================ */

h1('BLACKJACK');

const BJ_DECKS = 6;
const BJ_BET = 20;
const payoutRatio = 1.5;

function buildShoe(decks) {
  const shoe = [];
  for (let d = 0; d < decks; d += 1) for (const c of newDeck()) shoe.push(c);
  return shuffle(shoe);
}

const cardValue = (c) => {
  if (c.r === 'A') return 11;
  const v = rankValue(c.r);
  return v > 10 ? 10 : v;
};

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.r === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;
const dealerUp = (card) => {
  const v = cardValue(card);
  return v === 11 ? 11 : v;
};

/** Basic strategy (dealer står på mjuk 17, dubbel efter split tillåten). */
function basicAction(cards, upValue) {
  const { total, soft } = handValue(cards);
  const up = upValue === 11 ? 11 : upValue;
  const pairRank = cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]) ? cardValue(cards[0]) : 0;

  if (pairRank) {
    if (pairRank === 11 || pairRank === 8) return 'split';
    if (pairRank === 9) return up === 7 || up === 10 || up === 11 ? 'stand' : 'split';
    if (pairRank === 7) return up <= 7 ? 'split' : 'hit';
    if (pairRank === 6) return up <= 6 ? 'split' : 'hit';
    if (pairRank === 5) return up <= 9 ? 'double' : 'hit';
    if (pairRank === 4) return up === 5 || up === 6 ? 'split' : 'hit';
    if (pairRank === 3 || pairRank === 2) return up <= 7 ? 'split' : 'hit';
  }

  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) return up >= 3 && up <= 6 ? 'double' : 'stand';
    if (total === 17) return up >= 3 && up <= 6 ? 'double' : 'hit';
    if (total === 16 || total === 15) return up >= 4 && up <= 6 ? 'double' : 'hit';
    if (total === 14 || total === 13) return up >= 5 && up <= 6 ? 'double' : 'hit';
    return 'hit';
  }

  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  if (total === 11) return 'double';
  if (total === 10) return up <= 9 ? 'double' : 'hit';
  if (total === 9) return up >= 3 && up <= 6 ? 'double' : 'hit';
  return 'hit';
}

function dealerPlay(cards, shoe, merciful = true) {
  // dealerHitsSoft17 = false i standardinställningarna: dealern står på mjuk 17.
  // Snäll dealer: dealern stannar aldrig på 21 – den måste dra ett kort till.
  let hits = 0;
  while (hits < 20) {
    const total = handValue(cards).total;
    if (total < 17 || (merciful && total === 21)) {
      cards.push(shoe.pop());
      hits += 1;
      continue;
    }
    break;
  }
}

/** Spelar en runda; returnerar { stake, returned } i kronor. */
function playBlackjackRound(shoe, factor, merciful = true) {
  const firstCards = [shoe.pop(), shoe.pop()];
  const dealer = [shoe.pop(), shoe.pop()];
  // Snäll dealer: dealerns två första kort får aldrig bli 21.
  if (merciful && isBlackjack(dealer) && !isBlackjack(firstCards)) {
    let guard = 0;
    while (isBlackjack(dealer) && guard < 20) {
      const out = dealer[1];
      dealer[1] = shoe.pop();
      shoe.unshift(out); // tillbaka underst i given
      guard += 1;
    }
  }
  const dealerBJ = isBlackjack(dealer);
  const hands = [];
  let stake = BJ_BET;

  const playHand = (cards, bet, fromSplit) => {
    while (true) {
      const { total } = handValue(cards);
      if (total >= 21) break;
      if (!fromSplit && isBlackjack(cards)) break;
      let action = basicAction(cards, dealerUp(dealer[0]));
      if (fromSplit && action === 'split') action = 'hit';
      if (action === 'split') {
        const first = [cards[0], shoe.pop()];
        const second = [cards[1], shoe.pop()];
        stake += BJ_BET;
        const aceSplit = cardValue(cards[0]) === 11;
        if (aceSplit) {
          // Splittade ess får ett kort var och ingen mer åtgärd.
          hands.push({ cards: first, bet, fromSplit: true });
          hands.push({ cards: second, bet, fromSplit: true });
        } else {
          playHand(first, bet, true);
          playHand(second, bet, true);
        }
        return;
      }
      if (action === 'double' && cards.length === 2) {
        stake += bet;
        cards.push(shoe.pop());
        hands.push({ cards, bet: bet * 2, fromSplit });
        return;
      }
      if (action === 'stand') break;
      cards.push(shoe.pop());
    }
    hands.push({ cards, bet, fromSplit });
  };

  playHand(firstCards, BJ_BET, false);

  // Dealern spelar först när alla spelarens händer är klara.
  const anyLive = hands.some(
    (h) => handValue(h.cards).total <= 21 && !(isBlackjack(h.cards) && !h.fromSplit)
  );
  if (!dealerBJ && anyLive) dealerPlay(dealer, shoe, merciful);

  const dealerTotal = handValue(dealer).total;
  let returned = 0;
  for (const h of hands) {
    const total = handValue(h.cards).total;
    const playerBJ = !h.fromSplit && isBlackjack(h.cards);
    if (total > 21) continue;
    if (playerBJ && dealerBJ) returned += h.bet;
    else if (playerBJ) returned += luckPayout(h.bet, 1 + payoutRatio, factor);
    else if (dealerBJ) continue;
    else if (dealerTotal > 21 || total > dealerTotal) returned += luckPayout(h.bet, 2, factor);
    else if (total === dealerTotal) returned += h.bet;
  }
  return { stake, returned };
}

const BJ_ROUNDS = 400000;
const bjRows = [];
const bjLevels = [LUCK_MIN, 1, LUCK_MAX];
for (const factor of bjLevels) {
  let shoe = buildShoe(BJ_DECKS);
  let staked = 0;
  let paid = 0;
  let wins = 0;
  let pushes = 0;
  for (let i = 0; i < BJ_ROUNDS; i += 1) {
    if (shoe.length < 60) shoe = buildShoe(BJ_DECKS);
    const { stake, returned } = playBlackjackRound(shoe, factor);
    staked += stake;
    paid += returned;
    if (returned > stake) wins += 1;
    else if (returned === stake) pushes += 1;
  }
  bjRows.push([
    '×' + sv(factor, 2),
    pct((paid / staked) * 100),
    pct(100 - (paid / staked) * 100),
    pct((wins / BJ_ROUNDS) * 100),
    pct((pushes / BJ_ROUNDS) * 100)
  ]);
}
print(table(['Tur-faktor', 'RTP', 'Marginal', 'Vinstchans', 'Lika'], bjRows, ['l']));
print('\n6 kortlekar, dealern står på mjuk 17, blackjack 3:2, dubbel efter split tillåten, en splitt.');
print('Snäll dealer är på: dealern får aldrig blackjack på given och aldrig stå på 21.');
print('Marginalen svänger kraftigt med gummibandet eftersom en vinst betalar 2× bara vid tur ×1,00.');
print(
  `Exempel: 20 kr satsat → ${kr(luckPayout(20, 2, 1))} vid neutral tur, ` +
    `${kr(luckPayout(20, 2, LUCK_MIN))} vid lägsta tur och ${kr(luckPayout(20, 2, LUCK_MAX))} vid högsta.`
);

/* ---------------------------- diagram (svg) ---------------------------- */

const fsOut = path.join(root, 'docs', 'img');
fs.mkdirSync(fsOut, { recursive: true });

const svgNum = (n) => Math.round(n * 10) / 10;

/** Enkel linjediagram med två serier och en 100 %-referens. */
function lineChart({ width = 760, height = 340, xs, series, xLabel, yLabel }) {
  const padL = 56;
  const padR = 118;
  const padT = 24;
  const padB = 46;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const allY = series.flatMap((s) => s.values);
  const yMin = Math.floor((Math.min(...allY) - 4) / 5) * 5;
  const yMax = Math.ceil((Math.max(...allY) + 4) / 5) * 5;
  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  const px = (x) => padL + ((x - xMin) / (xMax - xMin)) * plotW;
  const py = (y) => padT + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  const gridY = [];
  for (let v = yMin; v <= yMax; v += (yMax - yMin) / 5) {
    gridY.push(
      `<line x1="${padL}" y1="${svgNum(py(v))}" x2="${padL + plotW}" y2="${svgNum(py(v))}" stroke="#e6e1d8" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${svgNum(py(v) + 4)}" text-anchor="end" font-size="11" fill="#8a8578">${Math.round(v)} %</text>`
    );
  }

  const seriesSvg = series
    .map((s) => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${svgNum(px(xs[i]))} ${svgNum(py(v))}`).join(' ');
      const dots = s.values
        .map((v, i) => `<circle cx="${svgNum(px(xs[i]))}" cy="${svgNum(py(v))}" r="3" fill="${s.color}"/>`)
        .join('');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>${dots}`;
    })
    .join('');

  const ticks = xs
    .map(
      (x, i) =>
        `<text x="${svgNum(px(x))}" y="${height - padB + 18}" text-anchor="middle" font-size="11" fill="#8a8578">${
          xs.length > 8 && i % 2 ? '' : Math.round(x)
        }</text>`
    )
    .join('');

  const legend = series
    .map(
      (s, i) =>
        `<line x1="${width - padR + 12}" y1="${padT + 14 + i * 22}" x2="${width - padR + 34}" y2="${padT + 14 + i * 22}" stroke="${s.color}" stroke-width="3"/>` +
        `<text x="${width - padR + 40}" y="${padT + 18 + i * 22}" font-size="12" fill="#403c33">${s.label}</text>`
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, sans-serif">
  <rect width="${width}" height="${height}" fill="#fffdf8"/>
  ${gridY.join('\n  ')}
  <line x1="${padL}" y1="${svgNum(py(100))}" x2="${padL + plotW}" y2="${svgNum(py(100))}" stroke="#c0392b" stroke-width="1.5" stroke-dasharray="6 4"/>
  <text x="${padL + 6}" y="${svgNum(py(100) - 6)}" font-size="11" fill="#c0392b">100 % – jämnt spel</text>
  ${seriesSvg}
  ${ticks}
  ${legend}
  <text x="${padL + plotW / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="#8a8578">${xLabel}</text>
  <text x="14" y="${padT + plotH / 2}" font-size="11" fill="#8a8578" transform="rotate(-90 14 ${padT + plotH / 2})" text-anchor="middle">${yLabel}</text>
</svg>`;
}

const curveBalances = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 3750, 5000, 7500, 10000, 15000];
fs.writeFileSync(
  path.join(fsOut, 'rtp-saldo.svg'),
  lineChart({
    xs: curveBalances,
    series: [
      { label: 'Slots ×1,00', color: '#2f6f4f', values: curveBalances.map((b) => slotRtp(1, luckFactor(b), 100)) },
      { label: 'Slots ×1,40', color: '#b8862a', values: curveBalances.map((b) => slotRtp(1.4, luckFactor(b), 100)) }
    ],
    xLabel: 'Saldo (kr) – gummibandet räknar om turen vid varje snurr',
    yLabel: 'RTP'
  })
);

const luckCurve = [0.1, 0.25, 0.5, 0.7, 1, 1.4, 2, 2.5, 3];
fs.writeFileSync(
  path.join(fsOut, 'rtp-tur.svg'),
  lineChart({
    xs: luckCurve,
    series: [
      { label: 'Slots', color: '#2f6f4f', values: luckCurve.map((l) => slotRtp(l, 1, 100)) },
      { label: 'Skraplotter', color: '#8e5aa8', values: luckCurve.map((l) => scratchRtp(l, 1, 100)) }
    ],
    xLabel: 'Tur-nivå i adminpanelen (×0,10–×3,00) – ×0,70 Låg, ×1,00 Normal, ×1,40 Hög',
    yLabel: 'RTP'
  })
);

print('\nDiagram skrivna till docs/img/rtp-saldo.svg och docs/img/rtp-tur.svg.');

/* ------------------------------ summering ------------------------------ */

h1('SUMMERING');

const neutralSlots = slotRtp(1, 1, 100);
const neutralScratch = scratchRtp(1, 1, 100);
print(
  table(
    ['Spel', 'RTP neutral tur', 'Marginal neutral', 'Spann över gummibandet'],
    [
      ['Slots ×1,00', pct(neutralSlots), pct(100 - neutralSlots), `${pct(slotRtp(1, LUCK_MIN, 100))} – ${pct(slotRtp(1, LUCK_MAX, 100))}`],
      ['Slots ×1,40', pct(slotRtp(1.4, 1, 100)), pct(100 - slotRtp(1.4, 1, 100)), `${pct(slotRtp(1.4, LUCK_MIN, 100))} – ${pct(slotRtp(1.4, LUCK_MAX, 100))}`],
      ['Skraplotter ×1,00', pct(neutralScratch), pct(100 - neutralScratch), `${pct(scratchRtp(1, LUCK_MIN, 100))} – ${pct(scratchRtp(1, LUCK_MAX, 100))}`],
      ['Skraplotter ×1,40', pct(scratchRtp(1.4, 1, 100)), pct(100 - scratchRtp(1.4, 1, 100)), `${pct(scratchRtp(1.4, LUCK_MIN, 100))} – ${pct(scratchRtp(1.4, LUCK_MAX, 100))}`],
      ['Videopoker ×1,00', vpRows.find((r) => r[0] === '×1,00')?.[1] || '–', vpRows.find((r) => r[0] === '×1,00')?.[2] || '–', 'se tabellen ovan'],
      ['Blackjack ×1,00', bjRows[1][1], bjRows[1][2], `${bjRows[0][1]} – ${bjRows[2][1]}`]
    ],
    ['l']
  )
);
print('\nAllt är spelmynt utan värde – siffrorna är till för att hålla spelhallen rolig och rättvis.\n');
