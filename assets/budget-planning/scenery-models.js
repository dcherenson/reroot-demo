import * as THREE from './vendor/three.module.js';

/*
 * Ann Arbor landmark meshes used by renderer.js.  The proportions and visual
 * cues here are informed by the official facility pages (read-only references):
 *
 *   https://www.robotics.umich.edu/about/facilities/ford-robotics-building/
 *   https://mgoblue.com/sports/2017/6/16/facilities-michigan-stadium-html?id=157
 *   https://www.uofmhealth.org/our-care/clinical-units/survival-flight
 *   https://www.uofmhealth.org/locations-list/university-hospital
 *
 * Every factory returns a group whose origin is the object's ground center.
 * The caller owns placement and yaw.  No image, font, or runtime asset is
 * loaded here; the optional end-zone wordmark is generated on a canvas.
 */

const TAU = Math.PI * 2;
const RATIO_FOOTBALL_FIELD = 120 / 53.3;
const RING_SEGMENTS = 64;

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
    width: positive(object && object.width, defaults.width),
    depth: positive(object && object.depth, defaults.depth),
    height: positive(object && object.height, defaults.height),
  };
}

function color(value, fallback) {
  if (value && value.isColor) return value.clone();
  try {
    return new THREE.Color(value == null ? fallback : value);
  } catch (_error) {
    return new THREE.Color(fallback);
  }
}

function standardMaterial(value, fallback, options = {}) {
  const parameters = {
    color: color(value, fallback),
    roughness: options.roughness == null ? .86 : options.roughness,
    metalness: options.metalness == null ? .02 : options.metalness,
    flatShading: Boolean(options.flatShading),
  };
  if (options.side !== undefined) parameters.side = options.side;
  return new THREE.MeshStandardMaterial(parameters);
}

function basicMaterial(value, options = {}) {
  const parameters = {
    color: color(value, 0xffffff),
    transparent: Boolean(options.transparent),
    opacity: options.opacity == null ? 1 : options.opacity,
    map: options.map || null,
    depthWrite: options.depthWrite == null ? true : options.depthWrite,
  };
  if (options.side !== undefined) parameters.side = options.side;
  return new THREE.MeshBasicMaterial(parameters);
}

function addMesh(group, geometry, material, name, position = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  if (position) mesh.position.copy(position);
  group.add(mesh);
  return mesh;
}

function addInstanced(group, geometry, material, positions, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < positions.length; index += 1) {
    const entry = positions[index];
    matrix.makeTranslation(entry.x, entry.y, entry.z);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return mesh;
}

function addOrientedInstanced(group, geometry, material, transforms, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let index = 0; index < transforms.length; index += 1) {
    const entry = transforms[index];
    position.set(entry.x, entry.y, entry.z);
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), finite(entry.rotation));
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return mesh;
}

function setBounds(group, width, depth, height) {
  group.userData.bounds = { width, depth, height };
  return group;
}

function ringPoint(width, depth, radiusSquared, theta, y) {
  const radius = Math.sqrt(Math.max(0, radiusSquared));
  return new THREE.Vector3(
    width * .5 * radius * Math.cos(theta),
    y,
    depth * .5 * radius * Math.sin(theta),
  );
}

function pushVertex(data, vector) {
  data.positions.push(vector.x, vector.y, vector.z);
  return data.positions.length / 3 - 1;
}

function connectLoops(data, first, second, segments = RING_SEGMENTS, reverse = false) {
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    if (reverse) data.indices.push(first[index], second[index], first[next], first[next], second[index], second[next]);
    else data.indices.push(first[index], first[next], second[index], first[next], second[next], second[index]);
  }
}

function addHorizontalRing(data, width, depth, innerSquared, outerSquared, y, segments = RING_SEGMENTS) {
  const inner = [];
  const outer = [];
  for (let index = 0; index < segments; index += 1) {
    const theta = index / segments * TAU;
    inner.push(pushVertex(data, ringPoint(width, depth, innerSquared, theta, y)));
    outer.push(pushVertex(data, ringPoint(width, depth, outerSquared, theta, y)));
  }
  connectLoops(data, inner, outer, segments);
}

function addVerticalRingWall(data, width, depth, radiusSquared, bottom, top, segments = RING_SEGMENTS, reverse = false) {
  const lower = [];
  const upper = [];
  for (let index = 0; index < segments; index += 1) {
    const theta = index / segments * TAU;
    lower.push(pushVertex(data, ringPoint(width, depth, radiusSquared, theta, bottom)));
    upper.push(pushVertex(data, ringPoint(width, depth, radiusSquared, theta, top)));
  }
  connectLoops(data, lower, upper, segments, reverse);
}

