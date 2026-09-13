import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {PRESETS,DEFAULT_SCREW,validateScrew,createScrewMesh,threadRadius,encodeBinarySTL,screwFilename} from '../dist/screw-geometry.js';
import {mountScrewLab} from '../dist/screws.js';

function inspectMesh(mesh){
  const {positions:p,indices:ix}=mesh,edges=new Map(),points=new Set();
  let volume=0;
  for(let i=0;i<p.length;i+=3){const key=`${p[i]},${p[i+1]},${p[i+2]}`;assert(!points.has(key),'No duplicated seam vertices');points.add(key);assert([...p.subarray(i,i+3)].every(Number.isFinite));}
  for(let i=0;i<ix.length;i+=3){
    const [a,b,c]=ix.subarray(i,i+3);assert(a!==b&&b!==c&&a!==c);
    for(const [u,v] of [[a,b],[b,c],[c,a]]){const key=`${Math.min(u,v)},${Math.max(u,v)}`,edge=edges.get(key)||{count:0,balance:0};edge.count++;edge.balance+=u<v?1:-1;edges.set(key,edge);}
    const A=p.subarray(a*3,a*3+3),B=p.subarray(b*3,b*3+3),C=p.subarray(c*3,c*3+3);
    const u=B.map((v,j)=>v-A[j]),v=C.map((v,j)=>v-A[j]);
    assert(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-8,'Every triangle has area');
    volume+=(A[0]*(B[1]*C[2]-B[2]*C[1])+A[1]*(B[2]*C[0]-B[0]*C[2])+A[2]*(B[0]*C[1]-B[1]*C[0]))/6;
  }
  for(const edge of edges.values()){assert.equal(edge.count,2,'Every edge joins exactly two faces');assert.equal(edge.balance,0,'Adjacent faces have consistent winding');}
  assert.equal(p.length/3-edges.size+ix.length/3,2,'One closed genus-zero boundary');
  assert(volume>0,'Outward orientation has positive signed volume');
  return volume;
}

test('all metric presets and head styles have watertight, consistently wound meshes',()=>{
  for(const preset of PRESETS)for(const head of ['hex','socket','thumb']){
    const mesh=createScrewMesh({...DEFAULT_SCREW,...preset,length:6,head});inspectMesh(mesh);
    const z=mesh.positions.filter((_,i)=>i%3===2);assert.equal(Math.min(...z),0);assert.equal(Math.max(...z),6+preset.headHeight);
  }
});
test('socket is a real recess; clearance changes the shaft only; left-hand mesh also closes',()=>{
  const solid=createScrewMesh(DEFAULT_SCREW),socket=createScrewMesh({...DEFAULT_SCREW,head:'socket'});
  // A cylindrical head and the same head with a socket differ by the hex prism volume.
  const thumb=createScrewMesh({...DEFAULT_SCREW,head:'thumb'});assert(inspectMesh(socket)<inspectMesh(thumb));
  const adjusted=createScrewMesh({...DEFAULT_SCREW,clearance:0});
  assert.deepEqual(solid.positions.slice(0,96*3),adjusted.positions.slice(0,96*3),'Head retains its dimensions');
  for(const theta of [0,.8,2])assert(Math.abs(threadRadius({...DEFAULT_SCREW,clearance:0},theta,8)-threadRadius(DEFAULT_SCREW,theta,8)-.1)<1e-9);
  inspectMesh(createScrewMesh({...DEFAULT_SCREW,hand:'left',length:5.3}));
});
test('thread is continuous, has the requested pitch and the requested handedness',()=>{
  const s=DEFAULT_SCREW,p=s.pitch,z=5*p;
  const crest=threadRadius(s,0,z),root=threadRadius(s,Math.PI,z);
  assert(Math.abs(crest-(s.diameter-s.clearance)/2)<1e-9);assert(crest>root+.5);
  assert.equal(threadRadius(s,.8,z),threadRadius(s,.8,z+p));
  assert(Math.abs(threadRadius(s,0,z)-threadRadius(s,Math.PI/2,z+p/4))<1e-9);
  assert(Math.abs(threadRadius({...s,hand:'left'},0,z)-threadRadius({...s,hand:'left'},-Math.PI/2,z+p/4))<1e-9);
  assert(Math.abs(threadRadius(s,0,z+.3)-threadRadius(s,2*Math.PI,z+.3))<1e-9,'Angular seam is continuous');
  assert(Math.abs((crest-root)-5*Math.sqrt(3)/16*p)<1e-9);
});
test('binary STL round trip preserves vertices, facet count, normals, and mm header',()=>{
  const mesh=createScrewMesh({...DEFAULT_SCREW,length:4,head:'socket'}),bytes=encodeBinarySTL(mesh),view=new DataView(bytes);
  assert.equal(view.getUint32(80,true),mesh.indices.length/3);assert.equal(bytes.byteLength,84+mesh.indices.length/3*50);
  assert.match(new TextDecoder().decode(bytes.slice(0,80)),/units: mm/);
  for(let i=0;i<mesh.indices.length/3;i++){
    const base=84+50*i,n=[0,1,2].map(j=>view.getFloat32(base+4*j,true));assert(Math.abs(Math.hypot(...n)-1)<1e-6);
    for(let j=0;j<9;j++)assert.equal(view.getFloat32(base+12+4*j,true),mesh.positions[mesh.indices[3*i+Math.floor(j/3)]*3+j%3]);
  }
  assert.equal(screwFilename(DEFAULT_SCREW),'unfold-M8-P1.25-L20-hex-right-clearance0.2mm.stl');
});
test('unsafe dimensions and unsupported geometry are rejected before allocation',()=>{
  for(const value of [null,NaN,Infinity,'8',0,-1,1000])assert.throws(()=>validateScrew({...DEFAULT_SCREW,diameter:value}));
  for(const patch of [{pitch:3,diameter:3},{headWidth:8},{head:'phillips'},{hand:'unknown'},{head:'socket',socketSize:12},{length:61},{clearance:-.1}])assert.throws(()=>createScrewMesh({...DEFAULT_SCREW,...patch}));
  assert.doesNotThrow(()=>createScrewMesh({...DEFAULT_SCREW,diameter:3,pitch:.5,length:4,clearance:.6,headWidth:5,headHeight:2}));
});

