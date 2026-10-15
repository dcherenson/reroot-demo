import test from 'node:test';
import assert from 'node:assert/strict';

import {
  angleDiff,
  curvatureAt,
  curvatureOnPaths,
  distance,
  integrate,
  pathLength,
  prefixPaths,
  samplePath,
  samplePaths,
  seededRandom,
  shortestPath,
  wrapAngle,
} from '../../assets/budget-planning/dubins.js';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

const poseClose = (actual, expected, tolerance = 1e-8) => {
  close(actual[0], expected[0], tolerance);
  close(actual[1], expected[1], tolerance);
  close(angleDiff(actual[2], expected[2]), 0, tolerance);
};

test('angle, distance, and seeded-random helpers are bounded and deterministic', () => {
  close(wrapAngle(0), 0);
  close(wrapAngle(Math.PI), Math.PI);
  close(wrapAngle(-Math.PI), -Math.PI);
  close(wrapAngle(3 * Math.PI), Math.PI);
  close(angleDiff(3 * Math.PI / 4, -3 * Math.PI / 4), Math.PI / 2);
  close(distance([0, 0], [3, 4]), 5);

  const first = seededRandom('dubins-test');
  const second = seededRandom('dubins-test');
  for (let index = 0; index < 32; index += 1) {
    const a = first();
    const b = second();
    assert.equal(a, b);
    assert.ok(a >= 0 && a < 1);
  }
});

test('shortestPath supports all six Dubins words and closes at the requested pose', () => {
  const fixtures = [
    [[9.381905472837389, 0.0687075313180685, -0.26200953939471167], [-4.9988837307319045, 1.9003992155194283, 3.0230428794929973], 'RSL'],
    [[3.1346430303528905, 1.333694108761847, 2.510998863353], [-7.191021838225424, -2.495265849865973, -1.0271110456977803], 'LSL'],
    [[-2.5602126820012927, 4.436982818879187, 0.8831278102752326], [-5.780429216101766, -3.3726642886176705, 1.8457745793714246], 'RSR'],
    [[-7.474992424249649, 8.872129116207361, 2.9745566775394954], [1.2029259698465466, -4.8642746871337295, 3.015433047358658], 'LSR'],
    [[-2.567767007276416, -6.450692159123719, 0.27137551251937214], [-0.2764589013531804, -5.657965014688671, 3.0269359517350827], 'RLR'],
    [[-7.488454468548298, 7.786741587333381, -0.033659922208010576], [-7.088459394872189, 7.716200482100248, 1.2468361346782635], 'LRL'],
  ];

  for (const [start, end, word] of fixtures) {
    const path = shortestPath(start, end, 1.5);
    assert.ok(path);
    assert.equal(path.types.join(''), word);
    assert.equal(path.types.length, 3);
    assert.equal(path.lengths.length, 3);
    close(path.length, path.lengths.reduce((sum, value) => sum + value, 0));
    assert.ok(path.length >= 0);
    poseClose(samplePath(path, 0), start);
    poseClose(samplePath(path, path.length), end);
    for (let distanceAlongPath = 0; distanceAlongPath <= path.length; distanceAlongPath += path.length / 7 || 1) {
      assert.ok(Math.abs(curvatureAt(path, distanceAlongPath)) <= 1 / path.radius + 1e-12);
    }
  }
});

test('analytic paths agree with Julia Dubins reference fixtures', () => {
  // Reference values were generated read-only with the installed Julia
  // Dubins package in ../budget-constrained-planning:
  // julia --project=../budget-constrained-planning
  // The literals keep this browser test dependency-free and deterministic.
  const fixtures = [
    {
      start: [30, 130, -Math.PI / 2],
      end: [230, 175, 1.2 * Math.PI / 2],
      radius: 10,
      word: 'LSL',
      length: 219.84883021928468,
      lengths: [17.989541388184204, 185.291311029797, 16.56797780130352],
      samples: [
        [50, [73.44273322825902, 127.49938912217998, 0.2281578120235237]],
        [100, [122.14696923207889, 138.80856218143663, 0.2281578120235237]],
        [200, [219.55544123971862, 161.42690829994996, 0.2281578120235237]],
      ],
    },
    {
      start: [0, 0, 0],
      end: [100, 0, 0],
      radius: 10,
      word: 'LSL',
      length: 100,
      lengths: [0, 100, 0],
      samples: [[50, [50, 0, 0]]],
    },
    {
      start: [2, -3, 7 * Math.PI / 2],
      end: [-9, 4, -5 * Math.PI / 2],
      radius: 3,
      word: 'RSL',
      length: 25.923771033584675,
      lengths: [9.879678515307843, 6.164414002968985, 9.879678515307845],
      samples: [
        [5, [-1.287170644043126, -5.986223873255294, 3.045722313718023]],
        [10, [-3.9474020125776983, -2.4278998025420178, 1.419162808615409]],
        [15, [-3.1921364730401907, 2.5147284421054703, 1.419162808615409]],
      ],
    },
    {
      start: [-3, 4, Math.PI / 3],
      end: [8, -2, -Math.PI / 2],
      radius: 2.5,
      word: 'RSR',
      length: 14.462933945836644,
      lengths: [4.226442943075598, 7.917949250857911, 2.3185417519031364],
      samples: [
        [2, [-1.446655650118766, 5.174004882380171, 0.2471975511965976]],
        [5, [1.2837225581543752, 4.286123157727803, 5.639805681145945]],
        [8, [3.6839412094115227, 2.4864147296324832, 5.639805681145945]],
      ],
    },
  ];

  for (const fixture of fixtures) {
    const path = shortestPath(fixture.start, fixture.end, fixture.radius);
    assert.ok(path);
    assert.equal(path.types.join(''), fixture.word);
    close(path.length, fixture.length, 1e-9);
    assert.equal(path.lengths.length, fixture.lengths.length);
    for (let index = 0; index < path.lengths.length; index += 1) {
      close(path.lengths[index], fixture.lengths[index], 1e-9);
    }
    for (const [distanceAlongPath, expectedPose] of fixture.samples) {
      poseClose(samplePath(path, distanceAlongPath), expectedPose, 1e-8);
    }
  }
});

