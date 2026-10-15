import * as THREE from './vendor/three.module.js';
import { CC0_NATURE_MODELS } from '../models/quaternius-nature.js';
import { CC0_NATURE_MODEL_PARTS } from '../models/quaternius-nature-parts.js';

/*
 * Small, low-poly vegetation models for the browser scene.
 *
 * The authored silhouettes are geometry-only and the ordinary tree, bush,
 * grass, and rock meshes are local CC0 data imported from Quaternius's Nature
 * Pack.  There are no runtime downloads, textures, or Unity package files.
 * Each model is normalized to a one-unit ground-to-crown height where
 * practical, so the renderer can use one instanced transform for every part
 * of a feature.
 */

const TAU = Math.PI * 2;

function pushVertex(data, vector) {
  data.positions.push(vector.x, vector.y, vector.z);
  return data.positions.length / 3 - 1;
}

function connectLoops(data, lower, upper, reverse = false) {
  const segments = Math.min(lower.length, upper.length);
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    if (reverse) {
      data.indices.push(lower[index], upper[index], lower[next], lower[next], upper[index], upper[next]);
    } else {
      data.indices.push(lower[index], lower[next], upper[index], lower[next], upper[next], upper[index]);
    }
  }
}

function finishGeometry(data, name, flat = true) {
  const geometry = new THREE.BufferGeometry();
  geometry.name = name;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = { normalized: true, flat };
  return geometry;
}

function createImportedGeometry(key, name, part = 'whole') {
  const source = CC0_NATURE_MODELS[key];
  if (!source) throw new Error(`Missing CC0 vegetation source: ${key}`);
  const indices = part === 'whole' ? source.indices : source.parts?.[part] || CC0_NATURE_MODEL_PARTS[key]?.[part];
  if (!indices?.length) throw new Error(`Missing CC0 vegetation part: ${key}/${part}`);
  const geometry = new THREE.BufferGeometry();
  geometry.name = name;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    normalized: true,
    source: 'Quaternius LowPoly Nature Pack, CC0 1.0',
    sourceKey: key,
    sourcePart: part,
    sourceBounds: source.bounds,
  };
  return geometry;
}

function perpendicularBasis(direction) {
  const axis = direction.clone().normalize();
  const reference = Math.abs(axis.y) < .9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(reference, axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  return { axis, u, v };
}

/** Add a capped, low-poly tube between two points. */
function addTube(data, start, end, radiusStart, radiusEnd = radiusStart, segments = 7) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < 1e-5) return;
  const { axis, u, v } = perpendicularBasis(direction);
  const lower = [];
  const upper = [];
  for (let index = 0; index < segments; index += 1) {
    const theta = index / segments * TAU;
    const radial = new THREE.Vector3()
      .addScaledVector(u, Math.cos(theta))
      .addScaledVector(v, Math.sin(theta));
    lower.push(pushVertex(data, start.clone().addScaledVector(radial, radiusStart)));
    upper.push(pushVertex(data, end.clone().addScaledVector(radial, radiusEnd)));
  }
  connectLoops(data, lower, upper);
  const startCenter = pushVertex(data, start);
  const endCenter = pushVertex(data, end);
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    data.indices.push(startCenter, lower[next], lower[index]);
    data.indices.push(endCenter, upper[index], upper[next]);
  }
}

/** Add a tapered, round-ended branch with small cap rings. */
function addCapsule(data, start, end, radius, segments = 7) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < 1e-5) return;
  const { axis, u, v } = perpendicularBasis(direction);
  const rings = [
    { axial: -radius, radial: 0 },
    { axial: -radius * .72, radial: radius * .7 },
    { axial: 0, radial: radius },
    { axial: length, radial: radius },
    { axial: length + radius * .72, radial: radius * .7 },
    { axial: length + radius, radial: 0 },
  ];
  const loops = [];
  for (const ring of rings) {
    const loop = [];
    for (let index = 0; index < segments; index += 1) {
      const theta = index / segments * TAU;
      const radial = new THREE.Vector3()
        .addScaledVector(u, Math.cos(theta) * ring.radial)
        .addScaledVector(v, Math.sin(theta) * ring.radial);
      loop.push(pushVertex(data, start.clone().addScaledVector(axis, ring.axial).add(radial)));
    }
    loops.push(loop);
  }
  for (let ring = 0; ring < loops.length - 1; ring += 1) connectLoops(data, loops[ring], loops[ring + 1]);
}

