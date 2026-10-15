import test from 'node:test';
import assert from 'node:assert/strict';
import { createVegetationModels } from '../../assets/budget-planning/vegetation-models.js';
import { CC0_BATCH_PARTS } from '../../assets/budget-planning/renderer.js';

const cc0Batches = [
  ['cc0Tree', CC0_BATCH_PARTS.treeBark],
  ['cc0Tree', CC0_BATCH_PARTS.treeFoliage],
  ['cc0Rock', CC0_BATCH_PARTS.whole],
  ['cc0Bush', CC0_BATCH_PARTS.whole],
  ['cc0Grass', CC0_BATCH_PARTS.whole],
];

test('every imported vegetation batch resolves to populated CC0 geometry', () => {
  const models = createVegetationModels();
  for (const [modelKey, partKey] of cc0Batches) {
    const geometry = models[modelKey][partKey];
    assert.ok(geometry, `${modelKey}/${partKey} must resolve a geometry`);
    assert.equal(geometry.userData.sourceKey, modelKey.replace('cc0', '').toLowerCase() === 'tree' ? 'tree' : modelKey.replace('cc0', '').toLowerCase());
    assert.equal(geometry.userData.sourcePart, partKey);
    assert.ok(geometry.attributes.position.count > 0, `${modelKey}/${partKey} needs vertices`);
    assert.ok(geometry.index.count > 0, `${modelKey}/${partKey} needs triangles`);
    assert.ok(geometry.boundingSphere.radius > 0, `${modelKey}/${partKey} needs nonzero bounds`);
  }
});

test('tree material groups cover the complete imported tree without a green trunk', () => {
  const models = createVegetationModels();
  const whole = models.cc0Tree.whole.index.array;
  const bark = models.cc0Tree.bark.index.array;
  const foliage = models.cc0Tree.foliage.index.array;
  assert.equal(bark.length + foliage.length, whole.length);
  assert.deepEqual(Array.from(foliage).concat(Array.from(bark)), Array.from(whole));
  assert.notEqual(models.cc0Tree.bark.userData.sourcePart, models.cc0Tree.foliage.userData.sourcePart);
});
