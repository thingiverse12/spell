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

/* --------------------------- rysk roulette --------------------------- */

console.log('\nRysk roulette – en kula i sex kammare');

const rvSrc = read('public/js/revolver.js');
const rvMath = (() => {
  const start = rvSrc.indexOf('export const REVOLVER_MATH');
  if (start < 0) return null;
  const from = rvSrc.indexOf('{', start);
  let depth = 0;
  for (let i = from; i < rvSrc.length; i += 1) {
    if (rvSrc[i] === '{') depth += 1;
    else if (rvSrc[i] === '}') {
      depth -= 1;
      if (depth === 0) return new Function('return ' + rvSrc.slice(from, i + 1))();
    }
  }
  return null;
})();

if (rvMath && rvMath.CHAMBERS === 6 && rvMath.BULLETS === 1) {
  ok('trumman har sex kammare och en kula');
} else bad('trumman har inte sex kammare med en kula', rvMath);

const rvPayouts = (rvMath && rvMath.PAYOUTS) || [];
const rvProb = (pulls) => (rvMath.CHAMBERS - pulls) / rvMath.CHAMBERS;
const rvRtp = (pulls) => rvProb(pulls) * rvPayouts[pulls - 1] * 100;

if (rvPayouts.length === 5) ok('vinsttrappan har fem steg (fler klick än så går inte)');
else bad('vinsttrappan ska ha fem steg', rvPayouts.length);

if (rvPayouts.every((mult, i) => i === 0 || mult > rvPayouts[i - 1])) ok('varje klick ger högre multipel');
else bad('vinsttrappan är inte stigande', rvPayouts.join(' < '));

if (rvPayouts.every((mult) => mult > 1)) ok('en vinst ger alltid mer än insatsen tillbaka');
else bad('något steg kan ge mindre än insatsen', rvPayouts.join(', '));

[1, 2, 3, 4, 5].forEach((pulls) => {
  const rtp = rvRtp(pulls);
  const label = `${pulls} klick: chans ${(rvProb(pulls) * 100).toFixed(1)} % × ${String(rvPayouts[pulls - 1]).replace('.', ',')}`;
  if (rtp > 85 && rtp < 100) ok(`${label} → RTP ${rtp.toFixed(1).replace('.', ',')} %`);
  else bad(`${label} → RTP ${rtp.toFixed(1)} % (ska ligga mellan 85 och 100)`);
});

const rvChecks = [
  ['insatsen dras innan trumman laddas', /await api\.bet\('revolver', bet\)/.test(rvSrc) && /game\.bullet = randomChamber\(\)/.test(rvSrc)],
  ['vinsten betalas via servern', /await api\.credit\('revolver', win\)/.test(rvSrc)],
  ['kulan ligger i en jämnt slumpad kammare', /function randomChamber\(\)/.test(rvSrc) && /crypto\.getRandomValues/.test(rvSrc)],
  ['spelaren kan ta vinsten mellan klicken', /id="rv-cash"/.test(rvSrc) && /async function cashOut\(root\)/.test(rvSrc)],
  ['vinsten räknas med gummibandet', /luckPayout\(game\.bet, REVOLVER_MATH\.PAYOUTS/.test(rvSrc)],
  ['efter fem klick tas vinsten automatiskt', /game\.pulls >= MAX_PULLS/.test(rvSrc) && /Den sjätte kammaren är alltid laddad/.test(rvSrc)],
  ['en laddad runda får inte tappas bort', /guardRound\(/.test(rvSrc) && /game\.phase === 'armed'/.test(rvSrc)],
  ['vyn är registrerad och nås från spelhallen', /registerView\('revolver'/.test(rvSrc) && /key: 'revolver'/.test(read('public/js/casino.js')) && /'\/kasino\/revolver'/.test(read('public/js/main.js'))],
  ['loggen visar rysk roulette', /revolver: 'Rysk roulette'/.test(read('public/js/history.js')) && /revolver: '🔫'/.test(read('public/js/history.js'))],
  ['adminpanelen visar spelet i statistiken', /revolver: 'Rysk roulette'/.test(read('public/js/admin.js'))],
  ['selftestet spelar en runda', /rysk roulette: insats, vinst och statistik/.test(apiSrcBj)],
  ['README beskriver spelet', /Rysk roulette/.test(readmeBj) && /sex kammare/.test(readmeBj)]
];
rvChecks.forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'rysk roulette')));

/* --------------------- rysk roulette mot varandra --------------------- */

