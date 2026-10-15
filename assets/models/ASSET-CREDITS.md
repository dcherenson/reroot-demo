# Vegetation model credits and licenses

The browser demo uses the small static mesh set in
`quaternius-nature.js` and `quaternius-nature-parts.js` for ordinary trees,
bushes, grass, and rocks. These files are a loader-free conversion of four
low-poly OBJ meshes from Quaternius's `Nature pack vol.3` (the vertices and
triangle indices are kept locally so the scene never fetches an asset at
runtime). The companion parts file preserves the source tree's bark and
foliage material groups so the trunk is rendered with a bark color. Saguaros
and ocotillo are original procedural geometry in
`assets/budget-planning/vegetation-models.js`, because the source pack does not
contain those silhouettes.

The vendored Quaternius model data is released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
This CC0 notice applies to the imported Quaternius mesh data. The original
procedural model code is part of the application.

Model sources and visual references:

- [Poly Pizza](https://poly.pizza/) — low-poly model reference and browsing
  inspiration. Poly Pizza's terms require each downloaded model's applicable
  Creative Commons license to be followed; no model was downloaded from Poly Pizza.
- [Poly Pizza terms of service](https://poly.pizza/docs/tos) — confirms that
  downloaded user content is governed by its per-model Creative Commons
  license.
- [Quaternius LowPoly Nature Pack](https://quaternius.itch.io/150-lowpoly-nature-models)
  — primary source for the CC0 model family and its tree/rock/plant visual
  language.
- [OpenGameArt LowPoly Nature Pack mirror](https://opengameart.org/content/lowpoly-nature-pack)
  — source record for the selected `Nature pack vol.3` OBJ files, identified
  as CC0 and authored by Quaternius. The downloaded archive SHA-256 was
  `7bf32888a521e93c94d82fc2cebda482de52c014cde9d406dc62da1575f9070d`.
- [Vegetation Spawner | FREE - Automatic Tree/Grass Placement](https://assetstore.unity.com/packages/tools/terrain/vegetation-spawner-free-automatic-tree-grass-placement-177192)
  — placement and density reference only. Its page identifies the Standard
  Unity Asset Store EULA; no Unity package or mesh is redistributed here.

The Three.js runtime is separately covered by
`assets/budget-planning/vendor/THREE-LICENSE.txt`.
