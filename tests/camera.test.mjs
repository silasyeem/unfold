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

test('close-ups refresh panel transparency so the active joint is visible through the furniture',async()=>withViewer(h=>{
 h.viewer.load(jointGuide());h.draw();const material=h.scene.getObjectByName('panel').children[0].material,opaqueVersion=material.version;
 h.at(.4);assert.equal(material.transparent,true);assert.equal(material.depthWrite,false);assert(material.opacity<.5);assert(material.version>opaqueVersion,'Entering a close-up must invalidate the opaque shader.');
 const fadedVersion=material.version;h.viewer.wholeBuild();h.draw();assert.equal(material.transparent,false);assert.equal(material.depthWrite,true);assert.equal(material.opacity,1);assert(material.version>fadedVersion,'Pulling back must restore the opaque shader.');
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

test('Step view zooms in while paused, pulls back after the final action, and zooms in again on replay',async()=>withViewer(h=>{
 h.viewer.load(jointGuide());h.draw();const whole=h.camera.position.clone();
 h.viewer.setState(0,0);h.viewer.guide();h.draw();near(h.camera.position,whole,'The automatic close-up begins smoothly.');
 h.advance(1000);assert.equal(h.viewer.getView().mode,'guided');assert(h.camera.position.distanceTo(h.target)<.7,'Opening the step zooms in without waiting for playback progress.');
 h.viewer.setState(0,.85);h.draw();const close=h.camera.position.clone(),pose=h.scene.getObjectByName('panel').parent.quaternion.clone();
 h.viewer.setState(0,.98);h.draw();near(h.camera.position,close,'The final action starts a smooth pullback.');assert.equal(h.viewer.getView().mode,'whole');
 h.advance(500);assert(h.camera.position.distanceTo(close)>.1&&h.camera.position.distanceTo(whole)>.1);
 h.advance(500);near(h.camera.position,whole);assert(h.scene.getObjectByName('panel').parent.quaternion.angleTo(pose)<1e-7,'Zooming out does not turn the object.');
 h.viewer.setState(0,0);h.advance(1000);assert.equal(h.viewer.getView().mode,'guided');assert(h.camera.position.distanceTo(h.target)<.7);
},{animateTransitions:true}));

for(const [width,height] of [[772,300],[340,300]])test(`step 6 keeps every tightening screw in frame throughout playback at ${width}×${height}`,async()=>withViewer(async h=>{
 const guide=await knarrevik(),step=guide.steps[5];h.viewer.load(guide);h.viewer.setState(5,0);h.viewer.guide();
 const seen=new Set();
 for(let frame=0;frame<=270;frame++){
  const time=frame/(step.duration*60);h.viewer.setState(5,time);h.advance(1000/60);h.camera.lookAt(h.target);h.camera.updateMatrixWorld(true);
  for(const action of step.actions.filter(a=>a.kind==='tighten'&&a.partId!=='key'&&a.start<=time&&time<a.end)){
   seen.add(action.partId);const screen=h.scene.getObjectByName(action.partId).getWorldPosition(new T.Vector3()).project(h.camera);
   assert(Math.abs(screen.x)<=.65+1e-8&&Math.abs(screen.y)<=.65+1e-8&&Math.abs(screen.z)<1,`${action.partId} is out of frame at ${time}.`);
  }
 }
 assert.deepEqual([...seen].sort(),step.actions.filter(a=>a.kind==='tighten'&&a.partId!=='key').map(a=>a.partId).sort());
 assert.equal(h.viewer.getView().mode,'whole','After the last tightening/withdrawal, show the whole table.');
},{animateTransitions:true,width,height}));

const poseOf=step=>{
 if(!step.cameraUp)return new T.Quaternion().setFromEuler(new T.Euler(...orientations[step.orientation]));
 const frame=(back,up)=>{back.normalize();const right=up.cross(back).normalize();return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right,back.clone().cross(right),back));};
 return frame(new T.Vector3(1.2,.7,1.5),new T.Vector3(0,1,0)).multiply(frame(new T.Vector3(...step.cameraDirection),new T.Vector3(...step.cameraUp)).invert());
};
const nearPose=(actual,expected,message)=>assert(actual.angleTo(expected)<1e-7,message);

test('KNARREVIK main drawings preserve foot direction, panel handedness and the newly elevated corner',async()=>withViewer(async h=>{
 const guide=await knarrevik();h.viewer.load(guide);
 // Signed landmark directions read from the MAIN drawings on PDF pages 7–11.
 // From the near joint, the shelf runs up-right and the long foot end down-right.
 const corners=[[.782,1.14,-.582],[-.782,1.14,-.582],[-.782,1.14,.582],[-.782,1.994,.582],[.782,1.994,-.582]];
 const across=[[-1.564,0,0],[0,0,1.164],[1.564,0,0],[1.564,0,0],[-1.564,0,0]];
 for(let index=0;index<5;index++){
  h.viewer.setState(index,1);h.draw();h.camera.lookAt(h.target);h.camera.updateMatrixWorld(true);
  const rig=h.scene.getObjectByName('leg1').parent;
  const project=point=>point.clone().applyMatrix4(rig.matrixWorld).project(h.camera);
  const joint=new T.Vector3(...corners[index]),origin=project(joint),panel=project(joint.clone().add(new T.Vector3(...across[index]))),foot=project(new T.Vector3(joint.x,0,joint.z));
  assert(panel.x>origin.x&&panel.y>origin.y,`Step ${index+1}: panel must extend up-right as drawn.`);
  assert(foot.x>origin.x&&foot.y<origin.y,`Step ${index+1}: foot must extend down-right, not mirror the manual.`);
  assert(Math.abs(rig.matrixWorld.determinant()-1)<1e-8,'Manual matching uses rotation, never reflection.');
  if(index===1){
   const old=h.scene.getObjectByName('leg1'),added=h.scene.getObjectByName('leg4');
   assert(added.getWorldPosition(new T.Vector3()).y>old.getWorldPosition(new T.Vector3()).y+1,'Page 8 adds the upper leg while the first leg rests below.');
   assert(!h.scene.getObjectByName('leg2').visible&&!h.scene.getObjectByName('leg3').visible,'The two remaining corners are introduced on page 9.');
  }
 }
}));

test('an arbitrary guide preserves its reference viewing axes while the camera stays fixed',async()=>withViewer(h=>{
 const guide=fixture();guide.productName='Another cabinet';guide.steps[0].cameraDirection=[.4,-.8,.6];guide.steps[0].cameraUp=[0,0,1];h.viewer.load(guide);h.draw();const camera=h.camera.position.clone(),target=h.target.clone();
 h.viewer.setState(0,1);h.advance(1000);const rig=h.scene.getObjectByName('panel').parent;
 near(new T.Vector3(...guide.steps[0].cameraDirection).applyQuaternion(rig.quaternion).normalize(),camera.clone().sub(target).normalize(),'The manual observer maps to the fixed camera.');
 near(h.camera.position,camera);near(h.target,target);
},{animateTransitions:true}));

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

test('interrupted navigation resumes from the displayed pose; the next step restores its manual view after free orbit',async()=>withViewer(async h=>{
 const guide=await knarrevik();h.viewer.load(guide);h.viewer.setState(0,1);h.advance(1000);
 h.viewer.setState(1,0);h.advance(350);const rig=h.scene.getObjectByName('leg1').parent,pose=rig.quaternion.clone(),camera=h.camera.position.clone(),target=h.target.clone();
 h.viewer.setState(2,0);h.draw();nearPose(rig.quaternion,pose);near(h.camera.position,camera);near(h.target,target);
 h.free();h.camera.position.set(9,8,7);h.target.set(4,5,6);h.advance(1000);
 nearPose(rig.quaternion,poseOf(guide.steps[2]));near(h.camera.position,new T.Vector3(9,8,7));near(h.target,new T.Vector3(4,5,6));assert.equal(h.viewer.getView().mode,'free');
 h.viewer.setState(4,0);h.draw();near(h.camera.position,new T.Vector3(9,8,7));h.advance(1000);assert.equal(h.viewer.getView().mode,'whole');assert(h.camera.position.distanceTo(new T.Vector3(9,8,7))>1);nearPose(rig.quaternion,poseOf(guide.steps[4]));
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
