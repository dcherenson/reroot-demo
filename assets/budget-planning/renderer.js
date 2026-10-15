import * as THREE from './vendor/three.module.js';
import { makeThickLine, updateThickLine, resizeThickLine } from './thick-lines.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { terrainHeight as worldTerrainHeight, watercourseDistance, watercourseSurface, isFeaturePoor } from './worlds.js';
import { createStadium, createFordRobotics, createMedicalCenter } from './scenery-models.js';
import { createVegetationModels } from './vegetation-models.js';
import { createLandmarkModel } from './landmark-models.js';
import { SENSOR, sensorCalibration } from './sensor-camera.js';

/*
 * The renderer deliberately knows nothing about the planner.  It consumes a
 * small world description and a stream of snapshots from app.js, which keeps
 * the visual layer useful for replaying a run or inspecting a single state.
 * Coordinates in the planner are (x, y, altitude); Three.js uses (x, up, z),
 * so the map's y axis is drawn as negative z.
 */

const TAU = Math.PI * 2;
const CAMERA_FAN_SEGMENTS = 32;
const CAMERA_FAN_SCAN_STEPS = 48;
const CAMERA_FAN_BOUNDARY_EPSILON = .05;
const CAMERA_FAN_ANGLE_EPSILON = 1e-4;
const DEFAULT_PALETTE = {
  ground: 0xb7b69a,
  accent: 0xd17a46,
  sky: 0xb9ced2,
  water: 0x6e9ca5,
  dark: 0x193145,
};

const COLORS = {
  uav: 0x64cbd0,
  ghost: 0xc4e3e0,
  tree: 0xe1ae61,
  nominal: 0x8f9995,
  committed: 0xd77c43,
  backup: 0x6d9a7c,
  safety: 0xe0483f,
  mapped: 0xf0be63,
  hidden: 0x8b9a99,
  white: 0xf4f0e5,
};

// Landmark role and knowledge state use separate accents.  The role color is
// carried by the pin/ring so a home and a goal remain distinguishable even
// after they have both been observed; the state color is carried by the
// anchored status ring and stem.
const LANDMARK_COLORS = {
  home: 0x54d7df,
  goal: 0xf08b58,
  undiscovered: 0x73838a,
  observed: 0xffc866,
  verified: 0x72e2a1,
};

const GENERATED_LABEL_FONT = 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

