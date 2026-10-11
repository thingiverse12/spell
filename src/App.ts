import * as THREE from 'three';
import { ThirdPersonCamera } from './camera/ThirdPersonCamera';
import { CharacterManager } from './characters/CharacterManager';
import { ROSTER } from './characters/roster';
import type { MovementIntent } from './characters/types';
import { InputManager } from './input/InputManager';
import { createWorld, type World } from './scene/World';
import { Hud } from './ui/Hud';

const SPAWN = new THREE.Vector3(0, 0, 0);
/** Longest simulation step we will integrate; guards against tab-switch spikes. */
const MAX_DELTA = 1 / 20;

export class App {
  readonly world: World;
  readonly renderer: THREE.WebGLRenderer;
  readonly cameraRig: ThirdPersonCamera;
  readonly characters: CharacterManager;

  private readonly input: InputManager;
  private readonly hud: Hud;
  private readonly clock = new THREE.Clock();

  private readonly intent: MovementIntent = {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    jumpPressed: false,
    cameraYaw: 0,
  };
  private readonly focusTarget = new THREE.Vector3();

  private frame = 0;
  private disposed = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.world = createWorld();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.append(this.renderer.domElement);

    this.cameraRig = new ThirdPersonCamera(this.aspect);

    this.characters = new CharacterManager(this.world.scene, ROSTER, SPAWN);
    this.characters.onChange((character) => {
      // Yaw/pitch are owned by the rig and are deliberately left untouched, so
      // the player's camera angle survives the swap.
      this.cameraRig.setProfile(character.profile.camera);
    });
    this.cameraRig.setProfile(this.characters.active.profile.camera, true);
    this.characters.active.getPosition(this.focusTarget);
    this.cameraRig.snapTo(this.focusTarget);

    this.input = new InputManager(this.renderer.domElement);
    this.input.attach();

    this.hud = new Hud(ROSTER, (index) => this.input.requestSelect(index));
    this.hud.update(this.characters.active, this.characters.activeIndex);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  private get aspect(): number {
    return this.container.clientWidth / Math.max(this.container.clientHeight, 1);
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.cameraRig.resize(width, height);
  }

  start(): void {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private tick(): void {
    if (this.disposed) return;

    const dt = Math.min(this.clock.getDelta(), MAX_DELTA);
    const input = this.input.sample(dt);

    if (input.lookX !== 0 || input.lookY !== 0) this.cameraRig.addLook(input.lookX, input.lookY);
    if (input.zoom !== 0) this.cameraRig.addZoom(input.zoom);

    if (input.switchPressed) this.characters.switchNext();
    else if (input.selectIndex >= 0) this.characters.switchTo(input.selectIndex);

    this.intent.moveX = input.moveX;
    this.intent.moveZ = input.moveZ;
    this.intent.sprint = input.sprint;
    this.intent.jumpPressed = input.jumpPressed;
    this.intent.cameraYaw = this.cameraRig.yaw;

    this.characters.update(dt, this.intent);
    this.characters.active.getPosition(this.focusTarget);
    this.cameraRig.update(dt, this.focusTarget);

    // Throttle DOM writes; the HUD only needs to look smooth, not be per-frame.
    if (++this.frame % 3 === 0) {
      this.hud.update(this.characters.active, this.characters.activeIndex);
    }

    this.renderer.render(this.world.scene, this.cameraRig.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.characters.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
