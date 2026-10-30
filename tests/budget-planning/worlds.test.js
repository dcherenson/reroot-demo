import assert from 'node:assert/strict';
import test from 'node:test';
import { CatmullRomCurve3, Vector3 } from 'three';

import {
  MAX_FEATURES,
  WORLD_ALTITUDE,
  WORLD_HEIGHT,
  WORLD_IDS,
  WORLD_WIDTH,
  createWorld,
  featureRichness,
  inZone,
  isFeaturePoor,
  isInWatercourse,
  lineOfSight,
  surfaceHeight,
  terrainHeight,
  watercourseDistance,
  watercourseSurface,
  worldCollision,
} from '../../assets/budget-planning/worlds.js';
import { sampleAnnArborCampusHeight } from '../../assets/terrain/ground-elevation.js';
import { Simulation } from '../../assets/budget-planning/simulation.js';
import { pathLength, samplePaths } from '../../assets/budget-planning/dubins.js';

const EPSILON = 1e-8;

function distanceToSegment(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
}

function featureRoadClearance(world, road, feature) {
  const kind = String(feature.kind).toLowerCase();
  const tree = kind.includes('tree') || kind.includes('maple');
  const footprint = tree
    ? feature.size * (world.id === 'ann-arbor' ? 2 : 1.3)
    : kind.includes('shrub') ? feature.size * .95
      : kind.includes('rock') ? feature.size * .9
        : feature.size * .65;
  const asphaltShoulder = world.id === 'ann-arbor' && road.surface === 'asphalt' ? .7 : 0;
  return (road.width / 2) + asphaltShoulder + 1.5 + footprint;
}

function distanceToRoadPolyline(x, y, path) {
  let nearest = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    nearest = Math.min(nearest, distanceToSegment(x, y, path[index - 1], path[index]));
  }
  return nearest;
}

function sampleRoadCenterline(path, spacing = .25) {
  const points = path.map(([x, y]) => new Vector3(x, 0, y));
  const length = points.slice(1).reduce((sum, point, index) => sum + point.distanceTo(points[index]), 0);
  const curve = new CatmullRomCurve3(points, false, 'centripetal', .5);
  curve.arcLengthDivisions = Math.max(200, Math.ceil(length * 4));
  curve.updateArcLengths();
  const count = Math.max(1, Math.ceil(curve.getLength() / spacing));
  return Array.from({ length: count + 1 }, (_, index) => curve.getPointAt(index / count));
}

function objectFootprintDistance(x, y, object) {
  const angle = Number(object.rotation) || 0;
  const dx = x - object.x, dy = y - object.y;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.hypot(
    Math.max(0, Math.abs(localX) - object.width / 2),
    Math.max(0, Math.abs(localY) - object.depth / 2),
  );
}

test('launch sites and all localization landmarks are anchored to recognizable physical objects', () => {
  for (const [id,style] of [['farm','landmark-barnhouse'],['tucson','landmark-saguaro'],['ann-arbor','ford-robotics']]) {
    const simulation=new Simulation(id,{},1337,{pixelFeatures:true});
    const {world,knowledge,pose,cameraYaw}=simulation;
    const home=world.landmarks[0];
    assert.equal(home.home,true);
    assert.equal(world.landmarks.filter(l=>l.home).length,1);
    for(const landmark of world.landmarks) {
      const physical=world.objects.find(o=>o.id===landmark.objectId);
      assert.ok(physical,`${landmark.id} must have a physical scene object`);
      assert.equal(physical.landmarkId,landmark.id);
      assert.deepEqual([landmark.x,landmark.y],[physical.x,physical.y]);
      assert.ok(Math.abs(landmark.z-surfaceHeight(world,landmark.x,landmark.y)-.12)<EPSILON);
    }
    assert.equal(world.objects.find(o=>o.id===home.objectId).style,style);
    assert.deepEqual([...knowledge.discovered],[home.id],'only home is known before sensing');
    assert.equal(knowledge.certifyOrbit(home),true,'the physical launch site must retain a valid home orbit');
    assert.ok(knowledge.visibleLandmarks(pose,cameraYaw).some(l=>l.id===home.id),'home must be visible from the initial UAV pose');
  }
});