function finishGeometry(data, name) {
  const geometry = new THREE.BufferGeometry();
  geometry.name = name;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function connectOpenLoops(data, first, second, reverse = false) {
  for (let index = 0; index < first.length - 1; index += 1) {
    const next = index + 1;
    if (reverse) data.indices.push(first[index], second[index], first[next], first[next], second[index], second[next]);
    else data.indices.push(first[index], first[next], second[index], first[next], second[next], second[index]);
  }
}

function curvedPoint(radius, centerZ, theta, y) {
  return new THREE.Vector3(radius * Math.sin(theta), y, centerZ + radius * Math.cos(theta));
}

/**
 * Build a shallow, open-ended curved wall.  The Ford facade is intentionally
 * a small arc rather than a high-resolution architectural surface so the
 * landmark remains cheap to render in the browser.
 */
function createCurvedWallGeometry(radius, centerZ, arc, bottom, top, thickness, segments, name) {
  const data = { positions: [], indices: [] };
  const outerBottom = [];
  const outerTop = [];
  const innerBottom = [];
  const innerTop = [];
  const innerRadius = Math.max(.001, radius - thickness);
  for (let index = 0; index <= segments; index += 1) {
    const theta = -arc / 2 + arc * index / segments;
    outerBottom.push(pushVertex(data, curvedPoint(radius, centerZ, theta, bottom)));
    outerTop.push(pushVertex(data, curvedPoint(radius, centerZ, theta, top)));
    innerBottom.push(pushVertex(data, curvedPoint(innerRadius, centerZ, theta, bottom)));
    innerTop.push(pushVertex(data, curvedPoint(innerRadius, centerZ, theta, top)));
  }
  connectOpenLoops(data, outerBottom, outerTop);
  connectOpenLoops(data, innerBottom, innerTop, true);
  connectOpenLoops(data, outerTop, innerTop);
  connectOpenLoops(data, innerBottom, outerBottom, true);
  for (const index of [0, segments]) {
    data.indices.push(
      outerBottom[index], innerBottom[index], outerTop[index],
      outerTop[index], innerBottom[index], innerTop[index],
    );
  }
  return finishGeometry(data, name);
}

function createAnnulusGeometry(width, depth, innerSquared, outerSquared, bottom, top, name) {
  const data = { positions: [], indices: [] };
  addHorizontalRing(data, width, depth, innerSquared, outerSquared, top);
  addVerticalRingWall(data, width, depth, innerSquared, bottom, top, RING_SEGMENTS, true);
  addVerticalRingWall(data, width, depth, outerSquared, bottom, top, RING_SEGMENTS, false);
  return finishGeometry(data, name);
}

function createSteppedStandGeometry(width, depth, innerSquared, outerSquared, top, steps = 10) {
  const data = { positions: [], indices: [] };
  const stepHeight = top / steps;
  for (let step = 0; step < steps; step += 1) {
    const start = innerSquared + (outerSquared - innerSquared) * step / steps;
    const end = innerSquared + (outerSquared - innerSquared) * (step + 1) / steps;
    const y = stepHeight * (step + 1);
    addHorizontalRing(data, width, depth, start, end, y);
    addVerticalRingWall(data, width, depth, end, stepHeight * step, y);
    addVerticalRingWall(data, width, depth, start, stepHeight * step, y, RING_SEGMENTS, true);
  }
  return finishGeometry(data, 'stadium-stepped-grandstand');
}

function createLineGeometry(points) {
  const geometry = new THREE.BufferGeometry();
  geometry.setFromPoints(points);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeTextTexture(text, foreground, background) {
  // Server-side tests have no DOM.  The stadium still builds in that case;
  // browser builds get the lightweight, self-contained end-zone wordmark.
  if (typeof document === 'undefined' || typeof THREE.CanvasTexture !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = foreground;
  context.font = '900 72px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createMGeometry(width, depth) {
  const shape = new THREE.Shape();
  const outline=[[-.5,-.5],[-.5,.5],[-.25,.5],[0,.1],[.25,.5],[.5,.5],[.5,-.5],[.25,-.5],[.25,.08],[0,-.27],[-.25,.08],[-.25,-.5]];
  outline.forEach(([x,y],i)=>i?shape.lineTo(x*width,y*depth):shape.moveTo(x*width,y*depth));
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function createHGeometry(width, depth, bar) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const halfBar = bar / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, -halfDepth);
  shape.lineTo(-halfWidth + bar, -halfDepth);
  shape.lineTo(-halfWidth + bar, -halfBar);
  shape.lineTo(halfWidth - bar, -halfBar);
  shape.lineTo(halfWidth - bar, -halfDepth);
  shape.lineTo(halfWidth, -halfDepth);
  shape.lineTo(halfWidth, halfDepth);
  shape.lineTo(halfWidth - bar, halfDepth);
  shape.lineTo(halfWidth - bar, halfBar);
  shape.lineTo(-halfWidth + bar, halfBar);
  shape.lineTo(-halfWidth + bar, halfDepth);
  shape.lineTo(-halfWidth, halfDepth);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function addFootballMarkings(fieldGroup, fieldWidth, fieldLength, y) {
  const points = [];
  const halfWidth = fieldWidth / 2;
  const halfLength = fieldLength / 2;
  const addSegment = (a, b) => points.push(new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y, b[1]));
  addSegment([-halfWidth, -halfLength], [halfWidth, -halfLength]);
  addSegment([-halfWidth, halfLength], [halfWidth, halfLength]);
  addSegment([-halfWidth, -halfLength], [-halfWidth, halfLength]);
  addSegment([halfWidth, -halfLength], [halfWidth, halfLength]);
  addSegment([0, -halfLength], [0, halfLength]);
  for (let yard = -4; yard <= 4; yard += 1) {
    const z = yard * fieldLength / 10;
    addSegment([-halfWidth, z], [halfWidth, z]);
  }
  const geometry = createLineGeometry(points);
  const material = new THREE.LineBasicMaterial({ color: 0xe8e9d8, transparent: true, opacity: .86 });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'stadium-field-markings';
  fieldGroup.add(lines);
  return lines;
}

/**
 * Create a low oval Michigan Stadium bowl.  The renderer places and rotates
 * the returned group; this function intentionally leaves its transform at
 * the object-local ground origin.
 */
export function createStadium(object = {}) {
  const { width, depth, height } = dimensions(object, { width: 44, depth: 57, height: 14 });
  const visualHeight = Math.min(height, 7);
  const fieldBottom = Math.min(.10, visualHeight * .03);
  const fieldThickness = Math.min(.20, Math.max(.02, visualHeight * .028));
  const group = setBounds(new THREE.Group(), width, depth, height);
  group.name = 'michigan-stadium';
  group.userData.collisionAnnulus = { innerSquared: .68, outerSquared: 1.18, collisionHeight: 7 };
  group.userData.footballFieldRatio = RATIO_FOOTBALL_FIELD;

  // A world object's generic color often carries the blue stadium palette;
  // keep the exterior brick reddish unless a dedicated brickColor is given.
  const brick = standardMaterial(object.brickColor, 0x984e3d, { roughness: .91, side: THREE.DoubleSide });
  const brickShadow = standardMaterial(0x713b35, 0x713b35, { roughness: .94, side: THREE.DoubleSide });
  const stand = standardMaterial(0x173a55, 0x173a55, { roughness: .85, flatShading: true, side: THREE.DoubleSide });
  const track = standardMaterial(0x98654b, 0x98654b, { roughness: .98 });
  const fieldMaterial = standardMaterial(0x4e806a, 0x4e806a, { roughness: .96 });
  const maize = standardMaterial(0xffcb05, 0xffcb05, { roughness: .72 });
  const screen = standardMaterial(0x101e2c, 0x101e2c, { roughness: .57, metalness: .28 });
  const screenGlow = standardMaterial(0x2d6780, 0x2d6780, { roughness: .36, metalness: .35 });
  const glass = standardMaterial(0x547b86, 0x547b86, { roughness: .28, metalness: .28 });

  // The outside ring is kept at normalized radius squared .985, which is
  // inside both the object's dimensions and the authoritative .68..1.18
  // collision annulus.  The field and track remain inside .68.
  const exterior = addMesh(
    group,
    createAnnulusGeometry(width, depth, .89, .985, 0, visualHeight * .45, 'stadium-brick-exterior'),
    brick,
    'stadium-brick-exterior',
  );
  exterior.userData.annulus = { innerSquared: .89, outerSquared: .985 };
  const lowerShadow = addMesh(
    group,
    createAnnulusGeometry(width, depth, .952, .985, 0, visualHeight * .16, 'stadium-brick-shadow'),
    brickShadow,
    'stadium-brick-shadow',
  );
  lowerShadow.userData.annulus = { innerSquared: .952, outerSquared: .985 };
  const grandstand = addMesh(
    group,
    createSteppedStandGeometry(width, depth, .68, .955, visualHeight * .83, 11),
    stand,
    'stadium-stepped-grandstand',
  );
  grandstand.userData.annulus = { innerSquared: .68, outerSquared: .955 };
  addMesh(
    group,
    createAnnulusGeometry(
      width,
      depth,
      .30,
      .68,
      Math.min(fieldBottom * .62, visualHeight * .018),
      Math.min(fieldBottom + fieldThickness * .56, visualHeight * .045),
      'stadium-track',
    ),
    track,
    'stadium-track',
  );

  const longIsZ = depth >= width;
  const shortAxis = Math.min(width, depth);
  const longAxis = Math.max(width, depth);
  const fieldGroup = new THREE.Group();
  fieldGroup.name = 'stadium-field';
  fieldGroup.rotation.y = longIsZ ? 0 : Math.PI / 2;
  group.add(fieldGroup);
  // The field stays within the inner ellipse, including its rectangular
  // corners.  With L/W=120/53.3, this corner bound is tighter than checking
  // the two half-extents independently.
  const cornerLength = Math.sqrt(.68 / (
    1 / (RATIO_FOOTBALL_FIELD * shortAxis) ** 2 + 1 / longAxis ** 2
  ));
  const fieldLength = Math.min(longAxis * .74, shortAxis * .64 * RATIO_FOOTBALL_FIELD, cornerLength);
  const fieldWidth = fieldLength / RATIO_FOOTBALL_FIELD;
  const fieldY = fieldBottom + fieldThickness / 2;
  const field = addMesh(
    fieldGroup,
    new THREE.BoxGeometry(fieldWidth, fieldThickness, fieldLength),
    fieldMaterial,
    'stadium-field-surface',
    new THREE.Vector3(0, fieldY, 0),
  );
  field.userData.dimensions = { width: fieldWidth, depth: fieldLength, ratio: RATIO_FOOTBALL_FIELD };
  const markingY = Math.min(visualHeight * .96, fieldBottom + fieldThickness + Math.max(.012, visualHeight * .006));
  addFootballMarkings(fieldGroup, fieldWidth * .97, fieldLength * .96, markingY);

  const mGeometry = createMGeometry(Math.min(fieldWidth * .2, 3.3), Math.min(fieldWidth * .22, 3.7));
  const m = addMesh(fieldGroup, mGeometry, maize, 'stadium-midfield-M', new THREE.Vector3(0, Math.min(visualHeight * .96, markingY + Math.max(.008, visualHeight * .004)), 0));
  m.rotation.x = -Math.PI / 2;
  m.userData.mark = 'Michigan M';

  const labelTexture = makeTextTexture('MICHIGAN', '#ffcb05', '#173a55');
  if (labelTexture) {
    const labelMaterial = basicMaterial(0xffffff, { map: labelTexture, side: THREE.DoubleSide });
    const labelGeometry = new THREE.PlaneGeometry(fieldWidth * .72, fieldLength * .105);
    for (const sign of [-1, 1]) {
      const label = addMesh(
        fieldGroup,
        labelGeometry,
        labelMaterial,
        `stadium-endzone-label-${sign < 0 ? 'north' : 'south'}`,
        new THREE.Vector3(0, Math.min(visualHeight * .96, markingY + Math.max(.008, visualHeight * .004)), sign * fieldLength * .425),
      );
      label.rotation.x = -Math.PI / 2;
      if (sign < 0) label.rotation.y = Math.PI;
    }
    group.userData.resources = [labelTexture];
  }

  const suiteHeight = Math.min(.92, Math.max(.02, visualHeight * .16));
  const suiteBottom = Math.max(.01, visualHeight - suiteHeight - Math.max(.02, visualHeight * .012));
  const suiteLength = Math.min(longAxis * .52, Math.max(longAxis * .08, fieldLength * .55));
  const suiteDepth = Math.min(1.05, Math.max(.001, shortAxis * .035));
  const suiteGeometry = new THREE.BoxGeometry(suiteDepth, suiteHeight, suiteLength);
  // Suites sit on the sideline rim, outside the .68 field ellipse and inside
  // the .985 visual bowl.  The field frame's x axis is always the short axis.
  const suiteOffset = shortAxis * .46;
  addInstanced(
    fieldGroup,
    suiteGeometry,
    screen,
    [
      { x: -suiteOffset, y: suiteBottom + suiteHeight / 2, z: 0 },
      { x: suiteOffset, y: suiteBottom + suiteHeight / 2, z: 0 },
    ],
    'stadium-press-suite-boxes',
  );
  const suitePanelThickness = Math.max(.001, Math.min(.035, shortAxis * .012));
  const suitePanelGap = Math.max(.001, Math.min(.021, shortAxis * .006));
  const suiteGlassGeometry = new THREE.BoxGeometry(suitePanelThickness, suiteHeight * .57, suiteLength * .88);
  addInstanced(
    fieldGroup,
    suiteGlassGeometry,
    glass,
    [
      { x: -suiteOffset - suiteDepth / 2 - suitePanelGap, y: suiteBottom + suiteHeight * .55, z: 0 },
      { x: suiteOffset + suiteDepth / 2 + suitePanelGap, y: suiteBottom + suiteHeight * .55, z: 0 },
    ],
    'stadium-press-suite-glass',
  );

  const boardHeight = Math.min(1.65, Math.max(.025, visualHeight * .23));
  const boardWidth = Math.min(fieldWidth * .72, shortAxis * .34);
  const boardDepth = Math.min(.42, Math.max(.001, longAxis * .035));
  // End boards live on the long-axis rim, with every board corner still below
  // normalized radius squared 1.18 and outside the .68 field ellipse.
  const boardZ = longAxis * .45;
  const boardY = visualHeight * .73;
  const boardGeometry = new THREE.BoxGeometry(boardWidth, boardHeight, boardDepth);
  addInstanced(
    fieldGroup,
    boardGeometry,
    screen,
    [
      { x: 0, y: boardY, z: -boardZ },
      { x: 0, y: boardY, z: boardZ },
    ],
    'stadium-end-video-boards',
  );
  const boardFaceGeometry = new THREE.BoxGeometry(boardWidth * .86, boardHeight * .76, Math.min(.035, boardDepth * .10));
  addInstanced(
    fieldGroup,
    boardFaceGeometry,
    screenGlow,
    [
      { x: 0, y: boardY, z: -boardZ - boardDepth / 2 - Math.min(.01, boardDepth * .03) },
      { x: 0, y: boardY, z: boardZ + boardDepth / 2 + Math.min(.01, boardDepth * .03) },
    ],
    'stadium-video-board-faces',
  );

  // A small paved gate strip at each end hints at the brick concourses while
  // avoiding the old yellow tower/pillar treatment.
  const gateGeometry = new THREE.BoxGeometry(boardWidth * .30, Math.min(.22, visualHeight * .04), Math.min(.68, Math.max(.001, depth * .03)));
  addInstanced(
    group,
    gateGeometry,
    brickShadow,
    [
      { x: -width * .31, y: Math.min(.18, visualHeight * .04), z: 0 },
      { x: width * .31, y: Math.min(.18, visualHeight * .04), z: 0 },
    ],
    'stadium-brick-gate-details',
  );
  return group;
}

function createHorizontalWindowInstances(group, geometry, material, positions, name) {
  return addInstanced(group, geometry, material, positions, name);
}

/** Create the four-story Ford Motor Company Robotics Building. */
export function createFordRobotics(object = {}) {
  const { width, depth, height } = dimensions(object, { width: 31, depth: 18, height: 15 });
  const group = setBounds(new THREE.Group(), width, depth, height);
  group.name = 'ford-robotics-building';
  group.userData.facility = 'Ford Motor Company Robotics Building';

  const brick = standardMaterial(object.brickColor || object.color, 0x984e3d, { roughness: .91 });
  const brickLight = standardMaterial(0xb7624c, 0xb7624c, { roughness: .88 });
  const brickShadow = standardMaterial(0x66352f, 0x66352f, { roughness: .95 });
  const metal = standardMaterial(0x53616a, 0x53616a, { roughness: .62, metalness: .44 });
  const darkMetal = standardMaterial(0x28383f, 0x28383f, { roughness: .69, metalness: .38 });
  const glass = standardMaterial(0x568b98, 0x568b98, { roughness: .25, metalness: .24, side: THREE.DoubleSide });
  const window = standardMaterial(0xa6ccd0, 0xa6ccd0, { roughness: .3, metalness: .15 });
  const entry = standardMaterial(0x243b4b, 0x243b4b, { roughness: .35, metalness: .32 });
  const entryWing = standardMaterial(0xc6c3b7, 0xc6c3b7, { roughness: .9 });

  // The Sketchfab view shows a compact brick/service mass turning into a
  // broad curved collaboration facade.  Keep the solid masses set back from
  // the arc so the glazing remains readable from the renderer's oblique view.
  const lowerHeight = height * .55;
  const upperHeight = Math.max(.001, height - lowerHeight);
  const lowerWidth = width * .74;
  const lowerDepth = depth * .68;
  const lowerX = -width * .10;
  const lowerZ = -depth * .08;
  const upperWidth = width * .64;
  const upperDepth = depth * .57;
  const upperX = -width * .06;
  const upperZ = -depth * .08;
  addMesh(
    group,
    new THREE.BoxGeometry(lowerWidth, lowerHeight, lowerDepth),
    brick,
    'ford-brick-four-story-base',
    new THREE.Vector3(lowerX, lowerHeight / 2, lowerZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(lowerWidth * .98, Math.min(.28, height * .035), lowerDepth * 1.01),
    brickLight,
    'ford-brick-plinth',
    new THREE.Vector3(lowerX, Math.min(.14, height * .0175), lowerZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(upperWidth, upperHeight * .86, upperDepth),
    metal,
    'ford-setback-metal-upper',
    new THREE.Vector3(upperX, lowerHeight + upperHeight * .43, upperZ),
  );

  const facadeArc = 1.12;
  const facadeWidth = Math.min(width * .70, depth * 1.30);
  const facadeRadius = facadeWidth / (2 * Math.sin(facadeArc / 2));
  const facadeFrontZ = depth * .43;
  const facadeCenterZ = facadeFrontZ - facadeRadius;
  const glassBottom = height * .16;
  const glassTop = height * .79;
  const facadeThickness = Math.min(.16, Math.max(.035, depth * .012));
  const facadeGeometry = createCurvedWallGeometry(
    facadeRadius,
    facadeCenterZ,
    facadeArc,
    glassBottom,
    glassTop,
    facadeThickness,
    12,
    'ford-curved-glass-facade',
  );
  addMesh(group, facadeGeometry, glass, 'ford-collaboration-glass-facades');

  // Vertical mullions turn the single curved surface into the fine-grained
  // curtain wall visible in the reference model while keeping one draw call.
  const mullionGeometry = new THREE.BoxGeometry(
    Math.max(.045, width * .014),
    glassTop - glassBottom + Math.max(.04, height * .012),
    Math.max(.025, depth * .010),
  );
  const mullions = [];
  for (let index = 0; index <= 8; index += 1) {
    const theta = -facadeArc / 2 + facadeArc * index / 8;
    const point = curvedPoint(facadeRadius + facadeThickness * .55, facadeCenterZ, theta, (glassBottom + glassTop) / 2);
    mullions.push({ x: point.x, y: point.y, z: point.z, rotation: theta });
  }
  addOrientedInstanced(group, mullionGeometry, darkMetal, mullions, 'ford-curved-glass-mullions');
  const floorRailHeight = Math.max(.025, height * .014);
  for (let rail = 1; rail <= 3; rail += 1) {
    const y = glassBottom + (glassTop - glassBottom) * rail / 4;
    addMesh(
      group,
      createCurvedWallGeometry(facadeRadius + facadeThickness * .68, facadeCenterZ, facadeArc, y, y + floorRailHeight, facadeThickness * .58, 12, `ford-curved-glass-floor-rail-${rail}`),
      darkMetal,
      `ford-curved-glass-floor-rail-${rail}`,
    );
  }

  // The upper facade reads as a dark horizontal louver/screen in the official
  // exterior views.  Three shallow curved rails and a roof cap keep that cue
  // legible in a stylized low-poly scene.
  const screenBottom = height * .755;
  const screenTop = height * .96;
  addMesh(
    group,
    createCurvedWallGeometry(facadeRadius + facadeThickness * .35, facadeCenterZ, facadeArc, screenBottom, screenTop, facadeThickness * 1.18, 12, 'ford-curved-roof-screen'),
    darkMetal,
    'ford-curved-roof-screen',
  );
  const railHeight = Math.max(.035, height * .018);
  for (let rail = 0; rail < 3; rail += 1) {
    const y = screenBottom + (rail + .55) * (screenTop - screenBottom) / 3;
    addMesh(
      group,
      createCurvedWallGeometry(facadeRadius + facadeThickness * .72, facadeCenterZ, facadeArc, y, Math.min(screenTop, y + railHeight), facadeThickness * .70, 12, `ford-curved-roof-rail-${rail}`),
      metal,
      `ford-curved-roof-rail-${rail}`,
    );
  }
  const roofThickness = Math.min(.60, Math.max(.08, height * .04));
  addMesh(
    group,
    new THREE.BoxGeometry(upperWidth * 1.08, roofThickness, upperDepth * 1.08),
    darkMetal,
    'ford-metal-roof-cap',
    new THREE.Vector3(upperX, height - roofThickness / 2, upperZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width * .18, height * .09, depth * .19),
    brickLight,
    'ford-roof-service-mass-west',
    new THREE.Vector3(-width * .24, height * .86, -depth * .16),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width * .13, height * .07, depth * .14),
    metal,
    'ford-roof-service-mass-east',
    new THREE.Vector3(width * .18, height * .875, -depth * .14),
  );

  // Four-story horizontal slots remain visible on the brick side elevations.
  // They are instanced as thin boxes rather than modeled as individual panes.
  const storyWindowHeight = Math.min(.74, Math.max(.035, height * .058));
  const sideWindowDepth = Math.min(.055, Math.max(.012, depth * .010));
  const sideWindowLength = lowerDepth * .52;
  const sideWindowGeometry = new THREE.BoxGeometry(sideWindowDepth, storyWindowHeight, sideWindowLength);
  const sideWindowPositions = [];
  for (let story = 0; story < 4; story += 1) {
    const y = height * (.18 + story * .15);
    sideWindowPositions.push({ x: lowerX - lowerWidth / 2 - sideWindowDepth / 2, y, z: lowerZ });
    sideWindowPositions.push({ x: lowerX + lowerWidth / 2 + sideWindowDepth / 2, y, z: lowerZ });
  }
  createHorizontalWindowInstances(group, sideWindowGeometry, window, sideWindowPositions, 'ford-horizontal-window-bands');
  const rearWindowGeometry = new THREE.BoxGeometry(lowerWidth * .60, storyWindowHeight, sideWindowDepth);
  const rearWindowPositions = [];
  for (let story = 0; story < 4; story += 1) {
    rearWindowPositions.push({ x: lowerX, y: height * (.18 + story * .15), z: lowerZ - lowerDepth / 2 - sideWindowDepth / 2 });
  }
  createHorizontalWindowInstances(group, rearWindowGeometry, window, rearWindowPositions, 'ford-rear-window-bands');

  // A pale base and two short wings frame the dark glazed entrance shown in
  // the model's forecourt view.
  const entryHeight = Math.min(height * .27, 3.5);
  const entryWidth = Math.min(width * .21, 6);
  const entryDepth = Math.min(depth * .085, .9);
  const entryZ = Math.min(depth * .385, depth / 2 - entryDepth / 2);
  addMesh(group, new THREE.BoxGeometry(entryWidth, entryHeight, entryDepth), entry, 'ford-glass-entry', new THREE.Vector3(0, entryHeight / 2, entryZ));
  const wingWidth = Math.min(width * .16, 4.8);
  const wingDepth = Math.min(depth * .13, 2.4);
  const wingHeight = Math.min(height * .24, 3.1);
  for (const side of [-1, 1]) {
    addMesh(
      group,
      new THREE.BoxGeometry(wingWidth, wingHeight, wingDepth),
      entryWing,
      `ford-entry-wing-${side < 0 ? 'west' : 'east'}`,
      new THREE.Vector3(side * width * .265, wingHeight / 2, entryZ - depth * .055),
    );
  }
  const canopyDepth = Math.min(depth * .15, 2.8);
  addMesh(
    group,
    new THREE.BoxGeometry(entryWidth * 1.35, Math.min(.22, height * .024), canopyDepth),
    metal,
    'ford-entry-canopy',
    new THREE.Vector3(0, entryHeight + Math.min(.10, height * .012), entryZ),
  );
  return group;
}

/** Create the tan multi-wing University Hospital with its roof helipad. */
export function createMedicalCenter(object = {}) {
  const { width, depth, height } = dimensions(object, { width: 34, depth: 25, height: 17 });
  const group = setBounds(new THREE.Group(), width, depth, height);
  group.name = 'university-medical-center';
  group.userData.facility = 'University Hospital';

  const tan = standardMaterial(object.tanColor || object.color, 0xb99578, { roughness: .9 });
  const lightTan = standardMaterial(0xd0b193, 0xd0b193, { roughness: .86 });
  const roof = standardMaterial(0x8b796e, 0x8b796e, { roughness: .84 });
  const glass = standardMaterial(0x66838a, 0x66838a, { roughness: .29, metalness: .25 });
  const helipad = standardMaterial(0x203c50, 0x203c50, { roughness: .63, metalness: .18 });
  const helipadMark = standardMaterial(0xf1df93, 0xf1df93, { roughness: .69 });

  const coreWidth = width * .49;
  const coreDepth = depth * .72;
  // The central tower carries the helipad, so its roof sits close to the
  // declared object height for surface/landmark anchoring by the renderer.
  const coreHeight = height * .98;
  const wingWidth = width * .22;
  const wingDepth = depth * .58;
  const wingHeight = height * .64;
  const wingX = coreWidth / 2 + wingWidth / 2 - width * .018;
  addMesh(group, new THREE.BoxGeometry(coreWidth, coreHeight, coreDepth), tan, 'medical-center-central-tower', new THREE.Vector3(0, coreHeight / 2, 0));
  addMesh(group, new THREE.BoxGeometry(wingWidth, wingHeight, wingDepth), lightTan, 'medical-center-east-wing', new THREE.Vector3(wingX, wingHeight / 2, depth * .065));
  addMesh(group, new THREE.BoxGeometry(wingWidth, wingHeight, wingDepth), lightTan, 'medical-center-west-wing', new THREE.Vector3(-wingX, wingHeight / 2, depth * .065));
  const rearWidth = width * .74;
  const rearDepth = depth * .17;
  const rearHeight = height * .48;
  addMesh(group, new THREE.BoxGeometry(rearWidth, rearHeight, rearDepth), tan, 'medical-center-rear-connector', new THREE.Vector3(0, rearHeight / 2, -depth * .27));
  const centralRoofThickness = Math.min(.22, height * .022);
  const centralRoofY = Math.min(coreHeight + Math.min(.11, height * .011), height - centralRoofThickness / 2);
  addMesh(group, new THREE.BoxGeometry(coreWidth * 1.04, centralRoofThickness, coreDepth * 1.04), roof, 'medical-center-central-flat-roof', new THREE.Vector3(0, centralRoofY, 0));
  addMesh(group, new THREE.BoxGeometry(wingWidth * 1.05, Math.min(.18, height * .019), wingDepth * 1.04), roof, 'medical-center-wing-flat-roofs', new THREE.Vector3(wingX, wingHeight + Math.min(.09, height * .009), depth * .065));
  addMesh(group, new THREE.BoxGeometry(wingWidth * 1.05, Math.min(.18, height * .019), wingDepth * 1.04), roof, 'medical-center-wing-flat-roof-west', new THREE.Vector3(-wingX, wingHeight + Math.min(.09, height * .009), depth * .065));

  const coreWindowDepth = Math.min(.055, Math.max(.001, depth * .01));
  const coreWindowGap = Math.min(.03, Math.max(.001, depth * .006));
  const coreWindowGeometry = new THREE.BoxGeometry(coreWidth * .76, Math.min(.17, height * .026), coreWindowDepth);
  const coreWindowPositions = [];
  for (let story = 0; story < 6; story += 1) {
    const y = height * (.17 + story * .115);
    if (y >= coreHeight - .18) continue;
    coreWindowPositions.push({ x: 0, y, z: -coreDepth / 2 - coreWindowGap });
    coreWindowPositions.push({ x: 0, y, z: coreDepth / 2 + coreWindowGap });
  }
  createHorizontalWindowInstances(group, coreWindowGeometry, glass, coreWindowPositions, 'medical-center-central-horizontal-windows');
  const wingWindowDepth = Math.min(.05, Math.max(.001, depth * .01));
  const wingWindowGap = Math.min(.028, Math.max(.001, depth * .006));
  const wingWindowGeometry = new THREE.BoxGeometry(wingWidth * .70, Math.min(.15, height * .024), wingWindowDepth);
  const wingWindowPositions = [];
  for (const x of [-wingX, wingX]) {
    for (let story = 0; story < 4; story += 1) {
      const y = height * (.16 + story * .12);
      wingWindowPositions.push({ x, y, z: depth * .065 - wingDepth / 2 - wingWindowGap });
      wingWindowPositions.push({ x, y, z: depth * .065 + wingDepth / 2 + wingWindowGap });
    }
  }
  createHorizontalWindowInstances(group, wingWindowGeometry, glass, wingWindowPositions, 'medical-center-wing-horizontal-windows');

  // A dark roof disc plus a single flat H gives the Survival Flight cue from
  // above.  Both stay on the tallest central roof and inside its footprint.
  const padRadius = Math.min(coreWidth * .31, coreDepth * .31);
  const padThickness = Math.min(.08, Math.max(.006, height * .015));
  const hLift = Math.max(.003, height * .003);
  const hOffset = padThickness / 2 + hLift;
  const requestedPadY = coreHeight + Math.min(.23, height * .012) + padThickness / 2;
  const padY = Math.max(padThickness / 2, Math.min(requestedPadY, height - hOffset));
  const pad = addMesh(group, new THREE.CylinderGeometry(padRadius, padRadius, padThickness, 20), helipad, 'medical-center-helipad', new THREE.Vector3(0, padY, 0));
  pad.userData.helipad = true;
  const hGeometry = createHGeometry(padRadius * 1.28, padRadius * .92, padRadius * .19);
  const h = addMesh(group, hGeometry, helipadMark, 'medical-center-helipad-H', new THREE.Vector3(0, padY + hOffset, 0));
  h.rotation.x = -Math.PI / 2;
  h.userData.mark = 'Survival Flight helipad H';
  return group;
}

function perpendicularBasis(direction) {
  const axis = direction.clone().normalize();
  const reference = Math.abs(axis.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(reference, axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  return { axis, u, v };
}

function addCapsule(data, start, end, radius, radialSegments = 8) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const { axis, u, v } = perpendicularBasis(direction);
  const ringSpecs = [
    { axial: -radius, radial: 0, cap: -1 },
    { axial: -radius * .707, radial: radius * .707, cap: -1 },
    { axial: 0, radial: radius, cylinder: true },
    { axial: length, radial: radius, cylinder: true },
    { axial: length + radius * .707, radial: radius * .707, cap: 1 },
    { axial: length + radius, radial: 0, cap: 1 },
  ];
  const loops = [];
  for (const spec of ringSpecs) {
    const loop = [];
    let normalAxial = 0;
    if (spec.cap) {
      normalAxial = spec.cap < 0 ? -.707 : .707;
      if (spec.radial === 0) normalAxial = spec.cap;
    }
    for (let index = 0; index < radialSegments; index += 1) {
      const theta = index / radialSegments * TAU;
      const radial = new THREE.Vector3().addScaledVector(u, Math.cos(theta) * spec.radial).addScaledVector(v, Math.sin(theta) * spec.radial);
      const position = start.clone().addScaledVector(axis, spec.axial).add(radial);
      loop.push(pushVertex(data, position));
      const normal = spec.cylinder
        ? radial.clone().normalize()
        : new THREE.Vector3().addScaledVector(axis, normalAxial).addScaledVector(radial.clone().normalize(), spec.radial ? .707 : 0).normalize();
      data.normals.push(normal.x, normal.y, normal.z);
    }
    loops.push(loop);
  }
  for (let ring = 0; ring < loops.length - 1; ring += 1) connectLoops(data, loops[ring], loops[ring + 1], radialSegments);
}

function addRidges(data, start, end, radius, ridgeCount = 6) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const { u, v } = perpendicularBasis(direction);
  const ridgeRadius = Math.max(.006, radius * .095);
  for (let ridge = 0; ridge < ridgeCount; ridge += 1) {
    const theta = ridge / ridgeCount * TAU;
    const offset = new THREE.Vector3().addScaledVector(u, Math.cos(theta) * radius * .89).addScaledVector(v, Math.sin(theta) * radius * .89);
    addCapsule(data, start.clone().add(offset), end.clone().add(offset), ridgeRadius, 5);
  }
}

/**
 * Return one merged, normalized low-poly saguaro geometry.  The trunk spans
 * y=0..1; the branch capsules and their raised rib ridges are all merged into
 * this one geometry so a feature population can use one InstancedMesh draw.
 */
export function createSaguaroGeometry() {
  const data = { positions: [], normals: [], indices: [] };
  const trunkRadius = .115;
  const trunkStart = new THREE.Vector3(0, trunkRadius, 0);
  const trunkEnd = new THREE.Vector3(0, 1 - trunkRadius, 0);
  addCapsule(data, trunkStart, trunkEnd, trunkRadius, 8);
  addRidges(data, trunkStart, trunkEnd, trunkRadius, 7);

  // Two arms bend outward first, then rise clearly above their branch joints.
  const leftHorizontalStart = new THREE.Vector3(-.025, .46, 0);
  const leftHorizontalEnd = new THREE.Vector3(-.205, .50, -.006);
  const leftVerticalEnd = new THREE.Vector3(-.205, .77, -.006);
  addCapsule(data, leftHorizontalStart, leftHorizontalEnd, .084, 7);
  addCapsule(data, leftHorizontalEnd, leftVerticalEnd, .084, 7);
  addRidges(data, leftHorizontalStart, leftHorizontalEnd, .084, 5);
  addRidges(data, leftHorizontalEnd, leftVerticalEnd, .084, 5);

  const rightHorizontalStart = new THREE.Vector3(.02, .61, .003);
  const rightHorizontalEnd = new THREE.Vector3(.205, .65, .012);
  const rightVerticalEnd = new THREE.Vector3(.205, .86, .012);
  addCapsule(data, rightHorizontalStart, rightHorizontalEnd, .078, 7);
  addCapsule(data, rightHorizontalEnd, rightVerticalEnd, .078, 7);
  addRidges(data, rightHorizontalStart, rightHorizontalEnd, .078, 5);
  addRidges(data, rightHorizontalEnd, rightVerticalEnd, .078, 5);

  const geometry = new THREE.BufferGeometry();
  geometry.name = 'saguaro-merged-lowpoly';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  // The capsule helper writes explicit normals for faceted shading.  This is
  // deliberately one merged indexed geometry, rather than child meshes.
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geometry.setIndex(data.indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = { normalized: true, trunkHeight: 1, groundY: 0, xzExtent: .35 };
  return geometry;
}
