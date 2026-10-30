import * as THREE from './vendor/three.module.js';

/*
 * Two cropped rocks from Poly Haven's CC0 Rock Moss Set 01. The compact
 * geometry and photographs are loaded on demand by `prepareScannedRocks`.
 * Farm and Ann Arbor callers wait for the local geometry and diffuse
 * photograph for at most 8 seconds; normal and roughness maps are optional.
 * Tucson and Node imports do not start requests.
 *
 * The returned geometry, material, and cloned maps belong to the caller's
 * renderer. The original module-level textures and byte buffer are immutable
 * source caches and are not added to `owned` or disposed by a renderer reset.
 */

const LOAD_TIMEOUT_MS = 8_000;
const MAX_ANISOTROPY = 16;
const ASSET_URLS = Object.freeze({
  geometry: new URL('../models/scanned-rocks/rock-moss-set-01-geometry.bin', import.meta.url),
  diffuse: new URL('../models/scanned-rocks/rock-moss-set-01-diffuse-1k.jpg', import.meta.url),
  normal: new URL('../models/scanned-rocks/rock-moss-set-01-normal-gl-1k.jpg', import.meta.url),
  roughness: new URL('../models/scanned-rocks/rock-moss-set-01-roughness-1k.jpg', import.meta.url),
});

// Chunks contain little-endian Float32 attributes and Uint16 indices. The
// generated file preserves the source normals and UVs; only positions are
// uniformly scaled, centered in X/Z, and raised so the base is y=0.
const ROCKS = Object.freeze([
  Object.freeze({
    name: 'rock-moss-set-01-rock03',
    sourceMesh: 2,
    triangleCount: 5_000,
    vertexCount: 2_741,
    position: Object.freeze({ offset: 0, length: 8_223 }),
    normal: Object.freeze({ offset: 32_892, length: 8_223 }),
    uv: Object.freeze({ offset: 65_784, length: 5_482 }),
    index: Object.freeze({ offset: 87_712, length: 15_000 }),
  }),
  Object.freeze({
    name: 'rock-moss-set-01-rock06',
    sourceMesh: 5,
    triangleCount: 8_994,
    vertexCount: 4_748,
    position: Object.freeze({ offset: 117_712, length: 14_244 }),
    normal: Object.freeze({ offset: 174_688, length: 14_244 }),
    uv: Object.freeze({ offset: 231_664, length: 9_496 }),
    index: Object.freeze({ offset: 269_648, length: 26_982 }),
  }),
]);

function canLoadBrowserAssets() {
  return typeof document !== 'undefined'
    && typeof Image !== 'undefined'
    && typeof fetch === 'function';
}