test('all worlds are seeded, bounded and replayable', () => {
  for (const id of WORLD_IDS) {
    const first = createWorld(id, 1337);
    const replay = createWorld(id, 1337);
    const alternate = createWorld(id, 1338);

    assert.deepEqual(first, replay, `${id} should replay exactly with the same seed`);
    assert.notDeepEqual(first.features, alternate.features, `${id} should vary with a new seed`);
    assert.equal(first.width, WORLD_WIDTH);
    assert.equal(first.height, WORLD_HEIGHT);
    assert.equal(first.altitude, WORLD_ALTITUDE);
    assert.ok(first.features.length >= 180, `${id} should retain authored scenery clusters`);
    assert.ok(first.features.length <= MAX_FEATURES, `${id} exceeded the feature budget`);
    assert.deepEqual(first.features.map((feature) => feature.id), first.features.map((_, index) => index));
    assert.ok(first.featureRegions.filter((region) => region.kind === 'poor').length >= 2);
    assert.ok(first.featureRegions.filter((region) => region.kind === 'rich').length >= 2);
    for (const region of first.featureRegions.filter((candidate) => candidate.kind === 'rich')) {
      const count = first.features.filter((feature) => (
        ((feature.x - region.x) / region.rx) ** 2 + ((feature.y - region.y) / region.ry) ** 2 <= 1
      )).length;
      assert.ok(count >= 8, `${id} rich region ${region.id} should contain a real cluster`);
    }
    assert.equal(first.landmarks[0].home, true);
    assert.equal(first.landmarks.at(-1).goal, true);
    const expectedLandmarkCount = id === 'farm' ? 4 : id === 'tucson' ? 6 : 5;
    assert.equal(first.landmarks.length, expectedLandmarkCount);
    assert.ok(first.palette.ground && first.palette.accent && first.palette.sky);
  }
});

test('Tucson tower has a level foundation shared by its visual base and collision surface', () => {
  const world = createWorld('tucson');
  const tower = world.objects.find(object => object.kind === 'tower' && !object.landmarkId);
  for (let dx = -tower.width / 2; dx <= tower.width / 2; dx += .5) {
    for (let dy = -tower.depth / 2; dy <= tower.depth / 2; dy += .5) {
      assert.ok(Math.abs(terrainHeight(world, tower.x + dx, tower.y + dy) - tower.z) < 1e-5);
    }
  }
  assert.equal(worldCollision(world, tower.x, tower.y), true);
});

test('scenery is clustered around authored edges rather than spread on a grid', () => {
  for (const id of WORLD_IDS) {
    const world = createWorld(id, 1337);
    const richRegions = world.featureRegions.filter((region) => region.kind === 'rich');
    const poorRegions = world.featureRegions.filter((region) => region.kind === 'poor');
    const richCount = world.features.filter((feature) => richRegions.some((region) => (
      ((feature.x - region.x) / region.rx) ** 2 + ((feature.y - region.y) / region.ry) ** 2 <= 1
    ))).length;
    const poorInteriorCount = world.features.filter((feature) => poorRegions.some((region) => (
      ((feature.x - region.x) / (region.rx * 0.68)) ** 2 + ((feature.y - region.y) / (region.ry * 0.68)) ** 2 <= 1
    ))).length;
    assert.ok(richCount > poorInteriorCount * 4 + 20, `${id} should concentrate scenery in authored rich patches`);

    // A lattice creates many repeated coordinates at fixed cell centers.  The
    // seeded cluster sampler should have a long, irregular coordinate tail.
    const coordinateCount = new Set(world.features.map((feature) => `${feature.x.toFixed(4)},${feature.y.toFixed(4)}`)).size;
    assert.ok(coordinateCount > world.features.length * 0.98, `${id} scenery coordinates should remain irregular`);
  }
});

