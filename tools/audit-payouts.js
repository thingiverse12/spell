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

/* Exakt uträkning i stället för simulering: alla 8^5 = 32 768 symbolrader
   räknas upp en gång med sina sannolikheter, så RTP-siffran aldrig brusar. */
const SYMBOL_WEIGHT = Object.fromEntries(
  Object.entries(literal(slotsSrc, 'const SYMBOLS = {')).map(([key, sym]) => [key, sym.weight])
);
const SYM_KEYS = Object.keys(SYMBOL_WEIGHT);
const WEIGHT_SUM = SYM_KEYS.reduce((sum, key) => sum + SYMBOL_WEIGHT[key], 0);
const SYM_P = SYM_KEYS.map((key) => SYMBOL_WEIGHT[key] / WEIGHT_SUM);

const lineDist = (() => {
  const out = [];
  const symbols = [];
  const walk = (depth, prob) => {
    if (depth === 5) {
      let base = symbols[0];
      if (base === 'wild') base = symbols.find((sym) => sym !== 'wild') || 'wild';
      let count = 0;
      for (let i = 0; i < 5; i += 1) {
        if (symbols[i] === base || symbols[i] === 'wild') count += 1;
        else break;
      }
      const mult = count >= 4 && paytable[base] ? paytable[base][count] : 0;
      if (mult) out.push({ mult, prob });
      return;
    }
    for (let i = 0; i < SYM_KEYS.length; i += 1) {
      symbols.push(SYM_KEYS[i]);
      walk(depth + 1, prob * SYM_P[i]);
      symbols.pop();
    }
  };
  walk(0, 1);
  return out;
})();

const hitChance = lineDist.reduce((sum, line) => sum + line.prob, 0);

const RTP_BET = 100; // rimlig insats – undviker avrundningsbrus
const rtpAt = (factor) => {
  const perLine = lineDist.reduce(
    (sum, line) => sum + line.prob * luckPayout(RTP_BET, line.mult, factor),
    0
  );
  return ((perLine * paylines.length) / RTP_BET) * 100;
};

if (hitChance * paylines.length * 100 > 1) {
  ok('vinstchansen är rimlig för en snurr', `${(hitChance * paylines.length * 100).toFixed(1)} %`);
} else bad('vinstchansen är för låg', `${(hitChance * paylines.length * 100).toFixed(1)} %`);

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

/* Bara raka rader räknas – ingen zickzack mellan hjulen. */
const straightLines = paylines.length > 0 && paylines.every((line) => line.every((row) => row === line[0]));
if (straightLines) ok('bara raka rader ger vinst', `${paylines.length} raka rader`);
else bad('vinstlinjerna går inte rakt över hjulen', `${paylines.length} linjer`);

/* Minst fyra lika i rad krävs. */
const minCount = Number(/const MIN_COUNT = (\d+);/.exec(slotsSrc)?.[1] || 0);
const fourRule = /if \(count < MIN_COUNT\) return;/.test(slotsSrc);
if (minCount >= 4 && fourRule) ok('minst fyra lika i rad krävs', `${minCount} i rad`);
else bad('vinst kan ges för färre än fyra i rad', `MIN_COUNT ${minCount}`);

/* Vinsttabellen ska inte betala för tre i rad längre. */
const hasThree = Object.values(paytable).some((entry) => entry[3] !== undefined);
if (!hasThree) ok('tre i rad ger ingen vinst längre');
else bad('tre i rad betalar fortfarande');

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

/* --------------------------- snäll dealer (blackjack) --------------------------- */

console.log('\nSnäll dealer – dealern får aldrig 21 direkt');

const apiSrcBj = read('lib/api.js');
const coreSrcBj = read('public/js/core.js');
const adminSrcBj = read('public/js/admin.js');
const readmeBj = read('README.md');
const simSrcBj = read('tools/simulera.js');