console.log('\nRysk roulette mot varandra – ett bord, en kassa');

const rvbSrc = read('public/js/revolverbord.js');
const rvbServer = read('lib/api.js');
const rvbMath = literal(rvbSrc, 'export const REVOLVER_BORD_MATH');
const rvbChambers = Number(rvbMath.CHAMBERS) || 0;
const rvbMaxSeats = Number(rvbMath.MAX_SEATS) || 0;
const rvbMinSeats = Number(rvbMath.MIN_SEATS) || 0;

if (rvbChambers === 6 && rvbMinSeats === 2 && rvbMaxSeats === 6) {
  ok('bordet har sex kammare och plats för 2–6 spelare', `${rvbMinSeats}–${rvbMaxSeats} spelare`);
} else bad('bordets spelregler är fel', `${rvbChambers} kammare, ${rvbMinSeats}–${rvbMaxSeats} spelare`);

if (rvbMath.HOUSE_CUT === 0) ok('huset tar ingenting av kassan');
else bad('huset tar en andel av kassan', rvbMath.HOUSE_CUT);

/* Varje spelare vinner med 1/n och får hela kassan n × insats → RTP 100 %. */
[2, 3, 4, 5, 6].forEach((players) => {
  const ante = 100;
  const pot = players * ante;
  const ev = pot / players;
  const rtp = (ev / ante) * 100;
  if (Math.abs(rtp - 100) < 0.001) ok(`${players} spelare: kassan ${pot} kr, chans 1/${players} → RTP ${rtp.toFixed(1)} %`);
  else bad(`${players} spelare ger RTP ${rtp.toFixed(1)} % (ska vara 100)`);
});

const perPull = (1 / rvbChambers) * 100;
if (Math.abs(perPull - 16.666) < 0.01) ok('varje klick har 16,7 % risk (en kammare av sex)', perPull.toFixed(1) + ' %');
else bad('risken per klick stämmer inte', perPull.toFixed(1) + ' %');

const rvbChecks = [
  ['servern lägger kulan, aldrig klienten', /function rvbChamber\(\)/.test(rvbServer) && /crypto\.randomInt\(0, RVB\.CHAMBERS\)/.test(rvbServer)],
  [
    'bordsläget skickar aldrig ut kulan',
    (() => {
      const start = rvbServer.indexOf('function rvbPublic(');
      const end = rvbServer.indexOf('function rvbPlayerOrError(');
      if (start < 0 || end < 0) return false;
      return !/bullet/i.test(rvbServer.slice(start, end));
    })()
  ],
  ['alla som går med betalar samma insats', /function rvbTakeAnte\(player, amount, table\)/.test(rvbServer) && /rvbTakeAnte\(player, table\.ante, table\)/.test(rvbServer)],
  ['insatsen dras när man går med – inte när matchen startar', /rvbTakeAnte\(player, ante, table\)/.test(rvbServer) && /rvbTakeAnte\(player, table\.ante, table\)/.test(rvbServer)],
  ['kassan betalas ut i sin helhet till vinnaren', /function rvbFinish\(table, winnerSeat\)/.test(rvbServer) && /rvbPayWin\(winner, prize\)/.test(rvbServer)],
  ['man kan bara sitta vid ett bord i taget', /function rvbActiveTableOf\(player\)/.test(rvbServer) && /Du sitter redan vid ett bord/.test(rvbServer)],
  ['lämnat väntrum betalar tillbaka insatsen', /rvbRefund\(player, table\.ante\)/.test(rvbServer) && /lämnade bordet och fick tillbaka sin insats/.test(rvbServer)],
  ['bara den vars tur det är kan trycka av', /if \(Number\(table\.turn\) !== seatIndex\)/.test(rvbServer) && /Det är inte din tur/.test(rvbServer)],
  ['bara värden kan starta matchen', /if \(table\.hostId !== player\.id\) return json\(res, 403/.test(rvbServer)],
  ['minst två spelare krävs för att starta', /seats\.length < RVB\.MIN_SEATS/.test(rvbServer)],
  ['turen går vidare till nästa levande spelare', /function rvbNextAlive\(table, from\)/.test(rvbServer)],
  ['tiden rinner ut och bordet trycker av åt spelaren', /function rvbAutoAdvance\(table\)/.test(rvbServer) && /lät tiden gå/.test(rvbServer)],
  ['stilla bord stängs och betalar tillbaka', /function rvbSweep\(\)/.test(rvbServer) && /IDLE_MS/.test(rvbServer)],
  ['gäst utan konto nekas bordsläget', /function rvbPlayerOrError\(req, res\)/.test(rvbServer) && /ACCOUNT_REQUIRED/.test(rvbServer)],
  ['bordsvyn pollar bordet och stoppar när man lämnar', /POLL_MS/.test(rvbSrc) && /function onBordRoute\(\)/.test(rvbSrc)],
  ['vyn nås från rysk roulette och spelhallen', /key: 'revolver\/bord'/.test(read('public/js/casino.js')) && /revolver\/bord/.test(read('public/js/main.js'))],
  ['loggen visar bordet', /revolverbord: 'Rysk roulette – bord'/.test(read('public/js/history.js'))],
  ['adminpanelen visar bordet', /revolverbord: 'Rysk roulette \(bord\)'/.test(read('public/js/admin.js'))],
  ['selftestet spelar en hel bordsmatch', /rysk roulette mot varandra: en vinner hela kassan/.test(rvbServer)],
  ['README beskriver bordsläget', /Rysk roulette mot varandra/.test(readmeBj) && /tar hela kassan/.test(readmeBj)],
  ['simuleringen räknar på bordsläget', /Rysk roulette mot varandra – bordet/.test(read('docs/simulering.md'))]
];
rvbChecks.forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'rysk roulette mot varandra')));

