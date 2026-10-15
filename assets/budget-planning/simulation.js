import { createWorld, worldCollision, inZone } from './worlds.js';
import { validateWorldLayout } from './world-layout.js';
import { shortestPath, samplePaths, prefixPaths, pathLength, curvatureOnPaths, integrate, seededRandom, angleDiff } from './dubins.js';
import { ReRoot, gatekeeper } from './planner.js';
import { Knowledge, CELL } from './knowledge.js';
import { FEATURE_ASSOCIATION_RADIUS, SENSOR_LIMITS, SENSOR_DEFAULTS } from './sensor-camera.js';

export const DEFAULTS = Object.freeze({
  budget: 5,
  minFeatures: 6,
  speed: 10,
  radius: 10,
  gatekeeper: true,
  horizontalFov: SENSOR_DEFAULTS.horizontalFov,
  sensingRange: SENSOR_DEFAULTS.sensingRange,
  downwardPitch: SENSOR_DEFAULTS.downwardPitch,
});
export const LIMITS = Object.freeze({ nodes: 4000, features: 1000, history: 1500, trail: 3000 });
export function validateConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const config = { ...DEFAULTS, ...source };
  for (const [name, lo, hi] of [['budget',1,10], ['minFeatures',1,20], ['speed',5,20], ['radius',5,30]]) {
    if (!Number.isFinite(config[name]) || config[name] < lo || config[name] > hi) throw new Error(`Invalid ${name}: expected ${lo}–${hi}.`);
  }
  for (const [name, bounds] of Object.entries(SENSOR_LIMITS)) {
    if (!Number.isFinite(config[name]) || config[name] < bounds.min || config[name] > bounds.max) {
      throw new Error(`Invalid ${name}: expected ${bounds.min}–${bounds.max}.`);
    }
  }
  config.minFeatures = Math.round(config.minFeatures);
  if(typeof config.gatekeeper!=='boolean')throw new Error('Invalid gatekeeper: expected a boolean.');
  return config;
}
class Ring {
  constructor(capacity, width) { this.data = new Float32Array(capacity * width); this.capacity = capacity; this.width = width; this.count = 0; this.cursor = 0; }
  push(...values) { this.data.set(values, this.cursor * this.width); this.cursor = (this.cursor + 1) % this.capacity; this.count = Math.min(this.count + 1, this.capacity); }
  read() { const out = new Float32Array(this.count * this.width), start = this.count === this.capacity ? this.cursor : 0; for (let i=0;i<this.count;i++) out.set(this.data.subarray(((start+i)%this.capacity)*this.width,((start+i)%this.capacity+1)*this.width),i*this.width); return out; }
}
const overlap = (a,b) => { const seen = new Set(a); let n=0; for(const i of b) if(seen.has(i)) n++; return n; };
const now = () => globalThis.performance?.now() ?? Date.now();

