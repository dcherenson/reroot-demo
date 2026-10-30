import * as THREE from './vendor/three.module.js';

/*
 * The terrain maps are checked-in, CC0 diffuse photographs.  Keeping the
 * URLs relative to this module makes the browser request the copy shipped in
 * `assets/terrain/`; no Poly Haven request is made at runtime.
 */
const LEGACY_TERRAIN_ASSET_URLS = Object.freeze({
  dirt: new URL('../terrain/polyhaven-dirt-1k.jpg', import.meta.url),
  sparseGrass: new URL('../terrain/polyhaven-sparse-grass-512.jpg', import.meta.url),
  sandyGravel: new URL('../terrain/polyhaven-sandy-gravel-1k.jpg', import.meta.url),
  leafyGrass: new URL('../terrain/polyhaven-leafy-grass-1k.jpg', import.meta.url),
});

const PBR_TERRAIN_ASSETS = Object.freeze({
  farmSoil: Object.freeze({
    diffuse: new URL('../terrain/polyhaven-farm-soil-512-diffuse.jpg', import.meta.url),
    normal: new URL('../terrain/polyhaven-farm-soil-512-normal-gl.png', import.meta.url),
    roughness: new URL('../terrain/polyhaven-farm-soil-512-roughness.png', import.meta.url),
    fallbackKey: 'dirt',
  }),
  sparseGrass: Object.freeze({
    diffuseKey: 'sparseGrass',
    normal: new URL('../terrain/polyhaven-sparse-grass-512-normal-gl.png', import.meta.url),
    roughness: new URL('../terrain/polyhaven-sparse-grass-512-roughness.png', import.meta.url),
  }),
  leafyGrass: Object.freeze({
    diffuseKey: 'leafyGrass',
    normal: new URL('../terrain/polyhaven-leafy-grass-512-normal-gl.png', import.meta.url),
    roughness: new URL('../terrain/polyhaven-leafy-grass-512-roughness.png', import.meta.url),
  }),
  gravelRoad: Object.freeze({
    diffuse: new URL('../terrain/polyhaven-gravel-road-512-diffuse.jpg', import.meta.url),
    normal: new URL('../terrain/polyhaven-gravel-road-512-normal-gl.png', import.meta.url),
    roughness: new URL('../terrain/polyhaven-gravel-road-512-roughness.png', import.meta.url),
  }),
  asphaltRoad: Object.freeze({
    diffuse: new URL('../terrain/polyhaven-road-damaged-clean-512-diffuse.jpg', import.meta.url),
    normal: new URL('../terrain/polyhaven-road-damaged-clean-512-normal-gl.png', import.meta.url),
    roughness: new URL('../terrain/polyhaven-road-damaged-clean-512-roughness.png', import.meta.url),
  }),
});

