/**
 * Spell - the world as seen by the browser: terrain mesh, water, sky, sun.
 *
 * Performance notes (report section 6): the terrain is a single flat-shaded,
 * vertex-coloured mesh built once from the shared generator (no textures ->
 * no draw-call explosion, no texture bandwidth), resource nodes are instanced,
 * and distance is hidden with fog rather than with more geometry.
 */

import * as THREE from 'three';
import { SKY, colorNumber } from './palette.js';
import { WORLD } from '../../shared/config.js';
import { sampleHeight, terrainHeight, slopeAt, biomeAt, sunDirection, dayLight, isNight } from '../../shared/noise.js';

const COLORS = {
  water: [0.16, 0.28, 0.34],
  sand: [0.82, 0.75, 0.55],
  grass: [0.40, 0.60, 0.29],
  forest: [0.28, 0.47, 0.23],
  rock: [0.52, 0.53, 0.55],
  snow: [0.90, 0.93, 0.95],
};

/* deterministic per-triangle colour jitter for the low-poly look */
function jitter(x, z, seed) {
  const n = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453;
  return (n - Math.floor(n)) * 0.12 - 0.06;
}

export class WorldView {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    this.size = WORLD.size;
    this.grid = WORLD.grid;

    this.group = new THREE.Group();
    scene.add(this.group);

    this.buildTerrain();
    this.buildWater();
    this.buildSky();

    this.sun = new THREE.DirectionalLight(colorNumber(SKY.sun), 1.15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    const s = 60;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0015;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(colorNumber(SKY.hemiSky), colorNumber(SKY.hemiGround), 0.65);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(colorNumber(SKY.ambient), 0.15);
    scene.add(this.ambient);

    this._skyColors = { top: new THREE.Color(), bottom: new THREE.Color() };
    this._tmpVec = new THREE.Vector3();
    this._dayTop = new THREE.Color(colorNumber(SKY.dayTop));
    this._nightTop = new THREE.Color(colorNumber(SKY.nightTop));
    this._dayBottom = new THREE.Color(colorNumber(SKY.dayBottom));
    this._duskBottom = new THREE.Color(colorNumber(SKY.duskBottom));
    this._nightBottom = new THREE.Color(colorNumber(SKY.nightBottom));
    this._lastSkyUpdate = -1;
  }