test('Farm and Ann Arbor natural features clear road shoulders and tree crowns', () => {
  for (const id of ['farm', 'ann-arbor']) {
    const world = createWorld(id, 1337);
    const roads = world.objects.filter((object) => object.kind === 'road' && Array.isArray(object.path));
    assert.ok(roads.length > 0);

    // World paths are Catmull-Rom splines. Their authored control polylines
    // stay within about 1.2 m of those curves, so the 1.5 m margin here is a
    // conservative, lightweight check that does not import rendering code.
    for (const feature of world.features) for (const road of roads) {
      const distance = distanceToRoadPolyline(feature.x, feature.y, road.path);
      assert.ok(distance > featureRoadClearance(world, road, feature),
        `${id} ${feature.kind} ${feature.id} should clear road ${distance.toFixed(2)} m away`);
    }

    // Clearing a road must relocate its grove, not erase the visual texture
    // the camera needs at the transition into an intentionally sparse field.
    assert.ok(world.features.length >= (id === 'farm' ? 500 : 380), `${id} should retain authored scenery clusters`);
    for (const region of world.featureRegions.filter((candidate) => candidate.kind === 'rich')) {
      const count = world.features.filter((feature) => (
        ((feature.x - region.x) / region.rx) ** 2 + ((feature.y - region.y) / region.ry) ** 2 <= 1
      )).length;
      assert.ok(count >= 8, `${id} rich region ${region.id} should remain populated`);
    }
    const sparseLimit = Math.max(2, Math.ceil(world.features.length * 0.02));
    for (const region of world.featureRegions.filter((candidate) => candidate.kind === 'poor')) {
      const interiorCount = world.features.filter((feature) => (
        ((feature.x - region.x) / (region.rx * 0.68)) ** 2 + ((feature.y - region.y) / (region.ry * 0.68)) ** 2 <= 1
      )).length;
      assert.ok(interiorCount <= sparseLimit, `${id} ${region.id} should remain sparse`);
    }
  }
});

test('Farm and Ann Arbor add connected, bounded roads clear of buildings and the river', () => {
  const farm = createWorld('farm', 1337);
  const farmRoads = farm.objects.filter((object) => object.kind === 'road' && Array.isArray(object.path));
  assert.equal(farmRoads.length, 3, 'Farm should have a main lane and two connected branches');
  assert.ok(farmRoads.every((road) => road.surface === 'gravel'));
  const orchardLoop = farmRoads[1];
  for (const [x, y] of [orchardLoop.path[0], orchardLoop.path.at(-1)]) {
    assert.ok(distanceToRoadPolyline(x, y, farmRoads[0].path) < .05,
      'both ends of the orchard loop should rejoin the main Farm lane');
  }
  assert.ok(distanceToRoadPolyline(...farmRoads[2].path[0], farmRoads[0].path) < .05,
    'the southern Farm lane should branch from the main route');
  assert.ok(farm.height - farmRoads[2].path.at(-1)[1] >= 5,
    'the southern Farm lane should end inside the map with room for its verge');

  const city = createWorld('ann-arbor', 1337);
  const cityRoads = city.objects.filter((object) => object.kind === 'road' && Array.isArray(object.path));
  assert.equal(cityRoads.length, 5, 'Ann Arbor should have its two main streets and three connected access routes');
  assert.ok(cityRoads.every((road) => road.surface === 'asphalt'));
  const northStreet = cityRoads[0], southStreet = cityRoads[1];
  const campusLoop = cityRoads[2], fordAccess = cityRoads[3], pavilionAccess = cityRoads[4];
  for (const [x, y] of [campusLoop.path[0], campusLoop.path.at(-1)]) {
    assert.ok(distanceToRoadPolyline(x, y, northStreet.path) < .05,
      'both ends of the campus bypass should join the north street');
  }
  assert.ok(distanceToRoadPolyline(...fordAccess.path[0], northStreet.path) < .05,
    'the Ford access street should join the north street');
  assert.ok(distanceToRoadPolyline(...pavilionAccess.path[0], southStreet.path) < .05,
    'the pavilion access street should join the south street');

  for (const world of [farm, city]) {
    const roads = world.objects.filter((object) => object.kind === 'road' && Array.isArray(object.path));
    const solidObjects = world.objects.filter((object) => ['building', 'tower', 'plaza', 'stadium'].includes(object.kind));
    for (const road of roads) {
      const shoulder = world.id === 'ann-arbor' && road.surface === 'asphalt' ? .7 : 0;
      const roadRadius = road.width / 2 + shoulder;
      for (const point of sampleRoadCenterline(road.path)) {
        assert.ok(point.x >= roadRadius && point.x <= world.width - roadRadius
          && point.z >= roadRadius && point.z <= world.height - roadRadius,
        `${world.id} road centerline and verge should stay inside the map`);
        for (const object of solidObjects) {
          const distance = objectFootprintDistance(point.x, point.z, object);
          assert.ok(distance > roadRadius + .2,
            `${world.id} road should clear ${object.label || object.kind} by ${distance.toFixed(2)} m`);
        }
        if (world.river) {
          const distance = watercourseDistance(world, point.x, point.z);
          const riverBuffer = world.river.width / 2 + world.river.bankWidth + roadRadius;
          assert.ok(distance > riverBuffer + .2,
            `Ann Arbor road should clear the Huron River and bank by ${distance.toFixed(2)} m`);
        }
      }
    }
  }

  const ford = city.objects.find((object) => object.style === 'ford-robotics');
  const pavilion = city.objects.find((object) => object.style === 'landmark-campus-pavilion');
  assert.ok(objectFootprintDistance(...fordAccess.path.at(-1), ford) <= 12,
    'Ford access should terminate near the building entrance area');
  assert.ok(objectFootprintDistance(...pavilionAccess.path.at(-1), pavilion) <= 12,
    'pavilion access should terminate near the goal building');
});

