import { test, expect } from '@playwright/test';

test('natural feature batches use populated local CC0 source meshes', async ({ page }) => {
  await page.route('**/assets/budget-planning/app.js', route => route.abort());
  await page.goto('/budget-planning.html');
  const result = await page.evaluate(async () => {
    const [{ DemoRenderer }, { createWorld }] = await Promise.all([
      import('/assets/budget-planning/renderer.js'),
      import('/assets/budget-planning/worlds.js'),
    ]);
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    const worlds = {};
    try {
      for (const worldId of ['farm', 'tucson', 'ann-arbor']) {
        renderer.setWorld(createWorld(worldId));
        worlds[worldId] = renderer.sceneryGroup.children
          .filter(mesh => mesh.geometry?.userData?.sourceKey)
          .map(mesh => ({
            name: mesh.name,
            sourceKey: mesh.geometry.userData.sourceKey,
            sourcePart: mesh.geometry.userData.sourcePart,
            positions: mesh.geometry.attributes.position.count,
            indices: mesh.geometry.index?.count || 0,
            instances: mesh.count,
          }));
      }
      return worlds;
    } finally {
      renderer.dispose();
    }
  });
  const imported = Object.values(result).flat();
  expect(imported.length).toBeGreaterThan(0);
  expect(imported.every(mesh => mesh.positions > 0 && mesh.indices > 0 && mesh.instances > 0)).toBe(true);
  expect(imported.every(mesh => ['tree', 'bush', 'grass', 'rock'].includes(mesh.sourceKey))).toBe(true);
  expect(imported.some(mesh => mesh.sourceKey === 'tree' && mesh.sourcePart === 'bark')).toBe(true);
  expect(imported.some(mesh => mesh.sourceKey === 'tree' && mesh.sourcePart === 'foliage')).toBe(true);
  expect(imported.some(mesh => mesh.sourceKey === 'rock' && mesh.name === 'feature-rocks')).toBe(true);
  expect(imported.some(mesh => mesh.sourceKey === 'bush' && mesh.name === 'feature-scrub')).toBe(true);
  expect(imported.some(mesh => mesh.sourceKey === 'grass' && mesh.name === 'feature-grass')).toBe(true);
});
