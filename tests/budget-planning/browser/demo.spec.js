import {test,expect} from '@playwright/test';
test('local demo loads, controls restart, viewer toggles leave mission untouched',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/budget-planning.html');
 await page.waitForFunction(()=>window.__budgetDemo?.getState()?.time>.4);
 await expect(page.locator('#loading-overlay')).toBeHidden();
 await page.locator('#play-button').click();
 await page.waitForTimeout(300);
 const before=await page.evaluate(()=>window.__budgetDemo.getState());
 await page.locator('#mapped-view-button').click();
 await expect(page.locator('#knowledge-toggle')).toBeChecked();
 await expect(page.locator('#mapped-view-button')).toHaveAttribute('aria-pressed','true');
 await page.locator('#truth-view-button').click();
 await expect(page.locator('#knowledge-toggle')).not.toBeChecked();
 await page.locator('#knowledge-toggle').check();await page.locator('#top-button').click();
 await page.mouse.move(350,550);await page.mouse.down();await page.mouse.move(440,600,{steps:10});await page.mouse.up();
 const after=await page.evaluate(()=>window.__budgetDemo.getState());
 expect(after.pose).toEqual(before.pose);expect(after.budget).toBe(before.budget);
 expect(await page.evaluate(()=>window.__budgetDemo.getDiagnostics().knowledgeView)).toBe(true);
 for(const id of ['tucson','ann-arbor','farm']){
  await page.selectOption('#world-select',id);await page.waitForFunction(()=>window.__budgetDemo?.getState()!==null);
  const diagnostics=await page.evaluate(()=>window.__budgetDemo.getDiagnostics());expect(diagnostics.world).toBe(id);
  expect((await page.evaluate(()=>window.__budgetDemo.getState())).fault).toBeNull();
 }
 await page.locator('#budget-number').fill('2.5');await page.locator('#budget-number').press('Enter');
 await page.waitForFunction(()=>window.__budgetDemo?.getState()!==null);
 await expect(page.locator('#budget-value')).toContainText('2.5');
 await page.locator('#defaults-button').click();await page.waitForFunction(()=>window.__budgetDemo?.getState()!==null);
 await expect(page.locator('#budget-number')).toHaveValue('5');
 await page.locator('#scene-canvas').focus();await page.keyboard.press('Space');
 await expect(page.locator('#play-button')).toHaveText('Pause');
 await page.keyboard.press('Space');await expect(page.locator('#play-button')).toHaveText('Play');
 expect(errors).toEqual([]);
});

test('responsive layout remains usable and exposes no horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/budget-planning.html');
 await page.waitForFunction(()=>window.__budgetDemo?.getState()!==null);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await expect(page.locator('#world-select')).toBeVisible();
 await page.locator('#play-button').scrollIntoViewIfNeeded();await page.locator('#play-button').click();
});

test('expanded telemetry reserves the tuning rail and sensor slot at every supported size',async({page})=>{
 const viewports=[{width:1440,height:1000},{width:1366,height:768},{width:1280,height:720},{width:1024,height:768},{width:768,height:844},{width:640,height:844},{width:390,height:844}];
 const sliderIds=['budget-input','features-input','speed-input','radius-input','fov-input','range-input','pitch-input'];
 for(const viewport of viewports){
  await page.setViewportSize(viewport);await page.goto('/budget-planning.html');
  await page.waitForFunction(()=>window.__budgetDemo?.getState()!==null);
  await page.locator('.telemetry-drawer > summary').click();
  const layout=await page.evaluate(ids=>{
   const rect=element=>{const box=element.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height};};
   const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
   const telemetry=rect(document.querySelector('.telemetry-drawer'));
   const sensor=rect(document.querySelector('.sensor-inset'));
   const scrollPort=rect(document.querySelector('.tuning-panel .panel-body'));
   const sliders=ids.map(id=>({id,rect:rect(document.getElementById(id))}));
   const visibleSliders=sliders.filter(item=>overlaps(scrollPort,item.rect));
   const internalOverflow=[...document.querySelectorAll('.telemetry-body,.telemetry-overview,.metric-grid,.charts-row,.chart-card,.diagnostics')].filter(element=>element.scrollWidth>element.clientWidth+1).map(element=>element.className||element.tagName);
   return {telemetry,sensor,sliders,telemetryOpen:document.querySelector('.telemetry-drawer').open,sliderOverlaps:visibleSliders.filter(item=>overlaps(telemetry,item.rect)).map(item=>item.id),internalOverflow};
  },sliderIds);
  expect(layout.telemetryOpen).toBe(true);
  expect(layout.telemetry.right<=layout.sensor.left-8||layout.telemetry.left>=layout.sensor.right+8).toBe(true);
  expect(layout.sliderOverlaps).toEqual([]);
  expect(layout.internalOverflow).toEqual([]);
 }
});

