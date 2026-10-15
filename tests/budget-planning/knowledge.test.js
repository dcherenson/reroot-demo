import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../assets/budget-planning/worlds.js';
import { Knowledge, inFov, UNKNOWN, FORBIDDEN, SURVEYED, CELL } from '../../assets/budget-planning/knowledge.js';
import { DEFAULTS, Simulation } from '../../assets/budget-planning/simulation.js';

test('robust footprint is contained in the actual camera footprint',()=>{
  const p=[50,50,.4], yaw=.4;
  for(let x=0;x<150;x+=2)for(let y=0;y<150;y+=2)if(inFov(p,{x,y},yaw,5)) {
    for(let i=0;i<16;i++){const a=i/16*Math.PI*2;assert.ok(inFov([p[0]+5*Math.cos(a),p[1]+5*Math.sin(a),p[2]],{x,y},yaw));}
  }
  assert.equal(inFov(p,{x:50,y:50},yaw,40),false);
});

test('stadium restriction and landmark stay unknown until actual sensing',()=>{
 const w=createWorld('ann-arbor'),k=new Knowledge(w,DEFAULTS);k.surveyHome();
 assert.equal(k.knownZones.has('stadium-crowd'),false);
 assert.equal(k.discovered.has('annarbor-stadium'),false);
 assert.equal(k.safe(155,105),false);
 assert.equal(k.mapped.reduce((a,b)=>a+b,0),0);
 const version=k.version; const sensed=k.sense([110,105,0],0);
 assert.ok(sensed.discoveredZones.includes('stadium-crowd'));
 assert.ok(k.knownZones.has('stadium-crowd'));
 assert.equal(k.cells[Math.floor(105/CELL)*k.width+Math.floor(155/CELL)],FORBIDDEN);
 assert.ok(k.version>version);
 assert.equal(k.safe(155,105),false);
 assert.equal(k.certifyOrbit(w.landmarks.find(l=>l.id==='annarbor-stadium')),false,'recognition alone is not a safe orbit');
 const n=k.mapCount; assert.ok(n>0);
 k.sense([110,105,Math.PI],Math.PI);assert.ok(k.mapCount>=n,'mapped markers persist outside the FOV');
});

test('only home is surveyed initially; unknown orbit corridors are rejected',()=>{
 const w=createWorld('farm'),k=new Knowledge(w,DEFAULTS);k.surveyHome();
 assert.ok(k.cells.includes(SURVEYED));assert.ok(k.cells.includes(UNKNOWN));
 assert.ok(k.certifyOrbit(w.landmarks[0]));
 assert.equal(k.certifyOrbit(w.landmarks.at(-1)),false);
 k.discovered.add(w.landmarks.at(-1).id);assert.equal(k.certifyOrbit(w.landmarks.at(-1)),false);
});

test('visual observation does not confuse a known restriction with observed scenery',()=>{
 const w=createWorld('farm'),k=new Knowledge(w,DEFAULTS);k.surveyHome();
 const zone=w.zones[0],index=Math.floor(zone.y/CELL)*k.width+Math.floor(zone.x/CELL);
 assert.equal(k.cells[index],FORBIDDEN);assert.equal(k.observed[index],0);
 const version=k.version;
 k.sense([zone.x-25,zone.y,0],0);
 assert.equal(k.observed[index],1,'camera observation clears visual fog');
 assert.equal(k.cells[index],FORBIDDEN,'seeing the ground never authorizes flight');
 assert.ok(k.version>=version);
});

test('the medical-campus helipad is discovered by a real rooftop observation',()=>{
 const w=createWorld('ann-arbor'),k=new Knowledge(w,DEFAULTS);k.surveyHome();
 const pad=w.landmarks.find(l=>l.kind==='helipad');
 assert.equal(k.discovered.has(pad.id),false);
 assert.equal(k.certifyOrbit(pad),false);
 const result=k.sense([pad.x-35,pad.y,0],0);
 assert.ok(result.newLandmarks.includes(pad.id));
 const index=Math.floor(pad.y/CELL)*k.width+Math.floor(pad.x/CELL);
 assert.equal(k.observed[index],1);
});

test('identical seeds and settings give identical executed sensor/planner states',()=>{
 const a=new Simulation('farm'),b=new Simulation('farm');
 for(let i=0;i<8;i++){a.advance();b.advance();}
 assert.deepEqual(a.pose,b.pose);assert.deepEqual(a.estimate,b.estimate);
 assert.equal(a.budget,b.budget);assert.deepEqual(a.knowledge.cells,b.knowledge.cells);
 assert.deepEqual(a.forest.nodes.map(n=>n.parentIndex),b.forest.nodes.map(n=>n.parentIndex));
});
