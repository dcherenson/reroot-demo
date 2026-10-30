#!/usr/bin/env node

/*
 * Rebuild the compact geometry bundle from Poly Haven's original glTF 2.0
 * file and its external binary buffer. This uses Node built-ins only.
 *
 * Usage:
 *   node scripts/prepare-scanned-rocks.mjs <source.gltf> <source.bin> [output.bin]
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [gltfPathArg, sourcePathArg, outputPathArg] = process.argv.slice(2);
if (!gltfPathArg || !sourcePathArg) {
  console.error('Usage: node scripts/prepare-scanned-rocks.mjs <source.gltf> <source.bin> [output.bin]');
  process.exit(2);
}

const gltfPath = path.resolve(gltfPathArg);
const sourcePath = path.resolve(sourcePathArg);
const outputPath = path.resolve(outputPathArg || 'assets/models/scanned-rocks/rock-moss-set-01-geometry.bin');
const gltf = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
const source = fs.readFileSync(sourcePath);
if (gltf.asset?.version !== '2.0' || gltf.buffers?.length !== 1) {
  throw new Error('Expected a glTF 2.0 file with one external buffer.');
}
if (source.byteLength < gltf.buffers[0].byteLength) {
  throw new Error('Source buffer is shorter than the glTF buffer declaration.');
}

const componentInfo = {
  5121: [1, 'getUint8'],
  5123: [2, 'getUint16'],
  5125: [4, 'getUint32'],
  5126: [4, 'getFloat32'],
};
const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(index) {
  const accessor = gltf.accessors[index];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const [componentBytes, readMethod] = componentInfo[accessor.componentType] || [];
  const components = componentCounts[accessor.type];
  if (!componentBytes || !components || accessor.sparse) {
    throw new Error(`Unsupported source accessor ${index}.`);
  }
  const stride = bufferView.byteStride || componentBytes * components;
  const offset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const result = accessor.componentType === 5126
    ? new Float32Array(accessor.count * components)
    : accessor.componentType === 5123 ? new Uint16Array(accessor.count * components)
      : new Uint32Array(accessor.count * components);
  const data = new DataView(source.buffer, source.byteOffset, source.byteLength);
  for (let row = 0; row < accessor.count; row += 1) {
    for (let col = 0; col < components; col += 1) {
      result[row * components + col] = data[readMethod](offset + row * stride + col * componentBytes, true);
    }
  }
  return result;
}

function bounds3(values) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], values[i + axis]);
      max[axis] = Math.max(max[axis], values[i + axis]);
    }
  }
  return { min, max };
}

function encodeTypedArray(array, componentType) {
  const width = componentType === 5126 ? 4 : 2;
  const output = Buffer.alloc(array.length * width);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  for (let i = 0; i < array.length; i += 1) {
    if (componentType === 5126) view.setFloat32(i * width, array[i], true);
    else view.setUint16(i * width, array[i], true);
  }
  return output;
}

const selected = [
  { mesh: 2, name: 'rock03' },
  { mesh: 5, name: 'rock06' },
];
const chunks = [];
const manifest = [];
let cursor = 0;
for (const model of selected) {
  const primitive = gltf.meshes[model.mesh]?.primitives?.[0];
  if (primitive?.attributes?.POSITION === undefined || primitive.attributes.NORMAL === undefined || primitive.attributes.TEXCOORD_0 === undefined || primitive.indices === undefined) {
    throw new Error(`Source mesh ${model.mesh} is missing positions, normals, UVs, or indices.`);
  }
  const localPositions = readAccessor(primitive.attributes.POSITION);
  const normals = readAccessor(primitive.attributes.NORMAL);
  const uvs = readAccessor(primitive.attributes.TEXCOORD_0);
  const indices = readAccessor(primitive.indices);
  if (localPositions.length / 3 !== normals.length / 3 || localPositions.length / 3 !== uvs.length / 2) {
    throw new Error(`Source mesh ${model.mesh} has inconsistent vertex attributes.`);
  }
  if (!(indices instanceof Uint16Array) || indices.length % 3 !== 0) {
    throw new Error(`Source mesh ${model.mesh} needs triangle Uint16 indices.`);
  }

  // Keep each rock in its own local coordinates; ignore its collection-layout
  // node translation, center the horizontal bounds, then set max(X/Z span)=1
  // and move the source base to y=0 with that same uniform scale.
  const bounds = bounds3(localPositions);
  const centerX = (bounds.min[0] + bounds.max[0]) / 2;
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
  const footprint = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
  const scale = 1 / footprint;
  const positions = new Float32Array(localPositions.length);
  for (let i = 0; i < localPositions.length; i += 3) {
    positions[i] = (localPositions[i] - centerX) * scale;
    positions[i + 1] = (localPositions[i + 1] - bounds.min[1]) * scale;
    positions[i + 2] = (localPositions[i + 2] - centerZ) * scale;
  }

  const arrays = [
    { key: 'position', value: positions, type: 5126, itemSize: 3 },
    { key: 'normal', value: normals, type: 5126, itemSize: 3 },
    { key: 'uv', value: uvs, type: 5126, itemSize: 2 },
    { key: 'index', value: indices, type: 5123, itemSize: 1 },
  ];
  const attributes = {};
  for (const entry of arrays) {
    const padding = (4 - cursor % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); cursor += padding; }
    const bytes = encodeTypedArray(entry.value, entry.type);
    attributes[entry.key] = {
      offset: cursor,
      length: entry.value.length,
      byteLength: bytes.length,
      itemSize: entry.itemSize,
    };
    chunks.push(bytes);
    cursor += bytes.length;
  }
  manifest.push({
    name: model.name,
    sourceMesh: model.mesh,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    sourceBounds: bounds,
    normalize: {
      centerX,
      centerZ,
      baseY: bounds.min[1],
      scale,
      footprint,
      normalizedHeight: (bounds.max[1] - bounds.min[1]) * scale,
    },
    outputBounds: bounds3(positions),
    attributes,
  });
}

const output = Buffer.concat(chunks);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
console.log(JSON.stringify({
  outputPath,
  outputBytes: output.byteLength,
  sha256: createHash('sha256').update(output).digest('hex'),
  manifest,
}, null, 2));
