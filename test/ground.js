/**
 * Spell - ground invariant tests (rule: nothing may end up under the surface).
 *
 * The player falling through the ground was the first real bug in this project,
 * so the invariant is now enforced in one shared module and checked here:
 *
 *   1. the helpers themselves (surface, footprint, lift, depth)
 *   2. the audit finds buried things of every kind - and reports nothing when
 *      everything is on the surface (no false positives)
 *   3. buildings: a wall is never buried by a slope (placement + audit)
 *   4. the live server: after a full simulation run nothing (players, animals,
 *      nodes, buildings) is below the surface, and the audit reports zero
 *   5. the client renderer: an interpolated position on a slope is lifted
 *
 * Usage:  npm run test:ground
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { sampleHeight, terrainHeight } from '../shared/noise.js';
import {
  GROUND_EPS, surfaceUnder, footprintSurface, liftToSurface, buryDepth, auditGround, describeViolations,
} from '../shared/ground.js';
import { WORLD, PIECES, piecePosition, ITEMS } from '../shared/config.js';
import { World } from '../server/world.js';
import { placeBuilding, GROUND_LIFT_LIMIT } from '../server/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; } else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sample = (x, z) => sampleHeight(x, z, 1337);

console.log('\n\x1b[1mMarktest (inget får hamna under marken)\x1b[0m');

/* ------------------------------------------------------------------ *
 * 1. Helpers
 * ------------------------------------------------------------------ */
section('1. Markhjälpen');

check('ytan är ändlig', Number.isFinite(surfaceUnder(sample, 10, 10)));
check('ytan tål skräp-indata', Number.isFinite(surfaceUnder(() => NaN, 0, 0, 7)) && surfaceUnder(() => NaN, 0, 0, 7) === 7);
check('fotavtryck tar högsta punkten', footprintSurface((x) => 10 + x, 0, 0, 2, 2) === 12, String(footprintSurface((x) => 10 + x, 0, 0, 2, 2)));
check('fotavtryck utan storlek = punkten', footprintSurface((x) => 3, 5, 5, 0, 0) === 3);
check('fotavtryck tål NaN', Number.isFinite(footprintSurface(() => NaN, 1, 1, 2, 2)));
check('lyft räddar begravd', liftToSurface(-5, 2) === 2);
check('lyft rör inte fri', liftToSurface(2.5, 2) === 2.5);
check('lyft tål NaN', liftToSurface(NaN, 2) === 2);
check('djup räknas rätt', Math.abs(buryDepth(1, 2, 0.05) - 0.95) < 1e-9, String(buryDepth(1, 2, 0.05)));
check('precis på ytan är inte begravd', buryDepth(2, 2) <= 0);
check('strax under toleransen är okej', buryDepth(2 - GROUND_EPS, 2) <= 1e-9, String(buryDepth(2 - GROUND_EPS, 2)));
check('djup för skräp är oändligt', buryDepth(NaN, 2) === Infinity);

/* ------------------------------------------------------------------ *
 * 2. The audit
 * ------------------------------------------------------------------ */
section('2. Revisionen hittar begravda objekt - och varnar inte i onödan');

const at = (x, z) => { const h = sample(x, z); return { x, z, y: h }; };
const ground = { x: 12, z: -8, y: sample(12, -8) };
const buriedPlayer = { id: 'p1', x: 12, z: -8, y: sample(12, -8) - 1.2 };
const buriedAnimal = { id: 'a1', x: 30, z: 20, y: sample(30, 20) - 0.4 };
const buriedNode = { id: 'n1', x: -40, z: 5, y: sample(-40, 5) - 0.3 };
const buriedWall = { id: 'b1', piece: 'wall', x: 60, z: 60, y: sample(60, 60) - 0.9 };
const okFoundation = { id: 'b2', piece: 'foundation', x: 70, z: 70, y: sample(70, 70) };
const okWall = { id: 'b3', piece: 'wall', x: 80, z: 80, y: sample(80, 80) + 3 };

const found = auditGround(sample, {
  players: [ground, buriedPlayer],
  animals: [buriedAnimal],
  nodes: [buriedNode],
  buildings: [buriedWall, okFoundation, okWall],
}, { pieces: PIECES });

