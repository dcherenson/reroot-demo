import { Simulation } from './simulation.js';
import { LiveFeatureMap } from './vision.js';
const BASE_TICK_MS=200;
const DEFAULT_SIMULATION_RATE=5;
let simulation=null,vision=null,playing=false,timer=null,awaiting=false,pendingFrame=null,runId=0,sequence=0,requestId=0;
let simulationRate=DEFAULT_SIMULATION_RATE,tickStartedAt=null,nextTickAt=null,scheduledForNextCycle=false;
let imageBuffers={},failed=false;
const buffers=new Map();
const arrayKeys=['mappedFeatureIds','visibleFeatureIds','featurePositions','sensorKeypoints','treeEdges','treeColors','nominal','committedNominal','backup','trail','history'];
function normalizeSimulationRate(value, fallback=1) {
  let numeric;
  try {numeric=Number(value);}catch {return fallback;}
  return Number.isFinite(numeric)?Math.min(10,Math.max(1,numeric)):fallback;
}
function tickInterval() {return BASE_TICK_MS/simulationRate;}
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
function clearTimer() {if(timer!==null)clearTimeout(timer);timer=null;}
function report(error) {failed=true;playing=false;clearTimer();postMessage({type:'error',runId,message:error.message,stack:error.stack});}
function requestSensor() {
  if(pendingFrame)throw new Error('A camera frame is already pending.');
  pendingFrame=++requestId;
  const recycled=imageBuffers;imageBuffers={};
  postMessage({type:'sensor',runId,requestId:pendingFrame,pose:simulation.pose,cameraYaw:simulation.cameraYaw,recycled},Object.values(recycled));
}
function schedule(delay=0,dueAt=null,anchored=false) {
  clearTimer();
  if(!playing||awaiting||pendingFrame)return;
  const now=performance.now();
  const numericDelay=Number(delay);
  const dueNumber=dueAt===null||dueAt===undefined?NaN:Number(dueAt);
  const deadline=Number.isFinite(dueNumber)?dueNumber:now+(Number.isFinite(numericDelay)?Math.max(0,numericDelay):0);
  nextTickAt=deadline;
  scheduledForNextCycle=anchored;
  timer=setTimeout(tick,Math.max(0,deadline-now));
}
function tick() {
  timer=null;
  if(!simulation||!playing||awaiting||pendingFrame)return;
  // Wall-clock overruns slow the demo; they never skip a measurement or rollout.
  tickStartedAt=performance.now();
  nextTickAt=tickStartedAt+tickInterval();
  scheduledForNextCycle=false;
  try {simulation.advance();if(simulation.fault){playing=false;publish();}else requestSensor();}
  catch(error){report(error);}
}
onmessage=event=>{
  const m=event.data;
  if(m.type==='init') {
    clearTimer();runId=m.runId;awaiting=false;pendingFrame=null;playing=false;buffers.clear();sequence=0;requestId=0;imageBuffers={};failed=false;
    simulationRate=normalizeSimulationRate(m.simulationRate,DEFAULT_SIMULATION_RATE);tickStartedAt=null;nextTickAt=null;scheduledForNextCycle=false;
    try {simulation=new Simulation(m.worldId,m.config,m.seed,{pixelFeatures:true,layout:m.layout||{}});vision=new LiveFeatureMap(simulation.world,simulation.config);playing=m.playing!==false;requestSensor();}
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
    awaiting=false;schedule(0,nextTickAt,true);
  } else if(m.runId===runId&&m.type==='simulation-rate') {
    simulationRate=normalizeSimulationRate(m.simulationRate);
    if((awaiting||pendingFrame)&&tickStartedAt!==null)nextTickAt=tickStartedAt+tickInterval();
    if(timer!==null&&playing&&!awaiting&&!pendingFrame&&scheduledForNextCycle&&tickStartedAt!==null) {
      schedule(0,tickStartedAt+tickInterval(),true);
    }
  } else if(m.runId===runId&&m.type==='play') {playing=m.playing&&!failed&&!simulation?.fault;schedule();}
};
