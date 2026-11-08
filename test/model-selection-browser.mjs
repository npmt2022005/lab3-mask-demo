import {chromium} from 'playwright';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createApp} from '../server.mjs';
import {createModelSwitcher} from '../model-switcher.mjs';

const temp=await mkdtemp(join(tmpdir(),'lab3-model-test-'));
const {data:rgb}=await sharp('public/demo/multi-scene.jpg').resize(640,480,{fit:'contain'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
const plane=640*480,yuv=Buffer.alloc(plane*1.5),clamp=v=>Math.max(0,Math.min(255,Math.round(v)));
for(let y=0;y<480;y++)for(let x=0;x<640;x++){
 const i=y*640+x,j=i*3,r=rgb[j],g=rgb[j+1],b=rgb[j+2];yuv[i]=clamp(.299*r+.587*g+.114*b);
 if(y%2===0&&x%2===0){const uv=y/2*320+x/2;yuv[plane+uv]=clamp(-.168736*r-.331264*g+.5*b+128);yuv[plane+plane/4+uv]=clamp(.5*r-.418688*g-.081312*b+128);}
}
const y4m=join(temp,'camera.y4m');await writeFile(y4m,Buffer.concat([Buffer.from('YUV4MPEG2 W640 H480 F5:1 Ip A1:1 C420jpeg\n'),...Array.from({length:5},()=>Buffer.concat([Buffer.from('FRAME\n'),yuv]))]));
const classifier=await createModelSwitcher(),server=createApp(classifier).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${y4m}`]});
 const context=await browser.newContext({permissions:['camera'],acceptDownloads:true});const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>health?.models?.length===2);
 assert.equal(await page.locator('#modelSelect').inputValue(),'nano');
 await page.locator('#sampleAgain').click();await page.locator('#predictOnce').click();await page.waitForFunction(()=>frameSamples.length===1);
 const nano=await page.evaluate(()=>lastResult.model_id);assert.equal(await page.evaluate(()=>lastResult.model_key),'nano');
 await page.locator('#modelSelect').selectOption('small');assert.equal(await page.evaluate(()=>lastResult),null);
 assert.equal(await page.locator('#saveImage').isDisabled(),true);
 await page.locator('#predictOnce').click();await page.waitForFunction(()=>frameSamples.length===2);
 const small=await page.evaluate(()=>lastResult.model_id);assert.notEqual(nano,small);assert.equal(await page.evaluate(()=>lastResult.model_key),'small');
 assert.ok(await page.evaluate(()=>frameSamples[1].model_load_ms>0));
 // Switching while a request is pending must discard its eventual response.
 let release;await page.route('**/predict?model=small',async route=>{await new Promise(r=>{release=r});await route.continue().catch(()=>{});});
 await page.locator('#predictOnce').click();await page.waitForFunction(()=>processing);
 while(!release)await new Promise(r=>setTimeout(r,10));
 await page.locator('#modelSelect').selectOption('nano');release();await page.waitForFunction(()=>!processing);
 await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>frameSamples.length),2);assert.equal(await page.evaluate(()=>lastResult),null);
 await page.unroute('**/predict?model=small');
 // The aborted server request may still be completing; wait for the API to settle.
 await page.waitForTimeout(700);
 await page.locator('#predictOnce').click();await page.waitForFunction(()=>frameSamples.length===3);assert.equal(await page.evaluate(()=>lastResult.model_id),nano);
 const downloadPromise=page.waitForEvent('download');await page.locator('#exportFrames').click();const download=await downloadPromise;
 const csvPath=join(temp,'frames.csv');await download.saveAs(csvPath);const csv=await readFile(csvPath,'utf8');assert.ok(csv.includes('"nano"')&&csv.includes('"small"')&&csv.includes('"model_load_ms"'));
 await page.locator('#openCamera').click();await page.waitForFunction(()=>stream&&preview.videoWidth>0);
 await page.locator('#startLive').click();await page.waitForFunction(()=>frameSamples.length>=5);
 await page.locator('#modelSelect').selectOption('small');await page.waitForFunction(()=>!running&&!processing);
 assert.equal(await page.evaluate(()=>lastResult),null);assert.equal(await page.evaluate(()=>Boolean(stream)),true);
 await page.locator('#closeCamera').click();assert.equal(await page.evaluate(()=>stream),null);
 await mkdir('reports',{recursive:true});await page.screenshot({path:'reports/model-selection-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'reports/model-selection-mobile.png',fullPage:true});
 await page.reload();await page.waitForFunction(()=>health?.models?.length===2);assert.equal(await page.locator('#modelSelect').inputValue(),'small');
 assert.deepEqual(errors,[]);
 await writeFile('reports/model-selection-browser.json',JSON.stringify({passed:true,testedAt:new Date().toISOString(),nano,small,
  checks:['real models/API','nano-small-nano','release/switch load time','cancel stale response','CSV model isolation','fake webcam live switch stops loop','camera release','mobile layout','selection persists'],note:'Only simulated camera from public demo. No physical camera activated.'},null,2));
 console.log('PASS browser model selection, cancellation, CSV and simulated webcam');
}finally{
 await browser?.close();await new Promise(r=>server.close(r));await classifier.dispose();
 if(dirname(resolve(temp))!==resolve(tmpdir())||!basename(temp).startsWith('lab3-model-test-'))throw new Error('Unsafe cleanup');
 await rm(temp,{recursive:true,force:true});
}
