/**
 * Small, dependency-free Dubins path implementation.
 *
 * Poses are represented as [x, y, yaw].  Yaw is measured counter-clockwise
 * from the positive x axis, left turns are positive curvature, and right
 * turns are negative curvature.  Distances in a path object are physical
 * distances in the same units as the input coordinates and radius.
 */

const PI = Math.PI;
const TWO_PI = 2 * PI;
const EPSILON = 1e-12;
// The Julia planner deliberately passes a 1e-3 loop tolerance to Dubins.  Keep
// a turn with only this small residual from becoming a full extra loop in the
// returned path; the resulting endpoint allowance is part of that contract.
const LOOP_TOLERANCE = 1e-3;

/** Human-readable labels for the two turning directions. */
export const leftCCW = 'leftCCW';
export const rightCW = 'rightCW';
export const TURN_LABELS = Object.freeze({
  L: leftCCW,
  S: 'straight',
  R: rightCW,
});

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function poseArray(pose) {
  if (!pose || typeof pose.length !== 'number' || pose.length < 3) {
    return null;
  }
  const result = [Number(pose[0]), Number(pose[1]), Number(pose[2])];
  return result.every(isFiniteNumber) ? result : null;
}

function positiveFinite(value) {
  return isFiniteNumber(value) && value > 0;
}

function mod2pi(value) {
  if (!isFiniteNumber(value)) return NaN;
  let result = value % TWO_PI;
  if (result < 0) result += TWO_PI;
  if (Object.is(result, -0)) result = 0;
  return result;
}

/**
 * Normalize one path segment with the planner's approximate loop allowance.
 * This mirrors Julia's cleanup_loop(angle, 1e-3): a value within 1e-3 radians
 * of 2*pi is represented as zero, allowing the corresponding small endpoint
 * residual instead of charging a complete turn.
 */
function segmentAngle(value) {
  const result = mod2pi(value);
  if (!isFiniteNumber(result)) return NaN;
  return result >= TWO_PI - LOOP_TOLERANCE ? 0 : result;
}

/**
 * Wrap an angle to the signed interval [-pi, pi].
 *
 * atan2 is used instead of a remainder expression so that +pi and -pi retain
 * their natural signed endpoint when supplied exactly.
 */
export function wrapAngle(angle) {
  if (!isFiniteNumber(angle)) return NaN;
  let result = Math.atan2(Math.sin(angle), Math.cos(angle));
  // atan2 can return a negative zero for an angle on the positive x axis.
  if (Object.is(result, -0)) result = 0;
  // Keep tiny trigonometric noise from leaking outside the documented range.
  if (result > PI) result = PI;
  if (result < -PI) result = -PI;
  return result;
}

/** Return the signed shortest rotation from angle a to angle b. */
export function angleDiff(a, b) {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return NaN;
  return wrapAngle(b - a);
}

/** Euclidean distance between the x/y coordinates of two poses or points. */
export function distance(a, b) {
  if (!a || !b || a.length < 2 || b.length < 2) return NaN;
  const ax = Number(a[0]);
  const ay = Number(a[1]);
  const bx = Number(b[0]);
  const by = Number(b[1]);
  if (![ax, ay, bx, by].every(isFiniteNumber)) return NaN;
  return Math.hypot(bx - ax, by - ay);
}

function seedToUint32(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    // Truncate toward zero, then use the unsigned 32-bit representation.
    return Math.trunc(seed) >>> 0;
  }
  const text = String(seed ?? '');
  // FNV-1a gives strings a stable seed without relying on implementation-
  // specific hashing or locale behavior.
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Create a deterministic pseudo-random generator returning values in [0, 1).
 * Mulberry32 is compact, fast, and has no mutable state outside the closure.
 */
export function seededRandom(seed = 0) {
  let state = seedToUint32(seed);
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clampDistance(value, total) {
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= total) return total;
  return value;
}

function nearNonNegative(value, scale = 1) {
  if (value >= 0) return value;
  const tolerance = EPSILON * Math.max(1, Math.abs(scale));
  return value >= -tolerance ? 0 : NaN;
}

