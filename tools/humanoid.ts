/**
 * Procedural humanoid model generator.
 *
 * Builds a rigged-by-nodes character out of lofted elliptical tubes: a profile
 * of cross-sections swept along a curve. That gives tapered, organic limbs and
 * torsos rather than the capsules the prototype started with.
 *
 * The node layout deliberately matches what `src/characters/Character.ts`
 * animates: `torso`, `head`, `armLeft`, `armRight`, `legLeft`, `legRight`, each
 * positioned at its joint so rotating the node articulates the limb.
 */

import { computeNormals, type GltfMaterial, type GltfMeshInput, type GltfNodeInput } from './glb-writer';

export interface PartData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface LoftSection {
  center: [number, number, number];
  /** Semi-axis along the section's local X. */
  rx: number;
  /** Semi-axis along the section's local Z (depth). */
  rz: number;
  /** Tangent direction; defaults to +Y. */
  axis?: [number, number, number];
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Sweeps an elliptical cross-section through a list of sections, optionally
 * capping both ends with a triangle fan.
 */
export function loft(
  sections: LoftSection[],
  radialSegments: number,
  capStart = true,
  capEnd = true,
): PartData {
  const positions: number[] = [];
  const indices: number[] = [];

  const pushVertex = (x: number, y: number, z: number): number => {
    const index = positions.length / 3;
    positions.push(x, y, z);
    return index;
  };

  const ringStarts: number[] = [];

  for (const section of sections) {
    const axis = normalize({
      x: section.axis?.[0] ?? 0,
      y: section.axis?.[1] ?? 1,
      z: section.axis?.[2] ?? 0,
    });
    // Stable orthogonal frame: pick a reference that is not parallel to axis.
    const reference: Vec3 =
      Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const u = normalize(cross(reference, axis));
    const v = normalize(cross(axis, u));

    const start = positions.length / 3;
    ringStarts.push(start);

    for (let i = 0; i < radialSegments; i += 1) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      pushVertex(
        section.center[0] + u.x * section.rx * cos + v.x * section.rz * sin,
        section.center[1] + u.y * section.rx * cos + v.y * section.rz * sin,
        section.center[2] + u.z * section.rx * cos + v.z * section.rz * sin,
      );
    }
  }

  for (let s = 0; s + 1 < sections.length; s += 1) {
    const a0 = ringStarts[s]!;
    const b0 = ringStarts[s + 1]!;
    for (let i = 0; i < radialSegments; i += 1) {
      const j = (i + 1) % radialSegments;
      const a = a0 + i;
      const b = a0 + j;
      const c = b0 + i;
      const d = b0 + j;
      indices.push(a, c, b, b, c, d);
    }
  }

  const capRing = (ringStart: number, center: [number, number, number], flip: boolean): void => {
    const tip = pushVertex(center[0], center[1], center[2]);
    for (let i = 0; i < radialSegments; i += 1) {
      const j = (i + 1) % radialSegments;
      const a = ringStart + i;
      const b = ringStart + j;
      if (flip) indices.push(tip, b, a);
      else indices.push(tip, a, b);
    }
  };

  if (capStart) capRing(ringStarts[0]!, sections[0]!.center, true);
  if (capEnd) capRing(ringStarts[ringStarts.length - 1]!, sections[sections.length - 1]!.center, false);

  const positionArray = new Float32Array(positions);
  const indexArray = new Uint32Array(indices);
  return {
    positions: positionArray,
    normals: computeNormals(positionArray, indexArray),
    indices: indexArray,
  };
}

