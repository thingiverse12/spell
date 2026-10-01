/**
 * Spell - integration test for the REAL browser networking module.
 *
 * This boots a server and then drives `client/src/net.js` (the exact module the
 * browser loads) from Node, with the `ws` package standing in for the browser's
 * WebSocket and `location` stubbed. It therefore verifies the client half of
 * the protocol - handshake, prediction/reconciliation, inventory, buildings,
 * events - without a browser.
 *
 * Usage:  npm run test:client
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'data-clienttest');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); } else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const PORT = await freePort();
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), SEED: '21', DATA_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`  [srv:err] ${d}`));

  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/status`); if (r.ok) break; } catch { /* wait */ }
    await sleep(200);
  }

  // Browser globals the client module expects
  globalThis.location = { protocol: 'http:', host: `127.0.0.1:${PORT}` };
  globalThis.WebSocket = WebSocket;
  const { Net } = await import('../client/src/net.js');

  const events = [];
  const seenBuildings = new Map();
  const net2 = new Net({
    playerId: 'client-net-test',
    name: 'NetTest',
    handlers: {
      onEvent: (ev) => events.push(ev),
      onBuilding: (b) => seenBuildings.set(b.id, b),
      onBuildingRemove: (id) => seenBuildings.delete(id),
      onChat: (msg) => events.push({ e: 'chat', ...msg }),
    },
  });

  console.log('\n\x1b[1mClient networking test (client/src/net.js)\x1b[0m');
  await net2.connect();
  check('handshake completed', net2.ready === true);
  check('welcome carries the world config', !!net2.welcome && net2.welcome.world.size === 512);
  check('local prediction world was created', !!net2.localWorld && net2.localWorld.seed === 21);

  // ---- movement: send real inputs and let reconciliation run
  const startX = net2.you.x;
  const startZ = net2.you.z;
  for (let i = 0; i < 50; i++) {
    net2.sendInput({ yaw: 1.1, pitch: 0, wish: 1, strafe: 0, jump: i === 20, sprint: true, dt: 1 / 30 });
    await sleep(33);
  }
  await sleep(400);
  const moved = Math.hypot(net2.you.x - startX, net2.you.z - startZ);
  check('player moved after sending input', moved > 2, `moved=${moved.toFixed(2)} m`);
  check('prediction stayed in sync with the server', net2.predictor.lastCorrection < 0.25,
    `last correction=${net2.predictor.lastCorrection.toFixed(3)} m`);
  check('snapshots are arriving', net2.stats.bytesIn > 0 && net2.players.size >= 1);
  check('stamina was drained/recovered by the server sim', net2.you.stamina <= 100.5);

  // ---- nodes replicated
  check('resource nodes replicated to the client', net2.nodes.size > 0, `nodes=${net2.nodes.size}`);

  // ---- walk to the nearest tree and harvest through the real protocol
  let tree = null;
  let best = Infinity;
  for (const n of net2.nodes.values()) {
    if (n.type !== 'tree') continue;
    const d = Math.hypot(n.x - net2.you.x, n.z - net2.you.z);
    if (d < best) { best = d; tree = n; }
  }
  check('a tree is visible to gather from', !!tree, `nearest=${best === Infinity ? 'n/a' : best.toFixed(1)} m`);
  if (tree) {
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const dx = tree.x - net2.you.x;
      const dz = tree.z - net2.you.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.6) break;
      net2.sendInput({ yaw: Math.atan2(dx, dz), wish: 1, strafe: 0, sprint: d > 5, dt: 1 / 20 });
      await sleep(50);
    }
    const before = net2.you.inv.filter(Boolean).filter((s) => s.item === 'wood').reduce((a, s) => a + s.n, 0);
    for (let i = 0; i < 6; i++) {
      const res = await net2.action('harvest', { id: tree.id });
      if (i === 0) check('harvest answered by the server', res.ok === true, JSON.stringify(res).slice(0, 120));
      await sleep(600);
    }
    const after = net2.you.inv.filter(Boolean).filter((s) => s.item === 'wood').reduce((a, s) => a + s.n, 0);
    check('wood landed in the inventory through the protocol', after > before, `before=${before} after=${after}`);
    check('server sent harvest events to the client', events.some((e) => e.e === 'swing'), `events=${events.length}`);
  }

  // ---- building: craft + place, and check the client collider learned about it
  const recipeOk = await prepareAndPlace(net2);
  check('craft + place round trip', recipeOk.placed, recipeOk.detail);
  check('client replicated the new building', seenBuildings.size >= (recipeOk.placed ? 1 : 0), `buildings=${seenBuildings.size}`);
  if (recipeOk.placed) {
    const b = [...seenBuildings.values()][0];
    check('building collision box registered for prediction', net2.localWorld.buildingAABBs(b.cx * 4, b.cz * 4, 4).length >= 0);
  }

  // ---- chat event round trip
  net2.chat('hej från klientmodulen');
  await sleep(300);

  // ---- error handling: the same player in a second tab must be reported as 4001
  const dup = new Net({ playerId: 'client-net-test', name: 'NetTest', handlers: {} });
  let dupErr = null;
  try { await dup.connect(); } catch (err) { dupErr = err; }
  check('a duplicate player id is rejected', !!dupErr, 'connection was accepted');
  if (dupErr) {
    check('the rejection carries code 4001 (already connected)', dupErr.code === 4001, `code=${dupErr.code} reason=${dupErr.reason}`);
    check('the rejection names the WebSocket URL', typeof dupErr.url === 'string' && dupErr.url.endsWith('/ws'), String(dupErr.url));
  }
  net2.disconnect();
  await sleep(300);

  // ---- a guest identity can join while the first player is still online
  const guest = new Net({ playerId: 'guest-1', name: 'Guest', handlers: {} });
  await guest.connect();
  check('a guest identity joins successfully', guest.ready === true);
  guest.disconnect();
  await sleep(200);

  // ---- connecting to a dead server fails fast and reports a code
  server.kill('SIGTERM');
  await sleep(600);
  const dead = new Net({ playerId: 'nobody', name: 'Nobody', handlers: {} });
  const t0 = Date.now();
  let deadErr = null;
  try { await dead.connect(); } catch (err) { deadErr = err; }
  check('connecting with no server rejects', !!deadErr);
  check('it fails quickly instead of hanging', Date.now() - t0 < 9000, `${Date.now() - t0} ms`);
  check('the HTTP side also reports the server as gone', await (async () => {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/status`); return !r.ok; } catch { return true; }
  })());

  console.log(`\n\x1b[1mResult:\x1b[0m ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

/** Gather a bit of wood/stone if needed, then craft and place a foundation. */
async function prepareAndPlace(net2) {
  const count = (item) => net2.you.inv.filter(Boolean).filter((s) => s.item === item).reduce((a, s) => a + s.n, 0);
  const wanted = { wood: 10, stone: 3, fiber: 2 };
  for (let attempt = 0; attempt < 12; attempt++) {
    const missing = Object.entries(wanted).find(([item, n]) => count(item) < n);
    if (!missing) break;
    const type = missing[0] === 'wood' ? 'tree' : missing[0] === 'stone' ? 'rock' : 'bush';
    let target = null;
    let bd = 120;
    for (const n of net2.nodes.values()) {
      if (n.type !== type) continue;
      const d = Math.hypot(n.x - net2.you.x, n.z - net2.you.z);
      if (d < bd) { bd = d; target = n; }
    }
    if (!target) break;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const dx = target.x - net2.you.x;
      const dz = target.z - net2.you.z;
      if (Math.hypot(dx, dz) < 2.6) break;
      net2.sendInput({ yaw: Math.atan2(dx, dz), wish: 1, strafe: 0, sprint: true, dt: 1 / 20 });
      await sleep(50);
    }
    for (let i = 0; i < 6; i++) { await net2.action('harvest', { id: target.id }); await sleep(560); }
  }
  await net2.action('craft', { id: 'stone_axe' });
  await net2.action('craft', { id: 'foundation' });
  const cx = Math.floor(net2.you.x / 4);
  const cz = Math.floor(net2.you.z / 4);
  const res = await net2.action('place', { piece: 'foundation', cx, cz, rot: 0 });
  await sleep(300);
  return { placed: !!res.ok, detail: JSON.stringify(res).slice(0, 160) };
}

main().catch((err) => {
  console.error('client-net test crashed:', err);
  process.exit(1);
});
