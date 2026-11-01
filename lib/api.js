'use strict';

/**
 * Spellogiken/API:t. Delas av den lokala servern (filbaserad lagring)
 * och Vercel-funktionen (Supabase-lagring).
 */

const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  minBet: 10,
  maxBet: 500,
  startBalance: 2500,
  blackjackPayout: 1.5,
  dealerHitsSoft17: false,
  doubleAfterSplit: true,
  slotLuck: 1,
  videoPokerLuck: 1,
  quizReward: 25,
  dailyBonus: 500,
  maintenance: false,
  banner: ''
};

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
      banned: !!p.banned,
      lastBonus: p.lastBonus || 0
    };
  }

  function publicSettings() {
    return { ...db.settings, banner: db.broadcast || db.settings.banner || '' };
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
      logTransaction(player, 'vinst', game, amount, player.balance);
      markDirty();
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
      json(res, 200, {
        players,
        totals,
        settings: publicSettings(),
        transactions: db.transactions.slice(0, 120),
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
      if (incoming.dealerHitsSoft17 !== undefined) next.dealerHitsSoft17 = !!incoming.dealerHitsSoft17;
      if (incoming.doubleAfterSplit !== undefined) next.doubleAfterSplit = !!incoming.doubleAfterSplit;
      if (incoming.maintenance !== undefined) next.maintenance = !!incoming.maintenance;
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
        const bet = await call('POST', '/api/bet', { headers: { 'x-token': token }, body: { game: 'selftest', amount: 100 } });
        check('insats dras', bet.balance === guest.player.balance - 100, bet.balance);

        const credit = await call('POST', '/api/credit', { headers: { 'x-token': token }, body: { game: 'selftest', amount: 250 } });
        check('vinst krediteras', credit.balance === bet.balance + 250, credit.balance);

        const bonus = await call('POST', '/api/bonus', { headers: { 'x-token': token } });
        check('bonus fungerar', bonus.balance === credit.balance + db.settings.dailyBonus, bonus.balance);

        const me = await call('GET', '/api/me', { headers: { 'x-token': token } });
        check('session läses', me.player && me.player.id === guest.player.id);

        const login = await call('POST', '/api/admin/login', { body: { code: ADMIN_CODE } });
        adminToken = login.adminToken;
        check('admin-inloggning', !!adminToken);

        const overview = await call('GET', '/api/admin/overview', { headers: { 'x-admin-token': adminToken } });
        check('admin ser spelaren', Array.isArray(overview.players) && overview.players.some((p) => p.id === guest.player.id), overview.players.length);

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

        const blocked = await call('GET', '/api/me', { headers: { 'x-token': token } });
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
