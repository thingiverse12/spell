/**
 * Spell - authoritative game server.
 *
 *   HTTP  : serves the WebGL client (static files) + /api/* status endpoints
 *   WS    : the game protocol (see docs/architecture.md)
 *
 * Architecture follows the report: one authoritative simulation process
 * (tick loop), interest-managed replication, JSON persistence, and a client
 * that only sends *input* - never world state.
 *
 *   node server/index.js            # default port 8080
 *   PORT=9000 SEED=42 node server/index.js
 *
 * NO AUTHENTICATION is implemented yet: the client sends a self-generated
 * persistent player id. That is an accepted MVP limitation and one of the
 * first things to replace (see docs/roadmap.md).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { NET, TIME, WORLD, PIECES, ITEMS, RECIPES, ITEMS as ITEM_DEFS, playerColor } from '../shared/config.js';
import { World } from './world.js';
import * as rules from './rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'client');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const SEED = Number(process.env.SEED || WORLD.seed);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TICK_MS = 1000 / NET.tickRate;
/** Identifies this process, so tests/tools can tell instances apart. */
const BOOT_ID = process.env.BOOT_ID || Math.random().toString(36).slice(2, 10);

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

/* ------------------------------------------------------------------ *
 *  World + loop
 * ------------------------------------------------------------------ */

const world = new World({ seed: SEED, dataDir: DATA_DIR, log });
world.time01 = TIME.start;

const clients = new Map(); // playerId -> connection
let tick = 0;
let lastTickAt = Date.now();

function send(conn, msg) {
  if (conn.ws.readyState !== 1) return;
  conn.ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId = null) {
  for (const [id, conn] of clients) {
    if (id !== exceptId) send(conn, msg);
  }
}

function nearestPlayer(x, z, radius) {
  let best = null;
  let bestD = radius * radius;
  for (const conn of clients.values()) {
    const p = conn.player;
    if (!p || p.health <= 0) continue;
    const dx = p.x - x;
    const dz = p.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = p; }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 *  Replication (interest management + delta compression)
 * ------------------------------------------------------------------ */

function syncStatics(conn) {
  const p = conn.player;
  const R = NET.interestRadius;

  // ---- resource nodes: only changes are sent after the initial sync
  const seenNodes = new Set();
  for (const n of world.nearbyNodes(p.x, p.z, R)) {
    seenNodes.add(n.id);
    if (conn.knownNodes.get(n.id) !== n.v) {
      conn.knownNodes.set(n.id, n.v);
      conn.outNodes.push([n.id, +n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2), n.type, +n.rot.toFixed(2), +n.scale.toFixed(2)]);
    }
  }
  for (const id of conn.knownNodes.keys()) {
    if (!seenNodes.has(id)) { conn.knownNodes.delete(id); conn.outNodeRem.push(id); }
  }

  // ---- buildings
  const seenB = new Set();
  for (const b of world.nearbyBuildings(p.x, p.z, R)) {
    seenB.add(b.id);
    if (conn.knownBuildings.get(b.id) !== b.v) {
      conn.knownBuildings.set(b.id, b.v);
      conn.outBuildings.push([b.id, b.piece, b.cx, b.cz, b.rot, +b.y.toFixed(2), Math.round(b.hp), b.open ? 1 : 0, b.ownerName]);
    }
  }
  for (const id of conn.knownBuildings.keys()) {
    if (!seenB.has(id)) { conn.knownBuildings.delete(id); conn.outBuildingRem.push(id); }
  }
}

function buildSnapshot(conn) {
  const p = conn.player;
  conn.outNodes = [];
  conn.outNodeRem = [];
  conn.outBuildings = [];
  conn.outBuildingRem = [];
  syncStatics(conn);

  const players = [];
  for (const other of clients.values()) {
    const q = other.player;
    if (!q || (q.health <= 0 && q.id !== p.id)) continue;
    if (q.id !== p.id && Math.hypot(q.x - p.x, q.z - p.z) > NET.interestRadius) continue;
    players.push([
      q.id, q.name, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2),
      +q.yaw.toFixed(3), +q.pitch.toFixed(3), q.crouch ? 1 : 0, Math.round(q.health),
      q.inWater ? 1 : 0, q.toolSlot >= 0 && q.inv[q.toolSlot] ? q.inv[q.toolSlot].item : null,
      q.color || playerColor(q.id), // 11: so players can be told apart
    ]);
  }

  // animals live within a shorter radius - they move every tick
  const animals = [];
  for (const a of world.nearbyAnimals(p.x, p.z, Math.min(160, NET.interestRadius))) {
    animals.push([a.id, a.type, +a.x.toFixed(2), +a.y.toFixed(2), +a.z.toFixed(2), +a.yaw.toFixed(2), Math.round(a.hp)]);
  }

  const snap = {
    t: 'snap',
    tick,
    time01: +world.time01.toFixed(4),
    day: world.day,
    ack: p.ack,
    you: {
      seq: p.lastSeq,
      x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
      vx: +p.vx.toFixed(3), vy: +p.vy.toFixed(3), vz: +p.vz.toFixed(3),
      health: +p.health.toFixed(2), hunger: +p.hunger.toFixed(2), thirst: +p.thirst.toFixed(2),
      stamina: +p.stamina.toFixed(2), breath: +p.breath.toFixed(2),
      onGround: p.onGround ? 1 : 0, inWater: p.inWater ? 1 : 0,
      inv: p.inv, toolSlot: p.toolSlot,
      kills: p.kills || 0, deaths: p.deaths || 0, killsAnimal: p.killsAnimal || 0,
      dead: p.health <= 0 ? 1 : 0,
    },
    players,
    nodes: conn.outNodes,
    nrem: conn.outNodeRem,
    animals,
    buildings: conn.outBuildings,
    brem: conn.outBuildingRem,
    ev: conn.events.splice(0, conn.events.length),
  };
  return snap;
}

