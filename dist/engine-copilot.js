// Expose guide text and app state only; never PDF bytes, filenames, keys or meshes.
export function createEngineCopilotAdapter(read,actions){
 const current=()=>{const state=read();return{state,guide:state.available===false?null:state.output?.guide};};
 const partNames=(guide,step)=>[...new Set((step?.actions||[]).map(action=>guide.parts.find(part=>part.id===action.partId)?.name).filter(Boolean))];
 return{
  getRevision:()=>read().revision,
  getState:()=>{
   const {state:s,guide}=current(),step=guide?.steps[s.index];
   return{product:guide?.productName??null,step:guide?s.index+1:0,title:step?.title??guide?.productName??'No guide open',body:step?.instruction??guide?.summary??'',parts:guide?(step?partNames(guide,step):guide.parts.map(part=>part.name)):[],preparedGuidePage:step?.sourcePage??1,preparedGuide:false,preparedGuideApplies:Boolean(guide),guideAvailable:Boolean(guide),manualPage:s.page,manualPageCount:s.pdfPageCount||0,linked:Boolean(s.pdfLinked),view:s.currentView,supportedViews:['guided','whole','exploded'],viewerAvailable:Boolean(s.viewerAvailable),progress:s.progress,playing:s.playing,speed:s.speed??1,reviewNotes:guide?[...guide.reviewNotes,...(step?.reviewNotes||[])]:[]};
  },
  listSteps:()=>{const {guide}=current();return guide?[{step:0,title:'Parts overview',body:guide.summary,parts:guide.parts.map(part=>part.name),page:1},...guide.steps.map((step,index)=>({step:index+1,title:step.title,body:step.instruction,parts:partNames(guide,step),page:step.sourcePage,orientation:step.orientation,reviewNotes:step.reviewNotes}))]:[];},
  navigateStep:step=>actions.navigateStep(step-1),
  showManualPage:page=>actions.showManualPage(page),
  setView:mode=>actions.setView(mode),
  controlPlayback:action=>actions.controlPlayback(action)
 };
}
