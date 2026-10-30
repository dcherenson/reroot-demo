import { test, expect } from '@playwright/test';

function fakeWorkerSource(shouldFail = false, failureKind = 'features', failWhenNominal = false) {
  return `
    const failure = { kind: '${failureKind}', actual: ${failureKind === 'budget' ? 5.4 : 3}, limit: ${failureKind === 'budget' ? 5 : 6}, time: 1 };
    const makeSnapshot = (runId, sequence, gatekeeper, failure = null) => ({
      runId,
      sequence,
      worldId: 'farm',
      pose: [110, 50, 0],
      estimate: [110, 50, 0],
      cameraYaw: 0,
      time: failure ? 1 : 0,
      budget: failure?.kind === 'budget' ? failure.actual : 0,
      featuresTracked: failure?.kind === 'features' ? failure.actual : 8,
      landmarkVisible: false,
      mappedFeatureIds: new Uint16Array(),
      visibleFeatureIds: new Uint16Array(),
      featurePositions: new Float32Array(),
      sensorKeypoints: new Float32Array(),
      discoveredLandmarkIds: [],
      activeLandmarkIds: [],
      knownZoneIds: [],
      phase: failure ? 'fault' : 'orbit',
      status: failure ? (failure.kind === 'budget' ? 'Observed localization error exceeded the configured budget.' : 'Observed feature overlap fell below the configured minimum.') : 'Home orbit · building a safe route',
      fault: failure ? (failure.kind === 'budget' ? 'Observed localization error exceeded the configured budget.' : 'Observed feature overlap fell below the configured minimum.') : null,
      failure,
      gatekeeper,
      treeEdges: new Float32Array(),
      treeColors: new Float32Array(),
      nominal: new Float32Array(),
      committedNominal: new Float32Array(),
      backup: new Float32Array(),
      trail: new Float32Array(),
      history: new Float32Array([0, 0, 8, 0]),
      orbit: { id: 'home', x: 110, y: 50, radius: 10 },
      switchpoint: null,
      knowledge: null,
      metrics: { nodes: 0, mapped: 0, commits: 0, planningMs: 0, renewals: 0 },
      events: [],
    });

    self.onmessage = ({ data }) => {
      if (data.type !== 'init') return;
      const gatekeeper = data.config.gatekeeper !== false;
      self.postMessage({ type: 'snapshot', snapshot: makeSnapshot(data.runId, 1, gatekeeper) });
      if (${shouldFail} && (${failWhenNominal ? '!gatekeeper' : 'true'})) {
        setTimeout(() => self.postMessage({
          type: 'snapshot',
          snapshot: makeSnapshot(data.runId, 2, gatekeeper, failure),
        }), 25);
      }
    };
  `;
}

async function installFakeWorker(page, { failFirstRun = false, failWhenNominal = false, failureKind = 'features' } = {}) {
  let workerRequests = 0;
  await page.route('**/assets/budget-planning/worker.js', async (route) => {
    workerRequests += 1;
    const shouldFail = (failFirstRun && workerRequests === 1) || (failWhenNominal && workerRequests === 2);
    await route.fulfill({
      contentType: 'text/javascript',
      body: fakeWorkerSource(shouldFail, failureKind, failWhenNominal),
    });
  });
}

async function waitForSnapshot(page) {
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.time !== undefined);
  await expect(page.locator('#loading-overlay')).toBeHidden();
}

test('gatekeeper toggle restarts with the same tuning and exposes the selected mode', async ({ page }) => {
  await installFakeWorker(page);
  await page.goto('/budget-planning.html');
  await waitForSnapshot(page);

  const before = await page.evaluate(() => ({
    config: window.__budgetDemo.getConfig(),
    lifecycle: window.__budgetDemo.getLifecycle(),
    state: window.__budgetDemo.getState(),
  }));
  expect(before.config.gatekeeper).toBe(true);
  expect(before.state.gatekeeper).toBe(true);
  await expect(page.locator('#gatekeeper-toggle')).toBeChecked();
  await expect(page.locator('#control-mode')).toContainText('Gatekeeper active');

  await page.locator('#gatekeeper-toggle').uncheck();
  await page.waitForFunction((runId) => window.__budgetDemo.getLifecycle().runId > runId, before.lifecycle.runId);
  await waitForSnapshot(page);
  const after = await page.evaluate(() => ({
    config: window.__budgetDemo.getConfig(),
    lifecycle: window.__budgetDemo.getLifecycle(),
    state: window.__budgetDemo.getState(),
  }));
  expect(after.config.gatekeeper).toBe(false);
  expect(after.state.gatekeeper).toBe(false);
  expect(after.config.budget).toBe(before.config.budget);
  expect(after.config.minFeatures).toBe(before.config.minFeatures);
  expect(after.config.speed).toBe(before.config.speed);
  expect(after.config.radius).toBe(before.config.radius);
  expect(after.state.worldId).toBe(before.state.worldId);
  expect(after.lifecycle.runId).toBe(before.lifecycle.runId + 1);
  await expect(page.locator('#gatekeeper-toggle')).not.toBeChecked();
  await expect(page.locator('#control-mode')).toContainText('Nominal only');
});