function addBlob(data, center, radii, segments = 8, rings = 4, phase = 0) {
  const loops = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = -Math.PI / 2 + Math.PI * ring / rings;
    const yScale = Math.sin(phi);
    const radial = Math.cos(phi);
    const loop = [];
    for (let index = 0; index < segments; index += 1) {
      const theta = phase + index / segments * TAU;
      const irregular = 1 + .055 * Math.sin(index * 5.17 + ring * 1.63 + phase * 2.1);
      loop.push(pushVertex(data, new THREE.Vector3(
        center.x + Math.cos(theta) * radii.x * radial * irregular,
        center.y + yScale * radii.y,
        center.z + Math.sin(theta) * radii.z * radial * irregular,
      )));
    }
    loops.push(loop);
  }
  for (let ring = 0; ring < loops.length - 1; ring += 1) connectLoops(data, loops[ring], loops[ring + 1]);
}

function createTreeTrunkGeometry() {
  const data = { positions: [], indices: [] };
  addTube(data, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, .58, 0), .065, .043, 7);
  addCapsule(data, new THREE.Vector3(0, .38, 0), new THREE.Vector3(-.23, .59, -.015), .041, 6);
  addCapsule(data, new THREE.Vector3(0, .43, .01), new THREE.Vector3(.21, .63, .02), .038, 6);
  addCapsule(data, new THREE.Vector3(-.02, .49, 0), new THREE.Vector3(.02, .72, -.02), .027, 6);
  return finishGeometry(data, 'vegetation-tree-trunk');
}

function createTreeCanopyGeometry() {
  const data = { positions: [], indices: [] };
  addBlob(data, new THREE.Vector3(0, .63, 0), new THREE.Vector3(.28, .25, .26), 8, 4, .2);
  addBlob(data, new THREE.Vector3(-.20, .66, -.015), new THREE.Vector3(.22, .21, .21), 8, 4, 1.1);
  addBlob(data, new THREE.Vector3(.20, .68, .02), new THREE.Vector3(.23, .22, .22), 8, 4, 2.2);
  addBlob(data, new THREE.Vector3(0, .82, .01), new THREE.Vector3(.20, .19, .19), 8, 4, .6);
  return finishGeometry(data, 'vegetation-tree-canopy');
}

function createTreeHighlightGeometry() {
  const data = { positions: [], indices: [] };
  addBlob(data, new THREE.Vector3(-.13, .78, -.15), new THREE.Vector3(.12, .11, .095), 7, 3, .35);
  addBlob(data, new THREE.Vector3(.17, .63, .13), new THREE.Vector3(.11, .10, .10), 7, 3, 1.3);
  return finishGeometry(data, 'vegetation-tree-highlight');
}

function createOcotilloGeometry() {
  const data = { positions: [], indices: [] };
  const stems = [
    [-.03, .96, .04], [.18, .82, -.05], [-.21, .75, -.03], [.08, .70, .19], [-.10, .64, -.20],
    [.27, .55, .04], [-.27, .52, .06], [.02, .47, -.23],
  ];
  stems.forEach(([x, height, z], index) => {
    const start = new THREE.Vector3(0, .03, 0);
    const end = new THREE.Vector3(x, height, z);
    addCapsule(data, start, end, .017 + (index % 3) * .002, 5);
    addBlob(data, end, new THREE.Vector3(.04, .035, .04), 5, 2, index * .7);
  });
  return finishGeometry(data, 'vegetation-ocotillo');
}

function addSaguaroRidges(data, start, end, radius, ridgeCount = 7) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const { u, v } = perpendicularBasis(direction);
  const ridgeRadius = Math.max(.006, radius * .075);
  for (let ridge = 0; ridge < ridgeCount; ridge += 1) {
    const theta = ridge / ridgeCount * TAU;
    const offset = new THREE.Vector3()
      .addScaledVector(u, Math.cos(theta) * radius * .88)
      .addScaledVector(v, Math.sin(theta) * radius * .88);
    addCapsule(data, start.clone().add(offset), end.clone().add(offset), ridgeRadius, 5);
  }
}

