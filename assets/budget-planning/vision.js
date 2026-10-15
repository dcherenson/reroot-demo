/** Image measurements. Authored scenery points never enter this feature map. */
import { PixelFeatureDetector, matchFeatures } from './pixel-features.js';
import { inFov } from './knowledge.js';
import { inSensorImage, sensorCalibration, unprojectDepth, FEATURE_ASSOCIATION_RADIUS } from './sensor-camera.js';

export class LiveFeatureMap {
  constructor(world, config = {}) {
    this.world=world;this.config=config;this.sensor=sensorCalibration(config);this.detector=new PixelFeatureDetector({maxFeatures:500});
    this.previous=[];this.anchors=[];this.bins=new Map();this.frameCount=0;
  }
  nearby(point) {
    const cx=Math.floor(point.x/4),cy=Math.floor(point.y/4);let best=null,distance=FEATURE_ASSOCIATION_RADIUS**2;
    for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++)for(const id of this.bins.get(`${x},${y}`)||[]) {
      const a=this.anchors[id],d=(a.x-point.x)**2+(a.y-point.y)**2+(a.z-point.z)**2;
      if(d<distance){distance=d;best=id;}
    }
    return best;
  }
  measure(frame,pose,yaw,config=this.config) {
    // Resolve the optical planes once per measurement. Feature detection can
    // produce hundreds of corners, so passing raw degrees into both geometry
    // gates inside the loop would repeatedly allocate frozen calibrations.
    const sensor = config === this.config ? this.sensor : sensorCalibration(config);
    const started=performance.now();
    const corners=this.detector.detectFeatures(frame.rgba,frame.width,frame.height,{threshold:14,maxFeatures:500,minDistance:5,orientation:true,descriptorPatchRadius:7});
    const current=[];
    for(const corner of corners) {
      // FAST often places a silhouette corner on its background pixel. Use
      // the nearest depth in its 3x3 support to anchor the foreground surface
      // instead of a moving projection on the ground behind that object.
      let px=corner.x,py=corner.y,nearest=Infinity;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
        const k=((corner.y+dy)*frame.width+corner.x+dx)*4;
        const d=frame.depth[k]*16777216+frame.depth[k+1]*65536+frame.depth[k+2]*256+frame.depth[k+3];
        if(d>0&&d<nearest){nearest=d;px=corner.x+dx;py=corner.y+dy;}
      }
      const point=unprojectDepth(frame,px,py,this.world.width,this.world.height);
      if(!point||point.x<0||point.y<0||point.x>this.world.width||point.y>this.world.height||point.z>=this.world.altitude-.5)continue;
      if(!inFov(pose,point,yaw,0,sensor)||!inSensorImage(pose,point,yaw,this.world.altitude,0,sensor))continue;
      current.push({...corner,point,id:null});
    }
    // Simulated depth gates descriptor matches to nearby surfaces. Hamming
    // agreement is still required; geometric overlap alone is not a match.
    const matches=matchFeatures(this.previous,current,{maxDistance:72,ratio:.85,compatible:(a,b)=>Math.hypot(a.point.x-b.point.x,a.point.y-b.point.y,a.point.z-b.point.z)<2});
    const matched=new Set();
    for(const pair of matches) {
      const before=this.previous[pair.previous],after=current[pair.current];
      const anchor=before.id===null?null:this.anchors[before.id];
      after.id=anchor&&Math.hypot(anchor.x-after.point.x,anchor.y-after.point.y,anchor.z-after.point.z)<FEATURE_ASSOCIATION_RADIUS?before.id:null;
      matched.add(pair.current);
    }
    const newAnchors=[];const visible=new Set();
    for(let i=0;i<current.length;i++) {
      const feature=current[i];
      if(feature.id===null)feature.id=this.nearby(feature.point);
      if(feature.id===null && this.anchors.length<1000) {
        feature.id=this.anchors.length;
        const anchor={...feature.point,id:feature.id};this.anchors.push(anchor);newAnchors.push(anchor);
        const key=`${Math.floor(anchor.x/4)},${Math.floor(anchor.y/4)}`;
        if(!this.bins.has(key))this.bins.set(key,[]);this.bins.get(key).push(anchor.id);
      }
      if(feature.id!==null)visible.add(feature.id);
      // The persistent map stores spatially thinned representatives. The
      // shared count below uses the real one-to-one descriptor matches,
      // including detections after this bounded map has reached capacity.

    }
    this.previous=current;this.frameCount++;
    const keypoints=new Float32Array(current.length*3);
    for(let i=0;i<current.length;i++)keypoints.set([current[i].x,current[i].y,matched.has(i)?1:0],i*3);
    return {newAnchors,visible:[...visible],shared:matches.length,keypoints,
      metrics:{corners:corners.length,inFootprint:current.length,matches:matches.length,shared:matches.length,mapped:this.anchors.length,frameCount:this.frameCount,processingMs:performance.now()-started}};
  }
}
