import { test, expect } from '@playwright/test';

const WORLD_IDS = ['farm', 'tucson', 'ann-arbor'];

// Each pose is 25 m before the center of an authored region, with the sensor
// looking along the region's long axis.  Keeping both the aircraft and target
// well inside the 320 x 230 world makes the contrast come from scenery rather
// than from a camera pointed beyond the world boundary.
const REGION_SENSOR_PROBES = [
  {
    id: 'farm',
    poor: { region: 'farm-north-field', pose: [69, 111, Math.PI / 2], target: [69, 136] },
    rich: { region: 'farm-west-grove', pose: [45, 60, -Math.PI / 2], target: [45, 35] },
  },
  {
    id: 'tucson',
    poor: { region: 'tucson-west-sand', pose: [44, 124, Math.PI / 2], target: [44, 149] },
    rich: { region: 'tucson-west-saguaro', pose: [76, 123, -Math.PI / 2], target: [76, 98] },
  },
  {
    id: 'ann-arbor',
    poor: { region: 'annarbor-west-lawn', pose: [45, 160, Math.PI / 2], target: [45, 185] },
    rich: { region: 'annarbor-campus-lane', pose: [85, 105, -Math.PI / 2], target: [85, 80] },
  },
];

async function openRenderer(page) {
  await page.route('**/assets/budget-planning/app.js', (route) => route.abort());
  await page.goto('/budget-planning.html');
}

test('GPU sensor depth unprojects onto the generated terrain surface', async ({ page }) => {
  await openRenderer(page);
  const samples = await page.evaluate(async (worldIds) => {
    const [{ DemoRenderer }, { createWorld, terrainHeight }, { unprojectDepth }] = await Promise.all([
      import('/assets/budget-planning/renderer.js'),
      import('/assets/budget-planning/worlds.js'),
      import('/assets/budget-planning/sensor-camera.js'),
    ]);
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    const result = [];
    try {
      for (const id of worldIds) {
        const world = createWorld(id, 1337);
        renderer.setWorld(world);
        const home = world.landmarks[0];
        // Ann Arbor's launch camera looks along the river-facing campus edge;
        // this heading keeps the center ray on the ground rather than a tree.
        const yaw = id === 'ann-arbor' ? Math.PI / 2 : 0;
        const frame = renderer.captureSensor([home.x, home.y, 0], yaw);
        const point = unprojectDepth(frame, 160, 120, world.width, world.height);
        const ground = point ? terrainHeight(world, point.x, point.y) : NaN;
        const center = (120 * frame.width + 160) * 4;
        result.push({
          id,
          point,
          ground,
          error: point ? point.z - ground : Infinity,
          rgb: Array.from(frame.rgba.slice(center, center + 4)),
          depth: Array.from(frame.depth.slice(center, center + 4)),
        });
      }
    } finally {
      renderer.dispose();
    }
    return result;
  }, WORLD_IDS);

  expect(samples).toHaveLength(WORLD_IDS.length);
  for (const sample of samples) {
    expect(sample.point).toEqual(expect.objectContaining({
      x: expect.any(Number), y: expect.any(Number), z: expect.any(Number),
    }));
    expect(sample.point.x).toBeGreaterThanOrEqual(0);
    expect(sample.point.x).toBeLessThanOrEqual(320);
    expect(sample.point.y).toBeGreaterThanOrEqual(0);
    expect(sample.point.y).toBeLessThanOrEqual(230);
    expect(Math.abs(sample.error)).toBeLessThan(0.25);
    expect(sample.rgb).toHaveLength(4);
    expect(sample.depth).toHaveLength(4);
    expect(sample.depth.some((value) => value !== 255)).toBe(true);
  }
});

