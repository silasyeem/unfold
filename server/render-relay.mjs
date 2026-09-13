import {planGuideStages} from '../dist/render-plan.js';
export function createR2Renderer(bucket,emit){
 return async(guide,{signal,overviewPage})=>{
  if(!bucket)throw new Error('Hosted render storage is unavailable.');
  const requestId=crypto.randomUUID(),key='render-jobs/'+requestId,expires=Date.now()+180000;
  await bucket.put(key,JSON.stringify({expires,state:'pending'}));
  try{
   emit('render',{requestId,guide,stages:planGuideStages(guide,{overviewPage})});
   while(Date.now()<expires){
    signal.throwIfAborted();const object=await bucket.get(key);if(object){const data=await object.json();if(data.state==='complete')return data.captures;}
    await new Promise(resolve=>setTimeout(resolve,1000));
   }
   throw new Error('Browser rendering timed out. Keep this tab open and retry.');
  }finally{await bucket.delete(key);}
 };
}
export async function receiveRenders(request,env){
 const url=new URL(request.url),id=url.pathname.split('/').at(-1);
 if(request.method!=='POST'||request.headers.get('origin')!==url.origin||request.headers.get('x-unfold-render')!=='1')return Response.json({error:'Invalid render request.'},{status:403});
 if(!/^[0-9a-f-]{36}$/.test(id)||!env.BUCKET)return Response.json({error:'Unknown render request.'},{status:404});
 const key='render-jobs/'+id,object=await env.BUCKET.get(key),job=object&&await object.json();
 if(!job||job.state!=='pending'||job.expires<Date.now())return Response.json({error:'Render request expired.'},{status:409});
 const reader=request.body?.getReader();if(!reader)return Response.json({error:'Missing renders.'},{status:400});
 const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16*1024*1024){await reader.cancel();return Response.json({error:'Renders are too large.'},{status:413});}chunks.push(value);}
 let captures;try{captures=JSON.parse(await new Blob(chunks).text());}catch{return Response.json({error:'Invalid renders.'},{status:400});}
 if(!Array.isArray(captures)||!captures.length||captures.length>65)return Response.json({error:'Invalid render count.'},{status:400});
 await env.BUCKET.put(key,JSON.stringify({...job,state:'complete',captures}));return Response.json({received:true});
}
