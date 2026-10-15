import * as THREE from './vendor/three.module.js';

/*
 * Compact, authored landmark models used by the budget-planning worlds.
 *
 * The builders deliberately keep their origin at the centre of the ground
 * footprint. Every group is authored to fit its requested width, depth, and
 * height, so the renderer can place it directly on a sampled terrain surface.
 * They use geometry only: there are no fonts, images, or network resources in
 * this module.
 */

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

const DEFAULTS = {
  'landmark-barnhouse': { width: 18, depth: 14, height: 12 },
  'landmark-saguaro': { width: 10, depth: 8, height: 16 },
  'landmark-windmill': { width: 9, depth: 9, height: 16 },
  'landmark-orchard': { width: 12, depth: 9, height: 7 },
  'landmark-depot': { width: 14, depth: 10, height: 9 },
  'landmark-rock-spire': { width: 9, depth: 8, height: 10 },
  'landmark-lookout': { width: 8, depth: 8, height: 7 },
  'landmark-bridge': { width: 12, depth: 8, height: 4 },
  'landmark-clocktower': { width: 8, depth: 8, height: 17 },
  'landmark-campus-pavilion': { width: 14, depth: 14, height: 10 },
};

const DESCRIPTIONS = {
  'landmark-barnhouse': 'A red gambrel barnhouse with white cross-braced doors, cupola, and weather vane.',
  'landmark-saguaro': 'A hero saguaro with an asymmetric many-armed silhouette, raised ribs, and desert blossoms.',
  'landmark-windmill': 'A farm windmill with a tapered tower and four broad wooden vanes.',
  'landmark-orchard': 'A timber orchard pergola with a curved arch, roof slats, and hanging fruit baskets.',
  'landmark-depot': 'An adobe desert depot with a teal double door, parapet, and square lookout tower.',
  'landmark-rock-spire': 'A stacked, faceted desert rock formation with a narrow pointed spire.',
  'landmark-lookout': 'A timber trail overlook raised on posts with a deck, rails, braces, and roof.',
  'landmark-bridge': 'A small marked bridge crossing a wash, with rails, striped deck markers, and abutments.',
  'landmark-clocktower': 'A campus brick clocktower with four clock faces, belfry openings, roof, and finial.',
  'landmark-campus-pavilion': 'A fictional Ann Arbor campus pavilion with cream columns, a blue dome, and maize details.',
};

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback) {
  const number = finite(value, fallback);
  return number > 0 ? number : fallback;
}

function dimensions(object, defaults) {
  return {
    width: positive(object?.width, defaults.width),
    depth: positive(object?.depth, defaults.depth),
    height: positive(object?.height, defaults.height),
  };
}

function safe(value, minimum = 0.0001) {
  return Math.max(minimum, finite(value, minimum));
}

function fraction(limit, ratio, minimum = 0.0001) {
  return safe(Math.min(limit, limit * ratio), minimum);
}

function color(value, fallback) {
  if (value?.isColor) return value.clone();
  try {
    return new THREE.Color(value == null ? fallback : value);
  } catch (_error) {
    return new THREE.Color(fallback);
  }
}

function material(value, fallback, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: color(value, fallback),
    roughness: options.roughness == null ? 0.86 : options.roughness,
    metalness: options.metalness == null ? 0.02 : options.metalness,
    flatShading: options.flatShading == null ? true : Boolean(options.flatShading),
  });
}

function addMesh(group, geometry, mat, name, position = null) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = name;
  if (position) mesh.position.copy(position);
  group.add(mesh);
  return mesh;
}

function addBox(group, width, height, depth, mat, name, x = 0, y = height / 2, z = 0) {
  return addMesh(
    group,
    new THREE.BoxGeometry(safe(width), safe(height), safe(depth)),
    mat,
    name,
    new THREE.Vector3(x, y, z),
  );
}

function addCylinder(group, radiusTop, radiusBottom, height, mat, name, x = 0, y = height / 2, z = 0, radialSegments = 8) {
  return addMesh(
    group,
    new THREE.CylinderGeometry(safe(radiusTop), safe(radiusBottom), safe(height), radialSegments),
    mat,
    name,
    new THREE.Vector3(x, y, z),
  );
}

function addCone(group, radius, height, mat, name, x = 0, y = height / 2, z = 0, radialSegments = 6) {
  return addMesh(
    group,
    new THREE.ConeGeometry(safe(radius), safe(height), radialSegments),
    mat,
    name,
    new THREE.Vector3(x, y, z),
  );
}

function addSphere(group, radius, mat, name, x = 0, y = radius, z = 0, widthSegments = 8, heightSegments = 5) {
  return addMesh(
    group,
    new THREE.SphereGeometry(safe(radius), widthSegments, heightSegments),
    mat,
    name,
    new THREE.Vector3(x, y, z),
  );
}

/** Add a rectangular beam whose long local x axis runs between two points. */
function addBeam(group, start, end, thickness, depth, mat, name) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < 0.0001) return null;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(safe(length), safe(thickness), safe(depth)),
    mat,
  );
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(X_AXIS, direction.normalize());
  group.add(mesh);
  return mesh;
}

/** Add a low-poly round branch between two points, capped by its end joints. */
function addRoundBranch(group, start, end, radius, mat, name, radialSegments = 8) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < 0.0001) return null;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(safe(radius), safe(radius), safe(length), radialSegments),
    mat,
  );
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  group.add(mesh);
  return mesh;
}

function addLineBeam(group, start, end, radius, mat, name, radialSegments = 6) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < 0.0001) return null;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(safe(radius), safe(radius), safe(length), radialSegments),
    mat,
  );
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  group.add(mesh);
  return mesh;
}

