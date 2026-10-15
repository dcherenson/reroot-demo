import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from '../../assets/budget-planning/vendor/three.module.js';
import { createWorld } from '../../assets/budget-planning/worlds.js';
import { LiveFeatureMap } from '../../assets/budget-planning/vision.js';
import { inFov } from '../../assets/budget-planning/knowledge.js';
import {
  SENSOR,
  inSensorImage,
  sensorCalibration,
  unprojectDepth,
} from '../../assets/budget-planning/sensor-camera.js';
import { Simulation, validateConfig } from '../../assets/budget-planning/simulation.js';

const WIDTH = SENSOR.width;
const HEIGHT = SENSOR.height;
const WORLD_WIDTH = 320;
const WORLD_HEIGHT = 230;
const WORLD_ALTITUDE = 35;

function rgbaFromGray(gray) {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let index = 0; index < gray.length; index += 1) {
    const value = Math.max(0, Math.min(255, Math.round(gray[index])));
    rgba[index * 4] = value;
    rgba[index * 4 + 1] = value;
    rgba[index * 4 + 2] = value;
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
}

function makeGrayTexture() {
  const image = new Float32Array(WIDTH * HEIGHT).fill(20);
  let state = 0x12345678;
  const random = () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
  for (let y = 20; y < HEIGHT - 20; y += 1) {
    for (let x = 20; x < WIDTH - 20; x += 1) {
      const checker = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) ? 190 : 55;
      image[y * WIDTH + x] = checker + (random() - 0.5) * 18;
    }
  }
  // Two long junctions ensure the image contains real FAST corners as well
  // as repeated checker texture for the BRIEF matcher.
  for (let y = 38; y < HEIGHT - 38; y += 1) {
    for (let x = 34; x < WIDTH - 34; x += 1) {
      if (Math.abs(x - 120) < 2 || Math.abs(y - 92) < 2) image[y * WIDTH + x] = 245;
    }
  }
  return image;
}

function makeRectTexture(left, right, top, bottom) {
  const image = new Float32Array(WIDTH * HEIGHT).fill(20);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) image[y * WIDTH + x] = 220;
  }
  return image;
}

function makeSingleCornerTexture() {
  const image = new Float32Array(WIDTH * HEIGHT).fill(20);
  for (let y = 90; y < 140; y += 1) {
    for (let x = 130; x < 180; x += 1) {
      image[y * WIDTH + x] = x < 155 && y < 115 ? 220 : 20;
    }
  }
  return image;
}

function translateGray(source, dx, dy) {
  const translated = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const sourceX = x - dx;
      const sourceY = y - dy;
      if (sourceX >= 0 && sourceX < WIDTH && sourceY >= 0 && sourceY < HEIGHT) {
        translated[y * WIDTH + x] = source[sourceY * WIDTH + sourceX];
      }
    }
  }
  return translated;
}

function packDepthToRGBA(depth) {
  // RGBADepthPacking stores the 32-bit base-256 fraction. This is the byte
  // representation returned by WebGL readPixels for Three's depth material.
  const packed = Math.floor(Math.max(0, Math.min(0.999999999, depth)) * 2 ** 32);
  return new Uint8Array([
    packed >>> 24,
    (packed >>> 16) & 0xff,
    (packed >>> 8) & 0xff,
    packed & 0xff,
  ]);
}

