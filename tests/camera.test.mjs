import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../dist/vendor/three.module.js';
import {fixture} from './fixture.mjs';
import {compileGuide,evaluateGuide,orientations,smooth} from '../dist/guide-state.js';

async function withViewer(run,{animateTransitions=false,reducedMotion=false,width=1024,height=768}={}){
 let frame,scene,camera,controls,now=0;const events={};
 const previous=Object.fromEntries(['devicePixelRatio','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','matchMedia'].map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{devicePixelRatio:1,matchMedia:()=>({matches:reducedMotion}),ResizeObserver:class{constructor(callback){this.callback=callback;}observe(){this.callback();}disconnect(){}},requestAnimationFrame:callback=>(frame=callback,1),cancelAnimationFrame(){}});
 class Renderer{constructor(){this.shadowMap={};this.domElement={remove(){}};}setPixelRatio(){}setSize(){}render(value,view){scene=value;camera=view;scene.updateMatrixWorld(true);}dispose(){}}
 class Controls{constructor(){controls=this;this.target=new T.Vector3();}update(){}addEventListener(name,callback){events[name]=callback;}dispose(){}}
 let viewer;
 try{
  let source=await readFile(new URL('../dist/generated-viewer.js',import.meta.url),'utf8');source=source.replace(/^import .*$/gm,'').replace('export function','function');
  const create=new Function('T','OrbitControls','compileGuide','evaluateGuide','orientations','smooth','performance',source+';return createGeneratedViewer;')({...T,WebGLRenderer:Renderer},Controls,compileGuide,evaluateGuide,orientations,smooth,{now:()=>now});
  viewer=create({prepend(){},clientWidth:width,clientHeight:height},()=>{},{animateTransitions});
  await run({viewer,draw:()=>frame(now),advance:ms=>{now+=ms;frame(now);},at:progress=>{const entering=viewer.getView().index!==0;viewer.setState(0,progress);if(entering)viewer.guide();frame(now);},free:()=>events.start(),get scene(){return scene;},get camera(){return camera;},get target(){return controls.target;}});
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

const knarrevik=async()=>JSON.parse(await readFile(new URL('../dist/examples/knarrevik.unfold.json',import.meta.url),'utf8')).guide;
const poseOf=step=>new T.Quaternion().setFromEuler(new T.Euler(...orientations[step.orientation]));
const nearPose=(actual,expected,message)=>assert(actual.angleTo(expected)<1e-7,message);

test('KNARREVIK turns in place with a fixed camera; step 4 stays on the same side and step 5 flips',async()=>withViewer(async h=>{
 const guide=await knarrevik();h.viewer.load(guide);h.draw();
 const rig=h.scene.getObjectByName('leg1').parent,box=new T.Box3();
 for(const part of guide.parts)if(part.kind!=='tool')box.expandByObject(h.scene.getObjectByName(part.id));
 const centre=rig.worldToLocal(box.getCenter(new T.Vector3()));
 h.viewer.setState(0,1);h.advance(1000);
 for(const index of [1,2,3,4,5]){
  const from={pose:rig.quaternion.clone(),camera:h.camera.position.clone(),target:h.target.clone()};
  h.viewer.setState(index,0);h.draw();
  nearPose(rig.quaternion,from.pose,'Navigation starts at the displayed orientation.');
  near(h.camera.position,from.camera,'Navigation must not jump the camera.');near(h.target,from.target);
  const frames=[];
  for(let n=1;n<=4;n++){
   h.advance(250);frames.push({pose:rig.quaternion.clone(),camera:h.camera.position.clone(),target:h.target.clone()});
   const pivot=rig.localToWorld(centre.clone());assert(Math.abs(pivot.x)<1e-8&&Math.abs(pivot.z)<1e-8,'The furniture turns about its centre rather than swinging around its origin.');
  }
  const end=frames.at(-1);nearPose(end.pose,poseOf(guide.steps[index]),'A paused step completes its orientation change.');
  if(index===3)nearPose(end.pose,from.pose,'Step 4 fastens the same exposed side.');
  if(index===4)assert(Math.abs(end.pose.angleTo(from.pose)-Math.PI)<1e-8,'Step 5 rolls the object to the opposite side.');
  frames.forEach((frame,n)=>{
   const blend=smooth((n+1)/4);
   nearPose(frame.pose,from.pose.clone().slerp(end.pose,blend),'The build takes the shortest eased rotation.');
   near(frame.camera,from.camera,'The camera stays in one place as the object turns.');
   near(frame.target,from.target,'The camera keeps looking at the same point.');
  });
 }
},{animateTransitions:true}));

test('KNARREVIK replay and scrubbing keep the working orientation and viewing direction steady',async()=>withViewer(async h=>{
 const guide=await knarrevik();h.viewer.load(guide);
 for(const index of [1,2,4,5]){
  h.viewer.setState(index,1);h.advance(1000);const rig=h.scene.getObjectByName('leg1').parent,camera=h.camera.position.clone(),target=h.target.clone();
  for(const progress of [0,.04,.09,.18,.4,.8,0]){
   h.viewer.setState(index,progress);h.draw();
   nearPose(rig.quaternion,poseOf(guide.steps[index]),'Replay must not repeat a previous step’s turn.');
   near(h.camera.position,camera,'Playback and scrubbing keep the camera stationary.');near(h.target,target);
  }
 }
},{animateTransitions:true}));

for(const [width,height] of [[772,300],[340,300]])test(`the fixed view fits KNARREVIK through its turns at ${width}×${height}`,async()=>withViewer(async h=>{
 const guide=await knarrevik();h.viewer.load(guide);
 for(let index=0;index<guide.steps.length;index++){
  h.viewer.setState(index,1);
  for(let frame=0;frame<4;frame++){
   h.advance(250);h.camera.lookAt(h.target);h.camera.updateMatrixWorld(true);
   for(const part of guide.parts){
    if(part.kind==='tool')continue;
    const group=h.scene.getObjectByName(part.id);if(!group.visible)continue;
    group.traverse(mesh=>{if(!mesh.isMesh)return;const vertices=mesh.geometry.attributes.position;
     for(let vertex=0;vertex<vertices.count;vertex++){
      const screen=new T.Vector3().fromBufferAttribute(vertices,vertex).applyMatrix4(mesh.matrixWorld).project(h.camera);
      assert(Math.abs(screen.x)<.98&&Math.abs(screen.y)<.98,`Step ${index+1}: ${part.id} is cropped during its turn.`);
     }
    });
   }
  }
 }
},{animateTransitions:true,width,height}));

test('interrupted navigation resumes from the displayed pose, and free orbit retains camera control',async()=>withViewer(async h=>{
 const guide=await knarrevik();h.viewer.load(guide);h.viewer.setState(0,1);h.advance(1000);
 h.viewer.setState(1,0);h.advance(350);const rig=h.scene.getObjectByName('leg1').parent,pose=rig.quaternion.clone(),camera=h.camera.position.clone(),target=h.target.clone();
 h.viewer.setState(2,0);h.draw();nearPose(rig.quaternion,pose);near(h.camera.position,camera);near(h.target,target);
 h.free();h.camera.position.set(9,8,7);h.target.set(4,5,6);h.advance(1000);
 nearPose(rig.quaternion,poseOf(guide.steps[2]));near(h.camera.position,new T.Vector3(9,8,7));near(h.target,new T.Vector3(4,5,6));assert.equal(h.viewer.getView().mode,'free');
 h.viewer.setState(4,0);h.advance(1000);near(h.camera.position,new T.Vector3(9,8,7));near(h.target,new T.Vector3(4,5,6));nearPose(rig.quaternion,poseOf(guide.steps[4]));
},{animateTransitions:true}));

test('reduced motion immediately shows the destination working pose',async()=>withViewer(async h=>{
 const guide=await knarrevik();h.viewer.load(guide);h.viewer.setState(2,0);h.draw();
 nearPose(h.scene.getObjectByName('leg1').parent.quaternion,poseOf(guide.steps[2]));
},{animateTransitions:true,reducedMotion:true}));

test('arbitrary Engine guides smoothly handle every working-pose pair regardless of step duration',async()=>withViewer(h=>{
 const guide=fixture(),step=guide.steps[1];guide.productName='Storage cabinet';
 guide.steps=Object.keys(orientations).map((orientation,i)=>({...structuredClone(step),orientation,duration:i%2?3:30,actions:i%2?step.actions:[]}));
 h.viewer.load(guide);h.draw();const rig=h.scene.getObjectByName('panel').parent,camera=h.camera.position.clone(),target=h.target.clone();
 for(let from=0;from<guide.steps.length;from++)for(let to=0;to<guide.steps.length;to++){
  h.viewer.setState(from,1);h.advance(1000);const startPose=rig.quaternion.clone(),startCamera=h.camera.position.clone();
  h.viewer.setState(to,0);h.draw();
  if(from!==to){nearPose(rig.quaternion,startPose);near(h.camera.position,startCamera);}
  h.advance(500);nearPose(rig.quaternion,startPose.clone().slerp(poseOf(guide.steps[to]),.5),'Every orientation pair takes the shortest turn at the same speed.');
  h.advance(500);nearPose(rig.quaternion,poseOf(guide.steps[to]));
  for(const progress of [.08,.16,1,0]){h.viewer.setState(to,progress);h.draw();nearPose(rig.quaternion,poseOf(guide.steps[to]),'Scrubbing a generated guide does not replay its orientation change.');near(h.camera.position,camera);near(h.target,target);}
 }
},{animateTransitions:true}));