  /* ---------------------------------------------------------- *
   *  Terrain
   * ---------------------------------------------------------- */
  buildTerrain() {
    const N = WORLD.size / WORLD.grid; // cells per side
    const positions = new Float32Array(N * N * 6 * 3);
    const colors = new Float32Array(N * N * 6 * 3);
    const normals = new Float32Array(N * N * 6 * 3);
    let p = 0;
    let c = 0;
    let n = 0;

    const heights = new Float32Array((N + 1) * (N + 1));
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        heights[i * (N + 1) + j] = terrainHeight(-WORLD.half + i * WORLD.grid, -WORLD.half + j * WORLD.grid, this.seed);
      }
    }
    const H = (i, j) => heights[i * (N + 1) + j];

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const cc = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const nrm = new THREE.Vector3();

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x0 = -WORLD.half + i * WORLD.grid;
        const z0 = -WORLD.half + j * WORLD.grid;
        const x1 = x0 + WORLD.grid;
        const z1 = z0 + WORLD.grid;
        const h00 = H(i, j);
        const h10 = H(i + 1, j);
        const h01 = H(i, j + 1);
        const h11 = H(i + 1, j + 1);

        const cx = x0 + WORLD.grid / 2;
        const cz = z0 + WORLD.grid / 2;
        const ch = (h00 + h10 + h01 + h11) / 4;
        const sl = slopeAt(cx, cz, this.seed);
        const biome = biomeAt(cx, cz, ch, sl, this.seed);
        const base = COLORS[biome] || COLORS.grass;
        const tint = jitter(cx, cz, this.seed);

        // Winding matters: three.js culls back faces, so a ground quad has to be
        // counter-clockwise when seen from above or the terrain only shows up
        // from underneath. The diagonal runs (x0,z0) -> (x1,z1), and both
        // triangles below produce an upward (+Y) face normal.
        const quads = [
          [[x0, h00, z0], [x0, h01, z1], [x1, h10, z0]],
          [[x1, h11, z1], [x1, h10, z0], [x0, h01, z1]],
        ];
        for (const tri of quads) {
          a.set(tri[0][0], tri[0][1], tri[0][2]);
          b.set(tri[1][0], tri[1][1], tri[1][2]);
          cc.set(tri[2][0], tri[2][1], tri[2][2]);
          ab.subVectors(b, a);
          ac.subVectors(cc, a);
          nrm.crossVectors(ab, ac).normalize();
          for (const v of tri) {
            positions[p++] = v[0]; positions[p++] = v[1]; positions[p++] = v[2];
            normals[n++] = nrm.x; normals[n++] = nrm.y; normals[n++] = nrm.z;
            const shade = 1 + tint + nrm.y * 0.06;
            colors[c++] = Math.min(1, base[0] * shade);
            colors[c++] = Math.min(1, base[1] * shade);
            colors[c++] = Math.min(1, base[2] * shade);
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeBoundingSphere();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = false;
    this.terrain.matrixAutoUpdate = false;
    this.group.add(this.terrain);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(WORLD.size * 2.4, WORLD.size * 2.4, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({
      color: colorNumber(SKY.water), transparent: true, opacity: 0.78, depthWrite: true,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WORLD.seaLevel;
    this.water.receiveShadow = false;
    this.group.add(this.water);
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(760, 24, 12);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 760;
      const t = Math.max(0, Math.min(1, y * 1.4 + 0.25));
      colors[i * 3] = t;
      colors[i * 3 + 1] = t;
      colors[i * 3 + 2] = t;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // stars - only visible at night
    const starCount = 600;
    const sp = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * 0.9 + 0.05;
      const r = 700;
      const phi = Math.acos(1 - v);
      sp[i * 3] = r * Math.sin(phi) * Math.cos(u);
      sp[i * 3 + 1] = r * Math.cos(phi) * 0.9 + 40;
      sp[i * 3 + 2] = r * Math.sin(phi) * Math.sin(u);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: colorNumber(SKY.star), size: 2.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // sun / moon disc
    this.celestialMat = new THREE.MeshBasicMaterial({ color: colorNumber(SKY.celestial), fog: false, depthWrite: false });
    this.celestial = new THREE.Mesh(new THREE.SphereGeometry(14, 12, 8), this.celestialMat);
    this.celestial.frustumCulled = false;
    this.group.add(this.celestial);
  }

  /* ---------------------------------------------------------- *
   *  Per-frame update: sky colour, light direction, fog
   * ---------------------------------------------------------- */
  update(time01, playerPos, renderDistance, underwater = false) {
    const light = dayLight(time01);
    const dir = sunDirection(time01);

    this.sun.position.set(
      playerPos.x + dir.x * 90,
      Math.max(6, dir.y * 90),
      playerPos.z + dir.z * 90,
    );
    this.sun.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    this.sun.intensity = 0.15 + light * 1.1;
    this.sun.color.setHSL(0.09 + light * 0.04, 0.55 - light * 0.35, 0.45 + light * 0.35);
    this.hemi.intensity = 0.18 + light * 0.6;
    this.ambient.intensity = 0.06 + light * 0.14;

    const night = isNight(time01);

    const horizon = light > 0.45
      ? this._duskBottom.clone().lerp(this._dayBottom, (light - 0.45) / 0.55)
      : this._nightBottom.clone().lerp(this._duskBottom, Math.max(0, (light - 0.12) / 0.33));

    this._skyColors.top.copy(this._nightTop).lerp(this._dayTop, Math.min(1, light * 1.15));
    const top = this._skyColors.top;
    const bottom = horizon;

    // update the gradient sphere colours (cheap: only when the light changed)
    if (Math.abs(light - this._lastSkyUpdate) > 0.01) {
      this._lastSkyUpdate = light;
      const colors = this.sky.geometry.attributes.color;
      for (let i = 0; i < colors.count; i++) {
        const y = this.sky.geometry.attributes.position.getY(i) / 760;
        const tt = Math.max(0, Math.min(1, y * 1.4 + 0.25));
        colors.setXYZ(i,
          bottom.r + (top.r - bottom.r) * tt,
          bottom.g + (top.g - bottom.g) * tt,
          bottom.b + (top.b - bottom.b) * tt);
      }
      colors.needsUpdate = true;
    }

    if (this.scene.fog) {
      if (underwater) {
        this.scene.fog.color.setHex(colorNumber(SKY.fogNight));
        this.scene.fog.near = 0.5;
        this.scene.fog.far = 24;
      } else {
        this.scene.fog.color.copy(horizon);
        this.scene.fog.near = renderDistance * 0.45;
        this.scene.fog.far = renderDistance;
      }
    }
    this.scene.background = horizon.clone();

    this.starMat.opacity = night ? 0.9 : Math.max(0, 0.9 - light * 3);
    this.celestial.position.copy(this.sun.position)
      .sub(this._tmpVec.set(playerPos.x, playerPos.y, playerPos.z))
      .normalize().multiplyScalar(700)
      .add(this._tmpVec.set(playerPos.x, playerPos.y, playerPos.z));
    this.celestialMat.color.set(night ? colorNumber(SKY.celestialNight) : colorNumber(SKY.celestial));

    this.water.position.y = WORLD.seaLevel + Math.sin(time01 * Math.PI * 40) * 0.05;
  }

  heightAt(x, z) {
    return sampleHeight(x, z, this.seed);
  }

  /** Draw the island to a canvas for the map screen (cached by the caller). */
  paintMap(ctx, width, height, buildings, players, self) {
    const img = ctx.createImageData(width, height);
    const step = WORLD.size / width;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const x = -WORLD.half + px * step;
        const z = -WORLD.half + py * step;
        const h = terrainHeight(x, z, this.seed);
        const sl = slopeAt(x, z, this.seed);
        const b = biomeAt(x, z, h, sl, this.seed);
        let col = COLORS[b] || COLORS.grass;
        if (h < WORLD.seaLevel) {
          const depth = Math.min(1, (WORLD.seaLevel - h) / 12);
          col = [0.18 - depth * 0.08, 0.42 - depth * 0.2, 0.55 - depth * 0.24];
        } else {
          const shade = 0.85 + Math.min(0.35, h / 60);
          col = [col[0] * shade, col[1] * shade, col[2] * shade];
        }
        const i = (py * width + px) * 4;
        img.data[i] = col[0] * 255;
        img.data[i + 1] = col[1] * 255;
        img.data[i + 2] = col[2] * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const toPx = (v) => ((v + WORLD.half) / WORLD.size) * width;

    ctx.fillStyle = '#f0a63c';
    for (const b of buildings.values()) {
      const p = { x: b.cx * WORLD.grid, z: b.cz * WORLD.grid };
      ctx.fillRect(toPx(p.x) - 2, toPx(p.z) - 2, 4, 4);
    }
    for (const p of players.values()) {
      if (p.id === self.id) continue;
      ctx.fillStyle = '#6ec1e4';
      ctx.fillRect(toPx(p.x) - 2, toPx(p.z) - 2, 4, 4);
    }
    // self marker
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(toPx(self.x), toPx(self.z), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(toPx(self.x), toPx(self.z));
    ctx.lineTo(toPx(self.x) + Math.sin(self.yaw) * 12, toPx(self.z) + Math.cos(self.yaw) * 12);
    ctx.stroke();
  }
}