test('camera sensing controls round-trip through the worker and restore defaults',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/budget-planning.html');
 await page.waitForFunction(()=>window.__budgetDemo?.getState()?.sensor?.horizontalFov===90&&window.__budgetDemo.getState().sensor.sensingRange===75&&window.__budgetDemo.getState().sensor.downwardPitch===55);
 await page.locator('.telemetry-drawer > summary').click();
 const controls=[
  {id:'fov',key:'horizontalFov',value:95},
  {id:'range',key:'sensingRange',value:80},
  {id:'pitch',key:'downwardPitch',value:60},
 ];
 for(const {id,key,value} of controls){
  const input=page.locator(`#${id}-input`);const number=page.locator(`#${id}-number`);
  await input.scrollIntoViewIfNeeded();await expect(input).toBeEnabled();await expect(number).toBeEnabled();
  expect(await page.evaluate(id=>{
   const drawer=document.querySelector('.telemetry-drawer').getBoundingClientRect();
   const target=document.getElementById(id).getBoundingClientRect();
   return !(drawer.left<target.right&&drawer.right>target.left&&drawer.top<target.bottom&&drawer.bottom>target.top);
  },`${id}-input`)).toBe(true);
  await input.fill(String(value));
  await page.waitForFunction(({key,value})=>{
   const state=window.__budgetDemo?.getState();
   return state?.sensor?.[key]===value&&state.fault===null;
  },{key,value});
  const afterRange=await page.evaluate(()=>({sensor:window.__budgetDemo.getState().sensor,config:window.__budgetDemo.getConfig(),fault:window.__budgetDemo.getState().fault}));
  expect(afterRange.sensor[key]).toBe(value);expect(afterRange.config[key]).toBe(value);expect(afterRange.fault).toBeNull();
  await expect(page.locator('#initialization-error')).toBeHidden();await expect(page.locator('#failure-alert')).toBeHidden();
  await expect(input).toHaveValue(String(value));await expect(number).toHaveValue(String(value));
  await number.fill(String(value));await number.press('Enter');await expect(number).toHaveValue(String(value));
 }
 await page.locator('#defaults-button').click();
 await page.waitForFunction(()=>{
  const state=window.__budgetDemo?.getState();
  return state?.sensor?.horizontalFov===90&&state.sensor.sensingRange===75&&state.sensor.downwardPitch===55&&state.fault===null;
 });
 const restored=await page.evaluate(()=>({sensor:window.__budgetDemo.getState().sensor,config:window.__budgetDemo.getConfig()}));
 expect(restored.sensor).toMatchObject({horizontalFov:90,sensingRange:75,downwardPitch:55});
 expect(restored.config).toMatchObject({horizontalFov:90,sensingRange:75,downwardPitch:55});
 await expect(page.locator('#initialization-error')).toBeHidden();await expect(page.locator('#failure-alert')).toBeHidden();
});

test('full-screen cameras and all visible text share the interface font',async({page})=>{
 await page.goto('/budget-planning.html');
 await page.waitForFunction(()=>window.__budgetDemo?.getState()?.vision?.frameCount>1);
 await page.locator('#play-button').click();await page.waitForTimeout(250);
 const pose=await page.evaluate(()=>window.__budgetDemo.getState().pose);
 for(const [id,mode]of [['fpv-button','fpv'],['top-button','top'],['orbit-button','orbit']]) {
  await page.locator(`#${id}`).click();await expect(page.locator(`#${id}`)).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>window.__budgetDemo.getDiagnostics().viewMode)).toBe(mode);
 }
 expect(await page.evaluate(()=>window.__budgetDemo.getState().pose)).toEqual(pose);
 const layout=await page.evaluate(()=>{
  const canvas=document.querySelector('#scene-canvas').getBoundingClientRect();
  const fonts=[...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length&&e.textContent.trim()).map(e=>getComputedStyle(e).fontFamily);
  return {x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height,viewport:[innerWidth,innerHeight],fonts:[...new Set(fonts)],vision:window.__budgetDemo.getState().vision};
 });
 expect(layout.x).toBe(0);expect(layout.y).toBe(0);expect(layout.width).toBe(layout.viewport[0]);expect(layout.height).toBe(layout.viewport[1]);
 expect(layout.fonts).toHaveLength(1);expect(layout.fonts[0]).toContain('system-ui');
 expect(layout.vision.corners).toBeGreaterThan(0);expect(layout.vision.matches).toBeGreaterThan(0);
});