function addInstancedCylinders(group, segments, mat, name, radialSegments = 8) {
  if (!segments.length) return null;
  const geometry = new THREE.CylinderGeometry(1, 1, 1, radialSegments);
  geometry.name = `${name}-geometry`;
  const mesh = new THREE.InstancedMesh(geometry, mat, segments.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const direction = new THREE.Vector3().subVectors(segment.end, segment.start);
    const length = direction.length();
    if (length < 0.0001) continue;
    position.copy(segment.start).add(segment.end).multiplyScalar(0.5);
    quaternion.setFromUnitVectors(UP, direction.normalize());
    scale.set(segment.radius, length, segment.radius);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  group.add(mesh);
  return mesh;
}

function addInstancedSpheres(group, spheres, mat, name, widthSegments = 7, heightSegments = 5) {
  if (!spheres.length) return null;
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  geometry.name = `${name}-geometry`;
  const mesh = new THREE.InstancedMesh(geometry, mat, spheres.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let index = 0; index < spheres.length; index += 1) {
    const sphere = spheres[index];
    const radius = safe(sphere.radius);
    matrix.compose(sphere.position, quaternion, scale.set(radius, radius, radius));
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  group.add(mesh);
  return mesh;
}

function baseGroup(style, object, defaults, title, description = DESCRIPTIONS[style]) {
  const { width, depth, height } = dimensions(object, defaults);
  const group = new THREE.Group();
  group.name = style;
  group.userData = {
    type: 'landmark',
    style,
    landmarkStyle: style,
    title,
    description: object.description || description,
    bounds: { width, depth, height },
    dimensions: { width, depth, height },
    groundY: 0,
    landmarkId: object.landmarkId || object.id || null,
  };
  return { group, width, depth, height };
}

function finish(group) {
  group.traverse((child) => {
    if (child.geometry && !child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (child.geometry && !child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
  });
  return group;
}

function addGableRoof(group, width, depth, ridgeY, roofBottomY, thickness, mat, prefix) {
  const halfWidth = width / 2;
  const ridge = Math.min(halfWidth * 0.16, Math.max(thickness * 1.8, width * 0.075));
  const leftStart = new THREE.Vector3(-halfWidth, roofBottomY, 0);
  const leftEnd = new THREE.Vector3(-ridge, ridgeY, 0);
  const rightStart = new THREE.Vector3(halfWidth, roofBottomY, 0);
  const rightEnd = new THREE.Vector3(ridge, ridgeY, 0);
  addBeam(group, leftStart, leftEnd, thickness, depth, mat, `${prefix}-left-slope`);
  addBeam(group, rightStart, rightEnd, thickness, depth, mat, `${prefix}-right-slope`);
}

function addGambrelRoof(group, width, depth, roofBaseY, roofPeakY, thickness, mat, prefix) {
  const halfWidth = width / 2;
  const outerX = halfWidth;
  const shoulderX = halfWidth * 0.54;
  const peakX = halfWidth * 0.08;
  const shoulderY = roofBaseY + (roofPeakY - roofBaseY) * 0.38;
  addBeam(group, new THREE.Vector3(-outerX, roofBaseY, 0), new THREE.Vector3(-shoulderX, shoulderY, 0), thickness, depth, mat, `${prefix}-left-low-slope`);
  addBeam(group, new THREE.Vector3(-shoulderX, shoulderY, 0), new THREE.Vector3(-peakX, roofPeakY, 0), thickness, depth, mat, `${prefix}-left-high-slope`);
  addBeam(group, new THREE.Vector3(outerX, roofBaseY, 0), new THREE.Vector3(shoulderX, shoulderY, 0), thickness, depth, mat, `${prefix}-right-low-slope`);
  addBeam(group, new THREE.Vector3(shoulderX, shoulderY, 0), new THREE.Vector3(peakX, roofPeakY, 0), thickness, depth, mat, `${prefix}-right-high-slope`);
}

function createBarnhouse(object = {}) {
  const { group, width, depth, height } = baseGroup(
    'landmark-barnhouse',
    object,
    DEFAULTS['landmark-barnhouse'],
    object.label || 'Red gambrel barnhouse',
  );
  const red = material(object.roofColor, 0x9e3d34, { roughness: 0.9 });
  const redDark = material(0x6f2b2b, 0x6f2b2b, { roughness: 0.94 });
  const white = material(object.trimColor, 0xf2eee1, { roughness: 0.83 });
  const dark = material(0x3d2926, 0x3d2926, { roughness: 0.93 });
  const body = material(object.bodyColor || object.color, 0xa64c36, { roughness: 0.92 });
  const door = material(object.doorColor, 0x7d2e2c, { roughness: 0.9 });

  const bodyWidth = width * 0.78;
  const bodyDepth = depth * 0.73;
  const bodyHeight = height * 0.57;
  const bodyY = bodyHeight / 2;
  addBox(group, bodyWidth, bodyHeight, bodyDepth, body, 'barnhouse-main-body', 0, bodyY, 0);
  addBox(group, bodyWidth * 1.04, height * 0.055, bodyDepth * 1.04, redDark, 'barnhouse-foundation-plinth', 0, height * 0.028, 0);

  const doorWidth = bodyWidth * 0.47;
  const doorHeight = bodyHeight * 0.72;
  const doorGap = bodyWidth * 0.018;
  const doorZ = bodyDepth / 2 + depth * 0.012;
  for (const side of [-1, 1]) {
    const doorX = side * (doorWidth / 2 + doorGap / 2) / 2;
    addBox(group, doorWidth / 2, doorHeight, depth * 0.025, door, `barnhouse-white-trim-door-${side < 0 ? 'left' : 'right'}`, doorX, doorHeight / 2 + height * 0.035, doorZ);
    const braceThickness = Math.max(width * 0.022, 0.018);
    const panelLeft = doorX - doorWidth / 4;
    const panelRight = doorX + doorWidth / 4;
    const panelBottom = height * 0.095;
    const panelTop = doorHeight + height * 0.03;
    addBeam(group, new THREE.Vector3(panelLeft, panelBottom, doorZ + depth * 0.017), new THREE.Vector3(panelRight, panelTop, doorZ + depth * 0.017), braceThickness, depth * 0.032, white, `barnhouse-door-brace-${side < 0 ? 'left' : 'right'}-up`);
    addBeam(group, new THREE.Vector3(panelRight, panelBottom, doorZ + depth * 0.019), new THREE.Vector3(panelLeft, panelTop, doorZ + depth * 0.019), braceThickness, depth * 0.032, white, `barnhouse-door-brace-${side < 0 ? 'left' : 'right'}-down`);
  }
  addBox(group, doorWidth * 1.04, height * 0.04, depth * 0.035, white, 'barnhouse-door-header', 0, doorHeight + height * 0.075, doorZ);

  const roofDepth = bodyDepth * 1.08;
  const roofBaseY = bodyHeight * 0.89;
  const roofPeakY = height * 0.78;
  const roofThickness = Math.max(height * 0.045, width * 0.018);
  addGambrelRoof(group, bodyWidth * 1.06, roofDepth, roofBaseY, roofPeakY, roofThickness, red, 'barnhouse-gambrel-roof');
  addBox(group, bodyWidth * 1.07, height * 0.045, roofDepth * 1.03, redDark, 'barnhouse-roof-eave', 0, roofBaseY - height * 0.018, 0);

  // The cupola sits on the ridge and leaves room for the vane inside the
  // declared height.  Its four pale panels are an especially clear farm cue.
  const cupolaWidth = width * 0.18;
  const cupolaDepth = depth * 0.17;
  const cupolaHeight = height * 0.12;
  const cupolaBottom = roofPeakY - height * 0.015;
  addBox(group, cupolaWidth, cupolaHeight, cupolaDepth, white, 'barnhouse-cupola', 0, cupolaBottom + cupolaHeight / 2, 0);
  addBox(group, cupolaWidth * 1.12, height * 0.025, cupolaDepth * 1.12, redDark, 'barnhouse-cupola-sill', 0, cupolaBottom, 0);
  const cupolaRoofY = cupolaBottom + cupolaHeight;
  addCone(group, Math.min(cupolaWidth, cupolaDepth) * 0.72, height * 0.05, red, 'barnhouse-cupola-roof', 0, cupolaRoofY + height * 0.025, 0, 4);
  const vaneBottom = cupolaRoofY + height * 0.046;
  const vaneTop = Math.min(height * 0.985, vaneBottom + height * 0.085);
  addCylinder(group, Math.max(width * 0.009, 0.02), Math.max(width * 0.009, 0.02), vaneTop - vaneBottom, dark, 'barnhouse-weather-vane-post', 0, (vaneBottom + vaneTop) / 2, 0, 6);
  addBeam(group, new THREE.Vector3(-width * 0.07, vaneTop - height * 0.025, 0), new THREE.Vector3(width * 0.07, vaneTop - height * 0.025, 0), Math.max(width * 0.012, 0.02), Math.max(depth * 0.012, 0.02), dark, 'barnhouse-weather-vane-arrow');
  addCone(group, Math.min(Math.max(width * 0.016, 0.025), height * 0.03), height * 0.028, dark, 'barnhouse-weather-vane-arrowhead', width * 0.075, vaneTop - height * 0.025, 0, 4).rotation.z = -Math.PI / 2;

  group.userData.cues = ['red gambrel roof', 'white cross-braced double doors', 'cupola', 'weather vane'];
  group.userData.facility = 'farmstead barnhouse';
  return finish(group);
}

function addVerticalRibs(group, x, z, radius, bottom, top, ribMaterial, prefix, count = 7, instances = null) {
  const ribRadius = Math.max(0.012, radius * 0.075);
  for (let index = 0; index < count; index += 1) {
    const theta = index / count * TAU;
    const offset = radius * 0.88;
    const rib = {
      position: new THREE.Vector3(x + Math.cos(theta) * offset, (bottom + top) / 2, z + Math.sin(theta) * offset),
      radius: ribRadius,
      height: Math.max(0.001, top - bottom),
    };
    if (instances) instances.push(rib);
    else addCylinder(group, ribRadius, ribRadius, rib.height, ribMaterial, `${prefix}-rib-${index + 1}`, rib.position.x, rib.position.y, rib.position.z, 5);
  }
}

function createSaguaro(object = {}) {
  const { group, width, depth, height } = baseGroup(
    'landmark-saguaro',
    object,
    DEFAULTS['landmark-saguaro'],
    object.label || 'Hero saguaro',
  );
  const green = material(object.color, 0x3e7951, { roughness: 0.98 });
  const darkGreen = material(0x265d43, 0x265d43, { roughness: 0.98 });
  const blossom = material(0xe8a06d, 0xe8a06d, { roughness: 0.8 });
  const blossomCore = material(0xf4d26f, 0xf4d26f, { roughness: 0.77 });
  const ribInstances = [];
  const armSegments = [];
  const armJoints = [];
  const blossomInstances = [];
  const blossomCoreInstances = [];

  const trunkRadius = Math.min(width * 0.095, depth * 0.115);
  const trunkBottom = trunkRadius;
  const trunkTop = height * 0.91;
  addCylinder(group, trunkRadius, trunkRadius * 1.08, trunkTop - trunkBottom, green, 'saguaro-hero-trunk', 0, (trunkBottom + trunkTop) / 2, 0, 10);
  addSphere(group, trunkRadius, green, 'saguaro-trunk-base', 0, trunkBottom, 0, 8, 5);
  addSphere(group, trunkRadius, green, 'saguaro-trunk-crown', 0, trunkTop, 0, 8, 5);
  addVerticalRibs(group, 0, 0, trunkRadius, trunkBottom + trunkRadius * 0.35, trunkTop - trunkRadius * 0.35, darkGreen, 'saguaro-trunk', 9, ribInstances);

  // Each arm uses two round segments and a joint.  The deliberately uneven
  // levels and directions make this a hero silhouette rather than a repeated
  // small cactus feature.
  const arms = [
    { a: [0, height * 0.36, 0], b: [-width * 0.22, height * 0.39, depth * 0.01], c: [-width * 0.22, height * 0.61, depth * 0.01], r: width * 0.062 },
    { a: [0, height * 0.48, depth * 0.01], b: [width * 0.22, height * 0.51, -depth * 0.04], c: [width * 0.22, height * 0.75, -depth * 0.04], r: width * 0.058 },
    { a: [0, height * 0.58, -depth * 0.04], b: [-width * 0.17, height * 0.61, -depth * 0.30], c: [-width * 0.17, height * 0.82, -depth * 0.30], r: width * 0.053 },
    { a: [0, height * 0.69, depth * 0.02], b: [width * 0.18, height * 0.72, depth * 0.30], c: [width * 0.18, height * 0.91, depth * 0.30], r: width * 0.047 },
    { a: [0, height * 0.25, depth * 0.02], b: [-width * 0.08, height * 0.27, depth * 0.30], c: [-width * 0.08, height * 0.44, depth * 0.30], r: width * 0.043 },
    { a: [0, height * 0.79, -depth * 0.01], b: [width * 0.11, height * 0.81, -depth * 0.34], c: [width * 0.11, height * 0.965, -depth * 0.34], r: width * 0.038 },
  ];
  arms.forEach((arm, index) => {
    const start = new THREE.Vector3(...arm.a);
    const bend = new THREE.Vector3(...arm.b);
    const end = new THREE.Vector3(...arm.c);
    const radius = Math.min(arm.r, trunkRadius * 0.82);
    armSegments.push({ start, end: bend, radius }, { start: bend, end, radius });
    armJoints.push({ position: bend, radius }, { position: end, radius });
    addVerticalRibs(group, end.x, end.z, radius, bend.y + radius * 0.35, end.y - radius * 0.35, darkGreen, `saguaro-arm-${index + 1}`, 5, ribInstances);
    const flowerRadius = Math.max(0.055, Math.min(radius * 0.54, height * 0.018));
    blossomInstances.push({ position: new THREE.Vector3(end.x, end.y + radius * 0.75, end.z), radius: flowerRadius });
    blossomCoreInstances.push({ position: new THREE.Vector3(end.x, end.y + radius * 0.95, end.z), radius: flowerRadius * 0.42 });
  });

  addInstancedCylinders(group, armSegments, green, 'saguaro-asymmetric-arm-segments', 8);
  addInstancedSpheres(group, armJoints, green, 'saguaro-arm-joints', 7, 5);
  addInstancedCylinders(
    group,
    ribInstances.map((rib) => ({
      start: new THREE.Vector3(rib.position.x, rib.position.y - rib.height / 2, rib.position.z),
      end: new THREE.Vector3(rib.position.x, rib.position.y + rib.height / 2, rib.position.z),
      radius: rib.radius,
    })),
    darkGreen,
    'saguaro-longitudinal-ribs',
    5,
  );
  addInstancedSpheres(group, blossomInstances, blossom, 'saguaro-small-blossoms', 6, 4);
  addInstancedSpheres(group, blossomCoreInstances, blossomCore, 'saguaro-blossom-centers', 5, 3);

  group.userData.cues = ['hero asymmetric silhouette', 'six raised arms', 'longitudinal ribs', 'small blossoms'];
  group.userData.armCount = arms.length;
  group.userData.distinctive = true;
  group.userData.biome = 'Tucson desert';
  return finish(group);
}

function createWindmill(object = {}) {
  const { group, width, depth, height } = baseGroup(
    'landmark-windmill',
    object,
    DEFAULTS['landmark-windmill'],
    object.label || 'Farm windmill',
  );
  const tower = material(object.color, 0x8c6c4e, { roughness: 0.95 });
  const towerDark = material(0x5d4737, 0x5d4737, { roughness: 0.96 });
  const blade = material(object.bladeColor, 0xd8d1b8, { roughness: 0.9 });
  const hubMaterial = material(0x4f3b31, 0x4f3b31, { roughness: 0.91, metalness: 0.12 });

  const towerHeight = height * 0.70;
  const baseRadius = Math.min(width, depth) * 0.235;
  const topRadius = baseRadius * 0.55;
  addCone(group, baseRadius, towerHeight, tower, 'windmill-tapered-tower', 0, towerHeight / 2, 0, 6);
  // Four slim lattice legs break up the solid tower and reinforce the farm
  // windmill reading without extending beyond its tapered silhouette.
  const legRadius = Math.min(width, depth) * 0.018;
  const legBottom = Math.min(width, depth) * 0.18;
  const legTop = Math.min(width, depth) * 0.085;
  const legYTop = towerHeight * 0.88;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addLineBeam(group, new THREE.Vector3(sx * legBottom, height * 0.018, sz * legBottom), new THREE.Vector3(sx * legTop, legYTop, sz * legTop), legRadius, towerDark, `windmill-lattice-leg-${sx < 0 ? 'west' : 'east'}-${sz < 0 ? 'rear' : 'front'}`, 5);
  }
  const rotorY = Math.min(height * 0.75, towerHeight + height * 0.045);
  const rotorDepth = Math.max(depth * 0.035, 0.025);
  addCylinder(group, Math.min(width, depth) * 0.10, Math.min(width, depth) * 0.10, rotorDepth, hubMaterial, 'windmill-rotor-hub', 0, rotorY, depth * 0.015, 10).rotation.x = Math.PI / 2;
  const hubRadius = Math.min(width, depth) * 0.10;
  const bladeLength = Math.min(width * 0.34, height * 0.22);
  const bladeWidth = Math.min(width * 0.075, height * 0.045);
  for (let index = 0; index < 4; index += 1) {
    const angle = Math.PI / 2 * index + Math.PI / 4;
    const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    const start = new THREE.Vector3(direction.x * hubRadius * 0.44, rotorY + direction.y * hubRadius * 0.44, depth * 0.045);
    const end = new THREE.Vector3(direction.x * (hubRadius + bladeLength), rotorY + direction.y * (hubRadius + bladeLength), depth * 0.045);
    // Broad tapered-looking vanes are built from a hub-side beam plus a short
    // cap; the two pieces keep the low-poly silhouette crisp.
    addBeam(group, start, end, bladeWidth, rotorDepth * 0.55, blade, `windmill-four-vane-${index + 1}`);
    const capCenter = end.clone().addScaledVector(direction, bladeWidth * 0.35);
    addBeam(group, end, capCenter, bladeWidth * 1.18, rotorDepth * 0.60, blade, `windmill-vane-${index + 1}-tip`);
  }
  addCone(group, Math.min(width, depth) * 0.17, height * 0.06, towerDark, 'windmill-roof-cap', 0, towerHeight + height * 0.03, 0, 6);
  group.userData.cues = ['tapered tower', 'four broad vanes', 'lattice legs', 'rotor hub'];
  group.userData.vaneCount = 4;
  return finish(group);
}

function createOrchard(object = {}) {
  const { group, width, depth, height } = baseGroup(
    'landmark-orchard',
    object,
    DEFAULTS['landmark-orchard'],
    object.label || 'Orchard pergola',
  );
  const timber = material(object.color, 0x7a5136, { roughness: 0.95 });
  const timberLight = material(0xb27a46, 0xb27a46, { roughness: 0.92 });
  const basket = material(0x8a5b34, 0x8a5b34, { roughness: 0.96 });
  const fruit = material(0xc75b3c, 0xc75b3c, { roughness: 0.85 });
  const fruitGold = material(0xe6a342, 0xe6a342, { roughness: 0.83 });
  const leaf = material(0x4e7847, 0x4e7847, { roughness: 0.96 });

  const postWidth = Math.min(width * 0.055, depth * 0.07);
  const postDepth = postWidth;
  const postX = width * 0.37;
  const postZ = depth * 0.32;
  const postHeight = height * 0.80;
  for (const x of [-postX, postX]) for (const z of [-postZ, postZ]) {
    addBox(group, postWidth, postHeight, postDepth, timber, `orchard-pergola-post-${x < 0 ? 'west' : 'east'}-${z < 0 ? 'rear' : 'front'}`, x, postHeight / 2, z);
  }

  const archBase = height * 0.63;
  const archTop = height * 0.96;
  const archSegments = 8;
  const archDepth = Math.min(depth * 0.06, height * 0.035);
  for (const z of [-postZ, postZ]) {
    let previous = new THREE.Vector3(-postX, archBase, z);
    for (let index = 1; index <= archSegments; index += 1) {
      const t = index / archSegments;
      const x = -postX + width * 0.74 * t;
      const y = archBase + (archTop - archBase) * Math.sin(t * Math.PI);
      const next = new THREE.Vector3(x, y, z);
      addBeam(group, previous, next, postWidth * 0.78, archDepth, timberLight, `orchard-curved-arch-${z < 0 ? 'rear' : 'front'}-${index}`);
      previous = next;
    }
  }
  // Roof slats run front to back, leaving visible gaps that read as a
  // pergola instead of a solid building roof.
  const slatCount = 7;
  for (let index = 0; index < slatCount; index += 1) {
    const x = -postX + (postX * 2 * index) / (slatCount - 1);
    addBox(group, postWidth * 0.66, postWidth * 0.72, postZ * 2.28, timberLight, `orchard-pergola-roof-slat-${index + 1}`, x, archTop - height * 0.025, 0);
  }

  const basketY = height * 0.52;
  const basketRadius = Math.min(width * 0.045, depth * 0.06);
  const basketPositions = [
    [-width * 0.25, basketY, depth * 0.15],
    [width * 0.02, basketY - height * 0.025, -depth * 0.10],
    [width * 0.24, basketY + height * 0.015, depth * 0.16],
  ];
  basketPositions.forEach(([x, y, z], index) => {
    addCone(group, basketRadius, basketRadius * 0.75, basket, `orchard-fruit-basket-${index + 1}`, x, y, z, 8);
    for (let fruitIndex = 0; fruitIndex < 3; fruitIndex += 1) {
      const angle = fruitIndex / 3 * TAU + index * 0.7;
      const materialForFruit = (fruitIndex + index) % 2 ? fruit : fruitGold;
      addSphere(group, basketRadius * 0.44, materialForFruit, `orchard-basket-${index + 1}-fruit-${fruitIndex + 1}`, x + Math.cos(angle) * basketRadius * 0.48, y + basketRadius * 0.52, z + Math.sin(angle) * basketRadius * 0.48, 6, 4);
    }
  });
  // Sparse leaves make the baskets and arch readable without turning the
  // landmark into a dense orchard feature patch.
  for (let index = 0; index < 5; index += 1) {
    const x = -width * 0.28 + index * width * 0.14;
    const z = (index % 2 ? -1 : 1) * depth * 0.19;
    addSphere(group, width * 0.045, leaf, `orchard-vine-leaf-${index + 1}`, x, height * 0.89 + (index % 2) * height * 0.02, z, 6, 4);
  }
  group.userData.cues = ['arched pergola', 'open roof slats', 'three hanging fruit baskets'];
  group.userData.basketCount = basketPositions.length;
  return finish(group);
}

function createDepot(object = {}) {
  const { group, width, depth, height } = baseGroup(
    'landmark-depot',
    object,
    DEFAULTS['landmark-depot'],
    object.label || 'Adobe desert depot',
  );
  const adobe = material(object.color, 0xb86e45, { roughness: 0.95 });
  const adobeLight = material(0xd48a57, 0xd48a57, { roughness: 0.92 });
  const adobeDark = material(0x89503a, 0x89503a, { roughness: 0.97 });
  const teal = material(object.doorColor, 0x147b7c, { roughness: 0.65, metalness: 0.08 });
  const tealDark = material(0x0b555c, 0x0b555c, { roughness: 0.69, metalness: 0.08 });
  const shadow = material(0x493c36, 0x493c36, { roughness: 0.95 });

  const bodyWidth = width * 0.73;
  const bodyDepth = depth * 0.70;
  const bodyHeight = height * 0.64;
  addBox(group, bodyWidth, bodyHeight, bodyDepth, adobe, 'depot-adobe-main-body', 0, bodyHeight / 2, 0);
  addBox(group, bodyWidth * 1.05, height * 0.055, bodyDepth * 1.06, adobeDark, 'depot-foundation-band', 0, height * 0.0275, 0);
  const parapetHeight = height * 0.105;
  addBox(group, bodyWidth * 1.05, parapetHeight, bodyDepth * 1.06, adobeLight, 'depot-parapet', 0, bodyHeight + parapetHeight / 2, 0);
  for (const x of [-bodyWidth * 0.38, -bodyWidth * 0.13, bodyWidth * 0.13, bodyWidth * 0.38]) {
    addBox(group, width * 0.055, parapetHeight * 1.22, depth * 0.09, adobeLight, `depot-parapet-merlon-${x.toFixed(2)}`, x, bodyHeight + parapetHeight * 0.57, depth * 0.02);
  }

  const doorWidth = bodyWidth * 0.42;
  const doorHeight = bodyHeight * 0.63;
  const doorZ = bodyDepth / 2 + depth * 0.014;
  for (const side of [-1, 1]) {
    const x = side * doorWidth * 0.25;
    addBox(group, doorWidth * 0.46, doorHeight, depth * 0.024, teal, `depot-teal-double-door-${side < 0 ? 'left' : 'right'}`, x, doorHeight / 2 + height * 0.03, doorZ);
    addBox(group, depth * 0.018, doorHeight * 0.91, depth * 0.032, tealDark, `depot-teal-door-${side < 0 ? 'left' : 'right'}-stile`, x, doorHeight / 2 + height * 0.03, doorZ + depth * 0.015);
  }
  addBox(group, doorWidth * 1.08, height * 0.038, depth * 0.03, tealDark, 'depot-teal-door-lintel', 0, doorHeight + height * 0.065, doorZ);

  const towerWidth = width * 0.22;
  const towerDepth = depth * 0.24;
  const towerHeight = height * 0.93;
  const towerX = width * 0.27;
  const towerZ = -depth * 0.14;
  addBox(group, towerWidth, towerHeight, towerDepth, adobeLight, 'depot-square-watchtower', towerX, towerHeight / 2, towerZ);
  addBox(group, towerWidth * 1.16, height * 0.07, towerDepth * 1.16, adobeDark, 'depot-tower-parapet', towerX, towerHeight - height * 0.035, towerZ);
  for (const side of [-1, 1]) {
    addBox(group, towerWidth * 0.19, height * 0.04, towerDepth * 0.06, shadow, `depot-tower-window-${side < 0 ? 'west' : 'east'}`, towerX + side * towerWidth * 0.28, height * 0.70, towerZ + towerDepth / 2 + depth * 0.01);
  }
  addBox(group, towerWidth * 0.42, height * 0.04, towerDepth * 0.055, teal, 'depot-tower-teal-sign', towerX, height * 0.84, towerZ + towerDepth / 2 + depth * 0.012);
  group.userData.cues = ['adobe depot body', 'distinctive teal double doors', 'parapet', 'square watchtower'];
  group.userData.facility = 'desert depot';
  return finish(group);
}

function createRockSpire(object = {}) {
  const { group, width, depth, height } = baseGroup(
    'landmark-rock-spire',
    object,
    DEFAULTS['landmark-rock-spire'],
    object.label || 'Rock spire',
  );
  const baseMaterial = material(object.color, 0x856752, { roughness: 1 });
  const warm = material(0xa17459, 0xa17459, { roughness: 1 });
  const dark = material(0x5f4b43, 0x5f4b43, { roughness: 1 });
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  geometry.name = 'rock-spire-faceted-dodecahedron';
  const base = addMesh(group, geometry, baseMaterial, 'rock-spire-broad-base', new THREE.Vector3(-width * 0.05, height * 0.14, depth * 0.03));
  base.scale.set(width * 0.34, height * 0.13, depth * 0.33);
  // The rotated low-poly base has a slightly taller lower vertex than a
  // sphere of the same nominal scale. Lift it only enough to kiss the ground.
  base.position.y = height * 0.152;
  base.rotation.set(0.08, 0.29, -0.06);
  const shoulder = addMesh(group, geometry.clone(), warm, 'rock-spire-left-shoulder', new THREE.Vector3(-width * 0.22, height * 0.35, -depth * 0.08));
  shoulder.scale.set(width * 0.16, height * 0.22, depth * 0.18);
  shoulder.rotation.set(-0.15, -0.36, 0.16);
  const middle = addMesh(group, geometry.clone(), baseMaterial, 'rock-spire-central-mass', new THREE.Vector3(width * 0.04, height * 0.49, depth * 0.05));
  middle.scale.set(width * 0.28, height * 0.30, depth * 0.26);
  middle.rotation.set(0.12, 0.48, 0.03);
  const spire = addMesh(group, geometry.clone(), dark, 'rock-spire-pointed-cap', new THREE.Vector3(width * 0.16, height * 0.72, depth * 0.10));
  spire.scale.set(width * 0.17, height * 0.27, depth * 0.16);
  spire.rotation.set(-0.08, -0.34, 0.04);
  const tip = addCone(group, Math.min(width, depth) * 0.095, height * 0.20, warm, 'rock-spire-narrow-tip', width * 0.19, height * 0.895, depth * 0.11, 5);
  tip.rotation.y = 0.24;
  group.userData.cues = ['stacked faceted rocks', 'broad base', 'narrow pointed spire'];
  group.userData.formation = 'desert rock spire';
  return finish(group);
}

function createLookout(object = {}) {
  const { group, width, depth, height } = baseGroup(
    'landmark-lookout',
    object,
    DEFAULTS['landmark-lookout'],
    object.label || 'Timber trail overlook',
  );
  const timber = material(object.color, 0x7a583d, { roughness: 0.97 });
  const timberLight = material(0xa77a4e, 0xa77a4e, { roughness: 0.94 });
  const roof = material(0x5b4738, 0x5b4738, { roughness: 0.98 });

  const deckWidth = width * 0.78;
  const deckDepth = depth * 0.65;
  const deckY = height * 0.37;
  const deckThickness = height * 0.07;
  addBox(group, deckWidth, deckThickness, deckDepth, timberLight, 'lookout-raised-deck', 0, deckY, 0);
  addBox(group, deckWidth * 1.06, height * 0.055, deckDepth * 1.06, timber, 'lookout-deck-underframe', 0, deckY - height * 0.045, 0);
  const postRadius = Math.min(width, depth) * 0.045;
  const postHeight = deckY;
  for (const x of [-deckWidth * 0.40, deckWidth * 0.40]) for (const z of [-deckDepth * 0.36, deckDepth * 0.36]) {
    addCylinder(group, postRadius, postRadius * 1.08, postHeight, timber, `lookout-post-${x < 0 ? 'west' : 'east'}-${z < 0 ? 'rear' : 'front'}`, x, postHeight / 2, z, 6);
  }
  const railY = deckY + height * 0.24;
  for (const z of [-deckDepth * 0.45, deckDepth * 0.45]) {
    addBox(group, deckWidth * 0.95, postRadius * 1.12, postRadius * 1.14, timberLight, `lookout-front-rail-${z < 0 ? 'rear' : 'front'}`, 0, railY, z);
  }
  for (const x of [-deckWidth * 0.45, deckWidth * 0.45]) {
    addBox(group, postRadius * 1.14, postRadius * 1.12, deckDepth * 0.82, timberLight, `lookout-side-rail-${x < 0 ? 'west' : 'east'}`, x, railY, 0);
  }
  // Diagonal braces under the deck make the structure read as an overlook
  // tower, rather than a floating platform.
  addBeam(group, new THREE.Vector3(-deckWidth * 0.40, height * 0.07, -deckDepth * 0.36), new THREE.Vector3(0, deckY - height * 0.055, -deckDepth * 0.36), postRadius * 0.72, postRadius * 0.82, timber, 'lookout-west-front-brace');
  addBeam(group, new THREE.Vector3(deckWidth * 0.40, height * 0.07, deckDepth * 0.36), new THREE.Vector3(0, deckY - height * 0.055, deckDepth * 0.36), postRadius * 0.72, postRadius * 0.82, timber, 'lookout-east-rear-brace');

  const roofWidth = width * 0.82;
  const roofDepth = depth * 0.72;
  const roofBase = height * 0.80;
  const roofPeak = height * 0.97;
  addGableRoof(group, roofWidth, roofDepth, roofPeak, roofBase, height * 0.055, roof, 'lookout-roof');
  addBox(group, width * 0.07, height * 0.035, depth * 0.07, timber, 'lookout-roof-ridge', 0, roofPeak, 0);
  group.userData.cues = ['raised timber deck', 'four posts and railings', 'diagonal braces', 'pitched trail shelter roof'];
  group.userData.structure = 'trail overlook';
  return finish(group);
}

function createBridge(object = {}) {
  const { group, width, depth, height } = baseGroup(
    'landmark-bridge',
    object,
    DEFAULTS['landmark-bridge'],
    object.label || 'Marked wash crossing',
  );
  const wood = material(object.color, 0x76553f, { roughness: 0.97 });
  const woodLight = material(0xa27650, 0xa27650, { roughness: 0.95 });
  const marker = material(object.markerColor, 0xe1bd58, { roughness: 0.84 });
  const stone = material(0x8d7462, 0x8d7462, { roughness: 1 });
  const water = material(0x4c8790, 0x4c8790, { roughness: 0.72, metalness: 0.02 });

  const deckWidth = width * 0.86;
  const deckDepth = depth * 0.42;
  const deckY = height * 0.42;
  addBox(group, deckWidth, height * 0.12, deckDepth, wood, 'bridge-wash-crossing-deck', 0, deckY, 0);
  // Thin strips on the deck are a clear visual marker when the bridge is seen
  // from above during a route-planning pass.
  for (let index = -2; index <= 2; index += 1) {
    addBox(group, deckWidth * 0.83, height * 0.018, depth * 0.045, marker, `bridge-painted-marker-stripe-${index + 3}`, 0, deckY + height * 0.071, index * depth * 0.07);
  }
  const abutmentWidth = width * 0.13;
  addBox(group, abutmentWidth, deckY, deckDepth * 1.20, stone, 'bridge-west-abutment', -deckWidth * 0.47, deckY / 2, 0);
  addBox(group, abutmentWidth, deckY, deckDepth * 1.20, stone, 'bridge-east-abutment', deckWidth * 0.47, deckY / 2, 0);
  // A shallow blue-grey wash bed shows why this span exists while staying
  // below the wooden structure.
  addBox(group, deckWidth * 0.70, height * 0.025, depth * 0.70, water, 'bridge-wash-bed', 0, height * 0.018, 0);

  const railHeight = height * 0.45;
  const postRadius = Math.min(width, depth) * 0.026;
  for (const z of [-deckDepth * 0.46, deckDepth * 0.46]) {
    for (let index = -2; index <= 2; index += 1) {
      const x = index * deckWidth * 0.19;
      addCylinder(group, postRadius, postRadius, railHeight, woodLight, `bridge-rail-post-${z < 0 ? 'rear' : 'front'}-${index + 3}`, x, deckY + railHeight / 2, z, 6);
    }
    addBox(group, deckWidth * 0.90, postRadius * 1.22, postRadius * 1.16, woodLight, `bridge-rail-top-${z < 0 ? 'rear' : 'front'}`, 0, deckY + railHeight, z);
  }
  group.userData.cues = ['small wash crossing', 'painted yellow deck stripes', 'paired railings', 'stone abutments'];
  group.userData.markerCount = 5;
  return finish(group);
}

function createCampusPavilion(object = {}) {
  const { group, width, depth, height } = baseGroup(
    'landmark-campus-pavilion',
    object,
    DEFAULTS['landmark-campus-pavilion'],
    object.label || 'Campus pavilion',
  );
  const cream = material(object.columnColor, 0xe8dfc5, { roughness: 0.88 });
  const creamShadow = material(0xc5bda8, 0xc5bda8, { roughness: 0.93 });
  const blue = material(object.roofColor || object.color, 0x2e6297, { roughness: 0.73, metalness: 0.08 });
  const blueDark = material(0x214c78, 0x214c78, { roughness: 0.78, metalness: 0.08 });
  const maize = material(object.maizeColor, 0xffcb05, { roughness: 0.75, metalness: 0.04 });
  const glass = material(0x5e8da0, 0x5e8da0, { roughness: 0.35, metalness: 0.18 });

  const footprintRadius = Math.min(width, depth) * 0.36;
  const plinthRadius = Math.min(width, depth) * 0.43;
  addCylinder(group, plinthRadius, plinthRadius * 1.02, height * 0.07, creamShadow, 'campus-pavilion-round-plinth', 0, height * 0.035, 0, 16);
  const drumRadius = footprintRadius * 0.94;
  const drumBottom = height * 0.56;
  const drumHeight = height * 0.18;
  addCylinder(group, drumRadius, drumRadius, drumHeight, glass, 'campus-pavilion-glazed-drum', 0, drumBottom + drumHeight / 2, 0, 16);
  addCylinder(group, drumRadius * 1.05, drumRadius * 1.05, height * 0.045, maize, 'campus-pavilion-maize-cornice', 0, drumBottom + drumHeight, 0, 16);

  // Eight cream columns around the circular drum give the pavilion a strong
  // campus civic silhouette. Their upper capitals carry the maize accent.
  const columnRadius = Math.min(width, depth) * 0.027;
  const columnCircle = footprintRadius * 0.91;
  const columnBottom = height * 0.08;
  const columnTop = drumBottom + drumHeight * 0.72;
  const columnHeight = columnTop - columnBottom;
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * TAU + Math.PI / 8;
    const x = Math.cos(angle) * columnCircle;
    const z = Math.sin(angle) * columnCircle;
    addCylinder(group, columnRadius, columnRadius * 1.08, columnHeight, cream, `campus-pavilion-cream-column-${index + 1}`, x, columnBottom + columnHeight / 2, z, 8);
    addCylinder(group, columnRadius * 1.45, columnRadius * 1.45, height * 0.035, maize, `campus-pavilion-maize-capital-${index + 1}`, x, columnTop, z, 8);
  }

  const domeRadius = footprintRadius * 1.03;
  const domeBase = drumBottom + drumHeight * 0.84;
  const domeHeight = height * 0.24;
  const domeGeometry = new THREE.SphereGeometry(domeRadius, 16, 8, 0, TAU, 0, Math.PI / 2);
  domeGeometry.name = 'campus-pavilion-blue-dome-geometry';
  const dome = addMesh(group, domeGeometry, blue, 'campus-pavilion-blue-domed-roof', new THREE.Vector3(0, domeBase, 0));
  dome.scale.y = domeHeight / domeRadius;
  addCylinder(group, domeRadius * 0.08, domeRadius * 0.12, height * 0.045, blueDark, 'campus-pavilion-dome-finial', 0, domeBase + domeHeight + height * 0.0225, 0, 8);
  const finialRadius = Math.min(width, depth) * 0.025;
  addSphere(group, finialRadius, maize, 'campus-pavilion-maize-finial', 0, Math.min(height - finialRadius - height * 0.002, domeBase + domeHeight + height * 0.06), 0, 8, 5);
  addBox(group, width * 0.045, height * 0.035, depth * 0.055, maize, 'campus-pavilion-maize-entry-header', 0, height * 0.40, depth * 0.355);
  group.userData.cues = ['eight cream columns', 'blue half-dome roof', 'maize capitals and finial', 'glazed circular drum'];
  group.userData.facility = 'fictional Ann Arbor campus pavilion';
  return finish(group);
}

function addClockFace(group, radius, faceMaterial, ringMaterial, handMaterial, name, position, orientation) {
  const sideFace = Math.abs(orientation.z) > 0.5;
  const face = addMesh(group, new THREE.CylinderGeometry(radius, radius, radius * 0.075, 16), faceMaterial, `${name}-face`, position);
  face.rotation.copy(orientation);
  const ring = addMesh(group, new THREE.TorusGeometry(radius * 0.89, radius * 0.075, 6, 16), ringMaterial, `${name}-ring`, new THREE.Vector3(position.x, position.y, position.z));
  ring.rotation.copy(orientation);
  const handPosition = new THREE.Vector3(position.x, position.y + radius * 0.06, position.z);
  const hand = sideFace
    ? addBox(group, radius * 0.07, radius * 0.075, radius * 0.72, handMaterial, `${name}-minute-hand`, handPosition.x, handPosition.y, handPosition.z)
    : addBox(group, radius * 0.72, radius * 0.075, radius * 0.07, handMaterial, `${name}-minute-hand`, handPosition.x, handPosition.y, handPosition.z);
  if (sideFace) hand.rotation.x = -Math.PI * 0.23;
  else hand.rotation.z = -Math.PI * 0.23;
  const short = sideFace
    ? addBox(group, radius * 0.075, radius * 0.075, radius * 0.45, handMaterial, `${name}-hour-hand`, position.x, position.y + radius * 0.06, position.z)
    : addBox(group, radius * 0.45, radius * 0.075, radius * 0.075, handMaterial, `${name}-hour-hand`, position.x, position.y + radius * 0.06, position.z);
  if (sideFace) short.rotation.x = Math.PI * 0.17;
  else short.rotation.z = Math.PI * 0.17;
  addSphere(group, radius * 0.095, handMaterial, `${name}-center`, position.x, position.y + radius * 0.07, position.z, 6, 4);
}

function createClocktower(object = {}) {
  const { group, width, depth, height } = baseGroup(
    'landmark-clocktower',
    object,
    DEFAULTS['landmark-clocktower'],
    object.label || 'Campus brick clocktower',
  );
  const brick = material(object.color, 0x984e3d, { roughness: 0.93 });
  const brickLight = material(0xb9664c, 0xb9664c, { roughness: 0.9 });
  const brickDark = material(0x64352f, 0x64352f, { roughness: 0.97 });
  const face = material(0xe8ddbd, 0xe8ddbd, { roughness: 0.84 });
  const ring = material(0x3d3330, 0x3d3330, { roughness: 0.82, metalness: 0.08 });
  const hand = material(0x28343a, 0x28343a, { roughness: 0.72, metalness: 0.22 });

  const baseWidth = width * 0.75;
  const baseDepth = depth * 0.75;
  const baseHeight = height * 0.10;
  addBox(group, baseWidth, baseHeight, baseDepth, brickDark, 'clocktower-brick-base', 0, baseHeight / 2, 0);
  const shaftWidth = width * 0.57;
  const shaftDepth = depth * 0.57;
  const roofBase = height * 0.80;
  addBox(group, shaftWidth, roofBase - baseHeight, shaftDepth, brick, 'clocktower-brick-shaft', 0, (roofBase + baseHeight) / 2, 0);
  for (const x of [-shaftWidth * 0.43, shaftWidth * 0.43]) {
    addBox(group, width * 0.06, roofBase - baseHeight, depth * 0.065, brickLight, `clocktower-corner-pilaster-${x < 0 ? 'west' : 'east'}`, x, (roofBase + baseHeight) / 2, depth * 0.01);
  }
  const clockY = height * 0.64;
  const faceRadius = Math.min(width, depth) * 0.16;
  const faceOffset = shaftDepth / 2 + faceRadius * 0.045;
  addClockFace(group, faceRadius, face, ring, hand, 'clocktower-front-clock', new THREE.Vector3(0, clockY, faceOffset), new THREE.Euler(Math.PI / 2, 0, 0));
  addClockFace(group, faceRadius, face, ring, hand, 'clocktower-back-clock', new THREE.Vector3(0, clockY, -faceOffset), new THREE.Euler(Math.PI / 2, 0, Math.PI));
  addClockFace(group, faceRadius, face, ring, hand, 'clocktower-west-clock', new THREE.Vector3(-faceOffset, clockY, 0), new THREE.Euler(0, 0, Math.PI / 2));
  addClockFace(group, faceRadius, face, ring, hand, 'clocktower-east-clock', new THREE.Vector3(faceOffset, clockY, 0), new THREE.Euler(0, 0, -Math.PI / 2));

  const belfryY = roofBase;
  const belfryHeight = height * 0.095;
  addBox(group, shaftWidth * 1.04, belfryHeight, shaftDepth * 1.04, brickDark, 'clocktower-belfry-band', 0, belfryY + belfryHeight / 2, 0);
  const openingWidth = shaftWidth * 0.16;
  const openingHeight = belfryHeight * 0.47;
  for (const x of [-shaftWidth * 0.32, 0, shaftWidth * 0.32]) {
    addBox(group, openingWidth, openingHeight, depth * 0.022, face, `clocktower-belfry-front-opening-${x.toFixed(2)}`, x, belfryY + belfryHeight * 0.53, shaftDepth / 2 + depth * 0.018);
  }
  const roofHeight = height * 0.105;
  addCone(group, Math.min(width, depth) * 0.39, roofHeight, brick, 'clocktower-pyramidal-roof', 0, belfryY + belfryHeight + roofHeight / 2, 0, 4);
  const finialBottom = belfryY + belfryHeight + roofHeight;
  const finialTop = Math.min(height * 0.985, finialBottom + height * 0.055);
  addCylinder(group, width * 0.018, width * 0.018, finialTop - finialBottom, ring, 'clocktower-finial', 0, (finialBottom + finialTop) / 2, 0, 6);
  const finialCapRadius = width * 0.035;
  addSphere(group, finialCapRadius, ring, 'clocktower-finial-cap', 0, Math.min(height - finialCapRadius - height * 0.002, finialTop), 0, 6, 4);
  group.userData.cues = ['campus red brick shaft', 'four clock faces', 'belfry openings', 'pyramidal roof and finial'];
  group.userData.clockFaceCount = 4;
  group.userData.facility = 'campus clocktower';
  return finish(group);
}

/**
 * Create one of the authored landmark models. Unknown styles intentionally
 * return null so callers can keep their ordinary marker or fallback mesh.
 */
export function createLandmarkModel(object = {}) {
  const style = String(object?.style || '').trim().toLowerCase();
  switch (style) {
    case 'landmark-barnhouse': return createBarnhouse(object);
    case 'landmark-saguaro': return createSaguaro(object);
    case 'landmark-windmill': return createWindmill(object);
    case 'landmark-orchard': return createOrchard(object);
    case 'landmark-depot': return createDepot(object);
    case 'landmark-rock-spire': return createRockSpire(object);
    case 'landmark-lookout': return createLookout(object);
    case 'landmark-bridge': return createBridge(object);
    case 'landmark-clocktower': return createClocktower(object);
    case 'landmark-campus-pavilion': return createCampusPavilion(object);
    default: return null;
  }
}
