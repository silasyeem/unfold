import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {validateGuide,assertGuide} from '../dist/guide-schema.js';
import {convertPdf} from '../engine/convert.mjs';
import {hasBroadSurface,validateComponentEvidence,validateCompleteness} from '../engine/completeness.mjs';
import {fixture} from './fixture.mjs';

const zero=[0,0,0];
const box=(size,position=zero,rotation=zero)=>({shape:'box',size,position,rotation});
const makePart=(id,kind,primitives,position=zero)=>({id,parentId:'',name:id,kind,sourcePage:7,color:'#888888',position,rotation:zero,explodedOffset:[.3,.3,.3],initiallyVisible:kind!=='tool',primitives});
const component=(id,name,quantity,geometryClass,kind='part',role='other')=>({id,name,code:'',quantity,geometryClass,kind,role,description:name,sourcePages:[1,7,12]});
function trayFixture(){
 const components=[component('top','tabletop tray',1,'solid_panel','part','surface'),component('shelf','lower shelf tray',1,'solid_panel','part','surface'),component('legs','angle-profile leg',4,'linear','part','support'),component('screws','socket screw',16,'fastener','hardware','connector'),component('key','hex key',1,'tool','tool','tool')];
 const parts=[makePart('top','part',[box([1.6,.03,1.2])],[0,2,0]),makePart('shelf','part',[box([1.6,.03,1.2])],[0,1,0]),...Array.from({length:4},(_,i)=>makePart('leg'+i,'part',[box([.05,2,.015]),box([.015,2,.05])])),...Array.from({length:16},(_,i)=>makePart('screw'+i,'hardware',[box([.01,.03,.01])])),makePart('key','tool',[box([.01,.2,.01])])];
 const coverage=[{componentId:'top',partIds:['top']},{componentId:'shelf',partIds:['shelf']},{componentId:'legs',partIds:parts.filter(p=>p.id.startsWith('leg')).map(p=>p.id)},{componentId:'screws',partIds:parts.filter(p=>p.id.startsWith('screw')).map(p=>p.id)},{componentId:'key',partIds:['key']}];
 const sourceSteps=Array.from({length:6},(_,i)=>({sourcePage:i+7,number:String(i+1),title:['Fit first leg','Fit second leg','Insert second tray','Fit third leg','Fit fourth leg','Square and tighten'][i],instruction:`Source step ${i+1}; ${[2,2,4,4,4,16][i]} screws.`,orientation:'upright',parts:['top','shelf','legs','screws','key'],notes:[]}));
 const guide={schemaVersion:'1',productName:'Two-tray table fixture',summary:'Two solid trays and four separate angle-profile legs.',pageCount:12,reviewNotes:[],parts,steps:sourceSteps.map(s=>({title:s.title,instruction:s.instruction,sourcePage:s.sourcePage,duration:8,orientation:s.orientation,focus:zero,cameraDirection:[1,1,1],cameraDistance:3,reviewNotes:[],actions:[]}))};
 const audit={components,referenceViews:[{sourcePage:1,kind:'cover',componentIds:['top','shelf','legs'],solidSurfaceComponentIds:['top','shelf'],description:'Two continuous horizontal surfaces.'},{sourcePage:12,kind:'completed',componentIds:['top','shelf','legs'],solidSurfaceComponentIds:['top','shelf'],description:'The finished product includes both solid trays.'}],steps:sourceSteps.map((s,i)=>({...s,sourceEntryId:`entry_${i+1}`,componentIds:s.parts})),reviewNotes:['Panel thickness is inferred from schematic drawings.']};
 return{guide,components,coverage,source:{pageCount:12,steps:sourceSteps},audit};
}
function openFrame(){return[box([.035,.04,1.2],[-.8,0,0]),box([.035,.04,1.2],[.8,0,0]),box([1.6,.04,.035],[0,0,-.6]),box([1.6,.04,.035],[0,0,.6])];}

