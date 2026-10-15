import { test, expect } from '@playwright/test';

async function enterEditor(page) {
  // Use the visible label: the accessible checkbox itself is intentionally
  // one pixel wide, and Firefox positions it beneath the label text.
  await page.locator('label[for="world-edit-toggle"]').click();
  await expect(page.locator('#world-edit-toggle')).toBeChecked();
}

test('world editor exposes editable targets and preserves a paused intent', async ({ page }) => {
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);
  await page.locator('#play-button').click();
  await expect(page.locator('#play-button')).toHaveText(/Run mission|Play/);
  await enterEditor(page);
  await expect(page.locator('#world-editor')).toBeVisible();
  await expect(page.locator('#top-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#truth-view-button')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__budgetDemo.getLifecycle().playing)).toBe(false);
  await page.locator('#fpv-button').click();
  await page.locator('#orbit-button').click();
  await page.locator('#view-button').click();
  await page.keyboard.press('f');
  await page.keyboard.press('v');
  await expect(page.locator('#top-button')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#play-button').click();
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__budgetDemo.getLifecycle().playing)).toBe(false);
  expect(await page.locator('#world-editor-object option').count()).toBeGreaterThan(0);
  await page.locator('#world-edit-cancel').click();
  await expect(page.locator('#world-editor')).toBeHidden();
  expect(await page.evaluate(() => window.__budgetDemo.getLifecycle().playing)).toBe(false);
});

test('world editor rejects an outside coordinate without restarting the worker', async ({ page }) => {
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);
  await enterEditor(page);
  const before = await page.evaluate(() => ({ runId: window.__budgetDemo.getLifecycle().runId, layout: window.__budgetDemo.getWorldLayout() }));
  await page.locator('#world-edit-x').fill('-10');
  await page.locator('#world-edit-y').fill('10');
  await page.locator('#world-edit-apply').click();
  await expect(page.locator('#world-edit-error')).toBeVisible();
  const after = await page.evaluate(() => ({ runId: window.__budgetDemo.getLifecycle().runId, layout: window.__budgetDemo.getWorldLayout() }));
  expect(after.runId).toBe(before.runId);
  expect(after.layout).toEqual(before.layout);
});

test('world editor rejects an unsafe home placement without changing the layout', async ({ page }) => {
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);
  await enterEditor(page);
  await page.locator('#world-editor-object').selectOption('landmark:farm-home');
  const before = await page.evaluate(() => ({ runId: window.__budgetDemo.getLifecycle().runId, layout: window.__budgetDemo.getWorldLayout() }));
  await page.locator('#world-edit-x').fill('151');
  await page.locator('#world-edit-y').fill('120');
  await page.locator('#world-edit-apply').click();
  await expect(page.locator('#world-edit-error')).toBeVisible();
  const after = await page.evaluate(() => ({ runId: window.__budgetDemo.getLifecycle().runId, layout: window.__budgetDemo.getWorldLayout() }));
  expect(after.runId).toBe(before.runId);
  expect(after.layout).toEqual(before.layout);
});

test('world editor commits an in-bounds coordinate and keeps worker geometry in sync', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__workerInitLayouts = [];
    window.Worker = function (...args) {
      const worker = new NativeWorker(...args);
      const postMessage = worker.postMessage.bind(worker);
      worker.postMessage = (message, ...rest) => {
        if (message?.type === 'init') window.__workerInitLayouts.push(message.layout);
        return postMessage(message, ...rest);
      };
      return worker;
    };
    window.Worker.prototype = NativeWorker.prototype;
  });
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);
  await enterEditor(page);
  const options = await page.locator('#world-editor-object option').evaluateAll(items => items.map(item => ({ value: item.value, text: item.textContent })));
  const goal = options.find(item => item.value === 'landmark:farm-goal');
  expect(goal).toBeTruthy();
  await page.locator('#world-editor-object').selectOption(goal.value);
  await page.locator('#world-edit-x').fill('255');
  await page.locator('#world-edit-y').fill('160');
  const before = await page.evaluate(() => window.__budgetDemo.getLifecycle().runId);
  await page.locator('#world-edit-apply').click();
  await page.waitForFunction(runId => window.__budgetDemo.getLifecycle().runId > runId, before);
  await page.waitForFunction(() => window.__budgetDemo.getState()?.worldId === 'farm');
  await expect(page.locator('#world-editor')).toBeHidden();
  const state = await page.evaluate(() => ({ layout: window.__budgetDemo.getWorldLayout(), state: window.__budgetDemo.getState() }));
  expect(state.layout.landmarks['farm-goal']).toMatchObject({ x: 255, y: 160 });
  expect(state.state.worldLayout.landmarks['farm-goal']).toMatchObject({ x: 255, y: 160 });
  const workerLayouts = await page.evaluate(() => window.__workerInitLayouts);
  expect(workerLayouts.at(-1).landmarks['farm-goal']).toMatchObject({ x: 255, y: 160 });
});

