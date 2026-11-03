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
  mercifulDealer: true,
  doubleAfterSplit: true,
  slotLuck: 1,
  videoPokerLuck: 1,
  scratchLuck: 1,
  rouletteLuck: 1,
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

/* Det gamla taket som klippte stora vinster innan det togs bort. Servern
   sparade bara det klippta beloppet, så det går inte att räkna fram exakt
   hur stor vinsten var. Vi kan däremot hitta varje klippt vinst (beloppet
   ligger exakt på taket) och betala ut kompensation för den. */
const LEGACY_WIN_CAP = 250000;

/* Taket togs bort 2026-11-03 08:50 UTC. Vinster efter det kan inte ha
   klippts, så bara äldre vinster räknas som kompensationsgrund. */
const LEGACY_CAP_REMOVED_AT = Date.UTC(2026, 10, 3, 8, 50, 0);

/* Hemlig kod för roulettens kontrollpanel. Den gäller bara roulette och
   öppnar en panel där admin kan tvinga en spelares nästa snurr att bli en
   förlust. Koden är frivillig att byta här – klienten har samma siffror. */
const ROULETTE_CODE = '333333';

/* En tvingad förlust gäller bara en snurr och bara en stund. */
const RIG_TTL_MS = 15 * 60 * 1000;

/* Kontrollrummet rör bara spelare som är online – de som varit inne i
   appen de senaste två minuterna. Appen pingar /api/me varje minut, så en
   öppen flik räknas som online även om spelaren inte klickat på ett tag. */
