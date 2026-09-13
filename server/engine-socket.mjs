import {convertPdf,DEFAULT_MODEL,MAX_PDF_BYTES} from '../engine/convert.mjs';
import {planGuideStages} from '../dist/render-plan.js';
let active=0;
export function handleEngineSocket(request,env){
 const url=new URL(request.url),origin=request.headers.get('origin');
 if(origin!==url.origin)return Response.json({error:'Origin not allowed'},{status:403});
 if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')return Response.json({error:'Use a WebSocket connection.'},{status:426});
 if(!env.OPENAI_API_KEY)return Response.json({error:'Conversion is not configured.'},{status:503});
 if(active>=2)return Response.json({error:'Two conversions are running. Please try again shortly.'},{status:429});
 const [client,socket]=Object.values(new WebSocketPair());socket.binaryType='arraybuffer';socket.accept();active++;
 let init=null,started=false,closed=false,pending=null,renderSequence=0;
 const abort=new AbortController(),timer=setTimeout(()=>fail('Conversion timed out. Try a shorter manual.'),20*60*1000);
 const send=data=>{if(!closed)socket.send(JSON.stringify(data));};
 function cleanup(){if(closed)return;closed=true;active--;clearTimeout(timer);abort.abort();pending?.reject(new Error('Rendering cancelled.'));pending=null;}
 function fail(message){send({type:'error',message});cleanup();try{socket.close(1011,'Conversion stopped');}catch{}}
 socket.addEventListener('close',cleanup);socket.addEventListener('error',cleanup);
 socket.addEventListener('message',async event=>{
  try{
   if(closed)return;
   if(typeof event.data==='string'){
    if(event.data.length>2*1024*1024)throw new Error('A renderer message exceeded its size limit.');
    const data=JSON.parse(event.data);
    if(data.type==='init'&&!init&&!started){if(!Number.isInteger(data.pageCount)||data.pageCount<1||data.pageCount>40||typeof data.filename!=='string'||data.filename.length>300)throw new Error('Choose a PDF with 1–40 pages.');init=data;return;}
    if(!pending||data.requestId!==pending.id)throw new Error('Unexpected renderer response.');
    if(data.type==='capture'){
     const c=data.capture,stage=pending.stages[pending.captures.length];
     if(!stage||!c||!['id','stepIndex','phase','sourcePage','progress'].every(key=>c[key]===stage[key])||typeof c.imageDataUrl!=='string'||c.imageDataUrl.length>1500000)throw new Error('The browser returned an invalid render.');
     pending.captures.push(c);return;
    }
    if(data.type==='rendered'){if(pending.captures.length!==pending.stages.length)throw new Error('Not every assembly stage was rendered.');const completed=pending;pending=null;completed.resolve(completed.captures);return;}
    throw new Error('Unknown renderer response.');
   }
   if(!init||started)throw new Error('Upload one PDF per conversion.');started=true;
   const bytes=new Uint8Array(event.data instanceof ArrayBuffer?event.data:await event.data.arrayBuffer());
   if(!bytes.length||bytes.length>MAX_PDF_BYTES)throw new Error('Choose a PDF smaller than 8 MB.');
   const result=await convertPdf(bytes,{apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||DEFAULT_MODEL,pageCount:init.pageCount,filename:init.filename,signal:abort.signal,onStage:message=>send({type:'stage',message}),renderStages:(guide,{overviewPage})=>new Promise((resolve,reject)=>{
    const id=++renderSequence,stages=planGuideStages(guide,{overviewPage});pending={id,stages,captures:[],resolve,reject};send({type:'render',requestId:id,guide,stages});
   })});
   send({type:'result',result});cleanup();socket.close(1000,'Complete');
  }catch(error){if(!closed)fail(error.message||'Conversion failed. Please retry.');}
 });
 return new Response(null,{status:101,webSocket:client});
}