function makeSensorCamera(pose, altitude = WORLD_ALTITUDE, config = undefined) {
  const sensor = sensorCalibration(config);
  const camera = new THREE.PerspectiveCamera(
    sensor.verticalFov * 180 / Math.PI,
    WIDTH / HEIGHT,
    sensor.near,
    sensor.far,
  );
  const position = new THREE.Vector3(
    pose[0] - WORLD_WIDTH / 2,
    altitude,
    -(pose[1] - WORLD_HEIGHT / 2),
  );
  const forward = new THREE.Vector3(
    Math.cos(sensor.pitch) * Math.cos(pose[2]),
    -Math.sin(sensor.pitch),
    -Math.cos(sensor.pitch) * Math.sin(pose[2]),
  );
  camera.position.copy(position);
  camera.lookAt(position.clone().add(forward));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function makeDepthFrame(gray, camera, distance = 25) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const sample = camera.position.clone().addScaledVector(forward, distance);
  const normalizedDepth = sample.clone().project(camera).z * 0.5 + 0.5;
  const packed = packDepthToRGBA(normalizedDepth);
  const depth = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let index = 0; index < WIDTH * HEIGHT; index += 1) depth.set(packed, index * 4);
  const inverseViewProjection = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .invert()
    .elements
    .slice();
  return {
    rgba: rgbaFromGray(gray),
    width: WIDTH,
    height: HEIGHT,
    depth,
    inverseViewProjection,
  };
}

function makeBlankFrame() {
  return {
    rgba: new Uint8ClampedArray(WIDTH * HEIGHT * 4),
    width: WIDTH,
    height: HEIGHT,
    depth: new Uint8Array(WIDTH * HEIGHT * 4),
    inverseViewProjection: new THREE.Matrix4().identity().elements.slice(),
  };
}

function projectedInSensorImage(camera, point) {
  const scenePoint = new THREE.Vector3(
    point.x - WORLD_WIDTH / 2,
    point.z,
    -(point.y - WORLD_HEIGHT / 2),
  );
  const ndc = scenePoint.project(camera);
  return ndc.z >= -1 && ndc.z <= 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
}

test('pixel mode starts with no authored feature map and requires a camera measurement', () => {
  const simulation = new Simulation('farm', {}, 1337, { pixelFeatures: true });
  assert.ok(simulation.world.features.length > 0, 'the world still has renderable scenery');
  assert.deepEqual(simulation.knowledge.features, []);
  assert.equal(simulation.knowledge.mapCount, 0);
  assert.equal(simulation.knowledge.mapped.length, 1000);
  assert.throws(() => simulation.acceptSensor(), /Camera image required/);
  assert.throws(() => simulation.advance(), /validated camera frame/);

  const vision = new LiveFeatureMap(simulation.world);
  const observation = vision.measure(makeBlankFrame(), simulation.pose, simulation.cameraYaw);
  assert.equal(simulation.acceptSensor(observation), true);
  assert.deepEqual(simulation.knowledge.features, []);
  assert.equal(simulation.knowledge.mapCount, 0);

  // One motion step is allowed only after the prior frame was accepted; the
  // next step waits for the next real camera measurement.
  assert.equal(simulation.advance(), true);
  assert.throws(() => simulation.advance(), /validated camera frame/);
});

test('a blank camera frame produces zero corners, anchors, and shared matches', () => {
  const world = createWorld('tucson', 1337);
  const vision = new LiveFeatureMap(world);
  const observation = vision.measure(makeBlankFrame(), [160, 115, 0], 0);
  assert.equal(observation.metrics.corners, 0);
  assert.equal(observation.metrics.inFootprint, 0);
  assert.equal(observation.metrics.matches, 0);
  assert.equal(observation.metrics.shared, 0);
  assert.deepEqual(observation.newAnchors, []);
  assert.deepEqual(observation.visible, []);
  assert.equal(vision.anchors.length, 0, 'blank pixels must not import authored world features');
});

test('corner anchors use the nearest foreground depth in their 3x3 support', () => {
  const pose = [160, 115, 0];
  const camera = makeSensorCamera(pose);
  const image = makeSingleCornerTexture();
  const frame = makeDepthFrame(image, camera, 25);
  const foregroundX = 155;
  const foregroundY = 113;
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const foregroundSample = camera.position.clone().addScaledVector(forward, 10);
  const foregroundDepth = foregroundSample.clone().project(camera).z * 0.5 + 0.5;
  frame.depth.set(packDepthToRGBA(foregroundDepth), (foregroundY * WIDTH + foregroundX) * 4);

  const expected = unprojectDepth(frame, foregroundX, foregroundY, WORLD_WIDTH, WORLD_HEIGHT);
  assert.ok(expected);
  const vision = new LiveFeatureMap(createWorld('farm', 1337));
  const observation = vision.measure(frame, pose, pose[2]);
  assert.equal(observation.metrics.corners, 4);
  assert.ok(observation.newAnchors.some((anchor) => (
    Math.hypot(anchor.x - expected.x, anchor.y - expected.y, anchor.z - expected.z) < 1e-6
  )), 'a detected corner should anchor to the nearest supported foreground surface');
});

