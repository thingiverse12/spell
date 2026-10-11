import * as THREE from 'three';
import type { CameraProfile } from '../characters/types';

const MOUSE_SENSITIVITY = 0.0032;
const PITCH_MIN = -0.42;
const PITCH_MAX = 1.22;
const DISTANCE_MIN = 2.2;
const DISTANCE_MAX = 12;

/** How quickly the follow point catches up to the character (1/s). */
const FOLLOW_LAMBDA = 14;
/** How quickly the rig re-frames when a character with a new profile appears. */
const PROFILE_LAMBDA = 9;

function damp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

/**
 * Third-person orbit camera.
 *
 * Yaw/pitch belong to the rig, **not** to the active character, so switching
 * characters preserves the player's camera angle exactly (TASK-001 acceptance
 * criterion 2). Only the framing values declared by the character's
 * `CameraProfile` — distance, height, shoulder, FOV — are re-targetted, and
 * they blend in over a fraction of a second instead of popping.
 */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;

  /** Orbit angle around the vertical axis, in radians. */
  yaw = Math.PI * 0.08;
  /** Elevation angle, in radians. Positive looks down at the character. */
  pitch = 0.28;

  private distance = 5;
  private height = 1.5;
  private shoulder = 0;
  private fov = 60;

  private targetDistance = 5;
  private targetHeight = 1.5;
  private targetShoulder = 0;
  private targetFov = 60;
  private targetPitchOffset = 0;
  private pitchOffset = 0;

  private readonly focus = new THREE.Vector3();
  private readonly desiredFocus = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.1, 400);
  }

  /**
   * Re-targets framing to a character profile.
   * @param snap Apply immediately (used for the very first character).
   */
  setProfile(profile: CameraProfile, snap = false): void {
    this.targetDistance = profile.distance;
    this.targetHeight = profile.height;
    this.targetShoulder = profile.shoulder;
    this.targetFov = profile.fov;
    this.targetPitchOffset = profile.pitchOffset;

    if (snap) {
      this.distance = profile.distance;
      this.height = profile.height;
      this.shoulder = profile.shoulder;
      this.pitchOffset = profile.pitchOffset;
      this.fov = profile.fov;
      this.camera.fov = profile.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Applies accumulated pointer/gamepad look deltas, in pixels. */
  addLook(deltaX: number, deltaY: number): void {
    this.yaw -= deltaX * MOUSE_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch + deltaY * MOUSE_SENSITIVITY, PITCH_MIN, PITCH_MAX);
  }

  addZoom(delta: number): void {
    this.targetDistance = THREE.MathUtils.clamp(
      this.targetDistance + delta * 0.0025,
      DISTANCE_MIN,
      DISTANCE_MAX,
    );
  }

  /** Instantly re-seats the follow point — used when a switch teleports the rig. */
  snapTo(target: THREE.Vector3): void {
    this.desiredFocus.set(target.x, target.y + this.height, target.z);
    this.focus.copy(this.desiredFocus);
    this.place();
  }

  update(dt: number, target: THREE.Vector3): void {
    this.distance += (this.targetDistance - this.distance) * damp(PROFILE_LAMBDA, dt);
    this.height += (this.targetHeight - this.height) * damp(PROFILE_LAMBDA, dt);
    this.shoulder += (this.targetShoulder - this.shoulder) * damp(PROFILE_LAMBDA, dt);
    this.pitchOffset += (this.targetPitchOffset - this.pitchOffset) * damp(PROFILE_LAMBDA, dt);

    const nextFov = this.fov + (this.targetFov - this.fov) * damp(PROFILE_LAMBDA, dt);
    if (Math.abs(nextFov - this.camera.fov) > 1e-4) {
      this.fov = nextFov;
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    this.desiredFocus.set(target.x, target.y + this.height, target.z);
    this.focus.lerp(this.desiredFocus, damp(FOLLOW_LAMBDA, dt));

    this.place();
  }

  private place(): void {
    const pitch = THREE.MathUtils.clamp(this.pitch + this.pitchOffset, PITCH_MIN, PITCH_MAX);
    const cosPitch = Math.cos(pitch);

    this.offset.set(Math.sin(this.yaw) * cosPitch, Math.sin(pitch), Math.cos(this.yaw) * cosPitch);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this.camera.position
      .copy(this.focus)
      .addScaledVector(this.offset, this.distance)
      .addScaledVector(this.right, this.shoulder);

    this.lookAt.copy(this.focus).addScaledVector(this.right, this.shoulder);
    this.camera.lookAt(this.lookAt);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }
}
