import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerLibraryStore,canonicalSource} from '../server/library-worker-store.mjs';
import {handleEngineSocket} from '../server/engine-socket.mjs';
import {handleLibrary} from '../server/library.mjs';

test('hosted library search sorts the undated demo alongside saved manuals without crashing',async()=>{
 let value=null;
 const bucket={async get(){return value?{etag:'1',size:value.length,json:async()=>JSON.parse(value)}:null;},async put(_key,body){value=body;return{etag:'1'};}};
 const store=createWorkerLibraryStore({BUCKET:bucket});
 await store.update(data=>{data.records.push({...data.records[0],id:'a'.repeat(24),product:'KNARREVIK newer manual',discoveredAt:'2026-09-13T12:00:00Z'});});
 const before=value;
 for(const query of ['', 'KNARREVIK']){
  const response=await handleLibrary(new Request('https://unfold.example/api/library?q='+query),{libraryStore:createWorkerLibraryStore({BUCKET:bucket})});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.records.length,2);
  assert.equal(result.records[0].id,'a'.repeat(24));assert.equal(result.records[1].discoveredAt,undefined);
 }
 assert.equal(value,before,'Reading older entries does not rewrite or erase the stored library.');
});

test('saved-manual ordering tolerates invalid dates and absent cache flags, preserving cached-first and chronological order',async()=>{
 const seed=(await createWorkerLibraryStore({}).read()).records[0];
 const record=(id,extra)=>({...seed,id:id.repeat(24),...extra});
 const records=[record('f',{pdfCached:undefined,discoveredAt:'2026-09-13T14:00:00Z'}),record('b',{pdfCached:false,discoveredAt:null}),
  record('e',{pdfCached:true,discoveredAt:'2026-09-13T11:30:00Z'}),record('a',{pdfCached:false,discoveredAt:42}),
  record('c',{pdfCached:false,discoveredAt:'invalid'}),record('d',{pdfCached:true,discoveredAt:'2026-09-13T13:00:00+02:00'})];
 const store={read:async()=>({records,queries:{}})};
 const response=await handleLibrary(new Request('https://unfold.example/api/library'),{libraryStore:store});
 assert.equal(response.status,200);const result=await response.json();
 assert.deepEqual(result.records.map(r=>r.id[0]),['e','d','f','a','b','c']);
 assert.deepEqual(records.map(r=>r.id[0]),['f','b','e','a','c','d']);
});

test('hosted engine refuses cross-origin sockets and missing credentials before opening a session',()=>{
 const req=(headers={})=>new Request('https://unfold.example/api/convert-socket',{headers});
 assert.equal(handleEngineSocket(req({origin:'https://other.example',upgrade:'websocket'}),{OPENAI_API_KEY:'test'}).status,403);
 assert.equal(handleEngineSocket(req({origin:'https://unfold.example'}),{OPENAI_API_KEY:'test'}).status,426);
 assert.equal(handleEngineSocket(req({origin:'https://unfold.example',upgrade:'websocket'}),{}).status,503);
});
test('hosted library preserves concurrent updates and keeps the prepared KNARREVIK manual available',async()=>{
 let value=null,version=0;
 const bucket={async get(){const snapshot=value,etag=String(version);return snapshot?{etag,size:snapshot.length,json:async()=>JSON.parse(snapshot)}:null;},async put(key,body,{onlyIf}){if(value?onlyIf.etagMatches!==String(version):onlyIf.etagDoesNotMatch!=='*')return null;value=body;return{etag:String(++version)};}};
 const store=createWorkerLibraryStore({BUCKET:bucket,ASSETS:{fetch:async()=>new Response('%PDF-1.7 test')}});
 await Promise.all([store.update(d=>{d.queries.one={query:'one'};}),store.update(d=>{d.queries.two={query:'two'};})]);
 const data=await store.read();assert(data.queries.one);assert(data.queries.two);assert.match(data.records[0].product,/KNARREVIK/);
 assert.equal(new TextDecoder().decode(await store.getPdf(data.records[0].id)),'%PDF-1.7 test');
 await assert.rejects(store.validateSource('https://attacker.example/manual.pdf'),/supports IKEA/);
 assert.throws(()=>canonicalSource('https://127.0.0.1/a.pdf'),/public HTTPS/);
});

test('HTTP render relay receives requested browser captures and deletes temporary data',async()=>{
 const {createR2Renderer,receiveRenders}=await import('../server/render-relay.mjs');
 const {fixture}=await import('./fixture.mjs');
 const objects=new Map(),bucket={async get(key){const value=objects.get(key);return value?{json:async()=>JSON.parse(value)}:null;},async put(key,value){objects.set(key,value);},async delete(key){objects.delete(key);}};
 let submitted;
 const render=createR2Renderer(bucket,(event,data)=>{assert.equal(event,'render');submitted=receiveRenders(new Request('https://unfold.example/api/render/'+data.requestId,{method:'POST',headers:{Origin:'https://unfold.example','X-Unfold-Render':'1'},body:JSON.stringify(data.stages.map(stage=>({...stage,imageDataUrl:'test-image'})))}),{BUCKET:bucket});});
 const captures=await render(fixture(),{signal:new AbortController().signal,overviewPage:1});assert.equal((await submitted).status,200);assert.equal(captures.length,5);assert.equal(objects.size,0);
});

test('browser can fetch render work while the conversion response is buffered',async()=>{
 const {createR2Renderer,pollRender,receiveRenders}=await import('../server/render-relay.mjs');
 const {fixture}=await import('./fixture.mjs');
 const objects=new Map(),bucket={async get(key){const value=objects.get(key);return value?{json:async()=>JSON.parse(value)}:null;},async put(key,value){objects.set(key,value);},async delete(key){objects.delete(key);}};
 const id=crypto.randomUUID();let submit;
 const render=createR2Renderer(bucket,()=>{submit=(async()=>{
  const response=await pollRender(new Request('https://unfold.example/api/conversion-render/'+id),{BUCKET:bucket});
  const job=await response.json();assert.equal(job.stages.length,5);
  return receiveRenders(new Request('https://unfold.example/api/render/'+job.requestId,{method:'POST',headers:{Origin:'https://unfold.example','X-Unfold-Render':'1'},body:JSON.stringify(job.stages.map(stage=>({...stage,imageDataUrl:'test'})))}),{BUCKET:bucket});
 })();},id);
 assert.equal((await render(fixture(),{signal:new AbortController().signal,overviewPage:1})).length,5);
 assert.equal((await submit).status,200);assert.equal(objects.size,0);
 assert.equal((await pollRender(new Request('https://unfold.example/api/conversion-render/invalid'),{BUCKET:bucket})).status,404);
});
