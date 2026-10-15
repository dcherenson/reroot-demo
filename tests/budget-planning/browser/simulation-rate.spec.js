import {test,expect} from '@playwright/test';

test('simulation rate applies live, accelerates playback, preserves pause and survives restarts',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');
 await page.waitForFunction(()=>window.__budgetDemo?.getState()?.time>.4);
 const slider=page.getByRole('slider',{name:'Simulation rate'});
 await expect(slider).toHaveValue('5');
 await expect(page.locator('#simulation-rate-value')).toHaveText('5×');
 await expect(slider).toHaveAttribute('aria-valuetext','5 times normal speed');
 expect(await page.evaluate(()=>window.__budgetDemo.getLifecycle().simulationRate)).toBe(5);
 // Compare playback against the unchanged 1x cadence even though the app now defaults to 5x.
 await slider.fill('1');
 await expect(slider).toHaveValue('1');
 const measure=async()=>{
  const before=await page.evaluate(()=>({time:window.__budgetDemo.getState().time,wall:performance.now()}));
  await page.waitForTimeout(1600);
  return page.evaluate(before=>({simulated:window.__budgetDemo.getState().time-before.time,wall:(performance.now()-before.wall)/1000}),before);
 };
 const normal=await measure();
 await page.locator('#scene-canvas').focus();await page.keyboard.press('Space');
 await page.waitForTimeout(250);
 const before=await page.evaluate(()=>({state:window.__budgetDemo.getState(),lifecycle:window.__budgetDemo.getLifecycle(),config:window.__budgetDemo.getConfig()}));
 await slider.fill('10');
 await expect(page.locator('#simulation-rate-value')).toHaveText('10×');
 await expect(slider).toHaveAttribute('aria-valuetext','10 times normal speed');
 await page.waitForTimeout(250);
 const paused=await page.evaluate(()=>({state:window.__budgetDemo.getState(),lifecycle:window.__budgetDemo.getLifecycle(),config:window.__budgetDemo.getConfig()}));
 expect(paused.state.pose).toEqual(before.state.pose);
 expect(paused.state.time).toEqual(before.state.time);
 expect(paused.config).toEqual(before.config);
 expect(paused.lifecycle).toMatchObject({runId:before.lifecycle.runId,playing:false,simulationRate:10});
 await page.locator('#scene-canvas').focus();await page.keyboard.press('Space');
 const fast=await measure();
 expect(fast.simulated/fast.wall).toBeGreaterThan((normal.simulated/normal.wall)*1.3);
 test.info().annotations.push({type:'playback-rate',description:JSON.stringify({normal,fast})});
 expect(await page.evaluate(()=>window.__budgetDemo.getLifecycle().runId)).toBe(before.lifecycle.runId);
 expect(await page.evaluate(()=>window.__budgetDemo.getState().fault)).toBeNull();
 // Mission restarts retain a playback preference; restoring defaults returns it to 5x.
 await page.locator('#scene-canvas').focus();await page.keyboard.press('Space');
 await page.selectOption('#world-select','tucson');
 await page.waitForFunction(()=>window.__budgetDemo.getState()?.worldId==='tucson');
 expect(await page.evaluate(()=>window.__budgetDemo.getLifecycle())).toMatchObject({playing:false,simulationRate:10});
 await expect(slider).toHaveValue('10');
 await page.locator('#reset-button').click();
 await page.waitForFunction(()=>window.__budgetDemo.getState()!==null);
 await expect(slider).toHaveValue('10');
 await page.locator('#defaults-button').click();
 await page.waitForFunction(()=>window.__budgetDemo.getState()!==null);
 await expect(slider).toHaveValue('5');
 expect(await page.evaluate(()=>window.__budgetDemo.getLifecycle().simulationRate)).toBe(5);
 expect(errors).toEqual([]);
});

test('right-side playback slider stays visible and clears sensor and expanded telemetry',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>window.__budgetDemo?.getState()!==null);
 await expect(page.locator('.world-topbar')).not.toContainText('Interactive research demo');
 await expect(page.locator('#demo-title')).toHaveText('Autonomy Architectures for Safe Planning in Unknown Environments Under Budget Constraints');
 await page.locator('.telemetry-drawer > summary').click();
 for(const viewport of [{width:1440,height:1000},{width:1280,height:720},{width:1024,height:768},{width:768,height:844},{width:640,height:844},{width:390,height:844},{width:320,height:844}]){
  await page.setViewportSize(viewport);
  const layout=await page.evaluate(()=>{
   const rect=selector=>document.querySelector(selector).getBoundingClientRect();
   const slider=rect('#simulation-rate-input'),panel=rect('.simulation-rate-panel');
   const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
   return {
    visible:slider.left>=0&&slider.top>=0&&slider.right<=innerWidth&&slider.bottom<=innerHeight,
    inside:slider.left>=panel.left&&slider.right<=panel.right&&slider.top>=panel.top&&slider.bottom<=panel.bottom,
    right:panel.right===rect('.sensor-inset').right&&innerWidth-panel.right<=18,
    overlaps:['.sensor-inset','.view-panel','.telemetry-drawer','.tuning-panel'].filter(selector=>overlaps(panel,rect(selector))),
    hit:document.elementFromPoint(slider.left+slider.width/2,slider.top+slider.height/2)?.id,
   };
  });
  expect(layout,{message:JSON.stringify(viewport)}).toEqual({visible:true,inside:true,right:true,overlaps:[],hit:'simulation-rate-input'});
 }
 if(test.info().project.name==='chromium'){
  await page.screenshot({path:test.info().outputPath('simulation-rate-mobile.png')});
  await page.setViewportSize({width:1280,height:720});
  await page.screenshot({path:test.info().outputPath('simulation-rate-desktop.png')});
 }
});
