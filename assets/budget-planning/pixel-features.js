/*
 * Small, dependency-free image feature front end for the camera demo.
 *
 * The detector deliberately operates on the image samples supplied by the
 * camera.  In particular, feature descriptors contain only BRIEF intensity
 * tests; a world-feature id must never be put in a descriptor or used as a
 * substitute for one.
 *
 * FAST follows the segment test described by Rosten and Drummond: a point is
 * a corner when N contiguous samples on the radius-three Bresenham circle are
 * all brighter or all darker than the centre by the requested threshold.
 * BRIEF is a deterministic 256-bit binary descriptor made from tests over a
 * small Gaussian-smoothed image patch.  The pair pattern is fixed so that
 * descriptors can be compared between calls without allocating a learned
 * model or loading an asset.
 */

export const FAST_CIRCLE_RADIUS = 3;
export const FAST_CIRCLE_SIZE = 16;
export const BRIEF_BITS = 256;
export const BRIEF_WORDS = BRIEF_BITS / 32;
export const DEFAULT_FEATURE_OPTIONS = Object.freeze({
  threshold: 14,
  maxFeatures: 500,
  minDistance: 5,
  fastN: 9,
});

const MAX_FEATURE_CAPACITY = 4096;
const MAX_IMAGE_PIXELS = 4_000_000;
const SQRT_TWO = Math.SQRT2;

// The usual radius-three Bresenham circle.  The first sample is above the
// centre and samples then proceed clockwise in image coordinates.
const CIRCLE_X = Int8Array.from([
  0, 1, 2, 3, 3, 3, 2, 1,
  0, -1, -2, -3, -3, -3, -2, -1,
]);
const CIRCLE_Y = Int8Array.from([
  -3, -3, -2, -1, 0, 1, 2, 3,
  3, 3, 2, 1, 0, -1, -2, -3,
]);

/**
 * Make a fixed BRIEF pattern.  A deterministic integer pattern makes this
 * module reproducible while retaining the usual BRIEF properties: pairs are
 * spread over a patch and each test compares two different locations.
 */
const makeBriefPattern = () => {
  const pattern = new Int8Array(BRIEF_BITS * 4);
  let state = 0x6d2b79f5;
  const next = () => {
    // Mulberry32, kept local so no global random state is touched.
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  for (let bit = 0; bit < BRIEF_BITS; bit += 1) {
    const offset = bit * 4;
    // A 31x31 patch is the standard compact BRIEF support.  The detector
    // keeps a one-pixel safety margin for bilinear samples when orientation
    // normalization is enabled.
    let x1 = Math.floor(next() * 31) - 15;
    let y1 = Math.floor(next() * 31) - 15;
    let x2 = Math.floor(next() * 31) - 15;
    let y2 = Math.floor(next() * 31) - 15;
    if (x1 === x2 && y1 === y2) {
      x2 = x2 === 15 ? x2 - 1 : x2 + 1;
    }
    pattern[offset] = x1;
    pattern[offset + 1] = y1;
    pattern[offset + 2] = x2;
    pattern[offset + 3] = y2;
  }
  return pattern;
};

const BRIEF_PATTERN = makeBriefPattern();

const clampInteger = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
};

const clampNumber = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
};

const finiteOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const isTypedByteImage = (rgba) => (
  rgba instanceof Uint8Array
  || rgba instanceof Uint8ClampedArray
  || rgba instanceof Uint16Array
  || rgba instanceof Float32Array
  || rgba instanceof Float64Array
);

