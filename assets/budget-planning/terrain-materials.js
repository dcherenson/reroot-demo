import * as THREE from './vendor/three.module.js';

/*
 * The terrain maps are checked-in, CC0 diffuse photographs.  Keeping the
 * URLs relative to this module makes the browser request the copy shipped in
 * `assets/terrain/`; no Poly Haven request is made at runtime.
 */
const TERRAIN_ASSET_URLS = Object.freeze({
  dirt: new URL('../terrain/polyhaven-dirt-1k.jpg', import.meta.url),
  sparseGrass: new URL('../terrain/polyhaven-sparse-grass-512.jpg', import.meta.url),
  sandyGravel: new URL('../terrain/polyhaven-sandy-gravel-1k.jpg', import.meta.url),
  leafyGrass: new URL('../terrain/polyhaven-leafy-grass-1k.jpg', import.meta.url),
});

export const TERRAIN_ASSETS = Object.freeze({
  dirt: Object.freeze({
    file: 'polyhaven-dirt-1k.jpg',
    source: 'https://polyhaven.com/a/dirt',
    author: 'Charlotte Baglioni',
    width: 1024,
    height: 1024,
    bytes: 730425,
    md5: 'cb37e24797597b1dd1ae3819fa80f076',
  }),
  sparseGrass: Object.freeze({
    file: 'polyhaven-sparse-grass-512.jpg',
    source: 'https://polyhaven.com/a/sparse_grass',
    author: 'Amal Kumar',
    width: 512,
    height: 512,
    bytes: 40231,
    md5: '9d67443eef445f61c0e685e96ce610b4',
    derivedFrom: Object.freeze({
      file: 'sparse_grass_diff_1k.jpg',
      bytes: 955945,
      md5: '5d0aba796e1b5882555161c16b10ee9d',
      processing: 'Downsampled to 512 × 512 with Lanczos filtering for the optional farm-grass preset.',
    }),
  }),
  sandyGravel: Object.freeze({
    file: 'polyhaven-sandy-gravel-1k.jpg',
    source: 'https://polyhaven.com/a/sandy_gravel',
    author: 'Charlotte Baglioni',
    width: 1024,
    height: 1024,
    bytes: 795227,
    md5: '9808ac7c155cff11314a4fe200255c50',
  }),
  leafyGrass: Object.freeze({
    file: 'polyhaven-leafy-grass-1k.jpg',
    source: 'https://polyhaven.com/a/leafy_grass',
    author: 'Charlotte Baglioni',
    width: 1024,
    height: 1024,
    bytes: 1195394,
    md5: '0dbc071e91d6905edfcfbe8eb785a1ab',
  }),
});

/*
 * Terrain texture settings intentionally use a broad patch.  A 320 m by
 * 230 m map therefore repeats roughly 12–20 times instead of making a small
 * repeated checkerboard.  The detail shader below can further quiet a poor
 * feature region with the dedicated terrainDetail vertex attribute.
 */
export const TERRAIN_MATERIAL_SETTINGS = Object.freeze({
  farm: Object.freeze({
    asset: 'dirt',
    grassAsset: 'sparseGrass',
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    patchMeters: 19,
    detailStrength: 0.67,
  }),
  farmGrass: Object.freeze({
    asset: 'sparseGrass',
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0,
    patchMeters: 19,
    detailStrength: 0.58,
  }),
  tucson: Object.freeze({
    asset: 'sandyGravel',
    color: 0xffffff,
    roughness: 0.99,
    metalness: 0,
    patchMeters: 21,
    detailStrength: 0.62,
  }),
  'ann-arbor': Object.freeze({
    asset: 'leafyGrass',
    color: 0xffffff,
    roughness: 0.93,
    metalness: 0,
    patchMeters: 24,
    detailStrength: 0.64,
  }),
});

const TERRAIN_KEYS = new Set(Object.keys(TERRAIN_MATERIAL_SETTINGS));
const DEFAULT_TERRAIN_MEAN = Object.freeze([0.5, 0.5, 0.5]);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, finite(value, minimum)));
}

function worldKey(world) {
  const raw = typeof world === 'string' ? world : world?.id;
  const id = String(raw == null ? 'farm' : raw).trim().toLowerCase().replaceAll('_', '-');
  if (id === 'farm-grass' || id === 'farmgrass') return 'farmGrass';
  if (id.includes('tucson')) return 'tucson';
  if (id === 'annarbor' || id.includes('ann-arbor') || id === 'city' || id === 'urban' || id.includes('stadium')) {
    return 'ann-arbor';
  }
  return TERRAIN_KEYS.has(id) ? id : 'farm';
}

