import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../dist/vendor/three.module.js';
import {fixture} from './fixture.mjs';
import {compileGuide,evaluateGuide,orientations,smooth} from '../dist/guide-state.js';

async function withViewer(run){
 let frame,scene,camera,controls;const events={};
 const previous=Object.fromEntries(['devicePixelRatio','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{devicePixelRatio:1,ResizeObserver:class{constructor(callback){this.callback=callback;}observe(){this.callback();}disconnect(){}},requestAnimationFrame:callback=>(frame=callback,1),cancelAnimationFrame(){}});
 class Renderer{constructor(){this.shadowMap={};this.domElement={remove(){}};}setPixelRatio(){}setSize(){}render(value,view){scene=value;camera=view;scene.updateMatrixWorld(true);}dispose(){}}
 class Controls{constructor(){controls=this;this.target=new T.Vector3();}update(){}addEventListener(name,callback){events[name]=callback;}dispose(){}}
 let viewer;
 try{
  let source=await readFile(new URL('../dist/generated-viewer.js',import.meta.url),'utf8');source=source.replace(/^import .*$/gm,'').replace('export function','function');
  const create=new Function('T','OrbitControls','compileGuide','evaluateGuide','orientations','smooth',source+';return createGeneratedViewer;')({...T,WebGLRenderer:Renderer},Controls,compileGuide,evaluateGuide,orientations,smooth);
  viewer=create({prepend(){},clientWidth:1024,clientHeight:768});
  await run({viewer,draw:()=>frame(),at:progress=>{viewer.setState(0,progress);frame();},free:()=>events.start(),get scene(){return scene;},get camera(){return camera;},get target(){return controls.target;}});
 }finally{viewer?.dispose();Object.assign(globalThis,previous);}
}

function jointGuide(){
 const guide=fixture(),[panel,screw,key]=guide.parts;
 panel.initiallyVisible=true;panel.position=[0,1,0];panel.rotation=[0,.4,0];panel.primitives[0].size=[1.2,.1,.8];
 screw.kind='hardware';screw.initiallyVisible=false;screw.position=[-.5,.2,.3];screw.primitives[0].size=[.03,.03,.03];
 key.parentId=panel.id;key.primitives=[{shape:'box',size:[.01,.06,.01],position:[0,.03,0],rotation:[0,0,0]},{shape:'box',size:[.14,.01,.01],position:[.065,.055,0],rotation:[0,0,0]}];
 const action=(kind,start,end,fromPosition,toPosition,partId='tool')=>({partId,kind,start,end,fromPosition,toPosition,fromRotation:[0,0,0],toRotation:[0,0,0],axis:[0,1,0],turns:kind==='tighten'?1:0});
 const first=[-.5,.2,.3],second=[.5,.2,.3];
 guide.steps=[{...guide.steps[0],orientation:'on_right',focus:[1.5,1.5,-1.5],cameraDistance:3,cameraDirection:[1,.7,1],actions:[
  action('insert',.2,.35,[-.9,.2,.3],first),action('tighten',.35,.5,first,first),action('remove',.5,.6,first,[-.9,.2,.3]),
  action('insert',.2,.3,[-.8,.2,.3],first,'bracket'),
  action('insert',.7,.8,[.9,.2,.3],second),action('tighten',.8,.9,second,second),action('remove',.9,.98,second,[.9,.2,.3])
 ]}];
 return guide;
}
const near=(actual,expected,message)=>assert(actual.distanceTo(expected)<1e-8,message);

test('guided close-ups follow the parent-transformed socket during approach, tightening and withdrawal',async()=>withViewer(h=>{
 const guide=jointGuide();h.viewer.load(guide);
 for(const [time,position] of [[.275,[-.5,.2,.3]],[.4,[-.5,.2,.3]],[.55,[-.5,.2,.3]],[.85,[.5,.2,.3]]]){
  h.at(time);const parent=h.scene.getObjectByName('panel'),expected=new T.Vector3(...position).applyMatrix4(parent.matrixWorld);
  near(h.target,expected,'Focus must include the evaluated parent rotation/translation and whole-build grounding.');
  assert(h.camera.position.distanceTo(h.target)<.7,'A small tool must get a close-up even when the step-wide distance is 3.');
  if(time===.275||time===.55)assert(h.scene.getObjectByName('tool').getWorldPosition(new T.Vector3()).distanceTo(h.target)>.01,'The moving tool does not drag the camera away from the socket.');
 }
}));

test('inter-joint transitions and scrubbing are deterministic rather than dependent on frame history',async()=>withViewer(h=>{
 const guide=jointGuide();h.viewer.load(guide);h.at(.6);const first=h.target.clone();h.at(.85);const second=h.target.clone(),position=h.camera.position.clone();
 h.at(.7);near(h.target,first,'The next approach begins at the previous joint.');
 h.at(.72);assert(h.target.distanceTo(first)>0&&h.target.distanceTo(second)>0,'The camera travels between joints during the start of the approach.');
 h.at(.74);near(h.target,second,'The camera arrives at the destination during the approach.');
 for(const time of [.95,.12,.55,.85])h.at(time);
 near(h.target,second);near(h.camera.position,position,'Seeking directly to the same time must reproduce the same capture camera.');
 h.viewer.load(guide);h.at(.85);near(h.target,second);near(h.camera.position,position,'A fresh load produces the identical guided camera.');
}));

test('guided connector zoom scales with tool and build size',async()=>withViewer(h=>{
 const guide=jointGuide();h.viewer.load(guide);h.at(.4);const distance=h.camera.position.distanceTo(h.target);
 const scaled=structuredClone(guide),twice=values=>values.map(value=>value*2);
 for(const part of scaled.parts){part.position=twice(part.position);part.explodedOffset=twice(part.explodedOffset);for(const primitive of part.primitives){primitive.position=twice(primitive.position);primitive.size=twice(primitive.size);}}
 for(const step of scaled.steps){step.focus=twice(step.focus);step.cameraDistance*=2;for(const action of step.actions){action.fromPosition=twice(action.fromPosition);action.toPosition=twice(action.toPosition);}}
 h.viewer.load(scaled);h.at(.4);assert(Math.abs(h.camera.position.distanceTo(h.target)/distance-2)<1e-8,'Zoom must use actual tool reach/build scale, not a product-specific fixed distance.');
}));

test('whole-build, exploded and free views retain their controls, while guided reset returns to the joint',async()=>withViewer(h=>{
 h.viewer.load(jointGuide());h.at(.4);const joint=h.target.clone(),closeDistance=h.camera.position.distanceTo(joint);
 h.viewer.wholeBuild();h.draw();const whole=h.target.clone(),wholeDistance=h.camera.position.distanceTo(whole);assert(wholeDistance>closeDistance*2);
 h.viewer.setExploded(true);h.draw();assert.equal(h.viewer.getView().mode,'whole');assert.equal(h.viewer.getView().exploded,true);assert(Math.abs(h.camera.position.distanceTo(h.target)/wholeDistance-1.45)<1e-8);
 h.free();h.target.set(9,8,7);h.camera.position.set(10,10,10);h.at(.85);assert.equal(h.viewer.getView().mode,'free');near(h.target,new T.Vector3(9,8,7));near(h.camera.position,new T.Vector3(10,10,10));
 h.viewer.guide();h.draw();assert.equal(h.viewer.getView().mode,'guided');const expected=new T.Vector3(.5,.2,.3).applyMatrix4(h.scene.getObjectByName('panel').matrixWorld);near(h.target,expected);
}));

test('large-part placement retains source step focus and orientation-only stages retain the whole view',async()=>withViewer(h=>{
 const guide=jointGuide(),step=guide.steps[0];step.focus=[.2,1,.1];step.actions=[{...step.actions[0],partId:'panel',fromPosition:[0,1,0],toPosition:[0,1,0],start:0,end:1}];
 h.viewer.load(guide);h.at(.5);const rig=h.scene.getObjectByName('panel').parent;
 near(h.target,new T.Vector3(...step.focus).applyMatrix4(rig.matrixWorld));assert(Math.abs(h.camera.position.distanceTo(h.target)-step.cameraDistance)<1e-8);
 step.actions=[];h.viewer.load(guide);h.at(.5);const target=h.target.clone(),position=h.camera.position.clone();h.viewer.wholeBuild();h.draw();near(h.target,target);near(h.camera.position,position);
}));
