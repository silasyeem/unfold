import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {fixture} from './fixture.mjs';
import {assertGuide} from '../dist/guide-schema.js';
import {convertPdf,DEFAULT_MODEL} from '../engine/convert.mjs';
import {planGuideStages} from '../engine/render.mjs';

const screenshot='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
async function sourcePdf(){const pdf=await PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage([200,300]);return pdf.save();}
function sourceFixture(){
 const guide=fixture();guide.pageCount=3;guide.steps.forEach((step,i)=>{step.sourcePage=i+2;});
 guide.steps[1].actions.push({...guide.steps[0].actions[2],start:.7,end:1});
 const sourceSteps=guide.steps.map((step,i)=>({number:String(i+1),title:`Source operation ${i+1}`,instruction:step.instruction,orientation:step.orientation,parts:guide.parts.map(part=>part.id),notes:[]}));
 const extraction={productName:guide.productName,inventory:[],pages:[{pageIndex:1,kind:'cover',steps:[]},...sourceSteps.map((step,i)=>({pageIndex:i+2,kind:'assembly',steps:[step]}))]};
 const components=guide.parts.map(part=>({id:part.id,name:part.name,code:'',kind:part.kind,quantity:1,role:part.kind==='tool'?'tool':'other',geometryClass:part.kind==='tool'?'tool':'compound',description:part.name,sourcePages:[1,2,3]}));
 const audit={components,referenceViews:[{sourcePage:1,kind:'cover',componentIds:['panel','bracket'],solidSurfaceComponentIds:[],description:'A panel and attached bracket.'}],steps:sourceSteps.map((step,i)=>({...step,sourceEntryId:`entry_${i+1}`,sourcePage:i+2,componentIds:step.parts})),reviewNotes:[]};
 const componentCoverage=components.map(component=>({componentId:component.id,partIds:[component.id]}));
 return{guide,extraction,audit,componentCoverage};
}
const issueFor=(capture,changes={})=>({captureId:capture.id,stepIndex:capture.stepIndex,severity:'error',category:'tool',description:'The tool obscures the screw socket in this rendered stage.',correction:'Move the camera to expose the seated working tip and screw socket.',...changes});

function harness({review,alterCaptures,correctEvidence,generationEdit}={}){
 const source=sourceFixture(),providerCalls=[],renderCalls=[],reviewCalls=[],correctionCalls=[],events=[];
 let generations=0;
 const options={apiKey:'test-only-no-network',pageCount:3,filename:'source-manual.pdf',
  fetchImpl:async(url,request)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(request.body),name=body.text.format.name;providerCalls.push(body);events.push(name);
   assert.equal(body.model,'gpt-6-astra');assert.equal(body.store,false);assert.equal(body.reasoning.effort,name==='assembly_guide'?'medium':'high');
   let data;
   if(name==='manual_evidence')data=source.extraction;
   else if(name==='component_evidence'||name==='component_evidence_review')data=source.audit;
   else if(name==='assembly_guide'){
    generations++;const guide=structuredClone(source.guide);guide.parts[0].color=generations===1?'#aaaaaa':'#666666';
    // Generation may disagree with source handling. The renderer must receive the reconciled pose.
    guide.steps.forEach(step=>{step.orientation='upright';});data={guide,componentCoverage:source.componentCoverage};
    if(generationEdit)data=generationEdit({data,body,attempt:generations});
   }else throw new Error(`Unexpected provider pass: ${name}`);
   return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}],usage:{input_tokens:5,output_tokens:3}});
  },
  renderStages:async(guide,settings)=>{
   events.push('render');renderCalls.push({guide:structuredClone(guide),overviewPage:settings.overviewPage});
   const captures=planGuideStages(guide,settings).map(({id,stepIndex,phase,sourcePage})=>({id,stepIndex,phase,sourcePage,imageDataUrl:screenshot}));
   return alterCaptures?alterCaptures(captures):captures;
  },
  reviewStages:async(bytes,guide,captures,settings)=>{
   events.push('review');reviewCalls.push({guide:structuredClone(guide),captures:structuredClone(captures)});
   assert.equal(settings.model,'gpt-6-astra');assert.equal(settings.apiKey,'test-only-no-network');assert.equal((await PDFDocument.load(bytes)).getPageCount(),3);
   return{issues:[],checkedCaptureIds:captures.map(capture=>capture.id),usage:{input_tokens:7,output_tokens:2},...review?.({attempt:reviewCalls.length,guide,captures})};
  },
  correctEvidence:async(...args)=>{
   events.push('correct-evidence');correctionCalls.push(args);
   return correctEvidence?correctEvidence(...args):{evidence:args[1],usage:{input_tokens:11,output_tokens:4}};
  }
 };
 return{source,options,providerCalls,renderCalls,reviewCalls,correctionCalls,events,get generations(){return generations;}};
}

