import test from 'node:test';
import assert from 'node:assert/strict';

import { gatekeeper, ReRoot } from '../../assets/budget-planning/planner.js';
import { pathLength, samplePath, shortestPath } from '../../assets/budget-planning/dubins.js';
import { Simulation } from '../../assets/budget-planning/simulation.js';

const close = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

const pathJoins = (paths) => {
  for (let index = 1; index < paths.length; index += 1) {
    close(paths[index - 1].end[0], paths[index].start[0]);
    close(paths[index - 1].end[1], paths[index].start[1]);
    close(paths[index - 1].end[2], paths[index].start[2]);
  }
};

test('reverse RRT* rewires child-to-parent edges and repairs cached costs without cycles', () => {
  const forest = new ReRoot({
    radius: 1,
    seed: 3,
    maxNodes: 100,
    edgeCheck: (path) => ({ safe: true, cost: path.length }),
  });
  const roots = forest.addOrbit({ id: 'orbit', x: 0, y: 0, radius: 1 });
  assert.equal(roots.length, 4);
  assert.equal(forest.grow([0, 0], 8, 60), 60);

  let rewired = false;
  for (const node of forest.nodes) {
    if (node.root) continue;
    const parent = forest.nodes[node.parentIndex];
    assert.ok(parent);
    close(node.totalCost, parent.totalCost + node.edgeCost);
    if (node.parentIndex !== node.index - 1) rewired = true;

    const seen = new Set();
    let index = node.index;
    while (index >= 0) {
      assert.ok(!seen.has(index), 'forest contains a parent cycle');
      seen.add(index);
      index = forest.nodes[index].parentIndex;
    }
  }
  assert.ok(rewired, 'growth should exercise the rewiring branch');
});

test('reverse steering keeps the clipped analytic edge local and curve-samples its topology', () => {
  const forest = new ReRoot({
    radius: 10,
    seed: 1337,
    maxNodes: 64,
    edgeCheck: (path) => ({ safe: true, cost: path.length }),
  });
  forest.addOrbit({ id: 'orbit', x: 0, y: 0, radius: 10 });
  assert.equal(forest.grow([160, 115], 240, 1), 1);

  const node = forest.nodes.find((candidate) => candidate && !candidate.root && candidate.valid);
  assert.ok(node);
  const parent = forest.nodes[node.parentIndex];
  assert.ok(parent);
  // The original steer() takes at most 1.1 turning radii from the nearest
  // node.  The stored edge is the executable child -> parent direction.
  assert.ok(node.edgePath.length <= 11 + 1e-7, `edge grew to ${node.edgePath.length}`);
  assert.deepEqual(node.edgePath.start, node.pose);
  assert.deepEqual(node.edgePath.end, parent.pose);

  // getEdges() must expose samples of the analytic curve itself, including a
  // turn when the selected Dubins word is not straight.
  const edges = forest.getEdges();
  const expectedStart = samplePath(node.edgePath, 0);
  assert.ok(expectedStart);
  assert.ok(edges.length >= 4);
  close(edges[0], expectedStart[0], 1e-5);
  close(edges[1], expectedStart[1], 1e-5);
  const segmentCount = Math.min(32, Math.max(1, Math.ceil(node.edgePath.length / 3)));
  const expectedFirstEnd = samplePath(node.edgePath, node.edgePath.length / segmentCount);
  assert.ok(expectedFirstEnd);
  close(edges[2], expectedFirstEnd[0], 1e-5);
  close(edges[3], expectedFirstEnd[1], 1e-5);
  assert.ok(node.edgePath.types.some((type, index) => type !== 'S' && node.edgePath.lengths[index] > 1e-7));
});

test('growth does not let a remote root bypass the local near set', () => {
  const forest = new ReRoot({
    radius: 10,
    seed: 1337,
    maxNodes: 64,
    edgeCheck: () => ({ safe: true, cost: 0 }),
  });
  forest.addOrbit({ id: 'far', x: 0, y: 0, radius: 10 });
  forest.addOrbit({ id: 'near', x: 190, y: 120, radius: 10 });
  assert.equal(forest.grow([160, 115], 240, 1), 1);

  const node = forest.nodes.find((candidate) => candidate && !candidate.root && candidate.valid);
  assert.ok(node);
  const parent = forest.nodes[node.parentIndex];
  assert.ok(parent);
  assert.equal(parent.rootId, 'near');
  assert.ok(Math.hypot(node.pose[0] - parent.pose[0], node.pose[1] - parent.pose[1]) <= 20 + 1e-7);
});

