import {orientations} from '../dist/guide-state.js';

// Whole-build handling is applied by the player. Repeating it on a root part
// flips that part and its children twice, often putting connections below ground.
export function validateHandling(guide,steps=guide.steps){
 const errors=[];
 const near=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<.002);
 for(let i=0;i<guide.steps.length;i++){
  const before=orientations[i?steps[i-1].orientation:'upright'];
  const after=orientations[steps[i].orientation];
  if(!before||!after||near(before,after))continue;
  for(const action of guide.steps[i].actions){
   const part=guide.parts.find(p=>p.id===action.partId);
   if(!part||part.parentId||!part.initiallyVisible||action.kind!=='rotate')continue;
   if(near(action.fromPosition,action.toPosition)&&
      near(action.fromRotation,part.rotation.map((v,j)=>v+before[j]))&&
      near(action.toRotation,part.rotation.map((v,j)=>v+after[j]))){
    errors.push(`Step ${i+1}: remove the whole-build rotate action on ${part.id}. The player already applies orientation. Keep this base part in its unrotated assembly transform; an orientation-only step can have empty actions.`);
   }
  }
 }
 return errors;
}