test('spatial representatives use a three-metre radius across four-metre bins', () => {
  const vision = new LiveFeatureMap(createWorld('farm', 1337));
  const anchor = { id: 0, x: 7.9, y: 8.1, z: 4 };
  vision.anchors.push(anchor);
  vision.bins.set('1,2', [anchor.id]);

  assert.equal(vision.nearby({ x: 8.1, y: 8.1, z: 4 }), anchor.id, 'lookup should cross an adjacent four-metre bin');
  assert.equal(vision.nearby({ x: 10.89, y: 8.1, z: 4 }), anchor.id, 'points inside three metres reuse the representative');
  assert.equal(vision.nearby({ x: 10.91, y: 8.1, z: 4 }), null, 'points beyond three metres create a new representative');
  assert.equal(vision.anchors.length, 1);
});

test('packed depth unprojection agrees with Three perspective projection', () => {
  const pose = [160, 115, 0];
  const camera = makeSensorCamera(pose);
  const pixelX = 178;
  const pixelY = 96;
  const pixelNdc = new THREE.Vector3(
    2 * (pixelX + 0.5) / WIDTH - 1,
    1 - 2 * (pixelY + 0.5) / HEIGHT,
    0.4,
  );
  const rayPoint = pixelNdc.clone().unproject(camera);
  const point = camera.position.clone().add(
    rayPoint.sub(camera.position).normalize().multiplyScalar(25),
  );
  const projected = point.clone().project(camera);
  const frame = makeDepthFrame(new Float32Array(WIDTH * HEIGHT), camera, 25);
  const pixelDepth = packDepthToRGBA(projected.z * 0.5 + 0.5);
  frame.depth.fill(0);
  frame.depth.set(pixelDepth, (pixelY * WIDTH + pixelX) * 4);
  const actual = unprojectDepth(frame, pixelX, pixelY, WORLD_WIDTH, WORLD_HEIGHT);
  assert.ok(actual);
  assert.ok(Math.abs(actual.x - (point.x + WORLD_WIDTH / 2)) < 1e-3);
  assert.ok(Math.abs(actual.y - (WORLD_HEIGHT / 2 - point.z)) < 1e-3);
  assert.ok(Math.abs(actual.z - point.y) < 1e-3);
});

