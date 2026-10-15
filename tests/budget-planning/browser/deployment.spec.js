import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('packaged site and module worker load under a GitHub Pages project prefix', async ({ page }) => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
  const errors = [], failedAssets = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  page.on('response', response => {
    if (response.status() >= 400) failedAssets.push(response.url());
  });
  await page.goto('/_site/budget-planning.html');
  await expect(page).toHaveURL(/\/_site\/$/);
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);
  await expect(page.locator('#initialization-error')).toBeHidden();
  const state = await page.evaluate(() => window.__budgetDemo.getState());
  expect(state.fault).toBeNull();
  expect(state.sensor).toEqual({ horizontalFov: 90, sensingRange: 75, downwardPitch: 55 });
  expect(requests).toContain('/_site/assets/budget-planning/worker.js');
  expect(requests).toContain('/_site/assets/models/quaternius-nature.js');
  expect(requests.filter(path => path.startsWith('/assets/'))).toEqual([]);
  expect(failedAssets).toEqual([]);
  expect(errors).toEqual([]);
});
