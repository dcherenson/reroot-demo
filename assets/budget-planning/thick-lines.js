import * as THREE from './vendor/three.module.js';

/*
 * Wide lines in the WebGL renderer are meshes, rather than GL lines.  The
 * stock LineBasicMaterial linewidth property is ignored by most WebGL
 * implementations, so this module keeps one instanced quad for every line
 * segment and expands that quad in the vertex shader.  The expansion happens
 * in normalized device coordinates and is therefore measured in screen
 * pixels at every camera distance.
 *
 * A line returned by makeThickLine is a small record for compatibility with
 * the renderer's existing path records.  `line.object` is the mesh to add to
 * a scene; `line.geometry`, `line.material`, and the count fields are exposed
 * directly as well.  updateThickLine mutates only the preallocated instance
 * attributes and never replaces a BufferAttribute.
 */

const DEFAULT_CAPACITY = 1024;
const DEFAULT_WIDTH = 1;
const DEFAULT_OPACITY = 1;
const DEFAULT_DASH_SIZE = 3.3;
const DEFAULT_GAP_SIZE = 2.2;
const INDEX_COUNT = 18;
const EPSILON = 1e-6;

const RIBBON_POSITIONS = new Float32Array([
  -1, 2, 0, 1, 2, 0,
  -1, 1, 0, 1, 1, 0,
  -1, 0, 0, 1, 0, 0,
  -1, -1, 0, 1, -1, 0,
]);

const RIBBON_UVS = new Float32Array([
  -1, 2, 1, 2,
  -1, 1, 1, 1,
  -1, 0, 1, 0,
  -1, -1, 1, -1,
]);

// Four rows provide square end caps.  Rows 1 and 2 are the actual segment;
// rows 0 and 3 extend it by half a line width at either end.
const RIBBON_INDICES = [
  0, 2, 1, 2, 3, 1,
  2, 4, 3, 4, 5, 3,
  4, 6, 5, 6, 7, 5,
];

const VERTEX_SHADER = /* glsl */ `
  uniform vec2 resolution;
  uniform float linewidth;
  uniform bool useVertexColors;
  uniform bool useDashes;

  attribute vec3 instanceStart;
  attribute vec3 instanceEnd;
  attribute vec3 instanceColorStart;
  attribute vec3 instanceColorEnd;
  attribute float instanceDistanceStart;
  attribute float instanceDistanceEnd;

  varying vec3 vColor;
  varying float vLineDistance;

  // Return a point on the segment at the camera near plane.  The projection
  // matrix formula is the one used by Three's LineMaterial and also works for
  // reversed depth projections.  Keeping the trim in the shader means a
  // segment crossing the camera never produces an infinite clip-space value.
  float nearPlaneZ() {
    float a = projectionMatrix[2][2];
    float b = projectionMatrix[3][2];
    if (abs(a) < 0.000001) return -0.0001;
    float estimate = (a > 0.0) ? (-b / (a + 1.0)) : (-0.5 * b / a);
    return min(estimate, -0.0001);
  }

  void main() {
    vColor = useVertexColors
      ? ((position.y < 0.5) ? instanceColorStart : instanceColorEnd)
      : vec3(1.0);
    vLineDistance = useDashes
      ? ((position.y < 0.5) ? instanceDistanceStart : instanceDistanceEnd)
      : 0.0;

    vec4 start = modelViewMatrix * vec4(instanceStart, 1.0);
    vec4 end = modelViewMatrix * vec4(instanceEnd, 1.0);
    bool perspective = projectionMatrix[2][3] == -1.0;

    if (perspective) {
      float clipZ = nearPlaneZ();

      // Both endpoints are behind the near plane.  Put all six vertices well
      // outside the clip volume; this branch is also the guard for a segment
      // whose endpoints are both behind the camera.
      if (start.z > clipZ && end.z > clipZ) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }

      if (start.z > clipZ) {
        float denominator = end.z - start.z;
        float alpha = abs(denominator) > 0.000001
          ? clamp((clipZ - start.z) / denominator, 0.0, 1.0)
          : 0.0;
        start = mix(start, end, alpha);
      }
      if (end.z > clipZ) {
        float denominator = start.z - end.z;
        float alpha = abs(denominator) > 0.000001
          ? clamp((clipZ - end.z) / denominator, 0.0, 1.0)
          : 0.0;
        end = mix(end, start, alpha);
      }
    }

    vec4 clipStart = projectionMatrix * start;
    vec4 clipEnd = projectionMatrix * end;
    float startW = max(abs(clipStart.w), 0.000001);
    float endW = max(abs(clipEnd.w), 0.000001);
    vec2 ndcStart = clipStart.xy / startW;
    vec2 ndcEnd = clipEnd.xy / endW;

    float aspect = max(resolution.x / max(resolution.y, 1.0), 0.000001);
    vec2 direction = ndcEnd - ndcStart;
    direction.x *= aspect;
    float directionLength = length(direction);
    direction = directionLength > 0.000001
      ? direction / directionLength
      : vec2(1.0, 0.0);

    // position.x is -1 or +1.  NDC spans two screen units, so multiplying by
    // linewidth/resolution.y gives each edge half the requested pixel width
    // after the viewport's one-half conversion.
    vec2 offset = vec2(direction.y, -direction.x);
    direction.x /= aspect;
    offset.x /= aspect;
    if (position.x < 0.0) offset *= -1.0;

    // Extend the first and last rows to form square caps.  Dashed lines use
    // butt caps so the gap at each dash remains visible.
    if (!useDashes) {
      if (position.y < 0.0) offset += -direction;
      else if (position.y > 1.0) offset += direction;
    }
    offset *= linewidth;
    offset /= max(resolution.y, 1.0);

    vec4 clip = (position.y < 0.5) ? clipStart : clipEnd;
    clip.xy += offset * clip.w;
    // The depth of each ribbon edge follows the corresponding endpoint.  It
    // prevents overlapping coplanar ribbons from producing diagonal depth
    // gradients while retaining ordinary depth testing when enabled.
    clip.z = (position.y < 0.5) ? clipStart.z : clipEnd.z;
    gl_Position = clip;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 diffuse;
  uniform float opacity;
  uniform bool useVertexColors;
  uniform bool useDashes;
  uniform float dashSize;
  uniform float gapSize;

  varying vec3 vColor;
  varying float vLineDistance;

  void main() {
    if (useDashes) {
      float period = max(dashSize + gapSize, 0.000001);
      if (mod(vLineDistance, period) > dashSize) discard;
    }
    vec3 color = useVertexColors ? vColor : vec3(1.0);
    gl_FragColor = vec4(diffuse * color, opacity);
    #include <colorspace_fragment>
  }
`;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Math.floor(finite(value, fallback));
  return number > 0 ? number : fallback;
}

