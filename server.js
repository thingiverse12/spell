'use strict';

/**
 * Plugghörnan – liten nollberoende server.
 * Serverar den statiska appen och ett litet JSON-API för spelare,
 * spelmynt och adminpanelen. Inga riktiga pengar någonstans i systemet.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_CODE = (process.env.ADMIN_CODE || 'Vincent12').trim();

const DEFAULT_SETTINGS = {
  minBet: 10,
  maxBet: 500,
  startBalance: 2500,
  blackjackPayout: 1.5, // 3:2
  dealerHitsSoft17: false,
  doubleAfterSplit: true,
  slotLuck: 1, // 0.5 – 1.5
  videoPokerLuck: 1,
  quizReward: 25,
  dailyBonus: 500,
  maintenance: false,
  banner: ''
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/* ------------------------------------------------------------------ *
 * Databas (en JSON-fil, skrivs atomärt)
 * ------------------------------------------------------------------ */

function emptyDb() {
  return {
    players: {},
    transactions: [],
    adminSessions: {},
    settings: { ...DEFAULT_SETTINGS },
    broadcast: '',
    createdAt: Date.now()
  };
}

function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...emptyDb(),
      ...parsed,
      players: parsed.players || {},
      transactions: parsed.transactions || [],
      adminSessions: parsed.adminSessions || {},
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) }
    };
  } catch (err) {
    return emptyDb();
  }
}

let db = loadDb();

function saveDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('Kunde inte spara databasen:', err.message);
  }
}

/* ------------------------------------------------------------------ *
 * Hjälpare
 * ------------------------------------------------------------------ */

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
    banned: !!p.banned
  };
}

function publicSettings() {
  return { ...db.settings, banner: db.broadcast || db.settings.banner || '' };
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
    log: []
  };
  db.players[id] = player;
  logTransaction(player, 'konto', 'nytt konto', 0, player.balance);
  saveDb();
  return player;
}

function logTransaction(player, kind, game, amount, balance) {
  const entry = { t: now(), kind, game, amount: round2(amount), balance: round2(balance) };
  player.log = player.log || [];
  player.log.unshift(entry);
  player.log = player.log.slice(0, 60);
  db.transactions.unshift({ ...entry, playerId: player.id, playerName: player.name });
  db.transactions = db.transactions.slice(0, 800);
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
    saveDb();
    return null;
  }
  return session;
}

/* ------------------------------------------------------------------ *
 * HTTP-hjälpare
 * ------------------------------------------------------------------ */

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

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  try {
    rel = decodeURIComponent(rel);
  } catch (err) {
    return json(res, 400, { error: 'Felaktig sökväg' });
  }
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Nekad' });

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA-fallback
      const index = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(index)) {
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        fs.createReadStream(index).pipe(res);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Hittades inte');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, players: Object.keys(db.players).length }),

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
    saveDb();
    json(res, 200, { player: publicPlayer(player), settings: publicSettings() });
  },

  'POST /api/player/name': async (req, res) => {
    const player = findPlayerByToken(req);
    if (!player) return json(res, 401, { error: 'Ingen giltig session' });
    const body = await readBody(req);
    const name = cleanName(body.name);
    if (name.length < 2) return json(res, 400, { error: 'Namnet är för kort' });
    player.name = name;
    saveDb();
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
    saveDb();
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
    saveDb();
    json(res, 200, { token: player.token, player: publicPlayer(player), settings: publicSettings() });
  },

  'POST /api/bet': async (req, res) => {
    const player = findPlayerByToken(req);
    if (!player) return json(res, 401, { error: 'Ingen giltig session' });
    if (player.banned) return json(res, 403, { error: 'Kontot är avstängt' });
    const body = await readBody(req);
    const amount = Math.round(Number(body.amount) || 0);
    const game = cleanGame(body.game);
    if (!(amount > 0)) return json(res, 400, { error: 'Ogiltig insats' });
    if (amount > Math.max(1000, Number(db.settings.maxBet) * 50)) return json(res, 400, { error: 'Insatsen är för stor' });
    if (amount > player.balance) return json(res, 400, { error: 'Du har inte tillräckligt med spelmynt' });
    player.balance = round2(player.balance - amount);
    player.wagered = round2((player.wagered || 0) + amount);
    player.rounds = (player.rounds || 0) + 1;
    logTransaction(player, 'insats', game, -amount, player.balance);
    saveDb();
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
    if (game === 'quiz') player.quizCorrect = (player.quizCorrect || 0) + Math.max(1, Math.round(amount / Math.max(1, db.settings.quizReward)));
    logTransaction(player, 'vinst', game, amount, player.balance);
    saveDb();
    json(res, 200, { balance: player.balance });
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
    saveDb();
    json(res, 200, { balance: player.balance, bonus });
  },

  /* ------------------------------ Admin ------------------------------ */

  'POST /api/admin/login': async (req, res) => {
    const body = await readBody(req);
    const code = String(body.code || '').trim();
    if (code.toLowerCase() !== ADMIN_CODE.toLowerCase()) {
      return json(res, 401, { error: 'Fel kod' });
    }
    const token = uid(16);
    db.adminSessions[token] = { created: now(), expires: now() + 8 * 60 * 60 * 1000 };
    saveDb();
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
    json(res, 200, {
      players,
      totals,
      settings: publicSettings(),
      transactions: db.transactions.slice(0, 120),
      broadcast: db.broadcast || ''
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
      saveDb();
      return json(res, 200, { ok: true, deleted: true });
    } else {
      return json(res, 400, { error: 'Okänd åtgärd' });
    }
    saveDb();
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
    if (incoming.dealerHitsSoft17 !== undefined) next.dealerHitsSoft17 = !!incoming.dealerHitsSoft17;
    if (incoming.doubleAfterSplit !== undefined) next.doubleAfterSplit = !!incoming.doubleAfterSplit;
    if (incoming.maintenance !== undefined) next.maintenance = !!incoming.maintenance;
    if (next.maxBet < next.minBet) next.maxBet = next.minBet;
    db.settings = next;
    saveDb();
    json(res, 200, { settings: publicSettings() });
  },

  'POST /api/admin/broadcast': async (req, res) => {
    if (!adminFromRequest(req)) return json(res, 401, { error: 'Kräver admin' });
    const body = await readBody(req);
    db.broadcast = String(body.message || '').slice(0, 240);
    saveDb();
    json(res, 200, { broadcast: db.broadcast });
  }
};

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  res.setHeader('x-content-type-options', 'nosniff');
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname.startsWith('/api/')) {
      const key = req.method + ' ' + url.pathname.replace(/\/+$/, '');
      const handler = routes[key];
      if (!handler) return json(res, 404, { error: 'Okänd endpoint: ' + key });
      await handler(req, res);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('Serverfel:', err);
    if (!res.headersSent) json(res, 500, { error: 'Serverfel: ' + err.message });
    else res.end();
  } finally {
    if (process.env.LOG_REQUESTS) console.log(req.method, req.url, Date.now() - start + 'ms');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Plugghörnan körs på http://${HOST}:${PORT} (admin-kod: ${ADMIN_CODE})`);
});
