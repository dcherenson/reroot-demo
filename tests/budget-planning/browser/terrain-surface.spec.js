import { test, expect } from '@playwright/test';

test('measured terrain, local materials and finite ground surfaces agree in all worlds', async ({ page }, testInfo) => {
  await page.route('**/assets/budget-planning/app.js', route => route.abort());
  await page.goto('/');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addStyleTag({ content: '.world-topbar,.left-rail,.right-rail,.sensor-inset,.telemetry-drawer,.loading-overlay,.scene-hint,.demo-footer{display:none!important}' });
  for (const worldId of ['farm', 'tucson', 'ann-arbor']) {
    const result = await page.evaluate(async id => {
      const [{ DemoRenderer }, { createWorld, terrainHeight }, THREE] = await Promise.all([
        import('/assets/budget-planning/renderer.js'), import('/assets/budget-planning/worlds.js'),
        import('/assets/budget-planning/vendor/three.module.js'),
      ]);
      window.__terrainPreview?.dispose();
      const renderer = window.__terrainPreview = new DemoRenderer(document.querySelector('#scene-canvas'));
      const world = createWorld(id);
      renderer.setWorld(world);
      renderer.render();
      const position = renderer.terrain.geometry.attributes.position;
      let maximumVertexError = 0, maximumTriangleError = 0, maximumSurfaceError = 0, escapedGroundVertices = 0;
      for (let i = 0; i < position.count; i++) {
        maximumVertexError = Math.max(maximumVertexError, Math.abs(position.getY(i) - terrainHeight(world, position.getX(i) + world.width / 2, world.height / 2 - position.getZ(i))));
      }
      const indices = renderer.terrain.geometry.index;
      for (let i = 0; i < indices.count; i += 39) {
        const a = new THREE.Vector3().fromBufferAttribute(position, indices.getX(i));
        const b = new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + 1));
        const c = new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + 2));
        const p = a.multiplyScalar(.2).addScaledVector(b, .3).addScaledVector(c, .5);
        maximumTriangleError = Math.max(maximumTriangleError, Math.abs(p.y - terrainHeight(world, p.x + world.width / 2, world.height / 2 - p.z)));
      }
      renderer.sceneryGroup.traverse(mesh => {
        if (!['road-surface', 'field-surface'].includes(mesh.name)) return;
        const a = mesh.geometry.attributes.position;
        const lift = mesh.name === 'road-surface' ? .12 : .06;
        for (let i = 0; i < a.count; i += 3) {
          const x = (a.getX(i) + a.getX(i + 1) + a.getX(i + 2)) / 3 + world.width / 2;
          const y = world.height / 2 - (a.getZ(i) + a.getZ(i + 1) + a.getZ(i + 2)) / 3;
          const z = (a.getY(i) + a.getY(i + 1) + a.getY(i + 2)) / 3;
          maximumSurfaceError = Math.max(maximumSurfaceError, Math.abs(z - terrainHeight(world, x, y) - lift));
        }
        for (let i = 0; i < a.count; i++) if (Math.abs(a.getX(i)) > world.width / 2 + 1e-5 || Math.abs(a.getZ(i)) > world.height / 2 + 1e-5) escapedGroundVertices++;
      });
      const frame = renderer.captureSensor([45, 65, 0], 0);
      renderer.render();
      return {
        maximumVertexError, maximumTriangleError, maximumSurfaceError, escapedGroundVertices,
        textureLoaded: renderer.terrainMaterial.map?.image?.width > 0,
        textureSource: renderer.terrainMaterial.userData.terrainAssets?.source,
        planes: renderer.renderer.clippingPlanes.length,
        gridRemoved: !renderer.planningGrid,
        vertexCount: position.count,
        opaqueSensor: frame.rgba.every((byte, i) => i % 4 !== 3 || byte === 255),
      };
    }, worldId);
    expect(result.maximumVertexError).toBeLessThan(1e-5);
    expect(result.maximumTriangleError).toBeLessThan(1e-5);
    expect(result.escapedGroundVertices).toBe(0);
    expect(result.maximumSurfaceError).toBeLessThan(1e-4);
    expect(result.textureLoaded).toBe(true);
    expect(result.textureSource).toContain('polyhaven.com');
    expect(result.planes).toBe(4);
    expect(result.gridRemoved).toBe(true);
    expect(result.opaqueSensor).toBe(true);
    expect(result.vertexCount).toBeLessThanOrEqual(321 * 231);
    await page.screenshot({ path: testInfo.outputPath(`${worldId}-terrain.png`) });
  }
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__terrainPreview.dispose());
});