test('sensor image membership agrees with the matching Three perspective frustum', () => {
  const pose = [170, 105, 0.73];
  const camera = makeSensorCamera(pose);
  let checked = 0;
  for (let x = 50; x <= 290; x += 10) {
    for (let y = 25; y <= 205; y += 10) {
      for (let z = 0; z <= 34; z += 4) {
        const point = { x, y, z };
        assert.equal(
          inSensorImage(pose, point, pose[2], WORLD_ALTITUDE),
          projectedInSensorImage(camera, point),
          `FOV disagreement at (${x}, ${y}, ${z})`,
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked > 1000);
});

test('nondefault optical settings keep geometric sensing aligned with the Three frustum', () => {
  const config = { horizontalFov: 60, sensingRange: 40, downwardPitch: 35 };
  const pose = [170, 105, 0.73];
  const camera = makeSensorCamera(pose, WORLD_ALTITUDE, config);
  let checked = 0;
  for (let x = 70; x <= 270; x += 10) {
    for (let y = 45; y <= 165; y += 10) {
      for (let z = 0; z <= 34; z += 4) {
        const point = { x, y, z };
        assert.equal(
          inSensorImage(pose, point, pose[2], WORLD_ALTITUDE, 0, config),
          projectedInSensorImage(camera, point),
          `nondefault FOV disagreement at (${x}, ${y}, ${z})`,
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked > 1000);

  // The horizontal planner gate shares the same configurable angle and range.
  const heading = pose[2];
  const inside = { x: pose[0] + 30 * Math.cos(heading), y: pose[1] + 30 * Math.sin(heading) };
  const outsideAngle = { x: pose[0] + 30 * Math.cos(heading + Math.PI / 3), y: pose[1] + 30 * Math.sin(heading + Math.PI / 3) };
  const outsideRange = { x: pose[0] + 45 * Math.cos(heading), y: pose[1] + 45 * Math.sin(heading) };
  assert.equal(inFov(pose, inside, heading, 0, config), true);
  assert.equal(inFov(pose, outsideAngle, heading, 0, config), false);
  assert.equal(inFov(pose, outsideRange, heading, 0, config), false);
});

test('sensor config validation preserves defaults and rejects values outside UI limits', () => {
  const defaults = validateConfig();
  assert.deepEqual(
    { horizontalFov: defaults.horizontalFov, sensingRange: defaults.sensingRange, downwardPitch: defaults.downwardPitch },
    { horizontalFov: 90, sensingRange: 75, downwardPitch: 55 },
  );
  assert.deepEqual(
    validateConfig({ horizontalFov: 60, sensingRange: 40, downwardPitch: 35 }),
    { ...defaults, horizontalFov: 60, sensingRange: 40, downwardPitch: 35 },
  );
  for (const [key, value] of [
    ['horizontalFov', 59], ['horizontalFov', 121],
    ['sensingRange', 39], ['sensingRange', 101],
    ['downwardPitch', 34], ['downwardPitch', 76],
  ]) {
    assert.throws(() => validateConfig({ [key]: value }), new RegExp(`Invalid ${key}`));
  }
});

test('consecutive real pixel frames produce descriptor matches within bounded capacity', () => {
  const pose = [160, 115, 0];
  const camera = makeSensorCamera(pose);
  const world = createWorld('farm', 2026);
  const vision = new LiveFeatureMap(world);
  const firstImage = makeGrayTexture();
  const first = vision.measure(makeDepthFrame(firstImage, camera), pose, pose[2]);
  const second = vision.measure(makeDepthFrame(translateGray(firstImage, 4, 3), camera), pose, pose[2]);

  assert.ok(first.metrics.corners > 20);
  assert.ok(first.metrics.inFootprint > 0);
  assert.ok(first.metrics.corners <= 500);
  assert.ok(second.metrics.matches >= 5, 'translated pixels should retain real BRIEF correspondences');
  assert.ok(second.shared >= 3, 'matched correspondences should reuse live anchor ids');
  assert.ok(second.metrics.mapped <= 1000);
  assert.ok(vision.anchors.length <= 1000);
  assert.equal(second.metrics.frameCount, 2);
});

test('shared pixel count keeps one-to-one matches when representatives are deduplicated', () => {
  const pose = [160, 115, 0];
  const camera = makeSensorCamera(pose);
  const frame = makeDepthFrame(makeRectTexture(130, 140, 90, 120), camera, 25);
  const vision = new LiveFeatureMap(createWorld('farm', 1337));
  const first = vision.measure(frame, pose, pose[2]);
  assert.ok(first.metrics.inFootprint >= 4);
  assert.ok(vision.previous.length >= 2);

  // Two image detections can legitimately refer to the same spatial map
  // representative. Preserve that state while the next frame contributes
  // distinct reciprocal descriptor matches.
  vision.previous[1].id = vision.previous[0].id;
  const second = vision.measure(frame, pose, pose[2]);
  const uniquePersistentIds = new Set(second.visible).size;
  assert.ok(second.metrics.matches >= 2);
  assert.equal(second.shared, second.metrics.matches);
  assert.ok(second.shared > uniquePersistentIds, 'shared should count descriptor correspondences, not deduplicated map ids');
});