test('a visible mismatch causes one corrected generation and a fresh render-and-review of every source stage',async()=>{
 const h=harness({review:({attempt,captures})=>({issues:attempt===1?[issueFor(captures.find(capture=>capture.phase==='connection'))]:[]})});
 const result=await convertPdf(await sourcePdf(),h.options);
 assert.equal(DEFAULT_MODEL,'gpt-6-astra');assert.equal(h.generations,2);assert.equal(h.renderCalls.length,2);assert.equal(h.reviewCalls.length,2);
 assert.equal(h.correctionCalls.length,0,'A camera/tool-only failure does not rewrite source evidence.');
 assert.deepEqual(h.events,['manual_evidence','component_evidence','component_evidence_review','assembly_guide','render','review','assembly_guide','render','review']);
 assert.deepEqual(h.renderCalls.map(call=>call.guide.parts[0].color),['#aaaaaa','#666666'],'The repaired geometry must be rendered, not the previous draft.');
 for(const call of h.renderCalls){assert.equal(call.overviewPage,1);assert.deepEqual(call.guide.steps.map(step=>step.orientation),['on_back','on_back']);assert.deepEqual(call.guide.steps.map(step=>step.title),['Source operation 1','Source operation 2']);}
 for(const call of h.reviewCalls)assert.deepEqual(call.captures.map(({id,sourcePage})=>({id,sourcePage})),[
  {id:'overview',sourcePage:1},{id:'step-1-assembled',sourcePage:2},{id:'step-1-connection',sourcePage:2},{id:'step-2-assembled',sourcePage:3},{id:'step-2-connection',sourcePage:3}
 ]);
 const generations=h.providerCalls.filter(body=>body.text.format.name==='assembly_guide'),repair=generations[1].input[0].content;
 assert(generations[0].input[0].content.every(part=>part.type!=='input_image'));
 assert(repair.some(part=>part.type==='input_text'&&part.text.includes('Move the camera to expose the seated working tip and screw socket.')));
 assert(repair.some(part=>part.type==='input_text'&&part.text.includes('Previous draft:')));
 assert(repair.some(part=>part.type==='input_image'&&part.image_url===screenshot&&part.detail==='high'),'The repair receives the actual failed screenshot.');
 assert(repair.some(part=>part.type==='input_text'&&part.text.includes('step-1-connection')&&part.text.includes('"sourcePage":2')));
 assertGuide(result.guide);assert.equal(result.guide.schemaVersion,'1');assert(!('visualReview' in result.guide));
 assert.equal(result.visualReview.status,'no_visible_mismatch');assert.equal(result.visualReview.generationAttempts,2);assert.equal(result.visualReview.reasoningEffort,'high');assert.equal(result.visualReview.captures.length,5);
 assert.deepEqual(result.provenance.reasoning,{parsing:'high',generation:'medium',visualReview:'high'});assert.deepEqual(result.usage,{inputTokens:39,outputTokens:19});
 assert(!JSON.stringify(result).includes('data:image/'));assert(!JSON.stringify(result).includes('test-only-no-network'));
});

