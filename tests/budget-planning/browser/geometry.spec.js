import { test, expect } from '@playwright/test';

test('terrain, sensing volume, knowledge visibility and persistent markers agree', async ({ page }) => {
  await page.route('**/assets/budget-planning/app.js', route => route.abort());
  await page.goto('/budget-planning.html');
  const result = await page.evaluate(async () => {
    const { DemoRenderer } = await import('/assets/budget-planning/renderer.js');
    const { createWorld, terrainHeight } = await import('/assets/budget-planning/worlds.js');
    const { Simulation } = await import('/assets/budget-planning/simulation.js');
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    try {
      const desert = createWorld('tucson'); renderer.setWorld(desert);
      const vertices = renderer.terrain.geometry.attributes.position;
      let terrainError = 0;
      for (let i=0;i<vertices.count;i++) {
        terrainError=Math.max(terrainError,Math.abs(vertices.getY(i)-terrainHeight(desert,vertices.getX(i)+desert.width/2,-vertices.getZ(i)+desert.height/2)));
      }
      const simulation = new Simulation('ann-arbor');renderer.setWorld(simulation.world);
      const original = simulation.snapshot();renderer.update(original);renderer.setKnowledgeView(true);
      const hiddenStadium = !renderer.landmarkVisuals.find(v=>v.id==='annarbor-stadium').group.visible;
      const homeMarker = renderer.landmarkVisuals.find(v=>v.id==='annarbor-ford');
      const homeBadge = { visible:homeMarker.group.visible,role:homeMarker.role,
        title:homeMarker.label.userData.badge.label,linked:renderer.landmarkObjects.has('annarbor-ford') };
      const markerGroundError = Math.max(...renderer.landmarkVisuals.map(v=>
        Math.abs(v.group.position.y-terrainHeight(simulation.world,v.landmark.x,v.landmark.y)-.15)));
      const hiddenZone = !renderer.zoneVisuals.find(v=>v.id==='stadium-crowd').outline.visible;
      const visibleKnownVolumes = renderer.zoneVisuals.filter(v=>v.zone.known).every(v=>v.fill.visible&&v.fill.geometry.parameters.height>simulation.world.altitude);
      const initialMapped = renderer.featurePointGeometry.drawRange.count;
      const storedMarkers = Array.from(renderer.featurePointGeometry.attributes.position.array.slice(0,initialMapped*3));
      // Mirror the actual ACK transfer: toggles must survive detached buffers.
      structuredClone(original.knowledge.cells,{transfer:[original.knowledge.cells.buffer]});
      structuredClone(original.knowledge.observed,{transfer:[original.knowledge.observed.buffer]});
      renderer.setKnowledgeView(false);renderer.setKnowledgeView(true);
      const persistence = storedMarkers.every((v,i)=>v===renderer.featurePointGeometry.attributes.position.array[i]);
      const position = renderer.drone.position;
      const apex = renderer.cameraFanSides.geometry.attributes.position.array;
      const cameraConnected = [position.x,position.y,position.z].every((v,i)=>Math.abs(v-apex[i])<1e-5);
      const snapshot=simulation.snapshot();snapshot.pose=[90,55,.7];snapshot.cameraYaw=1.1;
      renderer.update(snapshot);
      const yawError=Math.abs(renderer.drone.userData.targetYaw-.7);
      return {terrainError,hiddenStadium,homeBadge,markerGroundError,hiddenZone,visibleKnownVolumes,initialMapped,persistence,cameraConnected,yawError};
    } finally {renderer.dispose();}
  });
  expect(result.terrainError).toBeLessThan(1e-4);
  expect(result.hiddenStadium).toBe(true);expect(result.hiddenZone).toBe(true);
  expect(result.homeBadge).toEqual({visible:true,role:'home',title:'Ford Robotics Building',linked:true});
  expect(result.markerGroundError).toBeLessThan(1e-6);
  expect(result.visibleKnownVolumes).toBe(true);expect(result.initialMapped).toBeGreaterThan(0);
  expect(result.persistence).toBe(true);expect(result.cameraConnected).toBe(true);expect(result.yawError).toBeLessThan(1e-8);
});