test('compact desktop view keeps map controls visible and telemetry clears the sensor inset',async({page})=>{
 await page.setViewportSize({width:1280,height:720});await page.goto('/budget-planning.html');
 await page.waitForFunction(()=>window.__budgetDemo?.getState()?.time>.4);
 const compact=await page.evaluate(()=>{
  const body=document.querySelector('.view-panel .panel-body').getBoundingClientRect();
  const map=document.querySelector('.view-modes').getBoundingClientRect();
  const sensor=document.querySelector('.sensor-inset').getBoundingClientRect();
  const telemetry=document.querySelector('.telemetry-drawer').getBoundingClientRect();
  return {body:{top:body.top,bottom:body.bottom},map:{top:map.top,bottom:map.bottom},sensor:{left:sensor.left,right:sensor.right},telemetry:{left:telemetry.left,right:telemetry.right}};
 });
 expect(compact.map.top).toBeGreaterThanOrEqual(compact.body.top-1);
 expect(compact.map.bottom).toBeLessThanOrEqual(compact.body.bottom+1);
 expect(compact.telemetry.right).toBeLessThanOrEqual(compact.sensor.left-8);
 await page.locator('.telemetry-drawer > summary').click();
 const open=await page.evaluate(()=>{
  const sensor=document.querySelector('.sensor-inset').getBoundingClientRect();
  const telemetry=document.querySelector('.telemetry-drawer').getBoundingClientRect();
  return {sensor:{left:sensor.left,right:sensor.right,top:sensor.top,bottom:sensor.bottom},telemetry:{left:telemetry.left,right:telemetry.right,top:telemetry.top,bottom:telemetry.bottom}};
 });
 expect(open.telemetry.right).toBeLessThanOrEqual(open.sensor.left-8);
 expect(open.telemetry.bottom).toBeGreaterThan(open.telemetry.top);
 expect(open.sensor.bottom).toBeLessThanOrEqual(720);
 if(test.info().project.name==='chromium') {
  await page.locator('#world-select').selectOption('ann-arbor');
  await page.waitForFunction(()=>window.__budgetDemo.getDiagnostics().world==='ann-arbor'&&window.__budgetDemo.getState()?.vision?.frameCount>1);
  await page.locator('#scene-canvas').focus();await page.keyboard.press('Space');
  await page.screenshot({path:test.info().outputPath('full-screen-demo.png')});
 }
});

test('rapid restarts ignore stale workers and persisted page lifecycle resumes safely',async({page})=>{
 await page.goto('/budget-planning.html');await page.waitForFunction(()=>window.__budgetDemo?.getState()?.time>.4);
 await page.evaluate(()=>{
  window.__budgetDemo.setWorld('tucson');
  window.__budgetDemo.setWorld('ann-arbor');
  window.__budgetDemo.setWorld('farm');
 });
 await page.waitForFunction(()=>window.__budgetDemo?.getDiagnostics().world==='farm'&&window.__budgetDemo.getState()?.time>.4);
 await expect(page.locator('#play-button')).toBeEnabled();
 const before=await page.evaluate(()=>({time:window.__budgetDemo.getState().time,lifecycle:window.__budgetDemo.getLifecycle()}));
 expect(before.lifecycle.workerActive).toBe(true);expect(before.lifecycle.pageSuspended).toBe(false);
 await page.evaluate(()=>{const event=new Event('pagehide');Object.defineProperty(event,'persisted',{value:true});window.dispatchEvent(event);});
 const paused=await page.evaluate(()=>window.__budgetDemo.getLifecycle());
 expect(paused.pageSuspended).toBe(true);expect(paused.workerActive).toBe(true);expect(paused.playing).toBe(false);
 // Navigation may dispatch pagehide before visibilitychange. Preserve the
 // intent to resume instead of replacing it with the already-suspended state.
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(150);
 const held=await page.evaluate(()=>window.__budgetDemo.getState().time);
 expect(held-before.time).toBeLessThan(.2);
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));const event=new Event('pageshow');Object.defineProperty(event,'persisted',{value:true});window.dispatchEvent(event);});
 await page.waitForFunction(()=>window.__budgetDemo.getLifecycle().pageSuspended===false&&window.__budgetDemo.getLifecycle().playing===true);
 await page.waitForFunction(time=>window.__budgetDemo.getState()?.time>time+.2,before.time);
 const restored=await page.evaluate(()=>({state:window.__budgetDemo.getState(),lifecycle:window.__budgetDemo.getLifecycle()}));
 expect(restored.state.fault).toBeNull();expect(restored.lifecycle.workerActive).toBe(true);expect(restored.lifecycle.runId).toBe(before.lifecycle.runId);
});