// Keep the renderer's imported-model parts in one small, testable contract.
// The tree has separate CC0 material groups so its trunk keeps a bark color;
// the other imported meshes use their complete normalized source geometry.
export const CC0_BATCH_PARTS = Object.freeze({
  treeBark: 'bark',
  treeFoliage: 'foliage',
  whole: 'whole',
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback = 1) {
  const number = finite(value, fallback);
  return number > 0 ? number : fallback;
}

function arrayLike(value) {
  return value && typeof value.length === 'number' ? value : [];
}

function hexColor(value, fallback) {
  if (value && value.isColor) return value.clone();
  if (typeof value === 'string' || typeof value === 'number') {
    try { return new THREE.Color(value); } catch (_error) { /* use fallback */ }
  }
  return new THREE.Color(fallback);
}

function safeId(value, fallback) {
  return value === undefined || value === null ? fallback : String(value);
}

function setOpacity(material, opacity, transparent = true) {
  if (!material) return;
  material.transparent = transparent || opacity < 1;
  material.opacity = opacity;
  material.depthWrite = opacity >= .95;
  material.needsUpdate = true;
}

const LINEAR_TO_SRGB = new Uint8Array(256);
for (let index = 0; index < LINEAR_TO_SRGB.length; index += 1) {
  const linear = index / 255;
  const encoded = linear <= .0031308
    ? linear * 12.92
    : 1.055 * Math.pow(linear, 1 / 2.4) - .055;
  LINEAR_TO_SRGB[index] = Math.round(Math.max(0, Math.min(1, encoded)) * 255);
}

export class DemoRenderer {
  constructor(canvas, onInspect = () => {}) {
    if (!canvas) throw new Error('DemoRenderer requires a canvas element');
    this.canvas = canvas;
    this.onInspect = typeof onInspect === 'function' ? onInspect : () => {};
    this.world = null;
    this.snapshot = null;
    this.knowledge = null;
    this.knowledgeView = false;
    this._disposed = false;
    this._animationFrame = 0;
    this._propellerPhase = 0;
    this._lastFrameTime = 0;
    this._lastMappedKey = '';
    this._lastVisibleKey = '';
    this._lastTime = 0;
    this._owned = new Set();
    this.viewMode = 'orbit';
    this._fpvPitch = 0;
    this._fpvTarget = new THREE.Vector3();
    this._fpvNose = new THREE.Vector3();
    this._fpvAxis = new THREE.Vector3(0, 1, 0);
    this.sensorConfig = sensorCalibration();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    this.renderer.setClearColor(DEFAULT_PALETTE.sky, 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(DEFAULT_PALETTE.sky);
    this.scene.fog = new THREE.Fog(DEFAULT_PALETTE.sky, 290, 920);
    this.camera = new THREE.PerspectiveCamera(44, 1, .1, 1800);
    this.orbitCamera = this.camera;
    this.fpvCamera = new THREE.PerspectiveCamera(44, 1, .05, 1800);
    this.camera.position.set(120, 108, 136);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .075;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 600;
    this.controls.maxPolarAngle = Math.PI * .485;
    this.controls.target.set(0, 0, 0);

    // Sensor render resources are deliberately kept outside `_owned`: a
    // world reset replaces only the scene graph and its world materials, so
    // the expensive target/readback buffers survive a reset and are disposed
    // exactly once with the renderer.
    this.sensorCamera = new THREE.PerspectiveCamera(
      this.sensorConfig.verticalFov * 180 / Math.PI,
      SENSOR.width / SENSOR.height,
      SENSOR.near,
      SENSOR.far,
    );
    this.sensorRenderTarget = new THREE.WebGLRenderTarget(SENSOR.width, SENSOR.height, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.sensorRenderTarget.texture.minFilter = THREE.NearestFilter;
    this.sensorRenderTarget.texture.magFilter = THREE.NearestFilter;
    this.sensorRenderTarget.texture.generateMipmaps = false;
    this.sensorDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide,
    });
    this._sensorBottomUpReadBuffer = new Uint8Array(SENSOR.width * SENSOR.height * 4);
    this._sensorWhiteBackground = new THREE.Color(0xffffff);

    const hemisphere = new THREE.HemisphereLight(0xeef2df, 0x38483f, 1.8);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xfff0d6, 2.25);
    key.position.set(-90, 180, 80);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8ab3bc, .8);
    fill.position.set(120, 80, -160);
    this.scene.add(fill);

    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this._createDynamicGroups();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._pointerDown = null;
    this._onPointerDown = (event) => {
      this._pointerDown = { x: event.clientX, y: event.clientY };
    };
    this._onClick = (event) => this._inspectAt(event);
    canvas.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    canvas.addEventListener('click', this._onClick, { passive: true });
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize, { passive: true });
    this.resize();
    this._animate = () => {
      if (this._disposed) return;
      this.render();
      this._animationFrame = window.requestAnimationFrame(this._animate);
    };
    if (typeof window.requestAnimationFrame === 'function') this._animationFrame = window.requestAnimationFrame(this._animate);
  }

  /** Apply the worker/UI sensor settings to every rendered sensor surface. */
  setSensorConfig(config = {}) {
    this.sensorConfig = sensorCalibration(config);
    if (this.sensorCamera) {
      this.sensorCamera.fov = this.sensorConfig.verticalFov * 180 / Math.PI;
      this.sensorCamera.near = this.sensorConfig.near;
      this.sensorCamera.far = this.sensorConfig.far;
      this.sensorCamera.updateProjectionMatrix();
    }
    return this.sensorConfig;
  }

  _createDynamicGroups() {
    this.sceneryGroup = new THREE.Group();
    this.markerGroup = new THREE.Group();
    this.zoneGroup = new THREE.Group();
    this.pathGroup = new THREE.Group();
    this.flightGroup = new THREE.Group();
    this.worldGroup.add(this.sceneryGroup, this.zoneGroup, this.markerGroup, this.pathGroup, this.flightGroup);

    this.terrain = null;
    this.terrainMaterial = null;
    this.knowledgeMask = null;
    this.featurePoints = null;
    this.featurePointGeometry = null;
    this.featureCapacity = 1000;
    this.featurePositions = null;
    this.landmarkVisuals = [];
    this.landmarkObjects = new Map();
    this.zoneVisuals = [];
    this.crowdVisuals = [];
    this.buildingLabels = [];
    this.vegetationModels = null;
    this.drone = this._createDrone(COLORS.uav, 1);
    this.ghost = this._createDrone(COLORS.ghost, .26);
    this.flightGroup.add(this.ghost, this.drone);
    this.cameraFan = this._makeFan();
    this.cameraFanSides = this._makeFanSides();
    this.cameraFanEdges = this._makeFanEdges();
    this.flightGroup.add(this.cameraFan, this.cameraFanSides, this.cameraFanEdges);

    this.paths = {
      nominal: this._makeLine('nominal', COLORS.nominal, true, 3, .9, false, 1024),
      committed: this._makeLine('committed', COLORS.committed, false, 5, 1, false, 1024),
      backup: this._makeLine('backup', COLORS.backup, false, 4.5, .98, false, 1024),
      trailActual: this._makeLine('trail-actual', COLORS.uav, false, 2.5, .85, false, 3000),
      trailEstimate: this._makeLine('trail-estimate', COLORS.mapped, true, 2.5, .8, false, 3000),
      tree: this._makeLine('tree', COLORS.tree, false, 2.5, .7, true, 256000),
    };
    Object.values(this.paths).forEach((path) => this.pathGroup.add(path.object));

    this.orbit = this._makeRing(COLORS.committed, .9);
    this.orbitCenter = this._makeMarker(COLORS.committed, .85);
    this.switchpoint = this._makeMarker(COLORS.uav, .72);
    this.pathGroup.add(this.orbit, this.orbitCenter, this.switchpoint);
    this.orbit.visible = false;
    this.orbitCenter.visible = false;
    this.switchpoint.visible = false;
  }

  _terrainHeight(x, y) {
    if (!this.world) return 0;
    if (typeof this.world.terrainHeight === 'function') {
      return finite(this.world.terrainHeight(x, y), 0);
    }
    if (typeof worldTerrainHeight === 'function') {
      return finite(worldTerrainHeight(this.world, x, y), 0);
    }
    const id = String(this.world.id || 'farm');
    if (id.includes('tucson')) {
      return Math.max(0, 1.4 * Math.sin(x / 33) + 1.1 * Math.cos(y / 27) + .8 * Math.sin((x + y) / 58));
    }
    if (id.includes('annarbor') || id.includes('stadium')) {
      return .8 * Math.sin(x / 38) * Math.cos(y / 44) + .3 * Math.sin(y / 17);
    }
    return .22 * Math.sin(x / 19) * Math.cos(y / 23);
  }

  _mapPosition(x, y, altitude = 0, terrain = true) {
    const px = finite(x);
    const py = finite(y);
    const base = terrain ? this._terrainHeight(px, py) : 0;
    const offsetX = positive(this.world?.width, 220) / 2;
    const offsetY = positive(this.world?.height, 180) / 2;
    return new THREE.Vector3(px - offsetX, base + finite(altitude), -(py - offsetY));
  }

  _flightAltitude() {
    return finite(this.world?.altitude, 35);
  }

  _makeMaterial(material) {
    const result = material;
    this._owned.add(result);
    return result;
  }

  _makeMesh(geometry, material) {
    this._owned.add(geometry);
    if (material) this._owned.add(material);
    return new THREE.Mesh(geometry, material);
  }

  _registerObjectResources(object) {
    if (!object || typeof object.traverse !== 'function') return object;
    object.traverse((child) => {
      if (child.geometry) this._owned.add(child.geometry);
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (!material) return;
          this._owned.add(material);
          Object.values(material).forEach((value) => {
            if (value?.isTexture) this._owned.add(value);
          });
        });
      }
    });
    return object;
  }

  _clearObject(object) {
    if (!object) return;
    object.traverse((child) => {
      // InstancedMesh owns GPU instance attributes in addition to geometry.
      if (child.isInstancedMesh) this._owned.add(child);
      if (child.geometry) this._owned.add(child.geometry);
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          this._owned.add(material);
          Object.values(material).forEach(value => { if (value?.isTexture) this._owned.add(value); });
        });
      }
    });
    if (object.parent) object.parent.remove(object);
  }

  _disposeOwned() {
    this._owned.forEach((resource) => {
      if (resource && typeof resource.dispose === 'function') resource.dispose();
    });
    this._owned.clear();
  }

  _replaceWorldGroup() {
    this._clearObject(this.worldGroup);
    this._disposeOwned();
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this._createDynamicGroups();
  }

  setWorld(world) {
    if (this._disposed) return;
    this.snapshot = null;
    this.knowledge = null;
    this.displayCameraYaw=null;
    this.world = world || { id: 'farm', width: 220, height: 180, palette: DEFAULT_PALETTE, features: [], landmarks: [], zones: [], objects: [], mountains: [] };
    this._replaceWorldGroup();
    const palette = { ...DEFAULT_PALETTE, ...(this.world.palette || {}) };
    const sky = hexColor(palette.sky, DEFAULT_PALETTE.sky);
    this.scene.background = sky;
    if (this.scene.fog) this.scene.fog.color.copy(sky);
    this.renderer.setClearColor(sky, 1);

    this._buildTerrain(palette);
    this._buildScenery(palette);
    this._buildKnowledgeFog();
    this._buildFeatures();
    this._buildLandmarks(palette);
    this._buildZones();
    this._updateKnowledgeVisibility();
    this.resetView();
  }

  _buildTerrain(palette) {
    const width = positive(this.world.width, 220);
    const height = positive(this.world.height, 180);
    // The simulation's knowledge raster uses a 2 m cell.  Matching that
    // resolution keeps the visible surface and the mask on the same grid,
    // while the authoritative terrain function still supplies every vertex.
    const geometry = new THREE.PlaneGeometry(width, height, Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      // PlaneGeometry starts in XY and is rotated around X below.  Its local
      // y becomes the negative Three.js z coordinate, which is the planner's
      // positive simulation y axis after _mapPosition().
      positions.setZ(index, this._terrainHeight(x + width / 2, y + height / 2));
    }
    // The height samples above remain authoritative for simulation and LOS.
    // Only the vertex color field is embellished here: broad color bands,
    // slope shading, and a low-amplitude biome grain give the fixed terrain a
    // finished surface without adding synthetic feature points to sensing.
    const colors = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index) + width / 2;
      const y = positions.getY(index) + height / 2;
      const h = positions.getZ(index);
      const sample = 1.7;
      const slopeX = (this._terrainHeight(x + sample, y) - this._terrainHeight(x - sample, y)) / (sample * 2);
      const slopeY = (this._terrainHeight(x, y + sample) - this._terrainHeight(x, y - sample)) / (sample * 2);
      const slope = Math.min(1, Math.hypot(slopeX, slopeY) * 2.4);
      const grain = Math.sin(x * .071 + y * .037) * .5 + Math.sin(x * .019 - y * .083) * .25;
      const poor = isFeaturePoor(this.world, x, y);
      let color;
      if (this.world.id === 'farm') {
        if (poor) {
          // Feature-poor field interiors stay calm so the vegetation boundary
          // remains readable from the air.
          color = new THREE.Color('#a9aa72').lerp(new THREE.Color('#c3b178'), grain * .08 + .47);
        } else {
          const crop = ((Math.floor(x / 48) * 3 + Math.floor(y / 42)) % 4 + 4) % 4;
          const crops = ['#718c54', '#8fa15c', '#b2a267', '#6d8650'];
          color = new THREE.Color(crops[crop]).lerp(new THREE.Color('#d0b875'), grain * .12 + .34);
        }
      } else if (this.world.id === 'tucson') {
        const basin = h > 20 ? new THREE.Color('#8d694f') : new THREE.Color('#bd956b');
        const wash = new THREE.Color('#d0a878');
        color = basin.lerp(wash, Math.max(0, grain * .16 + .08));
      } else {
        const lawn = new THREE.Color('#6f8f68');
        const woodland = new THREE.Color('#4f7358');
        const riverDistance = watercourseDistance(this.world, x, y);
        if (riverDistance < (this.world.river?.width || 0) / 2 + 3) color = new THREE.Color('#9ca879');
        else if (riverDistance < (this.world.river?.width || 0) / 2 + 9) color = new THREE.Color('#4e7859');
        else color = lawn.lerp(woodland, poor ? .08 : .34 + Math.max(0, grain) * .12);
      }
      // Exposed slopes catch more light in the stylized scene; the small grain
      // is kept below the threshold that would resemble extra image features.
      color.multiplyScalar(Math.max(.72, Math.min(1.08, 1.02 - slope * .17 + grain * .025)));
      colors.set([color.r, color.g, color.b], index * 3);
    }
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    this.terrainBaseColor = hexColor(palette.ground, DEFAULT_PALETTE.ground);
    this.terrainMaterial = this._makeMaterial(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: .97,
      metalness: 0,
      flatShading: false,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    }));
    this.terrain = this._makeMesh(geometry, this.terrainMaterial);
    this.terrain.name = 'terrain';
    this.sceneryGroup.add(this.terrain);

    const borderPoints = [
      this._mapPosition(0, 0, .09),
      this._mapPosition(width, 0, .09),
      this._mapPosition(width, height, .09),
      this._mapPosition(0, height, .09),
    ];
    const borderGeometry = new THREE.BufferGeometry().setFromPoints(borderPoints);
    borderGeometry.setDrawRange(0, borderPoints.length);
    borderGeometry.attributes.position.needsUpdate = true;
    borderGeometry.computeBoundingSphere();
    this._owned.add(borderGeometry);
    const border = new THREE.LineLoop(borderGeometry, this._makeMaterial(new THREE.LineBasicMaterial({ color: hexColor(palette.accent, COLORS.committed), transparent: true, opacity: .27 })));
    border.name = 'planning-border';
    this.worldBorder = border;
    this.sceneryGroup.add(border);

    // A subtle low-opacity grid gives the flat planning abstraction a visual
    // reference without replacing the 3D terrain or physical scene objects.
    const grid = new THREE.GridHelper(Math.max(width, height), Math.round(Math.max(width, height) / 20), 0x718785, 0x718785);
    grid.name = 'planning-grid';
    this.planningGrid = grid;
    grid.position.y = .17;
    (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((material) => {
      material.transparent = true;
      material.opacity = .11;
      material.depthWrite = false;
    });
    this._owned.add(grid.geometry);
    (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((material) => this._owned.add(material));
    this.sceneryGroup.add(grid);

  }

  _buildKnowledgeFog() {
    const columns = Math.ceil(this.world.width / 2), rows = Math.ceil(this.world.height / 2);
    const texture = new THREE.DataTexture(new Uint8Array(columns * rows), columns, rows, THREE.RedFormat);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    this._owned.add(texture);
    this.knowledgeFog = {
      texture,
      enabled: { value: this.knowledgeView ? 1 : 0 },
      size: { value: new THREE.Vector2(this.world.width, this.world.height) },
      color: { value: new THREE.Color('#415b6b') },
    };
    const visited = new Set();
    this.sceneryGroup.traverse(object => {
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material || visited.has(material)) continue;
        visited.add(material);
        const isTerrain = object === this.terrain;
        material.onBeforeCompile = shader => {
          Object.assign(shader.uniforms, {
            surveyMap: { value: texture }, surveyEnabled: this.knowledgeFog.enabled,
            surveySize: this.knowledgeFog.size, surveyFogColor: this.knowledgeFog.color,
          });
          shader.vertexShader = 'varying vec2 vSurveyUv;\nuniform vec2 surveySize;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
            vec4 surveyPosition = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              surveyPosition = instanceMatrix * surveyPosition;
            #endif
            surveyPosition = modelMatrix * surveyPosition;
            vSurveyUv = vec2(surveyPosition.x / surveySize.x + .5, .5 - surveyPosition.z / surveySize.y);
            #include <project_vertex>
          `);
          shader.fragmentShader = 'varying vec2 vSurveyUv;\nuniform sampler2D surveyMap;\nuniform float surveyEnabled;\nuniform vec3 surveyFogColor;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
            #include <clipping_planes_fragment>
            float unexplored = surveyEnabled * (1.0 - step(.5, texture2D(surveyMap, vSurveyUv).r));
            ${isTerrain ? '' : 'if (unexplored > .5) discard;'}
          `);
          if (isTerrain) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
            outgoingLight = mix(outgoingLight, surveyFogColor, unexplored);
            #include <opaque_fragment>
          `);
        };
        material.customProgramCacheKey = () => `survey-fog-${isTerrain ? 'terrain' : 'scenery'}`;
        material.needsUpdate = true;
      }
    });
  }

  _buildScenery(palette) {
    this._buildWatercourses();
    const objects = arrayLike(this.world.objects);
    objects.forEach((object) => this._addWorldObject(object, palette));

    // Worlds supplied by a caller may contain only planning entities.  Add a
    // light procedural signature so the environments stay recognizable even
    // in that minimal form.
    const id = String(this.world.id || '').toLowerCase();
    if (id.includes('farm') && !objects.some((item) => String(item.kind).includes('field'))) {
      this._addField({ x: 58, y: 48, width: 66, depth: 38, color: 0x9eaf7c }, palette);
      this._addField({ x: 166, y: 48, width: 52, depth: 30, color: 0xb6a467 }, palette);
      this._addField({ x: 228, y: 172, width: 54, depth: 30, color: 0xb7a26b }, palette);
      this._addField({ x: 67, y: 183, width: 44, depth: 27, color: 0x8fa66f }, palette);
      [[30, 28, 82, 28], [141, 33, 191, 33], [207, 157, 259, 157], [46, 198, 88, 198]].forEach(([x1, y1, x2, y2]) => {
        const steps = Math.max(3, Math.floor(Math.hypot(x2 - x1, y2 - y1) / 8));
        for (let index = 0; index <= steps; index += 1) this._addTree({ x: x1 + (x2 - x1) * index / steps, y: y1 + (y2 - y1) * index / steps, height: 5.4 + (index % 3) * .7 }, palette);
      });
    }
    if ((id.includes('annarbor') || id.includes('ann-arbor') || id.includes('stadium')) && !objects.some((item) => String(item.kind).includes('stadium'))) {
      this._addStadium({ x: 160, y: 115, width: 106, depth: 68 }, palette);
    }
    if (id.includes('annarbor') || id.includes('ann-arbor')) {
      const hasRoads = objects.filter((item) => String(item.kind).includes('road')).length;
      if (hasRoads < 6) {
        [[65, 115, 7, 215, 0], [245, 115, 7, 215, 0], [160, 57, 7, 280, Math.PI / 2], [160, 174, 7, 280, Math.PI / 2], [106, 115, 5, 170, .46]].forEach(([x, y, width, depth, rotation]) => this._addRoad({ x, y, width, depth, rotation, color: 0x607a71 }, palette));
      }
    }
    this._buildNaturalFeatures();
  }

  _objectBase(object) {
    const x = finite(object && object.x);
    const y = finite(object && object.y);
    // worlds.js stores z as the absolute surface elevation.  _mapPosition
    // already adds the sampled terrain, so the base of a scene object is at
    // altitude zero relative to that surface.
    return this._mapPosition(x, y, 0);
  }

  _addWorldObject(object = {}, palette) {
    const kind = String(object.kind || object.type || 'building').toLowerCase();
    const style = String(object.style || '').toLowerCase();
    let visual = null;

    // Landmark-owned objects get their authored hero model before the generic
    // kind dispatch.  A factory returning null deliberately falls through so
    // a caller can add a landmarkId to an ordinary building without making
    // the renderer depend on a style-specific model.
    if (object.landmarkId || style.startsWith('landmark-')) {
      const landmarkModel = createLandmarkModel(object);
      if (landmarkModel) visual = this._placeModel(landmarkModel, object);
    }
    if (!visual && object.style === 'ford-robotics') visual = this._placeModel(createFordRobotics(object), object);
    if (!visual && object.style === 'medical-center' && kind === 'building') visual = this._placeModel(createMedicalCenter(object), object);
    if (!visual && (kind.includes('mountain') || kind.includes('ridge'))) visual = this._addMountain(object, palette);
    if (!visual && (kind.includes('saguaro') || kind.includes('cactus'))) visual = this._addSaguaro(object, palette);
    if (!visual && (kind.includes('stadium') || kind.includes('bowl'))) visual = this._addStadium(object, palette);
    if (!visual && kind.includes('crowd')) visual = this._addCrowd(object);
    if (!visual && (kind.includes('road') || kind.includes('street'))) visual = this._addRoad(object, palette);
    if (!visual && (kind.includes('field') || kind.includes('crop') || kind.includes('runway'))) visual = this._addField(object, palette);
    if (!visual && (kind.includes('barn') || kind.includes('hangar'))) visual = this._addBarn(object, palette);
    if (!visual && (kind.includes('tree') || kind.includes('forest'))) visual = this._addTree(object, palette);
    if (!visual && (kind.includes('building') || kind.includes('house') || kind.includes('home'))) {
      visual = this.world.id === 'farm' ? this._addBarn(object, palette) : this._addBuilding(object, palette);
    }
    if (!visual && kind === 'tower' && this.world.id === 'farm') {
      const h = positive(object.height, 20);
      const r = Math.min(positive(object.width, 5), positive(object.depth, 5)) / 2;
      const mesh = this._makeMesh(new THREE.CylinderGeometry(r, r, h, 16), this._makeMaterial(new THREE.MeshStandardMaterial({ color: 0xc3c4b0, roughness: .6 })));
      mesh.position.copy(this._objectBase(object));
      mesh.position.y += h / 2;
      this.sceneryGroup.add(mesh);
      visual = mesh;
    }
    if (!visual) {
      const width = positive(object.width, kind.includes('wall') ? 16 : 8);
      const depth = positive(object.depth, kind.includes('wall') ? 1.2 : width * .72);
      const height = positive(object.height, kind.includes('wall') ? 3 : 3.5);
      const material = this._makeMaterial(new THREE.MeshStandardMaterial({ color: hexColor(object.color, palette.accent), roughness: .88, metalness: .02 }));
      const mesh = this._makeMesh(new THREE.BoxGeometry(width, height, depth), material);
      const base = this._objectBase(object);
      mesh.position.set(base.x, base.y + height / 2, base.z);
      mesh.rotation.y = finite(object.rotation);
      this.sceneryGroup.add(mesh);
      visual = mesh;
    }

    if (visual && object.landmarkId) {
      const landmarkId = safeId(object.landmarkId, object.id || 'landmark');
      visual.userData = { ...visual.userData, landmarkId };
      const entry = { object, group: visual };
      this.landmarkObjects.set(landmarkId, entry);
      if (object.id !== undefined && object.id !== null) this.landmarkObjects.set(safeId(object.id), entry);
    }
    return visual;
  }

  _makeLabelBadge(text, accent = LANDMARK_COLORS.observed, options = {}) {
    const label = String(text || 'Landmark');
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 152;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this._owned.add(texture);
    const material = this._makeMaterial(new THREE.SpriteMaterial({
      map: texture,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    }));
    const sprite = new THREE.Sprite(material);
    // Keep the badge legible at every orbit distance while retaining the
    // canvas aspect ratio (1024:152).  Landmark badges use two lines so the
    // role and current knowledge state are visible without relying on color.
    sprite.scale.set(.23, .0342, 1);
    sprite.renderOrder = 20;
    sprite.userData.badge = { canvas, context, texture, label, stateKey: null };
    this._updateLabelBadge(sprite, options.role, options.status, accent, true);
    return sprite;
  }

  _updateLabelBadge(sprite, role = '', status = '', accent = LANDMARK_COLORS.observed, force = false) {
    const badge = sprite?.userData?.badge;
    if (!badge) return;
    const nextRole = String(role || '').toUpperCase();
    const nextStatus = String(status || '').toUpperCase().replace(/-/g, ' ');
    const color = accent?.isColor ? accent : null;
    const colorHex = color
      ? color.getHexString()
      : typeof accent === 'number'
        ? Math.max(0, Math.trunc(accent) >>> 0).toString(16).slice(-6).padStart(6, '0')
        : new THREE.Color(accent).getHexString();
    const stateKey = `${nextRole}|${nextStatus}|${colorHex}|${badge.label}`;
    if (!force && badge.stateKey === stateKey) return;
    const { canvas, context } = badge;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#132f3beF';
    context.beginPath();
    if (typeof context.roundRect === 'function') context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 18);
    else context.rect(2, 2, canvas.width - 4, canvas.height - 4);
    context.fill();
    context.strokeStyle = `#${colorHex}`;
    context.lineWidth = 6;
    context.stroke();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const hasStatusLine = Boolean(nextRole || nextStatus);
    const labelY = hasStatusLine ? 101 : 77;
    let fontSize = hasStatusLine ? 43 : 44;
    context.font = `700 ${fontSize}px ${GENERATED_LABEL_FONT}`;
    const maxLabelWidth = 900;
    const measured = context.measureText(badge.label).width;
    if (measured > maxLabelWidth) fontSize = Math.max(25, Math.floor(fontSize * maxLabelWidth / measured));
    context.font = `700 ${fontSize}px ${GENERATED_LABEL_FONT}`;
    context.fillStyle = '#f7f2e7';
    context.fillText(badge.label, canvas.width / 2, labelY);
    if (hasStatusLine) {
      context.font = `800 24px ${GENERATED_LABEL_FONT}`;
      context.fillStyle = '#b8d5d4';
      const caption = [nextRole, nextStatus].filter(Boolean).join('  ·  ');
      context.fillText(caption, canvas.width / 2, 43);
    }
    badge.stateKey = stateKey;
    badge.texture.needsUpdate = true;
  }

  _placeModel(group, object) {
    if (!group) return null;
    this._registerObjectResources(group);
    group.position.copy(this._objectBase(object));
    group.rotation.y = finite(object.rotation);
    group.userData = { ...group.userData, type: 'building', title: object.label || group.name,
      description: object.description || group.userData.description || 'Procedural interpretation of a campus landmark in compressed geography.' };
    this.sceneryGroup.add(group);
    // Landmark-owned objects receive their shared role/state badge from
    // _buildLandmarks.  Retain the established facility badges for ordinary
    // campus models and any other non-landmark model group.
    if (object.landmarkId) return group;
    const label = object.style === 'medical-center' ? 'Michigan Medicine · helipad'
      : object.style === 'ford-robotics' ? 'Ford Robotics Building' : 'Michigan Stadium';
    const sprite = this._makeLabelBadge(label, LANDMARK_COLORS.observed);
    sprite.position.copy(group.position);
    sprite.position.y += (object.kind === 'stadium' ? 7 : positive(object.height, 7)) + 5;
    sprite.scale.set(.20, .0296, 1);
    sprite.renderOrder = 11;
    sprite.userData = { ...group.userData, badge: sprite.userData.badge };
    this.markerGroup.add(sprite);this.buildingLabels.push({sprite,object});
    return group;
  }

  _buildWatercourses() {
    for (const course of this.world.watercourses || []) {
      const points = course.centerline, vertices = [];
      for (let i=1;i<points.length;i++) {
        const a=points[i-1], b=points[i], dx=b.x-a.x, dy=b.y-a.y;
        const length=Math.hypot(dx,dy), nx=-dy/length, ny=dx/length;
        const count=Math.max(1,Math.ceil(length/2));
        for (let j=0;j<count;j++) {
          const corners=[];
          for (const [t, side] of [[j/count,-1],[j/count,1],[(j+1)/count,-1],[(j+1)/count,1]]) {
            const x=a.x+dx*t+nx*course.width/2*side, y=a.y+dy*t+ny*course.width/2*side;
            corners.push(this._mapPosition(x,y,watercourseSurface(this.world,x,y,course)+.045,false));
          }
          for (const k of [0,1,2,2,1,3]) vertices.push(corners[k].x,corners[k].y,corners[k].z);
        }
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      geometry.computeVertexNormals();
      const material=this._makeMaterial(new THREE.MeshStandardMaterial({color:course.color||'#4f9bb0',roughness:.28,metalness:.18,side:THREE.DoubleSide}));
      const water=this._makeMesh(geometry,material);water.name=course.id;
      water.userData={type:'watercourse',title:course.label,description:'The Huron River and its gentle wooded valley, compressed to fit this procedural world.'};
      this.sceneryGroup.add(water);
    }
  }

  _addField(object = {}, palette) {
    const width = positive(object.width, 40);
    const depth = positive(object.depth, 25);
    const color = hexColor(object.color, 0x9eae78);
    const material = this._makeMaterial(new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    const rotation = finite(object.rotation);
    const cos = Math.cos(rotation); const sin = Math.sin(rotation);
    const centerX = finite(object.x); const centerY = finite(object.y);
    const centerHeight = this._terrainHeight(centerX, centerY);
    // A broad flat box cuts through the low-amplitude terrain and produces
    // mottled z-fighting in the sensor.  Subdivide a surface plane and drape
    // it over the authoritative terrain, leaving a small physical lift.
    const fieldGeometry = new THREE.PlaneGeometry(width, depth,
      Math.max(1, Math.ceil(width / 4)), Math.max(1, Math.ceil(depth / 4)));
    fieldGeometry.rotateX(-Math.PI / 2);
    const fieldPositions = fieldGeometry.attributes.position;
    for (let index = 0; index < fieldPositions.count; index += 1) {
      const localX = fieldPositions.getX(index); const localZ = fieldPositions.getZ(index);
      const simX = centerX + localX * cos + localZ * sin;
      const simY = centerY + localX * sin - localZ * cos;
      const relativeHeight = this._terrainHeight(simX, simY) - centerHeight;
      fieldPositions.setY(index, relativeHeight + .055);
    }
    fieldPositions.needsUpdate = true;
    fieldGeometry.computeVertexNormals();
    const field = this._makeMesh(fieldGeometry, material);
    const base = this._objectBase(object);
    field.position.set(base.x, base.y, base.z);
    field.rotation.y = rotation;
    this.sceneryGroup.add(field);

    const stripeMaterial = this._makeMaterial(new THREE.MeshBasicMaterial({ color: hexColor(palette.accent, COLORS.committed), transparent: true, opacity: .24 }));
    const stripeCount = Math.max(3, Math.floor(width / 10));
    for (let index = 1; index < stripeCount; index += 1) {
      const localStripeX = -width / 2 + (width * index / stripeCount);
      const stripeX = centerX + localStripeX * cos;
      const stripeY = centerY + localStripeX * sin;
      // Stripes are useful at rich field edges but read as a uniform sensor
      // checker in authored poor cores.  Keep the physical field surface and
      // suppress only the mathematical striping where the world says it is a
      // clearing.
      if (isFeaturePoor(this.world, stripeX, stripeY)) continue;
      const stripeGeometry = new THREE.PlaneGeometry(.23, depth * .92, 1, Math.max(1, Math.ceil(depth / 4)));
      stripeGeometry.rotateX(-Math.PI / 2);
      const stripePositions = stripeGeometry.attributes.position;
      for (let vertex = 0; vertex < stripePositions.count; vertex += 1) {
        const localX = stripePositions.getX(vertex); const localZ = stripePositions.getZ(vertex);
        const simX = centerX + (localStripeX + localX) * cos + localZ * sin;
        const simY = centerY + (localStripeX + localX) * sin - localZ * cos;
        const relativeHeight = this._terrainHeight(simX, simY) - centerHeight;
        stripePositions.setY(vertex, relativeHeight + .095);
      }
      stripePositions.needsUpdate = true;
      stripeGeometry.computeVertexNormals();
      const stripe = this._makeMesh(stripeGeometry, stripeMaterial);
      stripe.position.set(base.x + localStripeX * cos, base.y, base.z - localStripeX * sin);
      stripe.rotation.y = rotation;
      this.sceneryGroup.add(stripe);
    }
    return field;
  }

  _addRoad(object = {}, palette) {
    const width = positive(object.width, 7);
    const depth = positive(object.depth, 80);
    const rotation = finite(object.rotation);
    const segmentCount = Math.max(8, Math.min(48, Math.ceil(depth / 6)));
    const geometry = new THREE.BoxGeometry(width, .18, depth, 1, 1, segmentCount);
    const positions = geometry.attributes.position;
    const centerHeight = this._terrainHeight(finite(object.x), finite(object.y));
    const cos = Math.cos(rotation); const sin = Math.sin(rotation);
    for (let index = 0; index < positions.count; index += 1) {
      const localX = positions.getX(index); const localZ = positions.getZ(index);
      // Roads use the same local-to-world rotation as _mapPosition: local +z
      // points toward negative simulation y, and the group turns by +rotation
      // so world and planner rectangles share the same orientation.
      const simX = finite(object.x) + localX * cos + localZ * sin;
      const simY = finite(object.y) + localX * sin - localZ * cos;
      const h = this._terrainHeight(simX, simY) - centerHeight;
      positions.setY(index, h + (positions.getY(index) < 0 ? .01 : .16));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    const color = object.color || (String(this.world?.id).includes('tucson') ? 0x96694d : String(this.world?.id).includes('ann-arbor') ? 0x667d73 : 0xb2a06d);
    const material = this._makeMaterial(new THREE.MeshStandardMaterial({ color: hexColor(color, 0x9f8e68), roughness: 1, metalness: 0 }));
    const road = this._makeMesh(geometry, material);
    const base = this._objectBase(object);
    road.position.set(base.x, base.y, base.z);
    road.rotation.y = rotation;
    this.sceneryGroup.add(road);
    return road;
  }

  _addBarn(object = {}, palette) {
    const width = positive(object.width, 12);
    const depth = positive(object.depth, 9);
    const height = positive(object.height, 7);
    const base = this._objectBase(object);
    const group = new THREE.Group();
    const bodyMaterial = this._makeMaterial(new THREE.MeshStandardMaterial({ color: hexColor(object.color, 0x9b5841), roughness: .84 }));
    const body = this._makeMesh(new THREE.BoxGeometry(width, height*.72, depth), bodyMaterial);
    body.position.y = height*.36;
    group.add(body);
    const roofMaterial = this._makeMaterial(new THREE.MeshStandardMaterial({ color: 0x4a4140, roughness: .9 }));
    const roofGeometry=new THREE.ConeGeometry(Math.SQRT1_2,1,4);roofGeometry.rotateY(Math.PI/4);
    const roof=this._makeMesh(roofGeometry,roofMaterial);
    roof.scale.set(width,height*.28,depth);
    roof.position.y=height*.86;
    group.add(roof);
    const doorMaterial = this._makeMaterial(new THREE.MeshStandardMaterial({ color: 0x3e4d4d, roughness: 1 }));
    const door = this._makeMesh(new THREE.BoxGeometry(width * .27, height * .55, .08), doorMaterial);
    door.position.set(0, height * .28, depth / 2 + .05);
    group.add(door);
    group.position.set(base.x, base.y, base.z);
    group.rotation.y = finite(object.rotation);
    this.sceneryGroup.add(group);
    return group;
  }

  _addBuilding(object = {}, palette) {
    const width = positive(object.width, 10);
    const depth = positive(object.depth, 8);
    const height = positive(object.height, 6);
    const base = this._objectBase(object);
    const group = new THREE.Group();
    const bodyMaterial = this._makeMaterial(new THREE.MeshStandardMaterial({ color: hexColor(object.color, 0x9a765d), roughness: .9 }));
    const body = this._makeMesh(new THREE.BoxGeometry(width, height*.72, depth), bodyMaterial);
    body.position.y = height*.36;
    group.add(body);
    const roofMaterial = this._makeMaterial(new THREE.MeshStandardMaterial({ color: 0x5c5550, roughness: .92, flatShading: true }));
    const roofGeometry=new THREE.ConeGeometry(Math.SQRT1_2,1,4);roofGeometry.rotateY(Math.PI/4);
    const roof=this._makeMesh(roofGeometry,roofMaterial);
    roof.scale.set(width,height*.28,depth);
    roof.position.y=height*.86;
    group.add(roof);
    const doorMaterial = this._makeMaterial(new THREE.MeshStandardMaterial({ color: 0x3f5050, roughness: 1 }));
    const door = this._makeMesh(new THREE.BoxGeometry(Math.min(width * .24, 2.2), height * .52, .08), doorMaterial);
    door.position.set(0, height * .26, depth / 2 + .05);
    group.add(door);
    group.position.set(base.x, base.y, base.z);
    group.rotation.y = finite(object.rotation);
    this.sceneryGroup.add(group);
    return group;
  }

  _ensureVegetationModels() {
    if (this.vegetationModels) return this.vegetationModels;
    this.vegetationModels = createVegetationModels();
    const register = (value) => {
      if (!value) return;
      if (value.isBufferGeometry) this._owned.add(value);
      else if (typeof value === 'object') Object.values(value).forEach(register);
    };
    register(this.vegetationModels);
    return this.vegetationModels;
  }

  _vegetationMaterial(color, options = {}) {
    return this._makeMaterial(new THREE.MeshStandardMaterial({
      color: hexColor(color, 0x5d7655),
      roughness: options.roughness == null ? .94 : options.roughness,
      metalness: options.metalness == null ? 0 : options.metalness,
      flatShading: options.flatShading == null ? true : options.flatShading,
      side: options.side === undefined ? THREE.FrontSide : options.side,
    }));
  }

  _addTree(object = {}, palette) {
    const height = positive(object.height, 7);
    const base = this._objectBase(object);
    const models = this._ensureVegetationModels().tree;
    const group = new THREE.Group();
    const trunk = this._makeMesh(models.trunk, this._vegetationMaterial(0x624936));
    const canopy = this._makeMesh(models.canopy, this._vegetationMaterial(object.color, { roughness: .98 }));
    const highlight = this._makeMesh(models.highlight, this._vegetationMaterial(0x78945b, { roughness: .98 }));
    trunk.name = 'tree-trunk'; canopy.name = 'tree-canopy'; highlight.name = 'tree-canopy-highlights';
    group.add(trunk, canopy, highlight);
    const width = positive(object.width, height * .70);
    const depth = positive(object.depth, height * .62);
    group.position.set(base.x, base.y, base.z);
    group.rotation.y = finite(object.rotation);
    group.scale.set(width / .96, height / 1.04, depth / .90);
    group.userData = { vegetation: 'tree', bounds: { width, depth, height } };
    this.sceneryGroup.add(group);
    return group;
  }

  _addSaguaro(object = {}, palette) {
    const height = positive(object.height, 6);
    const base = this._objectBase(object);
    const models = this._ensureVegetationModels().saguaro;
    const group = new THREE.Group();
    const body = this._makeMesh(models.body, this._vegetationMaterial(object.color, { roughness: .99 }));
    const ridges = this._makeMesh(models.ridges, this._vegetationMaterial(0x245c43, { roughness: .99 }));
    const flowers = this._makeMesh(models.flowers, this._vegetationMaterial(0xe58e62, { roughness: .87 }));
    body.name = 'saguaro-body'; ridges.name = 'saguaro-ridges'; flowers.name = 'saguaro-blossoms';
    group.add(body, ridges, flowers);
    const width = positive(object.width, height * .42);
    const depth = positive(object.depth, height * .38);
    group.position.set(base.x, base.y, base.z);
    group.rotation.y = finite(object.rotation);
    group.scale.set(width / .60, height, depth / .54);
    group.userData = { vegetation: 'saguaro', bounds: { width, depth, height } };
    this.sceneryGroup.add(group);
    return group;
  }

  _addMountain(object = {}, palette) {
    const radius = positive(object.radius || object.width || object.rx, 28);
    const height = positive(object.height, 35);
    const base = this._objectBase(object);
    const material = this._makeMaterial(new THREE.MeshStandardMaterial({ color: hexColor(object.color, 0x697b78), roughness: 1, flatShading: true }));
    const mountain = this._makeMesh(new THREE.ConeGeometry(radius, height, 7, 2), material);
    // terrainHeight already contains the smooth ridge contribution.  Sink the
    // low-poly cap into that ridge so it reads as a rugged mountain mass
    // instead of a cone hovering above the collision surface.
    mountain.position.set(base.x, base.y - height * .3, base.z);
    mountain.rotation.y = finite(object.rotation);
    this.sceneryGroup.add(mountain);
    return mountain;
  }

  _addStadium(object = {}) {
    return this._placeModel(createStadium(object), object);
  }

  _addCrowd(object = {}) {
    const width = positive(object.width, 100);
    const depth = positive(object.depth, 62);
    const base = this._objectBase(object);
    const count = Math.max(120, Math.min(720, Math.floor((width + depth) * 3.1)));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [new THREE.Color(0xd5a558), new THREE.Color(0x5c7581), new THREE.Color(0x9f5d4a), new THREE.Color(0xe5e0c8), new THREE.Color(0x3c596e)];
    for (let index = 0; index < count; index += 1) {
      let x; let z;
      if (object.ellipse) {
        const theta = (index / count) * TAU;
        x = Math.cos(theta) * width * .49;
        z = Math.sin(theta) * depth * .49;
      } else {
        const perimeter = (index / count) * 4;
        if (perimeter < 1) { x = -width * .48 + perimeter * width * .96; z = -depth * .45; }
        else if (perimeter < 2) { x = width * .48; z = -depth * .45 + (perimeter - 1) * depth * .9; }
        else if (perimeter < 3) { x = width * .48 - (perimeter - 2) * width * .96; z = depth * .45; }
        else { x = -width * .48; z = depth * .45 - (perimeter - 3) * depth * .9; }
      }
      positions[index * 3] = x + Math.sin(index * 17.3) * 1.4;
      positions[index * 3 + 1] = 3.9 + (index % 5) * .55;
      positions[index * 3 + 2] = z + Math.cos(index * 11.1) * 1.4;
      const color = palette[index % palette.length];
      colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._owned.add(geometry);
    const material = this._makeMaterial(new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: .9 }));
    const points = new THREE.Points(geometry, material);
    points.position.set(base.x, base.y, base.z);
    points.rotation.y = finite(object.rotation);
    points.userData = { crowd: true, zoneId: object.zoneId || null };
    this.sceneryGroup.add(points);
    this.crowdVisuals.push(points);
    return points;
  }

  _buildNaturalFeatures() {
    const features = arrayLike(this.world.features);
    if (!features.length) return;
    const models = this._ensureVegetationModels();
    // Ann Arbor's broad south lawn is intentionally feature-poor.  Restore
    // the readable campus silhouette dimensions used by the earlier authored
    // trees so the rich edge still reads across that clearing without adding
    // objects to the sparse zone.
    const annArborTreeDimensions = this.world.id === 'ann-arbor'
      ? { width: 3.2, height: 4.8 }
      : { width: 2.05, height: 2.8 };
    const batches = [
      {
        modelKey: 'cc0Tree',
        matches: (kind) => kind.includes('tree'),
        parts: [
          { key: CC0_BATCH_PARTS.treeBark, name: 'feature-tree-trunks', color: 0x624936 },
          { key: CC0_BATCH_PARTS.treeFoliage, name: 'feature-trees', color: this.world.id === 'ann-arbor' ? 0x4f7853 : 0x587b48 },
        ],
        scale: (feature) => { const size = finite(feature.size, 1.1); return [size * annArborTreeDimensions.width, size * annArborTreeDimensions.height, size * annArborTreeDimensions.width]; },
        lift: .015,
      },
      {
        modelKey: 'cc0Tree',
        matches: (kind) => kind.includes('maple'),
        parts: [
          { key: CC0_BATCH_PARTS.treeBark, name: 'feature-maple-trunks', color: 0x624936 },
          { key: CC0_BATCH_PARTS.treeFoliage, name: 'feature-maples', color: 0x9b5a42 },
        ],
        scale: (feature) => { const size = finite(feature.size, 1.1); return [size * annArborTreeDimensions.width, size * annArborTreeDimensions.height, size * annArborTreeDimensions.width]; },
        lift: .015,
      },
      {
        modelKey: 'saguaro',
        matches: (kind) => kind.includes('cactus') || kind.includes('saguaro'),
        parts: [
          { key: 'body', name: 'feature-cacti', color: 0x477a55 },
          { key: 'ridges', name: 'feature-cactus-ridges', color: 0x245c43 },
          { key: 'flowers', name: 'feature-cactus-blossoms', color: 0xe58e62 },
        ],
        scale: (feature) => { const height = finite(feature.size, 1.1) * 4.8; return [height, height, height]; },
        lift: 0,
      },
      {
        modelKey: 'ocotillo',
        matches: (kind) => kind.includes('ocotillo'),
        parts: [{ key: 'stems', name: 'feature-ocotillo', color: 0x9f573c }],
        scale: (feature) => { const size = finite(feature.size, 1.1); return [size * 1.55, size * 2.2, size * 1.55]; },
        lift: .01,
      },
      {
        modelKey: 'cc0Rock',
        matches: (kind) => kind.includes('rock'),
        parts: [{ key: CC0_BATCH_PARTS.whole, name: 'feature-rocks', color: this.world.id === 'tucson' ? 0x8a654f : 0x756c5e }],
        scale: (feature) => { const size = finite(feature.size, 1.1); return [size * 1.45, size * .90, size * 1.18]; },
        lift: .01,
      },
      {
        modelKey: 'cc0Bush',
        matches: (kind) => kind.includes('shrub'),
        parts: [{ key: CC0_BATCH_PARTS.whole, name: 'feature-scrub', color: this.world.id === 'tucson' ? 0x6c7f4a : 0x56744b }],
        scale: (feature) => { const size = finite(feature.size, 1.1); return [size * 1.30, size * .95, size * 1.25]; },
        lift: .025,
      },
      {
        modelKey: 'cc0Grass',
        matches: (kind) => kind.includes('wildflower') || kind.includes('path-marker'),
        parts: [{ key: CC0_BATCH_PARTS.whole, name: 'feature-wild-grass', color: 0xb39a55 }],
        scale: (feature) => { const size = finite(feature.size, 1.1); return [size * 1.12, size * .55, size * 1.12]; },
        lift: .01,
      },
      {
        modelKey: 'cc0Grass',
        matches: (kind) => kind.includes('grass') || kind.includes('crop'),
        parts: [{ key: CC0_BATCH_PARTS.whole, name: 'feature-grass', color: this.world.id === 'tucson' ? 0xb49352 : 0x718e51 }],
        scale: (feature) => { const size = finite(feature.size, 1.1); return [size * 1.12, size * .62, size * 1.12]; },
        lift: .01,
      },
    ];
    const dummy = new THREE.Object3D();
    batches.forEach((batch) => {
      const entries = features.filter((feature) => batch.matches(String(feature.kind || '').toLowerCase()));
      if (!entries.length) return;
      batch.parts.forEach((part) => {
        const material = this._vegetationMaterial(part.color, {
          roughness: part.key === 'flowers' ? .84 : .98,
        });
        const mesh = new THREE.InstancedMesh(models[batch.modelKey][part.key], material, entries.length);
        mesh.name = part.name;
        entries.forEach((feature, index) => {
          const scale = batch.scale(feature);
          const point = this._mapPosition(feature.x, feature.y, finite(feature.z, this._terrainHeight(feature.x, feature.y)), false);
          dummy.position.copy(point);
          dummy.position.y += batch.lift;
          const featureId = Number(feature.id);
          dummy.rotation.y = (Number.isFinite(featureId) ? featureId : index) * 2.399;
          dummy.scale.set(scale[0], scale[1], scale[2]);
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData = { vegetation: part.name, instanceCount: entries.length };
        this.sceneryGroup.add(mesh);
      });
    });
  }

  _buildFeatures() {
    const features = arrayLike(this.world.features);
    this.featureById = new Map();
    features.forEach((feature, index) => this.featureById.set(safeId(feature.id, index), { feature, index }));
    // World generation is capped at MAX_FEATURES (1000).  Keep a stable
    // marker buffer so worker snapshots can stream sparse/compacted anchor
    // positions without reallocating the geometry on every update.
    const capacity = this.featureCapacity;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setDrawRange(0, 0);
    this._owned.add(geometry);
    this.featurePointGeometry = geometry;
    // Screen-sized outlined dots remain legible above their mapped anchors,
    // including where vegetation would otherwise bury a ground feature.
    const material = this._makeMaterial(new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 1, depthTest: false, depthWrite: false }));
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float r = length(gl_PointCoord - vec2(.5));
        if (r > .5) discard;
        outgoingLight = r > .31 ? vec3(.035, .075, .095) : outgoingLight;
        #include <opaque_fragment>
      `);
    };
    this.featurePoints = new THREE.Points(geometry, material);
    this.featurePoints.name = 'mapped-features';
    this.featurePoints.renderOrder = 10;
    this.markerGroup.add(this.featurePoints);
    this._updateFeaturePoints(new Set());
  }

  _featureSet(value) {
    const set = new Set();
    arrayLike(value).forEach((entry) => {
      set.add(String(entry));
      if (typeof entry === 'number') set.add(String(Math.trunc(entry)));
    });
    return set;
  }

  _updateFeaturePoints(mappedSet, visibleSet = new Set(), featurePositions = this.featurePositions, mappedIds = this.snapshot?.mappedFeatureIds) {
    const features = arrayLike(this.world && this.world.features);
    if (!this.featurePoints || !this.featurePointGeometry) return;
    const positionAttribute = this.featurePointGeometry.getAttribute('position');
    const colorAttribute = this.featurePointGeometry.getAttribute('color');
    const anchors = arrayLike(featurePositions);
    const mappedOrder = arrayLike(mappedIds);
    // Pixel-feature snapshots use an image-map anchor array rather than the
    // authored world feature list.  Prefer its persistent IDs and support
    // both id-indexed anchors (`id * 3`) and compact anchors in mapped order.
    const anchorIds = mappedOrder.length ? mappedOrder : Array.from(mappedSet);
    const numericAnchorIds = anchorIds.map((id) => Number(id)).filter(Number.isInteger);
    const directById = anchors.length >= 3 && numericAnchorIds.length > 0 &&
      Math.max(...numericAnchorIds) * 3 + 2 < anchors.length;
    const compactIndex = new Map();
    if (!directById) anchorIds.forEach((id, index) => {
      compactIndex.set(String(id), index);
      if (typeof id === 'number') compactIndex.set(String(Math.trunc(id)), index);
    });
    let count = 0;
    if (anchors.length >= 3 && anchorIds.length) {
      anchorIds.forEach((rawId) => {
        if (count >= this.featureCapacity) return;
        const id = safeId(rawId, count);
        if (!mappedSet.has(String(id))) return;
        const numericId = Number(id);
        let sourceIndex = directById && Number.isInteger(numericId) ? numericId : compactIndex.get(String(id));
        if (!Number.isFinite(sourceIndex) || sourceIndex < 0 || sourceIndex * 3 + 2 >= anchors.length) return;
        const x = finite(anchors[sourceIndex * 3]);
        const y = finite(anchors[sourceIndex * 3 + 1]);
        const z = finite(anchors[sourceIndex * 3 + 2]);
        const point = this._mapPosition(x, y, z + .3, false);
        positionAttribute.setXYZ(count, point.x, point.y, point.z);
        const color = visibleSet.has(String(id)) ? new THREE.Color('#71ffed') : new THREE.Color('#ffce66');
        colorAttribute.setXYZ(count, color.r, color.g, color.b);
        count += 1;
      });
    } else {
      features.forEach((feature, index) => {
        if (count >= this.featureCapacity) return;
        const id = safeId(feature.id, index);
        if (!mappedSet.has(String(id)) && !mappedSet.has(String(index))) return;
        let sourceIndex = -1;
        if (anchors.length >= features.length * 3) sourceIndex = index;
        else if (compactIndex.has(String(id))) sourceIndex = compactIndex.get(String(id));
        else if (compactIndex.has(String(index))) sourceIndex = compactIndex.get(String(index));
        let point;
        if (sourceIndex >= 0 && sourceIndex * 3 + 2 < anchors.length) {
          // Snapshot anchors are planner-space XYZ (x, y, surface elevation),
          // supplied by the simulation after its feature-to-pixel mapping.
          const x = finite(anchors[sourceIndex * 3], feature.x);
          const y = finite(anchors[sourceIndex * 3 + 1], feature.y);
          const z = finite(anchors[sourceIndex * 3 + 2], feature.z);
          point = this._mapPosition(x, y, z + .3, false);
        } else {
          const surface = finite(feature.z, this._terrainHeight(feature.x, feature.y));
          point = this._mapPosition(feature.x, feature.y, surface + .3, false);
        }
        positionAttribute.setXYZ(count, point.x, point.y, point.z);
        const color = visibleSet.has(String(id)) || visibleSet.has(String(index)) ? new THREE.Color('#71ffed') : new THREE.Color('#ffce66');
        colorAttribute.setXYZ(count, color.r, color.g, color.b);
        count += 1;
      });
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    this.featurePointGeometry.setDrawRange(0, count);
    this.featurePointGeometry.computeBoundingSphere();
  }

  _makeMarker(color, size = 1) {
    const material = this._makeMaterial(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9 }));
    const marker = this._makeMesh(new THREE.SphereGeometry(size, 10, 6), material);
    marker.renderOrder = 6;
    return marker;
  }

  _buildLandmarks(palette) {
    const landmarks = arrayLike(this.world.landmarks);
    landmarks.forEach((landmark, index) => {
      const id = safeId(landmark.id, `landmark-${index}`);
      const kind = String(landmark.kind || 'landmark').toLowerCase();
      const role = landmark.home ? 'home' : landmark.goal ? 'goal' : 'waypoint';
      const roleColor = role === 'home' ? LANDMARK_COLORS.home : role === 'goal' ? LANDMARK_COLORS.goal : LANDMARK_COLORS.observed;

      // The world builder links a semantic landmark to its physical object.
      // Accept both the landmarkId map populated during scenery construction
      // and a direct objectId lookup so hand-authored worlds remain useful.
      const referencedObjectId = landmark.objectId && typeof landmark.objectId === 'object'
        ? landmark.objectId.id
        : landmark.objectId;
      const objectEntry = (referencedObjectId !== undefined && referencedObjectId !== null
        ? this.landmarkObjects.get(safeId(referencedObjectId))
        : null)
        || this.landmarkObjects.get(id)
        || arrayLike(this.world.objects).reduce((match, object) => {
          if (match) return match;
          const objectLandmarkId = object?.landmarkId === undefined || object?.landmarkId === null
            ? null
            : safeId(object.landmarkId);
          const objectId = object?.id === undefined || object?.id === null ? null : safeId(object.id);
          return objectLandmarkId === id || objectId === safeId(referencedObjectId) ? { object, group: null } : null;
        }, null);
      const landmarkObject = objectEntry?.object || null;
      const model = objectEntry?.group || null;
      const group = new THREE.Group();

      // Use the linked model's actual top when available.  Declared object
      // height remains the fallback for simple worlds and gives every badge a
      // stable margin above its roof rather than burying it in geometry.
      let objectHeight = positive(landmarkObject?.height, 0);
      if (model) {
        const bounds = new THREE.Box3().setFromObject(model);
        objectHeight = Math.max(objectHeight, bounds.max.y - this._objectBase(landmarkObject).y);
      }
      const markerHeight = Math.max(7.5, objectHeight + 2.8);
      const labelHeight = markerHeight + 2.7;
      const footprintRadius = .5 * Math.hypot(positive(landmarkObject?.width, 0), positive(landmarkObject?.depth, 0));
      // Keep the ring outside the physical footprint so its ground anchor is
      // visible around a barn, campus building, or stadium instead of being
      // hidden below the model.  The cap protects hand-authored oversized
      // objects from producing an unwieldy map marker.
      const ringRadius = Math.max(4.2, Math.min(40, footprintRadius + (footprintRadius ? 1.2 : 0)));

      const ringMaterial = this._makeMaterial(new THREE.MeshBasicMaterial({ color: roleColor, transparent: true, opacity: .95, depthWrite: false }));
      const ring = this._makeMesh(new THREE.TorusGeometry(ringRadius, .34, 8, 64), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = .18;
      ring.renderOrder = 7;

      const statusMaterial = this._makeMaterial(new THREE.MeshBasicMaterial({ color: LANDMARK_COLORS.undiscovered, transparent: true, opacity: .78, depthWrite: false }));
      const statusRing = this._makeMesh(new THREE.TorusGeometry(ringRadius + 1.05, .16, 6, 64), statusMaterial);
      statusRing.rotation.x = Math.PI / 2;
      statusRing.position.y = .22;
      statusRing.renderOrder = 8;

      const stemMaterial = this._makeMaterial(new THREE.LineBasicMaterial({ color: LANDMARK_COLORS.undiscovered, transparent: true, opacity: .68, depthWrite: false }));
      const stemGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, .28, 0),
        new THREE.Vector3(0, markerHeight, 0),
      ]);
      this._owned.add(stemGeometry);
      const stem = new THREE.Line(stemGeometry, stemMaterial);
      stem.renderOrder = 8;

      const pinMaterial = this._makeMaterial(new THREE.MeshBasicMaterial({ color: roleColor, transparent: true, opacity: .92, depthWrite: false }));
      const pinGeometry = role === 'goal'
        ? new THREE.ConeGeometry(1.28, 2.9, 6)
        : role === 'home'
          ? new THREE.OctahedronGeometry(1.28, 0)
          : new THREE.DodecahedronGeometry(1.12, 0);
      const pin = this._makeMesh(pinGeometry, pinMaterial);
      pin.position.y = markerHeight;
      pin.renderOrder = 9;

      const landmarkTitle = landmark.label || landmark.title || id;
      const badgeTitle = landmark.badgeLabel
        || (/helipad/i.test(landmarkTitle) ? 'Survival Flight helipad' : landmarkTitle);
      const label = this._makeLabelBadge(badgeTitle, roleColor, { role, status: 'undiscovered' });
      label.position.y = labelHeight;

      // `landmark.z` may describe a visible roof/helipad surface for worlds
      // that use surfaceHeight().  The marker's ring and stem must stay
      // anchored at the ground footprint; the linked object's height above
      // that footprint is already accounted for by markerHeight above.
      const ground = this._terrainHeight(landmark.x, landmark.y);
      const point = this._mapPosition(landmark.x, landmark.y, ground + .15, false);
      group.position.copy(point);
      group.name = `landmark-marker-${id}`;
      group.userData = {
        type: 'landmark',
        id,
        landmarkId: id,
        title: landmark.label || landmark.title || id,
        role,
        status: 'undiscovered',
        state: role === 'home' ? 'HOME' : role === 'goal' ? 'GOAL' : 'UNDISCOVERED',
        description: landmark.description || this._landmarkDescription(landmark),
        badge: label.userData.badge,
      };
      [ring, statusRing, stem, pin, label].forEach((child) => { child.userData = group.userData; });
      group.add(ring, statusRing, stem, pin, label);
      group.visible = false;
      this.markerGroup.add(group);
      this.landmarkVisuals.push({ id, landmark, group, role, ring, statusRing, stem, pin, label, objectHeight });
    });
  }

  _landmarkDescription(landmark) {
    if (landmark.goal) return 'A goal landmark used to evaluate the final safe route.';
    if (landmark.home) return 'The launch and recovery landmark for the autonomous vehicle.';
    return 'A geometric landmark that can be acquired by the sensing policy.';
  }

  _zonePoints(zone, altitude = .18) {
    const points = [];
    const x = finite(zone.x); const y = finite(zone.y); const angle = finite(zone.angle);
    if (String(zone.kind).toLowerCase() === 'rect' || zone.width || zone.height) {
      const width = positive(zone.width, 16) / 2;
      const height = positive(zone.height, 12) / 2;
      [[-width, -height], [width, -height], [width, height], [-width, height]].forEach(([px, py]) => {
        const rx = px * Math.cos(angle) - py * Math.sin(angle);
        const ry = px * Math.sin(angle) + py * Math.cos(angle);
        points.push(this._mapPosition(x + rx, y + ry, altitude));
      });
    } else {
      const radius = positive(zone.radius, 12);
      for (let index = 0; index < 32; index += 1) {
        const theta = index / 32 * TAU;
        points.push(this._mapPosition(x + Math.cos(theta) * radius, y + Math.sin(theta) * radius, altitude));
      }
    }
    return points;
  }

  _buildZones() {
    arrayLike(this.world.zones).forEach((zone, index) => {
      const id = safeId(zone.id, `zone-${index}`);
      const points = this._zonePoints(zone);
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints(points);
      this._owned.add(outlineGeometry);
      const outlineMaterial = this._makeMaterial(new THREE.LineDashedMaterial({ color: COLORS.safety, dashSize: 2.5, gapSize: 1.7, transparent: true, opacity: .45 }));
      const outline = new THREE.LineLoop(outlineGeometry, outlineMaterial);
      outline.computeLineDistances();
      outline.userData = { type: 'zone', id, title: zone.label || zone.title || id, description: zone.description || (zone.crowd ? 'A procedural crowd zone used to test recognition and safe clearance.' : 'A restricted no-fly zone that the planner must avoid.') };
      let fill;
      const isRect = String(zone.kind).toLowerCase() === 'rect' || zone.width || zone.height;
      if (isRect) {
        const width = positive(zone.width, 16);
        const height = positive(zone.height, 12);
        const volumeHeight = this._flightAltitude() + 18;
        const geometry = new THREE.BoxGeometry(width, volumeHeight, height);
        const material = this._makeMaterial(new THREE.MeshBasicMaterial({ color: COLORS.safety, transparent: true, opacity: .23, side: THREE.DoubleSide, depthWrite: false }));
        fill = this._makeMesh(geometry, material);
        fill.position.copy(this._mapPosition(zone.x, zone.y, volumeHeight / 2 + .08));
        fill.rotation.y = finite(zone.angle);
      } else {
        const radius = positive(zone.radius, 12);
        const volumeHeight = this._flightAltitude() + 18;
        const geometry = new THREE.CylinderGeometry(radius, radius, volumeHeight, 32, 1, true);
        const material = this._makeMaterial(new THREE.MeshBasicMaterial({ color: COLORS.safety, transparent: true, opacity: .23, side: THREE.DoubleSide, depthWrite: false }));
        fill = this._makeMesh(geometry, material);
        fill.position.copy(this._mapPosition(zone.x, zone.y, volumeHeight / 2 + .08));
      }
      fill.userData = outline.userData;
      fill.visible = false;
      const framePoints=[];
      const top=this._zonePoints(zone,this._flightAltitude()+18);
      for(let i=0;i<top.length;i++) {
        framePoints.push(top[i],top[(i+1)%top.length]);
        if(i%Math.max(1,Math.floor(top.length/8))===0)framePoints.push(points[i],top[i]);
      }
      const frameGeometry=new THREE.BufferGeometry().setFromPoints(framePoints);this._owned.add(frameGeometry);
      const frame=new THREE.LineSegments(frameGeometry,this._makeMaterial(new THREE.LineBasicMaterial({color:COLORS.safety,transparent:true,opacity:.58})));
      frame.userData=outline.userData;
      this.zoneGroup.add(outline, fill, frame);
      this.zoneVisuals.push({ id, zone, outline, fill, frame });
    });
  }

  _createDrone(color, opacity) {
    const group = new THREE.Group();
    const propellers = [];
    const bodyMaterial = this._makeMaterial(new THREE.MeshStandardMaterial({ color, roughness: .47, metalness: .22, transparent: opacity < 1, opacity, depthWrite: opacity >= .95 }));
    const darkMaterial = this._makeMaterial(new THREE.MeshStandardMaterial({ color: 0x21343e, roughness: .55, metalness: .3, transparent: opacity < 1, opacity: Math.min(1, opacity + .08), depthWrite: opacity >= .95 }));
    const body = this._makeMesh(new THREE.BoxGeometry(2.9, .58, 1.55), bodyMaterial);
    group.add(body);
    const nose = this._makeMesh(new THREE.ConeGeometry(.68, 1.6, 4), bodyMaterial);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 1.7;
    group.add(nose);
    const wing = this._makeMesh(new THREE.BoxGeometry(1.8, .13, 7.4), bodyMaterial);
    wing.position.x = -.45;
    group.add(wing);
    const tail = this._makeMesh(new THREE.BoxGeometry(.9, .72, .14), darkMaterial);
    tail.position.x = -1.1;
    group.add(tail);
    [-2.25, 2.25].forEach((z) => {
      const prop = this._makeMesh(new THREE.CylinderGeometry(.05, .05, 1.45, 8), darkMaterial);
      prop.rotation.x = Math.PI / 2;
      prop.position.set(-.52, .34, z);
      group.add(prop);
      propellers.push(prop);
    });
    // The heading frame stays level. Bank only the airframe around its
    // longitudinal (+X) axis, leaving camera stabilization independent.
    const airframe = new THREE.Group();
    airframe.name = 'airframe';
    [...group.children].forEach(child => airframe.add(child));
    group.add(airframe);
    group.userData.airframe = airframe;
    group.userData.targetRoll = 0;
    const gimbal = new THREE.Group();
    const gimbalBall = this._makeMesh(new THREE.SphereGeometry(.26, 8, 6), darkMaterial);
    gimbal.add(gimbalBall);
    const lens = this._makeMesh(new THREE.CylinderGeometry(.1, .14, .38, 8), bodyMaterial);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = .24;
    gimbal.add(lens);
    gimbal.position.set(.5, -.48, 0);
    group.add(gimbal);
    group.userData.propellers = propellers;
    group.userData.gimbal = gimbal;
    group.userData.lastYaw = null;
    group.scale.setScalar(opacity < 1 ? 1.45 : 1.8);
    group.renderOrder = opacity < 1 ? 3 : 8;
    return group;
  }

  _makeFan() {
    const segments = CAMERA_FAN_SEGMENTS;
    const ringCount = segments + 1;
    this._fanNearRadii = new Float32Array(ringCount);
    this._fanFarRadii = new Float32Array(ringCount);
    this._fanNearPoints = new Float32Array(ringCount * 3);
    this._fanFarPoints = new Float32Array(ringCount * 3);
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(ringCount * 2 * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const indices = [];
    const outerStart = ringCount;
    for (let index = 0; index < segments; index += 1) {
      const next = index + 1;
      indices.push(index, outerStart + index, outerStart + next,
        index, outerStart + next, next);
    }
    geometry.setIndex(indices);
    this._owned.add(geometry);
    const material = this._makeMaterial(new THREE.MeshBasicMaterial({ color: COLORS.uav, transparent: true, opacity: .14, side: THREE.DoubleSide, depthWrite: false }));
    const fan = new THREE.Mesh(geometry, material);
    fan.renderOrder = 2;
    fan.visible = false;
    return fan;
  }

  _makeFanSides() {
    const segments = CAMERA_FAN_SEGMENTS;
    const ringCount = segments + 1;
    const innerStart = 1;
    const outerStart = innerStart + ringCount;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((1 + ringCount * 2) * 3), 3));
    const indices = [];
    // Keep both conical surfaces bounded by the actual near and far ground
    // intersections. The ground annulus below carries the effective footprint;
    // these surfaces only show the translucent volume leading back to the UAV.
    for (let index = 0; index < segments; index += 1) {
      const next = index + 1;
      indices.push(0, innerStart + index, innerStart + next,
        0, outerStart + index, outerStart + next);
    }
    geometry.setIndex(indices);
    this._owned.add(geometry);
    const material = this._makeMaterial(new THREE.MeshBasicMaterial({ color: COLORS.uav, transparent: true, opacity: .09, side: THREE.DoubleSide, depthWrite: false }));
    const sides = new THREE.Mesh(geometry, material);
    sides.name = 'camera-frustum-sides';
    sides.renderOrder = 2;
    sides.visible = false;
    return sides;
  }

  _makeFanEdges() {
    const segments = CAMERA_FAN_SEGMENTS;
    // Two ground arcs, two radial boundary segments, and the four UAV-to-edge
    // lines. The storage is fixed so updates can fill it in place.
    const segmentCount = segments * 2 + 2 + 4;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segmentCount * 2 * 3), 3));
    this._owned.add(geometry);
    const material = this._makeMaterial(new THREE.LineBasicMaterial({ color: COLORS.uav, transparent: true, opacity: .42 }));
    const edges = new THREE.LineSegments(geometry, material);
    edges.name = 'camera-frustum-edges';
    edges.visible = false;
    return edges;
  }

  _makeLine(name, color, dashed, linewidth, opacity, segments = false, initialCapacity = 1024) {
    const path = makeThickLine({ name, color, width: linewidth, opacity, dashed, segments,
      capacity: initialCapacity, depthTest: true, renderOrder: name === 'tree' ? 1 : 4 });
    // A bounded staging array converts simulator XY coordinates once per update.
    path.positions = new Float32Array(initialCapacity * 3);
    resizeThickLine(path, this.canvas.clientWidth || 800, this.canvas.clientHeight || 550);
    this._owned.add(path.geometry); this._owned.add(path.material);
    return path;
  }

  _makeRing(color, opacity) {
    this.orbitPath = this._makeLine('terminal-orbit', color, false, 3.5, opacity, false, 65);
    return this.orbitPath.object;
  }

  _updateLine(path, values, altitude, options = {}) {
    const data = arrayLike(values);
    const count = Math.min(Math.floor(data.length / 2), path.capacity);
    for (let i = 0; i < count; i++) {
      path.positions[i * 3] = data[i * 2] - this.world.width / 2;
      path.positions[i * 3 + 1] = altitude;
      path.positions[i * 3 + 2] = this.world.height / 2 - data[i * 2 + 1];
    }
    updateThickLine(path, path.positions, count, options.colors);
    if (options.visible === false) path.object.visible = false;
  }

  _updateTree(values, colors = null) {
    this._updateLine(this.paths.tree, values, this._flightAltitude() + .05, { colors });
  }

  _fanGroundInside(x, y, yaw, relativeAngle, radius, sensor, altitude, halfAngle, maxRadius) {
    if (radius < 0 || radius > maxRadius || Math.abs(relativeAngle) > halfAngle) return false;
    const groundX = x + Math.cos(yaw + relativeAngle) * radius;
    const groundY = y + Math.sin(yaw + relativeAngle) * radius;
    const height = altitude - this._terrainHeight(groundX, groundY);
    const forward = radius * Math.cos(relativeAngle);
    const right = radius * Math.sin(relativeAngle);
    const c = Math.cos(sensor.pitch), s = Math.sin(sensor.pitch);
    const depth = forward * c + height * s;
    const vertical = forward * s - height * c;
    const horizontalSlope = Math.tan(sensor.horizontalFovRadians / 2);
    const verticalSlope = Math.tan(sensor.verticalFov / 2);
    // This is the margin-free form of inSensorImage(), paired with the same
    // sector/range gate as inFov(). Keep the strict depth planes identical.
    return depth > sensor.near && depth < sensor.far &&
      depth * horizontalSlope - Math.abs(right) >= 0 &&
      depth * verticalSlope - vertical >= 0 &&
      depth * verticalSlope + vertical >= 0;
  }

  _fanRadiusInterval(x, y, yaw, relativeAngle, sensor, altitude, maxRadius, halfAngle, nearIndex) {
    let previousRadius = 0;
    let previousInside = this._fanGroundInside(
      x, y, yaw, relativeAngle, 0, sensor, altitude, halfAngle, maxRadius,
    );
    let near = previousInside ? 0 : maxRadius;
    let far = 0;
    let found = previousInside;

    for (let step = 1; step <= CAMERA_FAN_SCAN_STEPS; step += 1) {
      const radius = maxRadius * step / CAMERA_FAN_SCAN_STEPS;
      const inside = this._fanGroundInside(
        x, y, yaw, relativeAngle, radius, sensor, altitude, halfAngle, maxRadius,
      );
      if (!found && inside) {
        let outside = previousRadius;
        let insideRadius = radius;
        for (let iteration = 0; iteration < 20; iteration += 1) {
          const middle = (outside + insideRadius) / 2;
          if (this._fanGroundInside(
            x, y, yaw, relativeAngle, middle, sensor, altitude, halfAngle, maxRadius,
          )) insideRadius = middle;
          else outside = middle;
        }
        near = insideRadius;
        found = true;
      }
      if (found && inside) far = radius;
      if (found && previousInside && !inside) {
        let insideRadius = previousRadius;
        let outside = radius;
        for (let iteration = 0; iteration < 20; iteration += 1) {
          const middle = (insideRadius + outside) / 2;
          if (this._fanGroundInside(
            x, y, yaw, relativeAngle, middle, sensor, altitude, halfAngle, maxRadius,
          )) insideRadius = middle;
          else outside = middle;
        }
        far = insideRadius;
        break;
      }
      previousRadius = radius;
      previousInside = inside;
    }

    if (!found) {
      this._fanNearRadii[nearIndex] = 0;
      this._fanFarRadii[nearIndex] = 0;
      return;
    }
    // Float32 position storage can move an exact boundary a few ulps outside
    // the optical plane. Keep every stored boundary just inside the gate.
    if (near > 0) near += CAMERA_FAN_BOUNDARY_EPSILON;
    if (far > 0) far = Math.max(near, far - CAMERA_FAN_BOUNDARY_EPSILON);
    if (far < near) near = far = 0;
    this._fanNearRadii[nearIndex] = near;
    this._fanFarRadii[nearIndex] = far;
  }

  _writeFanGroundPoint(target, offset, x, y, radius, yaw, altitude) {
    const groundX = x + Math.cos(yaw) * radius;
    const groundY = y + Math.sin(yaw) * radius;
    const groundHeight = this._terrainHeight(groundX, groundY);
    target[offset] = groundX - positive(this.world?.width, 220) / 2;
    target[offset + 1] = Math.min(groundHeight + .32, altitude - .1);
    target[offset + 2] = positive(this.world?.height, 180) / 2 - groundY;
  }

  _writeFanEdgeSegment(target, offset, sourceA, offsetA, sourceB, offsetB) {
    target[offset] = sourceA[offsetA]; target[offset + 1] = sourceA[offsetA + 1]; target[offset + 2] = sourceA[offsetA + 2];
    target[offset + 3] = sourceB[offsetB]; target[offset + 4] = sourceB[offsetB + 1]; target[offset + 5] = sourceB[offsetB + 2];
    return offset + 6;
  }

  _writeFanApexEdge(target, offset, apexX, apexY, apexZ, source, sourceOffset) {
    target[offset] = apexX; target[offset + 1] = apexY; target[offset + 2] = apexZ;
    target[offset + 3] = source[sourceOffset]; target[offset + 4] = source[sourceOffset + 1]; target[offset + 5] = source[sourceOffset + 2];
    return offset + 6;
  }

  _updateFan(snapshot) {
    const pose = arrayLike(snapshot.pose);
    if (pose.length < 2) { this.cameraFan.visible = false; this.cameraFanSides.visible = false; this.cameraFanEdges.visible = false; return; }
    const x = finite(pose[0]); const y = finite(pose[1]);
    const yaw = finite(snapshot.cameraYaw, finite(pose[2]));
    const sensor = this.sensorConfig;
    const altitude = this._flightAltitude();
    const maxRadius = Math.min(sensor.range, positive(snapshot.cameraRadius, sensor.range));
    const halfAngle = Math.max(0, sensor.horizontalFovRadians / 2 - CAMERA_FAN_ANGLE_EPSILON);
    const ringCount = CAMERA_FAN_SEGMENTS + 1;
    for (let index = 0; index < ringCount; index += 1) {
      const relativeAngle = -halfAngle + 2 * halfAngle * (index / CAMERA_FAN_SEGMENTS);
      this._fanRadiusInterval(x, y, yaw, relativeAngle, sensor, altitude, maxRadius, halfAngle, index);
      const theta = yaw + relativeAngle;
      this._writeFanGroundPoint(this._fanNearPoints, index * 3, x, y, this._fanNearRadii[index], theta, altitude);
      this._writeFanGroundPoint(this._fanFarPoints, index * 3, x, y, this._fanFarRadii[index], theta, altitude);
    }

    const positions = this.cameraFan.geometry.getAttribute('position').array;
    const outerStart = ringCount * 3;
    positions.set(this._fanNearPoints, 0);
    positions.set(this._fanFarPoints, outerStart);
    this.cameraFan.geometry.getAttribute('position').needsUpdate = true;
    this.cameraFan.geometry.computeBoundingSphere();

    const sidePositions = this.cameraFanSides.geometry.getAttribute('position').array;
    sidePositions[0] = x - positive(this.world?.width, 220) / 2;
    sidePositions[1] = altitude;
    sidePositions[2] = positive(this.world?.height, 180) / 2 - y;
    sidePositions.set(this._fanNearPoints, 3);
    sidePositions.set(this._fanFarPoints, 3 + outerStart);
    this.cameraFanSides.geometry.getAttribute('position').needsUpdate = true;
    this.cameraFanSides.geometry.computeBoundingSphere();

    const edgePositions = this.cameraFanEdges.geometry.getAttribute('position').array;
    const apexX = x - positive(this.world?.width, 220) / 2;
    const apexY = altitude;
    const apexZ = positive(this.world?.height, 180) / 2 - y;
    let edgeOffset = 0;
    for (let index = 0; index < CAMERA_FAN_SEGMENTS; index += 1) {
      const next = index + 1;
      edgeOffset = this._writeFanEdgeSegment(edgePositions, edgeOffset, this._fanNearPoints, index * 3, this._fanNearPoints, next * 3);
      edgeOffset = this._writeFanEdgeSegment(edgePositions, edgeOffset, this._fanFarPoints, index * 3, this._fanFarPoints, next * 3);
    }
    edgeOffset = this._writeFanEdgeSegment(edgePositions, edgeOffset, this._fanNearPoints, 0, this._fanFarPoints, 0);
    edgeOffset = this._writeFanEdgeSegment(edgePositions, edgeOffset, this._fanNearPoints, CAMERA_FAN_SEGMENTS * 3, this._fanFarPoints, CAMERA_FAN_SEGMENTS * 3);
    edgeOffset = this._writeFanApexEdge(edgePositions, edgeOffset, apexX, apexY, apexZ, this._fanNearPoints, 0);
    edgeOffset = this._writeFanApexEdge(edgePositions, edgeOffset, apexX, apexY, apexZ, this._fanFarPoints, 0);
    edgeOffset = this._writeFanApexEdge(edgePositions, edgeOffset, apexX, apexY, apexZ, this._fanNearPoints, CAMERA_FAN_SEGMENTS * 3);
    this._writeFanApexEdge(edgePositions, edgeOffset, apexX, apexY, apexZ, this._fanFarPoints, CAMERA_FAN_SEGMENTS * 3);
    this.cameraFanEdges.geometry.getAttribute('position').needsUpdate = true;
    this.cameraFanEdges.geometry.computeBoundingSphere();
    this.cameraFan.visible = true;
    this.cameraFanSides.visible = true;
    this.cameraFanEdges.visible = true;
  }

  _updateFpvCamera() {
    if (!this.fpvCamera || !this.drone?.visible) return;
    const yaw = finite(this.drone.rotation.y, finite(this.snapshot?.cameraYaw));
    const forwardX = Math.cos(yaw);
    const forwardZ = -Math.sin(yaw);
    // The nose is on the airframe's +X axis.  The vehicle pose is already
    // interpolated in `_animateVehicle`, so this camera follows the same
    // smoothed true-UAV motion while remaining independent of the sensor
    // camera's fixed downward pitch.
    this._fpvNose.set(2.05, .18, 0).applyAxisAngle(this._fpvAxis, yaw).add(this.drone.position);
    this.fpvCamera.position.copy(this._fpvNose);
    const pitch = finite(this.snapshot?.fpvPitch, this._fpvPitch);
    const lookDistance = 100;
    this._fpvTarget.set(
      this._fpvNose.x + forwardX * Math.cos(pitch) * lookDistance,
      this._fpvNose.y + Math.sin(pitch) * lookDistance,
      this._fpvNose.z + forwardZ * Math.cos(pitch) * lookDistance,
    );
    this.fpvCamera.lookAt(this._fpvTarget);
  }

  _updateDrone(group, pose, opacityAltitude = 35) {
    const values = arrayLike(pose);
    if (values.length < 2) { group.visible = false; return; }
    const position = this._mapPosition(values[0], values[1], opacityAltitude, false);
    const yaw = finite(values[2]);
    if(!group.userData.targetPosition){group.position.copy(position);group.rotation.y=yaw;}
    group.userData.startPosition=group.position.clone();
    group.userData.startYaw=group.rotation.y;
    group.userData.targetYaw=yaw;
    group.userData.targetPosition=position;
    group.userData.frameStarted=performance.now();
    if (group.userData.lastYaw !== null && group.userData.lastYaw !== undefined) {
      const delta = Math.atan2(Math.sin(yaw - group.userData.lastYaw), Math.cos(yaw - group.userData.lastYaw));
      group.userData.targetRoll = THREE.MathUtils.clamp(-delta * 2.2, -.42, .42);
    }
    group.userData.lastYaw = yaw;
    group.visible = true;
  }

  _animateVehicle(deltaSeconds) {
    this._propellerPhase += deltaSeconds * 46;
    const timestamp=performance.now();
    [this.drone, this.ghost].forEach((group, groupIndex) => {
      if(group.userData.targetPosition){
        const t=Math.min(1,(timestamp-group.userData.frameStarted)/200);
        group.position.lerpVectors(group.userData.startPosition,group.userData.targetPosition,t);
        const delta=Math.atan2(Math.sin(group.userData.targetYaw-group.userData.startYaw),Math.cos(group.userData.targetYaw-group.userData.startYaw));
        group.rotation.y=group.userData.startYaw+delta*t;
      }
      const airframe = group.userData.airframe;
      // A visual-only first-order response; never feeds the simulator or
      // changes its pose, heading, speed, turn radius, or sensing geometry.
      airframe.rotation.x += (group.userData.targetRoll - airframe.rotation.x) * (1 - Math.exp(-deltaSeconds / .3));

      const props = group?.userData?.propellers || [];
      props.forEach((prop, index) => { prop.rotation.y = this._propellerPhase * (groupIndex ? .82 : 1) + index * Math.PI; });
      const gimbal = group?.userData?.gimbal;
      if (gimbal) {
        gimbal.rotation.set(this.sensorConfig.pitch, finite(this.displayCameraYaw,this.snapshot?.cameraYaw) - group.rotation.y + Math.PI / 2, 0, 'YXZ');
      }
    });
  }

  _updateOrbit(orbit) {
    if (!orbit || !Number.isFinite(Number(orbit.radius))) {
      this.orbit.visible = false; this.orbitCenter.visible = false; this.switchpoint.visible = false; return;
    }
    const radius = positive(orbit.radius, 10);
    const center = this._mapPosition(orbit.x, orbit.y, this._flightAltitude() + .1, false);
    const positions = this.orbitPath.positions;
    for (let index = 0; index < 65; index += 1) {
      const theta = index / 64 * TAU;
      const point = this._mapPosition(finite(orbit.x) + radius * Math.cos(theta), finite(orbit.y) + radius * Math.sin(theta), this._flightAltitude() + .1, false);
      positions[index * 3] = point.x; positions[index * 3 + 1] = point.y; positions[index * 3 + 2] = point.z;
    }
    updateThickLine(this.orbitPath, positions, 65);
    this.orbit.visible = true;
    this.orbitCenter.position.copy(center); this.orbitCenter.visible = true;
    const switchpoint = arrayLike(orbit.switchpoint || this.snapshot?.switchpoint);
    if (switchpoint.length >= 2) {
      this.switchpoint.position.copy(this._mapPosition(switchpoint[0], switchpoint[1], this._flightAltitude() + .1, false));
      this.switchpoint.visible = true;
    } else this.switchpoint.visible = false;
  }

  _updateLandmarks(discovered, active) {
    const discoveredSet = this._featureSet(discovered);
    const activeSet = this._featureSet(active);
    this.landmarkVisuals.forEach(({ id, landmark, group, role, ring, statusRing, stem, pin, label }) => {
      const known = discoveredSet.has(id) || activeSet.has(id) || landmark.known === true || landmark.home === true;
      const verified = activeSet.has(id);
      const status = verified ? 'renewal-verified' : known ? 'observed' : 'undiscovered';
      const state = role === 'home' ? 'HOME' : role === 'goal' && !known ? 'GOAL' : status.toUpperCase();
      const roleColor = role === 'home' ? LANDMARK_COLORS.home : role === 'goal' ? LANDMARK_COLORS.goal : LANDMARK_COLORS[status === 'renewal-verified' ? 'verified' : status];
      const statusColor = LANDMARK_COLORS[status === 'renewal-verified' ? 'verified' : status];
      group.visible = this.knowledgeView ? known : true;
      group.userData.status = status;
      group.userData.state = state;
      group.userData.role = role;
      this._updateLabelBadge(label, role, status, roleColor);
      group.userData.description = verified
        ? 'Observed landmark. Its complete renewal orbit is verified and available to ReRoot.'
        : known
          ? 'Landmark observed. Its complete renewal orbit has not yet been certified.'
          : 'Not yet observed by the UAV. Visible here only in the full-world view.';

      // Update only existing material properties.  Marker textures are made
      // once in _buildLandmarks and redrawn only when their status changes.
      if (ring?.material) {
        ring.material.color.setHex(roleColor);
        ring.material.opacity = verified ? 1 : known ? .98 : .42;
        ring.material.transparent = true;
        ring.material.needsUpdate = true;
      }
      if (statusRing?.material) {
        statusRing.material.color.setHex(statusColor);
        statusRing.material.opacity = verified ? 1 : known ? .86 : .34;
        statusRing.material.transparent = true;
        statusRing.material.needsUpdate = true;
      }
      if (stem?.material) {
        stem.material.color.setHex(statusColor);
        stem.material.opacity = verified ? .98 : known ? .8 : .28;
        stem.material.transparent = true;
        stem.material.needsUpdate = true;
      }
      if (pin?.material) {
        pin.material.color.setHex(roleColor);
        pin.material.opacity = verified ? 1 : known ? .95 : .52;
        pin.material.transparent = true;
        pin.material.needsUpdate = true;
      }
      group.scale.setScalar(verified ? 1.14 : known ? 1 : .86);
    });
  }

  _updateZones(knownZones) {
    const knownSet = this._featureSet(knownZones);
    this.zoneVisuals.forEach(({ id, zone, outline, fill, frame }) => {
      const known = zone.known === true || knownSet.has(id);
      outline.visible = this.knowledgeView ? known : true;
      fill.visible = known;frame.visible=known;
      outline.userData.description = known ? 'Known no-fly boundary. Both nominal and backup trajectories must remain outside its buffered volume.' : 'Undiscovered crowd restriction. A clear camera observation reveals its full boundary to the UAV.';
      const material = outline.material;
      material.opacity = known ? .84 : .36;
      material.dashSize = known ? 10000 : 2.5;
      material.gapSize = known ? 0 : 1.7;
      material.needsUpdate = true;
      if (fill.material) fill.material.opacity = known ? .23 : 0;
    });
  }

  _updateKnowledgeVisibility() {
    if (this.terrainMaterial) {
      this.terrainMaterial.opacity = 1;
      this.terrainMaterial.color.set(0xffffff);
      this.terrainMaterial.needsUpdate = true;
    }
    this._updateKnowledgeMask(this.knowledge);
    for (const {sprite,object} of this.buildingLabels) {
      const k=this.knowledge, index=k?Math.floor(object.y/k.cellSize)*k.width+Math.floor(object.x/k.cellSize):-1;
      sprite.visible=!this.knowledgeView||Boolean(k?.observed[index]);
    }
    const snapshot = this.snapshot || {};
    this._updateLandmarks(snapshot.discoveredLandmarkIds, snapshot.activeLandmarkIds);
    this._updateZones(snapshot.knownZoneIds);
    const knownZones = this._featureSet(snapshot.knownZoneIds);
    this.crowdVisuals.forEach((points) => {
      points.visible = !this.knowledgeView || !points.userData.zoneId || knownZones.has(String(points.userData.zoneId));
    });
  }

  _updateKnowledgeMask(knowledge) {
    if (!this.knowledgeFog) return;
    this.knowledgeFog.enabled.value = this.knowledgeView ? 1 : 0;
    const pixels = this.knowledgeFog.texture.image.data;
    const cells = arrayLike(knowledge?.observed);
    for (let i = 0; i < pixels.length; i++) pixels[i] = cells[i] > 0 ? 255 : 0;
    this.knowledgeFog.texture.needsUpdate = true;
  }

  update(snapshot = {}) {
    if (this._disposed) return;
    const incoming = snapshot || {};
    if (incoming.sensor) this.setSensorConfig(incoming.sensor);
    this.cameraStartYaw=this.displayCameraYaw??finite(incoming.cameraYaw);
    this.cameraFrameStarted=performance.now();
    const mappedFeatureIds = Array.from(arrayLike(incoming.mappedFeatureIds));
    const incomingFeaturePositions = arrayLike(incoming.featurePositions);
    this.featurePositions = incomingFeaturePositions.length >= 3
      ? new Float32Array(incomingFeaturePositions)
      : null;
    // The worker transfers typed buffers back as soon as update returns. Keep
    // only plain state for later camera/knowledge toggles so no detached view
    // is retained by the renderer.
    this.snapshot = {
      pose: Array.from(arrayLike(incoming.pose)).slice(0, 3),
      estimate: Array.from(arrayLike(incoming.estimate)).slice(0, 3),
      mappedFeatureIds,
      featurePositions: this.featurePositions,
      cameraYaw: finite(incoming.cameraYaw),
      orbit: incoming.orbit ? { ...incoming.orbit } : null,
      switchpoint: Array.from(arrayLike(incoming.switchpoint)).slice(0, 3),
      discoveredLandmarkIds: Array.from(arrayLike(incoming.discoveredLandmarkIds)),
      activeLandmarkIds: Array.from(arrayLike(incoming.activeLandmarkIds)),
      knownZoneIds: Array.from(arrayLike(incoming.knownZoneIds)),
      time: finite(incoming.time, this._lastTime),
    };
    const knowledge = incoming?.knowledge;
    this.knowledge = knowledge?.cells
      ? { width: finite(knowledge.width), height: finite(knowledge.height), cellSize: finite(knowledge.cellSize, 2), cells: new Uint8Array(knowledge.cells), observed: new Uint8Array(knowledge.observed || []) }
      : null;
    const mappedSet = this._featureSet(incoming.mappedFeatureIds);
    const visibleSet = this._featureSet(incoming.visibleFeatureIds);
    this._updateFeaturePoints(mappedSet, visibleSet, this.featurePositions, mappedFeatureIds);
    this._updateDrone(this.drone, incoming.pose, this._flightAltitude());
    const estimate = incoming.estimate || incoming.pose;
    this._updateDrone(this.ghost, estimate, this._flightAltitude() + .25);
    this._updateFan(incoming);
    const altitude = this._flightAltitude();
    this._updateLine(this.paths.nominal, incoming.nominal, altitude + .05, { visible: true });
    this._updateLine(this.paths.committed, incoming.committedNominal, altitude + .15, { visible: true });
    this._updateLine(this.paths.backup, incoming.backup, altitude + .25, { visible: true });
    const trail = arrayLike(incoming.trail);
    const actualTrail = []; const estimateTrail = [];
    for (let index = 0; index + 3 < trail.length; index += 4) {
      actualTrail.push(trail[index], trail[index + 1]);
      estimateTrail.push(trail[index + 2], trail[index + 3]);
    }
    this._updateLine(this.paths.trailActual, actualTrail, altitude + .35, { visible: actualTrail.length >= 4 });
    this._updateLine(this.paths.trailEstimate, estimateTrail, altitude + .45, { visible: estimateTrail.length >= 4 });
    this._updateTree(incoming.treeEdges, incoming.treeColors);
    this._updateOrbit(incoming.orbit);
    this._updateLandmarks(incoming.discoveredLandmarkIds, incoming.activeLandmarkIds);
    this._updateZones(incoming.knownZoneIds);
    this._updateKnowledgeVisibility();
    this._lastTime = finite(incoming.time, this._lastTime);
  }

  setKnowledgeView(value) {
    this.knowledgeView = Boolean(value);
    this._updateKnowledgeVisibility();
  }

  setViewMode(mode = 'orbit') {
    const next = ['orbit', 'top', 'fpv'].includes(mode) ? mode : 'orbit';
    const previousMode = this.viewMode;
    if (next !== 'fpv' && this.viewMode === 'fpv' && this.drone?.userData?.airframe) {
      this.drone.userData.airframe.visible = this._airframeVisibleBeforeFpv !== false;
    }
    if (next === 'fpv' && this.viewMode !== 'fpv' && this.drone?.userData?.airframe) {
      this._airframeVisibleBeforeFpv = this.drone.userData.airframe.visible;
      this.drone.userData.airframe.visible = false;
    }
    this.viewMode = next;
    if (next === 'fpv') {
      this.camera = this.fpvCamera;
      this.controls.enabled = false;
      this._updateFpvCamera();
    } else {
      this.camera = this.orbitCamera;
      this.controls.enabled = true;
      this.controls.maxPolarAngle = next === 'top' ? Math.PI / 2.01 : Math.PI * .485;
      if (next === 'top') this._setTopDownCamera();
      else if (previousMode !== 'orbit') this._setOrbitCamera();
    }
    return this.viewMode;
  }

  _setOrbitCamera() {
    const width = positive(this.world?.width, 220);
    const height = positive(this.world?.height, 180);
    const distance = Math.max(width, height) * 1.02;
    this.orbitCamera.position.set(distance * .72, distance * .92, distance * .82);
    this.controls.target.set(0, -12, 0);
    this.controls.maxPolarAngle = Math.PI * .485;
    this.controls.update();
  }

  _setTopDownCamera() {
    const width = positive(this.world?.width, 220);
    const height = positive(this.world?.height, 180);
    const distance = Math.max(height, width / this.orbitCamera.aspect) / (2 * Math.tan(this.orbitCamera.fov * Math.PI / 360)) * 1.1 + this._flightAltitude();
    this.orbitCamera.position.set(0, distance, 0.01);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  setTopDown() {
    return this.setViewMode('top');
  }

  topView() {
    return this.setTopDown();
  }

  resetView() {
    this.setViewMode('orbit');
    this._setOrbitCamera();
  }

  resize() {
    if (this._disposed) return;
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 800);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 550);
    this.renderer.setSize(width, height, false);
    this.orbitCamera.aspect = width / height;
    this.orbitCamera.updateProjectionMatrix();
    this.fpvCamera.aspect = width / height;
    this.fpvCamera.updateProjectionMatrix();
    [...Object.values(this.paths || {}), this.orbitPath].filter(Boolean).forEach(path => resizeThickLine(path, width, height));
  }

  render() {
    if (this._disposed) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const delta = this._lastFrameTime ? Math.min(.08, Math.max(0, (now - this._lastFrameTime) / 1000)) : .016;
    this._lastFrameTime = now;
    if(this.snapshot?.pose.length>=2){
      const t=Math.min(1,(now-this.cameraFrameStarted)/200),target=this.snapshot.cameraYaw;
      const d=Math.atan2(Math.sin(target-this.cameraStartYaw),Math.cos(target-this.cameraStartYaw));
      this.displayCameraYaw=this.cameraStartYaw+d*t;
    }
    this._animateVehicle(delta);
    if(this.snapshot?.pose.length>=2) this._updateFan({pose:[this.drone.position.x+this.world.width/2,this.world.height/2-this.drone.position.z,this.drone.rotation.y],cameraYaw:this.displayCameraYaw});
    if (this.viewMode === 'fpv') this._updateFpvCamera();
    if(this.ghost)this.ghost.visible=this.viewMode!=='fpv';
    if(this.drone?.userData.gimbal)this.drone.userData.gimbal.visible=this.viewMode!=='fpv';
    if (this.controls.enabled) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Render the onboard optical sensor from true world geometry.
   *
   * The returned rows are top-left origin (the WebGL readback is bottom-left)
   * and the packed depth uses the same projection as the RGB pass, allowing
   * sensor-camera.js to unproject a pixel back into planner coordinates.
   */
  captureSensor(pose, yaw, recycled = {}, config = undefined) {
    if (this._disposed) throw new Error('DemoRenderer is disposed');
    if (config === undefined && recycled && typeof recycled === 'object' &&
      (recycled.horizontalFov !== undefined || recycled.sensingRange !== undefined || recycled.downwardPitch !== undefined)) {
      config = recycled;
      recycled = {};
    }
    if (config !== undefined) this.setSensorConfig(config);
    const width = SENSOR.width;
    const height = SENSOR.height;
    const byteLength = width * height * 4;
    const validBuffer = (value) => {
      if (value instanceof Uint8Array && value.length === byteLength) return value;
      // The worker returns the transferred ArrayBuffer itself for the next
      // frame.  Re-wrap it in place so the caller's storage is still reused.
      if (value instanceof ArrayBuffer && value.byteLength === byteLength) return new Uint8Array(value);
      return null;
    };
    let rgba = validBuffer(recycled?.rgba) || new Uint8Array(byteLength);
    let depth = validBuffer(recycled?.depth) || new Uint8Array(byteLength);
    const bottomUp = this._sensorBottomUpReadBuffer;
    // Aliased output buffers cannot be flipped independently.  Preserve the
    // caller's valid RGB buffer and give depth a separate storage in that
    // unusual case.
    if (rgba === depth || rgba === bottomUp) rgba = new Uint8Array(byteLength);
    if (depth === bottomUp) depth = new Uint8Array(byteLength);

    const values = arrayLike(pose);
    const x = finite(values[0]);
    const y = finite(values[1]);
    const heading = finite(yaw, finite(values[2]));
    const altitude = this._flightAltitude();
    const pitch = this.sensorConfig.pitch;
    const cosPitch = Math.cos(pitch);
    const direction = new THREE.Vector3(
      Math.cos(heading) * cosPitch,
      -Math.sin(pitch),
      -Math.sin(heading) * cosPitch,
    );
    this.sensorCamera.position.set(
      x - positive(this.world?.width, 220) / 2,
      altitude,
      positive(this.world?.height, 180) / 2 - y,
    );
    this.sensorCamera.lookAt(this.sensorCamera.position.x + direction.x,
      this.sensorCamera.position.y + direction.y,
      this.sensorCamera.position.z + direction.z);
    this.sensorCamera.updateProjectionMatrix();
    this.sensorCamera.updateMatrixWorld(true);

    const viewProjection = new THREE.Matrix4().multiplyMatrices(
      this.sensorCamera.projectionMatrix,
      this.sensorCamera.matrixWorldInverse,
    );
    const inverseViewProjection = Array.from(viewProjection.invert().elements);
    const target = this.sensorRenderTarget;
    const renderer = this.renderer;
    const previousTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
    const previousSensorColorSpace = target.texture.colorSpace;
    const previousBackground = this.scene.background;
    const previousFog = this.scene.fog;
    const previousOverride = this.scene.overrideMaterial;
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = new THREE.Color();
    renderer.getClearColor(previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha();
    const hiddenGroups = [this.zoneGroup, this.markerGroup, this.pathGroup, this.flightGroup];
    const groupVisibility = hiddenGroups.map((group) => group?.visible);
    const graphics = [this.worldBorder, this.planningGrid];
    const graphicsVisibility = graphics.map((object) => object?.visible);
    const sceneryVisibility = this.sceneryGroup?.visible;
    const crowdVisibility = this.crowdVisuals.map((object) => object.visible);
    const previousFogEnabled = this.knowledgeFog?.enabled?.value;
    const flipTopLeft = (destination) => {
      const rowLength = width * 4;
      for (let row = 0; row < height; row += 1) {
        const sourceOffset = (height - 1 - row) * rowLength;
        destination.set(bottomUp.subarray(sourceOffset, sourceOffset + rowLength), row * rowLength);
      }
    };

    try {
      hiddenGroups.forEach((group) => { if (group) group.visible = false; });
      graphics.forEach((object) => { if (object) object.visible = false; });
      if (this.sceneryGroup) this.sceneryGroup.visible = true;
      // Crowd meshes are physical scenery, although the map view hides them
      // until their semantic zone has been observed.
      this.crowdVisuals.forEach((object) => { object.visible = true; });
      if (this.knowledgeFog?.enabled) this.knowledgeFog.enabled.value = 0;
      this.scene.fog = null;
      this.scene.overrideMaterial = null;
      renderer.autoClear = true;
      // Three keeps non-XR render targets in the working (linear) color
      // space.  Keep the shared target linear for the packed depth pass and
      // encode the RGB readback below to the sRGB bytes expected by Canvas and
      // the live feature detector.
      target.texture.colorSpace = THREE.NoColorSpace;
      renderer.setRenderTarget(null);
      renderer.setRenderTarget(target);

      // RGB pass: retain the authored sky background while rendering terrain
      // and physical scenery with their ordinary materials/lights.
      this.scene.background = previousBackground;
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.clear(true, true, true);
      renderer.render(this.scene, this.sensorCamera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, bottomUp);
      flipTopLeft(rgba);
      for (let index = 0; index < byteLength; index += 4) {
        rgba[index] = LINEAR_TO_SRGB[rgba[index]];
        rgba[index + 1] = LINEAR_TO_SRGB[rgba[index + 1]];
        rgba[index + 2] = LINEAR_TO_SRGB[rgba[index + 2]];
      }

      // Depth pass: MeshDepthMaterial packs normalized camera depth in RGBA;
      // a white scene background represents pixels beyond SENSOR.far.
      // Packed bytes are data rather than display color, so keep this pass in
      // the linear/no-color-space target even though RGB uses sRGB output.
      target.texture.colorSpace = THREE.NoColorSpace;
      // Rebind after changing the target metadata so Three refreshes its
      // output-color-space state before compiling the depth material.
      renderer.setRenderTarget(null);
      renderer.setRenderTarget(target);
      this.scene.background = this._sensorWhiteBackground;
      this.scene.overrideMaterial = this.sensorDepthMaterial;
      renderer.setClearColor(this._sensorWhiteBackground, 1);
      renderer.clear(true, true, true);
      renderer.render(this.scene, this.sensorCamera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, bottomUp);
      flipTopLeft(depth);
    } finally {
      this.scene.overrideMaterial = previousOverride;
      this.scene.background = previousBackground;
      this.scene.fog = previousFog;
      if (this.knowledgeFog?.enabled && previousFogEnabled !== undefined) this.knowledgeFog.enabled.value = previousFogEnabled;
      hiddenGroups.forEach((group, index) => { if (group) group.visible = groupVisibility[index]; });
      graphics.forEach((object, index) => { if (object) object.visible = graphicsVisibility[index]; });
      if (this.sceneryGroup) this.sceneryGroup.visible = sceneryVisibility;
      this.crowdVisuals.forEach((object, index) => { object.visible = crowdVisibility[index]; });
      renderer.autoClear = previousAutoClear;
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      target.texture.colorSpace = previousSensorColorSpace;
      renderer.setRenderTarget(previousTarget);
    }
    return { rgba, depth, width, height, inverseViewProjection };
  }

  _inspectAt(event) {
    if (this._pointerDown) {
      const moved = Math.hypot(event.clientX - this._pointerDown.x, event.clientY - this._pointerDown.y);
      if (moved > 5) return;
    }
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([this.markerGroup, this.zoneGroup, this.sceneryGroup], true);
    const hit = hits.find((item) => {
      if (!(item.object?.userData?.type || item.object?.parent?.userData?.type)) return false;
      let parent = item.object;
      while (parent) { if (!parent.visible) return false; parent = parent.parent; }
      const data = item.object.userData?.type ? item.object.userData : item.object.parent?.userData;
      if (this.knowledgeView && ['building','watercourse'].includes(data.type)) {
        const k = this.knowledge;
        const x = item.point.x + this.world.width / 2, y = this.world.height / 2 - item.point.z;
        if (!k?.observed[Math.floor(y / k.cellSize) * k.width + Math.floor(x / k.cellSize)]) return false;
      }
      return true;
    });
    if (!hit) return;
    const data = hit.object.userData?.type ? hit.object.userData : hit.object.parent?.userData;
    if (data) this.onInspect({ title: data.title || data.id || 'Scene object', description: data.description || 'Procedural planning object.' });
  }

  getDiagnostics() {
    const info = this.renderer?.info;
    return {
      world: this.world?.id || 'none',
      objects: this.scene?.children?.length || 0,
      drawCalls: info?.render?.calls || 0,
      triangles: info?.render?.triangles || 0,
      geometries: info?.memory?.geometries || 0,
      textures: info?.memory?.textures || 0,
      mappedFeatures: this.featurePoints?.geometry?.drawRange?.count || 0,
      landmarksVisible: this.landmarkVisuals.filter((item) => item.group.visible).length,
      zonesVisible: this.zoneVisuals.filter((item) => item.outline.visible).length,
      knowledgeView: this.knowledgeView,
      lastTime: this._lastTime,
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('click', this._onClick);
    window.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    if (this._animationFrame && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(this._animationFrame);
    this._clearObject(this.worldGroup);
    this._disposeOwned();
    this.sensorDepthMaterial?.dispose();
    this.sensorRenderTarget?.dispose();
    this._sensorBottomUpReadBuffer = null;
    this.renderer.dispose();
  }
}

export default DemoRenderer;