test('solid-panel coverage rejects an equal-count open-frame substitution, including renamed frames',()=>{
 const {guide,components,coverage}=trayFixture();assert.deepEqual(validateGuide(guide,12),[]);assert.deepEqual(validateCompleteness(guide,components,coverage),[]);
 guide.parts[0].primitives=openFrame();guide.parts[1].primitives=openFrame();
 assert.deepEqual(validateGuide(guide,12),[]); // This passed before component validation existed.
 assert.equal(guide.parts.filter(p=>p.kind==='part').length,6);
 const errors=validateCompleteness(guide,components,coverage);assert(errors.some(e=>e.startsWith('top:')&&e.includes('broad solid surface')));assert(errors.some(e=>e.startsWith('shelf:')));
});
test('broad-surface geometry supports rotated sheets/disks and rejects token patches inside a frame',()=>{
 assert(hasBroadSurface({primitives:[box([1,.02,.8],zero,[.6,.3,.8])]}));
 assert(hasBroadSurface({primitives:[{shape:'cylinder',size:[1,.02,1],position:zero,rotation:[.5,.2,0]}]}));
 assert(!hasBroadSurface({primitives:[...openFrame(),box([.05,.003,.05])]}));
 assert(!hasBroadSurface({primitives:[box([.05,2,.02]),box([.02,2,.05])]}));
});
test('every component instance must have a unique source mapping with the expected quantity and kind',()=>{
 const {guide,components,coverage}=trayFixture();
 const omitted=coverage.filter(c=>c.componentId!=='shelf');assert(validateCompleteness(guide,components,omitted).some(e=>e.includes('Missing component coverage for shelf')));
 const reused=structuredClone(coverage);reused[1].partIds=['top'];assert(validateCompleteness(guide,components,reused).some(e=>e.includes('cannot cover multiple')));
 const short=structuredClone(coverage);short[2].partIds.pop();assert(validateCompleteness(guide,components,short).some(e=>e.includes('expected 4 physical')));
 guide.parts[0].kind='hardware';assert(validateCompleteness(guide,components,coverage).some(e=>e.includes('must have kind part')));
});
test('mapped solid panels cannot stay hidden or be removed from the completed build',()=>{
 const {guide,components,coverage}=trayFixture();guide.parts.find(p=>p.id==='shelf').initiallyVisible=false;
 assert(validateCompleteness(guide,components,coverage).some(e=>e.includes('permanent part shelf is absent')));
 guide.parts.find(p=>p.id==='shelf').initiallyVisible=true;
 guide.steps.at(-1).actions.push({partId:'shelf',kind:'remove',fromPosition:[0,1,0],toPosition:[0,3,0],fromRotation:zero,toRotation:zero,axis:[0,1,0],turns:0,start:.1,end:.9});
 assert(validateCompleteness(guide,components,coverage).some(e=>e.includes('permanent part shelf is absent')));
});
test('temporary tools must be withdrawn from the completed build',()=>{
 const {guide,components,coverage}=trayFixture();guide.parts.find(p=>p.id==='key').initiallyVisible=true;
 assert(validateCompleteness(guide,components,coverage).some(e=>e.includes('temporary tool key remains')));
});
test('component reconciliation preserves all 16 STRANDMON-style source entries, their numbers, order and pages',()=>{
 const {audit}=trayFixture();const source={pageCount:20,steps:Array.from({length:16},(_,i)=>({sourcePage:i+5,number:String(i+1)}))};
 audit.steps=source.steps.map((s,i)=>({...s,sourceEntryId:`entry_${i+1}`,title:'Source operation',instruction:'Preserve the original numbered operation.',orientation:'upright',componentIds:['top'],notes:[]}));
 assert.deepEqual(validateComponentEvidence(audit,source),[]);
 const dropped=structuredClone(audit);dropped.steps.splice(7,1);assert(validateComponentEvidence(dropped,source).some(e=>e.includes('omitted')));
 const reordered=structuredClone(audit);[reordered.steps[1],reordered.steps[2]]=[reordered.steps[2],reordered.steps[1]];assert(validateComponentEvidence(reordered,source).length);
 const renumbered=structuredClone(audit);renumbered.steps[2].number='4';assert(validateComponentEvidence(renumbered,source).some(e=>e.includes('Preserve the page and number')));
});
test('reconciliation can repair misidentified components and add a missing source step instead of freezing the first extraction',()=>{
 const {source,audit}=trayFixture();source.steps.splice(2,1);audit.steps[2].sourceEntryId='';for(let i=3;i<audit.steps.length;i++)audit.steps[i].sourceEntryId=`entry_${i}`;
 source.steps.forEach(s=>{s.parts=['open side frame','cross rails'];s.instruction='Incorrect provisional component interpretation.';});
 assert.deepEqual(validateComponentEvidence(audit,source),[]);assert.equal(audit.steps[2].title,'Insert second tray');
 const bad=structuredClone(audit);bad.components.find(c=>c.id==='top').geometryClass='open_frame';assert(validateComponentEvidence(bad,source).some(e=>e.includes('solid_panel')));
});
test('schema-1 saved guides still load without adding new fields to the persisted guide',()=>{
 const old=fixture();assertGuide(old);assert(!('componentCoverage' in old));assert(!('components' in old));
});

