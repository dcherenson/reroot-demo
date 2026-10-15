import assert from 'node:assert/strict';
import test from 'node:test';

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
import { Simulation } from '../../assets/budget-planning/simulation.js';

const EPSILON = 1e-8;

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

  let maximumTerrain = -Infinity;
  for (let y = 0; y <= city.height; y += 2) {
    for (let x = 0; x <= city.width; x += 2) maximumTerrain = Math.max(maximumTerrain, terrainHeight(city, x, y));
  }
  assert.ok(maximumTerrain < city.altitude, 'Ann Arbor hills must stay below the flight layer');
  assert.ok(terrainHeight(city, city.hills[0].x, city.hills[0].y) > terrainHeight(city, city.hills[0].x, city.hills[0].y - 28));
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
  const farm = createWorld('farm', 1337);
  const home = farm.landmarks[0];
  const goal = farm.landmarks.at(-1);
  const aviary = farm.zones.find((zone) => zone.id === 'farm-aviary');
  const t = (aviary.x - home.x) / (goal.x - home.x);
  const routeY = home.y + (goal.y - home.y) * t;
  assert.equal(inZone(aviary, aviary.x, routeY), true);
  assert.equal(worldCollision(farm, aviary.x, routeY), false);
});
