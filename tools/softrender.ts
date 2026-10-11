/**
 * Dependency-free software rasteriser + PNG encoder.
 *
 * There is no GPU, no browser and no WebGL in CI, so this renders three.js
 * scenes on the CPU: it walks the real scene graph, projects through the real
 * camera matrices, z-buffers the triangles and writes a PNG using only Node's
 * built-in `zlib`.
 *
 * It reimplements *shading*, not the scene or the camera — geometry placement,
 * rig construction and camera framing all come from the production code, so a
 * screenshot is genuine evidence about the app.
 *
 * Shading is an approximation of three.js, not a match:
 *   - Lambert diffuse only (no specular/IBL), flat-shaded per face
 *   - Linear working space, ACES filmic tone mapping, sRGB output encoding —
 *     the same pipeline the real renderer uses, so colours land in the right
 *     ballpark rather than coming out black.
 *   - Fog is interpolated per-vertex, not per-pixel.
 */

import * as THREE from 'three';
import zlib from 'node:zlib';

export interface RenderOptions {
  width: number;
  height: number;
  /** Supersampling factor per axis (2 = 4x the pixels). */
  samples?: number;
  /** Matches `renderer.toneMappingExposure` in src/App.ts. */
  exposure?: number;
}

/** Fog factor resolution for the per-triangle colour lookup table. */
const FOG_STEPS = 64;

interface Framebuffer {
  width: number;
  height: number;
  color: Uint8ClampedArray;
  depth: Float32Array;
}

/**
 * Screen-space vertices are `[x, y, ndcZ, 1/w]`.
 *
 * Reciprocal clip-w is carried because 1/w — not w — is what interpolates
 * linearly across a triangle in screen space, and w is the view-space depth
 * three.js uses for fog (`fogDepth = -mvPosition.z`).
 */
interface DrawTriangle {
  sa: [number, number, number, number];
  sb: [number, number, number, number];
  sc: [number, number, number, number];
  /** FOG_STEPS × RGB, already tone-mapped and sRGB-encoded. */
  lut: Uint8ClampedArray;
}

interface DrawLine {
  p0: [number, number, number, number];
  p1: [number, number, number, number];
  lut: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------
// Colour pipeline

/** Linear → sRGB transfer function. */
function encodeSRGB(value: number): number {
  const c = value <= 0 ? 0 : value >= 1 ? 1 : value;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Narkowicz ACES filmic approximation, matching three's ACESFilmicToneMapping. */
function acesToneMap(value: number, exposure: number): number {
  const x = Math.max(value * exposure, 0);
  const a = x * (2.51 * x + 0.03);
  const b = x * (2.43 * x + 0.59) + 0.14;
  return Math.min(Math.max(a / b, 0), 1);
}

/** Linear RGB → displayable sRGB byte. */
function toSRGBByte(linear: number, exposure: number): number {
  return Math.round(encodeSRGB(acesToneMap(linear, exposure)) * 255);
}

// ---------------------------------------------------------------------------
// PNG encoding

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

export function encodePNG(width: number, height: number, rgb: Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter type: none
    offset += 1;
    for (let x = 0; x < width * 3; x += 1) {
      raw[offset + x] = rgb[y * width * 3 + x]!;
    }
    offset += width * 3;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Rasterisation

/**
 * Frustum planes in homogeneous clip space, as `[a, b, c, d]` where a point is
 * inside when `a·x + b·y + c·z + d·w >= 0`. Covers near, far, left, right,
 * bottom and top.
 */
const FRUSTUM_PLANES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 1, 1], // near:  z + w >= 0
  [0, 0, -1, 1], // far:   w - z >= 0
  [1, 0, 0, 1], // left:  x + w >= 0
  [-1, 0, 0, 1], // right: w - x >= 0
  [0, 1, 0, 1], // bottom y + w >= 0
  [0, -1, 0, 1], // top:   w - y >= 0
];

/** Planes a line segment is clipped against before projection. */
const SEGMENT_PLANES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 1, 1], // near: z + w >= 0
  [0, 0, -1, 1], // far:  w - z >= 0
];

/** Signed distance of a homogeneous point from a clip plane. */
function planeDistance(
  v: THREE.Vector4,
  plane: readonly [number, number, number, number],
): number {
  return plane[0] * v.x + plane[1] * v.y + plane[2] * v.z + plane[3] * v.w;
}