test('poor interiors stay nearly empty and richness metadata is queryable', () => {
  for (const id of WORLD_IDS) {
    const world = createWorld(id, 2026);
    const poorRegions = world.featureRegions.filter((region) => region.kind === 'poor');
    const sparseLimit = Math.max(2, Math.ceil(world.features.length * 0.02));
    for (const region of poorRegions) {
      const interiorCount = world.features.filter((feature) => (
        ((feature.x - region.x) / (region.rx * 0.68)) ** 2 + ((feature.y - region.y) / (region.ry * 0.68)) ** 2 <= 1
      )).length;
      assert.ok(interiorCount <= sparseLimit, `${id} ${region.id} interior should remain sparse`);
      assert.ok(featureRichness(world, region.x, region.y) <= 0.1);
      assert.equal(isFeaturePoor(world, region.x, region.y), true);
    }
    for (const region of world.featureRegions.filter((candidate) => candidate.kind === 'rich')) {
      assert.ok(featureRichness(world, region.x, region.y) >= 0.75);
      assert.equal(isFeaturePoor(world, region.x, region.y), false);
    }
  }
});

test('feature points sit on the generated visible surface', () => {
  for (const id of WORLD_IDS) {
    const world = createWorld(id, 2026);
    for (const feature of world.features) {
      assert.ok(Number.isFinite(feature.x) && Number.isFinite(feature.y) && Number.isFinite(feature.z));
      assert.ok(feature.x >= 0 && feature.x <= world.width);
      assert.ok(feature.y >= 0 && feature.y <= world.height);
      assert.ok(feature.z + EPSILON >= terrainHeight(world, feature.x, feature.y));
      assert.ok(Math.abs(feature.z - surfaceHeight(world, feature.x, feature.y)) <= EPSILON);
    }
  }
});

test('Tucson mountains are real LOS and collision obstacles with clear passes', () => {
  const world = createWorld('tucson', 1337);
  const [ridge] = world.mountains;
  assert.ok(ridge.height > world.altitude);
  assert.ok(world.features.some((feature) => feature.kind === 'saguaro'));
  assert.ok(terrainHeight(world, ridge.x, ridge.y) > terrainHeight(world, 25, 25) + 20);
  assert.equal(worldCollision(world, ridge.x, ridge.y), true);
  assert.equal(worldCollision(world, 0, world.height / 2), true);

  const acrossRidge = [ridge.x - ridge.rx * 2, ridge.y, world.altitude];
  const acrossRidgeTo = [ridge.x + ridge.rx * 2, ridge.y, world.altitude];
  assert.equal(lineOfSight(world, acrossRidge, acrossRidgeTo), false);

  const northPass = [ridge.x - ridge.rx * 2, ridge.y - ridge.ry * 1.5, world.altitude];
  const northPassTo = [ridge.x + ridge.rx * 2, ridge.y - ridge.ry * 1.5, world.altitude];
  assert.equal(lineOfSight(world, northPass, northPassTo), true);
});

