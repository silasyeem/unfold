import * as T from './vendor/three.module.js';
import {OrbitControls} from './vendor/OrbitControls.js';

export function createScrewViewer(container) {
  const renderer=new T.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,2));
  renderer.setClearColor(0xf4f6fa);renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label','3D preview of your screw, oriented head down on the print bed');
  renderer.domElement.setAttribute('role','img');container.append(renderer.domElement);
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(36,1,.1,1000);camera.up.set(0,0,1);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.enablePan=false;controls.maxPolarAngle=Math.PI*.94;
  scene.add(new T.HemisphereLight(0xffffff,0x58627d,2.6));
  for(const [pos,power] of [[[30,-40,70],3.5],[[-30,10,35],2]]){const light=new T.DirectionalLight(0xffffff,power);light.position.set(...pos);scene.add(light);}
  const grid=new T.GridHelper(120,24,0xcbd4e3,0xe1e6ef);grid.rotation.x=Math.PI/2;grid.position.z=-.04;scene.add(grid);
  const material=new T.MeshStandardMaterial({color:0x5374d4,metalness:.15,roughness:.38});
  let mesh=null,spec=null,disposed=false;
  function draw(){if(!disposed)renderer.render(scene,camera);}
  function resize(){const width=Math.max(container.clientWidth,1),height=Math.max(container.clientHeight,1);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();draw();}
  function reset(){if(!spec)return;const size=Math.max(spec.length+spec.headHeight,spec.headWidth*1.3),center=(spec.length+spec.headHeight)/2;controls.target.set(0,0,center);camera.position.set(size*1.15,-size*1.8,center+size*.7);controls.minDistance=size*.55;controls.maxDistance=size*6;camera.near=.1;camera.far=size*20;camera.updateProjectionMatrix();controls.update();draw();}
  controls.addEventListener('change',draw);
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  return {
    load(data){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(data.positions,3));geometry.setIndex(new T.BufferAttribute(data.indices,1));geometry.computeVertexNormals();if(mesh){scene.remove(mesh);mesh.geometry.dispose();}mesh=new T.Mesh(geometry,material);scene.add(mesh);const old=spec;spec=data.spec;if(!old||old.length!==spec.length||old.headHeight!==spec.headHeight||old.headWidth!==spec.headWidth)reset();else draw();},
    reset,
    dispose(){disposed=true;observer.disconnect();controls.dispose();mesh?.geometry.dispose();material.dispose();grid.geometry.dispose();grid.material.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}