function candidate(type, t, p, q, radius) {
  if (![t, p, q, radius].every(isFiniteNumber)) return null;
  const lengths = [t * radius, p * radius, q * radius];
  if (!lengths.every((value) => isFiniteNumber(value) && value >= 0)) {
    return null;
  }
  const length = lengths[0] + lengths[1] + lengths[2];
  if (!isFiniteNumber(length)) return null;
  return { type, lengths, length };
}

/**
 * Compute the six normalized Dubins candidates.
 *
 * This is the standard closed-form construction from Shkel and Lumelsky.
 * Angles and the straight segment are normalized by the requested turning
 * radius; the returned lengths are converted back to physical units.
 */
function candidates(start, end, radius) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const planarDistance = Math.hypot(dx, dy);
  if (!isFiniteNumber(planarDistance)) return [];

  const d = planarDistance / radius;
  if (!isFiniteNumber(d)) return [];
  const theta = planarDistance > 0 ? Math.atan2(dy, dx) : start[2];
  const alpha = mod2pi(start[2] - theta);
  const beta = mod2pi(end[2] - theta);
  if (![alpha, beta].every(isFiniteNumber)) return [];

  const result = [];
  const add = (type, t, p, q) => {
    const item = candidate(type, t, p, q, radius);
    if (item) result.push(item);
  };

  // LSL
  {
    const pSquared =
      2 + d * d - 2 * Math.cos(alpha - beta) +
      2 * d * (Math.sin(alpha) - Math.sin(beta));
    const pSquaredSafe = nearNonNegative(pSquared, 2 + d * d);
    if (isFiniteNumber(pSquaredSafe)) {
      const p = Math.sqrt(pSquaredSafe);
      const tmp = Math.atan2(
        Math.cos(beta) - Math.cos(alpha),
        d + Math.sin(alpha) - Math.sin(beta),
      );
      add('LSL', segmentAngle(-alpha + tmp), p, segmentAngle(beta - tmp));
    }
  }

  // RSR
  {
    const pSquared =
      2 + d * d - 2 * Math.cos(alpha - beta) +
      2 * d * (-Math.sin(alpha) + Math.sin(beta));
    const pSquaredSafe = nearNonNegative(pSquared, 2 + d * d);
    if (isFiniteNumber(pSquaredSafe)) {
      const p = Math.sqrt(pSquaredSafe);
      const tmp = Math.atan2(
        Math.cos(alpha) - Math.cos(beta),
        d - Math.sin(alpha) + Math.sin(beta),
      );
      add('RSR', segmentAngle(alpha - tmp), p, segmentAngle(-beta + tmp));
    }
  }

  // LSR
  {
    const pSquared =
      -2 + d * d + 2 * Math.cos(alpha - beta) +
      2 * d * (Math.sin(alpha) + Math.sin(beta));
    const pSquaredSafe = nearNonNegative(pSquared, 2 + d * d);
    if (isFiniteNumber(pSquaredSafe)) {
      const p = Math.sqrt(pSquaredSafe);
      const tmp =
        Math.atan2(
          -Math.cos(alpha) - Math.cos(beta),
          d + Math.sin(alpha) + Math.sin(beta),
        ) - Math.atan2(-2, p);
      add('LSR', segmentAngle(-alpha + tmp), p, segmentAngle(-beta + tmp));
    }
  }

  // RSL
  {
    const pSquared =
      -2 + d * d + 2 * Math.cos(alpha - beta) -
      2 * d * (Math.sin(alpha) + Math.sin(beta));
    const pSquaredSafe = nearNonNegative(pSquared, 2 + d * d);
    if (isFiniteNumber(pSquaredSafe)) {
      const p = Math.sqrt(pSquaredSafe);
      const tmp =
        Math.atan2(
          Math.cos(alpha) + Math.cos(beta),
          d - Math.sin(alpha) - Math.sin(beta),
        ) - Math.atan2(2, p);
      add('RSL', segmentAngle(alpha - tmp), p, segmentAngle(beta - tmp));
    }
  }

  // RLR
  {
    const value =
      (6 - d * d + 2 * Math.cos(alpha - beta) +
        2 * d * (Math.sin(alpha) - Math.sin(beta))) /
      8;
    const valueSafe = Math.abs(value) <= 1 + EPSILON ? Math.max(-1, Math.min(1, value)) : NaN;
    if (isFiniteNumber(valueSafe)) {
      // Keep the wrapped values for the geometry, and clean only the values
      // returned as segment lengths.  Cleaning p before deriving t changes
      // the first/third-turn split when p is just below 2*pi.
      const p = mod2pi(TWO_PI - Math.acos(valueSafe));
      const tmp = Math.atan2(
        Math.cos(alpha) - Math.cos(beta),
        d - Math.sin(alpha) + Math.sin(beta),
      );
      // Derive the third turn from the same wrapped first turn used by the
      // reference formula; apply loop cleanup only after all three angles are
      // derived so a near-2*pi first turn cannot perturb this subtraction.
      const first = mod2pi(alpha - tmp + p / 2);
      const third = mod2pi(alpha - beta - first + p);
      add('RLR', segmentAngle(first), segmentAngle(p), segmentAngle(third));
    }
  }

  // LRL
  {
    const value =
      (6 - d * d + 2 * Math.cos(alpha - beta) -
        2 * d * (Math.sin(alpha) - Math.sin(beta))) /
      8;
    const valueSafe = Math.abs(value) <= 1 + EPSILON ? Math.max(-1, Math.min(1, value)) : NaN;
    if (isFiniteNumber(valueSafe)) {
      const p = mod2pi(TWO_PI - Math.acos(valueSafe));
      const tmp = Math.atan2(
        Math.cos(alpha) - Math.cos(beta),
        d + Math.sin(alpha) - Math.sin(beta),
      );
      // As above, keep the wrapped first angle in the third-angle equation
      // and normalize the returned segment values afterward.
      const first = mod2pi(-alpha - tmp + p / 2);
      const third = mod2pi(beta - alpha - first + p);
      add('LRL', segmentAngle(first), segmentAngle(p), segmentAngle(third));
    }
  }

  return result;
}