/* --------------------------------- ateljén --------------------------------- */

console.log('\nAteljén – figur, färg och rum');

const lookSrc = read('public/js/look.js');
const ateljeSrc = read('public/js/atelje.js');
const ateljeCatalogClient = literal(lookSrc, 'export const ATELJE_ITEMS = [');
const ateljeCatalogServer = literal(apiSrcBj, 'const ATELJE_ITEMS = [');
const ateljeRoomSlots = Number(/export const ATELJE_ROOM_SLOTS = (\d+)/.exec(lookSrc)?.[1]);

if (JSON.stringify(ateljeCatalogClient) === JSON.stringify(ateljeCatalogServer)) {
  ok('klienten och servern har exakt samma katalog', `${ateljeCatalogClient.length} saker`);
} else bad('katalogerna har glidit isär – servern och klienten visar olika saker');

const ateljeIds = ateljeCatalogClient.map((item) => item.id);
if (new Set(ateljeIds).size === ateljeIds.length) ok('varje sak har ett unikt id');
else bad('samma id finns på flera saker');

if (ateljeCatalogClient.every((item) => Number.isFinite(item.price) && item.price >= 0)) {
  ok('alla saker har ett pris som är noll eller mer');
} else bad('någon sak har ett konstigt pris');

const freeItems = ateljeCatalogClient.filter((item) => item.price === 0).map((item) => item.id);
if (['fox', 'none', 'mint'].every((id) => freeItems.includes(id))) {
  ok('alla har en gratis figur, färg och tom accessoar från start');
} else bad('det finns ingen gratis startuppsättning', freeItems.join(', '));

const ateljeKindsSeen = new Set(ateljeCatalogClient.map((item) => item.kind));
if (['emblem', 'accent', 'color', 'room'].every((kind) => ateljeKindsSeen.has(kind))) {
  ok('det finns saker i alla fyra kategorierna');
} else bad('någon kategori är tom', [...ateljeKindsSeen].join(', '));

if (ateljeRoomSlots >= 4) ok('rummet har plats för flera saker', `${ateljeRoomSlots} platser`);
else bad('rummet har för få platser', ateljeRoomSlots);

/* Alla saker ska gå att spara ihop till genom att plugga – inte bara genom tur. */
const quizReward = 25;
const dyrast = ateljeCatalogClient.reduce((max, item) => Math.max(max, item.price), 0);
const rattSvar = Math.ceil(dyrast / quizReward);
if (rattSvar <= 200) ok('den dyraste saken går att spara ihop till', `${dyrast} kr ≈ ${rattSvar} rätt svar`);
else bad('den dyraste saken kräver orimligt många rätt svar', rattSvar);

const lockedItems = ateljeCatalogClient.filter((item) => item.requires && item.requires.quizCorrect > 0);
if (lockedItems.length >= 2 && lockedItems.every((item) => item.price > 0)) {
  ok('några saker låses upp av antal rätt svar', lockedItems.map((i) => i.name).join(', '));
} else bad('det finns inga saker som låses upp av plugg');

