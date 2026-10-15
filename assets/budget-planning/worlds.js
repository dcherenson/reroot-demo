/*
 * Small, deterministic world generator used by the budget-planning flight
 * demo.  The world is deliberately data-only: the renderer is free to turn
 * the points and objects below into whatever style of 3-D scene it needs.
 *
 * A couple of rules are worth keeping here rather than in the renderer:
 *
 *   - terrain is a continuous function of (world, x, y),
 *   - collision tests only know about physical geometry, and
 *   - no random number source is consulted after a world has been created.
 *
 * This makes a replay made with the same seed identical, while still letting
 * each world have a pleasantly different arrangement of small details.
 */

import { sampleTucsonCatalinaHeight, sampleAnnArborCampusHeight, sampleAnnArborWestFarmHeight } from '../terrain/ground-elevation.js';

export const WORLD_WIDTH = 320;
export const WORLD_HEIGHT = 230;
export const WORLD_ALTITUDE = 35;
export const MAX_FEATURES = 1000;

const TAU = Math.PI * 2;
const EPSILON = 1e-7;
const SOLID_KINDS = new Set(['building', 'stadium', 'tower', 'rock']);

const PALETTES = {
  farm: { ground: '#6b8c4a', accent: '#e0ad4b', sky: '#8bc6ec' },
  tucson: { ground: '#b97e52', accent: '#e88743', sky: '#79b8dc' },
  'ann-arbor': { ground: '#4e7658', accent: '#d8a33e', sky: '#8ec6e4' },
};

const SPECS = {
  farm: {
    label: 'Farm',
    description:
      'A compressed working farm of fields, orchard rows, windbreaks and a marked restricted aviary near the central route.',
    featureKinds: ['grass', 'crop', 'wildflower', 'tree', 'rock'],
  },
  tucson: {
    label: 'Tucson',
    description:
      'A stylized Tucson basin with saguaro gardens, desert washes and a high mountain chain that leaves two clear flight passes.',
    featureKinds: ['saguaro', 'cactus', 'shrub', 'desert-rock', 'dry-grass', 'ocotillo'],
  },
  'ann-arbor': {
    label: 'Ann Arbor',
    description:
      'A compressed Ann Arbor campus with tree-lined roads, plazas and a recognizable Michigan Stadium whose crowd zone is revealed only by sight.',
    featureKinds: ['tree', 'maple', 'shrub', 'path-marker', 'rock'],
  },
};

/*
 * The regions below are intentionally broad.  They are part of the world
 * description rather than a renderer hint: the terrain shader, annotations,
 * and tests can all ask the same question about whether a patch of ground is
 * a clearing or a concentration of scenery.  Rich regions are placed along
 * field, desert, and campus edges so the empty interiors have a readable
 * boundary when the camera moves through the world.
 */
const FEATURE_REGION_TEMPLATES = {
  farm: [
    { id: 'farm-north-field', label: 'North field clearing', x: 69, y: 136, rx: 46, ry: 39, kind: 'poor' },
    { id: 'farm-east-field', label: 'East field clearing', x: 247, y: 119, rx: 46, ry: 34, kind: 'poor' },
    { id: 'farm-south-field', label: 'South field clearing', x: 205, y: 192, rx: 50, ry: 27, kind: 'poor' },
    { id: 'farm-west-grove', label: 'West windbreak grove', x: 45, y: 35, rx: 31, ry: 21, kind: 'rich' },
    { id: 'farm-north-hedgerow', label: 'North hedgerow', x: 143, y: 52, rx: 64, ry: 14, kind: 'rich' },
    { id: 'farm-launch-grove', label: 'Farmstead lane trees', x: 61, y: 90, rx: 23, ry: 9, kind: 'rich' },
    { id: 'farm-lane-hedgerow', label: 'Aviary north lane hedgerow', x: 145, y: 86, rx: 65, ry: 13, kind: 'rich' },
    { id: 'farm-orchards', label: 'Orchard edge', x: 214, y: 75, rx: 42, ry: 20, kind: 'rich' },
    { id: 'farm-goal-hedgerow', label: 'Barn hedgerow', x: 274, y: 165, rx: 32, ry: 18, kind: 'rich' },
  ],
  tucson: [
    { id: 'tucson-west-sand', label: 'West desert sand', x: 44, y: 149, rx: 34, ry: 27, kind: 'poor' },
    { id: 'tucson-south-wash', label: 'South wash clearing', x: 224, y: 214, rx: 38, ry: 16, kind: 'poor' },
    { id: 'tucson-east-basin', label: 'East basin sand', x: 273, y: 106, rx: 39, ry: 35, kind: 'poor' },
    { id: 'tucson-west-saguaro', label: 'West saguaro garden', x: 76, y: 98, rx: 29, ry: 38, kind: 'rich' },
    { id: 'tucson-east-wash-rocks', label: 'Eastern rocky wash', x: 214, y: 78, rx: 22, ry: 24, kind: 'rich' },
    { id: 'tucson-foothill-rocks', label: 'Catalina foothill talus', x: 168, y: 60, rx: 34, ry: 17, kind: 'rich' },
    { id: 'tucson-launch-rocks', label: 'Foothill trail rocks', x: 78, y: 35, rx: 35, ry: 20, kind: 'rich' },
    { id: 'tucson-west-wash', label: 'Western rocky wash', x: 114, y: 89, rx: 23, ry: 24, kind: 'rich' },
    { id: 'tucson-pass-rocks', label: 'Catalina pass rock garden', x: 153, y: 39, rx: 34, ry: 18, kind: 'rich' },
    { id: 'tucson-north-rocks', label: 'North rock group', x: 228, y: 39, rx: 48, ry: 19, kind: 'rich' },
    { id: 'tucson-east-saguaro', label: 'East saguaro garden', x: 255, y: 151, rx: 37, ry: 27, kind: 'rich' },
    { id: 'tucson-depot-rocks', label: 'Depot rock group', x: 282, y: 187, rx: 29, ry: 20, kind: 'rich' },
    { id: 'tucson-west-foothills', label: 'Western foothill talus', x: 139, y: 108, rx: 14, ry: 43, kind: 'rich' },
  ],
  'ann-arbor': [
    { id: 'annarbor-west-lawn', label: 'West campus lawn', x: 45, y: 185, rx: 39, ry: 27, kind: 'poor' },
    { id: 'annarbor-stadium-lawn', label: 'Stadium open lawn', x: 155, y: 105, rx: 32, ry: 30, kind: 'poor' },
    { id: 'annarbor-south-lawn', label: 'South campus lawn', x: 224, y: 191, rx: 55, ry: 27, kind: 'poor' },
    { id: 'annarbor-north-trees', label: 'North campus trees', x: 52, y: 43, rx: 35, ry: 21, kind: 'rich' },
    { id: 'annarbor-campus-lane', label: 'Campus avenue trees', x: 85, y: 80, rx: 40, ry: 20, kind: 'rich' },
    { id: 'annarbor-campus-grove', label: 'Central campus grove', x: 220, y: 76, rx: 43, ry: 25, kind: 'rich' },
    { id: 'annarbor-river-woods', label: 'River bluff woods', x: 91, y: 129, rx: 43, ry: 17, kind: 'rich' },
    { id: 'annarbor-south-street-trees', label: 'South street trees', x: 279, y: 169, rx: 33, ry: 21, kind: 'rich' },
  ],
};

