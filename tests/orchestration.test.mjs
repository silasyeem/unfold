import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {convertPdf,instructions} from '../engine/convert.mjs';
import {requestStructured} from '../engine/extract.mjs';
import {validateComponentEvidence,validateCompleteness} from '../engine/completeness.mjs';
import {generateLargeGuide,partRegistry,validateAssemblyPlan,validatePartBatch,PART_BATCH_SIZE,PART_WORKERS} from '../engine/orchestrate.mjs';
import {validateGuide,MAX_GUIDE_PARTS} from '../dist/guide-schema.js';
import {planGuideStages} from '../engine/render.mjs';
import {compileGuide,evaluateGuide} from '../dist/guide-state.js';

function fixture(count=81){
 const components=[{id:'panel',name:'Panel',kind:'part',quantity:1,geometryClass:'solid_panel',role:'surface'},
  {id:'screw',name:'Screw',kind:'hardware',quantity:count-1,geometryClass:'fastener',role:'connector'}].map(c=>({...c,code:'',description:c.name,sourcePages:[1]}));
 const steps=[{title:'Insert the screws',instruction:'Insert every screw into the panel.',orientation:'on_back'},
  {title:'Tighten the screws',instruction:'Tighten every screw after turning the panel.',orientation:'on_right'}].map((s,i)=>({...s,sourceEntryId:`entry_${i+1}`,number:String(i+1),sourcePage:1,componentIds:['panel','screw'],notes:[]}));
 const evidence={productName:'Large fixture',pageCount:1,components,steps,referenceViews:[],reviewNotes:[],inventory:[],usage:{input_tokens:0,output_tokens:0}};
 const registry=partRegistry(evidence);
 const plan={summary:'Many screws on a panel.',scaleNotes:'Shared right-handed frame; longest dimension 2.',
  componentDesigns:components.map(c=>({componentId:c.id,color:'#777777',size:c.kind==='part'?[2,.05,1]:[.01,.04,.01],geometryInstructions:c.name})),
  parts:registry.map((p,i)=>({id:p.id,parentId:i?'p_0001':'',position:i?[(i%10)*.08,.025,Math.floor(i/10)*.02]:[0,0,0],rotation:[0,0,0],explodedOffset:[0,.1,0],initiallyVisible:i===0,motionNotes:i?'Insert in step 1, tighten in step 2.':'Starting base.'})),
  steps:steps.map(()=>({duration:10,focus:[0,.025,0],cameraDirection:[1,1,1],cameraUp:[0,1,0],cameraDistance:2,motionNotes:'All inserts 0–0.5; all tightening 0.1–0.9.'}))};
 const guide={schemaVersion:'1',productName:evidence.productName,summary:plan.summary,pageCount:1,reviewNotes:[],
  parts:registry.map((p,i)=>{const {componentId,...entry}=p;const {motionNotes,...placement}=plan.parts[i];return{...entry,...placement,color:'#777777',primitives:[{shape:'box',size:i?[.01,.04,.01]:[2,.05,1],position:[0,0,0],rotation:[0,0,0]}]};}),
  steps:steps.map((s,i)=>{const {motionNotes,...view}=plan.steps[i];return{title:s.title,instruction:s.instruction,orientation:s.orientation,sourcePage:1,...view,reviewNotes:[],actions:registry.slice(1).map(p=>{const at=plan.parts.find(a=>a.id===p.id).position;return{partId:p.id,kind:i?'tighten':'insert',fromPosition:i?[...at]:[at[0],at[1]+.25,at[2]],toPosition:[...at],fromRotation:[0,0,0],toRotation:[0,0,0],axis:[0,1,0],turns:i?-1:0,start:i?.1:0,end:i?.9:.5};})};})};
 const coverage=components.map(c=>({componentId:c.id,partIds:registry.filter(p=>p.componentId===c.id).map(p=>p.id)}));
 return{evidence,registry,plan,guide,coverage};
}
function batchFor(f,assigned){
 return{parts:f.guide.parts.filter(p=>assigned.includes(p.id)).map(p=>({id:p.id,primitives:p.primitives})).reverse(),
  steps:f.guide.steps.map((s,i)=>({stepIndex:i,actions:s.actions.filter(a=>assigned.includes(a.partId))})).reverse()};
}
function harness(f,{respond}={}){
 const calls=[];let active=0,maximum=0;
 const fetchImpl=async(_url,request)=>{
  const body=JSON.parse(request.body),name=body.text.format.name;const assigned=name==='assembly_part_batch'?JSON.parse(body.input[0].content.find(c=>c.text?.startsWith('Assigned part IDs')).text.split(': ').slice(1).join(': ')):null;
  const call={body,name,assigned,signal:request.signal};calls.push(call);
  let value=name==='assembly_plan'?f.plan:name==='assembly_part_batch'?batchFor(f,assigned):name==='assembly_guide'?{guide:f.guide,componentCoverage:f.coverage}:name==='manual_evidence'?{productName:f.evidence.productName,inventory:[],pages:[{pageIndex:1,kind:'assembly',steps:f.evidence.steps.map(s=>({...s,parts:['panel','screw']}))}]}:{components:f.evidence.components,steps:f.evidence.steps,referenceViews:[],reviewNotes:[]};
  if(assigned){active++;maximum=Math.max(maximum,active);}
  try{value=await (respond?.(call,structuredClone(value),calls)??value);return Response.json({status:'completed',service_tier:body.service_tier?'priority':'default',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:3,output_tokens:5}});}
  finally{if(assigned)active--;}
 };
 return{calls,fetchImpl,get maximum(){return maximum;}};
}
const options=h=>({apiKey:'test-only',content:[],instructions,fetchImpl:h.fetchImpl});
const screenshot='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const visual={renderStages:async guide=>planGuideStages(guide).map(c=>({...c,imageDataUrl:screenshot})),reviewStages:async(_pdf,_guide,captures)=>({issues:[],checkedCaptureIds:captures.map(c=>c.id),usage:{input_tokens:0,output_tokens:0}})};
async function pdf(){const doc=await PDFDocument.create();doc.addPage([200,200]);return doc.save();}