/* ------------------------------------------------------------------ *
 *  Game loop
 * ------------------------------------------------------------------ */

function gameTick() {
  const now = Date.now();
  const dt = Math.min(0.25, (now - lastTickAt) / 1000);
  lastTickAt = now;
  tick++;

  // 1. consume player input (server-authoritative movement)
  for (const conn of clients.values()) {
    const p = conn.player;
    if (p.health <= 0) { p.vx = p.vy = p.vz = 0; continue; }
    let timeBudget = dt * 1.35; // never simulate more time than real time
    while (conn.inputs.length && timeBudget > 0) {
      const inp = conn.inputs.shift();
      const step = Math.min(inp.dt || 1 / NET.inputRate, 0.1, timeBudget);
      if (inp.seq > p.lastSeq) {
        p.lastSeq = inp.seq;
        p.ack = inp.seq;
        p.yaw = inp.yaw;
        p.pitch = inp.pitch;
      }
      rules.stepPlayer(world, p, inp, step);
      timeBudget -= step;
      if (p.health <= 0) break;
    }
    if (p.health <= 0) { p.vx = p.vy = p.vz = 0; }
  }

  // 2. world simulation (animals, respawns, decay, day/night)
  world.step(dt, now, {
    nearestPlayer,
    onAnimalAttack: (animal, player, dmg) => {
      const died = rules.damage(world, player, dmg, 'animal', animal);
      const conn = clients.get(player.id);
      if (conn) conn.events.push({ e: 'hurt', from: animal.type, dmg, health: Math.round(player.health) });
      if (died && conn) conn.events.push({ e: 'died', cause: 'animal' });
    },
    onNodeRespawn: () => {},
    onBuildingDestroyed: (b, cause) => broadcast({ t: 'ev', e: 'buildingGone', id: b.id, cause }),
  });

  // 3. snapshot
  for (const conn of clients.values()) {
    if (!conn.player) continue;
    world.ensureChunksAround(conn.player.x, conn.player.z);
    world.applyPendingDead();
    send(conn, buildSnapshot(conn));
  }

  // 4. housekeeping
  if (tick % 40 === 0) {
    for (const [id, conn] of clients) {
      if (Date.now() - conn.lastSeen > NET.idleTimeoutMs) {
        log(`${id} timed out`);
        conn.ws.close(4000, 'idle');
      }
    }
  }
  if (tick % 4 === 0) {
    // disconnect bookkeeping for offline players
    for (const p of world.players.values()) if (p.offline && !clients.has(p.id)) { /* kept for persistence */ }
  }
}

/* ------------------------------------------------------------------ *
 *  Protocol
 * ------------------------------------------------------------------ */

