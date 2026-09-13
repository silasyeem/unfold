import {createViewer} from './viewer.js';
import {steps} from './steps.js';
import {createToolDispatcher, toolDefinitions} from './copilot-tools.js';
import {mountCopilot} from './copilot-ui.js';
const $=s=>document.querySelector(s);
let viewer;try{viewer=createViewer($('#scene'));}catch(e){$('#scene-error').hidden=false;console.error(e);}
let step=0,progress=0,playing=false,speed=1,exploded=false,last=performance.now(),manualPage=1,linked=true,pdfDoc=null,pdfIsExample=true,pdfFilename='',renderSerial=0,uploadSerial=0,toastTimer;
let manualRevision=0,currentView='guided',copilot;
function humanAction(){manualRevision++;queueMicrotask(()=>copilot?.updateContext());}
// Capture actual app controls before their handlers run. Model tools call app
// functions directly, so their own changes do not masquerade as human changes.
document.addEventListener('click',e=>{if(e.target.closest('.workspace button,#load-example,#upload-status button,#upload-open'))humanAction();},true);
document.addEventListener('input',e=>{if(e.target.id==='timeline')humanAction();},true);
$('#scene').addEventListener('pointerdown',e=>{if(e.target.tagName==='CANVAS')humanAction();},true);
$('#scene').addEventListener('wheel',humanAction,{passive:true});
const durationFor=s=>s===3?10:6.5;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function updatePlay(){$('#play-icon').textContent=playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',playing?'Pause assembly':'Play assembly');}
function setExploded(value){exploded=value;$('#explode').setAttribute('aria-pressed',value);viewer?.setExploded(value);}
function setStep(value,{play=false,position=0}={}){
 if(!Number.isInteger(value)||value<0||value>16)throw new Error('Choose an assembly step from 0 to 16.');
 step=value;progress=position;playing=play&&step>0;setExploded(false);viewer?.setState(step,progress);updatePlay();
 const s=steps[step];$('#step-count').textContent=String(step).padStart(2,'0')+' / 16';
 $('#instruction-kicker').textContent=step?'STEP '+String(step).padStart(2,'0')+' / 16':'BEFORE YOU BEGIN';
 $('#instruction-title').textContent=step?s.title:'A familiar chair. A clearer way to build it.';
 $('#instruction-body').textContent=s.body;$('#page-pill').textContent='Manual · p. '+s.page;
 $('#parts').replaceChildren(...s.parts.map(p=>{const el=document.createElement('span');el.textContent=p;return el;}));
 $('#previous').disabled=step===0;$('#next').textContent=step===0?'Start assembly →':step===16?'Back to overview ↺':'Next step →';
 $('#timeline').disabled=step===0;$('#time-label').textContent=step?'Step '+step+' of 16':'Overview';$('#duration-label').textContent=step?durationFor(step)+' sec':'Step by step';
 if(step===0){$('#view-caption').textContent='Drag to rotate · Scroll to zoom';$('#shot-label').textContent='Whole chair';}
 document.querySelectorAll('.step-item').forEach(el=>{const n=Number(el.dataset.step);el.classList.toggle('active',n===step);el.classList.toggle('done',n>0&&n<step);el.setAttribute('aria-current',n===step?'step':'false');});
 const active=$('.step-item.active');if(active){const list=$('#step-list');if(matchMedia('(max-width:560px)').matches)list.scrollLeft=active.offsetLeft-list.clientWidth/2;else list.scrollTop=Math.max(0,active.offsetTop-list.offsetTop-list.clientHeight/2);}
 if(pdfIsExample){linked=true;return showManual(s.page);}
}
for(let i=1;i<steps.length;i++){const s=steps[i];if(s.chapter){const chapter=document.createElement('div');chapter.className='chapter';chapter.textContent=s.chapter;$('#step-list').append(chapter);}const b=document.createElement('button');b.className='step-item';b.dataset.step=i;const number=document.createElement('span');number.className='step-number';number.textContent=String(i).padStart(2,'0');const name=document.createElement('span');name.textContent=s.short;b.append(number,name);$('#step-list').append(b);}
$('#step-list').onclick=e=>{const b=e.target.closest('[data-step]');if(b)setStep(Number(b.dataset.step),{play:true});};
$('#next').onclick=()=>setStep(step===16?0:step+1,{play:true});$('#previous').onclick=()=>setStep(Math.max(0,step-1),{play:step>1});
$('#play').onclick=()=>{if(step===0){setStep(1,{play:true});return;}if(!playing&&progress>=1)progress=0;playing=!playing;setExploded(false);updatePlay();};
$('#timeline').oninput=e=>{playing=false;progress=Number(e.target.value)/1000;viewer?.setState(step,progress);updatePlay();};
$('#speed').onclick=()=>{const speeds=[.5,1,1.5,2];speed=speeds[(speeds.indexOf(speed)+1)%speeds.length];$('#speed').textContent=speed+'×';$('#speed').setAttribute('aria-label','Playback speed: '+speed+' times');};
$('#explode').onclick=()=>{playing=false;updatePlay();setExploded(!exploded);};$('#reset-view').onclick=()=>viewer?.reset();
$('#underside').onclick=()=>viewer?.underside();$('#whole-build').onclick=()=>viewer?.wholeBuild();$('#guided-view').onclick=()=>{setExploded(false);viewer?.guide();};
$('#scene').addEventListener('viewchange',e=>{currentView=exploded?'exploded':e.detail.mode==='wide'?'whole':e.detail.label==='Underside'?'underside':e.detail.mode;$('#shot-label').textContent=e.detail.label;$('#view-caption').textContent=e.detail.note;$('#guided-view').setAttribute('aria-pressed',e.detail.mode==='guided');});
function tick(now){const delta=Math.min((now-last)/1000,.1);last=now;if(playing){progress=Math.min(1,progress+delta*speed/durationFor(step));viewer?.setState(step,progress);if(progress>=1){playing=false;updatePlay();if(step===16)toast('All 16 steps complete. Enjoy your STRANDMON.');}}$('#timeline').value=Math.round(progress*1000);$('#detail-sequence').hidden=step!==3;if(step===3){const phase=progress<.38?0:progress<.69?1:2;document.querySelectorAll('#detail-sequence span').forEach((el,i)=>el.classList.toggle('current',i===phase));}requestAnimationFrame(tick);}requestAnimationFrame(tick);
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();$('#play').click();}if(e.code==='ArrowRight'){e.preventDefault();$('#next').click();}if(e.code==='ArrowLeft'){e.preventDefault();$('#previous').click();}});
async function showManual(page){
 const count=pdfDoc?pdfDoc.numPages:20;manualPage=Math.max(1,Math.min(count,page));const serial=++renderSerial;
 $('#manual-page-label').textContent='Page '+manualPage+' of '+count;$('#manual-prev').disabled=manualPage===1;$('#manual-next').disabled=manualPage===count;
 $('#relink').hidden=linked||!pdfIsExample;$('.linked-label').textContent=pdfIsExample?(linked?'↔ Linked':'Browsing'):'PDF only';
 if(!pdfDoc){$('#manual-canvas').hidden=true;$('#manual-image').hidden=false;$('#manual-image').src='/assets/manual-'+String(manualPage).padStart(2,'0')+'.png';$('#manual-image').alt='IKEA STRANDMON manual, page '+manualPage;return;}
 try{const p=await pdfDoc.getPage(manualPage);if(serial!==renderSerial)return;const vp=p.getViewport({scale:1.6});const tmp=document.createElement('canvas');tmp.width=vp.width;tmp.height=vp.height;await p.render({canvasContext:tmp.getContext('2d'),viewport:vp}).promise;if(serial!==renderSerial)return;$('#manual-image').src=tmp.toDataURL('image/png');$('#manual-image').alt=pdfFilename+', page '+manualPage;$('#manual-image').hidden=false;$('#manual-canvas').hidden=true;}catch{if(serial===renderSerial)toast('This PDF page could not be rendered. Try another page.');}
}
$('#manual-prev').onclick=()=>{linked=false;showManual(manualPage-1);};$('#manual-next').onclick=()=>{linked=false;showManual(manualPage+1);};$('#relink').onclick=()=>{linked=true;showManual(steps[step].page);};
$('#manual-expand').onclick=()=>{$('#large-manual-image').src=$('#manual-image').src;$('#large-page-label').textContent=(pdfDoc?pdfFilename:'IKEA STRANDMON')+' · page '+manualPage;$('#manual-dialog').showModal();};
const uploadDialog=$('#upload-dialog');$('#upload-open').onclick=()=>{playing=false;updatePlay();uploadDialog.showModal();};
$('#load-example').onclick=()=>{uploadSerial++;pdfDoc?.destroy();pdfDoc=null;pdfIsExample=true;pdfFilename='';status('');$('#pdf-input').value='';restoreSourceNote();uploadDialog.close();setStep(0);toast('STRANDMON example ready. Choose a step to begin.');};
function restoreSourceNote(){$('.source-note').replaceChildren();const strong=document.createElement('strong');strong.textContent='From paper to motion';const p=document.createElement('p');p.textContent='Each animation follows the matching diagram in IKEA’s STRANDMON manual.';const a=document.createElement('a');a.textContent='IKEA · AA-2019535-7 ↗';a.href='https://www.ikea.com/th/en/assembly_instructions/strandmon-wing-chair-kelinge-beige__AA-2019535-7-100.pdf';a.target='_blank';a.rel='noopener';$('.source-note').append(strong,p,a);$('.manual-panel').classList.remove('preview-only');}
function status(text,error=false){$('#upload-status').textContent=text;$('#upload-status').classList.toggle('error',error);}
async function handleFile(file){
 const serial=++uploadSerial;if(!file)return;if(file.size>20*1024*1024){status('Please choose a PDF smaller than 20 MB.',true);return;}if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf'){status('Please choose a PDF file.',true);return;}
 status('Reading '+file.name+'…');let loaded;
 try{const bytes=new Uint8Array(await file.arrayBuffer());if(!new TextDecoder().decode(bytes.slice(0,1024)).includes('%PDF-'))throw new Error('This file does not appear to be a valid PDF.');const pdfjs=await import('./vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';const task=pdfjs.getDocument({data:bytes,isEvalSupported:false});loaded=await task.promise;
 if(serial!==uploadSerial){loaded.destroy();return;}if(loaded.numPages>100){loaded.destroy();throw new Error('This demo previews manuals up to 100 pages.');}
 const text=[];for(let i=1;i<=Math.min(2,loaded.numPages);i++){const page=await loaded.getPage(i);text.push((await page.getTextContent()).items.map(x=>x.str).join(' '));}
 if(serial!==uploadSerial){loaded.destroy();return;}
 const recognized=loaded.numPages===20&&/STRANDMON/i.test(text[0])&&/AA\s*-\s*2019535\s*-\s*7\b/i.test(text.join(' '));
 status(recognized?'STRANDMON recognised · 20 pages. Its prepared animation is ready.':file.name+' · '+loaded.numPages+' pages. No 3D guide is available for this manual yet. You can preview the PDF.');
 const btn=document.createElement('button');btn.className='button primary';btn.textContent=recognized?'Open 3D guide →':'Preview PDF only →';btn.onclick=()=>{status('');$('#pdf-input').value='';if(pdfDoc!==loaded)pdfDoc?.destroy();pdfDoc=loaded;pdfIsExample=recognized;pdfFilename=file.name;uploadDialog.close();if(recognized){restoreSourceNote();setStep(0);toast('PDF linked to the prepared STRANDMON guide.');}else{linked=false;$('.manual-panel').classList.add('preview-only');const strong=document.createElement('strong');strong.textContent='PDF preview only';const p=document.createElement('p');p.textContent='This upload has no animation yet. The 3D view still shows the prepared STRANDMON example.';const restore=document.createElement('button');restore.className='text-button';restore.textContent='Restore STRANDMON manual';restore.onclick=()=>$('#load-example').click();$('.source-note').replaceChildren(strong,p,restore);showManual(1);toast('PDF preview opened. The 3D guide remains STRANDMON.');}};$('#upload-status').append(btn);
 }catch(error){if(serial!==uploadSerial)return;status(error.name==='PasswordException'?'This PDF is password protected. Choose an unlocked copy.':error.message?.includes('valid PDF')||error.message?.includes('100 pages')?error.message:'This PDF could not be read. Try another PDF or open the example.',true);}
}
$('#pdf-input').onchange=e=>handleFile(e.target.files[0]);const drop=$('#dropzone');for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('dragging');});for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragging');});drop.addEventListener('drop',e=>handleFile(e.dataTransfer.files[0]));
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
setStep(0);
const reveal=selector=>{if(matchMedia('(max-width:850px)').matches)$(selector).scrollIntoView({block:'start',behavior:'auto'});};
const appTools={
 getRevision:()=>manualRevision,
 getState:()=>({product:'STRANDMON',step,title:steps[step].title,body:steps[step].body,parts:[...steps[step].parts],preparedGuidePage:steps[step].page,preparedGuide:true,preparedGuideApplies:pdfIsExample,manualMode:pdfIsExample?'prepared-strandmon':'unrelated-upload',manualPage,manualPageCount:pdfDoc?pdfDoc.numPages:20,linked,view:currentView,viewerAvailable:Boolean(viewer),progress,playing,speed}),
 navigateStep:value=>{const done=setStep(value);reveal('.viewer-panel');return done;},
 showManualPage:page=>{linked=false;const done=showManual(page);reveal('.manual-panel');return done;},
 setView:mode=>{playing=false;updatePlay();setExploded(mode==='exploded');if(mode==='whole')viewer.wholeBuild();else if(mode==='underside')viewer.underside();else if(mode==='guided')viewer.guide();reveal('.viewer-panel');},
 controlPlayback:action=>{if(action==='pause'){playing=false;updatePlay();return;}let done;if(step===0){done=setStep(1,{play:true});}else{if(action==='replay'||progress>=1)progress=0;playing=true;setExploded(false);viewer?.setState(step,progress);updatePlay();}reveal('.viewer-panel');return done;},
};
const dispatchTool=createToolDispatcher(appTools);
copilot=mountCopilot({dispatch:dispatchTool,getRevision:appTools.getRevision,getState:appTools.getState});
const modelContext=document.modelContext;if(modelContext?.registerTool){const lifecycle=new AbortController();const register=tool=>{try{Promise.resolve(modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 for(const definition of toolDefinitions)register({name:definition.name,description:definition.description,inputSchema:definition.parameters,annotations:{readOnlyHint:['get_assembly_state','list_assembly_steps'].includes(definition.name)},execute:async input=>{if(!['get_assembly_state','list_assembly_steps'].includes(definition.name))humanAction();const result=await dispatchTool(definition.name,input);if(!result.ok)throw new Error(result.error);return result.state??result;}});
 addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}
