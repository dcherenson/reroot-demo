import * as THREE from './vendor/three.module.js';

/** Clip an XY polygon to the same finite rectangle used by worldCollision. */
export function clipPolygonToMap(points, width, height) {
  let polygon = points;
  for (const [axis, boundary, sign] of [[0, 0, 1], [0, width, -1], [1, 0, 1], [1, height, -1]]) {
    const input = polygon;
    polygon = [];
    if (!input.length) break;
    let a = input.at(-1);
    let aInside = sign * (a[axis] - boundary) >= 0;
    for (const b of input) {
      const bInside = sign * (b[axis] - boundary) >= 0;
      if (aInside !== bInside) {
        const t = (boundary - a[axis]) / (b[axis] - a[axis]);
        const intersection = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        intersection[axis] = boundary;
        polygon.push(intersection);
      }
      if (bInside) polygon.push(b);
      a = b;
      aInside = bInside;
    }
  }
  return polygon;
}

/** A terrain-following surface with physically clipped edges, not a long box. */
export function drapedRectangleGeometry(world, object, heightAt, { lift = .06, spacing = 2 } = {}) {
  const width = Math.max(.01, Number(object.width) || 1);
  const depth = Math.max(.01, Number(object.depth) || 1);
  const step = world.terrainMesh?.spacing || spacing;
  const rotation = Number(object.rotation) || 0;
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const toWorld = (x, y) => [object.x + x * c - y * s, object.y + x * s + y * c];
  const corners = [toWorld(-width / 2, -depth / 2), toWorld(width / 2, -depth / 2), toWorld(width / 2, depth / 2), toWorld(-width / 2, depth / 2)];
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p[0])) / step));
  const x1 = Math.min(Math.ceil(world.width / step), Math.ceil(Math.max(...corners.map(p => p[0])) / step));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p[1])) / step));
  const y1 = Math.min(Math.ceil(world.height / step), Math.ceil(Math.max(...corners.map(p => p[1])) / step));
  // Cut the underlying terrain triangles by the surface rectangle. Subdividing
  // the road's own local grid can cut through hills between vertices, causing
  // buried patches and z-fighting even when every endpoint is draped correctly.
  const planes = [[c, s, width / 2], [-c, -s, width / 2], [-s, c, depth / 2], [s, -c, depth / 2]];
  const clip = triangle => {
    let polygon = triangle;
    for (const [nx, ny, bound] of planes) {
      const input = polygon;
      polygon = [];
      if (!input.length) break;
      let a = input.at(-1), da = bound - nx * (a[0] - object.x) - ny * (a[1] - object.y);
      for (const b of input) {
        const db = bound - nx * (b[0] - object.x) - ny * (b[1] - object.y);
        if ((da >= 0) !== (db >= 0)) {
          const t = da / (da - db);
          polygon.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
        if (db >= 0) polygon.push(b);
        a = b; da = db;
      }
    }
    return polygon;
  };
  const positions = [], uvs = [];
  for (let row = y0; row < y1; row++) for (let col = x0; col < x1; col++) {
    const a = [col * step, row * step], b = [Math.min(world.width, (col + 1) * step), row * step];
    const d = [col * step, Math.min(world.height, (row + 1) * step)], c = [b[0], d[1]];
    for (const triangle of [[a, b, c], [a, c, d]]) {
      const polygon = clip(triangle);
      for (let i = 1; i + 1 < polygon.length; i++) for (const [x, y] of [polygon[0], polygon[i], polygon[i + 1]]) {
        positions.push(x - world.width / 2, heightAt(x, y) + lift, world.height / 2 - y);
        uvs.push(x / world.width, y / world.height);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Build a terrain-conforming ribbon along a smooth, open world-space path.
 *
 * `object.path` contains ordered `[x, y]` waypoints in world metres. `width`
 * and `offset` are also metres; a positive offset moves to the left of travel.
 * UV `u` is lateral distance across the ribbon in metres and `v` is accumulated
 * centreline distance in metres. `roadLateral` is signed and normalized across
 * the ribbon (`-1` to `+1`); `roadEdge` is `1 - abs(roadLateral)`, so road
 * materials can apply a soft fade at both edges. The ribbon is clipped against
 * the same terrain triangles as the ground mesh and against the finite map.
 */
export function drapedPathGeometry(world, object, heightAt, {
  lift = .06,
  spacing = world.terrainMesh?.spacing || 2,
  width: requestedWidth = object.width,
  offset = 0,
} = {}) {
  const mapWidth = Math.max(0, Number(world?.width) || 0);
  const mapHeight = Math.max(0, Number(world?.height) || 0);
  const width = Math.max(.01, Number(requestedWidth) || 1);
  const halfWidth = width / 2;
  const sideOffset = Number.isFinite(Number(offset)) ? Number(offset) : 0;
  const waypoints = [];
  for (const point of Array.isArray(object?.path) ? object.path : []) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const x = Number(point[0]), y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const previous = waypoints.at(-1);
    if (!previous || Math.hypot(x - previous[0], y - previous[1]) > 1e-5) waypoints.push([x, y]);
  }

  const geometry = new THREE.BufferGeometry();
  const positions = [], uvs = [], lateralValues = [], edgeValues = [];
  const setEmptyAttributes = () => {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
    geometry.setAttribute('roadLateral', new THREE.Float32BufferAttribute([], 1));
    geometry.setAttribute('roadEdge', new THREE.Float32BufferAttribute([], 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };
  if (waypoints.length < 2 || !(mapWidth > 0 && mapHeight > 0) || typeof heightAt !== 'function') return setEmptyAttributes();

  const points = waypoints.map(([x, y]) => new THREE.Vector3(x, 0, y));
  const polylineLength = points.slice(1).reduce((sum, point, index) => sum + point.distanceTo(points[index]), 0);
  if (!(polylineLength > 1e-5)) return setEmptyAttributes();
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', .5);
  // Increase the arc-length lookup density on long routes so stations remain
  // evenly spaced in metres rather than bunching around control points.
  curve.arcLengthDivisions = Math.max(200, Math.ceil(polylineLength * 4));
  curve.updateArcLengths();
  const length = curve.getLength();
  const terrainStep = Math.max(.1, Number(world.terrainMesh?.spacing) || Number(spacing) || 2);
  // Narrow wheel tracks need shorter segments than the 1–2 m terrain grid so
  // their curved outline does not read as a chain of straight little strips.
  const requestedStep = Math.max(.2, Number(spacing) || terrainStep);
  const sampleStep = Math.min(requestedStep, Math.max(.25, width * .5));
  const sampleCount = Math.max(1, Math.ceil(length / sampleStep));
  const stations = [];
  let prior = null;
  for (let index = 0; index <= sampleCount; index++) {
    const t = index / sampleCount;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    let dx = tangent.x, dy = tangent.z;
    let magnitude = Math.hypot(dx, dy);
    if (!(magnitude > 1e-8) && prior) {
      dx = point.x - prior.x; dy = point.z - prior.y; magnitude = Math.hypot(dx, dy);
    }
    if (!(magnitude > 1e-8)) continue;
    dx /= magnitude; dy /= magnitude;
    // The left normal in the world's x/y plane.
    const nx = -dy, ny = dx;
    const distance = length * t;
    stations.push({ x: point.x + nx * sideOffset, y: point.z + ny * sideOffset, nx, ny, distance });
    prior = { x: point.x, y: point.z };
  }
  if (stations.length < 2) return setEmptyAttributes();

  // Every terrain triangle is an independent clipping cell. This preserves
  // the ground mesh's diagonal and prevents a road facet from spanning a hill
  // break between terrain vertices.
  const mesh = world.terrainMesh;
  const step = Math.max(.1, Number(mesh?.spacing) || terrainStep);
  const columns = mesh?.columns || Math.ceil(mapWidth / step) + 1;
  const rows = mesh?.rows || Math.ceil(mapHeight / step) + 1;
  const cellColumns = Math.max(0, columns - 1), cellRows = Math.max(0, rows - 1);

  const interpolate = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    u: a.u + (b.u - a.u) * t,
    v: a.v + (b.v - a.v) * t,
    lateral: a.lateral + (b.lateral - a.lateral) * t,
  });

  const clipToTriangle = (polygon, triangle) => {
    const [p0, p1, p2] = triangle;
    const orientation = Math.sign((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])) || 1;
    let output = polygon;
    for (let edge = 0; edge < 3 && output.length; edge++) {
      const a = triangle[edge], b = triangle[(edge + 1) % 3];
      const signedDistance = point => orientation * ((b[0] - a[0]) * (point.y - a[1]) - (b[1] - a[1]) * (point.x - a[0]));
      const input = output;
      output = [];
      let previous = input.at(-1), previousDistance = signedDistance(previous);
      for (const current of input) {
        const currentDistance = signedDistance(current);
        const previousInside = previousDistance >= -1e-9;
        const currentInside = currentDistance >= -1e-9;
        if (previousInside !== currentInside) {
          const denominator = previousDistance - currentDistance;
          const t = Math.abs(denominator) < 1e-12 ? 0 : Math.max(0, Math.min(1, previousDistance / denominator));
          output.push(interpolate(previous, current, t));
        }
        if (currentInside) output.push(current);
        previous = current;
        previousDistance = currentDistance;
      }
    }
    return output;
  };

  const emitClipped = sourceTriangle => {
    const minX = Math.min(...sourceTriangle.map(point => point.x));
    const maxX = Math.max(...sourceTriangle.map(point => point.x));
    const minY = Math.min(...sourceTriangle.map(point => point.y));
    const maxY = Math.max(...sourceTriangle.map(point => point.y));
    const firstCol = Math.max(0, Math.min(cellColumns - 1, Math.floor(minX / step)));
    const lastCol = Math.max(0, Math.min(cellColumns - 1, Math.floor(maxX / step)));
    const firstRow = Math.max(0, Math.min(cellRows - 1, Math.floor(minY / step)));
    const lastRow = Math.max(0, Math.min(cellRows - 1, Math.floor(maxY / step)));
    for (let cellY = firstRow; cellY <= lastRow; cellY++) for (let cellX = firstCol; cellX <= lastCol; cellX++) {
      const x0 = cellX * step, x1 = Math.min(mapWidth, (cellX + 1) * step);
      const y0 = cellY * step, y1 = Math.min(mapHeight, (cellY + 1) * step);
      const a = [x0, y0], b = [x1, y0], d = [x0, y1], c = [x1, y1];
      const triangles = [[a, b, c], [a, c, d]];
      for (const terrainTriangle of triangles) {
        const clipped = clipToTriangle(sourceTriangle, terrainTriangle);
        if (clipped.length < 3) continue;
        for (let fan = 1; fan + 1 < clipped.length; fan++) {
          const tri = [clipped[0], clipped[fan], clipped[fan + 1]];
          const area = (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) - (tri[1].y - tri[0].y) * (tri[2].x - tri[0].x);
          if (Math.abs(area) < 1e-10) continue;
          for (const point of tri) {
            positions.push(point.x - mapWidth / 2, heightAt(point.x, point.y) + lift, mapHeight / 2 - point.y);
            uvs.push(point.u, point.v);
            lateralValues.push(point.lateral);
            edgeValues.push(1 - Math.abs(point.lateral));
          }
        }
      }
    }
  };

  const mapLateral = (station, lateral) => {
    const normalized = lateral / halfWidth;
    return {
      x: station.x + station.nx * lateral,
      y: station.y + station.ny * lateral,
      u: lateral + halfWidth,
      v: station.distance,
      lateral: normalized,
    };
  };
  for (let index = 0; index + 1 < stations.length; index++) {
    const start = stations[index], end = stations[index + 1];
    const left0 = mapLateral(start, -halfWidth), left1 = mapLateral(end, -halfWidth);
    const right0 = mapLateral(start, halfWidth), right1 = mapLateral(end, halfWidth);
    // Two source triangles make each station-to-station ribbon segment. Their
    // shared cross-section prevents gaps while keeping each piece convex for
    // clipping against the terrain cells.
    emitClipped([left0, left1, right1]);
    emitClipped([left0, right1, right0]);
  }

  if (!positions.length) return setEmptyAttributes();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('roadLateral', new THREE.Float32BufferAttribute(lateralValues, 1));
  geometry.setAttribute('roadEdge', new THREE.Float32BufferAttribute(edgeValues, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