test('root slots are bounded, and query returns a forward child-to-orbit path', () => {
  const forest = new ReRoot({ radius: 1, seed: 4, maxNodes: 32 });
  for (let index = 0; index < 8; index += 1) {
    forest.addOrbit({ id: `orbit-${index}`, x: index * 3, y: 0, radius: 1 });
  }
  assert.equal(forest.rootCount, 16);
  assert.ok(forest.nodes.length <= 32);
  assert.deepEqual(forest.addOrbit({ id: 'too-late', x: 100, y: 100, radius: 1 }), []);

  forest.grow([0, 0], 4, 4);
  const node = forest.nodes.find((candidate) => !candidate.root && candidate.valid);
  assert.ok(node);
  const result = forest.query(node.pose);
  assert.ok(result);
  assert.equal(result.rootId, node.rootId);
  assert.ok(result.paths.length >= 1);
  close(result.paths[0].start[0], node.pose[0]);
  close(result.paths[0].start[1], node.pose[1]);
  pathJoins(result.paths);
});

test('query breaks equal-cost ties by the shortest executable path', () => {
  const forest = new ReRoot({
    radius: 1,
    maxNodes: 32,
    rootReserve: 8,
    edgeCheck: () => ({ safe: true, cost: 0 }),
  });
  const farRoots = forest.addOrbit({ id: 'far', x: 10, y: 0, radius: 1 });
  const nearRoots = forest.addOrbit({ id: 'near', x: 2, y: 0, radius: 1 });
  const start = [0, 0, 0];
  const shortest = (roots) => Math.min(...roots.map((root) => pathLength(shortestPath(start, root.pose, forest.radius))));
  const farLength = shortest(farRoots);
  const nearLength = shortest(nearRoots);
  assert.ok(nearLength < farLength);

  const result = forest.query(start);
  assert.ok(result);
  assert.equal(result.cost, 0);
  assert.equal(result.rootId, 'near');
  assert.ok(Math.abs(pathLength(result.paths) - nearLength) <= 1e-7);
});

test('twenty configured landmark roots fit inside the 4000-node planner cap', () => {
  const simulation = new Simulation('ann-arbor');
  assert.equal(simulation.forest.rootReserve, simulation.world.landmarks.length * 4);
  assert.equal(simulation.forest.rootReserve, 20);

  const forest = new ReRoot({ radius: 1, seed: 4, maxNodes: 4000, rootReserve: 20 });
  for (let index = 0; index < 5; index += 1) {
    forest.addOrbit({ id: `landmark-${index}`, x: index * 3, y: 0, radius: 1 });
  }
  assert.equal(forest.rootCount, 20);
  assert.equal(forest.nodeCapacity, 3980);

  forest.grow([0, 0], 300, 4000);
  assert.equal(forest.rootCount, 20);
  assert.equal(forest.nodeCount, 4000);
  assert.ok(forest.nodeCount <= forest.maxNodes);
});

test('revalidate invalidates a changed map branch and leaves no unsafe rendering edge', () => {
  let blocked = false;
  const forest = new ReRoot({
    radius: 1,
    seed: 8,
    maxNodes: 40,
    edgeCheck: (path) => ({ safe: !blocked, cost: path.length }),
  });
  forest.addOrbit({ id: 'orbit', x: 0, y: 0, radius: 1 });
  forest.grow([0, 0], 4, 8);
  assert.ok(forest.nodes.some((node) => !node.root));
  blocked = true;
  const report = forest.revalidate();
  assert.ok(report.invalid > 0);
  assert.equal(forest.query([2, 0, 0]), null);
  assert.equal(forest.getEdges().length, 0);
});

test('gatekeeper retains previous trajectory on rejection and selects the largest valid prefix', () => {
  const forest = {
    query: () => ({ paths: [], cost: 0, rootId: 'orbit' }),
  };
  const nominal = [shortestPath([0, 0, 0], [6, 0, 0], 1)];
  const previous = { nominalPaths: ['previous'], backupPaths: [], switchDistance: 0, mapVersion: 1 };
  const attempted = [];
  const accepted = gatekeeper({
    pose: [0, 0, 0],
    nominalPaths: nominal,
    forest,
    budgetUsed: 2,
    budgetLimit: 20,
    speed: 1,
    dt: 0.2,
    mapVersion: 7,
    validate: (paths, initialBudget) => {
      assert.equal(initialBudget, 2);
      const length = pathLength(paths);
      attempted.push(length);
      return { safe: length <= 4, peakBudget: 5, endBudget: 3, cost: length };
    },
    previous,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.trajectory.mapVersion, 7);
  assert.equal(accepted.trajectory.switchDistance, Math.max(...attempted.filter((length) => length <= 4 + 1e-7)));
  assert.ok(accepted.trajectory.switchDistance <= 4 + 1e-7);

  const rejected = gatekeeper({
    pose: [0, 0, 0],
    nominalPaths: nominal,
    forest,
    budgetUsed: 2,
    budgetLimit: 2,
    speed: 1,
    dt: 0.2,
    validate: () => ({ safe: false, peakBudget: Infinity, endBudget: Infinity, cost: Infinity }),
    previous,
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.trajectory, previous);
});