function pathFromCandidate(start, end, radius, item) {
  const types = item.type.split('');
  const lengths = [...item.lengths];
  const length = lengths[0] + lengths[1] + lengths[2];
  if (!isFiniteNumber(length)) return null;
  return {
    start: [...start],
    end: [...end],
    radius,
    types,
    lengths,
    length,
  };
}

/**
 * Return the shortest feasible Dubins path between two poses.
 * Invalid or numerically unrepresentable inputs return null.
 */
export function shortestPath(startPose, endPose, radius) {
  const start = poseArray(startPose);
  const end = poseArray(endPose);
  if (!start || !end || !positiveFinite(radius)) return null;

  // Subtractions can overflow even when both endpoints are finite.  Returning
  // null keeps every path field finite and avoids propagating infinities.
  if (!isFiniteNumber(end[0] - start[0]) || !isFiniteNumber(end[1] - start[1])) {
    return null;
  }

  const all = candidates(start, end, radius);
  if (all.length === 0) return null;
  let best = all[0];
  for (let index = 1; index < all.length; index += 1) {
    // Keep candidate order deterministic on exact ties.
    if (all[index].length < best.length) best = all[index];
  }
  return pathFromCandidate(start, end, radius, best);
}

function pathParts(path) {
  if (!path || !Array.isArray(path.types) || !Array.isArray(path.lengths)) return null;
  if (path.types.length !== path.lengths.length || path.types.length === 0) return null;
  const start = poseArray(path.start);
  const end = poseArray(path.end);
  const radius = Number(path.radius);
  if (!start || !end || !positiveFinite(radius)) return null;
  const lengths = path.lengths.map(Number);
  if (!lengths.every((value) => isFiniteNumber(value) && value >= 0)) return null;
  const types = path.types.map(String);
  if (!types.every((type) => type === 'L' || type === 'S' || type === 'R')) return null;
  const length = lengths.reduce((sum, value) => sum + value, 0);
  if (!isFiniteNumber(length)) return null;
  return { start, end, radius, types, lengths, length };
}

