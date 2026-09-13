import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {KNARREVIK,knarrevikReferenceGuide} from '../dist/knarrevik.js';
import {validateGuide} from '../dist/guide-schema.js';
import {CATEGORIES,validateScan,summarizeDetections,checklistStatus} from '../dist/scan-state.js';
import {handlePartsScan,SCAN_LIMITS} from '../server/parts-scan.mjs';
import {prepareScanPhoto} from '../dist/scan-image.js';

const photo=await readFile(new URL('../dist/reference/knarrevik-page-6.jpg',import.meta.url));
const match=(category,quantity=1,extra={})=>({category,quantity,certainty:'likely',countCertainty:'clear',box:[.1,.1,.2,.3],note:'Test observation',...extra});
const scanned=(detections=[])=>({scene:'laid_out_parts',summary:'Test observations only.',advice:'Review counts.',detections});
const provider=data=>async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}]});
const req=(headers={},body=photo,signal)=>new Request('http://localhost/api/parts-scan',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Unfold-Scan':'1',...headers},body,signal,...(body instanceof ReadableStream?{duplex:'half'}:{})});
const env={OPENAI_API_KEY:'test-not-a-credential'};

test('24-megapixel phone photos are resized before upload, with metadata-free JPEG output',async()=>{
  const originalBitmap=globalThis.createImageBitmap,originalDocument=globalThis.document;
  let closed=false,drawn=false;const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(){drawn=true;}}),toBlob(callback,type,quality){assert.equal(type,'image/jpeg');assert.equal(quality,.9);callback(new Blob(['compressed-pixels'],{type}));}};
  globalThis.createImageBitmap=async()=>({width:5712,height:4284,close(){closed=true;}});globalThis.document={createElement:()=>canvas};
  try{const result=await prepareScanPhoto(new File([photo],'phone-original.jpg',{type:'image/jpeg'}));assert.equal(canvas.width,2000);assert.equal(canvas.height,1500);assert(drawn&&closed);assert.equal(result.type,'image/jpeg');assert.equal(result.name,'parts-photo.jpg');assert.equal(await result.text(),'compressed-pixels');}
  finally{if(originalBitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=originalBitmap;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
});

