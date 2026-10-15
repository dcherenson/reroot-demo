import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorld, terrainHeight, inZone, lineOfSight } from '../../assets/budget-planning/worlds.js';
import { DEFAULTS, Simulation } from '../../assets/budget-planning/simulation.js';
import { Knowledge, FORBIDDEN, OBSERVED, CELL } from '../../assets/budget-planning/knowledge.js';
import { shortestPath } from '../../assets/budget-planning/dubins.js';
import { gatekeeper } from '../../assets/budget-planning/planner.js';

function makeControlledFeatureSimulation(minFeatures) {
  const simulation = new Simulation('farm', { minFeatures, speed: 10 }, 1337, { pixelFeatures: true });
  simulation.knowledge.safe = () => true;
  simulation.knowledge.visibleLandmarks = () => [];
  return simulation;
}

test('orbit entry gimbal prioritizes its validated target over a nearer landmark',()=>{
  const simulation=new Simulation('tucson',{},1337,{pixelFeatures:true});
  simulation.world.landmarks=[
    {id:'near',x:8,y:10},{id:'terminal',x:35,y:10,goal:true},
  ];
  simulation.knowledge.discovered=new Set(['near','terminal']);
  simulation.knowledge.orbitRadius=()=>10;
  const pose=[10,10,Math.PI/2];
  assert.equal(simulation.cameraFor(pose,'terminal'),0);
  // A retained trajectory cannot acquire a landmark outside the knowledge
  // frozen when it was validated, even if the live map discovers it later.
  assert.equal(simulation.cameraFor(pose,'terminal',['near']),Math.PI);
  assert.equal(simulation.cameraFor([100,100,.7],'terminal'),.7);
});

test('complete solution validation uses the terminal landmark camera policy',()=>{
  const simulation=new Simulation('farm',{},1337,{pixelFeatures:true});
  simulation.terminalPaths=paths=>paths;
  let options;
  simulation.evaluate=(paths,budget,settings)=>{options=settings;return {safe:true};};
  assert.equal(simulation.validateSolution([],0,'farm-goal').safe,true);
  assert.equal(options.targetId,'farm-goal');
  assert.equal(options.initialCameraYaw,simulation.cameraYaw);
});

test('an occluded stadium does not reveal its crowd restriction', () => {
  const world = createWorld('ann-arbor');
  // A deliberately tall, temporary occluder stands between the camera and the
  // entire stadium envelope.  The camera still has the stadium in its FOV.
  world.objects.push({
    kind: 'building', x: 112, y: 105, width: 30, depth: 100, height: 60,
    rotation: 0, z: terrainHeight(world, 112, 105),
  });
  const knowledge = new Knowledge(world, DEFAULTS);
  const sensed = knowledge.sense([90, 105, 0], 0);

  assert.deepEqual(sensed.discoveredZones, []);
  assert.equal(knowledge.knownZones.has('stadium-crowd'), false);
  assert.equal(knowledge.discovered.has('annarbor-stadium'), false);
});

test('newly discovered forbidden cells win over the same-frame free-space pass', () => {
  const world = createWorld('ann-arbor');
  const crowd = world.zones.find((zone) => zone.id === 'stadium-crowd');
  const knowledge = new Knowledge(world, DEFAULTS);
  const sensed = knowledge.sense([110, 105, 0], 0);
  assert.ok(sensed.discoveredZones.includes(crowd.id));

  for (let gy = 0; gy < knowledge.height; gy += 1) {
    for (let gx = 0; gx < knowledge.width; gx += 1) {
      const x = (gx + 0.5) * CELL;
      const y = (gy + 0.5) * CELL;
      if (inZone(crowd, x, y, 0.01)) assert.equal(knowledge.cells[gy * knowledge.width + gx], FORBIDDEN);
    }
  }
  assert.equal(knowledge.cells[Math.floor(crowd.y / CELL) * knowledge.width + Math.floor(crowd.x / CELL)], FORBIDDEN);
  assert.ok([...knowledge.cells].some((cell) => cell === OBSERVED));
});

