/**
 * Generates the character models as .glb files under public/models/.
 *
 *      npm run build:models
 *
 * The models are procedural — there is no network access to fetch authored
 * assets, and no artist in the loop. They are written as real glTF binaries so
 * they can later be swapped for hand-made ones without touching runtime code.
 *
 * Each file is parsed back through three's GLTFLoader afterwards, so a broken
 * export fails the build instead of failing silently in the browser.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROSTER } from '../src/characters/roster';
import { writeGlb } from './glb-writer';
import { buildHumanoid } from './humanoid';

const OUT_DIR = path.resolve(process.cwd(), 'public/models');

function parse(glb: Buffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    const arrayBuffer = glb.buffer.slice(
      glb.byteOffset,
      glb.byteOffset + glb.byteLength,
    ) as ArrayBuffer;
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let failed = false;

  for (const profile of ROSTER) {
    const model = buildHumanoid({
      id: profile.id,
      height: profile.proportions.height,
      build: profile.model.build,
      hair: profile.model.hair,
      outfit: profile.model.outfit,
      material: {
        skin: profile.palette.skin,
        hair: profile.palette.hair,
        cloth: profile.palette.body,
        accent: profile.palette.accent,
        trim: profile.palette.visor,
        eye: profile.palette.eye,
      },
    });

    const glb = writeGlb(model.meshes, model.nodes, model.materials, 'spell/tools/build-models');
    const file = path.join(OUT_DIR, `${profile.id}.glb`);
    fs.writeFileSync(file, glb);

    // Round-trip the file through the loader the browser will use.
    const scene = await parse(glb);
    const ANIMATED = ['torso', 'head', 'armLeft', 'armRight', 'legLeft', 'legRight'];
    const names: string[] = [];
    let triangles = 0;
    let meshCount = 0;
    scene.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      meshCount += 1;
      triangles += ((object as THREE.Mesh).geometry.getIndex()?.count ?? 0) / 3;
      if (ANIMATED.includes(object.name) && !names.includes(object.name)) {
        names.push(object.name);
      }
    });

    const box = new THREE.Box3().setFromObject(scene);
    const height = box.max.y - box.min.y;
    const expected = profile.proportions.height;
    const heightOk = Math.abs(height - expected) <= expected * 0.02;

    console.log(
      `${profile.id}.glb  ${(glb.length / 1024).toFixed(0)} KB  ` +
        `${meshCount} meshes  ${triangles} triangles  ` +
        `height ${height.toFixed(3)}m (target ${expected.toFixed(3)}m) ${heightOk ? 'OK' : 'MISMATCH'}`,
    );
    console.log(`  animated nodes: ${names.join(', ')}`);

    const missing = ANIMATED.filter((name) => !scene.getObjectByName(name));
    if (missing.length > 0) {
      console.error(`  ERROR missing nodes: ${missing.join(', ')}`);
      failed = true;
    }
    if (!heightOk) failed = true;
  }

  if (failed) {
    console.error('\nModel generation FAILED.');
    process.exitCode = 1;
    return;
  }
  console.log('\nModels OK.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
