import {assertGuide} from './guide-schema.js';
export const orientations={upside_down:[Math.PI,0,0],upright:[0,0,0],on_back:[-Math.PI/2,0,0],on_front:[Math.PI/2,0,0],on_left:[0,0,Math.PI/2],on_right:[0,0,-Math.PI/2]};
export const clamp=x=>Math.max(0,Math.min(1,x));
export const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const clone=state=>Object.fromEntries(Object.entries(state).map(([id,p])=>[id,{...p,position:[...p.position],rotation:[...p.rotation],spinAxis:[...p.spinAxis]}]));
function apply(state,step,t){
 const touched=new Set();
 for(const action of [...step.actions].sort((a,b)=>a.start-b.start)){
  const p=state[action.partId];
  // A future track on the same part must not override an earlier active track.
  if(t<action.start){if(!p.visible&&!touched.has(action.partId)){p.visible=true;p.position=[...action.fromPosition];p.rotation=[...action.fromRotation];}continue;}
  touched.add(action.partId);
  const f=smooth((t-action.start)/(action.end-action.start));
  p.position=lerp(action.fromPosition,action.toPosition,f);p.rotation=lerp(action.fromRotation,action.toRotation,f);
  p.visible=action.kind!=='remove'||t<action.end;p.active=t>=action.start&&t<action.end;
  p.spin=f<1?action.turns*Math.PI*2*f:0;p.spinAxis=[...action.axis];
 }
 return state;
}
export function compileGuide(guide){
 assertGuide(guide);
 const firstActions=new Map();for(const step of guide.steps)for(const action of step.actions)if(!firstActions.has(action.partId))firstActions.set(action.partId,action);
 const state=Object.fromEntries(guide.parts.map(p=>{const first=firstActions.get(p.id);return[p.id,{position:[...(first?first.fromPosition:p.position)],rotation:[...(first?first.fromRotation:p.rotation)],visible:p.initiallyVisible,active:false,spin:0,spinAxis:[0,1,0]}];}));
 const starts=[];
 for(const step of guide.steps){starts.push(clone(state));apply(state,step,1);revealAncestors(state,guide);}
 return{guide,starts};
}
export function evaluateGuide(compiled,index,progress){
 if(!Number.isInteger(index)||index<0||index>=compiled.guide.steps.length)throw new Error('Invalid step index');
 return revealAncestors(apply(clone(compiled.starts[index]),compiled.guide.steps[index],clamp(progress)),compiled.guide);
}

function revealAncestors(state,guide){for(const part of guide.parts){if(!state[part.id].visible)continue;let parent=part.parentId;while(parent){state[parent].visible=true;parent=guide.parts.find(p=>p.id===parent).parentId;}}return state;}
