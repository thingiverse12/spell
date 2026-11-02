'use strict';

/**
 * Fotbollsmodul: live-odds och matchdata.
 *
 * Datakällor, i prioritetsordning (första som ger matcher vinner):
 *  1. allsportsapi  – AllSportsAPI med API-nyckel (admin eller env).
 *  2. thesportsdb   – TheSportsDB, öppen demo-nyckel "3", global livescore.
 *  3. openligadb    – OpenLigaDB, helt öppen (Bundesliga 1 & 2), riktiga mål.
 *  4. demo          – inbyggd demoliga, fungerar alltid offline.
 *
 * Oddsen räknas av huset med en Poisson-modell utifrån ställning och
 * återstående tid, så de rör sig live. Marginalen ställs in i adminpanelen.
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

/* ------------------------------ hjälpare ------------------------------ */

function toNumber(value) {
  const n = Number(String(value == null ? '' : value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseScore(str) {
  const m = String(str || '').match(/(\d+)\s*[-\u2013]\s*(\d+)/);
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
}

async function fetchJson(url, fetchImpl) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), API_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, {
      signal: controller ? controller.signal : undefined,
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (compatible; GoldenSpade/1.0; +https://plugghornan.vercel.app)'
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data && data.Message) throw new Error(String(data.Message).slice(0, 120));
    if (data && data.error) {
      const msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error).slice(0, 120);
      throw new Error(msg);
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isoDate(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

/* ---------------------------- AllSportsAPI ---------------------------- */

function normalizeAllSports(raw, now, margin) {
  const id = String(raw.event_key || raw.match_id || '');
  if (!id) return null;
  const final = parseScore(raw.event_final_result) || parseScore(raw.event_ft_result);
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

  const ht = parseScore(raw.event_halftime_result);
  const base = {
    id: 'api-' + id,
    home: String(raw.event_home_team || 'Hemmalag'),
    away: String(raw.event_away_team || 'Bortalag'),
    league: String(raw.league_name || 'Fotboll'),
    country: String(raw.country_name || ''),
    homeScore: final ? final.home : 0,
    awayScore: final ? final.away : 0,
    minute,
    status,
    kickoff,
    live: status === 'live',
    htScore: ht
  };

  const apiOdds = {
    '1x2': {
      hemma: toNumber(raw.odds_1 || raw.odds_home),
      oavgjort: toNumber(raw.odds_x || raw.odds_draw),
      borta: toNumber(raw.odds_2 || raw.odds_away)
    }
  };

  return {
    ...base,
    result: status === 'finished' ? { home: base.homeScore, away: base.awayScore } : null,
    markets: buildMarkets(base, margin, apiOdds),
    source: 'allsportsapi'
  };
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
    const match = normalizeAllSports(raw, now, margin);
    if (!match || seen.has(match.id)) return;
    seen.add(match.id);
    if (match.status === 'finished' && now - match.kickoff > 12 * 3600 * 1000) return;
    if (match.status === 'upcoming' && match.kickoff - now > 3 * 86400 * 1000) return;
    matches.push(match);
  });
  if (!matches.length) throw new Error('Inga matcher i svaret');
  return sortMatches(matches);
}

/* ------------------------------ FotMob ------------------------------ */
/* FotMobs publika JSON-API: globala matcher med live-resultat, ingen nyckel. */

const pad2 = (n) => String(n).padStart(2, '0');

function fotmobScore(side) {
  if (!side) return 0;
  const v = Number(side.score);
  return Number.isFinite(v) ? v : 0;
}

async function fotmobFeed(now, margin, fetchImpl) {
  const d = new Date(now);
  const ymd = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
  const data = await fetchJson(`https://www.fotmob.com/api/matches?date=${ymd}`, fetchImpl);

  const leagues = Array.isArray(data.leagues) ? data.leagues : [];
  const matches = [];
  leagues.forEach((league) => {
    (league.matches || []).forEach((raw) => {
      const status = raw.status || {};
      if (status.cancelled) return;
      const kickoff = Number(status.utcTime) ? Number(status.utcTime) * 1000 : Date.parse(raw.status && raw.status.utcTime) || now;
      if (kickoff < now - 8 * 3600 * 1000 || kickoff > now + 3 * 86400 * 1000) return;

      let matchStatus = 'upcoming';
      if (status.finished) matchStatus = 'finished';
      else if (status.started) matchStatus = 'live';

      let minute = 0;
      if (matchStatus === 'live') {
        const fromReason = Number.parseInt(String((status.reason && status.reason.short) || '').replace(/[^0-9]/g, ''), 10);
        const fromClock = Number.parseInt(String(status.liveTime && status.liveTime.short || '').replace(/[^0-9]/g, ''), 10);
        minute = clamp(fromReason || fromClock || 1, 1, 90);
      } else if (matchStatus === 'finished') {
        minute = 90;
      }

      const homeName = (raw.home && (raw.home.name || raw.home.longName)) || 'Hemmalag';
      const awayName = (raw.away && (raw.away.name || raw.away.longName)) || 'Bortalag';
      const base = {
        id: 'fotmob-' + raw.id,
        home: homeName,
        away: awayName,
        league: league.name || 'Fotboll',
        country: league.ccode === 'SWE' ? 'Sverige' : '',
        homeScore: fotmobScore(raw.home),
        awayScore: fotmobScore(raw.away),
        minute,
        status: matchStatus,
        kickoff,
        live: matchStatus === 'live',
        htScore: null
      };
      matches.push({
        ...base,
        result: matchStatus === 'finished' ? { home: base.homeScore, away: base.awayScore } : null,
        markets: buildMarkets(base, margin),
        source: 'fotmob'
      });
    });
  });

  if (!matches.length) throw new Error('Inga matcher i svaret');
  return sortMatches(matches);
}

/* ------------------------------- ESPN ------------------------------- */
/* ESPN:s publika API kräver ingen nyckel och har live-matcher,
   halvtidsresultat (linescores) och måltider. */

const ESPN_LEAGUES = [
  ['swe.1', 'Allsvenskan', 'Sverige'],
  ['eng.1', 'Premier League', 'England'],
  ['esp.1', 'La Liga', 'Spanien'],
  ['ger.1', 'Bundesliga', 'Tyskland'],
  ['ita.1', 'Serie A', 'Italien'],
  ['fra.1', 'Ligue 1', 'Frankrike'],
  ['uefa.champions', 'Champions League', 'Europa']
];

function espnSide(competition, homeAway) {
  const list = (competition && competition.competitors) || [];
  return list.find((c) => c.homeAway === homeAway) || null;
}

function espnGoals(competition, homeId, awayId) {
  const details = (competition && competition.details) || [];
  const goals = [];
  details.forEach((d) => {
    const isGoal =
      d.scoringPlay === true ||
      /goal|mål|penalty|own/i.test(String((d.type && d.type.text) || '')) ||
      (d.scoreValue !== undefined && d.scoreValue !== null && d.scoreValue !== 0 && !!d.team);
    if (!isGoal) return;
    const clock = d.clock && (d.clock.displayValue || d.clock.value);
    const minute = Number.parseInt(String(clock || '').replace(/[^0-9]/g, ''), 10);
    const teamId = d.team && d.team.id;
    if (!Number.isFinite(minute) || !teamId) return;
    goals.push({ minute, side: teamId === homeId ? 'home' : teamId === awayId ? 'away' : null });
  });
  return goals.filter((g) => g.side).sort((a, b) => a.minute - b.minute);
}

async function espnFeed(now, margin, fetchImpl) {
  const errors = [];
  const results = await Promise.all(
    ESPN_LEAGUES.map(([slug]) =>
      fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`, fetchImpl).catch(
        (err) => {
          errors.push(slug + ': ' + err.message);
          return null;
        }
      )
    )
  );

  const matches = [];
  const seen = new Set();
  results.forEach((data, index) => {
    if (!data || !Array.isArray(data.events)) return;
    const [, leagueName, country] = ESPN_LEAGUES[index];
    data.events.forEach((event) => {
      if (!event.id || seen.has(String(event.id))) return;
      const competition = (event.competitions && event.competitions[0]) || null;
      if (!competition) return;
      seen.add(String(event.id));
      const home = espnSide(competition, 'home');
      const away = espnSide(competition, 'away');
      if (!home || !away) return;

      const state = (competition.status && competition.status.type && competition.status.type.state) || '';
      const detail = (competition.status && competition.status.type && competition.status.type.detail) || '';
      const clock = (competition.status && competition.status.displayClock) || '';
      const kickoff = Date.parse(event.date || competition.date || '') || now;

      let status = 'upcoming';
      if (state === 'in') status = 'live';
      else if (state === 'post') status = 'finished';
      else if (/postponed|canceled|abandoned/i.test(detail)) return;

      let minute = 0;
      if (status === 'live') {
        const parsed = Number.parseInt(String(clock).replace(/[^0-9]/g, ''), 10);
        minute = clamp(Number.isFinite(parsed) && parsed > 0 ? parsed : 1, 1, 90);
      } else if (status === 'finished') {
        minute = 90;
      }

      const homeScore = Number(home.score) || 0;
      const awayScore = Number(away.score) || 0;

      // Halvtidsresultat finns som period 1 i linescores.
      const hsLine = home.linescores && home.linescores[0] ? Number(home.linescores[0].value) : null;
      const asLine = away.linescores && away.linescores[0] ? Number(away.linescores[0].value) : null;
      const halftimeReached = status === 'finished' || minute >= 45;
      const htScore =
        Number.isFinite(hsLine) && Number.isFinite(asLine) && halftimeReached
          ? { home: hsLine, away: asLine }
          : null;

      const base = {
        id: 'espn-' + event.id,
        home: (home.team && (home.team.displayName || home.team.name)) || 'Hemmalag',
        away: (away.team && (away.team.displayName || away.team.name)) || 'Bortalag',
        league: leagueName,
        country,
        homeScore,
        awayScore,
        minute,
        status,
        kickoff,
        live: status === 'live',
        htScore,
        goals: espnGoals(competition, home.team && home.team.id, away.team && away.team.id)
      };

      if (status === 'upcoming' && kickoff - now > 3 * 86400 * 1000) return;
      if (status === 'finished' && now - kickoff > 8 * 3600 * 1000) return;

      matches.push({
        ...base,
        result: status === 'finished' ? { home: homeScore, away: awayScore } : null,
        markets: buildMarkets(base, margin),
        source: 'espn'
      });
    });
  });

  if (!matches.length) throw new Error(errors[0] || 'Inga matcher i svaret');
  return sortMatches(matches);
}

/* ---------------------------- TheSportsDB ---------------------------- */

function sportDbStatus(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (/match finished|finished|\bft\b|\baet\b|\bpen\b|ended/.test(t)) return 'finished';
  if (/not started|\bns\b|scheduled|time to be defined/.test(t)) return 'upcoming';
  if (/\bht\b|half.?time/.test(t)) return 'live';
  return 'live';
}

async function sportsDbFeed(now, margin, fetchImpl) {
  const key = '3';
  const urls = [
    `https://www.thesportsdb.com/api/v1/json/${key}/livescore.php?s=Soccer`,
    `https://www.thesportsdb.com/api/v1/json/${key}/eventsday.php?d=${isoDate(0)}&s=Soccer`
  ];
  const errors = [];
  const results = await Promise.all(
    urls.map((url) =>
      fetchJson(url, fetchImpl).catch((err) => {
        console.error('TheSportsDB:', err.message);
        errors.push(err.message);
        return null;
      })
    )
  );

  const events = [];
  results.forEach((data) => {
    if (data && Array.isArray(data.events)) events.push(...data.events);
    if (data && Array.isArray(data.results)) events.push(...data.results);
  });

  const seen = new Set();
  const matches = [];
  events.forEach((raw) => {
    const id = String(raw.idEvent || '');
    if (!id || seen.has(id)) return;
    const home = String(raw.strHomeTeam || '').trim();
    const away = String(raw.strAwayTeam || '').trim();
    if (!home || !away) return;
    seen.add(id);

    const status = sportDbStatus(raw.strStatus) || 'upcoming';
    const hs = toNumber(raw.intHomeScore);
    const as = toNumber(raw.intAwayScore);
    const progress = Number.parseInt(String(raw.strProgress || '').replace(/[^0-9]/g, ''), 10);
    const kickoff =
      Date.parse(raw.strTimestamp || '') ||
      Date.parse(`${raw.dateEvent || isoDate(0)}T${raw.strTime || '00:00:00'}Z`) ||
      now;

    let minute = 0;
    if (status === 'live') minute = clamp(Number.isFinite(progress) ? progress : 45, 1, 90);
    if (status === 'finished') minute = 90;

    const base = {
      id: 'tsdb-' + id,
      home,
      away,
      league: String(raw.strLeague || 'Fotboll'),
      country: '',
      homeScore: Number.isFinite(hs) ? hs : 0,
      awayScore: Number.isFinite(as) ? as : 0,
      minute,
      status,
      kickoff,
      live: status === 'live',
      htScore: null
    };
    matches.push({
      ...base,
      result: status === 'finished' ? { home: base.homeScore, away: base.awayScore } : null,
      markets: buildMarkets(base, margin),
      source: 'thesportsdb'
    });
  });

  const relevant = matches.filter((m) => {
    if (m.status === 'finished') return now - m.kickoff < 8 * 3600 * 1000;
    if (m.status === 'upcoming') return m.kickoff - now < 2 * 86400 * 1000;
    return true;
  });
  if (!relevant.length) throw new Error(errors[0] || 'Inga matcher i svaret');
  return sortMatches(relevant);
}

/* ----------------------------- OpenLigaDB ----------------------------- */

function openLigaStatus(raw, kickoff, now) {
  if (raw.matchIsFinished) return { status: 'finished', minute: 90 };
  const minutes = (now - kickoff) / 60000;
  if (minutes < 0) return { status: 'upcoming', minute: 0 };
  if (minutes > MATCH_MINUTES) return { status: 'finished', minute: 90 };
  return { status: 'live', minute: clamp(Math.round(minutes <= 45 ? minutes : minutes - 15), 1, 90) };
}

async function openLigaFeed(now, margin, fetchImpl) {
  const leagues = ['bl1', 'bl2', 'bl3', 'dfb'];
  const errors = [];
  const results = await Promise.all(
    leagues.map((league) =>
      fetchJson(`https://api.openligadb.de/getmatchdata/${league}`, fetchImpl).catch((err) => {
        console.error('OpenLigaDB ' + league + ':', err.message);
        errors.push(league + ': ' + err.message);
        return null;
      })
    )
  );

  const matches = [];
  const seen = new Set();
  results.forEach((games) => {
    if (!Array.isArray(games)) return;
    games.forEach((raw) => {
      const kickoff = Date.parse(raw.matchDateTimeUTC || raw.matchDateTime || '') || 0;
      if (!kickoff) return;
      if (raw.matchID != null) {
        if (seen.has(raw.matchID)) return; // samma match kan dyka upp i flera ligor
        seen.add(raw.matchID);
      }
      if (kickoff < now - 6 * 3600 * 1000 || kickoff > now + 7 * 86400 * 1000) return;

      const { status, minute } = openLigaStatus(raw, kickoff, now);
      const list = Array.isArray(raw.goals) ? raw.goals : [];
      const final = Array.isArray(raw.matchResults)
        ? raw.matchResults.find((r) => r.resultTypeID === 2)
        : null;
      const halftime = Array.isArray(raw.matchResults)
        ? raw.matchResults.find((r) => r.resultTypeID === 1)
        : null;

      const lastGoalScore = list.length ? list[list.length - 1] : null;
      const homeScore = final ? final.pointsTeam1 : lastGoalScore ? lastGoalScore.scoreTeam1 : 0;
      const awayScore = final ? final.pointsTeam2 : lastGoalScore ? lastGoalScore.scoreTeam2 : 0;

      const base = {
        id: 'olb-' + raw.matchID,
        home: String((raw.team1 && raw.team1.teamName) || 'Hemmalag'),
        away: String((raw.team2 && raw.team2.teamName) || 'Bortalag'),
        league: String((raw.leagueName && raw.leagueName) || (raw.leagueShortcut === 'bl2' ? '2. Bundesliga' : 'Bundesliga')),
        country: 'Tyskland',
        homeScore,
        awayScore,
        minute,
        status,
        kickoff,
        live: status === 'live',
        htScore: halftime ? { home: halftime.pointsTeam1, away: halftime.pointsTeam2 } : null,
        goals: list
          .filter((g) => Number.isFinite(g.matchMinute))
          .map((g) => ({ minute: g.matchMinute, side: g.scoreTeam1 > (g.scoreTeam2 || 0) ? 'home' : 'away' }))
      };
      matches.push({
        ...base,
        result: status === 'finished' ? { home: homeScore, away: awayScore } : null,
        markets: buildMarkets(base, margin),
        source: 'openligadb'
      });
    });
  });

  if (!matches.length) throw new Error(errors[0] || 'Inga matcher i svaret');
  return sortMatches(matches);
}

/* ------------------------------- cache ------------------------------- */

let cache = { key: null, at: 0, payload: null };

function resolveApiKey(options) {
  return String(
    (options.apiKey || process.env.ALLSPORTS_API_KEY || process.env.SPORTS_API_KEY || '') + ''
  ).trim();
}

const SOURCES = ['auto', 'allsportsapi', 'fotmob', 'espn', 'thesportsdb', 'openligadb', 'demo'];

/**
 * Hämtar matcher + odds från bästa tillgängliga källa.
 * @returns {Promise<{source, matches, updatedAt, error, apiKeySet, tried}>}
 */
async function getFeed(options = {}) {
  const now = options.now || Date.now();
  const margin = Number.isFinite(Number(options.margin)) ? Number(options.margin) : 6;
  const apiKey = resolveApiKey(options);
  const fetchImpl = options.fetch || globalThis.fetch;
  const requested = SOURCES.includes(options.source) ? options.source : 'auto';
  const cacheKey = [requested, apiKey ? 'nyckel' : 'utan', margin, Math.floor(now / CACHE_MS)].join(':');

  if (cache.payload && cache.key === cacheKey && now - cache.at < CACHE_MS) return cache.payload;

  const tried = [];
  const attempts = [];
  if (requested === 'auto' || requested === 'allsportsapi') {
    if (apiKey) attempts.push(['allsportsapi', () => allSportsFeed(apiKey, now, margin, fetchImpl)]);
    else tried.push({ source: 'allsportsapi', error: 'saknar API-nyckel' });
  }
  if (requested === 'auto' || requested === 'fotmob') {
    attempts.push(['fotmob', () => fotmobFeed(now, margin, fetchImpl)]);
  }
  if (requested === 'auto' || requested === 'espn') {
    attempts.push(['espn', () => espnFeed(now, margin, fetchImpl)]);
  }
  if (requested === 'auto' || requested === 'thesportsdb') {
    attempts.push(['thesportsdb', () => sportsDbFeed(now, margin, fetchImpl)]);
  }
  if (requested === 'auto' || requested === 'openligadb') {
    attempts.push(['openligadb', () => openLigaFeed(now, margin, fetchImpl)]);
  }

  let payload = null;
  if (typeof fetchImpl === 'function') {
    for (const [source, run] of attempts) {
      try {
        const matches = await run();
        payload = { source, matches, updatedAt: Date.now(), error: null, apiKeySet: !!apiKey, tried };
        break;
      } catch (err) {
        console.error('Källa ' + source + ' misslyckades:', err.message);
        tried.push({ source, error: String(err.message || err) });
      }
    }
  }

  if (!payload) {
    payload = {
      source: 'demo',
      matches: demoFeed(now, margin),
      updatedAt: Date.now(),
      error: tried.length ? 'Ingen extern källa svarade – visar demoligan' : null,
      apiKeySet: !!apiKey,
      tried
    };
  }

  cache = { key: cacheKey, at: now, payload };
  return payload;
}

function resetCache() {
  cache = { key: null, at: 0, payload: null };
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

module.exports = {
  getFeed,
  resetCache,
  decideOutcome,
  marketLabel,
  probabilities,
  demoFeed,
  MARKETS,
  SOURCES,
  MATCH_MINUTES
};