test('near-degenerate terminal turn does not add a full loop', () => {
  // The Julia planner deliberately invokes Dubins with a 1e-3 loop tolerance.
  // Without that approximate cleanup, the final RSL turn is returned as
  // 2*pi - 1.59e-4 radians, making this 11 m path look like a 73.8 m path.
  const start = [15.4640388, -8.9120736, 2.6707963];
  const end = [10, 0, Math.PI / 2];
  const path = shortestPath(start, end, 10);

  assert.ok(path);
  assert.equal(path.types.join(''), 'RSL');
  close(path.length, 11.001590559213888, 1e-9);
  close(path.lengths[2], 0, 1e-12);
  poseClose(samplePath(path, path.length), end);
});

test('integrating every returned segment stays within the loop allowance', () => {
  const cases = [
    [[15.4640388, -8.9120736, 2.6707963], [10, 0, Math.PI / 2], 10],
  ];
  const random = seededRandom('dubins-segment-integrity');
  const randomPose = () => [
    (random() - 0.5) * 200,
    (random() - 0.5) * 200,
    (random() * 2 - 1) * Math.PI,
  ];
  for (let index = 0; index < 128; index += 1) {
    cases.push([randomPose(), randomPose(), 5 + random() * 25]);
  }

  for (const [start, end, radius] of cases) {
    const path = shortestPath(start, end, radius);
    assert.ok(path);
    let integrated = [...path.start];
    for (let index = 0; index < path.types.length; index += 1) {
      const turnRate = path.types[index] === 'L'
        ? 1 / path.radius
        : path.types[index] === 'R'
          ? -1 / path.radius
          : 0;
      integrated = integrate(integrated, 1, turnRate, path.lengths[index]);
    }
    const positionError = Math.hypot(
      integrated[0] - path.end[0],
      integrated[1] - path.end[1],
    );
    const headingError = Math.abs(angleDiff(integrated[2], path.end[2]));
    assert.ok(
      positionError <= 3 * radius * 1e-3,
      `position residual ${positionError} exceeds ${3 * radius * 1e-3}`,
    );
    assert.ok(
      headingError <= 3e-3,
      `heading residual ${headingError} exceeds 0.003`,
    );
  }
});

test('zero-distance paths and invalid input are handled safely', () => {
  const same = [2, -3, 0.75];
  const path = shortestPath(same, same, 2);
  assert.ok(path);
  close(path.length, 0);
  assert.deepEqual(samplePath(path, -10), same);
  assert.deepEqual(samplePath(path, 10), same);
  assert.equal(curvatureAt(path, 0), 0);
  assert.equal(shortestPath(same, same, 0), null);
  assert.equal(shortestPath([0, 0], same, 1), null);
  assert.equal(shortestPath([0, 0, 0], [Infinity, 0, 0], 1), null);
});

test('concatenated paths preserve exact boundary continuity and prefixes', () => {
  const first = shortestPath([0, 0, 0], [5, 0, 0], 2);
  const second = shortestPath([5, 0, 0], [5, 5, Math.PI / 2], 2);
  assert.ok(first && second);
  const paths = [first, second];
  const total = pathLength(paths);
  close(total, first.length + second.length);

  poseClose(samplePaths(paths, first.length), second.start);
  poseClose(samplePaths(paths, -1), first.start);
  poseClose(samplePaths(paths, total + 1), second.end);
  close(curvatureOnPaths(paths, first.length / 2), curvatureAt(first, first.length / 2));
  close(curvatureOnPaths(paths, first.length + second.length / 2), curvatureAt(second, second.length / 2));

  const prefix = prefixPaths(paths, first.length + second.length / 2);
  assert.equal(prefix.length, 2);
  close(pathLength(prefix), first.length + second.length / 2);
  poseClose(prefix[0].start, first.start);
  poseClose(prefix[1].start, second.start);
  poseClose(prefix.at(-1).end, samplePath(second, second.length / 2));
  assert.deepEqual(prefixPaths(paths, 0), []);
});

test('integrate uses exact straight and constant-turn dynamics', () => {
  poseClose(integrate([1, 2, 0], 3, 0, 4), [13, 2, 0]);
  poseClose(integrate([0, 0, 0], 2, 1, Math.PI / 2), [2, 2, Math.PI / 2]);
  poseClose(integrate([0, 0, 0], 0, 1, Math.PI), [0, 0, Math.PI]);
  assert.throws(() => integrate([0, 0], 1, 0, 1), TypeError);
});
