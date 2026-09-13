import * as T from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {RoundedBoxGeometry} from './vendor/RoundedBoxGeometry.js';

export function createViewer(container){
 const scene=new T.Scene();scene.background=new T.Color('#f6f7f9');
 const camera=new T.PerspectiveCamera(35,1,.01,50);camera.position.set(1.65,1.25,2.2);
 const renderer=new T.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;container.prepend(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.53,0);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=.18;controls.maxDistance=5;controls.maxPolarAngle=Math.PI*.88;controls.enablePan=true;
 scene.add(new T.HemisphereLight(0xffffff,0xc9cfdf,2.2));const key=new T.DirectionalLight(0xfff4df,4);key.position.set(-2,4,3);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-2;key.shadow.camera.right=2;key.shadow.camera.top=2;key.shadow.camera.bottom=-2;key.shadow.bias=-.0002;key.shadow.normalBias=.02;scene.add(key);const fill=new T.DirectionalLight(0xe1e9ff,1.5);fill.position.set(2,2,-3);scene.add(fill);
 const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.ShadowMaterial({color:0x6e788f,opacity:.14}));floor.rotation.x=-Math.PI/2;floor.position.y=-.035;floor.receiveShadow=true;scene.add(floor);
 const rig=new T.Group();scene.add(rig);const chair=new T.Group();chair.position.y=-.5;rig.position.y=.5;rig.add(chair);const parts={};
 const fabric=new T.MeshStandardMaterial({color:0xcfaa43,roughness:.91});const soft=new T.MeshStandardMaterial({color:0xdab74f,roughness:.92});const seam=new T.MeshStandardMaterial({color:0xac8934,roughness:1});const wood=new T.MeshStandardMaterial({color:0x5a4030,roughness:.7});const metal=new T.MeshStandardMaterial({color:0x8994a5,metalness:.72,roughness:.28});const underside=new T.MeshStandardMaterial({color:0x373a3b,roughness:1});
 function mesh(g,m,parent,pos=[0,0,0]){const n=new T.Mesh(g,m.clone());n.castShadow=true;n.receiveShadow=true;n.position.set(...pos);n.userData.original=n.material.color.clone();parent.add(n);return n;}
 function box(parent,size,pos,mat= fabric,r=.04){return mesh(new RoundedBoxGeometry(...size,5,r),mat,parent,pos);}
 function part(id,pos,offset){const g=new T.Group();g.position.set(...pos);g.userData.home=new T.Vector3(...pos);g.userData.offset=new T.Vector3(...offset);chair.add(g);parts[id]=g;return g;}
 const seat=part('seat',[0,.31,.05],[0,0,.46]);
 // Open underside: the rear joint must remain visible during assembly.
 box(seat,[.62,.15,.095],[0,0,.30],fabric,.035);
 box(seat,[.55,.075,.075],[0,-.026,-.272],wood,.012);
 for(const x of [-.276,.276])box(seat,[.068,.13,.56],[x,-.008,0],fabric,.018);
 box(seat,[.55,.025,.53],[0,.067,.015],underside,.009);
 for(const x of [-.2,-.10,0,.10,.2]){const points=[];for(let i=0;i<=32;i++)points.push(new T.Vector3(x+Math.sin(i*Math.PI/2)*.018,.035,-.23+i*.015));mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points),100,.0025,5,false),metal,seat);}
 const cushion=part('cushion',[0,.419,.065],[0,.17,.53]);box(cushion,[.56,.105,.58],[0,0,0],soft,.044);
 const back=part('back',[0,.675,-.29],[0,.38,-.55]);back.rotation.x=-.12;box(back,[.59,.69,.17],[0,0,0],fabric,.08);box(back,[.53,.58,.065],[0,.015,.08],soft,.035);box(back,[.59,.13,.11],[0,-.405,-.085],fabric,.024);
 for(const x of [-.18,-.06,.06,.18]){const b=mesh(new T.SphereGeometry(.012,14,10),seam,back,[x,-.09,.116]);b.scale.set(1,.7,.35);}
 function piping(parent,points,rad=.0025){const curve=new T.CatmullRomCurve3(points.map(a=>new T.Vector3(...a)));return mesh(new T.TubeGeometry(curve,60,rad,6,false),seam,parent);}
 piping(back,[[-.245,-.26,.105],[-.264,.20,.105],[-.21,.29,.105],[.21,.29,.105],[.264,.20,.105],[.245,-.26,.105]]);
 function side(id,s){const p=part(id,[s*.34,.0,0],[s*.5,.1,.04]);const shape=new T.Shape();shape.moveTo(-.38,.35);shape.lineTo(-.39,.95);shape.quadraticCurveTo(-.30,1.06,-.18,.94);shape.quadraticCurveTo(-.06,.86,-.02,.67);shape.quadraticCurveTo(.02,.59,.14,.61);shape.quadraticCurveTo(.43,.69,.45,.55);shape.quadraticCurveTo(.46,.50,.36,.47);shape.lineTo(.36,.30);shape.quadraticCurveTo(.08,.28,-.38,.35);const geo=new T.ExtrudeGeometry(shape,{steps:1,depth:.075,bevelEnabled:true,bevelSegments:5,bevelSize:.023,bevelThickness:.023,curveSegments:22});geo.rotateY(-Math.PI/2);geo.translate(.0375,0,0);mesh(geo,fabric,p);const arm=box(p,[.115,.09,.36],[0,.6,.24],soft,.043);arm.rotation.x=.15;piping(p,[[s*.055,.34,-.35],[s*.055,.96,-.34],[s*.055,.98,-.23],[s*.055,.83,-.075],[s*.055,.63,.02],[s*.055,.63,.28],[s*.055,.565,.42]],.003);return p;}
 side('left',-1);side('right',1);
 const legSpecs=[['frontL',-.26,.32,false],['frontR',.26,.32,false],['rearL',-.25,-.27,true],['rearR',.25,-.27,true]];
 for(const [id,x,z,rear]of legSpecs){const height=rear?.195:.22;const leg=part(id,[x,.115,z],[0,-.20,0]);const n=mesh(new T.CylinderGeometry(.034,.022,height,24),wood,leg);n.rotation.z=-Math.sign(x)*.04;if(rear)n.rotation.x=-.12;mesh(new T.CylinderGeometry(.011,.011,.055,16),metal,leg,[0,height/2+.01,0]);mesh(new T.TorusGeometry(.028,.0035,8,24),metal,leg,[0,height/2+.006,0]).rotation.x=Math.PI/2;
 const footPoint=new T.Vector3(0,-height/2-.004,0).applyQuaternion(n.quaternion);const pad=part(id+'Pad',footPoint.toArray(),new T.Vector3(0,-.12,0).applyQuaternion(n.quaternion).toArray());leg.add(pad);mesh(new T.CylinderGeometry(.021,.021,.008,6),underside,pad).rotation.copy(n.rotation);}
 // Joint hardware is coaxial with local Z; after laying the back down this points up.
 for(const [i,x]of [-.19,.19].entries()){
 const stud=part('stud'+i,[x,.274,-.25],[0,0,.16]);mesh(new T.CylinderGeometry(.008,.008,.20,16),metal,stud).rotation.x=Math.PI/2;
 for(let j=0;j<21;j++)mesh(new T.TorusGeometry(.0085,.001,4,16),metal,stud,[0,0,-.08+j*.008]);
 const washer=part('washer'+i,[x,.274,-.178],[0,0,.18]);const washerShape=new T.Shape();washerShape.absarc(0,0,.021,0,Math.PI*2);const washerHole=new T.Path();washerHole.absarc(0,0,.009,0,Math.PI*2,true);washerShape.holes.push(washerHole);mesh(new T.ExtrudeGeometry(washerShape,{depth:.004,bevelEnabled:false,steps:1}),metal,washer,[0,0,-.002]);
 const nut=part('nut'+i,[x,.274,-.165],[0,0,.24]);const shape=new T.Shape();for(let j=0;j<=6;j++){const a=j*Math.PI/3;const v=[Math.cos(a)*.019,Math.sin(a)*.019];if(j===0)shape.moveTo(...v);else shape.lineTo(...v);}const hole=new T.Path();hole.absarc(0,0,.008,0,Math.PI*2,true);shape.holes.push(hole);mesh(new T.ExtrudeGeometry(shape,{depth:.018,bevelEnabled:true,bevelThickness:.001,bevelSize:.001,bevelSegments:1,steps:1}),metal,nut,[0,0,-.009]);}
 const socket=part('socket',[-.19,.274,-.169],[0,0,.25]);const ring=new T.Shape();ring.absarc(0,0,.028,0,Math.PI*2);const bore=new T.Path();bore.absarc(0,0,.021,0,Math.PI*2,true);ring.holes.push(bore);mesh(new T.ExtrudeGeometry(ring,{depth:.10,bevelEnabled:false,steps:1}),metal,socket);const handle=mesh(new T.CylinderGeometry(.006,.006,.15,16),metal,socket,[0,0,.07]);handle.rotation.z=Math.PI/2;
 for(const [id,sign]of [['left',-1],['right',1]]){let g=part(id+'Bracket',[-sign*.048,.77,-.30],[-sign*.13,.1,0]);parts[id].add(g);box(g,[.012,.085,.045],[0,0,0],metal,.003);box(g,[.035,.012,.045],[-sign*.012,.036,0],metal,.003);box(g,[.012,.033,.045],[-sign*.025,.022,0],metal,.003);
 for(const [i,z]of [-.19,.23].entries()){g=part(id+'Bolt'+i,[sign*.266,.28,z],[-sign*.19,0,0]);const shaft=mesh(new T.CylinderGeometry(.009,.009,.09,16),metal,g);shaft.rotation.z=Math.PI/2;const head=mesh(new T.CylinderGeometry(.018,.018,.014,6),metal,g,[-sign*.05,0,0]);head.rotation.z=Math.PI/2;mesh(new T.TorusGeometry(.02,.003,8,24),metal,g,[-sign*.039,0,0]).rotation.y=Math.PI/2;}}
 const assemblyAt={back:0,stud0:1,stud1:1,seat:2,washer0:3,washer1:3,nut0:3,nut1:3,socket:3,rearL:4,rearR:4,frontL:5,frontR:5,leftBracket:6,rightBracket:6,left:7,leftBolt0:9,leftBolt1:9,right:11,rightBolt0:13,rightBolt1:13,frontLPad:15,frontRPad:15,rearLPad:15,rearRPad:15,cushion:16};
 const HALF=Math.PI/2;
 // Focus points live in chair coordinates; offsets are in the presentation world.
 const shots=[
 {rotation:[0,0,0],focus:[0,.53,0],offset:[1.65,.72,2.2],label:'Whole chair',note:'Drag to rotate · Scroll to zoom'},
 {rotation:[-HALF,0,0],focus:[0,.33,-.22],offset:[.57,.82,1.05],label:'Backrest face up',note:'The studs point upward from the backrest.'},
 {rotation:[-HALF,0,0],focus:[0,.38,.03],offset:[.80,.95,1.50],label:'Backrest face up',note:'Lower the seat frame onto the two studs.'},
 {rotation:[-HALF,0,0],focus:[-.15,.274,-.125],offset:[.23,.40,.51],label:'Close-up · Seat–back joint',note:'Washer → nut → socket tool. Repeat at both joints.'},
 {rotation:[0,0,HALF],focus:[0,.22,-.24],offset:[1.22,.75,.83],label:'On its side · Rear legs',note:'Use the shorter pair shown in the manual.'},
 {rotation:[0,0,-HALF],focus:[0,.22,.28],offset:[-1.22,.75,.83],label:'Turn to the other side',note:'Fit the longer pair at the front.'},
 {rotation:[0,0,0],focus:[-.4,.74,-.26],offset:[.30,.45,1.23],label:'Close-up · Side hooks',note:'Fit the hook plates to both detached side panels.'},
 {rotation:[0,0,0],focus:[-.24,.65,-.07],offset:[-.82,.48,1.55],label:'Chair upright',note:'Align the first side, leaving its hook slightly raised.'},
 {rotation:[0,0,0],focus:[-.31,.77,-.27],offset:[.44,.24,.65],label:'Close-up · First side hook',note:'Press downward to engage the hook.'},
 {rotation:[0,0,-HALF],focus:[0,.46,.03],offset:[-1.48,.80,1.35],label:'First side on top',note:'Insert the bolts from inside the seat frame.'},
 {rotation:[0,0,-HALF],focus:[-.21,.28,-.19],offset:[-.58,.27,.45],label:'Close-up · First side bolts',note:'Keep the panel seated while tightening.'},
 {rotation:[0,0,0],focus:[.24,.65,-.07],offset:[.82,.48,1.55],label:'Chair upright',note:'Align the second side with its upper hook.'},
 {rotation:[0,0,0],focus:[.31,.77,-.27],offset:[-.44,.24,.65],label:'Close-up · Second side hook',note:'Press downward to engage the hook.'},
 {rotation:[0,0,HALF],focus:[0,.46,.03],offset:[1.48,.80,1.35],label:'Second side on top',note:'Insert the remaining bolts from inside the frame.'},
 {rotation:[0,0,HALF],focus:[.21,.28,-.19],offset:[.58,.27,.45],label:'Close-up · Second side bolts',note:'Tighten both bolts with the included tool.'},
 {rotation:[0,0,HALF],focus:[0,.04,.03],offset:[1.18,.6,.85],label:'Close-up · Leg feet',note:'Press one protective pad onto each foot.'},
 {rotation:[0,0,0],focus:[0,.52,.04],offset:[1.45,.72,1.90],label:'Return the chair upright',note:'Slide the cushion back into place.'}
 ];
 let currentStep=0,progress=0,exploded=false,viewMode='guided',cameraMove=null,poseTween=null;
 const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const poseQuaternion=new T.Quaternion(),corner=new T.Vector3(),transformedFocus=new T.Vector3();
 function floorHeight(q){const lowX=currentStep>0&&currentStep<7?-.31:-.42,highX=currentStep>0&&currentStep<11?.31:.42;let min=Infinity;for(const x of [lowX,highX])for(const y of [-.5,.54])for(const z of [-.42,.48])min=Math.min(min,corner.set(x,y,z).applyQuaternion(q).y);return .01-min;}
 function poseFor(s){return new T.Quaternion().setFromEuler(new T.Euler(...shots[s].rotation));}
 function worldPoint(local,q=poseFor(currentStep)){return new T.Vector3(...local).add(new T.Vector3(0,-.5,0)).applyQuaternion(q).add(new T.Vector3(0,floorHeight(q),0));}
 function inform(label=shots[currentStep].label,note=shots[currentStep].note){container.dispatchEvent(new CustomEvent('viewchange',{detail:{label,note,mode:viewMode}}));}
 function moveCamera(target,offset,ms=1050){cameraMove={from:camera.position.clone(),to:target.clone().add(offset),fromTarget:controls.target.clone(),toTarget:target,start:performance.now(),duration:reducedMotion?0:ms};}
 function guide(){viewMode='guided';const shot=shots[currentStep];let target=worldPoint(shot.focus),offset=new T.Vector3(...shot.offset);offset.multiplyScalar(Math.max(1,.85/camera.aspect));moveCamera(target,offset);inform();}
 function wholeBuild(){viewMode='wide';const target=worldPoint([0,.5,0]);const q=shots[currentStep].rotation;const x=q[2]<0?-1.65:1.65;moveCamera(target,new T.Vector3(x,.95,2.2).multiplyScalar(Math.max(1,1/camera.aspect)));inform('Whole build','Drag to inspect · Step view returns to the joint.');}
 controls.addEventListener('start',()=>{cameraMove=null;viewMode='free';inform('Free view','Drag to inspect · Step view returns to the joint.');});
 function setState(step,p){if(step!==currentStep){currentStep=step;const now=performance.now();poseTween={from:rig.quaternion.clone(),to:poseFor(step),start:now,duration:reducedMotion?0:950};guide();}progress=p;}
 const smooth=t=>{const n=T.MathUtils.clamp(t,0,1);return n*n*(3-2*n);};
 const stage=(start,end)=>smooth((progress-start)/(end-start));
 const activeColor=new T.Color(0x4e79e3);
 function draw(now=performance.now()){
 requestAnimationFrame(draw);
 if(poseTween){const t=poseTween.duration?smooth((now-poseTween.start)/poseTween.duration):1;rig.quaternion.slerpQuaternions(poseTween.from,poseTween.to,t);if(t>=1)poseTween=null;}
 rig.position.y=floorHeight(rig.quaternion);
 for(const [id,g]of Object.entries(parts)){
 const at=assemblyAt[id];let fraction=currentStep===0?1:currentStep<at?0:currentStep===at?stage(.18,.91):1;
 if(currentStep===3){if(id.startsWith('washer'))fraction=stage(.18,.38);if(id.startsWith('nut'))fraction=stage(.4,.67);if(id==='socket')fraction=stage(.69,.8);}
 let visible=currentStep===0||currentStep>=at||at===0;
 if(id==='left')visible=currentStep===0||currentStep>=6;if(id==='right')visible=currentStep===0||currentStep===6||currentStep>=11;
 if(id==='socket')visible=currentStep===3&&progress>.66&&progress<.98;
 g.visible=visible;
 const offset=exploded?1:1-fraction;
 const target=g.userData.home.clone().addScaledVector(g.userData.offset,offset);
 if(id==='left'&&currentStep===7)target.y+=fraction*.055;
 if(id==='left'&&currentStep===8)target.y+=(1-stage(.2,.88))*.055;
 if(id==='right'&&currentStep===11)target.y+=fraction*.055;
 if(id==='right'&&currentStep===12)target.y+=(1-stage(.2,.88))*.055;
 if(id==='socket'&&currentStep===3&&progress>.92)target.z+=stage(.92,.98)*.16;
 g.position.copy(target);
 const active=currentStep>0&&(at===currentStep||currentStep===8&&id==='left'||currentStep===12&&id==='right'||currentStep===10&&id.startsWith('leftBolt')||currentStep===14&&id.startsWith('rightBolt'));
 g.traverse(n=>{if(n.isMesh&&n.parent===g){const hardware=/stud|washer|nut|Bolt|Bracket|Pad|socket/i.test(id);n.material.color.copy(active&&hardware?activeColor:n.userData.original);n.material.emissive?.setHex(active?0x16316c:0);n.material.emissiveIntensity=active?.15:0;}});
 if(id!=='back'){g.rotation.set(0,0,0);if(active){if(/^(front|rear)[LR]$/.test(id))g.rotation.y=(1-fraction)*Math.PI*4;if(id.startsWith('stud'))g.rotation.z=(1-fraction)*Math.PI*4;if(id.startsWith('nut'))g.rotation.z=-stage(.47,.88)*Math.PI*4;if(id==='socket')g.rotation.z=-stage(.8,.92)*Math.PI*3;if(id.includes('Bolt'))g.rotation.x=-stage(.2,.9)*Math.PI*4;}}
 }
 if(cameraMove){const t=cameraMove.duration?smooth((now-cameraMove.start)/cameraMove.duration):1;camera.position.lerpVectors(cameraMove.from,cameraMove.to,t);controls.target.lerpVectors(cameraMove.fromTarget,cameraMove.toTarget,t);if(t>=1)cameraMove=null;}
 controls.update();renderer.render(scene,camera);
 }
 new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();if(viewMode==='guided')guide();}).observe(container);
 draw();
 return{setState,setExploded(value){exploded=value;if(value)wholeBuild();else guide();},reset:guide,guide,wholeBuild,underside(){viewMode='free';const q=poseFor(currentStep);moveCamera(worldPoint([0,.25,0]),new T.Vector3(1,-1,1).applyQuaternion(q));inform('Underside','Drag to inspect · Step view returns to the joint.');},getView(){return{mode:viewMode,step:currentStep,label:shots[currentStep].label};}};
}