[
  ['regeln läser inställningen (på som standard)', /function mercifulDealer\(\) \{\s*\n\s*return !\(state\.settings && state\.settings\.mercifulDealer === false\);/.test(bjSrc)],
  [
    'dealen byter ut dealerns 21 på given',
    /function softenDealerOpening\(\)/.test(bjSrc) &&
      /if \(!isBlackjack\(game\.dealer\)\) return false;/.test(bjSrc) &&
      /game\.dealer\[1\] = \{ \.\.\.draw\(\), anim: true \};/.test(bjSrc) &&
      /game\.shoe\.unshift\(out\)/.test(bjSrc) &&
      /if \(softenDealerOpening\(\)\)/.test(bjSrc)
  ],
  [
    'dealern får aldrig stå på 21',
    /const greedy = kind && total === 21;/.test(bjSrc) && /if \(!mustHit && !greedy\) break;/.test(bjSrc)
  ],
  ['spelet berättar när dealern sprack på 21', /dealern drog 21 och sprack/.test(bjSrc)],
  ['reglerna syns i spelarens regelruta', /Snäll dealer/.test(bjSrc) && /aldrig stå på 21/.test(bjSrc)],
  ['inställningen finns i serverns standardvärden', /mercifulDealer: true/.test(apiSrcBj)],
  ['inställningen finns i klientens standardvärden', /mercifulDealer: true/.test(coreSrcBj)],
  ['admin kan spara inställningen', /incoming\.mercifulDealer !== undefined/.test(apiSrcBj)],
  [
    'adminpanelen har reglaget',
    /data-toggle="mercifulDealer"/.test(adminSrcBj) && /mercifulDealer: s\.mercifulDealer !== false/.test(adminSrcBj)
  ],
  ['selftestet kollar reglaget', /snäll dealer är på som standard/.test(apiSrcBj)],
  ['README beskriver regeln', /Snäll dealer/.test(readmeBj) && /Ingen blackjack på given/.test(readmeBj) && /stannar aldrig på 21/.test(readmeBj)],
  [
    'simuleringen räknar med samma regel',
    /function dealerPlay\(cards, shoe, merciful = true\)/.test(simSrcBj) &&
      /merciful && total === 21/.test(simSrcBj) &&
      /if \(merciful && isBlackjack\(dealer\) && !isBlackjack\(firstCards\)\)/.test(simSrcBj)
  ]
].forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'snäll dealer')));

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
  ['slots.js delar vinsttabellen med panelen', /export const SLOT_MATH = \{ SYMBOLS, PAYTABLE, PAYLINES(, MIN_COUNT)? \};/.test(slotsSrc)],
  ['scratch.js delar vinsttrappan med panelen', /export const SCRATCH_MATH = \{ TIERS, NO_WIN_WEIGHT, TOTAL_WEIGHT \};/.test(read('public/js/scratch.js'))],
  [
    'panelen räknar med spelets egen utbetalningsformel',
    /import \{[^}]*luckPayout[^}]*\} from '\.\/luck\.js';/.test(economySrc) &&
      /luckPayout\(bet, /.test(economySrc)
  ],
  ['panelen använder slotsens och skraplotternas tabeller', /SLOT_MATH/.test(economySrc) && /SCRATCH_MATH/.test(economySrc)],
  ['fliken Ekonomi finns i adminpanelen', /key: 'ekonomi'/.test(adminSrc2) && /renderEkonomi\(content, root, data\)/.test(adminSrc2)]
].forEach(([label, ok2]) => (ok2 ? ok(label) : bad(label)));

console.log('\nSäker skrivning (samtidiga spelare)');