test('zones use explicit knowledge metadata and do not become physical collision', () => {
  const city = createWorld('ann-arbor', 1337);
  const crowd = city.zones.find((zone) => zone.crowd);
  assert.ok(crowd);
  assert.equal(crowd.known, false);
  assert.equal(crowd.kind, 'circle');
  assert.equal(inZone(crowd, crowd.x, crowd.y), true);
  assert.equal(inZone(crowd, crowd.x + crowd.radius + 1, crowd.y), false);
  assert.ok(city.landmarks.some((landmark) => landmark.label === 'Michigan Stadium'));
  assert.equal(
    lineOfSight(city, [155, 40, city.altitude], [crowd.x, crowd.y, terrainHeight(city, crowd.x, crowd.y) + 0.5]),
    true,
    'the open stadium bowl must be visible before its crowd zone is revealed',
  );
  const lowBuilding = city.objects.find((object) => object.kind === 'building');
  assert.ok(lowBuilding);
  assert.equal(worldCollision(city, lowBuilding.x, lowBuilding.y), false, 'below-altitude buildings are LOS obstacles, not flight-layer cells');

  // Removing zone metadata must not change a physical collision result.
  const noZones = { ...city, zones: [] };
  for (const point of [[25, 25], [155, 105], [300, 210]]) {
    assert.equal(worldCollision(city, point[0], point[1]), worldCollision(noZones, point[0], point[1]));
  }
  assert.equal(city.zones.filter((zone) => zone.known).length, 2);
});

test('Ann Arbor truth shares a winding Huron River with terrain and scenery', () => {
  const city = createWorld('ann-arbor', 1337);
  const river = city.river;
  assert.ok(river);
  assert.equal(city.watercourses.length, 1);
  assert.equal(city.watercourses[0], river);
  assert.equal(river.id, 'huron-river');
  assert.ok(river.points.length >= 10);
  assert.deepEqual(river.centerline, river.points);
  assert.ok(new Set(river.points.map((point) => point.y)).size > 5, 'the river should visibly wind');
  assert.ok(river.width > 0 && river.bankWidth > 0 && river.depth > 0);

  const center = river.points[Math.floor(river.points.length / 2)];
  const centerDistance = watercourseDistance(city, center.x, center.y);
  assert.ok(centerDistance <= EPSILON);
  assert.equal(isInWatercourse(city, center.x, center.y), true);
  assert.ok(watercourseSurface(city, center.x, center.y) > terrainHeight(city, center.x, center.y));

  const riverFeatures = city.features.filter((feature) => (
    watercourseDistance(city, feature.x, feature.y) <= river.width / 2 + river.bankWidth
  ));
  assert.equal(riverFeatures.length, 0, 'procedural features must leave the river and its banks clear');
  for (const object of city.objects.filter((item) => item.kind === 'building')) {
    assert.ok(
      watercourseDistance(city, object.x, object.y) > river.width / 2 + river.bankWidth,
      `${object.label || object.id || 'building'} must not be placed in the river`,
    );
  }

  let minimumTerrain = Infinity;
  let maximumTerrain = -Infinity;
  for (let y = 0; y <= city.height; y += 2) {
    for (let x = 0; x <= city.width; x += 2) {
      const height = terrainHeight(city, x, y);
      minimumTerrain = Math.min(minimumTerrain, height);
      maximumTerrain = Math.max(maximumTerrain, height);
    }
  }
  assert.ok(maximumTerrain < city.altitude, 'Ann Arbor hills must stay below the flight layer');
  assert.ok(maximumTerrain > 5, 'the measured campus terrain retains gradual relief');
  assert.ok(maximumTerrain - minimumTerrain >= 10 && maximumTerrain - minimumTerrain <= 14,
    `Ann Arbor should have visible rolling relief (${(maximumTerrain - minimumTerrain).toFixed(2)} m total spread)`);
  assert.equal(city.terrainMesh.heights.length, 161 * 116, 'campus surface storage remains bounded');
});