function arrayLike(value) {
  return value && typeof value.length === 'number' ? value : [];
}

function color(value, fallback = 0xffffff) {
  if (value && value.isColor) return value.clone();
  try {
    return new THREE.Color(value === undefined || value === null ? fallback : value);
  } catch (_error) {
    return new THREE.Color(fallback);
  }
}

function setDynamicUsage(attribute) {
  if (attribute && typeof attribute.setUsage === 'function' && THREE.DynamicDrawUsage !== undefined) {
    attribute.setUsage(THREE.DynamicDrawUsage);
  }
  return attribute;
}

function allocateInstanceAttribute(array, itemSize) {
  return setDynamicUsage(new THREE.InstancedBufferAttribute(array, itemSize));
}

function getLineRecord(line) {
  if (!line) return null;
  if (line._thickLine) return line;
  if (line.userData && line.userData.thickLine) return line.userData.thickLine;
  return null;
}

function setAttributeNeedsUpdate(attribute, activeItems = 0) {
  if (!attribute || activeItems <= 0) return;
  // Three r186 consumes updateRanges with bufferSubData, allowing a large
  // preallocated tree to upload only the active prefix on each snapshot.
  // Keep the fallback for older local builds where updateRanges is absent.
  if (typeof attribute.clearUpdateRanges === 'function') attribute.clearUpdateRanges();
  if (typeof attribute.addUpdateRange === 'function') {
    attribute.addUpdateRange(0, Math.min(attribute.array.length, activeItems));
  }
  attribute.needsUpdate = true;
}

/**
 * Create a constant-screen-width line mesh.
 *
 * `capacity` counts source vertices.  For `segments: true`, source vertices
 * are consumed in pairs, so capacity/2 instances are reserved.  For a
 * connected polyline, capacity-1 instances are reserved.  The capacity is
 * fixed for the lifetime of the line; updateThickLine truncates input that is
 * larger than it.
 *
 * Optional rendering fields are accepted in addition to the public options:
 * depthTest (default true), depthWrite (default false), renderOrder, dashSize,
 * and gapSize.  Width and resolution are in CSS pixels and are updated by
 * resizeThickLine.
 */