function advancePose(pose, type, segmentLength, radius) {
  if (segmentLength <= 0) return [...pose];
  const yaw = pose[2];
  if (type === 'S') {
    return [
      pose[0] + segmentLength * Math.cos(yaw),
      pose[1] + segmentLength * Math.sin(yaw),
      wrapAngle(yaw),
    ];
  }
  const curvature = type === 'L' ? 1 / radius : -1 / radius;
  const delta = curvature * segmentLength;
  const nextYaw = yaw + delta;
  const x = pose[0] + (Math.sin(nextYaw) - Math.sin(yaw)) / curvature;
  const y = pose[1] + (Math.cos(yaw) - Math.cos(nextYaw)) / curvature;
  return [x, y, wrapAngle(nextYaw)];
}

/** Sample one Dubins path at physical distance s, clamped to its endpoints. */
export function samplePath(path, s) {
  const parts = pathParts(path);
  if (!parts) return null;
  const target = clampDistance(Number(s), parts.length);
  if (target <= 0) return [...parts.start];
  if (target >= parts.length) return [...parts.end];

  let remaining = target;
  let pose = [...parts.start];
  for (let index = 0; index < parts.lengths.length; index += 1) {
    const segmentLength = parts.lengths[index];
    if (segmentLength <= 0) continue;
    if (remaining < segmentLength) {
      return advancePose(pose, parts.types[index], remaining, parts.radius);
    }
    pose = advancePose(pose, parts.types[index], segmentLength, parts.radius);
    remaining -= segmentLength;
  }
  return [...parts.end];
}

/** Return signed curvature at physical distance s on one path. */
export function curvatureAt(path, s) {
  const parts = pathParts(path);
  if (!parts || parts.length === 0) return 0;
  const target = clampDistance(Number(s), parts.length);
  let cumulative = 0;
  let lastCurvature = 0;
  for (let index = 0; index < parts.lengths.length; index += 1) {
    const segmentLength = parts.lengths[index];
    if (segmentLength <= 0) continue;
    const type = parts.types[index];
    const curvature = type === 'L' ? 1 / parts.radius : type === 'R' ? -1 / parts.radius : 0;
    lastCurvature = curvature;
    // At an interior boundary choose the segment on the right (the segment
    // reached immediately after the boundary).  The final endpoint uses the
    // last non-empty segment below.
    if (target < cumulative + segmentLength) return curvature;
    cumulative += segmentLength;
  }
  return lastCurvature;
}

function pathLike(path) {
  return pathParts(path);
}

/** Sum lengths of a path array (or return one path's length). */
export function pathLength(paths) {
  if (pathLike(paths)) return pathLike(paths).length;
  if (!Array.isArray(paths)) return NaN;
  let total = 0;
  for (const path of paths) {
    const parts = pathLike(path);
    if (!parts) return NaN;
    total += parts.length;
    if (!isFiniteNumber(total)) return NaN;
  }
  return total;
}

/** Sample a concatenated path sequence at global distance s. */
export function samplePaths(paths, s) {
  if (!Array.isArray(paths) || paths.length === 0) return null;
  const parsed = paths.map(pathLike);
  if (parsed.some((parts) => !parts)) return null;
  const total = parsed.reduce((sum, parts) => sum + parts.length, 0);
  if (!isFiniteNumber(total)) return null;
  const target = clampDistance(Number(s), total);
  let cumulative = 0;
  for (let index = 0; index < parsed.length; index += 1) {
    const parts = parsed[index];
    if (parts.length === 0) continue;
    if (target < cumulative + parts.length || index === parsed.length - 1) {
      return samplePath(parts, target - cumulative);
    }
    cumulative += parts.length;
  }
  // This is reachable only when every path has zero length.
  return [...parsed[0].start];
}

