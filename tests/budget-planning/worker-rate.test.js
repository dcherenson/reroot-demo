import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const workerSource = fs.readFileSync(new URL('../../assets/budget-planning/worker.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '');

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = [];
  }

  setTimeout(callback, delay = 0) {
    const id = this.nextId++;
    const numericDelay = Number(delay);
    this.tasks.push({
      id,
      due: this.now + (Number.isFinite(numericDelay) ? Math.max(0, numericDelay) : 0),
      order: id,
      callback,
    });
    return id;
  }

  clearTimeout(id) {
    this.tasks = this.tasks.filter((task) => task.id !== id);
  }

  runNext() {
    this.tasks.sort((left, right) => left.due - right.due || left.order - right.order);
    const task = this.tasks.shift();
    if (!task) return false;
    this.now = task.due;
    task.callback();
    return true;
  }

  advanceTo(time) {
    assert.ok(time >= this.now, `clock cannot move backwards from ${this.now} to ${time}`);
    this.now = time;
  }

  nextDelay() {
    this.tasks.sort((left, right) => left.due - right.due || left.order - right.order);
    return this.tasks.length ? this.tasks[0].due - this.now : null;
  }

  get pendingCount() {
    return this.tasks.length;
  }
}

function createHarness({ faultAfterAdvance = false } = {}) {
  const clock = new FakeClock();
  const messages = [];
  let simulation = null;

  class FakeSimulation {
    constructor(worldId, config, seed, options) {
      this.world = { id: worldId };
      this.config = config || {};
      this.seed = seed;
      this.options = options;
      this.pose = [0, 0, 0];
      this.cameraYaw = 0;
      this.time = 0;
      this.advanceCount = 0;
      this.sensorCount = 0;
      this.fault = null;
      simulation = this;
    }

    advance() {
      this.advanceCount += 1;
      this.time += 0.2;
      if (faultAfterAdvance) this.fault = 'synthetic fault';
    }

    acceptSensor() {
      this.sensorCount += 1;
    }

    snapshot() {
      return {
        pose: [...this.pose],
        estimate: [...this.pose],
        cameraYaw: this.cameraYaw,
        time: this.time,
        fault: this.fault,
      };
    }
  }

  class FakeLiveFeatureMap {
    constructor() {}

    measure() {
      return { shared: 1 };
    }
  }

  const context = {
    Simulation: FakeSimulation,
    LiveFeatureMap: FakeLiveFeatureMap,
    performance: { now: () => clock.now },
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimeout.bind(clock),
    postMessage: (message, transfers) => messages.push({ message, transfers }),
    console,
  };
  vm.runInNewContext(workerSource, context, { filename: 'worker.js' });

  const send = (data) => context.onmessage({ data });
  const latest = (type) => {
    const result = [...messages].reverse().find(({ message }) => message.type === type);
    return result?.message;
  };
  const completeSensor = (runId) => {
    const sensor = latest('sensor');
    assert.ok(sensor, 'worker should request a sensor frame');
    const rgba = new Uint8Array([1, 2, 3, 4]);
    const depth = new Float32Array([1]);
    send({
      type: 'sensor-frame',
      runId,
      requestId: sensor.requestId,
      frame: { rgba, depth },
    });
    return latest('snapshot')?.snapshot;
  };
  const acknowledge = (runId, snapshot = latest('snapshot')?.snapshot) => {
    assert.ok(snapshot, 'worker should publish a snapshot');
    send({ type: 'ack', runId, sequence: snapshot.sequence, buffers: {} });
  };
  const init = ({ runId = 1, simulationRate, playing = true } = {}) => {
    send({ type: 'init', runId, worldId: 'test', config: {}, seed: 1, playing, simulationRate });
    const snapshot = completeSensor(runId);
    acknowledge(runId, snapshot);
  };

  return {
    clock,
    messages,
    send,
    latest,
    completeSensor,
    acknowledge,
    init,
    get simulation() {
      return simulation;
    },
  };
}

