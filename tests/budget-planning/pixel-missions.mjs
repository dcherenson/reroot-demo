import { chromium } from 'playwright';

const positional = [];
const options = {};
const booleanOptions = new Set(['assert-goal', 'assert-safe', 'assert-fail', 'memory', 'gatekeeper']);
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument.startsWith('--')) {
    const equals = argument.indexOf('=');
    const name = equals < 0 ? argument.slice(2) : argument.slice(2, equals);
    let value;
    if (equals >= 0) {
      value = argument.slice(equals + 1);
    } else if (booleanOptions.has(name)) {
      const next = process.argv[index + 1];
      if (next && /^(?:true|false|1|0)$/i.test(next)) {
        value = next;
        index += 1;
      } else {
        value = true;
      }
    } else {
      value = process.argv[++index];
    }
    options[name] = value;
  } else {
    positional.push(argument);
  }
}

const hasOption = (name) => Object.prototype.hasOwnProperty.call(options, name);
const optionNumber = (name, fallback) => {
  const raw = hasOption(name) ? options[name] : fallback;
  if (raw === true || raw === undefined) throw new Error(`Missing value for --${name}.`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
};
const optionBoolean = (name) => {
  if (!hasOption(name)) return false;
  const value = options[name];
  return value === true || /^(?:true|1|yes|on)$/i.test(String(value));
};

const worldId = options.world || positional[0] || 'farm';
const steps = optionNumber('steps', positional[1] ?? 600);
const seed = optionNumber('seed', 1337);
const period = optionNumber('period', 25);
const baseUrl = options.url || process.env.PIXEL_MISSION_BASE_URL || 'http://127.0.0.1:4180';
const angle = process.platform === 'darwin' ? 'metal' : 'default';
if (!Number.isInteger(steps) || steps < 0) throw new Error(`Invalid step count: ${steps}`);
if (!Number.isInteger(period) || period < 1) throw new Error(`Invalid report period: ${period}`);
if (!Number.isFinite(seed)) throw new Error(`Invalid seed: ${seed}`);

const config = {};
for (const [optionName, configName] of [
  ['budget', 'budget'],
  ['min-features', 'minFeatures'],
  ['speed', 'speed'],
  ['radius', 'radius'],
  ['fov', 'horizontalFov'],
  ['range', 'sensingRange'],
  ['pitch', 'downwardPitch'],
]) {
  if (hasOption(optionName)) config[configName] = optionNumber(optionName);
}
const assertGoal = optionBoolean('assert-goal');
const assertSafe = optionBoolean('assert-safe');
const assertFail = optionBoolean('assert-fail');
if(hasOption('gatekeeper'))config.gatekeeper=optionBoolean('gatekeeper');
const collectMemory = optionBoolean('memory');

const browser = await chromium.launch({
  headless: true,
  args: ['--js-flags=--expose-gc', ...(angle === 'metal' ? ['--use-angle=metal'] : [])],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route('**/assets/budget-planning/app.js', (route) => route.abort());

let report;
try {
  // Runtime.getHeapUsage is the browser heap, rather than the Node process
  // hosting Playwright.  The exposed function lets the page's simulation loop
  // collect explicit GC samples without splitting the mission into one RPC per
  // simulation tick.
  let memorySession = null;
  if (collectMemory) {
    memorySession = await page.context().newCDPSession(page);
    await memorySession.send('HeapProfiler.enable');
    await page.exposeFunction('__pixelMissionCollectMemory', async () => {
      await memorySession.send('HeapProfiler.collectGarbage');
      return memorySession.send('Runtime.getHeapUsage');
    });
  }
  await page.goto(`${baseUrl.replace(/\/$/, '')}/budget-planning.html`);
  report = await page.evaluate(async ({
    worldId: requestedWorld,
    steps: requestedSteps,
    seed: requestedSeed,
    period: reportPeriod,
    angle: requestedAngle,
    config: requestedConfig,
    memory: requestedMemory,
  }) => {
    const [{ DemoRenderer }, { LiveFeatureMap }, { Simulation }] = await Promise.all([
      import('/assets/budget-planning/renderer.js'),
      import('/assets/budget-planning/vision.js'),
      import('/assets/budget-planning/simulation.js'),
    ]);
    const simulation = new Simulation(requestedWorld, requestedConfig, requestedSeed, { pixelFeatures: true });
    const vision = new LiveFeatureMap(simulation.world, simulation.config);
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    renderer.setSensorConfig(simulation.config);
    const phaseCounts = {};
    const discoveries = [];
    const phaseTransitions = [];
    let latestObservation = null;
    let faultCount = 0;
    let goalCount = 0;
    let previousPhase = null;
    let previousFault = null;
    let previousGoal = false;
    let maxMatches = 0;
    let maxShared = 0;
    let maxCorners = 0;
    let maxMapCount = 0;
    let maxBudget = 0;
    let maxError = 0;
    let maxDistanceFromHome=0,firstDepartureTime=null;
    let maxTrailCount = 0;
    let maxHistoryCount = 0;
    let rendererUpdates = 0;
    let lastRendererStep = -1;
    let reusableRgba = null;
    let reusableDepth = null;
    const memorySamples = [];
    const memoryErrors = [];
    const memoryPeriodSeconds = 300;
    let nextMemorySample = requestedMemory ? 0 : Infinity;
    const periodic = [];

    const forestState = () => {
      const forest = simulation.forest;
      const roots = Number(forest.rootCount ?? forest.rootNodes?.length ?? 0);
      const nodes = Number(forest.nodeCount ?? forest.nodes?.length ?? 0);
      const capacity = Number(forest.maxNodes ?? 0);
      return { roots, nodes, capacity, full: capacity > 0 && nodes >= capacity };
    };
    const currentState = (step, observation = latestObservation) => {
      const forest = forestState();
      const committed = simulation.committed;
      const ringState = (ring) => ({
        count: Number(ring?.count ?? 0),
        capacity: Number(ring?.capacity ?? 0),
        dataLength: Number(ring?.data?.length ?? 0),
        byteLength: Number(ring?.data?.byteLength ?? 0),
      });
      return {
        step,
        time: simulation.time,
        pose: [...simulation.pose],
        cameraYaw:simulation.cameraYaw,
        vision:observation?.metrics,
        budget:simulation.budget,
        estimate: [...simulation.estimate],
        shared: Number(observation?.metrics?.shared ?? observation?.shared ?? simulation.featuresTracked ?? 0),
        matches: Number(observation?.metrics?.matches ?? 0),
        corners: Number(observation?.metrics?.corners ?? 0),
        mapped: simulation.knowledge.mapCount,
        phase: simulation.phase,
        status: simulation.status,
        fault: simulation.fault,
        failure:simulation.failure,
        goalReached: simulation.successTime !== null,
        localizationError: Math.hypot(...(simulation.error || [0, 0])),
        trail: ringState(simulation.trail),
        history: ringState(simulation.history),
        nominalSwitch: committed?.switchDistance ?? null,
        nominalProgress: simulation.progress,
        root: committed?.rootId ?? simulation.orbit?.id ?? null,
        rootId: committed?.rootId ?? simulation.orbit?.id ?? null,
        fullForest: forest,
        forest,
        discovered: [...simulation.knowledge.discovered],
      };
    };
    const observeState = (step, observation = latestObservation, force = false, count = true) => {
      const state = currentState(step, observation);
      maxBudget = Math.max(maxBudget, Number.isFinite(state.budget) ? state.budget : 0);
      const home=simulation.world.landmarks[0],distance=Math.hypot(state.pose[0]-home.x,state.pose[1]-home.y);
      maxDistanceFromHome=Math.max(maxDistanceFromHome,distance);
      if(firstDepartureTime===null&&distance>simulation.knowledge.orbitRadius(home)+12)firstDepartureTime=simulation.time;
      maxError = Math.max(maxError,
        Number.isFinite(state.localizationError) ? state.localizationError : 0,
        Number.isFinite(simulation.peakError) ? simulation.peakError : 0);
      maxTrailCount = Math.max(maxTrailCount, state.trail.count);
      maxHistoryCount = Math.max(maxHistoryCount, state.history.count);
      if (count) {
        phaseCounts[state.phase] = (phaseCounts[state.phase] || 0) + 1;
        if (state.phase !== previousPhase) {
          phaseTransitions.push({ step, time: state.time, phase: state.phase });
          previousPhase = state.phase;
        }
        if (state.fault && state.fault !== previousFault) {
          faultCount += 1;
          previousFault = state.fault;
        }
        if (state.goalReached && !previousGoal) {
          goalCount += 1;
          previousGoal = true;
        }
      }
      maxMatches = Math.max(maxMatches, state.matches);
      maxShared = Math.max(maxShared, state.shared);
      maxCorners = Math.max(maxCorners, state.corners);
      maxMapCount = Math.max(maxMapCount, state.mapped);
      for (const id of state.discovered) if (!discoveries.includes(id)) discoveries.push(id);
      if (force || step % reportPeriod === 0) periodic.push(state);
      return state;
    };

    const updateRenderer = (step) => {
      renderer.update(simulation.snapshot());
      rendererUpdates += 1;
      lastRendererStep = step;
    };

    const sampleMemory = async (reason) => {
      if (!requestedMemory) return;
      try {
        // The launch flag exposes gc in Chromium.  The CDP callback performs a
        // second explicit collection and returns bounded heap counters even on
        // Chromium builds where performance.memory is unavailable.
        if (typeof globalThis.gc === 'function') globalThis.gc();
        const usage = typeof globalThis.__pixelMissionCollectMemory === 'function'
          ? await globalThis.__pixelMissionCollectMemory()
          : null;
        const browserMemory = usage || globalThis.performance?.memory || {};
        memorySamples.push({
          simulatedSeconds: simulation.time,
          reason,
          usedHeapBytes: Number(browserMemory.usedSize ?? browserMemory.usedJSHeapSize) || null,
          totalHeapBytes: Number(browserMemory.totalSize ?? browserMemory.totalJSHeapSize) || null,
          backingStorageBytes: Number(browserMemory.backingStorageSize) || null,
          embedderHeapUsedBytes: Number(browserMemory.embedderHeapUsedSize) || null,
          heapSizeLimitBytes: Number(browserMemory.jsHeapSizeLimit) || null,
        });
      } catch (error) {
        memoryErrors.push(String(error?.stack || error));
      }
    };

    const maybeSampleMemory = async () => {
      if (!requestedMemory) return;
      while (simulation.time >= nextMemorySample) {
        await sampleMemory(nextMemorySample === 0 ? 'initial' : 'interval');
        nextMemorySample += memoryPeriodSeconds;
      }
    };

    try {
      renderer.setWorld(simulation.world);
      const initialFrame = renderer.captureSensor(simulation.pose, simulation.cameraYaw);
      reusableRgba = initialFrame.rgba;
      reusableDepth = initialFrame.depth;
      latestObservation = vision.measure(initialFrame, simulation.pose, simulation.cameraYaw);
      simulation.acceptSensor(latestObservation);
      updateRenderer(0);
      observeState(0, latestObservation, true);
      await maybeSampleMemory();

      let completed = 0;
      for (let step = 1; step <= requestedSteps; step += 1) {
        const advanced = simulation.advance();
        completed = step;
        // advance() can fail while integrating the true pose, before a new
        // camera frame exists.  Do not capture or accept a stale frame after
        // that fault: doing so used to obscure the actual mission failure.
        if (!simulation.fault && !advanced) {
          throw new Error('Simulation advance returned false without setting a fault.');
        }
        if (!simulation.fault) {
          const frame = renderer.captureSensor(simulation.pose, simulation.cameraYaw, {
            rgba: reusableRgba,
            depth: reusableDepth,
          });
          reusableRgba = frame.rgba;
          reusableDepth = frame.depth;
          latestObservation = vision.measure(frame, simulation.pose, simulation.cameraYaw);
          simulation.acceptSensor(latestObservation);
        }
        if (simulation.fault || step % reportPeriod === 0) updateRenderer(step);
        observeState(step, latestObservation, Boolean(simulation.fault));
        await maybeSampleMemory();
        if (simulation.fault) break;
        if (step % reportPeriod === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const final = observeState(completed, latestObservation, true, false);
      if (lastRendererStep !== completed) updateRenderer(completed);
      await maybeSampleMemory();
      if (requestedMemory && (!memorySamples.length || memorySamples.at(-1).simulatedSeconds !== simulation.time)) {
        await sampleMemory('final');
      }
      const finalResources = renderer.getDiagnostics();
      const orbitStatus=simulation.world.landmarks.map(landmark=>{
        const radius=simulation.knowledge.orbitRadius(landmark);
        let unclearedSamples=0;
        for(let i=0;i<72;i++){
          const a=i/72*Math.PI*2;
          if(!simulation.knowledge.safe(landmark.x+radius*Math.cos(a),landmark.y+radius*Math.sin(a)))unclearedSamples++;
        }
        return {id:landmark.id,radius,active:simulation.active.has(landmark.id),certified:simulation.knowledge.certifyOrbit(landmark),unclearedSamples};
      });
      return {
        kind: 'pixel-mission-probe',
        mode: 'headless-render-loop',
        browser: 'chromium',
        angle: requestedAngle,
        worldId: simulation.world.id,
        seed: requestedSeed,
        config: simulation.config,
        requestedSteps,
        completedSteps: completed,
        reportPeriod,
        simulatedSeconds: simulation.time,
        phase: simulation.phase,
        status: simulation.status,
        fault: simulation.fault,
        error: simulation.fault,
        faultCount,
        goalCount,
        goalReached: simulation.successTime !== null,
        successTime: simulation.successTime,
        maxBudget,
        maxError,
        maxDistanceFromHome,firstDepartureTime,failure:simulation.failure,
        peakError: simulation.peakError,
        finalBudget: simulation.budget,
        maxTrailCount,
        maxHistoryCount,
        trail: { ...final.trail, maxCount: maxTrailCount, finalCount: final.trail.count },
        history: { ...final.history, maxCount: maxHistoryCount, finalCount: final.history.count },
        nodes: final.forest.nodes,
        roots: final.forest.roots,
        root: final.root,
        phaseCounts,
        phaseTransitions,
        maxMatches,
        maxShared,
        maxCorners,
        mapCount: simulation.knowledge.mapCount,
        maxMapCount,
        featureCount: simulation.knowledge.features.length,
        discovered: discoveries,
        orbitStatus,
        rendererUpdates,
        finalResources,
        memory: requestedMemory ? {
          samplePeriodSeconds: memoryPeriodSeconds,
          samples: memorySamples,
          errors: memoryErrors,
        } : null,
        final,
        periodic,
      };
    } finally {
      renderer.dispose();
    }
  }, {
    worldId,
    steps,
    seed,
    period,
    angle,
    config,
    memory: collectMemory,
  });
} catch (error) {
  report = {
    kind: 'pixel-mission-probe',
    mode: 'headless-render-loop',
    browser: 'chromium',
    angle,
    worldId,
    seed,
    config,
    requestedSteps: steps,
    completedSteps: 0,
    fault: null,
    error: String(error?.stack || error),
    goalReached: false,
    successTime: null,
    maxBudget: null,
    maxError: null,
    finalResources: null,
    memory: collectMemory ? { samplePeriodSeconds: 300, samples: [], errors: [] } : null,
  };
  process.exitCode = 1;
} finally {
  await browser.close();
}

const assertionErrors = [];
if (assertGoal && (report?.fault || report?.goalReached !== true)) {
  assertionErrors.push(report?.fault
    ? `goal assertion failed because the simulation faulted: ${report.fault}`
    : 'goal assertion failed because the mission did not reach its goal');
}
if (assertSafe && report?.fault) {
  assertionErrors.push(`safe assertion failed because the simulation faulted: ${report.fault}`);
}
if(assertFail&&!report?.fault)assertionErrors.push('failure assertion failed because no executed constraint violation occurred');
if (assertionErrors.length) {
  report.assertions = { assertGoal, assertSafe, assertFail, passed: false, errors: assertionErrors };
  process.exitCode = 1;
} else if (assertGoal || assertSafe || assertFail) {
  report.assertions = { assertGoal, assertSafe, assertFail, passed: true, errors: [] };
}

console.log(JSON.stringify(report, null, 2));
