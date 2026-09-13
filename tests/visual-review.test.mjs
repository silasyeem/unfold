import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {fixture} from './fixture.mjs';
import {reviewRenderedGuide,validateVisualReview} from '../engine/visual-review.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function guide(pages=12){const value=fixture();value.pageCount=pages;const step=value.steps[0];value.steps=Array.from({length:pages},(_,i)=>({...structuredClone(step),sourcePage:i+1}));return value;}
function captures(count=9){return Array.from({length:count},(_,i)=>({id:'capture-'+i,stepIndex:i,phase:i%2?'connection':'assembled',sourcePage:i+1,imageDataUrl:png}));}
async function pdf(pages=12){const value=await PDFDocument.create();for(let i=0;i<pages;i++)value.addPage([200+i,300+i]);return value.save();}
function records(body){return body.input[0].content.filter(c=>c.type==='input_text'&&c.text.startsWith('Capture record')).map(c=>JSON.parse(c.text.slice(c.text.indexOf('{'))));}
function response(data,usage={input_tokens:10,output_tokens:2}){return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}],usage});}
const issue=(capture,overrides={})=>({captureId:capture.id,stepIndex:capture.stepIndex,severity:'error',category:'missing_part',description:'The source shows a broad shelf, but the capture contains only perimeter rails.',correction:'Add the continuous shelf face within the visible perimeter.',...overrides});