/*
 * Each patch is a small collection of randomly offset subclusters.  Keeping
 * the patch recipes separate from featureRegions lets a region describe a
 * broad visual truth while the point population remains compact and varied.
 */
const FEATURE_PATCHES = {
  farm: [
    { regionId: 'farm-west-grove', style: 'grove', clusters: 4, points: 21, spreadX: 10, spreadY: 8, kinds: ['tree', 'wildflower', 'grass'] },
    { regionId: 'farm-north-hedgerow', style: 'row', clusters: 5, points: 21, spreadX: 17, spreadY: 4, kinds: ['tree', 'crop', 'wildflower'] },
    { regionId: 'farm-orchards', style: 'orchard', clusters: 5, points: 22, spreadX: 10, spreadY: 7, kinds: ['tree', 'crop', 'wildflower'] },
    { regionId: 'farm-goal-hedgerow', style: 'row', clusters: 3, points: 20, spreadX: 15, spreadY: 4, kinds: ['tree', 'grass', 'rock'] },
    { regionId: 'farm-lane-hedgerow', style: 'row', clusters: 5, points: 24, spreadX: 14, spreadY: 4, kinds: ['tree', 'wildflower', 'rock'] },
    { regionId: 'farm-launch-grove', style: 'grove', clusters: 3, points: 25, spreadX: 7, spreadY: 3, kinds: ['tree', 'wildflower', 'rock'] },
  ],
  tucson: [
    { regionId: 'tucson-west-saguaro', style: 'grove', clusters: 4, points: 18, spreadX: 9, spreadY: 12, kinds: ['saguaro', 'cactus', 'shrub'] },
    { regionId: 'tucson-north-rocks', style: 'rock-group', clusters: 4, points: 16, spreadX: 13, spreadY: 6, kinds: ['desert-rock', 'dry-grass', 'ocotillo'] },
    { regionId: 'tucson-east-saguaro', style: 'grove', clusters: 4, points: 19, spreadX: 11, spreadY: 9, kinds: ['saguaro', 'cactus', 'shrub'] },
    { regionId: 'tucson-depot-rocks', style: 'rock-group', clusters: 3, points: 15, spreadX: 11, spreadY: 7, kinds: ['desert-rock', 'dry-grass', 'cactus'] },
    { regionId: 'tucson-pass-rocks', style: 'rock-group', clusters: 4, points: 22, spreadX: 12, spreadY: 6, kinds: ['desert-rock', 'saguaro', 'ocotillo'] },
    { regionId: 'tucson-west-wash', style: 'rock-group', clusters: 4, points: 23, spreadX: 7, spreadY: 9, kinds: ['desert-rock', 'saguaro', 'ocotillo'] },
    { regionId: 'tucson-launch-rocks', style: 'rock-group', clusters: 4, points: 24, spreadX: 12, spreadY: 7, kinds: ['desert-rock', 'saguaro', 'ocotillo'] },
    { regionId: 'tucson-foothill-rocks', style: 'rock-group', clusters: 5, points: 25, spreadX: 10, spreadY: 6, kinds: ['desert-rock'], allowFoothills: true },
    { regionId: 'tucson-east-wash-rocks', style: 'rock-group', clusters: 4, points: 25, spreadX: 7, spreadY: 9, kinds: ['desert-rock', 'saguaro', 'ocotillo'] },
    // The measured ridge has a broad western face. Rock and cactus clusters
    // at its foot provide visible structure without filling the open basins.
    { regionId: 'tucson-west-foothills', style: 'rock-group', clusters: 7, points: 18, spreadX: 6, spreadY: 9, kinds: ['desert-rock', 'saguaro', 'ocotillo'], allowFoothills: true },
  ],
  'ann-arbor': [
    { regionId: 'annarbor-north-trees', style: 'grove', clusters: 4, points: 21, spreadX: 10, spreadY: 7, kinds: ['tree', 'maple', 'shrub'] },
    { regionId: 'annarbor-campus-grove', style: 'street', clusters: 5, points: 21, spreadX: 15, spreadY: 4, kinds: ['tree', 'maple', 'path-marker'] },
    { regionId: 'annarbor-river-woods', style: 'grove', clusters: 4, points: 17, spreadX: 12, spreadY: 6, kinds: ['tree', 'maple', 'shrub'] },
    { regionId: 'annarbor-south-street-trees', style: 'street', clusters: 4, points: 20, spreadX: 14, spreadY: 4, kinds: ['tree', 'maple', 'shrub'] },
    { regionId: 'annarbor-campus-lane', style: 'street', clusters: 4, points: 25, spreadX: 12, spreadY: 5, kinds: ['tree', 'maple', 'rock'] },
  ],
};

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value) >>> 0;
  }
  return hashString(value == null ? 1337 : value) || 1;
}