test('sensor fan ground footprint follows downward pitch and optical range', async ({ page }) => {
  await page.route('**/assets/budget-planning/app.js', route => route.abort());
  await page.goto('/budget-planning.html');
  const result = await page.evaluate(async () => {
    const { DemoRenderer } = await import('/assets/budget-planning/renderer.js');
    const { createWorld, terrainHeight } = await import('/assets/budget-planning/worlds.js');
    const { inFov } = await import('/assets/budget-planning/knowledge.js');
    const { inSensorImage } = await import('/assets/budget-planning/sensor-camera.js');
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    try {
      const world = createWorld('farm');
      renderer.setWorld(world);
      const pose = [110, 90, 0];
      const readFootprint = (config) => {
        renderer.setSensorConfig(config);
        renderer._updateFan({ pose, cameraYaw: 0 });
        const points = renderer.cameraFan.geometry.attributes.position.array;
        const ringCount = 33;
        const rings = [[], []];
        const invalidRings = [];
        for (let ring = 0; ring < 2; ring += 1) {
          const start = ring * ringCount * 3;
          for (let index = 0; index < ringCount; index += 1) {
            const offset = start + index * 3;
            const x = points[offset] + world.width / 2;
            const y = world.height / 2 - points[offset + 2];
            const ground = { x, y, z: terrainHeight(world, x, y) };
            const valid = inFov(pose, ground, 0, 0, renderer.sensorConfig) &&
              inSensorImage(pose, ground, 0, world.altitude, 0, renderer.sensorConfig);
            rings[ring].push({
              radius: Math.hypot(x - pose[0], y - pose[1]),
              valid,
            });
            if (!valid) {
              const radius = rings[ring][index].radius;
              invalidRings.push({ ring, index, radius, x, y });
            }
          }
        }
        let samples = 0;
        let validSamples = 0;
        const fanHalfAngle = renderer.sensorConfig.horizontalFovRadians / 2 - 1e-4;
        for (let index = 0; index < ringCount; index += 1) {
          const relativeAngle = -fanHalfAngle + 2 * fanHalfAngle * index / (ringCount - 1);
          for (const fraction of [0, .25, .5, .75, 1]) {
            const radius = rings[0][index].radius + (rings[1][index].radius - rings[0][index].radius) * fraction;
            const ground = {
              x: pose[0] + Math.cos(relativeAngle) * radius,
              y: pose[1] + Math.sin(relativeAngle) * radius,
            };
            ground.z = terrainHeight(world, ground.x, ground.y);
            samples += 1;
            const valid = inFov(pose, ground, 0, 0, renderer.sensorConfig) &&
              inSensorImage(pose, ground, 0, world.altitude, 0, renderer.sensorConfig);
            if (valid) validSamples += 1;
          }
        }
        return { rings, samples, validSamples, invalidRings };
      };
      const shallow = readFootprint({ horizontalFov: 90, sensingRange: 100, downwardPitch: 35 });
      const steep = readFootprint({ horizontalFov: 90, sensingRange: 100, downwardPitch: 75 });
      const wide = readFootprint({ horizontalFov: 120, sensingRange: 100, downwardPitch: 75 });
      const narrow = readFootprint({ horizontalFov: 60, sensingRange: 40, downwardPitch: 35 });
      return { shallow, steep, wide, narrow, configuredRange: renderer.sensorConfig.range };
    } finally { renderer.dispose(); }
  });
  expect(result.configuredRange).toBe(40);
  expect(result.shallow.rings[0].every((point) => point.radius)).toBe(true);
  expect(Math.min(...result.shallow.rings[0].map((point) => point.radius))).toBeGreaterThan(8);
  expect(Math.max(...result.shallow.rings[1].map((point) => point.radius))).toBeCloseTo(100, 0);
  expect(Math.min(...result.steep.rings[0].map((point) => point.radius))).toBeLessThan(.1);
  expect(Math.max(...result.steep.rings[1].map((point) => point.radius))).toBeLessThan(
    Math.max(...result.shallow.rings[1].map((point) => point.radius)),
  );
  expect(result.shallow.rings.flat().every((point) => point.valid), JSON.stringify(result.shallow.invalidRings)).toBe(true);
  expect(result.steep.rings.flat().every((point) => point.valid), JSON.stringify(result.steep.invalidRings)).toBe(true);
  expect(result.shallow.validSamples).toBe(result.shallow.samples);
  expect(result.steep.validSamples).toBe(result.steep.samples);
  expect(result.wide.rings.flat().every((point) => point.valid), JSON.stringify(result.wide.invalidRings)).toBe(true);
  expect(result.wide.validSamples).toBe(result.wide.samples);
  expect(result.narrow.rings.flat().every((point) => point.valid), JSON.stringify(result.narrow.invalidRings)).toBe(true);
  expect(result.narrow.validSamples).toBe(result.narrow.samples);
});

