import test from 'node:test';
import assert from 'node:assert/strict';
import { clipPolygonToMap, drapedRectangleGeometry } from '../../assets/budget-planning/terrain-geometry.js';

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
