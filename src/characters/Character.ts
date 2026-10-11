import * as THREE from 'three';
import { buildPlaceholderRig, type Disposer, type RigParts } from './placeholderRig';
import type { CharacterProfile, MovementIntent } from './types';

const GRAVITY = -22;
const MAX_INPUT = 1;
const TWO_PI = Math.PI * 2;

/** Frame-rate independent exponential smoothing factor. */
function damp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

/** Shortest signed angular delta from `from` to `to`, in (-π, π]. */
function angleDelta(from: number, to: number): number {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return delta;
}

/**
 * A controllable character: owns its rig, its motion state, and its procedural
 * locomotion animation. Instances are created once and reused for the lifetime
 * of the app — switching characters never rebuilds a rig.
 */
export class Character {
  readonly profile: CharacterProfile;
  /** World transform of the character; its origin sits at the feet. */
  readonly object = new THREE.Group();

  private readonly rig: RigParts;
  private readonly disposer: Disposer;

  private readonly velocity = new THREE.Vector3();
  private readonly desiredDirection = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  private facing = 0;
  private grounded = true;
  private stridePhase = 0;
  private leanAmount = 0;
  /** Rig's local Y offset that seats the feet on y = 0. */
  private readonly restY: number;

  constructor(profile: CharacterProfile, disposer: Disposer) {
    this.profile = profile;
    this.disposer = disposer;
    this.rig = buildPlaceholderRig(profile, disposer);
    this.rig.root.name = `${profile.id}-rig`;
    this.object.name = profile.id;
    this.object.add(this.rig.root);
    this.restY = this.rig.root.position.y;
  }

  get id(): string {
    return this.profile.id;
  }

  get displayName(): string {
    return this.profile.displayName;
  }

  get topSpeed(): number {
    return this.profile.sprintSpeed;
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  /** Horizontal speed in m/s. */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** World-space position of the feet. */
  getPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.object.position);
  }

  setPosition(x: number, y: number, z: number): void {
    this.object.position.set(x, y, z);
  }

  getFacing(): number {
    return this.facing;
  }

  setFacing(radians: number): void {
    this.facing = radians;
    this.object.rotation.y = radians;
  }

  /**
   * Overwrites the momentum vector. Used on character switch so the incoming
   * character inherits the outgoing one's motion.
   */
  setVelocity(velocity: THREE.Vector3): void {
    this.velocity.copy(velocity);
  }

  getVelocity(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.velocity);
  }

  /** Freezes all motion — used when a character is swapped out. */
  resetMotion(): void {
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.leanAmount = 0;
    this.stridePhase = 0;
    this.rig.torso.rotation.x = 0;
    this.rig.root.position.y = this.restY;
    this.rig.legLeft.rotation.x = 0;
    this.rig.legRight.rotation.x = 0;
    this.rig.armLeft.rotation.x = 0;
    this.rig.armRight.rotation.x = 0;
  }

  update(dt: number, intent: MovementIntent): void {
    this.applyHorizontalMotion(dt, intent);
    this.applyVerticalMotion(dt, intent.jumpPressed);
    this.object.position.addScaledVector(this.velocity, dt);
    this.animate(dt);
  }

  private applyHorizontalMotion(dt: number, intent: MovementIntent): void {
    const { cameraYaw, sprint } = intent;

    // Camera-relative basis: forward is the direction the camera is looking.
    this.forward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    this.right.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));

    const inputX = THREE.MathUtils.clamp(intent.moveX, -MAX_INPUT, MAX_INPUT);
    const inputZ = THREE.MathUtils.clamp(intent.moveZ, -MAX_INPUT, MAX_INPUT);

    this.desiredDirection
      .set(0, 0, 0)
      .addScaledVector(this.forward, inputZ)
      .addScaledVector(this.right, inputX);

    const magnitude = this.desiredDirection.length();
    if (magnitude > MAX_INPUT) this.desiredDirection.divideScalar(magnitude);
    const throttle = Math.min(magnitude, MAX_INPUT);

    const targetSpeed = (sprint ? this.profile.sprintSpeed : this.profile.walkSpeed) * throttle;
    const desiredVelocityX = this.desiredDirection.x * targetSpeed;
    const desiredVelocityZ = this.desiredDirection.z * targetSpeed;

    // Air control is reduced but not eliminated, which keeps jumps responsive.
    const control = this.grounded ? 1 : 0.35;
    const rate = (throttle > 0 ? this.profile.acceleration : this.profile.deceleration) * control;
    const blend = damp(rate / Math.max(this.profile.sprintSpeed, 0.001), dt);

    this.velocity.x += (desiredVelocityX - this.velocity.x) * blend;
    this.velocity.z += (desiredVelocityZ - this.velocity.z) * blend;

    if (throttle < 0.001 && this.speed < 0.02) {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    // Face the direction of travel without snapping when reversing.
    if (this.speed > 0.15) {
      const travel = Math.atan2(this.velocity.x, this.velocity.z);
      const delta = angleDelta(this.facing, travel);
      this.facing += delta * damp(this.profile.turnRate, dt);
      this.object.rotation.y = this.facing;
    }
  }

  private applyVerticalMotion(dt: number, jumpPressed: boolean): void {
    if (this.grounded && jumpPressed) {
      this.velocity.y = this.profile.jumpSpeed;
      this.grounded = false;
    }

    this.velocity.y += GRAVITY * dt;

    if (this.object.position.y + this.velocity.y * dt <= 0) {
      this.object.position.y = 0;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }

  private animate(dt: number): void {
    const { rig, profile } = this;
    const speedRatio = THREE.MathUtils.clamp(this.speed / profile.sprintSpeed, 0, 1);

    // Stride frequency scales with ground speed so footfalls match travel.
    this.stridePhase += dt * (2.2 + speedRatio * 12) * (this.grounded ? 1 : 0.25);
    const swing = Math.sin(this.stridePhase) * speedRatio * 0.85;

    if (this.grounded) {
      rig.legLeft.rotation.x = swing;
      rig.legRight.rotation.x = -swing;
      rig.armLeft.rotation.x = -swing * 0.75;
      rig.armRight.rotation.x = swing * 0.75;
    } else {
      // Tuck the limbs a little while airborne.
      const tuck = damp(8, dt);
      rig.legLeft.rotation.x += (-0.5 - rig.legLeft.rotation.x) * tuck;
      rig.legRight.rotation.x += (0.25 - rig.legRight.rotation.x) * tuck;
      rig.armLeft.rotation.x += (-0.9 - rig.armLeft.rotation.x) * tuck;
      rig.armRight.rotation.x += (-0.9 - rig.armRight.rotation.x) * tuck;
    }

    // Lean into the direction of travel and bob with the stride.
    const targetLean = speedRatio * profile.lean;
    this.leanAmount += (targetLean - this.leanAmount) * damp(6, dt);
    rig.torso.rotation.x = this.leanAmount;

    const bob = Math.abs(Math.sin(this.stridePhase)) * speedRatio * 0.055;
    rig.root.position.y = this.restY - bob;

    rig.head.rotation.x = -this.leanAmount * 0.5;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.disposer.dispose(this.object);
  }
}