test('recognition alone does not grant stadium overflight or a renewal orbit', () => {
  const world = createWorld('ann-arbor');
  const landmark = world.landmarks.find((item) => item.id === 'annarbor-stadium');
  const knowledge = new Knowledge(world, DEFAULTS);
  const sensed = knowledge.sense([110, 105, 0], 0);

  assert.ok(sensed.newLandmarks.includes(landmark.id));
  assert.equal(knowledge.safe(landmark.x, landmark.y), false);
  assert.equal(knowledge.certifyOrbit(landmark), false);
});

test('a fully mapped crowd boundary leaves a certifiable stadium orbit', () => {
  const world = createWorld('ann-arbor');
  const crowd = world.zones.find((zone) => zone.id === 'stadium-crowd');
  const landmark = world.landmarks.find((item) => item.id === 'annarbor-stadium');
  const knowledge = new Knowledge(world, DEFAULTS);
  knowledge.knownZones.add(crowd.id);
  knowledge.refreshForbidden();
  knowledge.discovered.add(landmark.id);
  for (let index = 0; index < knowledge.cells.length; index += 1) {
    if (knowledge.cells[index] === 0) knowledge.cells[index] = OBSERVED;
  }

  assert.equal(knowledge.certifyOrbit(landmark), true);
});

test('line of sight rejects a camera endpoint buried below terrain', () => {
  const world = createWorld('farm');
  const x = 20; const y = 20;
  const buried = [x, y, terrainHeight(world, x, y) - 0.1];
  assert.equal(lineOfSight(world, buried, [x + 5, y, world.altitude]), false);
});

test('a real landmark resets drift while elapsed time alone does not', () => {
  const locked = new Simulation('farm');
  locked.budget = 2;
  assert.equal(locked.advance(), true);
  assert.equal(locked.fault, null);
  assert.equal(locked.budget, 0);

  const drifting = new Simulation('farm');
  drifting.knowledge.discovered.clear();
  // Look away from both home and the newly visible north windmill.
  drifting.cameraYaw = -Math.PI / 2;
  drifting.budget = 2;
  assert.equal(drifting.advance(), true);
  assert.equal(drifting.fault, null);
  assert.ok(drifting.time > 0);
  assert.ok(Math.abs(drifting.budget - 2.06) < 1e-10, '2 m traveled without a landmark must add 3% drift');
});

test('a committed candidate cannot remain tagged with an obsolete map version', () => {
  const simulation = new Simulation('ann-arbor');
  // Stage a previously surveyed approach, independent of stochastic mission
  // progress and scenery density. The east-facing camera has not yet seen the
  // stadium. Its valid geometric backup turns west to the surveyed home orbit.
  for(let i=0;i<simulation.knowledge.cells.length;i++)
    if(simulation.knowledge.cells[i]===0)simulation.knowledge.cells[i]=OBSERVED;
  simulation.pose=[110,105,0];simulation.estimate=[...simulation.pose];simulation.cameraYaw=0;
  const home=simulation.world.landmarks[0];
  const path=shortestPath(simulation.pose,[home.x,home.y-simulation.knowledge.orbitRadius(home),0],10);
  assert.equal(simulation.evaluate([path],0,{collisionOnly:true}).safe,true);
  const previousVersion=simulation.knowledge.version;
  simulation.committed={cameraLandmarkIds:[home.id],nominalPaths:[],backupPaths:[path],
    switchDistance:0,totalLength:path.length,rootId:home.id,mapVersion:previousVersion};
  assert.equal(simulation.knowledge.knownZones.has('stadium-crowd'),false);
  simulation.advance();
  assert.equal(simulation.fault,null);
  assert.equal(simulation.knowledge.knownZones.has('stadium-crowd'),true);
  assert.ok(simulation.knowledge.version>previousVersion);
  assert.ok(!simulation.committed||simulation.committed.mapVersion===simulation.knowledge.version);
});