export class Simulation {
  constructor(worldId = 'farm', rawConfig = {}, seed = 1337, {pixelFeatures=false,layout={}}={}) {
    this.pixelFeatures=pixelFeatures;this.initialized=false;this.pendingSensor=null;this.sensorObservation=null;
    this.config = validateConfig(rawConfig); this.world = createWorld(worldId, seed, layout); validateWorldLayout(this.world, this.config); this.seed = seed;
    this.knowledge = new Knowledge(this.world, this.config,{pixelFeatures}); this.knowledge.surveyHome();
    this.rng = seededRandom(seed ^ 0x17ad38); this.errorDirection = this.rng()*Math.PI*2;
    const home = this.world.landmarks[0]; const r = this.knowledge.orbitRadius(home);
    this.pose = [home.x, home.y - r, 0]; this.estimate = [...this.pose]; this.error = [0,0];
    this.cameraYaw = Math.PI/2; this.time = 0; this.tick = 0; this.budget = 0; this.peakError = 0; this.minTracked = Infinity;
    this.featuresTracked = 0; this.active = new Set(); this.phase='initializing'; this.status='Surveying the home orbit'; this.fault=null;this.failure=null;
    this.orbit = { id:home.id, x:home.x,y:home.y,radius:r,direction:1 };
    this.committed = null; this.progress = 0; this.nominalPaths = []; this.commits=0; this.renewals=0; this.successTime=null;this.departedHome=false;
    this.trail = new Ring(LIMITS.trail,4); this.history = new Ring(LIMITS.history,4); this.events=[];
    this.edgeCache = new Map(); this.metrics={planningMs:0,sensingMs:0,growthMs:0,steps:0};
    this.forest = new ReRoot({radius:this.config.radius, seed:seed^0xb65d, maxNodes:LIMITS.nodes,rootReserve:this.world.landmarks.length*4, edgeCheck:p=>this.edgeCheck(p)});
    if(!pixelFeatures)this.acceptSensor();
  }
  acceptSensor(observation=null) {
    this.sensorObservation=observation;
    if(!this.initialized) {
      const home=this.world.landmarks[0];
      const sensed=this.knowledge.sense(this.pose,this.cameraYaw,observation);this.visible=sensed.visible;
      if(this.config.gatekeeper) {
        this.activateOrbits();
        if(!this.active.has(home.id))throw new Error('Home orbit is not safe at these settings.');
        this.forest.grow([home.x,home.y],this.knowledge.sensor.range,100);
      }
      this.phase='orbit';this.status='Home orbit · building a safe route';this.initialized=true;
      if(!this.config.gatekeeper)this.plan();
      this.record();return true;
    }
    if(!this.pendingSensor)throw new Error('Unexpected camera frame.');
    const context=this.pendingSensor;this.pendingSensor=null;
    return this.finishAdvance(context,observation);
  }
  emit(text) { this.events.push({time:this.time,text}); if(this.events.length>12)this.events.shift(); }
  getLandmark(id) { return this.world.landmarks.find(l=>l.id===id); }
  cameraFor(pose, targetId=null, landmarkIds=null) {
    // The gimbal holds a recognized landmark during final approach/loiter. Both
    // prediction and executed sensing use this identical deterministic policy.
    const candidates=this.world.landmarks.filter(l=>landmarkIds?landmarkIds.includes(l.id):this.knowledge.discovered.has(l.id));
    // The final goal approach starts acquisition two seconds before its
    // orbit. Renewal sites keep a short entry region so a nominal departure
    // can look ahead and survey new ground instead of staring back at home.
    const entryTarget=candidates.find(l=>l.id===targetId&&Math.hypot(pose[0]-l.x,pose[1]-l.y)<=Math.min(60,this.knowledge.orbitRadius(l)+(l.goal?2*this.config.speed:6)));
    const nearby=candidates.filter(l=>Math.hypot(pose[0]-l.x,pose[1]-l.y)<=this.knowledge.orbitRadius(l)+6);
    // Overlapping approach regions must not let an earlier-discovered site
    // steal the gimbal from the terminal orbit that this rollout validates.
    const selected=entryTarget||nearby.reduce((best,l)=>!best||Math.hypot(pose[0]-l.x,pose[1]-l.y)<Math.hypot(pose[0]-best.x,pose[1]-best.y)?l:best,null);
    return selected ? Math.atan2(selected.y-pose[1],selected.x-pose[0]) : pose[2];
  }
  slewCamera(current,desired,dt=.2) {
    const delta=angleDiff(current,desired),limit=Math.max(Math.PI,this.config.speed/this.config.radius*1.2)*dt;
    const next=current+Math.max(-limit,Math.min(limit,delta));
    return Math.atan2(Math.sin(next),Math.cos(next));
  }
  activateOrbits() {
    for(const l of this.world.landmarks) if(!this.active.has(l.id)&&this.knowledge.certifyOrbit(l)) {
      const orbit={id:l.id,x:l.x,y:l.y,radius:this.knowledge.orbitRadius(l),direction:1};
      this.forest.addOrbit(orbit); this.active.add(l.id); this.emit(`${l.label}: renewal orbit verified`);
    }
  }
  evaluate(paths, initialBudget=0, {collisionOnly=false, conservative=false, targetId=null,initialCameraYaw=null,initialVisible=null}={}) {
    const length=pathLength(paths); if(!Number.isFinite(length))return {safe:false,cost:Infinity,reason:'path'};
    if(!length)return {safe:true,cost:0,peakBudget:initialBudget,endBudget:initialBudget};
    let budget=initialBudget,peak=budget,cost=0;
    const step=this.config.speed*.2;
    let prev=samplePaths(paths,0),yaw=initialCameraYaw??this.cameraFor(prev,targetId);
    let visible=null;
    // Check buffered swept corridors more finely than the sensor sampling rate.
    for(let s=0;s<=length;s+=1) { const q=samplePaths(paths,Math.min(length,s)); if(!this.knowledge.safe(q[0],q[1]))return {safe:false,cost:Infinity,reason:'unknown or blocked corridor'}; }
    const endpoint=samplePaths(paths,length); if(!this.knowledge.safe(endpoint[0],endpoint[1]))return {safe:false,cost:Infinity,reason:'endpoint'};
    if(collisionOnly)return {safe:true,cost:length*.03,peakBudget:initialBudget+length*.03,endBudget:initialBudget+length*.03};
    for(let s=step;;s+=step) {
      const d=Math.min(s,length),q=samplePaths(paths,d),cy=this.slewCamera(yaw,this.cameraFor(q,targetId),(d-Math.max(0,s-step))/this.config.speed);
      let next=null;
      const previousBudget=budget;
      const increment=(d-Math.max(0,s-step))*.03;
      budget+=increment;peak=Math.max(peak,budget);
      // A measurement at the end of the frame cannot erase an error-budget
      // violation that already occurred while flying toward that observation.
      if(peak>=this.config.budget-1e-8)return {safe:false,cost:Infinity,reason:'error budget',validDistance:Math.max(0,s-step)};
      // Propagate the uncertainty that can actually accumulate since the
      // last renewal. The slider is a limit, not an error already incurred.
      const observed=this.knowledge.visibleLandmarks(q,cy,budget+2,true).length>0;
      if(observed) budget=0;
      else {
        // Persistent image markers represent corners within a 3 m neighborhood.
        // Reserve that association radius in addition to pose/tracking error
        // so a representative at the image edge cannot overstate support.
        const featureAllowance=2+(this.pixelFeatures?FEATURE_ASSOCIATION_RADIUS:0);
        const featureMargin=budget+featureAllowance;
        next=this.knowledge.visibleFeatures(q,cy,featureMargin,true);
        if(visible===null) {
          visible=this.knowledge.visibleFeatures(prev,yaw,previousBudget+featureAllowance,true);
          // A committed rollout starts from the preceding measured image.
          // Historically mapped but absent corners cannot be first-frame matches.
          // Arbitrary forest edges keep their hypothetical geometric start set.
          if(this.pixelFeatures&&s===step&&initialVisible) {
            const measured=new Set(initialVisible);visible=visible.filter(id=>measured.has(id));
          }
        }
        if(overlap(visible,next)<this.config.minFeatures)return {safe:false,cost:Infinity,reason:'insufficient shared features',validDistance:Math.max(0,s-step)};
        cost+=increment;
      }
      prev=q;visible=next;yaw=cy;
      if(d>=length)break;
    }
    return {safe:true,cost,peakBudget:peak,endBudget:budget};
  }
  edgeCheck(path) {
    const k=path.start.map(v=>v.toFixed(3)).join(',')+'|'+path.end.map(v=>v.toFixed(3)).join(',');
    const epoch=`${this.knowledge.version}:${this.knowledge.mapCount}`;
    const cache=this.edgeCache.get(k); if(cache?.epoch===epoch)return cache.result;
    // An edge that exceeds the budget even from zero error cannot belong to
    // a valid commitment; stop its rollout as soon as that lower bound fails.
    const result=this.evaluate([path],0);
    if(this.edgeCache.size>=2048)this.edgeCache.delete(this.edgeCache.keys().next().value);
    this.edgeCache.set(k,{epoch,result}); return result;
  }
  terminalPaths(paths, rootId) {
    const landmark=this.getLandmark(rootId);
    if(!landmark||!this.active.has(rootId))return null;
    const radius=this.knowledge.orbitRadius(landmark),length=2*Math.PI*radius;
    const entry=samplePaths(paths,pathLength(paths));
    if(!entry)return null;
    const orbitPath={start:[...entry],end:[...entry],radius,length,types:['L','S','L'],lengths:[length,0,0]};
    // Validate one complete entry/loiter cycle with the same gimbal slew.
    // Once locked, the certified orbit and continuing controller repeat it.
    return [...paths,orbitPath];
  }
  validateSolution(paths, budget, rootId) {
    const complete=this.terminalPaths(paths,rootId);
    return complete?this.evaluate(complete,budget,{targetId:rootId,initialCameraYaw:this.cameraYaw,initialVisible:this.visible}):{safe:false,reason:'unavailable terminal orbit'};
  }
  plan() {
    if(this.phase==='goal-orbit'||this.fault)return;
    const goal=this.world.landmarks.at(-1), r=this.knowledge.orbitRadius(goal);
    if(!this.config.gatekeeper&&this.committed)return;
    if(this.committed?.rootId===goal.id&&this.active.has(goal.id))return;
    // Mission target is an orbit. Choose the shortest connection to its four
    // tangent poses; no obstacle/feature information enters this nominal choice.
    let best=null;
    for(let i=0;i<4;i++) { const a=i*Math.PI/2, end=[goal.x+r*Math.cos(a),goal.y+r*Math.sin(a),a+Math.PI/2];const p=shortestPath(this.estimate,end,this.config.radius); if(p&&(!best||p.length<best.length))best=p; }
    this.nominalPaths=best?[best]:[]; if(!best)return;
    if(!this.config.gatekeeper) {
      // Deliberate baseline: execute the same shortest Dubins nominal route
      // without corridor, budget, feature, controller-rollout or backup gates.
      // The independent executed-flight monitors below remain enabled.
      this.committed={cameraLandmarkIds:null,nominalPaths:[best],backupPaths:[],switchDistance:best.length,totalLength:best.length,rootId:goal.id,mapVersion:this.knowledge.version};
      this.progress=0;this.commits++;this.phase='nominal';this.status='Nominal only · flying directly toward the goal';return;
    }
    const previous=this.committed;
    let safePrefix=0;
    for(let d=0;d<=best.length;d+=1){const q=samplePaths([best],d);if(!this.knowledge.safe(q[0],q[1]))break;safePrefix=d;}
    let candidates=prefixPaths([best],safePrefix);
    const prefixCheck=this.evaluate(candidates,this.budget,{initialCameraYaw:this.cameraYaw,initialVisible:this.visible});
    if(!prefixCheck.safe&&Number.isFinite(prefixCheck.validDistance)) candidates=prefixPaths(candidates,prefixCheck.validDistance);
    // Reaching a verified goal orbit is itself a valid terminal backup.
    if(this.active.has(goal.id)) {
      const valid=this.validateSolution([best],this.budget,goal.id);
      if(valid.safe && this.validateController(this.terminalPaths([best],goal.id))) {
        this.committed={cameraLandmarkIds:[...this.knowledge.discovered],nominalPaths:[best],backupPaths:[],switchDistance:best.length,totalLength:best.length,rootId:goal.id,mapVersion:this.knowledge.version};
        this.progress=0;this.commits++;this.phase='nominal';this.status='Approaching the goal orbit';return;
      }
    }
    const result=gatekeeper({pose:this.estimate,nominalPaths:candidates,forest:this.forest,budgetUsed:this.budget,budgetLimit:this.config.budget,speed:this.config.speed,dt:.2,validate:(p,b,terminal)=>this.validateSolution(p,b,terminal.rootId),previous,mapVersion:this.knowledge.version,getMapVersion:()=>this.knowledge.version});
    // A shorter freshly planned prefix must not interrupt useful nominal
    // progress that is already committed and still valid. Keep its validated
    // controller/camera policy until a replacement advances the switching
    // point toward the goal or execution reaches its backup component.
    if(result.accepted && previous && this.progress<previous.switchDistance-1e-6) {
      const oldSwitch=samplePaths(previous.nominalPaths,previous.switchDistance);
      const nextSwitch=result.trajectory.switchDistance>0?samplePaths(result.trajectory.nominalPaths,result.trajectory.switchDistance):this.estimate;
      if(oldSwitch&&nextSwitch&&Math.hypot(nextSwitch[0]-goal.x,nextSwitch[1]-goal.y)>=Math.hypot(oldSwitch[0]-goal.x,oldSwitch[1]-goal.y)-.2)return;
    }
    if(result.accepted && result.trajectory?.mapVersion===this.knowledge.version && this.validateController(this.terminalPaths([...result.trajectory.nominalPaths,...result.trajectory.backupPaths],result.trajectory.rootId))) {
      this.committed={...result.trajectory,cameraLandmarkIds:[...this.knowledge.discovered]};this.progress=0;this.commits++;
      this.phase=this.committed.switchDistance>0?'nominal':'backup';
      this.status=this.phase==='nominal'?'Exploring toward the goal':'Returning to a renewal landmark';
    }
  }
  validateController(paths) {
    const length=pathLength(paths);let pose=[...this.estimate];
    for(let s=0;s<length;s+=this.config.speed*.02) {
      const reference=samplePaths(paths,s);
      const lateral=-(pose[0]-reference[0])*Math.sin(reference[2])+(pose[1]-reference[1])*Math.cos(reference[2]);
      let turn=this.config.speed*curvatureOnPaths(paths,s)+2*angleDiff(pose[2],reference[2])-.12*lateral;
      turn=Math.max(-this.config.speed/this.config.radius,Math.min(this.config.speed/this.config.radius,turn));
      pose=integrate(pose,this.config.speed,turn,Math.min(.02,(length-s)/this.config.speed));
      // The analytic validation reserves two metres for footprint/tracking.
      const endReference=samplePaths(paths,Math.min(length,s+this.config.speed*.02));
      if(Math.hypot(pose[0]-endReference[0],pose[1]-endReference[1])>1.5)return false;
      if(!this.knowledge.safe(pose[0],pose[1],this.config.budget+.5))return false;
    }
    return true;
  }
  advance() {
    if(this.fault)return false;
    if(!this.initialized||this.pendingSensor)throw new Error('Waiting for a validated camera frame.');
    const dt=.2, c=this.config;
    const before=[...this.pose], beforeYaw=this.cameraYaw;
    const previousVisible=this.pixelFeatures?this.visible:this.knowledge.visibleFeatures(before,beforeYaw,0,false);
    let targetId=this.committed?.rootId || this.orbit.id;
    const paths=this.committed?[...this.committed.nominalPaths,...this.committed.backupPaths]:[];
    const length=pathLength(paths);
    // Piecewise constant curvature commands track the verified Dubins solution.
    // Feedback corrects the estimate's cross-track/yaw error without violating
    // the vehicle's minimum radius; exact integration avoids Euler orbit drift.
    for(let i=0;i<10;i++) {
      let turn;
      if(this.committed && this.progress<length-1e-7) {
        const ref=samplePaths(paths,Math.min(length,this.progress));
        const curvature=curvatureOnPaths(paths,this.progress);
        const lateral=-(this.estimate[0]-ref[0])*Math.sin(ref[2])+(this.estimate[1]-ref[1])*Math.cos(ref[2]);
        turn=c.speed*curvature+2*angleDiff(this.estimate[2],ref[2])-.12*lateral;
        this.progress=Math.min(length,this.progress+c.speed*.02);
      } else {
        const l=this.getLandmark(targetId)||this.world.landmarks[0],r=this.knowledge.orbitRadius(l);
        const dx=this.estimate[0]-l.x,dy=this.estimate[1]-l.y,radial=Math.hypot(dx,dy);
        const desired=Math.atan2(dy,dx)+Math.PI/2+Math.atan2(radial-r,r);
        turn=c.speed/r+2*angleDiff(this.estimate[2],desired);
        this.orbit={id:l.id,x:l.x,y:l.y,radius:r,direction:1};
      }
      turn=Math.max(-c.speed/c.radius,Math.min(c.speed/c.radius,turn));
      this.pose=integrate(this.pose,c.speed,turn,.02);
      const growth=c.speed*.02*.03;
      this.error[0]+=growth*Math.cos(this.errorDirection); this.error[1]+=growth*Math.sin(this.errorDirection);
      this.estimate=[this.pose[0]+this.error[0],this.pose[1]+this.error[1],this.pose[2]];
      const errorMagnitude=Math.hypot(...this.error);this.peakError=Math.max(this.peakError,errorMagnitude);
      if(errorMagnitude>c.budget+1e-6) {this.time+=(i+1)*.02;this.budget=errorMagnitude;return this.fail('Localization error exceeded its budget between camera frames.',{kind:'budget',actual:errorMagnitude,limit:c.budget});}
      if(worldCollision(this.world,this.pose[0],this.pose[1],.5)||this.world.zones.some(z=>inZone(z,this.pose[0],this.pose[1],.5))) {this.time+=(i+1)*.02;return this.fail('Executed flight entered an obstacle or restriction.',{kind:'collision'});}
    }
    this.time+=dt;this.tick++;this.metrics.steps++;
    // Execute exactly the gimbal command validated on the committed reference.
    // Feedback still drives the aircraft from its estimate. Freezing the known
    // camera targets prevents a later discovery from silently changing a
    // retained backup's camera policy after a replacement is rejected.
    const cameraReference=this.committed&&this.progress<length-1e-7?samplePaths(paths,this.progress):this.estimate;
    this.cameraYaw=this.slewCamera(this.cameraYaw,this.cameraFor(cameraReference,targetId,this.committed?.cameraLandmarkIds));
    this.pendingSensor={previousVisible,targetId,paths,length};
    if(this.pixelFeatures)return true;
    return this.acceptSensor();
  }
  finishAdvance({previousVisible,targetId,paths,length},observation) {
    const c=this.config,dt=.2;
    const st=now(), sensed=this.knowledge.sense(this.pose,this.cameraYaw,observation);this.metrics.sensingMs=now()-st;this.visible=sensed.visible;
    for(const id of sensed.discoveredZones)this.emit(`${this.world.zones.find(z=>z.id===id).label}: no-fly zone discovered`);
    for(const id of sensed.newLandmarks)this.emit(`${this.getLandmark(id).label}: landmark discovered`);
    const landmarkVisible=this.knowledge.visibleLandmarks(this.pose,this.cameraYaw,0,true).length>0;
    this.featuresTracked=this.pixelFeatures?observation.shared:overlap(previousVisible,this.visible);
    if(landmarkVisible) { if(this.budget>0)this.renewals++;this.budget=0;this.error=[0,0];this.estimate=[...this.pose];this.errorDirection=this.rng()*Math.PI*2; }
    else { this.budget+=c.speed*dt*.03; this.minTracked=Math.min(this.minTracked,this.featuresTracked);if(this.featuresTracked<c.minFeatures)return this.fail('Observed feature overlap fell below the configured minimum.',{kind:'features',actual:this.featuresTracked,limit:c.minFeatures}); }
    this.peakError=Math.max(this.peakError,this.budget);
    if(this.budget>c.budget+1e-6)return this.fail('Observed localization error exceeded the configured budget.',{kind:'budget',actual:this.budget,limit:c.budget});
    if(this.config.gatekeeper&&sensed.discoveredZones.length) {
      this.forest.revalidate();
      // Previously certified corridors exclude unknown space, so a remote
      // discovery should preserve the existing commitment. Fail closed if a
      // changed restriction ever contradicts that invariant.
      if(this.committed && !this.evaluate(paths,0,{collisionOnly:true}).safe)
        return this.fail('A discovered restriction invalidated the committed corridor.');
      for(const id of this.active) if(!this.knowledge.certifyOrbit(this.getLandmark(id)))
        return this.fail('A discovered restriction invalidated a renewal orbit.');
      if(this.committed)this.committed.mapVersion=this.knowledge.version;
    }
    if(this.config.gatekeeper)this.activateOrbits();
    const goal=this.world.landmarks.at(-1),gr=this.knowledge.orbitRadius(goal);
    if(this.committed && this.progress>=length-1e-6) {
      this.phase=targetId===goal.id?'goal-orbit':'orbit';
      if(this.phase==='goal-orbit'&&Math.abs(Math.hypot(this.pose[0]-goal.x,this.pose[1]-goal.y)-gr)<2 && (!this.config.gatekeeper||this.active.has(goal.id))) {
        if(this.successTime===null){this.successTime=this.time;this.emit('Goal orbit reached');}
        this.status='Mission complete · holding the goal orbit';
      } else if(this.phase==='goal-orbit')this.phase='orbit';
      else this.status='Renewing localization · looking for safe progress';
    } else if(this.committed) {
      this.phase=this.progress<this.committed.switchDistance?'nominal':'backup';
      this.status=!this.config.gatekeeper?'Nominal only · flying directly toward the goal':this.phase==='nominal'?'Following the committed nominal segment':'Following the verified backup';
    }
    if(this.phase!=='goal-orbit') {
      if(this.config.gatekeeper&&this.tick%5===0) {const t=now();this.forest.grow([this.estimate[0],this.estimate[1]],150,10);this.metrics.growthMs=now()-t;}
      const t=now();this.plan();this.metrics.planningMs=now()-t;
    }
    const home=this.world.landmarks[0];
    if(Math.hypot(this.pose[0]-home.x,this.pose[1]-home.y)>this.knowledge.orbitRadius(home)+12)this.departedHome=true;
    if(c.gatekeeper&&!this.departedHome&&this.time>=15)this.status='Holding home · searching for a verified departure at these settings';
    this.record();return true;
  }
  fail(message,details={kind:'constraint'}) {if(this.fault)return false;this.fault=message;this.failure={...details,time:this.time};this.phase='fault';this.status=message;this.emit(message);this.record();return false;}
  record() {this.trail.push(this.pose[0],this.pose[1],this.estimate[0],this.estimate[1]);this.history.push(this.time,this.budget,this.featuresTracked,this.knowledge.visibleLandmarks(this.pose,this.cameraYaw,0,true).length?1:0);}
  sampleLine(paths) {const length=pathLength(paths);if(!length)return new Float32Array();const n=Math.min(1024,Math.ceil(length/1.5)+1),out=new Float32Array(n*2);for(let i=0;i<n;i++){const p=samplePaths(paths,length*i/(n-1));out[i*2]=p[0];out[i*2+1]=p[1];}return out;}
  snapshot({full=true}={}) {
    const mapped=[];for(let i=0;i<this.knowledge.mapped.length;i++)if(this.knowledge.mapped[i])mapped.push(i);
    const edges=this.forest.getEdges();
    return {gatekeeper:this.config.gatekeeper,sensor:{horizontalFov:this.config.horizontalFov,sensingRange:this.config.sensingRange,downwardPitch:this.config.downwardPitch},failure:this.failure,featurePositions:this.pixelFeatures?new Float32Array(this.knowledge.features.flatMap(f=>[f.x,f.y,f.z])):null,sensorKeypoints:this.sensorObservation?.keypoints||null,vision:this.sensorObservation?.metrics||null,worldId:this.world.id,pose:[...this.pose],estimate:[...this.estimate],cameraYaw:this.cameraYaw,time:this.time,budget:this.budget,featuresTracked:this.featuresTracked,landmarkVisible:this.knowledge.visibleLandmarks(this.pose,this.cameraYaw,0,true).length>0,
      mappedFeatureIds:new Uint16Array(mapped),visibleFeatureIds:new Uint16Array(this.visible||[]),discoveredLandmarkIds:[...this.knowledge.discovered],activeLandmarkIds:[...this.active],knownZoneIds:[...this.knowledge.knownZones],phase:this.phase,status:this.status,fault:this.fault,treeEdges:edges instanceof Float32Array?edges:(edges?.edges||new Float32Array()),
      treeColors:this.forest.getEdgeColors(),nominal:this.sampleLine(this.nominalPaths),committedNominal:this.sampleLine(this.committed?.nominalPaths||[]),backup:this.sampleLine(this.committed?.backupPaths||[]),orbit:this.committed?{id:this.committed.rootId,...this.getLandmark(this.committed.rootId),radius:this.knowledge.orbitRadius(this.getLandmark(this.committed.rootId))}:this.orbit,
      trail:this.trail.read(),history:this.history.read(),knowledge:full?{width:this.knowledge.width,height:this.knowledge.height,cellSize:CELL,cells:this.knowledge.cells.slice(),observed:this.knowledge.observed.slice()}:null,
      switchpoint:this.committed?samplePaths([...this.committed.nominalPaths,...this.committed.backupPaths],this.committed.switchDistance):null,
      metrics:{...this.metrics,nodes:this.forest.count??this.forest.nodes?.length??0,mapped:mapped.length,commits:this.commits,renewals:this.renewals,peakError:this.peakError,minTracked:Number.isFinite(this.minTracked)?this.minTracked:null,successTime:this.successTime,mapVersion:this.knowledge.version,historyCount:this.history.count,trailCount:this.trail.count,cacheSize:this.edgeCache.size},events:[...this.events]};
  }
}