const apiSrc4 = read('lib/api.js');
const storeSrc = read('lib/store.js');
[
  ['lagret skriver aldrig tillbaka en gammal kopia', /err\.conflict = true/.test(storeSrc) && !/for \(let attempt = 0; attempt < 4/.test(storeSrc)],
  ['API:t kör om förfrågan vid skrivkonflikt', /MAX_ATTEMPTS/.test(apiSrc4) && /err\.conflict && attempt < MAX_ATTEMPTS/.test(apiSrc4)],
  ['förfrågningarna körs en i taget i samma instans', /let queue = Promise\.resolve\(\)/.test(apiSrc4)],
  ['begäran-kroppen kan läsas om vid omförsök', /__parsedBody/.test(apiSrc4)],
  ['osparad ändring ger 503 i stället för falskt ok', /retry: true/.test(apiSrc4)],
  ['klienten gör om anropet vid 503', /err\.retry = true/.test(read('public/js/core.js'))]
].forEach(([label, passed]) => (passed ? ok(label) : bad(label)));

console.log('\nUtbetalning av stora vinster');

const apiSrc3 = read('lib/api.js');
const creditMax = Number(/const CREDIT_MAX = ([\d_]+);/.exec(apiSrc3)?.[1]?.replace(/_/g, '') || 0);
[
  // 250 000 får bara finnas kvar som igenkänning av gamla vinster – aldrig som tak.
  ['inga vinster klipps vid 250 000 längre', !/:\s*250000;/.test(apiSrc3) && !/Math\.min\([^)]*250000\)/.test(apiSrc3)],
  ['skyddsräcket ligger över miljonvinster', creditMax >= 10000000, true],
  ['quizbelöningen har fortfarande ett eget tak', /game === 'quiz' \? 400 : CREDIT_MAX/.test(apiSrc3)],
  ['klienten varnar om en vinst skulle klämmas', /data\.capped/.test(read('public/js/core.js'))]
].forEach(([label, passed, showCap]) =>
  passed ? ok(label, showCap ? 'tak ' + creditMax : '') : bad(label)
);

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

console.log('\nRoulette');

const ruSrc = read('public/js/roulette.js');
const wheel = literal(ruSrc, 'const WHEEL = [');
const reds = new Set(literal(ruSrc, 'const RED = new Set(['));
const ruPay = literal(ruSrc, 'const PAYOUTS = {');
const ruOutside = literal(ruSrc, 'const OUTSIDE = [');
const ruDozens = literal(ruSrc, 'const DOZENS = [');
const ruColumns = literal(ruSrc, 'const COLUMNS = [');

const colors = { green: 0, red: 0, black: 0 };
wheel.forEach((n) => {
  colors[n === 0 ? 'green' : reds.has(n) ? 'red' : 'black'] += 1;
});

// Oberoende koll på vad varje utsida ska täcka (roulettens vanliga regler).
const covers = {
  red: (n) => reds.has(n),
  black: (n) => n !== 0 && !reds.has(n),
  odd: (n) => n !== 0 && n % 2 === 1,
  even: (n) => n !== 0 && n % 2 === 0,
  low: (n) => n >= 1 && n <= 18,
  high: (n) => n >= 19 && n <= 36,
  dozen1: (n) => n >= 1 && n <= 12,
  dozen2: (n) => n >= 13 && n <= 24,
  dozen3: (n) => n >= 25 && n <= 36,
  col1: (n) => n !== 0 && n % 3 === 1,
  col2: (n) => n !== 0 && n % 3 === 2,
  col3: (n) => n !== 0 && n % 3 === 0
};
const hits = (key) => wheel.filter(covers[key]).length;
const rtp = (mult, hitCount) => (mult * hitCount) / wheel.length;
const allSameRtp = [rtp(ruPay.straight, 1), rtp(ruPay.dozen, 12), rtp(ruPay.even, 18)].every(
  (v) => Math.abs(v - 36 / 37) < 0.0005
);

