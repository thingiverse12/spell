#!/usr/bin/env node
'use strict';

/**
 * Kontrollerar utbetalningarna och gummibandet i alla spel:
 *  1. Slots      – varje vinst ger mer än insatsen, RTP rimligt vid alla turer.
 *  2. Videopoker – lägsta vinsten ger mer än insatsen.
 *  3. Blackjack  – vinst 2× insats, blackjack 2,5×, lika 1× (justerat för tur).
 *  4. Sport      – utbetalning = insats × odds, alltid ≥ insatsen.
 *  5. Gummiband  – lite kvar → högre tur, vunnit mycket → lägre tur, och
 *                  aldrig så låg att en vinst kan bli en förlust.
 *
 * Kör med: npm run audit
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let failures = 0;

const ok = (label, extra = '') => console.log(`  ✔ ${label}${extra ? ' – ' + extra : ''}`);
const bad = (label, extra = '') => {
  failures += 1;
  console.log(`  ✘ ${label}${extra ? ' – ' + extra : ''}`);
};

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

/* ------------------------------ gummiband ------------------------------ */

const luckSrc = read('public/js/luck.js');
const LUCK_MIN = Number(/export const LUCK_MIN = ([\d.]+)/.exec(luckSrc)?.[1]);
const LUCK_MAX = Number(/export const LUCK_MAX = ([\d.]+)/.exec(luckSrc)?.[1]);
const START_BALANCE = 2500;

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

function luckPayout(stake, mult, factor = 1) {
  const sats = Math.max(0, Number(stake) || 0);
  const m = Math.max(1, Number(mult) || 1);
  const f = Math.min(LUCK_MAX, Math.max(LUCK_MIN, Number(factor) || 1));
  const raw = sats + sats * (m - 1) * f;
  return Math.max(Math.round(raw), Math.ceil(sats) + 1);
}

console.log('\nGummiband – dynamisk tur');

if (Number.isFinite(LUCK_MIN) && Number.isFinite(LUCK_MAX) && LUCK_MIN < 1 && LUCK_MAX > 1) {
  ok('tur-faktorn kan både sänkas och höjas', `${LUCK_MIN}–${LUCK_MAX}`);
} else bad('tur-faktorns gränser är fel', `${LUCK_MIN}–${LUCK_MAX}`);

const factorAt = (balance) => luckFactor(balance);
if (factorAt(0) === LUCK_MAX) ok('tomt konto ger högsta turen', `×${factorAt(0)}`);
else bad('tomt konto ger inte högsta turen', `×${factorAt(0)}`);
if (factorAt(START_BALANCE) === 1) ok('startsaldo ger neutral tur', '×1');
else bad('startsaldo ger inte neutral tur', `×${factorAt(START_BALANCE)}`);
if (factorAt(START_BALANCE * 4) === LUCK_MIN) ok('stor vinst ger lägsta turen', `×${factorAt(START_BALANCE * 4)}`);
else bad('stor vinst ger inte lägsta turen', `×${factorAt(START_BALANCE * 4)}`);

const curve = [0, 250, 500, 1250, 2500, 3750, 5000, 10000].map((bal) => factorAt(bal));
const monotone = curve.every((f, i) => i === 0 || f <= curve[i - 1] + 1e-9);
if (monotone) ok('turen sjunker när saldot ökar', curve.join(' → '));
else bad('turen är inte monotont sjunkande', curve.join(' → '));

