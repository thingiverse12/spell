/* =====================================================================
   Demoliga för fotboll – används när appen körs utan API-server.
   Samma upplägg som serverns demoliga: en ny match var 30:e minut,
   scriptade mål och odds från en Poisson-modell som rör sig live.
   ===================================================================== */

const CYCLE_MS = 30 * 60 * 1000;
const MATCH_MINUTES = 105;
const VISIBLE_BEFORE = 90;
const VISIBLE_AFTER = 60;

const FIXTURES = [
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

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round2 = (n) => Math.round(n * 100) / 100;

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

function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let fact = 1;
  for (let i = 2; i <= k; i += 1) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

function expectedGoals(team, salt) {
  return 0.75 + mulberry32(hash32(team + '|' + salt))() * 1.15;
}

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
      under: total > 2.5 ? 0 : 1
    };
  }
  const left = clamp((90 - (match.minute || 0)) / 90, 0, 1);
  const lh = expectedGoals(match.home, 'hemma') * left;
  const la = expectedGoals(match.away, 'borta') * left;
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pOver = 0;
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
    }
  }
  const sum = pHome + pDraw + pAway || 1;
  return { home: pHome / sum, draw: pDraw / sum, away: pAway / sum, over: pOver, under: 1 - pOver };
}

const PROB_KEY = { hemma: 'home', oavgjort: 'draw', borta: 'away', over: 'over', under: 'under' };

function price(prob, margin) {
  const cut = 1 - clamp(Number(margin) || 0, 0, 25) / 100;
  const p = clamp(Number(prob) || 0, 0.025, 1);
  return Math.max(1.01, Math.min(40, round2(cut / p)));
}

const MARKETS = [
  {
    key: '1x2',
    label: 'Matchresultat',
    selections: [
      { key: 'hemma', label: '1', long: 'Hemma' },
      { key: 'oavgjort', label: 'X', long: 'Oavgjort' },
      { key: 'borta', label: '2', long: 'Borta' }
    ]
  },
  {
    key: 'mal',
    label: 'Mål – över/under 2,5',
    selections: [
      { key: 'over', label: 'Över 2,5', long: 'Över 2,5 mål' },
      { key: 'under', label: 'Under 2,5', long: 'Under 2,5 mål' }
    ]
  }
];

function buildMarkets(match, margin) {
  const probs = probabilities(match);
  return MARKETS.map((market) => ({
    key: market.key,
    label: market.label,
    selections: market.selections.map((sel) => ({
      key: sel.key,
      label: sel.label,
      long: sel.long,
      odds: match.status === 'finished' ? 1 : price(probs[PROB_KEY[sel.key]], margin)
    }))
  }));
}

function goalsFor(slot) {
  const rnd = mulberry32(hash32('mal-' + slot));
  const roll = rnd();
  const total = roll < 0.08 ? 0 : roll < 0.26 ? 1 : roll < 0.48 ? 2 : roll < 0.7 ? 3 : roll < 0.86 ? 4 : 5;
  const goals = [];
  for (let i = 0; i < total; i += 1) {
    let minute = 1 + Math.floor(rnd() * 96);
    if (minute > 44 && minute < 59) minute = 44;
    goals.push({ minute, side: rnd() < 0.54 ? 'home' : 'away' });
  }
  return goals.sort((a, b) => a.minute - b.minute);
}

function matchAt(slot, now, margin) {
  const fixture = FIXTURES[((slot % FIXTURES.length) + FIXTURES.length) % FIXTURES.length];
  const kickoff = slot * CYCLE_MS;
  const wall = (now - kickoff) / 60000;
  const goals = goalsFor(slot);

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

  const match = {
    id: 'demo-' + slot,
    league: fixture.league,
    country: fixture.country,
    home: fixture.home,
    away: fixture.away,
    homeScore,
    awayScore,
    minute,
    status,
    kickoff,
    live: status === 'live',
    result: status === 'finished' ? { home: homeScore, away: awayScore } : null,
    source: 'demo'
  };
  match.markets = buildMarkets(match, margin);
  return match;
}

export function demoFeed(now = Date.now(), margin = 6) {
  const first = Math.floor((now - (MATCH_MINUTES + VISIBLE_AFTER) * 60000) / CYCLE_MS);
  const last = Math.ceil((now + VISIBLE_BEFORE * 60000) / CYCLE_MS);
  const matches = [];
  for (let slot = first; slot <= last; slot += 1) matches.push(matchAt(slot, now, margin));
  const order = { live: 0, upcoming: 1, finished: 2 };
  return matches.sort((a, b) => order[a.status] - order[b.status] || a.kickoff - b.kickoff);
}

export function outcomeOf(match, market, selection) {
  if (!match || match.status !== 'finished' || !match.result) return null;
  const hs = match.result.home;
  const as = match.result.away;
  if (market === '1x2') {
    if (selection === 'hemma') return hs > as;
    if (selection === 'oavgjort') return hs === as;
    if (selection === 'borta') return as > hs;
    return null;
  }
  if (market === 'mal') {
    if (selection === 'over') return hs + as > 2.5;
    if (selection === 'under') return hs + as < 2.5;
    return null;
  }
  return null;
}