test('Ann Arbor terrain adds visible broad rolls while preserving level pads and flight clearance', () => {
  const city = createWorld('ann-arbor', 1337);
  const reliefSamples = [];
  let maximumSlope = 0;
  for (let y = 0; y <= city.height; y += 2) {
    for (let x = 0; x <= city.width; x += 2) {
      const height = terrainHeight(city, x, y);
      if (x + 2 <= city.width) maximumSlope = Math.max(maximumSlope,
        Math.abs(terrainHeight(city, x + 2, y) - height) / 2);
      if (y + 2 <= city.height) maximumSlope = Math.max(maximumSlope,
        Math.abs(terrainHeight(city, x, y + 2) - height) / 2);
    }
  }
  for (let y = 16; y < city.height; y += 16) for (let x = 16; x < city.width; x += 16) {
    // Measure the added roll away from river cuts and the stadium foundation.
    if (watercourseDistance(city, x, y) < 25 || (Math.abs(x - 155) < 48 && Math.abs(y - 105) < 58)) continue;
    const measured = 1 + sampleAnnArborCampusHeight(x / city.width, 1 - y / city.height, 0) * 6;
    reliefSamples.push({ x, y, delta: terrainHeight(city, x, y) - measured });
  }
  const deltas = reliefSamples.map((sample) => sample.delta);
  const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const rms = Math.sqrt(deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / deltas.length);
  const reliefSpread = Math.max(...deltas) - Math.min(...deltas);
  let maximumCoarseChange = 0;
  for (const sample of reliefSamples) for (const adjacent of reliefSamples) {
    if (Math.abs(sample.x - adjacent.x) + Math.abs(sample.y - adjacent.y) === 16) {
      maximumCoarseChange = Math.max(maximumCoarseChange, Math.abs(sample.delta - adjacent.delta));
    }
  }
  assert.ok(rms > 2.2 && rms < 2.8, `broad campus relief should be visible but gentle (RMS ${rms.toFixed(2)} m)`);
  assert.ok(reliefSpread > 8.5 && reliefSpread < 9.8,
    `campus rolls should add several metres of variation (spread ${reliefSpread.toFixed(2)} m)`);
  assert.ok(maximumCoarseChange < 1.35,
    `broad terrain should change gradually over 16 m (${maximumCoarseChange.toFixed(2)} m)`);
  assert.ok(maximumSlope < .75, `terrain should avoid prominent local slopes (${maximumSlope.toFixed(2)} m/m)`);

  let minimumFlightClearance = Infinity;
  let maximumFootprintRelief = 0;
  let stadiumFootprintRelief = Infinity;
  for (const object of city.objects) {
    if (Number.isFinite(object.z) && Number.isFinite(object.height)) {
      minimumFlightClearance = Math.min(minimumFlightClearance, city.altitude - object.z - object.height);
    }
    if (!['building', 'plaza', 'tower', 'stadium'].includes(object.kind)) continue;
    let minimum = Infinity, maximum = -Infinity;
    for (let ix = 0; ix <= 10; ix += 1) for (let iy = 0; iy <= 10; iy += 1) {
      const localX = (ix / 10 - .5) * object.width;
      const localY = (iy / 10 - .5) * object.depth;
      const angle = Number(object.rotation) || 0;
      const x = object.x + localX * Math.cos(angle) - localY * Math.sin(angle);
      const y = object.y + localX * Math.sin(angle) + localY * Math.cos(angle);
      const height = terrainHeight(city, x, y);
      minimum = Math.min(minimum, height);
      maximum = Math.max(maximum, height);
    }
    maximumFootprintRelief = Math.max(maximumFootprintRelief, maximum - minimum);
    if (object.kind === 'stadium') stadiumFootprintRelief = maximum - minimum;
  }
  assert.ok(minimumFlightClearance >= 8,
    `all buildings and towers should retain flight clearance (${minimumFlightClearance.toFixed(2)} m)`);
  assert.ok(maximumFootprintRelief < 3,
    `terrain should not cut steeply across authored footprints (${maximumFootprintRelief.toFixed(2)} m)`);
  assert.ok(stadiumFootprintRelief < .1,
    `the full stadium footprint should remain level (${stadiumFootprintRelief.toFixed(2)} m)`);

  const stadiumPad = city.terrainPads.find((pad) => pad.id === 'michigan-stadium-platform');
  assert.ok(stadiumPad);
  for (const x of [145, 155, 165]) for (const y of [95, 105, 115]) {
    assert.ok(Math.abs(terrainHeight(city, x, y) - stadiumPad.elevation) < 1e-5,
      'the stadium field should remain level inside its foundation pad');
  }
});

