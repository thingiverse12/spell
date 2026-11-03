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
  scratchLuck: 1,
  quizReward: 25,
  dailyBonus: 500,
  maintenance: false,
  banner: '',
  sportEnabled: true,
  sportMargin: 6,
  sportMaxStake: 500,
  rubberBand: true,
  sportsApiKey: '',
  sportsSource: 'auto'
};

/* Fält som aldrig får skickas ut till klienten. */
const SECRET_SETTINGS = ['sportsApiKey'];

/* Taket för en enskild vinst. Det är bara ett skyddsräcke mot orimliga tal –
   vanliga vinster, även flera miljoner, betalas ut i sin helhet. */
const CREDIT_MAX = 1000000000;

const uid = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');
const now = () => Date.now();
const hashPin = (pin, salt) => crypto.createHash('sha256').update(salt + '::' + pin).digest('hex');
const round2 = (n) => Math.round(n * 100) / 100;

/* Gummibandet: samma formel som public/js/luck.js. Har spelaren lite kvar
   blir turen högre, har spelaren vunnit mycket blir den lägre. */
const LUCK_MIN = 0.7;
const LUCK_MAX = 1.35;

function luckFactor(balance, startBalance) {
  const start = Number(startBalance);
  const bal = Math.max(0, Number(balance) || 0);
  if (!(start > 0)) return 1;
  const ratio = bal / start;
  let factor = 1;
  if (ratio < 1) factor = 1 + Math.min(0.35, (1 - ratio) * 0.35);
  else if (ratio > 1.5) factor = 1 - Math.min(0.3, (ratio - 1.5) * 0.2);
  return Math.round(Math.min(LUCK_MAX, Math.max(LUCK_MIN, factor)) * 100) / 100;
}

function playerLuck(player, settings) {
  const conf = settings || {};
  if (conf.rubberBand === false) return 1;
  return luckFactor(player && player.balance, conf.startBalance);
}

