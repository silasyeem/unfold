import {createGeneratedViewer} from './generated-viewer.js';
import {assertGuide} from './guide-schema.js';

const container=document.querySelector('#scene');
let viewer,guide;
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));

globalThis.unfoldCapture={
 capture(){return viewer.capture();},
 async load(value){
  assertGuide(value);guide=value;
  viewer?.dispose();viewer=createGeneratedViewer(container,()=>{},{pixelRatio:1});viewer.load(guide);
  await nextFrame();await nextFrame();
 },
 async frame(stage){
  if(!guide||!viewer)throw new Error('The guide has not been loaded.');
  if(stage.stepIndex<-1||stage.stepIndex>=guide.steps.length||!Number.isInteger(stage.stepIndex))throw new Error('Invalid stage index.');
  viewer.setState(stage.stepIndex,stage.progress);
  if(stage.phase==='connection')viewer.guide();else viewer.wholeBuild();
  // Wait for the real player's state update, resize and WebGL draw to finish.
  await nextFrame();await nextFrame();await nextFrame();
  return new Promise((resolve,reject)=>requestAnimationFrame(()=>{
   try{
    const canvas=container.querySelector('canvas'),gl=canvas?.getContext('webgl2');
    if(!canvas||canvas.width!==1024||canvas.height!==768||!gl||gl.isContextLost())throw new Error('The 3D stage has no usable WebGL canvas.');
    const current=viewer.getView();
    if(current.index!==stage.stepIndex||current.progress!==stage.progress)throw new Error('The 3D stage did not update.');
    const pixels=new Uint8Array(32*32*4);gl.readPixels(Math.floor(canvas.width/2)-16,Math.floor(canvas.height/2)-16,32,32,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if(gl.getError()!==gl.NO_ERROR||!pixels.some((value,index)=>index%4!==3&&value>0))throw new Error('The 3D stage rendered an empty or invalid frame.');
    resolve({mode:current.mode,index:current.index,progress:current.progress});
   }catch(error){reject(error);}
  }));
 }
};