test('KNARREVIK physical inventory matches the verified manual and reference geometry validates',()=>{
  assert.deepEqual(KNARREVIK.parts.map(p=>p.expected),[2,4,16,1]);
  assert.deepEqual(validateGuide(knarrevikReferenceGuide()),[]);
  assert.equal(knarrevikReferenceGuide().parts.length,23);
});
test('unseen parts stay zero, excess is preserved, uncertainty and unmatched parts prevent automatic completeness',()=>{
  const detections=[match('tray'),match('screw',19,{countCertainty:'approximate'}),match('unknown')];
  assert.deepEqual(summarizeDetections(detections).map(p=>[p.observed,p.uncertain]),[[1,false],[0,false],[19,true],[0,false]]);
  assert.equal(checklistStatus(detections,{}).countsMatch,false);
  const reviewed=Object.fromEntries(KNARREVIK.parts.map(p=>[p.id,{count:p.expected,checked:true}]));
  assert.equal(checklistStatus(detections,reviewed).countsMatch,false);
  assert.equal(checklistStatus([],reviewed).countsMatch,true);
  reviewed.tray.count=null;assert.equal(checklistStatus([],reviewed).countsMatch,false);
});
test('malformed model counts, categories, boxes, extra fields and invented loose parts in assembled scenes are rejected',()=>{
  for(const d of [match('rail'),match('tray',-1),match('tray',1.5),match('tray',1,{box:[.8,.1,.5,.2]}),match('tray',1,{box:[.1,.1,0,.2]}),match('tray',1,{script:'x'})])assert.throws(()=>validateScan(scanned([d])));
  assert.throws(()=>validateScan({...scanned([match('tray')]),scene:'assembled_product'}));
  assert.throws(()=>validateScan({...scanned(),extra:'unexpected'}));
  assert.equal(validateScan({...scanned(),scene:'unclear'}).detections.length,0);
});
test('endpoint validates origin, size, type and actual image before sending data to the provider',async()=>{
  let called=0;const options={fetchImpl:()=>{called++;throw new Error('Must not be called');}};
  assert.equal((await handlePartsScan(req({Origin:'https://other.test'}),env,options)).status,403);
  assert.equal((await handlePartsScan(req({'X-Unfold-Scan':'0'}),env,options)).status,400);
  assert.equal((await handlePartsScan(req({'Content-Type':'text/html'}),env,options)).status,415);
  assert.equal((await handlePartsScan(req({'Content-Length':String(SCAN_LIMITS.bytes+1)}),env,options)).status,413);
  assert.equal((await handlePartsScan(req({},'not really a photo'),env,options)).status,415);
  assert.equal((await handlePartsScan(req(),{},options)).status,503);
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(SCAN_LIMITS.bytes+1));c.close();}});
  assert.equal((await handlePartsScan(req({},stream),env,options)).status,413);
  assert.equal(called,0);
});
test('provider request separates manual references from the final scene, disables storage and returns validated data without secrets',async()=>{
  let payload;const fetchImpl=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');payload=JSON.parse(options.body);return provider(scanned([match('tray')]))();};
  const response=await handlePartsScan(req(),env,{fetchImpl});assert.equal(response.status,200);
  const text=await response.text();assert(!text.includes(env.OPENAI_API_KEY));assert.equal(JSON.parse(text).result.detections[0].quantity,1);
  assert.equal(payload.store,false);assert.equal(payload.text.format.strict,true);
  assert.equal(payload.input[0].content.at(-2).text,'SCENE PHOTO — inspect and count only this final image:');
  assert.match(payload.input[0].content.at(-1).image_url,/^data:image\/jpeg;base64,/);
  assert.match(payload.instructions,/NEVER evidence/);
  const malformed=await handlePartsScan(req(),env,{fetchImpl:provider(scanned([match('tray',-3)]))});assert.equal(malformed.status,502);
});
test('cancellation and timeout release concurrency slots and abort upstream work',async()=>{
  let started=0;let wake;const both=new Promise(r=>wake=r);
  const fetchImpl=(_url,{signal})=>new Promise((resolve,reject)=>{if(++started===2)wake();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  const a=new AbortController(),b=new AbortController();
  const first=handlePartsScan(req({},photo,a.signal),env,{fetchImpl});const second=handlePartsScan(req({},photo,b.signal),env,{fetchImpl});await both;
  assert.equal((await handlePartsScan(req(),env,{fetchImpl})).status,429);a.abort();b.abort();
  assert.deepEqual((await Promise.all([first,second])).map(r=>r.status),[499,499]);
  const keepAlive=setTimeout(()=>{},100);try{const timed=await handlePartsScan(req(),env,{fetchImpl,timeout:10});assert.equal(timed.status,504);}finally{clearTimeout(keepAlive);}
  assert.equal((await handlePartsScan(req(),env,{fetchImpl:provider(scanned())})).status,200);
});
test('photo review UI changes counts and matches, clears checks after edits, and replaces rather than accumulates scans',async()=>{
  const {document,window}=parseHTML(await readFile(new URL('../dist/scan.html',import.meta.url),'utf8'));
  const create=document.createElement.bind(document);document.createElement=tag=>{const el=create(tag);if(tag==='select')Object.defineProperty(el,'value',{value:'',writable:true});return el;};
  const source=(await readFile(new URL('../dist/scan.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  let counter=0;const context={document,KNARREVIK,knarrevikReferenceGuide,CATEGORIES,validateScan,summarizeDetections,checklistStatus,prepareScanPhoto:async file=>file,structuredClone,Blob,File,AbortController,setTimeout,addEventListener:()=>{},URL:{createObjectURL:()=>`blob:test-${++counter}`,revokeObjectURL:()=>{}},fetch:async url=>url.endsWith('scan-health')?Response.json({scanAvailable:true}):Response.json({kitId:KNARREVIK.id,manualRevision:KNARREVIK.revision,result:scanned([match('tray'),match('screw',3,{countCertainty:'approximate'})])})};
  vm.runInNewContext(source,context);
  await new Promise(r=>setTimeout(r,0));
  const input=document.querySelector('#scan-file');input.files=[new File([photo],'parts.jpg',{type:'image/jpeg'})];input.onchange();await new Promise(r=>setTimeout(r,0));
  await document.querySelector('#scan-submit').onclick();
  assert.equal(document.querySelectorAll('.photo-marker').length,2);
  assert.equal(document.querySelector('[aria-label="Visible count for Metal trays"]').value,'1');
  const check=document.querySelector('[aria-label="I checked Metal trays"]');check.checked=true;check.onchange();assert.match(document.querySelector('#scan-summary').textContent,/1 of 4/);
  const count=document.querySelector('[aria-label="Visible count for Metal trays"]');count.setCustomValidity=()=>{};count.value='2';count.oninput();assert.equal(check.checked,false);
  const category=document.querySelector('[aria-label="Part type for match 1"]');category.value='leg';category.onchange();assert.equal(document.querySelector('[aria-label="Visible count for Metal trays"]').value,'0');
  assert.equal(document.querySelector('[aria-label="Visible count for Angle legs"]').value,'1');
  input.files=[new File([photo],'new-photo.jpg',{type:'image/jpeg'})];input.onchange();await new Promise(r=>setTimeout(r,0));
  assert.equal(document.querySelectorAll('.photo-marker').length,0);assert.match(document.querySelector('#scan-summary').textContent,/Nothing scanned/);
  assert.equal(document.querySelector('#download-checklist').disabled,true);
});
