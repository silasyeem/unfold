import * as T from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {compileGuide,evaluateGuide,orientations,smooth} from './guide-state.js';
export function createGeneratedViewer(container,onView=()=>{}){
 const scene=new T.Scene();scene.background=new T.Color('#f6f7f9');
 const renderer=new T.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.outputColorSpace=T.SRGBColorSpace;container.prepend(renderer.domElement);
 const camera=new T.PerspectiveCamera(38,1,.01,100);camera.position.set(3,2,3);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.15;controls.maxDistance=20;controls.target.set(0,.6,0);
 scene.add(new T.HemisphereLight(0xffffff,0xb4bdce,2.5));const sun=new T.DirectionalLight(0xffffff,3.1);sun.position.set(4,7,5);scene.add(sun);
 const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:0xf0f2f6,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.005;scene.add(floor);
 const grid=new T.GridHelper(10,40,0xe4e8f0,0xe9edf3);grid.position.y=.001;scene.add(grid);
 const rig=new T.Group();scene.add(rig);const meshes=new Map();let compiled=null,index=-1,progress=0,mode='whole',exploded=false,selected=null,frame=0,dirty=true,disposed=false;
 const fitBox=new T.Box3(),bounds=new T.Box3(),center=new T.Vector3(),size=new T.Vector3(),q=new T.Quaternion(),p=new T.Vector3(),axis=new T.Vector3();
 let radius=1,baseCenter=new T.Vector3(0,.5,0);
 controls.addEventListener('start',()=>{mode='free';dirty=true;onView('Free view · drag to inspect');});
 function disposeParts(){for(const child of [...rig.children]){child.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of [].concat(o.material))m.dispose();});rig.remove(child);}meshes.clear();}
 function load(guide){
  const next=compileGuide(guide);disposeParts();compiled=next;
  for(const part of guide.parts){
   const group=new T.Group();group.name=part.id;
   for(const primitive of part.primitives){
    const geometry=primitive.shape==='box'?new T.BoxGeometry(1,1,1):primitive.shape==='cylinder'?new T.CylinderGeometry(.5,.5,1,20):primitive.shape==='sphere'?new T.SphereGeometry(.5,20,12):new T.TorusGeometry(.35,.15,8,24);
    const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color:part.color,roughness:part.kind==='hardware'?.35:.8,metalness:part.kind==='hardware'?.5:0}));
    mesh.scale.fromArray(primitive.size);mesh.position.fromArray(primitive.position);mesh.rotation.set(...primitive.rotation);mesh.userData.partId=part.id;group.add(mesh);
   }
   group.position.fromArray(part.position);group.rotation.set(...part.rotation);group.visible=part.kind!=='tool';rig.add(group);meshes.set(part.id,group);
  }
  for(const part of guide.parts)if(part.parentId)meshes.get(part.parentId).add(meshes.get(part.id));
  rig.quaternion.identity();rig.position.set(0,0,0);rig.updateMatrixWorld(true);fitBox.makeEmpty();for(const part of guide.parts)if(part.kind!=='tool')fitBox.expandByObject(meshes.get(part.id));fitBox.getCenter(baseCenter);fitBox.getSize(size);radius=Math.max(.2,size.length()/2);index=-1;progress=0;mode='whole';exploded=false;selected=null;dirty=true;drawState();
 }
 function pose(){
  const next=orientations[index<0?'upright':compiled.guide.steps[index].orientation];
  const before=orientations[index<=0?'upright':compiled.guide.steps[index-1].orientation];
  const a=new T.Quaternion().setFromEuler(new T.Euler(...before));const b=new T.Quaternion().setFromEuler(new T.Euler(...next));
  rig.quaternion.slerpQuaternions(a,b,index<0?1:smooth(progress/.18));
 }
 function drawState(){
  if(!compiled)return;
  const state=index<0?null:evaluateGuide(compiled,index,progress);pose();rig.position.set(0,0,0);
  for(const part of compiled.guide.parts){
   const mesh=meshes.get(part.id),s=state?.[part.id];mesh.visible=state?s.visible:part.kind!=='tool';mesh.position.fromArray(s?s.position:part.position);mesh.rotation.set(...(s?s.rotation:part.rotation));
   if(s?.spin){axis.fromArray(s.spinAxis).normalize();q.setFromAxisAngle(axis,s.spin);mesh.quaternion.multiply(q);}
   if(exploded&&mesh.visible)mesh.position.add(p.fromArray(part.explodedOffset));
   mesh.traverse(o=>{if(!o.isMesh||o.userData.partId!==part.id)return;const highlighted=s?.active||part.id===selected;o.material.emissive.set(highlighted?0x285bff:0);o.material.emissiveIntensity=highlighted?.35:0;const faded=mode==='guided'&&index>=0&&!highlighted&&part.kind==='part'&&compiled.guide.steps[index].cameraDistance<1;o.material.transparent=faded;o.material.opacity=faded?.32:1;o.material.depthWrite=!faded;});
  }
  rig.updateMatrixWorld(true);bounds.makeEmpty();
  const visibleInTree=object=>{for(let n=object;n&&n!==rig;n=n.parent)if(!n.visible)return false;return true;};
  const collect=stationary=>{for(const part of compiled.guide.parts){const mesh=meshes.get(part.id);if(part.kind==='tool'||!visibleInTree(mesh))continue;if(stationary&&state&&(!compiled.starts[index][part.id].visible||state[part.id].active))continue;for(const primitive of mesh.children){if(!primitive.isMesh)continue;primitive.geometry.computeBoundingBox();bounds.union(primitive.geometry.boundingBox.clone().applyMatrix4(primitive.matrixWorld));}}};
  collect(true);if(bounds.isEmpty())collect(false);
  if(!bounds.isEmpty())rig.position.y=-bounds.min.y;
  rig.updateMatrixWorld(true);dirty=false;
  if(mode!=='free')positionCamera();
 }
 function positionCamera(){
  if(!compiled)return;
  const target=baseCenter.clone().applyMatrix4(rig.matrixWorld);let direction=new T.Vector3(1.2,.7,1.5).normalize();let distance=radius*3.5;
  if(mode==='guided'&&index>=0&&compiled.guide.steps[index].actions.length){
   const step=compiled.guide.steps[index];const focus=new T.Vector3(...step.focus).applyMatrix4(rig.matrixWorld);const close=smooth(progress/.23);
   target.lerp(focus,close);direction.fromArray(step.cameraDirection).normalize().applyQuaternion(rig.quaternion);
   // Generated camera directions can point through the support surface after a flip.
   direction.y=Math.max(.25,Math.abs(direction.y));direction.normalize();
   distance=T.MathUtils.lerp(radius*3.5,step.cameraDistance,close);
  }
  if(exploded)distance*=1.45;
  distance*=Math.max(1,.95/camera.aspect);controls.target.copy(target);camera.position.copy(target).addScaledVector(direction,distance);camera.position.y=Math.max(.1,camera.position.y);camera.near=Math.max(.005,distance/300);camera.far=Math.max(100,distance*10);camera.updateProjectionMatrix();controls.update();
 }
 const observer=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();dirty=true;});observer.observe(container);
 function draw(){if(disposed)return;frame=requestAnimationFrame(draw);if(dirty)drawState();controls.update();renderer.render(scene,camera);}draw();
 return{
  load,setState(i,t){if(index!==i){mode=i<0?'whole':'guided';exploded=false;}index=i;progress=t;dirty=true;},
  guide(){mode=index<0?'whole':'guided';exploded=false;dirty=true;onView(index<0?'Whole build':compiled.guide.steps[index].actions.length?'Step view · joint highlighted':'Whole build · orientation');},
  wholeBuild(){mode='whole';exploded=false;dirty=true;onView('Whole build');},
  setExploded(v){exploded=v;mode='whole';dirty=true;onView(v?'Exploded parts':'Whole build');},
  selectPart(id){selected=id;dirty=true;},
  getView(){return{mode,index,progress,exploded};},
  dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();disposeParts();floor.geometry.dispose();floor.material.dispose();grid.geometry.dispose();[].concat(grid.material).forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();}
 };
}