function mix32(value) {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/** A tiny seeded generator.  It intentionally has no ambient state. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function buildFeatureRegions(worldId) {
  return (FEATURE_REGION_TEMPLATES[worldId] || []).map((region) => ({ ...region }));
}

function featureRegionWeight(region, x, y) {
  const rx = Math.max(0.1, Math.abs(Number(region?.rx) || 0.1));
  const ry = Math.max(0.1, Math.abs(Number(region?.ry) || 0.1));
  const dx = (x - Number(region?.x)) / rx;
  const dy = (y - Number(region?.y)) / ry;
  const radial = dx * dx + dy * dy;
  if (radial >= 1) return 0;
  // A smooth radial influence makes shader queries useful at patch edges and
  // avoids a hard color seam at the authored ellipse boundary.
  return 1 - smoothstep(0, 1, radial);
}

/**
 * Return the authored scenery richness at a world coordinate in [0, 1].
 * Rich grove/hedgerow regions approach one; the interiors of poor regions are
 * deliberately near zero; un-authored ground retains a restrained baseline.
 */
export function featureRichness(world, x, y) {
  if (!world || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
  let richWeight = 0;
  let poorWeight = 0;
  for (const region of world.featureRegions || []) {
    const weight = featureRegionWeight(region, x, y);
    if (region.kind === 'rich') richWeight = Math.max(richWeight, weight);
    else if (region.kind === 'poor') poorWeight = Math.max(poorWeight, weight);
  }
  if (poorWeight > 0.2 && poorWeight >= richWeight) {
    return clamp(0.02 + 0.08 * (1 - poorWeight), 0, 0.1);
  }
  if (richWeight > 0) return clamp(0.22 + richWeight * 0.78 - poorWeight * 0.18, 0, 1);
  return 0.22;
}

/** True in the broad, nearly empty core of an authored poor region. */
export function isFeaturePoor(world, x, y) {
  if (!world || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return featureRichness(world, x, y) <= 0.1;
}

function normalizeWorldId(id) {
  const normalized = String(id == null ? 'farm' : id)
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  if (normalized === 'annarbor' || normalized === 'ann-arbor' || normalized === 'city' || normalized === 'urban') {
    return 'ann-arbor';
  }
  if (normalized === 'desert' || normalized === 'tucson-desert') {
    return 'tucson';
  }
  return normalized === 'tucson' ? 'tucson' : 'farm';
}

function terrainBaseHeight(world, x, y) {
  const u = clamp(x / world.width, 0, 1), v = 1 - clamp(y / world.height, 0, 1);
  // Local USGS topography supplies the polygon surface. Vertical scales and
  // geography are compressed to match the mission's fixed 35 m flight layer.
  if (world.id === 'ann-arbor') return 1 + sampleAnnArborCampusHeight(u, v, 0) * 6;
  if (world.id === 'farm') return 1 + sampleAnnArborWestFarmHeight(u, v, 0) * 2.4;
  return .8 + sampleTucsonCatalinaHeight(u * .22, .7 + v * .25, 0) * 3;
}

function terrainPadHeight(height, x, y, pad) {
  const width = Math.max(0.1, Number(pad?.width) || 0.1);
  const depth = Math.max(0.1, Number(pad?.depth) || 0.1);
  const innerRadiusSquared = Math.max(0, Number(pad?.innerRadiusSquared) || 0);
  const outerRadiusSquared = Math.max(innerRadiusSquared, Number(pad?.outerRadiusSquared) || innerRadiusSquared);
  const elevation = Number(pad?.elevation);
  if (!Number.isFinite(elevation) || outerRadiusSquared <= 0) return height;
  const angle = Number(pad.rotation) || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - Number(pad.x);
  const dy = y - Number(pad.y);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const normalized = (localX / (width / 2)) ** 2 + (localY / (depth / 2)) ** 2;
  if (normalized <= innerRadiusSquared) return elevation;
  if (normalized >= outerRadiusSquared) return height;
  const blend = smoothstep(innerRadiusSquared, outerRadiusSquared, normalized);
  return elevation + (height - elevation) * blend;
}

function watercourseList(world) {
  if (Array.isArray(world?.watercourses) && world.watercourses.length) return world.watercourses;
  return world?.river && typeof world.river === 'object' ? [world.river] : [];
}

function watercourseByInput(world, input) {
  if (input == null) return watercourseList(world);
  if (typeof input === 'string') return watercourseList(world).filter((course) => course.id === input);
  return [input];
}

function distanceToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > EPSILON ? clamp(((x - ax) * dx + (y - ay) * dy) / lengthSquared, 0, 1) : 0;
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
}

function courseDistance(course, x, y) {
  const points = course?.centerline || course?.points || course?.path || [];
  let nearest = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const ax = Array.isArray(previous) ? Number(previous[0]) : Number(previous?.x);
    const ay = Array.isArray(previous) ? Number(previous[1]) : Number(previous?.y);
    const bx = Array.isArray(current) ? Number(current[0]) : Number(current?.x);
    const by = Array.isArray(current) ? Number(current[1]) : Number(current?.y);
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
    nearest = Math.min(nearest, distanceToSegment(x, y, ax, ay, bx, by));
  }
  return nearest;
}

/** Distance to the centerline of a world watercourse in world units. */
export function watercourseDistance(world, x, y, watercourse = null) {
  if (!world || !Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
  if (watercourse != null && typeof watercourse !== 'string') return courseDistance(watercourse, x, y);
  let nearest = Infinity;
  for (const course of watercourseList(world)) {
    if (typeof watercourse === 'string' && course.id !== watercourse) continue;
    nearest = Math.min(nearest, courseDistance(course, x, y));
  }
  return nearest;
}

function watercourseEnvelopeContains(course, distance, margin = 0) {
  const width = Math.max(0, Number(course?.width) || 0);
  const bankWidth = Math.max(0, Number(course?.bankWidth) || 0);
  return distance <= width / 2 + bankWidth + Math.max(0, Number(margin) || 0);
}

/** True inside the modeled open-water channel, excluding its bank buffer. */
export function isInWatercourse(world, x, y, margin = 0) {
  if (!world || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return watercourseByInput(world).some((course) => {
    const distance = watercourseDistance(world, x, y, course);
    return distance <= Math.max(0, Number(course.width) || 0) / 2 + Math.max(0, Number(margin) || 0);
  });
}

function watercourseBedDepression(course, distance) {
  if (!Number.isFinite(distance)) return 0;
  const width = Math.max(0.1, Number(course?.width) || 1);
  const bankWidth = Math.max(0.1, Number(course?.bankWidth) || 0.1);
  if (distance >= width / 2 + bankWidth) return 0;
  const depth = Math.max(0, Number(course?.depth) || 0);
  const channelWeight = 1 - smoothstep(0, width / 2, distance);
  const bankWeight = 1 - smoothstep(width / 2, width / 2 + bankWidth, distance);
  return depth * clamp(channelWeight * 0.6 + bankWeight * 0.4, 0, 1);
}

/** Elevation of a water surface using the same hills and river centerline as terrainHeight. */
export function watercourseSurface(world, x, y, watercourse = null) {
  if (!world || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  let nearestCourse = null;
  let nearest = Infinity;
  if (watercourse != null && typeof watercourse !== 'string') {
    nearestCourse = watercourse;
    nearest = courseDistance(watercourse, x, y);
  } else for (const course of watercourseList(world)) {
    if (typeof watercourse === 'string' && course.id !== watercourse) continue;
    const distance = courseDistance(course, x, y);
    if (distance < nearest) {
      nearest = distance;
      nearestCourse = course;
    }
  }
  if (!nearestCourse || !watercourseEnvelopeContains(nearestCourse, nearest)) return null;
  const surfaceOffset = Number.isFinite(Number(nearestCourse.surfaceOffset))
    ? Number(nearestCourse.surfaceOffset)
    : -Math.max(0.1, Number(nearestCourse.depth) || 0) * 0.35;
  return terrainBaseHeight(world, x, y) + surfaceOffset;
}

function mountainContribution(mountain, x, y) {
  const dx = (x - mountain.x) / Math.max(1, mountain.rx);
  const dy = (y - mountain.y) / Math.max(1, mountain.ry);
  const radial = dx * dx + dy * dy;
  if (radial >= 1.45) return 0;

  // Real Catalina ridgelines and gullies from a local USGS elevation tile.
  // Compress the patch to the authored obstacle footprint, with a smooth toe
  // at the basin boundary. Height, rendered triangles and LOS share this data.
  const rotation = mountain.rotation || 0;
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const u = .5 + (dx * c - dy * s) * .5;
  const v = .5 - (dx * s + dy * c) * .5;
  const toe = 1 - smoothstep(.65, 1.35, radial);
  return mountain.height * sampleTucsonCatalinaHeight(u, v, .06) * toe;

}

function pointInRotatedRect(x, y, object, margin = 0) {
  const angle = Number(object.rotation) || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - object.x;
  const dy = y - object.y;
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return Math.abs(localX) <= Math.abs(object.width) / 2 + margin && Math.abs(localY) <= Math.abs(object.depth) / 2 + margin;
}

function pointInSolidObject(x, y, object, margin = 0) {
  if (!SOLID_KINDS.has(object.kind)) return false;
  // The stadium is drawn with clipped corners by the renderer.  An ellipse is
  // a better collision approximation than a rectangle and leaves the four
  // corner approaches usable.
  if (object.kind === 'stadium') {
    const rx = Math.abs(object.width) / 2 + margin;
    const ry = Math.abs(object.depth) / 2 + margin;
    const angle = Number(object.rotation) || 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = x - object.x;
    const dy = y - object.y;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    return (localX * localX) / (rx * rx || 1) + (localY * localY) / (ry * ry || 1) <= 1;
  }
  return pointInRotatedRect(x, y, object, margin);
}

function pointInStadiumRim(x, y, object, margin = 0) {
  const rx = Math.abs(object.width) / 2 + margin;
  const ry = Math.abs(object.depth) / 2 + margin;
  const angle = Number(object.rotation) || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - object.x;
  const dy = y - object.y;
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const normalized = (localX * localX) / (rx * rx || 1) + (localY * localY) / (ry * ry || 1);
  // The bowl floor is visible.  Only the outer seating/rim band occludes a
  // sightline, matching the low stand walls drawn by the renderer.
  return normalized >= 0.68 && normalized <= 1.18;
}

function mountainContains(mountain, x, y, margin = 0) {
  const rx = Math.abs(mountain.rx) + margin;
  const ry = Math.abs(mountain.ry) + margin;
  const dx = (x - mountain.x) / Math.max(1, rx);
  const dy = (y - mountain.y) / Math.max(1, ry);
  return dx * dx + dy * dy <= 1;
}

function objectGroundZ(world, x, y) {
  return terrainHeight(world, x, y);
}

function addObject(world, object) {
  const next = {
    ...object,
    x: Number(object.x),
    y: Number(object.y),
    width: Math.max(0.1, Number(object.width) || 1),
    depth: Math.max(0.1, Number(object.depth) || 1),
    height: Math.max(0, Number(object.height) || 0),
  };
  if (!Number.isFinite(next.z)) next.z = objectGroundZ(world, next.x, next.y);
  world.objects.push(next);
  return next;
}

function addLandmark(world, landmark) {
  const next = { ...landmark };
  if (!Number.isFinite(next.z)) next.z = surfaceHeight(world, next.x, next.y) + 0.12;
  world.landmarks.push(next);
  return next;
}

// A localization site is an actual authored scene object, not a pin on empty
// ground. Keep its semantic observation point on that object's visible top.
function addLandmarkObject(world, landmark, object) {
  const physical = addObject(world, { ...object, id: object.id || `${landmark.id}-object`,
    x: landmark.x, y: landmark.y, label: landmark.label, landmarkId: landmark.id });
  return addLandmark(world, { ...landmark, objectId: physical.id });
}

function addRoad(world, x, y, width, depth, rotation, color) {
  addObject(world, { kind: 'road', x, y, width, depth, height: 0.14, rotation, color });
}

function addFarmGeometry(world) {
  // The central aviary is a deliberate NFZ.  Its placement intersects the
  // direct home-to-goal line, while the north and south field lanes remain
  // open for route planning.
  world.zones.push(
    { id: 'farm-aviary', label: 'Aviary', kind: 'circle', x: 151, y: 120, radius: 23, known: true },
    { id: 'farm-solar-array', label: 'Solar array', kind: 'rect', x: 78, y: 174, width: 28, height: 32, angle: -0.12, known: true },
  );

  addRoad(world, 157, 114, 7, 290, 0.44, '#b5a16e');
  addRoad(world, 150, 72, 7, 170, -0.08, '#b5a16e');
  addRoad(world, 228, 150, 7, 120, 1.12, '#b5a16e');

  // Background farm buildings; named localization sites below have their own
  // recognizable structures, all below the fixed flight altitude.
  addObject(world, { kind: 'building', x: 103, y: 120, width: 19, depth: 16, height: 10, color: '#9b6244' });
  addObject(world, { kind: 'building', x: 83, y: 101, width: 13, depth: 11, height: 6, color: '#c27c50' });
  addObject(world, { kind: 'building', x: 260, y: 219, width: 24, depth: 18, height: 12, color: '#8e5e42' });
  addObject(world, { kind: 'building', x: 245, y: 25, width: 16, depth: 13, height: 8, color: '#b7784b' });
  addObject(world, { kind: 'tower', x: 150, y: 10, width: 5, depth: 5, height: 22, color: '#d7b55e' });
  addObject(world, { kind: 'plaza', x: 200, y: 125, width: 28, depth: 22, height: 0.18, color: '#ceb77e' });

  addLandmarkObject(world, { id: 'farm-home', label: 'Red barnhouse', x: 45, y: 65, kind: 'home', home: true },
    { kind: 'building', style: 'landmark-barnhouse', width: 18, depth: 14, height: 12, color: '#b53536' });
  addLandmarkObject(world, { id: 'farm-windmill', label: 'Windmill', x: 91, y: 67, kind: 'windmill' },
    { kind: 'tower', style: 'landmark-windmill', width: 9, depth: 9, height: 16 });
  addLandmarkObject(world, { id: 'farm-orchard', label: 'Orchard gate', x: 211, y: 74, kind: 'orchard' },
    { kind: 'building', style: 'landmark-orchard', width: 12, depth: 9, height: 7 });
  addLandmarkObject(world, { id: 'farm-goal', label: 'Barn', x: 260, y: 165, kind: 'goal', goal: true, renewalRadius: 30 },
    { kind: 'building', style: 'landmark-barnhouse', width: 20, depth: 14, height: 7, color: '#d2ae59' });
}

function addTucsonGeometry(world) {
  // Three compressed patches of measured Catalina terrain leave broad passes.
  // Their peaks remain above the nominal flight altitude.
  world.mountains.push(
    { x: 172, y: 111, rx: 33, ry: 52, height: 62, seed: mix32(world.seed ^ 0x1171) },
    { x: 289, y: 47, rx: 24, ry: 34, height: 47, rotation: .7, seed: mix32(world.seed ^ 0x2a91) },
    { x: 85, y: 190, rx: 26, ry: 30, height: 43, rotation: -1.1, seed: mix32(world.seed ^ 0x43e7) },
  );
  world.zones.push(
    { id: 'tucson-airport', label: 'Airport approach', kind: 'rect', x: 58, y: 179, width: 30, height: 46, angle: 0.08, known: true },
    { id: 'tucson-observatory', label: 'Observatory', kind: 'circle', x: 300, y: 110, radius: 17, known: true },
    { id: 'tucson-wash', label: 'Wash reserve', kind: 'rect', x: 210, y: 210, width: 22, height: 30, angle: -0.32, known: true },
  );

  // The tower footprint crosses a steep DEM flank. Keep the authored tower
  // and its obstacle role at the same coordinates, but give its 6 x 6 base a
  // bounded foundation at the local source elevation before the terrain grid
  // is baked. Renderer, collision, and LOS then see one stable surface.
  const towerFoundationElevation = terrainHeight(world, 274, 49);
  world.terrainPads.push({
    id: 'tucson-tower-foundation',
    x: 274,
    y: 49,
    width: 8,
    depth: 8,
    innerRadiusSquared: 1.25,
    outerRadiusSquared: 2,
    elevation: towerFoundationElevation,
  });

  addRoad(world, 154, 112, 7, 295, 0.46, '#9e6b50');
  addRoad(world, 82, 49, 7, 150, 0.05, '#9e6b50');
  addRoad(world, 274, 167, 7, 110, -0.52, '#9e6b50');
  addObject(world, { kind: 'building', x: 101, y: 120, width: 20, depth: 16, height: 10, color: '#a95f42' });
  addObject(world, { kind: 'building', x: 260, y: 220, width: 23, depth: 17, height: 11, color: '#a55c3c' });
  addObject(world, { kind: 'tower', x: 274, y: 49, width: 6, depth: 6, height: 20, color: '#d1a15d' });
  addObject(world, { kind: 'plaza', x: 78, y: 48, width: 23, depth: 19, height: 0.15, color: '#d0a06e' });
  addObject(world, { kind: 'rock', x: 204, y: 40, width: 8, depth: 7, height: 3, color: '#8f6854' });

  addLandmarkObject(world, { id: 'tucson-home', label: 'Saguaro', x: 45, y: 65, kind: 'home', home: true },
    { kind: 'tower', style: 'landmark-saguaro', width: 10, depth: 8, height: 16 });
  addLandmarkObject(world, { id: 'tucson-pass', label: 'Rock', x: 92, y: 61, kind: 'pass' },
    { kind: 'rock', style: 'landmark-rock-spire', width: 9, depth: 8, height: 10 });
  // A marked overlook on the traversable side of the central ridge gives
  // the northern pass its own online localization site.
  addObject(world, { kind: 'plaza', x: 181, y: 43, width: 7, depth: 6, height: 0.15, color: '#d0a06e' });
  addLandmarkObject(world, { id: 'tucson-overlook', label: 'Trailhead', x: 181, y: 43, kind: 'overlook' },
    { kind: 'tower', style: 'landmark-lookout', width: 8, depth: 8, height: 7 });
  addLandmarkObject(world, { id: 'tucson-wash-crossing', label: 'Wash footbridge', x: 244, y: 108, kind: 'crossing' },
    { kind: 'building', style: 'landmark-bridge', width: 12, depth: 8, height: 4 });
  addObject(world, { kind: 'plaza', x: 214, y: 146, width: 7, depth: 6, height: 0.15, color: '#d0a06e' });
  addLandmarkObject(world, { id: 'tucson-garden', label: 'Flowering saguaro', x: 214, y: 146, kind: 'trailhead' },
    { kind: 'tower', style: 'landmark-saguaro', width: 8, depth: 7, height: 12, color: '#5b9363' });
  addLandmarkObject(world, { id: 'tucson-goal', label: 'Shelter', x: 260, y: 165, kind: 'goal', goal: true, renewalRadius: 30 },
    { kind: 'building', style: 'landmark-depot', width: 14, depth: 10, height: 7 });
}

function buildAnnArborRiver(seed) {
  const phase = (hashSeed(seed) % 4096) / 4096 * TAU;
  const xSamples = [0, 24, 48, 72, 96, 120, 144, 168, 192, 216, 240, 264, 288, WORLD_WIDTH];
  const points = xSamples.map((x, index) => {
    const t = x / WORLD_WIDTH;
    const y = 151
      + 9 * Math.sin(t * TAU * 1.05 + phase * 0.09)
      + 4 * Math.sin(t * TAU * 2.05 + 1.1)
      + 1.2 * Math.sin(index * 0.7 + phase);
    return { x, y: Number(clamp(y, 132, WORLD_HEIGHT - 52).toFixed(3)) };
  });
  const bounds = points.reduce((extent, point) => ({
    minX: Math.min(extent.minX, point.x),
    maxX: Math.max(extent.maxX, point.x),
    minY: Math.min(extent.minY, point.y),
    maxY: Math.max(extent.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  return {
    id: 'huron-river',
    label: 'Huron River',
    kind: 'watercourse',
    type: 'river',
    points,
    centerline: points,
    bounds,
    width: 14,
    bankWidth: 7,
    depth: 1.8,
    surfaceOffset: -0.58,
    color: '#4f9bb0',
    bankColor: '#71906a',
    source: 'Ann Arbor Natural Features Master Plan',
    sourceUrl: 'https://www.a2gov.org/media/u1qjqduh/nfmasterplan_6-04.pdf',
  };
}

function addAnnArborGeometry(world) {
  const river = buildAnnArborRiver(world.seed);
  world.watercourses.push(river);
  world.river = river;
  const stadiumPad = {
    id: 'michigan-stadium-platform',
    x: 155,
    y: 105,
    width: 44,
    depth: 57,
    rotation: 0.08,
    innerRadiusSquared: 1.2,
    outerRadiusSquared: 2,
    // Capture the hill surface before this pad is registered so terrainHeight
    // never has to recurse through objectGroundZ while placing the stadium.
    elevation: terrainHeight(world, 155, 105),
  };
  world.terrainPads.push(stadiumPad);

  world.zones.push(
    // This metadata is intentionally separate from physical stadium geometry.
    // The renderer/simulator can reveal it only after a camera sighting.
    { id: 'stadium-crowd', label: 'Michigan Stadium crowd', kind: 'circle', x: 155, y: 105, radius: 24, known: false, crowd: true },
    { id: 'huron-river-greenway', label: 'Huron River greenway', kind: 'circle', x: 62, y: 178, radius: 14, known: true, source: 'Ann Arbor Natural Features Master Plan' },
    { id: 'campus-quad', label: 'Campus quad', kind: 'rect', x: 239, y: 89, width: 31, height: 25, angle: 0.04, known: true },
  );

  addRoad(world, 155, 113, 8, 290, 0.42, '#789b79');
  addRoad(world, 90, 48, 7, 150, -0.04, '#789b79');
  addRoad(world, 242, 158, 7, 120, -0.8, '#789b79');
  addObject(world, { kind: 'building', x: 100, y: 200, width: 22, depth: 17, height: 13, color: '#a7674f' });
  addObject(world, { kind: 'building', x: 260, y: 220, width: 24, depth: 18, height: 13, color: '#aa7354' });
  addObject(world, { kind: 'building', x: 238, y: 20, width: 22, depth: 18, height: 12, color: '#ba825c' });
  addObject(world, {
    id: 'ford-robotics-building',
    kind: 'building',
    type: 'facility',
    role: 'robotics-research',
    style: 'ford-robotics',
    label: 'Ford Robotics Building',
    landmarkId: 'annarbor-ford',
    x: 85,
    y: 50,
    width: 28,
    depth: 20,
    height: 14,
    stories: 4,
    facade: 'redbrick-glass',
    color: '#9a5048',
  });
  addObject(world, {
    id: 'michigan-medicine-medical-center',
    kind: 'building',
    type: 'hospital',
    role: 'medical-center',
    style: 'medical-center',
    label: 'Michigan Medicine',
    landmarkId: 'annarbor-medical-helipad',
    x: 213,
    y: 211,
    width: 29,
    depth: 21,
    height: 15.5,
    facade: 'medical-center',
    color: '#c5d6d2',
    helipadId: 'survival-flight-helipad',
    hasHelipad: true,
    helipad: {
      id: 'survival-flight-helipad',
      label: 'Survival Flight helipad',
      style: 'medical-center',
      surface: 'rooftop',
      source: 'U-M Health Survival Flight',
      online: true,
      sourceUrl: 'https://www.uofmhealth.org/our-care/clinical-units/survival-flight',
    },
  });
  addObject(world, { kind: 'plaza', x: 217, y: 126, width: 29, depth: 20, height: 0.2, color: '#b6a276' });

  // A wide oval, field stripes and low bowl make the stadium unmistakable in
  // the renderer while keeping all decorative structures under altitude 35.
  addObject(world, { id: 'michigan-stadium', landmarkId: 'annarbor-stadium', kind: 'stadium', x: stadiumPad.x, y: stadiumPad.y, width: stadiumPad.width, depth: stadiumPad.depth, height: 14, rotation: stadiumPad.rotation, color: '#4169a1' });

  // Compressed North Campus placement leaves a surveyed exterior launch orbit
  // around Ford, with clearance from the still-undiscovered stadium restriction.
  addLandmark(world, { id: 'annarbor-ford', objectId: 'ford-robotics-building', label: 'Ford Robotics Building', x: 85, y: 50, kind: 'robotics', home: true, facility: 'Ford Robotics Building' });
  addLandmarkObject(world, { id: 'annarbor-clocktower', label: 'Campus clock tower', x: 100, y: 85, kind: 'clocktower' },
    { kind: 'tower', style: 'landmark-clocktower', width: 8, depth: 8, height: 17 });
  addLandmark(world, {
    id: 'annarbor-medical-helipad',
    objectId: 'michigan-medicine-medical-center',
    label: 'Michigan Medicine Survival Flight helipad',
    x: 213,
    y: 211,
    kind: 'helipad',
    facility: 'Michigan Medicine',
    source: 'online',
    online: true,
    sourceUrl: 'https://www.uofmhealth.org/our-care/clinical-units/survival-flight',
    description: 'A visual landmark at the Michigan Medicine Survival Flight helipad.',
  });
  addLandmark(world, { id: 'annarbor-stadium', objectId: 'michigan-stadium', label: 'Michigan Stadium', x: 155, y: 105, kind: 'stadium', zoneId: 'stadium-crowd' });
  addLandmarkObject(world, { id: 'annarbor-goal', label: 'Blue-roof campus pavilion', x: 260, y: 170, kind: 'goal', goal: true, renewalRadius: 30 },
    { kind: 'building', style: 'landmark-campus-pavilion', width: 14, depth: 14, height: 7 });
}

function randomFeatureKind(world, rng, x, y) {
  const kinds = SPECS[world.id].featureKinds;
  // The first two kinds should be common enough to make each biome legible.
  const biomeBias = (Math.sin(x * 0.07) + Math.cos(y * 0.053)) * 0.08;
  const index = clamp(Math.floor((rng() + biomeBias) * kinds.length), 0, kinds.length - 1);
  return kinds[index];
}

function featureColor(world, kind) {
  const colors = {
    grass: '#87a85a', crop: '#a5b94f', wildflower: '#e5bd68', tree: '#376844', rock: '#77745d',
    saguaro: '#3d7954', cactus: '#4b835a', shrub: '#6f8a4d', 'desert-rock': '#8e674f', 'dry-grass': '#c49a55', ocotillo: '#a95d43',
    maple: '#b85a3f', 'path-marker': '#ac9360',
  };
  return colors[kind] || '#7f8d62';
}

function patchFeatureKind(world, rng, patch, x, y) {
  if (!Array.isArray(patch.kinds) || !patch.kinds.length) return randomFeatureKind(world, rng, x, y);
  const index = clamp(Math.floor(rng() * patch.kinds.length), 0, patch.kinds.length - 1);
  return patch.kinds[index];
}

function featurePlacementAllowed(world, x, y, allowFoothills = false) {
  // Keep points away from the visual border as well as the physical bounds.
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 3 || y < 3 || x > world.width - 3 || y > world.height - 3) return false;
  if (isFeaturePoor(world, x, y)) return false;
  // Leave the surveyed launch landmark's immediate orbit uncluttered so the
  // initial known home remains easy to acquire in the live camera.
  if ((world.landmarks || []).some((landmark) => landmark.home && distanceSquared(x, y, landmark.x, landmark.y) <= 14 ** 2)) return false;
  if (watercourseList(world).some((course) => {
    const distance = watercourseDistance(world, x, y, course);
    return watercourseEnvelopeContains(course, distance, 0.75);
  })) return false;
  if (world.objects.some((object) => pointInSolidObject(x, y, object, 2.25))) return false;
  // Talus rocks may occupy lower mountain slopes; their surfaces and shadows
  // give the camera real structure while the summit remains a flight obstacle.
  if (world.mountains.some((mountain) => mountainContains(mountain, x, y, 1.5))
    && (!allowFoothills || terrainHeight(world, x, y) > world.altitude - 12)) return false;
  return true;
}

function addFeature(world, x, y, kind, index, size = 1, allowFoothills = false) {
  if (!featurePlacementAllowed(world, x, y, allowFoothills)) return false;
  const z = surfaceHeight(world, x, y);
  world.features.push({
    // Stable scenery IDs support instancing and geometric test fixtures. The
    // browser feature map instead assigns IDs to image-detected surfaces.
    id: index,
    x,
    y,
    z,
    kind,
    size,
    color: featureColor(world, kind),
  });
  return true;
}

function sampleClusterCenter(rng, region, patch, clusterIndex) {
  if (patch.style === 'row' || patch.style === 'street') {
    // Elongated rows read as hedgerows and street trees without a repeated
    // lattice: each cluster occupies a random span and has its own jitter.
    const position = (clusterIndex + 0.18 + rng() * 0.64) / Math.max(1, patch.clusters) - 0.5;
    return {
      x: region.x + position * region.rx * 1.65,
      y: region.y + (rng() - 0.5) * region.ry * 0.36,
    };
  }
  const angle = rng() * TAU;
  const radius = Math.sqrt(rng()) * 0.72;
  return {
    x: region.x + Math.cos(angle) * region.rx * radius,
    y: region.y + Math.sin(angle) * region.ry * radius,
  };
}

function sampleClusterPoint(rng, center, patch) {
  if (patch.style === 'row' || patch.style === 'street') {
    return {
      x: center.x + (rng() - 0.5) * patch.spreadX * 2,
      y: center.y + (rng() - 0.5) * patch.spreadY * 2,
    };
  }
  const angle = rng() * TAU;
  // Concentrate points around a subcluster center while preserving enough
  // radial variation to avoid a stamped or evenly spaced appearance.
  const radius = 0.16 + Math.pow(rng(), 1.45) * 0.84;
  return {
    x: center.x + Math.cos(angle) * patch.spreadX * radius,
    y: center.y + Math.sin(angle) * patch.spreadY * radius,
  };
}

function generatePatch(world, rng, patch) {
  const region = (world.featureRegions || []).find((candidate) => candidate.id === patch.regionId);
  if (!region || region.kind !== 'rich') return;
  for (let clusterIndex = 0; clusterIndex < patch.clusters; clusterIndex += 1) {
    const center = sampleClusterCenter(rng, region, patch, clusterIndex);
    for (let pointIndex = 0; pointIndex < patch.points; pointIndex += 1) {
      if (world.features.length >= MAX_FEATURES) return;
      const point = sampleClusterPoint(rng, center, patch);
      const kind = patchFeatureKind(world, rng, patch, point.x, point.y);
      const size = patch.style === 'rock-group'
        ? 0.75 + rng() * 1.45
        : patch.style === 'street'
          ? 0.7 + rng() * 1.5
          : 0.65 + rng() * (kind.includes('rock') ? 1.25 : 1.9);
      addFeature(world, point.x, point.y, kind, world.features.length, size, patch.allowFoothills);
    }
  }
}

function generateRichEdgeBackground(world, rng) {
  // A small set of unclustered points bridges rich patches without filling
  // the broad authored clearings.  The threshold intentionally excludes the
  // neutral 0.22 baseline and all poor interiors.
  const target = world.id === 'farm' ? 34 : world.id === 'tucson' ? 28 : 32;
  const maxAttempts = target * 180;
  let accepted = 0;
  for (let attempt = 0; attempt < maxAttempts && accepted < target; attempt += 1) {
    const x = 4 + rng() * (world.width - 8);
    const y = 4 + rng() * (world.height - 8);
    const richness = featureRichness(world, x, y);
    if (richness < 0.38 || isFeaturePoor(world, x, y)) continue;
    // Prefer authored rich edges while allowing occasional transition points.
    if (rng() > 0.16 + richness * 0.7) continue;
    const kind = randomFeatureKind(world, rng, x, y);
    if (addFeature(world, x, y, kind, world.features.length, 0.65 + rng() * 1.6)) accepted += 1;
  }
}

function generateFeatures(world) {
  // Seeded subclusters create distinct groves, rows, and rock/saguaro groups
  // without the regular nearest-neighbor distances of a lattice sampler.
  const rng = mulberry32(mix32(world.seed ^ hashString(world.id)));
  for (const patch of FEATURE_PATCHES[world.id] || []) generatePatch(world, rng, patch);
  generateRichEdgeBackground(world, rng);
  if (world.id === 'farm') {
    // A short field-boundary windbreak bridges the orchard and southern lane.
    // The surrounding field interiors remain empty; these are rendered objects,
    // never injected image detections or planner feature observations.
    for (const [x, y, kind, size] of [[182, 145, 'tree', 2.6], [192, 148, 'tree', 2.4], [202, 145, 'rock', 1.5]]) {
      addFeature(world, x, y, kind, world.features.length, size);
    }
  }
  if (world.id === 'ann-arbor') {
    // A few bank-side trees frame the south campus lawn without populating
    // its deliberately sparse interior or the river itself.
    for (const [x, y, kind, size] of [[143, 174, 'tree', 2.8], [153, 176, 'maple', 2.6], [163, 174, 'tree', 2.5]]) {
      addFeature(world, x, y, kind, world.features.length, size);
    }
  }
}

/**
 * Create a deterministic procedural world.
 *
 * @param {'farm'|'tucson'|'ann-arbor'} id
 * @param {number|string} seed
 */
export function createWorld(id = 'farm', seed = 1337) {
  const normalizedId = normalizeWorldId(id);
  const normalizedSeed = hashSeed(seed);
  const spec = SPECS[normalizedId];
  const world = {
    id: normalizedId,
    label: spec.label,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    altitude: WORLD_ALTITUDE,
    seed: normalizedSeed,
    palette: { ...PALETTES[normalizedId] },
    features: [],
    featureRegions: buildFeatureRegions(normalizedId),
    landmarks: [],
    zones: [],
    mountains: [],
    hills: [],
    terrainPads: [],
    watercourses: [],
    river: null,
    objects: [],
    description: spec.description,
  };

  if (normalizedId === 'farm') addFarmGeometry(world);
  else if (normalizedId === 'tucson') addTucsonGeometry(world);
  else addAnnArborGeometry(world);
  // Construct one bounded triangle surface at runtime. Planning and rendering
  // sample the same vertices/diagonal, including the compressed DEM ridges.
  const spacing = normalizedId === 'tucson' ? 1 : 2;
  const columns = Math.round(world.width / spacing) + 1;
  const rows = Math.round(world.height / spacing) + 1;
  const heights = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    heights[row * columns + column] = terrainHeight(world, column * spacing, row * spacing);
  }
  world.terrainMesh = { spacing, columns, rows, heights };
  for (const object of world.objects) object.z = terrainHeight(world, object.x, object.y);
  for (const landmark of world.landmarks) landmark.z = surfaceHeight(world, landmark.x, landmark.y) + .12;
  generateFeatures(world);
  return world;
}

/**
 * Continuous triangle surface shared by terrain rendering, collision and LOS.
 * Before the grid exists, this evaluates the source surface used to build it.
 */
export function terrainHeight(world, x, y) {
  if (!world || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const grid = world.terrainMesh;
  if (grid) {
    const gx = clamp(x / grid.spacing, 0, grid.columns - 1);
    const gy = clamp(y / grid.spacing, 0, grid.rows - 1);
    const ix = Math.min(grid.columns - 2, Math.floor(gx));
    const iy = Math.min(grid.rows - 2, Math.floor(gy));
    const fx = gx - ix, fy = gy - iy, offset = iy * grid.columns + ix;
    const h00 = grid.heights[offset], h10 = grid.heights[offset + 1];
    const h01 = grid.heights[offset + grid.columns], h11 = grid.heights[offset + grid.columns + 1];
    return fy <= fx ? h00 * (1 - fx) + h10 * (fx - fy) + h11 * fy
      : h00 * (1 - fy) + h01 * (fy - fx) + h11 * fx;
  }
  const base = terrainBaseHeight(world, x, y);
  let height = base;
  for (const mountain of world.mountains || []) height = Math.max(height, base + mountainContribution(mountain, x, y));
  for (const course of watercourseList(world)) {
    const bounds = course.bounds;
    const margin = Math.max(0.1, Number(course.width) || 1) / 2 + Math.max(0.1, Number(course.bankWidth) || 0.1);
    if (bounds && Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX)
      && Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxY)
      && (x < bounds.minX - margin || x > bounds.maxX + margin || y < bounds.minY - margin || y > bounds.maxY + margin)) continue;
    height -= watercourseBedDepression(course, courseDistance(course, x, y));
  }
  for (const pad of world.terrainPads || []) height = terrainPadHeight(height, x, y, pad);
  return height;
}

/** Height of the visible surface, including solid buildings and towers. */
export function surfaceHeight(world, x, y) {
  let height = terrainHeight(world, x, y);
  for (const object of world.objects || []) {
    if (pointInSolidObject(x, y, object, 0)) {
      // Objects are placed on the terrain at their center.  Taking the local
      // terrain too avoids a building appearing buried where a ridge slopes.
      const objectHeight = object.kind === 'stadium' ? (pointInStadiumRim(x, y, object) ? Math.min(object.height, 7) : .2) : object.height;
      height = Math.max(height, Math.max(terrainHeight(world, x, y), object.z) + objectHeight);
    }
  }
  return height;
}

/** Test a circle or rotated rectangle zone without consulting world state. */
export function inZone(zone, x, y, margin = 0) {
  if (!zone || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const safeMargin = Number.isFinite(margin) ? margin : 0;
  if (zone.kind === 'circle') {
    const radius = Math.max(0, (Number(zone.radius) || 0) + safeMargin);
    return distanceSquared(x, y, zone.x, zone.y) <= radius * radius;
  }
  if (zone.kind === 'rect') {
    const angle = Number(zone.angle) || 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = x - zone.x;
    const dy = y - zone.y;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    return Math.abs(localX) <= Math.max(0, Number(zone.width) / 2 + safeMargin)
      && Math.abs(localY) <= Math.max(0, Number(zone.height) / 2 + safeMargin);
  }
  return false;
}

/**
 * Collision at the world surface.  Zones are intentionally absent: an NFZ is
 * policy/gameplay metadata, while this function answers physical geometry
 * questions about terrain, buildings and world bounds only.
 */
export function worldCollision(world, x, y, clearance = 0) {
  if (!world || !Number.isFinite(x) || !Number.isFinite(y)) return true;
  const margin = Math.max(0, Number(clearance) || 0);
  if (x <= margin || y <= margin || x >= world.width - margin || y >= world.height - margin) return true;
  // This is a horizontal collision query for the nominal flight layer.  Low
  // buildings remain LOS occluders, but do not turn every safe corridor into a
  // forbidden cell: only geometry that reaches the flight altitude matters.
  const flightSurface = Number.isFinite(world.altitude) ? world.altitude - margin : WORLD_ALTITUDE - margin;
  if (terrainHeight(world, x, y) >= flightSurface) return true;
  for (const object of world.objects || []) {
    if (pointInSolidObject(x, y, object, margin) && Math.max(terrainHeight(world, x, y), Number(object.z) || 0) + (Number(object.height) || 0) >= flightSurface) return true;
  }
  return false;
}

function segmentPoint(from, to, t) {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/**
 * Conservative segment visibility check against terrain and solid objects.
 * Sampling is tied to distance (rather than a fixed number of steps), so a
 * long ridge cannot be skipped by a high-speed camera ray.
 */
export function lineOfSight(world, from, to) {
  if (!world || !from || !to || typeof from.length !== 'number' || typeof to.length !== 'number' || from.length < 3 || to.length < 3) return false;
  if (![...from.slice(0, 3), ...to.slice(0, 3)].every(Number.isFinite)) return false;
  if (from[0] < 0 || from[0] > world.width || from[1] < 0 || from[1] > world.height || to[0] < 0 || to[0] > world.width || to[1] < 0 || to[1] > world.height) return false;

  // Endpoints may sit on their modeled surface, but a buried camera/target
  // cannot observe through the ground or a solid structure.
  for (const p of [from, to]) {
    if (p[2] < terrainHeight(world, p[0], p[1]) - EPSILON) return false;
    for (const object of world.objects || []) {
      if (object.kind === 'stadium') {
        if (pointInStadiumRim(p[0], p[1], object) && p[2] < Math.max(terrainHeight(world, p[0], p[1]), object.z) + Math.min(object.height, 7) - EPSILON) return false;
      } else if (pointInSolidObject(p[0], p[1], object) && p[2] < Math.max(terrainHeight(world, p[0], p[1]), object.z) + object.height - EPSILON) return false;
    }
  }

  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const horizontalDistance = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.ceil(horizontalDistance / 1.5));
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    const [x, y, z] = segmentPoint(from, to, t);
    const terrain = terrainHeight(world, x, y);
    if (z <= terrain + EPSILON) return false;
    for (const object of world.objects || []) {
      if (object.kind === 'stadium') {
        const rimHeight = Math.min(Number(object.height) || 0, 7);
        if (pointInStadiumRim(x, y, object, 0.25) && z <= Math.max(terrain, object.z) + rimHeight + EPSILON) return false;
        continue;
      }
      if (pointInSolidObject(x, y, object, 0.25) && z <= Math.max(terrain, object.z) + object.height + EPSILON) return false;
    }
  }

  // Endpoints may intentionally sit on a visible surface (launch/landing),
  // but an interior mountain/band must still block the ray.  The terrain loop
  // above already handles mountain shoulders; this explicit check preserves a
  // conservative obstruction for very narrow high ridges.
  for (const mountain of world.mountains || []) {
    const samples = Math.max(8, Math.ceil((mountain.rx + mountain.ry) / 4));
    for (let i = 1; i < samples; i += 1) {
      const t = i / samples;
      const x = from[0] + dx * t;
      const y = from[1] + dy * t;
      if (!mountainContains(mountain, x, y, 0.75)) continue;
      const z = from[2] + dz * t;
      if (z <= terrainHeight(world, x, y) + EPSILON) return false;
    }
  }
  return true;
}

export const WORLD_IDS = Object.freeze(['farm', 'tucson', 'ann-arbor']);

export default createWorld;