function luckPayout(stake, mult, factor) {
  const sats = Math.max(0, Number(stake) || 0);
  const m = Math.max(1, Number(mult) || 1);
  const f = Math.min(LUCK_MAX, Math.max(LUCK_MIN, Number(factor) || 1));
  const raw = sats + sats * (m - 1) * f;
  return Math.max(round2(raw), round2(sats * 1.01));
}

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
  // Kroppen kan behöva läsas igen om förfrågan körs om efter en skrivkonflikt.
  if (req.__parsedBody !== undefined) return Promise.resolve(req.__parsedBody);
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.__parsedBody = req.body;
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
      if (!raw) {
        req.__parsedBody = {};
        return resolve(req.__parsedBody);
      }
      try {
        req.__parsedBody = JSON.parse(raw);
        resolve(req.__parsedBody);
      } catch (err) {
        reject(new Error('Ogiltig JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Buffrar svaret så att databasen hinner sparas innan klienten får svar.
    Utan detta kan t.ex. en admin-inloggning se ut att lyckas medan sessionen
    ännu inte ligger i databasen – nästa anrop får då 401. */
function createBuffer() {
  const state = { status: 200, headers: {}, chunks: [] };
  const res = {
    headersSent: false,
    setHeader(name, value) {
      state.headers[String(name).toLowerCase()] = value;
    },
    writeHead(code, headers) {
      state.status = code;
      if (headers) {
        Object.keys(headers).forEach((k) => {
          state.headers[String(k).toLowerCase()] = headers[k];
        });
      }
      return res;
    },
    write(chunk) {
      if (chunk) state.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    end(chunk) {
      if (chunk) res.write(chunk);
      res.headersSent = true;
      return res;
    },
    flush(target) {
      target.writeHead(state.status, state.headers);
      target.end(state.chunks.length ? Buffer.concat(state.chunks) : undefined);
    }
  };
  return res;
}

function createApi({ loadDb, saveDb, adminCode = 'Vincent12' }) {
  const ADMIN_CODE = String(adminCode || 'Vincent12').trim();

  /* Admin-token signeras med koden själv i stället för att sparas i databasen.
     Då fungerar inloggningen även om skrivningen till lagret dröjer. */
  const ADMIN_TTL = 8 * 60 * 60 * 1000;
  const adminSecret = ADMIN_CODE + '::admin-token-v1';
  const signAdmin = (payload) =>
    crypto.createHmac('sha256', adminSecret).update(String(payload)).digest('hex').slice(0, 40);

  function issueAdminToken() {
    const expires = now() + ADMIN_TTL;
    const nonce = uid(6);
    return `${expires}.${nonce}.${signAdmin(expires + '.' + nonce)}`;
  }

  function verifyAdminToken(raw) {
    const parts = String(raw || '').split('.');
    if (parts.length !== 3) return null;
    const expires = Number(parts[0]);
    if (!Number.isFinite(expires) || expires < now()) return null;
    const want = signAdmin(expires + '.' + parts[1]);
    if (parts[2].length !== want.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(want))) return null;
    return { created: expires - ADMIN_TTL, expires };
  }

  let db = normalizeDb({});
  let dirty = false;

  /* ------------------------------ skärmtid ------------------------------ */

  const DAY_MS = 24 * 60 * 60 * 1000;
  const SCREEN_MAX_SEND = 600; // sekunder per rapportering (klienten skickar varje minut)
  const SCREEN_SESSION_GAP = 30 * 60 * 1000; // ny spelomgång efter 30 min utan aktivitet
  const SCREEN_KEEP_DAYS = 30;

  /** Datum i svensk tid, t.ex. 2026-11-03. */
  function dayKey(ts = Date.now()) {
    try {
      return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
    } catch (e) {
      return new Date(ts).toISOString().slice(0, 10);
    }
  }

  /** Lägger till skärmtid på en spelare och håller koll på dagar och omgångar. */
  function addScreenTime(player, seconds) {
    const secs = Math.min(SCREEN_MAX_SEND, Math.max(0, Math.round(Number(seconds) || 0)));
    if (!secs) return 0;

    player.screenTime = Math.round((player.screenTime || 0) + secs);
    player.screenDays = player.screenDays && typeof player.screenDays === 'object' ? player.screenDays : {};
    const key = dayKey();
    player.screenDays[key] = Math.round((player.screenDays[key] || 0) + secs);

    const days = Object.keys(player.screenDays).sort();
    while (days.length > SCREEN_KEEP_DAYS) delete player.screenDays[days.shift()];

    if (!player.screenLast || now() - player.screenLast > SCREEN_SESSION_GAP) {
      player.screenVisits = (player.screenVisits || 0) + 1;
    }
    player.screenLast = now();
    return secs;
  }

  /** Skärmtid för en dag, de senaste sju dagarna och i dag. */
  function screenStats(player) {
    const days = player.screenDays || {};
    const today = days[dayKey()] || 0;
    let week = 0;
    for (let i = 0; i < 7; i += 1) week += days[dayKey(Date.now() - i * DAY_MS)] || 0;
    return {
      screenTime: Math.round(player.screenTime || 0),
      screenToday: Math.round(today),
      screen7d: Math.round(week),
      screenVisits: player.screenVisits || 0,
      screenLast: player.screenLast || 0,
      screenDays: days
    };
  }

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
      gameStats: p.gameStats || {},
      ...screenStats(p)
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

  /** Kort fingeravtryck av inställningarna – ändras varje gång admin sparar. */
  function settingsVersion() {
    return crypto.createHash('sha1').update(JSON.stringify(publicSettings())).digest('hex').slice(0, 12);
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
      screenTime: 0,
      screenDays: {},
      screenVisits: 0,
      screenLast: 0,
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
    if (!token) return null;
    const signed = verifyAdminToken(token);
    if (signed) return signed;
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

  /* Live-flödet kan tappa en match mellan listningen och spelet (matchen
     hinner bli klar eller källan byter sida). Vi minns nyligen sedda matcher
     en stund, så ett spel som lagts från listan alltid går att lägga. */
  const MATCH_MEMORY_MS = 10 * 60 * 1000;
  const matchMemory = new Map();

  function rememberMatches(feed) {
    (feed.matches || []).forEach((m) => {
      if (m && m.id) matchMemory.set(String(m.id), { match: m, at: now() });
    });
    if (matchMemory.size > 400) {
      const sorted = [...matchMemory.entries()].sort((a, b) => a[1].at - b[1].at);
      sorted.slice(0, sorted.length - 400).forEach(([id]) => matchMemory.delete(id));
    }
  }

  function rememberedMatch(id) {
    const hit = matchMemory.get(String(id));
    if (!hit) return null;
    if (now() - hit.at > MATCH_MEMORY_MS) {
      matchMemory.delete(String(id));
      return null;
    }
    return hit.match;
  }

  async function sportsFeed(sport) {
    const kind = sport === 'hockey' ? 'hockey' : 'football';
    const feed = await sports.getFeed({
      sport: kind,
      margin: Number(db.settings.sportMargin) || 0,
      apiKey: db.settings.sportsApiKey || '',
      source: kind === 'hockey' ? 'auto' : db.settings.sportsSource || 'auto'
    });
    try {
      rememberMatches(feed);
    } catch (err) {
      /* minnet är bara en extra trygghet */
    }
    return feed;
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
      sport: bet.sport || 'football',
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
      luck: Number(bet.luck) || 1,
      potential: luckPayout(bet.stake, bet.odds, bet.luck),
      status: bet.status,
      placedAt: bet.placedAt,
      settledAt: bet.settledAt || null,
      payout: bet.payout || 0,
      result: bet.result || null
    };
  }

  /** Avgör öppna sportspel när matcherna är färdigspelade. */
  async function settleSports() {
    const open = (db.sportBets || []).filter((b) => b.status === 'open');
    if (!open.length) return { settled: 0, feeds: {} };
    const feeds = {};
    const kinds = [...new Set(open.map((b) => (b.sport === 'hockey' ? 'hockey' : 'football')))];
    await Promise.all(
      kinds.map(async (kind) => {
        try {
          feeds[kind] = await sportsFeed(kind);
        } catch (err) {
          feeds[kind] = null;
        }
      })
    );
    const indexes = {};
    kinds.forEach((kind) => {
      const feed = feeds[kind];
      indexes[kind] = feed ? new Map(feed.matches.map((m) => [m.id, m])) : null;
    });
    let settled = 0;
    open.forEach((bet) => {
      const kind = bet.sport === 'hockey' ? 'hockey' : 'football';
      const index = indexes[kind];
      if (!index) return;
      const player = db.players[bet.playerId];
      const match = index.get(bet.matchId);
      const decision = match ? sports.decideOutcome(match, bet) : null;
      if (match && match.status === 'finished' && decision) {
        bet.status = decision;
        bet.settledAt = now();
        bet.result = match.result ? match.result.home + '-' + match.result.away : null;
        if (decision === 'won' && player) {
          const payout = luckPayout(bet.stake, bet.odds, bet.luck);
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
    return { settled, feeds };
  }

  const routes = {
    'GET /api/health': async (req, res) =>
      json(res, 200, { ok: true, players: Object.keys(db.players).length }),

    'GET /api/settings': async (req, res) =>
      json(res, 200, { settings: publicSettings(), version: settingsVersion() }),

    'POST /api/guest': async (req, res) => {
      const body = await readBody(req);
      const player = newPlayer(body.name || '');
      json(res, 200, { token: player.token, player: publicPlayer(player), settings: publicSettings() });
    },

    // Klienten rapporterar hur länge fliken varit synlig – det är skärmtiden.
    'POST /api/screen': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      const body = await readBody(req);
      const added = addScreenTime(player, body.seconds);
      if (added) markDirty();
      json(res, 200, { ok: true, added, ...screenStats(player) });
    },

    'GET /api/me': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (player.banned) return json(res, 403, { error: 'Kontot är avstängt', banned: true });
      markDirty();
      json(res, 200, { player: publicPlayer(player), settings: publicSettings(), version: settingsVersion() });
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
      const wanted = Math.round(Number(body.amount) || 0);
      if (!Number.isFinite(wanted) || wanted <= 0) return json(res, 200, { balance: player.balance });
      // Quizbelöningen är fast per rätt svar. Övriga spel får betala ut hela
      // vinsten – även miljonvinster – och kläms bara mot ett skyddsräcke.
      const cap = game === 'quiz' ? 400 : CREDIT_MAX;
      const amount = Math.min(wanted, cap);
      const capped = amount < wanted;
      player.balance = round2(player.balance + amount);
      player.won = round2((player.won || 0) + amount);
      if (game === 'quiz') {
        player.quizCorrect =
          (player.quizCorrect || 0) + Math.max(1, Math.round(amount / Math.max(1, db.settings.quizReward)));
      }
      bumpGame(player, game, 'win', amount);
      logTransaction(player, 'vinst', game, amount, player.balance);
      markDirty();
      json(res, 200, { balance: player.balance, credited: amount, capped });
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
        openligadfb: 'https://api.openligadb.de/getmatchdata/dfb',
        fotmob2: 'https://www.fotmob.com/api/data/matches?date=' + new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        allorigins_espn: 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://site.api.espn.com/apis/site/v2/sports/soccer/swe.1/scoreboard'),
        codetabs_espn: 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent('https://site.api.espn.com/apis/site/v2/sports/soccer/swe.1/scoreboard'),
        allorigins_tsdb: 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=Soccer'),
        openfootball: 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/en.1.json',
        fotmobsample: 'https://www.fotmob.com/api/data/matches?date=' + new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        nhl_scoreboard: 'https://api-web.nhle.com/v1/scoreboard/now',
        nhl_schedule: 'https://api-web.nhle.com/v1/schedule/now',
        shl_ssgt: 'https://www.shl.se/api/sports-v2/latest-ssgt/qQ9-bb0bzEWUk',
        shl_today: 'https://www.shl.se/api/sports-v2/today-games',
        shl_next: 'https://www.shl.se/api/sports-v2/next-game-day',
        shl_games: 'https://www.shl.se/api/sports-v2/game-schedule',
        shl_today2: 'https://www.shl.se/api/sports-v2/today-games?seasonSeriesGameType=qa98unlbd6',
        shl_next2: 'https://www.shl.se/api/sports-v2/next-game-day?seasonSeriesGameType=qa98unlbd6'
      };
      const SHL_HEADERS = { 'x-s8y-instance-id': 'shl1_shl' };
      const target = targets[provider];
      if (!target) return json(res, 400, { error: 'Okänd provider', providers: Object.keys(targets) });
      const extraHeaders = provider.startsWith('shl_') ? SHL_HEADERS : {};
      try {
        const startedAt = now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const upstream = await fetch(target, {
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            'user-agent': 'Mozilla/5.0 (compatible; GoldenSpade/1.0)',
            ...extraHeaders
          }
        });
        clearTimeout(timer);
        const text = await upstream.text();
        if (provider === 'fotmobsample') {
          let out = { parseError: null, leagues: 0, sample: null, leaguesMeta: [] };
          try {
            const parsed = JSON.parse(text);
            const leagues = Array.isArray(parsed.leagues) ? parsed.leagues : [];
            out.leagues = leagues.length;
            out.leaguesMeta = leagues.slice(0, 6).map((l) => ({ name: l.name, ccode: l.ccode, id: l.id, internalRank: l.internalRank, matches: (l.matches || []).length }));
            const withMatches = leagues.find((l) => (l.matches || []).length);
            if (withMatches) out.sample = JSON.stringify(withMatches.matches[0]).slice(0, 1600);
            const swedish = leagues.find((l) => l.ccode === 'SWE');
            if (swedish) out.swedish = { name: swedish.name, sample: JSON.stringify((swedish.matches || [])[0] || null).slice(0, 1200) };
          } catch (e) {
            out.parseError = String(e.message || e);
            out.head = text.slice(0, 200);
          }
          return json(res, 200, out);
        }
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
          head: text.slice(0, 900),
          firstItem: (() => {
            try {
              const parsed = JSON.parse(text);
              const arr = Array.isArray(parsed) ? parsed : Object.values(parsed).find((v) => Array.isArray(v));
              return arr && arr[0] ? JSON.stringify(arr[0]).slice(0, 1200) : null;
            } catch (e) {
              return null;
            }
          })()
        });
      } catch (err) {
        json(res, 200, { provider, url: target, error: String(err.message || err) });
      }
    },

    /* ------------------------- fotboll / live-odds ------------------------- */

    'GET /api/sport/matches': async (req, res, url) => {
      const kind = url && url.searchParams.get('sport') === 'hockey' ? 'hockey' : 'football';
      const { feeds } = await settleSports();
      const data = (feeds && feeds[kind]) || (await sportsFeed(kind));
      const limit = betLimit();
      const player = findPlayerByToken(req);
      json(res, 200, {
        sport: kind,
        source: data.source,
        updatedAt: data.updatedAt,
        error: data.error,
        apiKeySet: !!data.apiKeySet,
        enabled: !!db.settings.sportEnabled,
        markets: sports.marketsFor(kind).map((m) => ({ key: m.key, label: m.label, short: m.short })),
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
      if (!db.settings.sportEnabled) return json(res, 403, { error: 'Sportspelen är stängda just nu' });
      if (db.settings.maintenance) return json(res, 403, { error: 'Spelhallen är i underhållsläge' });

      const body = await readBody(req);
      const kind = String(body.sport || '') === 'hockey' ? 'hockey' : 'football';
      const amount = Math.round(Number(body.amount) || 0);
      const matchId = String(body.matchId || '');
      const market = String(body.market || '');
      const selection = String(body.selection || '');
      const limit = betLimit();

      if (!(amount > 0)) return json(res, 400, { error: 'Ogiltig insats' });
      if (amount < limit.min) return json(res, 400, { error: 'Minsta insats är ' + limit.min + ' kr' });
      if (amount > limit.max) return json(res, 400, { error: 'Högsta insats för sportspel är ' + limit.max + ' kr' });
      if (amount > player.balance) return json(res, 400, { error: 'Du har inte tillräckligt med spelmynt' });

      const feed = await sportsFeed(kind);
      const match = feed.matches.find((m) => m.id === matchId) || rememberedMatch(matchId);
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
        sport: kind,
        matchLabel: match.home + ' – ' + match.away,
        league: match.league || '',
        market,
        marketLabel: marketData.label,
        selection,
        selectionLabel: pick.long || pick.label,
        stake: amount,
        odds,
        luck: playerLuck(player, db.settings),
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
      let hockeyFeed = null;
      try {
        const settledFeeds = (await settleSports()).feeds || {};
        feed = settledFeeds.football || (await sportsFeed('football'));
        hockeyFeed = settledFeeds.hockey || (await sportsFeed('hockey'));
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
          sources: sports.SOURCES,
          hockeySources: sports.HOCKEY_SOURCES
        },
        hockeyFeed: hockeyFeed
          ? {
              source: hockeyFeed.source,
              error: hockeyFeed.error || null,
              updatedAt: hockeyFeed.updatedAt || null,
              matches: (hockeyFeed.matches || []).length,
              live: (hockeyFeed.matches || []).filter((m) => m.live).length,
              tried: hockeyFeed.tried || []
            }
          : null,
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
      json(res, 200, { adminToken: issueAdminToken(), name: 'Casinochef' });
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
          acc.screenToday += p.screenToday || 0;
          acc.screen7d += p.screen7d || 0;
          acc.screenTime += p.screenTime || 0;
          acc.screenVisits += p.screenVisits || 0;
          return acc;
        },
        {
          wagered: 0,
          won: 0,
          balance: 0,
          rounds: 0,
          active24h: 0,
          screenToday: 0,
          screen7d: 0,
          screenTime: 0,
          screenVisits: 0
        }
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
        const value = Math.max(0, Math.min(CREDIT_MAX, Math.round(Number(body.value) || 0)));
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
      } else if (action === 'resetScreen') {
        player.screenTime = 0;
        player.screenDays = {};
        player.screenVisits = 0;
        player.screenLast = 0;
        logTransaction(player, 'admin', 'skärmtid nollställd', 0, player.balance);
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
      num('slotLuck', 0.1, 3);
      num('videoPokerLuck', 0.1, 3);
      num('scratchLuck', 0.1, 3);
      num('quizReward', 1, 200);
      num('dailyBonus', 0, 10000);
      num('sportMargin', 0, 20);
      num('sportMaxStake', 10, 50000);
      if (incoming.dealerHitsSoft17 !== undefined) next.dealerHitsSoft17 = !!incoming.dealerHitsSoft17;
      if (incoming.doubleAfterSplit !== undefined) next.doubleAfterSplit = !!incoming.doubleAfterSplit;
      if (incoming.maintenance !== undefined) next.maintenance = !!incoming.maintenance;
      if (incoming.sportEnabled !== undefined) next.sportEnabled = !!incoming.sportEnabled;
      if (incoming.rubberBand !== undefined) next.rubberBand = !!incoming.rubberBand;
      if (next.maxBet < next.minBet) next.maxBet = next.minBet;
      db.settings = next;
      markDirty();
      json(res, 200, { settings: publicSettings(), version: settingsVersion() });
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

        // En riktig storvinst får inte klippas – hela beloppet ska in på kontot.
        const big = await call('POST', '/api/credit', {
          headers: { 'x-token': token2 },
          body: { game: 'selftest-storvinst', amount: 3000000 }
        });
        check(
          'miljonvinst betalas ut i sin helhet',
          big.capped === false &&
            big.credited === 3000000 &&
            big.balance === credit.balance + 3000000,
          { credited: big.credited, capped: big.capped, balance: big.balance }
        );

        const bonus = await call('POST', '/api/bonus', { headers: { 'x-token': token2 } });
        check('bonus fungerar', bonus.balance === big.balance + db.settings.dailyBonus, bonus.balance);

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

        // Underhållsläget stänger sportspelen – då hoppar vi över de stegen.
        const closedForMaintenance =
          placed.__status === 403 && /underhåll/i.test(String(placed.error || ''));
        let sportPlaced = false;
        if (closedForMaintenance) {
          steps.push({ name: 'fotboll: spel placeras', ok: true, info: 'hoppas över – underhållsläge på' });
        } else {
          check(
            'fotboll: spel placeras',
            placed.bet && placed.bet.status === 'open' && placed.balance === me.player.balance - 50,
            { status: placed.__status, error: placed.error || null, odds: placed.bet && placed.bet.odds, balance: placed.balance }
          );
          sportPlaced = true;
        }

        const mine = await call('GET', '/api/sport/bets', { headers: { 'x-token': token2 } });
        if (sportPlaced) {
          check('fotboll: mina spel listas', mine.bets && mine.bets.length === 1 && mine.open === 1);
        }

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
          !!sportAdmin.feed && !!sportAdmin.feed.source && (!sportPlaced || (sportAdmin.open || []).length >= 1),
          { open: sportAdmin.open && sportAdmin.open.length, feed: sportAdmin.feed && sportAdmin.feed.source }
        );
        if (sportPlaced) {
          check(
            'fotboll räknas i vinststatistiken',
            overview.gameTotals && overview.gameTotals.sport && overview.gameTotals.sport.wagered >= 50,
            overview.gameTotals && overview.gameTotals.sport
          );
        }

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
        maintenance: !!db.settings.maintenance,
        storage: 'cloud'
      });
    },
  };

  /* Alla förfrågningar delar samma db-objekt i minnet. Kör dem en i taget så
     att två samtidiga anrop inte kan skriva över varandras ändringar. */
  let queue = Promise.resolve();

  function handle(req, res, url) {
    const run = queue.then(() => handleOne(req, res, url));
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function handleOne(req, res, url) {
    const pathname = url.pathname.replace(/\/+$/, '') || '/api';
    const key = req.method + ' ' + pathname;
    const handler = routes[key];

    /* Hela databasen läses och skrivs som en klump. Om en annan förfrågan
       hinner spara emellanåt får vi en skrivkonflikt – då läser vi om och
       kör om förfrågan med färska siffror i stället för att skriva tillbaka
       en gammal kopia (som skulle kunna sudda en annan spelares vinst eller
       en adminändring). */
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // Svaret buffras så att en skrivning hinner sparas innan klienten får svar.
      const out = createBuffer();

      try {
        db = normalizeDb(await loadDb());
      } catch (err) {
        console.error('Kunde inte läsa databasen:', err);
        json(out, 503, { error: 'Databasen är inte tillgänglig', detail: String(err.message || err) });
        out.flush(res);
        return;
      }
      dirty = false;

      if (!handler) {
        json(out, 404, { error: 'Okänd endpoint: ' + key });
        out.flush(res);
        return;
      }

      try {
        await handler(req, out, url);
      } catch (err) {
        console.error('Serverfel:', err);
        if (!out.headersSent) json(out, 500, { error: 'Serverfel: ' + err.message });
        else out.end();
      }

      if (dirty) {
        try {
          await saveDb(db);
          dirty = false;
        } catch (err) {
          if (err && err.conflict && attempt < MAX_ATTEMPTS) {
            console.warn(`Skrivkonflikt på ${key} – försök ${attempt} av ${MAX_ATTEMPTS}, läser om och kör igen`);
            continue;
          }
          console.error('Kunde inte spara databasen:', err);
          const fail = createBuffer();
          json(fail, 503, {
            error: 'Kunde inte spara ändringen – försök igen',
            retry: true
          });
          fail.flush(res);
          return;
        }
      }

      if (!out.headersSent) json(out, 200, { ok: true });
      out.flush(res);
      return;
    }
  }

  return { handle };
}

module.exports = { createApi, normalizeDb, DEFAULT_SETTINGS, cleanName, readBody, json };