function mapFile(file, bytes, sha256, sourceFile, sourceBytes, sourceMd5) {
  return Object.freeze({ file, bytes, sha256, sourceFile, sourceBytes, sourceMd5 });
}

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
    maps: Object.freeze({
      normal: mapFile('polyhaven-sparse-grass-512-normal-gl.png', 637947, 'b06feaae61b9ce79dd1e64750010c25c144034c72dd28ffa10c2b3fa5b92f418', 'sparse_grass_nor_gl_1k.jpg', 1440314, '3307e6ce47413c6b4e85885d4b8ae932'),
      roughness: mapFile('polyhaven-sparse-grass-512-roughness.png', 135911, '4961b13355bbb1e0731f3509739a4e6d862f426fc77838702391a683d342c8f1', 'sparse_grass_rough_1k.jpg', 463340, 'acf2fd7e352e7635f67f24ecda01e485'),
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
    maps: Object.freeze({
      normal: mapFile('polyhaven-leafy-grass-512-normal-gl.png', 644151, '5b13bd55c42f4d11ee6004397d797033e5914adda609728ab887635c30eb80f4', 'leafy_grass_nor_gl_1k.jpg', 1466049, '8279e096e204ea326d57a318869f99df'),
      roughness: mapFile('polyhaven-leafy-grass-512-roughness.png', 132134, '4944ac749d2978be62c1fc598486149d02a88734bdf7857fe8ae1598ad630b79', 'leafy_grass_rough_1k.jpg', 511385, '05f6bb1383e12b327727d313c5899cf2'),
    }),
  }),
  farmSoil: Object.freeze({
    file: 'polyhaven-farm-soil-512-diffuse.jpg',
    source: 'https://polyhaven.com/a/farm_soil',
    author: 'Amal Kumar',
    width: 512,
    height: 512,
    bytes: 30549,
    sha256: '8b1b6e4c7aa38dcb0c5e089363eb87b3ac9410dc44f097bbd339e3fa883d661b',
    sourceFile: 'farm_soil_diff_1k.jpg',
    sourceBytes: 735837,
    sourceMd5: '29fad1e29469e644759032c3ade249fa',
    maps: Object.freeze({
      normal: mapFile('polyhaven-farm-soil-512-normal-gl.png', 679373, '1d1ea4f1e8fd51b7d25b0eec6c002898f848ee856f9b2340997c2eed115cc030', 'farm_soil_nor_gl_1k.jpg', 1541114, 'e0afe5e537ed2869ddd4d0cfe1b529b5'),
      roughness: mapFile('polyhaven-farm-soil-512-roughness.png', 87153, '079ce37835780027d479f4df685f58c697a55afb9c77d38f9b62cb1c05efa69f', 'farm_soil_rough_1k.jpg', 279247, 'e671f4453ea99fb209d53ded77e7f82b'),
    }),
  }),
  gravelRoad: Object.freeze({
    file: 'polyhaven-gravel-road-512-diffuse.jpg',
    source: 'https://polyhaven.com/a/gravel_road',
    author: 'Amal Kumar',
    width: 512,
    height: 512,
    bytes: 14718,
    sha256: '03394ecdf5b46d13bb7a7d774a862253ac1e300de140cea41831274a61d48c1e',
    sourceFile: 'gravel_road_diff_1k.jpg',
    sourceBytes: 684038,
    sourceMd5: 'd259491a6cb5ca0e96d3941758f8bb47',
    maps: Object.freeze({
      normal: mapFile('polyhaven-gravel-road-512-normal-gl.png', 534994, '6b1fdeb09612d114496def9cbc2bf49342f0d6d5d5593f439ed5cc4ab1b150cb', 'gravel_road_nor_gl_1k.jpg', 983723, '6be4a6d4c869c9714c0224619d587837'),
      roughness: mapFile('polyhaven-gravel-road-512-roughness.png', 119408, 'bee3e36049206a51e286d21b01e88d82f9bdc3a992c533957ca593a9ec64b9e8', 'gravel_road_rough_1k.jpg', 361584, '2666aa6329169e7a8a24b892a977c2b1'),
    }),
  }),
  asphaltRoad: Object.freeze({
    file: 'polyhaven-road-damaged-clean-512-diffuse.jpg',
    source: 'https://polyhaven.com/a/road_damaged_clean',
    author: 'Dimitrios Savva',
    width: 512,
    height: 512,
    bytes: 17635,
    sha256: '7bfabf31a1cb5be4156d8e706fb8f447fb9cfdf568b21414559408650ef50526',
    sourceFile: 'road_damaged_clean_diff_1k.jpg',
    sourceBytes: 810889,
    sourceMd5: '31f5131c8001abc89d8e22582ce20f76',
    maps: Object.freeze({
      normal: mapFile('polyhaven-road-damaged-clean-512-normal-gl.png', 532659, 'f5fa028c4390900a6ed1274a88b3fdd8878f154945770e10c1b73da9f0083302', 'road_damaged_clean_nor_gl_1k.jpg', 1017836, '2ca48cf0a9f8cb84b8f5704b441f549f'),
      roughness: mapFile('polyhaven-road-damaged-clean-512-roughness.png', 166817, '0fabc0da2e5005cd38b8439682fba9ae1a458c0467677a14fe84fb02dc82c56c', 'road_damaged_clean_rough_1k.jpg', 652417, 'd109e1e7aa0119412dae597fec8d4230'),
    }),
  }),
});