[
  ['37 olika fickor, 0 till 36', wheel.length === 37 && new Set(wheel).size === 37 && Math.min(...wheel) === 0 && Math.max(...wheel) === 36],
  ['rätt färger – 0 grön, 18 röda och 18 svarta', colors.green === 1 && colors.red === 18 && colors.black === 18],
  [
    'oddsen är roulettens egna: 36× nummer, 3× dussin/kolumn, 2× utsida',
    ruPay.straight === 36 &&
      ruPay.dozen === 3 &&
      ruPay.column === 3 &&
      ruPay.even === 2 &&
      ruOutside.length === 6 &&
      ruOutside.every((b) => b.mult === 2) &&
      ruDozens.every((d) => d.mult === 3) &&
      ruColumns.every((c) => c.mult === 3)
  ],
  [
    'varje utsida täcker rätt antal fickor (18 eller 12)',
    ruOutside.every((b) => hits(b.key) === 18) && [...ruDozens, ...ruColumns].every((b) => hits(b.key) === 12)
  ],
  ['nollan vinner åt huset på alla utsidor', ruOutside.every((b) => !covers[b.key](0))],
  ['återbetalningen är 97,3 % på varje satsning', allSameRtp, (36 / 37 * 100).toFixed(1).replace('.', ',') + ' %'],
  ['turen multipliceras in i varje vinst', /luckPayout\(amount, Math\.max\(1\.01, mult \* luck\), factor\)/.test(ruSrc) && /rouletteLuck/.test(ruSrc)],
  ['en vinst ger alltid mer än insatsen, även vid lägsta tur', luckPayout(100, Math.max(1.01, 2 * 0.1), LUCK_MIN) > 100],
  [
    'kontrollrummet öppnas bara med koden 333333',
    /const ROULETTE_CODE = '333333';/.test(apiSrc3) &&
      /const CONTROL_CODE = '333333';/.test(ruSrc) &&
      /code === ROULETTE_CODE/.test(apiSrc3) &&
      /if \(!rouletteController\(req\)\) return json\(res, 401/.test(apiSrc3)
  ],
  [
    'kontrollrummet gäller bara roulette och bara nästa snurr',
    /if \(game === 'roulette'\) \{\s*\n?\s*const pending = activeRig\(player\.id\);/.test(apiSrc3) &&
      /delete rouletteRigMap\(\)\[player\.id\];/.test(apiSrc3) &&
      /rigBet\.rig === 'lose' && cleanBet\.rig === null/.test(apiSrc3)
  ],
  [
    'kontrollrummet visar bara spelare som är online',
    /const ONLINE_MS = 2 \* 60 \* 1000;/.test(apiSrc3) &&
      /\.filter\(\(p\) => p\.online \|\| p\.rig\)/.test(apiSrc3) &&
      /onlineMinutes/.test(apiSrc3)
  ],
  [
    'bara en spelare som är online kan tvingas förlora',
    /now\(\) - player\.lastSeen > ONLINE_MS/.test(apiSrc3) && /offline: true/.test(apiSrc3) && /p\.online \? '' : ' is-offline'/.test(ruSrc)
  ],
  [
    'förlusten kan gälla en snurr eller tills admin släpper',
    /action !== 'lose' && action !== 'loseAlways'/.test(apiSrc3) &&
      /pending\.mode === 'loseAlways'/.test(apiSrc3) &&
      /data-mode="loseAlways"/.test(ruSrc)
  ],
  ['en tvingad förlust släpps efter en stund', /const RIG_TTL_MS = 15 \* 60 \* 1000;/.test(apiSrc3) && /now\(\) - rig\.at > RIG_TTL_MS/.test(apiSrc3)],
  [
    'tvingad förlust landar på en ficka utan vinst',
    /rig === 'lose' \? losingPocket\(game\.chips\) : randomPocket\(\)/.test(ruSrc) &&
      /const safe = WHEEL\.filter\(\(n\) => totalFor\(n\) === 0\)/.test(ruSrc)
  ],
  [
    'roulette finns i spelhallen, menyn och adminpanelen',
    /registerView\('roulette'/.test(ruSrc) &&
      /key: 'roulette'/.test(read('public/js/casino.js')) &&
      /import '\.\/roulette\.js'/.test(read('public/js/main.js')) &&
      /rouletteLuck/.test(apiSrc3) &&
      /chanceBox\('rouletteLuck'/.test(read('public/js/admin.js'))
  ]
].forEach(([label, passed, extra]) => (passed ? ok(label, extra || '') : bad(label, 'roulette.js')));

console.log('\nUtbetalning till spelarna');

const adminSrc = read('public/js/admin.js');
const coreSrc4 = read('public/js/core.js');
[
  ['gamla taket finns kvar som igenkänning', /const LEGACY_WIN_CAP = 250000;/.test(apiSrc3)],
  ['bara vinster före brytdatumet räknas som klippta', /LEGACY_CAP_REMOVED_AT/.test(apiSrc3) && /entry\.t\) >= LEGACY_CAP_REMOVED_AT/.test(apiSrc3)],
  ['varje klippt vinst betalas bara ut en gång', /db\.payouts\.keys\.push\(win\.key\)/.test(apiSrc3) && /const paid = new Set\(db\.payouts\.keys\)/.test(apiSrc3)],
  ['utbetalningen kräver bekräftelse', /body\.confirm !== true/.test(apiSrc3)],
  ['utbetalningen loggas som utbetalning', /logTransaction\(player, 'utbetalning', 'kompensation'/.test(apiSrc3)],
  ['panelen har fliken Utbetalning', /key: 'utbetalning'/.test(adminSrc) && /renderUtbetalning/.test(adminSrc)],
  ['panelen frågar innan pengarna delas ut', /confirmModal\(\{\s*\n?\s*title: 'Betala ut '/.test(adminSrc)],
  ['klienten kan hämta och betala ut', /adminCompensation\(/.test(coreSrc4) && /adminCompensationPay\(/.test(coreSrc4)],
  ['saldo uppdateras automatiskt hos spelaren', /setInterval\(async \(\) => \{[\s\S]{0,120}await api\.me\(\)/.test(read('public/js/main.js'))]
].forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'saknas i källkoden')));

console.log('\nUnderhållsläget och sportspelen');

const sportSrc = read('public/js/sport.js');
[
  ['servern nekar sportspel i underhållsläge', /maintenance\)\s*\{\s*\n?\s*if \(db\.settings\.maintenance\)/.test(apiSrc3) || /db\.settings\.maintenance/.test(apiSrc3)],
  ['sportvyn visar varför spelen är stängda', /sportClosed\(\)/.test(sportSrc) && /sport-closed/.test(sportSrc)],
  ['spelknappen är avstängd i underhållsläge', /sport.busy \|\| sportClosed\(\)/.test(sportSrc)],
  ['selftestet hoppar över sportsteget i stället för att fela', /underhållsläge på/.test(apiSrc3)],
  ['selftestet rapporterar underhållsläget', /maintenance: !!db\.settings\.maintenance/.test(apiSrc3)]
].forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'saknas i källkoden')));

console.log('\nTvå loggar');

const learnSrc = read('public/js/learn.js');
const historySrc = read('public/js/history.js');
const coreSrcLog = read('public/js/core.js');
const apiSrcLog = read('lib/api.js');
const mainSrcLog = read('public/js/main.js');
[
  ['plugget loggar varje svar', /api\.studyEvent\(\{ subject/.test(learnSrc) && /'POST \/api\/study\/log'/.test(apiSrcLog)],
  [
    'pluggets logg är en egen lista',
    /'GET \/api\/log'/.test(apiSrcLog) &&
      /const study = Array\.isArray\(player\.studyLog\)/.test(apiSrcLog) &&
      /const coins = Array\.isArray\(player\.log\)/.test(apiSrcLog) &&
      /player\.studyLog\.unshift\(entry\)/.test(apiSrcLog)
  ],
  [
    'pluggets logg har egen sida i studiemenyn',
    /logg: 'logg'/.test(coreSrcLog) &&
      /registerView\('logg', renderLogg\)/.test(learnSrc) &&
      /path: '\/logg', label: 'Logg'/.test(mainSrcLog) &&
      /Här ligger bara plugget/.test(learnSrc)
  ],
  [
    'spelhallen har en egen logg',
    /registerView\('historik', renderHistorik\)/.test(historySrc) &&
      /key: 'historik'/.test(read('public/js/casino.js')) &&
      /import '\.\/history\.js'/.test(mainSrcLog) &&
      /path: '\/kasino\/historik', label: 'Logg'/.test(mainSrcLog)
  ],
  [
    'kasinologgen blandar inte in plugget',
    /entry\.game === 'quiz'/.test(historySrc) && /isCasinoEntry/.test(historySrc)
  ],
  [
    'båda loggarna kräver ett eget konto',
    (apiSrcLog.match(/accountBlocked\(player\)/g) || []).length >= 5 && /'POST \/api\/study\/log'/.test(apiSrcLog)
  ]
].forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'loggarna')));

console.log('\nKonto för alla');

const gateSrc = read('public/js/gate.js');
const mainSrc = read('public/js/main.js');
const apiSrcAccount = read('lib/api.js');
[
  ['porten visas för alla utan konto', /export function syncAccountGate/.test(gateSrc) && /return !player\.hasPin;/.test(gateSrc)],
  ['porten kopplas in vid start och på varje sida', (mainSrc.match(/syncAccountGate\(\)/g) || []).length >= 2 && /import \{ syncAccountGate \} from '\.\/gate\.js';/.test(mainSrc)],
  ['porten går inte att stänga med Escape', !/Escape/.test(gateSrc) && !/dismissible/.test(gateSrc)],
  [
    'porten kräver namn och fyrsiffrig PIN',
    /name\.length < 2/.test(gateSrc) &&
      /PIN-koden måste vara fyra siffror/.test(gateSrc) &&
      /again !== pin/.test(gateSrc) &&
      /PIN-koderna är inte lika/.test(gateSrc)
  ],
  ['den som redan har konto kan logga in i porten', /api\.login\(name, pin\)/.test(gateSrc) && /gate-show-login/.test(gateSrc)],
  [
    'servern nekar gäst att satsa, vinna och ta bonus',
    (apiSrcAccount.match(/if \(accountBlocked\(player\)\) \{/g) || []).length >= 4 &&
      /needAccount: true/.test(apiSrcAccount) &&
      /ACCOUNT_REQUIRED/.test(apiSrcAccount)
  ],
  ['roulettens kontrollrum kräver ett eget konto', /if \(accountBlocked\(player\)\) return null;/.test(apiSrcAccount)],
  ['selftestet provar att en gäst nekas spela', /gäst utan konto nekas spela/.test(apiSrcAccount)]
].forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'saknas i källkoden')));

console.log('\nPausa spelare');

const adminSrcPause = read('public/js/admin.js');
const casinoSrcPause = read('public/js/casino.js');
const coreSrcPause = read('public/js/core.js');
const apiSrcPause = read('lib/api.js');
[
  [
    'pausen ligger på spelaren och har en sluttid',
    /player\.paused = true;/.test(apiSrcPause) &&
      /player\.pausedUntil =/.test(apiSrcPause) &&
      /function pauseLeft\(player\)/.test(apiSrcPause)
  ],
  [
    'pausad spelare nekas både spel och sportspel',
    (apiSrcPause.match(/if \(isPaused\(player\)\) return json\(res, 403, pausedBody\(player\)\);/g) || []).length >= 2 &&
      /paused: true,/.test(apiSrcPause)
  ],
  [
    'pausen släpps av sig själv när tiden är slut',
    /return left > 0 \? left : 0;/.test(apiSrcPause) && /export function pauseLeft/.test(coreSrcPause)
  ],
  [
    'admin kan pausa 5 min, 15 min, 1 timme eller tills vidare',
    /playerAction\(player\.id, 'pause', minutes\)/.test(adminSrcPause) &&
      /'5 min'/.test(adminSrcPause) &&
      /'15 min'/.test(adminSrcPause) &&
      /'1 timme'/.test(adminSrcPause) &&
      /'Tills vidare'/.test(adminSrcPause) &&
      /data-pause=/.test(adminSrcPause)
  ],
  [
    'spelaren ser pausen i lobbyn och i menyn',
    /is-paused/.test(casinoSrcPause) &&
      /id="casino-pause"/.test(casinoSrcPause) &&
      /Du är pausad/.test(casinoSrcPause) &&
      /Pausad \$\{esc\(pauseText/.test(mainSrc)
  ],
  [
    'pausen syns i spelarens logg',
    /Pausad av personalen/.test(historySrcPause()) && /Pausen släppt/.test(historySrcPause())
  ],
  [
    'selftestet provar pausen',
    /admin pausar spelaren/.test(apiSrcPause) &&
      /pausad spelare nekas spela men kan plugga/.test(apiSrcPause) &&
      /släppt paus spelar igen/.test(apiSrcPause)
  ]
].forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'pausen')));

