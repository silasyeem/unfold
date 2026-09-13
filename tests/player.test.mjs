import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {fixture} from './fixture.mjs';
import {mountConversionProgress} from '../dist/conversion-progress.js';
import {KNARREVIK} from '../dist/knarrevik.js';
import {createEngineCopilotAdapter} from '../dist/engine-copilot.js';
import {createToolDispatcher} from '../dist/copilot-tools.js';
import {assertGuide} from '../dist/guide-schema.js';
import {compileGuide,evaluateGuide,orientations,smooth} from '../dist/guide-state.js';
import * as Base from '../dist/vendor/three.module.js';

test('generic geometry evaluates all states, child highlights survive registry order, and disposal releases the canvas',async()=>{
 let frame,scene,camera,removed=false;const callbacks={};
 const previous={devicePixelRatio:globalThis.devicePixelRatio,ResizeObserver:globalThis.ResizeObserver,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 Object.assign(globalThis,{devicePixelRatio:1,ResizeObserver:class{constructor(f){this.f=f;}observe(){this.f();}disconnect(){}},requestAnimationFrame:f=>(frame=f,1),cancelAnimationFrame(){}});
 class Renderer{constructor(){this.shadowMap={};this.domElement={remove(){removed=true;}};}setPixelRatio(){}setSize(){}render(s,c){scene=s;camera=c;s.updateMatrixWorld(true);}dispose(){}}
 class Controls{constructor(){this.target=new Base.Vector3();}update(){}addEventListener(name,fn){callbacks[name]=fn;}dispose(){}}
 try{
  let source=await readFile(new URL('../dist/generated-viewer.js',import.meta.url),'utf8');source=source.replace(/^import .*$/gm,'').replace('export function','function');
  const create=new Function('T','OrbitControls','compileGuide','evaluateGuide','orientations','smooth',source+';return createGeneratedViewer;')({...Base,WebGLRenderer:Renderer},Controls,compileGuide,evaluateGuide,orientations,smooth);
  const viewer=create({prepend(){},clientWidth:900,clientHeight:600});const guide=fixture();guide.parts=[guide.parts[1],guide.parts[2],guide.parts[0]];viewer.load(guide);viewer.setState(0,.1);frame();
  const bracket=scene.getObjectByName('bracket');assert.equal(bracket.children[0].material.emissive.getHex(),0x285bff);
  for(let step=0;step<guide.steps.length;step++)for(const t of [0,.1,.5,.7,1]){viewer.setState(step,t);frame();scene.traverse(o=>{assert([...o.position,...o.quaternion,...o.scale].every(Number.isFinite));if(o.isMesh)assert([...o.geometry.attributes.position.array].every(Number.isFinite));});}
  guide.steps[0].orientation='upside_down';guide.steps[0].cameraDirection=[1,1,1];viewer.load(guide);viewer.setState(0,.5);frame();assert(camera.position.y>=.1,'Guided camera must stay above the support surface');
  callbacks.start();viewer.setState(0,.9);frame();assert.equal(viewer.getView().mode,'free');viewer.guide();frame();assert.equal(viewer.getView().mode,'guided');viewer.dispose();assert(removed);
 }finally{Object.assign(globalThis,previous);}
});

async function harness({pageCount=1,hostedRendering=false,entry='engine.html'}={}){
 const html=await readFile(new URL('../dist/'+entry,import.meta.url),'utf8');const {document}=parseHTML(html);const create=document.createElement.bind(document);
 document.createElement=name=>{const element=create(name);if(name==='canvas'){element.getContext=()=>({drawImage(){}});element.toDataURL=()=>'';}return element;};
 for(const element of document.querySelectorAll('canvas'))element.getContext=()=>({drawImage(){}});
 for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');Object.defineProperty(dialog,'open',{get:()=>dialog.hasAttribute('open')});}
 let viewMode='whole',loaded=0,photoOptions,voiceOptions;const voiceSession={current:null,end(){this.current=null;},updateContext(){},refreshAvailability(){}};const photoCalls=[],fetchCalls=[],loadedGuides=[];
 let viewerIndex=-1;
 const fakeViewer={load(guide){loaded++;loadedGuides.push(guide);viewMode='whole';viewerIndex=-1;},setState(index){if(index!==viewerIndex)viewMode='whole';viewerIndex=index;},getView:()=>({mode:viewMode}),guide(){viewMode=viewerIndex<0?'whole':'guided';},wholeBuild(){viewMode='whole';},setExploded(){viewMode='whole';},selectPart(){},dispose(){}};
 const fakePdf={numPages:pageCount,destroy:async()=>{},getPage:async()=>({getViewport:()=>({width:100,height:100}),render:()=>({promise:Promise.resolve(),cancel(){}})})};
 const context={document,queueMicrotask,mountConversionProgress,createEngineCopilotAdapter,createToolDispatcher,mountCopilot:options=>{voiceOptions=options;return voiceSession;},mountPhotoIntake:(container,options)=>{photoOptions=options;return{open:async(files,settings)=>{photoCalls.push({files,settings});},setDisabled(){},destroy(){}};},mountManualLibrary:()=>({setDisabled(){},destroy(){}}),createGeneratedViewer:()=>fakeViewer,assertGuide,console,performance,crypto,Blob,File,URL,TextDecoder,TextEncoder,AbortController,structuredClone,setTimeout,clearTimeout,requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(){},fetch:async(url,options)=>{fetchCalls.push({url,options});return Response.json({conversionAvailable:true,browserRendering:hostedRendering});},__pdfModule:{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(fakePdf)})}};

 const scannerSource=(await readFile(new URL('../dist/guide-scanner.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace('export function','function');
 context.mountGuideScanner=new Function('document','KNARREVIK',scannerSource+';return mountGuideScanner;')(document,KNARREVIK);
 let source=await readFile(new URL('../dist/engine-app.js',import.meta.url),'utf8');source=source.replace(/^import .*$/gm,'').replace("await import('./vendor/pdf.mjs')",'__pdfModule').replace("await import('./hosted-convert.js')",'__hostedModule');
 vm.runInNewContext(source+'\nglobalThis.harness={loadGuide,setStep,pickPdf,pickManual,showPage,state:()=>({output,index,page,playing,progress,exploded,pdfHash})};',context);
 return{document,context,app:context.harness,voice:voiceOptions,voiceSession,photoCalls,photoOptions,fetchCalls,loadedGuides,getMode:()=>viewMode,getLoads:()=>loaded};
}
test('play and pause preserve guided camera mode',async()=>{
 const h=await harness();h.app.loadGuide({guide:fixture()});h.app.setStep(0);h.document.querySelector('#step-view').onclick();h.document.querySelector('#play').onclick();assert.equal(h.getMode(),'guided');h.document.querySelector('#play').onclick();assert.equal(h.getMode(),'guided');assert.equal(h.app.state().playing,false);h.document.querySelector('#exploded').onclick();assert.equal(h.app.state().exploded,true);h.document.querySelector('#step-view').onclick();assert.equal(h.app.state().exploded,false);assert.equal(h.getMode(),'guided');
});
test('step changes default to guided close-ups, including voice navigation and replay',async()=>{
 const h=await harness(),$=s=>h.document.querySelector(s);h.app.loadGuide({guide:fixture()});h.app.setStep(0);
 assert.equal(h.getMode(),'guided');$('#play').onclick();assert.equal(h.getMode(),'guided');$('#play').onclick();
 $('#step-view').onclick();assert.equal(h.getMode(),'guided');
 let result=await h.voice.dispatch('navigate_relative_step',{direction:'previous'});
 assert.equal(result.state.step,0);assert.equal(h.getMode(),'whole');
 result=await h.voice.dispatch('navigate_relative_step',{direction:'next'});
 assert.equal(result.state.step,1);assert.equal(h.getMode(),'guided');
 result=await h.voice.dispatch('control_playback',{action:'replay'});
 assert.equal(result.state.playing,true);assert.equal(result.state.view,'guided');
 // Looking up a referenced step leaves selection and playback untouched.
 const before=h.app.state();await h.voice.dispatch('get_assembly_state',{});await h.voice.dispatch('list_assembly_steps',{});
 assert.equal(h.app.state().index,before.index);assert.equal(h.app.state().playing,before.playing);assert.equal(h.getMode(),'guided');
 $('#exploded').onclick();await h.voice.dispatch('control_playback',{action:'play'});
 assert.equal(h.app.state().exploded,false);assert.equal(h.getMode(),'guided');
 $('#whole-view').onclick();await h.voice.dispatch('control_playback',{action:'replay'});assert.equal(h.getMode(),'whole','An explicitly chosen whole-build view remains available during playback.');
});
test('new PDF clears previous guide instructions and source references',async()=>{
 const h=await harness();h.app.loadGuide({guide:fixture()});h.app.setStep(0);assert.equal(h.document.querySelector('#source-page').textContent,'Manual · p. 1');
 await h.app.pickPdf({name:'new.pdf',size:12,arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7\nnew').buffer});
 assert.equal(h.app.state().output,null);assert.equal(h.document.querySelector('#source-page').textContent,'');assert.equal(h.document.querySelector('#step-count').textContent,'—');assert.equal(h.document.querySelector('#instruction-title').textContent,'Your assembly, one step at a time.');assert.equal(h.document.querySelector('#play').disabled,true);
});

test('unified upload routes PDFs and photos, rejects mixed selections, and waits for explicit conversion',async()=>{
 const h=await harness(),$=s=>h.document.querySelector(s);
 const pdf=new File(['%PDF-1.7\nmanual'],'manual.pdf',{type:'application/pdf'}),photo=new File(['jpeg'],'page.jpg',{type:'image/jpeg'});
 assert.equal(h.document.body.dataset.state,'empty');assert.equal(h.photoOptions.showLauncher,false);
 await h.app.pickManual([pdf,photo]);assert.match($('#conversion-status').textContent,/Keep PDFs and photos separate/);assert.equal(h.document.body.dataset.state,'empty');assert.equal(h.photoCalls.length,0);
 await h.app.pickManual([photo]);assert.equal(h.photoCalls.length,1);assert.equal(h.photoCalls[0].files[0],photo);assert.equal(h.photoCalls[0].settings.replace,true);
 await h.photoOptions.onPdfReady(pdf,{productName:'MINI TABLE'});assert.equal($('#product-name').textContent,'MINI TABLE');assert.equal(h.document.body.dataset.state,'ready');assert.equal($('#convert').disabled,false);assert(h.fetchCalls.every(call=>call.url==='/api/health'));
 await h.app.pickManual([new File(['bad'],'manual.heic')]);assert.equal(h.document.body.dataset.state,'ready');assert.match($('#conversion-status').textContent,/HEIC/);
 $('#change-manual').onclick();assert.equal(h.document.body.dataset.state,'empty');assert.equal($('#resume-manual').hidden,false);$('#resume-manual').onclick();assert.equal(h.document.body.dataset.state,'ready');
});

test('conversion transitions from preview to guide, preserves progress during source choice, and recovers after failure',async()=>{
 const h=await harness(),$=s=>h.document.querySelector(s);await h.app.pickManual([new File(['%PDF-1.7\nmanual'],'manual.pdf',{type:'application/pdf'})]);
 let release;h.context.fetch=async()=>{await new Promise(resolve=>{release=resolve;});return Response.json({error:'Try again.'},{status:503});};
 const failed=$('#convert').onclick();assert.equal(h.document.body.dataset.state,'converting');assert.equal($('#cancel').hidden,false);release();await failed;
 assert.equal(h.document.body.dataset.state,'ready');assert.equal($('#convert').disabled,false);assert.equal($('#cancel').hidden,true);
 h.context.fetch=async()=>new Response(`event: result\ndata: ${JSON.stringify({guide:fixture(),provenance:{sha256:h.app.state().pdfHash}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
 await $('#convert').onclick();assert.equal(h.document.body.dataset.state,'guide');assert.equal($('#export').disabled,false);
 h.app.setStep(0);$('#progress').oninput({target:{value:'650'}});$('#change-manual').onclick();assert.equal(h.document.body.dataset.state,'empty');$('#resume-manual').onclick();assert.equal(h.document.body.dataset.state,'guide');assert.equal(h.app.state().progress,.65);assert.equal(h.app.state().index,0);
});

function cabinetGuide(){
 const guide=fixture();guide.productName='Storage cabinet';guide.summary='Fit the hinges and door to the cabinet.';
 guide.parts[0].name='Cabinet door';guide.parts[1].name='Door hinge';guide.parts[2].name='Driver';
 guide.steps[0].title='Fit the hinge';guide.steps[0].instruction='Attach the hinge to the cabinet door.';
 guide.steps[1].title='Install the door';guide.steps[1].instruction='Position the door on the cabinet.';
 return guide;
}

for(const hostedRendering of [false,true])test(`${hostedRendering?'Sites':'local'} conversion automatically connects the new guide to the shared viewer and voice controls`,async()=>{
 const h=await harness({hostedRendering,entry:hostedRendering?'index.html':'engine.html'}),$=s=>h.document.querySelector(s);
 await h.app.pickManual([new File(['%PDF-1.7\ncabinet'],'private-cabinet.pdf',{type:'application/pdf'})]);
 assert.equal(h.voice.canStart(),false);assert.equal($('#copilot-toggle').hidden,true);
 const result={guide:cabinetGuide(),provenance:{sha256:h.app.state().pdfHash,filename:'private-cabinet.pdf'}};
 let requests=0;
 const convert=async()=>{requests++;assert.equal(h.voice.canStart(),false,'Voice waits for conversion to finish.');return result;};
 h.context.__hostedModule={convertInBrowser:convert};
 h.context.fetch=async()=>new Response(`event: result\ndata: ${JSON.stringify(await convert())}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
 await $('#convert').onclick();
 assert.equal(requests,1);assert.equal(h.document.body.dataset.state,'guide');assert.equal(h.getLoads(),1);
 assert.equal(JSON.stringify(h.loadedGuides[0]),JSON.stringify(result.guide),'Every conversion loads the shared generated viewer.');
 assert.equal($('#guide-scan').hidden,true,'Voice is independent of the product-specific scanner.');
 assert.equal($('#copilot-toggle').hidden,false);assert.equal(h.voice.canStart(),true);
 const catalog=await h.voice.dispatch('list_assembly_steps',{});
 assert.equal(catalog.product,'Storage cabinet');assert.equal(catalog.steps.length,3);assert.equal(catalog.steps[2].title,'Install the door');
 h.voiceSession.current={id:'test-session'};
 let reply=await h.voice.dispatch('navigate_assembly_step',{step:2});
 assert.equal(reply.ok,true);assert.equal(reply.state.body,result.guide.steps[1].instruction);assert.equal(reply.state.linked,true);assert.equal(h.app.state().index,1);
 assert.equal((await h.voice.dispatch('control_playback',{action:'replay'})).state.playing,true);
 assert.equal((await h.voice.dispatch('control_playback',{action:'pause'})).state.playing,false);
 for(const mode of ['whole','exploded','guided'])assert.equal((await h.voice.dispatch('set_assembly_view',{mode})).state.view,mode);
 assert.equal(h.voiceSession.current.id,'test-session','Guide controls retain the active voice connection.');
 assert.doesNotMatch(JSON.stringify(h.voice.getState()),/KNARREVIK|STRANDMON|private-cabinet/);
});

test('reopened arbitrary guides retain voice navigation through all 32 steps without a linked PDF',async()=>{
 const h=await harness({entry:'index.html'}),$=s=>h.document.querySelector(s),guide=cabinetGuide();
 guide.steps=Array.from({length:32},(_,i)=>({...structuredClone(guide.steps[i%2]),title:`Cabinet step ${i+1}`}));
 assertGuide(guide);
 h.app.loadGuide({guide:fixture()});h.voiceSession.current={id:'previous-guide-session'};
 await $('#guide-file').onchange({target:{files:[new File([JSON.stringify({guide})],'cabinet.unfold.json')],value:'cabinet.unfold.json'}});
 assert.equal(h.voiceSession.current,null,'Opening a different guide clears the previous voice session.');
 assert.equal(h.loadedGuides.at(-1).productName,'Storage cabinet');assert.equal($('#copilot-toggle').hidden,false);assert.equal(h.voice.canStart(),true);
 const catalog=await h.voice.dispatch('list_assembly_steps',{});assert.equal(catalog.steps.length,33);assert.equal(catalog.steps[32].title,'Cabinet step 32');
 const reply=await h.voice.dispatch('navigate_assembly_step',{step:32});assert.equal(reply.ok,true);assert.equal(reply.state.title,'Cabinet step 32');assert.equal(reply.state.linked,false);
 assert.equal((await h.voice.dispatch('show_manual_page',{page:1})).ok,false);
 assert.equal((await h.voice.dispatch('control_playback',{action:'play'})).state.playing,true);
 assert.equal((await h.voice.dispatch('set_assembly_view',{mode:'whole'})).state.view,'whole');
 assert.equal((await h.voice.dispatch('navigate_assembly_step',{step:33})).ok,false);
});


test('KNARREVIK demo opens its saved guide and matching PDF without conversion',async()=>{
 const h=await harness(),bytes=new TextEncoder().encode('%PDF-1.7\nknarrevik');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const guide=fixture();guide.productName='KNARREVIK';const result={guide,provenance:{sha256,filename:'knarrevik-manual.pdf'},visualReview:{status:'needs_review',issues:[]}};
 const requested=[];h.context.fetch=async(url,options)=>{requested.push(url);assert.equal(options.method,undefined);if(url==='/examples/knarrevik.unfold.json')return Response.json(result);if(url==='/reference/knarrevik-manual.pdf')return new Response(bytes);throw new Error('Unexpected network request: '+url);};
 const buttons=[...h.document.querySelectorAll('[data-knarrevik-demo]')];assert.equal(buttons.length,2);assert(buttons.every(button=>!button.disabled&&button.textContent==='KNARREVIK demo'));
 assert.equal(buttons[0].closest('.source-screen, .build-shell'),null,'The header entry remains reachable across all workspace states.');
 const loading=buttons[0].onclick();assert(buttons.every(button=>button.disabled&&button.getAttribute('aria-busy')==='true'));await loading;
 assert.equal(h.document.body.dataset.state,'guide');assert.equal(h.app.state().output.guide.productName,'KNARREVIK');assert.equal(h.app.state().pdfHash,sha256);assert.equal(h.app.state().index,-1);assert.equal(h.document.querySelector('#manual-link-state').textContent,'Linked');
 assert.deepEqual(requested,['/examples/knarrevik.unfold.json','/reference/knarrevik-manual.pdf']);assert(buttons.every(button=>!button.disabled&&button.textContent==='KNARREVIK demo'));
 h.app.setStep(0);assert.equal(h.document.querySelector('#source-page').textContent,'Manual · p. 1');assert.equal(h.document.querySelector('#manual-link-state').textContent,'Linked');
});

test('a missing or mismatched demo preserves the current guide and manual',async()=>{
 for(const failure of ['missing','mismatch']){
  const h=await harness();await h.app.pickPdf(new File(['%PDF-1.7\nprevious'],'previous.pdf',{type:'application/pdf'}));
  const previous={guide:fixture(),provenance:{sha256:h.app.state().pdfHash}};h.app.loadGuide(previous);h.app.setStep(0);h.document.querySelector('#progress').oninput({target:{value:'650'}});const previousHash=h.app.state().pdfHash;
  h.context.fetch=async url=>{if(failure==='missing')return new Response('Missing',{status:404});return url.endsWith('.json')?Response.json({guide:fixture(),provenance:{sha256:'wrong-hash'}}):new Response('%PDF-1.7\ndemo');};
  await h.document.querySelector('[data-knarrevik-demo]').onclick();
  assert.equal(h.app.state().output,previous);assert.equal(h.app.state().progress,.65);assert.equal(h.app.state().pdfHash,previousHash);assert.equal(h.document.body.dataset.state,'guide');assert.match(h.document.querySelector('#conversion-status').textContent,failure==='missing'?/could not be opened/:/do not match/);assert([...h.document.querySelectorAll('[data-knarrevik-demo]')].every(button=>!button.disabled));
 }
});

test('KNARREVIK scanning follows guide creation and keeps the current assembly and scan intact',async()=>{
 const h=await harness({pageCount:12}),$=s=>h.document.querySelector(s);
 const bytes=await readFile(new URL('../dist/reference/knarrevik-manual.pdf',import.meta.url));
 const result=JSON.parse(await readFile(new URL('../dist/examples/knarrevik.unfold.json',import.meta.url),'utf8'));
 assert.equal($('#guide-scan').hidden,true);
 assert.equal($('#parts-scan-content iframe'),null,'The scanner must not load before a guide exists.');
 assert.equal(h.document.querySelector('.header-actions a[href="/scan.html"]'),null);
 await h.app.pickPdf(new File([bytes],'knarrevik.pdf',{type:'application/pdf'}));
 assert.equal(h.app.state().pdfHash,KNARREVIK.manualSha256,'The checklist fingerprint must match the bundled manual.');
 assert.equal($('#guide-scan').hidden,true,'A PDF preview alone must not offer scanning.');
 let release;
 h.context.fetch=async()=>{await new Promise(resolve=>{release=resolve;});return new Response(`event: result\ndata: ${JSON.stringify(result)}\n\n`,{headers:{'Content-Type':'text/event-stream'}});};
 const converting=$('#convert').onclick();
 assert.equal($('#guide-scan').hidden,true);
 release();await converting;
 assert.equal($('#guide-scan').hidden,false);
 assert.equal($('#parts-scan-content iframe'),null,'Opening a guide must not automatically start the scanner.');
 h.app.setStep(2);$('#progress').oninput({target:{value:'650'}});$('#play').onclick();
 const before=h.app.state();
 $('#open-parts-scan').onclick();
 const frame=$('#parts-scan-content iframe');
 assert.equal(frame.getAttribute('src'),'/scan.html?embedded=1');
 assert.equal($('#parts-scan-dialog').open,true);
 assert.equal(h.app.state().playing,false);
 $('#close-parts-scan').onclick();
 assert.equal($('#parts-scan-dialog').open,false);
 assert.equal(h.app.state().output,before.output);
 assert.equal(h.app.state().pdfHash,before.pdfHash);
 assert.equal(h.app.state().index,2);assert.equal(h.app.state().progress,.65);
 $('#open-parts-scan').onclick();assert.equal($('#parts-scan-content iframe'),frame,'Reopening must preserve the photo and reviewed counts.');
 $('#close-parts-scan').onclick();
 $('#change-manual').onclick();assert.equal($('#guide-scan').hidden,true);
 $('#resume-manual').onclick();assert.equal($('#guide-scan').hidden,false);
 assert.equal($('#parts-scan-content iframe'),frame);
 await h.app.pickPdf(new File(['%PDF-1.7\nanother manual'],'another.pdf',{type:'application/pdf'}));
 assert.equal($('#guide-scan').hidden,true);assert.equal($('#parts-scan-content iframe'),null);
 h.app.loadGuide({guide:{...fixture(),productName:'KNARREVIK'},provenance:{sha256:'another-revision'}});
 assert.equal($('#guide-scan').hidden,true,'A matching product name alone cannot select the fixed checklist.');
});

test('the saved KNARREVIK demo offers scanning after both guide and manual load',async()=>{
 const h=await harness({pageCount:12}),$=s=>h.document.querySelector(s);
 const bytes=await readFile(new URL('../dist/reference/knarrevik-manual.pdf',import.meta.url));
 const result=JSON.parse(await readFile(new URL('../dist/examples/knarrevik.unfold.json',import.meta.url),'utf8'));
 h.context.fetch=async url=>url.endsWith('.json')?Response.json(result):new Response(bytes);
 const loading=$('[data-knarrevik-demo]').onclick();assert.equal($('#guide-scan').hidden,true);
 await loading;
 assert.equal($('#guide-scan').hidden,false);assert.equal($('#open-parts-scan').disabled,false);
 assert.equal(h.app.state().output.guide.productName,'KNARREVIK');
 assert.equal($('#manual-link-state').textContent,'Linked');
});


test('engine voice is wired to demo navigation, playback, manual pages and human revision changes',async()=>{
 const h=await harness({pageCount:12});const result=JSON.parse(await readFile(new URL('../dist/examples/knarrevik.unfold.json',import.meta.url),'utf8'));
 assert.equal(h.voice.canStart(),false);assert.equal(h.document.querySelector('#copilot-toggle').hidden,true);assert.equal(h.document.querySelector('#screw-lab').hidden,true);
 await h.app.pickPdf(new File(['%PDF-1.7\nknarrevik'],'private-name.pdf',{type:'application/pdf'}));
 result.provenance.sha256=h.app.state().pdfHash;h.app.loadGuide(result);
 assert.equal(h.voice.canStart(),true);assert.equal(h.document.querySelector('#copilot-toggle').hidden,false);assert.equal(h.document.querySelector('#screw-lab').hidden,false);
 h.document.querySelector('#copilot-panel').hidden=false;h.document.querySelector('#copilot-toggle').setAttribute('aria-expanded','true');
 h.document.querySelector('#change-manual').onclick();
 assert.equal(h.document.querySelector('#copilot-toggle').hidden,true);assert.equal(h.document.querySelector('#screw-lab').hidden,true);assert.equal(h.document.querySelector('#copilot-panel').hidden,true);assert.equal(h.document.querySelector('#copilot-toggle').getAttribute('aria-expanded'),'false');
 h.document.querySelector('#resume-manual').onclick();
 assert.equal(h.document.querySelector('#copilot-toggle').hidden,false);assert.equal(h.document.querySelector('#screw-lab').hidden,false);
 assert.equal((await h.voice.dispatch('navigate_assembly_step',{step:6})).state.manualPage,12);assert.equal(h.app.state().index,5);
 assert.equal((await h.voice.dispatch('control_playback',{action:'play'})).state.playing,true);
 assert.equal((await h.voice.dispatch('control_playback',{action:'pause'})).state.playing,false);
 assert.equal((await h.voice.dispatch('set_assembly_view',{mode:'exploded'})).state.view,'exploded');
 assert.equal((await h.voice.dispatch('set_assembly_view',{mode:'guided'})).state.view,'guided');assert.equal(h.app.state().exploded,false);
 assert.equal((await h.voice.dispatch('show_manual_page',{page:7})).state.linked,false);assert.equal(h.app.state().index,5);
 const revision=h.voice.getRevision();h.document.querySelector('#prev').click();assert(h.voice.getRevision()>revision);
 assert.equal((await h.voice.dispatch('navigate_assembly_step',{step:1},{revision})).ok,false);
 const beforeLoad=h.voice.getRevision();h.app.loadGuide(result);assert(h.voice.getRevision()>beforeLoad);
 assert.doesNotMatch(JSON.stringify(h.voice.getState()),/private-name|sha256|sourceUrl/);
 await h.app.pickPdf(new File(['%PDF-1.7\nother'],'different.pdf',{type:'application/pdf'}));
 assert.equal(h.voice.canStart(),false);assert.equal(h.voice.getState().product,null);assert.equal(h.document.querySelector('#copilot-toggle').hidden,true);assert.equal(h.document.querySelector('#screw-lab').hidden,true);
});
