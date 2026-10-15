import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIMITS } from '../../assets/budget-planning/simulation.js';

const worlds = ['farm', 'tucson', 'ann-arbor'];
const pixelMissionPath = fileURLToPath(new URL('./pixel-missions.mjs', import.meta.url));
const baseUrl = process.env.PIXEL_MISSION_BASE_URL || 'http://127.0.0.1:4180';
const memoryDeltaLimit = 2 * 1024 * 1024;

function envInteger(names, fallback, { minimum = 0 } = {}) {
  const name = names.find((candidate) => process.env[candidate] !== undefined);
  const raw = name ? process.env[name] : String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name || names[0]} must be an integer >= ${minimum}; received ${raw}`);
  }
  return value;
}

// The full goal check defaults to 9000 ticks (1800 simulated seconds). Set
// PIXEL_MISSION_GOAL_STEPS, or the shorter PIXEL_MISSION_STEPS alias, for a
// quick local check. PIXEL_MISSION_SAFE_STEPS and PIXEL_MISSION_PERIOD apply
// to the corresponding configurable portions of the suite.
const goalSteps = envInteger(['PIXEL_MISSION_GOAL_STEPS', 'PIXEL_MISSION_STEPS'], 9000, { minimum: 1 });
const safeSteps = envInteger(['PIXEL_MISSION_SAFE_STEPS'], 600, { minimum: 1 });
const reportPeriod = envInteger(['PIXEL_MISSION_PERIOD'], 100, { minimum: 1 });
const selectedWorlds = (process.env.PIXEL_MISSION_WORLDS || worlds.join(','))
  .split(',')
  .map((world) => world.trim())
  .filter(Boolean);
for (const world of selectedWorlds) {
  if (!worlds.includes(world)) throw new Error(`Unknown mission world: ${world}`);
}
if (!selectedWorlds.length) throw new Error('PIXEL_MISSION_WORLDS selected no worlds.');

function parseChildReport(stdout, stderr, world, mode) {
  const text = stdout.trim();
  if (!text) throw new Error(`${world} ${mode} emitted no JSON report: ${stderr.trim()}`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${world} ${mode} emitted invalid JSON: ${error.message}; stderr: ${stderr.trim()}`);
  }
}

function runPixelMission(world, mode, steps, extraArgs = []) {
  const args = [
    pixelMissionPath,
    '--world', world,
    '--steps', String(steps),
    '--period', String(reportPeriod),
    '--url', baseUrl,
    ...extraArgs,
  ];
  const child = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (child.error) throw new Error(`${world} ${mode} could not start: ${child.error.message}`);
  const report = parseChildReport(child.stdout, child.stderr, world, mode);
  if (child.signal) throw new Error(`${world} ${mode} terminated by ${child.signal}`);
  if (child.status !== 0) {
    throw new Error(`${world} ${mode} exited ${child.status}: ${report.error || report.fault || child.stderr.trim()}`);
  }
  return report;
}

