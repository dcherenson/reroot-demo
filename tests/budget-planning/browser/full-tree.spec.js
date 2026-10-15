import { test, expect } from '@playwright/test';

for (const worldId of ['farm','tucson','ann-arbor']) test(`full capped ReRoot forest renders ${worldId} at interactive frame rate`, async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The FPS assertion uses Chromium WebGL timing.');
  test.setTimeout(120_000);

  // The normal app owns a worker and grows its own planner.  Blocking only
  // that entrypoint leaves the real page/canvas in place while this test
  // supplies a deterministic full-capacity planner in the page itself.
  await page.route('**/assets/budget-planning/app.js', (route) => route.abort());
  await page.goto('/budget-planning.html');

  const prepared = await page.evaluate(async (worldId) => {
    const [{ DemoRenderer }, { createWorld }, { Simulation }, { ReRoot }, { LiveFeatureMap }, dubins] = await Promise.all([
      import('/assets/budget-planning/renderer.js'),
      import('/assets/budget-planning/worlds.js'),
      import('/assets/budget-planning/simulation.js'),
      import('/assets/budget-planning/planner.js'),
      import('/assets/budget-planning/vision.js'),
      import('/assets/budget-planning/dubins.js'),
    ]);

    const seed = 1337;
    const world = createWorld(worldId, seed);
    // Exercise the same pixel feature path as the worker before filling the
    // renderer with the full-capacity stress forest.  The live map and its
    // detector keep their own fixed capacities (1,000 anchors / 500 corners)
    // while captureSensor reuses the two 320 x 240 readback buffers.
    const simulation = new Simulation(worldId, {}, seed, { pixelFeatures: true });
    const liveFeatures = new LiveFeatureMap(world);
    const sensorBuffers = {};
    const sensorStats = {
      samples: 0,
      processingMs: 0,
      maxProcessingMs: 0,
      wallMs: 0,
      maxWallMs: 0,
      lastAt: null,
      intervalTotalMs: 0,
      intervalCount: 0,
      minIntervalMs: Infinity,
      maxIntervalMs: 0,
      lastMetrics: null,
    };
    const forest = new ReRoot({
      radius: 10,
      seed,
      maxNodes: 4000,
      edgeCheck: () => ({ safe: true, cost: 0 }),
    });

    // Four discovered/caller-certified orbit roots consume all sixteen root
    // slots.  The subsequent grow call must fill the remaining 3984 slots.
    const orbitSpecs = [
      { id: world.landmarks[0].id, x: world.landmarks[0].x, y: world.landmarks[0].y, radius: 10, direction: 1 },
      { id: 'stress-orbit-1', x: 105, y: 70, radius: 10, direction: 1 },
      { id: 'stress-orbit-2', x: 180, y: 120, radius: 10, direction: 1 },
      { id: 'stress-orbit-3', x: 260, y: 165, radius: 10, direction: 1 },
    ];
    orbitSpecs.forEach((orbit) => forest.addOrbit(orbit));
    const added = forest.grow([160, 115], 240, 3984);
    if (forest.nodes.length !== 4000 || forest.rootCount !== 16 || added !== 3984) {
      throw new Error(`full-tree setup did not reach the cap: ${forest.nodes.length} nodes, ${forest.rootCount} roots, ${added} added`);
    }

    const renderer = new DemoRenderer(document.getElementById('scene-canvas'));
    renderer.setWorld(world);
    const measureSensor = () => {
      const started = performance.now();
      const frame = renderer.captureSensor(simulation.pose, simulation.cameraYaw, sensorBuffers);
      // Keep the worker-style recycled buffers in place.  LiveFeatureMap only
      // reads them synchronously, so no per-frame image copy is retained.
      sensorBuffers.rgba = frame.rgba;
      sensorBuffers.depth = frame.depth;
      const observation = liveFeatures.measure(frame, simulation.pose, simulation.cameraYaw);
      const finished = performance.now();
      const processingMs = Number(observation.metrics?.processingMs) || 0;
      sensorStats.samples += 1;
      sensorStats.processingMs += processingMs;
      sensorStats.maxProcessingMs = Math.max(sensorStats.maxProcessingMs, processingMs);
      sensorStats.wallMs += finished - started;
      sensorStats.maxWallMs = Math.max(sensorStats.maxWallMs, finished - started);
      if (sensorStats.lastAt !== null) {
        const interval = started - sensorStats.lastAt;
        sensorStats.intervalTotalMs += interval;
        sensorStats.intervalCount += 1;
        sensorStats.minIntervalMs = Math.min(sensorStats.minIntervalMs, interval);
        sensorStats.maxIntervalMs = Math.max(sensorStats.maxIntervalMs, interval);
      }
      sensorStats.lastAt = started;
      sensorStats.lastMetrics = observation.metrics;
      simulation.sensorObservation = observation;
      return observation;
    };
    const resetSensorStats = () => {
      sensorStats.samples = 0;
      sensorStats.processingMs = 0;
      sensorStats.maxProcessingMs = 0;
      sensorStats.wallMs = 0;
      sensorStats.maxWallMs = 0;
      sensorStats.lastAt = null;
      sensorStats.intervalTotalMs = 0;
      sensorStats.intervalCount = 0;
      sensorStats.minIntervalMs = Infinity;
      sensorStats.maxIntervalMs = 0;
      sensorStats.lastMetrics = null;
    };
    const initialObservation = measureSensor();
    simulation.acceptSensor(initialObservation);

    // Reuse the production snapshot shape so terrain, mapped features,
    // landmarks, zones, knowledge mask, paths, trail, charts, and tree data
    // exercise the same renderer update path as the application.
    simulation.forest = forest;
    simulation.knowledge.mapped.fill(1);
    simulation.knowledge.discovered = new Set(world.landmarks.map((landmark) => landmark.id));
    simulation.knowledge.knownZones = new Set(world.zones.map((zone) => zone.id));
    simulation.active = new Set(world.landmarks.map((landmark) => landmark.id));
    simulation.visible = simulation.knowledge.features.map((_feature, index) => index);
    for (let index = 0; index < simulation.trail.capacity; index += 1) {
      const phase = index / Math.max(1, simulation.trail.capacity - 1) * Math.PI * 2;
      simulation.trail.push(45 + Math.cos(phase) * 22, 65 + Math.sin(phase) * 22, 45 + Math.cos(phase) * 23, 65 + Math.sin(phase) * 23);
    }
    for (let index = 0; index < simulation.history.capacity; index += 1) {
      simulation.history.push(index * 0.2, (index % 120) / 120, 6 + (index % 5), index % 17 === 0 ? 1 : 0);
    }

    const nominalEnd = [260, 165, Math.PI / 2];
    const nominal = dubins.shortestPath(simulation.pose, nominalEnd, simulation.config.radius);
    const backup = forest.query(nominalEnd);
    simulation.nominalPaths = nominal ? [nominal] : [];
    simulation.committed = nominal && backup ? {
      nominalPaths: [nominal],
      backupPaths: backup.paths,
      switchDistance: nominal.length * 0.55,
      totalLength: nominal.length * 0.55 + dubins.pathLength(backup.paths),
      rootId: world.landmarks[0].id,
      mapVersion: simulation.knowledge.version,
    } : null;

    const snapshot = simulation.snapshot({ full: true });
    renderer.update(snapshot);
    // Keep the complete scenery visible for the worst-case render load.
    renderer.setKnowledgeView(false);
    globalThis.__fullTreeStress = {
      forest,
      renderer,
      simulation,
      liveFeatures,
      sensorBuffers,
      sensorStats,
      measureSensor,
      resetSensorStats,
    };

    return {
      added,
      nodeCount: forest.nodes.length,
      rootCount: forest.rootCount,
      snapshotEdges: snapshot.treeEdges.length,
      snapshotColors: snapshot.treeColors.length,
      mapped: snapshot.mappedFeatureIds.length,
      trail: snapshot.trail.length,
      history: snapshot.history.length,
      sensor: {
        corners: initialObservation.metrics.corners,
        inFootprint: initialObservation.metrics.inFootprint,
        mapped: initialObservation.metrics.mapped,
        rgbaBytes: sensorBuffers.rgba.byteLength,
        depthBytes: sensorBuffers.depth.byteLength,
        anchors: liveFeatures.anchors.length,
        previous: liveFeatures.previous.length,
      },
      diagnostics: renderer.getDiagnostics(),
      treeDrawCount: renderer.paths.tree.geometry.instanceCount,
    };
  }, worldId);

  try {
    expect(prepared.added).toBe(3984);
    expect(prepared.nodeCount).toBe(4000);
    expect(prepared.rootCount).toBe(16);
    expect(prepared.snapshotEdges).toBeGreaterThan(4000);
    expect(prepared.snapshotColors).toBe(prepared.snapshotEdges / 2 * 3);
    expect(prepared.mapped).toBeGreaterThan(0);
    expect(prepared.trail).toBeGreaterThan(0);
    expect(prepared.history).toBeGreaterThan(0);
    expect(prepared.sensor.corners).toBeGreaterThan(0);
    expect(prepared.sensor.inFootprint).toBeGreaterThan(0);
    expect(prepared.sensor.mapped).toBeGreaterThan(0);
    expect(prepared.sensor.rgbaBytes).toBe(320 * 240 * 4);
    expect(prepared.sensor.depthBytes).toBe(320 * 240 * 4);
    expect(prepared.sensor.anchors).toBeLessThanOrEqual(1000);
    expect(prepared.sensor.previous).toBeLessThanOrEqual(500);
    expect(prepared.treeDrawCount).toBeGreaterThan(0);
    expect(prepared.diagnostics.geometries).toBeLessThan(400);
    expect(prepared.diagnostics.textures).toBeLessThan(20);

    // Warm the renderer and then measure an independent RAF stream while the
    // renderer's own animation loop draws every frame.
    await page.waitForTimeout(750);
    const frameStats = await page.evaluate(({ durationMs, sensorHz }) => new Promise((resolve) => {
      const state = globalThis.__fullTreeStress;
      state.resetSensorStats();
      const sensorPeriodMs = 1000 / sensorHz;
      let frames = 0;
      let first = null;
      let nextSensorAt = null;
      const tick = (timestamp) => {
        if (first === null) first = timestamp;
        if (nextSensorAt === null) nextSensorAt = timestamp;
        if (timestamp >= nextSensorAt) {
          state.measureSensor();
          nextSensorAt += sensorPeriodMs;
          // A slow readback must not create an unbounded catch-up loop or a
          // burst of retained frames; resume at the next real 5 Hz slot.
          if (nextSensorAt <= timestamp) nextSensorAt = timestamp + sensorPeriodMs;
        }
        frames += 1;
        if (timestamp - first >= durationMs) {
          const seconds = (timestamp - first) / 1000;
          const diagnostics = state.renderer.getDiagnostics();
          const sensor = {
            ...state.sensorStats,
            averageProcessingMs: state.sensorStats.samples ? state.sensorStats.processingMs / state.sensorStats.samples : 0,
            averageWallMs: state.sensorStats.samples ? state.sensorStats.wallMs / state.sensorStats.samples : 0,
            averageIntervalMs: state.sensorStats.intervalCount ? state.sensorStats.intervalTotalMs / state.sensorStats.intervalCount : 0,
            anchors: state.liveFeatures.anchors.length,
            previous: state.liveFeatures.previous.length,
            rgbaBytes: state.sensorBuffers.rgba?.byteLength || 0,
            depthBytes: state.sensorBuffers.depth?.byteLength || 0,
          };
          delete sensor.lastAt;
          delete sensor.lastMetrics;
          resolve({
            frames,
            seconds,
            fps: frames / seconds,
            diagnostics,
            sensor,
            treeDrawCount: globalThis.__fullTreeStress.renderer.paths.tree.geometry.instanceCount,
          });
          return;
        }
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    }), { durationMs: 4000, sensorHz: 5 });

    console.log('FULL_TREE_FPS', JSON.stringify({
      fps: frameStats.fps,
      frames: frameStats.frames,
      treeDrawCount: frameStats.treeDrawCount,
      diagnostics: frameStats.diagnostics,
      sensor: frameStats.sensor,
    }));
    expect(frameStats.sensor.samples).toBeGreaterThanOrEqual(18);
    expect(frameStats.sensor.samples).toBeLessThanOrEqual(22);
    expect(frameStats.sensor.averageIntervalMs).toBeGreaterThanOrEqual(150);
    expect(frameStats.sensor.averageIntervalMs).toBeLessThanOrEqual(250);
    expect(frameStats.sensor.anchors).toBeLessThanOrEqual(1000);
    expect(frameStats.sensor.previous).toBeLessThanOrEqual(500);
    expect(frameStats.sensor.rgbaBytes).toBe(320 * 240 * 4);
    expect(frameStats.sensor.depthBytes).toBe(320 * 240 * 4);
    expect(frameStats.fps).toBeGreaterThanOrEqual(30);
    expect(frameStats.treeDrawCount).toBe(prepared.treeDrawCount);
    expect(frameStats.diagnostics.geometries).toBeLessThan(400);
    expect(frameStats.diagnostics.textures).toBeLessThan(20);
    expect(frameStats.diagnostics.drawCalls).toBeLessThan(500);
  } finally {
    await page.evaluate(() => {
      globalThis.__fullTreeStress?.renderer.dispose();
      delete globalThis.__fullTreeStress;
    });
  }
});
