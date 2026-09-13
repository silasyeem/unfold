import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {correctEvidenceFromRenders} from '../engine/evidence-repair.mjs';
import {fixture as guideFixture} from './fixture.mjs';

const screenshot='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const component=(id,quantity,geometryClass)=>({id,name:id,code:'',quantity,geometryClass,kind:'part',role:geometryClass==='solid_panel'?'surface':'support',description:id,sourcePages:[1,2,3]});
async function fixture(){
 const pdf=await PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage([200,200]);
 const originalSource={pageCount:3,steps:[{number:'7',sourcePage:2,title:'Wrong provisional title'},{number:'8',sourcePage:3}],usage:{input_tokens:2,output_tokens:3}};
 const steps=[{sourceEntryId:'entry_1',number:'7',sourcePage:2},{sourceEntryId:'',number:'7b',sourcePage:2},{sourceEntryId:'entry_2',number:'8',sourcePage:3}].map(step=>({...step,title:'Candidate operation',instruction:'Candidate instructions.',orientation:'upside_down',componentIds:['panel','legs','phantom'],notes:[]}));
 const evidence={...originalSource,components:[component('panel',2,'solid_panel'),component('legs',5,'linear'),component('phantom',1,'linear')],referenceViews:[{sourcePage:1,kind:'cover',componentIds:['panel','legs','phantom'],solidSurfaceComponentIds:['panel'],description:'Candidate completed assembly.'}],steps,reviewNotes:['Unsupported extra support.'],inventory:[],usage:{input_tokens:40,output_tokens:20}};
 const guide=guideFixture();guide.pageCount=3;guide.steps=steps.map(step=>({...structuredClone(guide.steps[0]),sourcePage:step.sourcePage,orientation:step.orientation}));
 const captures=[{id:'overview',stepIndex:-1,phase:'overview',sourcePage:1,imageDataUrl:screenshot},...guide.steps.flatMap((step,i)=>['assembled','connection'].map(phase=>({id:`${phase}-${i}`,stepIndex:i,phase,sourcePage:step.sourcePage,imageDataUrl:screenshot})))];
 const issues=captures.slice(0,5).map((capture,i)=>({captureId:capture.id,stepIndex:capture.stepIndex,severity:'error',category:i===0?'extra_part':i===1?'orientation':'missing_part',description:'The render differs from the source drawing.',correction:'Recheck the support identity and main working pose.'}));
 const corrected={components:evidence.components.filter(c=>c.id!=='phantom').map(c=>({...c,quantity:c.id==='legs'?4:c.quantity})),referenceViews:evidence.referenceViews.map(view=>({...view,componentIds:['panel','legs']})),steps:steps.map((step,i)=>({...step,title:'Corrected operation',instruction:'Use the source-supported components.',orientation:i===2?'upright':'on_left',componentIds:['panel','legs']})),reviewNotes:['The schematic source leaves hidden dimensions uncertain.']};
 return{bytes:await pdf.save(),originalSource,evidence,guide,captures,issues,corrected};
}
const completed=data=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}],usage:{input_tokens:7,output_tokens:11}});
const options=fetchImpl=>({apiKey:'mock-only',model:'gpt-6-astra',fetchImpl});

