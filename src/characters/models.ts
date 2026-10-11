import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CharacterProfile } from './types';

/** Joints the controller animates each frame. */
export interface RigParts {
  root: THREE.Object3D;
  legLeft: THREE.Object3D;
  legRight: THREE.Object3D;
  armLeft: THREE.Object3D;
  armRight: THREE.Object3D;
  torso: THREE.Object3D;
  head: THREE.Object3D;
}

const JOINT_NAMES = [
  'legLeft',
  'legRight',
  'armLeft',
  'armRight',
  'torso',
  'head',
] as const;

export const MODEL_BASE_URL = `${import.meta.env.BASE_URL}models/`;

/**
 * Loads the character .glb files once and hands out clones.
 *
 * Clones share geometry and materials with the template, so two characters cost
 * one copy of the mesh data on the GPU — and switching characters never
 * allocates anything.
 */
export class ModelLibrary {
  private readonly templates = new Map<string, THREE.Object3D>();
  private readonly loader = new GLTFLoader();
  private readonly disposer = new Set<THREE.BufferGeometry>();
  private readonly materialDisposer = new Set<THREE.Material>();

  /** Parses a model from an in-memory GLB (used by the browser fetch path and
   *  by the headless test harness, which reads the file from disk). */
  parse(id: string, buffer: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.loader.parse(
        buffer,
        '',
        (gltf) => {
          const root = gltf.scene.getObjectByName('root') ?? gltf.scene;
          root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.disposer.add(mesh.geometry);
            const material = mesh.material;
            if (Array.isArray(material)) material.forEach((m) => this.materialDisposer.add(m));
            else this.materialDisposer.add(material);
          });
          this.templates.set(id, root);
          resolve();
        },
        reject,
      );
    });
  }

  async loadAll(profiles: readonly CharacterProfile[]): Promise<void> {
    await Promise.all(
      profiles.map(async (profile) => {
        const url = `${MODEL_BASE_URL}${profile.id}.glb`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Failed to load model "${profile.id}" from ${url} (${response.status}). ` +
              'Run `npm run build:models` to generate public/models/.',
          );
        }
        await this.parse(profile.id, await response.arrayBuffer());
      }),
    );
  }

  get(id: string): THREE.Object3D {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Model "${id}" was never loaded into the library`);
    return template;
  }

  /** Releases the shared mesh data. Call once, after every character is gone. */
  dispose(): void {
    this.disposer.forEach((geometry) => geometry.dispose());
    this.materialDisposer.forEach((material) => material.dispose());
    this.disposer.clear();
    this.materialDisposer.clear();
    this.templates.clear();
  }
}

/**
 * Clones a loaded model into a fresh rig and resolves its animated joints.
 *
 * The clone shares buffers with the template, so this is cheap and safe to call
 * once per character at startup.
 */
export function buildModelRig(template: THREE.Object3D): RigParts {
  const root = template.clone(true);

  const joints: Record<string, THREE.Object3D> = {};
  for (const name of JOINT_NAMES) {
    const joint = root.getObjectByName(name);
    if (!joint) {
      throw new Error(
        `Model is missing the "${name}" joint. Expected nodes: ${JOINT_NAMES.join(', ')}.`,
      );
    }
    joints[name] = joint;
  }

  return {
    root,
    legLeft: joints['legLeft']!,
    legRight: joints['legRight']!,
    armLeft: joints['armLeft']!,
    armRight: joints['armRight']!,
    torso: joints['torso']!,
    head: joints['head']!,
  };
}
