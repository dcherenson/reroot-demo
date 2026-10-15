/** Shared optical calibration. Planner and rendered sensor use these planes. */
export const FEATURE_ASSOCIATION_RADIUS = 3;
export const SENSOR = Object.freeze({
  width: 320,
  height: 240,
  pitch: 55 * Math.PI / 180,
  horizontalFov: Math.PI / 2,
  near: .2,
  far: 180,
  range: 75,
});

// These are user-facing degrees/metres. The renderer and geometric tests use
// the calibrated radian form returned by sensorCalibration(). Keeping the
// limits here gives the worker, planner and UI one source of truth.
export const SENSOR_DEFAULTS = Object.freeze({
  horizontalFov: 90,
  sensingRange: 75,
  downwardPitch: 55,
});
export const SENSOR_LIMITS = Object.freeze({
  horizontalFov: Object.freeze({ min: 60, max: 120 }),
  sensingRange: Object.freeze({ min: 40, max: 100 }),
  downwardPitch: Object.freeze({ min: 35, max: 75 }),
});
export const SENSOR_VERTICAL_FOV = 2 * Math.atan(Math.tan(SENSOR.horizontalFov / 2) * SENSOR.height / SENSOR.width);

const DEG = Math.PI / 180;
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, { min, max }) => Math.max(min, Math.min(max, value));

/**
 * Convert a simulation/UI sensor configuration to optical planes.
 *
 * The returned object is intentionally separate from SENSOR: SENSOR is the
 * immutable default calibration retained for callers that only need the
 * legacy/default camera. A calibration is marked so it can be passed through
 * repeated inFov/inSensorImage calls without converting degrees again.
 */
export function sensorCalibration(config = {}) {
  if (config?.calibrated === true) return config;
  const horizontalFov = clamp(
    finiteOr(config?.horizontalFov, SENSOR_DEFAULTS.horizontalFov),
    SENSOR_LIMITS.horizontalFov,
  );
  const sensingRange = clamp(
    finiteOr(config?.sensingRange, SENSOR_DEFAULTS.sensingRange),
    SENSOR_LIMITS.sensingRange,
  );
  const downwardPitch = clamp(
    finiteOr(config?.downwardPitch, SENSOR_DEFAULTS.downwardPitch),
    SENSOR_LIMITS.downwardPitch,
  );
  const horizontalFovRadians = horizontalFov * DEG;
  const verticalFov = 2 * Math.atan(Math.tan(horizontalFovRadians / 2) * SENSOR.height / SENSOR.width);
  return Object.freeze({
    ...SENSOR,
    calibrated: true,
    horizontalFov: horizontalFovRadians,
    horizontalFovRadians,
    verticalFov,
    pitch: downwardPitch * DEG,
    downwardPitch,
    range: sensingRange,
    sensingRange,
  });
}

function resolveCalibration(config) {
  return config?.calibrated === true ? config : sensorCalibration(config);
}

export function inSensorImage(pose, point, yaw, altitude = 35, margin = 0, config = undefined) {
  // Permit the ergonomic `(pose, point, yaw, altitude, config)` form while
  // retaining the original fifth `margin` argument for existing callers.
  if (margin && typeof margin === 'object') { config = margin; margin = 0; }
  const sensor = resolveCalibration(config);
  const dx = point.x - pose[0], dy = point.y - pose[1];
  const forward = dx * Math.cos(yaw) + dy * Math.sin(yaw);
  const right = dx * Math.sin(yaw) - dy * Math.cos(yaw);
  const height = altitude - (point.z || 0);
  const c = Math.cos(sensor.pitch), s = Math.sin(sensor.pitch);
  const depth = forward * c + height * s, vertical = forward * s - height * c;
  const h = Math.tan(sensor.horizontalFovRadians / 2), v = Math.tan(sensor.verticalFov / 2);
  return depth > sensor.near + margin * c && depth < sensor.far - margin * c &&
    depth * h - Math.abs(right) >= margin * Math.hypot(1, c * h) &&
    depth * v - vertical >= margin * Math.abs(c * v - s) &&
    depth * v + vertical >= margin * Math.abs(c * v + s);
}

/** Read Three r186 RGBA-packed depth and unproject its top-left image pixel. */
export function unprojectDepth(frame, x, y, worldWidth, worldHeight) {
  const i = (Math.floor(y) * frame.width + Math.floor(x)) * 4, a = frame.depth;
  const d = a[i] / 256 + a[i + 1] / 65536 + a[i + 2] / 16777216 + a[i + 3] / 4278190080;
  if (!Number.isFinite(d) || d >= .999999 || d <= 0) return null;
  const px = 2 * (x + .5) / frame.width - 1, py = 1 - 2 * (y + .5) / frame.height, pz = 2 * d - 1;
  const m = frame.inverseViewProjection;
  const w = m[3]*px+m[7]*py+m[11]*pz+m[15];
  if (!Number.isFinite(w) || Math.abs(w)<1e-9) return null;
  const sx=(m[0]*px+m[4]*py+m[8]*pz+m[12])/w;
  const sy=(m[1]*px+m[5]*py+m[9]*pz+m[13])/w;
  const sz=(m[2]*px+m[6]*py+m[10]*pz+m[14])/w;
  return {x:sx+worldWidth/2,y:worldHeight/2-sz,z:sy};
}
