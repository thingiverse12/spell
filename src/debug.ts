import * as THREE from 'three';
import type { App } from './App';

export interface SpellDebugState {
  /** Id of the active character, e.g. "eimi". */
  active: string;
  displayName: string;
  index: number;
  /** Horizontal ground speed in m/s. */
  speed: number;
  /** The active character's top speed in m/s. */
  topSpeed: number;
  position: [number, number, number];
  velocity: [number, number, number];
  grounded: boolean;
  /** Camera orbit angles in radians — these must survive a character switch. */
  yaw: number;
  pitch: number;
  cameraPosition: [number, number, number];
}

export interface SpellDebugMetrics {
  /** Mesh objects currently in the scene graph. */
  meshes: number;
  /** Direct children of the scene. */
  sceneChildren: number;
  /** Live GPU resources tracked by the renderer. */
  geometries: number;
  textures: number;
  programs: number;
}

export interface SpellDebugApi {
  state(): SpellDebugState;
  metrics(): SpellDebugMetrics;
  switchTo(index: number): void;
  switchNext(): void;
  /** Samples speed every frame for `ms` and reports the peak — used to prove a
   *  character never exceeds its top speed. */
  peakSpeed(ms: number): Promise<number>;
}

declare global {
  interface Window {
    __spell?: SpellDebugApi;
  }
}

const positionScratch = new THREE.Vector3();
const velocityScratch = new THREE.Vector3();

/**
 * Read-only telemetry seam for automated tests. It reports measurements only;
 * gameplay is still driven through real keyboard/mouse events, so a passing
 * Playwright run exercises the genuine input path.
 */
export function installDebugApi(app: App): void {
  window.__spell = {
    state(): SpellDebugState {
      const character = app.characters.active;
      character.getPosition(positionScratch);
      character.getVelocity(velocityScratch);

      return {
        active: character.id,
        displayName: character.displayName,
        index: app.characters.activeIndex,
        speed: character.speed,
        topSpeed: character.topSpeed,
        position: positionScratch.toArray() as [number, number, number],
        velocity: velocityScratch.toArray() as [number, number, number],
        grounded: character.isGrounded,
        yaw: app.cameraRig.yaw,
        pitch: app.cameraRig.pitch,
        cameraPosition: app.cameraRig.camera.position.toArray() as [number, number, number],
      };
    },

    metrics(): SpellDebugMetrics {
      let meshes = 0;
      app.world.scene.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) meshes += 1;
      });
      return {
        meshes,
        sceneChildren: app.world.scene.children.length,
        geometries: app.renderer.info.memory.geometries,
        textures: app.renderer.info.memory.textures,
        programs: app.renderer.info.programs?.length ?? 0,
      };
    },

    switchTo(index: number): void {
      app.characters.switchTo(index);
    },

    switchNext(): void {
      app.characters.switchNext();
    },

    peakSpeed(ms: number): Promise<number> {
      return new Promise((resolve) => {
        let peak = 0;
        const start = performance.now();
        const step = (): void => {
          peak = Math.max(peak, app.characters.active.speed);
          if (performance.now() - start >= ms) resolve(peak);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    },
  };
}
