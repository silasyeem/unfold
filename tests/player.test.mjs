import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {fixture} from './fixture.mjs';
import {KNARREVIK} from '../dist/knarrevik.js';
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

async function harness({pageCount=1}={}){
 const html=await readFile(new URL('../dist/engine.html',import.meta.url),'utf8');const {document}=parseHTML(html);const create=document.createElement.bind(document);
 document.createElement=name=>{const element=create(name);if(name==='canvas'){element.getContext=()=>({drawImage(){}});element.toDataURL=()=>'';}return element;};
 for(const element of document.querySelectorAll('canvas'))element.getContext=()=>({drawImage(){}});
 for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');Object.defineProperty(dialog,'open',{get:()=>dialog.hasAttribute('open')});}
 let viewMode='whole',loaded=0,photoOptions;const photoCalls=[],fetchCalls=[];
 const fakeViewer={load(){loaded++;viewMode='whole';},setState(){viewMode='guided';},guide(){viewMode='guided';},wholeBuild(){viewMode='whole';},setExploded(){viewMode='whole';},selectPart(){},dispose(){}};
 const fakePdf={numPages:pageCount,destroy:async()=>{},getPage:async()=>({getViewport:()=>({width:100,height:100}),render:()=>({promise:Promise.resolve(),cancel(){}})})};
 const context={document,mountPhotoIntake:(container,options)=>{photoOptions=options;return{open:async(files,settings)=>{photoCalls.push({files,settings});},setDisabled(){},destroy(){}};},mountManualLibrary:()=>({setDisabled(){},destroy(){}}),createGeneratedViewer:()=>fakeViewer,assertGuide,console,performance,crypto,Blob,File,URL,TextDecoder,TextEncoder,AbortController,structuredClone,setTimeout,clearTimeout,requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(){},fetch:async(url,options)=>{fetchCalls.push({url,options});return Response.json({conversionAvailable:true});},__pdfModule:{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(fakePdf)})}};

 const scannerSource=(await readFile(new URL('../dist/guide-scanner.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace('export function','function');
 context.mountGuideScanner=new Function('document','KNARREVIK',scannerSource+';return mountGuideScanner;')(document,KNARREVIK);
 let source=await readFile(new URL('../dist/engine-app.js',import.meta.url),'utf8');source=source.replace(/^import .*$/gm,'').replace("await import('./vendor/pdf.mjs')",'__pdfModule');
 vm.runInNewContext(source+'\nglobalThis.harness={loadGuide,setStep,pickPdf,pickManual,showPage,state:()=>({output,index,page,playing,progress,exploded,pdfHash})};',context);
 return{document,context,app:context.harness,photoCalls,photoOptions,fetchCalls,getMode:()=>viewMode,getLoads:()=>loaded};
}
test('play and pause preserve guided camera mode',async()=>{
 const h=await harness();h.app.loadGuide({guide:fixture()});h.app.setStep(0);h.document.querySelector('#play').onclick();assert.equal(h.getMode(),'guided');h.document.querySelector('#play').onclick();assert.equal(h.getMode(),'guided');assert.equal(h.app.state().playing,false);h.document.querySelector('#exploded').onclick();assert.equal(h.app.state().exploded,true);h.document.querySelector('#step-view').onclick();assert.equal(h.app.state().exploded,false);assert.equal(h.getMode(),'guided');
});
test('new PDF clears previous guide instructions and source references',async()=>{
 const h=await harness();h.app.loadGuide({guide:fixture()});h.app.setStep(0);assert.equal(h.document.querySelector('#source-page').textContent,'Manual · p. 1');
 await h.app.pickPdf({name:'new.pdf',size:12,arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7\nnew').buffer});
 assert.equal(h.app.state().output,null);assert.equal(h.document.querySelector('#source-page').textContent,'');assert.equal(h.document.querySelector('#step-count').textContent,'—');assert.equal(h.document.querySelector('#instruction-title').textContent,'Your assembly, one step at a time.');assert.equal(h.document.querySelector('#play').disabled,true);
});

test('visual review feedback stays visible beyond guide note limits and remains plain text',async()=>{
 const h=await harness(),guide=fixture();
 const overview={stepIndex:-1,severity:'uncertain',description:'The far support is hidden in the source overview.',correction:'Compare its attachment against another source view.'};
 const joint={stepIndex:0,severity:'uncertain',description:'<img src=x onerror="alert(1)"> '+ 'The hidden joint needs inspection. '.repeat(50),correction:'<script>alert(1)</script> Compare the entire connection with the original diagram.'};
 const later={stepIndex:1,severity:'uncertain',description:'Check the second step only.',correction:'Inspect its other face.'};
 const format=issue=>`Visual review: ${issue.description} ${issue.correction}`;
 const ordinary=Array.from({length:8},(_,i)=>`Existing source note ${i+1}`);
 guide.reviewNotes=[format(overview),'General source note'];guide.steps[0].reviewNotes=ordinary;
 const result={guide,visualReview:{status:'needs_review',issues:[overview,joint,joint,later]}};
 assertGuide(guide);assert(format(joint).length>1500);
 h.app.loadGuide(result);
 const displayed=()=>[...h.document.querySelectorAll('#review-notes li')].map(li=>li.textContent);
 assert.deepEqual(displayed(),[format(overview),'General source note'],'Overview feedback is visible globally and deduplicates a legacy copied note.');
 h.app.setStep(0);
 assert.deepEqual(displayed(),[format(overview),format(joint),'General source note',...ordinary],'Full current-step feedback precedes all eight existing notes without truncation or duplicate issues.');
 assert.equal(h.document.querySelector('#review-notes img, #review-notes script'),null,'Feedback must be text, never executable markup.');
 assert.deepEqual(result.guide.steps[0].reviewNotes,ordinary,'Rendering feedback must not mutate the validated guide or exceed its schema limits.');
 h.app.setStep(1);
 assert.deepEqual(displayed(),[format(overview),format(later),'General source note'],'Step-specific feedback follows navigation while overview feedback remains visible.');
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
