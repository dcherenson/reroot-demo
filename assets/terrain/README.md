# Offline terrain asset provenance

`ground-elevation.js` contains compact, offline heightfields exported from the USGS
3D Elevation Program (3DEP) bare-earth DEM ImageServer. The data is embedded in the
repository; the browser does not contact USGS at runtime. `tucson-catalina.js` is a
compatibility entry point that re-exports the centered Catalina snapshot.

## Source, license, and reproducibility

The shared source service is the USGS 3DEP ImageServer:

- <https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer>
- Program and product information: <https://www.usgs.gov/3d-elevation-program/about-3dep-products-services>
- USGS citation guidance: <https://www.usgs.gov/faqs/how-should-i-cite-datasets-and-services-national-map>
- ArcGIS `exportImage` operation: <https://developers.arcgis.com/rest/services-reference/enterprise/export-image.htm>

USGS describes 3DEP products as available free of charge and without use
restrictions. The exported elevation samples are therefore redistributable public-domain
USGS data. Keep this attribution and the source URLs with downstream copies.

The snapshots were retrieved on 2026-10-15 using WGS 84 (`bboxSR=4326` and
`imageSR=4326`), `adjustAspectRatio=false`, `format=tiff`, `pixelType=F32`, and
bilinear export interpolation. These are the exact requests used:

```text
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-110.88,32.35,-110.70,32.53&bboxSR=4326&imageSR=4326&size=129,129&adjustAspectRatio=false&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-83.80,42.24,-83.67,42.34&bboxSR=4326&imageSR=4326&size=65,65&adjustAspectRatio=false&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-83.95,42.25,-83.86,42.32&bboxSR=4326&imageSR=4326&size=65,65&adjustAspectRatio=false&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image
```

## Baked grids

| Export | WGS 84 extent (west, south, east, north) | Grid | Elevation range | Peak sample | Source TIFF SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `TUCSON_CATALINA_TERRAIN` | `(-110.88, 32.35, -110.70, 32.53)` | 129 x 129 | 923.9875–2778.5183 m | grid (65, 63), about `(-110.7886, 32.4414)` | `f2046131e24d01caffa1949603ac1b6a373059479f5d0fd76e87613672d950fe` |
| `ANN_ARBOR_CAMPUS_TERRAIN` | `(-83.80, 42.24, -83.67, 42.34)` | 65 x 65 | 227.4906–321.9293 m | grid (1, 51) | `70dc22e0289dbf7014c8f533bf11baf34aad86f5a23ab8c1bdf5347d39692f2f` |
| `ANN_ARBOR_WEST_FARM_TERRAIN` | `(-83.95, 42.25, -83.86, 42.32)` | 65 x 65 | 258.6298–289.6837 m | grid (18, 9) | `f22ab3c1892d8d70661f95c5673d373c5aebcda393e126a0255752fed2fae428` |

The Tucson crop is centered on the Catalina/Mount Lemmon ridge area. Its mean
adjacent-sample elevation change is about 30.06 m and its 95th-percentile change is
about 73.51 m, retaining real ridges, drainages, and gullies instead of a smooth
analytic cone. The two Ann Arbor crops provide lower-amplitude campus and farm hill
topology for other worlds.

Each source elevation is linearly quantized to a little-endian unsigned 16-bit sample.
The embedded arrays contain 16,641 Tucson samples and 4,225 samples per Ann Arbor
crop. Quantized byte hashes are:

```text
Tucson Catalina:  f86762f83e9889e260cf5fbfe4b9b074c3d0a2729ec5d9fdfd6e7f48f8f49273
Ann Arbor campus: 4c26b9b81a1702e391acac345dab18b2e44e56d4ca3d55b197fbb10933dd6b42
Ann Arbor farm:   f537d84eae3fc3c13972baae9c54c23b8365878a59c8e60c2859770b95bdd3e0
```

## Sampling and integration

Rows are stored north to south and columns west to east. In normalized coordinates,
`u=0,v=0` is the northwest corner and `u=1,v=1` is the southeast corner. The module
exports `sampleTerrainHeightfield(field, u, v, feather)` plus named samplers for all
three regions. Sampling is bilinear, returns a normalized nonnegative value in
`[0, 1]`, and returns `0` outside the patch. The default `feather=0.08` applies a
smooth edge fade in normalized grid units; pass `0` for the raw normalized field.

To recover metres from a normalized sample, use the terrain object's
`minElevationMeters` and `maxElevationMeters` metadata. For a game height contribution,
subtract the desired local baseline and scale the resulting normalized range. The same
sampler can feed render mesh vertices, collision queries, and line-of-sight tests so
all systems use one surface. A mesh may be triangulated from neighboring grid samples;
no runtime network or TIFF decoder is needed.
