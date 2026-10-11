import * as THREE from 'three';
import { Disposer } from '../core/Disposer';

export interface World {
  scene: THREE.Scene;
  dispose(): void;
}

/**
 * Static environment: ground, lighting and a scatter of landmarks so motion and
 * camera orbit read clearly. Built once and disposed once.
 */
export function createWorld(): World {
  const disposer = new Disposer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1219);
  scene.fog = new THREE.Fog(0x0d1219, 40, 130);

  // --- Lighting -------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0x9fc6ff, 0x2a2118, 1.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.position.set(18, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // --- Ground ---------------------------------------------------------------
  const groundGeometry = disposer.track(new THREE.PlaneGeometry(400, 400));
  const groundMaterial = disposer.trackMaterial(
    new THREE.MeshStandardMaterial({ color: 0x2c3a33, roughness: 0.95, metalness: 0 }),
  );
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(400, 200, 0x3d5a52, 0x263431);
  grid.position.y = 0.002;
  grid.material.opacity = 0.5;
  grid.material.transparent = true;
  disposer.trackMaterial(grid.material as THREE.Material);
  disposer.track(grid.geometry);
  scene.add(grid);

  // --- Landmarks ------------------------------------------------------------
  const pillarGeometry = disposer.track(new THREE.BoxGeometry(1, 1, 1));
  const pillarMaterial = disposer.trackMaterial(
    new THREE.MeshStandardMaterial({ color: 0x39485c, roughness: 0.7, metalness: 0.05 }),
  );

  const layout: ReadonlyArray<readonly [number, number, number, number]> = [
    // x, z, height, width
    [-14, -9, 3.2, 1.6],
    [12, -14, 5.4, 2.0],
    [22, 6, 2.4, 1.2],
    [-20, 12, 4.1, 1.8],
    [4, 20, 6.2, 2.4],
    [-8, -22, 2.0, 1.0],
  ];

  for (const [x, z, height, width] of layout) {
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.scale.set(width, height, width);
    pillar.position.set(x, height / 2, z);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    scene.add(pillar);
  }

  return {
    scene,
    dispose(): void {
      sun.shadow.map?.dispose();
      disposer.dispose(scene);
      scene.clear();
    },
  };
}
