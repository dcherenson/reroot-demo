# ReRoot browser demonstration

Open `/` through a static HTTP server. The legacy `/budget-planning.html` route redirects here. Everything needed by
visitors is local: Three.js 0.186.1, its OrbitControls addon, procedural scenes,
and the worker-based simulation. No npm build, API server, map service, stored
feature map, or precomputed flight is needed at runtime.

```sh
npm install
npm run serve
npm test
npm run test:missions
npx playwright install chromium firefox webkit
npm run test:browser
```

The standalone GitHub Pages workflow packages `index.html` and local assets into
`_site/`. No Jekyll installation is required. Tests and development dependencies
are excluded from the deployed artifact.

## Model

The vehicle moves at fixed world altitude with Dubins curvature bounds. The
opaque aircraft is the simulated true pose; the transparent aircraft is its
position estimate. Translational odometry error grows by 0.03 metres per metre
travelled, while yaw is exact. Recognizing a visible localization landmark resets
that error. The error budget is a maximum position error, not a sensing cost.
The visual heading frame keeps the nose level. Banking is a smoothed rotation
around the airframe's longitudinal axis, with a 0.3 s display response; it does
not feed back into dynamics, control, or camera sensing.

The camera renders a 320 × 240 image at 5 Hz with a 90-degree horizontal optical
field of view and a 55-degree downward tilt by default. Sidebar controls adjust
horizontal FOV (60–120 degrees), sensing range (40–100 m), and downward pitch
(35–75 degrees). Changes restart the seeded mission and update the worker,
planner, optical camera, and sensing overlay together. The default processed
ground wedge is limited to 75 m and 90 degrees. Terrain and buildings occlude the image. Its
gimbal aims forward in transit and inward near a recognized landmark. A
validated terminal target takes priority over nearby landmarks; goal acquisition
begins two seconds before its orbit, while renewal sites use a shorter entry
region to preserve the forward view during exploration. Camera slewing is included in successive-frame feature
intersection tests. Accepted trajectories retain their validated camera policy;
transit commands use the committed reference, and the conservative footprint
reserves localization plus controller tracking allowance. Mapped feature markers persist after leaving the camera.
The camera inset shows the exact image used by FAST corner detection and
oriented 256-bit BRIEF descriptor matching. Shared-feature counts come from
mutual, ratio-tested descriptor matches between consecutive images. Simulated
depth rejects geometrically inconsistent matches and anchors detected corners
to surfaces. A nearest-depth 3 × 3 support avoids anchoring silhouette corners
to the moving background. Persistent markers are spatially thinned within 3 m;
several distinct image correspondences may share one map representative.
Scenery is clustered along hedgerows, rocky passes, and campus roads, with broad
nearly empty field, sand, and lawn interiors. Authored scenery points are never
used as camera measurements in the browser.

This is depth-assisted feature mapping, not a complete visual-SLAM system.
Future feature availability is predicted geometrically from the observed map,
with the 3 m association radius reserved at the camera boundary. First-frame
predictions also intersect the immediately preceding measured feature set;
executed overlap is checked against actual image matches. Semantic landmark
recognition is idealized, as is the exact yaw and terrain model.

Each world starts at a physical localization landmark: the red gambrel barnhouse
in the farm, the tall, many-armed saguaro in Tucson, and the Ford
Robotics Building in Ann Arbor. The fixed-wing UAV begins in a surveyed orbit
around that landmark. Other free space is certified through the sensor.
Every localization landmark has a distinctive model, an anchored ring, and a
named badge showing its home/goal/waypoint role and discovery/renewal status.
Unknown badges are hidden in Robot map mode. The physical models are visible to
the optical sensor; presentation rings, labels, and pins are excluded.
The map independently tracks unknown, observed-free, surveyed-free, and forbidden
cells. An ideal semantic observation of the stadium crowd reveals the complete
simulated restriction boundary before that sensor update adds free cells. The
full-world view can reveal scenery and an undiscovered restriction to the viewer,
but does not grant that information to the planner.
The **World truth / Robot map** buttons in the edge panel switch presentation
only. An independent, bounded surface-observation mask hides unseen scenery
and colors unexplored terrain as fog. A known restriction does not reveal its
underlying scenery, and observing a roof does not certify a flight corridor.
Mapped features use constant-size gold dots with dark outlines; currently
tracked dots brighten to mint. These annotations remain visible through scenery.

