import type { CharacterProfile } from './types';

/**
 * TASK-001 acceptance criterion 3: distinct top speeds.
 * Eimi is the sprinter (8.0 m/s), Asch is the heavy jogger (5.5 m/s).
 */
export const EIMI: CharacterProfile = {
  id: 'eimi',
  displayName: 'Eimi',
  sprintSpeed: 8.0,
  walkSpeed: 3.2,
  acceleration: 34,
  deceleration: 30,
  turnRate: 14,
  jumpSpeed: 7.4,
  lean: 0.16,
  camera: {
    distance: 5.4,
    height: 1.55,
    shoulder: 0.5,
    pitchOffset: 0.06,
    fov: 62,
  },
  proportions: {
    height: 1.74,
    radius: 0.27,
    legRatio: 0.46,
    torsoRatio: 0.3,
  },
  palette: {
    body: 0x2f6f8f,
    accent: 0x9fe8ff,
    visor: 0x6ee7d7,
  },
};

export const ASCH: CharacterProfile = {
  id: 'asch',
  displayName: 'Asch',
  sprintSpeed: 5.5,
  walkSpeed: 2.5,
  acceleration: 22,
  deceleration: 20,
  turnRate: 9,
  jumpSpeed: 6.2,
  lean: 0.1,
  camera: {
    distance: 4.4,
    height: 1.38,
    shoulder: -0.45,
    pitchOffset: 0.02,
    fov: 58,
  },
  proportions: {
    height: 1.6,
    radius: 0.33,
    legRatio: 0.42,
    torsoRatio: 0.32,
  },
  palette: {
    body: 0x8a5a2f,
    accent: 0xffc98a,
    visor: 0xff9d4d,
  },
};

export const ROSTER: readonly CharacterProfile[] = [EIMI, ASCH];
