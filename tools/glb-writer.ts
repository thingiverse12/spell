/**
 * Minimal glTF 2.0 / GLB writer.
 *
 * Exports triangle meshes with normals and per-primitive materials into a
 * binary GLB. Enough for the character models — no textures, no skinning, no
 * morph targets.
 */

const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

export interface GltfMaterial {
  name: string;
  /** Linear RGBA. glTF stores base colour in linear space. */
  baseColor: [number, number, number, number];
  metallic?: number;
  roughness?: number;
  doubleSided?: boolean;
}

export interface GltfPrimitiveInput {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  material: number;
}

export interface GltfMeshInput {
  name: string;
  primitives: GltfPrimitiveInput[];
}

export interface GltfNodeInput {
  name: string;
  mesh?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: number[];
}

interface Accessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: 'VEC3' | 'SCALAR';
  min?: number[];
  max?: number[];
}

interface BufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target?: number;
}

interface JsonChunk {
  asset: { version: string; generator: string };
  scene: number;
  scenes: Array<{ nodes: number[] }>;
  nodes: GltfNodeInput[];
  meshes: Array<{ name: string; primitives: Array<{ attributes: { POSITION: number; NORMAL: number }; indices: number; material: number }> }>;
  materials: Array<{
    name: string;
    pbrMetallicRoughness: {
      baseColorFactor: [number, number, number, number];
      metallicFactor: number;
      roughnessFactor: number;
    };
    doubleSided: boolean;
  }>;
  accessors: Accessor[];
  bufferViews: BufferView[];
  buffers: Array<{ byteLength: number }>;
}

function pad4(value: number): number {
  return (4 - (value % 4)) % 4;
}

/** Computes smooth vertex normals by accumulating face normals. */
export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  const vertexCount = positions.length / 3;

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;

    const abx = positions[b]! - positions[a]!;
    const aby = positions[b + 1]! - positions[a + 1]!;
    const abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!;
    const acy = positions[c + 1]! - positions[a + 1]!;
    const acz = positions[c + 2]! - positions[a + 2]!;

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    normals[a]! += nx;
    normals[a + 1]! += ny;
    normals[a + 2]! += nz;
    normals[b]! += nx;
    normals[b + 1]! += ny;
    normals[b + 2]! += nz;
    normals[c]! += nx;
    normals[c + 1]! += ny;
    normals[c + 2]! += nz;
  }

  for (let i = 0; i < vertexCount; i += 1) {
    const x = normals[i * 3]!;
    const y = normals[i * 3 + 1]!;
    const z = normals[i * 3 + 2]!;
    const length = Math.hypot(x, y, z);
    if (length > 1e-12) {
      normals[i * 3] = x / length;
      normals[i * 3 + 1] = y / length;
      normals[i * 3 + 2] = z / length;
    } else {
      normals[i * 3 + 1] = 1;
    }
  }

  return normals;
}

export function writeGlb(
  meshes: GltfMeshInput[],
  nodes: GltfNodeInput[],
  materials: GltfMaterial[],
  generator = 'spell/tools/glb-writer',
): Buffer {
  const chunks: Buffer[] = [];
  const bufferViews: BufferView[] = [];
  const accessors: Accessor[] = [];
  let byteLength = 0;

  const append = (buffer: Buffer, target: number, componentType: number, type: 'VEC3' | 'SCALAR', components: number): number => {
    // Align to 4 bytes, as glTF requires for accessor offsets.
    const padding = pad4(byteLength);
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
      byteLength += padding;
    }
    const byteOffset = byteLength;
    chunks.push(buffer);
    byteLength += buffer.length;

    bufferViews.push({ buffer: 0, byteOffset, byteLength: buffer.length, target });
    const viewIndex = bufferViews.length - 1;

    let min: number[] | undefined;
    let max: number[] | undefined;
    if (type === 'VEC3' && componentType === FLOAT) {
      const count = buffer.length / 12;
      min = [Infinity, Infinity, Infinity];
      max = [-Infinity, -Infinity, -Infinity];
      const floats = new Float32Array(buffer.buffer, buffer.byteOffset, count * 3);
      for (let i = 0; i < count; i += 1) {
        for (let c = 0; c < 3; c += 1) {
          const v = floats[i * 3 + c]!;
          min[c] = Math.min(min[c]!, v);
          max[c] = Math.max(max[c]!, v);
        }
      }
    }

    const accessor: Accessor = {
      bufferView: viewIndex,
      componentType,
      count: buffer.length / 4 / components,
      type,
    };
    if (min && max) {
      accessor.min = min;
      accessor.max = max;
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };

  const jsonMeshes = meshes.map((mesh) => ({
    name: mesh.name,
    primitives: mesh.primitives.map((primitive) => {
      const positionAccessor = append(
        Buffer.from(primitive.positions.buffer, primitive.positions.byteOffset, primitive.positions.byteLength),
        ARRAY_BUFFER,
        FLOAT,
        'VEC3',
        3,
      );
      const normalAccessor = append(
        Buffer.from(primitive.normals.buffer, primitive.normals.byteOffset, primitive.normals.byteLength),
        ARRAY_BUFFER,
        FLOAT,
        'VEC3',
        3,
      );
      const indexAccessor = append(
        Buffer.from(primitive.indices.buffer, primitive.indices.byteOffset, primitive.indices.byteLength),
        ELEMENT_ARRAY_BUFFER,
        UNSIGNED_INT,
        'SCALAR',
        1,
      );
      return {
        attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
        indices: indexAccessor,
        material: primitive.material,
      };
    }),
  }));

  const json: JsonChunk = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: jsonMeshes,
    materials: materials.map((material) => ({
      name: material.name,
      pbrMetallicRoughness: {
        baseColorFactor: material.baseColor,
        metallicFactor: material.metallic ?? 0,
        roughnessFactor: material.roughness ?? 0.6,
      },
      doubleSided: material.doubleSided ?? false,
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  const bin = Buffer.concat(chunks);
  const binPadding = pad4(bin.length);
  const binPadded = binPadding > 0 ? Buffer.concat([bin, Buffer.alloc(binPadding)]) : bin;
  // The buffer's declared length must reflect the padded chunk, not the raw bytes.
  json.buffers = [{ byteLength: binPadded.length }];

  let jsonText = JSON.stringify(json);
  const jsonBuffer = Buffer.from(jsonText, 'utf8');
  const jsonPadding = pad4(jsonBuffer.length);
  if (jsonPadding > 0) jsonText += ' '.repeat(jsonPadding);
  const jsonPadded = Buffer.from(jsonText, 'utf8');

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
}