test('real sensor corners are sparse in authored poor regions and rich in scenery patches', async ({ page }) => {
  await openRenderer(page);
  const result = await page.evaluate(async (probes) => {
    const [{ DemoRenderer }, { createWorld, terrainHeight }, { LiveFeatureMap }, { inSensorImage }] = await Promise.all([
      import('/assets/budget-planning/renderer.js'),
      import('/assets/budget-planning/worlds.js'),
      import('/assets/budget-planning/vision.js'),
      import('/assets/budget-planning/sensor-camera.js'),
    ]);
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    const readings = [];
    try {
      for (const probe of probes) {
        const world = createWorld(probe.id, 1337);
        renderer.setWorld(world);
        const reading = { id: probe.id };
        for (const kind of ['poor', 'rich']) {
          const sample = probe[kind];
          const [x, y, yaw] = sample.pose;
          const target = { x: sample.target[0], y: sample.target[1], z: terrainHeight(world, sample.target[0], sample.target[1]) };
          if (!(x > 0 && x < world.width && y > 0 && y < world.height)) throw new Error(`${probe.id} ${kind} pose is outside the world`);
          if (!inSensorImage(sample.pose, target, yaw, world.altitude)) throw new Error(`${probe.id} ${kind} target is outside the sensor footprint`);
          const frame = renderer.captureSensor(sample.pose, yaw);
          const observation = new LiveFeatureMap(world).measure(frame, sample.pose, yaw);
          reading[kind] = {
            region: sample.region,
            pose: sample.pose,
            target: sample.target,
            corners: observation.metrics.corners,
            inFootprint: observation.metrics.inFootprint,
            mapped: observation.metrics.mapped,
            frame: [frame.width, frame.height],
          };
        }
        readings.push(reading);
      }
    } finally {
      renderer.dispose();
    }
    return readings;
  }, REGION_SENSOR_PROBES);

  console.log('REGION_SENSOR_CORNERS', JSON.stringify(result));
  expect(result).toHaveLength(REGION_SENSOR_PROBES.length);
  for (const reading of result) {
    expect(reading.poor.frame).toEqual([320, 240]);
    expect(reading.rich.frame).toEqual([320, 240]);
    // Bare sand may legitimately contain no FAST corners. The contrast with
    // the rich patch, rather than fabricated texture in empty ground, matters.
    expect(reading.poor.corners).toBeGreaterThanOrEqual(0);
    expect(reading.rich.corners).toBeGreaterThan(reading.poor.corners * 2);
    expect(reading.rich.inFootprint).toBeGreaterThan(reading.poor.inFootprint);
    expect(reading.rich.mapped).toBeGreaterThan(reading.poor.mapped);
  }
});

test('sensor RGB and depth are independent of viewer mode and robot fog', async ({ page }) => {
  await openRenderer(page);
  const result = await page.evaluate(async () => {
    const [{ DemoRenderer }, { createWorld }, { Simulation }] = await Promise.all([
      import('/assets/budget-planning/renderer.js'),
      import('/assets/budget-planning/worlds.js'),
      import('/assets/budget-planning/simulation.js'),
    ]);
    const simulation = new Simulation('farm', {}, 1337);
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    const digest = (bytes) => {
      let hash = 2166136261;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
      return hash >>> 0;
    };
    const difference = (first, second) => {
      let count = 0;
      for (let index = 0; index < first.length; index += 1) if (first[index] !== second[index]) count += 1;
      return count;
    };
    try {
      renderer.setWorld(createWorld('farm', 1337));
      renderer.update(simulation.snapshot());
      const pose = simulation.pose;
      const yaw = simulation.cameraYaw;
      const baseline = renderer.captureSensor(pose, yaw);
      const baselineRgb = baseline.rgba.slice();
      const baselineDepth = baseline.depth.slice();
      const captures = [];
      for (const mode of ['top', 'fpv', 'orbit']) {
        renderer.setViewMode(mode);
        renderer.render();
        renderer.setKnowledgeView(true);
        renderer.setKnowledgeView(false);
        renderer.setKnowledgeView(true);
        const frame = renderer.captureSensor(pose, yaw);
        captures.push({
          mode,
          rgbHash: digest(frame.rgba),
          depthHash: digest(frame.depth),
          rgbDiff: difference(baselineRgb, frame.rgba),
          depthDiff: difference(baselineDepth, frame.depth),
        });
      }
      return {
        baselineRgbHash: digest(baselineRgb),
        baselineDepthHash: digest(baselineDepth),
        captures,
      };
    } finally {
      renderer.dispose();
    }
  });

  expect(result.captures).toHaveLength(3);
  for (const capture of result.captures) {
    expect(capture.rgbHash).toBe(result.baselineRgbHash);
    expect(capture.depthHash).toBe(result.baselineDepthHash);
    expect(capture.rgbDiff).toBe(0);
    expect(capture.depthDiff).toBe(0);
  }
});