export function makeThickLine(options = {}) {
  const segments = Boolean(options.segments);
  const capacity = positiveInteger(options.capacity, DEFAULT_CAPACITY);
  const maxSegments = segments ? Math.floor(capacity / 2) : Math.max(0, capacity - 1);
  const baseColor = color(options.color, 0xffffff);
  const width = Math.max(EPSILON, finite(options.width, DEFAULT_WIDTH));
  const opacity = Math.max(0, Math.min(1, finite(options.opacity, DEFAULT_OPACITY)));
  const dashed = Boolean(options.dashed);

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(RIBBON_POSITIONS.slice(), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(RIBBON_UVS.slice(), 2));
  geometry.setIndex(RIBBON_INDICES);

  const instanceStart = allocateInstanceAttribute(new Float32Array(maxSegments * 3), 3);
  const instanceEnd = allocateInstanceAttribute(new Float32Array(maxSegments * 3), 3);
  const instanceColorStart = allocateInstanceAttribute(new Float32Array(maxSegments * 3), 3);
  const instanceColorEnd = allocateInstanceAttribute(new Float32Array(maxSegments * 3), 3);
  geometry.setAttribute('instanceStart', instanceStart);
  geometry.setAttribute('instanceEnd', instanceEnd);
  geometry.setAttribute('instanceColorStart', instanceColorStart);
  geometry.setAttribute('instanceColorEnd', instanceColorEnd);

  // Keep the distance attributes present even for a non-dashed line.  This
  // keeps the attribute topology stable if callers toggle useDashes directly
  // on a material uniform while preserving the no-reallocation update path.
  const instanceDistanceStart = allocateInstanceAttribute(new Float32Array(maxSegments), 1);
  const instanceDistanceEnd = allocateInstanceAttribute(new Float32Array(maxSegments), 1);
  geometry.setAttribute('instanceDistanceStart', instanceDistanceStart);
  geometry.setAttribute('instanceDistanceEnd', instanceDistanceEnd);
  geometry.instanceCount = 0;
  geometry.setDrawRange(0, INDEX_COUNT);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      diffuse: { value: baseColor },
      opacity: { value: opacity },
      linewidth: { value: width },
      resolution: { value: new THREE.Vector2(1, 1) },
      useVertexColors: { value: false },
      useDashes: { value: dashed },
      dashSize: { value: Math.max(EPSILON, finite(options.dashSize, DEFAULT_DASH_SIZE)) },
      gapSize: { value: Math.max(EPSILON, finite(options.gapSize, DEFAULT_GAP_SIZE)) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: opacity < 1 || options.transparent === true,
    depthTest: options.depthTest !== false,
    depthWrite: options.depthWrite === true,
    side: THREE.DoubleSide,
    fog: false,
  });

  const object = new THREE.Mesh(geometry, material);
  object.name = options.name === undefined ? 'thick-line' : String(options.name);
  object.frustumCulled = false;
  object.visible = false;
  if (Number.isFinite(Number(options.renderOrder))) object.renderOrder = Number(options.renderOrder);

  const line = {
    _thickLine: true,
    object,
    geometry,
    material,
    capacity,
    maxSegments,
    segments,
    dashed,
    width,
    opacity,
    vertexCount: 0,
    segmentCount: 0,
    count: 0,
  };
  object.userData.thickLine = line;

  // Fill the color arrays once so a direct material switch to vertex colors
  // before the first update still has finite values in every slot.
  const base = [baseColor.r, baseColor.g, baseColor.b];
  for (let index = 0; index < maxSegments; index += 1) {
    const offset = index * 3;
    instanceColorStart.array[offset] = base[0];
    instanceColorStart.array[offset + 1] = base[1];
    instanceColorStart.array[offset + 2] = base[2];
    instanceColorEnd.array[offset] = base[0];
    instanceColorEnd.array[offset + 1] = base[1];
    instanceColorEnd.array[offset + 2] = base[2];
  }

  return line;
}

function writePoint(attributeArray, pointOffset, source, sourceOffset) {
  attributeArray[pointOffset] = finite(source[sourceOffset]);
  attributeArray[pointOffset + 1] = finite(source[sourceOffset + 1]);
  attributeArray[pointOffset + 2] = finite(source[sourceOffset + 2]);
}

function writeColor(attributeArray, targetOffset, source, sourceOffset) {
  attributeArray[targetOffset] = finite(source[sourceOffset]);
  attributeArray[targetOffset + 1] = finite(source[sourceOffset + 1]);
  attributeArray[targetOffset + 2] = finite(source[sourceOffset + 2]);
}

/**
 * Update a line in place.
 *
 * xyzArray is a flat XYZ source array.  vertexCount is the number of source
 * vertices, not the number of triangle or segment instances.  For segmented
 * lines each pair is independent; for polylines adjacent pairs are joined.
 * colors, when supplied, is a flat RGB value per source vertex.  Input beyond
 * the fixed capacity is ignored and no BufferAttribute is replaced.
 *
 * Returns the line record so callers can chain updates.  The authoritative
 * draw count is line.segmentCount (and geometry.instanceCount).
 */
