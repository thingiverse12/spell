/* =====================================================================
   Kärnan: state, API (med offline-fallback), router, toast, ljud, modaler.
   ===================================================================== */

import { demoFeed, hockeyFeed, decideOutcome } from './sportdemo.js';

export const DEFAULT_SETTINGS = {
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
  rubberBand: true
};

export const state = {
  player: null,
  settings: { ...DEFAULT_SETTINGS },
  adminToken: null,
  adminData: null,
  unlocked: false,
  muted: false,
  offline: false,
  route: { name: 'home', parts: [] },
  broadcast: ''
};

export const hooks = { onRoute: null };

const K = {
  token: 'ph.token',
  admin: 'ph.admin',
  unlock: 'ph.unlocked',
  mute: 'ph.muted',
  local: 'ph.localplayer',
  learn: 'ph.learn'
};

/* ------------------------------ Småhjälpare ------------------------------ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const num = (n) => Math.round(Number(n) || 0).toLocaleString('sv-SE');
export const kr = (n) => num(n) + ' kr';
export const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* ignorera */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignorera */
    }
  }
};

export const storage = store;

/* ------------------------------ Ljud ------------------------------ */

let audioCtx = null;

function ctx() {
  if (state.muted) return null;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function blip(freq, dur = 0.09, type = 'sine', gain = 0.05, delay = 0) {
  const ac = ctx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ac.currentTime + delay);
  g.gain.exponentialRampToValueAtTime(gain, ac.currentTime + delay + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + delay + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(ac.currentTime + delay);
  osc.stop(ac.currentTime + delay + dur + 0.02);
}

export const sfx = {
  click: () => blip(520, 0.05, 'triangle', 0.035),
  deal: () => blip(340, 0.06, 'square', 0.022),
  chip: () => blip(760, 0.07, 'triangle', 0.04),
  spin: () => blip(180, 0.12, 'sawtooth', 0.018),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.16, 'sine', 0.05, i * 0.075));
  },
  bigWin: () => {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => blip(f, 0.22, 'triangle', 0.055, i * 0.07));
  },
  lose: () => {
    [330, 262, 196].forEach((f, i) => blip(f, 0.18, 'sine', 0.045, i * 0.09));
  },
  correct: () => {
    [659, 880].forEach((f, i) => blip(f, 0.12, 'sine', 0.045, i * 0.08));
  },
  wrong: () => blip(180, 0.2, 'sawtooth', 0.03)
};

/* ------------------------------ Toast ------------------------------ */

export function toast(message, kind = '', ms = 2600) {
  const root = $('#toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' toast--' + kind : '');
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 320);
  }, ms);
}

/* ------------------------------ Modaler ------------------------------ */

let activeModal = null;

export function closeModal() {
  if (!activeModal) return;
  activeModal.remove();
  activeModal = null;
}

