import * as THREE from 'three';
import { Character } from './Character';
import type { ModelLibrary } from './models';
import type { CharacterProfile, MovementIntent } from './types';

/**
 * Owns the roster and arbitrates switching.
 *
 * Every character is constructed **once** at startup and parented to the scene
 * a single time; switching only re-parents visibility and transfers motion
 * state. Nothing is allocated, cloned or re-added on a switch, which is what
 * keeps TASK-001 acceptance criterion 4 (no duplicate meshes, no leaks) true
 * over an unbounded number of swaps.
 */
export class CharacterManager {
  readonly characters: readonly Character[];

  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchVelocity = new THREE.Vector3();
  private index = 0;
  private readonly onChangeCallbacks: Array<(character: Character) => void> = [];

  constructor(
    private readonly scene: THREE.Scene,
    profiles: readonly CharacterProfile[],
    spawn: THREE.Vector3,
    library: ModelLibrary,
  ) {
    // Each character clones the shared template; no mesh data is duplicated.
    const built = profiles.map((profile) => new Character(profile, library.get(profile.id)));

    this.characters = built;

    for (const character of built) {
      character.setPosition(spawn.x, spawn.y, spawn.z);
      character.object.visible = false;
      // Guard against double-add: a scene graph must never hold the same
      // object twice, or the mesh renders once per parent in the worst case.
      if (character.object.parent !== this.scene) this.scene.add(character.object);
    }

    built[0]!.object.visible = true;
    this.index = 0;
  }

  get active(): Character {
    return this.characters[this.index]!;
  }

  get activeIndex(): number {
    return this.index;
  }

  onChange(callback: (character: Character) => void): void {
    this.onChangeCallbacks.push(callback);
  }

  switchTo(index: number): Character {
    if (index < 0 || index >= this.characters.length) return this.active;
    if (index === this.index) return this.active;

    const previous = this.active;
    const next = this.characters[index]!;

    // Criterion 2: the incoming character inherits the outgoing one's exact
    // world position (including airborne height) and facing.
    previous.getPosition(this.scratchPosition);
    const facing = previous.getFacing();
    next.setPosition(this.scratchPosition.x, this.scratchPosition.y, this.scratchPosition.z);
    next.setFacing(facing);

    // Preserve momentum: carry the velocity vector across, clamped to the
    // incoming body's top speed so a switch can never exceed its limit
    // (Eimi 8.0 m/s, Asch 5.5 m/s).
    previous.getVelocity(this.scratchVelocity);
    if (this.scratchVelocity.length() > next.topSpeed) {
      this.scratchVelocity.setLength(next.topSpeed);
    }
    next.setVelocity(this.scratchVelocity);

    // The outgoing character is parked, not destroyed — it will be reused.
    previous.resetMotion();
    previous.object.visible = false;
    next.object.visible = true;

    this.index = index;

    for (const callback of this.onChangeCallbacks) callback(next);
    return next;
  }

  /** Cycles the roster — the behaviour bound to Tab / gamepad Y. */
  switchNext(): Character {
    return this.switchTo((this.index + 1) % this.characters.length);
  }

  update(dt: number, intent: MovementIntent): void {
    // Only the active character is simulated; parked characters cost nothing.
    this.active.update(dt, intent);
  }

  /**
   * Detaches every character. Shared model buffers stay alive — release them
   * with `ModelLibrary.dispose()` once nothing else references them.
   */
  dispose(): void {
    for (const character of this.characters) character.dispose();
    this.onChangeCallbacks.length = 0;
  }
}