A recognized landmark is distinct from a certified renewal orbit. The complete
orbit must be in verified free space, satisfy clearance, and retain landmark
visibility before ReRoot roots are activated. Orbit radii account for the linked physical object's footprint, localization
clearance, and known restrictions. They can be larger than the vehicle's minimum
turn radius; goal landmarks use a minimum 30 m renewal radius. Roof observations
do not clear the hidden ground underneath. Exterior corridors must still be
surveyed and validated. Goal coordinates are given as mission input;
its renewal capability is discovered. The goal orbit is held indefinitely. The complete candidate includes validation
of its first terminal-orbit cycle, including camera slewing and error growth
before each observation; a late observation cannot erase an earlier violation.

The farm, Tucson, and Ann Arbor scenes use compressed fictional layouts. Mountains
intersecting the flight layer are collision obstacles. The stadium crowd and
other no-fly zones are scenario restrictions, not an airspace map.

## Implementation

- `dubins.js`: six analytic Dubins words, continuous samples, prefixes, curvature,
  exact constant-turn integration, and seeded random generator.
- `worlds.js`: finite procedural geometry/features, terrain, collisions, and LOS.
- `pixel-features.js` / `vision.js`: FAST detection, oriented BRIEF matching,
  depth-assisted correspondence gating, and the bounded live feature map.
- `sensor-camera.js`: shared optical calibration and packed-depth unprojection.
- `knowledge.js`: perception, persistent feature map, safety grid, and orbit checks.
- `planner.js`: reverse RRT* (forward-executable child-to-root edges), cached
  ancestor costs, rewiring, and descending-switch-time gatekeeper validation.
- `simulation.js`: estimator, executed controller, candidate validation, mission
  state, and bounded telemetry.
- `worker.js`: fixed simulated time, rendering backpressure, and transferred
  snapshot-buffer recycling. A single camera request / measurement / snapshot /
  ACK sequence prevents sensing or planning from falling behind. RGB and depth
  readback buffers are also recycled. A slow planning tick slows wall-clock playback;
  it never advances the UAV past unfinished validation.
  The right-side Simulation rate slider changes the target wall-clock cadence
  from 200 ms (1×) to 20 ms (10×), without changing the 0.2 s simulated step,
  0.02 s dynamics substeps, or sensing/planning frequencies in simulated time.
  Playback starts at 5×. Rate changes apply live and preserve pause state. Overruns start a fresh cycle
  after validation and acknowledgment; they never queue catch-up steps.
- `world-layout.js`: bounded position overrides, linked stadium/crowd-zone
  movement, geometry rebuilding, and starting-orbit validation.
- `renderer.js` / `app.js`: local Three.js scene, view and layout controls,
  inspection, and charts.
- `scenery-models.js`: procedural stadium, Ford Robotics Building, and Michigan
  Medicine rooftop helipad.
- `vegetation-models.js`: shared instanced CC0 vegetation meshes plus original
  branched saguaros and ocotillo. Terrain shading uses the same elevation
  samples as collision and line-of-sight checks.
- `landmark-models.js`: procedural barnhouses, tall multi-arm saguaros, windmill,
  orchard gate, rock spire, lookout, footbridge, depot, clocktower, and pavilion.
- `thick-lines.js`: fixed-capacity instanced triangle ribbons with pixel widths,
  reusable buffers, and partial GPU uploads for the active segment prefix.

