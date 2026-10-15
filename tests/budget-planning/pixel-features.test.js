import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIEF_WORDS,
  PixelFeatureDetector,
  detectFeatures,
  hammingDistance,
  matchFeatures,
} from '../../assets/budget-planning/pixel-features.js';

const rgbaFromGray = (gray, width, height) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = Math.max(0, Math.min(255, Math.round(gray[index])));
    rgba[index * 4] = value;
    rgba[index * 4 + 1] = value;
    rgba[index * 4 + 2] = value;
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
};

const makeGray = (width, height, fill = 0) => new Float32Array(width * height).fill(fill);

const translateGray = (source, width, height, dx, dy) => {
  const translated = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - dx;
      const sourceY = y - dy;
      if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
        translated[y * width + x] = source[sourceY * width + sourceX];
      }
    }
  }
  return translated;
};

const rotateGray = (source, width, height, angle, fill = 20) => {
  const rotated = new Float32Array(width * height).fill(fill);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  // Inverse-map each destination pixel and bilinearly sample the source.  The
  // resulting image is an actual rotated intensity image, rather than a
  // synthetic feature/id permutation.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offsetX = x - centerX;
      const offsetY = y - centerY;
      const sourceX = cosine * offsetX + sine * offsetY + centerX;
      const sourceY = -sine * offsetX + cosine * offsetY + centerY;
      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height) continue;
      const weightX = sourceX - x0;
      const weightY = sourceY - y0;
      const top = source[y0 * width + x0] * (1 - weightX) + source[y0 * width + x1] * weightX;
      const bottom = source[y1 * width + x0] * (1 - weightX) + source[y1 * width + x1] * weightX;
      rotated[y * width + x] = top * (1 - weightY) + bottom * weightY;
    }
  }
  return rotated;
};

const makeTexturedChecker = (width, height) => {
  const image = makeGray(width, height, 20);
  let state = 0x12345678;
  const random = () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
  for (let y = 20; y < height - 20; y += 1) {
    for (let x = 20; x < width - 20; x += 1) {
      const checker = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) ? 190 : 55;
      image[y * width + x] = checker + (random() - 0.5) * 18;
    }
  }
  // Add a few image-space line junctions so this exercises corners rather
  // than merely returning responses from a single long edge.
  for (let y = 38; y < height - 38; y += 1) {
    for (let x = 34; x < width - 34; x += 1) {
      if (Math.abs(x - 120) < 2 || Math.abs(y - 92) < 2) image[y * width + x] = 245;
    }
  }
  return image;
};

test('blank images produce no image features or matches', () => {
  const width = 96;
  const height = 72;
  const blank = rgbaFromGray(makeGray(width, height), width, height);
  const previous = detectFeatures(blank, width, height);
  const current = detectFeatures(blank, width, height);
  assert.deepEqual(previous, []);
  assert.deepEqual(current, []);
  assert.deepEqual(matchFeatures(previous, current), []);
});

test('FAST finds an actual high-contrast corner and emits a 256-bit descriptor', () => {
  const width = 96;
  const height = 80;
  const image = makeGray(width, height, 18);
  for (let y = 24; y < 56; y += 1) {
    for (let x = 28; x < 66; x += 1) image[y * width + x] = 225;
  }
  const features = detectFeatures(rgbaFromGray(image, width, height), width, height, {
    threshold: 14,
    maxFeatures: 20,
    minDistance: 5,
  });
  assert.ok(features.length >= 4, 'all four square corners should be candidates');
  assert.ok(features.some((feature) => Math.abs(feature.x - 28) <= 1 && Math.abs(feature.y - 24) <= 1));
  assert.ok(features.every((feature) => feature.descriptor instanceof Uint32Array));
  assert.ok(features.every((feature) => feature.descriptor.length === BRIEF_WORDS));
  assert.ok(features.every((feature) => feature.score >= 14));
});

