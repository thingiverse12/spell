/* =====================================================================
   Demoliga för fotboll – används när appen körs utan API-server.
   Samma modell och marknader som serverns demoliga (lib/sports.js).
 *
   ===================================================================== */

const CYCLE_MS = 30 * 60 * 1000; // en ny demomatch var 30:e minut
const MATCH_MINUTES = 105; // 2×45 + paus, i verklig tid
const VISIBLE_BEFORE = 90; // minuter före avspark
const VISIBLE_AFTER = 60; // minuter efter slutsignal

const DEMO_FIXTURES = [
  { home: 'AIK', away: 'Djurgården', league: 'Allsvenskan', country: 'Sverige' },
  { home: 'Malmö FF', away: 'Hammarby', league: 'Allsvenskan', country: 'Sverige' },
  { home: 'IFK Göteborg', away: 'IF Elfsborg', league: 'Allsvenskan', country: 'Sverige' },
  { home: 'BK Häcken', away: 'IFK Norrköping', league: 'Allsvenskan', country: 'Sverige' },
  { home: 'Real Madrid', away: 'Barcelona', league: 'La Liga', country: 'Spanien' },
  { home: 'Manchester City', away: 'Liverpool', league: 'Premier League', country: 'England' },
  { home: 'Arsenal', away: 'Chelsea', league: 'Premier League', country: 'England' },
  { home: 'Bayern München', away: 'Borussia Dortmund', league: 'Bundesliga', country: 'Tyskland' },
  { home: 'Inter', away: 'Juventus', league: 'Serie A', country: 'Italien' },
  { home: 'Paris Saint-Germain', away: 'Marseille', league: 'Ligue 1', country: 'Frankrike' },
  { home: 'Ajax', away: 'PSV', league: 'Eredivisie', country: 'Nederländerna' },
  { home: 'Porto', away: 'Benfica', league: 'Primeira Liga', country: 'Portugal' }
];

const PROB_KEY = { hemma: 'home', oavgjort: 'draw', borta: 'away', over: 'over', under: 'under' };

const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------- sannolikheter ---------------------------- */

function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let fact = 1;
  for (let i = 2; i <= k; i += 1) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

function expectedGoals(team, salt) {
  const r = mulberry32(hash32(team + '|' + salt));
  return 0.75 + r() * 1.15;
}

/** Målchanser för hemmalag/bortalag utifrån läget i matchen. */
function rateOf(match, untilMinute) {
  const left = clamp(((untilMinute === undefined ? 90 : untilMinute) - (match.minute || 0)) / 90, 0, 1);
  return {
    lh: expectedGoals(match.home, 'hemma') * left,
    la: expectedGoals(match.away, 'borta') * left
  };
}

/** Sannolikheter för alla marknader utifrån ställning och minut. */
function probabilities(match) {
  const hs0 = match.homeScore || 0;
  const as0 = match.awayScore || 0;

  if (match.status === 'finished') {
    const total = hs0 + as0;
    return {
      home: hs0 > as0 ? 1 : 0,
      draw: hs0 === as0 ? 1 : 0,
      away: as0 > hs0 ? 1 : 0,
      over: total > 2.5 ? 1 : 0,
      under: total > 2.5 ? 0 : 1,
      bttsYes: hs0 > 0 && as0 > 0 ? 1 : 0,
      bttsNo: hs0 > 0 && as0 > 0 ? 0 : 1,
      hcpHome: hs0 - as0 > 1 ? 1 : 0,
      hcpAway: hs0 - as0 > 1 ? 0 : 1,
      nextHome: 0,
      nextNone: 0,
      nextAway: 0
    };
  }

  const { lh, la } = rateOf(match);
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pOver = 0;
  let pHomeMinus = 0;
  for (let i = 0; i <= 7; i += 1) {
    const pi = poissonPmf(i, lh);
    for (let j = 0; j <= 7; j += 1) {
      const p = pi * poissonPmf(j, la);
      if (!p) continue;
      const hs = hs0 + i;
      const as = as0 + j;
      if (hs > as) pHome += p;
      else if (hs === as) pDraw += p;
      else pAway += p;
      if (hs + as >= 3) pOver += p;
      if (hs - as >= 2) pHomeMinus += p;
    }
  }
  const sum = pHome + pDraw + pAway || 1;

  // Båda lagen gör mål: ett lag som redan har mål är klart.
  const pNoMoreHome = Math.exp(-lh);
  const pNoMoreAway = Math.exp(-la);
  const pHomeScores = hs0 > 0 ? 1 : 1 - pNoMoreHome;
  const pAwayScores = as0 > 0 ? 1 : 1 - pNoMoreAway;
  const pBtts = pHomeScores * pAwayScores;

  // Nästa mål: vem gör det nästa, om något.
  const totalRate = lh + la;
  const pNoMore = Math.exp(-totalRate);
  const shareHome = totalRate > 0 ? lh / totalRate : 0.5;
  const pNextHome = (1 - pNoMore) * shareHome;
  const pNextAway = (1 - pNoMore) * (1 - shareHome);

  return {
    home: pHome / sum,
    draw: pDraw / sum,
    away: pAway / sum,
    over: clamp(pOver, 0, 1),
    under: clamp(1 - pOver, 0, 1),
    bttsYes: clamp(pBtts, 0, 1),
    bttsNo: clamp(1 - pBtts, 0, 1),
    hcpHome: clamp(pHomeMinus, 0, 1),
    hcpAway: clamp(1 - pHomeMinus, 0, 1),
    nextHome: clamp(pNextHome, 0, 1),
    nextAway: clamp(pNextAway, 0, 1),
    nextNone: clamp(pNoMore, 0, 1)
  };
}

