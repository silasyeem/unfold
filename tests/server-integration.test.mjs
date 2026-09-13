import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnfoldServer} from '../server/local.mjs';

test('one local server keeps engine, photo, library, scanner and voice routes available',async t=>{
 const voiceCalls=[];
 const libraryStore={read:async()=>({version:1,records:[],queries:{}})};
 const server=createUnfoldServer({env:{OPENAI_API_KEY:'integration-fixture-key',OPENAI_MODEL:'gpt-6-astra',OPENAI_BACKEND_MODEL:'configured-voice-backend',libraryStore},voiceOptions:{fetchImpl:async(url,options)=>{voiceCalls.push({url,options});return {ok:true,json:async()=>({session:{id:'voice-fixture',secret:'must-not-return'},transport:{sdp:'answer'}})};}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const origin='http://127.0.0.1:'+server.address().port;
 const engine=await fetch(origin+'/engine.html');assert.equal(engine.status,200);assert.match(await engine.text(),/engine-app\.js/);assert.equal(engine.headers.get('permissions-policy'),'microphone=(self)');
 assert.equal((await fetch(origin+'/')).status,200);
 assert.equal((await fetch(origin+'/scan.html')).status,200);assert.equal((await fetch(origin+'/screws.html')).status,200);
 assert.equal((await fetch(origin+'/server/index.js')).status,404);assert.equal((await fetch(origin+'/client/index.html')).status,404);
 assert.deepEqual(await (await fetch(origin+'/api/health')).json(),{conversionAvailable:true,model:'gpt-6-astra',maxBytes:8*1024*1024,maxPages:40});
 assert.equal((await fetch(origin+'/api/convert',{method:'POST',headers:{'X-Unfold-Convert':'1','Content-Type':'text/plain',Origin:origin},body:'not a PDF'})).status,415);
 assert.equal((await fetch(origin+'/api/photos')).status,405);
 const library=await fetch(origin+'/api/library');assert.equal(library.status,200);assert.deepEqual((await library.json()).records,[]);
 const scanHealth=await fetch(origin+'/api/scan-health');assert.equal(scanHealth.status,200);assert.equal((await scanHealth.json()).scanAvailable,true);
 const badScan=await fetch(origin+'/api/parts-scan',{method:'POST',headers:{Origin:origin,'X-Unfold-Scan':'1','Content-Type':'text/plain'},body:'not an image'});assert.equal(badScan.status,415);
 const readiness=await fetch(origin+'/api/voice/readiness');assert.deepEqual(await readiness.json(),{ready:true,acceptsClientKey:true,model:'gpt-live-1'});assert.equal(voiceCalls.length,0);
 const voice=await fetch(origin+'/api/voice/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({sdp:'offer'})});assert.equal(voice.status,201);assert.deepEqual(await voice.json(),{session:{id:'voice-fixture'},transport:{sdp:'answer'}});
 assert.equal(voiceCalls.length,1);assert.equal(voiceCalls[0].url,'https://api.openai.com/v1/live/sessions');const request=JSON.parse(voiceCalls[0].options.body);assert.equal(request.session.delegation.responses.model,'configured-voice-backend');assert.doesNotMatch(voiceCalls[0].options.body,/integration-fixture-key/);
 const denied=await fetch(origin+'/api/voice/session',{method:'POST',headers:{Origin:'https://different.example','Content-Type':'application/json'},body:JSON.stringify({sdp:'offer'})});assert.equal(denied.status,403);assert.equal(voiceCalls.length,1);
});