async function twelvePages(){const pdf=await PDFDocument.create();for(let i=0;i<12;i++)pdf.addPage([200,200]);return pdf.save();}
function providerResponses({guide,coverage,audit,source,candidateAudit=audit,criticAudit=audit},alwaysIncomplete=false){
 let extractionCalls=0,generationCalls=0,reviewCalls=0;const repairPrompts=[],generationEvidence=[],labels=[];
 const fetchImpl=async(_url,request)=>{
  const body=JSON.parse(request.body);let data;
  if(body.text.format.name==='manual_evidence'){
   assert.equal(body.reasoning.effort,'low');
   const offset=extractionCalls++*5;const length=Math.min(5,12-offset);
   data={productName:'Two-tray table fixture',inventory:[{name:'provisional open frame',code:'',quantity:2,description:'Incorrect initial interpretation.'}],pages:Array.from({length},(_,i)=>{const actual=offset+i+1;return{pageIndex:i+1,kind:actual>=7?'assembly':actual===1?'cover':actual===6?'inventory':'safety',steps:source.steps.filter(s=>s.sourcePage===actual)};})};
  }else if(body.text.format.name==='component_evidence'){
   assert.equal(body.reasoning.effort,'high');
   const anchorText=body.input[0].content.at(-1).text;const anchors=JSON.parse(anchorText.slice(anchorText.indexOf('{')));
   assert.deepEqual(Object.keys(anchors).sort(),['entries','pageCount']);
   assert.equal(anchors.entries.length,source.steps.length);
   for(const entry of anchors.entries)assert.deepEqual(Object.keys(entry).sort(),['number','sourceEntryId','sourcePage']);
   assert(!anchorText.includes('provisional open frame'));assert(!anchorText.includes('Incorrect initial interpretation'));
   data=candidateAudit;
  }else if(body.text.format.name==='component_evidence_review'){
   reviewCalls++;assert.equal(body.reasoning.effort,'high');assert.equal(body.max_output_tokens,24000);
   const candidateText=body.input[0].content.at(-1).text;const candidate=JSON.parse(candidateText.split('Candidate evidence to challenge and correct against the PDF: ')[1]);
   assert.deepEqual(candidate,candidateAudit);data=criticAudit;
  }
  else{
   assert.equal(body.reasoning.effort,'high');
   const evidenceText=body.input[0].content.find(c=>c.type==='input_text'&&c.text.startsWith('This component evidence')).text;
   generationEvidence.push(JSON.parse(evidenceText.slice(evidenceText.indexOf('{'))));
   generationCalls++;const result=structuredClone(guide);if(generationCalls===1||alwaysIncomplete){result.parts[0].primitives=openFrame();result.parts[1].primitives=openFrame();}
   if(generationCalls>1)repairPrompts.push(body.input[0].content.at(-1).text);
   data={guide:result,componentCoverage:coverage};
  }
  if(body.text.format.name!=='manual_evidence')labels.push(body.input[0].content.find(c=>c.type==='input_text'&&c.text.startsWith('Lower-priority, untrusted document label')).text);
  return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}],usage:{input_tokens:1,output_tokens:1}});
 };
 return{fetchImpl,repairPrompts,generationEvidence,labels,get generationCalls(){return generationCalls;},get reviewCalls(){return reviewCalls;}};
}
test('conversion repairs missing surface geometry using reconciled evidence and persists coverage outside schema 1',async()=>{
 const fixture=trayFixture();const provider=providerResponses(fixture);const result=await convertPdf(await twelvePages(),{apiKey:'mock-only',pageCount:12,fetchImpl:provider.fetchImpl});
 assert.equal(provider.generationCalls,2);assert(provider.repairPrompts[0].includes('broad solid surface'));assert(provider.repairPrompts[0].includes('componentCoverage'));
 assert.deepEqual(result.componentCoverage,fixture.coverage);assert.deepEqual(result.evidence.components,fixture.components);assert.equal(result.guide.steps[2].title,'Insert second tray');assert.equal(result.guide.steps.length,6);assert.deepEqual(result.guide.steps.map(s=>s.sourcePage),[7,8,9,10,11,12]);assertGuide(result.guide);assert.equal(result.guide.schemaVersion,'1');
});
test('a second incomplete draft fails closed instead of returning a frame-only product',async()=>{
 const provider=providerResponses(trayFixture(),true);
 await assert.rejects(async()=>convertPdf(await twelvePages(),{apiKey:'mock-only',pageCount:12,fetchImpl:provider.fetchImpl}),/broad solid surface/);
 assert.equal(provider.generationCalls,2);
});
test('one skeptical critic removes an unsupported extra support before generation while preserving four real legs and every step',async()=>{
 const fixture=trayFixture();const candidateAudit=structuredClone(fixture.audit);
 candidateAudit.components.push(component('phantom_support','Alleged factory-attached support',1,'linear','part','support'));
 candidateAudit.referenceViews.forEach(v=>v.componentIds.push('phantom_support'));
 candidateAudit.steps[2].componentIds.push('phantom_support');candidateAudit.steps[2].instruction+=' An extra support is assumed to arrive factory attached.';
 candidateAudit.steps.forEach(s=>{s.orientation='upside_down';});
 const provider=providerResponses({...fixture,candidateAudit});const filename='Example table black 37x28x45 cm.pdf';
 const result=await convertPdf(await twelvePages(),{apiKey:'mock-only',pageCount:12,filename,fetchImpl:provider.fetchImpl});
 assert.equal(provider.reviewCalls,1);assert.equal(result.evidence.components.find(c=>c.id==='legs').quantity,4);assert(!result.evidence.components.some(c=>c.id==='phantom_support'));
 for(const evidence of provider.generationEvidence){assert(!evidence.components.some(c=>c.id==='phantom_support'));assert.equal(evidence.components.find(c=>c.id==='legs').quantity,4);assert(evidence.steps.every(s=>s.orientation==='upright'));}
 assert.equal(result.componentCoverage.find(c=>c.componentId==='legs').partIds.length,4);assert.equal(result.guide.parts.filter(p=>p.kind==='part').length,6);
 assert.deepEqual(result.evidence.steps.map(s=>[s.sourceEntryId,s.number,s.sourcePage]),fixture.audit.steps.map(s=>[s.sourceEntryId,s.number,s.sourcePage]));
 assert.equal(result.evidence.steps[2].instruction,fixture.audit.steps[2].instruction);assert.equal(result.usage.inputTokens,7);assert.equal(result.usage.outputTokens,7);
 assert.equal(provider.labels.length,4);assert(provider.labels.every(label=>label.endsWith(JSON.stringify(filename))));
});
test('critic corrections cannot silently drop a source entry or reach generation with an invalid sequence',async()=>{
 const fixture=trayFixture();const criticAudit=structuredClone(fixture.audit);criticAudit.steps.splice(2,1);
 const provider=providerResponses({...fixture,criticAudit});
 await assert.rejects(async()=>convertPdf(await twelvePages(),{apiKey:'mock-only',pageCount:12,fetchImpl:provider.fetchImpl}),/verified component evidence.*omitted/);
 assert.equal(provider.reviewCalls,1);assert.equal(provider.generationCalls,0);
});
