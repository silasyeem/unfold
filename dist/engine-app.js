import {createGeneratedViewer} from './generated-viewer.js';
import {assertGuide} from './guide-schema.js';
import {mountPhotoIntake} from './photo-intake.js';
import {mountManualLibrary} from './manual-library.js';
import {mountGuideScanner} from './guide-scanner.js';
const $=s=>document.querySelector(s);
const labels={upside_down:'Upside down',upright:'Upright',on_back:'On its back',on_left:'On its left side',on_right:'On its right side'};
let photoIntake,manualLibrary,conversionBusy=false,choosingManual=false;const intakeBusy={photos:false,library:false,manual:false,demo:false};let demoController=null;
let viewer,output=null,pdf=null,file=null,pdfHash=null,index=-1,progress=0,playing=false,speed=1,exploded=false,page=1,linked=true,renderId=0,renderTask=null,uploadId=0,conversion=null,last=performance.now(),reviewed=new Set();
const guideScanner=mountGuideScanner({onOpen:()=>{playing=false;syncPlay();}});
try{viewer=createGeneratedViewer($('#generated-scene'),label=>$('#view-label').textContent=label);}catch{$('#empty-scene h2').textContent='3D is unavailable';$('#empty-scene p').textContent='Use a WebGL-capable browser to view generated parts. PDF conversion is still available.';}
function status(message,{busy=false,error=false}={}){$('#conversion-status').textContent=message;$('.conversion-bar').classList.toggle('busy',busy);$('.conversion-bar').classList.toggle('error',error);}
function syncPlay(){$('#play').textContent=playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',playing?'Pause step':'Play step');}
function syncScanner(){guideScanner.sync(output,{busy:conversionBusy||Object.values(intakeBusy).some(Boolean),choosingManual});}
function syncFlow(){syncScanner();document.body.dataset.state=conversionBusy?'converting':choosingManual?'empty':output?'guide':pdf?'ready':'empty';$('#resume-manual').hidden=!choosingManual||!(output||pdf);$('#resume-manual').textContent=output?'Back to guide':'Back to manual';}
function syncBusy(){$('#download-manual').disabled=!file||!pdf;const busy=conversionBusy||intakeBusy.photos||intakeBusy.library||intakeBusy.manual||intakeBusy.demo;$('#cancel').hidden=!conversionBusy;$('#convert').disabled=busy||!file||!pdf;for(const input of [$('#manual-file'),$('#guide-file'),$('#change-manual'),$('#resume-manual')])input.disabled=busy;for(const button of document.querySelectorAll('[data-knarrevik-demo]')){button.disabled=busy;button.setAttribute('aria-busy',String(intakeBusy.demo));button.textContent=intakeBusy.demo?'Loading demo…':'KNARREVIK demo';}photoIntake?.setDisabled(busy);manualLibrary?.setDisabled(busy);syncScanner();}
function setBusy(value){conversionBusy=value;syncBusy();syncFlow();}
async function showPage(value){
 if(!pdf)return;page=Math.max(1,Math.min(pdf.numPages,value));const serial=++renderId;renderTask?.cancel();$('#pdf-canvas').hidden=true;$('#enlarge').disabled=true;$('#manual-empty').hidden=false;$('#manual-empty').textContent='Loading source page…';
 $('#page-label').textContent=`Page ${page} of ${pdf.numPages}`;$('#page-prev').disabled=page===1;$('#page-next').disabled=page===pdf.numPages;$('#manual-link-state').textContent=linked&&output?'Linked':'Browsing';$('#relink').hidden=linked||index<0;
 try{const source=await pdf.getPage(page);if(serial!==renderId)return;const viewport=source.getViewport({scale:1.5});const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;renderTask=source.render({canvasContext:canvas.getContext('2d'),viewport});await renderTask.promise;if(serial!==renderId)return;const target=$('#pdf-canvas');target.width=canvas.width;target.height=canvas.height;target.getContext('2d').drawImage(canvas,0,0);target.hidden=false;$('#manual-empty').hidden=true;$('#enlarge').disabled=false;}catch(error){if(error.name!=='RenderingCancelledException'&&serial===renderId){$('#manual-empty').textContent='This source page could not be rendered. Try another page.';status('This source page could not be rendered.',{error:true});}}
}
function notes(){
 const list=$('#review-notes');list.replaceChildren();
 const issues=Array.isArray(output?.visualReview?.issues)?output.visualReview.issues:[];
 const visualNotes=issues.filter(issue=>issue&&(issue.stepIndex===-1||index>=0&&issue.stepIndex===index)).map(issue=>[issue.description,issue.correction].filter(value=>typeof value==='string'&&value.trim()).join(' ')).filter(Boolean).map(note=>'Visual review: '+note);
 const values=[...new Set([...visualNotes,...(output?.guide.reviewNotes||[]),...(index>=0?output.guide.steps[index].reviewNotes:[])])];
 for(const note of values.length?values:['Check the approximate geometry against the original manual.']){const li=document.createElement('li');li.textContent=note;list.append(li);}
 $('#review-state').textContent=index<0?'':reviewed.has(index)?'Checked by you':'Needs review';
}
function setStep(next){
 if(!output)return;const guide=output.guide;if(next< -1||next>=guide.steps.length)return;
 index=next;progress=0;playing=false;exploded=false;$('#exploded').setAttribute('aria-pressed','false');viewer?.setState(index,progress);viewer?.guide();syncPlay();
 const step=guide.steps[index];$('#instruction-step').textContent=step?`STEP ${index+1} / ${guide.steps.length}`:'PARTS OVERVIEW';$('#instruction-title').textContent=step?step.title:guide.productName;$('#instruction-text').textContent=step?step.instruction:guide.summary;
 $('#source-page').textContent=step?`Manual · p. ${step.sourcePage}`:'';$('#step-count').textContent=`${Math.max(0,index+1)} / ${guide.steps.length}`;$('#time-label').textContent=step?`Step ${index+1} of ${guide.steps.length}`:'Overview';$('#duration-label').textContent=step?`${step.duration} sec`:'';
 $('#orientation-label').textContent=step?`${labels[step.orientation]} · drag to rotate · scroll to zoom`:'Drag to rotate · scroll to zoom';$('#view-label').textContent=step?(step.actions.length?'Guided joint view':'Whole build · orientation'):'Whole build';$('#prev').disabled=index<0;$('#next').disabled=false;$('#next').textContent=index===guide.steps.length-1?'Overview ↺':index<0?'Start assembly →':'Next step →';$('#progress').disabled=index<0;$('#edit-step').disabled=index<0;
 $('#active-parts').replaceChildren();for(const id of new Set(step?.actions.map(a=>a.partId)||[])){const p=guide.parts.find(p=>p.id===id);const span=document.createElement('span');span.textContent=p.name;$('#active-parts').append(span);}
 document.querySelectorAll('#step-list [data-step]').forEach(b=>{const active=Number(b.dataset.step)===index;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'step':'false');});
 if(pdf){linked=true;showPage(step?.sourcePage||1);}notes();
}
function loadGuide(result){
 assertGuide(result.guide);output=result;reviewed=new Set((result.reviewedSteps||[]).filter(n=>Number.isInteger(n)&&n>=0&&n<result.guide.steps.length));
 viewer?.load(result.guide);$('#empty-scene').hidden=!!viewer;$('#product-name').textContent=result.guide.productName;$('#guide-meta').textContent=`${result.guide.parts.length} parts · ${result.guide.steps.length} steps`;$('#document-label').textContent=result.provenance?.filename||'ASSEMBLY GUIDE';$('#draft-tag').textContent='Generated draft';
 const list=$('#step-list');list.replaceChildren();for(let i=-1;i<result.guide.steps.length;i++){const button=document.createElement('button');button.className='step-item';button.dataset.step=i;const num=document.createElement('span');num.className='step-number';num.textContent=i<0?'◇':String(i+1).padStart(2,'0');const label=document.createElement('span');label.textContent=i<0?'Parts overview':result.guide.steps[i].title;button.append(num,label);button.onclick=()=>setStep(i);list.append(button);}
 $('#parts-summary').textContent=`Parts inventory · ${result.guide.parts.length}`;$('#parts-list').replaceChildren();for(const part of result.guide.parts){const button=document.createElement('button');button.className='part-row';const swatch=document.createElement('span');swatch.className='part-swatch';swatch.style.background=part.color;const name=document.createElement('span');name.textContent=part.name;const info=document.createElement('small');info.textContent=`p. ${part.sourcePage}`;button.append(swatch,name,info);button.onclick=()=>{viewer?.selectPart(part.id);if(pdf){linked=false;showPage(part.sourcePage);}};$('#parts-list').append(button);}
 for(const selector of ['#export','#play','#speed','#step-view','#whole-view','#exploded'])$(selector).disabled=false;choosingManual=false;setStep(-1);syncFlow();syncBusy();
}
async function pickPdf(selected,{productName,preparedGuide}={}){
 if(!selected)return;const serial=++uploadId;conversion?.abort();playing=false;syncPlay();
 if(selected.size>8*1024*1024){status('Choose a PDF smaller than 8 MB.',{error:true});return;}
 let candidate;intakeBusy.manual=true;syncBusy();
 try{
  status('Reading the PDF…',{busy:true});const bytes=new Uint8Array(await selected.arrayBuffer());if(!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'))throw new Error('Choose a valid PDF file.');
  const module=await import('./vendor/pdf.mjs');module.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';candidate=await module.getDocument({data:bytes.slice(),isEvalSupported:false}).promise;
  if(candidate.numPages>40)throw new Error('Conversion supports manuals with up to 40 pages.');
  const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  if(preparedGuide){assertGuide(preparedGuide.guide,candidate.numPages);if(preparedGuide.provenance?.sha256!==hash)throw new Error('The demo guide and manual do not match. Your current guide is unchanged.');}
  if(serial!==uploadId){candidate.destroy();return;}renderId++;renderTask?.cancel();await pdf?.destroy();if(serial!==uploadId){candidate.destroy();return;}pdf=candidate;file=selected;pdfHash=hash;
  if(preparedGuide){loadGuide(preparedGuide);status('KNARREVIK guide ready. Scan your parts, then follow the assembly steps.');}
  else if(output&&output.provenance?.sha256===hash){linked=true;showPage(index>=0?output.guide.steps[index].sourcePage:1);status('Original PDF linked to this generated guide.');}
  else{output=null;playing=false;index=-1;progress=0;$('#instruction-step').textContent='READY WHEN YOU ARE';$('#instruction-title').textContent='Your assembly, one step at a time.';$('#instruction-text').textContent='Generate a guide from this PDF to see its assembly instructions.';$('#source-page').textContent='';$('#orientation-label').textContent='Drag to rotate · scroll to zoom';$('#duration-label').textContent='';$('#time-label').textContent='Overview';$('#step-count').textContent='—';$('#review-state').textContent='';$('#empty-scene').hidden=false;$('#empty-scene h2').textContent='Ready to unfold.';$('#empty-scene p').textContent='Generate a draft from this manual, then review its parts and steps.';$('#step-list').replaceChildren();$('#active-parts').replaceChildren();$('#parts-list').replaceChildren();$('#review-notes').replaceChildren();$('#parts-summary').textContent='Parts inventory';$('#product-name').textContent='Your manual is ready';$('#document-label').textContent='YOUR MANUAL';$('#guide-meta').textContent='Source-linked · Interactive 3D';for(const selector of ['#export','#play','#speed','#step-view','#whole-view','#exploded','#prev','#next','#progress','#edit-step'])$(selector).disabled=true;linked=false;showPage(1);status('Check the pages are complete and in order, then create your animated guide.');}
  if(productName&&!output)$('#product-name').textContent=productName;
  $('#conversion-title').textContent=productName?`${pdf.numPages} ${pdf.numPages===1?'page':'pages'} · Original manual`:`${selected.name} · ${pdf.numPages} ${pdf.numPages===1?'page':'pages'}`;choosingManual=false;syncFlow();return true;
 }catch(error){candidate?.destroy();if(serial===uploadId)status(error.name==='PasswordException'?'Choose an unlocked PDF.':error.message||'This PDF could not be read.',{error:true});return false;}
 finally{if(serial===uploadId){intakeBusy.manual=false;syncBusy();}}
}
async function loadKnarrevikDemo(){
 if(conversionBusy||Object.values(intakeBusy).some(Boolean))return;
 playing=false;syncPlay();intakeBusy.demo=true;syncBusy();status('Opening the KNARREVIK demo…',{busy:true});
 const controller=new AbortController();demoController=controller;const timeout=setTimeout(()=>controller.abort(),30000);
 try{
  const responses=await Promise.all(['/examples/knarrevik.unfold.json','/reference/knarrevik-manual.pdf'].map(url=>fetch(url,{signal:controller.signal,cache:'no-cache'})));
  if(responses.some(response=>!response.ok))throw new Error('The KNARREVIK demo could not be opened. Please try again.');
  const [guideText,bytes]=await Promise.all([responses[0].text(),responses[1].arrayBuffer()]);
  if(guideText.length>2*1024*1024||bytes.byteLength>8*1024*1024)throw new Error('The demo files could not be loaded. Please try again.');
  const result=JSON.parse(guideText);assertGuide(result.guide);
  controller.signal.throwIfAborted();
  await pickPdf(new File([bytes],'knarrevik-manual.pdf',{type:'application/pdf'}),{productName:'KNARREVIK',preparedGuide:result});
 }catch(error){status(controller.signal.aborted?'The demo took too long to open. Please try again.':error.message||'The KNARREVIK demo could not be opened.',{error:true});}
 finally{controller.abort();clearTimeout(timeout);if(demoController===controller)demoController=null;intakeBusy.demo=false;syncBusy();}
}
for(const button of document.querySelectorAll('[data-knarrevik-demo]'))button.onclick=loadKnarrevikDemo;
async function pickManual(files){
 const selected=[...files];if(!selected.length)return;
 const isPdf=file=>file.type==='application/pdf'||/\.pdf$/i.test(file.name);
 const isPhoto=file=>['image/jpeg','image/png'].includes(file.type)||/\.(jpe?g|png)$/i.test(file.name);
 if(selected.some(isPdf)){if(selected.length!==1){status('Upload one PDF, or select photos of the same manual. Keep PDFs and photos separate.',{error:true});return;}return pickPdf(selected[0]);}
 if(!selected.every(isPhoto)){status('Upload a PDF or JPEG/PNG photos. Save HEIC photos as JPEG first.',{error:true});return;}
 await photoIntake.open(selected,{replace:true});
}
$('#manual-file').onchange=e=>{const files=[...e.target.files];e.target.value='';return pickManual(files);};
$('#change-manual').onclick=()=>{choosingManual=true;playing=false;syncPlay();syncFlow();};
$('#resume-manual').onclick=()=>{choosingManual=false;syncFlow();};
$('#convert').onclick=async()=>{
 if(!file||!pdf)return;playing=false;syncPlay();conversion=new AbortController();const current=conversion;setBusy(true);status('Uploading the manual…',{busy:true});let received=false;
 try{const response=await fetch('/api/convert',{method:'POST',headers:{'Content-Type':'application/pdf','X-Unfold-Convert':'1','X-Pdf-Pages':String(pdf.numPages),'X-Pdf-Name':encodeURIComponent(file.name)},body:file,signal:current.signal});if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'Conversion is unavailable. Start the Unfold server and try again.');}
  if(!response.headers.get('content-type')?.includes('text/event-stream'))throw new Error('This preview does not have a conversion server.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const message=buffer.slice(0,end);buffer=buffer.slice(end+2);if(message.startsWith(':'))continue;const event=message.split('\n').find(x=>x.startsWith('event: '))?.slice(7);const raw=message.split('\n').filter(x=>x.startsWith('data: ')).map(x=>x.slice(6)).join('\n');if(!raw)continue;const data=JSON.parse(raw);if(event==='stage')status(data.message,{busy:true});if(event==='error')throw new Error(data.message);if(event==='result'){if(data.provenance?.sha256!==pdfHash)throw new Error('The generated guide does not match the uploaded PDF.');loadGuide(data);received=true;}}}
  if(!received)throw new Error('The connection closed before the guide was ready. Please retry.');status('Your 3D draft is ready. Review the highlighted notes and compare each step with its source diagram.');
 }catch(error){status(current.signal.aborted?'Conversion cancelled. Your manual is still available.':error.message,{error:!current.signal.aborted});}
 finally{if(conversion===current){conversion=null;setBusy(false);}}
};
$('#cancel').onclick=()=>conversion?.abort();
$('#guide-file').onchange=async e=>{const selected=e.target.files[0];e.target.value='';if(!selected)return;$('.guide-menu').open=false;const serial=++uploadId;conversion?.abort();try{if(selected.size>2*1024*1024)throw new Error('Guide files must be smaller than 2 MB.');const result=JSON.parse(await selected.text());assertGuide(result.guide);if(serial!==uploadId)return;renderId++;renderTask?.cancel();await pdf?.destroy();if(serial!==uploadId)return;pdf=null;file=null;pdfHash=null;$('#pdf-canvas').hidden=true;$('#manual-empty').hidden=false;$('#manual-empty').textContent='Upload the original PDF to relink its source diagrams.';$('#manual-link-state').textContent='No PDF';$('#page-label').textContent='—';for(const selector of ['#enlarge','#page-prev','#page-next','#convert'])$(selector).disabled=true;$('#relink').hidden=true;loadGuide(result);$('#conversion-title').textContent='Saved guide opened';status('Upload its original PDF to view linked diagrams.');}catch(error){status(error.message||'This guide could not be opened.',{error:true});}};
$('#download-manual').onclick=()=>{if(!file)return;downloadFile(file,file.name);};
function downloadFile(blob,name){$('.guide-menu').open=false;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export').onclick=()=>{if(!output)return;const blob=new Blob([JSON.stringify({...output,reviewedSteps:[...reviewed]},null,2)],{type:'application/json'});downloadFile(blob,(output.guide.productName.replace(/[^a-zA-Z0-9_-]/g,'_')||'assembly')+'.unfold.json');};
$('#play').onclick=()=>{if(index<0)setStep(0);if(progress>=1)progress=0;playing=!playing;if(exploded){exploded=false;$('#exploded').setAttribute('aria-pressed','false');viewer?.guide();}syncPlay();};
$('#next').onclick=()=>setStep(index===output.guide.steps.length-1?-1:index+1);$('#prev').onclick=()=>setStep(index-1);
$('#progress').oninput=e=>{playing=false;progress=Number(e.target.value)/1000;viewer?.setState(index,progress);syncPlay();};
$('#speed').onclick=()=>{const speeds=[.5,1,1.5,2];speed=speeds[(speeds.indexOf(speed)+1)%speeds.length];$('#speed').textContent=speed+'×';};
function clearExploded(){exploded=false;$('#exploded').setAttribute('aria-pressed','false');}
$('#step-view').onclick=()=>{clearExploded();viewer?.guide();};$('#whole-view').onclick=()=>{clearExploded();viewer?.wholeBuild();};$('#exploded').onclick=()=>{playing=false;syncPlay();exploded=!exploded;$('#exploded').setAttribute('aria-pressed',String(exploded));viewer?.setExploded(exploded);};
$('#page-prev').onclick=()=>{linked=false;showPage(page-1);};$('#page-next').onclick=()=>{linked=false;showPage(page+1);};$('#relink').onclick=()=>{linked=true;showPage(output.guide.steps[index].sourcePage);};
$('#enlarge').onclick=()=>{$('#large-page').src=$('#pdf-canvas').toDataURL();$('#page-dialog').showModal();};
$('#edit-step').onclick=()=>{const step=output.guide.steps[index];$('#review-title').value=step.title;$('#review-instruction').value=step.instruction;$('#review-page').value=step.sourcePage;$('#review-page').max=output.guide.pageCount;$('#review-orientation').value=step.orientation;$('#review-dialog').showModal();};$('#review-close').onclick=()=>$('#review-dialog').close();
$('#review-form').onsubmit=e=>{e.preventDefault();const next=structuredClone(output);Object.assign(next.guide.steps[index],{title:$('#review-title').value,instruction:$('#review-instruction').value,sourcePage:Number($('#review-page').value),orientation:$('#review-orientation').value});try{assertGuide(next.guide);const selected=index;reviewed.add(index);next.reviewedSteps=[...reviewed];loadGuide(next);setStep(selected);$('#review-dialog').close();}catch(error){status(error.message,{error:true});}};
document.addEventListener('click',event=>{if(!event.target.closest('.guide-menu'))$('.guide-menu').open=false;});
document.addEventListener('keydown',e=>{if(!output||document.body.dataset.state!=='guide'||document.querySelector('dialog[open]')||e.target.closest('input,textarea,select,button,a,summary'))return;if(e.code==='Space'){e.preventDefault();$('#play').click();}if(e.code==='ArrowRight'){e.preventDefault();$('#next').click();}if(e.code==='ArrowLeft'){e.preventDefault();$('#prev').click();}});
let animation;function tick(now){const delta=Math.min((now-last)/1000,.1);last=now;if(playing&&output&&index>=0){progress=Math.min(1,progress+delta*speed/output.guide.steps[index].duration);viewer?.setState(index,progress);if(progress>=1){playing=false;syncPlay();}}$('#progress').value=Math.round(progress*1000);animation=requestAnimationFrame(tick);}animation=requestAnimationFrame(tick);
addEventListener('pagehide',()=>{conversion?.abort();demoController?.abort();cancelAnimationFrame(animation);viewer?.dispose();guideScanner.destroy();photoIntake?.destroy();manualLibrary?.destroy();pdf?.destroy();},{once:true});
fetch('/api/health').then(r=>r.json()).then(r=>{if(!r.conversionAvailable)status('Conversion is not configured on this server. You can still open a saved guide.',{error:true});}).catch(()=>status('Open this page through the Unfold server to generate guides. Saved guides can still be opened.',{error:true}));

// Enable intake only after its handlers are registered.
const intakeError=error=>status(error?.message||String(error),{error:true});
const acceptPreparedPdf=async(file,metadata)=>{if(!await pickPdf(file,metadata))throw new Error($('#conversion-status').textContent);};
photoIntake=mountPhotoIntake($('#photo-intake'),{onPdfReady:acceptPreparedPdf,onError:intakeError,showLauncher:false,onBusy:value=>{intakeBusy.photos=value;syncBusy();}});
manualLibrary=mountManualLibrary($('#manual-library'),{onDemo:loadKnarrevikDemo,onPdfReady:acceptPreparedPdf,onError:intakeError,onBusy:value=>{intakeBusy.library=value;syncBusy();}});
syncBusy();syncFlow();