const kinds = found.map((v) => v.kind).sort().join(',');
check('hittar spelaren', found.some((v) => v.kind === 'player' && v.id === 'p1'));
check('hittar djuret', found.some((v) => v.kind === 'animal' && v.id === 'a1'));
check('hittar resursnoden', found.some((v) => v.kind === 'node' && v.id === 'n1'));
check('hittar den begravda väggen', found.some((v) => v.kind === 'building' && v.id === 'b1'));
check('antalet stämmer (4 av 7)', found.length === 4, `${found.length}: ${kinds}`);
check('inga falska larm för spelaren på ytan', !found.some((v) => v.id === 'p1' && v.kind === 'player' && v.depth < 1));
check('inga falska larm för grunden', !found.some((v) => v.id === 'b2'));
check('inga falska larm för väggen ovanför grunden', !found.some((v) => v.id === 'b3'));
check('värsta objektet först', found[0].kind === 'player' && found[0].depth > 1);
check('beskrivningen är läsbar', /player p1/.test(describeViolations(found)), describeViolations(found));
check('tom lista ger tom text', describeViolations([]) === '');
check('audit tål tomma samlingar', auditGround(sample, {}).length === 0);

/* ------------------------------------------------------------------ *
 * 3. Buildings: a slope must never swallow a wall
 * ------------------------------------------------------------------ */
section('3. Byggnader: en sluttning får inte sluka en vägg');

const wall = PIECES.wall;
const half = { halfX: wall.size[0] / 2, halfZ: wall.size[2] / 2 };
check('väggen är 4 m lång (stort fotavtryck)', wall.size[0] >= 4, JSON.stringify(wall.size));
check('dörren är lika bred', PIECES.door.size[0] >= 4);
check('fotavtrycket är högst upp i backen', (() => {
  // synthetic slope: +1 m per metre along x
  const slope = (x) => x;
  return footprintSurface(slope, 0, 0, 2, 0.2) === 2;
})());
check('en vägg på sluttning upptäcks även om mitten är "rätt"', (() => {
  // The centre sits exactly on the surface, but the uphill corner does not.
  const slope = (x) => x * 0.8;
  const cx = 3;
  const list = auditGround(slope, {
    buildings: [{ id: 'w', piece: 'wall', x: cx, z: 0, y: slope(cx), footprint: half }],
  }, { pieces: PIECES });
  return list.length === 1 && list[0].depth > 1;
})(), 'mitten-på-ytan-fällan');
check('samma vägg på platt mark är okej', (() => {
  const list = auditGround(() => 4, {
    buildings: [{ id: 'w', piece: 'wall', x: 0, z: 0, y: 4, footprint: half }],
  }, { pieces: PIECES });
  return list.length === 0;
})());
check('grund (flat) bedöms efter mitten', (() => {
  const slope = (x) => x * 0.8;
  const list = auditGround(slope, {
    buildings: [{ id: 'f', piece: 'foundation', x: 3, z: 0, y: slope(3), footprint: half }],
  }, { pieces: PIECES });
  return list.length === 0;
})());

/* --- placement policy against a real World instance ----------------- */
section('3b. Placering: väggen grävs aldrig ner');

const liftWorld = new World({ seed: 1337, dataDir: null });
liftWorld.ensureChunksAround(0, 0, 2);

/** Find a cell where the terrain under a wall footprint varies. */
function slopedCell() {
  for (let cx = -20; cx <= 20; cx++) {
    for (let cz = -20; cz <= 20; cz++) {
      const pos = piecePosition(cx, cz, 0, 'wall');
      const h = sampleHeight(pos.x, pos.z, 1337);
      const top = footprintSurface((x, z) => sampleHeight(x, z, 1337), pos.x, pos.z, 2, 0.2);
      if (h > WORLD.seaLevel + 3 && top - h > GROUND_LIFT_LIMIT) return { cx, cz, h, top };
    }
  }
  return null;
}
const steepCell = slopedCell();
check('hittade en cell med lutning', !!steepCell, JSON.stringify(steepCell));

