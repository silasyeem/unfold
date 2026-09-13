import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {fixture} from './fixture.mjs';
import {validateGuide,assertGuide} from '../dist/guide-schema.js';
import {compileGuide,evaluateGuide,orientations} from '../dist/guide-state.js';
import {extractManual} from '../engine/extract.mjs';
import {convertPdf} from '../engine/convert.mjs';
import {handleApi} from '../server/api.mjs';
import {validateHandling} from '../engine/semantics.mjs';
import * as T from '../dist/vendor/three.module.js';

test('rejects invalid references, overlapping actions, cycles, fractional spins, and non-finite geometry',()=>{
 assert.deepEqual(validateGuide(fixture()),[]);
 const bad=fixture();bad.parts[0].parentId='bracket';bad.steps[0].actions[0].partId='missing';bad.parts[0].primitives[0].size[0]=Infinity;assert(validateGuide(bad).length);
 const cycle=fixture();cycle.parts[0].parentId='bracket';assert(validateGuide(cycle).some(e=>e.includes('Cyclic')));
 const overlap=fixture();overlap.steps[0].actions[1].end=.9;assert(validateGuide(overlap).some(e=>e.includes('overlapping')));
 const spin=fixture();spin.steps[0].actions[0].turns=.25;assert(validateGuide(spin).length);
});
test('seeking is independent of prior visits and removed tools stay removed until their next action',()=>{
 const compiled=compileGuide(fixture());const expected=evaluateGuide(compiled,1,.5);
 for(const [step,progress] of [[0,.3],[1,1],[0,.8],[1,0],[0,0]])evaluateGuide(compiled,step,progress);
 assert.deepEqual(evaluateGuide(compiled,1,.5),expected);
 assert.equal(evaluateGuide(compiled,0,.7).tool.visible,false);
 assert.equal(evaluateGuide(compiled,0,.85).tool.visible,true);
});
test('brackets reveal their detached parent and inherit subsequent panel motion',()=>{
 const compiled=compileGuide(fixture());const before=evaluateGuide(compiled,0,.2);assert.equal(before.panel.visible,true);assert.equal(before.bracket.visible,true);
 const panel=new T.Group(),bracket=new T.Group();panel.add(bracket);const state=evaluateGuide(compiled,1,.5);panel.position.fromArray(state.panel.position);bracket.position.fromArray(state.bracket.position);panel.updateMatrixWorld(true);
 assert.equal(bracket.getWorldPosition(new T.Vector3()).y,panel.position.y+bracket.position.y);
});
test('back-down orientation points the documented front upward',()=>{
 const front=new T.Vector3(0,0,1).applyEuler(new T.Euler(...orientations.on_back));assert(front.y>.999);
});
test('duplicate whole-build rotation is rejected while detached panel movement remains valid',()=>{
 const guide=fixture();guide.parts[0].initiallyVisible=true;
 const turn={...guide.steps[1].actions[0],kind:'rotate',fromPosition:[0,0,0],toPosition:[0,0,0],toRotation:[Math.PI,0,0]};
 guide.steps[0].orientation='upside_down';guide.steps[0].actions=[turn];
 assert.equal(validateHandling(guide).length,1);
 guide.parts[0].initiallyVisible=false;assert.equal(validateHandling(guide).length,0);
 guide.parts[0].initiallyVisible=true;guide.steps[0].actions=[];assert.equal(validateHandling(guide).length,0);
});
async function pdf(pages=1){const doc=await PDFDocument.create();for(let i=0;i<pages;i++)doc.addPage([200,200]);return doc.save();}
test('actual PDF page limits and mismatched metadata are rejected before provider calls',async()=>{
 let calls=0;const options={apiKey:'test-only',onStage(){},fetchImpl:()=>{calls++;throw new Error('Unexpected call');}};
 await assert.rejects(()=>extractManual(new Uint8Array([37,80,68,70,45]),options),/parsed/);
 const tooLong=await pdf(41);await assert.rejects(()=>extractManual(tooLong,options),/1–40/);
 const one=await pdf();await assert.rejects(()=>extractManual(one,{...options,expectedPageCount:2}),/page count/);assert.equal(calls,0);
});
test('complete conversion preserves evidence and uses the actual source fingerprint',async()=>{
 const bytes=await pdf();const guide=fixture();const evidence={productName:'Fixture',inventory:[],pages:[{pageIndex:1,kind:'assembly',steps:guide.steps.map((s,i)=>({number:String(i+1),title:s.title,instruction:s.instruction,orientation:s.orientation,parts:['panel'],notes:[]}))}]};let calls=0;
 guide.steps[1].actions.push({...guide.steps[0].actions[2],start:.7,end:1});
 const components=guide.parts.map(p=>({id:p.id,name:p.name,code:'',kind:p.kind,quantity:1,role:p.kind==='tool'?'tool':'other',geometryClass:p.kind==='tool'?'tool':'compound',description:p.name,sourcePages:[1]}));
 const audit={components,referenceViews:[],steps:evidence.pages[0].steps.map((s,i)=>({...s,sourceEntryId:`entry_${i+1}`,sourcePage:1,componentIds:['panel','bracket','tool']})),reviewNotes:[]};
 const componentCoverage=components.map(c=>({componentId:c.id,partIds:[c.id]}));
 const result=await convertPdf(bytes,{apiKey:'test-only',pageCount:1,onStage(){},fetchImpl:async(url,request)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(request.headers.Authorization,'Bearer test-only');calls++;const name=JSON.parse(request.body).text.format.name;const content=name==='manual_evidence'?evidence:name==='component_evidence'||name==='component_evidence_review'?audit:{guide,componentCoverage};return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(content)}]}],usage:{input_tokens:5,output_tokens:5}});}});
 assertGuide(result.guide);assert.equal(result.provenance.sha256.length,64);assert.equal(result.provenance.status,'draft');assert.equal(calls,4);assert.deepEqual(result.componentCoverage,componentCoverage);assert.deepEqual(result.evidence.components,components);assert.equal(result.usage.inputTokens,20);assert(!JSON.stringify(result).includes('test-only'));
});
test('API exposes no credential and rejects cross-origin or malformed conversion requests',async()=>{
 const env={OPENAI_API_KEY:'test-secret-never-returned'};const health=await handleApi(new Request('http://localhost/api/health'),env);assert.equal((await health.json()).conversionAvailable,true);
 const denied=await handleApi(new Request('http://localhost/api/convert',{method:'POST',headers:{Origin:'https://different.example','X-Unfold-Convert':'1'},body:'x'}),env);assert.equal(denied.status,403);
 const wrong=await handleApi(new Request('http://localhost/api/convert',{method:'POST',headers:{'X-Unfold-Convert':'1','Content-Type':'text/plain'},body:'x'}),env);assert.equal(wrong.status,415);
});
test('concurrent uploads cannot start more than two conversions; cancellation aborts upstream',async()=>{
 const original=globalThis.fetch;const bytes=await pdf();let calls=0,aborted=0;
 globalThis.fetch=async(_url,{signal})=>{calls++;return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted++;reject(new Error('aborted'));},{once:true});});};
 const request=()=>new Request('http://localhost/api/convert',{method:'POST',headers:{'Content-Type':'application/pdf','X-Unfold-Convert':'1','X-Pdf-Pages':'1'},body:bytes});
 try{const responses=await Promise.all([1,2,3].map(()=>handleApi(request(),{OPENAI_API_KEY:'test-only'})));assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,429]);await new Promise(r=>setTimeout(r,30));assert.equal(calls,2);await Promise.all(responses.filter(r=>r.status===200).map(r=>r.body.cancel()));await new Promise(r=>setTimeout(r,10));assert.equal(aborted,2);}finally{globalThis.fetch=original;}
});