/** Clips a segment against one plane; returns null if it is fully outside. */
function clipSegment(
  c0: THREE.Vector4,
  c1: THREE.Vector4,
  plane: readonly [number, number, number, number],
): [THREE.Vector4, THREE.Vector4] | null {
  const d0 = planeDistance(c0, plane);
  const d1 = planeDistance(c1, plane);
  if (d0 >= 0 && d1 >= 0) return [c0, c1];
  if (d0 < 0 && d1 < 0) return null;
  const t = d0 / (d0 - d1);
  const p = new THREE.Vector4(
    c0.x + (c1.x - c0.x) * t,
    c0.y + (c1.y - c0.y) * t,
    c0.z + (c1.z - c0.z) * t,
    c0.w + (c1.w - c0.w) * t,
  );
  return d0 >= 0 ? [c0, p] : [p, c1];
}

/**
 * Liang–Barsky clip of a projected segment to the viewport.
 *
 * Essential for the 400 m grid lines: once near-clipped they can project to
 * coordinates millions of pixels away, and an unclipped rasteriser would walk
 * every one of them.
 */
function clipLineToViewport(
  p0: [number, number, number, number],
  p1: [number, number, number, number],
  width: number,
  height: number,
): [[number, number, number, number], [number, number, number, number]] | null {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  let t0 = 0;
  let t1 = 1;

  const edges: ReadonlyArray<readonly [number, number]> = [
    [-dx, p0[0]],
    [dx, width - p0[0]],
    [-dy, p0[1]],
    [dy, height - p0[1]],
  ];

  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }

  const at = (t: number): [number, number, number, number] => [
    p0[0] + dx * t,
    p0[1] + dy * t,
    p0[2] + (p1[2] - p0[2]) * t,
    p0[3] + (p1[3] - p0[3]) * t,
  ];
  return [at(t0), at(t1)];
}

/** Sutherland–Hodgman clip of a convex polygon against one plane. */
function clipPolygon(
  polygon: readonly THREE.Vector4[],
  plane: readonly [number, number, number, number],
): THREE.Vector4[] {
  if (polygon.length === 0) return [];
  const distance = (v: THREE.Vector4): number =>
    plane[0] * v.x + plane[1] * v.y + plane[2] * v.z + plane[3] * v.w;

  const output: THREE.Vector4[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const da = distance(a);
    const db = distance(b);
    const aInside = da >= 0;
    const bInside = db >= 0;

    if (aInside) output.push(a);
    if (aInside !== bInside) {
      const t = da / (da - db);
      output.push(
        new THREE.Vector4(
          a.x + (b.x - a.x) * t,
          a.y + (b.y - a.y) * t,
          a.z + (b.z - a.z) * t,
          a.w + (b.w - a.w) * t,
        ),
      );
    }
  }
  return output;
}

function drawTriangle(fb: Framebuffer, tri: DrawTriangle, hasFog: boolean, fogNear: number, fogSpan: number): void {
  const [ax, ay] = tri.sa;
  const [bx, by] = tri.sb;
  const [cx, cy] = tri.sc;

  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(fb.width - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(fb.height - 1, Math.ceil(Math.max(ay, by, cy)));
  if (minX > maxX || minY > maxY) return;

  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);

  const area = orient(ax, ay, bx, by, cx, cy);
  if (Math.abs(area) < 1e-9) return;

  for (let y = minY; y <= maxY; y += 1) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;

      const w0 = orient(bx, by, cx, cy, px, py);
      const w1 = orient(cx, cy, ax, ay, px, py);
      const w2 = orient(ax, ay, bx, by, px, py);

      const positive = w0 >= 0 && w1 >= 0 && w2 >= 0;
      const negative = w0 <= 0 && w1 <= 0 && w2 <= 0;
      if (!positive && !negative) continue;

      const sum = w0 + w1 + w2;
      if (sum === 0) continue;
      const l0 = w0 / sum;
      const l1 = w1 / sum;
      const l2 = w2 / sum;

      const z = l0 * tri.sa[2] + l1 * tri.sb[2] + l2 * tri.sc[2];
      const index = y * fb.width + x;
      if (z >= fb.depth[index]!) continue;

      fb.depth[index] = z;

      // Perspective-correct view depth, then fog — per pixel, because the
      // ground plane spans 400 m with only four vertices.
      let fog = 0;
      if (hasFog) {
        const invW = l0 * tri.sa[3] + l1 * tri.sb[3] + l2 * tri.sc[3];
        const viewDepth = invW > 1e-12 ? 1 / invW : 1e12;
        fog = (viewDepth - fogNear) / fogSpan;
        if (fog < 0) fog = 0;
        else if (fog > 1) fog = 1;
      }

      let step = Math.round(fog * (FOG_STEPS - 1));
      if (step < 0) step = 0;
      else if (step >= FOG_STEPS) step = FOG_STEPS - 1;
      const lutIndex = step * 3;

      const o = index * 3;
      fb.color[o] = tri.lut[lutIndex]!;
      fb.color[o + 1] = tri.lut[lutIndex + 1]!;
      fb.color[o + 2] = tri.lut[lutIndex + 2]!;
    }
  }
}

