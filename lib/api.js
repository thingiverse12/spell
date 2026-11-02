'use strict';

/**
 * Spellogiken/API:t. Delas av den lokala servern (filbaserad lagring)
 * och Vercel-funktionen (Supabase-lagring).
 */

const crypto = require('crypto');
const sports = require('./sports');

const DEFAULT_SETTINGS = {
  minBet: 10,
  maxBet: 5000,
  startBalance: 2500,
  blackjackPayout: 1.5,
  dealerHitsSoft17: false,
  doubleAfterSplit: true,
  slotLuck: 1,
  videoPokerLuck: 1,
  quizReward: 25,
  dailyBonus: 500,
  maintenance: false,
  banner: '',
  sportEnabled: true,
  sportMargin: 6,
  sportMaxStake: 500,
  sportsApiKey: '',
  sportsSource: 'auto'
};

/* Fält som aldrig får skickas ut till klienten. */
const SECRET_SETTINGS = ['sportsApiKey'];

const uid = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');
const now = () => Date.now();
const hashPin = (pin, salt) => crypto.createHash('sha256').update(salt + '::' + pin).digest('hex');
const round2 = (n) => Math.round(n * 100) / 100;

function cleanName(name) {
  return String(name || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 24);
}

function cleanGame(game) {
  return String(game || 'okänt').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'okant';
}