test('translated textured pixels yield stable image-space matches', () => {
  const width = 256;
  const height = 192;
  const dx = 4;
  const dy = 3;
  const firstImage = makeTexturedChecker(width, height);
  const secondImage = translateGray(firstImage, width, height, dx, dy);
  const options = { threshold: 12, maxFeatures: 120, minDistance: 7, briefSigma: 1.5 };
  const previous = detectFeatures(rgbaFromGray(firstImage, width, height), width, height, options);
  const current = detectFeatures(rgbaFromGray(secondImage, width, height), width, height, options);
  assert.ok(previous.length > 8, 'textured source should produce real corners');
  assert.ok(current.length > 8, 'translated source should produce real corners');
  const matches = matchFeatures(previous, current, { maxDistance: 48, ratio: 0.9 });
  assert.ok(matches.length >= 5, 'several translated image features should match');
  const consistent = matches.filter(({ previous: previousIndex, current: currentIndex }) => {
    const first = previous[previousIndex];
    const second = current[currentIndex];
    return Math.abs(second.x - first.x - dx) <= 1 && Math.abs(second.y - first.y - dy) <= 1;
  });
  assert.ok(consistent.length >= Math.max(3, Math.floor(matches.length * 0.5)));
  assert.ok(matches.every((match) => match.distance >= 0 && match.distance <= 48));
});

test('BRIEF scales to smaller integer and fractional patch radii', () => {
  const width = 256;
  const height = 192;
  const image = makeTexturedChecker(width, height);
  const common = { threshold: 12, maxFeatures: 120, minDistance: 7, briefSigma: 1.5 };
  const radius7 = detectFeatures(
    rgbaFromGray(image, width, height),
    width,
    height,
    { ...common, descriptorPatchRadius: 7 },
  );
  const radius10 = detectFeatures(
    rgbaFromGray(image, width, height),
    width,
    height,
    { ...common, descriptorPatchRadius: 10 },
  );
  const radius7Point5 = detectFeatures(
    rgbaFromGray(image, width, height),
    width,
    height,
    { ...common, descriptorPatchRadius: 7.5 },
  );
  assert.ok(radius7.length > 10 && radius10.length > 10 && radius7Point5.length > 10);
  assert.ok(radius7.every((feature) => feature.descriptor.length === 8));
  assert.ok(radius10.every((feature) => feature.descriptor.length === 8));
  assert.ok(radius7Point5.every((feature) => feature.descriptor.length === 8));

  const defaultRadius = detectFeatures(rgbaFromGray(image, width, height), width, height, common);
  const explicitRadius15 = detectFeatures(
    rgbaFromGray(image, width, height),
    width,
    height,
    { ...common, descriptorPatchRadius: 15 },
  );
  assert.deepEqual(
    defaultRadius.map((feature) => [feature.x, feature.y, feature.score, ...feature.descriptor]),
    explicitRadius15.map((feature) => [feature.x, feature.y, feature.score, ...feature.descriptor]),
    'the default 15px descriptor patch must remain unchanged',
  );

  const integerByPosition = new Map(radius7.map((feature) => [`${feature.x},${feature.y}`, feature]));
  const fractionalDifference = radius7Point5.some((feature) => {
    const integer = integerByPosition.get(`${feature.x},${feature.y}`);
    return integer && !integer.descriptor.every((word, index) => word === feature.descriptor[index]);
  });
  assert.equal(fractionalDifference, true, 'fractional radius should use interpolated, scaled samples');

  const orientedDefault = detectFeatures(
    rgbaFromGray(image, width, height),
    width,
    height,
    { ...common, descriptorPatchRadius: 7, orientation: true },
  );
  const orientedExplicit = detectFeatures(
    rgbaFromGray(image, width, height),
    width,
    height,
    { ...common, descriptorPatchRadius: 7, orientation: true, orientationPatchRadius: 7 },
  );
  assert.deepEqual(
    orientedDefault.map((feature) => [feature.x, feature.y, feature.angle, ...feature.descriptor]),
    orientedExplicit.map((feature) => [feature.x, feature.y, feature.angle, ...feature.descriptor]),
    'orientation centroid support should default to the selected descriptor radius',
  );
  const orientedFractional = detectFeatures(
    rgbaFromGray(image, width, height),
    width,
    height,
    { ...common, descriptorPatchRadius: 7.5, orientation: true },
  );
  assert.ok(orientedFractional.length > 10);
  assert.ok(orientedFractional.every((feature) => Number.isFinite(feature.angle)));
});