test('a second visible mismatch rejects the draft after exactly one repair',async()=>{
 const h=harness({review:({captures})=>({issues:[issueFor(captures[0],{category:'extra_part',description:'The rendered build contains an unsupported center support.',correction:'Remove the unsupported center support.'})]})});
 await assert.rejects(convertPdf(await sourcePdf(),h.options),/still differs from the manual after correction.*unsupported center support/);
 assert.equal(h.generations,2);assert.equal(h.renderCalls.length,2);assert.equal(h.reviewCalls.length,2);
 assert.equal(h.correctionCalls.length,1,'Source evidence gets at most one correction before the final rejection.');
});

test('a source interpretation mismatch corrects the manifest and working pose before regenerating and rendering',async()=>{
 const h=harness({
  review:({attempt,captures})=>({issues:attempt===1?[
   issueFor(captures[0],{category:'extra_part',description:'The center support has no corresponding source part.',correction:'Recheck the source inventory and remove the unsupported center support.'}),
   issueFor(captures.find(capture=>capture.id==='step-1-assembled'),{category:'orientation',description:'The main source drawing rests the build on its left side.',correction:'Correct the source working pose to on_left for these operations.'})
  ]:[]}),
  correctEvidence:async(bytes,evidence,originalSource,guide,feedback,captures,settings)=>{
   assert.equal((await PDFDocument.load(bytes)).getPageCount(),3);assert.equal(settings.model,DEFAULT_MODEL);assert.equal(settings.filename,'source-manual.pdf');
   assert.deepEqual(originalSource.steps.map(step=>[step.number,step.sourcePage]),[['1',2],['2',3]]);
   assert(evidence.components.some(component=>component.id==='phantom'));assert(guide.parts.some(part=>part.id==='phantom'));
   assert(guide.steps.every(step=>step.orientation==='on_back'));assert.equal(feedback.issues.length,2);assert.equal(captures.length,5);assert(captures.every(capture=>capture.imageDataUrl===screenshot));
   const corrected=structuredClone(evidence);corrected.components=corrected.components.filter(component=>component.id!=='phantom');
   corrected.inventory=corrected.components.map(component=>({name:component.name,code:component.code,quantity:component.quantity,description:component.description}));
   corrected.referenceViews.forEach(view=>{view.componentIds=view.componentIds.filter(id=>id!=='phantom');});
   corrected.steps.forEach(step=>{step.orientation='on_left';step.componentIds=step.componentIds.filter(id=>id!=='phantom');step.parts=step.componentIds;step.instruction='Fit the bracket while the panel rests on its left side.';});
   return{evidence:corrected,usage:{input_tokens:11,output_tokens:4}};
  },
  generationEdit:({data,body,attempt})=>{
   if(attempt===1)return data;
   const sourceText=body.input[0].content[2].text,contract=JSON.parse(sourceText.slice(sourceText.indexOf('{')));
   assert(!contract.components.some(component=>component.id==='phantom'),'The replacement generation receives the corrected manifest.');
   assert(contract.steps.every(step=>step.orientation==='on_left'),'The replacement generation receives corrected handling, not the old frozen evidence.');
   data.guide.parts=data.guide.parts.filter(part=>part.id!=='phantom');
   data.componentCoverage=data.componentCoverage.filter(entry=>entry.componentId!=='phantom');
   return data;
  }
 });
 h.source.guide.parts.push({...structuredClone(h.source.guide.parts[0]),id:'phantom',name:'Unsupported center support',initiallyVisible:true});
 h.source.audit.components.push({...structuredClone(h.source.audit.components[0]),id:'phantom',name:'Unsupported center support'});
 h.source.audit.referenceViews[0].componentIds.push('phantom');h.source.audit.steps.forEach(step=>{step.componentIds.push('phantom');});
 h.source.componentCoverage.push({componentId:'phantom',partIds:['phantom']});
 const result=await convertPdf(await sourcePdf(),h.options);
 assert.equal(h.correctionCalls.length,1);assert.equal(h.generations,2);assert.equal(h.reviewCalls.length,2);
 assert.deepEqual(h.events,['manual_evidence','component_evidence','component_evidence_review','assembly_guide','render','review','correct-evidence','assembly_guide','render','review']);
 assert(h.renderCalls[0].guide.parts.some(part=>part.id==='phantom'));assert(!h.renderCalls[1].guide.parts.some(part=>part.id==='phantom'));
 assert(h.renderCalls[1].guide.steps.every(step=>step.orientation==='on_left'));assert(result.guide.steps.every(step=>step.orientation==='on_left'));
 assert(!result.evidence.components.some(component=>component.id==='phantom'));assert(!result.componentCoverage.some(entry=>entry.componentId==='phantom'));
 assert.deepEqual(result.evidence.steps.map(step=>[step.sourceEntryId,step.number,step.sourcePage]),[['entry_1','1',2],['entry_2','2',3]]);
 assert.equal(result.visualReview.status,'no_visible_mismatch');assert.deepEqual(result.usage,{inputTokens:50,outputTokens:23});assertGuide(result.guide);
});