/** Halvtidsresultat: modell för första halvlek. */
function halfTimeProbabilities(match) {
  const until = 45;
  const left = clamp((until - (match.minute || 0)) / 90, 0, 1);
  const lh = expectedGoals(match.home, 'hemma') * left;
  const la = expectedGoals(match.away, 'borta') * left;
  const hs0 = match.homeScore || 0;
  const as0 = match.awayScore || 0;
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  for (let i = 0; i <= 6; i += 1) {
    const pi = poissonPmf(i, lh);
    for (let j = 0; j <= 6; j += 1) {
      const p = pi * poissonPmf(j, la);
      if (!p) continue;
      const hs = hs0 + i;
      const as = as0 + j;
      if (hs > as) pHome += p;
      else if (hs === as) pDraw += p;
      else pAway += p;
    }
  }
  const sum = pHome + pDraw + pAway || 1;
  return { home: pHome / sum, draw: pDraw / sum, away: pAway / sum };
}

function price(prob, margin) {
  const cut = 1 - clamp(Number(margin) || 0, 0, 25) / 100;
  const p = clamp(Number(prob) || 0, 0.025, 1);
  return Math.max(1.01, Math.min(40, round2(cut / p)));
}

const MARKETS = [
  {
    key: '1x2',
    label: 'Matchresultat',
    short: '1X2',
    selections: [
      { key: 'hemma', label: '1', long: 'Hemma' },
      { key: 'oavgjort', label: 'X', long: 'Oavgjort' },
      { key: 'borta', label: '2', long: 'Borta' }
    ]
  },
  {
    key: 'mal',
    label: 'Mål – över/under 2,5',
    short: 'Ö/U 2,5',
    selections: [
      { key: 'over', label: 'Över 2,5', long: 'Över 2,5 mål' },
      { key: 'under', label: 'Under 2,5', long: 'Under 2,5 mål' }
    ]
  },
  {
    key: 'btts',
    label: 'Båda lagen gör mål',
    short: 'BLGM',
    selections: [
      { key: 'ja', label: 'Ja', long: 'Båda lagen gör mål' },
      { key: 'nej', label: 'Nej', long: 'Inte båda lagen gör mål' }
    ]
  },
  {
    key: 'handicap',
    label: 'Handikapp (−1 / +1)',
    short: 'HCP',
    selections: [
      { key: 'hemma-1', label: 'Hemma −1', long: 'Hemma med handikapp −1' },
      { key: 'borta+1', label: 'Borta +1', long: 'Borta med handikapp +1' }
    ]
  },
  {
    key: 'ht',
    label: 'Halvtidsresultat',
    short: 'HT',
    selections: [
      { key: 'ht-hemma', label: '1', long: 'Hemma leder i paus' },
      { key: 'ht-oavgjort', label: 'X', long: 'Oavgjort i paus' },
      { key: 'ht-borta', label: '2', long: 'Borta leder i paus' }
    ]
  },
  {
    key: 'next',
    label: 'Nästa mål',
    short: 'NÄSTA',
    selections: [
      { key: 'next-hemma', label: 'Hemma', long: 'Hemma gör nästa mål' },
      { key: 'next-inget', label: 'Inget', long: 'Inga fler mål' },
      { key: 'next-borta', label: 'Borta', long: 'Borta gör nästa mål' }
    ]
  }
];

