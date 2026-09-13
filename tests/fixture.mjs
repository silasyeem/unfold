export function fixture(){
 const part=(id,parentId='',initiallyVisible=false)=>({id,parentId,name:id,kind:id==='tool'?'tool':'part',sourcePage:1,color:'#b39865',position:[0,0,0],rotation:[0,0,0],explodedOffset:[.3,.3,.3],initiallyVisible,primitives:[{shape:'box',size:[.1,.1,.1],position:[0,0,0],rotation:[0,0,0]}]});
 const action=(partId,start,end,kind='insert')=>({partId,kind,fromPosition:[0,1,0],toPosition:[0,0,0],fromRotation:[0,0,0],toRotation:[0,0,0],axis:[0,1,0],turns:0,start,end});
 const step=actions=>({title:'Attach the bracket',instruction:'Attach the bracket before moving the panel.',sourcePage:1,duration:10,orientation:'on_back',focus:[0,0,0],cameraDirection:[1,1,1],cameraDistance:.6,reviewNotes:[],actions});
 return{schemaVersion:'1',productName:'Fixture',summary:'A deterministic test fixture',pageCount:1,reviewNotes:[],parts:[part('panel'),part('bracket','panel'),part('tool')],steps:[step([action('bracket',0,.3),action('tool',.35,.5),action('tool',.55,.65,'remove'),action('tool',.8,1)]),step([action('panel',0,1)])]};
}
