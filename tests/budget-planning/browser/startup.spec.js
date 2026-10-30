import { test, expect } from '@playwright/test';

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