function drawLine(
  fb: Framebuffer,
  line: DrawLine,
  hasFog: boolean,
  fogNear: number,
  fogSpan: number,
): void {
  let [x0, y0] = line.p0;
  const [x1, y1] = line.p1;
  const z0 = line.p0[2];
  const z1 = line.p1[2];
  const invW0 = line.p0[3];
  const invW1 = line.p1[3];

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  const steps = Math.max(1, Math.ceil(Math.max(dx, dy)));

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const z = z0 + (z1 - z0) * t;
    const ix = Math.round(x0);
    const iy = Math.round(y0);
    if (ix >= 0 && ix < fb.width && iy >= 0 && iy < fb.height) {
      const index = iy * fb.width + ix;
      if (z < fb.depth[index]!) {
        fb.depth[index] = z - 1e-5;

        let fog = 0;
        if (hasFog) {
          const invW = invW0 + (invW1 - invW0) * t;
          const viewDepth = invW > 1e-12 ? 1 / invW : 1e12;
          fog = THREE.MathUtils.clamp((viewDepth - fogNear) / fogSpan, 0, 1);
        }
        let step = Math.round(fog * (FOG_STEPS - 1));
        if (step < 0) step = 0;
        else if (step >= FOG_STEPS) step = FOG_STEPS - 1;

        const o = index * 3;
        fb.color[o] = line.lut[step * 3]!;
        fb.color[o + 1] = line.lut[step * 3 + 1]!;
        fb.color[o + 2] = line.lut[step * 3 + 2]!;
      }
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// ---------------------------------------------------------------------------
// Scene → draw commands

interface Lighting {
  direction: THREE.Vector3;
  intensity: number;
  /** Hemisphere sky colour — an up-facing normal receives this in full. */
  sky: THREE.Color;
  /** Hemisphere ground colour — a down-facing normal receives this in full. */
  ground: THREE.Color;
  hemiIntensity: number;
}

function readLighting(scene: THREE.Scene): Lighting {
  let direction = new THREE.Vector3(0.5, 0.8, 0.4).normalize();
  let intensity = 1;
  let sky = new THREE.Color(0x404040);
  let ground = new THREE.Color(0x404040);
  let hemiIntensity = 1;

  scene.traverse((object) => {
    const light = object as THREE.Light;
    if ((light as THREE.DirectionalLight).isDirectionalLight) {
      const worldPosition = light.getWorldPosition(new THREE.Vector3());
      const target = (light as THREE.DirectionalLight).target;
      const targetPosition = target
        ? target.getWorldPosition(new THREE.Vector3())
        : new THREE.Vector3();
      direction = worldPosition.sub(targetPosition).normalize();
      intensity = light.intensity;
    } else if ((light as THREE.HemisphereLight).isHemisphereLight) {
      const hemi = light as THREE.HemisphereLight;
      sky = new THREE.Color().copy(hemi.color);
      ground = new THREE.Color().copy(hemi.groundColor);
      hemiIntensity = hemi.intensity;
    }
  });

  return { direction, intensity, sky, ground, hemiIntensity };
}

function materialColor(material: THREE.Material): THREE.Color {
  const withColor = material as THREE.Material & { color?: THREE.Color };
  return withColor.color ? new THREE.Color().copy(withColor.color) : new THREE.Color(0xffffff);
}

function materialEmissive(material: THREE.Material): THREE.Color {
  const withEmissive = material as THREE.MeshStandardMaterial;
  return withEmissive.emissive
    ? new THREE.Color().copy(withEmissive.emissive)
    : new THREE.Color(0x000000);
}

export function renderScene(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  options: RenderOptions,
): Buffer {
  const samples = options.samples ?? 2;
  const exposure = options.exposure ?? 1.05;
  const width = options.width * samples;
  const height = options.height * samples;
  const fb: Framebuffer = {
    width,
    height,
    color: new Uint8ClampedArray(width * height * 3),
    depth: new Float32Array(width * height).fill(Infinity),
  };

  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  // Background: sRGB-encoded but not tone-mapped, matching three's clear colour.
  const background = scene.background instanceof THREE.Color ? scene.background : new THREE.Color(0);
  const bgR = Math.round(encodeSRGB(background.r) * 255);
  const bgG = Math.round(encodeSRGB(background.g) * 255);
  const bgB = Math.round(encodeSRGB(background.b) * 255);
  for (let i = 0; i < width * height; i += 1) {
    fb.color[i * 3] = bgR;
    fb.color[i * 3 + 1] = bgG;
    fb.color[i * 3 + 2] = bgB;
  }

  const viewProjection = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );

  const lighting = readLighting(scene);
  const fog = scene.fog instanceof THREE.Fog ? scene.fog : null;
  const fogColor = fog ? fog.color : background;
  const fogSpan = fog ? Math.max(fog.far - fog.near, 1e-3) : 1;

  // three divides Lambert diffuse by PI (BRDF_Lambert), so must we.
  const directScale = lighting.intensity / Math.PI;
  const hemiScale = lighting.hemiIntensity / Math.PI;

  const worldA = new THREE.Vector3();
  const worldB = new THREE.Vector3();
  const worldC = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const rotation = new THREE.Matrix4();
  const shaded = new THREE.Color();
  const mixed = new THREE.Color();

  const buildLut = (color: THREE.Color): Uint8ClampedArray => {
    const lut = new Uint8ClampedArray(FOG_STEPS * 3);
    for (let i = 0; i < FOG_STEPS; i += 1) {
      const f = i / (FOG_STEPS - 1);
      mixed.copy(color).lerp(fogColor, f);
      lut[i * 3] = toSRGBByte(mixed.r, exposure);
      lut[i * 3 + 1] = toSRGBByte(mixed.g, exposure);
      lut[i * 3 + 2] = toSRGBByte(mixed.b, exposure);
    }
    return lut;
  };

  /** Local-space vertex → homogeneous clip space. */
  const toClip = (world: THREE.Vector3, modelMatrix: THREE.Matrix4): THREE.Vector4 =>
    new THREE.Vector4(world.x, world.y, world.z, 1)
      .applyMatrix4(modelMatrix)
      .applyMatrix4(viewProjection);

  const triangles: DrawTriangle[] = [];
  const lines: DrawLine[] = [];

  scene.traverse((object) => {
    if (!object.visible) return;
    let ancestor: THREE.Object3D | null = object.parent;
    while (ancestor) {
      if (!ancestor.visible) return;
      ancestor = ancestor.parent;
    }

    const mesh = object as THREE.Mesh;
    const lineSegments = object as THREE.LineSegments;

    if (mesh.isMesh && mesh.geometry) {
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!position) return;
      const index = geometry.getIndex();
      const count = index ? index.count : position.count;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const material = materials[0]!;
      const baseColor = materialColor(material);
      const emissive = materialEmissive(material);

      rotation.extractRotation(mesh.matrixWorld);

      for (let i = 0; i < count; i += 3) {
        const ia = index ? index.getX(i) : i;
        const ib = index ? index.getX(i + 1) : i + 1;
        const ic = index ? index.getX(i + 2) : i + 2;

        worldA.fromBufferAttribute(position, ia);
        worldB.fromBufferAttribute(position, ib);
        worldC.fromBufferAttribute(position, ic);

        // Shade once per face (flat shading), before clipping.
        edge1.copy(worldB).sub(worldA).applyMatrix4(rotation);
        edge2.copy(worldC).sub(worldA).applyMatrix4(rotation);
        faceNormal.crossVectors(edge1, edge2).normalize();

        // Two-sided: the rigs are closed, but the ground plane is not.
        const ndotl = Math.abs(faceNormal.dot(lighting.direction)) * directScale;

        // Hemisphere ambient, as three does it:
        //   weight = 0.5 * dot(N, up) + 0.5
        //   irradiance = mix(groundColor, skyColor, weight) * intensity
        // Crucially the result multiplies the albedo (`irradiance * BRDF_Lambert`,
        // where BRDF_Lambert = albedo / PI) — it is not added flat. Adding it
        // flat washes every surface toward the sky colour.
        const hemiWeight = 0.5 * Math.abs(faceNormal.y) + 0.5;
        const hemiR = (lighting.ground.r + (lighting.sky.r - lighting.ground.r) * hemiWeight) * hemiScale;
        const hemiG = (lighting.ground.g + (lighting.sky.g - lighting.ground.g) * hemiWeight) * hemiScale;
        const hemiB = (lighting.ground.b + (lighting.sky.b - lighting.ground.b) * hemiWeight) * hemiScale;

        shaded.set(
          baseColor.r * (ndotl + hemiR) + emissive.r,
          baseColor.g * (ndotl + hemiG) + emissive.g,
          baseColor.b * (ndotl + hemiB) + emissive.b,
        );
        const lut = buildLut(shaded);

        // Clip in homogeneous space, then fan-triangulate. Without this the
        // 400 m ground plane — whose corners sit behind the camera — would be
        // discarded whole.
        let polygon: THREE.Vector4[] = [
          toClip(worldA, mesh.matrixWorld),
          toClip(worldB, mesh.matrixWorld),
          toClip(worldC, mesh.matrixWorld),
        ];
        for (const plane of FRUSTUM_PLANES) {
          polygon = clipPolygon(polygon, plane);
          if (polygon.length < 3) break;
        }
        if (polygon.length < 3) continue;

        const projected = polygon.map(
          (v): [number, number, number, number] => {
            const invW = 1 / v.w;
            return [
              ((v.x * invW) * 0.5 + 0.5) * width,
              (1 - ((v.y * invW) * 0.5 + 0.5)) * height,
              v.z * invW,
              invW,
            ];
          },
        );

        for (let f = 1; f + 1 < projected.length; f += 1) {
          triangles.push({ sa: projected[0]!, sb: projected[f]!, sc: projected[f + 1]!, lut });
        }
      }
    } else if (lineSegments.isLineSegments && lineSegments.geometry) {
      const geometry = lineSegments.geometry;
      const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!position) return;
      const colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      const materials = Array.isArray(lineSegments.material)
        ? lineSegments.material
        : [lineSegments.material];
      const fallback = materialColor(materials[0]!);

      for (let i = 0; i < position.count; i += 2) {
        worldA.fromBufferAttribute(position, i);
        worldB.fromBufferAttribute(position, i + 1);

        // Grid lines span the whole 400 m plane, so they must be clipped in
        // homogeneous space (near + far) and then to the viewport — otherwise
        // a near-clipped endpoint projects millions of pixels off-screen.
        let segment: [THREE.Vector4, THREE.Vector4] | null = [
          toClip(worldA, lineSegments.matrixWorld),
          toClip(worldB, lineSegments.matrixWorld),
        ];
        for (const plane of SEGMENT_PLANES) {
          segment = segment ? clipSegment(segment[0], segment[1], plane) : null;
        }
        if (!segment) continue;

        const toScreen = (v: THREE.Vector4): [number, number, number, number] => {
          const invW = 1 / v.w;
          return [
            ((v.x * invW) * 0.5 + 0.5) * width,
            (1 - ((v.y * invW) * 0.5 + 0.5)) * height,
            v.z * invW,
            invW,
          ];
        };

        const clipped = clipLineToViewport(
          toScreen(segment[0]),
          toScreen(segment[1]),
          width,
          height,
        );
        if (!clipped) continue;
        const [p0, p1] = clipped;

        const lineColor = colorAttribute
          ? new THREE.Color().fromBufferAttribute(colorAttribute, i)
          : fallback;

        lines.push({ p0, p1, lut: buildLut(lineColor) });
      }
    }
  });

  const hasFog = fog !== null;
  const fogNear = fog ? fog.near : 0;
  for (const triangle of triangles) drawTriangle(fb, triangle, hasFog, fogNear, fogSpan);
  for (const line of lines) drawLine(fb, line, hasFog, fogNear, fogSpan);

  return encodePNG(options.width, options.height, downsample(fb, samples));
}

function downsample(fb: Framebuffer, samples: number): Uint8ClampedArray {
  if (samples === 1) return fb.color;

  const outWidth = fb.width / samples;
  const outHeight = fb.height / samples;
  const out = new Uint8ClampedArray(outWidth * outHeight * 3);
  const total = samples * samples;

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const index = ((y * samples + sy) * fb.width + (x * samples + sx)) * 3;
          r += fb.color[index]!;
          g += fb.color[index + 1]!;
          b += fb.color[index + 2]!;
        }
      }
      const o = (y * outWidth + x) * 3;
      out[o] = r / total;
      out[o + 1] = g / total;
      out[o + 2] = b / total;
    }
  }
  return out;
}
