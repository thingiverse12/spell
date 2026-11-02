'use strict';

/**
 * Fotbollsmodul: live-odds och matchdata.
 *
 * Två lägen:
 *  1. "allsportsapi" – riktig data från AllSportsAPI (REST) när en API-nyckel finns
 *     (env ALLSPORTS_API_KEY / SPORTS_API_KEY eller admin-inställning).
 *  2. "demo" – en inbyggd demoliga så att vyn alltid fungerar, även utan nyckel.
 *
 * Oddsen räknas av huset med en Poisson-modell om matchen saknar riktiga odds.
 * Modellen tar hänsyn till ställning och återstående tid, så oddsen rör sig live.
 */

const CYCLE_MS = 30 * 60 * 1000; // en ny demomatch var 30:e minut
const MATCH_MINUTES = 105; // 2×45 + paus, i verklig tid
const VISIBLE_BEFORE = 90; // minuter före avspark
const VISIBLE_AFTER = 60; // minuter efter slutsignal
const CACHE_MS = 15000;
const API_TIMEOUT_MS = 8000;

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

const PROB_KEYS = { hemma: 'home', oavgjort: 'draw', borta: 'away', over: 'over', under: 'under' };

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
  return 0.75 + r() * 1.15; // 0,75–1,90 mål per match
}

/** Sannolikheter för 1X2 och över/under 2,5 mål utifrån läget i matchen. */
function probabilities({ home, away, homeScore = 0, awayScore = 0, minute = 0, finished = false }) {
  if (finished) {
    const total = homeScore + awayScore;
    return {
      home: homeScore > awayScore ? 1 : 0,
      draw: homeScore === awayScore ? 1 : 0,
      away: awayScore > homeScore ? 1 : 0,
      over: total > 2.5 ? 1 : 0,
      under: total > 2.5 ? 0 : 1
    };
  }
  const left = clamp((90 - minute) / 90, 0, 1);
  const lh = expectedGoals(home, 'hemma') * left;
  const la = expectedGoals(away, 'borta') * left;

  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pOver = 0;
  for (let i = 0; i <= 7; i += 1) {
    const pi = poissonPmf(i, lh);
    for (let j = 0; j <= 7; j += 1) {
      const p = pi * poissonPmf(j, la);
      if (p === 0) continue;
      const hs = homeScore + i;
      const as = awayScore + j;
      if (hs > as) pHome += p;
      else if (hs === as) pDraw += p;
      else pAway += p;
      if (hs + as >= 3) pOver += p;
    }
  }
  const sum = pHome + pDraw + pAway || 1;
  return {
    home: pHome / sum,
    draw: pDraw / sum,
    away: pAway / sum,
    over: clamp(pOver, 0, 1),
    under: clamp(1 - pOver, 0, 1)
  };
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
  }
];

function buildMarkets(match, margin, liveOdds) {
  const probs = probabilities(match);
  return MARKETS.map((market) => ({
    key: market.key,
    label: market.label,
    short: market.short,
    selections: market.selections.map((sel) => {
      let odds;
      const real = liveOdds && liveOdds[market.key] && liveOdds[market.key][sel.key];
      if (Number.isFinite(real) && real > 1.01) odds = round2(real);
      else odds = price(probs[PROB_KEYS[sel.key] || sel.key], margin);
      if (match.status === 'finished') odds = 1;
      return { key: sel.key, label: sel.label, long: sel.long, odds };
    })
  }));
}

/* ------------------------------ demoligan ------------------------------ */

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

  const played = (m) => (status === 'upcoming' ? 0 : status === 'finished' ? 999 : m);
  const homeScore = goals.filter((g) => g.side === 'home' && g.minute <= played(minute)).length;
  const awayScore = goals.filter((g) => g.side === 'away' && g.minute <= played(minute)).length;

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
    finished: status === 'finished',
    live: status === 'live'
  };
  const markets = buildMarkets(base, margin);
  return {
    id: base.id,
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
    markets,
    source: 'demo'
  };
}