const apiSrc = read('lib/api.js');
if (/function luckFactor\(/.test(apiSrc) && /const LUCK_MIN = 0\.7;/.test(apiSrc) && /const LUCK_MAX = 1\.35;/.test(apiSrc)) {
  ok('servern räknar med samma gummiband (sport)');
} else bad('servern saknar gummibandet');
if (/luck: playerLuck\(player, db\.settings\)/.test(apiSrc) && /luckPayout\(bet\.stake, bet\.odds, bet\.luck\)/.test(apiSrc)) {
  ok('sportspel sparas och betalas ut med turen som låstes vid spelet');
} else bad('sportspelen använder inte turen');

const luckOff = /if \(conf\.rubberBand === false\) return 1;/.test(apiSrc);
if (luckOff && /rubberBand !== undefined/.test(apiSrc)) ok('gummibandet kan stängas av i adminpanelen');
else bad('gummibandet kan inte stängas av');

/* ------------------------------- slots ------------------------------- */

console.log('\nSlots – Star Fortune');

const slotsSrc = read('public/js/slots.js');
const paytable = literal(slotsSrc, 'const PAYTABLE = {');
const paylines = literal(slotsSrc, 'const PAYLINES = [');

const minSlotMult = Math.min(...Object.values(paytable).flatMap((entry) => Object.values(entry)));
if (minSlotMult > 1) ok('varje vinst ger mer än insatsen', `lägsta ${minSlotMult}×`);
else bad('en vinst kan ge mindre än insatsen', `lägsta ${minSlotMult}×`);

Object.entries(paytable).forEach(([symbol, entry]) => {
  const counts = Object.keys(entry).map(Number).sort((a, b) => a - b);
  counts.slice(1).forEach((count, i) => {
    const prev = entry[counts[i]];
    if (entry[count] <= prev) bad(`${symbol}: ${count} i rad betalar inte mer än ${counts[i]} i rad`);
  });
});

const SYMBOL_WEIGHT = { wild: 2, seven: 4, diamond: 5, bell: 6, bar: 6, melon: 8, plum: 9, cherry: 10 };
const weighted = Object.entries(SYMBOL_WEIGHT).flatMap(([key, weight]) => Array(weight).fill(key));
const spin = () => {
  const grid = Array.from({ length: 5 }, () =>
    Array.from({ length: 3 }, () => weighted[Math.floor(Math.random() * weighted.length)])
  );
  let total = 0;
  paylines.forEach((line) => {
    const symbols = line.map((row, reel) => grid[reel][row]);
    let base = symbols[0];
    if (base === 'wild') base = symbols.find((sym) => sym !== 'wild') || 'wild';
    let count = 0;
    for (let i = 0; i < 5; i += 1) {
      if (symbols[i] === base || symbols[i] === 'wild') count += 1;
      else break;
    }
    const mult = count >= 3 && paytable[base] ? paytable[base][count] : 0;
    if (mult) total += mult;
  });
  return total;
};

const SLOT_SPINS = 120000;
const slotSpins = [];
let multSum = 0;
for (let i = 0; i < SLOT_SPINS; i += 1) {
  const mult = spin();
  multSum += mult;
  slotSpins.push(mult);
}

const RTP_BET = 100; // rimlig insats – undviker avrundningsbrus
const rtpAt = (factor) => {
  const sum = slotSpins.reduce(
    (acc, mult) => acc + (mult > 0 ? luckPayout(RTP_BET, mult, factor) : 0),
    0
  );
  return (sum / (SLOT_SPINS * RTP_BET)) * 100;
};

const baseRtp = rtpAt(1);
if (baseRtp > 88 && baseRtp < 97) ok('RTP ligger i intervallet vid neutral tur', `${baseRtp.toFixed(1)} %`);
else bad('RTP utanför intervallet 88–97 %', `${baseRtp.toFixed(1)} %`);

const happyRtp = rtpAt(LUCK_MAX);
const sadRtp = rtpAt(LUCK_MIN);
if (happyRtp > baseRtp && sadRtp < baseRtp) {
  ok('lågt saldo ger högre RTP, högt saldo lägre', `${sadRtp.toFixed(1)} % → ${happyRtp.toFixed(1)} %`);
} else bad('gummibandet påverkar inte slots', `${sadRtp.toFixed(1)} / ${baseRtp.toFixed(1)} / ${happyRtp.toFixed(1)}`);
// Gummibandet ska ge en märkbar men inte absurd skillnad: en spelare med
// mycket kvar vinner mindre (RTP ~70 %) och en med lite kvar vinner mer (~117 %).
if (sadRtp > 60 && happyRtp < 130) {
  ok('RTP stannar inom gummibandets spann', `${sadRtp.toFixed(1)}–${happyRtp.toFixed(1)} %`);
} else bad('RTP blir orimligt vid någon tur', `${sadRtp.toFixed(1)}–${happyRtp.toFixed(1)} %`);

const lousiestSlotWin = luckPayout(100, minSlotMult, LUCK_MIN);
if (lousiestSlotWin > 100) ok('sämsta tänkbara vinstrad ger ändå plus', `100 kr → ${lousiestSlotWin} kr`);
else bad('sämsta vinstraden ger inte plus', `${lousiestSlotWin} kr`);

/* ----------------------------- videopoker ----------------------------- */

console.log('\nVideopoker – Jacks or Better');

const vpSrc = read('public/js/videopoker.js');
const pays = literal(vpSrc, 'const PAYS = [');
const minVpMult = Math.min(...pays.map((p) => p.mult));
if (minVpMult > 1) ok('lägsta vinsten ger mer än insatsen', `${minVpMult}×`);
else bad('en vinst kan ge mindre än insatsen', `lägsta ${minVpMult}×`);

const ordered = pays.every((p, i) => i === 0 || p.mult < pays[i - 1].mult);
if (ordered) ok('vinsttabellen är sorterad fallande');
else bad('vinsttabellen är inte sorterad fallande');

const lousiestVpWin = luckPayout(100, minVpMult, LUCK_MIN);
if (lousiestVpWin > 100) ok('sämsta videopokervinsten ger plus', `100 kr → ${lousiestVpWin} kr`);
else bad('sämsta videopokervinsten ger inte plus', `${lousiestVpWin} kr`);

if (/luckPayout\(bet, result\.mult \* luck\(\), game\.luckFactor\)/.test(vpSrc)) {
  ok('videopokern använder gummibandet');
} else bad('videopokern använder inte gummibandet');

/* ------------------------------ blackjack ------------------------------ */

console.log('\nBlackjack – 3:2 på blackjack');

const bjSrc = read('public/js/blackjack.js');
const checks = [
  ['vinst ger insatsen tillbaka + lika mycket till (2×)', /totalWin \+= luckPayout\(h\.bet, 2, game\.luckFactor\);/],
  ['blackjack ger 1,5× i vinst (2,5× tillbaka)', /luckPayout\(bet, 1 \+ payoutRatio\(\), game\.luckFactor\)/],
  ['lika ger insatsen tillbaka', /h\.result = 'push';\s*\n\s*totalWin \+= h\.bet;/],
  ['utbetalningen visas i klienten', /Utbetalning <strong>/],
  ['turen låses när given startar', /game\.luckFactor = currentLuck\(\);/]
];
checks.forEach(([label, re]) => (re.test(bjSrc) ? ok(label) : bad(label)));

const settle = (bet, kind, factor = 1) => {
  let payout = 0;
  if (kind === 'win') payout = luckPayout(bet, 2, factor);
  else if (kind === 'blackjack') payout = luckPayout(bet, 1 + 1.5, factor);
  else if (kind === 'push') payout = bet;
  return { payout, net: payout - bet };
};

[
  ['vinst, neutral tur', 'win', 1, 250, 500, 250],
  ['blackjack, neutral tur', 'blackjack', 1, 250, 625, 375],
  ['lika, neutral tur', 'push', 1, 250, 250, 0],
  ['förlust, neutral tur', 'lose', 1, 250, 0, -250],
  ['vinst, lågt saldo', 'win', LUCK_MAX, 250, 588, 338],
  ['vinst, högt saldo', 'win', LUCK_MIN, 250, 425, 175],
  ['blackjack, högt saldo', 'blackjack', LUCK_MIN, 250, 513, 263]
].forEach(([label, kind, factor, bet, wantPayout, wantNet]) => {
  const { payout, net } = settle(bet, kind, factor);
  if (payout === wantPayout && net === wantNet) ok(`${label}: insats ${bet} → ${payout} ut, netto ${net}`);
  else bad(`${label}: insats ${bet} → ${payout} ut (ville ${wantPayout}), netto ${net}`);
});

/* -------------------------------- sport -------------------------------- */

console.log('\nSport – spel till fasta odds');

const sports = require(path.join(root, 'lib/sports.js'));
const sample = sports.hockeyDemoFeed(Date.now(), 6).find((match) => match.markets.length);
const odds = sample.markets[0].selections[0].odds;
const stake = 100;
const luckPayout2 = (sats, mult, factor = 1) => {
  const raw = sats + sats * (Math.max(1, mult) - 1) * factor;
  return Math.max(Math.round(raw * 100) / 100, Math.round(sats * 1.01 * 100) / 100);
};
const payout = luckPayout2(stake, odds, 1);
if (odds > 1 && payout > stake) ok('vinst ger mer än insatsen', `${stake} kr @ ${odds} → ${payout} kr`);
else bad('oddsen kan ge mindre än insatsen', `${odds}`);

const worstSport = luckPayout2(stake, 1.01, LUCK_MIN);
if (worstSport > stake) ok('även sämsta oddset ger plus vid lägsta tur', `100 kr @ 1,01 → ${worstSport} kr`);
else bad('ett sportspel kan ge mindre än insatsen', `${worstSport} kr`);

// Spelbara (inte färdigspelade) matcher ska alltid ha odds på minst 1,01.
const allLow = [sports.demoFeed(Date.now(), 6), sports.hockeyDemoFeed(Date.now(), 6)]
  .flat()
  .filter((match) => match.status !== 'finished')
  .flatMap((match) => match.markets)
  .flatMap((market) => market.selections)
  .filter((sel) => !(sel.odds >= 1.01));
if (!allLow.length) ok('alla spelbara odds är minst 1,01');
else bad('odds under 1,01 hittade', String(allLow.length));

/* ----------------------------- skraplotter ----------------------------- */

console.log('\nSkraplotter – tre lika belopp');

const scratchSrc = read('public/js/scratch.js');
const tiers = literal(scratchSrc, 'const TIERS = [');
const noWinWeight = Number(/const NO_WIN_WEIGHT = (\d+);/.exec(scratchSrc)?.[1]);
const totalWeight = tiers.reduce((sum, tier) => sum + tier.weight, 0) + noWinWeight;

const minScratchMult = Math.min(...tiers.map((tier) => tier.mult));
if (minScratchMult > 1) ok('varje vinstnivå ger mer än lottpriset', `lägsta ${minScratchMult}×`);
else bad('en vinst kan ge mindre än lottpriset', `${minScratchMult}×`);

const sortedTiers = tiers.every((tier, i) => i === 0 || tier.mult > tiers[i - 1].mult);
if (sortedTiers) ok('vinsttrappan är sorterad stigande');
else bad('vinsttrappan är inte sorterad');

const scratchRtp = (factor) => {
  const price = 100;
  const sum = tiers.reduce((acc, tier) => acc + tier.weight * luckPayout(price, tier.mult, factor), 0);
  return (sum / (totalWeight * price)) * 100;
};

const neutralRtp = scratchRtp(1);
if (neutralRtp > 85 && neutralRtp < 93) ok('RTP ligger i intervallet vid neutral tur', `${neutralRtp.toFixed(1)} %`);
else bad('RTP utanför intervallet 85–93 %', `${neutralRtp.toFixed(1)} %`);

const happyScratch = scratchRtp(LUCK_MAX);
const sadScratch = scratchRtp(LUCK_MIN);
if (happyScratch > neutralRtp && sadScratch < neutralRtp) {
  ok('lågt saldo ger högre RTP, högt saldo lägre', `${sadScratch.toFixed(1)} % → ${happyScratch.toFixed(1)} %`);
} else bad('gummibandet påverkar inte skraplotterna', `${sadScratch.toFixed(1)} / ${neutralRtp.toFixed(1)} / ${happyScratch.toFixed(1)}`);
if (sadScratch > 60 && happyScratch < 130) {
  ok('RTP stannar inom gummibandets spann', `${sadScratch.toFixed(1)}–${happyScratch.toFixed(1)} %`);
} else bad('RTP blir orimligt vid någon tur', `${sadScratch.toFixed(1)}–${happyScratch.toFixed(1)} %`);

const hitRate = ((totalWeight - noWinWeight) / totalWeight) * 100;
if (hitRate > 20 && hitRate < 50) ok('lagom många lott ger vinst', `${hitRate.toFixed(1)} %`);
else bad('andelen vinstlott är orimlig', `${hitRate.toFixed(1)} %`);

const lousiestScratch = luckPayout(100, minScratchMult, LUCK_MIN);
if (lousiestScratch > 100) ok('sämsta vinstnivån ger ändå plus', `100 kr → ${lousiestScratch} kr`);
else bad('sämsta vinstnivån ger inte plus', `${lousiestScratch} kr`);

if (/scratchLuck/.test(read('lib/api.js'))) ok('skraplotternas tur kan ställas in i adminpanelen');
else bad('skraplotternas tur saknas i admin-inställningarna');

/* --------------------------- admin: spel-ekonomi --------------------------- */

console.log('\nTur-inställningarnas spann');

const luckSrc2 = read('public/js/luck.js');
const settingMin = Number(/export const LUCK_SETTING_MIN = ([\d.]+);/.exec(luckSrc2)?.[1]);
const settingMax = Number(/export const LUCK_SETTING_MAX = ([\d.]+);/.exec(luckSrc2)?.[1]);
if (settingMin > 0 && settingMax > settingMin && settingMin <= 0.25 && settingMax >= 3) {
  ok('spannet tillåter mycket låg och mycket hög tur', `${settingMin}–${settingMax}`);
} else bad('spannet för tur-inställningarna är för snävt', `${settingMin}–${settingMax}`);

const apiSrc2 = read('lib/api.js');
const serverClamps = ['slotLuck', 'videoPokerLuck', 'scratchLuck'].every((key) =>
  new RegExp(`num\\('${key}', ${settingMin}, ${settingMax}\\);`).test(apiSrc2)
);
if (serverClamps) ok('servern godtar samma spann som klienten');
else bad('servern klämmer tur-inställningarna till ett annat spann');

const levelValues = [...read('public/js/admin.js').matchAll(/\{ value: ([\d.]+), label: '([^']+)' \}/g)].map(
  (m) => Number(m[1])
);
if (levelValues.length >= 5 && levelValues[0] <= 0.25 && levelValues[levelValues.length - 1] >= 3) {
  ok('adminpanelen har nivåer från mycket låg till extrem', levelValues.join(', '));
} else bad('adminpanelen saknar nivåer i kanterna', levelValues.join(', '));

const hasCustom = /data-chance-input/.test(read('public/js/admin.js'));
if (hasCustom) ok('eget värde kan skrivas in för varje spel');
else bad('det går inte att skriva in ett eget värde');

const economyLevels = /0\.25/.test(read('public/js/economy.js')) && /3,/.test(read('public/js/economy.js'));
if (economyLevels) ok('ekonomi-panelen visar hela spannet');
else bad('ekonomi-panelen visar inte hela spannet');

console.log('\nAdminpanel – spel-ekonomi');

const economySrc = read('public/js/economy.js');
const adminSrc2 = read('public/js/admin.js');
[
  ['slots.js delar vinsttabellen med panelen', /export const SLOT_MATH = \{ SYMBOLS, PAYTABLE, PAYLINES \};/.test(slotsSrc)],
  ['scratch.js delar vinsttrappan med panelen', /export const SCRATCH_MATH = \{ TIERS, NO_WIN_WEIGHT, TOTAL_WEIGHT \};/.test(read('public/js/scratch.js'))],
  [
    'panelen räknar med spelets egen utbetalningsformel',
    /import \{[^}]*luckPayout[^}]*\} from '\.\/luck\.js';/.test(economySrc) &&
      /luckPayout\(bet, /.test(economySrc)
  ],
  ['panelen använder slotsens och skraplotternas tabeller', /SLOT_MATH/.test(economySrc) && /SCRATCH_MATH/.test(economySrc)],
  ['fliken Ekonomi finns i adminpanelen', /key: 'ekonomi'/.test(adminSrc2) && /renderEkonomi\(content, root, data\)/.test(adminSrc2)]
].forEach(([label, ok2]) => (ok2 ? ok(label) : bad(label)));