function buildMarkets(match, margin, liveOdds) {
  const probs = probabilities(match);
  const htProbs = halfTimeProbabilities(match);
  const finish = match.status === 'finished';

  // Vissa marknader är bara öppna i vissa skeden.
  const htOpen = !finish && (match.minute || 0) < 45 && !match.htScore;
  const nextOpen = !finish && (match.live || (match.minute || 0) > 0);
  const available = { ht: htOpen, next: nextOpen };

  return MARKETS.filter((market) => available[market.key] !== false).map((market) => ({
    key: market.key,
    label: market.label,
    short: market.short,
    selections: market.selections.map((sel) => {
      let odds;
      const real = liveOdds && liveOdds[market.key] && liveOdds[market.key][sel.key];
      if (Number.isFinite(real) && real > 1.01) {
        odds = round2(real);
      } else {
        let p;
        if (market.key === 'ht') {
          p = sel.key === 'ht-hemma' ? htProbs.home : sel.key === 'ht-oavgjort' ? htProbs.draw : htProbs.away;
        } else if (market.key === 'next') {
          p = sel.key === 'next-hemma' ? probs.nextHome : sel.key === 'next-inget' ? probs.nextNone : probs.nextAway;
        } else if (market.key === 'handicap') {
          p = sel.key === 'hemma-1' ? probs.hcpHome : probs.hcpAway;
        } else if (market.key === 'btts') {
          p = sel.key === 'ja' ? probs.bttsYes : probs.bttsNo;
        } else {
          p = probs[PROB_KEY[sel.key]];
        }
        odds = price(p, margin);
      }
      if (finish) odds = 1;
      return { key: sel.key, label: sel.label, long: sel.long, odds };
    })
  }));
}

/* ------------------------------ demomatch ------------------------------ */

function demoGoals(slot) {
  const rnd = mulberry32(hash32('mal-' + slot));
  const roll = rnd();
  const total = roll < 0.08 ? 0 : roll < 0.26 ? 1 : roll < 0.48 ? 2 : roll < 0.7 ? 3 : roll < 0.86 ? 4 : 5;
  const goals = [];
  for (let i = 0; i < total; i += 1) {
    let minute = 1 + Math.floor(rnd() * 96);
    if (minute > 44 && minute < 59) minute = 44; // inga mål i pausen
    goals.push({ minute, side: rnd() < 0.54 ? 'home' : 'away' });
  }
  return goals.sort((a, b) => a.minute - b.minute);
}

function demoMatch(slot, now, margin) {
  const fixture = DEMO_FIXTURES[((slot % DEMO_FIXTURES.length) + DEMO_FIXTURES.length) % DEMO_FIXTURES.length];
  const kickoff = slot * CYCLE_MS;
  const wall = (now - kickoff) / 60000;
  const goals = demoGoals(slot);

  let status = 'upcoming';
  let minute = 0;
  if (wall >= MATCH_MINUTES) {
    status = 'finished';
    minute = 90;
  } else if (wall >= 0) {
    status = 'live';
    minute = wall <= 45 ? Math.max(1, Math.ceil(wall)) : Math.min(90, Math.ceil(wall - 15));
  }

  const played = status === 'upcoming' ? 0 : status === 'finished' ? 999 : minute;
  const homeScore = goals.filter((g) => g.side === 'home' && g.minute <= played).length;
  const awayScore = goals.filter((g) => g.side === 'away' && g.minute <= played).length;
  const htHome = goals.filter((g) => g.side === 'home' && g.minute <= 45).length;
  const htAway = goals.filter((g) => g.side === 'away' && g.minute <= 45).length;
  const htKnown = status === 'finished' || minute >= 45;

  const base = {
    id: 'demo-' + slot,
    home: fixture.home,
    away: fixture.away,
    league: fixture.league,
    country: fixture.country,
    homeScore,
    awayScore,
    minute,
    status,
    kickoff,
    live: status === 'live',
    htScore: htKnown ? { home: htHome, away: htAway } : null,
    goals: goals.map((g) => ({ minute: g.minute, side: g.side }))
  };

  return {
    id: base.id,
    league: base.league,
    country: base.country,
    home: base.home,
    away: base.away,
    homeScore,
    awayScore,
    minute,
    status,
    kickoff,
    live: base.live,
    htScore: base.htScore,
    goals: base.goals,
    result: status === 'finished' ? { home: homeScore, away: awayScore } : null,
    markets: buildMarkets(base, margin),
    source: 'demo'
  };
}

