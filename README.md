# ReRoot browser demo

An interactive, browser-only demonstration of safe planning under localization
uncertainty. Fly a Dubins UAV through **Farm**, **Tucson**, or **Ann Arbor** while
ReRoot builds a reverse RRT* forest and gatekeeper validates nominal and backup
trajectories. A real FAST/BRIEF feature detector processes the rendered camera.

**Website (after Pages is enabled):** https://dcherenson.github.io/reroot-demo/

All scenes, feature maps, and paths are generated at runtime. The visitor needs
no server, Unity installation, external map service, or precomputed mission data.
The project was extracted from the research website into this standalone repository.

## Run locally

```sh
npm ci
npm run serve
```

Open http://127.0.0.1:4180/. Python 3 serves the static files; Node is used only for
development checks and packaging. The deployed application uses local ES modules
and a dedicated simulation worker.

## Controls

Drag to orbit, pan, and zoom. Choose an orbit, top-down, or first-person view.
The inset displays the UAV's sensing camera. World truth and Robot map change
only the viewer's knowledge; mapped features persist at their surface positions.

Tuning controls restart the same seeded world when applied. They include error
budget, shared-feature minimum, speed, turn radius, camera FOV, range, and tilt.
The gatekeeper switch compares validated commitments with nominal-only flight.
Executed constraint violations stop playback with a red failure explanation.

Keyboard: Space play/pause, R restart, T top-down, F first person, V reset view.

## Checks

```sh
npm test
npx playwright install chromium firefox webkit
npm run test:browser
npm run test:missions
npm run build
```

The mission suite uses rendered camera images. The full run checks 30 simulated
minutes per default world, restrictive settings, and bounded storage. Browser
checks cover interface layout, rendering/sensing alignment, and resource cleanup.
See [implementation notes](assets/budget-planning/README.md) for algorithm details,
assumptions, limits, source references, and the acceptance report.

## Deployment

To activate the site, open repository **Settings → Pages**, select **GitHub Actions**
as the source, then open **Actions → Deploy ReRoot demo → Run workflow**.

The Pages workflow tests and packages the static site on pushes to `main`. Once
Pages is enabled, it publishes `_site/` through GitHub Pages; until then, the
deployment job skips and the build remains available. Relative asset and worker paths support
the `/reroot-demo/` project URL. The legacy `budget-planning.html` route redirects
to the standalone home page.

Third-party model and library licenses are retained alongside their assets.
Ground polygons use local USGS elevation snapshots, with locally served CC0
Poly Haven surface textures. Geography and vertical scales are compressed for
the demo. See [terrain sources](assets/terrain/README.md) and
[material credits](assets/terrain/GROUND-MATERIALS.md).