function historySrcPause() {
  return read('public/js/history.js');
}

console.log('\nRikast – topplistan');

const rankSrc = read('public/js/rank.js');
const casinoSrcRank = read('public/js/casino.js');
const apiSrcRank = read('lib/api.js');
[
  [
    'servern rankar alla på mest pengar',
    /'GET \/api\/leaderboard'/.test(apiSrcRank) &&
      /\['balance', 'won', 'biggestWin'\]\.includes\(wanted\)/.test(apiSrcRank) &&
      /score\(b\) - score\(a\)/.test(apiSrcRank) &&
      /rows\.slice\(0, 50\)/.test(apiSrcRank)
  ],
  [
    'topplistan visar bara namn och siffror',
    /name: p\.name/.test(apiSrcRank) &&
      /balance: round2\(p\.balance \|\| 0\)/.test(apiSrcRank) &&
      !/publicPlayer\(p\)/.test(apiSrcRank.slice(apiSrcRank.indexOf("'GET /api/leaderboard'"), apiSrcRank.indexOf("'GET /api/sport/debug'")))
  ],
  [
    'spelaren ser sin egen plats',
    /me: p\.id === player\.id/.test(apiSrcRank) &&
      /const myIndex = rows\.findIndex\(\(r\) => r\.me\)/.test(apiSrcRank) &&
      /rank-row is-me/.test(rankSrc) &&
      /Din plats/.test(rankSrc)
  ],
  [
    'topplistan har en egen sida i spelhallen',
    /registerView\('rikast', renderRikast\)/.test(rankSrc) &&
      /key: 'rikast'/.test(casinoSrcRank) &&
      /import '\.\/rank\.js'/.test(mainSrc) &&
      /path: '\/kasino\/rikast', label: 'Rikast'/.test(mainSrc)
  ],
  [
    'man kan sortera på vunnet och största vinst',
    /key: 'won'/.test(rankSrc) && /key: 'biggestWin'/.test(rankSrc) && /data-sort=/.test(rankSrc)
  ],
  [
    'selftestet provar topplistan',
    /topplistan sorterar på mest pengar/.test(apiSrcRank)
  ]
].forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'topplistan')));