async function loadGeometryBytes() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeout = 0;
  try {
    const request = fetch(
      ASSET_URLS.geometry.href,
      controller ? { signal: controller.signal } : undefined,
    ).then(async (response) => {
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      return bytes.byteLength >= 323_612 ? bytes : null;
    }).catch(() => null);
    const timeoutResult = new Promise((resolve) => {
      timeout = setTimeout(() => {
        controller?.abort();
        resolve(null);
      }, LOAD_TIMEOUT_MS);
    });
    return await Promise.race([request, timeoutResult]);
  } catch (_error) {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function loadTexture(url) {
  return new Promise((resolve) => {
    let settled = false;
    let texture = null;
    const finish = (result) => {
      if (settled) {
        result?.dispose();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => finish(null), LOAD_TIMEOUT_MS);
    try {
      texture = new THREE.TextureLoader().load(
        url.href,
        (loaded) => finish(loaded),
        undefined,
        () => finish(null),
      );
    } catch (_error) {
      texture?.dispose();
      finish(null);
    }
  });
}

async function loadSourceAssets() {
  if (!canLoadBrowserAssets()) return null;
  const [geometryBytes, diffuse, normal, roughness] = await Promise.all([
    loadGeometryBytes(),
    loadTexture(ASSET_URLS.diffuse),
    loadTexture(ASSET_URLS.normal),
    loadTexture(ASSET_URLS.roughness),
  ]);
  if (!geometryBytes || !diffuse) {
    diffuse?.dispose();
    normal?.dispose();
    roughness?.dispose();
    return null;
  }
  if ('colorSpace' in diffuse && THREE.SRGBColorSpace) diffuse.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [normal, roughness]) {
    if (texture) texture.colorSpace = THREE.NoColorSpace || '';
  }
  return Object.freeze({ geometryBytes, diffuse, normal, roughness });
}

let preparedAssets = null;
let preparePromise = null;

function needsScannedRocks(worldId) {
  const raw = worldId && typeof worldId === 'object' ? worldId.id : worldId;
  const id = String(raw == null ? '' : raw).trim().toLowerCase().replaceAll('_', '-');
  return id === 'farm' || id === 'farm-grass' || id === 'farmgrass'
    || id === 'annarbor' || id === 'ann-arbor' || id.includes('ann-arbor')
    || id === 'city' || id === 'urban';
}

/**
 * Prepare local scanned rocks for Farm or Ann Arbor before creating a world.
 * Successful source images and geometry bytes are cached for this module;
 * renderer factories clone per-renderer resources synchronously. Returns
 * false without loading for Tucson, Node, or a missing required local asset.
 */
export async function prepareScannedRocks(worldId) {
  if (!needsScannedRocks(worldId) || !canLoadBrowserAssets()) return false;
  if (!preparePromise) preparePromise = loadSourceAssets().catch(() => null);
  preparedAssets = await preparePromise;
  return Boolean(preparedAssets);
}

function copiedAttribute(bytes, spec, itemSize, Type) {
  const view = new Type(bytes, spec.offset, spec.length);
  return new THREE.BufferAttribute(new Type(view), itemSize);
}

function createGeometry(bytes, spec) {
  const geometry = new THREE.BufferGeometry();
  geometry.name = spec.name;
  geometry.setAttribute('position', copiedAttribute(bytes, spec.position, 3, Float32Array));
  geometry.setAttribute('normal', copiedAttribute(bytes, spec.normal, 3, Float32Array));
  geometry.setAttribute('uv', copiedAttribute(bytes, spec.uv, 2, Float32Array));
  geometry.setIndex(copiedAttribute(bytes, spec.index, 1, Uint16Array));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.scannedRock = Object.freeze({
    source: 'Poly Haven Rock Moss Set 01',
    sourceMesh: spec.sourceMesh,
    triangleCount: spec.triangleCount,
    normalizedFootprint: 1,
    groundedAtY: 0,
    preservesSourceNormals: true,
    preservesSourceUVs: true,
  });
  return geometry;
}

function cloneTexture(source, maxAnisotropy, owned, colorSpace) {
  if (!source) return null;
  const texture = source.clone();
  // The preserved source UVs are glTF coordinates, where (0, 0) is the
  // image's upper-left pixel. Match GLTFLoader's convention for every map.
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  const requested = Number(maxAnisotropy);
  const anisotropy = Number.isFinite(requested) && requested > 0 ? requested : 4;
  texture.anisotropy = Math.max(1, Math.min(MAX_ANISOTROPY, Math.floor(anisotropy)));
  if ('colorSpace' in texture) texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  if (owned instanceof Set) owned.add(texture);
  return texture;
}

/**
 * Make renderer-owned, normalized scanned rock geometry and materials.
 *
 * The result's `geometry` and `material` fields point to the first rock for a
 * simple InstancedMesh caller. `models` contains both available silhouettes;
 * each model shares that same material and can be instanced independently.
 * Returns null in Node or when the required local geometry/photo is missing.
 */
export function createScannedRockAssets({ owned = null, maxAnisotropy = 4 } = {}) {
  if (!preparedAssets) return null;

  const textures = [];
  const geometries = [];
  let material = null;
  try {
    const map = cloneTexture(preparedAssets.diffuse, maxAnisotropy, owned, THREE.SRGBColorSpace || '');
    const normalMap = cloneTexture(preparedAssets.normal, maxAnisotropy, owned, THREE.NoColorSpace || '');
    const roughnessMap = cloneTexture(preparedAssets.roughness, maxAnisotropy, owned, THREE.NoColorSpace || '');
    textures.push(map, normalMap, roughnessMap);
    material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map,
      normalMap,
      roughnessMap,
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    material.name = 'rock-moss-set-01-photographic-material';
    material.userData.scannedRockSource = 'https://polyhaven.com/a/rock_moss_set_01';

    for (const spec of ROCKS) {
      const geometry = createGeometry(preparedAssets.geometryBytes, spec);
      geometries.push(geometry);
      if (owned instanceof Set) owned.add(geometry);
    }
    if (owned instanceof Set) owned.add(material);

    const models = Object.freeze(ROCKS.map((spec, index) => Object.freeze({
      name: spec.name,
      geometry: geometries[index],
      material,
      triangleCount: spec.triangleCount,
    })));
    return Object.freeze({
      geometry: models[0].geometry,
      material,
      variants: Object.freeze(models.slice(1)),
      models,
      source: 'https://polyhaven.com/a/rock_moss_set_01',
    });
  } catch (_error) {
    for (const geometry of geometries) geometry.dispose();
    material?.dispose();
    for (const texture of textures) texture?.dispose();
    if (owned instanceof Set) {
      for (const geometry of geometries) owned.delete(geometry);
      if (material) owned.delete(material);
      for (const texture of textures) if (texture) owned.delete(texture);
    }
    return null;
  }
}