test('missing or duplicate capture acknowledgments cannot count as a completed visual check',async()=>{
 for(const checked of [captures=>captures.slice(1).map(c=>c.id),captures=>captures.map(()=>captures[0].id)]){
  const h=harness({review:({captures})=>({checkedCaptureIds:checked(captures)})});
  await assert.rejects(convertPdf(await sourcePdf(),h.options),/compare every captured stage/);assert.equal(h.generations,1);assert.equal(h.reviewCalls.length,1);
 }
});

test('omitting a required stage cannot pass even if the reviewer acknowledges every supplied image',async()=>{
 const h=harness({alterCaptures:captures=>captures.filter(capture=>capture.id!=='step-2-assembled')});
 await assert.rejects(convertPdf(await sourcePdf(),h.options),/render|captur|stage/i);
 assert.equal(h.generations,1);assert.equal(h.reviewCalls.length,0,'Missing stages must be rejected before review.');
});

test('full visual uncertainty survives alongside a step whose regular review notes are already full',async()=>{
 const description='The hidden face of the bracket is not visible in the source diagram. '.repeat(24),correction='Check the hidden bracket face against the physical part. '.repeat(28);
 assert(description.length>1500&&description.length<=1800);assert(correction.length>1500&&correction.length<=1800);
 const h=harness({review:({captures})=>({issues:[issueFor(captures.find(capture=>capture.phase==='connection'),{severity:'uncertain',description,correction})]})});
 h.source.guide.steps[0].reviewNotes=Array.from({length:8},(_,i)=>`Existing source note ${i+1}.`);
 const result=await convertPdf(await sourcePdf(),h.options);
 assert.equal(h.generations,1);assert.equal(result.visualReview.status,'needs_review');assert.equal(result.visualReview.issues.length,1);assert.equal(result.visualReview.issues[0].severity,'uncertain');
 assert.equal(h.correctionCalls.length,0);
 assert.equal(result.visualReview.issues[0].description,description);assert.equal(result.visualReview.issues[0].correction,correction);assert.deepEqual(result.guide.steps[0].reviewNotes,h.source.guide.steps[0].reviewNotes);assert.equal(result.provenance.status,'draft');assertGuide(result.guide);
});

test('an unreadable or unmatchable source view blocks completion even when marked uncertain',async()=>{
 const h=harness({review:({captures})=>({issues:[issueFor(captures[0],{severity:'uncertain',category:'source_mismatch',description:'The supplied render is blank and cannot be compared.',correction:'Correct the camera and capture a visible view of the assembled product.'})]})});
 await assert.rejects(convertPdf(await sourcePdf(),h.options),/still differs.*blank/);assert.equal(h.generations,2);assert.equal(h.reviewCalls.length,2);
 assert.equal(h.correctionCalls.length,0,'An unmatchable render requires a new render, not speculative source edits.');
});