function demoFeed(now, margin) {
  const first = Math.floor((now - (MATCH_MINUTES + VISIBLE_AFTER) * 60000) / CYCLE_MS);
  const last = Math.ceil((now + VISIBLE_BEFORE * 60000) / CYCLE_MS);
  const matches = [];
  for (let slot = first; slot <= last; slot += 1) matches.push(demoMatch(slot, now, margin));
  matches.sort((a, b) => {
    const order = { live: 0, upcoming: 1, finished: 2 };
    return order[a.status] - order[b.status] || a.kickoff - b.kickoff;
  });
  return matches;
}

/* ---------------------------- AllSportsAPI ---------------------------- */

function toNumber(value) {
  const n = Number(String(value == null ? '' : value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseScoreSafe(str) {
  const m = String(str || '').match(/(\d+)\s*[-\u2013]\s*(\d+)/);
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
}

function normalizeApiEvent(raw, now, margin) {
  const id = String(raw.event_key || raw.match_id || '');
  if (!id) return null;
  const final = parseScoreSafe(raw.event_final_result) || parseScoreSafe(raw.event_ft_result);
  const statusText = String(raw.event_status || '').trim();
  const minuteNum = Number.parseInt(statusText, 10);
  const isLive = String(raw.event_live) === '1' || (Number.isFinite(minuteNum) && minuteNum > 0 && minuteNum <= 120);
  const ended = /^(ft|aet|pen|finished|ended|full)/i.test(statusText) || (!isLive && !!final && !!raw.event_ft_result);

  const dateStr = String(raw.event_date || '');
  const timeStr = String(raw.event_time || '00:00');
  const kickoff = Date.parse(dateStr + 'T' + (timeStr.length === 5 ? timeStr : '00:00') + ':00') || now;

  let status = 'upcoming';
  let minute = 0;
  if (ended) {
    status = 'finished';
    minute = 90;
  } else if (isLive) {
    status = 'live';
    minute = Number.isFinite(minuteNum) ? clamp(minuteNum, 1, 90) : 1;
  } else if (kickoff + MATCH_MINUTES * 60000 < now && final) {
    status = 'finished';
    minute = 90;
  }

  const homeScore = final ? final.home : 0;
  const awayScore = final ? final.away : 0;

  const apiOdds = {
    '1x2': {
      hemma: toNumber(raw.odds_1 || raw.odds_home),
      oavgjort: toNumber(raw.odds_x || raw.odds_draw),
      borta: toNumber(raw.odds_2 || raw.odds_away)
    },
    mal: {
      over: toNumber(raw.odds_over || raw.odds_o25),
      under: toNumber(raw.odds_under || raw.odds_u25)
    }
  };

  const base = {
    id: 'api-' + id,
    home: String(raw.event_home_team || 'Hemmalag'),
    away: String(raw.event_away_team || 'Bortalag'),
    league: String(raw.league_name || 'Fotboll'),
    country: String(raw.country_name || ''),
    homeScore,
    awayScore,
    minute,
    status,
    kickoff,
    finished: status === 'finished',
    live: status === 'live'
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
    result: status === 'finished' ? { home: homeScore, away: awayScore } : null,
    markets: buildMarkets(base, margin, apiOdds),
    source: 'allsportsapi'
  };
}

async function fetchJson(url, fetchImpl) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), API_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, { signal: controller ? controller.signal : undefined });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isoDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

async function allSportsFeed(apiKey, now, margin, fetchImpl) {
  const base = 'https://apiv2.allsportsapi.com/football/';
  const key = encodeURIComponent(apiKey);
  const tz = 'Europe/Stockholm';
  const urls = [
    `${base}?met=Livescore&APIkey=${key}&timezone=${encodeURIComponent(tz)}`,
    `${base}?met=Fixtures&from=${isoDate(0)}&to=${isoDate(2)}&APIkey=${key}&timezone=${encodeURIComponent(tz)}`
  ];
  const results = await Promise.all(
    urls.map((url) =>
      fetchJson(url, fetchImpl).catch((err) => {
        console.error('AllSportsAPI:', err.message);
        return null;
      })
    )
  );

  const events = [];
  results.forEach((data) => {
    if (!data) return;
    if (Array.isArray(data.result)) events.push(...data.result);
    else if (Array.isArray(data.data)) events.push(...data.data);
  });

  const seen = new Set();
  const matches = [];
  events.forEach((raw) => {
    const match = normalizeApiEvent(raw, now, margin);
    if (!match || seen.has(match.id)) return;
    seen.add(match.id);
    // Behåll live, kommande och nyligen avslutade matcher.
    if (match.status === 'finished' && now - match.kickoff > 12 * 60 * 60 * 1000) return;
    if (match.status === 'upcoming' && match.kickoff - now > 3 * 24 * 60 * 60 * 1000) return;
    matches.push(match);
  });

  if (!matches.length) throw new Error('Inga matcher i svaret');

  matches.sort((a, b) => {
    const order = { live: 0, upcoming: 1, finished: 2 };
    return order[a.status] - order[b.status] || a.kickoff - b.kickoff;
  });
  return matches;
}

/* ------------------------------- cache ------------------------------- */

let cache = { key: null, at: 0, payload: null };

function resolveApiKey(options) {
  return String(
    (options.apiKey || process.env.ALLSPORTS_API_KEY || process.env.SPORTS_API_KEY || '') + ''
  ).trim();
}

/**
 * Hämtar matcher + odds. Faller alltid tillbaka på demoligan.
 * @returns {Promise<{source, matches, updatedAt, error, apiKeySet}>}
 */
async function getFeed(options = {}) {
  const now = options.now || Date.now();
  const margin = Number.isFinite(Number(options.margin)) ? Number(options.margin) : 6;
  const apiKey = resolveApiKey(options);
  const fetchImpl = options.fetch || globalThis.fetch;
  const cacheKey = apiKey ? 'api:' + apiKey.slice(-6) + ':' + margin : 'demo:' + margin;

  if (cache.payload && cache.key === cacheKey && now - cache.at < CACHE_MS) return cache.payload;

  let payload = null;
  if (apiKey && typeof fetchImpl === 'function') {
    try {
      const matches = await allSportsFeed(apiKey, now, margin, fetchImpl);
      payload = { source: 'allsportsapi', matches, updatedAt: Date.now(), error: null, apiKeySet: true };
    } catch (err) {
      payload = null;
      console.error('AllSportsAPI misslyckades:', err.message);
    }
    if (!payload) {
      payload = {
        source: 'demo',
        matches: demoFeed(now, margin),
        updatedAt: Date.now(),
        error: 'Kunde inte nå AllSportsAPI – visar demoligan',
        apiKeySet: true
      };
    }
  } else {
    payload = {
      source: 'demo',
      matches: demoFeed(now, margin),
      updatedAt: Date.now(),
      error: null,
      apiKeySet: !!apiKey
    };
  }

  cache = { key: cacheKey, at: now, payload };
  return payload;
}

function resetCache() {
  cache = { key: null, at: 0, payload: null };
}

/** Avgör om en satsning vunnit. */
function outcomeOf(match, market, selection) {
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

function marketLabel(market, selection) {
  const m = MARKETS.find((x) => x.key === market);
  if (!m) return market + ' ' + selection;
  const sel = m.selections.find((s) => s.key === selection);
  return m.label + ': ' + (sel ? sel.long : selection);
}

module.exports = {
  getFeed,
  resetCache,
  outcomeOf,
  marketLabel,
  probabilities,
  demoFeed,
  MARKETS,
  MATCH_MINUTES
};