test('one source correction replaces unsupported inventory and poses, preserves original anchors, and sends four paired failures with the full PDF',async()=>{
 const f=await fixture();let calls=0;const stages=[];const original=structuredClone(f.evidence);
 const result=await correctEvidenceFromRenders(f.bytes,f.evidence,f.originalSource,f.guide,{issues:f.issues},f.captures,{...options(async(_url,request)=>{
  calls++;const body=JSON.parse(request.body);assert.equal(body.model,'gpt-6-astra');assert.equal(body.reasoning.effort,'high');assert.equal(body.max_output_tokens,24000);assert.equal(body.text.format.name,'component_evidence_correction');assert.equal(body.text.format.strict,true);
  const content=body.input[0].content;const files=content.filter(item=>item.type==='input_file');assert.equal(files.length,1);
  const pdf=await PDFDocument.load(Buffer.from(files[0].file_data.split(',')[1],'base64'));assert.equal(pdf.getPageCount(),3);
  const anchors=JSON.parse(content.find(item=>item.text?.startsWith('Original source navigation anchors: ')).text.split('Original source navigation anchors: ')[1]);
  assert.deepEqual(anchors,{pageCount:3,entries:[{sourceEntryId:'entry_1',number:'7',sourcePage:2},{sourceEntryId:'entry_2',number:'8',sourcePage:3}]});
  assert(!JSON.stringify(anchors).includes('Wrong provisional title'));
  const candidate=JSON.parse(content.find(item=>item.text?.startsWith('Candidate evidence to correct against the PDF: ')).text.split('Candidate evidence to correct against the PDF: ')[1]);assert.equal(candidate.steps.length,3);assert.equal(candidate.components.find(c=>c.id==='legs').quantity,5);
  const feedback=JSON.parse(content.find(item=>item.text?.startsWith('Rendered draft and comparison feedback')).text.split('(both hypotheses; source drawings prevail): ')[1]);assert.deepEqual(feedback.issues,f.issues);assert.deepEqual(feedback.guide,f.guide);
  const images=content.filter(item=>item.type==='input_image');assert.equal(images.length,4);
  for(const image of images){const index=content.indexOf(image);const record=JSON.parse(content[index-1].text.split('ORIGINAL one-based PDF source page: ')[1]);const capture=f.captures.find(c=>c.id===record.captureId);assert.equal(image.image_url,capture.imageDataUrl);assert.equal(record.sourcePage,capture.sourcePage);assert.equal(record.stepIndex,capture.stepIndex);}
  return completed(f.corrected);
 }),onStage:stage=>stages.push(stage),filename:'Untrusted label.pdf'});
 assert.equal(calls,1);assert.equal(stages.length,1);assert.deepEqual(f.evidence,original);
 assert.equal(result.evidence.components.find(c=>c.id==='legs').quantity,4);assert(!result.evidence.components.some(c=>c.id==='phantom'));
 assert.deepEqual(result.evidence.steps.map(s=>s.orientation),['on_left','on_left','upright']);assert(result.evidence.steps.every(s=>s.parts.join(',')==='panel,legs'));
 assert.deepEqual(result.evidence.inventory.map(c=>[c.name,c.quantity]),[['panel',2],['legs',4]]);assert.deepEqual(result.evidence.referenceViews[0].componentIds,['panel','legs']);
 assert.deepEqual(result.evidence.steps.filter(s=>s.sourceEntryId).map(s=>[s.sourceEntryId,s.number,s.sourcePage]),[['entry_1','7',2],['entry_2','8',3]]);
 assert.deepEqual(result.usage,{input_tokens:7,output_tokens:11});assert.deepEqual(result.evidence.usage,{input_tokens:40,output_tokens:20});
});

test('source correction cannot drop, reorder, renumber, or move an original entry',async()=>{
 const changes=[data=>data.steps.shift(),data=>{[data.steps[0],data.steps[2]]=[data.steps[2],data.steps[0]];},data=>{data.steps[0].number='1';},data=>{data.steps[0].sourcePage=1;}];
 for(const change of changes){
  const f=await fixture();const bad=structuredClone(f.corrected);change(bad);let calls=0;
  await assert.rejects(correctEvidenceFromRenders(f.bytes,f.evidence,f.originalSource,f.guide,f.issues,f.captures,options(async()=>{calls++;return completed(bad);})),/Source evidence correction failed.*(omitted|reordered|page and number|source-page order)/);
  assert.equal(calls,1);
 }
});

test('invalid correction objects and dangling component references fail clearly after one request',async()=>{
 const changes=[()=>null,data=>{delete data.referenceViews;return data;},data=>{data.components[0].geometryClass='hollow_guess';return data;},data=>{data.steps[0].componentIds.push('removed_support');return data;}];
 for(const change of changes){
  const f=await fixture();const bad=change(structuredClone(f.corrected));let calls=0;
  await assert.rejects(correctEvidenceFromRenders(f.bytes,f.evidence,f.originalSource,f.guide,f.issues,f.captures,options(async()=>{calls++;return completed(bad);})),/Source evidence correction failed; the returned component evidence remains invalid/);
  assert.equal(calls,1);
 }
});

test('unpaired feedback, invalid screenshots, and wrong PDF anchors cannot start a correction request',async()=>{
 const changes=[f=>{f.issues[0].captureId='unknown';},f=>{f.issues[0].stepIndex=2;},f=>{f.captures[1].sourcePage=3;},f=>{f.captures[0].imageDataUrl='data:image/png;base64,bm90YW5pbWFnZQ==';},f=>{f.issues.forEach(issue=>{issue.severity='uncertain';});},async f=>{const pdf=await PDFDocument.create();pdf.addPage([200,200]);f.bytes=await pdf.save();}];
 for(const change of changes){
  const f=await fixture();await change(f);let calls=0;
  await assert.rejects(correctEvidenceFromRenders(f.bytes,f.evidence,f.originalSource,f.guide,f.issues,f.captures,options(async()=>{calls++;return completed(f.corrected);})),/Source evidence correction/);
  assert.equal(calls,0);
 }
});

test('a refused correction never returns unchanged evidence as a fake success or retries the API',async()=>{
 const f=await fixture();let calls=0;
 await assert.rejects(correctEvidenceFromRenders(f.bytes,f.evidence,f.originalSource,f.guide,f.issues,f.captures,options(async()=>{calls++;return Response.json({status:'completed',output:[{content:[{type:'refusal',refusal:'Cannot compare these drawings.'}]}]});})),/could not be interpreted/);
 assert.equal(calls,1);
});