test('Ann Arbor authored facilities keep five landmark roots and safe dimensions', () => {
  const city = createWorld('ann-arbor', 1337);
  assert.equal(city.landmarks.length, 5, 'the world must retain five authored localization landmarks');
  assert.deepEqual(city.landmarks.map((landmark) => landmark.id), [
    'annarbor-ford',
    'annarbor-clocktower',
    'annarbor-medical-helipad',
    'annarbor-stadium',
    'annarbor-goal',
  ]);
  assert.deepEqual([city.landmarks[0].x, city.landmarks[0].y], [85, 50]);
  assert.deepEqual([city.landmarks.at(-1).x, city.landmarks.at(-1).y], [260, 170]);
  assert.deepEqual([city.landmarks.find((landmark) => landmark.id === 'annarbor-stadium').x, city.landmarks.find((landmark) => landmark.id === 'annarbor-stadium').y], [155, 105]);

  const fordLandmark = city.landmarks.find((landmark) => landmark.id === 'annarbor-ford');
  assert.ok(fordLandmark);
  assert.equal(fordLandmark.kind, 'robotics');
  assert.equal(fordLandmark.facility, 'Ford Robotics Building');
  assert.deepEqual([fordLandmark.x, fordLandmark.y], [85, 50]);
  assert.equal(fordLandmark.home, true);
  assert.equal(city.landmarks[0], fordLandmark);

  const ford = city.objects.find((object) => object.style === 'ford-robotics');
  assert.ok(ford);
  assert.equal(ford.label, 'Ford Robotics Building');
  assert.equal(ford.stories, 4);
  assert.equal(ford.facade, 'redbrick-glass');
  assert.ok(ford.width >= 20 && ford.depth >= 14 && ford.height >= 10);

  const medical = city.objects.find((object) => object.style === 'medical-center' && object.kind === 'building');
  assert.ok(medical);
  assert.equal(medical.label, 'Michigan Medicine');
  assert.equal(medical.hasHelipad, true);
  assert.equal(medical.helipad.surface, 'rooftop');
  const helipad = city.landmarks.find((landmark) => landmark.kind === 'helipad');
  assert.ok(helipad);
  assert.equal(helipad.source, 'online');
  assert.match(helipad.sourceUrl, /uofmhealth\.org\/our-care\/clinical-units\/survival-flight/);
  assert.deepEqual([helipad.x, helipad.y], [medical.x, medical.y]);

  assert.equal(city.objects.some((object) => object.kind === 'tower' && Math.abs(object.x - 155) < 40 && Math.abs(object.y - 105) < 30), false);
  assert.equal(city.zones.some((zone) => zone.id === 'arboretum-helipad'), false);
  assert.ok(city.zones.some((zone) => zone.id === 'huron-river-greenway'));
  for (const object of city.objects) {
    if (!Number.isFinite(object.z) || !Number.isFinite(object.height)) continue;
    assert.ok(object.z + object.height < city.altitude, `${object.label || object.kind} must remain below flight altitude`);
  }
});

test('farm restricted airspace crosses the direct nominal route while remaining separate from collision', () => {
  const simulation = new Simulation('farm', { gatekeeper: false }, 1337);
  const farm = simulation.world;
  const aviary = farm.zones.find((zone) => zone.id === 'farm-aviary');
  assert.equal(aviary.known, true);
  // The aircraft starts on the home orbit and joins a goal-orbit tangent.
  // Its bounded-turn route differs from a line between the landmark centers.
  const paths = simulation.nominalPaths;
  assert.ok(paths.length > 0);
  const incursions = [];
  for (let distance = 0; distance <= pathLength(paths); distance += .5) {
    const pose = samplePaths(paths, distance);
    if (inZone(aviary, pose[0], pose[1])) incursions.push(pose);
  }
  assert.ok(incursions.length > 0, 'the actual nominal route must intersect the aviary restriction');
  assert.ok(incursions.every(pose => !worldCollision(farm, pose[0], pose[1])),
    'restricted airspace should remain distinct from physical collision geometry');
});