function canLoadBrowserTexture() {
  return typeof document !== 'undefined' && typeof Image !== 'undefined';
}

function configureTexture(texture, { repeat = [1, 1], maxAnisotropy = 1 } = {}) {
  if (!texture) return texture;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(clamp(repeat[0], 1, 256), clamp(repeat[1], 1, 256));
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.max(1, Math.floor(clamp(maxAnisotropy, 1, 16)));
  // Diffuse photographs are authored in sRGB.  Lighting remains in Three's
  // working linear space after this decode.
  if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function srgbToLinear(value) {
  const channel = clamp(value / 255, 0, 1);
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function imageMeanLinear(image) {
  if (!image || typeof document === 'undefined') return DEFAULT_TERRAIN_MEAN.slice();
  try {
    const width = Math.max(1, Number(image.naturalWidth || image.width || 1));
    const height = Math.max(1, Number(image.naturalHeight || image.height || 1));
    const sampleSize = Math.min(128, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return DEFAULT_TERRAIN_MEAN.slice();
    context.drawImage(image, 0, 0, sampleSize, sampleSize);
    const data = context.getImageData(0, 0, sampleSize, sampleSize).data;
    const mean = [0, 0, 0];
    for (let index = 0; index < data.length; index += 4) {
      mean[0] += srgbToLinear(data[index]);
      mean[1] += srgbToLinear(data[index + 1]);
      mean[2] += srgbToLinear(data[index + 2]);
    }
    const count = Math.max(1, data.length / 4);
    return mean.map((value) => value / count);
  } catch (_error) {
    // A canvas policy or an unusual image implementation should not make a
    // locally valid texture prevent the renderer from starting.
    return DEFAULT_TERRAIN_MEAN.slice();
  }
}

function loadOneTexture(loader, key) {
  if (!canLoadBrowserTexture()) return Promise.resolve(null);
  const url = TERRAIN_ASSET_URLS[key];
  return new Promise((resolve) => {
    try {
      loader.load(url.href, (texture) => {
        configureTexture(texture);
        // Store the linear mean once on the source texture. Per-world clones
        // reuse the value as a uniform and never create another canvas.
        texture.userData.terrainMeanColor = imageMeanLinear(texture.image);
        resolve(texture);
      }, undefined, (error) => {
        // A missing local asset should degrade to the material's color rather
        // than leaving the application import or sensor stream pending.
        console.warn(`Terrain texture ${key} could not be loaded.`, error);
        resolve(null);
      });
    } catch (error) {
      console.warn(`Terrain texture ${key} could not be loaded.`, error);
      resolve(null);
    }
  });
}

async function loadSourceTextures() {
  if (!canLoadBrowserTexture()) return Object.freeze({});
  const loader = new THREE.TextureLoader();
  const entries = await Promise.all(Object.keys(TERRAIN_ASSET_URLS).map(async (key) => [key, await loadOneTexture(loader, key)]));
  return Object.freeze(Object.fromEntries(entries));
}

/*
 * The top-level await makes a browser import deterministic: the first terrain
 * material is created only after all four local maps have either loaded or
 * reported a recoverable error.  In Node (where document is absent) this is
 * an immediate empty result, which keeps geometry-only unit tests loader-free.
 */
export const terrainAssetsReady = loadSourceTextures();
const SOURCE_TEXTURES = await terrainAssetsReady;
const SOURCE_MEANS = Object.freeze(Object.fromEntries(
  Object.keys(TERRAIN_ASSET_URLS).map((key) => [
    key,
    SOURCE_TEXTURES[key]?.userData?.terrainMeanColor || DEFAULT_TERRAIN_MEAN,
  ]),
));

function repeatForWorld(world, settings) {
  const width = Math.max(1, finite(world?.width, 320));
  const height = Math.max(1, finite(world?.height, 230));
  const patch = Math.max(1, finite(settings.patchMeters, 20));
  return [Math.max(1, width / patch), Math.max(1, height / patch)];
}

function addTerrainDetailBlend(material, detailStrength, meanColor) {
  const uniforms = {
    terrainDetailStrength: { value: clamp(detailStrength, 0, 1) },
    terrainMeanColor: { value: new THREE.Vector3(...meanColor) },
  };
  material.userData.terrainUniforms = uniforms;
  material.userData.terrainDetailConvention =
    'Set a float terrainDetail attribute per vertex; 1 is rich detail and 0 is quiet detail. Keep the color attribute RGB (or RGB plus alpha 1) for opaque tinting.';
  const previousOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previousOnBeforeCompile === 'function') previousOnBeforeCompile(shader, renderer);
    shader.uniforms.terrainDetailStrength = uniforms.terrainDetailStrength;
    shader.uniforms.terrainMeanColor = uniforms.terrainMeanColor;
    // Use a dedicated scalar attribute instead of color alpha.  Three's
    // color_fragment multiplies all four vColor components into diffuseColor;
    // reusing alpha there would make poor ground transparent.
    shader.vertexShader = `attribute float terrainDetail;\nvarying float vTerrainDetail;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      '#include <color_vertex>\n\tvTerrainDetail = clamp( terrainDetail, 0.0, 1.0 );',
    );
    shader.fragmentShader = `uniform float terrainDetailStrength;\nuniform vec3 terrainMeanColor;\nvarying float vTerrainDetail;\n${shader.fragmentShader}`;
    // Replace map_fragment so the quiet blend happens between sampling and
    // diffuse multiplication.  Appending a blend after the include would be
    // too late because the stock chunk has already consumed the sample. The
    // mean is measured from the source image in linear space, so a quiet patch
    // keeps the material's natural base color instead of fading to white.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
\tvec4 sampledDiffuseColor = texture2D( map, vMapUv );
\t#ifdef DECODE_VIDEO_TEXTURE
\t\tsampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
\t#endif
\tfloat terrainDetail = clamp( terrainDetailStrength * clamp( vTerrainDetail, 0.0, 1.0 ), 0.0, 1.0 );
\tsampledDiffuseColor.rgb = mix( terrainMeanColor, sampledDiffuseColor.rgb, terrainDetail );
\tdiffuseColor *= sampledDiffuseColor;
#endif`,
    );
  };
  const previousProgramKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|terrain-detail-attribute-v2`;
  return material;
}

function clonedTexture(assetKey, repeat, maxAnisotropy, owned) {
  const source = SOURCE_TEXTURES[assetKey];
  if (!source) return null;
  const texture = source.clone();
  configureTexture(texture, { repeat, maxAnisotropy });
  if (owned instanceof Set) owned.add(texture);
  return texture;
}

/**
 * Create one world terrain material and a promise for the local asset load.
 *
 * The returned texture is a per-world clone.  Callers that own a renderer can
 * pass its resource Set as `owned`; disposing that Set will release the clone,
 * while the module-level source images stay CPU-only and are never attached to
 * a scene.  `assetsReady` is already settled in a browser because this module
 * awaits the four local images before exporting.
 */
export function createTerrainMaterial(world, { owned = null, maxAnisotropy = 4, detailStrength, variant, asset: assetOverride, loader: _loader = null } = {}) {
  const requestedKey = variant && TERRAIN_MATERIAL_SETTINGS[variant] ? variant : worldKey(world);
  const key = requestedKey;
  const settings = TERRAIN_MATERIAL_SETTINGS[key];
  const repeat = repeatForWorld(world, settings);
  const assetKey = assetOverride && TERRAIN_ASSETS[assetOverride] ? assetOverride : settings.asset;
  const texture = clonedTexture(assetKey, repeat, maxAnisotropy, owned);
  const material = new THREE.MeshStandardMaterial({
    color: settings.color,
    map: texture,
    vertexColors: true,
    roughness: settings.roughness,
    metalness: settings.metalness,
    flatShading: false,
    side: THREE.DoubleSide,
  });
  addTerrainDetailBlend(material, detailStrength == null ? settings.detailStrength : detailStrength, SOURCE_MEANS[assetKey] || DEFAULT_TERRAIN_MEAN);
  material.userData.terrainWorldKey = key;
  material.userData.terrainAssetKey = assetKey;
  material.userData.terrainRepeat = repeat.slice();
  material.userData.terrainAssets = TERRAIN_ASSETS[assetKey];
  if (owned instanceof Set) owned.add(material);
  return {
    material,
    texture,
    key,
    settings,
    assetsReady: terrainAssetsReady,
  };
}

/** Create all four presets, primarily useful for previews and diagnostics. */
export function createTerrainMaterials(options = {}) {
  return {
    farm: createTerrainMaterial({ id: 'farm', width: 320, height: 230 }, options),
    farmGrass: createTerrainMaterial({ id: 'farm', width: 320, height: 230 }, { ...options, variant: 'farmGrass' }),
    tucson: createTerrainMaterial({ id: 'tucson', width: 320, height: 230 }, options),
    'ann-arbor': createTerrainMaterial({ id: 'ann-arbor', width: 320, height: 230 }, options),
  };
}

export { worldKey as terrainWorldKey, configureTexture as configureTerrainTexture };
