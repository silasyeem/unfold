import test from 'node:test';
import assert from 'node:assert/strict';
import site from '../server/site.mjs';

test('hosted entry preserves scanner, voice, saved demo assets and explicit local conversion boundary',async()=>{
 const env={ASSETS:{fetch:async request=>new Response(new URL(request.url).pathname)}};
 const get=path=>site.fetch(new Request('https://unfold.example'+path),env);
 assert.equal((await (await get('/api/scan-health')).json()).scanAvailable,false);
 assert.deepEqual(await (await get('/api/voice/readiness')).json(),{ready:false,acceptsClientKey:true,model:'gpt-live-1'});
 assert.equal((await (await get('/api/health')).json()).conversionAvailable,false);
 for(const path of ['/examples/knarrevik.unfold.json','/reference/knarrevik-manual.pdf','/scan.html','/screws.html'])assert.equal(await (await get(path)).text(),path);
 assert.equal((await get('/api/library')).status,503);
 assert.equal((await get('/api/unknown')).status,404);
});