export function openModal({ title, sub = '', body = '', actions = [], wide = false, onMount, dismissible = true }) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true">
      <h2>${title}</h2>
      ${sub ? `<p class="modal__sub">${sub}</p>` : ''}
      <div class="modal__body">${body}</div>
      ${actions.length ? '<div class="modal__foot"></div>' : ''}
    </div>`;
  const foot = backdrop.querySelector('.modal__foot');
  actions.forEach((action) => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (action.kind === 'primary' ? 'btn--primary' : action.kind === 'danger' ? 'btn--danger' : 'btn--ghost');
    btn.textContent = action.label;
    btn.addEventListener('click', async () => {
      sfx.click();
      const close = action.keepOpen ? () => {} : closeModal;
      await action.onClick?.(close, backdrop);
    });
    foot.appendChild(btn);
  });
  if (dismissible) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escClose);
    }
  }
  $('#overlay-root').appendChild(backdrop);
  activeModal = backdrop;
  onMount?.(backdrop);
  const first = backdrop.querySelector('input, .input');
  if (first) setTimeout(() => first.focus(), 60);
  return backdrop;
}

export function confirmModal({ title, text, confirmLabel = 'Ja', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      sub: text,
      actions: [
        { label: 'Avbryt', onClick: (close) => { close(); resolve(false); } },
        {
          label: confirmLabel,
          kind: danger ? 'danger' : 'primary',
          onClick: (close) => { close(); resolve(true); }
        }
      ]
    });
  });
}

/* ------------------------------ API ------------------------------ */

const headers = (extra = {}) => {
  const h = { 'content-type': 'application/json', ...extra };
  const token = store.get(K.token);
  if (token) h['x-token'] = token;
  if (state.adminToken) h['x-admin-token'] = state.adminToken;
  return h;
};

async function request(path, { method = 'GET', body, keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      ...(keepalive ? { keepalive: true } : {})
    });
  } catch (err) {
    const offlineError = new Error('offline');
    offlineError.offline = true;
    throw offlineError;
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Ingen API-server på adressen (t.ex. ren statisk host) -> lokalt läge
    const offlineError = new Error('Ingen API-server');
    offlineError.offline = true;
    throw offlineError;
  }

  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Något gick fel');
    err.status = res.status;
    err.data = data;
    // 5xx betyder att backend/databasen inte svarar -> använd lokal lagring
    if (res.status >= 500) err.offline = true;
    throw err;
  }
  return data;
}

/* -------- lokal fallback om servern inte svarar -------- */

/** Svenskt datum, t.ex. 2026-11-03 – används för lokal skärmtid. */
export function localDayKey(ts = Date.now()) {
  try {
    return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
  } catch (e) {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

/** Skärmtid ur en lokal spelare (samma form som serverns svar). */
export function screenStatsOf(player) {
  const days = (player && player.screenDays) || {};
  const today = days[localDayKey()] || 0;
  let week = 0;
  for (let i = 0; i < 7; i += 1) week += days[localDayKey(Date.now() - i * 86400000)] || 0;
  return {
    screenTime: Math.round((player && player.screenTime) || 0),
    screenToday: Math.round(today),
    screen7d: Math.round(week),
    screenVisits: (player && player.screenVisits) || 0,
    screenLast: (player && player.screenLast) || 0,
    screenDays: days
  };
}

function localPlayer() {
  let p = store.get(K.local);
  if (!p) {
    p = {
      id: 'local',
      name: 'Gäst',
      balance: DEFAULT_SETTINGS.startBalance,
      wagered: 0,
      won: 0,
      rounds: 0,
      quizCorrect: 0,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      hasPin: false,
      banned: false,
      lastBonus: 0,
      screenTime: 0,
      screenDays: {},
      screenVisits: 0,
      screenLast: 0
    };
    store.set(K.local, p);
  }
  return p;
}

function saveLocal(p) {
  p.lastSeen = Date.now();
  store.set(K.local, p);
  return p;
}

function localGameStat(player, game, kind, amount) {
  if (!game || game === 'bonus' || game === 'admin' || game === 'konto') return;
  player.gameStats = player.gameStats || {};
  const stat = (player.gameStats[game] = player.gameStats[game] || { wagered: 0, won: 0, rounds: 0, best: 0 });
  if (kind === 'bet') {
    stat.wagered += amount;
    stat.rounds = (stat.rounds || 0) + 1;
  } else {
    stat.won += amount;
    if (amount > (stat.best || 0)) stat.best = amount;
    if (amount > (player.biggestWin || 0)) player.biggestWin = amount;
  }
}

function localTx(kind, game, amount, balance) {
  const list = store.get('ph.tx', []) || [];
  list.unshift({ t: Date.now(), kind, game, amount, balance, playerName: (store.get(K.local) || {}).name || 'Gäst' });
  store.set('ph.tx', list.slice(0, 120));
}

function localSettings() {
  return { ...DEFAULT_SETTINGS, ...(store.get('ph.settings', {}) || {}) };
}

/* -------- fotboll i lokalt läge -------- */

function localSportBets() {
  return store.get('ph.sportbets', []) || [];
}

function saveLocalSportBets(list) {
  store.set('ph.sportbets', list.slice(0, 120));
}

function localSportFeed(kind) {
  const margin = Number(state.settings.sportMargin) || 6;
  return kind === 'hockey' ? hockeyFeed(Date.now(), margin) : demoFeed(Date.now(), margin);
}

function offlineFeed(kind) {
  const sport = kind === 'hockey' ? 'hockey' : 'football';
  return {
    sport,
    source: 'demo',
    updatedAt: Date.now(),
    error: null,
    apiKeySet: false,
    enabled: true,
    limits: {
      min: Math.max(1, Number(state.settings.minBet) || 10),
      max: Math.max(10, Number(state.settings.sportMaxStake) || 500)
    },
    matches: localSportFeed(sport)
  };
}

/** Gör upp lokala sportspel när matcherna är färdigspelade. */
async function settleLocalSport() {
  const list = localSportBets();
  const open = list.filter((b) => b.status === 'open');
  if (!open.length) return;
  const feeds = {
    football: demoFeed(Date.now(), Number(state.settings.sportMargin) || 6),
    hockey: hockeyFeed(Date.now(), Number(state.settings.sportMargin) || 6)
  };
  let changed = false;
  open.forEach((bet) => {
    const feed = feeds[bet.sport === 'hockey' ? 'hockey' : 'football'] || feeds.football;
    const match = feed.find((m) => m.id === bet.matchId);
    if (!match) return;
    const decision = decideOutcome(match, bet);
    if (!decision) return;
    bet.status = decision;
    bet.settledAt = Date.now();
    bet.result = match.result ? match.result.home + '-' + match.result.away : null;
    changed = true;
    if (decision === 'void') {
      const p = localPlayer();
      p.balance += bet.stake;
      bet.payout = bet.stake;
      saveLocal(p);
      state.player = p;
      localTx('återbetalning', 'sport', bet.stake, p.balance);
    } else if (decision === 'won') {
      const payout = Math.round(bet.stake * bet.odds * 100) / 100;
      bet.payout = payout;
      const p = localPlayer();
      p.balance += payout;
      p.won = (p.won || 0) + payout;
      localGameStat(p, 'sport', 'win', payout);
      saveLocal(p);
      state.player = p;
      localTx('vinst', 'sport', payout, p.balance);
    }
  });
  if (changed) saveLocalSportBets(list);
}

function localFail(err) {
  if (!err || !err.offline) throw err;
  state.offline = true;
  return true;
}

export const api = {
  async guest(name) {
    try {
      const data = await request('/api/guest', { method: 'POST', body: { name } });
      store.set(K.token, data.token);
      state.player = data.player;
      state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      state.offline = false;
      return data.player;
    } catch (err) {
      if (!localFail(err)) throw err;
      const p = localPlayer();
      if (name) p.name = name;
      state.player = saveLocal(p);
      state.settings = localSettings();
      state.broadcast = store.get('ph.broadcast', '') || '';
      return state.player;
    }
  },

  async me() {
    try {
      const data = await request('/api/me');
      state.player = data.player;
      state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      state.offline = false;
      return data.player;
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        store.del(K.token);
        throw err;
      }
      if (!localFail(err)) throw err;
      state.player = localPlayer();
      state.settings = localSettings();
      state.broadcast = store.get('ph.broadcast', '') || '';
      return state.player;
    }
  },

  /** Rapporterar skärmtid till servern (eller lokalt om servern inte svarar). */
  async screen(seconds, keepalive = false) {
    const secs = Math.max(0, Math.round(Number(seconds) || 0));
    if (!secs) return;
    try {
      await request('/api/screen', { method: 'POST', body: { seconds: secs }, keepalive });
    } catch (err) {
      if (!localFail(err)) return;
      const p = localPlayer();
      p.screenTime = (p.screenTime || 0) + secs;
      p.screenDays = p.screenDays && typeof p.screenDays === 'object' ? p.screenDays : {};
      const key = localDayKey();
      p.screenDays[key] = (p.screenDays[key] || 0) + secs;
      p.screenLast = Date.now();
      p.screenVisits = p.screenVisits || 1;
      saveLocal(p);
    }
  },

  async rename(name) {
    try {
      const data = await request('/api/player/name', { method: 'POST', body: { name } });
      state.player = data.player;
      return;
    } catch (err) {
      if (!localFail(err)) throw err;
      const p = localPlayer();
      p.name = name;
      state.player = saveLocal(p);
    }
  },

  async setPin(pin) {
    try {
      const data = await request('/api/player/pin', { method: 'POST', body: { pin } });
      if (state.player) state.player.hasPin = true;
      return data;
    } catch (err) {
      if (!localFail(err)) throw err;
      const p = localPlayer();
      p.hasPin = true;
      store.set(K.local, p);
      return { ok: true };
    }
  },

  async register(name, pin) {
    try {
      const data = await request('/api/auth/register', { method: 'POST', body: { name, pin } });
      store.set(K.token, data.token);
      state.player = data.player;
      state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      state.offline = false;
      return data.player;
    } catch (err) {
      if (!localFail(err)) throw err;
      const p = localPlayer();
      p.name = name;
      p.hasPin = true;
      p.isGuest = false;
      saveLocal(p);
      state.player = p;
      return p;
    }
  },

  async logout() {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      /* ignorera */
    }
    store.del(K.token);
    state.player = null;
    if (state.offline) store.del(K.local);
    await api.guest();
    return state.player;
  },

  async login(name, pin) {
    const data = await request('/api/auth/login', { method: 'POST', body: { name, pin } });
    store.set(K.token, data.token);
    state.player = data.player;
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    state.offline = false;
    return data.player;
  },

  async bet(game, amount) {
    try {
      const data = await request('/api/bet', { method: 'POST', body: { game, amount } });
      if (state.player) state.player.balance = data.balance;
      return data.balance;
    } catch (err) {
      if (!localFail(err)) throw err;
      const p = localPlayer();
      p.balance -= amount;
      p.wagered = (p.wagered || 0) + amount;
      p.rounds = (p.rounds || 0) + 1;
      localGameStat(p, game, 'bet', amount);
      saveLocal(p);
      localTx('insats', game, -amount, p.balance);
      state.player = p;
      return p.balance;
    }
  },

  async credit(game, amount) {
    if (!(amount > 0)) return state.player?.balance ?? 0;
    try {
      const data = await request('/api/credit', { method: 'POST', body: { game, amount } });
      if (state.player) state.player.balance = data.balance;
      return data.balance;
    } catch (err) {
      if (!localFail(err)) throw err;
      const p = localPlayer();
      p.balance += amount;
      p.won = (p.won || 0) + amount;
      if (game === 'quiz') p.quizCorrect = (p.quizCorrect || 0) + 1;
      localGameStat(p, game, 'win', amount);
      saveLocal(p);
      localTx('vinst', game, amount, p.balance);
      state.player = p;
      return p.balance;
    }
  },

  async bonus() {
    try {
      const data = await request('/api/bonus', { method: 'POST' });
      if (state.player) state.player.balance = data.balance;
      return data;
    } catch (err) {
      if (err.status === 429) throw err;
      if (!localFail(err)) throw err;
      const p = localPlayer();
      const bonus = state.settings.dailyBonus || 500;
      p.balance += bonus;
      p.lastBonus = Date.now();
      saveLocal(p);
      localTx('bonus', 'daglig bonus', bonus, p.balance);
      state.player = p;
      return { balance: p.balance, bonus };
    }
  },

  async sportMatches(kind) {
    const sport = kind === 'hockey' ? 'hockey' : 'football';
    try {
      const data = await request('/api/sport/matches' + (sport === 'hockey' ? '?sport=hockey' : ''));
      state.offline = false;
      return data;
    } catch (err) {
      if (!localFail(err)) throw err;
      await settleLocalSport();
      return offlineFeed(sport);
    }
  },

  async placeSportBet({ matchId, market, selection, amount, sport: kind }) {
    const sport = kind === 'hockey' ? 'hockey' : 'football';
    try {
      const data = await request('/api/sport/bet', {
        method: 'POST',
        body: { matchId, market, selection, amount, sport }
      });
      if (state.player) state.player.balance = data.balance;
      return data;
    } catch (err) {
      if (!localFail(err)) throw err;
      const match = localSportFeed(sport).find((m) => m.id === matchId);
      if (!match) throw new Error('Matchen finns inte längre');
      if (match.status === 'finished') throw new Error('Matchen är redan slut');
      const marketData = match.markets.find((m) => m.key === market);
      const pick = marketData && marketData.selections.find((x) => x.key === selection);
      if (!pick) throw new Error('Ogiltigt spel');
      await api.bet('sport', amount);
      const bet = {
        id: 'local-' + Math.random().toString(36).slice(2, 9),
        matchId,
        sport,
        match: match.home + ' – ' + match.away,
        league: match.league,
        market,
        marketLabel: marketData.label,
        selection,
        selectionLabel: pick.long || pick.label,
        stake: amount,
        odds: pick.odds,
        homeScoreAtBet: match.homeScore || 0,
        awayScoreAtBet: match.awayScore || 0,
        minuteAtBet: match.minute || 0,
        potential: Math.round(amount * pick.odds * 100) / 100,
        status: 'open',
        placedAt: Date.now(),
        settledAt: null,
        payout: 0,
        result: null
      };
      const list = localSportBets();
      list.unshift(bet);
      saveLocalSportBets(list);
      return { bet, balance: state.player ? state.player.balance : 0 };
    }
  },

  async sportBets() {
    try {
      const data = await request('/api/sport/bets');
      state.offline = false;
      return data;
    } catch (err) {
      if (!localFail(err)) throw err;
      await settleLocalSport();
      const bets = localSportBets().sort((a, b) => b.placedAt - a.placedAt);
      return {
        bets,
        open: bets.filter((b) => b.status === 'open').length,
        balance: state.player ? state.player.balance : 0
      };
    }
  },

  async adminSport() {
    return request('/api/admin/sport');
  },

  async adminSportSettings(next) {
    return request('/api/admin/sport', { method: 'POST', body: next });
  },

  async adminLogin(code) {
    const data = await request('/api/admin/login', { method: 'POST', body: { code } });
    state.adminToken = data.adminToken;
    store.set(K.admin, data.adminToken);
    return data;
  },

  async adminOverview() {
    const data = await request('/api/admin/overview');
    state.adminData = data;
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    return data;
  },

  async adminPlayer(id, action, value) {
    return request('/api/admin/player', { method: 'POST', body: { id, action, value } });
  },

  async adminSettings(settings) {
    const data = await request('/api/admin/settings', { method: 'POST', body: { settings } });
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    return data;
  },

  async adminBroadcast(message) {
    return request('/api/admin/broadcast', { method: 'POST', body: { message } });
  },

  adminLogout() {
    state.adminToken = null;
    store.del(K.admin);
  }
};

/* ------------------------------ Lokal admin ------------------------------ */
/* Används när servern/databasen inte svarar (t.ex. statisk publicering).
   Servern kontrollerar koden själv när den finns tillgänglig. */

const LOCAL_ADMIN_CODE = 'Vincent12';

function bogusCodeError() {
  const err = new Error('Fel kod');
  err.status = 401;
  return err;
}

export const localAdmin = {
  login(code) {
    if (String(code || '').trim().toLowerCase() !== LOCAL_ADMIN_CODE.toLowerCase()) throw bogusCodeError();
    state.adminLocal = true;
    return true;
  },

  overview() {
    const p = localPlayer();
    const settings = localSettings();
    const players = [
      {
        id: p.id,
        name: p.name,
        balance: p.balance,
        createdAt: p.createdAt,
        lastSeen: p.lastSeen || Date.now(),
        wagered: p.wagered || 0,
        won: p.won || 0,
        rounds: p.rounds || 0,
        quizCorrect: p.quizCorrect || 0,
        hasPin: !!p.hasPin,
        banned: !!p.banned,
        ...screenStatsOf(p)
      }
    ];
    const gameTotals = {};
    Object.entries(p.gameStats || {}).forEach(([game, stat]) => {
      const row = (gameTotals[game] = gameTotals[game] || { wagered: 0, won: 0, rounds: 0, best: 0 });
      row.wagered += stat.wagered || 0;
      row.won += stat.won || 0;
      row.rounds += stat.rounds || 0;
      if ((stat.best || 0) > row.best) row.best = stat.best;
    });

    return {
      players,
      gameTotals,
      totals: {
        wagered: p.wagered || 0,
        won: p.won || 0,
        balance: p.balance || 0,
        rounds: p.rounds || 0,
        active24h: 1,
        ...screenStatsOf(p)
      },
      settings,
      transactions: store.get('ph.tx', []) || [],
      broadcast: store.get('ph.broadcast', '') || '',
      storage: 'local'
    };
  },

  player(id, action, value) {
    const p = localPlayer();
    if (action === 'setBalance') p.balance = Math.max(0, Math.min(1e7, Math.round(Number(value) || 0)));
    else if (action === 'add') p.balance = Math.max(0, p.balance + Math.round(Number(value) || 0));
    else if (action === 'ban') p.banned = !!value;
    else if (action === 'resetScreen') {
      p.screenTime = 0;
      p.screenDays = {};
      p.screenVisits = 0;
      p.screenLast = 0;
    }
    else if (action === 'reset') {
      p.balance = localSettings().startBalance;
      p.wagered = 0;
      p.won = 0;
      p.rounds = 0;
    }
    saveLocal(p);
    state.player = p;
    localTx('admin', 'saldo ändrat', 0, p.balance);
    return { player: p };
  },

  settings(next) {
    const merged = { ...localSettings(), ...next };
    if (merged.maxBet < merged.minBet) merged.maxBet = merged.minBet;
    store.set('ph.settings', merged);
    state.settings = merged;
    return { settings: merged };
  },

  broadcast(message) {
    store.set('ph.broadcast', message);
    state.broadcast = message;
    return { broadcast: message };
  }
};

export async function ensureSession() {
  const token = store.get(K.token);
  if (token) {
    try {
      await api.me();
      return;
    } catch (err) {
      if (err.status === 403) {
        state.player = null;
        throw err;
      }
    }
  }
  await api.guest();
}

/* --------------------- Inställningar live --------------------- */

/* Spelen kan säga "en runda pågår" så att en omladdning väntar tills
   rundan är klar – annars skulle insatsen kunna försvinna. */
const roundGuards = [];

export function guardRound(check) {
  if (typeof check === 'function') roundGuards.push(check);
}

function roundInProgress() {
  return roundGuards.some((check) => {
    try {
      return !!check();
    } catch (e) {
      return false;
    }
  });
}

let settingsWatch = null;

function applyRemoteSettings(settings) {
  if (!settings) return;
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  // Spelen lyssnar på detta och ritar om sina turmärken direkt.
  if (typeof document !== 'undefined') document.dispatchEvent(new Event('settings:updated'));
}

async function readSettingsVersion() {
  const res = await fetch('/api/settings?t=' + Date.now(), {
    headers: { accept: 'application/json' },
    cache: 'no-store'
  });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null; // statisk host – inget att jämföra
  const data = await res.json();
  if (!data || !data.version) return null;
  return data;
}

/**
 * Håller koll på om admin ändrar inställningarna. När versionen ändras
 * laddas sidan om för alla spelare (admin själv får bara nya värden).
 * Väntar med omladdningen om en runda pågår eller en modal är öppen.
 */
export function watchSettings(interval = 5000) {
  if (settingsWatch) return settingsWatch;

  const watch = {
    version: null,
    timer: null,
    ticker: null,
    pending: false
  };
  settingsWatch = watch;

  const stopTicker = () => {
    if (watch.ticker) {
      clearInterval(watch.ticker);
      watch.ticker = null;
    }
  };

  const reloadNow = () => {
    stopTicker();
    watch.pending = false;
    location.reload();
  };

  const busy = () => roundInProgress() || !!document.querySelector('.modal-backdrop');

  const waitThenReload = () => {
    stopTicker();
    watch.ticker = setInterval(() => {
      if (busy()) return;
      reloadNow();
    }, 1000);
  };

  const changed = (data) => {
    applyRemoteSettings(data.settings);
    watch.version = String(data.version);

    if (state.adminToken) {
      // Adminens egen flik ska inte kastas ut ur panelen.
      toast('Inställningarna uppdaterades');
      return;
    }

    if (watch.pending) return;
    watch.pending = true;

    if (roundInProgress()) {
      toast('Admin ändrade inställningarna – sidan laddas om när rundan är klar', 'gold', 4200);
      waitThenReload();
      return;
    }

    toast('Inställningarna uppdaterades – sidan laddas om …', 'gold', 2600);
    setTimeout(() => {
      if (busy()) waitThenReload();
      else reloadNow();
    }, 1400);
  };

  const poll = async () => {
    if (watch.pending || document.hidden) return;
    let data;
    try {
      data = await readSettingsVersion();
    } catch (err) {
      return; // offline – försök igen nästa gång
    }
    if (!data) return;
    const version = String(data.version);
    if (!watch.version) {
      watch.version = version;
      applyRemoteSettings(data.settings);
      return;
    }
    if (version !== watch.version) changed(data);
  };

  poll();
  watch.timer = setInterval(poll, interval);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });

  return watch;
}

/* ------------------------------ Router ------------------------------ */

const views = new Map();
export function registerView(name, render) {
  views.set(name, render);
}

const ROUTES = {
  '': 'home',
  matte: 'matte',
  engelska: 'engelska',
  svenska: 'svenska',
  geografi: 'geografi',
  utmaning: 'utmaning',
  framsteg: 'framsteg',
  profil: 'konto',
  konto: 'konto',
  lararpanel: 'lararpanel',
  kasino: 'casino',
  reklam: 'reklam',
  admin: 'admin'
};

export function currentRoute() {
  const raw = (location.hash || '#/').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  const head = parts[0] || '';
  if (head === 'kasino') {
    return { name: parts[1] || 'casino', parts, casino: true };
  }
  if (head === 'admin') return { name: 'admin', parts, casino: true };
  return { name: ROUTES[head] || 'home', parts, casino: false };
}

export function navigate(path) {
  const target = '#/' + String(path).replace(/^\/+/, '');
  if (location.hash === target) renderRoute();
  else location.hash = target;
}

export function renderRoute() {
  const route = currentRoute();
  state.route = route;
  const body = document.body;
  body.classList.toggle('theme-casino', route.casino);
  body.classList.toggle('theme-study', !route.casino);

  if (route.casino && !state.unlocked && route.name !== 'admin') {
    navigate('/');
    toast('Den sidan finns inte.', 'bad');
    return;
  }

  document.title = route.casino
    ? 'Golden Spade — spelhall med spelmynt'
    : 'Plugghörnan – träna matte, engelska, svenska & geografi';

  const view = document.getElementById('view');
  if (!view) return;
  const render = views.get(route.name) || views.get('home');
  view.innerHTML = '';
  try {
    render(view, route);
  } catch (err) {
    console.error('Vyfel:', err);
    view.innerHTML = `<div class="wrap"><p class="muted">Något gick fel: ${esc(err.message)}</p></div>`;
  }
  hooks.onRoute?.(route);
  try {
    window.scrollTo(0, 0);
  } catch (e) {
    /* vissa miljöer saknar scrollTo */
  }
}

/* ------------------------------ Lås upp spelhallen ------------------------------ */

export function unlockCasino({ silent = false } = {}) {
  if (state.unlocked) {
    navigate('/kasino');
    return;
  }
  state.unlocked = true;
  store.set(K.unlock, true);
  if (!silent) {
    sfx.bigWin();
    toast('🎩 Välkommen till spelhallen – endast spelmynt!', 'gold', 3200);
  }
  navigate('/kasino');
}

/* ------------------------------ Diverse UI ------------------------------ */

export function setBalance(value) {
  if (state.player) state.player.balance = value;
  const el = document.getElementById('balance-value');
  if (el) el.textContent = kr(value);
}

/* ------------------------------ skärmtid ------------------------------ */

/**
 * Räknar bara den tid fliken faktiskt är synlig och rapporterar den till
 * servern varje minut (och när fliken lämnas). Tiden hamnar i adminpanelens
 * skärmtidskolumn – det är speltid, inte tid i studieläget.
 */
export function startScreenTime({ tickMs = 15000, sendMs = 60000 } = {}) {
  if (typeof document === 'undefined') return;
  if (startScreenTime.started) return;
  startScreenTime.started = true;

  let pending = 0;
  let last = Date.now();
  let lastVisible = !document.hidden && document.visibilityState === 'visible';

  /* Lägger till tiden sedan förra ticket om fliken var synlig då – så att
     tiden fram till att man lämnar fliken också räknas. */
  const seconds = () => {
    const t = Date.now();
    const delta = Math.max(0, (t - last) / 1000);
    last = t;
    const visibleNow = !document.hidden && document.visibilityState === 'visible';
    if (lastVisible && delta <= 120) pending += delta; // >120 s = datorn har vilat
    lastVisible = visibleNow;
  };

  const flush = (keepalive = false) => {
    const secs = Math.round(pending);
    if (secs < 1) return;
    pending = 0;
    api.screen(secs, keepalive).catch(() => {});
  };

  document.addEventListener('visibilitychange', () => {
    seconds();
    if (document.hidden) flush(true);
    else last = Date.now();
  });
  window.addEventListener('pagehide', () => {
    seconds();
    flush(true);
  });
  window.addEventListener('beforeunload', () => {
    seconds();
    flush(true);
  });

  setInterval(() => {
    seconds();
    if (pending >= sendMs / 1000) flush();
  }, tickMs);
}

export function updateBalanceUI() {
  const el = document.getElementById('balance-value');
  if (el && state.player) el.textContent = kr(state.player.balance);
}

export function isCasino() {
  return document.body.classList.contains('theme-casino');
}

export function avatarLetter(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

/* Global ljudknapp-hjälp */
export function toggleMute() {
  state.muted = !state.muted;
  store.set(K.mute, state.muted);
  return state.muted;
}

export const keys = K;
