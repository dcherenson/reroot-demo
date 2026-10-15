import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../assets/budget-planning/vendor/three.module.js';
import { createLandmarkModel } from '../../assets/budget-planning/landmark-models.js';
import { createWorld, surfaceHeight, terrainHeight } from '../../assets/budget-planning/worlds.js';
import { Simulation } from '../../assets/budget-planning/simulation.js';

test('physical landmark meshes are grounded and stay inside the sensed geometry bounds',()=>{
  for(const id of ['farm','tucson','ann-arbor'])for(const object of createWorld(id).objects){
    const model=createLandmarkModel(object);
    if(!model)continue;
    const box=new THREE.Box3().setFromObject(model);
    assert.ok(Math.abs(box.min.y)<.02,`${object.id} must sit on its terrain surface`);
    assert.ok(box.max.y<=object.height+1e-5,`${object.id} exceeds its modeled height`);
    assert.ok(Math.max(Math.abs(box.min.x),Math.abs(box.max.x))<=object.width/2+1e-5);
    assert.ok(Math.max(Math.abs(box.min.z),Math.abs(box.max.z))<=object.depth/2+1e-5);
    const resources=new Set();
    model.traverse(part=>{if(part.geometry)resources.add(part.geometry);if(part.material)resources.add(part.material);});
    resources.forEach(resource=>resource.dispose());
  }
});

test('goal renewal corridors can be surveyed without declaring hidden ground beneath buildings free',()=>{
  for(const id of ['farm','tucson','ann-arbor']){
    const s=new Simulation(id,{},1337,{pixelFeatures:true}),k=s.knowledge,w=s.world;
    // Ideal completed ground survey: retain unknown cells beneath structures.
    // This catches a goal orbit intersecting the footprint of its own landmark
    // or a neighboring building, even though the flight altitude clears it.
    k.cells.fill(1);
    for(let y=0;y<k.height;y++)for(let x=0;x<k.width;x++){
      const px=x*2+1,py=y*2+1;
      if(surfaceHeight(w,px,py)>terrainHeight(w,px,py)+.5)k.cells[y*k.width+x]=0;
    }
    k.discovered=new Set(w.landmarks.map(l=>l.id));
    k.knownZones=new Set(w.zones.map(z=>z.id));k.refreshForbidden();
    assert.equal(k.certifyOrbit(w.landmarks.at(-1)),true,`${id} goal orbit must have a surveyable exterior corridor`);
  }
});