export function updateThickLine(line, xyzArray, vertexCount, colors = null) {
  const record = getLineRecord(line);
  if (!record || !record.object) return line;

  const source = arrayLike(xyzArray);
  let requestedVertices = vertexCount === undefined || vertexCount === null
    ? Math.floor(source.length / 3)
    : Math.floor(finite(vertexCount, 0));
  requestedVertices = Math.max(0, Math.min(requestedVertices, Math.floor(source.length / 3), record.capacity));
  if (record.segments) requestedVertices -= requestedVertices % 2;

  const segmentCount = record.segments
    ? Math.min(record.maxSegments, Math.floor(requestedVertices / 2))
    : Math.min(record.maxSegments, Math.max(0, requestedVertices - 1));
  const attributes = record.geometry.attributes;
  const starts = attributes.instanceStart.array;
  const ends = attributes.instanceEnd.array;
  const startColors = attributes.instanceColorStart.array;
  const endColors = attributes.instanceColorEnd.array;
  const startDistances = attributes.instanceDistanceStart.array;
  const endDistances = attributes.instanceDistanceEnd.array;
  const colorSource = arrayLike(colors);
  const haveColors = colorSource.length > 0 && colorSource.length >= requestedVertices * 3;

  let cumulativeDistance = 0;
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const sourceStart = record.segments ? segmentIndex * 2 : segmentIndex;
    const sourceEnd = sourceStart + 1;
    const pointOffset = segmentIndex * 3;
    const sourceStartOffset = sourceStart * 3;
    const sourceEndOffset = sourceEnd * 3;
    writePoint(starts, pointOffset, source, sourceStartOffset);
    writePoint(ends, pointOffset, source, sourceEndOffset);

    if (haveColors) {
      writeColor(startColors, pointOffset, colorSource, sourceStartOffset);
      writeColor(endColors, pointOffset, colorSource, sourceEndOffset);
    }

    const dx = ends[pointOffset] - starts[pointOffset];
    const dy = ends[pointOffset + 1] - starts[pointOffset + 1];
    const dz = ends[pointOffset + 2] - starts[pointOffset + 2];
    const length = Math.hypot(dx, dy, dz);
    if (record.segments) {
      startDistances[segmentIndex] = 0;
      endDistances[segmentIndex] = length;
    } else {
      startDistances[segmentIndex] = cumulativeDistance;
      cumulativeDistance += length;
      endDistances[segmentIndex] = cumulativeDistance;
    }
  }

  const activePositionItems = segmentCount * 3;
  setAttributeNeedsUpdate(attributes.instanceStart, activePositionItems);
  setAttributeNeedsUpdate(attributes.instanceEnd, activePositionItems);
  if (haveColors) {
    setAttributeNeedsUpdate(attributes.instanceColorStart, activePositionItems);
    setAttributeNeedsUpdate(attributes.instanceColorEnd, activePositionItems);
  }
  if (record.dashed) {
    setAttributeNeedsUpdate(attributes.instanceDistanceStart, segmentCount);
    setAttributeNeedsUpdate(attributes.instanceDistanceEnd, segmentCount);
  }

  record.geometry.instanceCount = segmentCount;
  record.geometry.setDrawRange(0, segmentCount > 0 ? INDEX_COUNT : 0);
  record.vertexCount = record.segments ? segmentCount * 2 : segmentCount + (segmentCount > 0 ? 1 : 0);
  record.segmentCount = segmentCount;
  record.count = record.vertexCount;
  record.object.visible = segmentCount > 0;
  record.material.uniforms.useVertexColors.value = haveColors;
  return record;
}

/**
 * Set the drawing-buffer resolution used by the screen-space expansion.
 * Invalid or zero dimensions are clamped to one to keep shader divisions
 * finite during a hidden/collapsed canvas resize.
 */
export function resizeThickLine(line, width, height) {
  const record = getLineRecord(line);
  if (!record || !record.material?.uniforms?.resolution) return line;
  const safeWidth = Math.max(1, finite(width, 1));
  const safeHeight = Math.max(1, finite(height, 1));
  record.material.uniforms.resolution.value.set(safeWidth, safeHeight);
  record.resolution = { width: safeWidth, height: safeHeight };
  return record;
}

/**
 * Dispose resources owned by a line.  The renderer can also dispose
 * `line.geometry` and `line.material` through its existing ownership set; this
 * helper is provided for callers that manage a line independently.
 */
export function disposeThickLine(line) {
  const record = getLineRecord(line);
  if (!record) return;
  record.geometry?.dispose();
  record.material?.dispose();
  if (record.object?.userData?.thickLine === record) delete record.object.userData.thickLine;
  record.object = null;
}

export default {
  makeThickLine,
  updateThickLine,
  resizeThickLine,
  disposeThickLine,
};