const popcount32 = (value) => {
  value >>>= 0;
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

/** Return the Hamming distance between two eight-word BRIEF descriptors. */
export const hammingDistance = (first, second) => {
  if (!first || !second || first.length < BRIEF_WORDS || second.length < BRIEF_WORDS) {
    return Infinity;
  }
  let distance = 0;
  for (let index = 0; index < BRIEF_WORDS; index += 1) {
    distance += popcount32((first[index] ^ second[index]) >>> 0);
  }
  return distance;
};

const hasDescriptor = (feature) => (
  feature
  && feature.descriptor instanceof Uint32Array
  && feature.descriptor.length >= BRIEF_WORDS
);

const readImageArguments = (rgba, width, height) => {
  // Accepting ImageData as a convenience does not change the documented
  // (rgba, width, height) API and helps browser callers avoid a copy.
  if (rgba && !isTypedByteImage(rgba) && rgba.data && width === undefined && height === undefined) {
    return { rgba: rgba.data, width: rgba.width, height: rgba.height };
  }
  if (rgba && !isTypedByteImage(rgba) && rgba.data && width === rgba.width && height === rgba.height) {
    return { rgba: rgba.data, width, height };
  }
  return { rgba, width, height };
};

const isBottomUp = (options) => Boolean(
  options.bottomUp
  || options.flipY
  || options.sourceBottomUp
  || options.rgbaBottomUp,
);

/**
 * A reusable FAST + BRIEF detector.  Buffers grow only to the requested image
 * dimensions and feature capacity, and are reused for subsequent frames.
 */
export class PixelFeatureDetector {
  constructor(options = {}) {
    options = options || {};
    this.maxPixels = clampInteger(options.maxPixels, MAX_IMAGE_PIXELS, 1, MAX_IMAGE_PIXELS);
    this.maxFeatureCapacity = clampInteger(
      options.maxFeatureCapacity,
      MAX_FEATURE_CAPACITY,
      1,
      MAX_FEATURE_CAPACITY,
    );
    this.defaultOptions = {
      threshold: finiteOr(options.threshold, DEFAULT_FEATURE_OPTIONS.threshold),
      maxFeatures: clampInteger(options.maxFeatures, DEFAULT_FEATURE_OPTIONS.maxFeatures, 0, this.maxFeatureCapacity),
      minDistance: Math.max(0, finiteOr(options.minDistance, DEFAULT_FEATURE_OPTIONS.minDistance)),
      fastN: clampInteger(options.fastN ?? options.segmentLength, DEFAULT_FEATURE_OPTIONS.fastN, 9, 12),
      orientation: Boolean(options.orientation || options.orientationNormalized || options.orientationNorm || options.useOrientation),
      briefSigma: Math.max(0, finiteOr(options.briefSigma ?? options.blurSigma ?? options.gaussianSigma, 2)),
      descriptorPatchRadius: clampNumber(options.descriptorPatchRadius, 15, 4, 15),
      orientationPatchRadius: options.orientationPatchRadius === undefined
        ? undefined
        : clampNumber(options.orientationPatchRadius, 15, 1, 22),
    };
    this._width = 0;
    this._height = 0;
    this._pixelCapacity = 0;
    this._gray = new Float32Array(0);
    this._blurred = new Float32Array(0);
    this._blurTemporary = new Float32Array(0);
    this._scores = new Float32Array(0);
    this._candidateIndices = new Int32Array(0);
    this._candidateX = new Int32Array(0);
    this._candidateY = new Int32Array(0);
    this._acceptedX = new Int32Array(0);
    this._acceptedY = new Int32Array(0);
    this._acceptedNext = new Int32Array(0);
    this._descriptorStorage = new Uint32Array(0);
    this._cellHeads = new Int32Array(0);
    this._cellMarks = new Int32Array(0);
    this._cellStamp = 0;
    this._briefKernelSigma = NaN;
    this._briefKernel = new Float32Array(0);
    this._ring = new Float32Array(FAST_CIRCLE_SIZE);
  }

  _ensureBuffers(width, height, maxFeatures) {
    const pixelCount = width * height;
    if (pixelCount > this.maxPixels) {
      throw new RangeError(`image has ${pixelCount} pixels; limit is ${this.maxPixels}`);
    }
    if (pixelCount !== this._pixelCapacity) {
      this._pixelCapacity = pixelCount;
      this._gray = new Float32Array(pixelCount);
      this._blurred = new Float32Array(pixelCount);
      this._blurTemporary = new Float32Array(pixelCount);
      this._scores = new Float32Array(pixelCount);
      this._candidateIndices = new Int32Array(pixelCount);
      this._candidateX = new Int32Array(pixelCount);
      this._candidateY = new Int32Array(pixelCount);
      this._width = width;
      this._height = height;
    }
    if (maxFeatures > this._acceptedX.length) {
      this._acceptedX = new Int32Array(maxFeatures);
      this._acceptedY = new Int32Array(maxFeatures);
      this._acceptedNext = new Int32Array(maxFeatures);
      this._descriptorStorage = new Uint32Array(maxFeatures * BRIEF_WORDS);
    } else if (this._descriptorStorage.length < maxFeatures * BRIEF_WORDS) {
      this._descriptorStorage = new Uint32Array(maxFeatures * BRIEF_WORDS);
    }
  }

  _toGray(rgba, width, height, options) {
    const stride = clampInteger(options.stride, width * 4, width * 4, Number.MAX_SAFE_INTEGER);
    if (!rgba || typeof rgba.length !== 'number' || rgba.length < stride * height) {
      throw new TypeError('rgba must contain at least width * height * 4 channel samples');
    }
    const bottomUp = isBottomUp(options);
    const gray = this._gray;
    for (let y = 0; y < height; y += 1) {
      const sourceY = bottomUp ? height - 1 - y : y;
      let source = sourceY * stride;
      let target = y * width;
      for (let x = 0; x < width; x += 1, target += 1, source += 4) {
        // Rec. 601 luma is stable for the RGB screenshot and deliberately
        // ignores alpha, which is normally an opaque render target channel.
        gray[target] = 0.299 * rgba[source] + 0.587 * rgba[source + 1] + 0.114 * rgba[source + 2];
      }
    }
  }

  _ensureBriefKernel(sigma) {
    if (sigma <= 0) {
      this._briefKernelSigma = sigma;
      this._briefKernel = new Float32Array([1]);
      return;
    }
    if (sigma === this._briefKernelSigma) return;
    this._briefKernelSigma = sigma;
    const radius = Math.max(1, Math.ceil(sigma * 2.5));
    const kernel = new Float32Array(radius * 2 + 1);
    let sum = 0;
    const denominator = 2 * sigma * sigma;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const value = Math.exp(-(offset * offset) / denominator);
      kernel[offset + radius] = value;
      sum += value;
    }
    for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum;
    this._briefKernel = kernel;
  }

  _blurForBrief(width, height, sigma) {
    const gray = this._gray;
    const blurred = this._blurred;
    this._ensureBriefKernel(sigma);
    if (sigma <= 0) {
      blurred.set(gray);
      return blurred;
    }
    const kernel = this._briefKernel;
    const radius = (kernel.length - 1) >> 1;
    const temporary = this._blurTemporary;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        let value = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const sampleX = Math.max(0, Math.min(width - 1, x + offset));
          value += gray[row + sampleX] * kernel[offset + radius];
        }
        temporary[row + x] = value;
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let value = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const sampleY = Math.max(0, Math.min(height - 1, y + offset));
          value += temporary[sampleY * width + x] * kernel[offset + radius];
        }
        blurred[y * width + x] = value;
      }
    }
    return blurred;
  }

  _fastScore(x, y, width, threshold, segmentLength) {
    const center = this._gray[y * width + x];
    const ring = this._ring;
    let brightCount = 0;
    let darkCount = 0;
    for (let index = 0; index < FAST_CIRCLE_SIZE; index += 1) {
      const difference = this._gray[(y + CIRCLE_Y[index]) * width + x + CIRCLE_X[index]] - center;
      ring[index] = difference;
      if (difference > threshold) brightCount += 1;
      else if (difference < -threshold) darkCount += 1;
    }
    // Having N bright or N dark samples is necessary for an N-contiguous
    // segment.  This rejects the overwhelmingly common flat/edge pixels
    // before the 16 possible segment starts are examined.
    if (brightCount < segmentLength && darkCount < segmentLength) return 0;

    let score = 0;
    let corner = false;
    // 16 starts cover every possible wrapped contiguous segment.  Keeping
    // the score as the strongest minimum contrast is the FAST corner score
    // used for non-maximum suppression.
    for (let start = 0; start < FAST_CIRCLE_SIZE; start += 1) {
      let bright = true;
      let dark = true;
      let brightScore = Infinity;
      let darkScore = Infinity;
      for (let offset = 0; offset < segmentLength; offset += 1) {
        const difference = ring[(start + offset) & 15];
        if (bright) {
          if (!(difference > threshold)) bright = false;
          else if (difference < brightScore) brightScore = difference;
        }
        if (dark) {
          if (!(difference < -threshold)) dark = false;
          else if (-difference < darkScore) darkScore = -difference;
        }
        if (!bright && !dark) break;
      }
      if (bright) {
        corner = true;
        if (brightScore > score) score = brightScore;
      }
      if (dark) {
        corner = true;
        if (darkScore > score) score = darkScore;
      }
    }
    return corner ? score : 0;
  }

  _briefAngle(image, width, height, x, y, patchRadius) {
    let momentX = 0;
    let momentY = 0;
    let total = 0;
    const integerPatchRadius = Math.ceil(patchRadius);
    for (let offsetY = -integerPatchRadius; offsetY <= integerPatchRadius; offsetY += 1) {
      const row = (y + offsetY) * width;
      for (let offsetX = -integerPatchRadius; offsetX <= integerPatchRadius; offsetX += 1) {
        if (offsetX * offsetX + offsetY * offsetY > patchRadius * patchRadius) continue;
        const intensity = image[row + x + offsetX];
        total += intensity;
        momentX += offsetX * intensity;
        momentY += offsetY * intensity;
      }
    }
    if (total <= 1e-6) return 0;
    return Math.atan2(momentY, momentX);
  }

  _sampleBilinear(image, width, height, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const dx = x - x0;
    const dy = y - y0;
    const top = image[y0 * width + x0] * (1 - dx) + image[y0 * width + x1] * dx;
    const bottom = image[y1 * width + x0] * (1 - dx) + image[y1 * width + x1] * dx;
    return top * (1 - dy) + bottom * dy;
  }

  _briefDescriptor(image, width, height, x, y, orientation, angle, descriptorPatchRadius, output) {
    let sine = 0;
    let cosine = 1;
    if (orientation) {
      sine = Math.sin(angle);
      cosine = Math.cos(angle);
    }
    const patternScale = descriptorPatchRadius / 15;
    output.fill(0);
    for (let bit = 0; bit < BRIEF_BITS; bit += 1) {
      const patternOffset = bit * 4;
      const x1 = BRIEF_PATTERN[patternOffset] * patternScale;
      const y1 = BRIEF_PATTERN[patternOffset + 1] * patternScale;
      const x2 = BRIEF_PATTERN[patternOffset + 2] * patternScale;
      const y2 = BRIEF_PATTERN[patternOffset + 3] * patternScale;
      let first;
      let second;
      if (orientation) {
        // Rotate the BRIEF sampling pattern by the measured intensity-
        // centroid angle, as in oriented BRIEF.  Pixel coordinates use the
        // image's (right, down) basis, so this is the direct +angle matrix.
        const rotatedX1 = x1 * cosine - y1 * sine;
        const rotatedY1 = x1 * sine + y1 * cosine;
        const rotatedX2 = x2 * cosine - y2 * sine;
        const rotatedY2 = x2 * sine + y2 * cosine;
        first = this._sampleBilinear(image, width, height, x + rotatedX1, y + rotatedY1);
        second = this._sampleBilinear(image, width, height, x + rotatedX2, y + rotatedY2);
      } else if (patternScale === 1
        && Number.isInteger(x1) && Number.isInteger(y1)
        && Number.isInteger(x2) && Number.isInteger(y2)) {
        first = image[(y + y1) * width + x + x1];
        second = image[(y + y2) * width + x + x2];
      } else {
        // A non-native patch radius can put one or both endpoints between
        // pixels.  Interpolation keeps the scaled descriptor continuous as
        // the radius changes instead of silently rounding its pattern.
        first = this._sampleBilinear(image, width, height, x + x1, y + y1);
        second = this._sampleBilinear(image, width, height, x + x2, y + y2);
      }
      if (first < second) output[bit >> 5] |= (1 << (bit & 31));
    }
    return output;
  }

  _selectSpacedCandidates(width, height, minDistance, maxFeatures, candidateCount) {
    if (candidateCount === 0 || maxFeatures === 0) return 0;
    const sorted = Array.from(this._candidateIndices.subarray(0, candidateCount));
    const scores = this._scores;
    sorted.sort((first, second) => {
      const difference = scores[second] - scores[first];
      return difference || first - second;
    });

    if (minDistance <= 0) {
      const selected = Math.min(maxFeatures, sorted.length);
      for (let index = 0; index < selected; index += 1) {
        const pixel = sorted[index];
        this._candidateX[index] = pixel % width;
        this._candidateY[index] = Math.floor(pixel / width);
      }
      return selected;
    }

    // A small linked-list grid limits each spacing check to nearby accepted
    // points.  It also avoids a uniform quota: points are simply visited in
    // descending FAST score order.
    const cellSize = Math.max(1, minDistance);
    const columns = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const cellCount = columns * rows;
    if (this._cellHeads.length < cellCount) this._cellHeads = new Int32Array(cellCount);
    if (this._cellMarks.length < cellCount) this._cellMarks = new Int32Array(cellCount);
    this._cellStamp += 1;
    if (this._cellStamp === 0x7fffffff) {
      this._cellMarks.fill(0);
      this._cellStamp = 1;
    }
    const stamp = this._cellStamp;
    const acceptedX = this._acceptedX;
    const acceptedY = this._acceptedY;
    let selected = 0;
    const distanceSquared = minDistance * minDistance;
    for (const pixel of sorted) {
      if (selected >= maxFeatures) break;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const cellX = Math.floor(x / cellSize);
      const cellY = Math.floor(y / cellSize);
      let separated = true;
      for (let neighborY = Math.max(0, cellY - 1); neighborY <= Math.min(rows - 1, cellY + 1) && separated; neighborY += 1) {
        for (let neighborX = Math.max(0, cellX - 1); neighborX <= Math.min(columns - 1, cellX + 1) && separated; neighborX += 1) {
          const cell = neighborY * columns + neighborX;
          if (this._cellMarks[cell] !== stamp) continue;
          for (let accepted = this._cellHeads[cell]; accepted >= 0; accepted = this._acceptedNext[accepted]) {
            const dx = acceptedX[accepted] - x;
            const dy = acceptedY[accepted] - y;
            if (dx * dx + dy * dy < distanceSquared) {
              separated = false;
              break;
            }
          }
        }
      }
      if (!separated) continue;
      acceptedX[selected] = x;
      acceptedY[selected] = y;
      const cell = cellY * columns + cellX;
      if (this._cellMarks[cell] !== stamp) {
        this._cellMarks[cell] = stamp;
        this._cellHeads[cell] = -1;
      }
      this._acceptedNext[selected] = this._cellHeads[cell];
      this._cellHeads[cell] = selected;
      this._candidateX[selected] = x;
      this._candidateY[selected] = y;
      selected += 1;
    }
    return selected;
  }

  /**
   * Detect image-space FAST corners and attach 256-bit BRIEF descriptors.
   *
   * @param {Uint8Array|Uint8ClampedArray|ImageData} rgba RGBA source pixels.
   * @param {number} width image width in pixels.
   * @param {number} height image height in pixels.
   * @param {object} options detector options.
   * @returns {Array<{x:number,y:number,score:number,descriptor:Uint32Array,angle?:number}>}
   */
  detectFeatures(rgba, width, height, options = {}) {
    options = options || {};
    const source = readImageArguments(rgba, width, height);
    rgba = source.rgba;
    width = clampInteger(source.width, 0, 0, Number.MAX_SAFE_INTEGER);
    height = clampInteger(source.height, 0, 0, Number.MAX_SAFE_INTEGER);
    if (width === 0 || height === 0) return [];

    const threshold = Math.max(0, finiteOr(options.threshold, this.defaultOptions.threshold));
    const requestedMax = clampInteger(options.maxFeatures, this.defaultOptions.maxFeatures, 0, this.maxFeatureCapacity);
    const maxFeatures = Math.min(requestedMax, this.maxFeatureCapacity);
    const minDistance = Math.max(0, finiteOr(options.minDistance, this.defaultOptions.minDistance));
    const rawFastN = options.fastN ?? options.segmentLength ?? options.contiguous;
    const segmentLength = rawFastN === undefined ? this.defaultOptions.fastN : clampInteger(rawFastN, 9, 9, 12);
    const nmsRadius = clampInteger(options.nmsRadius, 1, 0, 4);
    const hasOrientationOption = options.orientation !== undefined
      || options.orientationNormalized !== undefined
      || options.orientationNorm !== undefined
      || options.useOrientation !== undefined;
    const orientation = hasOrientationOption
      ? Boolean(options.orientation || options.orientationNormalized || options.orientationNorm || options.useOrientation)
      : this.defaultOptions.orientation;
    const briefSigma = Math.max(0, finiteOr(options.briefSigma ?? options.blurSigma ?? options.gaussianSigma, this.defaultOptions.briefSigma));
    const descriptorPatchRadius = clampNumber(
      options.descriptorPatchRadius,
      this.defaultOptions.descriptorPatchRadius,
      4,
      15,
    );
    const orientationPatchOption = options.orientationPatchRadius
      ?? this.defaultOptions.orientationPatchRadius;
    const patchRadius = clampNumber(
      orientationPatchOption,
      descriptorPatchRadius,
      1,
      22,
    );
    const descriptorSupport = orientation ? descriptorPatchRadius * SQRT_TWO : descriptorPatchRadius;
    const descriptorMargin = Math.ceil(descriptorSupport) + 1;
    const orientationMargin = orientation ? Math.ceil(patchRadius) + 1 : 0;
    const margin = Math.max(FAST_CIRCLE_RADIUS, descriptorMargin, orientationMargin);

    this._ensureBuffers(width, height, maxFeatures);
    this._toGray(rgba, width, height, options);
    const briefImage = this._blurForBrief(width, height, briefSigma);
    this._scores.fill(0, 0, width * height);

    let candidateCount = 0;
    const minX = margin;
    const maxX = width - margin;
    const minY = margin;
    const maxY = height - margin;
    if (maxX > minX && maxY > minY && maxFeatures > 0) {
      for (let y = minY; y < maxY; y += 1) {
        for (let x = minX; x < maxX; x += 1) {
          const score = this._fastScore(x, y, width, threshold, segmentLength);
          if (score <= 0) continue;
          const pixel = y * width + x;
          this._scores[pixel] = score;
        }
      }
      // Scores must be complete before non-maximum suppression.  Doing the
      // suppression during the raster pass would let a later, stronger point
      // survive simply because its score had not been written yet.
      for (let y = minY; y < maxY; y += 1) {
        for (let x = minX; x < maxX; x += 1) {
          const pixel = y * width + x;
          const score = this._scores[pixel];
          if (score <= 0) continue;
          let localMaximum = true;
          if (nmsRadius > 0) {
            for (let offsetY = -nmsRadius; offsetY <= nmsRadius && localMaximum; offsetY += 1) {
              for (let offsetX = -nmsRadius; offsetX <= nmsRadius; offsetX += 1) {
                if (offsetX === 0 && offsetY === 0) continue;
                if (this._scores[(y + offsetY) * width + x + offsetX] > score) {
                  localMaximum = false;
                  break;
                }
              }
            }
          }
          if (!localMaximum) continue;
          this._candidateIndices[candidateCount] = pixel;
          candidateCount += 1;
        }
      }
    }

    const selected = this._selectSpacedCandidates(width, height, minDistance, maxFeatures, candidateCount);
    const features = new Array(selected);
    const descriptor = new Uint32Array(BRIEF_WORDS);
    for (let index = 0; index < selected; index += 1) {
      const x = this._candidateX[index];
      const y = this._candidateY[index];
      const angle = orientation ? this._briefAngle(briefImage, width, height, x, y, patchRadius) : 0;
      const descriptorOffset = index * BRIEF_WORDS;
      const output = this._descriptorStorage.subarray(descriptorOffset, descriptorOffset + BRIEF_WORDS);
      this._briefDescriptor(briefImage, width, height, x, y, orientation, angle, descriptorPatchRadius, output);
      // Copy out of the reusable storage: returned features remain valid when
      // the detector processes the next camera frame.
      descriptor.set(output);
      const feature = {
        x,
        y,
        score: this._scores[y * width + x],
        descriptor: new Uint32Array(descriptor),
      };
      if (orientation) feature.angle = angle;
      features[index] = feature;
    }
    return features;
  }

  detect(rgba, width, height, options = {}) {
    return this.detectFeatures(rgba, width, height, options);
  }
}