console.log('\nTur-märket i spelen');

const luckSrc3 = read('public/js/luck.js');
const coreSrc3 = read('public/js/core.js');
const machines = ['slots', 'videopoker', 'scratch'];
[
  [
    'märket visar adminens tur (inte bara gummibandet)',
    /export function machineLuckPill\(key\)/.test(luckSrc3) && /settingLuck\(key\)/.test(luckSrc3)
  ],
  [
    'nivåerna heter samma sak i panelen och spelen',
    /export const LUCK_LEVELS = \[/.test(luckSrc3) &&
      ['Mycket låg', 'Låg', 'Normal', 'Hög', 'Mycket hög', 'Extrem'].every((n) => luckSrc3.includes(n))
  ],
  [
    'slots, videopoker och skraplotter visar märket',
    machines.every((g) => /machineLuckPill\('/.test(read(`public/js/${g}.js`)))
  ],
  [
    'märket uppdateras när admin ändrar',
    machines.every((g) => /data-luck-cell=/.test(read(`public/js/${g}.js`))) &&
      /settings:updated/.test(coreSrc3) &&
      /refreshLuckPills/.test(luckSrc3)
  ],
  [
    'turen multipliceras in i slotsens utbetalning',
    /luckPayout\(bet, mult \* luck\(\), factor\)/.test(slotsSrc) &&
      /clampLuckSetting\(state\.settings\.slotLuck\)/.test(slotsSrc)
  ],
  [
    'högre tur ger mer betalt per vinst',
    luckPayout(100, 5 * 3, 1) > luckPayout(100, 5 * 1, 1) &&
      luckPayout(100, 5 * 1, 1) > luckPayout(100, 5 * 0.25, 1)
  ]
].forEach(([label, passed]) =>
  passed
    ? ok(label)
    : bad(label, 'saknas i ' + (label.includes('märket') ? 'luck.js/spelen' : 'källkoden'))
);

console.log(
  failures === 0
    ? '\nAlla kontroller gick igenom ✅\n'
    : `\n${failures} kontroll(er) misslyckades ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