/** Return signed curvature at global distance s across a path sequence. */
export function curvatureOnPaths(paths, s) {
  if (!Array.isArray(paths) || paths.length === 0) return 0;
  const parsed = paths.map(pathLike);
  if (parsed.some((parts) => !parts)) return 0;
  const total = parsed.reduce((sum, parts) => sum + parts.length, 0);
  if (!isFiniteNumber(total) || total === 0) return 0;
  const target = clampDistance(Number(s), total);
  let cumulative = 0;
  let last = 0;
  for (let index = 0; index < parsed.length; index += 1) {
    const parts = parsed[index];
    if (parts.length === 0) continue;
    last = curvatureAt(parts, target - cumulative);
    if (target < cumulative + parts.length || index === parsed.length - 1) return last;
    cumulative += parts.length;
  }
  return last;
}

function clonePath(parts, lengths = parts.lengths, end = parts.end) {
  const safeLengths = lengths.map((value) => Math.max(0, value));
  const length = safeLengths.reduce((sum, value) => sum + value, 0);
  return {
    start: [...parts.start],
    end: [...end],
    radius: parts.radius,
    types: [...parts.types],
    lengths: safeLengths,
    length,
  };
}

/**
 * Return the prefix of a concatenated path sequence through distance s.
 * Each returned object has the same shape as a normal path and is detached
 * from the input objects, so callers may safely animate or modify it.
 */
export function prefixPaths(paths, s) {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const parsed = paths.map(pathLike);
  if (parsed.some((parts) => !parts)) return [];
  const total = parsed.reduce((sum, parts) => sum + parts.length, 0);
  if (!isFiniteNumber(total)) return [];
  const target = clampDistance(Number(s), total);
  if (target <= 0) return [];

  const result = [];
  let remaining = target;
  for (const parts of parsed) {
    if (parts.length === 0) continue;
    if (remaining >= parts.length) {
      result.push(clonePath(parts));
      remaining -= parts.length;
      if (remaining <= 0) break;
      continue;
    }

    const clippedLengths = [];
    let clippedDistance = remaining;
    for (const segmentLength of parts.lengths) {
      const take = Math.min(segmentLength, Math.max(0, clippedDistance));
      clippedLengths.push(take);
      clippedDistance -= take;
    }
    const clippedEnd = samplePath(parts, remaining);
    result.push(clonePath(parts, clippedLengths, clippedEnd));
    break;
  }
  return result;
}

/**
 * Integrate a constant-speed, constant-turn-rate unicycle exactly for dt.
 * The returned yaw is wrapped to [-pi, pi].
 */
export function integrate(poseInput, speed, turnRate, dt) {
  const pose = poseArray(poseInput);
  if (!pose || ![speed, turnRate, dt].every(isFiniteNumber)) {
    throw new TypeError('integrate expects finite pose, speed, turnRate, and dt');
  }
  if (dt === 0) return [...pose.slice(0, 2), wrapAngle(pose[2])];
  if (turnRate === 0) {
    return [
      pose[0] + speed * dt * Math.cos(pose[2]),
      pose[1] + speed * dt * Math.sin(pose[2]),
      wrapAngle(pose[2]),
    ];
  }
  const delta = turnRate * dt;
  const nextYaw = pose[2] + delta;
  return [
    pose[0] + (speed / turnRate) * (Math.sin(nextYaw) - Math.sin(pose[2])),
    pose[1] + (speed / turnRate) * (Math.cos(pose[2]) - Math.cos(nextYaw)),
    wrapAngle(nextYaw),
  ];
}

export default Object.freeze({
  leftCCW,
  rightCW,
  TURN_LABELS,
  wrapAngle,
  angleDiff,
  distance,
  seededRandom,
  shortestPath,
  samplePath,
  curvatureAt,
  pathLength,
  samplePaths,
  curvatureOnPaths,
  prefixPaths,
  integrate,
});