function handleMessage(conn, msg) {
  const p = conn.player;
  if (!p) return;
  conn.lastSeen = Date.now();
  const now = Date.now();

  switch (msg.t) {
    case 'input': {
      if (conn.inputs.length > 24) conn.inputs.splice(0, conn.inputs.length - 24);
      conn.inputs.push({
        seq: msg.seq | 0,
        dt: Math.min(0.1, Math.max(0, msg.dt || 0)) || 1 / NET.inputRate,
        yaw: Number(msg.yaw) || 0, pitch: Number(msg.pitch) || 0,
        wish: Number(msg.wish) || 0, strafe: Number(msg.strafe) || 0,
        jump: !!msg.jump, sprint: !!msg.sprint, crouch: !!msg.crouch,
      });
      break;
    }

    case 'action': {
      let res = null;
      switch (msg.a) {
        case 'harvest': res = rules.harvest(world, p, msg.id, now); if (res?.ok) conn.events.push({ e: 'swing', kind: 'harvest', ...res }); break;
        case 'melee': {
          res = rules.melee(world, p, now);
          if (res?.ok) {
            conn.events.push({ e: 'swing', kind: 'melee', ...res });
            if (res.hit && !res.killedPlayer) p.lastHit = now;
          }
          break;
        }
        case 'craft': res = rules.craft(world, p, msg.id); break;
        case 'place':
          res = rules.placeBuilding(world, p, msg.piece, msg.cx | 0, msg.cz | 0, msg.rot | 0);
          if (res?.ok) conn.events.push({ e: 'placed', building: res.building, sound: 'build' });
          break;
        case 'door': {
          res = rules.toggleDoor(world, p, msg.id);
          if (res?.ok) conn.events.push({ e: 'door', id: res.building.id, open: res.building.open });
          break;
        }
        case 'demolish': res = rules.demolishBuilding(world, p, msg.id); break;
        case 'use': res = rules.consumeSlot(world, p, msg.slot | 0); break;
        case 'equip': res = rules.setToolSlot(world, p, msg.slot | 0); break;
        case 'moveitem': res = rules.moveItem(world, p, msg.from | 0, msg.to | 0); break;
        case 'repair': res = rules.repair(world, p, msg.slot | 0); break;
        case 'unstick': {
          res = rules.unstick(world, p);
          conn.events.push({ e: 'unstuck' });
          break;
        }
        case 'respawn': {
          if (p.health > 0) { res = { ok: false, error: 'alive' }; break; }
          rules.respawn(world, p);
          res = { ok: true };
          conn.events.push({ e: 'respawned' });
          break;
        }
        default: res = { ok: false, error: 'unknown-action' };
      }
      send(conn, { t: 'res', a: msg.a, r: msg.rid, ok: !!res?.ok, ...(res || {}) });
      break;
    }

    case 'chat': {
      const text = String(msg.text || '').slice(0, 200).trim();
      if (!text) break;
      if (now - (p.lastChatAt || 0) < 1200) { send(conn, { t: 'ev', e: 'chatSlow' }); break; }
      p.lastChatAt = now;
      broadcast({ t: 'ev', e: 'chat', from: p.name, id: p.id, text, at: now });
      break;
    }

    case 'ping':
      send(conn, { t: 'pong', id: msg.id, at: msg.at, now: Date.now(), serverTime: world.day * TIME.dayLengthSec + world.time01 * TIME.dayLengthSec });
      break;

    default: break;
  }
}

/* ------------------------------------------------------------------ *
 *  Connections
 * ------------------------------------------------------------------ */

function attachConnection(ws) {
  const conn = {
    ws,
    player: null,
    inputs: [],
    events: [],
    knownNodes: new Map(),
    knownBuildings: new Map(),
    lastSeen: Date.now(),
  };

  ws.on('message', (raw) => {
    if (raw.length > 8192) return; // protocol guard
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'hello') {
      if (conn.player) return;
      const id = String(msg.playerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || `anon${Date.now()}`;
      if (clients.has(id)) { ws.close(4001, 'already-connected'); return; }
      if (clients.size >= NET.maxPlayers) { ws.close(4002, 'server-full'); return; }

      let p = world.players.get(id);
      if (p && !p.offline) { ws.close(4001, 'already-connected'); return; }
      if (p) {
        // reconnecting player: restore progression, keep the rest of the state
        p.offline = false;
        p.name = (msg.name || p.name || 'Överlevare').slice(0, 18);
        if (p.health <= 0) rules.respawn(world, p);
        p.lastInputAt = Date.now();
      } else {
        p = world.addPlayer(id, msg.name);
      }
      p.ack = 0; p.lastSeq = 0; p.cooldownUntil = 0;
      delete p.offline;
      conn.player = p;
      clients.set(id, conn);
      world.ensureChunksAround(p.x, p.z);
      world.applyPendingDead();
      log(`${p.name} (${id}) joined - ${clients.size} online`);

      send(conn, {
        t: 'welcome',
        id,
        seed: world.seed,
        tick,
        day: world.day,
        time01: world.time01,
        world: { size: WORLD.size, grid: WORLD.grid, seaLevel: WORLD.seaLevel, maxHeight: WORLD.maxHeight },
        config: {
          items: ITEM_DEFS, recipes: RECIPES, pieces: PIECES, net: NET, time: TIME,
        },
        you: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, inv: p.inv, toolSlot: p.toolSlot, spawn: p.spawn },
        players: [...clients.values()].filter((c) => c.player && c.player.id !== id).map((c) => [c.player.id, c.player.name]),
      });
      broadcast({ t: 'ev', e: 'join', id: p.id, name: p.name }, p.id);
      return;
    }

    try {
      handleMessage(conn, msg);
    } catch (err) {
      log(`message handler error (${msg.t}): ${err.stack || err}`);
    }
  });

  ws.on('close', () => {
    if (!conn.player) return;
    const p = conn.player;
    p.offline = true;
    p.vx = p.vy = p.vz = 0;
    clients.delete(p.id);
    world.dirty = true;
    world.save(true);
    log(`${p.name} (${p.id}) left - ${clients.size} online`);
    broadcast({ t: 'ev', e: 'leave', id: p.id, name: p.name });
  });

  ws.on('error', (err) => log(`ws error: ${err.message}`));
}

