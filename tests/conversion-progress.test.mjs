import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountConversionProgress} from '../dist/conversion-progress.js';
import {HttpEngine} from '../dist/hosted-convert.js';
import {createStageReporter,pollRender} from '../server/render-relay.mjs';

test('progress follows real stages, shows elapsed and stale feedback, and resets after cancellation',()=>{
 const {document}=parseHTML('<div id="progress" hidden></div>'),root=document.querySelector('#progress');
 let clock=1000,tick,cleared=0;
 const ui=mountConversionProgress(root,{now:()=>clock,schedule:fn=>(tick=fn,1),unschedule:()=>cleared++});
 ui.start();assert.equal(root.hidden,false);assert.match(root.textContent,/Step 1 of 5/);
 clock=4000;ui.contact();ui.update('Reading source pages 1–6 of 12…');assert.match(root.textContent,/Step 2 of 5/);
 clock=69000;tick();assert.match(root.textContent,/1:08 elapsed/);assert.match(root.textContent,/taking a while/);assert.match(root.textContent,/65s ago/);
 ui.update('Planning shared dimensions and connections for 81 parts…');assert.match(root.textContent,/Step 4 of 5/);
 ui.update('Building 3D parts: 2 of 6 groups complete…');assert.match(root.textContent,/Step 4 of 5/);
 ui.update('Comparing rendered views 1–4 of 13 with source diagrams…');assert.match(root.textContent,/Step 5 of 5/);
 ui.update('Constructing 3D parts and 6 source-linked steps…');assert.match(root.textContent,/Step 5 of 5/);
 ui.stop();assert.equal(root.hidden,true);assert.equal(cleared,1);
 ui.start();assert.match(root.textContent,/Step 1 of 5/);assert.match(root.textContent,/0:00 elapsed/);ui.stop();
});

test('stage polling works before browser render work exists, preserves ordering and cleans up',async()=>{
 const objects=new Map(),bucket={async put(key,value){objects.set(key,value);},async get(key){const value=objects.get(key);return value?{json:async()=>JSON.parse(value)}:null;},async delete(key){objects.delete(key);}};
 const id=crypto.randomUUID(),reporter=createStageReporter(bucket,id);
 const first=reporter.report({message:'Reading source pages 1–6 of 12…',sequence:1,updatedAt:1000});
 const second=reporter.report({message:'Cross-checking the complete product…',sequence:2,updatedAt:2000});
 await Promise.all([first,second]);
 const response=await pollRender(new Request('https://unfold.example/api/conversion-render/'+id),{BUCKET:bucket});
 const data=await response.json();assert.equal(data.pending,true);assert.equal(data.progress.sequence,2);assert.match(data.progress.message,/Cross-checking/);assert.equal(response.headers.get('Cache-Control'),'no-store');
 const engine=new HttpEngine(),messages=[];engine.onmessage=event=>messages.push(JSON.parse(event.data));
 engine.deliverStage(data.progress);engine.deliverStage({message:'Old buffered stage',sequence:1});engine.deliverStage(data.progress);
 assert.equal(messages.length,1);assert.equal(messages[0].sequence,2);engine.close();
 await reporter.clear();assert.equal(objects.size,0);
 await bucket.put('conversion-progress/'+id,JSON.stringify({expires:0,message:'Expired'}));
 assert.equal((await (await pollRender(new Request('https://unfold.example/api/conversion-render/'+id),{BUCKET:bucket})).json()).progress,undefined);
});

test('progress storage failures cannot fail a conversion or its cleanup',async()=>{
 const reporter=createStageReporter({put(){throw new Error('Storage unavailable');},delete(){throw new Error('Storage unavailable');}},crypto.randomUUID());
 await reporter.report({message:'Reading pages',sequence:1,updatedAt:1});await reporter.clear();
});
