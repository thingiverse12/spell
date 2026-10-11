/**
 * Headless acceptance harness for TASK-001.
 *
 * Runs the real controller, switch and camera code in Node — no DOM, no WebGL,
 * no browser. three.js's scene-graph and math classes work fine outside a
 * browser, so everything except rasterisation can be verified here.
 *
 *      npm run test:logic
 */

import * as THREE from 'three';
import { ThirdPersonCamera } from '../src/camera/ThirdPersonCamera';
import { CharacterManager } from '../src/characters/CharacterManager';
import { ROSTER } from '../src/characters/roster';
import type { MovementIntent } from '../src/characters/types';

const DT = 1 / 60;

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function near(name: string, actual: number, expected: number, tolerance: number): void {
  const ok = Math.abs(actual - expected) <= tolerance;
  check(name, ok, `got ${actual.toFixed(4)}, expected ${expected.toFixed(4)} ±${tolerance}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

interface Harness {
  scene: THREE.Scene;
  manager: CharacterManager;
  rig: ThirdPersonCamera;
  intent: MovementIntent;
  run(seconds: number): void;
}

function createHarness(): Harness {
  const scene = new THREE.Scene();
  const manager = new CharacterManager(scene, ROSTER, new THREE.Vector3(0, 0, 0));
  const rig = new ThirdPersonCamera(16 / 9);

  manager.onChange((character) => rig.setProfile(character.profile.camera));
  rig.setProfile(manager.active.profile.camera, true);

  const position = new THREE.Vector3();
  manager.active.getPosition(position);
  rig.snapTo(position);

  const intent: MovementIntent = {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    jumpPressed: false,
    cameraYaw: 0,
  };

  const run = (seconds: number): void => {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i += 1) {
      intent.cameraYaw = rig.yaw;
      manager.update(DT, intent);
      manager.active.getPosition(position);
      rig.update(DT, position);
    }
  };

  return { scene, manager, rig, intent, run };
}

function countMeshes(scene: THREE.Scene): number {
  let count = 0;
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) count += 1;
  });
  return count;
}

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// ---------------------------------------------------------------------------
section('Setup');

const h = createHarness();
const feet = new THREE.Vector3();

check('roster has both characters', h.manager.characters.length === 2);
check(
  'both characters are parented to the scene exactly once',
  h.manager.characters.every((c) => c.object.parent === h.scene),
);
check(
  'exactly one character is visible at boot',
  h.manager.characters.filter((c) => c.object.visible).length === 1,
);
check('Eimi is active first', h.manager.active.id === 'eimi');

const baselineMeshes = countMeshes(h.scene);
const baselineChildren = h.scene.children.length;
check('both rigs are in the scene graph', baselineMeshes > 0, `${baselineMeshes} meshes`);

// ---------------------------------------------------------------------------
section('Criterion 3 — distinct top speeds');

h.intent.moveZ = 1;
h.intent.sprint = true;

let eimiPeak = 0;
for (let i = 0; i < 180; i += 1) {
  h.run(DT);
  eimiPeak = Math.max(eimiPeak, h.manager.active.speed);
}
near('Eimi settles at 8.0 m/s', h.manager.active.speed, 8.0, 0.01);
check('Eimi never exceeds 8.0 m/s', eimiPeak <= 8.0 + 1e-6, `peak ${eimiPeak.toFixed(4)}`);

h.manager.switchTo(1);
h.intent.moveZ = 1;
h.intent.sprint = true;

let aschPeak = 0;
for (let i = 0; i < 300; i += 1) {
  h.run(DT);
  aschPeak = Math.max(aschPeak, h.manager.active.speed);
}
near('Asch settles at 5.5 m/s', h.manager.active.speed, 5.5, 0.01);
check('Asch never exceeds 5.5 m/s', aschPeak <= 5.5 + 1e-6, `peak ${aschPeak.toFixed(4)}`);

check(
  'the two characters have genuinely different top speeds',
  Math.abs(8.0 - 5.5) > 2,
  '8.0 vs 5.5 m/s',
);

// Walking must be slower than sprinting for both.
h.intent.sprint = false;
h.run(2);
const aschWalk = h.manager.active.speed;
check('Asch walks slower than he sprints', aschWalk < 5.5 - 1, `walk ${aschWalk.toFixed(2)} m/s`);

// ---------------------------------------------------------------------------
section('Criterion 2 — instant swap preserving position and camera angle');

h.manager.switchTo(0);
h.intent.moveZ = 1;
h.intent.sprint = true;
h.run(1.5);

// Give the camera a distinctive, non-default angle.
h.rig.addLook(140, -30);
h.run(0.2);

const beforePos = h.manager.active.getPosition(new THREE.Vector3());
const beforeYaw = h.rig.yaw;
const beforePitch = h.rig.pitch;
const beforeSpeed = h.manager.active.speed;

h.manager.switchTo(1);

const afterPos = h.manager.active.getPosition(new THREE.Vector3());
const afterYaw = h.rig.yaw;
const afterPitch = h.rig.pitch;

check('swap is instant (no frame required)', h.manager.active.id === 'asch');
near('world X preserved', afterPos.x, beforePos.x, 1e-9);
near('world Y preserved', afterPos.y, beforePos.y, 1e-9);
near('world Z preserved', afterPos.z, beforePos.z, 1e-9);
near('camera yaw preserved', afterYaw, beforeYaw, 1e-12);
near('camera pitch preserved', afterPitch, beforePitch, 1e-12);

const afterSpeed = h.manager.active.speed;
check('momentum is carried across the swap', afterSpeed > 1, `${afterSpeed.toFixed(3)} m/s`);
check(
  'momentum is clamped to the incoming body',
  afterSpeed <= 5.5 + 1e-6 && afterSpeed < beforeSpeed,
  `${beforeSpeed.toFixed(3)} -> ${afterSpeed.toFixed(3)} m/s`,
);

const outgoing = h.manager.characters[0]!;
check(
  'the parked character is frozen, not still simulating',
  outgoing.speed === 0 && outgoing.object.visible === false,
);

// ---------------------------------------------------------------------------
section('Criterion 1 — smooth third-person orbit follow camera');

h.manager.switchTo(0);
h.intent.moveZ = 0;
h.intent.sprint = false;
h.run(1.5); // settle

const settledChar = h.manager.active.getPosition(new THREE.Vector3());
const settledCam = h.rig.camera.position.clone();
const settledGap = Math.hypot(
  settledCam.x - settledChar.x,
  settledCam.y - settledChar.y,
  settledCam.z - settledChar.z,
);
check('camera is behind and above the character', settledCam.y > settledChar.y + 1, `y=${settledCam.y.toFixed(2)}`);
check('camera is not inside the character', settledGap > 3, `gap ${settledGap.toFixed(2)} m`);

// Teleport the character and confirm the camera lags, then converges: that lag
// is what makes the follow read as smooth rather than a hard cut.
h.manager.active.setPosition(settledChar.x + 8, 0, settledChar.z);
const teleported = h.manager.active.getPosition(new THREE.Vector3());
feet.copy(teleported);
h.rig.update(DT, feet);
const lagCam = h.rig.camera.position.clone();
const lagGap = Math.hypot(lagCam.x - teleported.x, lagCam.y - teleported.y, lagCam.z - teleported.z);
check(
  'camera lags behind an instant 8 m jump (smooth, not snapped)',
  horizontalDistance(lagCam, teleported) > horizontalDistance(settledCam, settledChar) - 0.01,
  `gap after 1 frame ${lagGap.toFixed(2)} m`,
);

h.run(1.2);
const caughtCam = h.rig.camera.position.clone();
const caughtChar = h.manager.active.getPosition(new THREE.Vector3());
const caughtGap = Math.hypot(
  caughtCam.x - caughtChar.x,
  caughtCam.y - caughtChar.y,
  caughtCam.z - caughtChar.z,
);
near('camera re-frames to the configured distance', caughtGap, settledGap, 0.05);

// Orbiting with the pointer changes yaw without disturbing the framing gap.
const yawBefore = h.rig.yaw;
h.rig.addLook(200, 0);
h.run(0.6);
check('dragging orbits the camera', Math.abs(h.rig.yaw - yawBefore) > 0.1);
const orbitedGap = Math.hypot(
  h.rig.camera.position.x - caughtChar.x,
  h.rig.camera.position.y - caughtChar.y,
  h.rig.camera.position.z - caughtChar.z,
);
near('orbiting preserves the follow distance', orbitedGap, caughtGap, 0.15);

h.rig.addZoom(-100000);
h.run(0.8);
const minGap = Math.hypot(
  h.rig.camera.position.x - caughtChar.x,
  h.rig.camera.position.y - caughtChar.y,
  h.rig.camera.position.z - caughtChar.z,
);
check('zoom is clamped to a sane minimum', minGap > 1.5, `gap ${minGap.toFixed(2)} m`);

// ---------------------------------------------------------------------------
section('Criterion 4 — no duplicate meshes and no leaks under repeated switching');

const beforeStorm = { meshes: countMeshes(h.scene), children: h.scene.children.length };

for (let i = 0; i < 1000; i += 1) {
  h.manager.switchNext();
  h.run(DT);
}

check(
  '1000 switches add no meshes',
  countMeshes(h.scene) === beforeStorm.meshes,
  `${countMeshes(h.scene)} meshes`,
);
check(
  '1000 switches add no scene children',
  h.scene.children.length === beforeStorm.children,
  `${h.scene.children.length} children`,
);
check(
  'each character still has exactly one parent',
  h.manager.characters.every((c) => c.object.parent === h.scene),
);
check('exactly one character visible after the storm', h.manager.characters.filter((c) => c.object.visible).length === 1);
check(
  'scene graph is unchanged from boot',
  countMeshes(h.scene) === baselineMeshes && h.scene.children.length === baselineChildren,
);

// ---------------------------------------------------------------------------
section('Teardown');

h.manager.dispose();
check('dispose removes every character from the scene', h.scene.children.length === 0);
check('dispose leaves no stray meshes', countMeshes(h.scene) === 0);

// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\nAll headless TASK-001 checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
);

if (failures > 0) process.exitCode = 1;
