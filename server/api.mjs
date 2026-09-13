import {convertPdf,MAX_PDF_BYTES,DEFAULT_MODEL} from '../engine/convert.mjs';
import {handlePhotos} from './photos.mjs';
import {handleLibrary} from './library.mjs';
import {handlePartsScan} from './parts-scan.mjs';
let active=0;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function handleApi(request,env){
 const url=new URL(request.url);
 if(['/api/parts-scan','/api/scan-health'].includes(url.pathname))return handlePartsScan(request,env);
 if(url.pathname==='/api/photos')return handlePhotos(request,env);
 if(url.pathname==='/api/library'||url.pathname.startsWith('/api/library/'))return handleLibrary(request,env);
 if(url.pathname==='/api/health')return json({conversionAvailable:!!env.OPENAI_API_KEY,model:env.OPENAI_MODEL||DEFAULT_MODEL,maxBytes:MAX_PDF_BYTES,maxPages:40});
 if(url.pathname!=='/api/convert')return json({error:'Not found'},404);
 if(request.method!=='POST')return json({error:'Use POST'},405);
 if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'Origin not allowed'},403);
 if(request.headers.get('x-unfold-convert')!=='1')return json({error:'Missing conversion request header'},400);
 if(!env.OPENAI_API_KEY)return json({error:'Conversion is not configured on this server.'},503);
 if(active>=2)return json({error:'Two conversions are already running. Please try again shortly.'},429);
 if(!request.headers.get('content-type')?.startsWith('application/pdf'))return json({error:'Upload a PDF.'},415);
 if(Number(request.headers.get('content-length'))>MAX_PDF_BYTES)return json({error:'Conversion supports PDFs up to 8 MB.'},413);
 const reader=request.body?.getReader();if(!reader)return json({error:'Upload a PDF.'},400);
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_PDF_BYTES){await reader.cancel();return json({error:'Conversion supports PDFs up to 8 MB.'},413);}chunks.push(value);}}catch{return json({error:'The upload was interrupted.'},400);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const pageCount=Number(request.headers.get('x-pdf-pages'));
 if(!Number.isInteger(pageCount)||pageCount<1||pageCount>40)return json({error:'Conversion supports manuals with 1–40 pages.'},400);
 if(!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'))return json({error:'The uploaded file is not a PDF.'},400);
 let filename;try{filename=decodeURIComponent(request.headers.get('x-pdf-name')||'manual.pdf');}catch{filename='manual.pdf';}
 if(active>=2)return json({error:'Two conversions are already running. Please try again shortly.'},429);
 active++;const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),1800000);let cancelled=false;
 const encoder=new TextEncoder();
 const stream=new ReadableStream({
  async start(controller){
   let sequence=0;
   const emit=(event,data)=>{if(event==='stage'){data={...data,sequence:++sequence,updatedAt:Date.now()};env.reportStage?.(data);}if(!cancelled)controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));};
   const heartbeat=setInterval(()=>{if(!cancelled)controller.enqueue(encoder.encode(': waiting\n\n'));},12000);
   try{const result=await convertPdf(bytes,{apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||DEFAULT_MODEL,pageCount,filename,signal:abort.signal,renderStages:env.createRenderer?.(emit),onStage:message=>emit('stage',{message})});emit('result',result);}
   catch(error){if(!cancelled)emit('error',{message:abort.signal.aborted?'Conversion took too long. Try a shorter manual.':error.message||'Conversion failed. Please retry.'});}
   finally{abort.abort();clearInterval(heartbeat);clearTimeout(timeout);active--;if(!cancelled)controller.close();await env.clearProgress?.();}
  },cancel(){cancelled=true;abort.abort();}
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