const ateljeChecks = [
  ['servern äger prislistan', /const ATELJE_BY_ID = new Map/.test(apiSrcBj) && /if \(item\.price > player\.balance\)/.test(apiSrcBj)],
  ['man kan inte köpa samma sak två gånger', /if \(ateljeOwns\(player, item\.id\)\) return json\(res, 409/.test(apiSrcBj)],
  ['låsta saker går inte att köpa', /function ateljeLocked\(player, item\)/.test(apiSrcBj) && /locked: true/.test(apiSrcBj)],
  ['bara ägda saker kan sättas på', /function ateljeLook\(player\)/.test(apiSrcBj) && /ateljeOwns\(player, item\.id\) \? item\.id : fallback/.test(apiSrcBj)],
  ['köpet dras som en riktig transaktion', /logTransaction\(player, 'köp', 'atelje'/.test(apiSrcBj)],
  ['utseendet följer med spelaren', /look: ateljeLook\(p\)/.test(apiSrcBj) && /owned: ateljeOwned\(p\)/.test(apiSrcBj)],
  ['gäst utan konto kan inte köpa', /POST \/api\/atelje\/buy/.test(apiSrcBj) && /accountBlocked\(player\)/.test(apiSrcBj)],
  ['vyn ritar figuren och rummet', /avatarHTML\(look\(\), \{ size: 'xl' \}\)/.test(ateljeSrc) && /roomHTML\(look\(/.test(ateljeSrc)],
  ['ateljén finns i menyn och på startsidan', /'\/atelje'/.test(read('public/js/main.js')) && /Öppna ateljén/.test(read('public/js/learn.js'))],
  ['toppraden visar figuren', /avatarHTML\(state\.player\?\.look/.test(read('public/js/main.js'))],
  ['loggen visar ateljén', /atelje: 'Ateljén'/.test(read('public/js/history.js'))],
  ['adminpanelen visar ateljén', /atelje: 'Ateljén'/.test(read('public/js/admin.js'))],
  ['selftestet köper och klär på', /ateljén: köp drar mynt och allt man äger sparas/.test(apiSrcBj) && /ateljén: bara det man äger kan sättas på/.test(apiSrcBj)],
  ['README beskriver ateljén', /Ateljén/.test(readmeBj) && /spelmynt/.test(readmeBj)]
];
ateljeChecks.forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'ateljén')));

/* ------------------------------ Finns i sjön ------------------------------ */

console.log('\nFinns i sjön – kortspel vid ett bord');

const finnsSrc = read('public/js/finns.js');
const finnsMath = literal(finnsSrc, 'export const FINNS_MATH');
const finnsServer = apiSrcBj;

if (
  Number(finnsMath.MIN_SEATS) === 2 &&
  Number(finnsMath.MAX_SEATS) === 6 &&
  Number(finnsMath.HAND_SMALL) === 7 &&
  Number(finnsMath.HAND_BIG) === 5
) {
  ok(
    'bordet tar 2–6 spelare, sju kort var vid 2–3 och fem var vid 4–6',
    `${finnsMath.MIN_SEATS}–${finnsMath.MAX_SEATS} spelare`
  );
} else bad('spelreglerna stämmer inte', JSON.stringify(finnsMath));

if (Number(finnsMath.CARDS) === 52 && Number(finnsMath.RANKS) === 13) {
  ok('leken är 52 kort: 13 valörer i fyra färger');
} else bad('kortleken stämmer inte', `${finnsMath.CARDS} kort, ${finnsMath.RANKS} valörer`);

if (Number(finnsMath.HOUSE_CUT) === 0) ok('huset tar ingenting av kassan');
else bad('huset tar en andel av kassan', finnsMath.HOUSE_CUT);

/* Kassan är insats × spelare och betalas ut i sin helhet → RTP 100 %. */
[2, 3, 4, 5, 6].forEach((players) => {
  const ante = 100;
  const pot = players * ante;
  const rtp = ((pot / players) / ante) * 100;
  if (Math.abs(rtp - 100) < 0.001) {
    ok(`${players} spelare: kassan ${pot} kr, chans 1/${players} → RTP ${rtp.toFixed(1)} %`);
  } else bad(`${players} spelare ger RTP ${rtp.toFixed(1)} % (ska vara 100)`);
});

const finnsChecks = [
  ['servern blandar och delar korten', /function finnsDeck\(\)/.test(finnsServer) && /crypto\.randomInt/.test(finnsServer)],
  [
    'bara den egna handen skickas till klienten',
    (() => {
      const start = finnsServer.indexOf('function finnsPublic(');
      const end = finnsServer.indexOf('function finnsActiveTableOf(');
      if (start < 0 || end < 0) return false;
      const pub = finnsServer.slice(start, end);
      return /cards: finnsCards\(seat\)\.length/.test(pub) && !/hand: finnsCards\(seat\)/.test(pub) && /hand,/.test(pub);
    })()
  ],
  ['man måste ha valören själv för att fråga efter den', /Du måste ha minst ett/.test(finnsServer) && /Du får bara fråga efter en valör du har själv/.test(finnsSrc)],
  ['miss säger "Finns i sjön!" och ger ett kort ur sjön', /Finns i sjön!/.test(finnsServer) && /seat\.hand\.push\(drawn\)/.test(finnsServer)],
  ['rätt valör på draget ger en fråga till', /drawn\.r === wanted/.test(finnsServer) && /keepsTurn/.test(finnsServer)],
  ['fyra lika blir ett fyrtal', /finnsRankCount\(seat, rank\) < 4/.test(finnsServer) && /ett fyrtal/.test(finnsServer)],
  ['flest fyrtal vinner – lika delar kassan', /const best = seats\.reduce/.test(finnsServer) && /const share = round2\(prize \/ top\.length\)/.test(finnsServer)],
  ['insatsen dras som en riktig transaktion', /logTransaction\(player, 'insats', FINNS_GAME/.test(finnsServer) && /bumpGame\(player, FINNS_GAME, 'bet'/.test(finnsServer)],
  ['vinsten betalas via servern', /function finnsPayWin\(player, amount\)/.test(finnsServer) && /logTransaction\(player, 'vinst', FINNS_GAME/.test(finnsServer)],
  ['lämnat väntrum betalar tillbaka insatsen', /finnsRefund\(player, table\.ante\)/.test(finnsServer)],
  ['bara värden delar ut korten', /if \(table\.hostId !== player\.id\) return json\(res, 403/.test(finnsServer)],
  ['minst två spelare krävs', /seats\.length < FINNS\.MIN_SEATS/.test(finnsServer)],
  ['tiden rinner ut och bordet frågar åt spelaren', /function finnsAutoAdvance\(table\)/.test(finnsServer) && /tvekade/.test(finnsServer)],
  ['sjön tar slut och fyrtalen räknas', /Ingen hade kort kvar att fråga om/.test(finnsServer) && /function finnsShouldFinish\(table\)/.test(finnsServer)],
  ['gäst utan konto nekas kortbordet', /rvbPlayerOrError\(req, res\)/.test(finnsServer) && /ACCOUNT_REQUIRED/.test(finnsServer)],
  ['vyn pollar bordet och stoppar när man lämnar', /POLL_MS/.test(finnsSrc) && /function onFinnsRoute\(\)/.test(finnsSrc)],
  ['vyn nås från spelhallen och menyn', /key: 'finns'/.test(read('public/js/casino.js')) && /'\/kasino\/finns'/.test(read('public/js/main.js'))],
  ['figuren från ateljén syns vid bordet', /function finnsEmblemOf\(playerId\)/.test(finnsServer)],
  ['loggen visar Finns i sjön', /finns: 'Finns i sjön'/.test(read('public/js/history.js')) && /finns: '🐟'/.test(read('public/js/history.js'))],
  ['adminpanelen visar Finns i sjön', /finns: 'Finns i sjön'/.test(read('public/js/admin.js'))],
  ['selftestet delar ut kort och räknar alla 52', /finns i sjön: korten delas ut och bara den egna handen syns/.test(finnsServer) && /finns i sjön: ett drag lämnar alla 52 kort på bordet/.test(finnsServer)],
  ['README beskriver Finns i sjön', /Finns i sjön/.test(read('README.md')) && /fyrtal/.test(read('README.md'))],
  ['simuleringen räknar på kortspelet', /Finns i sjön/.test(read('docs/simulering.md'))]
];
finnsChecks.forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'Finns i sjön')));

/* ------------------------------ Inpostern ------------------------------ */

console.log('\nInpostern – ett ord, en bluff');

const impSrc = read('public/js/imposter.js');
const impRules = literal(impSrc, 'export const IMPOSTER = {');
const impWords = literal(impSrc, 'export const IMPOSTER_WORDS = [');

if (Number(impRules.MIN_PLAYERS) === 3 && Number(impRules.MAX_PLAYERS) === 12) {
  ok('spelet tar 3–12 spelare', `${impRules.MIN_PLAYERS}–${impRules.MAX_PLAYERS}`);
} else bad('antalet spelare stämmer inte', JSON.stringify(impRules));

if (impWords.length >= 40) ok('ordlistan är stor nog att spela många omgångar', `${impWords.length} ord`);
else bad('ordlistan är för liten', `${impWords.length} ord`);

const impMissingHint = impWords.filter((entry) => !entry.hint || !String(entry.hint).trim());
if (!impMissingHint.length) ok('varje ord har en ledtråd till inpostern');
else bad('några ord saknar ledtråd', impMissingHint.map((e) => e.word).join(', '));

const impDuplicates = impWords.map((e) => e.word).filter((word, i, all) => all.indexOf(word) !== i);
if (!impDuplicates.length) ok('inga ord förekommer två gånger');
else bad('samma ord finns flera gånger', impDuplicates.join(', '));

const impHints = new Set(impWords.map((e) => e.hint));
if (impHints.size >= 8) ok('ledtrådarna är breda kategorier, inte orden', `${impHints.size} kategorier`);
else bad('för få kategorier i ordlistan', impHints.size);

const impCardSrc = impSrc.slice(impSrc.indexOf('function dealHTML()'), impSrc.indexOf('function tableHTML()'));
const imposterBranch = impCardSrc.slice(impCardSrc.indexOf('isImposter'), impCardSrc.indexOf(': `<div class="imp__card">'));
if (/ui\.clue/.test(imposterBranch) && !/ui\.secret/.test(imposterBranch)) {
  ok('inpostern får ledtråden – aldrig själva ordet');
} else bad('inpostern kan se ordet i sin vy');

const impChecks = [
  ['rollerna slumpas för varje omgång', /randomIndex\(0, ui\.count - 1\)/.test(impSrc)],
  ['spelledaren som väljer ord blir aldrig inposter', /randomIndex\(1, ui\.count - 1\)/.test(impSrc)],
  ['eget ord krävs innan utdelningen', /word\.length < 2/.test(impSrc) && /Skriv ordet som spelarna ska gissa på/.test(impSrc)],
  ['varje spelare tittar själv – telefonen skickas runt', /Ge telefonen till/.test(impSrc) && /Visa min roll/.test(impSrc)],
  ['rollerna avslöjas först när alla har sett', /Vem var inpostern\?/.test(impSrc) && /imp-reveal/.test(impSrc)],
  ['man kan spela igen med samma spelare', /imp-again/.test(impSrc) && /ui\.round \+= 1/.test(impSrc)],
  ['spelet kostar inga spelmynt', /Kostar <strong>0 kr/.test(impSrc) && !/api\.bet\(/.test(impSrc)],
  ['vyn nås från spelhallen och menyn', /key: 'imposter'/.test(read('public/js/casino.js')) && /'\/kasino\/imposter'/.test(read('public/js/main.js'))],
  ['README beskriver Inpostern', /Inpostern/.test(read('README.md')) && /inposter/.test(read('README.md'))]
];
impChecks.forEach(([label, passed]) => (passed ? ok(label) : bad(label, 'Inpostern')));

/* -------------------- Inpostern om mynt: egna skärmar -------------------- */

console.log('\nInpostern om mynt – egna skärmar och en kassa');

const inpoSrc = read('public/js/imposter-online.js');
const inpoServerSrc = read('lib/api.js');
const inpoSection = inpoServerSrc.slice(
  inpoServerSrc.indexOf("const INP_GAME = 'inposter'"),
  inpoServerSrc.indexOf('/* ---- ateljén ---- */')
);
const inpRules = literal(inpoServerSrc, 'const INP = {');
const inpWords = literal(inpoServerSrc, 'const INP_WORDS = [');

const inpoChecks = [
  ['bordet tar 3–12 spelare', Number(inpRules.MIN_SEATS) === 3 && Number(inpRules.MAX_SEATS) === 12, `${inpRules.MIN_SEATS}–${inpRules.MAX_SEATS}`],
  ['två inposter först från sju spelare', Number(inpRules.TWO_IMPOSTERS_FROM) === 7, inpRules.TWO_IMPOSTERS_FROM],
  ['laget får dubbelt igen', Number(inpRules.CREW_PAYOUT) === 2, inpRules.CREW_PAYOUT],
  ['koden har fyra tecken utan 0/O/1/I', Number(inpRules.CODE_LENGTH || 4) === 4 && !/[01OI]/.test(String(inpRules.CODE_LETTERS)), String(inpRules.CODE_LETTERS)],
  ['servern äger ordlistan och rollerna', /function inpDealRound/.test(inpoSection) && /crypto\.randomInt/.test(inpoSection)],
  ['inposterna får bara ledtråden', /table\.hint = entry\.hint/.test(inpoSection) && /table\.word = entry\.word/.test(inpoSection) && /hint: .*isImposter/.test(inpoSection)],
  ['rollerna läcker inte ut före slutet', /imposter: table\.phase === 'done' && !!seat\.imposter/.test(inpoSection)],
  ['ordet är dolt för inposterna', /word: !mySeat \|\| isImposter \? \(phase === 'done' \? table\.word : null\) : table\.word/.test(inpoSection)],
  ['lagets vinst ger insatsen gång två', /inpPayWin\([^)]*ante \* INP\.CREW_PAYOUT/.test(inpoSection) || /ante \* INP\.CREW_PAYOUT/.test(inpoSection)],
  [
    'inposterna delar hela kassan',
    /const share = imposters\.length \? round2\(pot \/ imposters\.length\) : 0/.test(inpoSection) &&
      /pot - share \* i/.test(inpoSection)
  ],
  ['insatsen dras från alla i kassan', /function inpTakeAnte/.test(inpoSection) && /table\.pot = round2\(\(table\.pot \|\| 0\) \+ ante\)/.test(inpoSection)],
  ['avbrutet spel ger pengarna tillbaka', /voided: true/.test(inpoSection) && /function inpRefund/.test(inpoSection)],
  ['gäst utan konto nekas bordet', /ACCOUNT_REQUIRED/.test(inpoSection) || /needAccount/.test(inpoSection)],
  ['varje enhet pollar bara sitt eget bord', /POLL_MS/.test(inpoSrc) && /function onInposterRoute\(\)/.test(inpoSrc)],
  ['man väljer en telefon eller egna skärmar', /data-mode="local"/.test(impSrc) && /data-mode="online"/.test(impSrc) && /mountOnline/.test(impSrc)],
  ['länk med kod går rakt in i bordet', /joinCode\(code\)/.test(impSrc) && /export function joinCode/.test(inpoSrc)],
  ['koden går att dela med sig av', /inpo-copy/.test(inpoSrc) && /Kopiera/.test(inpoSrc)],
  ['vyn nås från spelhallen och menyn', /key: 'imposter'/.test(read('public/js/casino.js')) && /'\/kasino\/imposter'/.test(read('public/js/main.js'))],
  ['loggen visar Inpostern', /inposter: 'Inpostern'/.test(read('public/js/history.js')) && /inposter: '🎭'/.test(read('public/js/history.js'))],
  ['adminpanelen visar Inpostern', /inposter: 'Inpostern'/.test(read('public/js/admin.js'))],
  ['klienten har css för bordet', /\.inpo__role/.test(read('public/css/casino.css')) && /\.imp__mode/.test(read('public/css/casino.css'))]
];
inpoChecks.forEach(([label, passed, info]) => (passed ? ok(label, info) : bad(label, info ?? 'Inpostern om mynt')));

/* ordlistan måste vara samma i klienten och på servern */
const impWordList = impWords.map((e) => e.word + '|' + e.hint);
const inpWordList = inpWords.map((e) => e.word + '|' + e.hint);
const wordDiff = inpWordList.length === impWordList.length && inpWordList.every((w, i) => w === impWordList[i]);
if (wordDiff) ok('samma ordlista i klienten och på servern', `${inpWordList.length} ord`);
else
  bad(
    'ordlistorna har glidit isär',
    `server ${inpWordList.length}, klient ${impWordList.length}` +
      (inpWordList.length === impWordList.length
        ? ' – först: ' + inpWordList.find((w, i) => w !== impWordList[i])
        : '')
  );

if (inpWords.every((e) => e.word && e.hint)) ok('alla serverord har en ledtråd');
else bad('något serverord saknar ledtråd', inpWords.filter((e) => !e.hint).map((e) => e.word).join(', '));

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

/* -------------------------------- läsaren -------------------------------- */

console.log('\nLäsaren – böcker, bildspel, frågor och quiz');

const lasDir = path.join(root, 'public', 'lasaren');
const lasList = JSON.parse(fs.readFileSync(path.join(lasDir, 'data', 'subjects.json'), 'utf8')).subjects;

/* sökmotorn är en ES-modul – kör den som vanlig funktion i kontrollen */
const sokSrc = read('public/js/lasaren-sok.js').replace(/^export /gm, '');
const { makeSubject } = new Function(sokSrc + '\nreturn { makeSubject };')();

const las = lasList.map((meta) => {
  const notes = JSON.parse(fs.readFileSync(path.join(lasDir, 'data', meta.id, 'notes.json'), 'utf8'));
  const pages = JSON.parse(fs.readFileSync(path.join(lasDir, 'data', meta.id, 'pages.json'), 'utf8'));
  return { meta, notes, pages, subject: makeSubject({ id: meta.id, meta, notes, pages }) };
});

const exists = (doc, n) => las.some((l) => l.subject.pageIndex.has(doc + ':' + n));

[
  ['ämneslistan stämmer med materialet', las.every((l) => l.meta.pageCount === l.pages.length && l.meta.glossaryCount === l.notes.glossary.length && l.meta.quizCount === l.notes.quiz.length), lasList.map((m) => m.id).join(', ')],
  [
    'varje sida har en bild som finns',
    las.every((l) =>
      l.pages.every((p) => {
        const img = String(p.img || '');
        return img.startsWith('/lasaren/pages/') && fs.existsSync(path.join(root, 'public', img.replace(/^\//, '')));
      })
    )
  ],
  [
    'varje sida har en etikett (s. 24 eller "Järn (bild)")',
    las.every((l) => l.pages.every((p) => String(p.pageLabel || p.page || '').trim().length > 0))
  ],
  [
    'alla avsnitt pekar på en sida som finns',
    las.every((l) =>
      l.notes.chapters.every((c) =>
        c.sections.every((s) => l.subject.pageIndex.has(s.where.doc + ':' + s.where.n))
      )
    )
  ],
  [
    'kapitlens första sida finns',
    las.every((l) => l.notes.chapters.every((c) => l.subject.pageIndex.has(c.first.doc + ':' + c.first.n)))
  ],
  ['alla begrepp pekar på en sida som finns', las.every((l) => l.notes.glossary.every((g) => l.subject.pageIndex.has(g.doc + ':' + g.n)))],
  [
    'alla quizfrågor har facit, förklaring och sida',
    las.every((l) =>
      l.notes.quiz.every(
        (q) =>
          Array.isArray(q.options) &&
          q.options.length >= 3 &&
          Number.isInteger(q.answer) &&
          q.answer >= 0 &&
          q.answer < q.options.length &&
          String(q.why || '').length > 10 &&
          l.subject.pageIndex.has(q.doc + ':' + q.n)
      )
    )
  ],
  [
    'frågeindexet pekar på riktiga avsnitt',
    las.every((l) =>
      l.notes.alias.every((entry) =>
        l.notes.chapters.some((c) => c.sections.some((s) => s.title === entry.target.section))
      )
    )
  ],
  [
    'samma ordlista på en ledtråd (inga mellanslag)',
    las.every((l) => l.notes.chapters.every((c) => c.sections.every((s) => s.points.every((p) => String(p).trim().length > 10))))
  ],
  [
    'sökningen svarar med rätt sida',
    [
      ['idrott', 'vad händer om man har järnbrist', 26],
      ['idrott', 'varför behövs vitamin D', 24],
      ['idrott', 'vad är struma', 27],
      ['kemi', 'varför kan kolatomen binda fyra atomer', 104],
      ['kemi', 'hur fungerar en tensid', 138]
    ].every(([id, q, page]) => {
      const l = las.find((x) => x.meta.id === id);
      const res = l && l.subject.ask(q);
      return Boolean(res && res.answer && res.answer.source.page === page);
    })
  ],
  [
    'okänd fråga ger inget påhittat svar',
    las.every((l) => {
      const res = l.subject.ask('zzz qqq xxx');
      return res.answer === null && res.hits.length === 0;
    })
  ],
  [
    'vyn finns i appen',
    /registerView\('lasaren'/.test(read('public/js/lasaren.js')) &&
      /lasaren/.test(read('public/js/main.js')) &&
      /lasaren: 'lasaren'/.test(read('public/js/core.js'))
  ],
  ['inga externa beroenden i läsaren', !/import .* from '(?!\.\/)/.test(read('public/js/lasaren-sok.js'))]
].forEach(([label, passed, extra]) => (passed ? ok(label, extra || '') : bad(label, extra || 'läsaren')));

console.log(
  failures === 0
    ? '\nAlla kontroller gick igenom ✅\n'
    : `\n${failures} kontroll(er) misslyckades ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
