/**
 * Spell - error hunt for the player character and the authoritative server.
 *
 * 1. Protocol fuzz: malformed JSON, malformed hello/names, malformed input,
 *    every action with hostile values, and chat/ping. The server must stay up.
 * 2. Movement sanitization: Infinity/NaN/absurd input must never poison state.
 * 3. Character audit: check real snapshot state, find planted faults, repair
 *    broken local state, and verify that the live audit runs after ground.
 *
 * The regular multiplayer harness separately exercises the full gather/craft/
 * build/survive loop against the same server code.
 *
 * Usage: npm run test:errors
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import * as THREE from 'three';
import { checkCharacter, repairCharacter, describeCharacter, MAX_SPEED, INV_SIZE } from '../client/src/character.js';
import { sampleHeight } from '../shared/noise.js';
import { ITEMS, WORLD, PHYS, SURVIVAL, playerColor } from '../shared/config.js';
import { sanitizePlayer } from '../server/world.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'data-testerrors');
const SEED = 77;

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
  if (condition) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
};
const section = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve) => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1', () => {
    const { port } = socket.address();
    socket.close(() => resolve(port));
  });
});

class Probe {
  constructor(port, id) {
    this.port = port;
    this.id = id;
    this.messages = [];
    this.seq = 0;
    this.rid = 1;
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      try { this.messages.push(JSON.parse(raw.toString())); } catch { this.messages.push({ t: 'invalid-json' }); }
    });
  }

  async open() { await this.opened; return this; }
  send(msg) { this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }

  async waitFor(predicate, timeoutMs = 2500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = this.messages.find(predicate);
      if (match) return match;
      await sleep(10);
    }
    return null;
  }

  async hello(name = 'Testare') {
    this.send({ t: 'hello', playerId: this.id, name });
    return this.waitFor((m) => m.t === 'welcome');
  }

  async nextSnapshot() {
    const previousTick = this.messages.filter((m) => m.t === 'snap').at(-1)?.tick ?? -1;
    return this.waitFor((m) => m.t === 'snap' && m.tick > previousTick, 2500);
  }

  async action(a, payload = {}) {
    const rid = this.rid++;
    this.send({ t: 'action', a, rid, ...payload });
    return this.waitFor((m) => m.t === 'res' && m.r === rid, 2000);
  }

  input(payload = {}) {
    this.send({ t: 'input', seq: ++this.seq, dt: 1 / 30, yaw: 0, pitch: 0, wish: 0, strafe: 0, ...payload });
  }

  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 250);
      this.ws.once('close', () => { clearTimeout(timer); resolve(); });
      try { this.ws.close(); } catch { clearTimeout(timer); resolve(); }
    });
  }
}

// Only actual application failures count here. A deliberate >8 KB WebSocket
// payload is rejected by ws itself and logged as "Max payload size exceeded".
const applicationErrors = (text) => text.split('\n').filter((line) =>
  /\b(?:UNCAUGHT EXCEPTION|UNHANDLED REJECTION|message error|message handler error)\b/i.test(line));

console.log('\n\x1b[1mFeljakt: karaktär + server\x1b[0m');
fs.rmSync(DATA_DIR, { recursive: true, force: true });
const PORT = await freePort();
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), SEED: String(SEED), DATA_DIR, BOOT_ID: 'error-hunt' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
const status = async () => fetch(`http://127.0.0.1:${PORT}/api/status`).then((r) => r.json());

let live = true;
try {
  let listening = false;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/status`);
      if (res.ok) { listening = true; break; }
    } catch { /* wait for boot */ }
    await sleep(100);
  }
  check('servertest-instansen startar', listening, serverLog.slice(-400));
  if (!listening) throw new Error('test server failed to start');

  /* ---------------------------------------------------------------- *
   * 1. Protocol error hunt
   * ---------------------------------------------------------------- */
  section('1. Skräp i varje protokollväg');

  // HTTP route errors are client errors, never uncaught exceptions. `%` made
  // decodeURIComponent throw in the old request callback.
  {
    const mark = serverLog.length;
    const malformed = await fetch(`http://127.0.0.1:${PORT}/%`, { signal: AbortSignal.timeout(700) })
      .then((r) => r.status).catch(() => 0);
    check('trasig URL escape får 400 i stället för att krascha', malformed === 400, `status ${malformed}`);
    const traversal = await fetch(`http://127.0.0.1:${PORT}/shared/%2e%2e%2fserver/index.js`)
      .then(async (r) => ({ status: r.status, text: await r.text() }))
      .catch((e) => ({ status: 0, text: e.message }));
    check('delad /shared-katalog kan inte läsa serverkod', traversal.status !== 200
      || !traversal.text.includes('authoritative game server'), `status ${traversal.status}`);
    check('HTTP-skräp ger inga ohanterade serverfel', applicationErrors(serverLog.slice(mark)).length === 0,
      applicationErrors(serverLog.slice(mark)).join(' | '));
  }

  // Invalid JSON / valid JSON with the wrong shape are ignored, not exceptions.
  {
    const mark = serverLog.length;
    const probe = await new Probe(PORT, 'fuzz-json').open();
    for (const junk of ['', 'not json', '{', '[1,2,3', 'undefined', 'null', '{"t":', JSON.stringify('text'), 'x'.repeat(5000)]) probe.send(junk);
    for (const shape of [null, 1, 'text', [], {}, true, { t: null }, { t: 42 }, { t: {} }, { t: 'unknown' }]) probe.send(shape);
    await sleep(180);
    await probe.close();
    check('trasig JSON och fel formade meddelanden ignoreras', applicationErrors(serverLog.slice(mark)).length === 0,
      applicationErrors(serverLog.slice(mark)).join(' | '));
  }

  // This reproduces the bug found in the real server: non-string name -> .slice crash.
  const names = [
    ['text', 'Anna', 'Anna'],
    ['tal', 99, '99'],
    ['objekt', {}, 'Överlevare'],
    ['lista', [], 'Överlevare'],
    ['boolean', true, 'true'],
    ['tomt', '', 'Överlevare'],
    ['kontrolltecken', 'B\nO\u0000B', 'B O B'],
    ['för långt', 'L'.repeat(80), 'L'.repeat(18)],
  ];
  for (let i = 0; i < names.length; i++) {
    const [label, inputName, expectedName] = names[i];
    const mark = serverLog.length;
    const id = `name-${i}`;
    const probe = await new Probe(PORT, id).open();
    const welcome = await probe.hello(inputName);
    const joined = (await status()).players.find((p) => p.id === id);
    check(`hello med namn som ${label} får welcome`, !!welcome, 'timeout');
    check(`namnet som ${label} städas till en sträng`, joined?.name === expectedName, JSON.stringify(joined?.name));
    await probe.close();
    await sleep(30);
    check(`namnet som ${label} ger inga undantag`, applicationErrors(serverLog.slice(mark)).length === 0,
      applicationErrors(serverLog.slice(mark)).join(' | '));
  }

  // Fuzz messages in the actual authoritative server. Inputs remain a separate
  // section because Infinity used to poison the position without throwing.
  {
    const mark = serverLog.length;
    const probe = await new Probe(PORT, 'action-fuzz').open();
    check('fuzz-klienten får welcome', !!(await probe.hello('Fuzz')));
    const malformedActions = [
      ['harvest', { id: null }], ['harvest', { id: {} }], ['melee', {}],
      ['craft', { id: null }], ['craft', { id: 'unknown' }],
      ['place', { piece: null, cx: 0, cz: 0, rot: 0 }],
      ['place', { piece: {}, cx: 'x', cz: [], rot: 'x' }],
      ['door', { id: {} }], ['demolish', { id: null }],
      ['use', { slot: 999 }], ['use', { slot: -5 }], ['use', { slot: {} }],
      ['equip', { slot: 999 }], ['equip', { slot: -3 }], ['equip', { slot: 'x' }],
      ['moveitem', { from: -1, to: 99 }], ['moveitem', { from: {}, to: [] }],
      ['repair', { slot: 999 }], ['unstick', {}], ['respawn', {}], ['unknown-action', {}],
    ];
    const actionResults = [];
    for (const [a, args] of malformedActions) actionResults.push(await probe.action(a, args));
    check('alla 21 handlingar får ett svar', actionResults.every(Boolean), `${actionResults.filter(Boolean).length}/21`);
    check('alla svar har ett booleskt ok-fält', actionResults.every((r) => typeof r.ok === 'boolean'));

    probe.send({ t: 'chat', text: null });
    probe.send({ t: 'chat', text: {} });
    probe.send({ t: 'chat', text: 'hej'.repeat(1000) }); // clipped to 200 chars
    probe.send({ t: 'ping', id: {}, at: 'x' });
    probe.send({ t: 'ping' });
    await sleep(200);
    const beforeLarge = serverLog.length;
    probe.send({ t: 'chat', text: 'A'.repeat(1024 * 1024) }); // rejected by WebSocket maxPayload
    await sleep(250);
    const oversizeLog = serverLog.slice(beforeLarge);
    check('chat/ping och ett för stort paket stänger bara anslutningen',
      /Max payload size exceeded/.test(oversizeLog) || probe.ws.readyState !== WebSocket.CLOSED);
    await probe.close();
    check('action/chat/ping-skräp ger inga applikationsundantag', applicationErrors(serverLog.slice(mark)).length === 0,
      applicationErrors(serverLog.slice(mark)).join(' | '));
  }

  /* ---------------------------------------------------------------- *
   * 2. Numeric input cannot poison the authoritative character
   * ---------------------------------------------------------------- */
  section('2. NaN, Infinity och orimlig rörelse');
  const movementProbe = await new Probe(PORT, 'movement-fuzz').open();
  const moveWelcome = await movementProbe.hello('Rörelseprov');
  check('rörelseprovet fick welcome', !!moveWelcome);
  await movementProbe.nextSnapshot();

  const hostileInputs = [
    { yaw: 'Infinity', pitch: '-Infinity', wish: 'Infinity', strafe: '-Infinity', dt: 'Infinity' },
    { yaw: 1e300, pitch: 1e300, wish: 1e6, strafe: -1e6, dt: 1e6 },
    { yaw: 'NaN', pitch: 'garbage', wish: 'no', strafe: {}, dt: null },
    { yaw: -1e300, pitch: -1e300, wish: -99, strafe: 99, dt: -1e5 },
    { yaw: 12.4, pitch: 0.1, wish: 1, strafe: 0.4, dt: 0.05, jump: 'yes', sprint: 1, crouch: 'false' },
  ];
  for (const input of hostileInputs) {
    movementProbe.input(input);
    await sleep(120);
  }
  await sleep(250);
  const moveSnap = movementProbe.messages.filter((m) => m.t === 'snap').at(-1);
  const self = moveSnap?.players?.find((p) => p[0] === 'movement-fuzz');
  const moverStatus = await status();
  const statusPlayer = moverStatus.players.find((p) => p.id === 'movement-fuzz');
  check('auktoritativ position är ändlig efter fientliga inputs', !!statusPlayer && [statusPlayer.x, statusPlayer.y, statusPlayer.z].every(Number.isFinite), JSON.stringify(statusPlayer));
  check('snapshot-koordinater är giltiga tal', !!moveSnap?.you && [moveSnap.you.x, moveSnap.you.y, moveSnap.you.z].every(Number.isFinite), JSON.stringify(moveSnap?.you));
  check('yaw/pitch är ändliga och begränsade', !!self && Number.isFinite(self[5]) && Number.isFinite(self[6])
    && Math.abs(self[5]) <= Math.PI + 0.001 && Math.abs(self[6]) <= 1.5533 + 0.001, JSON.stringify(self?.slice(5, 7)));
  check('servern håller hastighetsvektorn ändlig', !!moveSnap?.you && [moveSnap.you.vx, moveSnap.you.vy, moveSnap.you.vz].every(Number.isFinite));
  check('servern rapporterar inga protokollfel', moverStatus.errors.count === 0, JSON.stringify(moverStatus.errors));

  /* ---------------------------------------------------------------- *
   * 3. Character model/state checks
   * ---------------------------------------------------------------- */
  section('3. Karaktärsmodell och speltillstånd');
  const serverCharacter = {
    ...moveSnap.you,
    id: 'movement-fuzz',
    yaw: Number.isFinite(self?.[5]) ? self[5] : 0,
    pitch: Number.isFinite(self?.[6]) ? self[6] : 0,
    dead: !!moveSnap.you.dead,
  };
  const serverCharacterProblems = checkCharacter(serverCharacter, { seed: SEED });
  check('riktiga server-snapshotten är en frisk karaktär', serverCharacterProblems.length === 0, describeCharacter(serverCharacterProblems));

  const oldSavedColor = sanitizePlayer({ id: 'saved-old-color', color: 'hsl(305 62% 55%)' }).color;
  const migratedNaNColor = sanitizePlayer({ id: 'saved-nan-color', color: 'hsl(NaN 62% 55%)' }).color;
  const oldHashColor = sanitizePlayer({ id: 'preview-anna', color: 'hsl(29, 62%, 55%)' }).color;
  const expectedColor = playerColor('saved-old-color');
  check('sparade gamla, NaN- och gamla hash-färger migreras till Three.js-färg',
    oldSavedColor === expectedColor && new THREE.Color(oldSavedColor).getHex() !== 0xffffff
      && /^hsl\(\d+, 62%, 55%\)$/.test(migratedNaNColor)
      && oldHashColor === playerColor('preview-anna'),
    `${oldSavedColor} / ${migratedNaNColor} / ${oldHashColor}`);

  const surface = sampleHeight(0, 0, SEED);
  const healthy = {
    x: 0, y: surface, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    health: SURVIVAL.maxHealth, hunger: 90, thirst: 90, stamina: SURVIVAL.maxStamina, breath: SURVIVAL.maxBreath,
    dead: false, toolSlot: 0, inv: new Array(INV_SIZE).fill(null),
  };
  healthy.inv[0] = { item: 'wood', n: 3 };
  check('en frisk karaktär ger inga fel', checkCharacter(healthy, { seed: SEED }).length === 0,
    describeCharacter(checkCharacter(healthy, { seed: SEED })));
  check('tom vald plats är giltigt läge för bara händer', checkCharacter({ ...healthy, toolSlot: 0, inv: new Array(INV_SIZE).fill(null) }, { seed: SEED }).length === 0);

  const plantedFaults = [
    ['NaN-position', { ...healthy, x: NaN }, /position\.x/],
    ['under markytan', { ...healthy, y: surface - 3 }, /under markytan/],
    ['orimlig hastighet', { ...healthy, vx: MAX_SPEED * 4 }, /hastighet/],
    ['pitch utanför kameragränsen', { ...healthy, pitch: 3 }, /pitch/],
    ['hälsa över max', { ...healthy, health: 400 }, /health/],
    ['död-flagga stämmer inte', { ...healthy, health: 0, dead: false }, /död-flaggan/],
    ['trasig ryggsäck', { ...healthy, inv: 'inte en lista' }, /ryggsäcken är inte en lista/],
    ['okänd resurs i ryggsäcken', { ...healthy, inv: [{ item: 'guld', n: 1 }, ...healthy.inv.slice(1)] }, /okänd resurs/],
    ['delat antal resurser', { ...healthy, inv: [{ item: 'wood', n: 1.5 }, ...healthy.inv.slice(1)] }, /delat antal/],
    ['stack över maxgränsen', { ...healthy, inv: [{ item: 'wood', n: 1e6 }, ...healthy.inv.slice(1)] }, /max/],
    ['verktygsplats utanför ryggsäcken', { ...healthy, toolSlot: 99 }, /finns inte/],
    ['utanför världen', { ...healthy, x: WORLD.half * 2 }, /utanför världen/],
    ['thirst NaN', { ...healthy, thirst: NaN }, /thirst/],
  ];
  for (const [label, broken, pattern] of plantedFaults) {
    const problems = checkCharacter(broken, { seed: SEED });
    check(`karaktärskollen hittar ${label}`, problems.some((message) => pattern.test(message)), problems.join('; ') || '(inget)');
  }

  const broken = {
    ...healthy, x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN,
    vx: Infinity, vy: NaN, vz: 0, inv: null, toolSlot: 99,
  };
  const repairs = repairCharacter(broken, { x: 5, y: surface, z: -5 }, { seed: SEED });
  check('reparationen räddar NaN-position till senast giltigt läge', broken.x === 5 && broken.z === -5 && Number.isFinite(broken.y));
  check('reparationen flyttar upp karaktären till marken', broken.y >= sampleHeight(5, -5, SEED) - 0.05, String(broken.y));
  check('reparationen återställer vinklar och fart', Number.isFinite(broken.yaw) && Number.isFinite(broken.pitch)
    && [broken.vx, broken.vy, broken.vz].every(Number.isFinite));
  check('reparationen ger en hel ryggsäck och verktygsplats', broken.inv.length === INV_SIZE && broken.toolSlot === -1);
  check('reparationen räknar varje åtgärd', repairs >= 7, String(repairs));
  check('karaktären är frisk efter reparation', checkCharacter(broken, { seed: SEED }).length === 0,
    describeCharacter(checkCharacter(broken, { seed: SEED })));
  check('maxhastigheten är rimlig', MAX_SPEED > PHYS.sprintSpeed && MAX_SPEED < 40, String(MAX_SPEED));

  // Guard the live call order: in the first draft `ground` was passed before its
  // const declaration, which would throw every time the audit ran.
  const mainSource = fs.readFileSync(path.join(ROOT, 'client/src/main.js'), 'utf8');
  const groundIndex = mainSource.indexOf('const ground = sampleHeight(you.x, you.z');
  const auditIndex = mainSource.indexOf('  auditCharacter(now, you, ground);');
  check('live character audit runs only after the ground height is known', groundIndex >= 0 && auditIndex > groundIndex,
    `ground=${groundIndex}, audit=${auditIndex}`);
  check('spelet hämtar serverns status med en relativ URL', mainSource.includes("fetch('/api/status'"));
  check('serverns felräknare visas i F3', mainSource.includes('serverfel: ${state.serverAudit.errors}'));

  /* ---------------------------------------------------------------- *
   * 4. Server stayed clean
   * ---------------------------------------------------------------- */
  section('4. Servern och snapshotten efter feljakten');
  const logsBeforeClose = serverLog;
  const final = await status();
  check('servern lever fortfarande', final.ok === true);
  check('serverns undantagsräknare är noll', final.errors.count === 0, JSON.stringify(final.errors));
  check('serverns error API har count/last/at', Number.isInteger(final.errors.count)
    && 'last' in final.errors && Number.isFinite(final.errors.at));
  check('alla aktiva spelare har ändliga koordinater', final.players.every((p) => [p.x, p.y, p.z, p.health].every(Number.isFinite)));
  check('inga ohanterade eller meddelande-undantag i serverloggen', applicationErrors(logsBeforeClose).length === 0,
    applicationErrors(logsBeforeClose).slice(0, 4).join(' | '));

  await movementProbe.close();
} finally {
  if (live) {
    server.kill('SIGTERM');
    await sleep(250);
    try { server.kill('SIGKILL'); } catch { /* already exited */ }
    live = false;
  }
}

fs.rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`\n\x1b[1mResultat:\x1b[0m ${passed} godkända, ${failed} misslyckade\n`);
if (failed) process.exit(1);