/** Builds a sphere-like blob, optionally flattened, at a centre point. */
function blob(
  center: [number, number, number],
  radius: number,
  scaleY: number,
  scaleZ: number,
  segments = 14,
): PartData {
  const sections: LoftSection[] = [];
  const rings = 8;
  for (let i = 0; i <= rings; i += 1) {
    const t = i / rings;
    const phi = t * Math.PI;
    const r = Math.sin(phi) * radius;
    sections.push({
      center: [center[0], center[1] + (-Math.cos(phi)) * radius * scaleY, center[2]],
      rx: Math.max(r, 1e-4),
      rz: Math.max(r * scaleZ, 1e-4),
    });
  }
  return loft(sections, segments, true, true);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------

export type HairStyle = 'long' | 'short';
export type Outfit = 'skirt' | 'vest';

export interface HumanoidOptions {
  id: string;
  /** Total standing height in metres, crown to sole. */
  height: number;
  /** >1 stockier, <1 slimmer. Scales widths, not lengths. */
  build: number;
  hair: HairStyle;
  outfit: Outfit;
  material: {
    skin: number;
    hair: number;
    cloth: number;
    accent: number;
    trim: number;
    eye: number;
  };
}

export interface HumanoidModel {
  meshes: GltfMeshInput[];
  nodes: GltfNodeInput[];
  materials: GltfMaterial[];
  /** Hip joint height in metres — used by the runtime for the leg pivots. */
  hipY: number;
}

/** sRGB hex → linear RGBA, which is what glTF baseColorFactor expects. */
function srgbToLinear(hex: number): [number, number, number, number] {
  const toLinear = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return [toLinear(r), toLinear(g), toLinear(b), 1];
}

export function buildHumanoid(options: HumanoidOptions): HumanoidModel {
  const H = options.height;
  const build = options.build;
  const mat = options.material;

  // --- Proportions (fractions of total height) ------------------------------
  const legLength = 0.455 * H; // hip → ankle
  const ankleHeight = 0.027 * H; // ankle → sole
  const torsoLength = 0.3 * H; // hip → shoulder
  const neckLength = 0.085 * H; // shoulder → chin
  const headHeight = 0.133 * H; // chin → crown

  const hipY = legLength + ankleHeight;
  const shoulderY = hipY + torsoLength;
  const chinY = shoulderY + neckLength;

  const hipHalf = 0.082 * H * build;
  const waistHalf = 0.072 * H * build;
  const chestHalf = 0.088 * H * build;
  const shoulderHalf = 0.098 * H * build;
  const neckHalf = 0.033 * H * build;

  const materials: GltfMaterial[] = [
    { name: 'skin', baseColor: srgbToLinear(mat.skin), roughness: 0.72, metallic: 0 },
    { name: 'hair', baseColor: srgbToLinear(mat.hair), roughness: 0.58, metallic: 0 },
    { name: 'cloth', baseColor: srgbToLinear(mat.cloth), roughness: 0.68, metallic: 0 },
    { name: 'accent', baseColor: srgbToLinear(mat.accent), roughness: 0.45, metallic: 0.05 },
    { name: 'trim', baseColor: srgbToLinear(mat.trim), roughness: 0.35, metallic: 0.25 },
    { name: 'eye', baseColor: srgbToLinear(mat.eye), roughness: 0.2, metallic: 0 },
  ];
  const SKIN = 0;
  const HAIR = 1;
  const CLOTH = 2;
  const ACCENT = 3;
  const TRIM = 4;
  const EYE = 5;

  const meshes: GltfMeshInput[] = [];
  const nodes: GltfNodeInput[] = [];

  const addMesh = (name: string, parts: Array<{ part: PartData; material: number }>): number => {
    meshes.push({
      name,
      primitives: parts.map(({ part, material }) => ({
        positions: part.positions,
        normals: part.normals,
        indices: part.indices,
        material,
      })),
    });
    return meshes.length - 1;
  };

  // --- Torso ---------------------------------------------------------------
  const torsoSections: LoftSection[] = [
    { center: [0, 0, 0], rx: hipHalf, rz: hipHalf * 0.7 },
    { center: [0, torsoLength * 0.2, 0.004 * H], rx: waistHalf, rz: waistHalf * 0.66 },
    { center: [0, torsoLength * 0.45, 0.008 * H], rx: chestHalf, rz: chestHalf * 0.7 },
    { center: [0, torsoLength * 0.72, 0.004 * H], rx: shoulderHalf * 0.98, rz: shoulderHalf * 0.66 },
    { center: [0, torsoLength * 0.92, 0], rx: shoulderHalf * 0.82, rz: shoulderHalf * 0.6 },
    { center: [0, torsoLength, 0], rx: neckHalf * 1.25, rz: neckHalf * 1.15 },
  ];
  const torsoPart = loft(torsoSections, 20, true, false);

  const torsoExtras: Array<{ part: PartData; material: number }> = [{ part: torsoPart, material: CLOTH }];

  if (options.outfit === 'vest') {
    // A slightly larger shell over the chest reads as a vest/jerkin.
    const vestSections = torsoSections
      .filter((_, i) => i >= 1 && i <= 4)
      .map((s) => ({
        center: s.center,
        rx: s.rx * 1.09,
        rz: s.rz * 1.11,
      }));
    torsoExtras.push({ part: loft(vestSections, 20, false, false), material: ACCENT });

    // Shoulder pads.
    const padY = torsoLength * 0.9;
    for (const side of [-1, 1]) {
      torsoExtras.push({
        part: blob([side * shoulderHalf * 0.92, padY, 0], shoulderHalf * 0.42, 0.62, 1.0, 12),
        material: TRIM,
      });
    }
  }

  if (options.outfit === 'skirt') {
    // Skirt hangs from the waist to below the hip, as a child of the torso node.
    const skirtTop = torsoLength * 0.34;
    const skirtBottom = -0.16 * H;
    torsoExtras.push({
      part: loft(
        [
          { center: [0, skirtTop, 0], rx: waistHalf * 1.12, rz: waistHalf * 0.82 },
          { center: [0, lerp(skirtTop, skirtBottom, 0.5), 0.004 * H], rx: waistHalf * 1.5, rz: waistHalf * 1.12 },
          { center: [0, skirtBottom, 0.008 * H], rx: waistHalf * 1.78, rz: waistHalf * 1.34 },
        ],
        20,
        false,
        true,
      ),
      material: CLOTH,
    });
    // Hem band.
    torsoExtras.push({
      part: loft(
        [
          { center: [0, skirtBottom + 0.012 * H, 0.008 * H], rx: waistHalf * 1.76, rz: waistHalf * 1.32 },
          { center: [0, skirtBottom, 0.008 * H], rx: waistHalf * 1.8, rz: waistHalf * 1.36 },
        ],
        20,
        false,
        false,
      ),
      material: ACCENT,
    });
  }

  if (options.hair === 'long') {
    // Scarf: a ring at the neck plus a tail down the back.
    const scarfY = torsoLength * 1.0;
    torsoExtras.push({
      part: loft(
        [
          { center: [0, scarfY + 0.02 * H, 0], rx: neckHalf * 1.5, rz: neckHalf * 1.35 },
          { center: [0, scarfY - 0.01 * H, 0], rx: neckHalf * 1.62, rz: neckHalf * 1.45 },
        ],
        16,
        true,
        true,
      ),
      material: ACCENT,
    });
    torsoExtras.push({
      part: loft(
        [
          { center: [0.03 * H, scarfY, -neckHalf * 1.1], rx: 0.022 * H, rz: 0.02 * H },
          { center: [0.035 * H, scarfY - torsoLength * 0.3, -neckHalf * 1.5], rx: 0.03 * H, rz: 0.016 * H },
          { center: [0.02 * H, scarfY - torsoLength * 0.62, -neckHalf * 1.9], rx: 0.026 * H, rz: 0.012 * H },
        ],
        10,
        true,
        true,
      ),
      material: ACCENT,
    });
  }

  const torsoMesh = addMesh('torso', torsoExtras);

  // --- Head ----------------------------------------------------------------
  const headNodeY = shoulderY + neckLength * 0.4;
  const neckBottomLocal = shoulderY - headNodeY - 0.01 * H;
  const crownLocal = chinY + headHeight - headNodeY;
  const headR = 0.072 * H;

  const headSections: LoftSection[] = [
    { center: [0, neckBottomLocal, 0], rx: neckHalf, rz: neckHalf * 0.92 },
    { center: [0, neckBottomLocal + neckLength * 0.45, 0], rx: neckHalf * 0.98, rz: neckHalf * 0.9 },
    // Jaw
    { center: [0, -0.02 * H, 0.004 * H], rx: headR * 0.72, rz: headR * 0.8 },
    { center: [0, headHeight * 0.16, 0.008 * H], rx: headR * 0.94, rz: headR * 0.98 },
    // Cheeks / cranium
    { center: [0, headHeight * 0.4, 0.006 * H], rx: headR, rz: headR * 1.02 },
    { center: [0, headHeight * 0.63, 0.002 * H], rx: headR * 0.95, rz: headR * 0.98 },
    { center: [0, headHeight * 0.84, -0.002 * H], rx: headR * 0.72, rz: headR * 0.74 },
    { center: [0, crownLocal, -0.004 * H], rx: headR * 0.3, rz: headR * 0.32 },
  ];
  const headParts: Array<{ part: PartData; material: number }> = [
    { part: loft(headSections, 20, true, true), material: SKIN },
  ];

  // Eyes sit on the face plane (+Z) slightly inset.
  const eyeY = headHeight * 0.42;
  const eyeZ = headR * 0.86;
  const eyeX = headR * 0.38;
  for (const side of [-1, 1]) {
    headParts.push({
      part: blob([side * eyeX, eyeY, eyeZ], headR * 0.17, 1.25, 0.55, 12),
      material: EYE,
    });
  }

  // --- Hair ----------------------------------------------------------------
  const hairR = headR * 1.1;
  const hairBase: LoftSection[] = [
    { center: [0, headHeight * 0.1, -0.004 * H], rx: hairR * 0.86, rz: hairR * 0.9 },
    { center: [0, headHeight * 0.36, 0.0], rx: hairR * 1.06, rz: hairR * 1.08 },
    { center: [0, headHeight * 0.62, -0.004 * H], rx: hairR * 1.04, rz: hairR * 1.06 },
    { center: [0, headHeight * 0.86, -0.008 * H], rx: hairR * 0.78, rz: hairR * 0.8 },
    { center: [0, crownLocal + headHeight * 0.02, -0.01 * H], rx: hairR * 0.34, rz: hairR * 0.36 },
  ];
  headParts.push({ part: loft(hairBase, 20, true, true), material: HAIR });

  // Fringe: a wedge over the brow.
  headParts.push({
    part: loft(
      [
        { center: [0, headHeight * 0.72, hairR * 0.72], rx: hairR * 0.9, rz: hairR * 0.34 },
        { center: [0, headHeight * 0.5, hairR * 0.88], rx: hairR * 0.86, rz: hairR * 0.3 },
        { center: [0, headHeight * 0.34, hairR * 0.8], rx: hairR * 0.62, rz: hairR * 0.26 },
      ],
      14,
      true,
      true,
    ),
    material: HAIR,
  });

  if (options.hair === 'long') {
    // Two side locks plus a back mane, hanging past the shoulders.
    for (const side of [-1, 1]) {
      headParts.push({
        part: loft(
          [
            { center: [side * hairR * 0.86, headHeight * 0.52, hairR * 0.1], rx: hairR * 0.34, rz: hairR * 0.36 },
            { center: [side * hairR * 0.98, headHeight * 0.05, hairR * 0.02], rx: hairR * 0.36, rz: hairR * 0.38 },
            { center: [side * hairR * 1.02, -neckLength * 0.6, -hairR * 0.1], rx: hairR * 0.3, rz: hairR * 0.32 },
            { center: [side * hairR * 0.96, -neckLength * 1.5, -hairR * 0.24], rx: hairR * 0.24, rz: hairR * 0.26 },
          ],
          12,
          true,
          true,
        ),
        material: HAIR,
      });
    }
    headParts.push({
      part: loft(
        [
          { center: [0, headHeight * 0.5, -hairR * 0.86], rx: hairR * 0.9, rz: hairR * 0.3 },
          { center: [0, headHeight * 0.1, -hairR * 1.0], rx: hairR * 0.86, rz: hairR * 0.3 },
          { center: [0, -neckLength * 0.8, -hairR * 1.06], rx: hairR * 0.78, rz: hairR * 0.3 },
          { center: [0, -neckLength * 1.7, -hairR * 1.0], rx: hairR * 0.6, rz: hairR * 0.26 },
        ],
        16,
        true,
        true,
      ),
      material: HAIR,
    });
  } else {
    // Short, spiked crown.
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      const r = hairR * 0.5;
      headParts.push({
        part: loft(
          [
            { center: [Math.sin(a) * r, headHeight * 0.8, Math.cos(a) * r * 0.6], rx: hairR * 0.3, rz: hairR * 0.3 },
            {
              center: [Math.sin(a) * r * 1.25, headHeight * 1.06, Math.cos(a) * r * 0.7],
              rx: hairR * 0.08,
              rz: hairR * 0.08,
            },
          ],
          8,
          true,
          true,
        ),
        material: HAIR,
      });
    }
  }

  const headMesh = addMesh('head', headParts);

  // --- Arms ----------------------------------------------------------------
  const armLength = 0.33 * H;
  const armSections: LoftSection[] = [
    { center: [0, 0, 0], rx: 0.048 * H * build, rz: 0.05 * H * build },
    { center: [0.006 * H, -armLength * 0.45, 0.008 * H], rx: 0.04 * H * build, rz: 0.042 * H * build },
    { center: [0.012 * H, -armLength * 0.78, 0.016 * H], rx: 0.034 * H * build, rz: 0.036 * H * build },
    { center: [0.016 * H, -armLength, 0.022 * H], rx: 0.028 * H * build, rz: 0.03 * H * build },
  ];
  const armPart = loft(armSections, 14, true, false);

  // Hand: a flattened blob below the wrist.
  const handPart = loft(
    [
      { center: [0.016 * H, -armLength, 0.022 * H], rx: 0.03 * H * build, rz: 0.032 * H * build },
      { center: [0.018 * H, -armLength - 0.045 * H, 0.03 * H], rx: 0.032 * H * build, rz: 0.019 * H * build },
      { center: [0.018 * H, -armLength - 0.085 * H, 0.032 * H], rx: 0.024 * H * build, rz: 0.013 * H * build },
    ],
    12,
    false,
    true,
  );
  const armMesh = addMesh('arm', [
    { part: armPart, material: SKIN },
    { part: handPart, material: SKIN },
  ]);

  // --- Legs ----------------------------------------------------------------
  const legSections: LoftSection[] = [
    { center: [0, 0, 0], rx: hipHalf * 0.46, rz: hipHalf * 0.48 },
    { center: [0, -legLength * 0.3, 0.004 * H], rx: hipHalf * 0.38, rz: hipHalf * 0.4 },
    { center: [0, -legLength * 0.52, 0.002 * H], rx: hipHalf * 0.32, rz: hipHalf * 0.34 },
    { center: [0, -legLength * 0.72, -0.004 * H], rx: hipHalf * 0.34, rz: hipHalf * 0.36 },
    { center: [0, -legLength, -0.002 * H], rx: hipHalf * 0.22, rz: hipHalf * 0.24 },
  ];
  const legPart = loft(legSections, 14, true, false);

  // Foot: swept forward along +Z. With axis +Z the loft frame puts `rz` on Y,
  // so each section's centre sits exactly `rz` above the sole — which keeps the
  // sole on the ground plane instead of punching through it.
  const soleLocal = -hipY; // absolute y = 0
  const footPart = loft(
    [
      { center: [0, soleLocal + 0.026 * H, -0.032 * H], rx: 0.03 * H, rz: 0.026 * H, axis: [0, 0, 1] },
      { center: [0, soleLocal + 0.024 * H, 0.002 * H], rx: 0.034 * H, rz: 0.024 * H, axis: [0, 0, 1] },
      { center: [0, soleLocal + 0.024 * H, 0.055 * H], rx: 0.035 * H, rz: 0.024 * H, axis: [0, 0, 1] },
      { center: [0, soleLocal + 0.02 * H, 0.105 * H], rx: 0.029 * H, rz: 0.02 * H, axis: [0, 0, 1] },
    ],
    12,
    true,
    true,
  );

  const legParts: Array<{ part: PartData; material: number }> = [
    { part: legPart, material: options.outfit === 'vest' ? CLOTH : SKIN },
    { part: footPart, material: options.outfit === 'vest' ? TRIM : ACCENT },
  ];

  if (options.outfit === 'vest') {
    // Boot cuff over the lower leg.
    legParts.push({
      part: loft(
        [
          { center: [0, -legLength * 0.62, -0.002 * H], rx: hipHalf * 0.38, rz: hipHalf * 0.4 },
          { center: [0, -legLength * 0.82, -0.004 * H], rx: hipHalf * 0.36, rz: hipHalf * 0.38 },
          { center: [0, -legLength * 0.99, -0.002 * H], rx: hipHalf * 0.33, rz: hipHalf * 0.35 },
        ],
        14,
        false,
        false,
      ),
      material: TRIM,
    });
  }

  const legMesh = addMesh('leg', legParts);

  // --- Node hierarchy ------------------------------------------------------
  const hipX = hipHalf * 0.5;
  const shoulderX = shoulderHalf * 0.86;
  const shoulderDrop = 0.028 * H;

  // Root first: the writer always exports scene node 0.
  const rootIndex = 0;
  nodes.push({ name: 'root', children: [] });
  void rootIndex;

  const legLeftIndex = nodes.length;
  nodes.push({ name: 'legLeft', translation: [-hipX, hipY, 0], mesh: legMesh, children: [] });

  const legRightIndex = nodes.length;
  nodes.push({ name: 'legRight', translation: [hipX, hipY, 0], mesh: legMesh, children: [] });

  const torsoIndex = nodes.length;
  nodes.push({ name: 'torso', translation: [0, hipY, 0], mesh: torsoMesh, children: [] });

  const armLeftIndex = nodes.length;
  nodes.push({
    name: 'armLeft',
    translation: [-shoulderX, shoulderY - shoulderDrop - hipY, 0],
    mesh: armMesh,
    children: [],
  });

  const armRightIndex = nodes.length;
  nodes.push({
    name: 'armRight',
    translation: [shoulderX, shoulderY - shoulderDrop - hipY, 0],
    mesh: armMesh,
    children: [],
  });

  const headIndex = nodes.length;
  nodes.push({ name: 'head', translation: [0, headNodeY - hipY, 0], mesh: headMesh, children: [] });

  // Arms and head ride on the torso so a lean carries them with it.
  nodes[torsoIndex]!.children = [armLeftIndex, armRightIndex, headIndex];
  nodes[0]!.children = [legLeftIndex, legRightIndex, torsoIndex];

  // Normalise: scale the rig so it is exactly `height` tall with its soles on
  // y = 0. Designing above is approximate (hair overshoots the crown, limb
  // radii vary); this makes the contract exact for the runtime.
  normalizeToHeight(meshes, nodes, H);

  return { meshes, nodes, materials, hipY };
}