test('world editor accepts a pointer drag on a highlighted handle', async ({ page }) => {
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);
  await enterEditor(page);
  const targets = await page.evaluate(() => window.__budgetDemo.getLayoutTargets());
  const target = targets.find(item => item.type === 'landmark' && item.id === 'farm-goal');
  expect(target).toBeTruthy();
  const from = await page.evaluate(() => window.__budgetDemo.getEditTargetScreenPosition('landmark:farm-goal'));
  expect(from).toBeTruthy();
  const to = { x: from.x - 16, y: from.y - 12 };
  const beforeRun = await page.evaluate(() => window.__budgetDemo.getLifecycle().runId);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(runId => window.__budgetDemo.getLifecycle().runId > runId, beforeRun);
});

test('clicking an edit handle without moving it does not restart the mission', async ({ page }) => {
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);
  await enterEditor(page);
  const point = await page.evaluate(() => window.__budgetDemo.getEditTargetScreenPosition('landmark:farm-goal'));
  const before = await page.evaluate(() => ({ runId: window.__budgetDemo.getLifecycle().runId, layout: window.__budgetDemo.getWorldLayout() }));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({ runId: window.__budgetDemo.getLifecycle().runId, layout: window.__budgetDemo.getWorldLayout() }));
  expect(after.runId).toBe(before.runId);
  expect(after.layout).toEqual(before.layout);
});

test('world editor accepts pointer drags for an NFZ and a mountain', async ({ page }) => {
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);

  const dragTarget = async (targetKey) => {
    const point = await page.evaluate(target => window.__budgetDemo.getEditTargetScreenPosition(target), targetKey);
    expect(point).toBeTruthy();
    const beforeRun = await page.evaluate(() => window.__budgetDemo.getLifecycle().runId);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 12, point.y - 9, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(runId => window.__budgetDemo.getLifecycle().runId > runId, beforeRun);
  };

  await enterEditor(page);
  await dragTarget('zone:farm-aviary');

  await page.locator('#world-select').selectOption('tucson');
  await page.waitForFunction(() => window.__budgetDemo.getState()?.worldId === 'tucson');
  await enterEditor(page);
  const mountain = await page.evaluate(() => window.__budgetDemo.getLayoutTargets().find(item => item.type === 'mountain'));
  expect(mountain).toBeTruthy();
  await dragTarget(`mountain:${mountain.id}`);
});

test('world layout persists across reset and restores authored defaults', async ({ page }) => {
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);
  await enterEditor(page);
  await page.locator('#world-editor-object').selectOption('landmark:farm-goal');
  await page.locator('#world-edit-x').fill('255');
  await page.locator('#world-edit-y').fill('160');
  const beforeCommit = await page.evaluate(() => window.__budgetDemo.getLifecycle().runId);
  await page.locator('#world-edit-apply').click();
  await page.waitForFunction(runId => window.__budgetDemo.getLifecycle().runId > runId, beforeCommit);
  expect(await page.evaluate(() => window.__budgetDemo.getWorldLayout().landmarks['farm-goal'])).toMatchObject({ x: 255, y: 160 });

  const beforeReset = await page.evaluate(() => window.__budgetDemo.getLifecycle().runId);
  await page.locator('#reset-button').click();
  await page.waitForFunction(runId => window.__budgetDemo.getLifecycle().runId > runId, beforeReset);
  expect(await page.evaluate(() => window.__budgetDemo.getWorldLayout().landmarks['farm-goal'])).toMatchObject({ x: 255, y: 160 });

  await enterEditor(page);
  const beforeRestore = await page.evaluate(() => window.__budgetDemo.getLifecycle().runId);
  await page.locator('#world-edit-restore').click();
  await page.waitForFunction(runId => window.__budgetDemo.getLifecycle().runId > runId, beforeRestore);
  expect(await page.evaluate(() => window.__budgetDemo.getWorldLayout())).toEqual({});
});

test('cancelled previews reuse renderer resources', async ({ page }) => {
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);
  await enterEditor(page);
  const target = 'landmark:farm-goal';
  const dragAndCancel = async () => {
    const point = await page.evaluate(target => window.__budgetDemo.getEditTargetScreenPosition(target), target);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 10, point.y - 8, { steps: 3 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(60);
  };
  const before = await page.evaluate(() => window.__budgetDemo.getDiagnostics());
  await dragAndCancel();
  const afterFirst = await page.evaluate(() => window.__budgetDemo.getDiagnostics());
  await enterEditor(page);
  await dragAndCancel();
  const afterSecond = await page.evaluate(() => window.__budgetDemo.getDiagnostics());
  expect(afterSecond.geometries).toBe(afterFirst.geometries);
  expect(afterSecond.textures).toBe(afterFirst.textures);
  expect(afterSecond.editMode).toBe(false);
  expect(afterFirst.geometries).toBeGreaterThanOrEqual(before.geometries);
});

test('editor temporarily uses truth top-down and restores FPV/map choices', async ({ page }) => {
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.vision?.frameCount > 1);
  await page.locator('#fpv-button').click();
  await page.locator('#mapped-view-button').click();
  await enterEditor(page);
  await expect(page.locator('#top-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#truth-view-button')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#world-edit-cancel').click();
  await expect(page.locator('#fpv-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mapped-view-button')).toHaveAttribute('aria-pressed', 'true');
});
