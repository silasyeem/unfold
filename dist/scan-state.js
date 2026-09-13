import {KNARREVIK} from './knarrevik.js';
export const CATEGORIES=[...KNARREVIK.parts.map(p=>p.id),'unknown'];
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const scanSchema=object({
  scene:{type:'string',enum:['laid_out_parts','assembled_product','unclear','unrelated']},
  summary:{type:'string',maxLength:600},
  advice:{type:'string',maxLength:600},
  detections:{type:'array',maxItems:64,items:object({
    category:{type:'string',enum:CATEGORIES},quantity:{type:'integer',minimum:1,maximum:40},
    certainty:{type:'string',enum:['likely','uncertain']},countCertainty:{type:'string',enum:['clear','approximate']},
    box:{type:'array',minItems:4,maxItems:4,items:{type:'number',minimum:0,maximum:1}},
    note:{type:'string',maxLength:400},
  })},
});
export function validateScan(result){
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
  const text=(value,max)=>typeof value==='string'&&value.length<=max;
  if(!exact(result,['scene','summary','advice','detections'])||!scanSchema.properties.scene.enum.includes(result.scene)||!text(result.summary,600)||!text(result.advice,600)||!Array.isArray(result.detections)||result.detections.length>64)throw new Error('The scan returned an invalid result. Please try again.');
  for(const d of result.detections){
    if(!exact(d,['category','quantity','certainty','countCertainty','box','note'])||!CATEGORIES.includes(d.category)||!Number.isInteger(d.quantity)||d.quantity<1||d.quantity>40||!['likely','uncertain'].includes(d.certainty)||!['clear','approximate'].includes(d.countCertainty)||!text(d.note,400)||!Array.isArray(d.box)||d.box.length!==4||d.box.some(v=>!Number.isFinite(v)||v<0||v>1)||d.box[2]<=0||d.box[3]<=0||d.box[0]+d.box[2]>1.001||d.box[1]+d.box[3]>1.001)throw new Error('The scan returned invalid part locations or counts. Please try again.');
  }
  // Assembled/unclear scenes cannot establish an inventory of loose components.
  if(result.scene!=='laid_out_parts'&&result.detections.length)throw new Error('Please photograph the loose parts laid out separately.');
  return result;
}
export function summarizeDetections(detections){
  return KNARREVIK.parts.map(part=>{
    const matches=detections.filter(d=>d.category===part.id);
    return {...part,observed:matches.reduce((n,d)=>n+d.quantity,0),uncertain:matches.some(d=>d.certainty==='uncertain'||d.countCertainty==='approximate')};
  });
}
export function checklistStatus(detections,reviews){
  const rows=summarizeDetections(detections);
  const checked=rows.filter(r=>reviews[r.id]?.checked&&Number.isInteger(reviews[r.id]?.count));
  const unknown= detections.filter(d=>d.category==='unknown').length;
  const countsMatch=checked.length===rows.length&&checked.every(r=>reviews[r.id].count===r.expected);
  return {checked:checked.length,types:rows.length,unknown,countsMatch:countsMatch&&!unknown};
}
