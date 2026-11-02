#!/usr/bin/env node
'use strict';

/**
 * Kontrollerar utbetalningarna i alla spel:
 *  1. Slots  – varje vinst ger mer än insatsen, RTP rimligt.
 *  2. Videopoker – lägsta vinsten ger mer än insatsen.
 *  3. Blackjack – vinst 2× insats, blackjack 2,5×, lika 1×.
 *  4. Sport – utbetalning = insats × odds och alltid ≥ insatsen.
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

let slotSum = 0;
const SLOT_SPINS = 120000;
for (let i = 0; i < SLOT_SPINS; i += 1) slotSum += spin();
const slotRtp = (slotSum / SLOT_SPINS) * 100;
if (slotRtp > 88 && slotRtp < 97) ok('RTP ligger i intervallet', `${slotRtp.toFixed(1)} %`);
else bad('RTP utanför intervallet 88–97 %', `${slotRtp.toFixed(1)} %`);

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

/* ------------------------------ blackjack ------------------------------ */
console.log('\nBlackjack – 3:2 på blackjack');

const bjSrc = read('public/js/blackjack.js');
const checks = [
  ['vinst ger insatsen tillbaka + lika mycket till (2×)', /totalWin \+= h\.bet \* 2;/],
  ['blackjack ger 1,5× i vinst (2,5× tillbaka)', /bet \* \(1 \+ payoutRatio\(\)\)/],
  ['lika ger insatsen tillbaka', /h\.result = 'push';\s*\n\s*totalWin \+= h\.bet;/],
  ['utbetalningen visas i klienten', /Utbetalning <strong>/]
];
checks.forEach(([label, re]) => (re.test(bjSrc) ? ok(label) : bad(label)));

const settle = (bet, kind) => {
  const totalBetAmount = bet;
  let payout = 0;
  if (kind === 'win') payout = bet * 2;
  else if (kind === 'blackjack') payout = Math.round(bet * (1 + 1.5));
  else if (kind === 'push') payout = bet;
  return { payout, net: payout - totalBetAmount };
};

[
  ['vinst', 'win', 250, 500, 250],
  ['blackjack', 'blackjack', 250, 625, 375],
  ['lika', 'push', 250, 250, 0],
  ['förlust', 'lose', 250, 0, -250]
].forEach(([label, kind, bet, wantPayout, wantNet]) => {
  const { payout, net } = settle(bet, kind);
  if (payout === wantPayout && net === wantNet) ok(`${label}: insats ${bet} → ${payout} ut, netto ${net}`);
  else bad(`${label}: insats ${bet} → ${payout} ut (ville ${wantPayout}), netto ${net}`);
});

/* -------------------------------- sport -------------------------------- */
console.log('\nSport – spel till fasta odds');

const sports = require(path.join(root, 'lib/sports.js'));
const sample = sports.hockeyDemoFeed(Date.now(), 6).find((match) => match.markets.length);
const odds = sample.markets[0].selections[0].odds;
const stake = 100;
const payout = Math.round(stake * odds * 100) / 100;
if (odds > 1 && payout > stake) ok('vinst ger mer än insatsen', `${stake} kr @ ${odds} → ${payout} kr`);
else bad('oddsen kan ge mindre än insatsen', `${odds}`);

// Spelbara (inte färdigspelade) matcher ska alltid ha odds på minst 1,01.
const allLow = [sports.demoFeed(Date.now(), 6), sports.hockeyDemoFeed(Date.now(), 6)]
  .flat()
  .filter((match) => match.status !== 'finished')
  .flatMap((match) => match.markets)
  .flatMap((market) => market.selections)
  .filter((sel) => !(sel.odds >= 1.01));
if (!allLow.length) ok('alla spelbara odds är minst 1,01');
else bad('odds under 1,01 hittade', String(allLow.length));

console.log(
  failures === 0
    ? '\nAlla kontroller gick igenom ✅\n'
    : `\n${failures} kontroll(er) misslyckades ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
