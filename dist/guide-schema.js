// Shared contract: model output is data, never executable geometry or code.
// Resource budgets for the player/importer; 80 is now a generation routing threshold.
export const MAX_GUIDE_PARTS=512;
export const MAX_STEP_ACTIONS=2048;
export const MAX_GUIDE_BYTES=16*1024*1024;
const string={type:'string',maxLength:1500};
const number={type:'number',minimum:-20,maximum:20};
const vector={type:'array',items:number,minItems:3,maxItems:3};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const list=(items,maxItems=MAX_GUIDE_PARTS)=>({type:'array',items,maxItems});
export const guideSchema=object({
 schemaVersion:{type:'string',enum:['1']},productName:string,summary:string,pageCount:{type:'integer',minimum:1,maximum:40},
 reviewNotes:list(string,20),
 parts:{...list(object({
  id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,60}$'},parentId:{type:'string',pattern:'^[a-zA-Z0-9_-]{0,60}$'},name:string,kind:{type:'string',enum:['part','hardware','tool']},sourcePage:{type:'integer',minimum:1,maximum:40},
  color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},position:vector,rotation:vector,explodedOffset:vector,initiallyVisible:{type:'boolean'},
  primitives:{...list(object({shape:{type:'string',enum:['box','cylinder','sphere','ring']},size:{type:'array',items:{type:'number',minimum:0.001,maximum:5},minItems:3,maxItems:3},position:vector,rotation:vector}),8),minItems:1}
 })),minItems:1},
 steps:{...list(object({
  title:string,instruction:string,sourcePage:{type:'integer',minimum:1,maximum:40},duration:{type:'number',minimum:3,maximum:30},
  orientation:{type:'string',enum:['upright','on_back','on_front','on_left','on_right','upside_down']},focus:vector,cameraDirection:vector,cameraUp:vector,cameraDistance:{type:'number',minimum:0.15,maximum:10},
  reviewNotes:list(string,8),
  actions:list(object({partId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,60}$'},kind:{type:'string',enum:['place','insert','rotate','tighten','remove']},fromPosition:vector,toPosition:vector,fromRotation:vector,toRotation:vector,axis:{...vector,description:'Signed rotation axis in part-local coordinates; the spin follows the right-hand rule after the part rotation.'},turns:{type:'integer',minimum:-8,maximum:8,description:'Signed full revolutions. Positive is counterclockwise viewed from the positive axis side toward the origin. Right-hand tightening is clockwise from the screw-head side: negative for an outward axis, positive for an inward axis.'},start:{type:'number',minimum:0,maximum:1},end:{type:'number',minimum:0,maximum:1}}),MAX_STEP_ACTIONS)
 }),32),minItems:1}
});

function inspect(value,schema,path,errors){
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value)){errors.push(`${path}: expected an object`);return;}
  for(const key of schema.required)if(!(key in value))errors.push(`${path}.${key}: missing`);
  for(const key of Object.keys(value))if(!schema.properties[key])errors.push(`${path}.${key}: unsupported field`);
  for(const [key,rule] of Object.entries(schema.properties))if(key in value)inspect(value[key],rule,`${path}.${key}`,errors);
 }else if(schema.type==='array'){
  if(!Array.isArray(value)){errors.push(`${path}: expected an array`);return;}
  if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))errors.push(`${path}: invalid length`);
  value.forEach((v,i)=>inspect(v,schema.items,`${path}[${i}]`,errors));
 }else if(schema.type==='number'||schema.type==='integer'){
  if(!Number.isFinite(value)||(schema.type==='integer'&&!Number.isInteger(value))||value<schema.minimum||value>schema.maximum)errors.push(`${path}: invalid number`);
 }else if(typeof value!==schema.type)errors.push(`${path}: expected ${schema.type}`);
 else if(schema.type==='string'&&((schema.maxLength&&value.length>schema.maxLength)||(schema.pattern&&!new RegExp(schema.pattern).test(value))))errors.push(`${path}: invalid text`);
 if(schema.enum&&!schema.enum.includes(value))errors.push(`${path}: unsupported value`);
}
export function validateSchema(value,schema,path='value'){
 const errors=[];inspect(value,schema,path,errors);return errors.slice(0,30);
}
export function validateGuide(guide,expectedPageCount){
 // Older saved schema-1 guides predate explicit manual viewing axes. Validate
 // them without changing their data; the player retains their canonical poses.
 const inspected=Array.isArray(guide?.steps)?{...guide,steps:guide.steps.map(step=>step&&typeof step==='object'?{cameraUp:[0,0,0],...step}:step)}:guide;
 const errors=[];inspect(inspected,guideSchema,'guide',errors);
 if(errors.length)return errors.slice(0,30);
 if(expectedPageCount&&guide.pageCount!==expectedPageCount)errors.push('The guide page count does not match the uploaded PDF.');
 const ids=new Set();
 for(const p of guide.parts){if(ids.has(p.id))errors.push(`Duplicate part: ${p.id}`);ids.add(p.id);if(p.sourcePage>guide.pageCount)errors.push(`Invalid source page for ${p.id}`);}
 for(const p of guide.parts){if(p.parentId&&!ids.has(p.parentId))errors.push(`Unknown parent for ${p.id}`);const visited=new Set([p.id]);let parent=p.parentId;while(parent&&ids.has(parent)){if(visited.has(parent)){errors.push(`Cyclic parent relationship for ${p.id}`);break;}visited.add(parent);parent=guide.parts.find(x=>x.id===parent).parentId;}}
 guide.steps.forEach((s,i)=>{
  if(s.sourcePage>guide.pageCount)errors.push(`Step ${i+1}: invalid source page`);
  if(Math.hypot(...s.cameraDirection)<0.01)errors.push(`Step ${i+1}: camera direction cannot be zero`);
  if(s.cameraUp){const [x,y,z]=s.cameraDirection,[a,b,c]=s.cameraUp;const cross=Math.hypot(y*c-z*b,z*a-x*c,x*b-y*a);if(Math.hypot(a,b,c)<.01||cross/(Math.hypot(x,y,z)*Math.hypot(a,b,c))<.01)errors.push(`Step ${i+1}: camera up must be nonzero and independent of camera direction`);}
  const tracks=new Map();
  s.actions.forEach(a=>{
   if(!ids.has(a.partId))errors.push(`Step ${i+1}: unknown part ${a.partId}`);
   if(a.start>=a.end)errors.push(`Step ${i+1}: invalid action timing`);
   if(a.turns&&Math.hypot(...a.axis)<0.01)errors.push(`Step ${i+1}: rotation axis cannot be zero`);
   const previous=tracks.get(a.partId)||[];
   if(previous.some(p=>a.start<p.end&&a.end>p.start))errors.push(`Step ${i+1}: overlapping actions on ${a.partId}`);
   previous.push(a);tracks.set(a.partId,previous);
  });
 });
 return errors.slice(0,30);
}
export function assertGuide(guide,pageCount){const errors=validateGuide(guide,pageCount);if(errors.length)throw new Error(errors.join('\n'));return guide;}
