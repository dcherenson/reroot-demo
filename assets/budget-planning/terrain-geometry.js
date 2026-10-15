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