test('simulation rate clamps safely and changes the outstanding wall-clock delay', () => {
  const harness = createHarness();
  harness.init({ runId: 7, simulationRate: 20 });

  // The initial sensor response is acknowledged before the first tick. An
  // initialization rate above the supported range is clamped to 10x.
  assert.equal(harness.clock.nextDelay(), 0);
  harness.clock.runNext();
  assert.equal(harness.simulation.advanceCount, 1);
  const first = harness.completeSensor(7);

  // Rate changes while the snapshot is awaiting its ACK update the due time
  // for the same cycle, without advancing or requesting another frame.
  harness.send({ type: 'simulation-rate', runId: 7, simulationRate: 4 });
  harness.acknowledge(7, first);
  assert.equal(harness.clock.nextDelay(), 50);

  harness.clock.advanceTo(10);
  harness.send({ type: 'simulation-rate', runId: 7, simulationRate: 2 });
  assert.equal(harness.clock.nextDelay(), 90);
  assert.equal(harness.simulation.advanceCount, 1);

  harness.clock.runNext();
  assert.equal(harness.clock.now, 100);
  assert.equal(harness.simulation.advanceCount, 2);
  assert.equal(harness.clock.pendingCount, 0, 'sensor work backpressures the next tick');
});

test('invalid and nonfinite init rates default to 5, while live updates and values below 1 clamp to 1', () => {
  const invalidInitRates = [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'not-a-rate'];
  for (const [index, simulationRate] of invalidInitRates.entries()) {
    const harness = createHarness();
    const runId = 30 + index;
    harness.init({ runId, simulationRate });
    harness.clock.runNext();
    const snapshot = harness.completeSensor(runId);
    harness.acknowledge(runId, snapshot);
    assert.equal(harness.clock.nextDelay(), 40, `invalid init rate ${String(simulationRate)} should use 5x`);
  }

  const harness = createHarness();
  harness.init({ runId: 40, simulationRate: 10 });
  harness.clock.runNext();
  const snapshot = harness.completeSensor(40);
  harness.send({ type: 'simulation-rate', runId: 40, simulationRate: Number.NaN });
  harness.acknowledge(40, snapshot);
  assert.equal(harness.clock.nextDelay(), 200, 'invalid runtime rate should use 1x');

  const belowMinimum = createHarness();
  belowMinimum.init({ runId: 41, simulationRate: 0 });
  belowMinimum.clock.runNext();
  const belowSnapshot = belowMinimum.completeSensor(41);
  belowMinimum.acknowledge(41, belowSnapshot);
  assert.equal(belowMinimum.clock.nextDelay(), 200, 'zero init rate should clamp to 1x');

  belowMinimum.clock.runNext();
  const nextSnapshot = belowMinimum.completeSensor(41);
  belowMinimum.send({ type: 'simulation-rate', runId: 41, simulationRate: -5 });
  belowMinimum.acknowledge(41, nextSnapshot);
  assert.equal(belowMinimum.clock.nextDelay(), 200, 'negative runtime rate should clamp to 1x');
});

test('changing rate while a sensor frame is pending never advances or queues another tick', () => {
  const harness = createHarness();
  harness.init({ runId: 50 });
  harness.clock.runNext();
  assert.equal(harness.simulation.advanceCount, 1);
  assert.equal(harness.clock.pendingCount, 0);

  harness.send({ type: 'simulation-rate', runId: 50, simulationRate: 10 });
  harness.clock.advanceTo(1000);
  assert.equal(harness.simulation.advanceCount, 1, 'a slow sensor response cannot be overtaken');
  assert.equal(harness.clock.pendingCount, 0, 'pending sensor work keeps the timer disarmed');

  const snapshot = harness.completeSensor(50);
  assert.equal(harness.clock.pendingCount, 0, 'validation and snapshot publication still block ticks');
  harness.acknowledge(50, snapshot);
  assert.equal(harness.clock.nextDelay(), 0, 'the new rate is applied immediately after the late frame');
  harness.clock.runNext();
  assert.equal(harness.simulation.advanceCount, 2);
});

test('late sensor and ACK completion produce one immediate tick and a fresh cadence', () => {
  const harness = createHarness();
  harness.init({ runId: 60, simulationRate: 1 });
  harness.clock.runNext();
  assert.equal(harness.simulation.advanceCount, 1);

  // Let both the 200 ms target and the sensor response deadline pass. No
  // catch-up timer exists while the frame is pending.
  harness.clock.advanceTo(250);
  const first = harness.completeSensor(60);
  assert.equal(harness.clock.pendingCount, 0);
  harness.clock.advanceTo(500);
  harness.acknowledge(60, first);
  assert.equal(harness.clock.nextDelay(), 0);

  // Exactly one overdue step runs. It starts a new 200 ms cadence from 500 ms.
  harness.clock.runNext();
  assert.equal(harness.clock.now, 500);
  assert.equal(harness.simulation.advanceCount, 2);
  assert.equal(harness.clock.pendingCount, 0);
  const second = harness.completeSensor(60);
  harness.acknowledge(60, second);
  assert.equal(harness.clock.nextDelay(), 200, 'the post-overrun cadence starts from the fresh tick');
});