test('airframe banks smoothly with a level nose and presentation never changes the mission', async ({ page }) => {
  await page.route('**/assets/budget-planning/app.js', route => route.abort());
  await page.goto('/budget-planning.html');
  const result = await page.evaluate(async () => {
    const { DemoRenderer } = await import('/assets/budget-planning/renderer.js');
    const { Simulation } = await import('/assets/budget-planning/simulation.js');
    const THREE = await import('/assets/budget-planning/vendor/three.module.js');
    const simulation = new Simulation('farm');
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    try {
      renderer.setWorld(simulation.world); renderer.update(simulation.snapshot());
      const original = JSON.stringify(simulation.pose);
      const airframe = renderer.drone.userData.airframe;
      renderer._updateDrone(renderer.drone, [45, 65, 1.2]);
      const before = airframe.rotation.x, target = renderer.drone.userData.targetRoll;
      renderer._animateVehicle(.016);
      const first = airframe.rotation.x;
      let maxPitch = 0;
      for (let i=0;i<90;i++) {
        renderer._animateVehicle(.016); renderer.drone.updateMatrixWorld(true);
        const direction = new THREE.Vector3(1,0,0).applyQuaternion(airframe.getWorldQuaternion(new THREE.Quaternion()));
        maxPitch = Math.max(maxPitch, Math.abs(direction.y));
      }
      const settled = airframe.rotation.x;
      renderer.setKnowledgeView(true); renderer.setTopDown(); renderer.render();
      const fog = renderer.knowledgeFog;
      const observedPixels = fog.texture.image.data.filter(v=>v===255).length;
      const unseenCells = fog.texture.image.data.filter(v=>v===0).length;
      return { before, target, first, settled, maxPitch, observedPixels, unseenCells,
        fogEnabled: fog.enabled.value, materialFog: !!renderer.terrainMaterial.onBeforeCompile,
        unchanged: original === JSON.stringify(simulation.pose),
        featurePixels: renderer.featurePoints.material.size,
        featureSizeAttenuation: renderer.featurePoints.material.sizeAttenuation,
        lineWidth: renderer.paths.committed.material.uniforms.linewidth.value,
        lineMesh: renderer.paths.committed.object.isMesh,
      };
    } finally { renderer.dispose(); }
  });
  expect(result.maxPitch).toBeLessThan(1e-10);
  expect(result.first).not.toBe(result.before);
  expect(Math.abs(result.first-result.before)).toBeLessThan(.04);
  expect(Math.abs(result.first-result.target)).toBeGreaterThan(.2);
  expect(Math.abs(result.settled-result.target)).toBeLessThan(.005);
  expect(result.unchanged).toBe(true);
  expect(result.fogEnabled).toBe(1); expect(result.observedPixels).toBeGreaterThan(0); expect(result.unseenCells).toBeGreaterThan(1000);
  expect(result.featurePixels).toBeGreaterThanOrEqual(7); expect(result.featureSizeAttenuation).toBe(false);
  expect(result.lineMesh).toBe(true); expect(result.lineWidth).toBeGreaterThanOrEqual(5);
});

test('authored buildings and cactus geometry stay aligned with world truth', async ({ page }) => {
  await page.route('**/assets/budget-planning/app.js', route => route.abort());
  await page.goto('/budget-planning.html');
  const result = await page.evaluate(async () => {
    const { DemoRenderer } = await import('/assets/budget-planning/renderer.js');
    const { createWorld, terrainHeight } = await import('/assets/budget-planning/worlds.js');
    const THREE = await import('/assets/budget-planning/vendor/three.module.js');
    const renderer = new DemoRenderer(document.querySelector('#scene-canvas'));
    try {
      const world=createWorld('ann-arbor');renderer.setWorld(world);renderer.scene.updateMatrixWorld(true);
      const stadium=renderer.sceneryGroup.getObjectByName('michigan-stadium');
      const field=stadium.getObjectByName('stadium-field-surface');
      const attr=field.geometry.attributes.position;
      let fieldBurial=-Infinity;
      for(let i=0;i<attr.count;i++) {
        if(attr.getY(i)<0)continue;
        const p=new THREE.Vector3().fromBufferAttribute(attr,i).applyMatrix4(field.matrixWorld);
        fieldBurial=Math.max(fieldBurial,terrainHeight(world,p.x+world.width/2,world.height/2-p.z)-p.y);
      }
      const pad=renderer.sceneryGroup.getObjectByName('medical-center-helipad-H');
      const padPoint=pad.getWorldPosition(new THREE.Vector3()),landmark=world.landmarks.find(l=>l.kind==='helipad');
      const padError=Math.hypot(padPoint.x-(landmark.x-world.width/2),padPoint.z-(world.height/2-landmark.y),padPoint.y-(landmark.z-.12));
      const river=Boolean(renderer.sceneryGroup.getObjectByName('huron-river'));
      renderer.setWorld(createWorld('tucson'));
      const cacti=renderer.sceneryGroup.getObjectByName('feature-cacti');cacti.geometry.computeBoundingBox();
      const bounds=cacti.geometry.boundingBox;
      return { fieldBurial,padError,river,fieldRatio:field.userData.dimensions.ratio,
        cactusWidth:bounds.max.x-bounds.min.x,cactusHeight:bounds.max.y-bounds.min.y,
        cactusInstanced:cacti.isInstancedMesh,cactusVertexColors:cacti.material.vertexColors };
    } finally { renderer.dispose(); }
  });
  expect(result.fieldBurial).toBeLessThan(0);
  expect(result.padError).toBeLessThan(.15);
  expect(result.river).toBe(true);
  expect(result.fieldRatio).toBeCloseTo(120/53.3,6);
  expect(result.cactusWidth).toBeGreaterThan(.5);expect(result.cactusHeight).toBeCloseTo(1,6);
  expect(result.cactusInstanced).toBe(true);expect(result.cactusVertexColors).toBe(false);
});