/* ------------------------------------------------------------------ *
 *  HTTP (static client + status API)
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // required if you ever embed the client in an iframe / different origin
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      ok: true,
      bootId: BOOT_ID,
      uptimeSec: Math.round(process.uptime()),
      tick,
      tickRate: NET.tickRate,
      world: world.stats(),
      players: [...clients.values()].map((c) => ({
        id: c.player.id, name: c.player.name,
        x: Math.round(c.player.x), y: Math.round(c.player.y), z: Math.round(c.player.z),
        health: Math.round(c.player.health), ping: c.pingMs || null,
        kills: c.player.kills || 0, deaths: c.player.deaths || 0, animals: c.player.killsAnimal || 0,
      })),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    }, null, 2));
  } else if (pathname === '/api/leaderboard') {
    const all = [...world.players.values()]
      .map((p) => ({ name: p.name, kills: p.kills || 0, deaths: p.deaths || 0, animals: p.killsAnimal || 0 }))
      .sort((a, b) => b.kills - a.kills || b.animals - a.animals)
      .slice(0, 20);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(all, null, 2));
  } else {
    // The browser client imports the SAME modules the server uses
    // (/shared/*.js + the vendored engine), so the two can never drift apart.
    const root = pathname.startsWith('/shared/') ? path.resolve(ROOT) : PUBLIC_DIR;
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403); res.end('403'); return; }
    serveFile(res, file);
  }
});

/**
 * WebSocket endpoint.
 *
 * We deliberately do NOT bind the server to a fixed path: preview proxies and
 * reverse proxies sometimes rewrite or prefix the path, and a mis-matched path
 * shows up in the browser as a generic "WebSocket error". Any upgrade request
 * on this port is treated as a game connection; the client always asks for /ws.
 */
// A failed bind must be fatal and loud: without this the process would keep
// running (the crash guards below swallow it) while serving nothing.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`FATAL: port ${PORT} is already in use - another Spell server is running. Exiting.`);
  } else {
    log(`FATAL server error: ${err.stack || err}`);
  }
  process.exit(1);
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16 * 1024,
  perMessageDeflate: false,
});

server.on('upgrade', (req, socket, head) => {
  const url = (req.url || '').split('?')[0];
  // health/metrics endpoints should never be upgraded
  if (url !== '/ws' && url !== '/' && url !== '/socket') {
    log(`ws upgrade rejected for path ${url}`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', attachConnection);
wss.on('error', (err) => log(`ws server error: ${err.message}`));

server.listen(PORT, HOST, () => {
  log(`Spell server listening on http://${HOST}:${PORT}  (ws://<host>:${PORT}/ws)`);
  log(`seed=${world.seed} world=${WORLD.size}m tick=${NET.tickRate}Hz data=${DATA_DIR} boot=${BOOT_ID}`);
});

/* ------------------------------------------------------------------ *
 *  Lifecycle
 * ------------------------------------------------------------------ */

setInterval(() => {
  try {
    gameTick();
  } catch (err) {
    // A single bad tick must never take the whole world down: log and continue.
    log(`TICK ERROR: ${err.stack || err}`);
    lastTickAt = Date.now();
  }
}, TICK_MS);
const autosave = setInterval(() => {
  if (world.save(true)) log(`autosave ok (${clients.size} online)`);
}, NET.autosaveMs);

function shutdown(signal) {
  log(`${signal} - saving world and shutting down`);
  clearInterval(autosave);
  world.save(true);
  for (const conn of clients.values()) conn.ws.close(1001, 'server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Last line of defence: keep the live preview alive, but make the problem loud.
// Startup failures (nothing is listening yet) still exit, so a broken config or
// a taken port never leaves a silent zombie process behind.
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.stack || err}`);
  if (!server.listening) setTimeout(() => process.exit(1), 50);
});
process.on('unhandledRejection', (err) => {
  log(`UNHANDLED REJECTION: ${err?.stack || err}`);
});

export { world, server, clients };
void ITEMS;