async function harness(options={}){
  const {document}=parseHTML(await readFile(new URL('../dist/screws.html',import.meta.url),'utf8'));
  // Linkedom does not implement a writable select.value; emulate that browser property.
  for(const select of document.querySelectorAll('select'))Object.defineProperty(select,'value',{value:select.querySelector('option[selected]')?.value||select.querySelector('option').value,writable:true});
  const saved=[],lab=mountScrewLab(document,{save:async(blob,name)=>saved.push({blob,name}),...options});
  return {document,lab,saved,$:s=>document.querySelector(s)};
}
test('UI changes presets, dimensions and heads, then downloads the exact current mesh',async()=>{
  const h=await harness();try{
    assert.equal(h.$('#screw-download').disabled,false);
    h.$('#screw-preset').value='6';h.$('#screw-preset').onchange();h.lab.refresh();
    assert.equal(h.lab.getMesh().spec.pitch,1);assert.equal(h.$('[name="diameter"]').value,'6');
    h.$('[name="length"]').value='17.5';h.$('[name="head"]').value='socket';h.lab.refresh();
    await h.$('#screw-form').onsubmit({preventDefault(){}});
    assert.equal(h.saved.length,1);assert.match(h.saved[0].name,/M6-P1-L17.5-socket/);assert.equal(h.saved[0].blob.type,'model/stl');
    const data=new DataView(await h.saved[0].blob.arrayBuffer());assert.equal(data.getUint32(80,true),h.lab.getMesh().indices.length/3);
    h.$('[name="pitch"]').value='';h.lab.refresh();assert.equal(h.lab.getMesh(),null);assert.equal(h.$('#screw-download').disabled,true);assert.equal(h.$('#screw-error').hidden,false);
    await h.$('#screw-form').onsubmit({preventDefault(){}});assert.equal(h.saved.length,1,'Invalid inputs cannot export the stale mesh');
  }finally{h.lab.destroy();}
});
test('missing-part entry never invents measurements; export survives unavailable WebGL',async()=>{
  const h=await harness({search:'?source=knarrevik',makeViewer:async()=>{throw new Error('No WebGL');}});try{
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(h.$('#screw-source').hidden,false);assert.match(h.$('#screw-source').textContent,/not a matched replacement/);
    assert.equal(h.lab.getMesh().spec.diameter,8);assert.equal(h.$('#preview-fallback').hidden,false);assert.equal(h.$('#screw-download').disabled,false);
    await h.$('#screw-form').onsubmit({preventDefault(){}});assert.equal(h.saved.length,1);
  }finally{h.lab.destroy();}
});

test('3D preview consumes the exact export mesh and releases replaced geometry and renderer',async()=>{
  const Base=await import('../dist/vendor/three.module.js');
  const previous={ResizeObserver:globalThis.ResizeObserver};let scene,camera,removed=false,disconnected=false,disposed=0;
  globalThis.ResizeObserver=class{observe(){}disconnect(){disconnected=true;}};
  class Renderer{constructor(){this.domElement={setAttribute(){},remove(){removed=true;}};}setPixelRatio(){}setClearColor(){}setSize(){}render(s,c){scene=s;camera=c;}dispose(){disposed++;}}
  class Controls{constructor(){this.target=new Base.Vector3();}addEventListener(){}update(){}dispose(){}}
  try{
    const source=(await readFile(new URL('../dist/screw-viewer.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace('export function','function');
    const create=new Function('T','OrbitControls',source+';return createScrewViewer;')({...Base,WebGLRenderer:Renderer},Controls);
    const viewer=create({append(){},clientWidth:650,clientHeight:430}),data=createScrewMesh(DEFAULT_SCREW);viewer.load(data);
    let actual=scene.children.find(object=>object.isMesh);assert.equal(actual.geometry.attributes.position.array,data.positions);assert.equal(actual.geometry.index.array,data.indices);
    let oldDisposed=false;actual.geometry.addEventListener('dispose',()=>{oldDisposed=true;});
    viewer.load(createScrewMesh({...DEFAULT_SCREW,length:60}));assert(oldDisposed);assert([...camera.position].every(Number.isFinite));assert(camera.far>camera.position.length());
    viewer.reset();viewer.dispose();assert(removed&&disconnected);assert.equal(disposed,1);
  }finally{Object.assign(globalThis,previous);}
});
