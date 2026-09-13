import voice from './hosted.mjs';
import {handlePartsScan} from './parts-scan.mjs';
import {handlePhotos} from './photos.mjs';
import {handleLibrary} from './library.mjs';
import {createWorkerLibraryStore} from './library-worker-store.mjs';
import {handleApi} from './api.mjs';
import {createR2Renderer,receiveRenders} from './render-relay.mjs';
import {DEFAULT_MODEL} from '../engine/convert.mjs';
const stores=new WeakMap();
export default {async fetch(request,env,ctx){
 const path=new URL(request.url).pathname;
 if(['/api/scan-health','/api/parts-scan'].includes(path))return handlePartsScan(request,env);
 if(path==='/api/health')return Response.json({conversionAvailable:!!env.OPENAI_API_KEY,browserRendering:true,model:env.OPENAI_MODEL||DEFAULT_MODEL,maxBytes:8*1024*1024,maxPages:40},{headers:{'Cache-Control':'no-store'}});
 if(path.startsWith('/api/render/'))return receiveRenders(request,env);
 if(path==='/api/convert')return handleApi(request,{...env,createRenderer:emit=>createR2Renderer(env.BUCKET,emit)});
 if(path==='/api/photos')return handlePhotos(request,env);
 if(path==='/api/library'||path.startsWith('/api/library/')){if(!stores.has(env))stores.set(env,createWorkerLibraryStore(env));return handleLibrary(request,{...env,libraryStore:stores.get(env)});}
 return voice.fetch(request,env,ctx);
}};
