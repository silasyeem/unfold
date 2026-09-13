import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {fixture} from './fixture.mjs';
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

async function harness(){
 const html=await readFile(new URL('../dist/engine.html',import.meta.url),'utf8');const {document}=parseHTML(html);const create=document.createElement.bind(document);
 document.createElement=name=>{const element=create(name);if(name==='canvas'){element.getContext=()=>({drawImage(){}});element.toDataURL=()=>'';}return element;};
 for(const element of document.querySelectorAll('canvas'))element.getContext=()=>({drawImage(){}});
 for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');}
 let viewMode='whole',loaded=0;
 const fakeViewer={load(){loaded++;viewMode='whole';},setState(){viewMode='guided';},guide(){viewMode='guided';},wholeBuild(){viewMode='whole';},setExploded(){viewMode='whole';},selectPart(){},dispose(){}};
 const fakePdf={numPages:1,destroy:async()=>{},getPage:async()=>({getViewport:()=>({width:100,height:100}),render:()=>({promise:Promise.resolve(),cancel(){}})})};
 const context={document,mountPhotoIntake:()=>({setDisabled(){},destroy(){}}),mountManualLibrary:()=>({setDisabled(){},destroy(){}}),createGeneratedViewer:()=>fakeViewer,assertGuide,console,performance,crypto,Blob,URL,TextDecoder,TextEncoder,AbortController,structuredClone,setTimeout,clearTimeout,requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(){},fetch:async()=>Response.json({conversionAvailable:true}),__pdfModule:{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(fakePdf)})}};

 let source=await readFile(new URL('../dist/engine-app.js',import.meta.url),'utf8');source=source.replace(/^import .*$/gm,'').replace("await import('./vendor/pdf.mjs')",'__pdfModule');
 vm.runInNewContext(source+'\nglobalThis.harness={loadGuide,setStep,pickPdf,showPage,state:()=>({output,index,page,playing,progress,exploded})};',context);
 return{document,context,app:context.harness,getMode:()=>viewMode,getLoads:()=>loaded};
}
test('play and pause preserve guided camera mode',async()=>{
 const h=await harness();h.app.loadGuide({guide:fixture()});h.app.setStep(0);h.document.querySelector('#play').onclick();assert.equal(h.getMode(),'guided');h.document.querySelector('#play').onclick();assert.equal(h.getMode(),'guided');assert.equal(h.app.state().playing,false);h.document.querySelector('#exploded').onclick();assert.equal(h.app.state().exploded,true);h.document.querySelector('#step-view').onclick();assert.equal(h.app.state().exploded,false);assert.equal(h.getMode(),'guided');
});
test('new PDF clears previous guide instructions and source references',async()=>{
 const h=await harness();h.app.loadGuide({guide:fixture()});h.app.setStep(0);assert.equal(h.document.querySelector('#source-page').textContent,'Manual · p. 1');
 await h.app.pickPdf({name:'new.pdf',size:12,arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7\nnew').buffer});
 assert.equal(h.app.state().output,null);assert.equal(h.document.querySelector('#source-page').textContent,'');assert.equal(h.document.querySelector('#step-count').textContent,'—');assert.equal(h.document.querySelector('#instruction-title').textContent,'Your assembly, one step at a time.');assert.equal(h.document.querySelector('#play').disabled,true);
});
