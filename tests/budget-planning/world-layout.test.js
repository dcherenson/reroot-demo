import assert from 'node:assert/strict';
import test from 'node:test';

import { Simulation } from '../../assets/budget-planning/simulation.js';
import {
  applyWorldLayout,
  getLayoutTargets,
  updatedLayout,
  validateWorldLayout,
} from '../../assets/budget-planning/world-layout.js';
import { createWorld, terrainHeight, worldCollision, lineOfSight } from '../../assets/budget-planning/worlds.js';

test('empty layout preserves every authored world value', () => {
  for (const id of ['farm', 'tucson', 'ann-arbor']) {
    assert.deepEqual(createWorld(id, 1337), createWorld(id, 1337, {}));
  }
});

test('layout edits are finite, bounded, immutable, and atomic', () => {
  const world = createWorld('farm', 1337);
  const current = { landmarks: { 'farm-goal': { x: 260, y: 165 } } };
  const copy = structuredClone(current);
  const next = updatedLayout(world, current, { type: 'landmark', id: 'farm-goal', x: 250, y: 160 });
  assert.deepEqual(current, copy);
  assert.deepEqual(next.landmarks['farm-goal'], { x: 250, y: 160 });
  assert.throws(() => updatedLayout(world, next, { type: 'landmark', id: 'farm-goal', x: -1, y: 160 }), /footprint/);
  assert.throws(() => updatedLayout(world, next, { type: 'landmark', id: 'unknown', x: 10, y: 10 }), /Unknown/);
  assert.throws(() => updatedLayout(world, next, { type: 'landmark', id: 'farm-goal', x: NaN, y: 10 }), /finite/);

  const before = structuredClone(world);
  assert.throws(() => applyWorldLayout(world, { landmarks: { 'farm-goal': { x: 250, y: 160 } }, zones: { 'unknown': { x: 1, y: 1 } } }), /Unknown/);
  assert.deepEqual(world, before);
});

test('stadium landmark and hidden crowd zone translate once with its physical pad', () => {
  const authored = createWorld('ann-arbor', 1337);
  const layout = updatedLayout(authored, {}, { type: 'landmark', id: 'annarbor-stadium', x: 180, y: 120 });
  const world = createWorld('ann-arbor', 1337, layout);
  const landmark = world.landmarks.find((item) => item.id === 'annarbor-stadium');
  const object = world.objects.find((item) => item.id === 'michigan-stadium');
  const zone = world.zones.find((item) => item.id === 'stadium-crowd');
  const pad = world.terrainPads.find((item) => item.id === 'michigan-stadium-platform');
  for (const item of [landmark, object, zone, pad]) assert.deepEqual([item.x, item.y], [180, 120]);
  assert.equal(zone.known, false);
  assert.ok(Math.abs(terrainHeight(world, pad.x, pad.y) - pad.elevation) < 1e-5);
  assert.ok(getLayoutTargets(world).some((target) => target.id === 'mountain-0') === false);
  assert.doesNotThrow(() => validateWorldLayout(world, {}));
});

test('alternating stadium and crowd-zone drags canonicalize the linked edit', () => {
  const world = createWorld('ann-arbor', 1337);
  const first = updatedLayout(world, {}, { type: 'landmark', id: 'annarbor-stadium', x: 180, y: 120 });
  const second = updatedLayout(world, first, { type: 'zone', id: 'stadium-crowd', x: 190, y: 130 });
  assert.equal(second.landmarks['annarbor-stadium'], undefined);
  assert.deepEqual(second.zones['stadium-crowd'], { x: 190, y: 130 });
  const moved = createWorld('ann-arbor', 1337, second);
  assert.deepEqual([moved.landmarks.find((item) => item.id === 'annarbor-stadium').x, moved.landmarks.find((item) => item.id === 'annarbor-stadium').y], [190, 130]);
});

test('moving a mountain is baked before scenery generation and reaches simulation', () => {
  const authored = createWorld('tucson', 1337);
  const layout = updatedLayout(authored, {}, { type: 'mountain', id: 'mountain-0', x: 125, y: 90 });
  const world = createWorld('tucson', 1337, layout);
  assert.deepEqual([world.mountains[0].x, world.mountains[0].y], [125, 90]);
  assert.ok(terrainHeight(world, 125, 90) > world.altitude);
  assert.equal(worldCollision(world, 125, 90), true);
  assert.equal(lineOfSight(world, [100, 90, 35], [150, 90, 5]), false);
  assert.notDeepEqual(world.features, authored.features);
  const simulation = new Simulation('tucson', {}, 1337, { pixelFeatures: true, layout });
  assert.deepEqual([simulation.world.mountains[0].x, simulation.world.mountains[0].y], [125, 90]);
});

test('unsafe launch edits are rejected without granting knowledge of hidden restrictions', () => {
  const zoneLayout = { zones: { 'farm-aviary': { x: 45, y: 65 } } };
  assert.throws(() => validateWorldLayout(createWorld('farm', 1337, zoneLayout)), /restriction/);
  assert.throws(() => new Simulation('farm', {}, 1337, { pixelFeatures: true, layout: zoneLayout }), /restriction/);
  const mountainLayout = { mountains: { 'mountain-0': { x: 60, y: 65 } } };
  assert.throws(() => validateWorldLayout(createWorld('tucson', 1337, mountainLayout)), /Home orbit/);
  assert.throws(() => validateWorldLayout(createWorld('farm'), { horizontalFov: 60, sensingRange: 40, downwardPitch: 75 }), /Home orbit/);
  const simulation = new Simulation('ann-arbor', {}, 1337, {
    pixelFeatures: true, layout: { zones: { 'stadium-crowd': { x: 180, y: 120 } } },
  });
  assert.deepEqual([...simulation.knowledge.discovered], ['annarbor-ford']);
  assert.equal(simulation.knowledge.knownZones.has('stadium-crowd'), false);
  assert.equal(simulation.active.size, 0, 'validation must not activate undiscovered backup roots');
});

test('mountain edits relevel existing terrain foundations against the moved source', () => {
  const authored = createWorld('tucson', 1337);
  const padBefore = authored.terrainPads.find((pad) => pad.id === 'tucson-tower-foundation');
  const layout = updatedLayout(authored, {}, { type: 'mountain', id: 'mountain-1', x: 260, y: 70 });
  const world = createWorld('tucson', 1337, layout);
  const padAfter = world.terrainPads.find((pad) => pad.id === 'tucson-tower-foundation');
  assert.ok(Math.abs(padAfter.elevation - terrainHeight(world, padAfter.x, padAfter.y)) < 1e-5);
  assert.notEqual(padAfter.elevation, padBefore.elevation);
});

test('co-located authored plazas follow their Tucson landmark tower', () => {
  const authored = createWorld('tucson', 1337);
  const layout = updatedLayout(authored, {}, { type: 'landmark', id: 'tucson-overlook', x: 150, y: 35 });
  const world = createWorld('tucson', 1337, layout);
  const plaza = world.objects.find((object) => object.kind === 'plaza' && object.width === 7 && object.depth === 6);
  assert.deepEqual([plaza.x, plaza.y], [150, 35]);
  const gardenLayout = updatedLayout(authored, {}, { type: 'landmark', id: 'tucson-garden', x: 200, y: 140 });
  const gardenWorld = createWorld('tucson', 1337, gardenLayout);
  const gardenPlaza = gardenWorld.objects.find((object) => object.kind === 'plaza' && object.x === 200 && object.y === 140);
  assert.ok(gardenPlaza);
});

