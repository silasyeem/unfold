import * as T from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {compileGuide,evaluateGuide,orientations,smooth} from './guide-state.js';
export function createGeneratedViewer(container,onView=()=>{},{pixelRatio=Math.min(devicePixelRatio,2),animateTransitions=true}={}){
 const scene=new T.Scene();scene.background=new T.Color('#f6f7f9');
 const renderer=new T.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(pixelRatio);renderer.shadowMap.enabled=true;renderer.outputColorSpace=T.SRGBColorSpace;container.prepend(renderer.domElement);
 const camera=new T.PerspectiveCamera(38,1,.01,100);camera.position.set(3,2,3);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.15;controls.maxDistance=20;controls.target.set(0,.6,0);
 scene.add(new T.HemisphereLight(0xffffff,0xb4bdce,2.5));const sun=new T.DirectionalLight(0xffffff,3.1);sun.position.set(4,7,5);scene.add(sun);
 const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:0xf0f2f6,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.005;scene.add(floor);
 const grid=new T.GridHelper(10,40,0xe4e8f0,0xe9edf3);grid.position.y=.001;scene.add(grid);
 const rig=new T.Group();scene.add(rig);const meshes=new Map(),partReach=new Map();let compiled=null,index=-1,progress=0,mode='whole',exploded=false,selected=null,frame=0,dirty=true,disposed=false;
 const fitBox=new T.Box3(),bounds=new T.Box3(),center=new T.Vector3(),size=new T.Vector3(),q=new T.Quaternion(),p=new T.Vector3(),axis=new T.Vector3();
 let radius=1,baseCenter=new T.Vector3(0,.5,0),transition=null,autoCompleted=false;
 const reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const fixedDirection=new T.Vector3(1.2,.7,1.5).normalize();
 function workingPose(step){
  if(!step?.cameraUp)return new T.Quaternion().setFromEuler(new T.Euler(...orientations[step?.orientation||'upright']));
  // Preserve the manual's signed viewing axes with a proper 3D rotation. The
  // camera remains fixed; no negative scale or screen reflection is involved.
  const reference=new T.Matrix4().lookAt(new T.Vector3(...step.cameraDirection),new T.Vector3(),new T.Vector3(...step.cameraUp));
  const fixed=new T.Matrix4().lookAt(fixedDirection,new T.Vector3(),new T.Vector3(0,1,0));
  return new T.Quaternion().setFromRotationMatrix(fixed.multiply(reference.transpose()));
 }
 function beginTransition(){transition=compiled&&animateTransitions&&!reducedMotion?{pose:rig.quaternion.clone(),camera:camera.position.clone(),target:controls.target.clone(),start:performance.now()}:null;}
 controls.addEventListener('start',()=>{mode='free';autoCompleted=false;dirty=true;onView('Free view · drag to inspect');});
 function disposeParts(){for(const child of [...rig.children]){child.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of [].concat(o.material))m.dispose();});rig.remove(child);}meshes.clear();partReach.clear();}
 function load(guide){
  const next=compileGuide(guide);disposeParts();compiled=next;transition=null;autoCompleted=false;
  for(const part of guide.parts){
   const group=new T.Group();group.name=part.id;
   for(const primitive of part.primitives){
    const geometry=primitive.shape==='box'?new T.BoxGeometry(1,1,1):primitive.shape==='cylinder'?new T.CylinderGeometry(.5,.5,1,20):primitive.shape==='sphere'?new T.SphereGeometry(.5,20,12):new T.TorusGeometry(.35,.15,8,24);
    const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color:part.color,roughness:part.kind==='hardware'?.35:.8,metalness:part.kind==='hardware'?.5:0}));
    mesh.scale.fromArray(primitive.size);mesh.position.fromArray(primitive.position);mesh.rotation.set(...primitive.rotation);mesh.userData.partId=part.id;group.add(mesh);
   }
   group.position.fromArray(part.position);group.rotation.set(...part.rotation);group.visible=part.kind!=='tool';rig.add(group);meshes.set(part.id,group);
   partReach.set(part.id,Math.max(...part.primitives.map(primitive=>Math.hypot(...primitive.position)+Math.hypot(...primitive.size)/2)));
  }
  for(const part of guide.parts)if(part.parentId)meshes.get(part.parentId).add(meshes.get(part.id));
  rig.quaternion.identity();rig.position.set(0,0,0);rig.updateMatrixWorld(true);fitBox.makeEmpty();for(const part of guide.parts)if(part.kind!=='tool')fitBox.expandByObject(meshes.get(part.id));fitBox.getCenter(baseCenter);fitBox.getSize(size);radius=Math.max(.2,size.length()/2);index=-1;progress=0;mode='whole';exploded=false;selected=null;dirty=true;drawState();
 }
 function groundRig(state){
  // Turn around the build's centre, keeping it in place above the work surface.
  rig.position.copy(baseCenter).applyQuaternion(rig.quaternion).multiplyScalar(-1);rig.position.y=0;
  rig.updateMatrixWorld(true);bounds.makeEmpty();
  const visibleInTree=object=>{for(let n=object;n&&n!==rig;n=n.parent)if(!n.visible)return false;return true;};
  const collect=stationary=>{for(const part of compiled.guide.parts){const mesh=meshes.get(part.id);if(part.kind==='tool'||!visibleInTree(mesh))continue;if(stationary&&state&&(!compiled.starts[index][part.id].visible||state[part.id].active))continue;for(const primitive of mesh.children){if(!primitive.isMesh)continue;primitive.geometry.computeBoundingBox();bounds.union(primitive.geometry.boundingBox.clone().applyMatrix4(primitive.matrixWorld));}}};
  collect(true);if(bounds.isEmpty())collect(false);
  if(!bounds.isEmpty())rig.position.y=-bounds.min.y;
  rig.updateMatrixWorld(true);
 }
 function drawState(now=performance.now()){
  if(!compiled)return;
  const state=index<0?null:evaluateGuide(compiled,index,progress),guidance=guidedOperation();
  const pose=workingPose(index<0?null:compiled.guide.steps[index]);
  rig.quaternion.copy(pose);
  for(const part of compiled.guide.parts){
   const mesh=meshes.get(part.id),s=state?.[part.id];mesh.visible=state?s.visible:part.kind!=='tool';mesh.position.fromArray(s?s.position:part.position);mesh.rotation.set(...(s?s.rotation:part.rotation));
   if(s?.spin){axis.fromArray(s.spinAxis).normalize();q.setFromAxisAngle(axis,s.spin);mesh.quaternion.multiply(q);}
   if(exploded&&mesh.visible)mesh.position.add(p.fromArray(part.explodedOffset));
   mesh.traverse(o=>{if(!o.isMesh||o.userData.partId!==part.id)return;const highlighted=s?.active||part.id===selected;o.material.emissive.set(highlighted?0x285bff:0);o.material.emissiveIntensity=highlighted?.35:0;const faded=Boolean(mode==='guided'&&index>=0&&!highlighted&&part.kind==='part'&&(compiled.guide.steps[index].cameraDistance<1||guidance?.current?.small||guidance?.previous?.small&&guidance.blend<1));if(o.material.transparent!==faded){o.material.transparent=faded;o.material.needsUpdate=true;}o.material.opacity=faded?.32:1;o.material.depthWrite=!faded;});
  }
  groundRig(state);dirty=false;
  if(mode!=='free')positionCamera(guidance);
  if(transition){
   const blend=smooth((now-transition.start)/1000);
   // Turn the furniture independently of the camera. Automatic close-ups pan
   // and zoom without changing the manual's viewing direction.
   rig.quaternion.slerpQuaternions(transition.pose,pose,blend);groundRig(state);
   if(mode!=='free'){camera.position.lerpVectors(transition.camera,camera.position,blend);controls.target.lerpVectors(transition.target,controls.target,blend);}
   if(blend>=1)transition=null;
  }
  keepTighteningInFrame();
 }
 function guidedOperation(){
  if(mode!=='guided'||index<0)return null;
  const actions=compiled.guide.steps[index].actions.map(action=>{const kind=compiled.guide.parts.find(part=>part.id===action.partId).kind;return{action,small:kind!=='part',rank:kind==='tool'?2:kind==='hardware'?1:0};});
  const at=time=>actions.filter(item=>item.action.start<=time&&time<item.action.end).sort((a,b)=>b.rank-a.rank||b.action.start-a.action.start)[0]||actions.filter(item=>item.action.end<=time).sort((a,b)=>b.action.end-a.action.end||b.action.start-a.action.start)[0]||null;
  const current=at(progress)||[...actions].sort((a,b)=>a.action.start-b.action.start)[0],previous=current?at(current.action.start-1e-6):null;
  // Derive the entire camera transition from timeline position so seeking,
  // playback and server screenshots always produce the same view.
  const blend=current&&previous&&current.action.kind!=='tighten'?smooth((progress-current.action.start)/Math.min(.05,(current.action.end-current.action.start)*.4)):1;
  return{current,previous,blend};
 }
 function positionCamera(guidance){
  if(!compiled)return;
  // Reserve room for the grounded build in every working orientation. A tighter
  // upright-only fit can crop the lower edge when the furniture lies on its side.
  const target=new T.Vector3(0,radius,0);let direction=fixedDirection.clone();let distance=radius*5;
  if(mode==='guided'&&index>=0&&compiled.guide.steps[index].actions.length){
   const step=compiled.guide.steps[index];
   const viewFor=operation=>{
    if(!operation?.small)return{focus:new T.Vector3(...step.focus).applyMatrix4(rig.matrixWorld),distance:step.cameraDistance};
    const action=operation.action,mesh=meshes.get(action.partId);
    // Action coordinates belong to the evaluated parent. Approach aims at the
    // destination socket; withdrawal holds that socket instead of chasing a tool.
    const focus=new T.Vector3(...(action.kind==='remove'?action.fromPosition:action.toPosition)).applyMatrix4(mesh.parent.matrixWorld);
    const distance=Math.max(.15,partReach.get(action.partId)*3.5,Math.min(step.cameraDistance,radius*.4));
    return{focus,distance};
   };
   const before=viewFor(guidance?.previous),after=viewFor(guidance?.current),blend=guidance?.blend??1;
   const focus=before.focus.lerp(after.focus,blend),jointDistance=T.MathUtils.lerp(before.distance,after.distance,blend);
   target.copy(focus);direction.fromArray(step.cameraDirection).normalize().applyQuaternion(rig.quaternion);
   // Generated camera directions can point through the support surface after a flip.
   direction.y=Math.max(.25,Math.abs(direction.y));direction.normalize();
   distance=jointDistance;
  }
  if(exploded)distance*=1.45;
  distance*=Math.max(1,.95/camera.aspect);controls.target.copy(target);camera.position.copy(target).addScaledVector(direction,distance);camera.position.y=Math.max(.1,camera.position.y);camera.near=Math.max(.005,distance/300);camera.far=Math.max(100,distance*10);camera.updateProjectionMatrix();
 }
 function keepTighteningInFrame(){
  if(mode!=='guided'||index<0)return;
  const active=compiled.guide.steps[index].actions.filter(a=>a.kind==='tighten'&&a.start<=progress&&progress<a.end);
  const screws=active.filter(a=>compiled.guide.parts.find(part=>part.id===a.partId).kind==='hardware');
  const points=(screws.length?screws:active).map(a=>meshes.get(a.partId).getWorldPosition(new T.Vector3()));
  if(!points.length)return;
  camera.lookAt(controls.target);camera.updateMatrixWorld(true);
  const outside=points.some(point=>{const screen=point.clone().project(camera);return Math.abs(screen.x)>.65||Math.abs(screen.y)>.65||Math.abs(screen.z)>1;});
  if(!outside)return;
  // A rapid jump, initial zoom or simultaneous operation must never leave the
  // screw being tightened off-screen. Keep the same viewing direction.
  const focus=new T.Box3().setFromPoints(points).getCenter(new T.Vector3()),offset=camera.position.clone().sub(controls.target);
  const spread=Math.max(...points.map(point=>point.distanceTo(focus)));
  offset.setLength(Math.max(offset.length(),spread/(Math.tan(camera.fov*Math.PI/360)*.6)*Math.max(1,1/camera.aspect)));
  controls.target.copy(focus);camera.position.copy(focus).add(offset);camera.position.y=Math.max(.1,camera.position.y);
  if(transition){transition.camera.copy(camera.position);transition.target.copy(focus);}
 }
 const observer=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();dirty=true;});observer.observe(container);
 function draw(now=performance.now()){if(disposed)return;frame=requestAnimationFrame(draw);if(dirty||transition)drawState(now);controls.update();renderer.render(scene,camera);}draw();
 return{
  load,setState(i,t){
   const end=compiled&&i>=0?Math.max(0,...compiled.guide.steps[i].actions.map(a=>a.end)):0;
   if(index!==i){beginTransition();mode='whole';exploded=false;autoCompleted=false;}
   else if(end&&mode==='guided'&&progress<end&&t>=end){beginTransition();mode='whole';autoCompleted=true;onView('Whole build · step complete');}
   else if(autoCompleted&&t<end){beginTransition();mode='guided';autoCompleted=false;onView('Step view · joint highlighted');}
   index=i;progress=t;dirty=true;
  },
  guide(){const next=index>=0&&compiled.guide.steps[index].actions.length?'guided':'whole';if(mode!==next&&!transition)beginTransition();mode=next;autoCompleted=false;exploded=false;dirty=true;onView(mode==='guided'?'Step view · joint highlighted':'Whole build · orientation');},
  wholeBuild(){if(mode!=='whole')beginTransition();mode='whole';autoCompleted=false;exploded=false;dirty=true;onView('Whole build');},
  setExploded(v){autoCompleted=false;exploded=v;mode='whole';dirty=true;onView(v?'Exploded parts':'Whole build');},
  selectPart(id){selected=id;dirty=true;},
  capture(){if(dirty||transition)drawState();controls.update();renderer.render(scene,camera);return renderer.domElement.toDataURL('image/jpeg',.9);},
  getView(){return{mode,index,progress,exploded};},
  dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();disposeParts();floor.geometry.dispose();floor.material.dispose();grid.geometry.dispose();[].concat(grid.material).forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();}
 };
}