test('gatekeeper rejects a candidate when the map changes during validation', () => {
  let mapVersion = 4;
  const result = gatekeeper({
    pose: [0, 0, 0],
    nominalPaths: [],
    forest: { query: () => ({ paths: [], rootId: 'home' }) },
    mapVersion,
    getMapVersion: () => mapVersion,
    speed: 10,
    budgetUsed: 0,
    budgetLimit: 5,
    validate: () => {
      mapVersion = 5;
      return { safe: true, peakBudget: 0, endBudget: 0 };
    },
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'stale-map');
});

test('a frame-end landmark observation cannot erase an earlier budget violation', () => {
  const s=new Simulation('farm');
  const p=shortestPath(s.pose,[s.pose[0]+2,s.pose[1],s.pose[2]],s.config.radius);
  const result=s.evaluate([p],s.config.budget-.02,{initialCameraYaw:s.cameraYaw});
  assert.equal(result.safe,false);
  assert.equal(result.reason,'error budget');
});

test('evaluate anchors only its first predicted overlap to the measured preceding image', () => {
  const anchored = makeControlledFeatureSimulation(2);
  anchored.knowledge.visibleFeatures = () => [11, 12];
  const start = [...anchored.estimate];
  const currentPath = shortestPath(start, [start[0] + 4, start[1], start[2]], anchored.config.radius);
  const guarded = anchored.evaluate([currentPath], 0, { initialVisible: [11] });
  assert.equal(guarded.safe, false);
  assert.equal(guarded.reason, 'insufficient shared features');

  // An arbitrary forest edge has no measured frame at its start. With no
  // initialVisible set, its geometric start set remains valid and the edge
  // still evaluates normally.
  const forestEdge = shortestPath([120, 100, 0], [124, 100, 0], anchored.config.radius);
  const geometric = anchored.evaluate([forestEdge], 0);
  assert.equal(geometric.safe, true);

  // Once the first hypothetical frame has passed, later frames use their
  // geometric sets. The second set drops id 11 but still shares id 12 with
  // the first hypothetical set, so a first-frame-only guard must pass.
  const later = makeControlledFeatureSimulation(1);
  let calls = 0;
  later.knowledge.visibleFeatures = () => {
    const sets = [[11, 12], [11, 12], [12]];
    return sets[Math.min(calls++, sets.length - 1)];
  };
  const laterStart = [...later.estimate];
  const laterPath = shortestPath(laterStart, [laterStart[0] + 4, laterStart[1], laterStart[2]], later.config.radius);
  const laterResult = later.evaluate([laterPath], 0, { initialVisible: [11] });
  assert.equal(laterResult.safe, true);
  assert.ok(calls >= 3, 'the first start set and later hypothetical sets should be queried');
});

test('newly learned pixel anchors invalidate cached edge costs even within observed cells',()=>{
 const simulation=new Simulation('farm');
 const path=shortestPath(simulation.pose,[48,55,0],10);
 let calls=0;
 simulation.evaluate=()=>{calls++;return {safe:simulation.knowledge.mapCount>100,cost:1};};
 simulation.knowledge.mapCount=0;
 assert.equal(simulation.edgeCheck(path).safe,false);
 assert.equal(simulation.edgeCheck(path).safe,false);
 assert.equal(calls,1);
 simulation.knowledge.mapCount=101;
 assert.equal(simulation.edgeCheck(path).safe,true);
 assert.equal(calls,2);
});

test('a shorter replan retains a useful validated nominal commitment',()=>{
 const simulation=new Simulation('farm');
 simulation.knowledge.safe=()=>true;
 simulation.evaluate=()=>({safe:true,cost:1,peakBudget:0,endBudget:0});
 simulation.validateSolution=()=>({safe:true,cost:1,peakBudget:0,endBudget:0});
 simulation.validateController=()=>true;
 const originalPath=shortestPath(simulation.pose,[85,55,0],10);
 const original={nominalPaths:[originalPath],backupPaths:[],switchDistance:originalPath.length,
  totalLength:originalPath.length,rootId:'farm-home',mapVersion:simulation.knowledge.version};
 simulation.committed=original;simulation.progress=2;
 simulation.forest.query=pose=>pose[0]<simulation.pose[0]+5?{paths:[],rootId:'farm-home'}:null;
 simulation.plan();
 assert.equal(simulation.committed,original);
 assert.equal(simulation.progress,2);
});