Planning only uses observed feature IDs and activated landmarks. Its conservative
FOV propagates the error accumulated since the last landmark observation, plus
tracking and feature-association allowances. The budget slider is a ceiling,
not uncertainty already incurred: using the entire ceiling at every camera
frame unnecessarily rejected departures immediately after localization renewal.
Collision corridors still reserve the full configured localization bound. Both nominal and backup
corridors are checked, and the accepted controller rollout must fit within its
reserved tracking clearance. A constraint violation stops with a large red **FAIL**
card showing its measured value, threshold, and simulation time;
there is no teleportation or artificial budget reset to conceal a failure.

The **Gatekeeper safety** switch restarts the same world and seed in either
validated planning mode or **Nominal only** mode. The latter executes the same
shortest Dubins connection directly to the goal orbit without backup, collision,
feature, or budget validation. Actual-flight monitors remain active in both
modes. An unsatisfied budget constraint is detected at the 0.02 s integration substep; feature
overlap is checked at each 5 Hz camera observation when no localization landmark
is visible. A landmark lock replaces feature-based odometry, so a low corner
count during that lock is not a tracking failure. After a failure, playback stays
disabled until reset; press Play to resume the restarted mission.

The implementation follows the paper and Julia reference, while fixing its
nominal collision omission, hidden-landmark access, time-only resets, and finite
terminal orbit. Tests include literal Julia length/interior-sample fixtures;
those fixtures are test data only and never imported by the demo. Reverse-tree
parent searches apply the Julia implementation's local neighbor limit to roots
as well as ordinary nodes. The Dubins port also uses the same 0.001-radian
near-full-loop cleanup; omitting it created unnecessary full circles and long
straight-dominated connections. Tree rendering samples the analytic curves.
Equal-budget backup paths prefer the shorter length, avoiding long returns
caused by root insertion order. A useful committed nominal prefix is retained when a new candidate would move
its switching point farther from the goal.

## Resource limits and verification

The forest reserves four tangent roots per landmark within its 4,000-node cap
(16 slots in farm, 24 in Tucson, and 20 in Ann Arbor). Each scene has at most 1,000
authored scenery instances and 1,000 persistent image-feature representatives.
Each image retains at most 500 detected corners. Mapping continues at the node cap. Feature queries
use a spatial index, path cost caches are capped at 2,048 entries, sensor-query caches at 4,096, telemetry holds
1,500 samples, and trails hold 3,000 samples. Tree snapshots are curve-sampled
within a fixed segment cap. Only one transferred snapshot can be outstanding.
Scene resets terminate the old worker and release renderer resources.

`test:missions` exercises all defaults, 30-minute simulated goal loiters, and
restrictive budgets. Browser tests exercise controls and knowledge-view isolation
in Chromium, Firefox, and WebKit. The Chromium stress check performs 100 scene
resets and compares retained heap after explicit garbage collection as well as
renderer geometry/texture counts. Timing results are machine-dependent; a
sampling-based planner's failure to find progress is not proof of infeasibility.

The worker and renderer are independent: rotating the view or toggling knowledge
mode never changes sensing, random sequences, or the simulation state.

The viewport fills the screen, with collapsible controls along its edges.
Orbit/pan/zoom, top-down, and nose-level first-person views are independent of
the sensor camera. `F` selects first person, `T` selects top-down, `V` resets the
viewer, `Space` pauses, and `R` restarts. Parameter changes restart with the same
seed. All UI text and generated scene labels use the same system sans-serif
font stack. The first-person camera and smoothed roll are visual only.

**Edit world** pauses simulation and selects a top-down truth view. Drag a colored
handle to move a landmark, no-fly zone, or Tucson mountain, or select the object
and enter coordinates. A valid placement restarts the mission with the same seed,
tuning, and prior playback state. The prior camera and map view are restored.
Layouts are retained separately for each world for the page session. Restore
world layout clears the current world's edits; Restore defaults also resets its
tuning and playback rate. Cancel or Escape closes the editor without applying a
preview. Ordinary camera dragging never edits the layout.

