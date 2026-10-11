import * as THREE from 'three';
import type { CharacterProfile } from './types';

/**
 * Disposable resource tracker. Every geometry/material created for the scene is
 * registered here so `dispose()` can release GPU memory deterministically —
 * TASK-001 acceptance criterion 4 (no leaks).
 */
export class Disposer {
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();

  track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  trackMaterial<T extends THREE.Material>(material: T): T {
    this.materials.add(material);
    return material;
  }

  trackTexture<T extends THREE.Texture>(texture: T): T {
    this.textures.add(texture);
    return texture;
  }

  /** Releases everything registered, including resources found by traversal. */
  dispose(root?: THREE.Object3D): void {
    root?.traverse((object) => {
      const mesh = object as Partial<THREE.Mesh>;
      if (mesh.geometry) this.geometries.add(mesh.geometry);
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => this.materials.add(m));
      else if (material) this.materials.add(material);
    });

    this.textures.forEach((texture) => texture.dispose());
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.textures.clear();
    this.geometries.clear();
    this.materials.clear();
  }
}

/** Joints the controller animates each frame. */
export interface RigParts {
  root: THREE.Group;
  /** Pivot at hip height; legs swing around it. */
  legLeft: THREE.Group;
  legRight: THREE.Group;
  /** Pivot at shoulder height; arms counter-swing. */
  armLeft: THREE.Group;
  armRight: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
}

const CAP_SEGMENTS = 6;
const RADIAL_SEGMENTS = 12;

function capsule(length: number, radius: number): THREE.CapsuleGeometry {
  const cylinder = Math.max(length - radius * 2, radius * 0.5);
  return new THREE.CapsuleGeometry(radius, cylinder, CAP_SEGMENTS, RADIAL_SEGMENTS);
}

/**
 * Builds a placeholder humanoid from primitives — no external assets, no
 * network fetch. The character faces +Z by construction.
 *
 * The assembled rig is measured and uniformly scaled so its standing height
 * matches `proportions.height` exactly.
 */
export function buildPlaceholderRig(profile: CharacterProfile, disposer: Disposer): RigParts {
  const { proportions, palette } = profile;

  const bodyMaterial = disposer.trackMaterial(
    new THREE.MeshStandardMaterial({ color: palette.body, roughness: 0.55, metalness: 0.05 }),
  );
  const accentMaterial = disposer.trackMaterial(
    new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.45, metalness: 0.1 }),
  );
  const visorMaterial = disposer.trackMaterial(
    new THREE.MeshStandardMaterial({
      color: palette.visor,
      roughness: 0.25,
      metalness: 0.2,
      emissive: new THREE.Color(palette.visor).multiplyScalar(0.35),
    }),
  );

  const root = new THREE.Group();
  root.name = `${profile.id}-rig`;

  // --- Legs -----------------------------------------------------------------
  const legLength = proportions.height * proportions.legRatio;
  const legRadius = proportions.radius * 0.4;
  const hipY = legLength;
  const legGeometry = disposer.track(capsule(legLength, legRadius));

  const makeLeg = (side: -1 | 1): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * proportions.radius * 0.5, hipY, 0);
    const mesh = new THREE.Mesh(legGeometry, accentMaterial);
    mesh.position.y = -legLength / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  };

  const legLeft = makeLeg(-1);
  const legRight = makeLeg(1);
  root.add(legLeft, legRight);

  // --- Torso ----------------------------------------------------------------
  const torsoLength = proportions.height * proportions.torsoRatio;
  const torsoRadius = proportions.radius;
  const torsoGeometry = disposer.track(capsule(torsoLength, torsoRadius));

  const torso = new THREE.Group();
  torso.position.set(0, hipY, 0);
  const torsoMesh = new THREE.Mesh(torsoGeometry, bodyMaterial);
  torsoMesh.position.y = torsoLength / 2;
  torsoMesh.castShadow = true;
  torso.add(torsoMesh);

  // Chest emblem doubles as a facing cue.
  const emblem = new THREE.Mesh(
    disposer.track(new THREE.BoxGeometry(torsoRadius * 0.7, torsoRadius * 0.5, torsoRadius * 0.3)),
    visorMaterial,
  );
  emblem.position.set(0, torsoLength * 0.72, torsoRadius * 0.88);
  torso.add(emblem);
  root.add(torso);

  // --- Arms -----------------------------------------------------------------
  const shoulderY = hipY + torsoLength * 0.92;
  const armLength = proportions.height * 0.32;
  const armRadius = proportions.radius * 0.26;
  const armGeometry = disposer.track(capsule(armLength, armRadius));

  const makeArm = (side: -1 | 1): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (torsoRadius + armRadius * 1.15), shoulderY, 0);
    const mesh = new THREE.Mesh(armGeometry, accentMaterial);
    mesh.position.y = -armLength / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  };

  const armLeft = makeArm(-1);
  const armRight = makeArm(1);
  root.add(armLeft, armRight);

  // --- Head -----------------------------------------------------------------
  const headRadius = proportions.radius * 0.66;
  const head = new THREE.Group();
  head.position.set(0, hipY + torsoLength + headRadius * 0.72, 0);

  const headMesh = new THREE.Mesh(
    disposer.track(new THREE.SphereGeometry(headRadius, RADIAL_SEGMENTS * 2, RADIAL_SEGMENTS)),
    bodyMaterial,
  );
  headMesh.castShadow = true;
  head.add(headMesh);

  const visor = new THREE.Mesh(
    disposer.track(new THREE.BoxGeometry(headRadius * 1.25, headRadius * 0.42, headRadius * 0.5)),
    visorMaterial,
  );
  visor.position.set(0, headRadius * 0.12, headRadius * 0.78);
  head.add(visor);
  root.add(head);

  // Normalise the rig to the profile's exact standing height.
  root.updateMatrixWorld(true);
  const measured = new THREE.Box3().setFromObject(root);
  const measuredHeight = Math.max(measured.max.y - measured.min.y, 1e-4);
  const scale = proportions.height / measuredHeight;
  root.scale.setScalar(scale);
  // Re-seat the feet on the ground plane after scaling.
  root.position.y = -measured.min.y * scale;

  return { root, legLeft, legRight, armLeft, armRight, torso, head };
}
