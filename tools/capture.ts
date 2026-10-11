/**
 * Renders the real scene through the real camera and writes PNGs to
 * `screenshots/`. Used to eyeball the prototype in environments with no GPU,
 * no browser and no WebGL.
 *
 *      npm run screenshots
 */

import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { ThirdPersonCamera } from '../src/camera/ThirdPersonCamera';
import { CharacterManager } from '../src/characters/CharacterManager';
import { ROSTER } from '../src/characters/roster';
import type { CharacterProfile } from '../src/characters/types';
import type { MovementIntent } from '../src/characters/types';
import { createWorld } from '../src/scene/World';
import { loadModelLibrary } from './load-models-node';
import { renderScene } from './softrender';

const WIDTH = 1280;
const HEIGHT = 720;
const OUT_DIR = path.resolve(process.cwd(), 'screenshots');
const DT = 1 / 60;

// Renders the real models, read from public/models/.
const library = await loadModelLibrary();

interface Stage {
  scene: THREE.Scene;
  manager: CharacterManager;
  rig: ThirdPersonCamera;
  intent: MovementIntent;
  run(seconds: number): void;
}

function stage(): Stage {
  const world = createWorld();
  const manager = new CharacterManager(world.scene, ROSTER, new THREE.Vector3(0, 0, 0), library);
  const rig = new ThirdPersonCamera(WIDTH / HEIGHT);

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

  return { scene: world.scene, manager, rig, intent, run };
}

function shoot(name: string, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
  const png = renderScene(scene, camera, { width: WIDTH, height: HEIGHT, samples: 2 });
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`  ${name.padEnd(28)} ${(png.length / 1024).toFixed(0)} KB`);
}

/**
 * Renders a single character alone against a flat background. With no ground
 * plane or landmarks in frame the silhouette is unambiguous, which makes the
 * model's proportions measurable.
 */
function modelSheet(name: string, profile: CharacterProfile, yaw: number): void {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141c26);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.position.set(5, 9, 12);
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0x9fc6ff, 0x2a2118, 1.1));

  const manager = new CharacterManager(scene, ROSTER, new THREE.Vector3(0, 0, 0), library);
  const index = ROSTER.findIndex((entry) => entry.id === profile.id);
  if (index >= 0) manager.switchTo(index);

  const rig = new ThirdPersonCamera(WIDTH / HEIGHT);
  rig.yaw = yaw;
  rig.pitch = 0.02;
  rig.setProfile(
    { distance: 2.75, height: profile.proportions.height * 0.5, shoulder: 0, pitchOffset: 0, fov: 40 },
    true,
  );

  const origin = new THREE.Vector3(0, 0, 0);
  rig.snapTo(origin);
  for (let i = 0; i < 90; i += 1) rig.update(DT, origin);

  shoot(name, scene, rig.camera);
  manager.dispose();
}

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`Writing screenshots to ${OUT_DIR}\n`);

// 1 — Eimi at rest, default framing -----------------------------------------
{
  const s = stage();
  s.run(0.6);
  s.rig.addLook(60, 0);
  s.run(0.4);
  shoot('01-eimi-idle.png', s.scene, s.rig.camera);
}

// 2 — Eimi mid-sprint, camera orbited round to her front --------------------
{
  const s = stage();
  s.intent.moveZ = 1;
  s.intent.sprint = true;
  s.run(1.4);
  s.rig.addLook(-420, -40);
  s.run(0.35);
  shoot('02-eimi-sprint.png', s.scene, s.rig.camera);
}

// 3 — Asch jogging after a Tab switch ---------------------------------------
{
  const s = stage();
  s.intent.moveZ = 1;
  s.intent.sprint = true;
  s.run(1.0);
  s.manager.switchNext();
  s.run(1.6);
  s.rig.addLook(150, -20);
  s.run(0.3);
  shoot('03-asch-jog.png', s.scene, s.rig.camera);
}

// 4 — Eimi airborne ----------------------------------------------------------
{
  const s = stage();
  s.intent.moveZ = 1;
  s.intent.sprint = true;
  s.run(0.8);
  s.intent.jumpPressed = true;
  s.run(DT);
  s.intent.jumpPressed = false;
  s.run(0.3);
  s.rig.addLook(90, 0);
  s.run(0.25);
  shoot('04-eimi-jump.png', s.scene, s.rig.camera);
}

// 5 — Both characters side by side ------------------------------------------
{
  const s = stage();
  const [eimi, asch] = s.manager.characters;

  eimi!.setPosition(-1.05, 0, 0);
  eimi!.setFacing(0.4);
  eimi!.object.visible = true;

  asch!.setPosition(1.05, 0, 0);
  asch!.setFacing(-0.4);
  asch!.object.visible = true;

  s.rig.setProfile(
    { distance: 6.4, height: 1.05, shoulder: 0, pitchOffset: 0.1, fov: 40 },
    true,
  );
  const origin = new THREE.Vector3(0, 0, 0);
  s.rig.snapTo(origin);
  for (let i = 0; i < 120; i += 1) s.rig.update(DT, origin);

  shoot('05-both-characters.png', s.scene, s.rig.camera);
}

// 6 — Close-up on the active rig --------------------------------------------
{
  const s = stage();
  s.run(0.6);
  s.rig.setProfile(
    { distance: 2.6, height: 1.4, shoulder: 0.55, pitchOffset: 0.02, fov: 35 },
    true,
  );
  s.run(0.8);
  shoot('06-eimi-closeup.png', s.scene, s.rig.camera);
}

// 7–10 — Model sheets: each character alone, front and side ------------------
const [eimiProfile, aschProfile] = ROSTER;
console.log('');
modelSheet('07-eimi-front.png', eimiProfile!, 0);
modelSheet('08-eimi-side.png', eimiProfile!, Math.PI / 2);
modelSheet('09-asch-front.png', aschProfile!, 0);
modelSheet('10-asch-side.png', aschProfile!, Math.PI / 2);

console.log('\nDone.');