/*
 * Grass uses six-metre patches so photographed leaves and stems stay small
 * at ground level. Fields have their own normalized UVs and keep the broader
 * preset; Tucson retains its original scale. The detail shader quiets poor
 * feature regions with the dedicated terrainDetail vertex attribute.
 */
export const TERRAIN_MATERIAL_SETTINGS = Object.freeze({
  legacySoil: Object.freeze({
    asset: 'dirt',
    grassAsset: 'sparseGrass',
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    patchMeters: 19,
    detailStrength: 0.67,
  }),
  farm: Object.freeze({
    asset: 'farmSoil',
    grassAsset: 'sparseGrass',
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    patchMeters: 19,
    detailStrength: 0.67,
    normalStrength: 0.15,
  }),
  farmGrass: Object.freeze({
    asset: 'sparseGrass',
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0,
    patchMeters: 6,
    detailStrength: 0.78,
    normalStrength: 0.22,
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
    patchMeters: 6,
    detailStrength: 0.8,
    normalStrength: 0.2,
  }),
});

export const ROAD_MATERIAL_SETTINGS = Object.freeze({
  gravel: Object.freeze({
    asset: 'gravelRoad',
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    patchMeters: 2,
    normalStrength: 0.14,
  }),
  asphalt: Object.freeze({
    asset: 'asphaltRoad',
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0,
    patchMeters: 2.2,
    normalStrength: 0.1,
  }),
  shoulder: Object.freeze({
    asset: 'gravelRoad',
    color: 0xd9c8a8,
    roughness: 1,
    metalness: 0,
    patchMeters: 2,
    normalStrength: 0.1,
  }),
});

