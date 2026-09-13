import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerLibraryStore,canonicalSource} from '../server/library-worker-store.mjs';
import {handleEngineSocket} from '../server/engine-socket.mjs';

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