const ONLINE_MS = 2 * 60 * 1000;

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
    payouts:
      src.payouts && typeof src.payouts === 'object'
        ? {
            keys: Array.isArray(src.payouts.keys) ? src.payouts.keys : [],
            runs: Array.isArray(src.payouts.runs) ? src.payouts.runs : []
          }
        : { keys: [], runs: [] },
    broadcast: typeof src.broadcast === 'string' ? src.broadcast : '',
    gifts: Array.isArray(src.gifts) ? src.gifts : [],
    rouletteRig:
      src.rouletteRig && typeof src.rouletteRig === 'object' ? src.rouletteRig : {},
    rouletteRigLog: Array.isArray(src.rouletteRigLog) ? src.rouletteRigLog : [],
    revolverTables:
      src.revolverTables && typeof src.revolverTables === 'object' ? src.revolverTables : {},
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

  /* ---- Paus: spelaren får plugga men inte spela ---- */

  /** Kvarvarande paustid i ms. 0 = inte pausad, -1 = pausad tills vidare. */
  function pauseLeft(player) {
    if (!player || !player.paused) return 0;
    if (!player.pausedUntil) return -1;
    const left = Number(player.pausedUntil) - now();
    return left > 0 ? left : 0;
  }

  function isPaused(player) {
    return pauseLeft(player) !== 0;
  }

  /** Tydligt svar till en pausad spelare – tiden räknas ned i klienten. */
  function pausedBody(player) {
    const left = pauseLeft(player);
    const minutes = left === -1 ? 0 : Math.ceil(left / 60000);
    return {
      error:
        left === -1
          ? 'Du är pausad – spelandet är avstängt tills personalen släpper på. Plugget funkar som vanligt.'
          : 'Du är pausad i ' + (minutes <= 1 ? 'mindre än en minut' : minutes + ' min') +
            ' – plugget funkar som vanligt.',
      paused: true,
      pausedUntil: left === -1 ? 0 : Number(player.pausedUntil) || 0,
      minutesLeft: minutes
    };
  }

  function publicPlayer(p) {
    const paused = isPaused(p);
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
      paused,
      pausedUntil: paused ? Number(p.pausedUntil) || 0 : 0,
      pausedForever: paused && !p.pausedUntil,
      lastBonus: p.lastBonus || 0,
      biggestWin: p.biggestWin || 0,
      net: round2((p.won || 0) - (p.wagered || 0)),
      gameStats: p.gameStats || {},
      look: ateljeLook(p),
      owned: ateljeOwned(p),
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

  /* Hittar vinster som låg exakt på det gamla taket – de klipptes av servern
     innan taket togs bort. Nyckeln gör att en vinst bara kan betalas ut en gång. */
  function legacyClippedWins() {
    const found = new Map();
    const paid = new Set(db.payouts.keys);
    const consider = (playerId, entry) => {
      if (!playerId || !db.players[playerId]) return;
      if (!entry || String(entry.kind) !== 'vinst') return;
      if (String(entry.game) === 'quiz') return;
      if (Math.abs(Number(entry.amount) - LEGACY_WIN_CAP) > 0.01) return;
      // Efter att taket togs bort kan en vinst på exakt 250 000 vara en ärlig vinst.
      if (!(Number(entry.t) > 0) || Number(entry.t) >= LEGACY_CAP_REMOVED_AT) return;
      const key = playerId + ':' + entry.t;
      if (paid.has(key)) return;
      const list = found.get(playerId) || [];
      if (list.some((x) => x.key === key)) return;
      list.push({ key, t: entry.t, game: String(entry.game || 'spel'), amount: Number(entry.amount) });
      found.set(playerId, list);
    };
    db.transactions.forEach((tx) => consider(tx.playerId, tx));
    Object.values(db.players).forEach((player) =>
      (player.log || []).forEach((entry) => consider(player.id, entry))
    );
    return found;
  }

  /* Vad varje spelare har till godo för klippta vinster. */
  function compensationPreview(perWin, onlyPlayerId) {
    const amountPerWin = Math.max(0, Math.round(Number(perWin) || LEGACY_WIN_CAP));
    const found = legacyClippedWins();
    const players = [];
    let total = 0;
    let winCount = 0;
    found.forEach((wins, playerId) => {
      if (onlyPlayerId && playerId !== onlyPlayerId) return;
      const player = db.players[playerId];
      if (!player) return;
      const owed = round2(wins.length * amountPerWin);
      total = round2(total + owed);
      winCount += wins.length;
      players.push({
        id: playerId,
        name: player.name,
        balance: player.balance,
        after: round2(player.balance + owed),
        wins,
        winCount: wins.length,
        owed
      });
    });
    players.sort((a, b) => b.owed - a.owed);
    return { legacyCap: LEGACY_WIN_CAP, perWin: amountPerWin, players, playerCount: players.length, winCount, total };
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

  /* Alla måste ha ett eget konto (namn + PIN) innan de kan spela, ta bonus
     eller få quizmynt. Gästkontot som skapas vid första besöket får bara
     läsa och byta namn – det räcker inte för att spela. */
  const ACCOUNT_REQUIRED = 'Skapa ett konto först – alla måste ha ett eget konto i Plugghörnan';

  function accountBlocked(player) {
    return !player || !player.pinHash;
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

  /* ------------------------------ roulettens kontrollpanel ------------------------------ */

  function rouletteRigMap() {
    if (!db.rouletteRig || typeof db.rouletteRig !== 'object') db.rouletteRig = {};
    return db.rouletteRig;
  }

  function rouletteRigLog() {
    if (!Array.isArray(db.rouletteRigLog)) db.rouletteRigLog = [];
    return db.rouletteRigLog;
  }

  /* Panelen kräver den hemliga roulettekoden och en spelare med eget konto –
     en gäst som inte skapat konto kommer inte åt den. Admin går före. */
  function rouletteController(req, body) {
    if (adminFromRequest(req)) return { by: 'admin' };
    const player = findPlayerByToken(req);
    if (accountBlocked(player)) return null;
    const code = String((req.headers && req.headers['x-roulette-code']) || (body && body.code) || '').trim();
    if (code && code === ROULETTE_CODE) return { by: 'kod' };
    return null;
  }

  /* En tvingad förlust som legat kvar för länge gäller inte längre. */
  function activeRig(playerId) {
    const rig = rouletteRigMap()[playerId];
    if (!rig) return null;
    if (!(rig.at > 0) || now() - rig.at > RIG_TTL_MS) {
      delete rouletteRigMap()[playerId];
      markDirty();
      return null;
    }
    return rig;
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

  /* ------------------------------ rysk roulette mot varandra ------------------------------ */

  /* Ett bord där 2–6 spelare lägger samma insats i en gemensam kassa. Sedan
     turas de om att trycka av samma revolver: tom kammare = du lever och
     turen går vidare, kulan = du är ute. Den som står kvar ensam tar hela
     kassan. Huset tar ingenting – alla mynt som läggs i kassan betalas ut
     igen. Kulan dras alltid på servern, så ingen klient kan se var den ligger. */
  const RVB_GAME = 'revolverbord';
  const RVB = {
    CHAMBERS: 6,
    MAX_SEATS: 6,
    MIN_SEATS: 2,
    TURN_MS: 45 * 1000, // tid att trycka av innan bordet gör det åt dig
    LOBBY_MS: 10 * 60 * 1000, // tomt väntrum stängs och betalar tillbaka
    IDLE_MS: 15 * 60 * 1000, // stillastående match avbryts
    KEEP_MS: 20 * 60 * 1000, // färdiga bord ligger kvar en stund
    LOG_MAX: 14
  };

  function rvbTables() {
    if (!db.revolverTables || typeof db.revolverTables !== 'object') db.revolverTables = {};
    return db.revolverTables;
  }

  function rvbTable(id) {
    const key = String(id || '');
    if (!key) return null;
    const table = rvbTables()[key];
    return table && typeof table === 'object' ? table : null;
  }

  function rvbSeatOf(table, playerId) {
    return (table.seats || []).find((s) => s.playerId === playerId) || null;
  }

  function rvbAliveSeats(table) {
    return (table.seats || []).filter((s) => s.alive && !s.left);
  }

  function rvbNextAlive(table, from) {
    const seats = table.seats || [];
    for (let step = 1; step <= seats.length; step += 1) {
      const i = (from + step) % seats.length;
      if (seats[i].alive && !seats[i].left) return i;
    }
    return -1;
  }

  function rvbLog(table, kind, text) {
    if (!Array.isArray(table.log)) table.log = [];
    table.log.unshift({ t: now(), kind, text });
    table.log = table.log.slice(0, RVB.LOG_MAX);
  }

  /* En jämn kammare ur de sex – kulan läggs bara här på servern. */
  function rvbChamber() {
    return crypto.randomInt(0, RVB.CHAMBERS);
  }

  function rvbTouch(table) {
    table.updatedAt = now();
    markDirty();
  }

  /* Insatsen till kassan dras precis som ett vanligt spel: saldo, statistik
     och en rad i spelloggen. */
  function rvbTakeAnte(player, amount, table) {
    const ante = round2(amount);
    player.balance = round2(player.balance - ante);
    player.wagered = round2((player.wagered || 0) + ante);
    player.rounds = (player.rounds || 0) + 1;
    bumpGame(player, RVB_GAME, 'bet', ante);
    logTransaction(player, 'insats', RVB_GAME, -ante, player.balance);
    table.pot = round2((table.pot || 0) + ante);
    return ante;
  }

  function rvbPayWin(player, amount) {
    const win = Math.min(round2(amount), CREDIT_MAX);
    player.balance = round2(player.balance + win);
    player.won = round2((player.won || 0) + win);
    bumpGame(player, RVB_GAME, 'win', win);
    logTransaction(player, 'vinst', RVB_GAME, win, player.balance);
    return win;
  }

  function rvbRefund(player, amount) {
    const back = round2(Math.max(0, Number(amount) || 0));
    if (!back) return 0;
    player.balance = round2(player.balance + back);
    logTransaction(player, 'aterbetalning', RVB_GAME, back, player.balance);
    return back;
  }

  /* Sista spelaren kvar tar kassan – hela potten, utan avdrag. */
  function rvbFinish(table, winnerSeat) {
    table.phase = 'done';
    table.turn = -1;
    table.autoAt = 0;
    table.finishedAt = now();
    const prize = round2(table.pot || 0);
    table.prize = prize;
    table.pot = 0;
    table.winner = winnerSeat ? { playerId: winnerSeat.playerId, name: winnerSeat.name } : null;
    const winner = winnerSeat ? db.players[winnerSeat.playerId] : null;
    if (winnerSeat && winner && !winner.banned) {
      rvbPayWin(winner, prize);
      rvbLog(table, 'vinst', `🏆 ${winnerSeat.name} står kvar och tar hela kassan: ${Math.round(prize)} kr`);
    } else {
      rvbLog(table, 'slut', 'Ingen stod kvar – kassan betalades tillbaka.');
      (table.seats || []).forEach((seat) => {
        const p = db.players[seat.playerId];
        if (p) rvbRefund(p, table.ante);
      });
      table.prize = 0;
    }
    rvbTouch(table);
    return table.winner;
  }

  /* Ett klick på avtryckaren. Kammaren som ligger under hanen avgör. */
  function rvbPull(table, seatIndex) {
    const seat = (table.seats || [])[seatIndex];
    if (!seat || !seat.alive || seat.left) return { error: 'Du är inte med i matchen längre' };

    const chamber = Number(table.cyclePulls) || 0;
    const fires = chamber === Number(table.bullet);
    table.cyclePulls = chamber + 1;
    table.pulls = (table.pulls || 0) + 1;
    table.lastPull = { seat: seatIndex, playerId: seat.playerId, chamber: chamber + 1, fires, at: now() };

    if (fires) {
      seat.alive = false;
      seat.outAt = now();
      table.bangs = (table.bangs || 0) + 1;
      rvbLog(table, 'bang', `💥 PANG! ${seat.name} är ute – kammare ${chamber + 1} var laddad.`);
      /* Ny laddning: kulan ligger på ett nytt hemligt ställe och nästa
         levande spelare efter den som sköts börjar. */
      table.cyclePulls = 0;
      table.bullet = rvbChamber();
      table.cycle = (table.cycle || 0) + 1;
      const left = rvbAliveSeats(table);
      if (left.length <= 1) {
        rvbFinish(table, left[0] || null);
        return { fires: true, finished: true };
      }
      table.turn = rvbNextAlive(table, seatIndex);
    } else {
      rvbLog(table, 'klick', `Klick ${chamber + 1}: tom kammare – ${seat.name} lever.`);
      table.turn = rvbNextAlive(table, seatIndex);
    }

    table.autoAt = now() + RVB.TURN_MS;
    rvbTouch(table);
    return { fires };
  }

  /* Har spelaren inte tryckt av i tid gör bordet det åt hen. */
  function rvbAutoAdvance(table) {
    if (!table || table.phase !== 'playing') return;
    let guard = 0;
    while (table.phase === 'playing' && Number(table.autoAt) > 0 && now() > Number(table.autoAt) && guard < 4) {
      guard += 1;
      const seat = (table.seats || [])[table.turn];
      if (!seat || !seat.alive || seat.left) {
        table.turn = rvbNextAlive(table, Number(table.turn) || 0);
        if (table.turn < 0) {
          rvbFinish(table, null);
          return;
        }
        table.autoAt = now() + RVB.TURN_MS;
        rvbTouch(table);
        continue;
      }
      rvbLog(table, 'auto', `⏱ ${seat.name} lät tiden gå – bordet tryckte av åt hen.`);
      rvbPull(table, table.turn);
    }
  }

  /* Städning: tomma väntrum stängs, stillastående matcher avbryts och gamla
     bord försvinner. Alla som fortfarande sitter vid bordet får sin insats
     tillbaka när ett bord stängs utan vinnare. */
  function rvbSweep() {
    const tables = rvbTables();
    Object.keys(tables).forEach((id) => {
      const table = tables[id];
      if (!table || typeof table !== 'object') {
        delete tables[id];
        markDirty();
        return;
      }
      const touched = Number(table.updatedAt) || Number(table.finishedAt) || Number(table.createdAt) || 0;
      const age = now() - touched;

      if (table.phase === 'done') {
        if (now() - (Number(table.finishedAt) || 0) > RVB.KEEP_MS) {
          delete tables[id];
          markDirty();
        }
        return;
      }

      const refundSeats = () => {
        (table.seats || []).forEach((seat) => {
          if (seat.left) return;
          const p = db.players[seat.playerId];
          if (p) rvbRefund(p, table.ante);
        });
        table.pot = 0;
        table.prize = 0;
        table.winner = null;
        table.turn = -1;
        table.autoAt = 0;
        table.phase = 'done';
        table.finishedAt = now();
      };

      if (table.phase === 'lobby' && age > RVB.LOBBY_MS) {
        refundSeats();
        table.expired = true;
        rvbLog(table, 'slut', 'Bordet stängdes – alla fick tillbaka sin insats.');
        rvbTouch(table);
        return;
      }

      if (table.phase === 'playing' && age > RVB.IDLE_MS) {
        refundSeats();
        table.voided = true;
        rvbLog(table, 'slut', 'Matchen avbröts – alla fick tillbaka sin insats.');
        rvbTouch(table);
      }
    });
  }

  /** Bordsläget som klienterna ser det. Kulan avslöjas aldrig i förväg. */
  function rvbPublic(table, viewer) {
    const seats = (table.seats || []).map((seat, index) => ({
      index,
      playerId: seat.playerId,
      name: seat.name,
      alive: !!seat.alive && !seat.left,
      left: !!seat.left,
      isYou: !!viewer && viewer.id === seat.playerId,
      isHost: table.hostId === seat.playerId,
      isTurn: table.phase === 'playing' && Number(table.turn) === index
    }));
    const turnSeat = table.phase === 'playing' ? seats[Number(table.turn)] || null : null;
    const me = viewer ? seats.find((s) => s.playerId === viewer.id) || null : null;
    const autoAt = Number(table.autoAt) || 0;
    const lastPull = table.lastPull && typeof table.lastPull === 'object' ? table.lastPull : null;
    return {
      id: table.id,
      ante: round2(table.ante),
      pot: round2(table.pot || 0),
      prize: round2(table.prize || 0),
      phase: table.phase,
      hostId: table.hostId,
      hostName: table.hostName,
      seats,
      seated: seats.filter((s) => !s.left).length,
      maxSeats: RVB.MAX_SEATS,
      minSeats: RVB.MIN_SEATS,
      chambers: RVB.CHAMBERS,
      turn: table.phase === 'playing' ? Number(table.turn) : -1,
      turnName: turnSeat ? turnSeat.name : '',
      turnPlayerId: turnSeat ? turnSeat.playerId : null,
      chamberNo: Math.min(RVB.CHAMBERS, (Number(table.cyclePulls) || 0) + 1),
      pulls: Number(table.pulls) || 0,
      bangs: Number(table.bangs) || 0,
      cycle: Number(table.cycle) || 0,
      autoAt,
      secondsLeft: autoAt ? Math.max(0, Math.ceil((autoAt - now()) / 1000)) : 0,
      turnMs: RVB.TURN_MS,
      log: (table.log || []).slice(0, 8),
      lastPull,
      winner: table.winner || null,
      finishedAt: Number(table.finishedAt) || 0,
      voided: !!table.voided,
      expired: !!table.expired,
      isHost: !!viewer && viewer.id === table.hostId,
      you: me ? { seat: me.index, alive: me.alive, isTurn: !!turnSeat && turnSeat.playerId === me.playerId } : null,
      serverNow: now()
    };
  }

  /* Gemensamma kontroller för alla bordsanrop. */
  function rvbPlayerOrError(req, res) {
    const player = findPlayerByToken(req);
    if (!player) {
      json(res, 401, { error: 'Ingen giltig session' });
      return null;
    }
    if (player.banned) {
      json(res, 403, { error: 'Kontot är avstängt', banned: true });
      return null;
    }
    if (isPaused(player)) {
      json(res, 403, pausedBody(player));
      return null;
    }
    if (accountBlocked(player)) {
      json(res, 403, { error: ACCOUNT_REQUIRED, needAccount: true });
      return null;
    }
    return player;
  }

  function rvbActiveTableOf(player) {
    return (
      Object.values(rvbTables()).find(
        (t) => t && t.phase !== 'done' && t.seats && t.seats.some((s) => s.playerId === player.id && !s.left)
      ) || null
    );
  }

  function rvbLimits() {
    const min = Math.max(1, Math.min(Number(db.settings.minBet) || 10, 100000));
    const max = Math.max(min, Math.min(Number(db.settings.maxBet) || 500, 100000));
    return { min, max };
  }


  /* ------------------------------ ateljén ------------------------------ */

  /* Katalogen över allt man kan köpa i ateljén. Samma lista finns i
     public/js/look.js (klienten behöver den för att rita), och npm run audit
     jämför de två – priser och ägande avgörs alltid här på servern. */
  const ATELJE_ITEMS = [
  /* Figur – den som sitter på avataren */
  { id: 'fox', kind: 'emblem', name: 'Räven', emoji: '🦊', price: 0 },
  { id: 'panda', kind: 'emblem', name: 'Pandan', emoji: '🐼', price: 150 },
  { id: 'bee', kind: 'emblem', name: 'Biet', emoji: '🐝', price: 200 },
  { id: 'frog', kind: 'emblem', name: 'Grodan', emoji: '🐸', price: 250 },
  { id: 'owl', kind: 'emblem', name: 'Ugglan', emoji: '🦉', price: 400 },
  { id: 'octopus', kind: 'emblem', name: 'Bläckfisken', emoji: '🐙', price: 500 },
  { id: 'tiger', kind: 'emblem', name: 'Tigern', emoji: '🐯', price: 700 },
  { id: 'unicorn', kind: 'emblem', name: 'Enhörningen', emoji: '🦄', price: 900 },
  { id: 'dragon', kind: 'emblem', name: 'Drakägget', emoji: '🐲', price: 2500, requires: { quizCorrect: 100 } },

  /* Accessoar – det lilla som sitter i hörnet */
  { id: 'none', kind: 'accent', name: 'Ingen', emoji: '', price: 0 },
  { id: 'sparkle', kind: 'accent', name: 'Glitter', emoji: '✨', price: 100 },
  { id: 'bow', kind: 'accent', name: 'Rosetten', emoji: '🎀', price: 250 },
  { id: 'flower', kind: 'accent', name: 'Blomman', emoji: '🌸', price: 300 },
  { id: 'headphones', kind: 'accent', name: 'Hörlurarna', emoji: '🎧', price: 600 },
  { id: 'shades', kind: 'accent', name: 'Solglasögonen', emoji: '🕶️', price: 800 },
  { id: 'crown', kind: 'accent', name: 'Kronan', emoji: '👑', price: 1200 },
  { id: 'star', kind: 'accent', name: 'Stjärnan', emoji: '⭐', price: 1500, requires: { quizCorrect: 50 } },

  /* Färg – ringen runt figuren */
  { id: 'mint', kind: 'color', name: 'Mint', emoji: '', price: 0 },
  { id: 'sunset', kind: 'color', name: 'Solnedgång', emoji: '', price: 150 },
  { id: 'ocean', kind: 'color', name: 'Havet', emoji: '', price: 150 },
  { id: 'candy', kind: 'color', name: 'Godis', emoji: '', price: 300 },
  { id: 'berry', kind: 'color', name: 'Blåbär', emoji: '', price: 400 },
  { id: 'galaxy', kind: 'color', name: 'Galaxen', emoji: '', price: 900 },
  { id: 'gold', kind: 'color', name: 'Guld', emoji: '', price: 2000, requires: { quizCorrect: 200 } },

  /* Rummet – saker som står i din hörna */
  { id: 'balloon', kind: 'room', name: 'Ballongen', emoji: '🎈', price: 120 },
  { id: 'lamp', kind: 'room', name: 'Lampan', emoji: '💡', price: 150 },
  { id: 'plant', kind: 'room', name: 'Monstera', emoji: '🪴', price: 200 },
  { id: 'candle', kind: 'room', name: 'Ljuset', emoji: '🕯️', price: 250 },
  { id: 'teddy', kind: 'room', name: 'Nallen', emoji: '🧸', price: 350 },
  { id: 'art', kind: 'room', name: 'Tavlan', emoji: '🖼️', price: 400 },
  { id: 'books', kind: 'room', name: 'Bokhyllan', emoji: '📚', price: 500 },
  { id: 'mirror', kind: 'room', name: 'Spegeln', emoji: '🪞', price: 650 },
  { id: 'guitar', kind: 'room', name: 'Gitarren', emoji: '🎸', price: 700 },
  { id: 'sofa', kind: 'room', name: 'Soffan', emoji: '🛋️', price: 800 },
  { id: 'window', kind: 'room', name: 'Fönstret', emoji: '🪟', price: 900 },
  { id: 'cat', kind: 'room', name: 'Katten', emoji: '🐈', price: 1000 },
  { id: 'disco', kind: 'room', name: 'Discokulan', emoji: '🪩', price: 1800, requires: { quizCorrect: 150 } }
];

  const ATELJE_ROOM_SLOTS = 8;
  const ATELJE_DEFAULT_LOOK = { emblem: 'fox', accent: 'none', color: 'mint', room: [] };
  const ATELJE_BY_ID = new Map(ATELJE_ITEMS.map((item) => [item.id, item]));

  function ateljeOwned(player) {
    const list = player && Array.isArray(player.owned) ? player.owned : [];
    return list.filter((id) => ATELJE_BY_ID.has(String(id)));
  }

  /** Gratis saker ägs av alla, resten måste vara köpt. */
  function ateljeOwns(player, id) {
    const item = ATELJE_BY_ID.get(String(id || ''));
    if (!item) return false;
    if (item.price === 0) return true;
    return ateljeOwned(player).includes(item.id);
  }

  /** Utseendet som spelaren faktiskt har rätt till – aldrig något hen inte äger. */
  function ateljeLook(player) {
    const src = player && player.look && typeof player.look === 'object' ? player.look : {};
    const pick = (kind, value, fallback) => {
      const item = ATELJE_BY_ID.get(String(value || ''));
      return item && item.kind === kind && ateljeOwns(player, item.id) ? item.id : fallback;
    };
    const room = (Array.isArray(src.room) ? src.room : [])
      .map((id) => ATELJE_BY_ID.get(String(id || '')))
      .filter((item) => item && item.kind === 'room' && ateljeOwns(player, item.id))
      .map((item) => item.id)
      .slice(0, ATELJE_ROOM_SLOTS);
    return {
      emblem: pick('emblem', src.emblem, ATELJE_DEFAULT_LOOK.emblem),
      accent: pick('accent', src.accent, ATELJE_DEFAULT_LOOK.accent),
      color: pick('color', src.color, ATELJE_DEFAULT_LOOK.color),
      room
    };
  }

  /** Vissa saker kräver att man har pluggat – då syns hur många rätt som saknas. */
  function ateljeLocked(player, item) {
    const need = item && item.requires ? Number(item.requires.quizCorrect) || 0 : 0;
    if (!need) return null;
    const have = Number(player && player.quizCorrect) || 0;
    return have >= need ? null : { quizCorrect: need, have };
  }

  function ateljeState(player) {
    return {
      look: ateljeLook(player),
      owned: ateljeOwned(player),
      balance: round2(player.balance),
      quizCorrect: Number(player.quizCorrect) || 0,
      roomSlots: ATELJE_ROOM_SLOTS,
      catalog: ATELJE_ITEMS,
      needAccount: accountBlocked(player)
    };
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
      if (isPaused(player)) return json(res, 403, pausedBody(player));
      if (accountBlocked(player)) {
        return json(res, 403, { error: ACCOUNT_REQUIRED, needAccount: true });
      }
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

      /* Roulettens hemliga kontroll: en tvingad förlust gäller spelarens
         nästa snurr och plockas bort direkt så den bara slår en gång. */
      let rig = null;
      if (game === 'roulette') {
        const pending = activeRig(player.id);
        if (pending) {
          rig = 'lose';
          rouletteRigLog().unshift({
            playerId: player.id,
            playerName: player.name,
            mode: pending.mode,
            at: now(),
            stake: amount
          });
          db.rouletteRigLog = rouletteRigLog().slice(0, 40);
          if (pending.mode === 'loseAlways') {
            // Gäller tills admin släpper: nollställ klockan så den inte slutar av sig själv.
            pending.at = now();
            pending.used = (pending.used || 0) + 1;
          } else {
            delete rouletteRigMap()[player.id];
          }
        }
      }
      markDirty();
      json(res, 200, { balance: player.balance, rig });
    },

    'POST /api/credit': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (player.banned) return json(res, 403, { error: 'Kontot är avstängt' });
      if (accountBlocked(player)) {
        return json(res, 403, { error: ACCOUNT_REQUIRED, needAccount: true });
      }
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

    /* Studie-loggen: varje svar i plugget hamnar här, så eleven kan gå
       tillbaka och se vad hen gjort. Kasinots logg är en egen lista. */
    'POST /api/study/log': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (accountBlocked(player)) {
        return json(res, 403, { error: ACCOUNT_REQUIRED, needAccount: true });
      }
      const body = await readBody(req);
      const subject = String(body.subject || '').slice(0, 20);
      const subjectKey = ['matte', 'engelska', 'svenska', 'geografi', 'utmaning'].includes(subject) ? subject : 'utmaning';
      const entry = {
        t: now(),
        subject: subjectKey,
        correct: body.correct !== false,
        coins: Math.max(0, Math.min(400, Math.round(Number(body.coins) || 0)))
      };
      player.studyLog = Array.isArray(player.studyLog) ? player.studyLog : [];
      player.studyLog.unshift(entry);
      player.studyLog = player.studyLog.slice(0, 120);
      markDirty();
      json(res, 200, { ok: true, entry, total: player.studyLog.length });
    },

    /* Spelarens egna loggar: studieloggen (plugget) och kasinologgen (mynten). */
    'GET /api/log': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (accountBlocked(player)) {
        return json(res, 403, { error: ACCOUNT_REQUIRED, needAccount: true });
      }
      const dayKey = (ts) => {
        try {
          return new Date(Number(ts) || 0).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
        } catch (e) {
          return '';
        }
      };
      const today = dayKey(now());
      const study = Array.isArray(player.studyLog) ? player.studyLog.slice(0, 120) : [];
      const coins = Array.isArray(player.log) ? player.log.slice(0, 60) : [];
      const todayStudy = study.filter((e) => dayKey(e.t) === today);
      json(res, 200, {
        study,
        coins,
        balance: player.balance,
        quizCorrect: player.quizCorrect || 0,
        today: {
          answers: todayStudy.length,
          correct: todayStudy.filter((e) => e.correct).length,
          coins: round2(todayStudy.reduce((sum, e) => sum + (Number(e.coins) || 0), 0))
        }
      });
    },

    /* Topplistan: vem som har mest spelmynt. Alla spelare får se namn, saldo
       och spelstatistik – aldrig kontouppgifter som PIN eller token. */
    'GET /api/leaderboard': async (req, res, url) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      const wanted = String(url.searchParams.get('by') || 'balance');
      const by = ['balance', 'won', 'biggestWin'].includes(wanted) ? wanted : 'balance';
      const rows = Object.values(db.players).map((p) => ({
        id: p.id,
        name: p.name,
        balance: round2(p.balance || 0),
        won: round2(p.won || 0),
        wagered: round2(p.wagered || 0),
        rounds: p.rounds || 0,
        biggestWin: round2(p.biggestWin || 0),
        quizCorrect: p.quizCorrect || 0,
        isGuest: !p.pinHash,
        banned: !!p.banned,
        me: p.id === player.id
      }));
      const score = (row) => Number(row[by]) || 0;
      rows.sort(
        (a, b) =>
          score(b) - score(a) ||
          b.balance - a.balance ||
          String(a.name || '').localeCompare(String(b.name || ''), 'sv')
      );
      const myIndex = rows.findIndex((r) => r.me);
      const top = rows.slice(0, 50).map((row, i) => ({ ...row, rank: i + 1 }));
      json(res, 200, {
        by,
        total: rows.length,
        pool: round2(rows.reduce((sum, r) => sum + (r.balance || 0), 0)),
        players: top,
        me: myIndex >= 0
          ? { ...rows[myIndex], rank: myIndex + 1, inTop: myIndex < 50 }
          : null
      });
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
      if (isPaused(player)) return json(res, 403, pausedBody(player));
      if (accountBlocked(player)) {
        return json(res, 403, { error: ACCOUNT_REQUIRED, needAccount: true });
      }
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
      if (accountBlocked(player)) {
        return json(res, 403, { error: ACCOUNT_REQUIRED, needAccount: true });
      }
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
        gifts: db.gifts.slice(0, 10),
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
      } else if (action === 'pause') {
        /* 0 = släpp pausen, positiva tal = minuter, -1 = tills vidare. */
        const minutes = Math.round(Number(body.value));
        if (!Number.isFinite(minutes) || minutes < -1) {
          return json(res, 400, { error: 'Ogiltig paustid' });
        }
        if (minutes === 0) {
          player.paused = false;
          player.pausedUntil = 0;
          logTransaction(player, 'admin', 'paus släppt', 0, player.balance);
        } else {
          player.paused = true;
          player.pausedAt = now();
          player.pausedUntil = minutes > 0 ? now() + Math.min(minutes, 60 * 24 * 30) * 60000 : 0;
          logTransaction(player, 'admin', 'pausad', 0, player.balance);
        }
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
      num('rouletteLuck', 0.1, 3);
      num('quizReward', 1, 200);
      num('dailyBonus', 0, 10000);
      num('sportMargin', 0, 20);
      num('sportMaxStake', 10, 50000);
      if (incoming.dealerHitsSoft17 !== undefined) next.dealerHitsSoft17 = !!incoming.dealerHitsSoft17;
      if (incoming.mercifulDealer !== undefined) next.mercifulDealer = !!incoming.mercifulDealer;
      if (incoming.doubleAfterSplit !== undefined) next.doubleAfterSplit = !!incoming.doubleAfterSplit;
      if (incoming.maintenance !== undefined) next.maintenance = !!incoming.maintenance;
      if (incoming.sportEnabled !== undefined) next.sportEnabled = !!incoming.sportEnabled;
      if (incoming.rubberBand !== undefined) next.rubberBand = !!incoming.rubberBand;
      if (next.maxBet < next.minBet) next.maxBet = next.minBet;
      db.settings = next;
      markDirty();
      json(res, 200, { settings: publicSettings(), version: settingsVersion() });
    },

    /* Utbetalning till spelare som fick mindre betalt än de skulle innan
       vinsttaket togs bort. Förhandsgranskning först, sedan en bekräftad
       utbetalning som loggas och bara kan göras en gång per vinst. */
    'GET /api/admin/compensation': async (req, res, url) => {
      if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
      const preview = compensationPreview(url.searchParams.get('perWin'), url.searchParams.get('playerId'));
      json(res, 200, { ...preview, runs: db.payouts.runs.slice(0, 5) });
    },

    'POST /api/admin/compensation': async (req, res) => {
      if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
      const body = await readBody(req);
      const onlyPlayerId = body.playerId ? String(body.playerId) : null;
      const preview = compensationPreview(body.perWin, onlyPlayerId);

      if (!preview.playerCount) {
        return json(res, 200, {
          ok: false,
          reason: 'Inga klippta vinster kvar att betala ut',
          ...preview
        });
      }
      if (body.confirm !== true) {
        return json(res, 400, { error: 'Bekräfta utbetalningen först', ...preview });
      }

      const paidPlayers = [];
      preview.players.forEach((row) => {
        const player = db.players[row.id];
        if (!player) return;
        player.balance = round2(player.balance + row.owed);
        logTransaction(player, 'utbetalning', 'kompensation', row.owed, player.balance);
        row.wins.forEach((win) => db.payouts.keys.push(win.key));
        paidPlayers.push({
          id: row.id,
          name: player.name,
          amount: row.owed,
          wins: row.winCount,
          balance: player.balance
        });
      });
      db.payouts.keys = db.payouts.keys.slice(-4000);
      const run = {
        at: now(),
        perWin: preview.perWin,
        total: preview.total,
        players: paidPlayers.length,
        winCount: preview.winCount
      };
      db.payouts.runs.unshift(run);
      db.payouts.runs = db.payouts.runs.slice(0, 50);
      markDirty();
      json(res, 200, { ok: true, run, players: paidPlayers, ...preview });
    },

    'POST /api/admin/broadcast': async (req, res) => {
      if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
      const body = await readBody(req);
      db.broadcast = String(body.message || '').slice(0, 240);
      markDirty();
      json(res, 200, { broadcast: db.broadcast });
    },

    /* Gratis gåva till alla konton. Utan confirm svarar rutten bara med en
       förhandsvisning, så inget delas ut av misstag. */
    'POST /api/admin/gift': async (req, res) => {
      if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
      const body = await readBody(req);
      const amount = Math.round(Number(body.amount) || 0);
      if (!(amount > 0)) return json(res, 400, { error: 'Ange ett belopp' });
      if (amount > CREDIT_MAX) return json(res, 400, { error: 'Beloppet är för stort' });
      const message = String(body.message || '').trim().slice(0, 240);
      const players = Object.values(db.players);
      if (!body.confirm) {
        return json(res, 200, {
          ok: false,
          preview: true,
          players: players.length,
          amount,
          total: round2(amount * players.length),
          message
        });
      }
      players.forEach((player) => {
        player.balance = round2((Number(player.balance) || 0) + amount);
        logTransaction(player, 'gåva', 'gåva till alla', amount, player.balance);
      });
      if (message) db.broadcast = message;
      const gift = { at: now(), amount, players: players.length, total: round2(amount * players.length), message };
      db.gifts.unshift(gift);
      db.gifts = db.gifts.slice(0, 20);
      markDirty();
      json(res, 200, { ok: true, gift, broadcast: db.broadcast });
    },

    /* Roulettens kontrollpanel. Kräver den hemliga koden (eller admin) och
       rör bara roulette – inga andra spel och inga saldon. */
    'GET /api/roulette/control': async (req, res) => {
      if (!rouletteController(req)) return json(res, 401, { error: 'Kräver kod' });
      const players = Object.values(db.players)
        .map((p) => {
          const stat = (p.gameStats && p.gameStats.roulette) || {};
          const pending = activeRig(p.id);
          const lastSeen = p.lastSeen || 0;
          return {
            id: p.id,
            name: p.name,
            balance: p.balance,
            isGuest: !p.pinHash,
            lastSeen,
            online: lastSeen > 0 && now() - lastSeen <= ONLINE_MS,
            seenAgo: lastSeen > 0 ? Math.max(0, Math.round((now() - lastSeen) / 1000)) : null,
            rounds: stat.rounds || 0,
            won: stat.won || 0,
            rig: pending ? pending.mode : null
          };
        })
        .filter((p) => p.online || p.rig)
        .sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen)
        .slice(0, 200);
      json(res, 200, {
        ok: true,
        players,
        online: players.filter((p) => p.online).length,
        rigged: players.filter((p) => p.rig).length,
        log: rouletteRigLog().slice(0, 12),
        ttlMinutes: Math.round(RIG_TTL_MS / 60000),
        onlineMinutes: Math.round(ONLINE_MS / 60000)
      });
    },

    'POST /api/roulette/control': async (req, res) => {
      const body = await readBody(req);
      const controller = rouletteController(req, body);
      if (!controller) return json(res, 401, { error: 'Kräver kod' });
      const action = String(body.action || 'lose');

      if (action === 'offAll') {
        db.rouletteRig = {};
        markDirty();
        return json(res, 200, { ok: true, mode: null, playerId: null });
      }

      const player = db.players[body.playerId];
      if (!player) return json(res, 404, { error: 'Spelaren finns inte' });

      if (action === 'off') {
        delete rouletteRigMap()[player.id];
        markDirty();
        return json(res, 200, { ok: true, mode: null, playerId: player.id, name: player.name });
      }

      if (action !== 'lose' && action !== 'loseAlways') {
        return json(res, 400, { error: 'Okänd åtgärd' });
      }

      /* Bara spelare som är online just nu kan tvingas förlora. */
      if (!(player.lastSeen > 0) || now() - player.lastSeen > ONLINE_MS) {
        return json(res, 409, {
          error: player.name + ' är inte online just nu',
          offline: true
        });
      }

      rouletteRigMap()[player.id] = { mode: action, at: now(), by: controller.by, used: 0 };
      markDirty();
      json(res, 200, {
        ok: true,
        mode: action,
        playerId: player.id,
        name: player.name,
        balance: player.balance,
        ttlMinutes: Math.round(RIG_TTL_MS / 60000)
      });
    },

    /* ------------------------ rysk roulette mot varandra ------------------------ */

    /* Listan över bord man kan gå med i, plus vilket bord man redan sitter vid. */
    'GET /api/revolver/tables': async (req, res) => {
      const player = rvbPlayerOrError(req, res);
      if (!player) return;
      rvbSweep();
      const limits = rvbLimits();
      const active = rvbActiveTableOf(player);
      const tables = Object.values(rvbTables())
        .filter((t) => t && t.phase !== 'done' && rvbAliveSeats(t).length > 0)
        .map((t) => ({
          id: t.id,
          ante: round2(t.ante),
          pot: round2(t.pot || 0),
          hostName: t.hostName,
          phase: t.phase,
          seats: (t.seats || []).filter((s) => !s.left).length,
          maxSeats: RVB.MAX_SEATS,
          createdAt: Number(t.createdAt) || 0,
          isHost: t.hostId === player.id,
          joined: (t.seats || []).some((s) => s.playerId === player.id && !s.left)
        }))
        .sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.createdAt - a.createdAt)
        .slice(0, 20);
      json(res, 200, {
        ok: true,
        tables,
        mine: active ? active.id : null,
        playerId: player.id,
        min: limits.min,
        max: limits.max,
        maxSeats: RVB.MAX_SEATS,
        minSeats: RVB.MIN_SEATS,
        ante: active ? round2(active.ante) : Math.max(limits.min, Math.min(100, limits.max))
      });
    },

    'POST /api/revolver/table': async (req, res) => {
      const player = rvbPlayerOrError(req, res);
      if (!player) return;
      const body = await readBody(req);
      rvbSweep();
      const limits = rvbLimits();
      const ante = Math.round(Number(body.ante) || 0);
      if (!(ante > 0)) return json(res, 400, { error: 'Välj en insats först' });
      if (ante < limits.min || ante > limits.max) {
        return json(res, 400, { error: `Insatsen måste vara mellan ${limits.min} och ${limits.max} kr` });
      }
      if (ante > player.balance) {
        return json(res, 400, { error: 'Du har inte tillräckligt med spelmynt' });
      }
      const already = rvbActiveTableOf(player);
      if (already) {
        return json(res, 409, {
          error: 'Du sitter redan vid ett bord',
          tableId: already.id,
          table: rvbPublic(already, player)
        });
      }

      const table = {
        id: uid(4),
        ante,
        pot: 0,
        phase: 'lobby',
        hostId: player.id,
        hostName: player.name,
        seats: [],
        turn: -1,
        bullet: rvbChamber(),
        cycle: 0,
        cyclePulls: 0,
        pulls: 0,
        bangs: 0,
        autoAt: 0,
        log: [],
        lastPull: null,
        winner: null,
        prize: 0,
        createdAt: now(),
        updatedAt: now()
      };
      table.seats.push({ playerId: player.id, name: player.name, alive: true, left: false, joinedAt: now() });
      rvbTakeAnte(player, ante, table);
      rvbLog(table, 'join', `🔫 ${player.name} öppnade bordet med ${Math.round(ante)} kr i insats.`);
      rvbTables()[table.id] = table;
      markDirty();
      json(res, 200, { ok: true, table: rvbPublic(table, player), balance: player.balance });
    },

    'POST /api/revolver/join': async (req, res) => {
      const player = rvbPlayerOrError(req, res);
      if (!player) return;
      const body = await readBody(req);
      rvbSweep();
      const table = rvbTable(body.id);
      if (!table) return json(res, 404, { error: 'Bordet finns inte längre' });

      const seat = rvbSeatOf(table, player.id);
      if (seat && !seat.left) return json(res, 200, { ok: true, table: rvbPublic(table, player), balance: player.balance });
      if (table.phase !== 'lobby') return json(res, 409, { error: 'Matchen har redan börjat – vänta på nästa bord' });
      if ((table.seats || []).filter((s) => !s.left).length >= RVB.MAX_SEATS) {
        return json(res, 409, { error: 'Bordet är fullt' });
      }
      if (table.ante > player.balance) return json(res, 400, { error: 'Du har inte tillräckligt med spelmynt' });

      const other = rvbActiveTableOf(player);
      if (other && other.id !== table.id) {
        return json(res, 409, { error: 'Du sitter redan vid ett annat bord', tableId: other.id });
      }

      if (seat) {
        // Har spelaren lämnat bordet tidigare får hen en ny plats.
        seat.left = false;
        seat.alive = true;
        seat.joinedAt = now();
      } else {
        table.seats.push({ playerId: player.id, name: player.name, alive: true, left: false, joinedAt: now() });
      }
      rvbTakeAnte(player, table.ante, table);
      rvbLog(table, 'join', `➕ ${player.name} gick med – kassan är ${Math.round(table.pot)} kr.`);
      rvbTouch(table);
      json(res, 200, { ok: true, table: rvbPublic(table, player), balance: player.balance });
    },

    'POST /api/revolver/leave': async (req, res) => {
      const player = rvbPlayerOrError(req, res);
      if (!player) return;
      const body = await readBody(req);
      const table = rvbTable(body.id);
      if (!table) return json(res, 404, { error: 'Bordet finns inte längre' });
      const seat = rvbSeatOf(table, player.id);
      if (!seat || seat.left) return json(res, 200, { ok: true, left: true, balance: player.balance });

      seat.left = true;
      let refunded = 0;

      if (table.phase === 'lobby') {
        /* Före start kostar det ingenting att lämna – insatsen betalas tillbaka. */
        refunded = rvbRefund(player, table.ante);
        table.pot = round2(Math.max(0, (table.pot || 0) - table.ante));
        seat.alive = false;
        rvbLog(table, 'leave', `${player.name} lämnade bordet och fick tillbaka sin insats.`);
        if (!(table.seats || []).some((s) => !s.left)) {
          table.phase = 'done';
          table.finishedAt = now();
          table.prize = 0;
          table.winner = null;
          table.pot = 0;
        } else if (table.hostId === player.id) {
          const next = (table.seats || []).find((s) => !s.left);
          if (next) {
            table.hostId = next.playerId;
            table.hostName = next.name;
          }
        }
      } else if (table.phase === 'playing') {
        /* Mitt i matchen är det här att ge upp – insatsen ligger redan i kassan. */
        seat.alive = false;
        seat.outAt = now();
        rvbLog(table, 'leave', `🚪 ${player.name} lämnade matchen.`);
        const left = rvbAliveSeats(table);
        if (left.length <= 1) {
          rvbFinish(table, left[0] || null);
        } else if (Number(table.turn) === (table.seats || []).indexOf(seat)) {
          table.turn = rvbNextAlive(table, (table.seats || []).indexOf(seat));
          table.autoAt = now() + RVB.TURN_MS;
        }
      }

      rvbTouch(table);
      json(res, 200, {
        ok: true,
        left: true,
        refunded,
        balance: player.balance,
        table: rvbPublic(table, player)
      });
    },

    'POST /api/revolver/start': async (req, res) => {
      const player = rvbPlayerOrError(req, res);
      if (!player) return;
      const body = await readBody(req);
      rvbSweep();
      const table = rvbTable(body.id);
      if (!table) return json(res, 404, { error: 'Bordet finns inte längre' });
      if (table.hostId !== player.id) return json(res, 403, { error: 'Bara den som öppnade bordet kan starta' });
      if (table.phase !== 'lobby') return json(res, 409, { error: 'Matchen är redan igång' });
      const seats = (table.seats || []).filter((s) => !s.left);
      if (seats.length < RVB.MIN_SEATS) {
        return json(res, 400, { error: `Minst ${RVB.MIN_SEATS} spelare behövs – bjud in någon mer` });
      }

      seats.forEach((s) => {
        s.alive = true;
        delete s.outAt;
      });
      table.phase = 'playing';
      table.pot = round2(table.ante * seats.length);
      table.bullet = rvbChamber();
      table.cycle = 0;
      table.cyclePulls = 0;
      table.pulls = 0;
      table.bangs = 0;
      table.lastPull = null;
      table.winner = null;
      table.prize = 0;
      table.autoAt = now() + RVB.TURN_MS;
      /* Slumpad startplats så att samma spelare inte alltid börjar. */
      table.turn = crypto.randomInt(0, table.seats.length);
      if (!table.seats[table.turn] || table.seats[table.turn].left) {
        table.turn = rvbNextAlive(table, table.turn);
      }
      rvbLog(
        table,
        'start',
        `🎬 Matchen börjar: ${seats.length} spelare och ${Math.round(table.pot)} kr i kassan. ${table.seats[table.turn].name} börjar.`
      );
      rvbTouch(table);
      json(res, 200, { ok: true, table: rvbPublic(table, player), balance: player.balance });
    },

    'GET /api/revolver/table': async (req, res, url) => {
      const player = rvbPlayerOrError(req, res);
      if (!player) return;
      rvbSweep();
      const table = rvbTable(url.searchParams.get('id'));
      if (!table) return json(res, 404, { error: 'Bordet finns inte längre' });
      rvbAutoAdvance(table);
      json(res, 200, {
        ok: true,
        table: rvbPublic(table, player),
        balance: player.balance,
        playerId: player.id
      });
    },

    'POST /api/revolver/pull': async (req, res) => {
      const player = rvbPlayerOrError(req, res);
      if (!player) return;
      const body = await readBody(req);
      const table = rvbTable(body.id);
      if (!table) return json(res, 404, { error: 'Bordet finns inte längre' });
      if (table.phase !== 'playing') return json(res, 409, { error: 'Matchen är inte igång' });
      rvbAutoAdvance(table);
      if (table.phase !== 'playing') {
        return json(res, 200, { ok: true, table: rvbPublic(table, player), balance: player.balance });
      }

      const seatIndex = (table.seats || []).findIndex((s) => s.playerId === player.id && !s.left);
      if (seatIndex < 0) return json(res, 403, { error: 'Du sitter inte vid bordet' });
      if (!table.seats[seatIndex].alive) return json(res, 409, { error: 'Du är redan ute ur matchen' });
      if (Number(table.turn) !== seatIndex) {
        return json(res, 409, { error: 'Det är inte din tur – vänta på ' + (table.seats[Number(table.turn)] || {}).name });
      }

      const result = rvbPull(table, seatIndex);
      if (result.error) return json(res, 409, { error: result.error });
      json(res, 200, {
        ok: true,
        fires: !!result.fires,
        finished: !!result.finished,
        table: rvbPublic(table, player),
        balance: player.balance
      });
    },


    /* ------------------------------ ateljén ------------------------------ */

    'GET /api/atelje': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (player.banned) return json(res, 403, { error: 'Kontot är avstängt', banned: true });
      markDirty();
      json(res, 200, { ok: true, ...ateljeState(player) });
    },

    'POST /api/atelje/buy': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (player.banned) return json(res, 403, { error: 'Kontot är avstängt', banned: true });
      if (isPaused(player)) return json(res, 403, pausedBody(player));
      if (accountBlocked(player)) {
        return json(res, 403, { error: ACCOUNT_REQUIRED, needAccount: true });
      }
      const body = await readBody(req);
      const item = ATELJE_BY_ID.get(String(body.id || ''));
      if (!item) return json(res, 404, { error: 'Saken finns inte i ateljén' });
      if (ateljeOwns(player, item.id)) return json(res, 409, { error: 'Du har redan ' + item.name });
      const locked = ateljeLocked(player, item);
      if (locked) {
        return json(res, 403, {
          error: `${item.name} låses upp när du har ${locked.quizCorrect} rätt svar (du har ${locked.have})`,
          locked: true,
          need: locked.quizCorrect,
          have: locked.have
        });
      }
      if (item.price > player.balance) {
        return json(res, 400, { error: 'Du har inte tillräckligt med spelmynt – plugga lite först' });
      }
      player.balance = round2(player.balance - item.price);
      const owned = Array.isArray(player.owned) ? player.owned : [];
      owned.push(item.id);
      player.owned = owned;
      logTransaction(player, 'köp', 'atelje', -item.price, player.balance);
      markDirty();
      json(res, 200, { ok: true, item: { id: item.id, name: item.name, price: item.price }, ...ateljeState(player) });
    },

    'POST /api/atelje/look': async (req, res) => {
      const player = findPlayerByToken(req);
      if (!player) return json(res, 401, { error: 'Ingen giltig session' });
      if (player.banned) return json(res, 403, { error: 'Kontot är avstängt', banned: true });
      const body = await readBody(req);
      const wanted = body.look && typeof body.look === 'object' ? body.look : body;
      /* Spara önskat utseende, men rita alltid bara det spelaren äger. */
      player.look = {
        emblem: String(wanted.emblem || ''),
        accent: String(wanted.accent || ''),
        color: String(wanted.color || ''),
        room: Array.isArray(wanted.room) ? wanted.room.slice(0, ATELJE_ROOM_SLOTS).map((id) => String(id || '')) : []
      };
      const look = ateljeLook(player);
      player.look = look;
      markDirty();
      json(res, 200, { ok: true, ...ateljeState(player) });
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
        // Frågesträngen hör till anropet, inte till rutten.
        const route = routes[method + ' ' + String(path).split('?')[0]];
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
      let guestB = null;
      let adminToken = null;
      try {
        guest = await call('POST', '/api/guest', { body: { name: '__selftest__' } });
        check('skapa gästkonto', guest.token && guest.player.balance === db.settings.startBalance, guest.player.balance);

        const token = guest.token;

        /* Ett gästkonto får inte spela förrän spelaren har skapat ett konto. */
        const guestBet = await call('POST', '/api/bet', {
          headers: { 'x-token': token },
          body: { game: 'slots', amount: 10 }
        });
        const guestCredit = await call('POST', '/api/credit', {
          headers: { 'x-token': token },
          body: { game: 'slots', amount: 10 }
        });
        check(
          'gäst utan konto nekas spela',
          guestBet.__status === 403 && guestBet.needAccount === true && guestCredit.__status === 403,
          { insats: guestBet.__status, vinst: guestCredit.__status }
        );

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

        /* Roulette spelar via samma bet/credit-väg som de andra spelen. */
        const ruBet = await call('POST', '/api/bet', {
          headers: { 'x-token': token2 },
          body: { game: 'roulette', amount: 25 }
        });
        const ruWin = await call('POST', '/api/credit', {
          headers: { 'x-token': token2 },
          body: { game: 'roulette', amount: 50 }
        });
        check(
          'roulette: insats och vinst',
          ruBet.balance === me.player.balance - 25 &&
            ruWin.balance === ruBet.balance + 50 &&
            ruWin.credited === 50,
          { insats: 25, vinst: 50, saldo: ruWin.balance }
        );

        /* Rysk roulette går också via bet/credit – insatsen dras, vinsten
           krediteras och rundan hamnar i spelarens statistik. */
        const rvBet = await call('POST', '/api/bet', {
          headers: { 'x-token': token2 },
          body: { game: 'revolver', amount: 25 }
        });
        const rvWin = await call('POST', '/api/credit', {
          headers: { 'x-token': token2 },
          body: { game: 'revolver', amount: 40 }
        });
        const rvMe = await call('GET', '/api/me', { headers: { 'x-token': token2 } });
        const rvStats = (rvMe.player && rvMe.player.gameStats && rvMe.player.gameStats.revolver) || {};
        check(
          'rysk roulette: insats, vinst och statistik',
          rvBet.balance === ruWin.balance - 25 &&
            rvWin.balance === rvBet.balance + 40 &&
            rvStats.rounds === 1 &&
            rvStats.wagered === 25 &&
            rvStats.won === 40,
          { insats: 25, vinst: 40, saldo: rvWin.balance, rundor: rvStats.rounds }
        );

        /* Rysk roulette mot varandra: två konton vid samma bord, båda lägger
           samma insats i kassan och servern avgör vem som står kvar. */
        guestB = await call('POST', '/api/guest', { body: { name: '' } });
        let regB = await call('POST', '/api/auth/register', {
          headers: { 'x-token': guestB.token },
          body: { name: '__selftest_b__', pin: '4321' }
        });
        /* Ett avbrutet selftest kan ha lämnat kvar kontot – då loggar vi in. */
        if (regB.__status === 409) {
          regB = await call('POST', '/api/auth/login', { body: { name: '__selftest_b__', pin: '4321' } });
        }
        const tokenB = regB.token;
        const beforeA = (await call('GET', '/api/me', { headers: { 'x-token': token2 } })).player;
        const beforeB = (await call('GET', '/api/me', { headers: { 'x-token': tokenB } })).player;

        /* Ett tidigare selftest kan ha lämnat kvar ett bord – städa bort det
           så att testkontona alltid kan öppna ett nytt. */
        const testIds = [beforeA.id, beforeB.id];
        Object.keys(rvbTables()).forEach((id) => {
          const leftover = rvbTables()[id];
          if (leftover && (leftover.seats || []).some((seat) => testIds.includes(seat.playerId))) {
            delete rvbTables()[id];
          }
        });

        const made = await call('POST', '/api/revolver/table', {
          headers: { 'x-token': token2 },
          body: { ante: 25 }
        });
        const tableId = made.table && made.table.id;
        const joined = await call('POST', '/api/revolver/join', {
          headers: { 'x-token': tokenB },
          body: { id: tableId }
        });
        const started = await call('POST', '/api/revolver/start', {
          headers: { 'x-token': token2 },
          body: { id: tableId }
        });
        check(
          'rysk roulette mot varandra: båda lägger insats i kassan',
          made.__status === 200 &&
            joined.__status === 200 &&
            joined.table.pot === 50 &&
            joined.table.seats.length === 2 &&
            started.table.phase === 'playing' &&
            beforeA.balance - 25 === made.balance &&
            beforeB.balance - 25 === joined.balance,
          { kassa: joined.table && joined.table.pot, fas: started.table && started.table.phase }
        );

        const tokens = {};
        tokens[beforeA.id] = token2;
        tokens[beforeB.id] = tokenB;
        let state = started.table;
        let guard = 0;
        while (state && state.phase === 'playing' && guard < 80) {
          guard += 1;
          const current = await call('GET', '/api/revolver/table?id=' + tableId, { headers: { 'x-token': token2 } });
          state = current.table;
          if (!state || state.phase !== 'playing') break;
          const shooter = state.turnPlayerId;
          if (!tokens[shooter]) break;
          const pulled = await call('POST', '/api/revolver/pull', {
            headers: { 'x-token': tokens[shooter] },
            body: { id: tableId }
          });
          if (pulled.__status !== 200) break;
          state = pulled.table;
        }

        const afterA = (await call('GET', '/api/me', { headers: { 'x-token': token2 } })).player;
        const afterB = (await call('GET', '/api/me', { headers: { 'x-token': tokenB } })).player;
        const winnerId = state && state.winner ? state.winner.playerId : null;
        const winnerAfter = winnerId === beforeA.id ? afterA : winnerId === beforeB.id ? afterB : null;
        const loserAfter = winnerId === beforeA.id ? afterB : afterA;
        const loserBefore = winnerId === beforeA.id ? beforeB : beforeA;

        check(
          'rysk roulette mot varandra: en vinner hela kassan',
          !!winnerId &&
            state.phase === 'done' &&
            state.prize === 50 &&
            winnerAfter &&
            winnerAfter.balance === (winnerId === beforeA.id ? beforeA.balance : beforeB.balance) + 25 &&
            loserAfter.balance === loserBefore.balance - 25,
          {
            vinnare: state && state.winner && state.winner.name,
            kassa: state && state.prize,
            klick: state && state.pulls,
            rundor: guard
          }
        );

        if (tableId) delete rvbTables()[tableId];
        Object.keys(rvbTables()).forEach((id) => {
          const leftover = rvbTables()[id];
          if (leftover && (leftover.seats || []).some((seat) => [beforeA.id, beforeB.id].includes(seat.playerId))) {
            delete rvbTables()[id];
          }
        });

        /* Ateljén: mynt köper saker till figuren och rummet. Bara det man
           äger kan användas, och allt köp hamnar i myntloggen. */
        const shop = await call('GET', '/api/atelje', { headers: { 'x-token': token2 } });
        const beforeShop = (await call('GET', '/api/me', { headers: { 'x-token': token2 } })).player;
        const bought = await call('POST', '/api/atelje/buy', {
          headers: { 'x-token': token2 },
          body: { id: 'bow' }
        });
        const boughtAgain = await call('POST', '/api/atelje/buy', {
          headers: { 'x-token': token2 },
          body: { id: 'bow' }
        });
        const lockedBuy = await call('POST', '/api/atelje/buy', {
          headers: { 'x-token': token2 },
          body: { id: 'dragon' }
        });
        check(
          'ateljén: köp drar mynt och allt man äger sparas',
          shop.__status === 200 &&
            Array.isArray(shop.catalog) &&
            shop.catalog.length > 30 &&
            bought.__status === 200 &&
            bought.owned.includes('bow') &&
            bought.balance === beforeShop.balance - 250 &&
            boughtAgain.__status === 409 &&
            lockedBuy.__status === 403 &&
            lockedBuy.locked === true,
          {
            saker: shop.catalog && shop.catalog.length,
            saldo: bought.balance,
            kopia: boughtAgain.__status,
            låst: lockedBuy.__status
          }
        );

        const dressed = await call('POST', '/api/atelje/look', {
          headers: { 'x-token': token2 },
          body: { look: { emblem: 'unicorn', accent: 'bow', color: 'galaxy', room: ['plant'] } }
        });
        const dressedMe = await call('GET', '/api/me', { headers: { 'x-token': token2 } });
        check(
          'ateljén: bara det man äger kan sättas på',
          dressed.__status === 200 &&
            dressed.look.accent === 'bow' &&
            dressed.look.emblem === 'fox' &&
            dressed.look.room.length === 0 &&
            dressedMe.player.look.accent === 'bow',
          { figur: dressed.look && dressed.look.emblem, accent: dressed.look && dressed.look.accent, rum: dressed.look && dressed.look.room.length }
        );

        /* Pluggets logg är en egen lista, skild från kasinots. */
        const studyEvent = await call('POST', '/api/study/log', {
          headers: { 'x-token': token2 },
          body: { subject: 'matte', correct: true, coins: 25 }
        });
        const logs = await call('GET', '/api/log', { headers: { 'x-token': token2 } });
        check(
          'pluggets logg sparas för sig',
          studyEvent.__status === 200 &&
            logs.__status === 200 &&
            (logs.study || []).length >= 1 &&
            (logs.today || {}).answers >= 1 &&
            (logs.coins || []).length > 0,
          {
            svar: (logs.study || []).length,
            idag: (logs.today || {}).answers,
            myntrader: (logs.coins || []).length
          }
        );

        /* Roulettens hemliga kontrollpanel. Koden 333333 ska tvinga
           spelarens nästa snurr till förlust – och bara den snurren. */
        const noCode = await call('GET', '/api/roulette/control', {
          headers: { 'x-token': token2 }
        });
        const guestPanel = await call('GET', '/api/roulette/control', {
          body: {},
          headers: { 'x-roulette-code': '333333', 'x-token': (await call('POST', '/api/guest', { body: { name: '' } })).token }
        });
        check(
          'roulette: panelen kräver koden och ett eget konto',
          noCode.__status === 401 && guestPanel.__status === 401,
          { utanKod: noCode.__status, gast: guestPanel.__status }
        );

        const panel = await call('GET', '/api/roulette/control', {
          headers: { 'x-roulette-code': '333333', 'x-token': token2 }
        });
        const rigged = await call('POST', '/api/roulette/control', {
          headers: { 'x-roulette-code': '333333', 'x-token': token2 },
          body: { playerId: guest.player.id, action: 'lose' }
        });
        check(
          'roulette: koden 333333 öppnar panelen',
          panel.__status === 200 && Array.isArray(panel.players) && panel.players.length > 0 && rigged.ok === true,
          { spelare: (panel.players || []).length, tvingad: rigged.name }
        );

        const rigBet = await call('POST', '/api/bet', {
          headers: { 'x-token': token2 },
          body: { game: 'roulette', amount: 25 }
        });
        const cleanBet = await call('POST', '/api/bet', {
          headers: { 'x-token': token2 },
          body: { game: 'roulette', amount: 25 }
        });
        check(
          'roulette: tvingad förlust gäller bara en snurr',
          rigBet.rig === 'lose' && cleanBet.rig === null && cleanBet.__status === 200,
          { forsta: rigBet.rig, andra: cleanBet.rig }
        );

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
        const sportBalance = (await call('GET', '/api/me', { headers: { 'x-token': token2 } })).player.balance;
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
            placed.bet && placed.bet.status === 'open' && placed.balance === sportBalance - 50,
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

        /* Kompensation för vinster som klipptes innan taket togs bort.
           Vi lägger in en sådan vinst på testkontot och betalar bara ut till
           det, så inga riktiga spelare rörs av självtestet. */
        const fakeAt = 1700000000000;
        const compPlayer = db.players[guest.player.id];
        if (compPlayer) {
          compPlayer.log.unshift({
            t: fakeAt,
            kind: 'vinst',
            game: 'slots',
            amount: LEGACY_WIN_CAP,
            balance: compPlayer.balance
          });
          db.transactions.unshift({
            t: fakeAt,
            kind: 'vinst',
            game: 'slots',
            amount: LEGACY_WIN_CAP,
            balance: compPlayer.balance,
            playerId: compPlayer.id,
            playerName: compPlayer.name
          });
        }
        const compPreview = await call(
          'GET',
          '/api/admin/compensation?playerId=' + guest.player.id,
          { headers: { 'x-admin-token': adminToken } }
        );
        check(
          'klippt vinst hittas',
          compPreview.winCount === 1 && compPreview.total === LEGACY_WIN_CAP,
          { vinster: compPreview.winCount, summa: compPreview.total, perVinst: compPreview.perWin }
        );

        const beforeComp = (await call('GET', '/api/me', { headers: { 'x-token': token2 } })).player.balance;
        const compPay = await call('POST', '/api/admin/compensation', {
          headers: { 'x-admin-token': adminToken },
          body: { confirm: true, playerId: guest.player.id }
        });
        const afterComp = (await call('GET', '/api/me', { headers: { 'x-token': token2 } })).player.balance;
        check(
          'kompensation betalas ut',
          compPay.ok === true &&
            compPay.players && compPay.players.length === 1 &&
            afterComp === round2(beforeComp + LEGACY_WIN_CAP),
          { fore: beforeComp, efter: afterComp }
        );

        const compAgain = await call('POST', '/api/admin/compensation', {
          headers: { 'x-admin-token': adminToken },
          body: { confirm: true, playerId: guest.player.id }
        });
        check('samma vinst betalas inte ut två gånger', compAgain.ok === false, compAgain.reason || null);

        /* Paus: spelaren kan plugga men inte spela under pausen. */
        const pause = await call('POST', '/api/admin/player', {
          headers: { 'x-admin-token': adminToken },
          body: { id: guest.player.id, action: 'pause', value: 15 }
        });
        const pauseBet = await call('POST', '/api/bet', {
          headers: { 'x-token': token2 },
          body: { game: 'selftest', amount: 10 }
        });
        const pauseStudy = await call('POST', '/api/study/log', {
          headers: { 'x-token': token2 },
          body: { subject: 'matte', correct: true, coins: 25 }
        });
        const pauseMe = await call('GET', '/api/me', { headers: { 'x-token': token2 } });
        check(
          'admin pausar spelaren',
          pause.player && pause.player.paused === true && pause.player.pausedUntil > now(),
          { minuter: Math.round((pause.player.pausedUntil - now()) / 60000) }
        );
        check(
          'pausad spelare nekas spela men kan plugga',
          pauseBet.__status === 403 && pauseBet.paused === true && pauseStudy.__status === 200,
          { insats: pauseBet.__status, plugg: pauseStudy.__status }
        );
        check(
          'pausen syns i spelarens session',
          pauseMe.__status === 200 && pauseMe.player.paused === true,
          pauseMe.player && pauseMe.player.paused
        );

        const release = await call('POST', '/api/admin/player', {
          headers: { 'x-admin-token': adminToken },
          body: { id: guest.player.id, action: 'pause', value: 0 }
        });
        const afterRelease = await call('POST', '/api/bet', {
          headers: { 'x-token': token2 },
          body: { game: 'selftest', amount: 10 }
        });
        check(
          'släppt paus spelar igen',
          release.player && release.player.paused === false && afterRelease.__status === 200,
          afterRelease.balance
        );

        /* Gåvan till alla: rutten ska kräva admin och ett belopp. Själva
           utdelningen körs aldrig i testet – den rör allas saldon. */
        const giftAnon = await call('POST', '/api/admin/gift', { body: { amount: 100, confirm: true } });
        const giftNoAmount = await call('POST', '/api/admin/gift', {
          headers: { 'x-admin-token': adminToken },
          body: { amount: 0, confirm: true }
        });
        check(
          'gåvan kräver admin och ett belopp',
          giftAnon.__status === 401 && giftNoAmount.__status === 400,
          { utanAdmin: giftAnon.__status, utanBelopp: giftNoAmount.__status }
        );

        /* Snäll dealer: reglaget ska finnas och vara på som standard. */
        const bjSettings = await call('GET', '/api/settings');
        const merciful = bjSettings.settings ? bjSettings.settings.mercifulDealer !== false : false;
        check('snäll dealer är på som standard', merciful, {
          mercifulDealer: bjSettings.settings && bjSettings.settings.mercifulDealer
        });

        /* Topplistan: mest spelmynt först, och spelaren själv ska hittas. */
        const board = await call('GET', '/api/leaderboard', { headers: { 'x-token': token2 } });
        const boardSorted = (board.players || []).every(
          (row, i, arr) => i === 0 || arr[i - 1].balance >= row.balance
        );
        const boardMe = (board.players || []).find((row) => row.me) || board.me;
        check(
          'topplistan sorterar på mest pengar',
          board.__status === 200 && boardSorted && !!boardMe && boardMe.rank >= 1,
          { plats: boardMe && boardMe.rank, antal: board.total, iOmlopp: board.pool }
        );

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

        // Självtestet ska inte lämna spår i utbetalningsliggaren.
        db.payouts.runs = db.payouts.runs.filter((r) => r.at !== (compPay.run && compPay.run.at));
        db.payouts.keys = db.payouts.keys.filter((k) => !k.startsWith(guest.player.id + ':'));
      } catch (err) {
        failed = err.message;
      } finally {
        // Städa bort allt testdata.
        if (guest && guest.player && db.players[guest.player.id]) delete db.players[guest.player.id];
        if (guest && guest.player) {
          db.transactions = db.transactions.filter((t) => t.playerId !== guest.player.id);
          db.sportBets = db.sportBets.filter((b) => b.playerId !== guest.player.id);
        }
        if (guestB && guestB.player && db.players[guestB.player.id]) delete db.players[guestB.player.id];
        if (guestB && guestB.player) {
          db.transactions = db.transactions.filter((t) => t.playerId !== guestB.player.id);
        }
        /* Inga testbord får ligga kvar. */
        Object.keys(rvbTables()).forEach((id) => {
          const leftover = rvbTables()[id];
          const testIds = [guest && guest.player && guest.player.id, guestB && guestB.player && guestB.player.id];
          if (leftover && (leftover.seats || []).some((seat) => testIds.includes(seat.playerId))) {
            delete rvbTables()[id];
          }
        });
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