/** Accumulated translation of a node, following the parent chain. */
function accumulatedTranslation(
  nodes: GltfNodeInput[],
  index: number,
  parentOf: Map<number, number>,
): [number, number, number] {
  const self = nodes[index]!.translation ?? [0, 0, 0];
  const parent = parentOf.get(index);
  if (parent === undefined) return [...self] as [number, number, number];
  const base = accumulatedTranslation(nodes, parent, parentOf);
  return [base[0] + self[0], base[1] + self[1], base[2] + self[2]];
}

function normalizeToHeight(
  meshes: GltfMeshInput[],
  nodes: GltfNodeInput[],
  targetHeight: number,
): void {
  const parentOf = new Map<number, number>();
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) parentOf.set(child, index);
  });

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  nodes.forEach((node, index) => {
    if (node.mesh === undefined) return;
    const t = accumulatedTranslation(nodes, index, parentOf);
    for (const primitive of meshes[node.mesh]!.primitives) {
      const { positions } = primitive;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]! + t[0];
        const y = positions[i + 1]! + t[1];
        const z = positions[i + 2]! + t[2];
        min[0] = Math.min(min[0], x);
        min[1] = Math.min(min[1], y);
        min[2] = Math.min(min[2], z);
        max[0] = Math.max(max[0], x);
        max[1] = Math.max(max[1], y);
        max[2] = Math.max(max[2], z);
      }
    }
  });

  const measured = max[1] - min[1];
  if (!(measured > 1e-6)) return;
  const scale = targetHeight / measured;
  nodes[0]!.scale = [scale, scale, scale];
  nodes[0]!.translation = [0, -min[1] * scale, 0];
}