const defaultDetector = new PixelFeatureDetector();

/** Stateless convenience wrapper around a shared bounded detector. */
export const detectFeatures = (rgba, width, height, options = {}) => (
  defaultDetector.detectFeatures(rgba, width, height, options)
);

const getMatchOptions = (options) => {
  options = options || {};
  const thresholdValue = options.maxDistance
    ?? options.maxHammingDistance
    ?? options.hammingThreshold
    ?? options.distanceThreshold
    ?? options.threshold;
  const maxDistance = Math.max(0, finiteOr(thresholdValue, 64));
  const ratioValue = options.ratio ?? options.maxRatio;
  const ratioEnabled = ratioValue !== undefined || options.ratioTest === true;
  const ratio = Math.max(0, Math.min(1, finiteOr(ratioValue, 0.8)));
  const mutual = options.mutual !== false
    && options.reciprocal !== false
    && options.crossCheck !== false;
  return { maxDistance, ratioEnabled, ratio, mutual, compatible: options.compatible };
};

/**
 * Match two feature lists by descriptor Hamming distance.  Matching is
 * reciprocal by default, and an optional `compatible(previous, current, i,
 * j)` gate can reject pairs using depth/unprojection information owned by the
 * caller.
 */
export const matchFeatures = (previous, current, options = {}) => {
  if (!Array.isArray(previous) && !ArrayBuffer.isView(previous)) previous = [];
  if (!Array.isArray(current) && !ArrayBuffer.isView(current)) current = [];
  const { maxDistance, ratioEnabled, ratio, mutual, compatible } = getMatchOptions(options);
  const previousBest = new Int32Array(previous.length);
  const previousDistance = new Float64Array(previous.length);
  const previousSecond = new Float64Array(previous.length);
  previousBest.fill(-1);
  previousDistance.fill(Infinity);
  previousSecond.fill(Infinity);
  const currentBest = new Int32Array(current.length);
  const currentDistance = new Float64Array(current.length);
  currentBest.fill(-1);
  currentDistance.fill(Infinity);

  for (let previousIndex = 0; previousIndex < previous.length; previousIndex += 1) {
    const first = previous[previousIndex];
    if (!hasDescriptor(first)) continue;
    for (let currentIndex = 0; currentIndex < current.length; currentIndex += 1) {
      const second = current[currentIndex];
      if (!hasDescriptor(second)) continue;
      if (typeof compatible === 'function' && !compatible(first, second, previousIndex, currentIndex)) continue;
      const distance = hammingDistance(first.descriptor, second.descriptor);
      if (distance > maxDistance) continue;
      if (distance < previousDistance[previousIndex]) {
        previousSecond[previousIndex] = previousDistance[previousIndex];
        previousDistance[previousIndex] = distance;
        previousBest[previousIndex] = currentIndex;
      } else if (distance < previousSecond[previousIndex]) {
        previousSecond[previousIndex] = distance;
      }
      if (distance < currentDistance[currentIndex]
        || (distance === currentDistance[currentIndex] && previousIndex < currentBest[currentIndex])) {
        currentDistance[currentIndex] = distance;
        currentBest[currentIndex] = previousIndex;
      }
    }
  }

  const pairs = [];
  for (let previousIndex = 0; previousIndex < previous.length; previousIndex += 1) {
    const currentIndex = previousBest[previousIndex];
    if (currentIndex < 0) continue;
    if (mutual && currentBest[currentIndex] !== previousIndex) continue;
    if (ratioEnabled && previousSecond[previousIndex] < Infinity
      && previousDistance[previousIndex] > previousSecond[previousIndex] * ratio) continue;
    pairs.push({ previous: previousIndex, current: currentIndex, distance: previousDistance[previousIndex] });
  }
  return pairs;
};

export default PixelFeatureDetector;
