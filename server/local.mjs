import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {createVoiceHandler} from './voice.mjs';
import {handleApi} from './api.mjs';
import {createLibraryStore} from './library-store.mjs';
const defaultRoot=resolve(import.meta.dirname,'../dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf','.svg':'image/svg+xml','.json':'application/json'};
export function createUnfoldServer({env=process.env,root=defaultRoot,voiceOptions={}}={}){
 const runtimeEnv={...env,libraryStore:env.libraryStore||createLibraryStore(resolve(import.meta.dirname,'../data/library'))};
 const handleVoice=createVoiceHandler({apiKey:env.OPENAI_API_KEY||'',backendModel:env.OPENAI_BACKEND_MODEL||'gpt-5.6-terra',...voiceOptions});
 const server=createServer(async(req,res)=>{
 try{
  const port=server.address().port;
  const host=req.headers.host;if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)){res.writeHead(400);res.end('Invalid host');return;}
  const url=new URL(req.url,`http://${host}`);
  if(url.pathname.startsWith('/api/voice/')){await handleVoice(req,res);return;}
  if(url.pathname.startsWith('/api/')){
   const connection=new AbortController();req.once('aborted',()=>connection.abort());res.once('close',()=>{if(!res.writableEnded)connection.abort();});
   const request=new Request(url,{method:req.method,headers:req.headers,signal:connection.signal,body:['GET','HEAD'].includes(req.method)?undefined:Readable.toWeb(req),duplex:'half'});
   const response=await handleApi(request,runtimeEnv);res.writeHead(response.status,Object.fromEntries(response.headers));
   const reader=response.body?.getReader();res.on('close',()=>{if(!res.writableEnded)reader?.cancel().catch(()=>{});});
   if(reader)while(true){const {done,value}=await reader.read();if(done)break;if(res.destroyed)break;if(!res.write(value))await new Promise(resolve=>{res.once('drain',resolve);res.once('close',resolve);});}
   res.end();return;
  }
  if(/^\/(server|client)(\/|$)/.test(url.pathname)){res.writeHead(404);res.end('Not found');return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const filename=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!filename.startsWith(root+sep)||!types[extname(filename)]){res.writeHead(404);res.end('Not found');return;}
  const info=await stat(filename);if(!info.isFile())throw new Error('Not a file');
  res.writeHead(200,{'Content-Type':types[extname(filename)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Permissions-Policy':'microphone=(self)'});
  res.end(req.method==='HEAD'?undefined:await readFile(filename));
 }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
 });
 return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.UNFOLD_PORT||process.env.PORT||4173);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('UNFOLD_PORT (or PORT) must be an integer from 1 to 65535.');
 createUnfoldServer().listen(port,'127.0.0.1',()=>console.log(`Unfold running at http://127.0.0.1:${port}/engine.html`));
}
