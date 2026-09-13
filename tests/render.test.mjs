import test from 'node:test';
import assert from 'node:assert/strict';
import {planGuideStages,renderGuideStages} from '../engine/render.mjs';
import {fixture} from './fixture.mjs';

test('render plan covers every completed source stage and chooses an active tool tightening close-up',()=>{
 const guide=fixture();guide.pageCount=12;guide.steps[0].sourcePage=7;guide.steps[1].sourcePage=8;
 guide.steps[0].actions[1].kind='tighten';
 const stages=planGuideStages(guide,{overviewPage:12});
 assert.deepEqual(stages.map(({id,stepIndex,phase,sourcePage})=>({id,stepIndex,phase,sourcePage})),[
  {id:'overview',stepIndex:-1,phase:'overview',sourcePage:12},
  {id:'step-1-assembled',stepIndex:0,phase:'assembled',sourcePage:7},
  {id:'step-1-connection',stepIndex:0,phase:'connection',sourcePage:7},
  {id:'step-2-assembled',stepIndex:1,phase:'assembled',sourcePage:8},
  {id:'step-2-connection',stepIndex:1,phase:'connection',sourcePage:8}
 ]);
 assert.equal(stages[2].progress,(.35+.5)/2,'The seated tool is more informative than a later tool approach.');
 assert.equal(stages[1].progress,1);
});

test('orientation-only stages still get a completed render and capture count stays bounded',()=>{
 const guide=fixture();guide.steps[0].actions=[];guide.steps[1].actions[0].kind='remove';
 assert.equal(planGuideStages(guide).length,3);
 const many=fixture();many.steps=Array.from({length:32},()=>structuredClone(many.steps[0]));
 assert.equal(planGuideStages(many).length,65);
 many.steps.push(structuredClone(many.steps[0]));assert.throws(()=>planGuideStages(many),/guide.steps/);
 assert.throws(()=>planGuideStages(guide,{overviewPage:2}),/source page/);
});

test('render cancellation stops before starting an isolated browser',async()=>{
 const controller=new AbortController();controller.abort(new Error('Cancelled render'));
 await assert.rejects(renderGuideStages(fixture(),{signal:controller.signal}),/Cancelled render/);
});
