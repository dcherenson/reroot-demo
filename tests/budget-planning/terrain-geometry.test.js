import test from 'node:test';
import assert from 'node:assert/strict';
import { clipPolygonToMap, drapedPathGeometry, drapedRectangleGeometry } from '../../assets/budget-planning/terrain-geometry.js';
import { createWorld } from '../../assets/budget-planning/worlds.js';

test('long rotated ground polygons clip at every map edge without moving the inside portion', () => {
  const polygon = clipPolygonToMap([[-10, 4], [5, -10], [24, 6], [4, 22]], 12, 9);
  assert.ok(polygon.length >= 4);
  for (const [x, y] of polygon) assert.ok(x >= 0 && x <= 12 && y >= 0 && y <= 9);
  assert.deepEqual(clipPolygonToMap([[-10, -10], [-2, -10], [-2, -2]], 12, 9), []);
  const inside = [[1, 1], [3, 1], [3, 3]];
  assert.deepEqual(clipPolygonToMap(inside, 12, 9), inside);
});

test('draped roads terminate at map bounds and follow terrain after rotation', () => {
  const world = { width: 320, height: 230 };
  const heightAt = (x, y) => x * .012 + y * .025;
  const geometry = drapedRectangleGeometry(world, { x: 154, y: 112, width: 7, depth: 295, rotation: .46 }, heightAt, { lift: .12 });
  const positions = geometry.attributes.position;
  let touchedEdge = false;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + world.width / 2;
    const y = world.height / 2 - positions.getZ(i);
    assert.ok(x >= 0 && x <= world.width && y >= 0 && y <= world.height);
    assert.ok(Math.abs(positions.getY(i) - heightAt(x, y) - .12) < 1e-5);
    if (y === 0 || y === world.height) touchedEdge = true;
  }
  assert.ok(touchedEdge);
  geometry.dispose();
});

test('curved path roads clip to terrain triangles and expose physical texture and edge coordinates', () => {
  const world = {
    width: 20,
    height: 12,
    terrainMesh: { spacing: 2, columns: 11, rows: 7 },
  };
  const heightAt = (x, y) => x * .012 + y * .025;
  const geometry = drapedPathGeometry(world, {
    path: [[-3, 5], [5, 5], [11, 9], [23, 9]],
    width: 4,
  }, heightAt, { lift: .12, offset: .5, spacing: 2 });
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const lateral = geometry.attributes.roadLateral;
  const edge = geometry.attributes.roadEdge;
  assert.ok(positions.count > 100, 'curved path should produce a finely sampled ribbon');
  assert.equal(uv.count, positions.count);
  assert.equal(lateral.count, positions.count);
  assert.equal(edge.count, positions.count);
  let minU = Infinity, maxU = -Infinity, maxV = -Infinity;
  let sawCenter = false, sawEdge = false;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index) + world.width / 2;
    const y = world.height / 2 - positions.getZ(index);
    assert.ok(x >= -1e-5 && x <= world.width + 1e-5);
    assert.ok(y >= -1e-5 && y <= world.height + 1e-5);
    assert.ok(Math.abs(positions.getY(index) - heightAt(x, y) - .12) < 1e-5);
    assert.ok(lateral.getX(index) >= -1 - 1e-5 && lateral.getX(index) <= 1 + 1e-5);
    assert.ok(Math.abs(edge.getX(index) - (1 - Math.abs(lateral.getX(index)))) < 1e-5);
    minU = Math.min(minU, uv.getX(index));
    maxU = Math.max(maxU, uv.getX(index));
    maxV = Math.max(maxV, uv.getY(index));
    sawCenter ||= Math.abs(lateral.getX(index)) < .2;
    sawEdge ||= Math.abs(lateral.getX(index)) > .95;
    assert.ok(geometry.attributes.normal.getY(index) > 0, 'terrain-conforming road faces upward');
  }
  assert.ok(Math.abs(minU) < 1e-5 && Math.abs(maxU - 4) < 1e-5, 'u spans the physical ribbon width in metres');
  assert.ok(maxV > 20, 'v accumulates physical centreline distance in metres');
  assert.ok(sawCenter && sawEdge);
  geometry.dispose();
});

test('Farm and Ann Arbor use bounded path roads while Tucson keeps its authored rectangles', () => {
  const farm = createWorld('farm', 1337);
  const city = createWorld('ann-arbor', 1337);
  const tucson = createWorld('tucson', 1337);
  for (const world of [farm, city]) {
    const roads = world.objects.filter(object => object.kind === 'road');
    assert.ok(roads.length > 0);
    assert.ok(roads.every(road => Array.isArray(road.path) && road.path.length >= 2));
    for (const road of roads) for (const [x, y] of road.path) {
      assert.ok(x >= 0 && x <= world.width && y >= 0 && y <= world.height);
    }
  }
  assert.ok(farm.objects.filter(object => object.kind === 'road').every(road => road.surface === 'gravel'));
  assert.ok(city.objects.filter(object => object.kind === 'road').every(road => road.surface === 'asphalt'));
  assert.ok(tucson.objects.filter(object => object.kind === 'road').every(road => !road.path));
});
