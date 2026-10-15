import { DemoRenderer } from './renderer.js';
import { createWorld } from './worlds.js';
import { DEFAULTS } from './simulation.js';
import { getLayoutTargets, updatedLayout, validateWorldLayout } from './world-layout.js';
const $=id=>document.getElementById(id);
const DEFAULT_CONFIG={...DEFAULTS,gatekeeper:DEFAULTS.gatekeeper!==false};
const DEFAULT_SIMULATION_RATE=5;
let worker=null,runId=0,playing=!document.hidden,visiblePlaying=true,config={...DEFAULT_CONFIG},worldId='farm',renderer,lastSnapshot=null,pageSuspended=false,simulationRate=DEFAULT_SIMULATION_RATE;
const controls=[['budget','budget'],['features','minFeatures'],['speed','speed'],['radius','radius'],['fov','horizontalFov'],['range','sensingRange'],['pitch','downwardPitch']];
const CONTROL_UNITS={budget:' m',speed:' m/s',radius:' m',fov:'°',range:' m',pitch:'°'};
const seed=1337;
const sensorContext=$('sensor-canvas').getContext('2d');
let sensorImage=null,viewMode='orbit';
function structuredCloneSafe(value) {
  if(value===undefined||value===null)return {};
  try {return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));} catch(_error) {return {...value};}
}
const worldLayouts=new Map();
let editing=false,editingResumePlaying=false,editingPriorView='orbit',editingPriorKnowledge=false,editingPriorPanelScroll=0;
let selectedEditTarget=null;
function inspect(info) { $('inspect-title').textContent=info?.title||'Inspect the world';$('inspect-description').textContent=info?.description||'Click a landmark or restricted area to inspect its role.'; }
function clearFailureAlert() {
  const alert=$('failure-alert');
  if(alert){alert.hidden=true;delete alert.dataset.kind;}
  for(const id of ['failure-reason','failure-measurement','failure-time'])if($(id))$(id).textContent='';
}
function clearInitializationError() {
  const alert=$('initialization-error');
  if(alert)alert.hidden=true;
  if($('initialization-error-message'))$('initialization-error-message').textContent='';
}
function showInitializationError(message='The planning worker could not start.') {
  clearFailureAlert();
  const alert=$('initialization-error');
  if(alert)alert.hidden=false;
  if($('initialization-error-message'))$('initialization-error-message').textContent=message;
  $('status-text').textContent='Failed to initialize';
  $('phase-label').textContent='Initialization failed';
  $('loading-overlay').hidden=true;
  setPlaying(false);
  $('play-button').disabled=true;
  console.error(message);
}
function updateModeIndicator(gatekeeper=config.gatekeeper!==false) {
  const enabled=gatekeeper!==false;
  const toggle=$('gatekeeper-toggle');
  if(toggle)toggle.checked=enabled;
  const indicator=$('control-mode');
  if(indicator) {
    indicator.dataset.mode=enabled?'gatekeeper':'nominal';
    indicator.querySelector('.mode-indicator-label').textContent=enabled?'Gatekeeper active':'Nominal only';
  }
  if($('control-mode-description'))$('control-mode-description').textContent=enabled?'Nominal progress is checked before commitment.':'The nominal route is followed without gatekeeper checks.';
}
function setPlaying(value) {
  // World editing owns the simulation pause. A click, Space key, or browser
  // visibility callback must not resume a mission while a preview is active.
  playing=Boolean(value)&&!editing&&!$('play-button').disabled;
  $('play-button').textContent=playing?'Pause':'Play';
  $('play-button').setAttribute('aria-pressed',String(!playing));
  worker?.postMessage({type:'play',runId,playing});
}
function setSimulationRate(value) {
  const rate=Number(value);
  simulationRate=Number.isFinite(rate)?Math.max(1,Math.min(10,rate)):1;
  $('simulation-rate-input').value=simulationRate;
  $('simulation-rate-input').setAttribute('aria-valuetext',`${simulationRate} times normal speed`);
  $('simulation-rate-value').textContent=`${simulationRate}×`;
  worker?.postMessage({type:'simulation-rate',runId,simulationRate});
}
try {renderer=new DemoRenderer($('scene-canvas'),inspect);} catch(error){showInitializationError(`3D rendering unavailable: ${error.message}`);}
function updateControls() {for(const [id,key]of controls){const input=$(`${id}-input`);if(!input)continue;input.value=config[key];if($(`${id}-number`))$(`${id}-number`).value=config[key];if($(`${id}-value`))$(`${id}-value`).textContent=config[key]+(CONTROL_UNITS[id]||'');}}
const failureLabels={features:'Minimum shared-feature constraint not satisfied',budget:'Localization-error budget constraint not satisfied',collision:'Collision-safety constraint not satisfied',constraint:'Planning constraint not satisfied'};
const failureReasons={features:'The minimum shared-feature constraint was not satisfied.',budget:'The localization-error budget constraint was not satisfied.',collision:'The collision-safety constraint was not satisfied.',constraint:'The planning constraint was not satisfied.'};
function failureReason(snapshot) {
  const kind=snapshot?.failure?.kind;
  const summary=failureReasons[kind]||'The planning constraint was not satisfied.';
  // Preserve the useful obstacle/restriction diagnostic for nonnumeric faults.
  const detail=typeof snapshot?.fault==='string'?snapshot.fault.replace(/\bbreached\b/gi,'not satisfied'):'';
  return (kind==='collision'||kind==='constraint'||!kind)&&detail?`${summary} ${detail}`:summary;
}
function numeric(value) {const n=Number(value);return Number.isFinite(n)?n:null;}
function formatFailureMeasurement(failure) {
  if(!failure||typeof failure!=='object')return '';
  const kind=failure.kind;
  const actual=numeric(failure.actual),limit=numeric(failure.limit);
  if(actual===null&&limit===null)return '';
  if(kind==='features') {
    const observed=actual===null?'unknown':`${actual} shared features`;
    const minimum=limit===null?'unknown':`${limit}`;
    return `Measured overlap: ${observed} (minimum ${minimum})`;
  }
  if(kind==='budget') {
    const precision=actual!==null&&limit!==null&&actual>limit&&actual.toFixed(2)===limit.toFixed(2)?3:2;
    const observed=actual===null?'unknown':`${actual.toFixed(precision)} m`;
    const maximum=limit===null?'unknown':`${limit.toFixed(2)} m`;
    return `Measured localization error: ${observed} (limit ${maximum})`;
  }
  const observed=actual===null?'unknown':actual.toFixed(2);
  const threshold=limit===null?'unknown':limit.toFixed(2);
  return `Measured value: ${observed} (limit ${threshold})`;
}
function updateFailureAlert(snapshot) {
  const failure=snapshot?.failure&&typeof snapshot.failure==='object'?snapshot.failure:null;
  const failed=Boolean(failure||snapshot?.fault||snapshot?.phase==='fault');
  const alert=$('failure-alert');
  if(!alert)return failed;
  if(!failed) {
    clearFailureAlert();
    return false;
  }
  const kind=failure?.kind;
  const title=failureLabels[kind]||'Safety stop';
  const reason=failureReason(snapshot);
  alert.dataset.kind=kind||'unknown';
  $('failure-title').textContent=title;
  $('failure-reason').textContent=reason;
  $('failure-measurement').textContent=formatFailureMeasurement(failure);
  $('failure-time').textContent=Number.isFinite(Number(failure?.time??snapshot?.time))?`Stopped at ${Number(failure?.time??snapshot.time).toFixed(1)} s.`:'';
  alert.hidden=false;
  return true;
}
function stopForFailure(snapshot) {
  if(!updateFailureAlert(snapshot))return;
  setPlaying(false);
  $('play-button').disabled=true;
  $('play-button').setAttribute('aria-disabled','true');
  $('phase-label').textContent='Fault';
}
function restart(resumePlaying = playing) {
  if(!renderer){showInitializationError('3D rendering is unavailable. Enable WebGL 2 and reload the page.');return;}
  if(editing){resumePlaying=editingResumePlaying;finishWorldEditor(false);}
  worker?.terminate();worker=null;runId++;const activeRunId=runId;lastSnapshot=null;pageSuspended=false;$('play-button').disabled=false;$('play-button').removeAttribute('aria-disabled');clearFailureAlert();clearInitializationError();sensorImage=null;sensorContext.clearRect(0,0,320,240);
  $('loading-overlay').hidden=false;$('loading-overlay').textContent='Building the world and surveying home…';
  const activeLayout=structuredCloneSafe(worldLayouts.get(worldId)||{});
  const world=createWorld(worldId,seed,activeLayout);renderer.setWorld(world);renderer.setEditTargets(getLayoutTargets(world));renderer.setSensorConfig(config);renderer.setKnowledgeView($('knowledge-toggle').checked);renderer.setViewMode(viewMode);
  playing=Boolean(resumePlaying);inspect();updateControls();updateModeIndicator(config.gatekeeper);setPlaying(playing);if($('scene-world-label'))$('scene-world-label').textContent=world.label;$('status-text').textContent='Initializing online planning';
  syncEditorTargets();
  const activeWorker=worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  activeWorker.onmessage=event=>{
    const m=event.data;if(m.runId!==undefined&&m.runId!==runId)return;
    if(worker!==activeWorker||(m.runId!==undefined&&m.runId!==activeRunId))return;
    if(m.type==='error') {showInitializationError(m.message||'Simulation worker failed.');if(m.stack)console.error(m.stack);return;}
    if(m.type==='sensor') {
      try {
        const frame=renderer.captureSensor(m.pose,m.cameraYaw,m.recycled);
        sensorImage=new ImageData(new Uint8ClampedArray(frame.rgba),frame.width,frame.height);
        sensorContext.putImageData(sensorImage,0,0);
        activeWorker.postMessage({type:'sensor-frame',runId:activeRunId,requestId:m.requestId,frame},[frame.rgba.buffer,frame.depth.buffer]);
      }catch(error){showInitializationError(`Sensor initialization failed: ${error.message}`);}
      return;
    }
    if(m.type!=='snapshot'||m.snapshot.runId!==runId)return;
    const s=m.snapshot;renderer.update(s);updateDashboard(s);drawSensor(s);$('loading-overlay').hidden=true;
    // Debug data contains only bounded scalar summaries; never retains buffers.
    lastSnapshot={worldId:s.worldId,worldLayout:structuredCloneSafe(activeLayout),pose:s.pose,estimate:s.estimate,time:s.time,budget:s.budget,phase:s.phase,metrics:s.metrics,vision:s.vision,sensor:s.sensor,fault:s.fault,failure:s.failure,gatekeeper:s.gatekeeper!==false,featuresTracked:s.featuresTracked,knownZoneIds:s.knownZoneIds,discoveredLandmarkIds:s.discoveredLandmarkIds,activeLandmarkIds:s.activeLandmarkIds};
    const returned={},transfers=[];
    for(const key of ['mappedFeatureIds','visibleFeatureIds','featurePositions','sensorKeypoints','treeEdges','treeColors','nominal','committedNominal','backup','trail','history'])if(s[key]?.buffer){returned[key]=s[key].buffer;transfers.push(s[key].buffer);}
    for(const key of ['cells','observed'])if(s.knowledge?.[key]){returned[key]=s.knowledge[key].buffer;transfers.push(returned[key]);}
    activeWorker.postMessage({type:'ack',runId:activeRunId,sequence:s.sequence,buffers:returned},transfers);
    if(s.failure||s.fault||s.phase==='fault')stopForFailure(s);
  };
  activeWorker.onerror=e=>{if(worker!==activeWorker||runId!==activeRunId)return;showInitializationError(e.message||'Simulation worker failed.');};
  activeWorker.postMessage({type:'init',runId:activeRunId,worldId,seed,layout:activeLayout,config,playing,simulationRate});
}
function drawSensor(s) {
  if(sensorImage)sensorContext.putImageData(sensorImage,0,0);
  const points=s.sensorKeypoints||[];
  for(let i=0;i<points.length;i+=3) {
    const x=points[i],y=points[i+1];sensorContext.strokeStyle=points[i+2]?'#ffe36b':'#78f4d0';sensorContext.lineWidth=1;
    sensorContext.strokeRect(x-2.5,y-2.5,5,5);
  }
  $('sensor-status').textContent=s.vision?`${s.vision.inFootprint} corners · ${s.vision.shared} shared · ${s.vision.processingMs.toFixed(0)} ms`:'Waiting for camera';
}
function setView(mode) {
  if(editing && mode!=='top')mode='top';
  viewMode=mode;renderer.setViewMode(mode);
  for(const [id,value]of [['orbit-button','orbit'],['top-button','top'],['fpv-button','fpv']])$(id).setAttribute('aria-pressed',String(mode===value));
}
function editorTargetKey(target) { return target ? `${target.type}:${target.id}` : ''; }
function editorTargetFromSelection() {
  const select=$('world-editor-object');
  const key=select?.value||editorTargetKey(selectedEditTarget);
  return (renderer?.getEditTargets?.()||[]).find(target=>editorTargetKey(target)===key)||null;
}
function setEditorError(message='') {
  const error=$('world-edit-error');
  if(error){error.textContent=message;error.hidden=!message;}
  const status=$('world-edit-status');
  if(status&&message)status.textContent=message;
}
function syncEditorCoordinates(target=editorTargetFromSelection()) {
  if(!target)return;
  selectedEditTarget=target;
  const select=$('world-editor-object');if(select&&select.value!==editorTargetKey(target))select.value=editorTargetKey(target);
  const x=$('world-edit-x'),y=$('world-edit-y');
  if(x)x.value=Number(target.x).toFixed(1);if(y)y.value=Number(target.y).toFixed(1);
  const title=$('world-edit-selection');if(title)title.textContent=`${target.label} · ${target.type}`;
}
function syncEditorTargets() {
  const select=$('world-editor-object');
  const targets=renderer?.getEditTargets?.()||[];
  if(select){
    const selected=selectedEditTarget?editorTargetKey(selectedEditTarget):select.value;
    select.replaceChildren();
    targets.forEach(target=>{const option=document.createElement('option');option.value=editorTargetKey(target);option.textContent=`${target.label} (${target.type})`;select.append(option);});
    if(targets.length){const target=targets.find(item=>editorTargetKey(item)===selected)||targets[0];select.value=editorTargetKey(target);syncEditorCoordinates(target);}
  }
  const empty=$('world-edit-empty');if(empty)empty.hidden=targets.length!==0;
  const apply=$('world-edit-apply');if(apply)apply.disabled=!targets.length;
}
function editorValidationMessage(result) {
  if(result===true||result===undefined||result===null)return '';
  if(result===false)return 'That position is not safe for this world.';
  if(typeof result==='string')return result;
  if(typeof result==='object') {
    if(result.valid===false||result.ok===false||result.success===false) {
      const detail=result.message||result.reason||result.error||result.errors?.[0];
      return String(detail||'That position is not safe for this world.');
    }
  }
  return '';
}
function previewWorldEdit(target,candidate) {
  selectedEditTarget=target;
  syncEditorCoordinates({...target,...candidate});
  const status=$('world-edit-status');if(status)status.textContent=`Preview ${target.label}: ${candidate.x.toFixed(1)}, ${candidate.y.toFixed(1)}`;
  setEditorError('');
}
function commitWorldEdit(target,candidate) {
  if(!target||!candidate||Math.hypot(Number(candidate.x)-Number(target.x),Number(candidate.y)-Number(target.y))<0.01){renderer?.clearEditPreview?.(target);syncEditorCoordinates(target);return;}
  const currentWorld=renderer?.world||createWorld(worldId,seed,worldLayouts.get(worldId)||{});
  const currentLayout=worldLayouts.has(worldId)?worldLayouts.get(worldId):(currentWorld?.layout||{});
  let nextLayout;
  try { nextLayout=updatedLayout(currentWorld,currentLayout, {...candidate,type:target.type,id:target.id}); }
  catch(error) { renderer?.clearEditPreview?.(target); setEditorError(error.message||'That edit could not be applied.'); return; }
  let candidateWorld;
  try { candidateWorld=createWorld(worldId,seed,nextLayout); }
  catch(error) { renderer?.clearEditPreview?.(target); setEditorError(error.message||'That edit could not be applied.'); return; }
  let validation;
  try { validation=validateWorldLayout(candidateWorld,config); }
  catch(error) { validation={valid:false,message:error.message||'That edit could not be applied.'}; }
  const message=editorValidationMessage(validation);
  if(message) {
    renderer?.clearEditPreview?.(target);
    syncEditorCoordinates(target);
    setEditorError(message);
    return;
  }
  worldLayouts.set(worldId,structuredCloneSafe(nextLayout));
  const resume=editingResumePlaying;
  finishWorldEditor(true);
  restart(resume);
}
function finishWorldEditor(committed=false) {
  if(!editing)return;
  const priorView=editingPriorView,priorKnowledge=editingPriorKnowledge;
  editing=false;selectedEditTarget=null;renderer?.setEditMode(false);
  const toggle=$('world-edit-toggle');if(toggle){toggle.checked=false;toggle.setAttribute('aria-pressed','false');}
  const panel=$('world-editor');if(panel)panel.hidden=true;
  const panelBody=panel?.closest('.panel-body');
  if(panelBody)requestAnimationFrame(()=>{if(!editing)panelBody.scrollTop=editingPriorPanelScroll;});
  setMapView(priorKnowledge);
  setView(priorView);
  const status=$('world-edit-status');if(status)status.textContent=committed?'World layout applied.':'World layout unchanged.';
  setEditorError('');
  if(!committed)setPlaying(!document.hidden&&editingResumePlaying);
}
function enterWorldEditor() {
  if(editing||!renderer)return;
  editing=true;editingResumePlaying=playing;editingPriorView=viewMode;editingPriorKnowledge=$('knowledge-toggle').checked;
  const existingPanel=$('world-editor')?.closest('.panel-body');
  editingPriorPanelScroll=existingPanel?.scrollTop||0;
  setPlaying(false);
  // Handles are truth geometry. Temporarily lift robot-map fog and FPV, then
  // restore both choices when the editor closes.
  setMapView(false);setView('top');syncEditorTargets();
  const panel=$('world-editor');
  if(panel){
    panel.hidden=false;
    requestAnimationFrame(()=>{if(editing)panel.scrollIntoView({block:'nearest',inline:'nearest'});});
  }
  const toggle=$('world-edit-toggle');if(toggle){toggle.checked=true;toggle.setAttribute('aria-pressed','true');}
  const status=$('world-edit-status');if(status)status.textContent='Drag a handle or edit its coordinates.';
  renderer.setEditMode(true,{onPreview:previewWorldEdit,onCommit:commitWorldEdit,onCancel:(target)=>{renderer.clearEditPreview(target);syncEditorCoordinates(target);}});
  syncEditorTargets();
}
function restoreWorldLayout() {
  const resume=editing?editingResumePlaying:playing;
  if(editing)finishWorldEditor(false);
  worldLayouts.delete(worldId);
  restart(resume);
}
function chart(canvas,history,column,limit,color) {
  const dpr=Math.min(devicePixelRatio||1,2),rect=canvas.getBoundingClientRect();
  const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,width,height);
  const n=history.length/4;if(!n)return;
  const max=column===1?Math.max(limit*1.18,1):Math.max(limit*1.6,25,...Array.from({length:n},(_,i)=>history[i*4+column]));
  const y=v=>height-8*dpr-(v/max)*(height-18*dpr),x=i=>8*dpr+(i/Math.max(1,n-1))*(width-16*dpr);
  ctx.strokeStyle='#9aa8b6';ctx.lineWidth=dpr;ctx.setLineDash([3*dpr,3*dpr]);ctx.beginPath();ctx.moveTo(0,y(limit));ctx.lineTo(width,y(limit));ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle=color;ctx.lineWidth=1.7*dpr;ctx.beginPath();let started=false;
  for(let i=0;i<n;i++){if(column===2&&history[i*4+3]){started=false;continue;}if(started)ctx.lineTo(x(i),y(history[i*4+column]));else{ctx.moveTo(x(i),y(history[i*4+column]));started=true;}}ctx.stroke();
}
function updateDashboard(s) {
  const budget=numeric(s.budget)??0,time=numeric(s.time)??0,features=numeric(s.featuresTracked)??0,metrics=s.metrics||{};
  const discovered=s.discoveredLandmarkIds||[],active=s.activeLandmarkIds||[],history=s.history||[];
  if($('budget-chart-value'))$('budget-chart-value').textContent=budget.toFixed(2);if($('features-chart-value'))$('features-chart-value').textContent=s.landmarkVisible?'—':features;
  $('status-text').textContent=s.failure||s.phase==='fault'?failureReason(s):s.status||'Mission ready';$('phase-label').textContent=String(s.phase||'initializing').replaceAll('-',' ');
  $('time-value').textContent=`${time.toFixed(1)} s`;$('error-value').textContent=`${budget.toFixed(2)} / ${config.budget} m`;
  $('tracked-value').textContent=s.landmarkVisible?'Landmark lock':`${features} / ${config.minFeatures}`;
  $('nodes-value').textContent=String(metrics.nodes??0);$('landmarks-value').textContent=`${discovered.length} found · ${active.length} usable`;
  chart($('budget-chart'),history,1,config.budget,'#d77a38');chart($('features-chart'),history,2,config.minFeatures,'#328575');
  $('diagnostics').textContent=`${metrics.mapped??0} mapped features · ${metrics.commits??0} commitments · planner ${(numeric(metrics.planningMs)??0).toFixed(1)} ms · ${metrics.renewals??0} renewals`;
  if(s.events?.length){const e=s.events.at(-1);const el=$('event-text');if(el)el.textContent=`${(numeric(e.time)??0).toFixed(1)} s · ${s.failure||s.phase==='fault'?failureReason(s):e.text}`;}
  updateModeIndicator(s.gatekeeper===undefined?config.gatekeeper:s.gatekeeper);
  if(s.failure||s.fault||s.phase==='fault')stopForFailure(s);else updateFailureAlert(s);
}
for(const [id,key]of controls) {
  const input=$(`${id}-input`);if(!input)continue;input.addEventListener('input',()=>{if($(`${id}-value`))$(`${id}-value`).textContent=input.value+(CONTROL_UNITS[id]||'');});
  const apply=source=>{
    if(!source.checkValidity()||!Number.isFinite(Number(source.value))){source.reportValidity();return;}
    const value=Number(source.value);if(value!==config[key]){config[key]=value;restart();}
  };
  input.addEventListener('change',()=>apply(input));
  const number=$(`${id}-number`);
  if(number){number.addEventListener('change',()=>apply(number));number.addEventListener('keydown',event=>{if(event.key==='Enter'){apply(number);number.blur();}});}
}
$('world-select').addEventListener('change',e=>{worldId=e.target.value;restart();});
$('simulation-rate-input').addEventListener('input',event=>setSimulationRate(event.target.value));
$('play-button').addEventListener('click',()=>setPlaying(!playing));$('reset-button').addEventListener('click',()=>restart());
$('defaults-button').addEventListener('click',()=>{config={...DEFAULT_CONFIG};setSimulationRate(DEFAULT_SIMULATION_RATE);worldLayouts.delete(worldId);restart();});
$('gatekeeper-toggle').addEventListener('change',e=>{config.gatekeeper=e.target.checked;restart();});
$('failure-reset').addEventListener('click',()=>restart());$('initialization-reset').addEventListener('click',()=>restart());
$('top-button').addEventListener('click',()=>setView('top'));$('fpv-button').addEventListener('click',()=>setView('fpv'));$('orbit-button').addEventListener('click',()=>setView('orbit'));$('view-button').addEventListener('click',()=>{setView('orbit');renderer.resetView();});
if($('world-edit-toggle'))$('world-edit-toggle').addEventListener('change',event=>event.target.checked?enterWorldEditor():finishWorldEditor(false));
if($('world-edit-close'))$('world-edit-close').addEventListener('click',()=>finishWorldEditor(false));
if($('world-edit-cancel'))$('world-edit-cancel').addEventListener('click',()=>finishWorldEditor(false));
if($('world-edit-restore'))$('world-edit-restore').addEventListener('click',restoreWorldLayout);
if($('world-editor-object'))$('world-editor-object').addEventListener('change',()=>syncEditorCoordinates());
if($('world-edit-apply'))$('world-edit-apply').addEventListener('click',()=>{
  const target=editorTargetFromSelection(),x=Number($('world-edit-x')?.value),y=Number($('world-edit-y')?.value);
  if(!target||!Number.isFinite(x)||!Number.isFinite(y)){setEditorError('Enter finite X and Y coordinates.');return;}
  commitWorldEdit(target,{x,y});
});
for(const id of ['world-edit-x','world-edit-y'])if($(id))$(id).addEventListener('keydown',event=>{if(event.key==='Enter')$('world-edit-apply')?.click();});
function setMapView(mapped) {
  if(editing)mapped=false;
  $('knowledge-toggle').checked=mapped;
  $('truth-view-button').setAttribute('aria-pressed',String(!mapped));
  $('mapped-view-button').setAttribute('aria-pressed',String(mapped));
  $('view-mode-description').textContent=mapped?'Robot map · fog hides unobserved scenery':'World truth · outlined dots are mapped features';
  renderer.setKnowledgeView(mapped);
}
$('knowledge-toggle').addEventListener('change',e=>setMapView(e.target.checked));
$('truth-view-button').addEventListener('click',()=>setMapView(false));
$('mapped-view-button').addEventListener('click',()=>setMapView(true));
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(!pageSuspended)visiblePlaying=playing;setPlaying(false);}else if(!pageSuspended&&!editing&&visiblePlaying)setPlaying(true);});
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&editing){event.preventDefault();finishWorldEditor(false);return;}
  if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||/INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName))return;
  if(event.code==='Space'){event.preventDefault();setPlaying(!playing);}
  else if(event.key.toLowerCase()==='r')restart();
  else if(event.key.toLowerCase()==='t')setView('top');
  else if(event.key.toLowerCase()==='f')setView('fpv');
  else if(event.key.toLowerCase()==='v'){setView('orbit');renderer.resetView();}
});
window.addEventListener('pagehide',event=>{if(event.persisted){pageSuspended=true;if(!document.hidden)visiblePlaying=playing;setPlaying(false);return;}worker?.terminate();worker=null;pageSuspended=false;renderer?.dispose();});
window.addEventListener('pageshow',event=>{if(!event.persisted||!pageSuspended)return;pageSuspended=false;if(!document.hidden&&!editing&&visiblePlaying)setPlaying(true);});
window.__budgetDemo={getState:()=>lastSnapshot,getConfig:()=>({...config}),getMode:()=>config.gatekeeper?'gatekeeper':'nominal',getDiagnostics:()=>({...renderer?.getDiagnostics?.(),viewMode,editing}),getLifecycle:()=>({runId,playing,pageSuspended,workerActive:Boolean(worker),simulationRate,editing}),getWorldLayout:()=>structuredCloneSafe(worldLayouts.get(worldId)||{}),getLayoutTargets:()=>renderer?.getEditTargets?.()||[],getEditTargetScreenPosition:target=>renderer?.getEditTargetScreenPosition?.(target)||null,setView,reset:restart,setWorld:id=>{worldId=id;$('world-select').value=id;restart();},setConfig:values=>{config={...config,...values};config.gatekeeper=config.gatekeeper!==false;restart();},enterWorldEditor,exitWorldEditor:()=>finishWorldEditor(false),restoreWorldLayout};
updateControls();updateModeIndicator(config.gatekeeper);restart();
