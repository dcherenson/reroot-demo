import { Simulation } from './simulation.js';
import { LiveFeatureMap } from './vision.js';
let simulation=null,vision=null,playing=false,timer=null,awaiting=false,pendingFrame=null,runId=0,sequence=0,requestId=0,delayUntil=0;
let imageBuffers={},failed=false;
const buffers=new Map();
const arrayKeys=['mappedFeatureIds','visibleFeatureIds','featurePositions','sensorKeypoints','treeEdges','treeColors','nominal','committedNominal','backup','trail','history'];
function pack(snapshot) {
  const transfers=[];
  for(const key of arrayKeys) {
    const original=snapshot[key];if(!original)continue;
    let buffer=buffers.get(key);if(!buffer||buffer.byteLength<original.byteLength)buffer=new ArrayBuffer(Math.max(original.byteLength,16));
    buffers.delete(key);const view=new original.constructor(buffer,0,original.length);view.set(original);snapshot[key]=view;transfers.push(buffer);
  }
  if(snapshot.knowledge)for(const key of ['cells','observed']) {
    const original=snapshot.knowledge[key];let buffer=buffers.get(key);if(!buffer||buffer.byteLength<original.byteLength)buffer=new ArrayBuffer(original.byteLength);
    buffers.delete(key);snapshot.knowledge[key]=new Uint8Array(buffer,0,original.length);snapshot.knowledge[key].set(original);transfers.push(buffer);
  }
  return transfers;
}
function publish() {if(!simulation||awaiting)return;const snapshot=simulation.snapshot();snapshot.runId=runId;snapshot.sequence=++sequence;awaiting=true;postMessage({type:'snapshot',snapshot},pack(snapshot));}
function report(error) {failed=true;playing=false;clearTimeout(timer);postMessage({type:'error',runId,message:error.message,stack:error.stack});}
function requestSensor() {
  if(pendingFrame)throw new Error('A camera frame is already pending.');
  pendingFrame=++requestId;
  const recycled=imageBuffers;imageBuffers={};
  postMessage({type:'sensor',runId,requestId:pendingFrame,pose:simulation.pose,cameraYaw:simulation.cameraYaw,recycled},Object.values(recycled));
}
function schedule(delay=0) {clearTimeout(timer);if(playing&&!awaiting&&!pendingFrame)timer=setTimeout(tick,delay);}
function tick() {
  if(!simulation||!playing||awaiting||pendingFrame)return;
  // Wall-clock overruns slow the demo; they never skip a measurement or rollout.
  delayUntil=performance.now()+200;
  try {simulation.advance();if(simulation.fault){playing=false;publish();}else requestSensor();}
  catch(error){report(error);}
}
onmessage=event=>{
  const m=event.data;
  if(m.type==='init') {
    clearTimeout(timer);runId=m.runId;awaiting=false;pendingFrame=null;playing=false;buffers.clear();sequence=0;requestId=0;imageBuffers={};failed=false;
    try {simulation=new Simulation(m.worldId,m.config,m.seed,{pixelFeatures:true});vision=new LiveFeatureMap(simulation.world,simulation.config);playing=m.playing!==false;requestSensor();}
    catch(error){report(error);}
  } else if(m.runId===runId&&m.type==='sensor-frame'&&m.requestId===pendingFrame) {
    try {
      const observation=vision.measure(m.frame,simulation.pose,simulation.cameraYaw);
      pendingFrame=null;
      imageBuffers={rgba:m.frame.rgba.buffer,depth:m.frame.depth.buffer};
      simulation.acceptSensor(observation);if(simulation.fault)playing=false;publish();
    }catch(error){report(error);}
  } else if(m.runId===runId&&m.type==='ack'&&m.sequence===sequence&&awaiting) {
    for(const [key,value]of Object.entries(m.buffers||{}))if(value?.byteLength)buffers.set(key,value);
    awaiting=false;schedule(Math.max(0,delayUntil-performance.now()));
  } else if(m.runId===runId&&m.type==='play') {playing=m.playing&&!failed&&!simulation?.fault;schedule();}
};
