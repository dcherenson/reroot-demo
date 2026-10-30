# Ground and road material assets

The diffuse, OpenGL normal, and roughness maps listed below are self-hosted
copies of assets from [Poly Haven](https://polyhaven.com/). Poly Haven releases
its textures under [CC0 1.0 Universal](https://polyhaven.com/license); credit is
not required. This record keeps the original asset pages, creators, API source
files, and checksums together with the optimized files used by the demo.

## Existing diffuse textures

These four files remain in the initial terrain load group so the existing
fallbacks and Tucson surface keep their current behavior.

| Local file | Use | Source and creator | Size / integrity |
| --- | --- | --- | --- |
| `polyhaven-dirt-1k.jpg` | Legacy soil fallback | [Dirt](https://polyhaven.com/a/dirt), Charlotte Baglioni | 730,425 bytes, 1024 × 1024, MD5 `cb37e24797597b1dd1ae3819fa80f076` |
| `polyhaven-sparse-grass-512.jpg` | Farm grass diffuse | [Sparse Grass](https://polyhaven.com/a/sparse_grass), Amal Kumar | 40,231 bytes, 512 × 512, MD5 `9d67443eef445f61c0e685e96ce610b4` |
| `polyhaven-sandy-gravel-1k.jpg` | Tucson diffuse | [Sandy Gravel](https://polyhaven.com/a/sandy_gravel), Charlotte Baglioni | 795,227 bytes, 1024 × 1024, MD5 `9808ac7c155cff11314a4fe200255c50` |
| `polyhaven-leafy-grass-1k.jpg` | Ann Arbor diffuse | [Leafy Grass](https://polyhaven.com/a/leafy_grass), Charlotte Baglioni | 1,195,394 bytes, 1024 × 1024, MD5 `0dbc071e91d6905edfcfbe8eb785a1ab` |

The sparse-grass diffuse is a Lanczos downsample of the official 1k file
(`sparse_grass_diff_1k.jpg`, 955,945 bytes, MD5
`5d0aba796e1b5882555161c16b10ee9d`).

## Added PBR textures

Poly Haven's API records for each asset are available at
[`/files/farm_soil`](https://api.polyhaven.com/files/farm_soil),
[`/files/sparse_grass`](https://api.polyhaven.com/files/sparse_grass),
[`/files/leafy_grass`](https://api.polyhaven.com/files/leafy_grass),
[`/files/gravel_road`](https://api.polyhaven.com/files/gravel_road), and
[`/files/road_damaged_clean`](https://api.polyhaven.com/files/road_damaged_clean).
The original 1k JPG maps were resized to 512 × 512 with Lanczos filtering.
Diffuse outputs are JPEG; normal outputs are RGB PNG; roughness outputs are
grayscale PNG. Every output checksum below is SHA-256. Source map checksums are
the API-provided MD5 values.

| Local file | Source map | Original 1k file (bytes; MD5) | Output (bytes; SHA-256) |
| --- | --- | --- | --- |
| `polyhaven-farm-soil-512-diffuse.jpg` | [Farm Soil](https://polyhaven.com/a/farm_soil), Amal Kumar, diffuse | `farm_soil_diff_1k.jpg` (735,837; `29fad1e29469e644759032c3ade249fa`) | 30,549; `8b1b6e4c7aa38dcb0c5e089363eb87b3ac9410dc44f097bbd339e3fa883d661b` |
| `polyhaven-farm-soil-512-normal-gl.png` | Farm Soil, Normal (GL) | `farm_soil_nor_gl_1k.jpg` (1,541,114; `e0afe5e537ed2869ddd4d0cfe1b529b5`) | 679,373; `1d1ea4f1e8fd51b7d25b0eec6c002898f848ee856f9b2340997c2eed115cc030` |
| `polyhaven-farm-soil-512-roughness.png` | Farm Soil, roughness | `farm_soil_rough_1k.jpg` (279,247; `e671f4453ea99fb209d53ded77e7f82b`) | 87,153; `079ce37835780027d479f4df685f58c697a55afb9c77d38f9b62cb1c05efa69f` |
| `polyhaven-sparse-grass-512-normal-gl.png` | [Sparse Grass](https://polyhaven.com/a/sparse_grass), Amal Kumar, Normal (GL) | `sparse_grass_nor_gl_1k.jpg` (1,440,314; `3307e6ce47413c6b4e85885d4b8ae932`) | 637,947; `b06feaae61b9ce79dd1e64750010c25c144034c72dd28ffa10c2b3fa5b92f418` |
| `polyhaven-sparse-grass-512-roughness.png` | Sparse Grass, roughness | `sparse_grass_rough_1k.jpg` (463,340; `acf2fd7e352e7635f67f24ecda01e485`) | 135,911; `4961b13355bbb1e0731f3509739a4e6d862f426fc77838702391a683d342c8f1` |
| `polyhaven-leafy-grass-512-normal-gl.png` | [Leafy Grass](https://polyhaven.com/a/leafy_grass), Charlotte Baglioni, Normal (GL) | `leafy_grass_nor_gl_1k.jpg` (1,466,049; `8279e096e204ea326d57a318869f99df`) | 644,151; `5b13bd55c42f4d11ee6004397d797033e5914adda609728ab887635c30eb80f4` |
| `polyhaven-leafy-grass-512-roughness.png` | Leafy Grass, roughness | `leafy_grass_rough_1k.jpg` (511,385; `05f6bb1383e12b327727d313c5899cf2`) | 132,134; `4944ac749d2978be62c1fc598486149d02a88734bdf7857fe8ae1598ad630b79` |
| `polyhaven-gravel-road-512-diffuse.jpg` | [Gravel Road](https://polyhaven.com/a/gravel_road), Amal Kumar, diffuse | `gravel_road_diff_1k.jpg` (684,038; `d259491a6cb5ca0e96d3941758f8bb47`) | 14,718; `03394ecdf5b46d13bb7a7d774a862253ac1e300de140cea41831274a61d48c1e` |
| `polyhaven-gravel-road-512-normal-gl.png` | Gravel Road, Normal (GL) | `gravel_road_nor_gl_1k.jpg` (983,723; `6be4a6d4c869c9714c0224619d587837`) | 534,994; `6b1fdeb09612d114496def9cbc2bf49342f0d6d5d5593f439ed5cc4ab1b150cb` |
| `polyhaven-gravel-road-512-roughness.png` | Gravel Road, roughness | `gravel_road_rough_1k.jpg` (361,584; `2666aa6329169e7a8a24b892a977c2b1`) | 119,408; `bee3e36049206a51e286d21b01e88d82f9bdc3a992c533957ca593a9ec64b9e8` |
| `polyhaven-road-damaged-clean-512-diffuse.jpg` | [Road Damaged Clean](https://polyhaven.com/a/road_damaged_clean), Dimitrios Savva, diffuse | `road_damaged_clean_diff_1k.jpg` (810,889; `31f5131c8001abc89d8e22582ce20f76`) | 17,635; `7bfabf31a1cb5be4156d8e706fb8f447fb9cfdf568b21414559408650ef50526` |
| `polyhaven-road-damaged-clean-512-normal-gl.png` | Road Damaged Clean, Normal (GL) | `road_damaged_clean_nor_gl_1k.jpg` (1,017,836; `2ca48cf0a9f8cb84b8f5704b441f549f`) | 532,659; `f5fa028c4390900a6ed1274a88b3fdd8878f154945770e10c1b73da9f0083302` |
| `polyhaven-road-damaged-clean-512-roughness.png` | Road Damaged Clean, roughness | `road_damaged_clean_rough_1k.jpg` (652,417; `d109e1e7aa0119412dae597fec8d4230`) | 166,817; `0fabc0da2e5005cd38b8439682fba9ae1a458c0467677a14fe84fb02dc82c56c` |

The new files add 3,733,449 bytes. The earlier four diffuse maps add
2,761,277 bytes, for 6,494,726 bytes across the complete terrain material set.
The 512px PBR resolution keeps the added bundle below the preferred 6 MB while
retaining surface detail suitable for these ground and road views.

## Material API and rendering notes

`assets/budget-planning/terrain-materials.js` exports
`prepareTerrainAssets(worldId)`, `createTerrainMaterial`, and
`createRoadMaterial`. Await `prepareTerrainAssets(worldId)` before constructing
a mission or its sensor frames. It loads the selected world's maps as grouped
local requests. Farm loads farm soil, sparse grass, and gravel road; Ann Arbor
loads leafy grass, gravel road, and asphalt; Tucson resolves immediately and
requests no new PBR maps. Missing files and individual requests that exceed the
10-second texture timeout settle to the existing diffuse or solid-color
fallbacks.

For direct material use, `createTerrainMaterial(...)` and
`createRoadMaterial(...)` each return an `assetsReady` promise. Await it before
rendering if `prepareTerrainAssets` was not called first. The factories clone
their loaded source maps per material. Disposing the material releases its
cloned maps; a caller can also pass a resource `Set` through `owned` to track
the material with other renderer resources. Cached module source images are
not attached to scene objects.

Diffuse maps use `THREE.SRGBColorSpace`. Normal and roughness maps use
`THREE.NoColorSpace` so lighting interprets them as data. Farm and Ann Arbor
grass use six-metre patches with restrained normal scales; field
soil keeps its broader preset because fields have local normalized UVs. Their
diffuse contrast, normal relief, and roughness variation follow
the `terrainDetail` vertex attribute: 1 keeps full detail and 0 blends to the
mean color, geometric normal, and mean roughness in a poor-feature region.
Keep that attribute on terrain geometry and keep vertex colors RGB (or RGB
plus alpha 1) for opaque tinting.

Road UVs are expected in world meters. Use
`createRoadMaterial(world, { variant: 'gravel' | 'asphalt' | 'shoulder' })`;
the factory sets both texture repeats to `1 / patchMeters`. The defaults use
2 m for gravel and 2.2 m for asphalt, matching the source texture dimensions.
Shoulders reuse gravel with a lighter tint. Override `patchMeters` to change
the physical tile size. `roadEdge` is left for the road geometry's shader to
fade to the underlying ground.

The Tucson terrain preset still uses its existing sandy-gravel diffuse JPEG,
repeat settings, detail strength, and shader path. It does not load or attach
the new PBR maps. `createTerrainMaterial(world, { variant: 'legacySoil' })`
keeps the original dirt diffuse preset for existing Tucson plaza and runway
surfaces that use a soil-style overlay.