function createSaguaroBodyGeometry() {
  const data = { positions: [], indices: [] };
  const trunkRadius = .115;
  // The capsule ends are one radius beyond these center points.  Keeping the
  // trunk at .115.. .885 makes the merged body exactly one unit tall, which
  // keeps feature instance bounds predictable for the sensor and tests.
  const trunkStart = new THREE.Vector3(0, .115, 0);
  const trunkEnd = new THREE.Vector3(0, .885, 0);
  addCapsule(data, trunkStart, trunkEnd, trunkRadius, 8);
  const arms = [
    [new THREE.Vector3(-.02, .42, 0), new THREE.Vector3(-.22, .47, -.01), new THREE.Vector3(-.22, .73, -.01), .083],
    [new THREE.Vector3(.02, .57, .01), new THREE.Vector3(.21, .61, .02), new THREE.Vector3(.21, .86, .02), .078],
    [new THREE.Vector3(-.01, .69, -.01), new THREE.Vector3(-.15, .73, -.17), new THREE.Vector3(-.15, .91, -.17), .069],
  ];
  arms.forEach(([start, bend, end, radius]) => {
    addCapsule(data, start, bend, radius, 7);
    addCapsule(data, bend, end, radius, 7);
  });
  return finishGeometry(data, 'vegetation-saguaro-body');
}

function createSaguaroRidgeGeometry() {
  const data = { positions: [], indices: [] };
  const trunkRadius = .115;
  const trunkStart = new THREE.Vector3(0, .115, 0);
  const trunkEnd = new THREE.Vector3(0, .885, 0);
  addSaguaroRidges(data, trunkStart, trunkEnd, trunkRadius, 8);
  const arms = [
    [new THREE.Vector3(-.02, .42, 0), new THREE.Vector3(-.22, .47, -.01), new THREE.Vector3(-.22, .73, -.01), .083],
    [new THREE.Vector3(.02, .57, .01), new THREE.Vector3(.21, .61, .02), new THREE.Vector3(.21, .86, .02), .078],
    [new THREE.Vector3(-.01, .69, -.01), new THREE.Vector3(-.15, .73, -.17), new THREE.Vector3(-.15, .91, -.17), .069],
  ];
  arms.forEach(([start, bend, end, radius]) => {
    addSaguaroRidges(data, start, bend, radius, 5);
    addSaguaroRidges(data, bend, end, radius, 5);
  });
  return finishGeometry(data, 'vegetation-saguaro-ridges');
}

function createSaguaroFlowerGeometry() {
  const data = { positions: [], indices: [] };
  addBlob(data, new THREE.Vector3(-.22, .765, -.01), new THREE.Vector3(.035, .028, .035), 6, 2, .1);
  addBlob(data, new THREE.Vector3(.21, .895, .02), new THREE.Vector3(.035, .028, .035), 6, 2, .8);
  addBlob(data, new THREE.Vector3(-.15, .945, -.17), new THREE.Vector3(.032, .026, .032), 6, 2, 1.6);
  return finishGeometry(data, 'vegetation-saguaro-blossoms');
}

/**
 * Build the small shared model set used by renderer.js.  The returned
 * geometries are intentionally shared across all InstancedMesh batches.
 */
export function createVegetationModels() {
  return {
    tree: {
      trunk: createTreeTrunkGeometry(),
      canopy: createTreeCanopyGeometry(),
      highlight: createTreeHighlightGeometry(),
    },
    ocotillo: { stems: createOcotilloGeometry() },
    saguaro: {
      body: createSaguaroBodyGeometry(),
      ridges: createSaguaroRidgeGeometry(),
      flowers: createSaguaroFlowerGeometry(),
    },
    // These four meshes are converted from the bundled Quaternius OBJ source
    // into static position/index arrays so the browser needs no OBJ/MTL loader
    // or network request at world-reset time.
    cc0Tree: {
      bark: createImportedGeometry('tree', 'cc0-quaternius-tree-bark', 'bark'),
      foliage: createImportedGeometry('tree', 'cc0-quaternius-tree-foliage', 'foliage'),
      whole: createImportedGeometry('tree', 'cc0-quaternius-tree'),
    },
    cc0Bush: { whole: createImportedGeometry('bush', 'cc0-quaternius-bush') },
    cc0Grass: { whole: createImportedGeometry('grass', 'cc0-quaternius-grass') },
    cc0Rock: { whole: createImportedGeometry('rock', 'cc0-quaternius-rock') },
  };
}