function normalizeDb(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    players: src.players && typeof src.players === 'object' ? src.players : {},
    transactions: Array.isArray(src.transactions) ? src.transactions : [],
    adminSessions: src.adminSessions && typeof src.adminSessions === 'object' ? src.adminSessions : {},
    settings: { ...DEFAULT_SETTINGS, ...(src.settings || {}) },
    sportBets: Array.isArray(src.sportBets) ? src.sportBets : [],
    broadcast: typeof src.broadcast === 'string' ? src.broadcast : '',
    createdAt: src.createdAt || Date.now()
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) {
        reject(new Error('För stor förfrågan'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Ogiltig JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createApi({ loadDb, saveDb, adminCode = 'Vincent12' }) {
  const ADMIN_CODE = String(adminCode || 'Vincent12').trim();

  let db = normalizeDb({});
  let dirty = false;

  const markDirty = () => {
    dirty = true;
  };

  function publicPlayer(p) {
    return {
      id: p.id,
      name: p.name,
      balance: p.balance,
      createdAt: p.createdAt,
      lastSeen: p.lastSeen,
      wagered: p.wagered || 0,
      won: p.won || 0,
      rounds: p.rounds || 0,
      quizCorrect: p.quizCorrect || 0,
      hasPin: !!p.pinHash,
      isGuest: !p.pinHash,
      banned: !!p.banned,
      lastBonus: p.lastBonus || 0,
      biggestWin: p.biggestWin || 0,
      net: round2((p.won || 0) - (p.wagered || 0)),
      gameStats: p.gameStats || {}
    };
  }

  /* Statistik per spel så att admin kan följa vad folk vinner. */
  function bumpGame(player, game, kind, amount) {
    if (!game || game === 'bonus' || game === 'admin' || game === 'konto') return;
    player.gameStats = player.gameStats || {};
    const stat = (player.gameStats[game] = player.gameStats[game] || { wagered: 0, won: 0, rounds: 0, best: 0 });
    if (kind === 'bet') {
      stat.wagered = round2(stat.wagered + amount);
      stat.rounds = (stat.rounds || 0) + 1;
    } else {
      stat.won = round2(stat.won + amount);
      if (amount > (stat.best || 0)) stat.best = round2(amount);
      if (amount > (player.biggestWin || 0)) player.biggestWin = round2(amount);
    }
  }

  function publicSettings() {
    const out = { ...db.settings, banner: db.broadcast || db.settings.banner || '' };
    SECRET_SETTINGS.forEach((key) => delete out[key]);
    out.sportApiKeySet = !!db.settings.sportsApiKey;
    return out;
  }

  function logTransaction(player, kind, game, amount, balance) {
    const entry = { t: now(), kind, game, amount: round2(amount), balance: round2(balance) };
    player.log = player.log || [];
    player.log.unshift(entry);
    player.log = player.log.slice(0, 60);
    db.transactions.unshift({ ...entry, playerId: player.id, playerName: player.name });
    db.transactions = db.transactions.slice(0, 800);
  }

  function newPlayer(name) {
    const id = uid(8);
    const salt = uid(8);
    const player = {
      id,
      name: cleanName(name) || 'Gäst ' + Math.floor(1000 + Math.random() * 9000),
      salt,
      pinHash: '',
      token: uid(16),
      balance: Number(db.settings.startBalance) || DEFAULT_SETTINGS.startBalance,
      createdAt: now(),
      lastSeen: now(),
      wagered: 0,
      won: 0,
      rounds: 0,
      quizCorrect: 0,
      banned: false,
      lastBonus: 0,
      biggestWin: 0,
      gameStats: {},
      log: []
    };
    db.players[id] = player;
    logTransaction(player, 'konto', 'nytt konto', 0, player.balance);
    markDirty();
    return player;
  }

  function findPlayerByToken(req) {
    const token = String(req.headers['x-token'] || '');
    if (!token) return null;
    const player = Object.values(db.players).find((p) => p.token === token);
    if (!player) return null;
    player.lastSeen = now();
    return player;
  }

  function adminFromRequest(req) {
    const token = String(req.headers['x-admin-token'] || '');
    const session = db.adminSessions[token];
    if (!session) return null;
    if (session.expires < now()) {
      delete db.adminSessions[token];
      markDirty();
      return null;
    }
    return session;
  }

  /* ------------------------------ fotboll ------------------------------ */

  async function sportsFeed() {
    return sports.getFeed({
      margin: Number(db.settings.sportMargin) || 0,
      apiKey: db.settings.sportsApiKey || '',
      source: db.settings.sportsSource || 'auto'
    });
  }

  function betLimit() {
    const max = Math.max(10, Math.min(Number(db.settings.sportMaxStake) || 500, 100000));
    const min = Math.max(1, Math.min(Number(db.settings.minBet) || 10, max));
    return { min, max };
  }

  function publicBet(bet) {
    const match = bet.matchLabel || '';
    return {
      id: bet.id,
      matchId: bet.matchId,
      playerId: bet.playerId,
      playerName: bet.playerName || (db.players[bet.playerId] ? db.players[bet.playerId].name : ''),
      match: match,
      league: bet.league || '',
      market: bet.market,
      marketLabel: bet.marketLabel || sports.marketLabel(bet.market, bet.selection),
      selection: bet.selection,
      selectionLabel: bet.selectionLabel || bet.selection,
      stake: bet.stake,
      odds: bet.odds,
      potential: round2(bet.stake * bet.odds),
      status: bet.status,
      placedAt: bet.placedAt,
      settledAt: bet.settledAt || null,
      payout: bet.payout || 0,
      result: bet.result || null
    };
  }

  /** Avgör öppna fotbollsspel när matcherna är färdigspelade. */
  async function settleSports() {
    const open = (db.sportBets || []).filter((b) => b.status === 'open');
    if (!open.length) return { settled: 0, feed: null };
    let feed = null;
    try {
      feed = await sportsFeed();
    } catch (err) {
      return { settled: 0, feed: null };
    }
    const byId = new Map(feed.matches.map((m) => [m.id, m]));
    let settled = 0;
    open.forEach((bet) => {
      const player = db.players[bet.playerId];
      const match = byId.get(bet.matchId);
      const decision = match ? sports.decideOutcome(match, bet) : null;
      if (match && match.status === 'finished' && decision) {
        bet.status = decision;
        bet.settledAt = now();
        bet.result = match.result ? match.result.home + '-' + match.result.away : null;
        if (decision === 'won' && player) {
          const payout = round2(bet.stake * bet.odds);
          bet.payout = payout;
          player.balance = round2(player.balance + payout);
          player.won = round2((player.won || 0) + payout);
          bumpGame(player, 'sport', 'win', payout);
          logTransaction(player, 'vinst', 'sport', payout, player.balance);
        } else if (decision === 'void' && player) {
          player.balance = round2(player.balance + bet.stake);
          bet.payout = bet.stake;
          logTransaction(player, 'aterbetalning', 'sport', bet.stake, player.balance);
        }
        settled += 1;
      } else if (!match && now() - bet.placedAt > 4 * 60 * 60 * 1000) {
        // Matchen finns inte kvar längre – insatsen betalas tillbaka.
        bet.status = 'void';
        bet.settledAt = now();
        if (player) {
          player.balance = round2(player.balance + bet.stake);
          logTransaction(player, 'aterbetalning', 'sport', bet.stake, player.balance);
        }
        settled += 1;
      }
    });
    if (settled) markDirty();
    return { settled, feed };
  }

  const routes = {
    'GET /api/health': async (req, res) =>
      json(res, 200, { ok: true, players: Object.keys(db.players).length }),

    'GET /api/settings': async (req, res) => json(res, 200, { settings: publicSettings() }),

    'POST /api/guest': async (req, res) => {
      const body = await readBody(req);
      const player = newPlayer(body.name || '');
      json(res, 200, { token: player.token, player: publicPlayer(player), settings: publicSettings() });
    },

    'GET /api/me': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (player.banned) return json(res, 403, { error: 'Kontot är avstängt', banned: true });
      markDirty();
      json(res, 200, { player: publicPlayer(player), settings: publicSettings() });
    },

    'POST /api/player/name': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      const body = await readBody(req);
      const name = cleanName(body.name);
      if (name.length < 2) return json(res, 400, { error: 'Namnet är för kort' });
      player.name = name;
      markDirty();
      json(res, 200, { player: publicPlayer(player) });
    },

    'POST /api/player/pin': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      const body = await readBody(req);
      const pin = String(body.pin || '');
      if (!/^\d{4}$/.test(pin)) return json(res, 400, { error: 'PIN måste vara fyra siffror' });
      player.salt = uid(8);
      player.pinHash = hashPin(pin, player.salt);
      markDirty();
      json(res, 200, { ok: true });
    },

    'POST /api/auth/login': async (req, res) => {
      const body = await readBody(req);
      const name = cleanName(body.name).toLowerCase();
      const pin = String(body.pin || '');
      const player = Object.values(db.players).find((p) => p.name.toLowerCase() === name && p.pinHash);
      if (!player) return json(res, 401, { error: 'Hittade inget konto med den koden' });
      if (player.banned) return json(res, 403, { error: 'Kontot är avstängt' });
      if (hashPin(pin, player.salt) !== player.pinHash) return json(res, 401, { error: 'Fel PIN-kod' });
      player.token = uid(16);
      player.lastSeen = now();
      markDirty();
      json(res, 200, { token: player.token, player: publicPlayer(player), settings: publicSettings() });
    },

    'POST /api/auth/register': async (req, res) => {
      const body = await readBody(req);
      const name = cleanName(body.name);
      const pin = String(body.pin || '');
      if (name.length < 2) return json(res, 400, { error: 'Namnet måste vara minst två tecken' });
      if (!/^\d{4}$/.test(pin)) return json(res, 400, { error: 'PIN-koden måste vara fyra siffror' });

      const current = findPlayerByToken(req);
      const taken = Object.values(db.players).find(
        (p) => p.name.toLowerCase() === name.toLowerCase() && (!current || p.id !== current.id)
      );
      if (taken) return json(res, 409, { error: 'Namnet är upptaget – välj ett annat' });

      let player = current;
      if (player && !player.pinHash) {
        // Uppgradera gästkontot så att saldo och framsteg hänger med.
        player.name = name;
      } else {
        player = newPlayer(name);
      }
      player.salt = uid(8);
      player.pinHash = hashPin(pin, player.salt);
      player.token = uid(16);
      player.lastSeen = now();
      logTransaction(player, 'konto', 'konto skapat', 0, player.balance);
      markDirty();
      json(res, 201, { token: player.token, player: publicPlayer(player), settings: publicSettings() });
    },

    'POST /api/auth/logout': async (req, res) => {
      const player = findPlayerByToken(req);
      if (player) {
        player.token = uid(16);
        markDirty();
      }
      json(res, 200, { ok: true });
    },

    'POST /api/bet': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (player.banned) return json(res, 403, { error: 'Kontot är avstängt' });
      const body = await readBody(req);
      const amount = Math.round(Number(body.amount) || 0);
      const game = cleanGame(body.game);
      if (!(amount > 0)) return json(res, 400, { error: 'Ogiltig insats' });
      if (amount > Math.max(1000, Number(db.settings.maxBet) * 50)) {
        return json(res, 400, { error: 'Insatsen är för stor' });
      }
      if (amount > player.balance) return json(res, 400, { error: 'Du har inte tillräckligt med spelmynt' });
      player.balance = round2(player.balance - amount);
      player.wagered = round2((player.wagered || 0) + amount);
      player.rounds = (player.rounds || 0) + 1;
      bumpGame(player, game, 'bet', amount);
      logTransaction(player, 'insats', game, -amount, player.balance);
      markDirty();
      json(res, 200, { balance: player.balance });
    },

    'POST /api/credit': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (player.banned) return json(res, 403, { error: 'Kontot är avstängt' });
      const body = await readBody(req);
      const game = cleanGame(body.game);
      let amount = Math.round(Number(body.amount) || 0);
      if (amount <= 0) return json(res, 200, { balance: player.balance });
      const cap = game === 'quiz' ? 400 : 250000;
      amount = Math.min(amount, cap);
      player.balance = round2(player.balance + amount);
      player.won = round2((player.won || 0) + amount);
      if (game === 'quiz') {
        player.quizCorrect =
          (player.quizCorrect || 0) + Math.max(1, Math.round(amount / Math.max(1, db.settings.quizReward)));
      }
      bumpGame(player, game, 'win', amount);
      logTransaction(player, 'vinst', game, amount, player.balance);
      markDirty();
      json(res, 200, { balance: player.balance });
    },

    /* Diagnostik för fotbollskällorna: visar rå svarsform utan att läcka nycklar. */
    'GET /api/sport/debug': async (req, res, url) => {
      const key = String(url.searchParams.get('key') || '');
      if (key.toLowerCase() !== ADMIN_CODE.toLowerCase()) return json(res, 401, { error: 'Kräver kod' });
      const provider = String(url.searchParams.get('provider') || 'openligadb');
      const targets = {
        openligadb: 'https://api.openligadb.de/getmatchdata/bl1',
        openliga2: 'https://api.openligadb.de/getmatchdata/bl2',
        fotmob: 'https://www.fotmob.com/api/matches?date=' + new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        espn: 'https://site.api.espn.com/apis/site/v2/sports/soccer/swe.1/scoreboard',
        thesportsdb: 'https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=Soccer',
        openligaseason: 'https://api.openligadb.de/getmatchdata/bl1/' + new Date().getUTCFullYear(),
        sofascore: 'https://api.sofascore.com/api/v1/sport/football/events/live',
        scorebat: 'https://www.scorebat.com/video-api/v3/',
        footballorg: 'https://api.football-data.org/v4/matches',
        openligadfb: 'https://api.openligadb.de/getmatchdata/dfb'
      };
      const target = targets[provider];
      if (!target) return json(res, 400, { error: 'Okänd provider', providers: Object.keys(targets) });
      try {
        const startedAt = now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const upstream = await fetch(target, {
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            'user-agent': 'Mozilla/5.0 (compatible; GoldenSpade/1.0)'
          }
        });
        clearTimeout(timer);
        const text = await upstream.text();
        let shape = 'text';
        let keys = null;
        let length = null;
        let sample = null;
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            shape = 'array';
            length = parsed.length;
            sample = parsed[0] ? Object.keys(parsed[0]).slice(0, 40) : null;
          } else if (parsed && typeof parsed === 'object') {
            shape = 'object';
            keys = Object.keys(parsed).slice(0, 20);
            const firstArray = Object.values(parsed).find((v) => Array.isArray(v));
            if (Array.isArray(firstArray)) {
              length = firstArray.length;
              sample = firstArray[0] ? Object.keys(firstArray[0]).slice(0, 40) : null;
            }
          }
        } catch (e) {
          shape = 'html/text';
        }
        json(res, 200, {
          provider,
          url: target,
          status: upstream.status,
          contentType: upstream.headers.get('content-type'),
          bytes: text.length,
          ms: now() - startedAt,
          shape,
          keys,
          length,
          sampleKeys: sample,
          head: text.slice(0, 220)
        });
      } catch (err) {
        json(res, 200, { provider, url: target, error: String(err.message || err) });
      }
    },

    /* ------------------------- fotboll / live-odds ------------------------- */

    'GET /api/sport/matches': async (req, res) => {
      const { feed } = await settleSports();
      const data = feed || (await sportsFeed());
      const limit = betLimit();
      const player = findPlayerByToken(req);
      json(res, 200, {
        source: data.source,
        updatedAt: data.updatedAt,
        error: data.error,
        apiKeySet: !!data.apiKeySet,
        enabled: !!db.settings.sportEnabled,
        markets: sports.MARKETS.map((m) => ({ key: m.key, label: m.label, short: m.short })),
        limits: { ...limit, balance: player ? player.balance : 0 },
        tried: data.tried || [],
        matches: data.matches
      });
    },

    'GET /api/sport/bets': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      await settleSports();
      const mine = db.sportBets
        .filter((b) => b.playerId === player.id)
        .sort((a, b) => (b.placedAt || 0) - (a.placedAt || 0))
        .slice(0, 40)
        .map(publicBet);
      json(res, 200, {
        bets: mine,
        open: mine.filter((b) => b.status === 'open').length,
        balance: player.balance
      });
    },

    'POST /api/sport/bet': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (player.banned) return json(res, 403, { error: 'Kontot är avstängt' });
      if (!db.settings.sportEnabled) return json(res, 403, { error: 'Fotbollsspelen är stängda just nu' });
      if (db.settings.maintenance) return json(res, 403, { error: 'Spelhallen är i underhållsläge' });

      const body = await readBody(req);
      const amount = Math.round(Number(body.amount) || 0);
      const matchId = String(body.matchId || '');
      const market = String(body.market || '');
      const selection = String(body.selection || '');
      const limit = betLimit();

      if (!(amount > 0)) return json(res, 400, { error: 'Ogiltig insats' });
      if (amount < limit.min) return json(res, 400, { error: 'Minsta insats är ' + limit.min + ' kr' });
      if (amount > limit.max) return json(res, 400, { error: 'Högsta insats för fotboll är ' + limit.max + ' kr' });
      if (amount > player.balance) return json(res, 400, { error: 'Du har inte tillräckligt med spelmynt' });

      const feed = await sportsFeed();
      const match = feed.matches.find((m) => m.id === matchId);
      if (!match) return json(res, 404, { error: 'Matchen finns inte längre' });
      if (match.status === 'finished') return json(res, 400, { error: 'Matchen är redan slut' });

      const marketData = match.markets.find((m) => m.key === market);
      const pick = marketData && marketData.selections.find((s) => s.key === selection);
      if (!pick) return json(res, 400, { error: 'Ogiltigt spel' });

      const odds = round2(pick.odds);
      const bet = {
        id: uid(8),
        playerId: player.id,
        playerName: player.name,
        matchId,
        matchLabel: match.home + ' – ' + match.away,
        league: match.league || '',
        market,
        marketLabel: marketData.label,
        selection,
        selectionLabel: pick.long || pick.label,
        stake: amount,
        odds,
        homeScoreAtBet: match.homeScore || 0,
        awayScoreAtBet: match.awayScore || 0,
        minuteAtBet: match.minute || 0,
        status: 'open',
        placedAt: now(),
        settledAt: null,
        payout: 0,
        result: null
      };

      player.balance = round2(player.balance - amount);
      player.wagered = round2((player.wagered || 0) + amount);
      player.rounds = (player.rounds || 0) + 1;
      bumpGame(player, 'sport', 'bet', amount);
      logTransaction(player, 'insats', 'sport', -amount, player.balance);
      db.sportBets.unshift(bet);
      db.sportBets = db.sportBets.slice(0, 600);
      markDirty();
      json(res, 200, { bet: publicBet(bet), balance: player.balance });
    },

    'GET /api/admin/sport': async (req, res) => {
      if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
      let feed = null;
      try {
        feed = (await settleSports()).feed || (await sportsFeed());
      } catch (err) {
        feed = { source: 'demo', error: String(err.message || err), apiKeySet: false, matches: [] };
      }
      const open = db.sportBets.filter((b) => b.status === 'open').map(publicBet);
      const settled = db.sportBets
        .filter((b) => b.status !== 'open')
        .sort((a, b) => (b.settledAt || 0) - (a.settledAt || 0));
      const totals = settled.reduce(
        (acc, b) => {
          acc.stake += b.stake;
          if (b.status === 'won') {
            acc.payout += b.payout || 0;
            acc.won += 1;
          } else if (b.status === 'lost') acc.lost += 1;
          else acc.void += 1;
          return acc;
        },
        { stake: 0, payout: 0, won: 0, lost: 0, void: 0 }
      );
      json(res, 200, {
        settings: {
          enabled: !!db.settings.sportEnabled,
          margin: Number(db.settings.sportMargin) || 0,
          maxStake: betLimit().max,
          apiKeySet: !!db.settings.sportsApiKey,
          source: db.settings.sportsSource || 'auto',
          sources: sports.SOURCES
        },
        feed: {
          source: feed.source,
          error: feed.error || null,
          apiKeySet: !!feed.apiKeySet,
          updatedAt: feed.updatedAt || null,
          matches: (feed.matches || []).length,
          live: (feed.matches || []).filter((m) => m.live).length,
          tried: feed.tried || []
        },
        open: open.slice(0, 60),
        settled: settled.slice(0, 60).map(publicBet),
        totals: { ...totals, openStake: open.reduce((a, b) => a + b.stake, 0), openCount: open.length }
      });
    },

    'POST /api/admin/sport': async (req, res) => {
      if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
      const body = await readBody(req);
      if (body.enabled !== undefined) db.settings.sportEnabled = !!body.enabled;
      if (body.margin !== undefined) {
        const v = Number(body.margin);
        if (Number.isFinite(v)) db.settings.sportMargin = Math.min(20, Math.max(0, v));
      }
      if (body.maxStake !== undefined) {
        const v = Number(body.maxStake);
        if (Number.isFinite(v)) db.settings.sportMaxStake = Math.min(50000, Math.max(10, Math.round(v)));
      }
      if (body.source !== undefined) {
        const src = String(body.source || 'auto');
        if (sports.SOURCES.includes(src)) db.settings.sportsSource = src;
        sports.resetCache();
      }
      if (body.apiKey !== undefined) {
        db.settings.sportsApiKey = String(body.apiKey || '').trim().slice(0, 120);
        sports.resetCache();
      }
      markDirty();
      json(res, 200, {
        settings: {
          enabled: !!db.settings.sportEnabled,
          margin: Number(db.settings.sportMargin) || 0,
          maxStake: betLimit().max,
          apiKeySet: !!db.settings.sportsApiKey,
          source: db.settings.sportsSource || 'auto',
          sources: sports.SOURCES
        }
      });
    },

    'POST /api/bonus': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      const bonus = Math.round(Number(db.settings.dailyBonus) || 500);
      const wait = 6 * 60 * 60 * 1000;
      if (player.lastBonus && now() - player.lastBonus < wait) {
        return json(res, 429, {
          error: 'Bonusen är redan hämtad',
          nextIn: player.lastBonus + wait - now()
        });
      }
      player.lastBonus = now();
      player.balance = round2(player.balance + bonus);
      logTransaction(player, 'bonus', 'daglig bonus', bonus, player.balance);
      markDirty();
      json(res, 200, { balance: player.balance, bonus });
    },

    'POST /api/admin/login': async (req, res) => {
      const body = await readBody(req);
      const code = String(body.code || '').trim();
      if (code.toLowerCase() !== ADMIN_CODE.toLowerCase()) return json(res, 401, { error: 'Fel kod' });
      const token = uid(16);
      db.adminSessions[token] = { created: now(), expires: now() + 8 * 60 * 60 * 1000 };
      markDirty();
      json(res, 200, { adminToken: token, name: 'Casinochef' });
    },

    'GET /api/admin/overview': async (req, res) => {
      if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
      const players = Object.values(db.players)
        .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
        .map(publicPlayer);
      const totals = players.reduce(
        (acc, p) => {
          acc.wagered += p.wagered;
          acc.won += p.won;
          acc.balance += p.balance;
          acc.rounds += p.rounds;
          if (now() - (p.lastSeen || 0) < 24 * 60 * 60 * 1000) acc.active24h += 1;
          return acc;
        },
        { wagered: 0, won: 0, balance: 0, rounds: 0, active24h: 0 }
      );
      const gameTotals = {};
      players.forEach((p) => {
        Object.entries(p.gameStats || {}).forEach(([game, stat]) => {
          const row = (gameTotals[game] = gameTotals[game] || { wagered: 0, won: 0, rounds: 0, best: 0 });
          row.wagered = round2(row.wagered + (stat.wagered || 0));
          row.won = round2(row.won + (stat.won || 0));
          row.rounds += stat.rounds || 0;
          if ((stat.best || 0) > row.best) row.best = stat.best;
        });
      });
      const sportOpen = db.sportBets.filter((b) => b.status === 'open');
      json(res, 200, {
        players,
        totals,
        gameTotals,
        sport: {
          openBets: sportOpen.length,
          openStake: round2(sportOpen.reduce((a, b) => a + (b.stake || 0), 0)),
          enabled: !!db.settings.sportEnabled,
          apiKeySet: !!db.settings.sportsApiKey
        },
        settings: publicSettings(),
        transactions: db.transactions.slice(0, 200),
        broadcast: db.broadcast || '',
        storage: 'cloud'
      });
    },

    'POST /api/admin/player': async (req, res) => {
      if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
      const body = await readBody(req);
      const player = db.players[body.id];
      if (!player) return json(res, 404, { error: 'Spelaren finns inte' });
      const action = String(body.action || '');
      if (action === 'setBalance') {
        const value = Math.max(0, Math.min(1e7, Math.round(Number(body.value) || 0)));
        const diff = round2(value - player.balance);
        player.balance = value;
        logTransaction(player, 'admin', 'saldo ändrat', diff, player.balance);
      } else if (action === 'add') {
        const value = Math.round(Number(body.value) || 0);
        player.balance = Math.max(0, round2(player.balance + value));
        logTransaction(player, 'admin', 'saldo ändrat', value, player.balance);
      } else if (action === 'ban') {
        player.banned = !!body.value;
        logTransaction(player, 'admin', player.banned ? 'avstängd' : 'återaktiverad', 0, player.balance);
      } else if (action === 'reset') {
        player.balance = Number(db.settings.startBalance) || DEFAULT_SETTINGS.startBalance;
        player.wagered = 0;
        player.won = 0;
        player.rounds = 0;
        logTransaction(player, 'admin', 'nollställd', 0, player.balance);
      } else if (action === 'delete') {
        delete db.players[player.id];
        db.sportBets = db.sportBets.filter((b) => b.playerId !== player.id);
        markDirty();
        return json(res, 200, { ok: true, deleted: true });
      } else {
        return json(res, 400, { error: 'Okänd åtgärd' });
      }
      markDirty();
      json(res, 200, { player: publicPlayer(player) });
    },

    'POST /api/admin/settings': async (req, res) => {
      if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
      const body = await readBody(req);
      const incoming = body.settings || {};
      const next = { ...db.settings };
      const num = (key, min, max) => {
        if (incoming[key] === undefined) return;
        const v = Number(incoming[key]);
        if (Number.isFinite(v)) next[key] = Math.min(max, Math.max(min, v));
      };
      num('minBet', 1, 1000);
      num('maxBet', 10, 100000);
      num('startBalance', 0, 1000000);
      num('blackjackPayout', 1, 2);
      num('slotLuck', 0.5, 1.5);
      num('videoPokerLuck', 0.5, 1.5);
      num('quizReward', 1, 200);
      num('dailyBonus', 0, 10000);
      num('sportMargin', 0, 20);
      num('sportMaxStake', 10, 50000);
      if (incoming.dealerHitsSoft17 !== undefined) next.dealerHitsSoft17 = !!incoming.dealerHitsSoft17;
      if (incoming.doubleAfterSplit !== undefined) next.doubleAfterSplit = !!incoming.doubleAfterSplit;
      if (incoming.maintenance !== undefined) next.maintenance = !!incoming.maintenance;
      if (incoming.sportEnabled !== undefined) next.sportEnabled = !!incoming.sportEnabled;
      if (next.maxBet < next.minBet) next.maxBet = next.minBet;
      db.settings = next;
      markDirty();
      json(res, 200, { settings: publicSettings() });
    },

    'POST /api/admin/broadcast': async (req, res) => {
      if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
      const body = await readBody(req);
      db.broadcast = String(body.message || '').slice(0, 240);
      markDirty();
      json(res, 200, { broadcast: db.broadcast });
    },

    /* Diagnostik: verifierar lagring och hela API-kedjan. Kräver admin-koden. */
    'GET /api/selftest': async (req, res, url) => {
      const key = String(url.searchParams.get('key') || '');
      if (key.toLowerCase() !== ADMIN_CODE.toLowerCase()) return json(res, 401, { error: 'Kräver kod' });

      const started = now();
      const steps = [];
      let failed = null;

      const fakeRes = () => ({
        statusCode: 200,
        headersSent: false,
        body: '',
        writeHead(code) {
          this.statusCode = code;
          this.headersSent = true;
          return this;
        },
        end(body) {
          this.body = body || '';
          this.headersSent = true;
        }
      });

      const call = async (method, path, { body, headers } = {}) => {
        const route = routes[method + ' ' + path];
        if (!route) throw new Error('Saknar route ' + method + ' ' + path);
        const out = fakeRes();
        await route({ method, headers: headers || {}, body }, out, new URL('http://selftest' + path));
        const data = out.body ? JSON.parse(out.body) : {};
        data.__status = out.statusCode;
        return data;
      };

      const check = (name, ok, info) => {
        steps.push({ name, ok: !!ok, info: info === undefined ? null : info });
        if (!ok) throw new Error(name);
      };

      let guest = null;
      let adminToken = null;
      try {
        guest = await call('POST', '/api/guest', { body: { name: '__selftest__' } });
        check('skapa gästkonto', guest.token && guest.player.balance === db.settings.startBalance, guest.player.balance);

        const token = guest.token;
        const reg = await call('POST', '/api/auth/register', {
          headers: { 'x-token': token },
          body: { name: '__selftest__', pin: '1234' }
        });
        check('skapa konto med PIN', reg.player && reg.player.hasPin === true && reg.player.isGuest === false);

        const relogin = await call('POST', '/api/auth/login', { body: { name: '__selftest__', pin: '1234' } });
        check('logga in med namn + PIN', relogin.player && relogin.player.id === guest.player.id);

        const bet = await call('POST', '/api/bet', { headers: { 'x-token': relogin.token }, body: { game: 'selftest', amount: 100 } });
        check('insats dras', bet.balance === guest.player.balance - 100, bet.balance);
        const token2 = relogin.token;

        const credit = await call('POST', '/api/credit', { headers: { 'x-token': token2 }, body: { game: 'selftest', amount: 250 } });
        check('vinst krediteras', credit.balance === bet.balance + 250, credit.balance);

        const bonus = await call('POST', '/api/bonus', { headers: { 'x-token': token2 } });
        check('bonus fungerar', bonus.balance === credit.balance + db.settings.dailyBonus, bonus.balance);

        const me = await call('GET', '/api/me', { headers: { 'x-token': token2 } });
        check('session läses', me.player && me.player.id === guest.player.id);

        const sportFeed = await call('GET', '/api/sport/matches', { headers: { 'x-token': token2 } });
        const priced = (sportFeed.matches || []).filter(
          (m) => m.status !== 'finished' && m.markets && m.markets[0].selections.every((x) => x.odds >= 1.01)
        );
        check('fotboll: matcher med odds', sportFeed.source && priced.length > 0, {
          source: sportFeed.source,
          matches: (sportFeed.matches || []).length,
          live: (sportFeed.matches || []).filter((m) => m.live).length
        });

        const ticket =
          priced.find((m) => m.markets[0].selections.some((x) => x.odds >= 1.3 && x.odds <= 8)) || priced[0];
        const placed = await call('POST', '/api/sport/bet', {
          headers: { 'x-token': token2 },
          body: { matchId: ticket.id, market: '1x2', selection: 'hemma', amount: 50 }
        });
        check('fotboll: spel placeras', placed.bet && placed.bet.status === 'open' && placed.balance === me.player.balance - 50, placed.bet && placed.bet.odds);

        const mine = await call('GET', '/api/sport/bets', { headers: { 'x-token': token2 } });
        check('fotboll: mina spel listas', mine.bets && mine.bets.length === 1 && mine.open === 1);

        const login = await call('POST', '/api/admin/login', { body: { code: ADMIN_CODE } });
        adminToken = login.adminToken;
        check('admin-inloggning', !!adminToken);

        const overview = await call('GET', '/api/admin/overview', { headers: { 'x-admin-token': adminToken } });
        check('admin ser spelaren', Array.isArray(overview.players) && overview.players.some((p) => p.id === guest.player.id), overview.players.length);

        const seen = overview.players.find((p) => p.id === guest.player.id);
        check('admin ser vinster per spel', seen && seen.gameStats && seen.gameStats.selftest && seen.gameStats.selftest.won === 250, seen && seen.gameStats);
        check('admin summerar per spel', overview.gameTotals && overview.gameTotals.selftest && overview.gameTotals.selftest.won >= 250, overview.gameTotals && overview.gameTotals.selftest);

        const sportAdmin = await call('GET', '/api/admin/sport', { headers: { 'x-admin-token': adminToken } });
        check(
          'admin ser fotbollsspel',
          sportAdmin.open && sportAdmin.open.length >= 1 && sportAdmin.feed && !!sportAdmin.feed.source,
          { open: sportAdmin.open && sportAdmin.open.length, feed: sportAdmin.feed && sportAdmin.feed.source }
        );
        check(
          'fotboll räknas i vinststatistiken',
          overview.gameTotals && overview.gameTotals.sport && overview.gameTotals.sport.wagered >= 50,
          overview.gameTotals && overview.gameTotals.sport
        );

        const setBal = await call('POST', '/api/admin/player', {
          headers: { 'x-admin-token': adminToken },
          body: { id: guest.player.id, action: 'setBalance', value: 9999 }
        });
        check('admin ändrar saldo', setBal.player && setBal.player.balance === 9999, setBal.player && setBal.player.balance);

        const ban = await call('POST', '/api/admin/player', {
          headers: { 'x-admin-token': adminToken },
          body: { id: guest.player.id, action: 'ban', value: true }
        });
        check('admin stänger av', ban.player && ban.player.banned === true);

        const blocked = await call('GET', '/api/me', { headers: { 'x-token': token2 } });
        check('avstängd nekas', blocked.__status === 403, blocked.__status);

        const del = await call('POST', '/api/admin/player', {
          headers: { 'x-admin-token': adminToken },
          body: { id: guest.player.id, action: 'delete' }
        });
        check('admin raderar', del.deleted === true);
      } catch (err) {
        failed = err.message;
      } finally {
        // Städa bort allt testdata.
        if (guest && guest.player && db.players[guest.player.id]) delete db.players[guest.player.id];
        if (guest && guest.player) {
          db.transactions = db.transactions.filter((t) => t.playerId !== guest.player.id);
          db.sportBets = db.sportBets.filter((b) => b.playerId !== guest.player.id);
        }
        if (adminToken) delete db.adminSessions[adminToken];
        delete db.settings.__probe;
        markDirty();
      }

      json(res, failed ? 500 : 200, {
        ok: !failed,
        failed,
        steps,
        ms: now() - started,
        players: Object.keys(db.players).length,
        storage: 'cloud'
      });
    },
  };

  async function handle(req, res, url) {
    try {
      db = normalizeDb(await loadDb());
    } catch (err) {
      console.error('Kunde inte läsa databasen:', err);
      return json(res, 503, { error: 'Databasen är inte tillgänglig', detail: String(err.message || err) });
    }
    dirty = false;

    const pathname = url.pathname.replace(/\/+$/, '') || '/api';
    const key = req.method + ' ' + pathname;
    const handler = routes[key];
    if (!handler) return json(res, 404, { error: 'Okänd endpoint: ' + key });

    try {
      await handler(req, res, url);
    } catch (err) {
      console.error('Serverfel:', err);
      if (!res.headersSent) json(res, 500, { error: 'Serverfel: ' + err.message });
      else res.end();
    } finally {
      if (dirty) {
        try {
          await saveDb(db);
        } catch (err) {
          console.error('Kunde inte spara databasen:', err);
        }
      }
    }
  }

  return { handle };
}

module.exports = { createApi, normalizeDb, DEFAULT_SETTINGS, cleanName, readBody, json };
