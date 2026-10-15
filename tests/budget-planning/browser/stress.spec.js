import {test,expect} from '@playwright/test';
test('100 scene resets release renderer resources and retained heap',async({page,browserName})=>{
 test.skip(browserName!=='chromium','Chromium CDP supplies explicit GC for memory comparison.');test.setTimeout(180_000);
 await page.goto('/budget-planning.html');await page.waitForFunction(()=>window.__budgetDemo?.getState()!==null);
 await page.locator('#play-button').click();
 const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.enable');
 const samples=[];
 for(let i=0;i<100;i++){
  await page.evaluate(id=>window.__budgetDemo.setWorld(id),['farm','tucson','ann-arbor'][i%3]);
  await page.waitForFunction(()=>window.__budgetDemo?.getState()!==null);
  if(i%10===9){await cdp.send('HeapProfiler.collectGarbage');const usage=await cdp.send('Runtime.getHeapUsage');samples.push({iteration:i+1,heap:usage.usedSize,backingStorage:usage.backingStorageSize,renderer:await page.evaluate(()=>window.__budgetDemo.getDiagnostics())});}
 }
 console.log('RESET_MEMORY',JSON.stringify(samples));
 const early=samples[2].heap,late=samples.at(-1).heap;
 expect(late-early).toBeLessThan(8*1024*1024);
 // Typed-array storage lives outside the ordinary JS heap. Compare matching
 // worlds so their different feature/scenery capacities do not skew the delta.
 for(const remainder of [0,1,2]){
  const sameWorld=samples.filter(s=>s.iteration%3===remainder&&Number.isFinite(s.backingStorage));
  if(sameWorld.length>1)expect(sameWorld.at(-1).backingStorage-sameWorld[0].backingStorage).toBeLessThan(2*1024*1024);
 }
 for(const s of samples){expect(s.renderer.geometries).toBeLessThan(400);expect(s.renderer.textures).toBeLessThan(20);}
});