const WORLD_PBR_ASSET_GROUPS = Object.freeze({
  farm: Object.freeze(['farmSoil', 'sparseGrass', 'gravelRoad']),
  'ann-arbor': Object.freeze(['leafyGrass', 'gravelRoad', 'asphaltRoad']),
  tucson: Object.freeze([]),
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

function configureTexture(texture, { repeat = [1, 1], maxAnisotropy = 1, colorSpace = 'srgb' } = {}) {
  if (!texture) return texture;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(clamp(repeat[0], 0.0001, 256), clamp(repeat[1], 0.0001, 256));
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.max(1, Math.floor(clamp(maxAnisotropy, 1, 16)));
  // Diffuse photographs are authored in sRGB. Normal and roughness maps are
  // numeric data and must stay in the linear/no-color-space path.
  if ('colorSpace' in texture) {
    texture.colorSpace = colorSpace === 'srgb'
      ? (THREE.SRGBColorSpace || '')
      : (THREE.NoColorSpace || '');
  }
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

function imageMeanChannel(image, channelIndex) {
  if (!image || typeof document === 'undefined') return 1;
  try {
    const width = Math.max(1, Number(image.naturalWidth || image.width || 1));
    const height = Math.max(1, Number(image.naturalHeight || image.height || 1));
    const sampleSize = Math.min(128, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return 1;
    context.drawImage(image, 0, 0, sampleSize, sampleSize);
    const data = context.getImageData(0, 0, sampleSize, sampleSize).data;
    let mean = 0;
    for (let index = channelIndex; index < data.length; index += 4) mean += data[index] / 255;
    return mean / Math.max(1, data.length / 4);
  } catch (_error) {
    return 1;
  }
}

function loadTexture(loader, url, label, colorSpace = 'srgb', meanChannel = null) {
  if (!canLoadBrowserTexture()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (texture, error) => {
      // Keep the sensor scene deterministic if an image arrives after fallback.
      if (settled) { texture?.dispose(); return; }
      settled = true;
      clearTimeout(timeout);
      if (error) console.warn(`Terrain texture ${label} could not be loaded.`, error);
      resolve(texture);
    };
    const timeout = setTimeout(() => finish(null, new Error('Texture download timed out.')), 10_000);
    try {
      loader.load(url.href, (texture) => {
        if (settled) { texture.dispose(); return; }
        try {
          configureTexture(texture, { colorSpace });
          if (colorSpace === 'srgb') {
            // Store the linear mean once on the source texture. Per-world clones
            // reuse the value as a uniform and never create another canvas.
            texture.userData.terrainMeanColor = imageMeanLinear(texture.image);
          }
          if (meanChannel != null) {
            texture.userData.terrainMeanRoughness = imageMeanChannel(texture.image, meanChannel);
          }
          finish(texture);
        } catch (error) {
          texture.dispose();
          finish(null, error);
        }
      }, undefined, (error) => {
        // A missing local asset should degrade to the material's color rather
        // than leaving the application import or sensor stream pending.
        finish(null, error);
      });
    } catch (error) {
      finish(null, error);
    }
  });
}

async function loadSourceTextures() {
  if (!canLoadBrowserTexture()) return Object.freeze({});
  const loader = new THREE.TextureLoader();
  const entries = await Promise.all(Object.keys(LEGACY_TERRAIN_ASSET_URLS).map(async (key) => [
    key,
    await loadTexture(loader, LEGACY_TERRAIN_ASSET_URLS[key], key),
  ]));
  return Object.freeze(Object.fromEntries(entries));
}

/*
 * The top-level await makes a browser import deterministic: the first terrain
 * material is created only after all four local maps have either loaded or
 * reported a recoverable error or timed out. In Node (where document is absent) this is
 * an immediate empty result, which keeps geometry-only unit tests loader-free.
 */
export const terrainAssetsReady = loadSourceTextures();
const SOURCE_TEXTURES = await terrainAssetsReady;
const SOURCE_MEANS = Object.freeze(Object.fromEntries(
  Object.keys(LEGACY_TERRAIN_ASSET_URLS).map((key) => [
    key,
    SOURCE_TEXTURES[key]?.userData?.terrainMeanColor || DEFAULT_TERRAIN_MEAN,
  ]),
));

const PBR_SOURCE_TEXTURES = new Map();
const PBR_SOURCE_LOADS = new Map();
let PBR_TEXTURE_LOADER = null;

function loadPbrAsset(assetKey) {
  if (PBR_SOURCE_TEXTURES.has(assetKey)) return Promise.resolve(PBR_SOURCE_TEXTURES.get(assetKey));
  if (PBR_SOURCE_LOADS.has(assetKey)) return PBR_SOURCE_LOADS.get(assetKey);
  const config = PBR_TERRAIN_ASSETS[assetKey];
  if (!config) return Promise.resolve(null);
  if (!canLoadBrowserTexture()) {
    const empty = Object.freeze({ map: null, normalMap: null, roughnessMap: null, meanColor: DEFAULT_TERRAIN_MEAN });
    PBR_SOURCE_TEXTURES.set(assetKey, empty);
    return Promise.resolve(empty);
  }
  if (!PBR_TEXTURE_LOADER) PBR_TEXTURE_LOADER = new THREE.TextureLoader();
  const loader = PBR_TEXTURE_LOADER;
  const loadMap = (url, label, colorSpace) => url
    ? loadTexture(loader, url, `${assetKey}:${label}`, colorSpace, label === 'roughness' ? 1 : null)
    : Promise.resolve(null);
  const mapPromise = config.diffuse
    ? loadMap(config.diffuse, 'diffuse', 'srgb')
    : Promise.resolve(SOURCE_TEXTURES[config.diffuseKey] || null);
  const pending = Promise.all([
    mapPromise,
    loadMap(config.normal, 'normalGL', 'linear'),
    loadMap(config.roughness, 'roughness', 'linear'),
  ]).then(([map, normalMap, roughnessMap]) => {
    const meanColor = map?.userData?.terrainMeanColor
      || SOURCE_MEANS[config.diffuseKey || config.fallbackKey]
      || DEFAULT_TERRAIN_MEAN;
    const meanRoughness = roughnessMap?.userData?.terrainMeanRoughness ?? 1;
    const source = Object.freeze({ map, normalMap, roughnessMap, meanColor, meanRoughness });
    PBR_SOURCE_TEXTURES.set(assetKey, source);
    PBR_SOURCE_LOADS.delete(assetKey);
    return source;
  }, (error) => {
    console.warn(`Terrain PBR maps for ${assetKey} could not be loaded.`, error);
    const source = Object.freeze({
      map: null,
      normalMap: null,
      roughnessMap: null,
      meanColor: SOURCE_MEANS[config.diffuseKey || config.fallbackKey] || DEFAULT_TERRAIN_MEAN,
      meanRoughness: 1,
    });
    PBR_SOURCE_TEXTURES.set(assetKey, source);
    PBR_SOURCE_LOADS.delete(assetKey);
    return source;
  });
  PBR_SOURCE_LOADS.set(assetKey, pending);
  return pending;
}

function canonicalWorldKey(world) {
  const key = worldKey(world);
  return key === 'farmGrass' ? 'farm' : key;
}

function pbrAssetsForWorld(world, requiredAssets = []) {
  const key = canonicalWorldKey(world);
  return [...new Set([...(WORLD_PBR_ASSET_GROUPS[key] || []), ...requiredAssets])]
    .filter((assetKey) => Boolean(PBR_TERRAIN_ASSETS[assetKey]));
}

/**
 * Warm all local PBR maps used by the selected world's terrain, fields, and
 * road surfaces. Call before constructing a mission so materials bind their
 * final maps once and remain stable while the renderer is running. Tucson
 * keeps its legacy sandy-gravel image and requests no additional assets.
 */
export async function prepareTerrainAssets(worldId) {
  const key = canonicalWorldKey(worldId);
  const assetKeys = pbrAssetsForWorld(key);
  const entries = await Promise.all(assetKeys.map(async (assetKey) => [assetKey, await loadPbrAsset(assetKey)]));
  return Object.freeze({
    worldKey: key,
    assets: Object.freeze(Object.fromEntries(entries)),
  });
}

function repeatForWorld(world, settings) {
  const width = Math.max(1, finite(world?.width, 320));
  const height = Math.max(1, finite(world?.height, 230));
  const patch = Math.max(1, finite(settings.patchMeters, 20));
  return [Math.max(1, width / patch), Math.max(1, height / patch)];
}

function addTerrainDetailBlend(material, detailStrength, meanColor, {
  attenuateNormals = false,
  attenuateRoughness = false,
  meanRoughness = 1,
} = {}) {
  const uniforms = {
    terrainDetailStrength: { value: clamp(detailStrength, 0, 1) },
    terrainMeanColor: { value: new THREE.Vector3(...meanColor) },
    terrainMeanRoughness: { value: clamp(meanRoughness, 0, 1) },
  };
  material.userData.terrainUniforms = uniforms;
  material.userData.terrainDetailConvention =
    'Set a float terrainDetail attribute per vertex; 1 is rich detail and 0 is quiet detail. Keep the color attribute RGB (or RGB plus alpha 1) for opaque tinting.';
  const previousOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previousOnBeforeCompile === 'function') previousOnBeforeCompile(shader, renderer);
    shader.uniforms.terrainDetailStrength = uniforms.terrainDetailStrength;
    shader.uniforms.terrainMeanColor = uniforms.terrainMeanColor;
    if (attenuateRoughness) shader.uniforms.terrainMeanRoughness = uniforms.terrainMeanRoughness;
    // Use a dedicated scalar attribute instead of color alpha.  Three's
    // color_fragment multiplies all four vColor components into diffuseColor;
    // reusing alpha there would make poor ground transparent.
    shader.vertexShader = `attribute float terrainDetail;\nvarying float vTerrainDetail;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      '#include <color_vertex>\n\tvTerrainDetail = clamp( terrainDetail, 0.0, 1.0 );',
    );
    shader.fragmentShader = `uniform float terrainDetailStrength;\nuniform vec3 terrainMeanColor;\n${attenuateRoughness ? 'uniform float terrainMeanRoughness;\n' : ''}varying float vTerrainDetail;\n${shader.fragmentShader}`;
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
    if (attenuateRoughness) {
      // Quiet terrain keeps the source material's average roughness, removing
      // false specular variation where the diffuse and normal detail are muted.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
#ifdef USE_ROUGHNESSMAP
	float terrainRoughnessDetail = clamp( terrainDetailStrength * clamp( vTerrainDetail, 0.0, 1.0 ), 0.0, 1.0 );
	roughnessFactor = mix( roughness * terrainMeanRoughness, roughnessFactor, terrainRoughnessDetail );
#endif`,
      );
    }
    if (attenuateNormals) {
      // Keep PBR relief tied to the same rich/poor terrain mask as the color
      // texture. A quiet patch therefore returns to the geometric normal
      // instead of revealing an artificial bumpy field through flat color.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `float terrainNormalDetail = clamp( terrainDetailStrength * clamp( vTerrainDetail, 0.0, 1.0 ), 0.0, 1.0 );
#include <normal_fragment_maps>
#ifdef USE_NORMALMAP
	normal = normalize( mix( nonPerturbedNormal, normal, terrainNormalDetail ) );
#endif`,
      );
    }
  };
  const previousProgramKey = material.customProgramCacheKey?.bind(material);
  const pbrCacheSuffix = attenuateNormals || attenuateRoughness
    ? `|terrain-normal-detail-${attenuateNormals ? 1 : 0}|terrain-roughness-detail-${attenuateRoughness ? 1 : 0}`
    : '';
  material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|terrain-detail-attribute-v2${pbrCacheSuffix}`;
  return material;
}

function clonedTexture(source, repeat, maxAnisotropy, owned, managed, colorSpace = 'srgb') {
  if (!source) return null;
  const texture = source.clone();
  configureTexture(texture, { repeat, maxAnisotropy, colorSpace });
  if (owned instanceof Set) owned.add(texture);
  if (managed instanceof Set) managed.add(texture);
  return texture;
}

function sourceBundle(assetKey, fallbackKey) {
  const pbrSource = PBR_SOURCE_TEXTURES.get(assetKey) || null;
  const legacySource = SOURCE_TEXTURES[fallbackKey] || SOURCE_TEXTURES[assetKey] || null;
  return {
    map: pbrSource?.map || legacySource,
    normalMap: pbrSource?.normalMap || null,
    roughnessMap: pbrSource?.roughnessMap || null,
    meanColor: pbrSource?.meanColor || SOURCE_MEANS[fallbackKey] || SOURCE_MEANS[assetKey] || DEFAULT_TERRAIN_MEAN,
    meanRoughness: pbrSource?.meanRoughness ?? 1,
    loaded: Boolean(pbrSource),
  };
}

function attachPbrMaps(material, assetKey, repeat, maxAnisotropy, owned, managed) {
  const source = PBR_SOURCE_TEXTURES.get(assetKey);
  if (!source) return false;
  const config = PBR_TERRAIN_ASSETS[assetKey];
  let changed = false;
  const maps = [
    ['map', source.map, 'srgb', config?.diffuseKey],
    ['normalMap', source.normalMap, 'linear', null],
    ['roughnessMap', source.roughnessMap, 'linear', null],
  ];
  for (const [property, sourceTexture, colorSpace, reuseKey] of maps) {
    if (!sourceTexture) continue;
    // Existing grass diffuse images are already loaded and cloned before a
    // direct factory call; keep that clone instead of replacing it needlessly.
    if (property === 'map' && reuseKey && sourceTexture === SOURCE_TEXTURES[reuseKey] && material.map) continue;
    const next = clonedTexture(sourceTexture, repeat, maxAnisotropy, owned, managed, colorSpace);
    const previous = material[property];
    material[property] = next;
    if (previous && managed.has(previous)) {
      managed.delete(previous);
      if (owned instanceof Set) owned.delete(previous);
      previous.dispose();
    }
    changed = true;
  }
  const terrainUniforms = material.userData?.terrainUniforms;
  if (terrainUniforms?.terrainMeanColor) {
    terrainUniforms.terrainMeanColor.value.set(...source.meanColor);
  }
  if (terrainUniforms?.terrainMeanRoughness) {
    terrainUniforms.terrainMeanRoughness.value = source.meanRoughness ?? 1;
  }
  if (changed) material.needsUpdate = true;
  return changed;
}

function prepareAssetGroup(world, requiredAssets = []) {
  const key = canonicalWorldKey(world);
  const assetKeys = pbrAssetsForWorld(key, requiredAssets);
  return Promise.all(assetKeys.map(async (assetKey) => [assetKey, await loadPbrAsset(assetKey)]))
    .then((entries) => Object.freeze({ worldKey: key, assets: Object.freeze(Object.fromEntries(entries)) }));
}

function createOwnedMaterialState(material, owned) {
  const managed = new Set();
  let disposed = false;
  material.addEventListener('dispose', () => {
    disposed = true;
    for (const texture of managed) {
      if (owned instanceof Set) owned.delete(texture);
      texture.dispose();
    }
    managed.clear();
  });
  return {
    managed,
    get disposed() { return disposed; },
  };
}

function createTextureBundle(assetKey, fallbackKey, repeat, maxAnisotropy, owned, managed) {
  const source = sourceBundle(assetKey, fallbackKey);
  return {
    map: clonedTexture(source.map, repeat, maxAnisotropy, owned, managed, 'srgb'),
    normalMap: clonedTexture(source.normalMap, repeat, maxAnisotropy, owned, managed, 'linear'),
    roughnessMap: clonedTexture(source.roughnessMap, repeat, maxAnisotropy, owned, managed, 'linear'),
    meanColor: source.meanColor,
    meanRoughness: source.meanRoughness ?? 1,
    loaded: source.loaded,
  };
}

function returnedMaterial(material, key, settings, assetsReady) {
  const result = { material, key, settings, assetsReady };
  Object.defineProperty(result, 'texture', { enumerable: true, get: () => material.map });
  return result;
}

/**
 * Create one world terrain material and a promise for its local asset group.
 *
 * The returned texture is a per-world clone.  Callers that own a renderer can
 * pass its resource Set as `owned`; disposing that Set will release the clone,
 * while the module-level source images stay CPU-only and are never attached to
 * a scene. Prepare a full world with `prepareTerrainAssets` before creating its
 * materials to avoid any map changes after construction. Direct callers may
 * await the returned `assetsReady` before rendering.
 */
export function createTerrainMaterial(world, { owned = null, maxAnisotropy = 4, detailStrength, normalStrength, variant, asset: assetOverride, loader: _loader = null } = {}) {
  const requestedKey = variant && TERRAIN_MATERIAL_SETTINGS[variant] ? variant : worldKey(world);
  const key = requestedKey;
  const settings = TERRAIN_MATERIAL_SETTINGS[key];
  const repeat = repeatForWorld(world, settings);
  const assetKey = assetOverride && TERRAIN_ASSETS[assetOverride] ? assetOverride : settings.asset;
  const assetConfig = PBR_TERRAIN_ASSETS[assetKey];
  const fallbackKey = assetConfig?.fallbackKey || assetConfig?.diffuseKey || assetKey;
  const managed = new Set();
  const bundle = createTextureBundle(assetKey, fallbackKey, repeat, maxAnisotropy, owned, managed);
  const material = new THREE.MeshStandardMaterial({
    color: settings.color,
    map: bundle.map,
    normalMap: bundle.normalMap,
    roughnessMap: bundle.roughnessMap,
    vertexColors: true,
    roughness: settings.roughness,
    metalness: settings.metalness,
    flatShading: false,
    side: THREE.DoubleSide,
  });
  const state = createOwnedMaterialState(material, owned);
  // createTextureBundle populated this same Set before the material existed.
  for (const texture of managed) state.managed.add(texture);
  const detail = detailStrength == null ? settings.detailStrength : detailStrength;
  const normal = assetConfig?.normal
    ? clamp(normalStrength == null ? settings.normalStrength : normalStrength, 0, 1)
    : 0;
  const attenuateNormals = Boolean(assetConfig?.normal) && normal > 0;
  const attenuateRoughness = Boolean(assetConfig?.roughness);
  if (assetConfig?.normal) material.normalScale.set(normal, normal);
  addTerrainDetailBlend(material, detail, bundle.meanColor, {
    attenuateNormals,
    attenuateRoughness,
    meanRoughness: bundle.meanRoughness,
  });
  material.userData.terrainWorldKey = key;
  material.userData.terrainAssetKey = assetKey;
  material.userData.terrainRepeat = repeat.slice();
  material.userData.terrainNormalStrength = normal;
  material.userData.terrainAssets = TERRAIN_ASSETS[assetKey];
  if (owned instanceof Set) owned.add(material);
  if (!assetConfig) return returnedMaterial(material, key, settings, terrainAssetsReady);

  const attachIfReady = () => {
    if (state.disposed) return PBR_SOURCE_TEXTURES.get(assetKey) || null;
    attachPbrMaps(material, assetKey, repeat, maxAnisotropy, owned, state.managed);
    return PBR_SOURCE_TEXTURES.get(assetKey) || null;
  };
  const assetsReady = bundle.loaded
    ? Promise.resolve(PBR_SOURCE_TEXTURES.get(assetKey) || null)
    : prepareAssetGroup(world, [assetKey]).then(attachIfReady);
  return returnedMaterial(material, key, settings, assetsReady);
}

/** Create the PBR surface material used by gravel, asphalt, and shoulders. */
export function createRoadMaterial(world, { variant, owned = null, maxAnisotropy = 4, patchMeters, normalStrength } = {}) {
  const requested = ROAD_MATERIAL_SETTINGS[variant]
    ? variant
    : (canonicalWorldKey(world) === 'ann-arbor' ? 'asphalt' : 'gravel');
  const settings = ROAD_MATERIAL_SETTINGS[requested];
  const patch = clamp(patchMeters == null ? settings.patchMeters : patchMeters, 0.25, 128);
  const repeat = [1 / patch, 1 / patch];
  const assetKey = settings.asset;
  const source = sourceBundle(assetKey, assetKey);
  const managed = new Set();
  const material = new THREE.MeshStandardMaterial({
    color: settings.color,
    map: clonedTexture(source.map, repeat, maxAnisotropy, owned, managed, 'srgb'),
    normalMap: clonedTexture(source.normalMap, repeat, maxAnisotropy, owned, managed, 'linear'),
    roughnessMap: clonedTexture(source.roughnessMap, repeat, maxAnisotropy, owned, managed, 'linear'),
    vertexColors: false,
    roughness: settings.roughness,
    metalness: settings.metalness,
    flatShading: false,
    side: THREE.DoubleSide,
  });
  const state = createOwnedMaterialState(material, owned);
  for (const texture of managed) state.managed.add(texture);
  const normal = clamp(normalStrength == null ? settings.normalStrength : normalStrength, 0, 1);
  material.normalScale.set(normal, normal);
  material.userData.terrainWorldKey = canonicalWorldKey(world);
  material.userData.terrainAssetKey = assetKey;
  material.userData.terrainRepeat = repeat.slice();
  material.userData.terrainPatchMeters = patch;
  material.userData.terrainNormalStrength = normal;
  material.userData.terrainAssets = TERRAIN_ASSETS[assetKey];
  if (owned instanceof Set) owned.add(material);
  const attachIfReady = () => {
    if (state.disposed) return PBR_SOURCE_TEXTURES.get(assetKey) || null;
    attachPbrMaps(material, assetKey, repeat, maxAnisotropy, owned, state.managed);
    return PBR_SOURCE_TEXTURES.get(assetKey) || null;
  };
  const assetsReady = source.loaded
    ? Promise.resolve(PBR_SOURCE_TEXTURES.get(assetKey) || null)
    : prepareAssetGroup(world, [assetKey]).then(attachIfReady);
  return returnedMaterial(material, requested, settings, assetsReady);
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