Layout overrides are applied before terrain triangulation, object elevation,
and feature generation. The renderer and worker receive identical overrides.
Stadium and crowd-zone positions are linked, while the restriction remains
unknown to the robot until sensed. An edit cannot grant map knowledge. Footprints
must stay inside the world and the starting orbit must remain valid, including
camera visibility. Other placements can obstruct progress or make the goal
unreachable; the editor does not claim to establish mission feasibility.

## Sources and licenses

Algorithm: Cherenson, Agrawal, and Panagou, *Autonomy Architectures for Safe
Planning in Unknown Environments Under Budget Constraints*.
Reference code: https://github.com/dcherenson/budget-constrained-planning

Building and landscape references (procedural interpretations, no downloaded images):

- [Ford Robotics Building, Michigan Robotics](https://robotics.umich.edu/about/facilities/ford-robotics-building/)
- [Official Ford building 3D reference, University of Michigan](https://sketchfab.com/3d-models/u-m-ford-motor-company-robotics-building-8b228b54b3bc4ccfa75c5d8cb872b4da)
- [Michigan Stadium, Michigan Athletics](https://mgoblue.com/sports/2017/6/16/facilities-michigan-stadium-html?id=157)
- [University Hospital, U-M Health](https://www.uofmhealth.org/locations-list/university-hospital)
- [Survival Flight, U-M Health](https://www.uofmhealth.org/our-care/clinical-units/survival-flight)
- [Ann Arbor Natural Features Master Plan](https://www.a2gov.org/media/u1qjqduh/nfmasterplan_6-04.pdf)

Ann Arbor uses a compressed winding Huron River with gentle campus rises and
river bluffs, plus a graded stadium platform. It is inspired by those references,
not a geographic or elevation survey. The medical helipad is unknown initially
and becomes a localization landmark only after a real camera observation.

The Ford model is a lightweight procedural interpretation of the linked viewer,
including curved glazing, mullions, brick masses, and upper screening. The
reference viewer exposes no public download/redistribution license, so its mesh
is not bundled. See `FORD_MODEL_REFERENCE.md` for the reference review.

Feature algorithms:
[FAST, Rosten and Drummond](https://www.edwardrosten.com/work/rosten_2006_machine_poster.pdf),
[BRIEF, Calonder et al.](https://www.cs.ubc.ca/~lowe/525/papers/calonder_eccv10.pdf).
The local detector is a JavaScript implementation, with intensity-centroid
orientation and a compact descriptor patch appropriate to the sensor resolution.

Terrain is triangulated at runtime from locally bundled USGS 3DEP elevation
snapshots: Catalina/Mount Lemmon ridges, Ann Arbor campus terrain, and farmland
west of Ann Arbor. Geography and vertical relief are compressed for this demo.
The Tucson surface uses a 1 m simulation grid; Farm and Ann Arbor use 2 m grids.
Rendering, collision and line of sight query the same triangle surface. Roads
and fields are cut from those triangles and clipped at map boundaries; both
sensor passes also clip scenery to the world rectangle.

Ground materials use local Poly Haven CC0 photographs. Their contrast fades
smoothly in authored feature-poor regions, while keeping the surface opaque
and preserving its average color. These are ordinary world materials seen by
the actual detector, not synthesized feature measurements. All source images
load before the first sensor frame. See [elevation provenance](../terrain/README.md)
and [material credits](../terrain/GROUND-MATERIALS.md).

Trees, grass, bushes, and rocks include locally bundled Quaternius CC0 meshes;
see [model credits](../models/ASSET-CREDITS.md) for provenance and licenses.

Three.js and OrbitControls are MIT-licensed; see `vendor/THREE-LICENSE.txt`.
`vendor/OrbitControls.js` changes only its import to the local Three.js module.

## Acceptance checks

Rendered-image checks use seed 1337 and defaults of 5 m error budget, 6 shared
features, 10 m/s speed, 10 m minimum turn radius, and the camera settings above.
Historical results are archived alongside the current acceptance JSON; their
mission timings apply only to the corresponding renderer and geometry hashes.

### Automated checks

`npm test` covers Dubins families and Julia fixtures, curvature, reverse edges,
rewiring, committed fallback, robust FOV, online restriction discovery, terrain,
image detection/matching, depth anchoring, and bounded map/root capacity.
`npm run test:missions` uses actual rendered images for all three default
30-minute simulated missions and restrictive-budget scenarios. While the static
server is running, a direct probe is:

```sh
node tests/budget-planning/pixel-missions.mjs farm 9000 --memory --assert-goal
```

Browser checks cover Chromium, Firefox, and WebKit. Chromium-only stress tests
exercise a synthetic 4,000-node forest with overlays and 5 Hz image sensing,
plus 100 alternating world resets with explicit-GC heap and GPU-resource checks.
The full-tree test measures rendering/sensing throughput, not planner growth
throughput. Mac Chromium uses Metal explicitly; software WebGL is much slower.

The October 15 terrain revision passed 80 unit checks, 72 functional browser
checks, and four performance checks. Farm, Tucson, and Ann Arbor reached the
goal after 67.6, 791.2, and 370.0 simulated seconds respectively and each completed
30 simulated minutes without a fault. All three 1 m budget scenarios stayed
safe during the 120-second restrictive check. Full-tree rendering with 5 Hz
sensing measured 58.5–59.8 FPS. A hundred alternating resets passed retained-heap,
backing-storage and GPU-resource checks.

Those terrain measurements and runtime hashes are recorded in
`tests/budget-planning/acceptance-results.json`. Earlier measurements are kept
in dated JSON archives. The main agent reviews the code and actual results
before accepting each update.

The subsequent simulation-rate update passed 88 unit checks and 30 targeted
browser checks across Chromium, Firefox, and WebKit, plus the static build.
These cover live acceleration, fixed-step scheduling, sensor/ACK backpressure,
pause/resume, restart persistence, defaults, responsive layout, and deployment
paths. The main agent reviewed the worker diff and desktop/mobile screenshots.
The terrain revision's long mission and memory runs were not repeated for this
pacing/UI-only change; physics, planning, and sensing modules are unchanged.

The subsequent editor/tuning revision moves Tucson's trailhead from (181, 43)
to (165, 35), where the full exterior orbit can be surveyed sooner. The default
mission now reaches the goal after 176.8 simulated seconds, including 61.0 seconds
of verified backup flight, versus 791.2 seconds before this change. The tuned
mission completed 30 simulated minutes without a fault; post-warmup retained
heap changed by 58,752 bytes and typed-array backing storage remained stable.
The integrated editor reproduced that goal time, and the 1 m budget check stayed
safe for 120 simulated seconds while producing different return behavior.

The final revision passed 96 unit checks, 72 targeted browser checks across
Chromium, Firefox, and WebKit, and the static build. The main agent reviewed the
implementation diffs, editor screenshots, and actual mission/memory results.

A hundred alternating resets, each rendering the editor handles, retained stable
per-world GPU counts (178–192 geometries and 9–11 textures) and identical per-world
backing-storage sizes. Cancelled previews reuse their geometry. The current
measurements, test scope, and reviewed source hashes are recorded separately in
`tests/budget-planning/editor-tuning-results.json`; earlier three-world results
remain in the terrain baseline report.

These scenario checks do not prove feasibility or safety for every setting.
Future descriptor availability is a geometric prediction; actual image overlap
is checked on execution. A slow validation step slows wall-clock playback. An
unexpected executed constraint violation pauses the demo with a diagnostic.
