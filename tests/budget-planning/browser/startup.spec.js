import { test, expect } from '@playwright/test';

test('Tucson starts without requesting the new Farm and Ann Arbor scenery', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    if (/scanned-rocks\/|polyhaven-(farm-soil|gravel-road|road-damaged-clean)|512-(normal-gl|roughness)/.test(request.url())) requests.push(request.url());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.worldId === 'tucson');
  expect(requests).toEqual([]);
});

test('a late Farm load cannot replace a more recently selected Ann Arbor world', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/polyhaven-farm-soil-512-diffuse.jpg', async route => {
    requested = true;
    await held;
    await route.continue();
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.worldId === 'tucson');
  await page.locator('#play-button').click();
  await page.selectOption('#world-select', 'farm');
  await expect.poll(() => requested).toBe(true);
  await page.evaluate(() => window.__budgetDemo.enterWorldEditor());
  expect(await page.evaluate(() => window.__budgetDemo.getLifecycle().editing)).toBe(false);
  await page.selectOption('#world-select', 'ann-arbor');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.worldId === 'ann-arbor');
  release();
  await page.evaluate(async () => {
    const { prepareTerrainAssets } = await import('/assets/budget-planning/terrain-materials.js');
    await prepareTerrainAssets('farm');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.evaluate(() => window.__budgetDemo.getState().worldId)).toBe('ann-arbor');
  expect(await page.evaluate(() => window.__budgetDemo.getDiagnostics().world)).toBe('ann-arbor');
  await expect(page.locator('#loading-overlay')).toBeHidden();
});

test('stalled new ground and rock assets fall back instead of blocking a world switch', async ({ page }) => {
  await page.route('**/polyhaven-farm-soil-512-diffuse.jpg', () => {});
  await page.route('**/rock-moss-set-01-geometry.bin', () => {});
  await page.goto('/');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.worldId === 'tucson');
  await page.locator('#play-button').click();
  await page.selectOption('#world-select', 'farm');
  await expect.poll(() => page.evaluate(() => window.__budgetDemo?.getState()?.worldId), { timeout: 15_000 }).toBe('farm');
  await expect(page.locator('#loading-overlay')).toBeHidden();
  await expect(page.locator('#initialization-error')).toBeHidden();
});

test('a stalled scenery image does not prevent Tucson from starting', async ({ page }) => {
  // This Farm image is loaded by the shared material module even in Tucson.
  await page.route('**/polyhaven-leafy-grass-1k.jpg', () => {});
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.__budgetDemo?.getState()?.worldId), {
    timeout: 15_000,
  }).toBe('tucson');
  await expect(page.locator('#loading-overlay')).toBeHidden();
  await expect(page.locator('#initialization-error')).toBeHidden();
});

test('a failed module download offers a working reload button', async ({ page }) => {
  await page.route('**/assets/budget-planning/renderer.js', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#loading-overlay')).toContainText('could not start');
  await expect(page.getByRole('button', { name: 'Reload demo' })).toBeVisible();
  await page.unroute('**/assets/budget-planning/renderer.js');
  await page.getByRole('button', { name: 'Reload demo' }).click();
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.worldId === 'tucson');
  await expect(page.locator('#loading-overlay')).toBeHidden();
});

test('a worker constructor failure clears the loading screen', async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class { constructor() { throw new Error('Worker unavailable'); } };
  });
  await page.goto('/');
  await expect(page.locator('#initialization-error')).toBeVisible();
  await expect(page.locator('#initialization-error-message')).toContainText('Worker unavailable');
  await expect(page.locator('#loading-overlay')).toBeHidden();
  await expect(page.locator('#play-button')).toBeDisabled();
});

test('a snapshot rendering failure stops the worker and clears the loading screen', async ({ page }) => {
  await page.route('**/assets/budget-planning/renderer.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nDemoRenderer.prototype.update = () => { throw new Error('Scene update unavailable'); };` });
  });
  await page.goto('/');
  await expect(page.locator('#initialization-error-message')).toContainText('Scene update unavailable');
  await expect(page.locator('#initialization-error')).toBeVisible();
  await expect(page.locator('#loading-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.__budgetDemo.getLifecycle().workerActive)).toBe(false);
});

test('a worker that never responds offers a reload instead of an endless spinner', async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class { postMessage() {} terminate() {} };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reload demo' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#loading-overlay')).toContainText('taking longer than expected');
});