console.log('\nGåva till alla');

const adminSrcGift = read('public/js/admin.js');
const coreSrcGift = read('public/js/core.js');
const apiSrcGift = read('lib/api.js');
const historySrcGift = read('public/js/history.js');
const giftRoute = apiSrcGift.slice(
  apiSrcGift.indexOf("'POST /api/admin/gift'"),
  apiSrcGift.indexOf("'GET /api/roulette/control'")
);
[
  ['gåvan kräver admin', /'POST \/api\/admin\/gift'/.test(apiSrcGift) && /if \(!adminFromRequest\(req\)\)/.test(giftRoute)],
  [
    'inget delas ut utan bekräftelse',
    /if \(!body\.confirm\)/.test(giftRoute) && /preview: true/.test(giftRoute) && /players: players\.length/.test(giftRoute)
  ],
  [
    'gåvan går till alla konton och loggas',
    /players\.forEach\(\(player\) => \{/.test(giftRoute) &&
      /player\.balance = round2\(\(Number\(player\.balance\) \|\| 0\) \+ amount\)/.test(giftRoute) &&
      /logTransaction\(player, 'gåva', 'gåva till alla', amount, player\.balance\)/.test(giftRoute)
  ],
  ['meddelandet blir en notis', /if \(message\) db\.broadcast = message;/.test(giftRoute)],
  [
    'adminpanelen har gåvekortet',
    /Gåva till alla/.test(adminSrcGift) &&
      /id="gift-amount"/.test(adminSrcGift) &&
      /id="gift-message"/.test(adminSrcGift) &&
      /await sendGift\(amount, message, true\)/.test(adminSrcGift)
  ],
  [
    'gåvan syns i spelarens logg',
    /Gåva från personalen/.test(historySrcGift) && /kind === 'gåva'/.test(historySrcGift)
  ],
  [
    'panelen fungerar även lokalt',
    /gift\(amount, message, confirm\)/.test(coreSrcGift) && /async adminGift\(amount, message, confirm\)/.test(coreSrcGift)
  ],
  [
    'selftestet provar gåvan utan att dela ut',
    /gåvan kräver admin och ett belopp/.test(apiSrcGift)
  ]
].forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'gåvan')));

console.log(
  failures === 0
    ? '\nAlla kontroller gick igenom ✅\n'
    : `\n${failures} kontroll(er) misslyckades ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
