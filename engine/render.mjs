import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {assertGuide} from '../dist/guide-schema.js';

const assets=new Map([
 ['render.html','text/html; charset=utf-8'],
 ...['render-capture.js','generated-viewer.js','guide-state.js','guide-schema.js','vendor/OrbitControls.js','vendor/three.module.js','vendor/three.core.js'].map(path=>[path,'text/javascript; charset=utf-8'])
]);

export {planGuideStages} from '../dist/render-plan.js';
import {planGuideStages} from '../dist/render-plan.js';

async function serveRenderer(signal){
 const files=new Map(await Promise.all([...assets].map(async([name,type])=>[name,{type,bytes:await readFile(new URL(`../dist/${name}`,import.meta.url))}])));
 signal.throwIfAborted();
 const server=createServer((request,response)=>{
  const name=request.url?.slice(1),asset=files.get(name);
  if(request.method!=='GET'||!asset){response.writeHead(404).end();return;}
  response.writeHead(200,{'Content-Type':asset.type,'Content-Length':asset.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});response.end(asset.bytes);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return{server,origin:`http://127.0.0.1:${server.address().port}`};
}

/** Render validated guide data with the production player in an isolated browser. */
export async function renderGuideStages(guide,{signal,onStage=()=>{},overviewPage=1}={}){
 const stages=planGuideStages(guide,{overviewPage});
 const boundedSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(120000)]);
 boundedSignal.throwIfAborted();
 onStage(`Rendering the complete product and ${guide.steps.length} assembly stages…`);
 let browser,server;
 const stop=()=>{void browser?.close().catch(()=>{});server?.closeAllConnections();server?.close();};
 boundedSignal.addEventListener('abort',stop,{once:true});
 try{
  const hosted=await serveRenderer(boundedSignal);server=hosted.server;
  boundedSignal.throwIfAborted();
  const {chromium}=await import('playwright');
  try{browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:30000});}
  catch(error){boundedSignal.throwIfAborted();throw new Error('The 3D render checker could not start Chromium. Install its browser with npm run render-browser; visual verification cannot continue. '+error.message,{cause:error});}
  boundedSignal.throwIfAborted();
  const context=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:false});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   return url.origin===hosted.origin&&!url.search&&assets.has(url.pathname.slice(1))&&route.request().method()==='GET'?route.continue():route.abort('blockedbyclient');
  });
  const page=await context.newPage(),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(`${hosted.origin}/render.html`,{waitUntil:'load',timeout:20000});
  await page.waitForFunction(()=>typeof globalThis.unfoldCapture?.load==='function');
  await page.evaluate(value=>globalThis.unfoldCapture.load(value),guide);
  const captures=[];
  for(const stage of stages){
   boundedSignal.throwIfAborted();
   if(pageErrors.length)throw new Error('The 3D renderer failed: '+pageErrors.join('; '));
   await page.evaluate(value=>globalThis.unfoldCapture.frame(value),stage);
   const png=await page.screenshot({type:'png',animations:'disabled',timeout:15000});
   if(pageErrors.length)throw new Error('The 3D renderer failed: '+pageErrors.join('; '));
   captures.push({id:stage.id,stepIndex:stage.stepIndex,phase:stage.phase,sourcePage:stage.sourcePage,imageDataUrl:'data:image/png;base64,'+png.toString('base64')});
  }
  boundedSignal.throwIfAborted();
  return captures;
 }catch(error){
  boundedSignal.throwIfAborted();throw error;
 }finally{
  boundedSignal.removeEventListener('abort',stop);
  await browser?.close().catch(()=>{});
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 }
}
