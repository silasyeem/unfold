// Millimetres throughout. One connected boundary mesh, including the head and drive.
// A simplified 60° metric-inspired profile, not an ISO tolerance-class model.
export const PRESETS = Object.freeze([
  {diameter:3,pitch:.5,headWidth:5.5,headHeight:3,socketSize:2.5},
  {diameter:4,pitch:.7,headWidth:7,headHeight:4,socketSize:3},
  {diameter:5,pitch:.8,headWidth:8.5,headHeight:5,socketSize:4},
  {diameter:6,pitch:1,headWidth:10,headHeight:6,socketSize:5},
  {diameter:8,pitch:1.25,headWidth:13,headHeight:8,socketSize:6},
  {diameter:10,pitch:1.5,headWidth:16,headHeight:10,socketSize:8},
  {diameter:12,pitch:1.75,headWidth:18,headHeight:12,socketSize:10},
]);
export const DEFAULT_SCREW = Object.freeze({...PRESETS[4],length:20,clearance:.2,head:'hex',hand:'right'});
const TAU = 2*Math.PI;
const clamp = (x,min,max)=>Math.max(min,Math.min(max,x));

export function validateScrew(input) {
  const ranges = {diameter:[3,16],pitch:[.5,3],length:[4,60],clearance:[0,.6],headWidth:[5,32],headHeight:[2,16],socketSize:[1.5,12]};
  const labels = {diameter:'Diameter',pitch:'Pitch',length:'Length',clearance:'Diameter reduction',headWidth:'Head width',headHeight:'Head height',socketSize:'Hex key size'};
  if(!input || typeof input!=='object')throw new Error('Enter screw dimensions.');
  for(const [key,[min,max]] of Object.entries(ranges)) {
    if(!Number.isFinite(input[key])||input[key]<min||input[key]>max)throw new Error(`${labels[key]} must be ${min}–${max} mm.`);
  }
  if(!['hex','socket','thumb'].includes(input.head))throw new Error('Choose a supported head style.');
  if(!['right','left'].includes(input.hand))throw new Error('Choose a thread direction.');
  if(input.pitch>input.diameter*.4)throw new Error('Pitch is too large for this diameter. Use at most 40% of the diameter.');
  if(input.headWidth<input.diameter+1)throw new Error('Head width must be at least 1 mm larger than the nominal diameter.');
  if(input.head==='socket'&&input.socketSize/Math.cos(Math.PI/6)>input.headWidth-2)throw new Error('The hex socket needs at least 1 mm of wall. Increase head width or reduce hex key size.');
  return {...input};
}

// Radial distance to a regular hexagon with the requested across-flats size.
const hexRadius = (width,theta)=>(width/2)/Math.cos(((theta% (Math.PI/3)+Math.PI/3)%(Math.PI/3))-Math.PI/6);

export function threadRadius(spec,theta,z) {
  const major=(spec.diameter-spec.clearance)/2,depth=5*Math.sqrt(3)/16*spec.pitch,root=major-depth;
  const cycle=z/spec.pitch-(spec.hand==='right'?1:-1)*theta/TAU;
  const phase=((cycle%1)+1)%1,dist=Math.min(phase,1-phase);
  // Crest flat = P/8, root flat = P/4, axial flank width = 5P/16.
  const profile=clamp((.375-dist)/.3125,0,1);
  const start=clamp(z/(spec.pitch*.75),0,1),end=clamp((spec.length-z)/(spec.pitch*.75),0,1);
  const tip=1-.15*(1-clamp((spec.length-z)/(spec.pitch*.5),0,1));
  return root*tip+depth*profile*Math.min(start,end);
}

export function createScrewMesh(input) {
  const spec=validateScrew(input),segments=96,vertices=[],faces=[];
  const vertex=(x,y,z)=>{const index=vertices.length/3;vertices.push(x,y,z);return index;};
  const ring=(z,radius)=>Array.from({length:segments},(_,j)=>{const a=j/segments*TAU,r=radius(a);return vertex(r*Math.cos(a),r*Math.sin(a),z);});
  const join=(a,b)=>{for(let j=0;j<segments;j++){const k=(j+1)%segments;faces.push(a[j],a[k],b[j],a[k],b[k],b[j]);}};
  const cap=(r,z,top)=>{const center=vertex(0,0,z);for(let j=0;j<segments;j++){const k=(j+1)%segments;faces.push(...(top?[center,r[j],r[k]]:[center,r[k],r[j]]));}};
  const headRadius=a=>spec.head==='hex'?hexRadius(spec.headWidth,a):spec.headWidth/2*(spec.head==='thumb'?1+.035*Math.cos(12*a):1);
  const bevel=Math.min(.45,spec.headHeight*.15);
  let previous=ring(0,a=>headRadius(a)-bevel);
  if(spec.head==='socket') {
    const opening=ring(0,a=>hexRadius(spec.socketSize,a));
    const floorZ=spec.headHeight*.55,floor=ring(floorZ,a=>hexRadius(spec.socketSize,a));
    join(opening,previous);join(floor,opening);cap(floor,floorZ,false);
  } else cap(previous,0,false);
  for(const [z,offset] of [[bevel,0],[spec.headHeight-bevel,0],[spec.headHeight,bevel]]) {
    const next=ring(z,a=>headRadius(a)-offset);join(previous,next);previous=next;
  }
  // Shared rings join head, shoulder and helical shaft without overlapping solids.
  const rows=Math.ceil(spec.length/spec.pitch*24);
  for(let i=0;i<=rows;i++) {
    const z=spec.length*i/rows,next=ring(spec.headHeight+z,a=>threadRadius(spec,a,z));
    join(previous,next);previous=next;
  }
  cap(previous,spec.headHeight+spec.length,true);
  return {positions:new Float32Array(vertices),indices:new Uint32Array(faces),spec};
}

export function screwFilename(spec) {
  return `unfold-M${spec.diameter}-P${spec.pitch}-L${spec.length}-${spec.head}-${spec.hand}-clearance${spec.clearance}mm.stl`;
}

export function encodeBinarySTL(mesh) {
  const {positions:p,indices:ix}=mesh,count=ix.length/3;
  const bytes=new ArrayBuffer(84+count*50),view=new DataView(bytes);
  new Uint8Array(bytes,0,80).set(new TextEncoder().encode('Unfold | units: mm | prototype screw | no load rating'));
  view.setUint32(80,count,true);
  for(let i=0;i<count;i++) {
    const a=ix[3*i]*3,b=ix[3*i+1]*3,c=ix[3*i+2]*3;
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,mag=Math.hypot(nx,ny,nz);
    let offset=84+i*50;
    for(const value of [nx/mag,ny/mag,nz/mag,...p.subarray(a,a+3),...p.subarray(b,b+3),...p.subarray(c,c+3)]){view.setFloat32(offset,value,true);offset+=4;}
    view.setUint16(offset,0,true);
  }
  return bytes;
}
