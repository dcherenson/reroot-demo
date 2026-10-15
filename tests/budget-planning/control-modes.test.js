import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, validateConfig } from '../../assets/budget-planning/simulation.js';

const observation=shared=>({newAnchors:[],visible:[],shared,metrics:{shared},keypoints:new Float32Array()});
function nominal(config={}) {
  const s=new Simulation('farm',{...config,gatekeeper:false},1337,{pixelFeatures:true});
  s.acceptSensor(observation(30));
  return s;
}

test('nominal-only starts directly without growing or querying a backup forest',()=>{
  const s=nominal();
  assert.equal(s.phase,'nominal');
  assert.equal(s.forest.nodeCount,0);
  assert.equal(s.committed.rootId,'farm-goal');
  assert.ok(s.committed.nominalPaths[0].length>100);
  assert.deepEqual(s.committed.backupPaths,[]);
  s.committed=null;
  s.evaluate=()=>{throw new Error('baseline must not call the safety gate');};
  s.validateController=()=>{throw new Error('baseline must not gate controller rollouts');};
  s.forest.query=()=>{throw new Error('baseline must not query backups');};
  s.plan();
  assert.ok(s.committed);
  assert.equal(s.snapshot().gatekeeper,false);
  assert.throws(()=>validateConfig({gatekeeper:'false'}),/boolean/);
});

test('nominal-only still fails and freezes on measured feature loss',()=>{
  const s=nominal({minFeatures:6});
  s.knowledge.visibleLandmarks=()=>[];
  assert.equal(s.advance(),true);
  assert.equal(s.acceptSensor(observation(5)),false);
  assert.deepEqual(s.failure,{kind:'features',actual:5,limit:6,time:.2});
  const stopped=[...s.pose];
  assert.equal(s.advance(),false);
  assert.deepEqual(s.pose,stopped);
  assert.match(s.fault,/feature overlap/);
});

test('the measured feature threshold is inclusive and landmark locks replace odometry',()=>{
  const s=nominal({minFeatures:6});
  s.knowledge.visibleLandmarks=()=>[];
  s.advance();s.acceptSensor(observation(6));
  assert.equal(s.fault,null);
  assert.ok(s.budget>0);
  s.knowledge.visibleLandmarks=()=>[s.world.landmarks[0]];
  s.advance();s.acceptSensor(observation(0));
  assert.equal(s.fault,null);
  assert.equal(s.budget,0);
});

test('budget violations are reported at the integration substep and cannot be reset away',()=>{
  const s=nominal({budget:1});
  s.error=[.99,0];s.errorDirection=0;s.budget=.99;
  assert.equal(s.advance(),false);
  assert.equal(s.failure.kind,'budget');
  assert.equal(s.failure.limit,1);
  assert.ok(s.failure.actual>1);
  assert.ok(s.time>0&&s.time<.2);
  assert.equal(s.failure.time,s.time);
  assert.equal(s.budget,s.failure.actual);
  assert.equal(s.pendingSensor,null);
});

test('nominal-only detects physical obstacle or no-fly-zone entry',()=>{
  const s=nominal();
  const zone=s.world.zones[0];
  s.pose=[zone.x,zone.y,0];s.estimate=[...s.pose];
  assert.equal(s.advance(),false);
  assert.equal(s.failure.kind,'collision');
  assert.match(s.fault,/obstacle or restriction/);
});

test('FOV uncertainty follows predicted drift rather than the allowed budget ceiling',()=>{
  const margins=[];
  for(const cap of [5,10]) {
    const s=new Simulation('farm',{budget:cap},1337,{pixelFeatures:true});
    s.knowledge.safe=()=>true;
    let frame=0;
    s.knowledge.visibleLandmarks=(pose,yaw,margin)=>{margins.push(margin);return frame++===0?[s.world.landmarks[0]]:[];};
    s.knowledge.visibleFeatures=()=>Array.from({length:20},(_,i)=>i);
    const path={start:[100,100,0],end:[104,100,0],radius:10,length:4,types:['L','S','L'],lengths:[0,4,0]};
    const checked=s.evaluate([path],1);
    assert.equal(checked.safe,true);
    assert.ok(Math.abs(checked.endBudget-.06)<1e-10);
    assert.ok(Math.abs(checked.peakBudget-1.06)<1e-10);
  }
  assert.deepEqual(margins.slice(0,2),margins.slice(2));
  assert.ok(margins[1]<margins[0],'a real predicted landmark observation reduces the subsequent uncertainty margin');
});

test('gatekeeper mode also reports a real measured feature violation',()=>{
  const s=new Simulation('farm',{},1337,{pixelFeatures:true});
  s.acceptSensor(observation(30));
  s.knowledge.visibleLandmarks=()=>[];
  s.advance();s.acceptSensor(observation(0));
  assert.equal(s.failure.kind,'features');
  assert.equal(s.failure.actual,0);
  assert.equal(s.snapshot().gatekeeper,true);
  assert.equal(s.phase,'fault');
});