test('actual images are paired with matching PDF subset pages in batches of four and concurrency never exceeds two',async()=>{
 const source=await pdf();const input=captures();let calls=0,active=0,maxActive=0;const stages=[];const checked=[];
 const result=await reviewRenderedGuide(source,guide(),input,{apiKey:'mock-only',onStage:m=>stages.push(m),fetchImpl:async(_url,request)=>{
  calls++;active++;maxActive=Math.max(maxActive,active);const body=JSON.parse(request.body);
  assert.equal(body.reasoning.effort,'high');assert.equal(body.text.format.name,'rendered_guide_review');assert.equal(body.text.format.strict,true);
  const assigned=records(body);assert(assigned.length>0&&assigned.length<=4);checked.push(...assigned.map(c=>c.captureId));
  const content=body.input[0].content;const file=content.find(c=>c.type==='input_file');const mapText=content.find(c=>c.type==='input_text'&&c.text.startsWith('Source PDF page mapping')).text;const map=JSON.parse(mapText.slice(mapText.indexOf('[')));
  const subset=await PDFDocument.load(Buffer.from(file.file_data.split(',')[1],'base64'));assert.equal(subset.getPageCount(),new Set(assigned.map(c=>c.sourcePage)).size);
  map.forEach((entry,i)=>{assert.equal(entry.subsetPage,i+1);assert.equal(subset.getPage(i).getWidth(),199+entry.originalPage);});
  for(const record of assigned){assert.equal(map[record.subsetSourcePage-1].originalPage,record.sourcePage);const metaIndex=content.findIndex(c=>{if(c.type!=='input_text'||!c.text.startsWith('Capture record'))return false;const parsed=JSON.parse(c.text.slice(c.text.indexOf('{')));return parsed.captureId===record.captureId;});assert.equal(content[metaIndex+1].type,'input_image');assert.equal(content[metaIndex+1].image_url,png);assert.equal(content[metaIndex+1].detail,'high');}
  await new Promise(resolve=>setTimeout(resolve,15));active--;
  return response({issues:[],checkedCaptureIds:assigned.map(c=>c.captureId)});
 }});
 assert.equal(calls,3);assert.equal(maxActive,2);assert.equal(stages.length,3);assert.deepEqual(checked.sort(),input.map(c=>c.id).sort());assert.deepEqual(result.checkedCaptureIds,input.map(c=>c.id));assert.deepEqual(result.issues,[]);assert.deepEqual(result.usage,{input_tokens:30,output_tokens:6});
});
test('overview and multiple views of one step share the original PDF page without losing capture identity',async()=>{
 const input=[{id:'overview',stepIndex:-1,phase:'overview',sourcePage:1,imageDataUrl:png},{id:'step-end',stepIndex:0,phase:'assembled',sourcePage:1,imageDataUrl:png},{id:'joint',stepIndex:0,phase:'connection',sourcePage:1,imageDataUrl:png}];
 const result=await reviewRenderedGuide(await pdf(1),guide(1),input,{apiKey:'mock-only',fetchImpl:async(_url,request)=>{
  const body=JSON.parse(request.body);const file=body.input[0].content.find(c=>c.type==='input_file');assert.equal((await PDFDocument.load(Buffer.from(file.file_data.split(',')[1],'base64'))).getPageCount(),1);
  return response({issues:[issue(input[0]),issue(input[2],{severity:'uncertain',category:'tool',description:'The screw socket is occluded by the tool in this view.',correction:'Render the same joint from its opposite side to inspect tip seating.'})],checkedCaptureIds:input.map(c=>c.id)});
 }});
 assert.equal(result.issues.length,2);assert.equal(result.issues[0].severity,'error');assert.equal(result.issues[1].severity,'uncertain');assert.deepEqual(result.checkedCaptureIds,['overview','step-end','joint']);
});
test('invalid indices, source pages, duplicate IDs, empty captures and non-image URLs fail before provider calls',async()=>{
 const bytes=await pdf();let calls=0;const options={apiKey:'mock-only',fetchImpl:async()=>{calls++;throw new Error('Unexpected provider call');}};
 const invalid=[[],[...captures(1),...captures(1)],[{...captures(1)[0],stepIndex:99}],[{...captures(1)[0],sourcePage:2}],[{...captures(1)[0],sourcePage:13}],[{...captures(1)[0],phase:'overview'}],[{...captures(1)[0],imageDataUrl:'https://example.com/not-a-capture.png'}],[{...captures(1)[0],imageDataUrl:'data:image/png;base64,aGVsbG8='}]];
 for(const input of invalid)await assert.rejects(()=>reviewRenderedGuide(bytes,guide(),input,options));
 await assert.rejects(()=>reviewRenderedGuide(bytes,guide(11),captures(1),options),/page count/);assert.equal(calls,0);
});
test('every checked ID and issue must match the assigned capture and step, with actionable text',()=>{
 const input=captures(2);const valid={issues:[issue(input[0])],checkedCaptureIds:input.map(c=>c.id)};assert.equal(validateVisualReview(valid,input),valid);
 for(const change of [value=>value.checkedCaptureIds.pop(),value=>value.checkedCaptureIds[1]=value.checkedCaptureIds[0],value=>value.checkedCaptureIds[1]='invented',value=>value.issues[0].captureId='invented',value=>value.issues[0].stepIndex=1,value=>value.issues[0].severity='warning',value=>value.issues[0].category='misc',value=>value.issues[0].correction=' ',value=>value.unrequested='field']){
  const bad=structuredClone(valid);change(bad);assert.throws(()=>validateVisualReview(bad,input));
 }
});
test('a missing acknowledgment fails verification, awaits the other in-flight batch, and never starts a later batch',async()=>{
 let calls=0,finished=0;const options={apiKey:'mock-only',fetchImpl:async(_url,request)=>{
  const call=++calls;const assigned=records(JSON.parse(request.body));await new Promise(resolve=>setTimeout(resolve,call===1?5:20));finished++;
  return response({issues:[],checkedCaptureIds:call===1?assigned.slice(1).map(c=>c.captureId):assigned.map(c=>c.captureId)});
 }};
 await assert.rejects(async()=>reviewRenderedGuide(await pdf(),guide(),captures(9),options),/every assigned capture exactly once/);assert.equal(calls,2);assert.equal(finished,2);
});
test('provider refusal or unreadable review never turns into an empty successful review',async()=>{
 const options={apiKey:'mock-only',fetchImpl:async()=>Response.json({status:'completed',output:[{content:[{type:'refusal',refusal:'Unable to inspect these images.'}]}]})};
 await assert.rejects(async()=>reviewRenderedGuide(await pdf(1),guide(1),captures(1),options),/could not be interpreted/);
});