test('mathematical path and camera overlays never enter the optical sensor', async ({ page }) => {
  await openRenderer(page);
  const result = await page.evaluate(async () => {
    const [{ DemoRenderer }, { createWorld }, { Simulation }] = await Promise.all([
      import('/assets/budget-planning/renderer.js'),
      import('/assets/budget-planning/worlds.js'),
      import('/assets/budget-planning/simulation.js'),
    ]);
    const simulation = new Simulation('farm', {}, 1337);
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    const digest = (bytes) => {
      let hash = 2166136261;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
      return hash >>> 0;
    };
    try {
      renderer.setWorld(createWorld('farm', 1337));
      renderer.update(simulation.snapshot());
      const baseline = renderer.captureSensor(simulation.pose, simulation.cameraYaw);
      const baselineRgb = baseline.rgba.slice();
      const baselineDepth = baseline.depth.slice();

      // Toggle every mathematical overlay that has a visible scene object,
      // including the nominal/backup turn paths and camera fan.
      Object.values(renderer.paths).forEach((path) => { path.object.visible = !path.object.visible; });
      renderer.orbit.visible = !renderer.orbit.visible;
      renderer.orbitCenter.visible = !renderer.orbitCenter.visible;
      renderer.switchpoint.visible = !renderer.switchpoint.visible;
      renderer.cameraFan.visible = !renderer.cameraFan.visible;
      renderer.cameraFanSides.visible = !renderer.cameraFanSides.visible;
      renderer.cameraFanEdges.visible = !renderer.cameraFanEdges.visible;
      renderer.worldBorder.visible = !renderer.worldBorder.visible;
      if (renderer.planningGrid) renderer.planningGrid.visible = !renderer.planningGrid.visible;
      const toggled = renderer.captureSensor(simulation.pose, simulation.cameraYaw);
      return {
        baselineRgb: digest(baselineRgb),
        baselineDepth: digest(baseline.depth),
        toggledRgb: digest(toggled.rgba),
        toggledDepth: digest(toggled.depth),
        rgbDiff: baselineRgb.reduce((count, value, index) => count + (value !== toggled.rgba[index] ? 1 : 0), 0),
        depthDiff: baselineDepth.reduce((count, value, index) => count + (value !== toggled.depth[index] ? 1 : 0), 0),
      };
    } finally {
      renderer.dispose();
    }
  });

  expect(result.toggledRgb).toBe(result.baselineRgb);
  expect(result.toggledDepth).toBe(result.baselineDepth);
  expect(result.rgbDiff).toBe(0);
  expect(result.depthDiff).toBe(0);
});

test('pixel marker positions persist after worker-style ACK buffer transfer', async ({ page }) => {
  await openRenderer(page);
  const result = await page.evaluate(async () => {
    const [{ DemoRenderer }, { createWorld }, { Simulation }, { LiveFeatureMap }] = await Promise.all([
      import('/assets/budget-planning/renderer.js'),
      import('/assets/budget-planning/worlds.js'),
      import('/assets/budget-planning/simulation.js'),
      import('/assets/budget-planning/vision.js'),
    ]);
    const simulation = new Simulation('farm', {}, 1337, { pixelFeatures: true });
    const vision = new LiveFeatureMap(simulation.world);
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    try {
      renderer.setWorld(simulation.world);
      const initialFrame = renderer.captureSensor(simulation.pose, simulation.cameraYaw);
      const observation = vision.measure(initialFrame, simulation.pose, simulation.cameraYaw);
      simulation.acceptSensor(observation);
      const snapshot = simulation.snapshot();
      renderer.update(snapshot);
      const beforeCount = renderer.featurePointGeometry.drawRange.count;
      const before = Array.from(renderer.featurePointGeometry.getAttribute('position').array.slice(0, beforeCount * 3));
      const mappedCount = snapshot.mappedFeatureIds.length;
      if (beforeCount <= 0) throw new Error('the real camera frame should create mapped pixel markers');

      // app.js transfers the worker-owned buffers immediately after update;
      // renderer.update must therefore retain its own position copy.
      for (const key of ['featurePositions', 'mappedFeatureIds', 'visibleFeatureIds', 'treeEdges', 'treeColors', 'nominal', 'committedNominal', 'backup', 'trail', 'history']) {
        if (snapshot[key]?.buffer) structuredClone(snapshot[key], { transfer: [snapshot[key].buffer] });
      }
      if (snapshot.knowledge) {
        structuredClone(snapshot.knowledge.cells, { transfer: [snapshot.knowledge.cells.buffer] });
        structuredClone(snapshot.knowledge.observed, { transfer: [snapshot.knowledge.observed.buffer] });
      }
      renderer.setKnowledgeView(true);
      renderer.setKnowledgeView(false);
      renderer.setViewMode('top');
      renderer.setViewMode('orbit');
      const afterCount = renderer.featurePointGeometry.drawRange.count;
      const after = Array.from(renderer.featurePointGeometry.getAttribute('position').array.slice(0, afterCount * 3));
      return {
        beforeCount,
        afterCount,
        samePositions: before.length === after.length && before.every((value, index) => value === after[index]),
        mapped: mappedCount,
        vision: observation.metrics,
      };
    } finally {
      renderer.dispose();
    }
  });

  expect(result.mapped).toBeGreaterThan(0);
  expect(result.vision.corners).toBeGreaterThan(0);
  expect(result.beforeCount).toBeGreaterThan(0);
  expect(result.afterCount).toBe(result.beforeCount);
  expect(result.samePositions).toBe(true);
});
