# Scanned rock assets

## Source and license

The two local meshes and their photographs come from [Poly Haven's Rock Moss
Set 01](https://polyhaven.com/a/rock_moss_set_01), by Kless Gyzen. Poly Haven
marks the asset CC0 and permits redistribution; attribution is optional. The
[official license page](https://polyhaven.com/license) confirms that assets
are CC0. The [official info API](https://api.polyhaven.com/info/rock_moss_set_01)
reports 63,127 triangles across six rocks and set dimensions of
8.0046 × 6.9488 × 1.7683 m. This package includes source meshes `rock03` and
`rock06`, with 5,000 and 8,994 triangles respectively.

## Local payload

| File | Bytes | Contents |
| --- | ---: | --- |
| `rock-moss-set-01-geometry.bin` | 323,612 | Two normalized meshes: positions, normals, UVs, and indices |
| `rock-moss-set-01-diffuse-1k.jpg` | 168,099 | Photo diffuse map |
| `rock-moss-set-01-normal-gl-1k.jpg` | 209,975 | OpenGL tangent-space normal map |
| `rock-moss-set-01-roughness-1k.jpg` | 82,624 | Photo-derived roughness map |
| **Total model and texture payload** | **784,310** | **About 766 KiB** |

The images are the original Poly Haven 1K JPEGs. They are loaded from this
repository only; the browser makes no Poly Haven requests. The total model and
texture payload remains below 1 MB.

## Processing

Source glTF: `rock_moss_set_01_1k.gltf`, with the official external binary
buffer. The six collection nodes place rocks in a set layout; their node
translations are omitted so each selected rock has a centered local origin.
For each selected mesh, let its source bounds be `(minX, minY, minZ)` to
`(maxX, maxY, maxZ)`. The conversion applies one uniform factor
`s = 1 / max(maxX - minX, maxZ - minZ)` and changes positions to:

```text
x' = (x - (minX + maxX) / 2) * s
y' = (y - minY) * s
z' = (z - (minZ + maxZ) / 2) * s
```

This gives each rock a maximum X/Z footprint of one unit, centers it in X/Z,
and places its lowest vertex at y=0. The operation preserves the source
Float32 normals and UV coordinates unchanged. The geometry output uses
little-endian Float32 positions, normals, UVs and little-endian Uint16 indices;
each attribute chunk begins at a four-byte aligned offset. Meshes are kept
separate so callers can instance each silhouette independently.

[glTF 2.0 section 3.8.4.3](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
defines `(0, 0)` at the upper-left image pixel. Since the original UVs remain
unchanged, the Three.js texture clones set `flipY=false`, following the
official [Three.js `GLTFLoader`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/GLTFLoader.js).
The normal photograph is the supplied OpenGL tangent space map (`nor_gl`);
its channels are used as authored, with no green-channel or tangent-space Y
inversion.

| Mesh | Vertices | Triangles | Source X/Z footprint | Scale | Output bounds (X × Y × Z) |
| --- | ---: | ---: | ---: | ---: | --- |
| `rock03` (glTF mesh 2) | 2,741 | 5,000 | 2.10858 m | 0.4742522263 | 1.000 × 0.522 × 0.986 |
| `rock06` (glTF mesh 5) | 4,748 | 8,994 | 2.75730 m | 0.3626732198 | 0.771 × 0.458 × 1.000 |

The conversion can be repeated with Node built-ins, using the original glTF
and `.bin` downloaded from the official API:

```sh
node scripts/prepare-scanned-rocks.mjs source.gltf source.bin
```

The script prints the exact output offsets, bounds, triangle counts, size, and
SHA-256 so the generated file can be compared with the manifest below.

## Checksums

The source checksums are MD5 values from Poly Haven's files API. Output
checksums are SHA-256 values of the checked-in files.

| File | Source MD5 | Local SHA-256 |
| --- | --- | --- |
| Source `rock_moss_set_01_1k.gltf` | `75113cc1c21806cca5d8badad4737af7` | — |
| Source `rock_moss_set_01.bin` | `207a51c9f56d34732e9814bbf9cc07b1` | — |
| `rock-moss-set-01-geometry.bin` | Derived | `6f963d78253564a0f874b30744712ab89d9dffc4c597c5fe46c617f5e34bbd47` |
| `rock-moss-set-01-diffuse-1k.jpg` | `b8742301e6b4bc5683d2de712e83f772` | `40cea65d8aa4ee73a93b04af19963834d061eee9779c3fc2c1cba76eef812ccc` |
| `rock-moss-set-01-normal-gl-1k.jpg` | `eb7ebd31ad08e78d0497900652ff1568` | `eb4aad3f207f1dc5b624d74ae240372171626a66912bd71adf7bd3e518181d6e` |
| `rock-moss-set-01-roughness-1k.jpg` | `ed9d8a2c863262f76f881346e8047c6a` | `4d6ec46623abd8e2cdb855f59c7ce31873ad61b36b60e4de579e9e776a497c6b` |

## Factory contract

`assets/budget-planning/scanned-rocks.js` exports
`prepareScannedRocks(worldId)` and `createScannedRockAssets({ owned,
maxAnisotropy })`. Call `await prepareScannedRocks(worldId)` before synchronous
world construction. It starts local requests only for Farm or Ann Arbor, waits
at most eight seconds for the geometry and textures, caches the decoded source
resources, and returns `false` for Tucson, Node, or a missing required asset.
The factory returns `null` until preparation succeeds. Otherwise it returns
`geometry` and `material` aliases for the first rock, `models` for both
silhouettes, and `variants` for the second rock. Both models share the
photographic material.

Each factory call creates renderer-owned geometries and clones its textures.
When `owned` is a `Set`, the factory adds the geometries, material, and cloned
textures to it. Module-level decoded source images and bytes are cached and
remain outside the renderer's disposal set, so resetting a world cannot
dispose shared source resources. Imports are Node-safe and do not fetch or
access `document`.
