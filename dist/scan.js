import {KNARREVIK,knarrevikReferenceGuide} from './knarrevik.js';
import {CATEGORIES,validateScan,summarizeDetections,checklistStatus} from './scan-state.js';
import {prepareScanPhoto} from './scan-image.js';

const $=s=>document.querySelector(s);
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
let photo=null,photoUrl=null,result=null,detections=[],reviews={},request=null,selection=null,sequence=0,preparing=false,viewer=null,disposed=false,available=false;
function status(text,error=false){$('#scan-status').textContent=text;$('#scan-status').classList.toggle('error',error);$('#scan-status').classList.toggle('busy',!!request);}
function controls(){const busy=preparing||!!request;$('#scan-submit').disabled=busy||!photo||!available;$('#scan-submit').textContent=request?'Identifying parts…':'Identify parts →';$('#scan-cancel').hidden=!request;$('#scan-file').disabled=preparing;$('#scan-camera').disabled=preparing;$('.capture-panel').setAttribute('aria-busy',String(busy));$('#download-checklist').disabled=!result||busy;}
function revokePhoto(){if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=null;}
function summary(){
  if(!result){$('#scan-summary').textContent='Nothing scanned yet.';return;}
  if(result.scene!=='laid_out_parts'){$('#scan-summary').textContent='This photo could not establish a parts inventory. Try the loose pieces laid out separately.';return;}
  const state=checklistStatus(detections,reviews);
  $('#scan-summary').textContent=state.countsMatch?'Your reviewed counts match this manual. Keep the original instructions beside you.':`${state.checked} of ${state.types} types checked.${state.unknown?` ${state.unknown} unmatched ${state.unknown===1?'group':'groups'} to review.`:''} A part not seen may be outside the photo.`;
}
async function showPart(part){
  $('.scan-reference').open=true;
  $('#part-explanation').textContent=part.use;
  $('#part-manual').href=`/reference/knarrevik-manual.pdf#page=${part.page}`;
  $('#part-manual').textContent=`See manual page ${part.page} ↗`;
  await ensureViewer();viewer?.selectPart(part.exampleId);
}
async function ensureViewer(){
  if(viewer||disposed)return;
  try{const {createGeneratedViewer}=await import('./generated-viewer.js');if(viewer||disposed)return;viewer=createGeneratedViewer($('#scan-3d'));viewer.load(knarrevikReferenceGuide());viewer.wholeBuild();}
  catch{$('#scan-3d').textContent='3D is unavailable in this browser. The source diagram is available below.';}
}
function inventory(){
  const container=$('#scan-inventory');container.replaceChildren();
  for(const row of summarizeDetections(detections)){
    const item=node('div',undefined,'inventory-row'),title=node('div',undefined,'inventory-title'),name=node('button',row.name,'part-name');name.type='button';name.onclick=()=>showPart(row);
    title.append(name,node('span',`${row.expected} expected`,'expected-count'));item.append(title,node('p',row.description,'inventory-detail'));
    if(result?.scene==='laid_out_parts'){
      const review=reviews[row.id]||={count:row.observed,checked:false};
      const controls=node('div',undefined,'count-review');const countLabel=node('label','Visible count '),count=node('input');count.type='number';count.min='0';count.max='100';count.step='1';count.value=String(review.count);count.setAttribute('aria-label',`Visible count for ${row.name}`);
      const checkLabel=node('label',''),check=node('input');check.type='checkbox';check.checked=review.checked;check.setAttribute('aria-label',`I checked ${row.name}`);checkLabel.append(check,document.createTextNode('I checked this'));
      count.oninput=()=>{const n=count.value===''?NaN:Number(count.value);const valid=Number.isInteger(n)&&n>=0&&n<=100;review.count=valid?n:null;count.setCustomValidity(valid?'':'Use a whole number from 0 to 100.');review.checked=false;check.checked=false;check.disabled=!valid;summary();};
      check.onchange=()=>{review.checked=check.checked;summary();};
      countLabel.append(count);controls.append(countLabel,checkLabel);item.append(controls,node('p',`${row.observed} suggested by scan${row.uncertain?' · Identity or count uncertain':row.observed===0?' · Not seen':''}.`,'inventory-detail'));
    }else item.append(node('p','Waiting for a clear parts photo.','inventory-detail'));
    if(row.id==='screw'){
      const link=node('a','Missing a screw? Explore a prototype STL ↗','missing-screw-link');
      link.href='/screws.html?source=knarrevik';item.append(link);
    }
    container.append(item);
  }
  summary();
}
function selectDetection(index){selection=index;for(const el of document.querySelectorAll('[data-detection]'))el.classList.toggle('active',Number(el.dataset.detection)===index);const editor=$(`#detection-editor [data-detection="${index}"]`);editor?.scrollIntoView({behavior:'smooth',block:'nearest'});}
function markers(){
  const overlay=$('#photo-markers');overlay.replaceChildren();
  detections.forEach((d,i)=>{const el=node('button',undefined,`photo-marker${d.certainty==='uncertain'||d.countCertainty==='approximate'||d.category==='unknown'?' uncertain':''}`);el.type='button';el.dataset.detection=String(i);el.classList.toggle('active',selection===i);const [x,y,w,h]=d.box;Object.assign(el.style,{left:`${x*100}%`,top:`${y*100}%`,width:`${w*100}%`,height:`${h*100}%`});el.setAttribute('aria-label',`Review suggested match ${i+1}: ${KNARREVIK.parts.find(p=>p.id===d.category)?.name||'Unknown part'}, quantity ${d.quantity}`);el.append(node('span',String(i+1)));el.onclick=()=>selectDetection(i);overlay.append(el);});
}
function editDetections(){
  $('#scan-observations').hidden=!detections.length;const container=$('#detection-editor');container.replaceChildren();
  detections.forEach((d,i)=>{
    const item=node('div',undefined,'detection-row');item.dataset.detection=String(i);const controls=node('div',undefined,'detection-controls');controls.append(node('span',String(i+1),'badge'));
    const select=node('select');select.setAttribute('aria-label',`Part type for match ${i+1}`);for(const category of CATEGORIES){const option=node('option',KNARREVIK.parts.find(p=>p.id===category)?.name||'Unmatched part');option.value=category;select.append(option);}select.value=d.category;
    const countLabel=node('label','Count '),count=node('input');count.type='number';count.min='1';count.max='40';count.step='1';count.value=String(d.quantity);count.setAttribute('aria-label',`Count for match ${i+1}`);countLabel.append(count);
    const changed=()=>{reviews={};markers();inventory();};
    select.onchange=()=>{d.category=select.value;d.certainty='likely';changed();};
    count.onchange=()=>{const n=Number(count.value);if(!Number.isInteger(n)||n<1||n>40){count.value=String(d.quantity);return;}d.quantity=n;d.countCertainty='clear';changed();};
    const remove=node('button','Remove');remove.type='button';remove.setAttribute('aria-label',`Remove match ${i+1}`);remove.onclick=()=>{detections.splice(i,1);selection=null;changed();editDetections();};
    controls.append(select,countLabel,remove);item.append(controls,node('p',`${d.certainty==='uncertain'?'Uncertain match. ':''}${d.countCertainty==='approximate'?'Approximate count. ':''}${d.note}`));container.append(item);
  });
}
async function choosePhoto(file){
  if(!file||preparing)return;
  const serial=++sequence;request?.abort();request=null;preparing=true;controls();status('Preparing the photo…');
  try{
    const prepared=await prepareScanPhoto(file);if(serial!==sequence||disposed)return;
    revokePhoto();photo=prepared;photoUrl=URL.createObjectURL(prepared);$('#scan-photo').src=photoUrl;$('#photo-canvas').hidden=false;$('#capture-empty').hidden=true;$('#photo-label').textContent='Your selected photo';result=null;detections=[];reviews={};selection=null;markers();editDetections();inventory();status('Photo ready. Select “Identify parts” to scan it.');
  }catch(e){status(e.message||'This photo could not be opened.',true);}
  finally{if(serial===sequence){preparing=false;controls();}}
}
for(const input of [$('#scan-file'),$('#scan-camera')])input.onchange=()=>{const file=input.files[0];input.value='';choosePhoto(file);};
const stage=$('#photo-stage');stage.ondragover=e=>{e.preventDefault();stage.classList.add('dragging');};stage.ondragleave=()=>stage.classList.remove('dragging');stage.ondrop=e=>{e.preventDefault();stage.classList.remove('dragging');if(e.dataTransfer.files.length!==1){status('Choose one overhead photo. Each new photo replaces the previous scan.',true);return;}choosePhoto(e.dataTransfer.files[0]);};
$('#scan-submit').onclick=async()=>{
  if(!photo||request||preparing)return;
  const serial=++sequence,current=new AbortController();request=current;controls();status('Looking for trays, legs, screws and the hex key…');
  try{
    const response=await fetch('/api/parts-scan',{method:'POST',headers:{'Content-Type':photo.type,'X-Unfold-Scan':'1'},body:photo,signal:current.signal});
    const payload=await response.json().catch(()=>{throw new Error('This page needs the Unfold scanning server.');});if(!response.ok)throw new Error(payload.error||'The photo could not be scanned.');
    if(serial!==sequence||disposed)return;
    if(payload.kitId!==KNARREVIK.id||payload.manualRevision!==KNARREVIK.revision)throw new Error('The scan used a different kit. Reload this page and retry.');
    result=validateScan(payload.result);detections=structuredClone(result.detections);reviews={};selection=null;markers();editDetections();inventory();status([result.summary,result.advice].filter(Boolean).join(' '),result.scene!=='laid_out_parts');
  }catch(e){if(serial===sequence&&!disposed)status(current.signal.aborted?'Scan cancelled. You can scan the photo again.':e.message||'The scan failed. Please retry.',!current.signal.aborted);}
  finally{if(request===current){request=null;controls();$('#scan-status').classList.remove('busy');}}
};
$('#scan-cancel').onclick=()=>{request?.abort();sequence++;request=null;controls();status('Scan cancelled. You can scan the photo again.');};
$('#download-checklist').onclick=()=>{
  if(!result)return;
  const exportData={schemaVersion:1,kitId:KNARREVIK.id,manualRevision:KNARREVIK.revision,manualUrl:KNARREVIK.manualUrl,createdAt:new Date().toISOString(),scan:result,editedDetections:detections,reviewedCounts:reviews,status:checklistStatus(detections,reviews),note:'User-reviewed observations from one photo. Not a completeness or assembly certification.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(exportData,null,2)],{type:'application/json'}));const link=node('a');link.href=url;link.download='knarrevik-parts-checklist.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('.scan-reference').addEventListener('toggle',()=>{if($('.scan-reference').open)ensureViewer();});
inventory();controls();
fetch('/api/scan-health').then(r=>r.json()).then(r=>{if(disposed)return;available=r.scanAvailable===true;if(!available)status('Parts scanning is not configured on this server yet.',true);controls();}).catch(()=>{if(!disposed)status('Open this page through the Unfold server to scan parts.',true);});
addEventListener('pagehide',()=>{disposed=true;sequence++;request?.abort();revokePhoto();viewer?.dispose();},{once:true});
