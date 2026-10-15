import { test, expect } from '@playwright/test';

test('terrain detail attribute reduces diffuse contrast while RGB colors stay opaque', async ({ page }) => {
  await page.route('**/assets/budget-planning/app.js', (route) => route.abort());
  await page.goto('/budget-planning.html');
  const shaderErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') shaderErrors.push(message.text());
  });

  const result = await page.evaluate(async () => {
    const THREE = await import('/assets/budget-planning/vendor/three.module.js');
    const { createTerrainMaterial } = await import('/assets/budget-planning/terrain-materials.js');
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });

    function renderDetail(detail) {
      const { material, texture } = createTerrainMaterial(
        { id: 'farm', width: 32, height: 32 },
        { maxAnisotropy: 1, detailStrength: 1 },
      );
      const geometry = new THREE.PlaneGeometry(4, 4, 1, 1);
      // Keep the legacy three-component color attribute. The detail signal is
      // independent and must not travel through color alpha.
      geometry.setAttribute('color', new THREE.Float32BufferAttribute([
        .8, .7, .4,
        .8, .7, .4,
        .8, .7, .4,
        .8, .7, .4,
      ], 3));
      geometry.setAttribute('terrainDetail', new THREE.Float32BufferAttribute([
        detail, detail, detail, detail,
      ], 1));
      const mesh = new THREE.Mesh(geometry, material);
      const scene = new THREE.Scene();
      scene.add(mesh, new THREE.HemisphereLight(0xffffff, 0x444444, 2));
      const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 10);
      camera.position.z = 5;
      camera.lookAt(0, 0, 0);
      const target = new THREE.WebGLRenderTarget(128, 128);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(128 * 128 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
      renderer.setRenderTarget(null);

      const alpha = new Set();
      const luminance = [];
      for (let index = 0; index < pixels.length; index += 4) {
        alpha.add(pixels[index + 3]);
        luminance.push(
          pixels[index] * .2126 + pixels[index + 1] * .7152 + pixels[index + 2] * .0722,
        );
      }
      const minimum = Math.min(...luminance);
      const maximum = Math.max(...luminance);
      const gl = renderer.getContext();
      const errors = [];
      for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError()) errors.push(error);
      geometry.dispose();
      material.dispose();
      texture?.dispose();
      target.dispose();
      return { contrast: maximum - minimum, alpha: [...alpha], errors };
    }

    const poor = renderDetail(0);
    const rich = renderDetail(1);
    renderer.dispose();
    return { poor, rich };
  });

  expect(shaderErrors.filter((message) => message.includes('WebGLProgram: Shader Error'))).toEqual([]);
  expect(result.poor.errors).toEqual([]);
  expect(result.rich.errors).toEqual([]);
  expect(result.poor.alpha).toEqual([255]);
  expect(result.rich.alpha).toEqual([255]);
  expect(result.poor.contrast).toBeLessThan(result.rich.contrast);
});
