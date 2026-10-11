export interface CameraProfile {
  /** Metres the camera sits behind the character's focus point. */
  distance: number;
  /** Metres above the character's feet that the camera aims at. */
  height: number;
  /** Lateral shoulder offset in metres (positive pushes the camera right). */
  shoulder: number;
  /** Radians added to the player-controlled pitch — lets characters frame differently. */
  pitchOffset: number;
  /** Vertical field of view in degrees. */
  fov: number;
}

export interface CharacterProportions {
  /** Exact standing height in metres (the rig is scaled to match). */
  height: number;
  /** Radius of the torso capsule in metres. */
  radius: number;
  /** Fraction of height taken by the legs (0–1). */
  legRatio: number;
  /** Fraction of height taken by the torso (0–1). */
  torsoRatio: number;
}

export interface CharacterPalette {
  /** Primary body colour (hex). */
  body: number;
  /** Secondary colour for limbs/accents (hex). */
  accent: number;
  /** Visor / eye-band colour (hex). */
  visor: number;
}

export interface CharacterProfile {
  id: string;
  displayName: string;
  /** Maximum sprint speed in m/s — the character's top speed. */
  sprintSpeed: number;
  /** Unforced locomotion speed in m/s. */
  walkSpeed: number;
  /** Ground acceleration in m/s². */
  acceleration: number;
  /** Ground deceleration in m/s² when no input is held. */
  deceleration: number;
  /** How fast the body turns to face travel, in rad/s. */
  turnRate: number;
  /** Initial vertical speed of a jump in m/s. */
  jumpSpeed: number;
  /** How strongly the body leans into acceleration (radians at top speed). */
  lean: number;
  camera: CameraProfile;
  proportions: CharacterProportions;
  palette: CharacterPalette;
}

/** Per-frame intent handed to the active character. */
export interface MovementIntent {
  /** Strafe axis, -1 (left) … +1 (right). */
  moveX: number;
  /** Forward axis, -1 (back) … +1 (forward). */
  moveZ: number;
  sprint: boolean;
  /** True only on the frame the jump button transitions to pressed. */
  jumpPressed: boolean;
  /** Camera yaw in radians; movement is expressed relative to it. */
  cameraYaw: number;
}
