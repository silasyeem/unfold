import {assertGuide} from './guide-schema.js';

// The capture plan refers to the same normalized timeline evaluated by the player.
export function planGuideStages(guide,{overviewPage=1}={}){
 assertGuide(guide);
 if(!Number.isInteger(overviewPage)||overviewPage<1||overviewPage>guide.pageCount)throw new Error('Invalid overview source page.');
 const kinds=new Map(guide.parts.map(part=>[part.id,part.kind]));
 const stages=[{id:'overview',stepIndex:-1,phase:'overview',sourcePage:overviewPage,progress:0}];
 guide.steps.forEach((step,stepIndex)=>{
  const prefix=`step-${stepIndex+1}`;
  stages.push({id:`${prefix}-assembled`,stepIndex,phase:'assembled',sourcePage:step.sourcePage,progress:1});
  const ranked=step.actions.filter(action=>action.kind!=='remove').map(action=>({action,rank:kinds.get(action.partId)==='tool'?(action.kind==='tighten'?4:3):action.kind==='tighten'?2:1})).sort((a,b)=>b.rank-a.rank||b.action.start-a.action.start);
  if(ranked.length){const {action}=ranked[0];stages.push({id:`${prefix}-connection`,stepIndex,phase:'connection',sourcePage:step.sourcePage,progress:(action.start+action.end)/2});}
 });
 if(stages.length>65)throw new Error('The guide exceeds the 65 supported render captures.');
 return stages;
}