test('orientation-normalized BRIEF keeps geometric matches in a rotated image', () => {
  const width = 256;
  const height = 192;
  const angle = Math.PI / 12;
  const firstImage = makeTexturedChecker(width, height);
  const secondImage = rotateGray(firstImage, width, height, angle);
  const options = {
    threshold: 12,
    maxFeatures: 100,
    minDistance: 7,
    briefSigma: 1.5,
    orientation: true,
  };
  const previous = detectFeatures(rgbaFromGray(firstImage, width, height), width, height, options);
  const current = detectFeatures(rgbaFromGray(secondImage, width, height), width, height, options);
  const matches = matchFeatures(previous, current, { maxDistance: 56, ratio: 0.95 });
  assert.ok(matches.length >= 10, 'rotation should retain a useful set of descriptor matches');

  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const consistent = matches.filter(({ previous: previousIndex, current: currentIndex }) => {
    const first = previous[previousIndex];
    const second = current[currentIndex];
    const expectedX = cosine * (first.x - centerX) - sine * (first.y - centerY) + centerX;
    const expectedY = sine * (first.x - centerX) + cosine * (first.y - centerY) + centerY;
    return Math.hypot(second.x - expectedX, second.y - expectedY) <= 2;
  });
  assert.ok(consistent.length >= 4, 'several matches should agree with the image rotation');
});

test('orientation-normalized descriptors expose an intensity-centroid angle', () => {
  const width = 96;
  const height = 96;
  const image = makeGray(width, height, 16);
  for (let y = 24; y < 72; y += 1) {
    for (let x = 24; x < 72; x += 1) {
      image[y * width + x] = ((x + 2 * y) & 7) < 4 ? 210 : 65;
    }
  }
  const features = detectFeatures(rgbaFromGray(image, width, height), width, height, {
    threshold: 10,
    maxFeatures: 12,
    minDistance: 7,
    orientation: true,
  });
  assert.ok(features.length > 0);
  assert.ok(features.every((feature) => Number.isFinite(feature.angle)));
  assert.ok(features.every((feature) => feature.descriptor.length === 8));
});

test('capacity and spacing are bounded without a uniform spatial quota', () => {
  const width = 320;
  const height = 240;
  const image = makeTexturedChecker(width, height);
  const features = new PixelFeatureDetector({ maxFeatureCapacity: 64 }).detectFeatures(
    rgbaFromGray(image, width, height),
    width,
    height,
    { threshold: 8, maxFeatures: 64, minDistance: 9 },
  );
  assert.ok(features.length <= 64);
  for (let first = 0; first < features.length; first += 1) {
    for (let second = first + 1; second < features.length; second += 1) {
      const dx = features[first].x - features[second].x;
      const dy = features[first].y - features[second].y;
      assert.ok(dx * dx + dy * dy >= 81);
    }
  }
});

test('matcher gates by real BRIEF words and optional compatibility callback', () => {
  const a = { descriptor: new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0]), depth: 4 };
  const b = { descriptor: new Uint32Array([1, 0, 0, 0, 0, 0, 0, 0]), depth: 4 };
  const unrelated = { descriptor: new Uint32Array([0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff]), depth: 40 };
  assert.equal(hammingDistance(a.descriptor, b.descriptor), 1);
  assert.deepEqual(matchFeatures([a], [b], { maxDistance: 2 }), [{ previous: 0, current: 0, distance: 1 }]);
  assert.deepEqual(matchFeatures([a], [unrelated], { maxDistance: 2 }), []);
  assert.deepEqual(matchFeatures([a], [b], {
    maxDistance: 2,
    compatible: (previous, current) => previous.depth === current.depth && current.depth < 1,
  }), []);
});
