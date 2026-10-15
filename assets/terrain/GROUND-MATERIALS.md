# Terrain material credits

The browser terrain uses four locally bundled JPEG diffuse maps.
They are loaded from `assets/budget-planning/terrain-materials.js` with module
relative URLs, so the demo has no runtime dependency on a texture host.

All four source assets are from [Poly Haven](https://polyhaven.com/). Poly
Haven's [asset license](https://polyhaven.com/license) states that its HDRIs,
textures, and models are released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
Attribution is not required for the downloaded CC0 files; this record is kept
so the source and provenance remain clear.

| Local file | World use | Official source and creator | Size / integrity |
| --- | --- | --- | --- |
| `polyhaven-dirt-1k.jpg` | Farm soil and field base | [Dirt](https://polyhaven.com/a/dirt), Charlotte Baglioni | 730,425 bytes, 1024 × 1024, MD5 `cb37e24797597b1dd1ae3819fa80f076` |
| `polyhaven-sparse-grass-512.jpg` | Optional farm grass-forward surface | [Sparse Grass](https://polyhaven.com/a/sparse_grass), Amal Kumar | 40,231 bytes, 512 × 512, MD5 `9d67443eef445f61c0e685e96ce610b4` |
| `polyhaven-sandy-gravel-1k.jpg` | Tucson gravel and sandy basin | [Sandy Gravel](https://polyhaven.com/a/sandy_gravel), Charlotte Baglioni | 795,227 bytes, 1024 × 1024, MD5 `9808ac7c155cff11314a4fe200255c50` |
| `polyhaven-leafy-grass-1k.jpg` | Ann Arbor lawns and campus ground | [Leafy Grass](https://polyhaven.com/a/leafy_grass), Charlotte Baglioni | 1,195,394 bytes, 1024 × 1024, MD5 `0dbc071e91d6905edfcfbe8eb785a1ab` |

The sparse-grass file is a Lanczos downsample of Poly Haven's official 1k
diffuse JPEG (`sparse_grass_diff_1k.jpg`, 955,945 bytes, MD5
`5d0aba796e1b5882555161c16b10ee9d`). The derivative stays under the bundle
budget while preserving the original CC0 provenance.

The combined checked-in payload is 2,761,277 bytes. The JPEGs are diffuse
color maps only; the demo does not ship a normal map so the bundle stays below
the 3 MB terrain budget and the existing terrain geometry remains the source
of surface relief.

The official Poly Haven API records used to select the exact 1k files are:

- [`/files/dirt`](https://api.polyhaven.com/files/dirt)
- [`/files/sparse_grass`](https://api.polyhaven.com/files/sparse_grass)
- [`/files/sandy_gravel`](https://api.polyhaven.com/files/sandy_gravel)
- [`/files/leafy_grass`](https://api.polyhaven.com/files/leafy_grass)

Those API records provide the download URLs, byte sizes, and MD5 values above.
The checked-in files are self-hosted copies; no API or download request is
made by the application.

## Material use

`assets/budget-planning/terrain-materials.js` exports `createTerrainMaterial`
and `createTerrainMaterials`. Each returned material uses a per-world clone of
one local diffuse map, `THREE.SRGBColorSpace`, `RepeatWrapping`, trilinear
mipmaps, and bounded anisotropy. The repeat count is based on world dimensions
and a broad 19–24 m patch so the photographic detail reads as ground instead of
a small checkerboard. The default farm preset uses `dirt`; pass
`{ variant: 'farmGrass' }` (or `{ asset: 'sparseGrass' }`) when a grass-forward
farm surface is needed.

The material's shader reduces map contrast smoothly with a dedicated scalar
`terrainDetail` vertex attribute. Set `terrainDetail = 1` for a rich feature
region and `terrainDetail = 0` for a quiet region; values between those
endpoints create a continuous blend. Keep the terrain color attribute as RGB
(or RGB plus alpha 1) so all ground remains opaque; the detail attribute does
not alter vertex-color tinting. The quiet endpoint blends to each source image's
linear-space mean color, so muted sand and grass keep their natural base hue.