test('changing rate while paused does not resume the simulation', () => {
  const harness = createHarness();
  harness.init({ runId: 70 });
  harness.send({ type: 'play', runId: 70, playing: false });
  assert.equal(harness.clock.pendingCount, 0);

  harness.send({ type: 'simulation-rate', runId: 70, simulationRate: 10 });
  harness.clock.advanceTo(1000);
  assert.equal(harness.clock.pendingCount, 0);
  assert.equal(harness.simulation.advanceCount, 0);

  harness.send({ type: 'play', runId: 70, playing: true });
  assert.equal(harness.clock.pendingCount, 1, 'only an explicit play resumes the worker');
  harness.clock.runNext();
  const snapshot = harness.completeSensor(70);
  harness.acknowledge(70, snapshot);
  assert.equal(harness.clock.nextDelay(), 20, 'the paused rate applies after explicit resume');
});

test('sensor and snapshot backpressure, pause, and stale messages never queue work', () => {
  const harness = createHarness();
  harness.init({ runId: 3, playing: false, simulationRate: 1 });
  assert.equal(harness.clock.pendingCount, 0);

  // Resume schedules exactly one immediate tick, while a duplicate or stale
  // sensor response is ignored.
  harness.send({ type: 'play', runId: 3, playing: true });
  assert.equal(harness.clock.pendingCount, 1);
  harness.clock.runNext();
  const sensor = harness.latest('sensor');
  harness.send({ type: 'sensor-frame', runId: 99, requestId: sensor.requestId, frame: {} });
  assert.equal(harness.simulation.advanceCount, 1);
  assert.equal(harness.clock.pendingCount, 0);

  const snapshot = harness.completeSensor(3);
  assert.equal(harness.clock.pendingCount, 0, 'no timer is armed before the snapshot ACK');
  harness.send({ type: 'play', runId: 3, playing: false });
  harness.acknowledge(3, snapshot);
  assert.equal(harness.clock.pendingCount, 0, 'pause cancels the outstanding delay');

  // A stale rate update cannot alter the paused run. Resuming still starts a
  // single tick immediately, and its next interval remains the explicit 1x
  // cadence of 200ms.
  harness.send({ type: 'simulation-rate', runId: 2, simulationRate: 10 });
  harness.send({ type: 'play', runId: 3, playing: true });
  assert.equal(harness.clock.pendingCount, 1);
  harness.clock.runNext();
  const second = harness.completeSensor(3);
  harness.acknowledge(3, second);
  assert.equal(harness.clock.nextDelay(), 200);
  assert.equal(harness.simulation.advanceCount, 2);
});

test('faulted runs publish once and refuse subsequent play or timer work', () => {
  const harness = createHarness({ faultAfterAdvance: true });
  harness.init({ runId: 11 });
  harness.clock.runNext();

  const snapshot = harness.latest('snapshot').snapshot;
  assert.equal(harness.simulation.advanceCount, 1);
  assert.equal(snapshot.fault, 'synthetic fault');
  assert.equal(harness.messages.filter(({ message }) => message.type === 'sensor').length, 1);
  assert.equal(harness.clock.pendingCount, 0);

  harness.acknowledge(11, snapshot);
  harness.send({ type: 'play', runId: 11, playing: true });
  assert.equal(harness.clock.pendingCount, 0);
  assert.equal(harness.simulation.advanceCount, 1);
});

function runCycles(simulationRate, count) {
  const harness = createHarness();
  harness.init({ runId: 21, simulationRate });
  for (let index = 0; index < count; index += 1) {
    assert.equal(harness.clock.runNext(), true);
    const snapshot = harness.completeSensor(21);
    harness.acknowledge(21, snapshot);
  }
  return { time: harness.simulation.time, advances: harness.simulation.advanceCount, clock: harness.clock.now };
}

test('rate changes wall-clock cadence while keeping fixed simulation steps', () => {
  const normal = runCycles(1, 4);
  const fast = runCycles(10, 4);
  assert.equal(normal.advances, 4);
  assert.equal(fast.advances, 4);
  assert.equal(normal.time, 0.8);
  assert.equal(fast.time, 0.8);
  assert.equal(normal.clock, 600);
  assert.equal(fast.clock, 60);
});