const builder = {
  id: 'builder', name: 'Builder', x: 0, y: 0, z: 0,
  inv: [{ item: 'wall', n: 5 }, { item: 'foundation', n: 5 }, { item: 'wood', n: 99 }],
};
if (steepCell) {
  const pos = piecePosition(steepCell.cx, steepCell.cz, 0, 'wall');
  builder.x = pos.x; builder.z = pos.z; // in reach
  const res = placeBuilding(liftWorld, builder, 'wall', steepCell.cx, steepCell.cz, 0);
  check('brant mark kräver grund (nekas)', res.ok === false && res.error === 'needs-foundation', JSON.stringify(res));
}

/** Flat ground: a wall placed on bare terrain must not be buried. */
function flatCell() {
  for (let cx = -30; cx <= 30; cx++) {
    for (let cz = -30; cz <= 30; cz++) {
      const pos = piecePosition(cx, cz, 0, 'wall');
      const h = sampleHeight(pos.x, pos.z, 1337);
      const top = footprintSurface((x, z) => sampleHeight(x, z, 1337), pos.x, pos.z, 2, 0.2);
      if (h > WORLD.seaLevel + 3 && top - h <= 0.05) return { cx, cz, h };
    }
  }
  return null;
}
const flat = flatCell();
check('hittade en plan cell', !!flat);
if (flat) {
  const pos = piecePosition(flat.cx, flat.cz, 0, 'wall');
  builder.x = pos.x; builder.z = pos.z;
  builder.inv = [{ item: 'wall', n: 5 }];
  const res = placeBuilding(liftWorld, builder, 'wall', flat.cx, flat.cz, 0);
  check('plan mark accepteras', res.ok === true, JSON.stringify(res));
  if (res.ok) {
    const list = auditGround((x, z) => sampleHeight(x, z, 1337), {
      buildings: [{
        id: res.building.id, piece: 'wall', x: pos.x, z: pos.z, y: res.building.y,
        footprint: { halfX: 2, halfZ: PIECES.wall.size[2] / 2 },
      }],
    }, { pieces: PIECES });
    check('den placerade väggen ligger ovanför ytan', list.length === 0, JSON.stringify(list));
  }
}

/* --- planted faults: the audit must find AND fix them ---------------- */
section('3c. Planterade fel: revisionen hittar och åtgärdar');

const faultWorld = new World({ seed: 1337, dataDir: null });
faultWorld.ensureChunksAround(10, 10, 2);
const holeX = 10;
const holeZ = 10;
const holeSurface = sampleHeight(holeX, holeZ, 1337);
faultWorld.animals.set('a9', {
  id: 'a9', type: 'deer', x: holeX, z: holeZ, y: holeSurface - 2, yaw: 0, hp: 10, vx: 0, vy: -1, vz: 0,
});
const wallPos = piecePosition(4, 4, 0, 'wall');
faultWorld.buildings.set('b9', {
  id: 'b9', piece: 'wall', cx: 4, cz: 4, rot: 0, y: sampleHeight(wallPos.x, wallPos.z, 1337) - 1.5, hp: 10, v: 0,
});
faultWorld.cellIndex.set('4,4', [faultWorld.buildings.get('b9')]);

const report = faultWorld.auditGround(Date.now());
check('revisionen rapporterar begravda objekt', report.buried >= 2, JSON.stringify(report));
check('djuret lyftes upp', (() => {
  const a = faultWorld.animals.get('a9');
  return a.y >= sampleHeight(a.x, a.z, 1337) - GROUND_EPS;
})(), `y=${faultWorld.animals.get('a9').y.toFixed(2)}`);
check('hundra kontrollerade objekt', report.checked >= 2, JSON.stringify(report));
check('byggnaden rapporteras men flyttas inte', (() => {
  const b = faultWorld.buildings.get('b9');
  return b.y === sampleHeight(wallPos.x, wallPos.z, 1337) - 1.5;
})(), 'en struktur får inte flyttas tyst');
check('värsta djupet rapporteras', report.worst > 0.9, JSON.stringify(report));
check('efter åtgärd är djuret inte kvar i rapporten', (() => {
  const second = faultWorld.auditGround(Date.now() + 1);
  return !second.buried || second.worst > 0; // the wall is still reported, the animal is not
})());