function nodeCount(state) {
  const value = state?.forest?.nodes ?? state?.fullForest?.nodes;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function boundedSummary(report) {
  const periodicNodes = (report.periodic || []).map(nodeCount).filter((value) => value !== null);
  const observedNodes = Math.max(Number(report.nodes) || 0, ...periodicNodes);
  const observedFeatures = Math.max(Number(report.featureCount) || 0, Number(report.maxMapCount) || 0);
  const trail = report.trail;
  const history = report.history;
  assert.ok(trail && history, 'pixel report did not include ring-buffer metrics');
  for (const [name, ring, limit] of [['trail', trail, LIMITS.trail], ['history', history, LIMITS.history]]) {
    assert.equal(ring.capacity, limit, `${name} capacity changed from the configured limit`);
    assert.equal(ring.dataLength, ring.capacity * 4, `${name} backing data length is not capacity × width`);
    assert.equal(ring.byteLength, ring.dataLength * Float32Array.BYTES_PER_ELEMENT, `${name} backing byte length is incorrect`);
    assert.ok(Number.isInteger(ring.maxCount ?? report[`max${name[0].toUpperCase()}${name.slice(1)}Count`]), `${name} max count is not an integer`);
    assert.ok(ring.maxCount <= ring.capacity, `${name} max count exceeded its capacity`);
  }
  const observedTrail = trail.maxCount;
  const observedHistory = history.maxCount;
  return {
    features: { observedMax: observedFeatures, limit: LIMITS.features, passed: observedFeatures <= LIMITS.features },
    nodes: { observedMax: observedNodes, limit: LIMITS.nodes, passed: observedNodes <= LIMITS.nodes },
    trails: {
      observedMax: observedTrail,
      limit: LIMITS.trail,
      backingDataLength: trail.dataLength,
      backingByteLength: trail.byteLength,
      passed: observedTrail <= LIMITS.trail,
    },
    history: {
      observedMax: observedHistory,
      limit: LIMITS.history,
      backingDataLength: history.dataLength,
      backingByteLength: history.byteLength,
      passed: observedHistory <= LIMITS.history,
    },
  };
}

function memorySummary(report, required) {
  if (!required) return null;
  const memory = report.memory;
  assert.ok(memory, 'pixel report did not include requested memory statistics');
  assert.deepEqual(memory.errors || [], [], 'pixel memory collection reported errors');
  const samples = Array.isArray(memory.samples) ? memory.samples : [];
  const allUsed = samples.map((sample) => Number(sample.usedHeapBytes));
  assert.ok(allUsed.length > 0, 'expected at least one memory sample');
  assert.ok(allUsed.every((value) => Number.isFinite(value) && value > 0), 'memory usedHeapBytes must be positive finite numbers');
  const intervals = samples.filter((sample) => sample.reason === 'interval');
  const used = intervals.map((sample) => Number(sample.usedHeapBytes));
  if (used.length < 2) {
    return {
      samplePeriodSeconds: memory.samplePeriodSeconds,
      sampleCount: samples.length,
      postWarmupSampleCount: intervals.length,
      retainedHeapDeltaBytes: null,
      retainedHeapDeltaLimitBytes: memoryDeltaLimit,
      compared: false,
      passed: true,
      reason: 'quick run did not reach two post-warmup samples',
    };
  }
  assert.ok(used.every((value) => Number.isFinite(value) && value > 0), 'post-warmup memory samples must contain positive finite used heap bytes');
  const firstPostWarmup = used[0];
  const lastPostWarmup = used.at(-1);
  const retainedHeapDeltaBytes = lastPostWarmup - firstPostWarmup;
  assert.ok(
    retainedHeapDeltaBytes <= memoryDeltaLimit,
    `retained browser heap grew ${retainedHeapDeltaBytes} bytes after warmup (limit ${memoryDeltaLimit})`,
  );
  return {
    samplePeriodSeconds: memory.samplePeriodSeconds,
    sampleCount: samples.length,
    postWarmupSampleCount: intervals.length,
    firstPostWarmupUsedHeapBytes: firstPostWarmup,
    lastPostWarmupUsedHeapBytes: lastPostWarmup,
    retainedHeapDeltaBytes,
    retainedHeapDeltaLimitBytes: memoryDeltaLimit,
    passed: true,
  };
}

function assertMission(report, world, mode, steps, requiresGoal, requiresMemory) {
  assert.equal(report.kind, 'pixel-mission-probe', `${world} ${mode}: unexpected child report kind`);
  assert.equal(report.worldId, world, `${world} ${mode}: child reported the wrong world`);
  assert.equal(report.requestedSteps, steps, `${world} ${mode}: child reported the wrong step count`);
  assert.equal(report.fault, null, `${world} ${mode}: ${report.fault || report.error || 'unexpected fault'}`);
  assert.equal(report.error, null, `${world} ${mode}: ${report.error}`);
  if (requiresGoal) {
    assert.equal(report.goalReached, true, `${world}: goal was not reached`);
    assert.equal(report.successTime !== null, true, `${world}: successTime was not recorded`);
    assert.ok(Number(report.successTime) <= Number(report.simulatedSeconds), `${world}: successTime is after the run`);
    assert.equal(report.assertions?.passed, true, `${world}: --assert-goal did not pass`);
    if (world === 'tucson') {
      assert.ok(report.successTime <= 240, 'Tucson default mission should reach the goal within four simulated minutes');
      assert.ok(report.phaseCounts.backup >= 50, 'Tucson should execute at least ten simulated seconds of verified backup flight');
      assert.ok(report.orbitStatus.some(orbit => orbit.id === 'tucson-overlook' && orbit.active), 'Tucson should discover and certify the northern trailhead online');
    }
  } else {
    assert.equal(report.assertions?.passed, true, `${world}: --assert-safe did not pass`);
  }

  const bounded = boundedSummary(report);
  for (const [name, result] of Object.entries(bounded)) {
    assert.equal(result.passed, true, `${world} ${mode}: ${name} exceeded its bound`);
  }

  let nodeGrowthAfterGoal = null;
  if (requiresGoal) {
    const successTime = Number(report.successTime);
    const postGoalNodes = (report.periodic || [])
      .filter((sample) => Number(sample.time) >= successTime)
      .map(nodeCount)
      .filter((value) => value !== null);
    assert.ok(postGoalNodes.length >= 2, `${world}: periodic report lacks post-goal node samples`);
    const firstPostGoalNodes = postGoalNodes[0];
    const lastPostGoalNodes = postGoalNodes.at(-1);
    assert.equal(lastPostGoalNodes, firstPostGoalNodes, `${world}: forest grew after goal completion`);
    nodeGrowthAfterGoal = {
      sampleCount: postGoalNodes.length,
      firstPostGoalNodes,
      lastPostGoalNodes,
      stopped: true,
    };
  }

  return {
    world,
    mode,
    requestedSteps: report.requestedSteps,
    completedSteps: report.completedSteps,
    simulatedSeconds: report.simulatedSeconds,
    successTime: report.successTime,
    backupSeconds: (report.phaseCounts.backup || 0) * 0.2,
    goalReached: report.goalReached,
    fault: report.fault,
    error: report.error,
    maxBudget: report.maxBudget,
    maxError: report.maxError,
    peakError: report.peakError,
    maxFeatures: Math.max(Number(report.featureCount) || 0, Number(report.maxMapCount) || 0),
    maxNodes: Math.max(Number(report.nodes) || 0, ...(report.periodic || []).map(nodeCount).filter((value) => value !== null)),
    bounded,
    nodeGrowthAfterGoal,
    rendererUpdates: report.rendererUpdates,
    finalResources: report.finalResources,
    memory: memorySummary(report, requiresMemory),
  };
}

const summaries = [];
const errors = [];

for (const world of selectedWorlds) {
  try {
    const report = runPixelMission(world, 'goal', goalSteps, ['--memory', '--assert-goal']);
    summaries.push(assertMission(report, world, 'goal', goalSteps, true, true));
  } catch (error) {
    errors.push(String(error?.stack || error));
  }
}

for (const world of selectedWorlds) {
  try {
    const report = runPixelMission(world, 'safe-budget-1', safeSteps, ['--budget', '1', '--assert-safe']);
    summaries.push(assertMission(report, world, 'safe-budget-1', safeSteps, false, false));
  } catch (error) {
    errors.push(String(error?.stack || error));
  }
}

const output = {
  kind: 'pixel-mission-suite',
  mode: 'sequential-browser-child-processes',
  baseUrl,
  worlds: selectedWorlds,
  goal: {
    steps: goalSteps,
    simulatedSeconds: goalSteps * 0.2,
    reportPeriod,
    memory: true,
    assertGoal: true,
  },
  safeBudgetOne: {
    steps: safeSteps,
    simulatedSeconds: safeSteps * 0.2,
    reportPeriod,
    budget: 1,
    assertSafe: true,
  },
  limits: {
    features: LIMITS.features,
    nodes: LIMITS.nodes,
    trails: LIMITS.trail,
    history: LIMITS.history,
    retainedHeapDeltaBytes: memoryDeltaLimit,
  },
  summaries,
  errors,
  passed: errors.length === 0 && summaries.length === selectedWorlds.length * 2,
};

if (!output.passed) process.exitCode = 1;
console.log(JSON.stringify(output, null, 2));