test('safety failure explains the measured threshold, freezes play, and clears on reset', async ({ page }) => {
  await installFakeWorker(page, { failFirstRun: true });
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.phase === 'fault');

  await expect(page.locator('#failure-alert')).toBeVisible();
  await expect(page.locator('.failure-mark')).toHaveText('FAIL');
  await expect(page.locator('#failure-title')).toHaveText('Minimum shared-feature constraint not satisfied');
  await expect(page.locator('#failure-reason')).toHaveText('The minimum shared-feature constraint was not satisfied.');
  await expect(page.locator('#failure-measurement')).toContainText('3 shared features');
  await expect(page.locator('#failure-measurement')).toContainText('minimum 6');
  await expect(page.locator('#play-button')).toBeDisabled();
  await expect(page.locator('#failure-reset')).toBeVisible();

  const beforeReset = await page.evaluate(() => window.__budgetDemo.getLifecycle().runId);
  await page.locator('#failure-reset').click();
  await expect(page.locator('#failure-alert')).toBeHidden();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.waitForFunction((runId) => window.__budgetDemo.getLifecycle().runId > runId, beforeReset);
  await waitForSnapshot(page);
  await expect(page.locator('#failure-alert')).toBeHidden();
});

test('error-budget failure reports metres and its configured limit', async ({ page }) => {
  await installFakeWorker(page, { failFirstRun: true, failureKind: 'budget' });
  await page.goto('/budget-planning.html');
  await page.waitForFunction(() => window.__budgetDemo?.getState()?.phase === 'fault');

  await expect(page.locator('#failure-alert')).toBeVisible();
  await expect(page.locator('#failure-title')).toHaveText('Localization-error budget constraint not satisfied');
  await expect(page.locator('#failure-reason')).toHaveText('The localization-error budget constraint was not satisfied.');
  await expect(page.locator('#failure-measurement')).toContainText('5.40 m');
  await expect(page.locator('#failure-measurement')).toContainText('limit 5.00 m');
  await expect(page.locator('#play-button')).toBeDisabled();
});

for (const [label, resetSelector] of [['persistent Reset button', '#reset-button'], ['failure-alert Reset button', '#failure-reset'], ['R keyboard shortcut', null]]) {
  test(`nominal-only failure reset resumes playback from the ${label}`, async ({ page }) => {
    await installFakeWorker(page, { failWhenNominal: true, failureKind: 'budget' });
    await page.goto('/budget-planning.html');
    await waitForSnapshot(page);
    await page.locator('#gatekeeper-toggle').uncheck();
    await page.waitForFunction(() => window.__budgetDemo?.getState()?.gatekeeper === false
      && window.__budgetDemo.getState()?.phase === 'fault');
    await expect(page.locator('#failure-alert')).toBeVisible();
    await expect(page.locator('#play-button')).toBeDisabled();

    const failedRunId = await page.evaluate(() => window.__budgetDemo.getLifecycle().runId);
    if (resetSelector) await page.locator(resetSelector).click();
    else {
      await page.locator('#scene-canvas').focus();
      await page.keyboard.press('r');
    }
    await page.waitForFunction((runId) => {
      const lifecycle = window.__budgetDemo?.getLifecycle();
      const state = window.__budgetDemo?.getState();
      return lifecycle?.runId > runId && lifecycle.playing && state?.gatekeeper === false
        && state.phase !== 'fault' && !state.failure;
    }, failedRunId);

    await expect(page.locator('#failure-alert')).toBeHidden();
    await expect(page.locator('#play-button')).toHaveText('Pause');
    expect(await page.evaluate(() => window.__budgetDemo.getLifecycle().playing)).toBe(true);
  });
}

test('real nominal-only failure stops, then persistent Reset resumes the mission',async({page})=>{
  await page.goto('/budget-planning.html');
  await waitForSnapshot(page);
  await page.locator('#budget-number').fill('1');await page.locator('#budget-number').press('Enter');
  await waitForSnapshot(page);
  await page.locator('#gatekeeper-toggle').uncheck();
  await expect(page.locator('#control-mode')).toContainText('Nominal only');
  await page.waitForFunction(()=>window.__budgetDemo?.getState()?.failure!==null&&window.__budgetDemo?.getState()?.phase==='fault',{},{timeout:30000});
  const state=await page.evaluate(()=>window.__budgetDemo.getState());
  expect(state.gatekeeper).toBe(false);
  expect(state.failure.kind).toBe('budget');
  expect(state.failure.actual).toBeGreaterThan(state.failure.limit);
  await expect(page.locator('#failure-alert')).toBeVisible();
  await expect(page.locator('#failure-measurement')).toContainText('1.002 m');
  await expect(page.locator('#play-button')).toBeDisabled();
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>window.__budgetDemo.getState().pose)).toEqual(state.pose);
  if(test.info().project.name==='chromium')await page.screenshot({path:test.info().outputPath('nominal-budget-fail.png')});

  const failedRunId = await page.evaluate(() => window.__budgetDemo.getLifecycle().runId);
  await page.locator('#reset-button').click();
  await page.waitForFunction((runId) => {
    const lifecycle = window.__budgetDemo?.getLifecycle();
    const resetState = window.__budgetDemo?.getState();
    return lifecycle?.runId > runId && lifecycle.playing && resetState?.gatekeeper === false
      && resetState.time > 0.2 && resetState.phase !== 'fault' && !resetState.failure && !resetState.fault;
  }, failedRunId, { timeout: 30_000 });
  const resumed = await page.evaluate(() => ({
    state: window.__budgetDemo.getState(),
    lifecycle: window.__budgetDemo.getLifecycle(),
  }));
  expect(resumed.state.gatekeeper).toBe(false);
  expect(resumed.state.time).toBeGreaterThan(0.2);
  expect(resumed.state.failure).toBeNull();
  expect(resumed.state.fault).toBeNull();
  expect(resumed.lifecycle.playing).toBe(true);
});