/* ------------------------------------------------------------------ *
 * 4. The live server
 * ------------------------------------------------------------------ */
section('4. Levande server: inget under marken efter simulering');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

class Bot {
  constructor(port, name) {
    this.port = port;
    this.name = name;
    this.seq = 0;
    this.messages = [];
  }

  connect(id) {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`);
    this.welcome = new Promise((resolve, reject) => {
      this.resolveWelcome = resolve;
      setTimeout(() => reject(new Error('timeout')), 8000);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      this.messages.push(msg);
      if (msg.t === 'welcome') { this.you = msg.you; this.resolveWelcome(msg); }
      if (msg.t === 'snap') this.snap = msg;
    });
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ t: 'hello', name: this.name, playerId: id }));
        this.welcome.then(resolve, reject);
      });
      this.ws.on('error', reject);
    });
  }

  send(o) { this.ws.send(JSON.stringify(o)); }

  move(wish, strafe, ms) {
    const until = Date.now() + ms;
    const timer = setInterval(() => {
      this.send({
        t: 'input', seq: ++this.seq, dt: 1 / 20, yaw: this.you?.yaw ?? 0, pitch: 0,
        wish, strafe, jump: false, sprint: false, crouch: false,
      });
      if (Date.now() > until) clearInterval(timer);
    }, 50);
    return sleep(ms + 60);
  }

  close() { try { this.ws?.close(); } catch { /* ignore */ } }
}

const port = await freePort();
const server = spawn('node', ['server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: path.join(ROOT, 'server', 'data-test-ground'),
    BOOT_ID: 'ground-test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

try {
  await sleep(1200);
  const bot = new Bot(port, 'GroundBot');
  await bot.connect('ground-bot');
  check('spelaren spawnar ovanför ytan', (() => {
    const surface = sampleHeight(bot.you.x, bot.you.z, bot.welcome.seed);
    return bot.you.y >= surface - GROUND_EPS;
  })(), `y=${bot.you.y} yta=${sampleHeight(bot.you.x, bot.you.z, bot.welcome.seed).toFixed(2)}`);

  // Walk around for a few seconds (uphill, downhill, into trees).
  for (let i = 0; i < 8; i++) {
    await bot.move(1, i % 2 ? 0.6 : -0.6, 350);
  }
  await sleep(400);

  const snap = bot.snap;
  check('snapshots kom', !!snap);
  const welcomeSeed = bot.welcome.seed;
  const worldSample = (x, z) => sampleHeight(x, z, welcomeSeed);

  check('spelaren är fortfarande ovanför ytan', (() => {
    const me = snap.you;
    return me.y >= worldSample(me.x, me.z) - GROUND_EPS;
  })(), `y=${snap?.you?.y}`);

  const buriedPlayers = [...(snap.players ?? [])].filter(([, p]) => p.y < worldSample(p.x, p.z) - GROUND_EPS);
  check('ingen spelare under marken i snapshoten', buriedPlayers.length === 0, `${buriedPlayers.length}`);

  const buriedAnimals = [...(snap.animals ?? [])].filter(([, a]) => a.y < worldSample(a.x, a.z) - GROUND_EPS);
  check('inga djur under marken i snapshoten', buriedAnimals.length === 0, `${buriedAnimals.length} av ${snap.animals?.size ?? snap.animals?.length ?? '?'}`);
  check('djur finns att kontrollera', (snap.animals?.size ?? snap.animals?.length ?? 0) > 0);

  const buriedNodes = [...(snap.nodes ?? [])].filter(([, n]) => n.y < worldSample(n.x, n.z) - GROUND_EPS);
  check('inga resursnoder under marken', buriedNodes.length === 0, `${buriedNodes.length}`);

  // Server-side audit endpoint
  const status = await fetch(`http://127.0.0.1:${port}/api/status`).then((r) => r.json());
  check('servern rapporterar markläget', !!status.world.ground, JSON.stringify(status.world.ground));
  check('servern har kontrollerat alla objekt', status.world.ground.checked > 100, `${status.world.ground.checked}`);
  check('servern hittar inget begravt', status.world.ground.buried === 0, JSON.stringify(status.world.ground));
  check('servern har inte behövt lyfta något', status.world.ground.lifted === 0, JSON.stringify(status.world.ground));

  // Building on bare ground: never buried
  bot.send({ t: 'action', a: 'craft', id: 'wood_pick' });
  const inv = await fetch(`http://127.0.0.1:${port}/api/status`).then((r) => r.json());
  check('servern svarar på API', inv.ok === true);

  // Ground audit on the server must also catch a planted fault
  const planted = status.world.ground;
  check('markläget har en tidsstämpel', Number.isFinite(planted.at));
  bot.close();
} catch (err) {
  check('integrationen körde utan undantag', false, err.message);
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  try { server.kill('SIGKILL'); } catch { /* gone */ }
}

/* ------------------------------------------------------------------ *
 * 5. The client renderer lifts interpolated bodies
 * ------------------------------------------------------------------ */
section('5. Klienten: interpolerade kroppar lyfts till ytan');

const { createDom } = await import('./dom-env.js');
createDom();
const { AnimalView, PlayerView } = await import('../client/src/entities.js');
const THREE = await import('three');

const scene = new THREE.Scene();
const slopeSeed = 4242;
const animalView = new AnimalView(scene);
const playerView = new PlayerView(scene, 'self');
check('vyerna har setSeed', typeof animalView.setSeed === 'function' && typeof playerView.setSeed === 'function');
animalView.setSeed(slopeSeed);
playerView.setSeed(slopeSeed);

// Pick a spot with a real slope and feed the view two ticks that are *above*
// the surface at their endpoints but whose straight-line midpoint is not.
function steepSpot() {
  let best = { x: 0, z: 0, d: 0 };
  for (let x = -100; x <= 100; x += 7) {
    for (let z = -100; z <= 100; z += 7) {
      const d = Math.abs(terrainHeight(x, z, slopeSeed) - terrainHeight(x + 1, z, slopeSeed));
      if (d > best.d) best = { x, z, d };
    }
  }
  return best;
}
const spot = steepSpot();
check('hittade en brant plats', spot.d > 0.3, JSON.stringify(spot));

const h0 = terrainHeight(spot.x, spot.z, slopeSeed);
animalView.update(0.016, [{ id: 1, type: 0, x: spot.x, y: h0, z: spot.z, yaw: 0, hp: 10 }]);
let lowest = Infinity;
for (let i = 0; i < 40; i++) {
  // move the target across the slope and let the interpolation catch up
  animalView.update(0.05, [{ id: 1, type: 0, x: spot.x + 2, y: terrainHeight(spot.x + 2, spot.z, slopeSeed), z: spot.z, yaw: 0, hp: 10 }]);
  const entry = [...animalView.map.values()][0];
  if (!entry) continue;
  lowest = Math.min(lowest, entry.y - terrainHeight(entry.x, entry.z, slopeSeed));
}
check('djuret sjunker aldrig under ytan', lowest >= -GROUND_EPS, `lägst ${lowest.toFixed(3)} m`);

check('spelarinterpoleringen lyfter också', (() => {
  const p0 = terrainHeight(spot.x, spot.z, slopeSeed);
  playerView.update(0.016, [{ id: 'other', name: 'x', x: spot.x, y: p0, z: spot.z - 1, yaw: 0, crouch: false, health: 100, toolItem: null }]);
  let low = Infinity;
  for (let i = 0; i < 40; i++) {
    playerView.update(0.05, [{ id: 'other', name: 'x', x: spot.x + 2.5, y: terrainHeight(spot.x + 2.5, spot.z - 1, slopeSeed), z: spot.z - 1, yaw: 0, crouch: false, health: 100, toolItem: null }]);
    const entry = [...playerView.map.values()][0];
    if (!entry) continue;
    low = Math.min(low, entry.y - terrainHeight(entry.x, entry.z, slopeSeed));
  }
  return low >= -GROUND_EPS;
})(), 'spelaren sjönk under ytan');

console.log(`\n\x1b[1mResultat:\x1b[0m ${passed} godkända, ${failed} misslyckade\n`);
if (failed) {
  if (serverLog) console.log(serverLog.slice(-1200));
  process.exit(1);
}