test('inventory, guide and coverage accept more than 80 physical instances, with explicit resource bounds',()=>{
 for(const count of [81,MAX_GUIDE_PARTS]){const f=fixture(count);assert.deepEqual(validateComponentEvidence(f.evidence,f.evidence),[]);assert.deepEqual(validateGuide(f.guide),[]);assert.deepEqual(validateCompleteness(f.guide,f.evidence.components,f.coverage),[]);}
 const f=fixture(MAX_GUIDE_PARTS);f.evidence.components[1].quantity++;assert.match(validateComponentEvidence(f.evidence,f.evidence).join(' '),/resource budget/);assert.throws(()=>partRegistry(f.evidence),/512/);
});
test('plans must cover immutable IDs, preserve steps and use valid cross-batch parents and viewing axes',()=>{
 const f=fixture();assert.deepEqual(validateAssemblyPlan(f.plan,f.evidence),[]);
 for(const mutate of [p=>p.parts.pop(),p=>p.parts[1].id=p.parts[0].id,p=>p.parts[0].parentId='p_0081',p=>p.steps.pop(),p=>p.steps[0].cameraUp=[0,0,0],p=>p.componentDesigns.pop()]){
  const plan=structuredClone(f.plan);mutate(plan);assert(validateAssemblyPlan(plan,f.evidence).length);
 }
});
test('large-guide workers share the high Fast plan, use medium Fast, finish out of order and merge deterministically',async()=>{
 const f=fixture();const h=harness(f,{respond:async(call,value)=>{if(call.assigned)await new Promise(r=>setTimeout(r,call.assigned.includes('p_0001')?20:1));return value;}});
 const result=await generateLargeGuide(f.evidence,options(h));
 assert.equal(h.maximum,PART_WORKERS);assert.equal(result.data.guide.parts.length,81);
 assert.deepEqual(result.data.guide.parts,f.guide.parts);assert.deepEqual(result.data.componentCoverage,f.coverage);
 assert.deepEqual(validateGuide(result.data.guide),[]);assert.deepEqual(validateCompleteness(result.data.guide,f.evidence.components,result.data.componentCoverage),[]);
 const final=evaluateGuide(compileGuide(result.data.guide),1,1);assert.equal(final.p_0081.visible,true);assert.deepEqual(final.p_0081.position,f.plan.parts[80].position);
 for(const c of h.calls){assert.equal(c.body.model,'gpt-6-astra');assert.equal(c.body.service_tier,'priority');assert.equal(c.body.reasoning.effort,c.name==='assembly_plan'?'high':'medium');if(c.assigned){assert(c.assigned.length<=PART_BATCH_SIZE);assert(c.body.input[0].content.some(c=>c.text?.includes('Shared assembly plan:')));}}
 assert.equal(h.calls[0].name,'assembly_plan');assert.equal(h.calls.length,7);
 assert.deepEqual(result.usage,{input_tokens:21,output_tokens:35});assert.deepEqual(result.orchestration.observedServiceTiers,['priority']);
});
test('batch validators reject extra IDs, cross-owner actions, changed final joints, missing solid faces and missing steps',()=>{
 const f=fixture(),assigned=f.registry.slice(0,16).map(p=>p.id);
 for(const mutate of [b=>b.parts[1].id='foreign',b=>b.steps[0].actions[0].partId='p_0081',b=>b.steps[0].actions[0].toPosition=[9,9,9],b=>b.parts.find(p=>p.id==='p_0001').primitives[0].size=[.01,1,.01],b=>b.steps.pop()]){
  const batch=batchFor(f,assigned);mutate(batch);assert(validatePartBatch(batch,assigned,f.guide,f.evidence,f.registry).length);
 }
});
test('invalid coordinator output is corrected before workers start; only an invalid batch is retried',async()=>{
 const f=fixture();let plans=0;const attempts=new Map();
 const h=harness(f,{respond:(c,value)=>{if(c.name==='assembly_plan'&&++plans===1)value.parts.pop();if(c.assigned){const id=c.assigned[0],n=(attempts.get(id)||0)+1;attempts.set(id,n);if(id==='p_0001'&&n===1)value.parts.pop();}return value;}});
 const result=await generateLargeGuide(f.evidence,options(h));assert.equal(plans,2);assert.equal(h.calls[1].name,'assembly_plan');
 assert.equal(attempts.get('p_0001'),2);assert.equal([...attempts.values()].filter(n=>n===1).length,5);
 assert.equal(result.orchestration.planCalls,2);assert.equal(result.orchestration.workerCalls,7);assert.equal(result.usage.input_tokens,27);
});
test('persistent batch failure cancels in-flight siblings and does not dispatch remaining groups',async()=>{
 const f=fixture();let aborted=0;
 const h=harness(f,{respond:(c,value)=>{if(!c.assigned)return value;if(c.assigned[0]==='p_0001'){value.parts.pop();return value;}return new Promise((resolve,reject)=>{c.signal.addEventListener('abort',()=>{aborted++;reject(c.signal.reason);},{once:true});});}});
 await assert.rejects(generateLargeGuide(f.evidence,options(h)),/Part group 1 needs correction/);
 assert.equal(aborted,1);assert.equal(h.calls.filter(c=>c.assigned).length,3);
});
test('user cancellation aborts every active worker and never returns a partial guide',async()=>{
 const f=fixture(),controller=new AbortController();let started=0,aborted=0;
 const h=harness(f,{respond:(c,value)=>{if(!c.assigned)return value;return new Promise((resolve,reject)=>{c.signal.addEventListener('abort',()=>{aborted++;reject(c.signal.reason);},{once:true});if(++started===2)controller.abort();});}});
 await assert.rejects(generateLargeGuide(f.evidence,{...options(h),signal:controller.signal}),{name:'AbortError'});assert.equal(started,2);assert.equal(aborted,2);
});
test('conversion routes 80 parts to the existing path and 81 to orchestration, then applies whole-guide visual review',async()=>{
 for(const count of [80,81]){
  const f=fixture(count),h=harness(f);let reviewed=0;
  const result=await convertPdf(await pdf(),{...options(h),...visual,reviewStages:async(bytes,guide,captures,opts)=>{reviewed++;assert.equal(guide.parts.length,count);if(count>80)assert.equal(opts.serviceTier,'priority');return visual.reviewStages(bytes,guide,captures);}});
  assert.equal(reviewed,1);assert.deepEqual(result.guide.steps.map(s=>s.orientation),f.evidence.steps.map(s=>s.orientation));
  assert.equal(h.calls.filter(c=>c.name==='assembly_guide').length,count===80?1:0);assert.equal(h.calls.filter(c=>c.name==='assembly_plan').length,count>80?1:0);
  assert.equal(Boolean(result.provenance.orchestration),count>80);assert.equal(result.usage.inputTokens,h.calls.length*3);assert.equal(result.usage.outputTokens,h.calls.length*5);
  assert(!JSON.stringify(result).includes('test-only'));
 }
});
test('a failed whole-guide visual review replans and checks the complete large guide again',async()=>{
 const f=fixture(),h=harness(f);let reviews=0;
 const result=await convertPdf(await pdf(),{...options(h),...visual,reviewStages:async(bytes,guide,captures)=>{const review=await visual.reviewStages(bytes,guide,captures);if(reviews++===0)review.issues=[{captureId:captures[0].id,stepIndex:captures[0].stepIndex,severity:'error',category:'shape',description:'Panel proportions differ.',correction:'Fix the shared panel proportions.'}];return review;}});
 assert.equal(reviews,2);assert.equal(h.calls.filter(c=>c.name==='assembly_plan').length,2);assert.equal(result.provenance.orchestration.length,2);
 assert.equal(result.visualReview.generationAttempts,2);assert.equal(result.usage.inputTokens,h.calls.length*3);
 assert(h.calls.filter(c=>c.name==='assembly_plan')[1].body.input[0].content.some(c=>c.text?.includes('Panel proportions differ.')));
});
test('unsupported Fast mode fails explicitly, without silently falling back or starting workers',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(generateLargeGuide(f.evidence,{...options({}),fetchImpl:async()=>{calls++;return Response.json({error:{code:'unsupported_service_tier'}},{status:400});}}),/unsupported_service_tier/);assert.equal(calls,1);
});
test('structured requests preserve the provider-reported tier and leave existing callers on their original tier',async()=>{
 const bodies=[];
 const opts={apiKey:'mock',model:'gpt-6-astra',instructions:'x',content:[],schema:{type:'object'},name:'x',fetchImpl:async(_url,req)=>{bodies.push(JSON.parse(req.body));return Response.json({status:'completed',service_tier:'default',output:[{content:[{type:'output_text',text:'{}'}]}]});}};
 await requestStructured(opts);const result=await requestStructured({...opts,serviceTier:'priority'});
 assert.equal(bodies[0].service_tier,undefined);assert.equal(bodies[1].service_tier,'priority');assert.equal(result.serviceTier,'default');
});
