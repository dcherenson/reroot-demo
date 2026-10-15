import test from 'node:test';
import assert from 'node:assert/strict';

import {
  disposeThickLine,
  makeThickLine,
  resizeThickLine,
  updateThickLine,
} from '../../assets/budget-planning/thick-lines.js';

const attributeNames = [
  'instanceStart',
  'instanceEnd',
  'instanceColorStart',
  'instanceColorEnd',
  'instanceDistanceStart',
  'instanceDistanceEnd',
];

test('segmented lines reserve capacity in vertex pairs and update buffers in place', () => {
  const line = makeThickLine({
    capacity: 4,
    color: 0x336699,
    width: 5,
    opacity: 0.7,
    dashed: true,
    segments: true,
  });
  const attributes = Object.fromEntries(
    attributeNames.map((name) => [name, line.geometry.attributes[name]]),
  );

  assert.equal(line.capacity, 4);
  assert.equal(line.maxSegments, 2);
  assert.equal(line.geometry.instanceCount, 0);
  assert.equal(line.object.visible, false);
  assert.equal(line.material.uniforms.linewidth.value, 5);
  assert.equal(line.material.uniforms.opacity.value, 0.7);

  // The fifth source vertex is truncated to the fixed capacity.  Four source
  // vertices produce two independent segments.
  const positions = new Float32Array([
    0, 0, 1,
    1, 0, 1,
    2, 0, 1,
    2, 2, 1,
    9, 9, 9,
  ]);
  const colors = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
    1, 1, 0,
    1, 1, 1,
  ]);
  updateThickLine(line, positions, 5, colors);

  assert.equal(line.segmentCount, 2);
  assert.equal(line.vertexCount, 4);
  assert.equal(line.geometry.instanceCount, 2);
  assert.equal(line.geometry.drawRange.count, 18);
  assert.equal(line.object.visible, true);
  assert.equal(line.material.uniforms.useVertexColors.value, true);
  assert.deepEqual(line.geometry.attributes.instanceStart.updateRanges, [{ start: 0, count: 6 }]);
  assert.deepEqual(line.geometry.attributes.instanceColorStart.updateRanges, [{ start: 0, count: 6 }]);
  assert.deepEqual(line.geometry.attributes.instanceDistanceStart.updateRanges, [{ start: 0, count: 2 }]);
  assert.deepEqual(Array.from(line.geometry.attributes.instanceStart.array.slice(0, 6)), [0, 0, 1, 2, 0, 1]);
  assert.deepEqual(Array.from(line.geometry.attributes.instanceEnd.array.slice(0, 6)), [1, 0, 1, 2, 2, 1]);
  assert.deepEqual(Array.from(line.geometry.attributes.instanceColorEnd.array.slice(0, 6)), [0, 1, 0, 1, 1, 0]);
  assert.deepEqual(Array.from(line.geometry.attributes.instanceDistanceEnd.array.slice(0, 2)), [1, 2]);

  for (const name of attributeNames) assert.equal(line.geometry.attributes[name], attributes[name], `${name} was replaced`);

  // A later shorter update hides the mesh without changing the allocated
  // attributes or growing them to match the source.
  updateThickLine(line, new Float32Array([4, 5, 6]), 1);
  assert.equal(line.segmentCount, 0);
  assert.equal(line.geometry.instanceCount, 0);
  assert.equal(line.geometry.drawRange.count, 0);
  assert.equal(line.object.visible, false);
  assert.equal(line.material.uniforms.useVertexColors.value, false);
  for (const name of attributeNames) assert.equal(line.geometry.attributes[name], attributes[name], `${name} changed after reuse`);

  disposeThickLine(line);
  assert.equal(line.object, null);
  assert.doesNotThrow(() => updateThickLine(line, positions, 4, colors));
});

test('connected polylines clamp to capacity, accumulate dash distance, and resize safely', () => {
  const line = makeThickLine({ capacity: 4, segments: false, dashed: true });
  const positions = new Float32Array([
    0, 0, 0,
    3, 0, 0,
    3, 4, 0,
    3, 4, 12,
    100, 100, 100,
  ]);
  const attributes = Object.fromEntries(
    attributeNames.map((name) => [name, line.geometry.attributes[name]]),
  );

  updateThickLine(line, positions, 5);

  assert.equal(line.maxSegments, 3);
  assert.equal(line.segmentCount, 3);
  assert.equal(line.vertexCount, 4);
  assert.deepEqual(Array.from(line.geometry.attributes.instanceDistanceStart.array.slice(0, 3)), [0, 3, 7]);
  assert.deepEqual(Array.from(line.geometry.attributes.instanceDistanceEnd.array.slice(0, 3)), [3, 7, 19]);
  assert.deepEqual(Array.from(line.geometry.attributes.instanceStart.array.slice(0, 9)), [0, 0, 0, 3, 0, 0, 3, 4, 0]);
  assert.deepEqual(Array.from(line.geometry.attributes.instanceEnd.array.slice(0, 9)), [3, 0, 0, 3, 4, 0, 3, 4, 12]);

  resizeThickLine(line, 0, -4);
  assert.deepEqual(line.material.uniforms.resolution.value.toArray(), [1, 1]);
  resizeThickLine(line, 1280, 720);
  assert.deepEqual(line.material.uniforms.resolution.value.toArray(), [1280, 720]);
  for (const name of attributeNames) assert.equal(line.geometry.attributes[name], attributes[name], `${name} changed during resize`);
});