function demoFeed(now, margin) {
  const first = Math.floor((now - (MATCH_MINUTES + VISIBLE_AFTER) * 60000) / CYCLE_MS);
  const last = Math.ceil((now + VISIBLE_BEFORE * 60000) / CYCLE_MS);
  const matches = [];
  for (let slot = first; slot <= last; slot += 1) matches.push(demoMatch(slot, now, margin));
  return sortMatches(matches);
}

function sortMatches(matches) {
  const order = { live: 0, upcoming: 1, finished: 2 };
  return matches.sort((a, b) => order[a.status] - order[b.status] || a.kickoff - b.kickoff);
}

/* ------------------------------ avräkning ------------------------------ */

/**
 * Avgör ett spel mot en färdigspelad match.
 * @returns {'won'|'lost'|'void'|null} null = matchen är inte avgjord än.
 */
function decideOutcome(match, bet) {
  if (!match || match.status !== 'finished' || !match.result) return null;
  const hs = match.result.home;
  const as = match.result.away;
  const market = bet.market;
  const sel = bet.selection;

  if (market === '1x2') {
    if (sel === 'hemma') return hs > as ? 'won' : 'lost';
    if (sel === 'oavgjort') return hs === as ? 'won' : 'lost';
    if (sel === 'borta') return as > hs ? 'won' : 'lost';
    return 'void';
  }
  if (market === 'mal') {
    if (sel === 'over') return hs + as > 2.5 ? 'won' : 'lost';
    if (sel === 'under') return hs + as < 2.5 ? 'won' : 'lost';
    return 'void';
  }
  if (market === 'btts') {
    const both = hs > 0 && as > 0;
    if (sel === 'ja') return both ? 'won' : 'lost';
    if (sel === 'nej') return both ? 'lost' : 'won';
    return 'void';
  }
  if (market === 'handicap') {
    if (sel === 'hemma-1') {
      if (hs - 1 > as) return 'won';
      if (hs - 1 === as) return 'void';
      return 'lost';
    }
    if (sel === 'borta+1') {
      if (as + 1 > hs) return 'won';
      if (as + 1 === hs) return 'void';
      return 'lost';
    }
    return 'void';
  }
  if (market === 'ht') {
    if (!match.htScore) return 'void';
    const h = match.htScore.home;
    const a = match.htScore.away;
    if (sel === 'ht-hemma') return h > a ? 'won' : 'lost';
    if (sel === 'ht-oavgjort') return h === a ? 'won' : 'lost';
    if (sel === 'ht-borta') return a > h ? 'won' : 'lost';
    return 'void';
  }
  if (market === 'next') {
    const fromHome = Number(bet.homeScoreAtBet);
    const fromAway = Number(bet.awayScoreAtBet);
    const hasSnapshot = Number.isFinite(fromHome) && Number.isFinite(fromAway);
    if (hasSnapshot && Array.isArray(match.goals) && match.goals.length > 0) {
      // Första målet efter spelögonblicket avgör marknaden.
      const later = match.goals
        .filter((g) => Number.isFinite(g.minute) && g.minute > (bet.minuteAtBet || 0))
        .sort((a, b) => a.minute - b.minute);
      if (!later.length) return sel === 'next-inget' ? 'won' : 'lost';
      const first = later[0].side;
      if (sel === 'next-inget') return 'lost';
      return (sel === 'next-hemma' && first === 'home') || (sel === 'next-borta' && first === 'away')
        ? 'won'
        : 'lost';
    }
    if (!hasSnapshot) return 'void';
    const dh = hs - fromHome;
    const da = as - fromAway;
    if (dh === 0 && da === 0) return sel === 'next-inget' ? 'won' : 'lost';
    if (dh > 0 && da === 0) return sel === 'next-hemma' ? 'won' : 'lost';
    if (da > 0 && dh === 0) return sel === 'next-borta' ? 'won' : 'lost';
    return 'void';
  }
  return 'void';
}

function marketLabel(market, selection) {
  const m = MARKETS.find((x) => x.key === market);
  if (!m) return market + ' ' + selection;
  const sel = m.selections.find((s) => s.key === selection);
  return m.label + ': ' + (sel ? sel.long : selection);
}

export { demoFeed, decideOutcome, marketLabel, MARKETS, probabilities };
